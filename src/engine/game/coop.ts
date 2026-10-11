import * as THREE from 'three';
import { COOP, START_SLOTS, validCoopState } from './coop-rules';
import type { CoopState } from './coop-rules';
import type { OnlineInfo } from '../hud/screens';
import type { App } from '../boot';

/** Co-op survival: the host runs the solo waves, the clients mirror them (docs/spec/online-coop.md). */
export interface CoopApi {
  /** An online co-op lobby or run. */
  active(): boolean;
  /** The host of a live run: it runs the wave director and the enemy AI. */
  directing(): boolean;
  /** Players the next wave is scaled for. One outside co-op. */
  players(): number;
  readonly state: CoopState | null;
  begin(state: CoopState, slot: number): void;
  /** A start position around the solo player start. */
  slot(index?: number): THREE.Vector3;
  info(): OnlineInfo;
  /** Points this peer earned for the team score. */
  points(n: number): void;
  /** Once a frame while the run is live, with real frame time. */
  update(dt: number): void;
  reset(): void;
}

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createCoop(app: App): CoopApi {
  const { ctx, gs, lobby } = app;
  const { net, hud } = ctx;
  const min = new THREE.Vector3(), max = new THREE.Vector3();
  let state: CoopState | null = null;
  let mySlot = 0, syncT = 0, sent = '';
  /** The last wave this client announced, so a late join in an intermission announces nothing. */
  let announced = 0;
  /** Points earned here that the host has not counted yet. */
  let pending = 0;

  const active = (): boolean => gs.mode === 'ffa' && lobby.mode === 'coop';
  const live = (): boolean => active() && state !== null && (gs.state === 'play' || gs.state === 'dying');
  const directing = (): boolean => live() && net.isHost;
  const players = (): number => active() ? Math.max(1, Math.min(COOP.MAX_PLAYERS, lobby.players.size)) : 1;

  function slot(index = mySlot): THREE.Vector3 {
    const start = ctx.level.playerStart, [dx, dz] = START_SLOTS[index % START_SLOTS.length] ?? [0, 0];
    const p = new THREE.Vector3(start.x + dx, start.y, start.z + dz);
    const blocked = ctx.world.overlapsAABB(min.set(p.x - 0.4, p.y + 0.1, p.z - 0.4), max.set(p.x + 0.4, p.y + 1.8, p.z + 0.4))
      || Math.abs(ctx.world.groundBelow(p.x, p.y + 1, p.z, 3) - p.y) > 0.5;
    return blocked ? start.clone() : p;
  }

  function begin(next: CoopState, index: number): void {
    state = structuredClone(next); mySlot = index; syncT = 0; sent = ''; pending = 0;
    // A join in an intermission has missed this wave's start; the next one is announced.
    announced = state.inter > 0 ? state.wave : 0;
    gs.wave = state.wave; gs.score = state.score; gs.intermission = state.inter;
    hud.setWave(state.wave, state.left); hud.setScore(state.score, 0);
    if (net.isHost) { if (state.inter <= 0) app.solo.startWave(state.wave); sync(); }
  }

  // ---- host: the run state follows the wave director
  function sync(): void {
    const s = state, enemies = ctx.enemies;
    if (s === null || enemies === null || !net.isHost) return;
    s.wave = Math.max(1, gs.wave); s.left = enemies.alive + gs.queue.length; s.inter = Math.max(0, Math.min(60, gs.intermission));
    s.score = Math.max(0, Math.round(gs.score));
    s.label = app.solo.intro.label.slice(0, 96); s.sub = app.solo.intro.sub.slice(0, 96);
    s.speed = enemies.mods.speed; s.damage = enemies.mods.damage;
    // Wave start, wave clear and the down list go out at once; the counters ride the timer.
    const edge = `${s.wave}/${s.inter > 0}/${s.dead.join()}`;
    if (syncT > 0 && edge === sent) return;
    syncT = COOP.SYNC; sent = edge;
    net.send('coop', s);
  }

  // ---- client: wave start and wave clear are read from two states
  function waveStart(s: CoopState): void {
    const player = ctx.player;
    hud.message(`WAVE ${s.wave}`, s.sub, s.wave % 5 === 0 ? 3 : 2.6); ctx.audio.wave();
    ctx.enemies?.setMutations(s.wave);
    if (player !== null) player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
  }
  function waveClear(s: CoopState): void {
    hud.message(`WAVE ${s.wave} CLEARED`, 'catch your breath', 2.5); ctx.audio.waveClear();
    ctx.player?.heal(40);
    if (s.wave % 5 === 0 && s.wave > app.settings.checkpoint) { app.saveCheckpoint(s.wave); hud.kill(`CHECKPOINT · WAVE ${s.wave + 1}`); }
  }
  function apply(prev: CoopState, s: CoopState): void {
    const enemies = ctx.enemies;
    gs.wave = s.wave; gs.intermission = s.inter;
    // The team score only grows, and this peer's uncounted points are already on its HUD.
    gs.score = Math.max(gs.score, s.score + pending);
    hud.setWave(s.wave, s.left); hud.setScore(gs.score, gs.combo); hud.setModifier(s.label);
    hud.setTimer(s.inter > 0 ? `next wave in ${Math.ceil(s.inter)}` : '');
    if (enemies !== null) { enemies.mods.speed = s.speed; enemies.mods.damage = s.damage; }
    if (s.inter <= 0 && s.wave > announced) { announced = s.wave; waveStart(s); }
    if (s.inter > 0 && prev.inter <= 0 && s.wave === prev.wave) waveClear(s);
  }
  net.on('coop', (d, from) => {
    const prev = state;
    if (net.isHost || from !== net.hostId || prev === null || !live() || !validCoopState(d) ||
        d.wave < prev.wave || d.dead.some(id => !lobby.players.has(id))) return;
    state = d; apply(prev, d);
  });
  net.on('cpts', (d, from) => {
    if (!directing() || !lobby.players.has(from) || !obj(d) || typeof d.n !== 'number' || !Number.isSafeInteger(d.n) || d.n < 1 || d.n > 100000) return;
    gs.score += d.n; hud.setScore(gs.score, gs.combo);
  });

  function points(n: number): void {
    if (live() && !net.isHost && Number.isFinite(n) && n > 0) pending += Math.round(n);
  }

  function update(dt: number): void {
    if (!live()) return;
    syncT -= dt;
    if (net.isHost) { sync(); return; }
    if (syncT <= 0 && pending > 0) {
      syncT = COOP.SYNC;
      const n = Math.min(pending, 100000);
      net.send('cpts', { n }); pending -= n;
    }
  }

  function info(): OnlineInfo {
    return { mode: 'coop', status: state ? `WAVE ${state.wave} · team score ${Math.max(state.score, gs.score)}` : '' };
  }

  function reset(): void { state = null; mySlot = 0; pending = 0; announced = 0; sent = ''; }

  return { active, directing, players, get state() { return state; }, begin, slot, info, points, update, reset };
}

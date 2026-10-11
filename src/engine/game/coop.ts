import * as THREE from 'three';
import { round1, round2 } from '../util';
import { spawnProjectile } from '../enemies/projectiles';
import { COOP, START_SLOTS, validCoopState } from './coop-rules';
import type { CoopState } from './coop-rules';
import type { EnemyRecord } from '../enemies/index';
import type { OnlineInfo } from '../hud/screens';
import type { HitInfo } from '../types';
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
  /** An enemy died here: the host credits the attacker and tells the mirrors; each machine rewards its own player. */
  onKill(e: EnemyRecord, info: HitInfo, overkill: boolean): void;
  /** Host: an enemy hurt or pushed a remote player. Only that player's machine applies it. */
  hurt(id: string, amount: number, from: THREE.Vector3 | null): void;
  push(id: string, dir: THREE.Vector3, amount: number): void;
  /** A player's health is gone. The host counts it; in a wave the player waits for the wave clear. */
  down(id: string): void;
  /** True while `id` waits for the wave clear. */
  isDown(id: string): boolean;
  /** Host: a player left the run. */
  left(id: string): void;
  /** Host: a player joined a live run; it needs the enemies that are already out. */
  joined(id: string): void;
  /** Once a frame while the run is live, with real frame time. */
  update(dt: number): void;
  reset(): void;
}

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, limit = 1e7): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const triple = (v: unknown, limit = 10000): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => num(n, limit));
const vec = (a: number[]): THREE.Vector3 => new THREE.Vector3().fromArray(a);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
/** `rows` in pieces a single envelope carries. */
function* chunks<T>(rows: T[], size: number): Generator<T[]> { for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size); }
interface HitRow { id: number; amount: number; part: string; src: string; crit: boolean; point: number[]; dir: number[] }

export function createCoop(app: App): CoopApi {
  const { ctx, gs, lobby } = app;
  const { net, hud } = ctx;
  const scores = app.scores;
  const min = new THREE.Vector3(), max = new THREE.Vector3(), unit = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let state: CoopState | null = null;
  let mySlot = 0, syncT = 0, snapT = 0, sent = '', scoresDirty = false;
  /** Host: whether the last synced frame was an intermission. Null before the first one. */
  let resting: boolean | null = null;
  /** Host: spawns and shots of this frame, sent after the director has set their final values. */
  const spawned: EnemyRecord[] = [];
  let shots: number[][] = [];
  /** Client: hits of this frame, one envelope instead of one per shotgun pellet. */
  let hits: HitRow[] = [];
  /** The last wave this client announced, so a late join in an intermission announces nothing. */
  let announced = 0;
  /** Points earned here that the host has not counted yet. */
  let pending = 0;

  const active = (): boolean => gs.mode === 'ffa' && lobby.mode === 'coop';
  const live = (): boolean => active() && state !== null && (gs.state === 'play' || gs.state === 'dying');
  const directing = (): boolean => live() && net.isHost;
  const mirroring = (from: string): boolean => live() && !net.isHost && from === net.hostId;
  const players = (): number => active() ? Math.max(1, Math.min(COOP.MAX_PLAYERS, lobby.players.size)) : 1;

  function slot(index = mySlot): THREE.Vector3 {
    const start = ctx.level.playerStart, [dx, dz] = START_SLOTS[index % START_SLOTS.length] ?? [0, 0];
    const p = new THREE.Vector3(start.x + dx, start.y, start.z + dz);
    const blocked = ctx.world.overlapsAABB(min.set(p.x - 0.4, p.y + 0.1, p.z - 0.4), max.set(p.x + 0.4, p.y + 1.8, p.z + 0.4))
      || Math.abs(ctx.world.groundBelow(p.x, p.y + 1, p.z, 3) - p.y) > 0.5;
    return blocked ? start.clone() : p;
  }

  function begin(next: CoopState, index: number): void {
    state = structuredClone(next); mySlot = index; syncT = snapT = 0; sent = ''; pending = 0;
    spawned.length = 0; shots = []; hits = []; scoresDirty = false; resting = null;
    if (net.isHost) net.busyReason = 'a wave is running · try again between waves';
    const enemies = ctx.enemies;
    if (enemies !== null) { enemies.mirror = !net.isHost; if (!net.isHost) enemies.setMutations(state.wave); }
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
    const rest = s.inter > 0;
    if (rest !== resting) {
      // The lobby is open between waves only: a join then needs no enemy catch-up worth the name.
      net.accepting = rest;
      // A wave clear brings back every player who is down, the host's own included.
      if (rest && resting !== null) { s.dead = []; if (gs.state === 'dying') app.ffa.respawn(false); }
      resting = rest;
    }
    // Wave start, wave clear and the down list go out at once; the counters ride the timer.
    const edge = `${s.wave}/${s.inter > 0}/${s.dead.join()}`;
    if (syncT > 0 && edge === sent) return;
    syncT = COOP.SYNC; sent = edge;
    net.send('coop', s);
    if (scoresDirty) { scoresDirty = false; app.ffa.sendScores(); }
  }

  // ---- host: enemies leave as spawns, snapshots, shots and deaths
  const manager = ctx.enemies;
  if (manager !== null) {
    manager.onSpawn = e => { if (directing()) spawned.push(e); };
    manager.onFire = p => {
      if (!directing()) return;
      const speed = p.vel.length();
      unit.copy(p.vel).divideScalar(speed || 1);
      shots.push([p.id, round2(p.pos.x), round2(p.pos.y), round2(p.pos.z), round3(unit.x), round3(unit.y), round3(unit.z),
        round2(speed), round2(p.damage), p.owner?.id ?? 0, p.tone, p.thickness, p.blast ? 1 : 0]);
    };
    manager.onClientHit = (e, amount, info) => {
      if (!live() || net.isHost) return;
      unit.copy(info.dir ?? up).normalize();
      hits.push({ id: e.id, amount: Math.min(100000, Math.max(0.1, round1(amount))), part: String(info.part ?? 'torso').slice(0, 24),
        src: String(info.source ?? 'rifle').slice(0, 32), crit: !!info.crit,
        point: (info.point ?? e.center).toArray().map(round2), dir: unit.toArray().map(round3) });
    };
    manager.onClientYank = (e, to) => { if (live() && !net.isHost) net.send('eyank', { id: e.id, to: to.toArray().map(round2) }); };
  }
  function flush(dt: number): void {
    const enemies = ctx.enemies;
    if (enemies === null) return;
    // A spawn goes out here, not from `onSpawn`: the director scales a boss's health after the spawn call.
    for (const e of spawned) if (e.alive) net.send('espawn', espawn(e));
    spawned.length = 0;
    for (const rows of chunks(shots.filter(row => row.every(Number.isFinite)), COOP.SHOT_ROWS)) net.send('eproj', rows);
    shots = [];
    snapT -= dt;
    if (snapT > 0) return;
    snapT = COOP.SNAP;
    for (const rows of chunks(enemies.snapshot().filter(row => row.every(Number.isFinite)), COOP.SNAP_ROWS)) net.send('esnap', rows);
  }
  function onKill(e: EnemyRecord, info: HitInfo, overkill: boolean): void {
    if (!net.isHost) {
      if (info.by === net.id) { hud.hitmarker(true, !!info.crit); app.solo.reward(e, info, overkill); }
      return;
    }
    if (!directing()) return;
    // No attacker is the host's own hit, a fall or an enemy blast: the host takes the credit.
    const by = info.by ?? net.id;
    net.send('ekill', { id: e.id, by, src: String(info.source ?? '').slice(0, 32), crit: !!info.crit,
      dir: info.dir ? unit.copy(info.dir).normalize().toArray().map(round3) : null,
      point: info.point ? info.point.toArray().map(round2) : null, boom: info.boom ?? 0 });
    const row = by === null ? undefined : scores.get(by);
    if (row) { row.kills++; scoresDirty = true; }
    if (by === net.id) app.solo.reward(e, info, overkill);
    app.solo.drop(e);
  }
  const espawn = (e: EnemyRecord) => ({ id: e.id, type: e.type, pos: e.body.pos.toArray().map(round2), hp: Math.max(1, e.maxHp) });
  function joined(id: string): void {
    if (!directing() || ctx.enemies === null) return;
    for (const e of ctx.enemies.list) if (e.alive && !spawned.includes(e)) net.sendTo(id, 'espawn', espawn(e));
  }
  function isDown(id: string): boolean { return state !== null && state.dead.includes(id); }
  function finish(): void {
    const result = { id: 'coop', name: `WAVE ${gs.wave}` };
    // The last state first, so every result screen shows the final score.
    sent = ''; sync();
    net.send('end', result); app.ffa.endMatch(result);
  }
  const wiped = (s: CoopState): boolean => [...lobby.players.keys()].every(id => s.dead.includes(id));
  function down(id: string): void {
    const s = state;
    if (s === null || !directing() || !lobby.players.has(id) || s.dead.includes(id)) return;
    const row = scores.get(id);
    if (row) { row.deaths++; scoresDirty = true; }
    // Between waves nothing can end the run: the player returns on its own short timer.
    if (gs.intermission > 0) return;
    s.dead.push(id);
    if (wiped(s)) finish(); else sync();
  }
  function left(id: string): void {
    const s = state;
    if (s === null || !directing()) return;
    s.dead = s.dead.filter(other => other !== id);
    if (s.dead.length && wiped(s)) finish(); else sync();
  }
  function hurt(id: string, amount: number, from: THREE.Vector3 | null): void {
    if (directing() && amount > 0) net.sendTo(id, 'edmg', { amount: Math.min(100000, round1(amount)), from: from ? from.toArray().map(round1) : null, push: null });
  }
  function push(id: string, dir: THREE.Vector3, amount: number): void {
    if (!directing() || !(amount > 0)) return;
    net.sendTo(id, 'edmg', { amount: 0, from: null, push: unit.copy(dir).normalize().multiplyScalar(Math.min(amount, COOP.PUSH_CAP)).toArray().map(round2) });
  }
  net.on('ehit', (d, from) => {
    const enemies = ctx.enemies;
    // A player who is down or gone deals no damage.
    if (!directing() || enemies === null || !lobby.players.has(from) || !ctx.remotes.get(from)?.alive || !Array.isArray(d)) return;
    for (const h of d.slice(0, COOP.HIT_ROWS) as unknown[]) {
      if (!obj(h) || !int(h.id) || !num(h.amount) || h.amount <= 0 || typeof h.part !== 'string' || typeof h.src !== 'string' ||
          !triple(h.point) || !triple(h.dir, 1.01)) continue;
      const e = enemies.byId.get(h.id);
      if (!e?.alive) continue;
      enemies.damage(e, Math.min(h.amount, COOP.HIT_CAP), { point: vec(h.point), dir: vec(h.dir), part: h.part, source: h.src,
        crit: h.crit === true && h.part === 'head', by: from });
    }
  });
  net.on('eyank', (d, from) => {
    const enemies = ctx.enemies;
    if (!directing() || enemies === null || !lobby.players.has(from) || !ctx.remotes.get(from)?.alive || !obj(d) || !int(d.id) || !triple(d.to)) return;
    const e = enemies.byId.get(d.id);
    if (e) enemies.yank(e, vec(d.to));
  });

  // ---- client: the mirror follows the host
  net.on('espawn', (d, from) => {
    const enemies = ctx.enemies;
    if (!mirroring(from) || enemies === null || !obj(d) || !int(d.id) || d.id < 1 || typeof d.type !== 'string' || !triple(d.pos) || !num(d.hp)) return;
    if (enemies.byId.has(d.id) || enemies.list.length >= 256) return;
    const e = enemies.spawn(d.type, vec(d.pos), d.id);
    if (e === null) return;
    e.hp = e.maxHp = Math.max(1, d.hp);
    if (e.stats.boss) enemies.onBoss?.(e);
  });
  net.on('esnap', (d, from) => {
    if (mirroring(from) && Array.isArray(d)) ctx.enemies?.applySnapshot(d as number[][], performance.now() / 1000);
  });
  net.on('ekill', (d, from) => {
    const enemies = ctx.enemies;
    if (!mirroring(from) || enemies === null || !obj(d) || !int(d.id)) return;
    const e = enemies.byId.get(d.id);
    if (!e?.alive) return;
    const crit = d.crit === true;
    const info: HitInfo = { source: typeof d.src === 'string' ? d.src.slice(0, 32) : '', crit, part: crit ? 'head' : 'torso',
      by: typeof d.by === 'string' ? d.by : null };
    if (triple(d.dir, 1.01)) info.dir = vec(d.dir);
    if (triple(d.point)) info.point = vec(d.point);
    // A fuse detonation is not a kill by damage: the mirror repeats the explosion, and its own player takes it.
    if (num(d.boom) && d.boom > 0) enemies.explode(e, Math.min(d.boom, 5)); else enemies.kill(e, info);
  });
  net.on('eproj', (d, from) => {
    const enemies = ctx.enemies;
    if (!mirroring(from) || enemies === null || !Array.isArray(d)) return;
    for (const row of d.slice(0, COOP.SHOT_ROWS) as unknown[]) {
      if (!Array.isArray(row) || row.length !== 13 || !row.every(n => num(n))) continue;
      const [id = 0, x = 0, y = 0, z = 0, dx = 0, dy = 0, dz = 0, speed = 0, damage = 0, owner = 0, tone = 0, thickness = 0, blast = 0] = row as number[];
      if (!int(id) || speed <= 0 || speed > 400 || damage < 0) continue;
      spawnProjectile(enemies, min.set(x, y, z), max.set(dx, dy, dz), speed, damage, enemies.byId.get(owner) ?? null, tone, thickness, blast > 0, id);
    }
  });
  net.on('edmg', (d, from) => {
    const p = ctx.player;
    if (!mirroring(from) || p === null || !p.alive || gs.state !== 'play' || !obj(d)) return;
    if (num(d.amount) && d.amount > 0) p.takeDamage(Math.min(d.amount, COOP.DAMAGE_CAP), triple(d.from) ? vec(d.from) : null);
    if (triple(d.push, 100)) {
      const amount = Math.min(unit.fromArray(d.push).length(), COOP.PUSH_CAP);
      if (amount > 0.01) p.knockback(unit.normalize(), amount);
    }
  });

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
    const me = net.id;
    if (me !== null && gs.state === 'dying' && prev.dead.includes(me) && !s.dead.includes(me)) app.ffa.respawn(false);
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
    if (net.isHost) { flush(dt); sync(); return; }
    for (const rows of chunks(hits, COOP.HIT_ROWS)) net.send('ehit', rows);
    hits = [];
    if (syncT <= 0 && pending > 0) {
      syncT = COOP.SYNC;
      const n = Math.min(pending, 100000);
      net.send('cpts', { n }); pending -= n;
    }
  }

  function info(): OnlineInfo {
    return { mode: 'coop', status: state ? `WAVE ${state.wave} · team score ${Math.max(state.score, gs.score)}` : '' };
  }

  function reset(): void {
    state = null; mySlot = 0; pending = 0; announced = 0; sent = ''; scoresDirty = false; resting = null;
    if (net.isHost && net.active) { net.accepting = true; net.busyReason = 'that lobby is closed'; }
    spawned.length = 0; shots = []; hits = [];
    // Solo and training enemies think for themselves.
    if (ctx.enemies !== null) ctx.enemies.mirror = false;
  }

  return { active, directing, players, get state() { return state; }, begin, slot, info, points, onKill, hurt, push, down, isDown, left, joined, update, reset };
}

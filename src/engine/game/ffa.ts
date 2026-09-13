import * as THREE from 'three';
import { choose, shuffle, round1, round2, clamp } from '../util';
import { RemotePlayer, encodeState } from '../players';
import { validKey } from '../level/index';
import { TONE } from '../render/index';
import { GUN_STATS } from '../weapons/stats';
import type { BoardRow } from '../hud/screens';
import type { HitInfo, PlayerHit, ScoreRow, Target } from '../types';
import type { PeerMeta } from '../net';
import type { App } from '../boot';

const KILL_TARGET = 20, TIME_LIMIT = 480, RESPAWN = 3.5, SILENT_MS = 9000;
const HOW: Record<string, string> = { r4c: 'R4-C', rifle: 'MP5', pistol: 'pistol', shotgun: 'shotgun', sniper: 'sniper', melee: 'knife', grenade: 'grenade', deflect: 'their own bullet' };

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const num = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const triple = (v: unknown, lim = 10000): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => num(n, lim));
const vec = (a: number[]): THREE.Vector3 => new THREE.Vector3().fromArray(a);
const cleanName = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 14) : '') || 'recruit';

export interface FfaApi {
  create(isPublic: boolean): Promise<void>;
  join(code: string): Promise<void>;
  quickPlay(): Promise<void>;
  hostStart(): void;
  leave(reason?: string): void;
  lobbyScreen(): void;
  broadcastLobby(): void;
  localDeath(): void;
  updateDying(dt: number): void;
  updateOver(dt: number): void;
  update(dt: number, t?: number): void;
  refreshScoreHud(): void;
  showBoard(on: boolean): void;
  boardRows(): BoardRow[];
  targets(): Target[];
  canHurt(t: Target): boolean;
  raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null;
  playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[];
  hitPlayer(t: RemotePlayer, damage: number, info?: HitInfo): void;
  cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean;
  onShot(end: THREE.Vector3): void;
}

export function createFFA(app: App): FfaApi {
  const { ctx, gs, lobby, scores } = app;
  const { net, hud } = ctx;
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), d3 = new THREE.Vector3();
  let tick = 0;
  let shotQueue: number[] = [];
  let boardShown = false;
  let timer: number | undefined = undefined;
  let hitId = 0;
  const pendingHeadshots = new Map<number, { target: string; source: string; until: number }>();

  const isOnline = (): boolean => gs.mode === 'ffa';
  const playing = (): boolean => gs.state === 'play' || gs.state === 'dying';
  const inMatch = (): boolean => net.active && (playing() || gs.state === 'over');
  const now = (): number => performance.now() / 1000;
  const spots = (): THREE.Vector3[] => ctx.level.arenaSpawns.length ? ctx.level.arenaSpawns : ctx.level.spawns;
  const rows = (): ScoreRow[] => [...scores].map(([rid, r]) => ({ id: rid, name: r.name, kills: r.kills, deaths: r.deaths }));
  const sorted = (): ScoreRow[] => rows().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const boardRows = (): BoardRow[] => rows().map(r => ({ ...r, self: r.id === net.id }));
  const nameOf = (rid: string): string | undefined => scores.get(rid)?.name ?? lobby.players.get(rid) ?? ctx.remotes.get(rid)?.name;

  // ---- remotes
  function addRemote(rid: string, name: string): RemotePlayer {
    let r = ctx.remotes.get(rid);
    if (r) { r.name = name; return r; }
    r = new RemotePlayer(ctx, rid, name, 0, TONE.HOSTILE);
    r.onDamage = (amount, from) => {
      if (!canHurt(r) || !r.alive) return;
      hud.hitmarker(false, false);
      net.sendTo(rid, 'pdmg', { amount: Math.round(amount), from: from ? from.toArray().map(round1) : null, by: net.id, src: 'grenade' });
    };
    ctx.remotes.set(rid, r);
    return r;
  }
  function removeRemote(rid: string): void {
    ctx.remotes.get(rid)?.dispose();
    ctx.remotes.delete(rid); lobby.players.delete(rid); scores.delete(rid);
  }

  // ---- scores
  function refreshScoreHud(): void {
    if (!isOnline()) return;
    hud.setPvpScore({ rows: boardRows(), selfId: net.id ?? '' });
    hud.setModifier('');
    if (boardShown) hud.setBoard({ rows: boardRows(), code: net.code ?? lobby.code ?? '' });
  }
  function showBoard(on: boolean): void {
    if (on === boardShown) return;
    boardShown = on;
    hud.setBoard(on ? { rows: boardRows(), code: net.code ?? lobby.code ?? '' } : null);
  }
  function applyScores(list: unknown[]): void {
    scores.clear();
    for (const r of list) {
      if (!obj(r) || !id(r.id) || !str(r.name, 14) || !int(r.kills) || !int(r.deaths)) continue;
      scores.set(r.id, { id: r.id, name: r.name, kills: r.kills, deaths: r.deaths });
    }
    refreshScoreHud();
  }
  function sendScores(): void { const list = rows(); net.send('score', list); applyScores(list); }
  function tally(victim: string, killer: string | null): void {
    if (!net.isHost) return;
    const v = scores.get(victim); if (v) v.deaths++;
    const k = killer && killer !== victim ? scores.get(killer) : null; if (k) k.kills++;
    sendScores(); checkWin();
  }
  function checkWin(): void {
    if (!net.isHost || !isOnline() || gs.over) return;
    let winner: { id: string; name: string } | null = null;
    for (const [rid, r] of scores) if (r.kills >= KILL_TARGET) winner = { id: rid, name: r.name };
    if (!winner) return;
    net.send('end', winner); endMatch(winner);
  }
  function endMatch(winner: { id: string; name: string }): void {
    gs.over = winner; gs.overT = 0; gs.state = 'over';
    app.endFocus(); ctx.input.exitLock(); showBoard(false);
    hud.setGameplayVisible(false); app.showScreen('over');
  }

  // ---- lobby
  const errMessage = (e: unknown): string | undefined => {
    const m = e instanceof Error ? e.message : undefined;
    return typeof m === 'string' ? m : undefined;
  };
  const friendly = (m: unknown): string => {
    if (typeof m !== 'string') return 'something went wrong';
    if (m.includes('networking library')) return 'could not load the networking library · check your connection and reload';
    if (m.includes('timed out') || m.includes('signalling')) return 'could not reach the matchmaking server · check your connection';
    if (m.includes('no lobby with that code')) return 'no lobby with that code · check it with your friend';
    if (m.includes('no answer')) return 'found the lobby but could not connect · one of you may be on a network that blocks it';
    if (m.includes('full')) return 'that lobby is full';
    return m;
  };
  const online = (status: string): void => { lobby.status = status; if (gs.state === 'start') app.showScreen('online'); };
  function enterLobby(isPublic: boolean): void {
    lobby.isPublic = isPublic; lobby.code = net.code; lobby.status = '';
    gs.state = 'lobby'; app.showScreen('lobby');
  }
  async function attempt(fn: () => Promise<void>): Promise<void> {
    if (app.busy) return;
    app.busy = true;
    try { await fn(); } catch (e: unknown) { online(friendly(errMessage(e))); }
    finally { app.busy = false; if (gs.state === 'start') app.showScreen('online'); }
  }
  const create = (isPublic: boolean): Promise<void> => attempt(async () => {
    online('opening a lobby…');
    await net.host({ isPublic });
    // Set on every live path; the guard is there for the type.
    const self = net.id;
    if (self === null) { online('something went wrong'); return; }
    lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(self, app.settings.name); lobby.hostId = self;
    enterLobby(isPublic);
  });
  const join = (code: string): Promise<void> => attempt(async () => {
    if (!code) { online('type the code your friend gave you'); return; }
    online('connecting…');
    await net.join(code, { name: app.settings.name });
    enterLobby(net.isPublic);
  });
  const quickPlay = (): Promise<void> => attempt(async () => {
    try {
      await net.quickJoin({ name: app.settings.name }, online);
      enterLobby(true);
    } catch (e: unknown) {
      if (!(errMessage(e) ?? '').includes('no open public')) throw e;
      online('no open lobbies · opening a public one for you…');
      await net.host({ isPublic: true });
      const self = net.id;
      if (self === null) { online('something went wrong'); return; }
      lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(self, app.settings.name); lobby.hostId = self;
      enterLobby(true);
    }
  });
  function broadcastLobby(): void {
    net.send('lobby', { players: [...lobby.players].map(([pid, name]) => ({ id: pid, name })), hostId: net.id, isPublic: lobby.isPublic, map: lobby.map ?? app.settings.mapKey });
    if (gs.state === 'lobby') app.showScreen('lobby');
  }
  function peerJoined(pid: string, meta: PeerMeta): void {
    const name = cleanName(meta?.name);
    lobby.players.set(pid, name); addRemote(pid, name); broadcastLobby();
    if (!inMatch()) return;
    if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    net.sendTo(pid, 'start', { late: true, spawn: farthestIndex(), map: lobby.map ?? app.settings.mapKey, broken: ctx.level.breakables.filter(b => !b.alive).map(b => b.id) });
    sendScores(); hud.kill(`${name} joined`);
  }
  function peerLeft(pid: string): void {
    const name = nameOf(pid) ?? 'someone';
    removeRemote(pid); broadcastLobby();
    if (inMatch()) { hud.kill(`${name} left`); sendScores(); }
  }
  function leave(reason = ''): void {
    window.clearTimeout(timer);
    pendingHeadshots.clear();
    net.leave();
    for (const rid of [...ctx.remotes.keys()]) removeRemote(rid);
    lobby.players.clear(); scores.clear(); showBoard(false);
    if (gs.state !== 'start') {
      gs.state = 'start'; gs.mode = 'solo'; app.loadLevel(false); app.resetRun(); hud.setGameplayVisible(false);
    }
    gs.menu = false; lobby.status = reason; app.showScreen('online');
  }
  function lobbyScreen(): void {
    app.loadLevel(true, lobby.map ?? app.settings.mapKey); app.resetRun();
    gs.state = 'lobby'; gs.over = null; gs.menu = false;
    hud.setGameplayVisible(false); showBoard(false); app.showScreen('lobby');
  }

  // ---- match
  function arenaSpawn(): THREE.Vector3 {
    const list = spots().map(p => {
      let d = 999;
      for (const r of ctx.remotes.values()) if (r.alive && r.visible) d = Math.min(d, p.distanceTo(r.body.pos));
      return { p, d };
    }).sort((a, b) => b.d - a.d);
    return (choose(list.slice(0, 3))?.p ?? ctx.level.playerStart).clone();
  }
  function farthestIndex(): number {
    const player = ctx.player;
    const bodies = player === null ? [] : [player.body.pos, ...[...ctx.remotes.values()].filter(r => r.alive).map(r => r.body.pos)];
    let best = 0, bestD = -1;
    spots().forEach((p, i) => {
      const d = bodies.reduce((m, b) => Math.min(m, p.distanceTo(b)), 999);
      if (d > bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function hostStart(): void {
    if (!net.isHost) return;
    scores.clear();
    for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const map = lobby.map ?? app.settings.mapKey;
    app.loadLevel(true, map);
    const order = shuffle([...spots().keys()]);
    const spawns: Record<string, number> = {};
    let i = 0;
    for (const pid of lobby.players.keys()) spawns[pid] = order.length ? order[i++ % order.length] ?? 0 : 0;
    net.send('start', { spawns, map });
    const self = net.id;
    startMatch(false, self === null ? null : spawns[self] ?? null); sendScores();
  }
  function startMatch(late: boolean, index: number | null): void {
    gs.mode = 'ffa'; app.loadLevel(true, lobby.map ?? app.settings.mapKey); app.resetRun();
    if (!scores.size) for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const player = ctx.player;
    if (player === null) return;
    const spot = typeof index === 'number' && Number.isInteger(index) ? spots()[index] ?? null : null;
    player.reset(spot ? spot.clone() : arenaSpawn());
    app.beginCommon(); gs.state = 'play';
    refreshScoreHud();
    hud.message('FREE FOR ALL', late ? 'you joined a match in progress' : 'first to 20 · everyone is fair game', 3);
    hud.tip(`hold ${hud.key('score')} for the scoreboard`, 5);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (gs.state === 'play' && !ctx.input.locked && !ctx.input.usingGamepad) { gs.menu = true; app.showScreen('matchOn'); }
    }, 250);
  }
  function localDeath(): void {
    const p = ctx.player;
    if (p === null) return;
    const killer = p.lastHitBy ?? null, h = p.lastHit;
    const dir = h?.from == null ? null : d1.subVectors(p.center, h.from).normalize().toArray().map(round2);
    const src = h?.src;
    const how = killer && src !== undefined ? HOW[src] ?? null : null;
    net.broadcast('pdead', { killer, dir, over: !!h && (h.crit || h.amount >= 90 || h.src === 'melee'), how, crit: !!h?.crit });
    gs.respawnT = RESPAWN; gs.state = 'dying'; gs.deathT = 0;
    if (net.isHost && net.id !== null) tally(net.id, killer);
    const row = killer ? scores.get(killer) : null;
    hud.kill(row ? `eliminated by ${row.name}${how ? ` · ${how}${h?.crit ? ' headshot' : ''}` : ''}` : 'eliminated');
  }
  function updateDying(dt: number): void {
    const before = Math.ceil(gs.respawnT);
    gs.respawnT -= dt;
    const left = Math.ceil(gs.respawnT);
    if (left !== before || gs.deathT <= dt) hud.message(left > 0 ? String(left) : 'GO', left > 0 ? 'respawning in' : '', 1.1);
    if (gs.respawnT <= 0) respawn();
  }
  function respawn(): void {
    const p = ctx.player;
    if (p === null) return;
    p.reset(arenaSpawn()); p.name = app.settings.name; p.lastHitBy = p.lastHit = null;
    gs.state = 'play'; p.shieldT = 2;
    hud.tip('spawn protection · 2s', 1.6);
    ctx.effects.strokeBurst(p.center, TONE.PRIMARY, 24, 6, { life: 0.5, size: 0.03 });
    ctx.audio.spawn(p.center);
  }
  function updateOver(dt: number): void {
    gs.overT += dt;
    if (net.isHost && gs.overT > 8) { net.send('backtolobby', {}); lobbyScreen(); }
  }

  // ---- network update (real dt, now in seconds)
  function update(dt: number, t: number = now()): void {
    if (!net.active) return;
    for (const [id, hit] of pendingHeadshots) if (hit.until < t) pendingHeadshots.delete(id);
    tick++;
    for (const r of ctx.remotes.values()) r.update(dt, t);
    if (inMatch()) {
      for (const [rid, r] of [...ctx.remotes]) {
        if (!(r.lastSeen > 0) || t * 1000 - r.lastSeen <= SILENT_MS) continue;
        if (!net.isHost && rid === net.hostId) { leave('lost connection to the host'); return; }
        const name = r.name;
        removeRemote(rid); hud.kill(`${name} lost connection`);
        if (net.isHost) { net.close(rid); net.send('leave', { id: rid }); broadcastLobby(); sendScores(); }
      }
    }
    if (tick % 3 === 0 && inMatch()) {
      const player = ctx.player;
      if (player !== null) net.broadcast('ps', encodeState(player));
    }
    if (shotQueue.length) {
      const player = ctx.player;
      if (player !== null) { net.broadcast('shots', { k: player.weapon.kind, e: shotQueue }); shotQueue = []; }
    }
    if (net.isHost && inMatch() && !gs.over) {
      gs.matchT += dt;
      if (gs.matchT > TIME_LIMIT) {
        const top = sorted()[0], winner = top ? { id: top.id, name: top.name } : { id: net.id ?? 'host', name: ctx.player?.name ?? 'host' };
        net.send('end', winner); endMatch(winner);
      }
    }
  }

  // ---- PvP hooks
  const targets = (): Target[] => {
    const player = ctx.player;
    return player === null ? [] : [player, ...ctx.remotes.values()];
  };
  const canHurt = (t: Target): boolean => isOnline() && t !== ctx.player;
  const guardRay = new THREE.Ray(), guardSphere = new THREE.Sphere(undefined, 0.42), guardHit = new THREE.Vector3();
  function raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null {
    let best: PlayerHit | null = null;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !canHurt(r)) continue;
      const hit = r.raycast(o, d, best ? best.dist : max);
      if (hit && (!best || hit.dist < best.dist)) best = { player: r, ...hit };
      if (r.blocking) {
        guardSphere.center.copy(r.center).addScaledVector(r.forward, 0.5); guardSphere.center.y += 0.3;
        guardRay.set(o, d);
        if (guardRay.intersectSphere(guardSphere, guardHit)) {
          const dist = guardHit.distanceTo(o);
          if (dist <= max && (!best || dist < best.dist)) best = { player: r, part: 'blade', dist, point: guardHit.clone() };
        }
      }
    }
    return best;
  }
  function playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[] {
    return [...ctx.remotes.values()].filter(r => {
      if (!r.alive || !canHurt(r)) return false;
      d1.subVectors(r.center, pos); const dist = d1.length();
      return dist <= range + 0.3 && (dist <= 0.3 || d1.dot(dir) / dist >= cosHalf) && ctx.world.lineOfSight(pos, r.center);
    });
  }
  function hitPlayer(t: RemotePlayer, damage: number, info: HitInfo = {}): void {
    if (!canHurt(t) || !t.alive || !Number.isFinite(damage) || damage <= 0) return;
    const p = ctx.player;
    if (p === null) return;
    const point = info.point ?? t.center;
    if (info.part === 'blade') {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 8, 6, { life: 0.22, size: 0.035 });
      ctx.audio.shieldHit(t.center); hud.hitmarker(false, false, true);
      const ret = Math.random() < 0.4;
      if (ret) {
        ctx.effects.tracer(point, p.eye, TONE.HOSTILE, 0.03, 0.08);
        hud.tip('RETURNED', 0.9); ctx.input.rumble(0.5, 0.4, 90);
        p.lastHitBy = t.id; p.lastHit = { from: t.center.clone(), crit: false, amount: 0.6 * damage, src: 'deflect' };
        p.takeDamage(0.6 * damage, t.center);
      } else hud.tip('DEFLECTED', 0.7);
      net.sendTo(t.id, 'parry', { ret, by: net.id });
      return;
    }
    const facing = t.blocking ? d1.subVectors(p.center, t.center).normalize().dot(t.forward) : -1;
    const frontHit = /^(head|torso|arm|fore)/.test(info.part ?? '');
    if (facing > 0.6 && frontHit && info.source === 'melee' && t.parryWindow) {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 10, 6, { life: 0.25, size: 0.04 });
      ctx.audio.shieldHit(t.center); hud.hitmarker(false, false, true); ctx.game.hitstop(0.08, 0.15);
      p.melee.cooldown = Math.max(p.melee.cooldown, 0.6);
      ctx.input.rumble(0.6, 0.3, 90); hud.tip('PARRIED', 0.9);
      return;
    }
    ctx.effects.blood(point, info.dir ?? d1.subVectors(t.center, p.eye).normalize(), clamp(0.4 + damage / 80, 0.4, 1.6), { tone: TONE.HOSTILE });
    hud.hitmarker(false, !!info.crit); ctx.audio.hitEnemy(t.center); t.flash();
    const source = info.source ?? 'rifle';
    const shotId = ++hitId;
    if (info.crit && info.part === 'head' && Object.hasOwn(GUN_STATS, source)) {
      if (pendingHeadshots.size >= 64) pendingHeadshots.clear();
      pendingHeadshots.set(shotId, { target: t.id, source, until: now() + 1 });
    }
    net.sendTo(t.id, 'pdmg', { amount: Math.round(damage), from: p.center.toArray().map(round1), by: net.id,
      crit: !!info.crit, src: source, hitId: shotId });
  }
  function cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean {
    let any = false;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !r.grappling) continue;
      d2.copy(r.body.pos).addScaledVector(r.right, 0.35); d2.y += 1.25;
      for (let i = 0; i < 15; i++) {
        d3.lerpVectors(d2, r.hook, i / 14).sub(eye);
        const t = d3.dot(dir);
        if (t < 0.3 || t > range || Math.sqrt(Math.max(0, d3.lengthSq() - t * t)) > 0.9) continue;
        d3.add(eye);
        ctx.effects.strokeBurst(d3, TONE.ACCENT, 10, 5, { life: 0.25, size: 0.035 });
        net.sendTo(r.id, 'cut', {}); hud.tip('ROPE CUT', 0.9); any = true;
        break;
      }
    }
    return any;
  }
  function onShot(end: THREE.Vector3): void {
    if (net.active && inMatch()) shotQueue.push(round1(end.x), round1(end.y), round1(end.z));
  }

  // ---- message handlers
  const fromHost = (from: string): boolean => !net.isHost && from === net.hostId;
  const roster = (from: string): boolean => lobby.players.has(from) && from !== net.id;
  net.on('refused', d => leave(obj(d) && str(d.reason, 256) ? d.reason : ''));
  net.on('lobby', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { players, hostId, isPublic } = d;
    if (!arr(players) || players.length > 8 || typeof hostId !== 'string' || hostId !== net.hostId || typeof isPublic !== 'boolean') return;
    const ids: unknown[] = [];
    for (const p of players) {
      if (!obj(p) || !id(p.id) || !str(p.name, 14)) return;
      ids.push(p.id);
    }
    if (new Set(ids).size !== players.length) return;
    lobby.hostId = hostId; lobby.isPublic = isPublic; lobby.code = net.code;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    lobby.players.clear();
    for (const p of players) {
      if (!obj(p) || !id(p.id)) continue;
      const nm = cleanName(p.name);
      lobby.players.set(p.id, nm); if (p.id !== net.id) addRemote(p.id, nm);
    }
    for (const rid of [...ctx.remotes.keys()]) if (!lobby.players.has(rid)) removeRemote(rid);
    if (inMatch()) {
      for (const [pid, name] of lobby.players) if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
      refreshScoreHud();
    }
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('leave', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const gone = d.id;
    if (!id(gone) || !lobby.players.has(gone)) return;
    const name = nameOf(gone) ?? 'someone';
    removeRemote(gone);
    if (inMatch()) hud.kill(`${name} left`);
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('startreq', (d, from) => { if (net.isHost && lobby.players.has(from) && gs.state === 'lobby') hostStart(); });
  net.on('start', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    let index: unknown = null;
    if (obj(d.spawns)) {
      const self = net.id;
      index = self === null ? undefined : d.spawns[self];
    } else if (d.spawn !== undefined) index = d.spawn;
    if (index !== null && index !== undefined && !int(index)) return;
    const broken = d.broken;
    if (arr(broken) && (broken.length > 4096 || !broken.every(int))) return;
    startMatch(d.late === true, int(index) ? index : null);
    // ponytail: the original `for (const bid of d.broken ?? [])` threw on a
    // non-array `broken`; net.ts already rejects those, and §9.10 says drop, never throw.
    if (arr(broken)) {
      for (const bid of broken) {
        if (!int(bid)) continue;
        app.breakables.breakProp(ctx.level.breakables[bid], null, false, true);
      }
    }
  });
  net.on('end', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { id: winnerId, name } = d;
    if (!id(winnerId) || !str(name, 14) || !scores.has(winnerId)) return;
    endMatch({ id: winnerId, name });
  });
  net.on('backtolobby', (d, from) => { if (fromHost(from)) lobbyScreen(); });
  net.on('score', (d, from) => {
    if (!fromHost(from) || !arr(d) || d.length > 8) return;
    if (!d.every(r => obj(r) && id(r.id) && str(r.name, 14) && int(r.kills) && int(r.deaths))) return;
    applyScores(d);
  });
  net.on('pickup', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { id: pickupId, kind, pos } = d;
    if (!int(pickupId) || pickupId < 1) return;
    if (kind !== 'ammo' && kind !== 'health') return;
    if (!triple(pos)) return;
    app.pickups.spawn(kind, vec(pos), pickupId);
  });
  net.on('taken', (d, from) => { if (fromHost(from) && obj(d) && int(d.id)) app.pickups.remove(d.id); });
  net.on('take', (d, from) => {
    if (!net.isHost || !roster(from) || !obj(d) || !int(d.id)) return;
    if (app.pickups.remove(d.id)) net.send('taken', { id: d.id });
  });
  net.on('ps', (d, from) => {
    const r = ctx.remotes.get(from);
    if (r !== undefined && from !== net.id) r.push(d, now());
  });
  net.on('pdmg', (d, from) => {
    const p = ctx.player;
    if (p === null || !p.alive || gs.state !== 'play' || p.shieldT > 0 || !roster(from) || !obj(d) || d.by !== from) return;
    const { amount, from: fromPos, src, crit } = d;
    if (typeof amount !== 'number' || !(amount > 0 && amount <= 100000)) return;
    if (!(fromPos === null || triple(fromPos))) return;
    if (!str(src, 32) || typeof crit !== 'boolean') return;
    const pos = fromPos === null ? null : vec(fromPos);
    p.lastHitBy = from; p.lastHit = { from: pos, crit, amount, src };
    p.takeDamage(amount, pos);
    if (crit && int(d.hitId)) net.sendTo(from, 'headshot', { hitId: d.hitId });
  });
  net.on('headshot', (d, from) => {
    if (!roster(from) || !obj(d) || !int(d.hitId) || gs.state !== 'play') return;
    const hit = pendingHeadshots.get(d.hitId);
    if (!hit || hit.target !== from || hit.until < now()) return;
    pendingHeadshots.delete(d.hitId);
    ctx.player?.onHeadshot({ part: 'head', crit: true, source: hit.source });
  });
  net.on('pdead', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    const { killer, dir, over, how, crit } = d;
    if (!(killer === null || id(killer)) || !(dir === null || triple(dir, 1)) || typeof over !== 'boolean' || typeof crit !== 'boolean' || !(how === null || str(how, 64))) return;
    const r = ctx.remotes.get(from), victim = r?.name ?? 'someone';
    const killerId = killer !== null && scores.has(killer) ? killer : null;
    if (r) { r.ragdoll(dir, over); ctx.audio.enemyDie(r.center); }
    const howText = how ? ` · ${how}${crit ? ' headshot' : ''}` : '';
    if (killerId === net.id) { gs.kills++; hud.hitmarker(true, crit); app.addScore(100, `ELIMINATED ${victim}${howText}`); ctx.audio.kill(true); }
    else {
      const killerName = killerId === null ? null : scores.get(killerId)?.name ?? null;
      hud.kill(killerName ? `${killerName} eliminated ${victim}${howText}` : `${victim} fell off the map`);
    }
    if (net.isHost) tally(from, killerId);
  });
  net.on('nade', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    const { pos, vel } = d;
    if (!triple(pos) || !triple(vel)) return;
    const p = ctx.player;
    if (p === null) return;
    p.throwGrenade({ pos, vel });
  });
  net.on('brk', (d, from) => {
    if (!roster(from) || !obj(d) || !int(d.id)) return;
    app.breakables.breakProp(ctx.level.breakables[d.id], null, false, false);
  });
  net.on('parry', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    const { by, ret } = d;
    if (by !== from || typeof ret !== 'boolean') return;
    const p = ctx.player;
    if (p === null) return;
    ctx.audio.shieldHit(p.center); ctx.input.rumble(0.35, 0.3, 60);
    ctx.effects.strokeBurst(d1.copy(p.eye).addScaledVector(p.forward, 0.5), TONE.ACCENT, 8, 5, { life: 0.2, size: 0.03 });
    hud.kill(ret ? 'RETURN TO SENDER' : 'DEFLECTED', ret ? 25 : 0);
  });
  net.on('shots', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    ctx.remotes.get(from)?.shots(d.k, d.e);
  });
  net.on('cut', (d, from) => {
    const p = ctx.player;
    if (p === null || !roster(from) || p.grapple.mode === 'idle') return;
    p.detachGrapple(false);
    ctx.effects.strokeBurst(p.center, TONE.ACCENT, 8, 4, { life: 0.25, size: 0.03 });
    hud.tip('your rope got cut', 1.3); ctx.input.rumble(0.5, 0.3, 80);
  });
  net.onPeerJoin = peerJoined;
  net.onPeerLeave = peerLeft;
  net.onDisconnect = () => leave('the host left the lobby');

  return {
    create, join, quickPlay, hostStart, leave, lobbyScreen, broadcastLobby,
    localDeath, updateDying, updateOver, update, refreshScoreHud, showBoard, boardRows,
    targets, canHurt, raycastPlayers, playersInArc, hitPlayer, cutRopes, onShot,
  };
}

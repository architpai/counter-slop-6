import { afterEach, expect, test, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { World, Body } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';
import { EnemyManager } from '@/engine/enemies/index';
import { createFFA } from '@/engine/game/ffa';
import { createCoop } from '@/engine/game/coop';
import { createSolo } from '@/engine/game/solo';
import { createPickups } from '@/engine/game/pickups';
import { makeGameState } from '@/engine/game/state';
import { NET, ROUTES, publicCode, validEnvelope } from '@/engine/net';
import { COOP, coopScale, freshCoopState, playerCap, validCoopState } from '@/engine/game/coop-rules';
import { isOnlineMode, isTeamMode } from '@/engine/game/team-rules';
import type { App } from '@/engine/boot';
import type { Ctx, Level } from '@/engine/types';

const noop = () => {};
type Handler = (data: unknown, from: string) => void;
interface Mail { to: string; type: string; data: unknown; from: string }

/**
 * An in-memory star network with the routing rules of `Net`: host-only types
 * leave only the host, requests reach only the host, relayed broadcasts reach
 * every other peer. Each envelope passes the real `validEnvelope` and a JSON
 * round trip, so a payload the wire would drop is dropped here and recorded.
 */
function makeHub() {
  const nets = new Map<string, ReturnType<typeof join>>();
  const queue: Mail[] = [], dropped: string[] = [];
  const post = (envelope: Record<string, unknown>, mail: Omit<Mail, 'data'>, data: unknown): void => {
    if (!validEnvelope(envelope)) { dropped.push(mail.type); return; }
    queue.push({ ...mail, data: JSON.parse(JSON.stringify(data)) as unknown });
  };
  function join(id: string, isHost: boolean) {
    const handlers = new Map<string, Handler>();
    const net = {
      id, isHost, hostId: 'host', active: true, code: 'ABCDE', isPublic: false, accepting: true,
      maxPlayers: NET.MAX_PLAYERS, busyReason: 'that lobby is closed', handlers,
      on: (type: string, fn: Handler) => { handlers.set(type, fn); },
      send(type: string, data: unknown, relay = false): void {
        if (ROUTES.ADDRESSED.has(type)) { dropped.push(type); return; }
        if (isHost) {
          if (!ROUTES.HOST.has(type) && !ROUTES.BROADCAST.has(type)) { dropped.push(type); return; }
          for (const to of nets.keys()) if (to !== id) post({ t: type, d: data, from: id }, { to, type, from: id }, data);
        } else if (ROUTES.REQUEST.has(type) && !relay) post({ t: type, d: data, relay }, { to: 'host', type, from: id }, data);
        else if (ROUTES.BROADCAST.has(type) && relay) {
          for (const to of nets.keys()) if (to !== id) post({ t: type, d: data, relay }, { to, type, from: id }, data);
        } else dropped.push(type);
      },
      broadcast(type: string, data: unknown): void { this.send(type, data, true); },
      sendTo(to: string, type: string, data: unknown): void {
        if (to === id || !(isHost ? ROUTES.HOST.has(type) || ROUTES.BROADCAST.has(type) || ROUTES.ADDRESSED.has(type) : ROUTES.ADDRESSED.has(type))) { dropped.push(type); return; }
        post(isHost ? { t: type, d: data, from: id } : { t: type, d: data, to, from: id }, { to, type, from: id }, data);
      },
      close: noop,
      leave() { this.active = false; nets.delete(id); },
      onPeerJoin: null as unknown, onPeerLeave: null as unknown, onDisconnect: null as unknown,
    };
    nets.set(id, net);
    return net;
  }
  /** Deliver until quiet. Returns the types delivered, in order. */
  function flush(): string[] {
    const seen: string[] = [];
    for (let i = 0; i < 10000 && queue.length; i++) {
      const mail = queue.shift()!, target = nets.get(mail.to);
      if (!target?.active) continue;
      // A client accepts host-only types from the host alone, as `Net.#receive` does.
      if (ROUTES.HOST.has(mail.type) && mail.from !== 'host') { dropped.push(mail.type); continue; }
      seen.push(mail.type);
      target.handlers.get(mail.type)?.(mail.data, mail.from);
    }
    return seen;
  }
  return { join, flush, dropped, queue };
}

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });

/** A flat 80 m yard: solo spawns on two sides, the player start in the south. */
function yard() {
  const world = new World();
  world.addBox(new Vector3(-40, -1, -40), new Vector3(40, 0, 40)); world.finalize();
  const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, nav = new NavGrid(world, bounds); nav.build();
  return { world, nav, bounds };
}

function makePeer(hub: ReturnType<typeof makeHub>, id: string, ids: string[], land: ReturnType<typeof yard>) {
  const isHost = id === 'host';
  const net = hub.join(id, isHost), scene = new Scene();
  const gs = { ...makeGameState(), state: 'lobby' as const, mode: 'ffa' as const };
  const screens: string[] = [], loads: boolean[] = [], damage: number[] = [];
  const body = new Body(new Vector3(0, 0, 15), 0.35, 1.75); body.onGround = true;
  const player = {
    name: id, alive: true, hp: 120, maxHp: 120, shieldT: 0, team: 0, dashLock: false, isLocal: true, body,
    get center() { return body.pos.clone().add(new Vector3(0, 1, 0)); }, get eye() { return body.pos.clone().add(new Vector3(0, 1.6, 0)); },
    forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), yaw: 0, pitch: 0, wi: 0, weapon: { kind: 'rifle' }, weapons: [],
    grapple: { mode: 'idle', hook: new Vector3() }, melee: { active: false, cooldown: 0, addBlood: noop },
    speed: 0, aiming: false, firing: false, blockRadius: 0, crouching: false, sliding: false, blocking: false, parryWindow: false,
    nades: [], grenades: 1, maxGrenades: 5, lastHitBy: null as string | null, lastHit: null as unknown,
    onHeadshot: vi.fn(), tryDeflect: () => false as const, tryBlockMelee: () => false, detachGrapple: noop, throwGrenade: noop, clearNades: noop,
    knocks: [] as Vector3[], knockback(dir: Vector3, amount: number) { this.knocks.push(dir.clone().multiplyScalar(amount)); },
    reset(pos: Vector3) { body.pos.copy(pos); this.alive = true; this.hp = this.maxHp; },
    heal(amount: number) { const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + amount); return this.hp - before; },
    takeDamage(amount: number) {
      if (!this.alive) return;
      damage.push(amount); this.hp = Math.max(0, this.hp - amount);
      if (this.hp <= 0) { this.alive = false; app.ffa.localDeath(); }
    },
  };
  const remotes = new Map(ids.filter(other => other !== id).map(other => {
    const pos = new Vector3(4, 0, 15);
    const remote = {
      id: other, name: other, alive: true, visible: true, lastSeen: 0, team: 0, isLocal: false, speed: 0, aiming: false, firing: false,
      blockRadius: 0, blocking: false, parryWindow: false, grappling: false, hits: [], _b: null,
      body: { pos, vel: new Vector3(), halfW: 0.35, height: 1.75, onGround: true },
      get center() { return pos.clone().add(new Vector3(0, 1, 0)); }, get eye() { return pos.clone().add(new Vector3(0, 1.6, 0)); },
      forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
      onDamage: null as ((amount: number, from: Vector3 | null) => void) | null,
      onKnock: null as ((dir: Vector3, amount: number) => void) | null,
      takeDamage(amount: number, from: Vector3 | null = null) { this.onDamage?.(amount, from); },
      knockback(dir: Vector3, amount: number) { this.onKnock?.(dir, amount); },
      tryDeflect: () => false as const, tryBlockMelee: () => false,
      setTeam(team: number) { this.team = team; }, update: noop, shots: noop, flash: noop, dispose: noop,
      push(data: number[]) { pos.fromArray(data); this.alive = !!((data[6] ?? 0) & 64); },
      ragdoll() { this.alive = false; }, raycast: () => null,
    };
    return [other, remote] as const;
  }));
  const level: Level = { key: 'downtown', arena: false, playerStart: new Vector3(0, 0, 15), bounds: land.bounds,
    spawns: [new Vector3(30, 0, -20), new Vector3(-30, 0, -20), new Vector3(0, 0, -34)], snipers: [new Vector3(30, 0, -30)],
    pickups: [new Vector3(5, 0, 5)], rings: [], movers: [], animated: [], breakables: [], meshes: [], surfaces: [], dressing: null,
    arenaSpawns: [], teamSpawns: [], shadow: { center: new Vector3(), radius: 40 } };
  const hud = {
    kill: vi.fn(), message: vi.fn(), tip: noop, hitmarker: vi.fn(), setBoss: noop, setModifier: vi.fn(), setWave: vi.fn(), setTimer: vi.fn(),
    setScore: noop, setPvpScore: vi.fn(), setBoard: noop, setGameplayVisible: noop, hideScreen: noop, setFocusMark: noop, key: () => 'F',
  };
  const ctx = {
    world: land.world, scene, nav: land.nav, bossNav: land.nav, level, player, remotes, net, hud,
    camera: new PerspectiveCamera(), renderer: { rig: new Group() },
    game: {
      targets: () => app.ffa.targets(), canHurt: (t: unknown) => app.ffa.canHurt(t as never), get mode() { return gs.mode; },
      get state() { return gs.state; }, isOnline: () => true, playing: () => (gs.state as string) === 'play' || (gs.state as string) === 'dying',
      hitstop: noop, breakHit: noop, blastBreakables: noop,
      addScore: (points: number) => { gs.score += points; app.coop.points(points); },
    },
    effects: new Proxy({ shake: 0, realistic: null }, { get: (target, key) => key in target ? target[key as keyof typeof target] : noop }),
    audio: new Proxy({}, { get: () => noop }),
    input: { rumble: noop, pressed: () => false, down: () => false, locked: true, usingGamepad: true, usingTouch: false, exitLock: noop, requestLock: noop },
  } as unknown as Ctx;
  const enemies = ctx.enemies = new EnemyManager(ctx);
  const lobby = { mode: 'coop' as const, teams: {}, players: new Map(ids.map(pid => [pid, pid])), hostId: 'host', code: 'ABCDE', isPublic: false, status: '', map: 'downtown' };
  const settings = { name: id, mapKey: 'downtown', startWave: 1, checkpoint: 0 };
  const app = {
    ctx, gs, lobby, scores: new Map(), settings, busy: false, screen: null,
    breakables: { breakProp: noop }, saveCheckpoint: vi.fn((n: number) => { settings.checkpoint = n; }),
    loadLevel: (arena: boolean) => { loads.push(arena); },
    resetRun() {
      enemies.clear(); enemies.mirror = false; app.pickups.clear(); player.reset(level.playerStart);
      gs.score = gs.kills = gs.combo = gs.wave = gs.intermission = gs.spawnT = 0; gs.queue.length = 0; gs.over = null; gs.teamMatch = null;
    },
    beginCommon: noop, showScreen: (kind: string) => { screens.push(kind); }, endFocus: noop,
  } as unknown as App;
  app.addScore = ctx.game.addScore;
  app.pickups = createPickups(ctx);
  app.solo = createSolo(app);
  app.ffa = createFFA(app);
  app.coop = createCoop(app);
  enemies.onKill = app.solo.onKill; enemies.onBoss = app.solo.onBoss;
  cleanups.push(() => { app.ffa.dispose(); enemies.clear(); app.pickups.clear(); });
  return { id, app, ctx, gs, net, lobby, enemies, player, remotes, hud, screens, loads, damage, settings };
}

/** A lobby of `count` peers, the first of them the host. */
function party(count = 2) {
  const hub = makeHub(), land = yard(), ids = ['host', 'ann', 'bob', 'cat'].slice(0, count);
  const peers = ids.map(id => makePeer(hub, id, ids, land));
  let time = 100;
  /** One frame on every peer, the way `boot` steps a live match, then the mail. */
  const tick = (dt = 0.05): void => {
    time += dt;
    for (const p of peers) {
      if (!p.net.active) continue;
      p.enemies.update(dt); p.app.pickups.update(dt); p.app.ffa.update(dt, time);
      if (p.app.coop.directing()) p.app.solo.update(dt);
      if ((p.gs.state as string) === 'dying') p.app.ffa.updateDying(dt);
    }
    hub.flush();
  };
  const run = (seconds: number, dt = 0.05): void => { for (let t = 0; t < seconds; t += dt) tick(dt); };
  const start = (): void => { peers[0]!.app.ffa.hostStart(); hub.flush(); };
  return { hub, peers, host: peers[0]!, ann: peers[1]!, tick, run, start };
}

// ---------------------------------------------------------------- rules

test('the wave scale equals solo for one player and grows to the four-player values', () => {
  expect(coopScale(1)).toEqual({ count: 1, alive: 0, interval: 1, bossHp: 1, pickups: 0 });
  expect(coopScale(2)).toEqual({ count: 1.5, alive: 3, interval: 1.25, bossHp: 1.6, pickups: 3 });
  expect(coopScale(4)).toEqual({ count: 2.5, alive: 9, interval: 1.75, bossHp: 1 + 0.6 * 3, pickups: 9 });
  for (const odd of [0, -3, Number.NaN, 9, 1.9]) expect(coopScale(odd).count).toBeLessThanOrEqual(2.5);
  expect(coopScale(0)).toEqual(coopScale(1));
  expect(coopScale(9)).toEqual(coopScale(4));
});

test('co-op is an online mode with its own discovery slots, a four-player lobby and no teams', () => {
  expect(isOnlineMode('coop')).toBe(true);
  expect(isTeamMode('coop')).toBe(false);
  expect(publicCode('coop', 3)).toBe('COP3');
  expect(playerCap('coop')).toBe(COOP.MAX_PLAYERS);
  expect(playerCap('ffa')).toBe(NET.MAX_PLAYERS);
  expect(NET.PREFIX_LIVE).toContain('v3');
});

test('the co-op state is checked field by field before it is used', () => {
  const state = { ...freshCoopState(6), left: 12, dead: ['ann'], label: 'SWARM', sub: 'rush B' };
  expect(validCoopState(state)).toBe(true);
  expect(validEnvelope({ t: 'coop', d: state, from: 'host' })).toBe(true);
  expect(validEnvelope({ t: 'start', d: { map: 'downtown', mode: 'coop', spawns: { host: 0, ann: 1 }, coop: state }, from: 'host' })).toBe(true);
  expect(validEnvelope({ t: 'lobby', d: { hostId: 'host', players: [], isPublic: true, mode: 'coop', teams: {} }, from: 'host' })).toBe(true);
  for (const bad of [
    { ...state, wave: 0 }, { ...state, wave: 1.5 }, { ...state, left: -1 }, { ...state, inter: 61 }, { ...state, score: -1 },
    { ...state, dead: ['a', 'a'] }, { ...state, dead: ['a', 'b', 'c', 'd', 'e'] }, { ...state, dead: [7] }, { ...state, label: 'x'.repeat(97) },
    { ...state, speed: 0 }, { ...state, damage: Number.NaN }, { ...state, extra: 1 }, (({ sub: _sub, ...rest }) => rest)(state), null, [state],
  ]) {
    expect(validCoopState(bad), JSON.stringify(bad)).toBe(false);
    expect(validEnvelope({ t: 'coop', d: bad, from: 'host' })).toBe(false);
  }
});

// ---------------------------------------------------------------- start

test('a co-op start puts every peer on the solo layout at its own start slot, with no teams and no FFA rules', () => {
  const t = party(3), { host, ann } = t, bob = t.peers[2]!;
  host.settings.startWave = 1;
  t.start();
  for (const p of t.peers) {
    expect(p.gs.state, p.id).toBe('play');
    expect(p.gs.mode).toBe('ffa');
    expect(p.loads.at(-1), 'the solo layout, not the arena').toBe(false);
    expect(p.gs.teamMatch).toBeNull();
    expect(p.app.coop.active()).toBe(true);
    expect(p.app.coop.state?.wave).toBe(1);
    expect(p.hud.setPvpScore).toHaveBeenLastCalledWith(null);
  }
  expect(host.app.coop.directing()).toBe(true);
  expect(ann.app.coop.directing()).toBe(false);
  expect(host.player.body.pos.toArray()).toEqual([0, 0, 15]);
  expect(ann.player.body.pos.toArray()).toEqual([1.6, 0, 15]);
  expect(bob.player.body.pos.toArray()).toEqual([-1.6, 0, 15]);
  // Players are no opponents: no PvP damage path is open.
  expect(host.app.ffa.canHurt([...host.remotes.values()][0] as never)).toBe(false);
  // The FFA clock and kill target do not end a run.
  host.gs.matchT = 10000; host.app.scores.get('host')!.kills = 99;
  t.run(1);
  expect(host.gs.over).toBeNull();
  expect(t.hub.dropped).toEqual([]);
});

test('a co-op lobby refuses a start with more than four players', () => {
  const t = party(2), { host } = t;
  for (const extra of ['p3', 'p4', 'p5']) host.lobby.players.set(extra, extra);
  t.start();
  expect(host.gs.state).toBe('lobby');
  expect(host.lobby.status).toContain('4 players');
});

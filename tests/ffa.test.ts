import { expect, test, vi } from 'vitest';
import { Scene, Vector3, PerspectiveCamera, Group } from 'three';
import { createFFA } from '@/engine/game/ffa';
import { makeGameState } from '@/engine/game/state';
import type { App } from '@/engine/boot';
import type { GameState, GameStateName } from '@/engine/types';
import { createTeamMatch, assignTeams } from '@/engine/game/team-rules';
import type { OnlineMode, TeamMatch } from '@/engine/game/team-rules';
import { teamLayout } from '@/engine/game/team-world';

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
};
const noop = () => {};
/** Written through a call so TypeScript does not narrow `gs.state` past the
 *  writes `createFFA` makes behind its own closure. */
const setState = (gs: GameState, value: GameStateName): void => { gs.state = value; };

interface Sent { to?: string; type: string; data: unknown }
interface Damage { amount: number; from: Vector3 | null }
type Handler = (data: unknown, from: string) => void;

// Only the members `createFFA` reaches for. A real `App` needs WebGL, a peer
// connection and a built level.
function setup(isHost = false, mode: OnlineMode = 'ffa') {
  const handlers = new Map<string, Handler>();
  const sent: Sent[] = [], screens: string[] = [], damage: Damage[] = [], resets: Vector3[] = [];
  const id = isHost ? 'host' : 'client', other = isHost ? 'client' : 'host';
  const gs: GameState = { ...makeGameState(), state: 'lobby', mode: 'ffa' };
  const net = {
    active: true, isHost, id, hostId: 'host', code: 'ABCDE', isPublic: false,
    connections: new Map<string, unknown>(), on: (type: string, fn: Handler) => handlers.set(type, fn),
    send: (type: string, data: unknown) => sent.push({ type, data }),
    broadcast: (type: string, data: unknown) => sent.push({ type, data }),
    sendTo: (to: string, type: string, data: unknown) => sent.push({ to, type, data }),
    close: noop,
    leave() { this.active = false; },
    onPeerJoin: noop as unknown, onPeerLeave: noop as unknown, onDisconnect: noop as unknown,
  };
  const player = {
    name: id, alive: true, hp: 100, maxHp: 100, shieldT: 0, team: 0, dashLock: false,
    body: { pos: new Vector3(), vel: new Vector3(), onGround: true },
    center: new Vector3(0, 1, 0), eye: new Vector3(0, 1.6, 0),
    forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
    yaw: 0, pitch: 0, wi: 0, weapon: { kind: 'rifle' }, weapons: [],
    grapple: { mode: 'idle', hook: new Vector3() }, melee: { active: false, cooldown: 0 },
    headshots: 0, onHeadshot() { this.headshots++; },
    lastHitBy: null as string | null, lastHit: null as { from: Vector3 | null; amount: number; crit: boolean; src: string } | null,
    reset(pos: Vector3) { resets.push(pos.clone()); this.body.pos.copy(pos); this.alive = true; this.hp = 100; },
    takeDamage(amount: number, from: Vector3 | null = null) { damage.push({ amount, from }); this.hp -= amount; },
    detachGrapple: vi.fn(), throwGrenade: vi.fn(), clearNades: noop,
  };
  const remote = {
    id: other, name: other, alive: true, visible: true, lastSeen: 0, team: 0,
    setTeam(team: number) { this.team = team; },
    body: { pos: new Vector3(20, 0, 0) }, center: new Vector3(20, 1, 0),
    forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), hits: [], blocking: false, parryWindow: false,
    raycast: (_o: Vector3, _d: Vector3, _max: number): { part: 'torso'; dist: number; point: Vector3 } | null => null,
    updates: 0, pushes: 0, disposed: false, _b: null as { p: Vector3 } | null,
    update() { this.updates++; }, push(data?: number[]) {
      this.pushes++;
      if (data?.length) { this.body.pos.fromArray(data); this._b = { p: this.body.pos.clone() }; this.alive = !!((data[6] ?? 0) & 64); }
    }, shots: noop,
    dispose() { this.disposed = true; },
    ragdoll() { this.alive = false; }, flash: noop,
  };
  const ctx = {
    net, player, scene: new Scene(), camera: new PerspectiveCamera(), renderer: { rig: new Group() }, remotes: new Map([[other, remote]]),
    level: {
      key: 'downtown', playerStart: new Vector3(0, 0, 42), bounds: { minX: -68, maxX: 68, minZ: -68, maxZ: 68 },
      arenaSpawns: [new Vector3(-10, 0, 3), new Vector3(10, 2, 8)],
      spawns: [new Vector3()], teamSpawns: [], breakables: [],
    },
    hud: {
      setPvpScore: noop, setModifier: noop, setBoard: noop, setGameplayVisible: noop, hideScreen: vi.fn(),
      message: vi.fn(), tip: noop, kill: vi.fn(), hitmarker: vi.fn(), key: (action: string) => action,
    },
    audio: { kill: noop, spawn: noop, enemyDie: noop, shieldHit: noop, hitEnemy: noop },
    effects: { strokeBurst: noop, blood: noop, tracer: noop, clear: noop },
    input: { locked: true, usingGamepad: true, exitLock: noop, requestLock: noop, rumble: noop },
    world: { lineOfSight: () => true, groundBelow: () => 0, raycast: () => null }, game: { hitstop: noop },
  };
  const lobby = {
    mode, teams: mode === 'ffa' ? {} : assignTeams(['host', 'client']),
    players: new Map([['host', 'Host'], ['client', 'Client']]),
    hostId: 'host', code: 'ABCDE', isPublic: false, status: '', map: 'downtown',
  };
  const scores = new Map([
    ['host', { id: 'host', name: 'Host', kills: 7, deaths: 2 }],
    ['client', { id: 'client', name: 'Client', kills: 3, deaths: 5 }],
  ]);
  const app = {
    ctx, gs, lobby, scores, settings: { name: id, mapKey: 'downtown' }, busy: false,
    pickups: { spawn: noop, remove: () => false, clear: noop }, breakables: { breakProp: noop },
    loadLevel(arena: boolean, key = 'downtown') { ctx.level.key = key; },
    resetRun() {
      player.reset(ctx.level.playerStart);
      player.lastHitBy = player.lastHit = null;
      gs.matchT = gs.respawnT = gs.deathT = gs.overT = 0; gs.over = null;
    },
    beginCommon: noop, showScreen: (kind: string) => screens.push(kind), endFocus: noop, addScore: noop,
  };
  const ffa = createFFA(app as unknown as App);
  return { app, ctx, gs, lobby, scores, ffa, remote, sent, screens, damage, resets,
    receive: (type: string, data: unknown, from = other) => handlers.get(type)?.(data, from) };
}

test.each([['rifle', 'MP5'], ['r4c', 'R4-C']])('a winning local death labels %s', (source, label) => {
  const t = setup(true), { gs, scores, ctx } = t;
  setState(gs, 'play'); must(scores.get('client'), 'client score').kills = 19;
  ctx.player.lastHitBy = 'client';
  ctx.player.lastHit = { from: new Vector3(3, 1, 0), amount: 100, crit: true, src: source };
  try {
    t.ffa.localDeath();
    expect(t.sent.find(m => m.type === 'pdead')?.data).toMatchObject({ how: label, crit: true });
    expect(ctx.hud.kill).toHaveBeenCalledWith(`eliminated by Client · ${label} headshot`);
    assert(must(scores.get('client'), 'client score').kills === 20 && must(scores.get('host'), 'host score').deaths === 3,
      'host death credits the killer and the victim once');
    assert(gs.state === 'over' && gs.over?.id === 'client',
      'a winning local death keeps the host in the match-over state');
    assert(t.sent.filter(m => m.type === 'end').length === 1,
      'host sends one match-end message after the winning death');
  } finally { t.ffa.leave(); }
});

test('joining a match already in progress', async () => {
  const t = setup(), { gs, scores, ctx } = t;
  try {
    await t.receive('start', { late: true, spawn: 1, map: 'downtown', broken: [] }, 'host');
    assert(gs.state === 'play' && gs.mode === 'ffa', 'late start enters the active match');
    assert(ctx.player.body.pos.equals(must(ctx.level.arenaSpawns[1], 'spawn')), 'late start uses the assigned spawn');
    assert(must(scores.get('host'), 'host score').kills === 7 && must(scores.get('client'), 'client score').deaths === 5,
      'late start preserves the received scores');
    assert(t.resets.length === 2, 'match start resets the run before the assigned spawn');
    ctx.player.body.pos.addScalar(1);
    assert(must(ctx.level.arenaSpawns[1], 'spawn').equals(new Vector3(10, 2, 8)),
      'player movement does not change the spawn point');
  } finally { t.ffa.leave(); }
});

test('a silent host times out', () => {
  const t = setup(), { gs, ctx, lobby, scores } = t;
  setState(gs, 'play'); t.remote.lastSeen = 1000;
  try {
    t.ffa.update(0.05, 11);
    assert(!ctx.net.active && gs.state === 'start' && gs.mode === 'solo',
      'a silent host ends the client session');
    assert(lobby.status === 'lost connection to the host' && t.screens.at(-1) === 'online',
      'host timeout gives the client a connection-loss message');
    assert(ctx.remotes.size === 0 && lobby.players.size === 0 && scores.size === 0 && t.remote.disposed,
      'host timeout clears match and remote records');
    assert(!t.sent.some(m => m.type === 'ps'), 'host timeout stops the network update before sending state');
  } finally { t.ffa.leave(); }
});

test('untrusted senders and network damage', async () => {
  const t = setup(), { gs, scores, ctx } = t;
  const hit = { amount: 19, from: [3, 1, 0], by: 'host', crit: false, src: 'rifle' };
  const snapshot = [0, 0, 0, 0, 0, 0, 80, 100, 0, 0, 0];
  try {
    await t.receive('start', { late: true, spawn: 1, map: 'downtown', broken: [] }, 'stranger');
    t.receive('score', [{ id: 'host', name: 'Host', kills: 20, deaths: 0 }], 'stranger');
    t.receive('end', { id: 'host', name: 'Host' }, 'stranger');
    assert(gs.state === 'lobby' && must(scores.get('host'), 'host score').kills === 7 && t.resets.length === 0,
      'nonhost commands cannot start or end a match or change scores');
    t.receive('pdmg', hit, 'host');
    assert(t.damage.length === 0, 'network damage is ignored in the lobby');
    setState(gs, 'play');
    t.receive('ps', snapshot, 'stranger');
    t.receive('ps', snapshot, 'client');
    assert(t.remote.pushes === 0 && ctx.remotes.size === 1,
      'state messages from unknown players or self do not create or update remotes');
    t.receive('pdmg', { ...hit, by: 'stranger' }, 'host');
    t.receive('pdmg', { ...hit, by: 'stranger' }, 'stranger');
    assert(t.damage.length === 0, 'damage requires a roster sender and matching by field');
    ctx.player.shieldT = 1;
    t.receive('pdmg', hit, 'host');
    assert(t.damage.length === 0, 'spawn protection blocks network damage');
    ctx.player.shieldT = 0;
    t.receive('pdmg', hit, 'host');
    assert(t.damage.length === 1 && must(t.damage[0], 'damage').amount === 19,
      'valid damage from a roster peer reaches an unprotected player');
    setState(gs, 'over');
    t.receive('pdmg', hit, 'host');
    assert(t.damage.length === 1, 'network damage is ignored after the match ends');
  } finally { t.ffa.leave(); }
});

test('a distant guard cannot replace a closer player hit', () => {
  const t = setup(); setState(t.gs, 'play');
  try {
    t.remote.raycast = () => ({ part: 'torso', dist: 4, point: new Vector3(0, 1.3, -4) });
    const far = { ...t.remote, id: 'far', blocking: true, center: new Vector3(0, 1, -10), forward: new Vector3(0, 0, 1),
      raycast: () => ({ part: 'torso' as const, dist: 10, point: new Vector3(0, 1.3, -10) }) };
    t.ctx.remotes.set('far', far);
    const ray = () => t.ffa.raycastPlayers(new Vector3(0, 1.3, 0), new Vector3(0, 0, -1), 20);
    expect(ray()?.player.id).toBe(t.remote.id);
    expect(ray()?.part).toBe('torso');
    t.ctx.remotes.delete(t.remote.id);
    expect(ray()?.player.id).toBe('far');
    expect(ray()?.part).toBe('blade');
  } finally { t.ffa.leave(); }
});

test('melee excludes remote players behind a wall', () => {
  const t = setup(); setState(t.gs, 'play');
  try {
    const eye = t.remote.center.clone().add(new Vector3(0, 0, 2));
    const arc = () => t.ffa.playersInArc(eye, new Vector3(0, 0, -1), 2.1, Math.cos(0.8));
    expect(arc()).toEqual([t.remote]);
    t.ctx.world.lineOfSight = () => false;
    expect(arc()).toEqual([]);
  } finally { t.ffa.leave(); }
});

test('PvP feedback distinguishes guards, headshots and confirmed local kills', () => {
  const t = setup(); setState(t.gs, 'play');
  const marker = t.ctx.hud.hitmarker;
  try {
    const remote = t.remote as unknown as Parameters<typeof t.ffa.hitPlayer>[0];
    t.ffa.hitPlayer(remote, 20, { source: 'rifle', part: 'blade' });
    expect(marker).toHaveBeenLastCalledWith(false, false, true);
    expect(t.sent.some(m => m.type === 'pdmg')).toBe(false);
    t.ffa.hitPlayer(remote, 20, { source: 'rifle', part: 'head', crit: true });
    expect(marker).toHaveBeenLastCalledWith(false, true);
    marker.mockClear();
    const death = { killer: 'client', dir: null, over: false, how: 'MP5', crit: true };
    t.receive('pdead', death, 'stranger');
    t.receive('pdead', { ...death, crit: 'invalid' });
    t.receive('pdead', { ...death, killer: null });
    expect(marker).not.toHaveBeenCalled();
    t.receive('pdead', death);
    expect(marker).toHaveBeenCalledExactlyOnceWith(true, true);
  } finally { t.ffa.leave(); }
});

test.each(['pistol', 'r4c'])('%s headshot follow-up waits for a valid victim acknowledgement', source => {
  const t = setup();
  setState(t.gs, 'play');
  try {
    const remote = t.remote as unknown as Parameters<typeof t.ffa.hitPlayer>[0];
    t.ffa.hitPlayer(remote, source === 'r4c' ? 46.8 : 64, { source, part: 'head', crit: true });
    const packet = must(t.sent.find(m => m.type === 'pdmg'), 'damage packet').data as { hitId: number };
    expect(t.ctx.player.headshots).toBe(0);
    t.receive('headshot', { hitId: packet.hitId }, 'stranger');
    t.receive('headshot', { hitId: packet.hitId + 100 }, 'host');
    expect(t.ctx.player.headshots).toBe(0);
    t.receive('headshot', { hitId: packet.hitId }, 'host');
    expect(t.ctx.player.headshots).toBe(1);
    t.receive('headshot', { hitId: packet.hitId }, 'host');
    expect(t.ctx.player.headshots).toBe(1);
    t.ffa.hitPlayer(remote, 20, { source: 'rifle', part: 'torso' });
    const body = t.sent.filter(m => m.type === 'pdmg').at(-1)?.data as { hitId: number };
    t.receive('headshot', { hitId: body.hitId }, 'host');
    expect(t.ctx.player.headshots).toBe(1);

    t.ffa.hitPlayer(remote, 20, { source: 'rifle', part: 'head', crit: true });
    const expired = t.sent.filter(m => m.type === 'pdmg').at(-1)?.data as { hitId: number };
    const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1100);
    try { t.receive('headshot', { hitId: expired.hitId }, 'host'); }
    finally { clock.mockRestore(); }
    expect(t.ctx.player.headshots).toBe(1);

    const hit = { amount: 20, from: [3, 1, 0], by: 'host', crit: true, src: source, hitId: 42 };
    t.ctx.player.shieldT = 1;
    t.receive('pdmg', hit);
    expect(t.sent.some(m => m.type === 'headshot')).toBe(false);
    t.ctx.player.shieldT = 0;
    t.receive('pdmg', hit);
    expect(t.sent.find(m => m.type === 'headshot')?.data).toEqual({ hitId: 42 });
  } finally { t.ffa.leave(); }
});

test.each(['tdm', 'flag'] as const)('%s blocks friendly damage and rope cuts at both ends', mode => {
  const t = setup(true, mode);
  try {
    t.ffa.hostStart();
    t.lobby.teams.client = t.lobby.teams.host ?? 0;
    const target = t.remote as unknown as Parameters<typeof t.ffa.hitPlayer>[0];
    expect(t.ffa.canHurt(target)).toBe(false);
    t.ffa.hitPlayer(target, 80, { source: 'grenade' });
    t.receive('pdmg', { amount: 80, from: [0, 1, 0], by: 'client', crit: false, src: 'grenade', round: 1 });
    t.ctx.player.grapple.mode = 'on';
    t.receive('cut', { round: 1 });
    expect(t.sent.filter(m => m.type === 'pdmg')).toHaveLength(0);
    expect(t.damage).toHaveLength(0);
    expect(t.ctx.player.detachGrapple).not.toHaveBeenCalled();
    t.lobby.teams.client = t.lobby.teams.host === 0 ? 1 : 0;
    t.receive('pdmg', { amount: 12, from: [0, 1, 0], by: 'client', crit: false, src: 'rifle', round: 1 });
    expect(t.damage).toHaveLength(1);
  } finally { t.ffa.leave(); }
});

test('team host grants a wave, rejects duplicate deaths and keeps cumulative scores after leave', () => {
  const t = setup(true, 'tdm');
  try {
    t.ffa.hostStart();
    const state = must(t.gs.teamMatch, 'team state'), team = t.lobby.teams.host ?? 0;
    const death = { killer: 'host', dir: null, over: false, how: 'MP5', crit: false, round: state.round };
    t.receive('pdead', death); t.receive('pdead', death);
    expect(state.scores[team]).toBe(1);
    expect(t.scores.get('client')?.deaths).toBe(1);
    expect(state.dead.client).toBe(8);
    const clock = performance.now() / 1000;
    t.ffa.update(0.05, clock + 8);
    expect(state.dead.client).toBeUndefined();
    t.receive('pdead', death); // No live body packet since the wave: still an old death.
    expect(state.scores[team]).toBe(1);
    const leave = t.ctx.net.onPeerLeave as (id: string) => void;
    leave('client');
    expect(state.scores[team]).toBe(1);
  } finally { t.ffa.leave(); }
});

test('host wipe waits for the shared wave instead of individual delay', () => {
  const t = setup(true, 'flag');
  try {
    t.ffa.hostStart();
    const clock = performance.now() / 1000;
    t.ffa.update(0.05, clock + 2);
    t.gs.menu = true;
    t.ctx.player.alive = false; t.ffa.localDeath();
    expect(t.gs.state).toBe('dying');
    expect(t.gs.menu).toBe(false);
    expect(t.ctx.hud.hideScreen).toHaveBeenCalled();
    t.ffa.updateDying(10);
    expect(t.gs.state).toBe('dying');
    t.ffa.update(0.05, clock + 8.01);
    expect(t.gs.state).toBe('play');
    expect(t.ctx.player.alive).toBe(true);
    expect(t.ctx.player.shieldT).toBe(2);
  } finally { t.ffa.leave(); }
});

test('late flag join receives clocks and scores; only host snapshots grant respawn and reset rounds', () => {
  const t = setup(false, 'flag');
  try {
    const state = createTeamMatch('flag', [0, 0, 0]);
    state.elapsed = 90; state.scores = [2, 1]; state.flag.placed = 0; state.flag.holdLeft = 12;
    t.receive('start', { late: true, mode: 'flag', teams: t.lobby.teams, teamState: structuredClone(state), map: 'downtown' });
    expect(t.gs.teamMatch).toEqual(state);
    expect(t.gs.matchT).toBe(90);
    t.ctx.player.alive = false; t.ffa.localDeath();
    const dead = structuredClone(state); dead.dead.client = 96; dead.elapsed = 92;
    t.receive('teamstate', dead, 'stranger');
    expect(t.gs.teamMatch?.elapsed).toBe(90);
    t.receive('teamstate', dead);
    t.ffa.updateDying(20);
    expect(t.gs.state).toBe('dying');
    const revived = structuredClone(dead); revived.elapsed = 96; revived.dead = {};
    t.receive('teamstate', revived);
    expect(t.gs.state).toBe('play');
    const before = t.resets.length;
    const next = structuredClone(revived); next.round = 2; next.elapsed = 100; next.flag.placed = null;
    t.receive('teamstate', next);
    expect(t.resets).toHaveLength(before + 1);
    t.receive('teamstate', dead); // Stale state cannot kill/reset a new round.
    expect(t.gs.teamMatch?.round).toBe(2);
    t.receive('end', { id: 'team:1', name: 'BLUE TEAM' });
    expect(t.gs.over?.id).toBe('team:1');
    expect(t.ffa.onlineInfo().status).toBe('BLUE TEAM WINS');
  } finally { t.ffa.leave(); }
});

test('flag host handles pickup, place, steal, carrier departure and round-tagged snapshots', () => {
  const t = setup(true, 'flag');
  try {
    t.ffa.hostStart();
    const s = must(t.gs.teamMatch, 'team state');
    const layout = teamLayout(t.ctx.level as unknown as Parameters<typeof teamLayout>[0]);
    const own = t.lobby.teams.host ?? 0;
    let clock = performance.now() / 1000;
    const step = () => { clock += 0.05; t.ffa.update(0.05, clock); };
    t.ctx.player.body.pos.fromArray(layout.neutral); step();
    expect(s.flag.carrier).toBe('host');
    t.ctx.player.body.pos.fromArray(layout.bases[own]); step();
    expect(s.flag.placed).toBe(own);
    s.flag.holdLeft = 1;
    t.receive('ps', { round: s.round - 1, state: [...layout.bases[own], 0, 0, 0, 80, 100] });
    expect(t.remote.pushes).toBe(0);
    t.receive('ps', { round: s.round, state: [...layout.bases[own], 0, 0, 0, 80, 100] }); step();
    expect(s.flag).toMatchObject({ carrier: 'client', placed: null, holdLeft: 30 });
    (t.ctx.net.onPeerLeave as (id: string) => void)('client');
    expect(s.flag.carrier).toBeNull();
    expect(s.flag.returnLeft).toBe(15);
    expect(s.scores).toEqual([0, 0]);
  } finally { t.ffa.leave(); }
});

test('new rounds ignore old combat packets and interpolated objective positions', () => {
  const t = setup(true, 'flag');
  try {
    t.ffa.hostStart();
    const s = must(t.gs.teamMatch, 'team state');
    let clock = performance.now() / 1000;
    const step = () => { clock += 0.05; t.ffa.update(0.05, clock); };
    t.receive('ps', { round: 1, state: [0, 0, 0, 0, 0, 0, 80, 100] });
    step();
    expect(s.flag.carrier).toBe('client');
    s.elapsed = 479.99;
    step();
    expect(s.overtime).toBe(true);
    expect(s.round).toBe(2);
    expect(s.flag.carrier).toBeNull();
    const hit = { amount: 90, from: [0, 1, 0], by: 'client', crit: true, src: 'rifle', hitId: 23 };
    t.ctx.player.grapple.mode = 'on';
    for (const round of [undefined, 1]) {
      t.receive('pdmg', { ...hit, round });
      t.receive('cut', { round });
    }
    expect(t.damage).toHaveLength(0);
    expect(t.ctx.player.detachGrapple).not.toHaveBeenCalled();
    t.receive('ps', { round: 2, state: [57, 0, -8, 0, 0, 0, 80, 100] });
    t.remote.body.pos.set(0, 0, 0); // Rendering can still show the previous round during interpolation.
    step();
    expect(s.flag.carrier).toBeNull();
    t.receive('pdmg', { ...hit, round: 2 });
    expect(t.damage).toHaveLength(1);
    expect(t.sent.find(m => m.type === 'headshot')?.data).toEqual({ hitId: 23, round: 2 });
    t.receive('cut', { round: 2 });
    expect(t.ctx.player.detachGrapple).toHaveBeenCalledOnce();
    t.ffa.hitPlayer(t.remote as unknown as Parameters<typeof t.ffa.hitPlayer>[0], 10);
    expect(t.sent.find(m => m.type === 'pdmg')?.data).toMatchObject({ round: 2 });
  } finally { t.ffa.leave(); }
});

test('a new placement does not inherit elapsed time from a delayed host frame', () => {
  const t = setup(true, 'flag');
  try {
    t.ffa.hostStart();
    const s = must(t.gs.teamMatch, 'team state');
    let clock = performance.now() / 1000;
    t.ctx.player.body.pos.set(0, 0, 0);
    t.ffa.update(0.05, clock += 0.05);
    expect(s.flag.carrier).toBe('host');
    t.ctx.player.body.pos.set(-48, 0, 0);
    t.ffa.update(0.05, clock += 40);
    expect(s.flag.placed).toBe(0);
    expect(s.flag.holdLeft).toBe(30);
    expect(s.scores).toEqual([0, 0]);
  } finally { t.ffa.leave(); }
});

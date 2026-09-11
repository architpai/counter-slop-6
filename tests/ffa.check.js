import { Scene, Vector3 } from 'three';
import { createFFA } from '../src/engine/game/ffa.js';
import { makeGameState } from '../src/engine/game/state.js';

const noop = () => {};

function setup(isHost = false) {
  const handlers = new Map(), sent = [], screens = [], damage = [], resets = [];
  const id = isHost ? 'host' : 'client', other = isHost ? 'client' : 'host';
  const gs = { ...makeGameState(), state: 'lobby', mode: 'ffa' };
  const net = {
    active: true, isHost, id, hostId: 'host', code: 'ABCDE', isPublic: false,
    connections: new Map(), on: (type, fn) => handlers.set(type, fn),
    send: (type, data) => sent.push({ type, data }),
    broadcast: (type, data) => sent.push({ type, data }),
    sendTo: (to, type, data) => sent.push({ to, type, data }),
    leave() { this.active = false; },
  };
  const player = {
    name: id, alive: true, hp: 100, maxHp: 100, shieldT: 0,
    body: { pos: new Vector3(), vel: new Vector3(), onGround: true },
    center: new Vector3(0, 1, 0), eye: new Vector3(0, 1.6, 0),
    forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
    yaw: 0, pitch: 0, wi: 0, weapon: { kind: 'rifle' },
    grapple: { mode: 'idle', hook: new Vector3() },
    lastHitBy: null, lastHit: null,
    reset(pos) { resets.push(pos.clone()); this.body.pos.copy(pos); this.alive = true; this.hp = 100; },
    takeDamage(amount, from) { damage.push({ amount, from }); this.hp -= amount; },
    detachGrapple: noop, throwGrenade: noop,
  };
  const remote = {
    id: other, name: other, alive: true, visible: true, lastSeen: 0,
    body: { pos: new Vector3(20, 0, 0) }, center: new Vector3(20, 1, 0),
    forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), hits: [],
    updates: 0, pushes: 0, disposed: false,
    update() { this.updates++; }, push() { this.pushes++; }, shots: noop,
    dispose() { this.disposed = true; },
    ragdoll() { this.alive = false; }, flash: noop,
  };
  const ctx = {
    net, player, scene: new Scene(), remotes: new Map([[other, remote]]),
    level: {
      key: 'downtown', playerStart: new Vector3(0, 0, 42),
      arenaSpawns: [new Vector3(-10, 0, 3), new Vector3(10, 2, 8)],
      spawns: [new Vector3()], breakables: [],
    },
    hud: {
      setPvpScore: noop, setModifier: noop, setBoard: noop, setGameplayVisible: noop,
      message: noop, tip: noop, kill: noop, hit: noop, key: action => action,
    },
    audio: { kill: noop, spawn: noop, enemyDie: noop, shieldHit: noop, reel: noop },
    effects: { strokeBurst: noop, blood: noop, tracer: noop },
    input: { locked: true, usingGamepad: true, exitLock: noop, requestLock: noop, rumble: noop },
    world: { lineOfSight: () => true }, game: { hitstop: noop },
  };
  const lobby = {
    players: new Map([['host', 'Host'], ['client', 'Client']]),
    hostId: 'host', code: 'ABCDE', isPublic: false, status: '', map: 'downtown',
  };
  const scores = new Map([
    ['host', { name: 'Host', kills: 7, deaths: 2 }],
    ['client', { name: 'Client', kills: 3, deaths: 5 }],
  ]);
  const app = {
    ctx, gs, lobby, scores, settings: { name: id, mapKey: 'downtown' }, busy: false,
    pickups: { spawn: noop, remove: () => false }, breakables: { breakProp: noop },
    loadLevel(arena, key = 'downtown') { ctx.level.key = key; },
    resetRun() {
      player.reset(ctx.level.playerStart);
      player.lastHitBy = player.lastHit = null;
      gs.matchT = gs.respawnT = gs.deathT = gs.overT = 0; gs.over = null;
    },
    beginCommon: noop, showScreen: kind => screens.push(kind), endFocus: noop, addScore: noop,
  };
  const ffa = createFFA(app);
  return { app, ffa, remote, sent, screens, damage, resets,
    receive: (type, data, from = other) => handlers.get(type)?.(data, from) };
}

export async function run(assert) {
  {
    const t = setup(true), { gs, scores, ctx } = t.app;
    gs.state = 'play'; scores.get('client').kills = 19;
    ctx.player.lastHitBy = 'client';
    ctx.player.lastHit = { from: new Vector3(3, 1, 0), amount: 100, crit: true, src: 'rifle' };
    try {
      t.ffa.localDeath();
      assert(scores.get('client').kills === 20 && scores.get('host').deaths === 3,
        'host death credits the killer and the victim once');
      assert(gs.state === 'over' && gs.over?.id === 'client',
        'a winning local death keeps the host in the match-over state');
      assert(t.sent.filter(m => m.type === 'end').length === 1,
        'host sends one match-end message after the winning death');
    } finally { t.ffa.leave(); }
  }

  {
    const t = setup(), { gs, scores, ctx } = t.app;
    try {
      await t.receive('start', { late: true, spawn: 1, map: 'downtown', broken: [] }, 'host');
      assert(gs.state === 'play' && gs.mode === 'ffa', 'late start enters the active match');
      assert(ctx.player.body.pos.equals(ctx.level.arenaSpawns[1]), 'late start uses the assigned spawn');
      assert(scores.get('host').kills === 7 && scores.get('client').deaths === 5,
        'late start preserves the received scores');
      assert(t.resets.length === 2, 'match start resets the run before the assigned spawn');
      ctx.player.body.pos.addScalar(1);
      assert(ctx.level.arenaSpawns[1].equals(new Vector3(10, 2, 8)),
        'player movement does not change the spawn point');
    } finally { t.ffa.leave(); }
  }

  {
    const t = setup(), { gs, ctx, lobby, scores } = t.app;
    gs.state = 'play'; t.remote.lastSeen = 1000;
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
  }

  {
    const t = setup(), { gs, scores, ctx } = t.app;
    const hit = { amount: 19, from: [3, 1, 0], by: 'host', crit: false, src: 'rifle' };
    const snapshot = [0, 0, 0, 0, 0, 0, 80, 100, 0, 0, 0];
    try {
      await t.receive('start', { late: true, spawn: 1, map: 'downtown', broken: [] }, 'stranger');
      t.receive('score', [{ id: 'host', name: 'Host', kills: 20, deaths: 0 }], 'stranger');
      t.receive('end', { id: 'host', name: 'Host' }, 'stranger');
      assert(gs.state === 'lobby' && scores.get('host').kills === 7 && t.resets.length === 0,
        'nonhost commands cannot start or end a match or change scores');
      t.receive('pdmg', hit, 'host');
      assert(t.damage.length === 0, 'network damage is ignored in the lobby');
      gs.state = 'play';
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
      assert(t.damage.length === 1 && t.damage[0].amount === 19,
        'valid damage from a roster peer reaches an unprotected player');
      gs.state = 'over';
      t.receive('pdmg', hit, 'host');
      assert(t.damage.length === 1, 'network damage is ignored after the match ends');
    } finally { t.ffa.leave(); }
  }
}

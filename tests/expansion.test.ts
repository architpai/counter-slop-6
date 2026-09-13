import { afterEach, expect, test, vi } from 'vitest';
import { Group, Scene, Vector3 } from 'three';
import { Body, World } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';
import { EnemyManager, TYPES, BOSS_ORDER } from '@/engine/enemies';
import { syncModel } from '@/engine/enemies/model';
import { specialThink } from '@/engine/enemies/specials';
import { groundThink } from '@/engine/enemies/ai';
import { RING, hasRingEscape } from '@/engine/enemies/hazards';
import { mutationCount, nextSpawn, ROSTER } from '@/engine/enemies/progression';
import { createSolo } from '@/engine/game/solo';
import { makeGameState } from '@/engine/game/state';
import { createBreakables } from '@/engine/game/breakables';
import type { App } from '@/engine/boot';
import type { Ctx, EnemyKind, Level, Target } from '@/engine/types';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });

function setup() {
  const world = new World(), scene = new Scene();
  world.addBox(new Vector3(-40, -1, -40), new Vector3(40, 0, 40)); world.finalize();
  const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 }, nav = new NavGrid(world, bounds); nav.build();
  const body = new Body(new Vector3(0, 0, 15), 0.35, 1.75); body.onGround = true;
  const player = { body, alive: true, isLocal: true, name: 'test', get center() { return body.pos.clone().add(new Vector3(0, 1, 0)); },
    get eye() { return body.pos.clone().add(new Vector3(0, 1.6, 0)); }, forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
    speed: 0, aiming: false, firing: false, blockRadius: 0, takeDamage: vi.fn(), knockback: vi.fn(), tryDeflect: () => false,
    tryBlockMelee: vi.fn(() => false), onHeadshot: vi.fn(), nades: [], grenades: 1, maxGrenades: 5, heal: vi.fn(),
  };
  const noop = () => {};
  const level: Level = { key: 'downtown', arena: false, playerStart: body.pos.clone(), bounds,
    spawns: [new Vector3(20, 0, 0), new Vector3(-20, 0, 0)], snipers: [new Vector3(20, 0, 0)],
    pickups: [], rings: [], movers: [], animated: [], breakables: [], meshes: [], arenaSpawns: [], teamSpawns: [],
    shadow: { center: new Vector3(), radius: 40 } };
  const gs = makeGameState(); gs.state = 'play';
  const ctx = { world, scene, nav, bossNav: nav, level, player,
    game: { targets: () => [player], get mode() { return gs.mode; }, addScore: noop, hitstop: noop, isOnline: () => false },
    net: { active: false },
    effects: { shake: 0, strokeBurst: noop, tracer: noop, blood: noop, sparks: noop, debris: noop, bloodPool: noop,
      fountain: noop, explosion: noop, particle: noop, bulletImpact: noop, smoke: noop },
    audio: new Proxy({}, { get: () => noop }),
    hud: { setBoss: noop, hitmarker: noop, setModifier: noop, message: vi.fn(), key: () => 'F', tip: noop, setWave: noop, setTimer: noop },
    input: { rumble: noop, pressed: () => false },
  } as unknown as Ctx;
  const m = ctx.enemies = new EnemyManager(ctx);
  const pickups = { spawn: noop };
  const props = createBreakables(ctx, pickups as never); ctx.game.breakHit = props.hit;
  const solo = createSolo({ ctx, gs, pickups, addScore: noop } as unknown as App);
  const spawn = (type: EnemyKind, pos = new Vector3()) => {
    const e = m.spawn(type, pos); e.state = 'hunt'; e.age = 1; e.body.onGround = !e.stats.flying;
    e.target = player as unknown as Target; e.root.scale.setScalar(e.stats.scale); syncModel(e); return e;
  };
  cleanups.push(() => { m.clear(); world.clear(); });
  return { ctx, m, player, gs, solo, spawn, props };
}

test('roster keeps unlocking, six bosses repeat at 30 waves, mutation messages avoid boss waves', () => {
  expect(ROSTER.filter(([, wave]) => wave > 15).map(([type]) => type)).toEqual(['smoker', 'parry', 'rubberbander', 'sapper']);
  expect(BOSS_ORDER).toEqual(['boss', 'hitbox', 'lagspike', 'aimbot', 'ragequit', 'moderator']);
  expect([30, 31, 35, 36, 40, 41, 46, 1000].map(mutationCount)).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
  const { solo, gs, ctx } = setup();
  for (const wave of [31, 35, 36, 40, 41, 45, 46, 50, 51]) {
    solo.startWave(wave);
    const message = vi.mocked(ctx.hud.message).mock.lastCall;
    expect(message?.[0]).toBe(`WAVE ${wave}`);
    expect(message?.[1]?.includes('IS COMING')).toBe(wave % 5 === 0);
    expect(message?.[1]?.includes(':')).toBe([31, 36, 41, 46].includes(wave));
    expect(gs.queue.length).toBeGreaterThan(0);
  }
  solo.startWave(20);
  expect(gs.queue[0]).toBe('boss'); // No authored perch: do not improvise a roof.
  solo.startWave(25); expect(gs.queue[0]).toBe('ragequit');
  solo.startWave(30); expect(gs.queue[0]).toBe('moderator');
  solo.startWave(35); expect(gs.queue[0]).toBe('boss');
});

test('capped draws are skipped once and deferred; carried/deployed sentries share reservations', () => {
  const { m, spawn, solo, gs } = setup();
  for (const [type, cap] of [['medic', 2], ['breacher', 2], ['packleader', 1], ['sapper', 1]] as const) {
    for (let i = 0; i < cap; i++) { expect(m.canSpawn(type)).toBe(true); spawn(type, new Vector3(i * 4, 0, 0)); }
    expect(m.canSpawn(type)).toBe(false);
  }
  const carrier = spawn('carrier', new Vector3(10, 8, 0)); spawn('turret', new Vector3(20, 0, 0));
  expect(m.canSpawn('carrier')).toBe(false); expect(m.canSpawn('turret')).toBe(false);
  carrier.payload = false; expect(m.canSpawn('turret')).toBe(true);
  const queue = ['medic', 'breacher', 'grunt'];
  expect(nextSpawn(queue, t => m.canSpawn(t))).toBe('grunt'); expect(queue).toEqual(['medic', 'breacher']);
  expect(nextSpawn(queue, t => m.canSpawn(t))).toBeUndefined(); expect(queue).toHaveLength(2);
  gs.wave = 7; gs.queue = ['medic', 'grunt']; gs.spawnT = 0; gs.maxAlive = 30;
  solo.update(0.1); expect(gs.queue).toEqual(['medic']); expect(m.list.at(-1)?.type).toBe('grunt');
});

test('medic heals one visible non-medic at 15 HP/s and never beyond maximum', () => {
  const { spawn, m, ctx } = setup();
  const medic = spawn('medic'), patient = spawn('heavy', new Vector3(3, 0, 0)), other = spawn('medic', new Vector3(1, 0, 0));
  patient.hp -= 50; other.hp -= 50;
  specialThink(m, medic, 1); expect(patient.hp).toBe(patient.maxHp - 35); expect(other.hp).toBe(other.maxHp - 50);
  specialThink(m, medic, 10); expect(patient.hp).toBe(patient.maxHp);
  patient.hp -= 50;
  ctx.world.addBox(new Vector3(1, 0, -2), new Vector3(2, 5, 2)); ctx.world.finalize();
  specialThink(m, medic, 1); expect(patient.hp).toBe(patient.maxHp - 50);
  m.damage(medic, 1, { source: 'rifle' }); expect(medic.wantCover).toBe(true);
});

test('leader horn gives one bounded speed boost; death cancels attacks and triggers two-second retreat', () => {
  const { spawn, m } = setup();
  const leader = spawn('packleader'), rusher = spawn('rusher', new Vector3(4, 0, 0));
  leader.specialCd = 0; specialThink(m, leader, 0.1);
  expect(rusher.boostT).toBe(0);
  specialThink(m, leader, 1); expect(rusher.boostT).toBe(3.5);
  rusher.attackT = 0.5;
  m.kill(leader, { source: 'rifle' });
  expect(rusher.boostT).toBe(0); expect(rusher.retreatT).toBe(2); expect(rusher.attackT).toBe(0);
});

test('breacher locks its charge and a parry stuns it; shield still blocks bullets', () => {
  const { spawn, m, player } = setup(); player.body.pos.set(0, 0, 6);
  const e = spawn('breacher'); e.attackCd = 0; specialThink(m, e, 0.01);
  const yaw = e.homeYaw; player.body.pos.set(4, 0, 6); specialThink(m, e, 0.4);
  expect(e.homeYaw).toBe(yaw);
  player.body.pos.set(0, 0, 1.8); player.tryBlockMelee.mockReturnValue(true);
  specialThink(m, e, 0.3); expect(e.state).toBe('stunned'); expect(e.stunDuration).toBe(1.3);
  const hp = e.hp; m.damage(e, 100, { part: 'shield', source: 'rifle' }); expect(e.hp).toBe(hp);
});

test('parry stance reflects frontal gunfire at a bounded rate; flanks, melee and recovery stay vulnerable', () => {
  const { spawn, m } = setup(); const e = spawn('parry'); e.yaw = 0; e.guardT = 1;
  const front = { source: 'rifle', dir: new Vector3(0, 0, -1) };
  for (let i = 0; i < 8; i++) m.damage(e, 10, front);
  expect(e.hp).toBe(110); expect(m.projectiles).toHaveLength(1);
  m.damage(e, 10, { source: 'rifle', dir: new Vector3(0, 0, 1) }); expect(e.hp).toBe(100);
  m.damage(e, 10, { source: 'melee', dir: front.dir }); expect(e.hp).toBe(90);
  e.guardT = 0; m.damage(e, 10, front); expect(e.hp).toBe(80);
});

test('smoke is capped from launch, blocks aim, and a blast clears it', () => {
  const { m, ctx } = setup(), from = new Vector3(0, 2, 0), to = new Vector3(0, 1.5, 5);
  expect(m.hazards.throwSmoke(from, to)).toBe(true); expect(m.hazards.throwSmoke(from, to)).toBe(true);
  expect(m.hazards.throwSmoke(from, to)).toBe(false);
  m.hazards.update(1.1);
  expect(m.hazards.obscures(from, new Vector3(0, 1.5, 10))).toBe(true);
  expect(ctx.scene.getObjectByName('smoke cloud')).toBeDefined();
  m.blastEnemies(to, 5, 100); expect(m.hazards.smoke).toHaveLength(0);
  m.hazards.clear(); expect(ctx.scene.getObjectByName('smoke cloud')).toBeUndefined();
});

test('sentry stays fixed and cannot fire behind its 90-degree arc', () => {
  const { spawn, m, player } = setup(), turret = spawn('turret'); turret.homeYaw = 0;
  player.body.pos.set(0, 0, -15);
  for (let i = 0; i < 240; i++) groundThink(m, turret, 1 / 60);
  expect(m.projectiles).toHaveLength(0); expect(turret.body.vel.length()).toBe(0);
  player.body.pos.set(0, 0, 15); turret.attackCd = 0;
  for (let i = 0; i < 120; i++) groundThink(m, turret, 1 / 60);
  expect(m.projectiles.length).toBeGreaterThan(0);
});

test('mutations affect new/live actors without modifying catalogue stats, and reset between runs', () => {
  const { spawn, m } = setup(), old = spawn('grunt');
  const baseBurst = TYPES.grunt.burst;
  m.setMutations(31); const fresh = spawn('grunt', new Vector3(4, 0, 0));
  expect(old.stats.burst).toBe(5); expect(fresh.stats.burst).toBe(5); expect(TYPES.grunt.burst).toBe(baseBurst);
  expect(old.root.getObjectByName('mutation marker')).toBeDefined();
  m.setMutations(1000); expect(m.mutations.size).toBe(4);
  m.clear(); const normal = spawn('grunt'); expect(normal.stats.burst).toBe(baseBurst); expect(normal.mutated).toBe(false);
});

test('moderator yank requires its cast window; all other bosses still refuse', () => {
  const { spawn, m, player } = setup();
  for (const kind of BOSS_ORDER) {
    const boss = spawn(kind, new Vector3(5, 8, 0));
    m.yank(boss, player.center); expect(boss.state).toBe('hunt');
    if (kind === 'moderator') {
      boss.yankableT = 2; m.yank(boss, player.center);
      expect(boss.state).toBe('stunned'); expect(boss.stunDuration).toBe(1.3); expect(boss.yankableT).toBe(0);
      const velocity = boss.body.vel.clone(); m.yank(boss, player.center); expect(boss.body.vel.equals(velocity)).toBe(true);
    }
  }
});

test('ban rings honour caps, spacing, countdown, lifespan, escape, and owner death', () => {
  const { spawn, m, player, ctx } = setup(); const boss = spawn('moderator', new Vector3(0, 8, 0));
  player.body.pos.set(0, 0, 0);
  for (let attempt = 0; attempt < 100 && m.hazards.rings.length < 3; attempt++) m.hazards.placeRing(boss);
  expect(m.hazards.rings.length).toBeGreaterThan(0); expect(m.hazards.rings.length).toBeLessThanOrEqual(RING.cap);
  const centers = m.hazards.rings.map(r => r.pos);
  expect(hasRingEscape(ctx.nav, player as unknown as Target, centers, ctx.world)).toBe(true);
  centers.forEach((p, i) => {
    expect(p.distanceTo(player.body.pos)).toBeGreaterThanOrEqual(4);
    centers.slice(i + 1).forEach(q => expect(p.distanceTo(q)).toBeGreaterThanOrEqual(8));
  });
  player.body.pos.copy(centers[0]!);
  m.hazards.update(2.9); expect(player.takeDamage).not.toHaveBeenCalled();
  m.hazards.update(0.2); expect(player.takeDamage).toHaveBeenCalled();
  const damage = player.takeDamage.mock.calls.reduce((sum, args) => sum + Number(args[0]), 0);
  expect(damage).toBeCloseTo(3, 5);
  boss.alive = false; m.hazards.update(0.1); expect(m.hazards.rings).toHaveLength(0);
  boss.alive = true; player.body.pos.set(0, 0, 0); m.hazards.placeRing(boss);
  m.hazards.update(11); expect(m.hazards.rings).toHaveLength(0);
});

test('a sapper charge is a shootable prop; shooting cancels destruction, expiry breaks only its target', () => {
  const { m, ctx, props } = setup();
  const box = ctx.world.addBox(new Vector3(3, 0, 0), new Vector3(5, 2, 2));
  const cover = { id: 0, kind: 'crate' as const, group: new Group(), hp: 60, pos: new Vector3(4, 1, 1), alive: true, tone: 3, box };
  box.data.breakable = cover; ctx.level.breakables.push(cover); ctx.world.finalize();
  const position = new Vector3(2.7, 1, 1);
  expect(m.hazards.plantCharge(cover, position)).toBe(true);
  const charge = m.hazards.charges[0]!.prop;
  expect(ctx.world.raycast(new Vector3(0, 1, 1), new Vector3(1, 0, 0), 10)?.box.data.breakable).toBe(charge);
  props.hit(charge, 20, charge.pos, new Vector3(1, 0, 0)); m.hazards.update(4);
  expect(cover.alive).toBe(true);
  expect(m.hazards.plantCharge(cover, position)).toBe(true);
  expect(ctx.level.breakables).toHaveLength(2); // Reuse a spent charge slot during endless runs.
  m.hazards.update(3.1);
  expect(cover.alive).toBe(false); expect(m.hazards.charges).toHaveLength(0); expect(m.hazards.destroyedCover).toBe(1);
});

test('all new brains run with real physics without non-finite state and training stays passive', () => {
  const { spawn, m, gs, player } = setup();
  const kinds = Object.keys(TYPES).filter(k => !['grunt', 'rusher', 'heavy', 'sniper', 'shield', 'flyer', 'bomber', 'boss', 'hitbox', 'lagspike'].includes(k)) as EnemyKind[];
  for (const [i, kind] of kinds.entries()) spawn(kind, new Vector3(-18 + i * 3, TYPES[kind].flying ? 8 : 0, -8));
  for (let i = 0; i < 600; i++) m.update(1 / 60);
  for (const e of m.list) expect([...e.body.pos.toArray(), ...e.body.vel.toArray(), e.hp].every(Number.isFinite), e.type).toBe(true);
  m.clear(); player.takeDamage.mockClear(); gs.mode = 'training';
  for (const [i, kind] of kinds.entries()) spawn(kind, new Vector3(-18 + i * 3, 0, 0));
  for (let i = 0; i < 180; i++) m.update(1 / 60);
  expect(player.takeDamage).not.toHaveBeenCalled(); expect(m.projectiles).toHaveLength(0); expect(m.hazards.rings).toHaveLength(0);
});

test('ring placement rejects an enclosed safe pocket instead of counting standing still as escape', () => {
  const { ctx, player } = setup(); player.body.pos.set(0, 0, 0);
  ctx.world.addBox(new Vector3(-40, 0, -40), new Vector3(-1, 4, 40));
  ctx.world.addBox(new Vector3(1, 0, -40), new Vector3(40, 4, 40)); ctx.world.finalize(); ctx.nav.build();
  expect(hasRingEscape(ctx.nav, player as unknown as Target, [], ctx.world)).toBe(true);
  expect(hasRingEscape(ctx.nav, player as unknown as Target, [new Vector3(0, 0, -7), new Vector3(0, 0, 7)], ctx.world)).toBe(false);
});

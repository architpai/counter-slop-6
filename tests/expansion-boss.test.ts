import { afterEach, expect, test, vi } from 'vitest';
import { Scene, Vector3 } from 'three';
import type { EnemyManager, EnemyRecord } from '@/engine/enemies/index';
import { TYPES } from '@/engine/enemies/types';
import { expansionBossThink } from '@/engine/enemies/expansion-boss';
import { updateProjectiles } from '@/engine/enemies/projectiles';
import { Body, World } from '@/engine/physics';
import type { EnemyKind, Target } from '@/engine/types';

const managers: EnemyManager[] = [];
afterEach(() => { for (const m of managers.splice(0)) m.clear(); });

function setup(type: EnemyKind, distance = 10) {
  const world = new World();
  world.addBox(new Vector3(-40, -1, -40), new Vector3(40, 0, 40)); world.finalize();
  const target = { alive: true, isLocal: true, body: new Body(new Vector3(0, 0, distance), 0.35, 1.8),
    center: new Vector3(0, 0.9, distance), eye: new Vector3(0, 1.6, distance), forward: new Vector3(0, 0, -1),
    takeDamage: vi.fn(), knockback: vi.fn(), tryBlockMelee: vi.fn(() => false), tryDeflect: () => null,
    speed: 0, blockRadius: 0,
  } as unknown as Target;
  const placeRing = vi.fn(() => true), canSpawn = vi.fn(() => true);
  const m = { ids: 1, list: [], projectiles: [], mods: { speed: 1, damage: 1 }, canSpawn,
    hazards: { placeRing, obscures: () => false }, _steer: vi.fn(), _follow: vi.fn(),
    ctx: { scene: new Scene(), world, player: target,
      level: { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } },
      game: { targets: () => [target] },
      effects: { strokeBurst: vi.fn(), tracer: vi.fn(), bulletImpact: vi.fn() },
      audio: { sniperAim: vi.fn(), enemySniper: vi.fn(), lunge: vi.fn(), bulletImpact: vi.fn() },
    },
    eye: (enemy: EnemyRecord) => enemy.body.pos.clone().add(new Vector3(0, enemy.body.height * 0.9, 0)),
    clear: () => m.ctx.scene.clear(),
  } as unknown as EnemyManager;
  m.spawn = ((kind: EnemyKind, pos: Vector3) => {
    const stats = TYPES[kind];
    const enemy = { type: kind, stats, alive: true, state: 'hunt', target, age: 0, yaw: 0,
      body: new Body(pos, stats.flying ? 0.45 : Math.min(0.33 * stats.scale, 0.9), (stats.flying ? 0.8 : 1.85) * stats.scale),
      center: pos.clone().add(new Vector3(0, stats.scale, 0)), attackCd: 0, specialCd: 12,
      aimT: 0, aimAmt: 0, aimPoint: null, aimWarned: false, chargeCount: 0, attackT: 0,
      specialT: 0, actionPoint: null, rageT: 0, rageStacks: 0, retreatT: 0, weakT: 0, yankableT: 0,
      flightPhase: 'orbit', orbitDir: 1, payload: kind === 'carrier', laser: null,
    } as unknown as EnemyRecord;
    enemy.body.onGround = !stats.flying; enemy.body.noSnap = !!stats.flying;
    m.list.push(enemy); return enemy;
  }) as EnemyManager['spawn'];
  managers.push(m);
  const e = m.spawn(type, new Vector3(0, type === 'moderator' ? 6 : 0, 0));
  const frame = (dt: number, move = false) => {
    e.age += dt; e.weakT = Math.max(0, e.weakT - dt); e.yankableT = Math.max(0, e.yankableT - dt);
    const result = expansionBossThink(m, e, dt);
    if (move) { world.moveBody(e.body, dt); e.center.copy(e.body.pos).y += e.stats.scale; }
    return result;
  };
  return { m, e, target, world, frame, placeRing, canSpawn };
}

test('dispatch declines ordinary enemies and owns boss cooldowns even without a target or while stunned', () => {
  const ordinary = setup('grunt'); ordinary.e.attackCd = 2;
  expect(ordinary.frame(0.1)).toBe(false); expect(ordinary.e.attackCd).toBe(2);
  for (const type of ['aimbot', 'ragequit', 'moderator'] as const) {
    const { e, frame } = setup(type);
    e.target = null; e.state = 'stunned'; e.age = 0; e.stunDuration = 2; e.attackCd = 3;
    e.body.vel.set(3, 0, 3);
    expect(frame(0.1)).toBe(true); expect(e.attackCd).toBeCloseTo(2.9);
    expect(e.state).toBe('stunned'); expect(e.body.vel.y).toBeCloseTo(-2.4);
    if (type === 'aimbot') expect(e.body.vel.x).toBe(0);
  }
});

test('aimbot tracks .7 seconds, locks .3, fires two fixed-point shots and exposes its cooling vent', () => {
  const { m, e, target, frame } = setup('aimbot');
  frame(0.4); target.center.x = 3; frame(0.3);
  const locked = e.aimPoint!.clone();
  expect(e.aimWarned).toBe(true); expect(e.laser?.visible).toBe(true);
  target.center.x = 12; frame(0.29);
  expect(m.projectiles).toHaveLength(0); expect(e.aimPoint).toEqual(locked);
  frame(0.01); expect(m.projectiles).toHaveLength(1);
  frame(0.24); expect(m.projectiles).toHaveLength(1);
  frame(0.01); expect(m.projectiles).toHaveLength(2);
  for (const shot of m.projectiles) expect(shot.vel.clone().normalize().distanceTo(locked.clone().sub(shot.origin).normalize())).toBeLessThan(1e-8);
  expect(e.weakT).toBe(2.5); expect(e.attackCd).toBe(3); expect(e.laser?.visible).toBe(false);
  e.body.vel.set(20, 0, 20); e.target = null; frame(0.1, true);
  expect(e.body.pos.x).toBe(0); expect(e.body.pos.z).toBe(0);
});

test('aimbot projectiles hit intervening walls after lock; blocked sight cannot start a new volley', () => {
  const { m, e, target, world, frame } = setup('aimbot');
  frame(0.7);
  world.addBox(new Vector3(-20, 0, 4), new Vector3(20, 20, 5)); world.finalize();
  frame(0.3); updateProjectiles(m, 0.1);
  expect(m.projectiles).toHaveLength(0); expect(target.takeDamage).not.toHaveBeenCalled();
  frame(0.25); updateProjectiles(m, 0.1);
  expect(target.takeDamage).not.toHaveBeenCalled();
  frame(3); expect(e.aimPoint).toBeNull();
});

test('aimbot carrier drops obey the shared cap, overlap checks and twelve-second interval', () => {
  const { m, e, world, frame, canSpawn } = setup('aimbot');
  e.specialCd = 0; canSpawn.mockReturnValue(false); frame(0.01);
  expect(m.list).toHaveLength(1); expect(e.specialCd).toBe(12);
  canSpawn.mockReturnValue(true); e.specialCd = 0;
  world.addBox(new Vector3(-10, 2, -10), new Vector3(10, 20, 10)); world.finalize(); frame(0.01);
  expect(m.list).toHaveLength(1);
  world.clear(); e.specialCd = 0; frame(0.01);
  expect(m.list).toHaveLength(2);
  const child = m.list[1]!;
  expect(child.type).toBe('carrier'); expect(child.payload).toBe(true);
  expect(child.body.pos.y).toBeGreaterThan(e.body.height);
  expect(world.overlapsBody(child.body)).toBe(false);
  frame(11.9); expect(m.list).toHaveLength(2);
});

test('ragequit gains capped speed stacks every three undamaged seconds, and a parry clears them for two seconds', () => {
  const { m, e, target, frame } = setup('ragequit', 25);
  m._follow = vi.fn();
  frame(12); expect(e.rageStacks).toBe(4);
  expect(m._follow).toHaveBeenLastCalledWith(e, target.body.pos, e.stats.speed * 1.8, 12);
  e.rageT = 0; frame(2.9); expect(e.rageStacks).toBe(4); // Manager resets only rageT on damage.
  target.body.pos.z = target.center.z = 2;
  vi.mocked(target.tryBlockMelee).mockReturnValue(true);
  frame(0.01); frame(0.64);
  expect(target.tryBlockMelee).not.toHaveBeenCalled();
  frame(0.01);
  expect(e.rageStacks).toBe(0); expect(e.state).toBe('stunned'); expect(e.stunDuration).toBe(2);
  expect(target.takeDamage).not.toHaveBeenCalled();
  frame(1.99); expect(e.state).toBe('stunned');
  frame(0.02); expect(e.state).toBe('hunt');
});

test('ragequit commits to its windup direction, misses recover for .8 seconds, and walls prevent contact', () => {
  const { e, target, world, frame } = setup('ragequit', 2);
  frame(0.01); target.body.pos.x = target.center.x = 12;
  frame(0.65); expect(e.body.vel.x).toBe(0); expect(e.body.vel.z).toBe(17);
  expect(target.takeDamage).not.toHaveBeenCalled();
  frame(0.65); expect(e.retreatT).toBe(0.8); expect(e.body.vel.lengthSq()).toBeGreaterThan(0); // Gravity still runs.
  frame(0.79); expect(e.retreatT).toBeCloseTo(0.01); expect(e.body.vel.z).toBe(0);
  e.retreatT = 0; e.attackCd = 0; target.body.pos.x = target.center.x = 0;
  frame(0.01);
  world.addBox(new Vector3(-5, 0, 0.8), new Vector3(5, 10, 1.2)); world.finalize();
  frame(0.65);
  expect(target.takeDamage).not.toHaveBeenCalled(); expect(target.tryBlockMelee).not.toHaveBeenCalled();
  e.body.hitWall = true; frame(0.01);
  expect(e.retreatT).toBe(0.8); expect(e.actionPoint).toBeNull();
});

test('ragequit can deal blockable damage without requiring a parry', () => {
  const { e, target, frame } = setup('ragequit', 2);
  frame(0.65); expect(target.takeDamage).not.toHaveBeenCalled();
  frame(0.01);
  expect(target.tryBlockMelee).toHaveBeenCalledOnce();
  expect(target.takeDamage).toHaveBeenCalledWith(e.stats.damage, e.center);
  expect(e.retreatT).toBe(0.8);
});

test('moderator only opens its two-second yank window after a valid cast; grounded stun lasts the full 1.3 seconds', () => {
  const { e, frame, placeRing } = setup('moderator');
  frame(0.01); expect(placeRing).not.toHaveBeenCalled();
  frame(4.5); expect(placeRing).toHaveBeenCalledOnce(); expect(e.yankableT).toBe(2);
  expect(e.attackCd).toBeGreaterThanOrEqual(4); expect(e.attackCd).toBeLessThanOrEqual(5);
  e.yankableT = 0; e.attackCd = 0; placeRing.mockReturnValue(false); frame(0.01);
  expect(e.yankableT).toBe(0);
  e.state = 'stunned'; e.flightPhase = 'stunned'; e.age = 0; e.stunDuration = 1.3;
  e.body.pos.y = 0; e.body.vel.set(0, 0, 0); e.body.onGround = true;
  for (let i = 0; i < 129; i++) frame(0.01, true);
  expect(e.state).toBe('stunned'); expect(e.weakT).toBeGreaterThan(0);
  frame(0.02, true); expect(e.state).toBe('hunt'); expect(e.flightPhase).toBe('orbit');
  for (let i = 0; i < 100; i++) frame(0.02, true);
  expect(e.body.pos.y).toBeGreaterThan(1); expect(e.flightPhase).toBe('orbit');
});

test('moderator orbit stays inside map bounds and physical walls without ordinary dives', () => {
  const { e, target, world, frame } = setup('moderator');
  e.body.pos.set(38, 6, 0); target.body.pos.x = target.center.x = 45;
  world.addBox(new Vector3(30, 0, -10), new Vector3(32, 20, 10)); world.finalize();
  for (let i = 0; i < 300; i++) {
    frame(0.02, true);
    expect(e.body.pos.x).toBeLessThanOrEqual(40 - e.body.halfW);
    expect(world.overlapsBody(e.body)).toBe(false);
    expect(e.flightPhase).toBe('orbit');
  }
  expect(target.takeDamage).not.toHaveBeenCalled();
});

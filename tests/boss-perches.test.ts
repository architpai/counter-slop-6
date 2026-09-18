import { expect, test } from 'vitest';
import { Scene, Vector3 } from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { assignBossPerch, validBossPerch } from '@/engine/level/boss-perch';
import { Body, World } from '@/engine/physics';
import { BOSS_CLEARANCE, BOSS_HEADROOM, NavGrid } from '@/engine/nav';
import type { Ctx, LevelKey } from '@/engine/types';

type PerchCtx = Pick<Ctx, 'level' | 'world' | 'nav' | 'bossNav'>;
function withMap(key: LevelKey, check: (ctx: PerchCtx) => void, arena = false) {
  const scene = new Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena });
  try {
    const nav = new NavGrid(world, level.bounds);
    const bossNav = new NavGrid(world, level.bounds, 1, BOSS_CLEARANCE, BOSS_HEADROOM);
    nav.build(); bossNav.build();
    check({ level, world, nav, bossNav });
  } finally { disposeLevel(scene, level); world.clear(); }
}

// Independent physics check, including the connection from the real player spawn.
function walk(world: World, start: Vector3, route: Vector3[]) {
  const body = new Body(start, .35, 1.75, .55);
  for (let frame = 0; frame < 60; frame++) {
    body.vel.y -= 26 / 60;
    world.moveBody(body, 1 / 60);
  }
  for (const target of route) {
    for (let frame = 0; frame < 900; frame++) {
      const dx = target.x - body.pos.x, dz = target.z - body.pos.z, distance = Math.hypot(dx, dz);
      if (distance < .07) break;
      const speed = Math.min(4, distance * 60);
      body.vel.set(dx / distance * speed, body.vel.y - 26 / 60, dz / distance * speed);
      world.moveBody(body, 1 / 60);
    }
    expect(body.pos.distanceTo(target), `walk reached ${body.pos.toArray()}, expected ${target.toArray()}`).toBeLessThan(.1);
    expect(body.onGround).toBe(true);
    expect(world.overlapsBody(body)).toBe(false);
  }
}

for (const [key, coordinates, eligible] of [
  ['downtown', [0, 16, -3], true], ['house', [0, 13.52, 1.3], false], ['mexico', [-40, 6.35, -20], true],
] as const) test(`${key}: authored roof marker and actual walking eligibility`, () => withMap(key, ctx => {
  const marker = ctx.level.bossPerch!;
  expect(marker.position.toArray()).toEqual(coordinates);
  expect(ctx.world.overlapsBody(new Body(marker.position, .528, 2.96))).toBe(false);
  expect(ctx.world.groundBelow(marker.position.x, marker.position.y + .03, marker.position.z, .06)).toBeCloseTo(marker.position.y);
  if (eligible) {
    expect(marker.route.length).toBeGreaterThan(2);
    walk(ctx.world, ctx.level.playerStart, marker.route);
    expect(validBossPerch(ctx)?.toArray()).toEqual(coordinates);
  } else {
    expect(marker.route).toEqual([]); // House roof is sealed above 2F.
    expect(validBossPerch(ctx)).toBeNull();
    walk(ctx.world, ctx.level.playerStart, [[-1.3, 0, 11.7], [-1.3, 0, 9.1], [2.6, 0, 9.1],
      [2.6, 4.68, .65]].map(p => new Vector3(...p)));
  }
}));

test('missing, non-finite, unsupported and wrong-floor markers fall back', () => withMap('downtown', ctx => {
  delete ctx.level.bossPerch;
  expect(validBossPerch(ctx)).toBeNull();
  for (const [x, y, z] of [[NaN, 16, -3], [0, 16.5, -3], [0, 160, -3], [70, 16, -3]] as const) {
    assignBossPerch(ctx.level);
    ctx.level.bossPerch!.position.set(x, y, z);
    expect(validBossPerch(ctx)).toBeNull();
  }
  assignBossPerch(ctx.level);
  ctx.level.bossPerch!.route[0]!.x = Infinity;
  expect(validBossPerch(ctx)).toBeNull();
}));

test('nav nearest fallback on another floor cannot approve a supported marker', () => withMap('downtown', ctx => {
  const marker = ctx.level.bossPerch!;
  const fakeWorld = new World();
  fakeWorld.addBox(new Vector3(-5, 7, -8), new Vector3(5, 8, 2)); fakeWorld.finalize();
  const wrongFloor = new NavGrid(fakeWorld, { minX: -5, maxX: 5, minZ: -8, maxZ: 2 }); wrongFloor.build();
  expect(wrongFloor.nearest(marker.position)).toBeGreaterThanOrEqual(0);
  expect(validBossPerch({ ...ctx, nav: wrongFloor })).toBeNull();
  expect(validBossPerch({ ...ctx, bossNav: wrongFloor })).toBeNull();
}));

test('rechecks AIMBOT width, headroom and support after a successful validation', () => withMap('downtown', ctx => {
  expect(validBossPerch(ctx)).not.toBeNull();
  const widthBlock = ctx.world.addBox(new Vector3(.45, 16, -3.2), new Vector3(.6, 17, -2.8));
  ctx.world.finalize();
  expect(validBossPerch(ctx)).toBeNull();
  ctx.world.removeBox(widthBlock);
  const ceiling = ctx.world.addBox(new Vector3(-1, 18.8, -4), new Vector3(1, 19, -2));
  ctx.world.finalize();
  expect(validBossPerch(ctx)).toBeNull();
  ctx.world.removeBox(ceiling);
  expect(validBossPerch(ctx)).not.toBeNull();
  const roof = ctx.world.boxes.find(b => b.max.y === 16 && b.min.x === -7 && b.max.x === 7)!;
  ctx.world.removeBox(roof);
  expect(validBossPerch(ctx)).toBeNull();
}));

test('a reachable stair approach cannot hide a blocked player-start connection', () => withMap('downtown', ctx => {
  expect(validBossPerch(ctx)).not.toBeNull();
  // Block the walk to the first waypoint, leaving both the spawn and stairs clear.
  ctx.world.addBox(new Vector3(-5.1, 0, 40), new Vector3(-4.9, 4, 44));
  ctx.world.finalize();
  expect(validBossPerch(ctx)).toBeNull();
}));

test('a broken stair route cannot be replaced by navigation or a jump', () => withMap('downtown', ctx => {
  expect(validBossPerch(ctx)).not.toBeNull();
  ctx.world.addBox(new Vector3(-3, 0, -9.2), new Vector3(-2.5, 6, -7.4));
  ctx.world.finalize();
  expect(validBossPerch(ctx)).toBeNull();
}));

test('arena Downtown has no tower marker', () => withMap('downtown', ctx => {
  expect(ctx.level.bossPerch).toBeUndefined();
  expect(validBossPerch(ctx)).toBeNull();
}, true));

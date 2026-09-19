import { expect, test } from 'vitest';
import { BufferGeometry, Material, Mesh, PerspectiveCamera, Scene, Sprite, Texture, Vector3 } from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { Body, World } from '@/engine/physics';
import { TONE, TONE_HEX, unlitMat } from '@/engine/render';
import { createTeamWorld, teamLayout } from '@/engine/game/team-world';
import type { Point, TeamMatch } from '@/engine/game/team-rules';
import type { Ctx } from '@/engine/types';

function clearGround(world: World, point: Point, radius: number) {
  // A conservative square encloses the entire interaction disk and player footprint.
  expect(world.overlapsBody(new Body(new Vector3(...point), radius + 0.35, 1.75)), `blocked area at ${point}`).toBe(false);
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    if (Math.hypot(x, z) > 8) continue;
    const pos = new Vector3(point[0] + x * radius / 8, point[1], point[2] + z * radius / 8);
    for (const x of [-0.35, 0, 0.35]) for (const z of [-0.35, 0, 0.35]) {
      expect(world.groundBelow(pos.x + x, pos.y + 0.05, pos.z + z, 0.1), `unsupported at ${pos.toArray()}`).toBeCloseTo(pos.y, 5);
    }
  }
}

function walk(world: World, points: Point[]) {
  const body = new Body(new Vector3(...points[0]!), 0.35, 1.75, 0.55);
  body.onGround = true;
  for (const point of points.slice(1)) {
    let lowest = body.pos.y, highest = body.pos.y;
    for (let frame = 0; frame < 900; frame++) {
      const dx = point[0] - body.pos.x, dz = point[2] - body.pos.z, distance = Math.hypot(dx, dz);
      if (distance < 0.04) break;
      const speed = Math.min(4, distance * 60);
      body.vel.set(dx / distance * speed, body.vel.y - 26 / 60, dz / distance * speed);
      world.moveBody(body, 1 / 60);
      lowest = Math.min(lowest, body.pos.y); highest = Math.max(highest, body.pos.y);
    }
    expect(body.pos.distanceTo(new Vector3(...point)), `walk reached ${body.pos.toArray()}, wanted ${point}`).toBeLessThan(0.06);
    expect(lowest, 'no basement or pit fall').toBeGreaterThanOrEqual(-0.01);
    expect(highest, 'no rooftop route or jump required').toBeLessThan(0.2);
    expect(body.onGround).toBe(true);
  }
}

for (const key of ['downtown', 'house', 'mexico'] as const) test(`${key}: safe, separate team areas and walkable flag routes`, () => {
  const scene = new Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena: true });
  try {
    const layout = teamLayout(level);
    expect(teamLayout(level)).toEqual(layout);
    clearGround(world, layout.neutral, 1.8);
    for (const team of [0, 1] as const) {
      const base = layout.bases[team], other = layout.bases[team === 0 ? 1 : 0];
      clearGround(world, base, 2.5);
      expect(layout.spawns[team]).toHaveLength(4);
      for (const point of [base, layout.neutral, ...layout.spawns[team]]) {
        expect(point[0] - 0.35).toBeGreaterThan(level.bounds.minX);
        expect(point[0] + 0.35).toBeLessThan(level.bounds.maxX);
        expect(point[2] - 0.35).toBeGreaterThan(level.bounds.minZ);
        expect(point[2] + 0.35).toBeLessThan(level.bounds.maxZ);
      }
      for (const spawn of layout.spawns[team]) {
        clearGround(world, spawn, 0.75);
        for (const target of [base, other, layout.neutral]) {
          expect(new Vector3(...spawn).distanceTo(new Vector3(...target)), 'spawn separate from objectives').toBeGreaterThan(8);
        }
        const sign = team === 0 ? -1 : 1;
        const approach: Point[] = key === 'mexico' ? [[sign * 50, 0, 8], [sign * 28, 0, 8]] : [];
        walk(world, [spawn, ...approach, base]);
      }
      // Both directions must work: picking up the flag must not trap its carrier.
      walk(world, [base, layout.neutral, other, layout.neutral, base]);
    }
    const original = teamLayout(level);
    level.teamSpawns.length = 0; level.arenaSpawns.length = 0; level.spawns.length = 0;
    expect(teamLayout(level)).toEqual(original);
    layout.neutral[0] += 100;
    layout.bases[0][0] += 100;
    layout.spawns[0][0]![0] += 100;
    expect(teamLayout(level)).toEqual(original); // No shared mutable coordinate arrays.
  } finally { disposeLevel(scene, level); world.clear(); }
});

test('team objectives follow state and carriers, remain cosmetic, and release only owned resources', () => {
  const scene = new Scene(), world = new World(), camera = new PerspectiveCamera();
  const level = buildLevel(scene, world, 'downtown', { arena: true });
  const sceneBefore = [...scene.children], boxesBefore = [...world.boxes], meshesBefore = [...level.meshes];
  const local = { alive: true, body: new Body(new Vector3(5, 0, 10), 0.35, 1.75) };
  const remote = { alive: true, body: new Body(new Vector3(-4, 4, 9), 0.35, 1.05) };
  const ctx = { scene, camera, level, world, player: local, remotes: new Map([['remote', remote]]) } as unknown as Ctx;
  const state: TeamMatch = {
    mode: 'flag', scores: [0, 0], elapsed: 0, round: 1, roundLeft: 150, breakLeft: 0,
    overtime: false, streakTeam: null, streak: 0, winner: null, dead: {},
    flag: { carrier: null, placed: null, pos: teamLayout(level).neutral, holdLeft: 30, returnLeft: 0 },
  };
  const views = createTeamWorld(ctx), root = scene.getObjectByName('teamWorld')!;
  const flag = root.getObjectByName('teamFlag')!, neutral = root.getObjectByName('FLAG START')!;
  const cloth = root.getObjectByName('flagCloth') as Mesh<BufferGeometry, import('three').MeshBasicMaterial>;
  const owned = new Set<BufferGeometry | Material | Texture>();
  let sharedDisposals = 0;
  const shared = [TONE_HEX[TONE.HOSTILE], TONE_HEX[TONE.PRIMARY], TONE_HEX[TONE.ACCENT], 0x263640, 0xffffff].map(unlitMat);
  const sharedDisposed = () => sharedDisposals++;
  for (const mat of shared) mat.addEventListener('dispose', sharedDisposed);
  root.traverse(obj => {
    if (obj instanceof Mesh) owned.add(obj.geometry);
    if (obj instanceof Mesh || obj instanceof Sprite) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        owned.add(mat);
        if ('map' in mat && mat.map instanceof Texture) owned.add(mat.map);
        expect(mat.type).not.toBe('ShaderMaterial');
        expect(mat.fog).toBe(false);
      }
    }
  });
  const disposals = new Map([...owned].map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource)! + 1));
  try {
    expect(root.getObjectByName('RED BASE')?.position.toArray()).toEqual([-48, 0, 0]);
    expect(root.getObjectByName('BLUE BASE')?.position.toArray()).toEqual([48, 0, 0]);
    const labels: Sprite[] = [];
    root.traverse(obj => { if (obj instanceof Sprite) labels.push(obj); });
    expect(labels.map(label => label.name)).toEqual(['RED BASE', 'BLUE BASE', 'FLAG START', 'FLAG', 'FLAG CARRIER']);
    expect(flag.visible).toBe(false);
    views.update(state, { self: 0, remote: 1 }, 'self');
    expect(flag.visible && neutral.visible).toBe(true);
    expect(flag.position.toArray()).toEqual(state.flag.pos);
    expect(cloth.material.color.getHex()).toBe(TONE_HEX[TONE.ACCENT]);
    state.flag.carrier = 'remote';
    views.update(state, { self: 0, remote: 1 }, 'self');
    expect(flag.position.toArray()).toEqual([-4, 5.4, 9]);
    expect(cloth.material.color.getHex()).toBe(TONE_HEX[TONE.PRIMARY]);
    expect(root.getObjectByName('FLAG CARRIER')?.visible).toBe(true);
    expect(root.getObjectByName('FLAG')?.visible).toBe(false);
    remote.body.pos.set(12, 0, 18);
    views.update(state, { self: 0, remote: 1 }, 'self');
    expect(flag.position.toArray()).toEqual([12, 1.4, 18]);
    state.flag.carrier = 'self';
    views.update(state, { self: 0 }, 'self');
    expect(flag.position.toArray()).toEqual([5, 2.1, 10]);
    expect(cloth.material.color.getHex()).toBe(TONE_HEX[TONE.HOSTILE]);
    state.flag.carrier = 'missing'; state.flag.pos = [8, 0, 8];
    views.update(state, {}, 'self');
    expect(flag.position.toArray()).toEqual([8, 2.1, 8]);
    expect(cloth.material.color.getHex()).toBe(TONE_HEX[TONE.ACCENT]);
    state.flag.carrier = null; state.flag.placed = 1; state.flag.pos = [48, 0, 0];
    views.update(state, {}, 'self');
    expect(flag.position.toArray()).toEqual([48, 0, 0]);
    expect(cloth.material.color.getHex()).toBe(TONE_HEX[TONE.PRIMARY]);
    state.breakLeft = 5;
    views.update(state, {}, 'self');
    expect(flag.visible || neutral.visible).toBe(false);
    state.breakLeft = 0; state.mode = 'tdm';
    views.update(state, {}, 'self');
    expect(flag.visible || neutral.visible).toBe(false);
    expect(world.boxes).toEqual(boxesBefore);
    expect(level.meshes).toEqual(meshesBefore);
    views.dispose(); views.dispose();
    views.update(state, {}, 'self');
    expect(scene.children).toEqual(sceneBefore);
    expect([...disposals.values()].every(count => count === 1)).toBe(true);
    expect(sharedDisposals).toBe(0);
    const rebuilt = createTeamWorld(ctx);
    rebuilt.update({ ...state, mode: 'flag' }, {}, 'self');
    expect(scene.getObjectByName('teamFlag')?.visible).toBe(true);
    rebuilt.dispose();
    expect(scene.children).toEqual(sceneBefore);
  } finally {
    views.dispose();
    for (const mat of shared) mat.removeEventListener('dispose', sharedDisposed);
    disposeLevel(scene, level); world.clear();
  }
});

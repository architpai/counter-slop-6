import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { buildLevel, disposeLevel } from '@/engine/level/index';
import { LevelBuilder } from '@/engine/level/build';
import { World } from '@/engine/physics';
import { createBreakables } from '@/engine/game/breakables';
import { clearProjectiles, removeProjectile, spawnProjectile, updateProjectiles } from '@/engine/enemies/projectiles';
import { TONE, charMat } from '@/engine/render/index';
import { boltColor, boltMaterial } from '@/engine/render/fx';
import type { EnemyManager } from '@/engine/enemies/index';
import type { PickupsApi } from '@/engine/game/pickups';
import type { Ctx, Level } from '@/engine/types';

/** A mesh's triangles in world space, as flat corner arrays, zero-area ones left out. */
function triangles(mesh: THREE.Mesh): number[][] {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index, out: number[][] = [];
  const n = index ? index.count : position.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const corner = (i: number, v: THREE.Vector3) => v.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (let i = 0; i < n; i += 3) {
    corner(i, a); corner(i + 1, b); corner(i + 2, c);
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() < 1e-14) continue;
    out.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
  }
  return out;
}

/** Two triangle lists the same to `eps` (float32 world positions), order aside. */
function sameTriangles(actual: number[][], expected: number[][], eps = 1e-4): void {
  const key = (t: number[]) => t.map(v => Math.round(v * 100)).join();
  const sort = (list: number[][]) => [...list].sort((p, q) => (key(p) < key(q) ? -1 : key(p) > key(q) ? 1 : 0));
  const a = sort(actual), b = sort(expected);
  expect(a.length).toBe(b.length);
  let worst = 0;
  a.forEach((t, i) => t.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - b[i]![j]!)); }));
  expect(worst).toBeLessThan(eps);
}

const mexico = (): { level: Level; world: World; scene: THREE.Scene } => {
  const scene = new THREE.Scene(), world = new World();
  return { level: buildLevel(scene, world, 'mexico'), world, scene };
};

test('Mexico\'s breakable props draw from one batch per surface key, their parts hidden in place (V19)', () => {
  const { level, scene } = mexico();
  expect(level.breakables.length).toBe(48);
  const batches = level.surfaces.filter(s => s.mesh.name === 'breakables');
  const parts = level.breakables.flatMap(prop => prop.group.children as THREE.Mesh[]);
  expect(parts.length).toBe(249);
  // One mesh per surface key, one group per tag, as the merged level: 249 meshes are 7 draws on Low.
  expect(batches.length).toBe(new Set(batches.map(s => s.surf)).size);
  expect(batches.length).toBeLessThanOrEqual(8);
  for (const { mesh, materials } of batches) {
    expect(mesh.parent).toBe(scene);
    expect([mesh.castShadow, mesh.receiveShadow]).toEqual([true, true]);
    expect(mesh.geometry.groups.map(g => g.materialIndex)).toEqual(materials.map((_, i) => i));
  }
  // The parts stay level surfaces (the look swaps their materials for when they fly as debris), hidden.
  const surfaces = new Set(level.surfaces.map(s => s.mesh));
  for (const part of parts) {
    expect(part.visible).toBe(false);
    expect(surfaces.has(part)).toBe(true);
  }
  // The batches hold exactly the parts' triangles.
  sameTriangles(batches.flatMap(s => triangles(s.mesh)), parts.flatMap(triangles));
  disposeLevel(scene, level);
});

test('a break drops the prop from its batch and throws its parts; a hit, a blast and the restart work as before', () => {
  const { level, world, scene } = mexico();
  const debris: THREE.Object3D[] = [];
  const effects = {
    debris: vi.fn((mesh: THREE.Object3D) => { scene.attach(mesh); debris.push(mesh); }),
    strokeBurst: vi.fn(), smoke: vi.fn(), explosion: vi.fn(), blood: vi.fn(), bloodPool: vi.fn(),
  };
  const ctx = { level, world, scene, effects, audio: { smash: vi.fn(), shieldHit: vi.fn() },
    net: { active: false, isHost: false, broadcast: vi.fn() }, game: { isOnline: () => false, addScore: vi.fn() } } as unknown as Ctx;
  const props = createBreakables(ctx, { spawn: vi.fn() } as unknown as PickupsApi);
  const batches = level.surfaces.filter(s => s.mesh.name === 'breakables').map(s => s.mesh);
  const drawn = () => batches.reduce((n, mesh) => n + triangles(mesh).length, 0);
  const all = drawn();
  const crate = level.breakables.find(p => p.kind === 'crate')!, pot = level.breakables.find(p => p.kind === 'potS')!;
  const own = (prop: typeof crate) => (prop.group.children as THREE.Mesh[]).reduce((n, mesh) => n + triangles(mesh).length, 0);
  // A hit that leaves it standing changes nothing drawn.
  props.hit(crate, 10, crate.pos.clone(), new THREE.Vector3(0, 0, -1));
  expect([crate.alive, crate.hp, drawn()]).toEqual([true, 20, all]);
  const parts = [...crate.group.children], crateTris = own(crate);
  props.hit(crate, 25, crate.pos.clone(), new THREE.Vector3(0, 0, -1));
  expect(crate.alive).toBe(false);
  expect(world.boxes).not.toContain(crate.box);
  // Its parts fly, shown; the batch no longer draws them, and draws every other prop as before.
  expect(debris).toEqual(parts);
  for (const part of parts) expect(part.visible).toBe(true);
  expect(drawn()).toBe(all - crateTris);
  // Uploaded as a part of the buffer, not the whole.
  const ranges = batches.flatMap(mesh => (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).updateRanges);
  expect(ranges.reduce((n, range) => n + range.count, 0)).toBe(3 * parts.reduce((n, part) => n + (part as THREE.Mesh).geometry.getAttribute('position').count, 0));
  // A quiet break (a late joiner's sync) drops it too, with no debris.
  const before = drawn(), potTris = own(pot);
  props.breakProp(pot, null, false, true);
  expect(drawn()).toBe(before - potTris);
  expect(debris).toHaveLength(parts.length);
  // A blast breaks what stands in it the same way.
  const cactus = level.breakables.find(p => p.kind === 'cactus')!, cactusTris = own(cactus), mid = drawn();
  props.blast(cactus.pos, 1);
  expect(cactus.alive).toBe(false);
  expect(drawn()).toBe(mid - cactusTris);
  // Tearing the level down (a restart rebuilds it) collapses nothing still standing.
  const standing = drawn();
  for (const root of level.meshes) scene.remove(root);
  expect(drawn()).toBe(standing);
  disposeLevel(scene, level);
});

test('the mariachis merge per moving pivot and material, and keep every triangle where it was', () => {
  // The same pose built twice, merged and not.
  const build = (merge: boolean) => {
    const scene = new THREE.Scene(), b = new LevelBuilder(scene, new World(), 'mexico', false);
    const root = new THREE.Group(), torso = new THREE.Group(), head = new THREE.Group(), hidden = new THREE.Group();
    root.position.set(2, 1.2, -27);
    root.rotation.y = 0.4;
    torso.position.y = 0.9;
    torso.rotation.z = 0.05;
    head.position.set(0, 0.5, 0.02);
    head.rotation.x = -0.25;
    root.add(torso);
    torso.add(head, hidden);
    hidden.visible = false;
    const mesh = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, color: number, x: number, y: number) => {
      const m = new THREE.Mesh(geometry, charMat(color));
      m.position.set(x, y, 0);
      m.rotation.set(0.3 * x, 0.2 * y, 0);
      parent.add(m);
      return m;
    };
    mesh(root, new THREE.CylinderGeometry(0.1, 0.1, 0.8, 7), 0x404040, -0.1, 0.4);
    mesh(root, new THREE.CylinderGeometry(0.1, 0.1, 0.8, 7), 0x404040, 0.1, 0.4);
    mesh(torso, new THREE.BoxGeometry(0.5, 0.6, 0.3), 0x404040, 0, 0.3);
    mesh(torso, new THREE.SphereGeometry(0.08, 8, 4), 0x202020, 0.3, 0.2);
    mesh(head, new THREE.SphereGeometry(0.2, 8, 4), 0x404040, 0, 0.1);
    mesh(hidden, new THREE.BoxGeometry(0.1, 0.1, 0.1), 0x202020, 0, 0);
    const hat = b.part(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 8), 'accent', 'fabric');
    const band = b.part(new THREE.TorusGeometry(0.24, 0.03, 6, 12), 'accent', 'fabric');
    hat.position.y = 0.5;
    band.position.y = 0.56;
    head.add(hat, band);
    b.addObject(root);
    if (merge) b.rigid(root, [torso, head]);
    root.updateMatrixWorld(true);
    const shown: THREE.Mesh[] = [];
    root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) shown.push(o as THREE.Mesh); });
    return { root, torso, head, hidden, shown, surfaces: b.level.surfaces };
  };
  const plain = build(false), merged = build(true);
  sameTriangles(merged.shown.flatMap(triangles), plain.shown.flatMap(triangles));
  // 7 meshes shown were 7 draws: the legs merge on the root, the body alone and the charm (another colour) on the
  // torso, the head, and the hat with its band (one tag) on the head.
  expect(plain.shown).toHaveLength(7);
  expect(merged.shown).toHaveLength(5);
  expect(merged.head.children.filter(o => (o as THREE.Mesh).isMesh)).toHaveLength(2);
  // Hidden meshes stay as they are; the hat's level surface is now the merged one.
  expect(merged.hidden.children).toHaveLength(1);
  expect(merged.surfaces).toHaveLength(1);
  expect(merged.surfaces[0]!.mesh.parent).toBe(merged.head);
  expect(merged.surfaces[0]!.materials).toEqual(['fabric']);
  // The pivots the band moves still carry their meshes.
  for (const figure of [plain, merged]) {
    figure.torso.rotation.z = 0.3;
    figure.head.rotation.z = -0.2;
    figure.root.position.y = 1.35;
    figure.root.updateMatrixWorld(true);
  }
  sameTriangles(merged.shown.flatMap(triangles), plain.shown.flatMap(triangles));
});

test('enemy bolts are instances of one mesh: no mesh or geometry per shot (V19)', () => {
  const scene = new THREE.Scene(), world = new World();
  world.addBox(new THREE.Vector3(-50, -1, -50), new THREE.Vector3(50, 0, 50));
  world.finalize();
  const m = { ids: 1, projectiles: [], ctx: { scene, world, game: { targets: () => [] }, effects: { bulletImpact: vi.fn(), explosion: vi.fn() },
    audio: { bulletImpact: vi.fn(), explosion: vi.fn() } }, onFire: null } as unknown as EnemyManager;
  const fire = (tone: number, x: number) => spawnProjectile(m, new THREE.Vector3(x, 1.5, 0), new THREE.Vector3(0, 0, -1), 40, 10, null, tone, 0.2, false);
  for (let i = 0; i < 12; i++) fire(i % 2 ? TONE.HOSTILE : TONE.BOSS, i);
  // Laid out once a frame, at the end of the update (a zero step moves nothing).
  updateProjectiles(m, 0);
  const meshes = scene.children.filter(o => (o as THREE.Mesh).isMesh) as THREE.InstancedMesh[];
  expect(meshes).toHaveLength(1);
  const bolts = meshes[0]!;
  expect(bolts.isInstancedMesh).toBe(true);
  expect(bolts.material).toBe(boltMaterial());
  expect(bolts.count).toBe(12);
  // Placed along their flight, in their tone.
  const at = new THREE.Matrix4(), place = new THREE.Vector3(), tint = new THREE.Color();
  bolts.getMatrixAt(3, at);
  expect(place.setFromMatrixPosition(at).toArray().map(v => +v.toFixed(3))).toEqual([3, 1.5, 0]);
  bolts.getColorAt(3, tint);
  const hostile = boltColor(TONE.HOSTILE, new THREE.Color());
  for (const c of ['r', 'g', 'b'] as const) expect(tint[c]).toBeCloseTo(hostile[c], 5);
  // They move with the update, and leave the batch when they go.
  updateProjectiles(m, 0.05);
  bolts.getMatrixAt(0, at);
  expect(place.setFromMatrixPosition(at).z).toBeCloseTo(-2, 5);
  removeProjectile(m, 0);
  updateProjectiles(m, 0);
  expect(bolts.count).toBe(11);
  for (let i = 0; i < 400; i++) fire(TONE.HOSTILE, 0);
  updateProjectiles(m, 0);
  expect(scene.children.filter(o => (o as THREE.Mesh).isMesh)).toHaveLength(1);
  expect(bolts.count).toBe(240);
  // A match's end clears them at once and hides the batch, with no update to follow.
  clearProjectiles(m);
  expect([m.projectiles.length, bolts.count, bolts.visible]).toEqual([0, 0, false]);
});

test('bolts are laid out once a frame, not once per shot: a full volley and a clear stay linear', () => {
  const scene = new THREE.Scene(), world = new World();
  world.addBox(new THREE.Vector3(-50, -1, -50), new THREE.Vector3(50, 0, 50));
  world.finalize();
  const m = { ids: 1, projectiles: [], ctx: { scene, world, game: { targets: () => [] }, effects: { bulletImpact: vi.fn(), explosion: vi.fn() },
    audio: { bulletImpact: vi.fn(), explosion: vi.fn() } }, onFire: null } as unknown as EnemyManager;
  updateProjectiles(m, 0);
  const bolts = scene.getObjectByName('projectiles') as THREE.InstancedMesh;
  const setMatrixAt = vi.spyOn(bolts, 'setMatrixAt');
  for (let i = 0; i < 240; i++) spawnProjectile(m, new THREE.Vector3(i * 0.1, 1.5, 0), new THREE.Vector3(0, 0, -1), 40, 10, null, TONE.HOSTILE, 0.2, false);
  expect(setMatrixAt).not.toHaveBeenCalled();
  updateProjectiles(m, 0.01);
  expect(setMatrixAt).toHaveBeenCalledTimes(240);
  clearProjectiles(m);
  expect(setMatrixAt).toHaveBeenCalledTimes(240);
});

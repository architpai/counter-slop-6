import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Effects } from '@/engine/effects';
import { DECAL_GREY, REAL_CAPACITY, RealEffects, holeTint } from '@/engine/effects-real';
import { World } from '@/engine/physics';
import { LevelBuilder } from '@/engine/level/build';
import {
  FX_ATLASES, FX_MANIFEST, FxAssets, cells, decalMaterial, flatDecalMaterial, flipbookFrame, fxDownloadBytes, fxTemplate,
  fxTextureSize, fxUrl, flashMaterial, hazardSmokeMaterial, lowFlashMaterial, spriteMaterial, splatMaterial, tracerMaterial,
} from '@/engine/render/fx';
import { SURFACE_FAMILY, impactFor, surfaceAt, surfaceOf } from '@/engine/render/impacts';
import { buildLevel, disposeLevel } from '@/engine/level';
import { MATERIAL_TAGS, TEXTURE_SIZE } from '@/engine/render/surfaces';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { RealContext } from '@/engine/effects-real';
import { EnemyHazards } from '@/engine/enemies/hazards';
import { surfMat, unlitMat } from '@/engine/render/materials';
import { TONE, TONE_HEX } from '@/engine/render/palette';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const up = V(0, 1, 0);

/** A realistic context on bare scenes: two pooled lights, the eye at the origin. */
function context(soft: boolean): RealContext & { lights: THREE.PointLight[] } {
  const scene = new THREE.Scene(), late = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const lights = [new THREE.PointLight(), new THREE.PointLight()];
  scene.add(camera, ...lights);
  return { scene, late, camera, lights, soft };
}

test('a hit\'s collider picks its family, recipe, colours and hole', () => {
  // Every tag has a family, and the recipe follows it.
  for (const tag of MATERIAL_TAGS) expect(SURFACE_FAMILY[tag], tag).toBeDefined();
  const steel = impactFor({ material: 'steel', surf: 'metal' });
  expect([steel.family, steel.decal, steel.sparks > 0, steel.dust, steel.chips]).toEqual(['metal', 'metal', true, 0, 0]);
  const brick = impactFor({ material: 'brick', surf: 'block' });
  expect([brick.family, brick.decal, brick.sparks, brick.dust > 0, brick.chips > 0]).toEqual(['masonry', 'masonry', 0, true, true]);
  for (const tag of ['concrete', 'plaster', 'stucco', 'adobe'] as const) expect(impactFor({ material: tag }).family, tag).toBe('masonry');
  expect(impactFor({ material: 'planks' }).splinters).toBeGreaterThan(0);
  expect(impactFor({ material: 'glass' }).shards).toBeGreaterThan(0);
  for (const tag of ['sand', 'grass'] as const) expect(impactFor({ material: tag }).family, tag).toBe('soil');
  // Water splashes and leaves no hole.
  expect(impactFor({ material: 'water' }).decal).toBeNull();
  // Brick dust is red, a painted surface takes its own colour, a hole is darker than its surface.
  const red = (hex: number) => (hex >> 16) & 255, green = (hex: number) => (hex >> 8) & 255;
  expect(red(brick.dustColor)).toBeGreaterThan(green(brick.dustColor));
  expect(impactFor({ material: 'plaster', surf: 'roof' }).color).toBe(0xc87651);
  expect(red(brick.hole)).toBeLessThan(red(brick.color));
  // Dust reads against its own surface: lighter off dark brick, darker off pale paving.
  const luma = (hex: number) => 0.2126 * red(hex) + 0.7152 * green(hex) + 0.0722 * (hex & 255);
  const paving = impactFor({ material: 'paving', surf: 'ground' });
  expect(luma(brick.dustColor)).toBeGreaterThan(luma(brick.color));
  if (luma(paving.color) > 0.55 * 255) expect(luma(paving.dustColor)).toBeLessThan(luma(paving.color) - 20);
  // A realistic hole's rim is its surface's own colour (the atlas's rim grey times the tint), never lighter.
  const tint = new THREE.Color(), surface = new THREE.Color();
  for (const tag of ['sandstone', 'cast-concrete', 'brick', 'planks', 'grass', 'plaster'] as const) {
    const hit = impactFor({ material: tag }), [rim, top] = DECAL_GREY[hit.family]!;
    holeTint(hit.family, hit.color, tint);
    surface.setHex(hit.color);
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(tint[channel] * rim, `${tag} ${channel}`).toBeLessThanOrEqual(surface[channel] + 1e-6);
      expect(tint[channel] * top, `${tag} ${channel}`).toBeLessThanOrEqual(1 + 1e-6);
      if (surface[channel] * top / rim <= 1) expect(tint[channel] * rim, `${tag} ${channel}`).toBeCloseTo(surface[channel], 6);
    }
  }
  // Glass keeps its white cracks untinted.
  expect(holeTint('glass', 0x335577, tint).toArray()).toEqual([1, 1, 1]);
  // A box nothing tagged (the map's invisible shell) reads as concrete, and junk as the default.
  expect(surfaceOf(undefined)).toEqual({ tag: 'concrete', surf: 'ground' });
  expect(surfaceOf({ material: 'lava' as never, surf: 'nope' as never })).toEqual({ tag: 'concrete', surf: 'ground' });
});

test('the level builder writes each collider\'s tag, a bare collider takes the piece it overlaps most', () => {
  const scene = new THREE.Scene(), world = new World();
  const b = new LevelBuilder(scene, world, 'downtown', false);
  const wall = b.box(0, 0, 0, 4, 3, 0.3, { mat: 'block', material: 'brick' })!;
  const post = b.cylinder(6, 0, 0, 0.2, 3, { mat: 'metal' })!;
  // Stairs drawn as boxes with no colliders, and one ramp collider over them (as House does).
  b.box(10, 0, 0, 2, 0.5, 1, { mat: 'wood', material: 'planks', noCollide: true });
  b.box(10, 0, 1, 2, 1, 1, { mat: 'wood', material: 'planks', noCollide: true });
  b.box(10, 0, 2, 0.1, 0.1, 0.1, { mat: 'metal', material: 'steel', noCollide: true });
  const ramp = b.collider(10, 0, 1, 2, 1, 3);
  const shell = b.collider(0, 50, 0, 10, 2, 10);
  b.finish();
  expect([wall.data.material, wall.data.surf]).toEqual(['brick', 'block']);
  expect([post.data.material, post.data.surf]).toEqual(['steel', 'metal']);
  expect([ramp.data.material, ramp.data.surf]).toEqual(['planks', 'wood']);
  expect(shell.data.material).toBeUndefined();
  expect(impactFor(shell.data).tag).toBe('concrete');
  // Rays report the box, so a hit knows what it hit.
  const hit = world.raycast(V(0, 1.5, 5), V(0, 0, -1), 20);
  expect(hit?.box).toBe(wall);
  expect(impactFor(hit!.box.data).family).toBe('masonry');
  scene.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
});

test('a piece with no collider over a collider\'s face (a path on the lawn) is what a hit there shows, on its own face', () => {
  const scene = new THREE.Scene(), world = new World();
  const b = new LevelBuilder(scene, world, 'house', false);
  const lawn = b.box(0, -1, 0, 20, 1, 20, { mat: 'lawn', material: 'grass' })!;
  b.box(0, 0, 0, 2, 0.05, 10, { mat: 'plaster', noCollide: true, material: 'concrete' });
  // Paint on the path, a steel band on a wall, and a big prop that only stands on the lawn: not an overlay.
  b.box(0, 0.05, 3, 2, 0.02, 0.2, { mat: 'dark', noCollide: true, material: 'road-paint' });
  const wall = b.box(8, 0, 0, 0.3, 3, 6, { mat: 'block', material: 'brick' })!;
  b.box(7.835, 1, 0, 0.03, 0.2, 6, { mat: 'metal', noCollide: true, material: 'steel' });
  b.box(-5, 0, -5, 1.6, 1.4, 1.6, { mat: 'accent', noCollide: true, material: 'painted-metal' });
  b.finish();
  expect(lawn.data.overlays?.map(o => o.material)).toEqual(['concrete', 'road-paint']);
  expect(wall.data.overlays?.map(o => o.material)).toEqual(['steel']);
  const at = (from: THREE.Vector3, dir: THREE.Vector3) => {
    const hit = world.raycast(from, dir, 30)!;
    const face = surfaceAt(hit.box.data, hit.point, hit.normal);
    return [impactFor(face.data).tag, Number(face.lift.toFixed(3))];
  };
  expect(at(V(0, 2, -2), V(0, -1, 0))).toEqual(['concrete', 0.05]);
  expect(at(V(0, 2, 3), V(0, -1, 0))).toEqual(['road-paint', 0.07]);
  expect(at(V(4, 2, 0), V(0, -1, 0))).toEqual(['grass', 0]);
  expect(at(V(-5, 2, -5), V(0, -1, 0))).toEqual(['grass', 0]);
  expect(at(V(0, 1.1, 0), V(1, 0, 0))).toEqual(['steel', 0.03]);
  expect(at(V(0, 2, 0), V(1, 0, 0))).toEqual(['brick', 0]);
  // The effects move the hit out to the path's face: the Low hole sits on the path, not under it.
  const effects = new Effects(scene, world);
  effects.bulletImpact(V(0, 0, -2), V(0, 1, 0), lawn.data);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  effects._holes.mesh.getMatrixAt(0, matrix);
  expect(position.setFromMatrixPosition(matrix).y).toBeGreaterThan(0.05);
  effects.clear();
  scene.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
});

test('House: the concrete path from the player start is concrete, not the lawn under it', () => {
  const scene = new THREE.Scene(), world = new World();
  const level = buildLevel(scene, world, 'house');
  const hit = world.raycast(V(-1, 1.6, 21), V(0, -1, 0), 5)!;
  const face = surfaceAt(hit.box.data, hit.point, hit.normal);
  expect([hit.box.data.material, impactFor(face.data).tag]).toEqual(['grass', 'concrete']);
  disposeLevel(scene, level);
});

test('flipbook frames: two neighbouring cells and their blend, clamped at birth and death', () => {
  expect(flipbookFrame(0, 16, 16)).toEqual({ a: 16, b: 17, blend: 0 });
  expect(flipbookFrame(1, 16, 16)).toEqual({ a: 31, b: 31, blend: 0 });
  const mid = flipbookFrame(0.5, 0, 16);
  expect([mid.a, mid.b]).toEqual([7, 8]);
  expect(mid.blend).toBeCloseTo(0.5, 9);
  expect(flipbookFrame(-3, 0, 16)).toEqual({ a: 0, b: 1, blend: 0 });
  expect(flipbookFrame(Number.NaN, 0, 16)).toEqual({ a: 0, b: 1, blend: 0 });
  expect(flipbookFrame(0.7, 5, 1)).toEqual({ a: 5, b: 5, blend: 0 });
  // Monotonic through the life.
  let last = -1;
  for (let t = 0; t <= 1; t += 0.01) {
    const f = flipbookFrame(t, 0, 16), at = f.a + f.blend;
    expect(at).toBeGreaterThanOrEqual(last);
    last = at;
  }
});

test('the atlases: manifest layout, tier sizes, the Ultra download budget and every file on the server', async () => {
  for (const atlas of FX_ATLASES) {
    const info = FX_MANIFEST[atlas];
    for (const [first, count] of Object.values(info.layout)) expect(first + count).toBeLessThanOrEqual(info.cols * info.rows);
  }
  for (const [name, count] of [['fireball', 16], ['flashFront', 4], ['flashSide', 4], ['spark', 4], ['glow', 1]] as const) expect(cells('fire', name)[1]).toBe(count);
  for (const [name, count] of [['smoke', 16], ['dust', 16], ['chips', 8], ['splinters', 4], ['shards', 4]] as const) expect(cells('smoke', name)[1]).toBe(count);
  for (const family of ['metal', 'masonry', 'wood', 'glass', 'soil', 'scorch']) expect(cells('decals', family)[1]).toBeGreaterThan(0);
  expect(FX_MANIFEST.decals.layout).toEqual(FX_MANIFEST['decals-normal'].layout);
  // R5: the effects download at most 4 MB on Ultra; each tier smaller than the next.
  expect(fxDownloadBytes(2048)).toBeLessThanOrEqual(4e6);
  expect(fxDownloadBytes(512)).toBeLessThan(fxDownloadBytes(1024));
  expect(fxDownloadBytes(1024)).toBeLessThan(fxDownloadBytes(2048));
  expect(fxTextureSize(PRESET_VALUES.low)).toBeNull();
  expect(fxTextureSize(PRESET_VALUES.medium)).toBe(512);
  expect(fxTextureSize(PRESET_VALUES.ultra)).toBe(2048);
  const missing: string[] = [];
  for (const size of Object.values(TEXTURE_SIZE)) for (const atlas of FX_ATLASES) {
    if (!(await fetch(fxUrl(size, atlas), { method: 'HEAD' })).ok) missing.push(fxUrl(size, atlas));
  }
  expect(missing).toEqual([]);
});

test('decals are lit, offset in depth and never write it; the flat look\'s too are offset', () => {
  const decal = decalMaterial();
  expect(decal).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect([decal.polygonOffset, decal.polygonOffsetFactor < 0, decal.polygonOffsetUnits < 0, decal.depthWrite, decal.transparent]).toEqual([true, true, true, false, true]);
  expect(decal.map).not.toBeNull();
  expect(decal.normalMap).not.toBeNull();
  const splat = splatMaterial();
  expect(splat).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect([splat.polygonOffset, splat.polygonOffsetFactor < 0]).toEqual([true, true]);
  const flat = flatDecalMaterial();
  expect(flat).toBeInstanceOf(THREE.MeshBasicMaterial);
  expect([flat.polygonOffset, flat.polygonOffsetFactor < 0]).toEqual([true, true]);
  // Tracers and flashes add light over what is behind them, never write depth.
  for (const material of [tracerMaterial(), flashMaterial(), spriteMaterial('fire')]) expect(material.depthWrite, material.name).toBe(false);
  expect(flashMaterial().blending).toBe(THREE.AdditiveBlending);
  // Soft sprites blend (sorted, in the late pass); dithered ones stay opaque and write depth.
  expect([spriteMaterial('soft').transparent, 'SOFT' in spriteMaterial('soft').defines]).toEqual([true, true]);
  expect([spriteMaterial('dither').transparent, spriteMaterial('dither').depthWrite, 'SOFT' in spriteMaterial('dither').defines]).toEqual([false, true, false]);
  expect('SOFT' in spriteMaterial('fire').defines).toBe(false);
  expect('SOFT' in spriteMaterial('fire-soft').defines).toBe(true);
  // The flat look warms up only the materials it uses; the realistic one every one.
  const materials = (look: 'lowpoly' | 'realistic', soft = false) => {
    const found = new Set<THREE.Material>();
    fxTemplate(look, soft).traverse(node => { if (node instanceof THREE.Mesh) found.add(node.material as THREE.Material); });
    return found;
  };
  expect(materials('lowpoly').has(tracerMaterial())).toBe(true);
  expect(materials('lowpoly').has(decal)).toBe(false);
  for (const material of [decal, splat, flashMaterial(), spriteMaterial('dither'), spriteMaterial('fire')]) {
    expect(materials('realistic').has(material), material.name).toBe(true);
  }
  for (const material of [spriteMaterial('soft'), spriteMaterial('fire-soft')]) expect(materials('realistic', true).has(material), material.name).toBe(true);
  expect(materials('realistic', true).has(spriteMaterial('dither'))).toBe(false);
  // A fight's first grenade and unlit mesh link nothing either: their programs warm at the menu on both looks.
  for (const look of ['lowpoly', 'realistic'] as const) {
    expect(materials(look).has(unlitMat(TONE_HEX[TONE.PRIMARY])), look).toBe(true);
    expect(materials(look).has(surfMat('dark')), look).toBe(true);
    // An enemy's smoke grenade is alpha-hashed, a program variant of its own, shown in flight on every tier.
    expect(materials(look).has(hazardSmokeMaterial()), look).toBe(true);
  }
  // A blended two-sided effect draws once a frame: three draws such a material twice (back, then front) unless told not to.
  const all = new Set([...materials('lowpoly'), ...materials('realistic'), ...materials('realistic', true), lowFlashMaterial()]);
  for (const material of all) {
    if (material.transparent && material.side === THREE.DoubleSide) expect(material.forceSinglePass, material.name).toBe(true);
  }
  expect([flashMaterial().forceSinglePass, lowFlashMaterial().forceSinglePass, tracerMaterial().forceSinglePass]).toEqual([true, true, true]);
});

test('Low\'s grenade blast stays small and short: its opaque balls never fill the view', () => {
  const scene = new THREE.Scene(), world = new World(), effects = new Effects(scene, world);
  effects.boom(V(0, 0.5, -7), 5);
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  let largest = 0, alive = 0;
  for (let frame = 0; frame < 120; frame++) {
    effects.update(1 / 60);
    const drops = effects._drops.mesh;
    for (let i = 0; i < drops.count; i++) {
      drops.getMatrixAt(i, matrix);
      matrix.decompose(position, quaternion, scale);
      largest = Math.max(largest, scale.x);
    }
    // The fireball's big balls are gone within a third of a second.
    if (frame === 20) alive = effects._particles.filter(p => p.size >= 1).length;
  }
  // Metres across: 10 m and half the screen at 7 m before; now at most about 3.4 m.
  expect(largest).toBeLessThan(3.5);
  expect(alive).toBe(0);
  effects.clear();
  for (const mesh of scene.children) if (mesh instanceof THREE.Mesh) mesh.geometry.dispose();
});

test('realistic pools: capped, the oldest slot reused, the detail scales them', () => {
  const ctx = context(false), world = new World();
  const real = new RealEffects(ctx, world);
  const hit = impactFor({ material: 'steel' });
  // Decals: a ring, oldest first.
  for (let i = 0; i < REAL_CAPACITY.decals + 10; i++) real.hole(V(i, 0, 0), up, 'metal', 0x888888, 0.1);
  expect(real._decals.count).toBe(REAL_CAPACITY.decals);
  const matrix = new THREE.Matrix4(), at = V();
  real._decals.getMatrixAt(0, matrix);
  expect(at.setFromMatrixPosition(matrix).x).toBeCloseTo(REAL_CAPACITY.decals, 2);
  // Each decal picks a cell of its family.
  const cell = real._decalCells, info = FX_MANIFEST.decals, [first, count] = cells('decals', 'metal');
  const index = Math.round(cell.getX(0) * info.cols) + Math.round(cell.getY(0) * info.rows) * info.cols;
  expect(index).toBeGreaterThanOrEqual(first);
  expect(index).toBeLessThan(first + count);
  // Sprites never pass their pool's size: a full pool takes the slot nearest its death.
  for (let i = 0; i < 200; i++) real.impact(V(0, 1, -5), V(0, 0, 1), hit, null);
  real.update(1 / 60);
  expect(real._fire.count).toBe(REAL_CAPACITY.fire);
  expect(real._fire.mesh.geometry.instanceCount).toBe(REAL_CAPACITY.fire);
  // Casings: a fixed pool per kind, the oldest dropped.
  for (let i = 0; i < REAL_CAPACITY.shells + 5; i++) real.shell(V(0, 1, 0), V(1, 1, 0), 'rifle');
  real.update(1 / 60);
  expect(real._shells.brass.items.length).toBe(REAL_CAPACITY.shells);
  expect(real._shells.brass.mesh.count).toBe(REAL_CAPACITY.shells);
  real.shell(V(0, 1, 0), V(1, 1, 0), 'shotgun');
  real.update(1 / 60);
  expect(real._shells.shotshell.mesh.count).toBe(1);
  // Half detail: half the slots, and fewer sprites a recipe.
  real.setDetail(0.5);
  expect(real._fire.count).toBeLessThanOrEqual(REAL_CAPACITY.fire / 2);
  expect(real._decals.count).toBe(REAL_CAPACITY.decals / 2);
  real.clear();
  real.impact(V(0, 1, -5), V(0, 0, 1), hit, null);
  expect(real._fire.count).toBe(1 + Math.round(hit.sparks / 2));
  real.dispose();
});

test('pooled lights: a blast takes a light from a shot, a shot never from a blast, and they go dark in time', () => {
  const ctx = context(false), world = new World();
  ctx.camera.position.set(0, 1, 5);
  const real = new RealEffects(ctx, world);
  real.muzzleLight(V(0, 1, 4));
  real.muzzleFlash(V(2, 1, -10), V(0, 0, 1));
  expect(ctx.lights.every(l => l.intensity > 0)).toBe(true);
  real.blast(V(0, 1, -5), 5, true);
  expect(ctx.lights.filter(l => l.intensity > 100)).toHaveLength(1);
  // Both busy with higher priority: a far enemy's flash takes none.
  real.blast(V(4, 1, -5), 5, true);
  const before = ctx.lights.map(l => l.position.x);
  real.muzzleFlash(V(9, 1, -10), V(0, 0, 1));
  expect(ctx.lights.map(l => l.position.x)).toEqual(before);
  // Beyond 45 m nothing lights.
  real.clear();
  real.muzzleLight(V(0, 1, -60));
  expect(ctx.lights.every(l => l.intensity === 0)).toBe(true);
  // A shot's light lasts 50 ms, a blast's 100 ms.
  real.muzzleLight(V(0, 1, 4));
  for (let i = 0; i < 4; i++) real.update(1 / 60);
  expect(ctx.lights.every(l => l.intensity === 0)).toBe(true);
  real.blast(V(0, 1, -5), 5, true);
  for (let i = 0; i < 4; i++) real.update(1 / 60);
  expect(ctx.lights.some(l => l.intensity > 0)).toBe(true);
  for (let i = 0; i < 4; i++) real.update(1 / 60);
  expect(ctx.lights.every(l => l.intensity === 0)).toBe(true);
  real.dispose();
});

test('a flash, a blast\'s glow and a light show at full strength on their first frame, at any frame rate', () => {
  for (const fps of [20, 30, 60, 120]) {
    const ctx = context(false), world = new World();
    ctx.camera.position.set(0, 1, 5);
    const real = new RealEffects(ctx, world);
    const drawn = (life: number) => {
      const alpha = real._fire.mesh.geometry.getAttribute('iColor');
      const i = real._fire.items.slice(0, real._fire.count).findIndex(s => s.maxLife === life);
      return i < 0 ? 0 : alpha.getW(i);
    };
    // The blast's one-frame glow (50 ms) and the enemy's side flash (50 ms) and its glow (40 ms).
    real.blast(V(0, 1, -5), 5, true);
    real.update(1 / fps);
    expect(drawn(0.05), `blast glow at ${fps} fps`).toBeCloseTo(1, 5);
    expect(Math.max(...ctx.lights.map(l => l.intensity)), `blast light at ${fps} fps`).toBeCloseTo(180, 3);
    real.clear();
    real.muzzleFlash(V(2, 1, -10), V(0, 0, 1));
    real.muzzleLight(V(0, 1, 4));
    real.update(1 / fps);
    expect(drawn(0.05), `side flash at ${fps} fps`).toBeCloseTo(1, 5);
    expect(drawn(0.04), `flash glow at ${fps} fps`).toBeCloseTo(1, 5);
    expect(ctx.lights.map(l => l.intensity).sort((a, b) => a - b), `lights at ${fps} fps`).toEqual([7, 10]);
    // Then they age: at 20 fps the 50 ms ones are gone a frame later.
    real.update(1 / fps);
    if (fps === 20) expect([drawn(0.05), ...ctx.lights.map(l => l.intensity)]).toEqual([0, 0, 0]);
    else expect(Math.max(...ctx.lights.map(l => l.intensity))).toBeLessThan(10);
    real.dispose();
  }
});

test('smoke sorts back to front in the soft pass and dithers in the scene pass; a cloud stops on demand', () => {
  const soft = context(true), world = new World();
  soft.camera.position.set(0, 1, 0);
  const real = new RealEffects(soft, world);
  expect(real._lit.mesh.parent).toBe(soft.late);
  expect(real._fire.mesh.parent).toBe(soft.late);
  expect(real._lit.mesh.material).toBe(spriteMaterial('soft'));
  expect(real._decals.parent).toBe(soft.scene);
  for (const z of [-2, -9, -5]) real.smoke(V(0, 1, z), V(0, 1, 0), 1);
  real.update(0);
  const pos = real._lit.mesh.geometry.getAttribute('iPos');
  const depths = [0, 1, 2].map(i => -pos.getZ(i));
  expect(depths).toEqual([...depths].sort((a, b) => b - a));
  const handle = real.smokeCloud(V(0, 1, -10), 3, 8);
  for (let i = 0; i < 60; i++) real.update(1 / 30);
  const lit = () => real._lit.items.slice(0, real._lit.count);
  const tagged = () => lit().filter(s => s.tag === real._cloudTags).length;
  expect(tagged()).toBeGreaterThan(3);
  // A blast (which clears smoke) and a barrel wisp during the cloud are not part of it: stopping it leaves them their own lives.
  real.blast(V(4, 1, -6), 5, true);
  real.muzzleSmoke(V(0, 1.4, -1), V(0, 0, -1), true);
  const others = lit().filter(s => s.tag !== real._cloudTags && s.maxLife > 1.5);
  expect(others.length).toBeGreaterThan(0);
  expect(others.every(s => s.tag === 0)).toBe(true);
  handle.stop();
  for (let i = 0; i < 60; i++) real.update(1 / 30);
  expect(tagged()).toBe(0);
  // 2 s on, the cloud's puffs are gone (cut to 1.2 s) but the blast's lingering smoke (2-3.2 s) is not.
  expect(others.some(s => lit().includes(s) && s.life > 0)).toBe(true);
  real.dispose();
  const flat = context(false), dithered = new RealEffects(flat, world);
  expect(dithered._lit.mesh.parent).toBe(flat.scene);
  expect(dithered._lit.mesh.material).toBe(spriteMaterial('dither'));
  expect(flat.late.children).toHaveLength(0);
  dithered.dispose();
});

test('Low <-> realistic: the realistic pools come and go with nothing left behind, the flat ones stay', () => {
  const scene = new THREE.Scene(), world = new World(), effects = new Effects(scene, world);
  const flatCount = scene.children.length;
  const ctx = { ...context(true), scene };
  const geometries = new Set<THREE.BufferGeometry>();
  let freed = 0;
  for (let trip = 0; trip < 3; trip++) {
    effects.setRealistic(ctx);
    expect(effects.realistic).toBe(true);
    for (const pool of effects._splats) expect(pool.mesh.material).toBe(splatMaterial());
    scene.traverse(node => {
      if (!(node instanceof THREE.Mesh) || geometries.has(node.geometry) || !node.name.startsWith('effects:')) return;
      if (['effects:decals', 'effects:brass', 'effects:shotshell'].includes(node.name)) {
        geometries.add(node.geometry);
        node.geometry.addEventListener('dispose', () => freed++);
      }
    });
    for (const node of ctx.late.children) if (node instanceof THREE.Mesh && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.addEventListener('dispose', () => freed++);
    }
    effects.bulletImpact(V(0, 1, -5), V(0, 0, 1), { material: 'concrete' });
    effects.boom(V(0, 0.5, -8), 5);
    effects.shell(V(0, 1, 0), V(1, 1, 0), 3, 0.02, 'rifle');
    effects.update(1 / 60);
    effects.setRealistic(null);
    expect(effects.realistic).toBe(false);
    expect(scene.children).toHaveLength(flatCount);
    expect(ctx.late.children).toHaveLength(0);
    for (const pool of effects._splats) expect(pool.mesh.material).toBe(flatDecalMaterial());
  }
  expect(freed).toBe(geometries.size);
  // The same context again changes nothing; a new soft setting builds the pools again.
  effects.setRealistic(ctx);
  const real = effects._real, cloud = effects.smokeCloud(V(0, 1, -6), 3, 8)!;
  effects.setRealistic({ ...ctx });
  expect(effects._real).toBe(real);
  expect(cloud.live).toBe(true);
  effects.setRealistic({ ...ctx, soft: false });
  expect(effects._real).not.toBe(real);
  // The rebuilt pools lost the cloud; its handle says so, so hazard smoke asks for a new one.
  expect(cloud.live).toBe(false);
  effects.setRealistic(null);
  // A hit on the flat look: a hole in the surface's own dark colour, no longer the player's blue.
  effects.bulletImpact(V(0, 1, -5), V(0, 0, 1), { material: 'brick', surf: 'block' });
  const colour = new THREE.Color();
  effects._holes.mesh.getColorAt(0, colour);
  expect(colour.getHex()).toBe(new THREE.Color(impactFor({ material: 'brick', surf: 'block' }).hole).getHex());
  effects.clear();
  for (const mesh of scene.children) if (mesh instanceof THREE.Mesh) mesh.geometry.dispose();
});

test('atlases stream in, go on the materials once all are up, and are freed on Low', async () => {
  let live = 0;
  const uploaded: string[] = [];
  const assets = new FxAssets({
    texture: async url => {
      const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
      texture.name = url;
      live++;
      texture.addEventListener('dispose', () => { live--; });
      return texture;
    },
    upload: texture => { uploaded.push(texture.name); },
  });
  let heard = 0;
  expect(assets.wanted).toBe(false);
  assets.subscribe(() => heard++);
  expect(assets.wanted).toBe(true);
  const standIn = decalMaterial().map;
  assets.want(512);
  for (let i = 0; i < 100 && !assets.ready; i++) { assets.pump(); await new Promise(r => setTimeout(r, 5)); }
  expect(assets.ready).toBe(true);
  expect(heard).toBe(1);
  expect(uploaded).toEqual(FX_ATLASES.map(atlas => fxUrl(512, atlas)));
  expect(decalMaterial().map?.name).toBe(fxUrl(512, 'decals'));
  expect(spriteMaterial('soft').uniforms.map!.value.name).toBe(fxUrl(512, 'smoke'));
  expect(flashMaterial().map?.name).toBe(fxUrl(512, 'fire'));
  expect(assets.pending).toBe(false);
  // A size change keeps the old atlases on until the new ones are in.
  assets.want(2048);
  expect(assets.pending).toBe(true);
  expect(decalMaterial().map?.name).toBe(fxUrl(512, 'decals'));
  for (let i = 0; i < 100 && assets.pending; i++) { assets.pump(); await new Promise(r => setTimeout(r, 5)); }
  expect(decalMaterial().map?.name).toBe(fxUrl(2048, 'decals'));
  expect(live).toBe(FX_ATLASES.length);
  assets.want(null);
  expect([assets.ready, live, heard, assets.stats.textures]).toEqual([false, 0, 2, 0]);
  expect(decalMaterial().map).toBe(standIn);
  // Without the atlas the Blender guns' flash still shows: the fire stand-in glows at the middle of every cell, dark at its edges.
  const fire = flashMaterial().map as THREE.DataTexture, { cols, rows } = FX_MANIFEST.fire;
  const { width, height } = fire.image, data = fire.image.data as Uint8Array, cellW = width / cols, cellH = height / rows;
  expect([cellW, cellH]).toEqual([16, 16]);
  for (const cell of [cells('fire', 'flashFront')[0], cells('fire', 'flashSide')[0], cells('fire', 'glow')[0]]) {
    const x = (cell % cols) * cellW, y = Math.floor(cell / cols) * cellH;
    const texel = (dx: number, dy: number) => data[((y + dy) * width + x + dx) * 4]!;
    expect(texel(8, 8)).toBeGreaterThan(150);
    expect(texel(0, 0)).toBe(0);
  }
});

test('hazard smoke: an alpha-hashed sphere on the flat look, billowing smoke on the realistic tiers', () => {
  const scene = new THREE.Scene(), world = new World();
  let realistic = false, stopped = 0, clouds = 0, live = true;
  const effects = { get realistic() { return realistic; }, smokeCloud: () => { clouds++; return { stop: () => { stopped++; }, get live() { return live; } }; } };
  const m = { ctx: { scene, world, effects, game: { targets: () => [] } }, mods: { damage: 1 } } as unknown as ConstructorParameters<typeof EnemyHazards>[0];
  const hazards = new EnemyHazards(m);
  hazards.throwSmoke(V(0, 1, 0), V(0, 0, -6));
  const sphere = hazards.smoke[0]!.mesh;
  // The one blended mesh of the scene used to be this; alpha-hashed, it stays in the opaque pass.
  expect([sphere.material.transparent, sphere.material.alphaHash]).toEqual([false, true]);
  // Its own opacity on a clone of the warmed material, so it links no program of its own.
  expect(sphere.material).not.toBe(hazardSmokeMaterial());
  expect([sphere.material.color.getHex(), sphere.material.fog]).toEqual([hazardSmokeMaterial().color.getHex(), hazardSmokeMaterial().fog]);
  for (let i = 0; i < 40; i++) hazards.update(1 / 30);
  expect([sphere.name, sphere.visible, clouds]).toEqual(['smoke cloud', true, 0]);
  realistic = true;
  hazards.update(1 / 30);
  expect([sphere.visible, clouds]).toEqual([false, 1]);
  hazards.update(1 / 30);
  expect(clouds).toBe(1);
  // The realistic effects built again (another soft-particle setup): the old cloud is gone, a new one billows.
  live = false;
  hazards.update(1 / 30);
  live = true;
  expect([sphere.visible, clouds]).toEqual([false, 2]);
  // Back to Low under the cloud: the sphere shows again.
  realistic = false;
  hazards.update(1 / 30);
  expect(sphere.visible).toBe(true);
  realistic = true;
  hazards.update(1 / 30);
  hazards.clear();
  expect([stopped, scene.getObjectByName('smoke cloud')]).toEqual([1, undefined]);
});

test('a charge\'s or payload\'s blast leaves a scorch on the realistic tiers; a piñata\'s or boss\'s keeps its colour splat', () => {
  const scene = new THREE.Scene(), world = new World(), effects = new Effects(scene, world);
  world.addBox(V(-20, -1, -20), V(20, 0, 20), {});
  world.finalize();
  effects.setRealistic({ ...context(false), scene });
  const real = effects._real!;
  const splats = () => effects._splats.reduce((n, pool) => n + pool.mesh.count, 0);
  // A sapper's charge (enemies/hazards.ts) and a mutated flyer's payload: accent-toned, scorched, no paint.
  effects.explosion(V(0, 0.5, -4), 2, TONE.ACCENT, true);
  expect([real._decalCount, splats()]).toEqual([1, 0]);
  // A dark blast scorches by default; a piñata's colour does not, it splats.
  effects.explosion(V(3, 0.5, -4), 2.5, TONE.DARK);
  expect([real._decalCount, splats()]).toEqual([2, 0]);
  effects.explosion(V(-3, 0.5, -4), 2.5, TONE.BOSS);
  expect(real._decalCount).toBe(2);
  expect(splats()).toBeGreaterThan(0);
  effects.setRealistic(null);
  effects.clear();
  for (const mesh of scene.children) if (mesh instanceof THREE.Mesh) mesh.geometry.dispose();
});

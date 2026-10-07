import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';
import { hiddenMat, kitMat, signsMat } from '@/engine/render/materials';
import { BAKE_FILE, bakeFor } from '@/engine/render/lightmap';
import { fxDownloadBytes } from '@/engine/render/fx';
import { operatorDownloadBytes } from '@/engine/render/operators';
import { PRESET_VALUES } from '@/engine/render/quality';
import {
  DRONE, DressingMerge, PROP_ATLASES, atlasSize, PROP_MANIFEST, PropAssets, PROP_CELL, atlasCell, decalGeometry, dressingSets, droneGeometry, kitFromScene, mergeDressing,
  parsePropManifest, pieceInfo, propAtlasUrl, propDetail, propDownloadBytes, propsUrl,
} from '@/engine/render/props';
import { Renderer } from '@/engine/render/index';
import { skyUrl } from '@/engine/render/sky';
import { TEXTURE_SIZE, downloadBytes, setInfo, setsFor } from '@/engine/render/surfaces';
import { weaponDownloadBytes } from '@/engine/render/weapons';
import { blockers, blockingSightlines, inWalkVolume, sightlines } from './dressing-check';
import { LevelBuilder } from '@/engine/level/build';
import { buildDowntown } from '@/engine/level/downtown';
import { Dresser } from '@/engine/level/dressing';
import { ROCK_STACKS } from '@/engine/level/mexico';
import type { Kit } from '@/engine/render/props';
import type { Level, PropFamily } from '@/engine/types';

const MAPS = [['downtown', false], ['downtown', true], ['house', false], ['house', true], ['mexico', false], ['mexico', true], ['training', false]] as const;
const FAMILIES: readonly PropFamily[] = ['downtown', 'house', 'mexico'];
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function build(key: string, arena = false): { level: Level; world: World } {
  const scene = new THREE.Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena });
  cleanup.push(() => { disposeLevel(scene, level); world.clear(); });
  scene.updateMatrixWorld(true);
  return { level, world };
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const r = (v: number) => Math.round(v * 1e4) / 1e4;

/** Everything gameplay reads from a level: colliders with their flags and impact tags, the markers, the walker nav graph, the drones. */
async function gameplayHashes(level: Level, world: World): Promise<Record<string, string>> {
  const nav = new NavGrid(world, level.bounds, 1);
  nav.build();
  const boxes = world.boxes.map(b => [b.min.toArray().map(r), b.max.toArray().map(r), !!b.data.noNav, !!b.data.noShoot, !!b.data.noGrapple,
    b.data.material ?? null, b.data.surf ?? null, (b.data.overlays ?? []).map(o => [[o.min.x, o.min.y, o.min.z].map(r), [o.max.x, o.max.y, o.max.z].map(r), o.material, o.surf])]);
  const markers = [level.playerStart, ...level.spawns, ...level.snipers, ...level.pickups, ...level.rings, ...level.arenaSpawns, ...level.teamSpawns.flat()]
    .map(v => v.toArray().map(r));
  const graph = nav.nodes.map(n => [n.x, r(n.y), n.z, n.links.map(l => [l.to, r(l.cost), r(l.dy)])]);
  return {
    colliders: await sha(JSON.stringify(boxes)),
    markers: await sha(JSON.stringify([markers, level.bossPerch ? [level.bossPerch.position.toArray().map(r), level.bossPerch.route.map(v => v.toArray().map(r))] : null])),
    nav: await sha(JSON.stringify(graph)),
    movers: await sha(JSON.stringify(level.movers.map(m => [m.radius, m.mesh.position.toArray().map(r)]))),
  };
}

/** Taken at c2c96cf, before the dressing: every piece of it is visual, so none of these may move. */
const BEFORE_DRESSING: Record<string, Record<string, string>> = {
  downtown: { colliders: '631f37787eaa9a787ace850495c3c1ca', markers: '8993b91d4b9b0b55d0aee23575210aab', nav: '9be998584f347736a276668d2c8262db', movers: '7af08e2f1e7bc2d001e15f1f955be8e8' },
  'downtown-arena': { colliders: '2882865e90f66fd660f94c900e2fa94d', markers: '313eecf33b84e106812d65d335a2bfc9', nav: 'bf5d4a2462187644cf1d07e12d46de38', movers: 'a530c1aa59268731b3d0e02f62db3a47' },
  house: { colliders: '474723e9ea8d7fec3730b72c32f0fcab', markers: '43e45feb5c36d1a528d353ccf1a79f33', nav: '37da430e570d7e5bc9817c615c753ec4', movers: 'b4008202b79d82752e92aab65b40b6d0' },
  'house-arena': { colliders: '474723e9ea8d7fec3730b72c32f0fcab', markers: '43e45feb5c36d1a528d353ccf1a79f33', nav: '37da430e570d7e5bc9817c615c753ec4', movers: 'b4008202b79d82752e92aab65b40b6d0' },
  mexico: { colliders: '2a2fd5785d21b1e3595807c5e33beec4', markers: '03d660325de3f79bde73dc5edb4bd740', nav: 'e85100c46305444c30eb95eb36261d9e', movers: 'fd851276ac9f0e34bf99e8f55a8bf8f2' },
  'mexico-arena': { colliders: '2a2fd5785d21b1e3595807c5e33beec4', markers: '03d660325de3f79bde73dc5edb4bd740', nav: 'e85100c46305444c30eb95eb36261d9e', movers: 'fd851276ac9f0e34bf99e8f55a8bf8f2' },
  training: { colliders: '776280a0ea42e0f309bd5529f2da0724', markers: '68e64bde1c513d1c0af37fc1194821eb', nav: 'ade642af778281ab675aba97e179684d', movers: '4f53cda18c2baa0c0354bb5f9a3ecbe5' },
};

test('the dressing changes no collider, impact tag, marker, nav link or drone path on any map', async () => {
  for (const [key, arena] of MAPS) {
    const { level, world } = build(key, arena), name = arena ? `${key}-arena` : key;
    expect(await gameplayHashes(level, world), name).toEqual(BEFORE_DRESSING[name]);
  }
});

let kits: Map<PropFamily, Kit> | undefined;
async function kit(family: PropFamily): Promise<Kit> {
  kits ??= new Map();
  if (!kits.has(family)) kits.set(family, kitFromScene((await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(propsUrl(family))).scene));
  return kits.get(family)!;
}

test('no dressing piece stands in the walk volume or cuts an open sightline between spawns, perches and pickups', () => {
  for (const [key, arena] of MAPS) {
    const { level, world } = build(key, arena), name = arena ? `${key}-arena` : key;
    if (key === 'training') {
      expect(level.dressing, 'training stays a bare range').toBeNull();
      continue;
    }
    const list = blockers(level);
    expect(list.length, name).toBeGreaterThan(100);
    expect(sightlines(level, world).length, `${name} has sightlines to guard`).toBeGreaterThan(50);
    expect(inWalkVolume(level, world, list), name).toEqual([]);
    expect(blockingSightlines(level, world, list), name).toEqual([]);
  }
}, 120_000);

test('the dressing is deterministic: the same props, cables, decals and trim every build', async () => {
  for (const [key, arena] of MAPS) {
    const a = build(key, arena).level, b = build(key, arena).level;
    expect(JSON.stringify(a.dressing)).toBe(JSON.stringify(b.dressing));
    const trim = (level: Level) => level.surfaces.filter(s => s.realOnly).map(s => Array.from(s.mesh.geometry.getAttribute('position').array));
    expect(await sha(JSON.stringify(trim(a)))).toBe(await sha(JSON.stringify(trim(b))));
  }
  // Every placed piece is in its family's kit, every sign names a cell, and the maps dress densely.
  for (const family of FAMILIES) {
    const { level } = build(family), dressing = level.dressing!;
    expect(dressing.family).toBe(family);
    const k = await kit(family);
    for (const p of dressing.props) expect(k.has(p.piece), `${family}: ${p.piece}`).toBe(true);
    expect(dressing.props.length, family).toBeGreaterThan(150);
    expect(dressing.decals.length, family).toBeGreaterThan(60);
    expect(level.surfaces.some(s => s.realOnly && s.static), `${family} has baked trim`).toBe(true);
  }
  expect(atlasCell('signs', 'tacos')).toBe(PROP_MANIFEST.atlases.signs.cells.indexOf('tacos'));
  expect(() => atlasCell('grime', 'nope')).toThrow();
  expect(() => pieceInfo('nope')).toThrow();
  expect(() => parsePropManifest({ ...PROP_MANIFEST, glbs: {} })).toThrow();
});

test('the placement tables are made on a realistic look\'s first frame, never on Low, and once', () => {
  const place = vi.spyOn(Dresser.prototype, 'clearOfWalkers');
  const { level } = build('house');
  // Built: the trim is on the level, the tables are not made.
  expect(level.surfaces.some(s => s.realOnly)).toBe(true);
  expect(place).not.toHaveBeenCalled();
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.low);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  renderer.render(0, fx);
  expect(place).not.toHaveBeenCalled();
  expect(renderer._propRequest).toBeNull();
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer.render(0, fx);
  expect(place).toHaveBeenCalled();
  expect(renderer._propRequest?.dressing).toBe(level.dressing);
  const calls = place.mock.calls.length;
  expect(level.dressing!.props.length).toBeGreaterThan(100);
  expect(place.mock.calls.length).toBe(calls);
  place.mockRestore();
  // About 1.5 s alone (a Medium frame compiles its programs); beside the suite's GPU tests in the one browser, 15 s.
}, 60_000);

test('the dressing reads the map as built, not as play has changed it', () => {
  const a = build('mexico'), b = build('mexico');
  // Play removes colliders (a broken pinata) and adds others (a charge on a wall) before a realistic look first asks.
  for (const box of b.world.boxes.slice(0, 40)) b.world.removeBox(box);
  b.world.addBox(new THREE.Vector3(-1, 0, 20), new THREE.Vector3(1, 3, 22), { noNav: true });
  expect(JSON.stringify(b.level.dressing)).toBe(JSON.stringify(a.level.dressing));
});

test('Low draws none of it: realistic-only trim is hidden and no kit or atlas loads; the realistic tiers show the trim', () => {
  const { level } = build('downtown');
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  renderer.setSurfaces(level.surfaces, level);
  const trim = level.surfaces.filter(s => s.realOnly);
  expect(trim.length).toBeGreaterThan(0);
  renderer.applyQuality(PRESET_VALUES.low);
  for (const { mesh } of trim) expect(mesh.material).toBe(hiddenMat());
  renderer._streamProps();
  expect(renderer.props.pending).toBe(false);
  expect(renderer.props.stats).toEqual({ textures: 0, residentBytes: 0, meshes: 0, triangles: 0 });
  renderer.applyQuality(PRESET_VALUES.ultra);
  for (const { mesh } of trim) expect([mesh.material].flat().every(m => m !== hiddenMat() && m.visible)).toBe(true);
  // The kit's sets stream with the level's, from the first realistic frame (`_dress`).
  renderer._dress();
  for (const set of dressingSets(level.dressing, true)) expect(renderer._surfaceSets).toContain(set);
  renderer._streamProps();
  expect(renderer.props.pending).toBe(true);
  renderer.applyQuality(PRESET_VALUES.low);
  for (const { mesh } of trim) expect(mesh.material).toBe(hiddenMat());
  expect(renderer.props.pending).toBe(false);
  // Half a second alone (a renderer and two looks); beside the other GPU test files it waits its turn: over 15 s at R8.
}, 60_000);

test('merging: meshes per cell, one draw per texture set, the backdrops in one, a single decal mesh, the drone', async () => {
  for (const family of FAMILIES) {
    const { level } = build(family), dressing = level.dressing!, k = await kit(family);
    const parts = mergeDressing(dressing, k);
    expect(parts.filter(p => p.kind === 'backdrop').length).toBe(1);
    // Draw calls: each merged mesh draws once per texture set, the decals once; the camera and each cascade draw only
    // the cells in their view.
    const draws = parts.reduce((n, p) => n + p.sets.length, 0) + 1;
    expect(draws, `${family} draws`).toBeLessThanOrEqual(260);
    for (const part of parts) {
      expect(part.geometry.groups.length).toBe(part.sets.length);
      expect(part.geometry.groups.every((g, i) => g.materialIndex === i)).toBe(true);
    }
    // The casters and the small pieces merge per PROP_CELL, so each cell's mesh stays about a cell across (a long pipe or
    // gutter reaches out of its cell) and no mesh spans the map.
    for (const part of parts.filter(p => p.kind !== 'backdrop')) {
      const size = part.geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.z)).toBeLessThan(PROP_CELL + 20);
    }
    expect(parts.filter(p => p.kind === 'large').length, family).toBeGreaterThan(4);
    // Every placement's triangles are in the merge (the cables add theirs), and the same dressing merges the same.
    const triangles = parts.reduce((n, p) => n + p.geometry.index!.count / 3, 0);
    expect(triangles).toBeGreaterThanOrEqual(dressing.props.reduce((n, p) => n + pieceInfo(p.piece).triangles, 0));
    expect(mergeDressing(dressing, k).map(p => p.geometry.index!.count)).toEqual(parts.map(p => p.geometry.index!.count));
    expect(decalGeometry(dressing.decals)!.index!.count).toBe(6 * dressing.decals.length);
    expect(droneGeometry(k)!.geometry.index!.count / 3).toBe(pieceInfo(DRONE).triangles);
    for (const part of parts) part.geometry.dispose();
  }
});

test('streaming: atlases upload in the renderer\'s slots, the dressing merges and warms, the drones wear the kit, Low frees it all', async () => {
  const { level } = build('downtown');
  const scene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(propsUrl('downtown'))).scene;
  const uploads: THREE.Texture[] = [], warmed: THREE.Object3D[] = [];
  let release = () => {};
  const model = vi.fn(async () => ({ scene: scene.clone() }));
  const assets = new PropAssets({
    model,
    texture: async () => new THREE.DataTexture(new Uint8Array(4), 1, 1),
    upload: texture => uploads.push(texture),
    warm: root => { warmed.push(root); return new Promise<void>(done => { release = done; }); },
  });
  const cone = level.movers[0]!.mesh as THREE.Mesh, flat = cone.material;
  assets.want({ dressing: level.dressing, movers: level.movers }, TEXTURE_SIZE.high);
  expect(assets.pending).toBe(true);
  // The glb (parsed on the main thread) waits for `fetch`, which the renderer holds past a match's quiet start.
  expect(model).not.toHaveBeenCalled();
  assets.fetch();
  assets.fetch();
  expect(model).toHaveBeenCalledTimes(1);
  expect(assets.pump()).toBe(0);
  await new Promise(done => setTimeout(done, 0));
  for (let i = 0; i < PROP_ATLASES.length; i++) expect(assets.pump()).toBeGreaterThan(0);
  expect(uploads.length).toBe(PROP_ATLASES.length);
  expect(signsMat().map).toBe(uploads[0]);
  // The merge steps upload nothing (0); the built meshes are the last pump's bytes.
  let last = 0;
  for (let i = 0; i < 2000 && warmed.length === 0; i++) last = assets.pump();
  expect(warmed.length).toBe(1);
  expect(last).toBeGreaterThan(1e5);
  expect(assets.ready).toBe(false);
  release();
  await new Promise(done => setTimeout(done, 0));
  expect(assets.ready).toBe(true);
  expect(assets.pending).toBe(false);
  expect(assets.root.children.length).toBe(1);
  expect(assets.wearsDrone(cone)).toBe(true);
  expect(cone.material).toBe(hiddenMat());
  expect(cone.children.some(child => child.name === 'drone')).toBe(true);
  expect(assets.casters.length).toBe(assets.root.children[0]!.children.filter(m => m.name === 'props-large').length);
  expect(assets.casters.length).toBeGreaterThan(4);
  expect(assets.stats.meshes).toBeGreaterThan(3);
  // Small cells out of reach hide.
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(500, 0, 500);
  camera.updateMatrixWorld();
  assets.update(camera);
  const small = (assets.root.children[0]!.children as THREE.Mesh[]).filter(m => m.name === 'props-small');
  expect(small.length).toBeGreaterThan(0);
  expect(small.every(m => !m.visible)).toBe(true);
  // A new map of the same family merges again from the kit already in, and gives the old drones their cones back.
  const next = build('downtown').level;
  assets.want({ dressing: next.dressing, movers: next.movers }, TEXTURE_SIZE.high);
  expect(assets.ready).toBe(false);
  expect(cone.material).toBe(flat);
  expect(assets.pump()).toBe(0);
  // The merge runs a few milliseconds a pump: the whole map is several steps, each finished mesh one more.
  const merge = new DressingMerge(next.dressing!, await kit('downtown'));
  let steps = 1;
  while (!merge.step(0)) steps++;
  expect(steps).toBeGreaterThan(next.dressing!.props.length);
  expect(merge.parts.map(p => p.geometry.index!.count)).toEqual(mergeDressing(next.dressing!, await kit('downtown')).map(p => p.geometry.index!.count));
  // Low: everything goes and the stand-ins come back.
  assets.want(null, null);
  expect(assets.stats).toEqual({ textures: 0, residentBytes: 0, meshes: 0, triangles: 0 });
  expect(signsMat().map).not.toBe(uploads[0]);
  expect(assets.root.children.length).toBe(0);
  expect(assets.pending).toBe(false);
});

test('the kit\'s files are where the URLs say, within 8 MB at Ultra for every map together, and each map stays under 60 MB at Ultra', async () => {
  const size = TEXTURE_SIZE.high;
  let props = 0;
  for (const family of FAMILIES) {
    const glb = await (await fetch(propsUrl(family))).arrayBuffer();
    expect(glb.byteLength, family).toBe(PROP_MANIFEST.glbs[family]);
    props += glb.byteLength;
  }
  for (const atlas of PROP_ATLASES) {
    // The signs load at 1024 on Medium too (`atlasSize`): no 512 is made.
    for (const s of new Set(Object.values(TEXTURE_SIZE).map(s => atlasSize(atlas, s)))) {
      const file = await (await fetch(propAtlasUrl(s, atlas))).arrayBuffer();
      expect(file.byteLength, `${atlas} ${s}`).toBe(PROP_MANIFEST.atlases[atlas].bytes[`${s}`]);
      if (s === size) props += file.byteLength;
    }
  }
  expect(atlasSize('signs', TEXTURE_SIZE.low)).toBe(TEXTURE_SIZE.medium);
  expect(atlasSize('grime', TEXTURE_SIZE.low)).toBe(TEXTURE_SIZE.low);
  expect(props).toBeLessThanOrEqual(8e6);
  // Per map at Ultra: its texture sets (the kit's too), its bake and probe grid, its sky, the weapons, effects and operators, its kit.
  const once = weaponDownloadBytes(size) + fxDownloadBytes(size) + operatorDownloadBytes(0, size);
  for (const [key, arena] of MAPS) {
    const { level } = build(key, arena), bake = bakeFor(level)!;
    const sets = new Set([...setsFor(level.surfaces.flatMap(s => s.materials.filter(t => t !== null))), ...dressingSets(level.dressing, level.movers.length > 0)]);
    let sky = 0;
    for (const file of ['env.hdr', 'sky.webp', 'sky.json']) sky += (await (await fetch(skyUrl(level.mood?.sky ?? key, file))).arrayBuffer()).byteLength;
    const total = downloadBytes(sets, size) + bake.info.bytes[BAKE_FILE.high] + bake.info.bytes.probes + sky + once
      + (level.dressing ? propDownloadBytes(level.dressing.family, size) : 0);
    expect(total, `${key}${arena ? ' arena' : ''} at Ultra`).toBeLessThanOrEqual(60e6);
  }
  // The kit's materials sit with the level's, keyed by set, so the level's streaming puts each set's maps on them.
  expect(kitMat('steel', setInfo('steel')).userData.set).toBe('steel');
  expect(kitMat('steel', setInfo('steel'))).toBe(kitMat('steel', setInfo('steel')));
});

test('Low uploads no vertex colours; a realistic look puts the tints on, one shared white where a piece has none', () => {
  const { level } = build('downtown');
  expect(level.surfaces.every(s => s.mesh.geometry.getAttribute('color') === undefined)).toBe(true);
  const tinted = level.surfaces.filter(s => s.colours);
  expect(tinted.length).toBeGreaterThan(0);
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.low);
  expect(level.surfaces.every(s => s.mesh.geometry.getAttribute('color') === undefined)).toBe(true);
  renderer.applyQuality(PRESET_VALUES.medium);
  for (const surface of level.surfaces) {
    const colour = surface.mesh.geometry.getAttribute('color');
    expect(colour.count).toBeGreaterThanOrEqual(surface.mesh.geometry.getAttribute('position').count);
    if (surface.colours) expect(colour.array).toBe(surface.colours);
    else expect(Array.from(colour.array).every(v => v === 1)).toBe(true);
  }
  // The untinted meshes share one white buffer.
  const white = level.surfaces.filter(s => !s.colours).map(s => s.mesh.geometry.getAttribute('color'));
  expect(new Set(white).size).toBe(1);
  // Building A's render is a shade off white; its merged mesh carries it on some vertices and white on others.
  const block = tinted.find(s => s.surf === 'block')!;
  expect(Array.from(block.colours!).some(v => v < 1)).toBe(true);
  expect(Array.from(block.colours!).some(v => v === 1)).toBe(true);
  // A few seconds alone (a renderer and two looks); beside the other GPU test files it waits its turn: 20 s at R8.
}, 60_000);

test('the dresser keeps floor pieces out of the walk volume, and the rock shells sit on their stacks\' colliders', () => {
  const scene = new THREE.Scene(), world = new World(), b = new LevelBuilder(scene, world, 'downtown', false);
  buildDowntown(b);
  world.finalize();
  const d = new Dresser(b, 'downtown', 1, 'props');
  cleanup.push(() => world.clear());
  // The open plaza and the street are walked; beyond the level's bounds nobody walks.
  expect(d.propIfClear('bench', 0, 0, 30)).toBe(false);
  expect(d.propIfClear('bin-street', 16, 0, 10)).toBe(false);
  expect(d.clearOfWalkers(new THREE.Box3(new THREE.Vector3(60, 18, -2), new THREE.Vector3(62, 24, 2)))).toBe(true);
  // A box standing in the walk volume of a node is refused, and one hugging a wall's face (within WALL_DEPTH) is not.
  expect(d.clearOfWalkers(new THREE.Box3(new THREE.Vector3(-0.3, 0.2, 30), new THREE.Vector3(0.3, 1, 30.6)))).toBe(false);
  expect(d.clearOfWalkers(new THREE.Box3(new THREE.Vector3(-24.8, 0.2, 8), new THREE.Vector3(-24.7, 2, 9)))).toBe(true);
  expect(d.dressing.props.length).toBe(0);

  // Mexico's shells: every vertex within 6 cm outside its stack's tiers (never out in the walk volume) and none more
  // than a corner's facet inside; faceted (not flat) and banded (not one colour).
  const { level } = build('mexico');
  const shells = level.surfaces.filter(s => s.realOnly && s.surf === 'sandstone');
  expect(shells.length).toBeGreaterThan(0);
  const boxes = ROCK_STACKS.flat().map(([x, y, z, w, h, depth]) => new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - depth / 2), new THREE.Vector3(x + w / 2, y + h, z + depth / 2)));
  const v = new THREE.Vector3();
  let inside = 0, count = 0;
  for (const { mesh } of shells) {
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i);
      // The church's base course is sandstone too; the stacks all stand on the perimeter.
      if (Math.max(Math.abs(v.x), Math.abs(v.z)) < 55) continue;
      count++;
      expect(boxes.some(box => box.clone().expandByScalar(0.0601).containsPoint(v)), v.toArray().join()).toBe(true);
      if (boxes.some(box => box.clone().expandByScalar(-0.02).containsPoint(v))) inside++;
    }
  }
  expect(inside / count).toBeGreaterThan(0.2);
  const shades = new Set(Array.from(shells[0]!.colours!, c => c.toFixed(2)));
  expect(shades.size).toBeGreaterThan(10);
});

test('the rock stacks\' shells are closed: every tier on another has an underside, so nothing shows the sky through them', () => {
  const { level } = build('mexico');
  const shells = level.surfaces.filter(s => s.realOnly && s.surf === 'sandstone').map(s => s.mesh);
  for (const mesh of shells) mesh.material = new THREE.MeshBasicMaterial();
  const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0);
  let rays = 0;
  for (const stack of ROCK_STACKS) {
    for (const [x, y, z, w, h, depth] of stack.slice(1)) {
      // Straight up from just under the tier, across its footprint: the first face met (front faces only) is its
      // underside, within the tier, never nothing.
      for (let u = -0.4; u <= 0.4; u += 0.1) {
        for (const v of [-0.4, 0, 0.4]) {
          ray.set(new THREE.Vector3(x + u * w, y - 0.4, z + v * depth), up);
          const hit = ray.intersectObjects(shells, false)[0];
          rays++;
          expect(hit && hit.distance < h + 0.4, `${x},${y},${z}`).toBe(true);
        }
      }
    }
  }
  expect(rays).toBeGreaterThan(500);
  // Seen from the plaza, the tiers overhang in places (jittered colliders): those undersides face down.
  const under = shells.flatMap(mesh => {
    const n = mesh.geometry.getAttribute('normal');
    return Array.from({ length: n.count }, (_, i) => n.getY(i)).filter(y => y < -0.99);
  });
  expect(under.length).toBeGreaterThan(40 * 12);
});

test('stringers go down a flight\'s open sides, never a side against a wall, and stay under its treads', () => {
  const scene = new THREE.Scene(), world = new World(), b = new LevelBuilder(scene, world, 'downtown', false);
  cleanup.push(() => world.clear());
  b.box(0, -1, 0, 40, 1, 40);
  b.stairs(0, 0, 0, '+x', 10, 1.6, { rise: 0.3, run: 0.5 });
  b.box(2.5, 0, 0.9, 6, 3, 0.2);
  const d = new Dresser(b, 'downtown', 1, 'trim');
  d.stairs();
  const parts = [...b.realParts.values()].flatMap(tags => [...tags.values()].flat());
  expect(parts.length).toBe(1);
  const position = parts[0]!.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    // On the open side (z < -0.8), proud of it by 3 cm at most, and under the riser line.
    expect(v.z).toBeLessThan(-0.79);
    expect(v.z).toBeGreaterThan(-0.84);
    expect(v.y).toBeLessThanOrEqual(0.6 * v.x - 0.3 + 1e-6);
  }
  // The props pass leaves the trim alone.
  new Dresser(b, 'downtown', 1, 'props', world).stairs();
  expect([...b.realParts.values()].flatMap(tags => [...tags.values()].flat()).length).toBe(1);
});

test('Medium\'s kit merges in wider cells and hides its small pieces nearer; a Textures change merges again', async () => {
  expect(propDetail(TEXTURE_SIZE.low)).toEqual({ cell: 2 * PROP_CELL, small: 24 });
  expect(propDetail(TEXTURE_SIZE.medium)).toEqual(propDetail(TEXTURE_SIZE.high));
  const { level } = build('downtown'), k = await kit('downtown');
  const draws = (cell: number) => mergeDressing(level.dressing!, k, cell).reduce((n, p) => n + p.sets.length, 0);
  expect(draws(propDetail(TEXTURE_SIZE.low).cell)).toBeLessThan(0.6 * draws(PROP_CELL));
  const scene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(propsUrl('downtown'))).scene;
  const assets = new PropAssets({ model: async () => ({ scene: scene.clone() }), texture: async () => new THREE.DataTexture(new Uint8Array(4), 1, 1), upload: () => {} });
  const settle = async () => {
    await new Promise(done => setTimeout(done, 0));
    for (let i = 0; i < 4000 && !assets.ready; i++) assets.pump();
    expect(assets.ready).toBe(true);
  };
  assets.want({ dressing: level.dressing, movers: level.movers }, TEXTURE_SIZE.low);
  assets.fetch();
  await settle();
  const cells = (assets.root.children[0]!.children as THREE.Mesh[]).filter(m => m.name === 'props-large').length;
  // Small cells between 24 and 48 m of the eye hide on Medium only.
  const small = (assets.root.children[0]!.children as THREE.Mesh[]).filter(m => m.name === 'props-small');
  const camera = new THREE.PerspectiveCamera(), far = small[0]!.geometry.boundingBox!;
  camera.position.set(far.max.x + 30, 0, far.getCenter(new THREE.Vector3()).z);
  camera.updateMatrixWorld();
  assets.update(camera);
  expect(small[0]!.visible).toBe(false);
  assets.want({ dressing: level.dressing, movers: level.movers }, TEXTURE_SIZE.high);
  expect(assets.ready).toBe(false);
  await settle();
  const merged = assets.root.children[0]!.children as THREE.Mesh[];
  expect(merged.filter(m => m.name === 'props-large').length).toBeGreaterThan(cells);
  expect(merged).not.toContain(small[0]);
  // High keeps its small pieces to 48 m.
  const near = merged.find(m => m.name === 'props-small')!, box = near.geometry.boundingBox!;
  camera.position.set(box.max.x + 30, 0, box.getCenter(new THREE.Vector3()).z);
  camera.updateMatrixWorld();
  assets.update(camera);
  expect(near.visible).toBe(true);
  // Once uploaded, the merged arrays go (their counts stay, which the draws use).
  const mesh = assets.root.children[0]!.children[0] as THREE.Mesh, index = mesh.geometry.index!, count = index.count;
  index.onUploadCallback();
  (mesh.geometry.getAttribute('position') as THREE.BufferAttribute).onUploadCallback();
  expect(index.array.length).toBe(0);
  expect(mesh.geometry.getAttribute('position').array.length).toBe(0);
  expect(index.count).toBe(count);
  assets.want(null, null);
});

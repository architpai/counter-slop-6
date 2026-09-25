import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { Renderer, UPLOAD_GAP_MS, UPLOAD_SETTLE_MS } from '@/engine/render/index';
import { casterGroups, hiddenMat, realMat, realMaterials, standInMaps, surfMat } from '@/engine/render/materials';
import { MATERIAL_COLOR, SURF } from '@/engine/render/palette';
import { PRESET_VALUES } from '@/engine/render/quality';
import {
  DEFAULT_MATERIAL, MATERIAL_SET, MATERIAL_TAGS, TEXTURE_MAPS, TEXTURE_SETS, TEXTURE_SIZE, downloadBytes, parseTextureSets,
  planarUVs, resolveMaterial, setInfo, setsFor, textureUrl,
} from '@/engine/render/surfaces';
import { TextureStreamer } from '@/engine/render/textures';
import type { SurfKey } from '@/engine/render/palette';
import type { Level } from '@/engine/types';

const MAPS = [['downtown', false], ['downtown', true], ['house', false], ['mexico', false], ['training', false]] as const;
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function build(key: string, arena = false): Level {
  const scene = new THREE.Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena });
  cleanup.push(() => disposeLevel(scene, level));
  scene.updateMatrixWorld(true);
  return level;
}

/** The material tags a level's surfaces are drawn in on the realistic tiers. */
const tagsOf = (level: Level) => level.surfaces.flatMap(s => s.materials.filter(tag => tag !== null));
/** A mesh's materials, one per group (or one for the whole mesh). */
const looksOf = (mesh: THREE.Mesh) => [mesh.material].flat();

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Low's geometry per flat colour (and shadow flags), before R2: triangle count and a hash of the
 * sorted world-space triangles. Merging per (surface, tag) instead of per surface, and the
 * per-face UVs, must leave every colour's triangles exactly as they were.
 */
const LOW_BEFORE_R2: Record<string, Record<string, string>> = {
  downtown: {
    "263640|truetrue": "1168:2a0f658c50b2697a",
    "405562|truetrue": "168:26f1934431267251",
    "4f8766|truetrue": "48:feca48125386832c",
    "52606a|truetrue": "648:b867a179728a76f2",
    "96a9b4|truetrue": "1696:2370e8f513945097",
    "9f7858|truetrue": "228:79d7eea81e5d2fca",
    "a887b7|truetrue": "44:11df15cf9a43ce58",
    "b5b7ad|truetrue": "228:b7b55cde6d5873c6",
    "b8c6cc|truetrue": "6440:29985f0bb759d7f3",
    "c87651|truetrue": "60:c40ca7f7e0599236",
    "e1d8c3|truetrue": "1080:9477fd2229739156",
    "e5e4d9|truetrue": "786:aa2494b917781dae",
    "e7b34f|truetrue": "672:502c33bc0a4bbcb1",
    "fbfaf5|falsefalse": "3360:1dcdf3c574f31886",
  },
  "downtown-arena": {
    "263640|truetrue": "1332:00636415c85f82f3",
    "4f8766|truetrue": "12:b2c70826c66dfa15",
    "52606a|truetrue": "648:617543fd97fdea4a",
    "96a9b4|truetrue": "852:f422bab56815a4eb",
    "9f7858|truetrue": "60:f24ae4d88ccb676a",
    "b5b7ad|truetrue": "228:329f3646aced66bb",
    "b8c6cc|truetrue": "4304:ce823d3b9bddfb21",
    "c87651|truetrue": "60:c40ca7f7e0599236",
    "c96557|truetrue": "48:32d5193f61cc2e9a",
    "e1d8c3|truetrue": "1296:4e831de41f62023b",
    "e5e4d9|truetrue": "13464:416489c1f45cb120",
    "e7b34f|truetrue": "3348:a4a64c723ead343c",
    "fbfaf5|falsefalse": "3360:1dcdf3c574f31886",
  },
  house: {
    "263640|truetrue": "816:b0f6f5ba98ee4b75",
    "3e5262|truetrue": "204:4e7f70e98c5953bc",
    "405562|truetrue": "24:cef0e352d3f19520",
    "40b7b7|truetrue": "12:4845aa50ff57ded4",
    "4f8766|truetrue": "1248:83c5a0cdbad4c6e8",
    "52606a|truetrue": "456:2cf67b96e96bf897",
    "829b65|truetrue": "120:2468435a0fb37d6e",
    "96a9b4|truetrue": "228:fd8963a6ce50316e",
    "9f7858|truetrue": "2164:db12cf11165a94e1",
    "a887b7|truetrue": "24:1ccbd8d5a60287b7",
    "b5b7ad|truetrue": "156:02fa008701e39c96",
    "b8c6cc|truetrue": "392:653b96fc6bfec12a",
    "c96557|truetrue": "104:996a1806ac12fbc5",
    "d9dcd5|truetrue": "2316:cab8e13a7f2491cb",
    "e5e4d9|truetrue": "12:311bcc52c807d89c",
    "e7b34f|truetrue": "804:5f927c1f1bfddce3",
    "f0e6d2|truetrue": "1888:d6f8b5f76a8f8283",
    "fbfaf5|falsefalse": "1600:2f11939230f59ea8",
  },
  mexico: {
    "263640|truetrue": "5656:74e488d4eb2e116c",
    "40b7b7|truetrue": "272:ea045cd2c1de73a3",
    "4f8766|truetrue": "2684:6ca2e4c2e05cf1b1",
    "9f7858|truetrue": "912:9c45af52b2ad70f9",
    "a887b7|truetrue": "2480:0e9be091fda5a13d",
    "be845d|truetrue": "1184:046d8aabd9104c49",
    "c87651|truetrue": "1276:796feb536739040c",
    "d9dcd5|truetrue": "24:d82a41a4d6fda213",
    "dbc59c|truetrue": "324:12e885c38797dac7",
    "e1d8c3|truetrue": "3828:2ab5cded22630636",
    "e5bd92|truetrue": "72:7922e2604ce53df5",
    "e5e4d9|truetrue": "114:357a2739310f12e2",
    "e7b34f|truetrue": "5520:3375275e652c628f",
    "f0e6d2|truetrue": "392:2153c8628558336d",
  },
  training: {
    "263640|truetrue": "12:bcaccd974ac03ece",
    "96a9b4|truetrue": "180:562477ea56e0e124",
    "b8c6cc|truetrue": "396:a0d895119cafb212",
    "e1d8c3|truetrue": "12:6c2a3af72f244800",
    "e5e4d9|truetrue": "48:830614be849c8ee4",
    "e7b34f|truetrue": "264:9a035e341033005e",
  },
};

test('Low draws every map exactly as before the material tags', async () => {
  for (const [key, arena] of MAPS) {
    const level = build(key, arena);
    const tris = new Map<string, string[]>();
    const p = new THREE.Vector3(), r = (v: number) => (Math.round(v * 1e4) / 1e4).toFixed(4);
    for (const root of level.meshes) root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !(mesh.material instanceof THREE.MeshLambertMaterial)) return;
      const id = `${mesh.material.color.getHexString()}|${mesh.castShadow}${mesh.receiveShadow}`;
      let list = tris.get(id);
      if (!list) tris.set(id, list = []);
      const position = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
      const n = index ? index.count : position.count;
      for (let i = 0; i < n; i += 3) {
        const corners: string[] = [];
        for (let j = 0; j < 3; j++) {
          p.fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(mesh.matrixWorld);
          corners.push(`${r(p.x)},${r(p.y)},${r(p.z)}`);
        }
        list.push(corners.join('|'));
      }
    });
    const actual: Record<string, string> = {};
    for (const [id, list] of [...tris].sort()) actual[id] = `${list.length}:${await sha(list.sort().join('\n'))}`;
    expect(actual, `${key}${arena ? ' arena' : ''}`).toEqual(LOW_BEFORE_R2[`${key}${arena ? '-arena' : ''}`]);
    // Built in the flat palette: each surface mesh wears its key's shared Lambert.
    for (const { mesh, surf } of level.surfaces) expect(mesh.material).toBe(surfMat(surf));
  }
});

test('every tag the maps use resolves to a texture set, a colour and a stand-in', () => {
  const used = new Set<string>();
  for (const [key, arena] of MAPS) {
    const level = build(key, arena);
    expect(level.surfaces.length, key).toBeGreaterThan(0);
    for (const { mesh, surf, materials } of level.surfaces) for (const material of materials) {
      if (material === null) continue;
      expect(MATERIAL_TAGS).toContain(material);
      expect(Object.hasOwn(SURF, surf)).toBe(true);
      used.add(material);
      const real = resolveMaterial(material, surf);
      expect(real.set).toBe(MATERIAL_SET[material]);
      expect(real.color).toBe(MATERIAL_COLOR[material] ?? SURF[surf]);
      const info = setInfo(real.set);
      // The texture tints to the tag's colour: the stand-in (the set's mean) times the material colour.
      const mat = realMat(real, info), standIn = standInMaps(real.set, info);
      expect(mat.map).toBeInstanceOf(THREE.Texture);
      const target = new THREE.Color(real.color);
      expect(mat.color.r * info.albedo[0]).toBeCloseTo(target.r, 5);
      expect(mat.color.b * info.albedo[2]).toBeCloseTo(target.b, 5);
      expect(standIn.albedo.image.width).toBe(1);
      // Every piece has a UV set in its material's tile.
      expect(mesh.geometry.getAttribute('uv')?.count).toBe(mesh.geometry.getAttribute('position').count);
    }
  }
  // Every tag, set and default is used or reachable; the palette and the manifest cover all of them.
  for (const tag of MATERIAL_TAGS) expect(Object.hasOwn(MATERIAL_COLOR, tag), tag).toBe(true);
  for (const set of TEXTURE_SETS) expect(setInfo(set).tile).toBeGreaterThan(0);
  for (const set of TEXTURE_SETS) expect(Object.values(MATERIAL_SET)).toContain(set);
  for (const key of Object.keys(SURF) as SurfKey[]) expect(MATERIAL_TAGS).toContain(DEFAULT_MATERIAL[key]);
  expect([...used].sort()).toEqual([...MATERIAL_TAGS].sort());
  // Trim wins the reveal faces it shares with its wall on the realistic tiers (a polygon offset,
  // no geometry change); nothing else is offset.
  const trim = realMat(resolveMaterial('painted-wood', 'siding'), setInfo('paint'));
  expect([trim.polygonOffset, trim.polygonOffsetFactor, trim.polygonOffsetUnits]).toEqual([true, -1, -1]);
  expect(realMat(resolveMaterial('plaster', 'plaster'), setInfo('plaster')).polygonOffset).toBe(false);
  // Tags with their own colour share one material across surfaces; painted ones split by colour.
  expect(resolveMaterial('brick', 'blockAlt').key).toBe(resolveMaterial('brick', 'wood').key);
  expect(resolveMaterial('painted-metal', 'hot').key).not.toBe(resolveMaterial('painted-metal', 'accent').key);
  expect(() => parseTextureSets({ sets: { x: { tile: 1 } } })).toThrow();
});

test('planar UVs: metres over the tile, v up walls, no stretch on slopes, seamless across boxes', () => {
  const uvs = (geometry: THREE.BufferGeometry, tile: number) => {
    const flat = geometry.toNonIndexed();
    planarUVs(flat, tile);
    return { flat, uv: flat.getAttribute('uv'), pos: flat.getAttribute('position') };
  };
  // A 2 m box at (10, 1, 4) with a 0.5 m tile: every face maps its own two axes, one tile per 0.5 m.
  const { uv, pos } = uvs(new THREE.BoxGeometry(2, 2, 2).translate(10, 1, 4), 0.5);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(p.subVectors(a, b)).normalize();
    for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(pos, i + k);
      const u = uv.getX(i + k), v = uv.getY(i + k);
      if (Math.abs(n.y) > 0.9) {
        expect(u).toBeCloseTo(p.x / 0.5, 5);
        expect(v).toBeCloseTo(-n.y * p.z / 0.5, 5);
      } else {
        // Walls: v is height, u runs along the wall.
        expect(v).toBeCloseTo(p.y / 0.5, 5);
        expect(u).toBeCloseTo(Math.abs(n.x) > 0.9 ? -n.x * p.z / 0.5 : n.z * p.x / 0.5, 5);
      }
    }
  }
  // A roof pitched 30 degrees: distances in UV times the tile equal distances on the face.
  const roof = uvs(new THREE.BoxGeometry(6, 0.2, 4).rotateX(Math.PI / 6), 2);
  for (let i = 0; i < roof.pos.count; i += 3) {
    for (const [j, k] of [[0, 1], [1, 2], [2, 0]] as const) {
      const d = new THREE.Vector3().fromBufferAttribute(roof.pos, i + j).distanceTo(new THREE.Vector3().fromBufferAttribute(roof.pos, i + k));
      const du = Math.hypot(roof.uv.getX(i + j) - roof.uv.getX(i + k), roof.uv.getY(i + j) - roof.uv.getY(i + k));
      expect(du * 2).toBeCloseTo(d, 4);
    }
  }
  // Two boxes side by side share one texture across the joint: same UV at the same point.
  const left = uvs(new THREE.BoxGeometry(1, 1, 1).translate(-0.5, 0, 0), 1), right = uvs(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0), 1);
  const topAt = (g: ReturnType<typeof uvs>, x: number, z: number) => {
    for (let i = 0; i < g.pos.count; i++) {
      // Top faces only: all three corners of the triangle at y = 0.5.
      const first = i - (i % 3);
      if (![0, 1, 2].every(k => Math.abs(g.pos.getY(first + k) - 0.5) < 1e-6)) continue;
      if (Math.abs(g.pos.getX(i) - x) < 1e-6 && Math.abs(g.pos.getZ(i) - z) < 1e-6) return [g.uv.getX(i), g.uv.getY(i)];
    }
    return null;
  };
  expect(topAt(left, 0, 0.5)).toEqual(topAt(right, 0, 0.5));
  // A box keeps its index (its faces share no vertices) and gets the same coordinates as split up.
  const indexed = new THREE.BoxGeometry(2, 2, 2).translate(10, 1, 4);
  expect(planarUVs(indexed, 0.5)).toBe(true);
  expect(indexed.index).not.toBeNull();
  const split = indexed.toNonIndexed(), splitUv = uvs(indexed, 0.5).uv, uv2 = indexed.getAttribute('uv');
  for (let i = 0; i < split.getAttribute('position').count; i++) {
    const vertex = indexed.index!.getX(i);
    expect(uv2.getX(vertex)).toBeCloseTo(splitUv.getX(i), 5);
    expect(uv2.getY(vertex)).toBeCloseTo(splitUv.getY(i), 5);
  }
  // A smooth sphere shares vertices across facets: nothing is written, the caller splits it.
  const sphere = new THREE.SphereGeometry(1, 8, 6), own = sphere.getAttribute('uv');
  expect(planarUVs(sphere, 1)).toBe(false);
  expect(sphere.getAttribute('uv')).toBe(own);
});

test('Low draws one merged mesh per surface key; the realistic tiers draw one group per tag and hide flat-only joints', () => {
  const level = build('mexico');
  // Merged meshes carry one group per tag (a loose primitive keeps its own groups, if any, and one tag).
  const merged = level.surfaces.filter(s => s.mesh.geometry.groups.length === s.materials.length);
  const keys = new Set(merged.map(s => s.surf));
  expect(merged.length).toBe(keys.size);
  expect(merged.length).toBeLessThan(20);
  for (const { mesh, materials } of merged) {
    // Every triangle is in exactly one group, in order, and the geometry is indexed.
    const groups = mesh.geometry.groups;
    groups.forEach((g, i) => expect(g.materialIndex).toBe(i));
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(mesh.geometry.index!.count);
    expect(new Set(materials).size).toBe(materials.length);
  }
  // The plaza's sand joints are flat-only.
  expect(level.surfaces.find(s => s.surf === 'sand')?.materials).toContain(null);
});

test('the shadow pass draws each run of visible groups once, skipping the hidden ones', () => {
  const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial(), hidden = hiddenMat();
  const groups = ([[0, 6, 0], [6, 3, 1], [9, 12, 2], [21, 3, 0]] as const).map(([start, count, materialIndex]) => ({ start, count, materialIndex }));
  expect(casterGroups(groups, [a, b, hidden])).toEqual([{ start: 0, count: 9, materialIndex: 0 }, { start: 21, count: 3, materialIndex: 0 }]);
  expect(casterGroups(groups, [a, b, a])).toEqual([{ start: 0, count: 24, materialIndex: 0 }]);
  expect(casterGroups(groups, [hidden, hidden, hidden])).toEqual([]);
});

test('each tier streams its own size, and every file is where the URL says, within the per-map budget', async () => {
  expect(TEXTURE_SIZE[PRESET_VALUES.medium.textures]).toBe(512);
  expect(TEXTURE_SIZE[PRESET_VALUES.high.textures]).toBe(1024);
  expect(TEXTURE_SIZE[PRESET_VALUES.ultra.textures]).toBe(2048);
  expect(textureUrl('brick', 1024, 'normal')).toBe('/textures/1024/brick-normal.ktx2');
  // docs/VISUALS.md R2: per-map download at most 8 MB on Medium, 20 on High, 45 on Ultra.
  const budget = { 512: 8e6, 1024: 20e6, 2048: 45e6 } as const;
  for (const [key, arena] of MAPS) {
    const sets = setsFor(tagsOf(build(key, arena)));
    for (const size of [512, 1024, 2048] as const) expect(downloadBytes(sets, size), `${key} ${size}`).toBeLessThanOrEqual(budget[size]);
  }
  // The manifest's sizes are the files' sizes (so the budget above is real), for every set and size.
  for (const set of TEXTURE_SETS) {
    for (const size of [512, 1024, 2048] as const) {
      const lengths = await Promise.all(TEXTURE_MAPS.map(async map => {
        const response = await fetch(textureUrl(set, size, map));
        expect(response.ok, textureUrl(set, size, map)).toBe(true);
        return (await response.arrayBuffer()).byteLength;
      }));
      expect(lengths, `${set} ${size}`).toEqual(setInfo(set).bytes[`${size}`]);
    }
  }
});

/** A loader that makes compressed textures (one 1 KB mip) on demand and counts what is alive. */
function fakeLoader() {
  const alive = new Set<THREE.Texture>();
  const pending: (() => void)[] = [];
  const load = (url: string) => new Promise<THREE.Texture>(resolve => {
    pending.push(() => {
      const mip = { data: new Uint8Array(1024), width: 32, height: 32 } as unknown as ImageData;
      const texture = new THREE.CompressedTexture([mip], 32, 32, THREE.RGBA_S3TC_DXT1_Format);
      texture.name = url;
      alive.add(texture);
      texture.addEventListener('dispose', () => alive.delete(texture));
      resolve(texture);
    });
  });
  const flush = async () => { while (pending.length) pending.shift()!(); await new Promise(r => setTimeout(r, 0)); };
  return { load, alive, flush };
}

test('streaming: nothing reaches the GPU before pump, sets swap together, and nothing leaks', async () => {
  const { load, alive, flush } = fakeLoader();
  const upload = vi.fn();
  const streamer = new TextureStreamer(load, upload);
  streamer.want(['brick', 'asphalt'], 512);
  expect(streamer.ready).toBe(false);
  await flush();
  expect(upload).not.toHaveBeenCalled();
  expect(streamer.maps('brick')).toBeNull();
  // One map per pump; once on the GPU its CPU copy is gone, and its size is still counted.
  expect(streamer.pump()).toBe(1024);
  expect(upload).toHaveBeenCalledTimes(1);
  const first = upload.mock.calls[0]![0] as THREE.CompressedTexture;
  expect(first.mipmaps).toEqual([]);
  expect(first.image.width).toBe(32);
  expect(streamer.residentBytes).toBe(1024);
  while (!streamer.ready) streamer.pump();
  expect(upload).toHaveBeenCalledTimes(6);
  expect(streamer.residentBytes).toBe(6 * 1024);
  expect(streamer.pump()).toBe(0);
  expect(streamer.maps('brick')?.albedo.name).toBe('/textures/512/brick-albedo.ktx2');
  // Only wanted sets are handed out, even while an unwanted one is still alive.
  expect(streamer.maps('sand')).toBeNull();
  // A bigger size: the 512 set stays alive (still on screen) until the 1024 one is in and pruned.
  streamer.want(['brick', 'asphalt'], 1024);
  expect(streamer.ready).toBe(false);
  expect(alive.size).toBe(6);
  await flush();
  while (!streamer.ready) streamer.pump();
  expect(streamer.ready).toBe(true);
  expect(alive.size).toBe(12);
  streamer.prune();
  expect(alive.size).toBe(6);
  expect([...alive].every(t => t.name.includes('/1024/'))).toBe(true);
  // Another map sharing one set: the shared set is not fetched again, and the other one is
  // freed at once, not when the new map's sets are in (no material of the new map wears it).
  streamer.want(['brick', 'sand'], 1024);
  expect([...alive].map(t => t.name).sort()).toEqual(TEXTURE_MAPS.map(m => `/textures/1024/brick-${m}.ktx2`).sort());
  await flush();
  while (!streamer.ready) streamer.pump();
  streamer.prune();
  expect([...alive].map(t => t.name).sort()).toEqual(TEXTURE_MAPS.flatMap(m => ['brick', 'sand'].map(s => `/textures/1024/${s}-${m}.ktx2`)).sort());
  // A download that lands after its set was dropped is freed on arrival.
  streamer.want(['grass'], 1024);
  streamer.clear();
  await flush();
  expect(alive.size).toBe(0);
  expect(streamer.textureCount).toBe(0);
  // A failed set counts as done, so the others still swap in.
  let offline = true;
  const failing = new TextureStreamer(url => (offline && url.includes('sand') ? Promise.reject(new Error('404')) : load(url)), upload);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  failing.want(['sand', 'brick'], 512);
  await flush();
  while (!failing.ready) failing.pump();
  expect(failing.ready).toBe(true);
  expect(failing.maps('sand')).toBeNull();
  // Asked again (the next level load), a failed set is fetched again; the warning is not repeated.
  failing.want(['sand', 'brick'], 512);
  await flush();
  expect(failing.ready).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
  offline = false;
  failing.want(['sand', 'brick'], 512);
  expect(failing.ready).toBe(false);
  await flush();
  while (!failing.ready) failing.pump();
  expect(failing.maps('sand')?.albedo.name).toBe('/textures/512/sand-albedo.ktx2');
  failing.clear();
  expect(alive.size).toBe(0);
});

test('the renderer textures the level on realistic tiers, frees it all on Low, and between maps', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const training = build('training');
  renderer.setSurfaces(training.surfaces);
  renderer.applyQuality(PRESET_VALUES.low);
  renderer.render(0, fx);
  expect(renderer.texturesPending).toBe(false);
  expect(renderer.textureStats.textures).toBe(0);
  for (const { mesh, surf } of training.surfaces) expect(mesh.material).toBe(surfMat(surf));

  renderer.applyQuality(PRESET_VALUES.medium);
  for (const { mesh } of training.surfaces) for (const look of looksOf(mesh)) expect(look).toBeInstanceOf(THREE.MeshStandardMaterial);
  expect(renderer.texturesPending).toBe(true);
  const settle = async () => {
    for (let i = 0; i < 3000 && renderer.texturesPending; i++) { renderer.render(0, fx); await new Promise(r => setTimeout(r, 2)); }
    expect(renderer.texturesPending).toBe(false);
  };
  await settle();
  const sets = setsFor(tagsOf(training));
  expect(renderer.textureStats.textures).toBe(3 * sets.length);
  for (const { mesh } of training.surfaces) {
    for (const material of looksOf(mesh) as THREE.MeshStandardMaterial[]) {
      expect(material.map).toBeInstanceOf(THREE.CompressedTexture);
      expect(material.map!.image.width).toBe(512);
      // On the GPU only: the streamer freed the mip data after the upload.
      expect((material.map as THREE.CompressedTexture).mipmaps).toEqual([]);
    }
    // The shadow pass never samples a streamed map (materials.ts `levelDepthMat`).
    expect(mesh.customDepthMaterial).toBeDefined();
  }

  // Low -> realistic -> Low leaves nothing behind on the GPU: no freed map comes back
  // through three's shared shadow material (three frames draw the shadow map at least once).
  // Only the level's surfaces, so the last shadow caster is always a textured one.
  const casters = training.surfaces.map(s => s.mesh).filter(mesh => training.meshes.includes(mesh));
  renderer.scene.add(...casters);
  renderer.camera.position.set(0, 12, 30);
  renderer.camera.lookAt(0, 0, 0);
  const frames = () => { for (let i = 0; i < 3; i++) renderer.render(0, fx); return renderer.three.info.memory.textures; };
  const trip = async () => {
    renderer.applyQuality(PRESET_VALUES.medium);
    await settle();
    frames();
    renderer.applyQuality(PRESET_VALUES.low);
    return frames();
  };
  // The 1 x 1 stand-ins stay for good: they are first drawn, and uploaded, while the second trip streams.
  await trip();
  const before = await trip();
  for (let i = 0; i < 2; i++) expect(await trip(), `trip ${i}`).toBe(before);
  renderer.scene.remove(...casters);
  renderer.applyQuality(PRESET_VALUES.medium);
  await settle();

  // Another map: only its own sets stay; the training-only ones are freed with the first frame
  // (not once the house's sets are in), and no material keeps one.
  const house = build('house');
  renderer.setSurfaces(house.surfaces);
  renderer.render(0, fx);
  const houseSets = setsFor(tagsOf(house));
  const owned = (t: THREE.Texture | null) => t !== null && renderer._textures!.owns(t);
  const wornOrStandIn = () => {
    for (const material of realMaterials()) {
      const set = material.userData.set as (typeof TEXTURE_SETS)[number];
      expect(owned(material.map) || material.map === standInMaps(set, setInfo(set)).albedo).toBe(true);
    }
  };
  expect(renderer.textureStats.textures).toBe(3 * sets.filter(set => houseSets.includes(set)).length);
  wornOrStandIn();
  await settle();
  expect(renderer.textureStats.textures).toBe(3 * houseSets.length);
  wornOrStandIn();

  // Every shadow light draws a multi-tag mesh once per run of visible groups (materials.ts
  // `casterGroups`), not once per group; the main pass still draws a group per tag, and the
  // mesh keeps its own materials and groups.
  const merged = house.surfaces.map(s => s.mesh).filter(mesh => Array.isArray(mesh.material));
  const draws = merged.map(mesh => {
    const count = { mesh, material: mesh.material, groups: mesh.geometry.groups, shadow: 0, main: 0 };
    mesh.frustumCulled = false;
    mesh.onBeforeShadow = () => { count.shadow++; };
    mesh.onBeforeRender = () => { count.main++; };
    return count;
  });
  renderer.scene.add(...merged);
  renderer._frame = renderer._shadowEvery - 1;
  renderer.render(0, fx);
  const lights = [renderer.sun, ...renderer.cascades].filter(light => light.castShadow).length;
  expect(lights).toBeGreaterThan(0);
  let saved = 0;
  for (const { mesh, material, groups, shadow, main } of draws) {
    const looks = looksOf(mesh), runs = casterGroups(groups, looks).length;
    expect(shadow).toBe(lights * runs);
    expect(main).toBeGreaterThanOrEqual(groups.filter(g => looks[g.materialIndex!]!.visible).length);
    expect(mesh.material).toBe(material);
    expect(mesh.geometry.groups).toBe(groups);
    saved += groups.length - runs;
    mesh.onBeforeShadow = mesh.onBeforeRender = () => {};
    mesh.frustumCulled = true;
  }
  expect(saved).toBeGreaterThan(merged.length);
  renderer.scene.remove(...merged);

  // A bigger texture size swaps once the new size is in, then frees the old one. One map goes
  // up at a time, spaced in time whatever the frame rate: the first after the settle, the rest
  // at least `UPLOAD_GAP_MS` apart (render/index.ts).
  const uploads: number[] = [], initTexture = renderer.three.initTexture.bind(renderer.three);
  renderer.three.initTexture = texture => { uploads.push(performance.now()); initTexture(texture); };
  const asked = performance.now();
  renderer.applyQuality({ ...PRESET_VALUES.medium, textures: 'medium' });
  await settle();
  renderer.three.initTexture = initTexture;
  expect(uploads.length).toBeGreaterThan(0);
  expect(uploads[0]! - asked).toBeGreaterThanOrEqual(UPLOAD_SETTLE_MS);
  for (let i = 1; i < uploads.length; i++) expect(uploads[i]! - uploads[i - 1]!).toBeGreaterThanOrEqual(UPLOAD_GAP_MS);
  expect(renderer.textureStats.textures).toBe(3 * houseSets.length);
  expect((looksOf(house.surfaces[0]!.mesh)[0] as THREE.MeshStandardMaterial).map!.image.width).toBe(1024);

  // Low: the flat palette again, and every streamed texture gone.
  renderer.applyQuality(PRESET_VALUES.low);
  for (const { mesh, surf } of house.surfaces) expect(mesh.material).toBe(surfMat(surf));
  expect(renderer.textureStats.textures).toBe(0);
  expect(renderer._textures).toBeNull();
  for (const material of realMaterials()) {
    const set = material.userData.set as (typeof TEXTURE_SETS)[number];
    expect(material.map).toBe(standInMaps(set, setInfo(set)).albedo);
  }

}, 60_000);

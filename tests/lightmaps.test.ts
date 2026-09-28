import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { BAKE_FADE_MS, Renderer } from '@/engine/render/index';
import { BAKE_UNIFORMS, GRID_UNIFORMS, realMaterials, standInGrid, standInLightmap } from '@/engine/render/materials';
import {
  ALIGN, BAKE_FILE, BAKE_FILES, LIGHTMAP_SIZE, NO_LIGHTMAP, PADDING, bakeFor, bakeMips, bakeUrl, bakedTriangles, bakes, layoutLightmap,
  layoutSteps, lightmapChartSteps, lightmapCharts, parseBakes,
} from '@/engine/render/lightmap';
import { PRESET_VALUES } from '@/engine/render/quality';
import { parseSkyData, skyUrl } from '@/engine/render/sky';
import { ANISOTROPY, TEXTURE_SIZE } from '@/engine/render/surfaces';
import { BakeStreamer } from '@/engine/render/textures';
import type { BakeInfo } from '@/engine/render/lightmap';
import type { Level } from '@/engine/types';

/** Every map and variant with its own geometry: each must have a bake (tools/lightmaps/export.ts `BAKES`). */
const MAPS = [['downtown', false], ['downtown', true], ['house', false], ['mexico', false], ['training', false]] as const;
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function build(key: string, arena = false): Level {
  const scene = new THREE.Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena });
  cleanup.push(() => disposeLevel(scene, level));
  return level;
}

test('every bake matches its map as built today: edit a map and this fails until `npm run lightmaps`', () => {
  for (const [key, arena] of MAPS) {
    const level = build(key, arena), bake = bakeFor(level);
    expect(bake?.name, `${key} ${arena}`).toBe(arena ? `${key}-arena` : key);
    const charts = lightmapCharts(level.surfaces, level.bounds);
    expect(charts.hash, `${bake!.name}: static geometry changed since the bake`).toBe(bake!.info.hash);
    // The renderer's cheap check (the hash pass alone) agrees.
    expect(bakedTriangles(level.surfaces).hash).toBe(charts.hash);
    const layout = layoutLightmap(charts, LIGHTMAP_SIZE, bake!.info.density)!;
    expect([layout.triangles, layout.charts.length, layout.rows], bake!.name).toEqual([bake!.info.triangles, bake!.info.charts, bake!.info.rows]);
  }
  // The other maps' arenas are the same geometry, so they share the map's bake.
  for (const key of ['house', 'mexico'] as const) {
    const level = build(key, true), bake = bakeFor(level);
    expect(bake?.name).toBe(key);
    expect(lightmapCharts(level.surfaces, level.bounds).hash).toBe(bake!.info.hash);
  }
  expect(Object.keys(bakes()).sort()).toEqual(MAPS.map(([key, arena]) => (arena ? `${key}-arena` : key)).sort());
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(parseBakes({ size: LIGHTMAP_SIZE, bakes: { x: { map: 'x' }, ...bakes() } })).toEqual(bakes());
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('x is malformed'));
  warn.mockRestore();
  expect(() => parseBakes({ size: 1024, bakes: {} })).toThrow();
});

test('the layout runs in short steps that give the same charts and uv1 as at once', () => {
  const level = build('mexico'), info = bakeFor(level)!.info, triangles = bakedTriangles(level.surfaces);
  let steps = 0, longest = 0;
  const run = <T>(generator: Generator<void, T>): T => {
    for (;;) {
      const start = performance.now(), next = generator.next();
      longest = Math.max(longest, performance.now() - start);
      if (next.done) return next.value;
      steps++;
    }
  };
  const charts = run(lightmapChartSteps(level.surfaces, level.bounds, triangles));
  const layout = run(layoutSteps(charts, LIGHTMAP_SIZE, info.density))!;
  // Mexico's 30,000-odd triangles take tens of steps, none long (the whole pass is 30-80 ms on a desktop).
  expect(steps).toBeGreaterThan(20);
  expect(longest).toBeLessThan(25);
  const once = layoutLightmap(lightmapCharts(level.surfaces, level.bounds), LIGHTMAP_SIZE, info.density)!;
  expect(layout.charts).toEqual(once.charts);
  expect(layout.uvs.every((uv, i) => uv.every((v, k) => v === once.uvs[i]![k]))).toBe(true);
});

test('a layout that no longer matches its bake keeps the probe, and its zero uv1 stays on the geometry', () => {
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  const level = build('training'), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.high);
  renderer._checkBake();
  expect(renderer._bakeLayout).not.toBeNull();
  const uv1 = level.surfaces.filter(s => s.static).map(s => s.mesh.geometry.getAttribute('uv1'));
  expect(uv1.every(a => a !== undefined)).toBe(true);
  // The same hash, another layout (as a map edit the hash misses would give).
  renderer._bake = { ...renderer._bake!, info: { ...renderer._bake!.info, charts: -1 } };
  while (!renderer._layBake()) { /* one budgeted step a slot */ }
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('bake training'));
  expect(renderer._bake).toBeNull();
  // Left on (the unbaked materials never read it): taking it off would strand its GPU buffer.
  expect(level.surfaces.filter(s => s.static).map(s => s.mesh.geometry.getAttribute('uv1'))).toEqual(uv1);
  expect(level.surfaces.every(s => [s.mesh.material].flat().every(m => !m.userData.baked))).toBe(true);
  warn.mockRestore();
});

test('each bake was made under the map\'s current sky', async () => {
  for (const [name, info] of Object.entries(bakes())) {
    const mood = build(info.map, info.arena).mood;
    const sky = parseSkyData(await (await fetch(skyUrl(mood?.sky ?? info.map, 'sky.json'))).json());
    expect(info.sky, name).toBe(sky.map);
    expect(info.sun, `${name}: re-bake after re-rendering the sky`).toEqual(sky.sun);
  }
});

test('lightmap UVs: deterministic, one texel density, charts apart by their padding, aligned cells', () => {
  for (const [key, arena] of [['house', false], ['mexico', false]] as const) {
    const a = build(key, arena), b = build(key, arena);
    const info = bakeFor(a)!.info;
    const la = layoutLightmap(lightmapCharts(a.surfaces, a.bounds), LIGHTMAP_SIZE, info.density)!;
    const lb = layoutLightmap(lightmapCharts(b.surfaces, b.bounds), LIGHTMAP_SIZE, info.density)!;
    expect(la.uvs.length).toBe(lb.uvs.length);
    la.uvs.forEach((uv, i) => expect(uv).toEqual(lb.uvs[i]));
    // Cells: inside the atlas, on the ALIGN grid, and no two overlap.
    const used = new Uint8Array((LIGHTMAP_SIZE / ALIGN) ** 2);
    for (const { x, y, w, h } of la.charts) {
      for (const v of [x, y, w, h]) expect(v % ALIGN).toBe(0);
      expect(x + w).toBeLessThanOrEqual(LIGHTMAP_SIZE);
      expect(y + h).toBeLessThanOrEqual(LIGHTMAP_SIZE);
      for (let cy = y / ALIGN; cy < (y + h) / ALIGN; cy++) {
        for (let cx = x / ALIGN; cx < (x + w) / ALIGN; cx++) {
          expect(used[cy * (LIGHTMAP_SIZE / ALIGN) + cx]).toBe(0);
          used[cy * (LIGHTMAP_SIZE / ALIGN) + cx] = 1;
        }
      }
    }
    // Every drawn triangle lies inside one cell's content, PADDING texels from its edges, and at the map's
    // density: texels between two corners over metres between them.
    const cells = la.charts;
    const cellOf = (u: number, v: number) => cells.find(c => u >= c.x && u <= c.x + c.w && v >= c.y && v <= c.y + c.h);
    let checked = 0, even = 0;
    const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
    la.surfaces.forEach((surface, i) => {
      const uv = la.uvs[i]!, geometry = surface.mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
      surface.mesh.updateWorldMatrix(true, false);
      const n = index ? index.count : position.count;
      for (let t = 0; t < n; t += 3) {
        const corners = [0, 1, 2].map(k => (index ? index.getX(t + k) : t + k));
        const us = corners.map(c => uv[2 * c]! * LIGHTMAP_SIZE), vs = corners.map(c => uv[2 * c + 1]! * LIGHTMAP_SIZE);
        if (us.every(u => u === NO_LIGHTMAP * LIGHTMAP_SIZE)) continue;
        const cell = cellOf(us[0]!, vs[0]!)!;
        expect(cell).toBeDefined();
        for (let k = 0; k < 3; k++) {
          expect(us[k]! - cell.x).toBeGreaterThanOrEqual(PADDING - 1e-3);
          expect(cell.x + cell.w - us[k]!).toBeGreaterThanOrEqual(PADDING - 1e-3);
          expect(vs[k]! - cell.y).toBeGreaterThanOrEqual(PADDING - 1e-3);
          expect(cell.y + cell.h - vs[k]!).toBeGreaterThanOrEqual(PADDING - 1e-3);
        }
        p.fromBufferAttribute(position, corners[0]!).applyMatrix4(surface.mesh.matrixWorld);
        q.fromBufferAttribute(position, corners[1]!).applyMatrix4(surface.mesh.matrixWorld);
        // A displaced shell (Mexico's rock stacks, R6) is one chart per face, laid flat over the face's plane: its
        // facets' edges out of that plane read short, as they should. The check reads the flat pieces.
        if (surface.realOnly) {
          r.fromBufferAttribute(position, corners[2]!).applyMatrix4(surface.mesh.matrixWorld);
          if (!(['x', 'y', 'z'] as const).some(k => Math.abs(p[k] - q[k]) < 1e-4 && Math.abs(p[k] - r[k]) < 1e-4)) continue;
        }
        const metres = p.distanceTo(q), texels = Math.hypot(us[0]! - us[1]!, vs[0]! - vs[1]!);
        if (metres * info.density > 2) {
          checked++;
          if (Math.abs(texels / metres - info.density) < 1e-3) even++;
        }
      }
    });
    expect(checked).toBeGreaterThan(1000);
    // A chart under a texel across one way is stretched that way (so an edge across it is too).
    expect(even / checked, key).toBeGreaterThan(0.95);
  }
});

test('each tier streams its own bake file, every file is where the URL says, within the per-map budget', async () => {
  expect(BAKE_FILE[PRESET_VALUES.medium.textures]).toBe('ao-512');
  expect(BAKE_FILE[PRESET_VALUES.high.textures]).toBe('light-1024');
  expect(BAKE_FILE[PRESET_VALUES.ultra.textures]).toBe('light-2048');
  expect(bakeUrl('house', 'light-2048')).toBe('/maps/house/light-2048.ktx2');
  expect(bakeUrl('house', 'probes')).toBe('/maps/house/probes.bin');
  // The padding holds every mip level a file keeps: 4 texels at 2K is 3 levels, 2 at 1K is 2, 1 at 512 is 1.
  expect([bakeMips('light-2048'), bakeMips('light-1024'), bakeMips('ao-512')]).toEqual([3, 2, 1]);
  // Anisotropy per tier: Medium 4x, High 8x, Ultra 16x (capped by the GPU at load).
  expect([PRESET_VALUES.medium, PRESET_VALUES.high, PRESET_VALUES.ultra].map(q => ANISOTROPY[TEXTURE_SIZE[q.textures]])).toEqual([4, 8, 16]);
  for (const [name, info] of Object.entries(bakes())) {
    // docs/VISUALS.md R3: at most 4 MB a map on High, 8 on Ultra (lightmap and probe grid).
    expect(info.bytes['light-1024'] + info.bytes.probes, name).toBeLessThanOrEqual(4e6);
    expect(info.bytes['light-2048'] + info.bytes.probes, name).toBeLessThanOrEqual(8e6);
    // Medium's AO map is small: under a third of High's lightmap.
    expect(info.bytes['ao-512'], name).toBeLessThan(info.bytes['light-1024'] / 3);
    for (const file of BAKE_FILES) {
      const response = await fetch(bakeUrl(name, file));
      expect(response.ok, bakeUrl(name, file)).toBe(true);
      expect((await response.arrayBuffer()).byteLength, `${name} ${file}`).toBe(info.bytes[file]);
    }
  }
});

/** A lightmap and grid loader that makes them on demand and counts the lightmaps alive. */
function fakeBakes() {
  const alive = new Set<THREE.Texture>();
  const pending: (() => void)[] = [];
  const track = (texture: THREE.Texture, name: string): THREE.Texture => {
    texture.name = name;
    alive.add(texture);
    texture.addEventListener('dispose', () => alive.delete(texture));
    return texture;
  };
  const load = (url: string) => new Promise<THREE.Texture>(resolve => pending.push(() => {
    const mip = { data: new Uint8Array(2048), width: 32, height: 32 } as unknown as ImageData;
    resolve(new THREE.CompressedTexture([mip], 32, 32, THREE.RGBA_BPTC_Format));
  })).then(texture => track(texture, url));
  const loadGrid = () => new Promise<Uint8Array<ArrayBuffer>>(resolve => pending.push(() => resolve(new Uint8Array(6 * 4 * 8))));
  const flush = async () => { while (pending.length) pending.shift()!(); await new Promise(r => setTimeout(r, 0)); };
  return { load, loadGrid, alive, flush };
}

test('bake streaming: nothing reaches the GPU before pump, sizes swap once in, other maps free at once, nothing leaks', async () => {
  const { load, loadGrid, alive, flush } = fakeBakes();
  const upload = vi.fn();
  const streamer = new BakeStreamer(load, loadGrid, upload);
  const info = { grid: { min: [0, 0, 0], cells: [2, 2, 2], cell: 1 } } as unknown as BakeInfo;
  const ask = (name: string, file: 'ao-512' | 'light-1024' | 'light-2048') => streamer.want({ name, file, info });
  ask('house', 'ao-512');
  expect(streamer.ready).toBe(false);
  await flush();
  expect(upload).not.toHaveBeenCalled();
  expect(streamer.take()).toBeNull();
  // Lightmap, then grid; each CPU copy freed once up.
  expect(streamer.pump()).toBe(2048);
  expect(streamer.pump()).toBe(6 * 4 * 8);
  expect(streamer.pump()).toBe(0);
  expect(upload).toHaveBeenCalledTimes(2);
  const first = streamer.take()!;
  expect(first.ao).toBe(true);
  expect((first.lightmap as THREE.CompressedTexture).mipmaps).toEqual([]);
  expect(first.grid!.image.data).toBeNull();
  expect(streamer.current).toBe(first);
  expect(streamer.stats.residentBytes).toBe(2048 + 6 * 4 * 8);
  const gridFreed = vi.fn();
  first.grid!.addEventListener('dispose', gridFreed);
  // Another size of the same map: the old one stays current (on screen) until the new one is taken.
  ask('house', 'light-2048');
  await flush();
  while (streamer.pump() > 0);
  expect(streamer.current).toBe(first);
  expect(alive.size).toBe(2);
  expect(gridFreed).not.toHaveBeenCalled();
  const second = streamer.take()!;
  expect(second.file).toBe('light-2048');
  expect(alive.size).toBe(1);
  expect(gridFreed).toHaveBeenCalledTimes(1);
  // Asking again for what is current fetches nothing.
  ask('house', 'light-2048');
  expect(streamer.ready).toBe(true);
  // Another map: the current bake belongs to other UVs, so it is freed at once.
  ask('mexico', 'light-2048');
  expect(streamer.current).toBeNull();
  expect(alive.size).toBe(0);
  // A download that lands after it was dropped is freed on arrival.
  streamer.clear();
  await flush();
  expect(alive.size).toBe(0);
  // A failed bake leaves nothing current and says so, and the level keeps the probe.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const failing = new BakeStreamer(() => Promise.reject(new Error('404')), loadGrid, upload);
  failing.want({ name: 'house', file: 'light-1024', info });
  await flush();
  expect(failing.ready).toBe(true);
  expect(failing.take()).toBeNull();
  expect(failing.failed).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
});

// About 40 s alone; beside the suite's other streaming tests in the one browser 88-94 s (c2c96cf's 88).
test('the renderer lights the static level with its bake on realistic tiers, props and figures from the grid, and frees it all', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const errors = vi.spyOn(console, 'error');
  const level = build('training');
  // As at boot: the level arrives on the renderer's default (realistic) look, then Low is applied
  // before the first frame. Low never lays the charts out: no uv1, nothing streamed.
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.low);
  renderer.render(0, fx);
  expect(renderer.bakePending).toBe(false);
  expect(renderer.bakeStats.textures).toBe(0);
  expect(level.surfaces.every(s => !s.mesh.geometry.getAttribute('uv1'))).toBe(true);
  // The bake uploads ahead of the textures, so most steps wait for it alone. Every mix seen on the way is kept.
  const mixes: number[] = [];
  const settle = async (textures = false) => {
    for (let i = 0; i < 2000 && (renderer.bakePending || (textures && renderer.texturesPending)); i++) {
      renderer.render(0, fx);
      mixes.push(BAKE_UNIFORMS.bakeMix.value);
      await new Promise(r => setTimeout(r, 5));
    }
    expect(renderer.bakePending).toBe(false);
  };
  const baked = () => [...realMaterials()].filter(m => m.userData.baked);

  // Medium: the AO map; the static meshes get their uv1 and baked materials on the first frame, on the stand-in until it is in.
  renderer.applyQuality(PRESET_VALUES.medium);
  expect(renderer.bakePending).toBe(true);
  renderer.render(0, fx);
  for (const { mesh } of level.surfaces) {
    expect(mesh.geometry.getAttribute('uv1')?.count).toBe(mesh.geometry.getAttribute('position').count);
    for (const look of [mesh.material].flat()) if (look.visible) expect(look.userData.baked).toBe(true);
  }
  expect(baked().every(m => m.lightMap === standInLightmap())).toBe(true);
  expect(renderer.bakePending).toBe(true);
  await settle();
  expect(renderer.bakeStats.file).toBe('ao-512');
  expect(BAKE_UNIFORMS.bakeAo.value).toBe(1);
  expect(baked().every(m => m.lightMap instanceof THREE.CompressedTexture && m.lightMap.image.width === 512)).toBe(true);
  expect(GRID_UNIFORMS.probeGrid.value).not.toBe(standInGrid());
  // It fades in, eased, over BAKE_FADE_MS, not at once, and the frames draw (every patched program compiles).
  // `bakeFading` holds until it is all the way in, so screenshots can wait for the final look.
  expect(BAKE_UNIFORMS.bakeMix.value).toBeLessThan(0.5);
  expect(renderer.bakeFading).toBe(true);
  renderer._bakeFade = performance.now() - BAKE_FADE_MS / 2;
  renderer.render(0, fx);
  expect(BAKE_UNIFORMS.bakeMix.value).toBeCloseTo(0.5, 1);
  expect(renderer.bakeFading).toBe(true);
  renderer._bakeFade -= BAKE_FADE_MS;
  renderer.render(0, fx);
  expect(BAKE_UNIFORMS.bakeMix.value).toBe(1);
  expect(GRID_UNIFORMS.probeGridMix.value).toBe(1);
  expect(renderer.bakeFading).toBe(false);
  // Lightmaps take no anisotropic filtering: its footprint would reach past a chart's padding.
  expect(baked().every(m => m.lightMap!.anisotropy === 1)).toBe(true);
  // The bakes' loader (its own transcoder) stays for the next file, so it is fetched and compiled once.
  const bakeLoader = renderer._bakeKtx2;
  expect(bakeLoader).not.toBeNull();

  // Ultra: the 2K lightmap of the same map replaces it once in, in place: the light never drops back to the probe.
  mixes.length = 0;
  renderer.applyQuality(PRESET_VALUES.ultra);
  await settle();
  renderer.render(0, fx);
  expect(renderer.bakeStats.file).toBe('light-2048');
  expect(BAKE_UNIFORMS.bakeAo.value).toBe(0);
  expect(baked().every(m => (m.lightMap?.image as { width: number }).width === 2048)).toBe(true);
  expect(renderer.bakeStats.textures).toBe(2);
  expect(mixes.length).toBeGreaterThan(0);
  expect(Math.min(...mixes, BAKE_UNIFORMS.bakeMix.value)).toBe(1);
  expect(renderer._bakeKtx2).toBe(bakeLoader);

  // A restart builds the same map again: only its hash is taken, and the checked layout is reused (the very
  // uv1 arrays; a new layout would make new ones). The bake stays on, at full strength.
  const again = build('training');
  const uv1 = (l: Level) => l.surfaces.filter(s => s.static).map(s => s.mesh.geometry.getAttribute('uv1').array);
  renderer.setSurfaces(again.surfaces, again);
  renderer.render(0, fx);
  expect(uv1(again).every((uv, i) => uv === uv1(level)[i])).toBe(true);
  expect(renderer.bakePending).toBe(false);
  expect(BAKE_UNIFORMS.bakeMix.value).toBe(1);
  renderer.setSurfaces(level.surfaces, level);
  renderer.render(0, fx);

  // Low <-> realistic trips leave the GPU's texture count where it was; Low frees everything and puts the stand-ins back.
  renderer.scene.add(...level.meshes);
  const trip = async () => {
    renderer.applyQuality(PRESET_VALUES.medium);
    await settle(true);
    renderer.render(0, fx);
    renderer.applyQuality(PRESET_VALUES.low);
    renderer.render(0, fx);
    return renderer.three.info.memory.textures;
  };
  await trip();
  const before = await trip();
  expect(await trip()).toBe(before);
  renderer.scene.remove(...level.meshes);
  expect(renderer.bakeStats.textures).toBe(0);
  expect(renderer._bakes).toBeNull();
  expect(renderer._bakeKtx2).toBeNull();
  expect(baked().every(m => m.lightMap === standInLightmap())).toBe(true);
  expect(BAKE_UNIFORMS.bakeMix.value).toBe(0);
  expect(GRID_UNIFORMS.probeGrid.value).toBe(standInGrid());

  // A map without a bake (its geometry changed) keeps the probe: no uv1, and its static pieces go back to unbaked materials.
  renderer.applyQuality(PRESET_VALUES.high);
  const house = build('house');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  house.surfaces[0]!.mesh.geometry.getAttribute('position').setX(0, 1234);
  renderer.setSurfaces(house.surfaces, house);
  renderer.render(0, fx);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('bake house'));
  expect(house.surfaces.every(s => !s.mesh.geometry.getAttribute('uv1'))).toBe(true);
  expect(house.surfaces.every(s => [s.mesh.material].flat().every(m => !m.userData.baked))).toBe(true);
  expect(renderer.bakePending).toBe(false);
  expect(errors).not.toHaveBeenCalled();
}, 150_000);

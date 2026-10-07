// Export each map's static level for the bake (docs/VISUALS.md, R3). Run by tools/lightmaps/build.mjs:
//   node --experimental-transform-types --import ./tools/lightmaps/register.mjs tools/lightmaps/export.ts [name…]
// Builds every map with the game's own LevelBuilder, lays out the lightmap charts with the game's own
// packer (src/engine/render/lightmap.ts, at the highest density that fits), and writes per bake, into
// tools/lightmaps/.build/<name>/:
//   mesh.bin   float32 world positions (9 per triangle, three's axes), float32 uv1 (6 per triangle),
//              uint16 material index (1 per triangle), uint8 1 for a decal's triangle (see THIN)
//   mesh.json  the bake's inputs: hash, density, charts (cells, normals and middles), materials (linear albedo,
//              metalness), the probe grid, and the map's sky
import * as THREE from 'three';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLevel } from '../../src/engine/level/index';
import { World } from '../../src/engine/physics';
import { LIGHTMAP_SIZE, PADDING, ALIGN, bakeAlbedo, bakeName, drawnRanges, fitDensity, layoutLightmap, lightmapCharts } from '../../src/engine/render/lightmap';
import type { Level } from '../../src/engine/types';

/** Every map and variant with its own static geometry. Arenas of the other maps reuse the map's bake. */
export const BAKES = [['downtown', false], ['downtown', true], ['house', false], ['mexico', false], ['training', false]] as const;
/** Probe grid: the cell edge is the smallest of these that keeps the grid within `MAX_CELLS`. */
const CELL_SIZES = [1.5, 2, 2.5, 3, 4, 6];
const MAX_CELLS = 32000;
/** The grid covers the bounds plus this margin, from the lowest floor to this far above the highest roof. */
const GRID_MARGIN = 2;
const GRID_HEADROOM = 3;
/** No probes above this height (m): enemies fly lower, and the arena's dome is backdrop. */
const GRID_TOP = 50;

/**
 * A piece thinner than this (road paint, floor plates, joint strips) is a decal: it is baked, but
 * it neither shades nor lights anything. The floor texels under a 1 cm strip would otherwise go
 * dark and bleed out beside it as a dark line.
 */
const THIN = 0.03;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'tools/lightmaps/.build');

// The training map's floor labels draw their text on a canvas; the bake never sees them.
const canvasStub = () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) });
(globalThis as Record<string, unknown>).document ??= { createElement: canvasStub };

/** Per triangle, whether its piece (triangles joined by shared corner positions) is thinner than `THIN`. */
function decals(positions: Float64Array, count: number): Uint8Array {
  const parent = Int32Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i; };
  const byPoint = new Map<string, number>();
  for (let tri = 0; tri < count; tri++) {
    for (let k = 0; k < 3; k++) {
      const key = [0, 1, 2].map(axis => Math.round(positions[9 * tri + 3 * k + axis]! * 1e4)).join();
      const seen = byPoint.get(key);
      if (seen === undefined) { byPoint.set(key, tri); continue; }
      const a = find(seen), b = find(tri);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const lo = new Map<number, number[]>(), hi = new Map<number, number[]>();
  for (let tri = 0; tri < count; tri++) {
    const piece = find(tri);
    const min = lo.get(piece) ?? [Infinity, Infinity, Infinity], max = hi.get(piece) ?? [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 9; k++) {
      min[k % 3] = Math.min(min[k % 3]!, positions[9 * tri + k]!);
      max[k % 3] = Math.max(max[k % 3]!, positions[9 * tri + k]!);
    }
    lo.set(piece, min);
    hi.set(piece, max);
  }
  const thin = new Uint8Array(count);
  for (let tri = 0; tri < count; tri++) {
    const piece = find(tri), min = lo.get(piece)!, max = hi.get(piece)!;
    thin[tri] = Math.min(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) < THIN ? 1 : 0;
  }
  return thin;
}

/** The probe grid's box and cell: the bounds, from the lowest drawn floor to above the highest roof. */
function probeGrid(level: Level, positions: Float64Array, owner: readonly boolean[]): { min: number[]; cells: number[]; cell: number } {
  const { minX, maxX, minZ, maxZ } = level.bounds;
  let low = Infinity, high = -Infinity;
  for (let tri = 0; tri < owner.length; tri++) {
    if (!owner[tri]) continue;
    for (let k = 0; k < 3; k++) {
      const x = positions[9 * tri + 3 * k]!, y = positions[9 * tri + 3 * k + 1]!, z = positions[9 * tri + 3 * k + 2]!;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      low = Math.min(low, y);
      high = Math.max(high, y);
    }
  }
  const min = [minX - GRID_MARGIN, Math.floor(low), minZ - GRID_MARGIN];
  const size = [maxX - minX + 2 * GRID_MARGIN, Math.min(GRID_TOP, high + GRID_HEADROOM) - min[1]!, maxZ - minZ + 2 * GRID_MARGIN];
  for (const cell of CELL_SIZES) {
    const cells = size.map(s => Math.max(1, Math.ceil(s / cell)));
    if (cells[0]! * cells[1]! * cells[2]! <= MAX_CELLS) return { min, cells, cell };
  }
  throw new Error('probe grid too large');
}

const wanted = process.argv.slice(2);
for (const [key, arena] of BAKES) {
  const name = bakeName(key, arena);
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  const scene = new THREE.Scene();
  const level = buildLevel(scene, new World(), key, { arena });
  const charts = lightmapCharts(level.surfaces, level.bounds);
  const density = fitDensity(charts, LIGHTMAP_SIZE);
  const layout = layoutLightmap(charts, LIGHTMAP_SIZE, density);
  if (!layout) throw new Error(`${name}: charts do not fit`);
  const count = charts.owner.length;
  const positions = new Float32Array(9 * count), uvs = new Float32Array(6 * count), materials = new Uint16Array(count);
  const keys = new Map<string, number>(), table: ReturnType<typeof bakeAlbedo>[] = [];
  const visible: boolean[] = [];
  // Triangles come out of lightmapCharts in surface and group order (`drawnRanges`); walk them the same way for the tags.
  let tri = 0;
  charts.surfaces.forEach((surface, index) => {
    for (const { count: n, tag } of drawnRanges(surface)) {
      const albedo = bakeAlbedo(surface, tag);
      let id = keys.get(albedo.key);
      if (id === undefined) { keys.set(albedo.key, id = table.length); table.push(albedo); }
      for (let i = 0; i + 2 < n; i += 3, tri++) {
        if (charts.owner[tri] !== index) throw new Error(`${name}: triangle order drifted`);
        materials[tri] = id;
        const uv = layout.uvs[index]!;
        let seen = true;
        for (let k = 0; k < 3; k++) {
          const vertex = charts.corners[3 * tri + k]!;
          uvs[6 * tri + 2 * k] = uv[2 * vertex]!;
          uvs[6 * tri + 2 * k + 1] = uv[2 * vertex + 1]!;
          seen &&= uv[2 * vertex]! >= 0;
        }
        visible.push(seen);
      }
    }
  });
  if (tri !== count) throw new Error(`${name}: ${tri} of ${count} triangles exported`);
  positions.set(charts.positions);
  const grid = probeGrid(level, charts.positions, visible);
  const dir = path.join(out, name);
  await mkdir(dir, { recursive: true });
  const thin = decals(charts.positions, count);
  const bin = new Uint8Array(positions.byteLength + uvs.byteLength + materials.byteLength + thin.byteLength);
  bin.set(new Uint8Array(positions.buffer), 0);
  bin.set(new Uint8Array(uvs.buffer), positions.byteLength);
  bin.set(new Uint8Array(materials.buffer), positions.byteLength + uvs.byteLength);
  bin.set(thin, positions.byteLength + uvs.byteLength + materials.byteLength);
  await writeFile(path.join(dir, 'mesh.bin'), bin);
  const mood = level.mood ?? {};
  const spec = {
    name, map: key, arena, hash: layout.hash, size: LIGHTMAP_SIZE, padding: PADDING, align: ALIGN, density,
    triangles: count, visible: visible.filter(Boolean).length, decals: thin.reduce((n, v) => n + v, 0), rows: layout.rows, sky: mood.sky ?? key,
    materials: table, grid, charts: layout.charts.map(c => [c.x, c.y, c.w, c.h, ...c.normal.map(v => Math.round(v * 1e5) / 1e5), ...c.centre.map(v => Math.round(v * 1e3) / 1e3)]),
  };
  await writeFile(path.join(dir, 'mesh.json'), JSON.stringify(spec));
  console.log(`EXPORT ${name}: ${count} triangles (${spec.visible} with texels), ${layout.charts.length} charts, `
    + `${spec.decals} decal, ${density} texels/m (${(100 / density).toFixed(1)} cm), ${layout.rows} rows, grid ${grid.cells.join('x')} @ ${grid.cell} m, hash ${layout.hash}`);
}

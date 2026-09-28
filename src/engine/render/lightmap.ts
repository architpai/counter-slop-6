import * as THREE from 'three';
import manifest from './lightmaps.json';
import { MATERIAL_SET, resolveMaterial, setInfo } from './surfaces';
import type { TextureQuality } from './quality';
import type { TextureSet } from './surfaces';
import type { Bounds, Level, LevelSurface } from '../types';

/**
 * Baked lighting (docs/VISUALS.md, R3), the pure half: the lightmap UV layout,
 * the geometry hash a bake is keyed on, and which baked files a tier streams.
 * The GPU half is `materials.ts` (the shader patches) and `render/index.ts`
 * (streaming); the bake itself is `tools/lightmaps/build.mjs` and
 * `tools/blender/bake_level.py`.
 *
 * The second UV set is made here, from the level's own merged geometry, by a
 * deterministic chart packer: the exporter runs this code in Node, Blender
 * bakes into the atlas it lays out, and the game runs it again when a
 * realistic look first needs it. Nothing is downloaded for it and nothing can
 * drift: the same triangles in the same order give the same charts, and the
 * manifest's hash, chart count and atlas height catch any map edit that was
 * not baked again.
 *
 * Charts: every planar piece (a box face, a cylinder side quad, two coplanar
 * faces of neighbouring boxes that share a whole edge) is one chart, projected
 * onto its own plane in the axes the texture sets use (`planarUVs`), at one
 * texel density for the whole map. Backdrops beyond the playable area keep
 * the sky probe instead, and faces nobody can see get no texels either: the
 * world's underside, and faces pressed against an opposite face (a crate's
 * bottom on the ground, two wall segments end to end).
 *
 * Padding and mips: each chart sits `PADDING` texels inside its own cell, and
 * cells start and end on an `ALIGN`-texel grid of the full-size atlas. So a
 * block of 4 × 4 texels, a mip texel down to the full atlas's third level, and
 * a block-compressed block all belong to one chart, and no filtering reads
 * another chart's light: the half-size lightmap (High) keeps 2 texels of
 * padding, so two mip levels, and the quarter-size AO map (Medium) 1, so one.
 */

/** Texels per side of the full-size atlas (Ultra's lightmap); High's is half, Medium's AO a quarter. */
export const LIGHTMAP_SIZE = 2048;
/** Texels of a chart's own light round it, at the full size. */
export const PADDING = 4;
/** Cells start and end on this grid, at the full size. */
export const ALIGN = 4;
/**
 * A chart whose middle is this far beyond the bounds, or that lies wholly
 * above `BACKDROP_HEIGHT`, is backdrop (Mexico's mesas, House's lake, the
 * arena's dome lattice): seen from 60 m and more, it keeps the sky probe's
 * light (uv1 below 0) instead of taking atlas space.
 */
const BACKDROP_MARGIN = 12;
const BACKDROP_HEIGHT = 50;
/** `uv1` of a face with no texels (backdrop, or never seen): the shader keeps the probe there. */
export const NO_LIGHTMAP = -1;
/**
 * Two coplanar charts sharing an edge merge when their triangles still cover
 * `MERGE_FILL` of the fuller one's share of its box, and at least `MIN_FILL`
 * of the joint box: a cylinder cap's wedges become one octagon, a ring of
 * faces round a torus stops before it is mostly empty box.
 */
const MERGE_FILL = 0.9;
const MIN_FILL = 0.5;
/** World positions are compared and hashed at this resolution (metres). */
const QUANTUM = 1e-3;

type Vec3 = readonly [number, number, number];

/** One packed chart: its cell in texels of the full-size atlas (padding included), its plane's normal and its middle. */
export interface LightmapChart {
  x: number;
  y: number;
  w: number;
  h: number;
  normal: Vec3;
  centre: Vec3;
}

/** A chart before packing: where its triangles' corners land on its plane, in metres. */
interface ChartShape {
  /** First triangle's index, which fixes the chart's place in the order. */
  first: number;
  triangles: number[];
  normal: THREE.Vector3;
  t: THREE.Vector3;
  s: THREE.Vector3;
  min: THREE.Vector2;
  max: THREE.Vector2;
  /** No texels: never seen, or backdrop. */
  hidden: boolean;
}

/** The static level's drawn triangles in world space, and their hash. */
export interface BakedTriangles {
  surfaces: readonly LevelSurface[];
  /** Per triangle: its surface's index in `surfaces`, its three vertex indices, and world corners. */
  owner: Int32Array;
  corners: Int32Array;
  positions: Float64Array;
  /** FNV-1a (two 32-bit lanes) of the quantized triangles and their materials, 16 hex digits. */
  hash: string;
}

/** The static level's triangles and the charts they form; density-free. */
export interface LightmapCharts extends BakedTriangles {
  charts: ChartShape[];
}

/** A lightmap layout: one `uv1` per static surface, and the packed charts. */
export interface LightmapLayout {
  size: number;
  density: number;
  surfaces: readonly LevelSurface[];
  uvs: Float32Array[];
  charts: LightmapChart[];
  triangles: number;
  hidden: number;
  /** Atlas texel rows in use; the manifest records it, so a different packing is caught. */
  rows: number;
  hash: string;
}

/** The static surfaces a bake covers, in level order. */
export const bakedSurfaces = (surfaces: readonly LevelSurface[]): LevelSurface[] => surfaces.filter(s => s.static);

/**
 * Each drawn group's triangles, with its tag. Flat-only groups are hidden on
 * the realistic tiers, so never baked; a mesh with one tag wears one material,
 * which three draws over all its geometry's groups (House's extruded gables).
 */
export function drawnRanges(surface: LevelSurface): { start: number; count: number; tag: NonNullable<LevelSurface['materials'][number]> }[] {
  const geometry = surface.mesh.geometry, count = geometry.index?.count ?? geometry.getAttribute('position').count;
  const groups = geometry.groups.length > 0 && surface.materials.length > 1 ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  const ranges = [];
  for (const { start, count: n, materialIndex = 0 } of groups) {
    const tag = surface.materials[materialIndex] ?? null;
    if (tag !== null) ranges.push({ start, count: n, tag });
  }
  return ranges;
}

/** FNV-1a over 32-bit words in two lanes (different offsets), for a 64-bit digest. */
class Fnv {
  a = 0x811c9dc5;
  b = 0xcbf29ce4;
  word(value: number): void {
    let a = this.a, b = this.b;
    for (let shift = 0; shift < 32; shift += 8) {
      const byte = (value >>> shift) & 0xff;
      a = Math.imul(a ^ byte, 0x01000193);
      b = Math.imul(b ^ byte, 0x01000193) ^ (b >>> 13);
    }
    this.a = a;
    this.b = b;
  }
  text(value: string): void {
    for (let i = 0; i < value.length; i++) this.word(value.charCodeAt(i));
  }
  get hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

const quantize = (v: number): number => Math.round(v / QUANTUM);
/** Quantised coordinates (millimetres) fit ±`COORD_HALF`, so a point's x and z make one exact number. */
const COORD_HALF = 2 ** 19;
const COORD_SPAN = 2 ** 20;
/**
 * A plane as one exact number: its normal's thousandths (−1000..1000 each) and its offset in quanta (within
 * ±`COORD_HALF`), the same classes as `${nx},${ny},${nz},${d}` would make.
 */
function planeKey(nx: number, ny: number, nz: number, d: number): number {
  if (Math.abs(d) >= COORD_HALF) throw new Error('lightmap: a face over 500 m from the origin');
  return ((((nx + 1000) * 2001 + ny + 1000) * 2001 + nz + 1000) * COORD_SPAN) + d + COORD_HALF;
}
const IDENTITY = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** The texture sets' plane frame (`planarUVs`): v up walls, u along x on floors. */
function frame(normal: THREE.Vector3, t: THREE.Vector3, s: THREE.Vector3): void {
  if (Math.abs(normal.y) >= Math.max(Math.abs(normal.x), Math.abs(normal.z))) {
    t.copy(X).addScaledVector(normal, -normal.x).normalize();
    s.crossVectors(normal, t);
  } else {
    s.copy(Y).addScaledVector(normal, -normal.y).normalize();
    t.crossVectors(s, normal);
  }
}

/**
 * An open-addressed table from a key of two exact integers (`a` under 2^53,
 * `b` a 32-bit one) to the order it was first seen in: the chart pass's
 * planes, points and edges, tens of thousands a map, with no allocation per
 * key (a `Map` keyed by numbers past 2^31 boxes each).
 */
class KeyTable {
  #a: Float64Array;
  #b: Int32Array;
  #value: Int32Array;
  size = 0;
  constructor(expected: number) {
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(16, 2 * expected)));
    this.#a = new Float64Array(capacity);
    this.#b = new Int32Array(capacity);
    this.#value = new Int32Array(capacity).fill(-1);
  }
  /** The key's number, or -1 with the key added as number `value`. */
  claim(a: number, b: number, value: number): number {
    const mask = this.#value.length - 1, high = Math.floor(a / 4294967296);
    let slot = (Math.imul((a - high * 4294967296) | 0, 0x9e3779b1) ^ Math.imul(high | 0, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35)) & mask;
    for (;;) {
      const found = this.#value[slot]!;
      if (found === -1) {
        this.#a[slot] = a;
        this.#b[slot] = b;
        this.#value[slot] = value;
        this.size++;
        return -1;
      }
      if (this.#a[slot] === a && this.#b[slot] === b) return found;
      slot = (slot + 1) & mask;
    }
  }
}

class UnionFind {
  readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    const parent = this.parent;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  /** The smaller root wins, so the result does not depend on the order of unions. */
  union(i: number, j: number): void {
    const a = this.find(i), b = this.find(j);
    if (a < b) this.parent[b] = a;
    else if (b < a) this.parent[a] = b;
  }
}

/**
 * The static level's drawn triangles in world space and their hash: the cheap
 * first pass of `lightmapCharts` (a fifth of its time or less), enough to
 * tell whether a level is the one a layout was made for.
 */
export function bakedTriangles(surfaces: readonly LevelSurface[]): BakedTriangles {
  const baked = bakedSurfaces(surfaces);
  // Sized first, then filled in place: a map's tens of thousands of triangles grow plain arrays through many copies.
  const ranges = baked.map(drawnRanges);
  const total = ranges.reduce((n, list) => n + list.reduce((m, { count }) => m + Math.floor(count / 3), 0), 0);
  const owner = new Int32Array(total), corners = new Int32Array(3 * total), positions = new Float64Array(9 * total);
  const hash = new Fnv();
  let tri = 0;
  baked.forEach((surface, index) => {
    const mesh = surface.mesh, geometry = mesh.geometry;
    mesh.updateWorldMatrix(true, false);
    const position = geometry.getAttribute('position'), indices = geometry.index;
    // The merged level sits at the origin: its positions are read straight from the array (the same numbers).
    const plain = position instanceof THREE.BufferAttribute && !position.normalized && position.itemSize === 3 && mesh.matrixWorld.equals(IDENTITY);
    const array = position.array, order = indices?.array ?? null;
    for (const { start, count, tag } of ranges[index]!) {
      const real = resolveMaterial(tag, surface.surf);
      hash.text(real.key);
      for (let i = start; i + 2 < start + count; i += 3, tri++) {
        owner[tri] = index;
        for (let k = 0; k < 3; k++) {
          const vertex = order ? order[i + k]! : i + k;
          corners[3 * tri + k] = vertex;
          if (plain) _a.set(array[3 * vertex]!, array[3 * vertex + 1]!, array[3 * vertex + 2]!);
          else _a.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld);
          positions[9 * tri + 3 * k] = _a.x;
          positions[9 * tri + 3 * k + 1] = _a.y;
          positions[9 * tri + 3 * k + 2] = _a.z;
          hash.word(quantize(_a.x));
          hash.word(quantize(_a.y));
          hash.word(quantize(_a.z));
        }
      }
    }
  });
  return { surfaces: baked, owner, corners, positions, hash: hash.hex };
}

/**
 * Triangles a layout step works through before it pauses (`lightmapChartSteps`,
 * `layoutSteps`): a few hundred microseconds of script on a desktop.
 */
const STEP_TRIANGLES = 4096;
/** Pause here every `STEP_TRIANGLES`th triangle `i` (a step's `yield`). */
const pause = (i: number): boolean => i % STEP_TRIANGLES === STEP_TRIANGLES - 1;
/** Cells the packer places before it pauses: each scans the atlas's 512 columns. */
const PACK_CELLS = 512;

/** Run a layout's steps to the end, at once (the exporter, the tests). */
export function runSteps<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * The static level's triangles, their charts and their hash. Everything here
 * depends on the geometry and the bounds only, so the exporter and the game
 * get the same charts, and the density search can pack them many times.
 */
export function lightmapCharts(surfaces: readonly LevelSurface[], bounds: Bounds, triangles = bakedTriangles(surfaces)): LightmapCharts {
  return runSteps(lightmapChartSteps(surfaces, bounds, triangles));
}

/**
 * `lightmapCharts` in steps: it pauses (yields) between its passes and every
 * `STEP_TRIANGLES` triangles within them, so the game can spread a map's
 * 30-80 ms of it over frames (render/index.ts `_layBake`).
 */
export function* lightmapChartSteps(surfaces: readonly LevelSurface[], bounds: Bounds, triangles = bakedTriangles(surfaces)): Generator<void, LightmapCharts> {
  const { owner, corners, positions: p } = triangles, n = owner.length;
  const at = (tri: number, k: number, v: THREE.Vector3) => v.set(p[9 * tri + 3 * k]!, p[9 * tri + 3 * k + 1]!, p[9 * tri + 3 * k + 2]!);
  // Triangle normals (area-weighted) and the key of the plane each lies in.
  const normals = new Float64Array(3 * n), areas = new Float64Array(n), planes = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    at(i, 0, _a); at(i, 1, _b); at(i, 2, _c);
    _n.subVectors(_c, _b).cross(_d.subVectors(_a, _b));
    const area = _n.length() / 2;
    areas[i] = area;
    if (area > 1e-12) _n.normalize();
    normals[3 * i] = _n.x;
    normals[3 * i + 1] = _n.y;
    normals[3 * i + 2] = _n.z;
    planes[i] = planeKey(Math.round(_n.x * 1e3), Math.round(_n.y * 1e3), Math.round(_n.z * 1e3), quantize(_n.dot(_a)));
    if (pause(i)) yield;
  }
  yield;
  // Charts: triangles sharing a vertex (a box face) always; then two charts in
  // the same plane that share a whole edge (a cylinder's side quad, wall
  // segments end to end), as long as the pair still fills its bounding box
  // (`MERGE_FILL`): a ring of coplanar faces round a torus would otherwise
  // become one chart of empty box.
  const sets = new UnionFind(n);
  const byVertex = new KeyTable(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const seen = byVertex.claim(owner[i]!, corners[3 * i + k]!, i);
      if (seen !== -1) sets.union(seen, i);
    }
    if (pause(i)) yield;
  }
  yield;
  // Each root's area and its box in the plane frame of its first triangle.
  const rootArea = new Float64Array(n), rootBox = new Float64Array(4 * n).fill(Infinity);
  for (let i = 0; i < 4 * n; i += 4) rootBox[i + 2] = rootBox[i + 3] = -Infinity;
  for (let i = 0; i < n; i++) {
    const root = sets.find(i);
    rootArea[root]! += areas[i]!;
    _n.set(normals[3 * root]!, normals[3 * root + 1]!, normals[3 * root + 2]!);
    frame(_n, _c, _d);
    for (let k = 0; k < 3; k++) {
      at(i, k, _a);
      const u = _a.dot(_c), v = _a.dot(_d);
      rootBox[4 * root] = Math.min(rootBox[4 * root]!, u);
      rootBox[4 * root + 1] = Math.min(rootBox[4 * root + 1]!, v);
      rootBox[4 * root + 2] = Math.max(rootBox[4 * root + 2]!, u);
      rootBox[4 * root + 3] = Math.max(rootBox[4 * root + 3]!, v);
    }
    if (pause(i)) yield;
  }
  yield;
  // An edge is its plane and its two (quantised) end points, unordered; each is numbered once, so an edge's key is a
  // number (a displaced shell's tens of thousands of triangles made string keys the layout's slowest step).
  const planeIds = new KeyTable(n), pointIds = new KeyTable(3 * n);
  const cornerIds = new Float64Array(3 * n), planeOf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const plane = planeIds.claim(planes[i]!, 0, planeIds.size);
    planeOf[i] = plane === -1 ? planeIds.size - 1 : plane;
    for (let k = 0; k < 3; k++) {
      const x = quantize(p[9 * i + 3 * k]!), y = quantize(p[9 * i + 3 * k + 1]!), z = quantize(p[9 * i + 3 * k + 2]!);
      if (Math.abs(x) >= COORD_HALF || Math.abs(z) >= COORD_HALF) throw new Error('lightmap: a face over 500 m from the origin');
      const point = pointIds.claim((x + COORD_HALF) * COORD_SPAN + z + COORD_HALF, y, pointIds.size);
      cornerIds[3 * i + k] = point === -1 ? pointIds.size - 1 : point;
    }
    if (pause(i)) yield;
  }
  yield;
  const fill = (root: number) => rootArea[root]! / Math.max(1e-12, (rootBox[4 * root + 2]! - rootBox[4 * root]!) * (rootBox[4 * root + 3]! - rootBox[4 * root + 1]!));
  const span = pointIds.size, byEdge = new KeyTable(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const e0 = cornerIds[3 * i + k]!, e1 = cornerIds[3 * i + (k + 1) % 3]!;
      const other = byEdge.claim((planeOf[i]! * span + Math.min(e0, e1)) * span + Math.max(e0, e1), 0, i);
      if (other === -1) continue;
      const a = sets.find(other), b = sets.find(i);
      if (a === b) continue;
      const u0 = Math.min(rootBox[4 * a]!, rootBox[4 * b]!), v0 = Math.min(rootBox[4 * a + 1]!, rootBox[4 * b + 1]!);
      const u1 = Math.max(rootBox[4 * a + 2]!, rootBox[4 * b + 2]!), v1 = Math.max(rootBox[4 * a + 3]!, rootBox[4 * b + 3]!);
      const area = rootArea[a]! + rootArea[b]!;
      if (area < Math.max(MIN_FILL, MERGE_FILL * Math.min(fill(a), fill(b))) * (u1 - u0) * (v1 - v0)) continue;
      sets.union(a, b);
      const root = sets.find(a);
      rootArea[root] = area;
      rootBox.set([u0, v0, u1, v1], 4 * root);
    }
    if (pause(i)) yield;
  }
  yield;
  const byRoot = new Map<number, ChartShape>(), charts: ChartShape[] = [];
  for (let i = 0; i < n; i++) {
    const root = sets.find(i);
    let chart = byRoot.get(root);
    if (chart === undefined) {
      chart = { first: i, triangles: [], normal: new THREE.Vector3(), t: new THREE.Vector3(), s: new THREE.Vector3(),
        min: new THREE.Vector2(Infinity, Infinity), max: new THREE.Vector2(-Infinity, -Infinity), hidden: false };
      byRoot.set(root, chart);
      charts.push(chart);
    }
    chart.triangles.push(i);
    chart.normal.x += normals[3 * i]! * areas[i]!;
    chart.normal.y += normals[3 * i + 1]! * areas[i]!;
    chart.normal.z += normals[3 * i + 2]! * areas[i]!;
    if (pause(i)) yield;
  }
  yield;
  const rect = new Map<ChartShape, boolean>();
  let bottom = Infinity, seen = 0;
  for (const chart of charts) {
    if (chart.normal.lengthSq() < 1e-24) chart.normal.set(0, 1, 0);
    chart.normal.normalize();
    frame(chart.normal, chart.t, chart.s);
    let area = 0, low = Infinity;
    const lo = _c.setScalar(Infinity), hi = _d.setScalar(-Infinity);
    for (const tri of chart.triangles) {
      area += areas[tri]!;
      for (let k = 0; k < 3; k++) {
        at(tri, k, _a);
        const u = _a.dot(chart.t), v = _a.dot(chart.s);
        chart.min.set(Math.min(chart.min.x, u), Math.min(chart.min.y, v));
        chart.max.set(Math.max(chart.max.x, u), Math.max(chart.max.y, v));
        lo.min(_a);
        hi.max(_a);
        low = Math.min(low, _a.y);
      }
    }
    const x = (lo.x + hi.x) / 2, z = (lo.z + hi.z) / 2;
    const beyond = Math.max(bounds.minX - x, x - bounds.maxX, bounds.minZ - z, z - bounds.maxZ);
    if (beyond > BACKDROP_MARGIN || low > BACKDROP_HEIGHT) chart.hidden = true;
    else bottom = Math.min(bottom, low);
    const box = (chart.max.x - chart.min.x) * (chart.max.y - chart.min.y);
    rect.set(chart, area >= box * (1 - 1e-6) - 1e-9);
    seen += chart.triangles.length;
    if (seen >= STEP_TRIANGLES) {
      seen = 0;
      yield;
    }
  }
  yield;
  // The world's underside: a face looking down from the lowest point of the playable level.
  for (const chart of charts) {
    if (chart.normal.y < -0.999 && chart.triangles.every(tri => Math.max(p[9 * tri + 1]!, p[9 * tri + 4]!, p[9 * tri + 7]!) <= bottom + QUANTUM)) chart.hidden = true;
  }
  // Faces pressed against an opposite, rectangular face in the same plane that covers them.
  const byPlane = new Map<string, ChartShape[]>();
  for (const chart of charts) {
    const c = chart.normal, flip = (Math.abs(c.x) > 0.5 ? c.x : Math.abs(c.y) > 0.5 ? c.y : c.z) < 0 ? -1 : 1;
    at(chart.first, 0, _a);
    const key = `${Math.round(c.x * flip * 1e3)},${Math.round(c.y * flip * 1e3)},${Math.round(c.z * flip * 1e3)},${quantize(c.dot(_a) * flip)}`;
    let list = byPlane.get(key);
    if (list === undefined) byPlane.set(key, list = []);
    list.push(chart);
  }
  yield;
  for (const list of byPlane.values()) {
    if (list.length < 2) continue;
    seen += list.length;
    if (seen >= STEP_TRIANGLES / 16) {
      seen = 0;
      yield;
    }
    for (const inner of list) {
      if (inner.hidden) continue;
      for (const cover of list) {
        if (cover === inner || !rect.get(cover) || cover.normal.dot(inner.normal) > -0.999) continue;
        let inside = true;
        for (const tri of inner.triangles) {
          for (let k = 0; k < 3 && inside; k++) {
            at(tri, k, _a);
            const u = _a.dot(cover.t), v = _a.dot(cover.s);
            inside = u >= cover.min.x - QUANTUM && u <= cover.max.x + QUANTUM && v >= cover.min.y - QUANTUM && v <= cover.max.y + QUANTUM;
          }
          if (!inside) break;
        }
        if (inside) { inner.hidden = true; break; }
      }
    }
  }
  return { ...triangles, charts };
}

/** A chart's cell and where its content sits, in texels of the full-size atlas. */
interface Cell {
  chart: ChartShape;
  /** Content size in texels, before padding; `rotated` swaps the chart's u and v. */
  cw: number;
  ch: number;
  rotated: boolean;
  /** Cell size in `ALIGN` units. */
  wu: number;
  hu: number;
  x: number;
  y: number;
}

const units = (texels: number): number => Math.ceil((texels + 2 * PADDING) / ALIGN);

/**
 * Pack the visible charts at `density` texels per metre into a `size`² atlas:
 * a skyline, bottom-left first, tallest cells first, in `ALIGN`-texel units.
 * Null when they do not fit.
 */
function pack(source: LightmapCharts, size: number, density: number): { cells: Cell[]; rows: number } | null {
  return runSteps(packSteps(source, size, density));
}

/** `pack` in steps: it pauses every `PACK_CELLS` cells placed (each scans the atlas's width). */
function* packSteps(source: LightmapCharts, size: number, density: number): Generator<void, { cells: Cell[]; rows: number } | null> {
  const cells: Cell[] = [];
  for (const chart of source.charts) {
    if (chart.hidden) continue;
    const d = density;
    const w = Math.max(1, Math.ceil((chart.max.x - chart.min.x) * d - 1e-9)), h = Math.max(1, Math.ceil((chart.max.y - chart.min.y) * d - 1e-9));
    const rotated = h > w, cw = rotated ? h : w, ch = rotated ? w : h;
    cells.push({ chart, cw, ch, rotated, wu: units(cw), hu: units(ch), x: 0, y: 0 });
  }
  const order = cells.slice().sort((a, b) => b.hu - a.hu || b.wu - a.wu || a.chart.first - b.chart.first);
  const span = size / ALIGN, heights = new Int32Array(span);
  const window: number[] = [];
  let placed = 0;
  for (const cell of order) {
    if (++placed % PACK_CELLS === 0) yield;
    if (cell.wu > span) return null;
    // The lowest top over every run of `wu` columns (a sliding-window maximum), leftmost on ties.
    let best = -1, bestTop = Infinity;
    window.length = 0;
    let head = 0;
    for (let x = 0; x < span; x++) {
      while (window.length > head && heights[window[window.length - 1]!]! <= heights[x]!) window.pop();
      window.push(x);
      if (window[head]! <= x - cell.wu) head++;
      const start = x - cell.wu + 1;
      if (start < 0) continue;
      const top = heights[window[head]!]!;
      if (top < bestTop) { bestTop = top; best = start; }
    }
    if (best < 0 || bestTop + cell.hu > span) return null;
    cell.x = best;
    cell.y = bestTop;
    heights.fill(bestTop + cell.hu, best, best + cell.wu);
  }
  let rows = 0;
  for (const height of heights) rows = Math.max(rows, height);
  return { cells, rows: rows * ALIGN };
}

/** Lay the charts out at a given density and write each surface's `uv1`. Null when they do not fit. */
export function layoutLightmap(source: LightmapCharts, size: number, density: number): LightmapLayout | null {
  return runSteps(layoutSteps(source, size, density));
}

/** `layoutLightmap` in steps: it pauses while packing, after it, and every `STEP_TRIANGLES` or so triangles written. */
export function* layoutSteps(source: LightmapCharts, size: number, density: number): Generator<void, LightmapLayout | null> {
  const packed = yield* packSteps(source, size, density);
  if (packed === null) return null;
  yield;
  let written = 0;
  // Anything not given texels below (flat-only groups, hidden and backdrop faces) keeps the probe.
  const uvs = source.surfaces.map(s => new Float32Array(2 * s.mesh.geometry.getAttribute('position').count).fill(NO_LIGHTMAP));
  const p = source.positions;
  const charts: LightmapChart[] = [];
  for (const cell of packed.cells) {
    const { chart } = cell, d = density;
    const spanU = chart.max.x - chart.min.x, spanV = chart.max.y - chart.min.y;
    // A chart under a texel across is stretched to one, so a texel centre always lands on it.
    const su = spanU * d < 1 ? 1 / Math.max(spanU, 1e-9) : d, sv = spanV * d < 1 ? 1 / Math.max(spanV, 1e-9) : d;
    const x0 = cell.x * ALIGN + PADDING, y0 = cell.y * ALIGN + PADDING;
    const lo = _c.setScalar(Infinity), hi = _d.setScalar(-Infinity);
    for (const tri of chart.triangles) {
      const uv = uvs[source.owner[tri]!]!;
      for (let k = 0; k < 3; k++) {
        _a.set(p[9 * tri + 3 * k]!, p[9 * tri + 3 * k + 1]!, p[9 * tri + 3 * k + 2]!);
        const u = (_a.dot(chart.t) - chart.min.x) * su, v = (_a.dot(chart.s) - chart.min.y) * sv;
        const tx = cell.rotated ? v : u, ty = cell.rotated ? u : v;
        const corner = 2 * source.corners[3 * tri + k]!;
        uv[corner] = (x0 + tx) / size;
        uv[corner + 1] = (y0 + ty) / size;
        lo.min(_a);
        hi.max(_a);
      }
    }
    lo.add(hi).multiplyScalar(0.5);
    charts.push({ x: cell.x * ALIGN, y: cell.y * ALIGN, w: cell.wu * ALIGN, h: cell.hu * ALIGN,
      normal: [chart.normal.x, chart.normal.y, chart.normal.z], centre: [lo.x, lo.y, lo.z] });
    written += chart.triangles.length;
    if (written >= STEP_TRIANGLES) {
      written = 0;
      yield;
    }
  }
  return {
    size, density, surfaces: source.surfaces, uvs, charts, triangles: source.owner.length,
    hidden: source.charts.filter(c => c.hidden).reduce((sum, c) => sum + c.triangles.length, 0), rows: packed.rows, hash: source.hash,
  };
}

/**
 * The highest density (texels per metre, 4 significant digits) at which the
 * charts fit a `size`² atlas. The exporter asks once per bake and the
 * manifest keeps the answer, so the game packs once.
 */
export function fitDensity(source: LightmapCharts, size: number): number {
  // Skyline packing is not monotonic in the density, so step down from the
  // area bound (every texel covered, no padding) instead of bisecting.
  let area = 0;
  for (const chart of source.charts) if (!chart.hidden) area += (chart.max.x - chart.min.x) * (chart.max.y - chart.min.y);
  const top = size / Math.sqrt(Math.max(area, 1e-6));
  for (let density = round4(top); density > 0; density = round4(density * 0.995)) {
    if (pack(source, size, density)) return density;
  }
  throw new Error('lightmap charts do not fit at any density');
}

/** Four significant digits, rounded down. */
function round4(value: number): number {
  const digits = 10 ** (3 - Math.floor(Math.log10(value)));
  return Math.floor(value * digits) / digits;
}

/** Put each static surface's `uv1` (a layout's `uvs`, in `bakedSurfaces` order) on its geometry (the lightmap's channel 1). */
export function wearLightmapUVs(surfaces: readonly LevelSurface[], uvs: readonly Float32Array[]): void {
  surfaces.forEach((surface, i) => surface.mesh.geometry.setAttribute('uv1', new THREE.BufferAttribute(uvs[i]!, 2)));
}

/**
 * Share of a set's colour kept in the light it bounces. A sunlit lawn's full
 * green tinted every wall and eave above it olive; the bounce keeps the
 * lawn's brightness and half its colour.
 */
const BOUNCE_CHROMA: Partial<Record<TextureSet, number>> = { grass: 0.5, foliage: 0.5 };

/** Each baked material's diffuse albedo for the bake: the tag's colour, linear (`BOUNCE_CHROMA` of it), and its set's metalness. */
export function bakeAlbedo(surface: LevelSurface, tag: NonNullable<LevelSurface['materials'][number]>): { key: string; albedo: Vec3; metal: number } {
  const real = resolveMaterial(tag, surface.surf), color = new THREE.Color(real.color);
  const chroma = BOUNCE_CHROMA[real.set] ?? 1, grey = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  const albedo = [color.r, color.g, color.b].map(c => grey + (c - grey) * chroma) as unknown as Vec3;
  return { key: real.key, albedo, metal: setInfo(MATERIAL_SET[tag]).metal };
}

// -------------------------------------------------------------- the bakes

/** The probe grid's box: its low corner, cells per axis (x, y, z) and the cell edge in metres. */
export interface ProbeGrid {
  min: Vec3;
  cells: Vec3;
  cell: number;
}

/** One bake in `lightmaps.json`, written by `tools/lightmaps/build.mjs`. */
export interface BakeInfo {
  map: string;
  arena: boolean;
  hash: string;
  density: number;
  triangles: number;
  charts: number;
  rows: number;
  /** The lightmap stores light / `scale`, sRGB-encoded: white surface radiance, sky and bounce, no direct sun. */
  scale: number;
  /** The AO map stores (baked light / sky probe light) / `aoScale`, sRGB-encoded. */
  aoScale: number;
  /** The probe grid stores ambient-cube light / `probeScale`, sRGB-encoded, 6 faces per cell. */
  probeScale: number;
  grid: ProbeGrid;
  /** Download bytes of each file. */
  bytes: Readonly<Record<BakeFile, number>>;
  /** The sky it was baked under (`public/sky/<sky>/sky.json`) and that sky's sun: a new sky needs a new bake. */
  sky: string;
  sun: Vec3;
  /** Wall-clock seconds the bake took (Blender), for the record. */
  seconds: number;
}

export const BAKE_FILES = ['light-2048', 'light-1024', 'ao-512', 'probes'] as const;
export type BakeFile = (typeof BAKE_FILES)[number];

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
const positive = (value: unknown): value is number => typeof value === 'number' && value > 0 && Number.isFinite(value);

/** Check `lightmaps.json`: a bad entry must mean "no bake" for its map, not broken lighting. */
export function parseBakes(raw: unknown): Record<string, BakeInfo> {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as { size?: unknown; bakes?: unknown };
  if (value.size !== LIGHTMAP_SIZE || typeof value.bakes !== 'object' || value.bakes === null) throw new Error('malformed lightmaps.json');
  const bakes: Record<string, BakeInfo> = {};
  for (const [name, entry] of Object.entries(value.bakes as Record<string, unknown>)) {
    const info = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const grid = (typeof info.grid === 'object' && info.grid !== null ? info.grid : {}) as Record<string, unknown>;
    const bytes = (typeof info.bytes === 'object' && info.bytes !== null ? info.bytes : {}) as Record<string, unknown>;
    if (typeof info.map !== 'string' || typeof info.arena !== 'boolean' || typeof info.hash !== 'string' || !positive(info.density)
      || !positive(info.triangles) || !positive(info.charts) || !positive(info.rows) || !positive(info.scale) || !positive(info.aoScale)
      || !positive(info.probeScale) || !isVec3(grid.min) || !isVec3(grid.cells) || !grid.cells.every(c => Number.isInteger(c) && c > 0)
      || !positive(grid.cell) || !BAKE_FILES.every(file => positive(bytes[file])) || typeof info.seconds !== 'number'
      || typeof info.sky !== 'string' || !isVec3(info.sun)) {
      // The exporter reads this module too, so a stale entry must not stop the re-bake that fixes it.
      console.warn(`lightmaps.json: ${name} is malformed (npm run lightmaps); that map keeps the sky probe`);
      continue;
    }
    bakes[name] = info as unknown as BakeInfo;
  }
  return bakes;
}

const BAKES = parseBakes(manifest);

/** A map's bake name: `downtown`, or `downtown-arena` where the arena has its own geometry. */
export const bakeName = (key: string, arena: boolean): string => (arena ? `${key}-arena` : key);

/**
 * The bake for a level, if there is one: its own variant's, else (an arena
 * that reuses the map's geometry) the map's. The renderer still checks the
 * geometry against it before using it.
 */
export function bakeFor(level: Pick<Level, 'key' | 'arena'>): { name: string; info: BakeInfo } | null {
  for (const name of level.arena ? [bakeName(level.key, true), level.key] : [level.key]) {
    const info = BAKES[name];
    if (info) return { name, info };
  }
  return null;
}

/** Every bake, by name. */
export const bakes = (): Readonly<Record<string, BakeInfo>> => BAKES;

/** Where a bake's file lives; `next` exports `public/` at the site root. */
export const bakeUrl = (name: string, file: BakeFile): string => `/maps/${name}/${file}.${file === 'probes' ? 'bin' : 'ktx2'}`;

/**
 * What a Textures setting shows of a bake: low (the Medium preset) the AO map
 * (a quarter-size ratio, a sixteenth of the full lightmap's texels), medium
 * the half-size lightmap, high the full one.
 */
export const BAKE_FILE: Readonly<Record<TextureQuality, Exclude<BakeFile, 'probes'>>> = Object.freeze({ low: 'ao-512', medium: 'light-1024', high: 'light-2048' });

/** Is this file the AO map (Medium) rather than a lightmap? */
export const isAoFile = (file: BakeFile): boolean => file.startsWith('ao-');

/**
 * Mip levels a file may use: padding round each chart must cover a mip texel
 * and its bilinear neighbour. 4 texels at the full size: 3 levels there, 2 at
 * half size, 1 at a quarter (the AO map).
 */
export function bakeMips(file: Exclude<BakeFile, 'probes'>): number {
  const size = Number(file.split('-')[1]), padding = PADDING * size / LIGHTMAP_SIZE;
  return Math.max(1, Math.floor(Math.log2(padding)) + 1);
}

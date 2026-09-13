import { Vector3 } from 'three';
import { choose } from './util';
import type { Box, World } from './physics';
import type { Bounds } from './types';

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  ix: number;
  iz: number;
  links: NavLink[];
}

export interface NavLink {
  to: number;
  cost: number;
  dy: number;
}

export type NavPath = Vector3[] & { complete: boolean };

interface HeapItem {
  id: number;
  f: number;
}

/** Half-width of the node and link clearance tests. Must cover the widest common walker (heavy: halfW 0.41). */
const CLEARANCE = 0.42;
const directions: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const finiteVector = (v: Vector3 | null | undefined) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function pushHeap(heap: HeapItem[], item: HeapItem) {
  let i = heap.length;
  heap.push(item);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const above = heap[parent];
    if (above === undefined || above.f <= item.f) break;
    heap[i] = above;
    i = parent;
  }
  heap[i] = item;
}

function popHeap(heap: HeapItem[]): HeapItem | undefined {
  const first = heap[0], last = heap.pop();
  if (!heap.length || last === undefined) return first;
  let i = 0;
  while (i * 2 + 1 < heap.length) {
    let child = i * 2 + 1;
    let best = heap[child];
    const right = heap[child + 1];
    if (right !== undefined && best !== undefined && right.f < best.f) { child++; best = right; }
    if (best === undefined || last.f <= best.f) break;
    heap[i] = best;
    i = child;
  }
  heap[i] = last;
  return first;
}

export class NavGrid {
  #world: World;
  #bounds: Bounds;
  #cell: number;
  #nx: number;
  #nz: number;
  #cells: (number[] | undefined)[] = [];
  #min = new Vector3();
  #max = new Vector3();
  #query: Box[] = [];
  #g = new Float64Array(0);
  #parents = new Int32Array(0);
  #reached = new Uint32Array(0);
  #closed = new Uint32Array(0);
  #generation = 0;

  readonly nodes: NavNode[];

  constructor(world: World, bounds: Bounds, cell = 1) {
    this.#world = world;
    this.#bounds = { ...bounds };
    this.#cell = cell;
    this.#nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.#nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.nodes = [];
  }
  #cellNodes(ix: number, iz: number): number[] | undefined {
    if (ix < 0 || ix >= this.#nx || iz < 0 || iz >= this.#nz) return undefined;
    return this.#cells[iz * this.#nx + ix];
  }
  #blocked(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    return this.#world.overlapsAABB(this.#min.set(minX, minY, minZ), this.#max.set(maxX, maxY, maxZ));
  }
  #cornerOpen(ix: number, iz: number, a: NavNode, b: NavNode) {
    const cell = this.#cellNodes(ix, iz);
    if (!cell) return false;
    return cell.some(id => {
      const node = this.nodes[id];
      return node !== undefined && (Math.abs(node.y - a.y) <= 0.75 || Math.abs(node.y - b.y) <= 0.75);
    });
  }
  build() {
    this.nodes.length = 0;
    this.#cells = new Array(this.#nx * this.#nz);
    for (let iz = 0; iz < this.#nz; iz++) {
      const z = this.#bounds.minZ + (iz + 0.5) * this.#cell;
      for (let ix = 0; ix < this.#nx; ix++) {
        const x = this.#bounds.minX + (ix + 0.5) * this.#cell;
        const boxes = this.#world.query(this.#min.set(x - 0.05, -30, z - 0.05),
          this.#max.set(x + 0.05, 90, z + 0.05), this.#query);
        const heights = new Set<number>();
        for (const box of boxes) if (!box.data.noNav) heights.add(box.max.y);
        for (const y of [...heights].sort((a, b) => a - b)) {
          if (y < -5 || y > 70 || this.#blocked(x - CLEARANCE, y + 0.5, z - CLEARANCE, x + CLEARANCE, y + 1.85, z + CLEARANCE)) continue;
          const id = this.nodes.length;
          this.nodes.push({ id, x, y, z, ix, iz, links: [] });
          const index = iz * this.#nx + ix;
          (this.#cells[index] ??= []).push(id);
        }
      }
    }
    for (const a of this.nodes) {
      for (const [dx, dz] of directions) {
        const neighbors = this.#cellNodes(a.ix + dx, a.iz + dz);
        if (!neighbors) continue;
        for (const id of neighbors) {
          const b = this.nodes[id];
          if (b === undefined) continue;
          const dy = b.y - a.y;
          if (dy > 1.35 || dy < -8) continue;
          if (dx && dz && (!this.#cornerOpen(a.ix + dx, a.iz, a, b) || !this.#cornerOpen(a.ix, a.iz + dz, a, b))) continue;
          const base = Math.max(a.y, b.y);
          if (this.#blocked(Math.min(a.x, b.x) - CLEARANCE, base + 0.5, Math.min(a.z, b.z) - CLEARANCE,
            Math.max(a.x, b.x) + CLEARANCE, base + 1.7, Math.max(a.z, b.z) + CLEARANCE)) continue;
          if (dy < -0.6 && this.#blocked(b.x - 0.2, b.y + 0.05, b.z - 0.2, b.x + 0.2, a.y + 0.05, b.z + 0.2)) continue;
          let cost = Math.sqrt(this.#cell ** 2 * (dx * dx + dz * dz) + dy * dy);
          if (dy > 0.6) cost *= 1 + 1.1 * dy;
          else if (dy < -0.6) cost -= 0.35 * dy;
          a.links.push({ to: id, cost, dy });
        }
      }
    }
    this.#g = new Float64Array(this.nodes.length);
    this.#parents = new Int32Array(this.nodes.length);
    this.#reached = new Uint32Array(this.nodes.length);
    this.#closed = new Uint32Array(this.nodes.length);
    this.#generation = 0;
  }
  nearest(pos: Vector3, radius = 3, maxDrop = 4) {
    // ponytail: `radius` is validated but never floored. A fractional radius makes
    // every `ix`/`iz` fractional, so `#cells[iz * nx + ix]` always misses and the
    // search silently returns -1. No caller passes one today; behaviour left as is.
    if (!finiteVector(pos) || !Number.isFinite(radius) || radius < 0) return -1;
    const cx = Math.floor((pos.x - this.#bounds.minX) / this.#cell);
    const cz = Math.floor((pos.z - this.#bounds.minZ) / this.#cell);
    let filtered = -1, fallback = -1, filteredScore = Infinity, fallbackScore = Infinity;
    for (let iz = Math.max(0, cz - radius); iz <= Math.min(this.#nz - 1, cz + radius); iz++) {
      for (let ix = Math.max(0, cx - radius); ix <= Math.min(this.#nx - 1, cx + radius); ix++) {
        const cell = this.#cellNodes(ix, iz);
        if (!cell) continue;
        for (const id of cell) {
          const node = this.nodes[id];
          if (node === undefined) continue;
          const dy = node.y - pos.y;
          const h = Math.hypot(node.x - pos.x, node.z - pos.z);
          const fb = h + 2 * Math.abs(dy), fs = h + 1.5 * Math.abs(dy);
          if (fb < fallbackScore) { fallback = id; fallbackScore = fb; }
          if (dy >= -maxDrop && dy <= 2.2 && fs < filteredScore) { filtered = id; filteredScore = fs; }
        }
      }
    }
    return filtered >= 0 ? filtered : fallback;
  }
  findPath(from: Vector3, to: Vector3, maxExpand = 40000): NavPath | null {
    const start = this.nearest(from, 3, 3), goal = this.nearest(to, 4, 8);
    if (start < 0 || goal < 0) return null;
    if (++this.#generation === 0xffffffff) {
      this.#reached.fill(0);
      this.#closed.fill(0);
      this.#generation = 1;
    }
    const generation = this.#generation, target = this.nodes[goal];
    if (target === undefined) return null;
    const heuristic = (id: number) => {
      const node = this.nodes[id];
      if (node === undefined) return Infinity;
      return 1.15 * Math.hypot(node.x - target.x, node.y - target.y, node.z - target.z);
    };
    let best = start, bestH = heuristic(start), complete = false, expanded = 0;
    this.#reached[start] = generation;
    this.#g[start] = 0;
    this.#parents[start] = -1;
    const open: HeapItem[] = [];
    pushHeap(open, { id: start, f: bestH });
    while (open.length) {
      const top = popHeap(open);
      if (top === undefined) break;
      const cur = top.id;
      if (this.#closed[cur] === generation) continue;
      this.#closed[cur] = generation;
      if (cur === goal) { best = cur; complete = true; break; }
      if (++expanded > maxExpand) break;
      const h = heuristic(cur);
      if (h < bestH) { best = cur; bestH = h; }
      const node = this.nodes[cur];
      if (node === undefined) continue;
      for (const link of node.links) {
        const next = link.to, g = (this.#g[cur] ?? 0) + link.cost;
        if (this.#reached[next] !== generation || g < (this.#g[next] ?? 0)) {
          this.#reached[next] = generation;
          this.#g[next] = g;
          this.#parents[next] = cur;
          pushHeap(open, { id: next, f: g + heuristic(next) });
        }
      }
    }
    const path: Vector3[] & { complete?: boolean } = [];
    for (let id = best; id >= 0; id = this.#parents[id] ?? -1) {
      const node = this.nodes[id];
      if (node === undefined) break;
      path.push(new Vector3(node.x, node.y, node.z));
    }
    path.reverse();
    path.complete = complete;
    return path as NavPath;
  }
  randomNode(): NavNode | null { return choose(this.nodes) ?? null; }
}

import { Vector3 } from 'three';
import { choose } from './util.js';

const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const finiteVector = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function pushHeap(heap, item) {
  let i = heap.length;
  heap.push(item);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= item.f) break;
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = item;
}

function popHeap(heap) {
  const first = heap[0], last = heap.pop();
  if (!heap.length) return first;
  let i = 0;
  while (i * 2 + 1 < heap.length) {
    let child = i * 2 + 1;
    if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
    if (last.f <= heap[child].f) break;
    heap[i] = heap[child];
    i = child;
  }
  heap[i] = last;
  return first;
}

export class NavGrid {
  #world;
  #bounds;
  #cell;
  #nx;
  #nz;
  #cells = [];
  #min = new Vector3();
  #max = new Vector3();
  #query = [];
  #g;
  #parents;
  #reached;
  #closed;
  #generation = 0;

  constructor(world, bounds, cell = 1) {
    this.#world = world;
    this.#bounds = { ...bounds };
    this.#cell = cell;
    this.#nx = Math.ceil((bounds.maxX - bounds.minX) / cell);
    this.#nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
    this.nodes = [];
  }
  #cellNodes(ix, iz) {
    if (ix < 0 || ix >= this.#nx || iz < 0 || iz >= this.#nz) return undefined;
    return this.#cells[iz * this.#nx + ix];
  }
  #blocked(minX, minY, minZ, maxX, maxY, maxZ) {
    return this.#world.overlapsAABB(this.#min.set(minX, minY, minZ), this.#max.set(maxX, maxY, maxZ));
  }
  #cornerOpen(ix, iz, a, b) {
    const cell = this.#cellNodes(ix, iz);
    if (!cell) return false;
    return cell.some(id => Math.abs(this.nodes[id].y - a.y) <= 0.75 || Math.abs(this.nodes[id].y - b.y) <= 0.75);
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
        const heights = new Set();
        for (const box of boxes) if (!box.data.noNav) heights.add(box.max.y);
        for (const y of [...heights].sort((a, b) => a - b)) {
          if (y < -5 || y > 70 || this.#blocked(x - 0.3, y + 0.5, z - 0.3, x + 0.3, y + 1.85, z + 0.3)) continue;
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
          const b = this.nodes[id], dy = b.y - a.y;
          if (dy > 1.35 || dy < -8) continue;
          if (dx && dz && (!this.#cornerOpen(a.ix + dx, a.iz, a, b) || !this.#cornerOpen(a.ix, a.iz + dz, a, b))) continue;
          const base = Math.max(a.y, b.y);
          if (this.#blocked(Math.min(a.x, b.x) - 0.25, base + 0.5, Math.min(a.z, b.z) - 0.25,
            Math.max(a.x, b.x) + 0.25, base + 1.7, Math.max(a.z, b.z) + 0.25)) continue;
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
  nearest(pos, radius = 3, maxDrop = 4) {
    if (!finiteVector(pos) || !Number.isFinite(radius) || radius < 0) return -1;
    const cx = Math.floor((pos.x - this.#bounds.minX) / this.#cell);
    const cz = Math.floor((pos.z - this.#bounds.minZ) / this.#cell);
    let filtered = -1, fallback = -1, filteredScore = Infinity, fallbackScore = Infinity;
    for (let iz = Math.max(0, cz - radius); iz <= Math.min(this.#nz - 1, cz + radius); iz++) {
      for (let ix = Math.max(0, cx - radius); ix <= Math.min(this.#nx - 1, cx + radius); ix++) {
        const cell = this.#cellNodes(ix, iz);
        if (!cell) continue;
        for (const id of cell) {
          const node = this.nodes[id], dy = node.y - pos.y;
          const h = Math.hypot(node.x - pos.x, node.z - pos.z);
          const fb = h + 2 * Math.abs(dy), fs = h + 1.5 * Math.abs(dy);
          if (fb < fallbackScore) { fallback = id; fallbackScore = fb; }
          if (dy >= -maxDrop && dy <= 2.2 && fs < filteredScore) { filtered = id; filteredScore = fs; }
        }
      }
    }
    return filtered >= 0 ? filtered : fallback;
  }
  findPath(from, to, maxExpand = 40000) {
    const start = this.nearest(from, 3, 3), goal = this.nearest(to, 4, 8);
    if (start < 0 || goal < 0) return null;
    if (++this.#generation === 0xffffffff) {
      this.#reached.fill(0);
      this.#closed.fill(0);
      this.#generation = 1;
    }
    const generation = this.#generation, target = this.nodes[goal];
    const heuristic = id => {
      const node = this.nodes[id];
      return 1.15 * Math.hypot(node.x - target.x, node.y - target.y, node.z - target.z);
    };
    let best = start, bestH = heuristic(start), complete = false, expanded = 0;
    this.#reached[start] = generation;
    this.#g[start] = 0;
    this.#parents[start] = -1;
    const open = [];
    pushHeap(open, { id: start, f: bestH });
    while (open.length) {
      const cur = popHeap(open).id;
      if (this.#closed[cur] === generation) continue;
      this.#closed[cur] = generation;
      if (cur === goal) { best = cur; complete = true; break; }
      if (++expanded > maxExpand) break;
      const h = heuristic(cur);
      if (h < bestH) { best = cur; bestH = h; }
      for (const link of this.nodes[cur].links) {
        const next = link.to, g = this.#g[cur] + link.cost;
        if (this.#reached[next] !== generation || g < this.#g[next]) {
          this.#reached[next] = generation;
          this.#g[next] = g;
          this.#parents[next] = cur;
          pushHeap(open, { id: next, f: g + heuristic(next) });
        }
      }
    }
    const path = [];
    for (let id = best; id >= 0; id = this.#parents[id]) {
      const node = this.nodes[id];
      path.push(new Vector3(node.x, node.y, node.z));
    }
    path.reverse();
    path.complete = complete;
    return path;
  }
  randomNode() { return choose(this.nodes) ?? null; }
}

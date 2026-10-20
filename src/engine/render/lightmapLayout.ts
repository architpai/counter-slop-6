import { LIGHTMAP_SIZE, layoutSteps, lightmapChartSteps, runSteps } from './lightmap';
import type { BakedTriangles, LightmapLayout } from './lightmap';
import type { Bounds, LevelSurface } from '../types';

/**
 * A bake's layout off the main thread (render/lightmapWorker.ts): the same
 * chart pass and packing (`bakeLayoutSteps`, render/lightmap.ts) on the same
 * triangles, so the same `uv1` to the bit. The renderer posts it on the
 * level's first realistic frame (`_checkBake`), so it runs while the match's
 * quiet start streams; `_layBake` takes the answer in its first slot, and
 * lays the charts out itself in steps meanwhile (the old path), with no
 * worker, or a worker that failed or is late. None of it draws `Math.random`.
 */

/** A bake's layout as steps: the chart pass, then packing and writing `uv1` (render/lightmap.ts). */
export function* bakeLayoutSteps(surfaces: readonly LevelSurface[], bounds: Bounds, triangles: BakedTriangles,
  density: number): Generator<void, LightmapLayout | null> {
  const charts = yield* lightmapChartSteps(surfaces, bounds, triangles);
  yield;
  return yield* layoutSteps(charts, LIGHTMAP_SIZE, density);
}

/** What the worker lays out: plain arrays and numbers (structured-cloned, so the main thread keeps its own). */
export interface LayoutRequest {
  job: number;
  owner: Int32Array;
  corners: Int32Array;
  positions: Float64Array;
  /** Each static surface's vertex count: its `uv1` length over 2. */
  counts: Int32Array;
  hash: string;
  bounds: Bounds;
  density: number;
}

/** What `_layBake` checks against the manifest and writes: one `uv1` per static surface, and the counts. */
export interface LaidOut {
  uvs: Float32Array[];
  charts: number;
  rows: number;
  triangles: number;
}

export interface LayoutReply {
  job: number;
  layout: LaidOut | null;
  /** Set when the worker threw: the renderer lays the charts out itself. */
  error?: string;
}

/** The parts of a layout `_layBake` reads, from either path. */
export const laidOut = (layout: LightmapLayout | null): LaidOut | null =>
  layout && { uvs: layout.uvs, charts: layout.charts.length, rows: layout.rows, triangles: layout.triangles };

export function layoutRequest(job: number, triangles: BakedTriangles, bounds: Bounds, density: number): LayoutRequest {
  const counts = Int32Array.from(triangles.surfaces, s => s.mesh.geometry.getAttribute('position').count);
  const { owner, corners, positions, hash } = triangles;
  return { job, owner, corners, positions, counts, hash, bounds: { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ }, density };
}

/**
 * The worker's whole job, at once: `bakeLayoutSteps` run to the end on the
 * request's triangles. The layout reads a surface only for its vertex count
 * (the length of its `uv1`), so each stands in as that.
 */
export function runLayoutRequest(request: LayoutRequest): LaidOut | null {
  const surfaces = Array.from(request.counts, count => ({ mesh: { geometry: { getAttribute: () => ({ count }) } } }) as unknown as LevelSurface);
  const triangles: BakedTriangles = { surfaces, owner: request.owner, corners: request.corners, positions: request.positions, hash: request.hash };
  return laidOut(runSteps(bakeLayoutSteps(surfaces, request.bounds, triangles, request.density)));
}

/** The reply's `uv1` buffers, moved to the main thread rather than copied. */
export const replyTransfer = (reply: LayoutReply): Transferable[] => reply.layout?.uvs.map(uv => uv.buffer) ?? [];

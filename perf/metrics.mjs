// What compare.mjs and noise.mjs read from a bench result (perf/results/*.json), and the noise file's thresholds.
//
// perf/noise.json (written by noise.mjs, hand-editable):
//   { "version": 1, "created": ISO date, "from": [result files], "minPct": 3,
//     "metrics": { "<metric>": { "rel": 0.05, "abs": 0.3 } },               // every cell (the widest cell's spread)
//     "cells":   { "<map>/<preset>/<scenario>": { "<metric>": { "rel": 0.04, "abs": 0.2 } } } }   // per cell, optional
// A change d from a baseline value a is beyond the noise when |d| > max(abs, rel * |a|). Lookup order: the cell's
// entry, then `metrics`, then DEFAULT (max(5 %, 0.3 ms); counts: max(0.5 %, 1); readyMs: max(15 %, 250 ms)).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT_NOISE = fileURLToPath(new URL('./noise.json', import.meta.url));

/**
 * Lower is better for every metric. `count` metrics are near-deterministic: the simulation repeats exactly, but on Low
 * one figure can be drawn or not for a few frames of a fight from run to run (+-0.5 % of the triangle median).
 */
export const METRICS = [
  { key: 'frameMs.med', label: 'frame med', get: s => s?.frameMs?.med },
  { key: 'frameMs.p95', label: 'frame p95', get: s => s?.frameMs?.p95 },
  // Medians move in 0.1 ms steps (Chrome coarsens timers without cross-origin isolation); the mean is finer.
  { key: 'frameMs.mean', label: 'frame mean', get: s => s?.frameMs?.mean },
  { key: 'cpuMs.med', label: 'cpu med', get: s => s?.cpuMs?.med },
  { key: 'jsMs.med', label: 'js med', get: s => s?.trace?.jsMs?.med },
  { key: 'gpuMs.med', label: 'gpu med', get: s => s?.gpuMs?.med },
  { key: 'calls.med', label: 'calls', get: s => s?.calls?.med, count: true },
  { key: 'triangles.med', label: 'tris', get: s => s?.triangles?.med, count: true },
];
export const LOAD_METRICS = [{ key: 'readyMs', label: 'readyMs', get: c => c?.load?.readyMs }];
export const SCENARIOS = ['path', 'fight'];
export const DEFAULT = { rel: 0.05, abs: 0.3 };
export const DEFAULT_COUNT = { rel: 0.005, abs: 0.5 };
export const DEFAULT_LOAD = { rel: 0.15, abs: 250 };

export function readResult(file) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (r.meta?.mode !== 'bench') throw new Error(`${file}: a ${r.meta?.mode ?? 'unknown'} run, not a bench run`);
  return r;
}

/** { 'map/preset': cell.median } of a result. */
export function cellsOf(result) {
  return Object.fromEntries(result.cells.filter(c => c.median).map(c => [`${c.map}/${c.preset}`, c.median]));
}

export function threshold(noise, cellKey, metric) {
  const fallback = metric.count ? DEFAULT_COUNT : metric.key === 'readyMs' ? DEFAULT_LOAD : DEFAULT;
  return noise?.cells?.[cellKey]?.[metric.key] ?? noise?.metrics?.[metric.key] ?? fallback;
}

/**
 * Suite aggregates: the geometric mean of a metric over every map x scenario of a preset (and over all cells).
 * One cell's run-to-run spread is 2-27 % (GPU clock states, the browser's presentation); the aggregates' is 0.5-3 %,
 * so the aggregates carry the verdict and the cells say where a change lands. noise.json `aggregate` holds their
 * thresholds: { "<group>": { "<metric>": { "rel": 0.02 } } }.
 */
export const AGG_GROUPS = { all: () => true, low: c => c.preset === 'low', medium: c => c.preset === 'medium',
  high: c => c.preset === 'high', ultra: c => c.preset === 'ultra' };
export const AGG_METRICS = [
  { key: 'frameMs.mean', label: 'frame mean', get: s => s?.frameMs?.mean },
  { key: 'frameMs.med', label: 'frame med', get: s => s?.frameMs?.med },
  { key: 'frameMs.p95', label: 'frame p95', get: s => s?.frameMs?.p95 },
  { key: 'cpuMs.mean', label: 'cpu mean', get: s => s?.cpuMs?.mean },
  { key: 'jsMs.mean', label: 'js mean', get: s => s?.trace?.jsMs?.mean },
];
export const DEFAULT_AGG = { rel: 0.03 };
const geomean = v => Math.exp(v.reduce((a, b) => a + Math.log(b), 0) / v.length);

/** { group: { metricKey: geomean } } over the result's cells (only cells present in `keys`, if given). */
export function aggregatesOf(result, keys = null) {
  const cells = result.cells.filter(c => c.median && (!keys || keys.has(`${c.map}/${c.preset}`)));
  const out = {};
  for (const [group, pick] of Object.entries(AGG_GROUPS)) {
    const chosen = cells.filter(pick);
    if (!chosen.length) continue;
    out[group] = {};
    for (const m of AGG_METRICS) {
      const v = chosen.flatMap(c => SCENARIOS.map(s => m.get(c.median[s]))).filter(x => Number.isFinite(x) && x > 0);
      if (v.length === chosen.length * SCENARIOS.length) out[group][m.key] = geomean(v);
    }
  }
  return out;
}

export function aggThreshold(noise, group, metric) {
  return noise?.aggregate?.[group]?.[metric.key] ?? DEFAULT_AGG;
}

// The noise floor from repeated baseline runs of the same tree: per map x preset x scenario and metric, the
// run-to-run spread (max - min of the files' medians, and that over their median), and thresholds of
// max(2 x spread, --min-pct %) (relative) and max(2 x spread, --min-abs) (absolute; counts: 2 x spread and 0.5, so any
// change past the runs' own spread shows).
// Writes perf/noise.json (format in metrics.mjs), which compare.mjs reads, and prints a markdown summary.
//   node perf/noise.mjs r1.json r2.json r3.json ... [--min-pct 3] [--min-abs 0.1] [--out perf/noise.json]
import { writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { AGG_METRICS, LOAD_METRICS, METRICS, ROOT_NOISE, SCENARIOS, aggregatesOf, cellsOf, readResult } from './metrics.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const minPct = Number(opt('min-pct', 3)), minAbs = Number(opt('min-abs', 0.1)), out = resolve(opt('out', ROOT_NOISE));
/** The suite aggregates' floor (their spread is 0.5-3 %, so 2 x spread alone could go under a timer step). */
const aggMinPct = Number(opt('agg-min-pct', 2));
const files = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (files.length < 2) {
  console.error('usage: node perf/noise.mjs r1.json r2.json [r3.json ...] [--min-pct 3] [--min-abs 0.1] [--out perf/noise.json]');
  process.exit(2);
}
const results = files.map(f => readResult(resolve(f)));
const shas = new Set(results.map(r => r.meta.git?.sha));
if (shas.size > 1) console.warn(`warning: the runs are of ${shas.size} commits; the spread includes their changes`);
const all = results.map(cellsOf);
const keys = Object.keys(all[0]).filter(k => all.every(c => c[k]));

const r4 = x => +x.toFixed(4);
const median = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const noise = { version: 1, created: new Date().toISOString(), from: files.map(f => basename(f)), minPct, minAbs, aggMinPct, aggregate: {}, metrics: {}, cells: {} };
const spreads = [];   // for the summary
const add = (cellKey, metric, values) => {
  const v = values.filter(x => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length < 2) return;
  const m = median(v), spread = Math.max(...v) - Math.min(...v), relSpread = m !== 0 ? spread / Math.abs(m) : 0;
  // Counts repeat run to run (any change is the code's); the rest get the spread's double, or the floor.
  const t = metric.count ? { rel: r4(2 * relSpread), abs: r4(Math.max(0.5, 2 * spread)) }
    : { rel: r4(Math.max(2 * relSpread, minPct / 100)), abs: r4(Math.max(2 * spread, metric.key === 'readyMs' ? 100 : minAbs)) };
  (noise.cells[cellKey] ??= {})[metric.key] = t;
  const g = noise.metrics[metric.key] ??= { rel: 0, abs: 0 };
  g.rel = Math.max(g.rel, t.rel); g.abs = Math.max(g.abs, t.abs);
  spreads.push({ cellKey, metric: metric.label, median: m, spread, relSpread, values: v });
};
for (const key of keys) {
  for (const scenario of SCENARIOS) for (const m of METRICS) add(`${key}/${scenario}`, m, all.map(c => m.get(c[key][scenario])));
  for (const m of LOAD_METRICS) add(`${key}/load`, m, all.map(c => m.get(c[key])));
}
// The suite aggregates (metrics.mjs `aggregatesOf`): threshold max(2 x relative spread, --agg-min-pct).
const aggs = results.map(r => aggregatesOf(r, new Set(keys)));
const aggRows = [];
for (const group of Object.keys(aggs[0])) {
  for (const m of AGG_METRICS) {
    const v = aggs.map(a => a[group]?.[m.key]).filter(Number.isFinite);
    if (v.length < 2) continue;
    const med = median(v), rel = (Math.max(...v) - Math.min(...v)) / med;
    (noise.aggregate[group] ??= {})[m.key] = { rel: r4(Math.max(2 * rel, aggMinPct / 100)), spread: r4(rel), values: v.map(r4) };
    aggRows.push(`| ${group} | ${m.label} | ${v.map(x => x.toFixed(3)).join(', ')} | ${(100 * rel).toFixed(1)}% | ${(100 * noise.aggregate[group][m.key].rel).toFixed(1)}% |`);
  }
}
writeFileSync(out, JSON.stringify(noise, null, 1));

const pct = x => `${(100 * x).toFixed(1)}%`;
console.log(`## noise floor from ${files.length} runs (${keys.length} cells)\n`);
console.log('| metric | median rel. spread | worst rel. spread (cell) | global threshold rel / abs |\n|---|---|---|---|');
for (const m of [...METRICS, ...LOAD_METRICS]) {
  const s = spreads.filter(x => x.metric === m.label);
  if (!s.length) continue;
  const worst = s.reduce((a, b) => (b.relSpread > a.relSpread ? b : a));
  const g = noise.metrics[m.key];
  console.log(`| ${m.label} | ${pct(median(s.map(x => x.relSpread)))} | ${pct(worst.relSpread)} (${worst.cellKey}: ${worst.values.join(', ')}) | ${pct(g.rel)} / ${g.abs} |`);
}
console.log(`\n## suite aggregates (geomean over every map x scenario of the group)\n\n| group | metric | runs | spread | threshold |\n|---|---|---|---|---|\n${aggRows.join('\n')}`);
console.log(`\n${out}`);

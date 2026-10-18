// usage: node perf/ab-agg.mjs tag  -> per variant geomean of frame mean/med per preset, plus paired ratio vs head
import { readdirSync, readFileSync } from 'node:fs';
const tag = process.argv[2], dir = new URL('./results/', import.meta.url).pathname;
const rows = {};
for (const f of readdirSync(dir)) {
  const m = f.match(new RegExp(`^scratch-${tag}-(.+)-(\\w+)-(\\w+)-(\\d+)\\.json$`)); if (!m) continue;
  const [, v, map, preset, r] = m; const a = JSON.parse(readFileSync(dir + f));
  for (const c of a.cells) for (const s of ['path', 'fight']) {
    const fm = c.runs[0][s].frameMs; (rows[v] ??= {})[`${map}/${preset}/${s}/${r}`] = { mean: fm.mean, med: fm.med, p95: fm.p95, preset };
  }
}
const all = new Set(Object.values(rows).flatMap(r => Object.keys(r)));
for (const [v, r] of Object.entries(rows)) { const miss = [...all].filter(k => !(k in r)); if (miss.length) { console.log(`INCOMPLETE ${v}: missing ${miss.join(' ')}`); process.exitCode = 1; } }
console.log(`complete: ${Object.keys(rows).length} variants x ${all.size} cell-scenario-rounds`);
const vs = Object.keys(rows).sort((a, b) => (a === 'head' ? -1 : b === 'head' ? 1 : a.localeCompare(b)));
const g = x => Math.exp(x.reduce((s, v) => s + Math.log(v), 0) / x.length);
for (const metric of ['mean', 'med', 'p95']) {
  console.log(`\n## ${metric}: geomean (paired ratio vs head)`);
  for (const preset of ['all', 'low', 'medium', 'high', 'ultra']) {
    const line = [preset.padEnd(7)];
    for (const v of vs) {
      const keys = Object.keys(rows[v]).filter(k => preset === 'all' || rows[v][k].preset === preset);
      if (!keys.length) { line.push(`${v}=-`); continue; }
      const val = g(keys.map(k => rows[v][k][metric]));
      const paired = rows.head ? keys.filter(k => rows.head[k]) : [];
      const ratio = paired.length ? g(paired.map(k => rows[v][k][metric] / rows.head[k][metric])) : NaN;
      line.push(`${v}=${val.toFixed(3)} (${((ratio - 1) * 100).toFixed(1)}%)`);
    }
    console.log(line.join('  '));
  }
}

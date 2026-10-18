// usage: node perf/ab-agg.mjs tag  -> per variant geomean of frame mean/med/p95 per preset, plus paired ratio vs head.
// Reads perf/results/scratch-<tag>-manifest.json (written by ab.sh) and fails (exit 1) unless every variant x map x
// preset x round result exists and holds exactly its own cell.
import { existsSync, readFileSync } from 'node:fs';
const tag = process.argv[2], dir = new URL('./results/', import.meta.url).pathname;
const die = msg => { console.error(`ab-agg: ${msg}`); process.exit(1); };
if (!tag) die('usage: node perf/ab-agg.mjs tag');
const mf = `${dir}scratch-${tag}-manifest.json`;
if (!existsSync(mf)) die(`no manifest ${mf}: not an ab.sh run`);
const man = JSON.parse(readFileSync(mf));
if (!man.variants.includes('head')) die(`manifest has no variant named 'head' (${man.variants.join(', ')})`);
const rows = {}, errs = [];
for (const v of man.variants) for (const map of man.maps) for (const preset of man.presets) for (let r = 1; r <= man.rounds; r++) {
  const f = `scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
  if (!existsSync(dir + f)) { errs.push(`missing ${f}`); continue; }
  const cells = JSON.parse(readFileSync(dir + f)).cells ?? [];
  if (cells.length !== 1 || cells[0].map !== map || cells[0].preset !== preset) {
    errs.push(`${f}: holds ${cells.map(c => `${c.map}/${c.preset}`).join(' ') || 'no cells'}, not ${map}/${preset}`); continue;
  }
  for (const s of ['path', 'fight']) {
    const fm = cells[0].runs?.[0]?.[s]?.frameMs;
    if (!fm) { errs.push(`${f}: no ${s} frame times`); continue; }
    (rows[v] ??= {})[`${map}/${preset}/${s}/${r}`] = { mean: fm.mean, med: fm.med, p95: fm.p95, preset };
  }
}
if (errs.length) die(`incomplete run '${tag}':\n  ${errs.join('\n  ')}`);
console.log(`HEAD ${man.head}  variants: ${man.variants.join(', ')}  (${man.date})`);
console.log(`complete: ${man.variants.length} variants x ${Object.keys(rows.head).length} cell-scenario-rounds`);
const vs = ['head', ...man.variants.filter(v => v !== 'head')];
const g = x => Math.exp(x.reduce((s, v) => s + Math.log(v), 0) / x.length);
for (const metric of ['mean', 'med', 'p95']) {
  console.log(`\n## ${metric}: geomean (paired ratio vs head)`);
  for (const preset of ['all', ...man.presets]) {
    const keys = Object.keys(rows.head).filter(k => preset === 'all' || rows.head[k].preset === preset), line = [preset.padEnd(7)];
    for (const v of vs) {
      const val = g(keys.map(k => rows[v][k][metric])), ratio = g(keys.map(k => rows[v][k][metric] / rows.head[k][metric]));
      line.push(`${v}=${val.toFixed(3)} (${((ratio - 1) * 100).toFixed(1)}%)`);
    }
    console.log(line.join('  '));
  }
}

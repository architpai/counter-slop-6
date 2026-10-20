// usage: node perf/ab-agg.mjs tag  -> per variant geomean of frame mean/med/p95 per preset, plus paired ratio vs head;
// for a traced run (AB_TRACE=1) also js mean (traced main-thread ms per frame), all scenarios and fights only.
// Reads perf/results/scratch-<tag>-manifest.json (written by ab.sh) and fails (exit 1) unless every variant x map x
// preset x round result exists and holds exactly its own cell. A run made with AB_ARGS="--scenarios fight" reads only
// those scenarios (from the manifest's `args`); a --load-only run is for ab-load.mjs. Traced runs whose trace has GC
// events also print gc ms per frame (arithmetic mean, and the difference vs head).
import { existsSync, readFileSync } from 'node:fs';
const tag = process.argv[2], dir = new URL('./results/', import.meta.url).pathname;
const die = msg => { console.error(`ab-agg: ${msg}`); process.exit(1); };
if (!tag) die('usage: node perf/ab-agg.mjs tag');
const mf = `${dir}scratch-${tag}-manifest.json`;
if (!existsSync(mf)) die(`no manifest ${mf}: not an ab.sh run`);
const man = JSON.parse(readFileSync(mf));
if (!man.variants.includes('head')) die(`manifest has no variant named 'head' (${man.variants.join(', ')})`);
const args = man.args ?? [];
if (args.includes('--load-only')) die(`'${tag}' is a --load-only run: use node perf/ab-load.mjs ${tag}`);
const si = args.indexOf('--scenarios'), scens = ['path', 'fight'].filter(s => si < 0 || args[si + 1]?.split(',').includes(s));
const rows = {}, errs = [];
for (const v of man.variants) for (const map of man.maps) for (const preset of man.presets) for (let r = 1; r <= man.rounds; r++) {
  const f = `scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
  if (!existsSync(dir + f)) { errs.push(`missing ${f}`); continue; }
  const cells = JSON.parse(readFileSync(dir + f)).cells ?? [];
  if (cells.length !== 1 || cells[0].map !== map || cells[0].preset !== preset) {
    errs.push(`${f}: holds ${cells.map(c => `${c.map}/${c.preset}`).join(' ') || 'no cells'}, not ${map}/${preset}`); continue;
  }
  for (const s of scens) {
    const fm = cells[0].runs?.[0]?.[s]?.frameMs;
    if (!fm) { errs.push(`${f}: no ${s} frame times`); continue; }
    const js = cells[0].runs[0][s].trace?.jsMs?.mean;
    if (man.trace && !(js > 0)) errs.push(`${f}: no ${s} js (traced run)`);
    const tr = cells[0].runs[0][s].trace, gc = tr?.gc && tr.frames > 0 ? tr.gc.ms / tr.frames : undefined;
    (rows[v] ??= {})[`${map}/${preset}/${s}/${r}`] = { mean: fm.mean, med: fm.med, p95: fm.p95, js, gc, preset, s };
  }
}
if (errs.length) die(`incomplete run '${tag}':\n  ${errs.join('\n  ')}`);
console.log(`HEAD ${man.head}  variants: ${man.variants.join(', ')}  (${man.date})`);
console.log(`complete: ${man.variants.length} variants x ${Object.keys(rows.head).length} cell-scenario-rounds`);
const vs = ['head', ...man.variants.filter(v => v !== 'head')];
const g = x => Math.exp(x.reduce((s, v) => s + Math.log(v), 0) / x.length);
const sections = [['mean'], ['med'], ['p95'], ...(man.trace ? [['js'], ['js', 'fight']] : [])].filter(([, only]) => !only || scens.includes(only));
for (const [metric, only] of sections) {
  console.log(`\n## ${metric}${only ? ` (${only} only)` : ''}: geomean (paired ratio vs head)`);
  for (const preset of ['all', ...man.presets]) {
    const keys = Object.keys(rows.head).filter(k => (preset === 'all' || rows.head[k].preset === preset) && (!only || rows.head[k].s === only)),
      line = [preset.padEnd(7)];
    for (const v of vs) {
      const val = g(keys.map(k => rows[v][k][metric])), ratio = g(keys.map(k => rows[v][k][metric] / rows.head[k][metric]));
      line.push(`${v}=${val.toFixed(3)} (${((ratio - 1) * 100).toFixed(1)}%)`);
    }
    console.log(line.join('  '));
  }
}
// GC ms per frame (traced runs with GC events in every row): can be 0, so an arithmetic mean and a difference, not a ratio.
const allKeys = Object.keys(rows.head);
if (man.trace && vs.every(v => allKeys.every(k => rows[v][k].gc !== undefined))) {
  console.log('\n## gc ms/frame (main-thread MinorGC+MajorGC in the traced replay): mean (difference vs head, ms)');
  const mean = x => x.reduce((a, b) => a + b, 0) / x.length;
  for (const only of [null, ...scens.filter(() => scens.length > 1)]) for (const preset of ['all', ...man.presets]) {
    const keys = allKeys.filter(k => (preset === 'all' || rows.head[k].preset === preset) && (!only || rows.head[k].s === only));
    const h = mean(keys.map(k => rows.head[k].gc));
    console.log([`${preset}${only ? ` ${only}` : ''}`.padEnd(13), ...vs.map(v => { const x = mean(keys.map(k => rows[v][k].gc));
      return `${v}=${x.toFixed(3)} (${x - h >= 0 ? '+' : ''}${(x - h).toFixed(3)})`; })].join('  '));
  }
}

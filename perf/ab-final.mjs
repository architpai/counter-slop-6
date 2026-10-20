// usage: node perf/ab-final.mjs base tag[,tag...]  -> the cumulative table of Round 10's final verification: per preset
// (and all), FINAL (`head`) against a base variant (Round 0's tree, e.g. `r0`) over one or more ab.sh runs (one per map,
// each balanced on its own), paired per cell-scenario-round. Rows: frame mean / median / p95 / p99 and callback cpu
// mean (geomean over the cell-scenario-rounds; change = head / base - 1, so < 0 means FINAL is faster), the same for the
// HEAD/HEAD control (headB / head - 1), how many pairs FINAL is faster in, per scenario too; draw calls (median of the
// per-run medians) and programs (median) per variant. Fails unless every expected result exists and holds its cell.
import { existsSync, readFileSync } from 'node:fs';
const [base, tagList] = process.argv.slice(2), dir = new URL('./results/', import.meta.url).pathname;
const die = msg => { console.error(`ab-final: ${msg}`); process.exit(1); };
if (!base || !tagList) die('usage: node perf/ab-final.mjs base tag[,tag...]');
const rows = [], errs = [];
for (const tag of tagList.split(',')) {
  const mf = `${dir}scratch-${tag}-manifest.json`;
  if (!existsSync(mf)) die(`no manifest ${mf}`);
  const man = JSON.parse(readFileSync(mf));
  for (const v of ['head', base]) if (!man.variants.includes(v)) die(`${tag}: no variant '${v}'`);
  if ((man.args ?? []).includes('--load-only')) die(`${tag} is a --load-only run`);
  const si = (man.args ?? []).indexOf('--scenarios'), scens = ['path', 'fight'].filter(s => si < 0 || man.args[si + 1]?.split(',').includes(s));
  for (const map of man.maps) for (const preset of man.presets) for (let r = 1; r <= man.rounds; r++) for (const s of scens) {
    const row = { tag, map, preset, r, s, v: {} };
    for (const v of man.variants) {
      const f = `scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
      if (!existsSync(dir + f)) { errs.push(`missing ${f}`); continue; }
      const cells = JSON.parse(readFileSync(dir + f)).cells ?? [];
      const run = cells.length === 1 && cells[0].map === map && cells[0].preset === preset ? cells[0].runs?.[0]?.[s] : null;
      if (!run?.frameMs) { errs.push(`${f}: no ${s} result for ${map}/${preset}`); continue; }
      row.v[v] = { mean: run.frameMs.mean, med: run.frameMs.med, p95: run.frameMs.p95, p99: run.frameMs.p99,
        cpu: run.cpuMs?.mean, calls: run.calls?.med, programs: run.programs, hash: run.summary?.hash };
    }
    rows.push(row);
  }
}
if (errs.length) die(`incomplete:\n  ${errs.join('\n  ')}`);
const g = x => Math.exp(x.reduce((a, b) => a + Math.log(b), 0) / x.length);
const med = x => { const s = [...x].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = x => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)} %`;
const presets = [...new Set(rows.map(r => r.preset))], groups = [...presets, 'all'];
const hasB = rows.every(r => r.v.headB);
console.log(`base ${base}, tags ${tagList}: ${rows.length} cell-scenario-rounds${hasB ? ', control headB' : ''}`);
for (const scen of ['both', 'path', 'fight']) {
  console.log(`\n## ${scen === 'both' ? 'path + fight' : scen}: ${base} → FINAL (head); change = head/${base} - 1 (control: headB/head - 1)`);
  console.log(`| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) |${hasB ? ' control mean / med / p95 / p99 |' : ''}`);
  console.log(`|---|---|---|---|---|---|---|---|${hasB ? '---|' : ''}`);
  for (const grp of groups) {
    const sel = rows.filter(r => (grp === 'all' || r.preset === grp) && (scen === 'both' || r.s === scen));
    if (!sel.length) continue;
    const cell = k => { const b = g(sel.map(r => r.v[base][k])), h = g(sel.map(r => r.v.head[k]));
      return `${b.toFixed(3)} → ${h.toFixed(3)} (${pct(g(sel.map(r => r.v.head[k] / r.v[base][k])) - 1)})`; };
    const ctl = k => pct(g(sel.map(r => r.v.headB[k] / r.v.head[k])) - 1);
    const faster = sel.filter(r => r.v.head.mean < r.v[base].mean).length;
    console.log(`| ${grp} | ${sel.length} | ${cell('mean')} | ${cell('med')} | ${cell('p95')} | ${cell('p99')} | ${cell('cpu')} | ${faster}/${sel.length} |${hasB ? ` ${['mean', 'med', 'p95', 'p99'].map(ctl).join(' / ')} |` : ''}`);
  }
}
console.log(`\n## counts per preset and scenario: draw calls (median of per-run medians), programs (median); ${base} → FINAL`);
console.log('| preset | scenario | calls | programs | fight hashes equal |\n|---|---|---|---|---|');
for (const p of presets) for (const s of ['path', 'fight']) {
  const sel = rows.filter(r => r.preset === p && r.s === s);
  if (!sel.length) continue;
  const c = k => `${med(sel.map(r => r.v[base][k]))} → ${med(sel.map(r => r.v.head[k]))}`;
  const eq = s === 'fight' ? `${sel.filter(r => Object.values(r.v).every(x => x.hash === r.v.head.hash)).length}/${sel.length}` : '';
  console.log(`| ${p} | ${s} | ${c('calls')} | ${c('programs')} | ${eq} |`);
}

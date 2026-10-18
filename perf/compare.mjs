// Compare two bench results: per map x preset x scenario, the change in each metric (abs and %), flagged where it
// passes the noise floor (perf/noise.json, see metrics.mjs; else max(5 %, 0.3 ms), counts max(0.5 %, 1)).
//   node perf/compare.mjs BASE.json NEW.json [--threshold-file perf/noise.json] [--all]
// BASE may be a comma-separated list (e.g. the three baselines): each value is then their median.
// Prints the suite aggregates (geomean per preset and over all cells: the verdict, see metrics.mjs), then a markdown
// table of cells (rows with a flagged change only, unless --all) and a verdict; exits 0.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGG_METRICS, LOAD_METRICS, METRICS, ROOT_NOISE, SCENARIOS, aggThreshold, aggregatesOf, cellsOf, readResult, threshold } from './metrics.mjs';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--threshold-file');
if (files.length !== 2) {
  console.error('usage: node perf/compare.mjs BASE.json NEW.json [--threshold-file perf/noise.json] [--all]');
  process.exit(2);
}
const noiseFile = opt('threshold-file') ?? ROOT_NOISE;
const noise = existsSync(noiseFile) ? JSON.parse(readFileSync(noiseFile, 'utf8')) : null;
const bases = files[0].split(',').map(f => readResult(resolve(f)));
const A = bases[0], B = readResult(resolve(files[1]));
const med = v => { const s = v.filter(x => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const baseCells = bases.map(cellsOf), cb = cellsOf(B);
const ca = Object.fromEntries(Object.keys(baseCells[0]).filter(k => baseCells.every(c => c[k])).map(k => [k, true]));
/** A base value: the median over the base files. */
const baseValue = (key, get) => med(baseCells.map(c => get(c[key])));
const baseLabel = bases.map(b => b.meta.label).join('+');

const warn = [];
for (const k of ['frames', 'warmup', 'fightWarmup', 'seed']) {
  if (bases.some(b => b.meta.config?.[k] !== A.meta.config?.[k])) warn.push(`config ${k} differs between the base files`);
  if (A.meta.config?.[k] !== B.meta.config?.[k]) warn.push(`config ${k} differs: ${A.meta.config?.[k]} vs ${B.meta.config?.[k]}`);
}
if (A.meta.chrome !== B.meta.chrome) warn.push(`chrome differs: ${A.meta.chrome} vs ${B.meta.chrome}`);
if (B.meta.git?.dirty) warn.push(`${B.meta.label} ran on a dirty tree`);

const fmt = x => (x === null || x === undefined ? '-' : Math.abs(x) >= 1000 ? Math.round(x).toString() : (+x.toFixed(2)).toString());
const counts = { improved: 0, regressed: 0, within: 0 };
const flagged = [];
/** One comparison: { text, verdict }. */
function judge(cellKey, metric, a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const d = b - a, pct = a !== 0 ? (100 * d) / Math.abs(a) : d === 0 ? 0 : Infinity;
  const t = threshold(noise, cellKey, metric), limit = Math.max(t.abs, t.rel * Math.abs(a));
  const verdict = Math.abs(d) > limit ? (d < 0 ? 'improved' : 'regressed') : 'within';
  counts[verdict]++;
  const mark = verdict === 'improved' ? ' **IMP**' : verdict === 'regressed' ? ' **REG**' : '';
  const sign = d > 0 ? '+' : '';
  return { verdict, text: `${fmt(a)} → ${fmt(b)} (${sign}${fmt(d)}, ${sign}${Number.isFinite(pct) ? pct.toFixed(1) : 'inf'}%)${mark}` };
}

const header = ['cell', 'scenario', ...METRICS.map(m => m.label)];
const rows = [];
const keys = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
for (const key of keys) {
  if (!ca[key] || !cb[key]) { warn.push(`${key}: only in ${ca[key] ? baseLabel : B.meta.label}`); continue; }
  for (const scenario of SCENARIOS) {
    const cellKey = `${key}/${scenario}`, cells = [];
    let any = false;
    for (const m of METRICS) {
      const j = judge(cellKey, m, baseValue(key, c => m.get(c[scenario])), m.get(cb[key][scenario]));
      if (j && j.verdict !== 'within') { any = true; flagged.push(`${cellKey} ${m.label}: ${j.text.replace(/ \*\*\w+\*\*$/, '')} ${j.verdict}`); }
      cells.push(j?.text ?? '-');
    }
    if (any || argv.includes('--all')) rows.push([key, scenario, ...cells]);
  }
  for (const m of LOAD_METRICS) {
    const j = judge(`${key}/load`, m, baseValue(key, c => m.get(c)), m.get(cb[key]));
    if (j && j.verdict !== 'within') flagged.push(`${key} ${m.label}: ${j.text.replace(/ \*\*\w+\*\*$/, '')} ${j.verdict}`);
  }
}

console.log(`## ${baseLabel} (${A.meta.git?.sha?.slice(0, 7)}) → ${B.meta.label} (${B.meta.git?.sha?.slice(0, 7)}${B.meta.git?.dirty ? '+dirty' : ''})`);
console.log(`noise floor: ${noise ? noiseFile : 'default max(5 %, 0.3 ms); counts max(0.5 %, 1)'}\n`);
if (warn.length) console.log(warn.map(w => `> warning: ${w}`).join('\n') + '\n');

// The suite aggregates over the cells both sides have: the verdict.
const shared = new Set(Object.keys(ca).filter(k => cb[k]));
const aggBase = bases.map(b => aggregatesOf(b, shared)), aggNew = aggregatesOf(B, shared);
const aggCounts = { improved: 0, regressed: 0, within: 0 }, aggFlags = [];
console.log(`### suite aggregates (geomean over ${shared.size} map x preset cells x ${SCENARIOS.length} scenarios; the verdict)\n`);
console.log(`| group | ${AGG_METRICS.map(m => m.label).join(' | ')} |\n|---|${AGG_METRICS.map(() => '---').join('|')}|`);
for (const group of Object.keys(aggNew)) {
  const row = AGG_METRICS.map(m => {
    const a = med(aggBase.map(x => x[group]?.[m.key])), b = aggNew[group]?.[m.key];
    if (a === null || b === undefined) return '-';
    const d = b - a, pct = (100 * d) / a, t = aggThreshold(noise, group, m), beyond = Math.abs(d) > t.rel * a;
    const verdict = beyond ? (d < 0 ? 'improved' : 'regressed') : 'within';
    aggCounts[verdict]++;
    if (beyond) aggFlags.push(`${group} ${m.label}: ${pct.toFixed(1)}% (threshold ${(100 * t.rel).toFixed(1)}%) ${verdict}`);
    return `${a.toFixed(3)} → ${b.toFixed(3)} (${d > 0 ? '+' : ''}${pct.toFixed(1)}%${beyond ? (d < 0 ? ' **IMP**' : ' **REG**') : ''})`;
  });
  console.log(`| ${group} | ${row.join(' | ')} |`);
}
console.log(`\n**suite verdict**: ${aggCounts.regressed} regressed, ${aggCounts.improved} improved, ${aggCounts.within} within noise`
  + ` (${aggCounts.regressed > 0 ? 'REGRESSION' : aggCounts.improved > 0 ? 'IMPROVEMENT' : 'NO CHANGE'})`);
if (aggFlags.length) console.log(aggFlags.map(f => `- ${f}`).join('\n'));
console.log('\n### cells\n');
if (rows.length) {
  console.log(`| ${header.join(' | ')} |\n|${header.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
} else console.log('no change beyond the noise floor');
console.log(`\n**cell verdict**: ${counts.regressed} regressed, ${counts.improved} improved, ${counts.within} within noise`
  + ` (${counts.regressed > 0 ? 'REGRESSION' : counts.improved > 0 ? 'IMPROVEMENT' : 'NO CHANGE'})`);
if (flagged.length) console.log(flagged.map(f => `- ${f}`).join('\n'));

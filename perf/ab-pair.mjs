// Paired view of two arbitrary variants of an A/B run (Round 8): per preset, x vs y on one frameMs field, per
// scenario and both: the geomean of the paired ratios x/y over cell-rounds, the median ratio, and how many cell-rounds
// x was slower; the same for headB vs head as the control. E.g. pre4 vs noset (Round 4 confirmation on a tree without
// the later rounds' changes on that preset).
//   node perf/ab-pair.mjs <tag> <x> <y> [mean|med|p95] [--cells]
import { readFileSync } from 'node:fs';
const [tag, x, y] = process.argv.slice(2, 5), key = process.argv[5]?.startsWith('--') ? 'mean' : process.argv[5] ?? 'mean';
if (!tag || !x || !y) { console.error('usage: node perf/ab-pair.mjs <tag> <x> <y> [mean|med|p95] [--cells]'); process.exit(2); }
const dir = 'perf/results', man = JSON.parse(readFileSync(`${dir}/scratch-${tag}-manifest.json`));
for (const v of [x, y, 'head', 'headB']) if (!man.variants.includes(v)) { console.error(`no variant ${v} in ${tag}`); process.exit(2); }
const cell = (v, m, p, r) => JSON.parse(readFileSync(`${dir}/scratch-${tag}-${v}-${m}-${p}-${r}.json`)).cells[0];
const med = a => { const s = [...a].sort((u, w) => u - w), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const geo = a => Math.exp(a.reduce((s, r) => s + Math.log(r), 0) / a.length);
const pct = r => `${r >= 1 ? '+' : ''}${((r - 1) * 100).toFixed(1)}%`;
const scen = Object.keys(cell(x, man.maps[0], man.presets[0], 1).median).filter(s => s !== 'load');
const pair = (a, b, p, which) => {
  const rs = [];
  for (const m of man.maps) for (let r = 1; r <= man.rounds; r++) {
    const ca = cell(a, m, p, r), cb = cell(b, m, p, r);
    for (const s of which) rs.push(ca.median[s].frameMs[key] / cb.median[s].frameMs[key]);
  }
  return `geo ${pct(geo(rs))} med ${pct(med(rs))} slower ${rs.filter(q => q > 1).length}/${rs.length}`;
};
console.log(`${tag}: ${x} vs ${y}, frameMs.${key} (> 0 = ${x} slower); control headB vs head`);
for (const p of man.presets) for (const which of [...scen.map(s => [s]), scen]) {
  const label = which.length > 1 ? 'both' : which[0];
  console.log(`${p.padEnd(7)} ${label.padEnd(5)} ${x}/${y}: ${pair(x, y, p, which)} | headB/head: ${pair('headB', 'head', p, which)}`);
}
if (process.argv.includes('--cells')) for (const p of man.presets) for (const m of man.maps) for (const s of scen) {
  const rows = [];
  for (let r = 1; r <= man.rounds; r++) rows.push(`r${r} ${y} ${cell(y, m, p, r).median[s].frameMs[key].toFixed(2)} ${x} ${pct(cell(x, m, p, r).median[s].frameMs[key] / cell(y, m, p, r).median[s].frameMs[key])}`);
  console.log(`${p} ${m} ${s}: ${rows.join(' | ')}`);
}

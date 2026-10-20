// Robust paired view of an A/B fight run (Round 7): per preset, the median over cell-rounds of variant/head and
// variant/headB on one fight frameMs field, and how many cell-rounds were faster; --cells prints every ratio.
//   node perf/ab-robust.mjs <tag> [mean|med|p95] [--cells]
import { readFileSync } from 'node:fs';
const tag = process.argv[2], key = process.argv[3]?.startsWith('--') ? 'mean' : process.argv[3] ?? 'mean', dir = 'perf/results';
const man = JSON.parse(readFileSync(`${dir}/scratch-${tag}-manifest.json`));
const val = (v, m, p, r) => JSON.parse(readFileSync(`${dir}/scratch-${tag}-${v}-${m}-${p}-${r}.json`)).cells[0].median.fight.frameMs[key];
const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = x => `${((x - 1) * 100).toFixed(1)}%`;
for (const p of man.presets) {
  const out = [];
  for (const v of man.variants.filter(v => v !== 'head')) {
    const rh = [], rb = []; let fh = 0, fb = 0, n = 0;
    for (const m of man.maps) for (let r = 1; r <= man.rounds; r++) {
      const h = val('head', m, p, r), b = val('headB', m, p, r), x = val(v, m, p, r);
      rh.push(x / h); n++; if (x < h) fh++;
      if (v !== 'headB') { rb.push(x / b); if (x < b) fb++; }
    }
    out.push(`${v}: med/head ${pct(med(rh))} (faster ${fh}/${n})` + (rb.length ? `, med/headB ${pct(med(rb))} (faster ${fb}/${n})` : ''));
  }
  console.log(`${p.padEnd(7)} ${out.join(' | ')}`);
}
if (process.argv.includes('--cells')) for (const p of man.presets) for (const m of man.maps) {
  const vs = man.variants.filter(v => v !== 'head'), rows = [];
  for (let r = 1; r <= man.rounds; r++) { const h = val('head', m, p, r);
    rows.push(`r${r} head ${h.toFixed(2)} ` + vs.map(v => `${v} ${pct(val(v, m, p, r) / h)}`).join(' ')); }
  console.log(`${p} ${m}\n  ` + rows.join('\n  '));
}

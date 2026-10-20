// usage: node perf/ab-pool.mjs tag copies [mean|med|p95] [path|fight|both]
//   copies = the HEAD copies besides head, each optionally limited to presets: headB,medfcp:low+high+ultra
// Each variant against the pooled HEAD reference (head and its copies) per preset, two ways, to 2 decimals:
//  raw    = paired geomean ratio vs head (ab-agg.mjs) divided by the geomean of the copies' ratios vs head (the same cells);
//  posfit = the ab-posfit.mjs fit (cell-scenario-round + variant + run position, per preset), the variant's effect minus
//           the mean of the HEAD copies' effects (head = 0).
// Also every pairwise difference among the HEAD copies (raw and posfit) and the noise line N_p = max(2 %, the largest).
import { existsSync, readFileSync } from 'node:fs';
const die = msg => { console.error(`ab-pool: ${msg}`); process.exit(1); };
const [tag, spec, metric = 'mean', scen = 'both'] = process.argv.slice(2);
if (!tag || !spec) die('usage: node perf/ab-pool.mjs tag copies [mean|med|p95] [path|fight|both]');
const dir = new URL('./results/', import.meta.url).pathname, man = JSON.parse(readFileSync(`${dir}scratch-${tag}-manifest.json`));
const N = man.variants.length, scens = scen === 'both' ? ['path', 'fight'] : [scen];
const copies = spec.split(',').map(c => { const [v, ps] = c.split(':'); return { v, ps: ps ? ps.split('+') : man.presets }; });
for (const c of copies) if (!man.variants.includes(c.v)) die(`no variant ${c.v}`);
const obs = [];
for (let r = 1; r <= man.rounds; r++) man.presets.forEach((preset, pi) => man.maps.forEach((map, mi) => {
  const k = (mi + pi + r - 1) % N;  // ab.sh's rotation (see ab-posfit.mjs)
  man.variants.forEach((v, i) => {
    const f = `${dir}scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
    if (!existsSync(f)) die(`missing ${f}`);
    const cells = JSON.parse(readFileSync(f)).cells ?? [];
    if (cells.length !== 1 || cells[0].map !== map || cells[0].preset !== preset) die(`${f}: not ${map}/${preset}`);
    for (const s of scens) {
      const val = cells[0].runs?.[0]?.[s]?.frameMs?.[metric];
      if (!(val > 0)) die(`${f}: no ${s} ${metric}`);
      obs.push({ v, p: (i - k + N) % N, preset, g: `${map}/${preset}/${r}/${s}`, y: Math.log(val) });
    }
  });
}));
function fit(sub) {  // least squares as in ab-posfit.mjs; returns log effects vs head
  const gs = [...new Set(sub.map(o => o.g))], vs = man.variants.filter(v => v !== 'head');
  const ps = [...new Set(sub.map(o => o.p))].filter(p => p !== 0).sort((a, b) => a - b);
  const k = gs.length + vs.length + ps.length, A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (const o of sub) {
    const x = new Float64Array(k); x[gs.indexOf(o.g)] = 1; if (o.v !== 'head') x[gs.length + vs.indexOf(o.v)] = 1; if (o.p !== 0) x[gs.length + vs.length + ps.indexOf(o.p)] = 1;
    for (let i = 0; i < k; i++) { if (!x[i]) continue; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * o.y; }
  }
  const scale = Math.max(...A.map((row, i) => Math.abs(row[i])));
  for (let i = 0; i < k; i++) { let m = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]];
    if (Math.abs(A[i][i]) < 1e-9 * scale) die('design not identifiable');
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; } }
  const out = { head: 0 }; vs.forEach((v, i) => out[v] = A[gs.length + i][k] / A[gs.length + i][gs.length + i]);
  return out;
}
function raw(sub) {  // mean paired log ratio vs head over the same cells
  const head = Object.fromEntries(sub.filter(o => o.v === 'head').map(o => [o.g, o.y])), out = {};
  for (const v of man.variants) { const d = sub.filter(o => o.v === v).map(o => o.y - head[o.g]); out[v] = d.reduce((a, b) => a + b, 0) / d.length; }
  return out;
}
const pct = x => `${x >= 0 ? '+' : ''}${((Math.exp(x) - 1) * 100).toFixed(2)}%`;
console.log(`${tag} ${metric} ${scen}: vs pooled HEAD (raw / posfit); HEAD copies ${spec}`);
for (const preset of ['all', ...man.presets]) {
  const sub = preset === 'all' ? obs : obs.filter(o => o.preset === preset);
  const R = raw(sub), F = fit(sub);
  const pool = ['head', ...copies.filter(c => preset === 'all' ? c.ps.length === man.presets.length : c.ps.includes(preset)).map(c => c.v)];
  const mR = pool.reduce((a, v) => a + R[v], 0) / pool.length, mF = pool.reduce((a, v) => a + F[v], 0) / pool.length;
  let worst = 0; const pairs = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const dr = R[pool[j]] - R[pool[i]], df = F[pool[j]] - F[pool[i]];
    worst = Math.max(worst, Math.abs(Math.exp(dr) - 1), Math.abs(Math.exp(df) - 1), Math.abs(Math.exp(-dr) - 1), Math.abs(Math.exp(-df) - 1));
    pairs.push(`${pool[j]}/${pool[i]} ${pct(dr)} / ${pct(df)}`);
  }
  console.log(`\n${preset}  pool=${pool.join('+')}  N_p=${(Math.max(0.02, worst) * 100).toFixed(2)}%  copies: ${pairs.join(', ')}`);
  for (const v of man.variants) if (!pool.includes(v)) console.log(`  ${v.padEnd(8)} ${pct(R[v] - mR)} / ${pct(F[v] - mF)}`);
}

// usage: node perf/ab-posfit.mjs tag [mean|med|p95|cpu] [path|fight|both] [--partial]
// Order-corrected paired estimate (a diagnostic): least squares log(metric) = cell-scenario-round + variant + run
// position, per preset and over all presets. Reads perf/results/scratch-<tag>-manifest.json (written by ab.sh) and the
// result files it implies. Fails (exit 1) unless every variant x map x preset x round result exists and holds its own
// cell; with --partial it drops every incomplete map x preset x round (all its variants) and lists them.
// Positions come from ab.sh's rotation; the file mtimes are only a cross-check (a warning when they disagree).
import { existsSync, readFileSync, statSync } from 'node:fs';
const die = msg => { console.error(`ab-posfit: ${msg}`); process.exit(1); };
const argv = process.argv.slice(2), partial = argv.includes('--partial');
const bad = argv.filter(a => a.startsWith('--') && a !== '--partial');
if (bad.length) die(`unknown option ${bad.join(' ')}`);
const [tag, metric = 'mean', scen = 'both', ...extra] = argv.filter(a => a !== '--partial');
if (!tag || extra.length) die('usage: node perf/ab-posfit.mjs tag [mean|med|p95|cpu] [path|fight|both] [--partial]');
if (!['mean', 'med', 'p95', 'cpu'].includes(metric)) die(`metric must be mean, med, p95 or cpu, not '${metric}'`);
if (!['path', 'fight', 'both'].includes(scen)) die(`scenario must be path, fight or both, not '${scen}'`);
const dir = new URL('./results/', import.meta.url).pathname, mf = `${dir}scratch-${tag}-manifest.json`;
if (!existsSync(mf)) die(`no manifest ${mf}: not an ab.sh run`);
const man = JSON.parse(readFileSync(mf)), N = man.variants.length;
if (!man.variants.includes('head')) die(`manifest has no variant named 'head' (${man.variants.join(', ')})`);
const scens = scen === 'both' ? ['path', 'fight'] : [scen];

const obs = [], errs = [], skipped = [], warns = [];
for (let r = 1; r <= man.rounds; r++) man.presets.forEach((preset, pi) => man.maps.forEach((map, mi) => {
  // ab.sh: k = (mi + pi + r - 3) % #variants with 1-based mi, pi; it runs variants[k..] then variants[..k-1].
  const k = (mi + pi + r - 1) % N, cell = `${map}/${preset}/${r}`, rows = [], cellErrs = [];
  man.variants.forEach((v, i) => {
    const f = `scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
    if (!existsSync(dir + f)) return cellErrs.push(`missing ${f}`);
    const cells = JSON.parse(readFileSync(dir + f)).cells ?? [];
    if (cells.length !== 1 || cells[0].map !== map || cells[0].preset !== preset)
      return cellErrs.push(`${f}: holds ${cells.map(c => `${c.map}/${c.preset}`).join(' ') || 'no cells'}, not ${map}/${preset}`);
    const ys = {};
    for (const s of scens) {
      const run = cells[0].runs?.[0]?.[s], val = metric === 'cpu' ? run?.cpuMs?.mean : run?.frameMs?.[metric];
      if (!(val > 0)) { cellErrs.push(`${f}: no ${s} ${metric === 'cpu' ? 'cpu mean' : `frame ${metric}`}`); continue; }
      ys[s] = Math.log(val);
    }
    rows.push({ v, p: (i - k + N) % N, t: statSync(dir + f).mtimeMs, ys });
  });
  if (cellErrs.length) { (partial ? skipped : errs).push(...(partial ? [`${cell}: ${cellErrs.join('; ')}`] : cellErrs)); return; }
  const ts = rows.map(o => o.t);
  if (new Set(ts).size !== ts.length) warns.push(`${cell}: equal mtimes, order not checked`);
  else {
    const byTime = [...rows].sort((a, b) => a.t - b.t).map(o => o.v), byRot = [...rows].sort((a, b) => a.p - b.p).map(o => o.v);
    if (byTime.join() !== byRot.join()) warns.push(`${cell}: mtime order ${byTime.join(',')} != rotation ${byRot.join(',')}`);
  }
  for (const o of rows) for (const s of scens) obs.push({ v: o.v, p: o.p, preset, g: `${cell}/${s}`, y: o.ys[s] });
}));
if (errs.length) die(`incomplete run '${tag}' (use --partial to drop incomplete map/preset/rounds):\n  ${errs.join('\n  ')}`);
console.log(`diagnostic only: ${tag} log(${metric}, ${scen}) = cell-scenario-round + variant + run position; each preset row ` +
  `is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty`);
if (skipped.length) console.log(`--partial: dropped ${skipped.length} incomplete map/preset/rounds:\n  ${skipped.join('\n  ')}`);
if (warns.length) console.error(`ab-posfit: warning: ${warns.length} map/preset/rounds where the mtimes do not confirm ` +
  `the rotation:\n  ${warns.slice(0, 8).join('\n  ')}${warns.length > 8 ? '\n  ...' : ''}`);
if (!obs.length) die('no complete map/preset/round');

function fit(sub, name) {
  const gs = [...new Set(sub.map(o => o.g))], vs = [...new Set(sub.map(o => o.v))].filter(v => v !== 'head').sort();
  const ps = [...new Set(sub.map(o => o.p))].filter(p => p !== 0).sort((a, b) => a - b);
  const k = gs.length + vs.length + ps.length, A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (const o of sub) {
    const x = new Float64Array(k); x[gs.indexOf(o.g)] = 1; if (o.v !== 'head') x[gs.length + vs.indexOf(o.v)] = 1; if (o.p !== 0) x[gs.length + vs.length + ps.indexOf(o.p)] = 1;
    for (let i = 0; i < k; i++) { if (!x[i]) continue; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * o.y; }
  }
  // Gauss-Jordan on the normal equations, partial pivoting; a pivot near zero (relative to the largest diagonal) means
  // some variant or position effect is confounded with the others.
  const scale = Math.max(...A.map((row, i) => Math.abs(row[i])));
  for (let i = 0; i < k; i++) { let m = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]];
    if (Math.abs(A[i][i]) < 1e-9 * scale) die(`design not identifiable (${name}): variant and position effects are confounded`);
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; } }
  const sol = A.map((row, i) => row[k] / row[i]);
  const out = {}; vs.forEach((v, i) => out[v] = ((Math.exp(sol[gs.length + i]) - 1) * 100).toFixed(1) + '%');
  const pos = ps.map((p, i) => ((Math.exp(sol[gs.length + vs.length + i]) - 1) * 100).toFixed(1)).join(' ');
  return { out, pos };
}
for (const preset of ['all', ...man.presets.filter(p => obs.some(o => o.preset === p))]) {
  const { out, pos } = fit(preset === 'all' ? obs : obs.filter(o => o.preset === preset), preset);
  console.log(preset.padEnd(7), Object.entries(out).map(([v, x]) => `${v}=${x}`).join('  '), ' | pos1..: ' + pos);
}

// Order-corrected paired estimate: log(frame mean) = cell-scenario-round + variant + position, least squares.
import fs from 'node:fs';
const [tag, metric = 'mean', scen = 'both'] = process.argv.slice(2);
const dir = 'perf/results';
const files = fs.readdirSync(dir).filter(n => n.startsWith(`scratch-${tag}-`) && !n.includes('manifest'));
const obs = [];
const groupsT = {};
for (const n of files) {
  const [, , v, map, preset, round] = n.replace('.json', '').split('-');
  const j = JSON.parse(fs.readFileSync(`${dir}/${n}`)); const r = j.cells[0].runs[0];
  const t = fs.statSync(`${dir}/${n}`).mtimeMs;
  for (const sc of ['path', 'fight']) {
    if (scen !== 'both' && sc !== scen) continue;
    const val = metric === 'cpu' ? r[sc].cpuMs.mean : r[sc].frameMs[metric];
    obs.push({ v, preset, g: `${map}|${preset}|${round}|${sc}`, cell: `${map}|${preset}|${round}`, t, y: Math.log(val) });
  }
}
for (const o of obs) (groupsT[o.cell] ??= new Set()).add(o.t);
for (const o of obs) o.p = [...groupsT[o.cell]].sort((a, b) => a - b).indexOf(o.t);
function fit(sub) {
  const gs = [...new Set(sub.map(o => o.g))], vs = [...new Set(sub.map(o => o.v))].filter(v => v !== 'head').sort(), ps = [...new Set(sub.map(o => o.p))].filter(p => p !== 0).sort();
  const k = gs.length + vs.length + ps.length; const A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (const o of sub) {
    const x = new Float64Array(k); x[gs.indexOf(o.g)] = 1; if (o.v !== 'head') x[gs.length + vs.indexOf(o.v)] = 1; if (o.p !== 0) x[gs.length + vs.length + ps.indexOf(o.p)] = 1;
    for (let i = 0; i < k; i++) { if (!x[i]) continue; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * o.y; }
  }
  for (let i = 0; i < k; i++) { let m = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r; [A[i], A[m]] = [A[m], A[i]];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; } }
  const sol = A.map((row, i) => row[k] / row[i]);
  const out = {}; vs.forEach((v, i) => out[v] = ((Math.exp(sol[gs.length + i]) - 1) * 100).toFixed(1) + '%');
  const pos = ps.map((p, i) => ((Math.exp(sol[gs.length + vs.length + i]) - 1) * 100).toFixed(1)).join(' ');
  return { out, pos };
}
for (const preset of ['all', ...new Set(obs.map(o => o.preset))]) {
  const { out, pos } = fit(preset === 'all' ? obs : obs.filter(o => o.preset === preset));
  console.log(preset.padEnd(7), Object.entries(out).map(([v, x]) => `${v}=${x}`).join('  '), ' | pos1..: ' + pos);
}

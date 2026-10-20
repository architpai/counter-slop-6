// Median table of several bench results (perf/results/*.json): the perf/LOG.md baseline table.
//   node perf/table.mjs r1.json r2.json r3.json
import { readFileSync } from 'node:fs';
const runs = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')));
const med = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const f = (x, d = 1) => x == null || !Number.isFinite(x) ? '-' : (+x.toFixed(d)).toString();
console.log('| map | preset | path frame med/p95/p99 | path cpu / js | fight frame med/p95/p99 | fight cpu / js | calls path/fight | tris k path/fight | programs | first playable / ready s | heap MB end (fight peak) | long >33 / >2x med |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of runs[0].cells) {
  const key = `${c.map}/${c.preset}`;
  const cells = runs.map(r => r.cells.find(x => `${x.map}/${x.preset}` === key).median);
  const m = p => med(cells.map(x => get(x, p)));
  const sc = s => `${f(m(`${s}.frameMs.med`))} / ${f(m(`${s}.frameMs.p95`))} / ${f(m(`${s}.frameMs.p99`))}`;
  const cj = s => `${f(m(`${s}.cpuMs.med`))} / ${f(m(`${s}.trace.jsMs.med`), 2)}`;
  const long = ['path', 'fight'].map(s => [m(`${s}.longFrames.over33`), m(`${s}.longFrames.over2xMedian`)]);
  console.log(`| ${c.map} | ${c.preset} | ${sc('path')} | ${cj('path')} | ${sc('fight')} | ${cj('fight')} | ${f(m('path.calls.med'), 0)}/${f(m('fight.calls.med'), 0)} | ${f(m('path.triangles.med') / 1000)}/${f(m('fight.triangles.med') / 1000)} | ${f(m('fight.programs'), 0)} | ${f(m('load.firstPlayableMs') / 1000, 2)} / ${f(m('load.readyMs') / 1000, 2)} | ${f(m('fight.heapEndMB'), 0)} (${f(m('fight.heapPeakMB'), 0)}) | ${long.map(l => l.map(x => f(x, 0)).join('/')).join(', ')} |`);
}

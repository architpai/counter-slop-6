// usage: node perf/ab-load.mjs tag  -> load times of an ab.sh run, per preset and all: per variant the geomean of
// readyMs and firstPlayableMs and the paired ratio vs head (pairs: map x preset x round; with --repeat N in AB_ARGS the
// median of the cell-round's N loads, and the geomean over all loads too), the phase times' median difference vs head
// (lib.mjs `loadPhases`: when each readiness flag went done, the match start, the quiet start's end), and the load
// window (match start to ready): longest frame, frames over 33/50 ms, skipped frames, renderer wall time.
// Best with AB_ARGS="--load-only --repeat 3"; a normal run gives one load per cell-round. Reads
// perf/results/scratch-<tag>-manifest.json (written by ab.sh) and fails (exit 1) unless every variant x map x preset x
// round result exists, holds exactly its own cell, and has every load.
import { existsSync, readFileSync } from 'node:fs';
const tag = process.argv[2], dir = new URL('./results/', import.meta.url).pathname;
const die = msg => { console.error(`ab-load: ${msg}`); process.exit(1); };
if (!tag) die('usage: node perf/ab-load.mjs tag');
const mf = `${dir}scratch-${tag}-manifest.json`;
if (!existsSync(mf)) die(`no manifest ${mf}: not an ab.sh run`);
const man = JSON.parse(readFileSync(mf));
if (!man.variants.includes('head')) die(`manifest has no variant named 'head' (${man.variants.join(', ')})`);
const args = man.args ?? [], ri = args.indexOf('--repeat'), repeat = ri >= 0 ? Number(args[ri + 1]) : 1;

/** The numbers one load gives: the two load times, the phase times (page ms) and the window. */
function pick(load) {
  const ph = load.phases ?? {}, out = { readyMs: load.readyMs, firstPlayableMs: load.firstPlayableMs }, phase = {};
  for (const k of ['liveMs', 'enteredMs', 'firstPlayableMs', 'readyMs']) phase[k] = load[k];
  phase.matchMs = ph.matchMs; phase.quietEndMs = ph.quietEndMs;
  for (const [k, f] of Object.entries(ph.flags ?? {})) if (f.on !== null) { phase[`${k}.on`] = f.on; phase[`${k}.off`] = f.off; }
  // pace.last: the last back-off change (the first entry is only the start value).
  if (ph.pace?.length > 1) phase['pace.last'] = ph.pace[ph.pace.length - 1][0];
  if (ph.pace?.length) out.paceMax = Math.max(...ph.pace.map(p => p[1]));
  return { ...out, phase, window: ph.window ?? null };
}

const data = {}, errs = [];
for (const v of man.variants) for (const map of man.maps) for (const preset of man.presets) for (let r = 1; r <= man.rounds; r++) {
  const f = `scratch-${tag}-${v}-${map}-${preset}-${r}.json`;
  if (!existsSync(dir + f)) { errs.push(`missing ${f}`); continue; }
  const cells = JSON.parse(readFileSync(dir + f)).cells ?? [];
  if (cells.length !== 1 || cells[0].map !== map || cells[0].preset !== preset) {
    errs.push(`${f}: holds ${cells.map(c => `${c.map}/${c.preset}`).join(' ') || 'no cells'}, not ${map}/${preset}`); continue;
  }
  const runs = cells[0].runs ?? [];
  if (runs.length !== repeat || runs.some(x => x.failed || !(x.load?.readyMs > 0) || !(x.load?.firstPlayableMs > 0))) {
    errs.push(`${f}: ${runs.filter(x => !x.failed && x.load?.readyMs > 0).length} good loads of ${repeat}`); continue;
  }
  (data[v] ??= {})[`${map}/${preset}/${r}`] = { preset, loads: runs.map(x => pick(x.load)) };
}
if (errs.length) die(`incomplete run '${tag}':\n  ${errs.join('\n  ')}`);

const med = x => { const s = x.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const g = x => Math.exp(x.reduce((s, v) => s + Math.log(v), 0) / x.length);
const mean = x => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
const pct = x => `${x >= 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%`;
const vs = ['head', ...man.variants.filter(v => v !== 'head')], groups = ['all', ...man.presets];
const keysOf = preset => Object.keys(data.head).filter(k => preset === 'all' || data.head[k].preset === preset);
console.log(`HEAD ${man.head}  variants: ${man.variants.join(', ')}  args: ${args.join(' ') || '(none)'}  (${man.date})`);
console.log(`complete: ${vs.length} variants x ${Object.keys(data.head).length} map-preset-rounds x ${repeat} load(s)`);

for (const metric of ['readyMs', 'firstPlayableMs']) {
  console.log(`\n## ${metric}: geomean of the cell-round medians, ms (paired ratio vs head)${repeat > 1 ? ' [geomean of all loads]' : ''}`);
  for (const preset of groups) {
    const keys = keysOf(preset), line = [preset.padEnd(7)];
    for (const v of vs) {
      const m = k => med(data[v][k].loads.map(l => l[metric]));
      const all = repeat > 1 ? ` [${g(keys.flatMap(k => data[v][k].loads.map(l => l[metric]))).toFixed(0)}]` : '';
      line.push(`${v}=${g(keys.map(m)).toFixed(0)} (${pct(g(keys.map(k => m(k) / med(data.head[k].loads.map(l => l[metric])))))})${all}`);
    }
    console.log(line.join('  '));
  }
}

// Phase times: per cell-round the median over its loads, then per phase the median of (variant - head) over the pairs.
const phaseMed = (v, k, p) => med(data[v][k].loads.map(l => l.phase[p]));
for (const preset of groups) {
  const keys = keysOf(preset), names = new Set();
  for (const v of vs) for (const k of keys) for (const l of data[v][k].loads) for (const [p, x] of Object.entries(l.phase)) if (Number.isFinite(x)) names.add(p);
  const head = p => med(keys.map(k => phaseMed('head', k, p)));
  const order = [...names].sort((a, b) => (head(a) ?? Infinity) - (head(b) ?? Infinity));
  console.log(`\n## phases (${preset}): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)`);
  for (const p of order) {
    const cols = vs.filter(v => v !== 'head').map(v => {
      const d = keys.map(k => { const a = phaseMed('head', k, p), b = phaseMed(v, k, p); return a === null || b === null ? NaN : b - a; });
      const m = med(d);
      return `${v}=${m === null ? '-' : `${m >= 0 ? '+' : ''}${m.toFixed(0)}`}`;
    });
    console.log(`${p.padEnd(22)} head=${head(p)?.toFixed(0) ?? '-'}  ${cols.join('  ')}`);
  }
}

console.log('\n## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped,'
  + ' median frames, median renderer ms (sum / longest), max upload pace');
for (const preset of groups) {
  const keys = keysOf(preset), line = [preset.padEnd(7)];
  for (const v of vs) {
    const ws = keys.flatMap(k => data[v][k].loads.map(l => l.window)).filter(Boolean);
    const paces = keys.flatMap(k => data[v][k].loads.map(l => l.paceMax)).filter(Number.isFinite);
    const f = (fn, x, d = 1) => (ws.length ? fn(ws.map(x)).toFixed(d) : '-');
    line.push(`${v}=${f(med, w => w.maxMs)} ${f(mean, w => w.over33)}/${f(mean, w => w.over50)} skip ${f(mean, w => w.skipped)} `
      + `n ${f(med, w => w.frames, 0)} r ${f(med, w => w.renderMs, 0)}/${f(med, w => w.renderMaxMs)} pace ${paces.length ? Math.max(...paces) : '-'}`);
  }
  console.log(line.join('  '));
}

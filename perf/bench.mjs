// Performance benchmark over the production build: every map x preset at 1920x1080 (DPR 1), each cell in a fresh
// browser (cold GPU process and HTTP cache), uncapped (vsync and the frame-rate limit off, fpsTarget 0, dynamic
// resolution pinned to 1), the simulation on a fixed 1/60 s step so every run sees the same frames.
//   node perf/bench.mjs [--label NAME] [--maps a,b] [--presets a,b] [--repeat N] [--frames N] [--quick] [--profile]
//                       [--build] [--headed] [--no-trace] [--gpu-timer] [--raw] [--seed N] [--warmup N]
//                       [--fight-warmup N] [--ablate-frames N]
// --quick: downtown, low and ultra, 300 frames. --no-trace: skip the traced replays (about a third faster, no js/wait
// numbers). --gpu-timer: record the raw query spans (gpuQueryMs) anyway. --raw: keep the per-frame arrays.
// Per cell: cold load (firstPlayableMs, readyMs), the facts the run depends on (asserted), a warm-up (a turn with
// every fight kind in view, then fire held at the sky), an idle window (the uncapped rate, and the GPU timer's
// check), then two scenarios:
//   path:  the player carried round a closed loop of the map's walkable points (once in --frames), HUD and view model on;
//   fight: a fixed roster spawned on a fixed schedule (lib.mjs ROSTER), auto-aim at the nearest, fire held, a real
//          grenade every 90 frames, gore full; Math.random seeded (mulberry32) at its start. An unrecorded run of
//          it first compiles impacts, blood and blasts.
// Each scenario runs twice: once under a Chrome trace (`trace`: the callback's thread CPU time, its waits on the GPU
// command buffer, the GPU process's CPU), then clean for the headline numbers: cpu (wall time in the game's rAF
// callback: update + render submission, waits included), frame (rAF to rAF), three's per-frame calls/triangles,
// programs/geometries/textures, JS heap, long frames. gpu (TIME_ELAPSED over Renderer.render) only where the timer
// passes its check (a GPU time no longer than the frame interval); on ANGLE Metal it does not (see `meta.timerNote`).
// --profile runs apart (its timers cost time): CPU ms per sub-step and per-pass GPU query spans, under `profile`.
// Writes perf/results/<label>.json and prints a markdown table.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CHROME_ARGS, MAPS, PRESETS, ROOT, SEED, VIEWPORT, git, heapMB, launch, loadAndWait, median, openPage, startServer, stats, traced } from './lib.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const quick = flag('quick');
const cfg = {
  label: opt('label', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)),
  maps: opt('maps', quick ? 'downtown' : MAPS.join(',')).split(','),
  presets: opt('presets', quick ? 'low,ultra' : PRESETS.join(',')).split(','),
  repeat: Number(opt('repeat', 1)),
  frames: Number(opt('frames', quick ? 300 : 900)),
  warmup: Number(opt('warmup', 240)),
  fightWarmup: Number(opt('fight-warmup', 240)),
  ablateFrames: Number(opt('ablate-frames', 240)),
  idle: 120,
  seed: Number(opt('seed', SEED)),
  profile: flag('profile'),
  trace: !flag('no-trace'),
  /** Record the raw query spans (`gpuQueryMs`) even where the timer fails its check. */
  gpuTimer: flag('gpu-timer'),
  headed: flag('headed'),
  /** Keep the per-frame arrays (frame, cpu, gpu, calls, triangles) in the JSON. */
  raw: flag('raw'),
  build: flag('build'),
  quick,
};
for (const m of cfg.maps) assert.ok(MAPS.includes(m), `unknown map ${m}`);
for (const p of cfg.presets) assert.ok(PRESETS.includes(p), `unknown preset ${p}`);

const SCENARIOS = ['path', 'fight'];
const RUN_TIMEOUT_MS = 30_000 + cfg.frames * 200;
const TIMER_NOTE = 'EXT_disjoint_timer_query_webgl2 on ANGLE Metal returns non-zero, non-disjoint results that scale with GPU work, but '
  + 'they are spans of 2-2.5x the GPU-bound frame interval (e.g. Ultra downtown idle: query 8.4 ms at a 3.5 ms frame; one injected '
  + 'fullscreen pass: query 20.7 ms at an 8.1 ms frame), so not GPU busy time. gpuMs is null where the per-cell check fails '
  + '(query median > 1.1x frame median); frameMs is the GPU-bound measure (trace.waitMsPerFrame shows the main thread waiting on the GPU side).';
const PARITY_NOTE = 'P.reset zeroes the renderer\'s _frame at each run\'s start, so recorded callback k renders with _frame = k + 1, and a '
  + 'preset that redraws its shadow map every 2nd frame (Low, facts.shadowEvery 2) draws it in callbacks k = 1, 3, 5, ... cpuParity indexes '
  + 'callbacks (cpu[k] is callback k): the shadow callbacks are the ODD ones. frameParity indexes intervals (frame[i] runs from callback i-1\'s '
  + 'rAF to callback i\'s, so it holds callback i-1\'s work): the shadow callbacks fall in the EVEN intervals; interval 0 holds a callback from '
  + 'before the reset and is left out. The GPU may finish a frame after its interval ends (frames in flight), so GPU cost can show an '
  + 'interval later: read the gap between the sides. Means over finite values; N is the count per side.';
const r1 = x => (x === null || x === undefined ? null : +x.toFixed(1));
const r2 = x => (x === null || x === undefined ? null : +x.toFixed(2));

/** Mean of a per-frame array by the parity of the index, from index `from` on (PARITY_NOTE); null for an empty side. */
function parity(values, from = 0) {
  const sum = [0, 0], n = [0, 0];
  for (let i = from; i < values.length; i++) if (Number.isFinite(values[i])) { sum[i % 2] += values[i]; n[i % 2]++; }
  const mean = k => (n[k] ? +(sum[k] / n[k]).toFixed(3) : null);
  return { evenMs: mean(0), oddMs: mean(1), evenN: n[0], oddN: n[1] };
}
const frameParity = raw => ({ frameParity: parity(raw.frame, 1), cpuParity: parity(raw.cpu) });

/** Per-scenario numbers from the page's per-frame arrays. */
function digest(raw, timerOk) {
  const frame = stats(raw.frame), cpu = stats(raw.cpu), gpuVals = raw.gpu.filter(Number.isFinite);
  const gpu = gpuVals.length >= raw.frames * 0.5 ? stats(gpuVals) : null;
  const med = frame?.med ?? 0;
  const info = k => ({ med: median(raw[k]), max: Math.max(...raw[k]) });
  return {
    frames: raw.frames, skipped: raw.skipped, streamingFrames: raw.streamingFrames, compilingFrames: raw.compilingFrames, newPrograms: raw.newPrograms,
    frameMs: frame, cpuMs: cpu, gpuMs: timerOk ? gpu : null,
    ...(!timerOk && gpu ? { gpuQueryMs: gpu } : {}),
    calls: info('calls'), triangles: info('triangles'), points: info('points'), lines: info('lines'),
    programs: raw.programs, geometries: raw.geometries, textures: raw.textures,
    longFrames: { over33: raw.frame.filter(x => x > 33.3).length, over50: raw.frame.filter(x => x > 50).length,
      over2xMedian: raw.frame.filter(x => x > 2 * med).length },
    ...frameParity(raw),
    heapPeakMB: raw.heapPeakMB, dynamicScale: raw.dynamicScale, summary: raw.summary, trail: raw.trail,
    ...Object.fromEntries(Object.entries(raw).filter(([k]) => ['pathLength', 'speedMps', 'worstYDrift', 'spawned'].includes(k))),
    ...(cfg.raw ? { raw: { frame: raw.frame, cpu: raw.cpu, gpu: raw.gpu, calls: raw.calls, triangles: raw.triangles } } : {}),
  };
}

async function runCell(map, preset) {
  const started = Date.now();
  const browser = await launch({ headed: cfg.headed });
  const chrome = browser.version();
  const { page, cdp, errors } = await openPage(browser, { map, preset, profile: cfg.profile });
  // A run that stops stepping (a page error in the frame loop) fails the cell instead of hanging it.
  const run = (name, frames, seed = cfg.seed) => Promise.race([
    page.evaluate(([n, f, s]) => window.__perf.run(n, f, { seed: s }), [name, frames, seed]),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name}: ${frames} frames not done in ${RUN_TIMEOUT_MS / 1000} s`
      + ` (${errors.map(e => e.text).join(' | ') || 'no page error'})`)), RUN_TIMEOUT_MS).unref()),
  ]);
  const setTimer = on => page.evaluate(on => { if (window.__perf.timer) window.__perf.timer.enabled = on; }, on);
  /**
   * Per-pass GPU cost by ablation (the timer queries read spans, not busy time, on ANGLE Metal): the scenario's first
   * `ablateFrames` frames with one pass skipped, against the same frames with nothing skipped (before and after). The
   * frame is GPU-bound on the realistic tiers (the main thread waits on the command buffer), so the drop in the
   * frame interval is that pass's GPU time; `noiseMs` is the two baselines' difference. `ms` reads the frame median,
   * which jumps between the modes of a bimodal run (Low: a shadow redraw every 2nd frame), `meanMs` the frame mean;
   * `parity` splits the mean by interval parity (PARITY_NOTE: on Low the even intervals hold the shadow redraws).
   */
  async function ablate(name, passes) {
    const measure = async pass => {
      await page.evaluate(p => { window.__perf.ablate = p; }, pass);
      try {
        const { frame } = await run(name, cfg.ablateFrames), s = stats(frame), p = parity(frame, 1);
        return { med: s.med, mean: s.mean, even: p.evenMs, odd: p.oddMs };
      } finally { await page.evaluate(() => { window.__perf.ablate = null; }); }
    };
    const b0 = await measure(null), costs = {};
    for (const pass of Object.keys(passes ?? {}).filter(p => !p.startsWith('perf:'))) costs[pass] = await measure(pass);
    const b1 = await measure(null);
    const base = k => (b0[k] + b1[k]) / 2, noise = k => r2(Math.abs(b0[k] - b1[k]));
    const drops = k => Object.entries(costs).map(([pass, v]) => [pass, r2(base(k) - v[k])]).sort((a, b) => b[1] - a[1]);
    const byMean = drops('mean');
    return { frames: cfg.ablateFrames, baseMs: r2(base('med')), noiseMs: noise('med'), ms: Object.fromEntries(drops('med')),
      baseMeanMs: r2(base('mean')), noiseMeanMs: noise('mean'), meanMs: Object.fromEntries(byMean),
      parity: { baseMs: { even: r2(base('even')), odd: r2(base('odd')) }, noiseMs: { even: noise('even'), odd: noise('odd') },
        ms: Object.fromEntries(byMean.map(([pass]) => [pass, { even: r2(base('even') - costs[pass].even), odd: r2(base('odd') - costs[pass].odd) }])) } };
  }
  try {
    const load = await loadAndWait(page);
    const facts = await page.evaluate(() => window.__perf.prepare());
    // The facts every number depends on.
    assert.equal(facts.preset, preset, 'preset');
    assert.equal(facts.fpsTarget, 0, 'fpsTarget (uncapped)');
    assert.equal(facts.pixelRatio, 1, 'pixel ratio');
    assert.deepEqual(facts.drawingBuffer, [VIEWPORT.width, VIEWPORT.height], 'drawing buffer');
    assert.equal(facts.level, map, 'map');
    assert.equal(facts.state, 'play', 'state');
    const route = await page.evaluate(() => window.__perf.buildPath());
    for (const w of route.warnings) errors.push({ type: 'harness', text: `path route: ${w}`, count: 1 });
    if (cfg.profile) await page.evaluate(() => window.__perf.installProfile());
    await run('warmup', cfg.warmup);
    // The idle window: the uncapped rate. Then the GPU timer's calibration: idle with the timer on, without and with a
    // known extra fullscreen pass; a timer that reads GPU busy time is no longer than the frame interval, and grows by
    // what the pass adds to it.
    const idleClean = await run('idle', cfg.idle);
    facts.dynamicScale = await page.evaluate(() => window.__perf.dynamicScale());
    assert.equal(facts.dynamicScale, 1, 'dynamic scale');
    const idleFrame = stats(idleClean.frame);
    facts.idle = { frameMedMs: idleFrame.med, fps: r1(1000 / idleFrame.med), cpuMedMs: stats(idleClean.cpu).med };
    if (facts.idle.fps < 75) errors.push({ type: 'harness', text: `idle rate ${facts.idle.fps} fps: is a cap still on?`, count: 1 });
    await setTimer(true);
    const base = await run('idle', cfg.idle);
    await page.evaluate(() => window.__perf.calibrate(true));
    await run('idle', 30);
    const loaded = await run('idle', cfg.idle);
    await page.evaluate(() => window.__perf.calibrate(false));
    await setTimer(false);
    await run('idle', 30);
    const t = await page.evaluate(() => {
      const t = window.__perf.timer;
      return { ...window.__perf.timerStatus, read: t?.read ?? 0, zero: t?.zero ?? 0, disjoint: t?.disjoint ?? 0 };
    });
    const q0 = stats(base.gpu.filter(Number.isFinite)), q1 = stats(loaded.gpu.filter(Number.isFinite));
    const f0 = stats(base.frame).med, f1 = stats(loaded.frame).med;
    const timer = { ...t, base: { queryMedMs: q0?.med ?? null, frameMedMs: f0, results: q0?.n ?? 0 },
      calibrated: { queryMedMs: q1?.med ?? null, frameMedMs: f1, results: q1?.n ?? 0 } };
    timer.slope = q0 && q1 && f1 - f0 > 0.5 ? r2((q1.med - q0.med) / (f1 - f0)) : null;
    const checks = [
      [t.supported, t.reason],
      [!!q0 && q0.n >= cfg.idle * 0.5 && t.zero < t.read * 0.5, `${q0?.n ?? 0}/${cfg.idle} results, ${t.zero} zero, ${t.disjoint} disjoint`],
      [!!q0 && q0.med <= 1.1 * f0, `query ${q0?.med} ms over the ${f0} ms frame interval`],
      [timer.slope !== null, `the extra pass moved the frame interval by ${r2(f1 - f0)} ms only`],
      [timer.slope !== null && Math.abs(timer.slope - 1) <= 0.25, `the query grew ${timer.slope}x what the extra pass added to the frame interval`],
    ];
    timer.working = checks.every(([ok]) => ok);
    if (!timer.working) timer.reason = checks.filter(([ok]) => !ok).map(([, why]) => why).join('; ');
    const out = { map, preset, chrome, load: { firstPlayableMs: r1(load.firstPlayableMs), readyMs: r1(load.readyMs), liveMs: r1(load.liveMs),
      enteredMs: r1(load.enteredMs) }, facts, timer, route };
    for (const name of SCENARIOS) {
      if (name === 'fight' && cfg.fightWarmup > 0) await run('fight', cfg.fightWarmup, cfg.seed + 1);
      // The traced replay first (the same frames: the run is deterministic), then the clean run for the headline numbers.
      let trace = null;
      if (cfg.trace) trace = (await traced(browser, () => run(name, cfg.frames))).trace;
      await setTimer(timer.working || cfg.gpuTimer);
      const raw = await run(name, cfg.frames);
      await setTimer(false);
      out[name] = cfg.profile ? { profile: { ...raw.profile, gpuAblation: await ablate(name, raw.profile.passesPerFrame) },
        summary: raw.summary, frameMs: stats(raw.frame), cpuMs: stats(raw.cpu), ...frameParity(raw) } : digest(raw, timer.working);
      if (trace) out[name].trace = trace;
      out[name].heapEndMB = await heapMB(cdp);
    }
    out.errors = errors.slice();
    out.cellMs = Date.now() - started;
    return out;
  } catch (error) {
    return { map, preset, chrome, failed: String(error?.stack ?? error), errors: errors.slice(), cellMs: Date.now() - started };
  } finally {
    await browser.close();
  }
}

/** Median across repeats of every numeric leaf that the repeats share. */
function medianOf(runs) {
  const ok = runs.filter(r => !r.failed);
  if (ok.length === 0) return null;
  const walk = list => {
    const first = list[0];
    if (typeof first === 'number') return median(list);
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const o = {};
      for (const k of Object.keys(first)) o[k] = walk(list.map(x => x?.[k]).filter(x => x !== undefined && x !== null));
      return o;
    }
    return first ?? null;
  };
  const keep = r => ({ load: r.load, path: r.path, fight: r.fight });
  return walk(ok.map(keep));
}

function table(cells) {
  const g = (s, k) => r2(s?.gpuMs?.[k]);
  const rows = [
    '| map | preset | path frame med/p95/p99 | path cpu (js) | path gpu | fight frame med/p95/p99 | fight cpu (js) | fight gpu | calls (path/fight) | tris k (path/fight) | programs | readyMs | heap MB | long >33/>50/>2x (path+fight) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of cells) {
    const m = c.median;
    if (!m) { rows.push(`| ${c.map} | ${c.preset} | FAILED | | | | | | | | | | | |`); continue; }
    const p = m.path, f = m.fight;
    const fr = s => `${r2(s.frameMs.med)} / ${r2(s.frameMs.p95)} / ${r2(s.frameMs.p99)}`;
    const cpu = s => `${r2(s.cpuMs.med)}${s.trace?.jsMs ? ` (${r2(s.trace.jsMs.med)})` : ''}`;
    const long = ['over33', 'over50', 'over2xMedian'].map(k => (p.longFrames[k] ?? 0) + (f.longFrames[k] ?? 0)).join('/');
    rows.push(`| ${c.map} | ${c.preset} | ${fr(p)} | ${cpu(p)} | ${g(p, 'med') ?? '-'} | ${fr(f)} | ${cpu(f)} | ${g(f, 'med') ?? '-'} | `
      + `${p.calls.med}/${f.calls.med} | ${r1(p.triangles.med / 1000)}/${r1(f.triangles.med / 1000)} | ${f.programs} | ${r1(m.load.readyMs)} | ${r1(Math.max(p.heapPeakMB, f.heapPeakMB))} | ${long} |`);
  }
  return rows.join('\n');
}

function profileTable(cells) {
  const rows = [];
  for (const c of cells) {
    const run = c.runs.find(r => !r.failed);
    if (!run) continue;
    for (const name of SCENARIOS) {
      const p = run[name]?.profile;
      if (!p) continue;
      const fmt = o => (o ? Object.entries(o).map(([k, v]) => `${k} ${r2(v)}`).join(', ') : 'n/a');
      const a = p.gpuAblation, t = run[name].trace, s = run[name];
      // Every 2nd frame redraws the shadow map (Low): the frame splits into its two modes (PARITY_NOTE).
      const split = run.facts?.shadowEvery === 2;
      const sides = o => `even ${r2(o.even)} / odd ${r2(o.odd)}`;
      rows.push(`- **${c.map} ${c.preset} ${name}**: frame med ${r2(s.frameMs.med)} ms (mean ${r2(s.frameMs.mean)}), callback ${r2(s.cpuMs.med)} ms`
        + (split && s.frameParity ? ` (frame mean even/odd intervals ${r2(s.frameParity.evenMs)} / ${r2(s.frameParity.oddMs)}, callback mean even/odd`
          + ` ${r2(s.cpuParity.evenMs)} / ${r2(s.cpuParity.oddMs)}; the shadow redraw is in the odd callbacks, the even intervals)` : '')
        + (t ? `, js (thread CPU) ${r2(t.jsMs?.med)} ms, waiting on the GPU command buffer ${r2(t.waitMsPerFrame)} ms/frame, GPU process main ${r2(t.gpuMainCpuPerFrame)} ms/frame` : '')
        + `\n  - GPU ms by ablation of the frame median (${a.frames} frames, base ${a.baseMs}, noise ${a.noiseMs}): ${fmt(a.ms)}`
        + (a.meanMs ? `\n  - GPU ms by ablation of the frame mean (base ${a.baseMeanMs}, noise ${a.noiseMeanMs}): ${fmt(a.meanMs)}` : '')
        + (split && a.parity ? `\n  - frame mean by interval parity (base ${sides(a.parity.baseMs)}, noise ${sides(a.parity.noiseMs)}): `
          + Object.entries(a.parity.ms).map(([k, v]) => `${k} ${sides(v)}`).join(', ') : '')
        + `\n  - CPU ms (wall, waits included): ${fmt(p.cpu)}\n  - passes per frame: ${fmt(p.passesPerFrame)}`
        + (p.gpuQuerySpans ? `\n  - timer query spans (not busy time on ANGLE Metal): ${fmt(p.gpuQuerySpans)}` : ''));
    }
  }
  return rows.join('\n');
}

// ---- run
const t0 = Date.now();
const server = await startServer({ build: cfg.build });
const cells = [];
for (const map of cfg.maps) for (const preset of cfg.presets) cells.push({ map, preset, runs: [] });
try {
  for (let rep = 0; rep < cfg.repeat; rep++) {
    for (const cell of cells) {
      const r = await runCell(cell.map, cell.preset);
      r.repeat = rep;
      cell.runs.push(r);
      const s = x => (x ? `${r2(x.frameMs?.med)} ms (cpu ${r2(x.cpuMs?.med)}, gpu ${r2(x.gpuMs?.med) ?? '-'})` : '-');
      console.error(r.failed ? `FAIL ${cell.map} ${cell.preset}: ${r.failed.split('\n')[0]}`
        : `[${rep + 1}/${cfg.repeat}] ${cell.map} ${cell.preset}: ready ${r.load.readyMs} ms, idle ${r.facts.idle.fps} fps, path ${s(r.path)}, fight ${s(r.fight)}, `
          + `fight end ${JSON.stringify(r.fight?.summary)}, ${(r.cellMs / 1000).toFixed(1)} s`);
      for (const e of r.errors ?? []) console.error(`  ${e.type} x${e.count ?? 1}: ${e.text}`);
    }
  }
} finally {
  server.close();
}
for (const cell of cells) cell.median = cfg.profile ? null : medianOf(cell.runs);

const first = cells.flatMap(c => c.runs).find(r => !r.failed);
const result = {
  meta: {
    label: cfg.label, mode: cfg.profile ? 'profile' : 'bench', date: new Date().toISOString(), git: git(), chrome: first?.chrome ?? null,
    gpu: first?.facts?.gpu ?? null, viewport: { ...VIEWPORT, deviceScaleFactor: 1 }, chromeArgs: CHROME_ARGS, node: process.version,
    args: argv, config: cfg, timer: Object.fromEntries(cells.flatMap(c => c.runs.map(r => [`${c.map}/${c.preset}#${r.repeat}`, r.timer ?? null]))),
    timerNote: TIMER_NOTE, parityNote: PARITY_NOTE, durationMs: Date.now() - t0, errors: cells.flatMap(c => c.runs.flatMap(r => (r.errors ?? []).map(e => ({ cell: `${c.map}/${c.preset}`, ...e })))),
  },
  cells,
};
if (cfg.profile) result.profile = Object.fromEntries(cells.map(c => [`${c.map}/${c.preset}`,
  Object.fromEntries(SCENARIOS.map(n => [n, c.runs.filter(r => !r.failed).map(r => r[n]?.profile ?? null)]))]));
await mkdir(resolve(ROOT, 'perf/results'), { recursive: true });
const file = resolve(ROOT, `perf/results/${cfg.label}.json`);
await writeFile(file, JSON.stringify(result, null, 1));

console.log(`\n## ${cfg.label} (${result.meta.git.sha?.slice(0, 7)}${result.meta.git.dirty ? '+dirty' : ''}, ${result.meta.chrome}, ${cfg.frames} frames, repeat ${cfg.repeat}${cfg.profile ? ', PROFILE' : ''})\n`);
console.log(cfg.profile ? profileTable(cells) : table(cells));
const errs = result.meta.errors;
console.log(`\n${errs.length ? `errors (${errs.length}):\n${errs.map(e => `- ${e.cell} ${e.type}: ${e.text}`).join('\n')}` : 'no page errors'}`);
console.log(`\n${file} (${(result.meta.durationMs / 1000).toFixed(0)} s)`);
if (cells.some(c => c.runs.some(r => r.failed))) process.exitCode = 1;

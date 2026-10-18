// Shared harness for the performance benchmark (perf/bench.mjs) and the screenshot quality gate: the static server
// over the production build, a browser per cell (ANGLE Metal, vsync and the frame-rate limit off), a page with a
// preset forced through localStorage, the game's rAF on a virtual clock (exactly 1/60 s per stepped frame, real
// pacing uncapped), a seeded Math.random, the readiness wait, map entry, scene cleanup, HUD helpers and the two
// scripted scenarios (`path`, `fight`). Nothing under src/ changes: everything is wrapped from here.
import { existsSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const OUT = resolve(ROOT, 'out');
export const PORT = 4173;
export const URL_BASE = `http://127.0.0.1:${PORT}/`;
export const MAPS = ['downtown', 'house', 'mexico', 'training'];
export const PRESETS = ['low', 'medium', 'high', 'ultra'];
export const VIEWPORT = { width: 1920, height: 1080 };
/** Real GPU through ANGLE Metal, uncapped: no vsync, no frame-rate limit. Precise heap numbers for the sampler. */
export const CHROME_ARGS = ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync',
  '--disable-frame-rate-limit', '--enable-precise-memory-info'];
export const SEED = 20261018;
export const LOADOUT = 'r4c,pistol,sword';

/**
 * Closed loops of walkable points per map (y is the floor), joined by nav paths in the page. Each starts at the
 * map's spawn. Training's loop circles the dummies (z = -20) at a distance.
 */
export const WAYPOINTS = {
  downtown: [[0, 0, 42], [6, 0, 36], [50.8, 0, 0], [0, 0, -50.8], [-50.8, 0, 0], [0, 0, 10], [-6, 0, 36]],
  house: [[0, 0, 21], [0, 0, 33.8], [18.2, 0, 26], [24.7, 0, -5.2], [0, 0, -35.1], [-18.2, 0, 18.2], [-2.6, 0, 5.85]],
  mexico: [[0, 0, 16], [23, 0.15, 23], [22, 0.15, 6.5], [20, 0.15, -14], [0, 0, -36], [-20, 0.15, 0], [-23, 0.15, 23]],
  training: [[0, 0, 10], [14, 0, 2], [14, 0, -8], [0, 0, -8], [-14, 0, -8], [-14, 0, 2]],
};

/**
 * The fight's roster: [frame, kinds, bearing (rad, 0 = the spawn's view, -Z), distance m]. Each pack stands
 * across the bearing 2.5 m apart, snapped to the nav grid; flyers 10 m up.
 */
export const ROSTER = [
  [0, ['grunt', 'grunt', 'grunt'], -0.6, 18],
  [120, ['heavy', 'shield', 'medic'], 0.5, 22],
  [240, ['bomber', 'rusher', 'rusher'], 0, 14],
  [360, ['flyer', 'flyer', 'grunt'], -1, 20],
  [480, ['sniper', 'breacher', 'smoker'], 0.9, 26],
  [600, ['grunt', 'heavy', 'rusher'], -0.35, 16],
  [720, ['carrier', 'shield', 'bomber'], 0.35, 20],
  [840, ['grunt', 'grunt', 'flyer'], 0, 12],
];

// ------------------------------------------------------------------ node side

/** Serve out/ on PORT (after `npm run build` with `build`). Fails if there is no build. */
export async function startServer({ build = false } = {}) {
  if (build) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('npm run build failed');
  }
  if (!existsSync(resolve(OUT, 'index.html'))) throw new Error(`no production build at ${OUT} (run npm run build, or pass --build)`);
  return serve(PORT, OUT);
}

export function git() {
  const run = cmd => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  // Dirty: any change outside perf/ (the harness itself and its results do not count).
  const status = run('git status --porcelain -- . ":!perf"');
  return { sha: run('git rev-parse HEAD'), branch: run('git rev-parse --abbrev-ref HEAD'), dirty: status === null ? null : status.length > 0 };
}

/** A fresh browser: a clean GPU process and a cold HTTP cache. */
export function launch({ headed = false } = {}) {
  return chromium.launch({ headless: !headed, args: CHROME_ARGS });
}

/**
 * A page for one cell: localStorage preset, music off, map, gore, loadout, and the in-page harness (`window.__perf`).
 * `enter` goes into the map on the first frame after the menu's first: 'solo' or 'training' (null: stay at the menu).
 * Returns { page, cdp, errors }.
 */
export async function openPage(browser, { preset, map, gore = 'full', enter = map === 'training' ? 'training' : 'solo', timer = false, profile = false } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // Errors kept once each, with a count.
  const errors = [], seen = new Map();
  const add = (type, text) => {
    const key = `${type}:${text}`, e = seen.get(key);
    if (e) { e.count++; return; }
    const entry = { type, text, count: 1 };
    seen.set(key, entry); errors.push(entry);
  };
  page.on('pageerror', e => add('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') add('console', m.text()); });
  page.on('crash', () => add('crash', 'page crashed'));
  await page.addInitScript(pageInit, { preset, map, menuMap: map === 'training' ? 'downtown' : map, gore, loadout: LOADOUT, enter, timer, profile,
    waypoints: WAYPOINTS[map] ?? null, roster: ROSTER });
  const cdp = await context.newCDPSession(page);
  return { page, cdp, errors };
}

/** Navigate and wait for the full readiness check (renderer idle, programs warm, realistic assets in). */
export async function loadAndWait(page, { timeout = 120_000 } = {}) {
  await page.goto(URL_BASE, { waitUntil: 'commit' });
  try {
    await page.waitForFunction(() => window.__perf?.load.readyMs != null, null, { timeout, polling: 200 });
  } catch (error) {
    const state = await page.evaluate(() => window.__perf?.readiness()).catch(() => null);
    throw new Error(`not ready after ${timeout} ms: ${JSON.stringify(state)}`);
  }
  return page.evaluate(() => window.__perf.load);
}

/** Wait `n` stepped (rendered) game frames. */
export const frames = (page, n) => page.evaluate(n => window.__perf.wait(n), n);
export const heapMB = async cdp => +((await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6).toFixed(2);
/** Hide every HUD element (screens, tips, messages, gameplay HUD) for a clean screenshot; `showHud` puts the play HUD back. */
export const hideHud = page => page.evaluate(() => window.__perf.hideHud());
export const showHud = page => page.evaluate(() => window.__perf.showHud());
/** Pause the game loop (frames still composite) / resume it. Steps run only while not held. */
export const hold = (page, on) => page.evaluate(on => { window.__perf.hold = on; }, on);

/**
 * Run `fn` under a Chrome trace of every process (browser CDP), and digest the scenario window (the page's
 * `perf:run:start`/`perf:run:end` marks): the game's rAF callbacks' thread CPU time (`tdur`: work, without the
 * waits), the main thread's waits on the GPU command buffer (it blocks when the ring is full: the GPU side is behind),
 * and per-frame CPU of the renderer main thread, the GPU process main thread and the display compositor.
 */
export async function traced(browser, fn) {
  const cdp = await browser.newBrowserCDPSession();
  const events = [];
  cdp.on('Tracing.dataCollected', e => { for (const v of e.value) events.push(v); });
  const complete = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'blink.user_timing', 'gpu', '__metadata'],
    recordMode: 'recordContinuously' }, transferMode: 'ReportEvents' });
  let result;
  try { result = await fn(); } finally {
    await cdp.send('Tracing.end');
    await complete;
    await cdp.detach().catch(() => {});
  }
  return { result, trace: digestTrace(events) };
}

function digestTrace(events) {
  const thread = new Map(), proc = new Map();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'thread_name') thread.set(`${e.pid}:${e.tid}`, e.args.name);
    if (e.name === 'process_name') proc.set(e.pid, e.args.name);
  }
  const mark = name => events.find(e => e.name === name && e.cat?.includes('blink.user_timing'));
  const start = mark('perf:run:start'), end = mark('perf:run:end');
  if (!start || !end) return { error: 'no run marks in the trace' };
  const lo = start.ts, hi = end.ts, main = `${start.pid}:${start.tid}`;
  const inWin = e => e.ph === 'X' && e.ts >= lo && e.ts + (e.dur ?? 0) <= hi;
  const raf = events.filter(e => inWin(e) && e.name === 'FireAnimationFrame' && `${e.pid}:${e.tid}` === main);
  const frames = raf.length || 1;
  const cpuOf = (pid, name) => {
    let t = 0;
    for (const e of events) {
      if (!inWin(e) || e.cat !== 'toplevel' || e.pid !== pid || thread.get(`${e.pid}:${e.tid}`) !== name) continue;
      t += e.tdur ?? 0;
    }
    return +(t / 1000 / frames).toFixed(3);
  };
  const gpuPid = [...proc].find(([, n]) => n === 'GPU Process')?.[0];
  let wait = 0;
  for (const e of events) if (inWin(e) && `${e.pid}:${e.tid}` === main && e.name === 'CommandBufferProxyImpl::WaitForGetOffset') wait += e.dur;
  return {
    frames: raf.length, windowMs: +((hi - lo) / 1000).toFixed(1),
    jsMs: stats(raf.map(e => (e.tdur ?? NaN) / 1000)), rafWallMs: stats(raf.map(e => e.dur / 1000)),
    waitMsPerFrame: +(wait / 1000 / frames).toFixed(3),
    rendererMainCpuPerFrame: cpuOf(start.pid, 'CrRendererMain'),
    gpuMainCpuPerFrame: gpuPid === undefined ? null : cpuOf(gpuPid, 'CrGpuMain'),
    vizCpuPerFrame: gpuPid === undefined ? null : cpuOf(gpuPid, 'VizCompositorThread'),
  };
}

export function stats(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q = p => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))];
  const r = x => +x.toFixed(3);
  return { med: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), mean: r(v.reduce((a, b) => a + b, 0) / v.length), max: r(v[v.length - 1]), n: v.length };
}
export const median = values => {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

// ------------------------------------------------------------------ page side

/**
 * Runs in the page before any of its scripts (addInitScript). Everything the harness needs lives on `window.__perf`.
 * Self-contained: no closure over node-side values (they arrive in `cfg`).
 */
export function pageInit(cfg) {
  const ls = window.localStorage;
  ls.setItem('cs6_gfx', JSON.stringify({ v: 1, preset: cfg.preset, custom: null, fpsCounter: false, auto: null }));
  ls.setItem('cs6_music', '0');
  ls.setItem('cs6_map', cfg.menuMap);
  ls.setItem('cs6_gore', cfg.gore);
  ls.setItem('cs6_loadout', cfg.loadout);

  const mulberry = seed => {
    let s = seed | 0;
    const next = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      next.calls++;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.calls = 0;
    return next;
  };
  // Seeded from the first script on, so what boot draws (the flat decals' shapes, names) is the same every load.
  Math.random = mulberry(cfg.bootSeed ?? 0x0b0075eed);
  const now = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window);
  const STEP_MS = 1000 / 60;
  /** The path loop takes this many frames whatever the run's length, so frame i is the same view in every run. */
  const PATH_LOOP_FRAMES = 900;
  const P = window.__perf = {
    cfg, now, STEP_MS,
    /** Virtual rAF time handed to every callback of a real frame; +1/60 s after each frame the game stepped. */
    vnow: null, stepped: false, renders: 0, steps: 0, skipped: 0, hold: false, lock: false,
    lastTs: -1, lastStepTs: null, gameCb: null,
    load: { liveMs: null, enteredMs: null, firstPlayableMs: null, readyMs: null, menuMap: cfg.menuMap },
    /** Run before the game's callback, once per stepped frame (scenario logic). */
    pre: null,
    /** After each stepped frame: (ts, cpuMs, frameMs). */
    hooks: [],
    info: { calls: 0, triangles: 0, points: 0, lines: 0 },
    rec: null, prof: null, path: null, lastResult: null,
    timer: null, timerStatus: { supported: false, reason: 'not set up' },
    log: [], trailEvery: 30,
  };

  // Pointer lock faked once in play (P.lock): headless cannot take it, and an unlocked match nags with a tip every 2.5 s.
  const lockDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true,
    get() { return P.lock && window.__game ? window.__game.ctx.renderer.three.domElement : lockDesc.get.call(this); } });

  // Timeouts set inside a rAF callback while a scenario runs (`P.virtualTimers`) run on the virtual clock: the game
  // starts an empty magazine's reload 250 ms after the last shot with `setTimeout` (weapons/gun.ts), which on real
  // time lands on a different frame each run.
  const realSetTimeout = window.setTimeout.bind(window), realClearTimeout = window.clearTimeout.bind(window);
  const vtimers = new Map();
  let vid = 1e9, inCb = false;
  P.virtualTimers = false;
  window.setTimeout = function (fn, ms = 0, ...args) {
    if (!inCb || !P.virtualTimers || typeof fn !== 'function') return realSetTimeout(fn, ms, ...args);
    const id = ++vid;
    vtimers.set(id, { due: P.vnow + Math.max(0, Number(ms) || 0), fn, args });
    return id;
  };
  window.clearTimeout = id => { if (!vtimers.delete(id)) realClearTimeout(id); };
  const fireTimers = () => {
    for (const [id, t] of [...vtimers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])) {
      if (t.due > P.vnow) break;
      vtimers.delete(id);
      try { t.fn(...t.args); } catch (error) { realSetTimeout(() => { throw error; }); }
    }
  };

  let prePending = false;
  const beginFrame = ts => {
    // Exact arithmetic, so every run hands the game the same dt bits: an integer base plus k/60 s rounded to 1/1024 ms,
    // k counted from the base (rebased at each scenario's start), never accumulated.
    if (P.vnow === null) { P.vbase = P.vnow = Math.round(ts); P.vk = 0; }
    else if (P.stepped) P.vnow = P.vbase + Math.round(++P.vk * STEP_MS * 1024) / 1024;
    else if (P.gameCb && !P.hold) P.skipped++;
    P.lastTs = ts; P.stepped = false;
    if (P.rng) Math.random = P.rng;
    if (vtimers.size > 0 && !P.hold) fireTimers();
    P.timer?.poll();
    if (P.cfg.enter && P.load.enteredMs === null && P.renders > 0 && window.__game) enter();
    if (P.pre && !prePending && !P.hold) { prePending = true; P.pre(); }
    if (P.rng) Math.random = streams.other;
  };
  // A frame begins at the game's own callback (once a frame), not at a new timestamp: on Low two frames can share
  // one (rAF times are coarsened to 0.1 ms and frames take 0.3 ms). Before the game's first frame, by timestamp.
  window.requestAnimationFrame = cb => raf(ts => {
    if (P.gameCb ? cb === P.gameCb : ts !== P.lastTs) beginFrame(ts);
    if (P.hold && cb === P.gameCb) { window.requestAnimationFrame(cb); return; }
    const before = P.renders, t0 = now();
    inCb = true;
    if (P.rng) Math.random = P.rng;
    try { cb(P.vnow); } finally {
      inCb = false;
      if (P.rng) Math.random = streams.other;
      if (P.renders !== before) {
        const t1 = now(), frameMs = P.lastStepTs === null ? NaN : ts - P.lastStepTs;
        P.gameCb = cb; P.stepped = true; P.steps++; prePending = false; P.lastStepTs = ts;
        for (const hook of P.hooks.slice()) hook(ts, t1 - t0, frameMs);
      }
    }
  });

  /** Resolves after `n` stepped frames. */
  P.wait = n => new Promise(resolve => {
    let left = n;
    const hook = () => { if (--left <= 0) { P.hooks.splice(P.hooks.indexOf(hook), 1); resolve(); } };
    P.hooks.push(hook);
  });

  // ---- install on the handle as GameMount sets it, before the game's first frame
  let handle;
  Object.defineProperty(window, '__game', { configurable: true, enumerable: true,
    get: () => handle,
    set(g) { handle = g; if (g) install(g); } });

  function install(g) {
    P.load.liveMs = now();
    const r = g.ctx.renderer, three = r.three, gl = three.getContext();
    three.info.autoReset = false;
    P.timer = makeTimer(gl);
    const render = r.render;
    r.render = function (...args) {
      P.renders++;
      three.info.reset();
      P.prof?.renderStart();
      const timed = P.timer?.enabled && !P.prof && P.rec !== null && !P.rec.done;
      if (timed) P.timer.begin(P.rec ? P.rec.n : -1);
      const saved = Math.random;
      if (P.rng) Math.random = streams.render;
      try { return render.apply(this, args); } finally {
        Math.random = saved;
        if (timed) P.timer.end();
        P.prof?.renderEnd();
        const i = three.info.render;
        P.info.calls = i.calls; P.info.triangles = i.triangles; P.info.points = i.points; P.info.lines = i.lines;
        const load = P.load;
        if (load.firstPlayableMs === null) { if (g.gs.state === 'play' && load.enteredMs !== null) load.firstPlayableMs = now(); }
        else if (load.readyMs === null && P.ready()) load.readyMs = now();
      }
    };
  }

  // ---- GPU timer: TIME_ELAPSED queries, pooled, read when available, dropped on a disjoint event
  function makeTimer(gl) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) { P.timerStatus = { supported: false, reason: 'EXT_disjoint_timer_query_webgl2 not available' }; return null; }
    P.timerStatus = { supported: true, reason: null };
    const free = [], pending = [];
    let open = null, taint = 0;
    const t = {
      enabled: !!P.cfg.timer, disjoint: 0, read: 0, zero: 0, sink: null,
      begin(tag) {
        if (open) t.end();
        const q = free.pop() ?? gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        open = { q, tag };
      },
      end() {
        if (!open) return;
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(open); open = null;
      },
      get pending() { return pending.length + (open ? 1 : 0); },
      poll() {
        if (pending.length === 0) return;
        let n = 0;
        while (n < pending.length && gl.getQueryParameter(pending[n].q, gl.QUERY_RESULT_AVAILABLE)) n++;
        if (n === 0) return;
        // A disjoint event (GPU reset, power change) voids every query in flight: these and the ones still pending.
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { t.disjoint++; taint = pending.length; }
        for (const { q, tag } of pending.splice(0, n)) {
          free.push(q);
          if (taint > 0) { taint--; t.sink?.(tag, null); continue; }
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          t.read++; if (ms === 0) t.zero++;
          t.sink?.(tag, ms);
        }
      },
    };
    return t;
  }

  // ---- readiness
  P.readiness = () => {
    const g = window.__game;
    if (!g) return { game: false };
    const r = g.ctx.renderer, realistic = g.quality.values.look === 'realistic';
    return { state: g.gs.state, preset: g.quality.preset, streaming: r.streaming, bakeFading: r.bakeFading, compiles: r._compiles.length,
      warmups: r._warmups.length, matchWarmups: matchWarmups(r), programsWarm: r._programsWarm, realistic, effectsRealistic: g.effects.realistic,
      weaponsReady: r.weapons.ready, sky: r.skyPending, bake: r.bakePending, textures: r.texturesPending, weapons: r.weaponsPending,
      operators: r.operatorsPending, props: r.props?.pending, fx: r.fx?.pending, renders: P.renders };
  };
  /**
   * In a live match the renderer draws only `inMatch` warm-ups (a glb landing after Start); the rest (the rig's view
   * models, the shadow probe, the sky probe, the effects' template) wait for the next menu by design (render/index.ts
   * `_drawWarmups`), so they are not waited for here: `deferredWarmups` counts them.
   */
  const matchWarmups = r => (r._match?.live ? r._warmups.filter(w => w.inMatch && !w.drawn).length : r._warmups.length);
  P.ready = () => {
    const g = window.__game, r = g.ctx.renderer;
    if (r.streaming || r.bakeFading || r._compiles.length + matchWarmups(r) > 0 || !r._programsWarm) return false;
    return g.quality.values.look !== 'realistic' || (g.effects.realistic === true && r.weapons.ready === true);
  };

  // ---- map entry and cleanup
  const V = () => window.__game.ctx.camera.position.constructor;
  function enter() {
    const g = window.__game;
    P.load.enteredMs = now();
    if (P.cfg.enter === 'training') g.beginTraining();
    else g.beginSolo();
    quiet();
  }
  /** Invulnerable player, no wave director, no wave spawns or drops, faked pointer lock. */
  function quiet() {
    const g = window.__game, p = g.player;
    p.takeDamage = () => {};
    p.knockback = () => {};
    P.lock = true;
    if (g.gs.mode === 'solo') {
      // The director: an empty queue and an intermission that never ends, its countdown kept off the HUD.
      g.gs.queue.length = 0; g.gs.intermission = 1e9;
      g.hud.setTimer('');
      g.hud.setTimer = () => {};
      g.enemies.clear();
    }
    clearPickups();
  }
  function clearPickups() {
    const list = window.__game.pickups;
    while (list.length > 0) list.pop().mesh?.removeFromParent();
  }
  P.quiet = quiet;

  /** Dynamic resolution pinned to 1 (boot reads `dynamic.update` every frame), and the facts the run depends on. */
  P.prepare = () => {
    const g = window.__game, r = g.ctx.renderer, gl = r.three.getContext();
    quiet();
    g.dynamic.update = () => 1;
    g.dynamic.scale = 1;
    r.setDynamicScale(1);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { preset: g.quality.preset, look: g.quality.values.look, fpsTarget: g.quality.values.fpsTarget, dynamicRes: g.quality.values.dynamicRes,
      renderScale: g.quality.values.renderScale, pixelRatio: r.three.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], sceneTarget: [r.post.target.width, r.post.target.height],
      msaa: r.post.target.samples, shadowEvery: r.sun.castShadow ? r._shadowEvery : null, deferredWarmups: r._warmups.length, level: g.ctx.level.key, mode: g.gs.mode, state: g.gs.state,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, timer: P.timerStatus, crossOriginIsolated: window.crossOriginIsolated };
  };
  P.dynamicScale = () => window.__game.ctx.renderer._dynamicScale;

  // ---- HUD
  P.hideHud = () => {
    const h = window.__game.hud;
    h.hideScreen(); h.tip('', 0); h.message('', '', 0); h.update(10); h.setGameplayVisible(false);
  };
  P.showHud = () => { const h = window.__game.hud; h.tip('', 0); h.message('', '', 0); h.setGameplayVisible(true); };

  // ---- seeded random: one stream for the simulation; audio and the renderer draw from their own, as their calls
  // depend on real time (an AudioContext's state, a program linking off the frame) and must not shift the simulation's.
  const streams = { audio: Math.random, render: Math.random, other: Math.random };
  const isolate = (obj, stream) => {
    if (!obj || obj.__perfIsolated) return;
    obj.__perfIsolated = true;
    for (let proto = Object.getPrototypeOf(obj); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, key);
        if (key === 'constructor' || typeof d?.value !== 'function' || Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const fn = d.value;
        obj[key] = function (...a) {
          const saved = Math.random;
          Math.random = streams[stream];
          try { return fn.apply(this, a); } finally { Math.random = saved; }
        };
      }
    }
  };
  P.seed = seed => {
    const g = window.__game;
    isolate(g.ctx.audio, 'audio');
    streams.audio = mulberry(seed ^ 0x5eed0a);
    streams.render = mulberry(seed ^ 0x5eed0b);
    // Everything outside the game's frame (promise and timer callbacks, the page's own UI) draws from `other`.
    streams.other = mulberry(seed ^ 0x5eed0c);
    Math.random = P.rng = mulberry(seed);
  };
  P.renderStream = () => streams.render;

  /** Operators go on only for figures out of view: a camera 500 m up, looking up, puts them on every new figure now. */
  P.wearOperators = () => {
    const g = window.__game, r = g.ctx.renderer;
    const away = g.ctx.camera.clone(false);
    away.position.y += 500;
    away.lookAt(away.position.x, away.position.y + 1, away.position.z);
    away.updateMatrixWorld();
    r.operators.frame(away);
  };

  /** The same start for every scenario: player at the map's start, nothing else in the world, clock and RNG reset. */
  P.reset = seed => {
    const g = window.__game, gs = g.gs, p = g.player;
    P.seed(seed);
    if (gs.mode === 'training') {
      // The mode's own reset: fresh dummies in their slots, the run's state cleared (Training has no breakables to rebuild).
      g.beginTraining();
      P.wearOperators();
    } else {
      g.enemies.clear(); g.effects.clear(); p.clearNades?.(); clearPickups();
      p.reset(g.ctx.level.playerStart);
      gs.time = 0; gs.hitstopT = 0; gs.score = gs.kills = gs.combo = gs.comboT = gs.katanaStreak = 0;
      gs.queue.length = 0; gs.intermission = 1e9;
      g.enemies.mods.speed = g.enemies.mods.damage = 1;
    }
    // Clocks and springs that run on from boot (so their phase depends on how long the load took): the screen-shake
    // noise and its springs, the view bob, the guns' recoil and model kicks, the shake accumulator.
    const zeroSprings = obj => {
      for (const v of Object.values(obj)) {
        if (!v || typeof v !== 'object' || !('k' in v) || !('d' in v) || !('vel' in v) || !('value' in v)) continue;
        for (const key of ['value', 'vel', 'target']) { if (typeof v[key] === 'number') v[key] = 0; else v[key]?.set?.(0, 0, 0); }
      }
    };
    p.shakeT = 0; p.bobPhase = 0;
    zeroSprings(p);
    for (const w of p.weapons) { zeroSprings(w); if (typeof w._sinceShot === 'number') w._sinceShot = 10; }
    g.effects.shake = 0; g.effects.shakePush = 0;
    if (typeof g.effects._thin === 'number') g.effects._thin = 0;
    // The crowd's separation runs every 0.05 s on a timer of the manager's own, which enemies.clear() keeps.
    g.enemies.sepT = 0;
    // The renderer's frame count: Low redraws its shadow map every other frame, and the effects dither on it mod 64.
    g.ctx.renderer._frame = 0;
    const real = g.effects._real;
    if (real) { if (typeof real._dryT === 'number') real._dryT = 0; if (typeof real._time === 'number') real._time = 0; }
    g.hud.tip('', 0); g.hud.message('', '', 0);
    Math.random = streams.other;
  };

  // ---- the nav point nearest a spot (or null)
  function snap(x, y, z, radius = 4) {
    const nav = window.__game.ctx.nav, Vec = V();
    for (const rr of [radius, radius * 2]) {
      const id = nav.nearest(new Vec(x, y, z), rr, 3), node = nav.nodes[id];
      if (node) return new Vec(node.x, node.y, node.z);
    }
    return null;
  }

  /** The path loop: nav paths between the waypoints, resampled every 0.25 m and smoothed. */
  P.buildPath = () => {
    const g = window.__game, nav = g.ctx.nav, Vec = V(), pts = [], warnings = [];
    const way = P.cfg.waypoints;
    for (let i = 0; i < way.length; i++) {
      const a = new Vec(...way[i]), b = new Vec(...way[(i + 1) % way.length]);
      const seg = nav.findPath(a, b);
      if (!seg || seg.length === 0) { warnings.push(`no path ${i}->${(i + 1) % way.length}`); continue; }
      if (!seg.complete) warnings.push(`incomplete path ${i}->${(i + 1) % way.length}`);
      for (const q of seg) if (!pts.length || pts[pts.length - 1].distanceTo(q) > 1e-3) pts.push(q);
    }
    // Uniform resample along the polyline, then a moving average (1.5 m each way) over the closed loop.
    const dense = [], spacing = 0.25;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], d = a.distanceTo(b), n = Math.max(1, Math.round(d / spacing));
      for (let k = 0; k < n; k++) dense.push(a.clone().lerp(b, k / n));
    }
    const w = 6, smooth = dense.map((_, i) => {
      const s = new Vec();
      for (let k = -w; k <= w; k++) s.add(dense[(i + k + dense.length) % dense.length]);
      return s.multiplyScalar(1 / (2 * w + 1));
    });
    let length = 0;
    const along = smooth.map((q, i) => (i === 0 ? 0 : (length += q.distanceTo(smooth[i - 1]))));
    length += smooth[smooth.length - 1].distanceTo(smooth[0]);
    P.path = { pts: smooth, along, length };
    return { points: smooth.length, length: +length.toFixed(1), warnings };
  };
  const pathAt = s => {
    const { pts, along, length } = P.path;
    s = ((s % length) + length) % length;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (along[mid] <= s) lo = mid; else hi = mid - 1; }
    const a = pts[lo], b = pts[(lo + 1) % pts.length], span = (lo + 1 < pts.length ? along[lo + 1] : length) - along[lo];
    return a.clone().lerp(b, span > 0 ? (s - along[lo]) / span : 0);
  };

  const aimAt = (p, to, k = 1) => {
    const d = to.clone().sub(p.eye), yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    let dy = yaw - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * k; p.pitch += (pitch - p.pitch) * k;
  };
  const centre = e => e.center ?? e.body.pos.clone().setY(e.body.pos.y + 1.2);
  /** The nearest living enemy the eye can see, else the nearest. */
  const nearest = p => {
    const world = window.__game.ctx.world;
    let best = null, bd = Infinity, seen = null, sd = Infinity;
    for (const e of window.__game.enemies.list) {
      if (!e.alive) continue;
      const d = e.body.pos.distanceTo(p.body.pos);
      if (d < bd) { bd = d; best = e; }
      if (d < sd && world.lineOfSight(p.eye, centre(e))) { sd = d; seen = e; }
    }
    return seen ?? best;
  };

  /** Spawn a pack at a bearing/distance from the map's start (fixed: the same nav points every run). */
  function spawnPack(kinds, bearing, dist) {
    const g = window.__game, start = g.ctx.level.playerStart, out = [];
    const fx = -Math.sin(bearing), fz = -Math.cos(bearing), sx = -fz, sz = fx;
    kinds.forEach((kind, j) => {
      const off = (j - (kinds.length - 1) / 2) * 2.5;
      let at = null;
      for (const k of [1, 0.8, 0.6, 0.4]) {
        at = snap(start.x + fx * dist * k + sx * off, start.y, start.z + fz * dist * k + sz * off);
        if (at) break;
      }
      if (!at) at = start.clone().setZ(start.z - 8);
      if (kind === 'flyer' || kind === 'carrier') at.y += 10;
      const e = g.enemies.spawn(kind, at);
      if (e) out.push(e);
    });
    P.wearOperators();
    return out;
  }

  /** A hash of the simulation's state (every enemy's position and health, the player's view): one per 30 frames in a run's `trail`. */
  P.stateHash = () => {
    const g = window.__game, p = g.player;
    let hash = 0;
    const mix = v => { hash = Math.imul(hash ^ Math.round(v * 1000), 2654435761) >>> 0; };
    for (const e of g.enemies.list) { mix(e.body.pos.x); mix(e.body.pos.y); mix(e.body.pos.z); mix(e.body.vel.x); mix(e.body.vel.z); mix(e.hp); }
    mix(p.body.pos.x); mix(p.body.pos.y); mix(p.body.pos.z); mix(p.yaw); mix(p.pitch); mix(g.gs.kills); mix(P.rng?.calls ?? 0);
    return hash.toString(16);
  };
  /** What two runs of the same cell must agree on. */
  P.summary = () => {
    const g = window.__game, fx = g.effects, p = g.player, alive = g.enemies.list.filter(e => e.alive);
    let hash = 0;
    const mix = v => { hash = (Math.imul(hash ^ Math.round(v * 1000), 2654435761) >>> 0); };
    for (const e of g.enemies.list) { mix(e.body.pos.x); mix(e.body.pos.y); mix(e.body.pos.z); mix(e.hp); }
    mix(p.body.pos.x); mix(p.body.pos.z); mix(p.yaw); mix(p.pitch);
    return { kills: g.gs.kills, score: g.gs.score, alive: alive.length, listed: g.enemies.list.length,
      particles: fx._particles?.length ?? null, debris: fx._debris?.length ?? null, tracers: fx._tracers?.length ?? null,
      gibs: fx._bloodyGibs ?? null, pickups: g.pickups.length, hash: hash.toString(16) };
  };

  // ---- the scripted runs: warm-up, idle window, path, fight
  const fightKinds = [...new Set(P.cfg.roster.flatMap(([, kinds]) => kinds))];
  const scripts = {
    /**
     * Every fight kind in a ring round the start, wearing operators; a full turn level with them, then a turn looking
     * up with fire held (flash, tracers, casings) so nothing in the map breaks before the path. The fight's own
     * warm-up (an unrecorded run of it) compiles impacts, blood, gibs and blasts.
     */
    warmup(frames) {
      const g = window.__game, p = g.player, down = g.input.down, half = Math.floor(frames / 2);
      let fire = false;
      return {
        start() {
          g.input.down = a => (a === 'fire' && fire) || down.call(g.input, a);
          fightKinds.forEach((kind, i) => spawnPack([kind], (i / fightKinds.length) * Math.PI * 2, 10));
        },
        pre(i) {
          const t = i < half ? i / half : (i - half) / (frames - half);
          p.yaw = t * Math.PI * 2;
          p.pitch = i < half ? 0.15 * Math.sin(t * Math.PI * 4) : 0.75;
          fire = i >= half;
          if (i % 60 === 0) p.addAmmoAll(0.5);
        },
        end() { g.input.down = down; },
      };
    },
    /** Standing still at the start: the uncapped frame rate check. */
    idle() {
      return { start() {}, pre() {}, end() {} };
    },
    /** The loop once in PATH_LOOP_FRAMES, facing the way of travel with a slow look sweep. No enemies (Training keeps its dummies). */
    path() {
      const g = window.__game, p = g.player;
      if (!P.path) P.buildPath();
      const speed = P.path.length / PATH_LOOP_FRAMES;
      let worstY = 0;
      return {
        start() {},
        pre(i) {
          const s = i * speed, at = pathAt(s), ahead = pathAt(s + 4);
          worstY = Math.max(worstY, Math.abs(p.body.pos.y - at.y));
          p.body.pos.copy(at); p.body.vel.set(0, 0, 0);
          p.yaw = Math.atan2(-(ahead.x - at.x), -(ahead.z - at.z)) + 0.5 * Math.sin((2 * Math.PI * i) / 240);
          p.pitch = -0.04 + 0.08 * Math.sin((2 * Math.PI * i) / 170);
        },
        end() { return { pathLength: +P.path.length.toFixed(1), speedMps: +(speed * 60).toFixed(2), worstYDrift: +worstY.toFixed(3) }; },
      };
    },
    /** The roster on its schedule, auto-aim at the nearest, fire held, a real grenade every 90 frames. */
    fight() {
      const g = window.__game, p = g.player, down = g.input.down;
      let fire = false, spawned = 0;
      return {
        start() { g.input.down = a => (a === 'fire' && fire) || down.call(g.input, a); },
        pre(i) {
          for (const [at, kinds, bearing, dist] of P.cfg.roster) if (at === i) spawned += spawnPack(kinds, bearing, dist).length;
          if (i % 60 === 0) p.addAmmoAll(0.5);
          const target = nearest(p);
          fire = target !== null;
          if (target) aimAt(p, centre(target), 0.35);
          if (i % 90 === 45) { p.grenades = 99; p.grenadeCd = 0; p.throwGrenade(); }
        },
        end() { g.input.down = down; return { spawned }; },
      };
    },
  };

  /**
   * Run one script for `frames` stepped frames from a reset start; resolves with the per-frame arrays.
   * opts: { seed, record, holdAt } (holdAt: stop stepping at that frame, for a screenshot; resume with P.release()).
   */
  P.run = (name, frames, opts = {}) => new Promise(resolve => {
    const g = window.__game, three = g.ctx.renderer.three;
    P.reset(opts.seed ?? 1);
    const script = scripts[name](frames);
    P.vbase = P.vnow; P.vk = 0;
    P.virtualTimers = true;
    script.start();
    const rec = P.rec = { n: 0, cpu: new Float64Array(frames), frame: new Float64Array(frames), gpu: new Float64Array(frames).fill(NaN),
      calls: new Float64Array(frames), triangles: new Float64Array(frames), points: new Float64Array(frames), lines: new Float64Array(frames),
      heapPeak: 0, skipped0: P.skipped, gpuDropped: 0, trail: [], streaming: 0, compiling: 0, programs0: three.info.programs?.length ?? 0 };
    if (P.timer) P.timer.sink = (tag, ms) => { if (tag >= 0 && tag < frames && P.rec === rec) { if (ms === null) rec.gpuDropped++; else rec.gpu[tag] = ms; } };
    P.prof?.begin(name);
    let i = 0;
    P.pre = () => { if (i === 0) performance.mark('perf:run:start'); script.pre(i); };
    const sampleHeap = () => { const m = performance.memory; if (m) rec.heapPeak = Math.max(rec.heapPeak, m.usedJSHeapSize); };
    const hook = (ts, cpu, frameMs) => {
      rec.cpu[i] = cpu; rec.frame[i] = frameMs;
      rec.calls[i] = P.info.calls; rec.triangles[i] = P.info.triangles; rec.points[i] = P.info.points; rec.lines[i] = P.info.lines;
      if (i % 30 === 0) sampleHeap();
      const r = g.ctx.renderer;
      if (r.streaming) rec.streaming++;
      if (r._compiles.length > 0) rec.compiling++;
      if (i % P.trailEvery === 0) rec.trail.push(P.stateHash());
      rec.n = ++i;
      if (opts.holdAt !== undefined && i === opts.holdAt) { P.hold = true; resolve({ held: i }); }
      if (i < frames) return;
      performance.mark('perf:run:end');
      P.pre = null; rec.done = true;
      P.hooks.splice(P.hooks.indexOf(hook), 1);
      sampleHeap();
      const extra = script.end() ?? {};
      const summary = P.summary(), info = three.info;
      // Let the last queries land (a few frames, recording off) before handing the arrays back.
      let waitLeft = 30;
      const finish = () => {
        if (P.timer && P.timer.pending > 0 && waitLeft-- > 0) { P.wait(1).then(finish); return; }
        P.rec = null;
        const prof = P.prof?.end() ?? null;
        resolve(P.lastResult = { frames, cpu: [...rec.cpu], frame: [...rec.frame], gpu: [...rec.gpu], calls: [...rec.calls], triangles: [...rec.triangles],
          points: [...rec.points], lines: [...rec.lines], trail: rec.trail, streamingFrames: rec.streaming, compilingFrames: rec.compiling,
          newPrograms: (info.programs?.length ?? 0) - rec.programs0, gpuDropped: rec.gpuDropped, skipped: P.skipped - rec.skipped0,
          programs: info.programs?.length ?? null, geometries: info.memory.geometries, textures: info.memory.textures,
          heapPeakMB: +(rec.heapPeak / 1e6).toFixed(2), dynamicScale: P.dynamicScale(), summary, ...extra, profile: prof });
      };
      finish();
    };
    P.hooks.push(hook);
  });
  P.release = () => { P.hold = false; };
  /** The scripts P.run knows, so a caller (perf/quality.mjs) can add its own. */
  P.scripts = scripts;
  /**
   * From a held loop: step exactly `n` game frames (each 1/60 s on the virtual clock), then hold again. Resolves
   * after the n-th frame's render, before the next frame can begin: the canvas keeps that frame.
   */
  P.advance = n => new Promise(resolve => {
    let left = n;
    const hook = () => { if (--left <= 0) { P.hold = true; P.hooks.splice(P.hooks.indexOf(hook), 1); resolve(P.steps); } };
    P.hooks.push(hook);
    P.hold = false;
  });
  /**
   * Nothing left that lands on a later frame by real time: no streaming, no bake fade, no held compile, and no
   * warm-up draw due in the current state (a live match draws only `inMatch` ones; out of one, all of them).
   */
  P.settled = () => {
    const r = window.__game.ctx.renderer;
    return !r.streaming && !r.bakeFading && r._compiles.length === 0 && matchWarmups(r) === 0 && r._programsWarm;
  };

  /**
   * GPU timer calibration: a fullscreen pass of known, heavy fragment work (`iterations` of sin/cos per pixel into a
   * private 1920x1080 target) added to every frame (on), or removed (off). Its cost lands in the frame interval once
   * the GPU is the limit; a timer that reads GPU busy time grows by the same amount.
   */
  P.calibrate = (on, iterations = 300) => {
    const r = window.__game.ctx.renderer, post = r.post;
    if (!on) {
      if (P._calib) { post.draw = P._calib.draw; P._calib.material.dispose(); P._calib.target.dispose(); P._calib = null; }
      return;
    }
    if (P._calib) return;
    const material = new post._final.constructor({
      uniforms: { n: { value: iterations } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform float n; void main() { vec2 u = gl_FragCoord.xy; float a = 0.0;
        for (int i = 0; i < 4000; i++) { if (float(i) >= n) break; a += sin(u.x * 0.01 + float(i)) * cos(u.y * 0.013 + a); }
        gl_FragColor = vec4(a, 0.0, 0.0, 1.0); }`,
    });
    material.name = 'perf:calibration';
    const target = new post.target.constructor(1920, 1080), draw = post.draw;
    post.draw = function (...a) { post._pass(r.three, material, target); return draw.apply(this, a); };
    P._calib = { material, target, draw };
  };

  // ---- --profile: per-pass GPU segments (one query open at a time) and CPU per sub-step
  P.installProfile = () => {
    const g = window.__game, r = g.ctx.renderer, three = r.three, post = r.post, scene = r.scene;
    const timer = P.timer;
    let cur = null;          // { gpu: {seg: [sum, n]}, cpu: {...}, frames, pendingByFrame }
    let frame = -1, inRender = false, inMain = false, inSmaa = false;
    let tRender = 0, tMainStart = 0;
    const cpuAdd = (k, ms) => { if (cur && inFrame()) cur.cpuFrame[k] = (cur.cpuFrame[k] ?? 0) + ms; };
    /** Passes drawn per frame, by name: what the ablation can switch off (`P.ablate`: skip that pass, `shadows`, `soft` or `smaa`). */
    const count = name => { if (cur && inFrame()) cur.census[name] = (cur.census[name] ?? 0) + 1; };
    P.ablate = null;
    const inFrame = () => P.rec !== null && !P.rec.done;
    const seg = name => { if (cur && timer?.enabled && inRender) timer.begin({ frame, name }); };
    const wrapCpu = (obj, key, label) => {
      const fn = obj[key];
      obj[key] = function (...a) { const t = now(); try { return fn.apply(this, a); } finally { cpuAdd(label, now() - t); } };
    };
    wrapCpu(g.player, 'update', 'player.update');
    wrapCpu(g.enemies, 'update', 'enemies.update');
    wrapCpu(g.effects, 'update', 'effects.update');
    wrapCpu(g.hud, 'update', 'hud.update');
    const threeRender = three.render;
    three.render = function (s, c) {
      if (!(inRender && s === scene && !inMain)) return threeRender.call(this, s, c);
      inMain = true; tMainStart = now(); cpuAdd('render.pre', tMainStart - tRender); seg('scene');
      try { return threeRender.call(this, s, c); } finally {
        inMain = false; cpuAdd('render.main', now() - tMainStart); seg('post:other');
      }
    };
    const shadowRender = three.shadowMap.render;
    three.shadowMap.render = function (...a) {
      if (!inMain || !three.shadowMap.needsUpdate) return shadowRender.apply(this, a);
      count('shadows');
      if (P.ablate === 'shadows') return;
      const t = now(); seg('shadows');
      try { return shadowRender.apply(this, a); } finally { cpuAdd('render.shadows', now() - t); seg('scene'); }
    };
    const wrapPost = (key, name) => {
      const fn = post[key];
      post[key] = function (...a) {
        const t = now(), label = typeof name === 'function' ? name(...a) : name;
        if (label) { count(label); if (label === P.ablate) return; }
        if (label) seg(label);
        try { return fn.apply(this, a); } finally {
          if (key === 'draw' || key === 'drawSoft') cpuAdd('render.post', now() - t);
          if (label) seg('post:other');
        }
      };
    };
    wrapPost('drawSoft', 'soft');
    wrapPost('draw', null);
    wrapPost('_pass', (renderer, material) => (inSmaa ? null : material.name || 'post:unnamed'));
    const aa = post._antialias;
    post._antialias = function (...a) {
      count('smaa');
      if (P.ablate === 'smaa') return;
      seg('smaa'); inSmaa = true;
      try { return aa.apply(this, a); } finally { inSmaa = false; seg('post:other'); }
    };
    P.prof = {
      renderStart() { if (!cur || !inFrame()) return; inRender = true; frame = P.rec.n; tRender = now(); seg('pre'); },
      renderEnd() {
        if (!inRender) return;
        timer?.end(); inRender = false;
        cpuAdd('render.total', now() - tRender);
      },
      begin(name) {
        cur = { name, gpu: {}, gpuFrames: new Map(), cpu: {}, cpuFrames: 0, cpuFrame: {}, census: {} };
        if (timer) timer.sink = (tag, ms) => {
          if (!cur || typeof tag !== 'object') return;
          const f = cur.gpuFrames.get(tag.frame) ?? { segs: {}, bad: false };
          if (ms === null) f.bad = true; else f.segs[tag.name] = (f.segs[tag.name] ?? 0) + ms;
          cur.gpuFrames.set(tag.frame, f);
        };
        // CPU sums per frame: added after each stepped frame.
        cur.hook = (ts, cpu) => {
          if (!inFrame()) return;
          const f = cur.cpuFrame ?? {};
          f['frame.cpu'] = cpu;
          for (const [k, v] of Object.entries(f)) cur.cpu[k] = (cur.cpu[k] ?? 0) + v;
          cur.cpuFrames++; cur.cpuFrame = {};
        };
        P.hooks.unshift(cur.hook);
      },
      end() {
        if (!cur) return null;
        P.hooks.splice(P.hooks.indexOf(cur.hook), 1);
        const gpu = {};
        let n = 0;
        for (const f of cur.gpuFrames.values()) {
          if (f.bad) continue;
          n++;
          for (const [k, v] of Object.entries(f.segs)) gpu[k] = (gpu[k] ?? 0) + v;
        }
        const avg = (o, d) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / Math.max(1, d)).toFixed(4)]).sort((a, b) => b[1] - a[1]));
        const cpu = avg(cur.cpu, cur.cpuFrames);
        const known = ['player.update', 'enemies.update', 'effects.update', 'hud.update', 'render.total'].reduce((s, k) => s + (cpu[k] ?? 0), 0);
        cpu['other(step)'] = +((cpu['frame.cpu'] ?? 0) - known).toFixed(4);
        const gpuAvg = avg(gpu, n);
        gpuAvg.total = +Object.values(gpuAvg).reduce((a, b) => a + b, 0).toFixed(4);
        const census = Object.fromEntries(Object.entries(cur.census).map(([k, v]) => [k, +(v / Math.max(1, cur.cpuFrames)).toFixed(2)]));
        const out = { gpuFrames: n, gpuQuerySpans: n > 0 ? gpuAvg : null, cpuFrames: cur.cpuFrames, cpu, passesPerFrame: census };
        cur = null;
        return out;
      },
    };
  };
}

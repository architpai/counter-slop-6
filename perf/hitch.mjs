// First-use shader compiles after readiness, and the frame hitch they cost a real player (Round 7 lead 1a).
//   node perf/hitch.mjs find    [--maps a,b] [--presets a,b] [--order bench|direct] [--out DIR] [--label NAME]
//   node perf/hitch.mjs measure [--maps training] [--presets high,ultra] [--repeat 3] [--frames 120]
//                               [--outs head=DIR,new=DIR] [--label NAME]
// Runs on a production build (`out/`, or the given export dirs) under the heavy lock, one fresh browser per load.
// Every program three creates after the page's readiness check passed (`__perf.load.readyMs`) is logged with the
// step and frame it appeared in, its type / name / cacheKey head, and the object and material that asked for it
// (three's `renderBufferDirect` or `compile`; a shadow pass is flagged). Programs are tracked by identity, so a
// program freed and re-linked counts again.
//   find --order bench:  the bench's order (warmup, idle, path, fight warm-up (seed+1), fight), as perf/bench.mjs.
//   find --order direct: straight into the fight after ready (what a player meets first), then the path.
//   measure: per build, alternating per load (round r: every build once, the order rotating), straight into the
//            fight: over its first `frames` stepped frames (callback 0, the run's reset, left out) the frame time
//            (rAF to rAF, as bench `frameMs`): max, p99, p95, median, frames over 33 / 50 ms; the callbacks' wall time
//            (`cpu`, as bench); every program created, with its callback's cpu and frame time; program counts at
//            ready, after the fight, and after a bench-order fight warm-up + fight; readyMs, the `warmups` /
//            `compiles` phases and the last readiness flags to finish (load.phases); the raw per-frame arrays.
// Writes perf/results/scratch-hitch-<label>.json (gitignored) and prints a summary.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MAPS, PORT, PRESETS, ROOT, SEED, launch, loadAndWait, openPage, stats } from './lib.mjs';
import { serve } from './serve.mjs';

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
if (!['find', 'measure'].includes(mode)) { console.error('usage: node perf/hitch.mjs find|measure [options]'); process.exit(2); }
const cfg = {
  maps: opt('maps', mode === 'find' ? MAPS.join(',') : 'training').split(','),
  presets: opt('presets', mode === 'find' ? PRESETS.join(',') : 'high,ultra').split(','),
  order: opt('order', 'bench'),
  repeat: Number(opt('repeat', mode === 'find' ? 1 : 3)),
  frames: Number(opt('frames', 120)),
  label: opt('label', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)),
  outs: Object.fromEntries((opt('outs', `cur=${opt('out', resolve(ROOT, 'out'))}`)).split(',').map(s => s.split('='))),
};

/** Page side (an init script after lib.mjs `pageInit`): the program log. */
function hitchInit() {
  const P = window.__perf;
  const H = window.__hitch = { step: 'boot', atReady: null, log: [], released: 0, installed: false, perFrame: null };
  let cur = null, three = null;
  const describe = (object, material) => {
    const chain = [];
    for (let n = object; n && chain.length < 5; n = n.parent) chain.push(`${n.type}${n.name ? `:${n.name}` : ''}`);
    const m = material ?? {};
    return { object: chain.join(' < '), material: `${m.type ?? '?'}${m.name ? `:${m.name}` : ''}#${m.id ?? '?'}`,
      defines: m.defines ? Object.keys(m.defines).join(',') : '', userData: m.userData ? JSON.stringify(m.userData).slice(0, 160) : '' };
  };
  const hashOf = s => { let h = 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0; return h.toString(16); };
  function install() {
    const g = window.__game, r = g.ctx.renderer;
    three = r.three;
    const programs = three.info.programs;
    const seen = new WeakSet(programs);
    const push = programs.push;
    programs.push = function (...ps) {
      for (const p of ps) {
        if (seen.has(p)) continue;
        seen.add(p);
        if (H.atReady === null) continue;
        const target = three.getRenderTarget();
        H.log.push({ step: H.step, frame: P.rec ? P.rec.n : null, renders: P.renders, ms: +P.now().toFixed(1), id: p.id, type: p.type, name: p.name,
          key: hashOf(p.cacheKey), keyHead: p.cacheKey.slice(0, 240), keyLen: p.cacheKey.length, cacheKey: p.cacheKey, via: cur?.via ?? 'other', shadow: !!cur?.shadow,
          target: target ? `${target.width}x${target.height}${target.isWebGLCubeRenderTarget ? ' cube' : ''}` : 'canvas',
          ...(cur?.object || cur?.material ? describe(cur.object, cur.material) : {}), compileRoot: cur?.root ? describe(cur.root, null).object : undefined });
      }
      return push.apply(this, ps);
    };
    const rbd = three.renderBufferDirect;
    three.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const prev = cur;
      cur = { via: prev?.shadow ? 'shadow' : 'draw', shadow: !!prev?.shadow, object, material };
      try { return rbd.apply(this, arguments); } finally { cur = prev; }
    };
    const compile = three.compile;
    three.compile = function (scene, camera, target) {
      const prev = cur;
      cur = { via: 'compile', root: scene };
      try { return compile.apply(this, arguments); } finally { cur = prev; }
    };
    const shadowRender = three.shadowMap.render;
    three.shadowMap.render = function (...a) {
      const prev = cur;
      cur = { via: 'shadow', shadow: true };
      try { return shadowRender.apply(this, a); } finally { cur = prev; }
    };
    H.installed = true;
  }
  P.hooks.push((ts, cpu, frameMs) => {
    if (!H.installed && window.__game) install();
    if (H.atReady === null && P.load.readyMs !== null && three) {
      H.atReady = three.info.programs.length;
      H.readyRenders = P.renders;
    }
    if (H.perFrame && P.rec) H.perFrame.push({ n: P.rec.n, frameMs, programs: three.info.programs.length });
  });
  H.count = () => three.info.programs.length;
  H.list = () => three.info.programs.map(p => ({ id: p.id, type: p.type, name: p.name, key: hashOf(p.cacheKey), cacheKey: p.cacheKey }));
}

async function withServer(dir, fn) {
  const server = await serve(PORT, dir);
  try { return await fn(); } finally { await new Promise(r => server.close(r)); }
}

async function load(map, preset) {
  const browser = await launch();
  const { page, errors } = await openPage(browser, { map, preset });
  await page.addInitScript(hitchInit);
  const loaded = await loadAndWait(page);
  // The hook snapshots the count on the first stepped frame after ready; wait for it.
  await page.waitForFunction(() => window.__hitch?.atReady !== null, null, { polling: 50 });
  const facts = await page.evaluate(() => window.__perf.prepare());
  if (facts.preset !== preset || facts.level !== map) throw new Error(`wrong cell ${facts.preset}/${facts.level}`);
  const run = (name, frames, seed = SEED) => page.evaluate(([n, f, s]) => { window.__hitch.step = n; return window.__perf.run(n, f, { seed: s }); }, [name, frames, seed]);
  return { browser, page, errors, loaded, run };
}

const phase = (loaded, k) => { const f = loaded.phases?.flags?.[k]; return f ? { on: f.on, off: f.off, frames: f.frames } : null; };
const brief = e => `${e.step}#${e.frame ?? '-'} ${e.type}${e.name ? `:${e.name}` : ''} key ${e.key} via ${e.via}${e.shadow ? ' (shadow)' : ''} ${e.material ?? ''} [${e.object ?? e.compileRoot ?? ''}] target ${e.target}`;

async function find(map, preset) {
  const { browser, page, errors, loaded, run } = await load(map, preset);
  try {
    const counts = { ready: await page.evaluate(() => window.__hitch.atReady) };
    const steps = cfg.order === 'bench'
      ? [['warmup', 240, SEED], ['idle', 120, SEED], ['path', 900, SEED], ['fight', 240, SEED + 1], ['fight', 900, SEED]]
      : [['fight', 900, SEED], ['path', 900, SEED]];
    for (const [name, frames, seed] of steps) {
      await run(name, frames, seed);
      counts[`${name}${seed === SEED + 1 ? '-warm' : ''}`] = await page.evaluate(() => window.__hitch.count());
    }
    const log = await page.evaluate(() => window.__hitch.log);
    const programs = await page.evaluate(() => window.__hitch.list());
    return { map, preset, order: cfg.order, readyMs: loaded.readyMs, counts, log, programs, errors };
  } finally { await browser.close(); }
}

async function measure(map, preset, build) {
  const { browser, page, errors, loaded, run } = await load(map, preset);
  try {
    const atReady = await page.evaluate(() => window.__hitch.atReady);
    await page.evaluate(() => { window.__hitch.perFrame = []; window.__hitch.log.length = 0; });
    const raw = await run('fight', cfg.frames, SEED);
    const perFrame = await page.evaluate(() => { const p = window.__hitch.perFrame; window.__hitch.perFrame = null; return p; });
    const log = await page.evaluate(() => window.__hitch.log.splice(0));
    const afterFight = await page.evaluate(() => window.__hitch.count());
    // Then what the bench sees: its fight warm-up and a fight (the recorded run's count).
    await run('fight', 240, SEED + 1);
    await run('fight', 900, SEED);
    const afterBench = await page.evaluate(() => window.__hitch.count());
    const later = await page.evaluate(() => window.__hitch.log.splice(0));
    // frame[0] holds an interval from before the run's reset, frame[1] callback 0's work (the reset itself: Training
    // rebuilds its dummies, the first pack spawns): both left out. frames[k] is the interval that holds callback k + 1.
    const frames = raw.frame.slice(2);
    const s = stats(frames);
    // A program made in callback n: its wall time is cpu[n]; the rAF interval holding that callback is frame[n + 1].
    const compiles = log.map(e => ({ frame: e.frame, cpuMs: e.frame !== null ? +(raw.cpu[e.frame] ?? NaN).toFixed(1) : null,
      frameMs: e.frame !== null ? +(raw.frame[e.frame + 1] ?? NaN).toFixed(1) : null, what: brief(e) }));
    const cpu = stats(raw.cpu.slice(1));
    return { map, preset, build, readyMs: loaded.readyMs, firstPlayableMs: loaded.firstPlayableMs,
      phases: { warmups: phase(loaded, 'warmups'), compiles: phase(loaded, 'compiles'), programsCold: phase(loaded, 'programsCold'),
        deferredWarmupsAtReady: loaded.phases?.deferredWarmupsAtReady ?? null, window: loaded.phases?.window ?? null },
      programs: { ready: atReady, afterFight, afterBench, newInFight: log.length, newLater: later.length },
      frame: { max: s.max, p99: s.p99, p95: s.p95, med: s.med, mean: s.mean, over33: frames.filter(x => x > 33.3).length, over50: frames.filter(x => x > 50).length,
        top5: [...frames.map((ms, i) => [i + 2, +ms.toFixed(1)])].sort((a, b) => b[1] - a[1]).slice(0, 5) },
      cpu: { max: cpu.max, p99: cpu.p99, med: cpu.med, top3: [...raw.cpu.map((ms, i) => [i, +ms.toFixed(1)])].slice(1).sort((a, b) => b[1] - a[1]).slice(0, 3) },
      raw: { frame: raw.frame.map(x => +x.toFixed(2)), cpu: raw.cpu.map(x => +x.toFixed(2)) },
      lastFlags: Object.entries(loaded.phases?.flags ?? {}).filter(([, f]) => f.off !== null).sort((a, b) => b[1].off - a[1].off).slice(0, 3).map(([k, f]) => `${k} ${f.off}`),
      compiles, later: later.map(brief), perFrameHead: perFrame.slice(0, 12), errors };
  } finally { await browser.close(); }
}

const results = [];
await mkdir(resolve(ROOT, 'perf/results'), { recursive: true });
const file = resolve(ROOT, `perf/results/scratch-hitch-${cfg.label}.json`);
const save = () => writeFile(file, JSON.stringify({ mode, cfg, date: new Date().toISOString(), results }, null, 1));
if (mode === 'find') {
  const [dir] = Object.values(cfg.outs);
  await withServer(dir, async () => {
    for (const map of cfg.maps) for (const preset of cfg.presets) {
      let r;
      try { r = await find(map, preset); } catch (error) { r = { map, preset, failed: String(error?.stack ?? error) }; }
      results.push(r); await save();
      if (r.failed) { console.log(`${map}/${preset}: FAILED ${r.failed.split('\n')[0]}`); continue; }
      console.log(`${map}/${preset} (${cfg.order}): programs ${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', ')}; ${r.log.length} new after ready`);
      for (const e of r.log) console.log(`  ${brief(e)}`);
    }
  });
} else {
  const builds = Object.entries(cfg.outs);
  for (let round = 0; round < cfg.repeat; round++) {
    for (const map of cfg.maps) for (const preset of cfg.presets) {
      for (let k = 0; k < builds.length; k++) {
        const [build, dir] = builds[(k + round) % builds.length];
        let r;
        try { r = await withServer(dir, () => measure(map, preset, build)); } catch (error) { r = { map, preset, build, failed: String(error?.stack ?? error) }; }
        r.round = round;
        results.push(r); await save();
        if (r.failed) { console.log(`r${round} ${build} ${map}/${preset}: FAILED ${r.failed.split('\n')[0]}`); continue; }
        console.log(`r${round} ${build} ${map}/${preset}: ready ${Math.round(r.readyMs)} ms, programs ready/fight/bench ${r.programs.ready}/${r.programs.afterFight}/${r.programs.afterBench}; `
          + `first ${cfg.frames} fight frames max ${r.frame.max} p99 ${r.frame.p99} p95 ${r.frame.p95} med ${r.frame.med} ms, >33 ${r.frame.over33}; `
          + `cpu max ${r.cpu.max} ms (${r.cpu.top3.map(([i, ms]) => `#${i} ${ms}`).join(', ')}); `
          + `compiles ${r.compiles.map(c => `#${c.frame} (cpu ${c.cpuMs}, frame ${c.frameMs} ms)`).join(' ') || 'none'}; later ${r.programs.newLater}`);
        for (const c of r.compiles) console.log(`    ${c.what}`);
      }
    }
  }
  // Medians per build x cell.
  const med = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] * 0.5 + s[s.length >> 1] * 0.5 : null; };
  console.log('\n| build | cell | loads | ready ms | programs ready / fight / bench | max frame ms (each load) | p99 | p95 | med | max cpu ms | compile frames (cpu ms) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const map of cfg.maps) for (const preset of cfg.presets) for (const [build] of builds) {
    const rs = results.filter(r => !r.failed && r.map === map && r.preset === preset && r.build === build);
    if (!rs.length) continue;
    const m = f => +(med(rs.map(f)) ?? NaN).toFixed(1);
    console.log(`| ${build} | ${map}/${preset} | ${rs.length} | ${m(r => r.readyMs)} | ${rs.map(r => `${r.programs.ready}/${r.programs.afterFight}/${r.programs.afterBench}`).join(', ')} | `
      + `${m(r => r.frame.max)} (${rs.map(r => r.frame.max).join(', ')}) | ${m(r => r.frame.p99)} | ${m(r => r.frame.p95)} | ${m(r => r.frame.med)} | `
      + `${m(r => r.cpu.max)} (${rs.map(r => r.cpu.max).join(', ')}) | ${rs.map(r => r.compiles.map(c => `#${c.frame} (${c.cpuMs})`).join(' ') || '-').join('; ')} |`);
  }
}
console.log(`\n${file}`);

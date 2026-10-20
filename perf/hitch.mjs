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
//   node perf/hitch.mjs load  [--maps a,b] [--presets a,b] [--repeat 3] [--outs head=DIR,new=DIR] [--label NAME]
//   load (Round 8): per build, alternating per load as measure, every frame from the match's start to 60 frames past
//            ready: its rAF interval (the one holding the callback's work: to the next rendered frame's rAF time),
//            the renderer's wall time, and what the renderer did in it: a sky landing step (bg / env / look), an
//            upload slot taken (`_uploadAt` moved), held compiles run, warm-up draws (root name, in-match or not,
//            with the shadow maps or not), programs created; per load the frames over 50 ms with their events and
//            every warm-up draw with the slot / sky step it shared its frame with (`shared`).
//   node perf/hitch.mjs sweep [--maps a,b] [--presets a,b] [--parts guns,sword,enemies,bosses,solo] [--out DIR] [--label NAME]
//   sweep (Round 8): after ready, content the bench never touches, one step at a time, every program created
//            logged with its step (as find): guns (every loadout gun in turn: hip fire, aim/scope, reload; the rifles
//            with each optic), sword (ground slashes, guard, blood, air-slash waves, an execution), enemies (the kinds
//            outside the bench roster: turret, packleader, rubberbander, sapper, parry; specials act, then die),
//            bosses (each boss kind), solo (outside training: the director's boss wave 5 with pickups and stragglers).
//            Fresh browser per cell; the default loadout comes back after the guns.
//            [--check zero]: every step must add no program (and none may fail); [--expect FILE]: the program count at
//            ready and after every step must equal FILE's (an earlier sweep's JSON) cell by cell. Exit code 1 on a fail.
// Writes perf/results/scratch-hitch-<label>.json (gitignored) and prints a summary.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MAPS, PORT, PRESETS, ROOT, SEED, launch, loadAndWait, openPage, stats } from './lib.mjs';
import { serve } from './serve.mjs';

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
if (!['find', 'measure', 'load', 'sweep'].includes(mode)) { console.error('usage: node perf/hitch.mjs find|measure|load|sweep [options]'); process.exit(2); }
const everyCell = mode === 'find' || mode === 'sweep';
const cfg = {
  maps: opt('maps', everyCell ? MAPS.join(',') : mode === 'load' ? 'downtown,house,mexico' : 'training').split(','),
  presets: opt('presets', everyCell ? PRESETS.join(',') : mode === 'load' ? 'medium,high,ultra' : 'high,ultra').split(','),
  parts: opt('parts', 'guns,sword,enemies,bosses,solo').split(','),
  order: opt('order', 'bench'),
  repeat: Number(opt('repeat', everyCell ? 1 : 3)),
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

/**
 * Page side for `load` (an init script after lib.mjs `pageInit`): every renderer frame from the match's start until
 * `extra` frames past ready, with what the renderer did in it. Installed on the handle right after `pageInit`'s
 * install (its `render` wrapper inside this one), so the first frame is recorded too. Read-only.
 */
function loadTraceInit() {
  const P = window.__perf;
  const T = window.__trace = { frames: [], done: false, after: 0, extra: 60, error: null };
  const handle = Object.getOwnPropertyDescriptor(window, '__game');
  Object.defineProperty(window, '__game', { configurable: true, enumerable: true, get: handle.get,
    set(g) { handle.set.call(window, g); if (g) { try { install(g); } catch (error) { T.error = String(error?.stack ?? error); } } } });
  const skyState = r => { const l = r._skyLanding; return l ? (l.env ? 'env' : l.uploaded ? 'bg' : 'wait') : 'none'; };
  function install(g) {
    const r = g.ctx.renderer, three = r.three, m = r._match;
    let cur = null;
    const render = r.render;
    r.render = function (...args) {
      if (T.done) return render.apply(this, args);
      const t0 = P.now();
      cur = { ts: P.lastTs, t0, live: m.live, quiet: m.live && m.quiet(t0), slotAt: r._uploadAt, sky: null, compiles: 0, warm: [],
        programs0: three.info.programs?.length ?? 0, skipped: P.skipped };
      try { return render.apply(this, args); } finally {
        const f = cur;
        cur = null;
        f.ms = P.now() - t0;
        f.programs = (three.info.programs?.length ?? 0) - f.programs0;
        f.slot = r._uploadAt !== f.slotAt && r._uploadAt !== Infinity;
        f.ready = P.load.readyMs !== null;
        delete f.slotAt; delete f.programs0;
        if (m.live || f.ready || T.frames.length > 0) T.frames.push(f);
        if (f.ready && ++T.after >= T.extra) T.done = true;
      }
    };
    const wrap = (name, around) => {
      const fn = r[name];
      r[name] = function (...a) { return around(() => fn.apply(this, a)); };
    };
    wrap('_landSky', call => {
      const before = skyState(r), out = call(), after = skyState(r);
      if (cur && before !== after) cur.sky = before === 'wait' ? 'bg' : before === 'bg' ? 'env' : before === 'env' && after === 'none' ? 'look' : `${before}>${after}`;
      return out;
    });
    wrap('_runCompiles', call => {
      const before = r._compiles.length, out = call();
      if (cur) cur.compiles += before - r._compiles.length;
      return out;
    });
    wrap('_drawWarmups', call => {
      const undrawn = r._warmups.filter(w => !w.drawn), shadows = three.shadowMap.needsUpdate, out = call();
      if (cur) for (const w of undrawn) if (w.drawn) cur.warm.push(`${w.root.name || w.root.type}${w.inMatch ? '' : ' (menu)'}${w.own ? ' (own)' : ''}${shadows ? ' +shadows' : ''}`);
      return out;
    });
  }
}

/** Page side for `sweep`: scripts for `P.run` (lib.mjs `scripts`), driving content the bench's path and fight never touch. */
function sweepInit() {
  const P = window.__perf;
  const S = window.__sweep = { cfg: {}, notes: [] };
  const G = () => window.__game;
  const V = () => G().ctx.camera.position.constructor;
  /** A nav point near (x, y, z), or null. */
  const snap = (x, y, z) => {
    const nav = G().ctx.nav, Vec = V();
    for (const radius of [4, 8, 16]) {
      const id = nav.nearest(new Vec(x, y, z), radius, 3), node = nav.nodes[id];
      if (node) return new Vec(node.x, node.y, node.z);
    }
    return null;
  };
  /** Spawn `kinds` in a ring `dist` m round the player (or in an arc ahead of it, `ahead`), wearing operators. */
  S.spawn = (kinds, dist, ahead = false) => {
    const g = G(), p = g.player, out = [];
    kinds.forEach((kind, j) => {
      const bearing = ahead ? p.yaw + (j - (kinds.length - 1) / 2) * 0.35 : (j / kinds.length) * Math.PI * 2;
      const at = snap(p.body.pos.x - Math.sin(bearing) * dist, p.body.pos.y, p.body.pos.z - Math.cos(bearing) * dist)
        ?? p.body.pos.clone().setZ(p.body.pos.z - dist);
      if (kind === 'flyer' || kind === 'carrier' || kind === 'moderator') at.y += 6;
      try {
        const e = g.enemies.spawn(kind, at);
        if (e) out.push(e); else S.notes.push(`spawn ${kind}: refused`);
      } catch (error) { S.notes.push(`spawn ${kind}: ${String(error?.message ?? error)}`); }
    });
    P.wearOperators();
    return out;
  };
  const centre = e => e.center ?? e.body.pos.clone().setY(e.body.pos.y + 1.2);
  const nearest = p => {
    let best = null, bd = Infinity;
    for (const e of G().enemies.list) {
      if (!e.alive) continue;
      const d = e.body.pos.distanceTo(p.body.pos);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };
  const aimAt = (p, to, k) => {
    const d = to.clone().sub(p.eye), yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    let dy = yaw - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * k; p.pitch += (pitch - p.pitch) * k;
  };
  /** Buttons held for the run (`input.down`); `pressed` follows (the input's own previous frame never held them). */
  const hold = () => {
    const g = G(), down = g.input.down, held = new Set();
    g.input.down = a => held.has(a) || down.call(g.input, a);
    return { held, restore() { g.input.down = down; } };
  };
  const scripts = P.scripts;
  /** One gun of the loadout (`S.cfg.slot`, `S.cfg.optic`): hip fire, then aimed (scoped) fire, then a reload, at two grunts. */
  scripts['sweep-gun'] = frames => {
    const g = G(), p = g.player;
    let input = null;
    return {
      start() {
        p.switchTo(S.cfg.slot, true);
        if (S.cfg.optic && typeof p.weapon.setOptic === 'function') p.weapon.setOptic(S.cfg.optic);
        S.spawn(['grunt', 'grunt'], 10, true);
        input = hold();
      },
      pre(i) {
        if (i % 60 === 0) p.addAmmoAll(0.5);
        const target = nearest(p);
        if (target) aimAt(p, centre(target), 0.35);
        input.held.clear();
        if (i < frames - 40 && i % 40 < 30) input.held.add('fire');
        if (i >= frames / 3) input.held.add('aim');
        if (i === frames - 30) p.weapon.startReload?.();
      },
      end() { input.restore(); return { weapon: p.weapon.kind, optic: p.weapon.optic ?? null }; },
    };
  };
  /** The sword: ground slashes at close enemies, the guard, blood on the blade, air-slash waves, then an execution. */
  scripts['sweep-sword'] = () => {
    const g = G(), p = g.player;
    let input = null;
    return {
      start() { p.drawSword(); S.spawn(['grunt', 'rusher', 'shield'], 3, true); input = hold(); },
      pre(i) {
        const sword = p.sword, target = nearest(p);
        if (target) aimAt(p, centre(target), 0.35);
        input.held.clear();
        if (!p.holdingSword) p.drawSword();
        if (i < 120) { if (i % 20 < 10) input.held.add('fire'); } else if (i < 180) input.held.add('aim');
        else if (i < 260) {
          if (i === 180) sword?.addBlood(0.6);
          if (i % 25 === 0 && sword) { sword.waveCooldown = 0; sword.cooldown = 0; sword._slashT = 0; sword.startSlash({ ...p.weaponState(), grounded: false }); }
        } else if (i === 260) { S.spawn(['grunt', 'grunt', 'grunt'], 8, true); g.gs.katanaStreak = 3; }
        else if (i < 300) { input.held.add('aim'); input.held.add('fire'); }
      },
      end() { input.restore(); return { focus: g.gs.focus?.phase ?? null }; },
    };
  };
  /** Kinds spawned round the player (`S.cfg.kinds`, `S.cfg.dist`): their specials act for half the run, then fire and grenades. */
  scripts['sweep-kinds'] = frames => {
    const g = G(), p = g.player;
    let input = null;
    return {
      start() { S.spawn(S.cfg.kinds, S.cfg.dist ?? 14); input = hold(); },
      pre(i) {
        if (i % 60 === 0) p.addAmmoAll(0.5);
        input.held.clear();
        if (i < frames / 2) return;
        const target = nearest(p);
        if (target) { aimAt(p, centre(target), 0.35); input.held.add('fire'); }
        if (i % 90 === 45) { p.grenades = 99; p.grenadeCd = 0; p.throwGrenade(); }
      },
      end() { input.restore(); return { alive: g.enemies.list.filter(e => e.alive).map(e => e.type) }; },
    };
  };
  /** Solo's director on a boss wave (`S.cfg.wave`), with its drops and stragglers; fire held at the nearest, grenades. */
  scripts['sweep-solo'] = () => {
    const g = G(), p = g.player;
    let input = null;
    return {
      start() { g.jumpToWave(S.cfg.wave); P.lock = true; input = hold(); },
      pre(i) {
        if (i % 60 === 0) p.addAmmoAll(0.5);
        input.held.clear();
        const target = nearest(p);
        if (target) { aimAt(p, centre(target), 0.35); input.held.add('fire'); }
        if (i % 90 === 45) { p.grenades = 99; p.grenadeCd = 0; p.throwGrenade(); }
      },
      end() { input.restore(); const out = { wave: g.gs.wave, pickups: g.pickups.length, mode: g.gs.mode }; P.quiet(); return out; },
    };
  };
}

async function withServer(dir, fn) {
  const server = await serve(PORT, dir);
  try { return await fn(); } finally { await new Promise(r => server.close(r)); }
}

async function load(map, preset, inits = []) {
  const browser = await launch();
  const { page, errors } = await openPage(browser, { map, preset });
  await page.addInitScript(hitchInit);
  for (const init of inits) await page.addInitScript(init);
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

/** `load`: one cold load's frames from the match's start to 60 past ready (`loadTraceInit`), and what shared a frame. */
async function traceLoad(map, preset, build) {
  const { browser, page, errors, loaded } = await load(map, preset, [loadTraceInit]);
  try {
    await page.waitForFunction(() => window.__trace.done, null, { polling: 100, timeout: 30_000 });
    const trace = await page.evaluate(() => window.__trace);
    const fr = trace.frames, quietEnd = loaded.phases?.quietEndMs ?? null, ready = loaded.readyMs;
    // A frame's cost shows in the interval from its rAF time to the next rendered frame's.
    const frames = fr.map((f, i) => ({ ...f, ms: +f.ms.toFixed(2), t: +(f.t0 - (quietEnd ?? 0)).toFixed(1),
      interval: i + 1 < fr.length ? +(fr[i + 1].ts - f.ts).toFixed(1) : null, skippedAfter: i + 1 < fr.length ? fr[i + 1].skipped - f.skipped : 0 }));
    const tags = f => [f.quiet && 'quiet', f.sky && `sky:${f.sky}`, f.slot && 'slot', f.compiles && `compiles:${f.compiles}`, ...f.warm.map(w => `warm:${w}`),
      f.programs && `programs:+${f.programs}`].filter(Boolean);
    // The load window as lib.mjs `loadPhases.window`: the match's start (its quiet start included) to ready.
    const window_ = frames.filter(f => f.live && !f.ready);
    const warmFrames = frames.filter(f => f.warm.length > 0 && f.live);
    const max = window_.reduce((a, f) => (f.interval !== null && f.interval > (a?.interval ?? -1) ? f : a), null);
    const programsAtReady = await page.evaluate(() => window.__hitch.atReady);
    return { map, preset, build, readyMs: ready, quietEndMs: quietEnd, programsAtReady, error: trace.error,
      maxInterval: max ? { t: max.t, interval: max.interval, ms: max.ms, tags: tags(max) } : null,
      over50: window_.filter(f => f.interval > 50).map(f => ({ t: f.t, interval: f.interval, ms: f.ms, tags: tags(f) })),
      warm: warmFrames.map(f => ({ t: f.t, interval: f.interval, ms: f.ms, quiet: f.quiet, shared: !!(f.slot || f.sky), tags: tags(f) })),
      sky: frames.filter(f => f.sky).map(f => ({ t: f.t, step: f.sky, interval: f.interval, ms: f.ms, tags: tags(f) })),
      compiles: frames.filter(f => f.compiles).map(f => ({ t: f.t, n: f.compiles, interval: f.interval, ms: f.ms, tags: tags(f) })),
      programsInMatch: frames.filter(f => f.live && f.programs).map(f => ({ t: f.t, n: f.programs, interval: f.interval, tags: tags(f) })),
      intervals: window_.map(f => f.interval), errors };
  } finally { await browser.close(); }
}

/** `sweep`: the cell's content steps after ready, each logged as `sweep:<step>` (as find). */
async function sweep(map, preset) {
  const { browser, page, errors, loaded } = await load(map, preset, [sweepInit]);
  try {
    const counts = { ready: await page.evaluate(() => window.__hitch.atReady) };
    const steps = [], ends = {};
    const step = async (name, script, frames, setup = null) => {
      const before = await page.evaluate(() => window.__hitch.count());
      let end = null, failed = null;
      try {
        // A loadout to carry (in a live match: as from the loadout screen, its new weapons first drawn in play) and the script's options.
        await page.evaluate(({ loadout, options }) => {
          if (loadout && !window.__game.player.setLoadout(loadout)) throw new Error(`loadout ${loadout}`);
          Object.assign(window.__sweep.cfg, options);
        }, { loadout: setup?.loadout ?? null, options: setup?.options ?? {} });
        const res = await page.evaluate(([n, s, f, seed]) => { window.__hitch.step = n; return window.__perf.run(s, f, { seed }); }, [name, script, frames, SEED]);
        end = Object.fromEntries(Object.entries(res).filter(([k]) => !['cpu', 'frame', 'gpu', 'calls', 'triangles', 'points', 'lines', 'trail', 'profile'].includes(k)));
      } catch (error) { failed = String(error?.message ?? error).split('\n')[0]; }
      const after = await page.evaluate(() => window.__hitch.count());
      counts[name] = after;
      steps.push({ name, frames, before, after, failed, summary: end?.summary ?? null, extra: end ? { weapon: end.weapon, optic: end.optic, focus: end.focus, alive: end.alive, wave: end.wave, pickups: end.pickups } : null });
      ends[name] = end;
    };
    if (cfg.parts.includes('guns')) {
      for (const kinds of [['rifle', 'shotgun', 'sniper'], ['lmg', 'r4c', 'pistol']]) {
        for (let slot = 0; slot < kinds.length; slot++) {
          const kind = kinds[slot], optics = kind === 'rifle' || kind === 'r4c' ? ['acog', 'holo'] : [null];
          for (const optic of optics) {
            await step(`gun:${kind}${optic ? `:${optic}` : ''}`, 'sweep-gun', 150,
              { loadout: slot === 0 && optic === optics[0] ? kinds : null, options: { slot, optic } });
          }
        }
      }
      await page.evaluate(k => window.__game.player.setLoadout(k), ['r4c', 'pistol', 'sword']);
    }
    if (cfg.parts.includes('sword')) await step('sword', 'sweep-sword', 420);
    if (cfg.parts.includes('enemies')) {
      for (const kinds of [['turret', 'packleader'], ['rubberbander', 'sapper', 'parry']]) await step(`kinds:${kinds.join('+')}`, 'sweep-kinds', 600, { options: { kinds, dist: 14 } });
    }
    if (cfg.parts.includes('bosses')) {
      for (const kind of ['boss', 'hitbox', 'lagspike', 'aimbot', 'ragequit', 'moderator']) await step(`boss:${kind}`, 'sweep-kinds', 600, { options: { kinds: [kind], dist: 18 } });
    }
    if (cfg.parts.includes('solo') && map !== 'training') await step('solo:wave5', 'sweep-solo', 900, { options: { wave: 5 } });
    const log = await page.evaluate(() => window.__hitch.log);
    const notes = await page.evaluate(() => window.__sweep.notes);
    const programs = await page.evaluate(() => window.__hitch.list());
    return { map, preset, readyMs: loaded.readyMs, counts, steps, log, notes, programs, errors };
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
} else if (mode === 'sweep') {
  const [dir] = Object.values(cfg.outs);
  await withServer(dir, async () => {
    for (const map of cfg.maps) for (const preset of cfg.presets) {
      let r;
      try { r = await sweep(map, preset); } catch (error) { r = { map, preset, failed: String(error?.stack ?? error) }; }
      results.push(r); await save();
      if (r.failed) { console.log(`${map}/${preset}: FAILED ${r.failed.split('\n')[0]}`); continue; }
      console.log(`${map}/${preset} (sweep ${cfg.parts.join(',')}): programs ready ${r.counts.ready}; ${r.log.length} new after ready`
        + `${r.steps.some(x => x.failed) ? `; failed steps ${r.steps.filter(x => x.failed).map(x => `${x.name} (${x.failed})`).join(', ')}` : ''}`
        + `${r.notes.length ? `; notes ${[...new Set(r.notes)].join(', ')}` : ''}`);
      for (const x of r.steps) if (x.after !== x.before) console.log(`  ${x.name}: +${x.after - x.before}`);
      for (const e of r.log) console.log(`  ${brief(e)}`);
    }
  });
  // The per-step program-count check: `--check zero` (no step may add a program, no step may fail), and/or
  // `--expect FILE` (an earlier sweep's JSON: the count at ready and after every step must equal its cell's).
  const check = opt('check', null), expectFile = opt('expect', null);
  if (check !== null || expectFile !== null) {
    const expected = expectFile ? JSON.parse(await readFile(resolve(expectFile), 'utf8')).results : [];
    const fails = [];
    for (const r of results) {
      const cell = `${r.map}/${r.preset}`;
      if (r.failed) { fails.push(`${cell}: load failed`); continue; }
      for (const x of r.steps) {
        if (x.failed) fails.push(`${cell} ${x.name}: step failed (${x.failed})`);
        if (check === 'zero' && x.after !== x.before) fails.push(`${cell} ${x.name}: +${x.after - x.before} programs`);
      }
      if (!expectFile) continue;
      const e = expected.find(o => o.map === r.map && o.preset === r.preset && !o.failed);
      if (!e) { fails.push(`${cell}: not in ${expectFile}`); continue; }
      for (const [step, n] of Object.entries(r.counts)) if (e.counts[step] !== n) fails.push(`${cell} ${step}: ${n} programs, expected ${e.counts[step]}`);
    }
    console.log(`\ncheck${check ? ` ${check}` : ''}${expectFile ? ` expect ${expectFile}` : ''}: ${fails.length ? `FAIL (${fails.length})` : 'PASS'}`);
    for (const f of fails) console.log(`  ${f}`);
    if (fails.length) process.exitCode = 1;
  }
} else if (mode === 'load') {
  const builds = Object.entries(cfg.outs);
  for (let round = 0; round < cfg.repeat; round++) {
    for (const map of cfg.maps) for (const preset of cfg.presets) {
      for (let k = 0; k < builds.length; k++) {
        const [build, dir] = builds[(k + round) % builds.length];
        let r;
        try { r = await withServer(dir, () => traceLoad(map, preset, build)); } catch (error) { r = { map, preset, build, failed: String(error?.stack ?? error) }; }
        r.round = round;
        results.push(r); await save();
        if (r.failed) { console.log(`r${round} ${build} ${map}/${preset}: FAILED ${r.failed.split('\n')[0]}`); continue; }
        const at = t => `${t >= 0 ? '+' : ''}${Math.round(t)}`;
        console.log(`r${round} ${build} ${map}/${preset}: ready ${Math.round(r.readyMs)} ms (quiet end ${Math.round(r.quietEndMs)}), programs ${r.programsAtReady}; max frame ${r.maxInterval?.interval} ms at ${at(r.maxInterval?.t ?? NaN)} [${r.maxInterval?.tags.join(' ') ?? ''}]; `
          + `>50 ms ${r.over50.length}; in-match warm-ups ${r.warm.length} (sharing a slot or sky step ${r.warm.filter(w => w.shared).length})`);
        for (const w of r.warm) console.log(`    warm ${at(w.t)} ms: frame ${w.interval} ms, render ${w.ms} ms [${w.tags.join(' ')}]`);
        for (const f of r.over50) console.log(`    >50 ${at(f.t)} ms: frame ${f.interval} ms, render ${f.ms} ms [${f.tags.join(' ')}]`);
      }
    }
  }
  const med = v => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] * 0.5 + s[s.length >> 1] * 0.5 : null; };
  console.log('\n| build | loads | ready ms (median) | max frame ms (median; each) | loads with a warm-up sharing a slot / sky step | warm-up frames: median / max ms | loads with a frame > 100 ms |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [build] of builds) {
    const rs = results.filter(r => !r.failed && r.build === build);
    if (!rs.length) continue;
    const warmMs = rs.flatMap(r => r.warm.map(w => w.interval));
    console.log(`| ${build} | ${rs.length} | ${med(rs.map(r => r.readyMs))?.toFixed(0)} | ${med(rs.map(r => r.maxInterval?.interval))?.toFixed(1)} (${rs.map(r => r.maxInterval?.interval).join(', ')}) | `
      + `${rs.filter(r => r.warm.some(w => w.shared)).length} | ${med(warmMs)?.toFixed(1)} / ${Math.max(...warmMs.filter(Number.isFinite)).toFixed(1)} | ${rs.filter(r => (r.maxInterval?.interval ?? 0) > 100).length} |`);
  }
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

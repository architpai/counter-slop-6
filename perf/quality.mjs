// Screenshot quality gate for the performance loop: a fixed set of views per preset, captured deterministically on the
// production build, and SSIM against a baseline set.
//   node perf/quality.mjs capture LABEL [--presets low,medium,high,ultra] [--maps a,b] [--views a,b] [--build] [--headed]
//   node perf/quality.mjs compare BASE LABEL [--min 0.995] [--min-tile X] [--diff-all]
// capture: perf/shots/LABEL/<preset>/<view>.png at 1920x1080 (DPR 1) and perf/shots/LABEL/manifest.json (git sha,
// dirty flag, date, presets, views and their state digests, errors). LABEL's folder is replaced. One fresh browser per
// preset x map (perf/lib.mjs: ANGLE Metal, vsync off, the preset in localStorage, the virtual rAF clock, seeded
// Math.random), the views of that map in a fixed order, then the downtown fights last (they break things):
//   <map>-fp              first person at the spawn (FP yaw downtown 0, house 0, mexico pi/2, training 0; pitch -0.04),
//                         view model and play HUD on: 64 fixed steps from P.reset (clocks, springs, RNG, renderer
//                         frame) with the view held. The HUD shows only state the steps set (ammo, health, slots; the
//                         wave timer is off, perf/lib.mjs `quiet`), and CSS animations are finished for the shot.
//   <map>-overview        a fixed high corner, (maxX*1.05, 42, maxZ*1.05) -> (0,0,0), fov 60 (tests/tiers.shots.mjs)
//   downtown-low-angle    (-30,12,22) -> (0,3,0), fov 55 (report/capture.mjs)
//   indoor-house-ground, indoor-house-basement, indoor-downtown-b   an eye and a posed grunt (report/capture.mjs), fov 70
//   fight-mid             downtown, lib.mjs's `fight` (roster, auto-aim, fire held, a grenade every 90 frames, gore
//                         full) for FIGHT_FRAMES fixed steps after an unrecorded warm-up of it: muzzle flash, tracers,
//                         blood, gibs, decals, casings and blasts frozen at one simulated time. HUD hidden.
//   fight-smoke           downtown, a grenade (thrown as a peer's: no damage) blowing up 6 m ahead beside a smoke
//                         cloud (realistic tiers), SMOKE_FRAMES fixed steps. HUD hidden.
// The static views (overview, low angle, indoor) are paused (gs.state 'pause', HUD and view model hidden): the camera
// set, the loop run until nothing lands by real time any more (perf/lib.mjs `settled`: streaming, bake fade, held
// compiles, warm-up draws), then held, the clocks pinned (gs.time 0, renderer._frame so the last frame is 64: every
// tier redraws its shadows on it and the smoke dither is at phase 0) and STATIC_STEPS fixed steps run. The screenshot
// is of the last rendered frame (the loop is held, the canvas keeps it).
// compare: SSIM (perf/image.mjs) of every image, BASE vs LABEL; fails an image with mean SSIM < --min (and, given
// --min-tile, a tile under it), or missing on either side; exit 1 on any failure. A tile under TILE_WARN (0.98) is
// warned about (WARN tile). Heat maps, and base | new | diff side by side, of the failing and warned images in
// perf/shots/LABEL/_diff/<preset>/ (--diff-all: heat maps of every image); the numbers in perf/shots/LABEL/_diff/compare.json.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAPS, PRESETS, ROOT, SEED, VIEWPORT, git, launch, loadAndWait, openPage, startServer } from './lib.mjs';
import { compareImages, encodePng, heatmap, readPng, sideBySide } from './image.mjs';

const SHOTS = resolve(ROOT, 'perf/shots');
/** Steps from P.reset to the first-person shot. 64: the renderer's frame is 64 on it (P.reset zeroes it). */
const FP_FRAMES = 64;
/** Fixed steps before a paused view's shot (a multiple of every tier's shadow interval). */
const STATIC_STEPS = 8;
/** The fight's shot: 6 kills in, flash and tracer, two blasts, casings, bodies, a gib and a grenade in view (Ultra). */
const FIGHT_FRAMES = 370;
/** The fight's unrecorded warm-up (another seed), past the shot's frame: every kind in the roster to 360 has spawned. */
const FIGHT_WARMUP = 400;
/** The smoke view's shot: its grenade (thrown at 0) blows up at 138. */
const SMOKE_FRAMES = 150;
const FP_YAW = { downtown: 0, house: 0, mexico: Math.PI / 2, training: 0 };
const INDOOR = {
  house: [
    { name: 'indoor-house-ground', eye: [8.5, 1.6, -4.8], grunt: [4.5, 0, -4.2] },
    { name: 'indoor-house-basement', eye: [8.8, -2.0, 6.4], grunt: [1.5, -3.6, 5.5] },
  ],
  downtown: [{ name: 'indoor-downtown-b', eye: [42.5, 1.6, 11], grunt: [33, 0, 7] }],
};
const VIEW_TIMEOUT_MS = 120_000;
/**
 * compare: a tile mean under this is warned about (not failed, unless --min-tile) and gets its heat map. Two captures
 * of one build are bit-identical (SSIM 1, every tile 1); a 40x40 patch inverted in a 1920x1080 frame reads 0.9993 mean
 * (passes the mean gate) and 0.96 in its tile.
 */
const TILE_WARN = 0.98;

/** A map's views, in capture order. */
export function viewsFor(map) {
  const views = [{ name: `${map}-fp`, kind: 'fp', yaw: FP_YAW[map], pitch: -0.04, frames: FP_FRAMES },
    { name: `${map}-overview`, kind: 'static', overview: true, fov: 60 }];
  if (map === 'downtown') views.push({ name: 'downtown-low-angle', kind: 'static', pos: [-30, 12, 22], target: [0, 3, 0], fov: 55 });
  for (const v of INDOOR[map] ?? []) views.push({ name: v.name, kind: 'static', pos: v.eye, target: [v.grunt[0], v.grunt[1] + 1.2, v.grunt[2]], fov: 70, grunt: v.grunt });
  if (map === 'downtown') {
    views.push({ name: 'fight-mid', kind: 'fight', frames: FIGHT_FRAMES, warmup: FIGHT_WARMUP },
      { name: 'fight-smoke', kind: 'smoke', frames: SMOKE_FRAMES });
  }
  return views;
}

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const VALUE_OPTS = ['--presets', '--maps', '--views', '--min', '--min-tile'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.includes(argv[i - 1]));
const usage = () => {
  console.error('usage: node perf/quality.mjs capture LABEL [--presets low,medium,high,ultra] [--maps a,b] [--views a,b] [--build] [--headed]\n'
    + '       node perf/quality.mjs compare BASE LABEL [--min 0.995] [--min-tile X] [--diff-all]');
  process.exit(2);
};

// ------------------------------------------------------------------ page side

/** Installed in the page once it is ready (self-contained: `cfg` carries the node-side values). */
function qualityInit(cfg) {
  const P = window.__perf, g = window.__game, r = g.ctx.renderer, camera = g.ctx.camera, p = g.player;
  const Vec = camera.position.constructor;
  // The hip FOV the camera settled on at the spawn: play views start from it (the camera's FOV damps towards its
  // target from wherever the last view left it).
  const Q = window.__q = { hipFov: camera.fov, fightWarm: false };
  const setFov = fov => { camera.fov = fov; camera.updateProjectionMatrix(); };

  /** Run the loop until `settled` and at least `min` frames, then hold. Resolves with the frames run. */
  Q.settle = (min = 10) => new Promise(resolve => {
    let n = 0;
    const hook = () => {
      if (++n < min || !P.settled()) return;
      P.hold = true; P.hooks.splice(P.hooks.indexOf(hook), 1); resolve(n);
    };
    P.hooks.push(hook);
    P.hold = false;
  });
  /** Nothing left of a fight: enemies, effects, grenades, pickups. */
  Q.cleanup = () => {
    if (g.gs.mode !== 'training') g.enemies.clear();
    g.effects.clear(); p.clearNades?.(); P.quiet();
  };
  /** What the shot shows, for the manifest: the frame, the clocks, a hash of the simulation, the effects' counts. */
  Q.digest = () => ({ steps: P.steps, frame: r._frame, time: +g.gs.time.toFixed(4), state: g.gs.state, hash: P.stateHash(), summary: P.summary(),
    camera: [...camera.position.toArray(), camera.fov].map(v => +v.toFixed(4)) });

  /** A paused view: camera, HUD and view model hidden, a posed grunt. */
  function stage(v) {
    g.gs.state = 'pause'; g.gs.queue.length = 0;
    Q.cleanup();
    P.hideHud();
    r.rig.visible = false;
    let pos = v.pos, target = v.target;
    if (v.overview) { const b = g.ctx.level.bounds; pos = [b.maxX * 1.05, 42, b.maxZ * 1.05]; target = [0, 0, 0]; }
    camera.position.set(...pos); setFov(v.fov); camera.lookAt(...target); camera.updateMatrixWorld();
    if (v.grunt) {
      const e = g.enemies.spawn('grunt', new Vec(...v.grunt));
      e.root.scale.setScalar(e.stats.scale); e.state = 'idle';
      e.yaw = e.root.rotation.y = Math.atan2(v.pos[0] - v.grunt[0], v.pos[2] - v.grunt[2]);
      e.root.updateMatrixWorld(true);
      P.wearOperators();
    }
  }

  // The first-person view: the reset start, the view held each step.
  P.scripts.qualityFp = () => {
    const v = Q.view;
    return {
      start() { g.gs.time = 0; setFov(Q.hipFov); r.rig.visible = true; P.showHud(); p.yaw = v.yaw; p.pitch = v.pitch; },
      pre() { p.yaw = v.yaw; p.pitch = v.pitch; },
      end() {},
    };
  };
  // A grenade blowing up 6 m ahead, thrown as a peer's (visual only), beside a smoke cloud (realistic tiers only).
  P.scripts.qualitySmoke = () => ({
    start() {
      g.gs.time = 0; setFov(Q.hipFov); r.rig.visible = true;
      p.yaw = 0; p.pitch = -0.08;
    },
    pre(i) {
      p.yaw = 0; p.pitch = -0.08;
      if (i !== 0) return;
      const ahead = new Vec(0, 0, -1), side = new Vec(1, 0, 0), from = p.eye.clone().addScaledVector(ahead, 0.6).addScaledVector(side, 0.25);
      from.y -= 0.15;
      p.throwGrenade({ pos: from.toArray(), vel: [0.6, 3, -6] });
      const at = p.body.pos.clone().addScaledVector(ahead, 7).addScaledVector(side, -2.5);
      g.effects.smokeCloud(at.setY(at.y + 0.2), 3, 12);
    },
    end() {},
  });

  /** One view, from wherever the last left the page, to its shot's frame held on the canvas. */
  Q.shoot = async v => {
    Q.view = v;
    if (v.kind === 'fp') {
      g.gs.state = 'play'; r.rig.visible = true; Q.cleanup(); P.showHud();
      await Q.settle();
      P.hold = false;
      await P.run('qualityFp', v.frames, { seed: cfg.seed, holdAt: v.frames });
    } else if (v.kind === 'static') {
      stage(v);
      await Q.settle();
      // The clocks the steps read: the level's animated pieces and the post's time (gs.time), the renderer's frame
      // (Low's every-other-frame shadow, the smoke dither), the RNG.
      g.gs.time = 0; r._frame = 64 - cfg.staticSteps; P.seed(cfg.seed);
      g.effects.shake = 0; g.effects.shakePush = 0;
      await P.advance(cfg.staticSteps);
    } else if (v.kind === 'fight' || v.kind === 'smoke') {
      g.gs.state = 'play'; r.rig.visible = true; Q.cleanup(); P.hideHud();
      if (v.kind === 'fight' && !Q.fightWarm) {
        // Compiles impacts, blood, gibs and blasts (and breaks what the fight breaks) the same way every time.
        await Q.settle();
        setFov(Q.hipFov); P.hold = false;
        await P.run('fight', v.warmup, { seed: cfg.seed + 1, holdAt: v.warmup });
        Q.cleanup(); Q.fightWarm = true;
      }
      await Q.settle();
      setFov(Q.hipFov); P.hold = false;
      await P.run(v.kind === 'fight' ? 'fight' : 'qualitySmoke', v.frames, { seed: cfg.seed, holdAt: v.frames });
    } else throw new Error(`unknown view kind ${v.kind}`);
    return Q.digest();
  };
}

// ------------------------------------------------------------------ capture

async function captureMap({ preset, map, dir, views, headed }) {
  const started = Date.now();
  const browser = await launch({ headed });
  const chrome = browser.version();
  const { page, errors } = await openPage(browser, { preset, map });
  const shots = {};
  const failures = [];
  let facts = null, load = null;
  try {
    load = await loadAndWait(page);
    facts = await page.evaluate(() => window.__perf.prepare());
    assert.equal(facts.preset, preset, 'preset');
    assert.equal(facts.pixelRatio, 1, 'pixel ratio');
    assert.deepEqual(facts.drawingBuffer, [VIEWPORT.width, VIEWPORT.height], 'drawing buffer');
    assert.equal(facts.level, map, 'map');
    await page.evaluate(qualityInit, { seed: SEED, staticSteps: STATIC_STEPS });
    for (const view of views) {
      const t0 = Date.now();
      try {
        const digest = await Promise.race([
          page.evaluate(v => window.__q.shoot(v), view),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`not done in ${VIEW_TIMEOUT_MS / 1000} s`)), VIEW_TIMEOUT_MS).unref()),
        ]);
        await page.screenshot({ path: resolve(dir, `${view.name}.png`), animations: 'disabled', caret: 'hide', scale: 'device' });
        shots[view.name] = { ...digest, ms: Date.now() - t0 };
        console.error(`  ${preset} ${view.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, frame ${digest.frame}, hash ${digest.hash}`);
      } catch (error) {
        const state = await page.evaluate(() => window.__perf?.readiness()).catch(() => null);
        failures.push({ preset, map, view: view.name, error: String(error?.message ?? error), state });
        console.error(`  FAIL ${preset} ${view.name}: ${error?.message ?? error} ${JSON.stringify(state)}`);
      }
    }
  } catch (error) {
    failures.push({ preset, map, view: null, error: String(error?.stack ?? error) });
    console.error(`  FAIL ${preset} ${map}: ${error?.message ?? error}`);
  } finally {
    await browser.close();
  }
  return { chrome, gpu: facts?.gpu ?? null, load: load && { readyMs: Math.round(load.readyMs), firstPlayableMs: Math.round(load.firstPlayableMs) },
    shots, failures, errors: errors.map(e => ({ preset, map, ...e })), ms: Date.now() - started };
}

async function capture(label) {
  const presets = opt('presets', PRESETS.join(',')).split(',');
  const maps = opt('maps', MAPS.join(',')).split(',');
  const only = opt('views', null)?.split(',') ?? null;
  for (const p of presets) assert.ok(PRESETS.includes(p), `unknown preset ${p}`);
  for (const m of maps) assert.ok(MAPS.includes(m), `unknown map ${m}`);
  const t0 = Date.now();
  const root = resolve(SHOTS, label);
  rmSync(root, { recursive: true, force: true });
  const server = await startServer({ build: flag('build') });
  const manifest = { label, date: new Date().toISOString(), git: git(), chrome: null, gpu: null, viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
    seed: SEED, presets, maps, views: {}, timings: {}, errors: [], failures: [], args: argv, node: process.version };
  try {
    for (const preset of presets) {
      const dir = resolve(root, preset);
      mkdirSync(dir, { recursive: true });
      manifest.views[preset] = {};
      for (const map of maps) {
        const views = viewsFor(map).filter(v => !only || only.includes(v.name));
        if (views.length === 0) continue;
        const r = await captureMap({ preset, map, dir, views, headed: flag('headed') });
        manifest.chrome ??= r.chrome; manifest.gpu ??= r.gpu;
        Object.assign(manifest.views[preset], r.shots);
        manifest.timings[`${preset}/${map}`] = { ms: r.ms, ...r.load };
        manifest.errors.push(...r.errors);
        manifest.failures.push(...r.failures);
        console.error(`${preset} ${map}: ${Object.keys(r.shots).length}/${views.length} views, ${(r.ms / 1000).toFixed(1)} s`);
      }
    }
  } finally {
    server.close();
  }
  manifest.durationMs = Date.now() - t0;
  writeFileSync(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const n = Object.values(manifest.views).reduce((s, v) => s + Object.keys(v).length, 0);
  console.log(`${label}: ${n} images in ${root} (${(manifest.durationMs / 1000).toFixed(0)} s, ${manifest.git.sha?.slice(0, 7)}${manifest.git.dirty ? '+dirty' : ''})`);
  if (manifest.errors.length) console.log(`page errors (${manifest.errors.length}):\n${manifest.errors.map(e => `- ${e.preset} ${e.map} ${e.type} x${e.count}: ${e.text}`).join('\n')}`);
  if (manifest.failures.length) {
    console.log(`FAILED views (${manifest.failures.length}):\n${manifest.failures.map(f => `- ${f.preset} ${f.view ?? f.map}: ${f.error.split('\n')[0]}`).join('\n')}`);
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ compare

/** Every <preset>/<view>.png under a label's folder. */
function imagesOf(label) {
  const root = resolve(SHOTS, label);
  if (!existsSync(root)) throw new Error(`no captures at ${root}`);
  const out = new Map();
  for (const preset of readdirSync(root, { withFileTypes: true })) {
    if (!preset.isDirectory() || preset.name.startsWith('_')) continue;
    for (const f of readdirSync(resolve(root, preset.name))) if (f.endsWith('.png')) out.set(`${preset.name}/${f.slice(0, -4)}`, resolve(root, preset.name, f));
  }
  return out;
}

function compare(baseLabel, label) {
  const t0 = Date.now();
  const min = Number(opt('min', 0.995)), minTile = opt('min-tile', null) === null ? null : Number(opt('min-tile'));
  const diffAll = flag('diff-all');
  const a = imagesOf(baseLabel), b = imagesOf(label);
  const order = k => { const [preset, view] = k.split('/'); return [PRESETS.indexOf(preset), view]; };
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => {
    const [px, vx] = order(x), [py, vy] = order(y);
    return px - py || vx.localeCompare(vy);
  });
  const diffRoot = resolve(SHOTS, label, '_diff');
  rmSync(diffRoot, { recursive: true, force: true });
  const rows = [], fails = [], warns = [];
  const f4 = x => x.toFixed(4);
  for (const key of keys) {
    const [preset, view] = key.split('/');
    if (!a.has(key) || !b.has(key)) {
      const why = !a.has(key) ? `missing in ${baseLabel}` : `missing in ${label}`;
      rows.push({ key, missing: why });
      fails.push(`${key}: ${why}`);
      continue;
    }
    const A = readPng(a.get(key)), B = readPng(b.get(key));
    let r;
    try { r = compareImages(A, B); } catch (error) { rows.push({ key, missing: error.message }); fails.push(`${key}: ${error.message}`); continue; }
    const failed = r.ssim < min || (minTile !== null && r.minTile < minTile);
    const warned = !failed && r.minTile < TILE_WARN;
    if (failed) fails.push(`${key}: SSIM ${f4(r.ssim)}, min tile ${f4(r.minTile)} at ${r.minTileAt}`);
    if (warned) warns.push(`${key}: SSIM ${f4(r.ssim)} passes, but tile (${r.minTileAt}) reads ${f4(r.minTile)}`);
    if (failed || warned || diffAll) {
      const dir = resolve(diffRoot, preset);
      mkdirSync(dir, { recursive: true });
      const heat = heatmap(B, r.diff);
      writeFileSync(resolve(dir, `${view}.png`), encodePng(heat));
      if (failed || warned) writeFileSync(resolve(dir, `${view}-sbs.png`), encodePng(sideBySide([A, B, heat])));
    }
    const { diff, tiles, ...nums } = r;
    rows.push({ key, ...nums, tiles: tiles.map(line => line.map(v => +v.toFixed(5))), failed, warned });
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n## ${baseLabel} -> ${label}: mean SSIM >= ${min}${minTile !== null ? `, min tile >= ${minTile}` : ''}\n`);
  console.log('| preset/view | SSIM | min tile (col,row of 8x8) | % px changed | % px > 8 | max diff | |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    if (row.missing) { console.log(`| ${row.key} | - | - | - | - | - | FAIL (${row.missing}) |`); continue; }
    console.log(`| ${pad(row.key, 32)} | ${f4(row.ssim)} | ${f4(row.minTile)} (${row.minTileAt}) | ${row.pctChanged.toFixed(3)} | ${row.pctOver8.toFixed(3)} | ${row.maxDiff} | ${row.failed ? 'FAIL' : row.warned ? 'WARN tile' : 'ok'} |`);
  }
  const ms = Date.now() - t0;
  mkdirSync(diffRoot, { recursive: true });
  writeFileSync(resolve(diffRoot, 'compare.json'), JSON.stringify({ base: baseLabel, label, min, minTile, tileWarn: TILE_WARN, date: new Date().toISOString(), ms, fails, warns, rows }, null, 1));
  if (warns.length > 0) console.log(`\nWARN (${warns.length}), a tile under ${TILE_WARN} (look at the side-by-side):\n${warns.map(w => `- ${w}`).join('\n')}`);
  console.log(`\n${keys.length} images, ${(ms / 1000).toFixed(1)} s. ${fails.length === 0 ? 'PASS' : `FAIL (${fails.length}):\n${fails.map(f => `- ${f}`).join('\n')}`}`);
  if (fails.length + warns.length > 0) console.log(`diffs: ${diffRoot}`);
  if (fails.length > 0) process.exitCode = 1;
}

// ------------------------------------------------------------------ main

const [cmd, ...rest] = positional;
if (cmd === 'capture' && rest.length === 1) await capture(rest[0]);
else if (cmd === 'compare' && rest.length === 2) compare(rest[0], rest[1]);
else usage();

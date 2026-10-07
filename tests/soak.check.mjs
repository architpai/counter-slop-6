// Soak: every map on every preset, over and over, each a live fight, and a Low <-> Ultra switch in each match.
//   node tests/soak.check.mjs URL
// Environment: CS6_CYCLES=20  CS6_MAPS=downtown,house,mexico,training  CS6_PRESETS=low,medium,high,ultra
//              CS6_FIGHT_MS=4000  CS6_GL=metal|swiftshader  CS6_OUT=/tmp/cs6-soak.json
//
// A cycle plays every map on every preset (training through the training mode, the rest as a solo run from wave 3):
// the match goes live, its quiet start passes (render/pacing.ts `MATCH_QUIET_MS`), then a fight of CS6_FIGHT_MS: the
// player, who takes no damage, holds fire at the nearest enemy and throws a grenade (a peer's, visual) every 1.5 s,
// while the wave shoots back, dies, gibs and blows up. Halfway through, the pause menu switches the preset to the
// other end (Low to Ultra, any realistic one to Low) and back, as a player tries both; the match plays on between.
// After each cycle the page goes back to the menu on Ultra and Downtown, waits for everything to stream in, collects
// garbage and reads three's live geometries, textures and programs and the JS heap.
//
// Fails on: any page error or console error; a rendered frame over STALL_MS in a match once its quiet start is over;
// a frame over MENU_STALL_MS under the pause menu (the switch compiles the other look's programs there, 80-160 ms
// frames on the M4 Pro: an exemption from STALL_MS, as a settings change in a menu, not play; the match resumes once
// they are done, or after 5 s, as a player takes a moment there); or
// a trend in the per-cycle readings once the first WARMUP cycles have made every program and pool: the readings of
// the last third may not pass those of the middle third by more than the slack below, and the least-squares slope
// over the cycles after the warm-up, times their count, may not pass it either. Real GPU with vsync on (as a player
// plays) on macOS; SwiftShader elsewhere, where frame times say little (they are recorded, not judged).
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const cycles = Number(process.env.CS6_CYCLES ?? 20);
const maps = (process.env.CS6_MAPS ?? 'downtown,house,mexico,training').split(',');
const presets = (process.env.CS6_PRESETS ?? 'low,medium,high,ultra').split(',');
const fightMs = Number(process.env.CS6_FIGHT_MS ?? 4000);
const out = process.env.CS6_OUT ?? '/tmp/cs6-soak.json';
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
/** A rendered frame this long, in a match past its quiet start, is a visible hitch. */
const STALL_MS = 100;
/** Under the pause menu, where a switch between the looks compiles the other look: the guard there (see above). */
const MENU_STALL_MS = 250;
/** A match's quiet start (render/pacing.ts `MATCH_QUIET_MS`): no upload, sky step or compile in it. */
const quietMs = 3000;
/** The cycles that fill the caches (programs, pools, the operators' LODs) before the trend is judged. */
const WARMUP = Math.min(3, Math.max(1, cycles - 3));
/**
 * Growth allowed across the judged cycles: three's objects by count, the heap in MB. The heap after a forced GC
 * reads within about 0.5 MB run to run and creeps by up to 0.1 MB a cycle with no leak of the game's: V8's compiled
 * code as more of it is optimised, the DevTools session's network buffer (this check's own), and deleted
 * WebGLProgram wrappers, which Chromium's WebGL context keeps in a list it caps at 128 (a Low <-> Ultra switch
 * adds 11; it is full within the first cycle). 3 MB fails a leak of 0.2 MB a cycle over 17 judged cycles.
 */
const SLACK = { geometries: 8, textures: 4, programs: 2, heapMB: 3 };

const browser = await chromium.launch({ args: gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));

const readings = [], stalls = [], matches = [];
const started = Date.now();
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  await page.evaluate(() => {
    const g = window.__game, renderer = g.ctx.renderer, render = renderer.render;
    renderer.render = function (...args) { window.__renders?.push([performance.now(), g.gs.state === 'play']); return render.apply(this, args); };
    // Every geometry three draws, until it is disposed: what a reading finds alive and no longer in the scene is a
    // leak's suspect, named by what drew it (logged with each reading).
    const drawn = window.__drawn = new Map(), three = renderer.three, draw = three.renderBufferDirect.bind(three);
    three.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (!drawn.has(geometry)) {
        let path = object.name || object.type;
        for (let n = object.parent; n && n.parent; n = n.parent) if (n.name) { path = `${n.name}/${path}`; break; }
        drawn.set(geometry, `${path} [${material.name || material.type}]`);
        geometry.addEventListener('dispose', () => drawn.delete(geometry));
      }
      return draw(camera, scene, geometry, material, object, group);
    };
  });
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const map of maps) {
      for (const preset of presets) {
        const other = preset === 'low' ? 'ultra' : 'low';
        // The match: live, its quiet start, then the fight with the switch halfway through it.
        await page.evaluate(({ preset, map }) => {
          const g = window.__game;
          g.hud.onUiAction('mainMenu', null, new Event('click'));
          g.hud.onUiAction('gfxPreset', preset, new Event('click'));
          if (map === 'training') g.beginTraining();
          else {
            g.hud.onUiAction('pickMap', map, new Event('click'));
            g.jumpToWave(3);
          }
          g.hud.hideScreen();
          const p = g.player;
          p.takeDamage = () => {};
          p.knockback = () => {};
          window.__renders = [];
          window.__soakStart = performance.now();
        }, { preset, map });
        const fight = page.evaluate(({ quietMs, fightMs, other, preset }) => new Promise(resolve => {
          const g = window.__game, p = g.player, down = g.input.down, V = p.eye.constructor;
          let switched = 0, lastThrow = 0, lastAim = 0, pausedAt = 0, paused = 0;
          const r = g.ctx.renderer;
          g.input.down = action => action === 'fire' || down.call(g.input, action);
          const tick = now => {
            const t = now - window.__soakStart - paused;
            // Under the pause menu: resume once the new look's programs are compiled and drawn (a player takes longer).
            if (pausedAt > 0) {
              if (now - pausedAt > 600 && r._compiles.length + r._warmups.length === 0 || now - pausedAt > 5000) {
                paused += now - pausedAt;
                pausedAt = 0;
                g.resume();
              }
              requestAnimationFrame(tick);
              return;
            }
            if (g.gs.state === 'play' && t > quietMs) {
              const enemies = g.enemies.list.filter(e => e.alive);
              let target = null, best = Infinity;
              for (const e of enemies) {
                const d = e.body.pos.distanceTo(p.body.pos);
                if (d < best) { best = d; target = e; }
              }
              if (target && now - lastAim > 150) {
                lastAim = now;
                const to = target.body.pos.clone().setY(target.body.pos.y + 1.2).sub(p.eye);
                p.yaw = Math.atan2(-to.x, -to.z);
                p.pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
              }
              if (now - lastThrow > 1500) {
                lastThrow = now;
                const ahead = p.forward.clone().setY(0).normalize();
                const vel = ahead.clone().multiplyScalar(Math.min(14, 4 + 0.5 * (target ? best : 10)));
                vel.y += 3.5;
                p.throwGrenade({ pos: p.eye.clone().addScaledVector(ahead, 0.6).toArray(), vel: vel.toArray() });
              }
              // Halfway: the other end of the presets from the pause menu, and back, the match playing on in between.
              if ((switched === 0 && t > quietMs + fightMs / 2) || (switched === 1 && t > quietMs + fightMs * 0.75)) {
                g.pause();
                pausedAt = now;
                g.hud.onUiAction('gfxPreset', switched++ === 0 ? other : preset, new Event('click'));
              }
            }
            if (t < quietMs + fightMs) { requestAnimationFrame(tick); return; }
            g.input.down = down;
            const renders = window.__renders;
            window.__renders = null;
            const start = window.__soakStart;
            // Rendered frames past the quiet start, in play; the pause menu's (the switches') are logged apart.
            const gaps = [];
            for (let i = 1; i < renders.length; i++) {
              const [at, playing] = renders[i], [before, wasPlaying] = renders[i - 1];
              if (before - start < quietMs) continue;
              gaps.push([Math.round(before - start), +(at - before).toFixed(1), !playing || !wasPlaying]);
            }
            const judged = gaps.filter(([, , menu]) => !menu);
            const worst = judged.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
            const sorted = judged.map(([, ms]) => ms).sort((a, b) => a - b);
            resolve({ state: g.gs.state, level: g.level.key, frames: judged.length, worstMs: worst[1], worstAt: worst[0],
              p95Ms: sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0,
              menuWorstMs: Math.max(0, ...gaps.filter(([, , menu]) => menu).map(([, ms]) => ms)),
              over: judged.filter(([, ms]) => ms > 100).map(([at, ms]) => [at, ms]),
              kills: g.gs.kills, enemies: g.enemies.list.length });
          };
          requestAnimationFrame(tick);
        }), { quietMs, fightMs, other, preset });
        const result = await fight;
        const row = { cycle, map, preset, ...result };
        matches.push(row);
        assert.equal(result.level, map === 'training' ? 'training' : map, `${map}: the match is on another map`);
        if (result.worstMs > STALL_MS) stalls.push(`cycle ${cycle} ${preset} ${map}: a ${result.worstMs} ms frame ${result.worstAt} ms in`);
        if (result.menuWorstMs > MENU_STALL_MS) stalls.push(`cycle ${cycle} ${preset} ${map}: a ${result.menuWorstMs} ms frame under the pause menu's switch`);
        console.log(`cycle ${cycle} ${preset.padEnd(6)} ${map.padEnd(9)} frames ${result.frames} p95 ${result.p95Ms} worst ${result.worstMs} (at ${result.worstAt}) menu ${result.menuWorstMs} kills ${result.kills}`);
      }
    }
    // The reading: the menu on Ultra over Downtown, everything streamed in, garbage collected.
    await page.evaluate(() => {
      const g = window.__game;
      g.hud.onUiAction('mainMenu', null, new Event('click'));
      g.hud.onUiAction('gfxPreset', 'ultra', new Event('click'));
      g.hud.onUiAction('pickMap', 'downtown', new Event('click'));
    });
    await page.waitForFunction(() => {
      const r = window.__game.ctx.renderer;
      return !r.streaming && r._compiles.length + r._warmups.length === 0;
    }, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const three = await page.evaluate(() => {
      const r = window.__game.ctx.renderer, info = r.three.info;
      let objects = 0;
      window.__game.ctx.scene.traverse(() => { objects++; });
      const inScene = new Set();
      window.__game.ctx.scene.traverse(o => { if (o.geometry) inScene.add(o.geometry); });
      const outside = {};
      for (const [geometry, label] of window.__drawn) if (!inScene.has(geometry)) outside[label] = (outside[label] ?? 0) + 1;
      return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0, objects,
        level: window.__game.level.key, outside };
    });
    const { outside, ...counts } = three;
    const reading = { cycle, ...counts, heapMB: +(heap.usedSize / 1e6).toFixed(1), minutes: +((Date.now() - started) / 60000).toFixed(1) };
    readings.push(reading);
    console.log(`READING ${JSON.stringify(reading)}`);
    console.log(`  drawn, alive and out of the scene: ${JSON.stringify(outside)}`);
  }
} finally {
  await writeFile(out, JSON.stringify({ url, cycles, maps, presets, fightMs, readings, matches, stalls, errors }, null, 1));
  await browser.close();
}

/** Least-squares slope of `ys` over their index. */
const slope = ys => {
  const n = ys.length, mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return den > 0 ? num / den : 0;
};
const problems = [];
if (errors.length > 0) problems.push(`page or console errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
problems.push(...stalls);
const judged = readings.slice(WARMUP);
if (judged.length >= 3) {
  const third = Math.max(1, Math.floor(judged.length / 3));
  const middle = judged.slice(third, judged.length - third), last = judged.slice(-third);
  const peak = (list, key) => Math.max(...list.map(r => r[key]));
  for (const key of ['geometries', 'textures', 'programs', 'heapMB']) {
    const allowed = SLACK[key];
    const grew = peak(last, key) - peak(middle.length ? middle : judged, key), trend = slope(judged.map(r => r[key])) * judged.length;
    console.log(`${key}: after the warm-up ${judged.map(r => r[key]).join(' ')}; last third over the middle ${grew.toFixed(1)}, trend ${trend.toFixed(1)} (allowed ${allowed.toFixed(1)})`);
    if (grew > allowed || trend > allowed) problems.push(`${key} grows: ${grew.toFixed(1)} over the middle cycles, a trend of ${trend.toFixed(1)} over ${judged.length} (allowed ${allowed.toFixed(1)})`);
  }
} else {
  console.log(`too few cycles after the warm-up (${judged.length}) to judge a trend`);
}
if (problems.length > 0) {
  console.log(`FAIL\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const menuWorst = Math.max(0, ...matches.map(m => m.menuWorstMs));
console.log(`OK: ${cycles} cycles (${matches.length} matches) in ${((Date.now() - started) / 60000).toFixed(1)} min, no stall over ${STALL_MS} ms in play `
  + `(under the menu's switches ${menuWorst} ms, guard ${MENU_STALL_MS}), no error, no growth (${out})`);

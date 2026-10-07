// A match's first seconds while the realistic look streams in (docs/VISUALS.md, R4 hitches).
//   node tests/match-start.check.mjs URL
// Environment: CS6_PRESET=ultra  CS6_MAP=house  CS6_START_MS=1000  CS6_RUNS=1  CS6_GL=metal|swiftshader
//
// A fresh page on the preset, Start clicked CS6_START_MS into the menu on a map other than the
// menu's backdrop, so the level's sky, texture sets and bake, the first-person weapons and the
// detail kit (R6: its glb and atlases, and the map's merge of it) all stream in while the match
// is live (nothing paused), W held the whole time. Every frame the game renders is timed for the
// first WINDOW_MS after the click. Fails on any gap between rendered frames over STALL_MS after
// the Start click's own frame (the first gesture creates the AudioContext there, before the
// player can move), or if the streams have not all landed by the end, so the window really
// covered them. Real GPU with vsync on (as the player gets it) on
// macOS; SwiftShader elsewhere, where frame times say little.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const preset = process.env.CS6_PRESET ?? 'ultra';
const map = process.env.CS6_MAP ?? 'house';
const startMs = Number(process.env.CS6_START_MS ?? 1000);
const runs = Number(process.env.CS6_RUNS ?? 1);
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const WINDOW_MS = 10_000;
/** A frame this long reads as a step in the player's motion (tests/stairs.mjs failed on one). */
const STALL_MS = 100;

const browser = await chromium.launch({ args: gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`] });
let failed = false;
try {
  for (let run = 1; run <= runs; run++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.live === 1);
    const backdrop = await page.evaluate(({ preset, map }) => {
      const g = window.__game, renderer = g.ctx.renderer, render = renderer.render;
      renderer.render = function (...args) { window.__renders?.push(performance.now()); return render.apply(this, args); };
      g.hud.onUiAction('gfxPreset', preset, new Event('click'));
      g.hud.onUiAction('pickMap', map, new Event('click'));
      return g.level.key;
    }, { preset, map });
    assert.notEqual(backdrop, map, `the menu's backdrop is already ${map}: pick another CS6_MAP`);
    await page.waitForTimeout(startMs);
    await page.keyboard.down('KeyW');
    const clickAt = await page.evaluate(() => { window.__renders = []; return performance.now(); });
    await page.click('.screen-button[data-act="start"]');
    const result = await page.evaluate(({ clickAt, windowMs }) => new Promise(resolve => {
      const g = window.__game, r = g.ctx.renderer, landed = {};
      const pending = { sky: () => r.skyPending, textures: () => r.texturesPending, bake: () => r.bakePending, weapons: () => r.weaponsPending,
        props: () => r.propsPending };
      const atStart = Object.fromEntries(Object.entries(pending).map(([name, is]) => [name, is()]));
      const tick = () => {
        const now = performance.now();
        if (g.player) g.player.hp = 9999;
        for (const [name, is] of Object.entries(pending)) if (!(name in landed) && !is()) landed[name] = Math.round(now - clickAt);
        if (now - clickAt < windowMs) { requestAnimationFrame(tick); return; }
        const renders = window.__renders;
        window.__renders = null;
        // The Start click's own frame is the first gap; from the next one on, the match is running.
        const gaps = renders.slice(1).map((at, i) => [renders[i] - clickAt, at - renders[i]]).slice(1);
        const worst = gaps.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
        const sorted = gaps.map(([, ms]) => ms).sort((a, b) => a - b);
        resolve({ level: g.level.key, state: g.gs.state, frames: renders.length, atStart, landed,
          startFrameMs: Math.round(renders[1] - renders[0]), worstMs: Math.round(worst[1]), worstAtMs: Math.round(worst[0]),
          p95Ms: +sorted[Math.floor((sorted.length - 1) * 0.95)].toFixed(1), over: gaps.filter(([, ms]) => ms > 50).map(([at, ms]) => [Math.round(at), Math.round(ms)]) });
      };
      requestAnimationFrame(tick);
    }), { clickAt, windowMs: WINDOW_MS });
    await page.keyboard.up('KeyW');
    await page.close();
    console.log(`run ${run}: ${JSON.stringify(result)}`);
    const problems = [];
    if (result.level !== map || result.state !== 'play') problems.push(`not in a live ${map} match (${result.level}, ${result.state})`);
    if (result.worstMs > STALL_MS) problems.push(`a ${result.worstMs} ms frame ${result.worstAtMs} ms after Start`);
    const missing = Object.keys(result.atStart).filter(name => !(name in result.landed));
    if (missing.length > 0) problems.push(`still streaming after ${WINDOW_MS} ms: ${missing.join(', ')}`);
    if (errors.length > 0) problems.push(`page errors: ${errors.join(' | ')}`);
    if (problems.length > 0) {
      failed = true;
      console.log(`FAIL run ${run}: ${problems.join('; ')}`);
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
console.log(`OK: no frame over ${STALL_MS} ms in the first ${WINDOW_MS / 1000} s of ${runs} ${preset} ${map} match${runs > 1 ? 'es' : ''} while it streamed`);

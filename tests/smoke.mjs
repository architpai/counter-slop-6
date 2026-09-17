// Phase 1 smoke check: the engine boots inside Next, renders, and StrictMode's
// double-mount leaves exactly one live instance. Run against `npm run dev`.
//   node tests/smoke.mjs [url]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3100/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
page.on('pageerror', e => errors.push(String(e)));

// Old saves must not restore wave selection or skip the start of a run.
await page.addInitScript(() => localStorage.setItem('cs6_checkpoint', '5'));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30_000 });

// Wait for the loop to actually turn over rather than sleeping a fixed span. A
// cold dev server spends its first seconds compiling, which used to make these
// checks flaky -- and a flaky check is one you stop believing.
await page.waitForFunction(() => {
  const t = window.__game?.gs.time ?? 0;
  const seen = window.__smokeT ?? -1;
  window.__smokeT = t;
  return t > 0 && t > seen;
}, null, { timeout: 30_000, polling: 250 });

const report = await page.evaluate(async () => {
  const g = window.__game;
  // Poll rather than sample one fixed window: a compiling dev server can stall
  // the main thread past any window short enough to keep the suite quick.
  const advanced = async () => {
    const t0 = g.gs.time;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (g.gs.time > t0) return true;
    }
    return false;
  };
  return {
    live: g.live,
    advancing: await advanced(),
    canvases: document.querySelectorAll('canvas').length,
    hasHud: !!document.querySelector('#hud .crosshair'),
    screen: document.querySelector('.screen-title')?.textContent ?? null,
    // ARCHITECTURE.md section 8: ctx is built complete at step 9, with only the
    // two actors still null. Nothing in it may be null behind a non-null type.
    ctxComplete: ['scene', 'camera', 'renderer', 'world', 'nav', 'level',
      'input', 'hud', 'effects', 'audio', 'net', 'game']
      .filter(k => g.ctx[k] == null),
    ctxAgreesWithHandle: g.ctx.level === g.level && g.ctx.nav === g.nav,
  };
});

assert.equal(await page.locator('[data-act="checkpoint"], .checkpoints').count(), 0);
// `jumpToWave` stays: debug only, no UI reaches it (game-loop.md §34). What must be gone is the
// checkpoint UI above and any saved wave unlock, both still asserted here.
assert.equal(await page.evaluate(() => 'beginAtWave' in window.__game), false);

// Phase 8: screens are React components wired to real callbacks. Click the
// actual START button rather than calling the engine, because the risk in
// dropping [data-act] delegation is that a button stops reaching game/ui.
await page.click('.screen-button[data-act="start"]');
const clicked = await page.evaluate(() => window.__game.gs.state);
assert.equal(await page.evaluate(() => window.__game.gs.wave), 1);

// Back to the main screen, then prove the backdrop still advances the screen:
// a click that misses every [data-ui-block] must reach onScreenClick.
await page.evaluate(() => window.__game.hud.onUiAction?.('mainMenu', null, new Event('click')));
await page.waitForFunction(() => window.__game.gs.state === 'start');
await page.mouse.click(20, 20);
const backdrop = await page.evaluate(() => window.__game.gs.state);

// Physics, nav and the springs only run during play, so the menu alone proves
// very little about them. Start a solo wave and let it simulate.
await page.evaluate(() => {
  window.__startPos = null;
  window.__game.beginSolo();
  window.__startPos = window.__game.player.body.pos.clone();
});
// Wave 1 staggers its spawns, so poll for the first enemy instead of guessing
// how long that takes on a loaded machine.
await page.waitForFunction(() => window.__game.enemies.list.length > 0,
  null, { timeout: 20_000, polling: 250 });

const play = await page.evaluate(async () => {
  const g = window.__game;
  const start = window.__startPos;
  await new Promise(r => setTimeout(r, 1200));
  return {
    state: g.gs.state,
    spawned: g.enemies.list.length,
    // Gravity alone must resolve the player onto the ground via World.moveBody.
    onGround: g.player.body.onGround,
    finite: Number.isFinite(g.player.body.pos.y) && g.player.body.pos.distanceTo(start) < 1e3,
    navNodes: g.nav.nodes.length,
    hp: g.player.hp,
  };
});

// Phase 3 converted input, audio and effects. Drive them: a real keydown must
// reach the action map and move the player, a gesture must open the audio
// context, and firing must spawn particles.
await page.mouse.move(640, 360);
await page.keyboard.down('w');
const driven = await page.evaluate(async () => {
  const g = window.__game;
  const before = g.player.body.pos.clone();
  await new Promise(r => setTimeout(r, 700));
  const moved = g.player.body.pos.distanceTo(before);
  const wasDown = g.input.down('forward');
  g.player.weapons[0].mag = 30;
  g.ctx.effects.smoke(g.player.eye, g.player.forward, 12);
  await new Promise(r => setTimeout(r, 120));
  return {
    moved,
    wasDown,
    audioState: g.ctx.audio.ctx ? g.ctx.audio.ctx.state : 'none',
    magazine: document.querySelector('[data-hud="magazine"]')?.textContent ?? null,
    hp: document.querySelector('[data-hud="hp"]')?.textContent ?? null,
  };
});
await page.keyboard.up('w');

// Phase 7: continuous HUD writes must bypass React. Keep the engine in active
// gameplay with no enemies or solo-wave events, then compare React work with
// browser frames over two seconds.
const hudWork = await page.evaluate(async () => {
  const g = window.__game;
  g.enemies.clear();
  g.gs.queue.length = 0;
  g.gs.mode = 'ffa';
  await new Promise(r => setTimeout(r, 250));
  const before = window.__hudRenderCount ?? 0;
  let frames = 0;
  const end = performance.now() + 2000;
  await new Promise(resolve => {
    const tick = now => {
      frames++;
      if (now >= end) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { frames, renders: (window.__hudRenderCount ?? 0) - before };
});

const shot = await page.screenshot();
const blank = shot.length < 8000;

// Reach a boss-wave boundary without playing ten waves. It must not save an
// unlock. Pause keeps the run; death and returning to the menu both reset it.
await page.evaluate(() => {
  const g = window.__game;
  g.gs.mode = 'solo'; g.gs.state = 'play';
  g.enemies.clear(); g.gs.queue.length = 0;
  g.gs.wave = 9; g.gs.intermission = .01; g.gs.score = 700;
});
await page.waitForFunction(() => window.__game.gs.wave === 10);
assert.equal(await page.evaluate(() => localStorage.getItem('cs6_checkpoint')), '5');
assert.equal(await page.evaluate(() => window.__game.hud.killFeed.some(row => row.text.includes('CHECKPOINT'))), false);
await page.keyboard.down('KeyP');
await page.waitForFunction(() => window.__game.gs.state === 'pause');
await page.keyboard.up('KeyP');
await page.evaluate(() => window.__game.hud.onUiAction?.('checkpoint', '5', new Event('click')));
assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause');
await page.mouse.click(20, 20);
await page.waitForFunction(() => window.__game.gs.state === 'play');
assert.equal(await page.evaluate(() => window.__game.gs.wave), 10);
await page.evaluate(() => {
  const g = window.__game;
  g.player.takeDamage(100000); g.gs.deathT = 2;
});
await page.waitForFunction(() => window.__game.gs.state === 'dead');
assert.equal(await page.locator('[data-act="checkpoint"], .checkpoints').count(), 0);
assert.match(await page.locator('.screen-prompt').innerText(), /RESTART AT WAVE 1/);
assert.equal(await page.evaluate(() => Number(localStorage.getItem('cs6_best'))), 700);
await page.mouse.click(20, 20);
await page.waitForFunction(() => window.__game.gs.state === 'play');
assert.equal(await page.evaluate(() => window.__game.gs.wave), 1);
assert.equal(await page.evaluate(() => window.__game.gs.score), 0);
await page.evaluate(() => window.__game.hud.onUiAction?.('mainMenu', null, new Event('click')));
await page.waitForFunction(() => window.__game.gs.state === 'start');
assert.equal(await page.locator('[data-act="checkpoint"], .checkpoints').count(), 0);
await page.locator('[data-act="start"]').click();
assert.equal(await page.evaluate(() => window.__game.gs.wave), 1);
console.log('  ok  checkpoints removed; old saves ignored, boss unlocks disabled, pause preserved, retries start at wave 1, best score retained');

// StrictMode alone does not exercise dispose(): the `cancelled` guard usually
// wins the race against the dynamic import. HMR and route changes do exercise
// it, so drive it by hand.
const teardown = await page.evaluate(async () => {
  const g = window.__game;
  g.dispose();
  const t0 = g.gs.time;
  await new Promise(r => setTimeout(r, 300));
  return {
    live: g.live,
    frozen: g.gs.time === t0,
    idempotent: (() => { try { g.dispose(); return g.live === 0; } catch { return false; } })(),
    hudCleared: document.querySelector('#hud .crosshair') === null,
  };
});

let fail = 0;
const check = (ok, label) => { console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}`); if (!ok) fail++; };

check(errors.length === 0, `no console errors${errors.length ? `: ${errors[0]}` : ''}`);
check(report.canvases === 1, `exactly one canvas (got ${report.canvases})`);
check(report.live === 1, `one live engine instance (got ${report.live})`);
check(report.advancing, 'frame loop is advancing gs.time');
check(report.hasHud, 'HUD elements mounted');
check(report.screen !== null, `main screen rendered (${report.screen})`);
check(clicked === 'play', `clicking the real START button starts the game (state ${clicked})`);
check(backdrop === 'play', `a backdrop click still advances the screen (state ${backdrop})`);
check(report.ctxComplete.length === 0,
  `ctx fully populated at boot${report.ctxComplete.length ? `; null: ${report.ctxComplete.join(', ')}` : ''}`);
check(report.ctxAgreesWithHandle, 'ctx.level/nav and the debug handle are the same objects');
check(!blank, `canvas is drawing (screenshot ${shot.length} bytes)`);
check(play.state === 'play', `solo wave started (state ${play.state})`);
check(play.navNodes > 0, `nav grid built (${play.navNodes} nodes)`);
check(play.onGround, 'physics resolved the player onto the ground');
check(play.finite, 'player position stayed finite and bounded');
check(play.spawned > 0, `enemies spawned (${play.spawned})`);
check(play.hp > 0, `player alive after 2.5 s (hp ${play.hp})`);
check(driven.wasDown, "input mapped KeyW to the 'forward' action");
check(driven.moved > 0.5, `player moved under key input (${driven.moved.toFixed(2)} m)`);
check(driven.audioState !== 'none', `audio context opened (${driven.audioState})`);
check(driven.magazine === '30', `HUD magazine reflects engine state (${driven.magazine})`);
check(driven.hp === '120', `HUD health reflects engine state (${driven.hp})`);
check(hudWork.frames > 0 && hudWork.renders < Math.max(5, hudWork.frames / 5),
  `HUD React work stays far below frame count (${hudWork.renders} renders / ${hudWork.frames} frames)`);
check(teardown.live === 0, `dispose() drops the instance count (got ${teardown.live})`);
check(teardown.frozen, 'dispose() stops the frame loop');
check(teardown.idempotent, 'dispose() is idempotent');
check(teardown.hudCleared, 'dispose() clears the HUD');
check(errors.length === 0, `no errors during teardown${errors.length ? `: ${errors.at(-1)}` : ''}`);

await browser.close();
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);

// Phase 1 smoke check: the engine boots inside Next, renders, and StrictMode's
// double-mount leaves exactly one live instance. Run against `npm run dev`.
//   node tests/smoke.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3100/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30_000 });
await page.waitForTimeout(1500); // let StrictMode's remount settle and frames run

const report = await page.evaluate(async () => {
  const g = window.__game;
  const t0 = g.gs.time;
  await new Promise(r => setTimeout(r, 300));
  return {
    live: g.live,
    advancing: g.gs.time > t0,
    canvases: document.querySelectorAll('canvas').length,
    hasHud: !!document.querySelector('#hud .crosshair'),
    screen: document.querySelector('.screen-title')?.textContent ?? null,
  };
});

// Physics, nav and the springs only run during play, so the menu alone proves
// very little about them. Start a solo wave and let it simulate.
const play = await page.evaluate(async () => {
  const g = window.__game;
  g.beginSolo();
  const start = g.player.body.pos.clone();
  const settled = () => new Promise(r => setTimeout(r, 2500));
  await settled();
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

const shot = await page.screenshot();
const blank = shot.length < 8000;

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
check(teardown.live === 0, `dispose() drops the instance count (got ${teardown.live})`);
check(teardown.frozen, 'dispose() stops the frame loop');
check(teardown.idempotent, 'dispose() is idempotent');
check(teardown.hudCleared, 'dispose() clears the HUD');
check(errors.length === 0, `no errors during teardown${errors.length ? `: ${errors.at(-1)}` : ''}`);

await browser.close();
console.log(fail ? `\n${fail} failed` : '\nall passed');
process.exit(fail ? 1 : 0);

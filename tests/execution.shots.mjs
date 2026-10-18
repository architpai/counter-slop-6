// Screenshots of the samurai execution in training: marking (two locked), the dash, the cut targets before the
// sheathe, and after. The page's frame loop is held and the game is stepped by hand, 60 steps a second.
// Run with a local app server: node tests/execution.shots.mjs http://localhost:3000 [/tmp/shooter-exec] [low|medium|high|ultra]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-exec';
const preset = process.argv[4] ?? null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('cs6_loadout', 'r4c,pistol,sword');
  // While `__hold` is set, the game's frame loop waits and `__frames(n)` steps it.
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__hold ? 0 : raf(cb));
});
if (preset) await page.addInitScript(preset => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset, custom: null, fpsCounter: false, auto: null })), preset);
const tag = preset ?? 'auto';
const shot = name => page.screenshot({ path: `${out}/${tag}-${name}.png` });
const phase = () => page.evaluate(() => window.__game.gs.focus.phase);
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training' && window.__game.gs.state === 'play');
  if (preset && preset !== 'low') await page.waitForFunction(() => window.__game.ctx.renderer.weapons?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(preset ? 4000 : 1500);
  await page.evaluate(() => {
    const g = window.__game, input = g.input, down = input.down.bind(input), pressed = input.pressed.bind(input);
    window.__hold = true;
    let now = performance.now();
    input.update = () => {};
    window.__buttons = { held: false, tap: false };
    input.down = action => (window.__buttons.held && (action === 'aim' || action === 'fire')) || down(action);
    input.pressed = action => (window.__buttons.tap && (action === 'aim' || action === 'fire')) || pressed(action);
    window.__frames = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; g.step(now); window.__buttons.tap = false; } };
    // Three dummies in front, at different ranges and sides.
    window.__targets = g.enemies.list.filter(e => e.alive).map(e => ({ e, d: e.center.distanceTo(g.player.eye) }))
      .filter(t => t.d > 5 && t.d < 22).sort((a, b) => a.d - b.d).slice(0, 3).map(t => t.e);
    window.__look = e => {
      const p = g.player, d = e.center.clone().sub(p.eye);
      p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    };
    window.__look(window.__targets[1]);
    g.gs.katanaStreak = 3;
    window.__frames(5);
  });
  assert.equal(await page.evaluate(() => window.__targets.length), 3, 'three training targets in reach');
  await shot('ready');
  await page.evaluate(() => { window.__buttons.held = window.__buttons.tap = true; window.__frames(1); });
  assert.equal(await phase(), 'mark');
  await page.evaluate(() => { for (const e of window.__targets.slice(0, 2)) { window.__look(e); window.__frames(6); } window.__frames(10); });
  await shot('marking');
  await page.evaluate(() => { window.__look(window.__targets[2]); window.__frames(1); });
  assert.equal(await phase(), 'dash');
  await page.evaluate(() => window.__frames(8));
  await shot('dash');
  for (let i = 0; i < 120 && await phase() === 'dash'; i++) await page.evaluate(() => window.__frames(1));
  assert.equal(await phase(), 'finish');
  await page.evaluate(() => window.__frames(6));
  await shot('cut');
  await page.evaluate(() => { window.__buttons.held = false; window.__frames(40); });
  assert.equal(await phase(), 'idle');
  await shot('after');
  assert.deepEqual(errors, []);
  console.log(`OK: execution screenshots in ${out}`);
} finally {
  await browser.close();
}

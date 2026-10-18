// Screenshots of the .50 pistol in training: at the hip, aimed, and on the first frame of a shot.
// Run with a local app server: node tests/pistol.shots.mjs http://localhost:3000 [/tmp/shooter-pistol] [low|medium|high|ultra]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-pistol';
const preset = process.argv[4] ?? null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('cs6_loadout', 'pistol,r4c,sword'));
if (preset) await page.addInitScript(preset => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset, custom: null, fpsCounter: false, auto: null })), preset);
const tag = preset ?? 'auto';
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training');
  assert.equal(await page.evaluate(() => window.__game.player.weapon.kind), 'pistol');
  if (preset && preset !== 'low') await page.waitForFunction(() => window.__game.ctx.renderer.weapons?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(preset ? 4000 : 1000);
  // Paused and stepped by hand, so each shot is at a set point.
  await page.evaluate(() => {
    const g = window.__game, down = g.input.down.bind(g.input), pressed = g.input.pressed.bind(g.input);
    g.gs.state = 'pause';
    g.input.update = () => {};
    window.pistolStep = (n, held = [], tap = []) => {
      g.input.down = action => held.includes(action) || down(action);
      g.input.pressed = action => tap.includes(action) || pressed(action);
      try { for (let i = 0; i < n; i++) { g.player.update(1 / 60); tap = []; } } finally { g.input.down = down; g.input.pressed = pressed; }
    };
    window.pistolStep(40);
  });
  await page.screenshot({ path: `${out}/${tag}-hip.png` });
  await page.evaluate(() => window.pistolStep(1, ['fire'], ['fire']));
  await page.screenshot({ path: `${out}/${tag}-fire.png` });
  await page.evaluate(() => window.pistolStep(40, ['aim']));
  await page.screenshot({ path: `${out}/${tag}-aimed.png` });
  assert.deepEqual(errors, []);
  console.log(`OK: pistol screenshots in ${out}`);
} finally {
  await browser.close();
}

// Screenshots of the sword and the loadout picker: the Weapons menu page, then in training the sword at the hip,
// at full guard, mid-slash and throwing an air slash, and the LMG for scale.
// Run with a local app server: node tests/sword.shots.mjs http://localhost:3000 [/tmp/shooter-sword] [low|medium|high|ultra]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-sword';
const preset = process.argv[4] ?? null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
if (preset) await page.addInitScript(preset => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset, custom: null, fpsCounter: false, auto: null })), preset);
const tag = preset ?? 'auto';
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  // The Weapons page: drop the pistol, pick the LMG into its slot, which saves r4c, lmg, sword.
  await page.locator('.menu-nav button', { hasText: 'weapons' }).click();
  await page.locator('.loadout-card[data-value="pistol"]').click();
  assert.equal(await page.locator('.slot-empty').count(), 1);
  await page.screenshot({ path: `${out}/${tag}-menu-picking.png` });
  await page.locator('.loadout-card[data-value="lmg"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('cs6_loadout')), 'r4c,lmg,sword');
  // Full: a tap on another weapon changes nothing (dragging it onto a slot swaps it in).
  await page.locator('.loadout-card[data-value="sniper"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('cs6_loadout')), 'r4c,lmg,sword');
  await page.mouse.move(10, 450);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${tag}-menu-loadout.png` });
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training');
  assert.deepEqual(await page.evaluate(() => window.__game.player.loadout), ['r4c', 'lmg', 'sword']);
  await page.evaluate(() => window.__game.player.switchTo(2));
  // The realistic tiers stream their Blender weapons in after the level.
  if (preset && preset !== 'low') await page.waitForFunction(() => window.__game.ctx.renderer.weapons?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(preset ? 4000 : 1000);
  // From here the run is paused and the player is stepped by hand, so each shot is at a set point of a slash.
  await page.evaluate(() => {
    const g = window.__game, down = g.input.down.bind(g.input);
    g.gs.state = 'pause';
    g.input.update = () => {};
    window.swordStep = (n, held = []) => {
      g.input.down = action => held.includes(action) || down(action);
      try { for (let i = 0; i < n; i++) g.player.update(1 / 60); } finally { g.input.down = down; }
    };
    window.swordStep(30);
  });
  await page.screenshot({ path: `${out}/${tag}-hip.png` });
  await page.evaluate(() => window.swordStep(30, ['aim']));
  assert.equal(await page.evaluate(() => window.__game.player.blocking), true);
  await page.screenshot({ path: `${out}/${tag}-guard.png` });
  await page.evaluate(() => window.swordStep(30));
  // A slash, at a fifth, half and three quarters of its arc.
  await page.evaluate(() => { const p = window.__game.player; p.sword.startSlash(p.weaponState()); window.swordStep(4); });
  await page.screenshot({ path: `${out}/${tag}-slash-a.png` });
  await page.evaluate(() => window.swordStep(5));
  await page.screenshot({ path: `${out}/${tag}-slash-b.png` });
  await page.evaluate(() => window.swordStep(5));
  await page.screenshot({ path: `${out}/${tag}-slash-c.png` });
  await page.evaluate(() => window.swordStep(40));
  // The air slash: a jump, then a slash on the way up; the wave 4 m out.
  await page.evaluate(() => {
    const p = window.__game.player;
    p.body.vel.y = 9.6; p.body.onGround = false; window.swordStep(8);
    p.sword.startSlash(p.weaponState()); window.swordStep(8);
  });
  assert.equal(await page.evaluate(() => window.__game.player.waves.length), 1);
  await page.screenshot({ path: `${out}/${tag}-air-slash.png` });
  await page.evaluate(() => { window.swordStep(80); window.__game.player.switchTo(1, true); window.swordStep(60); });
  await page.screenshot({ path: `${out}/${tag}-lmg.png` });
  assert.deepEqual(errors, []);
  console.log(`OK: sword screenshots in ${out}`);
} finally {
  await browser.close();
}

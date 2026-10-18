// Browser check for loadout timing: in solo, a pick made mid-wave waits for the wave clear; in training it applies at once.
// node tests/loadout.check.mjs [url]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const loadout = () => page.evaluate(() => window.__game.player.loadout.join(','));
const pick = kind => page.evaluate(kind => window.__game.hud.onUiAction('loadout', kind, new Event('click')), kind);
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  assert.equal(await loadout(), 'r4c,pistol,sword');
  await page.locator('[data-act="start"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'solo' && window.__game.gs.state === 'play' && window.__game.gs.wave === 1);
  await page.evaluate(() => { window.__game.gs.intermission = 0; });
  // Mid-wave: the pick is saved, the player keeps their weapons.
  await pick('pistol'); await pick('lmg');
  assert.equal(await page.evaluate(() => localStorage.getItem('cs6_loadout')), 'r4c,sword,lmg');
  await page.waitForTimeout(500);
  assert.equal(await loadout(), 'r4c,pistol,sword', 'a pick made mid-wave waits');
  // The wave is cleared: the break between waves hands the new weapons over.
  await page.evaluate(() => { window.__game.gs.intermission = 8; });
  await page.waitForFunction(() => window.__game.player.loadout.join(',') === 'r4c,sword,lmg');
  // Training applies a pick at once.
  await page.evaluate(() => { window.__game.gs.state = 'start'; });
  await page.locator('[data-act="training"]').click().catch(() => page.evaluate(() => window.__game.hud.onUiAction('training', null, new Event('click'))));
  await page.waitForFunction(() => window.__game.gs.mode === 'training' && window.__game.gs.state === 'play');
  await pick('lmg'); await pick('sniper');
  await page.waitForFunction(() => window.__game.player.loadout.join(',') === 'r4c,sword,sniper');
  assert.deepEqual(errors, []);
  console.log('OK: solo picks wait for the wave clear; training applies them at once');
} finally {
  await browser.close();
}

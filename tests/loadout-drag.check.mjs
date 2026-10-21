// Browser check for the loadout slots on the pause menu's Weapons page, with real mouse drags.
// Mid-wave, a new order of the weapons carried applies at once (the gun in hand and its ammo stay);
// a new weapon waits for the wave clear. Keyboard focus follows the weapon. A drop never resumes the game. Screenshots go to the folder given.
// node tests/loadout-drag.check.mjs [url] [/tmp/shooter-loadout]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-loadout';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const carried = () => page.evaluate(() => window.__game.player.loadout.join(','));
const saved = () => page.evaluate(() => localStorage.getItem('cs6_loadout'));
const slot = i => page.locator(`[data-slot="${i}"]`);
/** A mouse drag from the middle of `from` to the middle of `to`, or to the point `at`. */
async function drag(from, to, at = null) {
  const a = await from.boundingBox(), b = at ?? await to.boundingBox().then(box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 180000 });
  assert.equal(await carried(), 'r4c,pistol,sword');
  await page.evaluate(() => window.__game.beginSolo());
  await page.waitForFunction(() => window.__game.gs.state === 'play');
  await page.evaluate(() => { window.__game.gs.intermission = 0; window.__game.pause(); });
  await page.locator('.menu-nav button', { hasText: 'weapons' }).click();
  await page.waitForTimeout(300);
  const zoom = await page.evaluate(() => Number(document.querySelector('.screen-panel').style.zoom));
  await page.screenshot({ path: `${out}/pause-weapons.png` });
  assert.ok(zoom > 0.85, `the Weapons page fits 1280x720 with little shrinking (0.59 when it was one tall column) (zoom ${zoom})`);
  await page.screenshot({ path: `${out}/pause-weapons.png` });
  const ammo = await page.evaluate(() => window.__game.player.weapons.map(w => `${w.mag}/${w.reserve}`).join());

  // Slot 3 onto slot 1: a swap of the weapons carried, so it applies now.
  await drag(slot(2).locator('.slot-weapon'), slot(0));
  assert.equal(await saved(), 'sword,pistol,r4c');
  assert.equal(await carried(), 'sword,pistol,r4c', 'a new order applies mid-wave');
  assert.deepEqual(await page.evaluate(() => [window.__game.player.weapon.kind, window.__game.player.wi]), ['r4c', 2], 'the gun in hand stays');
  assert.equal(await page.evaluate(() => window.__game.player.weapons.map(w => `${w.mag}/${w.reserve}`).join()),
    ammo.split(',').reverse().join(), 'every ammo count goes with its weapon');
  assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause', 'a drop does not resume');

  // The move buttons do the same for the keyboard: the pistol up to slot 1.
  await slot(1).getByRole('button', { name: /Move .50 PISTOL up/ }).click();
  assert.equal(await carried(), 'pistol,sword,r4c');

  // The keyboard: focus follows the weapon, so two presses move it two slots.
  await slot(0).getByRole('button', { name: /Move .50 PISTOL down/ }).focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal(await carried(), 'sword,r4c,pistol', 'two presses of move down take slot 1 to slot 3');
  await slot(2).getByRole('button', { name: /Move .50 PISTOL up/ }).focus();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  assert.equal(await carried(), 'pistol,sword,r4c');

  // The LMG from the arsenal onto slot 2: a new weapon, so it waits for the wave clear.
  await drag(page.locator('.loadout-card[data-value="lmg"]'), slot(1));
  assert.equal(await saved(), 'pistol,lmg,r4c');
  assert.equal(await carried(), 'pistol,sword,r4c', 'a new weapon waits mid-wave');
  assert.match(await page.locator('.loadout-picker').textContent(), /Applies when this wave is cleared/);

  // Slot 2 dragged off the slots empties it; the slots keep their places.
  await drag(slot(1).locator('.slot-weapon'), page.locator('.loadout-card[data-value="shotgun"]'));
  assert.equal(await slot(1).locator('.slot-empty').count(), 1);
  assert.deepEqual(await page.locator('.slot-weapon').evaluateAll(els => els.map(el => el.dataset.value)), ['pistol', 'r4c']);
  assert.match(await page.locator('.loadout-picker').textContent(), /Pick 1 more/);
  await page.screenshot({ path: `${out}/pause-weapons-picking.png` });
  // A tap fills the empty slot, in its place.
  await page.locator('.loadout-card[data-value="sniper"]').click();
  assert.equal(await saved(), 'pistol,sniper,r4c');
  assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause');

  // Enter on a slot empties it and focus goes to that weapon's arsenal card, so Space taps it back, not resume.
  await slot(1).locator('.slot-weapon').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.value), 'sniper');
  await page.keyboard.press('Space');
  assert.equal(await saved(), 'pistol,sniper,r4c');
  assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause');

  // A slot dropped on the backdrop, outside the panel: the slot empties and the game stays paused.
  await drag(slot(1).locator('.slot-weapon'), page.locator('.screen-overlay'), { x: 20, y: 360 });
  assert.equal(await slot(1).locator('.slot-empty').count(), 1);
  assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause', 'a drop on the backdrop does not resume');
  await page.locator('.loadout-card[data-value="sniper"]').click();
  assert.equal(await saved(), 'pistol,sniper,r4c');

  // The Controls and Settings pages at the new width.
  for (const name of ['controls', 'settings']) {
    await page.locator('.menu-nav button', { hasText: name }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/pause-${name}.png` });
  }

  // Resume: key 1 draws what slot 1 holds.
  await page.evaluate(() => window.__game.resume());
  await page.waitForFunction(() => window.__game.gs.state === 'play');
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__game.player.weapon.kind === 'pistol');

  assert.deepEqual(errors, []);
  console.log('OK: drag and move reorder at once mid-wave; a new weapon waits; a slot empties in place; key 1 follows the order');
} finally {
  await browser.close();
}

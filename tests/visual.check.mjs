// Visual-polish smoke check. Run against npm run dev:
//   node tests/visual.check.mjs [url] [screenshot-directory]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const output = process.argv[3];
if (output) await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const shot = async name => { if (output) await page.screenshot({ path: `${output}/${name}.png` }); };
const fits = async () => {
  await settle();
  const bounds = await page.locator('.screen-panel').boundingBox();
  const size = page.viewportSize();
  assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width + 1 && bounds.y + bounds.height <= size.height + 1, 'menu fits the viewport');
  assert(await page.locator('.screen-panel').evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), 'menu has no internal scroll');
};

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.evaluate(() => window.__game.hud.setDevice(true));
  await page.locator('.control-column[data-device="gamepad"]').waitFor();
  assert(await page.getByText(/to start solo/).isVisible(), 'controller-only players see controls and a start prompt');
  await page.evaluate(() => window.__game.hud.setDevice(false));
  for (const [width, height] of [[1440, 900], [900, 600]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.__game.hud.onUiAction('mainMenu', null, new Event('click')));
    await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.map-previews img')];
      return images.length === 3 && images.every(img => img.complete && img.naturalWidth > 0);
    });
    await fits();
    await shot(`menu-${width}`);

    // Keyboard activation of menu navigation must not start a game.
    await page.getByRole('button', { name: 'controls', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__game.gs.state), 'start');
    assert.equal(await page.locator('.control-column').count(), 1);
    await page.getByRole('button', { name: 'Controller', exact: true }).click();
    assert.equal(await page.locator('.control-column').getAttribute('data-device'), 'gamepad');
    await fits();
    await shot(`controls-${width}`);
    await page.getByRole('button', { name: 'Mouse + keyboard', exact: true }).click();
    assert.equal(await page.locator('.control-column').getAttribute('data-device'), 'keyboard');
    await fits();

    await page.getByRole('button', { name: 'settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'invert vertical look' }).check();
    assert.equal(await page.evaluate(() => window.__game.input.invertY), true);
    await page.getByRole('checkbox', { name: 'invert vertical look' }).uncheck();
    await fits();
    await shot(`settings-${width}`);

    await page.getByRole('button', { name: 'weapons', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__game.gs.state), 'start');
    assert.equal(await page.getByRole('group', { name: /scope$/ }).count(), 2);
    await fits();
    await shot(`weapons-${width}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await fits();
    await shot('weapons-mobile');
    await page.setViewportSize({ width, height });

    await page.getByRole('button', { name: 'play', exact: true }).click();
    await page.getByRole('button', { name: /THE HOUSE/ }).click();
    assert.equal(await page.getByRole('button', { name: /THE HOUSE/ }).getAttribute('aria-pressed'), 'true');
    // Freeze the scene through the existing debug surface for repeatable HUD bounds.
    await page.evaluate(() => {
      const g = window.__game;
      g.beginSolo(); g.gs.state = 'pause'; g.enemies.clear(); g.gs.queue.length = 0;
      for (let i = 0; i < 90; i++) g.player.update(1 / 60);
      g.hud.update(10); g.ctx.audio.music(false);
      g.hud.tip('hold <b>Q</b> to reel in · tap it again to let go mid-swing', 10);
    });
    assert.equal(await page.evaluate(() => window.__game.level.key), 'house');
    await settle();
    const tip = await page.locator('.tip-line').boundingBox();
    // The tip sits low and centred now, between the corner clusters: what matters is that it
    // never covers them, not that it clears their tops.
    for (const selector of ['.bottom-left', '.bottom-right']) {
      const hud = await page.locator(selector).boundingBox();
      const clear = tip && hud && (tip.y + tip.height <= hud.y || hud.y + hud.height <= tip.y
        || tip.x + tip.width <= hud.x || hud.x + hud.width <= tip.x);
      assert(clear, 'tips never cover health, ammo and slots');
    }
    await shot(`hud-${width}`);
    await page.evaluate(() => {
      const g = window.__game;
      g.gs.state = 'play'; g.gs.menu = false; g.input.onLockChange(false);
    });
    assert.equal(await page.locator('.screen-title').textContent(), 'PAUSED');
    await fits();
    await shot(`pause-${width}`);
    await page.getByRole('button', { name: 'weapons', exact: true }).click();
    await page.getByRole('group', { name: 'R4-C scope', exact: true }).getByRole('button', { name: 'HOLO · 1×', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__game.gs.state), 'pause');
    assert.equal(await page.evaluate(() => window.__game.player.weapons[0].scopeKind), 'holo');
    await fits();
    await shot(`pause-weapons-${width}`);
    await page.getByRole('button', { name: 'MAIN MENU', exact: true }).click();
    await page.getByRole('button', { name: /PLAY ONLINE/ }).click();
    await fits();
    await shot(`online-${width}`);
    await page.getByRole('button', { name: 'BACK', exact: true }).click();
    console.log(`OK menu pages, map previews, keyboard, settings, HUD, pause, online ${width}x${height}`);
  }
  assert.deepEqual(errors, [], 'no browser errors');
} finally {
  await browser.close();
}

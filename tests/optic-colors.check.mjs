// Run: node tests/optic-colors.check.mjs http://localhost:3000 [/tmp/shooter-optic-colors]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-optic-colors';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training');
  for (const slot of [0, 1]) for (const kind of ['acog', 'holo']) {
    await page.evaluate(({ slot, kind }) => {
      const player = window.__game.player;
      player.switchTo(slot);
      player.weapon.setOptic(kind);
    }, { slot, kind });
    await page.waitForFunction(() => !window.__game.hud.scope.shown && window.__game.player.weapon.root.visible && window.__game.ctx.camera.fov > 80);
    await page.screenshot({ path: `${out}/${slot + 1}-${kind}-hip.png` });
    await page.mouse.down({ button: 'right' });
    await page.waitForFunction(kind => window.__game.hud.scope.shown && window.__game.hud.scope.kind === kind && !window.__game.player.weapon.root.visible, kind);
    const matches = await page.evaluate(kind => {
      const root = window.__game.player.weapon.root;
      const pairs = kind === 'acog' ? [
        ['acog-tube', '#acog-metal stop[offset=".3"]', 'stop-color'],
        ['acog-ocular', '#acog-metal stop[offset=".3"]', 'stop-color'],
        ['acog-ocular-rim', '#acog-bevel stop[offset="1"]', 'stop-color'],
      ] : [
        ['holo-frame-top', '.holo-optic > path:nth-child(2)', 'fill'],
        ['holo-base', '.holo-optic > path:first-child', 'fill'],
        ['holo-dot', '.holo-reticle', 'color'],
      ];
      return pairs.map(([part, selector, attribute]) => ({
        part, model: `#${root.getObjectByName(part).material.color.getHexString()}`,
        overlay: document.querySelector(selector).getAttribute(attribute),
      }));
    }, kind);
    for (const match of matches) assert.equal(match.model, match.overlay, `slot ${slot + 1} ${match.part} matches its overlay`);
    assert.equal(await page.locator(`.${kind}-reticle`).evaluate(el => getComputedStyle(el).color), 'rgb(237, 36, 40)');
    await page.screenshot({ path: `${out}/${slot + 1}-${kind}-ads.png` });
    await page.mouse.up({ button: 'right' });
    await page.waitForFunction(() => !window.__game.hud.scope.shown && window.__game.player.weapon.root.visible);
  }
  assert.deepEqual(errors, []);
  console.log(`OK: ACOG/Holo model and overlay colors match on R4-C and MP5. Screenshots: ${out}`);
} finally {
  await browser.close();
}

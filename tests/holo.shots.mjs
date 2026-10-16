// Screenshots of the holographic sight: at the hip, aimed and still, and aimed with the hood swung off the eye line.
// Run with a local app server: node tests/holo.shots.mjs http://localhost:3000 [/tmp/shooter-holo] [low|medium|high|ultra]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-holo';
const preset = process.argv[4] ?? null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
if (preset) await page.addInitScript(preset => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset, custom: null, fpsCounter: false, auto: null })), preset);
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training');
  await page.evaluate(() => { const p = window.__game.player; p.switchTo(0); p.weapon.setOptic('holo'); });
  await page.waitForTimeout(preset ? 6000 : 800);
  await page.screenshot({ path: `${out}/hip.png` });
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__game.hud.scope.shown && window.__game.hud.scope.kind === 'holo');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/aimed.png` });
  // The hood off the eye line: the near edge and the far window part, the reticle stays on the screen centre.
  for (const [name, x, y] of [['drift-right', 60, 35], ['drift-left', -60, -40]]) {
    await page.evaluate(([x, y]) => {
      const hud = window.__game.hud;
      hud.__drift ??= hud.setScopeDrift.bind(hud);
      hud.setScopeDrift = () => hud.__drift(x, y, 1);
    }, [x, y]);
    await page.waitForTimeout(300);
    const centre = await page.evaluate(() => {
      const ring = document.querySelector('.holo-ring').getBoundingClientRect();
      return [ring.x + ring.width / 2, ring.y + ring.height / 2];
    });
    assert.ok(Math.abs(centre[0] - 720) < 1.5 && Math.abs(centre[1] - 450) < 1.5, `${name}: the reticle stays on the aim point (${centre})`);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await page.mouse.up({ button: 'right' });
  assert.deepEqual(errors, []);
  console.log(`OK: holo screenshots in ${out}`);
} finally {
  await browser.close();
}

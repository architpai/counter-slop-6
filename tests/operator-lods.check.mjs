// Live Textures switches with realistic operators (R7) in play: Ultra, Medium, High and back, in a
// solo match with grunts in view, each step once the operators are in again. A switch changes the
// operators' LOD or map size (render/operators.ts), frees the old maps and puts the new ones on; no
// frame may bind a freed map (the shadow pass's depth material once kept an operator's albedo after
// it was freed, and three threw uploading it again).
//   node tests/operator-lods.check.mjs URL
// Environment: CS6_GL=metal|swiftshader
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const STEPS = ['ultra', 'medium', 'ultra', 'high', 'medium', 'high', 'ultra'];
const browser = await chromium.launch({ args: gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  const preset = p => page.evaluate(p => window.__game.hud.onUiAction('gfxPreset', p, new Event('click')), p);
  await preset(STEPS[0]);
  await page.evaluate(() => window.__game.beginSolo());
  for (const [i, step] of STEPS.entries()) {
    if (i > 0) await preset(step);
    // The next frames ask for the new LOD and size (LOD1 with Medium's maps); wait until they are on.
    await page.waitForFunction(lod => {
      const r = window.__game.ctx.renderer;
      return r.operators.lod === lod && !r.operatorsPending;
    }, step === 'medium' ? 1 : 0, { timeout: 60_000 });
    // Grunts in front of the player, in view, and the player kept alive; two seconds of play.
    await page.evaluate(() => {
      const g = window.__game, V = g.player.body.pos.constructor, ahead = new V();
      g.ctx.camera.getWorldDirection(ahead);
      ahead.y = 0;
      ahead.normalize();
      g.player.hp = 1e9;
      for (const d of [6, 9]) g.enemies.spawn('grunt', g.player.body.pos.clone().addScaledVector(ahead, d));
    });
    await page.waitForTimeout(2000);
    const state = await page.evaluate(() => ({ ready: window.__game.ctx.renderer.operators.ready, live: window.__game.gs.state }));
    console.log(`${step}: operators ${state.ready ? 'in' : 'not in'}, ${errors.length} errors`);
    assert.equal(state.ready, true, `${step}: the operators are in`);
    assert.deepEqual(errors, [], `${step}: no page errors`);
  }
  console.log('OK: live Textures switches with operators in play');
} finally {
  await browser.close();
}

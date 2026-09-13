// Browser check for the weapon rehaul. Run against a local dev or static server.
// node tests/weapon-rehaul.check.mjs [url] [screenshot-directory]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3101';
const output = process.argv[3] ?? '/tmp/weapon-rehaul-visuals';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = async name => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
    const scope = document.querySelector('.scope');
    const opacity = Number(getComputedStyle(scope).opacity);
    return scope.classList.contains('is-visible') ? opacity > 0.99 : opacity < 0.01;
  });
  await page.screenshot({ path: `${output}/${name}.png` });
};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.locator('[data-act="start"]').click();
  await page.evaluate(() => {
    const g = window.__game;
    g.gs.state = 'pause'; g.gs.mode = 'ffa'; g.enemies.clear(); g.gs.queue.length = 0;
    g.hud.update(10); g.ctx.audio.music(false);
    for (let i = 0; i < 90; i++) g.player.update(1 / 60);
    window.rehaulFrame = (n = 1) => {
      for (let i = 0; i < n; i++) { g.input.update(1 / 60); g.player.update(1 / 60); }
    };
  });
  await shot('mp5');
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => window.rehaulFrame(60));
  await page.waitForFunction(() => document.querySelector('.scope.acog.is-visible'));
  assert.equal(await page.evaluate(() => window.__game.player.weapon.root.visible), false);
  await shot('acog');
  assert.equal(await page.locator('.scope').evaluate(e => getComputedStyle(e).backgroundImage), 'none', 'ACOG leaves peripheral vision open');
  assert.equal(await page.locator('.scope .scope-ring, .acog-label').count(), 0, 'No sniper ring or floating label in the ACOG');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 800, height: 600 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    const optic = await page.locator('.acog-optic').evaluate(svg => {
      const tip = new DOMPoint(500, 500).matrixTransform(svg.getScreenCTM());
      const rect = svg.getBoundingClientRect();
      const chevron = svg.querySelector('.acog-chevron').getBBox();
      return { x: tip.x, y: tip.y, width: rect.width, height: rect.height, tipY: chevron.y };
    });
    assert(Math.abs(optic.x - viewport.width / 2) < 0.1 && Math.abs(optic.y - viewport.height / 2) < 0.1, 'Chevron tip stays on the aiming axis');
    assert.equal(optic.tipY, 500);
    assert.equal(optic.width, optic.height, 'Lens stays circular');
    assert(optic.height <= Math.min(viewport.width, viewport.height), 'Housing fits the viewport');
    if (viewport.width !== 1280) await shot(`acog-${viewport.width}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator('.grapple-reticle').evaluate(e => getComputedStyle(e).opacity), '0');
  await page.keyboard.down('f');
  const melee = await page.evaluate(() => {
    window.rehaulFrame(1);
    const p = window.__game.player;
    return { slot: p.wi, active: p.melee.active, scope: window.__game.hud.scope.shown, gun: p.weapon.root.visible };
  });
  assert.deepEqual(melee, { slot: 0, active: true, scope: false, gun: false });
  await page.evaluate(() => window.rehaulFrame(7));
  assert.equal(await page.evaluate(() => window.__game.player.melee.root.visible), true);
  await shot('knife');
  await page.evaluate(() => window.rehaulFrame(45));
  assert.equal(await page.evaluate(() => window.__game.player.blocking), true);
  await shot('knife-guard');
  await page.keyboard.up('f');
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => window.rehaulFrame(60));
  assert.equal(await page.evaluate(() => window.__game.player.weapon.root.visible), true);

  for (const [key, kind] of [['2', 'shotgun'], ['3', 'sniper'], ['4', 'pistol']]) {
    await page.keyboard.down(key); await page.evaluate(() => window.rehaulFrame(60)); await page.keyboard.up(key);
    assert.equal(await page.evaluate(() => window.__game.player.weapon.kind), kind);
    await shot(kind);
    if (kind === 'sniper') {
      await page.mouse.down({ button: 'right' }); await page.evaluate(() => window.rehaulFrame(60));
      await page.waitForFunction(() => document.querySelector('.scope.sniper.is-visible'));
      await shot('sniper-scope');
      await page.mouse.up({ button: 'right' }); await page.evaluate(() => window.rehaulFrame(60));
    }
  }
  await page.mouse.down(); await page.evaluate(() => window.rehaulFrame(1));
  const first = await page.evaluate(() => window.__game.player.weapon.mag);
  await page.evaluate(() => window.rehaulFrame(30));
  assert.equal(await page.evaluate(() => window.__game.player.weapon.mag), first);
  assert.equal(first, 14);
  await page.mouse.up(); await page.evaluate(() => window.rehaulFrame(1));

  const kinds = ['grunt', 'rusher', 'heavy', 'sniper', 'shield', 'bomber', 'flyer', 'boss', 'hitbox', 'lagspike'];
  for (const kind of kinds) {
    await page.evaluate(kind => {
      const g = window.__game, p = g.player;
      g.enemies.clear(); g.effects.clear();
      const e = g.enemies.spawn(kind, p.body.pos.clone().addScaledVector(p.forward, 5));
      e.root.scale.setScalar(1); e.root.rotation.y = p.yaw;
      e.root.position.y = p.body.pos.y;
      e.root.updateMatrixWorld(true);
      g.effects.clear();
      g.ctx.camera.position.copy(e.figure.anchors.head.getWorldPosition(p.eye.clone()));
      g.ctx.camera.position.z += 2.2;
      g.ctx.camera.lookAt(e.figure.anchors.head.getWorldPosition(p.eye.clone()));
      g.ctx.camera.fov = 45; g.ctx.camera.updateProjectionMatrix();
      g.ctx.renderer.rig.visible = false;
    }, kind);
    await shot(`mask-${kind}`);
  }
  assert.deepEqual(errors, []);
  console.log('OK MP5/ACOG, independent melee, four gun slots, sniper scope, semiauto pistol and 10 mask portraits');
} finally { await browser.close(); }

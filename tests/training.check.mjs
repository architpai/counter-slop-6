// Run: node tests/training.check.mjs http://localhost:3000 [/tmp/shooter-training]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-training';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const slider = async (name, value) => page.locator(`input[data-act="${name}"]`).evaluate((el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const pause = async () => {
  // Headless software rendering can miss a short timed key press. Hold until
  // the game consumes it, and do not resume an already auto-paused game.
  if (await page.evaluate(() => window.__game.gs.state === 'pause')) return;
  await page.keyboard.down('KeyP');
  try { await page.waitForFunction(() => window.__game.gs.state === 'pause'); }
  finally { await page.keyboard.up('KeyP'); }
  await settle();
};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  await page.screenshot({ path: `${out}/menu.png` });
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  assert.equal(await page.locator('[data-act="acogSens"]').inputValue(), '120');
  assert.equal(await page.locator('[data-act="sniperSens"]').inputValue(), '150');
  await page.screenshot({ path: `${out}/settings.png` });
  await slider('acogSens', 140); await slider('sniperSens', 170);
  await page.getByRole('button', { name: 'play', exact: true }).click();
  await page.locator('[data-act="optic"][data-value="holo"]').click();
  await page.reload();
  await page.waitForFunction(() => window.__game?.live === 1);
  assert.equal(await page.locator('[data-value="holo"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__game.player.weapons[0].optic), 'holo');
  await page.getByRole('button', { name: 'settings', exact: true }).click();
  assert.equal(await page.locator('[data-act="acogSens"]').inputValue(), '140');
  assert.equal(await page.locator('[data-act="sniperSens"]').inputValue(), '170');
  await slider('acogSens', 120); await slider('sniperSens', 150);
  await page.getByRole('button', { name: 'play', exact: true }).click();
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training' && window.__game.enemies.alive === 10);
  const passive = await page.evaluate(() => {
    const g = window.__game;
    const positions = g.enemies.list.map(e => e.body.pos.clone());
    let fired = 0; g.enemies.onFire = () => fired++;
    for (let i = 0; i < 200; i++) g.enemies.update(.05);
    g.player.takeDamage(99999);
    return { fired, hp: g.player.hp, maxHp: g.player.maxHp, key: g.level.key,
      moved: g.enemies.list.some((e, i) => e.body.pos.distanceTo(positions[i]) > .01),
      scales: g.enemies.list.every(e => e.root.scale.x === e.stats.scale),
      projectiles: g.enemies.projectiles.length };
  });
  assert.deepEqual(passive, { fired: 0, hp: 120, maxHp: 120, key: 'training', moved: false, scales: true, projectiles: 0 });
  await page.evaluate(() => window.__game.hud.update(10));
  await settle();
  await page.screenshot({ path: `${out}/range.png` });
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__game.hud.scope.shown && window.__game.hud.scope.kind === 'holo');
  await page.waitForFunction(() => Math.abs(window.__game.ctx.camera.fov - 82) < .1);
  await page.screenshot({ path: `${out}/holo.png` });
  await page.mouse.up({ button: 'right' });

  // Measure actual yaw changes, not only stored settings. General look must cancel
  // out of the two independent magnified-sight settings, on mouse and controller.
  await pause();
  await page.locator('[data-value="acog"]').click();
  const measure = () => page.evaluate(() => {
    const g = window.__game, p = g.player, values = [];
    for (const slot of [0, 2]) for (const sensitivity of [g.input.mouseSens, g.input.padSensX, g.input.padSensY]) {
      p.switchTo(slot); p.aiming = true; p.dashLock = true;
      g.input.look.x = sensitivity * .01; g.input.look.y = 0;
      const before = p.yaw; p.update(0); values.push(p.yaw - before);
      p.dashLock = false; g.input.look.x = 0;
    }
    return values;
  });
  const before = await measure();
  await slider('sens', 200);
  const after = await measure();
  before.forEach((value, i) => assert(Math.abs(value - after[i]) < 1e-10, 'scoped sensitivity is independent of general look'));
  await slider('acogSens', 175);
  const changed = await measure();
  changed.forEach((value, i) => assert(Math.abs(value - after[i] * (i < 3 ? 175 / 120 : 1)) < 1e-10));
  await slider('sens', 100); await slider('acogSens', 120);
  await page.locator('[data-act="training"]').click();
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__game.hud.scope.shown && window.__game.hud.scope.kind === 'acog');
  await page.waitForFunction(() => Math.abs(window.__game.ctx.camera.fov - 38) < .1);
  await page.screenshot({ path: `${out}/acog.png` });
  await page.keyboard.press('Digit3', { delay: 100 });
  await page.waitForFunction(() => window.__game.hud.scope.shown && window.__game.hud.scope.kind === 'sniper');
  await page.waitForFunction(() => Math.abs(window.__game.ctx.camera.fov - 20) < .1);
  await page.screenshot({ path: `${out}/sniper.png` });
  await page.mouse.up({ button: 'right' });

  // Trace real zero-spread shots through all ten visible models. Shields block
  // bullets; machines remain body targets, never headshot multipliers.
  const shots = await page.evaluate(() => {
    const g = window.__game; g.gs.state = 'pause';
    g.player.switchTo(0);
    const gun = g.player.weapon, results = [];
    for (const e of g.enemies.list.filter(e => e.alive)) {
      const part = e.hits.find(h => h.part === 'head') ?? e.hits[0];
      const camera = g.ctx.camera;
      camera.position.copy(part.center).add({ x: 0, y: 0, z: 4 });
      camera.lookAt(part.center); camera.updateMatrixWorld(true);
      const direction = g.player.aimDir(0), hit = g.enemies.raycast(camera.position, direction, 6);
      const hp = e.hp;
      gun._ray(direction);
      results.push({ type: e.type, part: hit?.part, damage: hp - e.hp, hp: e.hp });
    }
    return results;
  });
  for (const hit of shots) {
    assert.equal(hit.part, hit.type === 'shield' ? 'shield' : ['bomber', 'flyer', 'hitbox', 'lagspike'].includes(hit.type) ? 'torso' : 'head', hit.type);
    assert(hit.type === 'shield' ? hit.damage === 0 : hit.damage > 0, hit.type);
  }
  const wall = await page.evaluate(() => {
    const g = window.__game, e = g.enemies.list.find(e => e.type === 'grunt');
    const head = e.hits.find(h => h.part === 'head').center, c = g.ctx.camera;
    c.position.copy(head).add({ x: 0, y: 0, z: 4 }); c.lookAt(head); c.updateMatrixWorld(true);
    const block = g.world.addBox(head.clone().add({ x: -1, y: -1, z: 1 }), head.clone().add({ x: 1, y: 1, z: 2 }));
    g.world.finalize(); const hp = e.hp;
    g.player.weapon._ray(g.player.aimDir(0)); g.world.removeBox(block);
    return e.hp === hp;
  });
  assert(wall, 'solid cover stops damage');
  const shieldCheck = await page.evaluate(() => {
    const g = window.__game, e = g.enemies.list.find(e => e.type === 'shield');
    const target = e.hits.find(h => h.part === 'shield').center.clone();
    const origin = target.clone().add({ x: 0, y: 0, z: 4 }), direction = target.clone().set(0, 0, -1);
    const before = g.enemies.raycast(origin, direction, 6)?.part;
    g.enemies.damage(e, 1, { source: 'melee', part: 'shield' });
    g.enemies.damage(e, 1, { source: 'melee', part: 'shield' });
    const after = g.enemies.raycast(origin, direction, 6)?.part;
    return { before, after, shieldHp: e.shieldHp };
  });
  assert.equal(shieldCheck.before, 'shield');
  assert.equal(shieldCheck.shieldHp, 0);
  assert.notEqual(shieldCheck.after, 'shield', 'detached shields no longer block rays');
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.enemies.list.find(e => e.type === 'grunt');
    window.__oldTargetId = e.id;
    g.enemies.damage(e, 1000, { source: 'pistol', part: 'torso' });
    g.gs.state = 'play';
    g.player.weapons[0].reserve = 0;
  });
  await page.waitForFunction(() => window.__game.enemies.list.some(e => e.type === 'grunt' && e.alive && e.id !== window.__oldTargetId));
  assert.equal(await page.evaluate(() => window.__game.player.weapons[0].reserve), 300);
  await pause();
  await page.locator('[data-act="training"]').click();
  assert(await page.evaluate(() => window.__game.enemies.alive === 10 && window.__game.enemies.list.every(e => e.hp === e.maxHp)));
  await pause();
  await page.locator('[data-act="mainMenu"]').click();
  assert.equal(await page.evaluate(() => window.__game.level.key), 'downtown');
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle();
  const bounds = await page.locator('[data-act="training"]').boundingBox();
  assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 720, 'training button fits a small laptop');
  await page.screenshot({ path: `${out}/menu-720p.png` });
  await page.locator('[data-act="start"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'solo' && window.__game.gs.wave === 1);
  assert.deepEqual(errors, []);
  console.log('OK: passive range, all 10 targets, respawn/reset, ammo, hit registration, cover, optics, saved preference, zoom and independent mouse/controller sensitivity.');
  console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }

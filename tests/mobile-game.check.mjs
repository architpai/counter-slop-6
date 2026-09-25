// Real game + Chromium touch emulation, not a physical-phone performance test.
// node tests/mobile-game.check.mjs http://127.0.0.1:4181
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const cdp = await context.newCDPSession(page);
const read = fn => page.evaluate(fn);
const wait = fn => page.waitForFunction(fn);
const settle = () => read(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const out = '/tmp/shooter-mobile-check';
const contacts = new Map();
async function finger(type, id, x, y) {
  if (type === 'touchEnd') contacts.delete(id);
  else if (type === 'touchCancel') contacts.clear();
  else contacts.set(id, { id, x, y, radiusX: 3, radiusY: 3, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...contacts.values()] });
}
async function center(control) {
  const r = await page.locator(`[data-touch="${control}"]`).boundingBox(); assert(r, control);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
const tap = async control => { const p = await center(control); await finger('touchStart', 1, p.x, p.y); await finger('touchEnd', 1); await settle(); };
const cancel = () => finger('touchCancel');
const slider = (label, value) => page.getByRole('slider', { name: label, exact: true }).evaluate((el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
try {
  await mkdir(out, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4181');
  await wait(() => window.__game?.input.usingTouch);
  assert.equal(await read(() => window.__game.input.locked), false);
  await page.getByRole('button', { name: 'How to install', exact: true }).tap();
  assert((await page.locator('.install-prompt').textContent()).includes('Safari → Share'));
  await page.getByRole('button', { name: 'Continue in browser', exact: true }).tap();
  await page.getByRole('button', { name: 'controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Edit controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Four-finger claw', exact: true }).tap();
  await page.getByLabel('Control', { exact: true }).selectOption('fire');
  await slider('Opacity', 70);
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await page.reload(); await wait(() => !!window.__game);
  assert.equal(await page.locator('.install-prompt').count(), 0);
  assert.equal(await read(() => JSON.parse(localStorage.getItem('cs6_touch_layout')).controls.fire.opacity), .7);
  await page.getByRole('button', { name: 'controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Edit controls', exact: true }).tap();
  await page.getByRole('button', { name: 'Two thumbs', exact: true }).tap();
  await page.getByRole('button', { name: 'Reset', exact: true }).tap();
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await page.getByRole('button', { name: 'settings', exact: true }).tap();
  await slider('Touch look / Holo sensitivity', 135);
  assert.equal(await read(() => localStorage.getItem('cs6_touch_sens')), '135');
  await page.getByRole('button', { name: 'play', exact: true }).tap();
  await page.locator('[data-act="training"]').tap();
  await wait(() => window.__game.input.touch.enabled);
  await read(() => window.__game.hud.update(10)); await settle();
  await page.screenshot({ path: `${out}/thumbs.png` });
  let move = await center('move'), fire = await center('fire');
  const before = await read(() => ({ position: window.__game.player.body.pos.toArray(), mag: window.__game.player.weapon.mag, yaw: window.__game.player.yaw }));
  await finger('touchStart', 1, move.x, move.y);
  await finger('touchMove', 1, move.x, move.y - 45);
  await wait(() => window.__game.player.sprinting);
  await finger('touchStart', 2, fire.x, fire.y);
  await finger('touchMove', 2, fire.x + 20, fire.y - 5);
  await wait(() => window.__game.input.down('fire') && window.__game.player.firing);
  assert.equal(await read(() => window.__game.player.sprinting), false, 'fire still blocks sprint');
  const during = await read(() => ({ position: window.__game.player.body.pos.toArray(), mag: window.__game.player.weapon.mag, yaw: window.__game.player.yaw }));
  assert(during.mag < before.mag); assert.notDeepEqual(during.position, before.position); assert.notEqual(during.yaw, before.yaw);
  await cancel(); await settle();
  assert.equal(await read(() => window.__game.input.down('fire') || window.__game.input.touch.contacts.size > 0), false);
  await tap('aim'); await wait(() => window.__game.player.aiming && window.__game.hud.scope.shown);
  await page.screenshot({ path: `${out}/scope.png` });
  await tap('aim'); await wait(() => !window.__game.player.aiming);
  await tap('weapon'); assert.equal(await read(() => window.__game.player.wi), 1);
  await tap('weapon'); await tap('weapon'); await tap('weapon');
  assert.equal(await read(() => window.__game.player.wi), 4);
  fire = await center('fire');
  const pistol = await read(() => window.__game.player.weapon.mag);
  await finger('touchStart', 1, fire.x, fire.y);
  await page.waitForFunction(mag => window.__game.player.weapon.mag < mag, pistol);
  // Advance the real gun while the same real pointer remains held: no second semi-auto edge.
  await read(() => { const g = window.__game; for (let i = 0; i < 60; i++) { g.input.update(.05); g.player._updateWeapons(.05); } });
  assert.equal(await read(() => window.__game.player.weapon.mag), pistol - 1);
  await cancel(); await tap('reload'); await wait(() => window.__game.player.weapon.reloading);
  await wait(() => !window.__game.player.weapon.reloading);
  assert.equal(await read(() => window.__game.player.weapon.mag), pistol);

  // Drive the real grapple/physics with explicit gesture times. No fake attached state.
  const grapple = await read(() => {
    const g = window.__game, p = g.player, t = g.input.touch;
    g.pause(); p.reset(p.body.pos.clone().set(0, 30, 0)); p.pitch = Math.atan2(10, 25);
    g.level.rings.push(p.eye.clone().add({ x: 0, y: 10, z: -25 }));
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    t.enabled = true; t.start(1, 'grapple', 50, 50, rect, performance.now() - 400);
    const step = () => { g.input.update(.016); p.update(.016); };
    step(); const flight = p.grapple.mode;
    for (let i = 0; i < 35 && p.grapple.mode === 'fly'; i++) step();
    const attached = p.grapple.mode;
    const length = p.grapple.ropeLength; step(); const reeled = p.grapple.ropeLength < length;
    t.end(1); step(); const swing = p.grapple.mode;
    t.start(1, 'grapple', 50, 50, rect, performance.now() - 400); step(); const hold = p.grapple.mode;
    t.start(2, 'jump', 50, 50, rect); t.end(2); step(); const launched = p.grapple.mode === 'idle' && p.body.vel.y > 0;
    for (let i = 0; i < 40; i++) step(); const stale = p.grapple.mode;
    // Launch moved the player away from the first ring. Supply a fresh valid target.
    g.level.rings.push(p.eye.clone().addScaledVector(p.forward, 25));
    t.end(1); t.start(1, 'grapple', 50, 50, rect); step(); const newHook = p.grapple.mode;
    for (let i = 0; i < 35 && p.grapple.mode === 'fly'; i++) step();
    t.end(1); t.start(1, 'grapple', 50, 50, rect); t.end(1); step(); const detached = p.grapple.mode;
    return { flight, attached, reeled, swing, hold, launched, stale, newHook, detached };
  });
  assert.deepEqual(grapple, { flight: 'fly', attached: 'on', reeled: true, swing: 'on', hold: 'on', launched: true, stale: 'idle', newHook: 'fly', detached: 'idle' });
  await page.locator('[data-act="training"]').tap(); await wait(() => window.__game.input.touch.enabled);
  fire = await center('fire'); await finger('touchStart', 1, fire.x, fire.y);
  await page.setViewportSize({ width: 390, height: 844 });
  await wait(() => window.__game.hud.mobile.interrupted);
  assert.equal(await read(() => window.__game.gs.state), 'pause');
  assert.equal(await read(() => window.__game.input.touch.contacts.size), 0);
  await cancel(); await page.screenshot({ path: `${out}/portrait.png` });
  await page.setViewportSize({ width: 844, height: 390 }); await settle();
  await page.getByRole('button', { name: 'Tap to resume', exact: true }).tap();
  await wait(() => window.__game.input.touch.enabled);
  assert.equal(await read(() => window.__game.input.down('fire')), false);
  await read(() => window.dispatchEvent(new Event('blur'))); await settle();
  await page.getByRole('button', { name: 'Tap to resume', exact: true }).tap();
  await wait(() => window.__game.input.touch.enabled);
  for (const preset of ['thumbs', 'claw']) {
    await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
    await page.getByRole('button', { name: 'Edit controls', exact: true }).tap();
    await page.getByRole('button', { name: preset === 'claw' ? 'Four-finger claw' : 'Two thumbs', exact: true }).tap();
    await page.screenshot({ path: `${out}/editor-${preset}.png` });
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await page.locator('[data-act="resume"]').tap();
    for (const [width, height] of [[844, 390], [667, 375], [568, 320]]) {
      await page.setViewportSize({ width, height }); await settle();
      const problems = await read(() => {
        const buttons = [...document.querySelectorAll('.touch-safe button')].filter(el => el.getClientRects().length).map(el => ({ name: el.getAttribute('aria-label'), r: el.getBoundingClientRect() }));
        const problems = [];
        for (const { name, r } of buttons) if (r.width < 44 || r.height < 44 || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) problems.push(`${name} bounds`);
        for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i], b = buttons[j];
          if (a.r.left < b.r.right && a.r.right > b.r.left && a.r.top < b.r.bottom && a.r.bottom > b.r.top) problems.push(`${a.name}/${b.name}`);
        }
        return problems;
      });
      assert.deepEqual(problems, [], `${preset} ${width}×${height}`);
      await page.screenshot({ path: `${out}/${preset}-${width}.png` });
    }
    await page.setViewportSize({ width: 844, height: 390 }); await settle();
  }
  const left = await center('fire-left'), right = await center('fire');
  await finger('touchStart', 1, left.x, left.y); await finger('touchStart', 2, right.x, right.y);
  await finger('touchEnd', 1); await settle(); assert.equal(await read(() => window.__game.input.down('fire')), true);
  await cancel(); await settle(); assert.equal(await read(() => window.__game.input.down('fire')), false);
  // Simulated online state tests local menu/orientation policy without a signalling-server dependency.
  await read(() => { const g = window.__game; g.gs.mode = 'ffa'; g.gs.state = 'play'; });
  await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
  assert.equal(await read(() => window.__game.gs.state), 'play');
  assert.equal(await read(() => window.__game.gs.menu), true);
  assert.equal(await read(() => window.__game.input.touch.enabled), false);
  await read(() => window.__game.player.die());
  assert.equal(await read(() => window.__game.gs.menu), true, 'death does not discard mobile menu/editor');
  await page.locator('[data-act="resume"]').tap();
  await page.setViewportSize({ width: 390, height: 844 }); await settle();
  assert((await page.locator('.touch-interruption').textContent()).includes('match is still running'));
  await page.getByRole('button', { name: 'Leave match', exact: true }).tap();
  await wait(() => window.__game.gs.state === 'start');
  assert.deepEqual(errors, []);
  console.log(`PASS: real touch move/fire/look, semi-auto cadence, scope, reload, real grapple/reel/swing/launch, cancellation, portrait/resume, editor save/reset, 6 layouts, install fallback, and simulated online menu/death policy. Screenshots: ${out}`);
} catch (error) {
  console.error('Browser errors:', errors);
  console.error(await page.locator('body').innerText());
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }

// Screenshots of blood in training: an enemy 1.5 m in front of a wall shot with the .50 pistol from 6 m,
// mid-spray and after the drops land, then a sword cut. The frame loop is held and stepped by hand.
// Run with a local app server: node tests/blood.shots.mjs http://localhost:3000 [/tmp/shooter-blood] [low|medium|high|ultra]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-blood';
const preset = process.argv[4] ?? null;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('cs6_loadout', 'pistol,sword,r4c');
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => (window.__hold ? 0 : raf(cb));
});
if (preset) await page.addInitScript(preset => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset, custom: null, fpsCounter: false, auto: null })), preset);
const tag = preset ?? 'auto';
const shot = name => page.screenshot({ path: `${out}/${tag}-${name}.png` });
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1, null, { timeout: 120000 });
  await page.locator('[data-act="training"]').click();
  await page.waitForFunction(() => window.__game.gs.mode === 'training' && window.__game.gs.state === 'play');
  if (preset && preset !== 'low') await page.waitForFunction(() => window.__game.ctx.renderer.weapons?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(preset ? 4000 : 1500);
  const ok = await page.evaluate(() => {
    const g = window.__game, p = g.player, V = p.body.pos.constructor;
    window.__hold = true;
    let now = performance.now();
    g.input.update = () => {};
    window.__frames = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; g.step(now); } };
    // The wall ahead of the start, along the view.
    p.yaw = 0; p.pitch = 0;
    const eye = p.eye.clone(), fwd = new V(0, 0, -1);
    const wall = g.world.raycast(eye, fwd, 200);
    if (!wall) return false;
    for (const e of g.enemies.list) e.root.visible = false;
    g.enemies.clear();
    const at = wall.point.clone().addScaledVector(fwd, -1.5); at.y = p.body.pos.y;
    const target = g.enemies.spawn('grunt', at);
    target.state = 'hunt'; target.root.scale.setScalar(1); target.hp = target.maxHp = 100000;
    p.body.pos.copy(at).addScaledVector(fwd, -6);
    window.__target = target;
    window.__frames(30);
    const d = target.center.clone().sub(p.eye); p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    window.__frames(10);
    return true;
  });
  assert.ok(ok, 'a wall ahead of the start');
  await page.evaluate(() => {
    const g = window.__game, gun = g.player.weapon;
    for (let i = 0; i < 3; i++) { gun._ray(g.player.aimDir(0.004)); window.__frames(9); }
    window.__frames(2);
  });
  await shot('spray');
  await page.evaluate(() => window.__frames(90));
  await shot('marks');
  await page.evaluate(() => {
    const g = window.__game, p = g.player, t = window.__target;
    const d = t.center.clone().sub(p.eye).normalize();
    p.body.pos.copy(t.body.pos).addScaledVector(d.setY(0).normalize(), -2.2);
    window.__frames(20);
    p.switchTo(1, true); window.__frames(20);
    p.sword.startSlash(p.weaponState()); window.__frames(9);
  });
  await shot('cut');
  await page.evaluate(() => window.__frames(90));
  await shot('cut-marks');
  assert.deepEqual(errors, []);
  console.log(`OK: blood screenshots in ${out}`);
} finally {
  await browser.close();
}

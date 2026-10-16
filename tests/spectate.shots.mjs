// Real PeerJS/WebRTC screenshots of a down co-op player spectating: over the shoulder, then through the teammate's
// eyes with their gun, hip and aimed. Run with a local app server: node tests/spectate.shots.mjs http://localhost:3000 [/tmp/shooter-spectate]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = process.argv[3] ?? '/tmp/shooter-spectate';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
const wait = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
async function open(name) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(name => { localStorage.setItem('cs6_name', name); localStorage.setItem('cs6_music', '0'); }, name);
  await page.goto(url);
  await wait(page, () => !!window.__game, null, 120000);
  await page.locator('[data-act="online"]').click();
  return page;
}
/** Enemies hurt no one here but the shot's own `down`. */
const armour = page => page.evaluate(() => {
  const g = window.__game, take = g.player.takeDamage.bind(g.player);
  g.player.takeDamage = (amount, from) => { if (amount >= 1e8) take(amount, from); };
});
try {
  const host = await open('Host tester'), client = await open('Client tester');
  await host.getByRole('button', { name: 'Co-op Survival', exact: true }).click();
  await host.locator('input[value="private"]').check();
  await host.locator('[data-act="create"]').click();
  await wait(host, () => window.__game.gs.state === 'lobby');
  const code = await host.evaluate(() => window.__game.net.code);
  await client.locator('[data-act="joinCode"]').fill(code);
  await client.locator('[data-act="join"]').click();
  await wait(client, () => window.__game.gs.state === 'lobby');
  await host.locator('[data-act="startMatch"]').click();
  await Promise.all([host, client].map(p => wait(p, () => window.__game.gs.state === 'play')));
  for (const p of [host, client]) await armour(p);
  // The host holds the sniper; the client goes down and watches it.
  await host.evaluate(() => window.__game.player.switchTo(3));
  await client.evaluate(() => window.__game.player.takeDamage(1e9));
  await wait(client, () => window.__game.gs.state === 'dying');
  await client.waitForTimeout(1500);
  await client.screenshot({ path: `${out}/shoulder.png` });
  assert.equal(await client.evaluate(() => window.__game.ctx.renderer.rig.visible), false);
  await client.evaluate(() => { const i = window.__game.input; i.pressed = action => action === 'jump'; });
  await client.waitForTimeout(100);
  await client.evaluate(() => { delete window.__game.input.pressed; });
  await wait(client, () => window.__game.player.watched?.slot === 3 && window.__game.player.weapon.kind === 'sniper' &&
    window.__game.ctx.renderer.rig.visible && window.__game.player.weapon.root.visible);
  await client.waitForTimeout(800);
  await client.screenshot({ path: `${out}/eyes-hip.png` });
  // The host aims: the client sees the scope and the zoom.
  await host.evaluate(() => { const i = window.__game.input, down = i.down.bind(i); i.down = action => action === 'aim' || down(action); });
  await wait(client, () => window.__game.hud.scope.shown && window.__game.hud.scope.kind === 'sniper' && window.__game.ctx.camera.fov < 40);
  await client.screenshot({ path: `${out}/eyes-aimed.png` });
  assert.deepEqual(errors, []);
  console.log(`OK: spectate screenshots in ${out}`);
} finally {
  await browser.close();
}

// Real PeerJS/WebRTC browser check for squad marks in co-op. Run with an app server:
// node tests/marks.check.mjs http://localhost:3000
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const out = '/tmp/shooter-marks-check';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
const wait = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const labels = page => page.evaluate(() => [...document.querySelectorAll('.squad-marks span')].map(s => s.textContent));
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(name => { localStorage.setItem('cs6_name', name); localStorage.setItem('cs6_music', '0'); }, name);
  await page.goto(url);
  await wait(page, () => !!window.__game);
  await page.locator('[data-act="online"]').click();
  return page;
}

try {
  await mkdir(out, { recursive: true });
  const host = await open('Host'), client = await open('Client');
  await host.getByRole('button', { name: 'Co-op Survival', exact: true }).click();
  await host.locator('input[value="private"]').check();
  await host.locator('[data-act="create"]').click();
  await wait(host, () => window.__game.gs.state === 'lobby');
  const code = await host.evaluate(() => window.__game.net.code);
  await client.locator('[data-act="joinCode"]').fill(code);
  await client.locator('[data-act="join"]').click();
  await client.getByText(/2\/4 players/).waitFor();
  await host.locator('[data-act="startMatch"]').click();
  await Promise.all([host, client].map(p => wait(p, () => window.__game.gs.state === 'play')));
  // Nobody dies to the wave while the check runs.
  for (const p of [host, client]) await p.evaluate(() => { const g = window.__game; g.player.takeDamage = () => {}; });

  // The host looks down at the floor and marks it.
  await host.evaluate(() => { window.__game.player.pitch = -0.5; });
  // Held until the mark shows: a busy first frame can miss a short press.
  await host.keyboard.down('z');
  await wait(host, () => document.querySelectorAll('.squad-marks span').length === 1);
  await host.keyboard.up('z');
  await wait(client, () => document.querySelectorAll('.squad-marks span').length === 1);
  const [mine] = await labels(host), [theirs] = await labels(client);
  assert.match(mine, /^Host · \d+m$/);
  assert.match(theirs, /^Host · \d+m$/);
  await host.screenshot({ path: `${out}/host.png` });
  await client.screenshot({ path: `${out}/client.png` });

  // A second mark takes the place of the first.
  await host.evaluate(() => { window.__game.player.pitch = -0.9; });
  await host.waitForTimeout(800);
  await host.keyboard.down('z'); await host.waitForTimeout(150); await host.keyboard.up('z');
  await client.waitForTimeout(1000);
  assert.equal((await labels(client)).length, 1);

  // Gone after 15 s.
  await wait(client, () => document.querySelectorAll('.squad-marks span').length === 0, undefined, 20000);
  assert.deepEqual(errors, []);
  console.log('marks check passed:', { mine, theirs }, `screenshots in ${out}`);
} finally {
  await browser.close();
}

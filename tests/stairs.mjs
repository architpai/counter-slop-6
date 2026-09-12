// Every Downtown staircase must be climbable by walking straight at it, and the eye
// must ease over each step rather than pop. Run against `npm run dev`.
//   node tests/stairs.mjs [url]
import { chromium } from 'playwright';
const cases = [
  ['tower f0', [-6.5, 0, -8.3], -Math.PI / 2, 4],
  ['tower f1', [2.8, 4, -10.3], Math.PI / 2, 8],
  ['A f0', [-27, 0, 21.2], Math.PI / 2, 4],
  ['A f1', [-36.3, 4, 23.2], -Math.PI / 2, 8],
  ['B f0', [26, 0, 21.2], -Math.PI / 2, 4],
  ['B f1', [35.3, 4, 23.2], Math.PI / 2, 8],
  ['B interior', [27.2, 0, 6.5], Math.PI, 6],
  ['highway W', [-48, 0, -24.5], -Math.PI / 2, 7],
  ['house 1->2', [-24.5, 7, -45], -Math.PI / 2, 11],
  ['house 3->2', [10.5, 7, -45], Math.PI / 2, 11],
];
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const url = process.argv[2] ?? 'http://localhost:3000/';
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game !== undefined);
await page.waitForTimeout(1000);
await page.click('.screen-button[data-act="start"]');
await page.waitForTimeout(1500);
let failed = false;
for (const [name, pos, yaw, top] of cases) {
  await page.evaluate(([pos, yaw]) => { const g = window.__game; g.enemies.clear(); const p = g.player; p.body.pos.set(...pos); p.body.vel.set(0,0,0); p.yaw = yaw; p.pitch = 0; p.hp = 9999; p.stepOffset = 0; window.__ys = []; }, [pos, yaw]);
  await page.keyboard.down('KeyW');
  await page.evaluate(top => new Promise(r => { const g = window.__game, ys = window.__ys; let n = 0; const tick = () => { ys.push([g.player.body.pos.y, g.player.eye.y]); if (++n < 150 && g.player.body.pos.y < top - 0.01) requestAnimationFrame(tick); else r(); }; requestAnimationFrame(tick); }), top);
  await page.keyboard.up('KeyW');
  const ys = await page.evaluate(() => window.__ys);
  let maxEye = 0; for (let i = 1; i < ys.length; i++) maxEye = Math.max(maxEye, Math.abs(ys[i][1] - ys[i-1][1]));
  const y = Math.max(...ys.map(a => a[0]));
  const ok = y >= top - 0.01 && maxEye < 0.2;
  failed ||= !ok;
  console.log(name.padEnd(12), 'reached y', y.toFixed(2), 'target', top, ok ? 'OK' : 'FAIL', 'max eye dy', maxEye.toFixed(3));
}
await browser.close();
process.exit(failed ? 1 : 0);

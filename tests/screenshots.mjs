// README screenshots: main menu plus one in-game frame per map. Run against `npm run dev`.
//   node tests/screenshots.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

async function boot(map) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(m => localStorage.setItem('cs6_map', m), map);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined);
  await page.addStyleTag({ content: '.tip-line{display:none!important}' }); // no "click to grab the mouse"
  await page.waitForTimeout(1000);
}

await boot('downtown');
await page.screenshot({ path: `${out}/menu.png` });

// One frame per map from a fixed vantage point: [pos, yaw, pitch, ms to wait before the shot].
// House is shot early so the WAVE 1 banner is still up; Downtown waits for it to clear.
const shots = [
  ['downtown', [2.5, 8, 3], Math.PI, -0.1, 4000],
  ['house', [2 * 1.3, 0, 12 * 1.3], Math.PI, 0, 700],
];
for (const [map, pos, yaw, pitch, wait] of shots) {
  await boot(map);
  await page.click('.screen-button[data-act="start"]');
  await page.waitForTimeout(1500);
  await page.evaluate(([pos, yaw, pitch]) => {
    const p = window.__game.player;
    p.body.pos.set(...pos); p.body.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; p.hp = 9999;
  }, [pos, yaw, pitch]);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${map}.png` });
}
await browser.close();
console.log('wrote', out);

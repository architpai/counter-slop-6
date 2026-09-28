// README screenshots: main menu plus one in-game frame per map, on the Ultra preset (the realistic look).
// Run against `npm run dev` or the served build, on the real GPU (macOS: ANGLE Metal).
//   node tests/screenshots.mjs [url]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:3000/';
const out = 'docs/screenshots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

// The Ultra preset, saved before boot as the Graphics menu saves it (render/quality.ts, `cs6_gfx`).
await page.addInitScript(() => localStorage.setItem('cs6_gfx', JSON.stringify({ v: 1, preset: 'ultra', custom: null, fpsCounter: false, auto: null })));
/** Everything the realistic look streams for the map is in and its bake has faded in. */
const streamed = () => page.waitForFunction(() => {
  const r = window.__game?.ctx.renderer;
  return r && r._quality.look === 'realistic' && !r.streaming && !r.bakeFading;
}, null, { timeout: 60_000 });

async function boot(map) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(m => localStorage.setItem('cs6_map', m), map);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game !== undefined);
  await page.addStyleTag({ content: '.tip-line{display:none!important}' }); // no "click to grab the mouse"
  await streamed();
  await page.waitForTimeout(1000);
}

await boot('downtown');
await page.screenshot({ path: `${out}/menu.png` });

// One frame per map from a fixed vantage point: [pos, yaw, pitch, ms to wait before the shot].
// House is shot early so the WAVE 1 banner is still up; Downtown waits for it to clear. Downtown looks down the
// sunlit plaza with the sun behind (from under the spawn's overhang, Ultra's shade there read as a dark frame).
const shots = [
  ['downtown', [0, 0, 20], Math.PI, -0.02, 4000],
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
  await streamed();
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${map}.png` });
}
await browser.close();
console.log('wrote', out);

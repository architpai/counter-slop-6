// Indoor readability shots for the baked lighting (docs/VISUALS.md, R3, readability guardrail).
//   node tests/indoor.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=low,medium,high,ultra  CS6_GL=metal|swiftshader  CS6_SIZE=1440x900  CS6_DPR=2
//
// Fixed views inside House (basement, ground floor) and Downtown (building B's ground floor), each
// with grunts standing indoors and the gun in view, per preset: enemies and the view model must
// darken indoors (the probe grid) yet stay easy to read. OUTDIR/indoor.json records, per view, the
// mean brightness of the screen round each grunt's chest, of the view model's corner and of the
// screen's middle square, and the run fails if an indoor view on a realistic preset breaks the
// guardrail (`READABLE`): too dark to play, or not clearly darker than outside.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-indoor';
const presets = (process.env.CS6_PRESETS ?? 'low,medium,high,ultra').split(',');
const [width, height] = (process.env.CS6_SIZE ?? '1440x900').split('x').map(Number);
const dpr = Number(process.env.CS6_DPR ?? 2);
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const args = gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`];

/** Per view: the map, the eye, and grunts (feet) to face it; the camera looks at the first grunt. */
const VIEWS = [
  { name: 'house-basement', map: 'house', eye: [8.8, -2.0, 6.4], grunts: [[1.5, -3.6, 5.5], [-7, -3.6, 5.5]] },
  { name: 'house-ground', map: 'house', eye: [8.5, 1.6, -4.8], grunts: [[4.5, 0, -4.2], [6.5, 0, -1.5]] },
  { name: 'house-outside', map: 'house', eye: [8.5, 1.6, 20], grunts: [[1.5, 0, 14], [-7, 0, 16]] },
  { name: 'downtown-b', map: 'downtown', eye: [42.5, 1.6, 11], grunts: [[33, 0, 7], [26.5, 0, 16]] },
];

/**
 * Readable minimum indoors on the realistic presets (sRGB luma, 0-255): each grunt's chest, the
 * gun's corner (a dark gun over a dark floor), and the screen; and the screen stays under
 * `darker` of House's outside view, so rooms still read as rooms.
 */
const READABLE = { grunt: 25, gun: 10, screen: 24, darker: 0.6 };
/**
 * And each grunt's chest at least as bright as on fe14d35 (the flat look, tests/readability-fe14d35.json,
 * the same views) less this slack (sRGB luma; the readings are whole numbers and the same from run to
 * run): the realistic operators (R7) read as well indoors. CS6_READABILITY=0 skips it.
 */
const READABLE_SLACK = 0.5;
const baseline = process.env.CS6_READABILITY === '0' ? null
  : JSON.parse(await readFile(new URL('./readability-fe14d35.json', import.meta.url), 'utf8')).indoor;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
const frames = n => page.evaluate(n => new Promise(resolve => {
  let left = n;
  const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);
const report = {};
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  for (const preset of presets) {
    report[preset] = {};
    for (const view of VIEWS) {
      await page.evaluate(({ preset, map }) => {
        const g = window.__game;
        if (g.level?.key !== map || g.quality.preset !== preset || g.gs.state !== 'pause') {
          g.hud.onUiAction('mainMenu', null, new Event('click'));
          g.hud.onUiAction('gfxPreset', preset, new Event('click'));
          g.hud.onUiAction('pickMap', map, new Event('click'));
          g.beginSolo();
        }
        g.gs.state = 'pause'; g.gs.queue.length = 0; g.enemies.clear(); g.effects.clear();
        while (g.pickups.length > 0) g.pickups.pop().mesh.removeFromParent();
        g.ctx.audio.music(false);
        g.dynamic.min = 1; g.dynamic.scale = 1; g.ctx.renderer.setDynamicScale(1);
        g.hud.hideScreen(); g.hud.tip('', 0); g.hud.message('', '', 0); g.hud.update(10);
        g.hud.setGameplayVisible(false);
        for (let i = 0; i < 90; i++) g.player.update(1 / 60);
      }, { preset, map: view.map });
      await page.waitForFunction(() => {
        const g = window.__game, r = g.ctx.renderer, w = g.player.weapon;
        // The bake fades in over BAKE_FADE_MS once it is on the GPU; shoot the final look, with the
        // Blender gun on (R4) where the preset is realistic.
        const worn = r.weapons.size === null || (r.weapons.ready && w._real !== null && w._model === w._real);
        // The operators too (R7): the grunts below spawn once they are in, so they wear them.
        return !r.skyPending && !r.texturesPending && !r.bakePending && !r.bakeFading && (worn || !r.weaponsPending) && !(r.operatorsPending ?? false);
      }, null, { timeout: 30_000 });
      // A realistic preset measures the Blender gun, never the flat one it falls back to if the weapons fail.
      const gun = await page.evaluate(() => {
        const g = window.__game, r = g.ctx.renderer, w = g.player.weapon;
        return { realistic: g.quality.values.look === 'realistic', ready: r.weapons.ready, worn: w._real !== null && w._model === w._real };
      });
      if (gun.realistic && !(gun.ready && gun.worn)) {
        throw new Error(`${preset} ${view.name}: the Blender weapons are not worn (weapons ${gun.ready ? 'ready' : 'not ready'}); a weapons load failure?`);
      }
      const spots = await page.evaluate(({ eye, grunts }) => {
        const g = window.__game, V = g.player.body.pos.constructor;
        g.enemies.clear();
        for (const [x, y, z] of grunts) {
          const e = g.enemies.spawn('grunt', new V(x, y, z));
          e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale);
          e.yaw = e.root.rotation.y = Math.atan2(eye[0] - x, eye[2] - z);
          e.root.updateMatrixWorld(true);
        }
        // The spawn burst (random sparks round the chest) would land in the chest boxes.
        g.effects.clear();
        const camera = g.ctx.camera;
        camera.position.fromArray(eye);
        const [tx, ty, tz] = grunts[0];
        camera.rotation.set(Math.atan2(ty + 1.2 - eye[1], Math.hypot(tx - eye[0], tz - eye[2])), Math.atan2(eye[0] - tx, eye[2] - tz), 0, 'YXZ');
        camera.fov = 82; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        g.ctx.renderer.rig.visible = true;
        // Where each grunt's chest lands on screen (CSS pixels).
        return grunts.map(([x, y, z]) => {
          const p = new V(x, y + 1.25, z).project(camera);
          return [Math.round((p.x + 1) / 2 * innerWidth), Math.round((1 - p.y) / 2 * innerHeight)];
        });
      }, view);
      await frames(4);
      const file = `${preset}-${view.name}.png`;
      const png = await page.screenshot({ path: `${out}/${file}`, scale: 'css' });
      // Mean sRGB brightness in small boxes of the screenshot: each grunt's chest and the gun's corner.
      const brightness = await page.evaluate(async ({ spots, w, h, png }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const scratch = new OffscreenCanvas(w, h), context = scratch.getContext('2d');
        context.drawImage(bitmap, 0, 0, w, h);
        const box = ([x, y], r) => {
          const data = context.getImageData(Math.max(0, x - r), Math.max(0, y - r), 2 * r, 2 * r).data;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          return Math.round(sum / (data.length / 4));
        };
        return { grunts: spots.map(s => box(s, 6)), gun: box([Math.round(w * 0.72), Math.round(h * 0.8)], 30),
          screen: box([Math.round(w / 2), Math.round(h / 2)], Math.floor(Math.min(w, h) / 2)) };
      }, { spots, w: width, h: height, png: png.toString('base64') });
      report[preset][view.name] = { file, ...brightness };
      console.log(preset.padEnd(7), view.name.padEnd(15), `grunts ${brightness.grunts.join(', ')}  gun ${brightness.gun}  screen ${brightness.screen}`);
    }
  }
  report.errors = errors;
  await writeFile(`${out}/indoor.json`, JSON.stringify(report, null, 2));
  if (errors.length) throw new Error(`browser errors: ${errors.join('; ')}`);
  const unreadable = [];
  for (const preset of presets.filter(p => p !== 'low')) {
    const outside = report[preset]['house-outside']?.screen;
    for (const [name, view] of Object.entries(report[preset]).filter(([name]) => !name.endsWith('-outside'))) {
      if (Math.min(...view.grunts) < READABLE.grunt) unreadable.push(`${preset} ${name}: grunt ${Math.min(...view.grunts)}`);
      const base = baseline?.[`${preset} ${name}`];
      view.grunts.forEach((grunt, i) => {
        if (base && grunt < base[i] - READABLE_SLACK) unreadable.push(`${preset} ${name}: grunt ${grunt} (fe14d35 ${base[i]})`);
      });
      if (view.gun < READABLE.gun) unreadable.push(`${preset} ${name}: gun ${view.gun}`);
      if (view.screen < READABLE.screen) unreadable.push(`${preset} ${name}: screen ${view.screen}`);
      if (outside !== undefined && view.screen > READABLE.darker * outside) unreadable.push(`${preset} ${name}: screen ${view.screen}, outside ${outside}`);
    }
  }
  if (unreadable.length) throw new Error(`indoor readability (READABLE): ${unreadable.join('; ')}`);
} finally {
  await browser.close();
}

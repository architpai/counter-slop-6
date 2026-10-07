// What the realistic tiers' first-person weapons (docs/VISUALS.md, R4) cost to draw: the Blender gun,
// the flat gun and no gun, measured in turn in every round in one page per preset and map, so the
// machine's load drifts across all three alike and the difference between them is the gun's own cost.
//   node tests/weapons.cost.mjs URL
// Environment: CS6_PRESETS=medium,high,ultra  CS6_MAPS=downtown,house,mexico,downtown-arena  CS6_ROUNDS=4
//
// The R4-C at the hip at spawn, 1440 x 900 at DPR 2, dynamic resolution pinned at full scale, real
// GPU with vsync and the frame-rate limit off. Each measurement is the median of 80 synchronous
// renders with a 1-pixel readback (after 20 discarded); each look is measured once per round (the
// equipped weapon swaps between its two models in place). Prints one line per preset and map (the
// medians over the rounds) with the load average, and exits 1 if the Blender gun costs more than
// CS6_MARGIN ms (default 1) over the flat one: the absolute times belong to tests/tiers.shots.mjs,
// on an idle machine.
import os from 'node:os';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const presets = (process.env.CS6_PRESETS ?? 'medium,high,ultra').split(',');
const maps = (process.env.CS6_MAPS ?? 'downtown,house,mexico,downtown-arena').split(',');
const rounds = Number(process.env.CS6_ROUNDS ?? 4);
const margin = Number(process.env.CS6_MARGIN ?? 1);
const args = ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

const browser = await chromium.launch({ args });
let over = 0;
for (const preset of presets) {
  for (const map of maps) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
    await page.goto(url);
    await page.waitForFunction(() => window.__game?.live === 1);
    await page.evaluate(({ preset, map }) => {
      const g = window.__game;
      g.hud.onUiAction('gfxPreset', preset, new Event('click'));
      if (map.endsWith('-arena')) g.loadArena(map.slice(0, -'-arena'.length));
      else {
        g.hud.onUiAction('pickMap', map, new Event('click'));
        g.beginSolo();
      }
      g.gs.state = 'pause';
      g.gs.queue.length = 0;
      g.enemies.clear();
      g.effects.clear();
      g.ctx.audio.music(false);
      while (g.pickups.length > 0) g.pickups.pop().mesh.removeFromParent();
      g.dynamic.min = 1;
      g.dynamic.scale = 1;
      g.ctx.renderer.setDynamicScale(1);
      g.player.switchTo(0, true);
      for (let i = 0; i < 90; i++) g.player.update(1 / 60);
      g.hud.hideScreen();
      g.hud.setGameplayVisible(false);
    }, { preset, map });
    await page.waitForFunction(() => {
      const r = window.__game.ctx.renderer;
      return !r.skyPending && !r.texturesPending && !r.bakePending && !r.bakeFading && !r.weaponsPending;
    }, null, { timeout: 90000 });
    // One look per measurement: 'blender' and 'flat' swap the equipped weapon's model in place (each
    // view model keeps both), 'none' hides the rig.
    const measure = look => page.evaluate(look => {
      const g = window.__game, r = g.ctx.renderer, weapon = g.player.weapon, context = r.three.getContext(), pixel = new Uint8Array(4);
      const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
      if (look !== 'none') weapon._useModel(look === 'blender' ? weapon._real : weapon._low);
      r.rig.visible = look !== 'none';
      const once = () => { r.render(g.gs.time, fx); context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel); };
      for (let i = 0; i < 20; i++) once();
      const times = [];
      for (let i = 0; i < 80; i++) {
        const start = performance.now();
        once();
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[40];
    }, look);
    const real = await page.evaluate(() => !!window.__game.player.weapon._real);
    if (!real) throw new Error(`${preset} ${map}: the Blender weapons are not on`);
    const blender = [], flat = [], none = [];
    for (let k = 0; k < rounds; k++) {
      blender.push(await measure('blender'));
      none.push(await measure('none'));
      flat.push(await measure('flat'));
    }
    const cost = median(blender) - median(flat);
    if (cost > margin) over++;
    console.log(`${preset.padEnd(7)} ${map.padEnd(15)} blender ${median(blender).toFixed(2)}  flat ${median(flat).toFixed(2)}  none ${median(none).toFixed(2)} ms`
      + `  gun ${cost >= 0 ? '+' : ''}${cost.toFixed(2)} ms over the flat one  (load ${os.loadavg()[0].toFixed(1)})${cost > margin ? '  OVER' : ''}`);
    await page.close();
  }
}
await browser.close();
process.exit(over > 0 ? 1 : 0);

// A scripted firefight per map and preset: screenshots at fixed moments and the frame times during it (R5).
//   node tests/combat.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=low,ultra  CS6_MAPS=downtown  CS6_GL=swiftshader  CS6_SIZE=1440x900  CS6_DPR=2
//              CS6_STRICT=1 (fail, not warn, on the frame budget)  CS6_VSYNC=1 (keep vsync and the frame-rate limit on)
//
// Maps: the solo maps by key, and `downtown-arena` (the online match's geometry, through the debug
// handle's `loadArena`). The fight, the same every run (Math.random is seeded, and the simulation
// steps at a fixed 1/60 s whatever the frame rate):
//   - the player at the map's start, invulnerable, fires the MP5 full-auto for 2 s at the ground 7 m
//     ahead, beside the grunts (the impacts and holes in view, no grunt killed), and two grenades are
//     thrown from the eye (at 0.1 s and 0.9 s; as a peer's, which hurt nobody);
//   - six grunts in the view at 10, 30 and 60 m (two at each, where the navigation grid allows), held
//     in place but aiming and firing; and one bomber that runs at the player from 14 m and blows up.
// The effects draw from a random stream of their own (every Effects and RealEffects method, and the
// guns' flash pick, swap Math.random while they run), so the fight itself is the same on every preset
// whatever each preset's effects consume.
// Screenshots at 0.3, 1.0, 2.2, 2.6, 2.9, 4.0 and 5.5 s (and t0, before the first shot): the flash,
// tracers, impacts and holes, both grenades' fireballs, rings, debris and smoke, the bomber's blast,
// the casings, and what is left. Then close-ups (`-close-<tag>`): ten hits each on up to three
// surfaces (by material tag) 2.5-5 m from the eye, shot at 0.1 s (the debris) and 2 s later (the holes). Readability (docs/VISUALS.md, readability guardrail): the grunts'
// chests are read back at every moment (a synchronous render, sRGB luma over a box) against t0; the
// largest change per range is recorded, and a grunt whose chest changes by more than READABLE_DELTA
// at two moments running is warned about (smoke sitting over it; a blast's flash lasts one). Frame times: the fight, one
// simulation step per animation frame, every rendered frame's gap timed (vsync and the frame-rate
// limit are off on the real GPU, so a gap is the frame's cost): mean, p95 and the worst. It runs
// twice: cold (`cold`), first thing after the preset's menu wait (MENU_FRAMES, as a player waits at
// the menu while the warm-ups run), so a first-use hitch in a match shows; and warm, after the
// screenshots. Budget on the M4 Pro (measure on a quiet machine: load under 4, no other browser or
// GPU job): Ultra p95 <= 16.7 ms warm, and no frame over 50 ms on any preset, cold or warm. With vsync off the
// page queues frames far ahead of the GPU (render/pacing.ts), and the cold fight's first figures to draw
// release that queue in one 40-90 ms lump a few frames in (the same at 23af3f9, and with no effects in view);
// CS6_VSYNC=1 runs as a player plays, where the cold fight's worst frame is a display interval: with CS6_STRICT=1
// the cold budget fails only there, and the p95 budget is read only with vsync off.
// OUTDIR/summary.json has every number.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-combat';
const presets = (process.env.CS6_PRESETS ?? 'low,medium,high,ultra').split(',');
const maps = (process.env.CS6_MAPS ?? 'downtown,downtown-arena,house,mexico').split(',');
const [width, height] = (process.env.CS6_SIZE ?? '1440x900').split('x').map(Number);
const dpr = Number(process.env.CS6_DPR ?? 2);
const strict = process.env.CS6_STRICT === '1';
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const vsync = process.env.CS6_VSYNC === '1';
const args = gl === 'metal'
  ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', ...vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']]
  : ['--use-gl=angle', `--use-angle=${gl}`];
/** Simulation steps (1/60 s) at which the moments are shot. */
const MOMENTS = [18, 60, 132, 156, 174, 240, 330];
const STEPS = 330;
/** Frame budget: Ultra's p95, and the worst frame on any preset (ms). */
const ULTRA_P95 = 16.7;
const WORST = 50;
/** The largest change of a grunt's chest (sRGB luma, 0-255) that still counts as seen. */
const READABLE_DELTA = 60;
/** Frames at the menu after a preset is picked, before the match: its program warm-ups run meanwhile. */
const MENU_FRAMES = 300;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
const frames = n => page.evaluate(n => new Promise(resolve => {
  let left = n;
  const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);
const warnings = [];
const warn = message => { warnings.push(message); console.warn(`WARN ${message}`); };

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  await page.evaluate(() => {
    const renderer = window.__game.ctx.renderer, render = renderer.render;
    renderer.render = function (...a) { window.__renders?.push(performance.now()); return render.apply(this, a); };
    // The fight, installed once: `setup` places everyone (seeded), `step` advances it by one fixed step.
    const g = window.__game, V = g.ctx.camera.position.constructor;
    const seeded = seed => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const random = Math.random;
    // The effects' own stream: a method of theirs swaps it in while it runs (nested calls keep it).
    let fxRandom = random;
    const wrapped = [];
    const ownStream = (obj, key) => {
      const fn = obj[key];
      obj[key] = function (...args) {
        const saved = Math.random;
        Math.random = fxRandom;
        try { return fn.apply(this, args); } finally { Math.random = saved; }
      };
      wrapped.push([obj, key]);
    };
    const unwrap = () => { for (const [obj, key] of wrapped.splice(0)) delete obj[key]; };
    window.__combat = {
      grunts: [],
      setup() {
        Math.random = seeded(20260926);
        fxRandom = seeded(7);
        unwrap();
        for (const obj of [g.effects, g.effects._real].filter(Boolean)) {
          for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(obj))) {
            const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(obj), key);
            if (key !== 'constructor' && typeof d?.value === 'function') ownStream(obj, key);
          }
        }
        for (const weapon of g.player.weapons) if (weapon._model?.pickFlash) ownStream(weapon._model, 'pickFlash');
        const p = g.player;
        g.enemies.clear(); g.effects.clear(); p.clearNades?.();
        p.reset(g.level.playerStart);
        p.takeDamage = () => {}; p.knockback = () => {};
        p.switchTo(1, true);
        for (let i = 0; i < 90; i++) p.update(1 / 60);
        const eye = p.eye.clone(), ahead = p.forward.clone().setY(0).normalize(), side = new V(-ahead.z, 0, ahead.x);
        const nav = g.ctx.nav, place = (d, s) => {
          for (const k of [1, 0.85, 0.7, 0.55, 0.4]) {
            const want = eye.clone().addScaledVector(ahead, d * k).addScaledVector(side, s);
            const node = nav.nodes[nav.nearest(want, 4, 3)];
            if (!node) continue;
            const at = new V(node.x, node.y, node.z);
            const chest = at.clone().setY(at.y + 1.3);
            if (Math.hypot(at.x - want.x, at.z - want.z) < 4 && g.ctx.world.lineOfSight?.(eye, chest) !== false) return { at, range: d };
          }
          return null;
        };
        this.grunts = [];
        for (const [d, s] of [[10, -2.5], [10, 2.5], [30, -3], [30, 3], [60, -4], [60, 4]]) {
          const spot = place(d, s);
          if (!spot) continue;
          const e = g.enemies.spawn('grunt', spot.at);
          if (!e) continue;
          // Held in place: they turn, aim and fire, but do not close.
          e.stats = { ...e.stats, speed: 0 };
          this.grunts.push({ e, range: spot.range });
        }
        const bomb = place(14, -4);
        if (bomb) g.enemies.spawn('bomber', bomb.at);
        // Their spawn animation, then the player looks at the ground 7 m ahead, beside the grunts'
        // lane: the burst's impacts and holes land in view, and no grunt dies of it.
        for (let i = 0; i < 45; i++) g.enemies.update(1 / 60);
        const to = eye.clone().addScaledVector(ahead, 7).addScaledVector(side, -6).setY(p.body.pos.y).sub(eye);
        p.yaw = Math.atan2(-to.x, -to.z);
        p.pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
        for (let i = 0; i < 10; i++) p.update(1 / 60);
        this.n = 0;
        this.ahead = ahead; this.side = side;
      },
      step() {
        const p = g.player, down = g.input.down, n = this.n;
        g.input.down = action => (action === 'fire' && n < 120) || down.call(g.input, action);
        try {
          // Two grenades, thrown as a peer's are (visual only), so the grunts live to be looked at.
          if (n === 6 || n === 54) {
            const from = p.eye.clone().addScaledVector(p.right, 0.25).addScaledVector(this.ahead, 0.6);
            const vel = this.ahead.clone().multiplyScalar(n === 6 ? 7 : 9).addScaledVector(this.side, n === 6 ? 1.2 : -1.2);
            vel.y += 3.5;
            p.throwGrenade({ pos: from.toArray(), vel: vel.toArray() });
          }
          p.update(1 / 60);
          g.enemies.update(1 / 60);
          g.effects.update(1 / 60);
        } finally { g.input.down = down; }
        this.n = n + 1;
      },
      done() { Math.random = random; unwrap(); },
      /** Up to three surfaces (by material tag) 2.5-5 m from the eye, and a view of each. */
      closeTargets() {
        const p = g.player, eye = p.eye.clone(), seen = new Map();
        for (let k = 0; k < 36; k++) for (const pitch of [-0.5, -0.3, 0, 0.15]) {
          const yaw = k / 36 * Math.PI * 2, cp = Math.cos(pitch);
          const dir = new V(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
          const hit = g.ctx.world.raycast(eye, dir, 6);
          if (!hit || hit.dist < 2.5 || hit.dist > 5) continue;
          // The piece the eye sees there: an overlay with no collider (a path on the lawn) over the box hit, else the box.
          const data = hit.box.data, over = (data.overlays ?? []).filter(o => ['x', 'y', 'z'].every(a => hit.point[a] >= o.min[a] - 0.13 && hit.point[a] <= o.max[a] + 0.13));
          const family = over.length > 0 ? over[over.length - 1].material : data.material ?? 'concrete';
          if (!seen.has(family)) seen.set(family, { family, yaw, pitch });
        }
        return [...seen.values()].slice(0, 3);
      },
      /** Ten hits round a target's view (as the gun's rays land), the effects then run `after` seconds. */
      closeUp(t, after) {
        const p = g.player;
        g.effects.clear();
        p.yaw = t.yaw; p.pitch = t.pitch;
        for (let i = 0; i < 5; i++) p.update(1 / 60);
        const eye = p.eye.clone();
        for (let i = 0; i < 10; i++) {
          const yaw = t.yaw + (fxRandom() - 0.5) * 0.12, pitch = t.pitch + (fxRandom() - 0.5) * 0.12, cp = Math.cos(pitch);
          const dir = new V(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
          const hit = g.ctx.world.raycast(eye, dir, 20);
          if (hit) g.effects.bulletImpact(hit.point, hit.normal, hit.box.data, dir);
        }
        for (let i = 0; i < Math.round(after * 60); i++) g.effects.update(1 / 60);
      },
      moreAfter(after) { for (let i = 0; i < Math.round(after * 60); i++) g.effects.update(1 / 60); },
      /** Each grunt's chest: sRGB luma over a box a quarter of its apparent height, from a synchronous render. */
      chests() {
        const renderer = g.ctx.renderer, three = renderer.three, context = three.getContext();
        renderer.render(g.gs.time, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
        const w = context.drawingBufferWidth, h = context.drawingBufferHeight, camera = g.ctx.camera;
        return this.grunts.map(({ e, range }) => {
          if (!e.alive) return { range, luma: null };
          const chest = e.body.pos.clone().setY(e.body.pos.y + 1.25).project(camera);
          const top = e.body.pos.clone().setY(e.body.pos.y + 1.7).project(camera);
          if (chest.z > 1 || Math.abs(chest.x) > 1 || Math.abs(chest.y) > 1) return { range, luma: null };
          const half = Math.max(1, Math.round(Math.abs(top.y - chest.y) * h / 2 / 3));
          const x = Math.round((chest.x + 1) / 2 * w), y = Math.round((chest.y + 1) / 2 * h);
          const size = 2 * half + 1, pixels = new Uint8Array(size * size * 4);
          context.readPixels(x - half, y - half, size, size, context.RGBA, context.UNSIGNED_BYTE, pixels);
          let sum = 0;
          for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
          return { range, luma: +(sum / (size * size)).toFixed(1) };
        });
      },
    };
  });
  const gpu = await page.evaluate(() => window.__game.quality.device.gpu);
  const summary = { url, gpu, vsync, viewport: { width, height, dpr }, presets: {} };

  for (const preset of presets) {
    summary.presets[preset] = {};
    for (const map of maps) {
      await page.evaluate(preset => {
        const g = window.__game;
        g.hud.onUiAction('mainMenu', null, new Event('click'));
        g.hud.onUiAction('gfxPreset', preset, new Event('click'));
      }, preset);
      await frames(MENU_FRAMES);
      await page.evaluate(({ map }) => {
        const g = window.__game;
        if (map.endsWith('-arena')) g.loadArena(map.slice(0, -'-arena'.length));
        else {
          g.hud.onUiAction('pickMap', map, new Event('click'));
          g.beginSolo();
        }
        g.gs.state = 'pause'; g.gs.queue.length = 0; g.enemies.clear(); g.effects.clear();
        while (g.pickups.length > 0) g.pickups.pop().mesh.removeFromParent();
        g.ctx.audio.music(false);
        g.dynamic.min = 1; g.dynamic.scale = 1; g.ctx.renderer.setDynamicScale(1);
        g.hud.hideScreen(); g.hud.tip('', 0); g.hud.message('', '', 0); g.hud.update(10);
        g.hud.setGameplayVisible(false);
        g.ctx.renderer.rig.visible = true;
      }, { preset, map });
      assert.equal(await page.evaluate(() => window.__game.quality.preset), preset);
      await page.waitForFunction(() => {
        const r = window.__game.ctx.renderer;
        return !r.streaming && !r.bakeFading;
      }, null, { timeout: 60_000 });
      const realistic = await page.evaluate(() => window.__game.effects.realistic);
      if (preset !== 'low' && realistic === false) warn(`${preset} ${map}: the realistic effects are not on`);
      await frames(10);

      const row = { shots: [], readability: {} };
      // The fight timed cold: the first in this preset's match, programs only warmed at the menu.
      await page.evaluate(() => window.__combat.setup());
      row.cold = await timed();
      // With vsync off a cold lump in the first steps is the queue the page ran ahead (see the header): a warning.
      // With vsync on, as a player plays, it is a hitch.
      if (gl === 'metal' && row.cold.worstMs > WORST) {
        (strict && vsync ? errors.push.bind(errors) : warn)(`${preset} ${map}: a cold frame took ${row.cold.worstMs} ms at step ${row.cold.worstAtStep} (over ${WORST}; ${vsync ? 'a first-use hitch?' : 'vsync off: check with CS6_VSYNC=1'})`);
      }

      // The fight, shot at fixed moments.
      await page.evaluate(() => window.__combat.setup());
      const grunts = await page.evaluate(() => window.__combat.grunts.map(g => g.range));
      row.grunts = grunts;
      if (grunts.length < 4) warn(`${preset} ${map}: only ${grunts.length} grunts placed`);
      await frames(3);
      await page.screenshot({ path: `${out}/${preset}-${map}-t0.png`, scale: 'css' });
      row.shots.push(`${preset}-${map}-t0.png`);
      const base = await page.evaluate(() => window.__combat.chests());
      const hidden = base.map(() => 0);
      let step = 0;
      for (const moment of MOMENTS) {
        await page.evaluate(n => { for (let i = 0; i < n; i++) window.__combat.step(); }, moment - step);
        step = moment;
        const name = `${preset}-${map}-t${(moment / 60).toFixed(1)}`;
        await page.screenshot({ path: `${out}/${name}.png`, scale: 'css' });
        row.shots.push(`${name}.png`);
        const chests = await page.evaluate(() => window.__combat.chests());
        chests.forEach((c, i) => {
          const b = base[i];
          if (c.luma === null || !b || b.luma === null) return;
          const delta = Math.abs(c.luma - b.luma), key = `${c.range}m`;
          row.readability[key] = Math.max(row.readability[key] ?? 0, +delta.toFixed(1));
          // A blast's flash may wash a chest out for a moment; smoke that sits over one for two moments in a row hides it.
          hidden[i] = delta > READABLE_DELTA ? hidden[i] + 1 : 0;
          if (hidden[i] === 2) warn(`${name}: the ${c.range} m grunt's chest changed by ${delta.toFixed(0)} two moments running (hidden by smoke?)`);
        });
      }
      await page.evaluate(n => { for (let i = 0; i < n; i++) window.__combat.step(); }, STEPS - step);

      // Close-ups: the impacts, then the holes, on each surface family near the eye.
      await page.evaluate(() => window.__combat.setup());
      for (const t of await page.evaluate(() => window.__combat.closeTargets())) {
        await page.evaluate(t => window.__combat.closeUp(t, 0.1), t);
        await frames(2);
        await page.screenshot({ path: `${out}/${preset}-${map}-close-${t.family}-a.png`, scale: 'css' });
        await page.evaluate(() => window.__combat.moreAfter(2));
        await frames(2);
        await page.screenshot({ path: `${out}/${preset}-${map}-close-${t.family}-b.png`, scale: 'css' });
        row.shots.push(`${preset}-${map}-close-${t.family}-a.png`, `${preset}-${map}-close-${t.family}-b.png`);
      }

      // The same fight again, warm, one step per animation frame, every rendered frame timed.
      await page.evaluate(() => window.__combat.setup());
      Object.assign(row, await timed());
      await page.evaluate(() => { window.__combat.done(); window.__game.enemies.clear(); window.__game.effects.clear(); });
      if (gl === 'metal') {
        // With vsync on a frame is a display interval whatever it costs: the p95 budget is read with it off.
        if (!vsync && preset === 'ultra' && row.frameP95Ms > ULTRA_P95) (strict ? errors.push.bind(errors) : warn)(`${preset} ${map}: frame p95 ${row.frameP95Ms} ms over ${ULTRA_P95}`);
        if (row.worstMs > WORST) (strict ? errors.push.bind(errors) : warn)(`${preset} ${map}: a frame took ${row.worstMs} ms (over ${WORST})`);
      }
      summary.presets[preset][map] = row;
      console.log(`${preset} ${map}: frame ${row.frameMs} ms, p95 ${row.frameP95Ms}, worst ${row.worstMs} (${row.frames} frames, ${row.skippedFrames} skipped)`
        + `, the worst at step ${row.worstAtStep}; cold worst ${row.cold.worstMs} at step ${row.cold.worstAtStep}; grunts ${grunts.join('/')} m; chest change ${JSON.stringify(row.readability)}`);
    }
  }
  summary.warnings = warnings;
  await writeFile(`${out}/summary.json`, `${JSON.stringify(summary, null, 1)}\n`);
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`combat shots: ${presets.length} presets x ${maps.length} maps in ${out}${warnings.length ? `, ${warnings.length} warnings` : ''}`);
} finally {
  await browser.close();
}

/** The fight from its setup, one step per animation frame, every rendered frame's gap timed. */
function timed() {
  return page.evaluate(steps => new Promise(resolve => {
    const renders = window.__renders = [];
    let n = 0, rafs = 0;
    const tick = () => {
      rafs++;
      if (n < steps) { window.__combat.step(); n++; requestAnimationFrame(tick); return; }
      window.__renders = null;
      const times = renders.slice(1).map((at, i) => at - renders[i]);
      const at = q => [...times].sort((a, b) => a - b)[Math.floor((times.length - 1) * q)];
      const mean = times.reduce((s, t) => s + t, 0) / Math.max(1, times.length);
      const worst = Math.max(...times);
      resolve({ frames: times.length, skippedFrames: rafs - renders.length, frameMs: +mean.toFixed(2),
        frameP95Ms: +at(0.95).toFixed(2), worstMs: +worst.toFixed(1), worstAtStep: times.indexOf(worst) + 1 });
    };
    requestAnimationFrame(tick);
  }), STEPS);
}

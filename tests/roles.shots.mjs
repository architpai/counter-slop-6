// Role readability at range (docs/VISUALS.md, V3 and R7): every humanoid role in a row at 30 m, and the
// masks at 60 m, on Training's open floor in full sun, per preset.
//   node tests/roles.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=medium,high,ultra  CS6_GL=metal|swiftshader
//
// For each role at 30 m: its colour signature, the mean sRGB colour of a 2 x 3 grid over its figure
// (head and shoulders, chest, legs), from a synchronous render; the summary gives each role's nearest
// other role and their distance (sRGB, 0-441), so two roles that read alike show. For the masks at 60 m:
// the mask's luma against the helmet or hood and the floor round it. Screenshots of both rows.
// The figures stand still and face the camera (spawned once the operators (R7) are in, so they wear them).
// The run fails if two roles read alike (`READABLE.role`) or a mask does not stand out from the floor
// (`READABLE.mask`); the flat look (fe14d35) had its nearest pairs 3-22 apart.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-roles';
const presets = (process.env.CS6_PRESETS ?? 'medium,high,ultra').split(',');
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
/** The nearest two roles' signatures at least this far apart at 30 m, and each mask this much over the floor at 60 m (sRGB). */
const READABLE = { role: 22, mask: 90 };
const ROLES = ['grunt', 'rusher', 'heavy', 'sniper', 'shield', 'medic', 'breacher', 'packleader', 'smoker', 'rubberbander', 'sapper', 'parry'];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
const frames = n => page.evaluate(n => new Promise(resolve => {
  let left = n;
  const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);
const summary = { url, presets: {} };
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  for (const preset of presets) {
    await page.evaluate(preset => {
      const g = window.__game;
      g.hud.onUiAction('mainMenu', null, new Event('click'));
      g.hud.onUiAction('gfxPreset', preset, new Event('click'));
      g.beginTraining();
      g.gs.state = 'pause';
      g.dynamic.min = 1; g.dynamic.scale = 1; g.ctx.renderer.setDynamicScale(1);
    }, preset);
    await page.waitForFunction(() => {
      const r = window.__game.ctx.renderer;
      return !r.skyPending && !r.texturesPending && !r.bakePending && !r.bakeFading && !r.weaponsPending && !(r.operatorsPending ?? false) && !(r.propsPending ?? false);
    }, null, { timeout: 60_000 });
    const row = {};
    for (const [name, kinds, range] of [['roles', ROLES, 30], ['masks', ['grunt', 'medic', 'sniper', 'heavy', 'smoker', 'parry'], 60]]) {
      // Stand them in a row facing the camera, far from the dummies' lanes (the camera looks back at the spawn).
      await page.evaluate(({ kinds, range }) => {
        const g = window.__game, V = g.player.body.pos.constructor;
        g.enemies.clear(); g.effects.clear();
        g.hud.hideScreen(); g.hud.setGameplayVisible(false); g.ctx.renderer.rig.visible = false;
        // From the range's back wall (Training's floor runs z -32 to 38), looking down it.
        const eye = new V(0, g.level.playerStart.y + 1.6, 33), ahead = new V(0, 0, -1);
        const side = new V(1, 0, 0), spacing = range / 16;
        kinds.forEach((kind, i) => {
          const at = eye.clone().setY(g.level.playerStart.y).addScaledVector(ahead, range).addScaledVector(side, (i - (kinds.length - 1) / 2) * spacing);
          const e = g.enemies.spawn(kind, at);
          e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale);
          e.yaw = e.yawTo = 0; e.root.rotation.y = 0;
          e.root.updateMatrixWorld(true);
        });
        g.effects.clear();
        const camera = g.ctx.camera;
        camera.position.copy(eye);
        camera.rotation.set(-0.02, 0, 0, 'YXZ');
        g.hud.message('', '', 0); g.hud.tip('', 0); g.hud.update(10);
        camera.fov = 82; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      }, { kinds, range });
      await frames(10);
      await page.screenshot({ path: `${out}/${preset}-${name}.png`, scale: 'css' });
      row[name] = await page.evaluate(() => {
        const g = window.__game, renderer = g.ctx.renderer, context = renderer.three.getContext(), camera = g.ctx.camera;
        renderer.render(g.gs.time, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
        const w = context.drawingBufferWidth, h = context.drawingBufferHeight;
        const read = (p, half) => {
          const x = Math.round((p.x + 1) / 2 * w), y = Math.round((p.y + 1) / 2 * h), size = 2 * half + 1, px = new Uint8Array(size * size * 4);
          context.readPixels(x - half, y - half, size, size, context.RGBA, context.UNSIGNED_BYTE, px);
          const c = [0, 0, 0];
          for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) c[k] += px[i + k];
          return c.map(v => v / (size * size));
        };
        const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const V = g.player.body.pos.constructor;
        return g.enemies.list.filter(e => e.alive).map(e => {
          const s = e.stats.scale, base = e.body.pos;
          const tall = Math.abs(base.clone().setY(base.y + 1.8 * s).project(camera).y - base.clone().project(camera).y) * h / 2;
          const half = Math.max(0, Math.round(tall / 16));
          // A 2 x 3 grid: left and right of the centre line, at the head and shoulders, the chest, the legs.
          const grid = [];
          for (const y of [1.55, 1.2, 0.6]) for (const x of [-0.12, 0.12]) grid.push(read(base.clone().add(new V(x * s, y * s, 0)).project(camera), half));
          const face = g.enemies.eye(e).add(new V(0, 0, 0.12)).project(camera);
          const mask = luma(read(face, Math.max(0, Math.round(tall / 30))));
          const hood = luma(read(g.enemies.eye(e).add(new V(0, 0.14 * s, 0)).project(camera), Math.max(0, Math.round(tall / 40))));
          const floor = luma(read(base.clone().add(new V(0.7 * s, 1.5 * s, 0)).project(camera), Math.max(1, Math.round(tall / 10))));
          return { kind: e.type, grid: grid.map(c => c.map(v => Math.round(v))), mask: +mask.toFixed(1), hood: +hood.toFixed(1), background: +floor.toFixed(1),
            maskVsBackground: +Math.abs(mask - floor).toFixed(1), maskVsHeadgear: +Math.abs(mask - hood).toFixed(1) };
        });
      });
    }
    // Each role's nearest other role by colour signature (mean distance over the grid's cells).
    const roles = row.roles;
    for (const a of roles) {
      let best = Infinity, who = null;
      for (const b of roles) {
        if (a === b) continue;
        const d = a.grid.reduce((sum, c, i) => sum + Math.hypot(c[0] - b.grid[i][0], c[1] - b.grid[i][1], c[2] - b.grid[i][2]), 0) / a.grid.length;
        if (d < best) { best = d; who = b.kind; }
      }
      a.nearest = { kind: who, distance: +best.toFixed(1) };
    }
    summary.presets[preset] = row;
    console.log(preset, 'roles at 30 m, nearest:', roles.map(r => `${r.kind}~${r.nearest.kind} ${r.nearest.distance}`).join(', '));
    console.log(preset, 'masks at 60 m:', row.masks.map(m => `${m.kind} mask ${m.mask} vs bg ${m.background} / headgear ${m.hood}`).join(', '));
  }
  summary.errors = errors;
  await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 1));
  assert.deepEqual(errors, [], 'no browser errors');
  const unreadable = [];
  for (const [preset, row] of Object.entries(summary.presets)) {
    for (const r of row.roles) if (r.nearest.distance < READABLE.role) unreadable.push(`${preset}: ${r.kind} ~ ${r.nearest.kind} ${r.nearest.distance}`);
    for (const m of row.masks) if (m.maskVsBackground < READABLE.mask) unreadable.push(`${preset}: ${m.kind}'s mask ${m.maskVsBackground} over the floor`);
  }
  assert.deepEqual(unreadable, [], 'roles tell apart at 30 m and masks read at 60 m');
} finally {
  await browser.close();
}

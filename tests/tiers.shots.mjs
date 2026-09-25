// Fixed-viewpoint screenshots and frame times for every quality preset on every map.
//   node tests/tiers.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=low,high  CS6_MAPS=downtown  CS6_GL=swiftshader  CS6_SIZE=1440x900  CS6_DPR=2
//
// Each preset × map gets four views (five on House), all deterministic:
//   spawn    the player's start view (no gun, no HUD)
//   enemies  grunts at 10, 30 and 60 m, one sunlit and one shadowed at each range where the map
//            allows it; the corridor is searched from the level geometry, and the AI is frozen.
//            Sun or shade is rays from knee, hip, chest, head and the ground at the feet against
//            the meshes that cast shadows (all clear or all blocked); knee to head must be in view.
//            The log marks a shade grunt outside every shadow map (it renders lit) as 'h'.
//            Where the best corridor misses a shade range that another one fills (House at
//            60 m), that corridor is a second view, enemies-shade, logged in brackets: '[H]'.
//   overview a fixed high corner view of the whole map
//   weapon   first person at spawn with the R4-C at the hip
// Enemies, effects and pickups are cleared per map, and the run is paused, so shots only differ
// by preset. Realistic presets wait for the map's sky and environment to stream in first.
// Dynamic resolution is pinned at full scale, so every preset is judged at its base resolution. The page renders at CS6_DPR (default 2, so the presets' pixel-ratio caps apply);
// screenshots are saved at CSS size. On the real GPU vsync and the frame-rate limit are off, so
// live frame times show the cost of each preset instead of the display's refresh.
// OUTDIR/summary.json records frame times (live rAF, and a synchronous render + readback, both
// with the gun in view, after a discarded warm-up), the fog at 60 m, and where each grunt stood.
// Later phases rerun this script to compare before and after.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-tiers';
const presets = (process.env.CS6_PRESETS ?? 'low,medium,high,ultra').split(',');
const maps = (process.env.CS6_MAPS ?? 'downtown,house,mexico').split(',');
const [width, height] = (process.env.CS6_SIZE ?? '1440x900').split('x').map(Number);
const dpr = Number(process.env.CS6_DPR ?? 2);
// Real GPU by default on macOS; SwiftShader everywhere else, or when asked for.
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const args = gl === 'metal'
  ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
  : ['--use-gl=angle', `--use-angle=${gl}`];
/** Fog share at 60 m that still reads as "clearly visible" (docs/VISUALS.md, V6). */
const FOG_AT_60_MAX = 0.15;

/** Corridors for the enemy view, [x, z, dx, dz], where the geometry search picks a poor one. */
const PREFERRED = {
  // The nearest open lane runs under a tree the colliders cannot see (trunks are visual only).
  house: [[29, 25, -1, 0]],
};

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
// Music off before boot; a fresh profile otherwise starts it on the first gesture.
await page.addInitScript(() => localStorage.setItem('cs6_music', '0'));
const frames = n => page.evaluate(n => new Promise(resolve => {
  let left = n;
  const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);
const shot = async name => { await frames(3); await page.screenshot({ path: `${out}/${name}.png`, scale: 'css' }); return `${name}.png`; };
const warnings = [];
const warn = message => { warnings.push(message); console.warn(`WARN ${message}`); };

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  const gpu = await page.evaluate(() => window.__game.quality.device.gpu);
  const summary = { url, gpu, viewport: { width, height, dpr }, presets: {} };

  // A fresh profile is on Auto with its menu benchmark still to run. Starting a match before it
  // finishes must not switch dynamic resolution off for the match.
  // Ultra has dynamic resolution off; stepping Auto down keeps the benchmark pending.
  await page.evaluate(() => { const q = window.__game.quality; while (!q.values.dynamicRes && q.lowerPreset) q.acceptLower(); });
  assert.equal(await page.evaluate(() => window.__game.quality.needsBenchmark), true, 'fresh profile has a pending benchmark');
  await page.evaluate(() => { window.__game.dynamic.reset(); window.__game.beginSolo(); });
  await frames(20);
  assert.notEqual(await page.evaluate(() => window.__game.dynamic.ema), null, 'dynamic resolution runs in a match before the benchmark');

  for (const preset of presets) {
    summary.presets[preset] = {};
    for (const map of maps) {
      // Load the map, freeze the run, pin full resolution, clear the HUD.
      await page.evaluate(({ preset, map }) => {
        const g = window.__game;
        g.hud.onUiAction('mainMenu', null, new Event('click'));
        g.hud.onUiAction('gfxPreset', preset, new Event('click'));
        g.hud.onUiAction('pickMap', map, new Event('click'));
        g.beginSolo();
        g.gs.state = 'pause'; g.gs.queue.length = 0; g.enemies.clear(); g.effects.clear();
        // Wave-start drops differ run to run; the paused run spawns no more.
        while (g.pickups.length > 0) g.pickups.pop().mesh.removeFromParent();
        g.ctx.audio.music(false);
        g.dynamic.min = 1; g.dynamic.scale = 1; g.ctx.renderer.setDynamicScale(1);
        for (let i = 0; i < 90; i++) g.player.update(1 / 60);
        g.effects.clear();
        g.hud.hideScreen(); g.hud.tip('', 0); g.hud.message('', '', 0); g.hud.update(10);
        g.hud.setGameplayVisible(false);
      }, { preset, map });
      assert.equal(await page.evaluate(() => window.__game.level.key), map);
      assert.equal(await page.evaluate(() => window.__game.quality.preset), preset);
      await page.waitForFunction(() => !window.__game.ctx.renderer.skyPending, null, { timeout: 15_000 });
      await frames(20);

      const row = { shots: [] };
      // How much fog a grunt at 60 m wears on this preset (linear fog).
      row.fogAt60 = await page.evaluate(() => {
        const fog = window.__game.ctx.scene.fog;
        return +Math.min(1, Math.max(0, (60 - fog.near) / (fog.far - fog.near))).toFixed(3);
      });
      // Weapon view first, while the camera still holds the player's settled pose.
      await page.evaluate(() => { window.__game.ctx.renderer.rig.visible = true; });
      row.shots.push(await shot(`${preset}-${map}-weapon`));

      // Frame time in the weapon view, as the player gets it: live frames, then synchronous
      // renders with a 1-pixel readback (GPU cost). Each block runs once to warm up (shader
      // compiles, target allocation) and is discarded; the second run is recorded.
      const timing = () => page.evaluate(() => new Promise(resolve => {
        const g = window.__game, times = [];
        let last = 0;
        const tick = now => {
          if (last) times.push(now - last);
          last = now;
          if (times.length < 120) { requestAnimationFrame(tick); return; }
          const renderer = g.ctx.renderer, context = renderer.three.getContext(), pixel = new Uint8Array(4);
          const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
          const once = () => { renderer.render(g.gs.time, fx); context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel); };
          for (let i = 0; i < 10; i++) once();
          const renders = [];
          for (let i = 0; i < 60; i++) {
            const start = performance.now();
            once();
            renders.push(performance.now() - start);
          }
          const at = (list, q) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)];
          const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
          resolve({ frameMs: +mean.toFixed(2), frameP95Ms: +at(times, 0.95).toFixed(2), renderMs: +at(renders, 0.5).toFixed(2) });
        };
        requestAnimationFrame(tick);
      }));
      await timing();
      Object.assign(row, await timing());
      await page.evaluate(() => { window.__game.ctx.renderer.rig.visible = false; });
      row.shots.push(await shot(`${preset}-${map}-spawn`));

      // Enemy readability: find a clear 64 m corridor at ground level, then place grunts.
      row.enemies = await page.evaluate(preferred => {
        const g = window.__game, V = g.player.body.pos.constructor, world = g.world, b = g.level.bounds;
        const down = new V(0, -1, 0), start = g.level.playerStart;
        const sun = g.ctx.renderer.sun.position.clone().sub(g.ctx.renderer.sun.target.position).normalize();
        // Sun or shade is decided by the meshes the shadow map draws, not by colliders: tree
        // canopies and awnings cast shadows but have no collider, invisible walls the reverse.
        const shown = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
        // The grapple drones fly on the level clock, which differs per preset; their small, moving
        // shadows would make the corridor search pick a different view from run to run.
        const movers = new Set(g.level.movers.map(m => m.mesh));
        const casters = [];
        let meshProto = null;
        g.ctx.scene.traverse(o => {
          if (!o.isMesh || !o.castShadow || !shown(o) || movers.has(o)) return;
          casters.push(o);
          if (!o.isInstancedMesh && !o.isSkinnedMesh && !meshProto) meshProto = Object.getPrototypeOf(o);
        });
        /** Does any shadow-casting mesh cross the ray? */
        const meshHit = (origin, direction, far) => {
          // A duck-typed Raycaster: Mesh.raycast only reads these fields.
          const caster = { ray: { origin: origin.clone(), direction: direction.clone().normalize() }, near: 0, far, camera: g.ctx.camera,
            layers: g.ctx.camera.layers, params: { Mesh: {} } };
          const hits = [];
          for (const mesh of casters) {
            // The shadow map draws both faces' depth; test both too.
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const sides = materials.map(m => m.side);
            for (const m of materials) m.side = 2;
            if (mesh.isInstancedMesh) {
              const instance = Object.create(meshProto), matrix = mesh.matrixWorld.clone();
              instance.geometry = mesh.geometry; instance.material = mesh.material;
              for (let i = 0; i < mesh.count && hits.length === 0; i++) {
                mesh.getMatrixAt(i, matrix);
                instance.matrixWorld = matrix.premultiply(mesh.matrixWorld);
                instance.raycast(caster, hits);
              }
            } else mesh.raycast(caster, hits);
            materials.forEach((m, i) => { m.side = sides[i]; });
            if (hits.length > 0) return true;
          }
          return false;
        };
        // Grunt body points (knee, hip, chest, head) and ground points around the feet. A spot is
        // shade only if the sun is blocked at all of them and sun only if at none, so a wire or
        // a post shadow across the feet counts as neither.
        const BODY = [0.45, 0.9, 1.3, 1.65], FEET = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]];
        const light = (x, y, z) => {
          const points = [...BODY.map(h => new V(x, y + h, z)), ...FEET.map(([fx, fz]) => new V(x + fx, y + 0.05, z + fz))];
          const blocked = points.filter(point => meshHit(point, sun, 150)).length;
          return blocked === points.length ? 'shadow' : blocked === 0 ? 'sun' : null;
        };
        const ground = (x, z) => {
          const hit = world.raycast(new V(x, 2.2, z), down, 5);
          return hit && Math.abs(hit.point.y) < 0.6 ? hit.point.y : null;
        };
        // Candidates on a 4 m grid, nearest the player start first; the corridor must stay in bounds.
        const eyes = [];
        for (let x = b.minX + 4; x <= b.maxX - 4; x += 4) for (let z = b.minZ + 4; z <= b.maxZ - 4; z += 4) {
          for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const ex = x + dx * 64, ez = z + dz * 64;
            if (ex < b.minX || ex > b.maxX || ez < b.minZ || ez > b.maxZ) continue;
            eyes.push({ x, z, dx, dz, d: Math.hypot(x - start.x, z - start.z) });
          }
        }
        eyes.sort((a, c) => a.d - c.d || a.x - c.x || a.z - c.z);
        // Hand-picked corridors go first; they still have to pass the same checks.
        eyes.unshift(...preferred.map(([x, z, dx, dz]) => ({ x, z, dx, dz, d: 0 })));
        const clear = (from, dir, length) => {
          const hit = world.raycast(from, dir, length);
          return !hit || hit.dist >= length - 0.05;
        };
        // Clear of colliders and of visual-only meshes (trunks, canopies, awnings) alike.
        const seen = (from, dir, length) => clear(from, dir, length) && !meshHit(from, dir, length - 0.05);
        // Ranges start on different sides of the centre line, and no grunt may stand in front
        // of another on screen (angular gap of at least one and a half body widths).
        const lanes = { 10: -3, 30: 0, 60: 3 };
        /** Sunlit and shaded spots at 10, 30 and 60 m down one corridor; nothing is spawned. */
        const plan = c => {
          const eye = new V(c.x, c.y + 1.6, c.z), dir = new V(c.dx, 0, c.dz), side = new V(-c.dz, 0, c.dx);
          const placed = [], taken = [];
          for (const range of [10, 30, 60]) {
            const found = {};
            // Farther out the view is wider, so the search may stray farther from the lane.
            const reach = range === 60 ? 30 : 14, steps = [0];
            for (let off = 2; off <= reach; off += 2) steps.push(off, -off);
            for (const step of steps) {
              const off = lanes[range] + step, angle = Math.atan2(off, range), half = 0.45 / range;
              if (taken.some(t => Math.abs(t.angle - angle) < 1.5 * (t.half + half))) continue;
              const x = eye.x + dir.x * range + side.x * off, z = eye.z + dir.z * range + side.z * off;
              const y = ground(x, z);
              if (y === null) continue;
              // The whole body in view, not just the chest: no legs behind a rim, no head behind a post.
              if (!BODY.every(h => {
                const to = new V(x, y + h, z).sub(eye), length = to.length();
                return seen(eye, to.normalize(), length);
              })) continue;
              const lit = light(x, y, z);
              if (!lit || found[lit]) continue;
              found[lit] = [x, y, z];
              taken.push({ angle, half });
              if (found.sun && found.shadow) break;
            }
            placed.push({ range, sun: found.sun ?? null, shadow: found.shadow ?? null });
          }
          return { eye, dir, placed, score: placed.reduce((n, p) => n + (p.sun ? 1 : 0) + (p.shadow ? 1 : 0), 0) };
        };
        // Score the first 40 open corridors and keep the one that fills the most slots; ties go
        // to the earlier (hand-picked, then nearest) corridor. When it misses a shade slot that
        // another corridor fills, that corridor becomes a second view, so every range is tested.
        let best = null, tried = 0;
        const plans = [];
        for (const c of eyes) {
          const y = ground(c.x, c.z);
          if (y === null) continue;
          const dir = new V(c.dx, 0, c.dz);
          // A 3 m lane for the full 64 m, and a 12 m wide foreground so no post or trunk fills the frame.
          // Rays 0.75 m apart, so a trunk cannot slip between them.
          const lane = [-1.5, -0.75, 0, 0.75, 1.5].every(off => seen(new V(c.x - c.dz * off, y + 1.1, c.z + c.dx * off), dir, 64));
          // Open sky above the eye (no carport or canopy framing the shot), and the foreground.
          const near = lane && !meshHit(new V(c.x, y + 1.6, c.z), new V(0, 1, 0), 8) && [-6, -5.25, -4.5, -3.75, -3, -2.25, 2.25, 3, 3.75, 4.5, 5.25, 6].every(off => [1.1, 2.6].every(h =>
            seen(new V(c.x - c.dz * off, y + h, c.z + c.dx * off), dir, 15)));
          if (!near) continue;
          const result = plan({ ...c, y });
          plans.push(result);
          if (!best || result.score > best.score) best = result;
          if (best.score === 6 || ++tried >= 40) break;
        }
        if (!best) return null;
        const shade = plans.find(p => p.placed.some((slot, i) => slot.shadow && !best.placed[i].shadow)) ?? null;
        const view = p => p && { eye: p.eye.toArray(), dir: p.dir.toArray(), placed: p.placed };
        return { best: view(best), shade: view(shade) };
      }, PREFERRED[map] ?? []);
      /** Spawn a view's grunts facing the eye and put the camera there. */
      const stage = view => page.evaluate(({ eye, dir, placed }) => {
        const g = window.__game, V = g.player.body.pos.constructor;
        g.enemies.clear(); g.effects.clear();
        for (const p of placed) {
          for (const spot of [p.sun, p.shadow]) {
            if (!spot) continue;
            const [x, y, z] = spot, e = g.enemies.spawn('grunt', new V(x, y, z));
            e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale);
            e.yaw = e.root.rotation.y = Math.atan2(eye[0] - x, eye[2] - z);
            e.root.updateMatrixWorld(true);
          }
        }
        g.effects.clear();
        const camera = g.ctx.camera;
        camera.position.fromArray(eye);
        camera.rotation.set(-0.03, Math.atan2(-dir[0], -dir[2]), 0, 'YXZ');
        camera.fov = 82; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      }, view);
      // Is each shade grunt inside a shadow map the renderer drew for this view? Every shadow
      // light's box is tested (Low's box on the eye, Medium's box ahead, the cascades); outside
      // all of them a grunt renders lit whatever stands over it.
      const drawn = async view => {
        const inside = await page.evaluate(placed => {
          const r = window.__game.ctx.renderer, V = window.__game.player.body.pos.constructor;
          const lights = [r.sun, ...(r.cascades ?? [])].filter(light => light.castShadow);
          const inBox = ([x, y, z]) => [0.45, 1.3, 1.65].every(h => lights.some(light => {
            const camera = light.shadow.camera;
            camera.updateMatrixWorld();
            const p = new V(x, y + h, z).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
            return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1;
          }));
          return placed.map(p => (p.shadow ? inBox(p.shadow) : null));
        }, view.placed);
        view.placed.forEach((p, i) => { p.shadowDrawn = inside[i]; });
      };
      const views = row.enemies;
      if (views) {
        row.enemies = views.best;
        await stage(views.best);
        row.shots.push(await shot(`${preset}-${map}-enemies`));
        await drawn(views.best);
        if (views.shade) {
          row.enemiesShade = views.shade;
          await stage(views.shade);
          row.shots.push(await shot(`${preset}-${map}-enemies-shade`));
          await drawn(views.shade);
        }
        row.enemies.placed.forEach((p, i) => {
          const extra = views.shade?.placed[i];
          if (!p.sun) warn(`${preset} ${map}: no sun spot for the ${p.range} m grunt`);
          if (!p.shadow && !extra?.shadow) warn(`${preset} ${map}: no shadow spot for the ${p.range} m grunt`);
          for (const slot of [p, extra]) {
            if (slot?.shadowDrawn === false) warn(`${preset} ${map}: the ${p.range} m shade grunt is outside every shadow map and renders lit`);
          }
        });
      } else warn(`${preset} ${map}: no clear 64 m corridor for the enemy view`);

      // Overview from a fixed high corner.
      await page.evaluate(() => {
        const g = window.__game, b = g.level.bounds, camera = g.ctx.camera;
        g.enemies.clear();
        camera.position.set(b.maxX * 1.05, 42, b.maxZ * 1.05);
        camera.fov = 60; camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      });
      row.shots.push(await shot(`${preset}-${map}-overview`));
      summary.presets[preset][map] = row;
      console.log(preset.padEnd(7), map.padEnd(9), `frame ${row.frameMs} ms (p95 ${row.frameP95Ms})`, `render ${row.renderMs} ms`,
        row.enemies ? `grunts ${row.enemies.placed.map((p, i) => {
          // A shade slot only the second view filled is shown in brackets: [H].
          const extra = row.enemiesShade?.placed[i];
          const shade = p.shadow ? (p.shadowDrawn ? 'H' : 'h') : extra?.shadow ? (extra.shadowDrawn ? '[H]' : '[h]') : '-';
          return `${p.range}m:${p.sun ? 'S' : '-'}${shade}`;
        }).join(' ')}` : 'no corridor');
    }
  }
  summary.warnings = warnings;
  summary.errors = errors;
  await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert.deepEqual(errors, [], 'no browser errors');
  for (const [preset, rows] of Object.entries(summary.presets)) {
    for (const [map, row] of Object.entries(rows)) {
      assert.ok(row.fogAt60 <= FOG_AT_60_MAX, `${preset} ${map}: grunts at 60 m wear ${row.fogAt60} fog`);
    }
  }
} finally {
  await browser.close();
}

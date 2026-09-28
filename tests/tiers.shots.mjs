// Fixed-viewpoint screenshots and frame times for every quality preset on every map.
//   node tests/tiers.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=low,high  CS6_MAPS=downtown  CS6_GL=swiftshader  CS6_SIZE=1440x900  CS6_DPR=2
//
// Maps: the solo maps by key, `training` (the training mode, its 22 dummies kept for the weapon
// view and its frame times, as the player gets it), and `downtown-arena` (the online match's own
// geometry, loaded through the debug handle's `loadArena`).
//
// Each preset × map gets four views (five on House), and on the realistic presets a fifth (sixth), all deterministic:
//   spawn    the player's start view (no gun, no HUD)
//   enemies  grunts at 10, 30 and 60 m, one sunlit and one shadowed at each range where the map
//            allows it; the corridor is searched from the level geometry, and the AI is frozen.
//            Sun or shade is rays from knee, hip, chest, head and the ground at the feet against
//            the meshes that cast shadows (all clear or all blocked); knee to head must be in view.
//            The log marks a shade grunt outside every shadow map (it renders lit) as 'h'.
//            Where the best corridor misses a shade range that another one fills (House at
//            60 m), that corridor is a second view, enemies-shade, logged in brackets: '[H]'.
//   overview a fixed high corner view of the whole map
//   sun      into the sun (R8's light shafts) past something thin in front of it, the nearest such spot to the start
//            (from the start where there is none); a preset with shafts on is also rendered with them off and the
//            frame's change judged (`SHAFT_DIFF`)
//   weapon   first person at spawn with the R4-C at the hip
//   weapon-<kind>, weapon-<kind>-ads  every gun slot at the hip and at full aim, and the knife's
//            guard, weapon-knife; on the realistic presets these are the Blender weapons (R4). A scoped
//            gun (R4-C, MP5, sniper) hides its model at full aim and the HUD draws the optic instead:
//            its -ads shot shows the model anyway, so the optic's axis can be seen on the screen
//            centre, and weapon-<kind>-scope is what the player sees there, the HUD's optic overlay
//            (the rest of the HUD stays hidden)
// Enemies, effects and pickups are cleared per map, and the run is paused, so shots only differ
// by preset. Realistic presets wait for the map's sky and environment, its texture sets, its
// bake (lightmap or AO map, and probe grid), the first-person weapons, the operators (R7) and the detail kit (R6) to stream in first.
// Dynamic resolution is pinned at full scale, so every preset is judged at its base resolution. The page renders at CS6_DPR (default 2, so the presets' pixel-ratio caps apply);
// screenshots are saved at CSS size. On the real GPU vsync and the frame-rate limit are off, so
// live frame times show the cost of each preset instead of the display's refresh.
// OUTDIR/summary.json records frame times (live frames, the gaps between the frames the game
// rendered, with the animation frames it skipped counted apart, and a synchronous render + readback,
// both with the gun in view, after a discarded warm-up), the fog at 60 m, where each grunt stood, and
// the streamed textures: KTX2 bytes fetched for the map and GPU bytes resident, the same for the bake,
// and the weapons' download (glb and maps, fetched once per session, so counted on the first map of
// each preset whose size is new) and GPU bytes, the same for the effect atlases (R5); and the frames that stalled while they streamed in
// (streamStalls: gaps between rendered frames, warned past STREAM_STALL, and rafWorstMs, the worst
// gap between animation frames over the same span). While something streams the game skips an
// animation frame when the GPU is `MAX_FRAMES_IN_FLIGHT` behind (render/pacing.ts): a run of skips
// is one long rendered gap. With nothing streaming none is skipped (skippedFrames in the timing).
// It also records each staged grunt's chest and mask contrast (readability), and fails on a realistic
// preset where one reads worse than fe14d35's flat look in the same view (`READABLE_SLACK`, `WAIVED`).
// Later phases rerun this script to compare before and after.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-tiers';
const presets = (process.env.CS6_PRESETS ?? 'low,medium,high,ultra').split(',');
const maps = (process.env.CS6_MAPS ?? 'downtown,house,mexico,training,downtown-arena').split(',');
const [width, height] = (process.env.CS6_SIZE ?? '1440x900').split('x').map(Number);
const dpr = Number(process.env.CS6_DPR ?? 2);
// Real GPU by default on macOS; SwiftShader everywhere else, or when asked for.
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const args = gl === 'metal'
  ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
  : ['--use-gl=angle', `--use-angle=${gl}`];
/** Fog share at 60 m that still reads as "clearly visible" (docs/VISUALS.md, V6). */
const FOG_AT_60_MAX = 0.15;
/**
 * The readability guardrail (docs/VISUALS.md): on the realistic presets every staged grunt's chest and mask
 * contrast must be at least fe14d35's (the flat look, tests/readability-fe14d35.json, the same views) less this
 * slack (sRGB luma, 0-255). Two runs of one build read the same to 0.0 in all 96 readings (the synchronous
 * render is deterministic); the slack only covers the readings' rounding. CS6_READABILITY=0 records without judging.
 */
const READABLE_SLACK = 0.5;
/**
 * The readings where the operators (R7) read under fe14d35 and no balance of their light (render/materials.ts
 * `OPERATOR_LIGHT`, `OPERATOR_AO`) lifted them without sinking others: [chest, mask] as they read, each held there
 * (less the slack) instead of to fe14d35, so it cannot get worse; null keeps fe14d35's. Most are a grunt whose
 * chest sits within a few luma of its background on both looks (the sunlit Training floor, House's shade) or a
 * figure 20 pixels tall under the fog (Downtown at 70 m); in each the mask reads 13-60 above fe14d35's.
 * docs/VISUALS.md (R7, readability) lists them. Two moved with R6's re-bake, which lights the operators (the probe
 * grid) and Medium's walls (the AO map): each static-geometry change moves them by a few tenths of a luma either way
 * (House's shade grunt reads 99.8 with the eaves' fascia, 100.2 without it and the same 99.8 with it painted dark;
 * Mexico's 36.5 with the stacks' broken caprock, 36.1 without it), so they are held where the as-built bake reads.
 */
const WAIVED = {
  'medium mexico best 30 sun': [36.5, 75.6],
  'medium training best 10 sun': [1.4, null],
  'high downtown best 70 shade': [2.4, null],
  'high training best 10 sun': [10.6, null],
  'high downtown-arena best 10 sun': [23.3, null],
  'ultra house shade 10 shade': [99.8, null],
  'ultra house shade 60 shade': [8.5, null],
  'ultra training best 10 sun': [11.4, null],
  'ultra downtown-arena best 10 sun': [21.7, null],
};
const baseline = process.env.CS6_READABILITY === '0' ? null
  : JSON.parse(await readFile(new URL('./readability-fe14d35.json', import.meta.url), 'utf8')).readings;

/**
 * The sun view's change with the light shafts on (and the lens dirt), against off, sRGB 0-255 a channel: [least,
 * most] on average over the frame and at its 99th percentile. The M4 Pro reads 0.9-1.5 and 6-11 on Ultra; under the
 * least the pass draws nothing, over the most it veils the frame, as two builds before R8's last did.
 */
const SHAFT_DIFF = { mean: [0.3, 4], p99: [3, 30] };
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
/**
 * Streaming is paced so a map's uploads never stall the game (render/index.ts, `UPLOAD_GAP_MS`):
 * more than `frames` frames over `ms` while a map's textures, bake and weapons stream in is warned.
 */
const STREAM_STALL = { ms: 100, frames: 3 };
const warnings = [];
/** Sun views whose light shafts fall outside `SHAFT_DIFF`. */
const shaftFailures = [];
const warn = message => { warnings.push(message); console.warn(`WARN ${message}`); };

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.live === 1);
  // Every frame the game renders is timed while `__renders` is a list (the synchronous renders below are not).
  await page.evaluate(() => {
    const renderer = window.__game.ctx.renderer, render = renderer.render;
    renderer.render = function (...args) { window.__renders?.push(performance.now()); return render.apply(this, args); };
  });
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
      // Load the map, freeze the run, pin full resolution, clear the HUD. Every frame gap is kept from
      // here until the map's textures, bake and weapons are all in (STREAM_STALL below).
      await page.evaluate(() => {
        performance.clearResourceTimings();
        window.__renders = [];
        const gaps = window.__streamGaps = [];
        let last = performance.now();
        const tick = now => { gaps.push([last, now - last]); last = now; if (window.__streamGaps === gaps) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      await page.evaluate(({ preset, map }) => {
        const g = window.__game;
        g.hud.onUiAction('mainMenu', null, new Event('click'));
        g.hud.onUiAction('gfxPreset', preset, new Event('click'));
        if (map === 'training') g.beginTraining();
        else if (map.endsWith('-arena')) g.loadArena(map.slice(0, -'-arena'.length));
        else {
          g.hud.onUiAction('pickMap', map, new Event('click'));
          g.beginSolo();
        }
        g.gs.state = 'pause'; g.gs.queue.length = 0; g.effects.clear();
        // Training's dummies stand where they always do; a solo wave's spawns differ run to run.
        if (map !== 'training') g.enemies.clear();
        // Wave-start drops differ run to run; the paused run spawns no more.
        while (g.pickups.length > 0) g.pickups.pop().mesh.removeFromParent();
        g.ctx.audio.music(false);
        g.dynamic.min = 1; g.dynamic.scale = 1; g.ctx.renderer.setDynamicScale(1);
        for (let i = 0; i < 90; i++) g.player.update(1 / 60);
        g.effects.clear();
        g.hud.hideScreen(); g.hud.tip('', 0); g.hud.message('', '', 0); g.hud.update(10);
        g.hud.setGameplayVisible(false);
      }, { preset, map });
      assert.equal(await page.evaluate(() => window.__game.level.key + (window.__game.level.arena ? '-arena' : '')), map);
      assert.equal(await page.evaluate(() => window.__game.quality.preset), preset);
      await page.waitForFunction(() => {
        const r = window.__game.ctx.renderer;
        // The bake fades in over BAKE_FADE_MS once it is on the GPU; shoot the final look.
        return !r.skyPending && !r.texturesPending && !r.bakePending && !r.bakeFading && !r.weaponsPending && !r.operatorsPending && !(r.propsPending ?? false);
      }, null, { timeout: 30_000 });
      // Figures already in play put their operators on only out of view (R7): look away for a few frames,
      // so Training's dummies are drawn as the tier draws them.
      await page.evaluate(() => {
        const camera = window.__game.ctx.camera;
        window.__view = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
        camera.position.y += 500; camera.lookAt(camera.position.x, camera.position.y + 1, camera.position.z);
      });
      await frames(3);
      await page.evaluate(() => {
        const camera = window.__game.ctx.camera, view = window.__view;
        camera.position.copy(view.position); camera.quaternion.copy(view.quaternion); camera.updateMatrixWorld();
      });
      await frames(20);

      const row = { shots: [] };
      // Frames that stalled while the map's assets streamed in, past the load's own first frames
      // (the level build, and the first realistic frame's programs).
      row.streamStalls = await page.evaluate(({ skip, over }) => {
        // The same start for both: the rAF gaps from the first rendered frame kept.
        const renders = window.__renders, from = renders[skip] ?? Infinity;
        const rendered = renders.slice(1).map((at, i) => at - renders[i]).slice(skip);
        const raf = window.__streamGaps.filter(([at]) => at >= from).map(([, ms]) => ms);
        window.__streamGaps = window.__renders = null;
        return { frames: rendered.length, over: rendered.filter(ms => ms > over).length, worstMs: Math.round(Math.max(0, ...rendered)),
          rafWorstMs: Math.round(Math.max(0, ...raf)) };
      }, { skip: 3, over: STREAM_STALL.ms });
      if (row.streamStalls.over > STREAM_STALL.frames) {
        warn(`${preset} ${map}: ${row.streamStalls.over} frames over ${STREAM_STALL.ms} ms while its assets streamed (worst ${row.streamStalls.worstMs} ms)`);
      }
      row.textures = await page.evaluate(() => {
        const stats = window.__game.ctx.renderer.textureStats, bake = window.__game.ctx.renderer.bakeStats;
        const resources = performance.getEntriesByType('resource');
        const fetched = resources.filter(e => e.name.includes('/textures/') && e.name.endsWith('.ktx2'));
        const baked = resources.filter(e => e.name.includes('/maps/') && /\.(ktx2|bin)$/.test(e.name));
        const weapons = resources.filter(e => e.name.includes('/weapons/') || e.name.endsWith('/models/weapons.glb'));
        const mb = list => +(list.reduce((n, e) => n + e.encodedBodySize, 0) / 1e6).toFixed(2);
        const arms = window.__game.ctx.renderer.weapons.stats;
        const effects = resources.filter(e => e.name.includes('/fx/') && e.name.endsWith('.ktx2'));
        const operators = resources.filter(e => e.name.includes('/characters/') || /\/models\/operators(-lod1)?\.glb$/.test(e.name));
        const cast = window.__game.ctx.renderer.operators?.stats ?? { residentBytes: 0 };
        const atlases = window.__game.ctx.renderer.fx?.stats ?? { residentBytes: 0 };
        const props = resources.filter(e => e.name.includes('/props/'));
        const kit = window.__game.ctx.renderer.props?.stats ?? { residentBytes: 0, triangles: 0 };
        return { files: fetched.length, fetchedMB: mb(fetched), textures: stats.textures, residentMB: +(stats.residentBytes / 1e6).toFixed(1),
          bakeFile: bake.file, bakeMB: mb(baked), bakeResidentMB: +(bake.residentBytes / 1e6).toFixed(1),
          weaponsMB: mb(weapons), weaponsResidentMB: +(arms.residentBytes / 1e6).toFixed(1),
          effectsMB: mb(effects), effectsResidentMB: +(atlases.residentBytes / 1e6).toFixed(1),
          operatorsMB: mb(operators), operatorsResidentMB: +(cast.residentBytes / 1e6).toFixed(1),
          propsMB: mb(props), propsResidentMB: +(kit.residentBytes / 1e6).toFixed(1), propsTriangles: kit.triangles };
      });
      // How much fog a grunt's chest at 60 m wears on this preset, from the eye: the linear fog and, on the realistic
      // tiers, the haze (R8; `renderer.fogAt`, the shader's own formula; a build before R8 has the linear fog only).
      row.fogAt60 = await page.evaluate(() => {
        const r = window.__game.ctx.renderer, fog = window.__game.ctx.scene.fog;
        if (r.fogAt) return +r.fogAt(60, 1.7, 1.25).toFixed(3);
        return +Math.min(1, Math.max(0, (60 - fog.near) / (fog.far - fog.near))).toFixed(3);
      });
      // Weapon view first, while the camera still holds the player's settled pose.
      await page.evaluate(() => { window.__game.ctx.renderer.rig.visible = true; });
      row.shots.push(await shot(`${preset}-${map}-weapon`));

      // Frame time in the weapon view, as the player gets it: live frames, then synchronous
      // renders with a 1-pixel readback (GPU cost). Each block runs once to warm up (shader
      // compiles, target allocation) and is discarded; the second run is recorded.
      const timing = () => page.evaluate(() => new Promise(resolve => {
        const g = window.__game, renders = window.__renders = [];
        let rafs = 0;
        const tick = () => {
          if (++rafs < 121) { requestAnimationFrame(tick); return; }
          window.__renders = null;
          const times = renders.slice(1).map((at, i) => at - renders[i]);
          const renderer = g.ctx.renderer, context = renderer.three.getContext(), pixel = new Uint8Array(4);
          const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
          const once = () => { renderer.render(g.gs.time, fx); context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel); };
          for (let i = 0; i < 10; i++) once();
          const synced = [];
          for (let i = 0; i < 60; i++) {
            const start = performance.now();
            once();
            synced.push(performance.now() - start);
          }
          const at = (list, q) => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)];
          const mean = times.reduce((sum, t) => sum + t, 0) / times.length;
          resolve({ frameMs: +mean.toFixed(2), frameP95Ms: +at(times, 0.95).toFixed(2), skippedFrames: rafs - renders.length,
            renderMs: +at(synced, 0.5).toFixed(2) });
        };
        requestAnimationFrame(tick);
      }));
      await timing();
      Object.assign(row, await timing());
      // Every gun slot at the hip and aimed, then the knife's guard. Aim and melee are held through a
      // wrapped `input.down`; the player steps by hand, as the run is paused.
      for (const kind of await page.evaluate(() => window.__game.player.weapons.map(w => w.kind))) {
        const slot = await page.evaluate(kind => window.__game.player.weapons.findIndex(w => w.kind === kind), kind);
        for (const aim of [false, true]) {
          const scoped = await page.evaluate(({ slot, aim }) => {
            const g = window.__game, down = g.input.down;
            g.player.switchTo(slot, true);
            g.input.down = action => (aim && action === 'aim') || down.call(g.input, action);
            try { for (let i = 0; i < 70; i++) g.player.update(1 / 60); } finally { g.input.down = down; }
            g.effects.clear();
            const w = g.player.weapon, scoped = aim && w.scope && !w.root.visible;
            w.root.visible = true;
            return scoped;
          }, { slot, aim });
          const name = `${preset}-${map}-weapon-${kind === 'rifle' ? 'mp5' : kind}`;
          row.shots.push(await shot(`${name}${aim ? '-ads' : ''}`));
          if (scoped) {
            // As the player sees it: the model hidden and the HUD's optic overlay, alone.
            await page.evaluate(() => { window.__game.player.weapon.root.visible = false; });
            const overlay = await page.addStyleTag({ content: '.no-gameplay .scope.is-visible { display: block; transition: none; }' });
            row.shots.push(await shot(`${name}-scope`));
            await overlay.evaluate(tag => tag.remove());
          }
        }
      }
      // The paused player animates the gun only, so the knife's guard (melee held) is stepped here.
      await page.evaluate(() => {
        const g = window.__game, p = g.player;
        const guard = { ...p.weaponState(), fire: false, firePressed: false, aim: true, meleePressed: false };
        for (let i = 0; i < 40; i++) p.melee.animate(guard, 1 / 60);
        p.weapon.root.visible = false;
      });
      row.shots.push(await shot(`${preset}-${map}-weapon-knife`));
      await page.evaluate(() => {
        const g = window.__game, p = g.player, rest = { ...p.weaponState(), aim: false };
        for (let i = 0; i < 40; i++) p.melee.animate(rest, 1 / 60);
        for (let i = 0; i < 40; i++) g.player.update(1 / 60);
        g.player.switchTo(0, true);
        for (let i = 0; i < 60; i++) g.player.update(1 / 60);
        g.effects.clear();
        g.ctx.renderer.rig.visible = false;
      });
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
        // The realistic tiers' dressing (R6: trim, kit props, cables) stays out of the choice as well, so every
        // preset and phase stages the same views and the readability below judges the dressing in them.
        const dressing = new Set(g.level.surfaces.filter(s => s.realOnly).map(s => s.mesh));
        g.ctx.renderer.props?.root.traverse(o => dressing.add(o));
        const casters = [];
        let meshProto = null;
        g.ctx.scene.traverse(o => {
          if (!o.isMesh || !o.castShadow || !shown(o) || movers.has(o) || dressing.has(o)) return;
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
        // The sun view below looks for a thin occluder in front of the sun with it.
        window.__meshHit = meshHit;
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
      /**
       * Readability (docs/VISUALS.md, the guardrail): for each staged grunt, sRGB luma of its chest (a box
       * a sixth of its apparent height), of its mask (the brightest tenth of a box a fifth of its height
       * round the head) and of the ground and
       * wall behind it either side (boxes 0.8 m out from its middle), from a synchronous render. The
       * contrast is chest or mask against that background.
       */
      const readability = view => page.evaluate(placed => {
        const g = window.__game, renderer = g.ctx.renderer, context = renderer.three.getContext(), camera = g.ctx.camera;
        renderer.render(g.gs.time, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
        const w = context.drawingBufferWidth, h = context.drawingBufferHeight;
        const lumas = (p, half) => {
          const x = Math.round((p.x + 1) / 2 * w), y = Math.round((p.y + 1) / 2 * h), size = 2 * half + 1, px = new Uint8Array(size * size * 4);
          context.readPixels(x - half, y - half, size, size, context.RGBA, context.UNSIGNED_BYTE, px);
          const out = [];
          for (let i = 0; i < px.length; i += 4) out.push(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
          return out.sort((a, b) => a - b);
        };
        const luma = (p, half) => { const l = lumas(p, half); return l.reduce((a, b) => a + b, 0) / l.length; };
        const V = g.player.body.pos.constructor;
        return g.enemies.list.filter(e => e.alive).map(e => {
          const range = Math.round(e.body.pos.distanceTo(camera.position) / 10) * 10;
          const foot = e.body.pos.clone().project(camera), top = e.body.pos.clone().setY(e.body.pos.y + 1.8).project(camera);
          const tall = Math.abs(top.y - foot.y) * h / 2;
          const chest = e.body.pos.clone().setY(e.body.pos.y + 1.25).project(camera);
          const face = g.enemies.eye(e).add(new V(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(0.12)).project(camera);
          const right = new V(Math.cos(e.yaw), 0, -Math.sin(e.yaw)).multiplyScalar(0.8);
          const sides = [1, -1].map(s => luma(e.body.pos.clone().setY(e.body.pos.y + 1.1).addScaledVector(right, s).project(camera), Math.max(1, Math.round(tall / 10))));
          const background = (sides[0] + sides[1]) / 2;
          // The mask: the bright tail (90th percentile) of a box round the head a fifth of the figure across,
          // so a mask a few pixels wide at 60 m is read wherever it lands in the box.
          const head = lumas(face, Math.max(1, Math.round(tall / 10)));
          const c = luma(chest, Math.max(1, Math.round(tall / 12))), m = head[Math.floor(0.9 * (head.length - 1))];
          const near = spot => spot && Math.hypot(spot[0] - e.body.pos.x, spot[2] - e.body.pos.z) < 0.5;
          const light = placed.some(p => near(p.sun)) ? 'sun' : placed.some(p => near(p.shadow)) ? 'shade' : '?';
          return { range, light, chest: +c.toFixed(1), mask: +m.toFixed(1), background: +background.toFixed(1),
            chestContrast: +Math.abs(c - background).toFixed(1), maskContrast: +Math.abs(m - background).toFixed(1) };
        });
      }, view.placed);
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
        row.readability = await readability(views.best);
        if (views.shade) {
          row.enemiesShade = views.shade;
          await stage(views.shade);
          row.shots.push(await shot(`${preset}-${map}-enemies-shade`));
          await drawn(views.shade);
          row.readability.push(...(await readability(views.shade)).map(r => ({ ...r, view: 'shade' })));
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

      // Light shafts (R8), on the realistic presets: looking into the sun past something thin in front of it (the
      // crane's beams, a roof's edge), the nearest such spot to the start, or from the start where there is none. A
      // preset with shafts on is read back with them and without (a synchronous render each): how much they change
      // the frame, sRGB 0-255 a channel, on average and at the 99th percentile. SHAFT_DIFF bounds both.
      if (await page.evaluate(() => window.__game.quality.values.look === 'realistic')) {
        row.sun = await page.evaluate(() => {
          const g = window.__game, V = g.player.body.pos.constructor, renderer = g.ctx.renderer, camera = g.ctx.camera;
          const b = g.level.bounds, start = g.level.playerStart, meshHit = window.__meshHit;
          const sun = renderer.sun.position.clone().sub(renderer.sun.target.position).normalize();
          const side = new V(0, 1, 0).cross(sun).normalize(), up = sun.clone().cross(side);
          const ground = (x, z) => {
            const hit = g.world.raycast(new V(x, 2.2, z), new V(0, -1, 0), 5);
            return hit && Math.abs(hit.point.y) < 0.6 ? hit.point.y : null;
          };
          // Blocked straight at the sun from 4 m out, open sky above the eye, and at least three of eight rays 1.5
          // degrees round it clear: something thin crosses the sun.
          const around = Array.from({ length: 8 }, (_, i) => sun.clone()
            .addScaledVector(side, Math.cos(i * Math.PI / 4) * 0.026).addScaledVector(up, Math.sin(i * Math.PI / 4) * 0.026).normalize());
          const eyes = [];
          if (meshHit) for (let x = b.minX + 2; x <= b.maxX - 2; x += 2) for (let z = b.minZ + 2; z <= b.maxZ - 2; z += 2) {
            if (Math.hypot(x - start.x, z - start.z) <= 40) eyes.push([x, z]);
          }
          eyes.sort((p, q) => Math.hypot(p[0] - start.x, p[1] - start.z) - Math.hypot(q[0] - start.x, q[1] - start.z) || p[0] - q[0] || p[1] - q[1]);
          let eye = null;
          for (const [x, z] of eyes) {
            const y = ground(x, z);
            if (y === null) continue;
            const at = new V(x, y + 1.6, z);
            if (meshHit(at, new V(0, 1, 0), 30) || !meshHit(at.clone().addScaledVector(sun, 4), sun, 116)) continue;
            if (around.filter(dir => !meshHit(at, dir, 120)).length >= 3) { eye = at; break; }
          }
          const thin = eye !== null;
          eye ??= new V(start.x, (ground(start.x, start.z) ?? 0) + 1.6, start.z);
          camera.position.copy(eye);
          camera.fov = 75; camera.updateProjectionMatrix();
          camera.lookAt(eye.clone().add(sun)); camera.updateMatrixWorld();
          const view = { eye: eye.toArray().map(n => +n.toFixed(1)), thin };
          if (!renderer.post.config.shafts) return view;
          const context = renderer.three.getContext(), w = context.drawingBufferWidth, h = context.drawingBufferHeight;
          const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
          const frame = () => {
            for (let i = 0; i < 3; i++) renderer.render(g.gs.time, fx);
            const px = new Uint8Array(w * h * 4);
            context.readPixels(0, 0, w, h, context.RGBA, context.UNSIGNED_BYTE, px);
            return px;
          };
          const on = frame(), config = renderer.post.config;
          renderer.post.configure({ ...config, shafts: false });
          const off = frame();
          renderer.post.configure(config);
          const diffs = new Uint16Array(w * h);
          let sum = 0;
          for (let i = 0, n = 0; i < on.length; i += 4, n++) {
            const d = (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3;
            diffs[n] = Math.round(d);
            sum += d;
          }
          diffs.sort();
          return { ...view, meanDiff: +(sum / diffs.length).toFixed(2), p99Diff: diffs[Math.floor(diffs.length * 0.99)] };
        });
        row.shots.push(await shot(`${preset}-${map}-sun`));
        if (row.sun.meanDiff !== undefined) {
          if (row.sun.meanDiff < SHAFT_DIFF.mean[0] || row.sun.meanDiff > SHAFT_DIFF.mean[1] || row.sun.p99Diff < SHAFT_DIFF.p99[0] || row.sun.p99Diff > SHAFT_DIFF.p99[1]) {
            shaftFailures.push(`${preset} ${map}: the light shafts change the sun view by ${row.sun.meanDiff} on average, ${row.sun.p99Diff} at p99 `
              + `(${SHAFT_DIFF.mean.join('-')}, ${SHAFT_DIFF.p99.join('-')})`);
          }
        }
      }
      summary.presets[preset][map] = row;
      console.log(preset.padEnd(7), map.padEnd(14), `frame ${row.frameMs} ms (p95 ${row.frameP95Ms})`, `render ${row.renderMs} ms`,
        `tex ${row.textures.fetchedMB} MB fetched, ${row.textures.residentMB} MB resident`,
        `bake ${row.textures.bakeFile ?? '-'} ${row.textures.bakeMB} MB`, `weapons ${row.textures.weaponsMB} MB`,
        row.enemies ? `grunts ${row.enemies.placed.map((p, i) => {
          // A shade slot only the second view filled is shown in brackets: [H].
          const extra = row.enemiesShade?.placed[i];
          const shade = p.shadow ? (p.shadowDrawn ? 'H' : 'h') : extra?.shadow ? (extra.shadowDrawn ? '[H]' : '[h]') : '-';
          return `${p.range}m:${p.sun ? 'S' : '-'}${shade}`;
        }).join(' ')}` : 'no corridor',
        row.sun?.meanDiff !== undefined ? `shafts ${row.sun.meanDiff} (p99 ${row.sun.p99Diff})${row.sun.thin ? '' : ' open sun'}` : '');
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
  const unreadable = [];
  for (const [preset, rows] of Object.entries(summary.presets)) {
    for (const [map, row] of Object.entries(rows)) {
      for (const r of row.readability ?? []) {
        const key = [preset, map, r.view ?? 'best', r.range, r.light].join(' '), base = baseline?.[key];
        if (!base) continue;
        const [chest, mask] = base.map((v, i) => WAIVED[key]?.[i] ?? v), held = i => (WAIVED[key]?.[i] != null ? 'held at' : 'fe14d35');
        if (r.chestContrast < chest - READABLE_SLACK) unreadable.push(`${key}: chest ${r.chestContrast} (${held(0)} ${chest})`);
        if (r.maskContrast < mask - READABLE_SLACK) unreadable.push(`${key}: mask ${r.maskContrast} (${held(1)} ${mask})`);
      }
    }
  }
  assert.deepEqual(unreadable, [], 'grunts read at least as well as on fe14d35');
  assert.deepEqual(shaftFailures, [], 'the light shafts show, and do not veil the frame');
} finally {
  await browser.close();
}

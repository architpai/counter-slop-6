# Performance loop — round log

Shared by every round. Read the rules, the baseline and the tried/rejected list before you start; append your round
at the end. Harness commands: `perf/README.md`. What counts as a gain: `perf/NOISE.md`.

## Rules for the whole loop

- **Never lower quality.** Each preset's visible output must pass the SSIM gate against the baseline
  (`node perf/quality.mjs compare baseline <label>`: >= 0.995 per image). Any intentional pixel change must be
  justified in the round's entry and gets a side-by-side check (`perf/shots/<label>/_diff/`). Baseline captures are
  byte-identical run to run, so any SSIM under 1.0 is a real change: explain it even when it passes.
- **Do not change what a preset turns on.** No turning AO, shadows, bloom, AA, soft particles, shafts, texture size,
  view distance, render scale or effects detail off or down in any preset (`src/engine/render/quality.ts`
  `PRESET_VALUES`).
- **In scope:** runtime code, shaders, render passes, render targets, CPU hot paths, allocations/GC, asset settings
  that look the same. **Out of scope:** gameplay, netcode, preset contents.
- **A change counts only if it beats the noise floor** (`perf/NOISE.md`: the suite aggregates in `compare.mjs`, full
  matrix). Otherwise revert it and log it under *Tried / rejected ideas* with its numbers.
- **Blender jobs** (if ever needed) run on the MSI via `tools/blender/msi.sh`, never on this Mac.
- **Run `npm run typecheck` and `npm test` before every commit.**
- **Clean timings:** never run two benchmarks or captures at once, and never while a build, `npm test` or another
  agent's heavy work runs. Rebuild (`npm run build`) after every source change: the harness serves `out/`.
- A round's change must keep the simulation deterministic for the harness: keep the order and number of
  `Math.random()` calls in update code unless the round says why (the fight state hash in the bench log moves
  otherwise, and the fight screenshots with it).

## Round 0 — baseline

Commit `be47535` (main at the start of the loop), 2026-10-18. Apple M4 Pro, macOS, Playwright headless chromium
153.0.8010.12, ANGLE Metal, `--disable-gpu-vsync --disable-frame-rate-limit`, 1920x1080, DPR 1, production build
(`out/` served by `perf/serve.mjs`), each cell in a fresh browser, dynamic resolution pinned off, fps cap 0
(verified per cell: preset, fpsTarget 0, pixel ratio 1, 1920x1080 buffer, dynamic scale 1; idle rate 230-3300 fps).
Scenarios: `path` (900 frames, one lap of the map's walkable loop, HUD and view model on), `fight` (900 frames,
seeded mulberry32, fixed roster on a fixed schedule, auto-aim, fire held, real grenade every 90 frames, gore full),
fixed 1/60 s simulation step.

### Baseline table (median of baseline-1..3)

Frame = real rAF-to-rAF ms. cpu = wall ms in the game's rAF callback (includes waits on the GPU command buffer);
js = traced main-thread CPU ms. GPU timer queries do not work on ANGLE Metal (see below), so there is no GPU column.
Tris/calls are per frame, shadow passes included. Load is cold (fresh browser).

| map | preset | path frame med/p95/p99 | path cpu / js | fight frame med/p95/p99 | fight cpu / js | calls path/fight | tris k path/fight | programs | first playable / ready s | heap MB end (fight peak) | long >33 / >2x med |
|---|---|---|---|---|---|---|---|---|---|---|---|
| downtown | low | 2 / 2.6 / 2.9 | 1.8 / 0.18 | 1.4 / 2.8 / 3.5 | 0.8 / 0.76 | 67/188 | 25/106.8 | 21 | 0.6 / 0.63 | 61 (83) | 0/2, 0/45 |
| downtown | medium | 2.7 / 4.5 / 5.5 | 2.7 / 0.4 | 3.3 / 5.7 / 8 | 2.4 / 1.76 | 134/200 | 252.2/439.9 | 52 | 0.54 / 8.25 | 58 (118) | 0/14, 0/19 |
| downtown | high | 3.2 / 4.7 / 6 | 3.1 / 0.47 | 3.9 / 6.4 / 8.1 | 3.1 / 2.72 | 194/306 | 261.7/828.2 | 56 | 0.86 / 8.32 | 58 (116) | 0/5, 0/13 |
| downtown | ultra | 4.4 / 5.7 / 8.2 | 4.3 / 0.6 | 5.2 / 8.1 / 11.3 | 4.1 / 2.98 | 219/351 | 321.9/1012.4 | 58 | 0.95 / 10.72 | 65 (119) | 0/2, 0/13 |
| house | low | 2.1 / 2.6 / 2.9 | 2 / 0.19 | 1.5 / 2.7 / 3.9 | 1 / 0.95 | 72/218 | 19.7/107.5 | 21 | 0.88 / 0.91 | 37 (75) | 0/2, 0/27 |
| house | medium | 2.9 / 3.9 / 5.3 | 2.8 / 0.53 | 3.8 / 6.4 / 8.3 | 3 / 2.29 | 151/226 | 216.3/426.3 | 52 | 0.52 / 8.44 | 45 (102) | 0/4, 0/17 |
| house | high | 3.3 / 5.1 / 7 | 3.2 / 0.69 | 4.7 / 8 / 10.4 | 3.6 / 3.15 | 212/316 | 207.6/820.2 | 56 | 0.83 / 8.6 | 65 (110) | 0/15, 0/14 |
| house | ultra | 4.2 / 5.1 / 7 | 4.1 / 1.16 | 5.2 / 8.4 / 11.4 | 4.1 / 3.38 | 242/362 | 255.1/1037.6 | 58 | 0.92 / 11.11 | 61 (108) | 0/0, 0/14 |
| mexico | low | 2.1 / 2.6 / 3 | 2 / 0.26 | 1.5 / 2.9 / 4.2 | 0.9 / 0.91 | 92/209 | 40.1/107.5 | 20 | 0.96 / 0.97 | 71 (100) | 0/6, 0/34 |
| mexico | medium | 2.9 / 4.2 / 5.4 | 2.8 / 0.54 | 3.7 / 5.8 / 7.7 | 2.8 / 2.35 | 172/261 | 188/370.1 | 51 | 0.55 / 7.17 | 83 (126) | 0/4, 0/13 |
| mexico | high | 3.3 / 4.3 / 6.2 | 3.2 / 0.58 | 4.5 / 7.2 / 9.5 | 3.4 / 3.19 | 205/292 | 210.7/666.1 | 55 | 0.88 / 7.45 | 74 (224) | 0/1, 0/14 |
| mexico | ultra | 4.4 / 5.6 / 8.4 | 4.3 / 0.83 | 5.2 / 8.3 / 10.9 | 4 / 4 | 246/360 | 259.9/857.5 | 57 | 1.04 / 9.3 | 69 (385) | 0/2, 0/12 |
| training | low | 1.4 / 2.8 / 3.2 | 1.3 / 0.95 | 2.5 / 3.7 / 4.3 | 1.9 / 2.1 | 223/470 | 81/205.8 | 22 | 0.98 / 1.03 | 61 (76) | 0/36, 0/2 |
| training | medium | 2.6 / 3.9 / 4.7 | 2.4 / 1.6 | 4.3 / 6.1 / 7.8 | 3.6 / 3.55 | 140/262 | 281.5/608 | 49 | 0.6 / 5.52 | 47 (106) | 0/6, 0/5 |
| training | high | 3 / 4.4 / 5.5 | 2.9 / 2.58 | 5.3 / 7.6 / 9.1 | 4.5 / 4.17 | 175/313 | 720/1548.4 | 53 | 0.7 / 5.55 | 49 (111) | 0/5, 0/3 |
| training | ultra | 3.9 / 5.7 / 7.7 | 3.8 / 2.37 | 6 / 8.1 / 9.6 | 5.1 / 5.04 | 213/367 | 918.6/1870.2 | 55 | 0.75 / 6.75 | 64 (106) | 0/9, 0/2 |

Suite aggregates (geomean of frame mean over map x scenario): all 3.170 ms, low 1.615, medium 3.289, high 3.911,
ultra 4.900 (`perf/NOISE.md`).

Source files: `perf/results/baseline-1.json`, `baseline-2.json`, `baseline-3.json`, profile
`perf/results/baseline-profile.json`. Table: `node perf/table.mjs perf/results/baseline-{1,2,3}.json`.
Screenshot reference: `perf/shots/baseline/` (gitignored; recapture with `node perf/quality.mjs capture baseline`
on commit `be47535` if lost).

### GPU timing

`EXT_disjoint_timer_query_webgl2` is exposed and returns non-zero, non-disjoint results that grow with GPU work, but
they are 2-3x the frame interval even when the GPU is the limit (ultra downtown idle: query 8.3 ms vs frame 3.9 ms;
one injected heavy fullscreen pass: query 20.7 ms vs frame 8.2 ms). Per-pass segments summed to 43-52 ms per 4 ms
frame. So `gpuMs` is null (every cell runs the calibration and records why; if a future Chrome passes it, the column
fills in). Per-pass GPU cost comes from `--profile` by **ablation**: skip one pass for 240 frames and read the drop in
frame time (0.1 ms resolution, ±0.1-0.3 ms noise; negative values are noise).

### Where the time goes

Read from `baseline-profile.json` (CPU ms per sub-step, GPU ms by ablation) and the traces.

- **Realistic presets are GPU-bound on the path, CPU-bound in fights.** On the ultra path the callback waits
  3.1-3.2 ms per 4.1-4.4 ms frame on the GPU command buffer, with 0.5-1.0 ms of real JS. In fights the wait drops to
  0-0.6 ms and JS rises to 2-4.7 ms: on medium/high/ultra the training and mexico fights are fully CPU-bound (wait 0).
  The GPU process also spends 2.1-2.5 ms per frame on its main thread in fights (command decode and ANGLE translation
  per call): fewer calls and state changes help twice.
- **Low** (flat look, 1.4-2.6 ms): the path frame is mostly the browser's presentation overhead (js 0.18-0.28 ms).
  The biggest GPU item is Low's shadow map, redrawn every other frame: ablation 0.8 ms (downtown) and 1.4 ms (house)
  averaged over frames, so roughly 1.6-2.8 ms on the frames that draw it. That is the bimodal Low frame time.
  Composite 0-0.75 ms. Fights: js 0.75-2 ms (training 2 ms: 22 dummies plus the roster).
- **Medium** (2.5-4.3 ms; MSAA2+SMAA, 1 soft shadow box, bloom): every post pass ablates at about 0.1 ms or less on
  the path, so the **main scene pass** (lit materials, MSAA2 resolve, fog patches) is about two thirds of the frame.
  Fight CPU: render.main submission 1.1-2.0 ms, render.shadows 0.2-0.5, enemies.update 0.2-0.5, player 0.2.
- **High** (2.9-5.3 ms; 2 cascades, half-res GTAO, soft particles): shadows 0.1-0.75 ms, SMAA 0.05-0.5, GTAO + blur
  0.05-0.9, bloom 0.1-0.4 in sum. Fight CPU: render.main 1.8-2.5, render.shadows 0.4-0.8 (two cascades re-submit the
  casters), enemies 0.2-0.6.
- **Ultra** (3.9-6.2 ms; MSAA4+SMAA, 3 cascades, full-res GTAO, shafts): path GPU by ablation: **GTAO 0.25-0.8 ms**,
  **SMAA 0.15-0.75**, **shadows 0.25-0.65**, AO blur 0.05-0.3, agx tone 0.05-0.35, bloom and shafts ≤ 0.3 each. The
  remainder, about 2-2.5 ms, is the **main scene pass** with MSAA4. Fight CPU: **render.main submission 2.7-3.3 ms**,
  **render.shadows 0.8-1.2 ms** (three cascades), enemies.update 0.3-0.7, player 0.2-0.3, training.update ~0.4-0.7
  (`other(step)`).
- **Triangles** include the shadow passes: training ultra draws 0.92M per frame on the path and 1.87M in the fight
  (22 operator-LOD0 dummies of 18-25k tris, drawn in the main pass and up to 3 cascades). Other maps: 0.25-0.32M path,
  0.86-1.04M fight on ultra.
- **Heap**: the fight peaks at 100-385 MB sampled (mexico ultra 385 MB) against 37-83 MB after it: heavy allocation
  churn in fights (blood, effects, physics hits, separation closures).
- **Load**: Low is ready in 0.6-1.0 s cold; the realistic presets in 5.5-11.1 s (ultra 6.8-11.1 s), with the first
  playable frame at 0.5-1.0 s. The rest is paced streaming: upload slots (`UPLOAD_GAP_MS` 24, 60 kB/ms, back-off),
  the 3 s match quiet start, the 500 ms settle, the 1.5 s bake fade, compiles, and the serial asset chain.

### Hot spot leads

Ranked by expected gain × breadth. All must keep pixels (SSIM gate) and preset contents.

1. **Fight CPU submission (realistic presets).** render.main CPU 2-3.3 ms in ultra fights, 350-370 calls. Each enemy
   figure has its own material copies (`render/figure.ts:738`, `render/operators.ts:602`, `render/materials.ts:369`):
   about 105 material switches per frame with three's full uniform refresh. Share the material while the hit tint
   is black and swap in the copy only while it flashes; look for other per-object uniform and state churn.
2. **Shadow casters per cascade.** The level is merged into one mesh per surface key across the whole map
   (`level/build.ts:563-584`), so every cascade (even ultra's 8 m box) draws every level triangle, and each cascade
   re-submits every caster (render.shadows CPU 0.8-1.2 ms on ultra fights, GPU 0.25-0.85). Split shadow-only static
   casters into spatial cells so cascades cull, use an operator shadow LOD (index-subset like the gib code,
   `operators.ts:527-559`) for the wide cascades, and consider caching static casters per cascade.
3. **Shadow sampling.** three r170's RGBA-packed 16-tap soft PCF (`render/shadows.ts:41`, three
   `shadowmap_pars_fragment`) in every lit fragment, in up to 3 cascades with blend zones. Hardware-compared depth
   textures (`sampler2DShadow`, 9 bilinear taps = the same filter weights) and depth-only shadow rendering.
   Verify the SSIM gate carefully (filter precision).
4. **Main scene pass shading** (about 50-60 % of the ultra path frame): the zero-intensity extra cascade lights still
   run `RE_Direct` per fragment (`shadows.ts:50-61`, `render/index.ts:664`), the dark FX point light too (three
   `lights_fragment_begin`), 3-octave macro noise per level fragment (`materials.ts:564-581`), PMREM irradiance
   sampled then zeroed (`materials.ts:609`). All exact-output savings except the noise texture.
5. **GTAO full-res on ultra** (0.25-0.8 ms) and its blur (0.05-0.35): shader cost (taps, depth reconstruction,
   precision, target formats), not resolution. Must stay full-res.
6. **SMAA** (0.15-0.75 ms): three's SMAAPass uses HalfFloat edges/weights targets (8-bit in the reference); clears;
   stencil/early-out for non-edge pixels.
7. **Low's shadow pass** (0.8-1.4 ms averaged, every other frame, the source of Low's bimodal frame time and p95):
   the 70 m follow box draws a lot of the level; cull casters to the box, or cache the static part.
8. **Enemy and training CPU**: enemies.update 0.3-0.7 ms, training.update 0.4-0.7 ms. Ray-vs-sphere pre-reject before
   `updateWorldMatrix` + recursive `intersectObject` per enemy per ray (`figure.ts:124-138`,
   `enemies/index.ts:577-585`, every frame in `game/training.ts:47`); duplicate matrix work in `syncModel`
   (`enemies/model.ts:140-144`).
9. **Allocation churn / GC** (fight heap peaks 100-385 MB): separation closures per pair (`enemies/index.ts:343`),
   blood/tracer/effect spawns cloning vectors (`effects.ts:343-351,747,852-871`, `effects-real.ts:352-574`), physics
   ray hits (`physics.ts:287-294`), per-frame HUD slot arrays (`boot.ts:612`). Keep the `rand()` call order.
10. **Post-pass overhead**: every fullscreen pass goes through a full `WebGLRenderer.render` (about 19 per frame on
    ultra, `postfx.ts:1064`); medium resolves MSAA depth nobody reads (`postfx.ts:941-953`,
    `resolveDepthBuffer`); shaft targets RGBA16F where RG16F is enough; canvas has a depth buffer it never uses.
11. **Training's triangle load**: 0.9-1.9M tris from 22 LOD0 dummies in the main pass and 3 cascades; a distance or
    shadow LOD that keeps pixels.
12. **Load time** (realistic 5.5-11 s ready): upload pacing constants (`render/index.ts:103-105`, back-off at
    `:1154`), the serial asset chain (`:1184-1248`), bake layout gaps (`:1082-1087`), full-scene warm-up draws with
    all shadow maps (`:1366-1399`). The bake fade (1.5 s) is a visible design choice: leave it.

### Gotchas for later rounds

- **Rebuild before measuring**: the harness serves `out/`; a stale build measures the old code.
  `meta.git.dirty` in a result flags source changes outside `perf/`.
- **Single cells are noisy** (median spread 5.7 %, worst 27 %); judge on the suite aggregates of a full matrix and
  re-run near the threshold. Low's frame time is mostly presentation; judge Low on frame median, p95 and js.
- **`cpu` is not CPU**: it includes GPU waits. Use `js` (traced) for CPU work; it is noisier (median 19 % per cell).
- **GPU timer queries lie on ANGLE Metal**; use `--profile` ablation, and expect ±0.1-0.3 ms noise per pass.
- **Timers are 0.1 ms-coarse** (no cross-origin isolation): medians move in steps; `frame mean` is finer.
- **Never freeze `performance.now`** in the page: the bake layout and prop merge spin on it and hang.
- **Determinism**: the harness seeds `Math.random` (separate streams for audio, renderer and async callbacks) and
  steps a virtual 1/60 s clock. A change to the number or order of `rand()` calls in update code moves the fight
  (state hash) and the fight screenshots: expected, but then the change must be argued pixel-neutral another way.
- **Readiness**: in a live match the game defers 4-5 warm-up draws to the next menu by design; the bench counts only
  in-match ones (`facts.deferredWarmups`).
- **Quality capture**: fights run last in the downtown browser because `P.reset` does not rebuild breakables; the
  indoor grunts keep their red spawn-in dashes (frozen in pause, as in `report/capture.mjs`).

### Durations

| job | time |
|---|---|
| `npm run build` | ≈5 s |
| `node perf/bench.mjs` (full matrix, 16 cells, with traces) | 12.4-13.4 min (low cells ≈20 s, ultra ≈65 s) |
| `node perf/bench.mjs --no-trace` | ≈9-10 min |
| `node perf/bench.mjs --quick` | ≈1 min |
| `node perf/bench.mjs --profile` (full matrix) | 16 min |
| `node perf/quality.mjs capture <label>` (56 images) | 2.2-2.6 min |
| `node perf/quality.mjs compare baseline <label>` | ≈9 s |
| `npm run typecheck` / `npm test` | <1 s / ≈2.3 min |

## Tried / rejected ideas

(None yet. Format: round, idea, where, result numbers vs the noise floor, why rejected.)

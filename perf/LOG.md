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
| `perf/ab.sh` full matrix, 3 variants / 4 variants, 1 round | ≈30 / ≈40 min |

## Round 1 — wasted GPU work in the main pass, post chain and shadow pass

Commit `221ffb1` (on `c7a65d8`), 2026-10-18. Survey: four read-only Opus agents (main-pass shading, post chain,
Low, per-frame CPU); implementation: three agents on disjoint files; review: GPT-6.1-Sol (below).

**Round baseline.** HEAD had no `src/` change since `be47535`, so `baseline-1..3` stood in for `r1-pre`. But the
machine drifted during the round: the user's desktop Chrome was open on the GPU, and HEAD re-run on its own read
+5.3 % (low) and up to +16 % (ultra) frame mean vs the baseline at times. A plain full-matrix run vs the baseline
was therefore unreliable (the first full run of the exact set flagged REG on every preset; the HEAD re-run showed
the same drift). Verdicts in this round come from **per-cell interleaved A/B runs** (`perf/ab.sh`,
`perf/ab-agg.mjs`, new): every variant is built once, and for each map x preset cell all variants run back to back
(fresh browser each, `--no-trace`), so drift hits them alike. The metric is the geomean of the paired
variant/HEAD ratio over the 32 cell-scenarios. Run x5 used a balanced rotation and a second HEAD build as noise
control: **HEAD/HEAD differed by 1.2 % or less on every preset aggregate** (frame mean, median and p95; one
observation, not a measured noise floor). All runs:
`perf/results/r1-ab.md`. Fight state hashes are identical across all variants in every cell (`--no-trace` fights
end in other, equally fixed, states than traced ones: compare within a mode only).

### Result

| | low | medium | high | ultra | all |
|---|---|---|---|---|---|
| **paired vs HEAD, x5** (frame mean) | 1.703 → 1.658 ms (-2.6 %) | 2.732 → 2.304 (-15.7 %) | 3.501 → 2.988 (-14.7 %) | 4.625 → 3.924 (-15.1 %) | 2.946 → 2.587 (-12.2 %) |
| frame median | -3.4 % (-0.06 ms) | -14.2 % (-0.41) | -10.2 % (-0.36) | -18.0 % (-0.84) | -11.6 % (-0.35) |
| frame p95 | -2.1 % (-0.06 ms) | -11.0 % (-0.44) | -13.8 % (-0.68) | -11.2 % (-0.68) | -9.6 % (-0.42) |
| HEAD/HEAD noise, x5 (mean / med / p95) | -0.5 / -0.6 / +0.4 % | -0.9 / -1.2 / 0.0 % | +1.1 / +0.6 / +0.3 % | 0.0 / -0.3 / -0.2 % | -0.1 / -0.4 / +0.1 % |
| **`r1-post` vs baseline-1..3** (frame mean) | 1.615 → 1.662 (+2.9 %, noise) | 3.289 → 2.643 (-19.6 % IMP) | 3.911 → 3.246 (-17.0 % IMP) | 4.900 → 3.975 (-18.9 % IMP) | 3.170 → 2.744 (-13.4 % IMP) |
| frame median | 1.781 → 1.830 (+2.8 % REG*) | 3.217 → 2.807 (-12.7 % IMP) | 3.875 → 3.380 (-12.8 % IMP) | 4.815 → 3.923 (-18.5 % IMP) | 3.222 → 2.873 (-10.8 % IMP) |
| frame p95 | 2.847 → 2.992 (+5.1 %) | 4.957 → 4.178 (-15.7 % IMP) | 5.805 → 4.800 (-17.3 % IMP) | 6.885 → 5.572 (-19.1 % IMP) | 4.873 → 4.276 (-12.3 % IMP) |
| js mean (traced) | 0.636 → 0.571 (-10.3 %) | 1.380 → 1.073 (-22.2 % IMP) | 1.755 → 1.361 (-22.4 %) | 2.214 → 1.564 (-29.3 % IMP) | 1.360 → 1.069 (-21.4 % IMP) |

\* Low's REG vs the baseline is consistent with drift: HEAD alone read +2.4 % (median) / +5.3 % (mean) on Low vs
the baseline in this session. The paired measurements indicate a small Low gain: faster than HEAD in all 8 Low
cells (7 of 8 vs headB), -0.02 to -0.08 ms per cell, -2.6 % mean against a single HEAD/HEAD observation of
-0.5 %. That is not statistical proof, and it is below the 6.6 % full-matrix threshold: treat Low as "small gain,
not proven past noise". `r1-post` (traced, full matrix) is the next round's reference: `perf/results/r1-post.json`
(`node perf/table.mjs perf/results/r1-post.json`).

### Changes kept

Paired frame-mean deltas (mean / median / p95), from the A/B run named; each line is the change on top of the
variant in brackets. `js` is not measured by the A/B runs (`--no-trace`); the traced `r1-post` shows js -21 % overall.

| change | where | low | medium | high | ultra | pixels |
|---|---|---|---|---|---|---|
| **A1** clear the scene target inside `render` (autoClear), after the shadow maps, not before: no store + reload of the cleared target on a tiled GPU | `render/index.ts` frame render | -0.5 / +1.4 / -0.7 % (≈0 ms) | -5.6 / -5.5 / -10.0 % (-0.20 / -0.19 / -0.55 ms) | -4.2 / -2.9 / -2.9 % (-0.18 / -0.12 / -0.17) | -1.3 / -1.0 / -0.8 % (-0.08 / -0.05 / -0.07) | exact |
| **A2-A7** post targets [x4, vs HEAD]: Medium skips the unused MSAA depth resolve (`resolveDepthBuffer`); canvas `depth: false`; shaft targets RG16F; post scene matrices frozen; SMAA edges RG8; colour clear before passes that overwrite their whole target (`_fills`: no tile load) | `postfx.ts`, `render/index.ts` | -2.6 / -1.9 / -2.4 % (-0.04 / -0.03 / -0.07) | -10.9 / -5.6 / -8.8 % (-0.35 / -0.18 / -0.42) | -7.7 / -7.4 / -6.1 % (-0.29 / -0.27 / -0.32) | -2.0 / -3.1 / +4.0 % (-0.10 / -0.15 / +0.26) | exact |
| **B2 + B7 + C** [x4, vs HEAD]: dark cascade lights skip `RE_Direct` at compile time; skinned twin of the level depth material (no `getProgram` per skinned/static switch in a cascade); `syncModel` reads hit centres off the fresh matrices; empty instanced effect pools leave the draw list; fewer per-frame allocations in the effects step (same `rand` order) | `shadows.ts`, `materials.ts`, `operators.ts`, `enemies/model.ts`, `effects*.ts` | -1.1 / -0.5 / -1.1 % (-0.02 / -0.01 / -0.03) | -4.7 / -1.0 / -4.4 % (-0.15 / -0.03 / -0.21) | -2.9 / -2.8 / -0.4 % (-0.11 / -0.10 / -0.02) | -3.1 / -4.2 / -1.3 % (-0.15 / -0.21 / -0.08) | exact |
| **B3** packed ORM texture read once (`ORM_PACKED`, also in the program key) [x2, on the exact set] | `materials.ts` | +0.1 / +0.3 / 0.0 % | -2.6 / +0.1 / -0.4 % (-0.08 ms mean) | -1.5 / -2.8 / +1.5 % (-0.06) | -1.2 / -0.5 / +0.1 % (-0.06) | 1-3/255 on a few px |
| **B1** skip the FX point light while dark, and fragments outside its reach [x2, on exact set + B3] | `shadows.ts` | -0.5 / -0.3 / -1.3 % | -7.2 / -3.9 / -8.0 % (-0.22 / -0.12 / -0.38) | -1.9 / -0.3 / -3.9 % (-0.07 / -0.01 / -0.23) | -2.5 / -2.5 / -2.9 % (-0.13 / -0.13 / -0.20) | 1-3/255; 3 px ≤ 23 |

The parts overlap (ultra gains more from the whole set, -15.1 %, than from the parts' sum: the GPU bottleneck moves).
A1 + A2-A7 + B2 + B7 + C alone (the exact set, x2): low -3.0 %, medium -11.5 %, high -8.6 %, ultra -11.5 % mean.
Draw calls, triangles and program counts match the baseline in every cell (`r1-post`; mexico/ultra fight
triangle median 870636 is baseline-3's value, baselines 1-2 read 857525). Every traced fight hash matches the baseline.

### Quality gate

`node perf/quality.mjs compare baseline r1`: **PASS, 56/56, every SSIM 1.0000.** Low: 14/14 byte-identical. The
exact set alone (A1-A7, B2, B7, C) gave 56/56 byte-identical images (`scratch-e2`). B1 and B3 move **284 pixels in
total over the 42 realistic images** (~87 M px), 1-21 px per image, all by 1-3/255, except 3 adjacent pixels in
high/fight-mid (x 1360-1362, y 627: 10, 23 and 14/255). A 10x crop of base vs new there shows no visible
difference; it reads as one SMAA edge decision flipped by a 1-LSB input change. Cause: both changes are exact in
exact arithmetic (a SwiftShader float32 render was bit-identical for B3 and within 1 ulp for B1, from the reordered
branch), but Metal compiles with fast math, so any edit of shared shader text can reassociate float ops elsewhere.
Bisected per change on medium/ultra downtown+training (whole maps; see gotchas): A6, A1-A5, A7, B2, B7 and C are
byte-exact; B3 alone gives max 3/255, B1 alone max 2/255 (23 in the fight view).

### Review (GPT-6.1-Sol, high effort)

Round 1 (`perf-loop-r1-review-1`): no correctness bug found (autoClear restored in `finally`; C1 keeps the detached
fallback; `particle()` copies the scratch velocity at once; no hook overwrite, cache-key collision or new compile
path); B1/B3 diffs acceptable under the SSIM rule with this explanation; A1's clear colour hidden by the dome; A6
keeps the binary edges; A7's readers clamp. Findings, all on measurement, all addressed: (1) Low had no gain past its
noise floor → x5 paired Low result with a HEAD/HEAD control (above; still small and stated as such); (2) the A/B
order rotation was unbalanced (by name length) → `perf/ab.sh` uses a cyclic rotation over consecutive cells, x5
reran with it; (3) the old thresholds do not validate the new protocol → x5 measured the HEAD/HEAD noise of the
protocol (≤ 1.2 %); (4) the aggregator could drop cells silently → `perf/ab-agg.mjs` fails on any incomplete set
(x1-x5 all complete). Before the review, the B3 define was in the shader text only; it is now in the program key
(`ormKey`) so a material with separate AO/roughness maps can never share a packed program (no such material exists
today; no program count changed).

Round 2 (`perf-loop-r1-review-2`, on `c7a65d8..a821d82` with the findings and responses above): no new game-code,
quality or `Math.random` issue; the x5 numbers in this log match `r1-ab.md`; findings 1 and 3 now have supporting
evidence. New findings, all on the A/B harness and the wording, all fixed: the dirty guard missed staged/untracked
files and the reset restored the index, not HEAD (a later build could mix variants) → `perf/ab.sh` checks
`git status`, refuses patches outside `src/` and `tests/`, resets with `checkout HEAD` + `clean`; no cleanup on
failure or interrupt → a trap restores the tree and the original `out/`; a retry could reuse stale results → it
refuses an existing tag and exits non-zero on a failed cell; completeness was judged from the files found → a run
manifest, and `ab-agg.mjs` requires every expected file and checks each file's cells; the rotation is exactly
balanced only for some cell/round counts → documented; the Low conclusion was worded too certainly → reworded
above ("small gain, not proven past noise"). Runs x1-x5 used the earlier script (no manifest); their numbers stay
as recorded in `r1-ab.md`. The new rotation offsets by map + preset + round; use rounds = number of variants.

### Hot spot leads for later rounds (refreshed)

1. **Fight CPU submission** (lead 1, unchanged): per-figure material copies; share while the tint is black. New
   detail (B7 survey): gibs reuse the body's skinned material copy (`render/operators.ts:668`), so the main pass
   re-runs `getProgram` at every body/gib switch: give gibs their own non-skinned copy.
2. **Ray pre-reject** (lead 8): an exact union-of-hit-spheres bound per figure in `syncModel`, `ray.intersectSphere`
   before `updateWorldMatrix` + recursive intersect; mostly training (22-35 figures per frame, 0.2-0.5 ms).
3. **Shadow casters per cascade** (lead 2) and **hardware shadow compare** (lead 3): still open; render.shadows CPU
   0.8-1.2 ms on ultra fights. Low's shadow redraw is ~1.4 ms on its frames and mostly memory traffic, not
   triangles (17k): A1 did not move it.
4. **GTAO shader cost on ultra** (lead 5) and **one `render()` for the whole post chain** (`renderBufferDirect` per
   pass, keep `_pass`/`_antialias` hooks for the harness): 0.05-0.1 ms CPU.
5. **Allocation churn** (lead 9): `particle()` spec copies, `splice` in particle/pool/tracer/shell loops (swap-remove
   changes instance order: not exact), `_sprite` option objects.
6. Shader text edits that only branch at run time move LSBs on Metal (B1, B3, B4, B5, B6); compile-time removal
   (`#if`, B2) stayed exact. Prefer `#if`/defines, and expect to explain LSB diffs otherwise.
7. Small exact leftovers: hemisphere light at 0 with the sky in (`index.ts:795`), AO alpha write on low/medium
   (`postfx.ts:113-118`), `vMacroPos`/`vGridPos` duplicate varying.

### Gotchas (new)

- **Drift**: judge with `perf/ab.sh` (HEAD vs patches, with a `headB` control) when HEAD itself moves vs the
  baseline; report the official full matrix too.
- **Partial captures**: `quality.mjs capture --views a,b` changes the per-map view order and state, so its images
  are not comparable with a full set (training-overview read SSIM 0.995 with a pixel-exact change). Bisect with
  `--maps` (whole maps), never `--views`.
- `perf/ab.sh` resets `src/` and `tests/` between builds: it refuses to start on a dirty tree; save the round's
  diff as a patch first.

## Round 2 — CPU cost of figures in fights: shared materials, ray pre-reject

Commit `82ee6e1` (on `601916a`), 2026-10-18/19. Survey: four read-only Opus agents (per-figure materials, hit tests
and game logic, allocations/GC, render submission CPU); implementation: five Opus agents, each in its own git
worktree, one patch each (A, B, C1, C2, D); review: GPT-6.1-Sol (below).

**Round baseline.** `r2-pre` (HEAD `601916a`, traced full matrix, same `src/` as `r1-post`) read -3.5 % frame mean vs
`r1-post`: drift again. Then the laptop's battery drained to 7-8 % during the round (on AC, charging slower than the
load drew), and the machine slowed run by run: HEAD's suite frame mean in the A/B runs went 3.26 (s1) → 3.33 (s2)
→ 4.17 ms (s3), and switched power states within runs (s4). Verdicts therefore come only from the paired A/B runs
(`perf/ab.sh`, two HEAD builds as control); all runs, the per-scenario cpu tables and a control-filtered view:
`perf/results/r2-ab.md`.

### Result

| | low | medium | high | ultra | all |
|---|---|---|---|---|---|
| **s3: final vs HEAD, 3 balanced rounds** (frame mean) | 1.804 → 1.762 ms (-2.3 %) | 4.502 → 4.370 (-2.9 %) | 5.409 → 5.284 (-2.3 %) | 6.863 → 6.728 (-2.0 %) | 4.167 → 4.068 (-2.4 %) |
| s3 frame median | -2.2 % (-0.04 ms) | -1.4 % (-0.06) | -0.4 % (-0.02) | -1.6 % (-0.10) | -1.4 % (-0.06) |
| s3 frame p95 | -1.3 % (-0.04 ms) | -2.8 % (-0.23) | -4.2 % (-0.38) | -3.5 % (-0.36) | -3.0 % (-0.21) |
| s3 HEAD/HEAD (headB, mean / med / p95) | -0.5 / -0.5 / +0.2 % | -1.8 / -0.3 / -1.3 % | +0.2 / +0.5 / +0.8 % | -0.4 / -0.7 / 0.0 % | -0.6 / -0.3 / -0.1 % |
| **s4: independent repeat** (Round 1 code vs final, shown NEW/OLD; mean) | -0.5 % | -8.8 % * | -2.2 % | -1.8 % | -3.4 % |
| s4 HEAD/HEAD (headB, mean) | -1.1 % | +8.3 % * | +0.4 % | +0.9 % | +2.1 % |
| fight frames only, mean (s3 / s4) | -3.5 / -0.7 % | -5.0 / -10.1 % * | -4.6 / -4.3 % | -3.8 / -4.9 % | -4.2 / -5.1 % |
| fight callback cpu, mean (s3 / s4) | -4.7 / -1.9 % | -7.1 / -11.7 % * | -6.0 / -5.8 % | -4.6 / -7.0 % | -5.6 / -6.7 % |
| **training fight cpu** (s3 / s4) | | | | | **-14.4 / -13.4 %** |
| js, paired traced run t2 (fight cells, traced) | -1.5 % (-0.02 ms) | -6.8 % (-0.31) | -14.3 % (-0.76) | +17.1 % † | -2.0 % |
| js, training fight (t2) | 2.01 → 1.97 ms (-2.3 %) | 5.55 → 5.07 (-8.6 %) | 6.25 → 5.25 (-16.0 %) | 6.02 → 5.50 (-8.6 %) | |

\* s4's medium arm caught a power-state switch (headB/head +8.3 %): not usable alone. † t2 is one traced round in
the throttled state; ultra/house's HEAD arm ran in a fast spell (path 2.93 ms vs 5.2-5.7 ms in every other ultra
path), so its ultra row is not usable; the other three ultra cells' fights read js -1.7 % (downtown), +0.2 % (mexico), -8.6 % (training).

**Verdict.** The change targets fight CPU (figure submission and figure ray tests), and there it repeats in two
independent balanced runs: fight frames -4.2 / -5.1 %, fight callback cpu -5.6 / -6.7 %, training fights -14.4 / -13.4 %
(vs head; against headB the s4 fight numbers are smaller, frames -2.2 % and callback cpu -4.1 %: same direction, size
not pinned down).
On the whole suite (path + fight, frame mean) both runs read about -2 % (s3 -2.4 % vs head, -1.8 % vs headB; s4
-3.4 % vs head, -1.4 % vs headB; control-filtered -1.6 / -2.0 %). That is near the protocol's ~2 % paired noise, so
**the per-preset suite gain is measured but not proven past noise on every preset**; Low in particular is small
(-0.5 to -2.9 % depending on run and control). The unpaired traced benches `r2-post` (+43 % vs `r2-pre`) and
`r2-post-b` (+65 %) ran in the throttled state and say nothing about the patch (same-build drift of that size is
shown by HEAD's own A/B arm); they are committed only as the record. The next round should re-run `r2-post` on a
charged machine and use it as its reference. Calls, programs and fight state hashes match HEAD in every cell
(triangles differ by ≤ 1.1 % on 4 fight cells, the known figure-in-or-out noise; one call on downtown/high fight).

### Changes kept

Per-change paired frame mean / median / p95 (alone on HEAD, 2 rounds, near-balanced).

| change | where | low | medium | high | ultra | pixels |
|---|---|---|---|---|---|---|
| **A: shared figure materials** (s2, `a-mats2`). Enemy figures wear one shared twin per material while the hit tint is black, and swap to their own copies only while they flash; players keep their copies (own mark colour). Twins read maps and `aoMapIntensity` from the original through getters; twin ids rise in each kind's mesh order. Gibs get rigid (non-skinned) twins/copies: no `getProgram` at each body/gib switch. Main-pass material switches in fights: ~105 → ~7 + flashing figures. | `render/materials.ts` (`twinMaterial`, `sharedMaterial`, `quietly`), `render/figure.ts` (`rig.wear`, `setTint`), `render/operators.ts` | -0.7 / -1.8 / +0.5 % (-0.01 / -0.03 / +0.01 ms) | -3.5 / -4.1 / -4.9 % (-0.11 / -0.14 / -0.25) | -2.2 / -1.9 / -1.1 % (-0.09 / -0.08 / -0.07) | -1.5 / -1.4 / -1.5 % (-0.08 / -0.07 / -0.11) | exact |
| **B: figure ray pre-reject** (s1, `b-ray`). `syncModel` stores a world bound (union of the hit meshes' world spheres, +1e-6 margin) and a copy of the root matrix; `raycastFigure` returns the miss without the subtree matrix update when the root matrix is bit-equal and the ray misses the bound within `max`, and otherwise tests only the hit meshes (same layers/under-root checks, same stable sort). `syncModel` skips the operator armature (the render rewrites the bones before anything reads them). | `render/figure.ts` (`boundFigure`, `raycastFigure`), `enemies/model.ts`, `enemies/index.ts` | -0.8 / -0.4 / -0.8 % (-0.01 / -0.01 / -0.03) | -3.3 / -3.3 / -5.2 % (-0.11 / -0.11 / -0.26) | -1.2 / -0.4 / -1.4 % (-0.05 / -0.01 / -0.09) | -1.6 / -1.7 / -1.5 % (-0.08 / -0.09 / -0.11) | exact |

s1/s2 HEAD/HEAD (mean): s1 +1.0 / -0.5 / +0.6 / -0.9 %, s2 -0.1 / -0.6 / -1.2 / +2.1 % (low / medium / high / ultra).
B alone: training fight cpu -8.2 %; A alone: training fight cpu -8.5 %, fight frames -3.3 % overall.

### Quality gate

`node perf/quality.mjs compare baseline r2`: **PASS, 56/56.** The 42 realistic images with changed pixels are exactly
Round 1's (B1/B3 LSBs): `node perf/quality.mjs compare r1 r2` gives **56/56 byte-identical, 0 changed pixels**. Every
kept change is exact. Two of the first patches were not, for one shared reason (below): A's first version made
its twins inside the game step, and D's first version made a `ShaderMaterial` at boot; three's `Material`
constructor draws 4 `Math.random()` values for its uuid, so both moved the harness's seeded streams (A: the fight
sim diverged on realistic presets, score 1560 → 1440, and indoor spawn-in dashes moved ~200 px; D: Low's boot-time
random state, fight scorch shapes, 130-173 px). Fixed by `quietly()` (A: twins are made with a local mulberry32 so the
game stream is untouched; per-figure copies are still made at HEAD's points) and by dropping the extra material
(D). After the fix both were 56/56 byte-identical. Bisect per patch: B, C1, C2 byte-identical as first written.

### Review (GPT-6.1-Sol, high effort)

Round 1 (`perf-loop-r2-review-1`, on `601916a..82ee6e1`): no code correctness bug found — tint transitions, player
mark colours, AO updates, weapon swaps, LOD changes, detached flashing gibs and disposal checked for A; root/parent
moves, scale jumps, shields, layers, visibility, hit order, `max`, non-unit directions and corpses for B; no
stale-matrix reader of the skipped armature; `quietly()` restores `Math.random` in `finally` and nests; all s3 state
hashes and trails match; draw-order changes between figures produced no pixel change and transparent sorting does not
use material ids. One P2 finding (measurement): the per-preset gains sat near the ~2 % paired noise, against headB
only -1.2 to -2.5 %, and one run does not show repeatability → s4, an independent balanced repeat (above), and the
verdict worded as "measured, not proven past noise on every preset"; the fight-targeted gains repeat.
Round 2 (`perf-loop-r2-review-2`, on `82ee6e1..a5995f3` with the finding and the s4 response): no P1/P2; the round-1
finding is addressed as a stated limitation (stable-power validation still open); saved results, NOISE.md, the
rejected-idea numbers and the kept patches' hashes match the evidence; no new code issue. Two P3 number fixes (a
sign in the t2 ultra range; s4 values rounded from rounded ratios) applied, and the s4 fight gains vs headB added.

### Hot spot leads for later rounds (refreshed)

1. **Re-measure on a stable machine first** (battery charged, desktop Chrome closed): `r2-post` as the next reference.
2. **Shadow casters per cascade** (leads 2/3, still open; render.shadows CPU 0.8-1.2 ms on ultra fights). New, exact
   candidate from the B7 render survey: one shadow draw per operator per cascade by swapping each worn figure's first
   skinned mesh to a merged shadow geometry (same program, bones and triangle order) on shadow frames, and hiding the
   others' `castShadow` (`operators.ts:601-613`, wrapper `render/index.ts:452-474`); check GLB attribute layouts
   (meshopt interleaving) first. Expected 0.15-0.35 ms js on ultra training fights.
3. **Post chain in one `render()`** (D): exact (byte-identical, same programs/calls) but -0.9 % suite / -0.2 % ultra,
   inside noise; patch `perf/patches/r2-d-post2.patch` (on `601916a`). Retry only together with other ultra CPU work.
4. **Allocation churn** (C1/C2): exact patches in `perf/patches/r2-c1-nav.patch`, `r2-c2-fx.patch` (on `601916a`), no frame-time or sampled heap-peak effect (heap peaks are
   GC-timing noise ±5-18 % per run). Not a frame-time lead any more; maybe for long-session GC pauses (p99).
5. Training fights are now ~13 % cheaper in CPU; the remaining training cost is submission of 22-35 figures × ~13
   flat meshes on Low (300+ calls) and LOD0 operators in 3 cascades on ultra (lead 11).
6. Small exact leftovers: view-model `depthRange` per mesh (`render/index.ts:440-447`, set once per run), hemisphere
   light at 0 with the sky in, AO alpha write on low/medium, `vMacroPos`/`vGridPos`.

### Gotchas (new)

- **Every new three object draws `Math.random`**: `Material`, `Texture`, `BufferGeometry`, `Object3D` and
  `RenderTarget` constructors call `MathUtils.generateUUID()` (4 draws). Creating one more or one fewer of them at boot
  or in a step moves the harness's seeded streams (fight hash, boot-time randomness), even in render-only code. Create
  them where HEAD did, or under `quietly()` (`render/materials.ts`).
- **Battery / power state**: on battery, or with the battery near empty even on AC, the M4 Pro slows run by run and
  switches state mid-run (HEAD 3.3 → 4.2 ms; HEAD/HEAD up to +8 % on one preset). Check `pmset -g batt` before a
  round; the paired A/B survives a slow drift but not a switch inside a cell's variant set.
- **Agent worktrees** (Agent `isolation: worktree`) may start on `main`'s commit, not HEAD: check `git rev-parse HEAD`
  and reset to the round's HEAD before editing.

## Round 3 — shadows (incomplete: measurement stopped by the power state)

2026-10-19, on `7a3ceef`. Survey: five read-only Opus agents (merged operator shadows, static level casters, shadow
sampling, Low end to end, non-shadow wins); implementation: four Opus agents, each in its own worktree, one patch per
change. **No game change is kept this round**: no patch beat the paired noise in a valid run, and the round's last
A/B run is void because the laptop left AC and drained to 1 % during it. HEAD's `src/` is unchanged.

**Machine state.** All `pmset -g batt` / `-g therm` readings: `perf/results/r3-ab.md`. Start: AC, battery 10-11 %,
desktop Chrome open (idle), no thermal or performance warning recorded at any point. The battery fell to 7 % during
`r3-pre` while on AC and stayed there through s1 and s2; during s3 the machine went to **battery power, 1 %, "Battery
Warning: Final"**. `r3-pre` (traced full matrix of HEAD `7a3ceef`, same `src/` as `r2-post`) reads **+19.4 % frame
mean vs `r2-pre`** (low +1.4 %, medium +23.9 %, high +20.3 %, ultra +34.4 %): throttled; it is in the log only.
`perf/results/r3-pre.json`.

### Harness (kept, commit `2b45537`)

`--profile` ablations now record the **mean** next to the median, and every scenario records `frameParity` /
`cpuParity` (mean of even vs odd intervals/callbacks; `facts.shadowEvery`). Reason (Low survey): the old ablation took
the median of a bimodal distribution, so Low's "shadow 0.8-1.4 ms averaged, 1.6-2.8 ms per redraw" (Round 0) was a
median jump; Medium and High show the same bimodal frame times while redrawing every frame. **Measured with the new
fields (s1, 16 Low runs per variant): Low's shadow callbacks cost ~0.3 ms more than the others** (path cpu odd/even
1.70 / 1.38 ms, fight 1.40 / 1.17 ms). Lead 7 is therefore about 0.15 ms averaged, not 0.8-1.4 ms.

### A/B protocol finding: run position

`perf/ab-posfit.mjs <tag> [mean|med|p95|cpu] [path|fight|both]` (new) fits log(frame) = cell-scenario-round + variant
+ run position by least squares. In s2 the frame time rose with the run's position inside a cell's set of 7 runs:
on medium, position 0 read -3.6 % and position 6 +2.3 % against the set's geomean. With cyclic rotation `headB`
always runs next to `head`, so the control is blind to that ramp, and with rounds < variants the variants are
confounded with positions (s2 medium: every patch +3-10 %, including `d`, which does not change Medium's shader at
all). Use rounds = number of variants (exact balance), list `headB` away from `head` in the variant list, and read
`ab-posfit` next to `ab-agg`.

### Patches (all in `perf/patches/`, on `7a3ceef`)

| patch | what | pixels (vs r2 capture) | paired result |
|---|---|---|---|
| `r3-a-opshadow` | one shadow draw per worn two-mesh operator per cascade: per kind a merged geometry (raw int16/uint8 arrays of both parts, u16 index, made under `quietly()`), swapped onto mesh 0 around the shadow pass while mesh 1 stops casting (`operators.ts` `shadowSwap`, `render/index.ts` wrapper) | 56/56 byte-identical | calls -16 % in training fights (ultra 367 → 308, high 313 → 271); frame mean s2 (order-corrected) high -0.5 %, ultra -0.2 %, medium void; training fight cpu high -9.2 %, ultra -1.5 % (headB up to ±7 % on training) — **not proven** |
| `r3-d-vm` | view-model (`GRID_VIEW_MODEL`) and backdrop (`BACKDROP`, new define on the kit's `\|far` materials) programs skip the cascade loop at compile time (receiveShadow is false on them, so the result was always 1.0) | 56/56 byte-identical | s2 high -1.4 % mean / -2.2 % median, ultra -0.1 / -0.7 % — **not proven** |
| `r3-g-ndotl` | skip shadow taps where N·L ≤ 0 (run-time branch; TOON/clearcoat excluded); High/Ultra cascade loop and three's Low/Medium ternary | 10 of 56 images, 1-3/255 on a few px, high/fight-mid one spot 23/255 (same class as R1 B1) | s1 low -0.4 %; s2 high -2.1 % mean / -2.2 % median, ultra -1.5 / -2.1 % — borderline, **not proven** |
| `r3-dg-both` | d + g together (they conflict textually) | — | not run |
| `r3-b-bones` | bone textures uploaded before the first shadow pass (`OperatorSkeleton` holds its update until released; three r170 updates skeletons again in the first cascade because the frame counter steps between listing and the shadow pass) | 56/56 byte-identical | s2 all +3.0 %, high -0.1 %, ultra +0.3 % → **rejected** |
| `r3-c-matrix` | rig `updateWorldMatrix(true,false)` instead of a full rig walk; `#reach` without the armature subtree update; precomputed rotor signs and arm bone indices | 56/56 byte-identical (bit-equal node transforms in a 1326-reach vitest) | s2 high +0.3 %, ultra -0.2 % → **rejected** |
| `r3-e-low2` | Low's shadow map double-buffered (spare target under `quietly()`) | 56/56 byte-identical | s1 low +1.0 % mean (headB +0.3 %); parity gap unchanged → **rejected** |

### Next steps for this round (or Round 4)

Re-run on AC with a charged battery: `perf/ab.sh <tag> medium,high,ultra downtown,house,mexico,training 4 head
perf/patches/r3-a-opshadow.patch headB perf/patches/r3-dg-both.patch` (4 variants, 4 rounds, ≈1.7 h: over the tool's
2 h limit with more variants), plus a traced paired run of the training/mexico fights for `a`'s js. Keep `a` and `d`
if they show any gain past headB (both exact); `g` only if it beats ~2 % on high/ultra (it moves LSBs). Review by
GPT-6.1-Sol has not run on this round's patches (nothing kept).

### Hot spot leads (refreshed)

1. **Shadow-map memory traffic, not triangles**: each cascade clears and stores a 2048² RGBA8 colour + depth target
   (≈50-100 MB per ultra frame); level triangles are 1-31k per map and props are already in 32 m cells. A depth-only
   map with hardware compare (`sampler2DShadow`, 9 bilinear taps = the PCFSoft weights) removes the colour store and
   7 of 16 taps, but filter weights quantise to 8 bits on the GPU (≤1/512 per penumbra pixel, thousands of pixels)
   and rasteriser vs packed depth flips contact-line taps: not exact. Measure its ceiling first (a throwaway
   `getShadow` → 1.0 variant, and a "clear+store only, no casters" ablation).
2. **Static caster culling per cascade** by index ranges inside the merged level/prop geometries (exact, no new
   objects): survey estimate only 0.02-0.06 ms GPU on ultra: bundle only with other shadow work.
3. **Low**: its shadow redraw is ~0.3 ms per draw frame (measured above); the bimodal frame time is presentation, not
   the shadow map. Low's remaining structural lever is fewer figure draws (merging same-joint parts: not exact).
4. Fight CPU: training fights are draw-bound in submission; `a` cuts 40-60 calls per frame there (needs a clean run).

## Tried / rejected ideas

Format: round, idea, where, result numbers vs the noise floor, why rejected.

- **r1, A8: invalidate depth nobody reads** (`gl.invalidateFramebuffer` on each shadow map's depth renderbuffer after
  it is drawn, and on Low's scene-target depth after the main render; `render/index.ts` shadow wrapper). Exact.
  Paired x1 on top of the exact set: low +0.4 %, medium -1.1 %, high -0.6 %, ultra -1.4 % frame mean (all -0.7 %),
  inside the protocol's ±1.2 % noise; an earlier non-interleaved ultra run even read it as slower. ANGLE Metal likely
  ends the pass's store anyway. Rejected (could be retried alone on ultra with `perf/ab.sh`, 2+ rounds).
- **r1, B4: skip the fog tint where fog is 0** (`atmosphere.ts` fog chunk, `if (f > 0.0) mix(...)`). Exact in
  arithmetic, but with B5 it moved 1/255 on a few pixels in 2 of 16 images (Metal fast math). Gain ~20 ALU per
  fragment, not measurable alone. Rejected for pixels.
- **r1, B5: skip the macro noise where `macro` is 0** (glass, water; `materials.ts`). Same as B4 (tested together).
  Rejected for pixels.
- **r1, B6: share per-axis hash work in the macro noise** (`materials.ts` `macroNoise`/`macroHash`). Bit-exact on
  SwiftShader; depends on B5; part of the first full set that moved pixels. Rejected for pixels (Metal fast math).
  Not tried alone.
- **r1, SMAA weights target RGBA8** (reference SMAA's format). Not exact by analysis (continuous weights, gamma
  blend: 1-2 LSB on edges). Not tried.
- **r1, SMAA stencil early-out.** ≈0.03 ms at best, needs a shared depth-stencil; not tried.
- **r1, `matrixAutoUpdate = false` on static level/props.** `Scene.matrixAutoUpdate` forces the walk anyway and the
  level is a few merged meshes: < 0.03 ms by analysis. Not tried.
- **r1, skip Low's shadow redraw when the snapped box did not move.** Never triggers in the bench (the path moves
  ~20 texels between redraws; figures move in fights). Not tried.
- **r2, C1: allocation-free A\*, boolean world rays, hoisted separation set** (`nav.ts` typed-array open heap with the
  same sift and tie rules, `physics.ts` `rayBlocked` for the probes that only test truthiness, `enemies/index.ts`
  `RANGED`/`REFLECTABLE` sets). Byte-identical, same paths (a reference test compared 1,000+ searches bit for bit).
  Paired s1 (2 rounds): frame mean low -0.1 %, medium -3.2 %, high +0.7 %, ultra -0.7 % (all -0.8 %, headB +0.1 %);
  fight cpu all -1.7 %; sampled fight heap peak +0.5 %. Inside noise (medium moved for every variant in s1). Rejected.
- **r2, C2: effects record pooling and ranged instance uploads** (`effects.ts`/`effects-real.ts`: particle,
  shell, tracer, blood-record free lists, stable compaction instead of `splice`, scratch spawn vectors with the same
  `rand` draws, uploads limited to drawn/written slots). Byte-identical (a frame-by-frame equivalence test of all
  particle/instance state and GPU contents). Paired s1: low +0.6 %, medium -3.0 %, high +1.3 %, ultra -0.7 % (all
  -0.4 %); fight cpu all -1.0 %; heap peak -1.5 %. Inside noise. Rejected; the patch's equivalence test approach is
  reusable.
- **r2, D: the post chain in one `render()`** (`postfx.ts`: one render of the post scene with the chain run from
  `onAfterRender` via `renderBufferDirect`; Low and the harness's out-of-chain `_pass` keep the old path) **plus shadow
  wrapper array reuse** (`render/index.ts`). Byte-identical, same calls/programs (after removing an extra
  `ShaderMaterial` that drew 4 `Math.random` values at boot). Paired s2: low -0.2 %, medium -2.1 %, high -1.2 %,
  ultra -0.2 % (all -0.9 %; headB ultra +2.1 %); path cpu all -1.1 %. Inside noise. Rejected.
- **r2, not tried**: hiding non-caster figure subtrees during the shadow pass (could not prove no layer-0 caster sits
  under them); swap-remove in effect pools (changes instance order); `forceSinglePass` on the sword trail, slash wave
  and hazard ring (changes blending order); disabling `sortObjects` (depth-tie order).
- **r3, b-bones: bone textures uploaded before the first shadow pass** (`operators.ts` `OperatorSkeleton`,
  `render/index.ts` wrapper). Byte-identical. Paired s2 (order-corrected, 2 rounds): frame mean all +3.0 %, high
  -0.1 %, ultra +0.3 % (medium void). No gain; it also updates/uploads skeletons culled from every pass. Rejected;
  patch `perf/patches/r3-b-bones.patch`.
- **r3, c-matrix: duplicate rig/armature matrix walks and per-bone string tests** (`render/index.ts`,
  `operators.ts`, `enemies/model.ts`). Byte-identical. Paired s2: high +0.3 %, ultra -0.2 % frame mean; training fight
  cpu within the control's spread. Rejected (not measured with traces: js could still show it); patch
  `perf/patches/r3-c-matrix.patch`.
- **r3, e-low2: Low's shadow map double-buffered** (no write-after-read between frames). Byte-identical. Paired s1
  (4 rounds, balanced): low +1.0 % mean / +1.7 % median (headB +0.3 / +0.7 %); the odd/even frame gap is unchanged.
  Rejected; patch `perf/patches/r3-e-low2.patch` (+32 MB GPU memory).
- **r3, not tried (by analysis)**: caching static shadow casters per cascade (the boxes move every frame in the bench;
  a colour+depth copy costs more than redrawing); a lower-LOD operator in the wide cascades (silhouette error ≈ a
  texel, flips penumbra texels: visible in blend zones); splitting Low's redraw over two frames (half the casters a
  frame stale: visible); front-to-back caster sorting (Apple's hidden-surface removal makes order irrelevant).

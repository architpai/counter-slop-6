# perf/ — benchmark and quality gate

The shared harness of the performance loop. Read `perf/LOG.md` first: its rules bind every round.

Everything runs on the production build: `next build` with `output: 'export'` writes `out/`, which `perf/serve.mjs`
serves on `http://127.0.0.1:4173/` (`next start` refuses an export). The scripts start that server themselves.
Chrome is Playwright's headless chromium, ANGLE Metal, vsync and the frame-rate limit off, 1920x1080 at DPR 1.

Never run two of these at once, and never while something else heavy runs (a build, `npm test`, another agent's
bench or capture): the timings must be clean.

## Commands

```sh
# 1. Build (≈5 s). Every bench/capture reads out/, so rebuild after every source change.
npm run build

# 2. Benchmark: all 4 maps x 4 presets, path + fight scenarios, ≈13 min. Label rounds rN-<what>; iteration runs
#    scratch-<what> (gitignored).
node perf/bench.mjs --label r3-shadows
#   --maps downtown,house  --presets high,ultra  --repeat N  --frames 900
#   --quick         downtown, low + ultra, 300 frames (≈1 min): a smoke test, not a verdict
#   --no-trace      skip the traced replays (≈1/3 faster, no js/wait columns)
#   --profile       separate run: CPU ms per sub-step and per-pass GPU cost by ablation (not comparable to bench runs)
#   --build         run `npm run build` first
# Writes perf/results/<label>.json and prints a markdown table.

# 3. Compare against the baseline (median of its 3 runs) or the previous round, flagged against the noise floor
#    (perf/noise.json). The suite aggregates (geomean per preset) print first: they carry the verdict.
node perf/compare.mjs perf/results/baseline-1.json,perf/results/baseline-2.json,perf/results/baseline-3.json perf/results/r3-shadows.json
#   --all to print every row, not only flagged ones

# 4. Quality capture: 14 views x 4 presets = 56 PNGs, ≈2.5 min.
node perf/quality.mjs capture r3-shadows
#   --presets ultra  --maps downtown  --views fight-mid,downtown-fp   (partial sets for iteration)

# 5. Quality compare: SSIM per image, fails any below 0.995; heat maps and base|new|diff side-by-sides in
#    perf/shots/<label>/_diff/. Exit code 1 on failure.
node perf/quality.mjs compare baseline r3-shadows

# Noise floor (only when the machine, Chrome or the harness changes): N repeated runs of one tree.
node perf/noise.mjs perf/results/baseline-1.json perf/results/baseline-2.json perf/results/baseline-3.json

# Median table of several runs (the LOG.md baseline table).
node perf/table.mjs perf/results/baseline-1.json perf/results/baseline-2.json perf/results/baseline-3.json

# Self-test of the PNG codec and SSIM.
node perf/image.mjs --selftest
```

A round's change counts only if `compare` flags it **IMP** beyond the noise floor (see `NOISE.md`) on the cells it
targets, flags no **REG** elsewhere, and `quality.mjs compare baseline <label>` passes. Then `npm run typecheck` and
`npm test` (≈2.5 min) before the commit.

## Files

| file | what |
|---|---|
| `serve.mjs` | static server for `out/` (no deps) |
| `lib.mjs` | shared harness: launch, page setup, preset in `cs6_gfx`, virtual rAF clock (1/60 s steps), seeded `Math.random` streams, readiness wait, map entry and cleanup, path and fight scripts, Chrome trace digest |
| `bench.mjs` | the benchmark |
| `metrics.mjs` | the metrics compare/noise read, and the `noise.json` format |
| `compare.mjs` | per cell deltas vs the noise floor |
| `noise.mjs` | noise floor from repeated runs → `noise.json` (per cell, and the suite aggregates) |
| `table.mjs` | median table of several bench results |
| `quality.mjs` | screenshot capture and SSIM gate |
| `image.mjs` | PNG decode/encode (node:zlib), SSIM, diff heat maps |
| `results/` | bench JSONs (≈185 kB, committed; `scratch-*` and `*-raw*` ignored); `baseline-1..3` are the reference, `baseline-profile` the profile |
| `shots/` | screenshot sets (gitignored, ≈100 MB per label); `shots/baseline` is the reference |
| `NOISE.md` | the noise floor and what beats it |
| `LOG.md` | the round log, rules, hot spots, tried/rejected ideas |

## Reading the numbers

- `frame` is the real rAF-to-rAF interval, uncapped: the headline. On realistic presets the frame is GPU-bound.
- `cpu` is wall time in the game's rAF callback (update + render submission). It **includes** waits on the GPU command
  buffer (`CommandBufferProxyImpl::WaitForGetOffset`), so on realistic presets it tracks the GPU, not JS.
- `js` (in brackets) is the main thread's real CPU time per frame from a Chrome trace of a replay of the same scenario:
  the number for CPU-side work (update, culling, uniforms, allocations).
- `gpu` is null: `EXT_disjoint_timer_query_webgl2` exists on ANGLE Metal but returns 2-3x the frame interval even when
  GPU-bound (calibrated in every cell; see `meta.timerNote`). If a future Chrome fixes it, it fills in automatically.
- Per-pass GPU cost comes from `--profile` by ablation: skip one pass, read the drop in frame time.
- Low's frame time is mostly browser presentation overhead (bimodal 0.3-2.3 ms); judge Low on `js` and p95.
- Timers are 0.1 ms-coarse (page not cross-origin isolated); `compare` also checks `frame mean`.
- `calls`/`tris` are per-frame `renderer.info` with `autoReset` off (three resets it per `render` call otherwise).

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
#   --scenarios fight   only these scenarios (comma list; default path,fight); warm-up, idle and calibration as always
#   --load-only     per cell and repeat only the cold load + readiness wait (fresh browser, ≈1-10 s), then close:
#                   load times and load.phases, no scenarios (e.g. --load-only --repeat 3)
# Writes perf/results/<label>.json and prints a markdown table. Every cell's load.phases (both modes) has when each
# readiness flag went busy/done, the upload back-off changes, the match start, the quiet start's end, and the load
# window (match start to ready: frames, longest, >33/>50 ms, skipped). Traced scenarios add trace.gc (MinorGC/MajorGC).

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

## Interleaved A/B (when the machine drifts)

If HEAD itself moves against the baseline (desktop apps on the GPU, clock states), compare variants **paired, per
cell**: every variant is built once into `$AB_WORK` (`/tmp/perf-ab`), then for each map x preset cell all variants
run back to back (fresh browser each, `--no-trace`). Two HEAD builds give the protocol's own noise (Round 1: HEAD/HEAD
within 1.2 % on every preset aggregate).

The run order rotates cyclically, shifted by map, preset and round. Each variant takes each position equally often in
every map x preset cell only when `rounds` is a multiple of the number of variants, and per preset when `rounds` or
the number of maps is. Otherwise the positions are only near-balanced: for exact balance, set `rounds` to the number
of variants (or a multiple of it).

```sh
# A patch may touch only src/ and tests/. ab.sh resets both to HEAD between builds, so it refuses to start with any
# change there (staged, unstaged or untracked). Take the change out as a patch (new files included), then stash it.
git add -A src tests && git diff --cached --binary -- src tests > /tmp/round.patch && git stash
perf/ab.sh x1 low,medium,high,ultra downtown,house,mexico,training 3 head headB /tmp/round.patch   # ≈1.5 h
node perf/ab-agg.mjs x1   # paired geomean ratio vs head per preset (mean, median, p95)
git stash pop
# AB_ARGS adds bench.mjs arguments to every run (recorded in the manifest as `args`):
AB_ARGS="--load-only --repeat 3" perf/ab.sh l1 low,high downtown,training 2 head headB /tmp/round.patch
node perf/ab-load.mjs l1  # readyMs/firstPlayableMs geomean and paired ratio vs head, phase deltas, load-window frames
AB_ARGS="--scenarios fight" perf/ab.sh f1 ...   # fight CPU only; ab-agg and ab-posfit read only the scenarios run
```

ab.sh first checks every patch (`git apply --check`, paths only in src/ and tests/) and refuses a tag whose
`perf/results/scratch-<tag>-*` files already exist. It writes `scratch-<tag>-manifest.json` (HEAD, variants, the
patch paths and SHA-256, maps, presets, rounds, date), then one `scratch-<tag>-<variant>-<map>-<preset>-<round>.json`
per run (all gitignored). On any exit (done, error, ^C) it resets src/ and tests/ to HEAD and moves the original
`out/` back from `$AB_WORK/out-orig`. A failed run's JSON is removed; the script lists the failed cells and exits 1.
`ab-agg` reads the manifest and fails unless every result exists and holds its own map and preset. One variant must
be named `head`: the ratios pair each variant with it. Put the `ab-agg` output in the round's notes
(`perf/results/rN-ab.md`). `node perf/ab-posfit.mjs <tag> [mean|med|p95|cpu] [path|fight|both] [--partial]` is a
diagnostic: a least-squares fit per preset row with run-position effects shared by its cells (the `all` row shares
one set across presets; positions from the rotation, no uncertainty);
`--partial` drops incomplete map x preset x rounds instead of failing. `--no-trace` fights end in other fixed states
than traced ones: compare within a mode.

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
| `ab.sh`, `ab-agg.mjs` | per-cell interleaved A/B of patches vs HEAD, and its paired aggregate |
| `ab-load.mjs` | load times of an A/B run (best with `AB_ARGS="--load-only --repeat N"`): paired ratios, phase deltas, load-window frames |
| `ab-posfit.mjs` | diagnostic fit of an A/B run: variant effects corrected for run position |
| `ab-pair.mjs` | any two variants of an A/B run against each other (geomean/median paired ratio, slower count), with the headB/head control |
| `hitch.mjs` | programs linked after ready (`find`, `sweep` with `--check zero` / `--expect`), first-fight hitch (`measure`), per-frame load timeline with warm-up/slot/sky-step collisions (`load`) |
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

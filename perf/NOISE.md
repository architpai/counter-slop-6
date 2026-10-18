# Noise floor

Measured 2026-10-18 on the M4 Pro (macOS, headless chromium 153.0.8010.12, ANGLE Metal), commit `be47535`.
Three full baseline runs of the same build, one after another, nothing else running:
`perf/results/baseline-1.json`, `baseline-2.json`, `baseline-3.json` (12.4, 13.4, 12.9 min). `perf/noise.json` is
written from them by `node perf/noise.mjs perf/results/baseline-{1,2,3}.json`. Re-measure it when the machine,
Chrome, or the harness (frame counts, scenarios) changes.

## What repeats exactly

- **The simulation.** Every fight ends with the same state hash in all three runs on every cell (kills, score, alive
  enemies, gibs, pickups, random-draw count). Per-frame state hashes match too.
- **Draw calls**: spread 0-0.3 % (one call in a few fight cells). **Triangles**: 0 % on 30 of 32 cells, up to 1.5 % on
  fights (a figure drawn or not for a few frames). Any change past that is the code's.
- **Screenshots** (`perf/quality.mjs`): three captures of one build were **byte-identical**: all 56 images SSIM
  1.0000, every tile 1.0000, 0 changed pixels. There is no natural floor: the gate's 0.995 is pure margin. Any SSIM
  under 1.0 is a real pixel change and should be explained, even when it passes.

## What does not: frame times

Per cell (one map x preset x scenario, 900 frames), the run-to-run spread (max - min over median) is large:

| metric | median cell spread | worst cell |
|---|---|---|
| frame median | 5.7 % | 26.7 % (training/high/path: 2.9, 3.7, 3.0 ms) |
| frame mean | 7.3 % | 26.3 % (training/high/path) |
| frame p95 | 12.8 % | 46.2 % (mexico/low/path) |
| cpu median (callback wall, GPU waits included) | 7.4 % | 29.2 % |
| js median (traced main-thread CPU) | 18.7 % | 74.7 % (house/high/path: 1.03, 0.52, 0.69 ms) |
| readyMs (cold load) | 5.6 % | 25.3 % |

Likely causes: GPU clock states (the frame is 2-6 ms, so the GPU idles between frames), the browser's presentation
path (Low's frame is mostly that: bimodal 0.3-2.3 ms), 0.1 ms timer steps, and the trace sampling window for `js`.
So **a single cell is a weak judge**: its per-cell threshold in `noise.json` (2 x spread, floor 3 % / 0.1 ms) has a
median of 14 % for frame mean.

## The suite aggregates: the verdict

The geometric mean of a metric over every map x scenario of a preset (8 cells), and over all 32 cells, is far
steadier. `compare.mjs` prints these first, against `noise.json`'s `aggregate` thresholds = max(2 x spread, 2 %):

| group | frame mean (spread → threshold) | frame med | frame p95 | cpu mean | js mean |
|---|---|---|---|---|---|
| all | 1.5 % → **3.1 %** | 1.4 % → 2.8 % | 4.2 % → 8.4 % | 2.8 % → 5.7 % | 4.7 % → 9.3 % |
| low | 3.3 % → **6.6 %** | 1.2 % → 2.3 % | 6.8 % → 13.7 % | 3.8 % → 7.7 % | 9.9 % → 19.7 % |
| medium | 0.6 % → **2.0 %** | 0.3 % → 2.0 % | 1.8 % → 3.5 % | 3.0 % → 5.9 % | 1.6 % → 3.2 % |
| high | 2.2 % → **4.5 %** | 3.6 % → 7.3 % | 2.4 % → 4.8 % | 3.8 % → 7.6 % | 20.8 % → 41.6 % |
| ultra | 0.9 % → **2.0 %** | 1.2 % → 2.4 % | 5.7 % → 11.5 % | 1.3 % → 2.6 % | 9.3 % → 18.7 % |

Baseline aggregates (median of the 3 runs), frame mean: all 3.170 ms, low 1.615, medium 3.289, high 3.911,
ultra 4.900.

## The rule a change must beat

A change counts as a real gain only if **all** of these hold:

1. A full-matrix bench (`node perf/bench.mjs --label rN-...`, all maps and presets, default frames) compared with
   `node perf/compare.mjs perf/results/baseline-1.json,perf/results/baseline-2.json,perf/results/baseline-3.json perf/results/rN-....json`
   shows **IMP** on the suite aggregate it targets: frame mean (or frame median) of the preset group(s) it is
   meant to speed up, beyond the threshold above, i.e. at least **2 %** on medium/ultra, **4.5 %** on high,
   **6.6 %** on low frame mean (2.3 % on low frame median), **3.1 %** on all. For CPU-side work, `js mean` beyond its
   threshold (medium 3.2 %, all 9.3 %), or on the fight cells it targets.
2. No suite aggregate shows **REG**.
3. Where a change targets particular cells (one map, the fight), those cells should move the same way; per-cell flags
   alone (median threshold 14 %) are supporting evidence, not a verdict.
4. If the gain is near the threshold, re-run the bench (`--label rN-...-b`) and require both runs to show it; a
   second run costs 13 min and is cheaper than logging a false win.
5. Counts (calls, triangles, programs) are exact: a change meant to cut them must show it in every targeted cell,
   and an unintended change in them is a regression to explain.

Compare against the three baselines' median (comma-separated base list, as above), or against the previous round's
committed result when stacking rounds. Partial matrices (`--maps`/`--presets`) are fine for iteration, but their
aggregates cover fewer cells and are noisier than the thresholds assume; the verdict needs the full matrix.

## Paired A/B noise (Round 1)

On 2026-10-18 evening the machine read HEAD up to +5 % (low) and +16 % (ultra) slower than the baseline above
(desktop Chrome open on the GPU), so full-matrix runs against the baseline flagged changes as regressions that were
drift. `perf/ab.sh` runs variants back to back per cell instead; with two HEAD builds in one balanced run (x5,
`perf/results/r1-ab.md`) the paired geomean ratio HEAD/HEAD was within **1.2 %** on every preset aggregate (frame
mean, median and p95; Low -0.5 / -0.6 / +0.4 %). That is one observation, not a noise floor: treat a paired change under about
2 % as unproven, and repeat the run (or add rounds) near that line; measure HEAD/HEAD over several runs when a
round's verdict hangs on it.

## Paired A/B noise (Round 2)

Four more paired runs (`perf/results/r2-ab.md`). HEAD/HEAD on the suite frame mean: s1 +0.1 %, s2 +0.1 %, s3 -0.6 %
(presets within ±1.8 %), s4 +2.1 % with **+8.3 % on medium**: the battery was at 7-8 % (on AC) and the machine
switched power states mid-run, sometimes between two variants of one cell. A slow drift cancels in the pairing; a
switch does not. Check `pmset -g batt` (and close desktop GPU apps) before a run; when headB/head moves past ~2 % on a
preset, that preset's verdict needs another run. `r2-ab.md` also shows a control-filtered view (only cell triplets
where headB/head is within 3 %).

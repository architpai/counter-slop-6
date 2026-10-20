# Performance loop — summary of Rounds 0-10

Source for the executive summary. Every number below comes from `perf/LOG.md`, the A/B notes
(`perf/results/rN-ab.md`) and the result files named; nothing is estimated here. Machine: Apple M4 Pro laptop,
Playwright headless chromium 153 on ANGLE Metal, 1920x1080, DPR 1, vsync and frame cap off, production build.

## 1. Cumulative result: Round 0 → final (Round 10's final verification)

One paired, interleaved A/B of the **final tree** (`head`, commit `eb2e359`) against the **Round 0 game tree**
(`r0`: `src/` and `tests/` of `c7a65d8`, built from the reverse diff, everything else as final; the only non-perf
difference outside `src/`/`tests/` is one doc line), with a second copy of the final tree (`headB`) as the HEAD/HEAD
noise control. Path and fight scenarios, all 4 maps (as Round 0), all 4 presets, `--no-trace`. Split by map into four
`ab.sh` runs (`r10b-downtown`, `-house`, `-mexico`, `-training`) because the 30 W charger could not hold a longer job;
each run has rounds = variants = 3, so every cell gives each variant each run position once. Change = final / Round 0
- 1 (negative = faster), geomean of the paired per cell-scenario-round ratios
(`node perf/ab-final.mjs r0 r10b-downtown,r10b-house,r10b-mexico,r10b-training`). The raw per-run JSONs are
gitignored (`scratch-*`); the printed tables are in `perf/results/r10-ab.md`.

**Path + fight, frame ms (Round 0 → final) and change.** n = paired cell-scenario-rounds; "FINAL faster" counts the pairs
where the final tree's frame mean is lower; control = headB / head - 1 (mean / median / p95 / p99).

| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 24 | 1.658 → 1.568 (-5.4 %) | 1.722 → 1.655 (-3.9 %) | 2.965 → 2.829 (-4.6 %) | 4.213 → 3.971 (-5.8 %) | 1.298 → 1.281 (-1.3 %) | 24/24 | -0.2 % / -0.2 % / +0.0 % / +0.7 % |
| medium | 24 | 2.971 → 2.365 (-20.4 %) | 3.023 → 2.467 (-18.4 %) | 4.521 → 3.835 (-15.2 %) | 6.091 → 5.386 (-11.6 %) | 2.466 → 1.982 (-19.6 %) | 24/24 | +2.7 % / +2.0 % / +1.8 % / +3.0 % |
| high | 24 | 3.608 → 2.965 (-17.8 %) | 3.571 → 3.062 (-14.3 %) | 5.180 → 4.477 (-13.6 %) | 6.720 → 5.993 (-10.8 %) | 3.082 → 2.539 (-17.6 %) | 24/24 | +0.2 % / -0.4 % / +0.0 % / -1.5 % |
| ultra | 24 | 4.655 → 3.704 (-20.4 %) | 4.615 → 3.640 (-21.1 %) | 6.311 → 5.312 (-15.8 %) | 8.359 → 7.066 (-15.5 %) | 4.056 → 3.206 (-21.0 %) | 24/24 | +1.0 % / +1.0 % / +0.1 % / +0.4 % |
| all | 96 | 3.016 → 2.526 (-16.2 %) | 3.043 → 2.597 (-14.7 %) | 4.575 → 4.008 (-12.4 %) | 6.162 → 5.486 (-11.0 %) | 2.515 → 2.132 (-15.2 %) | 96/96 | +0.9 % / +0.6 % / +0.5 % / +0.6 % |

In ms (frame mean, Round 0 → final): Low 1.658 → 1.568 (-0.09), Medium 2.971 → 2.365 (-0.61), High 3.608 → 2.965 (-0.64),
Ultra 4.655 → 3.704 (-0.95). `cpu` is the game's rAF callback wall time (it includes GPU command-buffer waits).

**Path only:**

| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 1.500 → 1.457 (-2.9 %) | 1.723 → 1.761 (+2.2 %) | 2.865 → 2.780 (-2.9 %) | 4.453 → 4.365 (-2.0 %) | 1.390 → 1.360 (-2.2 %) | 12/12 | +0.3 % / +0.6 % / +0.4 % / +0.9 % |
| medium | 12 | 2.580 → 2.110 (-18.2 %) | 2.720 → 2.362 (-13.2 %) | 4.077 → 3.652 (-10.4 %) | 5.872 → 5.506 (-6.2 %) | 2.395 → 1.951 (-18.5 %) | 12/12 | +2.7 % / +1.5 % / +1.2 % / +2.3 % |
| high | 12 | 3.091 → 2.556 (-17.3 %) | 3.098 → 2.767 (-10.7 %) | 4.530 → 4.024 (-11.2 %) | 6.068 → 5.664 (-6.7 %) | 2.898 → 2.390 (-17.5 %) | 12/12 | +1.2 % / -0.0 % / +1.0 % / -1.2 % |
| ultra | 12 | 4.121 → 3.280 (-20.4 %) | 4.126 → 3.264 (-20.9 %) | 5.516 → 4.612 (-16.4 %) | 7.652 → 6.287 (-17.8 %) | 3.930 → 3.087 (-21.4 %) | 12/12 | +1.7 % / +2.0 % / +2.0 % / +2.2 % |
| all | 48 | 2.650 → 2.253 (-15.0 %) | 2.782 → 2.476 (-11.0 %) | 4.133 → 3.705 (-10.4 %) | 5.903 → 5.409 (-8.4 %) | 2.481 → 2.103 (-15.2 %) | 48/48 | +1.5 % / +1.0 % / +1.2 % / +1.0 % |

**Fight only:**

| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 1.832 → 1.688 (-7.9 %) | 1.721 → 1.555 (-9.7 %) | 3.068 → 2.878 (-6.2 %) | 3.987 → 3.612 (-9.4 %) | 1.213 → 1.207 (-0.5 %) | 12/12 | -0.7 % / -0.9 % / -0.3 % / +0.5 % |
| medium | 12 | 3.421 → 2.652 (-22.5 %) | 3.359 → 2.576 (-23.3 %) | 5.014 → 4.027 (-19.7 %) | 6.319 → 5.268 (-16.6 %) | 2.539 → 2.013 (-20.7 %) | 12/12 | +2.8 % / +2.6 % / +2.5 % / +3.6 % |
| high | 12 | 4.213 → 3.438 (-18.4 %) | 4.117 → 3.388 (-17.7 %) | 5.923 → 4.982 (-15.9 %) | 7.442 → 6.341 (-14.8 %) | 3.279 → 2.696 (-17.8 %) | 12/12 | -0.8 % / -0.8 % / -1.0 % / -1.7 % |
| ultra | 12 | 5.258 → 4.182 (-20.5 %) | 5.161 → 4.060 (-21.3 %) | 7.220 → 6.117 (-15.3 %) | 9.132 → 7.942 (-13.0 %) | 4.185 → 3.329 (-20.5 %) | 12/12 | +0.3 % / +0.1 % / -1.8 % / -1.4 % |
| all | 48 | 3.432 → 2.833 (-17.5 %) | 3.329 → 2.725 (-18.2 %) | 5.064 → 4.335 (-14.4 %) | 6.433 → 5.564 (-13.5 %) | 2.550 → 2.161 (-15.2 %) | 48/48 | +0.4 % / +0.3 % / -0.1 % / +0.2 % |

**Counts** (exact per run): draw calls fall in fights on Medium/High/Ultra (figure material sharing, the merged
operator shadow draw); programs at the bench are +1 to +3 (the menu pre-links: more programs at ready, none after it).
Every fight's state hash is equal in all three arms (the whole loop kept the `Math.random` order).

| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 21 → 23 |  |
| low | fight | 213.75 → 213.75 | 21 → 23 | 12/12 |
| medium | path | 145.5 → 142.5 | 51.5 → 54.5 |  |
| medium | fight | 245.5 → 226.5 | 51.5 → 54.5 | 12/12 |
| high | path | 199.5 → 199.5 | 55.5 → 56.5 |  |
| high | fight | 319 → 305 | 55.5 → 56.5 | 12/12 |
| ultra | path | 230.5 → 230.5 | 57.5 → 58.5 |  |
| ultra | fight | 366.5 → 346.5 | 57.5 → 58.5 | 12/12 |

**Per map** (frame mean, path + fight; each map a separate balanced run; change final vs Round 0, with the HEAD/HEAD
control headB / head and the run-position-corrected fit of `ab-posfit` given as Round 0 / final - 1):

| map | low | medium | high | ultra | all | control (low / medium / high / ultra) |
|---|---|---|---|---|---|---|
| downtown | -3.1 % | -20.7 % | -17.2 % | -20.7 % | -15.7 % | +0.2 / **+5.9** / -1.1 / **+4.8** % |
| house | -2.8 % | -16.0 % | -17.3 % | -18.7 % | -13.9 % | -0.1 / +2.1 / +0.8 / -0.3 % |
| mexico | -4.9 % | -21.5 % | -17.8 % | -19.0 % | -16.0 % | -0.4 / +2.3 / +2.0 / +0.1 % |
| training | -10.6 % | -23.1 % | -19.0 % | -23.3 % | -19.2 % | -0.5 / +0.7 / -0.9 / -0.5 % |
| posfit, Round 0 slower by (downtown / house / mexico / training) | +3.1 / +2.9 / +5.2 / +11.8 % | +26.1 / +19.0 / +27.4 / +30.1 % | +20.8 / +20.9 / +21.7 / +23.5 % | +26.1 / +22.9 / +23.4 / +30.4 % | | |

The fit equals the raw ratio (each run is exactly balanced). The control passed ~2 % (`NOISE.md`'s repeat line) on
downtown Medium (+5.9 %) and Ultra (+4.8 %), house Medium (+2.1 %) and mexico Medium/High (+2.3 / +2.0 %): a repeat of downtown Medium + Ultra (`r10b-downtown2`, 3 balanced rounds) read Medium **-19.0 %** (control -0.1 %) and
Ultra **-21.9 %** (control +0.9 %), against -20.7 / -20.7 % in the first run: the first run's sizes hold. The pooled
table above uses the four first runs only (the repeat is not pooled).
These controls are small next to the effect: on every map the Round 0 tree is slower in every pair (96/96), and the
per-map Medium/High/Ultra changes (-16 to -23 %) are 3-10 times the largest control. Treat the Medium and Ultra sizes as
estimates to about ±3 %. Low's -5.4 % is the smallest change; its controls stay within ±0.5 % on every map.

**js** (traced main-thread CPU) is not in this A/B: the traced mode takes ~1.35x as long and did not fit the 90 min /
power budget. Earlier js readings: Round 6 Ultra fight js -4.9 % (paired, traced r6cpu); Round 1 js -21.4 % overall
is **unpaired** (`r1-post` vs `baseline-1..3`, a drifting machine). An unpaired comparison of `baseline-1..3` and `r9-pre` (different days and
machine states) is not used.

### Load (Round 0 → final)

Load-only A/B `r10l` (`AB_ARGS=--load-only`, all 4 presets x 4 maps, 3 balanced rounds, head / r0 / headB, one cold
load in a fresh browser per run; `node perf/ab-load.mjs r10l`, `node perf/ab-load-count.mjs r10l`). Geomean of the
paired cell-round values; change = final / Round 0 - 1.

| | low | medium | high | ultra |
|---|---|---|---|---|
| **ready** ms, Round 0 → final | 502 → 398 (**-20.8 %**, -104 ms) | 6848 → 5209 (**-23.9 %**, -1.64 s) | 6802 → 5372 (**-21.0 %**, -1.43 s) | 8539 → 8158 (-4.5 %, -0.38 s) |
| first playable ms, Round 0 → final | 484 → 389 (-19.6 %) | 565 → 452 (-20.0 %) | 577 → 464 (-19.5 %) | 594 → 487 (-18.0 %) |
| Round 0 faster in (ready / first playable, of 12) | 0 / 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| control headB/head - 1 (ready / first playable) | -2.0 / -2.0 % | +0.2 / +1.7 % | +0.2 / +0.4 % | +0.2 / +0.2 % |
| load window (match start → ready): median per-load max frame, ms | 115.3 → 19.9 | 124.0 → 51.1 | 145.9 → 77.7 | 156.4 → 83.8 |
| mean frames > 33 / > 50 ms per load | 1.0 / 1.0 → 0.3 / 0.2 | 2.9 / 2.3 → 2.4 / 0.8 | 4.0 / 2.8 → 2.8 / 1.7 | 4.3 / 2.3 → 3.3 / 1.5 |

The ratios above are the ab-load paired ratios shown as final/Round 0 (ab-load prints Round 0/final: +26.3 / +31.5 /
+26.6 / +4.7 % ready, +24.4 / +25.0 / +24.2 / +22.0 % first playable). Where the time went (median phase differences
over all loads, Round 0 - final): the match starts 105 ms later on Round 0 (the first match frame holds the
~100 ms `new AudioContext()`: Round 10's audio change), and so does everything after it; on top of that the bake ends
~360 ms later (the layout worker, Round 7), textures ~0.7 s, props ~1.0 s, weapons ~1.3 s and operators ~1.45 s later
(upload packing, Rounds 8/9; the Round 6 load trims); the median ready difference over all 48 loads is +384 ms (a median over
mixed presets: read the table per preset). Ultra gains least: its 2K maps fill an upload slot each.

### Hitches (Round 0 → final)

**Programs linked after ready** (`perf/hitch.mjs sweep`: after ready, content the bench never touches — every loadout
gun with both rifle optics, the sword with blood, waves and an execution, the 5 enemy kinds and 6 bosses outside the
bench roster, solo wave 5; one fresh browser per cell; each program counted by identity, so a relink counts again):

| programs created after ready, Round 0 → final | low | medium | high | ultra |
|---|---|---|---|---|
| downtown | 8 → 0 | 9 → 0 | 11 → 0 | 11 → 0 |
| house | 8 → 0 | 9 → 0 | 11 → 0 | 13 → 0 |
| mexico | 6 → 0 | 7 → 0 | 9 → 0 | 9 → 0 |
| training | 4 → 0 | 5 → 0 | 7 → 0 | 7 → 0 |

Final tree: `--check zero` **PASS** in all 16 cells (`perf/results/r10-sweep-final.json`); Round 0:
`perf/results/r10-sweep-r0.json`. Programs at ready, Round 0 → final: Low 20-22 → 22-24, Medium 49-52 → 52-55,
High 51-54 → 54-57, Ultra 53-56 → 56-59 (linked at the menu instead).

**First-fight hitch** (`perf/hitch.mjs measure`: a cold load per build and cell, straight into the fight, the first 120
stepped frames; one load per cell and build, alternating; `perf/results/r10-hitch-measure.json`; started at 47 % on AC,
under the 50 % gate the other timed jobs used, the watchdog's 35 % floor held). Max frame ms, Round 0 → final:

| | low | medium | high | ultra |
|---|---|---|---|---|
| downtown | 17.2 → 9.3 | 36.0 → 11.6 | 37.3 → 11.0 | **70.5 → 11.5** |
| house | 19.1 → 10.0 | 36.5 → 11.5 | 36.6 → 11.2 | **70.3 → 11.8** |
| mexico | 19.1 → 9.9 | 19.2 → 10.0 | 34.6 → 9.8 | **55.0 → 10.8** |
| training | 12.9 → 13.9 | 9.1 → 14.6 | 16.6 → 14.9 | 38.9 → 14.0 |
| programs linked in the fight (Round 0 → final) | 0 → 0 | 0 → 0 | 2 → 0 | 2 → 0 (house: +2 more after the bench-order run, the shafts) |

On Round 0 every High/Ultra cell links two programs in its first fight (the soft smoke at the first shot, frame 21, and
the soft fire, frame 25-85): the first of those callbacks takes 42-79 ms on Ultra and 12-46 ms on High. The final tree links none. One load per cell: the frame sizes are single readings (Round 7 measured up to
457 ms for the same link on a fresh load); the program counts are exact. Training on the final tree reads a little
higher on Low/Medium (13.9 / 14.6 vs 12.9 / 9.1 ms) with no compile in either: one-load noise.

**Quiet-start frames** (realistic presets): the first match frame's ~100 ms `new AudioContext()` (Round 10:
144 → 29 ms median) and the operators glb callback (Round 9: ~143 → ~81 ms on High/Ultra) are the two long frames of
the 3 s quiet start; in the load A/B the load window's median per-load max frame halves (145.1 → 72.7 ms over all
loads, table above).

### Quality

`node perf/quality.mjs capture final` (the final tree, 14 views x 4 presets) and `compare baseline final`: **PASS, 56/56,
every SSIM 1.0000** (min tile 1.0000). Changed pixels against the Round 0 capture (counted per pixel, max channel
difference; `perf/results/r10-quality-px.txt`):

- **Low: 14/14 images byte-identical.**
- **Medium / High / Ultra: 289 changed pixels in all 42 images** (of ~87 M), 1-21 per image, every one by 1-3/255
  (257 px by 1, 32 by 2-3). Medium 82 px, High 107 px, Ultra 100 px; the most is high/mexico-overview (21 px).
- Cause: Round 1's B1 (FX light skip) and B3 (packed ORM read) are exact in exact arithmetic, but Metal compiles with
  fast math, so the edited shader text reassociates float ops (Round 1: 284 px against the baseline, SwiftShader
  float32 bit-identical / within 1 ulp). Round 4's `g` (N·L shadow-tap skip) moved 39 px more against Round 2. The
  one larger change of Round 1 (high/fight-mid, an SMAA edge decision flipped by a 1-LSB input: 3-4 px up to 23/255)
  is flipped back by `g`: against the baseline, high/fight-mid now differs in 8 px by at most 3/255.
- Every later round was byte-identical to the round before it (Rounds 2, 5-10: 0 changed pixels; Round 4 only `g`).
  `compare r9 final`: 56/56, 0 changed pixels; all 56 PNGs byte-identical (`cmp`).

## 2. Every kept change, ranked by measured impact (biggest first)

The per-change numbers come from different A/B runs, bases and machine states (each round measured its change on top
of the tree before it). They overlap and do **not** add up (Round 1: the whole set gained more on Ultra than the sum
of its parts, because the GPU bottleneck moves). Section 1 is the only clean cumulative number. "Exact" = byte-identical
screenshots (56/56); "LSB" = changed pixels, mostly 1-3/255, with one SMAA edge cluster up to 23/255 in Rounds 1
and 4 against the tree before them (explained in section 1, Quality). Round 1's per-component numbers come from runs
x1-x4, made before the balanced rotation (only x5 was balanced).

### Frame time (after ready)

| # | change | round, commit | presets | measured gain (paired frame mean unless named) | source | pixels |
|---|---|---|---|---|---|---|
| 1 | **Post-chain targets**: no unused MSAA depth resolve on Medium, canvas without depth, RG16F shaft targets, frozen post matrices, RG8 SMAA edges, colour clear before passes that overwrite their whole target (no tile load) | R1 `221ffb1` (A2-A7) | all | Medium -10.9 %, High -7.7 %, Ultra -2.0 %, Low -2.6 % | `r1-ab.md` x4 | exact |
| 2 | **FX point light skipped while dark** and outside its reach | R1 `221ffb1` (B1) | realistic | Medium -7.2 %, High -1.9 %, Ultra -2.5 % | `r1-ab.md` x2 | LSB |
| 3 | **Scene target cleared inside `render`** after the shadow maps (no store + reload on a tiled GPU) | R1 `221ffb1` (A1) | realistic | Medium -5.6 %, High -4.2 %, Ultra -1.3 % | `r1-ab.md` | exact |
| 4 | **Round 4 set**: SMAA level-0 fetches; packed-ORM varyings, shared uv, fixed uv transforms, AO alpha only with AO; static figure matrices; one merged operator shadow draw per cascade; view model/backdrop skip cascades; shadow taps skipped where N·L ≤ 0 (`g`) | R4 `cad1329` | High, Ultra (confirmed); Medium provisional, no gain counted | f1: Medium -3.3 %, High -2.8 %, Ultra -3.0 %; confirmed r5R: the code before it +5.8 % (High) / +4.1 % (Ultra) slower; r8cov High +5.0 % (control -2.2 %). `g` alone (c2): Medium -2.5, High -3.6, Ultra -2.3 % | `r4-ab.md`, `r5-ab.md`, `r8-ab.md` | LSB (`g`: 39 px) |
| 5 | **Dark cascade lights compiled out, skinned twin depth material, `syncModel` reads fresh matrices, empty effect pools leave the draw list, fewer effect allocations** | R1 `221ffb1` (B2+B7+C) | all | Medium -4.7 %, High -2.9 %, Ultra -3.1 %, Low -1.1 % | `r1-ab.md` x4 | exact |
| 6 | **HUD CSS variables on their readers + one fewer rig walk** (+ fences only on the realistic look, Low) | R7 `e0128de` (hud + misc) | Medium, Ultra, Low; High: exception, no gain counted | Medium: the tree before it +3.5 % mean slower (fight +6.3 %) over all 4 maps (r8cov); Ultra: -4.2 % (r7f2, fights only); Low: ~2-4 % (median, two runs) | `r7-ab.md`, `r8-ab.md` | exact |
| 7 | **Shared figure materials while untinted** (main-pass material switches in fights ~105 → ~7) | R2 `82ee6e1` (A) | realistic | path + fight: Medium -3.5 %, High -2.2 %, Ultra -1.5 %; fight only: -5.8 / -3.5 / -3.1 %; training fight cpu -8.5 % | `r2-ab.md` s2 | exact |
| 8 | **Figure ray sphere pre-reject** | R2 `82ee6e1` (B) | all | path + fight: Medium -3.3 %, High -1.2 %, Ultra -1.6 %; fight only: -5.1 / -2.9 / -1.9 %; training fight cpu -8.2 % | `r2-ab.md` s1 | exact |
| 9 | **Shadow-walk pruning + post chain in one `render()`** | R6 `52c96ba`, `2e63462`, `abca498` | Ultra; High since MSI round 1 | Ultra fight frame mean -2.8 %, fight js -4.9 %; MSI High frame mean -3.1 % (twice) | `r6-ab.md` r6cpu, `msi-r1-ab.md` | exact |
| 10 | **Packed ORM texture read once** | R1 `221ffb1` (B3) | realistic | Medium -2.6 %, High -1.5 %, Ultra -1.2 % | `r1-ab.md` x2 | LSB |

Round 2's two changes together (s3, all presets): Low -2.3, Medium -2.9, High -2.3, Ultra -2.0 % (fights -4.2 / -5.1 %
in two runs), "measured, not proven past noise on every preset". Round 1 as a whole (x5): Low -2.6, Medium -15.7,
High -14.7, Ultra -15.1 %.

### Load time

| # | change | round, commit | presets | measured gain | source | pixels |
|---|---|---|---|---|---|---|
| L1 | **Upload slot packing** (several items per upload slot within 1.44 MB and 2 ms; same average rate) — user decision | R8 `32799f9` (reverted `e7f3488`), R9 `e1af377` | Medium, High (Ultra ~0: its 2K maps fill a slot) | ready: without it +27.9 % (Medium) / +22.6 % (High) slower, 0/12 faster (r9pl); Medium -1.32 s, High -1.19 s (r8l); load-window stutter counts within the parent's rule | `r8-ab.md`, `r9-ab.md` | exact after ready |
| L2 | **Bake layout in a Web Worker** | R7 `e0128de` | Medium, High; Ultra: exception, no gain counted | the worker's own effect: bake layout / bake end 381 / 395 ms earlier (r7ld medians), `bake.off` 319-418 ms earlier (r8cl). Ready Medium -6.6 %, High -4.3 % (r7ld) measures Round 7's whole set (pre + worker + hud + misc), not the worker alone | `r7-ab.md`, `r8-ab.md` | exact |
| L3 | **Exact load trims**: `checkShaderErrors` off in production, props merge placed early, room environment compiled in parallel | R6 `52c96ba` | all | first playable Medium -2.3 %, High -5.8 %, Ultra -7.1 %; ready -1.1 to -1.4 % (realistic); Low ready -3.2 % (r7ll: the tree without it +3.4 % slower) | `r6-ab.md`, `r7-ab.md` | exact |

### Hitches (first use, quiet start)

| # | change | round, commit | presets | measured effect | source | pixels |
|---|---|---|---|---|---|---|
| H1 | **Soft smoke/fire sprites and shafts linked at the menu** | R7 `e0128de` (pre) | High, Ultra | first-fight max frame over 3 loads, training/high 457 / 32.5 / 32.9 → 34.2 / 32.9 / 36.2 ms (457 ms is the worst observed load), training/ultra 133 / 116 / 132 → 32.6 / 37.3 / 35.3 ms, house/ultra 380 / 233 → 39 / 39 ms — exploratory timings at 7-26 % battery; the program counts are exact; programs after ready on the bench path → 0; 2 fewer programs | `r7-hitch.json` | exact |
| H2 | **AudioContext output service started off the main thread** (`enumerateDevices` at mount) | R10 `eb2e359` | all (realistic loads measured) | first quiet-start frame 144.2 → 28.8 ms median (125-178 → 22-41 ms, 12/12 loads; the commit message's 147.6 → 29.2 used the upper middle value); loads with a frame > 100 ms 12/12 → 4/12 | `r10-hitch-audio.json` | exact |
| H3 | **Quiet-start operators glb callback**: skin once, find gib bones once | R9 `4370d1b` | realistic | that frame High 142.8 → 81.0 ms, Ultra 143.4 → 81.3 ms (medians, 4 loads each); Medium under 50 ms in 3/4 — exploratory, an acceptance exception | `r9-hitch-quiet.json` | exact (bit-equal) |
| H4 | **Sword blade-blood, air-slash wave and ban-ring programs linked at the menu** (the wave/ring relinked for every wave) | R8 `d1ba2e3` (late) | all | programs after ready in the content sweep 8 / 5 / 9 / 5 → 0 (Low / Medium / High / Ultra cells swept) | `r8-sweep*.json` | exact |
| H5 | **Skinned shadow-depth program linked at the menu** (probe) | R9 `4370d1b`, `b808c54`, `a3eee84` | realistic | in-match depth link 12/12 → 0/12 loads | `r9-hitch-shadow.json` | exact |

### Test and harness (no game effect)

- R9 `51dd4d4`: the two render-chain sky tests (older than the loop) no longer depend on wall-clock time.
- R10 `eb2e359`: `tests/blood.test.ts` stair-pool test seeded over 200 seeds; the old check rejected correctly placed
  pools on the upper step in 228 of 2000 seeds (a test fault; the game clamp is right).
- Harness: `ab.sh` (paired interleaved A/B), `ab-posfit`, `ab-robust`, `ab-load`, `ab-pair`, `ab-final`, `hitch.mjs`,
  `powered.sh`, `quality.mjs`.

## 3. Open exceptions and caveats

- **Round 7's acceptance exceptions** (parent's decision, no separate user approval recorded): the HUD/rig change runs
  on High without a validated gain (three runs: no gain and no regression shown), and the bake worker runs on Ultra
  where its ready gain (-1.6 %) is under ~2 %. No gain is counted there.
- **Round 4 on Medium is not confirmed** (r5R void, r8cov -0.1 %); kept by the parent's decision (exact apart from
  `g`'s 39 px, the same code as High/Ultra); no Medium gain is counted for it.
- **Round 9 `quiet`** is kept on exploratory hitch evidence (4 loads per preset), an acceptance exception.
- **Packing's Ultra count** passed only on a pooled rate reading of the parent's rule (> 33 ms frames over 36 loads:
  151 vs 146 / 148).
- **Power**: Rounds 2-3 ran with the battery near empty, Rounds 5-6 on a 20 W adapter, Rounds 9-10 on a 30 W adapter
  that did not keep up under load (power-state switches voided several arms). Every timed Round 10 job ran under
  `perf/powered.sh` (AC, void under 35 %) and started at ≥ 50 %, except the first-fight hitch measure (47 %); the exact
  checks (program sweeps, captures, tests) ran without the start gate. No job was voided. Readings in
  `perf/results/r10-power.log`.
- **Background load**: a "Google Chrome for Testing" from `~/.agent-browser` (not ours) used ~60-140 % CPU during
  Rounds 8-10 (logged before each job). Paired runs share it across variants; unpaired runs do not.
- **Noise**: single cells spread 5-27 %; the paired HEAD/HEAD control moved up to ~3-8 % on one preset in some runs.
  Read preset aggregates, not single cells.
- **Tests**: `tests/pacing.test.ts` "view models compile … not in a match" failed once in a full run in Round 10 and
  passed alone 3/3 and in the next full run (408/408); it looks like the wall-clock quiet-start pattern the sky tests
  had (not fixed).

## 4. Rejected ideas (short list; numbers in `perf/LOG.md` *Tried / rejected*)

Shadow depth invalidate (A8, dsd: twice ~0); fog/macro-noise run-time skips (B4-B6: Metal LSBs); allocation-free A*
and effect pooling (C1/C2: no frame or GC effect; GC ~0.01 ms/frame); bone upload timing; rig matrix walks
(c-matrix, matrix); Low shadow double-buffer (e-low2) and merged Low shadow draws (low1, twice); GTAO trims (LSBs);
view-model depthRange per run (dr); walk + D on Medium (three Mac A/Bs and two MSI A/Bs: cpuhm; High kept in MSI round 1); sky environment reuse; warm-up
collision hold (warm); hud2, fence, opaque canvas, clip lists; Ultra slot budget; Round 10's operator main-pass probe
(exact, removes 2 in-match compiles, the 35 ms warm-up frame did not shorten).

## 5. Remaining leads

1. The ~35 ms in-match operator warm-up frame on High/Ultra (the template's first draw, not a link); the ~80-110 ms
   operators glb callback frame in the quiet start (Round 9 halved it).
2. The 9 held compiles after match start (5 at the sky landing, ~6 ms of a ~14 ms frame; 4 dressing, ~2-3 ms): need
   the glbs before Start (a load-order change).
3. Shadow-map bind/clear/store on Ultra (~0.23 ms by probe), only non-exact levers left.
4. Ultra upload slot budget (`r8-packu.patch`, -1.8 % ready: a pacing choice).
5. Crosshair `top`/`left` transitions (main thread outside rAF): non-exact (sub-pixel), needs consent.
6. `tests/pacing.test.ts` wall-clock flake (above).

## 5a. Second platform (MSI: Linux, RTX 4090)

Setup and full numbers: `perf/results/msi-s1.md` (step 1) and `perf/LOG.md` *MSI round 1* (tables in
`perf/results/msi-r1-ab.md`). Headless Chrome 153 on ANGLE GL-EGL on the NVIDIA driver, i9-14900HX; there every fight
frame is bound by the renderer main thread, not the GPU.

**Round 0 → final on the MSI** (step 1, same protocol as section 1: 96 pairs, path + fight, frame mean):

| preset | MSI frame mean | MSI ready | Mac frame mean (section 1) |
|---|---|---|---|
| low | 0.913 → 0.819 ms (-10.3 %), 22/24 | -7.9 % | -5.4 % |
| medium | 1.481 → 1.213 ms (-18.1 %), 24/24 | -21.9 % | -20.4 % |
| high | 1.701 → 1.363 ms (-19.8 %), 24/24 | -21.5 % | -17.8 % |
| ultra | 1.959 → 1.553 ms (-20.7 %), 24/24 | -8.0 % | -20.4 % |
| all | 1.457 → 1.204 ms (-17.3 %), 94/96 | | -16.2 % |

Controls within ±2.4 %; programs after ready 4-13 → 0 (the Mac's counts); quality: Low/High/Ultra byte-identical,
Medium 45 px (1-3/255) from Round 4.

**MSI round 1** (CPU-side retries on the MSI, two paired MSI A/Bs + one Mac A/B, keep rule written before the numbers):

- **Kept: the fight-CPU paths on High** (`fightCpuPaths`: shadow-walk pruning and the post chain in one render, until
  now Ultra only). MSI High frame mean -3.1 % in both A/Bs (posfit -3.5 / -2.7 %; ~-0.04 ms of 1.40 ms; noise line 2.0 %).
  Mac: **not A/B'd alone** (an exception to the keep rule): the one Mac A/B measured a superset (High -0.3 %, control
  +0.1 %), and Rounds 6/7/9 read this High code -2.0 to -2.9 % on the Mac. Byte-identical on both machines.
- Rejected: Medium for the same paths (-3.2 then -2.5 %, not confirmed), matrix (-2 % over all presets twice, but never
  past the line on the same preset twice), low1 (Low -2.9 then -1.2 %), the HUD (hud2) and C1 (inside noise).
- Screened only: ops (operator clip/bone sync, the renderer's pre-step: `sync` 6.9 → 3.9 µs per figure; Ultra -2.0 %).
- Round 2 leads: matrix, ops and Medium's fight-CPU paths. The one arm with everything (fight-CPU paths on Medium +
  High, matrix, low1 before its fix, ops) read -3.5 % over all presets (-4.3 / -5.0 % Medium / High), unconfirmed per part; crosshair ticks by `transform` (not byte-exact: user's call).

## 6. How to reproduce

```sh
npm run build
git diff --binary HEAD c7a65d8 -- src tests > /tmp/r0.patch        # the Round 0 game tree as a patch on HEAD
for m in downtown house mexico training; do                       # ~10 min each; keep the machine on AC
  perf/powered.sh perf/results/power.log r10b-$m perf/ab.sh r10b-$m low,medium,high,ultra $m 3 head /tmp/r0.patch headB
done
node perf/ab-final.mjs r0 r10b-downtown,r10b-house,r10b-mexico,r10b-training
node perf/ab-posfit.mjs r10b-<map> mean both
AB_ARGS="--load-only" perf/ab.sh r10l low,medium,high,ultra downtown,house,mexico,training 3 head /tmp/r0.patch headB
node perf/ab-load.mjs r10l; node perf/ab-load-count.mjs r10l
git worktree add /tmp/r0 c7a65d8 && (cd /tmp/r0 && npm ci && npm run build)   # or the r0 arm's build from ab.sh
node perf/hitch.mjs sweep --out out --check zero; node perf/hitch.mjs sweep --out /tmp/r0/out
node perf/hitch.mjs measure --maps ... --presets ... --outs final=out,r0=/tmp/r0/out
node perf/quality.mjs capture final && node perf/quality.mjs compare baseline final
npm run typecheck && npx vitest run --maxWorkers=2
```

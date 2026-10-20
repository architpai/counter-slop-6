# Round 9 A/B notes

## r9pl: upload packing, load-only (head = HEAD with packing, nopack = HEAD without packing (/tmp/r9/nopack.patch), headB = HEAD copy)

medium/high/ultra x downtown/house/mexico/training, 3 balanced rounds, 1 load per cell-round, 17:09-17:22 on AC (30 W
adapter, 84 -> 78 %). `node perf/ab-load.mjs r9pl`.

| | medium | high | ultra |
|---|---|---|---|
| readyMs geomean head / nopack / headB | 5297 / 6773 (+27.9 %) / 5329 (+0.6 %) | 5497 / 6737 (+22.6 %) / 5502 (+0.1 %) | 8456 / 8565 (+1.3 %) / 8506 (+0.6 %) |
| nopack faster than head (cell-rounds) | 0/12 | 0/12 | 2/12 |
| frames > 33 ms, total over 12 loads: head / nopack / headB | 35 / 35 / 34 | 48 / 48 / 48 | **52 / 49 / 48** |
| frames > 50 ms, total over 12 loads | 24 / 26 / 26 | 29 / 28 / 29 | 32 / 32 / 32 |
| highest single frame in the window, ms | 169.3 / 168.8 / 154.6 | 166.7 / 163.4 / 213.1 | 249.7 / 198.4 / 251.2 |

The parent's revert rule ("a preset's load-window count of frames > 33 or > 50 ms exceeds both nopack and the control by
more than 2 per 12 loads") **trips on Ultra > 33 ms** (head +3 vs nopack, +4 vs headB; head and headB are the same code).

**Decision rule, written before the extension runs (r9pu):** an Ultra-only load A/B (head, nopack, headB; 4 maps;
6 balanced rounds) is pooled with r9pl's Ultra loads (36 loads per arm). Packing fails (revert, keep the patch, log it)
only if head's pooled Ultra total of frames > 33 ms or > 50 ms is above both nopack's and headB's by more than 6
(2 per 12 loads). Otherwise the rule passes and packing stays. Per-cell counts are listed as context only.

## r9f plan (frame time, the round's one frame-time A/B), written before it runs

Candidate `cpuhm` (`/tmp/r9/cpuhm.patch`: `fightCpuPaths` on Medium/High/Ultra, i.e. Round 6's shadow-walk subtree
hiding and post chain in one render on Medium and High too; exact, the same code Ultra runs; its third try after r6 and
r7). Variants head / cpuhm / headB, medium,high x training,mexico, fight scenario only (`AB_ARGS="--scenarios fight"`),
`AB_TRACE=1`, 9 balanced rounds. Read with `ab-agg.mjs`, `ab-posfit.mjs`, `ab-robust.mjs`.
**Acceptance (NOISE.md):** cpuhm kept on a preset only if its fight frame mean (raw and position-fitted) is faster than
head by >= 2 % (Medium) / >= 4.5 % (High), or its fight js mean by >= 3.2 % (Medium) with frame mean not slower, AND the
headB/head control is within 2 % on that preset AND the robust ratio vs head and vs headB has the same sign. Otherwise
rejected (third time: Round 10 should not try it again).

## r9pu: Ultra-only packing extension (load-only), 18:00-18:09 on AC (30 W, 89 -> 87 %), agent-browser Chrome ~87-89 % CPU

ultra x 4 maps, 6 balanced rounds (24 loads per arm). `node perf/ab-load.mjs r9pu`.

| | head | nopack | headB |
|---|---|---|---|
| readyMs geomean (vs head) | 8364 | 8592 (+2.7 %) | 8392 (+0.3 %) |
| frames > 33 / > 50 ms, total over r9pu's 24 loads | 99 / 55 | 97 / 57 | 100 / 58 |
| **pooled with r9pl (36 loads): > 33 / > 50 ms** | **151 / 87** | **146 / 89** | **148 / 90** |
| highest single frame (pooled), ms | 249.7 | 200.8 | 251.2 |
| per-load > 33 ms counts in r9pu (context) | 3-5 | 3-5 | 3-5 |
| nopack ready faster than head | | 1/24 | headB 10/24 |

**Verdict (the pre-registered rule):** head's pooled Ultra > 33 ms total is +5 vs nopack and +3 vs headB (limit: more
than 6 above both); > 50 ms is below both. **The rule passes: packing stays.** r9pl's +3/+4 on 12 loads was one-load
spread (head and headB are the same code; r9pu alone reads head 99 vs headB 100). The 249.7 ms head maximum is one r9pl
load; headB (same code) has 251.2 ms.

## r9f result (18:08:54-18:56:45, on AC 30 W, battery 87 -> ~66 %; agent-browser Chrome 82-87 % CPU at start/end)

| fight only, 9 balanced rounds | medium | high |
|---|---|---|
| cpuhm frame mean raw / position-fitted vs head | +0.9 % / +0.9 % | **-2.4 % / -2.4 %** |
| cpuhm median / p95 | +0.7 % / +2.6 % | -1.9 % / -2.9 % |
| cpuhm js mean | -0.7 % | -0.8 % |
| robust (median of per-cell ratios) vs head / vs headB; faster in | -1.1 % / -1.9 %; 9/18 | -3.3 % / -3.6 %; 12/18 (16/18 vs headB) |
| headB / head mean (control) | **+3.3 %** (past 2 %) | +1.1 % |

**Verdict: cpuhm rejected** (third try). Medium: no gain and the control moved past 2 %. High: -2.4 % mean, under the
4.5 % line, js -0.8 % (under its line). Patch `perf/patches/r9-cpuhm.patch`. Do not try it a fourth time.

## Round test hitch (`r9-hitch-final.json`): e1af377 (out-q-head) vs the round tree, downtown + house, 2 rounds, 19:20

See perf/LOG.md Round 9 "Result". The ~-2.8 s quiet-start frame (the operators glb callback): Medium 92-95 ms → under
50 ms in 3/4 loads; High median 142.8 → 81.0 ms; Ultra 143.4 → 81.3 ms. The in-match skinned depth link 4/4 → 0/4 per preset.

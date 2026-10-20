# MSI round 2 — printed A/B tables

Keep rule (written before the numbers it governs):

    # MSI round 2 keep rule (written 04:25, before any round-2 number existed)
    Base: HEAD 1384bf1 (game tree = round 1's kept tree: fightCpuPaths on High and Ultra).
    Metric: frame mean, path + fight, per preset, against the POOLED HEAD reference, two ways (perf/ab-pool.mjs, 2 decimals):
      raw    = paired geomean ratio vs head / geomean of the HEAD copies' ratios vs head (the same cells);
      posfit = the ab-posfit fit's variant effect minus the mean of the HEAD copies' effects (head = 0).
    HEAD copies: head, headB on every preset; medfcp also on Low, High and Ultra (fightCpuPaths gives the same value
      there: the same code). Medium's pool = head + headB.
    Noise line N_p = max(2 %, the largest pairwise |difference| among the HEAD copies on preset p, raw or posfit).
    Control clean on p = every HEAD-copy pair within 2.4 % (step 1's range) on p. A preset whose control is not clean
      gives no decision (not a pass).
    PASS on p = raw AND posfit <= -N_p, the control clean on p, every fight state hash equal to head's.
    MSI A/B (msir2a): head, headB, matrix, ops, medfcp; 4 maps x 4 presets x 5 rounds (= the arm count: every variant
      takes every position once per cell), path + fight, --no-trace, under powered-linux.sh. 400 runs (~70 min).
      A second HEAD copy (6 arms, 576 runs, ~90 min) and fence do not fit the 75 min cap: not run.
    Confirmation: a candidate that passes here on a preset where it also read negative (raw and posfit) in round 1
      counts as confirmed on that preset. Round 1 negatives: matrix Low/Medium/High/Ultra (both jobs); ops Medium, High,
      Ultra (job 2; Low read 0.0 / +0.5: a Low pass of ops does not count); medfcp (= cpuhm on Medium) Medium (both jobs).
    MSI winner:
      matrix, ops (no per-preset switch: kept or rejected whole): a confirmed pass on >= 1 preset, AND no preset slower
        than +N_p (raw or posfit) in this A/B.
      medfcp: judged on Medium only (it changes nothing else); a confirmed pass on Medium.
    Mac A/B (macr2): head, headB, win (all MSI winners together; omitted if none), prer1 (HEAD with fightCpuPaths back to
      Ultra only = 5423a85's game tree); rounds = the arm count, the same 4 x 4 matrix, perf/powered.sh, AC, >= 50 %.
      Mac noise line M = max(2 %, |headB vs head| on the preset, raw or posfit); pooled reference head + headB.
      KEEP the MSI winners only if win reads no slower than +M on any preset (raw and posfit both checked; either past
        +M = slower). If win is slower: medfcp changes Medium only, so a Low/High/Ultra slowdown rejects matrix and ops
        (whichever are in win; no budget to split them), a Medium slowdown rejects every winner.
      Round 1's High exception: prer1 is the OLD code. The High change is slower on the Mac if head reads slower than
        prer1 by more than M on High (prer1 vs pool <= -M, raw or posfit). Then REVERT it (fightCpuPaths Ultra only).
        Otherwise the exception is settled: kept.
    Pixels (kept set): Mac quality.mjs compare baseline + msi-r1-keep (the tree before this round), MSI compare
      msi-baseline + msi-r1-keep: PASS, 0 changed px vs msi-r1-keep (or every px explained). Typecheck, vitest on the Mac.

    ## Addendum (05:30, after msir2a was read, before any macr2 or msir2b number existed)
    msir2a verdict under the rule above: matrix is the only MSI winner (Medium). Mac A/B macr2 = head, headB, matrix,
      prer1 (4 rounds).
    Final MSI verification msir2b, started now (before the Mac verdict, to save time): head, headB, matrix, prer1;
      4 maps x 4 presets x 4 rounds. It REPORTS the final tree against 5423a85's game tree (prer1); it is not a keep
      gate. Final tree = matrix if the Mac keeps it and keeps round 1's High change; otherwise the arm that matches
      the Mac verdict (head = round 1 only; prer1 = neither). The matrix and head arms there are a further reading,
      reported but not used to change the msir2a verdict.

## msir2a (MSI: head, headB, matrix, ops, medfcp; 4 maps x 4 presets x 5 rounds, path + fight, --no-trace; 04:25-05:28)

```
msir2a mean both: vs pooled HEAD (raw / posfit); HEAD copies headB,medfcp:low+high+ultra

all  pool=head+headB  N_p=2.00%  copies: headB/head +0.36% / +0.36%
  matrix   -1.88% / -1.88%
  ops      -0.55% / -0.55%
  medfcp   -0.55% / -0.55%

low  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head -1.03% / -1.03%, medfcp/head -0.82% / -0.82%, medfcp/headB +0.20% / +0.20%
  matrix   -1.39% / -1.39%
  ops      -0.06% / -0.06%

medium  pool=head+headB  N_p=2.00%  copies: headB/head +1.70% / +1.70%
  matrix   -3.01% / -3.01%
  ops      -1.76% / -1.76%
  medfcp   -1.84% / -1.84%

high  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head -0.48% / -0.48%, medfcp/head -0.99% / -0.99%, medfcp/headB -0.51% / -0.51%
  matrix   -1.46% / -1.46%
  ops      +0.87% / +0.87%

ultra  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head +1.29% / +1.29%, medfcp/head +1.37% / +1.37%, medfcp/headB +0.08% / +0.08%
  matrix   -1.54% / -1.54%
  ops      -1.13% / -1.13%
msir2a mean fight: vs pooled HEAD (raw / posfit); HEAD copies headB,medfcp:low+high+ultra

all  pool=head+headB  N_p=2.00%  copies: headB/head +0.54% / +0.54%
  matrix   -1.81% / -1.81%
  ops      -0.60% / -0.60%
  medfcp   -0.53% / -0.53%

low  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head -1.11% / -1.11%, medfcp/head -0.17% / -0.17%, medfcp/headB +0.94% / +0.94%
  matrix   -1.97% / -1.97%
  ops      +0.31% / +0.31%

medium  pool=head+headB  N_p=2.00%  copies: headB/head +2.00% / +2.00%
  matrix   -3.07% / -3.07%
  ops      -1.71% / -1.71%
  medfcp   -2.07% / -2.07%

high  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head -0.20% / -0.20%, medfcp/head -1.10% / -1.10%, medfcp/headB -0.91% / -0.91%
  matrix   -0.94% / -0.94%
  ops      +0.94% / +0.94%

ultra  pool=head+headB+medfcp  N_p=2.00%  copies: headB/head +1.49% / +1.49%, medfcp/head +1.35% / +1.35%, medfcp/headB -0.14% / -0.14%
  matrix   -1.23% / -1.23%
  ops      -1.90% / -1.90%

HEAD 1384bf1074999d1485d67dfdefb86d8d5d9f9815  variants: head, headB, matrix, ops, medfcp  (2026-10-20T19:25:06.255Z)
complete: 5 variants x 160 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=1.192 (0.0%)  headB=1.196 (0.4%)  matrix=1.172 (-1.7%)  ops=1.188 (-0.4%)  medfcp=1.188 (-0.4%)
low      head=0.801 (0.0%)  headB=0.793 (-1.0%)  matrix=0.785 (-2.0%)  ops=0.795 (-0.7%)  medfcp=0.794 (-0.8%)
medium   head=1.204 (0.0%)  headB=1.224 (1.7%)  matrix=1.177 (-2.2%)  ops=1.192 (-0.9%)  medfcp=1.191 (-1.0%)
high     head=1.356 (0.0%)  headB=1.349 (-0.5%)  matrix=1.329 (-1.9%)  ops=1.361 (0.4%)  medfcp=1.342 (-1.0%)
ultra    head=1.545 (0.0%)  headB=1.565 (1.3%)  matrix=1.535 (-0.7%)  ops=1.542 (-0.3%)  medfcp=1.567 (1.4%)

## med: geomean (paired ratio vs head)
all      head=1.040 (0.0%)  headB=1.042 (0.2%)  matrix=1.022 (-1.7%)  ops=1.036 (-0.4%)  medfcp=1.032 (-0.8%)
low      head=0.753 (0.0%)  headB=0.740 (-1.8%)  matrix=0.734 (-2.6%)  ops=0.740 (-1.8%)  medfcp=0.735 (-2.4%)
medium   head=1.098 (0.0%)  headB=1.109 (1.0%)  matrix=1.078 (-1.8%)  ops=1.088 (-0.9%)  medfcp=1.080 (-1.6%)
high     head=1.154 (0.0%)  headB=1.160 (0.5%)  matrix=1.142 (-1.0%)  ops=1.180 (2.3%)  medfcp=1.151 (-0.2%)
ultra    head=1.224 (0.0%)  headB=1.237 (1.1%)  matrix=1.210 (-1.2%)  ops=1.212 (-1.0%)  medfcp=1.238 (1.2%)

## p95: geomean (paired ratio vs head)
all      head=1.729 (0.0%)  headB=1.730 (0.0%)  matrix=1.713 (-0.9%)  ops=1.740 (0.6%)  medfcp=1.726 (-0.2%)
low      head=1.264 (0.0%)  headB=1.230 (-2.6%)  matrix=1.268 (0.4%)  ops=1.267 (0.2%)  medfcp=1.264 (-0.0%)
medium   head=1.740 (0.0%)  headB=1.769 (1.7%)  matrix=1.708 (-1.8%)  ops=1.741 (0.1%)  medfcp=1.738 (-0.1%)
high     head=1.904 (0.0%)  headB=1.899 (-0.2%)  matrix=1.870 (-1.8%)  ops=1.947 (2.3%)  medfcp=1.888 (-0.8%)
ultra    head=2.138 (0.0%)  headB=2.168 (1.4%)  matrix=2.127 (-0.5%)  ops=2.133 (-0.2%)  medfcp=2.138 (0.0%)

diagnostic only: msir2a log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=0.4%  matrix=-1.7%  medfcp=-0.4%  ops=-0.4%  | pos1..: 1.8 0.4 0.6 0.9
low     headB=-1.0%  matrix=-2.0%  medfcp=-0.8%  ops=-0.7%  | pos1..: 0.7 -0.0 -0.8 0.3
medium  headB=1.7%  matrix=-2.2%  medfcp=-1.0%  ops=-0.9%  | pos1..: 2.0 1.1 0.8 1.3
high    headB=-0.5%  matrix=-1.9%  medfcp=-1.0%  ops=0.4%  | pos1..: 1.7 0.6 0.7 1.4
ultra   headB=1.3%  matrix=-0.7%  medfcp=1.4%  ops=-0.3%  | pos1..: 2.7 -0.1 1.6 0.4
diagnostic only: msir2a log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=0.5%  matrix=-1.5%  medfcp=-0.3%  ops=-0.3%  | pos1..: 1.7 0.6 1.0 0.7
low     headB=-1.1%  matrix=-2.4%  medfcp=-0.2%  ops=-0.1%  | pos1..: 1.0 0.2 -0.3 -0.2
medium  headB=2.0%  matrix=-2.1%  medfcp=-1.1%  ops=-0.7%  | pos1..: 2.5 1.5 1.7 1.5
high    headB=-0.2%  matrix=-1.4%  medfcp=-1.1%  ops=0.5%  | pos1..: 1.5 0.8 1.1 1.0
ultra   headB=1.5%  matrix=-0.3%  medfcp=1.3%  ops=-1.0%  | pos1..: 1.7 -0.0 1.3 0.3

== headB vs head
| preset | scenario | calls | programs | fight hashes equal |
| low | fight | 213.75 → 213.75 | 23 → 23 | 20/20 |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 20/20 |
| high | fight | 305 → 305 | 56.5 → 56.5 | 20/20 |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 20/20 |
== matrix vs head
| preset | scenario | calls | programs | fight hashes equal |
| low | fight | 213.75 → 213.75 | 23 → 23 | 20/20 |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 20/20 |
| high | fight | 305 → 305 | 56.5 → 56.5 | 20/20 |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 20/20 |
== ops vs head
| preset | scenario | calls | programs | fight hashes equal |
| low | fight | 213.75 → 213.75 | 23 → 23 | 20/20 |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 20/20 |
| high | fight | 305 → 305 | 56.5 → 56.5 | 20/20 |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 20/20 |
== medfcp vs head
| preset | scenario | calls | programs | fight hashes equal |
| low | fight | 213.75 → 213.75 | 23 → 23 | 20/20 |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 20/20 |
| high | fight | 305 → 305 | 56.5 → 56.5 | 20/20 |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 20/20 |
```

## msir2b (MSI final verification: head, headB, matrix, prer1 = 5423a85's game tree; 4 x 4 x 4 rounds; 05:29-06:09)

ab-final.mjs prer1 below is head (round 1 only) vs prer1; the final tree (matrix) vs prer1 is the "matrix vs prer1" table after it (a scratch helper, the same paired geomeans as perf/ab-pair.mjs msir2b matrix prer1).

```
msir2b mean both: vs pooled HEAD (raw / posfit); HEAD copies headB

all  pool=head+headB  N_p=2.00%  copies: headB/head +0.45% / +0.45%
  matrix   -1.23% / -1.23%
  prer1    +0.68% / +0.68%

low  pool=head+headB  N_p=2.00%  copies: headB/head +0.73% / +0.73%
  matrix   -1.45% / -1.45%
  prer1    +0.56% / +0.56%

medium  pool=head+headB  N_p=2.00%  copies: headB/head +1.91% / +1.91%
  matrix   -0.93% / -0.93%
  prer1    +0.37% / +0.37%

high  pool=head+headB  N_p=2.00%  copies: headB/head -1.19% / -1.19%
  matrix   -0.73% / -0.73%
  prer1    +1.35% / +1.35%

ultra  pool=head+headB  N_p=2.00%  copies: headB/head +0.35% / +0.35%
  matrix   -1.79% / -1.79%
  prer1    +0.46% / +0.46%
## mean: geomean (paired ratio vs head)
all      head=1.190 (0.0%)  headB=1.195 (0.4%)  matrix=1.178 (-1.0%)  prer1=1.201 (0.9%)
low      head=0.785 (0.0%)  headB=0.790 (0.7%)  matrix=0.776 (-1.1%)  prer1=0.792 (0.9%)
medium   head=1.198 (0.0%)  headB=1.221 (1.9%)  matrix=1.198 (0.0%)  prer1=1.214 (1.3%)
high     head=1.366 (0.0%)  headB=1.349 (-1.2%)  matrix=1.348 (-1.3%)  prer1=1.376 (0.7%)
ultra    head=1.561 (0.0%)  headB=1.566 (0.3%)  matrix=1.536 (-1.6%)  prer1=1.571 (0.6%)

diagnostic only: msir2b log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=0.4%  matrix=-1.0%  prer1=0.9%  | pos1..: 0.6 -0.0 0.1
low     headB=0.7%  matrix=-1.1%  prer1=0.9%  | pos1..: -0.1 0.2 -0.8
medium  headB=1.9%  matrix=0.0%  prer1=1.3%  | pos1..: 1.6 -0.3 -0.5
high    headB=-1.2%  matrix=-1.3%  prer1=0.7%  | pos1..: -0.3 0.5 1.3
ultra   headB=0.3%  matrix=-1.6%  prer1=0.6%  | pos1..: 1.3 -0.6 0.5
== matrix (final) vs prer1
base prer1, tags msir2b: 128 cell-scenario-rounds, control headB

## path + fight: prer1 → FINAL (head); change = head/prer1 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 32 | 0.792 → 0.785 (-0.9 %) | 0.731 → 0.724 (-0.9 %) | 1.253 → 1.253 (-0.0 %) | 1.874 → 1.824 (-2.7 %) | 0.562 → 0.558 (-0.7 %) | 14/32 | +0.7 % / -0.4 % / -0.1 % / +1.9 % |
| medium | 32 | 1.214 → 1.198 (-1.3 %) | 1.109 → 1.092 (-1.6 %) | 1.742 → 1.723 (-1.1 %) | 3.157 → 2.976 (-5.7 %) | 0.956 → 0.942 (-1.4 %) | 16/32 | +1.9 % / +2.0 % / +2.3 % / +5.7 % |
| high | 32 | 1.376 → 1.366 (-0.7 %) | 1.185 → 1.173 (-1.0 %) | 1.916 → 1.951 (+1.8 %) | 5.150 → 5.173 (+0.4 %) | 1.119 → 1.101 (-1.6 %) | 19/32 | -1.2 % / -1.4 % / -4.0 % / -7.4 % |
| ultra | 32 | 1.571 → 1.561 (-0.6 %) | 1.235 → 1.238 (+0.3 %) | 2.136 → 2.124 (-0.6 %) | 6.897 → 6.743 (-2.2 %) | 1.284 → 1.277 (-0.5 %) | 20/32 | +0.3 % / +0.4 % / +1.3 % / -2.1 % |
| all | 128 | 1.201 → 1.190 (-0.9 %) | 1.044 → 1.035 (-0.8 %) | 1.729 → 1.730 (+0.0 %) | 3.807 → 3.709 (-2.6 %) | 0.937 → 0.927 (-1.1 %) | 69/128 | +0.4 % / +0.1 % / -0.1 % / -0.6 % |

## path: prer1 → FINAL (head); change = head/prer1 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 16 | 0.401 → 0.396 (-1.4 %) | 0.374 → 0.367 (-1.8 %) | 0.612 → 0.609 (-0.5 %) | 0.933 → 0.891 (-4.5 %) | 0.312 → 0.310 (-0.8 %) | 9/16 | +1.8 % / -0.7 % / +0.7 % / +2.7 % |
| medium | 16 | 0.719 → 0.714 (-0.7 %) | 0.643 → 0.633 (-1.5 %) | 0.934 → 0.930 (-0.5 %) | 2.147 → 1.975 (-8.0 %) | 0.614 → 0.607 (-1.1 %) | 8/16 | +2.0 % / +2.3 % / +3.5 % / +6.9 % |
| high | 16 | 0.876 → 0.871 (-0.6 %) | 0.690 → 0.674 (-2.3 %) | 1.105 → 1.134 (+2.7 %) | 5.662 → 5.708 (+0.8 %) | 0.773 → 0.768 (-0.7 %) | 9/16 | -1.3 % / -0.2 % / -6.7 % / -13.8 % |
| ultra | 16 | 1.114 → 1.102 (-1.1 %) | 0.729 → 0.730 (+0.1 %) | 1.323 → 1.318 (-0.4 %) | 9.903 → 9.604 (-3.0 %) | 1.005 → 0.997 (-0.8 %) | 10/16 | +0.3 % / +0.0 % / +1.7 % / -2.7 % |
| all | 64 | 0.728 → 0.722 (-0.9 %) | 0.590 → 0.582 (-1.4 %) | 0.956 → 0.959 (+0.3 %) | 3.255 → 3.134 (-3.7 %) | 0.621 → 0.616 (-0.8 %) | 36/64 | +0.7 % / +0.3 % / -0.3 % / -2.0 % |

## fight: prer1 → FINAL (head); change = head/prer1 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 16 | 1.564 → 1.557 (-0.5 %) | 1.430 → 1.430 (+0.0 %) | 2.566 → 2.578 (+0.4 %) | 3.764 → 3.733 (-0.8 %) | 1.011 → 1.005 (-0.6 %) | 5/16 | -0.3 % / +0.0 % / -0.8 % / +1.0 % |
| medium | 16 | 2.049 → 2.010 (-1.9 %) | 1.913 → 1.883 (-1.6 %) | 3.249 → 3.195 (-1.7 %) | 4.643 → 4.486 (-3.4 %) | 1.488 → 1.462 (-1.8 %) | 8/16 | +1.8 % / +1.6 % / +1.1 % / +4.6 % |
| high | 16 | 2.160 → 2.140 (-0.9 %) | 2.034 → 2.040 (+0.3 %) | 3.324 → 3.357 (+1.0 %) | 4.685 → 4.687 (+0.0 %) | 1.619 → 1.578 (-2.5 %) | 10/16 | -1.0 % / -2.6 % / -1.2 % / -0.6 % |
| ultra | 16 | 2.214 → 2.211 (-0.1 %) | 2.093 → 2.102 (+0.5 %) | 3.451 → 3.422 (-0.8 %) | 4.804 → 4.734 (-1.4 %) | 1.641 → 1.636 (-0.3 %) | 10/16 | +0.4 % / +0.7 % / +0.9 % / -1.5 % |
| all | 64 | 1.979 → 1.961 (-0.9 %) | 1.847 → 1.843 (-0.2 %) | 3.127 → 3.119 (-0.3 %) | 4.453 → 4.391 (-1.4 %) | 1.414 → 1.396 (-1.3 %) | 33/64 | +0.2 % / -0.1 % / -0.0 % / +0.8 % |

## counts per preset and scenario: draw calls (median of per-run medians), programs (median); prer1 → FINAL
| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 23 → 23 |  |
| low | fight | 213.75 → 213.75 | 23 → 23 | 16/16 |
| medium | path | 142.5 → 142.5 | 54.5 → 54.5 |  |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 16/16 |
| high | path | 199.5 → 199.5 | 56.5 → 56.5 |  |
| high | fight | 305 → 305 | 56.5 → 56.5 | 16/16 |
| ultra | path | 230.5 → 230.5 | 58.5 → 58.5 |  |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 16/16 |

matrix vs prer1 (path+fight): frame mean / median / p95, matrix faster (mean)
low     -2.0 % / +1.4 % / -2.0 %  24/32
medium  -1.3 % / -1.0 % / -1.1 %  17/32
high    -2.0 % / -0.3 % / +2.1 %  22/32
ultra   -2.2 % / -2.1 % / -1.4 %  23/32
all     -1.9 % / -0.5 % / -0.6 %  86/128

matrix vs prer1 (path): frame mean / median / p95, matrix faster (mean)
low     -1.5 % / +4.4 % / -2.3 %  11/16
medium  -0.9 % / -0.6 % / -0.8 %  8/16
high    -1.5 % / +2.0 % / +4.9 %  11/16
ultra   -3.2 % / -2.8 % / -1.6 %  14/16
all     -1.8 % / +0.7 % / +0.0 %  44/64

matrix vs prer1 (fight): frame mean / median / p95, matrix faster (mean)
low     -2.5 % / -1.6 % / -1.6 %  13/16
medium  -1.7 % / -1.5 % / -1.4 %  9/16
high    -2.6 % / -2.5 % / -0.7 %  11/16
ultra   -1.3 % / -1.3 % / -1.2 %  9/16
all     -2.0 % / -1.7 % / -1.2 %  42/64
```

## macr2 (Mac: head, headB, matrix, prer1; 4 x 4 x 4 rounds; 05:28-06:31, perf/powered.sh, PERF_MIN_BATT=50)

```
macr2 mean both: vs pooled HEAD (raw / posfit); HEAD copies headB

all  pool=head+headB  N_p=2.00%  copies: headB/head -0.20% / -0.20%
  matrix   -0.25% / -0.25%
  prer1    +0.02% / +0.02%

low  pool=head+headB  N_p=2.00%  copies: headB/head +0.12% / +0.12%
  matrix   -0.57% / -0.57%
  prer1    -0.08% / -0.08%

medium  pool=head+headB  N_p=2.00%  copies: headB/head -0.73% / -0.73%
  matrix   -0.49% / -0.49%
  prer1    -0.02% / -0.02%

high  pool=head+headB  N_p=2.00%  copies: headB/head -0.12% / -0.12%
  matrix   +0.08% / +0.08%
  prer1    +0.28% / +0.28%

ultra  pool=head+headB  N_p=2.00%  copies: headB/head -0.08% / -0.08%
  matrix   -0.03% / -0.03%
  prer1    -0.11% / -0.11%
HEAD 216bbb8a6204fbb748f01877c4305ef6343a1369  variants: head, headB, matrix, prer1  (2026-10-20T20:28:19.045Z)
complete: 4 variants x 128 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.520 (0.0%)  headB=2.515 (-0.2%)  matrix=2.511 (-0.4%)  prer1=2.518 (-0.1%)
low      head=1.597 (0.0%)  headB=1.598 (0.1%)  matrix=1.588 (-0.5%)  prer1=1.596 (-0.0%)
medium   head=2.290 (0.0%)  headB=2.273 (-0.7%)  matrix=2.271 (-0.9%)  prer1=2.281 (-0.4%)
high     head=2.954 (0.0%)  headB=2.950 (-0.1%)  matrix=2.954 (0.0%)  prer1=2.960 (0.2%)
ultra    head=3.733 (0.0%)  headB=3.730 (-0.1%)  matrix=3.730 (-0.1%)  prer1=3.727 (-0.2%)

## med: geomean (paired ratio vs head)
all      head=2.628 (0.0%)  headB=2.625 (-0.1%)  matrix=2.614 (-0.5%)  prer1=2.620 (-0.3%)
low      head=1.706 (0.0%)  headB=1.704 (-0.1%)  matrix=1.674 (-1.8%)  prer1=1.701 (-0.3%)
medium   head=2.461 (0.0%)  headB=2.454 (-0.3%)  matrix=2.447 (-0.5%)  prer1=2.449 (-0.5%)
high     head=3.126 (0.0%)  headB=3.125 (-0.0%)  matrix=3.133 (0.2%)  prer1=3.121 (-0.2%)
ultra    head=3.632 (0.0%)  headB=3.635 (0.1%)  matrix=3.635 (0.1%)  prer1=3.625 (-0.2%)

## p95: geomean (paired ratio vs head)
all      head=3.938 (0.0%)  headB=3.933 (-0.1%)  matrix=3.937 (-0.0%)  prer1=3.932 (-0.2%)
low      head=2.868 (0.0%)  headB=2.877 (0.3%)  matrix=2.890 (0.8%)  prer1=2.865 (-0.1%)
medium   head=3.643 (0.0%)  headB=3.617 (-0.7%)  matrix=3.613 (-0.8%)  prer1=3.627 (-0.4%)
high     head=4.366 (0.0%)  headB=4.383 (0.4%)  matrix=4.396 (0.7%)  prer1=4.365 (-0.0%)
ultra    head=5.274 (0.0%)  headB=5.246 (-0.5%)  matrix=5.237 (-0.7%)  prer1=5.270 (-0.1%)
diagnostic only: macr2 log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-0.2%  matrix=-0.4%  prer1=-0.1%  | pos1..: 0.1 0.3 0.5
low     headB=0.1%  matrix=-0.5%  prer1=-0.0%  | pos1..: -0.0 0.1 0.1
medium  headB=-0.7%  matrix=-0.9%  prer1=-0.4%  | pos1..: -0.4 0.1 0.5
high    headB=-0.1%  matrix=0.0%  prer1=0.2%  | pos1..: 0.5 0.6 1.1
ultra   headB=-0.1%  matrix=-0.1%  prer1=-0.2%  | pos1..: 0.3 0.3 0.2
diagnostic only: macr2 log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-0.2%  matrix=-0.5%  prer1=-0.1%  | pos1..: 0.2 0.6 0.7
low     headB=-0.1%  matrix=-1.0%  prer1=-0.4%  | pos1..: -0.4 0.4 0.3
medium  headB=-0.5%  matrix=-1.2%  prer1=-0.4%  | pos1..: -0.0 0.6 0.9
high    headB=-0.0%  matrix=0.1%  prer1=0.5%  | pos1..: 0.5 0.7 1.4
ultra   headB=-0.1%  matrix=-0.1%  prer1=-0.1%  | pos1..: 0.6 0.6 0.2
== prer1 -> head (round 1's High change)
## path + fight: prer1 → FINAL (head); change = head/prer1 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 32 | 1.596 → 1.597 (+0.0 %) | 1.701 → 1.706 (+0.3 %) | 2.865 → 2.868 (+0.1 %) | 3.911 → 3.922 (+0.3 %) | 1.332 → 1.332 (-0.0 %) | 17/32 | +0.1 % / -0.1 % / +0.3 % / -0.8 % |
| medium | 32 | 2.281 → 2.290 (+0.4 %) | 2.449 → 2.461 (+0.5 %) | 3.627 → 3.643 (+0.4 %) | 5.172 → 5.178 (+0.1 %) | 1.939 → 1.950 (+0.6 %) | 11/32 | -0.7 % / -0.3 % / -0.7 % / -1.1 % |
| high | 32 | 2.960 → 2.954 (-0.2 %) | 3.121 → 3.126 (+0.2 %) | 4.365 → 4.366 (+0.0 %) | 5.912 → 5.988 (+1.3 %) | 2.582 → 2.571 (-0.4 %) | 17/32 | -0.1 % / -0.0 % / +0.4 % / -0.0 % |
| ultra | 32 | 3.727 → 3.733 (+0.2 %) | 3.625 → 3.632 (+0.2 %) | 5.270 → 5.274 (+0.1 %) | 7.078 → 6.980 (-1.4 %) | 3.288 → 3.304 (+0.5 %) | 11/32 | -0.1 % / +0.1 % / -0.5 % / +1.0 % |
| all | 128 | 2.518 → 2.520 (+0.1 %) | 2.620 → 2.628 (+0.3 %) | 3.932 → 3.938 (+0.2 %) | 5.394 → 5.398 (+0.1 %) | 2.164 → 2.167 (+0.1 %) | 56/128 | -0.2 % / -0.1 % / -0.1 % / -0.2 % |


matrix vs prer1 (path+fight): frame mean / median / p95, matrix faster (mean)
low     -0.5 % / -1.6 % / +0.9 %  19/32
medium  -0.5 % / -0.1 % / -0.4 %  15/32
high    -0.2 % / +0.4 % / +0.7 %  20/32
ultra   +0.1 % / +0.3 % / -0.6 %  13/32
all     -0.3 % / -0.2 % / +0.1 %  67/128
| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 23 → 23 |  |
| low | fight | 213.75 → 213.75 | 23 → 23 | 16/16 |
| medium | path | 142.5 → 142.5 | 54.5 → 54.5 |  |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 16/16 |
| high | path | 199.5 → 199.5 | 56.5 → 56.5 |  |
| high | fight | 305 → 305 | 56.5 → 56.5 | 16/16 |
| ultra | path | 230.5 → 230.5 | 58.5 → 58.5 |  |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 16/16 |
```

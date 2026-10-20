# MSI round 1 — printed A/B tables

Keep rule and its amendment (written before the numbers they govern):

    # MSI round 1 keep rule (written 02:20, before any job-1 number was read)
    Metric: frame mean, path + fight, paired geomean ratio vs head per preset (ab-agg), and ab-posfit (mean, both).
    Same-code arms per preset (HEAD copies): headB everywhere; cpuhm on Low and Ultra; low1 on Medium, High, Ultra.
    Noise line N_p = max(2 %, largest |change| of the same-code arms on preset p (raw or posfit)).
    Job 1 (screen) pass: on a preset the candidate targets, raw AND posfit <= -N_p, every fight state hash equal to head's.
    KEEP (per candidate, per preset it changes):
     (a) MSI: job 1 pass AND job 2 (confirm) raw and posfit <= -N_p(job 2), job 2 control |headB| <= 2.4 % (step 1's range);
     (b) Mac: kept set vs head, raw and posfit, no preset slower than +max(2 %, |Mac control|) on any preset;
     (c) pixels: Mac compare baseline + msi-r1-pre, MSI compare msi-baseline + msi-final: PASS, and 0 changed px vs the
         pre-round tree (or each px explained, SSIM >= 0.995);
     plus the programs-after-ready sweep for anything that adds a program (low1: Low --check zero, done on the Mac: PASS).
    A candidate that fails (a) on all its presets is rejected; per-preset gating (e.g. cpuhm on Medium only) is allowed only
    where the code already has a per-preset switch (fightCpuPaths).
    
    ## Amendment (03:25, after review 1, before any job-2 or Mac number was read)
    - ops was not in job 1: job 2 is only its screen. Under this rule it cannot be KEPT this round (no confirmation run
      left: 2 MSI jobs max). If it passes the screen it is the first Round 2 candidate. The set measured on the Mac
      contains ops: the Mac result is then for a superset, and the kept set is checked by job 2's per-candidate arms.
    - A candidate without a per-preset switch (matrix, low1's code path is Low-only by itself) is kept as a whole if it
      passes (a) on at least one preset in both jobs and reads no slowdown past N_p on any preset in either MSI job and
      on the Mac.
    - low1 fix (review 1 P1): merge only after the menu warm-up has drawn the flat probe for the look in force
      (`_flatWarm`); exact by construction (otherwise HEAD's per-part draws). Re-captured and re-tested before the commit.

## msir1a (MSI job 1: head, headB, cpuhm, matrix, hud, low1, c1; 4 maps x 4 presets x 3 rounds, path + fight, --no-trace)

```
HEAD 5423a85cd10677602761ad3d79c0266066d64415  variants: head, headB, cpuhm, matrix, hud, low1, c1  (2026-10-20T17:15:34.393Z)
complete: 7 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=1.207 (0.0%)  headB=1.202 (-0.4%)  cpuhm=1.187 (-1.7%)  matrix=1.184 (-1.9%)  hud=1.196 (-0.9%)  low1=1.194 (-1.1%)  c1=1.207 (-0.0%)
low      head=0.793 (0.0%)  headB=0.783 (-1.4%)  cpuhm=0.781 (-1.5%)  matrix=0.783 (-1.2%)  hud=0.785 (-1.1%)  low1=0.771 (-2.9%)  c1=0.795 (0.2%)
medium   head=1.229 (0.0%)  headB=1.204 (-2.0%)  cpuhm=1.190 (-3.2%)  matrix=1.187 (-3.4%)  hud=1.216 (-1.0%)  low1=1.200 (-2.4%)  c1=1.222 (-0.6%)
high     head=1.390 (0.0%)  headB=1.413 (1.7%)  cpuhm=1.347 (-3.1%)  matrix=1.381 (-0.7%)  hud=1.386 (-0.3%)  low1=1.387 (-0.3%)  c1=1.401 (0.7%)
ultra    head=1.567 (0.0%)  headB=1.566 (-0.1%)  cpuhm=1.587 (1.3%)  matrix=1.532 (-2.2%)  hud=1.545 (-1.4%)  low1=1.585 (1.2%)  c1=1.558 (-0.5%)

## med: geomean (paired ratio vs head)
all      head=1.059 (0.0%)  headB=1.043 (-1.5%)  cpuhm=1.031 (-2.7%)  matrix=1.039 (-1.9%)  hud=1.044 (-1.5%)  low1=1.050 (-0.9%)  c1=1.060 (0.1%)
low      head=0.748 (0.0%)  headB=0.715 (-4.4%)  cpuhm=0.717 (-4.2%)  matrix=0.742 (-0.9%)  hud=0.719 (-3.9%)  low1=0.736 (-1.7%)  c1=0.732 (-2.2%)
medium   head=1.129 (0.0%)  headB=1.088 (-3.7%)  cpuhm=1.086 (-3.8%)  matrix=1.070 (-5.2%)  hud=1.102 (-2.4%)  low1=1.090 (-3.5%)  c1=1.109 (-1.8%)
high     head=1.205 (0.0%)  headB=1.232 (2.2%)  cpuhm=1.160 (-3.7%)  matrix=1.215 (0.8%)  hud=1.225 (1.6%)  low1=1.219 (1.2%)  c1=1.254 (4.0%)
ultra    head=1.236 (0.0%)  headB=1.234 (-0.1%)  cpuhm=1.251 (1.2%)  matrix=1.207 (-2.3%)  hud=1.223 (-1.0%)  low1=1.243 (0.6%)  c1=1.239 (0.3%)

## p95: geomean (paired ratio vs head)
all      head=1.756 (0.0%)  headB=1.737 (-1.1%)  cpuhm=1.710 (-2.6%)  matrix=1.736 (-1.2%)  hud=1.735 (-1.2%)  low1=1.723 (-1.9%)  c1=1.751 (-0.3%)
low      head=1.251 (0.0%)  headB=1.251 (0.0%)  cpuhm=1.238 (-1.0%)  matrix=1.260 (0.7%)  hud=1.239 (-1.0%)  low1=1.229 (-1.7%)  c1=1.247 (-0.4%)
medium   head=1.767 (0.0%)  headB=1.737 (-1.7%)  cpuhm=1.717 (-2.8%)  matrix=1.748 (-1.1%)  hud=1.721 (-2.6%)  low1=1.722 (-2.6%)  c1=1.761 (-0.4%)
high     head=1.977 (0.0%)  headB=1.976 (-0.0%)  cpuhm=1.883 (-4.8%)  matrix=1.948 (-1.5%)  hud=1.968 (-0.4%)  low1=1.943 (-1.7%)  c1=1.980 (0.2%)
ultra    head=2.178 (0.0%)  headB=2.120 (-2.7%)  cpuhm=2.137 (-1.9%)  matrix=2.114 (-2.9%)  hud=2.160 (-0.8%)  low1=2.141 (-1.7%)  c1=2.163 (-0.7%)

diagnostic only: msir1a log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     c1=-0.1%  cpuhm=-1.7%  headB=-0.4%  hud=-1.1%  low1=-1.2%  matrix=-2.0%  | pos1..: 1.1 0.1 -0.2 -0.5 0.5 0.4
low     c1=0.1%  cpuhm=-1.7%  headB=-1.5%  hud=-1.4%  low1=-3.1%  matrix=-1.6%  | pos1..: 1.8 0.4 0.4 -0.2 0.9 0.2
medium  c1=-0.8%  cpuhm=-2.9%  headB=-1.7%  hud=-1.2%  low1=-2.7%  matrix=-3.3%  | pos1..: 2.1 1.6 1.1 -0.0 0.6 0.7
high    c1=0.4%  cpuhm=-3.5%  headB=1.7%  hud=-1.4%  low1=-1.1%  matrix=-1.5%  | pos1..: -1.4 -1.8 -3.4 -2.4 -0.2 -0.9
ultra   c1=-0.7%  cpuhm=1.4%  headB=0.1%  hud=-1.5%  low1=1.0%  matrix=-2.1%  | pos1..: 1.3 -0.4 0.6 -0.0 0.3 1.5

diagnostic only: msir1a log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     c1=0.0%  cpuhm=-1.5%  headB=-0.5%  hud=-1.7%  low1=-1.3%  matrix=-1.6%  | pos1..: 0.5 0.3 -0.4 -0.7 0.3 0.3
low     c1=-0.4%  cpuhm=-1.3%  headB=-1.1%  hud=-1.6%  low1=-2.4%  matrix=-0.8%  | pos1..: 1.5 0.7 -0.2 -0.5 1.2 0.7
medium  c1=0.4%  cpuhm=-3.2%  headB=-2.7%  hud=-1.6%  low1=-2.7%  matrix=-2.6%  | pos1..: 1.1 1.7 1.9 0.1 0.8 1.7
high    c1=0.4%  cpuhm=-3.0%  headB=1.6%  hud=-2.8%  low1=-1.7%  matrix=-1.2%  | pos1..: -2.0 -2.0 -4.9 -2.7 -0.9 -2.0
ultra   c1=-0.3%  cpuhm=1.3%  headB=0.5%  hud=-1.4%  low1=1.2%  matrix=-2.2%  | pos1..: 0.7 -0.0 0.9 0.0 -0.0 0.9

| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 23 → 23 |  |
| low | fight | 213.75 → 213.75 | 23 → 23 | 12/12 |
| medium | path | 142.5 → 142.5 | 54.5 → 54.5 |  |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 12/12 |
| high | path | 199.5 → 199.5 | 56.5 → 56.5 |  |
| high | fight | 305 → 305 | 56.5 → 56.5 | 12/12 |
| ultra | path | 230.5 → 230.5 | 58.5 → 58.5 |  |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 12/12 |
```

## msir1b (MSI job 2: head, headB, cpuhm, matrix, low1, ops, set = cpuhm+matrix+low1+ops)

```
HEAD 5423a85cd10677602761ad3d79c0266066d64415  variants: head, headB, cpuhm, matrix, low1, ops, set  (2026-10-20T18:11:19.865Z)
complete: 7 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=1.206 (0.0%)  headB=1.200 (-0.4%)  cpuhm=1.192 (-1.2%)  matrix=1.177 (-2.4%)  low1=1.194 (-1.0%)  ops=1.193 (-1.1%)  set=1.164 (-3.5%)
low      head=0.795 (0.0%)  headB=0.779 (-2.0%)  cpuhm=0.789 (-0.8%)  matrix=0.781 (-1.7%)  low1=0.785 (-1.2%)  ops=0.795 (0.0%)  set=0.764 (-3.9%)
medium   head=1.226 (0.0%)  headB=1.233 (0.5%)  cpuhm=1.196 (-2.5%)  matrix=1.189 (-3.1%)  low1=1.195 (-2.6%)  ops=1.217 (-0.8%)  set=1.174 (-4.3%)
high     head=1.400 (0.0%)  headB=1.378 (-1.6%)  cpuhm=1.357 (-3.1%)  matrix=1.351 (-3.5%)  low1=1.387 (-0.9%)  ops=1.379 (-1.5%)  set=1.330 (-5.0%)
ultra    head=1.549 (0.0%)  headB=1.569 (1.3%)  cpuhm=1.576 (1.8%)  matrix=1.532 (-1.1%)  low1=1.562 (0.8%)  ops=1.518 (-2.0%)  set=1.537 (-0.8%)

## med: geomean (paired ratio vs head)
all      head=1.057 (0.0%)  headB=1.045 (-1.2%)  cpuhm=1.033 (-2.3%)  matrix=1.024 (-3.1%)  low1=1.041 (-1.5%)  ops=1.048 (-0.9%)  set=1.018 (-3.7%)
low      head=0.740 (0.0%)  headB=0.720 (-2.7%)  cpuhm=0.722 (-2.5%)  matrix=0.721 (-2.5%)  low1=0.710 (-4.1%)  ops=0.750 (1.4%)  set=0.717 (-3.2%)
medium   head=1.120 (0.0%)  headB=1.128 (0.7%)  cpuhm=1.083 (-3.3%)  matrix=1.081 (-3.5%)  low1=1.088 (-2.9%)  ops=1.114 (-0.5%)  set=1.079 (-3.6%)
high     head=1.236 (0.0%)  headB=1.180 (-4.5%)  cpuhm=1.173 (-5.1%)  matrix=1.175 (-4.9%)  low1=1.230 (-0.4%)  ops=1.205 (-2.5%)  set=1.152 (-6.8%)
ultra    head=1.221 (0.0%)  headB=1.243 (1.8%)  cpuhm=1.241 (1.6%)  matrix=1.201 (-1.6%)  low1=1.238 (1.4%)  ops=1.199 (-1.8%)  set=1.205 (-1.3%)

## p95: geomean (paired ratio vs head)
all      head=1.752 (0.0%)  headB=1.727 (-1.4%)  cpuhm=1.758 (0.3%)  matrix=1.707 (-2.5%)  low1=1.725 (-1.5%)  ops=1.738 (-0.8%)  set=1.703 (-2.8%)
low      head=1.270 (0.0%)  headB=1.243 (-2.1%)  cpuhm=1.260 (-0.8%)  matrix=1.264 (-0.5%)  low1=1.239 (-2.4%)  ops=1.269 (-0.0%)  set=1.206 (-5.0%)
medium   head=1.751 (0.0%)  headB=1.758 (0.4%)  cpuhm=1.761 (0.6%)  matrix=1.719 (-1.8%)  low1=1.734 (-0.9%)  ops=1.762 (0.7%)  set=1.730 (-1.2%)
high     head=1.957 (0.0%)  headB=1.896 (-3.1%)  cpuhm=1.976 (1.0%)  matrix=1.878 (-4.0%)  low1=1.917 (-2.0%)  ops=1.944 (-0.7%)  set=1.894 (-3.2%)
ultra    head=2.165 (0.0%)  headB=2.146 (-0.8%)  cpuhm=2.177 (0.6%)  matrix=2.082 (-3.8%)  low1=2.148 (-0.8%)  ops=2.098 (-3.1%)  set=2.131 (-1.6%)

diagnostic only: msir1b log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     cpuhm=-1.0%  headB=-0.4%  low1=-0.9%  matrix=-2.2%  ops=-1.0%  set=-3.5%  | pos1..: 0.1 1.0 0.0 0.6 0.0 -0.1
low     cpuhm=-0.2%  headB=-1.8%  low1=-0.5%  matrix=-0.9%  ops=0.5%  set=-3.8%  | pos1..: -1.2 1.4 1.2 1.2 1.2 2.0
medium  cpuhm=-1.7%  headB=0.9%  low1=-1.8%  matrix=-2.2%  ops=-0.5%  set=-4.3%  | pos1..: 0.6 1.6 1.2 2.9 -0.5 -0.4
high    cpuhm=-2.7%  headB=-1.2%  low1=-1.2%  matrix=-3.3%  ops=-2.0%  set=-5.3%  | pos1..: -0.1 0.7 -1.5 -2.5 -0.6 -0.8
ultra   cpuhm=2.0%  headB=1.4%  low1=1.0%  matrix=-0.8%  ops=-2.0%  set=-0.8%  | pos1..: 0.9 -0.4 -1.6 0.2 -0.2 -1.2

diagnostic only: msir1b log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     cpuhm=-0.6%  headB=0.5%  low1=-0.6%  matrix=-2.0%  ops=-1.6%  set=-4.0%  | pos1..: -0.5 0.1 -0.9 -0.3 -0.9 -0.8
low     cpuhm=0.7%  headB=0.4%  low1=-0.4%  matrix=-1.1%  ops=0.4%  set=-2.7%  | pos1..: -1.8 0.6 -1.0 -0.5 -0.3 1.1
medium  cpuhm=-1.5%  headB=1.2%  low1=-2.2%  matrix=-2.5%  ops=-0.1%  set=-5.7%  | pos1..: -1.8 -0.3 0.3 1.6 -1.9 -1.4
high    cpuhm=-2.1%  headB=-0.6%  low1=-0.1%  matrix=-2.5%  ops=-3.4%  set=-6.3%  | pos1..: 0.8 0.3 -2.9 -3.8 -2.0 -1.5
ultra   cpuhm=1.6%  headB=1.7%  low1=0.5%  matrix=-1.0%  ops=-3.5%  set=-1.6%  | pos1..: 0.7 -1.1 -1.3 0.8 0.2 -1.5

| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 24 → 23 |  |
| low | fight | 199.75 → 213.75 | 24 → 23 | 12/12 |
| medium | path | 142.5 → 142.5 | 54.5 → 54.5 |  |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 12/12 |
| high | path | 199.5 → 199.5 | 56.5 → 56.5 |  |
| high | fight | 305 → 305 | 56.5 → 56.5 | 12/12 |
| ultra | path | 230.5 → 230.5 | 58.5 → 58.5 |  |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 12/12 |
```

## macr1 (Mac: head, headB, set; the same matrix)

```
HEAD 5423a85cd10677602761ad3d79c0266066d64415  variants: head, headB, set  (2026-10-20T18:17:42.168Z)
complete: 3 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.531 (0.0%)  headB=2.535 (0.2%)  set=2.521 (-0.4%)
low      head=1.590 (0.0%)  headB=1.593 (0.2%)  set=1.578 (-0.8%)
medium   head=2.297 (0.0%)  headB=2.301 (0.2%)  set=2.281 (-0.7%)
high     head=3.020 (0.0%)  headB=3.022 (0.1%)  set=3.010 (-0.3%)
ultra    head=3.724 (0.0%)  headB=3.729 (0.1%)  set=3.726 (0.1%)

## med: geomean (paired ratio vs head)
all      head=2.640 (0.0%)  headB=2.641 (0.0%)  set=2.639 (-0.1%)
low      head=1.697 (0.0%)  headB=1.689 (-0.5%)  set=1.674 (-1.4%)
medium   head=2.461 (0.0%)  headB=2.478 (0.7%)  set=2.473 (0.5%)
high     head=3.205 (0.0%)  headB=3.200 (-0.1%)  set=3.209 (0.2%)
ultra    head=3.631 (0.0%)  headB=3.631 (0.0%)  set=3.650 (0.5%)

## p95: geomean (paired ratio vs head)
all      head=3.958 (0.0%)  headB=3.940 (-0.5%)  set=3.947 (-0.3%)
low      head=2.858 (0.0%)  headB=2.853 (-0.2%)  set=2.849 (-0.3%)
medium   head=3.661 (0.0%)  headB=3.645 (-0.4%)  set=3.667 (0.2%)
high     head=4.437 (0.0%)  headB=4.400 (-0.8%)  set=4.412 (-0.6%)
ultra    head=5.289 (0.0%)  headB=5.268 (-0.4%)  set=5.266 (-0.4%)

diagnostic only: macr1 log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=0.2%  set=-0.4%  | pos1..: 0.3 0.5
low     headB=0.2%  set=-0.8%  | pos1..: -0.1 0.3
medium  headB=0.2%  set=-0.7%  | pos1..: 1.1 1.2
high    headB=0.1%  set=-0.3%  | pos1..: 0.3 0.4
ultra   headB=0.1%  set=0.1%  | pos1..: -0.1 0.0

| preset | scenario | calls | programs | fight hashes equal |
|---|---|---|---|---|
| low | path | 82 → 82 | 24 → 23 |  |
| low | fight | 199.75 → 213.75 | 24 → 23 | 12/12 |
| medium | path | 142.5 → 142.5 | 54.5 → 54.5 |  |
| medium | fight | 226.5 → 226.5 | 54.5 → 54.5 | 12/12 |
| high | path | 199.5 → 199.5 | 56.5 → 56.5 |  |
| high | fight | 305 → 305 | 56.5 → 56.5 | 12/12 |
| ultra | path | 230.5 → 230.5 | 58.5 → 58.5 |  |
| ultra | fight | 346.5 → 346.5 | 58.5 → 58.5 | 12/12 |
```

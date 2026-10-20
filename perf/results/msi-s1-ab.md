# MSI step 1 — printed A/B output (perf/results/msi-s1.md)

Raw per-run JSONs: scratch-msib-*, scratch-msil-* (gitignored; on the MSI in $S/repo/perf/results).

## node perf/ab-final.mjs r0 msib-downtown,msib-house,msib-mexico,msib-training
```
base r0, tags msib-downtown,msib-house,msib-mexico,msib-training: 96 cell-scenario-rounds, control headB

## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 24 | 0.913 → 0.819 (-10.3 %) | 0.841 → 0.755 (-10.2 %) | 1.471 → 1.299 (-11.7 %) | 2.153 → 1.883 (-12.5 %) | 0.632 → 0.582 (-8.0 %) | 22/24 | -2.4 % / +0.1 % / -2.6 % / -0.1 % |
| medium | 24 | 1.481 → 1.213 (-18.1 %) | 1.325 → 1.107 (-16.5 %) | 2.138 → 1.760 (-17.7 %) | 4.377 → 3.145 (-28.2 %) | 1.164 → 0.955 (-18.0 %) | 24/24 | -1.3 % / -2.0 % / -1.5 % / +0.1 % |
| high | 24 | 1.701 → 1.363 (-19.8 %) | 1.449 → 1.194 (-17.6 %) | 2.413 → 1.931 (-20.0 %) | 5.930 → 4.952 (-16.5 %) | 1.374 → 1.102 (-19.8 %) | 24/24 | +0.3 % / +0.7 % / -0.2 % / -3.8 % |
| ultra | 24 | 1.959 → 1.553 (-20.7 %) | 1.525 → 1.226 (-19.6 %) | 2.932 → 2.139 (-27.1 %) | 7.733 → 6.694 (-13.4 %) | 1.610 → 1.272 (-21.0 %) | 24/24 | -0.9 % / -0.5 % / -3.3 % / +0.1 % |
| all | 96 | 1.457 → 1.204 (-17.3 %) | 1.253 → 1.052 (-16.0 %) | 2.172 → 1.753 (-19.3 %) | 4.559 → 3.743 (-17.9 %) | 1.129 → 0.939 (-16.8 %) | 94/96 | -1.1 % / -0.4 % / -1.9 % / -0.9 % |

## path: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 0.452 → 0.414 (-8.4 %) | 0.409 → 0.383 (-6.2 %) | 0.705 → 0.632 (-10.3 %) | 1.069 → 0.918 (-14.1 %) | 0.357 → 0.325 (-9.0 %) | 10/12 | -1.8 % / +3.4 % / -2.4 % / +3.8 % |
| medium | 12 | 0.862 → 0.726 (-15.7 %) | 0.729 → 0.647 (-11.3 %) | 1.140 → 0.963 (-15.5 %) | 3.620 → 2.160 (-40.4 %) | 0.754 → 0.619 (-17.9 %) | 12/12 | -0.4 % / -2.3 % / -0.5 % / +2.0 % |
| high | 12 | 1.052 → 0.876 (-16.7 %) | 0.805 → 0.716 (-11.0 %) | 1.383 → 1.128 (-18.4 %) | 6.477 → 5.266 (-18.7 %) | 0.941 → 0.765 (-18.7 %) | 12/12 | -0.2 % / -0.2 % / -1.0 % / -7.5 % |
| ultra | 12 | 1.341 → 1.104 (-17.7 %) | 0.853 → 0.731 (-14.3 %) | 1.962 → 1.348 (-31.3 %) | 10.206 → 9.430 (-7.6 %) | 1.227 → 0.996 (-18.9 %) | 12/12 | -1.4 % / -0.7 % / -5.4 % / +2.0 % |
| all | 48 | 0.861 → 0.735 (-14.7 %) | 0.672 → 0.600 (-10.7 %) | 1.215 → 0.981 (-19.2 %) | 3.999 → 3.150 (-21.2 %) | 0.747 → 0.626 (-16.2 %) | 46/48 | -0.9 % / +0.0 % / -2.4 % / -0.0 % |

## fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 1.843 → 1.619 (-12.1 %) | 1.730 → 1.486 (-14.1 %) | 3.070 → 2.667 (-13.1 %) | 4.337 → 3.863 (-10.9 %) | 1.118 → 1.041 (-6.9 %) | 12/12 | -3.0 % / -3.2 % / -2.7 % / -3.8 % |
| medium | 12 | 2.545 → 2.026 (-20.4 %) | 2.411 → 1.894 (-21.5 %) | 4.010 → 3.217 (-19.8 %) | 5.291 → 4.579 (-13.5 %) | 1.797 → 1.471 (-18.1 %) | 12/12 | -2.1 % / -1.8 % / -2.4 % / -1.8 % |
| high | 12 | 2.750 → 2.121 (-22.9 %) | 2.608 → 1.991 (-23.6 %) | 4.213 → 3.306 (-21.5 %) | 5.428 → 4.658 (-14.2 %) | 2.006 → 1.586 (-20.9 %) | 12/12 | +0.9 % / +1.7 % / +0.5 % / +0.1 % |
| ultra | 12 | 2.861 → 2.184 (-23.6 %) | 2.728 → 2.057 (-24.6 %) | 4.383 → 3.393 (-22.6 %) | 5.859 → 4.751 (-18.9 %) | 2.111 → 1.625 (-23.0 %) | 12/12 | -0.5 % / -0.2 % / -1.2 % / -1.7 % |
| all | 48 | 2.465 → 1.974 (-19.9 %) | 2.334 → 1.843 (-21.1 %) | 3.883 → 3.132 (-19.3 %) | 5.198 → 4.448 (-14.4 %) | 1.708 → 1.409 (-17.5 %) | 48/48 | -1.2 % / -0.9 % / -1.4 % / -1.8 % |

## counts per preset and scenario: draw calls (median of per-run medians), programs (median); r0 → FINAL
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
```

## per map: node perf/ab-final.mjs r0 msib-<map> (path + fight rows)
```
== downtown
## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 6 | 0.743 → 0.706 (-4.9 %) | 0.648 → 0.663 (+2.3 %) | 1.348 → 1.159 (-14.0 %) | 2.082 → 1.664 (-20.0 %) | 0.451 → 0.443 (-1.8 %) | 5/6 | -5.7 % / -9.5 % / -6.8 % / -3.5 % |
| medium | 6 | 1.237 → 1.045 (-15.5 %) | 0.983 → 0.885 (-10.0 %) | 1.913 → 1.565 (-18.2 %) | 6.169 → 3.863 (-37.4 %) | 0.906 → 0.772 (-14.9 %) | 6/6 | +0.5 % / +0.0 % / -2.5 % / +14.9 % |
| high | 6 | 1.417 → 1.232 (-13.0 %) | 1.095 → 1.000 (-8.7 %) | 2.095 → 1.740 (-16.9 %) | 7.255 → 6.940 (-4.3 %) | 1.097 → 0.958 (-12.6 %) | 6/6 | -0.8 % / -3.0 % / -3.3 % / +1.7 % |
| ultra | 6 | 1.723 → 1.437 (-16.6 %) | 1.140 → 1.010 (-11.4 %) | 2.643 → 1.912 (-27.6 %) | 9.732 → 8.688 (-10.7 %) | 1.367 → 1.159 (-15.2 %) | 6/6 | -0.8 % / +0.0 % / -7.1 % / +0.3 % |
| all | 24 | 1.224 → 1.069 (-12.6 %) | 0.944 → 0.877 (-7.1 %) | 1.944 → 1.567 (-19.4 %) | 5.487 → 4.437 (-19.1 %) | 0.885 → 0.785 (-11.3 %) | 23/24 | -1.7 % / -3.2 % / -5.0 % / +3.1 % |
== house
## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 6 | 0.701 → 0.656 (-6.5 %) | 0.678 → 0.591 (-12.8 %) | 1.126 → 1.030 (-8.5 %) | 1.827 → 1.712 (-6.3 %) | 0.480 → 0.464 (-3.3 %) | 5/6 | -7.2 % / +4.3 % / -7.6 % / -4.0 % |
| medium | 6 | 1.218 → 1.051 (-13.7 %) | 1.131 → 0.950 (-16.0 %) | 1.762 → 1.490 (-15.5 %) | 4.199 → 3.262 (-22.3 %) | 0.949 → 0.826 (-13.0 %) | 6/6 | +0.5 % / +0.0 % / +4.4 % / -10.5 % |
| high | 6 | 1.440 → 1.226 (-14.9 %) | 1.183 → 1.049 (-11.4 %) | 2.018 → 1.727 (-14.4 %) | 6.374 → 5.728 (-10.1 %) | 1.150 → 1.000 (-13.1 %) | 6/6 | +0.8 % / +2.7 % / -0.5 % / -10.5 % |
| ultra | 6 | 1.724 → 1.471 (-14.6 %) | 1.289 → 1.095 (-15.1 %) | 2.583 → 1.946 (-24.7 %) | 9.645 → 8.781 (-9.0 %) | 1.409 → 1.200 (-14.8 %) | 6/6 | +0.0 % / -0.9 % / +0.8 % / +1.6 % |
| all | 24 | 1.207 → 1.056 (-12.5 %) | 1.040 → 0.896 (-13.8 %) | 1.793 → 1.507 (-16.0 %) | 4.660 → 4.094 (-12.2 %) | 0.927 → 0.824 (-11.1 %) | 23/24 | -1.5 % / +1.5 % / -0.8 % / -6.0 % |
== mexico
## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 6 | 0.773 → 0.695 (-10.1 %) | 0.685 → 0.632 (-7.8 %) | 1.190 → 1.110 (-6.7 %) | 1.727 → 1.575 (-8.8 %) | 0.535 → 0.499 (-6.7 %) | 6/6 | +5.8 % / +6.1 % / +6.4 % / +8.9 % |
| medium | 6 | 1.301 → 1.131 (-13.0 %) | 1.175 → 1.077 (-8.3 %) | 1.805 → 1.631 (-9.6 %) | 3.322 → 2.389 (-28.1 %) | 1.027 → 0.905 (-11.8 %) | 6/6 | +0.4 % / -0.9 % / -1.9 % / +5.2 % |
| high | 6 | 1.529 → 1.312 (-14.2 %) | 1.323 → 1.163 (-12.1 %) | 2.146 → 1.844 (-14.1 %) | 5.992 → 5.058 (-15.6 %) | 1.226 → 1.059 (-13.6 %) | 6/6 | +0.6 % / +2.6 % / +2.9 % / -6.8 % |
| ultra | 6 | 1.822 → 1.536 (-15.7 %) | 1.410 → 1.192 (-15.5 %) | 2.920 → 2.150 (-26.4 %) | 8.418 → 8.136 (-3.4 %) | 1.485 → 1.273 (-14.3 %) | 6/6 | +1.1 % / +1.7 % / -3.6 % / -0.4 % |
| all | 24 | 1.294 → 1.122 (-13.3 %) | 1.107 → 0.986 (-11.0 %) | 1.915 → 1.637 (-14.5 %) | 4.125 → 3.527 (-14.5 %) | 1.000 → 0.884 (-11.7 %) | 24/24 | +2.0 % / +2.4 % / +0.9 % / +1.6 % |
== training
## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 6 | 1.727 → 1.399 (-19.0 %) | 1.659 → 1.311 (-21.0 %) | 2.591 → 2.147 (-17.2 %) | 3.269 → 2.803 (-14.3 %) | 1.376 → 1.114 (-19.0 %) | 6/6 | -2.0 % / +0.0 % / -1.6 % / -1.2 % |
| medium | 6 | 2.455 → 1.741 (-29.1 %) | 2.363 → 1.656 (-29.9 %) | 3.433 → 2.521 (-26.5 %) | 4.265 → 3.248 (-23.8 %) | 2.078 → 1.439 (-30.8 %) | 6/6 | -6.3 % / -7.1 % / -5.6 % / -7.3 % |
| high | 6 | 2.681 → 1.743 (-35.0 %) | 2.570 → 1.669 (-35.1 %) | 3.739 → 2.512 (-32.8 %) | 4.462 → 2.991 (-33.0 %) | 2.302 → 1.450 (-37.0 %) | 6/6 | +0.7 % / +0.7 % / +0.0 % / +1.0 % |
| ultra | 6 | 2.722 → 1.790 (-34.2 %) | 2.611 → 1.715 (-34.3 %) | 3.708 → 2.616 (-29.5 %) | 4.525 → 3.235 (-28.5 %) | 2.346 → 1.479 (-36.9 %) | 6/6 | -4.0 % / -2.6 % / -3.1 % / -1.0 % |
| all | 24 | 2.358 → 1.661 (-29.6 %) | 2.264 → 1.579 (-30.3 %) | 3.333 → 2.442 (-26.7 %) | 4.096 → 3.064 (-25.2 %) | 1.982 → 1.362 (-31.3 %) | 24/24 | -2.9 % / -2.3 % / -2.6 % / -2.2 % |
```

## node perf/ab-posfit.mjs msib-<map> mean both
```
== downtown
diagnostic only: msib-downtown log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-1.7%  r0=14.5%  | pos1..: 1.2 1.9
low     headB=-5.7%  r0=5.2%  | pos1..: 4.7 7.4
medium  headB=0.5%  r0=18.3%  | pos1..: -1.0 -0.2
high    headB=-0.8%  r0=15.0%  | pos1..: 0.2 0.5
ultra   headB=-0.8%  r0=19.9%  | pos1..: 1.0 0.2
== house
diagnostic only: msib-house log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-1.5%  r0=14.3%  | pos1..: 0.2 -1.0
low     headB=-7.2%  r0=6.9%  | pos1..: 4.2 -0.9
medium  headB=0.5%  r0=15.9%  | pos1..: -2.6 -2.9
high    headB=0.8%  r0=17.4%  | pos1..: -0.3 -0.9
ultra   headB=0.0%  r0=17.2%  | pos1..: -0.4 0.6
== mexico
diagnostic only: msib-mexico log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=2.0%  r0=15.3%  | pos1..: -1.3 -1.9
low     headB=5.8%  r0=11.2%  | pos1..: -4.5 -6.0
medium  headB=0.4%  r0=15.0%  | pos1..: -0.3 -0.4
high    headB=0.6%  r0=16.6%  | pos1..: -0.3 -0.0
ultra   headB=1.1%  r0=18.6%  | pos1..: -0.1 -1.2
== training
diagnostic only: msib-training log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-2.9%  r0=42.0%  | pos1..: 1.9 -1.4
low     headB=-2.0%  r0=23.4%  | pos1..: 2.2 -2.1
medium  headB=-6.3%  r0=41.0%  | pos1..: 4.8 -0.8
high    headB=0.7%  r0=53.8%  | pos1..: -2.0 -1.9
ultra   headB=-4.0%  r0=52.0%  | pos1..: 2.7 -0.7
```

## node perf/ab-load.mjs msil; node perf/ab-load-count.mjs msil
```
HEAD 36cc1aa7ca30eb2695ee02801d835add3aa46664  variants: head, r0, headB  args: --load-only  (2026-10-20T15:53:15.368Z)
complete: 3 variants x 48 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=3403 (+0.0%)  r0=4008 (+17.8%)  headB=3388 (-0.4%)
low      head=548 (+0.0%)  r0=595 (+8.6%)  headB=537 (-1.8%)
medium   head=5416 (+0.0%)  r0=6933 (+28.0%)  headB=5402 (-0.3%)
high     head=5558 (+0.0%)  r0=7083 (+27.4%)  headB=5591 (+0.6%)
ultra    head=8134 (+0.0%)  r0=8837 (+8.7%)  headB=8119 (-0.2%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=648 (+0.0%)  r0=692 (+6.9%)  headB=641 (-1.0%)
low      head=530 (+0.0%)  r0=569 (+7.3%)  headB=518 (-2.3%)
medium   head=673 (+0.0%)  r0=704 (+4.6%)  headB=662 (-1.6%)
high     head=677 (+0.0%)  r0=736 (+8.8%)  headB=681 (+0.5%)
ultra    head=729 (+0.0%)  r0=779 (+6.9%)  headB=725 (-0.6%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=403  r0=+12  headB=-4
warmups.on             head=645  r0=+22  headB=-5
sky.on                 head=653  r0=+24  headB=-5
bakeLayout.on          head=653  r0=+24  headB=-5
bake.on                head=653  r0=+24  headB=-5
textures.on            head=653  r0=+24  headB=-5
fx.on                  head=653  r0=+24  headB=-5
weapons.on             head=653  r0=+24  headB=-5
operators.on           head=653  r0=+24  headB=-5
props.on               head=653  r0=+24  headB=-5
streaming.on           head=653  r0=+24  headB=-5
effects.on             head=653  r0=+24  headB=-5
weaponsReady.on        head=653  r0=+24  headB=-5
enteredMs              head=653  r0=+22  headB=-6
matchMs                head=667  r0=+36  headB=-7
firstPlayableMs        head=670  r0=+46  headB=-6
compiles.on            head=809  r0=+49  headB=-3
skyLanding.on          head=939  r0=+98  headB=-4
quietEndMs             head=3683  r0=+42  headB=-7
compiles.off           head=3698  r0=+38  headB=-3
warmups.off            head=3764  r0=+47  headB=-4
sky.off                head=3903  r0=+44  headB=-2
skyLanding.off         head=3903  r0=+44  headB=-2
bakeLayout.off         head=3903  r0=+591  headB=-2
bake.off               head=3967  r0=+600  headB=-7
bakeFading.on          head=3967  r0=+600  headB=-7
textures.off           head=4695  r0=+967  headB=-1
props.off              head=4820  r0=+1659  headB=+4
fx.off                 head=4834  r0=+980  headB=-2
effects.off            head=4834  r0=+980  headB=-2
weapons.off            head=5207  r0=+1297  headB=-8
weaponsReady.off       head=5207  r0=+1297  headB=-8
operators.off          head=5326  r0=+1544  headB=+2
streaming.off          head=5441  r0=+1659  headB=+6
readyMs                head=5448  r0=+874  headB=-4
bakeFading.off         head=5472  r0=+600  headB=-3
pace.last              head=5575  r0=+1765  headB=+11

## phases (low): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=406  r0=+22  headB=-14
warmups.on             head=511  r0=+14  headB=-12
enteredMs              head=514  r0=+14  headB=-12
matchMs                head=527  r0=+26  headB=-14
firstPlayableMs        head=528  r0=+30  headB=-14
warmups.off            head=528  r0=+30  headB=-14
readyMs                head=546  r0=+36  headB=-13

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=402  r0=+8  headB=-7
sky.on                 head=644  r0=+12  headB=-10
bakeLayout.on          head=644  r0=+12  headB=-10
bake.on                head=644  r0=+12  headB=-10
textures.on            head=644  r0=+12  headB=-10
fx.on                  head=644  r0=+12  headB=-10
weapons.on             head=644  r0=+12  headB=-10
operators.on           head=644  r0=+12  headB=-10
props.on               head=644  r0=+12  headB=-10
streaming.on           head=644  r0=+12  headB=-10
warmups.on             head=644  r0=+12  headB=-10
effects.on             head=644  r0=+12  headB=-10
weaponsReady.on        head=644  r0=+12  headB=-10
enteredMs              head=653  r0=+12  headB=-10
matchMs                head=670  r0=+30  headB=-9
firstPlayableMs        head=672  r0=+34  headB=-9
compiles.on            head=764  r0=+33  headB=-9
skyLanding.on          head=856  r0=+61  headB=-7
quietEndMs             head=3671  r0=+29  headB=-21
compiles.off           head=3687  r0=+28  headB=-22
warmups.off            head=3745  r0=+56  headB=-2
sky.off                head=3888  r0=+34  headB=-13
skyLanding.off         head=3888  r0=+34  headB=-13
bakeLayout.off         head=3888  r0=+477  headB=-13
bake.off               head=3918  r0=+494  headB=-14
bakeFading.on          head=3918  r0=+494  headB=-14
textures.off           head=4105  r0=+1813  headB=-8
fx.off                 head=4105  r0=+1911  headB=-8
effects.off            head=4105  r0=+1911  headB=-8
weapons.off            head=4212  r0=+2532  headB=-22
weaponsReady.off       head=4212  r0=+2532  headB=-22
operators.off          head=4235  r0=+2778  headB=-18
pace.last              head=4317  r0=+3250  headB=+5
props.off              head=4335  r0=+2893  headB=-7
streaming.off          head=4335  r0=+2893  headB=-9
readyMs                head=5419  r0=+1821  headB=-8
bakeFading.off         head=5419  r0=+494  headB=-8

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=390  r0=+14  headB=+3
sky.on                 head=649  r0=+29  headB=+5
bakeLayout.on          head=649  r0=+29  headB=+5
bake.on                head=649  r0=+29  headB=+5
textures.on            head=649  r0=+29  headB=+5
fx.on                  head=649  r0=+29  headB=+5
weapons.on             head=649  r0=+29  headB=+5
operators.on           head=649  r0=+29  headB=+5
props.on               head=649  r0=+29  headB=+5
streaming.on           head=649  r0=+29  headB=+5
warmups.on             head=649  r0=+29  headB=+5
effects.on             head=649  r0=+29  headB=+5
weaponsReady.on        head=649  r0=+29  headB=+5
enteredMs              head=658  r0=+30  headB=+5
matchMs                head=674  r0=+51  headB=+4
firstPlayableMs        head=677  r0=+52  headB=+6
compiles.on            head=778  r0=+52  headB=+6
skyLanding.on          head=908  r0=+117  headB=+8
quietEndMs             head=3674  r0=+50  headB=+7
compiles.off           head=3691  r0=+49  headB=+5
warmups.off            head=3795  r0=+54  headB=+4
sky.off                head=3898  r0=+52  headB=+8
skyLanding.off         head=3898  r0=+52  headB=+8
bakeLayout.off         head=3898  r0=+553  headB=+8
bake.off               head=3952  r0=+574  headB=+10
bakeFading.on          head=3952  r0=+574  headB=+10
textures.off           head=4768  r0=+1366  headB=+3
fx.off                 head=4845  r0=+1408  headB=+8
effects.off            head=4845  r0=+1408  headB=+8
weapons.off            head=5207  r0=+1837  headB=+19
weaponsReady.off       head=5207  r0=+1837  headB=+19
operators.off          head=5326  r0=+1972  headB=+24
props.off              head=5441  r0=+2066  headB=+24
streaming.off          head=5441  r0=+2066  headB=+24
bakeFading.off         head=5461  r0=+575  headB=+10
readyMs                head=5540  r0=+1946  headB=+18
pace.last              head=5551  r0=+2070  headB=+12

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=417  r0=+9  headB=-2
sky.on                 head=708  r0=+29  headB=-4
bakeLayout.on          head=708  r0=+29  headB=-4
bake.on                head=708  r0=+29  headB=-4
textures.on            head=708  r0=+29  headB=-4
fx.on                  head=708  r0=+29  headB=-4
weapons.on             head=708  r0=+29  headB=-4
operators.on           head=708  r0=+29  headB=-4
props.on               head=708  r0=+29  headB=-4
streaming.on           head=708  r0=+29  headB=-4
warmups.on             head=708  r0=+29  headB=-4
effects.on             head=708  r0=+29  headB=-4
weaponsReady.on        head=708  r0=+29  headB=-4
enteredMs              head=717  r0=+30  headB=-5
matchMs                head=732  r0=+43  headB=-5
firstPlayableMs        head=735  r0=+51  headB=-5
compiles.on            head=872  r0=+55  headB=-6
skyLanding.on          head=1006  r0=+121  headB=-7
quietEndMs             head=3738  r0=+43  headB=-7
compiles.off           head=3759  r0=+38  headB=-4
warmups.off            head=3867  r0=+42  headB=-5
sky.off                head=3955  r0=+50  headB=-0
skyLanding.off         head=3955  r0=+50  headB=-0
bakeLayout.off         head=3955  r0=+715  headB=-0
bake.off               head=4083  r0=+721  headB=-9
bakeFading.on          head=4083  r0=+721  headB=-9
bakeFading.off         head=5583  r0=+723  headB=-11
textures.off           head=6738  r0=+654  headB=-4
fx.off                 head=6938  r0=+679  headB=-4
effects.off            head=6938  r0=+679  headB=-4
weapons.off            head=7915  r0=+876  headB=-18
weaponsReady.off       head=7915  r0=+876  headB=-18
operators.off          head=8343  r0=+817  headB=-12
readyMs                head=8509  r0=+874  headB=-6
props.off              head=8509  r0=+874  headB=-6
streaming.off          head=8509  r0=+874  headB=-6
pace.last              head=9052  r0=+855  headB=+13

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=102.0 4.3/2.3 skip 77.5 n 3260 r 2266/31.9 pace 4  r0=153.9 4.7/2.9 skip 104.7 n 4002 r 2923/39.7 pace 2  headB=97.7 4.3/2.3 skip 77.1 n 3314 r 2228/36.7 pace 4
low      head=30.2 0.3/0.3 skip 0.0 n 1 r 2/1.1 pace 1  r0=50.1 0.9/0.5 skip 0.0 n 1 r 9/8.0 pace 1  headB=31.9 0.3/0.3 skip 0.0 n 1 r 2/1.2 pace 1
medium   head=70.4 4.5/2.4 skip 53.8 n 4416 r 2641/24.2 pace 2  r0=92.7 4.8/3.3 skip 107.4 n 5046 r 3059/28.8 pace 2  headB=67.0 4.8/2.6 skip 53.8 n 4461 r 2632/25.1 pace 2
high     head=107.2 6.1/2.6 skip 89.3 n 3106 r 2107/38.1 pace 2  r0=175.6 6.1/3.8 skip 126.2 n 4041 r 2923/41.2 pace 2  headB=106.8 5.9/2.8 skip 89.9 n 3097 r 2120/38.6 pace 2
ultra    head=108.3 6.5/3.8 skip 166.9 n 3806 r 3137/39.6 pace 4  r0=176.8 7.0/4.2 skip 185.3 n 4122 r 3539/41.5 pace 2  headB=107.8 6.3/3.7 skip 164.7 n 3819 r 3070/39.1 pace 4
low r0: ready faster 1/12, firstPlayable faster 1/12
low headB: ready faster 8/12, firstPlayable faster 9/12
medium r0: ready faster 0/12, firstPlayable faster 2/12
medium headB: ready faster 8/12, firstPlayable faster 8/12
high r0: ready faster 0/12, firstPlayable faster 0/12
high headB: ready faster 3/12, firstPlayable faster 5/12
ultra r0: ready faster 0/12, firstPlayable faster 0/12
ultra headB: ready faster 6/12, firstPlayable faster 8/12


```

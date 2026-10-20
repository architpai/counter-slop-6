# Round 4 paired A/B runs

Power and thermal readings for every run: `perf/results/r4-power.log` (pmset -g batt / -g therm at start and end, checked every 60 s by `perf/powered.sh`).

## c1: medium/high/ultra, head/a/headB/d, 4 rounds (balanced)
```
HEAD 2c75479df05e1f71c2b59472bd1d17d09b1e3b37  variants: head, a, headB, d  (2026-10-19T01:07:30.235Z)
complete: 4 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.883 (0.0%)  a=2.883 (-0.0%)  headB=2.885 (0.0%)  d=2.865 (-0.6%)
medium   head=2.258 (0.0%)  a=2.276 (0.8%)  headB=2.262 (0.2%)  d=2.256 (-0.1%)
high     head=2.837 (0.0%)  a=2.860 (0.8%)  headB=2.825 (-0.4%)  d=2.763 (-2.6%)
ultra    head=3.742 (0.0%)  a=3.680 (-1.7%)  headB=3.756 (0.4%)  d=3.772 (0.8%)

## med: geomean (paired ratio vs head)
all      head=2.981 (0.0%)  a=2.972 (-0.3%)  headB=2.980 (-0.0%)  d=2.973 (-0.3%)
medium   head=2.419 (0.0%)  a=2.430 (0.4%)  headB=2.432 (0.5%)  d=2.425 (0.2%)
high     head=3.004 (0.0%)  a=3.021 (0.6%)  headB=2.991 (-0.4%)  d=2.947 (-1.9%)
ultra    head=3.646 (0.0%)  a=3.574 (-2.0%)  headB=3.637 (-0.2%)  d=3.677 (0.9%)

## p95: geomean (paired ratio vs head)
all      head=4.264 (0.0%)  a=4.304 (0.9%)  headB=4.264 (0.0%)  d=4.216 (-1.1%)
medium   head=3.581 (0.0%)  a=3.656 (2.1%)  headB=3.580 (-0.0%)  d=3.565 (-0.5%)
high     head=4.190 (0.0%)  a=4.262 (1.7%)  headB=4.171 (-0.5%)  d=4.050 (-3.4%)
ultra    head=5.166 (0.0%)  a=5.115 (-1.0%)  headB=5.192 (0.5%)  d=5.189 (0.4%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     a=-0.0%  d=-0.6%  headB=0.0%  | pos1..: 0.1 0.1 0.4
medium  a=0.8%  d=-0.1%  headB=0.2%  | pos1..: 0.2 0.8 1.2
high    a=0.8%  d=-2.6%  headB=-0.4%  | pos1..: -0.7 -0.5 -0.7
ultra   a=-1.7%  d=0.8%  headB=0.4%  | pos1..: 0.8 0.1 0.6
# med
all     a=-0.3%  d=-0.3%  headB=-0.0%  | pos1..: 0.4 -0.3 0.6
medium  a=0.4%  d=0.2%  headB=0.5%  | pos1..: 0.6 0.4 1.1
high    a=0.6%  d=-1.9%  headB=-0.4%  | pos1..: -0.6 -0.6 0.1
ultra   a=-2.0%  d=0.9%  headB=-0.2%  | pos1..: 1.2 -0.6 0.7
# p95
all     a=0.9%  d=-1.1%  headB=0.0%  | pos1..: 0.6 0.9 1.2
medium  a=2.1%  d=-0.5%  headB=-0.0%  | pos1..: 0.6 1.4 3.0
high    a=1.7%  d=-3.4%  headB=-0.5%  | pos1..: -0.3 0.2 -0.5
ultra   a=-1.0%  d=0.4%  headB=0.5%  | pos1..: 1.7 1.0 1.0
# cpu
all     a=0.3%  d=-0.5%  headB=0.4%  | pos1..: 0.1 -0.2 0.1
medium  a=1.4%  d=0.3%  headB=0.9%  | pos1..: 0.7 1.1 1.0
high    a=1.3%  d=-2.4%  headB=-0.3%  | pos1..: -0.7 -0.8 -0.9
ultra   a=-1.6%  d=0.7%  headB=0.6%  | pos1..: 0.4 -0.9 0.1
# fight cpu
all     a=0.7%  d=-0.6%  headB=0.4%  | pos1..: 0.1 -1.0 -0.5
medium  a=1.6%  d=0.3%  headB=1.5%  | pos1..: 1.1 1.6 0.5
high    a=1.8%  d=-2.7%  headB=-0.9%  | pos1..: -0.6 -2.0 -1.4
ultra   a=-1.4%  d=0.7%  headB=0.6%  | pos1..: -0.2 -2.5 -0.7
```

## n1: medium/high/ultra, head/smaa/headB/main/d, 4 rounds (near-balanced: 5 variants)
```
HEAD 2c75479df05e1f71c2b59472bd1d17d09b1e3b37  variants: head, smaa, headB, main, d  (2026-10-19T02:05:04.125Z)
complete: 5 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.856 (0.0%)  smaa=2.843 (-0.5%)  headB=2.850 (-0.2%)  main=2.842 (-0.5%)  d=2.840 (-0.6%)
medium   head=2.268 (0.0%)  smaa=2.255 (-0.6%)  headB=2.247 (-0.9%)  main=2.230 (-1.7%)  d=2.271 (0.1%)
high     head=2.773 (0.0%)  smaa=2.769 (-0.1%)  headB=2.790 (0.6%)  main=2.771 (-0.1%)  d=2.747 (-0.9%)
ultra    head=3.706 (0.0%)  smaa=3.680 (-0.7%)  headB=3.692 (-0.4%)  main=3.714 (0.2%)  d=3.671 (-0.9%)

## med: geomean (paired ratio vs head)
all      head=2.957 (0.0%)  smaa=2.955 (-0.1%)  headB=2.955 (-0.1%)  main=2.947 (-0.3%)  d=2.948 (-0.3%)
medium   head=2.430 (0.0%)  smaa=2.417 (-0.5%)  headB=2.417 (-0.5%)  main=2.401 (-1.2%)  d=2.434 (0.2%)
high     head=2.935 (0.0%)  smaa=2.963 (0.9%)  headB=2.960 (0.9%)  main=2.934 (-0.0%)  d=2.937 (0.1%)
ultra    head=3.625 (0.0%)  smaa=3.602 (-0.6%)  headB=3.605 (-0.5%)  main=3.634 (0.3%)  d=3.585 (-1.1%)

## p95: geomean (paired ratio vs head)
all      head=4.219 (0.0%)  smaa=4.206 (-0.3%)  headB=4.196 (-0.5%)  main=4.192 (-0.6%)  d=4.205 (-0.3%)
medium   head=3.568 (0.0%)  smaa=3.564 (-0.1%)  headB=3.530 (-1.1%)  main=3.501 (-1.9%)  d=3.594 (0.8%)
high     head=4.100 (0.0%)  smaa=4.083 (-0.4%)  headB=4.110 (0.2%)  main=4.085 (-0.4%)  d=4.051 (-1.2%)
ultra    head=5.133 (0.0%)  smaa=5.112 (-0.4%)  headB=5.092 (-0.8%)  main=5.152 (0.4%)  d=5.108 (-0.5%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     d=-0.6%  headB=-0.2%  main=-0.5%  smaa=-0.5%  | pos1..: 0.3 0.1 0.3 0.4
medium  d=0.1%  headB=-0.9%  main=-1.7%  smaa=-0.6%  | pos1..: -0.1 0.0 -0.3 0.0
high    d=-0.9%  headB=0.6%  main=-0.1%  smaa=-0.1%  | pos1..: 0.1 0.4 0.2 0.3
ultra   d=-1.0%  headB=-0.4%  main=0.2%  smaa=-0.8%  | pos1..: 0.8 -0.2 0.9 0.7
# med
all     d=-0.3%  headB=-0.1%  main=-0.3%  smaa=-0.1%  | pos1..: 0.6 0.0 0.0 -0.2
medium  d=0.2%  headB=-0.5%  main=-1.2%  smaa=-0.5%  | pos1..: 0.2 0.0 -0.5 -0.5
high    d=0.1%  headB=0.9%  main=-0.0%  smaa=0.9%  | pos1..: 0.1 0.5 -0.3 -0.1
ultra   d=-1.1%  headB=-0.5%  main=0.2%  smaa=-0.7%  | pos1..: 1.5 -0.4 0.7 0.1
# p95
all     d=-0.3%  headB=-0.6%  main=-0.6%  smaa=-0.3%  | pos1..: 0.4 0.1 1.0 0.8
medium  d=0.8%  headB=-1.1%  main=-1.8%  smaa=-0.1%  | pos1..: -0.0 0.4 0.9 0.5
high    d=-1.2%  headB=0.2%  main=-0.4%  smaa=-0.4%  | pos1..: -0.4 -0.5 -0.1 0.1
ultra   d=-0.6%  headB=-0.8%  main=0.3%  smaa=-0.5%  | pos1..: 1.3 0.3 1.8 1.7
# cpu
all     d=-0.9%  headB=-0.2%  main=-0.7%  smaa=-0.4%  | pos1..: 0.1 -0.1 0.1 0.3
medium  d=-0.7%  headB=-1.8%  main=-2.3%  smaa=-0.9%  | pos1..: -0.6 -0.6 -0.6 -0.2
high    d=-1.1%  headB=0.9%  main=-0.2%  smaa=0.2%  | pos1..: -0.1 0.2 0.2 0.4
ultra   d=-0.8%  headB=0.2%  main=0.3%  smaa=-0.6%  | pos1..: 0.9 -0.2 0.5 0.6
# fight cpu
all     d=-0.8%  headB=-0.3%  main=-0.8%  smaa=-0.2%  | pos1..: 0.1 -0.6 0.1 0.1
medium  d=-1.0%  headB=-2.6%  main=-2.8%  smaa=-0.7%  | pos1..: -0.7 -1.2 -1.2 -0.7
high    d=-0.9%  headB=1.4%  main=-0.0%  smaa=0.8%  | pos1..: -0.4 -0.3 -0.0 0.1
ultra   d=-0.5%  headB=0.4%  main=0.3%  smaa=-0.7%  | pos1..: 1.2 -0.6 1.2 0.8
```

## t1 (traced, AB_TRACE=1): low/medium/high/ultra x training/mexico, head/a/headB/stat, 4 rounds (balanced)
```
HEAD 2c75479df05e1f71c2b59472bd1d17d09b1e3b37  variants: head, a, headB, stat  (2026-10-19T03:16:27.247Z)
complete: 4 variants x 64 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.786 (0.0%)  a=2.794 (0.3%)  headB=2.777 (-0.3%)  stat=2.829 (1.6%)
low      head=1.711 (0.0%)  a=1.731 (1.2%)  headB=1.722 (0.6%)  stat=1.704 (-0.4%)
medium   head=2.675 (0.0%)  a=2.627 (-1.8%)  headB=2.531 (-5.4%)  stat=2.856 (6.8%)
high     head=3.330 (0.0%)  a=3.383 (1.6%)  headB=3.390 (1.8%)  stat=3.361 (0.9%)
ultra    head=3.951 (0.0%)  a=3.958 (0.2%)  headB=4.028 (1.9%)  stat=3.919 (-0.8%)

## med: geomean (paired ratio vs head)
all      head=2.798 (0.0%)  a=2.806 (0.3%)  headB=2.804 (0.2%)  stat=2.849 (1.8%)
low      head=1.776 (0.0%)  a=1.755 (-1.2%)  headB=1.771 (-0.3%)  stat=1.747 (-1.6%)
medium   head=2.662 (0.0%)  a=2.691 (1.1%)  headB=2.618 (-1.7%)  stat=2.890 (8.6%)
high     head=3.316 (0.0%)  a=3.353 (1.1%)  headB=3.364 (1.5%)  stat=3.327 (0.3%)
ultra    head=3.913 (0.0%)  a=3.915 (0.1%)  headB=3.964 (1.3%)  stat=3.923 (0.3%)

## p95: geomean (paired ratio vs head)
all      head=4.304 (0.0%)  a=4.326 (0.5%)  headB=4.294 (-0.2%)  stat=4.351 (1.1%)
low      head=2.990 (0.0%)  a=3.021 (1.1%)  headB=2.999 (0.3%)  stat=2.977 (-0.4%)
medium   head=4.185 (0.0%)  a=4.061 (-2.9%)  headB=3.878 (-7.3%)  stat=4.436 (6.0%)
high     head=4.942 (0.0%)  a=5.071 (2.6%)  headB=5.099 (3.2%)  stat=4.965 (0.5%)
ultra    head=5.548 (0.0%)  a=5.626 (1.4%)  headB=5.733 (3.3%)  stat=5.466 (-1.5%)

## js: geomean (paired ratio vs head)
all      head=1.461 (0.0%)  a=1.417 (-3.0%)  headB=1.470 (0.6%)  stat=1.424 (-2.5%)
low      head=0.784 (0.0%)  a=0.810 (3.3%)  headB=0.830 (5.9%)  stat=0.775 (-1.2%)
medium   head=1.409 (0.0%)  a=1.348 (-4.3%)  headB=1.362 (-3.4%)  stat=1.471 (4.4%)
high     head=1.907 (0.0%)  a=1.895 (-0.6%)  headB=1.949 (2.2%)  stat=1.844 (-3.3%)
ultra    head=2.162 (0.0%)  a=1.945 (-10.0%)  headB=2.118 (-2.0%)  stat=1.955 (-9.6%)

## js (fight only): geomean (paired ratio vs head)
all      head=2.377 (0.0%)  a=2.320 (-2.4%)  headB=2.396 (0.8%)  stat=2.346 (-1.3%)
low      head=1.279 (0.0%)  a=1.343 (5.0%)  headB=1.323 (3.4%)  stat=1.281 (0.2%)
medium   head=2.245 (0.0%)  a=2.150 (-4.3%)  headB=2.220 (-1.1%)  stat=2.271 (1.1%)
high     head=3.194 (0.0%)  a=3.044 (-4.7%)  headB=3.123 (-2.2%)  stat=3.118 (-2.4%)
ultra    head=3.481 (0.0%)  a=3.294 (-5.4%)  headB=3.592 (3.2%)  stat=3.340 (-4.0%)

order-corrected fit (perf/ab-posfit.mjs):
# js fight
all     a=-2.4%  headB=0.8%  stat=-1.3%  | pos1..: -0.3 -0.3 -1.3
low     a=5.0%  headB=3.4%  stat=0.2%  | pos1..: -1.3 -2.8 -2.2
medium  a=-4.3%  headB=-1.1%  stat=1.1%  | pos1..: 1.6 -2.5 4.7
high    a=-4.7%  headB=-2.2%  stat=-2.4%  | pos1..: 1.1 9.1 -9.3
ultra   a=-5.4%  headB=3.2%  stat=-4.0%  | pos1..: -2.6 -4.5 2.1
# js path
all     a=-3.6%  headB=0.4%  stat=-3.8%  | pos1..: -0.9 -0.5 -1.8
low     a=1.6%  headB=8.4%  stat=-2.5%  | pos1..: 8.9 -0.5 1.6
medium  a=-4.3%  headB=-5.5%  stat=7.8%  | pos1..: -2.7 -11.0 -4.0
high    a=3.7%  headB=6.9%  stat=-4.2%  | pos1..: 4.6 23.3 8.1
ultra   a=-14.5%  headB=-7.0%  stat=-14.8%  | pos1..: -13.2 -10.1 -11.8
# mean fight
all     a=1.6%  headB=0.1%  stat=1.3%  | pos1..: -1.0 -1.0 1.3
low     a=0.9%  headB=0.2%  stat=-1.5%  | pos1..: -1.5 -2.9 -0.4
medium  a=2.4%  headB=-4.1%  stat=6.0%  | pos1..: -7.1 -9.2 2.9
high    a=2.5%  headB=1.8%  stat=1.4%  | pos1..: 3.3 5.7 -4.1
ultra   a=0.6%  headB=2.6%  stat=-0.5%  | pos1..: 1.6 3.2 6.9
# mean path
all     a=-1.0%  headB=-0.7%  stat=1.8%  | pos1..: -0.6 -2.7 -3.2
low     a=1.5%  headB=1.1%  stat=0.7%  | pos1..: -0.1 -0.4 -0.2
medium  a=-5.8%  headB=-6.6%  stat=7.5%  | pos1..: -1.4 -10.4 -9.9
high    a=0.7%  headB=1.8%  stat=0.5%  | pos1..: 0.3 1.9 -2.1
ultra   a=-0.3%  headB=1.3%  stat=-1.2%  | pos1..: -1.1 -1.3 -0.1
```

## c2: low/medium/high/ultra, head/g/headB, 3 rounds (balanced)
```
HEAD 2c75479df05e1f71c2b59472bd1d17d09b1e3b37  variants: head, g, headB  (2026-10-19T04:38:47.444Z)
complete: 3 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.641 (0.0%)  g=2.587 (-2.1%)  headB=2.656 (0.5%)
low      head=1.570 (0.0%)  g=1.572 (0.2%)  headB=1.580 (0.7%)
medium   head=2.416 (0.0%)  g=2.356 (-2.5%)  headB=2.411 (-0.2%)
high     head=3.312 (0.0%)  g=3.193 (-3.6%)  headB=3.349 (1.1%)
ultra    head=3.877 (0.0%)  g=3.788 (-2.3%)  headB=3.898 (0.5%)

## med: geomean (paired ratio vs head)
all      head=2.703 (0.0%)  g=2.682 (-0.8%)  headB=2.731 (1.0%)
low      head=1.679 (0.0%)  g=1.719 (2.4%)  headB=1.698 (1.1%)
medium   head=2.559 (0.0%)  g=2.510 (-1.9%)  headB=2.564 (0.2%)
high     head=3.307 (0.0%)  g=3.263 (-1.3%)  headB=3.333 (0.8%)
ultra    head=3.759 (0.0%)  g=3.677 (-2.2%)  headB=3.835 (2.0%)

## p95: geomean (paired ratio vs head)
all      head=4.121 (0.0%)  g=4.019 (-2.5%)  headB=4.134 (0.3%)
low      head=2.781 (0.0%)  g=2.764 (-0.6%)  headB=2.788 (0.3%)
medium   head=3.836 (0.0%)  g=3.718 (-3.1%)  headB=3.832 (-0.1%)
high     head=4.964 (0.0%)  g=4.791 (-3.5%)  headB=5.037 (1.5%)
ultra    head=5.450 (0.0%)  g=5.297 (-2.8%)  headB=5.428 (-0.4%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     g=-2.1%  headB=0.5%  | pos1..: 0.2 0.4
low     g=0.2%  headB=0.7%  | pos1..: -0.0 0.6
medium  g=-2.5%  headB=-0.2%  | pos1..: 1.4 1.8
high    g=-3.6%  headB=1.1%  | pos1..: -0.9 -1.9
ultra   g=-2.3%  headB=0.5%  | pos1..: 0.4 1.3
# med
all     g=-0.8%  headB=1.0%  | pos1..: 0.6 0.7
low     g=2.4%  headB=1.1%  | pos1..: 1.3 1.2
medium  g=-1.9%  headB=0.2%  | pos1..: 1.4 0.9
high    g=-1.3%  headB=0.8%  | pos1..: -1.2 -1.5
ultra   g=-2.2%  headB=2.0%  | pos1..: 0.8 2.2
# p95
all     g=-2.5%  headB=0.3%  | pos1..: 0.2 0.4
low     g=-0.6%  headB=0.3%  | pos1..: -0.6 0.3
medium  g=-3.1%  headB=-0.1%  | pos1..: 1.6 2.9
high    g=-3.5%  headB=1.5%  | pos1..: -1.0 -3.5
ultra   g=-2.8%  headB=-0.4%  | pos1..: 0.9 2.0
```

## f1: low/medium/high/ultra, head/all/headB/bundle, 4 rounds (balanced) — the round's verdict
all = smaa + main + stat + a + d + g (kept, commit cad1329); bundle = the exact part (all without g).
```
HEAD 2c75479df05e1f71c2b59472bd1d17d09b1e3b37  variants: head, all, headB, bundle  (2026-10-19T05:26:39.976Z)
complete: 4 variants x 128 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.563 (0.0%)  all=2.500 (-2.4%)  headB=2.576 (0.5%)  bundle=2.527 (-1.4%)
low      head=1.571 (0.0%)  all=1.560 (-0.7%)  headB=1.565 (-0.3%)  bundle=1.572 (0.1%)
medium   head=2.335 (0.0%)  all=2.258 (-3.3%)  headB=2.338 (0.1%)  bundle=2.275 (-2.6%)
high     head=3.081 (0.0%)  all=2.995 (-2.8%)  headB=3.097 (0.5%)  bundle=3.031 (-1.7%)
ultra    head=3.818 (0.0%)  all=3.702 (-3.0%)  headB=3.884 (1.7%)  bundle=3.762 (-1.5%)

## med: geomean (paired ratio vs head)
all      head=2.670 (0.0%)  all=2.611 (-2.2%)  headB=2.678 (0.3%)  bundle=2.634 (-1.4%)
low      head=1.720 (0.0%)  all=1.683 (-2.2%)  headB=1.693 (-1.6%)  bundle=1.710 (-0.6%)
medium   head=2.500 (0.0%)  all=2.447 (-2.1%)  headB=2.503 (0.1%)  bundle=2.435 (-2.6%)
high     head=3.196 (0.0%)  all=3.159 (-1.1%)  headB=3.218 (0.7%)  bundle=3.159 (-1.2%)
ultra    head=3.701 (0.0%)  all=3.573 (-3.4%)  headB=3.770 (1.9%)  bundle=3.656 (-1.2%)

## p95: geomean (paired ratio vs head)
all      head=3.977 (0.0%)  all=3.932 (-1.1%)  headB=4.013 (0.9%)  bundle=3.952 (-0.6%)
low      head=2.757 (0.0%)  all=2.768 (0.4%)  headB=2.757 (-0.0%)  bundle=2.768 (0.4%)
medium   head=3.693 (0.0%)  all=3.625 (-1.8%)  headB=3.683 (-0.3%)  bundle=3.612 (-2.2%)
high     head=4.644 (0.0%)  all=4.564 (-1.7%)  headB=4.683 (0.8%)  bundle=4.617 (-0.6%)
ultra    head=5.290 (0.0%)  all=5.221 (-1.3%)  headB=5.451 (3.0%)  bundle=5.286 (-0.1%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     all=-2.4%  bundle=-1.4%  headB=0.5%  | pos1..: -0.7 -0.8 -0.2
low     all=-0.7%  bundle=0.1%  headB=-0.3%  | pos1..: 0.2 0.1 -0.3
medium  all=-3.3%  bundle=-2.6%  headB=0.1%  | pos1..: -1.2 -1.1 0.3
high    all=-2.8%  bundle=-1.7%  headB=0.5%  | pos1..: -2.2 -3.4 -2.2
ultra   all=-3.0%  bundle=-1.5%  headB=1.7%  | pos1..: 0.5 1.2 1.4
# med
all     all=-2.2%  bundle=-1.4%  headB=0.3%  | pos1..: -0.8 -0.6 0.4
low     all=-2.2%  bundle=-0.6%  headB=-1.6%  | pos1..: 0.2 1.1 0.7
medium  all=-2.1%  bundle=-2.6%  headB=0.1%  | pos1..: -1.1 -1.8 0.6
high    all=-1.1%  bundle=-1.2%  headB=0.7%  | pos1..: -1.5 -2.5 -0.8
ultra   all=-3.4%  bundle=-1.2%  headB=1.9%  | pos1..: -0.7 1.1 1.3
# p95
all     all=-1.1%  bundle=-0.6%  headB=0.9%  | pos1..: -0.5 -1.1 -0.0
low     all=0.4%  bundle=0.4%  headB=-0.0%  | pos1..: -0.1 -0.6 -0.8
medium  all=-1.8%  bundle=-2.2%  headB=-0.3%  | pos1..: -0.9 -0.7 1.0
high    all=-1.7%  bundle=-0.6%  headB=0.8%  | pos1..: -2.3 -4.4 -3.0
ultra   all=-1.3%  bundle=-0.1%  headB=3.0%  | pos1..: 1.4 1.3 2.8
# cpu
all     all=-2.8%  bundle=-1.7%  headB=0.6%  | pos1..: -0.7 -0.8 -0.6
low     all=-0.8%  bundle=0.2%  headB=-0.3%  | pos1..: 0.1 0.1 -0.4
medium  all=-3.2%  bundle=-2.6%  headB=0.9%  | pos1..: -1.6 -1.3 -0.3
high    all=-4.0%  bundle=-2.7%  headB=0.4%  | pos1..: -1.8 -3.1 -2.4
ultra   all=-3.1%  bundle=-1.5%  headB=1.5%  | pos1..: 0.5 1.0 0.8
# mean path
all     all=-2.5%  bundle=-1.5%  headB=0.4%  | pos1..: -0.1 -0.4 0.2
low     all=-0.7%  bundle=-0.1%  headB=-0.5%  | pos1..: 0.5 0.8 -0.3
medium  all=-2.7%  bundle=-1.9%  headB=0.9%  | pos1..: -0.6 -0.5 1.6
high    all=-4.1%  bundle=-2.1%  headB=-0.5%  | pos1..: -0.7 -2.8 -1.6
ultra   all=-2.5%  bundle=-1.7%  headB=1.5%  | pos1..: 0.3 0.8 1.0
# mean fight
all     all=-2.4%  bundle=-1.4%  headB=0.6%  | pos1..: -1.2 -1.1 -0.6
low     all=-0.6%  bundle=0.2%  headB=-0.2%  | pos1..: -0.1 -0.5 -0.3
medium  all=-3.8%  bundle=-3.2%  headB=-0.6%  | pos1..: -1.8 -1.6 -0.9
high    all=-1.4%  bundle=-1.2%  headB=1.5%  | pos1..: -3.7 -4.0 -2.9
ultra   all=-3.5%  bundle=-1.2%  headB=1.9%  | pos1..: 0.7 1.6 1.8
# fight cpu
all     all=-2.9%  bundle=-1.8%  headB=0.9%  | pos1..: -1.5 -1.4 -1.4
low     all=-0.8%  bundle=0.2%  headB=-0.1%  | pos1..: -0.4 -0.8 -0.7
medium  all=-3.9%  bundle=-3.0%  headB=0.5%  | pos1..: -2.9 -2.3 -2.3
high    all=-3.3%  bundle=-3.2%  headB=1.3%  | pos1..: -3.4 -3.8 -3.4
ultra   all=-3.6%  bundle=-1.0%  headB=1.8%  | pos1..: 0.7 1.4 1.0
```

## p1 (throwaway ceilings, on cad1329): low/high/ultra, head/pS/pE/pK/pN, 5 rounds (balanced)
pS = every getShadow returns 1.0 (passes still render); pE = shadow passes clear and store every map but draw no caster; pK = maps drawn once, then never redrawn (stale, still sampled); pN = GTAO with sliceNoise = stepNoise = 0 (coherent taps). Patches: perf/patches/r4-probe-*.patch.
```
HEAD cad13291fd900f1a33af26b3cd6bed28708529d7  variants: head, pS, pE, pK, pN  (2026-10-19T06:33:00.154Z)
complete: 5 variants x 120 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.555 (0.0%)  pS=2.526 (-1.1%)  pE=2.486 (-2.7%)  pK=2.380 (-6.8%)  pN=2.587 (1.3%)
low      head=1.566 (0.0%)  pS=1.555 (-0.7%)  pE=1.522 (-2.9%)  pK=1.505 (-3.9%)  pN=1.573 (0.4%)
high     head=2.797 (0.0%)  pS=2.731 (-2.4%)  pE=2.663 (-4.8%)  pK=2.518 (-10.0%)  pN=2.845 (1.7%)
ultra    head=3.806 (0.0%)  pS=3.797 (-0.3%)  pE=3.793 (-0.3%)  pK=3.559 (-6.5%)  pN=3.868 (1.6%)

## med: geomean (paired ratio vs head)
all      head=2.618 (0.0%)  pS=2.596 (-0.8%)  pE=2.552 (-2.5%)  pK=2.439 (-6.8%)  pN=2.672 (2.1%)
low      head=1.656 (0.0%)  pS=1.635 (-1.3%)  pE=1.603 (-3.2%)  pK=1.576 (-4.9%)  pN=1.699 (2.6%)
high     head=2.934 (0.0%)  pS=2.889 (-1.5%)  pE=2.813 (-4.1%)  pK=2.698 (-8.0%)  pN=2.995 (2.1%)
ultra    head=3.692 (0.0%)  pS=3.705 (0.4%)  pE=3.683 (-0.2%)  pK=3.412 (-7.6%)  pN=3.748 (1.5%)

## p95: geomean (paired ratio vs head)
all      head=3.962 (0.0%)  pS=3.983 (0.5%)  pE=4.030 (1.7%)  pK=3.907 (-1.4%)  pN=4.048 (2.2%)
low      head=2.774 (0.0%)  pS=2.779 (0.2%)  pE=2.748 (-0.9%)  pK=2.734 (-1.4%)  pN=2.797 (0.8%)
high     head=4.161 (0.0%)  pS=4.172 (0.2%)  pE=4.118 (-1.0%)  pK=3.981 (-4.3%)  pN=4.230 (1.6%)
ultra    head=5.386 (0.0%)  pS=5.451 (1.2%)  pE=5.783 (7.4%)  pK=5.479 (1.7%)  pN=5.607 (4.1%)

order-corrected fit (perf/ab-posfit.mjs):
# mean both
all     pE=-2.7%  pK=-6.8%  pN=1.3%  pS=-1.1%  | pos1..: -0.4 -0.2 1.0 1.2
low     pE=-2.9%  pK=-3.9%  pN=0.4%  pS=-0.7%  | pos1..: 0.3 -0.4 -0.1 0.3
high    pE=-4.8%  pK=-10.0%  pN=1.7%  pS=-2.4%  | pos1..: -0.7 0.5 1.0 1.6
ultra   pE=-0.3%  pK=-6.5%  pN=1.6%  pS=-0.3%  | pos1..: -0.7 -0.8 2.1 1.8
# mean path
all     pE=-0.8%  pK=-5.9%  pN=0.4%  pS=-1.3%  | pos1..: 0.1 0.2 0.9 1.0
low     pE=-1.7%  pK=-3.0%  pN=0.7%  pS=-0.7%  | pos1..: 0.5 0.2 0.0 0.4
high    pE=-3.5%  pK=-9.7%  pN=0.5%  pS=-2.4%  | pos1..: 0.1 1.1 1.6 2.5
ultra   pE=2.9%  pK=-4.9%  pN=0.1%  pS=-0.8%  | pos1..: -0.5 -0.8 1.1 0.2
# mean fight
all     pE=-4.5%  pK=-7.8%  pN=2.1%  pS=-0.9%  | pos1..: -0.8 -0.6 1.2 1.4
low     pE=-3.9%  pK=-4.9%  pN=0.1%  pS=-0.8%  | pos1..: -0.0 -1.0 -0.2 0.1
high    pE=-6.1%  pK=-10.3%  pN=3.0%  pS=-2.3%  | pos1..: -1.5 -0.0 0.5 0.7
ultra   pE=-3.5%  pK=-8.1%  pN=3.2%  pS=0.3%  | pos1..: -0.9 -0.7 3.2 3.5
# cpu fight
all     pE=-7.7%  pK=-10.8%  pN=2.0%  pS=-1.3%  | pos1..: -1.0 -0.4 1.0 1.0
low     pE=-5.9%  pK=-5.6%  pN=-0.2%  pS=-1.2%  | pos1..: -0.2 -1.5 -0.2 -0.7
high    pE=-9.6%  pK=-14.6%  pN=3.3%  pS=-2.7%  | pos1..: -1.5 0.4 0.7 1.0
ultra   pE=-7.6%  pK=-12.1%  pN=3.1%  pS=0.0%  | pos1..: -1.3 -0.2 2.3 2.9
```

## f2 (repeat, on 1cee56d = the kept set): low/medium/high/ultra, head(all)/base/headB(all)/gonly, 4 rounds (balanced)
base = the tree before the round (reverse of cad1329's src/tests); gonly = base + g. Ratios are vs the kept set (head), so base > 0 means the set is faster.
```
HEAD 1cee56d62bd674c561ad60110e279d2755b96610  variants: head, base, headB, gonly  (2026-10-19T07:49:16.540Z)
complete: 4 variants x 128 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.522 (0.0%)  base=2.562 (1.6%)  headB=2.492 (-1.2%)  gonly=2.497 (-1.0%)
low      head=1.580 (0.0%)  base=1.587 (0.4%)  headB=1.576 (-0.3%)  gonly=1.576 (-0.3%)
medium   head=2.398 (0.0%)  base=2.466 (2.8%)  headB=2.336 (-2.6%)  gonly=2.316 (-3.4%)
high     head=2.850 (0.0%)  base=2.901 (1.8%)  headB=2.794 (-2.0%)  gonly=2.820 (-1.1%)
ultra    head=3.744 (0.0%)  base=3.795 (1.4%)  headB=3.749 (0.1%)  gonly=3.777 (0.9%)

## med: geomean (paired ratio vs head)
all      head=2.634 (0.0%)  base=2.657 (0.9%)  headB=2.611 (-0.9%)  gonly=2.606 (-1.1%)
low      head=1.716 (0.0%)  base=1.715 (-0.1%)  headB=1.708 (-0.5%)  gonly=1.713 (-0.2%)
medium   head=2.562 (0.0%)  base=2.590 (1.1%)  headB=2.500 (-2.4%)  gonly=2.472 (-3.5%)
high     head=2.994 (0.0%)  base=3.030 (1.2%)  headB=2.968 (-0.9%)  gonly=2.971 (-0.8%)
ultra    head=3.658 (0.0%)  base=3.704 (1.2%)  headB=3.665 (0.2%)  gonly=3.666 (0.2%)

## p95: geomean (paired ratio vs head)
all      head=3.944 (0.0%)  base=3.976 (0.8%)  headB=3.914 (-0.8%)  gonly=3.887 (-1.5%)
low      head=2.779 (0.0%)  base=2.797 (0.6%)  headB=2.801 (0.8%)  gonly=2.773 (-0.2%)
medium   head=3.807 (0.0%)  base=3.899 (2.4%)  headB=3.727 (-2.1%)  gonly=3.686 (-3.2%)
high     head=4.319 (0.0%)  base=4.329 (0.2%)  headB=4.198 (-2.8%)  gonly=4.225 (-2.2%)
ultra    head=5.295 (0.0%)  base=5.292 (-0.1%)  headB=5.358 (1.2%)  gonly=5.285 (-0.2%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     base=1.6%  gonly=-1.0%  headB=-1.2%  | pos1..: -0.8 -0.2 -1.0
low     base=0.4%  gonly=-0.3%  headB=-0.3%  | pos1..: 0.2 0.4 1.2
medium  base=2.8%  gonly=-3.4%  headB=-2.6%  | pos1..: -3.2 -3.6 -5.1
high    base=1.8%  gonly=-1.1%  headB=-2.0%  | pos1..: 0.6 2.1 1.8
ultra   base=1.4%  gonly=0.9%  headB=0.1%  | pos1..: -0.6 0.3 -1.8
# med
all     base=0.9%  gonly=-1.1%  headB=-0.9%  | pos1..: -0.6 -0.5 -1.4
low     base=-0.1%  gonly=-0.2%  headB=-0.5%  | pos1..: -0.1 -1.0 0.1
medium  base=1.1%  gonly=-3.5%  headB=-2.4%  | pos1..: -2.7 -3.3 -4.9
high    base=1.2%  gonly=-0.8%  headB=-0.9%  | pos1..: 0.7 2.1 1.9
ultra   base=1.2%  gonly=0.2%  headB=0.2%  | pos1..: -0.4 0.4 -2.5
# p95
all     base=0.8%  gonly=-1.5%  headB=-0.8%  | pos1..: -1.0 0.0 -0.8
low     base=0.6%  gonly=-0.2%  headB=0.8%  | pos1..: -0.3 0.2 1.1
medium  base=2.4%  gonly=-3.2%  headB=-2.1%  | pos1..: -3.2 -3.1 -4.6
high    base=0.2%  gonly=-2.2%  headB=-2.8%  | pos1..: -0.1 1.8 1.7
ultra   base=-0.1%  gonly=-0.2%  headB=1.2%  | pos1..: -0.4 1.3 -1.5
# cpu
all     base=1.8%  gonly=-0.6%  headB=-1.4%  | pos1..: -0.9 -0.2 -1.1
low     base=-0.0%  gonly=-0.0%  headB=-0.6%  | pos1..: -0.0 0.5 0.8
medium  base=2.9%  gonly=-2.7%  headB=-2.6%  | pos1..: -3.2 -3.1 -4.5
high    base=2.9%  gonly=-0.2%  headB=-1.9%  | pos1..: -0.1 1.8 1.5
ultra   base=1.6%  gonly=0.7%  headB=-0.4%  | pos1..: -0.4 -0.1 -2.0
# mean path
all     base=1.8%  gonly=-0.7%  headB=-0.4%  | pos1..: -0.6 0.5 -0.4
low     base=0.5%  gonly=-0.3%  headB=-0.3%  | pos1..: 0.1 0.2 0.4
medium  base=2.5%  gonly=-1.6%  headB=-0.3%  | pos1..: -0.8 -1.7 -1.9
high    base=1.9%  gonly=-1.2%  headB=-1.7%  | pos1..: 0.2 2.2 1.3
ultra   base=2.1%  gonly=0.3%  headB=0.8%  | pos1..: -1.7 1.3 -1.4
# mean fight
all     base=1.4%  gonly=-1.3%  headB=-2.0%  | pos1..: -1.0 -0.9 -1.6
low     base=0.3%  gonly=-0.3%  headB=-0.2%  | pos1..: 0.3 0.6 2.1
medium  base=3.1%  gonly=-5.3%  headB=-4.8%  | pos1..: -5.6 -5.5 -8.3
high    base=1.7%  gonly=-0.9%  headB=-2.3%  | pos1..: 1.0 2.1 2.3
ultra   base=0.6%  gonly=1.5%  headB=-0.5%  | pos1..: 0.4 -0.8 -2.2
```

## f3: medium/high/ultra, head(all)/gonly/headB(all)/gonlyB, 4 rounds planned, 17:54-18:36: VOID
The watchdog stopped it at 18:36:33 after 2 complete rounds: the laptop left AC (battery 100 %, discharging; r4-power.log). Not used. Rerun as f3b after the machine was back on AC (by 19:25 per the gate output; first logged reading 19:28).

## f3b (rerun of f3, on 1cee56d): medium/high/ultra, head(all)/gonly/headB(all)/gonlyB, 4 rounds (balanced), 19:28-20:35
On AC, but the battery drained 98 → 46 % during the run (charger not keeping up); the suite frame mean rose round by round (3.20, 3.62, 3.82, 3.95 ms for head), alike for every variant. Ratios vs the kept set (head): gonly > 0 means g alone is slower.
```
HEAD 1cee56d62bd674c561ad60110e279d2755b96610  variants: head, gonly, headB, gonlyB  (2026-10-19T10:28:04.667Z)
complete: 4 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.637 (0.0%)  gonly=3.702 (1.8%)  headB=3.644 (0.2%)  gonlyB=3.725 (2.4%)
medium   head=2.839 (0.0%)  gonly=2.893 (1.9%)  headB=2.860 (0.7%)  gonlyB=2.924 (3.0%)
high     head=3.622 (0.0%)  gonly=3.686 (1.7%)  headB=3.622 (-0.0%)  gonlyB=3.698 (2.1%)
ultra    head=4.676 (0.0%)  gonly=4.759 (1.8%)  headB=4.672 (-0.1%)  gonlyB=4.779 (2.2%)

## med: geomean (paired ratio vs head)
all      head=3.616 (0.0%)  gonly=3.668 (1.4%)  headB=3.622 (0.2%)  gonlyB=3.685 (1.9%)
medium   head=2.938 (0.0%)  gonly=2.972 (1.1%)  headB=2.958 (0.7%)  gonlyB=2.998 (2.0%)
high     head=3.618 (0.0%)  gonly=3.656 (1.1%)  headB=3.602 (-0.4%)  gonlyB=3.677 (1.6%)
ultra    head=4.447 (0.0%)  gonly=4.542 (2.1%)  headB=4.460 (0.3%)  gonlyB=4.540 (2.1%)

## p95: geomean (paired ratio vs head)
all      head=5.662 (0.0%)  gonly=5.772 (1.9%)  headB=5.703 (0.7%)  gonlyB=5.828 (2.9%)
medium   head=4.523 (0.0%)  gonly=4.644 (2.7%)  headB=4.573 (1.1%)  gonlyB=4.687 (3.6%)
high     head=5.607 (0.0%)  gonly=5.712 (1.9%)  headB=5.649 (0.8%)  gonlyB=5.734 (2.3%)
ultra    head=7.158 (0.0%)  gonly=7.249 (1.3%)  headB=7.181 (0.3%)  gonlyB=7.367 (2.9%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     gonly=1.8%  gonlyB=2.4%  headB=0.2%  | pos1..: 0.1 0.2 0.7
medium  gonly=1.9%  gonlyB=3.0%  headB=0.7%  | pos1..: 0.0 0.7 1.4
high    gonly=1.7%  gonlyB=2.1%  headB=-0.0%  | pos1..: 0.2 -0.2 0.3
ultra   gonly=1.8%  gonlyB=2.2%  headB=-0.1%  | pos1..: -0.0 -0.1 0.4
# med
all     gonly=1.4%  gonlyB=1.9%  headB=0.2%  | pos1..: -0.4 0.1 0.0
medium  gonly=1.1%  gonlyB=2.0%  headB=0.7%  | pos1..: -0.2 1.1 0.5
high    gonly=1.1%  gonlyB=1.6%  headB=-0.4%  | pos1..: -0.5 -0.2 -0.4
ultra   gonly=2.1%  gonlyB=2.1%  headB=0.3%  | pos1..: -0.4 -0.4 -0.0
# p95
all     gonly=1.9%  gonlyB=2.9%  headB=0.7%  | pos1..: 0.1 0.2 1.1
medium  gonly=2.7%  gonlyB=3.6%  headB=1.1%  | pos1..: 0.0 0.3 1.6
high    gonly=1.9%  gonlyB=2.3%  headB=0.8%  | pos1..: -0.1 -1.0 1.0
ultra   gonly=1.3%  gonlyB=2.9%  headB=0.3%  | pos1..: 0.3 1.3 0.8
# cpu
all     gonly=2.2%  gonlyB=2.8%  headB=0.2%  | pos1..: 0.3 0.3 0.8
medium  gonly=2.1%  gonlyB=3.1%  headB=0.4%  | pos1..: 0.4 1.0 1.7
high    gonly=2.4%  gonlyB=2.7%  headB=0.1%  | pos1..: 0.4 -0.1 0.4
ultra   gonly=2.2%  gonlyB=2.5%  headB=-0.1%  | pos1..: 0.1 0.0 0.4
# mean path
all     gonly=1.3%  gonlyB=1.9%  headB=0.0%  | pos1..: 0.0 0.2 0.4
medium  gonly=1.3%  gonlyB=2.3%  headB=0.3%  | pos1..: -0.1 0.2 1.1
high    gonly=1.4%  gonlyB=1.6%  headB=-0.1%  | pos1..: -0.1 0.0 -0.3
ultra   gonly=1.3%  gonlyB=1.7%  headB=-0.1%  | pos1..: 0.3 0.3 0.5
# mean fight
all     gonly=2.3%  gonlyB=3.0%  headB=0.4%  | pos1..: 0.2 0.1 1.0
medium  gonly=2.5%  gonlyB=3.7%  headB=1.2%  | pos1..: 0.2 1.2 1.8
high    gonly=2.1%  gonlyB=2.6%  headB=0.1%  | pos1..: 0.6 -0.4 1.0
ultra   gonly=2.3%  gonlyB=2.7%  headB=-0.1%  | pos1..: -0.3 -0.4 0.3
```

## r4-post: void twice, not re-run
Voided by the watchdog at 20:44 (battery 39 % on AC, under the 40 % floor); rerun started 23:16 (AC, 60 %) and cut off at 23:27 by the tool's 2 h job limit in its last cell. No result file. Round 5's pre-bench `r5-pre` runs the same code and replaces it as the after-Round-4 reference.

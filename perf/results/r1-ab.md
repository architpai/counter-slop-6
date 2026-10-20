# Round 1 interleaved A/B runs (perf/ab.sh, perf/ab-agg.mjs)

Each run: every variant built once; per map x preset cell all variants back to back (`bench.mjs --no-trace`, fresh browser each), path + fight 900 frames. Ratios are geomeans of the paired variant/head ratio per cell-scenario. x1-x4 rotated the order by name length (unbalanced, review finding); x5 uses the balanced rotation of perf/ab.sh and a second HEAD build (headB) as the noise control.

Variants: head = c7a65d8. no8 = A1-A7 + B2 + B7 + C1-C3 (the pixel-exact set). exact-E2 = no8 + A8. n3 = no8 + B3. n13 = no8 + B1 + B3. a1 = A1 alone. n13-noa1 = n13 without A1. post = A2-A7 alone. bc = B2 + B7 + C alone. final = n13 + the ORM program-key fix (= commit 221ffb1).

## x1
```
complete: 4 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.455 (0.0%)  exact-E2=3.165 (-8.4%)  n13=3.073 (-11.1%)  no8=3.186 (-7.8%)
low      head=1.709 (0.0%)  exact-E2=1.675 (-2.0%)  n13=1.660 (-2.9%)  no8=1.668 (-2.4%)
medium   head=3.449 (0.0%)  exact-E2=3.084 (-10.6%)  n13=2.876 (-16.6%)  no8=3.118 (-9.6%)
high     head=4.259 (0.0%)  exact-E2=3.860 (-9.4%)  n13=3.807 (-10.6%)  no8=3.883 (-8.8%)
ultra    head=5.676 (0.0%)  exact-E2=5.030 (-11.4%)  n13=4.905 (-13.6%)  no8=5.104 (-10.1%)

## med: geomean (paired ratio vs head)
all      head=3.452 (0.0%)  exact-E2=3.233 (-6.4%)  n13=3.156 (-8.6%)  no8=3.216 (-6.9%)
low      head=1.825 (0.0%)  exact-E2=1.815 (-0.6%)  n13=1.780 (-2.5%)  no8=1.769 (-3.1%)
medium   head=3.388 (0.0%)  exact-E2=3.167 (-6.5%)  n13=3.062 (-9.6%)  no8=3.143 (-7.2%)
high     head=4.101 (0.0%)  exact-E2=3.790 (-7.6%)  n13=3.712 (-9.5%)  no8=3.822 (-6.8%)
ultra    head=5.604 (0.0%)  exact-E2=5.011 (-10.6%)  n13=4.907 (-12.4%)  no8=5.034 (-10.2%)

## p95: geomean (paired ratio vs head)
all      head=5.124 (0.0%)  exact-E2=4.821 (-5.9%)  n13=4.703 (-8.2%)  no8=4.830 (-5.7%)
low      head=3.007 (0.0%)  exact-E2=2.957 (-1.6%)  n13=2.955 (-1.7%)  no8=2.934 (-2.4%)
medium   head=5.094 (0.0%)  exact-E2=4.710 (-7.5%)  n13=4.371 (-14.2%)  no8=4.733 (-7.1%)
high     head=6.094 (0.0%)  exact-E2=5.682 (-6.8%)  n13=5.641 (-7.4%)  no8=5.685 (-6.7%)
ultra    head=7.384 (0.0%)  exact-E2=6.826 (-7.6%)  n13=6.712 (-9.1%)  no8=6.894 (-6.6%)
```

## x2
```
complete: 4 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.522 (0.0%)  n13=3.077 (-12.6%)  n3=3.174 (-9.9%)  no8=3.215 (-8.7%)
low      head=1.720 (0.0%)  n13=1.662 (-3.4%)  n3=1.670 (-2.9%)  no8=1.669 (-3.0%)
medium   head=3.616 (0.0%)  n13=2.896 (-19.9%)  n3=3.119 (-13.8%)  no8=3.202 (-11.5%)
high     head=4.289 (0.0%)  n13=3.791 (-11.6%)  n3=3.862 (-10.0%)  no8=3.919 (-8.6%)
ultra    head=5.769 (0.0%)  n13=4.916 (-14.8%)  n3=5.043 (-12.6%)  no8=5.104 (-11.5%)

## med: geomean (paired ratio vs head)
all      head=3.504 (0.0%)  n13=3.169 (-9.6%)  n3=3.226 (-7.9%)  no8=3.250 (-7.3%)
low      head=1.862 (0.0%)  n13=1.795 (-3.6%)  n3=1.800 (-3.4%)  no8=1.795 (-3.6%)
medium   head=3.464 (0.0%)  n13=3.082 (-11.0%)  n3=3.206 (-7.4%)  no8=3.202 (-7.6%)
high     head=4.116 (0.0%)  n13=3.734 (-9.3%)  n3=3.747 (-9.0%)  no8=3.854 (-6.4%)
ultra    head=5.680 (0.0%)  n13=4.884 (-14.0%)  n3=5.011 (-11.8%)  no8=5.034 (-11.4%)

## p95: geomean (paired ratio vs head)
all      head=5.226 (0.0%)  n13=4.686 (-10.3%)  n3=4.884 (-6.6%)  no8=4.869 (-6.8%)
low      head=2.993 (0.0%)  n13=2.920 (-2.5%)  n3=2.958 (-1.2%)  no8=2.958 (-1.2%)
medium   head=5.416 (0.0%)  n13=4.416 (-18.5%)  n3=4.800 (-11.4%)  no8=4.821 (-11.0%)
high     head=6.090 (0.0%)  n13=5.570 (-8.5%)  n3=5.796 (-4.8%)  no8=5.712 (-6.2%)
ultra    head=7.554 (0.0%)  n13=6.712 (-11.1%)  n3=6.913 (-8.5%)  no8=6.903 (-8.6%)
```

## x3
```
complete: 3 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.485 (0.0%)  a1=3.382 (-2.9%)  n13-noa1=3.179 (-8.8%)
low      head=1.737 (0.0%)  a1=1.728 (-0.5%)  n13-noa1=1.749 (0.7%)
medium   head=3.549 (0.0%)  a1=3.351 (-5.6%)  n13-noa1=3.075 (-13.4%)
high     head=4.205 (0.0%)  a1=4.027 (-4.2%)  n13-noa1=3.756 (-10.7%)
ultra    head=5.686 (0.0%)  a1=5.610 (-1.3%)  n13-noa1=5.055 (-11.1%)

## med: geomean (paired ratio vs head)
all      head=3.477 (0.0%)  a1=3.407 (-2.0%)  n13-noa1=3.248 (-6.6%)
low      head=1.836 (0.0%)  a1=1.861 (1.4%)  n13-noa1=1.850 (0.8%)
medium   head=3.559 (0.0%)  a1=3.365 (-5.5%)  n13-noa1=3.163 (-11.1%)
high     head=4.071 (0.0%)  a1=3.953 (-2.9%)  n13-noa1=3.769 (-7.4%)
ultra    head=5.497 (0.0%)  a1=5.443 (-1.0%)  n13-noa1=5.048 (-8.2%)

## p95: geomean (paired ratio vs head)
all      head=5.310 (0.0%)  a1=5.114 (-3.7%)  n13-noa1=4.856 (-8.5%)
low      head=3.041 (0.0%)  a1=3.019 (-0.7%)  n13-noa1=3.059 (0.6%)
medium   head=5.516 (0.0%)  a1=4.965 (-10.0%)  n13-noa1=4.693 (-14.9%)
high     head=5.951 (0.0%)  a1=5.778 (-2.9%)  n13-noa1=5.624 (-5.5%)
ultra    head=7.962 (0.0%)  a1=7.896 (-0.8%)  n13-noa1=6.887 (-13.5%)
```

## x4
```
complete: 4 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.167 (0.0%)  bc=3.074 (-2.9%)  final=2.782 (-12.2%)  post=2.981 (-5.9%)
low      head=1.678 (0.0%)  bc=1.660 (-1.1%)  final=1.646 (-1.9%)  post=1.633 (-2.6%)
medium   head=3.227 (0.0%)  bc=3.076 (-4.7%)  final=2.630 (-18.5%)  post=2.876 (-10.9%)
high     head=3.796 (0.0%)  bc=3.686 (-2.9%)  final=3.341 (-12.0%)  post=3.502 (-7.7%)
ultra    head=4.895 (0.0%)  bc=4.746 (-3.1%)  final=4.143 (-15.4%)  post=4.797 (-2.0%)

## med: geomean (paired ratio vs head)
all      head=3.188 (0.0%)  bc=3.119 (-2.1%)  final=2.856 (-10.4%)  post=3.044 (-4.5%)
low      head=1.824 (0.0%)  bc=1.815 (-0.5%)  final=1.779 (-2.5%)  post=1.790 (-1.9%)
medium   head=3.125 (0.0%)  bc=3.094 (-1.0%)  final=2.765 (-11.5%)  post=2.950 (-5.6%)
high     head=3.697 (0.0%)  bc=3.594 (-2.8%)  final=3.349 (-9.4%)  post=3.424 (-7.4%)
ultra    head=4.899 (0.0%)  bc=4.691 (-4.2%)  final=4.041 (-17.5%)  post=4.749 (-3.1%)

## p95: geomean (paired ratio vs head)
all      head=4.675 (0.0%)  bc=4.590 (-1.8%)  final=4.294 (-8.1%)  post=4.515 (-3.4%)
low      head=2.925 (0.0%)  bc=2.893 (-1.1%)  final=2.879 (-1.6%)  post=2.853 (-2.4%)
medium   head=4.833 (0.0%)  bc=4.618 (-4.4%)  final=4.158 (-14.0%)  post=4.410 (-8.8%)
high     head=5.287 (0.0%)  bc=5.265 (-0.4%)  final=4.973 (-5.9%)  post=4.967 (-6.1%)
ultra    head=6.391 (0.0%)  bc=6.311 (-1.3%)  final=5.711 (-10.6%)  post=6.649 (4.0%)
```

## x5
```
complete: 3 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.946 (0.0%)  final=2.587 (-12.2%)  headB=2.943 (-0.1%)
low      head=1.703 (0.0%)  final=1.658 (-2.6%)  headB=1.694 (-0.5%)
medium   head=2.732 (0.0%)  final=2.304 (-15.7%)  headB=2.707 (-0.9%)
high     head=3.501 (0.0%)  final=2.988 (-14.7%)  headB=3.539 (1.1%)
ultra    head=4.625 (0.0%)  final=3.924 (-15.1%)  headB=4.623 (-0.0%)

## med: geomean (paired ratio vs head)
all      head=3.054 (0.0%)  final=2.699 (-11.6%)  headB=3.043 (-0.4%)
low      head=1.846 (0.0%)  final=1.783 (-3.4%)  headB=1.835 (-0.6%)
medium   head=2.883 (0.0%)  final=2.474 (-14.2%)  headB=2.849 (-1.2%)
high     head=3.523 (0.0%)  final=3.165 (-10.2%)  headB=3.544 (0.6%)
ultra    head=4.637 (0.0%)  final=3.800 (-18.0%)  headB=4.624 (-0.3%)

## p95: geomean (paired ratio vs head)
all      head=4.371 (0.0%)  final=3.951 (-9.6%)  headB=4.375 (0.1%)
low      head=2.983 (0.0%)  final=2.921 (-2.1%)  headB=2.994 (0.4%)
medium   head=4.058 (0.0%)  final=3.614 (-11.0%)  headB=4.059 (0.0%)
high     head=4.937 (0.0%)  final=4.257 (-13.8%)  headB=4.950 (0.3%)
ultra    head=6.105 (0.0%)  final=5.422 (-11.2%)  headB=6.091 (-0.2%)
```

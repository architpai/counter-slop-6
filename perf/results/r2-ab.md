# Round 2 interleaved A/B runs (perf/ab.sh, perf/ab-agg.mjs)

HEAD = 601916a (= Round 1 code). Each run: every variant built once; per map x preset cell all variants back to back (`bench.mjs --no-trace`, fresh browser each), path + fight 900 frames, cyclic rotation; headB = a second HEAD build (noise control). The fight/path cpu and heap tables come from `/tmp/r2/fight.py` (same pairing, per scenario; cpu = callback wall incl. GPU waits).

Variants: a-mats = A (first version: moved the Math.random stream, not measured), a-mats2 = A with quietly() (kept), b-ray = B (kept), c1-nav = C1 (rejected), c2-fx = C2 (rejected), d-post2 = D (rejected), keep3 = a-mats2 + b-ray + d-post2, final = a-mats2 + b-ray (= commit 82ee6e1).

## s1 (2 rounds; s3: 3 rounds, exactly balanced)
```
HEAD 601916a9357a2f92d93c0538b7f86e67ca4bd533  variants: head, headB, b-ray, c1-nav, c2-fx  (2026-10-18T15:05:42.049Z)
complete: 5 variants x 64 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.258 (0.0%)  headB=3.260 (0.1%)  b-ray=3.202 (-1.7%)  c1-nav=3.232 (-0.8%)  c2-fx=3.244 (-0.4%)
low      head=1.676 (0.0%)  headB=1.693 (1.0%)  b-ray=1.663 (-0.8%)  c1-nav=1.675 (-0.1%)  c2-fx=1.686 (0.6%)
medium   head=3.188 (0.0%)  headB=3.172 (-0.5%)  b-ray=3.082 (-3.3%)  c1-nav=3.088 (-3.2%)  c2-fx=3.093 (-3.0%)
high     head=4.077 (0.0%)  headB=4.103 (0.6%)  b-ray=4.029 (-1.2%)  c1-nav=4.106 (0.7%)  c2-fx=4.132 (1.3%)
ultra    head=5.173 (0.0%)  headB=5.125 (-0.9%)  b-ray=5.091 (-1.6%)  c1-nav=5.137 (-0.7%)  c2-fx=5.140 (-0.7%)

## med: geomean (paired ratio vs head)
all      head=3.289 (0.0%)  headB=3.297 (0.2%)  b-ray=3.241 (-1.5%)  c1-nav=3.271 (-0.5%)  c2-fx=3.287 (-0.1%)
low      head=1.786 (0.0%)  headB=1.814 (1.5%)  b-ray=1.779 (-0.4%)  c1-nav=1.782 (-0.2%)  c2-fx=1.805 (1.0%)
medium   head=3.238 (0.0%)  headB=3.251 (0.4%)  b-ray=3.130 (-3.3%)  c1-nav=3.171 (-2.1%)  c2-fx=3.185 (-1.6%)
high     head=3.941 (0.0%)  headB=3.942 (0.0%)  b-ray=3.927 (-0.4%)  c1-nav=3.984 (1.1%)  c2-fx=3.978 (0.9%)
ultra    head=5.134 (0.0%)  headB=5.086 (-0.9%)  b-ray=5.047 (-1.7%)  c1-nav=5.085 (-1.0%)  c2-fx=5.108 (-0.5%)

## p95: geomean (paired ratio vs head)
all      head=5.121 (0.0%)  headB=5.110 (-0.2%)  b-ray=5.007 (-2.2%)  c1-nav=5.055 (-1.3%)  c2-fx=5.057 (-1.3%)
low      head=2.957 (0.0%)  headB=2.974 (0.6%)  b-ray=2.932 (-0.8%)  c1-nav=2.937 (-0.7%)  c2-fx=2.970 (0.4%)
medium   head=5.069 (0.0%)  headB=4.990 (-1.6%)  b-ray=4.807 (-5.2%)  c1-nav=4.832 (-4.7%)  c2-fx=4.836 (-4.6%)
high     head=6.196 (0.0%)  headB=6.352 (2.5%)  b-ray=6.111 (-1.4%)  c1-nav=6.340 (2.3%)  c2-fx=6.286 (1.4%)
ultra    head=7.406 (0.0%)  headB=7.235 (-2.3%)  b-ray=7.295 (-1.5%)  c1-nav=7.254 (-2.1%)  c2-fx=7.243 (-2.2%)

## fight frameMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=+2.0% b-ray=-0.5% c1-nav=+0.4% c2-fx=+1.1%
medium  head=+0.0% headB=-1.3% b-ray=-5.1% c1-nav=-4.6% c2-fx=-3.9%
high    head=+0.0% headB=-0.2% b-ray=-2.9% c1-nav=+0.7% c2-fx=+2.0%
ultra   head=+0.0% headB=-1.1% b-ray=-1.9% c1-nav=-0.4% c2-fx=-0.4%
all     head=+0.0% headB=-0.1% b-ray=-2.7% c1-nav=-1.0% c2-fx=-0.3%
## fight cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=+1.8% b-ray=-1.3% c1-nav=+0.2% c2-fx=+0.9%
medium  head=+0.0% headB=-1.5% b-ray=-5.9% c1-nav=-5.7% c2-fx=-4.3%
high    head=+0.0% headB=-1.3% b-ray=-4.8% c1-nav=-0.0% c2-fx=+0.7%
ultra   head=+0.0% headB=-1.4% b-ray=-2.8% c1-nav=-1.2% c2-fx=-1.3%
all     head=+0.0% headB=-0.6% b-ray=-3.7% c1-nav=-1.7% c2-fx=-1.0%
per map (all presets):
  downtown  head=+0.0% headB=-4.5% b-ray=-4.0% c1-nav=-4.2% c2-fx=-4.9%
  house     head=+0.0% headB=+0.5% b-ray=-2.9% c1-nav=-0.5% c2-fx=+1.3%
  mexico    head=+0.0% headB=+1.3% b-ray=+0.6% c1-nav=-1.3% c2-fx=-0.5%
  training  head=+0.0% headB=+0.3% b-ray=-8.2% c1-nav=-0.7% c2-fx=+0.1%
## path cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=+0.1% b-ray=-0.7% c1-nav=-0.2% c2-fx=+0.2%
medium  head=+0.0% headB=+0.2% b-ray=-1.4% c1-nav=-1.4% c2-fx=-2.1%
high    head=+0.0% headB=+1.3% b-ray=+0.4% c1-nav=+0.7% c2-fx=+0.7%
ultra   head=+0.0% headB=-0.7% b-ray=-1.0% c1-nav=-0.8% c2-fx=-0.7%
all     head=+0.0% headB=+0.2% b-ray=-0.7% c1-nav=-0.4% c2-fx=-0.5%
## fight heapPeakMB   (geomean paired ratio vs head)
low     head=+0.0% headB=-2.4% b-ray=-2.5% c1-nav=-1.6% c2-fx=-1.4%
medium  head=+0.0% headB=-4.0% b-ray=-6.4% c1-nav=-0.7% c2-fx=-3.3%
high    head=+0.0% headB=+1.3% b-ray=+4.6% c1-nav=+1.9% c2-fx=-0.7%
ultra   head=+0.0% headB=+2.3% b-ray=-3.0% c1-nav=+2.4% c2-fx=-0.5%
all     head=+0.0% headB=-0.7% b-ray=-1.9% c1-nav=+0.5% c2-fx=-1.5%
```

## s2 (2 rounds; s3: 3 rounds, exactly balanced)
```
HEAD 601916a9357a2f92d93c0538b7f86e67ca4bd533  variants: head, headB, a-mats2, d-post2, keep3  (2026-10-18T16:03:42.576Z)
complete: 5 variants x 64 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.329 (0.0%)  headB=3.331 (0.1%)  a-mats2=3.264 (-2.0%)  d-post2=3.298 (-0.9%)  keep3=3.235 (-2.8%)
low      head=1.676 (0.0%)  headB=1.675 (-0.1%)  a-mats2=1.665 (-0.7%)  d-post2=1.672 (-0.2%)  keep3=1.650 (-1.5%)
medium   head=3.261 (0.0%)  headB=3.241 (-0.6%)  a-mats2=3.148 (-3.5%)  d-post2=3.192 (-2.1%)  keep3=3.123 (-4.2%)
high     head=4.245 (0.0%)  headB=4.196 (-1.2%)  a-mats2=4.151 (-2.2%)  d-post2=4.195 (-1.2%)  keep3=4.093 (-3.6%)
ultra    head=5.295 (0.0%)  headB=5.407 (2.1%)  a-mats2=5.216 (-1.5%)  d-post2=5.284 (-0.2%)  keep3=5.194 (-1.9%)

## med: geomean (paired ratio vs head)
all      head=3.349 (0.0%)  headB=3.362 (0.4%)  a-mats2=3.273 (-2.3%)  d-post2=3.314 (-1.0%)  keep3=3.254 (-2.8%)
low      head=1.786 (0.0%)  headB=1.802 (0.9%)  a-mats2=1.754 (-1.8%)  d-post2=1.763 (-1.3%)  keep3=1.739 (-2.6%)
medium   head=3.320 (0.0%)  headB=3.286 (-1.0%)  a-mats2=3.184 (-4.1%)  d-post2=3.238 (-2.5%)  keep3=3.184 (-4.1%)
high     head=4.071 (0.0%)  headB=4.061 (-0.2%)  a-mats2=3.994 (-1.9%)  d-post2=4.065 (-0.1%)  keep3=3.976 (-2.3%)
ultra    head=5.213 (0.0%)  headB=5.313 (1.9%)  a-mats2=5.141 (-1.4%)  d-post2=5.199 (-0.3%)  keep3=5.093 (-2.3%)

## p95: geomean (paired ratio vs head)
all      head=5.256 (0.0%)  headB=5.261 (0.1%)  a-mats2=5.163 (-1.8%)  d-post2=5.189 (-1.3%)  keep3=5.108 (-2.8%)
low      head=2.951 (0.0%)  headB=2.956 (0.2%)  a-mats2=2.965 (0.5%)  d-post2=2.951 (-0.0%)  keep3=2.917 (-1.2%)
medium   head=5.161 (0.0%)  headB=5.089 (-1.4%)  a-mats2=4.907 (-4.9%)  d-post2=5.029 (-2.6%)  keep3=4.936 (-4.4%)
high     head=6.590 (0.0%)  headB=6.411 (-2.7%)  a-mats2=6.520 (-1.1%)  d-post2=6.442 (-2.2%)  keep3=6.314 (-4.2%)
ultra    head=7.605 (0.0%)  headB=7.944 (4.5%)  a-mats2=7.491 (-1.5%)  d-post2=7.585 (-0.3%)  keep3=7.489 (-1.5%)

## fight frameMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=+0.4% a-mats2=-0.7% d-post2=-0.0% keep3=-2.5%
medium  head=+0.0% headB=-0.6% a-mats2=-5.8% d-post2=-2.1% keep3=-7.5%
high    head=+0.0% headB=-1.0% a-mats2=-3.5% d-post2=-0.7% keep3=-5.8%
ultra   head=+0.0% headB=+1.8% a-mats2=-3.1% d-post2=-0.1% keep3=-2.6%
all     head=+0.0% headB=+0.1% a-mats2=-3.3% d-post2=-0.7% keep3=-4.6%
## fight cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=+0.2% a-mats2=-1.6% d-post2=+0.1% keep3=-3.4%
medium  head=+0.0% headB=-0.2% a-mats2=-6.3% d-post2=-1.4% keep3=-9.3%
high    head=+0.0% headB=-0.4% a-mats2=-3.3% d-post2=+0.6% keep3=-6.1%
ultra   head=+0.0% headB=+1.7% a-mats2=-4.1% d-post2=+0.2% keep3=-3.5%
all     head=+0.0% headB=+0.3% a-mats2=-3.8% d-post2=-0.1% keep3=-5.6%
per map (all presets):
  downtown  head=+0.0% headB=-1.9% a-mats2=-1.9% d-post2=-0.4% keep3=-1.3%
  house     head=+0.0% headB=+0.9% a-mats2=-2.8% d-post2=-0.7% keep3=-1.8%
  mexico    head=+0.0% headB=-0.8% a-mats2=-1.9% d-post2=+0.0% keep3=-2.0%
  training  head=+0.0% headB=+3.1% a-mats2=-8.5% d-post2=+0.5% keep3=-16.3%
## path cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-0.5% a-mats2=-0.7% d-post2=-0.6% keep3=-0.5%
medium  head=+0.0% headB=-0.5% a-mats2=-0.7% d-post2=-1.9% keep3=-0.6%
high    head=+0.0% headB=-1.2% a-mats2=-1.0% d-post2=-1.6% keep3=-1.1%
ultra   head=+0.0% headB=+2.0% a-mats2=+0.1% d-post2=-0.4% keep3=-1.2%
all     head=+0.0% headB=-0.0% a-mats2=-0.6% d-post2=-1.1% keep3=-0.9%
## fight heapPeakMB   (geomean paired ratio vs head)
low     head=+0.0% headB=-2.4% a-mats2=-1.8% d-post2=+1.6% keep3=-1.7%
medium  head=+0.0% headB=-1.5% a-mats2=-1.4% d-post2=-3.6% keep3=-1.9%
high    head=+0.0% headB=+1.3% a-mats2=+8.2% d-post2=+7.8% keep3=-0.9%
ultra   head=+0.0% headB=-0.5% a-mats2=+0.2% d-post2=-1.9% keep3=-0.1%
all     head=+0.0% headB=-0.8% a-mats2=+1.2% d-post2=+0.9% keep3=-1.2%
```

## s3 (2 rounds; s3: 3 rounds, exactly balanced)
```
HEAD 601916a9357a2f92d93c0538b7f86e67ca4bd533  variants: head, headB, final  (2026-10-18T16:54:27.099Z)
complete: 3 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=4.167 (0.0%)  headB=4.141 (-0.6%)  final=4.068 (-2.4%)
low      head=1.804 (0.0%)  headB=1.795 (-0.5%)  final=1.762 (-2.3%)
medium   head=4.502 (0.0%)  headB=4.422 (-1.8%)  final=4.370 (-2.9%)
high     head=5.409 (0.0%)  headB=5.421 (0.2%)  final=5.284 (-2.3%)
ultra    head=6.863 (0.0%)  headB=6.832 (-0.4%)  final=6.728 (-2.0%)

## med: geomean (paired ratio vs head)
all      head=4.037 (0.0%)  headB=4.026 (-0.3%)  final=3.981 (-1.4%)
low      head=1.909 (0.0%)  headB=1.900 (-0.5%)  final=1.867 (-2.2%)
medium   head=4.101 (0.0%)  headB=4.087 (-0.3%)  final=4.043 (-1.4%)
high     head=5.078 (0.0%)  headB=5.102 (0.5%)  final=5.058 (-0.4%)
ultra    head=6.682 (0.0%)  headB=6.634 (-0.7%)  final=6.578 (-1.6%)

## p95: geomean (paired ratio vs head)
all      head=6.958 (0.0%)  headB=6.953 (-0.1%)  final=6.753 (-3.0%)
low      head=3.110 (0.0%)  headB=3.117 (0.2%)  final=3.069 (-1.3%)
medium   head=7.983 (0.0%)  headB=7.879 (-1.3%)  final=7.758 (-2.8%)
high     head=9.069 (0.0%)  headB=9.137 (0.8%)  final=8.690 (-4.2%)
ultra    head=10.415 (0.0%)  headB=10.413 (-0.0%)  final=10.054 (-3.5%)

## fight frameMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-0.4% final=-3.5%
medium  head=+0.0% headB=+3.6% final=-5.0%
high    head=+0.0% headB=-0.4% final=-4.6%
ultra   head=+0.0% headB=-0.4% final=-3.8%
all     head=+0.0% headB=+0.6% final=-4.2%
## fight cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-0.1% final=-4.7%
medium  head=+0.0% headB=+6.2% final=-7.1%
high    head=+0.0% headB=-0.2% final=-6.0%
ultra   head=+0.0% headB=-0.4% final=-4.6%
all     head=+0.0% headB=+1.3% final=-5.6%
per map (all presets):
  downtown  head=+0.0% headB=+8.3% final=-3.2%
  house     head=+0.0% headB=-0.6% final=-3.5%
  mexico    head=+0.0% headB=-0.6% final=-0.8%
  training  head=+0.0% headB=-1.4% final=-14.4%
## path cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-0.7% final=-1.3%
medium  head=+0.0% headB=-6.6% final=-0.5%
high    head=+0.0% headB=+0.8% final=-0.1%
ultra   head=+0.0% headB=-0.8% final=+0.1%
all     head=+0.0% headB=-1.9% final=-0.4%
## fight heapPeakMB   (geomean paired ratio vs head)
low     head=+0.0% headB=-1.8% final=-1.3%
medium  head=+0.0% headB=-3.9% final=-3.3%
high    head=+0.0% headB=-4.1% final=-1.8%
ultra   head=+0.0% headB=+18.6% final=+9.1%
all     head=+0.0% headB=+1.8% final=+0.5%
```

## t2: paired TRACED run, head vs final (1 round, order alternating per cell; js = traced main-thread ms)

Ran with the battery at 7 % (machine throttled, ~1.4x slower than baseline). ultra/house's head arm caught a fast spell (path 2.93 ms vs 5.2-5.7 ms in every other ultra path), which skews the ultra row; see LOG.md.
```
## mean
  low     path+fight head=1.847 final=1.836 (-0.6%, -0.012 ms)
  low     fight      head=2.199 final=2.142 (-2.6%, -0.057 ms)
  medium  path+fight head=5.064 final=4.731 (-6.6%, -0.333 ms)
  medium  fight      head=6.283 final=5.700 (-9.3%, -0.584 ms)
  high    path+fight head=5.510 final=5.243 (-4.8%, -0.266 ms)
  high    fight      head=6.525 final=6.195 (-5.0%, -0.329 ms)
  ultra   path+fight head=5.654 final=5.976 (+5.7%, +0.322 ms)
  ultra   fight      head=6.800 final=6.714 (-1.3%, -0.087 ms)
  all     path+fight head=4.132 final=4.062 (-1.7%, -0.070 ms)
  all     fight      head=4.976 final=4.747 (-4.6%, -0.229 ms)
## med
  low     path+fight head=2.029 final=2.014 (-0.7%, -0.015 ms)
  low     fight      head=2.052 final=1.998 (-2.6%, -0.054 ms)
  medium  path+fight head=4.837 final=4.590 (-5.1%, -0.247 ms)
  medium  fight      head=5.641 final=5.172 (-8.3%, -0.469 ms)
  high    path+fight head=5.124 final=4.976 (-2.9%, -0.148 ms)
  high    fight      head=5.815 final=5.575 (-4.1%, -0.241 ms)
  ultra   path+fight head=5.359 final=5.703 (+6.4%, +0.344 ms)
  ultra   fight      head=6.090 final=6.265 (+2.9%, +0.175 ms)
  all     path+fight head=4.052 final=4.025 (-0.7%, -0.027 ms)
  all     fight      head=4.500 final=4.359 (-3.1%, -0.141 ms)
## p95
  low     path+fight head=3.243 final=3.217 (-0.8%, -0.027 ms)
  low     fight      head=3.724 final=3.632 (-2.5%, -0.092 ms)
  medium  path+fight head=8.735 final=8.227 (-5.8%, -0.508 ms)
  medium  fight      head=11.693 final=10.797 (-7.7%, -0.896 ms)
  high    path+fight head=9.444 final=8.757 (-7.3%, -0.687 ms)
  high    fight      head=11.997 final=11.231 (-6.4%, -0.767 ms)
  ultra   path+fight head=8.895 final=9.051 (+1.8%, +0.156 ms)
  ultra   fight      head=11.755 final=11.449 (-2.6%, -0.306 ms)
  all     path+fight head=6.984 final=6.767 (-3.1%, -0.217 ms)
  all     fight      head=8.852 final=8.427 (-4.8%, -0.425 ms)
## js
  low     path+fight head=0.611 final=0.598 (-2.1%, -0.013 ms)
  low     fight      head=1.138 final=1.121 (-1.5%, -0.017 ms)
  medium  path+fight head=2.223 final=2.221 (-0.1%, -0.002 ms)
  medium  fight      head=4.491 final=4.185 (-6.8%, -0.307 ms)
  high    path+fight head=2.685 final=2.477 (-7.7%, -0.208 ms)
  high    fight      head=5.294 final=4.538 (-14.3%, -0.757 ms)
  ultra   path+fight head=2.425 final=2.541 (+4.8%, +0.116 ms)
  ultra   fight      head=4.250 final=4.976 (+17.1%, +0.726 ms)
  all     path+fight head=1.725 final=1.700 (-1.4%, -0.024 ms)
  all     fight      head=3.275 final=3.208 (-2.0%, -0.066 ms)
## training fight js per preset
  low 2.014 -> 1.968 (-2.3%)
  medium 5.546 -> 5.069 (-8.6%)
  high 6.248 -> 5.249 (-16.0%)
  ultra 6.024 -> 5.503 (-8.6%)
## hash/calls/tris/programs equality
  diff house medium fight triangles 426776 426336
  diff downtown high fight calls 306 307
  diff house high fight triangles 820550 820202
  diff mexico high fight triangles 666146 666837
  diff mexico ultra fight triangles 870636 880058
```

## s4: independent balanced repeat after review 1 (3 rounds; HEAD = 82ee6e1 = final, r1code = reverse patch to the Round 1 code; ratios are OLD/NEW)

Power state switched during round 1 (first cells ~2.1 ms, later 3.5-8 ms, sometimes inside one cell's triplet): headB/head reads +8.3 % on medium.
```
HEAD 82ee6e12bba6a1138443f26abf08b9cdfca9476d  variants: head, headB, r1code  (2026-10-18T19:05:48.140Z)
complete: 3 variants x 96 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.908 (0.0%)  headB=3.988 (2.1%)  r1code=4.044 (3.5%)
low      head=1.802 (0.0%)  headB=1.782 (-1.1%)  r1code=1.811 (0.5%)
medium   head=3.860 (0.0%)  headB=4.179 (8.3%)  r1code=4.231 (9.6%)
high     head=4.952 (0.0%)  headB=4.973 (0.4%)  r1code=5.064 (2.3%)
ultra    head=6.768 (0.0%)  headB=6.828 (0.9%)  r1code=6.889 (1.8%)

## med: geomean (paired ratio vs head)
all      head=3.849 (0.0%)  headB=3.918 (1.8%)  r1code=3.957 (2.8%)
low      head=1.890 (0.0%)  headB=1.883 (-0.4%)  r1code=1.906 (0.9%)
medium   head=3.707 (0.0%)  headB=3.950 (6.6%)  r1code=4.009 (8.1%)
high     head=4.758 (0.0%)  headB=4.784 (0.6%)  r1code=4.798 (0.8%)
ultra    head=6.584 (0.0%)  headB=6.623 (0.6%)  r1code=6.684 (1.5%)

## p95: geomean (paired ratio vs head)
all      head=6.430 (0.0%)  headB=6.638 (3.2%)  r1code=6.753 (5.0%)
low      head=3.144 (0.0%)  headB=3.121 (-0.7%)  r1code=3.159 (0.5%)
medium   head=6.703 (0.0%)  headB=7.356 (9.7%)  r1code=7.387 (10.2%)
high     head=7.998 (0.0%)  headB=8.139 (1.8%)  r1code=8.351 (4.4%)
ultra    head=10.144 (0.0%)  headB=10.391 (2.4%)  r1code=10.674 (5.2%)

## fight frameMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-2.1% r1code=+0.7%
medium  head=+0.0% headB=+10.9% r1code=+11.3%
high    head=+0.0% headB=+1.1% r1code=+4.5%
ultra   head=+0.0% headB=+2.4% r1code=+5.1%
all     head=+0.0% headB=+3.0% r1code=+5.3%
## fight cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-2.6% r1code=+1.9%
medium  head=+0.0% headB=+10.3% r1code=+13.2%
high    head=+0.0% headB=+1.4% r1code=+6.2%
ultra   head=+0.0% headB=+2.1% r1code=+7.5%
all     head=+0.0% headB=+2.7% r1code=+7.1%
per map (all presets):
  downtown  head=+0.0% headB=+0.9% r1code=+3.3%
  house     head=+0.0% headB=+3.2% r1code=+3.6%
  mexico    head=+0.0% headB=+4.4% r1code=+6.6%
  training  head=+0.0% headB=+2.5% r1code=+15.4%
## path cpuMs mean  (geomean paired ratio vs head)
low     head=+0.0% headB=-0.3% r1code=-0.2%
medium  head=+0.0% headB=+6.2% r1code=+7.1%
high    head=+0.0% headB=-0.4% r1code=+0.2%
ultra   head=+0.0% headB=+0.1% r1code=-2.1%
all     head=+0.0% headB=+1.4% r1code=+1.2%
## fight heapPeakMB   (geomean paired ratio vs head)
low     head=+0.0% headB=-0.5% r1code=+0.8%
medium  head=+0.0% headB=+1.4% r1code=+2.3%
high    head=+0.0% headB=+5.3% r1code=-0.2%
ultra   head=+0.0% headB=+1.3% r1code=-1.2%
all     head=+0.0% headB=+1.9% r1code=+0.4%
```

## Control-filtered view (s3, s4): only triplets where headB/head is within 3 %, variant vs the geomean of head and headB, NEW/OLD
```
s3 final vs HEAD:
mean  low -2.9% (18/24) | medium +1.0% (12/24) | high -1.5% (17/24) | ultra -2.0% (17/24) | all -1.6% (64/96)
med   low -1.8% (15/24) | medium +1.0% (14/24) | high +1.1% (17/24) | ultra -1.9% (15/24) | all -0.4% (61/96)
p95   low -0.7% (11/24) | medium +2.0% (12/24) | high -3.8% (11/24) | ultra -1.3% (14/24) | all -1.0% (48/96)
s4 final vs r1code:
mean  low -1.4% (15/24) | medium -3.2% (10/24) | high -1.8% (15/24) | ultra -1.9% (17/24) | all -2.0% (57/96)
med   low -0.5% (12/24) | medium -3.0% (10/24) | high -0.0% (14/24) | ultra -1.5% (16/24) | all -1.2% (52/96)
p95   low -0.8% (10/24) | medium -0.3% (9/24) | high -3.9% (9/24) | ultra -8.5% (8/24) | all -3.2% (36/96)
```

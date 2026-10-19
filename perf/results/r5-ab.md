# Round 5 paired A/B runs

Power and thermal readings: `perf/results/r5-power.log`. Charger: 20 W USB-C (pmset -g ac), so runs were cut to fit 50 % -> 35 %.

## r5L (traced, AB_TRACE=1): low x downtown/house/mexico/training, head/low1/headB/dr, 3 rounds (balanced: 4 maps = 4 variants), 01:02-01:17
```
HEAD 7c00ea2a565e84a10eb9bf65d83e539295d0b9ef  variants: head, low1, headB, dr  (2026-10-19T16:01:47.988Z)
complete: 4 variants x 24 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=1.623 (0.0%)  low1=1.612 (-0.7%)  headB=1.626 (0.2%)  dr=1.613 (-0.6%)
low      head=1.623 (0.0%)  low1=1.612 (-0.7%)  headB=1.626 (0.2%)  dr=1.613 (-0.6%)

## med: geomean (paired ratio vs head)
all      head=1.773 (0.0%)  low1=1.764 (-0.5%)  headB=1.777 (0.2%)  dr=1.762 (-0.6%)
low      head=1.773 (0.0%)  low1=1.764 (-0.5%)  headB=1.777 (0.2%)  dr=1.762 (-0.6%)

## p95: geomean (paired ratio vs head)
all      head=2.942 (0.0%)  low1=2.904 (-1.3%)  headB=2.944 (0.1%)  dr=2.937 (-0.2%)
low      head=2.942 (0.0%)  low1=2.904 (-1.3%)  headB=2.944 (0.1%)  dr=2.937 (-0.2%)

## js: geomean (paired ratio vs head)
all      head=0.547 (0.0%)  low1=0.541 (-1.2%)  headB=0.545 (-0.4%)  dr=0.544 (-0.7%)
low      head=0.547 (0.0%)  low1=0.541 (-1.2%)  headB=0.545 (-0.4%)  dr=0.544 (-0.7%)

## js (fight only): geomean (paired ratio vs head)
all      head=1.020 (0.0%)  low1=1.005 (-1.5%)  headB=1.007 (-1.3%)  dr=1.014 (-0.6%)
low      head=1.020 (0.0%)  low1=1.005 (-1.5%)  headB=1.007 (-1.3%)  dr=1.014 (-0.6%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
low     dr=-0.6%  headB=0.2%  low1=-0.7%  | pos1..: 0.1 0.5 -0.2
# mean fight
low     dr=-0.3%  headB=1.0%  low1=-0.1%  | pos1..: 0.0 0.8 -0.1
# med
low     dr=-0.6%  headB=0.2%  low1=-0.5%  | pos1..: 0.1 0.7 -1.3
# med fight
low     dr=-0.9%  headB=-0.5%  low1=-0.3%  | pos1..: 0.1 1.3 -1.1
# p95
low     dr=-0.2%  headB=0.1%  low1=-1.3%  | pos1..: 0.3 0.5 0.8
# p95 fight
low     dr=0.5%  headB=1.0%  low1=-0.6%  | pos1..: 0.6 0.6 1.1
# cpu
low     dr=0.1%  headB=-0.2%  low1=-1.0%  | pos1..: -0.9 -1.5 -0.0
# cpu fight
low     dr=1.0%  headB=0.0%  low1=-0.9%  | pos1..: -2.3 -3.0 0.0
# js
low     dr=-0.7%  headB=-0.4%  low1=-1.2%  | pos1..: -0.5 0.5 0.7
# js fight
low     dr=-0.6%  headB=-1.3%  low1=-1.5%  | pos1..: -0.8 0.7 0.1
```

Training fight (the targeted cell), geomean of 3 rounds, js ms / callback cpu ms: head 1.633 / 1.504, low1 1.582 / 1.462
(-3.1 / -2.8 %; vs headB 1.605 / 1.509: -1.4 / -3.1 %), dr 1.615 / 1.503. Calls (median, training): path 223 → 190 and
fight 470 → 431 with low1 (the merge is active); dr changes no draw count. Verdict: neither is clearly past noise →
both rejected (patches `perf/patches/r5-low1.patch`, `r5-dr.patch`).

## r5R: medium/high/ultra x downtown/house/mexico/training, head/base/dsd/headB/walk, 1 round (near-balanced: 5 variants, 4 maps), 02:11-02:31

`base` = HEAD with `git diff HEAD 2c75479 -- src tests` applied (the game code before Round 4), the Round 4 confirmation arm.
```
HEAD 7c00ea2a565e84a10eb9bf65d83e539295d0b9ef  variants: head, base, dsd, headB, walk  (2026-10-19T17:10:46.936Z)
complete: 5 variants x 24 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.355 (0.0%)  base=3.514 (4.7%)  dsd=3.284 (-2.1%)  headB=3.365 (0.3%)  walk=3.307 (-1.4%)
medium   head=2.558 (0.0%)  base=2.674 (4.5%)  dsd=2.382 (-6.9%)  headB=2.583 (1.0%)  walk=2.499 (-2.3%)
high     head=3.308 (0.0%)  base=3.490 (5.5%)  dsd=3.332 (0.7%)  headB=3.331 (0.7%)  walk=3.299 (-0.3%)
ultra    head=4.465 (0.0%)  base=4.649 (4.1%)  dsd=4.461 (-0.1%)  headB=4.427 (-0.8%)  walk=4.389 (-1.7%)

## med: geomean (paired ratio vs head)
all      head=3.443 (0.0%)  base=3.594 (4.4%)  dsd=3.393 (-1.4%)  headB=3.427 (-0.5%)  walk=3.409 (-1.0%)
medium   head=2.775 (0.0%)  base=2.821 (1.6%)  dsd=2.595 (-6.5%)  headB=2.710 (-2.4%)  walk=2.692 (-3.0%)
high     head=3.393 (0.0%)  base=3.561 (4.9%)  dsd=3.447 (1.6%)  headB=3.418 (0.7%)  walk=3.382 (-0.3%)
ultra    head=4.333 (0.0%)  base=4.622 (6.7%)  dsd=4.369 (0.8%)  headB=4.345 (0.3%)  walk=4.352 (0.4%)

## p95: geomean (paired ratio vs head)
all      head=5.000 (0.0%)  base=5.240 (4.8%)  dsd=4.893 (-2.1%)  headB=5.093 (1.9%)  walk=4.973 (-0.5%)
medium   head=4.043 (0.0%)  base=4.225 (4.5%)  dsd=3.804 (-5.9%)  headB=4.404 (8.9%)  walk=4.131 (2.2%)
high     head=4.902 (0.0%)  base=5.236 (6.8%)  dsd=4.926 (0.5%)  headB=4.917 (0.3%)  walk=4.914 (0.2%)
ultra    head=6.307 (0.0%)  base=6.504 (3.1%)  dsd=6.252 (-0.9%)  headB=6.102 (-3.2%)  walk=6.060 (-3.9%)

order-corrected fit (perf/ab-posfit.mjs):
# mean
all     base=4.6%  dsd=-2.3%  headB=0.2%  walk=-1.4%  | pos1..: -0.9 -0.6 -0.8 0.3
medium  base=4.1%  dsd=-6.9%  headB=2.3%  walk=-1.6%  | pos1..: -3.0 -4.7 -3.1 2.2
high    base=5.8%  dsd=1.0%  headB=0.7%  walk=-0.4%  | pos1..: 1.0 1.2 0.0 -0.5
ultra   base=4.1%  dsd=-0.1%  headB=-0.3%  walk=-1.8%  | pos1..: 0.3 2.6 -0.3 0.3
# med
all     base=4.3%  dsd=-1.4%  headB=-0.4%  walk=-0.9%  | pos1..: 0.6 0.4 1.0 1.3
medium  base=0.9%  dsd=-6.4%  headB=-1.9%  walk=-3.1%  | pos1..: 0.2 -2.8 0.8 2.2
high    base=5.4%  dsd=1.8%  headB=0.8%  walk=-0.2%  | pos1..: 1.6 0.7 0.4 0.7
ultra   base=6.5%  dsd=0.9%  headB=1.0%  walk=0.6%  | pos1..: 0.9 3.8 1.3 0.8
# p95
all     base=4.8%  dsd=-2.4%  headB=1.6%  walk=-0.6%  | pos1..: -2.1 -2.0 -3.2 -1.4
medium  base=3.0%  dsd=-7.0%  headB=9.8%  walk=4.2%  | pos1..: -7.4 -12.7 -11.7 -4.4
high    base=7.0%  dsd=0.6%  headB=0.2%  walk=0.5%  | pos1..: 0.7 0.5 -0.2 1.2
ultra   base=3.0%  dsd=-0.8%  headB=-2.0%  walk=-4.1%  | pos1..: 0.7 6.0 -0.3 0.6
# cpu
all     base=5.2%  dsd=-2.6%  headB=-0.4%  walk=-2.2%  | pos1..: -0.7 0.0 -0.3 1.2
medium  base=4.5%  dsd=-7.4%  headB=0.5%  walk=-3.4%  | pos1..: -1.7 -3.0 -0.8 3.9
high    base=6.6%  dsd=1.1%  headB=0.5%  walk=-1.0%  | pos1..: 1.3 2.2 -0.2 0.0
ultra   base=4.8%  dsd=-0.5%  headB=-0.6%  walk=-2.0%  | pos1..: -0.4 2.1 -0.4 0.7
# mean fight
all     base=5.3%  dsd=-2.2%  headB=-0.2%  walk=-2.1%  | pos1..: -0.6 -0.3 -0.1 0.3
medium  base=3.0%  dsd=-8.9%  headB=0.5%  walk=-3.4%  | pos1..: -2.1 -4.8 -0.7 2.9
high    base=9.1%  dsd=3.6%  headB=1.4%  walk=-0.3%  | pos1..: 1.9 2.3 0.2 -0.6
ultra   base=3.8%  dsd=0.3%  headB=-0.3%  walk=-2.5%  | pos1..: 0.8 3.4 -0.5 0.0
# cpu fight
all     base=6.4%  dsd=-2.7%  headB=-1.0%  walk=-3.5%  | pos1..: -0.5 0.9 0.7 1.8
medium  base=3.8%  dsd=-9.6%  headB=-1.9%  walk=-6.4%  | pos1..: -0.9 -2.0 3.1 6.0
high    base=11.1%  dsd=4.1%  headB=1.3%  walk=-1.3%  | pos1..: 2.7 4.4 -0.2 0.5
ultra   base=5.1%  dsd=-0.4%  headB=-0.7%  walk=-3.0%  | pos1..: -0.7 2.8 -0.9 0.5

per cell, frame mean ms (vs head):
medium downtown path  head=2.119(+0.0) base=2.134(+0.7) dsd=2.108(-0.5) headB=2.105(-0.7) walk=2.098(-1.0)
medium downtown fight head=2.292(+0.0) base=2.365(+3.2) dsd=2.290(-0.1) headB=2.347(+2.4) walk=2.286(-0.3)
medium house    path  head=2.016(+0.0) base=2.085(+3.4) dsd=2.005(-0.5) headB=2.029(+0.6) walk=2.028(+0.6)
medium house    fight head=2.403(+0.0) base=2.452(+2.0) dsd=2.404(+0.0) headB=2.407(+0.2) walk=2.400(-0.1)
medium mexico   path  head=2.206(+0.0) base=2.717(+23.2) dsd=1.954(-11.4) headB=1.979(-10.3) walk=1.973(-10.6)
medium mexico   fight head=3.399(+0.0) base=3.821(+12.4) dsd=2.477(-27.1) headB=2.464(-27.5) walk=2.540(-25.3)
medium training path  head=2.407(+0.0) base=2.318(-3.7) dsd=2.288(-4.9) headB=2.997(+24.5) walk=2.624(+9.0)
medium training fight head=4.314(+0.0) base=4.209(-2.4) dsd=4.025(-6.7) headB=5.618(+30.2) walk=4.948(+14.7)
high   downtown path  head=2.984(+0.0) base=3.081(+3.3) dsd=2.921(-2.1) headB=2.981(-0.1) walk=2.983(-0.0)
high   downtown fight head=3.729(+0.0) base=4.013(+7.6) dsd=3.963(+6.3) headB=3.798(+1.9) walk=3.757(+0.8)
high   house    path  head=2.708(+0.0) base=2.793(+3.1) dsd=2.697(-0.4) headB=2.770(+2.3) walk=2.711(+0.1)
high   house    fight head=3.795(+0.0) base=3.954(+4.2) dsd=3.814(+0.5) headB=3.907(+3.0) walk=3.720(-2.0)
high   mexico   path  head=2.812(+0.0) base=2.843(+1.1) dsd=2.737(-2.7) headB=2.768(-1.6) walk=2.771(-1.5)
high   mexico   fight head=3.859(+0.0) base=4.101(+6.3) dsd=3.984(+3.2) headB=3.873(+0.4) walk=3.838(-0.5)
high   training path  head=2.721(+0.0) base=2.792(+2.6) dsd=2.697(-0.9) headB=2.709(-0.4) walk=2.712(-0.3)
high   training fight head=4.250(+0.0) base=4.955(+16.6) dsd=4.341(+2.1) headB=4.261(+0.3) walk=4.308(+1.4)
ultra  downtown path  head=4.090(+0.0) base=4.319(+5.6) dsd=3.983(-2.6) headB=4.021(-1.7) walk=4.048(-1.0)
ultra  downtown fight head=4.938(+0.0) base=5.211(+5.5) dsd=4.890(-1.0) headB=4.847(-1.8) walk=4.883(-1.1)
ultra  house    path  head=3.912(+0.0) base=4.016(+2.7) dsd=3.861(-1.3) headB=3.905(-0.2) walk=3.915(+0.1)
ultra  house    fight head=5.109(+0.0) base=5.003(-2.1) dsd=4.837(-5.3) headB=4.921(-3.7) walk=4.902(-4.1)
ultra  mexico   path  head=3.952(+0.0) base=4.249(+7.5) dsd=3.973(+0.5) headB=4.000(+1.2) walk=3.923(-0.7)
ultra  mexico   fight head=4.881(+0.0) base=5.133(+5.2) dsd=4.868(-0.3) headB=4.917(+0.7) walk=4.813(-1.4)
ultra  training path  head=3.933(+0.0) base=4.028(+2.4) dsd=4.021(+2.2) headB=3.875(-1.5) walk=3.843(-2.3)
ultra  training fight head=5.154(+0.0) base=5.497(+6.7) dsd=5.541(+7.5) headB=5.169(+0.3) walk=5.001(-3.0)
```

Reading. **The medium arm is not usable**: within single cells the machine switched state between variants (medium
mexico: head and base 12-23 % slower than the other three; medium training: headB +24-30 %, walk +9-15 %), the
signature of Round 2's s4. The fitted medium numbers (dsd -6.9 %, headB +2.3 %) come from those switches. High and
Ultra are clean (headB within -3.7 / +3.0 % per cell, -0.3 / +0.7 % fitted).
- **base (Round 4 confirmation)**: slower than HEAD in 8/8 high cells (+1.1 to +16.6 %) and 7/8 ultra cells
  (house fight -2.1 %, where head itself read slow: headB -3.7 %); fitted mean high +5.8 %, ultra +4.1 %, medium
  +4.1 % (the four medium cells outside mexico/training: +0.7 to +3.4 %, all slower). Round 4's kept set holds.
- **dsd** (shadow-map depth discard): high +1.0 %, ultra -0.1 % fitted mean → no gain; rejected again.
- **walk** (shadow-walk pruning): high -0.4 %, ultra -1.8 % mean (fight -2.5 %, fight callback cpu -3.0 %), inside
  headB's per-cell spread; not clearly past noise after one A/B → rejected.

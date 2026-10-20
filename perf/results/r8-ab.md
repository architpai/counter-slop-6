# Round 8 paired A/B runs

Power and thermal readings: `perf/results/r8-power.log` (94 W charger, `pmset -g ac`: Wattage 94, "96W USB-C Power Adapter"). Gate: AC and >= 60 % at each start, void under 40 % (`PERF_MIN_BATT=40`). A "Google Chrome for Testing" from ~/.agent-browser (started 12:10, not ours) used ~36 % CPU (sum over its processes) during job 1; logged at each start/end.

## r8-pre: traced, all presets on downtown + training (as r5-pre..r7-pre), HEAD 3763490, 12:47-12:52
```

### suite aggregates (geomean over 8 map x preset cells x 2 scenarios; the verdict)

| group | frame mean | frame med | frame p95 | cpu mean | js mean |
|---|---|---|---|---|---|
| all | 2.515 → 2.494 (-0.9%) | 2.562 → 2.549 (-0.5%) | 3.950 → 3.929 (-0.5%) | 2.050 → 2.063 (+0.6%) | 1.151 → 1.318 (+14.5% **REG**) |
| low | 1.643 → 1.558 (-5.1%) | 1.732 → 1.601 (-7.6% **IMP**) | 2.864 → 2.792 (-2.5%) | 1.295 → 1.287 (-0.7%) | 0.696 → 0.719 (+3.3%) |
| medium | 2.366 → 2.284 (-3.5% **IMP**) | 2.414 → 2.335 (-3.3% **IMP**) | 3.758 → 3.612 (-3.9% **IMP**) | 1.899 → 1.812 (-4.6%) | 1.179 → 1.275 (+8.1% **REG**) |
| high | 2.852 → 2.967 (+4.0%) | 2.918 → 3.050 (+4.5%) | 4.366 → 4.494 (+2.9%) | 2.345 → 2.517 (+7.3%) | 1.449 → 1.660 (+14.6%) |
| ultra | 3.611 → 3.663 (+1.4%) | 3.529 → 3.704 (+5.0% **REG**) | 5.179 → 5.257 (+1.5%) | 3.063 → 3.085 (+0.7%) | 1.479 → 1.985 (+34.2% **REG**) |

**suite verdict**: 4 regressed, 4 improved, 17 within noise (REGRESSION)
- all js mean: 14.5% (threshold 9.3%) regressed
- low frame med: -7.6% (threshold 2.3%) improved
- medium frame mean: -3.5% (threshold 2.0%) improved
- medium frame med: -3.3% (threshold 2.0%) improved
- medium frame p95: -3.9% (threshold 3.5%) improved
- medium js mean: 8.1% (threshold 3.2%) regressed
- ultra frame med: 5.0% (threshold 2.4%) regressed
- ultra js mean: 34.2% (threshold 18.7%) regressed
```

## r8cov: medium/high x downtown/house/mexico/training, path + fight (no trace), head (3763490) / noset (the tree before Round 7: `git diff HEAD 00a8411 -- src tests`) / headB / pre4 (the tree before Round 4: `git diff HEAD 2c75479 -- src tests`), 4 rounds (balanced), 12:52-13:33, battery 100 % on AC
```
HEAD 376349062fda80a43c48100a105598c82469faa6  variants: head, noset, headB, pre4  (2026-10-20T03:52:03.523Z)
complete: 4 variants x 64 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.518 (0.0%)  noset=3.566 (1.4%)  headB=3.456 (-1.8%)  pre4=3.653 (3.8%)
medium   head=3.162 (0.0%)  noset=3.272 (3.5%)  headB=3.120 (-1.3%)  pre4=3.270 (3.4%)
high     head=3.915 (0.0%)  noset=3.887 (-0.7%)  headB=3.828 (-2.2%)  pre4=4.081 (4.2%)

## med: geomean (paired ratio vs head)
all      head=3.438 (0.0%)  noset=3.513 (2.2%)  headB=3.393 (-1.3%)  pre4=3.552 (3.3%)
medium   head=3.095 (0.0%)  noset=3.241 (4.7%)  headB=3.072 (-0.7%)  pre4=3.194 (3.2%)
high     head=3.819 (0.0%)  noset=3.809 (-0.3%)  headB=3.748 (-1.9%)  pre4=3.950 (3.4%)

## p95: geomean (paired ratio vs head)
all      head=5.825 (0.0%)  noset=5.889 (1.1%)  headB=5.732 (-1.6%)  pre4=5.999 (3.0%)
medium   head=5.374 (0.0%)  noset=5.542 (3.1%)  headB=5.335 (-0.7%)  pre4=5.542 (3.1%)
high     head=6.315 (0.0%)  noset=6.257 (-0.9%)  headB=6.159 (-2.5%)  pre4=6.495 (2.9%)
diagnostic only: r8cov log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-1.8%  noset=1.4%  pre4=3.8%  | pos1..: -0.2 -0.5 0.6
medium  headB=-1.3%  noset=3.5%  pre4=3.4%  | pos1..: 2.1 2.2 1.6
high    headB=-2.2%  noset=-0.7%  pre4=4.2%  | pos1..: -2.5 -3.1 -0.4
diagnostic only: r8cov log(mean, path) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-1.4%  noset=-0.2%  pre4=3.2%  | pos1..: -1.3 -1.1 -0.2
medium  headB=-1.6%  noset=0.8%  pre4=2.6%  | pos1..: 2.3 2.9 2.0
high    headB=-1.2%  noset=-1.2%  pre4=3.8%  | pos1..: -4.7 -4.8 -2.3
diagnostic only: r8cov log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     headB=-2.1%  noset=3.0%  pre4=4.5%  | pos1..: 0.8 0.1 1.4
medium  headB=-1.0%  noset=6.3%  pre4=4.2%  | pos1..: 1.9 1.6 1.3
high    headB=-3.2%  noset=-0.2%  pre4=4.7%  | pos1..: -0.2 -1.3 1.6
r8cov: noset vs head, frameMs.mean (> 0 = noset slower); control headB vs head
medium  path  noset/head: geo +0.8% med +1.3% slower 10/16 | headB/head: geo -1.6% med +0.5% slower 9/16
medium  fight noset/head: geo +6.3% med +4.4% slower 11/16 | headB/head: geo -1.0% med -1.7% slower 6/16
medium  both  noset/head: geo +3.5% med +2.3% slower 21/32 | headB/head: geo -1.3% med -1.4% slower 15/32
high    path  noset/head: geo -1.2% med -2.6% slower 3/16 | headB/head: geo -1.2% med -1.5% slower 7/16
high    fight noset/head: geo -0.2% med -2.1% slower 7/16 | headB/head: geo -3.2% med -3.9% slower 3/16
high    both  noset/head: geo -0.7% med -2.6% slower 10/32 | headB/head: geo -2.2% med -2.3% slower 10/32
r8cov: pre4 vs noset, frameMs.mean (> 0 = pre4 slower); control headB vs head
medium  path  pre4/noset: geo +1.9% med +0.1% slower 8/16 | headB/head: geo -1.6% med +0.5% slower 9/16
medium  fight pre4/noset: geo -1.9% med -2.1% slower 7/16 | headB/head: geo -1.0% med -1.7% slower 6/16
medium  both  pre4/noset: geo -0.1% med -1.0% slower 15/32 | headB/head: geo -1.3% med -1.4% slower 15/32
high    path  pre4/noset: geo +5.0% med +6.7% slower 12/16 | headB/head: geo -1.2% med -1.5% slower 7/16
high    fight pre4/noset: geo +5.0% med +4.7% slower 11/16 | headB/head: geo -3.2% med -3.9% slower 3/16
high    both  pre4/noset: geo +5.0% med +5.2% slower 23/32 | headB/head: geo -2.2% med -2.3% slower 10/32
r8cov: noset vs head, frameMs.med (> 0 = noset slower); control headB vs head
medium  path  noset/head: geo +1.5% med +0.0% slower 6/16 | headB/head: geo -1.0% med +0.0% slower 4/16
medium  fight noset/head: geo +8.0% med +3.8% slower 11/16 | headB/head: geo -0.5% med +0.0% slower 6/16
medium  both  noset/head: geo +4.7% med +2.8% slower 17/32 | headB/head: geo -0.7% med +0.0% slower 10/32
high    path  noset/head: geo -0.6% med +0.0% slower 4/16 | headB/head: geo -0.9% med -2.9% slower 5/16
high    fight noset/head: geo +0.1% med +1.0% slower 8/16 | headB/head: geo -2.8% med -4.2% slower 3/16
high    both  noset/head: geo -0.3% med +0.0% slower 12/32 | headB/head: geo -1.9% med -2.9% slower 8/32
r8cov: pre4 vs noset, frameMs.med (> 0 = pre4 slower); control headB vs head
medium  path  pre4/noset: geo -0.1% med +0.0% slower 5/16 | headB/head: geo -1.0% med +0.0% slower 4/16
medium  fight pre4/noset: geo -2.7% med -1.7% slower 6/16 | headB/head: geo -0.5% med +0.0% slower 6/16
medium  both  pre4/noset: geo -1.4% med +0.0% slower 11/32 | headB/head: geo -0.7% med +0.0% slower 10/32
high    path  pre4/noset: geo +2.4% med +3.3% slower 10/16 | headB/head: geo -0.9% med -2.9% slower 5/16
high    fight pre4/noset: geo +5.1% med +4.1% slower 10/16 | headB/head: geo -2.8% med -4.2% slower 3/16
high    both  pre4/noset: geo +3.7% med +3.8% slower 20/32 | headB/head: geo -1.9% med -2.9% slower 8/32
r8cov: noset vs head, frameMs.p95 (> 0 = noset slower); control headB vs head
medium  path  noset/head: geo +0.8% med +2.3% slower 9/16 | headB/head: geo -0.7% med -0.9% slower 7/16
medium  fight noset/head: geo +5.6% med +3.4% slower 10/16 | headB/head: geo -0.8% med +0.0% slower 7/16
medium  both  noset/head: geo +3.1% med +3.2% slower 19/32 | headB/head: geo -0.7% med +0.0% slower 14/32
high    path  noset/head: geo -1.6% med -4.5% slower 2/16 | headB/head: geo -2.6% med -0.8% slower 5/16
high    fight noset/head: geo -0.2% med -1.4% slower 6/16 | headB/head: geo -2.3% med -3.5% slower 4/16
high    both  noset/head: geo -0.9% med -3.8% slower 8/32 | headB/head: geo -2.5% med -2.4% slower 9/32
r8cov: pre4 vs noset, frameMs.p95 (> 0 = pre4 slower); control headB vs head
medium  path  pre4/noset: geo +2.0% med -0.7% slower 7/16 | headB/head: geo -0.7% med -0.9% slower 7/16
medium  fight pre4/noset: geo -2.0% med -3.5% slower 7/16 | headB/head: geo -0.8% med +0.0% slower 7/16
medium  both  pre4/noset: geo -0.0% med -2.2% slower 14/32 | headB/head: geo -0.7% med +0.0% slower 14/32
high    path  pre4/noset: geo +3.5% med +4.3% slower 12/16 | headB/head: geo -2.6% med -0.8% slower 5/16
high    fight pre4/noset: geo +4.1% med +4.2% slower 10/16 | headB/head: geo -2.3% med -3.5% slower 4/16
high    both  pre4/noset: geo +3.8% med +4.2% slower 22/32 | headB/head: geo -2.5% med -2.4% slower 9/32
medium  noset: med/head 4.4% (faster 5/16), med/headB 8.2% (faster 1/16) | headB: med/head -1.7% (faster 10/16) | pre4: med/head 4.6% (faster 4/16), med/headB 5.5% (faster 3/16)
high    noset: med/head -2.1% (faster 9/16), med/headB 3.8% (faster 6/16) | headB: med/head -3.9% (faster 13/16) | pre4: med/head 3.8% (faster 6/16), med/headB 7.7% (faster 3/16)
```

## r8cl: load-only (AB_ARGS=--load-only), medium/high/ultra x downtown/house/mexico/training, head / noset / headB, 3 rounds (balanced), 13:33-13:48
```
HEAD 376349062fda80a43c48100a105598c82469faa6  variants: head, noset, headB  args: --load-only  (2026-10-20T04:33:27.702Z)
complete: 3 variants x 36 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=7523 (+0.0%)  noset=7682 (+2.1%)  headB=7412 (-1.5%)
medium   head=6791 (+0.0%)  noset=7023 (+3.4%)  headB=6849 (+0.9%)
high     head=6856 (+0.0%)  noset=7095 (+3.5%)  headB=6845 (-0.2%)
ultra    head=9144 (+0.0%)  noset=9098 (-0.5%)  headB=8685 (-5.0%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=620 (+0.0%)  noset=656 (+5.8%)  headB=646 (+4.2%)
medium   head=606 (+0.0%)  noset=639 (+5.5%)  headB=622 (+2.7%)
high     head=608 (+0.0%)  noset=671 (+10.4%)  headB=647 (+6.5%)
ultra    head=647 (+0.0%)  noset=658 (+1.7%)  headB=669 (+3.4%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=348  noset=+10  headB=-0
sky.on                 head=465  noset=+10  headB=-1
bakeLayout.on          head=465  noset=+10  headB=-1
bake.on                head=465  noset=+10  headB=-1
textures.on            head=465  noset=+10  headB=-1
fx.on                  head=465  noset=+10  headB=-1
weapons.on             head=465  noset=+10  headB=-1
operators.on           head=465  noset=+10  headB=-1
props.on               head=465  noset=+10  headB=-1
streaming.on           head=465  noset=+10  headB=-1
warmups.on             head=465  noset=+10  headB=-1
effects.on             head=465  noset=+10  headB=-1
weaponsReady.on        head=465  noset=+10  headB=-1
enteredMs              head=474  noset=+10  headB=-1
matchMs                head=593  noset=+8  headB=-2
firstPlayableMs        head=597  noset=+8  headB=-3
warmups.off            head=624  noset=+13  headB=-3
compiles.on            head=670  noset=+7  headB=-5
skyLanding.on          head=850  noset=+1  headB=-6
quietEndMs             head=3602  noset=+7  headB=-2
compiles.off           head=3614  noset=+8  headB=-1
sky.off                head=3833  noset=+14  headB=-2
skyLanding.off         head=3833  noset=+14  headB=-2
bakeLayout.off         head=3833  noset=+364  headB=-2
bake.off               head=3907  noset=+363  headB=+1
bakeFading.on          head=3907  noset=+363  headB=+1
bakeFading.off         head=5417  noset=+361  headB=+4
textures.off           head=5920  noset=+325  headB=-32
fx.off                 head=6048  noset=+324  headB=-15
effects.off            head=6048  noset=+324  headB=-15
weapons.off            head=6954  noset=+314  headB=-52
weaponsReady.off       head=6954  noset=+314  headB=-52
operators.off          head=7279  noset=+307  headB=-61
readyMs                head=7430  noset=+296  headB=-55
props.off              head=7430  noset=+296  headB=-35
streaming.off          head=7430  noset=+296  headB=-55
pace.last              head=7720  noset=+387  headB=-50

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=346  noset=+10  headB=+3
sky.on                 head=459  noset=+13  headB=+0
bakeLayout.on          head=459  noset=+13  headB=+0
bake.on                head=459  noset=+13  headB=+0
textures.on            head=459  noset=+13  headB=+0
fx.on                  head=459  noset=+13  headB=+0
weapons.on             head=459  noset=+13  headB=+0
operators.on           head=459  noset=+13  headB=+0
props.on               head=459  noset=+13  headB=+0
streaming.on           head=459  noset=+13  headB=+0
warmups.on             head=459  noset=+13  headB=+0
effects.on             head=459  noset=+13  headB=+0
weaponsReady.on        head=459  noset=+13  headB=+0
enteredMs              head=469  noset=+13  headB=+0
matchMs                head=585  noset=+12  headB=+1
firstPlayableMs        head=587  noset=+12  headB=+1
warmups.off            head=600  noset=+12  headB=-3
compiles.on            head=656  noset=+8  headB=-0
skyLanding.on          head=766  noset=+1  headB=+2
quietEndMs             head=3591  noset=+10  headB=+4
compiles.off           head=3604  noset=+10  headB=+4
sky.off                head=3827  noset=+22  headB=+7
skyLanding.off         head=3827  noset=+22  headB=+7
bakeLayout.off         head=3827  noset=+371  headB=+7
bake.off               head=3883  noset=+372  headB=+8
bakeFading.on          head=3883  noset=+372  headB=+8
bakeFading.off         head=5400  noset=+373  headB=+8
textures.off           head=5512  noset=+315  headB=-25
fx.off                 head=5652  noset=+307  headB=-8
effects.off            head=5652  noset=+307  headB=-8
weapons.off            head=6488  noset=+324  headB=+11
weaponsReady.off       head=6488  noset=+324  headB=+11
operators.off          head=6778  noset=+325  headB=+17
readyMs                head=6920  noset=+322  headB=+8
props.off              head=6920  noset=+322  headB=+35
streaming.off          head=6920  noset=+322  headB=+8
pace.last              head=7716  noset=+292  headB=-54

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=346  noset=+21  headB=-1
sky.on                 head=467  noset=+25  headB=+0
bakeLayout.on          head=467  noset=+25  headB=+0
bake.on                head=467  noset=+25  headB=+0
textures.on            head=467  noset=+25  headB=+0
fx.on                  head=467  noset=+25  headB=+0
weapons.on             head=467  noset=+25  headB=+0
operators.on           head=467  noset=+25  headB=+0
props.on               head=467  noset=+25  headB=+0
streaming.on           head=467  noset=+25  headB=+0
warmups.on             head=467  noset=+25  headB=+0
effects.on             head=467  noset=+25  headB=+0
weaponsReady.on        head=467  noset=+25  headB=+0
enteredMs              head=477  noset=+27  headB=+0
matchMs                head=596  noset=+24  headB=-4
firstPlayableMs        head=602  noset=+24  headB=-4
warmups.off            head=604  noset=+30  headB=-1
compiles.on            head=675  noset=+22  headB=-5
skyLanding.on          head=852  noset=+24  headB=-7
quietEndMs             head=3603  noset=+21  headB=-5
compiles.off           head=3614  noset=+22  headB=-4
sky.off                head=3832  noset=+36  headB=-9
skyLanding.off         head=3832  noset=+36  headB=-9
bakeLayout.off         head=3832  noset=+369  headB=-9
bake.off               head=3900  noset=+373  headB=-15
bakeFading.on          head=3900  noset=+373  headB=-15
bakeFading.off         head=5409  noset=+365  headB=-6
textures.off           head=5574  noset=+343  headB=+7
fx.off                 head=5682  noset=+341  headB=-1
effects.off            head=5682  noset=+341  headB=-1
weapons.off            head=6437  noset=+307  headB=-54
weaponsReady.off       head=6437  noset=+307  headB=-54
pace.last              head=6594  noset=+990  headB=-60
operators.off          head=6736  noset=+299  headB=-54
readyMs                head=6916  noset=+300  headB=-53
props.off              head=6916  noset=+300  headB=-12
streaming.off          head=6916  noset=+300  headB=-53

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=372  noset=-2  headB=-2
sky.on                 head=505  noset=+2  headB=-3
bakeLayout.on          head=505  noset=+2  headB=-3
bake.on                head=505  noset=+2  headB=-3
textures.on            head=505  noset=+2  headB=-3
fx.on                  head=505  noset=+2  headB=-3
weapons.on             head=505  noset=+2  headB=-3
operators.on           head=505  noset=+2  headB=-3
props.on               head=505  noset=+2  headB=-3
streaming.on           head=505  noset=+2  headB=-3
warmups.on             head=505  noset=+2  headB=-3
effects.on             head=505  noset=+2  headB=-3
weaponsReady.on        head=505  noset=+2  headB=-3
enteredMs              head=515  noset=+2  headB=-4
matchMs                head=643  noset=+5  headB=-4
firstPlayableMs        head=646  noset=+4  headB=-4
compiles.on            head=738  noset=+1  headB=-7
warmups.off            head=810  noset=+1485  headB=-3
skyLanding.on          head=935  noset=-1  headB=-11
quietEndMs             head=3651  noset=+1  headB=-4
compiles.off           head=3665  noset=+2  headB=-5
sky.off                head=3883  noset=+3  headB=-7
skyLanding.off         head=3883  noset=+3  headB=-7
bakeLayout.off         head=3883  noset=+356  headB=-7
bake.off               head=4006  noset=+358  headB=-5
bakeFading.on          head=4006  noset=+358  headB=-5
bakeFading.off         head=5508  noset=+357  headB=-7
textures.off           head=7177  noset=+326  headB=-52
fx.off                 head=7688  noset=+316  headB=-54
effects.off            head=7688  noset=+316  headB=-54
weapons.off            head=9281  noset=+340  headB=-72
weaponsReady.off       head=9281  noset=+340  headB=-72
operators.off          head=9795  noset=+285  headB=-85
readyMs                head=9974  noset=+278  headB=-96
props.off              head=9974  noset=+278  headB=-96
streaming.off          head=9974  noset=+278  headB=-96
pace.last              head=10116  noset=+449  headB=-7

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=162.2 3.8/2.4 skip 383.9 n 1676 r 980/38.3 pace 4  noset=159.8 3.9/2.6 skip 376.3 n 1713 r 1106/38.1 pace 2  headB=160.6 3.8/2.7 skip 373.0 n 1645 r 997/38.3 pace 2
medium   head=141.5 3.2/2.3 skip 371.2 n 1753 r 913/28.4 pace 2  noset=140.8 3.2/2.4 skip 380.6 n 1836 r 1036/26.9 pace 2  headB=136.7 3.1/2.5 skip 392.1 n 1781 r 905/26.9 pace 2
high     head=168.6 4.0/2.3 skip 348.9 n 1500 r 930/40.1 pace 4  noset=160.3 4.3/2.6 skip 327.8 n 1614 r 1097/40.3 pace 2  headB=160.6 4.2/2.4 skip 329.8 n 1592 r 963/40.5 pace 2
ultra    head=178.2 4.3/2.8 skip 431.8 n 1715 r 1210/39.9 pace 4  noset=163.2 4.1/2.9 skip 420.6 n 1735 r 1312/42.4 pace 2  headB=176.6 4.2/3.2 skip 397.1 n 1587 r 1320/46.1 pace 2
medium noset: ready faster 3/12, firstPlayable faster 4/12
medium headB: ready faster 6/12, firstPlayable faster 5/12
high noset: ready faster 2/12, firstPlayable faster 4/12
high headB: ready faster 7/12, firstPlayable faster 7/12
ultra noset: ready faster 2/12, firstPlayable faster 5/12
ultra headB: ready faster 9/12, firstPlayable faster 8/12
```

Per map (r8cl): readyMs geomean ratio vs head over 3 rounds, and median bake.off (page ms)
```
downtown  medium: noset 6.2% headB 2.6% bake.off head 3883.3 noset 4288.1 | high: noset 3.7% headB 0.3% bake.off head 3910.2 noset 4311.6 | ultra: noset 3.3% headB -0.9% bake.off head 4091.4 noset 4441.1
house     medium: noset 3.2% headB -0.7% bake.off head 3844.9 noset 4163.8 | high: noset 6.7% headB 1.2% bake.off head 3862.3 noset 4279.9 | ultra: noset 3.6% headB -0.7% bake.off head 3934.8 noset 4294.5
mexico    medium: noset 7.3% headB 1.5% bake.off head 3873.6 noset 4260.5 | high: noset 5.7% headB -1.3% bake.off head 3882.4 noset 4278 | ultra: noset -8.6% headB -16.5% bake.off head 4004.8 noset 4377.5
training  medium: noset -2.7% headB 0.1% bake.off head 3998 noset 4015.8 | high: noset -1.9% headB -0.8% bake.off head 3904.8 noset 4031.9 | ultra: noset 0.2% headB -1.0% bake.off head 4011.8 noset 4147.7
```

## r8f: frame time, path + fight (no trace), low/medium/high/ultra x downtown/training, head / opaque / fence / headB / clips / hud2 (each candidate alone on HEAD; patches `perf/patches/r8-*.patch`), 4 rounds (6 variants: near-balanced; read ab-posfit), 14:39-15:30, battery 100 % on AC; agent-browser Chrome 14-62 % CPU (sampled each minute: `/tmp` log summarised in r8-power.log)
```
HEAD 376349062fda80a43c48100a105598c82469faa6  variants: head, opaque, fence, headB, clips, hud2  (2026-10-20T05:39:18.385Z)
complete: 6 variants x 64 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=2.759 (0.0%)  opaque=2.776 (0.6%)  fence=2.770 (0.4%)  headB=2.772 (0.5%)  clips=2.787 (1.0%)  hud2=2.794 (1.2%)
low      head=1.674 (0.0%)  opaque=1.693 (1.1%)  fence=1.697 (1.3%)  headB=1.677 (0.2%)  clips=1.726 (3.1%)  hud2=1.755 (4.8%)
medium   head=2.515 (0.0%)  opaque=2.500 (-0.6%)  fence=2.501 (-0.6%)  headB=2.500 (-0.6%)  clips=2.499 (-0.6%)  hud2=2.505 (-0.4%)
high     head=3.235 (0.0%)  opaque=3.272 (1.1%)  fence=3.351 (3.6%)  headB=3.237 (0.0%)  clips=3.330 (2.9%)  hud2=3.268 (1.0%)
ultra    head=4.255 (0.0%)  opaque=4.289 (0.8%)  fence=4.139 (-2.7%)  headB=4.349 (2.2%)  clips=4.200 (-1.3%)  hud2=4.241 (-0.3%)

## med: geomean (paired ratio vs head)
all      head=2.754 (0.0%)  opaque=2.741 (-0.5%)  fence=2.729 (-0.9%)  headB=2.733 (-0.8%)  clips=2.763 (0.3%)  hud2=2.759 (0.2%)
low      head=1.682 (0.0%)  opaque=1.679 (-0.2%)  fence=1.673 (-0.5%)  headB=1.639 (-2.6%)  clips=1.734 (3.1%)  hud2=1.715 (1.9%)
medium   head=2.546 (0.0%)  opaque=2.505 (-1.6%)  fence=2.514 (-1.3%)  headB=2.520 (-1.0%)  clips=2.515 (-1.2%)  hud2=2.536 (-0.4%)
high     head=3.236 (0.0%)  opaque=3.262 (0.8%)  fence=3.303 (2.1%)  headB=3.216 (-0.6%)  clips=3.292 (1.7%)  hud2=3.241 (0.2%)
ultra    head=4.151 (0.0%)  opaque=4.117 (-0.8%)  fence=3.988 (-3.9%)  headB=4.203 (1.3%)  clips=4.061 (-2.2%)  hud2=4.112 (-0.9%)

## p95: geomean (paired ratio vs head)
all      head=4.431 (0.0%)  opaque=4.451 (0.5%)  fence=4.421 (-0.2%)  headB=4.462 (0.7%)  clips=4.402 (-0.6%)  hud2=4.433 (0.1%)
low      head=2.919 (0.0%)  opaque=2.927 (0.3%)  fence=2.947 (1.0%)  headB=2.919 (0.0%)  clips=2.969 (1.7%)  hud2=3.037 (4.0%)
medium   head=3.988 (0.0%)  opaque=3.988 (0.0%)  fence=3.905 (-2.1%)  headB=4.031 (1.1%)  clips=3.941 (-1.2%)  hud2=3.942 (-1.2%)
high     head=5.019 (0.0%)  opaque=4.949 (-1.4%)  fence=5.145 (2.5%)  headB=4.925 (-1.9%)  clips=5.048 (0.6%)  hud2=4.932 (-1.7%)
ultra    head=6.598 (0.0%)  opaque=6.795 (3.0%)  fence=6.455 (-2.2%)  headB=6.841 (3.7%)  clips=6.360 (-3.6%)  hud2=6.542 (-0.9%)
diagnostic only: r8f log(mean, both) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     clips=0.9%  fence=0.4%  headB=0.4%  hud2=1.2%  opaque=0.7%  | pos1..: 0.2 -0.3 -0.4 -1.0 -0.4
low     clips=3.5%  fence=0.6%  headB=0.2%  hud2=5.2%  opaque=0.3%  | pos1..: -0.7 -3.3 -3.5 -0.0 -0.7
medium  clips=-1.0%  fence=-1.5%  headB=-1.3%  hud2=-0.4%  opaque=-1.3%  | pos1..: -2.6 -3.0 -1.6 -2.1 -0.1
high    clips=3.4%  fence=3.2%  headB=0.4%  hud2=1.4%  opaque=0.5%  | pos1..: 2.4 3.9 4.2 3.2 4.1
ultra   clips=1.3%  fence=-0.7%  headB=5.4%  hud2=1.0%  opaque=1.1%  | pos1..: 1.6 0.0 -2.3 -6.3 -5.8
diagnostic only: r8f log(mean, path) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     clips=0.3%  fence=-0.1%  headB=0.0%  hud2=0.6%  opaque=-0.5%  | pos1..: -0.3 -0.2 0.1 -0.9 -1.2
low     clips=2.3%  fence=-0.4%  headB=1.1%  hud2=4.7%  opaque=0.3%  | pos1..: 0.8 -0.1 -1.8 -1.0 0.2
medium  clips=-1.5%  fence=-3.5%  headB=-1.5%  hud2=-1.2%  opaque=-3.5%  | pos1..: -4.1 -3.8 -1.1 -1.1 -0.4
high    clips=1.6%  fence=3.2%  headB=-1.9%  hud2=-1.6%  opaque=-0.9%  | pos1..: -0.1 -0.4 0.9 0.8 0.1
ultra   clips=1.4%  fence=-1.2%  headB=3.6%  hud2=2.6%  opaque=-0.0%  | pos1..: 2.0 2.0 0.6 -3.8 -5.8
diagnostic only: r8f log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
all     clips=1.5%  fence=1.0%  headB=0.8%  hud2=1.8%  opaque=1.9%  | pos1..: 0.6 -0.4 -0.8 -1.0 0.4
low     clips=4.7%  fence=1.6%  headB=-0.6%  hud2=5.8%  opaque=0.3%  | pos1..: -2.1 -6.4 -5.1 1.0 -1.6
medium  clips=-0.6%  fence=0.5%  headB=-1.1%  hud2=0.4%  opaque=0.9%  | pos1..: -1.0 -2.3 -2.2 -3.1 0.2
high    clips=5.4%  fence=3.3%  headB=2.8%  hud2=4.5%  opaque=2.0%  | pos1..: 5.1 8.4 7.5 5.6 8.3
ultra   clips=1.2%  fence=-0.1%  headB=7.2%  hud2=-0.7%  opaque=2.3%  | pos1..: 1.1 -1.9 -5.0 -8.8 -5.8
robust mean
low     opaque: med/head 1.4% (faster 3/8), med/headB 0.1% (faster 4/8) | fence: med/head -0.4% (faster 4/8), med/headB -0.0% (faster 4/8) | headB: med/head -0.4% (faster 4/8) | clips: med/head 1.8% (faster 3/8), med/headB 1.7% (faster 2/8) | hud2: med/head 0.8% (faster 3/8), med/headB 1.8% (faster 2/8)
medium  opaque: med/head -0.1% (faster 4/8), med/headB 0.0% (faster 3/8) | fence: med/head -0.9% (faster 5/8), med/headB -0.9% (faster 5/8) | headB: med/head -0.7% (faster 5/8) | clips: med/head -0.3% (faster 4/8), med/headB 0.0% (faster 4/8) | hud2: med/head 1.1% (faster 3/8), med/headB 0.1% (faster 4/8)
high    opaque: med/head -0.9% (faster 4/8), med/headB -1.1% (faster 4/8) | fence: med/head 1.5% (faster 2/8), med/headB 0.0% (faster 4/8) | headB: med/head 1.5% (faster 2/8) | clips: med/head -0.6% (faster 5/8), med/headB -1.0% (faster 5/8) | hud2: med/head 1.0% (faster 4/8), med/headB 1.2% (faster 3/8)
ultra   opaque: med/head -0.7% (faster 4/8), med/headB -0.2% (faster 4/8) | fence: med/head -3.8% (faster 5/8), med/headB -1.9% (faster 6/8) | headB: med/head 0.8% (faster 3/8) | clips: med/head -2.2% (faster 5/8), med/headB -3.6% (faster 6/8) | hud2: med/head -1.2% (faster 6/8), med/headB -1.4% (faster 5/8)
robust med
low     opaque: med/head 0.0% (faster 2/8), med/headB 0.0% (faster 2/8) | fence: med/head -2.4% (faster 4/8), med/headB 0.0% (faster 3/8) | headB: med/head 0.0% (faster 2/8) | clips: med/head 6.1% (faster 1/8), med/headB 5.1% (faster 0/8) | hud2: med/head 0.0% (faster 1/8), med/headB 0.0% (faster 1/8)
medium  opaque: med/head 0.0% (faster 2/8), med/headB 0.0% (faster 2/8) | fence: med/head 0.0% (faster 1/8), med/headB 0.0% (faster 2/8) | headB: med/head 0.0% (faster 2/8) | clips: med/head 0.0% (faster 1/8), med/headB 0.0% (faster 2/8) | hud2: med/head 1.6% (faster 1/8), med/headB 0.0% (faster 2/8)
high    opaque: med/head 0.0% (faster 3/8), med/headB -1.2% (faster 4/8) | fence: med/head 1.5% (faster 2/8), med/headB 0.0% (faster 3/8) | headB: med/head 0.0% (faster 1/8) | clips: med/head -1.2% (faster 4/8), med/headB -1.2% (faster 4/8) | hud2: med/head -1.4% (faster 4/8), med/headB 1.4% (faster 3/8)
ultra   opaque: med/head -1.9% (faster 4/8), med/headB -0.9% (faster 4/8) | fence: med/head -3.0% (faster 5/8), med/headB -2.1% (faster 5/8) | headB: med/head 0.0% (faster 3/8) | clips: med/head -2.2% (faster 5/8), med/headB -3.1% (faster 6/8) | hud2: med/head 0.0% (faster 3/8), med/headB 0.0% (faster 3/8)
robust p95
low     opaque: med/head 3.7% (faster 3/8), med/headB 1.7% (faster 3/8) | fence: med/head 0.0% (faster 3/8), med/headB 0.1% (faster 4/8) | headB: med/head 0.0% (faster 2/8) | clips: med/head 1.6% (faster 3/8), med/headB 0.0% (faster 2/8) | hud2: med/head 0.0% (faster 1/8), med/headB 0.0% (faster 1/8)
medium  opaque: med/head 0.0% (faster 3/8), med/headB 0.0% (faster 3/8) | fence: med/head 0.0% (faster 3/8), med/headB 1.2% (faster 3/8) | headB: med/head 0.0% (faster 3/8) | clips: med/head -1.2% (faster 4/8), med/headB 1.2% (faster 3/8) | hud2: med/head 0.0% (faster 3/8), med/headB 1.2% (faster 2/8)
high    opaque: med/head -1.6% (faster 4/8), med/headB -1.0% (faster 4/8) | fence: med/head 3.0% (faster 3/8), med/headB -1.0% (faster 4/8) | headB: med/head -0.8% (faster 4/8) | clips: med/head 0.0% (faster 3/8), med/headB -3.5% (faster 5/8) | hud2: med/head 1.9% (faster 3/8), med/headB 2.0% (faster 4/8)
ultra   opaque: med/head -1.8% (faster 4/8), med/headB 4.2% (faster 3/8) | fence: med/head -4.1% (faster 5/8), med/headB -2.9% (faster 5/8) | headB: med/head 0.2% (faster 4/8) | clips: med/head -4.3% (faster 6/8), med/headB -6.6% (faster 6/8) | hud2: med/head -3.7% (faster 6/8), med/headB -0.0% (faster 4/8)
fight state: equal across all 6 variants in all 32 cell-rounds
```

## r8l: load-only (AB_ARGS=--load-only), low/medium/high/ultra x downtown/house/mexico/training, head / late (programs pre-linked at the menu) / latepack (late + upload packing, Round 7 r7-pack rebased: the committed tree) / headB / latepacku (latepack + Ultra slot budget 2 x SLOT_BYTES at 2K textures), 3 rounds (5 variants: near-balanced), 15:31-15:54, battery 100 % on AC
```
HEAD 376349062fda80a43c48100a105598c82469faa6  variants: head, late, latepack, headB, latepacku  args: --load-only  (2026-10-20T06:30:42.187Z)
complete: 5 variants x 48 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=3732 (+0.0%)  late=3707 (-0.7%)  latepack=3341 (-10.5%)  headB=3755 (+0.6%)  latepacku=3326 (-10.9%)
low      head=508 (+0.0%)  late=494 (-2.6%)  latepack=497 (-2.1%)  headB=517 (+1.9%)  latepacku=497 (-2.1%)
medium   head=6634 (+0.0%)  late=6615 (-0.3%)  latepack=5313 (-19.9%)  headB=6635 (+0.0%)  latepacku=5314 (-19.9%)
high     head=6676 (+0.0%)  late=6711 (+0.5%)  latepack=5486 (-17.8%)  headB=6702 (+0.4%)  latepacku=5482 (-17.9%)
ultra    head=8627 (+0.0%)  late=8601 (-0.3%)  latepack=8606 (-0.2%)  headB=8641 (+0.2%)  latepacku=8448 (-2.1%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=548 (+0.0%)  late=547 (-0.2%)  latepack=547 (-0.0%)  headB=551 (+0.5%)  latepacku=546 (-0.3%)
low      head=498 (+0.0%)  late=485 (-2.6%)  latepack=488 (-2.1%)  headB=508 (+2.0%)  latepacku=487 (-2.2%)
medium   head=556 (+0.0%)  late=561 (+0.7%)  latepack=557 (+0.0%)  headB=557 (+0.2%)  latepacku=557 (+0.1%)
high     head=562 (+0.0%)  late=558 (-0.8%)  latepack=564 (+0.3%)  headB=560 (-0.4%)  latepacku=561 (-0.3%)
ultra    head=577 (+0.0%)  late=588 (+1.9%)  latepack=587 (+1.7%)  headB=579 (+0.4%)  latepacku=584 (+1.1%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=331  late=-3  latepack=-1  headB=+1  latepacku=+0
warmups.on             head=430  late=-1  latepack=+1  headB=+1  latepacku=+2
enteredMs              head=438  late=-1  latepack=+1  headB=-0  latepacku=+2
sky.on                 head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
bakeLayout.on          head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
bake.on                head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
textures.on            head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
fx.on                  head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
weapons.on             head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
operators.on           head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
props.on               head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
streaming.on           head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
effects.on             head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
weaponsReady.on        head=439  late=+0  latepack=+2  headB=+0  latepacku=+2
matchMs                head=551  late=+1  latepack=+2  headB=+2  latepacku=+3
firstPlayableMs        head=554  late=+1  latepack=+1  headB=+2  latepacku=+2
warmups.off            head=556  late=+4  latepack=+6  headB=+2  latepacku=+5
compiles.on            head=630  late=+2  latepack=+2  headB=+1  latepacku=+2
skyLanding.on          head=790  late=+1  latepack=+4  headB=+1  latepacku=+2
quietEndMs             head=3569  late=+1  latepack=+3  headB=-0  latepacku=+4
compiles.off           head=3581  late=+2  latepack=+5  headB=+0  latepacku=+3
sky.off                head=3791  late=-1  latepack=+2  headB=+1  latepacku=+5
skyLanding.off         head=3791  late=-1  latepack=+2  headB=+1  latepacku=+5
bakeLayout.off         head=3791  late=-1  latepack=+2  headB=+1  latepacku=+5
bake.off               head=3861  late=+3  latepack=-7  headB=+1  latepacku=-11
bakeFading.on          head=3861  late=+3  latepack=-7  headB=+1  latepacku=-11
bakeFading.off         head=5369  late=+6  latepack=-11  headB=+5  latepacku=-9
textures.off           head=5848  late=+19  latepack=-538  headB=+3  latepacku=-541
fx.off                 head=5978  late=+10  latepack=-606  headB=+9  latepacku=-627
effects.off            head=5978  late=+10  latepack=-606  headB=+9  latepacku=-627
readyMs                head=6510  late=+4  latepack=-236  headB=+3  latepacku=-385
weapons.off            head=6856  late=-0  latepack=-1161  headB=+2  latepacku=-1120
weaponsReady.off       head=6856  late=-0  latepack=-1161  headB=+2  latepacku=-1120
operators.off          head=7163  late=+14  latepack=-1354  headB=+13  latepacku=-1315
props.off              head=7304  late=+8  latepack=-904  headB=-5  latepacku=-814
streaming.off          head=7304  late=+14  latepack=-1367  headB=+4  latepacku=-1328
pace.last              head=7539  late=-13  latepack=-2938  headB=-10  latepacku=-1852

## phases (low): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=332  late=-4  latepack=+1  headB=+2  latepacku=+1
warmups.on             head=370  late=-4  latepack=+0  headB=+3  latepacku=+3
enteredMs              head=373  late=-5  latepack=+0  headB=+3  latepacku=+3
matchMs                head=488  late=-6  latepack=-4  headB=+3  latepacku=-2
firstPlayableMs        head=489  late=-6  latepack=-4  headB=+3  latepacku=-1
warmups.off            head=489  late=-6  latepack=-4  headB=+3  latepacku=-1
readyMs                head=497  late=-5  latepack=-4  headB=+2  latepacku=-1

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=327  late=-0  latepack=-1  headB=-2  latepacku=-1
sky.on                 head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
bakeLayout.on          head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
bake.on                head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
textures.on            head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
fx.on                  head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
weapons.on             head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
operators.on           head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
props.on               head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
streaming.on           head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
warmups.on             head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
effects.on             head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
weaponsReady.on        head=429  late=+2  latepack=+0  headB=+1  latepacku=-0
enteredMs              head=437  late=+2  latepack=+0  headB=-1  latepacku=-0
matchMs                head=553  late=+10  latepack=+1  headB=+6  latepacku=+3
firstPlayableMs        head=556  late=+9  latepack=+1  headB=+6  latepacku=+2
warmups.off            head=556  late=+13  latepack=+11  headB=+6  latepacku=+7
compiles.on            head=621  late=+9  latepack=-1  headB=+4  latepacku=+1
skyLanding.on          head=723  late=+8  latepack=-2  headB=+5  latepacku=-1
quietEndMs             head=3564  late=+8  latepack=+1  headB=+4  latepacku=+3
compiles.off           head=3576  late=+9  latepack=+3  headB=+5  latepacku=+4
sky.off                head=3785  late=+12  latepack=+0  headB=+9  latepacku=+1
skyLanding.off         head=3785  late=+12  latepack=+0  headB=+9  latepacku=+1
bakeLayout.off         head=3785  late=+12  latepack=+0  headB=+9  latepacku=+1
bake.off               head=3845  late=+10  latepack=-38  headB=+6  latepacku=-32
bakeFading.on          head=3845  late=+10  latepack=-38  headB=+6  latepacku=-32
bakeFading.off         head=5348  late=+11  latepack=-42  headB=+8  latepacku=-36
textures.off           head=5454  late=+13  latepack=-1444  headB=-13  latepacku=-1422
fx.off                 head=5578  late=+10  latepack=-1567  headB=-4  latepacku=-1545
effects.off            head=5578  late=+10  latepack=-1567  headB=-4  latepacku=-1545
weapons.off            head=6396  late=-5  latepack=-2269  headB=-26  latepacku=-2255
weaponsReady.off       head=6396  late=-5  latepack=-2269  headB=-26  latepacku=-2255
operators.off          head=6681  late=+17  latepack=-2531  headB=-27  latepacku=-2518
readyMs                head=6809  late=+16  latepack=-1504  headB=-23  latepacku=-1489
props.off              head=6809  late=+12  latepack=-2599  headB=-23  latepacku=-2585
streaming.off          head=6809  late=+16  latepack=-2599  headB=-23  latepacku=-2585
pace.last              head=7293  late=-52  latepack=-3222  headB=-18  latepacku=-3514

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=328  late=-4  latepack=-3  headB=-2  latepacku=-3
sky.on                 head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
bakeLayout.on          head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
bake.on                head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
textures.on            head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
fx.on                  head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
weapons.on             head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
operators.on           head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
props.on               head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
streaming.on           head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
warmups.on             head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
effects.on             head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
weaponsReady.on        head=436  late=-3  latepack=-1  headB=-1  latepacku=-2
enteredMs              head=444  late=-3  latepack=-1  headB=-1  latepacku=-2
matchMs                head=554  late=-5  latepack=+1  headB=-0  latepacku=+2
firstPlayableMs        head=556  late=-5  latepack=+1  headB=+1  latepacku=+3
warmups.off            head=569  late=-1  latepack=+2  headB=+1  latepacku=+6
compiles.on            head=626  late=-0  latepack=+1  headB=-0  latepacku=+1
skyLanding.on          head=789  late=-1  latepack=+1  headB=+1  latepacku=+1
quietEndMs             head=3565  late=-4  latepack=-0  headB=-0  latepacku=-3
compiles.off           head=3577  late=-4  latepack=-1  headB=+1  latepacku=-2
sky.off                head=3789  late=-2  latepack=+0  headB=+1  latepacku=-7
skyLanding.off         head=3789  late=-2  latepack=+0  headB=+1  latepacku=-7
bakeLayout.off         head=3789  late=-2  latepack=+0  headB=+1  latepacku=-7
bake.off               head=3848  late=-1  latepack=-6  headB=-1  latepacku=-10
bakeFading.on          head=3848  late=-1  latepack=-6  headB=-1  latepacku=-10
bakeFading.off         head=5358  late=-2  latepack=-8  headB=-4  latepacku=-6
textures.off           head=5454  late=+23  latepack=-825  headB=+19  latepacku=-800
fx.off                 head=5570  late=+14  latepack=-875  headB=+15  latepacku=-843
effects.off            head=5570  late=+14  latepack=-875  headB=+15  latepacku=-843
weapons.off            head=6374  late=+26  latepack=-1295  headB=+22  latepacku=-1264
weaponsReady.off       head=6374  late=+26  latepack=-1295  headB=+22  latepacku=-1264
operators.off          head=6634  late=+20  latepack=-1427  headB=+24  latepacku=-1406
pace.last              head=6694  late=-  latepack=-  headB=+11  latepacku=-
readyMs                head=6771  late=+21  latepack=-1342  headB=+12  latepacku=-1353
props.off              head=6771  late=+4  latepack=-1474  headB=-0  latepacku=-1450
streaming.off          head=6771  late=+21  latepack=-1474  headB=+12  latepacku=-1450

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=337  late=+2  latepack=+5  headB=+2  latepacku=+1
sky.on                 head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
bakeLayout.on          head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
bake.on                head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
textures.on            head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
fx.on                  head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
weapons.on             head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
operators.on           head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
props.on               head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
streaming.on           head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
warmups.on             head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
effects.on             head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
weaponsReady.on        head=451  late=+6  latepack=+5  headB=+5  latepacku=+6
enteredMs              head=460  late=+5  latepack=+4  headB=+5  latepacku=+5
matchMs                head=576  late=+2  latepack=+5  headB=+1  latepacku=+6
firstPlayableMs        head=578  late=+2  latepack=+5  headB=+1  latepacku=+5
warmups.off            head=582  late=+18  latepack=+1565  headB=-1  latepacku=+8
compiles.on            head=659  late=+3  latepack=+6  headB=+1  latepacku=+9
skyLanding.on          head=828  late=+2  latepack=+8  headB=-0  latepacku=+13
quietEndMs             head=3583  late=+2  latepack=+7  headB=-1  latepacku=+7
compiles.off           head=3596  late=+2  latepack=+7  headB=-1  latepacku=+6
sky.off                head=3807  late=-1  latepack=+3  headB=-4  latepacku=+8
skyLanding.off         head=3807  late=-1  latepack=+3  headB=-4  latepacku=+8
bakeLayout.off         head=3807  late=-1  latepack=+3  headB=-4  latepacku=+8
bake.off               head=3930  late=+5  latepack=+17  headB=+2  latepacku=+13
bakeFading.on          head=3930  late=+5  latepack=+17  headB=+2  latepacku=+13
bakeFading.off         head=5435  late=+13  latepack=+24  headB=+6  latepacku=+16
textures.off           head=6866  late=+5  latepack=+39  headB=+15  latepacku=-37
fx.off                 head=7090  late=-5  latepack=+36  headB=+17  latepacku=-50
effects.off            head=7090  late=-5  latepack=+36  headB=+17  latepacku=-50
pace.last              head=8121  late=+25  latepack=-2900  headB=-104  latepacku=-190
weapons.off            head=8285  late=-24  latepack=-136  headB=+6  latepacku=-248
weaponsReady.off       head=8285  late=-24  latepack=-136  headB=+6  latepacku=-248
operators.off          head=8774  late=-23  latepack=-132  headB=+20  latepacku=-254
readyMs                head=8932  late=-24  latepack=-144  headB=+20  latepacku=-270
props.off              head=8932  late=-18  latepack=-96  headB=-3  latepacku=-236
streaming.off          head=8932  late=-24  latepack=-144  headB=+20  latepacku=-270

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=144.4 3.0/2.0 skip 278.8 n 1795 r 942/31.1 pace 2  late=143.1 3.0/2.0 skip 274.7 n 1803 r 940/30.6 pace 2  latepack=144.1 3.0/2.0 skip 231.0 n 1534 r 1137/30.0 pace 2  headB=143.1 3.0/1.9 skip 278.8 n 1805 r 938/31.5 pace 2  latepacku=143.1 3.0/2.0 skip 223.3 n 1529 r 1143/30.8 pace 2
low      head=128.3 1.0/1.0 skip 0.0 n 1 r 2/1.1 pace 1  late=127.9 1.0/1.0 skip 0.0 n 1 r 2/1.2 pace 1  latepack=126.7 1.0/1.0 skip 0.0 n 1 r 2/1.1 pace 1  headB=125.4 1.0/1.0 skip 0.0 n 1 r 2/1.2 pace 1  latepacku=120.3 1.0/1.0 skip 0.0 n 1 r 2/1.1 pace 1
medium   head=134.3 2.8/2.3 skip 356.4 n 1876 r 942/25.3 pace 2  late=132.5 2.9/2.3 skip 351.3 n 1868 r 926/23.9 pace 2  latepack=130.8 2.9/2.3 skip 262.4 n 1661 r 1510/23.8 pace 2  headB=134.8 2.8/2.0 skip 367.9 n 1904 r 938/24.1 pace 2  latepacku=134.4 2.8/2.1 skip 243.8 n 1662 r 1520/23.8 pace 2
high     head=145.2 4.0/2.4 skip 331.2 n 1718 r 944/37.5 pace 2  late=144.3 3.9/2.5 skip 332.8 n 1730 r 956/36.9 pace 2  latepack=146.2 4.0/2.4 skip 254.1 n 1404 r 835/36.5 pace 1  headB=144.9 4.0/2.3 skip 323.8 n 1718 r 943/36.7 pace 2  latepacku=145.1 3.9/2.5 skip 256.8 n 1403 r 830/37.0 pace 1
ultra    head=159.8 4.2/2.3 skip 427.6 n 2201 r 1257/40.7 pace 2  late=160.1 4.3/2.4 skip 414.8 n 2253 r 1265/38.2 pace 2  latepack=160.6 4.2/2.3 skip 407.5 n 2471 r 1270/38.8 pace 2  headB=160.8 4.2/2.3 skip 423.3 n 2282 r 1276/41.5 pace 2  latepacku=161.4 4.1/2.4 skip 392.7 n 2089 r 1281/38.3 pace 2
low late: ready faster 7/12, firstPlayable faster 7/12
low latepack: ready faster 8/12, firstPlayable faster 8/12
low headB: ready faster 6/12, firstPlayable faster 6/12
low latepacku: ready faster 6/12, firstPlayable faster 6/12
medium late: ready faster 4/12, firstPlayable faster 4/12
medium latepack: ready faster 12/12, firstPlayable faster 4/12
medium headB: ready faster 8/12, firstPlayable faster 4/12
medium latepacku: ready faster 12/12, firstPlayable faster 4/12
high late: ready faster 4/12, firstPlayable faster 7/12
high latepack: ready faster 12/12, firstPlayable faster 6/12
high headB: ready faster 4/12, firstPlayable faster 5/12
high latepacku: ready faster 12/12, firstPlayable faster 5/12
ultra late: ready faster 7/12, firstPlayable faster 5/12
ultra latepack: ready faster 10/12, firstPlayable faster 2/12
ultra headB: ready faster 4/12, firstPlayable faster 5/12
ultra latepacku: ready faster 11/12, firstPlayable faster 3/12

Pairwise readyMs (geomean of paired ratios over 12 cell-rounds, faster count):
low     late/head           -2.6% faster 7/12
low     latepack/late       0.5% faster 4/12
low     latepack/head       -2.1% faster 8/12
low     latepacku/latepack  0.0% faster 5/12
low     headB/head          1.9% faster 6/12
medium  late/head           -0.3% faster 4/12
medium  latepack/late       -19.7% faster 12/12
medium  latepack/head       -19.9% faster 12/12
medium  latepacku/latepack  0.0% faster 4/12
medium  headB/head          0.0% faster 8/12
high    late/head           0.5% faster 4/12
high    latepack/late       -18.2% faster 12/12
high    latepack/head       -17.8% faster 12/12
high    latepacku/latepack  -0.1% faster 5/12
high    headB/head          0.4% faster 4/12
ultra   late/head           -0.3% faster 7/12
ultra   latepack/late       0.1% faster 10/12
ultra   latepack/head       -0.2% faster 10/12
ultra   latepacku/latepack  -1.8% faster 10/12
ultra   headB/head          0.2% faster 4/12
```

# Round 6 paired A/B runs

Power and thermal readings: `perf/results/r6-power.log`. Charger: 20 W USB-C (pmset -g ac) all round, so each run was cut to fit 50 % -> 35 %.

## r6ld: load-only (AB_ARGS=--load-only, 1 cold load per cell-round), low/medium/high/ultra x downtown/house/mexico/training, head/load/headB, 3 rounds (balanced), 04:26-04:41
```
HEAD 8be1c3893d935df7a6b432b50c5eaa8264cdc766  variants: head, load, headB  args: --load-only  (2026-10-19T19:25:52.613Z)
complete: 3 variants x 48 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=3872 (+0.0%)  load=3793 (-2.0%)  headB=3890 (+0.5%)
low      head=486 (+0.0%)  load=465 (-4.4%)  headB=498 (+2.5%)
medium   head=7034 (+0.0%)  load=6959 (-1.1%)  headB=7012 (-0.3%)
high     head=7182 (+0.0%)  load=7092 (-1.3%)  headB=7160 (-0.3%)
ultra    head=9150 (+0.0%)  load=9025 (-1.4%)  headB=9151 (+0.0%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=550 (+0.0%)  load=525 (-4.5%)  headB=552 (+0.5%)
low      head=469 (+0.0%)  load=456 (-2.7%)  headB=481 (+2.5%)
medium   head=530 (+0.0%)  load=518 (-2.3%)  headB=529 (-0.1%)
high     head=562 (+0.0%)  load=530 (-5.8%)  headB=559 (-0.6%)
ultra    head=652 (+0.0%)  load=606 (-7.1%)  headB=653 (+0.1%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=327  load=-9  headB=-1
warmups.on             head=428  load=-12  headB=-1
sky.on                 head=432  load=-13  headB=-1
bakeLayout.on          head=432  load=-13  headB=-1
bake.on                head=432  load=-13  headB=-1
textures.on            head=432  load=-13  headB=-1
fx.on                  head=432  load=-13  headB=-1
weapons.on             head=432  load=-13  headB=-1
operators.on           head=432  load=-13  headB=-1
props.on               head=432  load=-13  headB=-1
streaming.on           head=432  load=-13  headB=-1
effects.on             head=432  load=-13  headB=-1
weaponsReady.on        head=432  load=-13  headB=-1
enteredMs              head=437  load=-12  headB=-0
matchMs                head=532  load=-11  headB=-0
firstPlayableMs        head=534  load=-11  headB=-0
compiles.on            head=602  load=-14  headB=+0
skyLanding.on          head=759  load=-15  headB=-1
quietEndMs             head=3544  load=-11  headB=+4
compiles.off           head=3554  load=-8  headB=+4
warmups.off            head=3599  load=-74  headB=+1
sky.off                head=3778  load=-11  headB=-2
skyLanding.off         head=3778  load=-11  headB=-2
bakeLayout.off         head=4160  load=-11  headB=-3
bake.off               head=4263  load=-5  headB=+1
bakeFading.on          head=4263  load=-5  headB=+1
bakeFading.off         head=5774  load=-11  headB=+2
textures.off           head=6388  load=-26  headB=-4
fx.off                 head=6531  load=-33  headB=-6
effects.off            head=6531  load=-33  headB=-6
readyMs                head=6996  load=-25  headB=+0
weapons.off            head=7434  load=-27  headB=-4
weaponsReady.off       head=7434  load=-27  headB=-4
operators.off          head=7736  load=-32  headB=-7
pace.last              head=7911  load=-  headB=-14
props.off              head=7926  load=-59  headB=-7
streaming.off          head=7926  load=-60  headB=-4

## phases (low): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=325  load=-9  headB=+1
warmups.on             head=363  load=-11  headB=+1
enteredMs              head=366  load=-11  headB=+1
matchMs                head=462  load=-9  headB=+1
firstPlayableMs        head=463  load=-10  headB=+1
warmups.off            head=463  load=-10  headB=+1
readyMs                head=479  load=-20  headB=+2

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=323  load=-8  headB=-2
sky.on                 head=424  load=-10  headB=-1
bakeLayout.on          head=424  load=-10  headB=-1
bake.on                head=424  load=-10  headB=-1
textures.on            head=424  load=-10  headB=-1
fx.on                  head=424  load=-10  headB=-1
weapons.on             head=424  load=-10  headB=-1
operators.on           head=424  load=-10  headB=-1
props.on               head=424  load=-10  headB=-1
streaming.on           head=424  load=-10  headB=-1
warmups.on             head=424  load=-10  headB=-1
effects.on             head=424  load=-10  headB=-1
weaponsReady.on        head=424  load=-10  headB=-1
enteredMs              head=433  load=-10  headB=-1
matchMs                head=528  load=-9  headB=-0
firstPlayableMs        head=531  load=-11  headB=+0
compiles.on            head=592  load=-14  headB=-1
skyLanding.on          head=689  load=-14  headB=-0
quietEndMs             head=3536  load=-13  headB=-3
compiles.off           head=3547  load=-12  headB=-4
warmups.off            head=3604  load=-3100  headB=-4
sky.off                head=3772  load=-11  headB=-2
skyLanding.off         head=3772  load=-11  headB=-2
bakeLayout.off         head=4124  load=-26  headB=-8
bake.off               head=4181  load=-23  headB=+1
bakeFading.on          head=4181  load=-23  headB=+1
bakeFading.off         head=5682  load=-24  headB=-5
textures.off           head=5971  load=-32  headB=-19
fx.off                 head=6097  load=-39  headB=-13
effects.off            head=6097  load=-39  headB=-13
weapons.off            head=6951  load=-27  headB=-18
weaponsReady.off       head=6951  load=-27  headB=-18
operators.off          head=7245  load=-48  headB=-22
readyMs                head=7415  load=-73  headB=-13
props.off              head=7415  load=-72  headB=-9
streaming.off          head=7415  load=-73  headB=-13
pace.last              head=7440  load=-  headB=-66

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=323  load=-8  headB=-1
sky.on                 head=434  load=-12  headB=-2
bakeLayout.on          head=434  load=-12  headB=-2
bake.on                head=434  load=-12  headB=-2
textures.on            head=434  load=-12  headB=-2
fx.on                  head=434  load=-12  headB=-2
weapons.on             head=434  load=-12  headB=-2
operators.on           head=434  load=-12  headB=-2
props.on               head=434  load=-12  headB=-2
streaming.on           head=434  load=-12  headB=-2
warmups.on             head=434  load=-12  headB=-2
effects.on             head=434  load=-12  headB=-2
weaponsReady.on        head=434  load=-12  headB=-2
enteredMs              head=442  load=-12  headB=-1
matchMs                head=534  load=-11  headB=-2
firstPlayableMs        head=536  load=-11  headB=-2
compiles.on            head=599  load=-14  headB=-1
skyLanding.on          head=758  load=-15  headB=-2
quietEndMs             head=3544  load=-8  headB=+6
compiles.off           head=3553  load=-5  headB=+6
warmups.off            head=3615  load=-3107  headB=+8
sky.off                head=3776  load=-9  headB=-6
skyLanding.off         head=3776  load=-9  headB=-6
bakeLayout.off         head=4149  load=-6  headB=+0
bake.off               head=4206  load=+3  headB=+7
bakeFading.on          head=4206  load=+3  headB=+7
bakeFading.off         head=5707  load=-4  headB=+11
textures.off           head=6042  load=-18  headB=-2
fx.off                 head=6168  load=-19  headB=+4
effects.off            head=6168  load=-19  headB=+4
weapons.off            head=7015  load=-23  headB=+4
weaponsReady.off       head=7015  load=-23  headB=+4
operators.off          head=7313  load=-26  headB=-5
pace.last              head=7442  load=-  headB=+43
readyMs                head=7472  load=-40  headB=-2
props.off              head=7472  load=-40  headB=-8
streaming.off          head=7472  load=-40  headB=-2

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=356  load=-20  headB=-2
sky.on                 head=485  load=-27  headB=-2
bakeLayout.on          head=485  load=-27  headB=-2
bake.on                head=485  load=-27  headB=-2
textures.on            head=485  load=-27  headB=-2
fx.on                  head=485  load=-27  headB=-2
weapons.on             head=485  load=-27  headB=-2
operators.on           head=485  load=-27  headB=-2
props.on               head=485  load=-27  headB=-2
streaming.on           head=485  load=-27  headB=-2
warmups.on             head=485  load=-27  headB=-2
effects.on             head=485  load=-27  headB=-2
weaponsReady.on        head=485  load=-27  headB=-2
enteredMs              head=495  load=-27  headB=-2
matchMs                head=596  load=-30  headB=-1
firstPlayableMs        head=603  load=-33  headB=-1
compiles.on            head=685  load=-33  headB=+1
skyLanding.on          head=876  load=-36  headB=+2
quietEndMs             head=3611  load=-30  headB=+6
compiles.off           head=3620  load=-27  headB=+5
warmups.off            head=3724  load=-1619  headB=-10
sky.off                head=3845  load=-24  headB=+14
skyLanding.off         head=3845  load=-24  headB=+14
bakeLayout.off         head=4196  load=-22  headB=-8
bake.off               head=4332  load=-4  headB=-8
bakeFading.on          head=4332  load=-4  headB=-8
bakeFading.off         head=5844  load=-4  headB=-4
textures.off           head=7540  load=-30  headB=+17
fx.off                 head=7771  load=-44  headB=+23
effects.off            head=7771  load=-44  headB=+23
weapons.off            head=8987  load=-21  headB=+13
weaponsReady.off       head=8987  load=-21  headB=+13
operators.off          head=9506  load=-8  headB=+5
readyMs                head=9723  load=-49  headB=+15
props.off              head=9723  load=-53  headB=+5
streaming.off          head=9723  load=-49  headB=+15
pace.last              head=10881  load=-  headB=-39

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=146.6 3.0/2.1 skip 298.5 n 1841 r 1009/33.0 pace 2  load=144.5 2.8/2.1 skip 292.6 n 1825 r 1014/29.8 pace 2  headB=145.3 3.0/2.3 skip 291.4 n 1841 r 1014/33.3 pace 2
low      head=97.1 1.0/1.0 skip 0.0 n 1 r 13/12.2 pace 1  load=104.2 1.0/1.0 skip 0.0 n 1 r 2/1.2 pace 1  headB=102.0 1.0/1.0 skip 0.0 n 1 r 14/12.7 pace 1
medium   head=119.1 3.0/2.2 skip 404.7 n 2000 r 1009/26.3 pace 2  load=106.3 2.8/2.1 skip 374.2 n 1975 r 989/23.8 pace 2  headB=119.3 2.9/2.5 skip 380.1 n 1984 r 1014/26.3 pace 2
high     head=148.2 4.1/2.5 skip 360.8 n 1872 r 1010/40.0 pace 2  load=146.8 3.5/2.3 skip 360.3 n 1888 r 1023/36.2 pace 2  headB=146.8 4.0/2.7 skip 361.7 n 1889 r 1016/40.0 pace 2
ultra    head=164.5 4.1/2.8 skip 428.5 n 2243 r 1355/51.0 pace 2  load=174.1 4.1/3.0 skip 436.2 n 2248 r 1318/51.0 pace 2  headB=169.0 4.2/2.8 skip 423.8 n 2242 r 1352/49.9 pace 2
```

Patches: the A/Bs read `perf/patches/r6/<name>.patch`; the same bytes are committed as `perf/patches/r6-<name>.patch` (the manifests' SHA-256 match).

## r6cpu: traced fights only (AB_TRACE=1, AB_ARGS=--scenarios fight), low/medium/high/ultra x training/mexico, head/bundle/headB/matrix, 2 rounds (near-balanced), 05:36-06:03

`bundle` = r5-walk + r5-low1 + Round 2's D ported to the Round 4 code (`r6-bundle.patch`); `matrix` = three's second world-matrix walk skipped for figures syncModel updated (`r6-matrix.patch`).
```
HEAD 8be1c3893d935df7a6b432b50c5eaa8264cdc766  variants: head, bundle, headB, matrix  (2026-10-19T20:35:44.606Z)
complete: 4 variants x 16 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.408 (0.0%)  bundle=3.422 (0.4%)  headB=3.415 (0.2%)  matrix=3.415 (0.2%)
low      head=1.889 (0.0%)  bundle=1.901 (0.6%)  headB=1.953 (3.4%)  matrix=1.882 (-0.4%)
medium   head=3.229 (0.0%)  bundle=3.453 (6.9%)  headB=3.099 (-4.0%)  matrix=3.188 (-1.3%)
high     head=4.381 (0.0%)  bundle=4.256 (-2.9%)  headB=4.412 (0.7%)  matrix=4.444 (1.4%)
ultra    head=5.050 (0.0%)  bundle=4.910 (-2.8%)  headB=5.092 (0.8%)  matrix=5.102 (1.0%)

## med: geomean (paired ratio vs head)
all      head=3.255 (0.0%)  bundle=3.240 (-0.4%)  headB=3.245 (-0.3%)  matrix=3.254 (-0.0%)
low      head=1.765 (0.0%)  bundle=1.765 (0.0%)  headB=1.812 (2.7%)  matrix=1.775 (0.6%)
medium   head=3.142 (0.0%)  bundle=3.272 (4.2%)  headB=2.981 (-5.1%)  matrix=3.091 (-1.6%)
high     head=4.229 (0.0%)  bundle=4.025 (-4.8%)  headB=4.200 (-0.7%)  matrix=4.135 (-2.2%)
ultra    head=4.786 (0.0%)  bundle=4.743 (-0.9%)  headB=4.886 (2.1%)  matrix=4.943 (3.3%)

## p95: geomean (paired ratio vs head)
all      head=5.355 (0.0%)  bundle=5.435 (1.5%)  headB=5.341 (-0.3%)  matrix=5.420 (1.2%)
low      head=3.148 (0.0%)  bundle=3.172 (0.7%)  headB=3.246 (3.1%)  matrix=3.124 (-0.8%)
medium   head=4.993 (0.0%)  bundle=5.464 (9.4%)  headB=4.769 (-4.5%)  matrix=4.885 (-2.2%)
high     head=6.751 (0.0%)  bundle=6.749 (-0.0%)  headB=6.864 (1.7%)  matrix=7.372 (9.2%)
ultra    head=7.748 (0.0%)  bundle=7.462 (-3.7%)  headB=7.656 (-1.2%)  matrix=7.673 (-1.0%)

## js: geomean (paired ratio vs head)
all      head=2.369 (0.0%)  bundle=2.254 (-4.8%)  headB=2.310 (-2.5%)  matrix=2.288 (-3.4%)
low      head=1.181 (0.0%)  bundle=1.176 (-0.4%)  headB=1.192 (0.9%)  matrix=1.161 (-1.7%)
medium   head=2.325 (0.0%)  bundle=2.178 (-6.3%)  headB=2.148 (-7.6%)  matrix=2.151 (-7.5%)
high     head=3.134 (0.0%)  bundle=2.897 (-7.6%)  headB=3.047 (-2.8%)  matrix=3.092 (-1.3%)
ultra    head=3.658 (0.0%)  bundle=3.478 (-4.9%)  headB=3.651 (-0.2%)  matrix=3.550 (-2.9%)

## js (fight only): geomean (paired ratio vs head)
all      head=2.369 (0.0%)  bundle=2.254 (-4.8%)  headB=2.310 (-2.5%)  matrix=2.288 (-3.4%)
low      head=1.181 (0.0%)  bundle=1.176 (-0.4%)  headB=1.192 (0.9%)  matrix=1.161 (-1.7%)
medium   head=2.325 (0.0%)  bundle=2.178 (-6.3%)  headB=2.148 (-7.6%)  matrix=2.151 (-7.5%)
high     head=3.134 (0.0%)  bundle=2.897 (-7.6%)  headB=3.047 (-2.8%)  matrix=3.092 (-1.3%)
ultra    head=3.658 (0.0%)  bundle=3.478 (-4.9%)  headB=3.651 (-0.2%)  matrix=3.550 (-2.9%)

## gc ms/frame (main-thread MinorGC+MajorGC in the traced replay): mean (difference vs head, ms)
all            head=0.009 (+0.000)  bundle=0.009 (+0.001)  headB=0.009 (+0.001)  matrix=0.010 (+0.001)
low            head=0.007 (+0.000)  bundle=0.007 (-0.000)  headB=0.008 (+0.001)  matrix=0.006 (-0.000)
medium         head=0.010 (+0.000)  bundle=0.010 (+0.000)  headB=0.009 (-0.001)  matrix=0.009 (-0.000)
high           head=0.008 (+0.000)  bundle=0.010 (+0.001)  headB=0.011 (+0.003)  matrix=0.011 (+0.002)
ultra          head=0.009 (+0.000)  bundle=0.011 (+0.002)  headB=0.009 (-0.000)  matrix=0.013 (+0.004)

order-corrected fit (perf/ab-posfit.mjs, fight):
# mean
all     bundle=0.4%  headB=0.2%  matrix=0.2%  | pos1..: 0.8 1.5 2.2
low     bundle=1.6%  headB=3.5%  matrix=-1.2%  | pos1..: 0.1 3.7 0.3
medium  bundle=6.9%  headB=-2.1%  matrix=0.8%  | pos1..: 6.0 4.1 10.4
high    bundle=-1.6%  headB=2.6%  matrix=2.0%  | pos1..: 0.8 -1.4 -3.0
ultra   bundle=-2.9%  headB=-0.1%  matrix=0.3%  | pos1..: -0.5 1.8 0.6
# med
all     bundle=-0.4%  headB=-0.3%  matrix=-0.0%  | pos1..: 1.2 2.6 2.7
low     bundle=1.4%  headB=2.4%  matrix=-1.1%  | pos1..: 0.0 6.4 -0.5
medium  bundle=3.5%  headB=-3.9%  matrix=0.3%  | pos1..: 5.2 2.5 10.7
high    bundle=-4.3%  headB=0.2%  matrix=-1.9%  | pos1..: 0.5 -0.6 -1.2
ultra   bundle=-1.3%  headB=1.0%  matrix=2.6%  | pos1..: 0.3 2.2 1.0
# p95
all     bundle=1.5%  headB=-0.3%  matrix=1.2%  | pos1..: 0.6 0.8 1.0
low     bundle=0.9%  headB=3.0%  matrix=-1.0%  | pos1..: -1.0 0.9 -1.1
medium  bundle=11.6%  headB=-0.7%  matrix=-0.2%  | pos1..: 10.7 8.2 10.7
high    bundle=3.7%  headB=6.5%  matrix=10.3%  | pos1..: 1.1 -5.3 -7.9
ultra   bundle=-4.2%  headB=-3.8%  matrix=-3.1%  | pos1..: -1.0 5.5 2.3
# js
all     bundle=-4.8%  headB=-2.5%  matrix=-3.4%  | pos1..: 1.4 2.5 1.8
low     bundle=-0.6%  headB=0.7%  matrix=-1.8%  | pos1..: 0.3 0.0 -0.3
medium  bundle=-4.7%  headB=-3.4%  matrix=-4.8%  | pos1..: 6.3 9.3 8.8
high    bundle=-8.6%  headB=-3.1%  matrix=-0.4%  | pos1..: 2.0 4.2 2.6
ultra   bundle=-4.8%  headB=-0.3%  matrix=-3.1%  | pos1..: -1.8 0.2 -1.3
# cpu
all     bundle=0.6%  headB=0.3%  matrix=-0.5%  | pos1..: 0.2 -0.5 2.8
low     bundle=1.1%  headB=2.5%  matrix=-1.3%  | pos1..: -0.1 0.8 0.1
medium  bundle=9.8%  headB=-1.0%  matrix=1.3%  | pos1..: 5.5 3.3 10.5
high    bundle=-1.7%  headB=1.8%  matrix=1.3%  | pos1..: -0.0 -3.1 -2.2
ultra   bundle=-4.0%  headB=1.6%  matrix=-2.0%  | pos1..: -1.4 -1.5 1.4

per cell-round, fight frame mean ms / js ms:
low    training r1 head=2.16/1.55 bundle=2.16/1.54 headB=2.45/1.60 matrix=2.13/1.51 
low    training r2 head=2.18/1.54 bundle=2.24/1.56 headB=2.19/1.55 matrix=2.14/1.52 
low    mexico   r1 head=1.64/0.91 bundle=1.66/0.90 headB=1.67/0.91 matrix=1.64/0.88 
low    mexico   r2 head=1.66/0.89 bundle=1.63/0.88 headB=1.63/0.89 matrix=1.67/0.90 
medium training r1 head=3.00/2.21 bundle=2.85/2.15 headB=2.98/2.22 matrix=2.95/2.19 
medium training r2 head=4.22/3.20 bundle=4.18/2.65 headB=3.78/2.21 matrix=4.16/2.59 
medium mexico   r1 head=2.40/1.78 bundle=3.29/1.81 headB=2.37/1.77 matrix=2.43/1.77 
medium mexico   r2 head=3.57/2.32 bundle=3.63/2.19 headB=3.45/2.45 matrix=3.47/2.13 
high   training r1 head=4.98/3.76 bundle=4.70/3.26 headB=5.15/3.27 matrix=5.10/3.71 
high   training r2 head=5.01/3.55 bundle=4.71/3.28 headB=4.92/3.51 matrix=5.12/3.49 
high   mexico   r1 head=3.73/2.38 bundle=3.71/2.36 headB=3.76/2.58 matrix=3.77/2.47 
high   mexico   r2 head=3.96/3.02 bundle=4.00/2.79 headB=3.98/2.91 matrix=3.97/2.86 
ultra  training r1 head=5.22/3.86 bundle=5.08/3.77 headB=5.27/3.85 matrix=5.19/3.73 
ultra  training r2 head=5.63/4.29 bundle=5.23/3.81 headB=5.62/4.28 matrix=5.41/3.98 
ultra  mexico   r1 head=4.45/3.30 bundle=4.50/3.17 headB=4.65/3.23 matrix=4.73/3.26 
ultra  mexico   r2 head=4.97/3.27 bundle=4.86/3.22 headB=4.88/3.33 matrix=5.11/3.27 
```

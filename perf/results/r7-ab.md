# Round 7 paired A/B runs

Power and thermal readings: `perf/results/r7-power.log`. Charger: 20 W USB-C until ~10:30, then the 94 W charger (pmset -g ac: Wattage 94) for every bench of record. Gate: AC and >= 50 %, void under 35 % (`PERF_MIN_BATT=35`). Job 1a ran 56 -> 70 %, job 1b (below).

## r7-pre: traced, all presets on downtown + training (as r5-pre/r6-pre), HEAD 1fba3a6 (src = 00a8411), 10:52-10:56
```
### suite aggregates (geomean over 8 map x preset cells x 2 scenarios; the verdict)

| group | frame mean | frame med | frame p95 | cpu mean | js mean |
|---|---|---|---|---|---|
| all | 2.556 → 2.515 (-1.6%) | 2.640 → 2.562 (-3.0% **IMP**) | 3.992 → 3.950 (-1.1%) | 2.115 → 2.050 (-3.1%) | 1.079 → 1.151 (+6.7%) |
| low | 1.686 → 1.643 (-2.6%) | 1.744 → 1.732 (-0.7%) | 2.971 → 2.864 (-3.6%) | 1.380 → 1.295 (-6.1%) | 0.667 → 0.696 (+4.3%) |
| medium | 2.342 → 2.366 (+1.0%) | 2.437 → 2.414 (-0.9%) | 3.690 → 3.758 (+1.8%) | 1.876 → 1.899 (+1.2%) | 1.061 → 1.179 (+11.1% **REG**) |
| high | 2.890 → 2.852 (-1.3%) | 3.051 → 2.918 (-4.4%) | 4.320 → 4.366 (+1.1%) | 2.413 → 2.345 (-2.8%) | 1.236 → 1.449 (+17.2%) |
| ultra | 3.742 → 3.611 (-3.5% **IMP**) | 3.746 → 3.529 (-5.8% **IMP**) | 5.364 → 5.179 (-3.4%) | 3.203 → 3.063 (-4.4% **IMP**) | 1.550 → 1.479 (-4.6%) |

**suite verdict**: 1 regressed, 4 improved, 20 within noise (REGRESSION)
- all frame med: -3.0% (threshold 2.8%) improved
- medium js mean: 11.1% (threshold 3.2%) regressed
- ultra frame mean: -3.5% (threshold 2.0%) improved
- ultra frame med: -5.8% (threshold 2.4%) improved
- ultra cpu mean: -4.4% (threshold 2.6%) improved

```

## r7ll: load-only (AB_ARGS=--load-only), low x downtown/house/mexico/training, head / noload (HEAD minus Round 6's `load`, = /tmp/r7-noload.patch: `git apply -R perf/patches/r6-load.patch`) / headB, 3 rounds (balanced), 10:56-10:57
```
HEAD 1fba3a6b4dde272308161ec5147b19d1b89501f2  variants: head, noload, headB  args: --load-only  (2026-10-20T01:56:51.138Z)
complete: 3 variants x 12 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=484 (+0.0%)  noload=500 (+3.4%)  headB=480 (-0.7%)
low      head=484 (+0.0%)  noload=500 (+3.4%)  headB=480 (-0.7%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=475 (+0.0%)  noload=483 (+1.6%)  headB=472 (-0.7%)
low      head=475 (+0.0%)  noload=483 (+1.6%)  headB=472 (-0.7%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=328  noload=+6  headB=-3
warmups.on             head=365  noload=+8  headB=-1
enteredMs              head=368  noload=+8  headB=-2
matchMs                head=466  noload=+10  headB=+2
firstPlayableMs        head=467  noload=+10  headB=+2
warmups.off            head=467  noload=+10  headB=+2
readyMs                head=475  noload=+17  headB=+2

## phases (low): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=328  noload=+6  headB=-3
warmups.on             head=365  noload=+8  headB=-1
enteredMs              head=368  noload=+8  headB=-2
matchMs                head=466  noload=+10  headB=+2
firstPlayableMs        head=467  noload=+10  headB=+2
warmups.off            head=467  noload=+10  headB=+2
readyMs                head=475  noload=+17  headB=+2

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=114.2 1.0/1.0 skip 0.0 n 1 r 2/1.0 pace 1  noload=116.8 1.0/1.0 skip 0.0 n 1 r 14/13.1 pace 1  headB=112.7 1.0/1.0 skip 0.0 n 1 r 2/1.1 pace 1
low      head=114.2 1.0/1.0 skip 0.0 n 1 r 2/1.0 pace 1  noload=116.8 1.0/1.0 skip 0.0 n 1 r 14/13.1 pace 1  headB=112.7 1.0/1.0 skip 0.0 n 1 r 2/1.1 pace 1
low noload: ready faster 2/12, firstPlayable faster 3/12
low headB: ready faster 4/12, firstPlayable faster 4/12
```

## r7ld: load-only, medium/high/ultra x downtown/house/mexico, head / set (r7-set.patch: pre + worker + misc + hud) / headB / pack (r7-pack.patch), 4 rounds (balanced), 10:57-11:18
```
HEAD 1fba3a6b4dde272308161ec5147b19d1b89501f2  variants: head, set, headB, pack  args: --load-only  (2026-10-20T01:57:34.246Z)
complete: 4 variants x 36 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=8378 (+0.0%)  set=8028 (-4.2%)  headB=8395 (+0.2%)  pack=6946 (-17.1%)
medium   head=7805 (+0.0%)  set=7292 (-6.6%)  headB=7766 (-0.5%)  pack=5744 (-26.4%)
high     head=7590 (+0.0%)  set=7263 (-4.3%)  headB=7604 (+0.2%)  pack=5980 (-21.2%)
ultra    head=9925 (+0.0%)  set=9767 (-1.6%)  headB=10018 (+0.9%)  pack=9754 (-1.7%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=611 (+0.0%)  set=587 (-4.0%)  headB=611 (-0.1%)  pack=601 (-1.7%)
medium   head=557 (+0.0%)  set=538 (-3.4%)  headB=588 (+5.6%)  pack=582 (+4.6%)
high     head=617 (+0.0%)  set=583 (-5.5%)  headB=567 (-8.2%)  pack=582 (-5.7%)
ultra    head=665 (+0.0%)  set=646 (-2.9%)  headB=683 (+2.7%)  pack=640 (-3.7%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=343  set=-11  headB=+3  pack=-2
sky.on                 head=450  set=-11  headB=+5  pack=+0
bakeLayout.on          head=450  set=-11  headB=+5  pack=+0
bake.on                head=450  set=-11  headB=+5  pack=+0
textures.on            head=450  set=-11  headB=+5  pack=+0
fx.on                  head=450  set=-11  headB=+5  pack=+0
weapons.on             head=450  set=-11  headB=+5  pack=+0
operators.on           head=450  set=-11  headB=+5  pack=+0
props.on               head=450  set=-11  headB=+5  pack=+0
streaming.on           head=450  set=-11  headB=+5  pack=+0
warmups.on             head=450  set=-11  headB=+5  pack=+0
effects.on             head=450  set=-11  headB=+5  pack=+0
weaponsReady.on        head=450  set=-11  headB=+5  pack=+0
enteredMs              head=459  set=-11  headB=+6  pack=+0
matchMs                head=568  set=-5  headB=+7  pack=-2
firstPlayableMs        head=571  set=-5  headB=+6  pack=-2
warmups.off            head=584  set=-13  headB=+6  pack=+8
compiles.on            head=640  set=-4  headB=+8  pack=+0
skyLanding.on          head=792  set=-1  headB=+8  pack=+6
quietEndMs             head=3573  set=-7  headB=+8  pack=+7
compiles.off           head=3585  set=-7  headB=+9  pack=+7
sky.off                head=3808  set=-11  headB=+9  pack=+5
skyLanding.off         head=3808  set=-11  headB=+9  pack=+5
bakeLayout.off         head=4201  set=-381  headB=-1  pack=-1
bake.off               head=4277  set=-395  headB=-5  pack=-8
bakeFading.on          head=4277  set=-395  headB=-5  pack=-8
bakeFading.off         head=5781  set=-399  headB=-2  pack=-15
textures.off           head=6655  set=-442  headB=-32  pack=-939
fx.off                 head=6795  set=-444  headB=-24  pack=-1001
effects.off            head=6795  set=-444  headB=-24  pack=-1001
weapons.off            head=7772  set=-440  headB=+7  pack=-1486
weaponsReady.off       head=7772  set=-440  headB=+7  pack=-1486
pace.last              head=8102  set=-438  headB=-50  pack=-1757
operators.off          head=8120  set=-443  headB=+6  pack=-1670
readyMs                head=8273  set=-445  headB=+8  pack=-1308
props.off              head=8273  set=-445  headB=+8  pack=-1724
streaming.off          head=8273  set=-445  headB=+8  pack=-1724

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=329  set=-11  headB=+6  pack=+3
sky.on                 head=427  set=-12  headB=+10  pack=+5
bakeLayout.on          head=427  set=-12  headB=+10  pack=+5
bake.on                head=427  set=-12  headB=+10  pack=+5
textures.on            head=427  set=-12  headB=+10  pack=+5
fx.on                  head=427  set=-12  headB=+10  pack=+5
weapons.on             head=427  set=-12  headB=+10  pack=+5
operators.on           head=427  set=-12  headB=+10  pack=+5
props.on               head=427  set=-12  headB=+10  pack=+5
streaming.on           head=427  set=-12  headB=+10  pack=+5
warmups.on             head=427  set=-12  headB=+10  pack=+5
effects.on             head=427  set=-12  headB=+10  pack=+5
weaponsReady.on        head=427  set=-12  headB=+10  pack=+5
enteredMs              head=435  set=-12  headB=+10  pack=+5
matchMs                head=541  set=-12  headB=+16  pack=+15
firstPlayableMs        head=543  set=-13  headB=+16  pack=+15
warmups.off            head=557  set=-17  headB=+16  pack=+28
compiles.on            head=602  set=-15  headB=+22  pack=+17
skyLanding.on          head=704  set=-15  headB=+30  pack=+14
quietEndMs             head=3549  set=-9  headB=+22  pack=+18
compiles.off           head=3561  set=-9  headB=+21  pack=+19
sky.off                head=3790  set=-17  headB=+24  pack=+20
skyLanding.off         head=3790  set=-17  headB=+24  pack=+20
bakeLayout.off         head=4156  set=-372  headB=+25  pack=+39
bake.off               head=4238  set=-395  headB=+26  pack=-6
bakeFading.on          head=4238  set=-395  headB=+26  pack=-6
bakeFading.off         head=5744  set=-401  headB=+30  pack=-15
textures.off           head=6492  set=-475  headB=-51  pack=-1902
fx.off                 head=6624  set=-478  headB=-43  pack=-2043
effects.off            head=6624  set=-478  headB=-43  pack=-2043
weapons.off            head=7558  set=-500  headB=-58  pack=-2842
weaponsReady.off       head=7558  set=-500  headB=-58  pack=-2842
pace.last              head=7893  set=-531  headB=-91  pack=-3223
operators.off          head=7916  set=-525  headB=-71  pack=-3169
readyMs                head=8073  set=-530  headB=-64  pack=-2287
props.off              head=8073  set=-530  headB=-64  pack=-3251
streaming.off          head=8073  set=-530  headB=-64  pack=-3251

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=341  set=-10  headB=-6  pack=+2
sky.on                 head=446  set=-5  headB=-7  pack=+0
bakeLayout.on          head=446  set=-5  headB=-7  pack=+0
bake.on                head=446  set=-5  headB=-7  pack=+0
textures.on            head=446  set=-5  headB=-7  pack=+0
fx.on                  head=446  set=-5  headB=-7  pack=+0
weapons.on             head=446  set=-5  headB=-7  pack=+0
operators.on           head=446  set=-5  headB=-7  pack=+0
props.on               head=446  set=-5  headB=-7  pack=+0
streaming.on           head=446  set=-5  headB=-7  pack=+0
warmups.on             head=446  set=-5  headB=-7  pack=+0
effects.on             head=446  set=-5  headB=-7  pack=+0
weaponsReady.on        head=446  set=-5  headB=-7  pack=+0
enteredMs              head=454  set=-6  headB=-7  pack=+0
matchMs                head=561  set=+0  headB=-7  pack=-4
firstPlayableMs        head=563  set=-0  headB=-8  pack=-4
warmups.off            head=601  set=-2  headB=+2  pack=+15
compiles.on            head=631  set=+3  headB=-8  pack=-4
skyLanding.on          head=792  set=+8  headB=-10  pack=-5
quietEndMs             head=3567  set=-6  headB=-10  pack=-2
compiles.off           head=3580  set=-6  headB=-9  pack=-2
sky.off                head=3800  set=-7  headB=-13  pack=-5
skyLanding.off         head=3800  set=-7  headB=-13  pack=-5
bakeLayout.off         head=4208  set=-382  headB=-41  pack=-23
bake.off               head=4274  set=-385  headB=-41  pack=-19
bakeFading.on          head=4274  set=-385  headB=-41  pack=-19
bakeFading.off         head=5780  set=-390  headB=-34  pack=-22
textures.off           head=6227  set=-388  headB=-11  pack=-939
fx.off                 head=6359  set=-396  headB=-5  pack=-1001
effects.off            head=6359  set=-396  headB=-5  pack=-1001
pace.last              head=7005  set=-389  headB=+77  pack=-1465
weapons.off            head=7217  set=-373  headB=+30  pack=-1486
weaponsReady.off       head=7217  set=-373  headB=+30  pack=-1486
operators.off          head=7533  set=-386  headB=+20  pack=-1670
readyMs                head=7667  set=-379  headB=+37  pack=-1673
props.off              head=7667  set=-379  headB=+37  pack=-1724
streaming.off          head=7667  set=-379  headB=+37  pack=-1724

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=349  set=-9  headB=+5  pack=-8
sky.on                 head=469  set=-9  headB=+6  pack=-7
bakeLayout.on          head=469  set=-9  headB=+6  pack=-7
bake.on                head=469  set=-9  headB=+6  pack=-7
textures.on            head=469  set=-9  headB=+6  pack=-7
fx.on                  head=469  set=-9  headB=+6  pack=-7
weapons.on             head=469  set=-9  headB=+6  pack=-7
operators.on           head=469  set=-9  headB=+6  pack=-7
props.on               head=469  set=-9  headB=+6  pack=-7
streaming.on           head=469  set=-9  headB=+6  pack=-7
warmups.on             head=469  set=-9  headB=+6  pack=-7
effects.on             head=469  set=-9  headB=+6  pack=-7
weaponsReady.on        head=469  set=-9  headB=+6  pack=-7
enteredMs              head=479  set=-10  headB=+7  pack=-6
matchMs                head=584  set=-2  headB=+7  pack=-6
firstPlayableMs        head=587  set=-2  headB=+7  pack=-6
compiles.on            head=667  set=+2  headB=+9  pack=-3
skyLanding.on          head=832  set=+3  headB=+10  pack=+4
warmups.off            head=992  set=-17  headB=+2  pack=-18
quietEndMs             head=3591  set=-3  headB=+11  pack=-7
compiles.off           head=3605  set=-4  headB=+11  pack=-7
sky.off                head=3824  set=-8  headB=+12  pack=-17
skyLanding.off         head=3824  set=-8  headB=+12  pack=-17
bakeLayout.off         head=4240  set=-411  headB=-21  pack=-13
bake.off               head=4388  set=-417  headB=-30  pack=-24
bakeFading.on          head=4388  set=-417  headB=-30  pack=-24
bakeFading.off         head=5896  set=-415  headB=-27  pack=-29
textures.off           head=8057  set=-396  headB=-44  pack=-112
fx.off                 head=8299  set=-402  headB=-43  pack=-112
effects.off            head=8299  set=-402  headB=-43  pack=-112
weapons.off            head=9679  set=-403  headB=-16  pack=-283
weaponsReady.off       head=9679  set=-403  headB=-16  pack=-283
operators.off          head=10121  set=-409  headB=-25  pack=-276
pace.last              head=10206  set=-383  headB=-58  pack=-749
readyMs                head=10295  set=-401  headB=-27  pack=-273
props.off              head=10295  set=-401  headB=-27  pack=-273
streaming.off          head=10295  set=-401  headB=-27  pack=-273

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=142.5 3.8/2.3 skip 453.0 n 2132 r 1071/38.0 pace 2  set=143.0 3.7/2.4 skip 444.8 n 2024 r 933/37.1 pace 4  headB=142.8 3.8/2.4 skip 454.4 n 2120 r 1069/36.5 pace 2  pack=143.2 3.7/2.3 skip 372.2 n 1691 r 1319/36.8 pace 4
medium   head=122.3 3.0/2.2 skip 480.2 n 2186 r 923/24.9 pace 2  set=119.0 3.0/2.2 skip 441.0 n 2056 r 835/25.8 pace 2  headB=123.8 3.0/2.1 skip 455.1 n 2136 r 945/25.6 pace 2  pack=132.3 3.0/2.2 skip 321.9 n 1691 r 1445/25.1 pace 2
high     head=151.0 4.1/2.3 skip 401.1 n 1888 r 1018/38.9 pace 2  set=151.1 4.2/2.2 skip 394.5 n 1836 r 882/37.8 pace 2  headB=142.7 4.0/2.4 skip 417.5 n 1976 r 944/37.6 pace 2  pack=142.8 3.9/2.3 skip 328.6 n 1486 r 762/37.6 pace 2
ultra    head=151.2 4.3/2.4 skip 477.8 n 2341 r 1271/40.5 pace 2  set=162.3 4.0/2.8 skip 498.8 n 2436 r 1228/43.0 pace 4  headB=162.2 4.3/2.7 skip 490.5 n 2520 r 1326/41.5 pace 2  pack=160.9 4.1/2.6 skip 466.1 n 2497 r 1319/43.0 pace 4
medium set: ready faster 11/12, firstPlayable faster 10/12
medium headB: ready faster 7/12, firstPlayable faster 2/12
medium pack: ready faster 12/12, firstPlayable faster 5/12
high set: ready faster 10/12, firstPlayable faster 6/12
high headB: ready faster 3/12, firstPlayable faster 6/12
high pack: ready faster 12/12, firstPlayable faster 6/12
ultra set: ready faster 11/12, firstPlayable faster 6/12
ultra headB: ready faster 7/12, firstPlayable faster 3/12
ultra pack: ready faster 10/12, firstPlayable faster 7/12
```

## r7f: fights only (AB_ARGS=--scenarios fight, no trace), low/medium/high/ultra x training/mexico, head / set / headB / cpuhm (r7-cpuhm.patch: `fightCpuPaths` also on High and Medium), 4 rounds (balanced), 11:18-11:45

Power-state jumps inside cells this run (e.g. high/training r2 head 6.29 ms vs ~3.4 in other rounds; r4 set/headB +42/+53 %; medium/mexico r4 head 3.74 vs 2.5-2.8 ms): read the robust view (medians of per-cell ratios) next to the geomeans. On Low and Ultra, cpuhm builds the same code as HEAD (a third HEAD-equivalent arm).
```
HEAD 1fba3a6b4dde272308161ec5147b19d1b89501f2  variants: head, set, headB, cpuhm  (2026-10-20T02:18:51.338Z)
complete: 4 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=3.085 (0.0%)  set=2.954 (-4.2%)  headB=3.084 (-0.0%)  cpuhm=3.023 (-2.0%)
low      head=1.891 (0.0%)  set=1.820 (-3.8%)  headB=1.944 (2.8%)  cpuhm=1.931 (2.1%)
medium   head=2.979 (0.0%)  set=2.696 (-9.5%)  headB=3.023 (1.5%)  cpuhm=2.900 (-2.6%)
high     head=3.646 (0.0%)  set=3.528 (-3.2%)  headB=3.586 (-1.6%)  cpuhm=3.574 (-2.0%)
ultra    head=4.408 (0.0%)  set=4.401 (-0.2%)  headB=4.296 (-2.5%)  cpuhm=4.169 (-5.4%)

## med: geomean (paired ratio vs head)
all      head=2.989 (0.0%)  set=2.849 (-4.7%)  headB=2.984 (-0.2%)  cpuhm=2.947 (-1.4%)
low      head=1.799 (0.0%)  set=1.708 (-5.0%)  headB=1.831 (1.8%)  cpuhm=1.839 (2.2%)
medium   head=2.917 (0.0%)  set=2.606 (-10.7%)  headB=2.938 (0.7%)  cpuhm=2.867 (-1.7%)
high     head=3.606 (0.0%)  set=3.468 (-3.8%)  headB=3.532 (-2.1%)  cpuhm=3.541 (-1.8%)
ultra    head=4.218 (0.0%)  set=4.270 (1.2%)  headB=4.174 (-1.1%)  cpuhm=4.040 (-4.2%)

## p95: geomean (paired ratio vs head)
all      head=4.559 (0.0%)  set=4.361 (-4.4%)  headB=4.596 (0.8%)  cpuhm=4.471 (-1.9%)
low      head=3.058 (0.0%)  set=2.929 (-4.2%)  headB=3.176 (3.9%)  cpuhm=3.114 (1.8%)
medium   head=4.363 (0.0%)  set=3.969 (-9.0%)  headB=4.455 (2.1%)  cpuhm=4.275 (-2.0%)
high     head=5.155 (0.0%)  set=4.980 (-3.4%)  headB=5.164 (0.2%)  cpuhm=5.135 (-0.4%)
ultra    head=6.283 (0.0%)  set=6.246 (-0.6%)  headB=6.103 (-2.9%)  cpuhm=5.846 (-7.0%)

[mean] diagnostic only: r7f log(mean, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
[mean] all     cpuhm=-2.0%  headB=-0.0%  set=-4.2%  | pos1..: 2.2 -1.0 -3.2
[mean] low     cpuhm=2.1%  headB=2.8%  set=-3.8%  | pos1..: 3.5 0.1 0.9
[mean] medium  cpuhm=-2.6%  headB=1.5%  set=-9.5%  | pos1..: 5.0 7.3 4.5
[mean] high    cpuhm=-2.0%  headB=-1.6%  set=-3.2%  | pos1..: -0.6 -10.3 -13.2
[mean] ultra   cpuhm=-5.4%  headB=-2.5%  set=-0.2%  | pos1..: 0.9 -0.4 -4.1
[med] diagnostic only: r7f log(med, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
[med] all     cpuhm=-1.4%  headB=-0.2%  set=-4.7%  | pos1..: 2.7 -0.4 -2.4
[med] low     cpuhm=2.2%  headB=1.8%  set=-5.0%  | pos1..: 4.8 1.7 1.7
[med] medium  cpuhm=-1.7%  headB=0.7%  set=-10.7%  | pos1..: 5.0 7.8 5.5
[med] high    cpuhm=-1.8%  headB=-2.1%  set=-3.8%  | pos1..: -0.7 -10.1 -12.9
[med] ultra   cpuhm=-4.2%  headB=-1.1%  set=1.2%  | pos1..: 1.7 0.0 -3.0
[p95] diagnostic only: r7f log(p95, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
[p95] all     cpuhm=-1.9%  headB=0.8%  set=-4.4%  | pos1..: 1.5 -1.0 -3.7
[p95] low     cpuhm=1.8%  headB=3.9%  set=-4.2%  | pos1..: 2.1 -0.0 0.9
[p95] medium  cpuhm=-2.0%  headB=2.1%  set=-9.0%  | pos1..: 4.0 6.1 4.2
[p95] high    cpuhm=-0.4%  headB=0.2%  set=-3.4%  | pos1..: 1.6 -8.9 -12.7
[p95] ultra   cpuhm=-7.0%  headB=-2.9%  set=-0.6%  | pos1..: -1.6 -0.6 -6.1
[cpu] diagnostic only: r7f log(cpu, fight) = cell-scenario-round + variant + run position; each preset row is its own fit, its position effects shared by its cells (the all row shares one set across presets; pos1..: vs the first run), positions from ab.sh's rotation, no uncertainty
[cpu] all     cpuhm=-3.1%  headB=-0.1%  set=1.8%  | pos1..: 1.9 -1.6 -3.3
[cpu] low     cpuhm=0.6%  headB=2.3%  set=2.1%  | pos1..: 2.2 -1.3 0.5
[cpu] medium  cpuhm=-3.3%  headB=1.8%  set=-3.8%  | pos1..: 5.2 7.3 6.4
[cpu] high    cpuhm=-3.4%  headB=-1.6%  set=3.3%  | pos1..: -1.3 -12.2 -15.1
[cpu] ultra   cpuhm=-6.1%  headB=-2.9%  set=6.0%  | pos1..: 1.5 0.8 -3.5

robust (`node perf/ab-robust.mjs r7f <key> [--cells]`): median over the 8 cell-rounds of variant/head and variant/headB, and how many cell-rounds were faster
-- mean
low     set: med/head -4.4% (faster 6/8), med/headB -4.6% (faster 7/8) | headB: med/head 3.3% (faster 2/8) | cpuhm: med/head 0.6% (faster 3/8), med/headB -0.5% (faster 5/8)
medium  set: med/head -6.8% (faster 6/8), med/headB -5.7% (faster 8/8) | headB: med/head 1.0% (faster 3/8) | cpuhm: med/head -2.7% (faster 5/8), med/headB -5.1% (faster 7/8)
high    set: med/head -5.2% (faster 6/8), med/headB -3.3% (faster 5/8) | headB: med/head 1.7% (faster 3/8) | cpuhm: med/head -1.0% (faster 5/8), med/headB -2.2% (faster 5/8)
ultra   set: med/head -0.1% (faster 4/8), med/headB 0.9% (faster 3/8) | headB: med/head -1.0% (faster 5/8) | cpuhm: med/head 1.2% (faster 4/8), med/headB 0.2% (faster 4/8)
-- med
low     set: med/head -5.6% (faster 6/8), med/headB -5.6% (faster 5/8) | headB: med/head 2.3% (faster 1/8) | cpuhm: med/head 0.0% (faster 1/8), med/headB 0.0% (faster 2/8)
medium  set: med/head -6.4% (faster 6/8), med/headB -5.2% (faster 8/8) | headB: med/head 0.0% (faster 2/8) | cpuhm: med/head -1.7% (faster 4/8), med/headB -3.3% (faster 5/8)
high    set: med/head -4.6% (faster 6/8), med/headB -3.2% (faster 5/8) | headB: med/head 1.4% (faster 3/8) | cpuhm: med/head 0.0% (faster 2/8), med/headB -1.4% (faster 4/8)
ultra   set: med/head 1.3% (faster 3/8), med/headB 2.7% (faster 3/8) | headB: med/head -1.3% (faster 4/8) | cpuhm: med/head 1.3% (faster 3/8), med/headB -0.1% (faster 4/8)
-- p95
low     set: med/head -3.3% (faster 6/8), med/headB -6.4% (faster 7/8) | headB: med/head 3.6% (faster 0/8) | cpuhm: med/head 0.0% (faster 1/8), med/headB -3.2% (faster 5/8)
medium  set: med/head -6.0% (faster 7/8), med/headB -6.2% (faster 8/8) | headB: med/head 2.5% (faster 3/8) | cpuhm: med/head -2.2% (faster 4/8), med/headB -3.5% (faster 5/8)
high    set: med/head -3.2% (faster 5/8), med/headB -5.3% (faster 6/8) | headB: med/head 4.2% (faster 3/8) | cpuhm: med/head 1.2% (faster 3/8), med/headB -3.1% (faster 5/8)
ultra   set: med/head 2.8% (faster 2/8), med/headB 1.8% (faster 3/8) | headB: med/head 1.8% (faster 1/8) | cpuhm: med/head 2.8% (faster 3/8), med/headB 1.7% (faster 3/8)

per cell and round: fight frame mean, ratio vs head
low training
  r1 head 2.31 set -4.1% headB 0.3% cpuhm -0.1%
  r2 head 2.31 set -13.2% headB 5.0% cpuhm -1.0%
  r3 head 2.12 set -5.5% headB 7.8% cpuhm 1.0%
  r4 head 2.12 set -4.6% headB 3.5% cpuhm 0.8%
low mexico
  r1 head 1.64 set -5.6% headB -0.7% cpuhm 0.4%
  r2 head 1.55 set 3.7% headB 7.0% cpuhm 16.4%
  r3 head 1.65 set -4.1% headB -3.1% cpuhm -1.8%
  r4 head 1.62 set 4.4% headB 3.1% cpuhm 2.5%
medium training
  r1 head 3.04 set 2.8% headB 5.0% cpuhm 3.9%
  r2 head 3.11 set -6.0% headB 1.7% cpuhm -5.0%
  r3 head 3.10 set -5.5% headB -1.7% cpuhm -5.5%
  r4 head 3.23 set -8.8% headB -2.8% cpuhm -8.8%
medium mexico
  r1 head 2.76 set -11.8% headB -8.3% cpuhm -6.3%
  r2 head 2.51 set 5.0% headB 10.7% cpuhm 0.9%
  r3 head 2.54 set -7.6% headB 0.2% cpuhm -0.3%
  r4 head 3.74 set -36.8% headB 8.2% cpuhm 0.7%
high training
  r1 head 3.50 set -6.5% headB 3.2% cpuhm -0.4%
  r2 head 6.29 set -33.4% headB -43.2% cpuhm -4.9%
  r3 head 3.43 set -6.1% headB -0.7% cpuhm -1.7%
  r4 head 3.42 set 42.2% headB 53.3% cpuhm 2.9%
high mexico
  r1 head 3.34 set -4.3% headB 7.3% cpuhm -2.7%
  r2 head 3.69 set -8.7% headB -12.3% cpuhm -15.7%
  r3 head 3.31 set 6.7% headB 4.2% cpuhm 6.9%
  r4 head 2.97 set -0.9% headB 0.2% cpuhm 1.4%
ultra training
  r1 head 6.08 set -9.4% headB -3.2% cpuhm -24.9%
  r2 head 4.35 set 11.8% headB -5.7% cpuhm -8.7%
  r3 head 4.04 set 18.9% headB 5.5% cpuhm 6.1%
  r4 head 3.95 set -0.6% headB -1.9% cpuhm -0.1%
ultra mexico
  r1 head 5.46 set -24.0% headB -17.0% cpuhm -23.7%
  r2 head 3.97 set 0.3% headB -0.2% cpuhm 2.5%
  r3 head 4.22 set -5.6% headB 0.7% cpuhm 9.5%
  r4 head 3.69 set 14.6% headB 3.3% cpuhm 3.0%
```

## hitch (perf/hitch.mjs measure, by the pre agent before the merge, r7-pre branch vs 00a8411, 3 loads per build alternating, straight into the fight after ready, first 120 frames; scratch-hitch-measure2.json, gitignored; battery low on the 20 W adapter during these loads)

| cell | build | callback 21 wall ms | max frame ms | p99 ms | programs ready / after fight |
|---|---|---|---|---|---|
| training/high | HEAD | 458, 29.5, 30.4 (callback 25: 90, 21, 19) | 457 / 32.5 / 32.9 | 32.8 | 51 / 53 |
| training/high | pre | 19.5, 18.5, 22.6 | 34.2 / 32.9 / 36.2 | 33.7 | 51 / 51 |
| training/ultra | HEAD | 124, 108, 128 | 133 / 116 / 132 | 33.6 | 53 / 55 |
| training/ultra | pre | 19.6, 17.9, 19.9 | 32.6 / 37.3 / 35.3 | 32.8 | 53 / 53 |
| house/ultra (650 frames, 2 loads) | HEAD | 201 / 134; cb 85: 367 / 226; cb 604: 198 / 184 | 380 / 233 | — | 54 / 58 |
| house/ultra (650 frames, 2 loads) | pre | — | 39 / 39 | — | 56 / 56 |

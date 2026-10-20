# Round 10 A/B notes

## r10b-{downtown,house,mexico,training}: final (head) vs Round 0 (r0 = reverse diff to c7a65d8) vs headB; path + fight, all presets, 3 balanced rounds each, --no-trace

```
base r0, tags r10b-downtown,r10b-house,r10b-mexico,r10b-training: 96 cell-scenario-rounds, control headB

## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 24 | 1.658 → 1.568 (-5.4 %) | 1.722 → 1.655 (-3.9 %) | 2.965 → 2.829 (-4.6 %) | 4.213 → 3.971 (-5.8 %) | 1.298 → 1.281 (-1.3 %) | 24/24 | -0.2 % / -0.2 % / +0.0 % / +0.7 % |
| medium | 24 | 2.971 → 2.365 (-20.4 %) | 3.023 → 2.467 (-18.4 %) | 4.521 → 3.835 (-15.2 %) | 6.091 → 5.386 (-11.6 %) | 2.466 → 1.982 (-19.6 %) | 24/24 | +2.7 % / +2.0 % / +1.8 % / +3.0 % |
| high | 24 | 3.608 → 2.965 (-17.8 %) | 3.571 → 3.062 (-14.3 %) | 5.180 → 4.477 (-13.6 %) | 6.720 → 5.993 (-10.8 %) | 3.082 → 2.539 (-17.6 %) | 24/24 | +0.2 % / -0.4 % / +0.0 % / -1.5 % |
| ultra | 24 | 4.655 → 3.704 (-20.4 %) | 4.615 → 3.640 (-21.1 %) | 6.311 → 5.312 (-15.8 %) | 8.359 → 7.066 (-15.5 %) | 4.056 → 3.206 (-21.0 %) | 24/24 | +1.0 % / +1.0 % / +0.1 % / +0.4 % |
| all | 96 | 3.016 → 2.526 (-16.2 %) | 3.043 → 2.597 (-14.7 %) | 4.575 → 4.008 (-12.4 %) | 6.162 → 5.486 (-11.0 %) | 2.515 → 2.132 (-15.2 %) | 96/96 | +0.9 % / +0.6 % / +0.5 % / +0.6 % |

## path: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 1.500 → 1.457 (-2.9 %) | 1.723 → 1.761 (+2.2 %) | 2.865 → 2.780 (-2.9 %) | 4.453 → 4.365 (-2.0 %) | 1.390 → 1.360 (-2.2 %) | 12/12 | +0.3 % / +0.6 % / +0.4 % / +0.9 % |
| medium | 12 | 2.580 → 2.110 (-18.2 %) | 2.720 → 2.362 (-13.2 %) | 4.077 → 3.652 (-10.4 %) | 5.872 → 5.506 (-6.2 %) | 2.395 → 1.951 (-18.5 %) | 12/12 | +2.7 % / +1.5 % / +1.2 % / +2.3 % |
| high | 12 | 3.091 → 2.556 (-17.3 %) | 3.098 → 2.767 (-10.7 %) | 4.530 → 4.024 (-11.2 %) | 6.068 → 5.664 (-6.7 %) | 2.898 → 2.390 (-17.5 %) | 12/12 | +1.2 % / -0.0 % / +1.0 % / -1.2 % |
| ultra | 12 | 4.121 → 3.280 (-20.4 %) | 4.126 → 3.264 (-20.9 %) | 5.516 → 4.612 (-16.4 %) | 7.652 → 6.287 (-17.8 %) | 3.930 → 3.087 (-21.4 %) | 12/12 | +1.7 % / +2.0 % / +2.0 % / +2.2 % |
| all | 48 | 2.650 → 2.253 (-15.0 %) | 2.782 → 2.476 (-11.0 %) | 4.133 → 3.705 (-10.4 %) | 5.903 → 5.409 (-8.4 %) | 2.481 → 2.103 (-15.2 %) | 48/48 | +1.5 % / +1.0 % / +1.2 % / +1.0 % |

## fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 12 | 1.832 → 1.688 (-7.9 %) | 1.721 → 1.555 (-9.7 %) | 3.068 → 2.878 (-6.2 %) | 3.987 → 3.612 (-9.4 %) | 1.213 → 1.207 (-0.5 %) | 12/12 | -0.7 % / -0.9 % / -0.3 % / +0.5 % |
| medium | 12 | 3.421 → 2.652 (-22.5 %) | 3.359 → 2.576 (-23.3 %) | 5.014 → 4.027 (-19.7 %) | 6.319 → 5.268 (-16.6 %) | 2.539 → 2.013 (-20.7 %) | 12/12 | +2.8 % / +2.6 % / +2.5 % / +3.6 % |
| high | 12 | 4.213 → 3.438 (-18.4 %) | 4.117 → 3.388 (-17.7 %) | 5.923 → 4.982 (-15.9 %) | 7.442 → 6.341 (-14.8 %) | 3.279 → 2.696 (-17.8 %) | 12/12 | -0.8 % / -0.8 % / -1.0 % / -1.7 % |
| ultra | 12 | 5.258 → 4.182 (-20.5 %) | 5.161 → 4.060 (-21.3 %) | 7.220 → 6.117 (-15.3 %) | 9.132 → 7.942 (-13.0 %) | 4.185 → 3.329 (-20.5 %) | 12/12 | +0.3 % / +0.1 % / -1.8 % / -1.4 % |
| all | 48 | 3.432 → 2.833 (-17.5 %) | 3.329 → 2.725 (-18.2 %) | 5.064 → 4.335 (-14.4 %) | 6.433 → 5.564 (-13.5 %) | 2.550 → 2.161 (-15.2 %) | 48/48 | +0.4 % / +0.3 % / -0.1 % / +0.2 % |

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

### downtown
---|---|---
 low | 1.561 → 1.513 (-3.1 %) | +0.2 % / -0.1 % / -1.7 % / +1.3 % 
 medium | 2.982 → 2.364 (-20.7 %) | +5.9 % / +5.9 % / +3.9 % / +7.8 % 
 high | 3.664 → 3.033 (-17.2 %) | -1.1 % / -1.4 % / -1.5 % / -1.6 % 
 ultra | 4.779 → 3.791 (-20.7 %) | +4.8 % / +6.1 % / +3.9 % / +1.1 % 
 all | 3.005 → 2.532 (-15.7 %) | +2.4 % / +2.6 % / +1.1 % / +2.1 % 
all     headB=2.4%  r0=18.6%  | pos1..: 0.3 2.0
low     headB=0.2%  r0=3.1%  | pos1..: 1.2 1.0
medium  headB=5.9%  r0=26.1%  | pos1..: 0.4 1.3
high    headB=-1.1%  r0=20.8%  | pos1..: -1.5 0.2
ultra   headB=4.8%  r0=26.1%  | pos1..: 1.3 5.5
### house
---|---|---
 low | 1.570 → 1.525 (-2.8 %) | -0.1 % / +0.8 % / +0.1 % / +0.3 % 
 medium | 2.786 → 2.342 (-16.0 %) | +2.1 % / -0.7 % / +1.3 % / +6.4 % 
 high | 3.536 → 2.926 (-17.3 %) | +0.8 % / +1.0 % / +0.4 % / -4.3 % 
 ultra | 4.511 → 3.669 (-18.7 %) | -0.3 % / -2.0 % / -1.6 % / +0.1 % 
 all | 2.890 → 2.488 (-13.9 %) | +0.6 % / -0.2 % / +0.0 % / +0.6 % 
all     headB=0.6%  r0=16.2%  | pos1..: 0.3 0.7
low     headB=-0.1%  r0=2.9%  | pos1..: -0.4 0.9
medium  headB=2.1%  r0=19.0%  | pos1..: 1.5 3.1
high    headB=0.8%  r0=20.9%  | pos1..: 0.5 0.8
ultra   headB=-0.3%  r0=22.9%  | pos1..: -0.4 -1.9
### mexico
---|---|---
 low | 1.545 → 1.469 (-4.9 %) | -0.4 % / -0.9 % / +1.3 % / +0.6 % 
 medium | 2.977 → 2.337 (-21.5 %) | +2.3 % / +1.5 % / +1.6 % / +0.4 % 
 high | 3.496 → 2.872 (-17.8 %) | +2.0 % / +1.1 % / +0.5 % / -0.9 % 
 ultra | 4.525 → 3.666 (-19.0 %) | +0.1 % / +0.6 % / -0.6 % / +1.0 % 
 all | 2.921 → 2.452 (-16.0 %) | +1.0 % / +0.6 % / +0.7 % / +0.3 % 
all     headB=1.0%  r0=19.1%  | pos1..: 2.7 0.9
low     headB=-0.4%  r0=5.2%  | pos1..: 0.0 -1.2
medium  headB=2.3%  r0=27.4%  | pos1..: 7.7 5.9
high    headB=2.0%  r0=21.7%  | pos1..: 0.7 -0.5
ultra   headB=0.1%  r0=23.4%  | pos1..: 2.4 -0.6
### training
---|---|---
 low | 1.994 → 1.784 (-10.6 %) | -0.5 % / -0.4 % / +0.6 % / +0.6 % 
 medium | 3.149 → 2.420 (-23.1 %) | +0.7 % / +1.5 % / +0.6 % / -2.4 % 
 high | 3.743 → 3.031 (-19.0 %) | -0.9 % / -2.2 % / +0.6 % / +1.0 % 
 ultra | 4.813 → 3.691 (-23.3 %) | -0.5 % / -0.3 % / -1.1 % / -0.6 % 
 all | 3.261 → 2.636 (-19.2 %) | -0.3 % / -0.4 % / +0.2 % / -0.4 % 
all     headB=-0.3%  r0=23.7%  | pos1..: 0.9 1.0
low     headB=-0.5%  r0=11.8%  | pos1..: -1.3 0.5
medium  headB=0.7%  r0=30.1%  | pos1..: 2.4 2.1
high    headB=-0.9%  r0=23.5%  | pos1..: 2.3 1.3
ultra   headB=-0.5%  r0=30.4%  | pos1..: 0.3 0.1

## r10b-downtown2 (repeat, medium + ultra)
base r0, tags r10b-downtown2: 12 cell-scenario-rounds, control headB

## path + fight: r0 → FINAL (head); change = head/r0 - 1 (control: headB/head - 1)
| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| medium | 6 | 2.773 → 2.245 (-19.0 %) | 2.883 → 2.421 (-16.0 %) | 4.428 → 3.782 (-14.6 %) | 6.356 → 5.228 (-17.8 %) | 2.191 → 1.854 (-15.3 %) | 6/6 | -0.1 % / -1.4 % / +1.3 % / +6.2 % |
| ultra | 6 | 4.495 → 3.512 (-21.9 %) | 4.540 → 3.505 (-22.8 %) | 6.070 → 5.147 (-15.2 %) | 8.305 → 6.859 (-17.4 %) | 3.977 → 3.058 (-23.1 %) | 6/6 | +0.9 % / +0.4 % / +0.5 % / -0.6 % |
| all | 12 | 3.530 → 2.808 (-20.5 %) | 3.618 → 2.913 (-19.5 %) | 5.184 → 4.412 (-14.9 %) | 7.266 → 5.988 (-17.6 %) | 2.951 → 2.381 (-19.3 %) | 12/12 | +0.4 % / -0.5 % / +0.9 % / +2.8 % |

all     headB=0.4%  r0=25.7%  | pos1..: 0.3 1.7
medium  headB=-0.1%  r0=23.5%  | pos1..: -0.9 -0.5
ultra   headB=0.9%  r0=28.0%  | pos1..: 1.6 4.0
```

## r10l: load-only, all presets x 4 maps, 3 rounds

```
HEAD eb2e3599e16fba3703c689f07532da5a803e7d10  variants: head, r0, headB  args: --load-only  (2026-10-20T13:28:24.320Z)
complete: 3 variants x 48 map-preset-rounds x 1 load(s)

## readyMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=3087 (+0.0%)  r0=3760 (+21.8%)  headB=3075 (-0.4%)
low      head=398 (+0.0%)  r0=502 (+26.3%)  headB=389 (-2.0%)
medium   head=5209 (+0.0%)  r0=6848 (+31.5%)  headB=5220 (+0.2%)
high     head=5372 (+0.0%)  r0=6802 (+26.6%)  headB=5383 (+0.2%)
ultra    head=8158 (+0.0%)  r0=8539 (+4.7%)  headB=8174 (+0.2%)

## firstPlayableMs: geomean of the cell-round medians, ms (paired ratio vs head)
all      head=446 (+0.0%)  r0=553 (+23.9%)  headB=447 (+0.1%)
low      head=389 (+0.0%)  r0=484 (+24.4%)  headB=381 (-2.0%)
medium   head=452 (+0.0%)  r0=565 (+25.0%)  headB=460 (+1.7%)
high     head=464 (+0.0%)  r0=577 (+24.2%)  headB=466 (+0.4%)
ultra    head=487 (+0.0%)  r0=594 (+22.0%)  headB=488 (+0.2%)

## phases (all): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=330  r0=+12  headB=+2
warmups.on             head=436  r0=+10  headB=+4
sky.on                 head=440  r0=+11  headB=+4
bakeLayout.on          head=440  r0=+11  headB=+4
bake.on                head=440  r0=+11  headB=+4
textures.on            head=440  r0=+11  headB=+4
fx.on                  head=440  r0=+11  headB=+4
weapons.on             head=440  r0=+11  headB=+4
operators.on           head=440  r0=+11  headB=+4
props.on               head=440  r0=+11  headB=+4
streaming.on           head=440  r0=+11  headB=+4
effects.on             head=440  r0=+11  headB=+4
weaponsReady.on        head=440  r0=+11  headB=+4
enteredMs              head=444  r0=+11  headB=+3
matchMs                head=453  r0=+105  headB=+3
firstPlayableMs        head=455  r0=+107  headB=+3
warmups.off            head=464  r0=+140  headB=+6
compiles.on            head=534  r0=+111  headB=+4
skyLanding.on          head=637  r0=+169  headB=+4
quietEndMs             head=3473  r0=+111  headB=+6
compiles.off           head=3486  r0=+109  headB=+6
sky.off                head=3697  r0=+114  headB=+4
skyLanding.off         head=3697  r0=+114  headB=+4
bakeLayout.off         head=3697  r0=+444  headB=+4
bake.off               head=3749  r0=+464  headB=+4
bakeFading.on          head=3749  r0=+464  headB=+4
pace.last              head=4114  r0=+3542  headB=+17
textures.off           head=4500  r0=+812  headB=+15
props.off              head=4547  r0=+1136  headB=+7
fx.off                 head=4605  r0=+881  headB=+16
effects.off            head=4605  r0=+881  headB=+16
weapons.off            head=4961  r0=+1393  headB=+14
weaponsReady.off       head=4961  r0=+1393  headB=+14
operators.off          head=5073  r0=+1564  headB=+12
streaming.off          head=5174  r0=+1592  headB=+13
readyMs                head=5240  r0=+384  headB=+4
bakeFading.off         head=5256  r0=+463  headB=+3

## phases (low): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=329  r0=+9  headB=-0
warmups.on             head=367  r0=+9  headB=+2
enteredMs              head=370  r0=+10  headB=+2
matchMs                head=384  r0=+101  headB=+2
firstPlayableMs        head=384  r0=+101  headB=+2
warmups.off            head=384  r0=+101  headB=+2
readyMs                head=391  r0=+109  headB=+2

## phases (medium): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=326  r0=+14  headB=+5
sky.on                 head=429  r0=+12  headB=+10
bakeLayout.on          head=429  r0=+12  headB=+10
bake.on                head=429  r0=+12  headB=+10
textures.on            head=429  r0=+12  headB=+10
fx.on                  head=429  r0=+12  headB=+10
weapons.on             head=429  r0=+12  headB=+10
operators.on           head=429  r0=+12  headB=+10
props.on               head=429  r0=+12  headB=+10
streaming.on           head=429  r0=+12  headB=+10
warmups.on             head=429  r0=+12  headB=+10
effects.on             head=429  r0=+12  headB=+10
weaponsReady.on        head=429  r0=+12  headB=+10
enteredMs              head=437  r0=+13  headB=+9
matchMs                head=449  r0=+111  headB=+9
firstPlayableMs        head=451  r0=+114  headB=+9
warmups.off            head=480  r0=+1660  headB=+12
compiles.on            head=514  r0=+112  headB=+8
skyLanding.on          head=580  r0=+145  headB=+10
quietEndMs             head=3452  r0=+117  headB=+11
compiles.off           head=3466  r0=+116  headB=+11
sky.off                head=3681  r0=+121  headB=+14
skyLanding.off         head=3681  r0=+121  headB=+14
bakeLayout.off         head=3681  r0=+444  headB=+14
bake.off               head=3706  r0=+485  headB=+13
bakeFading.on          head=3706  r0=+485  headB=+13
textures.off           head=3891  r0=+2003  headB=+15
fx.off                 head=3891  r0=+2129  headB=+15
effects.off            head=3891  r0=+2129  headB=+15
weapons.off            head=4001  r0=+2792  headB=+11
weaponsReady.off       head=4001  r0=+2792  headB=+11
operators.off          head=4023  r0=+3047  headB=+13
pace.last              head=4062  r0=+3573  headB=+17
props.off              head=4089  r0=+3152  headB=+12
streaming.off          head=4089  r0=+3152  headB=+15
readyMs                head=5208  r0=+2041  headB=+14
bakeFading.off         head=5208  r0=+497  headB=+14

## phases (high): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=329  r0=+14  headB=+4
sky.on                 head=443  r0=+12  headB=+4
bakeLayout.on          head=443  r0=+12  headB=+4
bake.on                head=443  r0=+12  headB=+4
textures.on            head=443  r0=+12  headB=+4
fx.on                  head=443  r0=+12  headB=+4
weapons.on             head=443  r0=+12  headB=+4
operators.on           head=443  r0=+12  headB=+4
props.on               head=443  r0=+12  headB=+4
streaming.on           head=443  r0=+12  headB=+4
warmups.on             head=443  r0=+12  headB=+4
effects.on             head=443  r0=+12  headB=+4
weaponsReady.on        head=443  r0=+12  headB=+4
enteredMs              head=452  r0=+13  headB=+4
matchMs                head=462  r0=+111  headB=+4
firstPlayableMs        head=464  r0=+114  headB=+4
warmups.off            head=464  r0=+3202  headB=+6
compiles.on            head=530  r0=+112  headB=+3
skyLanding.on          head=632  r0=+173  headB=+1
quietEndMs             head=3471  r0=+110  headB=+2
compiles.off           head=3485  r0=+105  headB=+2
sky.off                head=3700  r0=+106  headB=+1
skyLanding.off         head=3700  r0=+106  headB=+1
bakeLayout.off         head=3700  r0=+439  headB=+1
bake.off               head=3749  r0=+438  headB=+3
bakeFading.on          head=3749  r0=+438  headB=+3
textures.off           head=4531  r0=+1302  headB=+10
fx.off                 head=4605  r0=+1344  headB=+19
effects.off            head=4605  r0=+1344  headB=+19
pace.last              head=4853  r0=+1707  headB=-
weapons.off            head=4961  r0=+1747  headB=+9
weaponsReady.off       head=4961  r0=+1747  headB=+9
operators.off          head=5073  r0=+1872  headB=+1
props.off              head=5174  r0=+1943  headB=+8
streaming.off          head=5174  r0=+1943  headB=+1
bakeFading.off         head=5256  r0=+441  headB=-0
readyMs                head=5369  r0=+1764  headB=+2

## phases (ultra): head = median page ms; others: median difference vs head, ms (pairs with the phase on both sides)
liveMs                 head=337  r0=+9  headB=+2
sky.on                 head=458  r0=+9  headB=+1
bakeLayout.on          head=458  r0=+9  headB=+1
bake.on                head=458  r0=+9  headB=+1
textures.on            head=458  r0=+9  headB=+1
fx.on                  head=458  r0=+9  headB=+1
weapons.on             head=458  r0=+9  headB=+1
operators.on           head=458  r0=+9  headB=+1
props.on               head=458  r0=+9  headB=+1
streaming.on           head=458  r0=+9  headB=+1
warmups.on             head=458  r0=+9  headB=+1
effects.on             head=458  r0=+9  headB=+1
weaponsReady.on        head=458  r0=+9  headB=+1
enteredMs              head=467  r0=+8  headB=+1
matchMs                head=476  r0=+109  headB=+2
firstPlayableMs        head=479  r0=+112  headB=+1
warmups.off            head=509  r0=+3200  headB=+4
compiles.on            head=562  r0=+110  headB=+1
skyLanding.on          head=668  r0=+171  headB=+2
quietEndMs             head=3483  r0=+112  headB=+6
compiles.off           head=3496  r0=+110  headB=+7
sky.off                head=3719  r0=+118  headB=+2
skyLanding.off         head=3719  r0=+118  headB=+2
bakeLayout.off         head=3719  r0=+420  headB=+2
bake.off               head=3853  r0=+434  headB=+1
bakeFading.on          head=3853  r0=+434  headB=+1
bakeFading.off         head=5353  r0=+426  headB=-0
textures.off           head=6623  r0=+327  headB=+19
fx.off                 head=6840  r0=+307  headB=+20
effects.off            head=6840  r0=+307  headB=+20
weapons.off            head=7799  r0=+382  headB=+36
weaponsReady.off       head=7799  r0=+382  headB=+36
operators.off          head=8275  r0=+358  headB=+14
readyMs                head=8426  r0=+384  headB=+14
props.off              head=8426  r0=+384  headB=+4
streaming.off          head=8426  r0=+384  headB=+14
pace.last              head=-  r0=-  headB=-

## load window (match start to ready), over all loads: median max frame ms, mean frames >33 / >50 ms, mean skipped, median frames, median renderer ms (sum / longest), max upload pace
all      head=72.7 2.2/1.0 skip 283.3 n 1530 r 1164/27.3 pace 2  r0=145.1 3.1/2.1 skip 260.5 n 1687 r 1082/32.4 pace 2  headB=72.0 2.1/1.0 skip 287.2 n 1528 r 1166/27.8 pace 2
low      head=19.9 0.3/0.2 skip 0.0 n 1 r 1/0.8 pace 1  r0=115.3 1.0/1.0 skip 0.0 n 1 r 14/13.4 pace 1  headB=20.6 0.3/0.1 skip 0.0 n 1 r 1/0.9 pace 1
medium   head=51.1 2.4/0.8 skip 320.7 n 1673 r 1553/22.4 pace 2  r0=124.0 2.9/2.3 skip 332.3 n 1844 r 1070/25.6 pace 2  headB=50.2 2.3/0.8 skip 314.8 n 1666 r 1555/20.7 pace 2
high     head=77.7 2.8/1.7 skip 339.8 n 1393 r 895/35.3 pace 2  r0=145.9 4.0/2.8 skip 314.3 n 1720 r 1082/38.5 pace 2  headB=77.5 2.8/1.6 skip 344.8 n 1402 r 880/33.9 pace 1
ultra    head=83.8 3.3/1.5 skip 472.6 n 2087 r 1243/36.3 pace 1  r0=156.4 4.3/2.3 skip 395.5 n 2128 r 1423/39.7 pace 2  headB=78.0 3.1/1.5 skip 489.3 n 2078 r 1222/35.0 pace 1
low r0: ready faster 0/12, firstPlayable faster 1/12
low headB: ready faster 5/12, firstPlayable faster 5/12
medium r0: ready faster 0/12, firstPlayable faster 0/12
medium headB: ready faster 2/12, firstPlayable faster 2/12
high r0: ready faster 0/12, firstPlayable faster 0/12
high headB: ready faster 5/12, firstPlayable faster 5/12
ultra r0: ready faster 0/12, firstPlayable faster 0/12
ultra headB: ready faster 4/12, firstPlayable faster 4/12
```

## r10-measure: first-fight hitch (1 load per cell and build)

| build | cell | loads | ready ms | programs ready / fight / bench | max frame ms (each load) | p99 | p95 | med | max cpu ms | compile frames (cpu ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| final | downtown/low | 1 | 395.9 | 23/23/23 | 9.3 (9.3) | 5.5 | 2.8 | 0.9 | 3.7 (3.7) | - |
| r0 | downtown/low | 1 | 502.6 | 21/21/21 | 17.2 (17.2) | 10.2 | 3.2 | 1.2 | 21.4 (21.4) | - |
| final | downtown/medium | 1 | 5225 | 55/55/55 | 11.6 (11.6) | 8 | 4.2 | 1.5 | 5.8 (5.8) | - |
| r0 | downtown/medium | 1 | 7484.3 | 52/52/52 | 36 (36) | 11 | 5.9 | 2.4 | 35.4 (35.4) | - |
| final | downtown/high | 1 | 5435.6 | 57/57/57 | 11 (11) | 7.7 | 4.7 | 1.9 | 5.6 (5.6) | - |
| r0 | downtown/high | 1 | 7513.8 | 54/56/56 | 37.3 (37.3) | 33.9 | 6.2 | 2.3 | 45.5 (45.5) | #21 (45.5) #76 (31.5) |
| final | downtown/ultra | 1 | 9051 | 59/59/59 | 11.5 (11.5) | 7.9 | 6.4 | 3.1 | 6.2 (6.2) | - |
| r0 | downtown/ultra | 1 | 9528.9 | 56/58/58 | 70.5 (70.5) | 56.1 | 12.9 | 2.3 | 78.8 (78.8) | #21 (67.8) #76 (78.8) |
| final | house/low | 1 | 360 | 23/23/23 | 10 (10) | 3.9 | 3 | 0.9 | 3 (3) | - |
| r0 | house/low | 1 | 480.2 | 21/21/21 | 19.1 (19.1) | 13.1 | 3.5 | 1.2 | 21 (21) | - |
| final | house/medium | 1 | 5188.2 | 55/55/55 | 11.5 (11.5) | 5.5 | 3.8 | 1.6 | 4.7 (4.7) | - |
| r0 | house/medium | 1 | 7539.6 | 52/52/52 | 36.5 (36.5) | 18.6 | 4.9 | 2.3 | 36.8 (36.8) | - |
| final | house/high | 1 | 5463.3 | 57/57/57 | 11.2 (11.2) | 6.3 | 4.8 | 1.9 | 5.1 (5.1) | - |
| r0 | house/high | 1 | 7723.4 | 54/56/56 | 36.6 (36.6) | 20 | 7.3 | 2.6 | 41.5 (41.5) | #21 (41.5) #85 (28.6) |
| final | house/ultra | 1 | 9797.2 | 59/59/59 | 11.8 (11.8) | 7.2 | 5.5 | 3 | 5.8 (5.8) | - |
| r0 | house/ultra | 1 | 10100.9 | 54/56/58 | 70.3 (70.3) | 54.9 | 10.4 | 2.6 | 68.6 (68.6) | #21 (67.3) #85 (68.6) |
| final | mexico/low | 1 | 486.7 | 22/22/22 | 9.9 (9.9) | 6.5 | 2.9 | 1 | 4.7 (4.7) | - |
| r0 | mexico/low | 1 | 499.7 | 20/20/20 | 19.1 (19.1) | 9.8 | 3.3 | 1.2 | 16.9 (16.9) | - |
| final | mexico/medium | 1 | 5211.3 | 54/54/54 | 10 (10) | 8.2 | 4.6 | 1.8 | 5.8 (5.8) | - |
| r0 | mexico/medium | 1 | 6690.2 | 51/51/51 | 19.2 (19.2) | 15.1 | 5.9 | 2.6 | 31.5 (31.5) | - |
| final | mexico/high | 1 | 5231.5 | 56/56/56 | 9.8 (9.8) | 7.4 | 4.6 | 2 | 5.7 (5.7) | - |
| r0 | mexico/high | 1 | 6648.2 | 53/55/55 | 34.6 (34.6) | 19.9 | 5.8 | 2.7 | 40.7 (40.7) | #21 (40.7) #75 (9.4) |
| final | mexico/ultra | 1 | 7575.2 | 58/58/58 | 10.8 (10.8) | 7.9 | 5.3 | 2.7 | 6.4 (6.4) | - |
| r0 | mexico/ultra | 1 | 8241.9 | 55/57/57 | 55 (55) | 52.9 | 11.8 | 2.5 | 64.3 (64.3) | #21 (64.3) #75 (58.7) |
| final | training/low | 1 | 483.2 | 24/24/24 | 13.9 (13.9) | 5.7 | 4.1 | 2 | 4.6 (4.6) | - |
| r0 | training/low | 1 | 541.4 | 22/22/22 | 12.9 (12.9) | 7.1 | 4.1 | 2.4 | 5.6 (5.6) | - |
| final | training/medium | 1 | 5225.4 | 52/52/52 | 14.6 (14.6) | 7.1 | 4.5 | 2.6 | 5.4 (5.4) | - |
| r0 | training/medium | 1 | 5430.8 | 49/49/49 | 9.1 (9.1) | 8 | 5.3 | 3.6 | 7.4 (7.4) | - |
| final | training/high | 1 | 5303 | 54/54/54 | 14.9 (14.9) | 8.7 | 5.3 | 3.1 | 6.1 (6.1) | - |
| r0 | training/high | 1 | 5417.7 | 51/53/53 | 16.6 (16.6) | 13.8 | 6.7 | 4.2 | 11.7 (11.7) | #21 (11.7) #25 (7) |
| final | training/ultra | 1 | 6479.7 | 56/56/56 | 14 (14) | 8.4 | 5.3 | 3.1 | 5.7 (5.7) | - |
| r0 | training/ultra | 1 | 6606.5 | 53/55/55 | 38.9 (38.9) | 19.5 | 7.9 | 4.3 | 42.2 (42.2) | #21 (42.2) #25 (7.4) |

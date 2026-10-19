# Round 3 paired A/B runs

Power log (pmset -g batt / therm at each run start/end):
```
Mon Oct 19 05:05:12 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	11%; charging; 17:40 remaining present: true
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
Mon Oct 19 05:18:56 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; (no estimate) present: true
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
== s1-low start
Mon Oct 19 05:51:23 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; 17:30 remaining present: true
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
== s1-low end
Mon Oct 19 05:58:51 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; (no estimate) present: true
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
== s2 start
Mon Oct 19 05:59:16 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; 17:50 remaining present: true
== s2 end
Mon Oct 19 07:09:17 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; 20:00 remaining present: true
Note: No thermal warning level has been recorded
Note: No performance warning level has been recorded
Note: No CPU power status has been recorded
== s3 start
Mon Oct 19 07:10:28 JST 2026
Now drawing from 'AC Power'
 -InternalBattery-0 (id=22282339)	7%; charging; 20:00 remaining present: true
Now drawing from 'Battery Power'
 -InternalBattery-0 (id=22282339)	1%; discharging; 0:00 remaining present: true
	Battery Warning: Final
```

## s1: Low, head/headB/e/g, 4 rounds (balanced), 05:51-05:59
```
HEAD 2b45537b87371e7012d21382ab280532812a68bb  variants: head, headB, e, g  (2026-10-18T20:51:23.862Z)
complete: 4 variants x 32 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=1.740 (0.0%)  headB=1.745 (0.3%)  e=1.758 (1.0%)  g=1.732 (-0.4%)
low      head=1.740 (0.0%)  headB=1.745 (0.3%)  e=1.758 (1.0%)  g=1.732 (-0.4%)

## med: geomean (paired ratio vs head)
all      head=1.820 (0.0%)  headB=1.834 (0.7%)  e=1.852 (1.7%)  g=1.814 (-0.4%)
low      head=1.820 (0.0%)  headB=1.834 (0.7%)  e=1.852 (1.7%)  g=1.814 (-0.4%)

## p95: geomean (paired ratio vs head)
all      head=2.999 (0.0%)  headB=3.023 (0.8%)  e=3.038 (1.3%)  g=2.998 (-0.0%)
low      head=2.999 (0.0%)  headB=3.023 (0.8%)  e=3.038 (1.3%)  g=2.998 (-0.0%)
all     e=1.0%  g=-0.4%  headB=0.3%  | pos1..: 0.5 1.0 1.4
low     e=1.0%  g=-0.4%  headB=0.3%  | pos1..: 0.5 1.0 1.4
```

## s2: medium/high/ultra, head/headB/a/b/c/d/g, 2 rounds (near-balanced), 05:59-07:09
```
HEAD 2b45537b87371e7012d21382ab280532812a68bb  variants: head, headB, a, b, c, d, g  (2026-10-18T20:59:16.532Z)
complete: 7 variants x 48 cell-scenario-rounds

## mean: geomean (paired ratio vs head)
all      head=4.655 (0.0%)  headB=4.671 (0.3%)  a=4.714 (1.3%)  b=4.755 (2.2%)  c=4.717 (1.3%)  d=4.700 (1.0%)  g=4.642 (-0.3%)
medium   head=3.579 (0.0%)  headB=3.610 (0.9%)  a=3.729 (4.2%)  b=3.782 (5.7%)  c=3.691 (3.1%)  d=3.724 (4.1%)  g=3.679 (2.8%)
high     head=4.692 (0.0%)  headB=4.685 (-0.1%)  a=4.665 (-0.6%)  b=4.696 (0.1%)  c=4.725 (0.7%)  d=4.646 (-1.0%)  g=4.605 (-1.8%)
ultra    head=6.008 (0.0%)  headB=6.027 (0.3%)  a=6.023 (0.3%)  b=6.056 (0.8%)  c=6.019 (0.2%)  d=6.000 (-0.1%)  g=5.905 (-1.7%)

## med: geomean (paired ratio vs head)
all      head=4.500 (0.0%)  headB=4.527 (0.6%)  a=4.531 (0.7%)  b=4.559 (1.3%)  c=4.552 (1.2%)  d=4.501 (0.0%)  g=4.460 (-0.9%)
medium   head=3.509 (0.0%)  headB=3.533 (0.7%)  a=3.567 (1.7%)  b=3.615 (3.0%)  c=3.566 (1.6%)  d=3.596 (2.5%)  g=3.560 (1.5%)
high     head=4.443 (0.0%)  headB=4.463 (0.4%)  a=4.444 (0.0%)  b=4.440 (-0.1%)  c=4.485 (0.9%)  d=4.364 (-1.8%)  g=4.358 (-1.9%)
ultra    head=5.843 (0.0%)  headB=5.885 (0.7%)  a=5.866 (0.4%)  b=5.903 (1.0%)  c=5.898 (0.9%)  d=5.812 (-0.5%)  g=5.720 (-2.1%)

## p95: geomean (paired ratio vs head)
all      head=7.479 (0.0%)  headB=7.501 (0.3%)  a=7.626 (2.0%)  b=7.691 (2.8%)  c=7.562 (1.1%)  d=7.642 (2.2%)  g=7.537 (0.8%)
medium   head=6.099 (0.0%)  headB=6.152 (0.9%)  a=6.492 (6.4%)  b=6.566 (7.7%)  c=6.282 (3.0%)  d=6.331 (3.8%)  g=6.345 (4.0%)
high     head=7.555 (0.0%)  headB=7.574 (0.2%)  a=7.512 (-0.6%)  b=7.589 (0.4%)  c=7.671 (1.5%)  d=7.685 (1.7%)  g=7.554 (-0.0%)
ultra    head=9.078 (0.0%)  headB=9.059 (-0.2%)  a=9.094 (0.2%)  b=9.130 (0.6%)  c=8.974 (-1.1%)  d=9.171 (1.0%)  g=8.932 (-1.6%)

order-corrected fit (perf/ab-posfit.mjs: log t = cell-scenario-round + variant + run position):
# mean
all     a=1.7%  b=3.0%  c=2.3%  d=1.7%  g=0.0%  headB=0.4%  | pos1..: 0.7 1.8 2.2 2.5 3.2 2.9
high    a=-0.5%  b=-0.1%  c=0.3%  d=-1.4%  g=-2.1%  headB=0.0%  | pos1..: 0.4 1.5 -0.3 -0.3 -0.2 -0.3
medium  a=7.5%  b=10.1%  c=6.8%  d=5.8%  g=2.8%  headB=2.4%  | pos1..: 0.5 1.9 5.9 7.4 8.3 7.9
ultra   a=-0.2%  b=0.3%  c=-0.2%  d=-0.1%  g=-1.5%  headB=-0.0%  | pos1..: 0.5 0.3 -0.1 0.2 1.8 1.6
# med
all     a=1.0%  b=1.9%  c=1.9%  d=0.6%  g=-0.6%  headB=0.6%  | pos1..: -0.0 0.6 1.4 1.6 1.9 1.4
high    a=0.3%  b=-0.1%  c=0.5%  d=-2.2%  g=-2.2%  headB=0.7%  | pos1..: -0.3 1.2 0.3 -0.8 -0.6 -1.0
medium  a=4.0%  b=6.1%  c=4.0%  d=3.6%  g=1.4%  headB=1.8%  | pos1..: 0.2 0.9 4.1 5.2 5.5 4.6
ultra   a=-0.1%  b=0.4%  c=0.4%  d=-0.7%  g=-2.1%  headB=0.5%  | pos1..: -0.1 -1.0 -0.8 -0.2 0.4 0.6
# p95
all     a=2.1%  b=3.5%  c=2.1%  d=3.1%  g=1.2%  headB=0.2%  | pos1..: 1.3 2.0 2.6 2.4 4.1 5.1
high    a=-0.6%  b=-0.4%  c=0.4%  d=0.6%  g=-0.7%  headB=0.5%  | pos1..: 2.8 3.3 -0.3 0.3 -0.4 0.5
medium  a=10.9%  b=14.4%  c=9.3%  d=7.7%  g=4.8%  headB=2.7%  | pos1..: -0.9 -0.6 7.4 6.8 10.6 13.0
ultra   a=-0.9%  b=-0.6%  c=-2.0%  d=1.0%  g=-1.2%  headB=-0.9%  | pos1..: 0.5 1.0 -0.8 0.4 3.7 3.2
# fight cpu
all     a=1.2%  b=2.6%  c=1.6%  d=1.5%  g=-0.3%  headB=0.4%  | pos1..: 1.0 1.6 2.5 1.8 3.0 2.6
high    a=-1.9%  b=-1.9%  c=-1.8%  d=-1.3%  g=-2.0%  headB=-1.5%  | pos1..: -1.1 1.0 -3.1 -2.3 -1.6 -1.9
medium  a=7.3%  b=8.6%  c=5.3%  d=3.3%  g=1.8%  headB=4.1%  | pos1..: 4.5 3.8 11.1 8.3 9.9 8.9
ultra   a=-1.4%  b=0.8%  c=-0.6%  d=0.6%  g=-2.1%  headB=-0.3%  | pos1..: -0.9 -1.1 -0.6 0.0 1.5 1.6
```

## s3: medium/high/ultra, head/a/headB/d/g, 5 rounds planned, 07:10-09:10: VOID

Stopped at the 2 h tool limit after 4 of 5 rounds; the laptop went from AC to battery during the run and reached 1 % ("Battery Warning: Final"). headB/head: high -6.7 %, ultra +14.3 % (mean, order-corrected). Not usable.
```
# mean
all     a=-3.4%  d=-1.2%  g=-1.8%  headB=1.7%  | pos1..: -1.2 -0.6 1.0 3.2
high    a=-7.5%  d=-4.6%  g=-4.5%  headB=-6.7%  | pos1..: 0.5 5.7 4.9 5.8
medium  a=-0.7%  d=1.6%  g=1.8%  headB=0.2%  | pos1..: 0.2 -0.2 2.6 3.7
ultra   a=-2.0%  d=-0.9%  g=-3.0%  headB=14.3%  | pos1..: -4.6 -7.9 -4.6 -0.2
# med
all     a=-3.0%  d=-1.3%  g=-2.1%  headB=2.2%  | pos1..: -1.5 -0.7 0.3 2.9
high    a=-7.0%  d=-4.4%  g=-5.0%  headB=-6.1%  | pos1..: 0.4 5.2 4.5 6.1
medium  a=-0.4%  d=1.2%  g=1.4%  headB=0.5%  | pos1..: 0.4 -0.0 1.3 2.8
ultra   a=-1.7%  d=-1.0%  g=-2.9%  headB=14.7%  | pos1..: -5.7 -8.0 -5.2 -0.4
```

# MSI round 2 — printed A/B tables

Keep rule (written before the numbers it governs):

    # MSI round 2 keep rule (written 04:25, before any round-2 number existed)
    Base: HEAD 1384bf1 (game tree = round 1's kept tree: fightCpuPaths on High and Ultra).
    Metric: frame mean, path + fight, per preset, against the POOLED HEAD reference, two ways (perf/ab-pool.mjs, 2 decimals):
      raw    = paired geomean ratio vs head / geomean of the HEAD copies' ratios vs head (the same cells);
      posfit = the ab-posfit fit's variant effect minus the mean of the HEAD copies' effects (head = 0).
    HEAD copies: head, headB on every preset; medfcp also on Low, High and Ultra (fightCpuPaths gives the same value
      there: the same code). Medium's pool = head + headB.
    Noise line N_p = max(2 %, the largest pairwise |difference| among the HEAD copies on preset p, raw or posfit).
    Control clean on p = every HEAD-copy pair within 2.4 % (step 1's range) on p. A preset whose control is not clean
      gives no decision (not a pass).
    PASS on p = raw AND posfit <= -N_p, the control clean on p, every fight state hash equal to head's.
    MSI A/B (msir2a): head, headB, matrix, ops, medfcp; 4 maps x 4 presets x 5 rounds (= the arm count: every variant
      takes every position once per cell), path + fight, --no-trace, under powered-linux.sh. 400 runs (~70 min).
      A second HEAD copy (6 arms, 576 runs, ~90 min) and fence do not fit the 75 min cap: not run.
    Confirmation: a candidate that passes here on a preset where it also read negative (raw and posfit) in round 1
      counts as confirmed on that preset. Round 1 negatives: matrix Low/Medium/High/Ultra (both jobs); ops Medium, High,
      Ultra (job 2; Low read 0.0 / +0.5: a Low pass of ops does not count); medfcp (= cpuhm on Medium) Medium (both jobs).
    MSI winner:
      matrix, ops (no per-preset switch: kept or rejected whole): a confirmed pass on >= 1 preset, AND no preset slower
        than +N_p (raw or posfit) in this A/B.
      medfcp: judged on Medium only (it changes nothing else); a confirmed pass on Medium.
    Mac A/B (macr2): head, headB, win (all MSI winners together; omitted if none), prer1 (HEAD with fightCpuPaths back to
      Ultra only = 5423a85's game tree); rounds = the arm count, the same 4 x 4 matrix, perf/powered.sh, AC, >= 50 %.
      Mac noise line M = max(2 %, |headB vs head| on the preset, raw or posfit); pooled reference head + headB.
      KEEP the MSI winners only if win reads no slower than +M on any preset (raw and posfit both checked; either past
        +M = slower). If win is slower: medfcp changes Medium only, so a Low/High/Ultra slowdown rejects matrix and ops
        (whichever are in win; no budget to split them), a Medium slowdown rejects every winner.
      Round 1's High exception: prer1 is the OLD code. The High change is slower on the Mac if head reads slower than
        prer1 by more than M on High (prer1 vs pool <= -M, raw or posfit). Then REVERT it (fightCpuPaths Ultra only).
        Otherwise the exception is settled: kept.
    Pixels (kept set): Mac quality.mjs compare baseline + msi-r1-keep (the tree before this round), MSI compare
      msi-baseline + msi-r1-keep: PASS, 0 changed px vs msi-r1-keep (or every px explained). Typecheck, vitest on the Mac.

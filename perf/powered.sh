#!/bin/zsh
# usage: perf/powered.sh logfile name command...   Runs a bench or A/B command under a power watchdog: logs
# `pmset -g batt` and `pmset -g therm` before and after into logfile, checks the power every 60 s while the command
# runs and once more after it ends, and marks the run VOID if the machine leaves AC power or the battery drops under
# PERF_MIN_BATT (default 40) %. A failed check during the run stops the command's whole process tree (ab.sh → node
# bench.mjs → chromium ...): TERM to every process at once, which lets ab.sh run its cleanup (src/ tests/ back to
# HEAD, out/ back in place). Whatever is still alive 30 s later (the root, a snapshotted descendant, or a re-parented
# one) gets KILL; KILL skips ab.sh's cleanup, so the log and stderr then get "== name KILLED: recovery needed" with
# the steps to do by hand (not done here). Exit status: the command's, or 3 when voided.
log=$1; name=$2; shift 2
min=${PERF_MIN_BATT:-40}
repo=${0:A:h:h}; work=${AB_WORK:-/tmp/perf-ab}
stamp() { { echo "== $name $1"; date; pmset -g batt; pmset -g therm; } >> $log; }
bad() { local b=$(pmset -g batt) pct; pct=$(echo "$b" | grep -oE '[0-9]+%' | head -1 | tr -d %)
  [[ $b != *"AC Power"* ]] || (( pct < min )); }
desc() { local c; for c in $(pgrep -P $1); do echo $c; desc $c; done; }  # every descendant of $1
alive() { local s=$(ps -o stat= -p $1 2>/dev/null); [[ -n $s && $s != Z* ]]; }  # a zombie counts as gone
living() { local p; for p in $tree; do alive $p && echo $p; done; }
stop() {  # TERM the tree; KILL what is left after 30 s; returns 1 if KILL was needed
  local i left; tree=($pid $(desc $pid))
  echo "== $name TERM $tree" >> $log
  kill -TERM $tree 2>/dev/null
  for i in {1..30}; do
    alive $pid && tree+=($(desc $pid)); tree=(${(u)tree})  # cleanup may start new processes: wait for them too
    left=($(living)); (( $#left )) || return 0
    sleep 1
  done
  alive $pid && tree+=($(desc $pid)); tree=(${(u)tree}); left=($(living)); (( $#left )) || return 0
  echo "== $name KILL $left" >> $log
  kill -KILL $left 2>/dev/null; sleep 1
  left=($(living)); (( $#left )) && echo "== $name still alive after KILL: $left" >> $log
  return 1
}
recovery() {
  local msg="== $name KILLED: recovery needed (ab.sh's cleanup did not run). For an ab.sh run, by hand:
  cd $repo
  [[ -L out ]] && rm out
  git checkout -q HEAD -- src tests && git clean -fdq -- src tests
  if [[ -d $work/out-orig ]]; then [[ -L out ]] || rm -rf out; mv $work/out-orig out; fi
  and delete the cut-short cell's JSON (the newest perf/results/scratch-<tag>-*.json)."
  echo "$msg" >> $log; echo "$msg" >&2
}
stamp start
bad && { echo "== $name VOID before start (not on AC or battery < $min %)" >> $log; exit 3; }
"$@" & pid=$!
voided=0 killed=0
while kill -0 $pid 2>/dev/null; do
  for i in {1..60}; do sleep 1; kill -0 $pid 2>/dev/null || break; done
  if kill -0 $pid 2>/dev/null && bad; then voided=1; echo "== $name VOID at $(date +%T): power" >> $log
    pmset -g batt >> $log
    stop || killed=1
    break; fi
done
wait $pid 2>/dev/null; rc=$?
if (( ! voided )) && bad; then voided=1; echo "== $name VOID at $(date +%T): power at end" >> $log
  pmset -g batt >> $log; fi
(( killed )) && recovery
stamp end
(( voided )) && exit 3
exit $rc

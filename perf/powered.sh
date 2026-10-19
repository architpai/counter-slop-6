#!/bin/zsh
# usage: perf/powered.sh logfile name command...   Runs a bench or A/B command under a power watchdog: logs
# `pmset -g batt` and `pmset -g therm` before and after into logfile, checks the power every 60 s while the command
# runs and once more after it ends, and marks the run VOID if the machine leaves AC power or the battery drops under
# PERF_MIN_BATT (default 40) %; a failed check during the run also stops the command (TERM: ab.sh restores the tree).
# Exit status: the command's, or 3 when voided.
log=$1; name=$2; shift 2
min=${PERF_MIN_BATT:-40}
stamp() { { echo "== $name $1"; date; pmset -g batt; pmset -g therm; } >> $log; }
bad() { local b=$(pmset -g batt) pct; pct=$(echo "$b" | grep -oE '[0-9]+%' | head -1 | tr -d %)
  [[ $b != *"AC Power"* ]] || (( pct < min )); }
stamp start
bad && { echo "== $name VOID before start (not on AC or battery < $min %)" >> $log; exit 3; }
"$@" & pid=$!
voided=0
while kill -0 $pid 2>/dev/null; do
  for i in {1..60}; do sleep 1; kill -0 $pid 2>/dev/null || break; done
  if kill -0 $pid 2>/dev/null && bad; then voided=1; echo "== $name VOID at $(date +%T): power" >> $log
    pmset -g batt >> $log; pkill -TERM -P $pid; kill -TERM $pid; wait $pid; break; fi
done
wait $pid 2>/dev/null; rc=$?
if (( ! voided )) && bad; then voided=1; echo "== $name VOID at $(date +%T): power at end" >> $log
  pmset -g batt >> $log; fi
stamp end
(( voided )) && exit 3
exit $rc

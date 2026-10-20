#!/usr/bin/env bash
# usage: perf/powered-linux.sh logfile name command...   The Linux (MSI) form of perf/powered.sh: runs a bench or A/B
# command under a power watchdog. It logs a full state block before and after, and one sample line every
# PERF_SAMPLE_S (default 60) s while the command runs: AC (/sys/class/power_supply/AC*|ADP*/online), battery
# capacity, status and current, nvidia-smi (P-state, temperature, graphics/SM/memory clocks, power, utilisation, the
# active clock-event (throttle) reasons), the CPU's mean/max frequency, package temperature and the thermal throttle
# events since the last sample (sum of core_throttle_count over the CPUs, package_throttle_count of CPU 0), and the CPU
# and GPU memory of other users' processes on the GPU (the idle llama-server). Void rules: the command does not start
# unless on AC with the battery at >= PERF_START_BATT (default 50) %; it is VOID (stopped) when AC drops or the battery
# falls under PERF_MIN_BATT (default 35) %, checked at every sample and once more at the end. Throttling is logged,
# not voided: read the sample lines. A failed check stops the command's whole process tree as perf/powered.sh does
# (TERM to every process at once, so ab.sh runs its cleanup; KILL to what is left after 30 s, then
# "== name KILLED: recovery needed"). Exit status: the command's, or 3 when voided.
log=$1; name=$2; shift 2
start_min=${PERF_START_BATT:-50}; min=${PERF_MIN_BATT:-35}; every=${PERF_SAMPLE_S:-60}
repo=$(cd "$(dirname "$0")/.." && pwd); work=${AB_WORK:-/tmp/perf-ab}

ac() { local f; for f in /sys/class/power_supply/{AC,ADP}*/online; do [[ -r $f ]] && { cat "$f"; return; }; done; echo '?'; }
bat() { local d; for d in /sys/class/power_supply/BAT*; do [[ -r $d/capacity ]] && { cat "$d/capacity"; return; }; done; echo '?'; }
batinfo() { local d; for d in /sys/class/power_supply/BAT*; do [[ -r $d/capacity ]] && {
  echo "bat=$(cat $d/capacity)% $(cat $d/status 2>/dev/null | tr ' ' _) I=$(( $(cat $d/current_now 2>/dev/null || echo 0) / 1000 ))mA"; return; }; done; echo 'bat=?'; }
GPUQ=pstate,temperature.gpu,clocks.gr,clocks.sm,clocks.mem,power.draw,utilization.gpu,clocks_event_reasons.active
gpuinfo() { command -v nvidia-smi > /dev/null || { echo 'gpu=?'; return; }
  nvidia-smi --query-gpu=$GPUQ --format=csv,noheader,nounits 2>/dev/null | awk -F', ' '{ printf "gpu %s %sC gr=%s sm=%s mem=%s MHz %sW util=%s%% reasons=%s", $1, $2, $3, $4, $5, $6, $7, $8 }'; }
cputhrottle() {  # "core package" event counts; '?' where the counter is not readable
  local c=0 n=0 f p=/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count
  for f in /sys/devices/system/cpu/cpu*/thermal_throttle/core_throttle_count; do [[ -r $f ]] && { c=$(( c + $(cat $f) )); n=1; }; done
  (( n )) || c='?'; echo "$c $([[ -r $p ]] && cat $p || echo '?')"; }
delta() { [[ $1 == '?' || $2 == '?' ]] && echo '?' || echo $(( $1 - $2 )); }
cputemp() { local h; for h in /sys/class/hwmon/hwmon*; do [[ $(cat $h/name 2>/dev/null) == coretemp ]] && { echo $(( $(cat $h/temp1_input) / 1000 )); return; }; done; echo '?'; }
cpufreq() { awk '{ s += $1; if ($1 > m) m = $1; n++ } END { if (n) printf "%d/%d", s / n / 1000, m / 1000; else printf "?" }' \
  /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null; }
others() {  # every other user's process on the GPU: pid, its CPU %, its GPU memory
  command -v nvidia-smi > /dev/null || return
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits 2>/dev/null | while IFS=', ' read -r p m; do
    [[ -n $p && $(ps -o user= -p $p 2>/dev/null) != "$USER" ]] && echo -n " $(ps -o comm= -p $p)[$p] cpu=$(ps -o %cpu= -p $p | tr -d ' ')% gpumem=${m}MiB"
  done; }
prev=($(cputhrottle))
sample() { local t=($(cputhrottle))
  echo "$(date +%T) ac=$(ac) $(batinfo) | $(gpuinfo) | cpu $(cpufreq) MHz pkg=$(cputemp)C throttle core+$(delta ${t[0]} ${prev[0]}) pkg+$(delta ${t[1]} ${prev[1]}) |$(others)"
  prev=("${t[@]}"); }
stamp() { { echo "== $name $1"; date; sample
  nvidia-smi --query-gpu=name,driver_version,pstate,temperature.gpu,clocks.gr,clocks.max.gr,clocks.mem,power.draw,power.limit,clocks_event_reasons.active,clocks_event_reasons.sw_power_cap,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_thermal_slowdown,clocks_event_reasons.hw_slowdown,clocks_event_reasons.hw_power_brake_slowdown --format=csv 2>&1
  echo "governor $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null) epp $(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference 2>/dev/null) no_turbo $(cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null) load $(cut -d' ' -f1-3 /proc/loadavg)"
  ps -eo user,pid,pcpu,comm --sort=-pcpu | head -6; } >> "$log"; }
bad() { local a=$(ac) b=$(bat); [[ $a != 1 || $b == '?' ]] || (( b < $1 )); }
desc() { local c; for c in $(pgrep -P $1); do echo $c; desc $c; done; }  # every descendant of $1
alive() { local s=$(ps -o stat= -p $1 2>/dev/null); [[ -n $s && $s != Z* ]]; }  # a zombie counts as gone
living() { local p; for p in "${tree[@]}"; do alive $p && echo $p; done; }
uniq_tree() { tree=($(printf '%s\n' "${tree[@]}" | awk '!seen[$0]++')); }
stop() {  # TERM the tree; KILL what is left after 30 s; returns 1 if KILL was needed
  local i left; tree=($pid $(desc $pid))
  echo "== $name TERM ${tree[*]}" >> "$log"
  kill -TERM "${tree[@]}" 2>/dev/null
  for i in {1..30}; do
    alive $pid && tree+=($(desc $pid)); uniq_tree  # cleanup may start new processes: wait for them too
    left=($(living)); (( ${#left[@]} )) || return 0
    sleep 1
  done
  alive $pid && tree+=($(desc $pid)); uniq_tree; left=($(living)); (( ${#left[@]} )) || return 0
  echo "== $name KILL ${left[*]}" >> "$log"
  kill -KILL "${left[@]}" 2>/dev/null; sleep 1
  left=($(living)); (( ${#left[@]} )) && echo "== $name still alive after KILL: ${left[*]}" >> "$log"
  return 1
}
recovery() {
  local msg="== $name KILLED: recovery needed (ab.sh's cleanup did not run). For an ab.sh run, by hand:
  cd $repo
  [[ -L out ]] && rm out
  git checkout -q HEAD -- src tests && git clean -fdq -- src tests
  if [[ -d $work/out-orig ]]; then [[ -L out ]] || rm -rf out; mv $work/out-orig out; fi
  and delete the cut-short cell's JSON (the newest perf/results/scratch-<tag>-*.json)."
  echo "$msg" >> "$log"; echo "$msg" >&2
}
mkdir -p "$(dirname "$log")" && touch "$log" 2>/dev/null || { echo "powered-linux.sh: cannot write the log $log" >&2; exit 2; }
stamp start
bad $start_min && { echo "== $name VOID before start (not on AC or battery < $start_min %)" >> "$log"; exit 3; }
"$@" & pid=$!
voided=0 killed=0
while kill -0 $pid 2>/dev/null; do
  for (( i = 0; i < every; i++ )); do sleep 1; kill -0 $pid 2>/dev/null || break; done
  kill -0 $pid 2>/dev/null || break
  sample >> "$log"
  if bad $min; then voided=1; echo "== $name VOID at $(date +%T): power" >> "$log"
    stop || killed=1
    break; fi
done
wait $pid 2>/dev/null; rc=$?
if (( ! voided )) && bad $min; then voided=1; echo "== $name VOID at $(date +%T): power at end" >> "$log"; fi
(( killed )) && recovery
stamp end
(( voided )) && exit 3
exit $rc

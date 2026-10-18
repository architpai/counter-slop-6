#!/bin/zsh
# Per-cell interleaved A/B with balanced positions (perf/README.md "Interleaved A/B"). usage: perf/ab.sh tag presets maps rounds variant...
# variant = a patch on HEAD (`git diff > x.patch`), or a name starting with "head" (HEAD as is; two of them = a
# HEAD/HEAD noise control). It resets src/ and tests/ to HEAD between builds, so it refuses to start with uncommitted
# changes there: save them as a patch first. Builds go to $AB_WORK (/tmp/perf-ab); out/ is a symlink while it runs
# and a fresh HEAD build after. Results: perf/results/scratch-<tag>-<variant>-<map>-<preset>-<round>.json (gitignored).
cd "$(dirname "$0")/.."
work=${AB_WORK:-/tmp/perf-ab}; mkdir -p $work
git diff --quiet -- src tests || { echo "src/ or tests/ has uncommitted changes: save them as a patch first"; exit 1; }
tag=$1; presets=(${(s:,:)2}); maps=(${(s:,:)3}); rounds=$4; shift 4
names=()
[[ -L out ]] && rm out
for v in "$@"; do
  git checkout -q -- src tests
  if [[ $v == head* ]]; then name=$v; else git apply $v || exit 1; name=$(basename $v .patch); fi
  npm run build >/dev/null 2>&1 || exit 1
  rm -rf $work/out-$name; mv out $work/out-$name; names+=$name
done
git checkout -q -- src tests
cell=0
for r in $(seq 1 $rounds); do
  for p in $presets; do for m in $maps; do
    # cyclic Latin rotation over consecutive cells: each variant takes each position equally often
    k=$(( cell % ${#names} )); cell=$((cell + 1))
    order=(${names[$((k+1)),-1]} ${names[1,$k]})
    for n in $order; do
      ln -sfn $work/out-$n out
      node perf/bench.mjs --label scratch-$tag-$n-$m-$p-$r --maps $m --presets $p --no-trace > $work/log-$tag-$n-$m-$p-$r.log 2>&1 || echo "FAIL $n $m $p $r"
      rm out
    done
  done; done
  echo "round $r done"
done
npm run build >/dev/null 2>&1

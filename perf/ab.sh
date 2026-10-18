#!/bin/zsh
# Per-cell interleaved A/B with rotated positions (perf/README.md "Interleaved A/B").
# usage: perf/ab.sh tag presets maps rounds variant...   e.g. perf/ab.sh x1 low,high downtown,house 3 head headB a.patch
# variant = a patch on HEAD (`git diff > x.patch`, src/ and tests/ only), or a name starting with "head" (HEAD as is;
# two of them = a HEAD/HEAD noise control). One variant must be named "head": ab-agg.mjs pairs every variant with it.
# It resets src/ and tests/ to HEAD between builds, so it refuses to start with any change there (staged, unstaged or
# untracked): save it as a patch first. Builds go to $AB_WORK (/tmp/perf-ab); out/ waits in $AB_WORK/out-orig and
# comes back at the end (also on error or ^C). Results: perf/results/scratch-<tag>-<variant>-<map>-<preset>-<round>.json
# and scratch-<tag>-manifest.json (gitignored). Exit 1 if any cell failed (its JSON is removed).
setopt extended_glob
fail() { echo "ab.sh: $*" >&2; exit 1; }
(( $# >= 5 )) || fail "usage: perf/ab.sh tag presets maps rounds variant..."
tag=$1; presets=(${(s:,:)2}); maps=(${(s:,:)3}); rounds=$4; shift 4
[[ $tag == [A-Za-z0-9._-]## ]] || fail "bad tag '$tag'"
[[ $rounds == <1-> ]] || fail "rounds must be a positive integer"
typeset -A patch; names=()
for v in "$@"; do
  if [[ $v == head* ]]; then n=$v
  else [[ -f $v ]] || fail "no patch file $v"; n=${${v:t}%.patch}; patch[$n]=${v:A}
    [[ $n != head* ]] || fail "patch $v: a patch name must not start with 'head'"
  fi
  [[ $n == [A-Za-z0-9._-]## ]] || fail "bad variant name '$n'"
  (( ${names[(Ie)$n]} )) && fail "two variants named '$n'"
  names+=$n
done
(( ${names[(Ie)head]} )) || fail "one variant must be named 'head'"
cd "$(dirname "$0")/.." || fail "no repo"
work=${AB_WORK:-/tmp/perf-ab}; mkdir -p $work || fail "cannot create $work"

[[ -z $(git status --porcelain -- src tests) ]] || fail "src/ or tests/ has changes (staged, unstaged or untracked): save them as a patch first"
[[ -L out ]] && fail "out is a symlink (left by a killed run?): remove it (and move $work/out-orig back to out/ if it is there)"
[[ -e $work/out-orig ]] && fail "$work/out-orig exists (left by a killed run?): move it back to out/ or delete it"
old=(perf/results/scratch-$tag-*(N))
(( $#old )) && fail "results for tag '$tag' exist ($old[1] ...): pick a new tag or delete them"
for n p in ${(kv)patch}; do
  git apply --check $p || fail "patch $p does not apply to HEAD"
  # "added<TAB>deleted<TAB>path" per file; a rename lists only its new path, so the reversed patch gives the old one
  for f in ${(0)"$(git apply --numstat -z $p; git apply -R --numstat -z $p)"}; do
    f=${f##*$'\t'}; [[ -z $f || $f == (src|tests)/* ]] || fail "patch $p touches $f: only src/ and tests/ are allowed"
  done
done

args=(); for n in $names; do args+=($n "${patch[$n]}"); done
node -e '
const [file, tag, head, presets, maps, rounds, ...nv] = process.argv.slice(1), fs = require("node:fs");
const variants = nv.filter((_, i) => i % 2 === 0), patches = {};
for (let i = 0; i < nv.length; i += 2) if (nv[i + 1]) patches[nv[i]] = { path: nv[i + 1],
  sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(nv[i + 1])).digest("hex") };
fs.writeFileSync(file, JSON.stringify({ tag, head, variants, patches, maps: maps.split(","), presets: presets.split(","),
  rounds: +rounds, date: new Date().toISOString() }, null, 1) + "\n");
' perf/results/scratch-$tag-manifest.json $tag $(git rev-parse HEAD) ${(j:,:)presets} ${(j:,:)maps} $rounds "${args[@]}" \
  || fail "cannot write the manifest"

# From here on every exit restores src/ and tests/ to HEAD and puts back the original out/.
to_head() { git checkout -q HEAD -- src tests && git clean -fdq -- src tests; }
cleanup() {
  local rc=$?; trap - EXIT INT TERM
  [[ -n $cur ]] && rm -f $cur  # a cell cut short
  [[ -L out ]] && rm out
  to_head || { echo "ab.sh: could not reset src/ and tests/ to HEAD" >&2; rc=1; }
  rm -rf out  # only ever ours here: a half-made build
  if [[ -d $work/out-orig ]]; then mv $work/out-orig out || { echo "ab.sh: the original out/ is in $work/out-orig" >&2; rc=1; }
  else echo "ab.sh: there was no out/ before: run npm run build"; fi
  exit $rc
}
if [[ -d out ]]; then mv out $work/out-orig || fail "cannot move out/ aside"; fi
cur=; trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM

for n in $names; do
  to_head || fail "cannot reset src/ and tests/ to HEAD"
  if [[ -n ${patch[$n]} ]]; then git apply ${patch[$n]} || fail "cannot apply ${patch[$n]}"; fi
  echo "build $n"
  npm run build > $work/build-$tag-$n.log 2>&1 || fail "build of $n failed: see $work/build-$tag-$n.log"
  rm -rf $work/out-$n && mv out $work/out-$n || fail "cannot move the build of $n to $work"
done
to_head || fail "cannot reset src/ and tests/ to HEAD"

# Cyclic rotation, shifted by map, preset and round: every (map, preset) cell gives each variant each position equally
# often when rounds is a multiple of the variant count (per preset: when rounds or the map count is).
failed=()
for r in {1..$rounds}; do
  for pi in {1..$#presets}; do p=$presets[pi]; for mi in {1..$#maps}; do m=$maps[mi]
    k=$(( (mi + pi + r - 3) % $#names ))
    for n in ${names[k+1,-1]} ${names[1,k]}; do
      label=scratch-$tag-$n-$m-$p-$r; cur=perf/results/$label.json
      ln -s $work/out-$n out || fail "cannot link out to $work/out-$n"
      if ! node perf/bench.mjs --label $label --maps $m --presets $p --no-trace > $work/log-$label.log 2>&1; then
        echo "FAIL $n $m $p $r: see $work/log-$label.log"; failed+=("$n $m $p $r"); rm -f $cur
      fi
      cur=; rm out || fail "cannot remove the out link"
    done
  done; done
  echo "round $r done"
done
(( $#failed )) && fail "${#failed} failed cells (variant map preset round):"$'\n  '${(pj:\n  :)failed}
echo "all cells done: node perf/ab-agg.mjs $tag"

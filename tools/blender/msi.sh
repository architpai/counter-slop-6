#!/usr/bin/env bash
# Run Blender on the MSI build machine instead of this Mac: a drop-in for the local binary.
#
#   BLENDER=tools/blender/msi.sh npm run effects -- decals
#   BLENDER=tools/blender/msi.sh npm run weapons -- pistol
#   tools/blender/msi.sh --background --factory-startup --python tools/blender/effects/decals.py -- --out tools/effects/.build
#
# The MSI (Ubuntu 26.04, RTX 4090 Laptop, NVIDIA driver 595, Blender 5.2.1 LTS like the Mac at
# /usr/local/bin/blender, ssh host `msi` = fleet@100.66.10.79 on Tailscale) bakes on CUDA by default: a CUDA bake
# of the decal atlas matched the Mac's Metal bake exactly. OptiX works with this driver (CYCLES_DEVICE=OPTIX) but
# has not been checked against the Mac's bakes. Each run:
#   1. clears the work tree ~/cs6 and ships tools/blender/ to it, plus the posed hands the guns
#      need (tools/weapons/.build/hands/hands.blend) and anything listed in MSI_INPUTS (repo-relative paths);
#   2. runs Blender there with CYCLES_DEVICE=CUDA, every path into this repository rewritten to the work tree;
#   3. brings the `--out` folder (which must be inside this repository) back over the local one;
#   4. deletes the work tree.
# Blender's exit status is this script's, so the build scripts' checks work unchanged.
# Environment: MSI_HOST (default msi), MSI_ROOT (default /home/fleet/cs6), MSI_BLENDER, MSI_INPUTS, CYCLES_DEVICE.
set -euo pipefail

HOST=${MSI_HOST:-msi}
REMOTE=${MSI_ROOT:-/home/fleet/cs6}
EXE=${MSI_BLENDER:-/usr/local/bin/blender}
DEVICE=${CYCLES_DEVICE:-CUDA}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

# Arguments: repo paths (absolute or relative) become work-tree paths; note the --out folder.
args=() out="" prev=""
for a in "$@"; do
  value=$a
  if [[ "$prev" == "--out" || "$prev" == "--python" ]] && [[ "$value" != /* ]]; then value="$ROOT/$value"; fi
  [[ "$prev" == "--out" ]] && out=$value
  args+=("$(printf '%q' "${value//$ROOT/$REMOTE}")")
  prev=$a
done
if [[ -n "$out" && "$out" != "$ROOT"/* ]]; then echo "msi.sh: --out must be inside $ROOT" >&2; exit 2; fi

inputs=(tools/blender)
[[ -f "$ROOT/tools/weapons/.build/hands/hands.blend" ]] && inputs+=(tools/weapons/.build/hands/hands.blend)
for extra in ${MSI_INPUTS:-}; do inputs+=("$extra"); done

q=$(printf '%q' "$REMOTE")
ssh -o BatchMode=yes "$HOST" "rm -rf $q && mkdir -p $q"
trap 'ssh -o BatchMode=yes "$HOST" "rm -rf $q" || true' EXIT
(cd "$ROOT" && COPYFILE_DISABLE=1 tar -cf - --exclude '__pycache__' --exclude '*.pyc' "${inputs[@]}") | ssh -o BatchMode=yes "$HOST" "tar -xf - -C $q"

status=0
ssh -o BatchMode=yes "$HOST" "CYCLES_DEVICE=$(printf '%q' "$DEVICE") $(printf '%q' "$EXE") ${args[*]}" || status=$?

if [[ -n "$out" ]]; then
  rel=$(printf '%q' "${out#"$ROOT"/}")
  mkdir -p "$out"
  ssh -o BatchMode=yes "$HOST" "if [ -d $q/$rel ]; then tar -cf - -C $q/$rel .; fi" | tar -xf - -C "$out"
fi
exit $status

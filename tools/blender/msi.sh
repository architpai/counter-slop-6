#!/usr/bin/env bash
# Run Blender on the MSI build machine instead of this Mac: a drop-in for the local binary.
#
#   BLENDER=tools/blender/msi.sh npm run effects -- decals
#   BLENDER=tools/blender/msi.sh npm run weapons -- pistol
#   tools/blender/msi.sh --background --factory-startup --python tools/blender/effects/decals.py -- --out tools/effects/.build
#
# The MSI (Windows, RTX 4090 Laptop, Blender 5.2.1 LTS like the Mac, ssh host `msi` = cuiping@100.86.233.83 on
# Tailscale) bakes on CUDA: its NVIDIA driver (552.22) is too old for Blender 5.2's OptiX kernels, which fail to
# compile and bake black (CYCLES_DEVICE=OPTIX once the driver is updated). A CUDA bake of the decal atlas matched
# the Mac's Metal bake exactly. Each run:
#   1. clears the work tree C:/Users/chenc/cs6 and ships tools/blender/ to it, plus the posed hands the guns
#      need (tools/weapons/.build/hands/hands.blend) and anything listed in MSI_INPUTS (repo-relative paths);
#   2. runs Blender there with CYCLES_DEVICE=CUDA, every path into this repository rewritten to the work tree;
#   3. brings the `--out` folder (which must be inside this repository) back over the local one.
# Blender's exit status is this script's, so the build scripts' checks work unchanged.
# Environment: MSI_HOST (default msi), MSI_ROOT (default C:/Users/chenc/cs6), MSI_BLENDER, MSI_INPUTS, CYCLES_DEVICE.
set -euo pipefail

HOST=${MSI_HOST:-msi}
REMOTE=${MSI_ROOT:-C:/Users/chenc/cs6}
EXE=${MSI_BLENDER:-'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'}
DEVICE=${CYCLES_DEVICE:-CUDA}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

# Arguments: repo paths (absolute or relative) become work-tree paths; note the --out folder.
args=() out="" prev=""
for a in "$@"; do
  value=$a
  if [[ "$prev" == "--out" || "$prev" == "--python" ]] && [[ "$value" != /* ]]; then value="$ROOT/$value"; fi
  [[ "$prev" == "--out" ]] && out=$value
  args+=("\"${value//$ROOT/$REMOTE}\"")
  prev=$a
done
if [[ -n "$out" && "$out" != "$ROOT"/* ]]; then echo "msi.sh: --out must be inside $ROOT" >&2; exit 2; fi

inputs=(tools/blender)
[[ -f "$ROOT/tools/weapons/.build/hands/hands.blend" ]] && inputs+=(tools/weapons/.build/hands/hands.blend)
for extra in ${MSI_INPUTS:-}; do inputs+=("$extra"); done

ssh -o BatchMode=yes "$HOST" "powershell -NoProfile -Command \"Remove-Item -Recurse -Force '$REMOTE' -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force '$REMOTE' | Out-Null\""
(cd "$ROOT" && COPYFILE_DISABLE=1 tar -cf - --exclude '__pycache__' --exclude '*.pyc' "${inputs[@]}") | ssh -o BatchMode=yes "$HOST" "tar -xf - -C $REMOTE"

status=0
ssh -o BatchMode=yes "$HOST" "set CYCLES_DEVICE=$DEVICE&& \"$EXE\" ${args[*]}" || status=$?

if [[ -n "$out" ]]; then
  rel=${out#"$ROOT"/}
  mkdir -p "$out"
  ssh -o BatchMode=yes "$HOST" "if exist \"${REMOTE//\//\\}\\${rel//\//\\}\" tar -cf - -C $REMOTE/$rel ." | tar -xf - -C "$out"
fi
exit $status

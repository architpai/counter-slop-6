# MSI step 1 — second benchmark machine: setup, GPU proof, Round 0 → final, bottleneck survey

Date 2026-10-21. Tree: `perf/loop` at `36cc1aa` (the game is `0447e97`'s src/ and tests/, the final tree of the
10-round loop; the harness commit adds the MSI port only). Round 0 = `c7a65d8`'s src/ and tests/ as a reverse patch
(`git diff --binary HEAD c7a65d8 -- src tests`, sha256 `611f70da…`), exactly as `SUMMARY.md` section 6.

## Summary

- **GPU**: headless Chrome 153 (the Mac's build) on the RTX 4090 through ANGLE's GL backend on the NVIDIA EGL driver
  (`--use-gl=angle --use-angle=gl-egl` + the NVIDIA glvnd vendor file); renderer string `ANGLE (NVIDIA Corporation,
  NVIDIA GeForce RTX 4090 Laptop GPU/PCIe/SSE2, OpenGL ES 3.2)`, asserted in every cell; vsync and the frame cap off.
- **Quality**: the MSI repeats byte-identically; Round 0 → final PASS 56/56, SSIM 1.0000; Low, High and Ultra
  byte-identical, Medium 45 px (1-3/255) from Round 4.
- **Round 0 → final** (frame mean, path + fight, 96 pairs): Low -10.3 %, Medium -18.1 %, High -19.8 %, Ultra -20.7 %
  (Mac: -5.4 / -20.4 / -17.8 / -20.4 %); 94/96 pairs faster; controls within ±2.4 %. Ready -7.9 / -21.9 / -21.5 /
  -8.0 %. Programs after ready 4-13 → 0 (the Mac's counts exactly); first-fight compiles on High/Ultra (35-37 ms) → none.
- **Bottleneck**: every fight (all presets) and the training paths are bound by the **renderer main thread** (no GPU
  waits); downtown's realistic paths are bound by Chrome's GPU-process thread (decoder + ANGLE + driver). The 4090
  itself is not the limit in any measured cell. CPU-side work now shows 1:1 in frame time: section 7 ranks the
  retries (cpuhm, matrix, HUD/outside-rAF, low1, clips, …).
- **Caveats**: CPU thermal throttling all the time under load (package 82-98 °C); 0.1 ms timer steps on 0.3-2.7 ms
  frames (use means); GL-EGL path stalls (p99) that ANGLE Vulkan does not have.

## 1. Machine and setup

- **MSI** (`ssh msi`, Tailscale): Ubuntu 26.04 (kernel 7.0.0-38), i9-14900HX (32 threads), 123 GB RAM, RTX 4090 Laptop
  GPU (16 GB, driver 595.91.07, CUDA 13.2) + Intel UHD (RPL-S) iGPU, headless tty (no X/Wayland). Node 22.23.3,
  Playwright 1.63.0, **Chrome Headless Shell 153.0.8010.12 — the same build as the Mac**.
- CPU governor `powersave` (intel_pstate active, EPP `balance_performance`, turbo on), GPU power limit N/A (laptop,
  `nvidia-powerd`). Not changed. AC on (`ADP1/online` = 1); the battery holds at 80 % "Not charging" (charge threshold
  `charge_control_end_threshold` = 80).
- Other load: `llama-server` (user `llama`, idle, 262 MiB on the GPU, 0.2 % CPU at every sample), a `node-MainThread`
  of user fleet (0.2 %), `nvidia-powerd` (1.3 %). Nothing stopped.
- **One scratch folder** `/home/fleet/perf-scratch-shooter`: the repository (git bundle of every ref, cloned,
  `perf/loop` checked out; synced by incremental bundle + `fetch` + `reset --hard`, never by file copy), node_modules
  (`npm ci`), npm cache, Playwright browsers, HOME, TMPDIR, the XDG folders, the NVIDIA and Mesa shader caches, the
  A/B builds (`AB_WORK`), the captures and the logs. All set by `perf/msi-env.sh` (committed).
- **Libraries**: libxcomposite1, libxdamage1 and libxrandr2 were already installed when this step began (`ldconfig
  -p`, `apt-cache policy`); `ldd chrome-headless-shell` reports no missing library, so no `.deb` was unpacked for
  them and no `LD_LIBRARY_PATH` is set. **zsh** (for `ab.sh`) was missing: `apt-get download zsh zsh-common` +
  `dpkg -x` into `$S/sysroot` (no install), on PATH with `MODULE_PATH` from `msi-env.sh`.
- Pre-state: `perf/results/msi-prestate.txt` (listings of ~, ~/.cache, ~/.config, ~/.local/share, /tmp, /dev/shm,
  a depth-4 `find ~` with mtimes, processes, nvidia-smi) taken before anything was copied.

## 2. Chrome on the RTX 4090 (headless) — backend and proof

Probe (`$S/probe.mjs`, not committed): Playwright's headless shell with `--ignore-gpu-blocklist --disable-gpu-vsync
--disable-frame-rate-limit` plus the flags below, a WebGL2 canvas, `UNMASKED_RENDERER_WEBGL`, 4 s of a heavy fragment
loop, then `nvidia-smi`'s process table with the browser still open.

| option | flags / env | WebGL renderer | Chrome GPU process in nvidia-smi |
|---|---|---|---|
| no backend flag | – | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)) …)` (headless forces `--use-angle=swiftshader-webgl`) | none |
| Vulkan | `--use-angle=vulkan --enable-features=Vulkan` (± `--use-vulkan=native`) | no WebGL2 context | none |
| **ANGLE Vulkan** | `--use-angle=vulkan --enable-features=VulkanFromANGLE` | `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce RTX 4090 Laptop GPU (0x00002717)), NVIDIA)` | type C+G, 598 MiB |
| ANGLE desktop GL | `--use-gl=angle --use-angle=gl` (± the three NVIDIA env vars) | SwiftShader (GLX needs a display; falls back) | none |
| ANGLE GL-EGL, glvnd's choice | `--use-gl=angle --use-angle=gl-egl` | `ANGLE (Intel, Mesa Intel(R) Graphics (RPL-S), OpenGL ES 3.2)` — **the iGPU** | none |
| **ANGLE GL-EGL on NVIDIA** | the same + `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json` | `ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4090 Laptop GPU/PCIe/SSE2, OpenGL ES 3.2)` | type G, 100 MiB |

`__NV_PRIME_RENDER_OFFLOAD=1` and `__GLX_VENDOR_LIBRARY_NAME=nvidia` change nothing for EGL (the vendor file alone
gives the same renderer string); they are not set.

**Chosen: ANGLE's GL backend on the NVIDIA EGL driver** (`PERF_GPU_ARGS='--use-gl=angle --use-angle=gl-egl'`, the
vendor file; `perf/msi-env.sh`). Why: Chrome on desktop Linux uses ANGLE's OpenGL backend by default, as far as we
know; in this build's default feature table (full chromium, new headless) `Vulkan: Disabled`, and
`VulkanFromANGLE` is a non-default feature. The desktop default cannot be read here: with no display Chrome's headless
mode always picks SwiftShader. Caveat: desktop Chrome on NVIDIA reports a desktop GL context (`OpenGL 4.5.0 NVIDIA …`,
GLX or EGL on X11/Wayland); here ANGLE runs a GLES 3.2 context on the same NVIDIA driver, a different ANGLE translator
output (ESSL instead of desktop GLSL) and context type. The driver, its compiler and its submission path are the
same. ANGLE Vulkan works too (probe only; no game run, no A/B time spent on it).

**Proof, per cell**: every bench, capture and hitch cell asserts the page's renderer string against
`PERF_GPU_EXPECT='NVIDIA GeForce RTX 4090'` (a mismatch fails the cell; none failed). Every result's `meta.gpu` reads
`ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4090 Laptop GPU/PCIe/SSE2, OpenGL ES 3.2)`. nvidia-smi showed the Chrome
GPU process during the probe (type G, 100 MiB) and during the frame A/B (`msib-mexico`: type C+G, 806 MiB, next to
`llama-server`'s 262 MiB), and the power log shows the 4090 at P0, mostly 2.34 GHz, 45-175 W while the jobs run
(P8, 3 W idle between jobs).

Facts match the Mac: 1920x1080 buffer, DPR 1, fpsTarget 0, dynamic scale 1, MSAA Low 0 / Medium 2 / High 2 / Ultra 4
(the game does not clamp to the 4090's 8), the same shadow intervals, the same fight state hashes (below). **The GPU
timer** (`EXT_disjoint_timer_query_webgl2`) exists here as on Metal but fails the bench's calibration on NVIDIA too
(downtown Ultra: query 1.13 ms over a 0.7 ms frame interval; an extra pass moved the frame by -0.1 ms): `gpu` stays
null. Vsync and the frame-rate limit are off (idle 1430-2000 fps).

## 3. Quality (the MSI's own baseline)

`quality.mjs capture msi-baseline` (the Round 0 build) and `capture msi-final` (the final build), 14 views x 4
presets each, on the NVIDIA GL path. Captures stay in the scratch folder (`$S/repo/perf/shots/msi-*`).

- **Repeat floor first**: `capture msi-final-b` and `compare msi-final msi-final-b`: PASS, 56/56, every SSIM 1.0000,
  **0 changed pixels, all 56 byte-identical** — the NVIDIA path repeats exactly, like Metal, so every changed pixel
  below is the code's.
- **`compare msi-baseline msi-final`: PASS, 56/56, every SSIM 1.0000** (min tile 1.0000). Changed pixels (max channel
  difference per pixel):
  - **Low: 14/14 byte-identical. High: 14/14 byte-identical. Ultra: 14/14 byte-identical.**
  - **Medium: 45 px in 6 of 14 images**, all 1-3/255 (38 by 1, 6 by 2, 1 by 3): fight-mid 21, fight-smoke 11,
    house-overview 6, downtown-fp 3, downtown-overview 2, mexico-overview 2; 8 images identical.
- Against Metal (`SUMMARY.md`: Low identical, 289 px over all 42 realistic images, 1-21 per image): a different and
  smaller set. On Metal the moved pixels come from fast-math reassociation of the edited shader text (Round 1 B1/B3,
  Round 4 `g`); NVIDIA's GLSL compiler, behind ANGLE's ESSL output, compiles those edits to the same results on High and
  Ultra (exact there), so those causes do not reach the screen on this GPU. Medium's 45 px have another cause; the
  bisect is in section 3a.

### 3a. Where Medium's 45 px come from (bisect)

Medium-only captures of the game tree after Round 1 (`221ffb1`), 2 (`82ee6e1`), 4 (`cad1329`) and 6 (`52c96ba`), each
as `git diff HEAD <commit> -- src tests` on the final harness, then changed pixels step by step:

| step | Medium changed pixels |
|---|---|
| Round 0 → Round 1 (`221ffb1`: B1 FX light skip, B3 packed ORM read, …) | **0** (14/14 identical; on Metal this step moved 284 px) |
| Round 1 → Round 2 | 0 |
| **Round 2 → Round 4 (`cad1329`)** | **45 px in the same 6 images, the same counts as baseline → final** |
| Round 4 → Round 6 | 0 |
| Round 6 → final | 0 |

So every Medium pixel comes from Round 4's set, while High/Ultra stay byte-identical through it. Medium differs from
High in AO (off), the shadow tier, the texture size and soft particles, so the Round 4 parts that can reach Medium
alone are "AO alpha only with AO" (Medium is the one realistic tier without AO) and `g` (the N·L shadow-tap skip) on
Medium's shadow filter. The set was not split further: which of the two is open. The pixels are LSB rounding
(1-3/255) of a differently compiled shader, as on Metal; Round 1's B1/B3, which moved Metal's pixels, compile to the
same results on NVIDIA.

## 4. Round 0 → final on the MSI (as Round 10 PART B)

### Frame time

One paired, interleaved, balanced A/B per map (`msib-downtown`, `-house`, `-mexico`, `-training`): variants `head`
(final), `r0` (Round 0 patch), `headB` (HEAD/HEAD control), rounds = variants = 3, path + fight, all 4 presets,
`--no-trace`, every run under `perf/powered-linux.sh` (none void). 6.0-6.5 min per map (the Mac: ~10). Before them a
load-only priming pass (`msiprime`, 1 round, every variant x cell) so the NVIDIA shader disk cache held every arm's
programs: no arm paid a cold driver compile the others did not. `node perf/ab-final.mjs r0 msib-downtown,msib-house,msib-mexico,msib-training`;
change = final / Round 0 - 1 (negative = faster); control = headB / head - 1. Printed tables: `perf/results/msi-s1-ab.md`.

**Path + fight, frame ms (Round 0 → final):**

| preset | n | frame mean | median | p95 | p99 | cpu mean | FINAL faster (mean) | control mean / med / p95 / p99 |
|---|---|---|---|---|---|---|---|---|
| low | 24 | 0.913 → 0.819 (-10.3 %) | 0.841 → 0.755 (-10.2 %) | 1.471 → 1.299 (-11.7 %) | 2.153 → 1.883 (-12.5 %) | 0.632 → 0.582 (-8.0 %) | 22/24 | -2.4 % / +0.1 % / -2.6 % / -0.1 % |
| medium | 24 | 1.481 → 1.213 (-18.1 %) | 1.325 → 1.107 (-16.5 %) | 2.138 → 1.760 (-17.7 %) | 4.377 → 3.145 (-28.2 %) | 1.164 → 0.955 (-18.0 %) | 24/24 | -1.3 % / -2.0 % / -1.5 % / +0.1 % |
| high | 24 | 1.701 → 1.363 (-19.8 %) | 1.449 → 1.194 (-17.6 %) | 2.413 → 1.931 (-20.0 %) | 5.930 → 4.952 (-16.5 %) | 1.374 → 1.102 (-19.8 %) | 24/24 | +0.3 % / +0.7 % / -0.2 % / -3.8 % |
| ultra | 24 | 1.959 → 1.553 (-20.7 %) | 1.525 → 1.226 (-19.6 %) | 2.932 → 2.139 (-27.1 %) | 7.733 → 6.694 (-13.4 %) | 1.610 → 1.272 (-21.0 %) | 24/24 | -0.9 % / -0.5 % / -3.3 % / +0.1 % |
| all | 96 | 1.457 → 1.204 (-17.3 %) | 1.253 → 1.052 (-16.0 %) | 2.172 → 1.753 (-19.3 %) | 4.559 → 3.743 (-17.9 %) | 1.129 → 0.939 (-16.8 %) | 94/96 | -1.1 % / -0.4 % / -1.9 % / -0.9 % |

**Path only / fight only** (frame mean; full rows in `msi-s1-ab.md`):

| preset | path | fight | path control | fight control |
|---|---|---|---|---|
| low | 0.452 → 0.414 (-8.4 %), 10/12 | 1.843 → 1.619 (-12.1 %), 12/12 | -1.8 % | -3.0 % |
| medium | 0.862 → 0.726 (-15.7 %), 12/12 | 2.545 → 2.026 (-20.4 %), 12/12 | -0.4 % | -2.1 % |
| high | 1.052 → 0.876 (-16.7 %), 12/12 | 2.750 → 2.121 (-22.9 %), 12/12 | -0.2 % | +0.9 % |
| ultra | 1.341 → 1.104 (-17.7 %), 12/12 | 2.861 → 2.184 (-23.6 %), 12/12 | -1.4 % | -0.5 % |
| all | 0.861 → 0.735 (-14.7 %), 46/48 | 2.465 → 1.974 (-19.9 %), 48/48 | -0.9 % | -1.2 % |

**Per map** (frame mean, path + fight, final vs Round 0; control headB/head; `ab-posfit` gives Round 0 / final - 1
and equals the raw ratio: every run is exactly balanced):

| map | low | medium | high | ultra | all (posfit, Round 0 slower by) | control (low / medium / high / ultra) |
|---|---|---|---|---|---|---|
| downtown | -4.9 % | -15.5 % | -13.0 % | -16.6 % | +14.5 % | **-5.7** / +0.5 / -0.8 / -0.8 % |
| house | -6.5 % | -13.7 % | -14.9 % | -14.6 % | +14.3 % | **-7.2** / +0.5 / +0.8 / +0.0 % |
| mexico | -10.1 % | -13.0 % | -14.2 % | -15.7 % | +15.3 % | **+5.8** / +0.4 / +0.6 / +1.1 % |
| training | -19.0 % | -29.1 % | -35.0 % | -34.2 % | +42.0 % | -2.0 / **-6.3** / +0.7 / **-4.0** % |

**Counts** are exactly the Mac's (draw calls Low 82 / 213.75, Medium 145.5 → 142.5 / 245.5 → 226.5, High 199.5 /
319 → 305, Ultra 230.5 / 366.5 → 346.5 path / fight; programs at the bench +1 to +3), and **every fight's state hash
equals the Mac's** (downtown: Low `311b4571`, Medium/High/Ultra `cdfcdf4`, in all three arms; 12/12 per preset equal
across arms): the same simulation and the same draw list on both machines.

**Against the Mac** (`SUMMARY.md` section 1, same protocol, frame mean path + fight):

| preset | Mac M4 Pro (Metal) | MSI 4090 (NVIDIA GL) | Mac median / p95 / p99 | MSI median / p95 / p99 |
|---|---|---|---|---|
| low | 1.658 → 1.568 (-5.4 %), 24/24 | 0.913 → 0.819 (**-10.3 %**), 22/24 | -3.9 / -4.6 / -5.8 % | -10.2 / -11.7 / -12.5 % |
| medium | 2.971 → 2.365 (-20.4 %), 24/24 | 1.481 → 1.213 (**-18.1 %**), 24/24 | -18.4 / -15.2 / -11.6 % | -16.5 / -17.7 / -28.2 % |
| high | 3.608 → 2.965 (-17.8 %), 24/24 | 1.701 → 1.363 (**-19.8 %**), 24/24 | -14.3 / -13.6 / -10.8 % | -17.6 / -20.0 / -16.5 % |
| ultra | 4.655 → 3.704 (-20.4 %), 24/24 | 1.959 → 1.553 (**-20.7 %**), 24/24 | -21.1 / -15.8 / -15.5 % | -19.6 / -27.1 / -13.4 % |
| all | 3.016 → 2.526 (-16.2 %), 96/96 | 1.457 → 1.204 (**-17.3 %**), 94/96 | -14.7 / -12.4 / -11.0 % | -16.0 / -19.3 / -17.9 % |

The loop's gains carry over: the same size on Medium/High/Ultra (-18 to -21 %), twice the size on Low, on a machine
that runs every frame 2-2.4x faster. The shape differs: on the Mac the fight and path gains were similar; here the
fight gains more (-20 to -24 % vs -16 to -18 % on realistic presets) and training (the most figure-heavy map: the
dummies plus the roster) gains most (-29 to -35 %), which fits a CPU-bound frame (section 6): Round 2's shared
materials and ray pre-reject and Round 1's CPU parts cut the main thread, and here the main thread is the frame.

### Load (Round 0 → final)

Load-only A/B `msil` (`AB_ARGS=--load-only`, 4 presets x 4 maps x 3 balanced rounds, head / r0 / headB, one cold
load in a fresh browser per run, NVIDIA shader cache warm for every arm after `msiprime`; `node perf/ab-load.mjs msil`,
`node perf/ab-load-count.mjs msil`). Geomean of the paired cell-round values, shown as final / Round 0 - 1 (ab-load
prints Round 0 / final: ready +8.6 / +28.0 / +27.4 / +8.7 %, first playable +7.3 / +4.6 / +8.8 / +6.9 %).

| | low | medium | high | ultra |
|---|---|---|---|---|
| **ready** ms, Round 0 → final | 595 → 548 (**-7.9 %**) | 6933 → 5416 (**-21.9 %**, -1.52 s) | 7083 → 5558 (**-21.5 %**, -1.53 s) | 8837 → 8134 (**-8.0 %**, -0.70 s) |
| first playable ms, Round 0 → final | 569 → 530 (-6.8 %) | 704 → 673 (-4.4 %) | 736 → 677 (-8.1 %) | 779 → 729 (-6.5 %) |
| Round 0 faster in (ready / first playable, of 12) | 1 / 1 | 0 / 2 | 0 / 0 | 0 / 0 |
| control headB/head - 1 (ready / first playable) | -1.8 / -2.3 % | -0.3 / -1.6 % | +0.6 / +0.5 % | -0.2 / -0.6 % |
| load window: median per-load max frame, ms | 50.1 → 30.2 | 92.7 → 70.4 | 175.6 → 107.2 | 176.8 → 108.3 |
| mean frames > 33 / > 50 ms per load | 0.9 / 0.5 → 0.3 / 0.3 | 4.8 / 3.3 → 4.5 / 2.4 | 6.1 / 3.8 → 6.1 / 2.6 | 7.0 / 4.2 → 6.5 / 3.8 |

Mac (`SUMMARY.md`): ready -20.8 / -23.9 / -21.0 / -4.5 %, first playable -18 to -20 %. Medium/High match; Ultra gains
a little more here (-8.0 vs -4.5 %); **Low and first playable gain much less** because Round 10's audio change is a
Mac effect: on the Mac Round 0's first match frame held a ~100 ms `new AudioContext()` (the match started 105 ms later
on Round 0); here Round 0's match starts only **36 ms** later (median `matchMs` difference, all loads; Low +26 ms). The
other phase deltas have the Mac's shape: bake end +600 ms on Round 0 (the layout worker, Round 7), textures +0.97 s,
weapons +1.30 s, operators +1.54 s, props/streaming +1.66 s later (upload packing, Rounds 8/9; Round 6's trims); the
median ready difference over all 48 loads is +874 ms.

### Hitches (Round 0 → final)

Both with the **NVIDIA shader disk cache disabled** (`__GL_SHADER_DISK_CACHE=0`; Chrome's own program cache is per
profile, and every launch gets a fresh one): every compile is a cold driver compile.

**Programs linked after ready** (`hitch.mjs sweep`, the content the bench never touches, one fresh browser per cell):
**exactly the Mac's counts.** Final tree: `--check zero` **PASS, 0 in all 16 cells**. Round 0:

| programs created after ready, Round 0 → final | low | medium | high | ultra |
|---|---|---|---|---|
| downtown | 8 → 0 | 9 → 0 | 11 → 0 | 11 → 0 |
| house | 8 → 0 | 9 → 0 | 11 → 0 | 13 → 0 |
| mexico | 6 → 0 | 7 → 0 | 9 → 0 | 9 → 0 |
| training | 4 → 0 | 5 → 0 | 7 → 0 | 7 → 0 |

Programs at ready, Round 0 → final: Low 20-22 → 22-24, Medium 49-52 → 52-55, High 51-54 → 54-57, Ultra 53-56 → 56-59.

**First-fight hitch** (`hitch.mjs measure`, every map x preset, one cold load per cell and build, alternating, the
first 120 stepped frames). Max frame ms, Round 0 → final:

| | low | medium | high | ultra |
|---|---|---|---|---|
| downtown | 12.9 → 11.7 | 8.8 → 12.8 | **35.2 → 8.3** | **35.6 → 12.2** |
| house | 12.8 → 11.8 | 9.0 → 13.4 | **34.7 → 13.5** | **36.2 → 12.8** |
| mexico | 11.4 → 11.6 | 11.3 → 9.6 | **35.6 → 13.5** | **35.5 → 8.0** |
| training | 13.8 → 16.2 | 18.5 → 17.4 | **37.3 → 8.9** | **36.9 → 17.7** |
| programs linked in the fight | 0 → 0 | 0 → 0 | 2 → 0 | 2 → 0 |

On Round 0 every High/Ultra cell links the soft smoke at fight frame 21 (callback 35-47 ms, a cold NVIDIA compile) and
the soft fire at frame 25-85 (21-28 ms); the final tree links none, and its worst first-fight frame is 8-18 ms. Mac
(Round 10): High 34.6-37.3 → 9.8-11.2, Ultra 55.0-70.5 → 10.8-11.8 ms; the NVIDIA compile is about half Metal's on
Ultra. Low/Medium move by ±4 ms with no compile in either build (one load per cell: noise). Single loads: the frame
sizes are single readings; the program counts are exact.

## 5. Noise, power and throttling

- **Controls** (headB/head, preset aggregates of 24 pairs): frame mean -2.4 / -1.3 / +0.3 / -0.9 % (Low / Medium /
  High / Ultra), within ~2.4 % everywhere; per map, Low reads ±5.7-7.2 % (downtown -5.7, house -7.2, mexico +5.8),
  training Medium -6.3 % and Ultra -4.0 %. **Read preset aggregates, not per-map cells**, and treat paired changes
  under ~3 % (Low: ~6 %) as unproven on this machine. Load controls ≤ 2.3 %.
- **Timer quantisation**: `performance.now()` is 0.1 ms-coarse (not cross-origin isolated) and the frames are 0.3-2.7
  ms, so medians move in 0.1 ms steps (downtown paths read 0.5 / 0.6 ms in every arm). Judge on frame **mean** and
  p95; on paths a 0.1 ms median step is up to 20-30 %.
- **Path stalls on the GL-EGL backend**: on downtown, house and mexico (realistic presets) ~1 % of path frames take
  9-18 ms (p99) with ~35 ms maxima; the main thread waits on the GPU command buffer in those frames (rAF wall p99
  19.4 ms vs rAF CPU p99 0.96 ms, waits 0.08-0.47 ms per frame on average). Training (no sky) has none. A backend
  check (`downtown`, High + Ultra, path, GL / Vulkan / GL / Vulkan): **ANGLE Vulkan has the same mean** (High 0.81 /
  0.82 vs 0.79 / 0.80 ms, Ultra 1.12 / 1.13 vs 1.12 / 1.12 ms) **but no stalls** (p99 2.9-5.6 vs 8.9-18.0 ms, max 6-11 vs
  35-36 ms). So the stalls belong to the GL-EGL presentation/driver path, not to the game: p99 on paths here is a
  backend artifact; means are unaffected. (The game does no GPU readback; its only sync is the pacing fence polled with
  `getSyncParameter`.)
- **Power**: AC the whole time, battery 80 % (held by the charge threshold; `current_now` 0 mA, never discharging),
  no job void. `perf/results/msi-s1-power.log` has every sample.
- **CPU thermal throttling is constant under load**: package 82-98 °C during the timed jobs, 3,000-36,000 core
  thermal-throttle events per job (~2,000-3,600 per minute; idle: 0), CPU mean frequency 0.8-2.7 GHz at the
  samples (the max core 1.4-5.5 GHz). The governor is `powersave` with EPP `balance_performance` (not changed). The
  paired interleaving shares this between arms (the controls above are the result); unpaired runs on this machine
  are not comparable.
- **GPU**: P0, graphics clock 0.7-2.34 GHz (mostly 2.34) while busy, 45-175 W, 57-66 °C, never a thermal slowdown
  reason; **SW power cap** (`clocks_event_reasons` 0x4) in 12 of the 81 samples of the timed jobs. Utilisation snapshots (one per
  minute, mixed load and run phases) 7-100 %.
- **Other load**: `llama-server` 0.2-0.3 % CPU and 262 MiB GPU at every sample (logged at every job start and
  minute); the T3 server (`t3 serve`) of user fleet ~0.2 %.

## 6. Bottleneck survey (final tree)

Traced bench `msi-survey` (downtown + training, all presets, path + fight, 900 frames, one run; the trace digest of
`lib.mjs traced`) and profile `msi-profile` (the same cells: CPU ms per sub-step, per-pass ablation). Both committed
(`perf/results/msi-survey.json`, `msi-profile.json`). Reference: the Mac's last traced full run `r9-pre` (`e1af377`:
the final tree minus Round 9's quiet-start and Round 10's audio changes, neither of which runs in the bench window).
Columns: `frame` = clean run's frame mean; `js` = thread CPU of the game's rAF callbacks (traced replay); `wait` = the
main thread's waits on the GPU command buffer per frame; `main` = the renderer main thread's CPU per frame (js +
everything outside rAF); `gpuProc` = Chrome's GPU process main thread CPU per frame (command decoding, ANGLE, the
NVIDIA driver's submission); the two ratios are against the clean frame (a traced replay runs slower, so ~1.0-1.2
means "that thread is the frame").

| map | preset | scen | frame mean | cpu (rAF wall) | js (rAF CPU) | wait/frame | renderer main CPU | GPU-proc main CPU | viz | outside-rAF CPU | main/frame | gpuProc/frame | ref frame | ref js | ref main | ref gpuProc | ref wait |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| downtown | low | path | 0.30 | 0.20 | 0.24 | 0.00 | 0.34 | 0.14 | 0.05 | 0.10 | 1.15 | 0.48 | 1.33 | 0.25 | 0.32 | 0.19 | 1.08 |
| downtown | low | fight | 1.19 | 0.72 | 0.82 | 0.00 | 1.40 | 0.58 | 0.12 | 0.57 | 1.17 | 0.49 | 1.52 | 0.87 | 1.33 | 0.60 | 0.23 |
| downtown | medium | path | 0.64 | 0.52 | 0.41 | 0.08 | 0.53 | 0.61 | 0.43 | 0.13 | 0.84 | 0.97 | 2.05 | 0.83 | 1.05 | 0.80 | 1.23 |
| downtown | medium | fight | 1.68 | 1.13 | 1.24 | 0.00 | 1.71 | 0.82 | 0.12 | 0.47 | 1.02 | 0.49 | 2.60 | 1.63 | 2.34 | 1.29 | 0.06 |
| downtown | high | path | 0.83 | 0.71 | 0.51 | 0.19 | 0.61 | 0.81 | 0.56 | 0.10 | 0.74 | 0.98 | 2.53 | 0.62 | 0.76 | 0.69 | 1.63 |
| downtown | high | fight | 1.91 | 1.30 | 1.42 | 0.00 | 1.89 | 0.94 | 0.14 | 0.47 | 0.99 | 0.49 | 3.06 | 2.06 | 2.67 | 1.56 | 0.34 |
| downtown | ultra | path | 1.12 | 0.99 | 0.54 | 0.44 | 0.64 | 1.09 | 0.59 | 0.10 | 0.57 | 0.98 | 3.37 | 0.75 | 0.93 | 0.87 | 2.26 |
| downtown | ultra | fight | 1.81 | 1.34 | 1.50 | 0.00 | 1.96 | 0.97 | 0.13 | 0.46 | 1.09 | 0.54 | 4.71 | 2.72 | 3.49 | 2.19 | 0.48 |
| training | low | path | 0.85 | 0.74 | 0.83 | 0.00 | 0.93 | 0.32 | 0.08 | 0.10 | 1.09 | 0.37 | 1.53 | 0.80 | 0.90 | 0.42 | 0.60 |
| training | low | fight | 2.28 | 1.62 | 1.76 | 0.00 | 2.31 | 0.95 | 0.13 | 0.55 | 1.01 | 0.42 | 2.34 | 1.67 | 2.21 | 1.24 | 0.00 |
| training | medium | path | 1.07 | 0.95 | 1.08 | 0.00 | 1.17 | 0.49 | 0.09 | 0.09 | 1.09 | 0.45 | 2.76 | 1.24 | 1.37 | 0.73 | 1.00 |
| training | medium | fight | 2.36 | 1.80 | 2.01 | 0.00 | 2.50 | 1.00 | 0.14 | 0.49 | 1.06 | 0.43 | 3.82 | 3.55 | 4.22 | 2.22 | 0.00 |
| training | high | path | 1.12 | 1.01 | 1.16 | 0.00 | 1.24 | 0.55 | 0.12 | 0.08 | 1.11 | 0.49 | 2.98 | 2.03 | 2.22 | 1.22 | 0.50 |
| training | high | fight | 2.69 | 2.01 | 2.10 | 0.00 | 2.68 | 1.11 | 0.14 | 0.57 | 1.00 | 0.41 | 4.78 | 4.04 | 4.73 | 2.55 | 0.00 |
| training | ultra | path | 1.09 | 0.98 | 1.15 | 0.00 | 1.25 | 0.62 | 0.10 | 0.09 | 1.14 | 0.57 | 3.55 | 1.89 | 2.06 | 1.22 | 1.33 |
| training | ultra | fight | 2.56 | 1.97 | 2.07 | 0.00 | 2.60 | 1.10 | 0.14 | 0.54 | 1.02 | 0.43 | 5.13 | 4.11 | 4.95 | 2.79 | 0.00 |


(`ref` = Mac `r9-pre`, same cell.)

**Verdict per scenario, on the 4090:**

- **Every fight, every preset: CPU-bound on the renderer main thread.** `main/frame` 0.99-1.17, `wait` 0.00: the main
  thread never waits for the GPU side; the GPU process runs at 0.41-0.54 of the frame. The per-pass ablation finds no
  GPU pass whose removal shortens a fight frame (all deltas within the ablation noise, 0.1-0.7 ms). JS in the rAF
  callback is 0.82-2.10 ms of a 1.19-2.69 ms frame; the rest of the main thread (outside rAF) is 0.46-0.57 ms.
- **Training paths (dummies in view), every preset: main-thread-bound** as well (`main/frame` 1.09-1.14, `wait` 0).
- **Downtown paths, Medium/High/Ultra: bound by the GPU process thread**, not by the GPU and not by JS: `gpuProc/frame`
  0.97-0.98, `wait` 0.08-0.44 ms, the main thread at 0.57-0.84 of the frame, the display compositor busy (viz
  0.43-0.59 ms per frame vs 0.1 elsewhere). The frame there (0.6-1.1 ms) is Chrome's command decoder + ANGLE + the
  NVIDIA driver submitting ~140-230 draws plus the post chain, plus the GL-EGL stalls of section 5 in the mean
  (Vulkan has the same mean, so the cost is per frame, not only the stalls).
- **Downtown Low path**: main thread (0.34 ms CPU for a 0.30 ms frame): JS 0.24 ms, presentation small.
- Against the Mac: the Mac's realistic paths wait on the GPU (`wait` 0.5-2.3 ms per frame: GPU-bound) and its fights
  are mostly main-bound with small waits; the MSI's JS is ~1.8x faster per frame (downtown Ultra fight js 2.72 → 1.50
  ms) and its GPU leaves no waits in any fight. On the MSI **every ms of main-thread CPU saved in a fight is a ms of
  frame**, which the Mac could not show past its GPU-bound noise.

**Top main-thread costs per preset** (`msi-profile`, fight, ms per frame, wall; render.main includes render.shadows;
outside-rAF from `msi-survey`):

| preset (fight) | frame.cpu | render.main (of it shadows) | render.pre | render.post | enemies.update | player.update | effects.update | other(step) | outside rAF (top: RunTask / UpdateLayoutTree / Layerize / Layout) |
|---|---|---|---|---|---|---|---|---|---|
| low, downtown / training | 0.75 / 1.57 | 0.49 (0.07) / 1.09 (0.18) | 0.01 / 0.01 | 0.01 / 0.01 | 0.09 / 0.21 | 0.08 / 0.09 | 0.03 / 0.02 | 0.03 / 0.14 | 0.57 / 0.55 (0.23 / 0.14 / 0.04 / 0.03; training 0.20 / 0.11 / 0.05 / 0.05) |
| medium | 1.13 / 1.84 | 0.67 (0.14) / 1.12 (0.32) | 0.11 / 0.14 | 0.05 / 0.05 | 0.12 / 0.23 | 0.09 / 0.09 | 0.05 / 0.05 | 0.03 / 0.15 | 0.47 / 0.49 (0.17 / 0.10 / 0.04 / 0.03) |
| high | 1.34 / 2.17 | 0.85 (0.23) / 1.38 (0.51) | 0.11 / 0.15 | 0.07 / 0.07 | 0.12 / 0.25 | 0.09 / 0.09 | 0.06 / 0.05 | 0.03 / 0.16 | 0.47 / 0.57 (0.18-0.22 / 0.10-0.13 / 0.04-0.05 / 0.03-0.05) |
| ultra | 1.40 / 1.95 | 0.90 (0.25) / 1.20 (0.39) | 0.11 / 0.15 | 0.07 / 0.07 | 0.12 / 0.23 | 0.09 / 0.10 | 0.06 / 0.05 | 0.03 / 0.15 | 0.46 / 0.54 (0.19-0.20 / 0.11-0.12 / 0.04-0.05 / 0.03-0.05) |

So per fight frame: three's render of the main pass (scene walk, culling, uniforms, ~190-370 draw submissions through
WebGL) ~0.4-0.9 ms, the shadow pass 0.07-0.51 ms (most on High/Ultra training: cascades x casters), the browser work
outside rAF ~0.5 ms (task overhead, one style recalc per frame of ~6.5-7.7 elements, layout, layerize, prepaint: the HUD), enemy update
0.12-0.25 ms, render.pre 0.11-0.15 ms on the realistic tiers. GC is ~0.01 ms per frame (6-11 minor GCs, 0-1 major per
900 frames, 4-10 ms total).

## 7. Candidates for step 2 (CPU side; ranked)

On the MSI a fight frame is main-thread time, the controls are ~1-2.4 % per preset, so a change of ~0.03-0.05 ms per
fight frame (2-3 %) can be measured here; on the Mac most of these sat under GPU-bound noise. Retry list from
`LOG.md` *Tried / rejected*, then new leads:

1. **cpuhm (walk + D on Medium/High)** — retry. Mac: Ultra fight js -4.9 % (kept on Ultra), Medium/High three A/Bs
   under the 2 % / 4.5 % lines with the GPU-bound frame. Here Medium/High fights are main-bound and render.shadows is
   0.14-0.51 ms: the shadow-walk pruning targets exactly that. Same code as Ultra (exact). Note LOG says "do not try it
   again" for the Mac; the MSI is new evidence, the parent decides.
2. **matrix (skip three's second world-matrix walk)** — retry. Mac: js -1.7 % (Low) / -2.9 % (Ultra), ~1,050 matrix
   products per training frame, not past Mac noise. Pure main-thread work in render.main; training fights 1.1-1.4 ms.
3. **HUD / outside-rAF work (hud2 + new)** — retry hud2 and look further. Outside rAF is ~0.5 ms per fight frame here
   (20-50 % of the frame; Mac 0.77 of 4.7 ms). hud2 cut FunctionCall 15.5 → 7.1 per frame on the Mac (~0.02 ms, ~1 %
   here: borderline); the larger pool is `UpdateLayoutTree` (0.10-0.14 ms) and the per-frame task overhead
   (`ThreadControllerImpl::RunTask` 0.17-0.23 ms self). New: find which HUD writes restyle each fight frame (hit
   markers, kill feed, damage numbers) and move them to compositor-only properties or batch them.
4. **low1 (one shadow draw per flat Low figure)** — retry on Low. Mac: training calls -33/-39 per frame, js -1.5 / -3.1
   % (training), no frame gain on a presentation-bound Low. Here Low fights are main-bound (training 2.28 ms) and
   every draw costs main-thread and GPU-process CPU.
5. **clips (bone-indexed animation tracks)** — retry. enemies.update is 0.12-0.25 ms per fight frame; Mac Ultra -1.3 /
   -2.2 % robust. Exact (bit-equal bones test exists).
6. **C1 (allocation-free A*, boolean rays) and C2 (effect pooling)** — C1 worth one A/B on training (enemies.update
   0.21-0.25 ms there); C2 low priority (GC ~0.01 ms/frame, so only its instance-upload trim could matter).
7. **New: render.pre 0.11-0.15 ms on every realistic fight** (0.01 on Low): profile what runs there (effects buffers,
   sorting, light selection) — a pure CPU lead nobody measured on the Mac.
8. **fence (GPU fences only while streaming)** — retry, low cost: one main-thread task per frame fewer, and per-frame
   task overhead is visible here. Also check that the pacing fence poll is not part of the GL-EGL path stalls.
9. **opaque canvas** — retry on the downtown realistic paths only: they are bound by the GPU process and the display
   compositor (viz 0.43-0.59 ms per frame); an opaque canvas cut viz CPU on the Mac's downtown. No effect expected
   in fights.
10. **dr (view-model depthRange once per run)** — ~20 GL calls per frame; small (≤ 1 %); only if cheap.
11. **Ultra upload slot budget (`r8-packu.patch`)** — a load candidate, not CPU: Ultra ready gains least here too
    (-8.0 %; textures end at 6.7 s of 8.1 s), and the 4090 takes uploads in ~1 ms frames, so a larger budget may
    cut more here than the Mac's -1.8 %. A pacing choice: needs the user's consent.

Not worth retrying here (GPU-side, and the 4090 is not the limit in any fight): A8/dsd (depth invalidate), b-bones,
GTAO/blur trims, B4-B6 shader skips, D16/R32F shadow formats, shadow atlas, deinterleaved GTAO. Also not:
`e-low2` (Low shadow double-buffer: a GPU hazard fix).

**Method notes for step 2**: measure fights (and training) with paired `ab.sh` + the HEAD/HEAD control, frame
**mean** (medians are 0.1 ms-quantised), 3+ balanced rounds; use traced `js` (AB_TRACE=1) for CPU-only changes; do
not judge path p99 on GL-EGL (backend stalls; use `PERF_GPU_ARGS='--use-angle=vulkan --enable-features=VulkanFromANGLE'`
for p99 work, it has the same means); keep every run under `perf/powered-linux.sh`.

## 8. MSI hygiene

- Everything this step made is in `/home/fleet/perf-scratch-shooter` (2.6 GB: repo + node_modules 1.3 GB,
  Playwright 658 MB, builds 181 MB, A/B builds 273 MB, npm cache 127 MB, bundle 106 MB, zsh sysroot 22 MB, NVIDIA
  shader cache 16 MB, captures in `repo/perf/shots/msi-*`, logs). **Kept** for steps 2-3; the final step deletes it.
- Check against `msi-prestate.txt`: the only new entry in `~` is `perf-scratch-shooter`. Nothing new in
  `~/.cache` (no `ms-playwright`, no `nvidia` change: `~/.cache/nvidia/GLCache` is from 2026-10-20 17:26), `~/.npm`,
  `~/.nv`, `~/.pki`, `~/.config`, `~/.local/share`, `/tmp` (no `playwright*`, no `.org.chromium*`) or `/dev/shm`.
  Files outside the scratch folder that changed during the step belong to services already running on the MSI, not to
  this step: the T3 server (`~/.t3/caches`, `~/.t3/userdata/logs`), Claude/Codex plugin syncs (`~/.claude/*`,
  `~/.claude.json`, `~/.codex/plugins/*`), `~/.local/state/claude/locks`, `/tmp/claude-1000`. Nothing was removed
  because nothing of ours was there.
- No `apt install`, no `sudo`, no service, governor, power-profile or system-setting change; `llama-server` and the
  other processes untouched. No process of this step is left running.

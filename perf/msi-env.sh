# Source on the MSI (bash or zsh) before any perf/ command: `source perf/msi-env.sh` from the repository copy in the
# scratch folder (README "Other machines"). Every write of the harness, npm, Playwright, Chrome and the GPU drivers
# stays in $S, the one scratch folder: HOME, TMPDIR and the XDG folders point into it.
export S=${PERF_SCRATCH:-/home/fleet/perf-scratch-shooter}
export HOME=$S/home TMPDIR=$S/tmp TMP=$S/tmp TEMP=$S/tmp
export XDG_CACHE_HOME=$S/xdg/cache XDG_CONFIG_HOME=$S/xdg/config XDG_DATA_HOME=$S/xdg/data
export npm_config_cache=$S/npm-cache npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
export PLAYWRIGHT_BROWSERS_PATH=$S/pw-browsers NEXT_TELEMETRY_DISABLED=1 AB_WORK=$S/ab-work
# The NVIDIA driver's shader disk cache (GL and Vulkan) and Mesa's: in the scratch folder. hitch.mjs runs set
# __GL_SHADER_DISK_CACHE=0 for cold compiles.
export __GL_SHADER_DISK_CACHE_PATH=$S/nv-cache MESA_SHADER_CACHE_DIR=$S/mesa-cache
# zsh for ab.sh, unpacked from the Ubuntu package into $S/sysroot (apt-get download + dpkg -x, no install).
export PATH=$S/sysroot/usr/bin:$PATH MODULE_PATH=$S/sysroot/usr/lib/x86_64-linux-gnu/zsh/5.9
# Chrome on the RTX 4090: ANGLE's GL backend on the NVIDIA EGL driver (headless, no display). Without the vendor file
# glvnd picks Mesa and the same flags land on the Intel iGPU; PERF_GPU_EXPECT fails every cell that is not the 4090.
export PERF_GPU_ARGS='--use-gl=angle --use-angle=gl-egl'
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json
export PERF_GPU_EXPECT='NVIDIA GeForce RTX 4090'
mkdir -p $S/home $S/tmp $S/xdg/cache $S/xdg/config $S/xdg/data $S/npm-cache $S/pw-browsers $S/nv-cache $S/mesa-cache $S/ab-work

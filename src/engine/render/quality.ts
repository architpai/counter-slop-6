/**
 * Graphics quality: the presets, the saved choice, device detection, the menu
 * benchmark, the dynamic-resolution controller and the frame limiter.
 *
 * Pure logic. Nothing here touches three, and the only DOM reads are in
 * `probeDevice`, so the unit tests drive everything else with plain numbers.
 * `Renderer.applyQuality` turns the resolved values into renderer state, and
 * `boot` owns the single `Quality` instance and feeds it frame times.
 */

export const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
export type PresetName = (typeof PRESETS)[number];
/** What the player picked. `auto` resolves to a detected preset; `custom` to their own values. */
export type PresetChoice = 'auto' | PresetName | 'custom';
/** The two looks: Low's flat low-poly one, and the HDR pipeline (docs/VISUALS.md, R). */
export type Look = 'lowpoly' | 'realistic';
export type Antialias = 'off' | 'fxaa' | 'smaa' | 'msaa2' | 'msaa4' | 'msaa2smaa' | 'msaa4smaa';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';
/** Screen-space GTAO at half or full resolution. */
export type AmbientOcclusion = 'off' | 'half' | 'full';
export type EffectsDetail = 'reduced' | 'full';
export type ViewDistance = 'normal' | 'long';
/** Texture sets at 512, 1024 or 2048 texels (render/surfaces.ts `TEXTURE_SIZE`). */
export type TextureQuality = 'low' | 'medium' | 'high';
/** Frames per second. 0 means uncapped. */
export type FpsTarget = 0 | 30 | 60 | 90 | 120;

/** Every value a preset sets. `custom` stores one of these. */
export interface GfxValues {
  look: Look;
  /** Fraction of the canvas resolution the scene renders at, 0.5–1. */
  renderScale: number;
  /** Device-pixel-ratio cap for the canvas. */
  pixelRatio: number;
  dynamicRes: boolean;
  /** The lowest fraction of `renderScale` dynamic resolution may drop to. */
  dynamicMin: number;
  fpsTarget: FpsTarget;
  antialias: Antialias;
  shadows: ShadowQuality;
  ao: AmbientOcclusion;
  bloom: boolean;
  /** Texture set size on the realistic look (render/surfaces.ts `TEXTURE_SIZE`); the flat look has none. */
  textures: TextureQuality;
  effects: EffectsDetail;
  viewDistance: ViewDistance;
}

export const ANTIALIAS: readonly Antialias[] = ['off', 'fxaa', 'smaa', 'msaa2', 'msaa4', 'msaa2smaa', 'msaa4smaa'];
export const SHADOWS: readonly ShadowQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];
export const AMBIENT_OCCLUSION: readonly AmbientOcclusion[] = ['off', 'half', 'full'];
export const EFFECTS: readonly EffectsDetail[] = ['reduced', 'full'];
export const VIEW_DISTANCES: readonly ViewDistance[] = ['normal', 'long'];
export const FPS_TARGETS: readonly FpsTarget[] = [30, 60, 90, 120, 0];
export const TEXTURE_QUALITIES: readonly TextureQuality[] = ['low', 'medium', 'high'];
const LOOKS: readonly Look[] = ['lowpoly', 'realistic'];
const PIXEL_RATIOS: readonly number[] = [1, 1.5, 2];

/** MSAA samples on the scene target, and the post-process anti-aliasing, for each setting. */
export const ANTIALIAS_SPEC: Readonly<Record<Antialias, { samples: number; fxaa: boolean; smaa: boolean }>> = {
  off: { samples: 0, fxaa: false, smaa: false },
  fxaa: { samples: 0, fxaa: true, smaa: false },
  smaa: { samples: 0, fxaa: false, smaa: true },
  msaa2: { samples: 2, fxaa: false, smaa: false },
  msaa4: { samples: 4, fxaa: false, smaa: false },
  msaa2smaa: { samples: 2, fxaa: false, smaa: true },
  msaa4smaa: { samples: 4, fxaa: false, smaa: true },
};
/** GTAO resolution as a share of the scene target. */
export const AO_SCALE: Readonly<Record<AmbientOcclusion, number>> = { off: 0, half: 0.5, full: 1 };

/** One shadow map's box: half-width in metres, and how far ahead of the eye (flattened) its centre sits. */
export interface ShadowBox {
  extent: number;
  ahead: number;
}
/**
 * Shadow map size, filter, update rate and boxes for each shadow setting.
 *
 * Low keeps the phase-1 box: 2048 (the plan's table said 1024, but over the
 * 70 m follow box 1024 doubles the texel and turns near shadows into blocks),
 * centred on the eye, every other frame; `boxes` null means that box.
 * Medium is one box pushed ahead of the eye, so a grunt 60 m ahead and 30 m to
 * the side is still inside it; its 4.4 cm texels need the soft (bilinear)
 * filter, which costs no more than PCF, or near shadow edges step. High and Ultra are cascades (render/shadows.ts):
 * a sharp box near the eye inside wider ones, all fixed in size so they do not
 * swim. Each box is `size`² texels; Ultra's three 2048 maps cost less memory
 * than one 4096 and put 0.8 cm texels at the player's feet.
 */
export const SHADOW_SPEC: Readonly<Record<ShadowQuality,
  { size: number; soft: boolean; every: number; boxes: readonly ShadowBox[] | null } | null>> = {
  off: null,
  low: { size: 2048, soft: false, every: 2, boxes: null },
  medium: { size: 2048, soft: true, every: 1, boxes: [{ extent: 45, ahead: 28 }] },
  high: { size: 2048, soft: true, every: 1, boxes: [{ extent: 14, ahead: 8 }, { extent: 45, ahead: 28 }] },
  ultra: { size: 2048, soft: true, every: 1, boxes: [{ extent: 8, ahead: 4 }, { extent: 22, ahead: 12 }, { extent: 60, ahead: 36 }] },
};
/**
 * Scales the camera far plane and the map's fog range. There is no "short":
 * the far plane already clears every map, so pulling the fog in would only
 * hide enemies without saving any work.
 */
export const VIEW_SCALE: Readonly<Record<ViewDistance, number>> = { normal: 1, long: 1.3 };
/** Share of cosmetic particles that spawn. Tracers are never thinned. */
export const EFFECTS_SCALE: Readonly<Record<EffectsDetail, number>> = { reduced: 0.5, full: 1 };

/** docs/VISUALS.md, "Quality system (Q)": only the rows that exist today. */
export const PRESET_VALUES: Readonly<Record<PresetName, Readonly<GfxValues>>> = Object.freeze({
  low: Object.freeze({ look: 'lowpoly', renderScale: 0.75, pixelRatio: 1.5, dynamicRes: true, dynamicMin: 0.6,
    fpsTarget: 0, antialias: 'fxaa', shadows: 'low', ao: 'off', bloom: false, textures: 'low', effects: 'reduced', viewDistance: 'normal' }),
  medium: Object.freeze({ look: 'realistic', renderScale: 1, pixelRatio: 1.5, dynamicRes: true, dynamicMin: 0.7,
    fpsTarget: 0, antialias: 'msaa2smaa', shadows: 'medium', ao: 'off', bloom: true, textures: 'low', effects: 'full', viewDistance: 'normal' }),
  high: Object.freeze({ look: 'realistic', renderScale: 1, pixelRatio: 2, dynamicRes: true, dynamicMin: 0.7,
    fpsTarget: 0, antialias: 'msaa2smaa', shadows: 'high', ao: 'half', bloom: true, textures: 'medium', effects: 'full', viewDistance: 'normal' }),
  ultra: Object.freeze({ look: 'realistic', renderScale: 1, pixelRatio: 2, dynamicRes: false, dynamicMin: 0.8,
    fpsTarget: 0, antialias: 'msaa4smaa', shadows: 'ultra', ao: 'full', bloom: true, textures: 'high', effects: 'full', viewDistance: 'long' }),
});

// ------------------------------------------------------------------ storage

export const GFX_KEY = 'cs6_gfx';
export const GFX_VERSION = 1;

/** The auto result, cached so detection and the benchmark run once per device. */
export interface AutoResult {
  preset: PresetName;
  /** The menu benchmark has run for this device. */
  benched: boolean;
  /** Which device the result belongs to; a different GPU or core count re-detects. */
  device: string;
}

/** The whole `cs6_gfx` record. */
export interface GfxStore {
  v: typeof GFX_VERSION;
  preset: PresetChoice;
  custom: GfxValues | null;
  fpsCounter: boolean;
  auto: AutoResult | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? value as T : fallback;
export const isPreset = (value: unknown): value is PresetName => PRESETS.includes(value as PresetName);
const inRange = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
/** Snap to 1/20ths; dividing keeps 0.6 exactly 0.6 instead of 0.6000000000000001. */
const twentieths = (value: number): number => Math.round(value * 20) / 20;

export function defaultStore(): GfxStore {
  return { v: GFX_VERSION, preset: 'auto', custom: null, fpsCounter: false, auto: null };
}

/** Field by field: a bad field falls back to `base`, a good one survives. */
export function validValues(raw: unknown, base: Readonly<GfxValues>): GfxValues {
  const value = isRecord(raw) ? raw : {};
  return {
    look: oneOf(LOOKS, value.look, base.look),
    renderScale: twentieths(inRange(value.renderScale, 0.5, 1, base.renderScale)),
    pixelRatio: oneOf(PIXEL_RATIOS, value.pixelRatio, base.pixelRatio),
    dynamicRes: typeof value.dynamicRes === 'boolean' ? value.dynamicRes : base.dynamicRes,
    dynamicMin: twentieths(inRange(value.dynamicMin, 0.5, 1, base.dynamicMin)),
    fpsTarget: oneOf(FPS_TARGETS, value.fpsTarget, base.fpsTarget),
    antialias: oneOf(ANTIALIAS, value.antialias, base.antialias),
    shadows: oneOf(SHADOWS, value.shadows, base.shadows),
    ao: oneOf(AMBIENT_OCCLUSION, value.ao, base.ao),
    bloom: typeof value.bloom === 'boolean' ? value.bloom : base.bloom,
    textures: oneOf(TEXTURE_QUALITIES, value.textures, base.textures),
    effects: oneOf(EFFECTS, value.effects, base.effects),
    viewDistance: oneOf(VIEW_DISTANCES, value.viewDistance, base.viewDistance),
  };
}

/**
 * Parse the stored record. Anything unreadable, or written by another version,
 * falls back to Auto: a stale layout must never brick the renderer.
 */
export function parseStore(text: string | null): GfxStore {
  const store = defaultStore();
  if (!text) return store;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return store; }
  if (!isRecord(raw) || raw.v !== GFX_VERSION) return store;
  const preset = raw.preset === 'auto' || raw.preset === 'custom' || isPreset(raw.preset) ? raw.preset : 'auto';
  const auto = isRecord(raw.auto) && isPreset(raw.auto.preset) && typeof raw.auto.device === 'string'
    ? { preset: raw.auto.preset, benched: raw.auto.benched === true, device: raw.auto.device } : null;
  const custom = isRecord(raw.custom) ? validValues(raw.custom, PRESET_VALUES[auto?.preset ?? 'high']) : null;
  return { v: GFX_VERSION, preset: preset === 'custom' && custom === null ? 'auto' : preset,
    custom, fpsCounter: raw.fpsCounter === true, auto };
}

// ------------------------------------------------------------------- detect

/** What detection reads from the browser. Every field can be missing on some browser. */
export interface DeviceInfo {
  mobile: boolean;
  /** `navigator.deviceMemory` in GB; Safari and Firefox hide it. */
  memory: number | null;
  cores: number | null;
  /** Unmasked GPU renderer string, or '' when the browser hides it. */
  gpu: string;
  maxTextureSize: number;
}

export type GpuClass = 'software' | 'mobile' | 'integrated' | 'apple' | 'appleHigh' | 'discrete' | 'unknown';

/** Sort a renderer string into a coarse class. Order matters: the first match wins. */
export function gpuClass(gpu: string): GpuClass {
  const name = gpu.toLowerCase();
  if (!name) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(name)) return 'software';
  if (/mali|adreno|powervr|videocore|tegra|apple a\d|sgx/.test(name)) return 'mobile';
  if (/apple m\d+ (pro|max|ultra)/.test(name)) return 'appleHigh';
  if (/apple (m\d+|gpu)/.test(name)) return 'apple';
  if (/nvidia|geforce|quadro|rtx|radeon (rx|pro|r9|vii)|radeon\(tm\) (rx|pro)|intel.*arc|arc\(tm\)/.test(name)
    && !/geforce mx|\bmx\d{3}/.test(name)) return 'discrete';
  // Entry-level GeForce MX parts perform like integrated graphics.
  if (/intel|iris|uhd|hd graphics|radeon|vega|amd|geforce mx|\bmx\d{3}/.test(name)) return 'integrated';
  return 'unknown';
}

const lower = (preset: PresetName): PresetName => PRESETS[Math.max(0, PRESETS.indexOf(preset) - 1)] ?? 'low';
const atMost = (preset: PresetName, cap: PresetName): PresetName =>
  PRESETS.indexOf(preset) > PRESETS.indexOf(cap) ? cap : preset;

/** The start preset for a device, before the benchmark gets a say. */
export function detectPreset(info: DeviceInfo): PresetName {
  const kind = gpuClass(info.gpu), cores = info.cores ?? 4;
  let preset: PresetName;
  // Phones and tablets keep the flat look; nothing detection can read tells a
  // flagship from a mid-range phone reliably, so Medium is theirs to pick.
  if (kind === 'software' || info.maxTextureSize < 8192 || info.mobile || kind === 'mobile') return 'low';
  if (kind === 'discrete' || kind === 'appleHigh') preset = cores >= 8 ? 'ultra' : 'high';
  else if (kind === 'apple') preset = 'high';
  else if (kind === 'integrated') preset = 'medium';
  else preset = cores >= 8 ? 'high' : cores >= 4 ? 'medium' : 'low';
  if (info.memory !== null && info.memory <= 2) return 'low';
  if (info.memory !== null && info.memory <= 4) preset = atMost(preset, 'medium');
  return preset;
}

/** Identifies a device for the cached auto result. */
export function deviceKey(info: DeviceInfo): string {
  return [info.mobile ? 'm' : 'd', info.gpu, info.cores ?? '?', info.memory ?? '?', info.maxTextureSize].join('|');
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** Read the device facts. Every probe is optional, so a locked-down browser still gets a preset. */
export function probeDevice(gl: GL | null, win: Window, touch: boolean): DeviceInfo {
  const nav = win.navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  let gpu = '', maxTextureSize = 4096;
  if (gl) {
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || maxTextureSize;
    } catch { /* A lost or restricted context: detection falls back to cores and memory. */ }
  }
  const mobile = touch || nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
  return {
    mobile, gpu, maxTextureSize,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
  };
}

// ------------------------------------------------------------ the settings

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/**
 * The player's graphics choice, persisted in one versioned `cs6_gfx` record.
 * Listeners run after every change; the renderer and HUD subscribe.
 */
export class Quality {
  #store: GfxStore;
  #storage: Storage | null;
  #device: DeviceInfo;
  #listeners = new Set<() => void>();

  constructor(storage: Storage | null, device: DeviceInfo) {
    this.#storage = storage;
    this.#device = device;
    let text: string | null = null;
    try { text = storage?.getItem(GFX_KEY) ?? null; } catch { /* Storage can be unavailable. */ }
    this.#store = parseStore(text);
    const key = deviceKey(device);
    if (this.#store.auto?.device !== key) {
      this.#store.auto = { preset: detectPreset(device), benched: false, device: key };
      this.#save();
    }
  }

  /** What the player picked. */
  get choice(): PresetChoice { return this.#store.preset; }
  /** The preset Auto resolves to on this device. */
  get autoPreset(): PresetName { return this.#store.auto?.preset ?? detectPreset(this.#device); }
  /** The preset in force: Auto resolved, or `custom`. */
  get preset(): PresetName | 'custom' { return this.#store.preset === 'auto' ? this.autoPreset : this.#store.preset; }
  get values(): Readonly<GfxValues> {
    const preset = this.preset;
    return preset === 'custom' ? this.#store.custom ?? PRESET_VALUES[this.autoPreset] : PRESET_VALUES[preset];
  }
  get fpsCounter(): boolean { return this.#store.fpsCounter; }
  /** Auto is chosen and this device has not had its benchmark yet. */
  get needsBenchmark(): boolean { return this.#store.preset === 'auto' && this.#store.auto?.benched !== true; }
  get device(): Readonly<DeviceInfo> { return this.#device; }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  setPreset(choice: PresetChoice): void {
    if (choice === 'custom') this.#store.custom = { ...this.values };
    else if (choice !== 'auto' && !isPreset(choice)) return;
    this.#store.preset = choice;
    this.#changed();
  }

  /** Change one value. Leaves any preset for Custom, starting from the values in force. */
  set<K extends keyof GfxValues>(key: K, value: GfxValues[K]): void {
    // Validated like stored data: an out-of-range value snaps or falls back to the current one.
    this.#store.custom = validValues({ ...this.values, [key]: value }, this.values);
    this.#store.preset = 'custom';
    this.#changed();
  }

  setFpsCounter(on: boolean): void {
    this.#store.fpsCounter = on;
    this.#changed();
  }

  /** Back to Auto. Keeps the detection result and the FPS counter preference. */
  reset(): void {
    this.#store.preset = 'auto';
    this.#store.custom = null;
    this.#changed();
  }

  /** The menu benchmark finished. A miss steps Auto down one preset, once. */
  benchmarkDone(missed: boolean): void {
    const auto = this.#store.auto;
    if (!auto || auto.benched) return;
    this.#store.auto = { ...auto, preset: missed ? lower(auto.preset) : auto.preset, benched: true };
    this.#changed();
  }

  /** The preset one step below the one in force, or null when there is none to offer. */
  get lowerPreset(): PresetName | null {
    const preset = this.preset;
    return preset === 'custom' || preset === 'low' ? null : lower(preset);
  }

  /** The player accepted the "Lower quality?" prompt. Auto stays Auto, one step down. */
  acceptLower(): void {
    const target = this.lowerPreset;
    if (target === null) return;
    if (this.#store.preset === 'auto' && this.#store.auto) this.#store.auto = { ...this.#store.auto, preset: target };
    else this.#store.preset = target;
    this.#changed();
  }

  #changed(): void {
    this.#save();
    for (const listener of [...this.#listeners]) listener();
  }

  #save(): void {
    try { this.#storage?.setItem(GFX_KEY, JSON.stringify(this.#store)); } catch { /* Private mode: keep it in memory. */ }
  }
}

// -------------------------------------------------------- frame-time tools

/** Frames longer than this are tab switches or hitches, not load. */
const OUTLIER_MS = 250;
/** Frames in the cap test's median: enough to outvote a few hitches, few enough to follow a load change. */
const MEDIAN_FRAMES = 15;

/**
 * Holds a frame-time target by moving a resolution scale between `min` and 1.
 *
 * An exponential moving average of the frame time drives it. Missing the target
 * by 15 % steps down after a short cooldown; staying within 5 % for a while
 * steps back up. An up-step that misses again doubles the wait before the next
 * one, so a machine that sits on the edge does not oscillate.
 *
 * The frame time is the rAF interval, which also carries caps that no
 * resolution can beat: a 60 Hz display under a 120 target, a browser holding
 * rAF at 30 in power-saving mode. So the floor is a test. If sitting there has
 * not bought at least 10 % over the frame time at full scale, the interval is
 * a cap, not load: the controller takes it as the target, goes back to full
 * resolution and never counts it towards the "Lower quality?" offer. Faster
 * frames later lower that learned cap again. Both sides of that test are
 * medians of the last few frames, so one hitch (a shader compile, a model
 * load) cannot fake load or hide a cap.
 */
export class DynamicResolution {
  scale = 1;
  min = 0.7;
  targetMs = 1000 / 60;
  ema: number | null = null;
  /** Seconds spent at the floor while still missing the target. */
  floorTime = 0;
  /** A frame-time cap found at the floor (see above); 0 while there is none. */
  capMs = 0;
  #cooldown = 0;
  #good = 0;
  #upWait = 2;
  #sinceUp = Infinity;
  /**
   * The highest median since the scale left 1, to judge what the floor
   * bought. Load that keeps growing after the first step down raises it.
   */
  #fullMs = 0;
  #atMin = 0;
  /** The last `MEDIAN_FRAMES` frame times, a ring; preallocated so a frame allocates nothing. */
  readonly #recent = new Float32Array(MEDIAN_FRAMES);
  readonly #sorted = new Float32Array(MEDIAN_FRAMES);
  #frames = 0;

  configure(min: number, targetMs: number): void {
    this.min = Math.min(1, Math.max(0.3, min));
    this.targetMs = targetMs;
    this.reset();
  }

  reset(): void {
    this.scale = 1;
    this.ema = null;
    this.floorTime = this.capMs = this.#cooldown = this.#good = this.#fullMs = this.#atMin = this.#frames = 0;
    this.#upWait = 2;
    this.#sinceUp = Infinity;
  }

  /** Sat at the floor, still missing, for about ten seconds. */
  get atFloor(): boolean { return this.floorTime >= 10; }

  /** Feed one rendered frame's duration. Returns the scale to use next. */
  update(frameMs: number): number {
    if (!(frameMs > 0) || frameMs > OUTLIER_MS) return this.scale;
    const dt = frameMs / 1000;
    this.ema = this.ema === null ? frameMs : this.ema + (frameMs - this.ema) * 0.1;
    this.#recent[this.#frames++ % MEDIAN_FRAMES] = frameMs;
    // 0 until the ring has filled once: a median of two or three frames is no better than one frame.
    const median = this.#frames >= MEDIAN_FRAMES ? this.#median() : 0;
    if (this.capMs > 0 && this.ema < this.capMs) this.capMs = this.ema > this.targetMs * 1.05 ? this.ema : 0;
    const target = Math.max(this.targetMs, this.capMs);
    if (this.scale < 1) this.#fullMs = Math.max(this.#fullMs, median);
    this.#cooldown -= dt;
    this.#sinceUp += dt;
    const over = this.ema > target * 1.15, onTarget = this.ema < target * 1.05;
    if (over) {
      this.#good = 0;
      // Leaving full scale also waits for the median to miss, so it is a full-scale reference.
      if (this.#cooldown <= 0 && this.scale > this.min && (this.scale < 1 || median > target * 1.15)) {
        if (this.#sinceUp < 3) this.#upWait = Math.min(16, this.#upWait * 2);
        if (this.scale === 1) this.#fullMs = median;
        this.scale = Math.max(this.min, round2(this.scale - (this.ema > target * 1.5 ? 0.1 : 0.05)));
        this.#cooldown = 0.5;
        this.#sinceUp = Infinity;
      }
    } else if (onTarget) {
      this.#good += dt;
      if (this.#good >= this.#upWait && this.#cooldown <= 0 && this.scale < 1) {
        this.scale = Math.min(1, round2(this.scale + 0.05));
        this.#good = 0;
        this.#cooldown = 1;
        this.#sinceUp = 0;
      }
    }
    const floored = this.scale <= this.min + 1e-6;
    this.#atMin = floored && over ? this.#atMin + dt : 0;
    // Two seconds at the floor lets the average settle before judging it.
    if (this.#atMin >= 2 && this.#fullMs > 0 && median > this.#fullMs * 0.9) {
      this.capMs = median;
      this.scale = 1;
      this.floorTime = this.#atMin = this.#good = 0;
      this.#cooldown = 1;
      return this.scale;
    }
    if (!floored) this.floorTime = 0;
    else if (over) this.floorTime += dt;
    else this.floorTime = Math.max(0, this.floorTime - dt);
    return this.scale;
  }

  /** Median of the full ring. A typed array sorts numerically, in place. */
  #median(): number {
    this.#sorted.set(this.#recent);
    return this.#sorted.sort()[MEDIAN_FRAMES >> 1] ?? 0;
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Skips animation frames to hold a frame-rate cap. 0 disables it. */
export class FrameLimiter {
  fps = 0;
  #next = 0;

  /** True when the frame at `nowMs` should run. */
  ready(nowMs: number): boolean {
    if (this.fps <= 0) return true;
    const interval = 1000 / this.fps;
    // A millisecond of slack absorbs rAF jitter, so a 60 cap on a 60 Hz display never drops a frame.
    if (nowMs + 1 < this.#next) return false;
    this.#next += interval;
    if (this.#next < nowMs) this.#next = nowMs + interval;
    return true;
  }
}

/**
 * The menu-backdrop benchmark: skip a warm-up (shader compiles, texture
 * uploads), then collect about two seconds of frame times. A miss is only a
 * miss if resolution is the cause: the run then draws a second, shorter
 * sample at `PROBE_SCALE`, and a frame time that does not drop with the pixel
 * count is a refresh cap or a CPU limit, which a lower preset would not fix.
 * "Drops" means by `GPU_BOUND`: on the realistic look the shadow maps, SMAA
 * and the final passes do not shrink with the scale, so a GPU-bound frame at
 * half the pixels only falls to about 0.75 of full, while a cap or a CPU
 * limit stays at 1 within noise.
 */
export class Benchmark {
  #elapsed = 0;
  #samples: number[] = [];
  /** The full-scale median once it missed; null while measuring full scale. */
  #fullMs: number | null = null;
  constructor(readonly targetMs = 1000 / 60, readonly warmup = 0.6, readonly duration = 2) {}

  /** The resolution scale the renderer should draw at for the current sample. */
  get scale(): number { return this.#fullMs === null ? 1 : PROBE_SCALE; }

  /** Feed one frame. Null while running, then whether the device missed the target. */
  add(frameMs: number): boolean | null {
    if (!(frameMs > 0) || frameMs > OUTLIER_MS) return null;
    this.#elapsed += frameMs / 1000;
    // The probe is half as long, with a short settle after the target resize.
    const warmup = this.#fullMs === null ? this.warmup : 0.3, duration = this.#fullMs === null ? this.duration : this.duration / 2;
    if (this.#elapsed <= warmup) return null;
    this.#samples.push(frameMs);
    if (this.#elapsed < warmup + duration) return null;
    const ms = median(this.#samples);
    if (this.#fullMs !== null) return ms < this.#fullMs * GPU_BOUND;
    if (ms <= this.targetMs * 1.2) return false;
    this.#fullMs = ms;
    this.#elapsed = 0;
    this.#samples.length = 0;
    return null;
  }

  reset(): void {
    this.#elapsed = 0;
    this.#samples.length = 0;
    this.#fullMs = null;
  }
}

/** Half the pixels of full scale. */
const PROBE_SCALE = 0.7;
/** The probe's share of the full-scale frame time below which the miss is the GPU's (see `Benchmark`). */
const GPU_BOUND = 0.9;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The frame-time the dynamic resolution holds for a cap; uncapped aims for 60. */
export const targetFrameMs = (fps: FpsTarget): number => 1000 / (fps > 0 ? fps : 60);

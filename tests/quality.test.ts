import { expect, test } from 'vitest';
import * as THREE from 'three';
import {
  Benchmark, DynamicResolution, FrameLimiter, GFX_KEY, GFX_VERSION, PRESETS, PRESET_VALUES, Quality,
  deviceKey, detectPreset, gpuClass, parseStore, targetFrameMs, validValues,
} from '@/engine/render/quality';
import type { DeviceInfo } from '@/engine/render/quality';
import { shakeNoise } from '@/engine/player/camera';
import { Effects } from '@/engine/effects';
import { World } from '@/engine/physics';

const desktop = (gpu: string, cores = 8, memory: number | null = 8): DeviceInfo =>
  ({ mobile: false, gpu, cores, memory, maxTextureSize: 16384 });
const phone = (gpu: string, cores = 8, memory: number | null = 4): DeviceInfo =>
  ({ mobile: true, gpu, cores, memory, maxTextureSize: 8192 });

/** In-memory stand-in for localStorage. */
class Memory {
  items = new Map<string, string>();
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
}

const rtx = desktop('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 16);

test('presets follow the plan table for the rows that exist today', () => {
  expect(PRESETS).toEqual(['low', 'medium', 'high', 'ultra']);
  expect(PRESET_VALUES.low).toMatchObject({ look: 'lowpoly', renderScale: 0.75, pixelRatio: 1.5, dynamicRes: true, dynamicMin: 0.6,
    antialias: 'fxaa', shadows: 'low', effects: 'reduced' });
  // The table has no FPS or view-distance row: no preset caps the frame rate or pulls the fog in.
  for (const name of PRESETS) expect(PRESET_VALUES[name].fpsTarget).toBe(0);
  for (const name of ['low', 'medium', 'high'] as const) expect(PRESET_VALUES[name].viewDistance).toBe('normal');
  expect(PRESET_VALUES.medium).toMatchObject({ look: 'realistic', renderScale: 1, pixelRatio: 1.5, dynamicRes: true, dynamicMin: 0.7,
    antialias: 'msaa2', shadows: 'medium' });
  expect(PRESET_VALUES.high).toMatchObject({ look: 'realistic', pixelRatio: 2, dynamicRes: true, dynamicMin: 0.8, antialias: 'msaa4', shadows: 'high' });
  expect(PRESET_VALUES.ultra).toMatchObject({ look: 'realistic', pixelRatio: 2, dynamicRes: false, shadows: 'ultra', viewDistance: 'long' });
  // Every preset is valid data: validating it against anything changes nothing.
  for (const name of PRESETS) expect(validValues(PRESET_VALUES[name], PRESET_VALUES.low)).toEqual(PRESET_VALUES[name]);
});

test('stored values are validated field by field', () => {
  const base = PRESET_VALUES.high;
  expect(validValues(null, base)).toEqual(base);
  const mixed = validValues({ renderScale: 0.72, shadows: 'extreme', fpsTarget: 90, antialias: 'fxaa', dynamicMin: 0.1, look: 'toon' }, base);
  expect(mixed.renderScale).toBeCloseTo(0.7);
  expect(mixed.shadows).toBe(base.shadows);
  expect(mixed.fpsTarget).toBe(90);
  expect(mixed.antialias).toBe('fxaa');
  expect(mixed.dynamicMin).toBe(0.5);
  expect(mixed.look).toBe(base.look);
  expect(validValues({ renderScale: Number.NaN, pixelRatio: 3, fpsTarget: 45, viewDistance: 'short' }, base))
    .toMatchObject({ renderScale: base.renderScale, pixelRatio: base.pixelRatio, fpsTarget: base.fpsTarget, viewDistance: base.viewDistance });
});

test('the stored record is versioned and falls back to Auto', () => {
  const fallback = { v: GFX_VERSION, preset: 'auto', custom: null, fpsCounter: false, auto: null };
  expect(parseStore(null)).toEqual(fallback);
  expect(parseStore('{not json')).toEqual(fallback);
  expect(parseStore(JSON.stringify({ v: 0, preset: 'low' }))).toEqual(fallback);
  expect(parseStore(JSON.stringify({ v: GFX_VERSION + 1, preset: 'low' }))).toEqual(fallback);
  expect(parseStore(JSON.stringify([1, 2]))).toEqual(fallback);
  expect(parseStore(JSON.stringify({ v: GFX_VERSION, preset: 'epic' })).preset).toBe('auto');
  // Custom without values cannot stand; it becomes Auto.
  expect(parseStore(JSON.stringify({ v: GFX_VERSION, preset: 'custom' })).preset).toBe('auto');
  const stored = parseStore(JSON.stringify({ v: GFX_VERSION, preset: 'custom', fpsCounter: true,
    custom: { ...PRESET_VALUES.medium, shadows: 'off' }, auto: { preset: 'high', benched: true, device: 'x' } }));
  expect(stored).toMatchObject({ preset: 'custom', fpsCounter: true, auto: { preset: 'high', benched: true, device: 'x' } });
  expect(stored.custom).toEqual({ ...PRESET_VALUES.medium, shadows: 'off' });
  expect(parseStore(JSON.stringify({ v: GFX_VERSION, preset: 'low', auto: { preset: 'huge', device: 'x' } })).auto).toBeNull();
});

test('GPU strings sort into classes', () => {
  expect(gpuClass('')).toBe('unknown');
  expect(gpuClass('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('software');
  expect(gpuClass('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software');
  expect(gpuClass('Adreno (TM) 740')).toBe('mobile');
  expect(gpuClass('Mali-G78 MC24')).toBe('mobile');
  expect(gpuClass('Apple A15 GPU')).toBe('mobile');
  expect(gpuClass('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe('apple');
  expect(gpuClass('Apple GPU')).toBe('apple');
  expect(gpuClass('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)')).toBe('appleHigh');
  expect(gpuClass(rtx.gpu)).toBe('discrete');
  expect(gpuClass('ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('discrete');
  expect(gpuClass('ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
  expect(gpuClass('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
  expect(gpuClass('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('integrated');
});

test('detection maps devices to a start preset', () => {
  expect(detectPreset(rtx)).toBe('ultra');
  expect(detectPreset({ ...rtx, cores: 4 })).toBe('high');
  expect(detectPreset(desktop('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', 14, null))).toBe('ultra');
  expect(detectPreset(desktop('Apple GPU', 8, null))).toBe('high');
  expect(detectPreset(desktop('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'))).toBe('medium');
  expect(detectPreset(desktop('SwiftShader', 16))).toBe('low');
  // Hidden renderer string: cores decide.
  expect(detectPreset(desktop('', 8, null))).toBe('high');
  expect(detectPreset(desktop('', 4, null))).toBe('medium');
  expect(detectPreset(desktop('', 2, null))).toBe('low');
  // Memory caps.
  expect(detectPreset({ ...rtx, memory: 4 })).toBe('medium');
  expect(detectPreset({ ...rtx, memory: 2 })).toBe('low');
  expect(detectPreset({ ...rtx, maxTextureSize: 4096 })).toBe('low');
  // Phones and tablets always start on Low, flagships included.
  expect(detectPreset(phone('Adreno (TM) 610', 8, 3))).toBe('low');
  expect(detectPreset({ ...phone('Adreno (TM) 750', 8, 8), maxTextureSize: 16384 })).toBe('low');
  expect(detectPreset({ ...phone('Apple GPU', 8, null), maxTextureSize: 16384 })).toBe('low');
  expect(detectPreset({ ...phone('Apple GPU', 8, 8), maxTextureSize: 16384 })).toBe('low');
  expect(detectPreset(phone('Mali-G57', 8, 8))).toBe('low');
  // A touch laptop reports as mobile too; a desktop GPU name alone does not lift it.
  expect(detectPreset({ ...rtx, mobile: true })).toBe('low');
});

test('Quality persists choices, switches to Custom and notifies listeners', () => {
  const storage = new Memory();
  const quality = new Quality(storage, rtx);
  let calls = 0;
  const stop = quality.subscribe(() => calls++);
  expect(quality.choice).toBe('auto');
  expect(quality.autoPreset).toBe('ultra');
  expect(quality.preset).toBe('ultra');
  expect(quality.values).toEqual(PRESET_VALUES.ultra);
  expect(quality.needsBenchmark).toBe(true);
  expect(JSON.parse(storage.getItem(GFX_KEY) ?? '{}').auto.device).toBe(deviceKey(rtx));

  quality.setPreset('low');
  expect(quality.values).toEqual(PRESET_VALUES.low);
  expect(quality.needsBenchmark).toBe(false);
  quality.set('shadows', 'high');
  expect(quality.choice).toBe('custom');
  expect(quality.values).toEqual({ ...PRESET_VALUES.low, shadows: 'high' });
  quality.set('renderScale', 0.62);
  expect(quality.values.renderScale).toBeCloseTo(0.6);
  quality.setFpsCounter(true);
  expect(calls).toBe(4);

  // A second instance on the same storage sees the same thing.
  const again = new Quality(storage, rtx);
  expect(again.choice).toBe('custom');
  expect(again.values).toEqual(quality.values);
  expect(again.fpsCounter).toBe(true);

  quality.reset();
  expect(quality.choice).toBe('auto');
  expect(quality.fpsCounter).toBe(true);
  stop();
  quality.setPreset('high');
  expect(calls).toBe(5);
  // Custom from a preset starts from that preset's values.
  quality.setPreset('custom');
  expect(quality.values).toEqual(PRESET_VALUES.high);
});

test('the benchmark steps Auto down once, and a new device re-detects', () => {
  const storage = new Memory();
  const quality = new Quality(storage, rtx);
  quality.benchmarkDone(true);
  expect(quality.autoPreset).toBe('high');
  expect(quality.needsBenchmark).toBe(false);
  quality.benchmarkDone(true);
  expect(quality.autoPreset).toBe('high');
  expect(new Quality(storage, rtx).autoPreset).toBe('high');
  const swapped = new Quality(storage, { ...rtx, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' });
  expect(swapped.autoPreset).toBe('medium');
  expect(swapped.needsBenchmark).toBe(true);
  const passed = new Quality(new Memory(), rtx);
  passed.benchmarkDone(false);
  expect(passed.autoPreset).toBe('ultra');
});

test('the lower-quality offer never applies itself and knows its limits', () => {
  const quality = new Quality(new Memory(), rtx);
  expect(quality.lowerPreset).toBe('high');
  quality.acceptLower();
  expect(quality.choice).toBe('auto');
  expect(quality.preset).toBe('high');
  quality.setPreset('medium');
  quality.acceptLower();
  expect(quality.choice).toBe('low');
  expect(quality.lowerPreset).toBeNull();
  quality.set('effects', 'full');
  expect(quality.lowerPreset).toBeNull();
});

test('storage failures keep settings in memory', () => {
  const broken = { getItem: (): string => { throw new Error('denied'); }, setItem: (): void => { throw new Error('denied'); } };
  const quality = new Quality(broken, rtx);
  quality.setPreset('medium');
  expect(quality.preset).toBe('medium');
  expect(new Quality(null, rtx).preset).toBe('ultra');
});

/** Feed `seconds` of frames; `ms` is a fixed time or a function of the current scale. */
const run = (dynamic: DynamicResolution, ms: number | ((scale: number) => number), seconds: number): number => {
  for (let t = 0; t < seconds * 1000;) {
    const frame = typeof ms === 'number' ? ms : ms(dynamic.scale);
    dynamic.update(frame);
    t += frame;
  }
  return dynamic.scale;
};
/** A GPU-bound frame: a fixed part plus a part that follows the pixel count. */
const gpu = (fixed: number, perPixel: number) => (scale: number): number => fixed + perPixel * scale * scale;

test('dynamic resolution holds the target with hysteresis', () => {
  const dynamic = new DynamicResolution();
  dynamic.configure(0.7, targetFrameMs(60));
  expect(run(dynamic, 1000 / 60, 5)).toBe(1);
  // Within 15 % of the target is not a miss.
  expect(run(dynamic, 18.5, 5)).toBe(1);
  // A sustained, resolution-bound miss steps down, but never under the floor.
  const heavy = gpu(8, 24);
  const low = run(dynamic, heavy, 1.2);
  expect(low).toBeLessThan(1);
  expect(low).toBeGreaterThanOrEqual(0.7);
  expect(run(dynamic, heavy, 20)).toBe(0.7);
  expect(dynamic.capMs).toBe(0);
  expect(dynamic.atFloor).toBe(true);
  // Recovery steps back up, one small step at a time.
  const before = dynamic.scale;
  run(dynamic, 10, 2.6);
  expect(dynamic.scale).toBeGreaterThan(before);
  expect(dynamic.scale).toBeLessThanOrEqual(before + 0.05 + 1e-9);
  expect(dynamic.atFloor).toBe(false);
  expect(run(dynamic, 10, 30)).toBe(1);
  // Hitches and tab switches are ignored.
  dynamic.update(900);
  expect(dynamic.scale).toBe(1);
});

test('dynamic resolution only reports the floor after about ten seconds', () => {
  const dynamic = new DynamicResolution();
  dynamic.configure(0.8, targetFrameMs(60));
  const heavy = gpu(20, 20);
  run(dynamic, heavy, 1.5);
  expect(dynamic.scale).toBe(0.8);
  expect(dynamic.atFloor).toBe(false);
  run(dynamic, heavy, 10);
  expect(dynamic.atFloor).toBe(true);
  dynamic.configure(0.8, targetFrameMs(30));
  expect(dynamic.scale).toBe(1);
  expect(dynamic.atFloor).toBe(false);
  // 30 fps target: 33 ms frames are on target.
  expect(run(dynamic, 33.3, 5)).toBe(1);
});

test('a refresh cap is not load: the scale comes back and no offer is made', () => {
  const dynamic = new DynamicResolution();
  // A 120 or 90 target on a 60 Hz display.
  for (const fps of [120, 90] as const) {
    dynamic.configure(0.7, targetFrameMs(fps));
    let lowest = 1, floored = false;
    for (let t = 0; t < 15_000; t += 16.667) {
      lowest = Math.min(lowest, dynamic.update(16.667));
      floored ||= dynamic.atFloor;
    }
    expect(dynamic.scale).toBe(1);
    expect(floored).toBe(false);
    expect(dynamic.capMs).toBeCloseTo(16.667, 1);
    // It may probe on the way, but only for a few seconds.
    expect(lowest).toBeGreaterThanOrEqual(0.7);
  }
  // Power saving holds rAF at 30 under a 60 target; the same 60 Hz holds at 50 Hz.
  for (const ms of [33.333, 20]) {
    dynamic.configure(0.6, targetFrameMs(0));
    expect(run(dynamic, ms, 15)).toBe(1);
    expect(dynamic.atFloor).toBe(false);
    // More work than the cap still counts as load and steps down again.
    expect(run(dynamic, scale => ms * 1.2 + 25 * scale * scale, 2)).toBeLessThan(1);
  }
  // A cap that lifts is forgotten: faster frames lower it to the target.
  dynamic.configure(0.7, targetFrameMs(60));
  run(dynamic, 33.333, 10);
  expect(dynamic.capMs).toBeGreaterThan(30);
  run(dynamic, 16.667, 3);
  expect(dynamic.capMs).toBe(0);
  expect(run(dynamic, gpu(8, 24), 3)).toBeLessThan(1);
});

test('one hitch neither hides a refresh cap nor fakes load', () => {
  const dynamic = new DynamicResolution();
  // A 120 target on a 60 Hz display, and power saving holding rAF at 30 under a 60 target.
  for (const [fps, ms, hitch, min] of [[120, 16.667, 100, 0.8], [60, 33.333, 150, 0.6]] as const) {
    // The hitch lands on the first frame (before the first step down) or a second in (after it).
    for (const at of [0, 1000]) {
      dynamic.configure(min, targetFrameMs(fps));
      let floored = false, hitched = false;
      for (let t = 0; t < 15_000;) {
        const frame: number = !hitched && t >= at ? hitch : ms;
        hitched ||= frame === hitch;
        dynamic.update(frame);
        floored ||= dynamic.atFloor;
        t += frame;
      }
      expect(dynamic.scale).toBe(1);
      expect(floored).toBe(false);
      expect(dynamic.capMs).toBeCloseTo(ms, 0);
    }
  }
  // Real load with a hitch at the floor is still load: no cap, and the offer comes.
  dynamic.configure(0.8, targetFrameMs(60));
  const heavy = gpu(20, 20);
  run(dynamic, heavy, 3);
  dynamic.update(200);
  run(dynamic, heavy, 10);
  expect(dynamic.capMs).toBe(0);
  expect(dynamic.atFloor).toBe(true);
});

test('a machine on the edge does not oscillate quickly', () => {
  const dynamic = new DynamicResolution();
  dynamic.configure(0.5, targetFrameMs(60));
  // Fast below 0.9 of full resolution, slow above it.
  const changes: number[] = [];
  let last = dynamic.scale;
  for (let t = 0; t < 60_000; t += 16) {
    dynamic.update(dynamic.scale > 0.9 ? 26 : 16);
    if (dynamic.scale !== last) { changes.push(t); last = dynamic.scale; }
  }
  // Without backoff this would flip every couple of seconds (~30 changes a minute).
  expect(changes.length).toBeLessThan(20);
});

test('the frame limiter keeps an even share of display frames', () => {
  const count = (fps: number, hz: number): number => {
    const limiter = new FrameLimiter();
    limiter.fps = fps;
    let frames = 0;
    for (let i = 0; i < hz * 10; i++) if (limiter.ready(i * 1000 / hz + (i % 3) * 0.3)) frames++;
    return frames / 10;
  };
  expect(count(0, 144)).toBe(144);
  expect(count(60, 60)).toBe(60);
  expect(count(60, 120)).toBeCloseTo(60, -0.5);
  expect(count(30, 60)).toBeCloseTo(30, -0.5);
  expect(Math.abs(count(90, 120) - 90)).toBeLessThan(3);
  expect(count(120, 60)).toBe(60);
});

test('the benchmark skips its warm-up and judges the median', () => {
  const bench = new Benchmark(1000 / 60, 0.5, 2);
  /** Feed frames timed by the bench's own scale until it answers. */
  const finish = (ms: (scale: number) => number): boolean | null => {
    let result: boolean | null = null;
    for (let t = 0; t < 8000 && result === null; t += 1) result = bench.add(ms(bench.scale));
    return result;
  };
  let result: boolean | null = null;
  for (let i = 0; i < 30; i++) expect(bench.add(16.7)).toBeNull();
  for (let t = 0; t < 3000 && result === null; t += 16.7) result = bench.add(16.7);
  expect(result).toBe(false);
  expect(bench.scale).toBe(1);
  // A GPU-bound miss: the reduced-resolution probe runs faster, so it counts.
  bench.reset();
  expect(bench.add(900)).toBeNull();
  expect(finish(gpu(6, 24))).toBe(true);
  // A 30 Hz rAF cap or a CPU limit misses at any resolution, so it does not.
  bench.reset();
  expect(finish(() => 33.333)).toBe(false);
  // The probe draws below full scale, and reset returns to full.
  bench.reset();
  for (let i = 0; i < 200 && bench.scale === 1; i++) bench.add(30);
  expect(bench.scale).toBeLessThan(1);
  bench.reset();
  expect(bench.scale).toBe(1);
  // A few slow frames do not fail a fast machine.
  result = null;
  for (let i = 0; i < 400 && result === null; i++) result = bench.add(i % 10 === 0 ? 40 : 16);
  expect(result).toBe(false);
});

test('screen-shake noise is smooth and keeps the old strength', () => {
  let sum = 0, n = 0, jump = 0;
  for (let t = 0; t < 4000; t += 0.01) {
    const v = shakeNoise(t, 2);
    sum += v * v; n++;
    jump = Math.max(jump, Math.abs(shakeNoise(t + 0.01, 2) - v));
  }
  const rms = Math.sqrt(sum / n);
  // Scaled by 0.58 in the camera, this matches rand(-0.5, 0.5)'s RMS of 0.2887.
  expect(rms * 0.58).toBeGreaterThan(0.2887 * 0.9);
  expect(rms * 0.58).toBeLessThan(0.2887 * 1.1);
  expect(jump).toBeLessThan(0.05);
  expect(shakeNoise(12.5, 0)).not.toBeCloseTo(shakeNoise(12.5, 1), 3);
});

test('effects detail thins cosmetic particles and pools, never tracers', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene, new World());
  const pool = (name: string): THREE.InstancedMesh => scene.getObjectByName(`effects:${name}`) as THREE.InstancedMesh;
  const origin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  effects.setDetail(0.5);
  for (let i = 0; i < 100; i++) effects.particle({ kind: 'drop', pos: origin });
  for (let i = 0; i < 10; i++) effects.tracer(origin, new THREE.Vector3(0, 0, -10));
  effects.update(0.001);
  expect(pool('drops').count).toBe(50);
  expect(pool('strokes').count).toBe(10);
  for (let i = 0; i < 300; i++) effects.decal(new THREE.Vector3(i, 0, 0), up, 0, 1, 'hole');
  expect(pool('holes').count).toBe(130);
  effects.setDetail(1);
  for (let i = 0; i < 300; i++) effects.decal(new THREE.Vector3(i, 0, 0), up, 0, 1, 'hole');
  expect(pool('holes').count).toBe(260);
  effects.clear();
});

test('a directional push records where the jolt came from', () => {
  const effects = new Effects(new THREE.Scene(), new World());
  effects.push(new THREE.Vector3(10, 0, 0), 1);
  effects.push(new THREE.Vector3(0, 0, 10), 1);
  expect(effects.shakePush).toBe(2);
  expect(effects.shakeFrom.toArray()).toEqual([5, 0, 5]);
  effects.push(new THREE.Vector3(Number.NaN, 0, 0), 1);
  effects.push(new THREE.Vector3(), -1);
  expect(effects.shakePush).toBe(2);
  effects.clear();
  expect(effects.shakePush).toBe(0);
});

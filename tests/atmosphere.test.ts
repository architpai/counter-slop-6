import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { FOG_AERIAL, FOG_GLOW, FOG_SUN, aerialFog, fogAt, linearFog, setAtmosphere } from '@/engine/render/atmosphere';
import { Renderer } from '@/engine/render/index';
import { buildLevel } from '@/engine/level/index';
import { World } from '@/engine/physics';
import { ATMOSPHERE } from '@/engine/render/palette';
import { PRESET_VALUES, VIEW_SCALE } from '@/engine/render/quality';
import type { Atmosphere } from '@/engine/types';

const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
  setAtmosphere(null, new THREE.Vector3(0, 1, 0), new THREE.Color(1, 1, 1), new THREE.Color());
});

const HAZE: Atmosphere = { haze: 0.004, falloff: 0.05, start: 30, glow: 0.4, shafts: 0.5 };
const up = new THREE.Vector3(0, 1, 0), white = new THREE.Color(1, 1, 1);

test('the haze starts at its distance, thickens with it and thins with height', () => {
  setAtmosphere(HAZE, up, white, new THREE.Color(0.5, 0.5, 0.5));
  expect([...FOG_AERIAL]).toEqual([0.004, 0.05, 0, 30].map(n => Math.fround(n)));
  // None nearer than `start`: the play space keeps the linear fog alone.
  expect(aerialFog(30, 1.7, 1.7, FOG_AERIAL)).toBe(0);
  expect(fogAt(25, 1.7, 1.7, 50, 190)).toBe(linearFog(25, 50, 190));
  // Beyond it, more with distance, towards 1.
  const along = [40, 80, 160, 320].map(d => aerialFog(d, 1.7, 1.7, FOG_AERIAL));
  for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThan(along[i - 1]!);
  expect(along[3]!).toBeGreaterThan(0.6);
  // Level at eye height: the closed form is the density there times the hazy span.
  expect(aerialFog(80, 1.7, 1.7, FOG_AERIAL)).toBeCloseTo(1 - Math.exp(-0.004 * 50 * Math.exp(-0.05 * 1.7)), 6);
  // From a rooftop down to the street, or up at a skyline, the ray crosses thinner air than along the ground.
  expect(aerialFog(100, 30, 1, FOG_AERIAL)).toBeLessThan(aerialFog(100, 1.7, 1.7, FOG_AERIAL));
  expect(aerialFog(100, 1.7, 40, FOG_AERIAL)).toBeLessThan(aerialFog(100, 1.7, 1.7, FOG_AERIAL));
  // The same rise either way matches a numeric integral of the density along the ray.
  const numeric = (distance: number, eye: number, point: number): number => {
    let depth = 0;
    const steps = 20000;
    for (let i = 0; i < steps; i++) {
      const s = (i + 0.5) / steps * distance;
      if (s < HAZE.start) continue;
      depth += HAZE.haze * Math.exp(-HAZE.falloff * (eye + (point - eye) * s / distance)) * distance / steps;
    }
    return 1 - Math.exp(-depth);
  };
  for (const [d, a, b] of [[120, 1.7, 25], [90, 20, 0.5], [200, 1.7, 1.7]] as const) expect(aerialFog(d, a, b, FOG_AERIAL)).toBeCloseTo(numeric(d, a, b), 4);
  // The glow is the sun's hue at the fog's brightness, straight towards the sun.
  setAtmosphere(HAZE, up, new THREE.Color(1, 0.5, 0.25), new THREE.Color(0.5, 0.5, 0.5));
  expect([...FOG_GLOW].map(n => +n.toFixed(4))).toEqual([0.2, 0.1, 0.05]);
  expect([...FOG_SUN].slice(0, 3)).toEqual([0, 1, 0]);
  // A longer view distance starts the haze further out, as the linear fog stretches, at the same density.
  setAtmosphere(HAZE, up, white, white, 1.3);
  expect(FOG_AERIAL[3]).toBeCloseTo(39, 4);
  expect(FOG_AERIAL[0]).toBeCloseTo(0.004, 6);
  // None: every value zero, the shader's unpatched path.
  setAtmosphere(null, up, white, white);
  expect([...FOG_AERIAL, ...FOG_SUN, ...FOG_GLOW].every(n => n === 0)).toBe(true);
});

test('every map keeps its 60 and 70 m grunts, and anyone straight across its play space, as clear as the linear fog left them', () => {
  for (const [key, arena, entry] of [['downtown', false, 'downtown'], ['downtown', true, 'arena'], ['house', false, 'house'],
    ['mexico', false, 'mexico'], ['training', false, 'training']] as const) {
    const level = buildLevel(new THREE.Scene(), new World(), key, { arena });
    const atmosphere = level.mood?.realistic?.atmosphere;
    expect(atmosphere, entry).toBe(ATMOSPHERE[entry]);
    // Side to side across the bounds: a grunt at the far edge wears no haze (Mexico's once started at 80 m, inside its 124).
    const { minX, maxX, minZ, maxZ } = level.bounds, across = Math.max(maxX - minX, maxZ - minZ);
    for (const view of Object.values(VIEW_SCALE)) {
      setAtmosphere(atmosphere ?? null, up, white, white, view);
      // Eye to a chest at 60 m and 70 m, the wall 10 m behind him, and the far edge: no haze on any.
      for (const d of [60, 70, 80, across]) expect(aerialFog(d, 1.7, 1.2, FOG_AERIAL), `${entry} ×${view} ${d} m`).toBe(0);
      // The backdrops 200 m out do take it (the map's depth cue).
      expect(aerialFog(200, 1.7, 5, FOG_AERIAL), `${entry} ×${view}`).toBeGreaterThan(0.03);
    }
  }
});

/** A white plane `distance` metres ahead, fogged towards black, read back from a one-pixel float target (its centre on the axis). */
function fogged(three: THREE.WebGLRenderer, distance: number, material: THREE.Material, eyeY = 1.7): number {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  scene.fog = new THREE.Fog(0x000000, 50, 190);
  camera.position.set(0, eyeY, 0);
  camera.lookAt(0, eyeY, -1);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  plane.position.set(0, eyeY, -distance);
  scene.add(plane);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType });
  three.setRenderTarget(target);
  three.render(scene, camera);
  const pixel = new Float32Array(4);
  three.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  three.setRenderTarget(null);
  target.dispose();
  plane.geometry.dispose();
  return pixel[0]!;
}

test('the patched fog chunk draws what fogAt says, and exactly the linear fog without haze', () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  cleanup.push(() => { three.dispose(); three.forceContextLoss(); });
  const basic = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lambert = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xffffff });
  cleanup.push(() => { basic.dispose(); lambert.dispose(); });
  for (const material of [basic, lambert]) {
    // No haze: three's own smoothstep (to float precision: the GPU's, against the test's doubles).
    for (const d of [40, 60, 120]) expect(fogged(three, d, material)).toBeCloseTo(1 - linearFog(d, 50, 190), 5);
    setAtmosphere(HAZE, up, white, white);
    for (const d of [40, 60, 120, 170]) expect(fogged(three, d, material)).toBeCloseTo(1 - fogAt(d, 1.7, 1.7, 50, 190), 3);
    setAtmosphere(null, up, white, white);
  }
  // Every material shares the three typed arrays: one write reaches every program.
  const uniforms = (three.properties.get(basic) as { uniforms: Record<string, THREE.IUniform> }).uniforms;
  expect(uniforms.fogAerial!.value).toBe(FOG_AERIAL);
  expect(uniforms.fogGlow!.value).toBe(FOG_GLOW);
});

test('the renderer puts each map\'s haze and shafts on the realistic look only', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  const mood = buildLevel(new THREE.Scene(), new World(), 'mexico').mood ?? {};
  renderer.setMood(mood);
  renderer.applyQuality(PRESET_VALUES.low);
  expect(FOG_AERIAL[0]).toBe(0);
  expect(renderer.post._shaftStrength).toBe(0);
  expect(renderer.fogAt(60, 1.7, 1.2)).toBeCloseTo(linearFog(60, 55, 260), 6);
  renderer.applyQuality(PRESET_VALUES.medium);
  expect(FOG_AERIAL[0]).toBeCloseTo(ATMOSPHERE.mexico.haze, 6);
  expect(FOG_AERIAL[3]).toBeCloseTo(ATMOSPHERE.mexico.start, 4);
  expect(renderer.post._shaftStrength).toBe(ATMOSPHERE.mexico.shafts);
  // Ultra's long view distance stretches the haze with the fog.
  renderer.applyQuality(PRESET_VALUES.ultra);
  expect(FOG_AERIAL[3]).toBeCloseTo(ATMOSPHERE.mexico.start * VIEW_SCALE.long, 4);
  expect(renderer.fogAt(200, 1.7, 5)).toBeGreaterThan(linearFog(200, 55 * 1.3, 260 * 1.3));
  renderer.applyQuality(PRESET_VALUES.low);
  expect([...FOG_AERIAL].every(n => n === 0)).toBe(true);
});

test('light shafts draw towards a sun in view, none behind the eye; the lens dirt comes and goes with them', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  renderer.setMood({ sunDir: [0, 0.6, -1], realistic: { atmosphere: HAZE } });
  renderer.applyQuality(PRESET_VALUES.ultra);
  const post = renderer.post;
  expect(post.config.shafts).toBe(true);
  expect(post._dirt).not.toBeNull();
  const passes = (): string[] => {
    const names: string[] = [], pass = post._pass.bind(post);
    const spy = vi.spyOn(post, '_pass').mockImplementation((three, material, target) => { names.push(material.name); pass(three, material, target); });
    renderer.render(0, fx);
    spy.mockRestore();
    return names;
  };
  renderer.camera.position.set(0, 1.6, 0);
  renderer.camera.lookAt(0, 1.6 + 0.6, -1);
  expect(passes().filter(name => name.startsWith('post:shaft'))).toEqual(['post:shaft-mask', 'post:shaft-blur', 'post:shaft-blur']);
  expect(post._toneUniforms.shaftColor.value.r).toBeGreaterThan(0);
  const sun = post._shaftMaskUniforms.sunUv.value;
  expect(sun.x).toBeCloseTo(0.5, 2);
  expect(sun.y).toBeCloseTo(0.5, 2);
  // Open sky everywhere (an empty scene): the rays are strong at the sun and fade to nothing across the frame, no
  // veil (every pixel's line to the sun crosses the open sky beside it, so without the fade a corner took a tenth).
  const rays = post._shafts[0], { z: w, w: h } = rays.viewport, pixel = new Uint16Array(4);
  const at = (x: number, y: number) => { renderer.three.readRenderTargetPixels(rays, x, y, 1, 1, pixel); return THREE.DataUtils.fromHalfFloat(pixel[0]!); };
  const centre = at(Math.floor(w / 2), Math.floor(h / 2));
  expect(centre).toBeGreaterThan(0.5);
  expect(at(0, 0)).toBeLessThan(0.03 * centre);
  expect(at(Math.floor(w / 2), h - 1)).toBeLessThan(0.3 * centre);
  // Turned away: no shaft pass runs and none is added.
  renderer.camera.lookAt(0, 1.6, 1);
  expect(passes().some(name => name.startsWith('post:shaft'))).toBe(false);
  expect(post._toneUniforms.shaftColor.value.r).toBe(0);
  expect(renderer.three.getContext().getError()).toBe(renderer.three.getContext().NO_ERROR);
  // Off (or bloom off: no dirt), and on Low: the targets and the dirt are freed.
  renderer.applyQuality({ ...PRESET_VALUES.ultra, bloom: false });
  expect(post._dirt).toBeNull();
  expect(post.config.shafts).toBe(true);
  renderer.applyQuality({ ...PRESET_VALUES.ultra, shafts: false });
  expect([post.config.shafts, post._dirt]).toEqual([false, null]);
  renderer.applyQuality({ ...PRESET_VALUES.low, shafts: true });
  expect(post.config.shafts).toBe(false);
  // A GPU that keeps no MSAA depth draws none with MSAA on, as it dithers the smoke.
  const has = renderer.three.extensions.has.bind(renderer.three.extensions);
  const ext = vi.spyOn(renderer.three.extensions, 'has').mockImplementation(name => name === 'WEBGL_multisampled_render_to_texture' || has(name));
  renderer.applyQuality(PRESET_VALUES.ultra);
  expect(post.config.shafts).toBe(false);
  renderer.applyQuality({ ...PRESET_VALUES.ultra, antialias: 'smaa' });
  expect(post.config.shafts).toBe(true);
  ext.mockRestore();
}, 60_000);

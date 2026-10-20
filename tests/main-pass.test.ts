import { afterEach, expect, test } from 'vitest';
import * as THREE from 'three';
import { GRID_UNIFORMS, fixUv, kitMat, realMat, setAoAlpha, weaponPropMaterial, wearMaps } from '@/engine/render/materials';
// The scene-alpha chunk GTAO reads (`OPAQUE_CHUNK`).
import '@/engine/render/postfx';
import { resolveMaterial, setInfo } from '@/engine/render/surfaces';
import type { SetMaps } from '@/engine/render/textures';

const SIZE = 48;
const cleanup: (() => void)[] = [];
afterEach(() => {
  setAoAlpha(true);
  for (const done of cleanup.splice(0)) done();
});

/** A 16 x 16 map whose texels vary (no Math.random: a fixed pattern). */
function pattern(f: (x: number, y: number) => [number, number, number], colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [r, g, b] = f(x, y), i = (y * 16 + x) * 4;
      data.set([r, g, b, 255], i);
    }
  }
  const texture = new THREE.DataTexture(data, 16, 16);
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  cleanup.push(() => texture.dispose());
  return texture;
}

function testMaps(): SetMaps {
  return {
    albedo: pattern((x, y) => [40 + x * 12, 200 - y * 9, (x * y * 7) % 256], THREE.SRGBColorSpace),
    normal: pattern((x, y) => [128 + Math.round(60 * Math.sin(x)), 128 + Math.round(60 * Math.cos(y)), 230], THREE.NoColorSpace),
    orm: pattern((x, y) => [255 - x * 8, 30 + y * 13, (x + y) % 2 ? 230 : 20], THREE.NoColorSpace),
  };
}

/** Draw `material` on a tilted, repeating plane under a sun and an ambient fill; the target's float RGBA. */
function draw(renderer: THREE.WebGLRenderer, material: THREE.Material): Float32Array {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  const geometry = new THREE.PlaneGeometry(12, 12, 4, 4);
  geometry.attributes.uv!.array.forEach((v, i, uv) => { (uv as Float32Array)[i] = v * 3; });
  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.set(-1.1, 0.3, 0);
  plane.position.set(1.5, -1, -6);
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.5);
  sun.position.set(2, 5, 3);
  scene.add(plane, sun, new THREE.AmbientLight(0x8090a0, 0.6));
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType, depthBuffer: true });
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const pixels = new Float32Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  geometry.dispose();
  return pixels;
}

function makeRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  cleanup.push(() => renderer.dispose());
  return renderer;
}

/** Channels that differ between two drawings, and how many pixels the drawing covers. */
function diff(a: Float32Array, b: Float32Array, channels: number[]): { differ: number; covered: number } {
  let differ = 0, covered = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3]! !== 0 || a[i]! !== 0) covered++;
    for (const c of channels) if (!Object.is(a[i + c], b[i + c])) differ++;
  }
  return { differ, covered };
}

/** Every program the renderer built linked (three keeps a failed one's report in `diagnostics`). */
const runnable = (renderer: THREE.WebGLRenderer) => (renderer.info.programs ?? [])
  .every(program => (program as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable !== false);

test('fixUv keeps the bits three computes, and only fixes default transforms', () => {
  const fresh = new THREE.Texture(), fixed = new THREE.Texture(), moved = new THREE.Texture();
  fresh.updateMatrix();
  fixUv(fixed);
  expect(fixed.matrixAutoUpdate).toBe(false);
  expect(fixed.matrix.elements.every((v, i) => Object.is(v, fresh.matrix.elements[i]))).toBe(true);
  // three's own update writes -0 in one element: the fixed matrix keeps it.
  expect(Object.is(fixed.matrix.elements[1], -0)).toBe(true);
  moved.repeat.set(2, 2);
  fixUv(moved);
  expect(moved.matrixAutoUpdate).toBe(true);
});

test('packed maps on one fixed uv share a program key part; any other transform does not', () => {
  const material = weaponPropMaterial('pistol');
  expect(material.customProgramCacheKey()).toBe('prop|orm|uv');
  const maps = testMaps();
  maps.normal.repeat.set(2, 1);
  const version = material.version;
  wearMaps(material, maps);
  expect(material.customProgramCacheKey()).toBe('prop|orm');
  expect(material.version).toBeGreaterThan(version);
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {},
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  expect(shader.vertexShader.startsWith('#define ORM_PACKED\n#define STANDARD')).toBe(true);
  expect(shader.fragmentShader).not.toContain('UV_SHARED');
  material.dispose();
});

test('AO alpha: the define and the key follow the flag', () => {
  const material = weaponPropMaterial('pistol');
  expect(setAoAlpha(true)).toBe(false);
  expect(setAoAlpha(false)).toBe(true);
  expect(material.customProgramCacheKey()).toBe('prop|orm|uv|no-ao-alpha');
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {},
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('#define NO_AO_ALPHA');
  expect(setAoAlpha(true)).toBe(true);
  expect(material.customProgramCacheKey()).toBe('prop|orm|uv');
  material.dispose();
});

test('packed, shared-uv programs draw the pixels of three\'s unpacked ones', () => {
  const renderer = makeRenderer(), maps = testMaps();
  const packed = weaponPropMaterial('pistol');
  wearMaps(packed, maps);
  expect(packed.customProgramCacheKey()).toBe('prop|orm|uv');
  // Separate texture objects in every slot (the same images): three's chunks, a uv varying per map.
  const loose = weaponPropMaterial('pistol');
  const copy = (texture: THREE.Texture) => {
    const out = texture.clone();
    cleanup.push(() => out.dispose());
    return out;
  };
  loose.map = copy(maps.albedo);
  loose.normalMap = copy(maps.normal);
  loose.aoMap = copy(maps.orm);
  loose.roughnessMap = copy(maps.orm);
  loose.metalnessMap = copy(maps.orm);
  expect(loose.customProgramCacheKey()).toBe('prop');
  const a = draw(renderer, packed), b = draw(renderer, loose);
  expect(runnable(renderer)).toBe(true);
  const { differ, covered } = diff(a, b, [0, 1, 2, 3]);
  expect(covered).toBeGreaterThan(SIZE * SIZE / 4);
  expect(differ).toBe(0);
  packed.dispose();
  loose.dispose();
});

test('the level\'s macro noise reads the probe grid\'s position: the same pixels as its own varying', () => {
  const renderer = makeRenderer(), info = setInfo('concrete');
  expect(GRID_UNIFORMS.probeGridMix.value).toBe(0);
  // With the grid's mix at 0 the gridded kind lights as the far one; only the noise's position differs in source.
  const near = kitMat('concrete', info), far = kitMat('concrete', info, true);
  const a = draw(renderer, near), b = draw(renderer, far);
  expect(runnable(renderer)).toBe(true);
  const { differ, covered } = diff(a, b, [0, 1, 2]);
  expect(covered).toBeGreaterThan(SIZE * SIZE / 4);
  expect(differ).toBe(0);
  // The baked kind keeps its own varying (and the shared uvs beside its lightmap's): it links too.
  const baked = realMat(resolveMaterial('brick', 'block'), setInfo('brick'), true);
  expect(baked.customProgramCacheKey()).toBe('level-pbr-baked|orm|uv');
  draw(renderer, baked);
  expect(runnable(renderer)).toBe(true);
});

test('with AO off the patched materials leave the scene alpha alone and draw the same colour', () => {
  const renderer = makeRenderer();
  const material = weaponPropMaterial('pistol');
  wearMaps(material, testMaps());
  const on = draw(renderer, material);
  setAoAlpha(false);
  material.needsUpdate = true;
  const off = draw(renderer, material);
  expect(runnable(renderer)).toBe(true);
  expect(diff(on, off, [0, 1, 2]).differ).toBe(0);
  let lit = 0, opaque = 0;
  for (let i = 3; i < on.length; i += 4) {
    if (on[i]! !== 0 && on[i]! !== 1) lit++;
    if (off[i] === 1) opaque++;
  }
  expect(lit).toBeGreaterThan(0);
  expect(opaque).toBe(diff(on, off, []).covered);
  material.dispose();
});

import { expect, test } from 'vitest';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLevel } from '@/engine/level/index';
import { World } from '@/engine/physics';
import { SUN_DIR } from '@/engine/render/index';
import { disposeSky, loadSky, parseSkyData, skyUrl } from '@/engine/render/sky';

const MAPS = ['downtown', 'house', 'mexico', 'training'] as const;

test('every map mood names its Blender sky, rendered for the same sun', async () => {
  for (const key of MAPS) {
    const mood = buildLevel(new THREE.Scene(), new World(), key).mood ?? {};
    expect(mood.sky).toBe(key);
    const data = parseSkyData(await (await fetch(skyUrl(key, 'sky.json'))).json());
    expect(data.map).toBe(key);
    // Re-render with tools/blender/sky.py when a mood's sunDir changes.
    const sun = mood.sunDir ? new THREE.Vector3(...mood.sunDir).normalize() : SUN_DIR;
    expect(new THREE.Vector3(...data.sunDir).dot(sun), key).toBeGreaterThan(1 - 1e-5);
    // The units: a white horizontal surface in full sun (sun plus sky) has irradiance pi. The
    // sky's part is the probe's irradiance straight up, as three evaluates it (shGetIrradianceAt).
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const sh = data.sh.map(luma);
    const skyUp = 0.886227 * sh[0]! + 1.023328 * sh[1]! - 0.247708 * sh[6]! - 0.429043 * sh[8]!;
    expect((luma(data.sun) * sun.y + skyUp) / Math.PI, key).toBeCloseTo(1, 1);
    // A clear day: the sky gives a sixth or so of it, the sun the rest.
    expect(skyUp / Math.PI).toBeGreaterThan(0.05);
    expect(skyUp / Math.PI).toBeLessThan(0.3);
    let bytes = 0;
    for (const file of ['sky.json', 'env.hdr', 'sky.webp']) bytes += (await (await fetch(skyUrl(key, file))).arrayBuffer()).byteLength;
    expect(bytes, key).toBeLessThan(3 * 1024 * 1024);
  }
});

test('sky.json is checked before it can reach the lights', () => {
  const good = { map: 'x', sunDir: [0, 1, 0], sun: [1, 1, 1], sh: Array(9).fill([0, 0, 0]), fog: [1, 1, 1], background: 1 };
  expect(parseSkyData(good).map).toBe('x');
  for (const bad of [null, [], { ...good, sh: [[0, 0, 0]] }, { ...good, sun: [1, 1] }, { ...good, background: 0 }, { ...good, fog: [1, Number.NaN, 1] }]) {
    expect(() => parseSkyData(bad)).toThrow();
  }
});

test('a sky loads as an equirect HDR the size of the room environment, and an sRGB background', async () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  const sky = await loadSky('downtown');
  expect(sky.hdr.type).toBe(THREE.HalfFloatType);
  expect(sky.background.colorSpace).toBe(THREE.SRGBColorSpace);
  expect([sky.background.image.width, sky.background.image.height]).toEqual([2048, 1024]);
  // Its PMREM matches the room environment's, so swapping one for the other changes no shader.
  const pmrem = new THREE.PMREMGenerator(three);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04), env = pmrem.fromEquirectangular(sky.hdr);
  expect(env.texture.mapping).toBe(THREE.CubeUVReflectionMapping);
  expect([env.width, env.height]).toEqual([room.width, room.height]);
  for (const target of [room, env]) target.dispose();
  pmrem.dispose();
  disposeSky(sky);
  // A missing sky rejects, and the renderer keeps the gradient dome.
  await expect(loadSky('nowhere')).rejects.toThrow();
  three.dispose();
  three.forceContextLoss();
});

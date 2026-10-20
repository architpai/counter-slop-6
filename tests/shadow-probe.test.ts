import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Renderer } from '@/engine/render/index';
import { levelDepthSkinnedMat } from '@/engine/render/materials';
import { skinnedDepthProbe } from '@/engine/render/operators';
import { PRESET_VALUES } from '@/engine/render/quality';

// Round 9: the worn operators' skinned shadow program is linked and first drawn at the menu (`skinnedDepthProbe`,
// `_warmPrograms`), not at the first shadow draw of a glb that lands in a match.

const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function makeRenderer(): Renderer {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  return renderer;
}

/** A body's mesh as the glb gives it (KHR_mesh_quantization's layout) and as a worn figure casts it. */
function bodyMesh(): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Int16Array([0, 0, 0, 0, 9000, 0, 0, 0, 0, 9000, 0, 0]), 4), 3, 0, true));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Uint16Array(6), 2, true));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(12), 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]), 4, true));
  const map = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1);
  map.needsUpdate = true;
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ map }));
  mesh.bind(new THREE.Skeleton([new THREE.Bone()]), new THREE.Matrix4());
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = levelDepthSkinnedMat();
  return mesh;
}

test('the skinned depth probe: made without a random draw, drawn with no area, as the bodies cast', () => {
  // This file's first call (each browser test file has its own module state).
  const random = vi.spyOn(Math, 'random');
  const probe = skinnedDepthProbe();
  // A new probe each call (each renderer owns its own), none with a random draw.
  const other = skinnedDepthProbe();
  expect(other).not.toBe(probe);
  expect(random).not.toHaveBeenCalled();
  random.mockRestore();
  const { geometry } = probe;
  const weights = geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
  expect([...weights.array].every(w => w === 0)).toBe(true);
  // Every vertex skins to the origin: the triangle has no area, in the shadow maps or the frame.
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    expect(probe.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i)).toArray()).toEqual([0, 0, 0]);
  }
  // Its material is the bodies' depth material's twin: the same patch and key, back faces, a map on channel 0.
  const material = probe.material as THREE.MeshDepthMaterial, body = levelDepthSkinnedMat();
  expect(material).not.toBe(body);
  expect(probe.customDepthMaterial).toBe(material);
  expect(material.onBeforeCompile).toBe(body.onBeforeCompile);
  expect(material.customProgramCacheKey).toBe(body.customProgramCacheKey);
  expect(material.depthPacking).toBe(body.depthPacking);
  expect([material.side, material.shadowSide, material.map?.channel]).toEqual([THREE.BackSide, THREE.BackSide, 0]);
  expect(probe.castShadow).toBe(true);
});

test('the menu warm-up links the bodies\' skinned shadow program on the realistic tiers, again after a preset change', () => {
  const renderer = makeRenderer();
  const queued = () => renderer._depthProbe !== null && renderer._warmups.some(w => w.root === renderer._depthProbe);
  const warm = () => {
    for (let i = 0; i < 20 && (renderer._compiles.length > 0 || renderer._warmups.length > 0 || !renderer._programsWarm); i++) renderer.render(0, fx);
    expect(renderer._warmups).toEqual([]);
    expect(renderer._depthProbe?.parent ?? null, 'the probe out of the scene after its draw').toBeNull();
  };
  renderer.applyQuality(PRESET_VALUES.low);
  renderer._warmPrograms();
  expect(queued(), 'Low wears no operators').toBe(false);
  warm();
  renderer.applyQuality(PRESET_VALUES.high);
  renderer._warmPrograms();
  expect(queued(), 'High after Low').toBe(true);
  const probe = renderer._depthProbe!;
  warm();
  // The program the probe's shadow draw linked is a body's: a body cast after the warm-up links no depth program.
  const depthKeys = () => new Set(renderer.three.info.programs!.filter(p => p.cacheKey.startsWith('depth,')).map(p => p.cacheKey));
  const known = depthKeys();
  expect(known.size).toBeGreaterThan(0);
  const linked = renderer.three.properties.get(probe.material) as { programs?: Map<string, unknown> };
  expect(linked.programs?.size ?? 0).toBeGreaterThan(0);
  const body = bodyMesh();
  body.position.copy(renderer.camera.position).add(renderer.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
  renderer.scene.add(body);
  cleanup.push(() => { renderer.scene.remove(body); });
  renderer.render(0, fx);
  renderer.render(0, fx);
  const used = (renderer.three.properties.get(levelDepthSkinnedMat()) as { currentProgram?: { cacheKey: string } }).currentProgram;
  expect(used, 'the body was cast in the shadow pass').toBeDefined();
  expect(known.has(used!.cacheKey), 'the body\'s depth program was linked at the menu').toBe(true);
  expect(linked.programs!.has(used!.cacheKey), 'by the probe').toBe(true);
  expect([...depthKeys()].filter(key => !known.has(key))).toEqual([]);
});

test('each renderer frees only its own probe, and another renderer\'s queued probe stays whole', () => {
  const make = () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const renderer = new Renderer(canvas);
    renderer.applyQuality(PRESET_VALUES.high);
    renderer._warmPrograms();
    return { renderer, canvas };
  };
  const a = make(), b = make();
  cleanup.push(() => { a.renderer.dispose(); a.canvas.remove(); });
  const probeA = a.renderer._depthProbe!, probeB = b.renderer._depthProbe!;
  expect(probeA).not.toBe(probeB);
  expect(a.renderer._warmups.some(w => w.root === probeA)).toBe(true);
  const events = (probe: THREE.SkinnedMesh) => {
    const freed = vi.fn(), material = probe.material as THREE.MeshDepthMaterial;
    for (const item of [probe.geometry, material, material.map!, probe.skeleton.boneTexture!]) item.addEventListener('dispose', freed);
    return freed;
  };
  const freedA = events(probeA), freedB = events(probeB);
  b.renderer.dispose();
  b.canvas.remove();
  expect([freedA.mock.calls.length, freedB.mock.calls.length, b.renderer._depthProbe]).toEqual([0, 4, null]);
  // A's queued probe draws with its own bone texture: no new texture (made outside `quietly`) at its warm-up.
  const bones = probeA.skeleton.boneTexture;
  for (let i = 0; i < 20 && a.renderer._warmups.length > 0; i++) a.renderer.render(0, fx);
  expect(a.renderer._warmups).toEqual([]);
  expect(probeA.skeleton.boneTexture).toBe(bones);
});

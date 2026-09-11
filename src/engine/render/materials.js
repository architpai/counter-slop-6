import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, TONE, TONE_HEX, TOON_STEPS } from './palette.js';

const surfaces = new Map();
const characters = new Map();
const unlit = new Map();
const originals = new WeakMap();
const labels = new WeakMap();
const posts = new WeakMap();
const gradient = new THREE.DataTexture(new Uint8Array(TOON_STEPS), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.generateMipmaps = false;
gradient.needsUpdate = true;

export function surfMat(key) {
  if (!Object.hasOwn(SURF, key)) key = 'block';
  if (!surfaces.has(key)) surfaces.set(key, new THREE.MeshLambertMaterial({ color: SURF[key], flatShading: true }));
  return surfaces.get(key);
}

export function charMat(color) {
  if (!characters.has(color)) characters.set(color, new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  return characters.get(color);
}

export function toneMat(tone) {
  return charMat(TONE_HEX[tone] ?? TONE_HEX[TONE.PRIMARY]);
}

export function unlitMat(color) {
  if (!unlit.has(color)) unlit.set(color, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  return unlit.get(color);
}

export function setFlash(root, on, tone = TONE.HOSTILE) {
  const material = on ? unlitMat(TONE_HEX[tone] ?? TONE_HEX[TONE.HOSTILE]) : null;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    if (on) {
      if (!originals.has(mesh)) originals.set(mesh, mesh.material);
      mesh.material = material;
    } else if (originals.has(mesh)) {
      mesh.material = originals.get(mesh);
      originals.delete(mesh);
    }
  });
}

export function mergeByMaterial(parts) {
  const groups = new Map();
  for (const { geo, key } of parts) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(geo);
  }
  const meshes = [];
  for (const [key, source] of groups) {
    const geometries = source.map(geo => geo.index ? geo.toNonIndexed() : geo.clone());
    // Level primitives need only positions and normals. Keep the attributes uniform for merging.
    for (const geo of geometries) {
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      if (!geo.hasAttribute('normal')) geo.computeVertexNormals();
    }
    const merged = mergeGeometries(geometries, false);
    for (const geo of geometries) geo.dispose();
    if (!merged) throw new Error('Level geometry could not be merged.');
    const mesh = new THREE.Mesh(merged, surfMat(key));
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  for (const geo of new Set(parts.map(part => part.geo))) geo.dispose();
  return meshes;
}

// Private factories keep every material constructor in this module.
export function makePostMaterial(uniforms, vertexShader, fragmentShader) {
  if (!posts.has(uniforms)) posts.set(uniforms, new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, depthWrite: false, depthTest: false,
  }));
  return posts.get(uniforms);
}

export function makeLabelMaterial(texture) {
  if (!labels.has(texture)) {
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    material.addEventListener('dispose', () => labels.delete(texture));
    labels.set(texture, material);
  }
  return labels.get(texture);
}

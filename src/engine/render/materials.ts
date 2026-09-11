import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, TONE, TONE_HEX, TOON_STEPS } from './palette';
import type { SurfKey } from './palette';

const surfaces = new Map<SurfKey, THREE.MeshLambertMaterial>();
const characters = new Map<number, THREE.MeshToonMaterial>();
const unlit = new Map<number, THREE.MeshBasicMaterial>();
const originals = new WeakMap<THREE.Object3D, THREE.Material | THREE.Material[]>();
const labels = new WeakMap<THREE.Texture, THREE.MeshBasicMaterial>();
const posts = new WeakMap<PostUniforms, THREE.ShaderMaterial>();
const gradient = new THREE.DataTexture(new Uint8Array(TOON_STEPS), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.generateMipmaps = false;
gradient.needsUpdate = true;

export type PostUniforms = Record<string, THREE.IUniform>;
export interface MergePart {
  geo: THREE.BufferGeometry;
  key: SurfKey;
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

export function surfMat(key: SurfKey): THREE.MeshLambertMaterial {
  if (!Object.hasOwn(SURF, key)) key = 'block';
  let material = surfaces.get(key);
  if (material === undefined) surfaces.set(key, material = new THREE.MeshLambertMaterial({ color: SURF[key], flatShading: true }));
  return material;
}

export function charMat(color: number): THREE.MeshToonMaterial {
  let material = characters.get(color);
  if (material === undefined) characters.set(color, material = new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  return material;
}

export function toneMat(tone: number): THREE.MeshToonMaterial {
  return charMat(TONE_HEX[tone] ?? TONE_HEX[TONE.PRIMARY]);
}

export function unlitMat(color: number): THREE.MeshBasicMaterial {
  let material = unlit.get(color);
  if (material === undefined) unlit.set(color, material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  return material;
}

export function setFlash(root: THREE.Object3D, on: boolean, tone: number = TONE.HOSTILE): void {
  const material = on ? unlitMat(TONE_HEX[tone] ?? TONE_HEX[TONE.HOSTILE]) : null;
  root.traverse(mesh => {
    if (!isMesh(mesh)) return;
    if (material) {
      if (!originals.has(mesh)) originals.set(mesh, mesh.material);
      mesh.material = material;
    } else {
      const original = originals.get(mesh);
      if (original !== undefined) {
        mesh.material = original;
        originals.delete(mesh);
      }
    }
  });
}

export function mergeByMaterial(parts: MergePart[]): THREE.Mesh[] {
  const groups = new Map<SurfKey, THREE.BufferGeometry[]>();
  for (const { geo, key } of parts) {
    let group = groups.get(key);
    if (group === undefined) groups.set(key, group = []);
    group.push(geo);
  }
  const meshes: THREE.Mesh[] = [];
  for (const [key, source] of groups) {
    const geometries = source.map(geo => geo.index ? geo.toNonIndexed() : geo.clone());
    // Level primitives need only positions and normals. Keep the attributes uniform for merging.
    for (const geo of geometries) {
      for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
      if (!geo.hasAttribute('normal')) geo.computeVertexNormals();
    }
    // ponytail: @types/three types mergeGeometries as non-null, but it returns null on
    // mismatched attributes, so the guard below is live despite looking dead.
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

/** Vertex-coloured, unlit, inside-out: the sky dome. One instance, never fogged. */
export function skyMat(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
}

// Private factories keep every material constructor in this module.
export function makePostMaterial(uniforms: PostUniforms, vertexShader: string, fragmentShader: string): THREE.ShaderMaterial {
  let material = posts.get(uniforms);
  if (material === undefined) posts.set(uniforms, material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, depthWrite: false, depthTest: false,
  }));
  return material;
}

export function makeLabelMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  let material = labels.get(texture);
  if (material === undefined) {
    material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    material.addEventListener('dispose', () => labels.delete(texture));
    labels.set(texture, material);
  }
  return material;
}

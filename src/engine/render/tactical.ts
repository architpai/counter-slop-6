import { BufferAttribute, BufferGeometry, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { EnemyKind } from '../types';
import { CHARACTER_GLOW, characterMat } from './materials';
import type { FigurePartName } from './figure';

export type TacticalKind = 'player' | EnemyKind;
export const TACTICAL_PARTS = ['hips', 'torso', 'head', 'upperL', 'upperR', 'foreL', 'foreR',
  'thighL', 'thighR', 'shinL', 'shinR'] as const;
const machineLegs = TACTICAL_PARTS.filter(part => part !== 'head');
export const TACTICAL_MODELS = {
  player: TACTICAL_PARTS, grunt: TACTICAL_PARTS, heavy: TACTICAL_PARTS,
  rusher: TACTICAL_PARTS, sniper: TACTICAL_PARTS, shield: [...TACTICAL_PARTS, 'shield'], boss: TACTICAL_PARTS,
  bomber: [...machineLegs, 'cap', 'fuse', 'spark'],
  flyer: ['torso', 'wingL', 'wingR', 'tail'],
  hitbox: [...machineLegs, 'lid'], lagspike: [...machineLegs, 'spikes'],
  medic: TACTICAL_PARTS, breacher: [...TACTICAL_PARTS, 'shield'],
  carrier: ['torso', 'wingL', 'wingR', 'tail'], turret: TACTICAL_PARTS,
  packleader: TACTICAL_PARTS, smoker: TACTICAL_PARTS, rubberbander: TACTICAL_PARTS,
  sapper: TACTICAL_PARTS, parry: TACTICAL_PARTS, aimbot: TACTICAL_PARTS, ragequit: TACTICAL_PARTS,
  moderator: ['torso', 'head', 'wingL', 'wingR', 'tail'],
} as const satisfies Record<TacticalKind, readonly FigurePartName[]>;

/**
 * Nodes inside a part that the game reaches while it plays (enemies/model.ts
 * `ModelNodes`): the carrier's payload (hidden once it is dropped), the
 * aimbot's vent (opens), the moderator's ring (turns and grows) and the
 * ragequit's cleaver (a weapon, so no hit surface). Each stays a node of its
 * own in the merged part, its meshes merged inside it.
 */
export const TACTICAL_NODES = ['equipment-carrier', 'aimbot-vent', 'equipment-moderator', 'heavy-melee'] as const;
export type TacticalNode = (typeof TACTICAL_NODES)[number];
/**
 * Pivots whose parts cast no shadow: the arms and the blob's and flyer's
 * small parts. A figure's shadow comes from its body, head and legs, a few
 * large meshes, so every shadow map draws a humanoid in 7 calls, not 11.
 */
const SHADOWLESS: ReadonlySet<string> = new Set(['upperL', 'upperR', 'foreL', 'foreR', 'cap', 'fuse', 'spark', 'spikes', 'tail']);

/** Merged parts by `<kind>__<part>` (the view hands as `player__viewhandL`, `player__viewhandR`). */
const merged = new Map<string, Group>();
/** Every merged part under one root, for the renderer's warm-up (`tacticalTemplate`). Never drawn in play. */
let template: Group | null = null;
let loading: Promise<void> | null = null;

/** One immutable asset source for the page lifetime, including StrictMode remounts. */
export function loadTacticalModels(): Promise<void> {
  return loading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/tactical.glb').then(gltf => {
    for (const [kind, parts] of Object.entries(TACTICAL_MODELS)) {
      for (const part of parts) {
        if (!gltf.scene.getObjectByName(`${kind}__${part}-surface`)) {
          throw new Error(`Tactical asset is missing ${kind}/${part}`);
        }
      }
      if (kind !== 'player' && !gltf.scene.getObjectByName(`${kind}__clown-mask-${kind}`)) {
        throw new Error(`Tactical asset is missing ${kind}'s mask`);
      }
    }
    for (const side of ['L', 'R']) {
      if (!gltf.scene.getObjectByName(`player__viewhand${side}-surface`)) {
        throw new Error(`Tactical asset is missing viewhand${side}`);
      }
    }
    // Merged once here, so a spawn uploads and builds nothing.
    gltf.scene.updateMatrixWorld(true);
    const root = new Group();
    const parts: [string, string][] = Object.entries(TACTICAL_MODELS).flatMap(([kind, names]) => names.map((part): [string, string] => [kind, part]));
    parts.push(['player', 'viewhandL'], ['player', 'viewhandR']);
    for (const [kind, part] of parts) {
      const surface = gltf.scene.getObjectByName(`${kind}__${part}-surface`)!;
      const made = mergePart(surface, `${part}-surface`, !SHADOWLESS.has(part));
      merged.set(`${kind}__${part}`, made);
      root.add(made);
    }
    // The file's own geometry was never uploaded; only the merged copies are kept.
    gltf.scene.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    template = root;
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
}

/** Every merged part, for the renderer to compile and draw the characters' programs ahead of a match (`Renderer.prewarm`); null until loaded. */
export function tacticalTemplate(): Object3D | null {
  return template;
}

/**
 * A rigid part for the figure's pivot of that name. Geometry and material
 * are page-level: only the node tree is per instance, so a spawn uploads
 * nothing (the figure puts its own copy of the material on, `makeFigure`).
 */
export function tacticalPart(kind: TacticalKind, part: string): Object3D {
  const source = merged.get(`${kind}__${part}`);
  if (!source) throw new Error(`Load tactical models before creating ${kind}/${part}`);
  return source.clone(true);
}

const _matrix = new Matrix4();
const _normalMatrix = new Matrix3();
const _vertex = new Vector3();

/**
 * One part of the file (`<kind>__<part>-surface`, a tree of batches by
 * material) as the game draws it (V12): every mesh merged into one, in the
 * surface's space, with its material's factors in vertex attributes (see
 * materials.ts `characterMat`), and each `TACTICAL_NODES` node as a child
 * of its own with its meshes merged likewise. A humanoid is then 11 draws,
 * not about 50, and every figure shares one program.
 */
function mergePart(surface: Object3D, name: string, castShadow: boolean): Group {
  const root = new Group();
  root.name = name;
  const owners = new Map<Object3D, Mesh[]>([[surface, []]]);
  surface.traverse(object => {
    if (!(object instanceof Mesh)) return;
    let owner: Object3D = surface;
    for (let node: Object3D | null = object; node && node !== surface; node = node.parent) {
      if ((TACTICAL_NODES as readonly string[]).includes(baseName(node))) { owner = node; break; }
    }
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner)!.push(object);
  });
  for (const [owner, meshes] of owners) {
    let holder: Object3D = root;
    if (owner !== surface) {
      holder = new Group();
      holder.name = baseName(owner);
      _matrix.copy(surface.matrixWorld).invert().multiply(owner.matrixWorld).decompose(holder.position, holder.quaternion, holder.scale);
      root.add(holder);
    }
    const geometry = mergeMeshes(meshes, _matrix.copy(owner.matrixWorld).invert());
    if (!geometry) continue;
    const mesh = new Mesh(geometry, characterMat());
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    holder.add(mesh);
  }
  return root;
}

/** A node's name in the file without its `<kind>__` prefix and exporter suffix. */
function baseName(node: Object3D): string {
  const name = typeof node.userData.name === 'string' ? node.userData.name : node.name;
  return name.replace(/^[a-z]+__/, '').replace(/\.\d+$/, '');
}

/** `meshes` in the space `inverse` maps world to, as one indexed geometry with `color` and `pbr`; null for none. */
function mergeMeshes(meshes: readonly Mesh[], inverse: Matrix4): BufferGeometry | null {
  let vertices = 0, indices = 0;
  for (const { geometry } of meshes) {
    vertices += geometry.attributes.position!.count;
    indices += geometry.index?.count ?? geometry.attributes.position!.count;
  }
  if (indices === 0) return null;
  const position = new Float32Array(3 * vertices), normal = new Float32Array(3 * vertices), color = new Float32Array(3 * vertices);
  const pbr = new Uint8Array(4 * vertices);
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, i = 0;
  for (const mesh of meshes) {
    const { geometry } = mesh, material = mesh.material;
    if (!(material instanceof MeshStandardMaterial)) throw new Error(`tactical: ${mesh.name} is not a PBR material`);
    const source = geometry.attributes.position!, normals = geometry.attributes.normal!;
    const matrix = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    _normalMatrix.getNormalMatrix(matrix);
    const glow = material.emissiveIntensity * Math.max(material.emissive.r, material.emissive.g, material.emissive.b)
      / Math.max(1e-3, material.color.r, material.color.g, material.color.b);
    const factors = [material.roughness, material.metalness, Math.min(1, glow / CHARACTER_GLOW), material.name === 'player-mark' ? 1 : 0]
      .map(value => Math.round(Math.min(1, Math.max(0, value)) * 255));
    for (let k = 0; k < source.count; k++) {
      _vertex.fromBufferAttribute(source, k).applyMatrix4(matrix).toArray(position, 3 * (v + k));
      _vertex.fromBufferAttribute(normals, k).applyMatrix3(_normalMatrix).normalize().toArray(normal, 3 * (v + k));
      material.color.toArray(color, 3 * (v + k));
      pbr.set(factors, 4 * (v + k));
    }
    // A mirroring transform turns the faces over; wind them back so they face as authored.
    const flip = matrix.determinant() < 0;
    const count = geometry.index?.count ?? source.count;
    for (let k = 0; k < count; k++) {
      const corner = flip && k % 3 !== 0 ? k + (k % 3 === 1 ? 1 : -1) : k;
      index[i + k] = v + (geometry.index ? geometry.index.getX(corner) : corner);
    }
    v += source.count;
    i += count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('pbr', new BufferAttribute(pbr, 4, true));
  geometry.setIndex(new BufferAttribute(index, 1));
  // One GPU buffer set per part, shared by every instance: disposers skip it.
  geometry.userData.shared = true;
  return geometry;
}

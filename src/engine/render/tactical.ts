import { Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { EnemyKind } from '../types';
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

let source: Group | null = null;
let loading: Promise<void> | null = null;
const markings = new Map<number, MeshStandardMaterial>();

/** One immutable asset source for the page lifetime, including StrictMode remounts. */
export function loadTacticalModels(): Promise<void> {
  return loading ??= new GLTFLoader().loadAsync('/models/tactical.glb').then(gltf => {
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
    source = gltf.scene;
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
}

/** Rigid garment sections fit the existing animated pivots. Geometry is instance-owned
 * because figure/debris disposal releases it; materials stay in the page-level cache. */
export function tacticalPart(kind: TacticalKind, part: string, color?: number): Object3D {
  const template = source?.getObjectByName(`${kind}__${part}-surface`);
  if (!template) throw new Error(`Load tactical models before creating ${kind}/${part}`);
  const root = template.clone(true);
  root.traverse(object => {
    const name = typeof object.userData.name === 'string' ? object.userData.name : object.name;
    object.name = name.replace(`${kind}__`, '').replace(/\.\d+$/, '');
    if (!(object instanceof Mesh)) return;
    object.geometry = object.geometry.clone();
    object.castShadow = object.receiveShadow = true;
    if (color !== undefined && object.material instanceof MeshStandardMaterial && object.material.name === 'player-mark') {
      let material = markings.get(color);
      if (!material) {
        material = object.material.clone();
        material.color.setHex(color);
        markings.set(color, material);
      }
      object.material = material;
    }
  });
  return root;
}

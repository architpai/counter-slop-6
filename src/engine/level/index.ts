import * as THREE from 'three';
import { World } from '../physics';
import type { Level, LevelDressing, LevelKey } from '../types';
import type { DressMap } from './dressing';
import { LevelBuilder } from './build';
import { buildDowntown } from './downtown';
import { buildMexico } from './mexico';
import { buildHouse } from './house';
import { buildTraining } from './training';
import { assignBossPerch } from './boss-perch';
import { dressDowntown } from './downtown-dressing';
import { dressHouse } from './house-dressing';
import { dressMexico } from './mexico-dressing';

/** One row of the map picker. */
export interface LevelEntry {
  key: LevelKey;
  name: string;
  blurb: string;
}

export interface LevelOpts {
  arena?: boolean;
}

export const LEVELS: LevelEntry[] = [
  { key: 'downtown', name: 'DOWNTOWN', blurb: 'streets, rooftops and fire escapes' },
  { key: 'house', name: 'THE HOUSE', blurb: 'a suburban home · basement to rooftop' },
  { key: 'mexico', name: 'MEXICO', blurb: 'a sun-baked plaza · piñatas, tacos and mariachi' },
];

export function validKey(key: unknown): LevelKey {
  const entry = LEVELS.find(level => level.key === key);
  return entry ? entry.key : 'downtown';
}

export function buildLevel(scene: THREE.Scene, world: World, key: unknown = 'downtown',
  opts: LevelOpts | null = {}): Level {
  const builder = new LevelBuilder(scene, world, key === 'training' ? 'training' : validKey(key), opts?.arena === true);
  if (builder.level.key === 'training') buildTraining(builder);
  else if (builder.level.key === 'house') buildHouse(builder);
  else if (builder.level.key === 'mexico') buildMexico(builder);
  else buildDowntown(builder);
  // The realistic tiers' detail (R6): visual only, built after the colliders it reads. Its trim is level geometry and
  // baked, so every tier builds it (a match may switch to a realistic tier without a rebuild; Low never draws it); its
  // kit props, cables and decals are made the first time a realistic look reads `level.dressing`.
  const dress = DRESS[builder.level.key];
  dress?.(builder, 'trim');
  const level = builder.finish();
  assignBossPerch(level);
  if (dress) {
    // The colliders as built: play removes some (breakables) and adds others (charges), and the dressing reads the map.
    let make: (() => LevelDressing) | null = (built => () => dress(builder, 'props', collidersOf(built)))(world.boxes.slice());
    let made: LevelDressing | null = null;
    Object.defineProperty(level, 'dressing', {
      enumerable: true,
      get: (): LevelDressing | null => {
        if (make) {
          made = make();
          make = null;
        }
        return made;
      },
    });
  }
  return level;
}

const DRESS: Partial<Record<LevelKey, DressMap>> = { downtown: dressDowntown, house: dressHouse, mexico: dressMexico };

/** A world of these colliders alone, for the dressing's scans. */
function collidersOf(boxes: World['boxes']): World {
  const world = new World();
  for (const box of boxes) world.addBox(box.min, box.max, box.data);
  world.finalize();
  return world;
}

/** Duck-typed like the rest of three: meshes, lines and points all carry geometry. */
function hasGeometry(node: THREE.Object3D): node is THREE.Object3D & { geometry: THREE.BufferGeometry } {
  return 'geometry' in node && node.geometry instanceof THREE.BufferGeometry;
}

export function disposeLevel(scene: THREE.Scene, level: Level | null | undefined): void {
  if (!level) return;
  const disposed = new Set<THREE.BufferGeometry>();
  for (const object of level.meshes) {
    scene.remove(object);
    // Name plaques own canvas textures as well as geometry.
    if (typeof object.userData.dispose === 'function') { object.userData.dispose(); continue; }
    object.traverse(child => {
      if (hasGeometry(child) && !disposed.has(child.geometry)) {
        disposed.add(child.geometry);
        child.geometry.dispose();
      }
    });
  }
  level.meshes.length = 0;
  level.surfaces.length = 0;
  level.animated.length = 0;
  level.movers.length = 0;
}

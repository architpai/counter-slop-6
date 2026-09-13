import * as THREE from 'three';
import type { World } from '../physics';
import type { Level, LevelKey } from '../types';
import { LevelBuilder } from './build';
import { buildDowntown } from './downtown';
import { buildMexico } from './mexico';
import { buildHouse } from './house';

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
  const builder = new LevelBuilder(scene, world, validKey(key), opts?.arena === true);
  if (builder.level.key === 'house') buildHouse(builder);
  else if (builder.level.key === 'mexico') buildMexico(builder);
  else buildDowntown(builder);
  return builder.finish();
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
    object.traverse(child => {
      if (hasGeometry(child) && !disposed.has(child.geometry)) {
        disposed.add(child.geometry);
        child.geometry.dispose();
      }
    });
  }
  level.meshes.length = 0;
  level.animated.length = 0;
  level.movers.length = 0;
}

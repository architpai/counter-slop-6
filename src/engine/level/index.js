import { LevelBuilder } from './build';
import { buildDowntown } from './downtown';

export const MEXICO_READY = false;
export const LEVELS = [
  { key: 'downtown', name: 'DOWNTOWN', blurb: 'streets, rooftops and fire escapes' },
];

export function validKey(key) {
  return LEVELS.some(level => level.key === key) ? key : 'downtown';
}

export function buildLevel(scene, world, key = 'downtown', opts = {}) {
  const builder = new LevelBuilder(scene, world, validKey(key), opts?.arena === true);
  buildDowntown(builder);
  return builder.finish();
}

export function disposeLevel(scene, level) {
  if (!level) return;
  const disposed = new Set();
  for (const object of level.meshes) {
    scene.remove(object);
    object.traverse(child => {
      if (child.geometry && !disposed.has(child.geometry)) {
        disposed.add(child.geometry);
        child.geometry.dispose();
      }
    });
  }
  level.meshes.length = 0;
  level.animated.length = 0;
  level.movers.length = 0;
}

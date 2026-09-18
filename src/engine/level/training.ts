import { Vector3 } from 'three';
import { TYPES } from '../enemies/types';
import { makeNameTag } from '../render/figure';
import type { EnemyKind } from '../types';
import type { LevelBuilder } from './build';

const original: EnemyKind[] = ['grunt', 'rusher', 'heavy', 'sniper', 'shield', 'bomber', 'flyer', 'boss', 'hitbox', 'lagspike'];
export const TRAINING_TYPES = [...original, ...(Object.keys(TYPES) as EnemyKind[]).filter(type => !original.includes(type))];

/** One open firing line; leave space behind the targets for model inspection. */
export function buildTraining(b: LevelBuilder): void {
  b.level.bounds = { minX: -38, maxX: 38, minZ: -32, maxZ: 38 };
  b.level.playerStart.set(0, 0, 10);
  b.level.shadow = { center: new Vector3(0, 0, 2), radius: 53 };
  b.level.mood = { horizon: 0xc7d7dc, zenith: 0x789baa, fog: 0xc7d7dc };
  b.box(0, -1, 3, 76, 1, 70, { mat: 'paving' });
  b.box(0, 0, -31, 76, 8, 1, { mat: 'dark' });
  for (const x of [-37.5, 37.5]) b.box(x, 0, 3, 1, 3, 70, { mat: 'block' });
  b.box(0, 0, 37.5, 76, 3, 1, { mat: 'block' });

  const label = (text: string, x: number, z: number, width = 4): void => {
    const tag = makeNameTag(text);
    tag.position.set(x, 0.025, z);
    tag.rotation.x = -Math.PI / 2;
    tag.scale.set(width, 3, 1);
    b.addObject(tag);
  };
  TRAINING_TYPES.forEach((type, i) => {
    // Extra display rows fit the existing floor; walls, stairs and collision geometry stay unchanged.
    const x = (i % 10 - 4.5) * 6, z = -20 + Math.floor(i / 10) * 12;
    b.marker('spawns', x, TYPES[type].flying ? 1.3 : 0, z);
    b.box(x, 0.003, z, 4, 0.012, 3, { mat: 'metal', noCollide: true });
    label(TYPES[type].name, x, z + 2.5);
    if (i < 10) b.box(x - 3, 0.003, -4, 0.035, 0.008, 28, { mat: 'metal', noCollide: true });
  });
  for (const distance of [5, 10, 20, 30, 40, 50]) {
    const z = -20 + distance;
    b.box(0, 0.004, z, 68, 0.012, 0.05, { mat: 'accent', noCollide: true });
    label(`${distance} M`, 34, z, 3);
  }
  // A connected stair/platform pair for movement, mantle and grapple practice.
  b.stairs(-32, 0, 12, '+z', 14, 3, { mat: 'blockAlt' });
  b.slab(-35, 18.3, -29, 24, 4, 4, { mat: 'blockAlt' });
  b.ring(-32, 8, 22);
  b.box(32, 0, 19, 3, 1, 2, { mat: 'metal' });
  b.box(32, 0, 24, 3, 2, 2, { mat: 'block' });
}

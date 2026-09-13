import type { EnemyKind } from '../types';

export const ROSTER: ReadonlyArray<readonly [EnemyKind, number, number]> = [
  ['grunt', 1, 10], ['rusher', 2, 6], ['bomber', 3, 3], ['sniper', 3, 4], ['flyer', 4, 4], ['heavy', 5, 4], ['shield', 6, 4],
  ['medic', 7, 2], ['breacher', 9, 3], ['carrier', 12, 2], ['packleader', 14, 2], ['smoker', 17, 2],
  ['parry', 19, 3], ['rubberbander', 22, 4], ['sapper', 27, 2],
];
export const MUTATIONS: readonly { type: EnemyKind; label: string }[] = [
  { type: 'grunt', label: 'RECRUITS: FIVE-SHOT BURSTS · longer recovery' },
  { type: 'rusher', label: 'RUSHERS: PINCER ATTACK · paired approaches' },
  { type: 'flyer', label: 'DRONES: BOMB CARRIERS · shoot before delivery' },
  { type: 'shield', label: 'SHIELDS: MOBILE COVER · recruits follow behind' },
];
export function mutationCount(wave: number): number {
  return Math.max(0, Math.min(MUTATIONS.length, Math.floor((wave - 31) / 5) + 1));
}

/** Search each queued draw once. Capped draws stay queued until a slot becomes free. */
export function nextSpawn(queue: string[], allowed: (type: string) => boolean): string | undefined {
  const index = queue.findIndex(allowed);
  return index < 0 ? undefined : queue.splice(index, 1)[0];
}

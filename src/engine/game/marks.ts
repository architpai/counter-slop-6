import type { Vector3 } from 'three';

/** A squad mark lasts this long, in seconds. */
export const MARK_TTL = 15;
/** How far the aim ray looks for a point to mark, in metres. */
export const MARK_RANGE = 150;
/** The least time between two marks from one player, in seconds. */
export const MARK_GAP = 0.75;

export interface Mark { name: string; pos: Vector3; until: number }

/** One mark per player: a new one takes the place of that player's last. */
export function placeMark(marks: Map<string, Mark>, id: string, name: string, pos: Vector3, now: number): void {
  marks.set(id, { name, pos: pos.clone(), until: now + MARK_TTL });
}

/** Removes the marks whose time ran out. */
export function pruneMarks(marks: Map<string, Mark>, now: number): void {
  for (const [id, m] of marks) if (m.until <= now) marks.delete(id);
}

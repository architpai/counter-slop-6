import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { MARK_TTL, placeMark, pruneMarks, type Mark } from '@/engine/game/marks';

test('a new mark takes the place of the same player\'s last; marks run out after the TTL', () => {
  const marks = new Map<string, Mark>(), at = new Vector3(1, 2, 3);
  placeMark(marks, 'a', 'A', at, 0);
  at.set(9, 9, 9); // stored as a copy
  placeMark(marks, 'b', 'B', new Vector3(), 5);
  expect(marks.get('a')?.pos.toArray()).toEqual([1, 2, 3]);
  placeMark(marks, 'a', 'A', new Vector3(4, 0, 0), 6);
  expect(marks.size).toBe(2);
  expect(marks.get('a')?.pos.x).toBe(4);
  pruneMarks(marks, 5 + MARK_TTL);
  expect([...marks.keys()]).toEqual(['a']);
  pruneMarks(marks, 6 + MARK_TTL);
  expect(marks.size).toBe(0);
});

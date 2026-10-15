import { expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { showStragglers, stragglerMark } from '@/engine/game/stragglers';

test('stragglers show on boss waves with the boss down and fewer than ten left, on other waves at five left', () => {
  expect(showStragglers(5, 9, false)).toBe(true);
  expect(showStragglers(5, 10, false)).toBe(false);
  expect(showStragglers(5, 9, true)).toBe(false);
  expect(showStragglers(5, 0, false)).toBe(false);
  expect(showStragglers(4, 5, false)).toBe(true);
  expect(showStragglers(4, 6, false)).toBe(false);
  expect(showStragglers(4, 0, false)).toBe(false);
});

test('a marker sits on a visible enemy and on the near screen edge for one off screen or behind', () => {
  const w = 1000, h = 500;
  expect(stragglerMark(0, 0, false, w, h)).toEqual({ x: 500, y: 250, a: Math.PI / 2 });
  const right = stragglerMark(3, 0, false, w, h);
  expect(right.x).toBeCloseTo(w - 28); expect(right.y).toBeCloseTo(250); expect(right.a).toBeCloseTo(0);

  // Looking down -z; an enemy behind and to the left must point left, not right.
  const camera = new PerspectiveCamera(70, w / h, 0.1, 500);
  camera.updateMatrixWorld();
  const p = new Vector3(-5, 0, 10).applyMatrix4(camera.matrixWorldInverse);
  const behind = p.z > 0;
  p.applyMatrix4(camera.projectionMatrix);
  const back = stragglerMark(p.x, p.y, behind, w, h);
  expect(behind).toBe(true);
  expect(back.x).toBeCloseTo(28);
  expect(Math.abs(back.a)).toBeCloseTo(Math.PI);
});

test('an enemy right behind and above still goes to a side edge, not the top', () => {
  const mark = stragglerMark(-0.01, -3, true, 1000, 500);
  expect(mark.x).toBeCloseTo(1000 - 28);
  expect(mark.y).toBeGreaterThan(28);
});

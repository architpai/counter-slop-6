/** Fewer enemies than this, with the boss down, and the rest of a boss wave is marked on screen. */
export const STRAGGLERS = 10;

/** Boss waves only (every fifth): once no boss is alive or queued and few enemies are left. */
export const showStragglers = (wave: number, left: number, boss: boolean): boolean =>
  wave > 0 && wave % 5 === 0 && !boss && left > 0 && left < STRAGGLERS;

/** A marker in CSS pixels; `a` turns the arrow, which points along +x. */
export interface StragglerMark { x: number; y: number; a: number }

/**
 * Where to draw the marker for a point at normalized device `x`, `y` (y up). On screen it sits on
 * the point, pointing down. Off screen it goes to the screen edge toward the point; behind the camera, to
 * the left or right edge.
 */
export function stragglerMark(x: number, y: number, behind: boolean, w: number, h: number, pad = 28): StragglerMark {
  if (!behind && Math.abs(x) <= 1 && Math.abs(y) <= 1) return { x: (x * 0.5 + 0.5) * w, y: (-y * 0.5 + 0.5) * h, a: Math.PI / 2 };
  // Behind the camera the projection comes out mirrored through the centre.
  let dx = (behind ? -x : x) * w / 2, dy = (behind ? y : -y) * h / 2;
  // Behind goes to the side edge it is nearer to: it says which way to turn.
  if (behind) { dx = (dx < 0 ? -1 : 1) * Math.max(Math.abs(dx), w); dy = Math.max(-(h / 2 - pad), Math.min(h / 2 - pad, dy)); }
  else if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const s = Math.min((w / 2 - pad) / Math.max(Math.abs(dx), 1e-6), (h / 2 - pad) / Math.max(Math.abs(dy), 1e-6));
  dx *= s; dy *= s;
  return { x: w / 2 + dx, y: h / 2 + dy, a: Math.atan2(dy, dx) };
}

export const CONTROL_IDS = ['move', 'fire', 'fire-left', 'aim', 'grapple', 'jump', 'slide', 'reload', 'weapon'] as const;
export type ControlId = typeof CONTROL_IDS[number];
export type ControlPlacement = { x: number; y: number; size: number; opacity: number };
export type TouchLayout = {
  version: 1;
  preset: 'thumbs' | 'claw';
  secondFire: boolean;
  controls: Record<ControlId, ControlPlacement>;
};

const STORAGE_KEY = 'cs6_touch_layout';
const THUMBS: TouchLayout['controls'] = {
  move: { x: .11, y: .72, size: 112, opacity: 1 },
  fire: { x: .88, y: .61, size: 82, opacity: 1 },
  'fire-left': { x: .08, y: .23, size: 68, opacity: 1 },
  aim: { x: .92, y: .34, size: 58, opacity: 1 },
  grapple: { x: .74, y: .43, size: 70, opacity: 1 },
  jump: { x: .94, y: .86, size: 58, opacity: 1 },
  slide: { x: .82, y: .87, size: 58, opacity: 1 },
  reload: { x: .68, y: .87, size: 50, opacity: 1 },
  // The centre is clamped inward by fitControl, keeping the bottom edge at zero.
  weapon: { x: .47, y: 1, size: 158, opacity: 1 },
};
const CLAW: TouchLayout['controls'] = {
  ...THUMBS,
  fire: { x: .87, y: .62, size: 64, opacity: .6 },
  aim: { x: .93, y: .24, size: 58, opacity: 1 },
  grapple: { x: .8, y: .22, size: 70, opacity: 1 },
};

export function presetLayout(preset: TouchLayout['preset']): TouchLayout {
  const defaults = preset === 'claw' ? CLAW : THUMBS;
  return {
    version: 1, preset, secondFire: preset === 'claw',
    controls: Object.fromEntries(CONTROL_IDS.map(id => [id, { ...defaults[id] }])) as TouchLayout['controls'],
  };
}

const inRange = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;

function validPlacement(value: unknown): value is ControlPlacement {
  if (!value || typeof value !== 'object') return false;
  const p = value as ControlPlacement;
  return inRange(p.x, 0, 1) && inRange(p.y, 0, 1)
    && inRange(p.size, 44, 160) && inRange(p.opacity, .25, 1);
}

function validLayout(value: unknown): value is TouchLayout {
  if (!value || typeof value !== 'object') return false;
  const layout = value as TouchLayout;
  return layout.version === 1 && (layout.preset === 'thumbs' || layout.preset === 'claw')
    && typeof layout.secondFire === 'boolean' && !!layout.controls
    && CONTROL_IDS.every(id => validPlacement(layout.controls[id]));
}

export function loadTouchLayout(): TouchLayout {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (validLayout(value)) return value;
  } catch { /* Storage can be denied, or the saved JSON can be invalid. */ }
  return presetLayout('thumbs');
}

/** Invalid complete layouts are replaced, not partly merged with old controls. */
export function saveTouchLayout(layout: TouchLayout): boolean {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(validLayout(layout) ? layout : presetLayout('thumbs')));
    return true;
  } catch { return false; }
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Returns CSS-pixel centres within an already inset safe area. The caller owns
 * safe-area insets. A usable area needs at least 96px on each axis (44px + Pause).
 * Custom controls may overlap each other, but never the 52 × 52 Pause region.
 */
export function fitControl(id: ControlId, placement: ControlPlacement, width: number, height: number): {
  x: number; y: number; width: number; height: number;
} {
  width = Number.isFinite(width) ? Math.max(96, width) : 96;
  height = Number.isFinite(height) ? Math.max(96, height) : 96;
  const p = validPlacement(placement) ? placement : THUMBS[id];
  let size = p.size;
  const defaultPosition = [THUMBS[id], CLAW[id]].some(d => d.x === p.x && d.y === p.y && d.size === p.size);
  if (height < 346 && defaultPosition && id !== 'weapon') {
    size = Math.min(size, id === 'move' ? 98 : id === 'fire' ? 70 : id === 'grapple' ? 60 : 50);
  }
  // Cap only when the area cannot hold the requested size outside Pause.
  size = Math.max(44, Math.min(size, width, height, Math.max(width, height) - 52));
  const w = size, h = id === 'weapon' ? 44 : size;
  let x = clamp(p.x * width, w / 2, width - w / 2);
  let y = clamp(p.y * height, h / 2, height - h / 2);
  if (x + w / 2 > width - 52 && y - h / 2 < 52) {
    if (height >= 52 + h) y = 52 + h / 2;
    else x = width - 52 - w / 2;
  }
  return { x, y, width: w, height: h };
}

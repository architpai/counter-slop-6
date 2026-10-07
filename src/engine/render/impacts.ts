import { SURF } from './palette';
import { DEFAULT_MATERIAL, isMaterialTag, resolveMaterial } from './surfaces';
import type { SurfKey } from './palette';
import type { MaterialTag } from './surfaces';

/**
 * What a bullet does to a surface (docs/VISUALS.md, R5 and V10), the pure
 * half: which family a material tag belongs to and the recipe it gets. The
 * effects (effects.ts) spawn it; the level builder (level/build.ts) writes
 * each collider's tag and surface key, so a hit's box says what was hit.
 */
export type SurfaceFamily = 'metal' | 'masonry' | 'wood' | 'glass' | 'soil';
export const SURFACE_FAMILIES: readonly SurfaceFamily[] = ['metal', 'masonry', 'wood', 'glass', 'soil'];

/** The family of every tag: what its bullet hole and debris look like. */
export const SURFACE_FAMILY: Readonly<Record<MaterialTag, SurfaceFamily>> = Object.freeze({
  'painted-metal': 'metal', steel: 'metal', 'tread-plate': 'metal', rust: 'metal', corrugated: 'metal',
  concrete: 'masonry', 'cast-concrete': 'masonry', brick: 'masonry', plaster: 'masonry', stucco: 'masonry', adobe: 'masonry',
  asphalt: 'masonry', 'road-paint': 'masonry', paving: 'masonry', tile: 'masonry', sandstone: 'masonry', terracotta: 'masonry',
  'roof-tile': 'masonry', shingles: 'masonry', plastic: 'masonry',
  wood: 'wood', bark: 'wood', 'painted-wood': 'wood', planks: 'wood', siding: 'wood',
  glass: 'glass',
  sand: 'soil', grass: 'soil', foliage: 'soil', flowers: 'soil', cactus: 'soil', fabric: 'soil', water: 'soil', spray: 'soil',
});

/** Tags that take no bullet hole: water shows the splash only. */
const NO_DECAL: ReadonlySet<MaterialTag> = new Set(['water', 'spray']);

/** The collider fields the level builder fills (types.ts `BoxData`). */
export interface SurfaceData {
  material?: MaterialTag;
  surf?: SurfKey;
  overlays?: readonly SurfaceOverlay[];
}

/**
 * A visible piece with no collider of its own laid on a collider's face: a
 * path on the lawn, paint on a road, a band on a wall. The level builder lists
 * them on the collider (level/build.ts `_listOverlays`); a hit under one is a
 * hit on it.
 */
export interface SurfaceOverlay {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  material: MaterialTag;
  surf: SurfKey;
}

/** An overlay's inner side sits this far into (or off) the face it lies on, and it is at most this thick. */
export const OVERLAY_SUNK = 0.06, OVERLAY_GAP = 0.12, OVERLAY_THICK = 0.25;
const AXES = ['x', 'y', 'z'] as const;

/**
 * What a hit at `point` on a collider's face (`normal`, axis-aligned) shows:
 * the outermost overlay over that spot, or the collider itself, and how far
 * the visible surface stands off the collider's face (0 for the collider).
 */
export function surfaceAt(data: SurfaceData | null | undefined, point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number }): { data: SurfaceData | null | undefined; lift: number } {
  let best: SurfaceOverlay | null = null, lift = 0;
  if (!data?.overlays?.length) return { data, lift };
  const n = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const i = n[0]! >= n[1]! && n[0]! >= n[2]! ? 0 : n[1]! >= n[2]! ? 1 : 2, axis = AXES[i], sign = Math.sign(normal[axis]) || 1;
  const across = AXES.filter(a => a !== axis);
  for (const overlay of data.overlays) {
    if (across.some(a => point[a] < overlay.min[a] - 0.005 || point[a] > overlay.max[a] + 0.005)) continue;
    const inner = ((sign > 0 ? overlay.min[axis] : overlay.max[axis]) - point[axis]) * sign;
    const outer = ((sign > 0 ? overlay.max[axis] : overlay.min[axis]) - point[axis]) * sign;
    if (inner < -OVERLAY_SUNK || inner > OVERLAY_GAP || outer <= lift) continue;
    best = overlay;
    lift = outer;
  }
  return best ? { data: best, lift } : { data, lift: 0 };
}

/**
 * A hit's particle counts (before the effects-detail share), colours as
 * sRGB hex, and its decal. `sparks` are hot metal streaks; `dust` a puff of
 * the surface's own colour; `chips`, `splinters` and `shards` fly out and
 * fall. `hole` is the flat look's disc colour (V10).
 */
export interface Impact {
  tag: MaterialTag;
  family: SurfaceFamily;
  decal: SurfaceFamily | null;
  sparks: number;
  dust: number;
  chips: number;
  splinters: number;
  shards: number;
  /** The surface's own colour: debris, and the decal's tint. */
  color: number;
  /** A greyer dust of it, lighter off a dark surface and darker off a light one, so a puff reads against its own wall. */
  dustColor: number;
  hole: number;
}

const mix = (a: number, b: number, t: number): number => {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 255, cb = (b >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
};

/** The flat look's hole disc per family: dark, but never the blue it used to be on everything. */
const HOLE_DARKEN: Readonly<Record<SurfaceFamily, number>> = { metal: 0.72, masonry: 0.62, wood: 0.7, glass: 0.25, soil: 0.6 };

/** Tags whose hit throws up the earth under them, not their own colour. */
const EARTH: ReadonlySet<MaterialTag> = new Set(['grass', 'foliage', 'flowers']);

/**
 * Dust off a surface: towards a light grey off a dark one, a mid grey-brown
 * off a light one (pale paving, plaster), so a sunlit puff still reads
 * against the surface it rose from; off grass, earth.
 */
function dustOf(tag: MaterialTag, color: number): number {
  if (EARTH.has(tag)) return mix(color, 0x7a6448, 0.6);
  const luma = (0.2126 * ((color >> 16) & 255) + 0.7152 * ((color >> 8) & 255) + 0.0722 * (color & 255)) / 255;
  return luma > 0.55 ? mix(color, 0x6e685e, 0.55) : mix(color, 0xd2cec6, 0.4);
}

/** The tag and surface key of a hit, from its collider; untagged boxes read as concrete. */
export function surfaceOf(data: SurfaceData | null | undefined): { tag: MaterialTag; surf: SurfKey } {
  const surf = data?.surf !== undefined && Object.hasOwn(SURF, data.surf) ? data.surf : 'ground';
  const tag = isMaterialTag(data?.material) ? data.material : DEFAULT_MATERIAL[surf];
  return { tag, surf };
}

/** The impact recipe for a hit on this collider. */
export function impactFor(data: SurfaceData | null | undefined): Impact {
  const { tag, surf } = surfaceOf(data);
  const family = SURFACE_FAMILY[tag];
  const color = resolveMaterial(tag, surf).color;
  const base = { tag, family, decal: NO_DECAL.has(tag) ? null : family, color,
    dustColor: dustOf(tag, color), hole: mix(color, 0x101214, HOLE_DARKEN[family]) };
  switch (family) {
    case 'metal': return { ...base, sparks: 9, dust: 0, chips: 0, splinters: 0, shards: 0 };
    case 'masonry': return { ...base, sparks: 0, dust: 2, chips: 4, splinters: 0, shards: 0 };
    case 'wood': return { ...base, sparks: 0, dust: 1, chips: 0, splinters: 4, shards: 0 };
    case 'glass': return { ...base, sparks: 0, dust: 1, chips: 0, splinters: 0, shards: 5, dustColor: 0xe8eef0 };
    default: return { ...base, sparks: 0, dust: 3, chips: 2, splinters: 0, shards: 0 };
  }
}

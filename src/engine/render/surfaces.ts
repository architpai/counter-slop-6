import * as THREE from 'three';
import { MATERIAL_COLOR, SURF } from './palette';
import manifest from './texture-sets.json';
import type { SurfKey } from './palette';
import type { TextureQuality } from './quality';

/**
 * The realistic tiers' material system (docs/VISUALS.md, R2), the pure half:
 * material tags, what each one wears, UV generation and texture URLs. The GPU
 * half (materials, streaming) is `materials.ts` and `textures.ts`.
 *
 * Every level primitive keeps its flat-palette surface key, which is Low's
 * colour, and carries a material tag, which is what it is made of. Low draws
 * the surface key exactly as before; Medium and up draw the tag as a
 * `MeshStandardMaterial` wearing one of the self-made texture sets
 * (`tools/blender/materials/*.py`), tinted to the tag's colour.
 */

/** One texture set per Blender script in `tools/blender/materials/`. */
export const TEXTURE_SETS = [
  'concrete', 'cast-concrete', 'brick', 'plaster', 'stucco', 'siding', 'asphalt', 'road-paint', 'paving', 'tile',
  'wood', 'planks', 'paint', 'painted-metal', 'steel', 'tread-plate', 'rust', 'corrugated', 'glass', 'sand',
  'sandstone', 'terracotta', 'roof-tile', 'shingles', 'grass', 'fabric', 'foliage', 'water',
] as const;
export type TextureSet = (typeof TEXTURE_SETS)[number];

/** What a level piece is made of. Several tags share a set and differ by colour (palette.ts `MATERIAL_COLOR`). */
export const MATERIAL_TAGS = [
  'concrete', 'cast-concrete', 'brick', 'plaster', 'stucco', 'adobe', 'siding', 'asphalt', 'road-paint', 'paving',
  'tile', 'wood', 'bark', 'painted-wood', 'planks', 'plastic', 'painted-metal', 'steel', 'tread-plate', 'rust',
  'corrugated', 'glass', 'sand', 'sandstone', 'terracotta', 'roof-tile', 'shingles', 'grass', 'fabric', 'foliage',
  'flowers', 'cactus', 'water', 'spray',
] as const;
export type MaterialTag = (typeof MATERIAL_TAGS)[number];

/** The texture set each tag wears. */
export const MATERIAL_SET: Readonly<Record<MaterialTag, TextureSet>> = Object.freeze({
  concrete: 'concrete', 'cast-concrete': 'cast-concrete', brick: 'brick', plaster: 'plaster', stucco: 'stucco',
  adobe: 'stucco', siding: 'siding', asphalt: 'asphalt', 'road-paint': 'road-paint', paving: 'paving', tile: 'tile',
  wood: 'wood', bark: 'wood', 'painted-wood': 'paint', planks: 'planks', plastic: 'paint', 'painted-metal': 'painted-metal',
  steel: 'steel', 'tread-plate': 'tread-plate', rust: 'rust', corrugated: 'corrugated', glass: 'glass', sand: 'sand',
  sandstone: 'sandstone', terracotta: 'terracotta', 'roof-tile': 'roof-tile', shingles: 'shingles', grass: 'grass',
  fabric: 'fabric', foliage: 'foliage', flowers: 'foliage', cactus: 'paint', water: 'water', spray: 'paint',
});

/**
 * The tag a piece wears when its map names none: what that flat-palette key
 * most often stands for. The maps tag everything this would get wrong.
 */
export const DEFAULT_MATERIAL: Readonly<Record<SurfKey, MaterialTag>> = Object.freeze({
  sky: 'plaster', fog: 'plaster', cloud: 'plaster', ground: 'concrete', road: 'asphalt', block: 'plaster',
  blockAlt: 'concrete', blockDeep: 'cast-concrete', roof: 'terracotta', wood: 'wood', metal: 'steel',
  dark: 'painted-metal', accent: 'painted-metal', foliage: 'foliage', water: 'water', hot: 'painted-metal',
  boss: 'painted-metal', lawn: 'grass', siding: 'siding', shingle: 'shingles', plaster: 'plaster', adobe: 'adobe',
  sandstone: 'sandstone', sand: 'sand', paving: 'paving',
});

export const isMaterialTag = (value: unknown): value is MaterialTag => MATERIAL_TAGS.includes(value as MaterialTag);

// --------------------------------------------------------------- the sets

/** Texels per side of every map in a set, per setting (docs/VISUALS.md, Q presets). */
export const TEXTURE_SIZE: Readonly<Record<TextureQuality, TextureSize>> = Object.freeze({ low: 512, medium: 1024, high: 2048 });
export type TextureSize = 512 | 1024 | 2048;
/**
 * Anisotropic filtering per texture size, so per tier (Medium, High, Ultra),
 * capped at the GPU's maximum: grazing ground (roads, Mexico's sand) keeps its
 * detail instead of smearing into the next mip.
 */
export const ANISOTROPY: Readonly<Record<TextureSize, number>> = Object.freeze({ 512: 4, 1024: 8, 2048: 16 });
export const TEXTURE_MAPS = ['albedo', 'normal', 'orm'] as const;
export type TextureMap = (typeof TEXTURE_MAPS)[number];

type Vec3 = readonly [number, number, number];
/** One set's entry in `texture-sets.json`, written by `tools/textures/build.mjs` from the bake. */
export interface SetInfo {
  /** Metres one texture tile covers (the script's `TILE`). */
  tile: number;
  /** Mean albedo, linear RGB: the 1 × 1 stand-in, and the divisor that tints the set to a tag's colour. */
  albedo: Vec3;
  roughness: number;
  metal: number;
  ao: number;
  /** File bytes per size, in `TEXTURE_MAPS` order. */
  bytes: Readonly<Record<`${TextureSize}`, Vec3>>;
}

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
const isUnit = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1;

/** Check `texture-sets.json`: a hand edit that breaks it fails at load, not as black walls. */
export function parseTextureSets(raw: unknown): Record<string, SetInfo> {
  const sets = (typeof raw === 'object' && raw !== null ? (raw as { sets?: unknown }).sets : null) ?? null;
  if (typeof sets !== 'object' || sets === null) throw new Error('malformed texture-sets.json');
  for (const [name, value] of Object.entries(sets as Record<string, unknown>)) {
    const info = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const bytes = (typeof info.bytes === 'object' && info.bytes !== null ? info.bytes : {}) as Record<string, unknown>;
    if (!(typeof info.tile === 'number' && info.tile > 0) || !isVec3(info.albedo) || !info.albedo.every(c => c > 0)
      || !isUnit(info.roughness) || !isUnit(info.metal) || !isUnit(info.ao)
      || !Object.values(TEXTURE_SIZE).every(size => isVec3(bytes[`${size}`]))) throw new Error(`malformed texture-sets.json: ${name}`);
  }
  return sets as Record<string, SetInfo>;
}

const SETS = parseTextureSets(manifest);

export function setInfo(set: TextureSet): SetInfo {
  const info = SETS[set];
  if (info === undefined) throw new Error(`texture set ${set} is missing from texture-sets.json: run tools/textures/build.mjs`);
  return info;
}

/** Where a map lives; `next` exports `public/` at the site root. */
export const textureUrl = (set: TextureSet, size: TextureSize, map: TextureMap): string => `/textures/${size}/${set}-${map}.ktx2`;

/** The sets a map's tags need, once each, in a stable order. */
export function setsFor(tags: Iterable<MaterialTag>): TextureSet[] {
  const sets = new Set<TextureSet>();
  for (const tag of tags) sets.add(MATERIAL_SET[tag]);
  return TEXTURE_SETS.filter(set => sets.has(set));
}

/** What streaming these sets at this size downloads, in bytes. */
export function downloadBytes(sets: Iterable<TextureSet>, size: TextureSize): number {
  let total = 0;
  for (const set of sets) for (const bytes of setInfo(set).bytes[`${size}`]) total += bytes;
  return total;
}

// ----------------------------------------------------------- tag → material

/** What a realistic material needs to know about one (tag, surface) pair. */
export interface RealMaterial {
  /** The cache key: tags with their own colour share one material whatever the surface. */
  key: string;
  tag: MaterialTag;
  set: TextureSet;
  /** The albedo the surface should average to, sRGB hex. */
  color: number;
}

/** The realistic material for a piece: its tag's set, in the tag's colour or, for paint and the like, the surface's. */
export function resolveMaterial(tag: MaterialTag, surf: SurfKey): RealMaterial {
  const own = MATERIAL_COLOR[tag], color = own ?? SURF[surf];
  return { key: own === null ? `${tag}#${color.toString(16).padStart(6, '0')}` : tag, tag, set: MATERIAL_SET[tag], color };
}

// -------------------------------------------------------------------- UVs

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Give a geometry texture coordinates by planar projection, per triangle, in
 * `tile`-metre units of the geometry's own space (world space for merged
 * level pieces). Walls keep v vertical and u along the wall; floors and
 * slopes use u along x. Each face's frame lies in its own plane, so a roof or
 * a ramp is not stretched, and coplanar faces share a frame, so a floor or a
 * wall made of many boxes wears one seamless texture.
 *
 * An indexed geometry keeps its index when every shared vertex gets one
 * coordinate (a box: its faces share no vertices). When faces in different
 * planes share a vertex (a smooth sphere) this writes nothing and returns
 * false; split it into separate triangles (`toNonIndexed`) and call again.
 */
export function planarUVs(geometry: THREE.BufferGeometry, tile: number): boolean {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const corners = index ? index.count : position.count;
  const uv = new Float32Array(position.count * 2);
  const done = new Uint8Array(position.count);
  const scale = 1 / tile;
  for (let i = 0; i + 2 < corners; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    _a.fromBufferAttribute(position, ia);
    _b.fromBufferAttribute(position, ib);
    _c.fromBufferAttribute(position, ic);
    _n.subVectors(_c, _b).cross(_s.subVectors(_a, _b));
    if (_n.lengthSq() < 1e-20) continue;
    _n.normalize();
    if (Math.abs(_n.y) >= Math.max(Math.abs(_n.x), Math.abs(_n.z))) {
      _t.copy(X).addScaledVector(_n, -_n.x).normalize();
      _s.crossVectors(_n, _t);
    } else {
      _s.copy(Y).addScaledVector(_n, -_n.y).normalize();
      _t.crossVectors(_s, _n);
    }
    for (const vertex of [ia, ib, ic]) {
      _a.fromBufferAttribute(position, vertex);
      const u = _a.dot(_t) * scale, v = _a.dot(_s) * scale;
      if (done[vertex] && (Math.abs(uv[2 * vertex]! - u) > 1e-4 || Math.abs(uv[2 * vertex + 1]! - v) > 1e-4)) return false;
      uv[2 * vertex] = u;
      uv[2 * vertex + 1] = v;
      done[vertex] = 1;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return true;
}

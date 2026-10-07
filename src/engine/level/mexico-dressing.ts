import * as THREE from 'three';
import { Dresser } from './dressing';
import { MESAS, ROCK_STACKS } from './mexico';
import { setInfo } from '../render/surfaces';
import type { BuildOpts, LevelBuilder } from './build';
import type { Box6 } from './mexico';
import type { SurfKey } from '../render/palette';
import type { DressMap, Wall } from './dressing';

/**
 * Mexico's realistic-tier dressing (docs/VISUALS.md, R6, V14, V16): the six
 * adobe houses get vigas through their walls under the roof, canales spouting
 * off the plaza side, niches, strings of chillies, tin lanterns and flower
 * pots by their doors and a shop sign over each door, the west row a painted
 * dado and frames round its windows; the church a carved door, niches and a
 * base course; the bandstand and the market stalls hang lanterns, the stalls'
 * ends and the house fronts get jars, sacks and crates of fruit where nobody
 * walks; the plaza wears worn paths, stains, drifted sand and grimy joints;
 * the perimeter's rock stacks get faceted, banded shells (`rockShell`) with
 * loose stones on their ledges; and the stepped box mesas give way to faceted
 * Blender mesas (Low keeps the boxes, level/mexico.ts `MESAS`). Low draws
 * none of it (level/dressing.ts).
 */
/** The houses as level/mexico.ts builds them: x, z, width, depth, height, which way the door faces. */
const HOUSES: readonly (readonly [number, number, number, number, number, 1 | -1])[] = [
  [-40, -20, 11, 9, 6, 1], [-40, -4, 9, 8, 5, 1], [-40, 14, 12, 10, 7.5, 1],
  [40, -18, 12, 9, 7, -1], [40, 0, 9, 8, 5.5, -1], [40, 16, 11, 10, 6.5, -1],
];
/**
 * Each house's dado (the painted band at its foot), in a flat-palette colour (Low never shows it): light
 * paints, as the long views' grunts stand against these walls (the readability guardrail).
 */
const DADO: readonly SurfKey[] = ['adobe', 'water', 'sand', 'adobe', 'water', 'sand'];
const SHOP: readonly string[] = ['tacos', 'farmacia', 'pinatas', 'helados', 'aguas', 'lucha'];
const TILES = ['talavera-blue', 'talavera-yellow'];

export const dressMexico: DressMap = (b, pass, world) => {
  const d = new Dresser(b, 'mexico', 0x3e71c0, pass, world);
  // Stringers down the houses' roof stairs and the bandstand's steps.
  d.stairs();

  HOUSES.forEach(([x, z, w, depth, h, side], n) => {
    const front: Wall = { face: side > 0 ? '+x' : '-x', plane: x + side * w / 2 };
    const back: Wall = { face: side > 0 ? '-x' : '+x', plane: x - side * w / 2 };
    const north: Wall = { face: '-z', plane: z - depth / 2 }, south: Wall = { face: '+z', plane: z + depth / 2 };
    const dado: BuildOpts = { mat: DADO[n]!, material: 'stucco' };
    for (const [wall, a0, a1] of [[front, z - depth / 2, z + depth / 2], [back, z - depth / 2, z + depth / 2],
      [north, x - w / 2, x + w / 2], [south, x - w / 2, x + w / 2]] as const) {
      // The door, windows and their trim are flat-look boxes with no collider, so the facade reads as one solid run.
      // The dado frames the shop front only: the sides and backs close the long views, where grunts stand against them.
      // The east row's fronts face the west side's long views across the plaza: they keep their foot plain (the
      // readability guardrail), as the dado's ledge darkens the wall a grunt is read against there.
      if (wall === front && side > 0) d.facade(wall, a0, a1, 0, h, { plinth: { height: 0.55, opts: dado } });
      for (let a = a0 + 1; a < a1 - 1; a += d.range(2.5, 4)) {
        if (d.random() < 0.3) d.wallDecal(d.pick(['damp', 'cracks', 'moss']), wall, a, d.range(3.2, h - 0.9), 1.8, 1.8, d.range(0.4, 0.7));
      }
    }
    // Vigas under the roof on the back and north faces (the south face has the stair, the front the canales).
    for (const [wall, a0, a1] of [[back, z - depth / 2, z + depth / 2], [north, x - w / 2, x + w / 2]] as const) {
      for (let a = a0 + 0.7; a < a1 - 0.5; a += 0.95) d.onWall('viga', wall, a, h - 0.35, { scale: [1, 1, d.range(0.85, 1.15)] });
    }
    // Two canales off the roof over the plaza, a rust-brown run of leaks under each.
    for (const s of [-1, 1]) {
      const a = z + s * depth * 0.36;
      d.onWall('canal', front, a, h - 0.12);
      d.wallDecal('rust', front, a, h - 1.3, 0.8, 2.2, 0.7);
    }
    // The shop: a sign over the door, a lantern each side, chillies, a niche and a tiled panel.
    d.sign(SHOP[n]!, front, z, 3.05, 2.3, 0.72);
    for (const s of [-1, 1]) d.onWall('lantern', front, z + s * 1.25, 3.0, { out: 0.12 });
    d.onWall('ristra', front, z - 1.05, 2.45, { out: 0.06 });
    d.onWall('niche', front, z + side * depth * 0.32 * (n % 2 ? 1 : -1), 0.95, { scale: 0.9 });
    d.sign(TILES[n % 2]!, front, z - side * depth * 0.32 * (n % 2 ? 1 : -1), 0.72, 0.8, 0.8);
    d.onWall('hanging-pot', north, x + d.range(-2, 2), 2.7);
    // Frames and sills round the flat-look windows either side of the door (level/mexico.ts `houses`), on the west row.
    for (const s of side > 0 ? [-1, 1] : []) {
      const a = z + s * 0.32 * depth;
      d.wallTrim(front, a - 0.67, a + 0.67, 1.46, 1.54, 0.09, { mat: 'wood', material: 'painted-wood' });
      d.wallTrim(front, a - 0.64, a - 0.55, 1.54, 2.72, 0.05, { mat: 'wood', material: 'painted-wood' });
      d.wallTrim(front, a + 0.55, a + 0.64, 1.54, 2.72, 0.05, { mat: 'wood', material: 'painted-wood' });
      d.wallTrim(front, a - 0.64, a + 0.64, 2.72, 2.8, 0.05, { mat: 'wood', material: 'painted-wood' });
    }
  });

  // ---- the church: a carved door under the arch, niches high on the front, a base course and grime
  const church: Wall = { face: '-z', plane: 36 };
  d.facade(church, -12, 12, 0.8, 11, { plinth: { height: 0.6, opts: { mat: 'sandstone', material: 'sandstone' } },
    cornice: { height: 0.45, opts: { mat: 'siding', material: 'stucco', tint: 0xe8e0d0 } }, grime: { base: 0.35, leaks: 0 } });
  d.onWall('door-wood', church, 0, 0.8, { scale: [2.5, 1.75, 1], tint: 0xd8c0a0 });
  for (const x of [-5.5, 5.5]) d.onWall('niche', church, x, 7.4, { scale: 1.6 });
  for (const x of [-8, 8]) d.wallDecal('leaks', church, x, 1.6, 1.8, 1.2, 0.6);
  for (let x = -11; x < 12; x += 2.6) d.wallDecal('leaks', church, x + d.range(-0.5, 0.5), 9.8, 2.2, 2, 0.55);
  for (const [wall, a0, a1] of [[{ face: '-x', plane: -12 }, 36, 52], [{ face: '+x', plane: 12 }, 36, 52]] as const) {
    d.facade(wall, a0, a1, 0, 11, { plinth: { height: 0.6, opts: { mat: 'sandstone', material: 'sandstone' } }, grime: { base: 0.35, leaks: 0 } });
  }

  // ---- lanterns round the bandstand's roof and along the market's awnings
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    d.prop('lantern', 7.2 * Math.cos(a), 5.4, -26 + 7.2 * Math.sin(a));
  }
  for (const [x, z, w, depth] of [[-20, 22, 4.5, 2.4], [-13, 22, 4.5, 2.4], [20, 22, 4.5, 2.4], [13, 22, 4.5, 2.4], [-24, -12, 2.4, 4.5], [26, -8, 2.4, 4.5]] as const) {
    for (const s of [-1, 1]) {
      if (w > depth) d.prop('lantern', x + s * (w / 2 - 0.4), 2.9, z + (depth / 2 + 0.25) * (z > 0 ? -1 : 1));
      else d.prop('lantern', x + (w / 2 + 0.25) * (x > 0 ? -1 : 1), 2.9, z + s * (depth / 2 - 0.4));
    }
  }

  // ---- the plaza: worn paths to the fountain, oil by the cart, grime where wear collects on the paving
  for (const [px, pz, width, length, turn] of [[0, 14, 3, 12, 0], [0, -14, 3, 11, 0], [14, 0, 3, 12, Math.PI / 2], [-14, 0, 3, 12, Math.PI / 2]] as const) {
    d.groundDecal('worn', px, 0.15, pz, width, length, turn, 0.75);
  }
  d.groundDecal('oil', 24.4, 0, 5.4, 1.6, 1.6, 0.4, 0.7);
  // Litter on the sand round the plaza (the paving's slab sits over the sand's walkable top: nothing goes on it).
  for (const [lx, lz] of [[27, 9], [-26, 20.5], [15, 26.5], [-27, -9], [28, -2], [-3, 31], [5, -31], [-17, -31]] as const) {
    d.prop('litter', lx, 0, lz, { yaw: d.range(0, 6), scale: d.range(0.6, 0.9) });
  }
  d.groundDecal('ground', 24, 0, 4, 5, 3.5, 0, 0.6);
  // Gum and dusty footprints along the worn paths, stains and spills round the fountain's rim, the bandstand's steps and
  // the stalls' fronts, drifted sand in the corners, and a few large, faint patches: grouped where wear collects, not
  // an even scatter.
  for (const [px, pz, turn] of [[0, 14, 0], [0, -14, 0], [14, 0, Math.PI / 2], [-14, 0, Math.PI / 2]] as const) {
    for (let t = -5; t <= 5; t += d.range(1.3, 2.2)) {
      d.groundDecal(d.pick(['gum', 'footprints', 'gum', 'stain']), px + Math.sin(turn) * t + d.range(-0.8, 0.8), 0.15, pz - Math.cos(turn) * t + d.range(-0.5, 0.5),
        d.range(0.6, 1.4), d.range(0.8, 1.6), turn, d.range(0.5, 0.75));
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + d.range(-0.3, 0.3);
    d.scatter(7.2 * Math.cos(a), 0.15, 7.2 * Math.sin(a), 1.2, 2, ['stain', 'puddle', 'stain', 'tile-grime'], 0.65);
  }
  d.scatter(0, 0.15, -17.8, 1.8, 4, ['stain', 'gum', 'tile-grime'], 0.6);
  for (const [px, pz] of [[-20, 19.5], [-13, 19.5], [20, 19.5], [13, 19.5], [-21.5, -12], [23.5, -8]] as const) {
    d.scatter(px, 0.15, pz, 1.6, 3, ['stain', 'puddle', 'gum', 'sand-drift'], 0.65);
  }
  for (const [px, pz] of [[-21, -21], [21, -21], [-21, 21], [21, 21]] as const) d.scatter(px, 0.15, pz, 2, 3, ['sand-drift', 'ground'], 0.6);
  for (let i = 0; i < 6; i++) {
    const px = d.range(-20, 20), pz = d.range(-20, 20), size = d.range(3, 4.5);
    if (Math.hypot(px, pz) < 7 + size / 2) continue;
    d.groundDecal(d.pick(['ground', 'sand-drift', 'stain']), px, 0.15, pz, size, size * d.range(0.8, 1.2), d.range(0, 6), d.range(0.2, 0.3));
  }
  // Sand blown in against the plaza's terracotta border, and dirt round the fountain's foot.
  for (const side of [-1, 1]) {
    for (let a = -21; a <= 21; a += 3.5) {
      d.groundDecal('sand-drift', side * 22.6, 0.15, a + d.range(-0.5, 0.5), 1.6, 3.2, 0, d.range(0.55, 0.8));
      d.groundDecal('sand-drift', a + d.range(-0.5, 0.5), 0.15, side * 22.6, 1.6, 3.2, Math.PI / 2, d.range(0.55, 0.8));
    }
  }
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8;
    d.groundDecal('edge-dirt', 6.05 * Math.cos(a), 0.15, 6.05 * Math.sin(a), 2.4, 0.9, -Math.PI / 2 - a, 0.6);
  }
  // Dirt along the houses' feet, and sand against the west row's (the east row's fronts close the west side's long
  // views: their feet stay as the flat look's, bar the dirt, docs/VISUALS.md, readability).
  for (const [x, z, w, depth, , side] of HOUSES) {
    const fx = x + side * (w / 2 + 0.45);
    d.footDirt({ face: side > 0 ? '+x' : '-x', plane: x + side * w / 2 }, z - depth / 2, z + depth / 2, 0, 0.7);
    for (let a = z - depth / 2 + 0.8; a < z + depth / 2 && side > 0; a += 2.2) {
      if (d.random() < 0.6) d.groundDecal('sand-drift', fx + side * d.range(0.3, 1.2), 0, a + d.range(-0.5, 0.5), 2, 2, d.range(0, 6), 0.6);
    }
  }

  // ---- the market's stall ends and the house fronts: jars, sacks and crates of fruit where nobody walks
  const fruit = [0xffffff, 0x9ac040, 0xe8c040];
  for (const [x, z, w, depth] of [[-20, 22, 4.5, 2.4], [-13, 22, 4.5, 2.4], [20, 22, 4.5, 2.4], [13, 22, 4.5, 2.4], [-24, -12, 2.4, 4.5], [26, -8, 2.4, 4.5]] as const) {
    let placed = 0;
    for (const [ox, oz] of [[w / 2 + 0.35, 0], [-(w / 2 + 0.35), 0], [0, depth / 2 + 0.3], [0, -(depth / 2 + 0.3)],
      [w / 2 + 0.3, depth / 2 - 0.3], [-(w / 2 + 0.3), -(depth / 2 - 0.3)]] as const) {
      const piece = d.pick(['sacks', 'produce', 'olla', 'produce']), yaw = Math.abs(ox) > 0 ? Math.PI / 2 : 0;
      if (placed < 2 && d.propIfClear(piece, x + ox, 0, z + oz, { yaw, tint: piece === 'produce' ? d.pick(fruit) : 0xffffff })) placed++;
    }
  }
  for (const [x, z, w, depth, , side] of HOUSES) {
    for (const s of [-1, 1]) {
      for (const out of [0.32, 0.4]) {
        if (d.propIfClear(d.pick(['olla', 'pot']), x + side * (w / 2 + out), 0, z + s * (depth / 2 - 0.6), { yaw: d.range(0, 6) })) break;
      }
    }
  }

  // ---- the perimeter's rock stacks: faceted, banded shells over their colliders (`rockShell`)
  ROCK_STACKS.forEach((stack, i) => {
    const bands = strata(d.fork(0x5a17 + i));
    if (d.pass === 'trim') {
      const faces: ShellFace[] = [];
      for (const tier of stack) rockShell(faces, tier, bands, 0x9e37 * (i + 1));
      addShells(b, faces);
    }
    // Loose stones on the ledges and at the foot, scattered, flat enough to walk over; stains down the sand at the foot.
    for (const [x, y, z, w, h, depth] of stack) {
      for (let k = Math.round(d.range(1, 4)); k > 0; k--) {
        const size = d.range(0.7, 1.3);
        d.prop('pebbles', x + d.range(-0.4, 0.4) * w, y + h, z + d.range(-0.4, 0.4) * depth, { yaw: d.range(0, 6), scale: [size, Math.min(size, 1.2), size] });
      }
    }
    const [x, , z, w, , depth] = stack[0]!, alongX = Math.abs(z) > Math.abs(x), inward = -Math.sign(alongX ? z : x);
    for (let k = 0; k < 5; k++) {
      const along = d.range(-0.45, 0.45) * (alongX ? w : depth), out = (alongX ? depth : w) / 2 + d.range(0.4, 2.5);
      const [px, pz] = alongX ? [x + along, z + inward * out] : [x + inward * out, z + along];
      const size = d.range(0.8, 1.4);
      if (k < 3) d.prop('pebbles', px, 0, pz, { yaw: d.range(0, 6), scale: [size, Math.min(size, 1.2), size] });
      d.groundDecal(d.pick(['dirt', 'ground', 'sand-drift']), px, 0, pz, d.range(2, 4), d.range(2, 4), d.range(0, 6), d.range(0.4, 0.6));
    }
  });

  // ---- the backdrop (V14): faceted buttes where the flat look's stepped boxes stand
  // Each butte's modelled width and rim height (tools/blender/props/mexico.py), scaled to the flat look's box and half again as tall.
  const kinds: [string, number, number][] = [['mesa-a', 70, 30], ['mesa-b', 96, 28], ['mesa-c', 54, 32]];
  MESAS.forEach(([x, z, w, h], i) => {
    const [piece, width, height] = kinds[i % kinds.length]!;
    const s = w / width;
    d.prop(piece, x, -1.5, z, { yaw: Math.PI / 2 - Math.atan2(z, x), scale: [s, (1.5 * h) / height, s * 0.9], tint: d.pick([0xffffff, 0xf2e6da, 0xe6d8c8]) });
  });
  return d.dressing;
};

/** A rock stack's strata, from the ground up: each band's top, how far it sits back (m) and its shade over the sandstone. */
type Band = readonly [top: number, inset: number, shade: readonly [number, number, number]];

const SHADES: readonly (readonly [number, number, number])[] = [
  [1.0, 1.0, 1.0], [1.18, 1.12, 1.02], [0.8, 0.76, 0.76], [1.22, 1.16, 1.06], [0.72, 0.68, 0.7], [1.08, 1.0, 0.9], [0.9, 0.84, 0.8],
];

/**
 * Bands 1-2.2 m deep (a row or two of the shell's grid) up to the stacks' tops, each in a shade of its own and set
 * back up to 12 cm, one in four (the softer rock) up to 30 cm, so each stack's faces step in and out in ledges.
 */
function strata(range: (lo: number, hi: number) => number): Band[] {
  const bands: Band[] = [];
  for (let y = 0, k = Math.floor(range(0, SHADES.length)); y < 26; k++) {
    y += range(1, 2.2);
    bands.push([y, range(0, 1) < 0.25 ? range(0.2, 0.3) : range(0, 0.12), SHADES[k % SHADES.length]!]);
  }
  return bands;
}

/** A hash of a lattice point, 0..1. */
function hash(i: number, j: number, k: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x1b873593) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth value noise, 0..1, on a lattice a unit apart: along a line, over a plane, through space. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  return lerp(hash(i, 0, 0, seed), hash(i + 1, 0, 0, seed), smooth(x - i));
}
function noise2(x: number, z: number, seed: number): number {
  const i = Math.floor(x), k = Math.floor(z), u = smooth(x - i), w = smooth(z - k);
  return lerp(lerp(hash(i, 0, k, seed), hash(i + 1, 0, k, seed), u), lerp(hash(i, 0, k + 1, seed), hash(i + 1, 0, k + 1, seed), u), w);
}
function noise3(x: number, y: number, z: number, seed: number): number {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), u = smooth(x - i), v = smooth(y - j), w = smooth(z - k);
  const c = (a: number, b: number, e: number) => hash(i + a, j + b, k + e, seed);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

/** How far the stacks' corners are cut back, at most; a stack's vertical edges and top edges take one facet. */
const CHAMFER = 1.1;
/** Up to this share of a top edge's facet breaks away again in places (a broken caprock, not a ruled edge). */
const CAP_BREAK = 0.8;
/**
 * A shell's grid: about this far between columns along a face, and between rows up it. Every triangle is laid
 * out again for the lightmap once a session (render/index.ts `_layBake`), so the shells stay near 17,000 of them.
 */
const COLUMN_STEP = 3.6;
const ROW_STEP = 1.2;
const SANDSTONE_TILE = setInfo('sandstone').tile;

/** Grid lines from `lo` to `hi`: the edges, one `r` in from each, and even steps between. */
function lines(lo: number, hi: number, r: number, step: number): number[] {
  const a = lo + r, b = hi - r, n = Math.max(1, Math.round((b - a) / step)), out = [lo];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
  out.push(hi);
  return out;
}

/**
 * The realistic tiers' face of one rock stack tier (`ROCK_STACKS`, V14 and
 * R6): its four sides and its top as grids, the vertical and top edges cut
 * back in a facet, the sides stepped in the stack's strata and every point
 * moved a little by noise, so the flat shading breaks the faces into facets.
 * Nothing stands more than 6 cm out of the collider (never into the walk
 * volume, where the nav grid keeps 0.42 m off it) nor sinks more than 36 cm
 * into it (a bullet's mark on a set-back ledge floats that far off it), bar
 * the corners. Each face is one grid of shared vertices with
 * its own planar UVs (`BuildOpts.ownUVs`), so the bake lays it out as one
 * chart, as it did the box's face. Its faces go on `out`, which `addShells`
 * makes level geometry, baked with the level.
 */
function rockShell(out: ShellFace[], [x, y0, z, w, h, d]: Box6, bands: readonly Band[], seed: number): void {
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, top = y0 + h;
  const r = Math.min(CHAMFER, 0.16 * Math.min(w, d));
  const xs = lines(x0, x1, r, COLUMN_STEP), zs = lines(z0, z1, r, COLUMN_STEP);
  const ys: number[] = [];
  const rows = Math.max(1, Math.round((h - r) / ROW_STEP));
  for (let i = 0; i <= rows; i++) ys.push(y0 + (h - r) * i / rows);
  ys.push(top);
  const inner = new THREE.Box3(new THREE.Vector3(x0 + r, y0, z0 + r), new THREE.Vector3(x1 - r, top - r, z1 - r));
  const point = new THREE.Vector3(), q = new THREE.Vector3(), n = new THREE.Vector3();
  const band = (y: number) => bands.find(([t]) => y < t) ?? bands.at(-1)!;
  // Each face: its grid's two axes over the box's face, its outward normal, and whether (u, v) winds against it.
  const faces: [number[], number[], (u: number, v: number) => void, readonly [number, number, number]][] = [
    [zs, ys, (u, v) => point.set(x1, v, u), [1, 0, 0]],
    [zs, ys, (u, v) => point.set(x0, v, u), [-1, 0, 0]],
    [xs, ys, (u, v) => point.set(u, v, z1), [0, 0, 1]],
    [xs, ys, (u, v) => point.set(u, v, z0), [0, 0, -1]],
    [xs, zs, (u, v) => point.set(u, top, v), [0, 1, 0]],
  ];
  // A tier on another closes its underside: it may overhang the one below (the colliders are jittered), and the lower
  // one's top is cut back at its edges, so from below the open shell showed the sky through it.
  if (y0 > 0) faces.push([xs, zs, (u, v) => point.set(u, y0, v), [0, -1, 0]]);
  for (const [us, vs, at, normal] of faces) {
    const count = us.length * vs.length, position = new Float32Array(3 * count), uv = new Float32Array(2 * count);
    const colour = new Float32Array(3 * count), normals = new Float32Array(3 * count);
    let o = 0;
    for (const v of vs) {
      for (const u of us) {
        // A box surface point onto the cut-back shell (every point of a face lies `r` or more off the inner box: the
        // face's own stay put, its edges' come in to `r`), then along its normal by the strata and the noise.
        at(u, v);
        // The underside is flat inside its rim; its rim is the sides' foot, point for point.
        if (normal[1] < 0 && u !== us[0] && u !== us.at(-1) && v !== vs[0] && v !== vs.at(-1)) {
          point.toArray(position, 3 * o);
          colour.set([0.8, 0.76, 0.74], 3 * o);
          normals.set(normal, 3 * o);
          uv[2 * o] = u / SANDSTONE_TILE;
          uv[2 * o + 1] = v / SANDSTONE_TILE;
          o++;
          continue;
        }
        inner.clampPoint(point, q);
        n.subVectors(point, q);
        if (n.lengthSq() < 1e-8) n.fromArray(normal);
        else n.normalize();
        const onSide = Math.max(0, 1 - 1.4 * Math.abs(n.y));
        const [, inset, shade] = band(point.y + 0.35 * (noise2(point.x * 0.2, point.z * 0.2, seed) - 0.5));
        const grain = noise3(point.x * 0.9, point.y * 0.9, point.z * 0.9, seed + 1) - 0.5;
        // Runnels down the faces: soft vertical grooves where the rain has cut in.
        const runnel = Math.max(0, noise1((point.x + point.z) * 0.45, seed + 3) - 0.55) * 0.5;
        // The caprock breaks along the top edges: the rim cut back in places by up to `CAP_BREAK` of the facet.
        const broken = n.y > 0.2 && n.y < 0.9 ? CAP_BREAK * r * Math.max(0, noise1((point.x + point.z) * 0.38, seed + 5) - 0.4) / 0.6 : 0;
        const out = n.y > 0.9 ? THREE.MathUtils.clamp(0.1 * grain + 0.01, -0.03, 0.05)
          : THREE.MathUtils.clamp((-inset - runnel) * onSide + 0.14 * grain, -0.36, 0.06) - broken;
        q.addScaledVector(n, r + out).toArray(position, 3 * o);
        const tone = (n.y > 0.9 ? 1.08 : 1) * (1 + 0.1 * grain);
        colour[3 * o] = shade[0] * tone;
        colour[3 * o + 1] = shade[1] * tone;
        colour[3 * o + 2] = shade[2] * tone;
        normals.set(normal, 3 * o);
        uv[2 * o] = u / SANDSTONE_TILE;
        uv[2 * o + 1] = (normal[1] > 0.5 ? -v : v) / SANDSTONE_TILE;
        o++;
      }
    }
    // Wound outward: (u, v) runs along +z then up on a +x face, so it turns against the face on some.
    const nu = us.length, flip = normal[0] + normal[1] - normal[2] > 0, index: number[] = [];
    for (let j = 0; j + 1 < vs.length; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const a = j * nu + i, c = a + nu;
        if (flip) index.push(a, c + 1, a + 1, a, c, c + 1);
        else index.push(a, a + 1, c + 1, a, c + 1, c);
      }
    }
    out.push({ position, normal: normals, uv, colour, index });
  }
}

/** One grid of a shell: its vertices' attributes and its triangles. */
interface ShellFace {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  colour: Float32Array;
  index: number[];
}

/**
 * A stack's shells as one piece of level geometry, its faces' grids one after another (each keeps its own vertices,
 * so its own lightmap chart): one mesh to merge a stack, not one a face (the level's load frame).
 */
function addShells(b: LevelBuilder, faces: readonly ShellFace[]): void {
  const count = faces.reduce((n, f) => n + f.position.length / 3, 0), index = new Uint32Array(faces.reduce((n, f) => n + f.index.length, 0));
  const position = new Float32Array(3 * count), normal = new Float32Array(3 * count), uv = new Float32Array(2 * count), colour = new Float32Array(3 * count);
  let base = 0, at = 0;
  for (const face of faces) {
    position.set(face.position, 3 * base);
    normal.set(face.normal, 3 * base);
    uv.set(face.uv, 2 * base);
    colour.set(face.colour, 3 * base);
    for (const i of face.index) index[at++] = base + i;
    base += face.position.length / 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  b.mesh(geometry, [0, 0, 0], { mat: 'sandstone', material: 'sandstone', realOnly: true, noCollide: true, ownUVs: true });
}

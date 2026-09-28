import * as THREE from 'three';
import { NAV_CLEARANCE, NAV_HEADROOM } from '../nav';
import { atlasCell, placementBox } from '../render/props';
import { boxGeo } from '../render/prims';
import type { BuildOpts, LevelBuilder, StairFlight } from './build';
import type { World } from '../physics';
import type { DecalPlacement, LevelDressing, PropFamily, PropPlacement } from '../types';

/**
 * The realistic tiers' dressing of a map (docs/VISUALS.md, R6, V14, V16):
 * the helpers each map's dressing (`downtown-dressing.ts`, ...) places its
 * kit props, cables, grime decals and bevelled trim with. Everything here is
 * visual only and never reaches Low:
 *
 * - kit props, cables and decals go on `level.dressing` (render/props.ts
 *   merges and draws them once the kit streams in);
 * - trim (plinths, cornices, frames and sills round the openings, corner
 *   pilasters, kerbs) is `realOnly` level geometry: no collider, merged with
 *   the static level on the realistic tiers and baked with it (R3).
 *
 * A map's dressing runs in two passes (`DressPass`): the trim with the level
 * (it is baked with it), the rest the first time a realistic look reads
 * `level.dressing` (level/index.ts), so Low never pays for its tables. Each
 * pass runs the same code and skips the other's pieces; trim never draws from
 * the map's generator (it forks its own), so the passes cannot disagree.
 *
 * Placement is deterministic (tables and a seeded generator), so every peer
 * and the bake see the same dressing. Nothing stands where the player or an
 * enemy walks or shoots through: wall pieces stay within `WALL_DEPTH` of
 * their wall (a walker's middle never comes nearer), pieces on the ground
 * stand outside the play space, and the rest hangs overhead;
 * tests/dressing.test.ts checks every piece against the nav grid and the
 * spawns' and perches' sightlines.
 */

/** A wall face by its outward normal and where it lies on that axis. */
export interface Wall {
  face: '+x' | '-x' | '+z' | '-z';
  plane: number;
}

/**
 * How far a wall piece may stand out of its wall at walking height: nav
 * nodes keep 0.42 m from every collider (nav.ts `NAV_CLEARANCE`) and a
 * walker's middle stays on them, so 0.12 m of a wall's face is never walked
 * through.
 */
export const WALL_DEPTH = 0.12;
/**
 * The walk volume no piece may reach into (tests/dressing-check.ts): round
 * every walker-grid node and the middle of every link, a column this far
 * either side, from `WALK_FLOOR` over its floor (flat dressing: decals,
 * kerbs, litter) to the grid's headroom (nav.ts `NAV_HEADROOM`).
 */
export const WALK_COLUMN = 0.3;
export const WALK_FLOOR = 0.13;

/** An opening in a facade: along the wall from `a0` to `a1`, from `y0` to `y1`; a door reaches the floor. */
export interface Opening {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  door: boolean;
}

/** Trim and grime for a facade (`Dresser.facade`); a field left out adds none of it. */
export interface FacadeStyle {
  /** A base course: its height, and the look (`BuildOpts`) of every trim piece unless one sets its own. */
  plinth?: { height: number; opts: BuildOpts };
  /** A band at the wall's top. */
  cornice?: { height: number; opts: BuildOpts };
  /** A pilaster up each end of the facade, between the plinth and the cornice: its width. */
  pilasters?: { width: number; opts: BuildOpts };
  /** Jambs and head round each opening, a sill under each window. */
  frames?: { width: number; opts: BuildOpts; sill?: BuildOpts };
  /**
   * Grime rising 0.8 m from the base (below a grunt's hip, where the readability check reads a wall behind one), and
   * leaks under the windows.
   */
  grime?: { base: number; leaks: number };
}

/** A room's dressing (`Dresser.room`); a field left out adds none of it. */
export interface RoomStyle {
  /** A skirting board along the walls' solid runs at the floor. */
  skirting?: BuildOpts;
  /** Posters and pictures (`signs` cells) hung above head height, where a wall is clear. */
  pictures?: readonly string[];
  /** How dark the dirt along the walls' feet and the scuffs on the floor are, 0-1. */
  grime?: number;
  /** Steel shelving against the walls, where the walker grid leaves room for it. */
  shelves?: boolean;
}

/** Which of a map's dressing a pass makes: its trim (level geometry) or its kit props, cables and decals. */
export type DressPass = 'trim' | 'props';

/** A map's dressing function: both passes run it, and the props pass keeps what it returns. */
export type DressMap = (b: LevelBuilder, pass: DressPass, world?: World) => LevelDressing;

/** mulberry32: a small deterministic generator, one per map. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PropOpts {
  yaw?: number;
  scale?: number | readonly [number, number, number];
  /** sRGB colour over the piece's own (paint variety). */
  tint?: number;
  /** A `signs` cell by name, for signs, posters and frames. */
  sign?: string;
}

/** A ground decal's turn that puts its cell's v = 0 edge against a wall of this face (render/props.ts `decalGeometry`). */
const FOOT_TURN: Readonly<Record<Wall['face'], number>> = { '+x': -Math.PI / 2, '-x': Math.PI / 2, '+z': Math.PI, '-z': 0 };
const YAW: Readonly<Record<Wall['face'], number>> = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };

export class Dresser {
  readonly b: LevelBuilder;
  readonly pass: DressPass;
  /** The level's colliders as built: the facade scans and the walker test read them. */
  readonly world: World;
  readonly dressing: LevelDressing;
  readonly random: () => number;
  readonly #min = new THREE.Vector3();
  readonly #max = new THREE.Vector3();
  readonly #box = new THREE.Box3();
  readonly #column = new THREE.Box3();

  constructor(b: LevelBuilder, family: PropFamily, seed: number, pass: DressPass, world = b.world) {
    this.b = b;
    this.pass = pass;
    this.world = world;
    this.dressing = { family, props: [], cables: [], decals: [] };
    this.random = generator(seed);
    // The colliders so far join the world's grid, so the facade scans can query them (finish() does it again).
    if (pass === 'trim') world.finalize();
  }

  /** A uniform number in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }

  /**
   * A generator of its own, for what is baked (trim): props and decals drawing
   * from the map's generator must never move the static level, or its bake.
   */
  fork(seed: number): (lo: number, hi: number) => number {
    const next = generator(seed);
    return (lo, hi) => lo + (hi - lo) * next();
  }

  /** One of `list`. */
  pick<T>(list: readonly T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.random() * list.length))]!;
  }

  prop(piece: string, x: number, y: number, z: number, opts: PropOpts = {}): void {
    if (this.pass === 'props') this.dressing.props.push(this.#placement(piece, x, y, z, opts));
  }

  #placement(piece: string, x: number, y: number, z: number, opts: PropOpts): PropPlacement {
    const s = opts.scale ?? 1;
    return { piece, x, y, z, yaw: opts.yaw ?? 0, scale: typeof s === 'number' ? [s, s, s] : s,
      tint: opts.tint ?? 0xffffff, cell: opts.sign === undefined ? 0 : atlasCell('signs', opts.sign) };
  }

  /**
   * A kit piece on the floor where nobody walks (`clearOfWalkers`): against
   * a wall, behind cover, in a corner. False, and nothing placed, where it
   * would stand in the walk volume.
   */
  propIfClear(piece: string, x: number, y: number, z: number, opts: PropOpts = {}): boolean {
    if (this.pass !== 'props') return false;
    const placement = this.#placement(piece, x, y, z, opts);
    if (!this.clearOfWalkers(placementBox(placement, this.#box))) return false;
    this.dressing.props.push(placement);
    return true;
  }

  /**
   * Does a box keep out of the walk volume (`WALK_COLUMN`)? The walker grid's
   * node test (nav.ts `NavGrid.build`) is run again on its cells round the
   * box, and neither a node's column nor the middle of a link between two
   * neighbours may reach into it. Every node counts, reachable or not.
   */
  clearOfWalkers(box: THREE.Box3): boolean {
    const { minX, minZ, maxX, maxZ } = this.b.level.bounds, reach = WALK_COLUMN + 1, c = NAV_CLEARANCE;
    const nx = Math.ceil(maxX - minX), nz = Math.ceil(maxZ - minZ), world = this.world;
    const i0 = Math.max(0, Math.floor(box.min.x - reach - minX)), i1 = Math.min(nx - 1, Math.floor(box.max.x + reach - minX));
    const k0 = Math.max(0, Math.floor(box.min.z - reach - minZ)), k1 = Math.min(nz - 1, Math.floor(box.max.z + reach - minZ));
    const nodes: [number, number, number, number, number][] = [];
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const x = minX + i + 0.5, z = minZ + k + 0.5, heights = new Set<number>();
        for (const b of world.query(this.#min.set(x - 0.05, -30, z - 0.05), this.#max.set(x + 0.05, 90, z + 0.05))) if (!b.data.noNav) heights.add(b.max.y);
        for (const y of heights) {
          if (y < -5 || y > 70 || world.overlapsAABB(this.#min.set(x - c, y + 0.5, z - c), this.#max.set(x + c, y + NAV_HEADROOM, z + c))) continue;
          nodes.push([i, k, x, y, z]);
        }
      }
    }
    const column = (x: number, y: number, z: number) => this.#column.set(this.#min.set(x - WALK_COLUMN, y + WALK_FLOOR, z - WALK_COLUMN),
      this.#max.set(x + WALK_COLUMN, y + NAV_HEADROOM, z + WALK_COLUMN)).intersectsBox(box);
    for (const [i, k, x, y, z] of nodes) {
      if (column(x, y, z)) return false;
      for (const [j, l, u, v, w] of nodes) {
        if (Math.abs(j - i) <= 1 && Math.abs(l - k) <= 1 && (j !== i || l !== k) && column((x + u) / 2, Math.max(y, v), (z + w) / 2)) return false;
      }
    }
    return true;
  }

  /** A world point on a wall: `along` it, at `y`, `out` metres out of its face. */
  at(wall: Wall, along: number, y: number, out = 0): [number, number, number] {
    const sign = wall.face.startsWith('-') ? -1 : 1, p = wall.plane + sign * out;
    return wall.face.endsWith('x') ? [p, y, along] : [along, y, p];
  }

  /** A kit piece on a wall, its back on the face, facing out. */
  onWall(piece: string, wall: Wall, along: number, y: number, opts: PropOpts & { out?: number } = {}): void {
    this.prop(piece, ...this.at(wall, along, y, opts.out ?? 0.002), { ...opts, yaw: YAW[wall.face] + (opts.yaw ?? 0) });
  }

  /** A sign (a 1 x 1 board scaled to `width` x `height`), a poster or a picture frame showing a `signs` cell. */
  sign(name: string, wall: Wall, along: number, y: number, width: number, height: number, piece: 'sign' | 'poster' | 'frame' = 'sign'): void {
    this.onWall(piece, wall, along, y, { sign: name, scale: [width, height, piece === 'sign' ? Math.min(1, width) : 1] });
  }

  cable(from: readonly [number, number, number], to: readonly [number, number, number], sag: number, radius = 0.013): void {
    if (this.pass === 'props') this.dressing.cables.push({ from, to, sag, radius });
  }

  /** A grime decal of the `grime` cell `name`. */
  decal(name: string, x: number, y: number, z: number, facing: DecalPlacement['facing'], width: number, height: number,
    opts: { turn?: number; strength?: number } = {}): void {
    if (this.pass === 'props') this.dressing.decals.push({ cell: atlasCell('grime', name), x, y, z, facing, width, height, turn: opts.turn ?? 0, strength: opts.strength ?? 1 });
  }

  /** A decal on a wall, centred `along` it at `y`. */
  wallDecal(name: string, wall: Wall, along: number, y: number, width: number, height: number, strength = 1): void {
    this.decal(name, ...this.at(wall, along, y), wall.face, width, height, { strength });
  }

  /** A ground decal at (x, z) on the floor at `y`, turned `turn` radians. */
  groundDecal(name: string, x: number, y: number, z: number, width: number, depth: number, turn = 0, strength = 1): void {
    this.decal(name, x, y, z, '+y', width, depth, { turn, strength });
  }

  /**
   * Dirt on the floor at `y` along a wall's foot, from `a0` to `a1`: strips of
   * the `edge-dirt` cell, dark against the wall and fading out `depth` from
   * it. Flat, so it may lie where anyone walks.
   */
  footDirt(wall: Wall, a0: number, a1: number, y: number, strength = 0.6, depth = 0.9): void {
    const turn = FOOT_TURN[wall.face], span = a1 - a0, n = Math.max(1, Math.round(span / 2.4)), step = span / n;
    for (let i = 0; i < n; i++) {
      const [x, , z] = this.at(wall, a0 + (i + 0.5) * step, y, depth / 2);
      this.groundDecal('edge-dirt', x, y, z, step + 0.3, depth, turn, strength * this.range(0.8, 1));
    }
  }

  /**
   * Grime gathered where wear collects (a bench's feet, a lamp, a crate, a
   * kerb's corner): `count` ground decals of `cells` within `radius` of
   * (x, z) on the floor at `y`, mostly small, fainter towards the edge.
   */
  scatter(x: number, y: number, z: number, radius: number, count: number, cells: readonly string[], strength = 0.6): void {
    for (let i = 0; i < count; i++) {
      const a = this.range(0, 2 * Math.PI), r = radius * Math.sqrt(this.random()), size = this.range(0.5, 1.9);
      this.groundDecal(this.pick(cells), x + Math.cos(a) * r, y, z + Math.sin(a) * r, size, size * this.range(0.7, 1.3), this.range(0, 6),
        strength * this.range(0.7, 1) * (1 - 0.4 * r / radius));
    }
  }

  /**
   * Clutter tucked against the foot of the loose things on the ground (crates,
   * containers, benches, piers: colliders from 0.8 m tall and under `longest`
   * m long, standing within `area`), where the walker grid leaves room for
   * it (`propIfClear`), up to `most` pieces.
   */
  tuck(area: readonly [number, number, number, number], floor: number, longest: number, pieces: readonly string[], most: number): void {
    const [x0, z0, x1, z1] = area;
    let placed = 0;
    for (const box of this.world.boxes) {
      if (placed >= most) return;
      const w = box.max.x - box.min.x, d = box.max.z - box.min.z;
      if (box.data.noShoot || Math.abs(box.min.y - floor) > 0.05 || box.max.y - box.min.y < 0.8 || Math.max(w, d) > longest
        || box.min.x < x0 || box.max.x > x1 || box.min.z < z0 || box.max.z > z1) continue;
      for (const [face, along0, along1, plane] of [['+x', box.min.z, box.max.z, box.max.x], ['-x', box.min.z, box.max.z, box.min.x],
        ['+z', box.min.x, box.max.x, box.max.z], ['-z', box.min.x, box.max.x, box.min.z]] as const) {
        for (let a = along0 + 0.4; a < along1 - 0.3 && placed < most; a += this.range(0.9, 1.6)) {
          const piece = this.pick(pieces), [x, , z] = this.at({ face, plane }, a, floor, 0.32);
          if (this.propIfClear(piece, x, floor, z, { yaw: YAW[face] + this.range(-0.4, 0.4) })) placed++;
        }
      }
    }
  }

  /** Is a wall solid over [a0, a1] x [y0, y1] (a piece hung there covers no opening)? */
  solid(wall: Wall, a0: number, a1: number, y0: number, y1: number): boolean {
    const rects = this.rects(wall, a0, a1, y0, y1);
    const covered = (a: number, y: number) => rects.some(([p, q, r, t]) => a >= p - 1e-3 && a <= q + 1e-3 && y >= r - 1e-3 && y <= t + 1e-3);
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) if (!covered(a0 + (a1 - a0) * i / 4, y0 + (y1 - y0) * j / 2)) return false;
    return true;
  }

  /**
   * Dress a room from the inside, its walls the faces of the box from (x0, z0)
   * to (x1, z1) and from `floor` up `height`: a skirting board along their
   * solid runs, a switch by each door and conduit up from it, a radiator
   * under each window, pictures above head height, cracks up high, dirt along
   * the walls' feet and scuffs on the floor, and shelving where the walker
   * grid leaves room. Wall pieces stay within `WALL_DEPTH` of their wall.
   */
  room(x0: number, z0: number, x1: number, z1: number, floor: number, height: number, style: RoomStyle): void {
    const walls: [Wall, number, number][] = [[{ face: '+x', plane: x0 }, z0, z1], [{ face: '-x', plane: x1 }, z0, z1],
      [{ face: '+z', plane: z0 }, x0, x1], [{ face: '-z', plane: z1 }, x0, x1]];
    const pictures = [...(style.pictures ?? [])], grime = style.grime ?? 0.5;
    for (const [wall, a0, a1] of walls) {
      const openings = this.facade(wall, a0, a1, floor, floor + height, style.skirting ? { plinth: { height: 0.12, opts: style.skirting } } : {});
      for (const o of openings) {
        if (o.door) {
          for (const a of [o.a1 + 0.3, o.a0 - 0.3]) {
            if (!this.solid(wall, a - 0.06, a + 0.06, floor + 1.1, floor + height - 0.3)) continue;
            this.onWall('switch', wall, a, floor + 1.15);
            this.onWall('conduit', wall, a, floor + 1.26, { scale: [1, Math.min(height - 1.5, 2.8), 1] });
            break;
          }
        } else if (o.y0 - floor > 0.8 && this.solid(wall, (o.a0 + o.a1) / 2 - 0.42, (o.a0 + o.a1) / 2 + 0.42, floor + 0.1, o.y0 - 0.05)) {
          this.onWall('radiator', wall, (o.a0 + o.a1) / 2, floor + 0.02);
        }
      }
      // Pictures and a clock above head height, clear of the openings.
      for (let a = a0 + 1.2; a < a1 - 1.2 && pictures.length > 0 && height > 3.1; a += this.range(2.2, 3.4)) {
        if (!this.solid(wall, a - 0.6, a + 0.6, floor + 2.1, floor + 3)) continue;
        const name = pictures.shift()!;
        if (name === 'clock') this.onWall('clock', wall, a, floor + 2.4);
        else this.sign(name, wall, a, floor + 2.15, 0.7, 0.85, ['portrait', 'landscape', 'drawing'].includes(name) ? 'frame' : 'poster');
      }
      for (let a = a0 + 1; a < a1 - 1; a += this.range(3, 5)) {
        if (this.random() < 0.4 && this.solid(wall, a - 0.8, a + 0.8, floor + 2.2, floor + 3.2)) {
          this.wallDecal(this.pick(['plaster-crack', 'damp']), wall, a, floor + 2.7, 1.6, 1.2, grime * this.range(0.6, 0.9));
        }
      }
      for (const [from, to] of this.runs(wall, a0, a1, floor + 0.05)) {
        if (to - from > 0.5) this.footDirt(wall, from, to, floor, grime * 0.9, 0.7);
        if (style.shelves && to - from > 2.4 && this.random() < 0.5) {
          const a = this.range(from + 0.8, to - 0.8), [x, , z] = this.at(wall, a, floor, 0.01);
          this.propIfClear('shelf', x, floor, z, { yaw: YAW[wall.face] });
        }
      }
    }
    for (let i = 0; i < Math.round((x1 - x0) * (z1 - z0) / 12); i++) {
      const cell = this.pick(['scuffs', 'scuffs', 'stain', 'footprints']), x = this.range(x0 + 0.8, x1 - 0.8), z = this.range(z0 + 0.8, z1 - 0.8);
      const size = this.range(1.2, 2.2), turn = this.range(0, 6), strength = grime * this.range(0.6, 1);
      // Only where the floor is (not over a stairwell).
      if (this.world.query(this.#min.set(x - 0.05, floor - 0.02, z - 0.05), this.#max.set(x + 0.05, floor + 0.005, z + 0.05))
        .some(box => Math.abs(box.max.y - floor) < 0.01)) this.groundDecal(cell, x, floor, z, size, size, turn, strength);
    }
  }

  /** A realistic-only trim box (level geometry: baked with the level, no collider), made by the trim pass. */
  trim(x: number, y: number, z: number, w: number, h: number, d: number, opts: BuildOpts): void {
    if (this.pass === 'trim') this.b.box(x, y, z, w, h, d, { ...opts, realOnly: true, noCollide: true });
  }

  /**
   * An edge band round a slab's four sides (a steel angle, a fascia): from
   * `height` under its top to 1 cm under it (a floor that meets the slab
   * keeps its own top face), `proud` out of its faces, wrapping the corners.
   */
  fascia(x0: number, z0: number, x1: number, z1: number, top: number, height: number, proud: number, opts: BuildOpts): void {
    const y0 = top - height, h = height - 0.01, x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0 + 2 * proud, d = z1 - z0;
    for (const side of [-1, 1]) {
      this.trim(x, y0, z + side * (d + proud) / 2, w, h, proud, opts);
      this.trim(x + side * (x1 - x0 + proud) / 2, y0, z, proud, h, d, opts);
    }
  }

  /**
   * A cap along a wall's top (coping) over its solid runs: `height` over the
   * top, `over` past each face, so a parapet or a barrier ends in a lip
   * rather than a cut. Low enough (under `WALK_FLOOR`) to walk over.
   */
  coping(wall: Wall, a0: number, a1: number, top: number, thickness: number, height: number, over: number, opts: BuildOpts): void {
    for (const [from, to] of this.runs(wall, a0, a1, top - 0.05)) {
      const [x, , z] = this.at(wall, (from + to) / 2, 0, over - (thickness + 2 * over) / 2);
      const along = to - from + 2 * over, across = thickness + 2 * over, alongX = !wall.face.endsWith('x');
      this.trim(x, top, z, alongX ? along : across, height, alongX ? across : along, opts);
    }
  }

  /**
   * Stringers down a stair flight's open sides (level/build.ts `flights`), in
   * `look`: a band `depth` deep and 3 cm proud of the side, its top on the
   * line through the risers' feet, so the stepped block reads as a built
   * flight. Its top stays a riser under the tread beyond any tread (a
   * walker's column over a tread reaches over the next one, and the walk
   * volume starts over them); it starts where its foot clears the flight's
   * base, and a side with a wall or a collider against it gets none.
   */
  stringers({ x, y, z, dir, n, width, opts }: StairFlight, look: BuildOpts, depth = 0.3): void {
    if (this.pass !== 'trim') return;
    const rise = opts.rise ?? 4 / 14, run = opts.run ?? 0.45, slope = rise / run, proud = 0.03;
    const alongX = dir.endsWith('x'), sign = dir.startsWith('-') ? -1 : 1;
    const s0 = (depth + rise) / slope, s1 = n * run;
    if (s1 - s0 < run) return;
    const forward = new THREE.Vector3(alongX ? sign : 0, 0, alongX ? 0 : sign), up = new THREE.Vector3(0, 1, 0);
    for (const side of [-1, 1]) {
      const out = new THREE.Vector3(alongX ? 0 : side, 0, alongX ? side : 0), mid = (s0 + s1) / 2;
      // Against a wall (or another flight): no room for it.
      const centre = new THREE.Vector3(x, y, z).addScaledVector(forward, mid).addScaledVector(out, width / 2 + 0.03);
      const half = new THREE.Vector3(alongX ? (s1 - s0) / 2 : 0.02, 0, alongX ? 0.02 : (s1 - s0) / 2);
      const lo = this.#min.copy(centre).sub(half).setY(y + rise), hi = this.#max.copy(centre).add(half).setY(y + n * rise - rise);
      if (this.world.query(lo, hi).some(box => !box.data.noShoot)) continue;
      // A unit box sheared onto the band: along the flight and up its slope, down its depth, out of the side.
      const along = forward.clone().multiplyScalar(s1 - s0).addScaledVector(up, (s1 - s0) * slope);
      let outward = out.clone().multiplyScalar(proud);
      if (along.dot(up.clone().multiplyScalar(depth).cross(outward)) < 0) outward = outward.negate();
      const position = new THREE.Vector3(x, y + mid * slope - rise - depth / 2, z).addScaledVector(forward, mid).addScaledVector(out, width / 2 + proud / 2);
      const geometry = boxGeo(1, 1, 1).applyMatrix4(new THREE.Matrix4().makeBasis(along, up.clone().multiplyScalar(depth), outward).setPosition(position));
      this.b.mesh(geometry, [0, 0, 0], { ...look, realOnly: true, noCollide: true });
    }
  }

  /** Stringers on every stair flight of the map (`stringers`): steel flights' in dark painted steel, the rest in their own finish a shade darker. */
  stairs(): void {
    for (const flight of this.b.flights) {
      const { mat, material } = flight.opts;
      this.stringers(flight, material === 'tread-plate' ? { mat: 'dark', material: 'painted-metal' } : { mat, material, tint: 0xd8d4cc });
    }
  }

  /** A trim box on a wall: `along` from a0 to a1, `y` from y0 to y1, `depth` out of the face. */
  wallTrim(wall: Wall, a0: number, a1: number, y0: number, y1: number, depth: number, opts: BuildOpts): void {
    if (a1 - a0 < 0.02 || y1 - y0 < 0.01) return;
    const [x, , z] = this.at(wall, (a0 + a1) / 2, 0, depth / 2);
    const alongX = !wall.face.endsWith('x');
    this.trim(x, y0, z, alongX ? a1 - a0 : depth, y1 - y0, alongX ? depth : a1 - a0, opts);
  }

  /**
   * The solid colliders (not see-through rails) just inside a wall's face,
   * from `a0` to `a1` and `y0` to `y1`, as rectangles in (along, y).
   */
  rects(wall: Wall, a0: number, a1: number, y0: number, y1: number): [number, number, number, number][] {
    const [xa, , za] = this.at(wall, a0, y0, -0.03), [xb, , zb] = this.at(wall, a1, y1, -0.03);
    const boxes = this.world.query(this.#min.set(Math.min(xa, xb), y0, Math.min(za, zb)), this.#max.set(Math.max(xa, xb), y1, Math.max(za, zb)));
    const alongX = !wall.face.endsWith('x');
    return boxes.filter(box => !box.data.noShoot).map(box => [
      Math.max(a0, alongX ? box.min.x : box.min.z), Math.min(a1, alongX ? box.max.x : box.max.z), Math.max(y0, box.min.y), Math.min(y1, box.max.y),
    ] as [number, number, number, number]).filter(([p, q, r, t]) => q - p > 1e-3 && t - r > 1e-3);
  }

  /**
   * The openings in a facade from `a0` to `a1` and `y0` to `y1`, read from
   * its colliders (the maps build walls from boxes with gaps: level/build.ts
   * `wall`) on a grid of their own edges. An opening at either end of the
   * span, or open at its top, is not one (the wall just ends there).
   */
  openings(wall: Wall, a0: number, a1: number, y0: number, y1: number): Opening[] {
    const rects = this.rects(wall, a0, a1, y0, y1);
    const edges = (values: number[]) => [...new Set(values.map(v => Math.round(v * 1e4) / 1e4))].sort((a, b) => a - b);
    const us = edges([a0, a1, ...rects.flatMap(r => [r[0], r[1]])]), vs = edges([y0, y1, ...rects.flatMap(r => [r[2], r[3]])]);
    const nx = us.length - 1, ny = vs.length - 1, empty = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const u = (us[i]! + us[i + 1]!) / 2, v = (vs[j]! + vs[j + 1]!) / 2;
      empty[j * nx + i] = rects.some(([p, q, r, t]) => u > p && u < q && v > r && v < t) ? 0 : 1;
    }
    const seen = new Uint8Array(nx * ny), out: Opening[] = [];
    for (let start = 0; start < nx * ny; start++) {
      if (!empty[start] || seen[start]) continue;
      let i0 = nx, i1 = -1, j0 = ny, j1 = -1;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const k = stack.pop()!, i = k % nx, j = Math.floor(k / nx);
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const a = i + di, c = j + dj;
          if (a < 0 || a >= nx || c < 0 || c >= ny) continue;
          const n = c * nx + a;
          if (empty[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      if (i0 === 0 || i1 === nx - 1 || j1 === ny - 1) continue;
      out.push({ a0: us[i0]!, a1: us[i1 + 1]!, y0: vs[j0]!, y1: vs[j1 + 1]!, door: j0 === 0 });
    }
    return out.sort((a, b) => a.a0 - b.a0 || a.y0 - b.y0);
  }

  /** The solid runs along a facade at height `y`: [from, to] pairs. */
  runs(wall: Wall, a0: number, a1: number, y: number): [number, number][] {
    const spans = this.rects(wall, a0, a1, y - 0.01, y + 0.01).map(([p, q]) => [p, q] as [number, number]).sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    for (const [p, q] of spans) {
      const last = out.at(-1);
      if (last && p <= last[1] + 1e-3) last[1] = Math.max(last[1], q);
      else out.push([p, q]);
    }
    return out;
  }

  /**
   * Can a walker step through this window: is there a floor within a step
   * (0.6 m) under its bottom, on either side of the wall? Nav links climb
   * through such windows (a step of 0.55 m), so a sill would stand in them.
   */
  stepThrough(wall: Wall, o: Opening): boolean {
    for (const out of [-0.8, 0.8]) {
      const [x, , z] = this.at(wall, (o.a0 + o.a1) / 2, 0, out);
      const boxes = this.world.query(this.#min.set(x - 0.3, o.y0 - 0.6, z - 0.3), this.#max.set(x + 0.3, o.y0 + 0.01, z + 0.3));
      if (boxes.some(box => !box.data.noNav && box.max.y >= o.y0 - 0.6 && box.max.y <= o.y0 + 0.01)) return true;
    }
    return false;
  }

  /**
   * Dress one facade from its colliders: a plinth along the solid runs at
   * its foot, a cornice along its top, frames and sills round its openings
   * (never inside one), grime at its foot and leaks under its windows.
   * Returns the openings, for the map to hang more on.
   */
  facade(wall: Wall, a0: number, a1: number, y0: number, y1: number, style: FacadeStyle): Opening[] {
    const openings = this.openings(wall, a0, a1, y0, y1);
    if (style.plinth) {
      // Where the wall is solid at the plinth's foot and just over it: a low deck or step against a doorway is no wall.
      const { height, opts } = style.plinth, over = this.runs(wall, a0, a1, y0 + height + 0.05);
      for (const [from, to] of this.runs(wall, a0, a1, y0 + 0.05)) {
        for (const [p, q] of over) if (Math.min(to, q) > Math.max(from, p)) this.wallTrim(wall, Math.max(from, p), Math.min(to, q), y0, y0 + height, 0.04, opts);
      }
    }
    if (style.cornice) {
      const { height, opts } = style.cornice;
      for (const [from, to] of this.runs(wall, a0, a1, y1 - 0.05)) {
        // Shallow (5 and 7 cm): a deeper band moves the building's shadow's edge on the ground, where grunts stand.
        this.wallTrim(wall, from - 0.05, to + 0.05, y1 - height, y1, 0.05, opts);
        this.wallTrim(wall, from - 0.07, to + 0.07, y1 - 0.06, y1, 0.07, opts);
      }
    }
    if (style.pilasters) {
      const { width, opts } = style.pilasters, runs = this.runs(wall, a0, a1, (y0 + y1) / 2);
      const first = runs[0], last = runs.at(-1), bottom = y0 + (style.plinth?.height ?? 0), top = y1 - (style.cornice?.height ?? 0);
      if (first && last) {
        this.wallTrim(wall, first[0], first[0] + width, bottom, top, 0.045, opts);
        this.wallTrim(wall, last[1] - width, last[1], bottom, top, 0.045, opts);
      }
    }
    if (style.frames) {
      const { width: w, opts, sill } = style.frames;
      for (const o of openings) {
        this.wallTrim(wall, o.a0 - w, o.a0, o.y0, o.y1, 0.055, opts);
        this.wallTrim(wall, o.a1, o.a1 + w, o.y0, o.y1, 0.055, opts);
        if (o.y1 < y1 - w) this.wallTrim(wall, o.a0 - w, o.a1 + w, o.y1, o.y1 + w, 0.055, opts);
        if (!o.door && !this.stepThrough(wall, o)) this.wallTrim(wall, o.a0 - w - 0.05, o.a1 + w + 0.05, o.y0 - 0.07, o.y0, 0.1, sill ?? opts);
      }
    }
    if (style.grime) {
      for (const [from, to] of style.grime.base > 0 ? this.runs(wall, a0, a1, y0 + 0.05) : []) {
        for (let a = from; a < to - 0.5; a += 3) {
          const width = Math.min(3.4, to - a);
          this.wallDecal('base', wall, a + width / 2, y0 + 0.4, width + 0.3, 0.8, style.grime.base * this.range(0.7, 1));
        }
      }
      for (const o of openings) {
        if (!o.door && style.grime.leaks > 0 && this.random() < 0.8) {
          this.wallDecal('leaks', wall, (o.a0 + o.a1) / 2 + this.range(-0.2, 0.2), o.y0 - 0.75, o.a1 - o.a0 + 0.2, 1.4, style.grime.leaks * this.range(0.6, 1));
        }
      }
    }
    return openings;
  }
}

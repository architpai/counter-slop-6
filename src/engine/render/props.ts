import * as THREE from 'three';
import manifest from './prop-assets.json';
import { casterGroups, grimeMat, hiddenMat, kitMat, levelDepthMat, signsMat } from './materials';
import { TEXTURE_SETS, TEXTURE_SIZE, setInfo } from './surfaces';
import { textureBytes } from './textures';
import type { GfxValues } from './quality';
import type { TextureSet, TextureSize } from './surfaces';
import type { LoadTexture } from './textures';
import type { CablePlacement, DecalPlacement, GrappleMover, LevelDressing, PropFamily, PropPlacement } from '../types';

/**
 * The realistic tiers' detail kit (docs/VISUALS.md, R6, V14 and V16): the
 * Blender-made props of `tools/blender/props/` (one glb per map family:
 * crates, AC units, pipes, signs, doors and windows for closed walls, the
 * skyline, the mesas, the treeline, the grapple drone), the `signs` and
 * `grime` atlases, and what a map's dressing (level/dressing.ts) makes of
 * them. Low loads none of it.
 *
 * A map's placements are merged, not instanced: the pieces that cast
 * shadows and the small pieces each in cells of `PROP_CELL` metres (the small
 * ones hidden beyond `SMALL_DISTANCE`; Medium's cells are wider and its small
 * pieces nearer, `propDetail`), and the backdrops in one; each mesh draws
 * one call per texture set it wears (the level's own sets and streaming,
 * render/materials.ts `kitMat`). The grime decals are one more mesh and one
 * call, multiplied over the level. The drones wear the kit's drone.
 * Everything here is visual: nothing is a collider, a nav surface or a
 * target, so gameplay reads the same level on every tier.
 */

type Vec3 = readonly [number, number, number];

export const PROP_ATLASES = ['signs', 'grime'] as const;
export type PropAtlas = (typeof PROP_ATLASES)[number];
/** The texture "set" of a sign's face: its placement's cell of the `signs` atlas, not a level set. */
export const SIGNS = 'signs';
/** The kit's grapple drone (R6), worn by `level.movers` on the realistic tiers. */
export const DRONE = 'drone';
/** The flat look's drone is a cone `coneGeo(1.2 * scale, 4 * scale)` (level/build.ts `planes`) whose mover radius is 2.2 × scale. */
const DRONE_RADIUS = 2.2;
/**
 * The dressing merges per cell of this many metres, so the camera and each
 * shadow cascade draw only the cells in their view; the small pieces (litter,
 * bags, vents, lamps) are hidden as well beyond `SMALL_DISTANCE`.
 */
export const PROP_CELL = 32;
export const SMALL_DISTANCE = 48;

/** How finely the kit merges and how far its small pieces show (`propDetail`). */
export interface PropDetail {
  cell: number;
  small: number;
}
const FULL_DETAIL: PropDetail = { cell: PROP_CELL, small: SMALL_DISTANCE };
/**
 * Medium's kit (the low Textures size): cells twice as wide (a map's
 * quarters: under half the draw runs, though the culling then keeps more
 * triangles) and the small pieces hidden from half the distance.
 */
const LIGHT_DETAIL: PropDetail = { cell: 2 * PROP_CELL, small: SMALL_DISTANCE / 2 };

/** The kit's detail at a Textures size: it follows the setting, as its atlases do. */
export function propDetail(size: TextureSize): PropDetail {
  return size === TEXTURE_SIZE.low ? LIGHT_DETAIL : FULL_DETAIL;
}
/** Script time a pump spends merging a map's dressing (`DressingMerge`). */
const MERGE_STEP_MS = 3;
/** Decals sit this far off their face, besides the material's polygon offset. */
const DECAL_LIFT = 0.012;

/** One kit piece in `prop-assets.json`, written by tools/props/build.mjs from the Blender scripts. */
export interface PieceInfo {
  kit: string;
  small: boolean;
  backdrop: boolean;
  min: Vec3;
  max: Vec3;
  triangles: number;
  sets: readonly string[];
}

export interface AtlasInfo {
  cols: number;
  rows: number;
  cells: readonly string[];
  /** Per size it is loaded at (`atlasSize`). */
  bytes: Readonly<Partial<Record<`${TextureSize}`, number>>>;
}

export interface PropManifest {
  glbs: Readonly<Record<PropFamily, number>>;
  atlases: Readonly<Record<PropAtlas, AtlasInfo>>;
  pieces: Readonly<Record<string, PieceInfo>>;
}

const FAMILIES: readonly PropFamily[] = ['downtown', 'house', 'mexico'];
const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));

/** Check `prop-assets.json`: a hand edit that breaks it fails at load, not as missing props. */
export function parsePropManifest(raw: unknown): PropManifest {
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof PropManifest, unknown>>;
  const glbs = m.glbs as Record<string, unknown> | undefined, atlases = m.atlases as Record<string, Partial<AtlasInfo>> | undefined;
  const pieces = m.pieces as Record<string, Partial<PieceInfo>> | undefined;
  if (!glbs || !atlases || !pieces || !FAMILIES.every(f => typeof glbs[f] === 'number')) throw new Error('malformed prop-assets.json');
  for (const name of PROP_ATLASES) {
    const info = atlases[name];
    if (!info || !(Number(info.cols) > 0) || !(Number(info.rows) > 0) || !Array.isArray(info.cells)
      || !Object.values(TEXTURE_SIZE).every(size => typeof info.bytes?.[`${atlasSize(name, size)}`] === 'number')) throw new Error(`prop-assets.json: atlas ${name}`);
  }
  for (const [name, info] of Object.entries(pieces)) {
    if (!isVec3(info.min) || !isVec3(info.max) || !Array.isArray(info.sets) || typeof info.triangles !== 'number'
      || !info.sets.every(set => set === SIGNS || (TEXTURE_SETS as readonly string[]).includes(set))) throw new Error(`prop-assets.json: piece ${name}`);
  }
  if (!pieces[DRONE]) throw new Error('prop-assets.json: no drone');
  return m as unknown as PropManifest;
}

export const PROP_MANIFEST = parsePropManifest(manifest);

export const propsUrl = (family: PropFamily): string => `/props/${family}.glb`;
export const propAtlasUrl = (size: TextureSize, atlas: PropAtlas): string => `/props/${size}/${atlas}.ktx2`;

/**
 * The atlas size a tier's Textures size loads: the grime's own, the signs'
 * at least 1024 (128 texels a cell), as a shop sign's lettering at 64 smears
 * at a grazing angle; it is 60 KB.
 */
export function atlasSize(atlas: PropAtlas, size: TextureSize): TextureSize {
  return atlas === 'signs' ? Math.max(size, TEXTURE_SIZE.medium) as TextureSize : size;
}

/** A named cell of an atlas (tools/blender/props/atlas.py), for the maps' signs and grime. */
export function atlasCell(atlas: PropAtlas, name: string): number {
  const cell = PROP_MANIFEST.atlases[atlas].cells.indexOf(name);
  if (cell < 0) throw new Error(`prop-assets.json: ${atlas} has no ${name}`);
  return cell;
}

/** The piece's manifest entry; a placement of a piece the kit lacks is a map bug. */
export function pieceInfo(piece: string): PieceInfo {
  const info = PROP_MANIFEST.pieces[piece];
  if (!info) throw new Error(`prop-assets.json has no piece ${piece}: run npm run props`);
  return info;
}

/** What a tier downloads for a map's dressing: its family's glb and both atlases at its size (`atlasSize`). */
export function propDownloadBytes(family: PropFamily, size: TextureSize): number {
  return PROP_MANIFEST.glbs[family] + PROP_ATLASES.reduce((sum, atlas) => sum + PROP_MANIFEST.atlases[atlas].bytes[`${atlasSize(atlas, size)}`]!, 0);
}

/** The atlas size for these values (the Textures setting's), or null on the flat look, which loads none. */
export function propTextureSize(values: Pick<GfxValues, 'look' | 'textures'>): TextureSize | null {
  return values.look === 'realistic' ? TEXTURE_SIZE[values.textures] : null;
}

/** The level texture sets a map's dressing wears (and the drones', if it has any), for the level's streaming. */
export function dressingSets(dressing: LevelDressing | null, drones: boolean): TextureSet[] {
  const sets = new Set<string>();
  const add = (piece: string) => { for (const set of pieceInfo(piece).sets) sets.add(set); };
  if (dressing) {
    for (const p of dressing.props) add(p.piece);
    if (dressing.cables.length > 0) sets.add(CABLE_SET);
  }
  if (drones) add(DRONE);
  return TEXTURE_SETS.filter(set => sets.has(set));
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** A placement's transform: turned about y, scaled in its own frame. */
export function placementMatrix(p: PropPlacement, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(_pos.set(p.x, p.y, p.z), _quat.setFromEuler(_euler.set(0, p.yaw, 0)), _scale.set(...p.scale));
}

/** A placement's world box, from its piece's bounds in the manifest (no glb needed: the tests and the dressing use it). */
export function placementBox(p: PropPlacement, out = new THREE.Box3()): THREE.Box3 {
  const { min, max } = pieceInfo(p.piece);
  return out.set(new THREE.Vector3(...min), new THREE.Vector3(...max)).applyMatrix4(placementMatrix(p));
}

// -------------------------------------------------------------------- the kit

/** One texture set's triangles of a kit piece, in the piece's frame; `uv` in its set's tiles (a sign's face 0..1). */
export interface KitPart {
  set: string;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  colour: Float32Array;
  index: Uint32Array;
}
export type Kit = ReadonlyMap<string, readonly KitPart[]>;

function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

/**
 * A family glb's pieces as plain arrays: each node below the scene is a
 * piece, each of its meshes one texture set (the material's name). The
 * quantisation's transforms are applied and the UVs scaled back to tiles
 * (tools/props/build.mjs stores each primitive's in 0..1 with `extras.uv`).
 */
export function kitFromScene(scene: THREE.Object3D): Kit {
  scene.updateMatrixWorld(true);
  const kit = new Map<string, KitPart[]>();
  const normalMatrix = new THREE.Matrix3(), v = new THREE.Vector3();
  for (const node of scene.children) {
    const parts: KitPart[] = [];
    node.traverse(child => {
      if (!isMesh(child)) return;
      const g = child.geometry, material = child.material as THREE.Material;
      const position = g.getAttribute('position'), normal = g.getAttribute('normal'), uv = g.getAttribute('uv'), colour = g.getAttribute('color');
      const [ou, ov, su, sv] = (g.userData.uv as number[] | undefined) ?? [0, 0, 1, 1];
      normalMatrix.getNormalMatrix(child.matrixWorld);
      const n = position.count, part: KitPart = { set: material.name, position: new Float32Array(3 * n), normal: new Float32Array(3 * n),
        uv: new Float32Array(2 * n), colour: new Float32Array(3 * n), index: new Uint32Array(g.index ? g.index.count : n) };
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).toArray(part.position, 3 * i);
        v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(part.normal, 3 * i);
        part.uv[2 * i] = ou! + uv.getX(i) * su!;
        part.uv[2 * i + 1] = ov! + uv.getY(i) * sv!;
        part.colour.set([colour.getX(i), colour.getY(i), colour.getZ(i)], 3 * i);
      }
      for (let i = 0; i < part.index.length; i++) part.index[i] = g.index ? g.index.getX(i) : i;
      parts.push(part);
    });
    kit.set(node.name, parts);
  }
  return kit;
}

// ------------------------------------------------------------------ merging

/** Where the next vertex and index of one texture set's run go in its batch's arrays. */
interface Run {
  vertex: number;
  index: number;
}

/**
 * A merged mesh's worth of triangles, one run per texture set, in the order
 * sets were first reserved. Sizes are reserved first (`reserve`, the whole
 * dressing's count), then the arrays are allocated once and written in
 * place, so finishing the mesh copies nothing.
 */
class Batch {
  readonly #sizes = new Map<string, [number, number]>();
  #runs: Map<string, Run> | null = null;
  position = new Float32Array(0);
  normal = new Float32Array(0);
  uv = new Float32Array(0);
  colour = new Float32Array(0);
  index: Uint16Array | Uint32Array = new Uint16Array(0);

  reserve(set: string, vertices: number, indices: number): void {
    const size = this.#sizes.get(set) ?? [0, 0];
    this.#sizes.set(set, [size[0] + vertices, size[1] + indices]);
  }

  get empty(): boolean { return this.#sizes.size === 0; }

  /** The run of `set` (its arrays allocated on the first call). */
  run(set: string): Run {
    if (this.#runs === null) {
      this.#runs = new Map();
      let vertex = 0, index = 0;
      for (const [name, [v, i]] of this.#sizes) {
        this.#runs.set(name, { vertex, index });
        vertex += v;
        index += i;
      }
      this.position = new Float32Array(3 * vertex);
      this.normal = new Float32Array(3 * vertex);
      this.uv = new Float32Array(2 * vertex);
      this.colour = new Float32Array(3 * vertex);
      this.index = vertex > 65535 ? new Uint32Array(index) : new Uint16Array(index);
    }
    const run = this.#runs.get(set);
    if (!run) throw new Error(`no room reserved for ${set}`);
    return run;
  }

  /** The merged geometry, a group per set, and the sets in group order. */
  geometry(): { geometry: THREE.BufferGeometry; sets: string[] } {
    const sets = [...this.#sizes.keys()];
    if (sets.length > 0) this.run(sets[0]!);
    const geometry = new THREE.BufferGeometry();
    let start = 0;
    sets.forEach((set, i) => {
      const count = this.#sizes.get(set)![1];
      geometry.addGroup(start, count, i);
      start += count;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colour, 3));
    geometry.setIndex(new THREE.BufferAttribute(this.index, 1));
    geometry.computeBoundingBox();
    // The box's sphere: three's own pass over every vertex again costs more than the culling it saves.
    geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
    return { geometry, sets };
  }
}

/** Reserve a placement's room in a batch. */
function reservePiece(batch: Batch, parts: readonly KitPart[]): void {
  for (const part of parts) batch.reserve(part.set, part.position.length / 3, part.index.length);
}

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _tint = new THREE.Color();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * How far a piece's texture stretches along its planar frame's axes under a
 * placement's scale: the level's planar UVs (surfaces.ts `planarUVs`) in the
 * piece's frame, so a drainpipe scaled to a wall keeps square texels.
 */
function stretch(nx: number, ny: number, nz: number, scale: Vec3): [number, number] {
  _v.set(nx, ny, nz);
  if (Math.abs(ny) >= Math.max(Math.abs(nx), Math.abs(nz))) {
    _t.set(1, 0, 0).addScaledVector(_v, -nx).normalize();
    _s.crossVectors(_v, _t);
  } else {
    _s.set(0, 1, 0).addScaledVector(_v, -ny).normalize();
    _t.crossVectors(_s, _v);
  }
  return [Math.hypot(_t.x * scale[0], _t.y * scale[1], _t.z * scale[2]), Math.hypot(_s.x * scale[0], _s.y * scale[1], _s.z * scale[2])];
}

/** Write a piece's parts under a placement into a batch: world positions, normals, tinted colours, UVs as the level's. */
function addPiece(batch: Batch, parts: readonly KitPart[], p: PropPlacement): void {
  placementMatrix(p, _m);
  _n.getNormalMatrix(_m);
  _tint.set(p.tint);
  const signs = PROP_MANIFEST.atlases.signs, col = p.cell % signs.cols, row = Math.floor(p.cell / signs.cols);
  // A texture phase per placement, so two crates side by side do not wear the same boards.
  const du = (p.x * 0.618 + p.z * 0.382) % 1, dv = (p.z * 0.618 - p.y * 0.25) % 1;
  for (const part of parts) {
    const run = batch.run(part.set), base = run.vertex, n = part.position.length / 3;
    const { position, normal, uv, colour, index } = batch;
    for (let i = 0; i < n; i++) {
      const o = base + i;
      _v.fromArray(part.position, 3 * i).applyMatrix4(_m).toArray(position, 3 * o);
      const nx = part.normal[3 * i]!, ny = part.normal[3 * i + 1]!, nz = part.normal[3 * i + 2]!;
      _v.set(nx, ny, nz).applyMatrix3(_n).normalize().toArray(normal, 3 * o);
      colour[3 * o] = part.colour[3 * i]! * _tint.r;
      colour[3 * o + 1] = part.colour[3 * i + 1]! * _tint.g;
      colour[3 * o + 2] = part.colour[3 * i + 2]! * _tint.b;
      const u = part.uv[2 * i]!, w = part.uv[2 * i + 1]!;
      if (part.set === SIGNS) {
        // Inset half a texel of the smallest atlas, so no filtering reads the next cell.
        const inset = 0.5 / 64;
        uv[2 * o] = (col + inset + u * (1 - 2 * inset)) / signs.cols;
        uv[2 * o + 1] = (row + inset + w * (1 - 2 * inset)) / signs.rows;
      } else {
        const [su, sv] = stretch(nx, ny, nz, p.scale);
        uv[2 * o] = u * su + du;
        uv[2 * o + 1] = w * sv + dv;
      }
    }
    for (let k = 0; k < part.index.length; k++) index[run.index + k] = base + part.index[k]!;
    run.vertex += n;
    run.index += part.index.length;
  }
}

/** The dark rubber of the cables (the `paint` set, near black). */
const CABLE_SET = 'paint';
const CABLE_COLOUR = new THREE.Color().setRGB(0.012, 0.012, 0.013);
const CABLE_SEGMENTS = 14;
const CABLE_SIDES = 5;

/** Reserve a cable's room in a batch. */
function reserveCable(batch: Batch): void {
  batch.reserve(CABLE_SET, (CABLE_SEGMENTS + 1) * CABLE_SIDES, CABLE_SEGMENTS * CABLE_SIDES * 6);
}

/** A cable as a thin tube down a parabola between its ends, into a batch. */
function addCable(batch: Batch, cable: CablePlacement): void {
  const run = batch.run(CABLE_SET), base = run.vertex;
  const a = new THREE.Vector3(...cable.from), b = new THREE.Vector3(...cable.to);
  const along = b.clone().sub(a), length = along.length();
  const side = along.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 0.5) side.set(1, 0, 0);
  const point = new THREE.Vector3(), up = new THREE.Vector3().copy(side).cross(along).normalize(), normal = new THREE.Vector3();
  let o = base;
  for (let i = 0; i <= CABLE_SEGMENTS; i++) {
    const t = i / CABLE_SEGMENTS;
    point.copy(a).addScaledVector(along, t);
    point.y -= 4 * cable.sag * t * (1 - t);
    for (let k = 0; k < CABLE_SIDES; k++, o++) {
      const angle = (k / CABLE_SIDES) * Math.PI * 2;
      normal.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
      batch.position.set([point.x + normal.x * cable.radius, point.y + normal.y * cable.radius, point.z + normal.z * cable.radius], 3 * o);
      batch.normal.set([normal.x, normal.y, normal.z], 3 * o);
      batch.uv.set([k / CABLE_SIDES, t * length], 2 * o);
      batch.colour.set([CABLE_COLOUR.r, CABLE_COLOUR.g, CABLE_COLOUR.b], 3 * o);
    }
  }
  let i = run.index;
  for (let s = 0; s < CABLE_SEGMENTS; s++) {
    for (let k = 0; k < CABLE_SIDES; k++) {
      const a0 = base + s * CABLE_SIDES + k, a1 = base + s * CABLE_SIDES + (k + 1) % CABLE_SIDES;
      batch.index.set([a0, a0 + CABLE_SIDES, a1, a1, a0 + CABLE_SIDES, a1 + CABLE_SIDES], i);
      i += 6;
    }
  }
  run.vertex = o;
  run.index = i;
}

const FACING: Readonly<Record<DecalPlacement['facing'], { normal: Vec3; up: Vec3 }>> = {
  '+x': { normal: [1, 0, 0], up: [0, 1, 0] }, '-x': { normal: [-1, 0, 0], up: [0, 1, 0] },
  '+z': { normal: [0, 0, 1], up: [0, 1, 0] }, '-z': { normal: [0, 0, -1], up: [0, 1, 0] },
  '+y': { normal: [0, 1, 0], up: [0, 0, -1] },
};

/** The grime decals as one geometry: a quad each, its cell's UVs and its `strength`. */
export function decalGeometry(decals: readonly DecalPlacement[]): THREE.BufferGeometry | null {
  if (decals.length === 0) return null;
  const grime = PROP_MANIFEST.atlases.grime, inset = 0.5 / 64;
  const position: number[] = [], uv: number[] = [], strength: number[] = [], index: number[] = [];
  const n = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  for (const d of decals) {
    const f = FACING[d.facing];
    n.fromArray(f.normal);
    up.fromArray(f.up).applyAxisAngle(n, d.turn);
    right.crossVectors(up, n);
    c.set(d.x, d.y, d.z).addScaledVector(n, DECAL_LIFT);
    const col = d.cell % grime.cols, row = Math.floor(d.cell / grime.cols), base = position.length / 3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      q.copy(c).addScaledVector(right, sx * d.width / 2).addScaledVector(up, sy * d.height / 2);
      position.push(q.x, q.y, q.z);
      uv.push((col + (sx > 0 ? 1 - inset : inset)) / grime.cols, (row + (sy > 0 ? 1 - inset : inset)) / grime.rows);
      strength.push(d.strength);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('strength', new THREE.Float32BufferAttribute(strength, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A merged mesh of the dressing: its geometry and the set each group wears. */
export interface DressingPart {
  kind: 'large' | 'small' | 'backdrop';
  geometry: THREE.BufferGeometry;
  sets: string[];
}

/**
 * Merge a map's dressing into as few meshes as its looks allow and culling
 * wants: the pieces that cast shadows and the cables per `PROP_CELL`, the
 * small pieces per `PROP_CELL`, the backdrops in one. Deterministic: the same
 * dressing and kit give the same geometry in the same order. A step merges
 * placements, then finishes meshes, for about its budget of milliseconds (at
 * least one of either), so the streamer spreads the work over frames (a
 * map's whole merge is 20-120 ms of script).
 */
export class DressingMerge {
  readonly #dressing: LevelDressing;
  readonly #kit: Kit;
  readonly #large = new Map<string, Batch>();
  readonly #backdrop = new Batch();
  readonly #small = new Map<string, Batch>();
  readonly #cell: number;
  #next = 0;
  #pending: [DressingPart['kind'], Batch][] | null = null;
  readonly parts: DressingPart[] = [];

  constructor(dressing: LevelDressing, kit: Kit, cell = PROP_CELL) {
    this.#dressing = dressing;
    this.#kit = kit;
    this.#cell = cell;
    // Every run's size first, so each batch allocates its arrays once and the steps write in place.
    for (const p of dressing.props) {
      const parts = kit.get(p.piece);
      if (!parts) throw new Error(`the ${dressing.family} kit has no ${p.piece}`);
      reservePiece(this.#batchOf(p), parts);
    }
    for (const cable of dressing.cables) reserveCable(this.#cableBatch(cable));
  }

  /** The batch a placement merges into: the backdrops', or its cell's of the small pieces or the casters. */
  #batchOf(p: PropPlacement): Batch {
    const info = pieceInfo(p.piece);
    if (info.backdrop) return this.#backdrop;
    return cellBatch(info.small ? this.#small : this.#large, p.x, p.z, this.#cell);
  }

  /** A cable's batch: the casters' cell of its middle. */
  #cableBatch(cable: CablePlacement): Batch {
    return cellBatch(this.#large, (cable.from[0] + cable.to[0]) / 2, (cable.from[2] + cable.to[2]) / 2, this.#cell);
  }

  /** Work for about `budget` ms; true once every mesh is finished (`parts`). */
  step(budget: number): boolean {
    const until = performance.now() + budget, props = this.#dressing.props;
    if (this.#pending === null) {
      do {
        const p = props[this.#next];
        if (p === undefined) break;
        addPiece(this.#batchOf(p), this.#kit.get(p.piece)!, p);
        this.#next++;
      } while (performance.now() < until);
      if (this.#next < props.length) return false;
      for (const cable of this.#dressing.cables) addCable(this.#cableBatch(cable), cable);
      const cells = (kind: DressingPart['kind'], batches: Map<string, Batch>) =>
        [...batches.keys()].sort().map(key => [kind, batches.get(key)!] as [DressingPart['kind'], Batch]);
      this.#pending = [...cells('large', this.#large), ['backdrop', this.#backdrop], ...cells('small', this.#small)];
      this.#pending = this.#pending.filter(([, batch]) => !batch.empty);
      return false;
    }
    do {
      const next = this.#pending.shift();
      if (next) this.parts.push({ kind: next[0], ...next[1].geometry() });
    } while (this.#pending.length > 0 && performance.now() < until);
    return this.#pending.length === 0;
  }
}

/** The batch of the cell at (x, z) in a map of cells, made on first use. */
function cellBatch(cells: Map<string, Batch>, x: number, z: number, cell: number): Batch {
  const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  let batch = cells.get(key);
  if (!batch) cells.set(key, batch = new Batch());
  return batch;
}

/** The whole merge at once (`DressingMerge`), for tests and tools. */
export function mergeDressing(dressing: LevelDressing, kit: Kit, cell = PROP_CELL): DressingPart[] {
  const merge = new DressingMerge(dressing, kit, cell);
  while (!merge.step(Infinity));
  return merge.parts;
}

/** The drone's geometry (one group per set) in the flat cone's frame at scale 1. */
export function droneGeometry(kit: Kit): DressingPart | null {
  const parts = kit.get(DRONE);
  if (!parts) return null;
  const batch = new Batch();
  reservePiece(batch, parts);
  addPiece(batch, parts, { piece: DRONE, x: 0, y: 0, z: 0, yaw: 0, scale: [1, 1, 1], tint: 0xffffff, cell: 0 });
  return { kind: 'large', ...batch.geometry() };
}

/** The material of one group: a level set in the kit's material (the backdrops' by the sky alone), or the signs atlas. */
function lookFor(set: string, far: boolean): THREE.Material {
  return set === SIGNS ? signsMat() : kitMat(set as TextureSet, setInfo(set as TextureSet), far);
}

// ---------------------------------------------------------------- streaming

/** How `PropAssets` reaches the network and the GPU; the renderer's in the game, stand-ins in tests. */
export interface PropLoaders {
  model(url: string): Promise<{ scene: THREE.Object3D }>;
  texture: LoadTexture;
  upload(texture: THREE.Texture): void;
  /** Compile the merged meshes' programs off the frame and draw them once unseen (the renderer's held compile and warm-up). */
  warm?(root: THREE.Object3D): Promise<void>;
}

/** What a level asks of the kit: its dressing (null: none) and its drones. */
export interface PropRequest {
  dressing: LevelDressing | null;
  movers: readonly GrappleMover[];
}

/** A merged mesh that casts: its shadow pass's material and runs (materials.ts `casterGroups`). */
interface Caster {
  mesh: THREE.Mesh;
  material: THREE.Material[];
  groups: THREE.GeometryGroup[];
}
/** Read by the shadow pass every frame: no list is made for a map without casters. */
const NO_CASTERS: readonly Caster[] = [];

interface Atlases {
  size: TextureSize;
  maps: Map<PropAtlas, THREE.Texture> | null;
  failed: boolean;
  uploaded: number;
  /** GPU bytes of the uploaded atlases, counted before their CPU copy was freed. */
  bytes: number;
}

/**
 * Streams the kit for the realistic tiers like the weapons (render/weapons.ts):
 * `want(request, size)` starts the atlases at the Textures size downloading
 * and `fetch()` the map family's glb (the menu never waits); `pump()` uploads one atlas
 * a call in the renderer's upload slots, then merges the map's dressing
 * (`mergeDressing`, a few milliseconds) and has its programs compiled and
 * drawn once unseen; then the meshes join `root`, the drones put on the kit's
 * drone, and `ready` turns true. A new map with the same family merges again
 * from the kit already in; a new size keeps the old atlases on until the new
 * ones are in. `want(null)` (Low) frees it all and gives the drones back
 * their cones.
 */
export class PropAssets {
  /** Where the merged meshes and the decals live; the renderer keeps it in the scene. */
  readonly root = new THREE.Group();
  readonly #loaders: PropLoaders;
  #request: PropRequest | null = null;
  #size: TextureSize | null = null;
  #family: PropFamily | null = null;
  #kit: Kit | null = null;
  #kitFamily: PropFamily | null = null;
  #kitFailed = false;
  #atlases: Atlases[] = [];
  #worn: Atlases | null = null;
  /** The merge for the current request is built (and its programs warming, or warm and shown), and at what detail. */
  #built: THREE.Group | null = null;
  #detail: PropDetail = FULL_DETAIL;
  /** The current request's merge while it runs, one step a pump. */
  #merge: DressingMerge | null = null;
  #shown = false;
  #small: THREE.Mesh[] = [];
  #casters: Caster[] = [];
  /** The drones wearing the kit: each mover's mesh, its flat material, and the kit's mesh on it. */
  #drones: { mover: THREE.Mesh; material: THREE.Material | THREE.Material[]; model: THREE.Mesh }[] = [];
  #generation = 0;
  readonly #warned = new Set<string>();

  constructor(loaders: PropLoaders) {
    this.#loaders = loaders;
    this.root.name = 'props';
  }

  /** The current map's dressing is merged, warm and shown. */
  get ready(): boolean { return this.#shown; }
  /** A realistic tier wants the kit (a new map, or another size of the atlases) and it is not all in, nor failed. */
  get pending(): boolean {
    if (this.#request === null || this.#size === null || this.#kitFailed) return false;
    const atlases = this.#atlases.find(a => a.size === this.#size);
    if (atlases?.failed) return false;
    return !this.#shown || this.#worn?.size !== this.#size;
  }

  /** The level's merged casters' shadow runs (materials.ts `casterGroups`), for the renderer's shadow pass. */
  get casters(): readonly Caster[] {
    return this.#shown ? this.#casters : NO_CASTERS;
  }

  /** Is this the merge being warmed or shown now (the renderer drops a held warm-up of an older one)? */
  holds(root: THREE.Object3D): boolean {
    return root === this.#built;
  }

  /** Is this mover wearing the kit's drone (its flat cone hidden)? */
  wearsDrone(mesh: THREE.Object3D): boolean {
    return this.#drones.some(d => d.mover === mesh);
  }

  want(request: PropRequest | null, size: TextureSize | null): void {
    if (request === null || size === null) {
      if (this.#request !== null || this.#size !== null || this.#kit !== null) this.clear();
      return;
    }
    const family = request.dressing?.family ?? this.#family;
    if (request !== this.#request) {
      this.#unbuild();
      this.#request = request;
    }
    this.#family = family;
    if (size !== this.#size) {
      this.#size = size;
      // Another detail merges again (from the kit in memory); the atlases swap as for any size.
      if (this.#built !== null && propDetail(size) !== this.#detail) this.#unbuild();
      for (const set of this.#atlases) if (set !== this.#worn && set.size !== size) this.#free(set);
      this.#atlases = this.#atlases.filter(set => set === this.#worn || set.size === size);
      if (!this.#atlases.some(set => set.size === size)) this.#loadAtlases(size);
    }
  }

  /**
   * Start the wanted family's glb downloading, if it is not in or on its
   * way. Apart from `want`: three parses a glb on the main thread (15-25 ms
   * with the kit's own pass), which the renderer keeps out of a match's
   * quiet start.
   */
  fetch(): void {
    if (this.#request !== null && this.#family !== null && this.#family !== this.#kitFamily) this.#loadKit(this.#family);
  }

  #loadKit(family: PropFamily): void {
    this.#kit = null;
    this.#kitFamily = family;
    this.#kitFailed = false;
    const generation = this.#generation;
    this.#loaders.model(propsUrl(family)).then(({ scene }) => {
      if (generation !== this.#generation || this.#kitFamily !== family) return;
      this.#kit = kitFromScene(scene);
      scene.traverse(node => { if (isMesh(node)) node.geometry.dispose(); });
    }, (error: unknown) => {
      if (generation !== this.#generation || this.#kitFamily !== family) return;
      this.#kitFailed = true;
      this.#warn(family, error);
    });
  }

  #loadAtlases(size: TextureSize): void {
    const set: Atlases = { size, maps: null, failed: false, uploaded: 0, bytes: 0 };
    this.#atlases.push(set);
    const generation = this.#generation;
    Promise.all(PROP_ATLASES.map(atlas => this.#loaders.texture(propAtlasUrl(atlasSize(atlas, size), atlas), atlas === 'signs' ? 8 : 1).then(texture => {
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      return [atlas, texture] as const;
    }))).then(loaded => {
      if (generation !== this.#generation || !this.#atlases.includes(set)) {
        for (const [, texture] of loaded) texture.dispose();
        return;
      }
      set.maps = new Map(loaded);
    }, (error: unknown) => {
      if (generation !== this.#generation || !this.#atlases.includes(set)) return;
      set.failed = true;
      this.#warn(`atlases ${size}`, error);
    });
  }

  #warn(what: string, error: unknown): void {
    if (this.#warned.has(what)) return;
    this.#warned.add(what);
    console.warn(`props ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * One step: upload the next atlas (its GPU bytes), or once both are up
   * and the kit is in, a step of merging the map's dressing (`MERGE_STEP_MS`
   * of script, 0: it uploads nothing, so the next frame may step again), and
   * once it is merged, build its meshes and hand them to be warmed (the
   * merged geometry's bytes). 0 too when there is nothing to do yet.
   */
  pump(): number {
    const atlases = this.#atlases.find(a => a.size === this.#size && a !== this.#worn && a.maps !== null);
    if (atlases?.maps) {
      const atlas = PROP_ATLASES[atlases.uploaded];
      if (atlas !== undefined) {
        const texture = atlases.maps.get(atlas)!, bytes = textureBytes(texture);
        this.#loaders.upload(texture);
        if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
        atlases.uploaded++;
        atlases.bytes += bytes;
        if (atlases.uploaded === PROP_ATLASES.length) this.#wear(atlases);
        return bytes;
      }
    }
    if (this.#built !== null || this.#worn === null || this.#request === null) return 0;
    const kit = this.#kit, dressing = this.#request.dressing;
    if (dressing !== null && (kit === null || this.#kitFamily !== dressing.family)) return 0;
    if (dressing !== null && kit !== null) {
      this.#merge ??= new DressingMerge(dressing, kit, propDetail(this.#size!).cell);
      if (!this.#merge.step(MERGE_STEP_MS)) return 0;
    }
    return this.#build(kit);
  }

  #wear(atlases: Atlases): void {
    signsMat().map = atlases.maps!.get('signs')!;
    grimeMat().uniforms.map!.value = atlases.maps!.get('grime')!;
    if (this.#worn) this.#free(this.#worn);
    this.#atlases = this.#atlases.filter(set => set === atlases);
    this.#worn = atlases;
  }

  #build(kit: Kit | null): number {
    const request = this.#request!, group = new THREE.Group(), generation = this.#generation;
    group.name = 'dressing';
    this.#built = group;
    this.#detail = propDetail(this.#size!);
    let bytes = 0;
    const parts = this.#merge?.parts ?? [];
    this.#merge = null;
    this.#small = [];
    this.#casters = [];
    for (const part of parts) {
      const looks = part.sets.map(set => lookFor(set, part.kind === 'backdrop'));
      const mesh = new THREE.Mesh(part.geometry, looks);
      mesh.name = `props-${part.kind}`;
      mesh.castShadow = part.kind === 'large';
      mesh.receiveShadow = part.kind !== 'backdrop';
      mesh.matrixAutoUpdate = false;
      if (mesh.castShadow) {
        mesh.customDepthMaterial = levelDepthMat();
        this.#casters.push({ mesh, material: [looks[0]!], groups: casterGroups(part.geometry.groups, looks) });
      }
      if (part.kind === 'small') this.#small.push(mesh);
      group.add(mesh);
      bytes += geometryBytes(part.geometry);
      freeOnUpload(part.geometry);
    }
    const decals = request.dressing ? decalGeometry(request.dressing.decals) : null;
    if (decals) {
      const mesh = new THREE.Mesh(decals, grimeMat());
      mesh.name = 'props-grime';
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      bytes += geometryBytes(decals);
      freeOnUpload(decals);
    }
    const drone = kit ? droneGeometry(kit) : null;
    const models: THREE.Mesh[] = [];
    if (drone) {
      for (const mover of request.movers) {
        if (!isMesh(mover.mesh)) continue;
        const model = new THREE.Mesh(drone.geometry, drone.sets.map(set => lookFor(set, false)));
        model.name = 'drone';
        model.scale.setScalar(mover.radius / DRONE_RADIUS);
        model.castShadow = false;
        models.push(model);
      }
      bytes += geometryBytes(drone.geometry);
      freeOnUpload(drone.geometry);
      // The drones warm with the rest: one of them under the group while it compiles.
      if (models[0]) group.add(models[0]);
    }
    const reveal = () => {
      if (generation !== this.#generation || this.#built !== group) return;
      if (models[0]) group.remove(models[0]);
      this.#drones = [];
      request.movers.forEach((mover, i) => {
        const model = models[i];
        if (!model || !isMesh(mover.mesh)) return;
        this.#drones.push({ mover: mover.mesh, material: mover.mesh.material, model });
        mover.mesh.material = hiddenMat();
        mover.mesh.add(model);
      });
      this.root.add(group);
      this.#shown = true;
    };
    if (this.#loaders.warm) void this.#loaders.warm(group).then(reveal);
    else reveal();
    return bytes;
  }

  /** Take the current merge down (a new map, Low): free its geometry, give the drones back their cones. */
  #unbuild(): void {
    if (this.#built) {
      this.root.remove(this.#built);
      const geometries = new Set<THREE.BufferGeometry>();
      this.#built.traverse(node => { if (isMesh(node)) geometries.add(node.geometry); });
      for (const { mover, material, model } of this.#drones) {
        mover.remove(model);
        if (mover.material === hiddenMat()) mover.material = material;
        geometries.add(model.geometry);
      }
      for (const geometry of geometries) geometry.dispose();
    }
    this.#built = null;
    this.#merge = null;
    this.#shown = false;
    this.#small = [];
    this.#casters = [];
    this.#drones = [];
  }

  /** Hide the small pieces' cells beyond their distance (`propDetail`) of the eye. */
  update(camera: THREE.Camera): void {
    if (!this.#shown || this.#small.length === 0) return;
    camera.getWorldPosition(_v);
    for (const mesh of this.#small) mesh.visible = mesh.geometry.boundingBox!.distanceToPoint(_v) < this.#detail.small;
  }

  #free(set: Atlases): void {
    for (const texture of set.maps?.values() ?? []) texture.dispose();
    set.maps = null;
  }

  /** Free everything and put the stand-ins back on the materials (Low, a lost context, dispose). */
  clear(): void {
    this.#generation++;
    this.#unbuild();
    for (const set of this.#atlases) this.#free(set);
    this.#atlases = [];
    this.#worn = null;
    this.#request = null;
    this.#size = null;
    this.#family = null;
    this.#kit = null;
    this.#kitFamily = null;
    this.#kitFailed = false;
    signsMat().map = standInSigns;
    grimeMat().uniforms.map!.value = standInGrime;
  }

  /** Texture objects alive here and their GPU bytes, and the merged meshes, for the tier report and the leak test. */
  get stats(): { textures: number; residentBytes: number; meshes: number; triangles: number } {
    let textures = 0, residentBytes = 0, meshes = 0, triangles = 0;
    for (const set of this.#atlases) {
      textures += set.maps?.size ?? 0;
      residentBytes += set.bytes;
    }
    this.#built?.traverse(node => {
      if (!isMesh(node)) return;
      meshes++;
      triangles += (node.geometry.index?.count ?? 0) / 3;
    });
    return { textures, residentBytes, meshes, triangles };
  }
}

const standInSigns = signsMat().map;
const standInGrime = grimeMat().uniforms.map!.value as THREE.Texture;

/** Drop the CPU copy of an attribute once the GPU has it. */
function dropArray(this: THREE.BufferAttribute): void {
  this.array = this.array.slice(0, 0);
}

/**
 * The merged meshes' arrays go once uploaded (10-14 MB a map): nothing reads
 * them again (the culling reads the boxes and spheres made with them, the
 * shadow pass the groups), and a lost context merges the kit again.
 */
function freeOnUpload(geometry: THREE.BufferGeometry): void {
  for (const attribute of Object.values(geometry.attributes)) (attribute as THREE.BufferAttribute).onUpload(dropArray);
  geometry.index?.onUpload(dropArray);
}

function geometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) bytes += (attribute.array as ArrayLike<number> & { byteLength: number }).byteLength;
  return bytes;
}

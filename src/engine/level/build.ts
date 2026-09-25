import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfMat, cloudMat, TONE, boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo } from '../render/index';
import { DEFAULT_MATERIAL, MATERIAL_SET, planarUVs, setInfo } from '../render/surfaces';
import type { SurfKey } from '../render/palette';
import type { MaterialTag } from '../render/surfaces';
import type { Box, World } from '../physics';
import type { Breakable, BreakableKind, Level, LevelKey } from '../types';

const surfaces: readonly SurfKey[] = ['block', 'hot', 'dark', 'accent', 'foliage', 'boss'];
const yAxis = new THREE.Vector3(0, 1, 0);

/** Flags shared by every primitive. `mat`/`surface` win over `tone`. */
export interface BuildOpts {
  mat?: SurfKey;
  surface?: SurfKey;
  tone?: number;
  /**
   * What the piece is made of, for the realistic tiers (render/surfaces.ts).
   * Low still draws the surface key; without a tag the key's default applies.
   */
  material?: MaterialTag;
  /**
   * Drawn on the flat look only: detail the realistic tiers' textures already
   * carry (paving joints), which would draw a second grid over the texture's.
   */
  flatOnly?: boolean;
  rotation?: THREE.Euler;
  /** Keep this piece as its own object instead of merging it. */
  separate?: boolean;
  /** A separate piece the level moves (the drones): left out of the baked lighting. */
  moving?: boolean;
  noCollide?: boolean;
  noNav?: boolean;
  noShoot?: boolean;
  noGrapple?: boolean;
  segments?: number;
  tag?: unknown;
}

export interface StairOpts extends BuildOpts {
  rise?: number;
  run?: number;
}

export interface PlaneOpts extends BuildOpts {
  scale?: number;
  radiusStep?: number;
  heightStep?: number;
  speed?: number;
}

/** A cloud bank: its centre and a size scale. The bank lies across the line to the map centre. */
export type CloudBank = readonly [x: number, y: number, z: number, scale: number];

export interface BreakOpts {
  hp?: number;
  tone?: number;
}

/** `[from, to]` along the wall axis, with an optional `[bottom, top]` height window. */
export type Gap = [number, number, number?, number?];

/** The marker lists on `Level`, all of them `THREE.Vector3[]`. */
export type MarkerKind = 'spawns' | 'snipers' | 'pickups' | 'rings' | 'arenaSpawns';

/**
 * A piece ready to merge: texture coordinates in the material's tile size
 * (planar per face, `planarUVs`), in the geometry's current space, and an
 * index. Boxes keep their own; a smooth sphere or cylinder shares vertices
 * between faces that need different coordinates, so it splits into separate
 * triangles first. Every primitive leaves here in the same layout, so any of
 * them can merge.
 */
function surfaceGeometry(geometry: THREE.BufferGeometry, material: MaterialTag): THREE.BufferGeometry {
  const tile = setInfo(MATERIAL_SET[material]).tile;
  if (planarUVs(geometry, tile)) return geometry;
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  planarUVs(flat, tile);
  flat.setIndex([...Array(flat.getAttribute('position').count).keys()]);
  return flat;
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

export class LevelBuilder {
  scene: THREE.Scene;
  world: World;
  tone: typeof TONE;
  /**
   * World-space pieces waiting to merge, per surface key, then per material
   * tag (a flat-only piece under `flat`).
   */
  parts: Map<SurfKey, Map<MaterialTag | 'flat', THREE.BufferGeometry[]>>;
  level: Level;

  constructor(scene: THREE.Scene, world: World, key: LevelKey, arena: boolean) {
    this.scene = scene;
    this.world = world;
    this.tone = TONE;
    this.parts = new Map();
    const p = key === 'mexico' ? 62 : key === 'house' ? 39 : arena ? 68 : 55;
    this.level = {
      key, arena, playerStart: new THREE.Vector3(0, 0, key === 'mexico' ? 16 : key === 'house' ? 21 : 42),
      bounds: { minX: -p, maxX: p, minZ: -p, maxZ: p },
      spawns: [], snipers: [], pickups: [], rings: [], arenaSpawns: [], teamSpawns: [],
      movers: [], animated: [], breakables: [], meshes: [], surfaces: [],
      shadow: { center: new THREE.Vector3(), radius: p * 1.15 },
    };
  }

  addObject<T extends THREE.Object3D>(obj: T): T {
    obj.traverse(child => {
      if (isMesh(child)) child.castShadow = child.receiveShadow = true;
    });
    this.scene.add(obj);
    this.level.meshes.push(obj);
    return obj;
  }

  mesh(geometry: THREE.BufferGeometry, pos: THREE.Vector3 | [number, number, number],
    opts: BuildOpts = {}): THREE.Mesh {
    const key = opts.mat ?? opts.surface ?? surfaces[opts.tone ?? TONE.PRIMARY] ?? 'block';
    const material = opts.material ?? DEFAULT_MATERIAL[key];
    const object = new THREE.Mesh(geometry, surfMat(key));
    if (Array.isArray(pos)) object.position.fromArray(pos);
    else object.position.copy(pos);
    if (opts.rotation) object.rotation.copy(opts.rotation);
    if (opts.separate) {
      object.geometry = surfaceGeometry(geometry, material);
      this.level.surfaces.push({ mesh: object, surf: key, materials: [opts.flatOnly ? null : material], static: !opts.moving });
      return this.addObject(object);
    }
    object.updateMatrix();
    geometry.applyMatrix4(object.matrix);
    let tags = this.parts.get(key);
    if (tags === undefined) this.parts.set(key, tags = new Map());
    const tag = opts.flatOnly ? 'flat' : material;
    let group = tags.get(tag);
    if (group === undefined) tags.set(tag, group = []);
    group.push(surfaceGeometry(geometry, material));
    return object;
  }

  /**
   * A loose piece in the flat palette, not merged (breakable props, figure
   * accessories): textured on the realistic tiers like the merged level.
   */
  part(geometry: THREE.BufferGeometry, surf: SurfKey, material: MaterialTag = DEFAULT_MATERIAL[surf]): THREE.Mesh {
    const mesh = new THREE.Mesh(surfaceGeometry(geometry, material), surfMat(surf));
    mesh.castShadow = mesh.receiveShadow = true;
    this.level.surfaces.push({ mesh, surf, materials: [material], static: false });
    return mesh;
  }

  collider(x: number, y: number, z: number, w: number, h: number, d: number,
    opts: BuildOpts = {}): Box {
    return this.world.addBox(new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h, z + d / 2), {
        noNav: !!opts.noNav, noShoot: !!opts.noShoot,
        noGrapple: !!opts.noGrapple, ...(opts.tag === undefined ? {} : { tag: opts.tag }),
      });
  }

  box(x: number, y: number, z: number, w: number, h: number, d: number,
    opts: BuildOpts = {}): Box | null {
    this.mesh(boxGeo(w, h, d), [x, y + h / 2, z], opts);
    return opts.noCollide ? null : this.collider(x, y, z, w, h, d, opts);
  }

  slab(x1: number, z1: number, x2: number, z2: number, top: number, thickness: number,
    opts: BuildOpts = {}): Box | null {
    return this.box((x1 + x2) / 2, top - thickness, (z1 + z2) / 2,
      x2 - x1, thickness, z2 - z1, opts);
  }

  wall(axis: 'x' | 'z', a1: number, a2: number, fixed: number, base: number, height: number,
    thickness: number, gaps: readonly Gap[] = [], opts: BuildOpts = {}): void {
    const cuts = [...new Set([a1, a2, ...gaps.flatMap(g => [
      Math.max(a1, Math.min(a2, g[0])), Math.max(a1, Math.min(a2, g[1])),
    ])])].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i];
      // ponytail: `i` is in range, but `noUncheckedIndexedAccess` cannot see that.
      if (lo === undefined || hi === undefined) continue;
      const mid = (lo + hi) / 2;
      if (hi - lo < 0.005) continue;
      const holes = gaps.filter(g => g[0] < mid && g[1] > mid)
        .map((g): [number, number] => [Math.max(0, g[2] ?? 0), Math.min(height, g[3] ?? height)])
        .filter(g => g[1] > g[0]).sort((a, b) => a[0] - b[0]);
      let bottom = 0;
      const solid = (top: number) => {
        if (top - bottom < 0.005) return;
        if (axis === 'x') this.box(mid, base + bottom, fixed, hi - lo, top - bottom, thickness, opts);
        else this.box(fixed, base + bottom, mid, thickness, top - bottom, hi - lo, opts);
      };
      for (const [from, to] of holes) { solid(from); bottom = Math.max(bottom, to); }
      solid(height);
    }
  }

  stairs(x: number, y: number, z: number, dir: '+x' | '-x' | '+z' | '-z', n: number, width: number,
    opts: StairOpts = {}): void {
    const rise = opts.rise ?? 4 / 14, run = opts.run ?? 0.45;
    const alongX = dir.endsWith('x'), sign = dir.startsWith('-') ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const distance = sign * (i + 0.5) * run;
      this.box(x + (alongX ? distance : 0), y, z + (alongX ? 0 : distance),
        alongX ? run + 0.004 : width, (i + 1) * rise,
        alongX ? width : run + 0.004, opts);
    }
  }

  rail(x1: number, z1: number, x2: number, z2: number, y: number, opts: BuildOpts = {}): Box {
    const length = Math.hypot(x2 - x1, z2 - z1), alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const x = (x1 + x2) / 2, z = (z1 + z2) / 2;
    const look: BuildOpts = { mat: 'metal', ...opts, noCollide: true };
    this.box(x, y + 0.9, z, alongX ? length : 0.12, 0.12, alongX ? 0.12 : length, look);
    const n = Math.max(1, Math.round(length / 2));
    for (let i = 0; i <= n; i++) {
      this.box(x1 + (x2 - x1) * i / n, y, z1 + (z2 - z1) * i / n, 0.1, 0.9, 0.1, look);
    }
    return this.collider(x, y, z, alongX ? length : 0.12, 1, alongX ? 0.12 : length,
      { ...opts, noNav: true, noShoot: true });
  }

  cylinder(x: number, y: number, z: number, r: number, h: number,
    opts: BuildOpts = {}): Box | null {
    this.mesh(cylGeo(r, h, opts.segments ?? 8, 'y'), [x, y + h / 2, z], opts);
    return opts.noCollide ? null : this.collider(x, y, z, 1.6 * r, h, 1.6 * r, opts);
  }

  sphere(x: number, y: number, z: number, r: number, opts: BuildOpts = {}): THREE.Mesh {
    return this.mesh(sphereGeo(r, opts.segments ?? 8), [x, y, z], opts);
  }

  ring(x: number, y: number, z: number, orientation: 'x' | 'y' | 'z' = 'y'): void {
    const rotation = new THREE.Euler(orientation === 'y' ? Math.PI / 2 : 0,
      orientation === 'x' ? Math.PI / 2 : 0, 0);
    this.mesh(torusGeo(0.6, 0.1), [x, y, z], { mat: 'accent', rotation });
    this.marker('rings', x, y, z);
  }

  marker(kind: MarkerKind, x: number, y: number, z: number): void {
    this.level[kind].push(new THREE.Vector3(x, y, z));
  }

  planes(n: number, baseRadius: number, baseHeight: number, opts: PlaneOpts = {}): void {
    const scale = opts.scale ?? 1, radiusStep = opts.radiusStep ?? 12;
    const heightStep = opts.heightStep ?? 6, speed = opts.speed ?? 0.11;
    for (let i = 0; i < n; i++) {
      const geo = coneGeo(1.2 * scale, 4 * scale, 3);
      geo.rotateX(Math.PI / 2);
      const mesh = this.mesh(geo, [0, 0, 0], { material: 'painted-metal', ...opts, separate: true, moving: true });
      const r = baseRadius + i * radiusStep, h = baseHeight + i * heightStep;
      const s = speed + 0.01 * i, phase = 2.1 * i;
      const next = new THREE.Vector3();
      const update = (time: number) => {
        const a = s * time + phase, ahead = a + 0.05;
        mesh.position.set(Math.cos(a) * r, h + 3 * Math.sin(2.3 * a), 0.7 * r * Math.sin(a));
        next.set(Math.cos(ahead) * r, h + 3 * Math.sin(2.3 * ahead), 0.7 * r * Math.sin(ahead));
        mesh.lookAt(next);
        mesh.rotateZ(0.6 * Math.sin(3 * a));
      };
      update(0);
      this.level.movers.push({ mesh, radius: 2.2 * scale });
      this.level.animated.push({ mesh, update });
    }
  }

  /**
   * Low-poly cloud banks merged into one mesh: one draw call, no fog and no
   * shadows, so they sit against the sky dome like the sun disc does.
   */
  clouds(banks: readonly CloudBank[], puffs = 7): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, y, z, s] of banks) {
      const angle = Math.atan2(z, x), tx = -Math.sin(angle), tz = Math.cos(angle);
      for (let i = 0; i < puffs; i++) {
        const mid = (puffs - 1) / 2, along = (i - mid) * 6.5 * s;
        const r = (5 + 2.5 * Math.sin(1.9 * i + angle) ** 2) * s * (i === Math.round(mid) ? 1.35 : 1);
        const puff = new THREE.IcosahedronGeometry(r, 1);
        puff.scale(1.25, 0.62, 1);
        puff.rotateY(Math.PI / 2 - angle); // long axis along the bank, broadside to the map
        puff.translate(x + tx * along, y + 1.8 * s * Math.sin(2.3 * i), z + tz * along);
        parts.push(puff);
      }
    }
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) return;
    const mesh = this.addObject(new THREE.Mesh(geometry, cloudMat()));
    mesh.castShadow = mesh.receiveShadow = false;
  }

  breakable(kind: BreakableKind, x: number, y: number, z: number, w: number, h: number, d: number,
    parts: THREE.Object3D[], opts: BreakOpts = {}): Breakable {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(...parts);
    this.addObject(group);
    const box = this.collider(x, y, z, w, h, d, { noNav: true });
    const prop: Breakable = { id: this.level.breakables.length, kind, group, hp: opts.hp ?? 1,
      pos: new THREE.Vector3(x, y + h / 2, z), alive: true, tone: opts.tone ?? TONE.ACCENT, box };
    box.data.breakable = prop;
    this.level.breakables.push(prop);
    return prop;
  }

  /**
   * Merge the pieces, one mesh per surface key with one geometry group per
   * material tag. Low draws each mesh whole in its surface colour, one call as
   * before; the realistic tiers give the groups their tags' materials
   * (render/index.ts), one call per tag. Neither look rebuilds geometry.
   */
  finish(): Level {
    for (const [surf, tags] of this.parts) {
      const groups = [...tags.values()], geometries = groups.flat();
      // ponytail: @types/three types mergeGeometries as non-null, but it returns null on
      // mismatched attributes, so the guard below is live despite looking dead.
      const geometry = mergeGeometries(geometries, false);
      if (!geometry) throw new Error('Level geometry could not be merged.');
      let start = 0;
      groups.forEach((group, i) => {
        const count = group.reduce((n, part) => n + (part.index?.count ?? 0), 0);
        geometry.addGroup(start, count, i);
        start += count;
      });
      for (const part of geometries) part.dispose();
      const mesh = this.addObject(new THREE.Mesh(geometry, surfMat(surf)));
      this.level.surfaces.push({ mesh, surf, materials: [...tags.keys()].map(tag => (tag === 'flat' ? null : tag)), static: true });
    }
    this.parts.clear();
    this.world.finalize();
    return this.level;
  }
}

import * as THREE from 'three';
import { clamp, rand, TAU } from './util';
import { cells, decalMaterial, flipbookFrame, shellMaterial, spriteGeometry, spriteMaterial, FX_MANIFEST } from './render/fx';
import type { Frame } from './render/fx';
import type { Impact, SurfaceFamily } from './render/impacts';
import type { World } from './physics';
import type { BoxFilter } from './types';

/**
 * The realistic tiers' combat effects (docs/VISUALS.md, R5): flipbook sprites
 * from the self-made atlases, lit bullet holes and scorch marks, bouncing
 * casings and the short point lights of shots and blasts. effects.ts makes
 * one while a realistic look is in force and its atlases are in, forwards
 * the recipes here, and frees it on Low; the flat look never builds any of it.
 *
 * Every pool is fixed in size (scaled by the effects detail) and reuses its
 * oldest slot when full, so a long fight allocates nothing and never grows.
 */

/** Where the pools draw: the scene, the soft pass's scene (render/index.ts `fxScene`), the eye, and the light pool. */
export interface RealContext {
  scene: THREE.Scene;
  late: THREE.Scene;
  camera: THREE.Camera;
  lights: readonly THREE.PointLight[];
  /** Soft particles (High, Ultra): the smoke blends and fades against the scene's depth in the late pass; else it dithers. */
  soft: boolean;
}

export type ShellKind = 'rifle' | 'pistol' | 'sniper' | 'shotgun';
/** A casing's length and diameter in metres (5.56, 9 mm, 7.62 and 12-gauge). */
export const SHELL_SIZE: Readonly<Record<ShellKind, readonly [number, number]>> = {
  rifle: [0.045, 0.0096], pistol: [0.019, 0.0099], sniper: [0.051, 0.012], shotgun: [0.07, 0.0203],
};

/** A bullet hole's decal, metres across (its crater or chipped ring fills about half of it). */
const HOLE_SIZE: Readonly<Record<SurfaceFamily, number>> = { metal: 0.13, masonry: 0.18, wood: 0.15, glass: 0.22, soil: 0.2 };
/**
 * The decal atlas's grey at a tinted family's rim, and its lightest texel
 * (tools/blender/effects/decals.py `SURFACE_GREY`): the surface's colour over
 * the rim's grey makes the rim the wall's own colour, so only the darker
 * crater and hole read, whatever the wall (a lighter wood rim stays lighter).
 */
export const DECAL_GREY: Readonly<Partial<Record<SurfaceFamily, readonly [rim: number, top: number]>>> = {
  masonry: [0.5, 0.6], wood: [0.45, 0.72], soil: [0.5, 0.6],
};

/** Metres a decal sits off the surface the ray hit (effects.ts lifts the flat discs 1.2-3 cm). */
const DECAL_LIFT = 0.03;

/** Pool sizes at full detail. */
export const REAL_CAPACITY = { fire: 192, lit: 320, decals: 192, shells: 48, lights: 2 } as const;

interface Sprite {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  /** Size at death over size at birth, eased out. */
  grow: number;
  color: THREE.Color;
  alpha: number;
  /** Share of the life to fade in over, and where the fade out starts. */
  fadeIn: number;
  fadeOut: number;
  first: number;
  count: number;
  /** Share of the flipbook played over the life: lingering smoke holds its dense first half. */
  span: number;
  rotation: number;
  spin: number;
  /** Stretched along the velocity (sparks) this many times its size; 0 for none. */
  stretch: number;
  /** Stretched along a fixed axis (a side-on flash); overrides `stretch`. */
  axis: THREE.Vector3 | null;
  /** Flat in the plane with this normal (a ground ring). */
  flat: THREE.Vector3 | null;
  gravity: number;
  drag: number;
  /** Bounces off the world (chips, splinters, shards). */
  bounce: boolean;
  ring: boolean;
  /** Stamped at spawn; a handle's `stop` ends the sprites of its own stamp. */
  tag: number;
  /** Born this frame: drawn at full strength before it starts to age, as the tracers are (a 50 ms flash still shows at 20 fps). */
  fresh: boolean;
}

interface Shell {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: THREE.Vector3;
  life: number;
  length: number;
  width: number;
  rest: boolean;
}

interface Light {
  light: THREE.PointLight;
  time: number;
  duration: number;
  peak: number;
  priority: number;
}

/** A lingering smoke cloud's handle (hazard smoke): `stop` fades it out early. */
export interface SmokeHandle {
  stop(): void;
  /** False once the effects that made it are cleared or freed (a rebuild for a new look): the owner asks for a new cloud. */
  readonly live: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const frame: Frame = { a: 0, b: 0, blend: 0 };
const previous = new THREE.Vector3();
const motion = new THREE.Vector3();
const axis = new THREE.Vector3();
const scratch = new THREE.Vector3();
const eye = new THREE.Vector3();
const transform = new THREE.Object3D();
const spin = new THREE.Quaternion();
const color = new THREE.Color();
const seeThrough: BoxFilter = box => !!box.data?.noShoot;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A bullet hole's tint (linear) for a surface's sRGB colour: masonry, wood
 * and soil are the surface's colour over their rim's grey (`DECAL_GREY`),
 * never so light that the atlas's lightest texel passes white; metal's
 * chipped paint takes a share of it; glass keeps its white cracks.
 */
export function holeTint(family: SurfaceFamily, hex: number, out: THREE.Color): THREE.Color {
  out.setHex(hex);
  const grey = DECAL_GREY[family];
  if (grey) return out.setRGB(Math.min(out.r / grey[0], 1 / grey[1]), Math.min(out.g / grey[0], 1 / grey[1]), Math.min(out.b / grey[0], 1 / grey[1]));
  const share = family === 'metal' ? 0.6 : 0;
  return out.setRGB(1 + (out.r * 1.6 - 1) * share, 1 + (out.g * 1.6 - 1) * share, 1 + (out.b * 1.6 - 1) * share);
}

function randomUnit(out: THREE.Vector3): THREE.Vector3 {
  out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1));
  return out.lengthSq() > 1e-6 ? out.normalize() : out.copy(UP);
}

/** A hemisphere direction about `normal`, `spread` 0 (straight out) to 1 (grazing). */
function spray(normal: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  randomUnit(out);
  if (out.dot(normal) < 0) out.negate();
  return out.lerp(normal, 1 - spread).normalize();
}

/** One sprite pool: a fixed set of slots, drawn with one instanced call. */
class SpritePool {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly items: Sprite[];
  readonly capacity: number;
  limit: number;
  count = 0;
  readonly sorted: boolean;
  readonly order: number[] = [];
  readonly depth: Float32Array;

  constructor(name: string, material: THREE.ShaderMaterial, capacity: number, sorted: boolean) {
    this.capacity = this.limit = capacity;
    this.sorted = sorted;
    this.mesh = new THREE.Mesh(spriteGeometry(capacity), material);
    this.mesh.name = `effects:${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.depth = new Float32Array(capacity);
    this.items = Array.from({ length: capacity }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, grow: 1, color: new THREE.Color(), alpha: 1,
      fadeIn: 0, fadeOut: 1, first: 0, count: 1, span: 1, rotation: 0, spin: 0, stretch: 0, axis: null, flat: null,
      gravity: 0, drag: 0, bounce: false, ring: false, tag: 0, fresh: false,
    }));
  }

  /** A free slot, or the one closest to its death when every slot is taken. */
  take(): Sprite {
    if (this.count < this.limit) return this.items[this.count++]!;
    let oldest = 0, least = Infinity;
    for (let i = 0; i < this.count; i++) {
      const left = this.items[i]!.life / this.items[i]!.maxLife;
      if (left < least) { least = left; oldest = i; }
    }
    return this.items[oldest]!;
  }

  remove(i: number): void {
    const last = --this.count;
    if (i !== last) [this.items[i], this.items[last]] = [this.items[last]!, this.items[i]!];
  }
}

export class RealEffects {
  readonly ctx: RealContext;
  readonly world: World;
  detail = 1;
  readonly _fire: SpritePool;
  readonly _lit: SpritePool;
  readonly _decals: THREE.InstancedMesh;
  readonly _decalCells: THREE.InstancedBufferAttribute;
  _decalCount = 0;
  _decalNext = 0;
  _decalLimit: number;
  readonly _shells: Record<'brass' | 'shotshell', { mesh: THREE.InstancedMesh; items: Shell[]; limit: number }>;
  readonly _lights: Light[];
  /** The stamp new sprites take: a cloud's while it emits (`_emitClouds`), else 0, which no handle stops. */
  _tag = 0;
  /** The last stamp a cloud was given. */
  _cloudTags = 0;
  _stopped = new Set<number>();
  /** Lingering clouds still emitting: their stamp, place, size, when to emit next and until when. */
  _clouds: { tag: number; pos: THREE.Vector3; radius: number; next: number; until: number; dark: boolean }[] = [];
  _time = 0;
  /** How many times `clear` has run: a cloud's handle outlives its cloud when this moves on. */
  _cleared = 0;
  _disposed = false;

  constructor(ctx: RealContext, world: World, detail = 1) {
    this.ctx = ctx;
    this.world = world;
    this._fire = new SpritePool('fire', spriteMaterial(ctx.soft ? 'fire-soft' : 'fire'), REAL_CAPACITY.fire, false);
    this._lit = new SpritePool('lit', spriteMaterial(ctx.soft ? 'soft' : 'dither'), REAL_CAPACITY.lit, ctx.soft);
    // Smoke under the fire: a flash seen through its own smoke still glows.
    this._lit.mesh.renderOrder = 1;
    this._fire.mesh.renderOrder = 2;
    const late = ctx.soft ? ctx.late : ctx.scene;
    late.add(this._lit.mesh, this._fire.mesh);

    const plane = new THREE.PlaneGeometry(1, 1);
    this._decalCells = new THREE.InstancedBufferAttribute(new Float32Array(REAL_CAPACITY.decals * 4), 4);
    this._decalCells.setUsage(THREE.DynamicDrawUsage);
    plane.setAttribute('decalCell', this._decalCells);
    this._decals = new THREE.InstancedMesh(plane, decalMaterial(), REAL_CAPACITY.decals);
    this._decals.name = 'effects:decals';
    this._decals.count = 0;
    this._decals.frustumCulled = false;
    this._decals.receiveShadow = true;
    this._decals.castShadow = false;
    this._decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._decals.setColorAt(0, color.setRGB(1, 1, 1));
    this._decalLimit = REAL_CAPACITY.decals;
    ctx.scene.add(this._decals);

    const brass = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    brass.rotateX(Math.PI / 2);
    const hull = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 3);
    hull.rotateX(Math.PI / 2);
    const position = hull.getAttribute('position');
    const colours = new Float32Array(position.count * 3);
    const red = new THREE.Color(0x9a2121), gold = new THREE.Color(0xc9a24e);
    for (let i = 0; i < position.count; i++) (position.getZ(i) > 0.2 ? gold : red).toArray(colours, i * 3);
    hull.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const shellPool = (geometry: THREE.BufferGeometry, kind: 'brass' | 'shotshell') => {
      const mesh = new THREE.InstancedMesh(geometry, shellMaterial(kind), REAL_CAPACITY.shells);
      mesh.name = `effects:${kind}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ctx.scene.add(mesh);
      return { mesh, items: [] as Shell[], limit: REAL_CAPACITY.shells };
    };
    this._shells = { brass: shellPool(brass, 'brass'), shotshell: shellPool(hull, 'shotshell') };
    this._lights = ctx.lights.map(light => ({ light, time: 0, duration: 0, peak: 0, priority: -1 }));
    for (const { light } of this._lights) light.intensity = 0;
    this.setDetail(detail);
  }

  /** Scale every pool's share and the spawn counts; 1 is full detail. */
  setDetail(scale: number): void {
    this.detail = clamp(scale, 0.1, 1);
    for (const pool of [this._fire, this._lit]) {
      pool.limit = Math.max(1, Math.floor(pool.capacity * this.detail));
      while (pool.count > pool.limit) pool.remove(pool.count - 1);
    }
    this._decalLimit = Math.max(1, Math.floor(REAL_CAPACITY.decals * this.detail));
    this._decals.count = this._decalCount = Math.min(this._decalCount, this._decalLimit);
    this._decalNext %= this._decalLimit;
    for (const pool of Object.values(this._shells)) {
      pool.limit = Math.max(4, Math.floor(REAL_CAPACITY.shells * this.detail));
      pool.items.length = Math.min(pool.items.length, pool.limit);
    }
  }

  /** `n` scaled by the detail, never below one when `n` is not zero. */
  _n(n: number): number {
    return n <= 0 ? 0 : Math.max(1, Math.round(n * this.detail));
  }

  _sprite(pool: SpritePool, pos: THREE.Vector3, o: {
    life: number; size: number; hex: number; intensity?: number; alpha?: number; vel?: THREE.Vector3; grow?: number;
    cells: readonly [number, number]; frames?: boolean; span?: number; rotation?: number; spin?: number; stretch?: number; axis?: THREE.Vector3;
    flat?: THREE.Vector3; gravity?: number; drag?: number; bounce?: boolean; ring?: boolean; fadeIn?: number; fadeOut?: number;
  }): Sprite {
    const s = pool.take();
    s.pos.copy(pos);
    if (o.vel) s.vel.copy(o.vel); else s.vel.set(0, 0, 0);
    s.life = s.maxLife = o.life;
    s.size = o.size;
    s.grow = o.grow ?? 1;
    s.color.setHex(o.hex).multiplyScalar(o.intensity ?? 1);
    s.alpha = o.alpha ?? 1;
    const [first, count] = o.cells;
    if (o.frames === false) { s.first = first + Math.floor(rand(0, count)); s.count = 1; } else { s.first = first; s.count = count; }
    s.span = o.span ?? 1;
    s.rotation = o.rotation ?? rand(0, TAU);
    s.spin = o.spin ?? 0;
    s.stretch = o.stretch ?? 0;
    s.axis = o.axis ? (s.axis ?? new THREE.Vector3()).copy(o.axis).normalize() : null;
    s.flat = o.flat ? (s.flat ?? new THREE.Vector3()).copy(o.flat).normalize() : null;
    s.gravity = o.gravity ?? 0;
    s.drag = o.drag ?? 0;
    s.bounce = o.bounce ?? false;
    s.ring = o.ring ?? false;
    s.fadeIn = o.fadeIn ?? 0;
    s.fadeOut = o.fadeOut ?? 0.6;
    s.tag = this._tag;
    s.fresh = true;
    return s;
  }

  // ------------------------------------------------------------------ recipes

  /** A bullet hitting a surface: its family's debris, a puff of its dust and its own hole (R5, item 4). */
  impact(point: THREE.Vector3, normal: THREE.Vector3, hit: Impact, from: THREE.Vector3 | null): void {
    const n = normal;
    for (let i = 0; i < this._n(hit.sparks); i++) {
      const vel = spray(n, 0.75, new THREE.Vector3()).multiplyScalar(rand(3, 9));
      if (from) vel.addScaledVector(scratch.copy(from).reflect(n), rand(0, 2));
      this._sprite(this._fire, point, { life: rand(0.12, 0.3), size: 0.07, hex: 0xffc070, intensity: rand(4, 7), vel,
        cells: cells('fire', 'spark'), frames: false, stretch: 1, gravity: 9, drag: 1.5, fadeOut: 0.5 });
    }
    if (hit.sparks > 0) this._sprite(this._fire, scratch.copy(point).addScaledVector(n, 0.03), { life: 0.05, size: 0.18, hex: 0xffd9a0,
      intensity: 3, cells: cells('fire', 'glow'), fadeOut: 0.2 });
    for (let i = 0; i < this._n(hit.dust); i++) {
      const vel = spray(n, 0.3, new THREE.Vector3()).multiplyScalar(rand(0.5, 1.4));
      // About a metre across at its full size: a hit 20 m away still shows where it landed.
      this._sprite(this._lit, scratch.copy(point).addScaledVector(n, 0.08), { life: rand(0.7, 1.2), size: rand(0.3, 0.4),
        grow: rand(2, 2.6), hex: hit.dustColor, alpha: 0.9, vel, cells: cells('smoke', 'dust'),
        gravity: -0.3, drag: 3, fadeIn: 0.05, fadeOut: 0.35 });
    }
    const debris = (count: number, run: readonly [number, number], hex: number, size: number, speed: number) => {
      for (let i = 0; i < this._n(count); i++) {
        const vel = spray(n, 0.8, new THREE.Vector3()).multiplyScalar(rand(0.5, 1) * speed);
        vel.y += rand(0.5, 2);
        this._sprite(this._lit, point, { life: rand(0.6, 1.1), size: size * rand(0.6, 1.2), hex, vel, cells: run, frames: false,
          spin: rand(-14, 14), gravity: 14, drag: 0.4, bounce: true, fadeOut: 0.8 });
      }
    };
    debris(hit.chips, cells('smoke', 'chips'), hit.color, 0.035, 4);
    debris(hit.splinters, cells('smoke', 'splinters'), 0xc9a57a, 0.07, 4.5);
    debris(hit.shards, cells('smoke', 'shards'), 0xe8f2f4, 0.05, 3.5);
    if (hit.decal) this.hole(point, n, hit.decal, hit.color, HOLE_SIZE[hit.decal]);
  }

  /** A bullet hole of `family` (the decal atlas), tinted by the surface's colour so a masonry hole serves concrete and brick. */
  hole(point: THREE.Vector3, normal: THREE.Vector3, family: SurfaceFamily, hex: number, size: number): void {
    holeTint(family, hex, color);
    this._decal(point, normal, cells('decals', family), size * rand(0.85, 1.2), color.r, color.g, color.b);
  }

  /** A scorch mark on the ground under `pos`, `size` metres across. */
  scorch(pos: THREE.Vector3, size: number): void {
    const hit = this.world.raycast(scratch.copy(pos).addScaledVector(UP, 0.3), DOWN, 3.5, seeThrough);
    if (hit) this._decal(hit.point, hit.normal, cells('decals', 'scorch'), size, 1, 1, 1);
  }

  _decal(point: THREE.Vector3, normal: THREE.Vector3, run: readonly [number, number], size: number, r: number, g: number, b: number): void {
    const index = this._decalNext;
    this._decalNext = (index + 1) % this._decalLimit;
    this._decalCount = Math.min(this._decalLimit, this._decalCount + 1);
    this._decals.count = this._decalCount;
    transform.quaternion.setFromUnitVectors(FRONT, axis.copy(normal).normalize());
    transform.quaternion.multiply(spin.setFromAxisAngle(FRONT, rand(0, TAU)));
    // Lifted off the collider as the flat look's discs are: a floor's visible paving or a wall's trim
    // can stand a few centimetres proud of its collider. The polygon offset settles the rest.
    transform.position.copy(point).addScaledVector(axis, DECAL_LIFT);
    transform.scale.set(size, size, 1);
    transform.updateMatrix();
    this._decals.setMatrixAt(index, transform.matrix);
    this._decals.setColorAt(index, color.setRGB(r, g, b));
    const info = FX_MANIFEST.decals, cell = run[0] + Math.floor(rand(0, run[1]));
    this._decalCells.setXYZW(index, (cell % info.cols) / info.cols, Math.floor(cell / info.cols) / info.rows, 1 / info.cols, 1 / info.rows);
    this._decals.instanceMatrix.needsUpdate = true;
    if (this._decals.instanceColor) this._decals.instanceColor.needsUpdate = true;
    this._decalCells.needsUpdate = true;
  }

  /**
   * A muzzle flash seen side-on (R5, item 2): enemies and remote players.
   * The side cell's plume leaves its left edge, so the quad sits ahead of the
   * muzzle along the shot. `scale` 1 is a rifle.
   */
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale = 1, lit = true): void {
    const size = 0.22 * scale;
    this._sprite(this._fire, scratch.copy(pos).addScaledVector(axis.copy(dir).normalize(), size * 0.45), { life: 0.05, size,
      hex: 0xffe0b0, intensity: 5, cells: cells('fire', 'flashSide'), frames: false, axis, stretch: 1, rotation: 0, fadeOut: 0.5 });
    this._sprite(this._fire, pos, { life: 0.04, size: size * 0.6, hex: 0xffd8a0, intensity: 3, cells: cells('fire', 'glow'), fadeOut: 0.3 });
    if (lit) this.light(pos, 0xffb266, 10 * scale, 6, 0.05, 1);
  }

  /** The player's own shot lights the scene for a moment (Medium and up): the pooled light at the muzzle. */
  muzzleLight(pos: THREE.Vector3, scale = 1): void {
    this.light(pos, 0xffb266, 7 * scale, 5.5, 0.05, 2);
  }

  /** A little powder smoke at a muzzle: one faint puff per shot, a thin wisp that rises when a burst ends. */
  muzzleSmoke(pos: THREE.Vector3, dir: THREE.Vector3, wisp: boolean, amount = 1): void {
    const n = wisp ? this._n(3 + Math.round(amount)) : this._n(Math.round(amount));
    for (let i = 0; i < n; i++) {
      const vel = scratch.set(rand(-0.08, 0.08), rand(0.12, 0.3), rand(-0.08, 0.08)).addScaledVector(dir, wisp ? rand(0.05, 0.25) : rand(0.4, 1.1));
      this._sprite(this._lit, pos, { life: wisp ? rand(1.1, 1.8) : rand(0.4, 0.7), size: wisp ? 0.05 : 0.07, grow: wisp ? rand(4, 6) : 3.5,
        hex: 0xd8dade, alpha: wisp ? 0.3 : 0.2, vel, cells: cells('smoke', 'smoke'), span: 0.6, gravity: -0.25, drag: 1.2, spin: rand(-0.6, 0.6),
        fadeIn: 0.1, fadeOut: 0.3 });
    }
  }

  /** The flat look's generic smoke (breakables, the player's puffs), as lit puffs. */
  smoke(pos: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    for (let i = 0; i < this._n(n); i++) {
      const vel = scratch.set(rand(-0.5, 0.5), rand(0.6, 1.4), rand(-0.5, 0.5)).addScaledVector(dir, rand(0.6, 1.8));
      this._sprite(this._lit, pos, { life: rand(0.6, 1), size: rand(0.12, 0.2), grow: 3, hex: 0xdde4ec, alpha: 0.45, vel,
        cells: cells('smoke', 'smoke'), gravity: -1.2, drag: 3, fadeIn: 0.05, fadeOut: 0.3 });
    }
  }

  /**
   * An explosion (R5, item 5; V11): a one-frame white flash, an additive
   * fireball that swells and cools, a shockwave ring on the ground, debris and
   * sparks, a scorch mark, lingering smoke, and 100 ms of light. `radius` is
   * the blast's; `dark` leaves the scorch (a blast of colour, a piñata's,
   * leaves the caller's own splat instead).
   */
  blast(pos: THREE.Vector3, radius: number, dark: boolean): void {
    const k = clamp(radius / 5, 0.35, 1.6);
    this._sprite(this._fire, pos, { life: 0.05, size: 4.2 * k, hex: 0xfff2dc, intensity: 6, cells: cells('fire', 'glow'), fadeOut: 0.2 });
    for (let i = 0; i < this._n(5); i++) {
      const vel = randomUnit(new THREE.Vector3()).multiplyScalar(rand(0.4, 1.6) * k);
      vel.y = Math.abs(vel.y) + 0.8 * k;
      this._sprite(this._fire, scratch.copy(pos).addScaledVector(vel, 0.12), { life: rand(0.55, 0.85), size: rand(1.3, 2) * k,
        // Played to its last glowing frames and faded out from 40 % of its life: the atlas's dark cooling
        // frames, added at full size, laid a rust-coloured veil over the view (the smoke below takes over).
        grow: 1.6, hex: 0xffffff, intensity: rand(5, 7), vel, cells: cells('fire', 'fireball'), span: 0.75, drag: 2.5, gravity: -1.5,
        spin: rand(-1, 1), fadeOut: 0.4 });
    }
    for (let i = 0; i < this._n(14); i++) {
      const vel = randomUnit(new THREE.Vector3()).multiplyScalar(rand(8, 20) * k);
      vel.y = Math.abs(vel.y) * 0.8 + 2;
      this._sprite(this._fire, pos, { life: rand(0.3, 0.7), size: 0.12, hex: 0xffb060, intensity: 6, vel, cells: cells('fire', 'spark'),
        frames: false, stretch: 1, gravity: 12, drag: 1.2, fadeOut: 0.5 });
    }
    const ground = this.world.raycast(scratch.copy(pos).addScaledVector(UP, 0.3), DOWN, 3.5, seeThrough);
    if (ground) {
      const at = ground.point.clone().addScaledVector(ground.normal, 0.05);
      this._sprite(this._lit, at, { life: 0.45, size: 0.6, grow: 5.5 * k, hex: 0xb8b0a4, alpha: 0.55, cells: [-1, 1], frames: false,
        flat: ground.normal, ring: true, fadeOut: 0.3 });
      if (dark) this._decal(ground.point, ground.normal, cells('decals', 'scorch'), 2.6 * k * rand(0.9, 1.1), 1, 1, 1);
    }
    for (let i = 0; i < this._n(12); i++) {
      const vel = randomUnit(new THREE.Vector3()).multiplyScalar(rand(4, 11) * k);
      vel.y = Math.abs(vel.y) + 2;
      this._sprite(this._lit, pos, { life: rand(0.8, 1.4), size: rand(0.05, 0.1), hex: 0x6a655e, vel, cells: cells('smoke', 'chips'),
        frames: false, spin: rand(-14, 14), gravity: 16, drag: 0.3, bounce: true, fadeOut: 0.8 });
    }
    // Kept thin and short: a blast's smoke must never hide the enemies behind it for long (readability guardrail).
    // It thickens as the fireball fades (over 0.4-0.6 s), so Medium's dithered smoke does not show through the fire.
    for (let i = 0; i < this._n(6); i++) {
      const vel = scratch.set(rand(-1, 1), rand(0.4, 1.2), rand(-1, 1)).multiplyScalar(rand(0.6, 1.5) * k);
      this._sprite(this._lit, pos, { life: rand(2, 3.2), size: rand(0.9, 1.4) * k, grow: rand(1.7, 2.2), hex: dark ? 0x77736e : 0x9a958e,
        alpha: 0.36, vel, cells: cells('smoke', 'smoke'), span: 0.45, gravity: -0.35, drag: 1.4, spin: rand(-0.4, 0.4), fadeIn: 0.2, fadeOut: 0.45 });
    }
    this.light(pos, 0xffa050, 180 * k, 14 * k, 0.1, 3);
  }

  /**
   * A smoke grenade's cloud (hazards.ts): big, slow puffs re-emitted round
   * `pos` for `duration` seconds, kept thin enough that an enemy walking out
   * of it is seen. The handle stops it early (a blast clears smoke).
   */
  smokeCloud(pos: THREE.Vector3, radius: number, duration: number): SmokeHandle {
    const real = this;
    const tag = ++this._cloudTags;
    const cloud = { tag, pos: pos.clone(), radius, next: 0, until: this._time + duration, dark: false };
    this._clouds.push(cloud);
    const cleared = this._cleared;
    return {
      stop: () => { cloud.until = Math.min(cloud.until, this._time); this._stopped.add(tag); },
      get live() { return !real._disposed && real._cleared === cleared; },
    };
  }

  /** A casing leaves the ejection port: it tumbles, bounces and settles, then sinks away. */
  shell(pos: THREE.Vector3, vel: THREE.Vector3, kind: ShellKind): void {
    const pool = this._shells[kind === 'shotgun' ? 'shotshell' : 'brass'];
    let s: Shell;
    if (pool.items.length < pool.limit) {
      s = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), spin: new THREE.Vector3(), life: 0, length: 0, width: 0, rest: false };
      pool.items.push(s);
    } else {
      s = pool.items.shift()!;
      pool.items.push(s);
    }
    const [length, width] = SHELL_SIZE[kind];
    s.pos.copy(pos);
    s.vel.copy(vel);
    s.quat.setFromEuler(transform.rotation.set(rand(0, TAU), rand(0, TAU), 0));
    s.spin.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    s.life = 6;
    s.length = length;
    s.width = width;
    s.rest = false;
  }

  /** Light the scene for `duration` seconds from the pooled point light least worth keeping; skipped when every light is busier. */
  light(pos: THREE.Vector3, hex: number, intensity: number, distance: number, duration: number, priority: number): void {
    if (this._lights.length === 0) return;
    this.ctx.camera.getWorldPosition(eye);
    if (eye.distanceTo(pos) > 45) return;
    let best: Light | null = null;
    for (const l of this._lights) {
      const left = l.duration - l.time;
      if (left <= 0) { best = l; break; }
      if (l.priority <= priority && (!best || l.priority < best.priority || (l.priority === best.priority && left < best.duration - best.time))) best = l;
    }
    if (!best) return;
    best.light.position.copy(pos);
    best.light.color.setHex(hex);
    best.light.distance = distance;
    best.time = 0;
    best.duration = duration;
    best.peak = intensity;
    best.priority = priority;
    best.light.intensity = intensity;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this._time += dt;
    this._emitClouds();
    this._step(this._fire, dt);
    this._step(this._lit, dt);
    this._stopped.clear();
    this._draw(this._fire);
    this._draw(this._lit);
    this._stepShells(dt);
    for (const l of this._lights) {
      if (l.time >= l.duration) { l.light.intensity = 0; l.priority = -1; continue; }
      // This frame shows the light at its age so far, then it ages: a new one is at its peak whatever the frame rate.
      const f = clamp(1 - l.time / l.duration, 0, 1);
      l.light.intensity = l.peak * f * f;
      l.time += dt;
    }
  }

  _emitClouds(): void {
    for (let i = this._clouds.length - 1; i >= 0; i--) {
      const cloud = this._clouds[i]!;
      if (this._time >= cloud.until) { this._clouds.splice(i, 1); continue; }
      while (cloud.next <= this._time) {
        cloud.next = (cloud.next || this._time) + 0.22 / this.detail;
        const saved = this._tag;
        this._tag = cloud.tag;
        const r = cloud.radius;
        scratch.set(rand(-1, 1), rand(-0.3, 0.6), rand(-1, 1)).multiplyScalar(r * 0.55).add(cloud.pos);
        const left = cloud.until - this._time;
        this._sprite(this._lit, scratch, { life: Math.min(rand(2.6, 3.4), left + 1.4), size: r * rand(0.7, 0.95), grow: 1.35,
          hex: 0x9aa2a6, alpha: 0.62, vel: axis.set(rand(-0.15, 0.15), rand(0.05, 0.2), rand(-0.15, 0.15)), cells: cells('smoke', 'smoke'),
          span: 0.4, spin: rand(-0.25, 0.25), fadeIn: 0.25, fadeOut: 0.55 });
        this._tag = saved;
      }
    }
  }

  _step(pool: SpritePool, dt: number): void {
    for (let i = pool.count - 1; i >= 0; i--) {
      const s = pool.items[i]!;
      if (this._stopped.has(s.tag) && s.life > 1.2) s.life = 1.2;
      if (s.fresh) {
        s.fresh = false;
        continue;
      }
      s.life -= dt;
      if (s.life <= 0) { pool.remove(i); continue; }
      if (dt <= 0) continue;
      previous.copy(s.pos);
      s.vel.y -= s.gravity * dt;
      if (s.drag > 0) s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
      s.pos.addScaledVector(s.vel, dt);
      s.rotation += s.spin * dt;
      if (!s.bounce) continue;
      motion.subVectors(s.pos, previous);
      const moved = motion.length();
      if (moved < 1e-5) continue;
      const hit = this.world.raycast(previous, motion.divideScalar(moved), moved + 0.01, seeThrough);
      if (!hit) continue;
      s.pos.copy(hit.point).addScaledVector(hit.normal, 0.01);
      const vn = s.vel.dot(hit.normal);
      if (vn < 0) s.vel.addScaledVector(hit.normal, -1.35 * vn).multiplyScalar(0.45);
      s.spin *= 0.5;
      if (s.vel.lengthSq() < 0.3 && hit.normal.y > 0.5) { s.vel.set(0, 0, 0); s.gravity = 0; s.spin = 0; }
    }
  }

  _draw(pool: SpritePool): void {
    const geometry = pool.mesh.geometry;
    const pos = geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute;
    const col = geometry.getAttribute('iColor') as THREE.InstancedBufferAttribute;
    const frm = geometry.getAttribute('iFrame') as THREE.InstancedBufferAttribute;
    const ax = geometry.getAttribute('iAxis') as THREE.InstancedBufferAttribute;
    const order = pool.order;
    order.length = pool.count;
    for (let i = 0; i < pool.count; i++) order[i] = i;
    if (pool.sorted && pool.count > 1) {
      // Back to front: the soft pass blends, and three sorts objects, not instances.
      this.ctx.camera.getWorldPosition(eye);
      for (let i = 0; i < pool.count; i++) pool.depth[i] = pool.items[i]!.pos.distanceToSquared(eye);
      order.sort((a, b) => pool.depth[b]! - pool.depth[a]!);
    }
    for (let k = 0; k < order.length; k++) {
      const s = pool.items[order[k]!]!;
      const t = 1 - s.life / s.maxLife;
      const fade = (s.fadeIn > 0 ? smoothstep(0, s.fadeIn, t) : 1) * (1 - smoothstep(s.fadeOut, 1, t));
      const size = s.size * (1 + (s.grow - 1) * easeOut(t));
      pos.setXYZW(k, s.pos.x, s.pos.y, s.pos.z, size);
      col.setXYZW(k, s.color.r, s.color.g, s.color.b, s.alpha * fade);
      if (s.ring) frame.a = frame.b = -1, frame.blend = 0;
      else flipbookFrame(t * s.span, s.first, s.count, frame);
      frm.setXYZW(k, frame.a, frame.b, frame.blend, s.rotation);
      if (s.flat) ax.setXYZW(k, s.flat.x, s.flat.y, s.flat.z, -1);
      else if (s.axis) ax.setXYZW(k, s.axis.x, s.axis.y, s.axis.z, s.stretch || 1);
      else if (s.stretch > 0) {
        const speed = s.vel.length();
        if (speed > 1e-3) ax.setXYZW(k, s.vel.x / speed, s.vel.y / speed, s.vel.z / speed, clamp(speed * 0.045 / s.size, 1, 6) * s.stretch);
        else ax.setXYZW(k, 0, 1, 0, 1);
      } else ax.setXYZW(k, 0, 0, 0, 0);
    }
    geometry.instanceCount = order.length;
    pool.mesh.visible = order.length > 0;
    for (const attribute of [pos, col, frm, ax]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, order.length * 4);
      attribute.needsUpdate = true;
    }
  }

  _stepShells(dt: number): void {
    for (const pool of Object.values(this._shells)) {
      let drawn = 0;
      for (let i = pool.items.length - 1; i >= 0; i--) {
        const s = pool.items[i]!;
        s.life -= dt;
        if (s.life <= 0) { pool.items.splice(i, 1); continue; }
        if (!s.rest && dt > 0) {
          previous.copy(s.pos);
          s.vel.y -= 9.8 * dt;
          s.pos.addScaledVector(s.vel, dt);
          s.quat.multiply(spin.setFromEuler(transform.rotation.set(s.spin.x * dt, s.spin.y * dt, s.spin.z * dt)));
          motion.subVectors(s.pos, previous);
          const moved = motion.length();
          if (moved > 1e-6) {
            const hit = this.world.raycast(previous, motion.divideScalar(moved), moved + s.width, seeThrough);
            if (hit) {
              s.pos.copy(hit.point).addScaledVector(hit.normal, s.width * 0.5);
              const vn = s.vel.dot(hit.normal);
              if (vn < 0) s.vel.addScaledVector(hit.normal, -1.4 * vn).multiplyScalar(0.5);
              s.spin.multiplyScalar(0.45);
              if (s.vel.lengthSq() < 0.4 && hit.normal.y > 0.6) {
                s.rest = true;
                // Lie on its side, about the up axis where it landed.
                s.quat.setFromUnitVectors(FRONT, axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize());
              }
            }
          }
        }
      }
      for (const s of pool.items) {
        transform.position.copy(s.pos);
        transform.quaternion.copy(s.quat);
        const sink = s.life < 0.5 ? s.life / 0.5 : 1;
        transform.scale.set(s.width * sink, s.width * sink, s.length * sink);
        transform.updateMatrix();
        pool.mesh.setMatrixAt(drawn++, transform.matrix);
      }
      pool.mesh.count = drawn;
      pool.mesh.visible = drawn > 0;
      if (drawn > 0) pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Every sprite, decal, casing and light off; the pools stay. */
  clear(): void {
    this._fire.count = this._lit.count = 0;
    this._draw(this._fire);
    this._draw(this._lit);
    this._decals.count = this._decalCount = this._decalNext = 0;
    for (const pool of Object.values(this._shells)) { pool.items.length = 0; pool.mesh.count = 0; }
    this._clouds.length = 0;
    this._cleared++;
    for (const l of this._lights) { l.time = l.duration = 0; l.priority = -1; l.light.intensity = 0; }
  }

  /** Take everything out of the scenes and free the pools' buffers (the materials are shared and cached, render/fx.ts). */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.clear();
    for (const mesh of [this._fire.mesh, this._lit.mesh, this._decals, this._shells.brass.mesh, this._shells.shotshell.mesh]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
  }
}

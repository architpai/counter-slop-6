import { Mesh, Object3D, Vector3 } from 'three';
import { alignSegment, clamp, damp, rand, round1, round2, wrapAngle } from './util';
import { makeFigure, makeNameTag, cylGeo, sphereGeo, surfMat, setFlash, TONE, TONE_HEX } from './render/index';
import type { Figure, FigureAnchorName, FigureAnchors, FigureParts, WeaponPropKind } from './render/figure';
import type { Ctx, Enemy, Snap, StatePacket, Target } from './types';
import type { Player } from './player/index';

/**
 * A hit sphere sits on a `FigureAnchors` joint, so its name is one of them.
 * `shield` is a shield-bot plate; remote players never have one. Narrower than
 * `types.HitPart`, which also names the parts only enemies carry.
 */
export type HitJoint = Exclude<FigureAnchorName, 'shield'>;

export interface HitSphere {
  part: HitJoint;
  r: number;
  obj: Object3D;
}

/**
 * Every joint in `FigureParts` / `FigureAnchors` is optional because blobs and
 * flyers have no limbs. A remote is always a humanoid, so the joints it poses
 * and the eleven hit joints all exist. Derived from the real types rather than
 * re-declared, so a rename in `render/figure` breaks here instead of drifting.
 */
type RemoteJoints = Required<Pick<FigureParts, 'hips' | 'torso' | 'head' | 'upperL' | 'upperR' |
  'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR'>>;
type RemoteAnchors = Required<Pick<FigureAnchors, HitJoint>>;
const joints = (figure: Figure): RemoteJoints => figure.parts as RemoteJoints;
const anchorsOf = (figure: Figure): RemoteAnchors => figure.anchors as RemoteAnchors;

/**
 * A validated `ps`: `validState` proves the first eight slots are numbers. The
 * optional velocity and hook triples stay `number | undefined`, because only
 * the length checks in `push` know whether they are there.
 */
type ValidState = readonly [number, number, number, number, number, number, number, number, ...number[]];

const WEAPONS: readonly WeaponPropKind[] = ['rifle', 'shotgun', 'sniper', 'blade'];
const HIT_RADII: Record<HitJoint, number> = { head: 0.30, torso: 0.33, hips: 0.20, armL: 0.11, armR: 0.11,
  foreL: 0.10, foreR: 0.10, legL: 0.13, legR: 0.13, shinL: 0.11, shinR: 0.11 };
const LIMBS: readonly (keyof RemoteJoints)[] = ['upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'];
const target = new Vector3();
const hand = new Vector3();
const muzzle = new Vector3();
const endpoint = new Vector3();
const facing = new Vector3();

/** `Number.isFinite` / `Number.isInteger` as predicates: both imply `number`. */
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
/** Post-validation read: `triple` already proved this slot is a finite number. */
const num = (value: unknown): number => typeof value === 'number' ? value : 0;

function bounded(value: unknown, limit = 10000): value is number {
  return finite(value) && Math.abs(value) <= limit;
}

function triple(arr: readonly unknown[], start = 0, limit = 10000) {
  return bounded(arr[start], limit) && bounded(arr[start + 1], limit) && bounded(arr[start + 2], limit);
}

function validState(arr: unknown): arr is ValidState {
  return isArray(arr) && [8, 11, 14].includes(arr.length) && triple(arr) &&
    finite(arr[3]) && bounded(arr[4], 1.6) && integer(arr[5]) &&
    integer(arr[6]) && arr[6] >= 0 && arr[6] <= 511 &&
    finite(arr[7]) && arr[7] >= 0 && arr[7] <= 120 &&
    (arr.length < 11 || triple(arr, 8)) && (arr.length < 14 || triple(arr, 11));
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, 14) || 'recruit' : 'recruit';
}

export function encodeState(p: Player): StatePacket {
  const grapple = p.grapple.mode !== 'idle';
  const flags = (p.crouching ? 1 : 0) | (p.sliding ? 2 : 0) | (p.blocking ? 4 : 0) |
    (p.aiming ? 8 : 0) | (p.body.onGround ? 16 : 0) | (p.firing ? 32 : 0) |
    (p.alive ? 64 : 0) | (grapple ? 128 : 0) | (p.parryWindow ? 256 : 0);
  const { pos, vel } = p.body;
  const state = [round2(pos.x), round2(pos.y), round2(pos.z), round2(p.yaw), round2(p.pitch),
    p.wi, flags, Math.round(p.hp), round1(vel.x), round1(vel.y), round1(vel.z)];
  if (grapple) state.push(round1(p.grapple.hook.x), round1(p.grapple.hook.y), round1(p.grapple.hook.z));
  return state;
}

export class RemotePlayer implements Target {
  _ctx: Ctx;
  _id: string;
  /** Set through the `name` setter, which cleans it. */
  _name = '';
  team: number;
  _tone: number;
  alive: boolean;
  hp: number;
  body: { pos: Vector3; vel: Vector3; halfW: number; height: number; onGround: boolean };
  _center: Vector3;
  _eye: Vector3;
  _forward: Vector3;
  _right: Vector3;
  crouching: boolean;
  sliding: boolean;
  blocking: boolean;
  aiming: boolean;
  firing: boolean;
  grappling: boolean;
  parryWindow: boolean;
  hook: Vector3;
  hits: HitSphere[];
  lastSeen: number;
  deadT: number;
  onDamage: ((amount: number, from: Vector3 | null) => void) | null;
  _a: Snap | null;
  _b: Snap | null;
  _yaw: number;
  _pitch: number;
  _phase: number;
  _walk: number;
  _flashT: number;
  _wi: number;
  _disposed: boolean;
  _figure: Figure | null;
  _tag: Object3D | null;
  /** The name the current tag was drawn with. Set with every tag. */
  _tagName = '';
  _rope: Mesh;
  _hookMesh: Mesh;

  constructor(ctx: Ctx, id: string, name: string, team = 0, tone: number = TONE.HOSTILE) {
    this._ctx = ctx;
    this._id = id;
    this.name = name;
    this.team = team;
    this._tone = Number.isInteger(tone) && TONE_HEX[tone] !== undefined ? tone : TONE.HOSTILE;
    this.alive = true;
    this.hp = 100;
    this.body = { pos: new Vector3(0, -50, 0), vel: new Vector3(), halfW: 0.35, height: 1.75, onGround: false };
    this._center = new Vector3();
    this._eye = new Vector3();
    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this.crouching = this.sliding = this.blocking = this.aiming = false;
    this.firing = this.grappling = this.parryWindow = false;
    this.hook = new Vector3();
    this.hits = Object.entries(HIT_RADII).map(([part, r]) =>
      // `Object.entries` widens the keys to `string`; they are the anchor names.
      ({ part: part as HitJoint, r, obj: new Object3D() }));
    this.lastSeen = 0;
    this.deadT = 0;
    this.onDamage = null;
    this._a = this._b = null;
    this._yaw = this._pitch = this._phase = this._walk = this._flashT = 0;
    this._wi = -1;
    this._disposed = false;
    this._figure = this._tag = null;
    this._rope = new Mesh(cylGeo(0.03, 1, 6), surfMat('dark'));
    this._hookMesh = new Mesh(sphereGeo(0.12, 8), surfMat('dark'));
    this._hookMesh.castShadow = true;
    this._rope.visible = this._hookMesh.visible = false;
    ctx.scene.add(this._rope, this._hookMesh);
    const figure = this._buildFigure();
    figure.root.visible = false;
    this._derive();
    this._placeHits();
  }

  get id() { return this._id; }
  get name() { return this._name; }
  set name(value: string) { this._name = cleanName(value); }
  get visible() { return !!this._figure?.root.visible; }
  get center() { return this._center; }
  get eye() { return this._eye; }
  get forward() { return this._forward; }
  get right() { return this._right; }
  get isLocal(): false { return false; }
  get speed(): 0 { return 0; }
  get blockRadius(): 0 { return 0; }

  _buildFigure(): Figure {
    const figure = makeFigure({ kind: 'humanoid', color: TONE_HEX[this._tone], scale: 1,
      bodyWidth: 1, headSize: 1, limbR: 0.033, hat: 'cap', smile: false, shield: false, weapon: 'rifle' });
    this._figure = figure;
    const { root } = figure;
    const anchors = anchorsOf(figure);
    for (const part of ['armL', 'armR'] as const) anchors[part].position.y = -0.15;
    for (const part of ['foreL', 'foreR'] as const) anchors[part].position.y = -0.14;
    for (const part of ['legL', 'legR', 'shinL', 'shinR'] as const) anchors[part].position.y = -0.21;
    this._wi = -1;
    this._flashT = 0;
    this._walk = this._phase = 0;
    root.position.copy(this.body.pos);
    this._ctx.scene.add(root);
    this._makeTag();
    return figure;
  }

  _removeTag(): void {
    if (!this._tag) return;
    this._tag.removeFromParent();
    const dispose: unknown = this._tag.userData.dispose;
    if (typeof dispose === 'function') dispose();
    this._tag = null;
  }

  _makeTag(): void {
    this._removeTag();
    const tag = makeNameTag(this.name);
    this._tag = tag;
    this._tagName = this.name;
    tag.position.y = 2.25;
    this._figure?.root.add(tag);
  }

  push(arr: unknown, now: number): void {
    if (this._disposed || !validState(arr) || !Number.isFinite(now) || now < 0) return;
    const p = new Vector3(arr[0], arr[1], arr[2]);
    const yaw = wrapAngle(arr[3]);
    this._a = this._b || { p: p.clone(), yaw, pitch: arr[4], t: now - 0.07 };
    this._b = { p, yaw, pitch: arr[4], t: now };
    const wi = arr[5] >= 0 && arr[5] <= 3 ? arr[5] : 0;
    if (this._figure && (wi !== this._wi || !this._figure.parts.weapon?.parent)) {
      this._figure.setWeapon(WEAPONS[wi] ?? 'rifle');
      this._wi = wi;
    }
    const flags = arr[6];
    this.crouching = !!(flags & 1);
    this.sliding = !!(flags & 2);
    this.blocking = !!(flags & 4);
    this.aiming = !!(flags & 8);
    this.body.onGround = !!(flags & 16);
    this.firing = !!(flags & 32);
    const alive = !!(flags & 64);
    if (this.alive && !alive) this.deadT = 0;
    this.alive = alive;
    this.grappling = !!(flags & 128) && arr.length === 14;
    this.parryWindow = !!(flags & 256);
    this.hp = arr[7];
    if (arr.length >= 11) this.body.vel.set(num(arr[8]), num(arr[9]), num(arr[10]));
    else this.body.vel.set(0, 0, 0);
    if (this.grappling) this.hook.set(num(arr[11]), num(arr[12]), num(arr[13]));
    if (alive && !this._figure) {
      this._buildFigure();
      this._a = null;
      this.body.pos.copy(p);
    }
    if (this._figure && !this._figure.root.visible) {
      this.body.pos.copy(p);
      this._figure.root.visible = true;
    }
    this.lastSeen = now * 1000;
  }

  update(dt: number, now: number): void {
    if (this._disposed || !Number.isFinite(dt) || dt < 0 || !Number.isFinite(now)) return;
    if (this._b) {
      const b = this._b, a = this._a || b;
      const tt = now - 0.08;
      const k = clamp((tt - a.t) / Math.max(0.02, b.t - a.t), 0, 1);
      target.copy(a.p).lerp(b.p, k);
      if (tt > b.t) target.addScaledVector(this.body.vel, Math.min(tt - b.t, 0.35));
      if (target.distanceToSquared(this.body.pos) > 36) this.body.pos.copy(target);
      else this.body.pos.lerp(target, 1 - Math.exp(-22 * dt));
      let yawDelta = wrapAngle(b.yaw - a.yaw);
      if (yawDelta === -Math.PI) yawDelta = Math.PI;
      this._yaw = a.yaw + yawDelta * k;
      this._pitch = a.pitch + (b.pitch - a.pitch) * k;
    }
    this._derive();
    if (!this.alive) this.deadT += dt;
    this._flashT = Math.max(0, this._flashT - dt);
    if (this._figure) {
      this._pose(dt);
      if (this._tagName !== this.name) this._makeTag();
      const viewer = this._ctx.player?.eye || this._ctx.camera.position;
      // A figure always carries a tag; the guard is only for the type.
      if (this._tag) {
        this._tag.rotation.y = -this._figure.root.rotation.y +
          Math.atan2(viewer.x - this.body.pos.x, viewer.z - this.body.pos.z);
      }
      setFlash(this._figure.root, this._flashT > 0, this._tone);
    }
    const ropeVisible = !!this._figure && this.alive && this.grappling;
    this._rope.visible = this._hookMesh.visible = ropeVisible;
    if (ropeVisible) {
      hand.copy(this.body.pos).addScaledVector(this.right, 0.35);
      hand.y += 1.25;
      alignSegment(this._rope, hand, this.hook);
      this._rope.visible = hand.distanceToSquared(this.hook) >= 0.0025;
      this._hookMesh.position.copy(this.hook);
    }
    this._placeHits();
  }

  _derive(): void {
    this.body.height = this.crouching ? 1.05 : 1.75;
    this._center.copy(this.body.pos);
    this._center.y += this.body.height * 0.55;
    this._eye.copy(this.body.pos);
    this._eye.y += this.crouching ? 0.88 : 1.60;
    const sin = Math.sin(this._yaw), cos = Math.cos(this._yaw), cp = Math.cos(this._pitch);
    this._forward.set(-sin * cp, Math.sin(this._pitch), -cos * cp);
    this._right.set(cos, 0, -sin);
  }

  _pose(dt: number): void {
    if (!this._figure) return;
    const { root } = this._figure, p = joints(this._figure);
    root.position.copy(this.body.pos);
    root.rotation.y = this._yaw + Math.PI;
    this._figure.setEyes(!this.alive);
    if (!this.alive) {
      root.rotation.x = damp(root.rotation.x, Math.PI / 2, 5, dt);
      return;
    }
    root.rotation.x = damp(root.rotation.x, 0, 8, dt);
    const sp = Math.hypot(this.body.vel.x, this.body.vel.z);
    this._walk = damp(this._walk, clamp(sp / 4, 0, 1), 10, dt);
    this._phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0));
    const s = Math.sin(this._phase), c = Math.cos(this._phase), w = this._walk;
    p.hips.position.y = (this.crouching ? 0.55 : 0.86) + Math.abs(c) * 0.07 * w;
    p.thighL.rotation.x = this.body.onGround ? s * 0.9 * w : -0.5;
    p.thighR.rotation.x = this.body.onGround ? -s * 0.9 * w : 0.6;
    p.shinL.rotation.x = this.body.onGround ? Math.max(0, c) * 1.1 * w : 1.0;
    p.shinR.rotation.x = this.body.onGround ? Math.max(0, -c) * 1.1 * w : 0.5;
    const blade = this._wi === 3;
    const aim = blade ? 0 : this.aiming ? 1 : sp > 6.5 ? 0.8 : 0.95;
    const look = clamp(this._pitch, -1.1, 1.1);
    if (blade) {
      const g = this.blocking ? 1 : 0;
      p.upperR.rotation.set(-0.9 - 0.9 * g - s * 0.6 * w * (1 - g), 0, -0.3 - 0.5 * g);
      p.foreR.rotation.x = -1.0 - 0.6 * g;
      p.upperL.rotation.set(s * 0.8 * w * (1 - g) - 1.4 * g, 0, 0);
      p.foreL.rotation.x = -0.5;
    } else {
      p.upperR.rotation.set((-1.35 - look * 0.85) * aim - s * 0.6 * w * (1 - aim), 0, -0.2 * (1 - aim));
      p.foreR.rotation.x = -0.2;
      p.upperL.rotation.set((-1.25 - look * 0.85) * aim + s * 0.6 * w * (1 - aim), 0.55 * aim, 0);
      p.foreL.rotation.x = -0.45;
    }
    p.torso.rotation.set(-0.2 * w + (this.sliding ? 0.5 : 0) + (this.crouching ? 0.25 : 0), -0.3 * aim, 0);
    p.head.rotation.x = clamp(-this._pitch, -0.7, 0.7) * 0.7;
  }

  _placeHits(): void {
    this._figure?.root.updateMatrixWorld(true);
    for (const hit of this.hits) {
      if (this._figure) anchorsOf(this._figure)[hit.part].getWorldPosition(hit.obj.position);
      else hit.obj.position.set(0, -100, 0);
      hit.obj.updateMatrixWorld(true);
    }
  }

  shots(kind: unknown, ends: unknown): void {
    if (this._disposed || !this.alive || !this._figure || typeof kind !== 'string' || kind.length > 32 ||
      !isArray(ends) || !ends.length || ends.length > 90 || ends.length % 3 !== 0) return;
    for (let i = 0; i < ends.length; i += 3) if (!triple(ends, i)) return;
    muzzle.copy(this.body.pos).addScaledVector(this.right, 0.3).addScaledVector(this.forward, 0.8);
    muzzle.y += 1.35 + this.forward.y * 0.8;
    const thick = kind === 'shotgun' ? 0.014 : kind === 'sniper' ? 0.03 : 0.02;
    for (let i = 0; i < ends.length; i += 3) {
      endpoint.set(num(ends[i]), num(ends[i + 1]), num(ends[i + 2]));
      this._ctx.effects.tracer(muzzle, endpoint, TONE.PRIMARY, thick, 0.06);
    }
    this.flash();
    this._ctx.audio.remoteShot(kind === 'shotgun' || kind === 'sniper' ? kind : 'rifle', muzzle);
  }

  flash(): void {
    if (this._disposed || !this._figure) return;
    this._flashT = 0.08;
    setFlash(this._figure.root, true, this._tone);
  }

  ragdoll(dir: unknown, over: unknown): void {
    if (this._disposed || !this._figure || typeof over !== 'boolean' ||
      !(dir === null || (isArray(dir) && dir.length === 3 && triple(dir, 0, 1)))) return;
    const d = dir ? new Vector3(num(dir[0]), num(dir[1]), num(dir[2])) : new Vector3();
    if (d.lengthSq() <= 0.01) d.set(0, 0.4, -1);
    d.normalize();
    this.alive = false;
    this.deadT = 0;
    this._removeTag();
    this._rope.visible = this._hookMesh.visible = false;
    const figure = this._figure;
    setFlash(figure.root, false, this._tone);
    figure.setEyes(true);
    figure.root.updateMatrixWorld(true);
    const { effects } = this._ctx;
    const parts = joints(figure);
    if (over) {
      const detach = (part: keyof RemoteJoints, extra: Vector3, radius: number) => {
        const obj = parts[part];
        const pos = obj.getWorldPosition(new Vector3());
        const vel = d.clone().multiplyScalar(rand(4, 8)).add(extra);
        vel.y += rand(2, 5);
        effects.debris(obj, pos, vel, new Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
          { radius, blood: true, life: rand(7, 10) });
      };
      detach('head', new Vector3(rand(-2, 2), 3, rand(-2, 2)), 0.25);
      if (rand() < 0.5) detach(rand() < 0.5 ? 'upperL' : 'upperR', new Vector3(rand(-3, 3), 2, rand(-3, 3)), 0.12);
    }
    for (const part of LIMBS) {
      parts[part].rotation.x = rand(-1.2, 1.2);
      parts[part].rotation.z = rand(-0.6, 0.6);
    }
    const vel = d.clone().multiplyScalar(rand(5, 8)).addScaledVector(this.body.vel, 0.4);
    vel.y += rand(3.5, 5.5);
    effects.debris(figure.root, this.body.pos.clone(), vel, new Vector3(rand(-4.5, 4.5), rand(-3, 3), rand(-4.5, 4.5)),
      { radius: 0.55, blood: true, life: 8 });
    effects.blood(this.center, d, 1.3);
    effects.bloodPool(this.body.pos, rand(1.2, 1.8));
    this._figure = null;
    this._flashT = 0;
    this._placeHits();
  }

  takeDamage(amount: number, from: Vector3 | null = null): void {
    if (this._disposed || !this.alive || !Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
      !(from === null || (from instanceof Vector3 && bounded(from.x) && bounded(from.y) && bounded(from.z)))) return;
    this.onDamage?.(amount, from);
  }

  knockback(): void {}
  tryDeflect(): false { return false; }

  tryBlockMelee(e: Enemy): boolean {
    if (this._disposed || !this.alive || !this.blocking || !e?.center ||
      !bounded(e.center.x) || !bounded(e.center.y) || !bounded(e.center.z)) return false;
    return facing.copy(e.center).sub(this.eye).normalize().dot(this.forward) > 0.35;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.alive = false;
    this._removeTag();
    this._figure?.dispose();
    this._figure = null;
    this._rope.removeFromParent();
    this._hookMesh.removeFromParent();
    this._rope.geometry.dispose();
    this._hookMesh.geometry.dispose();
    this._a = this._b = null;
    this.onDamage = null;
    this._placeHits();
  }
}

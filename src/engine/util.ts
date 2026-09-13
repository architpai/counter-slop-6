import { Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const approach = (cur: number, target: number, maxDelta: number): number => cur < target
  ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOut = (t: number): number => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

export const rand = (a = 0, b = 1): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
// ponytail: `choose([])` returns undefined at runtime while the documented type says `T`.
// Behaviour left alone; give callers a non-empty array, or widen to `T | undefined` if one cannot.
export const choose = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
export function randDir(out = new Vector3()): Vector3 {
  return out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
}
export function shuffle<T>(arr: T[]): T[] {
  // Same array, widened: the swap is in-bounds by construction but indexing cannot prove it.
  const slots: (T | undefined)[] = arr;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  return arr;
}

export const wrapAngle = (a: number): number => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const angleLerp = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
export const v3 = (x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z);
export const round = (n: number, dp: number): number => Math.round(n * 10 ** dp) / 10 ** dp;
export const round1 = (n: number): number => round(n, 1);
export const round2 = (n: number): number => round(n, 2);

export class Spring {
  value: number;
  vel: number;
  target: number;
  k: number;
  d: number;
  constructor(k = 120, d = 14) {
    this.value = this.vel = this.target = 0;
    this.k = k;
    this.d = d;
  }
  update(dt: number): number {
    const steps = dt > 0.02 ? 3 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel += ((this.target - this.value) * this.k - this.vel * this.d) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
  kick(v: number): void { this.vel += v; }
  set(v: number): void { this.value = v; this.vel = 0; }
}

export class Spring3 {
  value: Vector3;
  vel: Vector3;
  target: Vector3;
  k: number;
  d: number;
  constructor(k = 120, d = 14) {
    this.value = new Vector3();
    this.vel = new Vector3();
    this.target = new Vector3();
    this.k = k;
    this.d = d;
  }
  // Returns the live spring value, as required by the spring state contract.
  update(dt: number): Vector3 {
    const steps = dt > 0.02 ? 3 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.x += ((this.target.x - this.value.x) * this.k - this.vel.x * this.d) * h;
      this.vel.y += ((this.target.y - this.value.y) * this.k - this.vel.y * this.d) * h;
      this.vel.z += ((this.target.z - this.value.z) * this.k - this.vel.z * this.d) * h;
      this.value.addScaledVector(this.vel, h);
    }
    return this.value;
  }
  kick(x: number, y: number, z: number): void { this.vel.x += x; this.vel.y += y; this.vel.z += z; }
}

export class Cooldown {
  duration: number;
  t: number;
  constructor(duration = 0) { this.duration = duration; this.t = 0; }
  update(dt: number): void { if (this.t > 0) this.t -= dt; }
  ready(): boolean { return this.t <= 0; }
  start(d = this.duration): void { this.t = d; }
  frac(): number { return this.duration > 0 ? clamp(this.t / this.duration, 0, 1) : 0; }
}

const up = new Vector3(0, 1, 0), segment = new Vector3();
export function quatFromY(dir: Vector3, out = new Quaternion()): Quaternion {
  return out.setFromUnitVectors(up, dir);
}
export function alignSegment(obj: Object3D, from: Vector3, to: Vector3, thickness = 1): void {
  segment.subVectors(to, from);
  const length = segment.length();
  obj.visible = length >= 1e-5;
  if (!obj.visible) return;
  obj.position.copy(from).add(to).multiplyScalar(0.5);
  quatFromY(segment.multiplyScalar(1 / length), obj.quaternion);
  obj.scale.set(thickness, length, thickness);
}

export const store = {
  getStr(key: string, def: string): string {
    try { return globalThis.localStorage.getItem(key) ?? def; } catch { return def; }
  },
  getNum(key: string, def: number): number {
    const value = Number(this.getStr(key, String(def)));
    return Number.isFinite(value) ? value : def;
  },
  getBool(key: string, def: boolean): boolean {
    const value = this.getStr(key, '');
    return value === '1' ? true : value === '0' ? false : def;
  },
  set(key: string, value: string | number | boolean): void {
    try { globalThis.localStorage.setItem(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)); }
    catch { /* Storage can be unavailable in private or embedded browser contexts. */ }
  },
};
export const SKEY = {
  MAP: 'cs6_map', BEST: 'cs6_best', MUSIC: 'cs6_music', CHECKPOINT: 'cs6_checkpoint',
  NAME: 'cs6_name', SENS: 'cs6_sens', INVERT: 'cs6_invert',
  ACOG_SENS: 'cs6_acog_sens', SNIPER_SENS: 'cs6_sniper_sens', OPTIC: 'cs6_optic',
};

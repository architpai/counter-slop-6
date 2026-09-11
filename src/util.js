import { Quaternion, Vector3 } from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const approach = (cur, target, maxDelta) => cur < target
  ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
export const easeOut = t => 1 - (1 - t) ** 3;
export const easeInOut = t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const choose = arr => arr[Math.floor(Math.random() * arr.length)];
export function randDir(out = new Vector3()) {
  return out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const wrapAngle = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;
export const v3 = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
export const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
export const round1 = n => round(n, 1);
export const round2 = n => round(n, 2);

export class Spring {
  constructor(k = 120, d = 14) {
    this.value = this.vel = this.target = 0;
    this.k = k;
    this.d = d;
  }
  update(dt) {
    const steps = dt > 0.02 ? 3 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel += ((this.target - this.value) * this.k - this.vel * this.d) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
  kick(v) { this.vel += v; }
  set(v) { this.value = v; this.vel = 0; }
}

export class Spring3 {
  constructor(k = 120, d = 14) {
    this.value = new Vector3();
    this.vel = new Vector3();
    this.target = new Vector3();
    this.k = k;
    this.d = d;
  }
  // Returns the live spring value, as required by the spring state contract.
  update(dt) {
    const steps = dt > 0.02 ? 3 : 1, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.x += ((this.target.x - this.value.x) * this.k - this.vel.x * this.d) * h;
      this.vel.y += ((this.target.y - this.value.y) * this.k - this.vel.y * this.d) * h;
      this.vel.z += ((this.target.z - this.value.z) * this.k - this.vel.z * this.d) * h;
      this.value.addScaledVector(this.vel, h);
    }
    return this.value;
  }
  kick(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; }
}

export class Cooldown {
  constructor(duration = 0) { this.duration = duration; this.t = 0; }
  update(dt) { if (this.t > 0) this.t -= dt; }
  ready() { return this.t <= 0; }
  start(d = this.duration) { this.t = d; }
  frac() { return this.duration > 0 ? clamp(this.t / this.duration, 0, 1) : 0; }
}

const up = new Vector3(0, 1, 0), segment = new Vector3();
export function quatFromY(dir, out = new Quaternion()) {
  return out.setFromUnitVectors(up, dir);
}
export function alignSegment(obj, from, to, thickness = 1) {
  segment.subVectors(to, from);
  const length = segment.length();
  obj.visible = length >= 1e-5;
  if (!obj.visible) return;
  obj.position.copy(from).add(to).multiplyScalar(0.5);
  quatFromY(segment.multiplyScalar(1 / length), obj.quaternion);
  obj.scale.set(thickness, length, thickness);
}

export const store = {
  getStr(key, def) {
    try { return globalThis.localStorage.getItem(key) ?? def; } catch { return def; }
  },
  getNum(key, def) {
    const value = Number(this.getStr(key, String(def)));
    return Number.isFinite(value) ? value : def;
  },
  getBool(key, def) {
    const value = this.getStr(key, '');
    return value === '1' ? true : value === '0' ? false : def;
  },
  set(key, value) {
    try { globalThis.localStorage.setItem(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value)); }
    catch { /* Storage can be unavailable in private or embedded browser contexts. */ }
  },
};
export const SKEY = {
  MAP: 'cs6_map', BEST: 'cs6_best', MUSIC: 'cs6_music', CHECKPOINT: 'cs6_checkpoint',
  NAME: 'cs6_name', SENS: 'cs6_sens', INVERT: 'cs6_invert',
};

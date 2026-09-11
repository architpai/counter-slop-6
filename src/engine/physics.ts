import { Vector3 } from 'three';
import { clamp } from './util';
import type { BoxData, BoxFilter, RayHit } from './types';

/** One static AABB collider. `min`/`max` are copied on add. */
export interface Box {
  min: Vector3;
  max: Vector3;
  data: BoxData;
  id: number;
}

/** Internal: `World` stamps its own boxes for per-query de-duplication. */
interface StampedBox extends Box {
  _stamp: number;
}

type Axis = 'x' | 'y' | 'z';

export const EPS = 1e-4;
export const seeThrough: BoxFilter = box => !!box.data.noShoot;
const cellKey = (x: number, z: number): number => (x + 4096) * 8192 + z + 4096;
const finiteVector = (v: Vector3 | null | undefined) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const overlaps = (box: Box, min: Vector3, max: Vector3): boolean => box.min.x < max.x && box.max.x > min.x
  && box.min.y < max.y && box.max.y > min.y && box.min.z < max.z && box.max.z > min.z;
const axes: readonly Axis[] = ['x', 'y', 'z'];
const down = new Vector3(0, -1, 0);

export class Body {
  pos: Vector3;
  vel: Vector3;
  halfW: number;
  height: number;
  stepHeight: number;
  onGround: boolean;
  hitWall: boolean;
  hitCeil: boolean;
  noSnap: boolean;
  alwaysStep: boolean;
  wallNormal: Vector3;
  landVel: number;
  blockedX: number;
  blockedZ: number;
  constructor(pos: Vector3, halfW: number, height: number, stepHeight = 0.55) {
    this.pos = new Vector3().copy(pos);
    this.vel = new Vector3();
    this.halfW = halfW;
    this.height = height;
    this.stepHeight = stepHeight;
    this.onGround = this.hitWall = this.hitCeil = this.noSnap = this.alwaysStep = false;
    this.wallNormal = new Vector3();
    this.landVel = this.blockedX = this.blockedZ = 0;
  }
  min(out = new Vector3()): Vector3 {
    return out.set(this.pos.x - this.halfW + EPS, this.pos.y + EPS, this.pos.z - this.halfW + EPS);
  }
  max(out = new Vector3()): Vector3 {
    return out.set(this.pos.x + this.halfW - EPS, this.pos.y + this.height - EPS, this.pos.z + this.halfW - EPS);
  }
}

export class World {
  boxes: Box[];
  #hash = new Map<number, StampedBox[]>();
  #stamp = 0;
  #min = new Vector3();
  #max = new Vector3();
  #hits: Box[] = [];
  #rayOrigin = new Vector3();
  #rayDir = new Vector3();

  constructor() { this.boxes = []; }
  addBox(min: Vector3, max: Vector3, data: BoxData = {}): Box {
    const box: StampedBox = { min: new Vector3().copy(min), max: new Vector3().copy(max), data, id: this.boxes.length, _stamp: -1 };
    this.boxes.push(box);
    return box;
  }
  finalize(): void {
    this.#hash.clear();
    for (const box of this.boxes as StampedBox[]) {
      for (let x = Math.floor(box.min.x / 8); x <= Math.floor(box.max.x / 8); x++) {
        for (let z = Math.floor(box.min.z / 8); z <= Math.floor(box.max.z / 8); z++) {
          const key = cellKey(x, z);
          let bucket = this.#hash.get(key);
          if (!bucket) this.#hash.set(key, bucket = []);
          bucket.push(box);
        }
      }
    }
  }
  removeBox(box: Box): void {
    const index = this.boxes.indexOf(box);
    if (index < 0) return;
    this.boxes.splice(index, 1);
    this.finalize();
  }
  clear(): void { this.boxes.length = 0; this.#hash.clear(); this.#stamp = 0; }
  query(min: Vector3, max: Vector3, out: Box[] = []): Box[] {
    out.length = 0;
    if (!finiteVector(min) || !finiteVector(max)) return out;
    const stamp = ++this.#stamp;
    for (let x = Math.floor(min.x / 8); x <= Math.floor(max.x / 8); x++) {
      for (let z = Math.floor(min.z / 8); z <= Math.floor(max.z / 8); z++) {
        const bucket = this.#hash.get(cellKey(x, z));
        if (!bucket) continue;
        for (const box of bucket) {
          if (box._stamp === stamp) continue;
          box._stamp = stamp;
          if (overlaps(box, min, max)) out.push(box);
        }
      }
    }
    return out;
  }
  overlapsAABB(min: Vector3, max: Vector3): boolean { return this.query(min, max, this.#hits).length > 0; }
  overlapsBody(body: Body): boolean { return this.overlapsAABB(body.min(this.#min), body.max(this.#max)); }

  #push(body: Body, axis: Axis, move: number): number {
    const dir = Math.sign(move), limit = Math.abs(move) + 0.03;
    let sign = 0;
    for (let pass = 0; pass < 4; pass++) {
      const min = body.min(this.#min), max = body.max(this.#max);
      const hits = this.query(min, max, this.#hits);
      let correction = 0;
      for (const box of hits) {
        const back = box.min[axis] - max[axis] - EPS;
        const forward = box.max[axis] - min[axis] + EPS;
        const amount = dir > 0 && Math.abs(back) <= limit ? back
          : dir < 0 && forward <= limit ? forward
            : Math.abs(back) < Math.abs(forward) ? back : forward;
        if (Math.abs(amount) > Math.abs(correction)) correction = amount;
      }
      if (correction === 0) break;
      body.pos[axis] += correction;
      sign = Math.sign(correction);
    }
    return sign;
  }
  #horizontal(body: Body, dx: number, dz: number, canStep: boolean): void {
    body.blockedX = body.blockedZ = 0;
    if (dx === 0 && dz === 0) return;
    const { x: ox, y: oy, z: oz } = body.pos;
    body.pos.x += dx;
    const rx = this.#push(body, 'x', dx);
    body.pos.z += dz;
    const rz = this.#push(body, 'z', dz);
    if (rx === 0 && rz === 0) return;
    const nx = body.pos.x, nz = body.pos.z;
    if (canStep && body.stepHeight > 0) {
      body.pos.set(ox, oy + body.stepHeight, oz);
      // A low ceiling (a ledge over a stair) shortens the lift instead of cancelling the step.
      if (this.overlapsBody(body)) this.#push(body, 'y', body.stepHeight);
      const lift = body.pos.y - oy;
      if (lift > 0.02 && !this.overlapsBody(body)) {
        body.pos.x += dx;
        const rx2 = this.#push(body, 'x', dx);
        body.pos.z += dz;
        const rz2 = this.#push(body, 'z', dz);
        body.pos.y -= lift;
        this.#push(body, 'y', -lift);
        const d1 = (nx - ox) ** 2 + (nz - oz) ** 2;
        const d2 = (body.pos.x - ox) ** 2 + (body.pos.z - oz) ** 2;
        if (d2 > d1 + 1e-6 && body.pos.y >= oy - 0.001 && !this.overlapsBody(body)) {
          body.blockedX = rx2;
          body.blockedZ = rz2;
          if (rx2 || rz2) {
            body.hitWall = true;
            body.wallNormal.set(rx2, 0, rz2).normalize();
          }
          return;
        }
      }
      body.pos.set(nx, oy, nz);
    }
    body.blockedX = rx;
    body.blockedZ = rz;
    body.hitWall = true;
    body.wallNormal.set(rx, 0, rz).normalize();
  }
  #step(body: Body, dt: number): void {
    body.hitWall = body.hitCeil = false;
    body.wallNormal.set(0, 0, 0);
    body.landVel = 0;
    const wasOnGround = body.onGround;
    this.#horizontal(body, body.vel.x * dt, body.vel.z * dt, wasOnGround || body.alwaysStep);
    if (body.blockedX) body.vel.x = 0;
    if (body.blockedZ) body.vel.z = 0;
    const dy = body.vel.y * dt;
    body.pos.y += dy;
    const push = this.#push(body, 'y', dy);
    body.onGround = false;
    if (push > 0) {
      body.onGround = true;
      body.landVel = body.vel.y;
      if (body.vel.y < 0) body.vel.y = 0;
    } else if (push < 0) {
      body.hitCeil = true;
      if (body.vel.y > 0) body.vel.y = 0;
    }
    if (!body.onGround && wasOnGround && body.vel.y <= 0 && !body.noSnap) {
      body.pos.y -= body.stepHeight;
      if (this.#push(body, 'y', -body.stepHeight) > 0) {
        body.onGround = true;
        body.vel.y = 0;
      } else body.pos.y += body.stepHeight;
    }
  }
  moveBody(body: Body, dt: number): void {
    if (!Number.isFinite(dt) || dt < 0 || !finiteVector(body.pos) || !finiteVector(body.vel)) return;
    const n = clamp(Math.ceil(body.vel.length() * dt / Math.max(0.2, 0.8 * body.halfW)), 1, 10);
    if (n === 1) { this.#step(body, dt); return; }
    let wall = false, ceil = false, nx = 0, nz = 0, land = 0;
    for (let i = 0; i < n; i++) {
      this.#step(body, dt / n);
      if (body.hitWall) { wall = true; nx = body.wallNormal.x; nz = body.wallNormal.z; }
      ceil ||= body.hitCeil;
      if (body.landVel !== 0) land = body.landVel;
    }
    body.hitWall = wall;
    body.hitCeil = ceil;
    body.wallNormal.set(nx, 0, nz);
    body.landVel = land;
  }
  raycast(origin: Vector3, dir: Vector3, maxDist = 1000, ignore?: BoxFilter): RayHit | null {
    if (!finiteVector(origin) || !finiteVector(dir) || !(maxDist > 0)) return null;
    let best = maxDist, hitBox: Box | null = null, hitAxis: Axis | '' = '', hitSign = 0;
    for (const box of this.boxes) {
      if (ignore?.(box)) continue;
      let tmin = 0, tmax = best, entryAxis: Axis | '' = '', entrySign = 0, missed = false;
      for (const axis of axes) {
        if (Math.abs(dir[axis]) < 1e-9) {
          if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) { missed = true; break; }
        } else {
          let t1 = (box.min[axis] - origin[axis]) / dir[axis];
          let t2 = (box.max[axis] - origin[axis]) / dir[axis], sign = -1;
          if (t1 > t2) { [t1, t2] = [t2, t1]; sign = 1; }
          if (t1 > tmin) { tmin = t1; entryAxis = axis; entrySign = sign; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { missed = true; break; }
        }
      }
      if (!missed && entryAxis && tmin < best) {
        best = tmin;
        hitBox = box;
        hitAxis = entryAxis;
        hitSign = entrySign;
      }
    }
    // `hitAxis` is always set together with `hitBox`; the second test is for the type only.
    if (!hitBox || !hitAxis) return null;
    const normal = new Vector3();
    normal[hitAxis] = hitSign;
    return { dist: best, point: new Vector3().copy(origin).addScaledVector(dir, best), normal, box: hitBox };
  }
  groundBelow(x: number, y: number, z: number, maxDrop = 100): number {
    return this.raycast(this.#rayOrigin.set(x, y, z), down, maxDrop)?.point.y ?? y - maxDrop;
  }
  lineOfSight(a: Vector3, b: Vector3, ignore?: BoxFilter): boolean {
    if (!finiteVector(a) || !finiteVector(b)) return false;
    this.#rayDir.subVectors(b, a);
    const distance = this.#rayDir.length();
    return distance < 1e-4 || this.raycast(a, this.#rayDir.multiplyScalar(1 / distance), distance, ignore) === null;
  }
}

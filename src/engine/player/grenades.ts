import { Group, Mesh, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { rand, round2 } from '../util';
import { surfMat, unlitMat, TONE, TONE_HEX, sphereGeo, torusGeo, cylGeo, ringGeo } from '../render/index';
import type { Ctx, Target } from '../types';
import type { Player } from './index';

/** One grenade in flight or at rest. */
export interface Nade {
  mesh: Group;
  /** `mesh.position`, not a copy. */
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  fuse: number;
  /** Thrown locally: it damages and is replicated. A remote copy is visual only. */
  mine: boolean;
  rest: boolean;
  /** Time to the next fuse spark. */
  tickT: number;
}

/** What a network peer sends for a thrown grenade, and what `onThrow` emits. */
export interface NadeThrow {
  pos: number[];
  vel: number[];
}

/** Just enough of a grenade for `advance` to integrate it. */
interface Flying {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  rest: boolean;
}

/** Geometry and scratch shared by every grenade the player throws. */
interface GrenadeResources {
  bodyGeo: BufferGeometry;
  capGeo: BufferGeometry;
  ringGeo: BufferGeometry;
  previous: Vector3;
  motion: Vector3;
  point: Vector3;
  dir: Vector3;
  /** The single ghost grenade the arc preview integrates. */
  preview: Flying;
}

/** The grenade fields `initGrenades` installs on the player. */
export interface GrenadeState {
  /** 0..1, charged while the key is held. */
  grenadeCharge: number;
  grenadeHeld: boolean;
  grenadeCd: number;
  nades: Nade[];
  /** The arc preview, shown only while charging. */
  arc: Group;
  arcDots: Mesh[];
  arcRing: Mesh;
  _grenade: GrenadeResources;
}

const RADIUS = 0.16;
const BLAST = 6.4;
const HURT_RADIUS = BLAST * 0.95;
const SPARKS = { life: 0.12, size: 0.02 };

export function initGrenades(p: Player): void {
  p.grenadeCharge = 0;
  p.grenadeHeld = false;
  p.grenadeCd = 0;
  p.nades = [];
  p.arc = new Group();
  p.arc.visible = false;
  p.arcDots = [];
  const dotGeo = sphereGeo(0.04, 6);
  const mat = unlitMat(TONE_HEX[TONE.PRIMARY]);
  for (let i = 0; i < 26; i++) {
    const dot = new Mesh(dotGeo, mat);
    p.arcDots.push(dot);
    p.arc.add(dot);
  }
  p.arcRing = new Mesh(ringGeo(0.55, 0.035, 24), mat);
  p.arcRing.rotation.x = -Math.PI / 2;
  p.arc.add(p.arcRing);
  p.ctx.scene.add(p.arc);
  p._grenade = {
    bodyGeo: sphereGeo(RADIUS, 8),
    capGeo: cylGeo(0.055, 0.06, 8, 'y'),
    ringGeo: torusGeo(0.065, 0.014, 4, 8),
    previous: new Vector3(), motion: new Vector3(), point: new Vector3(), dir: new Vector3(),
    preview: { pos: new Vector3(), vel: new Vector3(), spin: new Vector3(), rest: false },
  };
}

function launch(p: Player, pos: Vector3, vel: Vector3): void {
  const c = p.grenadeCharge;
  pos.copy(p.eye).addScaledVector(p.right, 0.25).addScaledVector(p.forward, 0.6);
  pos.y -= 0.15;
  vel.copy(p.forward).multiplyScalar(9 + 20 * c).addScaledVector(p.body.vel, 0.5);
  vel.y += 3.5 + 2.5 * c;
}

function validTriple(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
}

export function throwGrenade(p: Player, remote?: NadeThrow): void {
  const mine = remote === undefined;
  if (mine ? !p.alive || p.dashLock || p.grenades <= 0 || p.grenadeCd > 0
    : !remote || typeof remote !== 'object' || !validTriple(remote.pos) || !validTriple(remote.vel)) return;

  const mesh = new Group();
  const resources = p._grenade;
  const shell = new Mesh(resources.bodyGeo, surfMat('dark'));
  shell.castShadow = true;
  shell.receiveShadow = false;
  const cap = new Mesh(resources.capGeo, surfMat('metal'));
  cap.position.y = 0.17;
  const ring = new Mesh(resources.ringGeo, surfMat('accent'));
  ring.position.y = 0.23;
  mesh.add(shell, cap, ring);
  const vel = new Vector3();
  if (mine) {
    launch(p, mesh.position, vel);
    p.grenades--;
    p.grenadeCd = 0.55;
    p.weapon.kickPos(-0.4, 0.5, 1.2);
    p.weapon.kickRot(-3, 0, -1.5);
    p.ctx.audio.grappleFire();
    p.ctx.input.rumble(0.2, 0.4, 50);
    p.onThrow?.({ pos: mesh.position.toArray().map(round2), vel: vel.toArray().map(round2) });
  } else {
    mesh.position.fromArray(remote.pos);
    vel.fromArray(remote.vel);
  }
  p.ctx.scene.add(mesh);
  p.nades.push({ mesh, pos: mesh.position, vel, spin: new Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), fuse: 2.3, mine, rest: false, tickT: 0 });
}

function advance(p: Player, n: Flying, dt: number, audible: boolean): void {
  const { previous, motion } = p._grenade;
  previous.copy(n.pos);
  n.vel.y -= 22 * dt;
  n.pos.addScaledVector(n.vel, dt);
  motion.subVectors(n.pos, previous);
  const distance = motion.length();
  if (distance < 1e-6) return;
  const hit = p.ctx.world.raycast(previous, motion.multiplyScalar(1 / distance), distance + RADIUS);
  if (!hit) return;
  n.pos.copy(hit.point).addScaledVector(hit.normal, RADIUS);
  const vn = n.vel.dot(hit.normal);
  if (vn < 0) {
    n.vel.addScaledVector(hit.normal, -1.45 * vn).multiplyScalar(0.55);
    n.spin.multiplyScalar(0.6);
    if (audible) p.ctx.audio.shellCue();
  }
  if (n.vel.lengthSq() < 1.2 * 1.2 && hit.normal.y > 0.5) {
    n.rest = true;
    n.vel.set(0, 0, 0);
  }
}

function preview(p: Player): void {
  const n = p._grenade.preview;
  launch(p, n.pos, n.vel);
  n.rest = false;
  let dotCount = 0;
  for (let step = 0; step < 70; step++) {
    advance(p, n, 1 / 30, false);
    if (step >= 6 && step % 2 === 0 && dotCount < p.arcDots.length) {
      const dot = p.arcDots[dotCount++];
      if (dot) {
        dot.visible = true;
        dot.position.copy(n.pos);
        dot.scale.setScalar(0.8 + 0.6 * p.grenadeCharge);
      }
    }
    if (n.rest) break;
  }
  for (let i = dotCount; i < p.arcDots.length; i++) {
    const dot = p.arcDots[i];
    if (dot) dot.visible = false;
  }
  p.arcRing.position.copy(n.pos);
  p.arcRing.position.y += 0.02;
  p.arcRing.scale.setScalar(0.8 + 0.5 * p.grenadeCharge);
  p.arc.visible = true;
}

function explode(p: Player, n: Nade): void {
  const { ctx } = p;
  // Effects and damage callbacks can read these points after this call.
  const center = n.pos.clone();
  center.y += 0.25;
  ctx.effects.boom(center, BLAST);
  ctx.audio.explosion(center);
  ctx.input.rumble(0.9, 0.9, 220);
  if (n.mine) {
    ctx.enemies?.blastEnemies(center, BLAST, 120);
    ctx.game.blastBreakables(center, BLAST * 0.9);
  }
  const distance = p.center.distanceTo(center);
  if (n.mine && p.alive && distance < HURT_RADIUS) {
    p.takeDamage(10 + 34 * (1 - distance / HURT_RADIUS), center);
    p.knockback(p._grenade.dir.subVectors(p.center, center).normalize(), 9);
  }
  if (n.mine) {
    for (const target of ctx.remotes.values()) {
      if (!target.alive || !ctx.game.canHurt(target)) continue;
      const d = target.center.distanceTo(center);
      if (d < HURT_RADIUS) {
        ctx.game.hitPlayer(target, 12 + 50 * (1 - d / HURT_RADIUS), { point: center, source: 'grenade' });
      }
    }
  }
}

export function updateGrenades(p: Player, dt: number, allowInput = true): void {
  if (!allowInput) {
    p.grenadeHeld = false;
    p.grenadeCharge = 0;
    p.arc.visible = false;
  } else if (p.ctx.input.down('grenade') && p.grenades > 0 && p.grenadeCd <= 0 && p.alive && !p.dashLock) {
    p.grenadeCharge = Math.min(1, p.grenadeCharge + dt / 1.1);
    p.grenadeHeld = true;
    preview(p);
  } else {
    if (p.grenadeHeld) {
      p.grenadeHeld = false;
      throwGrenade(p);
      p.grenadeCharge = 0;
    }
    p.arc.visible = false;
  }
  p.grenadeCd -= dt;
  for (let i = p.nades.length - 1; i >= 0; i--) {
    const n = p.nades[i];
    if (!n) continue;
    if (!n.rest) {
      advance(p, n, dt, true);
      n.mesh.rotation.x += n.spin.x * dt;
      n.mesh.rotation.y += n.spin.y * dt;
      n.mesh.rotation.z += n.spin.z * dt;
    }
    n.tickT -= dt;
    if (n.tickT <= 0) {
      n.tickT = 1 / (n.fuse < 0.8 ? 14 : 5);
      const point = p._grenade.point.copy(n.pos);
      point.y += 0.22;
      p.ctx.effects.strokeBurst(point, TONE.ACCENT, 2, 2.5, SPARKS);
    }
    n.fuse -= dt;
    if (n.fuse <= 0) {
      p.nades.splice(i, 1);
      p.ctx.scene.remove(n.mesh);
      explode(p, n);
    }
  }
}

export function clearNades(p: Player): void {
  for (const n of p.nades) p.ctx.scene.remove(n.mesh);
  p.nades.length = 0;
  p.grenadeHeld = false;
  p.grenadeCharge = 0;
  p.grenadeCd = 0;
  p.arc.visible = false;
}

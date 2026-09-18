import { Mesh, Vector3 } from 'three';
import { clamp, damp, rand, alignSegment, wrapAngle } from '../util';
import { seeThrough } from '../physics';
import { boxGeo, unlitMat, TONE_HEX } from '../render/index';
import { bossThink } from './boss';
import { spawnProjectile } from './projectiles';
import { rollCooldown } from './types';
import type { RangedType } from './types';
import type { CoreParts, EyeAnchors } from './model';
import type { EnemyManager, EnemyRecord } from './index';
import type { Target } from '../types';

const down = new Vector3(0, -1, 0);
const eye = new Vector3(), probe = new Vector3(), muzzle = new Vector3(), shot = new Vector3();
const arcA = new Vector3(), arcB = new Vector3(), lead = new Vector3(), side = new Vector3();

/** Rifle carriers duck behind cover between bursts and when shot at. */
const usesCover = (e: EnemyRecord) => e.stats.weapon === 'rifle';

export function stop(e: EnemyRecord, rate: number, dt: number): void {
  e.body.vel.x = damp(e.body.vel.x, 0, rate, dt);
  e.body.vel.z = damp(e.body.vel.z, 0, rate, dt);
}

export function steer(m: EnemyManager, e: EnemyRecord, goal: Vector3, speed: number, accel: number, dt: number): void {
  const dx = goal.x - e.body.pos.x, dz = goal.z - e.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.0001) { stop(e, 8, dt); return; }
  const a = accel * dt * (e.body.onGround ? 1 : 0.3);
  speed *= m.mods.speed * (e.boostT > 0 ? 1.4 : 1);
  e.body.vel.x += clamp(dx / dist * speed - e.body.vel.x, -a, a);
  e.body.vel.z += clamp(dz / dist * speed - e.body.vel.z, -a, a);
  e.yawTo = Math.atan2(dx, dz);
}

export function approachPoint(m: EnemyManager, e: EnemyRecord, target: Vector3, dt: number): Vector3 {
  e.slotT -= dt;
  if (e.slotT <= 0) {
    e.slotT = rand(2.5, 5);
    // Of three candidate bearings take the one furthest from the pack, so a group fans out instead of queuing.
    let bestA = e.slotAngle, bestSep = -1;
    // Blades flank: their candidate bearings sit 60-150 degrees off the target's facing, so a rusher
    // arrives from the side or behind while the rifles hold the front. Everyone else fans from its own slot.
    const flank = e.stats.weapon === 'blade' && e.target
      ? Math.atan2(-e.target.forward.x, -e.target.forward.z) + e.strafeDir * rand(0, 1.5) : null;
    for (let k = 0; k < 3; k++) {
      const a = flank !== null ? flank + rand(-0.5, 0.5) : e.slotAngle + rand(-1.4, 1.4);
      let sep = Infinity;
      for (const o of m.list) if (o !== e && o.alive && !o.stats.flying && o.target === e.target) sep = Math.min(sep, Math.abs(wrapAngle(a - o.slotAngle)));
      if (sep > bestSep) { bestSep = sep; bestA = a; }
    }
    e.slotAngle = bestA;
    e.slotRadius = ['blade', 'bomb'].includes(e.stats.weapon) ? rand(2, 4.5) : rand(7, 13);
    if (e.type === 'rusher' && e.mutated && e.target) {
      const pair = m.list.filter(o => o.alive && o.type === 'rusher' && o.target === e.target);
      e.slotAngle = Math.atan2(e.target.forward.x, e.target.forward.z)
        + (pair.indexOf(e) % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
      e.slotRadius = 4;
    }
  }
  const d = Math.hypot(e.body.pos.x - target.x, e.body.pos.z - target.z);
  // The lower bound wins even before the first slot radius has been chosen.
  let r = Math.max(Math.min(2, 0.9 * d), Math.min(0.55 * d, e.slotRadius));
  if (Math.abs(target.y - e.body.pos.y) > 1.5) r = Math.min(r, 1.1);
  return e.approachPoint.set(target.x + Math.cos(e.slotAngle) * r, target.y, target.z + Math.sin(e.slotAngle) * r);
}

export function follow(m: EnemyManager, e: EnemyRecord, target: Vector3, speed: number, dt: number, exact = false): void {
  e.pathT -= dt;
  const approach = exact ? target : approachPoint(m, e, target, dt);
  const stale = !e.path || e.pathIndex >= e.path.length || (e.pathT <= 0 && (!e.pathGoal || e.pathGoal.distanceTo(approach) > 3.5 || !e.path.complete));
  if (stale && (e.pathT <= 0 || !e.path)) {
    e.pathT = 0.8 + rand(0, 0.6);
    const path = (e.stats.boss ? m.ctx.bossNav : m.ctx.nav).findPath(e.body.pos, approach);
    if (path?.length) {
      e.path = path; e.pathIndex = 0;
      if (!e.pathGoal) e.pathGoal = new Vector3();
      e.pathGoal.copy(approach);
      while (e.pathIndex < path.length - 1) {
        const node = path[e.pathIndex];
        if (!node || Math.hypot(node.x - e.body.pos.x, node.z - e.body.pos.z) >= 0.7 || Math.abs(node.y - e.body.pos.y) >= 1) break;
        e.pathIndex++;
      }
    }
  }
  const route = e.path;
  let goal = route?.[e.pathIndex];
  if (goal && route && Math.hypot(goal.x - e.body.pos.x, goal.z - e.body.pos.z) < 0.5 && Math.abs(goal.y - e.body.pos.y) < 1.2) goal = route[++e.pathIndex];
  goal ||= approach;
  steer(m, e, goal, speed, 40, dt);
  if (!e.body.onGround) return;
  if (goal.y > e.body.pos.y + 0.6 && Math.hypot(goal.x - e.body.pos.x, goal.z - e.body.pos.z) < 1.7) {
    e.body.vel.y = 9; e.body.onGround = false;
  } else if (e.body.hitWall) {
    const prev = e.stuckT;
    e.stuckT += dt;
    if (prev <= 0.35 && e.stuckT > 0.35) e.pathT = 0;
    if (e.stuckT > 0.9) {
      e.body.vel.y = 9; e.body.onGround = false; e.stuckT = 0; e.pathT = 0;
      // A boss that hopped and is still blocked wants a different approach bearing, not the same wall again.
      if (e.stats.boss) e.slotT = 0;
    }
  } else e.stuckT = 0;
}

export function wander(e: EnemyRecord, dt: number): void {
  stop(e, 6, dt);
  e.aimAmt = damp(e.aimAmt, 0, 5, dt);
  if (e.laser) e.laser.visible = false;
}

function retreat(e: EnemyRecord, nx: number, nz: number, speed: number, accel: number, dt: number): void {
  e.body.vel.x += clamp(-nx * speed - e.body.vel.x, -accel * dt, accel * dt);
  e.body.vel.z += clamp(-nz * speed - e.body.vel.z, -accel * dt, accel * dt);
}

function rusher(m: EnemyManager, e: EnemyRecord, dt: number, dist: number, dy: number, dx: number, dz: number, yaw: number): void {
  const target = e.target;
  if (!target) return;
  const nx = dist > 0.0001 ? dx / dist : Math.sin(e.yaw), nz = dist > 0.0001 ? dz / dist : Math.cos(e.yaw);
  e.aimAmt = damp(e.aimAmt, 0, 8, dt);
  if (e.backoffT > 0) {
    e.backoffT -= dt; e.yawTo = yaw;
    retreat(e, nx, nz, 0.55 * e.stats.speed, 26, dt);
    return;
  }
  if (e.attackT > 0) {
    e.attackT -= dt; stop(e, 8, dt); e.yawTo = yaw;
    if (e.attackT < 0.18 && !e.attackHit) {
      e.attackHit = true;
      for (let i = 0; i < 5; i++) {
        const a = e.yaw - 0.9 + 0.45 * i, b = a + 0.45;
        arcA.set(e.center.x + Math.sin(a) * 1.5, e.center.y + 0.5 - 0.18 * i, e.center.z + Math.cos(a) * 1.5);
        arcB.set(e.center.x + Math.sin(b) * 1.5, e.center.y + 0.5 - 0.18 * (i + 1), e.center.z + Math.cos(b) * 1.5);
        m.ctx.effects.tracer(arcA, arcB, 1, 0.025, 0.16);
      }
      if (dist < 3 && Math.abs(dy) < 1.7 && e.hasLOS) {
        if (target.tryBlockMelee(e)) {
          e.state = 'stunned'; e.age = 0; e.stunDuration = 1.1;
          e.body.vel.set(-nx * 7, 3.5, -nz * 7); e.body.onGround = false;
        } else target.takeDamage(e.stats.damage * m.mods.damage, e.center);
      } else m.ctx.audio.katanaSwing();
      e.attackCd = rollCooldown(e.stats); e.backoffT = rand(0.45, 0.75);
    }
    return;
  }
  if (dist < 2.9 && Math.abs(dy) < 1.7 && e.attackCd <= 0 && e.hasLOS) {
    e.attackT = 0.55; e.attackHit = false; m.ctx.audio.lunge(e.center);
    e.body.vel.x += nx * 2.5; e.body.vel.z += nz * 2.5;
    return;
  }
  if (e.hasLOS && dist < 9 && Math.abs(dy) < 1.6) {
    if (dist < 1.9 && Math.abs(dy) < 1.2) {
      retreat(e, nx, nz, 0.4 * e.stats.speed, 24, dt); e.yawTo = yaw;
    } else {
      steer(m, e, dist > 4.5 ? approachPoint(m, e, target.body.pos, dt) : target.body.pos, e.stats.speed, 45, dt);
      if (e.body.onGround && e.body.hitWall) {
        e.stuckT += dt;
        if (e.stuckT > 0.25) { e.body.vel.y = 9; e.body.onGround = false; e.stuckT = 0; }
      }
    }
  } else follow(m, e, target.body.pos, e.stats.speed, dt);
}

function oneShot(m: EnemyManager, e: EnemyRecord, aim: Vector3, speed: number, targetSpeed: number, target?: Target): void {
  const s = e.stats as RangedType;
  (e.figure.parts as CoreParts).tip.getWorldPosition(muzzle);
  if (target) {
    // Lead a moving target by three quarters of the flight time, horizontally only.
    const t = 0.75 * aim.distanceTo(muzzle) / speed;
    aim = lead.copy(aim); aim.x += target.body.vel.x * t; aim.z += target.body.vel.z * t;
  }
  shot.subVectors(aim, muzzle); shot.y += rand(-0.2, 0.3); shot.normalize();
  const spread = s.spread * (1 + targetSpeed * 0.06);
  shot.x += rand(-spread, spread); shot.y += rand(-spread, spread); shot.z += rand(-spread, spread); shot.normalize();
  spawnProjectile(m, muzzle, shot, speed, s.damage * m.mods.damage, e, 1, s.thickness, false);
  m.ctx.effects.strokeBurst(muzzle, 3, 4, 4, { life: 0.07, size: 0.03 });
}

function laser(m: EnemyManager, e: EnemyRecord, aim: Vector3): void {
  const length = muzzle.distanceTo(aim);
  if (!e.laser) {
    e.laser = new Mesh(boxGeo(1, 1, 1), unlitMat(TONE_HEX[1]));
    e.laser.name = 'sniper telegraph';
    m.ctx.scene.add(e.laser);
  }
  if (length < 2) { e.laser.visible = false; return; }
  probe.copy(aim).sub(muzzle).multiplyScalar((length - 1.6) / length).add(muzzle);
  alignSegment(e.laser, muzzle, probe, 2 * (0.006 + 0.012 * clamp(e.aimT / 1.7, 0, 1) ** 2));
}

function fireControl(m: EnemyManager, e: EnemyRecord, dt: number, targetSpeed: number): void {
  const s = e.stats as RangedType, target = e.target;
  if (!target) return;
  if (s.stationary) {
    if (e.attackCd > 0) { if (e.laser) e.laser.visible = false; return; }
    e.aimT += dt;
    if (!e.aimPoint) e.aimPoint = target.center.clone();
    else e.aimPoint.lerp(target.center, 1 - Math.exp(-2.6 * dt));
    (e.figure.parts as CoreParts).tip.getWorldPosition(muzzle);
    laser(m, e, e.aimPoint);
    if (e.aimT > 0.85 && !e.aimWarned) { e.aimWarned = true; m.ctx.audio.sniperAim(e.center); }
    if (e.aimT >= 1.7) {
      e.aimT = 0; e.aimWarned = false; e.attackCd = rollCooldown(s);
      oneShot(m, e, e.aimPoint, s.projectileSpeed, targetSpeed);
      // `laser` has just built the telegraph, so the guard never bites.
      m.ctx.audio.enemySniper(e.center); if (e.laser) e.laser.visible = false; e.aimPoint = null;
    }
    return;
  }
  if (e.burstLeft > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      // ponytail: a burst type without an interval would stall here on NaN; every
      // one in the catalogue declares one, so the fallback is unreachable.
      e.burstT = s.burstInterval ?? 0; e.burstLeft--;
      oneShot(m, e, target.center, s.projectileSpeed, targetSpeed, target);
      m.ctx.audio.enemyShot(e.center);
      if (e.burstLeft === 0) { e.attackCd = rollCooldown(s); if (usesCover(e) && rand() < 0.7) e.wantCover = true; }
    }
  } else if (e.attackCd <= 0) {
    if (s.weapon === 'shotgun') {
      for (let i = 0; i < s.burst; i++) oneShot(m, e, target.center, s.projectileSpeed * rand(0.85, 1.1), targetSpeed, target);
      m.ctx.audio.enemyShotgun(e.center); e.attackCd = rollCooldown(s);
      m.ctx.effects.strokeBurst(muzzle, 3, 8, 5, { life: 0.1, size: 0.04 });
    } else { e.burstLeft = s.burst; e.burstT = 0; }
  }
}

/** A reachable nav node a few metres away that the target cannot see. Null when the ground is open. */
export function findCover(m: EnemyManager, e: EnemyRecord, target: Target): Vector3 | null {
  const pos = e.body.pos, tc = target.center, nodes = m.ctx.nav.nodes;
  // ponytail: linear scan of every nav node per request (~7k), once per burst per rifle; index the grid if it shows in a profile.
  const near = [];
  for (const n of nodes) {
    const d = Math.hypot(n.x - pos.x, n.z - pos.z);
    if (d < 2 || d > 8 || Math.abs(n.y - pos.y) > 1.5 || Math.hypot(n.x - tc.x, n.z - tc.z) < 4) continue;
    near.push(n);
  }
  let best: Vector3 | null = null, bestD = Infinity;
  for (let k = 0; k < 12 && near.length; k++) {
    const i = Math.floor(rand(0, near.length)), n = near[i];
    near[i] = near[near.length - 1]; near.pop();
    if (!n) break;
    const d = Math.hypot(n.x - pos.x, n.z - pos.z);
    if (d >= bestD) continue;
    eye.set(n.x, n.y + 1.5, n.z);
    if (m.ctx.world.lineOfSight(eye, tc, seeThrough)) continue;
    const path = m.ctx.nav.findPath(pos, probe.set(n.x, n.y, n.z), 4000);
    if (!path?.complete) continue;
    best = new Vector3(n.x, n.y, n.z); bestD = d;
  }
  return best;
}

/** Another ground enemy with line of sight stands within 3 m: this one is part of a pile. */
function crowded(m: EnemyManager, e: EnemyRecord): boolean {
  for (const o of m.list) {
    if (o === e || !o.alive || o.stats.flying || !o.hasLOS || o.state === 'spawn') continue;
    if (Math.hypot(o.body.pos.x - e.body.pos.x, o.body.pos.z - e.body.pos.z) < 3 && Math.abs(o.body.pos.y - e.body.pos.y) < 1.5) return true;
  }
  return false;
}

/** Run from the local player's live grenades. True while dodging. */
function dodgeNades(m: EnemyManager, e: EnemyRecord, dt: number): boolean {
  const nades = m.ctx.player?.nades;
  if (!nades?.length) return false;
  const pos = e.body.pos;
  for (const n of nades) {
    const dx = pos.x - n.pos.x, dz = pos.z - n.pos.z, d = Math.hypot(dx, dz);
    if (d > 4.5 || Math.abs(n.pos.y - pos.y) > 2.5) continue;
    const nx = d > 1e-4 ? dx / d : Math.sin(e.yaw), nz = d > 1e-4 ? dz / d : Math.cos(e.yaw);
    probe.set(pos.x + nx * 0.9, pos.y + 0.5, pos.z + nz * 0.9);
    if (!m.ctx.world.raycast(probe, down, 3.5)) return false; // not off a ledge
    const a = 40 * dt, speed = e.stats.speed * 1.1 * m.mods.speed;
    e.body.vel.x += clamp(nx * speed - e.body.vel.x, -a, a);
    e.body.vel.z += clamp(nz * speed - e.body.vel.z, -a, a);
    return true;
  }
  return false;
}

/** Hit reaction: rifles break for cover, blades sidestep. Called by the manager. */
export function onHit(m: EnemyManager, e: EnemyRecord): void {
  if (e.stats.boss || e.stats.flying || e.state !== 'hunt') return;
  // Low per-hit odds: an automatic lands 12 hits a second, so 0.5 sent every rifleman running on the first burst.
  if (usesCover(e) && rand() < 0.15) e.wantCover = true;
  else if (e.stats.weapon === 'blade' && e.attackT <= 0 && e.body.onGround && rand() < 0.6) {
    side.set(Math.cos(e.yaw), 0, -Math.sin(e.yaw)).multiplyScalar(6 * (rand() < 0.5 ? -1 : 1));
    probe.copy(e.body.pos).addScaledVector(side, 0.2); probe.y += 0.5;
    if (m.ctx.world.raycast(probe, down, 3.5)) { e.body.vel.x += side.x; e.body.vel.z += side.z; }
  }
}

export function groundThink(m: EnemyManager, e: EnemyRecord, dt: number): void {
  const target = e.target, s = e.stats, pos = e.body.pos;
  if (!target) return;
  const dx = target.body.pos.x - pos.x, dz = target.body.pos.z - pos.z, dy = target.body.pos.y - pos.y;
  const dist = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
  e.losT -= dt;
  if (e.losT <= 0) {
    e.losT = 0.12 + rand(0, 0.1);
    const anchors = e.figure.anchors as EyeAnchors;
    (anchors.head || anchors.torso).getWorldPosition(eye);
    e.hasLOS = m.ctx.world.lineOfSight(eye, target.center, seeThrough) && !m.hazards.obscures(eye, target.center);
  }
  e.attackCd -= dt;
  if (s.weapon === 'bomb') {
    if (e.fuseT >= 0) {
      const previous = e.fuseT; e.fuseT -= dt; stop(e, 4, dt); e.yawTo = yaw;
      if (Math.floor(previous * 8) !== Math.floor(e.fuseT * 8)) m.ctx.audio.fuse(e.center);
      if (e.fuseT <= 0) m.explode(e, 1);
    } else if (dist < 3.4 && Math.abs(dy) < 2.2 && e.hasLOS) {
      e.fuseT = 1.05; m.ctx.audio.fuse(e.center);
    } else if (e.hasLOS && dist < 12 && Math.abs(dy) < 1.5) steer(m, e, target.body.pos, s.speed, 45, dt);
    else follow(m, e, target.body.pos, s.speed, dt);
    return;
  }
  if (s.boss) { bossThink(m, e, dt, dist, dy, dx, dz); return; }
  if (s.weapon === 'blade') { rusher(m, e, dt, dist, dy, dx, dz, yaw); return; }
  // Everything still here is one of the four ranged classes, so it fills in the
  // fire-control block.
  const r = s as RangedType;
  if (e.type === 'turret') {
    stop(e, 30, dt);
    const inArc = Math.abs(wrapAngle(yaw - e.homeYaw)) <= Math.PI / 4;
    e.yawTo = inArc ? yaw : e.homeYaw;
    if (e.hasLOS && inArc && dist < r.range) fireControl(m, e, dt, target.speed);
    else { e.aimT = 0; e.aimPoint = null; e.aimWarned = false; if (e.laser) e.laser.visible = false; }
    return;
  }
  if (e.type === 'grunt') {
    const shield = m.list.find(o => o.alive && o.type === 'shield' && o.mutated && o.body.pos.distanceTo(pos) < 12);
    if (shield) {
      const behind = probe.copy(shield.body.pos).addScaledVector(side.set(Math.sin(shield.yaw), 0, Math.cos(shield.yaw)), -2.5);
      if (behind.distanceTo(pos) > 1.2) follow(m, e, behind.clone(), s.speed, dt, true);
      else stop(e, 8, dt);
      e.yawTo = yaw;
      if (e.hasLOS) fireControl(m, e, dt, target.speed);
      return;
    }
  }
  if (dodgeNades(m, e, dt)) { e.yawTo = yaw; return; }
  if (e.wantCover) {
    e.wantCover = false;
    if (!e.cover && e.hasLOS) { e.cover = findCover(m, e, target); e.coverT = 3.5; }
  }
  if (e.cover) {
    e.coverT -= dt;
    const there = Math.hypot(e.cover.x - pos.x, e.cover.z - pos.z) < 0.6;
    if (e.coverT <= 0 || (e.attackCd <= 0.3 && (there || !e.hasLOS))) e.cover = null;
    else {
      follow(m, e, e.cover, s.speed, dt, true);
      if (there) stop(e, 10, dt);
      e.aimAmt = damp(e.aimAmt, e.hasLOS ? 1 : 0, 6, dt);
      if (e.hasLOS) e.yawTo = yaw;
      return;
    }
  }
  if (e.hasLOS && dist < r.range) {
    e.aimAmt = damp(e.aimAmt, 1, 8, dt); e.yawTo = yaw;
    if (s.stationary) stop(e, 8, dt);
    else if (dist > r.stop * e.keepMult || Math.abs(dy) > 1.2) {
      follow(m, e, target.body.pos, s.speed * (dist > r.stop * e.keepMult ? 0.8 : 0.85), dt);
      e.yawTo = yaw;
      fireControl(m, e, dt, dist > r.stop * e.keepMult ? target.speed : m.ctx.player?.speed || 0);
      return;
    } else if (!s.stationary && crowded(m, e)) {
      // In range but shoulder to shoulder with another rifle: keep walking to the slot instead of
      // stopping at the first corner with line of sight, which is where every wave used to pile up.
      follow(m, e, target.body.pos, s.speed * 0.85, dt);
      e.yawTo = yaw;
      fireControl(m, e, dt, target.speed);
      return;
    } else {
      const nx = dist > 0.0001 ? dx / dist : 0, nz = dist > 0.0001 ? dz / dist : 1;
      let mx, mz;
      if (dist < r.keep * e.keepMult) { mx = -nx; mz = -nz; }
      else if (dist > 0.7 * r.range && s.weapon === 'shotgun') { mx = nx; mz = nz; }
      else {
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = rand(0.8, 2); e.strafeDir *= -1; }
        mx = -nz * e.strafeDir; mz = nx * e.strafeDir;
        // Turn around before walking into a wall instead of grinding along it.
        if (m.ctx.world.raycast(e.center, side.set(mx, 0, mz), 1.3)) { e.strafeDir *= -1; e.strafeT = rand(0.8, 2); mx = -mx; mz = -mz; }
      }
      probe.set(pos.x + mx * 0.9, pos.y + 0.5, pos.z + mz * 0.9);
      if (m.ctx.world.raycast(probe, down, 3.5)) {
        const speed = s.speed * (s.weapon === 'shotgun' ? 1 : 0.5), a = 30 * dt;
        e.body.vel.x += clamp(mx * speed - e.body.vel.x, -a, a);
        e.body.vel.z += clamp(mz * speed - e.body.vel.z, -a, a);
      } else stop(e, 8, dt);
    }
    fireControl(m, e, dt, target.speed);
  } else {
    e.aimAmt = damp(e.aimAmt, 0, 5, dt); e.burstLeft = 0; e.aimT = 0; e.aimPoint = null;
    if (e.laser) e.laser.visible = false;
    if (s.stationary && e.age < 5) { stop(e, 8, dt); e.yawTo = yaw; }
    else follow(m, e, target.body.pos, s.speed, dt);
    if (e.hasLOS) e.yawTo = yaw;
  }
}

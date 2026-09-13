import { Mesh, Vector3 } from 'three';
import { Body, seeThrough } from '../physics';
import { alignSegment, clamp, damp, rand, TAU } from '../util';
import { boxGeo, unlitMat, TONE, TONE_HEX } from '../render/index';
import { stop } from './ai';
import { spawnProjectile } from './projectiles';
import { TYPES } from './types';
import type { EnemyManager, EnemyRecord } from './index';

const origin = new Vector3(), direction = new Vector3(), goal = new Vector3(), end = new Vector3();
const down = new Vector3(0, -1, 0);

function cancelAttack(e: EnemyRecord): void {
  e.aimT = e.attackT = e.chargeCount = 0;
  e.aimPoint = e.actionPoint = null;
  e.aimWarned = false;
  if (e.laser) e.laser.visible = false;
}

function carrier(m: EnemyManager, e: EnemyRecord): void {
  e.specialCd = 12;
  if (!m.canSpawn('carrier')) return;
  const b = m.ctx.level.bounds;
  const probe = new Body(e.body.pos, 0.45, 0.8 * TYPES.carrier.scale);
  // Eight nearby airborne candidates; skip this drop if the perch has no clearance.
  for (let i = 0; i < 8; i++) {
    const angle = e.yaw + i * TAU / 8;
    probe.pos.set(e.body.pos.x + Math.sin(angle) * 3, e.body.pos.y + e.body.height + 1,
      e.body.pos.z + Math.cos(angle) * 3);
    if (probe.pos.x < b.minX + 1 || probe.pos.x > b.maxX - 1 || probe.pos.z < b.minZ + 1 || probe.pos.z > b.maxZ - 1
      || m.ctx.world.overlapsBody(probe)) continue;
    m.spawn('carrier', probe.pos);
    m.ctx.effects.strokeBurst(probe.pos, TONE.ACCENT, 18, 5, { life: 0.4, size: 0.04 });
    return;
  }
}

function sniperLaser(m: EnemyManager, e: EnemyRecord): void {
  if (!e.aimPoint) return;
  if (!e.laser) {
    e.laser = new Mesh(boxGeo(1, 1, 1), unlitMat(TONE_HEX[TONE.HOSTILE]));
    e.laser.name = 'aimbot locked laser';
    m.ctx.scene.add(e.laser);
  }
  direction.subVectors(e.aimPoint, origin);
  const length = direction.length();
  direction.normalize();
  const wall = m.ctx.world.raycast(origin, direction, length, seeThrough);
  alignSegment(e.laser, origin, wall?.point ?? e.aimPoint, e.aimWarned ? 0.035 : 0.012);
}

function aimbot(m: EnemyManager, e: EnemyRecord, dt: number): void {
  if (e.specialCd <= 0) carrier(m, e);
  const target = e.target;
  origin.copy(m.eye(e));
  e.hasLOS = !!target?.alive && m.ctx.world.lineOfSight(origin, target.center, seeThrough)
    && !m.hazards.obscures(origin, target.center);
  e.aimAmt = damp(e.aimAmt, e.hasLOS && e.attackCd <= 0 ? 1 : 0, 8, dt);
  if (!target?.alive || e.attackCd > 0) { cancelAttack(e); return; }
  if (!e.aimPoint) {
    if (!e.hasLOS) return;
    e.aimPoint = target.center.clone();
  }
  // aimT: 0-.7 tracks, .7-1 locks, shots at 1 and 1.25. Never lead the locked point.
  if (e.aimT < 0.7) e.aimPoint.copy(target.center);
  e.aimT += dt;
  e.yawTo = Math.atan2(e.aimPoint.x - origin.x, e.aimPoint.z - origin.z);
  if (e.aimT >= 0.7 && !e.aimWarned) {
    e.aimWarned = true;
    m.ctx.audio.sniperAim(e.center);
    m.ctx.effects.strokeBurst(origin, TONE.HOSTILE, 8, 3, { life: 0.3, size: 0.025 });
  }
  sniperLaser(m, e);
  while (e.chargeCount < 2 && e.aimT >= 1 + 0.25 * e.chargeCount) {
    direction.subVectors(e.aimPoint, origin).normalize();
    spawnProjectile(m, origin, direction, e.stats.projectileSpeed ?? 95,
      e.stats.damage * m.mods.damage, e, TONE.HOSTILE, e.stats.thickness ?? 0.07, false);
    m.ctx.audio.enemySniper(e.center);
    e.chargeCount++;
  }
  if (e.chargeCount === 2) {
    cancelAttack(e); e.attackCd = 3; e.weakT = 2.5;
    m.ctx.effects.strokeBurst(e.center, TONE.ACCENT, 28, 4, { life: 1, size: 0.05 });
  }
}

function recover(e: EnemyRecord): void {
  e.actionPoint = null; e.specialT = e.attackT = 0;
  e.retreatT = 0.8; e.attackCd = 1.5;
  e.body.vel.x = e.body.vel.z = 0;
}

function ragequit(m: EnemyManager, e: EnemyRecord, dt: number): void {
  e.rageT += dt;
  if (e.rageT >= 3) {
    e.rageStacks = Math.min(4, e.rageStacks + Math.floor(e.rageT / 3)); e.rageT %= 3;
    m.ctx.effects.strokeBurst(e.center, TONE.HOSTILE, 10, 4, { life: 0.4, size: 0.04 });
  }
  if (e.retreatT > 0) { e.retreatT = Math.max(0, e.retreatT - dt); stop(e, 12, dt); return; }
  const target = e.target;
  if (!target?.alive) { cancelAttack(e); stop(e, 8, dt); return; }
  const dx = target.body.pos.x - e.body.pos.x, dz = target.body.pos.z - e.body.pos.z;
  const dist = Math.hypot(dx, dz), dy = target.body.pos.y - e.body.pos.y;
  e.hasLOS = m.ctx.world.lineOfSight(e.center, target.center, seeThrough);
  if (!e.actionPoint) {
    if (e.attackCd <= 0 && dist < 18 && Math.abs(dy) < 2 && e.hasLOS) {
      e.actionPoint = new Vector3(dx, 0, dz).normalize();
      if (dist < 0.001) e.actionPoint.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      e.specialT = 0; e.attackHit = false;
      m.ctx.audio.lunge(e.center);
      end.copy(e.body.pos).addScaledVector(e.actionPoint, 10); end.y += 0.2;
      origin.copy(e.body.pos); origin.y += 0.2;
      m.ctx.effects.tracer(origin, end, TONE.HOSTILE, 0.06, 0.65);
    } else {
      const speed = e.stats.speed * (1 + 0.2 * e.rageStacks);
      if (e.hasLOS && dist < 10 && Math.abs(dy) < 1.5) m._steer(e, target.body.pos, speed, 40, dt);
      else m._follow(e, target.body.pos, speed, dt);
      return;
    }
  }
  const charge = e.actionPoint;
  e.specialT += dt;
  e.yawTo = Math.atan2(charge.x, charge.z);
  if (e.specialT <= 0.65) {
    e.attackT = 0.18 + 0.37 * (1 - e.specialT / 0.65);
    e.body.vel.x = e.body.vel.z = 0;
    return;
  }
  if (e.specialT >= 1.3 || e.body.hitWall) {
    if (e.body.hitWall) m.ctx.effects.strokeBurst(e.center, TONE.ACCENT, 20, 6, { life: 0.4 });
    recover(e); return;
  }
  e.attackT = 0.17;
  e.body.vel.x = charge.x * 17 * m.mods.speed;
  e.body.vel.z = charge.z * 17 * m.mods.speed;
  if (e.attackHit || dist >= 3 || Math.abs(dy) >= 2 || !e.hasLOS || dx * charge.x + dz * charge.z < -0.3) return;
  e.attackHit = true;
  if (target.tryBlockMelee(e)) {
    recover(e); e.rageStacks = 0; e.rageT = 0; e.retreatT = 0;
    e.state = 'stunned'; e.age = 0; e.stunDuration = 2;
    e.weakT = 2;
  } else {
    target.takeDamage(e.stats.damage * m.mods.damage, e.center);
    target.knockback(charge, 8);
    recover(e);
  }
}

function moderator(m: EnemyManager, e: EnemyRecord, dt: number): void {
  if (!e.specialT) { e.specialT = 1; e.attackCd = Math.max(e.attackCd, 4.5); }
  e.flightPhase = 'orbit';
  const target = e.target;
  if (!target?.alive) { e.body.vel.multiplyScalar(Math.exp(-5 * dt)); return; }
  const pos = e.body.pos, c = target.center, b = m.ctx.level.bounds;
  const margin = e.body.halfW + 1;
  const angle = Math.atan2(pos.x - c.x, pos.z - c.z) + e.orbitDir * 0.5;
  goal.set(clamp(c.x + Math.sin(angle) * 11, b.minX + margin, b.maxX - margin),
    c.y + 6, clamp(c.z + Math.cos(angle) * 11, b.minZ + margin, b.maxZ - margin));
  direction.subVectors(goal, pos).clampLength(0, e.stats.speed * m.mods.speed);
  direction.sub(e.body.vel).clampLength(0, 20 * dt); e.body.vel.add(direction);
  if (e.body.vel.lengthSq() > 0.01) {
    direction.copy(e.body.vel).normalize();
    const wall = m.ctx.world.raycast(e.center, direction, 3.5);
    if (wall) {
      const inward = e.body.vel.dot(wall.normal);
      if (inward < 0) e.body.vel.addScaledVector(wall.normal, -inward);
      e.body.vel.addScaledVector(wall.normal, 12 * dt);
      e.body.vel.y += wall.normal.y === 0 ? 10 * dt : 0;
    }
  }
  if (m.ctx.world.raycast(pos, down, 2)) e.body.vel.y += 12 * dt;
  if (dt > 0) {
    e.body.vel.x = clamp(e.body.vel.x, (b.minX + margin - pos.x) / dt, (b.maxX - margin - pos.x) / dt);
    e.body.vel.z = clamp(e.body.vel.z, (b.minZ + margin - pos.z) / dt, (b.maxZ - margin - pos.z) / dt);
  }
  e.yawTo = Math.atan2(c.x - pos.x, c.z - pos.z);
  if (e.attackCd <= 0) {
    e.attackCd = rand(4, 5);
    if (m.hazards.placeRing(e)) {
      e.yankableT = 2;
      m.ctx.audio.sniperAim(e.center);
      m.ctx.effects.strokeBurst(e.center, TONE.ACCENT, 30, 5, { life: 2, size: 0.05 });
    }
  }
}

/** Owns cooldowns and gravity; the manager owns age, weak/yank timers and moveBody. */
export function expansionBossThink(m: EnemyManager, e: EnemyRecord, dt: number): boolean {
  if (e.type !== 'aimbot' && e.type !== 'ragequit' && e.type !== 'moderator') return false;
  e.attackCd -= dt; e.specialCd -= dt;
  if (e.type === 'aimbot') e.body.vel.x = e.body.vel.z = 0;
  if (!e.stats.flying) e.body.vel.y -= 24 * dt;
  if (e.state === 'stunned') {
    if (e.type === 'moderator' && !e.body.onGround) e.age = 0;
    cancelAttack(e); e.aimAmt = 0;
    if (e.age < e.stunDuration) {
      stop(e, 5, dt);
      if (e.stats.flying) {
        e.flightPhase = 'stunned'; e.body.vel.y -= 24 * dt;
        e.weakT = Math.max(e.weakT, e.stunDuration - e.age);
      }
      return true; // Landing never ends a moderator's 1.3-second yank stun early.
    }
    e.state = 'hunt';
  }
  if (e.type === 'aimbot') aimbot(m, e, dt);
  else if (e.type === 'ragequit') ragequit(m, e, dt);
  else moderator(m, e, dt);
  return true;
}

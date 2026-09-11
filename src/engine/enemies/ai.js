import { Mesh, Vector3 } from 'three';
import { clamp, damp, rand, alignSegment } from '../util';
import { seeThrough } from '../physics';
import { boxGeo, unlitMat, TONE_HEX } from '../render/index';
import { bossThink } from './boss';
import { spawnProjectile } from './projectiles';

const down = new Vector3(0, -1, 0);
const eye = new Vector3(), probe = new Vector3(), muzzle = new Vector3(), shot = new Vector3();
const arcA = new Vector3(), arcB = new Vector3();

export function stop(e, rate, dt) {
  e.body.vel.x = damp(e.body.vel.x, 0, rate, dt);
  e.body.vel.z = damp(e.body.vel.z, 0, rate, dt);
}

export function steer(m, e, goal, speed, accel, dt) {
  const dx = goal.x - e.body.pos.x, dz = goal.z - e.body.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.0001) { stop(e, 8, dt); return; }
  const a = accel * dt * (e.body.onGround ? 1 : 0.3);
  speed *= m.mods.speed;
  e.body.vel.x += clamp(dx / dist * speed - e.body.vel.x, -a, a);
  e.body.vel.z += clamp(dz / dist * speed - e.body.vel.z, -a, a);
  e.yawTo = Math.atan2(dx, dz);
}

export function approachPoint(e, target, dt) {
  e.slotT -= dt;
  if (e.slotT <= 0) {
    e.slotT = rand(2.5, 5);
    e.slotAngle += rand(-0.7, 0.7);
    e.slotRadius = ['blade', 'bomb'].includes(e.stats.weapon) ? rand(2, 4.5) : rand(4.5, 9);
  }
  const d = Math.hypot(e.body.pos.x - target.x, e.body.pos.z - target.z);
  // The lower bound wins even before the first slot radius has been chosen.
  let r = Math.max(Math.min(2, 0.9 * d), Math.min(0.55 * d, e.slotRadius));
  if (Math.abs(target.y - e.body.pos.y) > 1.5) r = Math.min(r, 1.1);
  return e.approachPoint.set(target.x + Math.cos(e.slotAngle) * r, target.y, target.z + Math.sin(e.slotAngle) * r);
}

export function follow(m, e, target, speed, dt) {
  e.pathT -= dt;
  const approach = approachPoint(e, target, dt);
  const stale = !e.path || e.pathIndex >= e.path.length || (e.pathT <= 0 && (!e.pathGoal || e.pathGoal.distanceTo(approach) > 3.5 || !e.path.complete));
  if (stale && (e.pathT <= 0 || !e.path)) {
    e.pathT = 0.8 + rand(0, 0.6);
    const path = m.ctx.nav.findPath(e.body.pos, approach);
    if (path?.length) {
      e.path = path; e.pathIndex = 0;
      if (!e.pathGoal) e.pathGoal = new Vector3();
      e.pathGoal.copy(approach);
      while (e.pathIndex < path.length - 1 && Math.hypot(path[e.pathIndex].x - e.body.pos.x, path[e.pathIndex].z - e.body.pos.z) < 0.7 && Math.abs(path[e.pathIndex].y - e.body.pos.y) < 1) e.pathIndex++;
    }
  }
  let goal = e.path?.[e.pathIndex];
  if (goal && Math.hypot(goal.x - e.body.pos.x, goal.z - e.body.pos.z) < 0.5 && Math.abs(goal.y - e.body.pos.y) < 1.2) goal = e.path[++e.pathIndex];
  goal ||= approach;
  steer(m, e, goal, speed, 40, dt);
  if (!e.body.onGround) return;
  if (goal.y > e.body.pos.y + 0.6 && Math.hypot(goal.x - e.body.pos.x, goal.z - e.body.pos.z) < 1.7) {
    e.body.vel.y = 9; e.body.onGround = false;
  } else if (e.body.hitWall) {
    const prev = e.stuckT;
    e.stuckT += dt;
    if (prev <= 0.35 && e.stuckT > 0.35) e.pathT = 0;
    if (e.stuckT > 0.9) { e.body.vel.y = 9; e.body.onGround = false; e.stuckT = 0; e.pathT = 0; }
  } else e.stuckT = 0;
}

export function wander(e, dt) {
  stop(e, 6, dt);
  e.aimAmt = damp(e.aimAmt, 0, 5, dt);
  if (e.laser) e.laser.visible = false;
}

function retreat(e, nx, nz, speed, accel, dt) {
  e.body.vel.x += clamp(-nx * speed - e.body.vel.x, -accel * dt, accel * dt);
  e.body.vel.z += clamp(-nz * speed - e.body.vel.z, -accel * dt, accel * dt);
}

function rusher(m, e, dt, dist, dy, dx, dz, yaw) {
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
      if (dist < 3 && Math.abs(dy) < 1.7) {
        if (e.target.tryBlockMelee(e)) {
          e.state = 'stunned'; e.age = 0; e.stunDuration = 1.1;
          e.body.vel.set(-nx * 7, 3.5, -nz * 7); e.body.onGround = false;
        } else e.target.takeDamage(e.stats.damage * m.mods.damage, e.center);
      } else m.ctx.audio.katanaSwing();
      e.attackCd = rand(...e.stats.cooldown); e.backoffT = rand(0.45, 0.75);
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
      steer(m, e, dist > 4.5 ? approachPoint(e, e.target.body.pos, dt) : e.target.body.pos, e.stats.speed, 45, dt);
      if (e.body.onGround && e.body.hitWall) {
        e.stuckT += dt;
        if (e.stuckT > 0.25) { e.body.vel.y = 9; e.body.onGround = false; e.stuckT = 0; }
      }
    }
  } else follow(m, e, e.target.body.pos, e.stats.speed, dt);
}

function oneShot(m, e, aim, speed = e.stats.projectileSpeed, targetSpeed = e.target.speed) {
  e.figure.parts.tip.getWorldPosition(muzzle);
  shot.subVectors(aim, muzzle); shot.y += rand(-0.2, 0.3); shot.normalize();
  const spread = e.stats.spread * (1 + targetSpeed * 0.06);
  shot.x += rand(-spread, spread); shot.y += rand(-spread, spread); shot.z += rand(-spread, spread); shot.normalize();
  spawnProjectile(m, muzzle, shot, speed, e.stats.damage * m.mods.damage, e, 1, e.stats.thickness, false);
  m.ctx.effects.strokeBurst(muzzle, 3, 4, 4, { life: 0.07, size: 0.03 });
}

function laser(m, e, dt) {
  const length = muzzle.distanceTo(e.aimPoint);
  if (!e.laser) {
    e.laser = new Mesh(boxGeo(1, 1, 1), unlitMat(TONE_HEX[1]));
    e.laser.name = 'sniper telegraph';
    m.ctx.scene.add(e.laser);
  }
  if (length < 2) { e.laser.visible = false; return; }
  probe.copy(e.aimPoint).sub(muzzle).multiplyScalar((length - 1.6) / length).add(muzzle);
  alignSegment(e.laser, muzzle, probe, 2 * (0.006 + 0.012 * clamp(e.aimT / 1.7, 0, 1) ** 2));
}

function fireControl(m, e, dt, targetSpeed) {
  const s = e.stats;
  if (s.stationary) {
    if (e.attackCd > 0) { if (e.laser) e.laser.visible = false; return; }
    e.aimT += dt;
    if (!e.aimPoint) e.aimPoint = e.target.center.clone();
    else e.aimPoint.lerp(e.target.center, 1 - Math.exp(-2.6 * dt));
    e.figure.parts.tip.getWorldPosition(muzzle);
    laser(m, e, dt);
    if (e.aimT > 0.85 && !e.aimWarned) { e.aimWarned = true; m.ctx.audio.sniperAim(e.center); }
    if (e.aimT >= 1.7) {
      e.aimT = 0; e.aimWarned = false; e.attackCd = rand(...s.cooldown);
      oneShot(m, e, e.aimPoint, s.projectileSpeed, targetSpeed);
      m.ctx.audio.enemySniper(e.center); e.laser.visible = false; e.aimPoint = null;
    }
    return;
  }
  if (e.burstLeft > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      e.burstT = s.burstInterval; e.burstLeft--;
      oneShot(m, e, e.target.center, s.projectileSpeed, targetSpeed);
      m.ctx.audio.enemyShot(e.center);
      if (e.burstLeft === 0) e.attackCd = rand(...s.cooldown);
    }
  } else if (e.attackCd <= 0) {
    if (s.weapon === 'shotgun') {
      for (let i = 0; i < s.burst; i++) oneShot(m, e, e.target.center, s.projectileSpeed * rand(0.85, 1.1), targetSpeed);
      m.ctx.audio.enemyShotgun(e.center); e.attackCd = rand(...s.cooldown);
      m.ctx.effects.strokeBurst(muzzle, 3, 8, 5, { life: 0.1, size: 0.04 });
    } else { e.burstLeft = s.burst; e.burstT = 0; }
  }
}

export function groundThink(m, e, dt) {
  const target = e.target, s = e.stats, pos = e.body.pos;
  const dx = target.body.pos.x - pos.x, dz = target.body.pos.z - pos.z, dy = target.body.pos.y - pos.y;
  const dist = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
  e.losT -= dt;
  if (e.losT <= 0) {
    e.losT = 0.12 + rand(0, 0.1);
    (e.figure.anchors.head || e.figure.anchors.torso).getWorldPosition(eye);
    e.hasLOS = m.ctx.world.lineOfSight(eye, target.center, seeThrough);
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
  if (s.weapon === 'blade') { rusher(m, e, dt, dist, dy, dx, dz, yaw); return; }
  if (s.boss) { bossThink(m, e, dt, dist, dy, dx, dz); return; }
  if (e.hasLOS && dist < s.range) {
    e.aimAmt = damp(e.aimAmt, 1, 8, dt); e.yawTo = yaw;
    if (s.stationary) stop(e, 8, dt);
    else if (dist > s.stop * e.keepMult || Math.abs(dy) > 1.2) {
      follow(m, e, target.body.pos, s.speed * (dist > s.stop * e.keepMult ? 0.8 : 0.85), dt);
      e.yawTo = yaw;
      fireControl(m, e, dt, dist > s.stop * e.keepMult ? target.speed : m.ctx.player?.speed || 0);
      return;
    } else {
      const nx = dist > 0.0001 ? dx / dist : 0, nz = dist > 0.0001 ? dz / dist : 1;
      let mx, mz;
      if (dist < s.keep * e.keepMult) { mx = -nx; mz = -nz; }
      else if (dist > 0.7 * s.range && s.weapon === 'shotgun') { mx = nx; mz = nz; }
      else {
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = rand(0.8, 2); e.strafeDir *= -1; }
        mx = -nz * e.strafeDir; mz = nx * e.strafeDir;
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

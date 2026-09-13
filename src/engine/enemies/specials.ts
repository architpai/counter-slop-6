import { Vector3 } from 'three';
import { rand } from '../util';
import { seeThrough } from '../physics';
import { findCover, follow, steer, stop } from './ai';
import { flyerThink } from './flyer';
import { spawnProjectile } from './projectiles';
import type { EnemyManager, EnemyRecord } from './index';

const goal = new Vector3(), direction = new Vector3();
const visible = (m: EnemyManager, a: Vector3, b: Vector3) => m.ctx.world.lineOfSight(a, b, seeThrough) && !m.hazards.obscures(a, b);

function medic(m: EnemyManager, e: EnemyRecord, dt: number): void {
  const target = e.target!;
  if (e.wantCover) { e.wantCover = false; e.cover = findCover(m, e, target); e.coverT = 2; }
  if (e.cover && e.coverT > 0) { e.coverT -= dt; follow(m, e, e.cover, e.stats.speed, dt, true); return; }
  e.cover = null;
  const allies = m.list.filter(o => o !== e && o.alive && o.type !== 'medic' && !o.stats.flying);
  let patient: EnemyRecord | undefined, distance = Infinity;
  for (const ally of allies) {
    const d = ally.center.distanceTo(e.center);
    if (ally.hp < ally.maxHp && d < distance && visible(m, e.center, ally.center)) { patient = ally; distance = d; }
  }
  const anchor = patient ?? allies.reduce<EnemyRecord | undefined>((best, o) => !best || o.center.distanceTo(e.center) < best.center.distanceTo(e.center) ? o : best, undefined);
  if (!anchor) { stop(e, 8, dt); return; }
  direction.subVectors(anchor.body.pos, target.body.pos).setY(0).normalize();
  goal.copy(anchor.body.pos).addScaledVector(direction, 5);
  if (goal.distanceTo(e.body.pos) > 1.5) follow(m, e, goal.clone(), e.stats.speed, dt, true); else stop(e, 8, dt);
  if (patient && distance < 12) {
    patient.hp = Math.min(patient.maxHp, patient.hp + 15 * dt);
    if (patient.stats.boss) m.onBoss?.(patient);
    e.yawTo = Math.atan2(patient.center.x - e.center.x, patient.center.z - e.center.z);
    e.aimAmt = 1;
    e.specialT -= dt;
    if (e.specialT <= 0) { e.specialT = 0.06; m.ctx.effects.tracer(e.center, patient.center, 4, 0.045, 0.09); }
  }
}

function breacher(m: EnemyManager, e: EnemyRecord, dt: number): void {
  const target = e.target!, distance = e.body.pos.distanceTo(target.body.pos);
  e.attackCd -= dt;
  if (e.specialT > 0) {
    const previous = e.specialT; e.specialT += dt;
    if (e.specialT < 0.65) {
      stop(e, 12, dt);
      m.ctx.effects.tracer(e.body.pos.clone().add(new Vector3(0, 0.15, 0)), e.actionPoint!, 3, 0.04, 0.06);
    } else if (e.specialT < 1.2) {
      direction.copy(e.actionPoint!).sub(e.body.pos).setY(0).normalize();
      // The destination is locked at wind-up; never steer toward the player's new position.
      e.body.vel.x = Math.sin(e.homeYaw) * 15 * m.mods.speed;
      e.body.vel.z = Math.cos(e.homeYaw) * 15 * m.mods.speed;
      if (!e.attackHit && distance < 2.5 && visible(m, e.center, target.center)) {
        e.attackHit = true;
        if (target.tryBlockMelee(e)) {
          e.state = 'stunned'; e.age = 0; e.stunDuration = 1.3; e.specialT = 0; e.attackCd = 2.5;
          e.body.vel.set(0, 0, 0); return;
        }
        target.takeDamage(e.stats.damage * m.mods.damage, e.center);
      }
      if (e.body.hitWall && previous >= 0.65) e.specialT = 1.2;
    } else stop(e, 15, dt);
    if (e.specialT >= 2) { e.specialT = 0; e.attackCd = 2.5; }
    return;
  }
  if (distance < 8 && Math.abs(e.body.pos.y - target.body.pos.y) < 1.5 && e.attackCd <= 0 && visible(m, e.center, target.center)) {
    e.specialT = 0.001; e.attackHit = false;
    direction.subVectors(target.body.pos, e.body.pos).setY(0).normalize();
    e.homeYaw = e.yawTo = Math.atan2(direction.x, direction.z);
    e.actionPoint = e.body.pos.clone().addScaledVector(direction, 9); e.actionPoint.y += 0.15;
    m.ctx.audio.lunge(e.center); return;
  }
  follow(m, e, target.body.pos, e.stats.speed, dt);
  if (distance >= 8 && distance < 15 && e.attackCd <= 0 && visible(m, e.center, target.center)) {
    for (let i = 0; i < 5; i++) {
      direction.subVectors(target.center, e.center).normalize().add(new Vector3(rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1))).normalize();
      spawnProjectile(m, e.center, direction, 32, 4 * m.mods.damage, e, 1, 0.045, false);
    }
    e.attackCd = 2.5; m.ctx.audio.enemyShotgun(e.center);
  }
}

function carrier(m: EnemyManager, e: EnemyRecord, dt: number): void {
  if (!e.payload) { flyerThink(m, e, dt); return; }
  if (e.state === 'stunned') {
    e.body.vel.y -= 20 * dt;
    if (e.age > e.stunDuration) { e.state = 'hunt'; e.flightPhase = 'orbit'; }
    return;
  }
  if (!e.actionPoint) {
    const candidates = m.ctx.level.snipers.filter(p => {
      if (p.distanceTo(e.target!.body.pos) < 10) return false;
      if (m.ctx.world.overlapsAABB(p.clone().add(new Vector3(-0.35, 0.05, -0.35)), p.clone().add(new Vector3(0.35, 1.8, 0.35)))) return false;
      const path = m.ctx.nav.findPath(e.target!.body.pos, p), end = path?.at(-1);
      return !!path?.complete && !!end && end.distanceTo(p) < 1.5 && Math.abs(end.y - p.y) < 0.6;
    });
    candidates.sort((a, b) => a.distanceToSquared(e.body.pos) - b.distanceToSquared(e.body.pos));
    e.actionPoint = candidates[0]?.clone() ?? null;
    if (!e.actionPoint) { e.payload = false; return; }
  }
  goal.copy(e.actionPoint).y += 4;
  direction.subVectors(goal, e.body.pos).clampLength(0, e.stats.speed * m.mods.speed).sub(e.body.vel).clampLength(0, 22 * dt);
  e.body.vel.add(direction); e.yawTo = Math.atan2(e.body.vel.x, e.body.vel.z);
  if (e.body.hitWall) { e.body.vel.addScaledVector(e.body.wallNormal, 8 * dt); e.body.vel.y += 12 * dt; }
  e.specialT += dt;
  if (e.body.pos.distanceTo(goal) < 1.5) {
    e.payload = false;
    if (m.canSpawn('turret')) {
      const turret = m.spawn('turret', e.actionPoint);
      turret.homeYaw = turret.yaw = turret.yawTo = Math.atan2(e.target!.center.x - turret.center.x, e.target!.center.z - turret.center.z);
      turret.target = e.target;
    }
    e.actionPoint = null;
  } else if (e.specialT > 18) { e.payload = false; e.actionPoint = null; }
}

/** Called before ordinary brains. False lets an existing ranged/melee brain finish the frame. */
export function specialThink(m: EnemyManager, e: EnemyRecord, dt: number): boolean {
  if (!e.target) return false;
  if (e.type === 'carrier') { carrier(m, e, dt); return true; }
  if (e.state === 'stunned') return false;
  e.specialCd -= dt;
  if (e.type === 'parry') e.burstT = Math.max(0, e.burstT - dt);
  if (e.retreatT > 0) {
    e.retreatT -= dt; e.attackT = 0;
    direction.subVectors(e.body.pos, e.target.body.pos).setY(0).normalize();
    goal.copy(e.body.pos).addScaledVector(direction, 3);
    steer(m, e, goal, e.stats.speed * 0.5, 30, dt); return true;
  }
  if (e.type === 'medic') { medic(m, e, dt); return true; }
  if (e.type === 'breacher') { breacher(m, e, dt); return true; }
  if (e.type === 'smoker') {
    if (e.specialCd <= 0 && visible(m, e.center, e.target.center)) {
      if (m.hazards.throwSmoke(e.center, e.target.body.pos.clone().add(new Vector3(0, 1.5, 0)))) {
        e.specialCd = 9; m.ctx.audio.enemyShot(e.center);
      } else e.specialCd = 1;
    }
    if (e.body.pos.distanceTo(e.target.body.pos) > 15 || !visible(m, e.center, e.target.center))
      follow(m, e, e.target.body.pos, e.stats.speed, dt);
    else stop(e, 8, dt);
    return true;
  }
  if (e.type === 'packleader') {
    if (e.specialCd <= 0 && e.specialT <= 0) { e.specialT = 1; m.ctx.audio.bossRoar(e.center); }
    if (e.specialT > 0) {
      e.specialT -= dt; stop(e, 10, dt);
      m.ctx.effects.strokeBurst(e.center, 3, 1, 2, { life: 0.15, size: 0.04 });
      if (e.specialT <= 0) {
        for (const ally of m.list) if (ally.alive && ally.type === 'rusher' && ally.body.pos.distanceTo(e.body.pos) < 15) {
          ally.boostT = 3.5; ally.attackCd = 0; ally.backoffT = 0; ally.slotT = 0;
        }
        e.specialCd = 7;
      }
      return true;
    }
  }
  if (e.type === 'rubberbander') {
    if (e.specialT > 0 && e.actionPoint) {
      e.specialT -= dt; stop(e, 12, dt);
      m.ctx.effects.tracer(e.center, e.actionPoint.clone().add(new Vector3(0, 0.2, 0)), 5, 0.035, 0.07);
      m.ctx.effects.strokeBurst(e.actionPoint, 5, 1, 1, { life: 0.15, size: 0.07 });
      if (e.specialT <= 0) {
        // A fast physical dash, not a teleport through walls or over a hole.
        const saved = e.body.pos.clone(), distance = saved.distanceTo(e.actionPoint);
        e.body.vel.subVectors(e.actionPoint, saved).normalize().multiplyScalar(24);
        for (let remaining = distance / 24; remaining > 0; remaining -= 0.01)
          m.ctx.world.moveBody(e.body, Math.min(0.01, remaining));
        e.body.vel.set(0, 0, 0); e.path = null; e.pathT = 0; e.specialCd = 4; e.attackCd = 1;
        m.ctx.effects.strokeBurst(saved, 5, 10, 5, { life: 0.25, size: 0.035 });
        e.actionPoint = null;
      }
      return true;
    }
    if (e.specialCd <= 0 && e.body.onGround) {
      for (let i = 0; i < 8; i++) {
        const angle = rand(0, Math.PI * 2);
        goal.copy(e.body.pos).add(new Vector3(Math.sin(angle) * 6, 0, Math.cos(angle) * 6));
        const node = m.ctx.nav.nodes[m.ctx.nav.nearest(goal, 1, 1)];
        if (!node || Math.abs(node.y - e.body.pos.y) > 0.3) continue;
        const end = new Vector3(node.x, node.y, node.z), route = m.ctx.nav.findPath(e.body.pos, end, 1000);
        if (!route?.complete || route.length > 10 || route.some(p => Math.abs(p.y - end.y) > 0.3)) continue;
        if (!m.ctx.world.lineOfSight(e.center, end.clone().add(new Vector3(0, 1, 0)))) continue;
        e.actionPoint = end; e.specialT = 0.65; break;
      }
      if (!e.actionPoint) e.specialCd = 1;
    }
  }
  if (e.type === 'parry') {
    if (e.specialCd <= 0 && e.attackT <= 0) { e.guardT = 1.1; e.specialCd = 4; }
    if (e.guardT > 0) {
      e.guardT = Math.max(0, e.guardT - dt); stop(e, 10, dt);
      e.yawTo = Math.atan2(e.target.center.x - e.center.x, e.target.center.z - e.center.z);
      m.ctx.effects.strokeBurst(e.center, 3, 1, 0.3, { life: 0.15, size: 0.03 });
      if (e.guardT === 0) e.attackCd = 0.8;
      return true;
    }
  }
  if (e.type === 'sapper' && e.specialCd <= 0 && m.hazards.destroyedCover < 3 && !m.hazards.charges.length) {
    const props = m.ctx.level.breakables.filter(p => p.alive && p.group.name !== 'sapper charge'
      && ['crate', 'barrel'].includes(p.kind) && p.pos.distanceTo(e.target!.body.pos) < 7);
    props.sort((a, b) => a.pos.distanceToSquared(e.body.pos) - b.pos.distanceToSquared(e.body.pos));
    const prop = props[0];
    if (prop) {
      const distance = prop.pos.distanceTo(e.center);
      direction.subVectors(e.body.pos, prop.pos).setY(0).normalize();
      goal.copy(prop.pos).addScaledVector(direction, 1.4); goal.y = e.body.pos.y;
      if (distance > 2.5) follow(m, e, goal.clone(), e.stats.speed, dt, true);
      else if (m.ctx.world.lineOfSight(e.center, prop.pos, box => box === prop.box)) {
        const pos = prop.pos.clone();
        const dx = e.center.x - pos.x, dz = e.center.z - pos.z;
        if (Math.abs(dx) > Math.abs(dz)) pos.x = (dx > 0 ? prop.box.max.x : prop.box.min.x) + Math.sign(dx) * 0.3;
        else pos.z = (dz > 0 ? prop.box.max.z : prop.box.min.z) + Math.sign(dz || 1) * 0.2;
        if (m.hazards.plantCharge(prop, pos)) { e.specialCd = 10; m.ctx.audio.fuse(pos); }
      }
      return true;
    }
  }
  return false;
}

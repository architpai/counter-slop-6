import { Vector3 } from 'three';
import { damp, rand, TAU } from '../util.js';
import { spawnProjectile } from './projectiles.js';

const origin = new Vector3(), direction = new Vector3(), particlePos = new Vector3(), particleVel = new Vector3();

function stop(e, rate, dt) {
  e.body.vel.x = damp(e.body.vel.x, 0, rate, dt);
  e.body.vel.z = damp(e.body.vel.z, 0, rate, dt);
}

function hitRing(m, e, radius, height, damage, force, absoluteHeight = false) {
  for (const t of m.ctx.game.targets()) {
    if (!t.alive || Math.hypot(t.body.pos.x - e.body.pos.x, t.body.pos.z - e.body.pos.z) >= radius) continue;
    if (absoluteHeight ? Math.abs(t.body.pos.y - e.body.pos.y) >= height : t.body.pos.y >= e.body.pos.y + height) continue;
    t.takeDamage(damage * m.mods.damage, e.center);
    direction.subVectors(t.center, e.center).normalize();
    t.knockback(direction, force);
  }
}

function endAttack(e, factor = 1) {
  e.bossAttack = null;
  e.attackCd = rand(...e.stats.cooldown) * factor;
}

function admin(m, e, dt, dist, dy, yaw) {
  e.aimAmt = damp(e.aimAmt, e.hasLOS ? 1 : 0, 6, dt);
  if (!e.bossAttack && e.attackCd <= 0 && e.hasLOS) {
    if (dist < 7 && Math.abs(dy) < 3) {
      e.bossAttack = { kind: 'stomp', t: 0, fired: false };
      m.ctx.audio.bossRoar(e.center);
    } else if (dist < 32) e.bossAttack = { kind: 'throw', t: 0, fired: false };
  }
  const a = e.bossAttack;
  if (!a) { move(m, e, dt, dist, dy, yaw, 14); return; }
  a.t += dt; e.yawTo = yaw; stop(e, 5, dt);
  if (a.kind === 'stomp') {
    if (a.t > 0.75 && !a.fired) {
      a.fired = true; m.ctx.audio.stomp(e.center); m.ctx.effects.shake += 0.9;
      origin.copy(e.body.pos); origin.y += 0.2;
      m.ctx.effects.explosion(origin, 7, 2);
      for (let i = 0; i < 24; i++) {
        const angle = TAU * i / 24, x = Math.sin(angle), z = Math.cos(angle);
        particlePos.set(e.body.pos.x + x * 3, e.body.pos.y + 0.2, e.body.pos.z + z * 3);
        particleVel.set(x * 14, 2, z * 14);
        m.ctx.effects.particle({ kind: 'stroke', pos: particlePos, vel: particleVel, tone: 2, size: 0.06, life: 0.4, gravity: 4, stretch: 0.06, drag: 3 });
      }
      hitRing(m, e, 7.5, 2.5, 22, 9);
      m.blastEnemies(e.body.pos, 6, 60, e);
    }
    if (a.t > 1.3) endAttack(e);
  } else {
    if (a.t > 0.6 && !a.fired) {
      a.fired = true;
      (e.figure.anchors.head || e.figure.anchors.torso).getWorldPosition(origin); origin.y += 1;
      direction.subVectors(e.target.center, origin).normalize(); direction.y += 0.012 * dist; direction.normalize();
      spawnProjectile(m, origin, direction, 24, 19.8, e, 2, 0.4, true);
      m.ctx.audio.enemyShot(origin);
    }
    if (a.t > 1) endAttack(e, 0.6);
  }
}

function hitbox(m, e, dt, dist, dy, yaw) {
  e.aimAmt = damp(e.aimAmt, 0, 6, dt);
  if (!e.bossAttack && e.attackCd <= 0 && e.hasLOS) {
    if (e.chargeCount % 3 === 2 && dist < 12) {
      e.bossAttack = { kind: 'wipe', t: 0, fired: false }; e.chargeCount++;
    } else if (dist > 3 && dist < 30) e.bossAttack = { kind: 'charge', t: 0, dir: null, hit: false, dustT: 0 };
  }
  const a = e.bossAttack;
  if (!a) { move(m, e, dt, dist, dy, yaw, 16); return; }
  a.t += dt;
  if (a.kind === 'wipe') {
    e.yawTo = yaw; stop(e, 6, dt);
    if (a.t > 0.9 && !a.fired) {
      a.fired = true; m.ctx.audio.stomp(e.center); m.ctx.effects.shake += 0.8;
      origin.copy(e.body.pos); origin.y += 0.2; m.ctx.effects.explosion(origin, 6, 5);
      const live = m.list.reduce((n, enemy) => n + (enemy.alive && enemy.type === 'bomber' ? 1 : 0), 0);
      for (let i = 0; i < Math.min(2, 4 - live); i++) {
        const angle = rand(0, TAU);
        origin.set(e.body.pos.x + Math.cos(angle) * 3, e.body.pos.y, e.body.pos.z + Math.sin(angle) * 3);
        const child = m.spawn('bomber', origin); child.state = 'hunt'; child.root.scale.setScalar(child.stats.scale);
      }
      hitRing(m, e, 6.5, 3, 20.8, 9);
    }
    if (a.t > 1.6) endAttack(e);
    return;
  }
  if (a.t > 0.55 && !a.dir) {
    a.dir = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)); m.ctx.audio.bossRoar(e.center);
  }
  e.yawTo = a.dir ? Math.atan2(a.dir.x, a.dir.z) : yaw;
  if (a.t <= 0.7) stop(e, 8, dt);
  else if (a.t < 1.9) {
    e.body.vel.x = a.dir.x * 17 * m.mods.speed; e.body.vel.z = a.dir.z * 17 * m.mods.speed;
    if (!a.hit) for (const target of m.ctx.game.targets()) {
      if (!target.alive || Math.hypot(target.body.pos.x - e.body.pos.x, target.body.pos.z - e.body.pos.z) >= 2.6 || Math.abs(target.body.pos.y - e.body.pos.y) >= 3) continue;
      a.hit = true;
      target.takeDamage(26 * m.mods.damage, e.center);
      direction.subVectors(target.center, e.center); direction.y = 0.2; direction.normalize(); target.knockback(direction, 13);
      m.ctx.effects.shake += 0.5;
      break;
    }
    a.dustT -= dt;
    if (a.dustT <= 0) {
      a.dustT = 0.1; origin.copy(e.body.pos); origin.y += 0.3;
      m.ctx.effects.strokeBurst(origin, 5, 4, 3, { life: 0.35, size: 0.06 });
    }
    if (e.body.hitWall) {
      a.t = 1.9; m.ctx.effects.strokeBurst(e.center, 5, 30, 9, { life: 0.4, size: 0.05 });
      m.ctx.audio.stomp(e.center); m.ctx.effects.shake += 0.6; stop(e, 4, dt);
    }
  } else stop(e, 4, dt);
  if (a.t > 2.7) { e.chargeCount++; endAttack(e); }
}

function lagspike(m, e, dt, dist, dy, yaw) {
  e.aimAmt = damp(e.aimAmt, e.hasLOS ? 1 : 0, 6, dt);
  if (!e.bossAttack) {
    e.hopT -= dt;
    if (e.hopping && e.body.onGround) {
      e.hopping = false; m.ctx.audio.stomp(e.center); m.ctx.effects.shake += 0.4;
      m.ctx.effects.bloodPool(e.body.pos, 3.5, 2); hitRing(m, e, 4.5, 2.5, 14, 8, true);
    }
    if (e.body.onGround && e.hopT <= 0 && dist > 4) {
      e.hopT = rand(1.6, 2.4); e.body.vel.set(Math.sin(yaw) * 11, 13, Math.cos(yaw) * 11);
      e.body.onGround = false; e.hopping = true;
    }
    if (e.attackCd <= 0 && e.hasLOS) {
      if (e.sprayCount % 3 === 2) { e.bossAttack = { kind: 'summon', t: 0, fired: false }; e.sprayCount++; }
      else if (dist < 34) e.bossAttack = { kind: 'spray', t: 0, shots: 0 };
    }
  }
  const a = e.bossAttack;
  if (!a) {
    if (!e.hopping) move(m, e, dt, dist, dy, yaw, 14);
    else if (e.hasLOS) e.yawTo = yaw;
    return;
  }
  a.t += dt; e.yawTo = yaw; stop(e, 6, dt);
  if (a.kind === 'spray') {
    while (a.shots < 9 && a.t > 0.6 + 0.09 * a.shots) {
      const angle = yaw + (a.shots - 4) * 0.19;
      origin.copy(e.center); origin.y += 0.8;
      direction.set(Math.sin(angle), 0.18 + rand(-0.05, 0.05), Math.cos(angle)).normalize();
      spawnProjectile(m, origin, direction, 20, 11 * m.mods.damage, e, 2, 0.3, true);
      if (a.shots === 0) m.ctx.audio.enemyShot(origin);
      a.shots++;
    }
    if (a.t > 1.8) { e.sprayCount++; endAttack(e); }
  } else {
    if (a.t > 0.8 && !a.fired) {
      a.fired = true; m.ctx.audio.bossRoar(e.center);
      m.ctx.effects.strokeBurst(e.center, 2, 40, 10, { life: 0.5, size: 0.05 });
      const live = m.list.reduce((n, enemy) => n + (enemy.alive && enemy.type === 'flyer' ? 1 : 0), 0);
      for (let i = 0; i < Math.min(3, 6 - live); i++) {
        origin.set(e.center.x + rand(-2, 2), e.center.y + 2 + i, e.center.z + rand(-2, 2));
        const child = m.spawn('flyer', origin); child.state = 'hunt'; child.root.scale.setScalar(child.stats.scale);
      }
    }
    if (a.t > 1.4) endAttack(e);
  }
}

function move(m, e, dt, dist, dy, yaw, directRange) {
  if (e.hasLOS && dist < directRange && Math.abs(dy) < 2) m._steer(e, e.target.body.pos, e.stats.speed, 30, dt);
  else m._follow(e, e.target.body.pos, e.stats.speed, dt);
  if (e.hasLOS) e.yawTo = yaw;
}

export function bossThink(m, e, dt, dist, dy, dx, dz) {
  const yaw = Math.atan2(dx, dz);
  if (e.type === 'boss') admin(m, e, dt, dist, dy, yaw);
  else if (e.type === 'hitbox') hitbox(m, e, dt, dist, dy, yaw);
  else lagspike(m, e, dt, dist, dy, yaw);
}

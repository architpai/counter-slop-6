import { Vector3 } from 'three';
import { rand } from '../util.js';
import { seeThrough } from '../physics.js';

const want = new Vector3(), delta = new Vector3(), heading = new Vector3();
const down = new Vector3(0, -1, 0);

function flyTo(m, e, goal, speed, accel, dt) {
  delta.subVectors(goal, e.body.pos);
  const dist = delta.length();
  if (dist > 0.0001) delta.multiplyScalar(speed * m.mods.speed / dist);
  delta.sub(e.body.vel).clampLength(0, accel * dt);
  e.body.vel.add(delta);
  if (dist < 0.3) e.body.vel.multiplyScalar(Math.max(0, 1 - 4 * dt));
}

export function flyerThink(m, e, dt) {
  if (!e.target) return;
  const c = e.target.center, pos = e.body.pos;
  e.flightT -= dt; e.attackCd -= dt;
  if (e.flightPhase === 'stunned' || e.state === 'stunned') {
    e.body.vel.y -= 20 * dt;
    if (e.body.onGround || e.age > 2.2) { e.flightPhase = 'climb'; e.flightT = 1.2; e.state = 'hunt'; }
  } else if (e.flightPhase === 'orbit') {
    const angle = Math.atan2(pos.x - c.x, pos.z - c.z) + e.orbitDir * 0.45;
    want.set(c.x + Math.sin(angle) * 11, c.y + 6 + Math.sin(1.3 * e.age) * 1.5, c.z + Math.cos(angle) * 11);
    flyTo(m, e, want, 6.2, 22, dt);
    if (e.attackCd <= 0 && e.target.alive && m.ctx.world.lineOfSight(e.center, c, seeThrough)) {
      e.flightPhase = 'dive'; e.flightT = 1.6; e.diveHit = false; m.ctx.audio.flyerDive(e.center);
    }
    if (rand() < 1.5 * dt) m.ctx.audio.flyerBuzz(e.center);
  } else if (e.flightPhase === 'dive') {
    flyTo(m, e, c, 16, 28, dt);
    if (e.center.distanceTo(c) < 1.4 && !e.diveHit) {
      e.diveHit = true;
      if (e.target.tryBlockMelee(e)) {
        e.flightPhase = 'stunned'; e.state = 'stunned'; e.age = 0;
        e.body.vel.set(-0.3 * e.body.vel.x, -3, -0.3 * e.body.vel.z);
      } else {
        e.target.takeDamage(10 * m.mods.damage, e.center);
        heading.copy(e.body.vel).normalize(); e.target.knockback(heading, 3);
      }
    }
    if (e.state !== 'stunned' && (e.flightT <= 0 || e.diveHit || e.body.hitWall)) {
      e.flightPhase = 'climb'; e.flightT = 1.1; e.attackCd = rand(2.8, 4.2);
    }
  } else {
    want.set(c.x + (pos.x - c.x) * 1.5, c.y + 8, c.z + (pos.z - c.z) * 1.5);
    flyTo(m, e, want, 6.2, 18, dt);
    if (e.flightT <= 0) e.flightPhase = 'orbit';
  }
  if (e.body.vel.length() > 0.5) {
    heading.copy(e.body.vel).normalize();
    const wall = m.ctx.world.raycast(e.center, heading, 3.5);
    if (wall) { e.body.vel.addScaledVector(wall.normal, 14 * dt); e.body.vel.y += 12 * dt; }
  }
  if (m.ctx.world.raycast(e.center, down, 2.5)) e.body.vel.y += 12 * dt;
  if (e.body.vel.lengthSq() > 0.1) e.yawTo = Math.atan2(e.body.vel.x, e.body.vel.z);
}

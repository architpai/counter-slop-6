import * as THREE from 'three';
import { rand } from '../util';
import { TONE } from '../render/index';

export function createBreakables(ctx, pickups) {
  const delta = new THREE.Vector3();
  function breakProp(prop, direction = null, local = true, quiet = false) {
    if (!prop?.alive) return;
    prop.alive = false; ctx.world.removeBox(prop.box);
    if (quiet) { prop.group.removeFromParent(); return; }
    const d = direction?.lengthSq() > 0.01 ? direction.clone().normalize() : new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)).normalize();
    prop.group.updateWorldMatrix(true, true);
    for (const child of [...prop.group.children]) {
      const pos = child.getWorldPosition(new THREE.Vector3());
      const vel = d.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-3, 3), rand(2.5, 6.5), rand(-3, 3)));
      ctx.effects.debris(child, pos, vel, new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { radius: 0.14, blood: false, life: rand(6, 9) });
    }
    prop.group.removeFromParent();
    if (prop.kind === 'pinata') {
      for (const tone of [TONE.BOSS, TONE.ACCENT, TONE.HEAL]) ctx.effects.strokeBurst(prop.pos, tone, 16, 7, { life: 0.7, size: 0.05 });
      ctx.effects.explosion(prop.pos, 2.5, TONE.BOSS);
      if (!ctx.net.active || ctx.net.isHost) for (let i = 0; i < 2; i++) pickups.spawn('health', prop.pos.clone().add(new THREE.Vector3(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))));
      if (!ctx.game.isOnline()) ctx.game.addScore(25, 'PIÑATA');
    } else if (prop.kind === 'cactus') {
      ctx.effects.blood(prop.pos, d, 1.4, { tone: TONE.HEAL }); ctx.effects.bloodPool(prop.pos, 1.1, TONE.HEAL);
    } else {
      ctx.effects.strokeBurst(prop.pos, prop.tone, 12, 5, { life: 0.35, size: 0.04 }); ctx.effects.smoke(prop.pos, new THREE.Vector3(0, 1, 0), 3);
    }
    ctx.audio.smash(prop.pos, ['barrel', 'crate', 'cactus'].includes(prop.kind));
    if (local && ctx.net.active) ctx.net.broadcast('brk', { id: prop.id });
  }
  function hit(prop, damage, point, dir) {
    if (!prop?.alive || !Number.isFinite(damage) || damage <= 0) return;
    prop.hp -= damage;
    if (prop.hp <= 0) breakProp(prop, dir);
    else { ctx.effects.strokeBurst(point, prop.tone, 5, 4, { life: 0.2, size: 0.03 }); ctx.audio.shieldHit(point); }
  }
  function inArc(pos, dir, range, cosHalf) {
    return ctx.level.breakables.filter(p => {
      if (!p.alive) return false;
      delta.subVectors(p.pos, pos); const dist = delta.length();
      return dist < range + 0.5 && (dist < 0.4 || delta.dot(dir) / dist > cosHalf);
    });
  }
  function blast(pos, radius) {
    for (const p of ctx.level.breakables) if (p.alive && p.pos.distanceTo(pos) < radius * 0.9) breakProp(p, delta.subVectors(p.pos, pos));
  }
  return { hit, inArc, blast, breakProp };
}

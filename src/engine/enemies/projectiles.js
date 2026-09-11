import { Mesh, Vector3 } from 'three';
import { clamp, alignSegment } from '../util.js';
import { seeThrough } from '../physics.js';
import { boxGeo, unlitMat, TONE, TONE_HEX } from '../render/index.js';

const MAX = 240;
const half = new Vector3(), a = new Vector3(), b = new Vector3(), seg = new Vector3(), sample = new Vector3();
const closest = new Vector3(), dir = new Vector3(), away = new Vector3();

function draw(p) {
  const speed = p.vel.length();
  if (speed < 1e-5) { p.mesh.visible = false; return; }
  const len = p.blast ? p.thickness : clamp(speed * 0.02, 0.35, 0.9);
  half.copy(p.vel).multiplyScalar(len / speed / 2);
  alignSegment(p.mesh, a.subVectors(p.pos, half), b.addVectors(p.pos, half), p.thickness);
}

export function spawnProjectile(m, pos, direction, speed, damage, owner, tone, thickness, blast, id) {
  if (m.projectiles.length >= MAX) removeProjectile(m, 0);
  const p = {
    id: id ?? m.ids++, pos: pos.clone(), prev: pos.clone(), vel: direction.clone().normalize().multiplyScalar(speed),
    damage, owner, life: 4, deflected: false, tone, thickness, origin: pos.clone(), blast,
    mesh: new Mesh(boxGeo(1, 1, 1), unlitMat(TONE_HEX[tone] ?? TONE_HEX[TONE.HOSTILE])),
  };
  p.mesh.name = 'projectile';
  m.ctx.scene.add(p.mesh);
  draw(p);
  m.projectiles.push(p);
  if (id == null) m.onFire?.(p);
  return p;
}

export function removeProjectile(m, index) {
  const [p] = m.projectiles.splice(index, 1);
  p.mesh.removeFromParent();
}

// Closest point on segment prev->pos to `point`, distance compared against r.
function segmentHits(p, point, r) {
  seg.subVectors(p.pos, p.prev);
  const l2 = seg.lengthSq();
  const t = l2 > 0 ? clamp(sample.subVectors(point, p.prev).dot(seg) / l2, 0, 1) : 0;
  return closest.copy(p.prev).addScaledVector(seg, t).distanceTo(point) <= r;
}

function hitsTarget(p, t, r) {
  return segmentHits(p, t.center, r) || segmentHits(p, t.eye, r)
    || segmentHits(p, sample.set(t.center.x, t.center.y - 0.55, t.center.z), r - 0.05);
}

export function burst(m, p, point) {
  const { effects, audio, player } = m.ctx;
  effects.explosion(point, 2.5, TONE.DARK);
  audio.explosion(point);
  if (player?.alive) {
    const d = player.center.distanceTo(point);
    if (d < 3.5) {
      player.takeDamage(p.damage * (1 - d / 3.5), point);
      player.knockback(away.subVectors(player.center, point).normalize(), 6);
    }
  }
  if (!m.mirror) m.blastEnemies(point, 3.5, 1.5 * p.damage, p.owner);
}

export function deflect(m, p, perfect) {
  const player = m.ctx.player;
  p.deflected = true; p.tone = TONE.PRIMARY; p.damage *= perfect ? 3.5 : 2.2; p.life = 3;
  p.mesh.material = unlitMat(TONE_HEX[TONE.PRIMARY]);
  let target = perfect && p.owner?.alive ? p.owner : null;
  if (!target) target = m.nearestVisible(player.eye, player.forward, Math.cos(0.7), 70) || (p.owner?.alive ? p.owner : null);
  const speed = p.vel.length() * 1.6;
  if (target) dir.subVectors(target.center, p.pos).normalize(); else dir.copy(player.forward);
  p.vel.copy(dir).multiplyScalar(speed);
  m.ctx.effects.sparks(p.pos, dir, TONE.ACCENT, 10, 9);
  m.ctx.effects.strokeBurst(p.pos, TONE.PRIMARY, 8, 4, { life: 0.2 });
}

export function deflectArc(m, pos, direction, range, cosHalf) {
  let n = 0;
  for (const p of m.projectiles) {
    if (p.deflected) continue;
    dir.subVectors(p.pos, pos); const d = dir.length();
    if (d > range || (d > 1e-4 && dir.dot(direction) / d < cosHalf)) continue;
    deflect(m, p, false); n++;
  }
  return n;
}

export function updateProjectiles(m, dt) {
  const { world, effects, audio, game } = m.ctx;
  for (let i = m.projectiles.length - 1; i >= 0; i--) {
    const p = m.projectiles[i];
    p.life -= dt;
    if (p.life <= 0) { removeProjectile(m, i); continue; }
    p.prev.copy(p.pos);
    if (p.blast) p.vel.y -= 9 * dt;
    p.pos.addScaledVector(p.vel, dt);
    seg.subVectors(p.pos, p.prev);
    const len = seg.length();
    if (len < 1e-6) { draw(p); continue; }
    const wall = world.raycast(p.prev, dir.copy(seg).divideScalar(len), len, seeThrough);
    if (wall) {
      if (p.blast) burst(m, p, wall.point);
      else { effects.bulletImpact(wall.point, wall.normal, p.tone); if (Math.random() < 0.5) audio.bulletImpact(wall.point); }
      removeProjectile(m, i); continue;
    }
    let consumed = false;
    if (!p.deflected) {
      for (const t of game.targets()) {
        if (!t.alive) continue;
        const tight = p.blast ? 0.9 : 0.5;
        if (!hitsTarget(p, t, Math.max(tight, t.isLocal ? t.blockRadius : 0))) continue;
        if (t.isLocal) {
          const r = t.tryDeflect(p);
          if (r) {
            if (r.returned) { deflect(m, p, r.perfect); break; }
            effects.strokeBurst(p.pos, TONE.HOSTILE, 5, 6, { life: 0.18, size: 0.03 });
            consumed = true; break;
          }
          if (!hitsTarget(p, t, tight)) continue;
          if (p.blast) burst(m, p, p.pos); else t.takeDamage(p.damage, p.origin);
        }
        consumed = true; break;
      }
    } else {
      const hit = m.raycast(p.prev, dir, len);
      if (hit) {
        if (p.blast) burst(m, p, hit.point);
        else m.damage(hit.enemy, p.damage, { point: hit.point.clone(), dir: dir.clone(), part: hit.part, source: 'deflect', crit: hit.part === 'head' });
        consumed = true;
      }
    }
    if (consumed) removeProjectile(m, i); else draw(p);
  }
}

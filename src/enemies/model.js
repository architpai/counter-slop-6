import { Vector3 } from 'three';
import { makeFigure, TONE_HEX, setFlash } from '../render/index.js';
import { clamp, damp, rand, wrapAngle } from '../util.js';

const delta = new Vector3();
const RADII = { head: 0.3, torso: 0.33, hips: 0.2, armL: 0.11, armR: 0.11, foreL: 0.1, foreR: 0.1, legL: 0.13, legR: 0.13, shinL: 0.11, shinR: 0.11, shield: 0.66 };

export function makeModel(stats) {
  const weapon = stats.weapon === 'boss' ? (stats.kind === 'humanoid' ? 'hammer' : 'none')
    : stats.weapon === 'pistol' ? 'rifle' : ['rifle', 'shotgun', 'sniper', 'blade'].includes(stats.weapon) ? stats.weapon : 'none';
  const figure = makeFigure({ ...stats, color: TONE_HEX[stats.tone], weapon });
  const radii = stats.kind === 'humanoid' ? RADII : { torso: stats.flying ? 0.48 : 0.5 };
  const hits = Object.entries(radii).filter(([part]) => figure.anchors[part]).map(([part, r]) => ({ part, r: r * stats.scale, obj: figure.anchors[part], center: new Vector3() }));
  figure.root.scale.setScalar(0.001);
  return { figure, root: figure.root, hits };
}

export function syncModel(e) {
  e.root.updateMatrixWorld(true);
  for (const hit of e.hits) hit.obj.getWorldPosition(hit.center);
  e.figure.anchors.torso.getWorldPosition(e.center);
}

export function flash(e, on) {
  if (e.flashOn === on) return;
  e.flashOn = on;
  setFlash(e.root, on, e.stats.tone);
}

export function spawnPose(e) {
  const f = clamp(e.age / 0.6, 0, 1);
  e.root.scale.setScalar(Math.max(0.001, f * e.stats.scale * (1 + Math.sin(60 * e.age) * 0.12 * (1 - f))));
  if (e.age >= 0.6) { e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale); }
  e.root.position.copy(e.body.pos);
  e.root.rotation.y = e.yaw;
  syncModel(e);
}

export function animate(e, dt) {
  const p = e.figure.parts;
  const speed = Math.hypot(e.body.vel.x, e.body.vel.z);
  e.walkAmt = damp(e.walkAmt, clamp(speed / 4, 0, 1), 10, dt);
  e.phase += (speed * 2.2 + (speed > 0.4 ? 3 : 0)) * dt;
  const s = Math.sin(e.phase), c = Math.cos(e.phase), w = e.walkAmt;
  if (e.stats.flying) {
    p.torso.position.y = 0.6 + Math.sin(3 * e.age) * 0.1;
    p.torso.rotation.z = e.state === 'stunned' ? e.age * 12 : clamp((e.body.vel.x * Math.cos(e.yaw) - e.body.vel.z * Math.sin(e.yaw)) * -0.08, -0.8, 0.8);
    p.torso.rotation.x = clamp(-e.body.vel.y * 0.06, -0.6, 0.6);
    p.wingL.rotation.z = Math.sin(14 * e.age) * 0.35;
    p.wingR.rotation.z = -p.wingL.rotation.z;
    return;
  }
  const blob = e.stats.kind === 'blob';
  p.hips.position.y = (blob ? 0.5 : 0.86) + Math.abs(c) * 0.07 * w - (e.body.onGround ? 0 : 0.05);
  p.torso.rotation.set(e.flinch * (blob ? 0.4 : 0.35), 0, 0);
  p.thighL.rotation.x = e.body.onGround ? 0.9 * s * w : -0.5;
  p.thighR.rotation.x = e.body.onGround ? -0.9 * s * w : 0.6;
  p.shinL.rotation.x = e.body.onGround ? Math.max(0, c) * 1.1 * w : 1;
  p.shinR.rotation.x = e.body.onGround ? Math.max(0, -c) * 1.1 * w : 0.5;
  p.upperL.rotation.set(-0.75 * s * w, 0, -0.08);
  p.upperR.rotation.set(0.75 * s * w, 0, 0.08);
  if (p.foreL) p.foreL.rotation.set(-0.2, 0, 0);
  if (p.foreR) p.foreR.rotation.set(-0.2, 0, 0);
  if (blob) {
    p.upperL.rotation.x = -2.4 + Math.sin(e.age * 20) * 0.4 * w;
    p.upperR.rotation.x = -2.4 - Math.sin(e.age * 20) * 0.4 * w;
    if (e.fuseT >= 0) p.torso.rotation.z = Math.sin(e.age * 40) * 0.15;
    if (p.spark) p.spark.scale.setScalar(0.7 + rand(0, 0.8) + (e.fuseT >= 0 ? 1.5 : 0));
  } else if (e.stats.weapon === 'blade' && e.attackT > 0) {
    const wind = clamp((0.55 - e.attackT) / 0.37, 0, 1);
    const strike = e.attackT <= 0.18 ? 1 - e.attackT / 0.18 : 0;
    p.upperR.rotation.x = -2.2 * wind + 3.7 * strike;
    p.upperR.rotation.z = 0.7 * wind * (1 - strike);
    p.foreR.rotation.x = -1.2 * wind * (1 - strike);
    p.torso.rotation.x += -0.25 * wind + 0.8 * strike;
    p.torso.rotation.y = 0.5 * wind - 1.1 * strike;
  } else {
    p.upperR.rotation.x += (-1.35 - p.upperR.rotation.x) * e.aimAmt;
    p.upperL.rotation.x += (-1.2 - p.upperL.rotation.x) * e.aimAmt;
    p.upperL.rotation.y = 0.6 * e.aimAmt;
    p.torso.rotation.y = -0.35 * e.aimAmt;
  }
  if (e.shieldHp > 0) {
    p.upperL.rotation.set(-1.2, 0.3, 0);
    p.foreL.rotation.x = -0.9;
  }
  if (e.type === 'boss' && e.bossAttack) {
    const { kind, t } = e.bossAttack;
    const raise = clamp(t / (kind === 'stomp' ? 0.6 : 0.5), 0, 1);
    const slam = kind === 'stomp' && t >= 0.75;
    p.upperR.rotation.x = slam ? 0.9 : -2.4 * raise;
    p.torso.rotation.x += slam ? 0.5 : -0.3 * raise;
  }
  if (e.state === 'stunned') {
    p.torso.rotation.x = 0.6;
    p.upperL.rotation.x = p.upperR.rotation.x = -2.5;
    p.thighL.rotation.x = -0.8;
    p.thighR.rotation.x = 0.9;
  }
  if (p.head !== p.torso && e.target) {
    delta.subVectors(e.target.center, e.center);
    p.head.rotation.y = clamp(wrapAngle(Math.atan2(delta.x, delta.z) - e.yaw) - p.torso.rotation.y, -1.1, 1.1);
    p.head.rotation.x = clamp(-Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) * 0.8, -0.6, 0.6);
    p.head.rotation.z = s * 0.04 * w + (e.fuseT >= 0 ? Math.sin(30 * e.age) * 0.3 : 0);
  }
}

export function corpse(e, dt) {
  e.deadT += dt;
  if (e.rootDetached) return;
  if (e.topple) {
    e.topple.t = Math.min(1, e.topple.t + 2.2 * dt);
    e.root.rotation[e.topple.axis] = e.topple.sign * Math.PI / 2 * (1 - (1 - e.topple.t) ** 2);
  }
  if (e.deadT > 8.3) e.root.scale.setScalar(Math.max(0, (9 - e.deadT) / 0.7) * e.stats.scale);
}

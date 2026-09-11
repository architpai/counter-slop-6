import { Vector3 } from 'three';
import { clamp, damp, rand, angleLerp, round2, choose, shuffle, TAU } from '../util';
import { Body, seeThrough } from '../physics';
import { TONE } from '../render/index';
import { TYPES, BOSS_ORDER } from './types';
import { makeModel, syncModel, flash, spawnPose, animate, corpse } from './model';
import { groundThink, wander, steer, follow } from './ai';
import { flyerThink } from './flyer';
import { updateProjectiles, removeProjectile } from './projectiles';

export { TYPES, BOSS_ORDER };

const GOLDEN = 2.39996;
const STATE_CODE = { spawn: 0, hunt: 1, stunned: 2, dead: 3 };
const STATE_NAME = ['spawn', 'hunt', 'stunned', 'dead'];
const up = new Vector3(0, 1, 0);
const scratch = new Vector3(), scratch2 = new Vector3(), vel = new Vector3(), spin = new Vector3(), pos = new Vector3();

export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = []; this.byId = new Map(); this.projectiles = [];
    this.mods = { speed: 1, damage: 1 };
    this.mirror = false;
    this.onKill = this.onBoss = this.onSpawn = this.onClientHit = this.onFire = null;
    this.ids = 1; this.slots = 0; this.sepT = 0; this.alive = 0;
    this._steer = (e, goal, speed, accel, dt) => steer(this, e, goal, speed, accel, dt);
    this._follow = (e, target, speed, dt) => follow(this, e, target, speed, dt);
  }

  spawn(type, position, id) {
    const stats = TYPES[type];
    if (!stats || !position) return null;
    const { figure, root, hits } = makeModel(stats);
    const flying = !!stats.flying;
    const body = new Body(position, flying ? 0.45 : Math.min(0.33 * stats.scale, 0.9), (flying ? 0.8 : 1.85) * stats.scale, stats.boss ? 1.2 : 0.6);
    body.alwaysStep = true; body.noSnap = flying;
    const e = {
      id: id ?? this.ids++, type, stats, hp: stats.hp, maxHp: stats.hp, alive: true, state: 'spawn', age: 0,
      body, center: position.clone(), yaw: rand(0, TAU), yawTo: 0, phase: rand(0, TAU), walkAmt: 0, aimAmt: 0,
      flinch: 0, flashT: 0, flashOn: false, path: null, pathIndex: 0, pathT: 0, pathGoal: null, losT: 0, hasLOS: false,
      attackCd: rand(0.6, 1.4), burstLeft: 0, burstT: 0, aimT: 0, attackT: 0, attackHit: false, stunDuration: 0, stuckT: 0,
      strafeDir: choose([-1, 1]), strafeT: rand(1, 2), deadT: 0, slotAngle: this.slots++ * GOLDEN, slotRadius: 0, slotT: rand(0, 2),
      approachPoint: new Vector3(), keepMult: rand(0.75, 1.35), backoffT: 0, fuseT: -1, shieldHp: stats.shield ? 2 : 0,
      flightPhase: 'orbit', flightT: rand(0, 3), orbitDir: choose([-1, 1]), bossAttack: null, rootDetached: false,
      retargetT: 0, laser: null, chargeCount: 0, sprayCount: 0, hopT: 1, hopping: false, aimPoint: null, aimWarned: false,
      diveHit: false, topple: null, snapOld: null, snapNew: null, target: null, figure, root, hits,
    };
    this.ids = Math.max(this.ids, e.id + 1);
    root.position.copy(position); root.rotation.y = e.yaw;
    this.ctx.scene.add(root);
    syncModel(e);
    this.list.push(e); this.byId.set(e.id, e); this.alive++;
    if (!this.mirror) this.onSpawn?.(e);
    scratch.copy(position); scratch.y += 1;
    this.ctx.effects.strokeBurst(scratch, stats.tone ?? TONE.HOSTILE, stats.boss ? 60 : 26, stats.boss ? 10 : 6, { life: 0.5, size: 0.03 });
    this.ctx.audio.spawn(position);
    if (stats.boss) { this.ctx.audio.bossRoar(position); this.onBoss?.(e); }
    return e;
  }

  _pickTarget(e, dt) {
    e.retargetT -= dt;
    if (e.target?.alive && e.retargetT > 0) return;
    e.retargetT = 0.5;
    let best = null, bestD = Infinity;
    for (const t of this.ctx.game.targets()) {
      if (!t.alive) continue;
      const d = t.body.pos.distanceToSquared(e.body.pos);
      if (d < bestD) { bestD = d; best = t; }
    }
    e.target = best || this.ctx.player;
  }

  update(dt) {
    const { world } = this.ctx;
    for (const e of this.list) {
      e.age += dt;
      if (!e.alive) { corpse(e, dt); continue; }
      this._pickTarget(e, dt);
      if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0) flash(e, false); }
      e.flinch = damp(e.flinch, 0, 9, dt);
      if (e.state === 'spawn') { spawnPose(e); continue; }
      if (this.mirror) { this._mirrorStep(e, dt); continue; }
      if (e.state === 'stunned' && e.laser) e.laser.visible = false;
      if (e.stats.flying) {
        flyerThink(this, e, dt);
        world.moveBody(e.body, dt);
      } else {
        if (e.state === 'stunned' && e.age > e.stunDuration) e.state = 'hunt';
        if (e.state !== 'stunned') { if (e.target?.alive) groundThink(this, e, dt); else wander(e, dt); }
        e.body.vel.y -= 24 * dt;
        world.moveBody(e.body, dt);
      }
      if (e.body.pos.y < -6) { this.kill(e, { source: 'fall', dir: up.clone() }); continue; }
      e.yaw = angleLerp(e.yaw, e.yawTo, 1 - Math.exp(-10 * dt));
      e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw;
      if (!e.stats.flying && e.target) {
        const r = 0.36 + e.body.halfW + 0.12, tp = e.target.body.pos;
        const dx = e.body.pos.x - tp.x, dz = e.body.pos.z - tp.z, d = Math.hypot(dx, dz);
        if (d < r && Math.abs(e.body.pos.y - tp.y) < 1.7) {
          const ox = e.body.pos.x, oz = e.body.pos.z;
          const nx = d > 1e-4 ? dx / d : Math.sin(e.yaw), nz = d > 1e-4 ? dz / d : Math.cos(e.yaw);
          e.body.pos.x = tp.x + nx * r; e.body.pos.z = tp.z + nz * r;
          if (world.overlapsBody(e.body)) { e.body.pos.x = ox; e.body.pos.z = oz; }
          else e.root.position.copy(e.body.pos);
        }
      }
      animate(e, dt); syncModel(e);
    }
    if (!this.mirror) this._separate(dt);
    updateProjectiles(this, dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.alive || e.deadT <= 9) continue;
      this._destroy(e); this.list.splice(i, 1);
      if (this.mirror) this.byId.delete(e.id);
    }
  }

  _separate(dt) {
    this.sepT -= dt;
    if (this.sepT > 0) return;
    this.sepT = 0.05;
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const a = l[i]; if (!a.alive || a.stats.flying) continue;
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j]; if (!b.alive || b.stats.flying) continue;
        const rr = a.body.halfW + b.body.halfW + 0.75;
        const dx = a.body.pos.x - b.body.pos.x, dz = a.body.pos.z - b.body.pos.z, d = Math.hypot(dx, dz);
        if (d >= rr || d <= 0.001 || Math.abs(a.body.pos.y - b.body.pos.y) > 1.5) continue;
        const push = (rr - d) * 9, nx = dx / d, nz = dz / d;
        a.body.vel.x += nx * push; a.body.vel.z += nz * push;
        b.body.vel.x -= nx * push; b.body.vel.z -= nz * push;
      }
    }
  }

  _mirrorStep(e, dt) {
    const o = e.snapOld, n = e.snapNew;
    if (o && n) {
      const now = performance.now() / 1000, span = Math.max(0.02, n.t - o.t);
      const k = clamp((now - 0.1 - o.t) / span, 0, 1.2);
      scratch.copy(e.body.pos);
      e.body.pos.lerpVectors(o.p, n.p, k);
      vel.subVectors(e.body.pos, scratch).divideScalar(Math.max(dt, 1e-4)).clampLength(0, 30);
      e.body.vel.copy(vel); e.body.onGround = Math.abs(vel.y) < 0.5;
      e.yaw = angleLerp(o.yaw, n.yaw, k);
    }
    e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw;
    e.target = this.ctx.player;
    animate(e, dt); syncModel(e);
    if (e.laser) e.laser.visible = e.aimAmt > 0.9;
  }

  _destroy(e) {
    e.laser?.removeFromParent();
    if (!e.rootDetached) e.figure.dispose();
  }

  clear() {
    for (const e of this.list) this._destroy(e);
    this.list.length = 0; this.byId.clear(); this.alive = 0;
    while (this.projectiles.length) removeProjectile(this, 0);
  }

  _breakShield(e) {
    const plate = e.figure.dropShield();
    e.shieldHp = 0;
    const i = e.hits.findIndex(h => h.part === 'shield');
    if (i >= 0) e.hits.splice(i, 1);
    if (plate) this.ctx.effects.debris(plate, plate.position, vel.set(rand(-3, 3), 4, rand(-3, 3)), spin.set(rand(-6, 6), rand(-6, 6), rand(-6, 6)), { radius: 0.4, blood: false, life: 8 });
    this.ctx.audio.shieldHit(e.center);
    this.ctx.game.addScore(40, 'SHIELD BROKEN');
  }

  _bloodTone(e) { return e.stats.tone === TONE.DARK ? TONE.DARK : TONE.HOSTILE; }

  damage(e, amount, info = {}) {
    if (!e?.alive || !Number.isFinite(amount)) return;
    const { effects, audio, hud, input, game } = this.ctx;
    const point = info.point ?? e.center, dir = info.dir ?? up;
    if (info.part === 'shield') {
      effects.sparks(point, scratch.copy(dir).negate(), TONE.ACCENT, 8, 8);
      audio.shieldHit(point); hud.hitmarker(false, false);
      if ((info.source === 'katana' || info.source === 'blast') && e.shieldHp > 0 && --e.shieldHp <= 0) this._breakShield(e);
      return;
    }
    e.flinch = 1; e.flashT = 0.07; flash(e, true);
    effects.blood(point, dir, clamp(0.5 + amount / 70, 0.5, 2.2) * (e.stats.boss ? 1.6 : 1), { tone: this._bloodTone(e) });
    if (this.mirror) { hud.hitmarker(false, !!info.crit); this.onClientHit?.(e, amount, info); return; }
    amount *= this.mods.damage;
    e.hp -= amount;
    if (info.crit) audio.headshot(point); else audio.hitEnemy(point);
    hud.hitmarker(e.hp <= 0, !!info.crit);
    if (info.source !== 'deflect') input.rumble(0.1, 0.3, 30);
    if (e.state === 'spawn') { e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale); }
    if (e.stats.boss) this.onBoss?.(e);
    if (e.hp <= 0) { game.hitstop(info.crit ? 0.05 : 0.025, 0.25); this.kill(e, info); }
  }

  _detach(e, name, dir, extra, radius) {
    const part = e.figure.parts[name];
    if (!part || !part.parent) return;
    part.getWorldPosition(pos);
    vel.copy(dir).multiplyScalar(rand(3, 7)).add(extra); vel.y += rand(2, 5);
    spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    this.ctx.effects.debris(part, pos, vel, spin, { radius, blood: true, life: rand(7, 10) });
  }

  kill(e, info = {}, silent = false) {
    if (!e?.alive) return;
    const { effects, audio } = this.ctx;
    e.alive = false; e.state = 'dead'; e.deadT = 0; this.alive--;
    e.body.vel.set(0, 0, 0);
    if (e.laser) { e.laser.removeFromParent(); e.laser = null; }
    e.figure.setEyes(true);
    const dir = scratch2.copy(info.dir ?? scratch.set(0, 0.5, 0)).normalize();
    const done = overkill => { if (!silent) this.onKill?.(e, info, overkill); };
    if (e.type === 'bomber') { this._detonate(e, 0.8); done(true); return; }
    const tone = this._bloodTone(e);
    audio.enemyDie(e.center);
    if (e.stats.flying) {
      e.rootDetached = true;
      vel.copy(dir).multiplyScalar(4).add(scratch.set(rand(-2, 2), 1, rand(-2, 2)));
      effects.debris(e.root, e.body.pos, vel, spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { radius: 0.5, blood: true, life: 8 });
      effects.blood(e.center, dir, 1, { tone }); done(true); return;
    }
    const src = info.source, slash = src === 'katana' || src === 'focus';
    const overkill = -e.hp > 0.35 * e.maxHp || src === 'katana' || !!info.crit || src === 'deflect' || src === 'blast';
    if (overkill) {
      audio.gib(e.center);
      const p = e.figure.parts;
      if (info.crit || (slash && rand() < 0.35)) {
        this._detach(e, 'head', dir, scratch.set(rand(-2, 2), 3, rand(-2, 2)), 0.25);
        p.torso.getWorldPosition(pos); pos.y += 0.35; effects.fountain(pos, up, 0.9, tone);
      }
      if (slash) {
        const r = rand();
        if (r < 0.4) this._detach(e, 'upperR', dir, scratch.set(rand(-3, 3), 2, rand(-3, 3)), 0.12);
        else if (r < 0.7) this._detach(e, 'upperL', dir, scratch.set(rand(-3, 3), 2, rand(-3, 3)), 0.12);
        else this._detach(e, 'torso', dir, scratch.set(rand(-2, 2), 2, rand(-2, 2)), 0.3);
        p.hips.getWorldPosition(pos); effects.fountain(pos, up, 0.7, tone);
      } else if (src === 'deflect' || src === 'blast' || -e.hp > 0.6 * e.maxHp) {
        const parts = shuffle(['upperL', 'upperR', 'thighL', 'thighR', 'torso']);
        const k = e.stats.boss ? 5 : Math.round(rand(1, 2));
        for (let i = 0; i < k; i++) this._detach(e, parts[i], dir, scratch.set(0, 0, 0), 0.15);
      }
    }
    e.topple = { axis: rand() < 0.5 ? 'x' : 'z', sign: dir.z > 0 ? 1 : choose([-1, 1]), t: 0 };
    effects.bloodPool(e.body.pos, rand(1.1, 1.8) * (e.stats.boss ? 2.5 : 1), tone);
    effects.blood(e.center, dir, 1.2, { tone });
    if (rand() < 0.6) this._detach(e, 'weapon', dir, scratch.set(0, 0, 0), 0.08);
    if (e.shieldHp > 0) this._breakShield(e);
    if (e.stats.boss) { effects.explosion(e.center, 6, TONE.DARK); audio.explosion(e.center); this.onBoss?.(e); }
    done(overkill);
  }

  killMirror(id, info) {
    const e = this.byId.get(id);
    if (e) this.kill(e, info, true);
  }

  _detonate(e, scale) {
    const R = 4.2 * scale, c = e.center, { effects, audio, game } = this.ctx;
    effects.explosion(c, R, TONE.DARK); audio.explosion(c);
    for (const t of game.targets()) {
      if (!t.alive) continue;
      const d = t.center.distanceTo(c);
      if (d >= R) continue;
      t.takeDamage(24 * this.mods.damage * Math.sqrt(1 - d / R), c);
      t.knockback(scratch.subVectors(t.center, c).normalize(), 7);
    }
    if (!this.mirror) this.blastEnemies(c, R, 70, e);
    e.figure.dispose(); e.rootDetached = true; e.deadT = 99;
  }

  explode(e, scale) {
    if (!e) return;
    const wasAlive = e.alive;
    if (wasAlive) { e.alive = false; e.state = 'dead'; this.alive--; if (e.laser) { e.laser.removeFromParent(); e.laser = null; } }
    this._detonate(e, scale);
    if (wasAlive && !this.mirror) this.onKill?.(e, { source: 'blast', dir: up.clone() }, true);
  }

  blastEnemies(center, radius, base, except = null) {
    for (const e of this.list) {
      if (!e.alive || e === except) continue;
      const d = e.center.distanceTo(center);
      if (d >= radius) continue;
      this.damage(e, base * (1 - 0.6 * d / radius), { point: e.center.clone(), dir: scratch.subVectors(e.center, center).normalize().clone(), part: 'torso', source: 'blast', crit: false });
    }
  }

  yank(e, target) {
    if (!e?.alive) return;
    if (e.stats.boss) { e.flinch = 1; return; }
    e.state = 'stunned'; e.age = 0; e.stunDuration = 1.3; e.path = null;
    if (e.stats.flying) e.flightPhase = 'stunned';
    scratch.subVectors(target, e.body.pos);
    const d = scratch.length();
    if (d > 1e-4) scratch.divideScalar(d);
    e.body.vel.copy(scratch).multiplyScalar(clamp(d * 1.6, 10, 26));
    e.body.vel.y = clamp(d * 0.5, 4, 9);
    e.body.onGround = false;
    this.ctx.effects.blood(e.center, scratch, 0.4, { tone: this._bloodTone(e) });
  }

  raycast(origin, dir, max, ignore = null) {
    let best = null;
    for (const e of this.list) {
      if (!e.alive || e === ignore) continue;
      for (const h of e.hits) {
        scratch.subVectors(h.center, origin);
        const t = scratch.dot(dir);
        if (t < 0 || t > max) continue;
        const l2 = scratch.lengthSq() - t * t, r2 = h.r * h.r;
        if (l2 > r2) continue;
        const entry = t - Math.sqrt(r2 - l2);
        if (entry < 0 || (best && entry >= best.dist)) continue;
        best = { enemy: e, part: h.part, dist: entry, point: new Vector3().copy(origin).addScaledVector(dir, entry) };
      }
    }
    return best;
  }

  inArc(p, dir, range, cosHalf) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      scratch.subVectors(e.center, p);
      const d = scratch.length(), dist = d - (e.stats.boss ? 1.2 : 0);
      if (dist > range + 0.3) continue;
      if (dist < 0.3 || (d > 1e-4 && scratch.dot(dir) / d > cosHalf)) out.push({ enemy: e, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  nearestVisible(from, forward, cosHalf, max) {
    let best = null, bestD = max;
    for (const e of this.list) {
      if (!e.alive) continue;
      scratch.subVectors(e.center, from);
      const d = scratch.length();
      if (d < 0.01 || d >= bestD || scratch.dot(forward) / d < cosHalf) continue;
      if (!this.ctx.world.lineOfSight(from, e.center, seeThrough)) continue;
      bestD = d; best = e;
    }
    return best;
  }

  eye(e) { return (e.figure.anchors.head || e.figure.anchors.torso).getWorldPosition(new Vector3()); }

  snapshot() {
    return this.list.filter(e => e.alive).map(e => [e.id, round2(e.body.pos.x), round2(e.body.pos.y), round2(e.body.pos.z), round2(e.yaw),
      STATE_CODE[e.state] ?? 1, Math.round(e.hp), round2(e.aimAmt), round2(e.attackT), e.fuseT >= 0 ? 1 : 0, e.bossAttack ? 1 : 0]);
  }

  applySnapshot(rows, now) {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 11 || !r.every(Number.isFinite)) continue;
      const e = this.byId.get(r[0]);
      if (!e?.alive) continue;
      e.snapOld = e.snapNew ?? { p: e.body.pos.clone(), yaw: e.yaw, t: now - 0.08 };
      e.snapNew = { p: new Vector3(r[1], r[2], r[3]), yaw: r[4], t: now };
      const state = STATE_NAME[r[5]] ?? 'hunt';
      if (e.state === 'spawn' && state !== 'spawn') { e.state = state; e.root.scale.setScalar(e.stats.scale); }
      else if (e.state !== 'spawn') e.state = state;
      e.hp = r[6]; e.aimAmt = r[7]; e.attackT = r[8]; e.fuseT = r[9] ? 0.5 : -1;
      e.bossAttack = r[10] ? e.bossAttack ?? { kind: 'stomp', t: 0.3, fired: false } : null;
      if (e.stats.boss) this.onBoss?.(e);
    }
  }
}

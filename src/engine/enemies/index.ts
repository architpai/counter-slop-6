import { Vector3, Mesh as ThreeMesh, TorusGeometry, RingGeometry, Group as ThreeGroup } from 'three';
import type { Group, Mesh } from 'three';
import { clamp, damp, rand, angleLerp, round2, choose, shuffle, TAU } from '../util';
import { Body, seeThrough } from '../physics';
import { TONE, unlitMat } from '../render/index';
import type { Figure, FigureAnchorName, FigurePartName } from '../render/figure';
import { raycastFigure } from '../render/figure';
import type { ToneId } from '../render/palette';
import type { NavPath } from '../nav';
import type { Ctx, Enemy, EnemyKind, EnemyState, HitInfo, Target } from '../types';
import { TYPES, BOSS_ORDER } from './types';
import type { EnemyType } from './types';
import { makeModel, syncModel, flash, spawnPose, animate, corpse } from './model';
import type { GroundJoints, EyeAnchors, HitSphere } from './model';
import { groundThink, wander, steer, follow, onHit } from './ai';
import { flyerThink } from './flyer';
import { updateProjectiles, removeProjectile } from './projectiles';
import type { ProjectileRecord } from './projectiles';
import type { BossAttack } from './boss';
import { EnemyHazards } from './hazards';
import { specialThink } from './specials';
import { expansionBossThink } from './expansion-boss';
import { MUTATIONS, mutationCount } from './progression';
import { spawnProjectile } from './projectiles';

export { TYPES, BOSS_ORDER };

/** Death animation record (E §13.4). */
export interface Topple {
  axis: 'x' | 'z';
  sign: number;
  t: number;
}

/** One half of the mirror-side interpolation pair (E §17.3). */
export interface EnemySnap {
  p: Vector3;
  yaw: number;
  t: number;
}

export type FlightPhase = 'orbit' | 'dive' | 'climb' | 'stunned';

/**
 * The full runtime enemy (E §3.1). `Enemy` in `types.ts` is the slice other
 * modules see; everything below it is private to this subsystem.
 */
export interface EnemyRecord extends Enemy {
  type: EnemyKind;
  stats: EnemyType;
  age: number;
  yawTo: number;
  phase: number;
  walkAmt: number;
  aimAmt: number;
  flinch: number;
  flashT: number;
  flashOn: boolean;
  path: NavPath | null;
  pathIndex: number;
  pathT: number;
  pathGoal: Vector3 | null;
  losT: number;
  hasLOS: boolean;
  attackCd: number;
  burstLeft: number;
  burstT: number;
  aimT: number;
  attackT: number;
  attackHit: boolean;
  stunDuration: number;
  stuckT: number;
  strafeDir: number;
  strafeT: number;
  deadT: number;
  slotAngle: number;
  slotRadius: number;
  slotT: number;
  approachPoint: Vector3;
  keepMult: number;
  backoffT: number;
  /** -1 while unlit. */
  fuseT: number;
  shieldHp: number;
  flightPhase: FlightPhase;
  flightT: number;
  orbitDir: number;
  bossAttack: BossAttack | null;
  /** The model was handed to the debris system: no topple, no scale-down. */
  rootDetached: boolean;
  retargetT: number;
  laser: Mesh | null;
  chargeCount: number;
  sprayCount: number;
  hopT: number;
  hopping: boolean;
  aimPoint: Vector3 | null;
  aimWarned: boolean;
  diveHit: boolean;
  topple: Topple | null;
  snapOld: EnemySnap | null;
  snapNew: EnemySnap | null;
  target: Target | null;
  /** Ranged: the spot to duck behind between bursts, and how long to keep trying. */
  cover: Vector3 | null;
  coverT: number;
  wantCover: boolean;
  specialT: number;
  specialCd: number;
  actionPoint: Vector3 | null;
  weakT: number;
  yankableT: number;
  rageT: number;
  rageStacks: number;
  guardT: number;
  boostT: number;
  retreatT: number;
  homeYaw: number;
  payload: boolean;
  mutated: boolean;
  figure: Figure;
  root: Group;
  hits: HitSphere[];
}

/** One hit-sphere ray result. */
export interface EnemyRayHit {
  enemy: EnemyRecord;
  part: FigureAnchorName;
  dist: number;
  point: Vector3;
}

export interface EnemyArcHit {
  enemy: EnemyRecord;
  dist: number;
}

const GOLDEN = 2.39996;
const STATE_CODE: Record<EnemyState, number> = { spawn: 0, hunt: 1, stunned: 2, dead: 3 };
const STATE_NAME: readonly EnemyState[] = ['spawn', 'hunt', 'stunned', 'dead'];
const up = new Vector3(0, 1, 0);
const scratch = new Vector3(), scratch2 = new Vector3(), vel = new Vector3(), spin = new Vector3(), pos = new Vector3();
const isKind = (type: string): type is EnemyKind => Object.hasOwn(TYPES, type);

export class EnemyManager {
  ctx: Ctx;
  list: EnemyRecord[];
  byId: Map<number, EnemyRecord>;
  projectiles: ProjectileRecord[];
  mods: { speed: number; damage: number };
  hazards: EnemyHazards;
  mutations = new Set<EnemyKind>();
  /** True on a client mirror: it interpolates instead of thinking (dormant). */
  mirror: boolean;
  onKill: ((e: EnemyRecord, info: HitInfo, overkill: boolean) => void) | null;
  onBoss: ((e: EnemyRecord) => void) | null;
  onSpawn: ((e: EnemyRecord) => void) | null;
  onClientHit: ((e: EnemyRecord, amount: number, info: HitInfo) => void) | null;
  onFire: ((p: ProjectileRecord) => void) | null;
  /** Shared with projectiles: enemy and projectile ids come from one counter. */
  ids: number;
  slots: number;
  sepT: number;
  alive: number;
  _steer: (e: EnemyRecord, goal: Vector3, speed: number, accel: number, dt: number) => void;
  _follow: (e: EnemyRecord, target: Vector3, speed: number, dt: number) => void;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.list = []; this.byId = new Map(); this.projectiles = [];
    this.mods = { speed: 1, damage: 1 };
    this.hazards = new EnemyHazards(this);
    this.mirror = false;
    this.onKill = this.onBoss = this.onSpawn = this.onClientHit = this.onFire = null;
    this.ids = 1; this.slots = 0; this.sepT = 0; this.alive = 0;
    this._steer = (e, goal, speed, accel, dt) => steer(this, e, goal, speed, accel, dt);
    this._follow = (e, target, speed, dt) => follow(this, e, target, speed, dt);
  }

  canSpawn(type: string): boolean {
    if (!isKind(type)) return false;
    if (type === 'carrier' || type === 'turret') return this.list.filter(e => e.alive
      && (e.type === 'turret' || (e.type === 'carrier' && e.payload))).length < 2;
    const cap = TYPES[type].cap;
    return cap === undefined || this.list.filter(e => e.alive && e.type === type).length < cap;
  }

  setMutations(wave: number): void {
    this.mutations = new Set(MUTATIONS.slice(0, mutationCount(wave)).map(m => m.type));
    for (const e of this.list) if (e.alive) this.mutate(e);
  }

  private mutate(e: EnemyRecord): void {
    if (e.mutated || !this.mutations.has(e.type)) return;
    e.mutated = true;
    if (e.type === 'grunt') e.stats = { ...e.stats, burst: 5, cooldown: [2.6, 3.6] };
    const badge = new ThreeMesh(new TorusGeometry(0.25, 0.045, 6, 12), unlitMat(e.stats.flying ? 0xffb020 : 0xc56bff));
    badge.name = 'mutation marker'; badge.position.set(0, 1.1, -0.38);
    if (e.stats.flying) { badge.position.set(0, 0.3, 0.1); e.payload = true; }
    e.root.add(badge);
  }

  spawn(type: EnemyKind, position: Vector3, id?: number): EnemyRecord;
  spawn(type: string, position: Vector3 | null | undefined, id?: number): EnemyRecord | null;
  spawn(type: string, position: Vector3 | null | undefined, id?: number): EnemyRecord | null {
    if (!isKind(type) || !position) return null;
    const stats = TYPES[type];
    const { figure, root, hits } = makeModel(stats);
    const flying = !!stats.flying;
    const body = new Body(position, flying ? 0.45 : Math.min(0.33 * stats.scale, 0.9), (flying ? 0.8 : 1.85) * stats.scale, stats.boss ? 1.2 : 0.6);
    body.alwaysStep = true; body.noSnap = flying;
    const e: EnemyRecord = {
      id: id ?? this.ids++, type, stats, hp: stats.hp, maxHp: stats.hp, alive: true, state: 'spawn', age: 0,
      body, center: position.clone(), yaw: rand(0, TAU), yawTo: 0, phase: rand(0, TAU), walkAmt: 0, aimAmt: 0,
      flinch: 0, flashT: 0, flashOn: false, path: null, pathIndex: 0, pathT: 0, pathGoal: null, losT: 0, hasLOS: false,
      attackCd: rand(0.6, 1.4), burstLeft: 0, burstT: 0, aimT: 0, attackT: 0, attackHit: false, stunDuration: 0, stuckT: 0,
      strafeDir: choose([-1, 1]), strafeT: rand(1, 2), deadT: 0, slotAngle: this.slots++ * GOLDEN, slotRadius: 0, slotT: rand(0, 2),
      approachPoint: new Vector3(), keepMult: rand(0.75, 1.35), backoffT: 0, fuseT: -1, shieldHp: stats.shield ? 2 : 0,
      flightPhase: 'orbit', flightT: rand(0, 3), orbitDir: choose([-1, 1]), bossAttack: null, rootDetached: false,
      retargetT: 0, laser: null, chargeCount: 0, sprayCount: 0, hopT: 1, hopping: false, aimPoint: null, aimWarned: false,
      diveHit: false, topple: null, snapOld: null, snapNew: null, target: null, cover: null, coverT: 0, wantCover: false,
      specialT: 0, specialCd: type === 'aimbot' ? 12 : 3, actionPoint: null, weakT: 0, yankableT: 0,
      rageT: 0, rageStacks: 0, guardT: 0, boostT: 0, retreatT: 0, homeYaw: 0,
      payload: type === 'carrier', mutated: false, figure, root, hits,
    };
    this.ids = Math.max(this.ids, e.id + 1);
    root.position.copy(position); root.rotation.y = e.yaw;
    this.ctx.scene.add(root);
    syncModel(e);
    this.list.push(e); this.byId.set(e.id, e); this.alive++;
    this.mutate(e);
    if (type === 'turret') {
      const arc = new ThreeGroup(); arc.name = 'sentry arc';
      const mesh = new ThreeMesh(new RingGeometry(3.8, 4, 24, 1, -3 * Math.PI / 4, Math.PI / 2), unlitMat(0xffb020));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.04; arc.add(mesh); root.add(arc);
    }
    if (!this.mirror) this.onSpawn?.(e);
    if (this.ctx.game.mode !== 'training') {
      scratch.copy(position); scratch.y += 1;
      this.ctx.effects.strokeBurst(scratch, stats.tone ?? TONE.HOSTILE, stats.boss ? 60 : 26, stats.boss ? 10 : 6, { life: 0.5, size: 0.03 });
      this.ctx.audio.spawn(position);
      if (stats.boss) { this.ctx.audio.bossRoar(position); this.onBoss?.(e); }
    }
    return e;
  }

  _pickTarget(e: EnemyRecord, dt: number): void {
    e.retargetT -= dt;
    if (e.target?.alive && e.retargetT > 0) return;
    e.retargetT = 0.5;
    let best: Target | null = null, bestD = Infinity;
    for (const t of this.ctx.game.targets()) {
      if (!t.alive) continue;
      const d = t.body.pos.distanceToSquared(e.body.pos);
      if (d < bestD) { bestD = d; best = t; }
    }
    e.target = best || this.ctx.player;
  }

  update(dt: number): void {
    const { world } = this.ctx;
    const passive = this.ctx.game.mode === 'training';
    for (const e of this.list) {
      e.age += dt;
      if (!e.alive) { corpse(e, dt); continue; }
      if (!passive) this._pickTarget(e, dt);
      if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0) flash(e, false); }
      e.flinch = damp(e.flinch, 0, 9, dt);
      e.weakT = Math.max(0, e.weakT - dt); e.yankableT = Math.max(0, e.yankableT - dt);
      e.boostT = Math.max(0, e.boostT - dt);
      if (e.state === 'spawn') { spawnPose(e); continue; }
      if (this.mirror) { this._mirrorStep(e, dt); continue; }
      if (e.state === 'stunned' && e.laser) e.laser.visible = false;
      if (passive) {
        // No AI or contact attacks. Keep physics for grapple pulls and animation for hit feedback.
        e.target = null;
        e.body.vel.x = damp(e.body.vel.x, 0, 5, dt);
        e.body.vel.z = damp(e.body.vel.z, 0, 5, dt);
        if (!e.stats.flying || e.state === 'stunned') e.body.vel.y -= 24 * dt;
        world.moveBody(e.body, dt);
        if (e.state === 'stunned' && e.age > e.stunDuration) e.state = 'hunt';
      } else if (expansionBossThink(this, e, dt)) {
        world.moveBody(e.body, dt);
      } else {
        if (!e.stats.flying && e.state === 'stunned' && e.age > e.stunDuration) e.state = 'hunt';
        const handled = e.target?.alive ? specialThink(this, e, dt) : false;
        if (!handled) {
          if (e.stats.flying) flyerThink(this, e, dt);
          else if (e.state !== 'stunned') { if (e.target?.alive) groundThink(this, e, dt); else wander(e, dt); }
        }
        if (!e.stats.flying) e.body.vel.y -= 24 * dt;
        world.moveBody(e.body, dt);
      }
      if (e.body.pos.y < -6) { this.kill(e, { source: 'fall', dir: up.clone() }); continue; }
      e.yaw = angleLerp(e.yaw, e.yawTo, 1 - Math.exp(-10 * dt));
      e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw;
      if (e.type === 'turret') {
        const arc = e.root.getObjectByName('sentry arc'); if (arc) arc.rotation.y = e.homeYaw - e.yaw;
      }
      if (!e.stats.flying && e.target && e.type !== 'aimbot' && e.type !== 'turret') {
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
    if (!this.mirror && !passive) { this._separate(dt); this.hazards.update(dt); }
    updateProjectiles(this, dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e || e.alive || e.deadT <= 9) continue;
      this._destroy(e); this.list.splice(i, 1);
      this.byId.delete(e.id);
    }
  }

  _separate(dt: number): void {
    this.sepT -= dt;
    if (this.sepT > 0) return;
    this.sepT = 0.05;
    const l = this.list;
    for (let i = 0; i < l.length; i++) {
      const a = l[i]; if (!a || !a.alive || a.stats.flying || a.type === 'aimbot' || a.type === 'turret') continue;
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j]; if (!b || !b.alive || b.stats.flying || b.type === 'aimbot' || b.type === 'turret') continue;
        // Two rifles keep more room than a rusher pair: a firing line should spread, a charge can bunch.
        const ranged = (x: EnemyRecord) => ['rifle', 'pistol', 'shotgun', 'sniper'].includes(x.stats.weapon);
        const rr = a.body.halfW + b.body.halfW + (ranged(a) && ranged(b) ? 1.6 : 0.75);
        const dx = a.body.pos.x - b.body.pos.x, dz = a.body.pos.z - b.body.pos.z, d = Math.hypot(dx, dz);
        if (d >= rr || d <= 0.001 || Math.abs(a.body.pos.y - b.body.pos.y) > 1.5) continue;
        const push = (rr - d) * 9, nx = dx / d, nz = dz / d;
        a.body.vel.x += nx * push; a.body.vel.z += nz * push;
        b.body.vel.x -= nx * push; b.body.vel.z -= nz * push;
      }
    }
  }

  _mirrorStep(e: EnemyRecord, dt: number): void {
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

  _destroy(e: EnemyRecord): void {
    e.laser?.removeFromParent();
    if (!e.rootDetached) e.figure.dispose();
  }

  clear(): void {
    this.hazards.clear(); this.mutations.clear();
    for (const e of this.list) this._destroy(e);
    this.list.length = 0; this.byId.clear(); this.alive = 0;
    while (this.projectiles.length) removeProjectile(this, 0);
  }

  _breakShield(e: EnemyRecord): void {
    const plate = e.figure.dropShield();
    e.shieldHp = 0;
    const i = e.hits.findIndex(h => h.part === 'shield');
    if (i >= 0) e.hits.splice(i, 1);
    if (plate) this.ctx.effects.debris(plate, plate.position, vel.set(rand(-3, 3), 4, rand(-3, 3)), spin.set(rand(-6, 6), rand(-6, 6), rand(-6, 6)), { radius: 0.4, blood: false, life: 8 });
    this.ctx.audio.shieldHit(e.center);
    this.ctx.game.addScore(40, 'SHIELD BROKEN');
  }

  _bloodTone(e: EnemyRecord): ToneId { return e.stats.tone === TONE.DARK ? TONE.DARK : TONE.HOSTILE; }

  damage(e: EnemyRecord, amount: number, info: HitInfo = {}): void {
    if (!e?.alive || !Number.isFinite(amount) || amount <= 0) return;
    const { effects, audio, hud, input, game } = this.ctx;
    const point = info.point ?? e.center, dir = info.dir ?? up;
    if (e.type === 'parry' && e.guardT > 0 && e.state === 'hunt' && info.dir
      && ['r4c', 'rifle', 'shotgun', 'sniper', 'revolver', 'pistol'].includes(info.source ?? '')
      && info.dir.dot(scratch.set(Math.sin(e.yaw), 0, Math.cos(e.yaw))) < -0.5) {
      effects.sparks(point, scratch.copy(dir).negate(), TONE.ACCENT, 6, 6); hud.hitmarker(false, false, true);
      // One reflected projectile per 0.2 s, not one per shotgun pellet.
      if (e.burstT <= 0 && !this.mirror) {
        spawnProjectile(this, point, scratch.copy(dir).negate(), 30, 7, e, 3, 0.045, false); e.burstT = 0.2;
      }
      return;
    }
    if (info.part === 'shield') {
      effects.sparks(point, scratch.copy(dir).negate(), TONE.ACCENT, 8, 8);
      audio.shieldHit(point); hud.hitmarker(false, false, true);
      if ((info.source === 'melee' || info.source === 'blast') && e.shieldHp > 0 && --e.shieldHp <= 0) this._breakShield(e);
      return;
    }
    e.flinch = 1; e.flashT = 0.07; flash(e, true);
    effects.blood(point, dir, clamp(0.5 + amount / 70, 0.5, 2.2) * (e.stats.boss ? 1.6 : 1), { tone: this._bloodTone(e) });
    if (this.mirror) { hud.hitmarker(false, !!info.crit); this.onClientHit?.(e, amount, info); return; }
    amount *= this.mods.damage;
    if (e.type === 'aimbot' && e.weakT > 0 && info.crit) amount *= 1.5;
    if (e.type === 'moderator' && e.state === 'stunned' && info.crit) amount *= 1.5;
    e.hp -= amount;
    e.rageT = 0;
    if (e.type === 'medic') e.wantCover = true;
    if (amount > 0) this.ctx.player?.onHeadshot(info);
    if (info.crit) audio.headshot(); else audio.hitEnemy();
    hud.hitmarker(e.hp <= 0, !!info.crit);
    if (info.source !== 'deflect') input.rumble(0.1, 0.3, 30);
    if (e.state === 'spawn') { e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale); }
    else if (game.mode !== 'training') onHit(this, e);
    if (e.stats.boss) this.onBoss?.(e);
    if (e.hp <= 0) { game.hitstop(info.crit ? 0.05 : 0.025, 0.25); this.kill(e, info); }
  }

  _detach(e: EnemyRecord, name: FigurePartName | undefined, dir: Vector3, extra: Vector3, radius: number): void {
    const part = name ? e.figure.parts[name] : undefined;
    if (!part || !part.parent) return;
    part.getWorldPosition(pos);
    vel.copy(dir).multiplyScalar(rand(3, 7)).add(extra); vel.y += rand(2, 5);
    spin.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    this.ctx.effects.debris(part, pos, vel, spin, { radius, blood: true, life: rand(7, 10) });
  }

  kill(e: EnemyRecord, info: HitInfo = {}, silent = false): void {
    if (!e?.alive) return;
    const { effects, audio } = this.ctx;
    e.alive = false; e.state = 'dead'; e.deadT = 0; this.alive--;
    if (e.type === 'packleader') for (const ally of this.list) {
      if (ally.alive && ally.type === 'rusher' && ally.body.pos.distanceTo(e.body.pos) < 15) {
        ally.boostT = 0; ally.retreatT = 2; ally.attackT = 0;
      }
    }
    if (e.type === 'flyer' && e.mutated && e.payload) {
      effects.explosion(e.center, 3, TONE.ACCENT); this.blastEnemies(e.center, 3, 60, e);
    }
    e.body.vel.set(0, 0, 0);
    if (e.laser) { e.laser.removeFromParent(); e.laser = null; }
    e.figure.setEyes(true);
    const dir = scratch2.copy(info.dir ?? scratch.set(0, 0.5, 0)).normalize();
    const done = (overkill: boolean) => { if (!silent) this.onKill?.(e, info, overkill); };
    if (e.type === 'bomber') { this._detonate(e, 0.8); done(true); return; }
    const tone = this._bloodTone(e);
    audio.enemyDie(e.center);
    if (e.stats.flying) {
      e.rootDetached = true;
      vel.copy(dir).multiplyScalar(4).add(scratch.set(rand(-2, 2), 1, rand(-2, 2)));
      effects.debris(e.root, e.body.pos, vel, spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { radius: 0.5, blood: true, life: 8 });
      effects.blood(e.center, dir, 1, { tone }); done(true); return;
    }
    const src = info.source, slash = src === 'melee' || src === 'focus';
    const overkill = -e.hp > 0.35 * e.maxHp || src === 'melee' || !!info.crit || src === 'deflect' || src === 'blast';
    if (overkill) {
      audio.gib(e.center);
      // Bombers and flyers have returned above; every kind still here walks.
      const p = e.figure.parts as GroundJoints;
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
        const parts: FigurePartName[] = shuffle(['upperL', 'upperR', 'thighL', 'thighR', 'torso']);
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

  killMirror(id: number, info: HitInfo): void {
    const e = this.byId.get(id);
    if (e) this.kill(e, info, true);
  }

  _detonate(e: EnemyRecord, scale: number): void {
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

  explode(e: EnemyRecord, scale: number): void {
    if (!e) return;
    const wasAlive = e.alive;
    if (wasAlive) { e.alive = false; e.state = 'dead'; this.alive--; if (e.laser) { e.laser.removeFromParent(); e.laser = null; } }
    this._detonate(e, scale);
    if (wasAlive && !this.mirror) this.onKill?.(e, { source: 'blast', dir: up.clone() }, true);
  }

  blastEnemies(center: Vector3, radius: number, base: number, except: EnemyRecord | null = null): void {
    this.hazards.clearSmoke(center, radius);
    for (const e of this.list) {
      if (!e.alive || e === except) continue;
      const d = e.center.distanceTo(center);
      if (d >= radius) continue;
      this.damage(e, base * (1 - 0.6 * d / radius), { point: e.center.clone(), dir: scratch.subVectors(e.center, center).normalize().clone(), part: 'torso', source: 'blast', crit: false });
    }
  }

  yank(e: EnemyRecord, target: Vector3): boolean {
    if (!e?.alive) return false;
    if (e.stats.boss && (e.type !== 'moderator' || e.yankableT <= 0)) { e.flinch = 1; return false; }
    e.yankableT = 0; e.guardT = 0; e.specialT = 0;
    if (e.type === 'moderator') e.weakT = 1.3;
    e.state = 'stunned'; e.age = 0; e.stunDuration = 1.3; e.path = null;
    if (e.stats.flying) e.flightPhase = 'stunned';
    scratch.subVectors(target, e.body.pos);
    const d = scratch.length();
    if (d > 1e-4) scratch.divideScalar(d);
    e.body.vel.copy(scratch).multiplyScalar(clamp(d * 1.6, 10, 26));
    e.body.vel.y = e.type === 'moderator'
      ? -clamp((e.body.pos.y - target.y) * 3, 12, 35) : clamp(d * 0.5, 4, 9);
    e.body.onGround = false;
    this.ctx.effects.blood(e.center, scratch, 0.4, { tone: this._bloodTone(e) });
    return true;
  }

  raycast(origin: Vector3, dir: Vector3, max: number, ignore: EnemyRecord | null = null): EnemyRayHit | null {
    let best: EnemyRayHit | null = null;
    for (const e of this.list) {
      if (!e.alive || e === ignore) continue;
      const hit = raycastFigure(e.root, origin, dir, best ? best.dist : max);
      if (hit && (!best || hit.dist < best.dist)) best = { enemy: e, ...hit };
    }
    return best;
  }

  inArc(p: Vector3, dir: Vector3, range: number, cosHalf: number): EnemyArcHit[] {
    const out: EnemyArcHit[] = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      scratch.subVectors(e.center, p);
      const d = scratch.length(), dist = d - (e.stats.boss ? 1.2 : 0);
      if (dist > range + 0.3) continue;
      if (dist < 0.3 || (d > 1e-4 && scratch.dot(dir) / d > cosHalf)) out.push({ enemy: e, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  nearestVisible(from: Vector3, forward: Vector3, cosHalf: number, max: number): EnemyRecord | null {
    let best: EnemyRecord | null = null, bestD = max;
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

  eye(e: EnemyRecord): Vector3 {
    const anchors = e.figure.anchors as EyeAnchors;
    return (anchors.head || anchors.torso).getWorldPosition(new Vector3());
  }

  snapshot(): number[][] {
    return this.list.filter(e => e.alive).map(e => [e.id, round2(e.body.pos.x), round2(e.body.pos.y), round2(e.body.pos.z), round2(e.yaw),
      STATE_CODE[e.state] ?? 1, Math.round(e.hp), round2(e.aimAmt), round2(e.attackT), e.fuseT >= 0 ? 1 : 0, e.bossAttack ? 1 : 0]);
  }

  applySnapshot(rows: number[][], now: number): void {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 11 || !r.every(Number.isFinite)) continue;
      // Every slot above is present and finite; the defaults are for the type.
      const [id = 0, x = 0, y = 0, z = 0, yaw = 0, code = 1, hp = 0, aim = 0, attack = 0, fuse = 0, boss = 0] = r;
      const e = this.byId.get(id);
      if (!e?.alive) continue;
      e.snapOld = e.snapNew ?? { p: e.body.pos.clone(), yaw: e.yaw, t: now - 0.08 };
      e.snapNew = { p: new Vector3(x, y, z), yaw, t: now };
      const state = STATE_NAME[code] ?? 'hunt';
      if (e.state === 'spawn' && state !== 'spawn') { e.state = state; e.root.scale.setScalar(e.stats.scale); }
      else if (e.state !== 'spawn') e.state = state;
      e.hp = hp; e.aimAmt = aim; e.attackT = attack; e.fuseT = fuse ? 0.5 : -1;
      e.bossAttack = boss ? e.bossAttack ?? { kind: 'stomp', t: 0.3, fired: false } : null;
      if (e.stats.boss) this.onBoss?.(e);
    }
  }
}

import { BufferGeometry, Vector3 } from 'three';
import type { Group, Object3D } from 'three';
import { Spring3, clamp, damp, easeOut, rand, TAU } from '../util';
import { TONE } from '../render/index';
import { seeThrough } from '../physics';
import { GUN_STATS } from './stats';
import type { Falloff, GunKind, GunStats, RifleOptic, ScopeKind, Triple } from './stats';
import { makeGunModel, restPose } from './models';
import type { GunModel, WeaponModel } from './models';
import type { Ctx, Enemy, HitInfo, Player, WeaponState } from '../types';
import type { Weapon } from './index';

/** Duck-typed like the rest of three: meshes, lines and points all carry geometry. */
function hasGeometry(node: Object3D): node is Object3D & { geometry: BufferGeometry } {
  return 'geometry' in node && node.geometry instanceof BufferGeometry;
}

/** One sphere of an enemy hit box, as `enemies.raycast` reports it. */
interface EnemyRayHit {
  enemy: Enemy;
  part: string;
  dist: number;
  point: Vector3;
}

/** What `_damage` needs of a hit to scale it: the part struck and how far the ray ran. */
interface Falloffable {
  part: string;
  dist: number;
}

// Shared by guns and the always-available melee view model.
export abstract class ViewModel<M extends WeaponModel = WeaponModel> {
  /** Set by the concrete weapon: a scoped gun hides its model at full aim. */
  abstract readonly scope: boolean;

  _ctx: Ctx;
  _player: Player;
  _model: M;
  root: Group;
  _restPos: Vector3;
  _restRot: Vector3;
  _aimPos: Vector3;
  _posSpring: Spring3;
  _rotSpring: Spring3;
  _swayPos: Vector3;
  _swayRot: Vector3;
  aimAmt: number;
  _sprintAmt: number;
  _equipT: number;
  _equipped: boolean;
  _disposed: boolean;

  constructor(ctx: Ctx, player: Player, model: M, restPos: Triple, restRot: Triple = [0, 0, 0]) {
    this._ctx = ctx;
    this._player = player;
    this._model = model;
    this.root = model.root;
    this._restPos = new Vector3(...restPos);
    this._restRot = new Vector3(...restRot);
    this._aimPos = this._restPos.clone();
    this._posSpring = new Spring3(260, 18);
    this._rotSpring = new Spring3(220, 16);
    this._swayPos = new Vector3();
    this._swayRot = new Vector3();
    this.aimAmt = 0;
    this._sprintAmt = 0;
    this._equipT = 0;
    this._equipped = false;
    this._disposed = false;
    ctx.renderer.rig.add(this.root);
  }

  equip() {
    if (this._disposed) return;
    this._equipped = true;
    this._equipT = 0;
    this.root.visible = true;
  }

  unequip() { this._equipped = false; this.root.visible = false; }
  kickPos(x: number, y: number, z: number) { this._posSpring.kick(x, y, z); }
  kickRot(x: number, y: number, z: number) { this._rotSpring.kick(x, y, z); }

  _pose(st: WeaponState, dt: number) {
    const lx = clamp(st.lookDelta.x, -0.12, 0.12), ly = clamp(st.lookDelta.y, -0.12, 0.12);
    this.aimAmt = damp(this.aimAmt, st.aim ? 1 : 0, 14, dt);
    const ia = 1 - this.aimAmt, recoilScale = 0.3 + 0.7 * ia;
    const sp = this._swayPos, sr = this._swayRot;
    sp.x = damp(sp.x, lx * 0.5 * recoilScale, 10, dt);
    sp.y = damp(sp.y, ly * 0.35 * recoilScale, 10, dt);
    sr.y = damp(sr.y, lx * 1.4 * ia, 10, dt);
    sr.x = damp(sr.x, ly * 0.9 * ia, 10, dt);
    sr.z = damp(sr.z, (-lx * 1.8 - st.strafe * 0.06) * ia, 8, dt);
    const bob = 0.013 * st.bobAmt * (0.15 + 0.85 * ia);
    this._sprintAmt = damp(this._sprintAmt, st.sprinting && !st.aim ? 1 : 0, 8, dt);
    const sprint = this._sprintAmt, p = this._posSpring.update(dt), r = this._rotSpring.update(dt);
    this._equipT = Math.min(1, this._equipT + dt * 3.2);
    const eq = 1 - easeOut(this._equipT);
    this.root.position.lerpVectors(this._restPos, this._aimPos, this.aimAmt);
    this.root.position.x += sp.x + Math.sin(st.bobPhase) * bob + p.x * recoilScale + sprint * 0.06;
    this.root.position.y += sp.y + Math.abs(Math.cos(st.bobPhase)) * bob + p.y * recoilScale
      - eq * 0.32 - st.landDip * 0.35 * ia - sprint * 0.09;
    this.root.position.z += p.z + sprint * 0.05;
    this.root.rotation.set(
      this._restRot.x * ia + sr.x + r.x - eq * 0.9 + sprint * 0.4 + st.landDip * 0.5 * ia,
      this._restRot.y * ia + sr.y + r.y * (0.4 + 0.6 * ia) - sprint * 0.55,
      this._restRot.z * ia + sr.z + r.z * recoilScale + sprint * 0.18 + st.slideTilt * 0.4 * ia,
    );
    this.root.visible = this._equipped && !(this.scope && this.aimAmt >= 0.8);
  }

  _resetPose() {
    this.aimAmt = this._sprintAmt = this._equipT = 0;
    this._swayPos.set(0, 0, 0);
    this._swayRot.set(0, 0, 0);
    for (const spring of [this._posSpring, this._rotSpring]) {
      spring.value.set(0, 0, 0);
      spring.vel.set(0, 0, 0);
      spring.target.set(0, 0, 0);
    }
    for (const part of Object.values(this._model.parts)) {
      if (!part) continue;
      const rest = restPose(part);
      if (rest.restPos) part.position.copy(rest.restPos);
      if (rest.restRot) part.rotation.copy(rest.restRot);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.unequip();
    this.root.removeFromParent();
    const geometries = new Set<BufferGeometry>();
    this.root.traverse(obj => { if (hasGeometry(obj)) geometries.add(obj.geometry); });
    for (const geo of geometries) geo.dispose();
  }
}

/** The ammo and cycle state `resetAmmo` owns, which the constructor calls. */
export interface Gun {
  mag: number;
  reserve: number;
  reloading: boolean;
  /** Current cone half-angle in radians; `spreadPx` turns it into crosshair pixels. */
  _spread: number;
  /** Seconds until the next shot is allowed. */
  _fireT: number;
  _reloadTime: number;
  _flashT: number;
  /** Seconds left of the pump/bolt cycle. Negative inside the post-cycle window. */
  _pumpT: number;
  _pumped: boolean;
  /** The rack event of this reload has fired. */
  _racked: boolean;
  /** A shell reload owes the gun one pump when it ends. */
  _needPump: boolean;
}

export class Gun extends ViewModel<GunModel> implements Weapon {
  _stats: GunStats;
  readonly kind: GunKind;
  readonly name: string;
  readonly isGun: true;
  readonly scope: boolean;
  optic: RifleOptic = 'acog';
  readonly magSize: number;
  /** `Window.setTimeout` handle, a number. Never `NodeJS.Timeout`. */
  _autoReload: number | null;
  _muzzle: Vector3;
  _eject: Vector3;
  _velocity: Vector3;
  _dir: Vector3;

  constructor(ctx: Ctx, player: Player, kind: GunKind) {
    const stats = GUN_STATS[kind];
    if (!stats) throw new TypeError('Unknown gun kind');
    super(ctx, player, makeGunModel(kind), stats.restPos);
    this._stats = stats;
    this.kind = kind;
    this.name = stats.name;
    this.isGun = true;
    this.scope = stats.scope;
    this.magSize = stats.magSize;
    this._aimPos.fromArray(stats.sight).multiplyScalar(-0.46);
    this._aimPos.z -= stats.eyeDistance;
    this._autoReload = null;
    this._muzzle = new Vector3();
    this._eject = new Vector3();
    this._velocity = new Vector3();
    this._dir = new Vector3();
    this.resetAmmo();
  }

  get spreadPx() { return 5 + this._spread * 900; }
  get scopeKind(): ScopeKind { return this.kind === 'rifle' || this.kind === 'r4c' ? this.optic : 'sniper'; }
  get adsFov(): number { return this.scopeKind === 'holo' ? 82 : this._stats.adsFov; }
  get hint(): string { return this.scopeKind === 'holo' ? `${this._stats.hint} · holo` : this._stats.hint; }

  setOptic(optic: RifleOptic): void {
    if ((this.kind !== 'rifle' && this.kind !== 'r4c') || (optic !== 'acog' && optic !== 'holo')) return;
    this.optic = optic;
    if (this._model.parts.acog) this._model.parts.acog.visible = optic === 'acog';
    if (this._model.parts.holo) this._model.parts.holo.visible = optic === 'holo';
  }

  addAmmo(n: number) {
    if (Number.isFinite(n) && n > 0) this.reserve = Math.min(this.reserve + n, this._stats.maxReserve);
  }

  _cancelAutoReload() {
    if (this._autoReload !== null) clearTimeout(this._autoReload);
    this._autoReload = null;
  }

  resetAmmo() {
    this._cancelAutoReload();
    this.mag = this.magSize;
    this.reserve = this._stats.startingReserve;
    this.reloading = false;
    this._fireT = this._reloadTime = this._flashT = this._pumpT = 0;
    this._pumped = this._racked = this._needPump = false;
    this._spread = this._stats.hipSpread;
    this._model.flash.visible = false;
    this._resetPose();
  }

  dispose() { this._cancelAutoReload(); super.dispose(); }

  startReload() {
    if (this._disposed || this.reloading || this.mag >= this.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this._reloadTime = 0;
    this._racked = false;
    const cue = this._stats.reloadType === 'shells' ? 'shellCue'
      : this._stats.reloadType === 'cylinder' ? 'cylinder' : 'reload';
    this._ctx.audio[cue]();
  }

  animate(st: WeaponState, dt: number) {
    if (this._disposed || !this._equipped) return;
    this._pose(st, dt);
    this._fireT -= dt;
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) this._model.flash.visible = false;
    }
    const stats = this._stats;
    const base = st.aim ? stats.adsSpread : stats.hipSpread;
    const move = st.speed * stats.moveSpread + (st.grounded ? 0 : 0.01) + (st.sliding ? 0.008 : 0);
    this._spread = damp(this._spread, base + move, this._player.headshotT > 0 ? 22 : 7, dt);
    const slide = this._model.parts.slide;
    if (slide) slide.position.z = restPose(slide).restPos.z + Math.max(0, this._flashT) / 0.045 * 0.07;
    if (this._pumpT > 0) this._cycle(dt);
    if (this.reloading) {
      this._reload(dt);
      if (stats.reloadType !== 'shells') return;
    }
    if (st.reloadPressed && this.mag < this.magSize && this.reserve > 0 && !this.reloading && this._pumpT <= 0) {
      this.startReload();
      return;
    }
    const wantFire = stats.automatic ? st.fire : st.firePressed;
    if (!wantFire || this._fireT > 0 || this._pumpT > 0 || st.blockFire) return;
    if (this.mag <= 0) {
      if (st.firePressed) { this._ctx.audio.empty(); this.startReload(); }
      return;
    }
    if (this.reloading) {
      this.reloading = false;
      const hand = this._model.parts.leftHand;
      hand.position.copy(restPose(hand).restPos);
    }
    this._fire(st);
  }

  _fire(st: WeaponState) {
    const s = this._stats, { effects, audio, input, game } = this._ctx;
    const followUp = this._player.headshotT > 0 ? 0.6 : 1;
    this._fireT = s.fireInterval;
    this.mag--;
    const spreadNow = this._spread;
    this._spread = Math.min(this._spread + s.spreadKick * followUp, s.spreadMax);
    this._model.muzzle.getWorldPosition(this._muzzle);
    let hits = 0;
    for (let i = 0; i < s.pellets; i++) {
      this._player.aimDir(spreadNow, this._dir);
      if (this._ray(this._dir)) hits++;
    }
    const flash = this._model.flash;
    flash.visible = true;
    this._flashT = 0.045;
    if (this._model.parts.slide) this._model.parts.slide.position.z = restPose(this._model.parts.slide).restPos.z + 0.07;
    flash.rotation.z = rand(0, TAU);
    flash.scale.setScalar(s.flashScale * rand(0.8, 1.4));
    effects.strokeBurst(this._muzzle, TONE.ACCENT, 4 + s.pellets, 6 * s.flashScale,
      { life: 0.08, size: 0.03, gravity: 0, drag: 8 });
    effects.smoke(this._muzzle, this._player.forward, this.kind === 'shotgun' ? 5 : 2);
    if (s.casing && s.reloadType !== 'shells') this._ejectShell();
    if (s.cycleDuration) {
      this._pumpT = s.cycleDuration + 0.12;
      this._pumped = false;
      if (s.reloadType === 'shells') this._needPump = true;
    }
    const k = s.modelKick;
    this.kickPos(rand(-k[0], k[0]) * followUp, rand(0.4 * k[1], k[1]) * followUp, k[2] * followUp);
    this.kickRot(k[3] * followUp, rand(-k[4], k[4]) * followUp, rand(-k[5], k[5]) * followUp);
    this._player.recoil((s.camKick[0] * (st.aim ? 0.7 : 1) + rand(0, s.camKick[0] * 0.3)) * followUp, rand(-s.camKick[1], s.camKick[1]) * followUp);
    this._player.kickFov(s.fovKick);
    audio[s.fireCue]();
    input.rumble(0.15 + s.fovKick * 0.08, 0.5, 40 + s.fovKick * 15);
    effects.shake += 0.02 + s.fovKick * 0.02;
    if (hits > 0 && this.kind === 'shotgun') game.hitstop(0.03, 0.3);
    if (this.mag === 0 && s.reloadType === 'magazine') {
      this._cancelAutoReload();
      this._autoReload = window.setTimeout(() => {
        this._autoReload = null;
        if (!this._disposed && this.mag === 0 && !this.reloading) this.startReload();
      }, 250);
    }
  }

  _ray(dir: Vector3) {
    const { world, game, effects, audio } = this._ctx, s = this._stats;
    const enemies = this._ctx.enemies;
    const eye = this._ctx.camera.position;
    const enemy = enemies?.raycast(eye, dir, 300) ?? null;
    const wall = world.raycast(eye, dir, 300, seeThrough);
    const remote = game.raycastPlayers(eye, dir, 300);
    const enemyDist = enemy ? enemy.dist : Infinity, wallDist = wall ? wall.dist : Infinity;
    let point: Vector3, hit = true;
    if (remote && remote.dist < enemyDist && remote.dist < wallDist) {
      point = remote.point;
      game.hitPlayer(remote.player, this._damage(s.pvp[0], s.pvp[1], s.pvp[2], remote),
        { point, dir, part: remote.part, source: this.kind, crit: remote.part === 'head', dist: remote.dist });
    } else if (wall && wall.box.data.breakable && wallDist < enemyDist) {
      point = wall.point;
      game.breakHit(wall.box.data.breakable, s.damage, point, dir);
    } else if (enemy && enemyDist < wallDist) {
      point = enemy.point;
      enemies?.damage(enemy.enemy, this._damage(s.damage, s.headMult, s.falloff, enemy),
        { point, dir, part: enemy.part, source: this.kind, crit: enemy.part === 'head' });
    } else if (wall) {
      point = wall.point;
      effects.bulletImpact(point, wall.normal, TONE.PRIMARY);
      if (rand() < 0.25) audio.ricochet(point);
      hit = false;
    } else {
      point = eye.clone().addScaledVector(dir, 300);
      hit = false;
    }
    effects.tracer(this._muzzle, point, TONE.PRIMARY, s.tracerThickness, 0.05);
    game.onShot(point);
    return hit;
  }

  _damage(base: number, headMult: number, falloff: Falloff | null, hit: Falloffable) {
    return base * (hit.part === 'head' ? headMult : 1)
      * (falloff ? clamp(1 - (hit.dist - falloff[0]) / (falloff[1] - falloff[0]), falloff[2], 1) : 1);
  }

  _ejectShell(spread = 1) {
    if (!this._stats.casing) return;
    this._model.eject.getWorldPosition(this._eject);
    this._velocity.copy(this._player.right).multiplyScalar(rand(1.5, 2.5) * spread)
      .addScaledVector(this._player.forward, rand(-0.5, 0.5));
    this._velocity.y += rand(1.5, 2.8);
    this._ctx.effects.shell(this._eject, this._velocity, this._stats.casing[1], this._stats.casing[0]);
  }

  _cycle(dt: number) {
    this._pumpT -= dt;
    const t = 1 - this._pumpT / this._stats.cycleDuration, s = Math.sin(Math.min(1, t * 1.15) * Math.PI);
    const parts = this._model.parts;
    if (parts.foreEnd) parts.foreEnd.position.z = restPose(parts.foreEnd).restPos.z + s * 0.16;
    if (parts.bolt) {
      parts.bolt.position.z = restPose(parts.bolt).restPos.z + s * 0.2;
      parts.bolt.rotation.z = -s * 1.1;
    }
    this.root.rotation.x += s * 0.12;
    this.root.rotation.z += s * 0.15;
    this.root.position.y -= s * 0.02;
    if (t > 0.45 && !this._pumped) {
      this._pumped = true;
      this._ctx.audio.pump();
      this._ejectShell();
      this.kickRot(-1.5, 0, 1);
    }
    if (this._pumpT <= 0) {
      this._pumped = this._needPump = false;
      for (const part of [parts.foreEnd, parts.bolt]) {
        if (part) { part.position.copy(restPose(part).restPos); part.rotation.copy(restPose(part).restRot); }
      }
    }
  }

  _reload(dt: number) {
    this._reloadTime += dt;
    const s = this._stats, parts = this._model.parts;
    const t = this._reloadTime / s.reloadDuration;
    if (s.reloadType === 'shells') {
      const wave = Math.sin(Math.min(1, t) * Math.PI), hand = parts.leftHand;
      this.root.rotation.z += 0.35 * wave;
      this.root.rotation.x += 0.15 * wave;
      this.root.position.y -= 0.04 * wave;
      hand.position.copy(restPose(hand).restPos);
      hand.position.x += 0.1 * wave;
      hand.position.y -= 0.12 * wave;
      hand.position.z += 0.55 * wave;
      if (this._reloadTime + 1e-12 >= s.reloadDuration) {
        this.mag++;
        this.reserve--;
        this._reloadTime = 0;
        if (this.mag >= this.magSize || this.reserve <= 0) {
          this.reloading = false;
          hand.position.copy(restPose(hand).restPos);
          if (this._needPump) { this._pumpT = s.cycleDuration; this._pumped = false; }
        } else this._ctx.audio.shellCue();
      }
      return;
    }
    if (s.reloadType === 'magazine') {
      const tilt = Math.sin(clamp(t / 0.22, 0, 1) * Math.PI / 2)
        * (t < 0.82 ? 1 : clamp(1 - (t - 0.82) / 0.18, 0, 1));
      this.root.rotation.x -= 0.3 * tilt;
      this.root.rotation.y += 0.25 * tilt;
      this.root.rotation.z += 0.5 * tilt;
      this.root.position.x += 0.03 * tilt;
      this.root.position.y -= 0.07 * tilt;
      const wave = Math.sin(clamp((t - 0.18) / 0.5, 0, 1) * Math.PI);
      // Every magazine-fed gun models a magazine; a revolver reloads through `cylinder` below.
      if (parts.mag) {
        parts.mag.position.y = restPose(parts.mag).restPos.y - wave * 0.3;
        parts.mag.rotation.z = wave * 0.6;
      }
      if (t > 0.86 && !this._racked) {
        this._racked = true;
        this.kickRot(-2.5, 0, 0);
        this.kickPos(0, 0, 0.6);
      }
    } else {
      const open = t < 0.25 ? easeOut(t / 0.25) : t > 0.8 ? 1 - easeOut(clamp((t - 0.8) / 0.2, 0, 1)) : 1;
      this.root.rotation.z += 0.9 * open;
      this.root.rotation.x += 0.3 * open;
      this.root.position.x -= 0.05 * open;
      this.root.position.y += 0.02 * open;
      if (parts.cylinder) parts.cylinder.rotation.z = -1.5 * open;
      if (t > 0.3 && !this._racked) {
        this._racked = true;
        this._ctx.audio.shellCue();
        for (let i = 0; i < 6; i++) this._ejectShell(0.7);
      }
    }
    if (this._reloadTime + 1e-12 >= s.reloadDuration) {
      const take = Math.min(this.magSize - this.mag, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.reloading = false;
      for (const part of [parts.mag, parts.cylinder]) {
        if (part) { part.position.copy(restPose(part).restPos); part.rotation.copy(restPose(part).restRot); }
      }
    }
  }
}

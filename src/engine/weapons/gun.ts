import { BufferGeometry, LoopOnce, Vector3 } from 'three';
import type { AnimationAction, Group, Object3D } from 'three';
import { Spring3, clamp, damp, easeInOut, easeOut, rand, TAU } from '../util';
import { TONE } from '../render/index';
import { seeThrough } from '../physics';
import { GUN_STATS } from './stats';
import type { Falloff, GunKind, GunStats, RifleOptic, ScopeKind, Triple } from './stats';
import { LOW_SCALE, REAL_AIM_DEPTH, makeGunModel, makeRealGunModel, restPose } from './models';
import type { GunModel, ModelParts, WeaponModel } from './models';
import type { WeaponAssets } from '../render/weapons';
import type { Ctx, Enemy, HitInfo, Player, WeaponState } from '../types';
import type { Weapon } from './index';

/** Where the left hand holds the magazine during a reload, in model space. Scratch. */
const gripPoint = new Vector3();
/** Radians a Blender model's trigger turns at a full pull. */
const TRIGGER_TRAVEL = 0.3;

/** Duck-typed like the rest of three: meshes, lines and points all carry geometry. */
function hasGeometry(node: Object3D): node is Object3D & { geometry: BufferGeometry } {
  return 'geometry' in node && node.geometry instanceof BufferGeometry;
}

/** Free a view model's own geometry; the Blender models share theirs with `WeaponAssets`, which frees it. */
function disposeModel(model: WeaponModel): void {
  const geometries = new Set<BufferGeometry>();
  model.root.traverse(obj => { if (hasGeometry(obj) && !obj.geometry.userData.shared) geometries.add(obj.geometry); });
  for (const geo of geometries) geo.dispose();
  model.real?.mixer.stopAllAction();
}

/** Put every moving part back in its rest pose. */
function restParts(parts: ModelParts): void {
  for (const part of Object.values(parts)) {
    if (!part) continue;
    const rest = restPose(part);
    if (rest.restPos) part.position.copy(rest.restPos);
    if (rest.restRot) part.rotation.copy(rest.restRot);
  }
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

const _eye = new Vector3();

// Shared by guns and the always-available melee view model.
export abstract class ViewModel<M extends WeaponModel = WeaponModel> {
  /** Set by the concrete weapon: a scoped gun hides its model at full aim. */
  abstract readonly scope: boolean;

  _ctx: Ctx;
  _player: Player;
  /** The model in use: the flat one, or the Blender one while the realistic tier's weapons are in (`_syncLook`). */
  _model: M;
  /** The flat look's model, kept for the weapon's life. */
  _low: M;
  /** The Blender model, built from `renderer.weapons` when they are in and dropped when they go. */
  _real: M | null;
  /** The flat model's hip pose; a Blender model brings its own. */
  _lowRest: readonly [Triple, Triple];
  _restPos: Vector3;
  _restRot: Vector3;
  _aimPos: Vector3;
  _posSpring: Spring3;
  _rotSpring: Spring3;
  _swayPos: Vector3;
  _swayRot: Vector3;
  aimAmt: number;
  _sprintAmt: number;
  /** Raise progress 0..1; reaches 1 after `_drawTime` seconds. */
  _equipT: number;
  _drawTime: number;
  _equipped: boolean;
  _disposed: boolean;
  /** The Blender model's clip playing, and the one this frame asked for (`_want`, played by `_applyClip`). */
  _action: AnimationAction | null;
  _clipWanted: readonly [string, number] | null;
  _unsubscribe: (() => void) | null;

  constructor(ctx: Ctx, player: Player, model: M, restPos: Triple, restRot: Triple = [0, 0, 0], drawTime = 0.31) {
    this._ctx = ctx;
    this._player = player;
    this._model = this._low = model;
    this._real = null;
    this._lowRest = [restPos, restRot];
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
    this._drawTime = drawTime;
    this._equipped = false;
    this._disposed = false;
    this._action = null;
    this._clipWanted = null;
    ctx.renderer.rig.add(model.root);
    // Flags the rig meshes once; `?.` keeps stub renderers in tests working.
    ctx.renderer.prepareRig?.(model.root);
    this._unsubscribe = ctx.renderer.weapons?.subscribe(() => this._syncLook()) ?? null;
  }

  /** Child of `ctx.renderer.rig`: the model in use. */
  get root(): Group { return this._model.root; }

  /** The concrete weapon's Blender model, or null if it has none. */
  abstract _buildReal(assets: WeaponAssets): M | null;

  /** Where the root sits at full aim, for this model. */
  _aimFor(_model: M): Vector3 { return this._restPos.clone(); }

  /** How far out, about the eye, `model` is drawn at the current aim: `REAL_AIM_DEPTH` at full aim on a Blender model. */
  _aimDepth(model: M): number {
    return model.real ? 1 + (REAL_AIM_DEPTH - 1) * this.aimAmt : 1;
  }

  /** A socket's world position where the model looks to be: undone from being drawn further out (`_aimDepth`). */
  _socket(socket: Object3D, out: Vector3): Vector3 {
    socket.getWorldPosition(out);
    const depth = this._aimDepth(this._model);
    if (depth === 1) return out;
    const eye = this._ctx.renderer.rig.getWorldPosition(_eye);
    return out.sub(eye).divideScalar(depth).add(eye);
  }

  /** A model was put on: the concrete weapon restores what it shows (optic, blood). */
  _wore(_model: M): void {}

  /**
   * Wear the Blender model while the realistic tier's weapons are in
   * (render/weapons.ts), else the flat one. Called when they come or go, and
   * once by each concrete constructor; nothing about the weapon's state
   * changes, only what draws it.
   */
  _syncLook(): void {
    if (this._disposed) return;
    const assets = this._ctx.renderer.weapons;
    const ready = assets?.ready === true;
    if (ready && assets) this._real ??= this._buildReal(assets);
    this._useModel(ready && this._real ? this._real : this._low);
    if (!ready && this._real) {
      disposeModel(this._real);
      this._real = null;
    }
  }

  /** Swap the drawn model, carrying the pose and visibility over. */
  _useModel(model: M): void {
    const old = this._model;
    if (model === old) return;
    this._stopClip();
    restParts(old.parts);
    const [pos, rot] = model.real ? [model.real.restPos, model.real.restRot] : this._lowRest;
    const restShift = new Vector3(...pos).sub(this._restPos), turn = new Vector3(...rot).sub(this._restRot);
    const aimShift = this._aimPos.clone().negate();
    this._restPos.set(...pos);
    this._restRot.set(...rot);
    this._aimPos.copy(this._aimFor(model));
    aimShift.add(this._aimPos);
    // The root keeps its sway, springs and aim, moved from the old model's hip and aim poses to this
    // one's, so the swap needs no frame to settle (a paused game shows it posed too).
    const ia = 1 - this.aimAmt, r = old.root.rotation, depth = this._aimDepth(model);
    model.root.position.copy(old.root.position).divideScalar(this._aimDepth(old))
      .addScaledVector(restShift, ia).addScaledVector(aimShift, this.aimAmt).multiplyScalar(depth);
    if (model.real) model.root.scale.setScalar(depth);
    model.root.rotation.set(r.x + turn.x * ia, r.y + turn.y * ia, r.z + turn.z * ia);
    model.root.visible = old.root.visible;
    old.root.visible = false;
    old.root.removeFromParent();
    this._model = model;
    this._ctx.renderer.rig.add(model.root);
    this._ctx.renderer.prepareRig?.(model.root);
    this._wore(model);
  }

  /** The model in use has a keyframed clip of this name (the Blender guns do; the flat look has none). */
  _has(name: string): boolean {
    return this._model.real?.clips.has(name) ?? false;
  }

  /** Ask for a clip this frame at `t` (0-1 of it); `_applyClip` plays it after the procedural pose. */
  _want(name: string, t: number): void {
    this._clipWanted = [name, t];
  }

  /**
   * Hold the frame's clip (or the draw clip while raising) at its time, else
   * stop. The game's own timers drive the clips (`t` is the reload's, the
   * cycle's or the draw's progress), so a clip always spans exactly the
   * gameplay duration in weapons/stats.ts and never runs ahead of it; the
   * procedural sway, bob and recoil springs stay on the root, the clips move
   * the `pivot` inside it and the parts.
   */
  _applyClip(): void {
    const want = this._clipWanted ?? (this._equipT < 1 && this._has('equip') ? ['equip', this._equipT] as const : null);
    this._clipWanted = null;
    const real = this._model.real, clip = want ? real?.clips.get(want[0]) : undefined;
    if (!want || !real || !clip) {
      this._stopClip();
      return;
    }
    const action = real.mixer.clipAction(clip);
    if (this._action !== action) {
      this._stopClip();
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      this._action = action;
    }
    action.time = clamp(want[1], 0, 1) * clip.duration;
    real.mixer.update(0);
  }

  /** Stop the clip; its nodes go back to their rest pose. */
  _stopClip(): void {
    this._action?.stop();
    this._action = null;
  }

  equip() {
    if (this._disposed) return;
    this._equipped = true;
    this._equipT = 0;
    this.root.visible = true;
  }

  unequip() { this._equipped = false; this.root.visible = false; this._stopClip(); }
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
    this._equipT = Math.min(1, this._equipT + dt / this._drawTime);
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
    if (this._model.real) {
      const depth = this._aimDepth(this._model);
      this.root.position.multiplyScalar(depth);
      this.root.scale.setScalar(depth);
    }
    this.root.visible = this._equipped && !(this.scope && this.aimAmt >= 0.8);
  }

  _resetPose() {
    // `_equipT` belongs to `equip()`: a reset re-equips through the player and raises from there.
    this.aimAmt = this._sprintAmt = 0;
    this._swayPos.set(0, 0, 0);
    this._swayRot.set(0, 0, 0);
    for (const spring of [this._posSpring, this._rotSpring]) {
      spring.value.set(0, 0, 0);
      spring.vel.set(0, 0, 0);
      spring.target.set(0, 0, 0);
    }
    this._stopClip();
    restParts(this._model.parts);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._unsubscribe?.();
    this.unequip();
    for (const model of [this._low, this._real]) {
      if (!model) continue;
      model.root.removeFromParent();
      disposeModel(model);
    }
    this._real = null;
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
  /** Seconds a semi-auto press stays queued, so a click just before the interval ends still fires. */
  _fireBuffer: number;
  /** This reload began on an empty magazine (the Blender guns show their empty reload). */
  _reloadEmpty: boolean;
  /** How far the Blender model's trigger is pulled, 0-1. */
  _triggerPull: number;
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
    super(ctx, player, makeGunModel(kind), stats.restPos, [0, 0, 0], stats.drawTime);
    this._stats = stats;
    this.kind = kind;
    this.name = stats.name;
    this.isGun = true;
    this.scope = stats.scope;
    this.magSize = stats.magSize;
    this._aimPos.copy(this._aimFor(this._model));
    this._autoReload = null;
    this._muzzle = new Vector3();
    this._eject = new Vector3();
    this._velocity = new Vector3();
    this._dir = new Vector3();
    this.resetAmmo();
    this._syncLook();
  }

  _buildReal(assets: WeaponAssets): GunModel | null { return makeRealGunModel(this.kind, assets); }

  /**
   * The root's full-aim position: the sight on the camera axis,
   * `eyeDistance` ahead. The flat models aim from `GunStats.sight` (their
   * units, scaled once); a Blender model from its sight's socket for the
   * optic in use, with its eye at its own place along the gun where it has
   * one (`RealLook.eye`), so each optic sits at its own distance.
   */
  _aimFor(model: GunModel): Vector3 {
    const sight = model.sights?.[this.scope ? this.scopeKind : 'iron'];
    const aim = sight ? sight.clone().negate() : new Vector3(...this._stats.sight).multiplyScalar(-LOW_SCALE);
    const eye = model.real?.eye;
    if (sight && eye != null) aim.z = eye;
    else aim.z -= this._stats.eyeDistance;
    return aim;
  }

  /** A model was put on: it shows the optic in use and no flash, whatever the other model showed. */
  _wore(): void {
    for (const model of [this._low, this._real]) if (model) model.flash.visible = false;
    this.setOptic(this.optic);
  }

  get spreadPx() { return 5 + this._spread * 900; }
  get adsSpeed(): number { return this._stats.adsSpeed; }
  /** Raised far enough to fire. The raise takes `drawTime`; the last 15 % is settle. */
  get drawn(): boolean { return this._equipT >= 0.85; }
  get scopeKind(): ScopeKind { return this.kind === 'rifle' || this.kind === 'r4c' ? this.optic : 'sniper'; }
  get adsFov(): number { return this.scopeKind === 'holo' ? 82 : this._stats.adsFov; }
  get hint(): string { return this.scopeKind === 'holo' ? `${this._stats.hint} · holo` : this._stats.hint; }

  setOptic(optic: RifleOptic): void {
    if ((this.kind !== 'rifle' && this.kind !== 'r4c') || (optic !== 'acog' && optic !== 'holo')) return;
    this.optic = optic;
    if (this._model.parts.acog) this._model.parts.acog.visible = optic === 'acog';
    if (this._model.parts.holo) this._model.parts.holo.visible = optic === 'holo';
    this._aimPos.copy(this._aimFor(this._model));
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
    this._fireT = this._reloadTime = this._flashT = this._pumpT = this._fireBuffer = 0;
    this._pumped = this._racked = this._needPump = this._reloadEmpty = false;
    this._triggerPull = 0;
    this._spread = this._stats.hipSpread;
    this._model.flash.visible = false;
    this._resetPose();
  }

  dispose() { this._cancelAutoReload(); super.dispose(); }

  /** Holstering cancels a reload in progress; ammo only moves at completion, so nothing is lost. */
  unequip() {
    super.unequip();
    if (!this.reloading) return;
    this.reloading = false;
    this._reloadTime = 0;
    const parts = this._model.parts;
    for (const part of [parts.mag, parts.cylinder, parts.leftHand]) {
      if (part) { part.position.copy(restPose(part).restPos); part.rotation.copy(restPose(part).restRot); }
    }
  }

  /** Drawing an empty gun starts its reload, as the auto-reload would have. */
  equip() {
    super.equip();
    if (this.mag === 0) this.startReload();
  }

  startReload() {
    if (this._disposed || this.reloading || this.mag >= this.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this._reloadTime = 0;
    this._racked = false;
    this._reloadEmpty = this.mag === 0;
    const cue = this._stats.reloadType === 'shells' ? 'shellCue'
      : this._stats.reloadType === 'cylinder' ? 'cylinder' : 'reload';
    this._ctx.audio[cue]();
  }

  animate(st: WeaponState, dt: number) {
    if (this._disposed || !this._equipped) return;
    this._update(st, dt);
    this._applyClip();
  }

  _update(st: WeaponState, dt: number) {
    this._pose(st, dt);
    // Carry the residual so the rate of fire is frame-rate independent; clamp so idling banks no burst.
    this._fireT = Math.max(this._fireT - dt, -dt);
    if (this._flashT > 0) {
      this._flashT -= dt;
      if (this._flashT <= 0) this._model.flash.visible = false;
    }
    const stats = this._stats;
    const base = st.aim ? stats.adsSpread : stats.hipSpread;
    const move = st.speed * stats.moveSpread + (st.grounded ? 0 : 0.01) + (st.sliding ? 0.008 : 0);
    this._spread = damp(this._spread, base + move, this._player.headshotT > 0 ? 22 : 7, dt);
    const slide = this._model.parts.slide;
    if (slide) slide.position.z = restPose(slide).restPos.z + Math.max(0, this._flashT) / 0.045 * 0.07 * this._model.unit;
    const trigger = this._model.parts.trigger;
    if (trigger) {
      // Back about its pin (three's +Z is back) while fire is held.
      this._triggerPull = damp(this._triggerPull, st.fire && !st.blockFire ? 1 : 0, 40, dt);
      trigger.rotation.x = restPose(trigger).restRot.x - TRIGGER_TRAVEL * this._triggerPull;
    }
    if (this._pumpT > 0) this._cycle(dt);
    if (this.reloading) {
      this._reload(dt);
      if (stats.reloadType !== 'shells') return;
    }
    if (st.reloadPressed && this.mag < this.magSize && this.reserve > 0 && !this.reloading && this._pumpT <= 0) {
      this.startReload();
      return;
    }
    this._fireBuffer = st.firePressed ? 0.1 : this._fireBuffer - dt;
    const wantFire = stats.automatic ? st.fire : this._fireBuffer > 0;
    if (!wantFire || this._fireT > 0 || this._pumpT > 0 || st.blockFire || !this.drawn) return;
    this._fireBuffer = 0;
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
    this._fireT += s.fireInterval;
    const shot = s.magSize - this.mag; // 0 for the first round of a full magazine
    this.mag--;
    const spreadNow = this._spread;
    this._spread = Math.min(this._spread + s.spreadKick * followUp, s.spreadMax);
    this._socket(this._model.muzzle, this._muzzle);
    let hits = 0;
    for (let i = 0; i < s.pellets; i++) {
      this._player.aimDir(spreadNow, this._dir);
      if (this._ray(this._dir)) hits++;
    }
    const flash = this._model.flash;
    flash.visible = true;
    this._flashT = 0.045;
    if (this._model.parts.slide) this._model.parts.slide.position.z = restPose(this._model.parts.slide).restPos.z + 0.07 * this._model.unit;
    flash.rotation.z = rand(0, TAU);
    flash.scale.setScalar(s.flashScale * rand(0.8, 1.4));
    effects.strokeBurst(this._muzzle, TONE.ACCENT, 4 + s.pellets, 6 * s.flashScale,
      { life: 0.08, size: 0.03, gravity: 0, drag: 8 });
    effects.smoke(this._muzzle, this._player.forward, this.kind === 'shotgun' ? 5 : s.automatic ? 1 : 2);
    if (s.casing && s.reloadType !== 'shells') this._ejectShell();
    if (s.cycleDuration) {
      this._pumpT = s.cycleDuration + 0.12;
      this._pumped = false;
      if (s.reloadType === 'shells') this._needPump = true;
    }
    const k = s.modelKick;
    this.kickPos(rand(-k[0], k[0]) * followUp, rand(0.4 * k[1], k[1]) * followUp, k[2] * followUp);
    this.kickRot(k[3] * followUp, rand(-k[4], k[4]) * followUp, rand(-k[5], k[5]) * followUp);
    // Yaw walks a fixed pattern the player can learn; only 30 % of the kick is noise.
    this._player.recoil((s.camKick[0] * (st.aim ? 0.7 : 1) + rand(0, s.camKick[0] * 0.3)) * followUp, (Math.sin(shot * 0.9) * 0.7 + rand(-0.3, 0.3)) * s.camKick[1] * followUp);
    this._player.kickFov(s.fovKick);
    audio[s.fireCue]();
    input.rumble(0.15 + s.fovKick * 0.08, 0.5, 40 + s.fovKick * 15);
    effects.shake += 0.02 + s.fovKick * 0.02;
    if (hits > 0 && this.kind === 'shotgun') game.hitstop(0.03, 0.3);
    else if (hits > 0 && this.kind === 'sniper') game.hitstop(0.04, 0.3);
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
      // Bosses have huge heads; cap the multiplier so a boss is a fight, not a two-second headshot mag.
      const headMult = enemy.enemy.stats.boss ? Math.min(s.headMult, 1.5) : s.headMult;
      enemies?.damage(enemy.enemy, this._damage(s.damage, headMult, s.falloff, enemy),
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
    this._socket(this._model.eject, this._eject);
    this._velocity.copy(this._player.right).multiplyScalar(rand(1.5, 2.5) * spread)
      .addScaledVector(this._player.forward, rand(-0.5, 0.5));
    this._velocity.y += rand(1.5, 2.8);
    this._ctx.effects.shell(this._eject, this._velocity, this._stats.casing[1], this._stats.casing[0]);
  }

  _cycle(dt: number) {
    this._pumpT -= dt;
    const t = 1 - this._pumpT / this._stats.cycleDuration, s = Math.sin(Math.min(1, t * 1.15) * Math.PI);
    const parts = this._model.parts, u = this._model.unit;
    if (this._has('cycle')) this._want('cycle', t);
    else {
      if (parts.foreEnd) parts.foreEnd.position.z = restPose(parts.foreEnd).restPos.z + s * 0.16 * u;
      if (parts.bolt) {
        parts.bolt.position.z = restPose(parts.bolt).restPos.z + s * 0.2 * u;
        parts.bolt.rotation.z = -s * 1.1;
      }
      this.root.rotation.x += s * 0.12;
      this.root.rotation.z += s * 0.15;
      this.root.position.y -= s * 0.02;
    }
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

  /** The flat look's magazine reload (and a Blender gun's without a clip): procedural, `t` the reload's progress. */
  _reloadPose(t: number) {
    const parts = this._model.parts, u = this._model.unit;
    // Roll the gun up toward the eye so the magazine well is on screen, pull the
    // magazine out with the left hand, bring a fresh one up from below and seat it.
    const tilt = easeOut(clamp(t / 0.16, 0, 1)) * (t < 0.84 ? 1 : 1 - easeOut(clamp((t - 0.84) / 0.16, 0, 1)));
    // Muzzle up, underside rolled toward the eye, whole gun lifted: the magazine well is on screen.
    this.root.rotation.x += 0.45 * tilt;
    this.root.rotation.y += 0.12 * tilt;
    this.root.rotation.z -= 0.7 * tilt;
    this.root.position.x -= 0.04 * tilt;
    this.root.position.y += 0.12 * tilt;
    this.root.position.z += 0.05 * tilt;
    // 0 = seated, 1 = out of frame. Out over 0.16..0.42, back in over 0.5..0.76 with a small seat bump.
    const out = easeInOut(clamp((t - 0.16) / 0.26, 0, 1)), back = easeInOut(clamp((t - 0.5) / 0.26, 0, 1));
    const drop = t < 0.5 ? out : 1 - back;
    const seat = t >= 0.76 && t < 0.84 ? Math.sin((t - 0.76) / 0.08 * Math.PI) * 0.015 : 0;
    // Every magazine-fed gun models a magazine; a revolver reloads through `cylinder` below.
    const mag = parts.mag, hand = parts.leftHand, handRest = restPose(hand).restPos;
    if (mag) {
      const rest = restPose(mag);
      mag.position.set(rest.restPos.x, rest.restPos.y + (seat - 0.5 * drop) * u, rest.restPos.z + 0.08 * drop * u);
      mag.rotation.z = rest.restRot.z + 0.55 * drop;
      mag.rotation.x = rest.restRot.x - 0.2 * drop;
      // The hand goes to the magazine, follows it out and back, then returns to the fore-end.
      const grip = easeInOut(clamp((t - 0.04) / 0.12, 0, 1)) - easeInOut(clamp((t - 0.8) / 0.12, 0, 1));
      gripPoint.copy(mag.position); gripPoint.x -= 0.05 * u; gripPoint.y -= 0.09 * u; gripPoint.z += 0.02 * u;
      hand.position.lerpVectors(handRest, gripPoint, grip);
      hand.rotation.z = restPose(hand).restRot.z + 0.6 * grip;
    } else {
      hand.position.copy(handRest);
      hand.position.y -= 0.12 * drop * u;
    }
  }

  _reload(dt: number) {
    this._reloadTime += dt;
    const s = this._stats, parts = this._model.parts;
    const t = this._reloadTime / s.reloadDuration, u = this._model.unit;
    if (s.reloadType === 'shells') {
      const wave = Math.sin(Math.min(1, t) * Math.PI), hand = parts.leftHand;
      if (this._has('shell')) this._want('shell', t);
      else {
        this.root.rotation.z += 0.35 * wave;
        this.root.rotation.x += 0.15 * wave;
        this.root.position.y -= 0.04 * wave;
        hand.position.copy(restPose(hand).restPos);
        hand.position.x += 0.1 * wave * u;
        hand.position.y -= 0.12 * wave * u;
        hand.position.z += 0.55 * wave * u;
      }
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
      const clip = this._reloadEmpty && this._has('reload-empty') ? 'reload-empty' : 'reload';
      if (this._has(clip)) this._want(clip, t);
      else this._reloadPose(t);
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
      for (const part of [parts.mag, parts.cylinder, parts.leftHand]) {
        if (part) { part.position.copy(restPose(part).restPos); part.rotation.copy(restPose(part).restRot); }
      }
    }
  }
}

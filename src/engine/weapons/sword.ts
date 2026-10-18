import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp, damp, easeInOut, rand } from '../util';
import { ViewModel } from './gun';
import { makeSwordModel, makeRealSwordModel } from './models';
import { SWORD_HANDLING } from './stats';
import { launchWave } from './wave';
import { SlashTrail } from './slash-trail';
import type { WeaponModel } from './models';
import type { WeaponAssets } from '../render/weapons';
import type { Ctx, Player, WeaponState } from '../types';
import type { Weapon } from './index';

/** The flat sword's hip pose: low at the right, the blade rising up and in. A Blender sword brings its own. */
const REST_POS: [number, number, number] = [0.25, -0.17, -0.46];
const REST_ROT: [number, number, number] = [0.62, 0.18, -0.35];
/** The guard: the blade level across the view, edge out, a hand's width under the eye line. */
const GUARD_POS = new Vector3(0.10, -0.16, -0.46);
const GUARD_ROT = new Vector3(0.22, 1.42, 1.57);

/** How far the slashing blade leans off the view axis: its tip sweeps a cone in front, so the arms trail behind. */
const SLASH_LEAN = 1.1;
/** Where on that cone the tip starts and ends, in radians from the right: across the top, so the arms trail low. */
const SLASH_FROM = 0.75, SLASH_TO = 2.45;
const blade = new Vector3(), edge = new Vector3(), across = new Vector3(), basis = new Matrix4(), slashTurn = new Quaternion();

/**
 * The slash's pose at `e` (0..1 through its arc) into `pos` and `turn`: the
 * tip sweeps over the top of a cone ahead of the eye, from the starting side
 * to the far one, the edge leading, while the hands cross low in front. The
 * arms, which run back along the grip, stay behind and under the view.
 */
function slashPose(side: number, e: number, pos: Vector3, turn: Quaternion): void {
  const sweep = SLASH_FROM + (SLASH_TO - SLASH_FROM) * e, angle = side > 0 ? sweep : Math.PI - sweep;
  const c = Math.cos(angle), s = Math.sin(angle);
  blade.set(c * SLASH_LEAN, s * SLASH_LEAN, -1).normalize();
  // The tip's motion: anticlockwise on screen for a slash from the right, clockwise from the left.
  edge.set(-s * side, c * side, 0).addScaledVector(blade, -(-s * side * blade.x + c * side * blade.y)).normalize();
  // The model's blade runs along -z and its edge along -y.
  const z = blade.negate(), y = edge.negate();
  across.crossVectors(y, z);
  turn.setFromRotationMatrix(basis.makeBasis(across, y, z));
  pos.set(side * (0.2 - 0.36 * e), -0.17 - 0.05 * Math.sin(e * Math.PI), -0.44);
}

/** Flat damage of one sword hit on another player. No falloff, no headshot bonus. Two hits down a full-health player. */
export const SWORD_PVP_DAMAGE = 60;
/** Damage of one sword hit on an enemy. */
export const SWORD_DAMAGE = 80;
/** Seconds one slash takes; the Blender sword's slash clips are this long too. */
export const SLASH_TIME = 0.32;
/** Seconds from one slash's start to the next one's earliest start. Hold fire to chain them. */
export const SLASH_COOLDOWN = 0.4;
/** The slash's reach and half-angle. */
export const SWORD_REACH = 2.6;
const SWORD_ARC = Math.cos(0.9);
/**
 * Seconds into a slash in which the blade cuts bullets out of the air
 * (`Player.tryDeflect`). Online, a peer sees the slash about 80 ms late, so the
 * PvP window (`cutting(true)`) stays open `PVP_CUT_GRACE` longer.
 */
export const CUT_WINDOW: readonly [number, number] = [0.04, 0.22];
export const PVP_CUT_GRACE = 0.08;
/** What a perfect parry or a bullet cut adds to the execution gauge (game/execution.ts `CHARGE_FULL` is 3). */
export const PARRY_CHARGE = 0.25;
/** Seconds between two air slashes. */
export const WAVE_COOLDOWN = 1.5;

/** The blade state `resetAmmo` owns, which the constructor calls. */
export interface Sword {
  /** Guard is up: aim held, not slashing, off cooldown. */
  blocking: boolean;
  /** Seconds the current guard has been up. Under 0.26 a deflect is perfect. */
  blockT: number;
  cooldown: number;
  /** Seconds until the next air slash. */
  waveCooldown: number;
  /** Blade blood, 0..1. Decays; +0.42 per sword kill. */
  blood: number;
  combo: number;
  /** Seconds left of the current slash. */
  _slashT: number;
  _comboT: number;
  _blockAmt: number;
  _parrySwing: number;
  /** Side of the next parry flick, +1 or -1. */
  _parryDir: number;
  /** The hit test of this slash has run. */
  _hitDone: boolean;
}

/**
 * The sword: a loadout weapon like a gun (docs/spec/weapons.md §18). Fire
 * slashes (hold to chain), aim raises the guard, which blocks and parries;
 * a slash in the air also throws a wave that cuts for 12 m (weapons/wave.ts).
 * The middle of each slash cuts bullets out of the air. It is the lightest
 * thing to carry: its holder runs 15 % faster.
 */
export class Sword extends ViewModel implements Weapon {
  readonly kind: 'sword';
  readonly name: string;
  readonly hint: string;
  readonly isGun: false;
  readonly scope: false;
  /** The guard never zooms: `HIP_FOV` (player/camera.ts). */
  readonly adsFov: number;
  /** Walk-speed multiplier while the guard is up. */
  readonly adsSpeed: number;
  readonly moveSpeed: number;
  readonly mobility: number;
  mag: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  /** The smear along the blade tip's arc (weapons/slash-trail.ts). */
  _trail: SlashTrail;
  _hitDir: Vector3;
  _slashPos: Vector3;

  constructor(ctx: Ctx, player: Player) {
    super(ctx, player, makeSwordModel(), REST_POS, REST_ROT, 0.22);
    this.kind = 'sword';
    this.name = 'SWORD';
    this.hint = 'fire to slash · hold aim to guard · slash in the air to throw a wave';
    this.isGun = false;
    this.scope = false;
    this.adsFov = 82;
    this.adsSpeed = 0.85;
    this.moveSpeed = SWORD_HANDLING.moveSpeed;
    this.mobility = SWORD_HANDLING.mobility;
    this.mag = this.reserve = this.magSize = Infinity;
    this.reloading = false;
    this._trail = new SlashTrail(ctx);
    this._hitDir = new Vector3();
    this._slashPos = new Vector3();
    this.resetAmmo();
    this._syncLook();
  }

  _buildReal(assets: WeaponAssets): WeaponModel | null { return makeRealSwordModel(assets); }

  /** A new model shows the blade's blood as it is now. */
  _wore(model: WeaponModel): void {
    model.blood?.update(this.blood);
  }

  /** Slashing or guarding: the HUD's melee crosshair and the focus meter show. */
  get active() { return this._slashT > 0 || this.blocking || this._blockAmt > 0.1; }
  get slashing() { return this._slashT > 0; }
  /** 0..1 through the current slash, or null. */
  get slashProgress(): number | null { return this._slashT > 0 ? 1 - this._slashT / SLASH_TIME : null; }
  /** The blade is in the part of its arc that cuts bullets; `pvp` adds the latency grace. */
  cutting(pvp = false): boolean {
    if (this._slashT <= 0) return false;
    const age = SLASH_TIME - this._slashT;
    return age >= CUT_WINDOW[0] && age <= CUT_WINDOW[1] + (pvp ? PVP_CUT_GRACE : 0);
  }
  get spreadPx() { return 4; }
  unequip() { super.unequip(); this._trail.hide(); }
  dispose() { this._trail.dispose(); super.dispose(); }
  addAmmo() {}

  resetAmmo() {
    this.blocking = false;
    this.blockT = this.cooldown = this.waveCooldown = this.blood = this.combo = 0;
    this._slashT = this._comboT = this._blockAmt = this._parrySwing = 0;
    this._parryDir = 1;
    this._hitDone = false;
    this._resetPose();
    this._trail.hide();
    this._model.blood?.update(0);
  }

  /** Drop the swing and guard without touching blood or combo (a focus dash takes the hands). */
  _cancel() {
    this.blocking = false;
    this.blockT = this._slashT = this._blockAmt = this._parrySwing = 0;
    this._hitDone = false;
  }

  addBlood(amount: number) {
    if (Number.isFinite(amount)) this.blood = clamp(this.blood + amount, 0, 1);
  }

  onDeflect(perfect: boolean) {
    this._parrySwing = 1;
    this._parryDir *= -1;
    this.kickRot(perfect ? -3.5 : -2, this._parryDir * 2, this._parryDir * 2.5);
    this.kickPos(this._parryDir * 0.15, 0.15, 1.2);
  }

  /** Start a slash if the blade is free. True if one started. */
  startSlash(st: WeaponState): boolean {
    if (this._disposed || st.blockFire || this.cooldown > 0 || this._slashT > 0) return false;
    this._slashT = SLASH_TIME;
    this.blocking = false;
    this._hitDone = false;
    this.combo++;
    this._comboT = 0.9;
    this.cooldown = SLASH_COOLDOWN;
    this._ctx.audio.katanaSwing();
    this._player.kickFov(2);
    // A grounded slash still steps in; rushers strike from 3 m and the blade reaches 2.6.
    if (st.sprinting || !st.grounded) this._player.lunge(3.5);
    else this._player.step(1.6);
    const side = this.combo % 2 ? 1 : -1;
    if (!st.grounded && this.waveCooldown <= 0) {
      this.waveCooldown = WAVE_COOLDOWN;
      launchWave(this._ctx, this._player, side);
    }
    return true;
  }

  /**
   * A slash now, whatever the cooldown, that hits nothing itself: each cut of
   * an execution swings the blade, and the execution deals the damage (game/execution.ts).
   */
  forceSlash(st: WeaponState): void {
    this.cooldown = this._slashT = 0;
    if (this.startSlash({ ...st, grounded: true, sprinting: false, blockFire: false })) this._hitDone = true;
  }

  animate(st: WeaponState, dt: number) {
    if (this._disposed || !this._equipped) return;
    this._update(st, dt);
    this._applyClip();
    // The smear samples the blade where the pose and clip have just put it, through the sweep only (not the wind-up).
    const t = this._slashT > 0 ? 1 - this._slashT / SLASH_TIME : -1;
    this._trail.update(dt, t >= 0.12 && t <= 0.75, this.root, this._model.muzzle);
    // The blade's blood, in its frame where the pose and clip put it this frame.
    if (this._model.blood) {
      this.root.updateMatrixWorld(true);
      this._model.blood.update(this.blood);
    }
  }

  _update(st: WeaponState, dt: number) {
    this.waveCooldown = Math.max(0, this.waveCooldown - dt);
    if (st.blockFire) {
      this._cancel();
      this._pose({ ...st, aim: false }, dt);
      return;
    }
    this._pose({ ...st, aim: false }, dt);
    this.cooldown -= dt;
    this._comboT -= dt;
    if (this._comboT <= 0) this.combo = 0;
    this._parrySwing = Math.max(0, this._parrySwing - 4.5 * dt);
    this.blood = Math.max(0, this.blood - 0.05 * dt);
    const wantBlock = st.aim && this._slashT <= 0 && this.cooldown <= 0;
    if (wantBlock && !this.blocking) this.blockT = 0;
    this.blocking = wantBlock;
    if (this.blocking) this.blockT += dt;
    this._blockAmt = damp(this._blockAmt, this.blocking ? 1 : 0, 16, dt);
    const unit = this._model.unit;
    if (this._blockAmt > 0.001) {
      const b = this._blockAmt, r = this.root.rotation;
      this.root.position.lerp(GUARD_POS, b);
      r.x += (GUARD_ROT.x - r.x) * b;
      r.y += (GUARD_ROT.y - r.y) * b;
      r.z += (GUARD_ROT.z - r.z) * b;
      // A Blender sword raises its grip as it comes to guard; a slash below takes over.
      if (this._has('guard')) this._want('guard', b);
    }
    if (this._parrySwing > 0) {
      const f = Math.sin(Math.min(1, this._parrySwing) * Math.PI) * this._parryDir;
      this.root.rotation.z += f * 0.3;
      this.root.rotation.x += f * 0.12;
      this.root.position.x += f * 0.03 * unit;
    }
    if (this._slashT > 0) {
      this._slashT = Math.max(0, this._slashT - dt);
      const t = 1 - this._slashT / SLASH_TIME, side = this.combo % 2 ? 1 : -1;
      // In fast, out slower: the blade leaves the rest pose, sweeps over the top of the view (`slashPose`),
      // and settles back.
      const w = easeInOut(clamp(t / 0.14, 0, 1)) * easeInOut(clamp((1 - t) / 0.3, 0, 1));
      slashPose(side, easeInOut(clamp((t - 0.08) / 0.62, 0, 1)), this._slashPos, slashTurn);
      this.root.position.lerp(this._slashPos, w);
      this.root.quaternion.slerp(slashTurn, w);
      // A Blender sword adds its wrist snap on top of the arc.
      if (this._has('slash')) this._want(side > 0 ? 'slash' : 'slash-back', t);
      if (t > 0.4 && !this._hitDone) {
        this._hitDone = true;
        this._hit(side);
      }
    }
    if (st.fire && !this.blocking) this.startSlash(st);
  }

  _hit(side: number) {
    const { game, effects, audio, input } = this._ctx;
    const enemies = this._ctx.enemies;
    const p = this._player, d = this._hitDir;
    d.copy(p.forward);
    d.x += -p.forward.z * 0.7 * side;
    d.z += p.forward.x * 0.7 * side;
    d.y -= 0.35;
    d.normalize();
    let hit = false;
    for (const { enemy } of enemies?.inArc(p.eye, p.forward, SWORD_REACH, SWORD_ARC) ?? []) {
      if (!this._ctx.world.lineOfSight(p.eye, enemy.center)) continue;
      const point = enemy.center.clone();
      point.y += rand(-0.2, 0.4);
      enemies?.damage(enemy, SWORD_DAMAGE, { point, dir: d, part: 'torso', source: 'melee', crit: false, slashDir: side });
      hit = true;
    }
    for (const remote of game.playersInArc(p.eye, p.forward, SWORD_REACH, SWORD_ARC)) {
      game.hitPlayer(remote, SWORD_PVP_DAMAGE, { point: remote.center, dir: d, part: 'torso', source: 'melee', crit: false });
      hit = true;
    }
    if (game.cutRopes(p.eye, p.forward, SWORD_REACH + 0.3)) hit = true;
    for (const prop of game.breakablesInArc(p.eye, p.forward, SWORD_REACH + 0.1, SWORD_ARC)) {
      game.breakHit(prop, SWORD_DAMAGE, prop.pos, d);
      hit = true;
    }
    if (hit) {
      audio.katanaHit();
      game.hitstop(0.07, 0.12);
      effects.shake += 0.12;
      input.rumble(0.7, 0.4, 90);
      this.kickPos(0, 0, 1.5);
    }
  }
}

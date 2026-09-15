import { Vector3 } from 'three';
import { Body } from '../physics';
import { clamp, damp, rand } from '../util';
import { TONE } from '../render/index';
import { makeLoadout, GUN_STATS, Melee } from '../weapons/index';
import type { Gun, Weapon } from '../weapons/index';
import { MAX_GRENADES } from '../types';
import type { Ctx, Enemy, HitInfo, LastHit, Projectile, Target, WeaponState } from '../types';
import { initCamera, updateBob, updateCamera, idleCamera } from './camera';
import type { CameraState } from './camera';
import { initMovement, updateMovement, integrateMovement } from './movement';
import type { MovementState } from './movement';
import { initGrapple, updateGrapple, detachGrapple, updateBreath, updateGrappleVisual } from './grapple';
import type { GrappleState } from './grapple';
import { initGrenades, updateGrenades, throwGrenade, clearNades } from './grenades';
import type { GrenadeState, NadeThrow } from './grenades';

/** Four gun slots. Melee never changes the selected slot. */
const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4'] as const;
const isGun = (w: Weapon): w is Gun => w.isGun;

const direction = new Vector3();
const point = new Vector3();
const validVector = (v: Vector3 | null | undefined): v is Vector3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * `movement`, `camera`, `grapple` and `grenades` each own a slice of the player
 * and install it from their own `init`. Declaration merging keeps each slice
 * declared beside the code that writes it.
 */
export interface Player extends MovementState, CameraState, GrappleState, GrenadeState {}

export class Player implements Target {
  ctx: Ctx;
  body: Body;
  _eye: Vector3;
  _center: Vector3;
  _forward: Vector3;
  _right: Vector3;
  /** True while the idle camera drives the transform, which freezes the getters. */
  _idle: boolean;
  name: string;
  team: number;
  maxHp: number;
  hp: number;
  regenDelay: number;
  regenRate: number;
  sinceDamage: number;
  alive: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  hurtFx: number;
  flashFx: number;
  /** Spawn protection, set by `main`. */
  shieldT: number;
  deathTime: number;
  blockCd: number;
  blockHeld: number;
  /** Grapple stamina, 0..1. */
  breath: number;
  grenades: number;
  gravityScale: number;
  dashLock: boolean;
  firing: boolean;
  /** Set by `main` / PvP, for kill credit. */
  lastHitBy: string | null;
  lastHit: LastHit | null;
  /** Network grenade replication. */
  onThrow: ((d: NadeThrow) => void) | null;
  weapons: Weapon[];
  /** Active slot. */
  wi: number;
  /** Available with every gun, including during a reload or with no ammo. */
  melee: Melee;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
    this.body = new Body(ctx.level.playerStart, 0.35, 1.75, 0.55);
    this._eye = new Vector3();
    this._center = new Vector3();
    this._forward = new Vector3(0, 0, -1);
    this._right = new Vector3(1, 0, 0);
    this._idle = false;
    this.name = '';
    this.team = 0;
    this.maxHp = this.hp = 120;
    this.regenDelay = 4.5;
    this.regenRate = 11;
    this.sinceDamage = 10;
    this.alive = true;
    this.yaw = this.pitch = this.roll = 0;
    this.hurtFx = this.flashFx = this.shieldT = this.deathTime = 0;
    this.blockCd = this.blockHeld = 0;
    this.breath = 1;
    this.grenades = 3;
    this.gravityScale = 1;
    this.dashLock = this.firing = false;
    this.lastHitBy = this.lastHit = this.onThrow = null;
    this.wi = 0;
    initMovement(this);
    initCamera(this);
    initGrapple(this);
    initGrenades(this);
    this.weapons = makeLoadout(ctx, this);
    this.melee = new Melee(ctx, this);
    this.melee.equip();
    this.melee.root.visible = false;
    this.switchTo(0, true);
  }

  get isLocal(): true { return true; }
  get maxGrenades(): number { return MAX_GRENADES; }
  get weapon(): Weapon {
    const active = this.weapons[this.wi];
    // `switchTo` is the only writer of `wi` and validates it against `weapons`.
    if (!active) throw new RangeError(`Player: no weapon in slot ${this.wi}`);
    return active;
  }
  get speed(): number { return this.body.vel.length(); }
  /** A live vector, rewritten every read: copy it before storing. */
  get eye(): Vector3 {
    if (!this._idle) this._eye.set(this.body.pos.x, this.body.pos.y + this.eyeHeight + this.stepOffset + this.landDip.value * 0.07 + this.bobY, this.body.pos.z);
    return this._eye;
  }
  /** A live vector, rewritten every read: copy it before storing. */
  get center(): Vector3 {
    if (!this._idle) this._center.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, this.body.pos.z);
    return this._center;
  }
  /** A live vector, rewritten every read: copy it before storing. */
  get forward(): Vector3 {
    if (!this._idle) {
      const cosPitch = Math.cos(this.pitch);
      this._forward.set(-Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch);
    }
    return this._forward;
  }
  /** A live vector, rewritten every read: copy it before storing. */
  get right(): Vector3 {
    if (!this._idle) this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return this._right;
  }
  get blocking(): boolean { return this.alive && this.melee.blocking; }
  get blockRadius(): number { return this.blocking && this.blockCd <= 0 ? 0.95 : 0; }
  get parryWindow(): boolean { return this.blocking && this.blockHeld < 0.55; }

  reset(pos: Vector3): void {
    if (!validVector(pos)) return;
    this._idle = false;
    this.detachGrapple(false);
    this.clearNades();
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = false;
    this.body.height = 1.75;
    this.hp = this.maxHp;
    this.alive = true;
    this.yaw = this.pitch = this.roll = 0;
    this.breath = 1;
    this.blockHeld = this.blockCd = 0;
    this.headshotT = 0;
    this.headshotRoll.set(0);
    this.recoilPitch.set(0);
    this.recoilYaw.set(0);
    this.hurtFx = this.flashFx = this.deathTime = 0;
    this.crouching = this.sliding = this.dashLock = false;
    this.sinceDamage = 10;
    this.dashCd = 0;
    this.airJumps = 1;
    this.gravityScale = 1;
    this.eyeHeight = 1.6;
    this.stepOffset = 0;
    this.grenades = 3;
    for (const weapon of this.weapons) weapon.resetAmmo();
    this.melee.resetAmmo();
    this.aiming = this.firing = false;
    this.ctx.hud.setAds(false);
    this.ctx.hud.setScope(false);
    this.switchTo(0, true);
    this.ctx.renderer.rig.visible = true;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    this._idle = false;
    this.sinceDamage += dt;
    if (!this.alive) {
      this.deathTime += dt;
      this.eyeHeight = damp(this.eyeHeight, 0.35, 3, dt);
      this.roll = damp(this.roll, 0.9, 3, dt);
      this.pitch = damp(this.pitch, -0.35, 3, dt);
      this.body.vel.x = damp(this.body.vel.x, 0, 4, dt);
      this.body.vel.z = damp(this.body.vel.z, 0, 4, dt);
      this.body.vel.y -= 26 * dt;
      this.ctx.world.moveBody(this.body, dt);
      updateGrenades(this, dt, false);
      updateCamera(this, dt);
      this.weapon.animate(this.weaponState(), dt);
      return;
    }
    this.ctx.renderer.rig.visible = true;
    const { input } = this.ctx;
    const sensitivity = this.aiming ? (this.weapon.scope ? 0.38 : 0.62) : 1;
    this.yaw += input.look.x * sensitivity;
    this.pitch = clamp(this.pitch + input.look.y * sensitivity, -1.5, 1.5);
    if (this.dashLock) {
      this.body.vel.set(0, 0, 0);
      this.body.onGround = false;
      this.coyote = 0.13;
      updateCamera(this, dt);
      this.weapon.animate(this.weaponState(), dt);
      return;
    }
    updateMovement(this, dt);
    updateGrapple(this, dt);
    integrateMovement(this, dt);
    if (this.sinceDamage > this.regenDelay && !this.sprinting && this.grapple.mode === 'idle') this.heal(this.regenRate * dt);
    this.blockHeld = this.blocking ? this.blockHeld + dt : 0;
    updateBreath(this, dt);
    updateBob(this, dt);
    updateCamera(this, dt);
    updateGrappleVisual(this);
    updateGrenades(this, dt, this.alive);
    this._updateWeapons(dt);
  }

  _updateWeapons(dt: number): void {
    const { input, hud } = this.ctx;
    if (this.alive && !this.dashLock) {
      for (const [slot, action] of SLOT_ACTIONS.entries()) if (input.pressed(action)) this.switchTo(slot);
      if (input.pressed('nextWeapon')) this.switchTo((this.wi + 1) % this.weapons.length);
      if (input.pressed('prevWeapon')) this.switchTo((this.wi + this.weapons.length - 1) % this.weapons.length);
    }
    const st = this.weaponState();
    this.melee.animate({ ...st, fire: false, firePressed: false,
      aim: this.alive && !this.dashLock && input.down('melee'),
      meleePressed: this.alive && !this.dashLock && input.pressed('melee'),
    }, dt);
    const melee = this.melee.active;
    this.weapon.animate(melee ? { ...st, fire: false, firePressed: false, aim: false, blockFire: true } : st, dt);
    if (melee) this.weapon.root.visible = false;
    this.aiming = !melee && st.aim;
    this.firing = this.alive && !melee && !this.weapon.reloading && input.down('fire');
    hud.setCrosshairMode(melee ? 'melee' : '');
    hud.setAds(!melee && this.weapon.aimAmt > 0.55);
    hud.setScope(!melee && this.weapon.scope && this.weapon.aimAmt >= 0.8,
      this.weapon.kind === 'rifle' ? 'acog' : 'sniper');
  }

  weaponState(): WeaponState {
    const input = this.ctx.input, neutral = !this.alive || this.dashLock;
    return {
      fire: !neutral && input.down('fire'),
      firePressed: !neutral && input.pressed('fire'),
      aim: !neutral && input.down('aim'),
      reloadPressed: !neutral && input.pressed('reload'),
      meleePressed: !neutral && input.pressed('melee'),
      sprinting: !neutral && this.sprinting,
      grounded: this.body.onGround,
      speed: neutral ? 0 : Math.hypot(this.body.vel.x, this.body.vel.z),
      sliding: this.sliding,
      lookDelta: input.look,
      strafe: this.move.x,
      bobPhase: this.bobPhase,
      bobAmt: this.bobAmt,
      landDip: clamp(-this.landDip.value * 0.08, -0.5, 0.5),
      slideTilt: this.sliding ? 1 : 0,
      blockFire: neutral,
    };
  }

  switchTo(index: number, silent = false): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.weapons.length || (index === this.wi && !silent)) return;
    this.weapon.unequip();
    this.wi = index;
    this.weapon.equip();
    if (!silent) this.ctx.audio.switchWeapon();
    this.ctx.hud.setWeapon(this.weapon.name, this.weapon.hint);
    this.aiming = false;
    this.ctx.hud.setAds(false);
    this.ctx.hud.setScope(false);
    this.ctx.hud.setCrosshairMode(this.melee.active ? 'melee' : '');
  }

  takeDamage(amount: number, from: Vector3 | null = null): void {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.sinceDamage = 0;
    this.hurtFx = Math.min(1, this.hurtFx + amount / 40);
    this.ctx.effects.shake += 0.2 + amount / 80;
    this.ctx.audio.hurt();
    this.ctx.input.rumble(0.8, 0.5, 160);
    if (validVector(from)) {
      direction.copy(from).sub(this.eye);
      this.ctx.hud.damageFrom(Math.atan2(direction.dot(this.right), direction.dot(this.forward)));
    }
    if (this.hp <= 0) this.die();
  }

  heal(amount: number): number {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  knockback(dir: Vector3, amount: number): void {
    if (!validVector(dir) || !Number.isFinite(amount)) return;
    this.body.vel.addScaledVector(dir, amount);
    this.body.vel.y += amount * 0.5;
    this.body.onGround = false;
  }

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.melee.resetAmmo();
    this.aiming = this.firing = false;
    this.headshotT = 0;
    this.headshotRoll.set(0);
    this.ctx.hud.setAds(false);
    this.ctx.hud.setScope(false);
    this.deathTime = 0;
    this.ctx.audio.death();
    this.detachGrapple(false);
    this.ctx.game.onPlayerDeath();
  }

  tryDeflect(projectile: Projectile): false | { perfect: boolean; returned: boolean } {
    const melee = this.melee;
    if (!this.alive || !this.blocking || this.blockCd > 0 || !projectile || !validVector(projectile.vel) || !validVector(projectile.pos)) return false;
    direction.copy(projectile.vel).negate().normalize();
    if (direction.dot(this.forward) < 0.55) return false;
    const perfect = melee.blockT < 0.26;
    const returned = perfect || rand() < 0.35;
    this.blockCd = 0.19;
    melee.onDeflect(perfect);
    if (perfect) this.ctx.audio.perfectParry();
    else this.ctx.audio.parry();
    this.ctx.effects.sparks(projectile.pos, direction, TONE.ACCENT, perfect ? 14 : 8, 10);
    this.ctx.effects.strokeBurst(projectile.pos, TONE.PRIMARY, perfect ? 8 : 5, 4.5, { life: 0.2, size: 0.028 });
    this.ctx.input.rumble(0.4, 0.6, 70);
    this.ctx.game.hitstop(perfect ? 0.07 : 0.025, 0.18);
    this.ctx.effects.shake += 0.06;
    this.flashFx = perfect ? 0.35 : 0.1;
    this.ctx.game.addScore(perfect ? 60 : 15, perfect ? 'PERFECT PARRY' : 'BLOCKED');
    return { perfect, returned };
  }

  tryBlockMelee(enemy: Enemy): boolean {
    if (!this.alive || !this.parryWindow || this.blockCd > 0 || !enemy || !validVector(enemy.center)) return false;
    direction.copy(enemy.center).sub(this.eye).normalize();
    if (direction.dot(this.forward) < 0.35) return false;
    this.melee.onDeflect(true);
    this.ctx.audio.parry();
    this.ctx.game.hitstop(0.06, 0.15);
    point.copy(this.eye).addScaledVector(this.forward, 0.8);
    direction.copy(this.forward).negate();
    this.ctx.effects.sparks(point, direction, TONE.ACCENT, 12, 8);
    this.ctx.game.addScore(40, 'BLOCKED');
    this.ctx.input.rumble(0.6, 0.6, 100);
    return true;
  }

  onHeadshot(info: HitInfo): void {
    if (!this.alive || !info.crit || info.part !== 'head'
      || !['rifle', 'shotgun', 'sniper', 'pistol', 'revolver'].includes(info.source ?? '')) return;
    // One bounded kick per shot, not one per shotgun pellet. No aim correction.
    if (this.headshotT < 0.22) {
      this.headshotSide *= -1;
      this.headshotRoll.vel = this.headshotSide * 0.18;
    }
    this.headshotT = 0.28;
  }

  recoil(pitch: number, yaw: number): void {
    if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return;
    this.pitch = clamp(this.pitch + pitch * 0.55, -1.5, 1.5);
    this.recoilPitch.kick(pitch * 22);
    this.recoilYaw.kick(yaw * 30);
  }

  kickFov(value: number): void { if (Number.isFinite(value)) this.fovKick.kick(value * 30); }

  lunge(speed: number): void {
    if (!Number.isFinite(speed)) return;
    direction.copy(this.forward);
    direction.y = clamp(direction.y, -0.2, 0.5);
    direction.normalize();
    this.body.vel.addScaledVector(direction, speed);
    if (this.body.onGround) {
      this.body.vel.y = Math.max(this.body.vel.y, 2.5);
      this.body.onGround = false;
    }
    this.ctx.audio.dash();
    this.kickFov(3);
  }

  aimDir(spread: number, out = new Vector3()): Vector3 {
    out.copy(this.forward).addScaledVector(this.right, rand(-spread, spread));
    out.y += rand(-spread, spread);
    return out.normalize();
  }

  addAmmoAll(fraction = 0.5): void {
    if (!Number.isFinite(fraction) || fraction <= 0) return;
    for (const weapon of this.weapons) if (isGun(weapon)) weapon.addAmmo(Math.round(GUN_STATS[weapon.kind].maxReserve * fraction));
  }

  idleCam(time: number): void { idleCamera(this, time); }
  detachGrapple(boost: boolean): void { detachGrapple(this, boost); }
  throwGrenade(remote?: NadeThrow): void { throwGrenade(this, remote); }
  clearNades(): void { clearNades(this); }
}

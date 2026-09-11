import { Vector3 } from 'three';
import { Body } from '../physics.js';
import { clamp, damp, rand } from '../util.js';
import { TONE } from '../render/index.js';
import { makeLoadout, GUN_STATS } from '../weapons/index.js';
import { initCamera, updateBob, updateCamera, idleCamera } from './camera.js';
import { initMovement, updateMovement, integrateMovement } from './movement.js';
import { initGrapple, updateGrapple, detachGrapple, updateBreath, updateGrappleVisual } from './grapple.js';
import { initGrenades, updateGrenades, throwGrenade, clearNades } from './grenades.js';

const direction = new Vector3();
const point = new Vector3();
const validVector = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export class Player {
  constructor(ctx) {
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
    this.wi = this.previousWeapon = 0;
    this.quickReturnT = 0;
    this._quickFrame = false;
    initMovement(this);
    initCamera(this);
    initGrapple(this);
    initGrenades(this);
    this.weapons = makeLoadout(ctx, this);
    this.switchTo(0, true);
  }

  get isLocal() { return true; }
  get maxGrenades() { return 5; }
  get weapon() { return this.weapons[this.wi]; }
  get speed() { return this.body.vel.length(); }
  get eye() {
    if (!this._idle) this._eye.set(this.body.pos.x, this.body.pos.y + this.eyeHeight + this.landDip.value * 0.07 + this.bobY, this.body.pos.z);
    return this._eye;
  }
  get center() {
    if (!this._idle) this._center.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, this.body.pos.z);
    return this._center;
  }
  get forward() {
    if (!this._idle) {
      const cosPitch = Math.cos(this.pitch);
      this._forward.set(-Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch);
    }
    return this._forward;
  }
  get right() {
    if (!this._idle) this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return this._right;
  }
  get blocking() { return this.weapon.kind === 'katana' && this.weapon.blocking; }
  get blockRadius() { return this.blocking && this.blockCd <= 0 ? 0.95 : 0; }
  get parryWindow() { return this.blocking && this.blockHeld < 0.55; }

  reset(pos) {
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
    this.blockHeld = 0;
    this.hurtFx = this.flashFx = this.deathTime = 0;
    this.crouching = this.sliding = this.dashLock = false;
    this.sinceDamage = 10;
    this.dashCd = 0;
    this.airJumps = 1;
    this.gravityScale = 1;
    this.eyeHeight = 1.6;
    this.grenades = 3;
    for (const weapon of this.weapons) weapon.resetAmmo();
    this.switchTo(0, true);
    this.ctx.renderer.rig.visible = true;
  }

  update(dt) {
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

  _updateWeapons(dt) {
    const { input, hud } = this.ctx;
    this._quickFrame = false;
    if (this.alive && !this.dashLock) {
      for (let slot = 1; slot <= 5; slot++) if (input.pressed(`slot${slot}`)) this.switchTo(Math.min(slot - 1, 3));
      if (input.pressed('nextWeapon')) this.switchTo((this.wi + 1) % this.weapons.length);
      if (input.pressed('prevWeapon')) this.switchTo((this.wi + this.weapons.length - 1) % this.weapons.length);
      if (input.pressed('melee') && this.weapon.isGun) {
        this.switchTo(3);
        this.quickReturnT = 0.85;
        this._quickFrame = true;
        this.weapon.startSlash(this.weaponState());
      }
      if (this.quickReturnT > 0) {
        const st = this.weaponState();
        if (this.wi === 3 && (st.firePressed || st.aim || st.meleePressed)) this.quickReturnT = 0;
        else {
          this.quickReturnT -= dt;
          if (this.quickReturnT <= 0) this.switchTo(this.previousWeapon);
        }
      }
    }
    this.weapon.animate(this.weaponState(), dt);
    this.firing = this.alive && input.down('fire') && this.weapon.isGun;
    hud.setAds(this.weapon.isGun && this.weapon.aimAmt > 0.55);
    hud.setScope(this.weapon.scope && this.weapon.aimAmt > 0.62);
  }

  weaponState() {
    const input = this.ctx.input, neutral = !this.alive || this.dashLock;
    return {
      fire: !neutral && input.down('fire'),
      firePressed: !neutral && input.pressed('fire'),
      aim: !neutral && input.down('aim'),
      reloadPressed: !neutral && input.pressed('reload'),
      meleePressed: !neutral && !this._quickFrame && this.wi === 3 && input.pressed('melee'),
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
      blockFire: !this.alive,
    };
  }

  switchTo(index, silent = false) {
    if (!Number.isInteger(index) || index < 0 || index >= this.weapons.length || (index === this.wi && !silent)) return;
    if (this.weapon.kind !== 'katana') this.previousWeapon = this.wi;
    this.weapon.unequip();
    this.wi = index;
    this.weapon.equip();
    if (!silent) this.ctx.audio.switchWeapon();
    this.ctx.hud.setWeapon(this.weapon.name, this.weapon.hint);
    this.ctx.hud.setCrosshairMode(this.weapon.kind === 'katana' ? 'katana' : '');
  }

  takeDamage(amount, from = null) {
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

  heal(amount) {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  knockback(dir, amount) {
    if (!validVector(dir) || !Number.isFinite(amount)) return;
    this.body.vel.addScaledVector(dir, amount);
    this.body.vel.y += amount * 0.5;
    this.body.onGround = false;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.deathTime = 0;
    this.ctx.audio.death();
    this.detachGrapple(false);
    this.ctx.game.onPlayerDeath();
  }

  tryDeflect(projectile) {
    if (!this.alive || !this.blocking || this.blockCd > 0 || !projectile || !validVector(projectile.vel) || !validVector(projectile.pos)) return false;
    direction.copy(projectile.vel).negate().normalize();
    if (direction.dot(this.forward) < 0.55) return false;
    const perfect = this.weapon.blockT < 0.26;
    const returned = perfect || rand() < 0.35;
    this.blockCd = 0.19;
    this.weapon.onDeflect(perfect);
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

  tryBlockMelee(enemy) {
    if (!this.alive || !this.parryWindow || this.blockCd > 0 || !enemy || !validVector(enemy.center)) return false;
    direction.copy(enemy.center).sub(this.eye).normalize();
    if (direction.dot(this.forward) < 0.35) return false;
    this.weapon.onDeflect(true);
    this.ctx.audio.parry();
    this.ctx.game.hitstop(0.06, 0.15);
    point.copy(this.eye).addScaledVector(this.forward, 0.8);
    direction.copy(this.forward).negate();
    this.ctx.effects.sparks(point, direction, TONE.ACCENT, 12, 8);
    this.ctx.game.addScore(40, 'BLOCKED');
    this.ctx.input.rumble(0.6, 0.6, 100);
    return true;
  }

  recoil(pitch, yaw) {
    if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return;
    this.pitch = clamp(this.pitch + pitch * 0.55, -1.5, 1.5);
    this.recoilPitch.kick(pitch * 22);
    this.recoilYaw.kick(yaw * 30);
  }

  kickFov(value) { if (Number.isFinite(value)) this.fovKick.kick(value * 30); }

  lunge(speed) {
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

  aimDir(spread, out = new Vector3()) {
    out.copy(this.forward).addScaledVector(this.right, rand(-spread, spread));
    out.y += rand(-spread, spread);
    return out.normalize();
  }

  addAmmoAll(fraction = 0.5) {
    if (!Number.isFinite(fraction) || fraction <= 0) return;
    for (const weapon of this.weapons) if (weapon.isGun) weapon.addAmmo(Math.round(GUN_STATS[weapon.kind].maxReserve * fraction));
  }

  idleCam(time) { idleCamera(this, time); }
  detachGrapple(boost) { detachGrapple(this, boost); }
  throwGrenade(remote) { throwGrenade(this, remote); }
  clearNades() { clearNades(this); }
}

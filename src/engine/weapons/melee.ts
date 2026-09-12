import { Vector3 } from 'three';
import { clamp, damp, easeInOut, rand } from '../util';
import { TONE } from '../render/index';
import { ViewModel } from './gun';
import { makeMeleeModel, smearThreshold } from './models';
import type { Ctx, Enemy, HitInfo, Player, WeaponState } from '../types';
import type { Weapon } from './index';

const GUARD_POS = new Vector3(0.21, -0.31, -0.36);
const GUARD_ROT = new Vector3(1.40, 0.30, 1.24);


/** The blade state `resetAmmo` owns, which the constructor calls. */
export interface Melee {
  /** Guard is up: aim held, not slashing, off cooldown. */
  blocking: boolean;
  /** Seconds the current guard has been up. Under 0.26 a deflect is perfect. */
  blockT: number;
  cooldown: number;
  /** Blade blood, 0..1. Decays; +0.42 per katana kill. */
  blood: number;
  combo: number;
  /** Seconds left of the current slash. */
  _slashT: number;
  _comboT: number;
  _blockAmt: number;
  _parrySwing: number;
  _deflectKick: number;
  /** Side of the next parry flick, +1 or -1. */
  _parryDir: number;
  /** The hit test of this slash has run. */
  _hitDone: boolean;
}

export class Melee extends ViewModel implements Weapon {
  readonly kind: 'melee';
  readonly name: string;
  readonly hint: string;
  readonly isGun: false;
  readonly scope: false;
  readonly adsFov: number;
  mag: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  _arcA: Vector3;
  _arcB: Vector3;
  _hitDir: Vector3;

  constructor(ctx: Ctx, player: Player) {
    super(ctx, player, makeMeleeModel(), [0.23, -0.20, -0.32], [0.35, 0.10, -0.45]);
    this.kind = 'melee';
    this.name = 'KNIFE';
    this.hint = 'tap melee to strike · hold melee to guard';
    this.isGun = false;
    this.scope = false;
    this.adsFov = 60;
    this.mag = this.reserve = this.magSize = Infinity;
    this.reloading = false;
    this._arcA = new Vector3();
    this._arcB = new Vector3();
    this._hitDir = new Vector3();
    this.resetAmmo();
  }

  get active() { return this._slashT > 0 || this.blocking || this._blockAmt > 0.1; }
  get spreadPx() { return 4; }
  addAmmo() {}

  resetAmmo() {
    this.blocking = false;
    this.blockT = this.cooldown = this.blood = this.combo = 0;
    this._slashT = this._comboT = this._blockAmt = this._parrySwing = this._deflectKick = 0;
    this._parryDir = 1;
    this._hitDone = false;
    this._resetPose();
    this.root.visible = false;
    for (const smear of this._model.bloodSmears) smear.visible = false;
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

  startSlash(st: WeaponState) {
    if (this._disposed || st.blockFire || this.cooldown > 0 || this._slashT > 0) return;
    this._slashT = 0.27;
    this.blocking = false;
    this.root.visible = true;
    this._hitDone = false;
    this.combo++;
    this._comboT = 0.9;
    this.cooldown = 0.33;
    this._ctx.audio.katanaSwing();
    this._player.kickFov(2);
    if (st.sprinting || !st.grounded) this._player.lunge(3.5);
    const side = this.combo % 2 ? 1 : -1;
    for (let i = 0; i < 9; i++) {
      const a = (-1.1 + 2.2 * i / 8) * side, b = a + 0.12 * side;
      this._arcPoint(a, side, this._arcA);
      this._arcPoint(b, side, this._arcB);
      this._ctx.effects.tracer(this._arcA, this._arcB, TONE.PRIMARY, 0.03 - 0.002 * i, 0.12 + 0.01 * i);
    }
  }

  _arcPoint(angle: number, side: number, out: Vector3) {
    out.copy(this._player.eye).addScaledVector(this._player.forward, 1.3)
      .addScaledVector(this._player.right, Math.cos(angle) * 0.9 * side);
    out.y += Math.sin(angle) * 0.55 - 0.1;
  }

  animate(st: WeaponState, dt: number) {
    if (this._disposed || !this._equipped) return;
    if (st.blockFire) {
      this.resetAmmo();
      return;
    }
    this._pose({ ...st, aim: false }, dt);
    this.cooldown -= dt;
    this._comboT -= dt;
    if (this._comboT <= 0) this.combo = 0;
    this._deflectKick = Math.max(0, this._deflectKick - 6 * dt);
    this._parrySwing = Math.max(0, this._parrySwing - 4.5 * dt);
    this.blood = Math.max(0, this.blood - 0.05 * dt);
    for (const smear of this._model.bloodSmears) {
      const threshold = smearThreshold(smear);
      smear.visible = this.blood > threshold;
      if (smear.visible) {
        const f = clamp((this.blood - threshold) / 0.28, 0.2, 1);
        smear.scale.set(1, 0.35 + 0.65 * f, 0.4 + 0.6 * f);
      }
    }
    const wantBlock = st.aim && !st.meleePressed && this._slashT <= 0 && this.cooldown <= 0;
    if (wantBlock && !this.blocking) this.blockT = 0;
    this.blocking = wantBlock;
    if (this.blocking) this.blockT += dt;
    this._blockAmt = damp(this._blockAmt, this.blocking ? 1 : 0, 16, dt);
    if (this._blockAmt > 0.001) {
      const b = this._blockAmt, r = this.root.rotation;
      this.root.position.lerp(GUARD_POS, b);
      r.x += (GUARD_ROT.x - r.x) * b;
      r.y += (GUARD_ROT.y - r.y) * b;
      r.z += (GUARD_ROT.z - r.z) * b;
    }
    if (this._parrySwing > 0) {
      const f = Math.sin(Math.min(1, this._parrySwing) * Math.PI) * this._parryDir;
      this.root.rotation.z += f * 0.42;
      this.root.rotation.y += f * 0.16;
      this.root.position.x += f * 0.035;
    }
    if (this._slashT > 0) {
      this._slashT = Math.max(0, this._slashT - dt);
      const t = 1 - this._slashT / 0.27, e = easeInOut(t), side = this.combo % 2 ? 1 : -1;
      this.root.rotation.z += side * (1.3 - 2.7 * e);
      this.root.rotation.x += 0.7 - 1.5 * e;
      this.root.rotation.y += side * (-0.35 + 0.8 * e);
      this.root.position.x += side * (0.2 - 0.45 * e);
      this.root.position.y += 0.14 - 0.24 * e;
      this.root.position.z -= 0.12 * Math.sin(t * Math.PI);
      if (t > 0.32 && !this._hitDone) {
        this._hitDone = true;
        this._hit(side);
      }
    }
    if (st.meleePressed) this.startSlash(st);
    this.root.visible = this._equipped && this.active;
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
    for (const { enemy } of enemies?.inArc(p.eye, p.forward, 2.1, Math.cos(0.8)) ?? []) {
      if (!this._ctx.world.lineOfSight(p.eye, enemy.center)) continue;
      const point = enemy.center.clone();
      point.y += rand(-0.2, 0.4);
      enemies?.damage(enemy, 75, { point, dir: d, part: 'torso', source: 'melee', crit: false, slashDir: side });
      hit = true;
    }
    for (const remote of game.playersInArc(p.eye, p.forward, 2.1, Math.cos(0.8))) {
      game.hitPlayer(remote, 55, { point: remote.center, dir: d, part: 'torso', source: 'melee', crit: false });
      hit = true;
    }
    if (game.cutRopes(p.eye, p.forward, 2.4)) hit = true;
    for (const prop of game.breakablesInArc(p.eye, p.forward, 2.2, Math.cos(0.8))) {
      game.breakHit(prop, 75, prop.pos, d);
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

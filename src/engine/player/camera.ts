import { Vector3 } from 'three';
import { clamp, damp, lerp, Spring } from '../util';
import { VIEW_MODEL_FOV } from '../render/index';
import { EYE_HEIGHT, CROUCH_EYE } from './movement';
import type { Player } from './index';

/** The camera fields `initCamera` installs on the player. */
export interface CameraState {
  recoilPitch: Spring;
  recoilYaw: Spring;
  /** Brief shooter-side feedback and follow-up recoil recovery after a headshot. */
  headshotRoll: Spring;
  headshotT: number;
  headshotSide: number;
  fovKick: Spring;
  /** Landing dip; the weapon reads it through `WeaponState.landDip`. */
  landDip: Spring;
  /** Eye offset above the feet, EYE_HEIGHT standing and CROUCH_EYE crouched. */
  eyeHeight: number;
  /** Stair smoothing: the body pops up a step, the eye eases up after it. */
  stepOffset: number;
  bobPhase: number;
  bobAmt: number;
  stepDistance: number;
  bobX: number;
  bobY: number;
  /** Screen-shake noise clock, in noise cells. */
  shakeT: number;
  /** Directional jolt away from a damage source, in radians; decays per impulse. */
  shakePitch: Spring;
  shakeYaw: Spring;
}

/** Hip-fire vertical FOV. ADS look sensitivity scales against it. */
export const HIP_FOV = 82;

const target = new Vector3(0, 10, 0);
const away = new Vector3();

/** Noise cells per second: fast enough to read as a jolt, slow enough to stay smooth. */
const SHAKE_HZ = 16;
/**
 * Scales the noise to the RMS of the white noise it replaced, `rand(-0.5, 0.5)`
 * (0.2887). Smoothstep value noise over uniform [-1, 1] lattice values has an
 * RMS of about 0.4976, so the overall strength is unchanged.
 */
const SHAKE_MATCH = 0.58;
/** Jolt velocity per unit of directional push, in radians per second. */
const SHAKE_KICK = 2.2;

const lattice = (i: number, seed: number): number => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/** Smooth 1-D value noise in [-1, 1]; each seed is an independent stream. */
export function shakeNoise(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i;
  return lerp(lattice(i, seed), lattice(i + 1, seed), f * f * (3 - 2 * f));
}

export function initCamera(p: Player): void {
  p.recoilPitch = new Spring(190, 17);
  p.recoilYaw = new Spring(190, 17);
  p.headshotRoll = new Spring(360, 25);
  p.headshotT = 0;
  p.headshotSide = 1;
  p.fovKick = new Spring(220, 14);
  p.landDip = new Spring(170, 15);
  p.eyeHeight = EYE_HEIGHT;
  p.stepOffset = 0;
  p.bobPhase = p.bobAmt = p.stepDistance = 0;
  p.bobX = p.bobY = 0;
  p.shakeT = 0;
  p.shakePitch = new Spring(300, 22);
  p.shakeYaw = new Spring(300, 22);
  p.ctx.camera.rotation.order = 'YXZ';
}

export function updateBob(p: Player, dt: number): void {
  const speed = Math.hypot(p.body.vel.x, p.body.vel.z);
  const moving = p.body.onGround && speed > 0.6 && !p.sliding;
  p.bobAmt = damp(p.bobAmt, moving ? clamp(speed / 7, 0.3, 1.4) : 0, 8, dt);
  if (moving) {
    p.bobPhase += dt * (7 + speed * 0.5);
    p.stepDistance += speed * dt;
    if (p.stepDistance > (p.sprinting ? 2.5 : 2)) {
      p.stepDistance = 0;
      p.ctx.audio.footstep(clamp(speed / 8, 0.3, 1));
    }
  }
  p.bobY = Math.abs(Math.sin(p.bobPhase)) * 0.03 * p.bobAmt;
  p.bobX = Math.cos(p.bobPhase * 0.5) * 0.018 * p.bobAmt;
}

export function updateCamera(p: Player, dt: number): void {
  const { camera, effects } = p.ctx;
  const settle = p.headshotT > 0 ? Math.exp(-12 * dt) : 1;
  p.recoilPitch.vel *= settle;
  p.recoilYaw.vel *= settle;
  p.recoilPitch.update(dt);
  p.recoilYaw.update(dt);
  p.headshotRoll.update(dt);
  p.headshotT = Math.max(0, p.headshotT - dt);
  p.fovKick.update(dt);
  p.landDip.update(dt);
  p.stepOffset = damp(p.stepOffset, 0, 22, dt);
  if (p.alive) {
    p.eyeHeight = damp(p.eyeHeight, p.crouching ? CROUCH_EYE : EYE_HEIGHT, 14, dt);
    p.roll = damp(p.roll, -p.move.x * 0.022 + (p.sliding ? -0.08 : 0), 9, dt);
  }
  const shake = Math.min(effects.shake, 1.2);
  effects.shake = damp(effects.shake, 0, 7, dt);
  // A jolt from a known source tips the view away from it, then springs back.
  if (effects.shakePush > 0) {
    const push = Math.min(effects.shakePush, 1.2) * SHAKE_KICK;
    away.copy(p.eye).sub(effects.shakeFrom).setY(0);
    if (away.lengthSq() > 1e-6) {
      away.normalize();
      p.shakePitch.kick(-away.dot(p.forward) * push);
      p.shakeYaw.kick(-away.dot(p.right) * push);
    }
    effects.shakePush = 0;
  }
  p.shakePitch.update(dt);
  p.shakeYaw.update(dt);
  p.shakeT += dt * SHAKE_HZ;
  const noise = (seed: number): number => shakeNoise(p.shakeT, seed) * SHAKE_MATCH * shake;
  camera.position.copy(p.eye).addScaledVector(p.right, p.bobX + noise(0) * 0.07);
  camera.position.y += noise(1) * 0.07;
  camera.rotation.set(
    p.pitch + p.recoilPitch.value + p.shakePitch.value + noise(2) * 0.035,
    p.yaw + p.recoilYaw.value + p.shakeYaw.value + noise(3) * 0.035,
    p.roll + p.headshotRoll.value + Math.sin(p.bobPhase * 0.5) * 0.004 * p.bobAmt,
    'YXZ',
  );
  const targetFov = p.aiming ? p.weapon.adsFov
    : HIP_FOV + clamp((p.speed - 7) / 16, 0, 1) * 8 + (p.sprinting ? 3 : 0)
      + (p.sliding ? 4 : 0) + (p.grapple.mode === 'on' ? 3 : 0) + p.fovKick.value;
  const fov = damp(camera.fov, targetFov, p.aiming || p.melee.active ? 16 : 8, dt);
  if (Math.abs(fov - camera.fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  // The gun keeps a fixed FOV at the hip and joins the world FOV as it comes up
  // to the eye, so sights and scopes line up exactly as before.
  p.ctx.renderer.setViewFov?.(lerp(VIEW_MODEL_FOV, camera.fov, clamp(p.weapon.aimAmt, 0, 1)));
  p.hurtFx = damp(p.hurtFx, 0, 3, dt);
  p.flashFx = damp(p.flashFx, 0, 10, dt);
  camera.updateMatrixWorld();
}

export function idleCamera(p: Player, time: number): void {
  const { camera, renderer } = p.ctx;
  p._idle = true;
  camera.position.set(Math.sin(time * 0.08) * 70, 30 + Math.sin(time * 0.23) * 4, Math.cos(time * 0.08) * 70);
  camera.lookAt(target);
  camera.fov = 70;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  renderer.rig.visible = false;
  p._eye.copy(camera.position);
  p._center.copy(camera.position);
  camera.getWorldDirection(p._forward);
  p._right.set(p._forward.z, 0, -p._forward.x).normalize();
}

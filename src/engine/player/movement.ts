import { Vector3 } from 'three';
import { clamp } from '../util';
import { TONE } from '../render/index';
import type { Player } from './index';

/** The movement fields `initMovement` installs on the player. */
export interface MovementState {
  /** Stick/keys this frame, -1..1 on each axis. */
  move: { x: number; y: number };
  /** Yaw only, ignoring pitch. A live vector. */
  flatForward: Vector3;
  /** Unit wish direction in world space. A live vector. */
  wish: Vector3;
  /** Normal of the wall last touched in the air. */
  wallNormal: Vector3;
  sprinting: boolean;
  /** Held on a keyboard, toggled on a gamepad. */
  sprintToggle: boolean;
  crouching: boolean;
  sliding: boolean;
  aiming: boolean;
  slideTime: number;
  coyote: number;
  jumpBuffer: number;
  wallJumpCd: number;
  mantleCd: number;
  dashCd: number;
  landGrace: number;
  airTime: number;
  /** Seconds since the last wall touch. Starts "long ago". */
  wallTouch: number;
  airJumps: number;
  wasGround: boolean;
}

const point = new Vector3();
const probe = new Vector3();
const lower = new Vector3();
const upper = new Vector3();
const down = new Vector3(0, -1, 0);

export function initMovement(p: Player): void {
  p.move = { x: 0, y: 0 };
  p.flatForward = new Vector3(0, 0, -1);
  p.wish = new Vector3();
  p.wallNormal = new Vector3();
  p.sprinting = p.sprintToggle = p.crouching = p.sliding = p.aiming = false;
  p.slideTime = p.coyote = p.jumpBuffer = p.wallJumpCd = p.mantleCd = p.dashCd = p.landGrace = p.airTime = 0;
  p.wallTouch = 9;
  p.airJumps = 1;
  p.wasGround = true;
}

export function updateMovement(p: Player, dt: number): void {
  const { input, world, audio, effects } = p.ctx;
  const b = p.body, v = b.vel;
  p.move.x = input.move.x;
  p.move.y = input.move.y;
  p.flatForward.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  p.wish.copy(p.flatForward).multiplyScalar(p.move.y).addScaledVector(p.right, p.move.x);
  const wishLen = Math.min(1, p.wish.length());
  if (wishLen > 0.0001) p.wish.normalize();
  if (input.usingGamepad) {
    if (input.pressed('sprint')) p.sprintToggle = !p.sprintToggle;
    if (p.move.y < 0.1) p.sprintToggle = false;
  } else p.sprintToggle = input.down('sprint');
  p.aiming = input.down('aim') && p.weapon.isGun;
  p.sprinting = p.sprintToggle && p.move.y > 0.1 && !p.crouching && !p.aiming;
  let speed = Math.hypot(v.x, v.z);
  if (input.pressed('crouch') && b.onGround && speed > 6.3 && !p.sliding) {
    const boost = clamp(12.8 - speed, 0, 4.5);
    v.x *= (speed + boost) / speed;
    v.z *= (speed + boost) / speed;
    speed += boost;
    p.sliding = true;
    p.slideTime = 0;
    audio.slide();
    p.kickFov(2.5);
    p.landDip.kick(-2.5);
  }
  if (p.sliding) {
    p.slideTime += dt;
    if (!input.down('crouch') || speed < 3.5 || (!b.onGround && p.airTime > 0.35)) p.sliding = false;
  }
  let crouch = (input.down('crouch') && b.onGround) || p.sliding;
  if (!crouch && p.crouching) {
    b.height = 1.75;
    if (world.overlapsBody(b)) crouch = true;
  }
  p.crouching = crouch;
  b.height = crouch ? 1.05 : 1.75;
  p.landGrace -= dt;
  p.dashCd -= dt;
  p.blockCd -= dt;
  if (b.onGround) {
    p.coyote = 0.13;
    p.airTime = 0;
    p.airJumps = 1;
    if (p.sliding) {
      const nextSpeed = Math.max(0, speed - 6.5 * dt);
      const ratio = speed > 0 ? nextSpeed / speed : 0;
      v.x *= ratio;
      v.z *= ratio;
      v.x += p.wish.x * wishLen * 6 * dt;
      v.z += p.wish.z * wishLen * 6 * dt;
      const steeredSpeed = Math.hypot(v.x, v.z);
      if (steeredSpeed > nextSpeed) {
        v.x *= nextSpeed / steeredSpeed;
        v.z *= nextSpeed / steeredSpeed;
      }
    } else {
      const friction = Math.max(0, 1 - (p.landGrace > 0 ? 2 : 8) * dt);
      v.x *= friction;
      v.z *= friction;
      const maxSpeed = p.crouching ? 3.6 : p.sprinting ? 10.6 : 6.6;
      accelerate(v, p.wish, wishLen, maxSpeed, 140 * dt);
    }
  } else {
    p.coyote -= dt;
    p.airTime += dt;
    accelerate(v, p.wish, wishLen, 7.5, 36 * dt);
  }
  p.jumpBuffer = input.pressed('jump') ? 0.15 : p.jumpBuffer - dt;
  p.wallJumpCd -= dt;
  p.mantleCd -= dt;
  if (b.hitWall && !b.onGround) {
    p.wallTouch = 0;
    p.wallNormal.copy(b.wallNormal);
  } else p.wallTouch += dt;
  if (p.jumpBuffer > 0) {
    if (p.grapple.mode === 'on') {
      p.jumpBuffer = 0;
      p.detachGrapple(true);
    } else if (b.onGround || p.coyote > 0) {
      p.jumpBuffer = p.coyote = 0;
      v.y = 9.6;
      b.onGround = false;
      p.airJumps = 1;
      if (p.sliding) {
        v.x *= 1.06;
        v.z *= 1.06;
        p.sliding = false;
      }
      audio.jump();
      p.landDip.kick(-1.2);
    } else if (p.wallTouch < 0.12 && p.wallJumpCd <= 0 && v.y < 7) {
      p.jumpBuffer = 0;
      p.wallJumpCd = 0.35;
      v.x = p.wallNormal.x * 7.5 + v.x * 0.35 + p.flatForward.x * 2.5;
      v.z = p.wallNormal.z * 7.5 + v.z * 0.35 + p.flatForward.z * 2.5;
      v.y = 9.2;
      p.airJumps = 1;
      audio.wallJump();
      p.roll += p.wallNormal.dot(p.right) > 0 ? -0.1 : 0.1;
      p.kickFov(2);
      p.landDip.kick(-1.5);
    } else if (p.airJumps > 0) {
      p.jumpBuffer = 0;
      p.airJumps--;
      v.y = 9.6 * 0.92;
      accelerate(v, p.wish, wishLen, 7.5, Infinity);
      audio.jump();
      p.kickFov(1.6);
      p.landDip.kick(-1.4);
      point.copy(p.center).y -= 0.7;
      effects.strokeBurst(point, TONE.PRIMARY, 9, 4.5, { life: 0.28, size: 0.028, gravity: -2 });
    }
  }
  if ((input.pressed('dash') || input.pressed('crouch')) && !b.onGround && p.dashCd <= 0 && p.grapple.mode !== 'on') {
    const dir = wishLen > 0 ? p.wish : p.flatForward;
    p.dashCd = 1.3;
    const cur = v.x * dir.x + v.z * dir.z;
    const add = Math.max(cur + 6, 14) - cur;
    v.x += dir.x * add;
    v.z += dir.z * add;
    v.y = Math.max(v.y, 2);
    audio.dash();
    p.kickFov(4);
    input.rumble(0.3, 0.6, 70);
    p.roll += dir.dot(p.right) * 0.08;
    point.copy(p.center).addScaledVector(dir, -0.6);
    effects.strokeBurst(point, TONE.PRIMARY, 10, 5, { life: 0.25, size: 0.03 });
  }
  v.y -= 26 * p.gravityScale * (p.grapple.mode === 'on' ? 0.88 : 1) * dt;
}

function accelerate(velocity: Vector3, wish: Vector3, amount: number, cap: number, acceleration: number): void {
  if (amount <= 0) return;
  const current = velocity.x * wish.x + velocity.z * wish.z;
  const add = Math.min(cap * amount - current, acceleration);
  if (add > 0) {
    velocity.x += wish.x * add;
    velocity.z += wish.z * add;
  }
}

export function integrateMovement(p: Player, dt: number): void {
  const b = p.body, { world, audio, effects, input, level, hud } = p.ctx;
  if (!b.onGround && p.mantleCd <= 0 && p.move.y > 0.3 && b.vel.y < 8 && p.grapple.mode !== 'on') {
    point.copy(b.pos).y += 1;
    if (world.raycast(point, p.flatForward, 0.95)) {
      probe.copy(b.pos).addScaledVector(p.flatForward, 0.95);
      probe.y += 2.75;
      const top = world.raycast(probe, down, 2.25);
      if (top && top.normal.y >= 0.5) {
        const dy = top.point.y - b.pos.y;
        lower.set(probe.x - b.halfW, top.point.y + 0.08, probe.z - b.halfW);
        upper.set(probe.x + b.halfW, top.point.y + 1.05, probe.z + b.halfW);
        if (dy >= 0.5 && dy <= 2.4 && !world.overlapsAABB(lower, upper)) {
          b.vel.set(p.flatForward.x * 3.2, Math.min(11, Math.sqrt(52 * (dy + 0.45))), p.flatForward.z * 3.2);
          p.mantleCd = 0.7;
          audio.mantle();
          p.landDip.kick(-2.5);
          p.kickFov(1.5);
        }
      }
    }
  }
  b.noSnap = p.grapple.mode === 'on' || b.vel.y > 0.5;
  if (b.vel.lengthSq() > 48 * 48) b.vel.setLength(48);
  const groundY = b.pos.y, wasGround = b.onGround;
  world.moveBody(b, dt);
  // A ground-to-ground height change is a stair step: hide the pop, the camera eases it out.
  const stepped = b.pos.y - groundY;
  if (wasGround && b.onGround && Math.abs(stepped) > 0.01 && Math.abs(stepped) <= b.stepHeight + 0.01) {
    p.stepOffset = clamp(p.stepOffset - stepped, -b.stepHeight, b.stepHeight);
  }
  if (b.pos.y < -12 || Math.abs(b.pos.x) > 95 || Math.abs(b.pos.z) > 95) {
    p.detachGrapple(false);
    b.pos.copy(level.playerStart);
    b.vel.set(0, 0, 0);
    p.takeDamage(20);
    hud.message('OUT OF BOUNDS', 'respawned at spawn', 1.8);
  }
  if (b.onGround && !p.wasGround) {
    const impact = clamp(-b.landVel / 14, 0, 1.5);
    p.landDip.kick(-(impact * 6 + 0.5));
    audio.land(impact);
    if (impact > 0.8) {
      effects.shake += impact * 0.15;
      input.rumble(impact * 0.4, 0.2, 80);
    }
    if (Math.hypot(b.vel.x, b.vel.z) > 9) p.landGrace = 0.4;
  }
  p.wasGround = b.onGround;
}

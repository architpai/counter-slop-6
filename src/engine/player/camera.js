import { Vector3 } from 'three';
import { clamp, damp, rand, Spring } from '../util';

const target = new Vector3(0, 10, 0);

export function initCamera(p) {
  p.recoilPitch = new Spring(190, 17);
  p.recoilYaw = new Spring(190, 17);
  p.fovKick = new Spring(220, 14);
  p.landDip = new Spring(170, 15);
  p.eyeHeight = 1.6;
  p.bobPhase = p.bobAmt = p.stepDistance = 0;
  p.bobX = p.bobY = 0;
  p.ctx.camera.rotation.order = 'YXZ';
}

export function updateBob(p, dt) {
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

export function updateCamera(p, dt) {
  const { camera, effects } = p.ctx;
  p.recoilPitch.update(dt);
  p.recoilYaw.update(dt);
  p.fovKick.update(dt);
  p.landDip.update(dt);
  if (p.alive) {
    p.eyeHeight = damp(p.eyeHeight, p.crouching ? 0.88 : 1.6, 14, dt);
    p.roll = damp(p.roll, -p.move.x * 0.022 + (p.sliding ? -0.08 : 0), 9, dt);
  }
  const shake = Math.min(effects.shake, 1.2);
  effects.shake = damp(effects.shake, 0, 7, dt);
  camera.position.copy(p.eye).addScaledVector(p.right, p.bobX + rand(-0.5, 0.5) * shake * 0.07);
  camera.position.y += rand(-0.5, 0.5) * shake * 0.07;
  camera.rotation.set(
    p.pitch + p.recoilPitch.value + rand(-0.5, 0.5) * shake * 0.035,
    p.yaw + p.recoilYaw.value + rand(-0.5, 0.5) * shake * 0.035,
    p.roll + Math.sin(p.bobPhase * 0.5) * 0.004 * p.bobAmt,
    'YXZ',
  );
  const targetFov = p.aiming ? p.weapon.adsFov
    : 82 + clamp((p.speed - 7) / 16, 0, 1) * 8 + (p.sprinting ? 3 : 0)
      + (p.sliding ? 4 : 0) + (p.grapple.mode === 'on' ? 3 : 0) + p.fovKick.value;
  const fov = damp(camera.fov, targetFov, p.aiming ? 16 : 8, dt);
  if (Math.abs(fov - camera.fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  p.hurtFx = damp(p.hurtFx, 0, 3, dt);
  p.flashFx = damp(p.flashFx, 0, 10, dt);
  camera.updateMatrixWorld();
}

export function idleCamera(p, time) {
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

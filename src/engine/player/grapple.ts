import { Group, Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { alignSegment, clamp } from '../util';
import { cylGeo, torusGeo, surfMat, unlitMat, TONE, TONE_HEX } from '../render/index';
import type { BoxFilter, Ctx, Enemy, GrappleMover } from '../types';
import type { Player } from './index';

/** Idle, hook in flight, or attached and swinging. */
export type GrappleMode = 'idle' | 'fly' | 'on';

/** `p.grapple`. The three fields in `ARCHITECTURE.md` §6.10 plus its own bookkeeping. */
export interface Grapple {
  mode: GrappleMode;
  /** Where the rope currently ends: lerped while flying, the anchor once attached. */
  hook: Vector3;
  /** What the rope is tied to. Follows a mover. */
  anchor: Vector3;
  /** Hand position when the hook was fired. */
  origin: Vector3;
  /** Rope start, recomputed every frame. */
  hand: Vector3;
  rope: Mesh;
  marker: Group;
  enemy: Enemy | null;
  mover: GrappleMover | null;
  flyTime: number;
  flyDuration: number;
  ropeLength: number;
  cooldown: number;
  /** Seconds of blocked line of sight; detaches past 0.3. */
  blocked: number;
  checkTime: number;
  swingTime: number;
  reticleTime: number;
}

/** What a grapple search found. Reused, never stored. */
interface GrappleTarget {
  point: Vector3;
  enemy: Enemy | null;
  mover: GrappleMover | null;
}

/** The grapple fields `initGrapple` installs on the player. */
export interface GrappleState {
  grapple: Grapple;
  _grappleTarget: GrappleTarget;
}

/** The slice of the enemy manager the grapple uses. */
interface EnemiesLike {
  raycast(origin: Vector3, dir: Vector3, max: number): { enemy: Enemy; point: Vector3 } | null;
  list: Enemy[];
  yank(enemy: Enemy, target: Vector3): void;
}

const isEnemies = (v: unknown): v is EnemiesLike =>
  typeof v === 'object' && v !== null && 'raycast' in v && 'list' in v && 'yank' in v;

// TODO(phase5): `ctx.enemies` is `unknown` until `enemies/` is ported, so narrow it here.
const enemyManager = (ctx: Ctx): EnemiesLike | null => (isEnemies(ctx.enemies) ? ctx.enemies : null);

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
const isMesh = (node: Object3D): node is Mesh => 'isMesh' in node && node.isMesh === true;

const relative = new Vector3();
const direction = new Vector3();
const saved = new Vector3();
const noGrapple: BoxFilter = box => !!box.data.noGrapple;

export function initGrapple(p: Player): void {
  const rope = new Mesh(cylGeo(1, 1, 6), unlitMat(TONE_HEX[TONE.PRIMARY]));
  const marker = new Group();
  const ring = new Mesh(torusGeo(0.11, 0.018, 6, 12), surfMat('accent'));
  ring.rotation.x = Math.PI / 2;
  marker.add(ring, new Mesh(cylGeo(0.014, 0.2, 6), surfMat('metal')));
  marker.traverse(obj => { if (isMesh(obj)) obj.castShadow = true; });
  rope.visible = marker.visible = false;
  p.ctx.scene.add(rope, marker);
  p.grapple = {
    mode: 'idle', hook: new Vector3(), anchor: new Vector3(), origin: new Vector3(), hand: new Vector3(),
    rope, marker, enemy: null, mover: null, flyTime: 0, flyDuration: 0, ropeLength: 0,
    cooldown: 0, blocked: 0, checkTime: 0, swingTime: 0, reticleTime: 0,
  };
  p._grappleTarget = { point: new Vector3(), enemy: null, mover: null };
}

function target(p: Player): GrappleTarget | null {
  const { world, level } = p.ctx;
  const enemies = enemyManager(p.ctx);
  const result = p._grappleTarget;
  result.enemy = result.mover = null;
  const wall = world.raycast(p.eye, p.forward, 75, noGrapple);
  const wallDist = wall ? wall.dist : 75;
  const exact = enemies?.raycast(p.eye, p.forward, Math.min(50, wallDist + 0.5));
  if (exact) {
    result.point.copy(exact.point);
    result.enemy = exact.enemy;
    return result;
  }
  let bestLateral = Infinity;
  for (const mover of level.movers) {
    relative.copy(mover.mesh.position).sub(p.eye);
    const t = relative.dot(p.forward);
    if (t < 2 || t > Math.min(75, wallDist + 1)) continue;
    const lateral = Math.sqrt(Math.max(0, relative.lengthSq() - t * t));
    if (lateral < mover.radius + 0.3 + t * 0.012 && lateral < bestLateral) {
      bestLateral = lateral;
      result.mover = mover;
      result.point.copy(mover.mesh.position);
    }
  }
  if (result.mover) return result;
  bestLateral = Infinity;
  for (const enemy of enemies?.list ?? []) {
    if (!enemy.alive || enemy.state === 'spawn') continue;
    relative.copy(enemy.center).sub(p.eye);
    const t = relative.dot(p.forward);
    if (t < 1.5 || t > Math.min(45, wallDist + 1.5)) continue;
    const lateral = Math.sqrt(Math.max(0, relative.lengthSq() - t * t));
    if (lateral <= 1.1 + t * 0.06 && lateral < bestLateral && world.lineOfSight(p.eye, enemy.center)) {
      bestLateral = lateral;
      result.enemy = enemy;
      result.point.copy(enemy.center);
    }
  }
  if (result.enemy) return result;
  bestLateral = Infinity;
  for (const ring of level.rings) {
    relative.copy(ring).sub(p.eye);
    const t = relative.dot(p.forward);
    if (t < 2 || t > Math.min(75, wallDist + 1.5)) continue;
    const lateral = Math.sqrt(Math.max(0, relative.lengthSq() - t * t));
    if (lateral <= 0.8 + t * 0.02 && lateral < bestLateral) {
      bestLateral = lateral;
      result.point.copy(ring);
    }
  }
  if (bestLateral < Infinity) return result;
  if (wall) {
    result.point.copy(wall.point).addScaledVector(wall.normal, 0.12);
    return result;
  }
  return null;
}

function hand(p: Player): Vector3 {
  const handPos = p.grapple.hand;
  handPos.copy(p.eye).addScaledVector(p.right, -0.55).addScaledVector(p.forward, 0.9);
  handPos.y -= 0.42;
  return handPos;
}

export function updateGrapple(p: Player, dt: number): void {
  const g = p.grapple, b = p.body;
  const { input, audio, hud, game, world } = p.ctx;
  const enemies = enemyManager(p.ctx);
  g.cooldown -= dt;
  if (g.mode === 'idle') {
    g.reticleTime -= dt;
    if (g.reticleTime <= 0) {
      g.reticleTime = 0.08;
      hud.setGrappleTarget(target(p) ? 1 : 0);
    }
    if (!input.pressed('grapple') || g.cooldown > 0) return;
    if (p.breath < 0.1) {
      audio.winded();
      hud.tip('grapple needs a breather', 0.9);
      return;
    }
    const found = target(p);
    if (!found) { audio.empty(); return; }
    p.breath -= 0.07;
    g.mode = 'fly';
    g.anchor.copy(found.point);
    g.enemy = found.enemy;
    g.mover = found.mover;
    g.origin.copy(hand(p));
    g.hook.copy(g.origin);
    g.flyTime = 0;
    g.flyDuration = clamp(p.eye.distanceTo(g.anchor) / 110, 0.04, 0.6);
    audio.grappleFire();
    input.rumble(0.15, 0.4, 40);
    p.weapon.kickPos(-0.3, 0.2, 0.5);
    return;
  }
  if (g.mover) g.anchor.copy(g.mover.mesh.position);
  if (g.mode === 'fly') {
    g.flyTime += dt;
    const f = Math.min(1, g.flyTime / g.flyDuration);
    g.hook.lerpVectors(g.origin, g.anchor, f);
    if (f < 1) return;
    if (g.enemy) {
      if (g.enemy.alive) {
        enemies?.yank(g.enemy, p.center);
        game.addScore(30, 'YANKED');
        audio.grappleHit();
        input.rumble(0.5, 0.5, 90);
      }
      detachGrapple(p, false);
      return;
    }
    g.mode = 'on';
    g.ropeLength = Math.max(1.5, p.center.distanceTo(g.anchor) * 0.94);
    g.blocked = g.checkTime = g.swingTime = 0;
    audio.grappleHit();
    audio.reelLoop(true);
    hud.setGrappleTarget(2);
    input.rumble(0.3, 0.6, 60);
    if (b.onGround) {
      b.vel.y = Math.max(b.vel.y, 5);
      b.onGround = false;
    }
    return;
  }
  g.hook.copy(g.anchor);
  g.swingTime += dt;
  direction.copy(g.anchor).sub(p.center);
  const dist = direction.length();
  if (dist > 0) direction.divideScalar(dist);
  const along = b.vel.dot(direction), reeling = input.down('grapple');
  if (reeling) {
    g.ropeLength = Math.max(1.5, g.ropeLength - 14 * dt);
    if (along < 22) b.vel.addScaledVector(direction, 42 * dt);
  } else {
    if (along < 6) b.vel.addScaledVector(direction, 3 * dt);
    if (p.move.y > 0.3 && p.center.y < g.anchor.y - 1) b.vel.addScaledVector(p.flatForward, 10 * dt);
  }
  if (dist > g.ropeLength) {
    if (along < 0) b.vel.addScaledVector(direction, -along);
    saved.copy(b.pos);
    b.pos.addScaledVector(direction, Math.min(dist - g.ropeLength, 0.35) * 0.85);
    if (world.overlapsBody(b)) b.pos.copy(saved);
  }
  if (b.onGround && reeling && direction.y > 0.2) {
    b.vel.y = Math.max(b.vel.y, 4.5);
    b.onGround = false;
  }
  g.checkTime += dt;
  if (g.checkTime >= 0.15) {
    g.checkTime = 0;
    g.blocked = world.lineOfSight(p.eye, g.anchor) ? 0 : g.blocked + 0.15;
  }
  if (input.pressed('grapple') || dist < 1.3 || g.blocked > 0.3 || dist > 90 || (b.onGround && g.swingTime > 0.6 && !reeling)) {
    detachGrapple(p, dist < 1.3);
  }
}

export function detachGrapple(p: Player, boost: boolean): void {
  const g = p.grapple;
  if (g.mode === 'idle') return;
  const attached = g.mode === 'on';
  g.mode = 'idle';
  g.cooldown = 0.12;
  g.enemy = g.mover = null;
  g.rope.visible = g.marker.visible = false;
  p.ctx.audio.reelLoop(false);
  p.ctx.hud.setGrappleTarget(0);
  if (!attached) return;
  if (boost) {
    p.body.vel.y = Math.max(p.body.vel.y, 0) + 8;
    p.body.vel.x *= 1.12;
    p.body.vel.z *= 1.12;
    p.ctx.audio.jump();
    p.kickFov(3);
  } else {
    p.body.vel.y += 2.5;
    p.ctx.audio.grappleRelease();
  }
}

export function updateBreath(p: Player, dt: number): void {
  p.breath = clamp(p.breath + (p.grapple.mode === 'on' ? -0.09 : p.body.onGround ? 0.45 : 0.16) * dt, 0, 1);
  if (p.grapple.mode === 'on' && p.breath <= 0) {
    detachGrapple(p, false);
    p.ctx.hud.tip('out of breath · land to recover', 1.4);
  }
}

export function updateGrappleVisual(p: Player): void {
  const g = p.grapple;
  if (g.mode === 'idle') return;
  alignSegment(g.rope, hand(p), g.hook, 0.008);
  g.marker.visible = true;
  g.marker.position.copy(g.hook);
  g.marker.quaternion.copy(g.rope.quaternion);
}

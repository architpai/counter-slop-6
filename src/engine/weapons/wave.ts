import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { clamp } from '../util';
import { seeThrough } from '../physics';
import { TONE } from '../render/index';
import type { Ctx, Player } from '../types';

/**
 * The air slash (docs/spec/weapons.md §18.11): a slash started off the ground
 * throws a crescent of force along the view. It flies `WAVE_RANGE` metres at
 * `WAVE_SPEED`, cuts every enemy, player and breakable it passes once, stops
 * at a wall, and cuts enemy bullets in its path out of the air.
 */
export const WAVE_RANGE = 12;
export const WAVE_SPEED = 30;
export const WAVE_DAMAGE = 45;
export const WAVE_PVP_DAMAGE = 35;
/** Half the crescent's width: what it hits on either side of its path. */
const WAVE_RADIUS = 1.2;
/** The crescent: its arc's radius, the angle it spans, and its depth at the middle (it tapers to points). */
const ARC = 1.1, SPAN = 1.9, DEPTH = 0.24;

export interface SlashWave {
  pos: Vector3;
  dir: Vector3;
  travelled: number;
  /** The slash's side, +1 or -1: which way the crescent tilts. */
  side: number;
  mesh: Mesh;
  /** Everything it has cut, so a target is cut once. */
  hit: Set<object>;
}

let geometry: BufferGeometry | null = null;
/**
 * A crescent in the xy plane, its ends up, deepest at the middle and tapering
 * to points, centred on the origin. It faces along +z (`place` turns +z to the
 * travel), so the thrower sees it whole as it flies away.
 */
function crescent(): BufferGeometry {
  if (geometry) return geometry;
  const steps = 24, positions: number[] = [], index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, angle = (t - 0.5) * SPAN, inner = ARC - DEPTH * Math.sin(Math.PI * t);
    for (const r of [ARC, inner]) positions.push(Math.sin(angle) * r, ARC - Math.cos(angle) * r - DEPTH / 2, 0);
    if (i < steps) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.userData.shared = true;
  return geometry;
}

const mid = new Vector3();
const look = new Vector3();

/** Throw a wave from `player`'s eye along its view. */
export function launchWave(ctx: Ctx, player: Player, side: number): void {
  const material = new MeshBasicMaterial({ color: 0xd2ecff, transparent: true, opacity: 0.95, blending: AdditiveBlending,
    side: DoubleSide, depthWrite: false });
  const mesh = new Mesh(crescent(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const wave: SlashWave = { pos: player.eye.clone().addScaledVector(player.forward, 0.6), dir: player.forward.clone().normalize(),
    travelled: 0, side, mesh, hit: new Set() };
  wave.pos.y -= 0.15;
  place(wave);
  ctx.scene.add(mesh);
  player.waves.push(wave);
  ctx.audio.dash();
  ctx.effects.strokeBurst(wave.pos, TONE.PRIMARY, 8, 5, { life: 0.2, size: 0.03 });
}

function place(wave: SlashWave): void {
  const { mesh } = wave;
  mesh.position.copy(wave.pos);
  mesh.lookAt(look.copy(wave.pos).add(wave.dir));
  // Tilted the way the blade swept.
  mesh.rotateZ(wave.side * 0.3);
  const grow = 0.8 + 0.4 * clamp(wave.travelled / WAVE_RANGE, 0, 1);
  mesh.scale.setScalar(grow);
  const material = mesh.material as MeshBasicMaterial;
  material.opacity = 0.95 * (1 - 0.6 * clamp(wave.travelled / WAVE_RANGE, 0, 1));
}

function remove(wave: SlashWave): void {
  wave.mesh.removeFromParent();
  (wave.mesh.material as MeshBasicMaterial).dispose();
}

/** Fly every wave one step and cut what it passes. */
export function updateWaves(player: Player, dt: number): void {
  const ctx = player.ctx, { world, game, effects, audio } = ctx;
  const enemies = ctx.enemies;
  for (let i = player.waves.length - 1; i >= 0; i--) {
    const wave = player.waves[i];
    if (!wave) continue;
    let length = Math.min(WAVE_SPEED * dt, WAVE_RANGE - wave.travelled);
    const wall = world.raycast(wave.pos, wave.dir, length, seeThrough);
    if (wall) length = wall.dist;
    mid.copy(wave.pos).addScaledVector(wave.dir, length / 2);
    const reach = WAVE_RADIUS + length / 2;
    let cut = false;
    for (const { enemy } of enemies?.inArc(mid, wave.dir, reach, -1) ?? []) {
      if (wave.hit.has(enemy) || !world.lineOfSight(mid, enemy.center)) continue;
      wave.hit.add(enemy);
      enemies?.damage(enemy, WAVE_DAMAGE, { point: enemy.center.clone(), dir: wave.dir.clone(), part: 'torso', source: 'wave', crit: false, slashDir: wave.side });
      cut = true;
    }
    for (const remote of game.playersInArc(mid, wave.dir, reach, -1)) {
      if (wave.hit.has(remote)) continue;
      wave.hit.add(remote);
      game.hitPlayer(remote, WAVE_PVP_DAMAGE, { point: remote.center, dir: wave.dir, part: 'torso', source: 'wave', crit: false });
      cut = true;
    }
    for (const prop of game.breakablesInArc(mid, wave.dir, reach, -1)) {
      if (wave.hit.has(prop)) continue;
      wave.hit.add(prop);
      game.breakHit(prop, WAVE_DAMAGE, prop.pos, wave.dir);
      cut = true;
    }
    if (enemies && enemies.cutProjectiles(mid, reach) > 0) audio.parry();
    if (cut) {
      audio.katanaHit();
      game.hitstop(0.04, 0.2);
    }
    wave.pos.addScaledVector(wave.dir, length);
    wave.travelled += length;
    if (wall || wave.travelled >= WAVE_RANGE - 1e-3) {
      if (wall) effects.sparks(wall.point, wall.normal, TONE.ACCENT, 10, 7);
      effects.strokeBurst(wave.pos, TONE.PRIMARY, 6, 4, { life: 0.18, size: 0.03 });
      remove(wave);
      player.waves.splice(i, 1);
      continue;
    }
    place(wave);
  }
}

/** Every wave gone at once (a reset or death). */
export function clearWaves(player: Player): void {
  for (const wave of player.waves) remove(wave);
  player.waves.length = 0;
}

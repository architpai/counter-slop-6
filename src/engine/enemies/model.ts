import { Vector3, Mesh, Quaternion, SphereGeometry } from 'three';
import type { Group, Object3D } from 'three';
import { makeFigure, TONE_HEX, unlitMat } from '../render/index';
import { flashAmount } from '../render/figure';
import { STILL, type MotionInput } from '../render/operator-motion';
import type { Figure, FigureAnchorName, FigureAnchors, FigureParts, WeaponPropKind } from '../render/figure';
import { clamp, damp, rand, wrapAngle } from '../util';
import type { RayHit } from '../types';
import type { EnemyType } from './types';
import type { EnemyRecord } from './index';

/**
 * Every part and anchor in `FigureParts` / `FigureAnchors` is optional, because
 * blobs and flyers have no limbs. The aliases below name what a given code path
 * has already established the figure carries, derived from the real types so a
 * rename in `render/figure` breaks here instead of drifting.
 */
/** Both body kinds that walk: humanoids and blobs. */
export type GroundJoints = FigureParts & Required<Pick<FigureParts,
  'hips' | 'torso' | 'head' | 'upperL' | 'upperR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR'>>;
/** The flyer poses its body and its two wings. */
type FlyerJoints = FigureParts & Required<Pick<FigureParts, 'torso' | 'wingL' | 'wingR'>>;
/** Every kind gets a torso and a muzzle tip from `makeFigure`. */
export type CoreParts = FigureParts & Required<Pick<FigureParts, 'torso' | 'tip'>>;
/** Humanoids and the moderator have a separate head; every kind gets a torso anchor. */
export type EyeAnchors = FigureAnchors & Required<Pick<FigureAnchors, 'torso'>>;

/** One hit sphere: the anchor it rides, its world centre and its radius. */
export interface HitSphere {
  part: FigureAnchorName;
  r: number;
  obj: Object3D;
  center: Vector3;
}

/**
 * The nodes `animate` moves beyond the joints, found once at spawn: the
 * carrier's payload, the aimbot's vent and cooling core, the moderator's
 * ring (render/tactical.ts `TACTICAL_NODES`), and the sentry's arc.
 */
export interface ModelNodes {
  payload?: Object3D;
  vent?: Object3D;
  core?: Object3D;
  ring?: Object3D;
  arc?: Object3D;
}

/**
 * A death's motion (V15), fixed at the kill (`planDeath`): the body is
 * knocked along the killing hit's direction on the ground and falls that
 * way, turning its back to the hit, its limbs thrown; it then lies still
 * and sinks away. Every pose is a function of the time since death
 * (`deathPose`), so it is the same at any frame rate.
 */
export interface Death {
  /** Unit, on the ground: where it falls (the hit's push, unless a wall is there). */
  dir: Vector3;
  /** Where it stood, and the yaw it faced. */
  from: Vector3;
  yaw: number;
  /** Metres it slides, short of any wall behind it. */
  slide: number;
  /** How far it falls, in radians: lying flat at pi/2, less where it slumps against a wall. */
  tilt: number;
  /** Metres it sinks at the end: `SINK` (per scale), or less on a thin slab, where it shrinks the rest of the way. */
  sink: number;
  /** 0-1, from the enemy's id: which way it turns and how its limbs go. */
  seed: number;
  /** The pose at the kill (`killPose`), which the limbs leave as they fall, so nothing snaps on the kill frame. */
  pose: KillPose;
}

/** The joints a death poses (`deathPose`). */
const DEATH_JOINTS = ['torso', 'head', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
type DeathJoint = typeof DEATH_JOINTS[number];
/** A figure's pose as it dies: each joint's rotation (x, y, z), and the hips' height and offset back. */
export interface KillPose {
  joints: Partial<Record<DeathJoint, readonly [number, number, number]>>;
  hips: readonly [number, number];
}

/** The pose `figure` stands in now (see `KillPose`). */
export function killPose(figure: Figure): KillPose {
  const joints: KillPose['joints'] = {};
  for (const name of DEATH_JOINTS) {
    const part = figure.parts[name];
    if (part) joints[name] = [part.rotation.x, part.rotation.y, part.rotation.z];
  }
  const hips = figure.parts.hips;
  return { joints, hips: [hips?.position.y ?? 0, hips?.position.z ?? 0] };
}

/** The hit tint's length in seconds (V15); a lit tint fading to none, not a solid colour. Only a look: no timer reads it. */
export const FLASH_TIME = 0.12;
/** Death (V15): the knockback's and the fall's length, when the sinking starts and ends, in seconds; removal follows (enemies/index.ts). */
export const DEATH_KNOCK = 0.35;
export const DEATH_FALL = 0.6;
export const DEATH_SINK = 3.2;
export const DEATH_END = 4;
/** A body lying from its feet, per unit of scale, with its arms out: the room a death looks for. */
const LYING = 2;
/** How deep a lying body sinks to be gone below the floor, per unit of scale. */
export const SINK = 0.8;

const delta = new Vector3();
const _axis = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fall = new Quaternion();
const _turn = new Quaternion();
const _spin = new Quaternion();
const _probe = new Vector3();
const DOWN = new Vector3(0, -1, 0);
const RADII = { head: 0.195, torso: 0.33, hips: 0.2, armL: 0.11, armR: 0.11, foreL: 0.1, foreR: 0.1, legL: 0.13, legR: 0.13, shinL: 0.11, shinR: 0.11, shield: 0.66 } satisfies Partial<Record<FigureAnchorName, number>>;
const PROPS: readonly string[] = ['rifle', 'pistol', 'shotgun', 'sniper', 'blade'];
const carriesProp = (weapon: string): weapon is 'rifle' | 'pistol' | 'shotgun' | 'sniper' | 'blade' => PROPS.includes(weapon);

export function makeModel(stats: EnemyType): { figure: Figure; root: Group; hits: HitSphere[]; nodes: ModelNodes } {
  const weapon: WeaponPropKind = stats.weapon === 'boss' ? (stats.kind === 'humanoid' ? 'hammer' : 'none')
    : carriesProp(stats.weapon) ? stats.weapon : 'none';
  const figure = makeFigure({ ...stats, color: TONE_HEX[stats.tone], weapon, mask: stats.key, tactical: stats.key });
  const radii: Partial<Record<FigureAnchorName, number>> = stats.kind === 'humanoid' ? RADII
    : stats.key === 'moderator' ? { torso: 0.48, head: RADII.head } : { torso: stats.flying ? 0.48 : 0.5 };
  const hits: HitSphere[] = [];
  for (const [part, r] of Object.entries(radii) as [FigureAnchorName, number][]) {
    const obj = figure.anchors[part];
    if (obj) hits.push({ part, r: r * stats.scale, obj, center: new Vector3() });
  }
  const find = (name: string) => figure.root.getObjectByName(name);
  const nodes: ModelNodes = { payload: find('equipment-carrier'), vent: find('aimbot-vent'), ring: find('equipment-moderator') };
  if (stats.key === 'aimbot') {
    const core = nodes.core = new Mesh(new SphereGeometry(0.13, 12, 8), unlitMat(0xffb020));
    core.name = 'aimbot cooling core'; core.position.set(0, 0.32, -0.42);
    core.userData.hitPart = 'head'; core.visible = false; figure.parts.torso?.add(core);
  }
  figure.root.scale.setScalar(0.001);
  return { figure, root: figure.root, hits, nodes };
}

export function syncModel(e: EnemyRecord): void {
  e.root.updateMatrixWorld(true);
  for (const hit of e.hits) hit.obj.getWorldPosition(hit.center);
  (e.figure.anchors as EyeAnchors).torso.getWorldPosition(e.center);
}

/** Run the hit tint's clock (`flashT`, seconds left) by `dt` and put its tint on the figure. */
export function flash(e: EnemyRecord, dt: number): void {
  if (e.flashT <= 0) return;
  e.flashT = Math.max(0, e.flashT - dt);
  e.figure.setTint(flashAmount(e.flashT, FLASH_TIME), TONE_HEX[e.stats.tone]);
}

export function spawnPose(e: EnemyRecord): void {
  const f = clamp(e.age / 0.6, 0, 1);
  e.root.scale.setScalar(Math.max(0.001, f * e.stats.scale * (1 + Math.sin(60 * e.age) * 0.12 * (1 - f))));
  if (e.age >= 0.6) { e.state = 'hunt'; e.root.scale.setScalar(e.stats.scale); }
  e.root.position.copy(e.body.pos);
  e.root.rotation.y = e.yaw;
  syncModel(e);
}

/** What the operator's clips have seen of an enemy (render/operator-motion.ts): its shots, flinch and special cooldown last step. */
const cues = new WeakMap<EnemyRecord, { shots: number; flinch: number; special: number; boss: boolean }>();
const _right = new Vector3();
/** `drive`'s input to the clips, reused each step. */
const _input: MotionInput = { ...STILL, still: false };

/**
 * Tell a worn operator (R7) what the enemy is doing, after the procedural
 * pose: speed, stride phase and sideways share, aim and carry, and the
 * one-shots as they happen (a shot, the reload after a burst, a hit, a
 * smoke or charge thrown, a boss's throw; the melee plays at the swing's
 * own progress). Looks only: nothing here reads back into play.
 */
function drive(e: EnemyRecord, dt: number, speed: number): void {
  const rig = e.figure.rig;
  // Low, or its operator not on yet: nothing plays the clips.
  if (!rig?.worn) return;
  const motion = rig.motion;
  let cue = cues.get(e);
  if (!cue) cues.set(e, cue = { shots: e.shots, flinch: e.flinch, special: e.specialCd, boss: false });
  const weapon = e.stats.weapon;
  const carry = weapon === 'rifle' || weapon === 'shotgun' || weapon === 'sniper' ? 'long' : weapon === 'pistol' ? 'pistol' : weapon === 'blade' ? 'blade' : 'none';
  // A gun's recoil and reload; a blade's projectiles (the parry's deflections) are no gunshots.
  if (e.shots !== cue.shots && (carry === 'long' || carry === 'pistol')) {
    motion.trigger('fire');
    // The burst's last shot, with a long wait before the next: time to change magazines.
    if (carry === 'long' && e.burstLeft === 0 && e.attackCd > 1.3) motion.trigger('reload');
  }
  if (e.flinch > cue.flinch + 0.3) motion.trigger('hit');
  if ((e.type === 'smoker' || e.type === 'sapper') && e.specialCd > cue.special + 4) motion.trigger('throw');
  const thrown = e.bossAttack?.kind === 'throw' && 'fired' in e.bossAttack && e.bossAttack.fired;
  if (thrown && !cue.boss) motion.trigger('throw');
  cue.shots = e.shots; cue.flinch = e.flinch; cue.special = e.specialCd; cue.boss = !!thrown;
  _right.set(Math.cos(e.yaw), 0, -Math.sin(e.yaw));
  const lateral = speed > 0.2 ? (e.body.vel.x * _right.x + e.body.vel.z * _right.z) / speed : 0;
  const input = _input;
  input.speed = speed; input.phase = e.phase; input.lateral = lateral; input.aim = e.aimAmt; input.carry = carry;
  input.onGround = e.body.onGround; input.flinch = e.flinch;
  input.melee = carry === 'blade' && e.attackT > 0 ? clamp(1 - e.attackT / 0.55, 0, 1) : null;
  motion.update(dt, input);
}

export function animate(e: EnemyRecord, dt: number): void {
  const speed = Math.hypot(e.body.vel.x, e.body.vel.z);
  e.walkAmt = damp(e.walkAmt, clamp(speed / 4, 0, 1), 10, dt);
  e.phase += (speed * 2.2 + (speed > 0.4 ? 3 : 0)) * dt;
  const s = Math.sin(e.phase), c = Math.cos(e.phase), w = e.walkAmt;
  const { payload, vent, core, ring } = e.nodes;
  if (payload) payload.visible = e.payload;
  if (vent) vent.rotation.x = e.weakT > 0 ? -0.65 : 0;
  if (core) core.visible = e.weakT > 0;
  if (ring) {
    ring.rotation.z = e.age * 0.25;
    ring.scale.setScalar(e.yankableT > 0 ? 1.12 : 1);
  }
  if (e.stats.flying) {
    const p = e.figure.parts as FlyerJoints;
    p.torso.position.y = 0.6 + Math.sin(3 * e.age) * 0.1;
    p.torso.rotation.z = e.state === 'stunned' ? e.age * 12 : clamp((e.body.vel.x * Math.cos(e.yaw) - e.body.vel.z * Math.sin(e.yaw)) * -0.08, -0.8, 0.8);
    p.torso.rotation.x = clamp(-e.body.vel.y * 0.06, -0.6, 0.6);
    // Tilt-wing motors trim the aircraft; they do not flap like a paper bird.
    p.wingL.rotation.z = clamp(-p.torso.rotation.z * 0.15, -0.12, 0.12);
    p.wingR.rotation.z = -p.wingL.rotation.z;
    drive(e, dt, speed);
    return;
  }
  const p = e.figure.parts as GroundJoints;
  const blob = e.stats.kind === 'blob';
  p.hips.position.y = (blob ? 0.5 : 0.86) + Math.abs(c) * 0.07 * w - (e.body.onGround ? 0 : 0.05);
  p.torso.rotation.set(e.flinch * (blob ? 0.4 : 0.35), 0, 0);
  p.thighL.rotation.x = e.body.onGround ? 0.9 * s * w : -0.5;
  p.thighR.rotation.x = e.body.onGround ? -0.9 * s * w : 0.6;
  p.shinL.rotation.x = e.body.onGround ? Math.max(0, c) * 1.1 * w : 1;
  p.shinR.rotation.x = e.body.onGround ? Math.max(0, -c) * 1.1 * w : 0.5;
  p.upperL.rotation.set(-0.75 * s * w, 0, -0.08);
  p.upperR.rotation.set(0.75 * s * w, 0, 0.08);
  if (p.foreL) p.foreL.rotation.set(-0.2, 0, 0);
  if (p.foreR) p.foreR.rotation.set(-0.2, 0, 0);
  if (blob) {
    p.upperL.rotation.x = -0.45 + s * 0.35 * w;
    p.upperR.rotation.x = -0.45 - s * 0.35 * w;
    if (e.fuseT >= 0) p.torso.rotation.z = Math.sin(e.age * 40) * 0.15;
    if (p.spark) p.spark.scale.setScalar(0.7 + rand(0, 0.8) + (e.fuseT >= 0 ? 1.5 : 0));
  } else if (e.stats.weapon === 'blade' && e.attackT > 0) {
    const wind = clamp((0.55 - e.attackT) / 0.37, 0, 1);
    const strike = e.attackT <= 0.18 ? 1 - e.attackT / 0.18 : 0;
    p.upperR.rotation.x = -2.2 * wind + 3.7 * strike;
    p.upperR.rotation.z = 0.7 * wind * (1 - strike);
    p.foreR.rotation.x = -1.2 * wind * (1 - strike);
    p.torso.rotation.x += -0.25 * wind + 0.8 * strike;
    p.torso.rotation.y = 0.5 * wind - 1.1 * strike;
  } else {
    p.upperR.rotation.x += (-1.35 - p.upperR.rotation.x) * e.aimAmt;
    p.upperL.rotation.x += (-1.2 - p.upperL.rotation.x) * e.aimAmt;
    p.upperL.rotation.y = 0.6 * e.aimAmt;
    p.torso.rotation.y = -0.35 * e.aimAmt;
  }
  if (e.shieldHp > 0) {
    // Grip the rear handle, rather than pushing the glove through the plate.
    p.upperL.rotation.set(-0.5, 0, 0);
    p.foreL.rotation.x = -1.9;
    p.upperR.rotation.z = 0.12;
  }
  if (e.type === 'parry' && e.guardT > 0) {
    p.upperR.rotation.set(-1.35, 0, -0.6);
    p.foreR.rotation.x = -1.15;
    p.upperL.rotation.x = -1.1;
  }
  if (e.type === 'boss' && e.bossAttack) {
    const { kind, t } = e.bossAttack;
    const raise = clamp(t / (kind === 'stomp' ? 0.6 : 0.5), 0, 1);
    const slam = kind === 'stomp' && t >= 0.75;
    p.upperR.rotation.x = slam ? 0.9 : -2.4 * raise;
    p.torso.rotation.x += slam ? 0.5 : -0.3 * raise;
  }
  if (e.state === 'stunned') {
    p.torso.rotation.x = 0.6;
    p.upperL.rotation.x = p.upperR.rotation.x = -2.5;
    p.thighL.rotation.x = -0.8;
    p.thighR.rotation.x = 0.9;
  }
  if (p.head !== p.torso && e.target) {
    delta.subVectors(e.target.center, e.center);
    p.head.rotation.y = clamp(wrapAngle(Math.atan2(delta.x, delta.z) - e.yaw) - p.torso.rotation.y, -1.1, 1.1);
    p.head.rotation.x = clamp(-Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) * 0.8, -0.6, 0.6);
    p.head.rotation.z = s * 0.04 * w + (e.fuseT >= 0 ? Math.sin(30 * e.age) * 0.3 : 0);
  }
  drive(e, dt, speed);
}

/**
 * A corpse's frame: its tint fades, and on a body still in one piece (not
 * handed to the debris) the death's pose for its time since death.
 */
export function corpse(e: EnemyRecord, dt: number): void {
  e.deadT += dt;
  flash(e, dt);
  if (e.figure.rig?.worn) e.figure.rig.motion.update(dt, STILL);
  if (e.rootDetached || !e.death) return;
  deathPose(e, e.death, e.deadT);
}

const easeOut = (x: number, power: number): number => 1 - (1 - clamp(x, 0, 1)) ** power;

/** What `planDeath` casts against (physics.ts `World`). */
export interface DeathRays {
  raycast(origin: Vector3, dir: Vector3, max: number): Pick<RayHit, 'dist' | 'box'> | null;
}

/**
 * Fix a death's motion at the kill (see `Death`): along the killing hit
 * (`hit`) on the ground, or straight back from its facing for a hit from
 * above or below, further for an overkill. Where a wall or crate stands in
 * the way of the body lying down, it falls to a side (the seed picks which
 * first), else back towards the shot; with no room anywhere it takes the
 * roomiest way, slides less and slumps against the wall. It sinks no deeper
 * than the floor slab under it is thick. The seed comes from the id, so a
 * host and its mirrors pose the body alike.
 */
export function planDeath(world: DeathRays, e: Pick<EnemyRecord, 'id' | 'yaw' | 'root' | 'stats' | 'figure'>, hit: Vector3, overkill: boolean): Death {
  const scale = e.stats.scale, from = e.root.position.clone();
  const seed = (Math.imul(e.id, 0x9e3779b1) >>> 0) / 0x100000000, side = seed < 0.5 ? 1 : -1;
  const reach = (overkill ? 0.9 : 0.5) * Math.min(scale, 1.5), length = LYING * scale;
  const ahead = new Vector3(hit.x, 0, hit.z);
  if (ahead.lengthSq() < 0.04) ahead.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  ahead.normalize();
  const ways = [ahead, new Vector3(ahead.z * side, 0, -ahead.x * side), new Vector3(-ahead.z * side, 0, ahead.x * side), ahead.clone().negate()];
  // At the lying body's height: what it would fall into, low crates too.
  const origin = from.clone().setY(from.y + 0.4 * scale);
  let dir = ahead, room = -1;
  for (const way of ways) {
    const wall = world.raycast(origin, way, reach + length);
    if (!wall) {
      dir = way;
      room = Infinity;
      break;
    }
    if (wall.dist > room) {
      dir = way;
      room = wall.dist;
    }
  }
  const slide = clamp(room - length, 0, reach);
  const tilt = Math.asin(clamp((room - slide) / length, 0, 1));
  // Under its feet and under its middle as it lies: a slab thinner than the sink would show the body below it.
  let sink = SINK * scale;
  for (const along of [0, 0.5 * length * Math.sin(tilt)]) {
    _probe.copy(from).addScaledVector(dir, slide + along).setY(from.y + 0.5);
    const floor = world.raycast(_probe, DOWN, 1.5);
    sink = Math.min(sink, floor ? Math.max(0, floor.box.max.y - floor.box.min.y - 0.05) : 0);
  }
  return { dir, from, yaw: e.yaw, slide, tilt, sink, seed, pose: killPose(e.figure) };
}

/**
 * The death's pose `t` seconds in (see `Death`): a closed form of `t`, so a
 * frame's length changes nothing. The body slides back along its fall and
 * topples that way onto its back, slowly and then faster, as a falling body
 * does, swinging 0.15-0.4 rad about the vertical, with a small settle as it
 * lands. Its knees give on the way down, the hips dropping so the feet stay
 * on the floor; the head rolls aside and the arms fly out to the sides, each
 * joint going there from where it was at the kill (`Death.pose`). From
 * `DEATH_SINK` it sinks below the floor by `DEATH_END` (shrinking the rest
 * of the way on a thin slab). A limb already torn off (debris owns it) is
 * left alone.
 */
export function deathPose(e: Pick<EnemyRecord, 'root' | 'figure' | 'stats'>, death: Death, t: number): void {
  const { root, stats } = e, scale = stats.scale, side = death.seed < 0.5 ? -1 : 1;
  const x = clamp(t / DEATH_FALL, 0, 1), knock = easeOut(t / DEATH_KNOCK, 2);
  const fall = x ** 1.6, limbs = easeOut(x, 2), buckle = Math.sin(Math.PI * x);
  const settle = t > DEATH_FALL ? Math.sin(14 * (t - DEATH_FALL)) * Math.exp(-7 * (t - DEATH_FALL)) * 0.08 : 0;
  const angle = death.tilt * fall - settle;
  const sinking = easeOut((t - DEATH_SINK) / (DEATH_END - DEATH_SINK), 2);
  const size = Math.max(0.001, scale * (1 - (1 - death.sink / (SINK * scale)) * sinking));
  root.position.copy(death.from).addScaledVector(death.dir, death.slide * knock);
  // Lifted as it comes to lie, so its back lies on the floor, not in it (the feet stay down while it tips); then sunk away.
  root.position.y += 0.2 * size * Math.sin(Math.max(0, angle)) ** 6 - death.sink * sinking;
  _axis.crossVectors(_up, death.dir).normalize();
  _fall.setFromAxisAngle(_axis, angle);
  // It turns its back to the hit as it goes (a side or rear hit spins it), so it lands flat on its
  // back, and the whole body swings a little about the vertical as it lands.
  const away = Math.atan2(-death.dir.x, -death.dir.z);
  _turn.setFromAxisAngle(_up, death.yaw + wrapAngle(away - death.yaw) * limbs);
  _spin.setFromAxisAngle(_up, side * (0.15 + 0.25 * death.seed) * fall);
  root.quaternion.multiplyQuaternions(_fall, _turn).premultiply(_spin);
  root.scale.setScalar(size);
  const p = e.figure.parts, spread = 0.7 + 0.3 * death.seed, from = death.pose.joints;
  // A joint's angle about `axis`: from the kill's towards `goal` as the limbs go.
  const to = (name: DeathJoint, axis: 0 | 1 | 2, goal: number) => {
    const start = from[name]?.[axis] ?? 0;
    return start + (goal - start) * limbs;
  };
  const pose = (name: DeathJoint, x: number, y: number, z: number) => {
    const part = p[name];
    if (part && attached(part, root)) part.rotation.set(x, y, z);
  };
  const rest = (name: DeathJoint, x: number, y: number, z: number) => pose(name, to(name, 0, x), to(name, 1, y), to(name, 2, z));
  rest('torso', 0.1, 0.15 * side, 0);
  if (p.head !== p.torso) rest('head', 0.15, 0.5 * side, 0.1 * side);
  // The gun hand's forearm stays almost straight, so the gun lies on the floor and sinks with the body.
  rest('upperL', 0.1, 0, -1.3 * spread);
  rest('upperR', 0.1 - 0.2 * death.seed, 0, 1.1 + 0.3 * (1 - death.seed));
  rest('foreL', -0.7, 0, 0);
  rest('foreR', -0.15, 0, 0);
  // The knees give and the thighs come forward on the way down, then straighten a little as it lies.
  const thighL = to('thighL', 0, -0.1 - 0.15 * death.seed) - 0.8 * buckle, thighR = to('thighR', 0, -0.25 + 0.15 * death.seed) - 0.8 * buckle;
  const shinL = to('shinL', 0, 0.3) + 1.4 * buckle, shinR = to('shinR', 0, 0.2 + 0.3 * death.seed) + 1.4 * buckle;
  pose('thighL', thighL, to('thighL', 1, 0), to('thighL', 2, -0.15));
  pose('thighR', thighR, to('thighR', 1, 0), to('thighR', 2, 0.15));
  pose('shinL', shinL, to('shinL', 1, 0), to('shinL', 2, 0));
  pose('shinR', shinR, to('shinR', 1, 0), to('shinR', 2, 0));
  // The hips come down and back as far as the bent legs reach, so the feet stay where they stood. The legs'
  // reach at the kill (a stride) is where the hips already were: it fades out as they go from there.
  if (p.hips && p.hips !== p.torso && p.shinL && p.shinR) {
    const leg = Math.abs(p.shinL.position.y), [hipsY, hipsZ] = death.pose.hips;
    const down = (a: number, b: number) => leg * (2 - Math.cos(a) - Math.cos(a + b)), back = (a: number, b: number) => leg * (Math.sin(a) + Math.sin(a + b));
    const legs = (reach: typeof down, a: number, b: number, c: number, d: number) => (reach(a, b) + reach(c, d)) / 2;
    const start = (name: DeathJoint) => from[name]?.[0] ?? 0, stood = 1 - limbs;
    const was = (reach: typeof down) => legs(reach, start('thighL'), start('shinL'), start('thighR'), start('shinR'));
    p.hips.position.y = hipsY + ((stats.kind === 'blob' ? 0.5 : 0.86) - hipsY) * limbs - legs(down, thighL, shinL, thighR, shinR) + stood * was(down);
    p.hips.position.z = hipsZ * stood + legs(back, thighL, shinL, thighR, shinR) - stood * was(back);
  }
}

/** `part` is still in the figure under `root` (not torn off). */
function attached(part: Object3D, root: Object3D): boolean {
  for (let node: Object3D | null = part.parent; node; node = node.parent) if (node === root) return true;
  return false;
}

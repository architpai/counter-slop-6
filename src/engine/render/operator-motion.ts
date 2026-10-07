import * as THREE from 'three';
import manifest from './operator-assets.json';

/**
 * The realistic operators' keyframed layer (docs/VISUALS.md, R7): the clips
 * authored in Blender (tools/blender/characters/clips.py), blended by what
 * the figure's owner says it is doing, on top of the procedural pose the
 * game already drives on the pivots. A clip's key is a bone's rotation from
 * its rest, so a figure's bone is its pivot's rotation times these deltas
 * (render/operators.ts): the hit areas, which follow the pivots, never move.
 *
 * Loops: `idle` (breathing), `walk` and `run` (one stride cycle, played at
 * the procedural stride's phase so the feet do not slide), `strafeL` and
 * `strafeR`, and the held poses `crouch` and `aim`. One-shots: `fire`,
 * `reload`, `melee` (played at the attack's own progress), `hit` and
 * `throw`. The machines' walkers have `idle` and `walk`; the drones' rotors
 * spin procedurally.
 */
export const LOOPS = ['idle', 'walk', 'run', 'strafeL', 'strafeR', 'crouch', 'aim'] as const;
export const ONE_SHOTS = ['fire', 'reload', 'melee', 'hit', 'throw'] as const;
export type LoopClip = (typeof LOOPS)[number];
export type OneShot = (typeof ONE_SHOTS)[number];
export type ClipName = LoopClip | OneShot;
/** Which clip rig a kind plays: the operators', the walkers' (bomber, hitbox, lag spike), or none (the drones). */
export type ClipGroup = 'humanoid' | 'machine' | 'drone';
export type Carry = 'long' | 'pistol' | 'blade' | 'none';

/** What a figure's owner tells its operator each step (enemies/model.ts, players.ts). */
export interface MotionInput {
  /** Ground speed, m/s. */
  speed: number;
  /** The procedural stride's phase, radians (enemies/model.ts `phase`: the thighs swing with its sine). */
  phase: number;
  /** The ground velocity's share across the facing (+1 all to the figure's +x, -1 to its -x). */
  lateral: number;
  /** 0..1: how far it holds its weapon up to aim. */
  aim: number;
  carry: Carry;
  onGround: boolean;
  crouch: boolean;
  /** 0..1: the procedural flinch (a hit's). */
  flinch: number;
  /** The melee swing's progress 0..1 while one is on, else null (it plays at the attack's own timing). */
  melee: number | null;
  /** A body that no longer moves by itself (a corpse): every loop fades out, one-shots finish. */
  still?: boolean;
}

/** A body that no longer moves by itself (a corpse, enemies/model.ts `corpse`, players.ts): its loops fade, its one-shots finish. */
export const STILL: Readonly<MotionInput> = {
  speed: 0, phase: 0, lateral: 0, aim: 0, carry: 'none', onGround: true, crouch: false, flinch: 0, melee: null, still: true,
};

/** Walking speed where the walk loop is fully on, and the run takes over from `RUN_FROM` to `RUN_FULL` (m/s). */
export const WALK_FULL = 1.2;
export const RUN_FROM = 4.2;
export const RUN_FULL = 6.2;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The loops' weights for an input, into `out` (a new record if none is
 * given): pure, so tests can pin the selection. Moving blends idle into
 * walk, walk into run with speed; sideways motion turns part of the stride
 * into a strafe; a crouch and an aim are held poses on top; the one-shots
 * are added by `OperatorMotion` as they fire.
 */
export function loopWeights(input: Readonly<MotionInput>, group: ClipGroup, out?: Record<LoopClip, number>): Record<LoopClip, number> {
  const weights = out ?? { idle: 0, walk: 0, run: 0, strafeL: 0, strafeR: 0, crouch: 0, aim: 0 };
  if (input.still || group === 'drone') {
    for (const name of LOOPS) weights[name] = 0;
    return weights;
  }
  const move = input.onGround ? smooth(0.15, WALK_FULL, input.speed) : 0;
  const run = group === 'humanoid' ? smooth(RUN_FROM, RUN_FULL, input.speed) : 0;
  const side = group === 'humanoid' ? Math.min(1, Math.abs(input.lateral) * 1.4) * (1 - run) : 0;
  const stride = move * (1 - side);
  weights.idle = 1 - move;
  weights.walk = stride * (1 - run);
  weights.run = stride * run;
  weights.strafeL = input.lateral < 0 ? move * side : 0;
  weights.strafeR = input.lateral > 0 ? move * side : 0;
  weights.crouch = group === 'humanoid' && input.crouch ? 1 : 0;
  weights.aim = group === 'humanoid' && (input.carry === 'long' || input.carry === 'pistol') ? input.aim : 0;
  return weights;
}

/** One clip, sampled per bone: its tracks' rotations by bone name. */
export interface Clip {
  duration: number;
  loop: boolean;
  tracks: ReadonlyMap<string, THREE.Interpolant>;
}

/** The clips of a glb by group and name (`<group>.<clip>` in the file), their tracks bound by bone name (`<rig>__<bone>`). */
export class ClipLibrary {
  /** By group, then clip name: the per-frame lookups build no key. */
  readonly #clips = new Map<string, Map<string, Clip>>();

  constructor(animations: readonly THREE.AnimationClip[], loops: ReadonlySet<string>) {
    for (const animation of animations) {
      const tracks = new Map<string, THREE.Interpolant>();
      for (const track of animation.tracks) {
        const [node, property] = track.name.split('.');
        if (property !== 'quaternion' || !node) continue;
        tracks.set(node.replace(/^[^_]*__/, ''), track.createInterpolant());
      }
      const [group = '', name = ''] = animation.name.split('.');
      let clips = this.#clips.get(group);
      if (!clips) this.#clips.set(group, clips = new Map());
      clips.set(name, { duration: animation.duration, loop: loops.has(animation.name), tracks });
    }
  }

  get(group: ClipGroup, name: ClipName): Clip | null {
    return this.#clips.get(group)?.get(name) ?? null;
  }

  get names(): string[] {
    return [...this.#clips].flatMap(([group, clips]) => [...clips.keys()].map(name => `${group}.${name}`));
  }
}

/** How long a one-shot fades out once its clip has played (seconds). */
const FADE = 0.12;
/** Each one-shot's length by group (tools/characters/operators.mjs writes them as `<group>.<clip>`). */
const LENGTHS: Record<ClipGroup, Partial<Record<OneShot, number>>> = { humanoid: {}, machine: {}, drone: {} };
for (const [key, { duration }] of Object.entries(manifest.clips as Record<string, { duration: number }>)) {
  const [group, name] = key.split('.') as [ClipGroup, OneShot];
  if (LENGTHS[group] && (ONE_SHOTS as readonly string[]).includes(name)) LENGTHS[group][name] = duration;
}

/**
 * A figure's clip state: every loop's weight and time, the one-shots in
 * flight, and the rotors' spin. `update` runs with the owner's step (so a
 * paused game holds the pose); `delta` gives a bone's rotation from all of
 * them for the frame being drawn.
 */
export class OperatorMotion {
  readonly group: ClipGroup;
  readonly weights: Record<LoopClip, number> = { idle: 1, walk: 0, run: 0, strafeL: 0, strafeR: 0, crouch: 0, aim: 0 };
  /** Loop clocks: seconds into `idle`, and the stride's share of a cycle for the others. */
  idleTime = 0;
  cycle = 0;
  /** One-shots in flight: seconds in (or the melee's progress), and each one's weight. */
  readonly shots = new Map<OneShot, { t: number; weight: number }>();
  /** The drones' rotor angle, radians. */
  spin = 0;
  /** What the figure carries and how far it aims, as last told: the support hand reaches for the gun by it (render/operators.ts). */
  carry: Carry = 'none';
  aim = 0;
  #meleeProgress: number | null = null;
  /** `loopWeights`' output, reused each step. */
  readonly #target: Record<LoopClip, number> = { idle: 1, walk: 0, run: 0, strafeL: 0, strafeR: 0, crouch: 0, aim: 0 };

  constructor(group: ClipGroup) {
    this.group = group;
  }

  /** Start a one-shot from its beginning (a shot restarts its recoil; a reload already running carries on). */
  trigger(name: OneShot): void {
    const running = this.shots.get(name);
    if (running && name === 'reload') return;
    this.shots.set(name, { t: 0, weight: 1 });
  }

  update(dt: number, input: Readonly<MotionInput>): void {
    const target = loopWeights(input, this.group, this.#target);
    // Ease towards the new weights over about a tenth of a second, the same at any frame rate.
    const k = 1 - Math.exp(-dt / 0.09);
    for (const name of LOOPS) this.weights[name] += (target[name] - this.weights[name]) * k;
    this.idleTime += dt;
    this.carry = input.carry;
    this.aim += ((input.still ? 0 : input.aim) - this.aim) * k;
    this.cycle = ((input.phase / (2 * Math.PI)) % 1 + 1) % 1;
    this.spin = (this.spin + dt * 70) % (2 * Math.PI);
    if (input.melee !== null) {
      if (this.#meleeProgress === null) this.shots.set('melee', { t: 0, weight: 1 });
      const melee = this.shots.get('melee');
      if (melee) melee.t = input.melee;
    }
    this.#meleeProgress = input.melee;
    for (const name of ONE_SHOTS) {
      const shot = this.shots.get(name);
      if (!shot) continue;
      if (name === 'melee') {
        if (input.melee === null) shot.weight -= dt / FADE;
      } else {
        shot.t += dt;
        const length = LENGTHS[this.group][name] ?? 0;
        if (shot.t >= length) shot.weight -= dt / FADE;
      }
      if (name === 'hit') shot.weight = Math.min(shot.weight, 0.35 + 0.65 * input.flinch);
      if (shot.weight <= 0) this.shots.delete(name);
    }
  }

  /**
   * A bone's rotation from the clips at their weights, into `out`
   * (identity when none moves it). Loops at their clocks, each slerped from
   * identity by its weight; one-shots on top.
   */
  delta(library: ClipLibrary, bone: string, out: THREE.Quaternion): THREE.Quaternion {
    out.identity();
    for (const name of LOOPS) {
      const weight = this.weights[name];
      if (weight < 0.01) continue;
      const clip = library.get(this.group, name);
      const track = clip?.tracks.get(bone);
      if (!clip || !track) continue;
      const t = name === 'idle' ? this.idleTime % clip.duration : name === 'crouch' || name === 'aim' ? 0 : this.cycle * clip.duration;
      out.multiply(sample(track, t, weight));
    }
    for (const name of ONE_SHOTS) {
      const shot = this.shots.get(name);
      if (!shot) continue;
      const clip = library.get(this.group, name);
      const track = clip?.tracks.get(bone);
      if (!clip || !track) continue;
      const t = name === 'melee' ? shot.t * clip.duration : Math.min(shot.t, clip.duration);
      out.multiply(sample(track, t, Math.min(1, shot.weight)));
    }
    return out;
  }
}

const _sample = new THREE.Quaternion();
const _identity = new THREE.Quaternion();
function sample(track: THREE.Interpolant, t: number, weight: number): THREE.Quaternion {
  const v = track.evaluate(t);
  _sample.set(v[0]!, v[1]!, v[2]!, v[3]!);
  return weight >= 0.999 ? _sample : _sample.slerp(_identity, 1 - weight);
}

/**
 * Shared shapes that cross module boundaries.
 *
 * This is `docs/ARCHITECTURE.md` §5 made executable. That document stays the
 * prose source of truth; when the two disagree, the document is right and this
 * file has a bug.
 *
 * Modules still written in JavaScript appear below as `UNPORTED`. That is
 * deliberate: `unknown` makes every use a compile error, so a phase cannot
 * quietly depend on a module it has not converted yet. Grep `UNPORTED` for the
 * remaining work.
 */
import type * as THREE from 'three';
import type { Body, Box, World } from './physics';
import type { NavGrid } from './nav';

// Ported subsystems: real types.
export type { Renderer } from './render/index';
export type { Effects } from './effects';
export type { Audio } from './audio';
export type { Input } from './input';
export type { HudView } from './hud/view';

import type { Renderer } from './render/index';
import type { Effects } from './effects';
import type { Audio } from './audio';
import type { Input } from './input';
import type { HudView } from './hud/view';

/** A module that has not been converted yet. Replace with a real import type. */
type UNPORTED = unknown;

export type Player = import('./player/index').Player; // player/index.ts  — phase 4
export type Weapon = import('./weapons/index').Weapon; // weapons/index.ts — phase 4
export type EnemyManager = import('./enemies/index').EnemyManager; // enemies/index.ts  — phase 5
export type EnemyType = import('./enemies/types').EnemyType; // enemies/types.ts  — phase 5
export type RemotePlayer = import('./players').RemotePlayer; // players.ts        — phase 5
export type Net = import('./net').Net; // net.ts            — phase 5

// ---------------------------------------------------------------- 5.1 context

/**
 * Built by `boot` and handed to every subsystem constructor.
 *
 * `level` and `nav` are replaced on every level rebuild. Read them off `ctx`
 * each time you need them; never cache either across a frame.
 */
export interface Ctx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: Renderer;
  world: World;
  nav: NavGrid;
  /** The same grid at boss clearance; bosses path on it and boss spawns are checked against it. */
  bossNav: NavGrid;
  level: Level;

  input: Input;
  hud: HudView;
  effects: Effects;
  audio: Audio;
  net: Net;

  /** Assigned after their own construction, so null during boot. */
  enemies: EnemyManager | null;
  player: Player | null;
  remotes: Map<string, RemotePlayer>;

  game: GameHooks;
}

// ------------------------------------------------------------------ 5.2 hooks

export type GameStateName = 'start' | 'lobby' | 'play' | 'pause' | 'dying' | 'dead' | 'over';
export type GameMode = 'solo' | 'ffa' | 'training';

export interface PlayerHit {
  player: RemotePlayer;
  part: string;
  dist: number;
  point: THREE.Vector3;
}

/**
 * What `boot` provides to everyone else. Every hook is always present; the
 * offline versions are no-ops or return empty results, so callers never have to
 * check for existence.
 */
export interface GameHooks {
  hitstop(duration: number, scale: number): void;
  addScore(points: number, label?: string | null): void;
  onPlayerDeath(): void;

  /** Local player first, then remotes. */
  targets(): Target[];
  canHurt(t: Target): boolean;
  raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null;
  playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[];
  hitPlayer(t: RemotePlayer, damage: number, info: HitInfo): void;
  cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean;
  onShot(end: THREE.Vector3): void;

  breakHit(prop: Breakable, damage: number, point: THREE.Vector3, dir: THREE.Vector3): void;
  breakablesInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): Breakable[];
  blastBreakables(center: THREE.Vector3, radius: number): void;

  readonly state: GameStateName;
  readonly mode: GameMode;
  isOnline(): boolean;
  inMatch(): boolean;
  playing(): boolean;
}

// ----------------------------------------------------------------- 5.3 target

/** Anything an enemy or a blast can hurt: the local player and every remote. */
export interface Target {
  alive: boolean;
  name: string;
  body: Pick<Body, 'pos' | 'vel' | 'halfW' | 'height' | 'onGround'>;
  /**
   * The five below are `readonly` because every implementation backs them with
   * a getter. Declared mutable, TypeScript would happily typecheck a write
   * through a `Target` reference that throws at runtime.
   */
  readonly isLocal: boolean;
  /** Feet + height * 0.55. A live vector: copy it before storing. */
  readonly center: THREE.Vector3;
  readonly eye: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  /** Speed of travel. Remote players always report 0. */
  readonly speed: number;
  /** Down sights / trigger held. Enemies read these as "busy" cues. */
  readonly aiming: boolean;
  readonly firing: boolean;
  /** Local: 0.95 while guarding and off cooldown, else 0. Remote: always 0. */
  readonly blockRadius: number;
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;
  knockback(dir: THREE.Vector3, amount: number): void;
  /** Remote players always return false. */
  tryDeflect(p: Projectile): false | { perfect: boolean; returned: boolean };
  tryBlockMelee(e: Enemy): boolean;
}

// -------------------------------------------------------------------- 5.4 hit

export type HitPart =
  | 'head' | 'torso' | 'hips' | 'armL' | 'armR' | 'foreL' | 'foreR'
  | 'legL' | 'legR' | 'shinL' | 'shinR' | 'shield' | 'blade';

export type DamageSource =
  | 'r4c' | 'rifle' | 'shotgun' | 'sniper' | 'revolver' | 'pistol' | 'melee' | 'focus'
  | 'deflect' | 'blast' | 'fall' | 'grenade';

/** One record for every damage event, from any source, to any victim. */
export interface HitInfo {
  point?: THREE.Vector3;
  /** Unit direction the damage travelled. */
  dir?: THREE.Vector3;
  part?: HitPart | string;
  source?: DamageSource | string;
  /** True only when `part === 'head'`. */
  crit?: boolean;
  /** Ray entry distance, for gun falloff. */
  dist?: number;
  /** Melee swing side, +1 or -1. */
  slashDir?: number;
}

/** `player.lastHit`, used for kill credit. */
export interface LastHit {
  from: THREE.Vector3 | null;
  crit: boolean;
  amount: number;
  src: string;
}

// ---------------------------------------------------------------- 5.5 physics

export interface BoxData {
  /** Top face is not a nav surface. */
  noNav?: boolean;
  /** See-through: rays, vision and particles pass. */
  noShoot?: boolean;
  /** Grapple rays pass. */
  noGrapple?: boolean;
  /** Free label. Read by nobody. */
  tag?: unknown;
  /** Back-reference set by `level` for prop colliders. */
  breakable?: Breakable;
}

export interface RayHit {
  dist: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  box: Box;
}

/** Predicate form used by raycast callers to skip boxes. */
export type BoxFilter = (box: Box) => boolean;

// ------------------------------------------------------------------ 5.6 level

export type LevelKey = 'downtown' | 'mexico' | 'house' | 'training';

/** Sky and light colours a level asks the renderer for. Missing fields keep the default. */
export interface Mood {
  horizon?: number;
  zenith?: number;
  fog?: number;
  sun?: number;
  sunIntensity?: number;
  hemiIntensity?: number;
  hemiSky?: number;
  hemiGround?: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface GrappleMover {
  mesh: THREE.Object3D;
  radius: number;
}

export interface Animated {
  mesh: THREE.Object3D;
  update(time: number): void;
}

export type BreakableKind = 'potS' | 'potL' | 'crate' | 'barrel' | 'cactus' | 'pinata';

export interface Breakable {
  /** Index in `level.breakables`. */
  id: number;
  kind: BreakableKind;
  /** Its meshes. Children become debris on break. */
  group: THREE.Group;
  hp: number;
  /** Centre: base + height / 2. */
  pos: THREE.Vector3;
  alive: boolean;
  /** TONE id for its burst and debris tint. */
  tone: number;
  /** Its collider, removed on break. */
  box: Box;
}

export interface Level {
  key: LevelKey;
  arena: boolean;
  playerStart: THREE.Vector3;
  bounds: Bounds;
  /** Ground enemy spawn points. */
  spawns: THREE.Vector3[];
  /** AIMBOT's authored position and stair route. No geometry is added by these markers. */
  bossPerch?: { position: THREE.Vector3; route: THREE.Vector3[] };
  /** Sniper perches. */
  snipers: THREE.Vector3[];
  pickups: THREE.Vector3[];
  /** Fixed grapple anchors. */
  rings: THREE.Vector3[];
  /** FFA spawns. Empty means fall back to `spawns`. */
  arenaSpawns: THREE.Vector3[];
  /** Built, read by nobody. */
  teamSpawns: THREE.Vector3[][];
  /** Moving grapple targets (drones). */
  movers: GrappleMover[];
  animated: Animated[];
  /** Mexico only. `id === index`. */
  breakables: Breakable[];
  /** Everything to remove on rebuild. */
  meshes: THREE.Object3D[];
  /** Directional-light shadow fit. */
  shadow: { center: THREE.Vector3; radius: number };
  mood?: Mood;
}

// ----------------------------------------------------------------- 5.7 pickup

export interface Pickup {
  /** Host-assigned online, local counter offline. Both start at 1. */
  id: number;
  kind: 'ammo' | 'health';
  mesh: THREE.Object3D;
  /** spot.y + 0.6 */
  baseY: number;
  /** Bob phase, uniform [0, 6) at spawn. */
  phase: number;
  /** 45 s. Only the host, or an offline game, ages it. */
  life: number;
}

// ------------------------------------------------- 5.8 enemies & projectiles

export type EnemyKind =
  | 'grunt' | 'rusher' | 'heavy' | 'sniper' | 'shield' | 'bomber' | 'flyer'
  | 'medic' | 'breacher' | 'carrier' | 'turret' | 'packleader' | 'smoker' | 'rubberbander' | 'sapper' | 'parry'
  | 'boss' | 'hitbox' | 'lagspike' | 'aimbot' | 'ragequit' | 'moderator';

export type EnemyState = 'spawn' | 'hunt' | 'stunned' | 'dead';

/** The cross-module surface only. Full field list in `enemies.md` §3.1. */
export interface Enemy {
  id: number;
  type: EnemyKind | string;
  /** Catalogue row: name, hp, speed, score, scale, boss, flying, tone. */
  stats: EnemyType;
  hp: number;
  maxHp: number;
  alive: boolean;
  state: EnemyState;
  body: Body;
  /** Torso world position. A live vector: copy it before storing. */
  center: THREE.Vector3;
  yaw: number;
  root: THREE.Group;
}

export interface Projectile {
  id: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  owner: Enemy | null;
  life: number;
  deflected: boolean;
  tone: number;
  thickness: number;
  /** Spawn point, used as the "hit from" position. */
  origin: THREE.Vector3;
  blast: boolean;
}

// --------------------------------------------------------------- 5.9 network

/** Every message on the wire is exactly this object. */
export interface Envelope {
  /** Message type. */
  t: string;
  d: unknown;
  /**
   * Set by the host on everything it sends (except `refused`), and on relayed
   * copies, where it is the original sender.
   */
  from?: string;
  /** client -> host -> that client. */
  to?: string;
  /** A client asking the host to forward to everyone else. */
  relay?: boolean;
}

/**
 * Local state packet `ps`: a flat number array, broadcast every third network
 * tick while in a match.
 *
 * | Index    | Field                        | Quantisation                  |
 * |----------|------------------------------|-------------------------------|
 * | 0,1,2    | body position x, y (feet), z | 2 dp                          |
 * | 3        | yaw                          | 2 dp                          |
 * | 4        | pitch                        | 2 dp                          |
 * | 5        | weapon index                 | int 0..4                      |
 * | 6        | flag bits                    | int, see `PS_FLAG`            |
 * | 7        | health                       | rounded int                   |
 * | 8,9,10   | velocity x, y, z             | 1 dp                          |
 * | 11,12,13 | grapple hook x, y, z         | 1 dp, only while grappling    |
 *
 * Decode velocity only if `length > 10`, and the hook only if the grappling bit
 * is set *and* `length > 13`. A packet from an unknown id is dropped.
 */
export type StatePacket = number[];

export const PS_FLAG = {
  CROUCHING: 1,
  SLIDING: 2,
  BLOCKING: 4,
  AIMING: 8,
  ON_GROUND: 16,
  FIRING: 32,
  ALIVE: 64,
  GRAPPLING: 128,
  PARRY_WINDOW: 256,
  MELEE: 512,
} as const;

/** A remote snapshot pair used for interpolation. `t` is local arrival time. */
export interface Snap {
  p: THREE.Vector3;
  yaw: number;
  pitch: number;
  t: number;
}

/** Table order is insertion order; display order is kills desc, deaths asc. */
export interface ScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
}

export interface Lobby {
  /** Peer id -> name, insertion ordered. */
  players: Map<string, string>;
  hostId: string | null;
  isPublic: boolean;
  status: string;
  code: string | null;
  /** Null until the host sets one. */
  map: string | null;
}

// ----------------------------------------------------------- 5.10 weapon state

/** Player -> weapon, once per frame. */
export interface WeaponState {
  fire: boolean;
  firePressed: boolean;
  /** Gun ADS; the separate melee action maps its guard to this field. */
  aim: boolean;
  reloadPressed: boolean;
  /** A dedicated melee press, independent of the selected gun. */
  meleePressed: boolean;
  sprinting: boolean;
  grounded: boolean;
  /** Horizontal speed. */
  speed: number;
  sliding: boolean;
  /** Radians this frame, with invert already applied. */
  lookDelta: { x: number; y: number };
  /** -1..1 */
  strafe: number;
  bobPhase: number;
  bobAmt: number;
  /** clamp(-landDipSpring.value * 0.08, -0.5, 0.5) */
  landDip: number;
  /** 1 while sliding, else 0. */
  slideTilt: number;
  /** True when the player is dead. */
  blockFire: boolean;
}

// ------------------------------------------------------------ 5.11 game state

export interface FocusState {
  active: boolean;
  [key: string]: unknown;
}

export interface GameState {
  state: GameStateName;
  mode: GameMode;
  /** An overlay is open while `state === 'play'`. */
  menu: boolean;
  /** Game clock: += sdt while playing, += dt otherwise. */
  time: number;
  hitstopT: number;
  hitstopScale: number;
  wave: number;
  score: number;
  combo: number;
  comboT: number;
  kills: number;
  intermission: number;
  queue: string[];
  spawnT: number;
  maxAlive: number;
  deathT: number;
  focus: FocusState;
  katanaStreak: number;
  boss: Enemy | null;
  respawnT: number;
  matchT: number;
  over: { id: string; name: string } | null;
  overT: number;
}

export const FFA = {
  KILL_TARGET: 20,
  TIME_LIMIT: 480,
  RESPAWN_DELAY: 3.5,
} as const;

export const MAX_GRENADES = 5;

// --------------------------------------------------------------- 5.12 storage

/**
 * Every value is a string in `localStorage`, read and written only by `boot`
 * through `util.store`.
 */
export type StorageKey =
  | 'cs6_map'
  | 'cs6_best'
  | 'cs6_music'
  | 'cs6_name'
  | 'cs6_sens'
  | 'cs6_invert';

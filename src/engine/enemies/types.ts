import { rand } from '../util';
import type { EnemyKind } from '../types';
import type { BlobKind, FigureKind, HatKind } from '../render/figure';
import type { ToneId } from '../render/palette';

/** What the type carries. Drives the model prop and the ground-AI branch. */
export type EnemyWeapon = 'rifle' | 'shotgun' | 'sniper' | 'pistol' | 'blade' | 'bomb' | 'dive' | 'boss';

/**
 * One catalogue row (E §2.1-2.5). The blocks below the common fields belong to
 * one class of enemy each, so they are optional: a bomber has no burst, a
 * rifleman has no fuse. `RangedType` names the block the four ranged classes do
 * fill in.
 */
export interface EnemyType {
  key: EnemyKind;
  name: string;
  /** Model kind, `humanoid` unless the row says otherwise. */
  kind: FigureKind;
  hp: number;
  speed: number;
  weapon: EnemyWeapon;
  score: number;
  scale: number;
  /** Tone, 1 (hostile red) unless the row says otherwise. */
  tone: ToneId;
  damage: number;
  boss?: boolean;
  flying?: boolean;
  shield?: boolean;
  /** Holds its ground and aims up instead of closing (the sniper). */
  stationary?: boolean;

  /** Optional live spawn limit (carrier and sentry share a separate limit). */
  cap?: number;

  // Ranged block.
  range?: number;
  stop?: number;
  keep?: number;
  burst?: number;
  burstInterval?: number;
  cooldown?: readonly [number, number];
  spread?: number;
  projectileSpeed?: number;
  thickness?: number;
  aimUp?: number;

  // Melee and special block.
  lunge?: number;
  reach?: number;
  standoff?: number;
  fuseRange?: number;
  fuseTime?: number;
  blastRadius?: number;

  // Model block, passed straight to `makeFigure`.
  blob?: BlobKind;
  bodyWidth?: number;
  headSize?: number;
  limbR?: number;
  hat?: HatKind;
  smile?: boolean;
}

/** A type that shoots on a cooldown: grunt, heavy, sniper, shieldbearer. */
export type RangedType = EnemyType
  & Required<Pick<EnemyType, 'range' | 'stop' | 'keep' | 'burst' | 'cooldown' | 'spread' | 'projectileSpeed' | 'thickness'>>;

/** A row as written below: `key` is added and `kind` and `tone` default. */
type Row = Omit<EnemyType, 'key' | 'kind' | 'tone'> & Partial<Pick<EnemyType, 'kind' | 'tone'>>;

const rows = {
  grunt: { name: 'RECRUIT', hp: 100, speed: 5.2, weapon: 'rifle', score: 100, scale: 1, range: 28, stop: 16, keep: 7, burst: 3, burstInterval: 0.15, cooldown: [1.6, 2.6], damage: 6, spread: 0.055, projectileSpeed: 36, thickness: 0.045, bodyWidth: 1, headSize: 1, limbR: 0.032, hat: 'cap' },
  rusher: { name: 'B-RUSHER', hp: 70, speed: 7.6, weapon: 'blade', score: 120, scale: 0.95, lunge: 2.9, reach: 3, standoff: 1.9, cooldown: [1, 1.5], damage: 15, bodyWidth: 0.82, headSize: 0.95, limbR: 0.027, hat: 'band', smile: true },
  heavy: { name: 'JUGGERNAUT', hp: 320, speed: 3, weapon: 'shotgun', score: 260, scale: 1.25, range: 18, stop: 9, keep: 5, burst: 7, cooldown: [2.4, 3.2], damage: 5, spread: 0.13, projectileSpeed: 32, thickness: 0.05, bodyWidth: 1.55, headSize: 0.88, limbR: 0.05, hat: 'helmet' },
  sniper: { name: 'CAMPER', hp: 60, speed: 3.6, weapon: 'sniper', score: 180, scale: 1.05, range: 90, stop: 90, keep: 15, burst: 1, cooldown: [2.8, 3.8], damage: 22, spread: 0.006, projectileSpeed: 95, thickness: 0.07, aimUp: 1.7, stationary: true, bodyWidth: 0.78, headSize: 0.92, limbR: 0.026, hat: 'hood' },
  shield: { name: 'SHIELD MAIN', hp: 150, speed: 3.8, weapon: 'pistol', score: 200, scale: 1.05, range: 20, stop: 8, keep: 4, burst: 2, burstInterval: 0.2, cooldown: [1.8, 2.6], damage: 5, spread: 0.06, projectileSpeed: 34, thickness: 0.045, bodyWidth: 1.2, headSize: 0.9, limbR: 0.042, hat: 'helmet', shield: true },
  bomber: { name: 'LIVE NADE', hp: 26, speed: 6.5, weapon: 'bomb', score: 150, scale: 0.9, tone: 2, kind: 'blob', blob: 'bomber', fuseRange: 3.4, fuseTime: 1.05, blastRadius: 4.2, damage: 24 },
  flyer: { name: 'ATTACK DRONE', hp: 40, speed: 6.2, weapon: 'dive', score: 140, scale: 1.5, kind: 'flyer', flying: true, damage: 10, cooldown: [2.8, 4.2] },
  medic: { name: 'MEDIC', hp: 80, speed: 5, weapon: 'rifle', score: 220, scale: 1, damage: 0, cap: 2, hat: 'helmet' },
  breacher: { name: 'BREACHER', hp: 200, speed: 4.6, weapon: 'shotgun', score: 260, scale: 1.1, damage: 18, shield: true, cap: 2, cooldown: [2.4, 3.2], hat: 'helmet' },
  carrier: { name: 'TURRET DROP', hp: 65, speed: 6, weapon: 'dive', score: 220, scale: 1.5, kind: 'flyer', flying: true, damage: 0 },
  turret: { name: 'SENTRY', hp: 85, speed: 0, weapon: 'sniper', score: 160, scale: 0.9, damage: 16, stationary: true, range: 65, stop: 65, keep: 0, burst: 1, cooldown: [2.8, 3.4], spread: 0.01, projectileSpeed: 65, thickness: 0.06 },
  packleader: { name: 'PACK LEADER', hp: 140, speed: 6.8, weapon: 'blade', score: 280, scale: 1.05, damage: 15, cooldown: [1.2, 1.8], cap: 1, hat: 'band' },
  smoker: { name: 'SMOKER', hp: 90, speed: 4.8, weapon: 'pistol', score: 210, scale: 1, damage: 0, hat: 'hood' },
  rubberbander: { name: 'THE RUBBERBANDER', hp: 120, speed: 5.4, weapon: 'rifle', score: 240, scale: 1, damage: 6, range: 28, stop: 14, keep: 6, burst: 3, burstInterval: 0.15, cooldown: [1.8, 2.8], spread: 0.055, projectileSpeed: 36, thickness: 0.045, hat: 'band' },
  sapper: { name: 'SAPPER', hp: 110, speed: 5, weapon: 'pistol', score: 230, scale: 1, damage: 5, range: 20, stop: 10, keep: 5, burst: 2, burstInterval: 0.2, cooldown: [2, 3], spread: 0.06, projectileSpeed: 34, thickness: 0.045, cap: 1, hat: 'helmet' },
  parry: { name: 'PARRY MAIN', hp: 110, speed: 6, weapon: 'blade', score: 230, scale: 1, damage: 15, cooldown: [1.4, 2], hat: 'hood' },
  aimbot: { name: 'THE AIMBOT', hp: 3000, speed: 0, weapon: 'sniper', score: 4000, scale: 1.6, damage: 28, boss: true, stationary: true, cooldown: [3, 3], hat: 'hood', tone: 3 },
  ragequit: { name: 'THE RAGEQUIT', hp: 4500, speed: 5.2, weapon: 'blade', score: 4400, scale: 2, damage: 28, boss: true, cooldown: [1.5, 2], hat: 'helmet', tone: 2 },
  moderator: { name: 'THE MODERATOR', hp: 3600, speed: 5, weapon: 'boss', score: 4800, scale: 2.5, damage: 30, boss: true, flying: true, kind: 'flyer', cooldown: [4, 5], tone: 5 },
  boss: { name: 'THE ADMIN', hp: 2600, speed: 3.2, weapon: 'boss', score: 2500, scale: 2.7, tone: 2, boss: true, range: 32, stop: 6, keep: 0, cooldown: [2.6, 3.6], damage: 22, bodyWidth: 1.35, headSize: 1.15, limbR: 0.06, hat: 'crown' },
  hitbox: { name: 'THE HITBOX', hp: 3400, speed: 4.2, weapon: 'boss', score: 3200, scale: 2.6, tone: 5, kind: 'blob', blob: 'hitbox', boss: true, range: 30, stop: 8, keep: 0, cooldown: [2.2, 3.2], damage: 26 },
  lagspike: { name: 'THE LAG SPIKE', hp: 3000, speed: 3, weapon: 'boss', score: 3600, scale: 2.4, tone: 2, kind: 'blob', blob: 'lagspike', boss: true, range: 34, stop: 10, keep: 0, cooldown: [2.4, 3.4], damage: 20 },
} satisfies Record<EnemyKind, Row>;

// `fromEntries` types its result as a plain string index; the rows above are
// checked against `EnemyKind` by the `satisfies` clause, so re-label it here.
export const TYPES = Object.fromEntries(
  (Object.entries(rows) as [EnemyKind, Row][]).map(([key, row]): [EnemyKind, EnemyType] =>
    [key, Object.freeze({ key, kind: 'humanoid', tone: 1, ...row })]),
) as Readonly<Record<EnemyKind, EnemyType>>;
export const BOSS_ORDER: readonly EnemyKind[] = ['boss', 'hitbox', 'lagspike', 'aimbot', 'ragequit', 'moderator'];

/** Roll the next attack delay. Only a type that never waits on one lacks a cooldown. */
export const rollCooldown = (stats: EnemyType): number =>
  stats.cooldown ? rand(stats.cooldown[0], stats.cooldown[1]) : 0;

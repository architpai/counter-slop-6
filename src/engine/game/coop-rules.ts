import type { OnlineMode } from './team-rules';

/** Co-op survival rules (docs/spec/online-coop.md). Scale values are playtest values, not measured balance. */
export const COOP = {
  MAX_PLAYERS: 4, ALIVE_CAP: 24, SNAP: 0.1, SYNC: 0.25, RESPAWN: 3.5,
  HIT_CAP: 1000, DAMAGE_CAP: 200, PUSH_CAP: 30, SNAP_ROWS: 64, SHOT_ROWS: 48, HIT_ROWS: 32, AIM_ROWS: 32,
} as const;

export const playerCap = (mode: OnlineMode | undefined): number => mode === 'coop' ? COOP.MAX_PLAYERS : 8;

export interface CoopScale { count: number; alive: number; interval: number; bossHp: number; pickups: number }
/** How a wave grows with the players in the run. One player is solo, unchanged. */
export function coopScale(players: number): CoopScale {
  const extra = Math.max(1, Math.min(COOP.MAX_PLAYERS, Math.floor(players) || 1)) - 1;
  return { count: 1 + 0.5 * extra, alive: 3 * extra, interval: 1 + 0.25 * extra, bossHp: 1 + 0.6 * extra, pickups: 3 * extra };
}

/** Start slots as x/z offsets from the solo player start. */
export const START_SLOTS: readonly (readonly [number, number])[] = [[0, 0], [1.6, 0], [-1.6, 0], [0, 1.6]];

/** Host-owned run state. Clients read wave start, wave clear and their own return from its changes. */
export interface CoopState {
  wave: number;
  /** Alive plus queued enemies. */
  left: number;
  /** Seconds to the next wave; zero during a wave. */
  inter: number;
  /** Team score. */
  score: number;
  /** Peer ids of the players who are down. */
  dead: string[];
  /** HUD modifier line and wave subtitle. */
  label: string;
  sub: string;
  /** Enemy speed and damage modifiers of the wave. */
  speed: number;
  damage: number;
}

export const freshCoopState = (wave: number): CoopState =>
  ({ wave, left: 0, inter: 0, score: 0, dead: [], label: '', sub: '', speed: 1, damage: 1 });

const KEYS = ['wave', 'left', 'inter', 'score', 'dead', 'label', 'sub', 'speed', 'damage'];
const count = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const real = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const line = (v: unknown): v is string => typeof v === 'string' && v.length <= 96;

export function validCoopState(v: unknown): v is CoopState {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>, dead = s.dead;
  return Object.keys(s).length === KEYS.length && KEYS.every(k => Object.hasOwn(s, k)) &&
    count(s.wave, 100000) && s.wave >= 1 && count(s.left, 10000) && real(s.inter, 0, 60) && count(s.score, Number.MAX_SAFE_INTEGER) &&
    Array.isArray(dead) && dead.length <= COOP.MAX_PLAYERS && new Set(dead).size === dead.length &&
    dead.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128) &&
    line(s.label) && line(s.sub) && real(s.speed, 0.1, 10) && real(s.damage, 0.1, 10);
}

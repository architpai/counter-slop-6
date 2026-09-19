export type OnlineMode = 'ffa' | 'tdm' | 'flag';
export type Team = 0 | 1;
export type Point = [number, number, number];

export const ONLINE_MODES = [
  { key: 'ffa', name: 'Solo Deathmatch', blurb: 'First to 20 kills · every player for themselves' },
  { key: 'tdm', name: 'Team Deathmatch', blurb: 'Red vs Blue · up to 4v4 · first to 40 kills' },
  { key: 'flag', name: 'Flag Hold', blurb: 'Red vs Blue · steal, place, defend for 30 seconds' },
] as const;
export const TEAM_NAMES = ['RED', 'BLUE'] as const;
export const TEAM_RULES = { MATCH: 480, ROUND: 150, HOLD: 30, BREAK: 5, WAVE: 8, RETURN: 15, KILLS: 40 } as const;

export interface TeamLayout {
  neutral: Point;
  bases: [Point, Point];
  spawns: [Point[], Point[]];
}

/** Host-owned objective, clock, score and respawn state. Positions still belong to each peer. */
export interface TeamMatch {
  mode: 'tdm' | 'flag';
  scores: [number, number];
  elapsed: number;
  round: number;
  roundLeft: number;
  breakLeft: number;
  overtime: boolean;
  streakTeam: Team | null;
  streak: number;
  winner: Team | null;
  /** Peer id -> next host-clock respawn time. */
  dead: Record<string, number>;
  flag: { carrier: string | null; placed: Team | null; pos: Point; holdLeft: number; returnLeft: number };
}

export const isOnlineMode = (value: unknown): value is OnlineMode => value === 'ffa' || value === 'tdm' || value === 'flag';
export const isTeam = (value: unknown): value is Team => value === 0 || value === 1;

export function assignTeams(ids: string[], previous: Record<string, Team> = {}): Record<string, Team> {
  const teams: Record<string, Team> = Object.create(null);
  const sizes = [0, 0];
  for (const id of ids.slice(0, 8)) {
    const team = previous[id];
    if (isTeam(team) && (sizes[team] ?? 0) < 4) { teams[id] = team; sizes[team] = (sizes[team] ?? 0) + 1; }
  }
  for (const id of ids.slice(0, 8)) {
    if (Object.hasOwn(teams, id)) continue;
    const team = (sizes[0] ?? 0) <= (sizes[1] ?? 0) ? 0 : 1;
    teams[id] = team; sizes[team] = (sizes[team] ?? 0) + 1;
  }
  return teams;
}

const freshFlag = (neutral: Point): TeamMatch['flag'] => ({ carrier: null, placed: null, pos: [...neutral], holdLeft: TEAM_RULES.HOLD, returnLeft: 0 });
export function createTeamMatch(mode: 'tdm' | 'flag', neutral: Point): TeamMatch {
  return { mode, scores: [0, 0], elapsed: 0, round: 1, roundLeft: TEAM_RULES.ROUND, breakLeft: 0,
    overtime: false, streakTeam: null, streak: 0, winner: null, dead: Object.create(null), flag: freshFlag(neutral) };
}

export function markDead(state: TeamMatch, id: string): boolean {
  if (state.winner !== null || state.breakLeft > 0 || Object.hasOwn(state.dead, id)) return false;
  state.dead[id] = (Math.floor(state.elapsed / TEAM_RULES.WAVE) + 1) * TEAM_RULES.WAVE;
  return true;
}

export function scoreTeam(state: TeamMatch, team: Team): void {
  if (state.winner !== null) return;
  state.scores[team]++;
  if (state.mode === 'tdm') {
    if (state.scores[team] >= TEAM_RULES.KILLS || state.overtime) state.winner = team;
  } else if (state.overtime) {
    state.streak = state.streakTeam === team ? state.streak + 1 : 1;
    state.streakTeam = team;
    if (state.streak >= 2) state.winner = team;
  } else if (state.scores[team] >= 5 || state.scores[team] - state.scores[team === 0 ? 1 : 0] >= 3) state.winner = team;
}

export function dropFlag(state: TeamMatch, carrier: string, position: Point): void {
  if (state.flag.carrier !== carrier) return;
  state.flag = { carrier: null, placed: null, pos: [...position], holdLeft: TEAM_RULES.HOLD, returnLeft: TEAM_RULES.RETURN };
}

export interface FlagPlayer { id: string; team: Team; pos: Point; alive: boolean }
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Proximity pickup/placement; the host also requires a clear path through world geometry. */
export function interactFlag(state: TeamMatch, players: FlagPlayer[], layout: TeamLayout,
  canReach: (a: Point, b: Point) => boolean): void {
  if (state.mode !== 'flag' || state.winner !== null || state.breakLeft > 0) return;
  const flag = state.flag;
  const living = players.filter(p => p.alive && !Object.hasOwn(state.dead, p.id));
  if (flag.carrier !== null) {
    const carrier = living.find(p => p.id === flag.carrier);
    if (!carrier) { dropFlag(state, flag.carrier, flag.pos); return; }
    flag.pos = [...carrier.pos];
    const base = layout.bases[carrier.team];
    if (distance(carrier.pos, base) <= 2.5 && canReach(carrier.pos, base)) {
      flag.carrier = null; flag.placed = carrier.team; flag.pos = [...base]; flag.holdLeft = TEAM_RULES.HOLD;
    }
    return;
  }
  const taker = living.filter(p => p.team !== flag.placed && distance(p.pos, flag.pos) <= 1.8 && canReach(p.pos, flag.pos))
    .sort((a, b) => distance(a.pos, flag.pos) - distance(b.pos, flag.pos))[0];
  if (taker) {
    flag.carrier = taker.id; flag.placed = null; flag.pos = [...taker.pos]; flag.holdLeft = TEAM_RULES.HOLD; flag.returnLeft = 0;
  }
}

/** Advance every crossed phase boundary; a delayed frame must not extend a round or break. */
export function advanceTeamMatch(state: TeamMatch, dt: number, layout: TeamLayout): void {
  if (!Number.isFinite(dt) || dt < 0 || state.winner !== null) return;
  let remaining = dt;
  while (remaining > 0 && state.winner === null) {
    const matchLeft = state.overtime ? Infinity : Math.max(0, TEAM_RULES.MATCH - state.elapsed);
    const flag = state.flag, inBreak = state.breakLeft > 0;
    const phaseLeft = state.mode === 'tdm' ? Infinity : inBreak ? state.breakLeft
      : Math.min(state.roundLeft, flag.placed !== null ? flag.holdLeft : flag.returnLeft > 0 ? flag.returnLeft : Infinity);
    const step = Math.min(remaining, matchLeft, phaseLeft);
    state.elapsed += step; remaining -= step;
    for (const [id, until] of Object.entries(state.dead)) if (until <= state.elapsed) delete state.dead[id];
    if (state.mode === 'flag') {
      if (inBreak) {
        state.breakLeft = Math.max(0, state.breakLeft - step);
        if (state.breakLeft === 0) {
          state.round++; state.roundLeft = TEAM_RULES.ROUND;
          state.flag = freshFlag(layout.neutral); state.dead = Object.create(null);
        }
      } else {
        state.roundLeft = Math.max(0, state.roundLeft - step);
        if (flag.placed !== null) {
          flag.holdLeft = Math.max(0, flag.holdLeft - step);
          if (flag.holdLeft === 0) { scoreTeam(state, flag.placed); state.breakLeft = TEAM_RULES.BREAK; }
        } else if (flag.returnLeft > 0) {
          flag.returnLeft = Math.max(0, flag.returnLeft - step);
          if (flag.returnLeft === 0) state.flag = freshFlag(layout.neutral);
        }
        if (state.roundLeft === 0) state.breakLeft = TEAM_RULES.BREAK;
      }
    }
    if (!state.overtime && state.elapsed >= TEAM_RULES.MATCH && state.winner === null) {
      if (state.scores[0] !== state.scores[1]) state.winner = state.scores[0] > state.scores[1] ? 0 : 1;
      else {
        state.overtime = true; state.streak = 0; state.streakTeam = null;
        if (state.mode === 'flag') {
          // Overtime starts a fresh neutral contest; no partial hold carries over.
          state.round++; state.roundLeft = TEAM_RULES.ROUND; state.breakLeft = 0;
          state.flag = freshFlag(layout.neutral); state.dead = Object.create(null);
        }
      }
    }
  }
}

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const bounded = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => bounded(v, max) && Number.isSafeInteger(v);
const peerId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const point = (v: unknown): v is Point => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000);
export function validTeams(v: unknown): v is Record<string, Team> {
  if (!object(v)) return false;
  const entries = Object.entries(v);
  return entries.length <= 8 && entries.every(([id, team]) => peerId(id) && isTeam(team)) &&
    [0, 1].every(team => entries.filter(([, t]) => t === team).length <= 4);
}
/** Used at both the transport boundary and the game handler. No unchecked objective payloads. */
export function validTeamMatch(v: unknown): v is TeamMatch {
  if (!object(v) || (v.mode !== 'tdm' && v.mode !== 'flag') || !object(v.flag) || !object(v.dead)) return false;
  const f = v.flag;
  return Array.isArray(v.scores) && v.scores.length === 2 && v.scores.every(n => integer(n)) &&
    bounded(v.elapsed, Number.MAX_SAFE_INTEGER) && integer(v.round) && v.round >= 1 &&
    bounded(v.roundLeft, TEAM_RULES.ROUND) && bounded(v.breakLeft, TEAM_RULES.BREAK) &&
    typeof v.overtime === 'boolean' && (v.streakTeam === null || isTeam(v.streakTeam)) && integer(v.streak, 2) &&
    (v.winner === null || isTeam(v.winner)) && Object.keys(v.dead).length <= 8 &&
    Object.entries(v.dead).every(([id, until]) => peerId(id) && bounded(until, Number.MAX_SAFE_INTEGER)) &&
    (f.carrier === null || peerId(f.carrier)) && (f.placed === null || isTeam(f.placed)) &&
    !(f.carrier !== null && f.placed !== null) && point(f.pos) && bounded(f.holdLeft, TEAM_RULES.HOLD) && bounded(f.returnLeft, TEAM_RULES.RETURN);
}

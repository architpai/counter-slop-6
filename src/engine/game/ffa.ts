import * as THREE from 'three';
import { angleLerp, choose, shuffle, round1, round2, clamp, lerp } from '../util';
import { RemotePlayer, encodeState } from '../players';
import { validKey } from '../level/index';
import { TONE, VIEW_MODEL_FOV } from '../render/index';
import { GUN_STATS } from '../weapons/stats';
import { SWORD_PVP_DAMAGE } from '../weapons/sword';
import { WAVE_PVP_DAMAGE } from '../weapons/wave';
import type { Gun } from '../weapons/index';
import { GRENADE_PVP_MAX, MAX_THROW_SPEED } from '../player/grenades';
import type { BoardRow, OnlineInfo } from '../hud/screens';
import { advanceTeamMatch, assignTeams, createTeamMatch, dropFlag, interactFlag, isOnlineMode, isTeam, isTeamMode, markDead, ONLINE_MODES, scoreTeam, TEAM_NAMES, TEAM_RULES, validTeamMatch, validTeams } from './team-rules';
import type { OnlineMode, Point, Team, TeamMatch } from './team-rules';
import { createTeamWorld, teamLayout } from './team-world';
import { MARK_GAP, MARK_RANGE, placeMark, pruneMarks, type Mark } from './marks';
import { stragglerMark } from './stragglers';
import { seeThrough } from '../physics';
import { COOP, freshCoopState, playerCap, validCoopState } from './coop-rules';
import type { CoopState } from './coop-rules';
import type { HitInfo, PlayerHit, ScoreRow, Target } from '../types';
import type { PeerMeta } from '../net';
import type { App } from '../boot';

const KILL_TARGET = 20, TIME_LIMIT = 480, RESPAWN = 3.5, SILENT_MS = 9000;
// 20 Hz matches the 80 ms interpolation delay remotes render at (see players.ts).
const PS_INTERVAL = 0.05;
// Host trusts a `take` only within this radius of the sender's avatar. Generous
// vs the 1.5 m local collect: remotes render ~80 ms behind. ponytail: shrink if stealable.
const TAKE_RANGE = 4;
const HOW: Record<string, string> = { r4c: 'R4-C', rifle: 'MP5', pistol: '.50 pistol', shotgun: 'shotgun', sniper: 'sniper', lmg: 'LMG', melee: 'sword', wave: 'air slash', grenade: 'grenade', deflect: 'their own bullet' };

/** Most one `pdmg` packet may claim per source: a point-blank headshot with every pellet, and the gun's best bonus. */
const PVP_CAP: Record<string, number> = { melee: SWORD_PVP_DAMAGE, wave: WAVE_PVP_DAMAGE, grenade: GRENADE_PVP_MAX };
for (const [kind, g] of Object.entries(GUN_STATS)) PVP_CAP[kind] = g.pvp[0] * g.pvp[1] * g.pellets * Math.max(g.airBonus, g.quickdraw?.[1] ?? 1);
/** When each peer last reported its own death, so one body cannot be counted every frame. */
const lastDeath = new Map<string, number>();

const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const num = (v: unknown, lim: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const triple = (v: unknown, lim = 10000): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => num(n, lim));
const vec = (a: number[]): THREE.Vector3 => new THREE.Vector3().fromArray(a);
const cleanName = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 14) : '') || 'recruit';

export interface FfaApi {
  selectMode(mode: OnlineMode): void;
  requestTeam(team: Team): void;
  onlineInfo(): OnlineInfo;
  dispose(): void;
  create(isPublic: boolean): Promise<void>;
  join(code: string): Promise<void>;
  quickPlay(): Promise<void>;
  hostStart(): void;
  leave(reason?: string): void;
  lobbyScreen(): void;
  broadcastLobby(): void;
  localDeath(): void;
  updateDying(dt: number): void;
  updateOver(dt: number): void;
  update(dt: number, t?: number): void;
  refreshScoreHud(): void;
  /** Host: send the score rows to every peer. */
  sendScores(): void;
  endMatch(winner: { id: string; name: string }): void;
  /** Put the local player back in play at its mode's spawn. */
  respawn(protect?: boolean): void;
  showBoard(on: boolean): void;
  boardRows(): BoardRow[];
  targets(): Target[];
  canHurt(t: Target): boolean;
  raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null;
  /** The figure to leave out of this frame: a first-person spectator looks out of it. */
  watchedFigure(): THREE.Object3D | null;
  playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[];
  hitPlayer(t: RemotePlayer, damage: number, info?: HitInfo): void;
  cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean;
  onShot(end: THREE.Vector3): void;
}

export function createFFA(app: App): FfaApi {
  const { ctx, gs, lobby, scores } = app;
  const { net, hud } = ctx;
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), d3 = new THREE.Vector3();
  let psT = 0;
  /** Who a waiting player watches, through their eyes or not, and the yaw the shoulder view has swung to. */
  let watching: string | null = null, firstPerson = false, watchYaw = 0;
  let shotQueue: number[] = [];
  /** Squad marks by player id, and the time until the local player may mark again. */
  const marks = new Map<string, Mark>();
  let markGap = 0;
  let boardShown = false;
  let timer: number | undefined = undefined;
  let hitId = 0;
  let teamWorld: ReturnType<typeof createTeamWorld> | null = null;
  let lastClock = 0, syncT = 0;
  let seenDead = false, deathMessage = '';
  /** A co-op join in a wave: down from the start, in at the wave clear. */
  let joinWait = false;
  const ready = new Set<string>();
  const pendingHeadshots = new Map<number, { target: string; source: string; until: number }>();

  const isOnline = (): boolean => gs.mode === 'ffa';
  const playing = (): boolean => gs.state === 'play' || gs.state === 'dying';
  const inMatch = (): boolean => net.active && (playing() || gs.state === 'over');
  const now = (): number => performance.now() / 1000;
  const spots = (): THREE.Vector3[] => ctx.level.arenaSpawns.length ? ctx.level.arenaSpawns : ctx.level.spawns;
  const rows = (): ScoreRow[] => [...scores].map(([rid, r]) => ({ id: rid, name: r.name, kills: r.kills, deaths: r.deaths }));
  const sorted = (): ScoreRow[] => rows().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const boardRows = (): BoardRow[] => rows().map(r => ({ ...r, self: r.id === net.id, team: lobby.teams?.[r.id] }));
  const mode = (): OnlineMode => lobby.mode ?? 'ffa';
  const teamMode = (): boolean => isTeamMode(mode());
  const coop = (): boolean => mode() === 'coop';
  const teamOf = (rid: string | null): Team | undefined => rid === null ? undefined : lobby.teams?.[rid];
  const opponents = (a: string | null, b: string | null): boolean => mode() === 'ffa' ||
    (isTeam(teamOf(a)) && isTeam(teamOf(b)) && teamOf(a) !== teamOf(b));
  /** Co-op: everyone. Team modes: the same team. Deathmatch has no squad. */
  const squadmate = (rid: string | null): boolean => coop() || (teamMode() && isTeam(teamOf(rid)) && teamOf(rid) === teamOf(net.id));
  const activeCombat = (): boolean => playing() && !gs.over && !(gs.teamMatch && gs.teamMatch.breakLeft > 0);
  const roundTag = () => gs.teamMatch ? { round: gs.teamMatch.round } : {};
  const currentRound = (d: Record<string, unknown>): boolean => !gs.teamMatch || d.round === gs.teamMatch.round;
  // Objective checks use the latest packet, not the delayed render interpolation.
  const positionOf = (rid: string): THREE.Vector3 | undefined => rid === net.id ? ctx.player?.body.pos
    : ctx.remotes.get(rid)?._b?.p ?? ctx.remotes.get(rid)?.body.pos;
  const clockText = (seconds: number): string => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  function onlineInfo(): OnlineInfo {
    const state = gs.teamMatch;
    if (!state) return coop() ? app.coop.info() : { mode: mode() };
    const match = state.overtime ? 'OVERTIME' : `MATCH ${clockText(TEAM_RULES.MATCH - state.elapsed)}`;
    let status = `${match} · next wave ${Math.max(1, Math.ceil(TEAM_RULES.WAVE - state.elapsed % TEAM_RULES.WAVE))}s`;
    if (state.mode === 'flag') {
      const f = state.flag;
      const objective = state.breakLeft > 0 ? `NEXT ROUND ${Math.ceil(state.breakLeft)}s`
        : f.carrier ? `${nameOf(f.carrier) ?? 'PLAYER'} CARRIES THE FLAG`
        : f.placed !== null ? `${TEAM_NAMES[f.placed]} HOLD ${Math.ceil(f.holdLeft)}s`
        : f.returnLeft > 0 ? `FLAG DROPPED · returns in ${Math.ceil(f.returnLeft)}s` : 'TAKE THE NEUTRAL FLAG';
      status = `${match} · ROUND ${state.round} ${clockText(state.roundLeft)} · ${objective}`;
      if (state.overtime) status += ` · ${state.streakTeam === null ? 'WIN 2 IN A ROW' : `${TEAM_NAMES[state.streakTeam]} STREAK ${state.streak}/2`}`;
    }
    if (gs.over) status = `${gs.over.name} WINS${state.overtime ? ' · OVERTIME' : ''}`;
    return { mode: state.mode, teamScores: [...state.scores], selfTeam: teamOf(net.id), status };
  }
  function applyTeams(): void {
    const team = teamOf(net.id);
    if (ctx.player) ctx.player.team = isTeam(team) && teamMode() ? team + 1 : 0;
    for (const [rid, r] of ctx.remotes) {
      const team = teamOf(rid);
      r.setTeam(isTeam(team) && teamMode() ? team + 1 : 0);
    }
  }
  function selectMode(value: OnlineMode): void {
    if (!isOnlineMode(value) || app.busy || (gs.state !== 'start' && gs.state !== 'lobby')) return;
    if (gs.state === 'lobby' && (!net.isHost || lobby.isPublic)) return;
    lobby.mode = value; net.maxPlayers = playerCap(value);
    lobby.teams = isTeamMode(value) ? assignTeams([...lobby.players.keys()]) : {};
    applyTeams();
    if (gs.state === 'lobby') broadcastLobby();
  }
  /** A player's own choice of side, in the lobby only. The host applies it; a full side refuses. */
  function setTeam(rid: string, team: unknown): void {
    if (!net.isHost || gs.state !== 'lobby' || !teamMode() || !isTeam(team) || !lobby.players.has(rid) ||
        teamOf(rid) === team || Object.values(lobby.teams).filter(t => t === team).length >= 4) return;
    lobby.teams[rid] = team;
    applyTeams(); broadcastLobby();
  }
  function requestTeam(team: Team): void {
    if (!net.isHost) net.send('teamreq', { team });
    else if (net.id) setTeam(net.id, team);
  }
  const nameOf = (rid: string): string | undefined => scores.get(rid)?.name ?? lobby.players.get(rid) ?? ctx.remotes.get(rid)?.name;

  // ---- remotes
  function addRemote(rid: string, name: string): RemotePlayer {
    const known = ctx.remotes.get(rid), r = known ?? new RemotePlayer(ctx, rid, name, 0, TONE.HOSTILE);
    if (known) known.name = name;
    else {
      const team = teamOf(rid);
      r.setTeam(isTeam(team) && teamMode() ? team + 1 : 0);
    }
    // Co-op: an enemy on the host hurt or pushed this player; the host tells its owner.
    r.onKnock = (dir, amount) => { if (coop()) app.coop.push(rid, dir, amount); };
    r.onDamage = (amount, from) => {
      if (coop()) { app.coop.hurt(rid, amount, from); return; }
      if (!canHurt(r) || !r.alive) return;
      hud.hitmarker(false, false);
      net.sendTo(rid, 'pdmg', { amount: Math.round(amount), from: from ? from.toArray().map(round1) : null, by: net.id, src: 'grenade', crit: false, ...roundTag() });
    };
    ctx.remotes.set(rid, r);
    return r;
  }
  function removeRemote(rid: string): void {
    if (net.isHost) releaseFlag(rid);
    if (gs.teamMatch) delete gs.teamMatch.dead[rid];
    if (lobby.teams) delete lobby.teams[rid];
    ready.delete(rid);
    ctx.remotes.get(rid)?.dispose();
    ctx.remotes.delete(rid); lobby.players.delete(rid); scores.delete(rid);
    if (coop()) app.coop.left(rid);
  }

  // ---- scores
  function refreshScoreHud(): void {
    if (!isOnline()) return;
    // Co-op keeps the solo wave block: no PvP panel, and the wave modifier stays.
    if (coop()) hud.setPvpScore(null);
    else { hud.setPvpScore({ rows: boardRows(), selfId: net.id ?? '', ...onlineInfo() }); hud.setModifier(''); }
    if (boardShown) hud.setBoard({ rows: boardRows(), code: net.code ?? lobby.code ?? '', ...onlineInfo() });
  }
  function showBoard(on: boolean): void {
    if (on === boardShown) return;
    boardShown = on;
    hud.setBoard(on ? { rows: boardRows(), code: net.code ?? lobby.code ?? '', ...onlineInfo() } : null);
  }
  function applyScores(list: unknown[]): void {
    scores.clear();
    for (const r of list) {
      if (!obj(r) || !id(r.id) || !str(r.name, 14) || !int(r.kills) || !int(r.deaths)) continue;
      scores.set(r.id, { id: r.id, name: r.name, kills: r.kills, deaths: r.deaths });
    }
    refreshScoreHud();
  }
  function sendScores(): void { const list = rows(); net.send('score', list); applyScores(list); }
  function tally(victim: string, killer: string | null): void {
    if (!net.isHost || !activeCombat()) return;
    const state = gs.teamMatch;
    if (state && !markDead(state, victim)) return;
    if (state) releaseFlag(victim);
    const v = scores.get(victim); if (v) v.deaths++;
    const k = killer && killer !== victim && opponents(killer, victim) ? scores.get(killer) : null;
    if (k) {
      k.kills++;
      const team = teamOf(k.id);
      if (state?.mode === 'tdm' && isTeam(team)) scoreTeam(state, team);
    }
    if (state) sendTeamState();
    sendScores(); checkWin();
  }
  function checkWin(): void {
    if (!net.isHost || !isOnline() || gs.over || coop()) return;
    let winner: { id: string; name: string } | null = null;
    if (gs.teamMatch) {
      const team = gs.teamMatch.winner;
      if (team !== null) winner = { id: `team:${team}`, name: `${TEAM_NAMES[team]} TEAM` };
    } else for (const [rid, r] of scores) if (r.kills >= KILL_TARGET) winner = { id: rid, name: r.name };
    if (!winner) return;
    net.send('end', winner); endMatch(winner);
  }
  function endMatch(winner: { id: string; name: string }): void {
    gs.over = winner; gs.overT = 0; gs.state = 'over'; hud.setSpectate('');
    if (ctx.player) ctx.player.watched = null;
    teamWorld?.dispose(); teamWorld = null;
    app.endFocus(); ctx.input.exitLock(); showBoard(false);
    hud.setGameplayVisible(false); app.showScreen('over');
  }

  // ---- lobby
  const errMessage = (e: unknown): string | undefined => {
    const m = e instanceof Error ? e.message : undefined;
    return typeof m === 'string' ? m : undefined;
  };
  const friendly = (m: unknown): string => {
    if (typeof m !== 'string') return 'something went wrong';
    if (m.includes('networking library')) return 'could not load the networking library · check your connection and reload';
    if (m.includes('timed out') || m.includes('signalling')) return 'could not reach the matchmaking server · check your connection';
    if (m.includes('no lobby with that code')) return 'no lobby with that code · check it with your friend';
    if (m.includes('no answer')) return 'found the lobby but could not connect · one of you may be on a network that blocks it';
    if (m.includes('full')) return 'that lobby is full';
    return m;
  };
  const online = (status: string): void => { lobby.status = status; if (gs.state === 'start') app.showScreen('online'); };
  function enterLobby(isPublic: boolean): void {
    lobby.isPublic = isPublic; lobby.code = net.code; lobby.status = '';
    if (inMatch()) return;
    gs.state = 'lobby'; app.showScreen('lobby');
  }
  async function attempt(fn: () => Promise<void>): Promise<void> {
    if (app.busy) return;
    app.busy = true;
    try { await fn(); } catch (e: unknown) { online(friendly(errMessage(e))); }
    finally { app.busy = false; if (gs.state === 'start') app.showScreen('online'); }
  }
  const create = (isPublic: boolean): Promise<void> => attempt(async () => {
    online('opening a lobby…');
    await net.host({ isPublic, mode: mode() });
    // Set on every live path; the guard is there for the type.
    const self = net.id;
    if (self === null) { online('something went wrong'); return; }
    lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(self, app.settings.name); lobby.hostId = self;
    lobby.teams = teamMode() ? assignTeams([self]) : {};
    applyTeams(); enterLobby(isPublic);
  });
  const join = (code: string): Promise<void> => attempt(async () => {
    if (!code) { online('type the code your friend gave you'); return; }
    online('connecting…');
    await net.join(code, { name: app.settings.name });
    enterLobby(net.isPublic);
  });
  const quickPlay = (): Promise<void> => attempt(async () => {
    try {
      await net.quickJoin({ name: app.settings.name }, online, mode());
      enterLobby(true);
    } catch (e: unknown) {
      if (!(errMessage(e) ?? '').includes('no open public')) throw e;
      online('no open lobbies · opening a public one for you…');
      await net.host({ isPublic: true, mode: mode() });
      const self = net.id;
      if (self === null) { online('something went wrong'); return; }
      lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(self, app.settings.name); lobby.hostId = self;
      lobby.teams = teamMode() ? assignTeams([self]) : {};
      applyTeams(); enterLobby(true);
    }
  });
  function broadcastLobby(): void {
    net.send('lobby', { players: [...lobby.players].map(([pid, name]) => ({ id: pid, name })), hostId: net.id, isPublic: lobby.isPublic,
      map: lobby.map ?? app.settings.mapKey, mode: mode(), teams: lobby.teams ?? {} });
    if (gs.state === 'lobby') app.showScreen('lobby');
  }
  function peerJoined(pid: string, meta: PeerMeta): void {
    const name = cleanName(meta?.name);
    lobby.players.set(pid, name);
    if (teamMode()) lobby.teams = assignTeams([...lobby.players.keys()], lobby.teams);
    addRemote(pid, name); applyTeams(); broadcastLobby();
    if (!inMatch()) return;
    if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const run = coop() ? app.coop.state : null;
    if (run) app.coop.admit(pid);
    net.sendTo(pid, 'start', { late: true, spawn: run ? lobby.players.size - 1 : farthestIndex(), map: lobby.map ?? app.settings.mapKey,
      mode: mode(), teams: lobby.teams ?? {}, ...(gs.teamMatch ? { teamState: gs.teamMatch } : {}), ...(run ? { coop: run } : {}),
      broken: ctx.level.breakables.filter(b => !b.alive).map(b => b.id) });
    if (run) app.coop.joined(pid);
    sendScores();
    if (gs.over) net.sendTo(pid, 'end', gs.over);
    hud.kill(`${name} joined`);
  }
  function peerLeft(pid: string): void {
    const name = nameOf(pid) ?? 'someone';
    removeRemote(pid);
    if (!inMatch() && teamMode()) { lobby.teams = assignTeams([...lobby.players.keys()], lobby.teams); applyTeams(); }
    broadcastLobby();
    if (inMatch()) { hud.kill(`${name} left`); sendScores(); sendTeamState(); }
  }
  function dispose(): void {
    window.clearTimeout(timer);
    pendingHeadshots.clear(); ready.clear(); shotQueue = []; lastDeath.clear();
    teamWorld?.dispose(); teamWorld = null;
    marks.clear(); hud.setMarks([]);
    watching = null; hud.setSpectate('');
    if (ctx.player) ctx.player.watched = null;
  }
  function leave(reason = ''): void {
    dispose();
    net.leave();
    for (const rid of [...ctx.remotes.keys()]) removeRemote(rid);
    lobby.players.clear(); lobby.teams = {}; scores.clear(); showBoard(false);
    gs.teamMatch = null; app.coop.reset();
    if (gs.state !== 'start') {
      gs.state = 'start'; gs.mode = 'solo'; app.loadLevel(false); app.resetRun(); hud.setGameplayVisible(false);
    }
    gs.menu = false; lobby.status = reason; app.showScreen('online');
  }
  function lobbyScreen(): void {
    dispose(); gs.teamMatch = null; app.coop.reset();
    if (net.isHost && teamMode()) lobby.teams = assignTeams([...lobby.players.keys()], lobby.teams);
    applyTeams();
    app.loadLevel(true, lobby.map ?? app.settings.mapKey); app.resetRun();
    gs.state = 'lobby'; gs.over = null; gs.menu = false;
    hud.setGameplayVisible(false); showBoard(false); app.showScreen('lobby');
    if (net.isHost) broadcastLobby();
  }

  // ---- match
  function arenaSpawn(): THREE.Vector3 {
    const list = spots().map(p => {
      let d = 999;
      for (const r of ctx.remotes.values()) if (r.alive && r.visible) d = Math.min(d, p.distanceTo(r.body.pos));
      return { p, d };
    }).sort((a, b) => b.d - a.d);
    return (choose(list.slice(0, 3))?.p ?? ctx.level.playerStart).clone();
  }
  function farthestIndex(): number {
    const player = ctx.player;
    const bodies = player === null ? [] : [player.body.pos, ...[...ctx.remotes.values()].filter(r => r.alive).map(r => r.body.pos)];
    let best = 0, bestD = -1;
    spots().forEach((p, i) => {
      const d = bodies.reduce((m, b) => Math.min(m, p.distanceTo(b)), 999);
      if (d > bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function hostStart(): void {
    if (!net.isHost || gs.state !== 'lobby') return;
    lobby.teams = teamMode() ? assignTeams([...lobby.players.keys()], lobby.teams) : {};
    if (teamMode() && new Set(Object.values(lobby.teams)).size < 2) {
      lobby.status = 'team modes need a player on each team'; app.showScreen('lobby'); return;
    }
    if (coop() && lobby.players.size > COOP.MAX_PLAYERS) {
      lobby.status = `co-op is for ${COOP.MAX_PLAYERS} players or fewer`; app.showScreen('lobby'); return;
    }
    dispose();
    applyTeams(); broadcastLobby();
    scores.clear();
    for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const map = lobby.map ?? app.settings.mapKey;
    // Co-op plays the solo layout: its enemy spawns, nav and boss perches are tuned for it.
    app.loadLevel(!coop(), map);
    // Co-op start slots are the lobby order; the arena modes shuffle their spawn points.
    const order = coop() ? [...lobby.players.keys()].map((_, slot) => slot) : shuffle([...spots().keys()]);
    const spawns: Record<string, number> = {};
    let i = 0;
    for (const pid of lobby.players.keys()) spawns[pid] = order.length ? order[i++ % order.length] ?? 0 : 0;
    const selected = mode();
    const state = isTeamMode(selected) ? createTeamMatch(selected, teamLayout(ctx.level).neutral) : null;
    const run = selected === 'coop' ? freshCoopState(app.settings.startWave) : null;
    net.send('start', { spawns, map, mode: selected, teams: lobby.teams, ...(state ? { teamState: state } : {}), ...(run ? { coop: run } : {}) });
    const self = net.id;
    startMatch(false, self === null ? null : spawns[self] ?? null, state, run); sendScores();
  }
  function startMatch(late: boolean, index: number | null, teamState: TeamMatch | null = null, run: CoopState | null = null): void {
    dispose();
    gs.mode = 'ffa'; app.loadLevel(!run, lobby.map ?? app.settings.mapKey); app.resetRun();
    gs.teamMatch = teamState; gs.matchT = teamState?.elapsed ?? 0;
    lastClock = now(); syncT = 0; psT = 0; seenDead = false; deathMessage = ''; joinWait = false;
    applyTeams();
    if (net.id) ready.add(net.id);
    if (teamState) teamWorld = createTeamWorld(ctx);
    if (!scores.size) for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const player = ctx.player;
    if (player === null) return;
    const spot = typeof index === 'number' && Number.isInteger(index) ? spots()[index] ?? null : null;
    player.reset(teamState ? teamSpawn(net.id) : run ? app.coop.slot(index ?? 0) : spot ? spot.clone() : arenaSpawn());
    faceCenter();
    player.shieldT = late ? 2 : 0;
    app.beginCommon(); gs.state = 'play';
    refreshScoreHud();
    const choice = ONLINE_MODES.find(m => m.key === mode()) ?? ONLINE_MODES[0];
    hud.message(choice.name.toUpperCase(), late ? 'you joined a match in progress' : choice.blurb, 3);
    if (teamState) sendPlayerState();
    // After the mode message: the first wave's own message replaces it on the host.
    if (run) app.coop.begin(run, index ?? 0);
    if (run && net.id !== null && app.coop.isDown(net.id)) {
      // The host put this join on the down list: it watches the wave and comes in at the clear, as a player who is down does.
      player.alive = false; player.aiming = player.firing = false;
      gs.state = 'dying'; gs.deathT = 0; gs.respawnT = COOP.RESPAWN; joinWait = true;
    }
    hud.tip(ctx.input.usingTouch ? 'Open Menu for the scoreboard. The match keeps running.' : `hold ${hud.key('score')} for the scoreboard`, 5);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (gs.state === 'play' && !ctx.input.locked && !ctx.input.usingGamepad && !ctx.input.usingTouch) { gs.menu = true; app.showScreen('matchOn'); }
    }, 250);
  }
  function teamSpawn(rid: string | null): THREE.Vector3 {
    const team = teamOf(rid);
    if (!isTeam(team)) return arenaSpawn();
    const list = teamLayout(ctx.level).spawns[team];
    const members = [...lobby.players.keys()].filter(id => teamOf(id) === team);
    const index = Math.max(0, members.indexOf(rid ?? ''));
    const enemies = [...ctx.remotes.values()].filter(r => r.alive && opponents(rid, r.id));
    const ranked = list.map(p => ({ p, distance: enemies.reduce((d, r) => Math.min(d, vec(p).distanceTo(r.body.pos)), 999) }))
      .sort((a, b) => b.distance - a.distance);
    return vec(ranked[index % ranked.length]?.p ?? teamLayout(ctx.level).bases[team]);
  }
  function faceCenter(): void {
    const p = ctx.player;
    if (!p || !gs.teamMatch) return;
    const center = teamLayout(ctx.level).neutral;
    p.yaw = Math.atan2(p.body.pos.x - center[0], p.body.pos.z - center[2]);
  }
  function sendPlayerState(): void {
    const p = ctx.player;
    if (!p) return;
    const state = encodeState(p);
    net.broadcast('ps', gs.teamMatch ? { round: gs.teamMatch.round, state } : state);
  }
  function releaseFlag(rid: string): void {
    const state = gs.teamMatch;
    if (!state || state.flag.carrier !== rid) return;
    const pos = positionOf(rid), b = ctx.level.bounds;
    const valid = pos && pos.y >= -10 && pos.y < 150 && pos.x >= b.minX && pos.x <= b.maxX && pos.z >= b.minZ && pos.z <= b.maxZ;
    const drop: Point = valid ? [pos.x, ctx.world.groundBelow(pos.x, pos.y + 0.5, pos.z), pos.z] : teamLayout(ctx.level).neutral;
    const safe = valid && drop[1] >= -10;
    dropFlag(state, rid, safe ? drop : teamLayout(ctx.level).neutral);
    if (!safe) state.flag.returnLeft = 0;
  }
  function reconcileTeamState(previousRound: number, wasDead: boolean, previousBreak: number): void {
    const state = gs.teamMatch, self = net.id, p = ctx.player;
    if (!state || !self || !p || !playing()) return;
    gs.matchT = state.elapsed;
    if (state.breakLeft > 0 && previousBreak === 0) {
      p.clearNades(); pendingHeadshots.clear(); shotQueue = [];
      hud.message('ROUND OVER', `${TEAM_NAMES[0]} ${state.scores[0]} · ${state.scores[1]} ${TEAM_NAMES[1]}`, 2);
    }
    if (state.round !== previousRound) {
      ready.clear(); ready.add(self); pendingHeadshots.clear(); shotQueue = [];
      seenDead = false; p.clearNades(); ctx.effects.clear(); app.pickups.clear();
      respawn(false);
      hud.message(state.overtime ? 'OVERTIME' : `ROUND ${state.round}`, state.overtime ? 'win two rounds in a row' : 'take the neutral flag', 2);
    } else if (Object.hasOwn(state.dead, self)) seenDead = true;
    else if ((wasDead || seenDead) && gs.state === 'dying' && state.breakLeft === 0) {
      seenDead = false; respawn();
    }
    p.dashLock = state.breakLeft > 0;
    for (const [rid, r] of ctx.remotes) if (Object.hasOwn(state.dead, rid)) r.alive = false;
  }
  function sendTeamState(): void {
    if (!net.isHost || !gs.teamMatch) return;
    if (net.id && Object.hasOwn(gs.teamMatch.dead, net.id)) seenDead = true;
    net.send('teamstate', structuredClone(gs.teamMatch));
    refreshScoreHud();
  }
  function updateTeam(dt: number): void {
    const state = gs.teamMatch;
    if (!state || !playing() || gs.over) return;
    if (net.isHost) {
      const round = state.round, wasDead = net.id !== null && Object.hasOwn(state.dead, net.id), pause = state.breakLeft;
      const layout = teamLayout(ctx.level), flagBefore = `${state.flag.carrier}/${state.flag.placed}`, deadBefore = Object.keys(state.dead).join();
      advanceTeamMatch(state, dt, layout);
      reconcileTeamState(round, wasDead, pause);
      const players = [...lobby.players.keys()].flatMap(rid => {
        const p = rid === net.id ? ctx.player : ctx.remotes.get(rid), team = teamOf(rid), pos = positionOf(rid);
        return p && pos && isTeam(team) && ready.has(rid) ? [{ id: rid, team, pos: pos.toArray() as Point, alive: p.alive }] : [];
      });
      interactFlag(state, players, layout, (a, b) => ctx.world.lineOfSight(vec(a).add(new THREE.Vector3(0, 0.8, 0)), vec(b).add(new THREE.Vector3(0, 0.8, 0))));
      syncT += dt;
      if (syncT >= 0.2 || round !== state.round || (pause > 0) !== (state.breakLeft > 0) ||
          flagBefore !== `${state.flag.carrier}/${state.flag.placed}` || deadBefore !== Object.keys(state.dead).join() || state.winner !== null) {
        syncT = 0; sendTeamState();
      }
      checkWin();
    }
    if (net.id && state.flag.carrier === net.id && ctx.player) ctx.player.shieldT = 0;
    if (!gs.over && net.id) teamWorld?.update(state, lobby.teams, net.id);
  }
  function localDeath(): void {
    const p = ctx.player;
    if (p === null) return;
    const killer = p.lastHitBy ?? null, h = p.lastHit;
    const dir = h?.from == null ? null : d1.subVectors(p.center, h.from).normalize().toArray().map(round2);
    const src = h?.src;
    const how = killer && src !== undefined ? HOW[src] ?? null : null;
    if (gs.teamMatch && (gs.teamMatch.breakLeft > 0 || gs.over)) return;
    net.broadcast('pdead', { killer, dir, over: !!h && (h.crit || h.amount >= 90 || h.src === 'melee' || h.src === 'wave'), how, crit: !!h?.crit,
      ...(gs.teamMatch ? { round: gs.teamMatch.round } : {}) });
    gs.respawnT = gs.teamMatch ? TEAM_RULES.WAVE - gs.teamMatch.elapsed % TEAM_RULES.WAVE : RESPAWN;
    gs.state = 'dying'; gs.deathT = 0;
    if (!ctx.input.usingTouch) { gs.menu = false; hud.hideScreen(); }
    if (coop()) { hud.kill('you are down'); if (net.id !== null) app.coop.down(net.id); return; }
    if (net.isHost && net.id !== null) tally(net.id, killer);
    const row = killer ? scores.get(killer) : null;
    hud.kill(row ? `eliminated by ${row.name}${how ? ` · ${how}${h?.crit ? ' headshot' : ''}` : ''}` : 'eliminated');
  }
  /**
   * The camera of a player who waits. Fire / aim watch the next / previous of `mates`, jump swaps
   * their eyes for a view over their shoulder. No one to watch: a view of `rest`. Returns who it watches.
   */
  function spectate(mates: RemotePlayer[], rest: THREE.Vector3, dt: number): RemotePlayer | undefined {
    const { input } = ctx;
    let i = Math.max(0, mates.findIndex(r => r.id === watching));
    if (!gs.menu && mates.length) {
      if (input.pressed('fire')) i = (i + 1) % mates.length;
      if (input.pressed('aim')) i = (i + mates.length - 1) % mates.length;
      if (input.pressed('jump')) firstPerson = !firstPerson;
    }
    const mate = mates[i];
    // `right` is (cos yaw, 0, -sin yaw): the yaw it faces, which the shoulder view swings after.
    const yaw = mate ? Math.atan2(-mate.right.z, mate.right.x) : 0;
    if (mate?.id !== watching) watchYaw = yaw;
    watching = mate?.id ?? null;
    if (!ctx.camera || !ctx.renderer) return mate;
    if (gs.deathT <= dt && mates.length && !input.usingTouch) {
      hud.tip(`${hud.key('fire')} / ${hud.key('aim')} switch player · ${hud.key('jump')} first / third person`, 4);
    }
    const cam = ctx.camera, p = ctx.player;
    // Through their eyes, this player's own gun stands in for theirs: the slot they hold, and their aim.
    const eyes = !!mate && firstPerson;
    if (p) p.watched = eyes && mate?.kind ? { kind: mate.kind, aim: mate.aiming } : null;
    if (mate && eyes) {
      cam.position.copy(mate.eye);
      cam.lookAt(d1.copy(mate.eye).add(mate.forward));
    } else {
      const target = mate?.center ?? rest;
      watchYaw = angleLerp(watchYaw, yaw, 1 - Math.exp(-6 * dt));
      if (mate) d1.set(Math.sin(watchYaw) * 4, 2.5, Math.cos(watchYaw) * 4).normalize();
      else d1.set(0, 2.5, 4).normalize();
      const wall = ctx.world.raycast(target, d1, 4.72);
      cam.position.copy(target).addScaledVector(d1, wall ? Math.max(0.1, wall.dist - 0.2) : 4.72);
      cam.lookAt(target);
    }
    const aim = p?.watched ? clamp(p.view.aimAmt, 0, 1) : 0;
    cam.fov = p?.watched ? lerp(82, p.view.adsFov, aim) : 82; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    ctx.renderer.rig.visible = !!p?.watched;
    ctx.renderer.setViewFov?.(lerp(VIEW_MODEL_FOV, cam.fov, aim));
    return mate;
  }
  /** The figure a first-person spectator looks out of: the renderer leaves it out, as it fills the view. */
  function watchedFigure(): THREE.Object3D | null {
    const r = gs.state === 'dying' && firstPerson && watching ? ctx.remotes.get(watching) : undefined;
    return r?.alive && r.visible ? r.root : null;
  }
  function updateDying(dt: number): void {
    if (coop()) {
      // Down in a wave: back at the wave clear (the co-op state says when). Down between waves: a short timer.
      const waiting = net.id !== null && app.coop.isDown(net.id);
      if (!waiting && (gs.respawnT -= dt) <= 0) { respawn(false); return; }
      const mate = spectate([...ctx.remotes.values()].filter(r => r.alive),
        d2.copy(ctx.level.playerStart).setY(ctx.level.playerStart.y + 1.5), dt);
      const status = !waiting ? 'back in a moment' : joinWait ? 'you join at the wave clear' : 'back at the wave clear';
      const main = !waiting ? String(Math.max(1, Math.ceil(gs.respawnT))) : joinWait ? 'WAVE IN PROGRESS' : 'DOWN';
      // The banner once (and each count); who is watched stays in the spectate bar, so a switch brings no banner back.
      if (deathMessage !== main) { hud.message(main, mate ? status : `no one is up · ${status}`, waiting ? 2.2 : 1.1); deathMessage = main; }
      hud.setSpectate(mate?.name ?? '', status);
      return;
    }
    if (gs.teamMatch) {
      const state = gs.teamMatch;
      const until = net.id ? state.dead[net.id] : undefined;
      gs.respawnT = until === undefined ? Math.max(0, gs.respawnT - dt) : Math.max(0, until - state.elapsed);
      const team = teamOf(net.id);
      const mate = isTeam(team) ? spectate([...ctx.remotes.values()].filter(r => r.alive && teamOf(r.id) === team),
        vec(teamLayout(ctx.level).bases[team]).add(new THREE.Vector3(0, 1.5, 0)), dt) : undefined;
      const main = gs.respawnT > 0 ? String(Math.ceil(gs.respawnT)) : 'WAIT';
      const sub = mate ? 'next respawn wave' : 'team wiped · next respawn wave';
      if (deathMessage !== main + sub) { hud.message(main, sub, 1.1); deathMessage = main + sub; }
      hud.setSpectate(mate?.name ?? '', 'next respawn wave');
      return;
    }
    const before = Math.ceil(gs.respawnT);
    gs.respawnT -= dt;
    const left = Math.ceil(gs.respawnT);
    if (left !== before || gs.deathT <= dt) hud.message(left > 0 ? String(left) : 'GO', left > 0 ? 'respawning in' : '', 1.1);
    if (gs.respawnT <= 0) respawn();
  }
  function respawn(protect = true): void {
    const p = ctx.player;
    if (p === null) return;
    p.reset(gs.teamMatch ? teamSpawn(net.id) : coop() ? app.coop.slot() : arenaSpawn()); p.name = app.settings.name; p.lastHitBy = p.lastHit = null;
    faceCenter();
    gs.state = 'play'; p.shieldT = protect ? 2 : 0; deathMessage = ''; joinWait = false; p.watched = null; hud.setSpectate('');
    if (gs.teamMatch) sendPlayerState();
    if (protect) hud.tip('spawn protection · 2s', 1.6);
    ctx.effects.strokeBurst(p.center, TONE.PRIMARY, 24, 6, { life: 0.5, size: 0.03 });
    ctx.audio.spawn(p.center);
  }
  function updateOver(dt: number): void {
    gs.overT += dt;
    if (net.isHost && gs.overT > 8) { net.send('backtolobby', {}); lobbyScreen(); }
  }

  // ---- network update (real dt, now in seconds)
  function update(dt: number, t: number = now()): void {
    if (!net.active) return;
    for (const [id, hit] of pendingHeadshots) if (hit.until < t) pendingHeadshots.delete(id);
    for (const r of ctx.remotes.values()) r.update(dt, t);
    if (inMatch()) {
      for (const [rid, r] of [...ctx.remotes]) {
        if (!(r.lastSeen > 0) || t * 1000 - r.lastSeen <= SILENT_MS) continue;
        if (!net.isHost && rid === net.hostId) { leave('lost connection to the host'); return; }
        const name = r.name;
        removeRemote(rid); hud.kill(`${name} lost connection`);
        if (net.isHost) { net.close(rid); net.send('leave', { id: rid }); broadcastLobby(); sendScores(); }
      }
    }
    psT += dt;
    if (psT >= PS_INTERVAL && inMatch()) { psT = 0; sendPlayerState(); }
    if (shotQueue.length) {
      const player = ctx.player;
      if (player !== null) { net.broadcast('shots', { k: player.weapon.kind, e: shotQueue }); shotQueue = []; }
    }
    updateMarks(dt, t);
    if (coop()) app.coop.update(dt);
    if (gs.teamMatch) {
      const elapsed = Math.max(0, t - lastClock); lastClock = t;
      updateTeam(elapsed);
    } else if (net.isHost && inMatch() && !gs.over && mode() === 'ffa') {
      gs.matchT += dt;
      if (gs.matchT > TIME_LIMIT) {
        const top = sorted()[0], winner = top ? { id: top.id, name: top.name } : { id: net.id ?? 'host', name: ctx.player?.name ?? 'host' };
        net.send('end', winner); endMatch(winner);
      }
    }
  }

  /** Places the local player's mark on the aim key, then draws every live mark. */
  function updateMarks(dt: number, t: number): void {
    markGap -= dt;
    const p = ctx.player, camera = ctx.camera;
    if (p && net.id && squadmate(net.id) && activeCombat() && gs.state === 'play' && !gs.menu && markGap <= 0 && ctx.input.pressed('mark')) {
      markGap = MARK_GAP;
      const dir = camera.getWorldDirection(d1), eye = camera.position;
      // The nearest of wall, enemy and player, as a shot finds it.
      const hits = [ctx.world.raycast(eye, dir, MARK_RANGE, seeThrough), ctx.enemies?.raycast(eye, dir, MARK_RANGE), raycastPlayers(eye, dir, MARK_RANGE)];
      let point: THREE.Vector3 | null = null, best = Infinity;
      for (const h of hits) if (h && h.dist < best) { best = h.dist; point = h.point; }
      if (point) {
        placeMark(marks, net.id, p.name, point, t);
        // ponytail: the host relays to every peer and the other team drops it; send to the team only if this leak matters.
        net.broadcast('mark', { pos: point.toArray().map(round2) });
        ctx.audio.mark();
      } else ctx.audio.empty();
    }
    if (!activeCombat()) marks.clear();
    pruneMarks(marks, t);
    if (!marks.size) { hud.setMarks([]); return; }
    const canvas = ctx.renderer.three.domElement, view: { x: number; y: number; label: string }[] = [];
    camera.updateMatrixWorld();
    for (const m of marks.values()) {
      d2.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      const behind = d2.z > 0;
      d2.applyMatrix4(camera.projectionMatrix);
      const { x, y } = stragglerMark(d2.x, d2.y, behind, canvas.clientWidth, canvas.clientHeight);
      view.push({ x, y, label: `${m.name} · ${Math.round(m.pos.distanceTo(camera.position))}m` });
    }
    hud.setMarks(view);
  }

  // ---- PvP hooks
  const targets = (): Target[] => {
    const player = ctx.player;
    return player === null ? [] : [player, ...ctx.remotes.values()];
  };
  const canHurt = (t: Target): boolean => isOnline() && t !== ctx.player &&
    (mode() === 'ffa' || (activeCombat() && 'id' in t && typeof t.id === 'string' && opponents(net.id, t.id)));
  /**
   * A guard is a 0.42 m sphere ahead of the chest; a slash's cutting arc is wider (0.6 m), and its
   * owner reports it open a little past its local window, as this peer draws it about 80 ms late.
   */
  const guardRay = new THREE.Ray(), guardSphere = new THREE.Sphere(), guardHit = new THREE.Vector3();
  function raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null {
    let best: PlayerHit | null = null;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !canHurt(r)) continue;
      const hit = r.raycast(o, d, best ? best.dist : max);
      if (hit && (!best || hit.dist < best.dist)) best = { player: r, ...hit };
      if (r.blocking || r.cutting) {
        guardSphere.radius = r.cutting ? 0.6 : 0.42;
        guardSphere.center.copy(r.center).addScaledVector(r.forward, 0.5); guardSphere.center.y += 0.3;
        guardRay.set(o, d);
        if (guardRay.intersectSphere(guardSphere, guardHit)) {
          const dist = guardHit.distanceTo(o);
          if (dist <= max && (!best || dist < best.dist)) best = { player: r, part: 'blade', dist, point: guardHit.clone() };
        }
      }
    }
    return best;
  }
  function playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[] {
    return [...ctx.remotes.values()].filter(r => {
      if (!r.alive || !canHurt(r)) return false;
      d1.subVectors(r.center, pos); const dist = d1.length();
      return dist <= range + 0.3 && (dist <= 0.3 || d1.dot(dir) / dist >= cosHalf) && ctx.world.lineOfSight(pos, r.center);
    });
  }
  function hitPlayer(t: RemotePlayer, damage: number, info: HitInfo = {}): void {
    if (!canHurt(t) || !t.alive || !Number.isFinite(damage) || damage <= 0) return;
    const p = ctx.player;
    if (p === null) return;
    const point = info.point ?? t.center;
    if (info.part === 'blade') {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 8, 6, { life: 0.22, size: 0.035 });
      ctx.audio.shieldHit(t.center); hud.hitmarker(false, false, true);
      const ret = Math.random() < 0.4;
      if (ret) {
        ctx.effects.tracer(point, p.eye, TONE.HOSTILE, 0.03, 0.08);
        hud.tip('RETURNED', 0.9); ctx.input.rumble(0.5, 0.4, 90);
        p.lastHitBy = t.id; p.lastHit = { from: t.center.clone(), crit: false, amount: 0.6 * damage, src: 'deflect' };
        p.takeDamage(0.6 * damage, t.center);
      } else hud.tip('DEFLECTED', 0.7);
      net.sendTo(t.id, 'parry', { ret, by: net.id, ...roundTag() });
      return;
    }
    const facing = t.blocking ? d1.subVectors(p.center, t.center).normalize().dot(t.forward) : -1;
    const frontHit = /^(head|torso|arm|fore)/.test(info.part ?? '');
    // A sword strike meets a parry; an air slash meets any raised guard.
    const parried = info.source === 'melee' ? t.parryWindow : info.source === 'wave' && t.blocking;
    if (facing > 0.6 && frontHit && parried) {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 10, 6, { life: 0.25, size: 0.04 });
      ctx.audio.shieldHit(t.center); hud.hitmarker(false, false, true); ctx.game.hitstop(0.08, 0.15);
      const sword = p.sword;
      if (sword && info.source === 'melee') sword.cooldown = Math.max(sword.cooldown, 0.6);
      ctx.input.rumble(0.6, 0.3, 90); hud.tip('PARRIED', 0.9);
      return;
    }
    ctx.effects.blood(point, info.dir ?? d1.subVectors(t.center, p.eye).normalize(), clamp(0.4 + damage / 80, 0.4, 1.6), { tone: TONE.HOSTILE });
    hud.hitmarker(false, !!info.crit); ctx.audio.hitEnemy(); t.flash();
    const source = info.source ?? 'rifle';
    const shotId = ++hitId;
    if (info.crit && info.part === 'head' && Object.hasOwn(GUN_STATS, source)) {
      if (pendingHeadshots.size >= 64) pendingHeadshots.clear();
      pendingHeadshots.set(shotId, { target: t.id, source, until: now() + 1 });
    }
    net.sendTo(t.id, 'pdmg', { amount: Math.round(damage), from: p.center.toArray().map(round1), by: net.id,
      crit: !!info.crit, src: source, hitId: shotId, ...roundTag() });
  }
  function cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean {
    let any = false;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !r.grappling || !canHurt(r)) continue;
      d2.copy(r.body.pos).addScaledVector(r.right, 0.35); d2.y += 1.25;
      for (let i = 0; i < 15; i++) {
        d3.lerpVectors(d2, r.hook, i / 14).sub(eye);
        const t = d3.dot(dir);
        if (t < 0.3 || t > range || Math.sqrt(Math.max(0, d3.lengthSq() - t * t)) > 0.9) continue;
        d3.add(eye);
        ctx.effects.strokeBurst(d3, TONE.ACCENT, 10, 5, { life: 0.25, size: 0.035 });
        net.sendTo(r.id, 'cut', roundTag()); hud.tip('ROPE CUT', 0.9); any = true;
        break;
      }
    }
    return any;
  }
  function onShot(end: THREE.Vector3): void {
    if (gs.teamMatch && ctx.player) ctx.player.shieldT = 0;
    if (net.active && inMatch()) shotQueue.push(round1(end.x), round1(end.y), round1(end.z));
  }

  // ---- message handlers
  const fromHost = (from: string): boolean => !net.isHost && from === net.hostId;
  const roster = (from: string): boolean => lobby.players.has(from) && from !== net.id;
  net.on('refused', d => leave(obj(d) && str(d.reason, 256) ? d.reason : ''));
  net.on('lobby', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { players, hostId, isPublic } = d;
    if (!arr(players) || players.length > 8 || typeof hostId !== 'string' || hostId !== net.hostId || typeof isPublic !== 'boolean') return;
    const ids: unknown[] = [];
    for (const p of players) {
      if (!obj(p) || !id(p.id) || !str(p.name, 14)) return;
      ids.push(p.id);
    }
    if (new Set(ids).size !== players.length) return;
    const selected = d.mode ?? 'ffa';
    if (!isOnlineMode(selected) || (isTeamMode(selected) && (!validTeams(d.teams) || ids.some(pid => typeof pid !== 'string' || !Object.hasOwn(d.teams as object, pid))))) return;
    if (inMatch() && selected !== mode()) return;
    lobby.mode = selected; lobby.teams = validTeams(d.teams) ? d.teams : {};
    lobby.hostId = hostId; lobby.isPublic = isPublic; lobby.code = net.code;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    lobby.players.clear();
    for (const p of players) {
      if (!obj(p) || !id(p.id)) continue;
      const nm = cleanName(p.name);
      lobby.players.set(p.id, nm); if (p.id !== net.id) addRemote(p.id, nm);
    }
    for (const rid of [...ctx.remotes.keys()]) if (!lobby.players.has(rid)) removeRemote(rid);
    applyTeams();
    if (inMatch()) {
      for (const [pid, name] of lobby.players) if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
      refreshScoreHud();
    }
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('leave', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const gone = d.id;
    if (!id(gone) || !lobby.players.has(gone)) return;
    const name = nameOf(gone) ?? 'someone';
    removeRemote(gone);
    if (inMatch()) hud.kill(`${name} left`);
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('teamreq', (d, from) => { if (obj(d)) setTeam(from, d.team); });
  net.on('start', (d, from) => {
    if (!fromHost(from) || !obj(d) || (gs.state !== 'lobby' && gs.state !== 'start' && !d.late)) return;
    const selected = d.mode ?? 'ffa';
    if (!isOnlineMode(selected)) return;
    if (isTeamMode(selected)) {
      if (!validTeams(d.teams) || !validTeamMatch(d.teamState) || d.teamState.mode !== selected ||
          [...lobby.players.keys()].some(rid => !Object.hasOwn(d.teams as object, rid)) || !validStateRoster(d.teamState)) return;
    }
    if (selected === 'coop' && !validCoopState(d.coop)) return;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    let index: unknown = null;
    if (obj(d.spawns)) {
      const self = net.id;
      index = self === null ? undefined : d.spawns[self];
    } else if (d.spawn !== undefined) index = d.spawn;
    if (index !== null && index !== undefined && !int(index)) return;
    const broken = d.broken;
    if (arr(broken) && (broken.length > 4096 || !broken.every(int))) return;
    lobby.mode = selected; lobby.teams = validTeams(d.teams) ? d.teams : {};
    startMatch(d.late === true, int(index) ? index : null, validTeamMatch(d.teamState) ? d.teamState : null,
      selected === 'coop' && validCoopState(d.coop) ? d.coop : null);
    // ponytail: the original `for (const bid of d.broken ?? [])` threw on a
    // non-array `broken`; net.ts already rejects those, and §9.10 says drop, never throw.
    if (arr(broken)) {
      for (const bid of broken) {
        if (!int(bid)) continue;
        app.breakables.breakProp(ctx.level.breakables[bid], null, false, true);
      }
    }
  });
  net.on('end', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { id: winnerId, name } = d;
    if (!id(winnerId) || !str(name, 14) || !inMatch()) return;
    if (gs.teamMatch ? winnerId !== 'team:0' && winnerId !== 'team:1' : coop() ? winnerId !== 'coop' : !scores.has(winnerId)) return;
    endMatch({ id: winnerId, name });
  });
  net.on('backtolobby', (d, from) => { if (fromHost(from)) lobbyScreen(); });
  function validStateRoster(state: TeamMatch): boolean {
    return Object.keys(state.dead).every(rid => lobby.players.has(rid)) &&
      (state.flag.carrier === null || lobby.players.has(state.flag.carrier));
  }
  net.on('teamstate', (d, from) => {
    const previous = gs.teamMatch;
    if (!fromHost(from) || !previous || !playing() || !validTeamMatch(d) || !validStateRoster(d) ||
        d.mode !== mode() || d.elapsed < previous.elapsed || d.round < previous.round) return;
    gs.teamMatch = d;
    reconcileTeamState(previous.round, net.id !== null && Object.hasOwn(previous.dead, net.id), previous.breakLeft);
    refreshScoreHud();
  });
  net.on('score', (d, from) => {
    if (!fromHost(from) || !arr(d) || d.length > 8) return;
    if (!d.every(r => obj(r) && id(r.id) && str(r.name, 14) && int(r.kills) && int(r.deaths))) return;
    applyScores(d);
  });
  net.on('pickup', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    const { id: pickupId, kind, pos } = d;
    if (!int(pickupId) || pickupId < 1) return;
    if (kind !== 'ammo' && kind !== 'health') return;
    if (!triple(pos)) return;
    app.pickups.spawn(kind, vec(pos), pickupId);
  });
  net.on('taken', (d, from) => { if (fromHost(from) && obj(d) && int(d.id)) app.pickups.remove(d.id); });
  net.on('take', (d, from) => {
    if (!net.isHost || !roster(from) || !obj(d) || !int(d.id)) return;
    const p = app.pickups.items.find(item => item.id === d.id), who = ctx.remotes.get(from);
    if (!p || !who || p.mesh.position.distanceTo(who.body.pos) > TAKE_RANGE) return;
    if (app.pickups.remove(d.id)) net.send('taken', { id: d.id });
  });
  net.on('ps', (d, from) => {
    const r = ctx.remotes.get(from);
    if (!r || !roster(from) || !inMatch()) return;
    if (gs.teamMatch) {
      if (!obj(d) || d.round !== gs.teamMatch.round || !arr(d.state)) return;
      r.push(d.state, now());
      ready.add(from);
      if (Object.hasOwn(gs.teamMatch.dead, from)) r.alive = false;
    } else r.push(d, now());
  });
  net.on('pdmg', (d, from) => {
    const p = ctx.player;
    if (p === null || !p.alive || gs.state !== 'play' || !activeCombat() || p.shieldT > 0 || !roster(from) || !opponents(net.id, from) || !obj(d) || !currentRound(d) || d.by !== from) return;
    const { amount, from: fromPos, src, crit } = d;
    if (typeof amount !== 'number' || !(amount > 0 && amount <= 100000)) return;
    if (!(fromPos === null || triple(fromPos))) return;
    if (!str(src, 32) || typeof crit !== 'boolean') return;
    // Falloff and pellet rounding are the sender's business, but no weapon may exceed its own best case.
    const cap = PVP_CAP[src];
    if (cap === undefined) return;
    const dealt = Math.min(amount, cap);
    const pos = fromPos === null ? null : vec(fromPos);
    p.lastHitBy = from; p.lastHit = { from: pos, crit, amount: dealt, src };
    p.takeDamage(dealt, pos);
    if (crit && int(d.hitId)) net.sendTo(from, 'headshot', { hitId: d.hitId, ...roundTag() });
  });
  net.on('headshot', (d, from) => {
    if (!roster(from) || !opponents(net.id, from) || !obj(d) || !currentRound(d) || !int(d.hitId) || gs.state !== 'play') return;
    const hit = pendingHeadshots.get(d.hitId);
    if (!hit || hit.target !== from || hit.until < now()) return;
    pendingHeadshots.delete(d.hitId);
    ctx.player?.onHeadshot({ part: 'head', crit: true, source: hit.source });
  });
  net.on('pdead', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    const t = now();
    // Co-op has no timed respawn to pace deaths: a player can return at a wave clear and go down again soon after.
    if (t - (lastDeath.get(from) ?? -Infinity) < (coop() ? 0.5 : RESPAWN)) return;
    lastDeath.set(from, t);
    if (gs.teamMatch && (!activeCombat() || d.round !== gs.teamMatch.round || Object.hasOwn(gs.teamMatch.dead, from))) return;
    const { killer, dir, over, how, crit } = d;
    if (!(killer === null || id(killer)) || !(dir === null || triple(dir, 1)) || typeof over !== 'boolean' || typeof crit !== 'boolean' || !(how === null || str(how, 64))) return;
    const r = ctx.remotes.get(from), victim = r?.name ?? 'someone';
    const killerId = killer !== null && scores.has(killer) && opponents(killer, from) ? killer : null;
    if (gs.teamMatch && net.isHost && !r?.alive) return;
    if (r) { r.ragdoll(dir, over); ctx.audio.enemyDie(r.center); }
    if (coop()) { hud.kill(`${victim} is down`); app.coop.down(from); return; }
    const howText = how ? ` · ${how}${crit ? ' headshot' : ''}` : '';
    if (killerId === net.id) { gs.kills++; hud.hitmarker(true, crit); app.addScore(100, `ELIMINATED ${victim}${howText}`); ctx.audio.kill(true); }
    else {
      const killerName = killerId === null ? null : scores.get(killerId)?.name ?? null;
      hud.kill(killerName ? `${killerName} eliminated ${victim}${howText}` : `${victim} fell off the map`);
    }
    if (net.isHost) tally(from, killerId);
  });
  net.on('nade', (d, from) => {
    if (!roster(from) || !obj(d) || !activeCombat()) return;
    const { pos, vel } = d;
    if (!triple(pos) || !triple(vel)) return;
    if (vec(vel).length() > MAX_THROW_SPEED * 1.1) return;
    const p = ctx.player;
    if (p === null) return;
    p.throwGrenade({ pos, vel });
  });
  net.on('mark', (d, from) => {
    if (!roster(from) || !squadmate(from) || !activeCombat() || !obj(d) || !triple(d.pos)) return;
    placeMark(marks, from, nameOf(from) ?? 'player', vec(d.pos), now());
    ctx.audio.mark();
  });
  net.on('brk', (d, from) => {
    if (!roster(from) || !obj(d) || !int(d.id)) return;
    app.breakables.breakProp(ctx.level.breakables[d.id], null, false, false);
  });
  net.on('parry', (d, from) => {
    if (!roster(from) || !opponents(net.id, from) || !activeCombat() || !obj(d) || !currentRound(d)) return;
    const { by, ret } = d;
    if (by !== from || typeof ret !== 'boolean') return;
    const p = ctx.player;
    if (p === null) return;
    ctx.audio.shieldHit(p.center); ctx.input.rumble(0.35, 0.3, 60);
    ctx.effects.strokeBurst(d1.copy(p.eye).addScaledVector(p.forward, 0.5), TONE.ACCENT, 8, 5, { life: 0.2, size: 0.03 });
    hud.kill(ret ? 'RETURN TO SENDER' : 'DEFLECTED', ret ? 25 : 0);
  });
  net.on('shots', (d, from) => {
    if (!roster(from) || !obj(d)) return;
    ctx.remotes.get(from)?.shots(d.k, d.e);
    // Watched through their eyes: their shot kicks the gun that stands in for theirs.
    const w = ctx.player?.watched && watching === from ? ctx.player.view : null;
    if (w?.isGun) (w as Gun).echoShot();
  });
  net.on('cut', (d, from) => {
    const p = ctx.player;
    if (p === null || !roster(from) || !opponents(net.id, from) || !activeCombat() || !obj(d) || !currentRound(d) || p.grapple.mode === 'idle') return;
    p.detachGrapple(false);
    ctx.effects.strokeBurst(p.center, TONE.ACCENT, 8, 4, { life: 0.25, size: 0.03 });
    hud.tip('your rope got cut', 1.3); ctx.input.rumble(0.5, 0.3, 80);
  });
  net.onPeerJoin = peerJoined;
  net.onPeerLeave = peerLeft;
  net.onDisconnect = () => leave('the host left the lobby');

  return {
    selectMode, requestTeam, onlineInfo, dispose,
    create, join, quickPlay, hostStart, leave, lobbyScreen, broadcastLobby,
    localDeath, updateDying, updateOver, watchedFigure, update, refreshScoreHud, sendScores, endMatch, respawn, showBoard, boardRows,
    targets, canHurt, raycastPlayers, playersInArc, hitPlayer, cutRopes, onShot,
  };
}

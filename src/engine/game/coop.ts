import * as THREE from 'three';
import { COOP, START_SLOTS } from './coop-rules';
import type { CoopState } from './coop-rules';
import type { OnlineInfo } from '../hud/screens';
import type { App } from '../boot';

/** Co-op survival: the host runs the solo waves, the clients mirror them (docs/spec/online-coop.md). */
export interface CoopApi {
  /** An online co-op lobby or run. */
  active(): boolean;
  /** The host of a live run: it runs the wave director and the enemy AI. */
  directing(): boolean;
  /** Players the next wave is scaled for. One outside co-op. */
  players(): number;
  readonly state: CoopState | null;
  begin(state: CoopState, slot: number): void;
  /** A start position around the solo player start. */
  slot(index?: number): THREE.Vector3;
  info(): OnlineInfo;
  /** Points this peer earned for the team score. */
  points(n: number): void;
  reset(): void;
}

export function createCoop(app: App): CoopApi {
  const { ctx, gs, lobby } = app;
  const { net, hud } = ctx;
  const min = new THREE.Vector3(), max = new THREE.Vector3();
  let state: CoopState | null = null;
  let mySlot = 0;

  const active = (): boolean => gs.mode === 'ffa' && lobby.mode === 'coop';
  const live = (): boolean => active() && state !== null && (gs.state === 'play' || gs.state === 'dying');
  const directing = (): boolean => live() && net.isHost;
  const players = (): number => active() ? Math.max(1, Math.min(COOP.MAX_PLAYERS, lobby.players.size)) : 1;

  function slot(index = mySlot): THREE.Vector3 {
    const start = ctx.level.playerStart, [dx, dz] = START_SLOTS[index % START_SLOTS.length] ?? [0, 0];
    const p = new THREE.Vector3(start.x + dx, start.y, start.z + dz);
    const blocked = ctx.world.overlapsAABB(min.set(p.x - 0.4, p.y + 0.1, p.z - 0.4), max.set(p.x + 0.4, p.y + 1.8, p.z + 0.4))
      || Math.abs(ctx.world.groundBelow(p.x, p.y + 1, p.z, 3) - p.y) > 0.5;
    return blocked ? start.clone() : p;
  }

  function begin(next: CoopState, index: number): void {
    state = structuredClone(next); mySlot = index;
    gs.wave = state.wave; gs.score = state.score;
    hud.setWave(state.wave, state.left); hud.setScore(state.score, 0);
  }

  function info(): OnlineInfo {
    return { mode: 'coop', status: state ? `WAVE ${state.wave} · team score ${state.score}` : '' };
  }

  function points(_n: number): void { /* The team score arrives with the wave director. */ }

  function reset(): void { state = null; mySlot = 0; }

  return { active, directing, players, get state() { return state; }, begin, slot, info, points, reset };
}

import { Vector3 } from 'three';
import type { GameState } from '../types';

export function makeGameState(): GameState {
  return {
    state: 'start', mode: 'solo', menu: false, time: 0,
    hitstopT: 0, hitstopScale: 1, wave: 0, score: 0, combo: 0, comboT: 0, kills: 0,
    intermission: 0, queue: [], spawnT: 0, maxAlive: 6, deathT: 0,
    // game/execution.ts `ExecState`.
    focus: { active: false, phase: 'idle', markT: 0, marks: [], route: [], leg: 0, legT: 0, stuckY: 0, cut: [], finishT: 0, trail: new Vector3(), trailT: 0 },
    katanaStreak: 0, boss: null, respawnT: 0, matchT: 0, teamMatch: null, over: null, overT: 0,
  };
}

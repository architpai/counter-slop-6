import type { GameState } from '../types';

export function makeGameState(): GameState {
  return {
    state: 'start', mode: 'solo', menu: false, time: 0,
    hitstopT: 0, hitstopScale: 1, wave: 0, score: 0, combo: 0, comboT: 0, kills: 0,
    intermission: 0, queue: [], spawnT: 0, maxAlive: 6, deathT: 0,
    focus: { active: false, remaining: 0, chain: 0, target: null, dash: null, arm: 0, ready: false },
    katanaStreak: 0, boss: null, respawnT: 0, matchT: 0, teamMatch: null, over: null, overT: 0,
  };
}

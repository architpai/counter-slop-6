const rows = {
  grunt: { name: 'RECRUIT', hp: 100, speed: 5.2, weapon: 'rifle', score: 100, scale: 1, range: 28, stop: 16, keep: 7, burst: 3, burstInterval: 0.15, cooldown: [1.6, 2.6], damage: 6, spread: 0.055, projectileSpeed: 36, thickness: 0.045, bodyWidth: 1, headSize: 1, limbR: 0.032, hat: 'cap' },
  rusher: { name: 'B-RUSHER', hp: 70, speed: 7.6, weapon: 'blade', score: 120, scale: 0.95, lunge: 2.9, reach: 3, standoff: 1.9, cooldown: [1, 1.5], damage: 15, bodyWidth: 0.82, headSize: 0.95, limbR: 0.027, hat: 'band', smile: true },
  heavy: { name: 'JUGGERNAUT', hp: 320, speed: 3, weapon: 'shotgun', score: 260, scale: 1.25, range: 18, stop: 9, keep: 5, burst: 7, cooldown: [2.4, 3.2], damage: 5, spread: 0.13, projectileSpeed: 32, thickness: 0.05, bodyWidth: 1.55, headSize: 0.88, limbR: 0.05, hat: 'helmet' },
  sniper: { name: 'CAMPER', hp: 60, speed: 3.6, weapon: 'sniper', score: 180, scale: 1.05, range: 90, stop: 90, keep: 15, burst: 1, cooldown: [2.8, 3.8], damage: 22, spread: 0.006, projectileSpeed: 95, thickness: 0.07, aimUp: 1.7, stationary: true, bodyWidth: 0.78, headSize: 0.92, limbR: 0.026, hat: 'hood' },
  shield: { name: 'SHIELD MAIN', hp: 150, speed: 3.8, weapon: 'pistol', score: 200, scale: 1.05, range: 20, stop: 8, keep: 4, burst: 2, burstInterval: 0.2, cooldown: [1.8, 2.6], damage: 5, spread: 0.06, projectileSpeed: 34, thickness: 0.045, bodyWidth: 1.2, headSize: 0.9, limbR: 0.042, hat: 'helmet', shield: true },
  bomber: { name: 'LIVE NADE', hp: 26, speed: 6.5, weapon: 'bomb', score: 150, scale: 0.9, tone: 2, kind: 'blob', blob: 'bomber', fuseRange: 3.4, fuseTime: 1.05, blastRadius: 4.2, damage: 24 },
  flyer: { name: 'ATTACK DRONE', hp: 40, speed: 6.2, weapon: 'dive', score: 140, scale: 1.5, kind: 'flyer', flying: true, damage: 10, cooldown: [2.8, 4.2] },
  boss: { name: 'THE ADMIN', hp: 2600, speed: 3.2, weapon: 'boss', score: 2500, scale: 2.7, tone: 2, boss: true, range: 32, stop: 6, keep: 0, cooldown: [2.6, 3.6], damage: 22, bodyWidth: 1.35, headSize: 1.15, limbR: 0.06, hat: 'crown' },
  hitbox: { name: 'THE HITBOX', hp: 3400, speed: 4.2, weapon: 'boss', score: 3200, scale: 2.6, tone: 5, kind: 'blob', blob: 'hitbox', boss: true, range: 30, stop: 8, keep: 0, cooldown: [2.2, 3.2], damage: 26 },
  lagspike: { name: 'THE LAG SPIKE', hp: 3000, speed: 3, weapon: 'boss', score: 3600, scale: 2.4, tone: 2, kind: 'blob', blob: 'lagspike', boss: true, range: 34, stop: 10, keep: 0, cooldown: [2.4, 3.4], damage: 20 },
};

export const TYPES = Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, Object.freeze({ key, kind: 'humanoid', tone: 1, ...row })]));
export const BOSS_ORDER = ['boss', 'hitbox', 'lagspike'];

import { Gun } from './gun.js';
import { Katana } from './katana.js';

export { GUN_STATS } from './stats.js';
export { Gun, Katana };

export function makeLoadout(ctx, player) {
  return [new Gun(ctx, player, 'rifle'), new Gun(ctx, player, 'shotgun'), new Gun(ctx, player, 'sniper'), new Katana(ctx, player)];
}

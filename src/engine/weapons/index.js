import { Gun } from './gun';
import { Katana } from './katana';

export { GUN_STATS } from './stats';
export { Gun, Katana };

export function makeLoadout(ctx, player) {
  return [new Gun(ctx, player, 'rifle'), new Gun(ctx, player, 'shotgun'), new Gun(ctx, player, 'sniper'), new Katana(ctx, player)];
}

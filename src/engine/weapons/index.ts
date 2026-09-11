import type * as THREE from 'three';
import type { Ctx, Player, WeaponState } from '../types';
import { Gun } from './gun';
import { Katana } from './katana';
import type { GunKind } from './stats';

export { GUN_STATS } from './stats';
export type { GunKind, GunStats } from './stats';
export { Gun, Katana };

/** What the player, the HUD and the focus system may ask of any held weapon. */
export interface Weapon {
  readonly kind: GunKind | 'katana';
  readonly name: string;
  readonly hint: string;
  readonly isGun: boolean;
  readonly scope: boolean;
  /** Child of `ctx.renderer.rig`. */
  readonly root: THREE.Group;
  readonly adsFov: number;
  aimAmt: number;
  mag: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  readonly spreadPx: number;
  equip(): void;
  unequip(): void;
  animate(st: WeaponState, dt: number): void;
  addAmmo(n: number): void;
  resetAmmo(): void;
  /** Cancel owned timers and remove/release the view model. */
  dispose(): void;
  /** External spring kicks (grapple, grenade). */
  kickPos(x: number, y: number, z: number): void;
  kickRot(x: number, y: number, z: number): void;
}

/** `[rifle, shotgun, sniper, katana]`. The revolver is built but never issued. */
export function makeLoadout(ctx: Ctx, player: Player): Weapon[] {
  return [new Gun(ctx, player, 'rifle'), new Gun(ctx, player, 'shotgun'), new Gun(ctx, player, 'sniper'), new Katana(ctx, player)];
}

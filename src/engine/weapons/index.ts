import type * as THREE from 'three';
import type { Ctx, Player, WeaponState } from '../types';
import { Gun } from './gun';
import { Melee } from './melee';
import { GUN_LOADOUT, type GunKind } from './stats';

export { GUN_STATS } from './stats';
export type { GunKind, GunStats } from './stats';
export { Gun, Melee };

/** What the player, the HUD and the focus system may ask of any held weapon. */
export interface Weapon {
  readonly kind: GunKind | 'melee';
  readonly name: string;
  readonly hint: string;
  readonly isGun: boolean;
  readonly scope: boolean;
  /** Child of `ctx.renderer.rig`. */
  readonly root: THREE.Group;
  readonly adsFov: number;
  /** Walk-speed multiplier while aiming; the knife never aims. */
  readonly adsSpeed: number;
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

/** Five gun slots; the player owns a separate, always-available melee weapon. */
export function makeLoadout(ctx: Ctx, player: Player): Weapon[] {
  return GUN_LOADOUT.map(kind => new Gun(ctx, player, kind));
}

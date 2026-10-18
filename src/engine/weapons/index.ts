import type * as THREE from 'three';
import type { Ctx, Player, WeaponState } from '../types';
import { Gun } from './gun';
import { Sword } from './sword';
import type { GunKind, WeaponKind } from './stats';

export { GUN_STATS } from './stats';
export type { GunKind, GunStats, WeaponKind } from './stats';
export { Gun, Sword };

/** What the player, the HUD and the focus system may ask of any held weapon. */
export interface Weapon {
  /** A loadout's weapons are `WeaponKind`s; the revolver is a gun no loadout carries. */
  readonly kind: GunKind | 'sword';
  readonly name: string;
  readonly hint: string;
  readonly isGun: boolean;
  readonly scope: boolean;
  /** Child of `ctx.renderer.rig`. */
  readonly root: THREE.Group;
  readonly adsFov: number;
  /** Walk-speed multiplier while aiming (the sword: while guarding). */
  readonly adsSpeed: number;
  /** Multiplies walk, sprint, crouch and air speed while held (weapons/stats.ts `Handling`). */
  readonly moveSpeed: number;
  /** Multiplies jump speed and the slide's boost while held. */
  readonly mobility: number;
  aimAmt: number;
  /** The scoped overlay's drift and scale (gun.ts `ViewModel`). */
  readonly sightX: number;
  readonly sightY: number;
  readonly sightScale: number;
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

/** A new weapon of `kind` for `player`. */
export function makeWeapon(ctx: Ctx, player: Player, kind: WeaponKind): Weapon {
  return kind === 'sword' ? new Sword(ctx, player) : new Gun(ctx, player, kind);
}

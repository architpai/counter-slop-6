/**
 * The surface the engine drives the HUD through.
 *
 * `boot` holds one of these and calls it; it never touches the DOM. Phase 7
 * swapped the implementation from a DOM class to a store React subscribes to,
 * without the engine noticing — which is the point of the interface.
 *
 * `docs/ARCHITECTURE.md` §6.9 is the source of truth for every member here, and
 * for the rule that the HUD has setters only. The doc reserves `boardHidden()`
 * as the one permitted read-back, but nothing ever called it -- not even the
 * vanilla original -- so the surface is setter-only in practice.
 */
import type { BoardModel, PvpModel, ScreenView, UiAction } from './screens';
import type { ScopeKind } from '../weapons/stats';

export interface SlotView {
  name: string;
  active: boolean;
  ammo: string;
  empty: boolean;
}

export interface MobileState {
  active: boolean;
  enabled: boolean;
  portrait: boolean;
  interrupted: boolean;
  online: boolean;
  attached: boolean;
  aiming: boolean;
  airborne: boolean;
}

export interface HudView {
  onScreenClick: (() => void) | null;
  onUiAction: ((act: UiAction, value: string | null, ev: Event) => void) | null;

  /** Real dt. Ages the message, tip, kill feed and damage indicators. */
  update(dt: number): void;
  setGameplayVisible(on: boolean): void;
  setDevice(pad: boolean): void;
  setMobile(state: MobileState): void;
  key(action: string): string;

  setAmmo(mag: number, reserve: number, magSize: number, reloading: boolean): void;
  setSlots(slots: SlotView[]): void;
  setGrenades(n: number): void;
  setBreath(frac: number): void;
  setHealth(hp: number, max: number): void;
  setSpread(px: number): void;
  setCrosshairMode(mode: '' | 'melee'): void;
  setAds(on: boolean): void;
  setScope(on: boolean, kind?: ScopeKind): void;
  /** The scoped overlay's drift off the eye line (its units, 1000 across) and scale; the reticle stays put. */
  setScopeDrift(x: number, y: number, scale: number): void;
  setGrappleTarget(state: 0 | 1 | 2): void;
  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void;
  /** The samurai execution's markers, in screen pixels; `n` is the lock number, 0 if not locked. */
  setExecMarks(marks: readonly { x: number; y: number; n: number }[]): void;
  setBoss(name: string | null, frac?: number): void;
  /** Arrows at the last enemies of a boss wave; an empty list hides them. */
  setStragglers(marks: readonly { x: number; y: number; a: number }[]): void;
  /** Squad marks in CSS pixels, each with its "NAME · 42m" label; an empty list hides them. */
  setMarks(marks: readonly { x: number; y: number; label: string }[]): void;
  /** The bar a waiting player reads: who it watches, and when it is back. An empty name hides it. */
  setSpectate(name: string, status?: string): void;
  /** Frames per second for the optional counter; null hides it. */
  setFps(fps: number | null): void;
  /** The one-time "Lower quality?" offer, naming the preset it would switch to; null hides it. */
  setQualityPrompt(preset: string | null): void;

  hitmarker(kill: boolean, crit: boolean, blocked?: boolean): void;
  damageFrom(angle: number): void;
  setScore(score: number, combo: number): void;
  setWave(wave: number, left: number): void;
  setModifier(text: string): void;
  setTimer(text: string): void;
  setWeapon(name: string, hint: string): void;
  message(main: string, sub?: string, dur?: number): void;
  tip(html: string, dur?: number): void;
  kill(text: string, pts?: number): void;

  setPvpScore(model: PvpModel | null): void;
  setBoard(model: BoardModel | null): void;

  showScreen(view: ScreenView): void;
  hideScreen(): void;

  dispose(): void;
}

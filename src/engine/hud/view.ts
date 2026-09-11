/**
 * The surface the engine drives the HUD through.
 *
 * `boot` holds one of these and calls it; it never touches the DOM. Phase 7
 * swapped the implementation from a DOM class to a store React subscribes to,
 * without the engine noticing — which is the point of the interface.
 *
 * `docs/ARCHITECTURE.md` §6.9 is the source of truth for every member here, and
 * for the rule that the HUD has setters only. `boardHidden()` is the single
 * permitted read-back.
 */
import type { UiAction } from './screens';

export interface SlotView {
  name: string;
  active: boolean;
  ammo: string;
  empty: boolean;
}

export interface HudView {
  onScreenClick: (() => void) | null;
  onUiAction: ((act: UiAction, value: string | null, ev: Event) => void) | null;

  /** Real dt. Ages the message, tip, kill feed and damage indicators. */
  update(dt: number): void;
  setGameplayVisible(on: boolean): void;
  setDevice(pad: boolean): void;
  key(action: string): string;
  controlsHTML(): string;

  setAmmo(mag: number, reserve: number, magSize: number, reloading: boolean): void;
  setKatanaAmmo(): void;
  setSlots(slots: SlotView[]): void;
  setGrenades(n: number): void;
  setBreath(frac: number): void;
  setHealth(hp: number, max: number): void;
  setSpread(px: number): void;
  setCrosshairMode(mode: '' | 'katana'): void;
  setAds(on: boolean): void;
  setScope(on: boolean): void;
  setGrappleTarget(state: 0 | 1 | 2): void;
  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void;
  setFocusMark(x: number | null, y?: number): void;
  setBoss(name: string | null, frac?: number): void;

  hitmarker(kill: boolean, crit: boolean): void;
  damageFrom(angle: number): void;
  setScore(score: number, combo: number): void;
  setWave(wave: number, left: number): void;
  setModifier(text: string): void;
  setTimer(text: string): void;
  setWeapon(name: string, hint: string): void;
  message(main: string, sub?: string, dur?: number): void;
  tip(html: string, dur?: number): void;
  kill(text: string, pts?: number): void;

  setPvpScore(html: string | null): void;
  setBoard(html: string | null): void;
  boardHidden(): boolean;

  showScreen(html: string): void;
  hideScreen(): void;

  dispose(): void;
}

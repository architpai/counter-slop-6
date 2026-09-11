/**
 * The HUD as data. React subscribes; the engine calls setters.
 *
 * The whole design exists to answer one question: how do you let React own a
 * HUD that is written to sixty times a second without re-rendering sixty times
 * a second? Three rules do it.
 *
 * 1. **Discrete values go through React.** Ammo, score, wave, weapon names and
 *    so on change on events, not on frames. Each lives in a slice object that is
 *    replaced *only* when a displayed value actually changes, so
 *    `useSyncExternalStore` gets a stable snapshot and React re-renders one leaf.
 *
 * 2. **Continuous values never reach React.** Spread, bar fills and the focus
 *    mark change every frame and have no structure worth diffing. They are
 *    written straight to CSS custom properties on the HUD root, which is what
 *    the crosshair already did before the port. Zero renders.
 *
 * 3. **Transient entries age in `update(dt)`.** The kill feed and damage
 *    indicators are lists whose identity changes on add and expiry only; the
 *    fade itself is a CSS animation. The engine already calls `update` with real
 *    dt every frame, so no per-entry timers are needed.
 *
 * The net effect: a frame in which nothing discrete changed costs a handful of
 * `style.setProperty` calls and no React work at all.
 */
import { key as keyLabel, controlsHTML } from './labels';
import type { HudView, SlotView } from './view';
import type { UiAction } from './screens';

const number = (value: unknown, fallback = 0): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const fraction = (value: unknown): number => Math.min(1, Math.max(0, number(value)));
const count = (value: unknown): number => Math.max(0, Math.floor(number(value)));

/** Every independently subscribable slice. One listener set per key. */
export type HudKey =
  | 'ammo' | 'slots' | 'grenades' | 'health' | 'score' | 'wave' | 'modifier'
  | 'timer' | 'weapon' | 'boss' | 'focus' | 'crosshair' | 'scope' | 'grapple'
  | 'message' | 'tip' | 'killFeed' | 'damage' | 'hitmarker' | 'pvp' | 'board'
  | 'screen' | 'device' | 'gameplay' | 'breath' | 'focusMark';

export interface AmmoState {
  magazine: string;
  reserve: string;
  reloading: boolean;
  /** Ammo tally pips, capped at 40. */
  tally: number;
  label: string;
}
export interface HealthState { hp: number; max: number; low: boolean }
/** Only the two flags live here; the fill itself is the `--breath` variable. */
export interface BreathState { shown: boolean; low: boolean; percent: number }
export interface ScoreState { score: number; combo: number }
export interface WaveState { wave: number; left: number }
export interface WeaponState { name: string; hint: string }
export interface BossState { name: string | null }
export interface FocusState { show: boolean; ready: boolean; label: string }
export interface CrosshairState { katana: boolean; ads: boolean }
export interface MessageState { main: string; sub: string; nonce: number }
export interface TipState { html: string; nonce: number }
export interface KillLine { id: number; text: string; points: number }
export interface DamageMark { id: number; angle: number }
export interface HitmarkerState { kill: boolean; crit: boolean; nonce: number }
export interface ScreenState { html: string | null }

/** Snapshot type for each subscription key. */
export interface HudState {
  ammo: AmmoState;
  slots: readonly SlotView[];
  grenades: number;
  health: HealthState;
  score: ScoreState;
  wave: WaveState;
  modifier: string;
  timer: string;
  weapon: WeaponState;
  boss: BossState;
  focus: FocusState;
  crosshair: CrosshairState;
  scope: boolean;
  grapple: 0 | 1 | 2;
  message: MessageState;
  tip: TipState;
  killFeed: readonly KillLine[];
  damage: readonly DamageMark[];
  hitmarker: HitmarkerState;
  pvp: string | null;
  board: string | null;
  screen: ScreenState;
  device: boolean;
  gameplay: boolean;
  breath: BreathState;
  focusMark: boolean;
}

const KILL_LIFE = 1.7;
const DAMAGE_LIFE = 1.0;
const MAX_KILL_LINES = 6;

export class HudStore implements HudView {
  onScreenClick: (() => void) | null = null;
  onUiAction: ((act: UiAction, value: string | null, ev: Event) => void) | null = null;

  #listeners = new Map<HudKey, Set<() => void>>();
  #lifecycleListeners = new Set<() => void>();
  #root: HTMLElement | null = null;
  #breathMeter: HTMLElement | null = null;
  #breathPercent = 100;
  #vars = new Map<string, string>();
  #nextId = 1;
  #messageT = 0;
  #tipT = 0;
  #ages = new Map<number, number>();
  #disposed = false;

  // ---- slices. Replaced on change, never mutated, so snapshots stay stable.
  ammo: AmmoState = { magazine: '30', reserve: '/120', reloading: false, tally: 30, label: '' };
  slots: readonly SlotView[] = [];
  grenades = 0;
  health: HealthState = { hp: 100, max: 100, low: false };
  breath: BreathState = { shown: false, low: false, percent: 100 };
  focusMark = false;
  score: ScoreState = { score: 0, combo: 0 };
  wave: WaveState = { wave: 1, left: 0 };
  modifier = '';
  timer = '';
  weapon: WeaponState = { name: 'RIFLE', hint: '' };
  boss: BossState = { name: null };
  focus: FocusState = { show: false, ready: false, label: 'KATANA' };
  crosshair: CrosshairState = { katana: false, ads: false };
  scope = false;
  grapple: 0 | 1 | 2 = 0;
  messageState: MessageState = { main: '', sub: '', nonce: 0 };
  tipState: TipState = { html: '', nonce: 0 };
  killFeed: readonly KillLine[] = [];
  damage: readonly DamageMark[] = [];
  hitmarkerState: HitmarkerState = { kill: false, crit: false, nonce: 0 };
  pvp: string | null = null;
  board: string | null = null;
  screen: ScreenState = { html: null };
  device = false;
  gameplay = false;

  // ---------------------------------------------------------------- plumbing

  /** React calls this once with the HUD root, for the CSS-variable channel. */
  bindRoot(el: HTMLElement | null): void {
    this.#root = el;
    this.#breathMeter = el?.querySelector<HTMLElement>('[data-hud="breath"]') ?? null;
    if (el) for (const [name, value] of this.#vars) el.style.setProperty(name, value);
    this.#breathMeter?.setAttribute('aria-valuenow', String(this.#breathPercent));
  }

  subscribe(key: HudKey, listener: () => void): () => void {
    let set = this.#listeners.get(key);
    if (!set) this.#listeners.set(key, set = new Set());
    set.add(listener);
    return () => { set.delete(listener); };
  }

  /** Returns the stored value itself; React relies on its stable identity. */
  getSnapshot<K extends HudKey>(key: K): HudState[K] {
    if (key === 'message') return this.messageState as HudState[K];
    if (key === 'tip') return this.tipState as HudState[K];
    if (key === 'hitmarker') return this.hitmarkerState as HudState[K];
    return this[key] as unknown as HudState[K];
  }

  subscribeLifecycle = (listener: () => void): (() => void) => {
    this.#lifecycleListeners.add(listener);
    return () => { this.#lifecycleListeners.delete(listener); };
  };

  isDisposed = (): boolean => this.#disposed;

  /** Reuse the React-owned view after a StrictMode effect cleanup. */
  activate(): void {
    if (!this.#disposed) return;
    this.#disposed = false;
    for (const listener of [...this.#lifecycleListeners]) listener();
  }

  #emit(key: HudKey): void {
    const set = this.#listeners.get(key);
    if (set) for (const listener of [...set]) listener();
  }

  /**
   * The no-render channel. Values are remembered so a remount can replay them,
   * because React may bind the root after the engine has already written some.
   */
  #setVar(name: string, value: string): void {
    if (this.#vars.get(name) === value) return;
    this.#vars.set(name, value);
    this.#root?.style.setProperty(name, value);
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    dt = Math.max(0, number(dt));
    if (this.#messageT > 0 && (this.#messageT -= dt) <= 0) {
      this.messageState = { main: '', sub: '', nonce: this.messageState.nonce };
      this.#emit('message');
    }
    if (this.#tipT > 0 && (this.#tipT -= dt) <= 0) {
      this.tipState = { html: '', nonce: this.tipState.nonce };
      this.#emit('tip');
    }
    this.#expire(dt);
  }

  /** Ages transient entries. Array identity changes only when one leaves. */
  #expire(dt: number): void {
    let killChanged = false, damageChanged = false;
    for (const [id, left] of this.#ages) {
      const next = left - dt;
      if (next > 0) { this.#ages.set(id, next); continue; }
      this.#ages.delete(id);
      if (this.killFeed.some(line => line.id === id)) killChanged = true;
      else damageChanged = true;
    }
    if (killChanged) {
      this.killFeed = this.killFeed.filter(line => this.#ages.has(line.id));
      this.#emit('killFeed');
    }
    if (damageChanged) {
      this.damage = this.damage.filter(mark => this.#ages.has(mark.id));
      this.#emit('damage');
    }
  }

  // ----------------------------------------------------------------- setters

  setGameplayVisible(on: boolean): void {
    if (this.gameplay === !!on) return;
    this.gameplay = !!on;
    this.#emit('gameplay');
  }

  setDevice(pad: boolean): void {
    if (this.device === !!pad) return;
    this.device = !!pad;
    this.#emit('device');
  }

  key(action: string): string { return keyLabel(action, this.device); }
  controlsHTML(): string { return controlsHTML(this.device); }

  setAmmo(mag: number, reserve: number, magSize: number, reloading: boolean): void {
    const rounds = count(mag);
    const next: AmmoState = {
      magazine: String(rounds),
      reserve: `/${count(reserve)}`,
      reloading: !!reloading,
      tally: Math.min(40, rounds),
      label: `${rounds} of ${count(magSize)} rounds`,
    };
    const now = this.ammo;
    if (now.magazine === next.magazine && now.reserve === next.reserve
      && now.reloading === next.reloading && now.tally === next.tally && now.label === next.label) return;
    this.ammo = next;
    this.#emit('ammo');
  }

  setKatanaAmmo(): void {
    if (this.ammo.magazine === '∞') return;
    this.ammo = { magazine: '∞', reserve: '', reloading: false, tally: 0, label: 'Unlimited' };
    this.#emit('ammo');
  }

  setSlots(slots: SlotView[]): void {
    const rows = Array.isArray(slots) ? slots : [];
    const same = rows.length === this.slots.length && rows.every((slot, i) => {
      const prev = this.slots[i];
      return prev !== undefined && prev.name === slot.name && prev.active === !!slot.active
        && prev.ammo === slot.ammo && prev.empty === !!slot.empty;
    });
    if (same) return;
    this.slots = rows.map(slot => ({
      name: slot.name, active: !!slot.active, ammo: slot.ammo, empty: !!slot.empty,
    }));
    this.#emit('slots');
  }

  setGrenades(n: number): void {
    const next = Math.min(5, count(n));
    if (next === this.grenades) return;
    this.grenades = next;
    this.#emit('grenades');
  }

  /**
   * The fill is continuous and goes to CSS. The two flags flip rarely — shown
   * when the bar appears at all, low at the 20% threshold — so they are worth a
   * render and spare the stylesheet a conditional it cannot express.
   */
  setBreath(frac: number): void {
    const value = fraction(frac);
    this.#breathPercent = Math.round(value * 100);
    this.#setVar('--breath', `${this.#breathPercent}%`);
    this.#breathMeter?.setAttribute('aria-valuenow', String(this.#breathPercent));
    const next: BreathState = { shown: value < 0.995, low: value < 0.2, percent: this.#breathPercent };
    if (next.shown === this.breath.shown && next.low === this.breath.low) return;
    this.breath = next;
    this.#emit('breath');
  }

  /** Bar fill is continuous; the HP integer and the low-health flag are not. */
  setHealth(hp: number, max: number): void {
    const value = number(hp);
    const limit = number(max);
    const frac = limit > 0 ? Math.max(0, value / limit) : 0;
    this.#setVar('--health', `${(frac * 100).toFixed(1)}%`);
    const next: HealthState = { hp: Math.ceil(value), max: limit, low: frac < 0.3 };
    if (next.hp === this.health.hp && next.max === this.health.max && next.low === this.health.low) return;
    this.health = next;
    this.#emit('health');
  }

  setSpread(px: number): void {
    this.#setVar('--spread', `${Math.max(0, number(px)).toFixed(1)}px`);
  }

  setCrosshairMode(mode: '' | 'katana'): void {
    const katana = mode === 'katana';
    if (this.crosshair.katana === katana) return;
    this.crosshair = { ...this.crosshair, katana };
    this.#emit('crosshair');
  }

  setAds(on: boolean): void {
    if (this.crosshair.ads === !!on) return;
    this.crosshair = { ...this.crosshair, ads: !!on };
    this.#emit('crosshair');
  }

  setScope(on: boolean): void {
    if (this.scope === !!on) return;
    this.scope = !!on;
    this.#emit('scope');
  }

  setGrappleTarget(state: 0 | 1 | 2): void {
    const next = state === 1 || state === 2 ? state : 0;
    if (next === this.grapple) return;
    this.grapple = next;
    this.#emit('grapple');
  }

  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void {
    this.#setVar('--focus', `${fraction(frac) * 100}%`);
    const next: FocusState = { show: !!show, ready: !!ready, label: String(label ?? '') };
    if (next.show === this.focus.show && next.ready === this.focus.ready && next.label === this.focus.label) return;
    this.focus = next;
    this.#emit('focus');
  }

  setFocusMark(x: number | null, y?: number): void {
    const show = x !== null && y !== undefined && Number.isFinite(x) && Number.isFinite(y);
    if (show) {
      this.#setVar('--focus-mark-x', `${Math.round(x)}px`);
      this.#setVar('--focus-mark-y', `${Math.round(y)}px`);
    }
    if (show === this.focusMark) return;
    this.focusMark = show;
    this.#emit('focusMark');
  }

  setBoss(name: string | null, frac?: number): void {
    if (name != null) this.#setVar('--boss', `${fraction(frac) * 100}%`);
    const next = name == null ? null : String(name);
    if (next === this.boss.name) return;
    this.boss = { name: next };
    this.#emit('boss');
  }

  // ------------------------------------------------------------------ events

  hitmarker(kill: boolean, crit: boolean): void {
    // The nonce is what makes a second hit during the first animation restart it.
    this.hitmarkerState = { kill: !!kill, crit: !!crit, nonce: this.hitmarkerState.nonce + 1 };
    this.#emit('hitmarker');
  }

  damageFrom(angle: number): void {
    if (!Number.isFinite(angle)) return;
    const id = this.#nextId++;
    this.#ages.set(id, DAMAGE_LIFE);
    this.damage = [...this.damage, { id, angle }];
    this.#emit('damage');
  }

  setScore(score: number, combo: number): void {
    const next: ScoreState = { score: number(score), combo: count(combo) };
    if (next.score === this.score.score && next.combo === this.score.combo) return;
    this.score = next;
    this.#emit('score');
  }

  setWave(wave: number, left: number): void {
    const next: WaveState = { wave: count(wave), left: count(left) };
    if (next.wave === this.wave.wave && next.left === this.wave.left) return;
    this.wave = next;
    this.#emit('wave');
  }

  setModifier(text: string): void {
    const next = String(text ?? '');
    if (next === this.modifier) return;
    this.modifier = next;
    this.#emit('modifier');
  }

  setTimer(text: string): void {
    const next = String(text ?? '');
    if (next === this.timer) return;
    this.timer = next;
    this.#emit('timer');
  }

  setWeapon(name: string, hint: string): void {
    const next: WeaponState = { name: String(name ?? ''), hint: String(hint ?? '') };
    if (next.name === this.weapon.name && next.hint === this.weapon.hint) return;
    this.weapon = next;
    this.#emit('weapon');
  }

  message(main: string, sub = '', dur = 2.2): void {
    this.#messageT = Math.max(0, number(dur));
    this.messageState = {
      main: this.#messageT > 0 ? String(main ?? '') : '',
      sub: this.#messageT > 0 ? String(sub ?? '') : '',
      nonce: this.messageState.nonce + 1,
    };
    this.#emit('message');
  }

  tip(html: string, dur = 5): void {
    this.#tipT = Math.max(0, number(dur));
    this.tipState = {
      html: this.#tipT > 0 ? String(html ?? '') : '',
      nonce: this.tipState.nonce + 1,
    };
    this.#emit('tip');
  }

  kill(text: string, pts = 0): void {
    const id = this.#nextId++;
    this.#ages.set(id, KILL_LIFE);
    const line: KillLine = { id, text: String(text ?? ''), points: number(pts) };
    const next = [...this.killFeed, line];
    while (next.length > MAX_KILL_LINES) {
      const dropped = next.shift();
      if (dropped) this.#ages.delete(dropped.id);
    }
    this.killFeed = next;
    this.#emit('killFeed');
  }

  setPvpScore(html: string | null): void {
    const next = html == null ? null : String(html);
    if (next !== this.pvp) {
      this.pvp = next;
      this.#emit('pvp');
    }
    if (next != null) this.setModifier('');
  }

  setBoard(html: string | null): void {
    const next = html == null ? null : String(html);
    if (next === this.board) return;
    this.board = next;
    this.#emit('board');
  }

  boardHidden(): boolean { return this.board == null || this.screen.html != null; }

  showScreen(html: string): void {
    this.screen = { html: String(html ?? '') };
    this.#emit('screen');
  }

  hideScreen(): void {
    if (this.screen.html === null) return;
    this.screen = { html: null };
    this.#emit('screen');
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.onScreenClick = this.onUiAction = null;
    this.#ages.clear();
    this.killFeed = [];
    this.damage = [];
    for (const listener of [...this.#lifecycleListeners]) listener();
  }
}

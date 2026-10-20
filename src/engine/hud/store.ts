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
 *    written straight to CSS custom properties. Zero renders. Each per-frame
 *    variable goes on the element that reads it (`hostRef`), not on the HUD
 *    root: custom properties inherit, so a root write restyles the whole HUD
 *    every frame (~70 elements, 0.2-0.4 ms of main thread in a fight), where a
 *    host write restyles only the host's own subtree.
 *
 * 3. **Transient entries age in `update(dt)`.** The kill feed and damage
 *    indicators are lists whose identity changes on add and expiry only; the
 *    fade itself is a CSS animation. The engine already calls `update` with real
 *    dt every frame, so no per-entry timers are needed.
 *
 * The net effect: a frame in which nothing discrete changed costs a handful of
 * `style.setProperty` calls and no React work at all.
 */
import { key as keyLabel } from './labels';
import type { HudView, SlotView, MobileState } from './view';
import type { BoardModel, PvpModel, ScreenView, UiAction } from './screens';
import type { ScopeKind } from '../weapons/stats';

const number = (value: unknown, fallback = 0): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const fraction = (value: unknown): number => Math.min(1, Math.max(0, number(value)));
const count = (value: unknown): number => Math.max(0, Math.floor(number(value)));

/** Every independently subscribable slice. One listener set per key. */
export type HudKey =
  | 'ammo' | 'slots' | 'grenades' | 'health' | 'score' | 'wave' | 'modifier'
  | 'timer' | 'weapon' | 'boss' | 'focus' | 'crosshair' | 'scope' | 'grapple'
  | 'message' | 'tip' | 'killFeed' | 'damage' | 'hitmarker' | 'pvp' | 'board'
  | 'screen' | 'device' | 'mobile' | 'gameplay' | 'breath' | 'execMarks' | 'stragglers' | 'marks' | 'spectate' | 'fps' | 'qualityPrompt';

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
export interface CrosshairState { melee: boolean; ads: boolean }
export interface ScopeState { shown: boolean; kind: ScopeKind }
/** Who a waiting player watches, and when it is back. An empty name hides the bar. */
export interface SpectateState { name: string; status: string }
export interface MessageState { main: string; sub: string; nonce: number }
export interface TipState { html: string; nonce: number }
export interface KillLine { id: number; text: string; points: number }
export interface DamageMark { id: number; angle: number }
export interface HitmarkerState { kill: boolean; crit: boolean; blocked: boolean; nonce: number; killNonce: number }

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
  scope: ScopeState;
  grapple: 0 | 1 | 2;
  message: MessageState;
  tip: TipState;
  killFeed: readonly KillLine[];
  damage: readonly DamageMark[];
  hitmarker: HitmarkerState;
  pvp: PvpModel | null;
  board: BoardModel | null;
  screen: ScreenView | null;
  device: boolean;
  mobile: MobileState;
  gameplay: boolean;
  breath: BreathState;
  /** One entry per execution marker: 0 unlocked, else its lock number; each one's place is `--exec-<i>`. */
  execMarks: readonly number[];
  /** How many straggler arrows; each one's place is the `--straggler-<i>` variable. */
  stragglers: number;
  /** One label for each squad mark; each one's place is the `--mark-<i>` variable. */
  marks: readonly string[];
  spectate: SpectateState;
  fps: number | null;
  qualityPrompt: string | null;
}

/**
 * The per-frame variables, written on their readers (`hostRef`) instead of the root. The root keeps their defaults
 * (`.game-hud` in globals.css) and every other variable (`--scope-*`).
 */
const HOSTED = /^--(?:spread|health|breath|focus|boss|exec-\d+|straggler-\d+|mark-\d+)$/;
export const isHostedVar = (name: string): boolean => HOSTED.test(name);

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
  /** Mounted readers of each hosted variable. */
  #hosts = new Map<string, Set<HTMLElement>>();
  /** One stable ref callback per variable, so React does not detach and re-attach it on every render. */
  #hostRefs = new Map<string, (el: HTMLElement | null) => () => void>();
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
  execMarks: readonly number[] = [];
  stragglers = 0;
  marks: readonly string[] = [];
  spectate: SpectateState = { name: '', status: '' };
  score: ScoreState = { score: 0, combo: 0 };
  wave: WaveState = { wave: 1, left: 0 };
  modifier = '';
  timer = '';
  weapon: WeaponState = { name: 'R4-C', hint: '' };
  boss: BossState = { name: null };
  focus: FocusState = { show: false, ready: false, label: 'MELEE' };
  crosshair: CrosshairState = { melee: false, ads: false };
  scope: ScopeState = { shown: false, kind: 'sniper' };
  grapple: 0 | 1 | 2 = 0;
  messageState: MessageState = { main: '', sub: '', nonce: 0 };
  tipState: TipState = { html: '', nonce: 0 };
  killFeed: readonly KillLine[] = [];
  damage: readonly DamageMark[] = [];
  hitmarkerState: HitmarkerState = { kill: false, crit: false, blocked: false, nonce: 0, killNonce: 0 };
  pvp: PvpModel | null = null;
  board: BoardModel | null = null;
  screen: ScreenView | null = null;
  device = false;
  mobile: MobileState = { active: false, enabled: false, portrait: false, interrupted: false, online: false, attached: false, aiming: false, airborne: false };
  gameplay = false;
  fps: number | null = null;
  qualityPrompt: string | null = null;

  // ---------------------------------------------------------------- plumbing

  /** React calls this once with the HUD root, for the CSS-variable channel. */
  bindRoot(el: HTMLElement | null): void {
    this.#root = el;
    this.#breathMeter = el?.querySelector<HTMLElement>('[data-hud="breath"]') ?? null;
    if (el) for (const [name, value] of this.#vars) if (!HOSTED.test(name)) el.style.setProperty(name, value);
    this.#breathMeter?.setAttribute('aria-valuenow', String(this.#breathPercent));
  }

  /**
   * Registers `el` as a reader of the hosted variable `name` until the returned cleanup runs, and writes the value
   * remembered for it at once: a host can remount (a bar, a marker) long after the engine wrote, without `bindRoot`.
   */
  bindVarHost(name: string, el: HTMLElement): () => void {
    let set = this.#hosts.get(name);
    if (!set) this.#hosts.set(name, set = new Set());
    set.add(el);
    const value = this.#vars.get(name);
    if (value !== undefined) el.style.setProperty(name, value);
    return () => { set.delete(el); };
  }

  /** A stable React ref callback (React 19: the returned cleanup runs on detach) that hosts the variable `name`. */
  hostRef(name: string): (el: HTMLElement | null) => () => void {
    let ref = this.#hostRefs.get(name);
    if (!ref) {
      ref = (el: HTMLElement | null) => (el ? this.bindVarHost(name, el) : () => {});
      this.#hostRefs.set(name, ref);
    }
    return ref;
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
    if (!HOSTED.test(name)) { this.#root?.style.setProperty(name, value); return; }
    const hosts = this.#hosts.get(name);
    if (hosts) for (const el of hosts) el.style.setProperty(name, value);
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

  setMobile(state: MobileState): void {
    if ((Object.keys(state) as (keyof MobileState)[]).every(key => state[key] === this.mobile[key])) return;
    this.mobile = state;
    this.#emit('mobile');
  }

  key(action: string): string { return this.mobile.active ? 'Tap' : keyLabel(action, this.device); }

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
    const percent = Math.round(value * 100);
    const changed = percent !== this.#breathPercent;
    this.#breathPercent = percent;
    this.#setVar('--breath', `${this.#breathPercent}%`);
    if (changed) this.#breathMeter?.setAttribute('aria-valuenow', String(this.#breathPercent));
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

  setCrosshairMode(mode: '' | 'melee'): void {
    const melee = mode === 'melee';
    if (this.crosshair.melee === melee) return;
    this.crosshair = { ...this.crosshair, melee };
    this.#emit('crosshair');
  }

  setAds(on: boolean): void {
    if (this.crosshair.ads === !!on) return;
    this.crosshair = { ...this.crosshair, ads: !!on };
    this.#emit('crosshair');
  }

  setScope(on: boolean, kind: ScopeKind = 'sniper'): void {
    if (this.scope.shown === !!on && this.scope.kind === kind) return;
    this.scope = { shown: !!on, kind };
    this.#emit('scope');
  }

  setScopeDrift(x: number, y: number, scale: number): void {
    this.#setVar('--scope-x', number(x).toFixed(1));
    this.#setVar('--scope-y', number(y).toFixed(1));
    this.#setVar('--scope-scale', number(scale, 1).toFixed(3));
  }

  setGrappleTarget(state: 0 | 1 | 2): void {
    const next = state === 1 || state === 2 ? state : 0;
    if (next === this.grapple) return;
    this.grapple = next;
    this.#emit('grapple');
  }

  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void {
    this.#setVar('--focus', `${(fraction(frac) * 100).toFixed(1)}%`);
    const next: FocusState = { show: !!show, ready: !!ready, label: String(label ?? '') };
    if (next.show === this.focus.show && next.ready === this.focus.ready && next.label === this.focus.label) return;
    this.focus = next;
    this.#emit('focus');
  }

  setExecMarks(marks: readonly { x: number; y: number; n: number }[]): void {
    const rows = marks.filter(m => Number.isFinite(m.x) && Number.isFinite(m.y));
    rows.forEach((m, i) => this.#setVar(`--exec-${i}`, `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`));
    if (rows.length === this.execMarks.length && rows.every((m, i) => m.n === this.execMarks[i])) return;
    this.execMarks = rows.map(m => count(m.n));
    this.#emit('execMarks');
  }

  setStragglers(marks: readonly { x: number; y: number; a: number }[]): void {
    marks.forEach((m, i) => this.#setVar(`--straggler-${i}`, `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px) rotate(${m.a.toFixed(2)}rad)`));
    if (marks.length === this.stragglers) return;
    this.stragglers = marks.length;
    this.#emit('stragglers');
  }
  setMarks(marks: readonly { x: number; y: number; label: string }[]): void {
    marks.forEach((m, i) => this.#setVar(`--mark-${i}`, `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`));
    if (marks.length === this.marks.length && marks.every((m, i) => m.label === this.marks[i])) return;
    this.marks = marks.map(m => m.label);
    this.#emit('marks');
  }

  setBoss(name: string | null, frac?: number): void {
    if (name != null) this.#setVar('--boss', `${fraction(frac) * 100}%`);
    const next = name == null ? null : String(name);
    if (next === this.boss.name) return;
    this.boss = { name: next };
    this.#emit('boss');
  }

  /** Called twice a second at most, so a React leaf render is fine here. */
  setFps(fps: number | null): void {
    const next = fps === null || !Number.isFinite(fps) ? null : Math.round(fps);
    if (next === this.fps) return;
    this.fps = next;
    this.#emit('fps');
  }

  setQualityPrompt(preset: string | null): void {
    const next = preset === null ? null : String(preset);
    if (next === this.qualityPrompt) return;
    this.qualityPrompt = next;
    this.#emit('qualityPrompt');
  }

  // ------------------------------------------------------------------ events

  hitmarker(kill: boolean, crit: boolean, blocked = false): void {
    // Separate event counters let the kill skull finish while later hits flash.
    this.hitmarkerState = {
      kill: !!kill && !blocked, crit: !!crit && !blocked, blocked: !!blocked,
      nonce: this.hitmarkerState.nonce + 1,
      killNonce: this.hitmarkerState.killNonce + (kill && !blocked ? 1 : 0),
    };
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

  setSpectate(name: string, status = ''): void {
    const next: SpectateState = { name: String(name ?? ''), status: name ? String(status ?? '') : '' };
    if (next.name === this.spectate.name && next.status === this.spectate.status) return;
    this.spectate = next;
    this.#emit('spectate');
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

  setPvpScore(model: PvpModel | null): void {
    if (model !== null || this.pvp !== null) {
      this.pvp = model;
      this.#emit('pvp');
    }
    if (model != null) this.setModifier('');
  }

  setBoard(model: BoardModel | null): void {
    if (model === null && this.board === null) return;
    this.board = model;
    this.#emit('board');
  }


  showScreen(view: ScreenView): void {
    this.screen = view;
    this.#emit('screen');
  }

  hideScreen(): void {
    if (this.screen === null) return;
    this.screen = null;
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

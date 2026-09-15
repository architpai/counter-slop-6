import { TouchInput } from './touch';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/**
 * Every named action the game can ask about. `ARCHITECTURE.md` §6.2 is the
 * source of truth for this list; the binding tables below may only use these.
 */
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'reload'
  | 'grapple' | 'melee' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'pause'
  | 'confirm' | 'grenade' | 'dash' | 'music' | 'talk' | 'score' | 'fire' | 'aim'
  | 'nextWeapon' | 'prevWeapon';

const KEYS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', KeyC: 'crouch', KeyR: 'reload',
  KeyQ: 'grapple', KeyE: 'grapple', KeyF: 'melee', KeyV: 'melee',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5', Digit6: 'melee',
  Escape: 'pause', KeyP: 'pause', Enter: 'confirm', KeyG: 'grenade',
  KeyX: 'dash', AltLeft: 'dash', KeyM: 'music', KeyT: 'talk', Tab: 'score',
};
const MOUSE: readonly Action[] = ['fire', 'grapple', 'aim', 'grapple', 'melee'];
const PAD: readonly (Action | null)[] = [
  'jump', 'crouch', 'reload', 'nextWeapon', 'grapple', 'melee', 'aim', 'fire',
  'score', 'pause', 'sprint', 'grenade', 'grenade', 'melee', 'prevWeapon',
  'nextWeapon', null, 'confirm',
];
const PREVENT: ReadonlySet<string> = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown']);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const deadzone = (v: number) => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 1.8;

/** The parts of a focused node `editing` duck-types. Both may be absent. */
interface MaybeEditable {
  isContentEditable?: boolean;
  closest?: (selectors: string) => Element | null;
}
const nodeLike = (el: unknown): el is MaybeEditable => typeof el === 'object' && el !== null;
const editing = (el: EventTarget | null | undefined) =>
  !!(nodeLike(el) && (el.isContentEditable || el.closest?.('input, textarea, select, .control-editor')));

/** `requestPointerLock` / `exitPointerLock` return a promise only in newer browsers. */
const thenable = (v: unknown): v is PromiseLike<unknown> =>
  typeof v === 'object' && v !== null && 'then' in v && typeof v.then === 'function';

export class Input {
  #canvas: HTMLCanvasElement;
  #doc: Document;
  #win: Window & typeof globalThis;
  #listeners: (() => void)[] = [];
  #keys = new Set<Action>();
  #mouse = new Set<Action>();
  #current = new Set<Action>();
  #previous = new Set<Action>();
  #padCurrent = new Set<Action>();
  #padPrevious = new Set<Action>();
  #dx = 0;
  #dy = 0;
  #wheel = 0;
  #padIndex: number | null = null;
  #pad: Gamepad | null = null;
  #padHold = 0;
  #device: InputDevice = 'keyboard';
  #lastTouch = -Infinity;
  readonly touch = new TouchInput();
  touchSens = 0.004;
  #lockWanted = false;
  #lockPending = false;
  #lockUsesPromise = false;
  #lockRaw = false;
  #lockAttempt = 0;
  /** `Window.setTimeout` handle, a number. Never `NodeJS.Timeout`. */
  #lockRetry: number | null = null;
  #disposed = false;

  readonly move: { x: number; y: number };
  readonly look: { x: number; y: number };
  mouseSens: number;
  /** Scoped settings divided by general look sensitivity, so the controls are independent. */
  acogScale = 1.2;
  sniperScale = 1.5;
  padSensX: number;
  padSensY: number;
  invertY: boolean;
  anyInput: boolean;
  onLockChange: ((locked: boolean) => void) | null;
  onDeviceChange: ((device: InputDevice) => void) | null;

  constructor(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#doc = canvas.ownerDocument;
    const win = this.#doc.defaultView;
    // A detached document has no window; every listener below would throw anyway.
    if (!win) throw new Error('Input: canvas document has no window');
    this.#win = win;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mouseSens = 0.0022;
    this.padSensX = 3.4;
    this.padSensY = 2.6;
    this.invertY = false;
    this.anyInput = false;
    this.onLockChange = null;
    this.onDeviceChange = null;
    if (win.navigator.maxTouchPoints > 0 && win.matchMedia('(pointer: coarse)').matches) this.#device = 'touch';
    this.#listen(this.#win, 'pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      this.#lastTouch = performance.now();
      this.anyInput = true;
      this.#setDevice('touch');
    }, { capture: true });

    const noteTouch = (e: PointerEvent) => {
      if (e.pointerType === 'touch') this.#lastTouch = performance.now();
    };
    this.#listen(this.#win, 'pointerup', noteTouch, { capture: true });
    this.#listen(this.#win, 'pointercancel', noteTouch, { capture: true });
    this.#listen(this.#win, 'keydown', e => {
      if (e.repeat) return;
      this.anyInput = true;
      if (editing(e.target) || editing(this.#doc.activeElement)) {
        this.#clearRaw();
        return;
      }
      this.#setDevice('keyboard');
      const action = KEYS[e.code];
      if (action) this.#keys.add(action);
      // An event without Shift must never leave sprint held, including Shift itself.
      if (!e.shiftKey) this.#keys.delete('sprint');
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    this.#listen(this.#win, 'keyup', e => {
      const action = KEYS[e.code];
      if (action) this.#keys.delete(action);
      if (!e.shiftKey) this.#keys.delete('sprint');
    });
    this.#listen(this.#win, 'mousedown', e => {
      if (this.#compatibilityMouse(e)) return;
      this.anyInput = true;
      this.#setDevice('keyboard');
      if (editing(e.target) || editing(this.#doc.activeElement) || this.#menuTarget(e.target)) return;
      const action = MOUSE[e.button];
      if (action) this.#mouse.add(action);
      if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
    });
    this.#listen(this.#win, 'mouseup', e => {
      if (this.#compatibilityMouse(e)) return;
      const action = MOUSE[e.button];
      if (action) this.#mouse.delete(action);
    });
    this.#listen(this.#win, 'mousemove', e => {
      if (!this.locked || editing(this.#doc.activeElement)) return;
      this.#dx += Math.abs(e.movementX) <= 400 ? e.movementX : 0;
      this.#dy += Math.abs(e.movementY) <= 400 ? e.movementY : 0;
      if (this.#device === 'touch') this.#setDevice('keyboard');
      else this.#device = 'keyboard'; // Preserve the silent mouse/gamepad switch.
      this.anyInput = true;
    });
    this.#listen(this.#win, 'wheel', e => {
      this.anyInput = true;
      if (!editing(e.target) && !editing(this.#doc.activeElement) && !this.#menuTarget(e.target)) {
        this.#wheel += Math.sign(e.deltaY);
      }
    }, { passive: true });
    this.#listen(this.#win, 'contextmenu', e => e.preventDefault());
    this.#listen(this.#win, 'blur', () => this.#clearRaw());
    this.#listen(this.#doc, 'visibilitychange', () => {
      if (this.#doc.hidden) this.#clearRaw();
    });
    this.#listen(this.#doc, 'focusin', e => {
      if (editing(e.target)) this.#clearRaw();
    });
    this.#listen(this.#win, 'gamepadconnected', e => {
      if (e.gamepad.mapping === 'standard') this.#padIndex = e.gamepad.index;
    });
    this.#listen(this.#win, 'gamepaddisconnected', e => {
      if (e.gamepad.index === this.#padIndex) {
        this.#padIndex = null;
        this.#pad = null;
        this.#padHold = 0;
      }
    });
    this.#listen(this.#doc, 'pointerlockchange', () => {
      if (this.locked) this.#cancelRetry();
      this.onLockChange?.(this.locked);
    });
    this.#listen(this.#doc, 'pointerlockerror', () => {
      // Modern browsers also reject the promise. Handle each failure only once.
      if (this.#lockPending && !this.#lockUsesPromise) this.#lockFailed(this.#lockAttempt);
    });
  }

  get usingGamepad(): boolean { return this.#device === 'gamepad'; }
  get usingTouch(): boolean { return this.#device === 'touch'; }
  get device(): InputDevice { return this.#device; }
  get locked(): boolean { return this.#doc.pointerLockElement === this.#canvas; }

  #listen<K extends keyof WindowEventMap>(
    target: Window, type: K, fn: (e: WindowEventMap[K]) => void, options?: AddEventListenerOptions,
  ): void;
  #listen<K extends keyof DocumentEventMap>(
    target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, options?: AddEventListenerOptions,
  ): void;
  #listen(target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions) {
    target.addEventListener(type, fn, options);
    this.#listeners.push(() => target.removeEventListener(type, fn, options));
  }

  #menuTarget(target: EventTarget | null): boolean {
    return !!(nodeLike(target) && target.closest?.('[data-ui-block], .screen-overlay, .control-editor'));
  }

  #compatibilityMouse(event: MouseEvent): boolean {
    return !!(event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents
      || performance.now() - this.#lastTouch < 800;
  }

  #setDevice(device: InputDevice) {
    if (this.#device === device) return;
    this.clearTouch();
    this.#device = device;
    if (device === 'touch') { this.#clearRaw(); this.exitLock(); }
    else this.touch.enabled = false;
    this.onDeviceChange?.(device);
  }

  clearTouch(): void {
    for (const action of this.touch.frame) this.#current.delete(action);
    this.touch.reset();
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
  }

  #clearRaw() {
    this.clearTouch();
    this.#keys.clear();
    this.#mouse.clear();
    this.#dx = this.#dy = this.#wheel = this.#padHold = 0;
  }

  update(dt: number) {
    if (this.#disposed) return;
    [this.#previous, this.#current] = [this.#current, this.#previous];
    [this.#padPrevious, this.#padCurrent] = [this.#padCurrent, this.#padPrevious];
    this.#current.clear();
    this.#padCurrent.clear();
    const blocked = this.#doc.hidden || editing(this.#doc.activeElement);
    if (blocked) this.#clearRaw();
    for (const a of this.#keys) this.#current.add(a);
    for (const a of this.#mouse) this.#current.add(a);
    if (this.#wheel) this.#current.add(this.#wheel > 0 ? 'nextWeapon' : 'prevWeapon');
    this.#wheel = 0;
    this.move.x = Number(this.down('right')) - Number(this.down('left'));
    this.move.y = Number(this.down('forward')) - Number(this.down('back'));
    this.look.x = -this.#dx * this.mouseSens;
    this.look.y = -this.#dy * this.mouseSens;
    this.#dx = this.#dy = 0;

    this.#pollPad(blocked ? 0 : dt, blocked);
    this.touch.sample();
    if (this.usingTouch && !blocked) {
      for (const action of this.touch.frame) this.#current.add(action);
      this.move.x = this.touch.move.x; this.move.y = this.touch.move.y;
      this.look.x -= this.touch.look.x * this.touchSens;
      this.look.y -= this.touch.look.y * this.touchSens;
    }
    this.touch.look.x = this.touch.look.y = 0;
    const length = Math.hypot(this.move.x, this.move.y);
    if (length > 1) {
      this.move.x /= length;
      this.move.y /= length;
    }
    if (this.invertY) this.look.y = -this.look.y;
  }

  #pollPad(dt: number, blocked: boolean) {
    let pads: readonly (Gamepad | null)[];
    try { pads = this.#win.navigator.getGamepads?.() || []; }
    catch { pads = []; } // The browser can deny Gamepad API access in an iframe.
    const usable = (p: Gamepad | null | undefined): p is Gamepad =>
      !!p && p.connected !== false && p.mapping === 'standard';
    this.#pad = (this.#padIndex === null ? null : pads[this.#padIndex]) ?? null;
    if (!usable(this.#pad)) this.#pad = Array.from(pads).find(usable) || null;
    if (!this.#pad || blocked) {
      this.#padHold = 0;
      return;
    }
    this.#padIndex = this.#pad.index;
    const axes = this.#pad.axes;
    const lx = deadzone(axes[0] || 0), ly = deadzone(axes[1] || 0);
    const rx = deadzone(axes[2] || 0), ry = deadzone(axes[3] || 0);
    const active = !!(lx || ly || rx || ry || this.#pad.buttons.some(b => b && (b.pressed || b.value > .35)));
    if (active) {
      this.anyInput = true;
      this.#setDevice('gamepad');
    }
    for (let i = 0; i < this.#pad.buttons.length; i++) {
      const b = this.#pad.buttons[i];
      if (!b || (!b.pressed && !(b.value > 0.35))) continue;
      const action = PAD[i];
      if (action) {
        this.#padCurrent.add(action);
        this.#current.add(action);
      }
    }
    if (lx || ly) {
      this.move.x = lx;
      this.move.y = -ly;
    }
    this.#padHold = Math.hypot(rx, ry) > 0.94 ? this.#padHold + dt : 0;
    if (rx || ry) {
      const acceleration = 1 + clamp((this.#padHold - 0.25) / 0.6, 0, 1) * 0.9;
      this.look.x -= curve(rx) * this.padSensX * acceleration * dt;
      this.look.y -= curve(ry) * this.padSensY * acceleration * dt;
    }
  }

  down(action: Action): boolean { return this.#current.has(action); }
  pressed(action: Action): boolean {
    return this.down(action) && (this.touch.edges.has(action) || !this.#previous.has(action)
      || (this.#padCurrent.has(action) && !this.#padPrevious.has(action)));
  }
  released(action: Action): boolean { return !this.down(action) && this.#previous.has(action); }
  consume(action: Action): void { this.#current.delete(action); }
  anyPressed(): boolean {
    for (const action of this.#current) if (!this.#previous.has(action)) return true;
    return false;
  }

  requestLock() {
    if (this.#disposed || this.usingTouch) return;
    this.#lockWanted = true;
    if (this.locked || this.#lockPending) return;
    this.#cancelRetry();
    this.#tryLock(true);
  }

  #tryLock(raw: boolean) {
    if (!this.#lockWanted || this.#disposed || this.locked) return;
    const attempt = ++this.#lockAttempt;
    this.#lockRaw = raw;
    this.#lockPending = true;
    this.#lockUsesPromise = false;
    try {
      const result: unknown = raw ? this.#canvas.requestPointerLock({ unadjustedMovement: true })
        : this.#canvas.requestPointerLock();
      if (thenable(result)) {
        this.#lockUsesPromise = true;
        Promise.resolve(result).then(() => {
          if ((!this.#lockWanted || this.#disposed) && this.locked) this.exitLock();
        }, () => this.#lockFailed(attempt));
      }
    } catch { this.#lockFailed(attempt); }
  }

  #lockFailed(attempt: number) {
    if (attempt !== this.#lockAttempt || !this.#lockPending) return;
    this.#lockPending = false;
    if (!this.#lockWanted || this.#disposed || this.locked) return;
    if (this.#lockRaw) this.#tryLock(false);
    else this.#lockRetry = this.#win.setTimeout(() => {
      this.#lockRetry = null;
      if (this.#lockWanted && !this.locked) this.requestLock();
    }, 1200);
  }

  #cancelRetry() {
    if (this.#lockRetry !== null) this.#win.clearTimeout(this.#lockRetry);
    this.#lockRetry = null;
    this.#lockPending = false;
    this.#lockAttempt++;
  }

  exitLock() {
    this.#lockWanted = false;
    this.#cancelRetry();
    if (this.#doc.pointerLockElement) {
      try {
        const result: unknown = this.#doc.exitPointerLock();
        if (thenable(result)) result.then(undefined, () => {});
      } catch {}
    }
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    try {
      const result: unknown = this.#pad?.vibrationActuator?.playEffect('dual-rumble', {
        duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1),
      });
      if (thenable(result)) result.then(undefined, () => {});
    } catch {}
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.touch.enabled = false;
    if (this.locked) this.exitLock();
    this.#lockWanted = false;
    this.#cancelRetry();
    for (const remove of this.#listeners) remove();
    this.#listeners.length = 0;
    this.#clearRaw();
    this.#current.clear();
    this.#previous.clear();
    this.#padCurrent.clear();
    this.#padPrevious.clear();
    this.#pad = null;
    this.move.x = this.move.y = this.look.x = this.look.y = 0;
    this.onLockChange = this.onDeviceChange = null;
  }
}

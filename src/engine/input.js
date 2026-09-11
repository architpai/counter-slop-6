const KEYS = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  ControlLeft: 'crouch', KeyC: 'crouch', KeyR: 'reload',
  KeyQ: 'grapple', KeyE: 'grapple', KeyF: 'melee', KeyV: 'melee',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5',
  Escape: 'pause', KeyP: 'pause', Enter: 'confirm', KeyG: 'grenade',
  KeyX: 'dash', AltLeft: 'dash', KeyM: 'music', KeyT: 'talk', Tab: 'score',
};
const MOUSE = ['fire', 'grapple', 'aim', 'grapple', 'melee'];
const PAD = [
  'jump', 'crouch', 'reload', 'nextWeapon', 'grapple', 'melee', 'aim', 'fire',
  'score', 'pause', 'sprint', 'grenade', 'grenade', 'slot5', 'prevWeapon',
  'nextWeapon', null, 'confirm',
];
const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown']);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deadzone = v => Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86;
const curve = v => Math.sign(v) * Math.abs(v) ** 1.8;
const editing = el => !!(el?.isContentEditable || el?.closest?.('input, textarea, select'));

export class Input {
  #canvas;
  #doc;
  #win;
  #listeners = [];
  #keys = new Set();
  #mouse = new Set();
  #current = new Set();
  #previous = new Set();
  #padCurrent = new Set();
  #padPrevious = new Set();
  #dx = 0;
  #dy = 0;
  #wheel = 0;
  #padIndex = null;
  #pad = null;
  #padHold = 0;
  #usingGamepad = false;
  #lockWanted = false;
  #lockPending = false;
  #lockUsesPromise = false;
  #lockRaw = false;
  #lockAttempt = 0;
  #lockRetry = null;
  #disposed = false;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#doc = canvas.ownerDocument;
    this.#win = this.#doc.defaultView;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.mouseSens = 0.0022;
    this.padSensX = 3.4;
    this.padSensY = 2.6;
    this.invertY = false;
    this.anyInput = false;
    this.onLockChange = null;
    this.onDeviceChange = null;

    this.#listen(this.#win, 'keydown', e => {
      if (e.repeat) return;
      this.anyInput = true;
      this.#setDevice(false);
      if (editing(e.target) || editing(this.#doc.activeElement)) {
        this.#clearRaw();
        return;
      }
      if (KEYS[e.code]) this.#keys.add(KEYS[e.code]);
      // An event without Shift must never leave sprint held, including Shift itself.
      if (!e.shiftKey) this.#keys.delete('sprint');
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    this.#listen(this.#win, 'keyup', e => {
      this.#keys.delete(KEYS[e.code]);
      if (!e.shiftKey) this.#keys.delete('sprint');
    });
    this.#listen(this.#win, 'mousedown', e => {
      this.anyInput = true;
      this.#setDevice(false);
      if (editing(e.target) || editing(this.#doc.activeElement)) return;
      if (MOUSE[e.button]) this.#mouse.add(MOUSE[e.button]);
      if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
    });
    this.#listen(this.#win, 'mouseup', e => this.#mouse.delete(MOUSE[e.button]));
    this.#listen(this.#win, 'mousemove', e => {
      if (!this.locked || editing(this.#doc.activeElement)) return;
      this.#dx += Math.abs(e.movementX) <= 400 ? e.movementX : 0;
      this.#dy += Math.abs(e.movementY) <= 400 ? e.movementY : 0;
      this.#usingGamepad = false; // Mouse movement changes the device without a callback.
      this.anyInput = true;
    });
    this.#listen(this.#win, 'wheel', e => {
      this.anyInput = true;
      if (!editing(e.target) && !editing(this.#doc.activeElement)) {
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

  get usingGamepad() { return this.#usingGamepad; }
  get locked() { return this.#doc.pointerLockElement === this.#canvas; }

  #listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.#listeners.push(() => target.removeEventListener(type, fn, options));
  }

  #setDevice(pad) {
    if (this.#usingGamepad === pad) return;
    this.#usingGamepad = pad;
    this.onDeviceChange?.(pad ? 'gamepad' : 'keyboard');
  }

  #clearRaw() {
    this.#keys.clear();
    this.#mouse.clear();
    this.#dx = this.#dy = this.#wheel = this.#padHold = 0;
  }

  update(dt) {
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
    const length = Math.hypot(this.move.x, this.move.y);
    if (length > 1) {
      this.move.x /= length;
      this.move.y /= length;
    }
    if (this.invertY) this.look.y = -this.look.y;
  }

  #pollPad(dt, blocked) {
    let pads;
    try { pads = this.#win.navigator.getGamepads?.() || []; }
    catch { pads = []; } // The browser can deny Gamepad API access in an iframe.
    const usable = p => p && p.connected !== false && p.mapping === 'standard';
    this.#pad = pads[this.#padIndex];
    if (!usable(this.#pad)) this.#pad = Array.from(pads).find(usable) || null;
    if (!this.#pad || blocked) {
      this.#padHold = 0;
      return;
    }
    this.#padIndex = this.#pad.index;
    let active = false;
    for (let i = 0; i < this.#pad.buttons.length; i++) {
      const b = this.#pad.buttons[i];
      if (!b || (!b.pressed && !(b.value > 0.35))) continue;
      active = true;
      if (PAD[i]) {
        this.#padCurrent.add(PAD[i]);
        this.#current.add(PAD[i]);
      }
    }
    const axes = this.#pad.axes;
    const lx = deadzone(axes[0] || 0), ly = deadzone(axes[1] || 0);
    const rx = deadzone(axes[2] || 0), ry = deadzone(axes[3] || 0);
    if (lx || ly) {
      this.move.x = lx;
      this.move.y = -ly;
      active = true;
    }
    this.#padHold = Math.hypot(rx, ry) > 0.94 ? this.#padHold + dt : 0;
    if (rx || ry) {
      const acceleration = 1 + clamp((this.#padHold - 0.25) / 0.6, 0, 1) * 0.9;
      this.look.x -= curve(rx) * this.padSensX * acceleration * dt;
      this.look.y -= curve(ry) * this.padSensY * acceleration * dt;
      active = true;
    }
    if (active) {
      this.anyInput = true;
      this.#setDevice(true);
    }
  }

  down(action) { return this.#current.has(action); }
  pressed(action) {
    return this.down(action) && (!this.#previous.has(action)
      || (this.#padCurrent.has(action) && !this.#padPrevious.has(action)));
  }
  released(action) { return !this.down(action) && this.#previous.has(action); }
  consume(action) { this.#current.delete(action); }
  anyPressed() {
    for (const action of this.#current) if (!this.#previous.has(action)) return true;
    return false;
  }

  requestLock() {
    if (this.#disposed) return;
    this.#lockWanted = true;
    if (this.locked || this.#lockPending) return;
    this.#cancelRetry();
    this.#tryLock(true);
  }

  #tryLock(raw) {
    if (!this.#lockWanted || this.#disposed || this.locked) return;
    const attempt = ++this.#lockAttempt;
    this.#lockRaw = raw;
    this.#lockPending = true;
    this.#lockUsesPromise = false;
    try {
      const result = raw ? this.#canvas.requestPointerLock({ unadjustedMovement: true })
        : this.#canvas.requestPointerLock();
      if (result?.then) {
        this.#lockUsesPromise = true;
        Promise.resolve(result).then(() => {
          if ((!this.#lockWanted || this.#disposed) && this.locked) this.exitLock();
        }, () => this.#lockFailed(attempt));
      }
    } catch { this.#lockFailed(attempt); }
  }

  #lockFailed(attempt) {
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
      try { this.#doc.exitPointerLock()?.catch?.(() => {}); } catch {}
    }
  }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    try {
      this.#pad?.vibrationActuator?.playEffect('dual-rumble', {
        duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1),
      })?.catch?.(() => {});
    } catch {}
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
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

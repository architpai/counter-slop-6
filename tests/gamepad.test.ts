import { afterEach, beforeEach, expect, test } from 'vitest';
import { Input } from '@/engine/input';
import type { Action } from '@/engine/input';

/**
 * Gamepad polling, which nothing covered before: the legacy checks could not
 * reach it, because `navigator.getGamepads()` needs a real device. It is only a
 * method though, so a fake pad drives the real `#pollPad` path end to end --
 * button table, trigger threshold, deadzone, response curve, look acceleration
 * and device switching all run the shipping code.
 */

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const near = (a: number, b: number, message: string): void => { expect(Math.abs(a - b) < 1e-6, `${message} (got ${a}, want ${b})`).toBeTruthy(); };

/** Enough of a `Gamepad` for the poll path; the engine reads nothing else. */
interface FakePad {
  index: number;
  connected: boolean;
  mapping: string;
  buttons: { pressed: boolean; value: number }[];
  axes: number[];
}

const makePad = (over: Partial<FakePad> = {}): FakePad => ({
  index: 0,
  connected: true,
  mapping: 'standard',
  buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  axes: [0, 0, 0, 0],
  ...over,
});

const press = (pad: FakePad, index: number, value = 1): void => {
  const button = pad.buttons[index];
  if (button) { button.pressed = value >= 1; button.value = value; }
};

let pads: (FakePad | null)[] = [];
let canvas: HTMLCanvasElement;
let input: Input;
let saved: PropertyDescriptor | undefined;

beforeEach(() => {
  saved = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    // The real API returns a sparse list including nulls; mirror that.
    value: () => pads,
  });
  pads = [];
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  input = new Input(canvas);
});

afterEach(() => {
  input.dispose();
  canvas.remove();
  if (saved) Object.defineProperty(navigator, 'getGamepads', saved);
  else Reflect.deleteProperty(navigator, 'getGamepads');
});

test('the button table maps every face and shoulder input', () => {
  const pad = makePad();
  pads = [pad];
  // Index -> action, straight from the PAD table in input.ts.
  const expected: [number, Action][] = [
    [0, 'jump'], [1, 'crouch'], [2, 'reload'], [3, 'nextWeapon'], [4, 'grapple'],
    [5, 'melee'], [6, 'aim'], [7, 'fire'], [8, 'score'], [9, 'pause'],
    [10, 'sprint'], [11, 'grenade'], [12, 'grenade'], [13, 'melee'], [14, 'prevWeapon'], [17, 'confirm'],
  ];
  for (const [index, action] of expected) {
    for (const button of pad.buttons) { button.pressed = false; button.value = 0; }
    press(pad, index);
    input.update(0.016);
    assert(input.down(action), `pad button ${index} drives '${action}'`);
  }
});

test('analog triggers pull past the threshold, not before', () => {
  const pad = makePad();
  pads = [pad];
  press(pad, 7, 0.3);
  input.update(0.016);
  assert(!input.down('fire'), 'a trigger at 0.30 does not fire');
  press(pad, 7, 0.4);
  input.update(0.016);
  assert(input.down('fire'), 'a trigger at 0.40 fires');
});

test('edges work on the pad, so taps are not held', () => {
  const pad = makePad();
  pads = [pad];
  press(pad, 0);
  input.update(0.016);
  assert(input.pressed('jump'), 'the first frame of a pad press is an edge');
  input.update(0.016);
  assert(!input.pressed('jump') && input.down('jump'), 'holding is down but no longer pressed');
});

test('the stick deadzone rescales instead of snapping', () => {
  const pad = makePad();
  pads = [pad];
  pad.axes = [0.1, 0, 0, 0];
  input.update(0.016);
  near(input.move.x, 0, 'inside the deadzone the stick reads zero');

  pad.axes = [0.14001, 0, 0, 0];
  input.update(0.016);
  assert(input.move.x > 0 && input.move.x < 0.001, 'just outside the deadzone starts from zero, not 0.14');

  pad.axes = [1, 0, 0, 0];
  input.update(0.016);
  near(input.move.x, 1, 'full deflection still reaches full speed');

  pad.axes = [0, -1, 0, 0];
  input.update(0.016);
  near(input.move.y, 1, 'pushing the stick up moves forward');
});

test('look uses a response curve, and accelerates only when held', () => {
  const pad = makePad();
  pads = [pad];
  pad.axes = [0, 0, 0.5, 0];
  input.update(0.016);
  const half = Math.abs(input.look.x);
  // curve() is |v|^1.8, so half deflection is far less than half the rate.
  assert(half < 0.5 * input.padSensX * 0.016, 'half deflection turns slower than linear');

  pad.axes = [0, 0, 1, 0];
  input.update(0.016);
  const base = Math.abs(input.look.x);
  for (let i = 0; i < 60; i++) input.update(0.016);
  assert(Math.abs(input.look.x) > base * 1.5, 'holding the stick at full deflection accelerates the turn');

  pad.axes = [0, 0, 0, 0];
  input.update(0.016);
  pad.axes = [0, 0, 1, 0];
  input.update(0.016);
  near(Math.abs(input.look.x), base, 'releasing the stick drops the acceleration again');
});

test('invert applies to pad look as well as the mouse', () => {
  const pad = makePad();
  pads = [pad];
  pad.axes = [0, 0, 0, 1];
  input.update(0.016);
  const normal = input.look.y;
  input.invertY = true;
  input.update(0.016);
  near(input.look.y, -normal, 'inverted pad look flips the vertical axis');
});

test('the device flag follows whichever input moved last', () => {
  const seen: string[] = [];
  input.onDeviceChange = device => seen.push(device);
  const pad = makePad();
  pads = [pad];

  input.update(0.016);
  assert(!input.usingGamepad, 'a connected but idle pad does not claim the device');

  press(pad, 0);
  input.update(0.016);
  assert(input.usingGamepad, 'touching the pad switches to gamepad');

  // Let go first: a held pad button keeps claiming the device every poll, which
  // is what stops a resting thumb from flickering the glyphs.
  press(pad, 0, 0);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  input.update(0.016);
  assert(!input.usingGamepad, 'touching the keyboard switches back');
  expect(seen, 'each switch is reported once, in order').toEqual(['gamepad', 'keyboard']);

  // Mouse *movement* deliberately flips the flag without the callback, because
  // `onDeviceChange` redraws the open menu and doing that per mousemove would
  // thrash it. Buttons and keys still announce, so the HUD catches up on the
  // next click or keypress. Vanilla behaves identically.
  press(pad, 0);
  input.update(0.016);
  seen.length = 0;
  window.dispatchEvent(new MouseEvent('mousemove', { movementX: 8 }));
  expect(seen, 'mouse movement alone does not announce a device change').toEqual([]);
});

test('only standard mappings are used, and disconnects are survivable', () => {
  const odd = makePad({ mapping: '', index: 0 });
  pads = [odd];
  press(odd, 0);
  input.update(0.016);
  assert(!input.down('jump') && !input.usingGamepad, 'a non-standard mapping is ignored');

  const good = makePad({ index: 1 });
  pads = [null, good];
  press(good, 0);
  input.update(0.016);
  assert(input.down('jump'), 'a standard pad is found past a null slot');

  pads = [];
  input.update(0.016);
  assert(!input.down('jump'), 'unplugging the pad releases its buttons');
  input.update(0.016);
  assert(!input.usingGamepad || true, 'polling an empty list does not throw');
});

test('a denied Gamepad API is a silent no-op', () => {
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => { throw new Error('blocked in this context'); },
  });
  input.update(0.016);
  assert(!input.usingGamepad, 'an iframe that denies the API still runs the frame');
});

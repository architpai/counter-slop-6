import { Input } from '../src/engine/input.js';

export function run(assert) {
  const canvas = document.createElement('canvas');
  const field = document.createElement('input');
  const previousFocus = document.activeElement;
  document.body.append(canvas, field);
  const input = new Input(canvas);
  const key = (type, code, options = {}, target = window) => {
    const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const tick = () => input.update(1 / 60);
  const near = (a, b) => Math.abs(a - b) < 1e-10;

  try {
    previousFocus?.blur();
    tick();
    assert(!input.anyPressed(), 'no action is pressed before an input event');
    key('keydown', 'KeyW');
    tick();
    assert(input.down('forward') && input.pressed('forward'), 'key down starts an action');
    assert(input.anyPressed() && input.anyInput, 'key down reports input activity');
    tick();
    assert(input.down('forward') && !input.pressed('forward'), 'holding is not a repeated edge');
    input.consume('forward');
    assert(!input.down('forward') && !input.pressed('forward'), 'consume hides the action');
    tick();
    assert(input.pressed('forward'), 'a consumed held action presses again next frame');
    input.consume('forward');
    key('keyup', 'KeyW');
    tick();
    assert(!input.released('forward'), 'a consumed action has no later release edge');

    key('keydown', 'KeyW', { repeat: true });
    tick();
    assert(!input.down('forward'), 'auto-repeat cannot start an action');
    key('keydown', 'KeyW');
    key('keydown', 'KeyD');
    tick();
    assert(near(input.move.x, Math.SQRT1_2) && near(input.move.y, Math.SQRT1_2),
      'diagonal movement is normalized');
    key('keyup', 'KeyW');
    key('keyup', 'KeyD');
    tick();
    assert(input.released('forward') && input.released('right'), 'key up has one release edge');
    tick();
    assert(!input.released('forward'), 'release edges last one frame');

    key('keydown', 'ShiftLeft', { shiftKey: true });
    tick();
    assert(input.down('sprint'), 'Shift starts sprint');
    key('keydown', 'KeyW', { shiftKey: false });
    tick();
    assert(!input.down('sprint'), 'the Shift guard clears a stuck sprint');
    key('keyup', 'KeyW');
    const space = key('keydown', 'Space');
    assert(space.defaultPrevented, 'gameplay Space does not scroll the page');
    key('keyup', 'Space');

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 20 }));
    tick();
    assert(input.pressed('nextWeapon') && !input.down('prevWeapon'), 'wheel signs select next');
    tick();
    assert(!input.down('nextWeapon'), 'wheel action lasts one frame');
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    tick();
    assert(input.pressed('prevWeapon'), 'negative wheel selects previous');

    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    tick();
    assert(input.down('fire'), 'left mouse fires');
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    tick();
    assert(input.released('fire'), 'mouse up releases fire');

    key('keydown', 'KeyW');
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    tick();
    window.dispatchEvent(new Event('blur'));
    tick();
    assert(!input.down('forward') && !input.down('fire'), 'blur clears keyboard and mouse');
    key('keydown', 'KeyW');
    tick();
    field.focus();
    const fieldSpace = key('keydown', 'Space', {}, field);
    key('keydown', 'KeyM', {}, field);
    key('keydown', 'Enter', {}, field);
    tick();
    assert(!input.down('forward') && !input.down('jump') && !input.down('music')
      && !input.down('confirm'), 'typing does not move, jump, change music, or confirm');
    assert(!fieldSpace.defaultPrevented, 'input fields keep native keyboard behavior');
    field.blur();
    key('keydown', 'KeyW');
    tick();
    assert(input.pressed('forward'), 'game keys work again after leaving a field');

    input.dispose();
    key('keydown', 'KeyD');
    tick();
    assert(!input.down('right') && !input.anyPressed(), 'disposed input has no live listeners');
  } finally {
    input.dispose();
    canvas.remove();
    field.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
}

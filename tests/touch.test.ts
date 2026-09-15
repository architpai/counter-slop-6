import { expect, test, vi } from 'vitest';
import { TouchInput } from '@/engine/touch';
import { Input } from '@/engine/input';
import { CONTROL_IDS, fitControl, loadTouchLayout, presetLayout, saveTouchLayout } from '@/engine/touch-layout';

const rect = { left: 0, top: 0, width: 100, height: 100 };

test('touch ownership, analogue movement, two fire fingers, and between-frame taps', () => {
  const t = new TouchInput();
  expect(t.start(1, 'fire', 50, 50, rect, 0)).toBe(false);
  t.enabled = true;
  expect(t.start(1, 'move', NaN, 0, rect, 0)).toBe(false);
  t.start(1, 'move', 50, 34, rect, 0);
  expect(t.move.y).toBe(.5);
  t.drag(1, 82, 18);
  expect(Math.hypot(t.move.x, t.move.y)).toBeCloseTo(1);
  t.drag(1, 50, 0); t.sample(0);
  expect(t.frame.has('sprint')).toBe(true);
  t.start(2, 'fire', 50, 50, rect, 0);
  expect(t.start(3, 'fire', 50, 50, rect, 0)).toBe(false);
  t.start(3, 'fire-left', 50, 50, rect, 0);
  t.drag(2, 60, 45); t.drag(3, 200, 200);
  expect(t.look).toEqual({ x: 10, y: -5 });
  expect(t.contacts.get(2)?.control).toBe('fire');
  t.sample(1); expect(t.edges.has('fire')).toBe(true);
  t.end(2, false, 2); t.sample(3);
  expect(t.frame.has('fire')).toBe(true); expect(t.edges.has('fire')).toBe(false);
  t.end(3, false, 4); t.sample(5); expect(t.frame.has('fire')).toBe(false);
  for (const control of ['fire', 'jump', 'reload', 'slide', 'weapon'] as const) {
    t.start(2, control, 50, 50, rect, 6); t.end(2, false, 7); t.sample(8);
    expect(t.edges.size).toBe(1); t.sample(9); expect(t.edges.size).toBe(0);
  }
  t.end(1); expect(t.move).toEqual({ x: 0, y: 0 });
  t.start(1, 'aim', 50, 50, rect); t.end(1); t.sample(); expect(t.frame.has('aim')).toBe(true);
  t.start(1, 'aim', 50, 50, rect); t.end(1, true); t.sample();
  expect(t.aiming).toBe(false); expect(t.contacts.size).toBe(0); expect(t.frame.size).toBe(0);
});

test('grapple waits for actual attachment, distinguishes tap/hold, and cannot re-hook after launch', () => {
  const t = new TouchInput(); t.enabled = true;
  let mode: 'idle' | 'fly' | 'on' = 'idle'; t.getGrappleMode = () => mode;
  t.start(1, 'grapple', 50, 50, rect, 0); t.sample(0);
  expect(t.hookPressed).toBe(true);
  mode = 'fly'; t.sample(301); expect(t.reeling).toBe(false); expect(t.hookPressed).toBe(false);
  mode = 'on'; t.sample(302); expect(t.reeling).toBe(true);
  t.end(1, false, 400); t.sample(400); expect(t.detachPressed).toBe(false); expect(t.reeling).toBe(false);
  t.start(1, 'grapple', 50, 50, rect, 500); t.sample(500);
  expect(t.hookPressed || t.detachPressed).toBe(false);
  t.sample(801); expect(t.reeling).toBe(true);
  t.end(1, false, 802); t.sample(803); expect(t.detachPressed).toBe(false);
  t.start(1, 'grapple', 50, 50, rect, 900); t.end(1, false, 999); t.sample(999);
  expect(t.detachPressed).toBe(true);
  t.start(1, 'grapple', 50, 50, rect, 1000); t.end(1, true, 1001); t.sample(1002);
  expect(t.detachPressed).toBe(false);
  t.start(1, 'grapple', 50, 50, rect, 1100); t.cancelGrapple(); mode = 'idle'; t.sample(1500);
  expect(t.hookPressed || t.reeling || t.detachPressed).toBe(false);
  mode = 'on'; t.sample(1600); expect(t.reeling).toBe(false);
  t.end(1, false, 1601); t.sample(1602); expect(t.detachPressed).toBe(false);
});

test('input merges touch edges, rejects compatibility mouse, and clears on device change and focus loss', () => {
  const canvas = document.createElement('canvas'), field = document.createElement('input');
  document.body.append(canvas, field);
  const input = new Input(canvas), t = input.touch;
  const pointer = (type: string) => window.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 1 }));
  const tick = () => input.update(.016);
  const lock = vi.spyOn(canvas, 'requestPointerLock');
  try {
    pointer('pointerdown'); t.enabled = true;
    input.requestLock(); expect(lock).not.toHaveBeenCalled();
    t.start(1, 'fire', 50, 50, rect); t.end(1); tick(); expect(input.pressed('fire')).toBe(true);
    t.start(1, 'fire', 50, 50, rect); t.end(1); tick(); expect(input.pressed('fire')).toBe(true);
    tick(); expect(input.down('fire')).toBe(false);
    pointer('pointerup'); window.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); tick();
    expect(input.usingTouch).toBe(true); expect(input.down('fire')).toBe(false);
    t.start(1, 'look', 50, 50, rect); t.drag(1, 70, 40); tick();
    expect(input.look.x).toBeCloseTo(-20 * input.touchSens);
    tick(); expect(input.look.x).toBeCloseTo(0); expect(input.look.y).toBeCloseTo(0);
    field.focus(); field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true })); tick();
    expect(input.usingTouch).toBe(true); expect(input.down('forward')).toBe(false); expect(t.contacts.size).toBe(0);
    field.blur(); t.start(1, 'fire', 50, 50, rect); tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })); tick();
    expect(input.device).toBe('keyboard'); expect(input.down('fire')).toBe(false); expect(t.contacts.size).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    pointer('pointerdown'); t.enabled = true; t.start(1, 'fire', 50, 50, rect); tick();
    const pad = { index: 0, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: [{ pressed: true, value: 1 }] } as unknown as Gamepad;
    const getPads = vi.spyOn(navigator, 'getGamepads').mockReturnValue([pad]);
    tick(); expect(input.device).toBe('gamepad'); expect(input.pressed('jump')).toBe(true); expect(input.down('fire')).toBe(false);
    getPads.mockRestore(); pointer('pointerdown'); t.enabled = true;
    t.start(1, 'fire', 50, 50, rect); tick(); window.dispatchEvent(new Event('blur')); tick();
    expect(input.down('fire')).toBe(false); expect(t.contacts.size).toBe(0);
    input.dispose(); expect(t.start(2, 'fire', 50, 50, rect)).toBe(false);
  } finally { input.dispose(); canvas.remove(); field.remove(); vi.restoreAllMocks(); }
});

test('layouts validate storage, fit short landscape screens, and reserve Pause', () => {
  const previous = localStorage.getItem('cs6_touch_layout');
  try {
    for (const preset of ['thumbs', 'claw'] as const) {
      const layout = presetLayout(preset);
      expect(saveTouchLayout(layout)).toBe(true); expect(loadTouchLayout()).toEqual(layout);
      for (const [width, height] of [[788, 366], [611, 351], [512, 302], [512, 256]]) {
        const controls = CONTROL_IDS.filter(id => id !== 'fire-left' || layout.secondFire).map(id => ({ id, ...fitControl(id, layout.controls[id], width!, height!) }));
        for (const a of controls) {
          expect(a.width >= 44 && a.height >= 44 && a.x - a.width / 2 >= 0 && a.x + a.width / 2 <= width!
            && a.y - a.height / 2 >= 0 && a.y + a.height / 2 <= height!, `${preset} ${a.id} fits`).toBe(true);
          for (const b of controls) if (a !== b) expect(Math.abs(a.x - b.x) >= (a.width + b.width) / 2
            || Math.abs(a.y - b.y) >= (a.height + b.height) / 2, `${preset} ${width}×${height} ${a.id}/${b.id} overlap`).toBe(true);
        }
      }
    }
    for (const saved of ['no JSON', 'null', '{}', JSON.stringify({ ...presetLayout('claw'), controls: { move: { x: 9 } } })]) {
      localStorage.setItem('cs6_touch_layout', saved); expect(loadTouchLayout()).toEqual(presetLayout('thumbs'));
    }
    const corner = fitControl('fire', { x: 1, y: 0, size: 160, opacity: 1 }, 512, 302);
    expect(corner.y - corner.height / 2).toBeGreaterThanOrEqual(52);
    const denied = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadTouchLayout()).toEqual(presetLayout('thumbs')); denied.mockRestore();
  } finally { if (previous === null) localStorage.removeItem('cs6_touch_layout'); else localStorage.setItem('cs6_touch_layout', previous); vi.restoreAllMocks(); }
});

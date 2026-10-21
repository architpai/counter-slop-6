import { afterEach, expect, test, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Screen, dropLoadout } from '@/components/hud/Screens';
import { createUI } from '@/engine/game/ui';
import { Player } from '@/engine/player/index';
import { Input } from '@/engine/input';
import { Audio } from '@/engine/audio';
import { HudStore } from '@/engine/hud/store';
import { World } from '@/engine/physics';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { App } from '@/engine/boot';
import type { Ctx } from '@/engine/types';
import type { PauseModel, ScreenView } from '@/engine/hud/screens';
import '@/app/globals.css';

let root: Root | undefined, host: HTMLDivElement;
const cleanups: (() => void)[] = [];
afterEach(() => { flushSync(() => root?.unmount()); root = undefined; host?.remove(); cleanups.splice(0).forEach(fn => fn()); });

const CHOICES = ['r4c', 'rifle', 'shotgun', 'sniper', 'pistol', 'lmg', 'sword'].map(kind => ({ kind, name: kind.toUpperCase(), role: kind, speed: 100 }));
const pause = (loadout: (string | null)[]): PauseModel => ({
  wave: 3, score: 10, training: false, sens: 100, acogSens: 120, sniperSens: 150, invert: false, music: true,
  confirmKey: 'Enter', optic: 'acog', r4cOptic: 'acog', choices: CHOICES, loadout, loadoutNote: '',
  gfx: { choice: 'high', auto: 'high', values: { ...PRESET_VALUES.high }, fpsCounter: false },
});
function show(loadout: (string | null)[], onAction = vi.fn()) {
  if (!root) {
    host = document.createElement('div'); host.className = 'game-hud'; document.body.append(host);
    root = createRoot(host);
  }
  flushSync(() => root!.render(<div className="screen-panel" data-screen-kind="pause" style={{ width: 1120 }}>
    <Screen view={{ kind: 'pause', model: pause(loadout) }} pad={false} onAction={onAction} />
  </div>));
  flushSync(() => host.querySelectorAll<HTMLButtonElement>('.menu-nav button')[2]!.click());
  return onAction;
}
const slotWeapons = () => [...host.querySelectorAll<HTMLElement>('[data-slot]')].map(slot => slot.querySelector<HTMLElement>('.slot-weapon')?.dataset.value ?? null);
const center = (el: Element) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
/** A mouse drag from `from` to `to`, then the click the browser sends after it. */
function drag(from: HTMLElement, to: Element | { clientX: number; clientY: number }) {
  const start = center(from), end = to instanceof Element ? center(to) : to;
  const ev = (type: string, at: { clientX: number; clientY: number }) => new PointerEvent(type, { ...at, bubbles: true, pointerId: 1, isPrimary: true, button: 0, pointerType: 'mouse' });
  flushSync(() => from.dispatchEvent(ev('pointerdown', start)));
  flushSync(() => window.dispatchEvent(ev('pointermove', { clientX: start.clientX + 20, clientY: start.clientY })));
  flushSync(() => window.dispatchEvent(ev('pointermove', end)));
  flushSync(() => window.dispatchEvent(ev('pointerup', end)));
  flushSync(() => from.click());
}

test('a drop swaps slots, takes a slot from the arsenal, or empties a slot', () => {
  const slots = ['r4c', 'pistol', 'sword'];
  expect(dropLoadout(slots, 'sword', 2, 0)).toEqual(['sword', 'pistol', 'r4c']);
  expect(dropLoadout(slots, 'lmg', null, 1)).toEqual(['r4c', 'lmg', 'sword']);
  expect(dropLoadout(slots, 'r4c', null, 2)).toEqual(['sword', 'pistol', 'r4c']);
  expect(dropLoadout(slots, 'pistol', 1, null)).toEqual(['r4c', null, 'sword']);
  expect(dropLoadout(slots, 'lmg', null, null)).toEqual(slots);
  expect(dropLoadout(['r4c', null, 'sword'], 'r4c', 0, 1)).toEqual([null, 'r4c', 'sword']);
});

test('the slots show keys 1 to 3 in order, keep an empty slot in its place, and drag to reorder', () => {
  const onAction = show(['r4c', 'pistol', 'sword']);
  expect([...host.querySelectorAll('.slot-key')].map(key => key.textContent)).toEqual(['1', '2', '3']);
  expect(slotWeapons()).toEqual(['r4c', 'pistol', 'sword']);
  // Full: the arsenal stays draggable, so no card is disabled.
  expect([...host.querySelectorAll<HTMLButtonElement>('.loadout-card')].some(card => card.disabled)).toBe(false);

  const slots = [...host.querySelectorAll<HTMLElement>('[data-slot]')];
  drag(slots[2]!.querySelector('.slot-weapon')!, slots[0]!);
  // The drop sends the new order; the click after the drag neither toggles the card nor reaches the backdrop.
  expect(onAction.mock.calls.map(call => call.slice(0, 2))).toEqual([['loadoutSet', 'sword,pistol,r4c']]);
  expect(host.querySelector('[data-dragging]')).toBeNull();

  drag(host.querySelector<HTMLElement>('.loadout-card[data-value="lmg"]')!, slots[1]!);
  expect(onAction).toHaveBeenLastCalledWith('loadoutSet', 'r4c,lmg,sword', expect.any(Event));
  // A slot dropped off the slots empties.
  drag(slots[0]!.querySelector('.slot-weapon')!, host.querySelector('.loadout-card[data-value="sniper"]')!);
  expect(onAction).toHaveBeenLastCalledWith('loadoutSet', ',pistol,sword', expect.any(Event));
  // An arsenal card dropped off the slots does nothing.
  const count = onAction.mock.calls.length;
  drag(host.querySelector<HTMLElement>('.loadout-card[data-value="sniper"]')!, host.querySelector('.loadout-card[data-value="lmg"]')!);
  expect(onAction.mock.calls.slice(count).map(call => call.slice(0, 2))).toEqual([]);

  // The move buttons, for keyboard and controller.
  flushSync(() => host.querySelector<HTMLButtonElement>('[data-slot="0"] .slot-moves button:last-child')!.click());
  expect(onAction).toHaveBeenLastCalledWith('loadoutSet', 'pistol,r4c,sword', expect.any(Event));
  expect(host.querySelector<HTMLButtonElement>('[data-slot="0"] .slot-moves button:first-child')!.disabled).toBe(true);
  // A tap without a drag still taps.
  flushSync(() => host.querySelector<HTMLButtonElement>('[data-slot="1"] .slot-weapon')!.click());
  expect(onAction).toHaveBeenLastCalledWith('loadout', 'pistol', expect.any(Event));

  show(['r4c', null, 'sword'], onAction);
  expect(slotWeapons()).toEqual(['r4c', null, 'sword']);
  expect(host.querySelector('[data-slot="1"] .slot-empty')).not.toBeNull();
});

function uiFixture(carried: string[]) {
  const showScreen = vi.fn();
  const settings = { loadout: ['r4c', 'pistol', 'sword'], optic: 'acog', r4cOptic: 'acog' };
  const pickLoadout = vi.fn((kinds: string[]) => { settings.loadout = [...kinds]; return true; });
  const app = {
    settings, pickLoadout, loadoutOpen: () => false, screen: 'pause', coop: { active: () => false },
    gs: { state: 'pause', mode: 'solo', wave: 1, score: 0 },
    quality: { choice: 'high', autoPreset: 'high', values: {}, fpsCounter: false },
    ctx: { player: { loadout: carried }, input: { usingTouch: false, clearTouch: vi.fn(), touch: { enabled: false } }, net: {}, hud: { showScreen, key: () => 'Enter' } },
  };
  const ui = createUI(app as unknown as App);
  const act = (action: 'loadout' | 'loadoutSet', value: string) => ui.onUiAction(action, value, new Event('click'));
  const model = () => (showScreen.mock.lastCall![0] as Extract<ScreenView, { kind: 'pause' }>).model;
  return { act, model, pickLoadout, settings };
}

test('a tap empties a slot in place and fills the first empty one; loadoutSet takes only a well-formed list', () => {
  const { act, model, pickLoadout, settings } = uiFixture(['r4c', 'pistol', 'sword']);
  act('loadout', 'r4c');
  expect(model().loadout).toEqual([null, 'pistol', 'sword']);
  expect(model().loadoutNote).toBe('Pick 1 more.');
  act('loadout', 'lmg');
  expect(pickLoadout).toHaveBeenLastCalledWith(['lmg', 'pistol', 'sword']);
  // Full: a tap on another weapon does nothing.
  act('loadout', 'sniper');
  expect(pickLoadout).toHaveBeenCalledTimes(1);
  for (const bad of ['', 'lmg,pistol', 'lmg,pistol,sword,r4c', 'lmg,lmg,sword', 'lmg,pistol,nuke', ',,,']) act('loadoutSet', bad);
  expect(pickLoadout).toHaveBeenCalledTimes(1);
  expect(settings.loadout).toEqual(['lmg', 'pistol', 'sword']);
  act('loadoutSet', 'sword,,lmg');
  expect(model().loadout).toEqual(['sword', null, 'lmg']);
  act('loadoutSet', 'sword,r4c,lmg');
  expect(pickLoadout).toHaveBeenLastCalledWith(['sword', 'r4c', 'lmg']);
  expect(model().loadout).toEqual(['sword', 'r4c', 'lmg']);
});

test('a new order of the weapons carried keeps the gun in hand and every ammo count', () => {
  const scene = new Scene(), rig = new Group(), camera = new PerspectiveCamera(82, 16 / 9);
  scene.add(camera); camera.add(rig);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  cleanups.push(() => canvas.remove());
  const world = new World();
  world.addBox(new Vector3(-10, -1, -10), new Vector3(10, 0, 10)); world.finalize();
  const ctx = { scene, camera, renderer: { rig, three: { domElement: { clientWidth: 1600, clientHeight: 900 } } }, input: new Input(canvas), hud: new HudStore(),
    audio: new Audio(), world, level: { playerStart: new Vector3(), movers: [], rings: [] }, effects: { shake: 0 }, game: { mode: 'solo', playing: () => true } } as unknown as Ctx;
  const p = ctx.player = new Player(ctx);
  cleanups.push(() => p.disposeWeapons());
  p.setLoadout(['r4c', 'pistol', 'lmg']);
  p.switchTo(1, true);
  const pistol = p.weapon;
  p.weapons[0]!.mag = 7;
  expect(p.reorderLoadout(['lmg', 'r4c', 'pistol'])).toBe(true);
  expect(p.loadout).toEqual(['lmg', 'r4c', 'pistol']);
  expect(p.weapon).toBe(pistol);
  expect(p.wi).toBe(2);
  expect(p.weapons[1]!.mag).toBe(7);
  // Not the same weapons, or not a loadout: nothing changes.
  expect(p.reorderLoadout(['lmg', 'r4c', 'sword'])).toBe(false);
  expect(p.reorderLoadout(['lmg', 'r4c'] as never)).toBe(false);
  expect(p.loadout).toEqual(['lmg', 'r4c', 'pistol']);
});

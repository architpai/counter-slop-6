import { afterEach, expect, test } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Hud } from '@/components/hud/Hud';
import { HudStore, isHostedVar } from '@/engine/hud/store';
import '@/app/globals.css';

let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(() => { flushSync(() => root?.unmount()); root = undefined; host?.remove(); host = undefined; });
function mount(store: HudStore): HTMLElement {
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(<Hud store={store} />));
  return host.querySelector<HTMLElement>('#hud')!;
}
const q = (sel: string) => host!.querySelector<HTMLElement>(sel)!;
const inline = (el: HTMLElement, name: string) => el.style.getPropertyValue(name);

test('the per-frame variables are hosted, the scope drift stays on the root', () => {
  for (const name of ['--spread', '--health', '--breath', '--focus', '--boss', '--exec-0', '--straggler-12', '--mark-3']) expect(isHostedVar(name), name).toBe(true);
  for (const name of ['--scope-x', '--scope-y', '--scope-scale', '--spreadx', '--mark-', '--exec-a']) expect(isHostedVar(name), name).toBe(false);
});

test('a host gets the remembered value when it binds, every write while bound, and none after', () => {
  const store = new HudStore(), rootEl = document.createElement('div');
  store.bindRoot(rootEl);
  store.setSpread(7.25);
  store.setScopeDrift(1, 2, 1.5);
  const a = document.createElement('div'), b = document.createElement('div');
  const unbindA = store.bindVarHost('--spread', a);
  expect(inline(a, '--spread')).toBe('7.3px');
  const unbindB = store.bindVarHost('--spread', b);
  store.setSpread(12);
  expect([inline(a, '--spread'), inline(b, '--spread')]).toEqual(['12.0px', '12.0px']);
  unbindA();
  store.setSpread(3);
  expect([inline(a, '--spread'), inline(b, '--spread')]).toEqual(['12.0px', '3.0px']);
  unbindB();
  // Hosted values never land on the root, the others do (and a later root replays only those).
  expect(inline(rootEl, '--spread')).toBe('');
  expect(inline(rootEl, '--scope-x')).toBe('1.0');
  const root2 = document.createElement('div');
  store.bindRoot(root2);
  expect([inline(root2, '--spread'), inline(root2, '--scope-scale')]).toEqual(['', '1.500']);
  // A variable never written leaves the host on the inherited default.
  const c = document.createElement('div');
  store.bindVarHost('--boss', c)();
  expect(inline(c, '--boss')).toBe('');
});

test('the rendered HUD reads each hosted variable on its own element, with the same computed values', () => {
  const store = new HudStore();
  const hud = mount(store);
  flushSync(() => store.setGameplayVisible(true));
  // Defaults from .game-hud before any write.
  expect(getComputedStyle(q('.crosshair .bottom')).top).toBe('10px');
  store.setSpread(23.5);
  store.setHealth(40, 100);
  store.setFocusMeter(true, 0.25, false, 'MELEE');
  store.setBoss('Boss', 0.5);
  store.setBreath(0.6);
  expect(inline(q('[data-hud="crosshair"]'), '--spread')).toBe('23.5px');
  expect(inline(hud, '--spread')).toBe('');
  expect(inline(hud, '--health')).toBe('');
  expect(getComputedStyle(q('.crosshair .bottom')).getPropertyValue('--spread')).toBe('23.5px');
  expect(inline(q('[data-hud="healthFill"]'), '--health')).toBe('40.0%');
  expect(inline(q('[data-hud="focusFill"]'), '--focus')).toBe('25.0%');
  expect(inline(q('[data-hud="bossFill"]'), '--boss')).toBe('50%');
  expect(inline(q('[data-hud="breathFill"]'), '--breath')).toBe('60%');
});

test('markers that mount after their places were written get them at once', () => {
  const store = new HudStore();
  mount(store);
  flushSync(() => store.setGameplayVisible(true));
  // Written while no marker exists (the count arrives with the same call, and React mounts after it).
  flushSync(() => store.setStragglers([{ x: 10, y: 20, a: 0.5 }, { x: -4, y: 8, a: 1 }]));
  flushSync(() => store.setMarks([{ x: 5, y: 6, label: 'A' }]));
  flushSync(() => store.setExecMarks([{ x: 100, y: 50, n: 0 }]));
  const arrows = [...host!.querySelectorAll<HTMLElement>('[data-hud="stragglers"] i')];
  expect(arrows.map(el => inline(el, `--straggler-${arrows.indexOf(el)}`)))
    .toEqual(['translate(10px, 20px) rotate(0.50rad)', 'translate(-4px, 8px) rotate(1.00rad)']);
  expect(getComputedStyle(arrows[1]!).transform).not.toBe('none');
  expect(inline(q('[data-hud="marks"] i'), '--mark-0')).toBe('translate(5px, 6px)');
  expect(inline(q('.exec-mark'), '--exec-0')).toBe('translate(100px, 50px)');
  // Down to one arrow and back to two: the remounted second arrow replays its last place.
  flushSync(() => store.setStragglers([{ x: 1, y: 2, a: 0 }]));
  expect(host!.querySelectorAll('[data-hud="stragglers"] i')).toHaveLength(1);
  flushSync(() => store.setStragglers([{ x: 1, y: 2, a: 0 }, { x: -4, y: 8, a: 1 }]));
  const again = host!.querySelectorAll<HTMLElement>('[data-hud="stragglers"] i')[1]!;
  expect(inline(again, '--straggler-1')).toBe('translate(-4px, 8px) rotate(1.00rad)');
});

test('an HP change re-renders the health leaf only; the root re-renders when low health flips', () => {
  const store = new HudStore();
  const hud = mount(store);
  const renders = () => window.__hudRenderCount ?? 0;
  let before = renders();
  flushSync(() => store.setHealth(80, 100));
  expect(renders() - before).toBe(1);
  expect(hud.classList.contains('low-health')).toBe(false);
  before = renders();
  flushSync(() => store.setHealth(20, 100));
  expect(hud.classList.contains('low-health')).toBe(true);
  expect(renders() - before).toBe(2);
});

import { afterEach, expect, test } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Hitmarker } from '@/components/hud/Hud';
import { HudStore } from '@/engine/hud/store';
import '@/app/globals.css';

let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { flushSync(() => root?.unmount()); host?.remove(); });

test('hit colours, shapes and lifetimes are distinct; kills survive subsequent hits', () => {
  const store = new HudStore();
  host = document.createElement('div');
  host.className = 'game-hud'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(Hitmarker, { store })));
  const hit = host.querySelector<SVGSVGElement>('[data-hud="hitmarker"]')!;
  const skull = host.querySelector<SVGSVGElement>('[data-hud="killmarker"]')!;
  const fire = (kill: boolean, crit: boolean, blocked = false) => {
    flushSync(() => store.hitmarker(kill, crit, blocked));
    const animation = hit.getAnimations()[0]!;
    animation.pause(); animation.currentTime = 0;
    return animation;
  };
  expect(hit.getAnimations()).toHaveLength(0);
  expect(skull.getAnimations()).toHaveLength(0);

  const body = fire(false, false);
  expect(getComputedStyle(hit).color).toBe('rgb(255, 255, 255)');
  expect(hit.querySelectorAll('path')).toHaveLength(1);
  expect(body.effect!.getTiming().duration).toBe(150);
  // The damage ticks must leave the exact aiming point empty.
  const point = new DOMPoint(0, 0);
  expect(hit.querySelector('path')!.isPointInStroke(point)).toBe(false);

  const head = fire(false, true);
  expect(getComputedStyle(hit).color).toBe('rgb(255, 71, 87)');
  expect(hit.querySelectorAll('path')).toHaveLength(2);
  expect(head.effect!.getTiming().duration).toBe(220);
  expect(skull.getAnimations()).toHaveLength(0);

  fire(true, true);
  const kill = skull.getAnimations()[0]!;
  kill.pause(); kill.currentTime = 100;
  expect(getComputedStyle(skull).fill).toBe('rgb(255, 209, 102)');
  expect(kill.effect!.getTiming().duration).toBe(350);
  expect(skull.getBoundingClientRect().top).toBeGreaterThan(hit.getBoundingClientRect().bottom);
  const nonce = store.hitmarkerState.killNonce;
  fire(false, false);
  expect(skull.getAnimations()[0]).toBe(kill);
  expect(kill.currentTime).toBe(100);
  expect(store.hitmarkerState.killNonce).toBe(nonce);
  expect(getComputedStyle(skull).opacity).toBe('1');

  fire(false, false, true);
  expect(getComputedStyle(hit).color).toBe('rgb(105, 183, 255)');
  expect(hit.classList.contains('blocked')).toBe(true);
  expect(skull.getAnimations()[0]).toBe(kill);
  kill.finish();
  expect(getComputedStyle(skull).opacity).toBe('0');

  fire(true, false);
  expect(getComputedStyle(hit).color).toBe('rgb(255, 255, 255)');
  expect(store.hitmarkerState.killNonce).toBe(nonce + 1);
  expect(skull.getAnimations()[0]).not.toBe(kill);
  // Batched shotgun pellets must not erase a kill even before React renders it.
  flushSync(() => { store.hitmarker(true, true); store.hitmarker(false, false); });
  expect(store.hitmarkerState.killNonce).toBe(nonce + 2);
  expect(skull.getAnimations()).toHaveLength(1);
  host.classList.add('no-gameplay');
  expect(getComputedStyle(hit).display).toBe('none');
  expect(getComputedStyle(skull).display).toBe('none');
});

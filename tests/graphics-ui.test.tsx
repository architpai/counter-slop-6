import { afterEach, expect, test, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { Screen } from '@/components/hud/Screens';
import { Hud } from '@/components/hud/Hud';
import { HudStore } from '@/engine/hud/store';
import { createUI } from '@/engine/game/ui';
import { AMBIENT_OCCLUSION, ANTIALIAS, PRESET_VALUES, Quality, TEXTURE_QUALITIES } from '@/engine/render/quality';
import type { App } from '@/engine/boot';
import type { PauseModel } from '@/engine/hud/screens';
import '@/app/globals.css';

let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { flushSync(() => root?.unmount()); root = undefined; host?.remove(); });
function render(node: ReactNode) {
  if (!root) {
    host = document.createElement('div'); host.className = 'game-hud'; document.body.append(host);
    root = createRoot(host);
  }
  flushSync(() => root!.render(node));
}
const click = (element: HTMLElement) => flushSync(() => element.click());
const presets = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-act="gfxPreset"]')];
const pause = (gfx: PauseModel['gfx']): PauseModel => ({
  wave: 3, score: 10, training: false, sens: 100, acogSens: 120, sniperSens: 150, invert: false, music: true,
  confirmKey: 'Enter', optic: 'acog', r4cOptic: 'acog', gfx,
});
const device = { mobile: false, memory: null, cores: 8, gpu: '', maxTextureSize: 16384 };

test('the Graphics section shows the presets, Auto with its pick, and the Advanced controls', () => {
  const onAction = vi.fn();
  const gfx = { choice: 'auto' as const, auto: 'high' as const, values: { ...PRESET_VALUES.high }, fpsCounter: false };
  const show = () => render(<Screen view={{ kind: 'pause', model: pause(gfx) }} pad={false} onAction={onAction} />);
  show();
  click(host.querySelector<HTMLButtonElement>('.menu-nav button:nth-child(2)')!);
  expect(presets().map(button => button.textContent)).toEqual(['Auto (High)', 'Low', 'Medium', 'High', 'Ultra', 'Custom']);
  expect(presets().map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
  const advanced = host.querySelector<HTMLDetailsElement>('.graphics-advanced')!;
  expect(advanced.open).toBe(false);
  click(presets()[2]!);
  expect(onAction).toHaveBeenLastCalledWith('gfxPreset', 'medium', expect.any(Event));
  // Custom opens the Advanced panel so the player sees what they are customising.
  click(presets()[5]!);
  expect(onAction).toHaveBeenLastCalledWith('gfxPreset', 'custom', expect.any(Event));
  expect(advanced.open).toBe(true);
  const selects = [...host.querySelectorAll<HTMLSelectElement>('.graphics-grid select')];
  expect(selects.map(select => select.value)).toEqual(['0', 'msaa2smaa', 'high', 'half', 'medium', 'full', 'normal']);
  // Every option the menu offers is one the engine accepts.
  expect([...selects[0]!.options].map(option => option.value)).toEqual(['30', '60', '90', '120', '0']);
  expect([...selects[1]!.options].map(option => option.value)).toEqual([...ANTIALIAS]);
  expect([...selects[3]!.options].map(option => option.value)).toEqual([...AMBIENT_OCCLUSION]);
  expect([...selects[4]!.options].map(option => option.value)).toEqual([...TEXTURE_QUALITIES]);
  expect(selects[4]!.disabled).toBe(false);
  selects[4]!.value = 'high';
  flushSync(() => selects[4]!.dispatchEvent(new Event('change', { bubbles: true })));
  expect(onAction).toHaveBeenLastCalledWith('gfx', 'textures:high', expect.any(Event));
  const bloom = [...host.querySelectorAll<HTMLInputElement>('.graphics-grid input[type="checkbox"][data-act="gfx"]')]
    .find(input => input.parentElement?.textContent?.includes('Bloom'))!;
  expect(bloom.checked).toBe(true);
  flushSync(() => bloom.click());
  expect(onAction).toHaveBeenLastCalledWith('gfx', 'bloom:0', expect.any(Event));
  selects[2]!.value = 'off';
  flushSync(() => selects[2]!.dispatchEvent(new Event('change', { bubbles: true })));
  expect(onAction).toHaveBeenLastCalledWith('gfx', 'shadows:off', expect.any(Event));
  const reset = host.querySelector<HTMLButtonElement>('button[data-act="gfxReset"]')!;
  expect(reset.disabled).toBe(true);
  gfx.choice = 'custom' as never; show();
  expect(reset.disabled).toBe(false);
  expect(presets()[5]!.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('input[data-act="gfxFps"]')).not.toBeNull();
  // The flat look has no textures: the setting is there but waits for a realistic preset.
  gfx.values = { ...PRESET_VALUES.low }; show();
  expect(host.querySelectorAll<HTMLSelectElement>('.graphics-grid select')[4]!.disabled).toBe(true);
});

test('menu actions validate graphics values before they reach the settings', () => {
  const quality = new Quality(null, device);
  const answer = vi.fn();
  const app = {
    quality, answerQualityPrompt: answer, screen: null, lobby: {}, gs: {}, settings: {},
    ctx: { input: {}, net: {}, hud: { showScreen: vi.fn(), key: () => 'Enter' } },
  };
  const ui = createUI(app as unknown as App);
  const act = (name: Parameters<typeof ui.onUiAction>[0], value: string | null) => ui.onUiAction(name, value, new Event('click'));
  act('gfxPreset', 'bogus');
  act('gfx', 'shadows:epic');
  act('gfx', 'fpsTarget:45');
  act('gfx', 'look:realistic');
  act('gfx', null);
  expect(quality.choice).toBe('auto');
  act('gfx', 'shadows:off');
  expect(quality.choice).toBe('custom');
  expect(quality.values.shadows).toBe('off');
  act('gfx', 'ao:quarter');
  expect(quality.values.ao).toBe(PRESET_VALUES.high.ao);
  act('gfx', 'ao:full');
  expect(quality.values.ao).toBe('full');
  act('gfx', 'bloom:0');
  expect(quality.values.bloom).toBe(false);
  act('gfx', 'textures:huge');
  expect(quality.values.textures).toBe(PRESET_VALUES.high.textures);
  act('gfx', 'textures:high');
  expect(quality.values.textures).toBe('high');
  act('gfx', 'antialias:smaa');
  expect(quality.values.antialias).toBe('smaa');
  act('gfx', 'renderScale:70');
  expect(quality.values.renderScale).toBe(0.7);
  act('gfx', 'fpsTarget:0');
  expect(quality.values.fpsTarget).toBe(0);
  act('gfx', 'dynamicRes:0');
  expect(quality.values.dynamicRes).toBe(false);
  act('gfxFps', '1');
  expect(quality.fpsCounter).toBe(true);
  act('gfxPreset', 'ultra');
  expect(quality.preset).toBe('ultra');
  act('gfxReset', null);
  expect(quality.choice).toBe('auto');
  act('gfxLower', 'yes');
  expect(answer).toHaveBeenCalledWith(true);
});

test('the lower-quality offer joins the open menu, inside its focus trap', () => {
  const store = new HudStore(), onUiAction = vi.fn();
  store.onUiAction = onUiAction;
  render(<Hud store={store} />);
  flushSync(() => store.setQualityPrompt('medium'));
  const prompt = () => host.querySelector<HTMLElement>('[data-hud="qualityPrompt"]');
  // In play it floats over the view, and says how to reach it with the mouse locked.
  expect(prompt()?.closest('[data-hud="panel"]')).toBeNull();
  expect(prompt()?.textContent).toContain('Pause to answer');
  flushSync(() => store.showScreen({ kind: 'pause', model: pause({ choice: 'auto', auto: 'high', values: { ...PRESET_VALUES.high }, fpsCounter: false }) }));
  expect(host.querySelectorAll('[data-hud="qualityPrompt"]')).toHaveLength(1);
  const panel = host.querySelector<HTMLElement>('[data-hud="panel"]')!;
  expect(prompt()?.closest('[data-hud="panel"]')).toBe(panel);
  // Shift+Tab from the panel wraps to the last control; Tab from there reaches the prompt first.
  const [lower] = [...prompt()!.querySelectorAll('button')];
  panel.focus();
  const tab = (shiftKey: boolean) => flushSync(() => (host.ownerDocument.activeElement ?? panel)
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })));
  tab(true);
  tab(false);
  expect(host.ownerDocument.activeElement).toBe(lower);
  click(lower!);
  expect(onUiAction).toHaveBeenCalledWith('gfxLower', 'yes', expect.any(Event));
  store.dispose();
});

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { GameHandle } from '@/engine/boot';
import type { HudStore } from '@/engine/hud/store';
import type { TouchControl } from '@/engine/touch';
import { CONTROL_IDS, fitControl, loadTouchLayout } from '@/engine/touch-layout';
import { useHud } from './useHud';
import './mobile-controls.css';

const labels: Record<TouchControl, string> = {
  look: 'Drag to look', move: 'Move. Push fully forward to sprint', fire: 'Fire. Hold and drag to aim',
  'fire-left': 'Left fire. Hold to fire', aim: 'Toggle scope', grapple: 'Grapple. Tap to hook or detach, hold to reel, drag to aim',
  jump: 'Jump or launch from rope', slide: 'Hold to crouch or slide. Press in air to dash', reload: 'Reload', weapon: 'Switch to next weapon',
};
const names: Record<string, string> = { fire: 'FIRE', 'fire-left': 'FIRE', aim: 'SCOPE', grapple: 'GRAPPLE', jump: 'JUMP', slide: 'SLIDE', reload: 'RELOAD' };

function Icon({ control }: { control: string }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true">
    {control === 'fire' || control === 'fire-left' ? <><circle cx="16" cy="16" r="9" /><circle cx="16" cy="16" r="3" /><path d="M16 2v5m0 18v5M2 16h5m18 0h5" /></>
      : control === 'aim' ? <><circle cx="16" cy="16" r="10" /><path d="M16 6v7m0 6v7M6 16h7m6 0h7" /></>
      : control === 'grapple' ? <><path d="M16 3v17a7 7 0 0 0 14 0v-6l-5 5M16 7 8 15l-5-5 8-8M8 15 2 25" /></>
      : control === 'jump' ? <path d="m8 15 8-9 8 9M16 7v20M7 28h18" />
      : control === 'slide' ? <><circle cx="19" cy="6" r="3" /><path d="m16 12-7 4 9 3-5 8m3-15 5 6h7M4 28h24M2 22h6" /></>
      : <path d="M25 12a10 10 0 1 0 0 10M25 4v8h-8" />}
  </svg>;
}

export function MobileControls({ store, game }: { store: HudStore; game: GameHandle }) {
  const mobile = useHud(store, 'mobile'), screen = useHud(store, 'screen'), gameplay = useHud(store, 'gameplay');
  const ammo = useHud(store, 'ammo'), weapon = useHud(store, 'weapon');
  const root = useRef<HTMLDivElement>(null), safe = useRef<HTMLDivElement>(null);
  const interruption = useRef<HTMLDialogElement>(null);
  const [layout, setLayout] = useState(loadTouchLayout);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const touch = game.input.touch;

  useLayoutEffect(() => {
    const element = safe.current;
    if (!element) return;
    const resize = () => { const r = element.getBoundingClientRect(); setBounds({ width: r.width, height: r.height }); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const refresh = () => {
      for (const button of root.current?.querySelectorAll<HTMLElement>('[data-touch]') ?? []) {
        button.classList.toggle('held', [...touch.contacts.values()].some(c => c.control === button.dataset.touch));
      }
      const stick = root.current?.querySelector<HTMLElement>('.touch-move');
      const knob = root.current?.querySelector<HTMLElement>('.touch-knob');
      if (knob && stick) {
        const radius = stick.getBoundingClientRect().width * .32;
        knob.style.transform = `translate(${touch.move.x * radius}px,${-touch.move.y * radius}px)`;
        stick.classList.toggle('sprinting', touch.move.y > .85);
      }
    };
    const reload = () => { game.input.clearTouch(); setLayout(loadTouchLayout()); };
    touch.onChange = refresh;
    window.addEventListener('touchlayoutchange', reload);
    return () => { game.input.clearTouch(); touch.onChange = null; window.removeEventListener('touchlayoutchange', reload); };
  }, [game, touch]);

  useEffect(() => {
    const dialog = interruption.current;
    if (!dialog || !mobile.active || !mobile.interrupted) return;
    dialog.showModal();
    return () => dialog.close();
  }, [mobile.active, mobile.interrupted]);

  function start(event: ReactPointerEvent<HTMLElement>, control: TouchControl) {
    if (event.pointerType !== 'touch' || event.button !== 0) return;
    event.preventDefault();
    if (touch.start(event.pointerId, control, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function drag(event: ReactPointerEvent<HTMLElement>) {
    touch.drag(event.pointerId, event.clientX, event.clientY);
    touch.onChange?.();
  }
  const handlers = (control: TouchControl) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => start(e, control), onPointerMove: drag,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => touch.end(e.pointerId),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => { touch.end(e.pointerId, true); game.input.clearTouch(); },
    onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => { if (touch.contacts.has(e.pointerId)) { touch.end(e.pointerId, true); game.input.clearTouch(); } },
  });

  return <div ref={root} className="mobile-controls" data-layout={layout.preset} hidden={!mobile.active}>
    <div className="touch-look" data-touch="look" aria-label={labels.look} hidden={!mobile.enabled} {...handlers('look')} />
    <div className="touch-safe" ref={safe}>
      {CONTROL_IDS.map(control => {
        const placement = layout.controls[control];
        const fit = fitControl(control, placement, bounds.width, bounds.height);
        const style: CSSProperties = { left: fit.x, top: fit.y, width: fit.width, height: fit.height, opacity: placement.opacity };
        return <button type="button" key={control} className={`touch-control touch-${control}`} style={style}
          data-touch={control} hidden={!mobile.enabled || (control === 'fire-left' && !layout.secondFire)}
          aria-label={labels[control]} aria-pressed={control === 'aim' ? mobile.aiming : control === 'grapple' ? mobile.attached : undefined}
          {...handlers(control)} onClick={event => {
            if (event.detail !== 0 || !mobile.enabled) return;
            const r = event.currentTarget.getBoundingClientRect();
            if (touch.start(-1, control, r.x + r.width / 2, r.y + r.height / 2, r)) touch.end(-1);
          }}>
          {control === 'move' ? <><i className="touch-knob" /><span className="touch-move-label">MOVE / SPRINT</span></>
            : control === 'weapon' ? <><span><strong>{weapon.name}</strong><b>{ammo.magazine}<small> {ammo.reserve}</small></b></span><small>{ammo.reloading ? 'RELOADING' : 'TAP TO SWITCH →'}</small></>
            : <><Icon control={control} /><span>{control === 'jump' && mobile.attached ? 'LAUNCH'
              : control === 'slide' && mobile.airborne ? 'DASH' : names[control]}</span></>}
        </button>;
      })}
      <button type="button" className="touch-pause" data-ui-block="" aria-label="Open menu" hidden={!gameplay || screen !== null || mobile.interrupted}
        onClick={() => game.pause()}>Ⅱ</button>
    </div>
    {mobile.interrupted && <dialog ref={interruption} className="touch-interruption" aria-labelledby="touch-interruption-title" data-ui-block=""
      onCancel={event => event.preventDefault()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <div><h1 id="touch-interruption-title">{mobile.portrait ? 'Rotate your phone to play.' : 'Ready to continue?'}</h1>
        <p>{mobile.portrait ? 'Hold your phone horizontally to continue.' : 'Your held controls have been released.'}</p>
        <p>{mobile.online ? 'The online match is still running. Your player is not protected.' : 'Solo / training is paused.'}</p>
        {!mobile.portrait && <button type="button" className="screen-button primary" autoFocus onClick={() => game.resume()}>Tap to resume</button>}
        <button type="button" className="screen-button" onClick={event => store.onUiAction?.(mobile.online ? 'leaveMatch' : 'mainMenu', null, event.nativeEvent)}>{mobile.online ? 'Leave match' : 'Main menu'}</button>
      </div>
    </dialog>}
  </div>;
}

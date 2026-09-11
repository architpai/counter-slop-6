'use client';

import {
  memo,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import { isUiAction } from '@/engine/hud/screens';
import type { DamageMark, HudStore, KillLine as KillLineState } from '@/engine/hud/store';
import { useHud } from './useHud';

declare global {
  interface Window {
    __hudRenderCount?: number;
  }
}

const rendered = (): void => {
  if (typeof window !== 'undefined') window.__hudRenderCount = (window.__hudRenderCount ?? 0) + 1;
};

interface HudProps { store: HudStore; children?: ReactNode }

export function Hud({ store, children }: HudProps) {
  rendered();
  const rootRef = useRef<HTMLDivElement>(null);
  const gameplay = useHud(store, 'gameplay');
  const device = useHud(store, 'device');
  const health = useHud(store, 'health');
  const screen = useHud(store, 'screen');
  const disposed = useSyncExternalStore(store.subscribeLifecycle, store.isDisposed, store.isDisposed);

  useEffect(() => {
    store.bindRoot(rootRef.current);
    return () => store.bindRoot(null);
  }, [store]);

  // Screen HTML is deliberately still opaque until phase 8. Keep its device
  // markers current without making that HTML part of React's state model.
  useEffect(() => {
    for (const el of rootRef.current?.querySelectorAll<HTMLElement>('[data-device]') ?? []) {
      el.classList.toggle('current-device', el.dataset.device === (device ? 'gamepad' : 'keyboard'));
    }
  }, [device, screen.html]);

  const className = [
    'game-hud',
    !gameplay && 'no-gameplay',
    device && 'gamepad',
    health.low && 'low-health',
    screen.html !== null && 'screen-open',
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} id="hud" className={className}>
      {!disposed && (
        <>
          <Scope store={store} />
          <FocusMeter store={store} />
          <FocusMark store={store} />
          <Crosshair store={store} />
          <GrappleReticle store={store} />
          <Breath store={store} />
          <Hitmarker store={store} />
          <DamageIndicators store={store} />
          <Score store={store} />
          <PvpScore store={store} />
          <Scoreboard store={store} />
          <Boss store={store} />
          <div className="bottom-left hud-block">
            <Health store={store} />
            <Ammo store={store} />
          </div>
          <div className="bottom-right hud-block">
            <Slots store={store} />
            <Weapon store={store} />
          </div>
          <TipLine store={store} />
          <CentreMessage store={store} />
          <KillFeed store={store} />
          <ScreenOverlay store={store} />
          {children}
        </>
      )}
    </div>
  );
}

export const Crosshair = memo(function Crosshair({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'crosshair');
  return (
    <div className={`crosshair${state.katana ? ' katana' : ''}${state.ads ? ' ads' : ''}`} data-hud="crosshair" aria-hidden="true">
      <i className="tick top" /><i className="tick bottom" /><i className="tick left" /><i className="tick right" /><i className="dot" />
    </div>
  );
});

export const Health = memo(function Health({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'health');
  const percent = state.max > 0 ? Math.round(Math.min(1, Math.max(0, state.hp / state.max)) * 100) : 0;
  return (
    <div className="health-row">
      <span>HP</span>
      <div className="health-track" data-hud="health" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${state.hp} of ${state.max} HP`}><div data-hud="healthFill" /></div>
      <strong data-hud="hp">{state.hp}</strong>
    </div>
  );
});

export const Ammo = memo(function Ammo({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'ammo');
  return (
    <>
      <div className="ammo-row">
        <strong className="magazine" data-hud="magazine" aria-label={state.label}>{state.magazine}</strong>
        <span className="reserve" data-hud="reserve">{state.reserve}</span>
        <span className="reloading" data-hud="reloading">{state.reloading ? ' reloading…' : ''}</span>
        <Grenades store={store} />
      </div>
      <div className="ammo-tally" data-hud="tally" aria-hidden="true">
        {Array.from({ length: state.tally }, (_, index) => <i key={index} />)}
      </div>
    </>
  );
});

export const Slots = memo(function Slots({ store }: { store: HudStore }) {
  rendered();
  const slots = useHud(store, 'slots');
  return (
    <div className="weapon-slots" data-hud="slots">
      {slots.map((slot, index) => (
        <div className={`weapon-slot${slot.active ? ' active' : ''}${slot.empty ? ' empty' : ''}`} key={`${index}:${slot.name}`}>
          <span className="slot-badge">{index + 1}</span><span>{slot.name}</span><span className="slot-ammo">{slot.ammo}</span>
        </div>
      ))}
    </div>
  );
});

export const Grenades = memo(function Grenades({ store }: { store: HudStore }) {
  rendered();
  const count = useHud(store, 'grenades');
  return (
    <span className="grenades" data-hud="grenades" aria-label={`${count} grenades`}>
      {Array.from({ length: count }, (_, index) => <i className="grenade-icon" aria-hidden="true" key={index} />)}
    </span>
  );
});

export const Score = memo(function Score({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'score');
  return <div className="top-left hud-block"><div>SCORE <strong data-hud="score">{state.score}</strong></div><div className="combo" data-hud="combo">{state.combo > 1 ? `combo x${state.combo}` : ''}</div></div>;
});

export const WaveBlock = memo(function WaveBlock({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'wave');
  return (
    <>
      <div className="wave-line">WAVE <strong data-hud="wave">{state.wave}</strong></div>
      <Modifier store={store} />
      <div className="enemies-line"><strong data-hud="enemies">{state.left}</strong> enemies left</div>
      <Timer store={store} />
    </>
  );
});

const Modifier = memo(function Modifier({ store }: { store: HudStore }) {
  rendered();
  return <div className="modifier" data-hud="modifier">{useHud(store, 'modifier')}</div>;
});

const Timer = memo(function Timer({ store }: { store: HudStore }) {
  rendered();
  return <div className="timer" data-hud="timer">{useHud(store, 'timer')}</div>;
});

const Weapon = memo(function Weapon({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'weapon');
  return <><div className="weapon-name" data-hud="weaponName">{state.name}</div><div className="weapon-hint" data-hud="weaponHint">{state.hint}</div></>;
});

export const Boss = memo(function Boss({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'boss');
  const shown = state.name !== null;
  return <div className={`boss-bar${shown ? ' is-visible' : ''}`} data-hud="boss" aria-hidden={!shown}><div className="boss-name" data-hud="bossName">{state.name ?? ''}</div><div className="boss-track"><div data-hud="bossFill" /></div></div>;
});

export const FocusMeter = memo(function FocusMeter({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'focus');
  return (
    <div className={`focus-meter${state.show ? ' is-visible' : ''}${state.ready ? ' ready' : ''}`} data-hud="focusMeter" aria-hidden={!state.show}>
      <div className="focus-label" data-hud="focusLabel">{state.label}</div>
      <div className="focus-tube"><div className="focus-fill" data-hud="focusFill" /><div className="focus-flames"><i /><i /><i /></div></div>
      <div className="focus-ready">SLASH READY</div>
    </div>
  );
});

export const FocusMark = memo(function FocusMark({ store }: { store: HudStore }) {
  rendered();
  const shown = useHud(store, 'focusMark');
  return <div className={`focus-mark${shown ? ' is-visible' : ''}`} data-hud="focusMark" aria-hidden={!shown}><i /><i /><i /><i /></div>;
});

export const Breath = memo(function Breath({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'breath');
  return <div className={`grapple-breath${state.low ? ' low' : ''}`} data-hud="breath" hidden={!state.shown} aria-label="Grapple breath" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent}><div data-hud="breathFill" /></div>;
});

export const Scope = memo(function Scope({ store }: { store: HudStore }) {
  rendered();
  const shown = useHud(store, 'scope');
  return <div className={`scope${shown ? ' is-visible' : ''}`} data-hud="scope" aria-hidden={!shown}><div className="scope-ring" /><div className="scope-cross horizontal" /><div className="scope-cross vertical" /><div className="scope-dot" /></div>;
});

export const GrappleReticle = memo(function GrappleReticle({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'grapple');
  return <div className="grapple-reticle" data-hud="grappleReticle" data-state={state} aria-hidden="true" />;
});

export const Hitmarker = memo(function Hitmarker({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'hitmarker');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.nonce === 0) return;
    const animation = ref.current?.animate([
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.5)' },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 200, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [state.nonce]);
  return <div ref={ref} className={`hit-marker${state.kill ? ' kill' : ''}${state.crit ? ' crit' : ''}`} data-hud="hitmarker" aria-hidden="true"><i /><i /></div>;
});

function DamageDirection({ mark }: { mark: DamageMark }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const animation = ref.current?.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 1000, easing: 'linear' });
    return () => animation?.cancel();
  }, []);
  return <div ref={ref} className="damage-direction" style={{ transform: `rotate(${mark.angle}rad)` }} />;
}

export const DamageIndicators = memo(function DamageIndicators({ store }: { store: HudStore }) {
  rendered();
  const marks = useHud(store, 'damage');
  return <div className="damage-indicators" data-hud="damageIndicators" aria-hidden="true">{marks.map(mark => <DamageDirection mark={mark} key={mark.id} />)}</div>;
});

function KillLine({ line }: { line: KillLineState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const animation = ref.current?.animate([
      { opacity: 0, transform: 'translateX(30px)', offset: 0 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.15 },
      { opacity: 1, transform: 'translateX(0)', offset: 0.75 },
      { opacity: 0, transform: 'translateX(0)', offset: 1 },
    ], { duration: 1700 });
    return () => animation?.cancel();
  }, []);
  return <div ref={ref} className="kill-line">{line.text}{line.points > 0 && <strong>{` +${line.points}`}</strong>}</div>;
}

export const KillFeed = memo(function KillFeed({ store }: { store: HudStore }) {
  rendered();
  const lines = useHud(store, 'killFeed');
  return <div className="kill-feed" data-hud="killFeed" role="log" aria-live="polite">{lines.map(line => <KillLine line={line} key={line.id} />)}</div>;
});

export const CentreMessage = memo(function CentreMessage({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'message');
  const mainRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  useEffect(() => {
    if (state.nonce === 0 || state.main === '') return;
    animationRef.current?.cancel();
    const animation = mainRef.current?.animate([
      { opacity: 0, transform: 'scale(1.7)', filter: 'blur(3px)', offset: 0 },
      { opacity: 1, transform: 'scale(0.95)', filter: 'blur(0)', offset: 0.55 },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', offset: 1 },
    ], { duration: 550, easing: 'ease-out' }) ?? null;
    animationRef.current = animation;
    return () => animation?.cancel();
  }, [state.nonce]);
  useEffect(() => {
    if (state.main === '') animationRef.current?.cancel();
  }, [state.main]);
  const shown = state.main !== '';
  return <div className={`center-message${shown ? ' is-visible' : ''}`} data-hud="message" role="status"><div ref={mainRef} className="message-main" data-hud="messageMain">{state.main}</div><div className="message-sub" data-hud="messageSub">{state.sub}</div></div>;
});

/** Exact equivalent of the old sanitizer: keep text and nested bold only. */
function setBoldText(el: HTMLElement, value: string): void {
  const template = el.ownerDocument.createElement('template');
  template.innerHTML = value;
  const copy = (source: Node, target: ParentNode): void => {
    for (const node of source.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) target.append(el.ownerDocument.createTextNode(node.textContent ?? ''));
      else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE') continue;
        if (node.nodeName === 'B' || node.nodeName === 'STRONG') {
          const bold = el.ownerDocument.createElement('b');
          copy(node, bold);
          target.append(bold);
        } else copy(node, target);
      }
    }
  };
  const fragment = el.ownerDocument.createDocumentFragment();
  copy(template.content, fragment);
  el.replaceChildren(fragment);
}

export const TipLine = memo(function TipLine({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'tip');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) setBoldText(ref.current, state.html);
  }, [state.html, state.nonce]);
  return <div ref={ref} className={`tip-line${state.html ? ' is-visible' : ''}`} data-hud="tip" role="status" />;
});

export const PvpScore = memo(function PvpScore({ store }: { store: HudStore }) {
  rendered();
  const html = useHud(store, 'pvp');
  return (
    <div className={`top-right hud-block${html !== null ? ' pvp' : ''}`} data-hud="topRight">
      <WaveBlock store={store} />
      <div className="pvp-score" data-hud="pvpScore" hidden={html === null} dangerouslySetInnerHTML={{ __html: html ?? '' }} />
    </div>
  );
});

export const Scoreboard = memo(function Scoreboard({ store }: { store: HudStore }) {
  rendered();
  const html = useHud(store, 'board');
  return <div className="scoreboard" data-hud="board" hidden={html === null} dangerouslySetInnerHTML={{ __html: html ?? '' }} />;
});

interface ActTarget extends HTMLElement {
  disabled?: boolean;
  value?: string;
  type?: string;
  checked?: boolean;
}

const asTarget = (target: EventTarget | null): ActTarget | null => target instanceof HTMLElement ? target : null;

export const ScreenOverlay = memo(function ScreenOverlay({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'screen');
  const panelRef = useRef<HTMLElement>(null);

  const act = (el: ActTarget | null, event: Event): void => {
    if (!el || el.disabled) return;
    let value = el.dataset.val ?? (el.matches('input,select,textarea') ? el.value ?? null : null);
    if (el.type === 'checkbox') value = el.checked ? '1' : '0';
    if (el.type === 'radio' && !el.checked) return;
    if (isUiAction(el.dataset.act)) store.onUiAction?.(el.dataset.act, value, event);
  };

  const click = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = asTarget(event.target);
    const el = target?.closest<ActTarget>('[data-act]') ?? null;
    if (el || target?.closest('[data-ui-block],input,select,textarea,button,label')) {
      event.stopPropagation();
      if (el && !el.matches('input,select,textarea')) act(el, event.nativeEvent);
      return;
    }
    store.onScreenClick?.();
  };

  const form = (event: FormEvent<HTMLDivElement>): void => {
    const el = asTarget(event.target)?.closest<ActTarget>('[data-act]') ?? null;
    if (!el) return;
    event.stopPropagation();
    if (el.dataset.act === 'joinCode') el.value = el.value?.toUpperCase().slice(0, 5);
    if (el.dataset.act === 'sens') {
      const output = panelRef.current?.querySelector<HTMLElement>('[data-sens-output]');
      if (output) output.textContent = `${el.value}%`;
    }
    act(el, event.nativeEvent);
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = asTarget(event.target);
    if (target?.closest('[data-ui-input-block],input,select,textarea,button')) event.stopPropagation();
    if (event.type === 'keydown' && event.key === 'Enter' && target?.matches('[data-act="joinCode"]')) {
      event.preventDefault();
      act(target, event.nativeEvent);
    }
    if (event.type !== 'keydown' || event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el => !el.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = panel.ownerDocument.activeElement;
    if (!first) { event.preventDefault(); panel.focus({ preventScroll: true }); }
    else if (event.shiftKey && (active === first || active === panel)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || state.html === null) return;
    panel.scrollTop = 0;
    const title = panel.querySelector('h1');
    if (title) {
      title.id = 'hud-screen-title';
      panel.setAttribute('aria-labelledby', title.id);
    } else panel.removeAttribute('aria-labelledby');
    panel.focus({ preventScroll: true });
  }, [state.html]);

  return (
    <div className="screen-overlay" data-hud="screen" hidden={state.html === null} onClick={click} onChange={form} onKeyDown={key} onKeyUp={key}>
      <section ref={panelRef} className="screen-panel" data-hud="panel" role="dialog" aria-modal="true" aria-label="Game menu" tabIndex={-1} dangerouslySetInnerHTML={{ __html: state.html ?? '' }} />
    </div>
  );
});

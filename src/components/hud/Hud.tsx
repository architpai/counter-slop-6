'use client';

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react';
import type { DamageMark, HudStore, KillLine as KillLineState } from '@/engine/hud/store';
import { Bold, BoardPanel, PvpPanel, Screen, SCREEN_TITLE_ID } from './Screens';
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

  const className = [
    'game-hud',
    !gameplay && 'no-gameplay',
    device && 'gamepad',
    health.low && 'low-health',
    screen !== null && 'screen-open',
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

export const TipLine = memo(function TipLine({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'tip');
  return <div className={`tip-line${state.html ? ' is-visible' : ''}`} data-hud="tip" role="status"><Bold text={state.html} /></div>;
});

export const PvpScore = memo(function PvpScore({ store }: { store: HudStore }) {
  rendered();
  const model = useHud(store, 'pvp');
  return (
    <div className={`top-right hud-block${model !== null ? ' pvp' : ''}`} data-hud="topRight">
      <WaveBlock store={store} />
      <div className="pvp-score" data-hud="pvpScore" hidden={model === null}>{model === null ? null : <PvpPanel model={model} />}</div>
    </div>
  );
});

export const Scoreboard = memo(function Scoreboard({ store }: { store: HudStore }) {
  rendered();
  const model = useHud(store, 'board');
  return <div className="scoreboard" data-hud="board" hidden={model === null}>{model === null ? null : <BoardPanel model={model} />}</div>;
});

export const ScreenOverlay = memo(function ScreenOverlay({ store }: { store: HudStore }) {
  rendered();
  const view = useHud(store, 'screen');
  const device = useHud(store, 'device');
  const panelRef = useRef<HTMLElement>(null);

  const click = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    // A click inside a block belongs to the block; only the backdrop dismisses.
    if (target?.closest('[data-ui-block],input,select,textarea,button,label')) {
      event.stopPropagation();
      return;
    }
    store.onScreenClick?.();
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('[data-ui-input-block],input,select,textarea,button')) event.stopPropagation();
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

  // A screen change resets the scroll and takes focus; a redraw of the same
  // screen (a status line landing, say) must not yank focus out of an input.
  const kind = view?.kind ?? null;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || kind === null) return;
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
  }, [kind]);

  // Fit legacy screens and unusually long checkpoint lists without scrolling.
  // Observe content too: menu pages and device controls can change independently
  // of the engine's screen model.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const content = panel?.firstElementChild;
    if (!panel || !content || view === null) return;
    const fit = (): void => {
      panel.style.zoom = '1';
      const zoom = Math.min(1, (window.innerWidth - 24) / panel.scrollWidth, (window.innerHeight - 24) / panel.scrollHeight);
      panel.style.zoom = zoom.toFixed(3);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    fit();
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [view, device]);

  return (
    <div className="screen-overlay" data-hud="screen" hidden={view === null} onClick={click} onKeyDown={key} onKeyUp={key}>
      <section ref={panelRef} className="screen-panel" data-hud="panel" data-screen-kind={kind ?? undefined} role="dialog" aria-modal="true" aria-label="Game menu" aria-labelledby={SCREEN_TITLE_ID} tabIndex={-1}>
        <div className="screen-content">{view === null ? null : <Screen view={view} pad={device} onAction={(act, value, ev) => store.onUiAction?.(act, value, ev)} />}</div>
      </section>
    </div>
  );
});

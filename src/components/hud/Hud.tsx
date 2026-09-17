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
import { OPTIC_COLOR } from '@/engine/render/palette';

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
    <div className={`crosshair${state.melee ? ' melee' : ''}${state.ads ? ' ads' : ''}`} data-hud="crosshair" aria-hidden="true">
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
  const pad = useHud(store, 'device');
  return (
    <div className="weapon-slots" data-hud="slots">
      {slots.map((slot, index) => (
        <div className={`weapon-slot${slot.active ? ' active' : ''}${slot.empty ? ' empty' : ''}`} key={`${index}:${slot.name}`}>
          <span className="slot-badge">{index + 1}</span><span>{slot.name}</span><span className="slot-ammo">{slot.ammo}</span>
        </div>
      ))}
      <div className="melee-hint"><b>{pad ? 'R1 / RB' : 'F / V'}</b> MELEE <span>∞</span></div>
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
      <div className="wave-line">{state.wave === 0 ? 'TRAINING GROUND' : <>WAVE <strong data-hud="wave">{state.wave}</strong></>}</div>
      <Modifier store={store} />
      <div className="enemies-line"><strong data-hud="enemies">{state.left}</strong> {state.wave === 0 ? 'targets ready' : 'enemies left'}</div>
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
  const state = useHud(store, 'scope');
  return (
    <div className={`scope ${state.kind}${state.shown ? ' is-visible' : ''}`} data-hud="scope" data-kind={state.kind} aria-hidden={!state.shown}>
      {state.kind === 'acog' ? (
        <svg className="acog-optic" viewBox="0 0 1000 1000" aria-hidden="true">
          <defs>
            <linearGradient id="acog-metal" x2="0.8" y2="1">
              <stop stopColor="#706b60" /><stop offset=".3" stopColor={OPTIC_COLOR.acogBody} />
              <stop offset=".65" stopColor="#171b1c" /><stop offset="1" stopColor="#514e45" />
            </linearGradient>
            <radialGradient id="acog-bevel">
              <stop offset=".67" stopColor="#080b0c" /><stop offset=".74" stopColor="#272826" />
              <stop offset=".84" stopColor="#111516" /><stop offset=".96" stopColor="#30322e" />
              <stop offset="1" stopColor={OPTIC_COLOR.acogRim} />
            </radialGradient>
          </defs>
          <g fill="url(#acog-metal)" stroke="#191d1d" strokeWidth="5">
            <path d="M365 930 L382 838 H618 L635 930 L690 1000 V1500 H310 V1000 Z" />
            <path d="M385 110 V44 Q500 22 615 44 V110 Z" />
            <path d="M405 48 V96 M430 44 V94 M455 41 V93 M480 39 V91 M505 39 V91 M530 40 V92 M555 42 V94 M580 45 V96" stroke="#222624" strokeWidth="9" />
            <path d="M129 345 L83 303 L137 210 L191 158 L300 129 L700 129 L809 158 L863 210 L917 303 L871 345 V655 L917 697 L863 790 L809 842 L700 871 H300 L191 842 L137 790 L83 697 L129 655 Z M780 500 A280 280 0 1 0 220 500 A280 280 0 1 0 780 500" fillRule="evenodd" />
            <circle cx="500" cy="500" r="347" fill="none" stroke="#111515" strokeWidth="140" />
          </g>
          <path d="M914 500 A414 414 0 1 0 86 500 A414 414 0 1 0 914 500 M780 500 A280 280 0 1 0 220 500 A280 280 0 1 0 780 500" fill="url(#acog-bevel)" fillRule="evenodd" />
          <circle cx="500" cy="500" r="294" fill="none" stroke="#050809" strokeWidth="28" />
          <g fill="#0c1011" stroke={OPTIC_COLOR.acogRim} strokeWidth="7">
            <circle cx="175" cy="175" r="48" /><circle cx="825" cy="175" r="48" />
            <circle cx="175" cy="825" r="48" /><circle cx="825" cy="825" r="48" />
            <path d="M28 424 H113 V576 H28 Z M887 424 H972 V576 H887 Z" fill="url(#acog-metal)" />
          </g>
          <path d="M46 443 H99 M46 461 H99 M46 479 H99 M46 497 H99 M46 515 H99 M46 533 H99 M46 551 H99 M901 443 H954 M901 461 H954 M901 479 H954 M901 497 H954 M901 515 H954 M901 533 H954 M901 551 H954" stroke="#121718" strokeWidth="10" />
          <g className="acog-reticle" color={OPTIC_COLOR.reticle}>
            {/* The outer chevron tip is the camera's exact aiming point. */}
            <path className="acog-chevron" d="M500 500 L486 520 L491 520 L500 508 L509 520 L514 520 Z" />
            <path d="M500 566 V724 M491 590 H509 M493 618 H507 M494 648 H506 M495 724 H505" />
            <path className="acog-illuminated" d="M500 520 V574 M488 537 H512 M490 560 H510" />
            <text x="517" y="541">4</text><text x="515" y="564">6</text>
          </g>
        </svg>
      ) : state.kind === 'holo' ? (
        <svg className="holo-optic" viewBox="0 0 1000 1000" aria-hidden="true">
          <path d="M340 775 H660 L705 930 V1500 H295 V930 Z" fill={OPTIC_COLOR.holoBase} stroke="#090e10" strokeWidth="14" />
          <path d="M230 200 H770 Q820 200 820 250 V745 Q820 800 765 800 H235 Q180 800 180 745 V250 Q180 200 230 200 Z M285 275 Q255 275 255 305 V685 Q255 720 290 720 H710 Q745 720 745 685 V305 Q745 275 715 275 Z"
            fill={OPTIC_COLOR.holoBody} stroke="#0c1316" strokeWidth="12" fillRule="evenodd" />
          <rect x="258" y="278" width="484" height="439" rx="28" fill="#90bdba" fillOpacity=".045" stroke="#687773" strokeWidth="5" />
          <path d="M250 818 H750 V892 H250 Z" fill="#222c31" stroke="#0c1316" strokeWidth="9" />
          <g fill="#111a20" stroke="#75807f" strokeWidth="4"><circle cx="215" cy="760" r="13" /><circle cx="785" cy="760" r="13" /></g>
          <g className="holo-reticle" color={OPTIC_COLOR.reticle} stroke="currentColor" strokeWidth="2" fill="none">
            <circle cx="500" cy="500" r="22" />
            <path d="M500 472 V482 M500 518 V528 M472 500 H482 M518 500 H528" />
            <circle cx="500" cy="500" r="2" fill="currentColor" stroke="none" />
          </g>
        </svg>
      ) : <><div className="scope-ring" /><div className="scope-cross horizontal" /><div className="scope-cross vertical" /><div className="scope-dot" /></>}
    </div>
  );
});

export const GrappleReticle = memo(function GrappleReticle({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'grapple');
  return <div className="grapple-reticle" data-hud="grappleReticle" data-state={state} aria-hidden="true" />;
});

export const Hitmarker = memo(function Hitmarker({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'hitmarker');
  const ref = useRef<SVGSVGElement>(null), killRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (state.nonce === 0) return;
    const scale = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1.15;
    const animation = ref.current?.animate([
      { opacity: 1, transform: `translate(-50%, -50%) scale(${scale})` },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: state.crit ? 220 : 150, easing: 'ease-out' });
    return () => animation?.cancel();
  }, [state.nonce, state.crit]);
  useEffect(() => {
    if (state.killNonce === 0) return;
    const animation = killRef.current?.animate([
      { opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 },
    ], { duration: 350 });
    return () => animation?.cancel();
  }, [state.killNonce]);
  return <>
    <svg ref={ref} className={`hit-marker${state.crit ? ' crit' : ''}${state.blocked ? ' blocked' : ''}`} viewBox="-20 -20 40 40" data-hud="hitmarker" aria-hidden="true">
      {state.blocked ? <path d="M-12-7v-5h5 M7-12h5v5 M12 7v5H7 M-7 12h-5V7" /> : <>
        <path d="M-14-14l7 7 M14-14l-7 7 M14 14l-7-7 M-14 14l7-7" />
        {state.crit && <path d="M-11-17l7 7 M17-11l-7 7 M11 17l-7-7 M-17 11l7-7" />}
      </>}
    </svg>
    <svg ref={killRef} className="kill-marker" viewBox="0 0 24 26" data-hud="killmarker" aria-hidden="true">
      <path fillRule="evenodd" d="M12 1C5 1 2 5 2 11v6l4 2v5h12v-5l4-2v-6C22 5 19 1 12 1ZM5 10v5h5v-4Zm14 0-5 1v4h5Zm-7 5-2 4h4Zm-3 6v3h2v-3Zm4 0v3h2v-3Z" />
    </svg>
  </>;
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
    if (target?.closest('[data-ui-input-block],input,select,textarea,button,summary')) event.stopPropagation();
    if (event.type !== 'keydown' || event.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length > 0);
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

  // Fit menu content to the viewport without scrolling.
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

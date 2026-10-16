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
import { InstallPrompt } from './InstallPrompt';
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
  const mobile = useHud(store, 'mobile');
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
    mobile.active && 'touch-mode',
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
          <Stragglers store={store} />
          <SquadMarks store={store} />
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
          <Spectate store={store} />
          <CentreMessage store={store} />
          <KillFeed store={store} />
          <FpsCounter store={store} />
          <ScreenOverlay store={store} />
          <QualityPrompt store={store} inPanel={false} />
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

export const Stragglers = memo(function Stragglers({ store }: { store: HudStore }) {
  rendered();
  const count = useHud(store, 'stragglers');
  return <div className="stragglers" data-hud="stragglers" aria-hidden="true">
    {Array.from({ length: count }, (_, i) => <i key={i} style={{ transform: `var(--straggler-${i})` }} />)}
  </div>;
});

export const SquadMarks = memo(function SquadMarks({ store }: { store: HudStore }) {
  rendered();
  const labels = useHud(store, 'marks');
  return <div className="squad-marks" data-hud="marks" aria-hidden="true">
    {labels.map((label, i) => <i key={i} style={{ transform: `var(--mark-${i})` }}><span>{label}</span></i>)}
  </div>;
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
          {/* The NATO holo of Rainbow Six Siege seen from the eye: a tall matte body, a raised bezel round the window,
              four screws on the rear panel and the QD lever on the left. */}
          <defs>
            <linearGradient id="holo-metal" gradientUnits="userSpaceOnUse" x1="0" y1="150" x2="0" y2="1000">
              <stop stopColor="#5b5850" /><stop offset=".35" stopColor={OPTIC_COLOR.holoBody} />
              <stop offset=".75" stopColor="#222120" /><stop offset="1" stopColor="#171716" />
            </linearGradient>
            <linearGradient id="holo-base-metal" x2="0.25" y2="1">
              <stop stopColor="#4d4a44" /><stop offset=".4" stopColor={OPTIC_COLOR.holoBase} /><stop offset="1" stopColor="#0e0e0d" />
            </linearGradient>
            {/* The body is round-edged: its sides fall into shadow. */}
            <linearGradient id="holo-side" x1="0" y1="0" x2="1" y2="0">
              <stop stopColor="#000" stopOpacity=".45" /><stop offset=".13" stopColor="#000" stopOpacity="0" />
              <stop offset=".87" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".5" />
            </linearGradient>
            <linearGradient id="holo-lip" gradientUnits="userSpaceOnUse" x1="0" y1="236" x2="0" y2="764">
              <stop stopColor="#77736a" /><stop offset=".12" stopColor="#47453f" /><stop offset=".85" stopColor="#2a2926" /><stop offset="1" stopColor="#4f4c46" />
            </linearGradient>
            {/* The hood's inside: the top wall in its own shadow, the bottom wall lit from above. */}
            <linearGradient id="holo-wall" gradientUnits="userSpaceOnUse" x1="0" y1="262" x2="0" y2="738">
              <stop stopColor="#070707" /><stop offset=".5" stopColor="#181715" /><stop offset="1" stopColor="#3b3934" />
            </linearGradient>
            <linearGradient id="holo-chamfer" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#0b0b0a" /><stop offset=".55" stopColor="#262522" /><stop offset="1" stopColor="#6e6a61" />
            </linearGradient>
            <radialGradient id="holo-coat" cx=".5" cy=".5" r=".7">
              <stop offset=".4" stopColor="#b4dcdc" stopOpacity="0" /><stop offset="1" stopColor="#6fa6b0" stopOpacity=".1" />
            </radialGradient>
            <linearGradient id="holo-glare" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#fff" stopOpacity=".08" /><stop offset=".5" stopColor="#fff" stopOpacity=".02" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            {/* The near opening, in the body's place, and the far one, in the window's: the hood is a tunnel. */}
            <clipPath id="holo-near"><rect x="240" y="262" width="520" height="476" rx="26" /></clipPath>
            <clipPath id="holo-far"><rect x="270" y="292" width="460" height="416" rx="14" /></clipPath>
          </defs>
          <g className="holo-near">
            <g clipPath="url(#holo-near)">
              <g className="holo-far">
                <path d="M-500 -500 H1500 V1500 H-500 Z M284 292 Q270 292 270 306 V694 Q270 708 284 708 H716 Q730 708 730 694 V306 Q730 292 716 292 Z"
                  fill="url(#holo-wall)" fillRule="evenodd" />
                <rect x="270" y="292" width="460" height="416" rx="14" fill="url(#holo-coat)" />
                <g clipPath="url(#holo-far)">
                  <g className="holo-still">
                    <g className="holo-reticle" color={OPTIC_COLOR.reticle} stroke="currentColor" fill="none" strokeLinecap="round">
                      <g className="holo-bloom" strokeWidth="8">
                        <circle cx="500" cy="500" r="34" />
                        <path d="M500 455 V466 M500 534 V545 M455 500 H466 M534 500 H545" />
                        <circle cx="500" cy="500" r="3" fill="currentColor" />
                      </g>
                      <circle className="holo-ring" cx="500" cy="500" r="34" strokeWidth="2.6" />
                      <path d="M500 455 V466 M500 534 V545 M455 500 H466 M534 500 H545" strokeWidth="2.6" />
                      <circle cx="500" cy="500" r="3" fill="currentColor" stroke="none" />
                    </g>
                  </g>
                </g>
                <path d="M284 293 H410 L271 448 V306 Q271 293 284 293 Z" fill="url(#holo-glare)" />
                <rect x="266" y="288" width="468" height="424" rx="17" fill="none" stroke="#46433d" strokeWidth="5" />
              </g>
            </g>
            <path d="M240 288 Q240 262 266 262 H734 Q760 262 760 288 V712 Q760 738 734 738 H266 Q240 738 240 712 Z M254 296 Q254 276 274 276 H726 Q746 276 746 296 V704 Q746 724 726 724 H274 Q254 724 254 704 Z"
              fill="url(#holo-chamfer)" fillRule="evenodd" />
            <path d="M176 560 H150 Q130 560 130 580 V762 Q130 782 150 782 H176 Z" fill="url(#holo-base-metal)" stroke="#0c0c0b" strokeWidth="5" />
            <path d="M136 578 Q136 566 150 566 H172" fill="none" stroke="#7d786e" strokeOpacity=".5" strokeWidth="3" />
            <path d="M172 1500 V222 Q172 150 244 150 H756 Q828 150 828 222 V1500 Z M266 262 Q240 262 240 288 V712 Q240 738 266 738 H734 Q760 738 760 712 V288 Q760 262 734 262 Z"
              fill="url(#holo-metal)" stroke="#0c0c0b" strokeWidth="6" fillRule="evenodd" />
            <path d="M172 1500 V222 Q172 150 244 150 H756 Q828 150 828 222 V1500 Z M266 262 Q240 262 240 288 V712 Q240 738 266 738 H734 Q760 738 760 712 V288 Q760 262 734 262 Z"
              fill="url(#holo-side)" fillRule="evenodd" />
            <path d="M180 224 Q180 158 246 158 H754 Q820 158 820 224" fill="none" stroke="#8d887d" strokeOpacity=".55" strokeWidth="3" />
            <path d="M258 236 H742 Q786 236 786 280 V720 Q786 764 742 764 H258 Q214 764 214 720 V280 Q214 236 258 236 Z M266 262 Q240 262 240 288 V712 Q240 738 266 738 H734 Q760 738 760 712 V288 Q760 262 734 262 Z"
              fill="url(#holo-lip)" stroke="#0c0c0b" strokeWidth="4" fillRule="evenodd" />
            <path d="M222 278 Q222 244 258 244 H742 Q778 244 778 278" fill="none" stroke="#a29d91" strokeOpacity=".45" strokeWidth="2.5" />
            <g fill="#141413" stroke="#6f6a60" strokeWidth="3.5"><circle cx="262" cy="830" r="24" /><path d="M248 830 H276 M262 816 V844" /><circle cx="738" cy="830" r="24" /><path d="M724 830 H752 M738 816 V844" /><circle cx="262" cy="958" r="24" /><path d="M248 958 H276 M262 944 V972" /><circle cx="738" cy="958" r="24" /><path d="M724 958 H752 M738 944 V972" /></g>
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

export const Spectate = memo(function Spectate({ store }: { store: HudStore }) {
  rendered();
  const state = useHud(store, 'spectate');
  return <div className={`spectate-bar${state.name ? ' is-visible' : ''}`} data-hud="spectate" aria-live="polite">
    {state.name && <><span className="spectate-label">spectating</span> <b>{state.name}</b>{state.status && <span className="spectate-status">{state.status}</span>}</>}
  </div>;
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

export const FpsCounter = memo(function FpsCounter({ store }: { store: HudStore }) {
  rendered();
  const fps = useHud(store, 'fps');
  return fps === null ? null : <div className="fps-counter" data-hud="fps" aria-hidden="true">{fps} FPS</div>;
});

/**
 * The one-time offer when dynamic resolution has hit its floor. It never blocks
 * play. With a menu open it moves inside the panel, so Tab and the panel's
 * focus trap reach its buttons; in play a locked mouse cannot, so it says how.
 */
export const QualityPrompt = memo(function QualityPrompt({ store, inPanel }: { store: HudStore; inPanel: boolean }) {
  rendered();
  const preset = useHud(store, 'qualityPrompt');
  const menuOpen = useHud(store, 'screen') !== null;
  const touch = useHud(store, 'mobile').active;
  if (preset === null || menuOpen !== inPanel) return null;
  const name = preset.charAt(0).toUpperCase() + preset.slice(1);
  const answer = (value: 'yes' | 'no', event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    store.onUiAction?.('gfxLower', value, event.nativeEvent);
  };
  return (
    <div className="quality-prompt" data-hud="qualityPrompt" data-ui-block="" role="status">
      <span>Frame rate is low. Lower graphics to <b>{name}</b>?</span>
      <button type="button" onClick={event => answer('yes', event)}>Lower</button>
      <button type="button" onClick={event => answer('no', event)}>Keep</button>
      {inPanel || touch ? null : <small>Pause to answer</small>}
    </div>
  );
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
  const mobile = useHud(store, 'mobile');
  const panelRef = useRef<HTMLElement>(null);

  const click = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    // A click inside a block belongs to the block; only the backdrop dismisses.
    if (target?.closest('[data-ui-block],input,select,textarea,button,label')) {
      event.stopPropagation();
      return;
    }
    // Starting or restarting a run takes its button (or the confirm key, for
    // controller players): the main menu fills the screen, and a player still
    // firing as they die would skip the death screen.
    if (view?.kind === 'main' || view?.kind === 'dead') return;
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
      if (mobile.active) return; // Touch menus scroll; never shrink their targets.
      const zoom = Math.min(1, (window.innerWidth - 24) / panel.scrollWidth, (window.innerHeight - 24) / panel.scrollHeight);
      panel.style.zoom = zoom.toFixed(3);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    fit();
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [view, device, mobile.active]);

  return (
    <div className="screen-overlay" data-hud="screen" data-screen-kind={kind ?? undefined} hidden={view === null} onClick={click} onKeyDown={key} onKeyUp={key}>
      <section ref={panelRef} className="screen-panel" data-hud="panel" data-screen-kind={kind ?? undefined} role="dialog" aria-modal="true" aria-label="Game menu" aria-labelledby={SCREEN_TITLE_ID} tabIndex={-1}>
        <div className="screen-content"><QualityPrompt store={store} inPanel={true} />{view === null ? null : <Screen view={view} pad={device} onAction={(act, value, ev) => store.onUiAction?.(act, value, ev)} />}<InstallPrompt visible={view?.kind === 'main' && mobile.active} /></div>
      </section>
    </div>
  );
});

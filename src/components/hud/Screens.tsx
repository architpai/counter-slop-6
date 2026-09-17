'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { KEYBOARD_ROWS, PAD_ROWS } from '@/engine/hud/labels';
import type {
  BoardModel, BoardRow, DeadModel, LobbyModel, MainModel, MatchOnModel, MenuModel,
  OnlineModel, OverModel, PauseModel, PvpModel, ScreenView, UiAction, LookModel, WeaponSettingsModel,
} from '@/engine/hud/screens';

/**
 * The rendering half of the menus. Models come from the engine through
 * `hud.showScreen`; every control reports back through one `onAction` prop, so
 * there is no click delegation and no markup string anywhere in the path.
 */
export type Act = (act: UiAction, value: string | null, ev: Event) => void;

/** The id every screen's `<h1>` carries, so the panel can label itself. */
export const SCREEN_TITLE_ID = 'hud-screen-title';

// ------------------------------------------------------------------- helpers

const count = (value: number): number => Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value))) : 0;
const list = <T,>(value: T[] | undefined): T[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const sorted = (rows: BoardRow[]): BoardRow[] => list(rows).slice().sort((a, b) => count(b.kills) - count(a.kills) || count(a.deaths) - count(b.deaths));

/** The subset of any model that `Settings` renders. */
type SettingsModel = LookModel;
/** The subset of any model that `Maps` renders. */
type MapsModel = Pick<MainModel, 'maps' | 'mapKey'>;

const BOLD = /<(b|strong)>([\s\S]*?)<\/\1>/gi;

/**
 * The one bold-markup renderer: control rows and engine tips are plain text
 * with `<b>` in it. Anything else stays literal text — no HTML is parsed.
 */
export function Bold({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    const at = match.index ?? last;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<b key={at}>{match[2]}</b>);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ------------------------------------------------------------------- pieces

function Title({ text, sub = '' }: { text: string; sub?: string }) {
  return <><h1 className="screen-title" id={SCREEN_TITLE_ID}>{text}</h1>{sub ? <h2 className="screen-subtitle">{sub}</h2> : null}</>;
}

function Status({ text }: { text: string }) {
  return <p className="screen-status" role="status" aria-live="polite">{text}</p>;
}

interface ButtonProps {
  act: UiAction; text: string; onAction: Act;
  value?: string | null; primary?: boolean; sub?: string; disabled?: boolean;
}

function Button({ act, text, onAction, value = null, primary = false, sub = '', disabled = false }: ButtonProps) {
  return (
    <button type="button" className={`screen-button${primary ? ' primary' : ''}`} data-act={act} disabled={disabled}
      onClick={event => onAction(act, value, event.nativeEvent)}>
      {text}{sub ? <small>{sub}</small> : null}
    </button>
  );
}

function MainMenu({ onAction }: { onAction: Act }) {
  return <div className="screen-actions" data-ui-block=""><Button act="mainMenu" text="MAIN MENU" onAction={onAction} /></div>;
}

function Prompt({ confirmKey, end, start = 'CLICK ANYWHERE' }: { confirmKey: string; end: string; start?: string }) {
  return <p className="screen-prompt">{start} (or press <span data-control="confirm">{confirmKey}</span>) {end}</p>;
}

/**
 * The current device comes from the store, not from guessing at a key label.
 * `ScreenOverlay` subscribes and passes it down.
 */
export function Controls({ pad }: { pad: boolean }) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const active = selected ?? pad;
  return (
    <div className="controls-panel" data-ui-block="">
      <div className="control-switch" role="group" aria-label="Control device">
        <button type="button" aria-pressed={!active} onClick={() => setSelected(false)}>Mouse + keyboard</button>
        <button type="button" aria-pressed={active} onClick={() => setSelected(true)}>Controller</button>
      </div>
      <div className="screen-controls">
        <section className="control-column current-device" data-device={active ? 'gamepad' : 'keyboard'} aria-label={active ? 'Controller controls' : 'Keyboard controls'}>
          <ol>{(active ? PAD_ROWS : KEYBOARD_ROWS).map((row, index) => <li className="control-row" key={index}><Bold text={row} /></li>)}</ol>
        </section>
      </div>
    </div>
  );
}

function Weapons({ model, onAction, collapsible = false }: {
  model: WeaponSettingsModel; onAction: Act; collapsible?: boolean;
}) {
  const content = <div className="weapon-customization" data-ui-block="" data-ui-input-block="">
    <p className="weapon-customization-note">Choose a scope for each weapon. Changes apply immediately and are saved on this device.</p>
    {([
      { name: 'R4-C', slot: '01', field: 'r4cOptic', role: 'Assault rifle · medium-range damage' },
      { name: 'MP5', slot: '02', field: 'optic', role: 'SMG · accurate on the move' },
    ] as const).map(weapon => <div className="weapon-customization-row" key={weapon.field}>
      <div className="weapon-identity">
        <span className="slot-badge">{weapon.slot}</span>
        <div><h4>{weapon.name}</h4><p>{weapon.role}</p></div>
      </div>
      <fieldset className="optic-picker" aria-label={`${weapon.name} scope`}>
        <legend>Scope</legend>
        {(['acog', 'holo'] as const).map(kind => <button type="button" className="screen-button" key={kind}
          data-act={weapon.field} data-value={kind} aria-pressed={model[weapon.field] === kind}
          onClick={event => onAction(weapon.field, kind, event.nativeEvent)}>
          {kind === 'acog' ? 'ACOG · 2.5×' : 'HOLO · 1×'}
        </button>)}
      </fieldset>
    </div>)}
  </div>;
  return collapsible ? <details className="weapons-section" data-ui-block="" data-ui-input-block="">
    <summary>Weapons <span>Scope customization</span></summary>
    {content}
  </details> : <section className="weapons-section" aria-label="Weapons">
    <h3>Weapon customization</h3>
    {content}
  </section>;
}

function Sensitivity({ act, label, value, onAction }: {
  act: 'sens' | 'acogSens' | 'sniperSens'; label: string; value: number; onAction: Act;
}) {
  const [readout, setReadout] = useState(value);
  return <label className="settings-row">{label}<input type="range" data-act={act} min={25} max={250} step={5}
    defaultValue={value} onChange={event => { setReadout(Number(event.target.value)); onAction(act, event.target.value, event.nativeEvent); }} />
    <output>{readout}%</output></label>;
}

function Settings({ model, onAction }: { model: SettingsModel; onAction: Act }) {
  return (
    <div className="settings" data-ui-block="" data-ui-input-block="">
      <div className="sensitivity-settings">
        <Sensitivity act="sens" label="Look / Holo sensitivity" value={model.sens} key={`sens-${model.sens}`} onAction={onAction} />
        <Sensitivity act="acogSens" label="ACOG sensitivity" value={model.acogSens} key={`acog-${model.acogSens}`} onAction={onAction} />
        <Sensitivity act="sniperSens" label="Sniper sensitivity" value={model.sniperSens} key={`sniper-${model.sniperSens}`} onAction={onAction} />
        <p>Scoped settings are independent of look. 100% is the standard scoped speed.</p>
      </div>
      {/*
        Uncontrolled on purpose: toggling one does not make the engine redraw,
        so a controlled box would freeze at its old value. The key remounts it
        when the engine changes the setting behind our back -- the M key toggles
        music with a menu open -- which is what rebuilding the HTML used to do.
      */}
      <label className="settings-row"><input type="checkbox" data-act="invert" key={`invert-${model.invert}`} defaultChecked={model.invert} onChange={event => onAction('invert', event.target.checked ? '1' : '0', event.nativeEvent)} /> invert vertical look</label>
      <label className="settings-row"><input type="checkbox" data-act="music" key={`music-${model.music}`} defaultChecked={model.music} onChange={event => onAction('music', event.target.checked ? '1' : '0', event.nativeEvent)} /> music <span className="dim">(M)</span></label>
    </div>
  );
}

function Maps({ model, onAction, disabled = false, previews = false }: { model: MapsModel; onAction: Act; disabled?: boolean; previews?: boolean }) {
  const choices = list(model.maps);
  if (choices.length < 2) return null;
  return (
    <div className={`map-picker${previews ? ' map-previews' : ''}`} data-ui-block="">
      <h3>Choose your map</h3>
      {choices.map(map => {
        const selected = map.key === model.mapKey;
        return (
          <button type="button" className={`screen-button map-choice${selected ? ' selected' : ''}`} data-act="pickMap"
            aria-pressed={selected} disabled={disabled} key={map.key}
            onClick={event => onAction('pickMap', map.key, event.nativeEvent)}>
            {previews ? <img src={`/maps/${map.key}.webp`} alt="" width={480} height={270} /> : null}
            <span className="map-name">{map.name}</span><small>{map.blurb}</small>
          </button>
        );
      })}
    </div>
  );
}

function ScoreRows({ rows, full = false }: { rows: BoardRow[]; full?: boolean }) {
  return (
    <div className="score-rows">
      {sorted(rows).map(row => (
        <div className={row.self ? 'self' : undefined} key={row.id}>
          <span>{row.name}{full && row.self ? ' (you)' : ''}</span>
          <span>{`${count(row.kills)} ${full ? 'kills' : 'K'} · ${count(row.deaths)} ${full ? 'deaths' : 'D'}`}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ screens

function MainScreen({ model, pad, onAction }: { model: MainModel; pad: boolean; onAction: Act }) {
  const [page, setPage] = useState<'play' | 'weapons' | 'controls' | 'settings' | null>(null);
  // Controller-only players can read their controls before the confirm button
  // starts play; explicit mouse/keyboard navigation keeps the chosen page.
  const currentPage = page ?? (pad ? 'controls' : 'play');
  return (
    <div className="main-menu">
      <p className="menu-eyebrow">SURVIVE. RELOAD. REPEAT.</p>
      <Title text="COUNTER SLOP 6" sub="a tactical survival shooter, allegedly" />
      <nav className="menu-nav" aria-label="Main menu pages" data-ui-block="">
        {(['play', 'weapons', 'controls', 'settings'] as const).map(item => (
          <button type="button" key={item} aria-pressed={currentPage === item} aria-controls="main-menu-content" onClick={() => setPage(item)}>{item}</button>
        ))}
      </nav>
      <div id="main-menu-content" className="menu-page">
        {currentPage === 'play' ? <>
          <Maps model={model} onAction={onAction} previews />
          <div className="screen-actions launch-actions" data-ui-block="">
            <Button act="start" text="START SOLO" primary sub="survive the waves" onAction={onAction} />
            <Button act="online" text="PLAY ONLINE" sub="free for all · up to 8 players" onAction={onAction} />
            <Button act="training" text="TRAINING GROUND" sub="inspect models · passive targets" onAction={onAction} />
          </div>
          <p className="screen-footer">{count(model.best) > 0 ? `Personal best · ${count(model.best)}` : 'One more wave. One more try.'}</p>
        </> : currentPage === 'controls' ? <>
          <Controls pad={pad} />
          {pad ? <p className="screen-footer">Press {model.confirmKey} to start solo</p> : null}
        </> : currentPage === 'weapons' ? <Weapons model={model} onAction={onAction} />
          : <Settings model={model} onAction={onAction} />}
      </div>
    </div>
  );
}

function CodeInput({ code, onAction }: { code: string; onAction: Act }) {
  const [value, setValue] = useState(() => String(code ?? '').toUpperCase().slice(0, 5));
  const send = (next: string, ev: Event): void => { setValue(next); onAction('joinCode', next, ev); };
  return (
    <input type="text" data-act="joinCode" maxLength={5} placeholder="CODE" value={value} autoComplete="off"
      autoCapitalize="characters" spellCheck={false} aria-label="Lobby code"
      onChange={event => send(event.target.value.toUpperCase().slice(0, 5), event.nativeEvent)}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); send(value, event.nativeEvent); } }} />
  );
}

function OnlineScreen({ model, onAction }: { model: OnlineModel; onAction: Act }) {
  const isPublic = model.isPublic !== false;
  return (
    <>
      <Title text="PLAY ONLINE" sub="free for all · first to 20 · up to 8 players" />
      <div className="online-box" data-ui-block="" data-ui-input-block="">
        <label className="settings-row">your name <input type="text" data-act="name" maxLength={14} defaultValue={String(model.name ?? '').slice(0, 14)} autoComplete="nickname" spellCheck={false} onChange={event => onAction('name', event.target.value, event.nativeEvent)} /></label>
        <div className="screen-actions"><Button act="quickPlay" text="QUICK PLAY" primary disabled={model.busy} onAction={onAction} /></div>
        <p className="screen-footer">jumps into an open public lobby, or opens one for you</p>
        <p className="online-or">or</p>
        <div className="screen-actions"><Button act="create" text="CREATE LOBBY" disabled={model.busy} onAction={onAction} /></div>
        <div className="visibility-options" role="group" aria-label="Lobby visibility">
          <label><input type="radio" name="lobby-visibility" data-act="visibility" value="public" defaultChecked={isPublic} onChange={event => onAction('visibility', 'public', event.nativeEvent)} /> public</label>
          <label><input type="radio" name="lobby-visibility" data-act="visibility" value="private" defaultChecked={!isPublic} onChange={event => onAction('visibility', 'private', event.nativeEvent)} /> private · friends only</label>
        </div>
        <div className="settings-row"><label>have a code? <CodeInput code={model.code} onAction={onAction} /></label><Button act="join" text="JOIN" disabled={model.busy} onAction={onAction} /></div>
        <Status text={model.status} />
        <div className="screen-actions"><Button act="back" text="BACK" onAction={onAction} /></div>
      </div>
    </>
  );
}

function LobbyScreen({ model, onAction }: { model: LobbyModel; onAction: Act }) {
  const players = list(model.players);
  return (
    <>
      <Title text="LOBBY" sub={`free for all · first to 20 · ${players.length}/8 players`} />
      <p>code <strong className="lobby-code">{model.code}</strong></p>
      <Maps model={model} onAction={onAction} disabled={!model.isHost} />
      <Weapons model={model} onAction={onAction} collapsible />
      <p className="screen-footer">{model.isPublic
        ? 'this lobby is public: anyone can quick play in, or type the code'
        : 'private lobby: friends type this code under PLAY ONLINE → JOIN'}</p>
      <div className="lobby-players">
        {players.map(player => (
          <div className={player.self ? 'self' : undefined} key={player.id}>
            <span>{player.name}{player.host ? <span className="dim"> · host</span> : null}</span>
            <span>{player.self ? 'you' : ''}</span>
          </div>
        ))}
      </div>
      <div className="screen-actions" data-ui-block="">
        <Button act="startMatch" text="START MATCH" primary onAction={onAction} />
        <Button act="leave" text="LEAVE" onAction={onAction} />
      </div>
      <Status text={model.status} />
      <p className="screen-footer">anyone can start · {players.length < 2 ? 'people can still join once it is running' : `${players.length} players in`}</p>
    </>
  );
}

function PauseOptions({ model, pad, onAction }: { model: LookModel & WeaponSettingsModel; pad: boolean; onAction: Act }) {
  const [page, setPage] = useState<'controls' | 'settings' | 'weapons'>('controls');
  return <>
    <nav className="menu-nav" aria-label="Pause menu pages" data-ui-block="">
      {(['controls', 'settings', 'weapons'] as const).map(item => <button type="button" key={item}
        aria-pressed={page === item} onClick={() => setPage(item)}>{item}</button>)}
    </nav>
    <div className="menu-page">
      {page === 'controls' ? <Controls pad={pad} /> : page === 'settings' ? <Settings model={model} onAction={onAction} />
        : <Weapons model={model} onAction={onAction} />}
    </div>
  </>;
}

function PauseScreen({ model, pad, onAction }: { model: PauseModel; pad: boolean; onAction: Act }) {
  return (
    <>
      <Title text="PAUSED" sub={model.training ? 'training ground · no return fire' : `wave ${count(model.wave)} · score ${count(model.score)}`} />
      {model.training ? <div className="screen-actions" data-ui-block=""><Button act="training" text="RESET RANGE" sub="restore targets, ammo and starting position" onAction={onAction} /></div> : null}
      <PauseOptions model={model} pad={pad} onAction={onAction} />
      <MainMenu onAction={onAction} />
      <Prompt confirmKey={model.confirmKey} end="TO RESUME" />
    </>
  );
}

function MenuScreen({ model, pad, onAction }: { model: MenuModel; pad: boolean; onAction: Act }) {
  return (
    <>
      <Title text="MENU" sub={`free for all · lobby ${model.code ?? ''}`} />
      <ScoreRows rows={model.rows} />
      <PauseOptions model={model} pad={pad} onAction={onAction} />
      <div className="screen-actions" data-ui-block=""><Button act="leaveMatch" text="LEAVE MATCH" onAction={onAction} /></div>
      <Prompt confirmKey={model.confirmKey} end="TO KEEP PLAYING" />
    </>
  );
}

function MatchOnScreen({ model }: { model: MatchOnModel }) {
  return <><Title text="MATCH ON" sub="free for all · first to 20" /><Prompt confirmKey={model.confirmKey} end="TO PLAY" /></>;
}

function DeadScreen({ model, onAction }: { model: DeadModel; onAction: Act }) {
  const waves = count(model.waves);
  return (
    <>
      <Title text="ELIMINATED" />
      <p className="screen-stats">you survived <b>{waves}</b> {waves === 1 ? 'wave' : 'waves'} · <b>{count(model.kills)}</b> kills · score <b>{count(model.score)}</b> · {model.newBest ? <b>NEW BEST</b> : `best ${count(model.best)}`}</p>
      <MainMenu onAction={onAction} />
      <Prompt confirmKey={model.confirmKey} end="TO RESTART AT WAVE 1" start="CLICK" />
    </>
  );
}

function OverScreen({ model }: { model: OverModel }) {
  return (
    <>
      <Title text={model.youWin ? 'YOU WIN' : `${model.winnerName || 'someone'} WINS`} />
      <ScoreRows rows={model.rows} />
      <p className="screen-prompt">back to the lobby in a moment…</p>
    </>
  );
}

/** Picks the screen off `kind`; the model is narrowed with it. */
export function Screen({ view, pad, onAction }: { view: ScreenView; pad: boolean; onAction: Act }) {
  switch (view.kind) {
    case 'main': return <MainScreen model={view.model} pad={pad} onAction={onAction} />;
    case 'online': return <OnlineScreen model={view.model} onAction={onAction} />;
    case 'lobby': return <LobbyScreen model={view.model} onAction={onAction} />;
    case 'pause': return <PauseScreen model={view.model} pad={pad} onAction={onAction} />;
    case 'menu': return <MenuScreen model={view.model} pad={pad} onAction={onAction} />;
    case 'matchOn': return <MatchOnScreen model={view.model} />;
    case 'dead': return <DeadScreen model={view.model} onAction={onAction} />;
    case 'over': return <OverScreen model={view.model} />;
  }
}

// ------------------------------------------------------------ online panels

export function BoardPanel({ model }: { model: BoardModel }) {
  return (
    <>
      <h2 className="screen-subtitle">FREE FOR ALL</h2>
      <ScoreRows rows={model.rows} full />
      <p className="screen-footer">first to 20 · lobby {model.code}</p>
    </>
  );
}

export function PvpPanel({ model }: { model: PvpModel }) {
  return (
    <>
      <div className="score-rows">
        {sorted(model.rows).map((row, rank) => ({ row, rank, self: row.id === model.selfId }))
          .filter(({ rank, self }) => rank < 3 || self)
          .map(({ row, rank, self }) => (
            <div className={self ? 'self' : undefined} key={row.id}>
              <span className="dim">{rank + 1}.</span><span>{row.name}{self ? ' (you)' : ''}</span><b>{count(row.kills)}</b>
            </div>
          ))}
      </div>
      <p className="screen-footer">first to 20</p>
    </>
  );
}

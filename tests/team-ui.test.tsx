import { afterEach, expect, test, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ReactNode } from 'react';
import { BoardPanel, PvpPanel, Screen } from '@/components/hud/Screens';
import { createUI } from '@/engine/game/ui';
import type { App } from '@/engine/boot';
import type { BoardRow, LobbyModel, OnlineModel, ScreenView } from '@/engine/hud/screens';
import type { OnlineMode, Team } from '@/engine/game/team-rules';
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
const action = (name: string) => host.querySelector<HTMLButtonElement>(`button[data-act="${name}"]`)!;
const modeButtons = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-act="onlineMode"]')];
const roster: LobbyModel = {
  code: 'ABCDE', isPublic: true, isHost: true, mapKey: 'downtown', maps: [], status: '',
  optic: 'holo', r4cOptic: 'acog', mode: 'tdm', players: [
    { id: 'red', name: '<img src=x onerror=alert(1)>', host: true, self: true, team: 0 },
    { id: 'blue', name: 'Blue player', host: false, self: false, team: 1 },
  ],
};
const rows: BoardRow[] = [
  { id: 'blue', name: 'Blue player', kills: 12, deaths: 2, self: false, team: 1 },
  { id: 'red', name: '<img src=x onerror=alert(1)>', kills: 4, deaths: 8, self: true, team: 0 },
];

test('online mode choices are accessible, disabled while busy, and emit the selected mode', () => {
  const onAction = vi.fn();
  const model: OnlineModel = { name: 'Player', code: '', mode: 'flag', isPublic: true, busy: false, status: '' };
  const show = () => render(<Screen view={{ kind: 'online', model }} pad={false} onAction={onAction} />);
  show();
  expect(modeButtons().map(button => button.textContent)).toEqual(['Solo Deathmatch', 'Team Deathmatch', 'Flag Hold']);
  expect(modeButtons().map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  expect(host.textContent).toContain('Finds a public Flag Hold lobby');
  expect(host.textContent).toContain('Joining by code uses the host’s mode');
  modeButtons()[1]!.click();
  expect(onAction).toHaveBeenCalledWith('onlineMode', 'tdm', expect.any(Event));
  model.busy = true; show(); onAction.mockClear();
  expect(modeButtons().every(button => button.disabled)).toBe(true);
  modeButtons()[0]!.click();
  expect(onAction).not.toHaveBeenCalled();
  expect(action('quickPlay').disabled).toBe(true);
});

test('team lobbies show named rosters and need both sides; solo start stays available', () => {
  const model = { ...roster, isPublic: false, players: roster.players.slice() };
  const show = () => render(<Screen view={{ kind: 'lobby', model }} pad={true} onAction={() => {}} />);
  show();
  expect(host.querySelector('[aria-label="RED team roster"]')?.textContent).toContain('RED TEAM 1/4');
  expect(host.querySelector('[aria-label="BLUE team roster"]')?.textContent).toContain('Blue player');
  expect(host.querySelector('img')).toBeNull();
  expect(action('startMatch').disabled).toBe(false);
  expect(modeButtons().every(button => !button.disabled)).toBe(true);
  model.isPublic = true; show();
  expect(modeButtons().every(button => button.disabled)).toBe(true);
  expect(host.textContent).toContain('Public lobby mode is fixed. Create another lobby to change it.');
  model.isPublic = false; model.isHost = false; model.players = [roster.players[0]!]; show();
  expect(modeButtons().every(button => button.disabled)).toBe(true);
  expect(action('startMatch').disabled).toBe(true);
  expect(host.textContent).toContain('Need at least 2 players, with one on each team.');
  model.players.push({ ...roster.players[1]!, team: 0 }); show();
  expect(action('startMatch').disabled).toBe(true);
  model.mode = 'ffa'; show();
  expect(action('startMatch').disabled).toBe(false);
  expect(host.querySelector('.team-rosters')).toBeNull();
});

test('team scoreboards group K/D, escape text, and show actual results and objective status', () => {
  const info = { mode: 'flag' as const, selfTeam: 0 as const, teamScores: [2, 1] as [number, number], status: 'Flag: <carrier> · hold 12s · round 3 · match 04:12' };
  render(<BoardPanel model={{ rows, code: 'ABCDE', ...info }} />);
  expect(host.querySelector('[aria-label="RED team scores"]')?.textContent).toContain('4 kills · 8 deaths');
  expect(host.querySelector('[aria-label="BLUE team scores"]')?.textContent).toContain('12 kills · 2 deaths');
  expect(host.textContent).toContain('YOUR TEAM · RED');
  expect(host.textContent).toContain(info.status);
  expect(host.querySelector('img, carrier')).toBeNull();
  expect(host.textContent).not.toContain('first to 20');
  render(<Screen view={{ kind: 'over', model: { rows, ...info, youWin: true, winnerName: 'RED' } }} pad={false} onAction={() => {}} />);
  expect(host.querySelector('h1')?.textContent).toBe('YOU WIN');
  render(<Screen view={{ kind: 'over', model: { rows, ...info, youWin: false, winnerName: 'BLUE' } }} pad={false} onAction={() => {}} />);
  expect(host.querySelector('h1')?.textContent).toBe('BLUE WINS');
  expect(host.textContent).not.toContain('DRAW');
});

test('compact team HUD shows mode, both scores, self K/D and status; old solo models still work', () => {
  const status = 'Overtime · RED streak 2 · flag at blue base';
  render(<PvpPanel model={{ rows, selfId: 'red', mode: 'tdm', teamScores: [4, 12], selfTeam: 0, status }} />);
  expect(host.querySelector('.team-hud h2')?.textContent).toBe('Team Deathmatch');
  expect(host.querySelector('.team-scores')?.textContent).toBe('RED 4vsBLUE 12');
  expect(host.textContent).toContain('YOUR TEAM · RED');
  expect(host.textContent).toContain('YOU · 4 K · 8 D');
  expect(host.textContent).toContain(status);
  expect(host.querySelector('.score-rows')).toBeNull();
  render(<PvpPanel model={{ rows, selfId: 'red' }} />);
  expect(host.querySelector('.team-hud')).toBeNull();
  expect(host.textContent).toContain('first to 20');
  expect(host.textContent).toContain('(you)');
});

test('UI validates mode actions, forwards online models and compares team winner IDs', () => {
  const lobby = { mode: 'tdm' as OnlineMode, teams: { red: 0, blue: 1 } as Record<string, Team>, players: new Map([['red', 'Red'], ['blue', 'Blue']]), isPublic: true, status: '', hostId: 'red', code: 'ABCDE', map: 'downtown' };
  const showScreen = vi.fn();
  const selectMode = vi.fn((mode: OnlineMode) => { lobby.mode = mode; });
  const app = {
    lobby, screen: 'online', busy: false,
    gs: { state: 'lobby', mode: 'ffa', over: { id: 'team:0', name: 'RED' } },
    settings: { name: 'Red', sens: 100, acogSens: 120, sniperSens: 150, invert: false, music: false, optic: 'holo', r4cOptic: 'holo' },
    ctx: { net: { id: 'red', code: 'ABCDE', isHost: true }, hud: { showScreen, key: () => 'Enter' } },
    ffa: { selectMode, boardRows: () => rows, onlineInfo: () => ({ mode: lobby.mode, teamScores: [4, 12], selfTeam: 0, status: 'Round 1' }) },
  };
  const ui = createUI(app as unknown as App);
  for (const value of [null, '', 'invalid', 'FFA', '<script>']) ui.onUiAction('onlineMode', value, new Event('click'));
  expect(selectMode).not.toHaveBeenCalled();
  ui.onUiAction('onlineMode', 'flag', new Event('click'));
  expect(selectMode).toHaveBeenCalledExactlyOnceWith('flag');
  expect(showScreen).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'online', model: expect.objectContaining({ mode: 'flag' }) }));
  ui.showScreen('lobby');
  const view = showScreen.mock.lastCall![0] as Extract<ScreenView, { kind: 'lobby' }>;
  expect(view.model.players.map(player => player.team)).toEqual([0, 1]);
  for (const kind of ['menu', 'matchOn', 'over'] as const) {
    ui.showScreen(kind);
    expect(showScreen).toHaveBeenLastCalledWith(expect.objectContaining({ kind, model: expect.objectContaining({ mode: 'flag', selfTeam: 0, status: 'Round 1' }) }));
  }
  expect(showScreen.mock.lastCall![0].model.youWin).toBe(true);
  app.gs.over.id = 'team:1'; ui.showScreen('over');
  expect(showScreen.mock.lastCall![0].model.youWin).toBe(false);
  lobby.mode = 'ffa'; app.gs.over.id = 'red'; ui.showScreen('over');
  expect(showScreen.mock.lastCall![0].model.youWin).toBe(true);
});

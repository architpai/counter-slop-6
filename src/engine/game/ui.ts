import { clamp, store, SKEY } from '../util';
import { LEVELS, validKey } from '../level/index';
import { isOnlineMode } from './team-rules';
import type { ScreenView, UiAction } from '../hud/screens';
import type { App } from '../boot';

/** One name per member of `ScreenView`, so the two can never drift apart. */
export type ScreenName = ScreenView['kind'];

export interface UiApi {
  showScreen(kind: ScreenName): void;
  redraw(): void;
  screenClick(): void;
  onUiAction(act: UiAction, value: string | null, ev: Event): void;
  readonly screen: ScreenName | null;
}

export function createUI(app: App): UiApi {
  const { ctx, gs, lobby, settings } = app;
  const { hud, net } = ctx;
  let joinCode = '';
  const look = () => ({ sens: settings.sens, acogSens: settings.acogSens, sniperSens: settings.sniperSens,
    invert: settings.invert, music: settings.music, confirmKey: hud.key('confirm') });
  const weapons = () => ({ optic: settings.optic, r4cOptic: settings.r4cOptic });
  function setOptic(field: 'optic' | 'r4cOptic', value: string | null): void {
    if (value !== 'acog' && value !== 'holo') return;
    settings[field] = value; app.applyOptic(); redraw();
  }
  function sensitivity(field: 'sens' | 'acogSens' | 'sniperSens', value: string | null, fallback: number): void {
    const number = Number(value);
    settings[field] = clamp(Math.round((Number.isFinite(number) ? number : fallback) / 5) * 5, 25, 250);
    app.applyLook();
  }

  const models = {
    main: () => ({ best: settings.best, mapKey: settings.mapKey, maps: LEVELS, ...look(), ...weapons() }),
    online: () => ({ name: settings.name, mode: lobby.mode, isPublic: lobby.isPublic, status: lobby.status, busy: app.busy, code: joinCode }),
    lobby: () => ({
      code: net.code ?? lobby.code ?? '', mode: lobby.mode, isPublic: lobby.isPublic, isHost: net.isHost, mapKey: lobby.map ?? settings.mapKey, maps: LEVELS, ...weapons(),
      players: [...lobby.players].map(([id, name]) => ({ id, name, team: lobby.teams[id], host: id === lobby.hostId, self: id === net.id })), status: lobby.status,
    }),
    pause: () => ({ wave: gs.wave, score: gs.score, training: gs.mode === 'training', ...look(), ...weapons() }),
    menu: () => ({ code: net.code ?? lobby.code ?? '', rows: app.ffa.boardRows(), ...app.ffa.onlineInfo(), ...look(), ...weapons() }),
    matchOn: () => ({ confirmKey: hud.key('confirm'), ...app.ffa.onlineInfo() }),
    dead: () => {
      const newBest = gs.score > settings.best;
      if (newBest) { settings.best = gs.score; store.set(SKEY.BEST, gs.score); }
      return { waves: gs.wave, kills: gs.kills, score: gs.score, best: settings.best, newBest, confirmKey: hud.key('confirm') };
    },
    over: () => ({
      youWin: gs.over?.id === (lobby.mode === 'tdm' || lobby.mode === 'flag' ? `team:${lobby.teams[net.id ?? '']}` : net.id),
      winnerName: gs.over?.name ?? '', rows: app.ffa.boardRows(), ...app.ffa.onlineInfo(),
    }),
  };

  function showScreen(kind: ScreenName): void {
    app.screen = kind;
    switch (kind) {
      case 'main': hud.showScreen({ kind, model: models.main() }); break;
      case 'online': hud.showScreen({ kind, model: models.online() }); break;
      case 'lobby': hud.showScreen({ kind, model: models.lobby() }); break;
      case 'pause': hud.showScreen({ kind, model: models.pause() }); break;
      case 'menu': hud.showScreen({ kind, model: models.menu() }); break;
      case 'matchOn': hud.showScreen({ kind, model: models.matchOn() }); break;
      case 'dead': hud.showScreen({ kind, model: models.dead() }); break;
      case 'over': hud.showScreen({ kind, model: models.over() }); break;
    }
  }
  const redraw = (): void => { if (app.screen) showScreen(app.screen); };

  function screenClick(): void {
    if (gs.state === 'start') { if (app.screen === 'main') app.beginSolo(); }
    else if (gs.state === 'play' && gs.menu) app.resume();
    else if (gs.state === 'pause' || gs.state === 'dead') app.resume();
  }

  const actions: Record<UiAction, (value: string | null, ev: Event) => void> = {
    start: () => app.beginSolo(),
    training: () => app.beginTraining(),
    online: () => { lobby.status = ''; showScreen('online'); },
    back: () => { lobby.status = ''; showScreen('main'); },
    quickPlay: () => app.ffa.quickPlay(),
    create: () => app.ffa.create(lobby.isPublic),
    join: () => app.ffa.join(joinCode),
    joinCode: (value, ev) => { joinCode = String(value ?? '').toUpperCase().slice(0, 5); if (ev?.type === 'keydown') app.ffa.join(joinCode); },
    visibility: value => { lobby.isPublic = value !== 'private'; },
    name: value => {
      const name = String(value ?? '').trim().slice(0, 14);
      if (name) { settings.name = name; store.set(SKEY.NAME, name); const player = ctx.player; if (player !== null) player.name = name; }
    },
    pickMap: value => {
      const key = validKey(value);
      if (gs.state === 'lobby') { if (net.isHost) { lobby.map = key; app.ffa.broadcastLobby(); } return; }
      settings.mapKey = key; store.set(SKEY.MAP, key); redraw();
    },
    onlineMode: value => { if (isOnlineMode(value)) { app.ffa.selectMode(value); redraw(); } },
    mainMenu: () => app.mainMenu(),
    startMatch: () => {
      if (net.isHost) app.ffa.hostStart();
      else { net.send('startreq', {}); lobby.status = 'asking the host to start…'; redraw(); }
    },
    leave: () => app.ffa.leave(''),
    leaveMatch: () => app.ffa.leave(''),
    sens: value => sensitivity('sens', value, 100),
    acogSens: value => sensitivity('acogSens', value, 120),
    sniperSens: value => sensitivity('sniperSens', value, 150),
    optic: value => setOptic('optic', value),
    r4cOptic: value => setOptic('r4cOptic', value),
    invert: value => { settings.invert = value === '1'; app.applyLook(); },
    music: value => { app.setMusic(value === '1'); },
  };
  function onUiAction(act: UiAction, value: string | null, ev: Event): void { actions[act]?.(value, ev); }

  return { showScreen, redraw, screenClick, onUiAction, get screen() { return app.screen; } };
}

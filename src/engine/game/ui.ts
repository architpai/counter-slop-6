import { clamp, store, SKEY } from '../util';
import { Screens } from '../hud/index';
import { LEVELS, validKey } from '../level/index';
import type { UiAction } from '../hud/index';
import type { App } from '../boot';

export type ScreenName = 'main' | 'online' | 'lobby' | 'pause' | 'menu' | 'matchOn' | 'dead' | 'over';

export interface UiApi {
  showScreen(kind: ScreenName): void;
  redraw(): void;
  screenClick(): void;
  onUiAction(act: UiAction, value: string | null, ev: Event): void;
  readonly screen: ScreenName | null;
}

export function createUI(app: App): UiApi {
  const { ctx, gs, lobby, scores, settings } = app;
  const { hud, net } = ctx;
  let joinCode = '';
  const look = (): { sens: number; invert: boolean; music: boolean; confirmKey: string } => ({ sens: settings.sens, invert: settings.invert, music: settings.music, confirmKey: hud.key('confirm') });

  const models = {
    main: () => ({ best: settings.best, checkpoint: settings.checkpoint, mapKey: settings.mapKey, maps: LEVELS, ...look() }),
    online: () => ({ name: settings.name, isPublic: lobby.isPublic, status: lobby.status, busy: app.busy, code: joinCode }),
    lobby: () => ({
      code: net.code ?? lobby.code ?? '', isPublic: lobby.isPublic, isHost: net.isHost, mapKey: lobby.map ?? settings.mapKey, maps: LEVELS,
      players: [...lobby.players].map(([id, name]) => ({ id, name, host: id === lobby.hostId, self: id === net.id })), status: lobby.status,
    }),
    pause: () => ({ wave: gs.wave, score: gs.score, ...look() }),
    menu: () => ({ code: net.code ?? lobby.code ?? '', rows: app.ffa.boardRows(), ...look() }),
    matchOn: () => ({ confirmKey: hud.key('confirm') }),
    dead: () => {
      const newBest = gs.score > settings.best;
      if (newBest) { settings.best = gs.score; store.set(SKEY.BEST, gs.score); }
      return { waves: gs.wave, kills: gs.kills, score: gs.score, best: settings.best, newBest, checkpoint: settings.checkpoint, confirmKey: hud.key('confirm') };
    },
    over: () => ({ youWin: gs.over?.id === net.id, winnerName: gs.over?.name ?? '', rows: app.ffa.boardRows() }),
  };

  function showScreen(kind: ScreenName): void {
    app.screen = kind;
    switch (kind) {
      case 'main': hud.showScreen(Screens.main(models.main())); break;
      case 'online': hud.showScreen(Screens.online(models.online())); break;
      case 'lobby': hud.showScreen(Screens.lobby(models.lobby())); break;
      case 'pause': hud.showScreen(Screens.pause(models.pause())); break;
      case 'menu': hud.showScreen(Screens.menu(models.menu())); break;
      case 'matchOn': hud.showScreen(Screens.matchOn(models.matchOn())); break;
      case 'dead': hud.showScreen(Screens.dead(models.dead())); break;
      case 'over': hud.showScreen(Screens.over(models.over())); break;
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
    checkpoint: value => app.beginAtWave(Number(value)),
    mainMenu: () => app.mainMenu(),
    startMatch: () => {
      if (net.isHost) app.ffa.hostStart();
      else { net.send('startreq', {}); lobby.status = 'asking the host to start…'; redraw(); }
    },
    leave: () => app.ffa.leave(''),
    leaveMatch: () => app.ffa.leave(''),
    sens: value => { settings.sens = clamp(Math.round(Number(value) / 5) * 5 || 100, 25, 250); app.applyLook(); },
    invert: value => { settings.invert = value === '1'; app.applyLook(); },
    music: value => { app.setMusic(value === '1'); },
  };
  function onUiAction(act: UiAction, value: string | null, ev: Event): void { actions[act]?.(value, ev); }

  return { showScreen, redraw, screenClick, onUiAction, get screen() { return app.screen; } };
}

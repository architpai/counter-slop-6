/**
 * Screen models: the data half of the menus. The rendering half is React, in
 * `src/components/hud/Screens.tsx`; nothing here may import it, because the
 * engine must stay free of React.
 */

/**
 * Every `data-act` value these screens emit. A cross-module contract: `game/ui`
 * keys its handler table off exactly this set, so a typo here is a dead button.
 */
export const UI_ACTIONS = [
  'start', 'online', 'back', 'quickPlay', 'create', 'join', 'joinCode',
  'visibility', 'name', 'pickMap', 'checkpoint', 'mainMenu', 'startMatch',
  'leave', 'leaveMatch', 'sens', 'invert', 'music',
] as const;

export type UiAction = (typeof UI_ACTIONS)[number];

// ------------------------------------------------------------- screen models

export interface MapChoice { key: string; name: string; blurb: string }
export interface LobbyPlayer { id: string; name: string; host: boolean; self: boolean }

export interface MainModel {
  best: number; checkpoint: number; mapKey: string;
  maps: MapChoice[];
  sens: number; invert: boolean; music: boolean;
  confirmKey: string;
}
export interface LobbyModel {
  code: string; isPublic: boolean; isHost: boolean; mapKey: string;
  maps: MapChoice[];
  players: LobbyPlayer[];
  status: string;
}
export interface OnlineModel { name: string; isPublic: boolean; status: string; busy: boolean;
                               code: string }
export interface PauseModel  { wave: number; score: number; sens: number; invert: boolean;
                               music: boolean; confirmKey: string }
export interface MenuModel   { code: string; rows: BoardRow[]; sens: number; invert: boolean;
                               music: boolean; confirmKey: string }
export interface DeadModel   { waves: number; kills: number; score: number; best: number;
                               newBest: boolean; checkpoint: number; confirmKey: string }
export interface OverModel   { youWin: boolean; winnerName: string; rows: BoardRow[] }
export interface BoardModel  { rows: BoardRow[]; code: string }
/** Top 3 + self if ranked 4th or lower. */
export interface PvpModel    { rows: BoardRow[]; selfId: string }
export interface BoardRow    { id: string; name: string; kills: number; deaths: number; self: boolean }

export interface MatchOnModel { confirmKey: string }

/**
 * What `hud.showScreen` carries: which screen, and the data it draws itself
 * from. The engine never builds markup; React picks the component off `kind`.
 */
export type ScreenView =
  | { kind: 'main'; model: MainModel }
  | { kind: 'online'; model: OnlineModel }
  | { kind: 'lobby'; model: LobbyModel }
  | { kind: 'pause'; model: PauseModel }
  | { kind: 'menu'; model: MenuModel }
  | { kind: 'matchOn'; model: MatchOnModel }
  | { kind: 'dead'; model: DeadModel }
  | { kind: 'over'; model: OverModel };

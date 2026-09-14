import type { RifleOptic } from '../weapons/stats';
import type { OnlineMode, Team } from '../game/team-rules';

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
  'visibility', 'name', 'pickMap', 'onlineMode', 'mainMenu', 'startMatch',
  'leave', 'leaveMatch', 'sens', 'acogSens', 'sniperSens', 'optic', 'r4cOptic', 'training', 'invert', 'music',
] as const;

export type UiAction = (typeof UI_ACTIONS)[number];

// ------------------------------------------------------------- screen models

export interface MapChoice { key: string; name: string; blurb: string }
export interface LobbyPlayer { id: string; name: string; host: boolean; self: boolean; team?: Team }
export interface OnlineInfo {
  mode?: OnlineMode;
  teamScores?: [number, number];
  selfTeam?: Team;
  status?: string;
}

export interface WeaponSettingsModel { optic: RifleOptic; r4cOptic: RifleOptic }
export interface LookModel {
  sens: number; acogSens: number; sniperSens: number;
  invert: boolean; music: boolean; confirmKey: string;
}
export interface MainModel extends LookModel, WeaponSettingsModel {
  best: number; mapKey: string;
  maps: MapChoice[];
}
export interface LobbyModel extends WeaponSettingsModel {
  mode?: OnlineMode;
  code: string; isPublic: boolean; isHost: boolean; mapKey: string;
  maps: MapChoice[];
  players: LobbyPlayer[];
  status: string;
}
export interface OnlineModel { name: string; isPublic: boolean; status: string; busy: boolean;
                               code: string; mode?: OnlineMode }
export interface PauseModel extends LookModel, WeaponSettingsModel { wave: number; score: number; training: boolean }
export interface MenuModel extends LookModel, WeaponSettingsModel, OnlineInfo { code: string; rows: BoardRow[] }
export interface DeadModel   { waves: number; kills: number; score: number; best: number;
                               newBest: boolean; confirmKey: string }
export interface OverModel extends OnlineInfo { youWin: boolean; winnerName: string; rows: BoardRow[] }
export interface BoardModel extends OnlineInfo { rows: BoardRow[]; code: string }
/** Solo: top 3 + self. Teams: team scores, objective status and self K/D. */
export interface PvpModel extends OnlineInfo { rows: BoardRow[]; selfId: string }
export interface BoardRow { id: string; name: string; kills: number; deaths: number; self: boolean; team?: Team }

export interface MatchOnModel extends OnlineInfo { confirmKey: string }

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

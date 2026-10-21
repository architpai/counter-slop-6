import { clamp, store, SKEY } from '../util';
import { LEVELS, validKey } from '../level/index';
import { isOnlineMode } from './team-rules';
import { GUN_STATS, LOADOUT_SIZE, SWORD_HANDLING, WEAPON_KINDS, isWeaponKind } from '../weapons/stats';
import type { WeaponKind } from '../weapons/stats';
import { AMBIENT_OCCLUSION, ANTIALIAS, EFFECTS, FPS_TARGETS, SHADOWS, TEXTURE_QUALITIES, VIEW_DISTANCES, isPreset } from '../render/quality';
import type { FpsTarget, PresetChoice } from '../render/quality';
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

/** What the loadout picker shows of each weapon. */
const ROLES: Record<WeaponKind, string> = {
  r4c: 'Assault rifle · high damage · slow to aim',
  rifle: 'SMG · fast · accurate on the move',
  shotgun: 'Pump shotgun · devastating up close',
  sniper: 'Bolt-action sniper · one shot, one kill',
  pistol: 'Heavy .50 · harder hits in the air and off the draw',
  lmg: 'Belt-fed LMG · 100 rounds · heavy',
  sword: 'Guard and parry · cuts bullets · air slash',
};
const LOADOUT_CHOICES = WEAPON_KINDS.map(kind => ({
  kind, role: ROLES[kind],
  name: kind === 'sword' ? 'SWORD' : GUN_STATS[kind].name,
  speed: Math.round(100 * (kind === 'sword' ? SWORD_HANDLING.moveSpeed : GUN_STATS[kind].moveSpeed)),
}));

export function createUI(app: App): UiApi {
  const { ctx, gs, lobby, settings, quality } = app;
  const { hud, net } = ctx;
  let joinCode = '', newBest = false;
  const gfx = () => ({ choice: quality.choice, auto: quality.autoPreset, values: { ...quality.values }, fpsCounter: quality.fpsCounter,
    msaaSoft: ctx.renderer?.msaaDepthReadable ?? true });
  const look = () => ({ sens: settings.sens, touchSens: settings.touchSens, touch: ctx.input.usingTouch, acogSens: settings.acogSens, sniperSens: settings.sniperSens,
    invert: settings.invert, music: settings.music, gore: settings.gore, confirmKey: hud.key('confirm'), gfx: gfx() });
  /** A pick under way: `LOADOUT_SIZE` slots, some of them empty. Saved (`pickLoadout`) once full. */
  let draft: (WeaponKind | null)[] | null = null;
  const weapons = () => ({ optic: settings.optic, r4cOptic: settings.r4cOptic, choices: LOADOUT_CHOICES,
    loadout: [...(draft ?? settings.loadout)], loadoutNote: loadoutNote() });
  function loadoutNote(): string {
    if (draft) return `Pick ${draft.filter(kind => kind === null).length} more.`;
    const pending = !!ctx.player && ctx.player.loadout.join() !== settings.loadout.join();
    if (!['play', 'dying', 'pause'].includes(gs.state)) return 'Saved on this device. You carry these from the start of the next run or match.';
    if (gs.mode === 'training') return 'Training: changes apply at once.';
    if (gs.mode === 'solo' || app.coop.active()) {
      if (app.loadoutOpen()) return 'Between waves: changes apply now.';
      return pending ? 'Applies when this wave is cleared.' : 'You can change weapons between waves.';
    }
    return pending ? 'Locked for this match. Applies from the next match.' : 'Locked for this match.';
  }
  /** A tap: a picked weapon leaves its slot empty, an unpicked one fills the first empty slot. */
  function toggleLoadout(value: string | null): void {
    if (!isWeaponKind(value)) return;
    const next = [...(draft ?? settings.loadout)], at = next.indexOf(value), free = next.indexOf(null);
    if (at >= 0) next[at] = null;
    else if (free >= 0) next[free] = value;
    else return;
    setSlots(next);
  }
  /** A drag: the whole slot list, as `WeaponSettingsModel.loadout` describes. Anything malformed is ignored. */
  function setLoadout(value: string | null): void {
    const next = String(value ?? '').split(',').map(kind => kind === '' ? null : kind);
    const kinds = next.filter(kind => kind !== null);
    if (next.length !== LOADOUT_SIZE || !kinds.every(isWeaponKind) || new Set(kinds).size !== kinds.length) return;
    setSlots(next as (WeaponKind | null)[]);
  }
  function setSlots(next: (WeaponKind | null)[]): void {
    const full = next.every(kind => kind !== null);
    if (full && app.pickLoadout(next)) draft = null;
    else draft = next;
    redraw();
  }
  function setOptic(field: 'optic' | 'r4cOptic', value: string | null): void {
    if (value !== 'acog' && value !== 'holo') return;
    settings[field] = value; app.applyOptic(); redraw();
  }
  function sensitivity(field: 'sens' | 'touchSens' | 'acogSens' | 'sniperSens', value: string | null, fallback: number): void {
    const number = Number(value);
    settings[field] = clamp(Math.round((Number.isFinite(number) ? number : fallback) / 5) * 5, 25, 250);
    app.applyLook();
  }

  /** One Advanced control: `key:value`. Unknown keys and values are ignored, never saved. */
  function setGfx(value: string | null): void {
    const [key = '', raw = ''] = String(value ?? '').split(':');
    const listed = <T,>(list: readonly T[], item: unknown): item is T => list.includes(item as T);
    const number = raw === '' ? Number.NaN : Number(raw);
    if (key === 'renderScale' && Number.isFinite(number)) quality.set('renderScale', number / 100);
    else if (key === 'dynamicRes') quality.set('dynamicRes', raw === '1');
    else if (key === 'fpsTarget' && listed<FpsTarget>(FPS_TARGETS, number)) quality.set('fpsTarget', number);
    else if (key === 'antialias' && listed(ANTIALIAS, raw)) quality.set('antialias', raw);
    else if (key === 'shadows' && listed(SHADOWS, raw)) quality.set('shadows', raw);
    else if (key === 'ao' && listed(AMBIENT_OCCLUSION, raw)) quality.set('ao', raw);
    else if (key === 'bloom') quality.set('bloom', raw === '1');
    else if (key === 'softParticles') quality.set('softParticles', raw === '1');
    else if (key === 'shafts') quality.set('shafts', raw === '1');
    else if (key === 'textures' && listed(TEXTURE_QUALITIES, raw)) quality.set('textures', raw);
    else if (key === 'effects' && listed(EFFECTS, raw)) quality.set('effects', raw);
    else if (key === 'viewDistance' && listed(VIEW_DISTANCES, raw)) quality.set('viewDistance', raw);
  }
  const isChoice = (value: unknown): value is PresetChoice => value === 'auto' || value === 'custom' || isPreset(value);

  const models = {
    main: () => ({ best: settings.best, checkpoint: settings.checkpoint, startWave: settings.startWave, mapKey: settings.mapKey, maps: LEVELS, ...look(), ...weapons() }),
    online: () => ({ name: settings.name, mode: lobby.mode, isPublic: lobby.isPublic, status: lobby.status, busy: app.busy, code: joinCode }),
    lobby: () => ({
      code: net.code ?? lobby.code ?? '', mode: lobby.mode, isPublic: lobby.isPublic, isHost: net.isHost, mapKey: lobby.map ?? settings.mapKey, maps: LEVELS, ...weapons(),
      players: [...lobby.players].map(([id, name]) => ({ id, name, team: lobby.teams[id], host: id === lobby.hostId, self: id === net.id })), status: lobby.status,
      checkpoint: settings.checkpoint, startWave: settings.startWave,
    }),
    pause: () => ({ wave: gs.wave, score: gs.score, training: gs.mode === 'training', ...look(), ...weapons() }),
    menu: () => ({ code: net.code ?? lobby.code ?? '', rows: app.ffa.boardRows(), ...app.ffa.onlineInfo(), ...look(), ...weapons() }),
    matchOn: () => ({ confirmKey: hud.key('confirm'), ...app.ffa.onlineInfo() }),
    dead: () => {
      if (gs.score > settings.best) { settings.best = gs.score; store.set(SKEY.BEST, gs.score); newBest = true; }
      return { waves: gs.wave, kills: gs.kills, score: gs.score, best: settings.best, newBest, checkpoint: settings.checkpoint, startWave: settings.startWave, confirmKey: hud.key('confirm') };
    },
    over: () => ({
      youWin: gs.over?.id === (lobby.mode === 'tdm' || lobby.mode === 'flag' ? `team:${lobby.teams[net.id ?? '']}` : net.id),
      winnerName: gs.over?.name ?? '', rows: app.ffa.boardRows(), ...app.ffa.onlineInfo(),
    }),
  };

  function showScreen(kind: ScreenName): void {
    ctx.input.clearTouch(); ctx.input.touch.enabled = false;
    // The death screen can redraw (start-wave select); "NEW BEST" must outlive the save in `models.dead`.
    if (kind === 'dead' && app.screen !== 'dead') newBest = false;
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
    else if ((gs.state === 'play' || gs.state === 'dying') && gs.menu) app.resume();
    else if (gs.state === 'pause' || gs.state === 'dead') app.resume();
  }

  const actions: Record<UiAction, (value: string | null, ev: Event) => void> = {
    start: () => app.beginSolo(),
    startWave: value => { app.setStartWave(Number(value)); redraw(); },
    resume: () => app.resume(),
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
    team: value => { if (value === '0' || value === '1') app.ffa.requestTeam(value === '0' ? 0 : 1); },
    mainMenu: () => app.mainMenu(),
    startMatch: () => { if (net.isHost) app.ffa.hostStart(); },
    leave: () => app.ffa.leave(''),
    leaveMatch: () => app.ffa.leave(''),
    sens: value => sensitivity('sens', value, 100),
    touchSens: value => sensitivity('touchSens', value, 100),
    acogSens: value => sensitivity('acogSens', value, 120),
    sniperSens: value => sensitivity('sniperSens', value, 150),
    optic: value => setOptic('optic', value),
    r4cOptic: value => setOptic('r4cOptic', value),
    loadout: value => toggleLoadout(value),
    loadoutSet: value => setLoadout(value),
    invert: value => { settings.invert = value === '1'; app.applyLook(); },
    music: value => { app.setMusic(value === '1'); },
    gore: value => { if (value === 'off' || value === 'reduced' || value === 'full') { app.setGore(value); redraw(); } },
    // Quality changes redraw through the subscription in `boot`, like every other listener.
    gfxPreset: value => { if (isChoice(value)) quality.setPreset(value); },
    gfx: value => setGfx(value),
    gfxFps: value => quality.setFpsCounter(value === '1'),
    gfxReset: () => quality.reset(),
    gfxLower: value => app.answerQualityPrompt(value === 'yes'),
  };
  function onUiAction(act: UiAction, value: string | null, ev: Event): void { actions[act]?.(value, ev); }

  return { showScreen, redraw, screenClick, onUiAction, get screen() { return app.screen; } };
}

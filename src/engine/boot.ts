import { clamp, randInt, store, SKEY } from './util';
import { Renderer } from './render/index';
import { World } from './physics';
import { NavGrid } from './nav';
import { Audio } from './audio';
import { Net } from './net';
import { Input } from './input';
import { Effects } from './effects';
import { buildLevel, disposeLevel, validKey } from './level/index';
import { EnemyManager } from './enemies/index';
import { Player } from './player/index';
import { makeGameState } from './game/state';
import { createSolo } from './game/solo';
import { createTraining } from './game/training';
import { Gun } from './weapons/gun';
import type { RifleOptic } from './weapons/stats';
import { createFFA } from './game/ffa';
import { createUI } from './game/ui';
import { createPickups } from './game/pickups';
import { createBreakables } from './game/breakables';
import type { Ctx, GameHooks, GameState, Level, LevelKey, Lobby, Pickup, RemotePlayer, ScoreRow } from './types';
import type { SoloApi } from './game/solo';
import type { TrainingApi } from './game/training';
import type { FfaApi } from './game/ffa';
import type { UiApi, ScreenName } from './game/ui';
import type { PickupsApi } from './game/pickups';
import type { BreakablesApi } from './game/breakables';
import type { HudView } from './hud/view';

export { loadTacticalModels } from './render/tactical';

export interface Settings {
  mapKey: LevelKey;
  best: number;
  music: boolean;
  checkpoint: number;
  name: string;
  sens: number;
  acogSens: number;
  sniperSens: number;
  optic: RifleOptic;
  invert: boolean;
}

/**
 * Everything the game modules share. Built incrementally during `boot`: the
 * factories below need `app` before it is complete, so the initial literal is
 * asserted once and every later assignment is checked.
 */
export interface App {
  ctx: Ctx;
  gs: GameState;
  lobby: Lobby;
  scores: Map<string, ScoreRow>;
  settings: Settings;
  busy: boolean;
  screen: ScreenName | null;
  loadLevel(arena: boolean, key?: unknown, force?: boolean): void;
  applyLook(): void;
  applyOptic(): void;
  pickups: PickupsApi;
  breakables: BreakablesApi;
  addScore(points: number, label?: string | null): void;
  saveCheckpoint(n: number): void;
  solo: SoloApi;
  training: TrainingApi;
  endFocus(): void;
  ffa: FfaApi;
  ui: UiApi;
  showScreen(kind: ScreenName): void;
  setMusic(on: boolean): void;
  resetRun(): void;
  beginCommon(): void;
  beginSolo(): void;
  beginTraining(): void;
  beginAtWave(n: number): void;
  pause(): void;
  resume(): void;
  mainMenu(): void;
  jumpToWave(n: number): void;
}

export interface GameHandle {
  ctx: Ctx;
  gs: GameState;
  player: Player;
  enemies: EnemyManager;
  net: Net;
  remotes: Map<string, RemotePlayer>;
  lobby: Lobby;
  scores: Map<string, ScoreRow>;
  pickups: Pickup[];
  level: Level;
  nav: NavGrid;
  hud: HudView;
  effects: Effects;
  input: Input;
  world: World;
  beginSolo(): void;
  beginTraining(): void;
  beginAtWave(n: number): void;
  jumpToWave(n: number): void;
  step(nowMs: number): void;
  dispose(): void;
  /** Live engine instances. Must be 1; higher means a leaked mount. */
  readonly live: number;
}

// Live instance count. A StrictMode remount or an HMR reload must leave this at
// 1: anything higher means a leaked WebGL context, audio graph and rAF chain.
let live = 0;
export const liveInstances = (): number => live;

/**
 * Boot one game instance against a canvas and an externally owned HUD view.
 *
 * Every browser resource this creates is released by `handle.dispose()`, so a
 * React StrictMode double-mount produces one live instance, not two.
 */
export function boot(canvas: HTMLCanvasElement, hud: HudView): GameHandle {
  live++;
  let lastStep = performance.now();
  let disposed = false;
  let rafId = 0;
  let keepAlive = 0;
  const teardown: Array<() => void> = [];
  // Declared up here because loadLevel() refreshes it, and loadLevel runs during
  // boot step 3 — well before the handle object is built at step 11.
  let handle: GameHandle | null = null;

  // ---- boot 1-8
  const renderer = new Renderer(canvas);
  const { scene, camera } = renderer;
  const world = new World();
  const audio = new Audio();
  const net = new Net();

  const settings: Settings = {
    mapKey: validKey(store.getStr(SKEY.MAP, 'downtown')),
    best: store.getNum(SKEY.BEST, 0),
    music: store.getStr(SKEY.MUSIC, '1') !== '0',
    checkpoint: store.getNum(SKEY.CHECKPOINT, 0),
    name: store.getStr(SKEY.NAME, '').trim().slice(0, 14) || `recruit${randInt(10, 99)}`,
    sens: clamp(store.getNum(SKEY.SENS, 100), 25, 250),
    acogSens: clamp(store.getNum(SKEY.ACOG_SENS, 120), 25, 250),
    sniperSens: clamp(store.getNum(SKEY.SNIPER_SENS, 150), 25, 250),
    optic: store.getStr(SKEY.OPTIC, 'acog') === 'holo' ? 'holo' : 'acog',
    invert: store.getBool(SKEY.INVERT, false),
  };

  let loadedKey: LevelKey | null = null, loadedArena = false;

  /**
   * Build a level and its nav grid without touching `ctx`.
   *
   * This exists so `ctx` can be built once, complete, at step 9 of the boot
   * sequence in ARCHITECTURE.md section 8. The vanilla code created `ctx` first
   * purely so `loadLevel` had somewhere to write, which left six fields holding
   * null behind non-nullable types.
   */
  function makeLevel(arena: boolean, resolved: LevelKey): { level: Level; nav: NavGrid } {
    const level = buildLevel(scene, world, resolved, { arena });
    renderer.setLevelShadow(level.shadow.center, level.shadow.radius);
    renderer.setMood(level.mood);
    const nav = new NavGrid(world, level.bounds, 1);
    nav.build();
    audio.setTune(resolved);
    return { level, nav };
  }

  loadedKey = settings.mapKey;
  loadedArena = false;
  const first = makeLevel(false, settings.mapKey);

  const input = new Input(canvas);
  const effects = new Effects(scene, world);
  function applyLook(): void {
    input.mouseSens = 0.0022 * settings.sens / 100;
    input.padSensX = 3.4 * settings.sens / 100;
    input.padSensY = 2.6 * settings.sens / 100;
    input.acogScale = settings.acogSens / settings.sens;
    input.sniperScale = settings.sniperSens / settings.sens;
    input.invertY = settings.invert;
    store.set(SKEY.SENS, settings.sens); store.set(SKEY.INVERT, settings.invert);
    store.set(SKEY.ACOG_SENS, settings.acogSens); store.set(SKEY.SNIPER_SENS, settings.sniperSens);
  }
  applyLook();

  const gs = makeGameState();
  const lobby: Lobby = { players: new Map(), hostId: null, isPublic: true, status: '', code: null, map: null };
  const scores = new Map<string, ScoreRow>();

  // ---- hooks 9
  const game: GameHooks = {
    hitstop(d, s) { gs.hitstopT = Math.max(gs.hitstopT, d); gs.hitstopScale = s; },
    addScore(points, label = null) {
      const awarded = Math.round(points * (1 + 0.25 * Math.min(gs.combo, 9)));
      gs.score += awarded;
      if (label) hud.kill(label, awarded);
      hud.setScore(gs.score, gs.combo);
    },
    onPlayerDeath() {
      app.solo.endFocus();
      if (gs.mode === 'training') { player.reset(ctx.level.playerStart); return; }
      if (gs.mode === 'ffa') app.ffa.localDeath();
      else { gs.state = 'dying'; gs.deathT = 0; }
    },
    targets: () => app.ffa.targets(),
    canHurt: t => app.ffa.canHurt(t),
    raycastPlayers: (o, d, max) => app.ffa.raycastPlayers(o, d, max),
    playersInArc: (p, d, r, c) => app.ffa.playersInArc(p, d, r, c),
    hitPlayer: (t, dmg, info) => app.ffa.hitPlayer(t, dmg, info),
    cutRopes: (e, d, r) => app.ffa.cutRopes(e, d, r),
    onShot: end => app.ffa.onShot(end),
    breakHit: (prop, dmg, point, dir) => app.breakables.hit(prop, dmg, point, dir),
    breakablesInArc: (p, d, r, c) => app.breakables.inArc(p, d, r, c),
    blastBreakables: (c, r) => app.breakables.blast(c, r),
    get state() { return gs.state; },
    get mode() { return gs.mode; },
    isOnline: () => gs.mode === 'ffa',
    inMatch: () => net.active && ['play', 'dying', 'over'].includes(gs.state),
    playing: () => gs.state === 'play' || gs.state === 'dying',
  };

  // ---- ctx 9: every service exists, only the actors are still null
  const ctx: Ctx = {
    scene, camera, renderer, world,
    nav: first.nav, level: first.level,
    input, hud, effects, audio, net,
    enemies: null, player: null, remotes: new Map(), game,
  };

  function loadLevel(arena: boolean, key: unknown = null, force = false): void {
    const resolved = gs.mode === 'training' ? 'training' : validKey(key ?? (net.active ? lobby.map ?? settings.mapKey : settings.mapKey));
    if (!force && resolved === loadedKey && arena === loadedArena) return;
    loadedKey = resolved; loadedArena = arena;
    disposeLevel(scene, ctx.level); world.clear();
    const rebuilt = makeLevel(arena, resolved);
    ctx.level = rebuilt.level; ctx.nav = rebuilt.nav;
    if (handle !== null) { handle.level = ctx.level; handle.nav = ctx.nav; }
  }

  // ---- actors 10
  const enemies = ctx.enemies = new EnemyManager(ctx);
  const player = ctx.player = new Player(ctx);
  player.name = settings.name;
  function applyOptic(): void {
    const rifle = player.weapons[0];
    if (rifle instanceof Gun) rifle.setOptic(settings.optic);
    hud.setWeapon(player.weapon.name, player.weapon.hint);
    store.set(SKEY.OPTIC, settings.optic);
  }
  applyOptic();

  // ---- run control
  const app = { ctx, gs, lobby, scores, settings, busy: false, screen: null, loadLevel, applyLook, applyOptic } as unknown as App;
  app.pickups = createPickups(ctx);
  app.breakables = createBreakables(ctx, app.pickups);
  app.addScore = game.addScore;
  app.saveCheckpoint = n => { settings.checkpoint = n; store.set(SKEY.CHECKPOINT, n); };
  app.solo = createSolo(app);
  app.training = createTraining(app);
  app.endFocus = app.solo.endFocus;
  app.ffa = createFFA(app);
  app.ui = createUI(app);
  app.showScreen = app.ui.showScreen;
  app.setMusic = on => {
    settings.music = on; store.set(SKEY.MUSIC, on); audio.music(on);
  };
  app.resetRun = () => {
    if (ctx.level.breakables.some(b => !b.alive)) loadLevel(loadedArena, loadedKey, true);
    enemies.clear(); effects.clear(); app.pickups.clear();
    const online = gs.mode === 'ffa';
    player.maxHp = online ? 110 : 120; player.regenDelay = online ? 4 : 4.5; player.regenRate = online ? 14 : 11;
    player.reset(ctx.level.playerStart); player.name = settings.name; player.lastHitBy = player.lastHit = null;
    enemies.mods.speed = enemies.mods.damage = 1; hud.setModifier(''); hud.setBoss(null); gs.boss = null;
    app.solo.endFocus(); gs.katanaStreak = 0;
    gs.score = gs.kills = gs.combo = gs.comboT = gs.wave = gs.intermission = gs.spawnT = 0; gs.queue.length = 0;
    gs.time = 0; gs.over = null; gs.matchT = gs.respawnT = gs.deathT = gs.overT = 0;
    hud.setScore(0, 0); hud.setTimer(''); hud.setPvpScore(null); hud.setWave(1, 0); app.ffa.showBoard(false);
  };
  app.beginCommon = () => {
    audio.init(); audio.resume();
    if (!input.usingGamepad) input.requestLock();
    if (settings.music && !audio.musicPlaying) audio.music(true);
    hud.hideScreen(); hud.setGameplayVisible(true); gs.menu = false;
  };
  app.beginSolo = () => {
    const reset = gs.mode !== 'solo' || gs.state === 'start' || gs.state === 'dead';
    gs.mode = 'solo'; loadLevel(false, settings.mapKey); app.beginCommon();
    if (reset) { app.resetRun(); app.solo.startWave(1); }
    gs.state = 'play';
  };
  app.beginTraining = () => {
    gs.mode = 'training'; loadLevel(false); app.resetRun(); app.training.reset();
    app.beginCommon(); gs.state = 'play';
  };
  app.beginAtWave = n => {
    if (!Number.isInteger(n) || n < 1) return;
    gs.mode = 'solo'; loadLevel(false, settings.mapKey); app.beginCommon(); app.resetRun(); app.solo.startWave(n); gs.state = 'play';
  };
  app.pause = () => {
    if (gs.state !== 'play' || gs.menu) return;
    if (gs.mode !== 'ffa') gs.state = 'pause';
    gs.menu = true; app.showScreen(gs.mode !== 'ffa' ? 'pause' : 'menu'); audio.reelLoop(false);
  };
  app.resume = () => {
    if (gs.mode === 'ffa') {
      gs.menu = false; hud.hideScreen(); hud.setGameplayVisible(true);
      if (!input.usingGamepad) input.requestLock();
    } else if (gs.mode === 'training') { app.beginCommon(); gs.state = 'play'; }
    else app.beginSolo();
  };
  app.mainMenu = () => {
    gs.state = 'start'; gs.mode = 'solo'; gs.menu = false;
    loadLevel(false, settings.mapKey); app.resetRun(); audio.reelLoop(false); input.exitLock();
    hud.setGameplayVisible(false); app.showScreen('main');
  };
  app.jumpToWave = n => {
    enemies.clear(); effects.clear(); enemies.mods.speed = enemies.mods.damage = 1; app.solo.endFocus();
    gs.intermission = 0; gs.queue.length = 0; app.solo.startWave(n);
    hud.hideScreen(); hud.setGameplayVisible(true); gs.state = 'play'; gs.menu = false; audio.reelLoop(false);
  };

  // ---- handle 11 (also the debug surface)
  handle = {
    ctx, gs, player, enemies, net, remotes: ctx.remotes, lobby, scores, pickups: app.pickups.items,
    level: ctx.level, nav: ctx.nav, hud, effects, input, world,
    beginSolo: app.beginSolo, beginTraining: app.beginTraining, beginAtWave: app.beginAtWave, jumpToWave: app.jumpToWave, step: t => step(t),
    dispose,
    get live() { return live; },
  };

  // ---- listeners 12-13
  const listen = (target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions): void => {
    target.addEventListener(type, fn, options);
    teardown.push(() => target.removeEventListener(type, fn, options));
  };
  enemies.onKill = app.solo.onKill;
  enemies.onBoss = e => { if (gs.mode !== 'training') app.solo.onBoss(e); };
  player.onThrow = d => { if (net.active) net.broadcast('nade', d); };
  hud.onScreenClick = app.ui.screenClick;
  hud.onUiAction = app.ui.onUiAction;
  listen(canvas, 'click', () => {
    if (gs.state === 'play' && !gs.menu && !input.locked && !input.usingGamepad) input.requestLock();
  });
  input.onLockChange = locked => {
    if (!locked && gs.state === 'play' && !gs.menu && !input.usingGamepad) app.pause();
  };
  input.onDeviceChange = device => {
    hud.setDevice(device === 'gamepad'); hud.setWeapon(player.weapon.name, player.weapon.hint);
    if (app.screen && gs.state !== 'play') app.ui.redraw();
  };
  listen(window, 'pagehide', () => { if (net.active) net.leave(); });
  let woken = false;
  const wake = (): void => { if (woken) return; woken = true; audio.init(); audio.resume(); };
  listen(window, 'pointerdown', wake);
  listen(window, 'keydown', wake);

  // ---- 14
  hud.setDevice(input.usingGamepad);
  hud.setWeapon(player.weapon.name, player.weapon.hint);
  hud.setGameplayVisible(false);
  app.showScreen('main');

  // ---- frame loop
  let lockTipT = 0.5, healT = 2, boardLatch = false;
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };

  function step(nowMs: number): void {
    const dt = Math.min(0.05, (nowMs - lastStep) / 1000);
    lastStep = nowMs;
    input.update(dt);

    const { state } = gs;
    const confirm = input.pressed('jump') || input.pressed('confirm');
    if (state === 'start' || state === 'pause' || state === 'dead') {
      if (confirm || (state === 'pause' && input.pressed('pause'))) app.ui.screenClick();
    } else if (state === 'play') {
      if (input.pressed('pause')) { if (gs.menu) app.resume(); else { app.pause(); input.exitLock(); } }
      else if (gs.menu && confirm) app.resume();
    }
    if (input.pressed('music')) { app.setMusic(!settings.music); hud.tip(settings.music ? 'music on' : 'music off', 1.5); }

    if (game.isOnline() && game.playing()) {
      if (input.usingGamepad) { if (input.pressed('score')) boardLatch = !boardLatch; }
      else boardLatch = input.down('score');
      app.ffa.showBoard(boardLatch && !gs.menu);
    } else boardLatch = false;

    if (gs.state === 'play' && !gs.menu && !input.locked && !input.usingGamepad) {
      lockTipT -= dt;
      if (lockTipT <= 0) { lockTipT = 2.5; hud.tip('click to grab the mouse', 2); }
    }

    let scale = 1;
    if (gs.hitstopT > 0) { gs.hitstopT -= dt; scale = gs.hitstopScale; }
    else if (gs.focus.active) scale = 0.26;
    const sdt = dt * scale;

    if (gs.state === 'play' && gs.mode !== 'ffa') app.solo.updateFocus(dt);
    else app.solo.endFocus();

    if (game.playing()) {
      gs.time += sdt;
      if (player.shieldT > 0) player.shieldT -= dt;
      healT -= dt;
      if (healT <= 0) {
        healT = 2;
        if (settings.music && gs.state === 'play' && !audio.musicPlaying && audio.ctx) audio.music(true);
        if (input.anyInput) audio.resume();
      }
      const b = ctx.level.bounds, pos = player.body.pos;
      if (pos.x < b.minX - 8 || pos.x > b.maxX + 8 || pos.z < b.minZ - 8 || pos.z > b.maxZ + 8 || pos.y > 150) pos.y = -100;
      player.update(sdt);
      enemies.update(sdt);
      effects.update(sdt);
      app.pickups.update(sdt);
      app.ffa.update(dt, nowMs / 1000);
      if (gs.state === 'play' && gs.mode === 'solo') app.solo.update(sdt);
      if (gs.state === 'play' && gs.mode === 'training') app.training.update(sdt);
      if (game.isOnline()) app.pickups.arenaUpdate(dt);
      if (gs.comboT > 0) { gs.comboT -= sdt; if (gs.comboT <= 0) { gs.combo = 0; hud.setScore(gs.score, 0); } }
      if (gs.state === 'dying') {
        gs.deathT += dt;
        if (gs.mode === 'ffa') app.ffa.updateDying(dt);
        else if (gs.deathT > 1.7) { gs.state = 'dead'; app.showScreen('dead'); input.exitLock(); }
      }
    } else {
      gs.time += dt;
      if (['start', 'dead', 'lobby', 'over'].includes(gs.state)) player.idleCam(gs.time);
      effects.update(dt);
      if (net.active) app.ffa.update(dt, nowMs / 1000);
      if (gs.state === 'over') app.ffa.updateOver(dt);
    }
    input.anyInput = false;

    for (const a of ctx.level.animated) a.update(gs.time);
    audio.setListener(player.eye, player.right);

    const w = player.weapon;
    hud.setAmmo(w.mag, w.reserve, w.magSize, w.reloading);
    hud.setSlots(player.weapons.map((s, i) => ({ name: s.name, active: i === player.wi, ammo: s.isGun ? `${s.mag}/${s.reserve}` : '∞', empty: s.isGun && s.mag === 0 && s.reserve === 0 })));
    hud.setGrenades(player.grenades);
    hud.setBreath(player.breath);
    hud.setHealth(player.hp, player.maxHp);
    hud.setSpread(w.spreadPx);
    hud.update(dt);
    if (game.isOnline()) hud.setFocusMeter(game.playing(), player.breath, false, 'GRAPPLE');
    else {
      const show = game.playing() && (player.melee.active || gs.katanaStreak > 0 || gs.focus.active);
      hud.setFocusMeter(show, gs.focus.active ? 1 : clamp(gs.katanaStreak / 3, 0, 1), gs.focus.active, 'MELEE');
    }
    if (gs.boss) {
      if (gs.boss.alive) hud.setBoss(gs.boss.stats.name, gs.boss.hp / gs.boss.maxHp);
      else { hud.setBoss(null); gs.boss = null; }
    }
    audio.setIntensity(clamp((enemies.alive + gs.queue.length + 2 * ctx.remotes.size) / 12, 0, 1) * (gs.intermission > 0 ? 0.25 : 1));

    fx.hurt = player.hurtFx; fx.flash = player.flashFx; fx.slow = scale < 1 ? 1 : 0;
    fx.lowHp = player.alive && player.hp < 30 ? 1 - player.hp / 30 : 0;
    renderer.render(gs.time, fx);
  }

  function frame(nowMs: number): void {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    step(nowMs);
  }
  rafId = requestAnimationFrame(frame);
  keepAlive = window.setInterval(() => { if (net.active && performance.now() - lastStep > 300) step(performance.now()); }, 250);

  // ---- teardown
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    live--;
    cancelAnimationFrame(rafId);
    window.clearInterval(keepAlive);
    for (const remove of teardown) remove();
    teardown.length = 0;
    if (net.active) net.leave();
    input.dispose();
    player.melee.dispose();
    for (const weapon of player.weapons) weapon.dispose();
    audio.dispose();
    enemies.clear();
    effects.clear();
    app.pickups.clear();
    disposeLevel(scene, ctx.level);
    world.clear();
    hud.dispose();
    renderer.dispose();
  }

  return handle;
}

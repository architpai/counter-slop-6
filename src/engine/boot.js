import { clamp, randInt, store, SKEY } from './util';
import { Renderer } from './render/index';
import { World } from './physics';
import { NavGrid } from './nav';
import { Audio } from './audio';
import { Net } from './net';
import { Input } from './input';
import { Hud } from './hud/index';
import { Effects } from './effects';
import { buildLevel, disposeLevel, validKey } from './level/index';
import { EnemyManager } from './enemies/index';
import { Player } from './player/index';
import { makeGameState } from './game/state';
import { createSolo } from './game/solo';
import { createFFA } from './game/ffa';
import { createUI } from './game/ui';
import { createPickups } from './game/pickups';
import { createBreakables } from './game/breakables';

// Live instance count. A StrictMode remount or an HMR reload must leave this at
// 1: anything higher means a leaked WebGL context, audio graph and rAF chain.
let live = 0;
export const liveInstances = () => live;

/**
 * Boot one game instance against a canvas and a HUD root.
 *
 * Every browser resource this creates is released by `handle.dispose()`, so a
 * React StrictMode double-mount produces one live instance, not two.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} hudRoot
 * @returns {GameHandle}
 */
export function boot(canvas, hudRoot) {
live++;
let lastStep = performance.now();
let disposed = false;
let rafId = 0;
let keepAlive = 0;
const teardown = [];
// Declared up here because loadLevel() refreshes it, and loadLevel runs during
// boot step 3 — well before the handle object is built at step 11.
let handle = null;

// ---- boot 1-8
const renderer = new Renderer(canvas);
const { scene, camera } = renderer;
const world = new World();
const audio = new Audio();
const net = new Net();

const settings = {
  mapKey: validKey(store.getStr(SKEY.MAP, 'downtown')),
  best: store.getNum(SKEY.BEST, 0),
  music: store.getStr(SKEY.MUSIC, '1') !== '0',
  checkpoint: store.getNum(SKEY.CHECKPOINT, 0),
  name: store.getStr(SKEY.NAME, '').trim().slice(0, 14) || `recruit${randInt(10, 99)}`,
  sens: clamp(store.getNum(SKEY.SENS, 100), 25, 250),
  invert: store.getBool(SKEY.INVERT, false),
};

let loadedKey = null, loadedArena = false;
const ctx = {
  scene, camera, renderer, world, nav: null, level: null,
  input: null, hud: null, effects: null, audio, net,
  enemies: null, player: null, remotes: new Map(), game: null,
};
function loadLevel(arena, key, force = false) {
  key = validKey(key ?? (net.active ? lobby.map ?? settings.mapKey : settings.mapKey));
  if (!force && key === loadedKey && arena === loadedArena) return;
  loadedKey = key; loadedArena = arena;
  disposeLevel(scene, ctx.level); world.clear();
  ctx.level = buildLevel(scene, world, key, { arena });
  renderer.setLevelShadow(ctx.level.shadow.center, ctx.level.shadow.radius);
  ctx.nav = new NavGrid(world, ctx.level.bounds, 1); ctx.nav.build();
  audio.setTune(key);
  if (handle) { handle.level = ctx.level; handle.nav = ctx.nav; }
}
loadLevel(false, settings.mapKey);

const input = ctx.input = new Input(canvas);
const hud = ctx.hud = new Hud(hudRoot);
const effects = ctx.effects = new Effects(scene, world);
function applyLook() {
  input.mouseSens = 0.0022 * settings.sens / 100;
  input.padSensX = 3.4 * settings.sens / 100;
  input.padSensY = 2.6 * settings.sens / 100;
  input.invertY = settings.invert;
  store.set(SKEY.SENS, settings.sens); store.set(SKEY.INVERT, settings.invert);
}
applyLook();

const gs = makeGameState();
const lobby = { players: new Map(), hostId: null, isPublic: true, status: '', code: null, map: null };
const scores = new Map();

// ---- hooks 9
const game = ctx.game = {
  hitstop(d, s) { gs.hitstopT = Math.max(gs.hitstopT, d); gs.hitstopScale = s; },
  addScore(points, label = null) {
    const awarded = Math.round(points * (1 + 0.25 * Math.min(gs.combo, 9)));
    gs.score += awarded;
    if (label) hud.kill(label, awarded);
    hud.setScore(gs.score, gs.combo);
  },
  onPlayerDeath() {
    app.solo.endFocus();
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

// ---- actors 10
const enemies = ctx.enemies = new EnemyManager(ctx);
const player = ctx.player = new Player(ctx);
player.name = settings.name;

// ---- run control
const app = { ctx, gs, lobby, scores, settings, busy: false, screen: null, loadLevel, applyLook };
app.pickups = createPickups(ctx);
app.breakables = createBreakables(ctx, app.pickups);
app.addScore = game.addScore;
app.saveCheckpoint = n => { settings.checkpoint = n; store.set(SKEY.CHECKPOINT, n); };
app.solo = createSolo(app);
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
  gs.mode = 'solo'; loadLevel(false, settings.mapKey); app.beginCommon();
  if (gs.state === 'start' || gs.state === 'dead') { app.resetRun(); app.solo.startWave(1); }
  gs.state = 'play';
};
app.beginAtWave = n => {
  if (!Number.isInteger(n) || n < 1) return;
  gs.mode = 'solo'; loadLevel(false, settings.mapKey); app.beginCommon(); app.resetRun(); app.solo.startWave(n); gs.state = 'play';
};
app.pause = () => {
  if (gs.state !== 'play' || gs.menu) return;
  if (gs.mode === 'solo') gs.state = 'pause';
  gs.menu = true; app.showScreen(gs.mode === 'solo' ? 'pause' : 'menu'); audio.reelLoop(false);
};
app.resume = () => {
  if (gs.mode === 'ffa') {
    gs.menu = false; hud.hideScreen(); hud.setGameplayVisible(true);
    if (!input.usingGamepad) input.requestLock();
  } else app.beginSolo();
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
  beginSolo: app.beginSolo, beginAtWave: app.beginAtWave, jumpToWave: app.jumpToWave, step: t => step(t),
  dispose,
  get live() { return live; },
};

// ---- listeners 12-13
const listen = (target, type, fn, options) => {
  target.addEventListener(type, fn, options);
  teardown.push(() => target.removeEventListener(type, fn, options));
};
enemies.onKill = app.solo.onKill;
enemies.onBoss = app.solo.onBoss;
player.onThrow = d => { if (net.active) net.broadcast('nade', d); };
hud.onScreenClick = app.ui.screenClick;
hud.onUiAction = app.ui.onUiAction;
listen(canvas, 'click', () => {
  if (gs.state === 'play' && !gs.menu && !input.locked && !input.usingGamepad) input.requestLock();
});
input.onLockChange = locked => {
  if (!locked && gs.state === 'play' && !gs.menu && !input.usingGamepad) app.pause();
};
input.onDeviceChange = pad => {
  hud.setDevice(pad); hud.setWeapon(player.weapon.name, player.weapon.hint);
  if (app.screen && gs.state !== 'play') app.ui.redraw();
};
listen(window, 'pagehide', () => { if (net.active) net.leave(); });
let woken = false;
const wake = () => { if (woken) return; woken = true; audio.init(); audio.resume(); };
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

function step(nowMs) {
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

  if (gs.state === 'play' && gs.mode === 'solo') app.solo.updateFocus(dt);
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
  if (w.isGun) hud.setAmmo(w.mag, w.reserve, w.magSize, w.reloading); else hud.setKatanaAmmo();
  hud.setSlots(player.weapons.map((s, i) => ({ name: s.name, active: i === player.wi, ammo: s.isGun ? `${s.mag}/${s.reserve}` : '∞', empty: s.isGun && s.mag === 0 && s.reserve === 0 })));
  hud.setGrenades(player.grenades);
  hud.setBreath(player.breath);
  hud.setHealth(player.hp, player.maxHp);
  hud.setSpread(w.spreadPx);
  hud.update(dt);
  if (game.isOnline()) hud.setFocusMeter(game.playing(), player.breath, false, 'GRAPPLE');
  else {
    const show = game.playing() && (player.wi === 3 || gs.katanaStreak > 0 || gs.focus.active);
    hud.setFocusMeter(show, gs.focus.active ? 1 : clamp(gs.katanaStreak / 3, 0, 1), gs.focus.active, 'KATANA');
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

function frame(nowMs) {
  if (disposed) return;
  rafId = requestAnimationFrame(frame);
  step(nowMs);
}
rafId = requestAnimationFrame(frame);
keepAlive = setInterval(() => { if (net.active && performance.now() - lastStep > 300) step(performance.now()); }, 250);

// ---- teardown
function dispose() {
  if (disposed) return;
  disposed = true;
  live--;
  cancelAnimationFrame(rafId);
  clearInterval(keepAlive);
  for (const remove of teardown) remove();
  teardown.length = 0;
  if (net.active) net.leave();
  input.dispose();
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

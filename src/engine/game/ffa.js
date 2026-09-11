import * as THREE from 'three';
import { choose, shuffle, round1, round2, clamp } from '../util';
import { RemotePlayer, encodeState } from '../players';
import { validKey } from '../level/index';
import { Screens } from '../hud/index';
import { TONE } from '../render/index';

const KILL_TARGET = 20, TIME_LIMIT = 480, RESPAWN = 3.5, SILENT_MS = 9000;
const HOW = { rifle: 'rifle', shotgun: 'shotgun', sniper: 'sniper', katana: 'katana', grenade: 'grenade', deflect: 'their own bullet' };
const HIT_R = { head: 0.3, torso: 0.33, hips: 0.2, armL: 0.11, armR: 0.11, foreL: 0.1, foreR: 0.1, legL: 0.13, legR: 0.13, shinL: 0.11, shinR: 0.11 };

const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.length <= max;
const id = v => str(v, 128) && v.length > 0;
const num = (v, lim) => Number.isFinite(v) && Math.abs(v) <= lim;
const int = v => Number.isSafeInteger(v) && v >= 0;
const triple = (v, lim = 10000) => Array.isArray(v) && v.length === 3 && v.every(n => num(n, lim));
const vec = a => new THREE.Vector3().fromArray(a);
const cleanName = v => (typeof v === 'string' ? v.trim().slice(0, 14) : '') || 'recruit';

export function createFFA(app) {
  const { ctx, gs, lobby, scores } = app;
  const { net, hud } = ctx;
  const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), d3 = new THREE.Vector3();
  let tick = 0, shotQueue = [], boardShown = false, timer = null;

  const isOnline = () => gs.mode === 'ffa';
  const playing = () => gs.state === 'play' || gs.state === 'dying';
  const inMatch = () => net.active && (playing() || gs.state === 'over');
  const now = () => performance.now() / 1000;
  const spots = () => ctx.level.arenaSpawns.length ? ctx.level.arenaSpawns : ctx.level.spawns;
  const rows = () => [...scores].map(([rid, r]) => ({ id: rid, name: r.name, kills: r.kills, deaths: r.deaths }));
  const sorted = () => rows().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const boardRows = () => rows().map(r => ({ ...r, self: r.id === net.id }));
  const nameOf = rid => scores.get(rid)?.name ?? lobby.players.get(rid) ?? ctx.remotes.get(rid)?.name;

  // ---- remotes
  function addRemote(rid, name) {
    let r = ctx.remotes.get(rid);
    if (r) { r.name = name; return r; }
    r = new RemotePlayer(ctx, rid, name, 0, TONE.HOSTILE);
    r.onDamage = (amount, from) => {
      if (!canHurt(r) || !r.alive) return;
      hud.hitmarker(false, false);
      net.sendTo(rid, 'pdmg', { amount: Math.round(amount), from: from ? from.toArray().map(round1) : null, by: net.id, src: 'grenade' });
    };
    ctx.remotes.set(rid, r);
    return r;
  }
  function removeRemote(rid) {
    ctx.remotes.get(rid)?.dispose();
    ctx.remotes.delete(rid); lobby.players.delete(rid); scores.delete(rid);
  }

  // ---- scores
  function refreshScoreHud() {
    if (!isOnline()) return;
    hud.setPvpScore(Screens.pvpScore({ rows: boardRows(), selfId: net.id }));
    hud.setModifier('');
    if (boardShown) hud.setBoard(Screens.scoreboard({ rows: boardRows(), code: net.code ?? lobby.code ?? '' }));
  }
  function showBoard(on) {
    if (on === boardShown) return;
    boardShown = on;
    hud.setBoard(on ? Screens.scoreboard({ rows: boardRows(), code: net.code ?? lobby.code ?? '' }) : null);
  }
  function applyScores(list) {
    scores.clear();
    for (const r of list) scores.set(r.id, { id: r.id, name: r.name, kills: r.kills, deaths: r.deaths });
    refreshScoreHud();
  }
  function sendScores() { const list = rows(); net.send('score', list); applyScores(list); }
  function tally(victim, killer) {
    if (!net.isHost) return;
    const v = scores.get(victim); if (v) v.deaths++;
    const k = killer && killer !== victim ? scores.get(killer) : null; if (k) k.kills++;
    sendScores(); checkWin();
  }
  function checkWin() {
    if (!net.isHost || !isOnline() || gs.over) return;
    let winner = null;
    for (const [rid, r] of scores) if (r.kills >= KILL_TARGET) winner = { id: rid, name: r.name };
    if (!winner) return;
    net.send('end', winner); endMatch(winner);
  }
  function endMatch(winner) {
    gs.over = winner; gs.overT = 0; gs.state = 'over';
    app.endFocus(); ctx.input.exitLock(); showBoard(false);
    hud.setGameplayVisible(false); app.showScreen('over');
  }

  // ---- lobby
  const friendly = m => {
    if (!m) return 'something went wrong';
    if (m.includes('networking library')) return 'could not load the networking library · check your connection and reload';
    if (m.includes('timed out') || m.includes('signalling')) return 'could not reach the matchmaking server · check your connection';
    if (m.includes('no lobby with that code')) return 'no lobby with that code · check it with your friend';
    if (m.includes('no answer')) return 'found the lobby but could not connect · one of you may be on a network that blocks it';
    if (m.includes('full')) return 'that lobby is full';
    return m;
  };
  const online = status => { lobby.status = status; if (gs.state === 'start') app.showScreen('online'); };
  function enterLobby(isPublic) {
    lobby.isPublic = isPublic; lobby.code = net.code; lobby.status = '';
    gs.state = 'lobby'; app.showScreen('lobby');
  }
  async function attempt(fn) {
    if (app.busy) return;
    app.busy = true;
    try { await fn(); } catch (e) { online(friendly(e?.message)); }
    finally { app.busy = false; if (gs.state === 'start') app.showScreen('online'); }
  }
  const create = isPublic => attempt(async () => {
    online('opening a lobby…');
    await net.host({ isPublic });
    lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(net.id, app.settings.name); lobby.hostId = net.id;
    enterLobby(isPublic);
  });
  const join = code => attempt(async () => {
    if (!code) { online('type the code your friend gave you'); return; }
    online('connecting…');
    await net.join(code, { name: app.settings.name });
    enterLobby(net.isPublic);
  });
  const quickPlay = () => attempt(async () => {
    try {
      await net.quickJoin({ name: app.settings.name }, online);
      enterLobby(true);
    } catch (e) {
      if (!String(e?.message).includes('no open public')) throw e;
      online('no open lobbies · opening a public one for you…');
      await net.host({ isPublic: true });
      lobby.map = app.settings.mapKey; lobby.players.clear(); lobby.players.set(net.id, app.settings.name); lobby.hostId = net.id;
      enterLobby(true);
    }
  });
  function broadcastLobby() {
    net.send('lobby', { players: [...lobby.players].map(([pid, name]) => ({ id: pid, name })), hostId: net.id, isPublic: lobby.isPublic, map: lobby.map ?? app.settings.mapKey });
    if (gs.state === 'lobby') app.showScreen('lobby');
  }
  function peerJoined(pid, meta) {
    const name = cleanName(meta?.name);
    lobby.players.set(pid, name); addRemote(pid, name); broadcastLobby();
    if (!inMatch()) return;
    if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    net.sendTo(pid, 'start', { late: true, spawn: farthestIndex(), map: lobby.map ?? app.settings.mapKey, broken: ctx.level.breakables.filter(b => !b.alive).map(b => b.id) });
    sendScores(); hud.kill(`${name} joined`);
  }
  function peerLeft(pid) {
    const name = nameOf(pid) ?? 'someone';
    removeRemote(pid); broadcastLobby();
    if (inMatch()) { hud.kill(`${name} left`); sendScores(); }
  }
  function leave(reason = '') {
    clearTimeout(timer);
    net.leave();
    for (const rid of [...ctx.remotes.keys()]) removeRemote(rid);
    lobby.players.clear(); scores.clear(); showBoard(false);
    if (gs.state !== 'start') {
      gs.state = 'start'; gs.mode = 'solo'; app.loadLevel(false); app.resetRun(); hud.setGameplayVisible(false);
    }
    gs.menu = false; lobby.status = reason; app.showScreen('online');
  }
  function lobbyScreen() {
    app.loadLevel(true, lobby.map ?? app.settings.mapKey); app.resetRun();
    gs.state = 'lobby'; gs.over = null; gs.menu = false;
    hud.setGameplayVisible(false); showBoard(false); app.showScreen('lobby');
  }

  // ---- match
  function arenaSpawn() {
    const list = spots().map(p => {
      let d = 999;
      for (const r of ctx.remotes.values()) if (r.alive && r.visible) d = Math.min(d, p.distanceTo(r.body.pos));
      return { p, d };
    }).sort((a, b) => b.d - a.d);
    return (choose(list.slice(0, 3))?.p ?? ctx.level.playerStart).clone();
  }
  function farthestIndex() {
    const bodies = [ctx.player.body.pos, ...[...ctx.remotes.values()].filter(r => r.alive).map(r => r.body.pos)];
    let best = 0, bestD = -1;
    spots().forEach((p, i) => {
      const d = bodies.reduce((m, b) => Math.min(m, p.distanceTo(b)), 999);
      if (d > bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function hostStart() {
    if (!net.isHost) return;
    scores.clear();
    for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const map = lobby.map ?? app.settings.mapKey;
    app.loadLevel(true, map);
    const order = shuffle([...spots().keys()]), spawns = {};
    let i = 0;
    for (const pid of lobby.players.keys()) spawns[pid] = order.length ? order[i++ % order.length] : 0;
    net.send('start', { spawns, map });
    startMatch(false, spawns[net.id]); sendScores();
  }
  function startMatch(late, index) {
    gs.mode = 'ffa'; app.loadLevel(true, lobby.map ?? app.settings.mapKey); app.resetRun();
    if (!scores.size) for (const [pid, name] of lobby.players) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
    const spot = Number.isInteger(index) ? spots()[index] : null;
    ctx.player.reset(spot ? spot.clone() : arenaSpawn());
    app.beginCommon(); gs.state = 'play';
    refreshScoreHud();
    hud.message('FREE FOR ALL', late ? 'you joined a match in progress' : 'first to 20 · everyone is fair game', 3);
    hud.tip(`hold ${hud.key('score')} for the scoreboard`, 5);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (gs.state === 'play' && !ctx.input.locked && !ctx.input.usingGamepad) { gs.menu = true; app.showScreen('matchOn'); }
    }, 250);
  }
  function localDeath() {
    const p = ctx.player, killer = p.lastHitBy ?? null, h = p.lastHit;
    const dir = h?.from ? d1.subVectors(p.center, h.from).normalize().toArray().map(round2) : null;
    const how = killer ? HOW[h?.src] ?? null : null;
    net.broadcast('pdead', { killer, dir, over: !!h && (h.crit || h.amount >= 90 || h.src === 'katana'), how, crit: !!h?.crit });
    gs.respawnT = RESPAWN; gs.state = 'dying'; gs.deathT = 0;
    if (net.isHost) tally(net.id, killer);
    const row = killer ? scores.get(killer) : null;
    hud.kill(row ? `eliminated by ${row.name}${how ? ` · ${how}${h?.crit ? ' headshot' : ''}` : ''}` : 'eliminated');
  }
  function updateDying(dt) {
    const before = Math.ceil(gs.respawnT);
    gs.respawnT -= dt;
    const left = Math.ceil(gs.respawnT);
    if (left !== before || gs.deathT <= dt) hud.message(left > 0 ? String(left) : 'GO', left > 0 ? 'respawning in' : '', 1.1);
    if (gs.respawnT <= 0) respawn();
  }
  function respawn() {
    const p = ctx.player;
    p.reset(arenaSpawn()); p.name = app.settings.name; p.lastHitBy = p.lastHit = null;
    gs.state = 'play'; p.shieldT = 2;
    hud.tip('spawn protection · 2s', 1.6);
    ctx.effects.strokeBurst(p.center, TONE.PRIMARY, 24, 6, { life: 0.5, size: 0.03 });
    ctx.audio.spawn(p.center);
  }
  function updateOver(dt) {
    gs.overT += dt;
    if (net.isHost && gs.overT > 8) { net.send('backtolobby', {}); lobbyScreen(); }
  }

  // ---- network update (real dt, now in seconds)
  function update(dt, t = now()) {
    if (!net.active) return;
    tick++;
    for (const r of ctx.remotes.values()) r.update(dt, t);
    if (inMatch()) {
      for (const [rid, r] of [...ctx.remotes]) {
        if (!(r.lastSeen > 0) || t * 1000 - r.lastSeen <= SILENT_MS) continue;
        if (!net.isHost && rid === net.hostId) { leave('lost connection to the host'); return; }
        const name = r.name;
        removeRemote(rid); hud.kill(`${name} lost connection`);
        if (net.isHost) { net.close(rid); net.send('leave', { id: rid }); broadcastLobby(); sendScores(); }
      }
    }
    if (tick % 3 === 0 && inMatch()) net.broadcast('ps', encodeState(ctx.player));
    if (shotQueue.length) { net.broadcast('shots', { k: ctx.player.weapon.kind, e: shotQueue }); shotQueue = []; }
    if (net.isHost && inMatch() && !gs.over) {
      gs.matchT += dt;
      if (gs.matchT > TIME_LIMIT) {
        const top = sorted()[0], winner = top ? { id: top.id, name: top.name } : { id: net.id, name: ctx.player.name };
        net.send('end', winner); endMatch(winner);
      }
    }
  }

  // ---- PvP hooks
  const targets = () => [ctx.player, ...ctx.remotes.values()];
  const canHurt = t => isOnline() && t !== ctx.player;
  function raySphere(o, d, c, r, max, strict) {
    d1.subVectors(c, o);
    const tca = d1.dot(d);
    if (tca < 0 || (strict && tca === 0) || tca > max) return -1;
    const miss = d1.lengthSq() - tca * tca;
    if (miss > r * r) return -1;
    const t = tca - Math.sqrt(r * r - miss);
    return t < 0 ? -1 : t;
  }
  function raycastPlayers(o, d, max) {
    let best = null;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !canHurt(r)) continue;
      for (const h of r.hits) {
        const t = raySphere(o, d, h.obj.position, HIT_R[h.part] ?? h.r, max, false);
        if (t >= 0 && (!best || t < best.dist)) best = { player: r, part: h.part, dist: t, point: o.clone().addScaledVector(d, t) };
      }
      if (r.blocking) {
        d2.copy(r.center).addScaledVector(r.forward, 0.5); d2.y += 0.3;
        const t = raySphere(o, d, d2, 0.42, max, true);
        if (t >= 0 && (!best || best.player !== r || t < best.dist)) best = { player: r, part: 'blade', dist: t, point: o.clone().addScaledVector(d, t) };
      }
    }
    return best;
  }
  function playersInArc(pos, dir, range, cosHalf) {
    return [...ctx.remotes.values()].filter(r => {
      if (!r.alive || !canHurt(r)) return false;
      d1.subVectors(r.center, pos); const dist = d1.length();
      return dist <= range + 0.3 && (dist <= 0.3 || d1.dot(dir) / dist >= cosHalf) && ctx.world.lineOfSight(pos, r.center);
    });
  }
  function hitPlayer(t, damage, info = {}) {
    if (!canHurt(t) || !t.alive) return;
    const p = ctx.player, point = info.point ?? t.center;
    if (info.part === 'blade') {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 8, 6, { life: 0.22, size: 0.035 });
      ctx.audio.shieldHit(t.center);
      const ret = Math.random() < 0.4;
      if (ret) {
        ctx.effects.tracer(point, p.eye, TONE.HOSTILE, 0.03, 0.08);
        hud.tip('RETURNED', 0.9); ctx.input.rumble(0.5, 0.4, 90);
        p.lastHitBy = t.id; p.lastHit = { from: t.center.clone(), crit: false, amount: 0.6 * damage, src: 'deflect' };
        p.takeDamage(0.6 * damage, t.center);
      } else hud.tip('DEFLECTED', 0.7);
      net.sendTo(t.id, 'parry', { ret, by: net.id });
      return;
    }
    const facing = t.blocking ? d1.subVectors(p.center, t.center).normalize().dot(t.forward) : -1;
    const frontHit = /^(head|torso|arm|fore)/.test(info.part ?? '');
    if (facing > 0.6 && frontHit && info.source === 'katana' && t.parryWindow) {
      ctx.effects.strokeBurst(point, TONE.ACCENT, 10, 6, { life: 0.25, size: 0.04 });
      ctx.audio.shieldHit(t.center); ctx.game.hitstop(0.08, 0.15);
      const k = p.weapons[3]; k.cooldown = Math.max(k.cooldown, 0.6);
      ctx.input.rumble(0.6, 0.3, 90); hud.tip('PARRIED', 0.9);
      return;
    }
    ctx.effects.blood(point, info.dir ?? d1.subVectors(t.center, p.eye).normalize(), clamp(0.4 + damage / 80, 0.4, 1.6), { tone: TONE.HOSTILE });
    hud.hitmarker(false, !!info.crit); ctx.audio.hitEnemy(t.center); t.flash();
    net.sendTo(t.id, 'pdmg', { amount: Math.round(damage), from: p.center.toArray().map(round1), by: net.id, crit: !!info.crit, src: info.source ?? 'rifle' });
  }
  function cutRopes(eye, dir, range) {
    let any = false;
    for (const r of ctx.remotes.values()) {
      if (!r.alive || !r.grappling) continue;
      d2.copy(r.body.pos).addScaledVector(r.right, 0.35); d2.y += 1.25;
      for (let i = 0; i < 15; i++) {
        d3.lerpVectors(d2, r.hook, i / 14).sub(eye);
        const t = d3.dot(dir);
        if (t < 0.3 || t > range || Math.sqrt(Math.max(0, d3.lengthSq() - t * t)) > 0.9) continue;
        d3.add(eye);
        ctx.effects.strokeBurst(d3, TONE.ACCENT, 10, 5, { life: 0.25, size: 0.035 });
        net.sendTo(r.id, 'cut', {}); hud.tip('ROPE CUT', 0.9); any = true;
        break;
      }
    }
    return any;
  }
  function onShot(end) {
    if (net.active && inMatch()) shotQueue.push(round1(end.x), round1(end.y), round1(end.z));
  }

  // ---- message handlers
  const fromHost = from => !net.isHost && from === net.hostId;
  const roster = from => lobby.players.has(from) && from !== net.id;
  net.on('refused', d => leave(obj(d) && str(d.reason, 256) ? d.reason : ''));
  net.on('lobby', (d, from) => {
    if (!fromHost(from) || !obj(d) || !Array.isArray(d.players) || d.players.length > 8 || d.hostId !== net.hostId || typeof d.isPublic !== 'boolean') return;
    if (!d.players.every(p => obj(p) && id(p.id) && str(p.name, 14)) || new Set(d.players.map(p => p.id)).size !== d.players.length) return;
    lobby.hostId = d.hostId; lobby.isPublic = d.isPublic; lobby.code = net.code;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    lobby.players.clear();
    for (const p of d.players) { lobby.players.set(p.id, cleanName(p.name)); if (p.id !== net.id) addRemote(p.id, cleanName(p.name)); }
    for (const rid of [...ctx.remotes.keys()]) if (!lobby.players.has(rid)) removeRemote(rid);
    if (inMatch()) {
      for (const [pid, name] of lobby.players) if (!scores.has(pid)) scores.set(pid, { id: pid, name, kills: 0, deaths: 0 });
      refreshScoreHud();
    }
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('leave', (d, from) => {
    if (!fromHost(from) || !obj(d) || !id(d.id) || !lobby.players.has(d.id)) return;
    const name = nameOf(d.id) ?? 'someone';
    removeRemote(d.id);
    if (inMatch()) hud.kill(`${name} left`);
    if (gs.state === 'lobby') app.showScreen('lobby');
  });
  net.on('startreq', (d, from) => { if (net.isHost && lobby.players.has(from) && gs.state === 'lobby') hostStart(); });
  net.on('start', (d, from) => {
    if (!fromHost(from) || !obj(d)) return;
    if (str(d.map, 64)) lobby.map = validKey(d.map);
    let index = null;
    if (obj(d.spawns)) index = d.spawns[net.id];
    else if (d.spawn !== undefined) index = d.spawn;
    if (index !== null && index !== undefined && !int(index)) return;
    if (Array.isArray(d.broken) && (d.broken.length > 4096 || !d.broken.every(int))) return;
    startMatch(d.late === true, int(index) ? index : null);
    for (const bid of d.broken ?? []) app.breakables.breakProp(ctx.level.breakables[bid], null, false, true);
  });
  net.on('end', (d, from) => {
    if (!fromHost(from) || !obj(d) || !id(d.id) || !str(d.name, 14) || !scores.has(d.id)) return;
    endMatch({ id: d.id, name: d.name });
  });
  net.on('backtolobby', (d, from) => { if (fromHost(from)) lobbyScreen(); });
  net.on('score', (d, from) => {
    if (!fromHost(from) || !Array.isArray(d) || d.length > 8) return;
    if (!d.every(r => obj(r) && id(r.id) && str(r.name, 14) && int(r.kills) && int(r.deaths))) return;
    applyScores(d);
  });
  net.on('pickup', (d, from) => {
    if (!fromHost(from) || !obj(d) || !int(d.id) || d.id < 1 || !['ammo', 'health'].includes(d.kind) || !triple(d.pos)) return;
    app.pickups.spawn(d.kind, vec(d.pos), d.id);
  });
  net.on('taken', (d, from) => { if (fromHost(from) && obj(d) && int(d.id)) app.pickups.remove(d.id); });
  net.on('take', (d, from) => {
    if (net.isHost && roster(from) && obj(d) && int(d.id) && app.pickups.remove(d.id)) net.send('taken', { id: d.id });
  });
  net.on('ps', (d, from) => {
    const r = ctx.remotes.get(from);
    if (r && from !== net.id) r.push(d, now());
  });
  net.on('pdmg', (d, from) => {
    const p = ctx.player;
    if (!p.alive || gs.state !== 'play' || p.shieldT > 0 || !roster(from) || !obj(d) || d.by !== from) return;
    if (!(d.amount > 0 && d.amount <= 100000) || !(d.from === null || triple(d.from)) || !str(d.src, 32) || typeof d.crit !== 'boolean') return;
    const fromPos = d.from ? vec(d.from) : null;
    p.lastHitBy = from; p.lastHit = { from: fromPos, crit: d.crit, amount: d.amount, src: d.src };
    p.takeDamage(d.amount, fromPos);
  });
  net.on('pdead', (d, from) => {
    if (!roster(from) || !obj(d) || !(d.killer === null || id(d.killer)) || !(d.dir === null || triple(d.dir, 1)) || typeof d.over !== 'boolean' || typeof d.crit !== 'boolean' || !(d.how === null || str(d.how, 64))) return;
    const r = ctx.remotes.get(from), victim = r?.name ?? 'someone';
    const killer = d.killer && scores.has(d.killer) ? d.killer : null;
    if (r) { r.ragdoll(d.dir, d.over); ctx.audio.enemyDie(r.center); }
    const howText = d.how ? ` · ${d.how}${d.crit ? ' headshot' : ''}` : '';
    if (killer === net.id) { gs.kills++; app.addScore(100, `ELIMINATED ${victim}${howText}`); ctx.audio.kill(true); }
    else hud.kill(killer ? `${scores.get(killer).name} eliminated ${victim}${howText}` : `${victim} fell off the map`);
    if (net.isHost) tally(from, killer);
  });
  net.on('nade', (d, from) => {
    if (roster(from) && obj(d) && triple(d.pos) && triple(d.vel)) ctx.player.throwGrenade({ pos: d.pos, vel: d.vel });
  });
  net.on('brk', (d, from) => {
    if (roster(from) && obj(d) && int(d.id)) app.breakables.breakProp(ctx.level.breakables[d.id], null, false, false);
  });
  net.on('parry', (d, from) => {
    if (!roster(from) || !obj(d) || d.by !== from || typeof d.ret !== 'boolean') return;
    const p = ctx.player;
    ctx.audio.shieldHit(p.center); ctx.input.rumble(0.35, 0.3, 60);
    ctx.effects.strokeBurst(d1.copy(p.eye).addScaledVector(p.forward, 0.5), TONE.ACCENT, 8, 5, { life: 0.2, size: 0.03 });
    hud.kill(d.ret ? 'RETURN TO SENDER' : 'DEFLECTED', d.ret ? 25 : 0);
  });
  net.on('shots', (d, from) => {
    if (roster(from) && obj(d)) ctx.remotes.get(from)?.shots(d.k, d.e);
  });
  net.on('cut', (d, from) => {
    const p = ctx.player;
    if (!roster(from) || p.grapple.mode === 'idle') return;
    p.detachGrapple(false);
    ctx.effects.strokeBurst(p.center, TONE.ACCENT, 8, 4, { life: 0.25, size: 0.03 });
    hud.tip('your rope got cut', 1.3); ctx.input.rumble(0.5, 0.3, 80);
  });
  net.onPeerJoin = peerJoined;
  net.onPeerLeave = peerLeft;
  net.onDisconnect = () => leave('the host left the lobby');

  return {
    create, join, quickPlay, hostStart, leave, lobbyScreen, broadcastLobby,
    localDeath, updateDying, updateOver, update, refreshScoreHud, showBoard, boardRows,
    targets, canHurt, raycastPlayers, playersInArc, hitPlayer, cutRopes, onShot,
  };
}

import * as THREE from 'three';
import { clamp, choose, rand } from '../util';
import { TYPES, BOSS_ORDER } from '../enemies/index';
import { TONE } from '../render/index';

const ROSTER = [['grunt', 1, 10], ['rusher', 2, 6], ['bomber', 3, 3], ['sniper', 3, 4], ['flyer', 4, 4], ['heavy', 5, 4], ['shield', 6, 4]];
const MODS = [
  ['', 1, 1], ['CAFFEINATED · they move fast', 1.35, 0.85],
  ['JUICED · they hit harder', 0.9, 1.4], ['SWARM · more of them, thinner', 1.15, 0.9],
];

export function createSolo(app) {
  const { ctx, gs } = app;
  const delta = new THREE.Vector3(), min = new THREE.Vector3(), max = new THREE.Vector3();
  const projected = new THREE.Vector3(), look = new THREE.Vector3(), trail = new THREE.Vector3();
  const focus = gs.focus;
  function startWave(n) {
    if (!Number.isSafeInteger(n) || n < 1) return;
    gs.wave = n; gs.queue.length = 0; gs.spawnT = 2; gs.intermission = 0; gs.boss = null;
    ctx.hud.setBoss(null);
    const bossWave = n % 5 === 0;
    const bossType = BOSS_ORDER[(Math.floor(n / 5) - 1) % BOSS_ORDER.length];
    const allowed = bossWave || n < 4 ? 1 : n < 6 ? 3 : 4;
    const [name, speed, damage] = MODS[Math.floor(rand(0, allowed))];
    ctx.enemies.mods.speed = speed; ctx.enemies.mods.damage = damage; ctx.hud.setModifier(name);
    const swarm = name.startsWith('SWARM');
    gs.maxAlive = Math.min(3 + Math.floor(0.8 * n) + (swarm ? 3 : 0), swarm ? 20 : 16);
    const count = bossWave ? Math.min(6 + n, 14) : Math.round(Math.min(4 + 1.7 * n, 28) * (swarm ? 1.35 : 1));
    if (bossWave) gs.queue.push(bossType);
    const pool = ROSTER.filter(([, from]) => n >= from).map(([type, from, weight]) => [type, weight * Math.min(1, 0.3 + 0.25 * (n - from))]);
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    for (let i = 0; i < count; i++) {
      let roll = rand(0, total), selected = pool[0][0];
      for (const [type, weight] of pool) { roll -= weight; if (roll < 0) { selected = type; break; } }
      gs.queue.push(selected);
    }
    const sub = bossWave ? `${TYPES[bossType].name} IS COMING` : n === 1 ? 'they are pushing · hold the site' : name || choose(['rush B', 'do not stop', 'stay off the ground', 'swing for it', 'trade them']);
    ctx.hud.message(`WAVE ${n}`, sub, bossWave ? 3 : 2.6);
    ctx.audio.wave(); if (bossWave) ctx.audio.bossRoar(ctx.player.center);
    const tips = [
      `hold ${ctx.hud.key('grapple')} to reel in · tap it again to let go mid-swing`,
      `block with ${ctx.hud.key('block')} and some of their bullets go back at them`,
      'kills in the air are worth more · stay off the floor',
      `${ctx.hud.key('grenade')} lobs a grenade · pickups give you more`,
      `press ${ctx.hud.key('jump')} again in the air for a double jump`,
    ];
    if (n <= 5) ctx.hud.tip(tips[n - 1], 7);
    ctx.player.grenades = Math.min(ctx.player.maxGrenades, ctx.player.grenades + 1);
    if (ctx.level.pickups.length) for (let i = 0; i < 7; i++) app.pickups.spawn(i < 5 ? 'ammo' : 'health', choose(ctx.level.pickups));
    if (bossWave && n > app.settings.checkpoint) {
      app.saveCheckpoint(n); ctx.hud.kill(`CHECKPOINT · WAVE ${n}`);
    }
    ctx.hud.setWave(n, ctx.enemies.alive + gs.queue.length);
  }
  function spawnPosition(type) {
    const { player, level, world } = ctx, pp = player.body.pos;
    const spots = type === 'sniper' ? level.snipers : level.spawns;
    if (type === 'flyer') {
      const a = rand(0, Math.PI * 2), r = rand(22, 32);
      return new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, level.bounds.minX + 4, level.bounds.maxX - 4), pp.y + 12 + rand(0, 6), clamp(pp.z + Math.sin(a) * r, level.bounds.minZ + 4, level.bounds.maxZ - 4));
    }
    if (TYPES[type].boss) {
      const fits = p => !world.overlapsAABB(min.set(p.x - 1.1, p.y + 0.1, p.z - 1.1), max.set(p.x + 1.1, p.y + 5.2, p.z + 1.1));
      const clear = spots.filter(fits), far = clear.filter(p => p.distanceTo(pp) > 20);
      if (far.length || clear.length) return choose(far.length ? far : clear).clone();
      for (let i = 0; i < 200; i++) {
        const a = rand(0, Math.PI * 2), r = rand(22, 40);
        const p = new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, -44, 44), 0, clamp(pp.z + Math.sin(a) * r, -44, 44));
        p.y = world.groundBelow(p.x, 30, p.z, 40);
        if (p.y > -3 && fits(p)) return p;
      }
      return level.playerStart.clone();
    }
    let candidates = spots.filter(p => { const d = p.distanceTo(pp); return d > 14 && d < 48; });
    if (candidates.length < 2) candidates = spots.filter(p => p.distanceTo(pp) > 14);
    const hidden = candidates.filter(p => !world.lineOfSight(player.eye, delta.copy(p).addScaledVector(THREE.Object3D.DEFAULT_UP, 1.2)));
    return (choose(hidden.length ? hidden : candidates.length ? candidates : spots) || level.playerStart).clone();
  }
  function update(dt) {
    if (gs.intermission > 0) {
      gs.intermission -= dt; ctx.hud.setTimer(`next wave in ${Math.max(0, Math.ceil(gs.intermission))}`);
      if (gs.intermission <= 0) { ctx.hud.setTimer(''); startWave(gs.wave + 1); }
      return;
    }
    if (gs.queue.length && ctx.enemies.alive < gs.maxAlive) {
      gs.spawnT -= dt;
      if (gs.spawnT <= 0) {
        gs.spawnT = Math.max(0.7, 2.9 - 0.13 * gs.wave);
        const type = gs.queue.shift(), e = ctx.enemies.spawn(type, spawnPosition(type));
        if (e.stats.boss) { e.hp = e.maxHp = Math.round(e.stats.hp * (1 + 0.35 * Math.floor((gs.wave - 5) / 15))); onBoss(e); }
      }
    }
    if (!gs.queue.length && ctx.enemies.alive === 0) {
      gs.intermission = 8; ctx.hud.message(`WAVE ${gs.wave} CLEARED`, `catch your breath · +${200 * gs.wave}`, 2.5);
      app.addScore(200 * gs.wave); ctx.audio.waveClear(); ctx.player.heal(40);
    }
    ctx.hud.setWave(gs.wave, ctx.enemies.alive + gs.queue.length);
  }
  function onKill(e, info = {}, overkill) {
    if (gs.mode !== 'solo') return;
    gs.kills++; gs.combo++; gs.comboT = 3.5;
    let points = e.stats.score, label = e.stats.name;
    if (info.crit) { points += 60; label = 'HEADSHOT'; }
    if (info.source === 'katana') { points += 50; label = overkill ? 'SLICED' : 'CUT DOWN'; }
    if (info.source === 'focus') { points += 150; label = 'EXECUTED'; }
    if (info.source === 'katana' || info.source === 'focus') {
      gs.katanaStreak++; ctx.player.weapons[3].addBlood(0.42);
      if (gs.katanaStreak >= 3) enterFocus();
    } else if (info.source !== 'blast') gs.katanaStreak = 0;
    if (info.source === 'deflect') { points += 120; label = 'RETURN TO SENDER'; }
    if (info.source === 'fall') label = 'FELL OFF THE MAP';
    else if (!ctx.player.body.onGround && info.source !== 'deflect') { points += 40; label += ' · AIRBORNE'; }
    app.addScore(points, label); ctx.audio.kill(Boolean(info.crit || e.stats.boss));
    const r = rand();
    if (r < 0.62) app.pickups.spawn(r < 0.5 ? 'ammo' : 'health', e.body.pos);
  }
  function onBoss(e) {
    gs.boss = e.alive ? e : null; ctx.hud.setBoss(e.alive ? e.stats.name : null, e.hp / e.maxHp);
  }
  function candidate() {
    let selected = null, best = -Infinity;
    for (const e of ctx.enemies.list) {
      if (!e.alive || e.state === 'spawn') continue;
      delta.subVectors(e.center, ctx.player.eye); const d = delta.length();
      if (d < 0.5 || d > 24) continue;
      const aim = delta.dot(ctx.player.forward) / d, rank = 3 * aim - d / 24;
      if (aim >= 0.4 && rank > best && ctx.world.lineOfSight(ctx.player.eye, e.center)) { best = rank; selected = e; }
    }
    return selected;
  }
  function enterFocus() {
    if (gs.mode !== 'solo' || focus.chain >= 2 || !candidate()) return;
    const fresh = !focus.active;
    focus.active = true; focus.remaining = 2.6; focus.chain++; focus.arm = 0.18; focus.ready = false;
    if (fresh) { ctx.audio.focusIn(); ctx.hud.tip(`SLASH READY · hold ${ctx.hud.key('focus')} to dash`, 2.2); }
  }
  function endFocus() {
    if (!focus.active && !focus.dash) return;
    focus.active = false; focus.target = null; focus.chain = 0; focus.dash = null; gs.katanaStreak = 0;
    ctx.player.dashLock = false; ctx.hud.setFocusMark(null);
  }
  function neutralState() {
    const st = ctx.player.weaponState();
    return { ...st, fire: false, firePressed: false, aim: false, reloadPressed: false, meleePressed: false, sprinting: false, speed: 0, blockFire: !ctx.player.alive };
  }
  function endDash(blocked) {
    ctx.player.dashLock = false; focus.dash = null; ctx.player.body.vel.set(0, 0, 0);
    if (blocked) { ctx.player.weapons[3].startSlash(neutralState()); ctx.hud.tip('blocked · the dash did not reach', 1.2); }
  }
  function execute(target) {
    const previousChain = focus.chain;
    endDash(false); ctx.player.weapons[3].startSlash(neutralState());
    ctx.enemies.damage(target, 100000, { source: 'focus', part: 'head', crit: true, point: target.center.clone(), dir: delta.subVectors(target.center, ctx.player.eye).normalize().clone() });
    ctx.audio.focusSlash(); ctx.game.hitstop(0.1, 0.08); ctx.effects.shake += 0.35;
    ctx.input.rumble(0.9, 0.7, 140); ctx.player.kickFov(6); ctx.player.heal(6);
    if (previousChain === focus.chain) focus.remaining = Math.min(focus.remaining, 0.35);
    focus.target = null; ctx.hud.setFocusMark(null);
  }
  function updateDash(dt) {
    const dash = focus.dash, target = dash.target, p = ctx.player, body = p.body;
    dash.elapsed += dt;
    if (!target.alive || dash.elapsed > 1.2) { endDash(false); return; }
    const dx = target.body.pos.x - body.pos.x, dz = target.body.pos.z - body.pos.z;
    const flat = Math.hypot(dx, dz), nx = flat > 0 ? dx / flat : 0, nz = flat > 0 ? dz / flat : 0;
    p.yaw = Math.atan2(-dx, -dz); look.subVectors(target.center, p.eye);
    p.pitch = clamp(Math.atan2(look.y, Math.hypot(look.x, look.z)), -1.2, 1.2);
    const want = Math.max(0, flat - 1.1), distance = Math.min(46 * dt, want);
    let moved = 0;
    while (moved < distance - 1e-8) {
      const step = Math.min(0.22, distance - moved);
      body.pos.x += nx * step; body.pos.z += nz * step;
      if (ctx.world.overlapsBody(body)) {
        body.pos.y += 0.65;
        if (ctx.world.overlapsBody(body)) { body.pos.y -= 0.65; body.pos.x -= nx * step; body.pos.z -= nz * step; break; }
      }
      moved += step;
    }
    const dy = target.body.pos.y + (target.stats.flying ? 0.2 : 0) - body.pos.y;
    if (Math.abs(dy) > 0.05) {
      const step = clamp(dy, -46 * dt, 46 * dt); body.pos.y += step;
      if (ctx.world.overlapsBody(body)) { body.pos.y -= step; dash.stuckY += dt; } else dash.stuckY = 0;
    }
    dash.trailT += dt;
    if (dash.trailT > 0.02) {
      dash.trailT = 0; trail.copy(body.pos).y += body.height * 0.55;
      ctx.effects.tracer(dash.trail, trail, TONE.PRIMARY, 0.045, 0.28); dash.trail.copy(trail);
      ctx.effects.strokeBurst(trail, TONE.PRIMARY, 2, 5, { life: 0.22, size: 0.03 });
    }
    if (Math.hypot(flat, Math.max(0, Math.abs(dy) - 0.6)) <= 1.5) execute(target);
    else if (moved < 0.0001 && want > 0.05 && dash.stuckY > 0.08) endDash(true);
  }
  function updateFocus(dt) {
    if (!focus.active) return;
    if (focus.dash) { updateDash(dt); return; }
    focus.remaining -= dt; focus.arm -= dt;
    if (focus.remaining <= 0 || !ctx.player.alive) { endFocus(); return; }
    const held = (ctx.input.down('aim') && ctx.input.down('fire')) || ctx.input.down('dash');
    if (!held) focus.ready = true;
    const target = candidate(); focus.target = target;
    if (!target) { ctx.hud.setFocusMark(null); return; }
    ctx.camera.updateMatrixWorld(); projected.copy(target.center).project(ctx.camera);
    if (projected.z >= -1 && projected.z < 1) ctx.hud.setFocusMark((projected.x * 0.5 + 0.5) * ctx.renderer.three.domElement.clientWidth, (-projected.y * 0.5 + 0.5) * ctx.renderer.three.domElement.clientHeight);
    else ctx.hud.setFocusMark(null);
    if (held && focus.ready && focus.arm <= 0) {
      ctx.input.consume('fire'); focus.dash = { target, elapsed: 0, trail: ctx.player.center.clone(), trailT: 0, stuckY: 0 };
      ctx.player.dashLock = true; ctx.player.body.vel.set(0, 0, 0); ctx.audio.dash(); ctx.player.kickFov(5);
      ctx.input.rumble(0.5, 0.4, 120); ctx.hud.setFocusMark(null);
    }
  }
  return { startWave, spawnPosition, update, onKill, onBoss, updateFocus, endFocus, enterFocus, candidate };
}

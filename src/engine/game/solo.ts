import * as THREE from 'three';
import { clamp, choose, rand } from '../util';
import { KATANA_SLOT } from '../types';
import { TYPES, BOSS_ORDER } from '../enemies/index';
import { TONE } from '../render/index';
import type { EnemyKind, HitInfo, Weapon, WeaponState } from '../types';
import type { EnemyRecord } from '../enemies/index';
import type { Katana } from '../weapons/index';
import type { Player } from '../player/index';
import type { App } from '../boot';

const ROSTER: ReadonlyArray<readonly [string, number, number]> = [['grunt', 1, 10], ['rusher', 2, 6], ['bomber', 3, 3], ['sniper', 3, 4], ['flyer', 4, 4], ['heavy', 5, 4], ['shield', 6, 4]];
const MODS: ReadonlyArray<readonly [string, number, number]> = [
  ['', 1, 1], ['CAFFEINATED · they move fast', 1.35, 0.85],
  ['JUICED · they hit harder', 0.9, 1.4], ['SWARM · more of them, thinner', 1.15, 0.9],
];

const isKatana = (w: Weapon): w is Katana => w.kind === 'katana';

/** The live shape of `gs.focus` while solo runs. `makeGameState` builds exactly this. */
interface FocusDash {
  target: EnemyRecord;
  elapsed: number;
  trail: THREE.Vector3;
  trailT: number;
  stuckY: number;
}

interface SoloFocus {
  active: boolean;
  remaining: number;
  chain: number;
  target: EnemyRecord | null;
  dash: FocusDash | null;
  arm: number;
  ready: boolean;
}

export interface SoloApi {
  startWave(n: number): void;
  spawnPosition(type: string): THREE.Vector3;
  update(dt: number): void;
  onKill(e: EnemyRecord, info: HitInfo, overkill: boolean): void;
  onBoss(e: EnemyRecord): void;
  updateFocus(dt: number): void;
  endFocus(): void;
  enterFocus(): void;
  candidate(): EnemyRecord | null;
}

export function createSolo(app: App): SoloApi {
  const { ctx, gs } = app;
  const delta = new THREE.Vector3(), min = new THREE.Vector3(), max = new THREE.Vector3();
  const projected = new THREE.Vector3(), look = new THREE.Vector3(), trail = new THREE.Vector3();
  // `makeGameState` builds exactly this shape; the declared `FocusState` only
  // names `active`, so the downcast goes through `unknown`.
  const focus = gs.focus as unknown as SoloFocus;
  function startWave(n: number): void {
    if (!Number.isSafeInteger(n) || n < 1) return;
    const enemies = ctx.enemies, player = ctx.player;
    // Set on every live path; the guard is there for the type.
    if (enemies === null || player === null) return;
    gs.wave = n; gs.queue.length = 0; gs.spawnT = 2; gs.intermission = 0; gs.boss = null;
    ctx.hud.setBoss(null);
    const bossWave = n % 5 === 0;
    const bossType: EnemyKind = BOSS_ORDER[(Math.floor(n / 5) - 1) % BOSS_ORDER.length] ?? 'boss';
    const allowed = bossWave || n < 4 ? 1 : n < 6 ? 3 : 4;
    const mod = MODS[Math.floor(rand(0, allowed))];
    const name = mod?.[0] ?? '';
    const speed = mod?.[1] ?? 1;
    const damage = mod?.[2] ?? 1;
    enemies.mods.speed = speed; enemies.mods.damage = damage; ctx.hud.setModifier(name);
    const swarm = name.startsWith('SWARM');
    gs.maxAlive = Math.min(3 + Math.floor(0.8 * n) + (swarm ? 3 : 0), swarm ? 20 : 16);
    const count = bossWave ? Math.min(6 + n, 14) : Math.round(Math.min(4 + 1.7 * n, 28) * (swarm ? 1.35 : 1));
    if (bossWave) gs.queue.push(bossType);
    const pool = ROSTER.filter(([, from]) => n >= from).map(([type, from, weight]): [string, number] => [type, weight * Math.min(1, 0.3 + 0.25 * (n - from))]);
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    for (let i = 0; i < count; i++) {
      let roll = rand(0, total);
      let selected: string = pool[0]?.[0] ?? 'grunt';
      for (const [type, weight] of pool) { roll -= weight; if (roll < 0) { selected = type; break; } }
      gs.queue.push(selected);
    }
    const sub = bossWave ? `${TYPES[bossType]?.name ?? 'BOSS'} IS COMING` : n === 1 ? 'they are pushing · hold the site' : name || choose(['rush B', 'do not stop', 'stay off the ground', 'swing for it', 'trade them']);
    ctx.hud.message(`WAVE ${n}`, sub, bossWave ? 3 : 2.6);
    ctx.audio.wave(); if (bossWave) ctx.audio.bossRoar(player.center);
    const tips = [
      `hold ${ctx.hud.key('grapple')} to reel in · tap it again to let go mid-swing`,
      `block with ${ctx.hud.key('block')} and some of their bullets go back at them`,
      'kills in the air are worth more · stay off the floor',
      `${ctx.hud.key('grenade')} lobs a grenade · pickups give you more`,
      `press ${ctx.hud.key('jump')} again in the air for a double jump`,
    ];
    if (n <= 5) {
      const tip = tips[n - 1];
      if (tip !== undefined) ctx.hud.tip(tip, 7);
    }
    player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
    if (ctx.level.pickups.length) for (let i = 0; i < 7; i++) app.pickups.spawn(i < 5 ? 'ammo' : 'health', choose(ctx.level.pickups));
    if (bossWave && n > app.settings.checkpoint) {
      app.saveCheckpoint(n); ctx.hud.kill(`CHECKPOINT · WAVE ${n}`);
    }
    ctx.hud.setWave(n, enemies.alive + gs.queue.length);
  }
  function spawnPosition(type: string): THREE.Vector3 {
    const player = ctx.player;
    if (player === null) return ctx.level.playerStart.clone();
    const { level, world } = ctx, pp = player.body.pos;
    const spots = type === 'sniper' ? level.snipers : level.spawns;
    if (type === 'flyer') {
      const a = rand(0, Math.PI * 2), r = rand(22, 32);
      return new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, level.bounds.minX + 4, level.bounds.maxX - 4), pp.y + 12 + rand(0, 6), clamp(pp.z + Math.sin(a) * r, level.bounds.minZ + 4, level.bounds.maxZ - 4));
    }
    if (TYPES[type as EnemyKind]?.boss) {
      const fits = (p: THREE.Vector3): boolean => !world.overlapsAABB(min.set(p.x - 1.1, p.y + 0.1, p.z - 1.1), max.set(p.x + 1.1, p.y + 5.2, p.z + 1.1));
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
  function update(dt: number): void {
    const enemies = ctx.enemies, player = ctx.player;
    if (enemies === null || player === null) return;
    if (gs.intermission > 0) {
      gs.intermission -= dt; ctx.hud.setTimer(`next wave in ${Math.max(0, Math.ceil(gs.intermission))}`);
      if (gs.intermission <= 0) { ctx.hud.setTimer(''); startWave(gs.wave + 1); }
      return;
    }
    if (gs.queue.length && enemies.alive < gs.maxAlive) {
      gs.spawnT -= dt;
      if (gs.spawnT <= 0) {
        gs.spawnT = Math.max(0.7, 2.9 - 0.13 * gs.wave);
        const type = gs.queue.shift();
        if (type === undefined) return;
        const e = enemies.spawn(type, spawnPosition(type));
        if (e === null) return;
        if (e.stats.boss) { e.hp = e.maxHp = Math.round(e.stats.hp * (1 + 0.35 * Math.floor((gs.wave - 5) / 15))); onBoss(e); }
      }
    }
    if (!gs.queue.length && enemies.alive === 0) {
      gs.intermission = 8; ctx.hud.message(`WAVE ${gs.wave} CLEARED`, `catch your breath · +${200 * gs.wave}`, 2.5);
      app.addScore(200 * gs.wave); ctx.audio.waveClear(); player.heal(40);
    }
    ctx.hud.setWave(gs.wave, enemies.alive + gs.queue.length);
  }
  function onKill(e: EnemyRecord, info: HitInfo = {}, overkill = false): void {
    if (gs.mode !== 'solo') return;
    const player = ctx.player;
    if (player === null) return;
    gs.kills++; gs.combo++; gs.comboT = 3.5;
    let points = e.stats.score, label = e.stats.name;
    if (info.crit) { points += 60; label = 'HEADSHOT'; }
    if (info.source === 'katana') { points += 50; label = overkill ? 'SLICED' : 'CUT DOWN'; }
    if (info.source === 'focus') { points += 150; label = 'EXECUTED'; }
    if (info.source === 'katana' || info.source === 'focus') {
      gs.katanaStreak++;
      const blade = player.weapons[KATANA_SLOT];
      if (blade !== undefined && isKatana(blade)) blade.addBlood(0.42);
      if (gs.katanaStreak >= 3) enterFocus();
    } else if (info.source !== 'blast') gs.katanaStreak = 0;
    if (info.source === 'deflect') { points += 120; label = 'RETURN TO SENDER'; }
    if (info.source === 'fall') label = 'FELL OFF THE MAP';
    else if (!player.body.onGround && info.source !== 'deflect') { points += 40; label += ' · AIRBORNE'; }
    app.addScore(points, label); ctx.audio.kill(Boolean(info.crit || e.stats.boss));
    const r = rand();
    if (r < 0.62) app.pickups.spawn(r < 0.5 ? 'ammo' : 'health', e.body.pos);
  }
  function onBoss(e: EnemyRecord): void {
    gs.boss = e.alive ? e : null; ctx.hud.setBoss(e.alive ? e.stats.name : null, e.hp / e.maxHp);
  }
  function candidate(): EnemyRecord | null {
    const player = ctx.player;
    if (player === null) return null;
    let selected: EnemyRecord | null = null, best = -Infinity;
    for (const e of ctx.enemies?.list ?? []) {
      if (!e.alive || e.state === 'spawn') continue;
      delta.subVectors(e.center, player.eye); const d = delta.length();
      if (d < 0.5 || d > 24) continue;
      const aim = delta.dot(player.forward) / d, rank = 3 * aim - d / 24;
      if (aim >= 0.4 && rank > best && ctx.world.lineOfSight(player.eye, e.center)) { best = rank; selected = e; }
    }
    return selected;
  }
  function enterFocus(): void {
    if (gs.mode !== 'solo' || focus.chain >= 2 || !candidate()) return;
    const fresh = !focus.active;
    focus.active = true; focus.remaining = 2.6; focus.chain++; focus.arm = 0.18; focus.ready = false;
    if (fresh) { ctx.audio.focusIn(); ctx.hud.tip(`SLASH READY · hold ${ctx.hud.key('focus')} to dash`, 2.2); }
  }
  function endFocus(): void {
    if (!focus.active && !focus.dash) return;
    const player = ctx.player;
    focus.active = false; focus.target = null; focus.chain = 0; focus.dash = null; gs.katanaStreak = 0;
    if (player !== null) player.dashLock = false;
    ctx.hud.setFocusMark(null);
  }
  function neutralState(player: Player): WeaponState {
    const st = player.weaponState();
    return { ...st, fire: false, firePressed: false, aim: false, reloadPressed: false, meleePressed: false, sprinting: false, speed: 0, blockFire: !player.alive };
  }
  function endDash(blocked: boolean): void {
    const player = ctx.player;
    if (player === null) return;
    player.dashLock = false; focus.dash = null; player.body.vel.set(0, 0, 0);
    if (blocked) {
      const blade = player.weapons[KATANA_SLOT];
      if (blade !== undefined && isKatana(blade)) blade.startSlash(neutralState(player));
      ctx.hud.tip('blocked · the dash did not reach', 1.2);
    }
  }
  function execute(target: EnemyRecord): void {
    const player = ctx.player, enemies = ctx.enemies;
    if (player === null || enemies === null) return;
    const previousChain = focus.chain;
    endDash(false);
    const blade = player.weapons[KATANA_SLOT];
    if (blade !== undefined && isKatana(blade)) blade.startSlash(neutralState(player));
    enemies.damage(target, 100000, { source: 'focus', part: 'head', crit: true, point: target.center.clone(), dir: delta.subVectors(target.center, player.eye).normalize().clone() });
    ctx.audio.focusSlash(); ctx.game.hitstop(0.1, 0.08); ctx.effects.shake += 0.35;
    ctx.input.rumble(0.9, 0.7, 140); player.kickFov(6); player.heal(6);
    if (previousChain === focus.chain) focus.remaining = Math.min(focus.remaining, 0.35);
    focus.target = null; ctx.hud.setFocusMark(null);
  }
  function updateDash(dt: number): void {
    const dash = focus.dash;
    const p = ctx.player;
    if (dash === null || p === null) return;
    const target = dash.target, body = p.body;
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
  function updateFocus(dt: number): void {
    if (!focus.active) return;
    const player = ctx.player;
    if (player === null) return;
    if (focus.dash) { updateDash(dt); return; }
    focus.remaining -= dt; focus.arm -= dt;
    if (focus.remaining <= 0 || !player.alive) { endFocus(); return; }
    const held = (ctx.input.down('aim') && ctx.input.down('fire')) || ctx.input.down('dash');
    if (!held) focus.ready = true;
    const target = candidate(); focus.target = target;
    if (!target) { ctx.hud.setFocusMark(null); return; }
    ctx.camera.updateMatrixWorld(); projected.copy(target.center).project(ctx.camera);
    if (projected.z >= -1 && projected.z < 1) ctx.hud.setFocusMark((projected.x * 0.5 + 0.5) * ctx.renderer.three.domElement.clientWidth, (-projected.y * 0.5 + 0.5) * ctx.renderer.three.domElement.clientHeight);
    else ctx.hud.setFocusMark(null);
    if (held && focus.ready && focus.arm <= 0) {
      ctx.input.consume('fire'); focus.dash = { target, elapsed: 0, trail: player.center.clone(), trailT: 0, stuckY: 0 };
      player.dashLock = true; player.body.vel.set(0, 0, 0); ctx.audio.dash(); player.kickFov(5);
      ctx.input.rumble(0.5, 0.4, 120); ctx.hud.setFocusMark(null);
    }
  }
  return { startWave, spawnPosition, update, onKill, onBoss, updateFocus, endFocus, enterFocus, candidate };
}

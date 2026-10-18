import * as THREE from 'three';
import { clamp, choose, rand, wrapAngle } from '../util';
import { TYPES, BOSS_ORDER } from '../enemies/index';
import type { EnemyKind, HitInfo, Target } from '../types';
import type { EnemyRecord } from '../enemies/index';
import type { App } from '../boot';
import { ROSTER, MUTATIONS, mutationCount, nextSpawn } from '../enemies/progression';
import { validBossPerch } from '../level/boss-perch';
import { COOP, coopScale } from './coop-rules';
import { LAST_FEW, showStragglers, stragglerMark, type StragglerMark } from './stragglers';
import { createExecution } from './execution';
const MODS: ReadonlyArray<readonly [string, number, number]> = [
  ['', 1, 1], ['CAFFEINATED · they move fast', 1.35, 0.85],
  ['JUICED · they hit harder', 0.9, 1.4], ['SWARM · more of them, thinner', 1.15, 0.9],
];

export interface SoloApi {
  /** The current wave's HUD modifier line and subtitle, for the co-op state. */
  readonly intro: { label: string; sub: string };
  startWave(n: number): void;
  spawnPosition(type: string): THREE.Vector3;
  update(dt: number): void;
  onKill(e: EnemyRecord, info: HitInfo, overkill: boolean): void;
  /** The killer's half of a kill: score, combo, feed line, katana streak. */
  reward(e: EnemyRecord, info: HitInfo, overkill: boolean): void;
  /** The world's half of a kill: the ammo or health it leaves. */
  drop(e: EnemyRecord): void;
  onBoss(e: EnemyRecord): void;
  /** Every frame: marks the last few enemies of a wave (of a boss wave, once the boss is down). */
  markStragglers(): void;
  /** The samurai execution (game/execution.ts), every frame with real time. */
  updateFocus(dt: number): void;
  /** Stop an execution; `spent` empties the sword gauge. */
  endFocus(spent?: boolean): void;
  /** Fill the sword gauge by `amount` thirds. */
  addCharge(amount: number): void;
}

export function createSolo(app: App): SoloApi {
  const { ctx, gs } = app;
  const delta = new THREE.Vector3(), min = new THREE.Vector3(), max = new THREE.Vector3();
  const projected = new THREE.Vector3();
  // `makeGameState` builds exactly this shape; the declared `FocusState` only
  // names `active`, so the downcast goes through `unknown`.
  const execution = createExecution(app);
  /** Bearings (player -> spawn) of the last few spawns, so the next one comes from somewhere else. */
  const recentBearings: number[] = [];
  const intro = { label: '', sub: '' };
  /** Read once at each wave start: a player who leaves makes the next wave smaller, not this one. */
  let scale = coopScale(1);
  /** The last few of this wave were called out. More left, or a break between waves, clears it. */
  let calledOut = false;
  function startWave(n: number): void {
    if (!Number.isSafeInteger(n) || n < 1) return;
    const enemies = ctx.enemies, player = ctx.player;
    // Set on every live path; the guard is there for the type.
    if (enemies === null || player === null) return;
    gs.wave = n; gs.queue.length = 0; gs.spawnT = 1; gs.intermission = 0; gs.boss = null;
    scale = coopScale(app.coop.players());
    ctx.hud.setBoss(null);
    const bossWave = n % 5 === 0;
    let bossType: EnemyKind = BOSS_ORDER[(Math.floor(n / 5) - 1) % BOSS_ORDER.length] ?? 'boss';
    if (bossType === 'aimbot' && !validBossPerch(ctx)) bossType = 'boss';
    enemies.setMutations(n);
    const mutation = n >= 31 && (n - 31) % 5 === 0 && n <= 46 ? MUTATIONS[mutationCount(n) - 1] : undefined;
    const allowed = bossWave || n < 4 ? 1 : n < 6 ? 3 : 4;
    const mod = MODS[Math.floor(rand(0, allowed))];
    const name = mod?.[0] ?? '';
    const speed = mod?.[1] ?? 1;
    const damage = mod?.[2] ?? 1;
    const swarm = name.startsWith('SWARM');
    // Endless: past wave 30 every enemy gets a little faster and harder each wave, capped so it stays playable.
    const endless = 1 + 0.03 * Math.max(0, n - 30);
    enemies.mods.speed = Math.min(speed * endless, speed * 1.6);
    enemies.mods.damage = Math.min(damage * endless, damage * 1.6);
    intro.label = endless > 1 ? `${name ? `${name} · ` : ''}+${Math.round((Math.min(endless, 1.6) - 1) * 100)}%` : name;
    ctx.hud.setModifier(intro.label);
    gs.maxAlive = Math.min(Math.min(4 + Math.floor(0.8 * n) + (swarm ? 3 : 0), swarm ? 20 : 16) + scale.alive, COOP.ALIVE_CAP);
    const count = Math.round((bossWave ? Math.min(6 + n, 14) : Math.round(Math.min(4 + 1.7 * n, 28) * (swarm ? 1.35 : 1))) * scale.count);
    if (bossWave) gs.queue.push(bossType);
    const pool = ROSTER.filter(([type, from]) => n >= from
      && (type !== 'sapper' || ctx.level.breakables.some(p => ['crate', 'barrel'].includes(p.kind)))).map(([type, from, weight]): [string, number] => [type, weight * Math.min(1, 0.3 + 0.25 * (n - from))]);
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    const draw: string[] = [];
    for (let i = 0; i < count; i++) {
      let roll = rand(0, total);
      let selected: string = pool[0]?.[0] ?? 'grunt';
      for (const [type, weight] of pool) { roll -= weight; if (roll < 0) { selected = type; break; } }
      draw.push(selected);
    }
    // Beats, not a trickle: deal the draw out in same-type packs of 2-3 (a rusher pair, then grunts, then drones).
    const left = new Map<string, number>();
    for (const type of draw) left.set(type, (left.get(type) ?? 0) + 1);
    while (left.size) {
      for (const [type, remaining] of [...left]) {
        const pack = Math.min(remaining, Math.round(rand(2, 3)));
        for (let i = 0; i < pack; i++) gs.queue.push(type);
        if (remaining - pack > 0) left.set(type, remaining - pack); else left.delete(type);
      }
    }
    const sub = mutation?.label ?? (bossWave ? `${TYPES[bossType]?.name ?? 'BOSS'} IS COMING` : n === 1 ? 'they are pushing · hold the site' : name || choose(['rush B', 'do not stop', 'stay off the ground', 'swing for it', 'trade them']));
    intro.sub = sub;
    ctx.hud.message(`WAVE ${n}`, sub, bossWave ? 3 : 2.6);
    ctx.audio.wave(); if (bossWave) ctx.audio.bossRoar(player.center);
    const tips = [
      `hold ${ctx.hud.key('grapple')} to reel in · tap it again to let go mid-swing`,
      `sword: hold ${ctx.hud.key('aim')} to guard and return bullets · slash bullets to cut them`,
      'kills in the air are worth more · stay off the floor',
      `${ctx.hud.key('grenade')} lobs a grenade · pickups give you more`,
      `${ctx.hud.key('dash')} in the air dashes · ${ctx.hud.key('jump')} on a wall jumps off it`,
    ];
    if (n <= 5) {
      const tip = tips[n - 1];
      if (tip !== undefined) ctx.hud.tip(tip, 7);
    }
    player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
    if (ctx.level.pickups.length) for (let i = 0; i < 7 + scale.pickups; i++) app.pickups.spawn(i % 7 < 5 ? 'ammo' : 'health', choose(ctx.level.pickups));
    ctx.hud.setWave(n, enemies.alive + gs.queue.length);
  }
  function spawnPosition(type: string): THREE.Vector3 {
    const player = ctx.player;
    if (player === null) return ctx.level.playerStart.clone();
    const { level, world } = ctx;
    // Co-op: each spawn is placed around one living player, and away from all of them. Solo has one.
    const alive = ctx.game.targets().filter(t => t.alive);
    const anchor: Target = alive.length > 1 ? choose(alive) : alive[0] ?? player, near = alive.length ? alive : [anchor];
    const pp = anchor.body.pos;
    if (type === 'aimbot') {
      const perch = validBossPerch(ctx);
      if (perch) return perch.clone();
    }
    const spots = type === 'sniper' ? level.snipers : level.spawns;
    if (TYPES[type as EnemyKind]?.flying) {
      // The rear 120 degrees of the player's facing: a drone is a trap, not a thing you watch arrive.
      const behind = Math.atan2(-anchor.forward.x, -anchor.forward.z) + rand(-1.05, 1.05);
      const a = Math.PI / 2 - behind, r = rand(22, 32);
      return new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, level.bounds.minX + 4, level.bounds.maxX - 4), pp.y + 12 + rand(0, 6), clamp(pp.z + Math.sin(a) * r, level.bounds.minZ + 4, level.bounds.maxZ - 4));
    }
    if (TYPES[type as EnemyKind]?.boss) {
      const fits = (p: THREE.Vector3): boolean => !world.overlapsAABB(min.set(p.x - 1.1, p.y + 0.1, p.z - 1.1), max.set(p.x + 1.1, p.y + 5.2, p.z + 1.1));
      // Only a spot the boss grid can walk from; the walker grid routed bosses into gaps they never fit.
      const clear = spots.filter(p => fits(p) && ctx.bossNav.findPath(p, pp)?.complete), far = clear.filter(p => p.distanceTo(pp) > 20);
      if (far.length || clear.length) return choose(far.length ? far : clear).clone();
      for (let i = 0; i < 200; i++) {
        const a = rand(0, Math.PI * 2), r = rand(22, 40);
        const p = new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, level.bounds.minX + 4, level.bounds.maxX - 4), 0, clamp(pp.z + Math.sin(a) * r, level.bounds.minZ + 4, level.bounds.maxZ - 4));
        p.y = world.groundBelow(p.x, 30, p.z, 40);
        if (p.y > -3 && fits(p)) return p;
      }
      return level.playerStart.clone();
    }
    const apart = (p: THREE.Vector3): boolean => near.every(t => p.distanceTo(t.body.pos) > 14);
    let candidates = spots.filter(p => p.distanceTo(pp) < 48 && apart(p));
    if (candidates.length < 2) candidates = spots.filter(apart);
    const hidden = candidates.filter(p => { delta.copy(p).addScaledVector(THREE.Object3D.DEFAULT_UP, 1.2); return near.every(t => !world.lineOfSight(t.eye, delta)); });
    const from = hidden.length ? hidden : candidates.length ? candidates : spots;
    // Of the usable spots, take the one whose bearing is furthest from the last three spawns, so the
    // wave arrives from several streets instead of queuing down one. Random among near-equals.
    const bearing = (p: THREE.Vector3) => Math.atan2(p.x - pp.x, p.z - pp.z);
    const separation = (p: THREE.Vector3) => recentBearings.reduce((best, b) => Math.min(best, Math.abs(wrapAngle(bearing(p) - b))), Math.PI);
    let pick: THREE.Vector3 | null = null, best = -Infinity;
    for (const p of from) { const score = separation(p) + rand(0, 0.4); if (score > best) { best = score; pick = p; } }
    const chosen = pick ?? level.playerStart;
    recentBearings.push(bearing(chosen)); if (recentBearings.length > 3) recentBearings.shift();
    return chosen.clone();
  }
  function update(dt: number): void {
    const enemies = ctx.enemies, player = ctx.player;
    if (enemies === null || player === null) return;
    if (gs.intermission > 0) {
      if (ctx.input.pressed('confirm')) gs.intermission = 0;
      else gs.intermission -= dt;
      ctx.hud.setTimer(`next wave in ${Math.max(0, Math.ceil(gs.intermission))}${ctx.input.usingGamepad ? '' : ' · Enter to skip'}`);
      if (gs.intermission <= 0) { ctx.hud.setTimer(''); startWave(gs.wave + 1); }
      return;
    }
    if (gs.queue.length && enemies.alive < gs.maxAlive) {
      gs.spawnT -= dt;
      if (gs.spawnT <= 0) {
        gs.spawnT = Math.max(0.7, 2.2 - 0.13 * gs.wave) / scale.interval;
        let type = nextSpawn(gs.queue, type => enemies.canSpawn(type));
        if (type === undefined) return;
        if (type === 'aimbot' && !validBossPerch(ctx)) type = 'boss';
        const e = enemies.spawn(type, spawnPosition(type));
        if (e === null) return;
        if (e.stats.boss) { e.hp = e.maxHp = Math.round(e.stats.hp * (1 + 0.35 * Math.floor((gs.wave - 5) / 15)) * scale.bossHp); onBoss(e); }
      }
    }
    if (!gs.queue.length && enemies.alive === 0) {
      gs.intermission = 8; ctx.hud.message(`WAVE ${gs.wave} CLEARED`, `catch your breath · +${200 * gs.wave}`, 2.5);
      app.addScore(200 * gs.wave); ctx.audio.waveClear(); player.heal(40);
      // A cleared boss wave unlocks a start at the wave after it.
      if (gs.wave % 5 === 0 && gs.wave > app.settings.checkpoint) {
        app.saveCheckpoint(gs.wave); ctx.hud.kill(`CHECKPOINT · WAVE ${gs.wave + 1}`);
      }
    }
    ctx.hud.setWave(gs.wave, enemies.alive + gs.queue.length);
  }
  function onKill(e: EnemyRecord, info: HitInfo = {}, overkill = false): void {
    // Co-op: the host credits the attacker; each machine rewards only its own player.
    if (app.coop.active()) { app.coop.onKill(e, info, overkill); return; }
    if (gs.mode === 'ffa') return;
    reward(e, info, overkill); drop(e);
  }
  function reward(e: EnemyRecord, info: HitInfo = {}, overkill = false): void {
    const player = ctx.player;
    if (player === null) return;
    gs.kills++; gs.combo++; gs.comboT = 3.5;
    // Plain kills only move the score; the feed is for the special ones.
    let points = e.stats.score, label: string | null = e.stats.boss ? e.stats.name : null;
    if (info.crit) { points += 60; label = 'HEADSHOT'; }
    if (info.source === 'melee') { points += 50; label = overkill ? 'SLICED' : 'CUT DOWN'; }
    if (info.source === 'wave') { points += 60; label = 'AIR SLASH'; }
    if (info.source === 'focus') { points += 150; label = 'EXECUTED'; }
    // Sword kills fill the gauge, which keeps between kills; an execution's own kills do not refill it.
    if (info.source === 'melee' || info.source === 'wave' || info.source === 'focus') player.sword?.addBlood(0.42);
    if (info.source === 'melee' || info.source === 'wave') execution.addCharge(1);
    if (info.source === 'deflect') { points += 120; label = 'RETURN TO SENDER'; }
    if (info.source === 'fall') label = 'FELL OFF THE MAP';
    // An execution's dash leaves the ground; that is not an air kill.
    else if (!player.body.onGround && info.source !== 'deflect' && info.source !== 'focus') { points += 40; label = label ? `${label} · AIRBORNE` : 'AIRBORNE'; }
    app.addScore(points, label); ctx.audio.kill(Boolean(info.crit || e.stats.boss));
  }
  function drop(e: EnemyRecord): void {
    const r = rand();
    if (r < 0.62) app.pickups.spawn(r < 0.5 ? 'ammo' : 'health', e.body.pos);
  }
  function onBoss(e: EnemyRecord): void {
    gs.boss = e.alive ? e : null; ctx.hud.setBoss(e.alive ? e.stats.name : null, e.hp / e.maxHp);
  }
  function markStragglers(): void {
    const enemies = ctx.enemies, list = enemies?.list ?? [];
    // A co-op client has no queue of its own; the host's count comes with the run state.
    const left = app.coop.active() && !ctx.net.isHost ? app.coop.state?.left ?? 0 : (enemies?.alive ?? 0) + gs.queue.length;
    const boss = list.some(e => e.alive && e.stats.boss) || gs.queue.some(type => TYPES[type as EnemyKind]?.boss);
    const marks: StragglerMark[] = [];
    if (left > LAST_FEW || gs.intermission > 0) calledOut = false;
    if ((gs.mode === 'solo' || app.coop.active()) && ctx.game.playing() && gs.intermission <= 0 && showStragglers(gs.wave, left, boss)) {
      // Once a wave, as the arrows first show; a boss wave's go up without a word.
      if (!calledOut && gs.wave % 5 !== 0) { calledOut = true; ctx.hud.message(`${left} LEFT`, 'go get them · marked on screen', 2.2); }
      const camera = ctx.camera, canvas = ctx.renderer.three.domElement;
      camera.updateMatrixWorld();
      for (const e of list) {
        if (!e.alive) continue;
        projected.copy(e.center).applyMatrix4(camera.matrixWorldInverse);
        const behind = projected.z > 0;
        projected.applyMatrix4(camera.projectionMatrix);
        marks.push(stragglerMark(projected.x, projected.y, behind, canvas.clientWidth, canvas.clientHeight));
      }
    }
    ctx.hud.setStragglers(marks);
  }
  return { intro, startWave, spawnPosition, update, onKill, reward, drop, onBoss, markStragglers,
    updateFocus: execution.update, endFocus: execution.end, addCharge: execution.addCharge };
}

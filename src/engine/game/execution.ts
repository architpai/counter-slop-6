import * as THREE from 'three';
import { clamp } from '../util';
import { TONE } from '../render/index';
import type { WeaponState } from '../types';
import type { EnemyRecord } from '../enemies/index';
import type { Player } from '../player/index';
import type { App } from '../boot';

/**
 * The samurai execution (docs/spec/samurai-execution.md). Sword kills fill a
 * gauge that keeps between kills. When it is full, the player holds both
 * attack buttons: time slows, every enemy in reach is marked, and sweeping
 * the crosshair over a marker locks it, up to three. On release (or the
 * third lock, or the time limit) the player dashes the shortest route
 * through the locked targets, cuts each as it passes, sheathes, and they all
 * fall at once. Solo, training and co-op; co-op slows only this player's view.
 */

/** The gauge is full at 3: one third a sword or air-slash kill. */
export const CHARGE_FULL = 3;
/** A perfect parry or a bullet cut adds a little (`GameHooks.charge`). */
export const CHARGE_PARRY = 0.25;
/** How far, in metres, an enemy can be marked. */
export const EXEC_RANGE = 25;
/** Targets one execution may lock. */
export const EXEC_MAX = 3;
/** Real seconds the marking lasts at most. */
export const MARK_TIME = 3;
/** The world's time scale while marking and executing (boot.ts). */
export const EXEC_SLOW = 0.2;
/** Real seconds from the last cut to the sheathe, when everything cut falls. */
export const FINISH_DELAY = 0.45;
const DASH_SPEED = 46;
/** Real seconds one leg of the dash may take before its target counts as out of reach. */
const LEG_TIMEOUT = 1.2;

export type ExecPhase = 'idle' | 'mark' | 'dash' | 'finish';

/** The live shape of `gs.focus` (game/state.ts builds it). */
export interface ExecState {
  active: boolean;
  phase: ExecPhase;
  /** Real seconds of marking left. */
  markT: number;
  /** Locked targets, in lock order. */
  marks: EnemyRecord[];
  /** The planned visiting order. */
  route: EnemyRecord[];
  leg: number;
  legT: number;
  stuckY: number;
  /** Cut on the way, waiting for the sheathe. */
  cut: EnemyRecord[];
  finishT: number;
  trail: THREE.Vector3;
  trailT: number;
}

export interface ExecutionApi {
  /** Every frame, with real (unscaled) time. */
  update(dt: number): void;
  /** Stop at once, wherever it is; `spent` empties the gauge. */
  end(spent?: boolean): void;
  /** Add `amount` to the gauge (thirds), capped at full; says so when it fills. */
  addCharge(amount: number): void;
}

const toTarget = new THREE.Vector3(), projected = new THREE.Vector3(), look = new THREE.Vector3();
const across = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), trail = new THREE.Vector3();

/** Every order of `items` (at most 3 here: 6 orders). */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
}

/**
 * The shortest route from `start` through every point, skipping orders whose
 * legs `clear` rejects (a wall between two targets). With no clear order,
 * nearest first. Returns the indices in visiting order.
 */
export function planRoute(start: THREE.Vector3, points: readonly THREE.Vector3[],
  clear: (from: THREE.Vector3, to: THREE.Vector3) => boolean = () => true): number[] {
  const indices = points.map((_, i) => i);
  let best: number[] | null = null, bestCost = Infinity;
  for (const order of permutations(indices)) {
    let cost = 0, from = start, ok = true;
    for (const [n, i] of order.entries()) {
      const to = points[i]!;
      if (n > 0 && !clear(from, to)) { ok = false; break; }
      cost += from.distanceTo(to);
      from = to;
    }
    if (ok && cost < bestCost) { bestCost = cost; best = order; }
  }
  if (best) return best;
  const left = [...indices], out: number[] = [];
  let from = start;
  while (left.length) {
    left.sort((i, j) => from.distanceTo(points[i]!) - from.distanceTo(points[j]!));
    const next = left.shift()!;
    out.push(next);
    from = points[next]!;
  }
  return out;
}

export function createExecution(app: App): ExecutionApi {
  const { ctx, gs } = app;
  const state = gs.focus as unknown as ExecState;

  const neutral = (player: Player): WeaponState => ({ ...player.weaponState(), fire: false, firePressed: false, aim: false,
    reloadPressed: false, meleePressed: false, sprinting: false, speed: 0, grounded: true, blockFire: !player.alive });
  const held = () => (ctx.input.down('aim') && ctx.input.down('fire')) || ctx.input.down('dash');
  const pressedNow = () => ctx.input.pressed('aim') || ctx.input.pressed('fire') || ctx.input.pressed('dash');

  function addCharge(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0 || ctx.player?.sword == null) return;
    const before = gs.katanaStreak;
    gs.katanaStreak = Math.min(CHARGE_FULL, before + amount);
    if (before < CHARGE_FULL && gs.katanaStreak >= CHARGE_FULL && state.phase === 'idle') {
      ctx.audio.focusIn();
      ctx.hud.tip(`EXECUTE READY · hold ${ctx.hud.key('focus')}`, 2.4);
    }
  }

  function end(spent = false): void {
    const player = ctx.player;
    if (spent) gs.katanaStreak = 0;
    if (!state.active && state.phase === 'idle') return;
    state.active = false; state.phase = 'idle';
    state.marks = []; state.route = []; state.cut = [];
    if (player !== null) { player.dashLock = false; player.executing = false; }
    ctx.hud.setExecMarks([]);
  }

  /** In reach and in view: what a marker goes on. */
  function markable(player: Player, e: EnemyRecord): boolean {
    if (!e.alive || e.state === 'spawn') return false;
    toTarget.subVectors(e.center, player.eye);
    const d = toTarget.length();
    if (d < 0.5 || d > EXEC_RANGE + (e.stats.boss ? 1.2 : 0)) return false;
    if (toTarget.dot(player.forward) / d < 0.2) return false;
    return ctx.world.lineOfSight(player.eye, e.center);
  }

  /** The crosshair is on `e`'s marker: within its body's angular size, or a few degrees at range. */
  function underCrosshair(player: Player, e: EnemyRecord): boolean {
    toTarget.subVectors(e.center, player.eye);
    const d = toTarget.length(), cos = toTarget.dot(player.forward) / d;
    return Math.acos(clamp(cos, -1, 1)) <= Math.max(0.045, Math.atan((e.stats.boss ? 1.6 : 0.75) / d));
  }

  function startMark(player: Player): void {
    state.active = true; state.phase = 'mark'; state.markT = MARK_TIME;
    state.marks = []; state.route = []; state.cut = [];
    player.drawSword();
    player.dashLock = true; player.executing = true;
    ctx.input.consume('fire');
    ctx.audio.focusIn(); player.kickFov(4);
    ctx.hud.tip(`mark up to ${EXEC_MAX} · release to strike`, 1.6);
  }

  function updateMark(player: Player, dt: number): void {
    state.markT -= dt;
    const enemies = ctx.enemies?.list ?? [];
    state.marks = state.marks.filter(e => e.alive);
    for (const e of enemies) {
      if (state.marks.length >= EXEC_MAX) break;
      if (state.marks.includes(e) || !markable(player, e) || !underCrosshair(player, e)) continue;
      state.marks.push(e);
      ctx.audio.markTick(state.marks.length);
      ctx.input.rumble(0.25, 0.2, 40);
    }
    // Markers on every target in reach and on screen; a locked one carries its number.
    const canvas = ctx.renderer.three.domElement, w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.camera.updateMatrixWorld();
    const shown: { x: number; y: number; n: number }[] = [];
    for (const e of enemies) {
      const n = state.marks.indexOf(e) + 1;
      if (!n && !markable(player, e)) continue;
      projected.copy(e.center).project(ctx.camera);
      if (projected.z < -1 || projected.z >= 1 || Math.abs(projected.x) > 1.1 || Math.abs(projected.y) > 1.1) continue;
      shown.push({ x: (projected.x * 0.5 + 0.5) * w, y: (-projected.y * 0.5 + 0.5) * h, n });
    }
    ctx.hud.setExecMarks(shown);
    if (!player.alive) { end(); return; }
    if (state.marks.length >= EXEC_MAX || state.markT <= 0 || !held()) {
      if (state.marks.length === 0) {
        ctx.hud.tip('no target marked', 1.2);
        end();
        return;
      }
      startDash(player);
    }
  }

  function startDash(player: Player): void {
    const marks = state.marks;
    const order = planRoute(player.center, marks.map(e => e.center.clone()),
      (from, to) => ctx.world.lineOfSight(from, to));
    state.route = order.map(i => marks[i]!);
    state.phase = 'dash'; state.leg = 0; state.legT = 0; state.stuckY = 0;
    state.trail.copy(player.center); state.trailT = 0;
    player.body.vel.set(0, 0, 0);
    ctx.hud.setExecMarks([]);
    ctx.audio.dash(); player.kickFov(5); ctx.input.rumble(0.5, 0.4, 120);
  }

  /** Cut `e` in passing: the blade's arc and sparks now, the kill at the sheathe. */
  function cut(player: Player, e: EnemyRecord): void {
    if (!state.cut.includes(e)) state.cut.push(e);
    player.sword?.forceSlash(neutral(player));
    across.copy(player.right).multiplyScalar(0.9);
    a.copy(e.center).add(across); a.y += 0.45;
    b.copy(e.center).sub(across); b.y -= 0.35;
    ctx.effects.tracer(a, b, TONE.PRIMARY, 0.05, 0.5);
    ctx.effects.sparks(e.center, look.copy(player.forward).negate(), TONE.ACCENT, 10, 8);
    ctx.audio.katanaHit(); ctx.effects.shake += 0.12; ctx.input.rumble(0.6, 0.5, 70);
  }

  function nextLeg(): void { state.leg++; state.legT = 0; state.stuckY = 0; }

  function updateDash(player: Player, dt: number): void {
    const target = state.route[state.leg];
    if (!target) {
      state.phase = state.cut.length ? 'finish' : 'idle';
      state.finishT = FINISH_DELAY;
      player.body.vel.set(0, 0, 0);
      if (state.phase === 'idle') end(true);
      return;
    }
    if (!target.alive) { nextLeg(); return; }
    state.legT += dt;
    if (state.legT > LEG_TIMEOUT) { nextLeg(); return; }
    const body = player.body;
    const dx = target.body.pos.x - body.pos.x, dz = target.body.pos.z - body.pos.z;
    const flat = Math.hypot(dx, dz), nx = flat > 0 ? dx / flat : 0, nz = flat > 0 ? dz / flat : 0;
    player.yaw = Math.atan2(-dx, -dz); look.subVectors(target.center, player.eye);
    player.pitch = clamp(Math.atan2(look.y, Math.hypot(look.x, look.z)), -1.2, 1.2);
    const want = Math.max(0, flat - 1.1), distance = Math.min(DASH_SPEED * dt, want);
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
      const step = clamp(dy, -DASH_SPEED * dt, DASH_SPEED * dt); body.pos.y += step;
      if (ctx.world.overlapsBody(body)) { body.pos.y -= step; state.stuckY += dt; } else state.stuckY = 0;
    }
    state.trailT += dt;
    if (state.trailT > 0.02) {
      state.trailT = 0; trail.copy(body.pos).y += body.height * 0.55;
      ctx.effects.tracer(state.trail, trail, TONE.PRIMARY, 0.045, 0.28); state.trail.copy(trail);
      ctx.effects.strokeBurst(trail, TONE.PRIMARY, 2, 5, { life: 0.22, size: 0.03 });
    }
    if (Math.hypot(flat, Math.max(0, Math.abs(dy) - 0.6)) <= 1.5) { cut(player, target); nextLeg(); }
    else if (moved < 0.0001 && want > 0.05 && state.stuckY > 0.08) nextLeg();
  }

  /** The sheathe: everything cut falls at once. Bosses lose a quarter of their health instead. */
  function finish(player: Player, dt: number): void {
    state.finishT -= dt;
    if (state.finishT > 0) return;
    const enemies = ctx.enemies;
    ctx.audio.sheathe(); ctx.audio.focusSlash();
    for (const e of state.cut) {
      if (!e.alive || enemies === null) continue;
      enemies.damage(e, e.stats.boss ? e.maxHp * 0.25 : 100000, { source: 'focus', part: 'head', crit: true,
        point: e.center.clone(), dir: look.subVectors(e.center, player.eye).normalize().clone() });
      player.heal(6);
    }
    ctx.effects.shake += 0.35; ctx.input.rumble(0.9, 0.7, 160); player.kickFov(6);
    end(true);
  }

  function update(dt: number): void {
    const player = ctx.player;
    if (player === null) return;
    switch (state.phase) {
      case 'idle':
        if (gs.katanaStreak >= CHARGE_FULL && player.alive && !player.dashLock && player.sword && held() && pressedNow()) startMark(player);
        return;
      case 'mark': updateMark(player, dt); return;
      case 'dash': updateDash(player, dt); return;
      case 'finish': finish(player, dt); return;
    }
  }

  return { update, end, addCharge };
}

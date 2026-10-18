import { afterEach, expect, test } from 'vitest';
import { Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Player } from '@/engine/player/index';
import { EnemyManager } from '@/engine/enemies/index';
import { Input } from '@/engine/input';
import { Audio } from '@/engine/audio';
import { HudStore } from '@/engine/hud/store';
import { World } from '@/engine/physics';
import { makeGameState } from '@/engine/game/state';
import { CHARGE_FULL, CHARGE_PARRY, FINISH_DELAY, createExecution, planRoute } from '@/engine/game/execution';
import type { App } from '@/engine/boot';
import type { Ctx } from '@/engine/types';
import type { EnemyRecord } from '@/engine/enemies/index';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });

function setup() {
  const scene = new Scene(), rig = new Group(), camera = new PerspectiveCamera(82, 16 / 9);
  scene.add(camera); camera.add(rig);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const input = new Input(canvas), hud = new HudStore();
  const noop = () => {};
  const world = new World();
  world.addBox(new Vector3(-100, -1, -100), new Vector3(100, 0, 100)); world.finalize();
  const ctx = { scene, camera, renderer: { rig, three: { domElement: { clientWidth: 1600, clientHeight: 900 } } }, input, hud, audio: new Audio(), world,
    level: { playerStart: new Vector3(), movers: [], rings: [] },
    effects: { shake: 0, tracer: noop, bulletTracer: noop, strokeBurst: noop, smoke: noop, muzzleSmoke: noop, muzzleLight: noop, muzzleFlash: noop,
      shell: noop, blood: noop, sparks: noop, debris: noop, fountain: noop, bloodPool: noop, boom: noop },
    game: { raycastPlayers: () => null, playersInArc: () => [], breakablesInArc: () => [], cutRopes: () => false, blastBreakables: noop,
      hitPlayer: noop, breakHit: noop, hitstop: noop, addScore: noop, onShot: noop, onPlayerDeath: noop, mode: 'solo', playing: () => true },
  } as unknown as Ctx;
  const p = ctx.player = new Player(ctx);
  const enemies = ctx.enemies = new EnemyManager(ctx);
  const gs = { ...makeGameState(), state: 'play' as const };
  const app = { ctx, gs, coop: { active: () => false } } as unknown as App;
  const exec = createExecution(app);
  ctx.game.charge = amount => exec.addCharge(amount);
  // Both attack buttons, held and pressed, by hand.
  let held = false, pressed = false;
  input.down = action => held && (action === 'aim' || action === 'fire');
  input.pressed = action => pressed && (action === 'aim' || action === 'fire');
  const buttons = (down: boolean, edge = down) => { held = down; pressed = edge; };
  const spawn = (x: number, z: number): EnemyRecord => {
    const e = enemies.spawn('grunt', new Vector3(x, 0, z))!;
    e.state = 'hunt'; e.root.scale.setScalar(1);
    // As the first enemy update would: the centre at chest height, not on the floor.
    e.center.copy(e.body.pos).y += 1;
    return e;
  };
  /** Turn the player to look straight at `e`. */
  const lookAt = (e: EnemyRecord) => {
    const d = e.center.clone().sub(p.eye);
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  cleanups.push(() => {
    input.dispose(); canvas.remove(); enemies.clear(); p.disposeWeapons();
    scene.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  });
  p.reset(new Vector3(0, 0, 0));
  return { p, gs, exec, enemies, hud, buttons, spawn, lookAt };
}

test('the route is the shortest order through every target, skipping legs through walls', () => {
  const start = new Vector3();
  const pts = [new Vector3(10, 0, 0), new Vector3(2, 0, 0), new Vector3(6, 0, 0)];
  expect(planRoute(start, pts)).toEqual([1, 2, 0]);
  // A wall between the 2 m and 6 m targets: the best clear order goes out to 10 m and back.
  const wall = (a: Vector3, b: Vector3) => !((a.x === 2 && b.x === 6) || (a.x === 6 && b.x === 2));
  expect(planRoute(start, pts, wall)).toEqual([1, 0, 2]);
  // Nothing clear at all: nearest first.
  expect(planRoute(start, pts, () => false)).toEqual([1, 2, 0]);
  expect(planRoute(start, [])).toEqual([]);
});

test('the gauge fills from sword kills and parries, keeps between kills, and caps at full', () => {
  const { exec, gs } = setup();
  exec.addCharge(1); exec.addCharge(1);
  expect(gs.katanaStreak).toBe(2);
  exec.addCharge(CHARGE_PARRY);
  expect(gs.katanaStreak).toBeCloseTo(2.25, 8);
  exec.addCharge(5);
  expect(gs.katanaStreak).toBe(CHARGE_FULL);
});

test('mark three, dash the shortest route, cut each, and they all fall at the sheathe', () => {
  const { p, gs, exec, enemies, hud, buttons, spawn, lookAt } = setup();
  const far = spawn(-6, -14), near = spawn(3, -6), mid = spawn(-8, -6);
  gs.katanaStreak = CHARGE_FULL;
  buttons(true); exec.update(1 / 60); buttons(true, false);
  expect(gs.focus.active).toBe(true);
  expect(p.weapon.kind, 'the sword comes out').toBe('sword');
  expect(p.executing && p.dashLock).toBe(true);
  // The crosshair over each marker in turn locks it.
  for (const e of [far, near]) { lookAt(e); exec.update(1 / 60); }
  expect(hud.execMarks.filter(n => n > 0)).toEqual([1, 2]);
  p.takeDamage(50);
  expect(p.hp, 'nothing hurts an executing player').toBe(p.maxHp);
  lookAt(mid); exec.update(1 / 60);
  // The third lock starts the dash at once.
  expect((gs.focus as unknown as { phase: string }).phase).toBe('dash');
  expect((gs.focus as unknown as { route: EnemyRecord[] }).route).toEqual([near, mid, far]);
  buttons(false);
  let t = 0;
  while ((gs.focus as unknown as { phase: string }).phase === 'dash' && t < 3) { exec.update(1 / 60); t += 1 / 60; }
  expect((gs.focus as unknown as { phase: string }).phase).toBe('finish');
  expect([far, near, mid].every(e => e.alive), 'cut, but still standing until the sheathe').toBe(true);
  for (let i = 0; i < Math.ceil(FINISH_DELAY * 60) + 1; i++) exec.update(1 / 60);
  expect([far, near, mid].some(e => e.alive)).toBe(false);
  expect(gs.focus.active).toBe(false);
  expect(gs.katanaStreak, 'the gauge is spent').toBe(0);
  expect(p.executing || p.dashLock).toBe(false);
  expect(hud.execMarks).toEqual([]);
  enemies.clear();
});

test('releasing with nothing marked keeps the gauge; without a sword nothing starts', () => {
  const { p, gs, exec, buttons, spawn } = setup();
  spawn(8, -10);
  gs.katanaStreak = CHARGE_FULL;
  p.yaw = Math.PI / 2;
  buttons(true); exec.update(1 / 60);
  expect(gs.focus.active).toBe(true);
  buttons(false); exec.update(1 / 60);
  expect(gs.focus.active).toBe(false);
  expect(gs.katanaStreak).toBe(CHARGE_FULL);
  p.setLoadout(['r4c', 'pistol', 'lmg']);
  buttons(true); exec.update(1 / 60);
  expect(gs.focus.active).toBe(false);
});

test('the marking ends after its time limit and strikes what it has', () => {
  const { gs, exec, buttons, spawn, lookAt } = setup();
  const one = spawn(0, -8);
  gs.katanaStreak = CHARGE_FULL;
  buttons(true); exec.update(1 / 60); buttons(true, false);
  lookAt(one); exec.update(1 / 60);
  for (let i = 0; i < 200 && (gs.focus as unknown as { phase: string }).phase === 'mark'; i++) exec.update(1 / 60);
  expect((gs.focus as unknown as { phase: string }).phase).toBe('dash');
});

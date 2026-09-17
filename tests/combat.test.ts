import { afterEach, expect, test, vi } from 'vitest';
import { Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Player } from '@/engine/player/index';
import { RemotePlayer } from '@/engine/players';
import { updateCamera } from '@/engine/player/camera';
import { EnemyManager } from '@/engine/enemies/index';
import { syncModel } from '@/engine/enemies/model';
import { Input } from '@/engine/input';
import { Audio } from '@/engine/audio';
import { HudStore } from '@/engine/hud/store';
import { World } from '@/engine/physics';
import { Gun } from '@/engine/weapons/index';
import { createBreakables } from '@/engine/game/breakables';
import type { PickupsApi } from '@/engine/game/pickups';
import type { Ctx } from '@/engine/types';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
function setup() {
  const scene = new Scene(), rig = new Group(), camera = new PerspectiveCamera(82);
  scene.add(camera); camera.add(rig);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const input = new Input(canvas), hud = new HudStore();
  const noop = () => {};
  const ctx = { scene, camera, renderer: { rig }, input, hud, audio: new Audio(), world: new World(),
    level: { playerStart: new Vector3(), movers: [], rings: [] },
    effects: { shake: 0, tracer: noop, strokeBurst: noop, smoke: noop, shell: noop, blood: noop, sparks: noop,
      debris: noop, fountain: noop, bloodPool: noop },
    game: { raycastPlayers: () => null, playersInArc: () => [], breakablesInArc: () => [], cutRopes: () => false,
      hitPlayer: noop, breakHit: noop, hitstop: noop, addScore: noop, onShot: noop, onPlayerDeath: noop },
  } as unknown as Ctx;
  const p = ctx.player = new Player(ctx);
  const enemies = ctx.enemies = new EnemyManager(ctx);
  const frame = (dt = 0.01) => { input.update(dt); p._updateWeapons(dt); };
  const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  cleanups.push(() => {
    input.dispose(); canvas.remove(); enemies.clear();
    p.weapons.forEach(w => w.dispose()); p.melee.dispose();
    scene.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  });
  return { p, ctx, hud, enemies, frame, key };
}

test('melee is independent of all five guns, empty ammo, aim and reload', () => {
  const { p, hud, frame, key } = setup();
  for (let slot = 0; slot < 5; slot++) {
    p.switchTo(slot);
    p.weapon.mag = p.weapon.reserve = 0;
    key('KeyF', true); frame();
    expect(p.wi).toBe(slot);
    expect(p.melee.active).toBe(true);
    expect(p.weapon.root.visible).toBe(false);
    expect(hud.scope.shown).toBe(false);
    key('KeyF', false);
    for (let i = 0; i < 60; i++) frame();
    expect(p.wi).toBe(slot);
    expect(p.weapon.root.visible).toBe(true);
    expect(p.weapon.mag).toBe(0);
    expect(p.melee.active).toBe(false);
  }
  const pistol = p.weapon as Gun;
  pistol.resetAmmo(); pistol.mag = 3; pistol.startReload();
  key('KeyV', true); frame(); key('KeyV', false);
  for (let i = 0; i < 130; i++) frame();
  expect(pistol.mag).toBe(15);
  expect(pistol.reserve).toBe(78);
  expect(p.wi).toBe(4);
  key('Digit1', true); frame(); key('Digit1', false); frame();
  expect(p.wi).toBe(0);
  key('KeyF', true); frame();
  key('Digit5', true); frame(); key('Digit5', false); key('KeyF', false);
  for (let i = 0; i < 60; i++) frame();
  expect(p.wi).toBe(4);
  expect(p.weapon.kind).toBe('pistol');
});

test('five digit slots, Digit6 melee and wheel wrap use the same loadout order', () => {
  const { p, frame, key } = setup();
  const kinds = ['r4c', 'rifle', 'shotgun', 'sniper', 'pistol'];
  for (const [slot, kind] of kinds.entries()) {
    key(`Digit${slot + 1}`, true); frame(); key(`Digit${slot + 1}`, false); frame();
    expect(p.wi).toBe(slot);
    expect(p.weapon.kind).toBe(kind);
    expect(p.melee.active).toBe(false);
  }
  key('Digit6', true); frame();
  expect(p.wi).toBe(4);
  expect(p.melee.active).toBe(true);
  key('Digit6', false);
  for (let i = 0; i < 60; i++) frame();
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); frame();
  expect(p.wi).toBe(0);
  expect(p.weapon.kind).toBe('r4c');
  frame();
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); frame();
  expect(p.wi).toBe(4);
  expect(p.weapon.kind).toBe('pistol');
});

test('holding melee guards without stealing aim, and death cancels pending contact', () => {
  const { p, frame, key, hud } = setup();
  key('KeyF', true);
  for (let i = 0; i < 50; i++) frame();
  expect(p.blocking).toBe(true);
  expect(p.aiming).toBe(false);
  expect(hud.scope.shown).toBe(false);
  key('KeyF', false);
  for (let i = 0; i < 50; i++) frame();
  key('KeyF', true); frame();
  p.die(); frame();
  expect(p.melee.active).toBe(false);
  expect(p.melee.root.visible).toBe(false);
  p.reset(new Vector3());
  expect(p.weapon.kind).toBe('r4c');
  expect(p.headshotT).toBe(0);
});

test('melee can hit a prop through its own collider but not through a wall', () => {
  const { ctx } = setup();
  const box = ctx.world.addBox(new Vector3(-0.3, 0, -2.3), new Vector3(0.3, 2, -1.7));
  const prop = { id: 0, kind: 'crate' as const, group: new Group(), hp: 100, alive: true,
    tone: 0, pos: new Vector3(0, 1, -2), box };
  ctx.level.breakables = [prop];
  const props = createBreakables(ctx, {} as PickupsApi);
  const arc = () => props.inArc(new Vector3(0, 1, 0), new Vector3(0, 0, -1), 2.2, Math.cos(0.8));
  expect(arc()).toEqual([prop]);
  ctx.world.addBox(new Vector3(-1, 0, -1.2), new Vector3(1, 2, -0.8));
  expect(arc()).toEqual([]);
});

test('zero-spread shots follow the visible reticle, including camera recoil and bob', () => {
  const { p, ctx } = setup();
  p.pitch = .1; p.yaw = .2; p.bobX = .025;
  p.recoilPitch.set(.08); p.recoilYaw.set(-.04);
  updateCamera(p, 0);
  const shot = p.aimDir(0), visible = ctx.camera.getWorldDirection(new Vector3());
  expect(shot.angleTo(visible)).toBeLessThan(1e-7);
  const endpoint = vi.fn();
  ctx.game.onShot = endpoint;
  (p.weapon as Gun)._ray(shot);
  const projected = (endpoint.mock.calls[0]![0] as Vector3).clone().project(ctx.camera);
  expect(Math.abs(projected.x)).toBeLessThan(1e-7);
  expect(Math.abs(projected.y)).toBeLessThan(1e-7);
});

test('visible boots register hits, and empty space beside a model does not', () => {
  const { enemies } = setup();
  const enemy = enemies.spawn('grunt', new Vector3(0, 0, -8));
  enemy.state = 'hunt'; enemy.root.scale.setScalar(1); enemy.root.rotation.y = 0;
  syncModel(enemy);
  const direction = new Vector3(0, 0, -1);
  const boot = enemies.raycast(new Vector3(.13, .04, 0), direction, 10);
  expect(boot?.enemy).toBe(enemy);
  expect(boot?.part).toBe('shinR');
  expect(enemies.raycast(new Vector3(2, 1, 0), direction, 10)).toBeNull();
});

test('real gun rays keep close-range kill thresholds for recruits and 110 HP online players', () => {
  const { p, ctx, enemies } = setup();
  const victim = setup().p;
  const remote = new RemotePlayer(ctx, 'victim', 'victim');
  cleanups.push(() => remote.dispose());
  // boot.ts resetRun sets online health to 110, not the constructor's solo 120.
  victim.maxHp = 110;
  const cases = [
    { kind: 'r4c', pve: [3, 2], pvp: [5, 3] },
    { kind: 'rifle', pve: [5, 2], pvp: [7, 4] },
    { kind: 'pistol', pve: [3, 1], pvp: [4, 2] },
    { kind: 'sniper', pve: [1, 1], pvp: [2, 1] },
  ];
  for (const row of cases) {
    const gun = p.weapons.find(w => w.kind === row.kind) as Gun;
    expect(gun).toBeDefined();
    for (const [index, part] of ['torso', 'head'].entries()) {
      enemies.clear();
      const enemy = enemies.spawn('grunt', new Vector3(0, 0, -10));
      expect(enemy.hp).toBe(100);
      enemy.state = 'hunt'; enemy.root.scale.setScalar(1); enemy.root.rotation.y = 0;
      syncModel(enemy);
      const hit = enemy.hits.find(h => h.part === part)!;
      ctx.camera.position.copy(hit.center).add(new Vector3(0, 0, 10));
      const direction = new Vector3(0, 0, -1);
      ctx.game.raycastPlayers = () => null;
      expect(enemies.raycast(ctx.camera.position, direction, 300)?.part).toBe(part);
      for (let shot = 1; shot <= row.pve[index]!; shot++) {
        gun._ray(direction);
        expect(enemy.alive, `${row.kind} PvE ${part}, shot ${shot}`).toBe(shot < row.pve[index]!);
      }
      enemies.clear();
      victim.reset(new Vector3(0, 0, -10));
      expect(victim.hp).toBe(110);
      ctx.game.raycastPlayers = () => ({ player: remote, part, dist: 10, point: victim.center.clone() });
      ctx.game.hitPlayer = (target, amount) => { expect(target).toBe(remote); victim.takeDamage(amount); };
      for (let shot = 1; shot <= row.pvp[index]!; shot++) {
        gun._ray(direction);
        expect(victim.alive, `${row.kind} PvP ${part}, shot ${shot}`).toBe(shot < row.pvp[index]!);
      }
    }
  }
});

test('accepted gun headshots give a bounded screen wobble and a brief follow-up bonus', () => {
  const { p, ctx, enemies, hud, frame } = setup();
  const head = { part: 'head', crit: true, source: 'r4c' };
  const enemy = enemies.spawn('shield', new Vector3(0, 0, -10));
  enemies.damage(enemy, 10, { ...head, part: 'shield' });
  expect(hud.hitmarkerState).toMatchObject({ blocked: true, crit: false, killNonce: 0 });
  expect(p.headshotT).toBe(0);
  enemies.damage(enemy, 0, head);
  expect(p.headshotT).toBe(0);
  enemies.damage(enemy, 10, { source: 'rifle', part: 'torso' });
  expect(hud.hitmarkerState).toMatchObject({ blocked: false, crit: false, kill: false });
  enemies.damage(enemy, 10, head);
  expect(hud.hitmarkerState).toMatchObject({ blocked: false, crit: true, kill: false });
  expect(p.headshotT).toBe(0.28);
  const kick = p.headshotRoll.vel;
  for (let i = 0; i < 10; i++) p.onHeadshot(head);
  expect(p.headshotRoll.vel).toBe(kick);
  const aim = p.forward.clone();
  updateCamera(p, 0.016);
  expect(Math.abs(ctx.camera.rotation.z)).toBeGreaterThan(0);
  expect(Math.abs(ctx.camera.rotation.z)).toBeLessThan(0.01);
  expect(p.forward.equals(aim)).toBe(true);

  const gun = p.weapon as Gun, st = { ...p.weaponState(), fire: true, firePressed: true };
  for (let i = 0; i < 70; i++) frame(); // wait out the draw
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  p.headshotT = 0; gun.resetAmmo(); p.pitch = 0; gun.animate(st, 0);
  const normalKick = p.pitch, normalSpread = gun.spreadPx;
  p.headshotT = 0.28; gun.resetAmmo(); p.pitch = 0; gun.animate(st, 0);
  expect(p.pitch).toBeCloseTo(normalKick * 0.6);
  expect(gun.spreadPx).toBeLessThan(normalSpread);
  for (let i = 0; i < 60; i++) updateCamera(p, 0.01);
  expect(p.headshotT).toBe(0);
  expect(Math.abs(p.headshotRoll.value)).toBeLessThan(0.0001);
  p.onHeadshot({ ...head, source: 'focus' });
  p.onHeadshot({ ...head, part: 'torso' });
  expect(p.headshotT).toBe(0);
});

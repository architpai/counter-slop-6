import { afterEach, expect, test, vi } from 'vitest';
import { Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Player } from '@/engine/player/index';
import { updateCamera } from '@/engine/player/camera';
import { EnemyManager } from '@/engine/enemies/index';
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
    effects: { shake: 0, tracer: noop, strokeBurst: noop, smoke: noop, shell: noop, blood: noop, sparks: noop },
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

test('melee is independent of all four guns, empty ammo, aim and reload', () => {
  const { p, hud, frame, key } = setup();
  for (let slot = 0; slot < 4; slot++) {
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
  expect(p.wi).toBe(3);
  key('Digit1', true); frame(); key('Digit1', false); frame();
  expect(p.wi).toBe(0);
  key('KeyF', true); frame();
  key('Digit4', true); frame(); key('Digit4', false); key('KeyF', false);
  for (let i = 0; i < 60; i++) frame();
  expect(p.wi).toBe(3);
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
  expect(p.weapon.kind).toBe('rifle');
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

test('accepted gun headshots give a bounded screen wobble and a brief follow-up bonus', () => {
  const { p, ctx, enemies } = setup();
  const head = { part: 'head', crit: true, source: 'rifle' };
  const enemy = enemies.spawn('shield', new Vector3(0, 0, -10));
  enemies.damage(enemy, 10, { ...head, part: 'shield' });
  expect(p.headshotT).toBe(0);
  enemies.damage(enemy, 0, head);
  expect(p.headshotT).toBe(0);
  enemies.damage(enemy, 10, head);
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

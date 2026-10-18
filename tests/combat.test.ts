import { afterEach, expect, test, vi } from 'vitest';
import { Group, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Player } from '@/engine/player/index';
import { RemotePlayer } from '@/engine/players';
import { updateCamera } from '@/engine/player/camera';
import { updateGrapple } from '@/engine/player/grapple';
import { updateGrenades } from '@/engine/player/grenades';
import { integrateMovement } from '@/engine/player/movement';
import { EnemyManager } from '@/engine/enemies/index';
import { syncModel } from '@/engine/enemies/model';
import { Input } from '@/engine/input';
import { Audio } from '@/engine/audio';
import { HudStore } from '@/engine/hud/store';
import { World } from '@/engine/physics';
import { Gun } from '@/engine/weapons/index';
import { createBreakables } from '@/engine/game/breakables';
import { spawnProjectile } from '@/engine/enemies/projectiles';
import { updateWaves, WAVE_DAMAGE } from '@/engine/weapons/wave';
import type { PickupsApi } from '@/engine/game/pickups';
import type { Ctx, Projectile } from '@/engine/types';

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
    effects: { shake: 0, tracer: noop, bulletTracer: noop, strokeBurst: noop, smoke: noop, muzzleSmoke: noop, muzzleLight: noop, muzzleFlash: noop, shell: noop, blood: noop, sparks: noop,
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
    p.disposeWeapons();
    scene.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  });
  return { p, ctx, hud, enemies, frame, key };
}

test('replicated grenades are visual only; own grenades still hurt the thrower', () => {
  const { p, ctx } = setup();
  ctx.effects.boom = vi.fn(); ctx.game.blastBreakables = vi.fn(); ctx.remotes = new Map();
  p.throwGrenade({ pos: [0, 0, 0], vel: [0, 0, 0] });
  const remote = p.nades[0]!;
  remote.pos.copy(p.center); remote.rest = true; remote.fuse = 0;
  updateGrenades(p, 0, false);
  expect(p.hp).toBe(120);
  expect(p.body.vel.length()).toBe(0);
  p.throwGrenade();
  const own = p.nades[0]!;
  own.pos.copy(p.center); own.rest = true; own.fuse = 0;
  updateGrenades(p, 0, false);
  expect(p.hp).toBeLessThan(120);
  expect(p.body.vel.length()).toBeGreaterThan(0);
});

test('team out-of-bounds death uses the wave instead of teleporting a flag carrier', () => {
  const { p, ctx } = setup();
  ctx.game.isOnline = () => true;
  ctx.game.onPlayerDeath = vi.fn();
  p.team = 1; p.body.pos.y = -20; p.lastHitBy = 'old attacker';
  integrateMovement(p, 0.01);
  expect(p.alive).toBe(false);
  expect(p.lastHitBy).toBeNull();
  expect(ctx.game.onPlayerDeath).toHaveBeenCalledOnce();
  expect(p.body.pos.y).toBeLessThan(-12);
});

test('the grapple awards a yank only when the moderator cast window accepts it', () => {
  const { p, ctx, enemies } = setup(), score = vi.fn(); ctx.game.addScore = score;
  const boss = enemies.spawn('moderator', new Vector3(0, 8, -10));
  const attach = () => {
    p.grapple.mode = 'fly'; p.grapple.enemy = boss;
    p.grapple.flyTime = 1; p.grapple.flyDuration = 0.1;
    updateGrapple(p, 0.01);
  };
  attach(); expect(score).not.toHaveBeenCalled(); expect(boss.state).not.toBe('stunned');
  boss.yankableT = 2; attach();
  expect(score).toHaveBeenCalledExactlyOnceWith(30, 'YANKED');
  expect(boss.state).toBe('stunned'); expect(boss.body.vel.y).toBeLessThan(0);
  attach(); expect(score).toHaveBeenCalledTimes(1);
});

test('a loadout is three slots: digits past it do nothing, the wheel wraps, and a new pick keeps kept ammo', () => {
  const { p, frame, key } = setup();
  expect(p.loadout).toEqual(['r4c', 'pistol', 'sword']);
  for (const [slot, kind] of ['r4c', 'pistol', 'sword'].entries()) {
    key(`Digit${slot + 1}`, true); frame(); key(`Digit${slot + 1}`, false); frame();
    expect(p.wi).toBe(slot);
    expect(p.weapon.kind).toBe(kind);
  }
  key('Digit4', true); frame(); key('Digit4', false); frame();
  expect(p.wi).toBe(2);
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); frame();
  expect(p.weapon.kind).toBe('r4c');
  frame();
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); frame();
  expect(p.weapon.kind).toBe('sword');
  expect(p.setLoadout(['lmg', 'lmg', 'sword'])).toBe(false);
  expect(p.setLoadout(['lmg', 'sword'])).toBe(false);
  expect(p.loadout).toEqual(['r4c', 'pistol', 'sword']);
  const pistol = p.weapons[1] as Gun;
  pistol.mag = 3;
  expect(p.setLoadout(['lmg', 'pistol', 'sniper'])).toBe(true);
  expect(p.loadout).toEqual(['lmg', 'pistol', 'sniper']);
  expect(p.weapons[1]).toBe(pistol);
  expect(pistol.mag, 'a weapon kept in the loadout keeps its ammo').toBe(3);
  expect(p.weapons[0]!.mag).toBe(100);
  expect(p.wi).toBe(0);
  expect(p.sword).toBeNull();
});

test('the melee key draws the sword and slashes; without a sword it does nothing', () => {
  const { p, frame, key, hud } = setup();
  p.weapon.mag = 0;
  key('KeyF', true); frame(); key('KeyF', false);
  expect(p.holdingSword).toBe(true);
  expect(p.sword?.slashing).toBe(true);
  expect(hud.scope.shown).toBe(false);
  for (let i = 0; i < 60; i++) frame();
  expect(p.sword?.slashing).toBe(false);
  p.setLoadout(['r4c', 'rifle', 'lmg']);
  key('KeyV', true); frame(); key('KeyV', false); frame();
  expect(p.wi).toBe(0);
  expect(p.weapon.kind).toBe('r4c');
});

test('the sword guards without zooming, holding fire chains slashes, and death clears it', () => {
  const { p, frame } = setup();
  const mouse = (button: number, down: boolean) => window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button }));
  p.switchTo(2, true);
  for (let i = 0; i < 40; i++) frame();
  mouse(2, true);
  for (let i = 0; i < 30; i++) frame();
  expect(p.blocking).toBe(true);
  expect(p.weapon.aimAmt).toBe(0);
  expect(p.weapon.adsFov).toBe(82);
  mouse(2, false);
  for (let i = 0; i < 10; i++) frame();
  expect(p.blocking).toBe(false);
  mouse(0, true);
  let slashes = 0, was = false;
  for (let i = 0; i < 100; i++) { frame(); const now = !!p.sword?.slashing; if (now && !was) slashes++; was = now; }
  mouse(0, false);
  expect(slashes, 'one second of held fire is two or three slashes').toBeGreaterThanOrEqual(2);
  p.die(); frame();
  expect(p.sword?.active).toBe(false);
  p.reset(new Vector3());
  expect(p.weapon.kind).toBe('r4c');
  expect(p.headshotT).toBe(0);
});

test('the weapon in hand sets the pace: sword fastest, LMG slowest and lowest jump', () => {
  const { p } = setup();
  const speed = (kind: string) => { p.setLoadout(kind === 'sword' ? ['sword', 'pistol', 'r4c'] : [kind as 'lmg', 'pistol', 'sword']); return p.weapon.moveSpeed; };
  const order = ['sword', 'pistol', 'rifle', 'shotgun', 'r4c', 'sniper', 'lmg'].map(speed);
  expect([...order].sort((a, b) => b - a)).toEqual(order);
  expect(speed('rifle')).toBeGreaterThan(speed('r4c'));
  speed('lmg');
  expect(p.weapon.mobility).toBeLessThan(1);
});

test('walking pace follows the weapon in hand: about 7.6 m/s with the sword, 5.4 with the LMG', () => {
  const { p, ctx, key } = setup();
  ctx.world.addBox(new Vector3(-100, -1, -100), new Vector3(100, 0, 100)); ctx.world.finalize();
  const pace = (kinds: ['sword' | 'lmg', 'pistol', 'r4c']) => {
    p.setLoadout(kinds); p.reset(new Vector3());
    key('KeyW', true);
    for (let i = 0; i < 120; i++) { ctx.input.update(1 / 60); p.update(1 / 60); }
    key('KeyW', false);
    return Math.hypot(p.body.vel.x, p.body.vel.z);
  };
  expect(pace(['sword', 'pistol', 'r4c'])).toBeCloseTo(6.6 * 1.15, 1);
  expect(pace(['lmg', 'pistol', 'r4c'])).toBeCloseTo(6.6 * 0.82, 1);
});

test('an air slash flies about 12 m: it cuts an enemy at 10 m but not at 16 m, and cuts bolts in its path', () => {
  const { p, enemies } = setup();
  p.body.pos.set(0, 0, 0); p.yaw = p.pitch = 0;
  const close = enemies.spawn('grunt', new Vector3(0.5, 0, -10)), far = enemies.spawn('grunt', new Vector3(-0.5, 0, -16));
  for (const e of [close, far]) e.state = 'hunt';
  const bolt = spawnProjectile(enemies, new Vector3(0, 1.4, -6), new Vector3(0, 0, 1), 0.001, 10, null, 0, 0.2, false);
  p.switchTo(2, true);
  expect(p.sword?.startSlash({ ...p.weaponState(), grounded: false })).toBe(true);
  expect(p.waves.length).toBe(1);
  for (let i = 0; i < 60; i++) updateWaves(p, 1 / 60);
  expect(p.waves.length, 'the wave is gone after its range').toBe(0);
  expect(close.hp).toBe(close.maxHp - WAVE_DAMAGE);
  expect(far.hp).toBe(far.maxHp);
  expect(enemies.projectiles).not.toContain(bolt);
});

test('the middle of a slash cuts bolts from the front and always returns them', () => {
  const { p } = setup();
  p.switchTo(2, true);
  const sword = p.sword!;
  const bolt = (vz = 30) => ({ pos: p.eye.clone().add(new Vector3(0, 0, -0.8)), vel: new Vector3(0, 0, vz) }) as Projectile;
  expect(p.tryDeflect(bolt())).toBe(false);
  sword.startSlash(p.weaponState());
  for (let i = 0; i < 8; i++) sword.animate(p.weaponState(), 0.01);
  expect(p.slashCutting()).toBe(true);
  expect(p.blockRadius).toBe(1.2);
  expect(p.tryDeflect(bolt())).toEqual({ perfect: true, returned: true });
  expect(p.tryDeflect(bolt()), 'a slash cuts more than one bolt').toEqual({ perfect: true, returned: true });
  expect(p.tryDeflect(bolt(-30)), 'never one from behind').toBe(false);
  for (let i = 0; i < 20; i++) sword.animate(p.weaponState(), 0.01);
  expect(p.slashCutting()).toBe(false);
  expect(p.slashCutting(true), 'online the window stays open a little longer').toBe(true);
  expect(p.tryDeflect(bolt())).toBe(false);
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
    { kind: 'r4c', pve: [4, 2], pvp: [5, 3] },
    { kind: 'rifle', pve: [5, 2], pvp: [7, 4] },
    { kind: 'pistol', pve: [3, 1], pvp: [3, 2] },
    { kind: 'sniper', pve: [1, 1], pvp: [2, 1] },
  ];
  for (const row of cases) {
    const gun = p._arm(row.kind as 'r4c') as Gun;
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

test('ADS look sensitivity tracks the aimed FOV, holo stays hip speed', () => {
  const { p, ctx } = setup();
  const r4c = p.weapon as Gun;
  // `input.update` clears `look`, so write it after and read the yaw the same frame.
  const yawDelta = (aiming: boolean): number => {
    ctx.input.update(1 / 60);
    ctx.input.look.x = 0.01;
    p.aiming = aiming;
    const before = p.yaw;
    p.update(1 / 60);
    return p.yaw - before;
  };
  const hip = yawDelta(false);
  expect(hip).toBeCloseTo(0.01, 12);
  r4c.setOptic('holo');
  expect(yawDelta(true) / hip).toBeCloseTo(1, 6);
  r4c.setOptic('acog');
  const acog = Math.tan(38 * Math.PI / 360) / Math.tan(82 * Math.PI / 360) * ctx.input.acogScale;
  expect(yawDelta(true) / hip).toBeCloseTo(acog, 6);
});

test('the holo hood lags a turn at any frame rate, kicks with a shot, rises into place, and the HUD gets the drift', () => {
  const { p, hud } = setup();
  const gun = p.weapon as Gun;
  gun.setOptic('holo');
  const still = { ...p.weaponState(), aim: true, blockFire: true, lookDelta: { x: 0, y: 0 } };
  let lifted = false;
  for (let i = 0; i < 90; i++) {
    gun.animate(still, 1 / 60);
    if (gun.aimAmt >= 0.8 && gun.aimAmt < 0.9) lifted = gun.sightY > 12 && gun.sightScale > 1.03;
  }
  expect(lifted, 'below the eye line and nearer just as the overlay comes in').toBe(true);
  expect(Math.abs(gun.sightX)).toBeLessThan(0.5);
  expect(Math.abs(gun.sightY)).toBeLessThan(0.5);
  // A turn to the right at 1.8 rad/s: the hood trails left, the same at 60 and 120 frames a second.
  const turn = (fps: number): number => {
    gun._resetPose(); gun.aimAmt = 1;
    for (let i = 0; i < fps; i++) gun.animate({ ...still, lookDelta: { x: -1.8 / fps, y: 0 } }, 1 / fps);
    return gun.sightX;
  };
  expect(turn(60)).toBeCloseTo(-9.72, 0);
  expect(turn(120)).toBeCloseTo(turn(60), 1);
  gun._resetPose(); gun.aimAmt = 1;
  gun.kickPos(0, 0.3, 2.5);
  for (let i = 0; i < 4; i++) gun.animate(still, 1 / 60);
  expect(gun.sightY, 'the shot lifts the hood').toBeLessThan(-1.5);
  expect(gun.sightScale, 'and pushes it back to the eye').toBeGreaterThan(1.005);
  const root = document.createElement('div');
  hud.bindRoot(root);
  hud.setScopeDrift(12.34, -5, 1.0234);
  expect([root.style.getPropertyValue('--scope-x'), root.style.getPropertyValue('--scope-y'), root.style.getPropertyValue('--scope-scale')])
    .toEqual(['12.3', '-5.0', '1.023']);
});

test('a spectator through a teammate\'s eyes holds their gun, aims with them, and never fires', () => {
  const { p, ctx, hud } = setup();
  p.takeDamage(9999);
  expect(p.alive).toBe(false);
  p.watched = { kind: 'sniper', aim: true };
  for (let i = 0; i < 60; i++) { ctx.input.update(1 / 60); p.update(1 / 60); }
  // No sniper in this loadout: one is lent to the view, and the loadout's own stays put.
  const sniper = p.view as Gun;
  expect(p.loadout).not.toContain('sniper');
  expect(sniper.kind).toBe('sniper');
  expect(p.weapon.root.visible).toBe(false);
  expect(sniper.aimAmt).toBeGreaterThan(0.95);
  expect(hud.scope).toEqual({ shown: true, kind: 'sniper' });
  const mag = sniper.mag;
  sniper.echoShot();
  for (let i = 0; i < 5; i++) { ctx.input.update(1 / 60); p.update(1 / 60); }
  expect(sniper.mag, 'a watched shot costs nothing').toBe(mag);
  // Back to the shoulder view: the lent gun goes, the loadout's own comes back, and the scope goes.
  p.watched = null;
  for (let i = 0; i < 60; i++) { ctx.input.update(1 / 60); p.update(1 / 60); }
  expect(p.view).toBe(p.weapon);
  expect(sniper.root.visible).toBe(false);
  expect(hud.scope.shown).toBe(false);
});

test('ground friction is independent of frame rate', () => {
  const { p, ctx } = setup();
  ctx.world.addBox(new Vector3(-100, -1, -100), new Vector3(100, 0, 100)); ctx.world.finalize();
  const measure = (dt: number): number => {
    p.reset(new Vector3()); ctx.input.update(dt); p.update(dt);
    expect(p.body.onGround).toBe(true);
    p.body.vel.set(10, 0, 0);
    for (let i = 0; i < Math.round(1 / dt); i++) { ctx.input.update(dt); p.update(dt); }
    return Math.hypot(p.body.vel.x, p.body.vel.z);
  };
  const slow = measure(1 / 20), fast = measure(1 / 120);
  expect(Math.abs(slow - fast) / Math.max(slow, fast)).toBeLessThan(0.05);
});

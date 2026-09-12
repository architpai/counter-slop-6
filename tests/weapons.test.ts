import { afterAll, expect, test } from 'vitest';
import { Group, Mesh, MeshToonMaterial, Vector3 } from 'three';
import { Gun, Melee, GUN_STATS, makeLoadout } from '@/engine/weapons/index';
import type { GunKind } from '@/engine/weapons/index';
import type { Breakable, Ctx, Player, WeaponState } from '@/engine/types';
import type { Box } from '@/engine/physics';

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-7;
const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
};

interface Call { name: string; args: unknown[] }
const calls: Call[] = [];
const record = (name: string) => (...args: unknown[]): void => { calls.push({ name, args }); };
const named = (name: string) => calls.filter(call => call.name === name);
const last = (name: string): unknown[] | undefined => named(name).at(-1)?.args;
/** Recorded arguments come back as `unknown`; these read one without `any`. */
const num = (v: unknown): number | undefined => typeof v === 'number' ? v : undefined;
const info = (v: unknown): { part?: string; crit?: boolean } =>
  typeof v === 'object' && v !== null ? v : {};
const vec = (v: unknown): Vector3 => v instanceof Vector3 ? v : new Vector3(NaN, NaN, NaN);

const neutral: WeaponState = { fire: false, firePressed: false, aim: false, reloadPressed: false,
  meleePressed: false, sprinting: false, grounded: true, speed: 0, sliding: false,
  lookDelta: { x: 0, y: 0 }, strafe: 0, bobPhase: 0, bobAmt: 0, landDip: 0, slideTilt: 0, blockFire: false };
const fire: WeaponState = { ...neutral, fire: true, firePressed: true };

interface Foe { center: Vector3 }
interface Prop { pos: Vector3 }
interface EnemyHit { enemy: Foe; part: string; dist: number; point: Vector3 }
interface WorldHit { dist: number; point: Vector3; normal: Vector3; box: { data: Box['data'] } }
interface PlayerHitLike { player: Foe; part: string; dist: number; point: Vector3 }

// The slice of `Ctx` a weapon touches. A real one needs WebGL, a level and a net peer.
const ctx = {
  renderer: { rig: new Group() },
  input: { rumble: record('rumble') },
  audio: Object.fromEntries(['shot', 'mp5Fire', 'pistolFire', 'shotgunFire', 'sniperFire', 'revolver', 'reload', 'shellCue', 'cylinder',
    'empty', 'pump', 'ricochet', 'katanaSwing', 'katanaHit'].map(name => [name, record(name)])),
  effects: { shake: 0, ...Object.fromEntries(['strokeBurst', 'smoke', 'shell', 'bulletImpact'].map(name => [name, record(name)])),
    tracer: (a: Vector3, b: Vector3, ...args: unknown[]) => calls.push({ name: 'tracer', args: [a.clone(), b.clone(), ...args] }) },
  enemies: {
    raycast: ((() => null) as () => EnemyHit | null),
    inArc: ((() => []) as () => { enemy: Foe; dist: number }[]),
    damage: record('enemyDamage'),
  },
  world: {
    lineOfSight: () => true,
    raycast: (((eye: Vector3, dir: Vector3, max: number, ignore: (b: Box) => boolean) => {
      assert(max === 300 && ignore({ min: new Vector3(), max: new Vector3(), id: 0, data: { noShoot: true } }),
        'Guns trace 300 m and skip noShoot boxes');
      return null;
    }) as (eye: Vector3, dir: Vector3, max: number, ignore: (b: Box) => boolean) => WorldHit | null),
  },
  game: {
    raycastPlayers: ((() => null) as () => PlayerHitLike | null),
    playersInArc: ((() => []) as () => Foe[]),
    breakablesInArc: ((() => []) as () => Prop[]),
    cutRopes: () => false,
    hitPlayer: record('playerDamage'), breakHit: record('breakHit'), hitstop: record('hitstop'),
    onShot: (point: Vector3) => calls.push({ name: 'onShot', args: [point.clone()] }),
  },
};

const player = { eye: new Vector3(2, 3, 4), forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
  recoil: record('recoil'), kickFov: record('kickFov'), lunge: record('lunge'),
  aimDir: (spread: number, out: Vector3) => { calls.push({ name: 'spread', args: [spread] }); return out.copy(player.forward); } };

const engineCtx = ctx as unknown as Ctx;
const enginePlayer = player as unknown as Player;
const loadout = makeLoadout(engineCtx, enginePlayer), revolver = new Gun(engineCtx, enginePlayer, 'revolver');
const gunAt = (i: number): Gun => {
  const weapon = loadout[i];
  if (!(weapon instanceof Gun)) throw new Error(`slot ${i} is not a gun`);
  return weapon;
};
const rifle = gunAt(0), shotgun = gunAt(1), sniper = gunAt(2), pistol = gunAt(3);
const melee = new Melee(engineCtx, enginePlayer);
const all = [...loadout, revolver, melee];
const step = (weapon: { animate(st: WeaponState, dt: number): void }, duration: number, state: WeaponState = neutral) => {
  for (let left = duration; left > 1e-9;) { const dt = Math.min(0.01, left); weapon.animate(state, dt); left -= dt; }
};

afterAll(() => { for (const weapon of all) weapon.dispose(); });

test('loadout, view models and aim poses', () => {
  assert(loadout.map(w => w.kind).join(',') === 'rifle,shotgun,sniper,pistol', 'Loadout keeps four guns and independent melee');
  assert(melee instanceof Melee && melee.spreadPx === 4 && !melee.isGun, 'Melee exposes its independent state');
  const muzzleZ: Record<GunKind, number> = { rifle: -0.96, pistol: -0.42, shotgun: -1.09, sniper: -1.60, revolver: -0.40 };
  const expected: Record<GunKind, number[]> = { rifle: [30, 150, 300, 22, 25, 0.075], pistol: [15, 90, 180, 34, 62, 0.18], shotgun: [6, 36, 72, 19, 68, 0.78],
    sniper: [5, 25, 50, 150, 20, 0.20], revolver: [6, 36, 72, 62, 52, 0.30] };
  for (const gun of [rifle, pistol, shotgun, sniper, revolver]) {
    const stats = GUN_STATS[gun.kind], actual = [gun.mag, gun.reserve, stats.maxReserve, stats.damage, gun.adsFov, stats.fireInterval];
    assert(actual.every((v, i) => near(v, must(expected[gun.kind][i], 'expected value'))), `${gun.kind} uses the documented combat values`);
    assert(!gun.root.visible && gun.root.scale.toArray().every(v => v === 0.46), `${gun.kind} starts hidden at scale 0.46`);
    assert(near(must(gun.root.getObjectByName('muzzle'), 'muzzle').position.z, muzzleZ[gun.kind]), `${gun.kind} uses the documented muzzle anchor`);
    assert(must(gun.root.getObjectByName('muzzle-flash'), 'flash').children.length === 3, `${gun.kind} has three flash stars`);
    gun.equip();
    step(gun, 1);
    assert(gun.root.position.distanceTo(new Vector3(...stats.restPos)) < 1e-8, `${gun.kind} raises to its camera-space rest position`);
    step(gun, 2, { ...neutral, aim: true });
    const sight = gun.root.localToWorld(new Vector3(...stats.sight));
    assert(sight.distanceTo(new Vector3(0, 0, -stats.eyeDistance)) < 1e-7, `${gun.kind} sight aligns on the camera axis without double scaling`);
    assert(gun.root.visible !== gun.scope, `${gun.kind} applies the scope model visibility rule`);
    gun.addAmmo(10000);
    assert(gun.reserve === stats.maxReserve, `${gun.kind} reserve is capped`);
    gun.resetAmmo();
    gun.unequip();
  }
  assert(ctx.renderer.rig.scale.x === 1, 'Shared rig scale stays at one');
  const receiver = must(rifle.root.getObjectByName('receiver'), 'receiver');
  if (!(receiver instanceof Mesh)) throw new Error('receiver is not a mesh');
  const geometry = receiver.geometry;
  geometry.computeBoundingBox();
  assert(must(geometry.boundingBox, 'bounding box').getSize(new Vector3()).distanceTo(new Vector3(0.10, 0.13, 0.48)) < 1e-7, 'MP5 uses its compact receiver dimensions');
  assert(must(revolver.root.getObjectByName('cylinder'), 'cylinder').children.length === 7, 'Revolver has a drum and six chambers');
  const fist = must(rifle.root.getObjectByName('right-hand-fist'), 'fist'), forearm = must(rifle.root.getObjectByName('right-hand-forearm'), 'forearm');
  if (!(fist instanceof Mesh) || !(forearm instanceof Mesh)) throw new Error('hand parts are not meshes');
  const fistColor = (fist.material as MeshToonMaterial).color.getHex(), sleeveColor = (forearm.material as MeshToonMaterial).color.getHex();
  assert(fistColor !== sleeveColor, 'Fists use a distinct tone from the sleeve');
  assert(rifle.root.getObjectByName('acog-tube') && !rifle.root.getObjectByName('sight-ring'), 'MP5 has an ACOG, not a holo sight');
  assert(rifle.root.getObjectByName('magazine-lower'), 'MP5 magazine has a curved lower section');
  const blade = must(melee.root.getObjectByName('blade'), 'blade');
  if (!(blade instanceof Mesh)) throw new Error('blade is not a mesh');
  assert((blade.material as MeshToonMaterial).color.getHex() === 0xcbdbe3, 'Knife blade uses pale cool steel');
});

test('rifle magazine reload and firing', () => {
  rifle.equip();
  rifle.mag = 7;
  rifle.startReload();
  step(rifle, 1.64, fire);
  assert(rifle.mag === 7 && rifle.reloading, 'Magazine reload cannot fire or transfer rounds early');
  rifle.animate(fire, 0.01);
  assert(rifle.mag === 30 && rifle.reserve === 127 && !rifle.reloading, 'MP5 reload tops up at 1.65 s and consumes the completion frame');
  rifle.resetAmmo();
  calls.length = 0;
  rifle.animate(fire, 0);
  assert(rifle.mag === 29 && near(num(must(last('spread'), 'spread call')[0]), 0.016), 'MP5 samples spread before its shot kick');
  assert(near(rifle.spreadPx, 5 + 0.021 * 900), 'MP5 bloom updates the HUD gap');
  const tracer = must(last('tracer'), 'tracer call');
  assert(vec(tracer[1]).distanceTo(player.eye.clone().addScaledVector(player.forward, 300)) < 1e-7, 'Hitscan starts at the eye');
  assert(vec(tracer[0]).distanceTo(must(rifle.root.getObjectByName('muzzle'), 'muzzle').getWorldPosition(new Vector3())) < 1e-7, 'Tracer starts at the model muzzle');
  rifle.animate({ ...neutral, blockFire: true }, 0.2);
  assert(rifle.mag === 29, 'A neutral dead frame does not fire');
  rifle.unequip();
  const frozenPose = rifle.root.position.clone();
  rifle.animate(fire, 0.2);
  assert(rifle.mag === 29 && rifle.root.position.equals(frozenPose) && !rifle.root.visible, 'Holstered state does not advance or fire');
});

test('shotgun shell loading and the pump cycle', () => {
  shotgun.equip();
  shotgun.mag = 0;
  shotgun.startReload();
  step(shotgun, 0.44);
  assert(shotgun.mag === 0, 'A shell is not inserted before 0.45 s');
  shotgun.animate(neutral, 0.01);
  assert(shotgun.mag === 1 && shotgun.reserve === 35 && shotgun.reloading, 'Shell reload inserts one round per 0.45 s');
  calls.length = 0;
  shotgun.animate(fire, 0);
  assert(!shotgun.reloading && shotgun.mag === 0 && named('tracer').length === 10, 'Fire interrupts shell loading and traces ten pellets');
  shotgun.animate({ ...neutral, reloadPressed: true }, 0.01);
  assert(!shotgun.reloading, 'Manual reload is locked during the pump');
  assert(must(shotgun.root.getObjectByName('fore-end'), 'fore-end').position.z < -0.46, 'Pump starts in its documented negative-time pose');
  step(shotgun, 0.56);
  assert(named('shell').length === 1 && near(must(shotgun.root.getObjectByName('fore-end'), 'fore-end').position.z, -0.46), 'Pump ejects once and returns its fore-end');
});

test('revolver cylinder reload', () => {
  revolver.equip();
  revolver.mag = 2;
  calls.length = 0;
  revolver.startReload();
  step(revolver, 0.58, fire);
  assert(revolver.mag === 2 && named('shellCue').length === 1 && named('shell').length === 0, 'Cylinder eject event plays once without visible casings');
  step(revolver, 1.32, fire);
  assert(revolver.mag === 6 && revolver.reserve === 32 && !revolver.reloading, 'Cylinder fills at 1.9 s without accepting fire');
  assert(must(revolver.root.getObjectByName('cylinder'), 'cylinder').rotation.z === 0, 'Cylinder returns to rest');
});

test('hitscan routing between players, props, enemies and the world', () => {
  const foe: Foe = { center: new Vector3(0, 1, -3) }, remote: Foe = { center: new Vector3(0, 1, -2) }, prop: Prop = { pos: new Vector3(0, 1, -1) };
  let enemyHit: EnemyHit | null = { enemy: foe, part: 'head', dist: 20, point: new Vector3(0, 0, -20) };
  const worldHit: WorldHit = { dist: 30, point: new Vector3(0, 0, -30), normal: new Vector3(0, 0, 1), box: { data: {} } };
  let liveWorldHit: WorldHit | null = worldHit;
  let playerHit: PlayerHitLike | null = { player: remote, part: 'blade', dist: 10, point: new Vector3(0, 0, -10) };
  ctx.enemies.raycast = () => enemyHit;
  ctx.world.raycast = () => liveWorldHit;
  ctx.game.raycastPlayers = () => playerHit;
  const rayShot = () => { rifle.resetAmmo(); rifle.equip(); calls.length = 0; rifle.animate(fire, 0); };
  rayShot();
  assert(num(must(last('playerDamage'), 'playerDamage')[1]) === 18 && info(must(last('playerDamage'), 'playerDamage')[2]).part === 'blade' && !last('enemyDamage'), 'Closest remote blade routes unchanged to the PvP handler');
  playerHit = null;
  worldHit.dist = 5; worldHit.box.data.breakable = prop as unknown as Breakable;
  rayShot();
  assert(num(must(last('breakHit'), 'breakHit')[1]) === 22 && !last('enemyDamage'), 'Closer prop receives unscaled base damage');
  worldHit.dist = 30;
  rayShot();
  assert(near(num(must(last('enemyDamage'), 'enemyDamage')[1]), 57.2 * (1 - 2 / 37)) && info(must(last('enemyDamage'), 'enemyDamage')[2]).crit, 'Closer enemy head receives rifle head damage');
  enemyHit = { enemy: foe, part: 'shield', dist: 20, point: new Vector3(0, 0, -20) };
  rayShot();
  assert(info(must(last('enemyDamage'), 'enemyDamage')[2]).part === 'shield' && near(num(must(last('enemyDamage'), 'enemyDamage')[1]), 22 * (1 - 2 / 37)), 'Shield damage routes unchanged to the enemy handler');
  enemyHit = null; worldHit.box.data = {};
  rayShot();
  assert(named('bulletImpact').length === 1 && !last('enemyDamage'), 'Solid world hit creates an impact');
  liveWorldHit = null;
  enemyHit = { enemy: foe, part: 'head', dist: 32, point: new Vector3(0, 0, -32) };
  shotgun.resetAmmo(); calls.length = 0; shotgun.animate(fire, 0);
  assert(named('enemyDamage').length === 10 && near(num(must(last('enemyDamage'), 'enemyDamage')[1]), 19 * 1.8 * 0.22), 'Shotgun applies per-pellet headshot and falloff floor');
  assert(num(must(last('hitstop'), 'hitstop')[0]) === 0.03 && num(must(last('hitstop'), 'hitstop')[1]) === 0.3, 'Shotgun hit applies its own hit-stop');
  enemyHit = null;
});

test('melee guard, single strikes, obstruction and blade blood', () => {
  const foe: Foe = { center: new Vector3(0, 1, -2) }, remote: Foe = { center: new Vector3(0, 1, -2) }, prop: Prop = { pos: new Vector3(0, 1, -1) };
  melee.equip();
  calls.length = 0;
  melee.animate({ ...neutral, aim: true }, 0.05);
  assert(melee.blocking && near(melee.blockT, 0.05), 'Held melee raises the guard');
  melee.animate({ ...neutral, blockFire: true }, 0.05);
  assert(!melee.blocking && !melee.root.visible, 'Dead state clears melee');
  ctx.enemies.inArc = () => [{ enemy: foe, dist: 2 }];
  ctx.game.playersInArc = () => [remote];
  ctx.game.breakablesInArc = () => [prop];
  melee.startSlash(neutral);
  step(melee, 0.08);
  assert(!last('enemyDamage'), 'Melee damage waits for contact');
  step(melee, 0.01);
  assert(num(must(last('enemyDamage'), 'enemyDamage')[1]) === 75 && num(must(last('playerDamage'), 'playerDamage')[1]) === 55 && num(must(last('breakHit'), 'breakHit')[1]) === 75, 'Melee routes enemy, player and prop damage');
  step(melee, 0.3, { ...neutral, fire: true });
  assert(named('enemyDamage').length === 1 && melee.combo === 1, 'One strike hits once; holding gun fire does not chain it');
  ctx.world.lineOfSight = () => false;
  melee.startSlash(neutral); step(melee, 0.1);
  assert(named('enemyDamage').length === 1, 'A knife cannot hit an enemy through a wall');
  ctx.world.lineOfSight = () => true;
  melee.addBlood(0.84); melee.animate(neutral, 0);
  const smears = melee.root.children.filter(child => child.name.startsWith('blood-smear-'));
  assert(smears.length === 6 && smears.filter(smear => smear.visible).length === 5, 'Blood follows the knife smear thresholds');
  melee.resetAmmo();
  assert(melee.blood === 0 && melee.combo === 0 && !melee.active && smears.every(smear => !smear.visible), 'Reset clears melee state');
  ctx.enemies.inArc = () => [];
  ctx.game.playersInArc = () => [];
  ctx.game.breakablesInArc = () => [];
});

test('pistol fires once per press, cycles its slide and reloads', () => {
  pistol.resetAmmo(); pistol.equip(); calls.length = 0;
  pistol.animate(fire, 0);
  assert(pistol.mag === 14 && named('pistolFire').length === 1, 'Pistol fires on the trigger edge');
  const slide = must(pistol.root.getObjectByName('slide'), 'slide');
  assert(slide.position.z > -0.10, 'Slide recoils on firing');
  step(pistol, 0.3, { ...neutral, fire: true });
  assert(pistol.mag === 14 && near(slide.position.z, -0.10), 'Held trigger does not auto-fire and the slide returns');
  pistol.animate(fire, 0);
  assert(pistol.mag === 13, 'A new press fires the next round');
  pistol.startReload(); step(pistol, 1.25);
  assert(pistol.mag === 15 && pistol.reserve === 88, 'Pistol reload conserves ammo');
});

test('real-time auto-reload', async () => {
  rifle.resetAmmo(); rifle.equip(); rifle.mag = 1; rifle.animate(fire, 0); rifle.unequip();
  assert(!rifle.reloading, 'Empty magazine does not reload before the real-time delay');
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert(rifle.reloading && rifle.mag === 0, 'Real-time auto-reload starts while holstered without animation');
  rifle.equip(); step(rifle, 1.65);
  assert(rifle.mag === 30 && !rifle.reloading, 'Auto-reload advances after re-equip');
  sniper.equip(); sniper.mag = 1; sniper.animate(fire, 0);
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert(sniper.reloading, 'Sniper auto-reload can start during its frozen bolt cycle');
  rifle.resetAmmo(); rifle.mag = 1; rifle.animate(fire, 0); rifle.resetAmmo(); rifle.mag = 0;
  sniper.resetAmmo(); sniper.mag = 1; sniper.animate(fire, 0); sniper.dispose();
  await new Promise(resolve => window.setTimeout(resolve, 280));
  assert(!rifle.reloading && !sniper.reloading && sniper.root.parent === null, 'Reset and disposal cancel pending real-time auto-reloads');
});

test('disposal releases every view model', () => {
  for (const weapon of all) weapon.dispose();
  assert(ctx.renderer.rig.children.length === 0, 'Weapon disposal removes every view model');
});

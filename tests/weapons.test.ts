import { afterAll, expect, test } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, MeshToonMaterial, Vector3 } from 'three';
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
  camera: { position: new Vector3(2, 3, 4) },
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
const r4c = gunAt(0), rifle = gunAt(1), shotgun = gunAt(2), sniper = gunAt(3), pistol = gunAt(4);
const melee = new Melee(engineCtx, enginePlayer);
const all = [...loadout, revolver, melee];
const step = (weapon: { animate(st: WeaponState, dt: number): void }, duration: number, state: WeaponState = neutral) => {
  for (let left = duration; left > 1e-9;) { const dt = Math.min(0.01, left); weapon.animate(state, dt); left -= dt; }
};

afterAll(() => { for (const weapon of all) weapon.dispose(); });

test('loadout, view models and aim poses', () => {
  assert(loadout.map(w => w.kind).join(',') === 'r4c,rifle,shotgun,sniper,pistol', 'Loadout keeps five guns and independent melee');
  assert(melee instanceof Melee && melee.spreadPx === 4 && !melee.isGun, 'Melee exposes its independent state');
  const muzzleZ: Record<GunKind, number> = { r4c: -1.16, rifle: -0.96, pistol: -0.42, shotgun: -1.09, sniper: -1.60, revolver: -0.40 };
  const expected: Record<GunKind, number[]> = { r4c: [30, 150, 300, 36, 38, 0.08], rifle: [30, 150, 300, 22, 38, 0.075], pistol: [15, 90, 180, 40, 62, 0.18], shotgun: [6, 36, 72, 19, 68, 0.78],
    sniper: [5, 25, 50, 150, 20, 0.20], revolver: [6, 36, 72, 62, 52, 0.30] };
  for (const gun of [r4c, rifle, pistol, shotgun, sniper, revolver]) {
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
  for (const part of ['stock', 'railed-handguard', 'magazine', 'acog']) {
    expect(r4c.root.getObjectByName(part), `R4-C models ${part}`).toBeDefined();
  }
  expect(r4c.root.getObjectByName('railed-handguard')).not.toBe(rifle.root.getObjectByName('railed-handguard'));
  expect(GUN_STATS.r4c.sight).toEqual(GUN_STATS.rifle.sight);
  const receiver = must(rifle.root.getObjectByName('receiver'), 'receiver');
  if (!(receiver instanceof Mesh)) throw new Error('receiver is not a mesh');
  const geometry = receiver.geometry;
  geometry.computeBoundingBox();
  assert(must(geometry.boundingBox, 'bounding box').getSize(new Vector3()).distanceTo(new Vector3(0.10, 0.13, 0.48)) < 1e-7, 'MP5 uses its compact receiver dimensions');
  assert(must(revolver.root.getObjectByName('cylinder'), 'cylinder').children.length === 7, 'Revolver has a drum and six chambers');
  const rightHand = must(rifle.root.getObjectByName('right-hand'), 'right hand');
  const fist = must(rightHand.getObjectByName('view-glove-palm'), 'glove'), forearm = must(rightHand.getObjectByName('view-sleeve'), 'sleeve');
  if (!(fist instanceof Mesh) || !(forearm instanceof Mesh)) throw new Error('hand parts are not meshes');
  const fistColor = (fist.material as MeshStandardMaterial).color.getHex(), sleeveColor = (forearm.material as MeshStandardMaterial).color.getHex();
  assert(fistColor !== sleeveColor, 'Blender gloves use a distinct material from the tactical sleeve');
  assert(rifle.root.getObjectByName('acog-tube') && !rifle.root.getObjectByName('sight-ring'), 'MP5 has an ACOG, not a holo sight');
  assert(rifle.root.getObjectByName('acog-elevation-turret') && rifle.root.getObjectByName('acog-windage-turret'), 'ACOG has top and side adjustment caps');
  const magnification = Math.tan(82 * Math.PI / 360) / Math.tan(rifle.adsFov * Math.PI / 360);
  assert(Math.abs(magnification - 2.5) < 0.03, 'ACOG uses approximately 2.5× magnification, not 4×');
  assert(rifle.root.getObjectByName('magazine-lower'), 'MP5 magazine has a curved lower section');
  const blade = must(melee.root.getObjectByName('blade'), 'blade');
  if (!(blade instanceof Mesh)) throw new Error('blade is not a mesh');
  assert((blade.material as MeshToonMaterial).color.getHex() === 0xcbdbe3, 'Knife blade uses pale cool steel');
});

test('R4-C and MP5 optics change independently without changing combat stats', () => {
  for (const [gun, other] of [[r4c, rifle], [rifle, r4c]] as const) {
    const stats = { ...GUN_STATS[gun.kind] };
    gun.setOptic('holo');
    expect(gun.scopeKind).toBe('holo');
    expect(gun.adsFov).toBe(82);
    expect(gun.root.getObjectByName('holo')?.visible).toBe(true);
    expect(gun.root.getObjectByName('acog')?.visible).toBe(false);
    expect(other.scopeKind).toBe('acog');
    gun.resetAmmo(); gun.equip();
    step(gun, 1, { ...neutral, aim: true });
    expect(gun.scopeKind).toBe('holo');
    expect(gun.root.visible).toBe(false);
    expect(GUN_STATS[gun.kind]).toEqual(stats);
    // @ts-expect-error Runtime input must not select an unsupported optic.
    gun.setOptic('sniper');
    expect(gun.scopeKind).toBe('holo');
    gun.setOptic('acog');
    expect(gun.adsFov).toBe(38);
    expect(gun.root.getObjectByName('acog')?.visible).toBe(true);
    expect(gun.root.getObjectByName('holo')?.visible).toBe(false);
    gun.resetAmmo(); gun.unequip();
  }
  sniper.setOptic('holo');
  expect(sniper.scopeKind).toBe('sniper');
  expect(sniper.adsFov).toBe(20);
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
  assert(rifle.mag === 29 && near(num(must(last('spread'), 'spread call')[0]), 0.012), 'MP5 samples spread before its shot kick');
  assert(near(rifle.spreadPx, 5 + 0.017 * 900), 'MP5 bloom updates the HUD gap');
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

test('R4-C holds automatic fire at 80 ms and reloads at 2.2 seconds', () => {
  r4c.resetAmmo(); r4c.equip(); calls.length = 0;
  r4c.animate(fire, 0);
  expect(r4c.mag).toBe(29);
  r4c.animate({ ...neutral, fire: true }, 0.079);
  expect(r4c.mag).toBe(29);
  r4c.animate({ ...neutral, fire: true }, 0.0011);
  expect(r4c.mag).toBe(28);
  expect(named('tracer')).toHaveLength(2);
  r4c.startReload(); calls.length = 0;
  step(r4c, 2.19, fire);
  expect(r4c.mag).toBe(28);
  expect(r4c.reloading).toBe(true);
  r4c.animate(fire, 0.01);
  expect(r4c.mag).toBe(30);
  expect(r4c.reserve).toBe(148);
  expect(r4c.reloading).toBe(false);
  expect(named('tracer')).toHaveLength(0);
  r4c.animate({ ...neutral, fire: true }, 0);
  expect(r4c.mag).toBe(29);
  r4c.resetAmmo(); r4c.unequip();
});

test('accepted spread and recoil settings', () => {
  expect(GUN_STATS.rifle).toMatchObject({ hipSpread: 0.012, moveSpread: 0.0005, spreadKick: 0.005 });
  expect(GUN_STATS.pistol).toMatchObject({ hipSpread: 0.008, adsSpread: 0.002, spreadKick: 0.006,
    spreadMax: 0.035, moveSpread: 0.0004, camKick: [0.014, 0.003] });
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

test('real rays use separate PvE and PvP damage, headshots and distance falloff', () => {
  const target: Foe = { center: new Vector3() };
  const saved = { enemy: ctx.enemies.raycast, world: ctx.world.raycast, remote: ctx.game.raycastPlayers };
  const cases: [Gun, number, number, number, number, number][] = [
    // gun, metres, PvE body, PvE head, PvP body, PvP head
    [r4c, 10, 36, 90, 26, 46.8],
    [r4c, 38, 30, 75, 18.72, 33.696],
    [r4c, 300, 19.8, 49.5, 11.7, 21.06],
    [rifle, 10, 22, 57.2, 18, 32.4],
    [rifle, 300, 8.8, 22.88, 7.2, 12.96],
    [pistol, 12, 40, 104, 32, 64],
    [pistol, 26, 20, 52, 16, 32],
    [pistol, 40, 14, 36.4, 11.2, 22.4],
    [pistol, 300, 14, 36.4, 11.2, 22.4],
    [sniper, 10, 150, 450, 100, 200],
    [sniper, 300, 150, 450, 100, 200],
    [shotgun, 9, 19, 34.2, 16, 25.6],
    [shotgun, 300, 4.18, 7.524, 2.4, 3.84],
  ];
  try {
    ctx.world.raycast = () => null;
    for (const [gun, dist, body, head, pvpBody, pvpHead] of cases) {
      for (const part of ['torso', 'head']) for (const online of [false, true]) {
        const point = new Vector3(0, 0, -dist);
        ctx.enemies.raycast = () => online ? null : { enemy: target, part, dist, point };
        ctx.game.raycastPlayers = () => online ? { player: target, part, dist, point } : null;
        calls.length = 0;
        expect(gun._ray(player.forward)).toBe(true);
        const damage = must(last(online ? 'playerDamage' : 'enemyDamage'), 'damage');
        expect(damage[1], `${gun.kind} ${online ? 'PvP' : 'PvE'} ${part} at ${dist} m`)
          .toBeCloseTo(online ? part === 'head' ? pvpHead : pvpBody : part === 'head' ? head : body, 8);
        expect(damage[2]).toMatchObject({ source: gun.kind, part, crit: part === 'head' });
        expect(named(online ? 'enemyDamage' : 'playerDamage')).toHaveLength(0);
      }
    }
  } finally {
    ctx.enemies.raycast = saved.enemy; ctx.world.raycast = saved.world; ctx.game.raycastPlayers = saved.remote;
  }
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
  pistol.startReload(); step(pistol, 0.99, fire);
  assert(pistol.mag === 13 && pistol.reloading, 'Pistol cannot reload or fire before one second');
  pistol.animate(fire, 0.01);
  assert(pistol.mag === 15 && pistol.reserve === 88 && !pistol.reloading, 'Pistol reload conserves ammo at one second');
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

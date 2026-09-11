import { Group, Vector3 } from 'three';
import { Gun, Katana, GUN_STATS, makeLoadout } from '../src/engine/weapons/index.js';

export async function run(assert) {
  const near = (a, b) => Math.abs(a - b) < 1e-7;
  const calls = [];
  const record = name => (...args) => calls.push({ name, args });
  const neutral = { fire: false, firePressed: false, aim: false, reloadPressed: false,
    meleePressed: false, sprinting: false, grounded: true, speed: 0, sliding: false,
    lookDelta: { x: 0, y: 0 }, strafe: 0, bobPhase: 0, bobAmt: 0, landDip: 0, slideTilt: 0, blockFire: false };
  const fire = { ...neutral, fire: true, firePressed: true };
  const ctx = {
    renderer: { rig: new Group() },
    input: { rumble: record('rumble') },
    audio: Object.fromEntries(['shot', 'shotgunFire', 'sniperFire', 'revolver', 'reload', 'shellCue', 'cylinder',
      'empty', 'pump', 'ricochet', 'katanaSwing', 'katanaHit'].map(name => [name, record(name)])),
    effects: { shake: 0, ...Object.fromEntries(['strokeBurst', 'smoke', 'shell', 'bulletImpact'].map(name => [name, record(name)])),
      tracer: (a, b, ...args) => calls.push({ name: 'tracer', args: [a.clone(), b.clone(), ...args] }) },
    enemies: { raycast: () => null, inArc: () => [], damage: record('enemyDamage') },
    world: { raycast: (eye, dir, max, ignore) => {
      assert(max === 300 && ignore({ data: { noShoot: true } }), 'Guns trace 300 m and skip noShoot boxes');
      return null;
    } },
    game: { raycastPlayers: () => null, playersInArc: () => [], breakablesInArc: () => [], cutRopes: () => false,
      hitPlayer: record('playerDamage'), breakHit: record('breakHit'), hitstop: record('hitstop'),
      onShot: point => calls.push({ name: 'onShot', args: [point.clone()] }) },
  };
  const player = { eye: new Vector3(2, 3, 4), forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0),
    recoil: record('recoil'), kickFov: record('kickFov'), lunge: record('lunge'),
    aimDir: (spread, out) => { calls.push({ name: 'spread', args: [spread] }); return out.copy(player.forward); } };
  const loadout = makeLoadout(ctx, player), revolver = new Gun(ctx, player, 'revolver');
  const [rifle, shotgun, sniper, katana] = loadout, all = [...loadout, revolver];
  const step = (weapon, duration, state = neutral) => {
    for (let left = duration; left > 1e-9;) { const dt = Math.min(0.01, left); weapon.animate(state, dt); left -= dt; }
  };
  const named = name => calls.filter(call => call.name === name);
  const last = name => named(name).at(-1)?.args;
  try {
    assert(loadout.map(w => w.kind).join(',') === 'rifle,shotgun,sniper,katana', 'Loadout keeps the four fixed slots');
    assert(katana instanceof Katana && katana.spreadPx === 4 && !katana.isGun, 'Katana exposes its melee HUD state');
    const muzzleZ = { rifle: -0.98, shotgun: -1.09, sniper: -1.60, revolver: -0.40 };
    const expected = { rifle: [35, 175, 350, 24, 58, 1 / 11], shotgun: [6, 36, 72, 19, 68, 0.78],
      sniper: [5, 25, 50, 150, 20, 0.20], revolver: [6, 36, 72, 62, 52, 0.30] };
    for (const gun of [rifle, shotgun, sniper, revolver]) {
      const stats = GUN_STATS[gun.kind], actual = [gun.mag, gun.reserve, stats.maxReserve, stats.damage, gun.adsFov, stats.fireInterval];
      assert(actual.every((v, i) => near(v, expected[gun.kind][i])), `${gun.kind} uses the documented combat values`);
      assert(!gun.root.visible && gun.root.scale.toArray().every(v => v === 0.46), `${gun.kind} starts hidden at scale 0.46`);
      assert(near(gun.root.getObjectByName('muzzle').position.z, muzzleZ[gun.kind]), `${gun.kind} uses the documented muzzle anchor`);
      assert(gun.root.getObjectByName('muzzle-flash').children.length === 3, `${gun.kind} has three flash stars`);
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
    const receiver = rifle.root.getObjectByName('receiver').geometry;
    receiver.computeBoundingBox();
    assert(receiver.boundingBox.getSize(new Vector3()).distanceTo(new Vector3(0.09, 0.12, 0.5)) < 1e-7, 'Rifle receiver retains its model dimensions');
    assert(revolver.root.getObjectByName('cylinder').children.length === 7, 'Revolver has a drum and six chambers');

    rifle.equip();
    rifle.mag = 7;
    rifle.startReload();
    step(rifle, 1.44, fire);
    assert(rifle.mag === 7 && rifle.reloading, 'Magazine reload cannot fire or transfer rounds early');
    rifle.animate(fire, 0.01);
    assert(rifle.mag === 35 && rifle.reserve === 147 && !rifle.reloading, 'Magazine reload tops up at 1.45 s and consumes the completion frame');
    rifle.resetAmmo();
    calls.length = 0;
    rifle.animate(fire, 0);
    assert(rifle.mag === 34 && near(last('spread')[0], 0.018), 'Rifle samples spread before its shot kick');
    assert(near(rifle.spreadPx, 5 + 0.029 * 900), 'Rifle bloom updates the HUD gap');
    const tracer = last('tracer');
    assert(tracer[1].distanceTo(player.eye.clone().addScaledVector(player.forward, 300)) < 1e-7, 'Hitscan starts at the eye');
    assert(tracer[0].distanceTo(rifle.root.getObjectByName('muzzle').getWorldPosition(new Vector3())) < 1e-7, 'Tracer starts at the model muzzle');
    rifle.animate({ ...neutral, blockFire: true }, 0.2);
    assert(rifle.mag === 34, 'A neutral dead frame does not fire');
    rifle.unequip();
    const frozenPose = rifle.root.position.clone();
    rifle.animate(fire, 0.2);
    assert(rifle.mag === 34 && rifle.root.position.equals(frozenPose) && !rifle.root.visible, 'Holstered state does not advance or fire');

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
    assert(shotgun.root.getObjectByName('fore-end').position.z < -0.46, 'Pump starts in its documented negative-time pose');
    step(shotgun, 0.56);
    assert(named('shell').length === 1 && near(shotgun.root.getObjectByName('fore-end').position.z, -0.46), 'Pump ejects once and returns its fore-end');

    revolver.equip();
    revolver.mag = 2;
    calls.length = 0;
    revolver.startReload();
    step(revolver, 0.58, fire);
    assert(revolver.mag === 2 && named('shellCue').length === 1 && named('shell').length === 0, 'Cylinder eject event plays once without visible casings');
    step(revolver, 1.32, fire);
    assert(revolver.mag === 6 && revolver.reserve === 32 && !revolver.reloading, 'Cylinder fills at 1.9 s without accepting fire');
    assert(revolver.root.getObjectByName('cylinder').rotation.z === 0, 'Cylinder returns to rest');

    const foe = { center: new Vector3(0, 1, -3) }, remote = { center: new Vector3(0, 1, -2) }, prop = { pos: new Vector3(0, 1, -1) };
    let enemyHit = { enemy: foe, part: 'head', dist: 20, point: new Vector3(0, 0, -20) };
    let worldHit = { dist: 30, point: new Vector3(0, 0, -30), normal: new Vector3(0, 0, 1), box: { data: {} } };
    let playerHit = { player: remote, part: 'blade', dist: 10, point: new Vector3(0, 0, -10) };
    ctx.enemies.raycast = () => enemyHit;
    ctx.world.raycast = () => worldHit;
    ctx.game.raycastPlayers = () => playerHit;
    const rayShot = () => { rifle.resetAmmo(); rifle.equip(); calls.length = 0; rifle.animate(fire, 0); };
    rayShot();
    assert(last('playerDamage')[1] === 19 && last('playerDamage')[2].part === 'blade' && !last('enemyDamage'), 'Closest remote blade routes unchanged to the PvP handler');
    playerHit = null;
    worldHit.dist = 5; worldHit.box.data.breakable = prop;
    rayShot();
    assert(last('breakHit')[1] === 24 && !last('enemyDamage'), 'Closer prop receives unscaled base damage');
    worldHit.dist = 30;
    rayShot();
    assert(near(last('enemyDamage')[1], 62.4) && last('enemyDamage')[2].crit, 'Closer enemy head receives rifle head damage');
    enemyHit.part = 'shield';
    rayShot();
    assert(last('enemyDamage')[2].part === 'shield' && last('enemyDamage')[1] === 24, 'Shield damage routes unchanged to the enemy handler');
    enemyHit = null; worldHit.box.data = {};
    rayShot();
    assert(named('bulletImpact').length === 1 && !last('enemyDamage'), 'Solid world hit creates an impact');
    worldHit = null;
    enemyHit = { enemy: foe, part: 'head', dist: 32, point: new Vector3(0, 0, -32) };
    shotgun.resetAmmo(); calls.length = 0; shotgun.animate(fire, 0);
    assert(named('enemyDamage').length === 10 && near(last('enemyDamage')[1], 19 * 1.8 * 0.22), 'Shotgun applies per-pellet headshot and falloff floor');
    assert(last('hitstop')[0] === 0.03 && last('hitstop')[1] === 0.3, 'Shotgun hit applies its own hit-stop');
    enemyHit = null;

    katana.equip();
    calls.length = 0;
    katana.animate({ ...neutral, aim: true }, 0.05);
    assert(katana.blocking && near(katana.blockT, 0.05), 'Guard entry starts its held timer');
    katana.animate({ ...neutral, blockFire: true }, 0.05);
    assert(!katana.blocking && named('katanaSwing').length === 0, 'Neutral state releases guard without starting a slash');
    ctx.enemies.inArc = () => [{ enemy: foe, dist: 2 }];
    ctx.game.playersInArc = () => [remote];
    ctx.game.breakablesInArc = () => [prop];
    katana.startSlash(neutral);
    assert(named('tracer').length === 9, 'Slash emits nine arc segments');
    step(katana, 0.08);
    assert(!last('enemyDamage'), 'Slash damage waits for the documented hit moment');
    step(katana, 0.01);
    assert(last('enemyDamage')[1] === 75 && last('playerDamage')[1] === 55 && last('breakHit')[1] === 75, 'Katana routes its three damage values');
    step(katana, 0.18);
    assert(named('enemyDamage').length === 1, 'A slash hits each target once');
    step(katana, 0.07, { ...neutral, fire: true });
    assert(katana.combo === 2 && named('katanaSwing').length === 2, 'Held fire chains the alternate slash after cooldown');
    katana.addBlood(0.84); katana.animate(neutral, 0);
    const smears = katana.root.children.filter(child => child.name.startsWith('blood-smear-'));
    assert(smears.length === 6 && smears.filter(smear => smear.visible).length === 5, 'Blood thresholds reveal five of six smears at 0.84');
    assert(smears.map(smear => smear.userData.threshold).join(',') === '0,0.18,0.4,0.58,0.74,0.88', 'Blade smear thresholds match the specification');
    katana.resetAmmo();
    assert(katana.blood === 0 && katana.combo === 0 && !katana.blocking && smears.every(smear => !smear.visible), 'Reset clears katana combat and blade state');

    rifle.resetAmmo(); rifle.equip(); rifle.mag = 1; rifle.animate(fire, 0); rifle.unequip();
    assert(!rifle.reloading, 'Empty magazine does not reload before the real-time delay');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert(rifle.reloading && rifle.mag === 0, 'Real-time auto-reload starts while holstered without animation');
    rifle.equip(); step(rifle, 1.45);
    assert(rifle.mag === 35 && !rifle.reloading, 'Auto-reload advances after re-equip');
    sniper.equip(); sniper.mag = 1; sniper.animate(fire, 0);
    await new Promise(resolve => setTimeout(resolve, 280));
    assert(sniper.reloading, 'Sniper auto-reload can start during its frozen bolt cycle');
    rifle.resetAmmo(); rifle.mag = 1; rifle.animate(fire, 0); rifle.resetAmmo(); rifle.mag = 0;
    sniper.resetAmmo(); sniper.mag = 1; sniper.animate(fire, 0); sniper.dispose();
    await new Promise(resolve => setTimeout(resolve, 280));
    assert(!rifle.reloading && !sniper.reloading && sniper.root.parent === null, 'Reset and disposal cancel pending real-time auto-reloads');
  } finally {
    for (const weapon of all) weapon.dispose();
  }
  assert(ctx.renderer.rig.children.length === 0, 'Weapon disposal removes every view model');
}

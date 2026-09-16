// Run: node tests/model-rework.check.mjs http://localhost:3000 [/tmp/model-rework]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const output = process.argv[3] ?? '/tmp/model-rework';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game);
  assert.equal(await page.evaluate(() => window.__game.live), 1);
  await page.locator('[data-act="start"]').click();
  await page.evaluate(() => {
    const g = window.__game;
    g.gs.state = 'pause'; g.gs.mode = 'ffa'; g.enemies.clear(); g.gs.queue.length = 0;
    g.ctx.audio.music(false); g.hud.update(10);
    for (let i = 0; i < 90; i++) g.player.update(1 / 60);
  });
  await page.screenshot({ path: `${output}/first-person.png` });
  for (const kind of ['grunt', 'rusher', 'heavy', 'sniper', 'shield', 'bomber', 'flyer', 'boss', 'hitbox', 'lagspike']) {
    const result = await page.evaluate(kind => {
      const g = window.__game;
      g.enemies.clear(); g.effects.clear();
      const pos = g.player.body.pos.clone().add({ x: 0, y: 0, z: -4 });
      const e = g.enemies.spawn(kind, pos);
      e.root.scale.setScalar(e.stats.scale); e.root.rotation.y = 0;
      if (e.figure.parts.upperR) e.figure.parts.upperR.rotation.x = -.3;
      if (e.figure.parts.foreR) e.figure.parts.foreR.rotation.x = -.2;
      e.root.updateMatrixWorld(true);
      for (const hit of e.hits) hit.obj.getWorldPosition(hit.center);
      const target = e.hits.find(hit => hit.part === 'head') ?? e.hits[0];
      const ray = g.enemies.raycast(target.center.clone().add({ x: 0, y: 0, z: 10 }), pos.clone().set(0, 0, -1), 20);
      g.effects.clear(); g.hud.setGameplayVisible(false); g.hud.hideScreen(); g.hud.update(10);
      g.ctx.renderer.rig.visible = false;
      const scale = e.stats.scale;
      g.ctx.camera.position.copy(pos).add({ x: 2.5 * scale, y: 1.9 * scale, z: 5.4 * scale });
      g.ctx.camera.lookAt(pos.clone().add({ x: 0, y: (e.stats.kind === 'humanoid' ? 1.1 : .75) * scale, z: 0 }));
      g.ctx.camera.fov = 30; g.ctx.camera.updateProjectionMatrix();
      let meshes = 0, triangles = 0;
      e.root.traverse(part => {
        if (part.isMesh) {
          meshes++;
          triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
        }
      });
      return { tactical: e.root.userData.tactical, radius: target.r, scale,
        bodyKind: e.stats.kind, rayPart: ray?.part, meshes, triangles };
    }, kind);
    assert.equal(result.tactical, kind);
    assert.equal(result.radius, (result.bodyKind === 'humanoid' ? .195 : kind === 'flyer' ? .48 : .5) * result.scale);
    assert.equal(result.rayPart, kind === 'shield' ? 'shield' : result.bodyKind === 'humanoid' ? 'head' : 'torso');
    assert(result.meshes < 100 && result.triangles < 18000, `${kind} stays within the mesh budget`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${output}/${kind}.png` });
    console.log(kind, result);
  }
  // Exercise real controllers against the real asset hierarchy, including the
  // spawn paths used by bosses. No changes to production AI for this check.
  const actions = await page.evaluate(() => {
    const g = window.__game;
    g.player.hp = g.player.maxHp = 10000;
    g.enemies.onKill = null;
    let shots = 0;
    g.enemies.onFire = () => shots++;
    const spawn = kind => {
      g.enemies.clear(); g.effects.clear(); shots = 0;
      const pos = g.player.body.pos.clone().add({ x: 0, y: kind === 'flyer' ? 3 : 0, z: -6 });
      const e = g.enemies.spawn(kind, pos);
      e.state = 'hunt'; e.age = 1; e.root.scale.setScalar(e.stats.scale);
      e.yaw = e.yawTo = 0; e.root.rotation.y = 0;
      e.target = g.player; e.retargetT = e.losT = 10; e.hasLOS = true; e.attackCd = 10;
      return e;
    };
    const step = n => { for (let i = 0; i < n; i++) g.enemies.update(.05); };
    const result = {};
    const shield = spawn('shield');
    g.enemies.damage(shield, 1, { part: 'shield', source: 'melee' });
    g.enemies.damage(shield, 1, { part: 'shield', source: 'melee' });
    result.shieldBreak = shield.shieldHp === 0 && !shield.figure.parts.shield && !shield.hits.some(hit => hit.part === 'shield');
    const bomber = spawn('bomber'); bomber.fuseT = .15;
    step(1); result.armingLight = bomber.figure.parts.spark.scale.x > 1;
    step(5); result.detonation = !bomber.alive;
    const rusher = spawn('rusher'); rusher.attackT = .5; rusher.attackHit = false;
    step(2); result.bladeWindup = rusher.figure.parts.foreR.rotation.x < -.1;
    step(30); result.bladeRecovery = rusher.attackT <= 0;
    const sniper = spawn('sniper'); sniper.attackCd = 0;
    step(18); result.sniperTelegraph = sniper.laser?.visible === true && shots === 0;
    step(18); result.sniperShot = shots === 1 && sniper.laser?.visible === false;
    const flyer = spawn('flyer'); step(12);
    result.flight = flyer.body.pos.toArray().every(Number.isFinite) && Math.abs(flyer.figure.parts.wingL.rotation.z) <= .12;
    let boss = spawn('boss');
    const stomp = boss.bossAttack = { kind: 'stomp', t: .55, fired: false };
    step(6); result.stomp = stomp.fired;
    boss = spawn('boss');
    const thrown = boss.bossAttack = { kind: 'throw', t: .55, fired: false };
    step(5); result.throw = thrown.fired && shots === 1;
    boss = spawn('hitbox');
    const charge = boss.bossAttack = { kind: 'charge', t: .4, dir: null, hit: false, dustT: 0 };
    step(10); result.charge = charge.dir !== null;
    boss = spawn('hitbox');
    const wipe = boss.bossAttack = { kind: 'wipe', t: .7, fired: false };
    step(6); result.wipe = wipe.fired && g.enemies.list.filter(e => e.type === 'bomber').length === 2;
    boss = spawn('lagspike');
    const spray = boss.bossAttack = { kind: 'spray', t: .5, shots: 0 };
    step(19); result.spray = spray.shots === 9 && shots === 9;
    boss = spawn('lagspike');
    const summon = boss.bossAttack = { kind: 'summon', t: .65, fired: false };
    step(5); result.summon = summon.fired && g.enemies.list.filter(e => e.type === 'flyer').length === 3;
    g.enemies.clear(); g.effects.clear();
    return result;
  });
  console.log('Special actions', actions);
  for (const [action, passed] of Object.entries(actions)) assert.equal(passed, true, action);
  // Failure must remain visible, not boot an invisible or partial character set.
  const failure = await browser.newPage();
  await failure.route('**/models/tactical.glb', route => route.abort());
  await failure.goto(url);
  await failure.getByRole('heading', { name: 'The game could not start' }).waitFor();
  assert.equal(await failure.evaluate(() => !!window.__game), false);
  await failure.close();
  await page.reload();
  await page.waitForFunction(() => !!window.__game);
  assert.equal(await page.evaluate(() => window.__game.live), 1);
  assert.deepEqual(errors, []);
  console.log(`OK: all 10 enemies, hit areas, special actions, first-person arms, load failure and remount. Screenshots: ${output}`);
} finally { await browser.close(); }

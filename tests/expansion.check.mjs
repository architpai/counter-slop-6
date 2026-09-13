// Run against a production build: node tests/expansion.check.mjs http://localhost:3100
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3100', out = '/tmp/shooter-expansion';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const errors = [];
try {
  for (const map of ['downtown', 'house', 'mexico']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(`${map}: ${error.message}`));
    await page.addInitScript(map => { localStorage.setItem('cs6_map', map); localStorage.setItem('cs6_music', '0'); }, map);
    await page.goto(url); await page.waitForFunction(() => window.__game?.live === 1);
    await page.locator('[data-act="start"]').click();
    for (const wave of [20, 25, 30]) {
      const expected = wave === 20 ? map === 'house' ? 'boss' : 'aimbot' : wave === 25 ? 'ragequit' : 'moderator';
      await page.evaluate(wave => {
        const g = window.__game; g.jumpToWave(wave); g.player.hp = g.player.maxHp = 100000;
      }, wave);
      await page.waitForFunction(() => window.__game.enemies.list.some(e => e.alive && e.stats.boss));
      const result = await page.evaluate(() => {
        const g = window.__game; g.gs.state = 'pause'; g.gs.queue.length = 0;
        const boss = g.enemies.list.find(e => e.alive && e.stats.boss), start = boss.body.pos.clone();
        if (boss.type === 'aimbot') {
          // The same arena fight also runs after the player reaches the perch.
          g.player.body.pos.copy(start).add({ x: 0, y: 0, z: 5 });
        }
        for (let i = 0; i < 900; i++) { g.enemies.update(1 / 30); g.effects.update(1 / 30); }
        const carried = g.enemies.list.filter(e => e.alive && (e.type === 'turret' || (e.type === 'carrier' && e.payload))).length;
        g.hud.update(10); g.hud.setGameplayVisible(false); g.hud.hideScreen(); g.ctx.renderer.rig.visible = false;
        g.ctx.camera.position.copy(boss.center).add({ x: 12, y: 9, z: 15 });
        g.ctx.camera.lookAt(boss.center); g.ctx.camera.fov = 45; g.ctx.camera.updateProjectionMatrix();
        return { type: boss.type, start: start.toArray(), end: boss.body.pos.toArray(),
          perch: g.level.bossPerch?.position.toArray(), rings: g.enemies.hazards.rings.length, carried,
          carriers: g.enemies.list.filter(e => e.type === 'carrier').length,
          sentries: g.enemies.list.filter(e => e.type === 'turret').length,
          finite: g.enemies.list.every(e => [...e.body.pos.toArray(), ...e.body.vel.toArray(), e.hp].every(Number.isFinite)),
          live: g.live };
      });
      assert.equal(result.type, expected); assert.equal(result.finite, true); assert.equal(result.live, 1);
      assert(result.rings <= 3); assert(result.carried <= 2);
      if (expected === 'aimbot') {
        assert.deepEqual(result.start, result.perch); assert.deepEqual(result.end, result.start);
        assert(result.carriers > 0, 'AIMBOT launches carriers');
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: `${out}/${map}-${expected}.png` });
      console.log(map, wave, result);
    }
    const later = await page.evaluate(() => {
      const g = window.__game;
      const counts = [];
      for (const wave of [31, 36, 41, 46, 51]) { g.jumpToWave(wave); g.gs.state = 'pause'; counts.push(g.enemies.mutations.size); }
      // Exercise every new regular enemy on this map with its actual navigation and colliders.
      g.gs.queue.length = 0; g.player.hp = g.player.maxHp = 100000;
      const kinds = ['medic', 'breacher', 'carrier', 'turret', 'packleader', 'smoker', 'rubberbander', 'sapper', 'parry'];
      for (const [i, kind] of kinds.entries()) {
        const pos = g.level.spawns[i % g.level.spawns.length].clone();
        if (kind === 'carrier') pos.y += 8;
        g.enemies.spawn(kind, pos);
      }
      for (let i = 0; i < 360; i++) { g.enemies.update(1 / 30); g.effects.update(1 / 30); }
      const finite = g.enemies.list.every(e => [...e.body.pos.toArray(), ...e.body.vel.toArray(), e.hp].every(Number.isFinite));
      g.jumpToWave(1); g.gs.state = 'pause';
      return { counts, finite, reset: g.enemies.mutations.size === 0 && g.enemies.hazards.rings.length === 0
        && g.enemies.hazards.smoke.length === 0 && g.enemies.hazards.charges.length === 0 };
    });
    assert.deepEqual(later.counts, [1, 2, 3, 4, 4]); assert(later.finite); assert(later.reset);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`OK: all maps, new bosses/enemies, perch fallback, caps, mutations and reset. Screenshots: ${out}`);
} finally { await browser.close(); }

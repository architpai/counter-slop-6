// Real PeerJS/WebRTC browser check for co-op survival. Run with a local app server:
// node tests/online-coop.check.mjs http://localhost:3000
// Debug state edits shorten the waits; transport, players, enemies, menus and scenes are real.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [], pages = [];
const action = (page, act, value = null) => page.evaluate(({ act, value }) => window.__game.hud.onUiAction(act, value, new Event('click')), { act, value });
const read = page => page.evaluate(() => {
  const g = window.__game;
  return { id: g.net.id, state: g.gs.state, mode: g.lobby.mode, wave: g.gs.wave, over: g.gs.over, score: g.gs.score, kills: g.gs.kills,
    inter: g.gs.intermission, queued: g.gs.queue.length, alive: g.enemies.alive, mirror: g.enemies.mirror,
    ids: g.enemies.list.filter(e => e.alive).map(e => e.id).sort((a, b) => a - b), hp: g.player.hp, maxHp: g.player.maxHp,
    arena: g.ctx.level.arena, accepting: g.net.accepting, status: g.lobby.status, players: g.lobby.players.size, rows: [...g.scores.values()], teams: g.gs.teamMatch };
});
const wait = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(name => { localStorage.setItem('cs6_name', name); localStorage.setItem('cs6_music', '0'); }, name);
  await page.goto(url);
  await wait(page, () => !!window.__game);
  await page.locator('[data-act="online"]').click();
  return page;
}
async function join(page, code) {
  await page.locator('[data-act="joinCode"]').fill(code);
  await page.locator('[data-act="join"]').click();
}
const joined = page => wait(page, () => (window.__game.gs.state === 'lobby' || window.__game.gs.state === 'play') && window.__game.lobby.players.has(window.__game.net.id));
/** Host: nothing more to spawn, and everything alive falls out of the world, so the wave clears through the real kill path. */
const clearWave = host => host.evaluate(() => {
  const g = window.__game; g.gs.queue.length = 0;
  for (const e of [...g.enemies.list]) if (e.alive) g.enemies.kill(e, { source: 'fall' });
});
const down = page => page.evaluate(() => window.__game.player.takeDamage(1e9));
/** Real enemies shoot back for the whole check: record each hit, and let only the check's own `down` through. */
const armour = page => page.evaluate(() => {
  const g = window.__game, take = g.player.takeDamage.bind(g.player);
  g.hits = [];
  g.player.takeDamage = (amount, from) => { g.hits.push(amount); if (amount >= 1e8) take(amount, from); };
});
const hits = page => page.evaluate(() => window.__game.hits);

try {
  await mkdir('/tmp/shooter-coop-check', { recursive: true });
  const host = await open('Host tester'), client = await open('Client tester');
  await host.getByRole('button', { name: 'Co-op Survival', exact: true }).click();
  await host.locator('input[value="private"]').check();
  await host.locator('[data-act="create"]').click();
  await wait(host, () => window.__game.gs.state === 'lobby');
  const code = await host.evaluate(() => window.__game.net.code);
  await join(client, code); await joined(client);
  assert.equal((await read(client)).mode, 'coop');
  await client.getByText(/2\/4 players/).waitFor();
  await host.screenshot({ path: '/tmp/shooter-coop-check/lobby.png' });

  // Only the host can start. Every peer plays the solo layout with solo health, no teams.
  assert.equal(await client.locator('[data-act="startMatch"]').isDisabled(), true);
  await host.locator('[data-act="startMatch"]').click();
  await Promise.all([host, client].map(p => wait(p, () => window.__game.gs.state === 'play' && window.__game.gs.wave === 1)));
  for (const p of [host, client]) {
    const s = await read(p);
    assert.equal(s.arena, false); assert.equal(s.maxHp, 120); assert.equal(s.teams, null);
  }
  assert.equal((await read(host)).mirror, false);
  assert.equal((await read(client)).mirror, true);
  assert.equal((await read(host)).accepting, true, 'a co-op lobby stays open in a wave');
  for (const p of [host, client]) await armour(p);
  const hostId = (await read(host)).id, clientId = (await read(client)).id;

  // The host's enemies appear on the client with the same ids.
  await wait(host, () => window.__game.enemies.alive > 0);
  const first = (await read(host)).ids[0];
  await wait(client, id => window.__game.enemies.byId.get(id)?.alive === true, first);
  await wait(client, id => window.__game.enemies.byId.get(id).snapNew !== null, first);
  await client.screenshot({ path: '/tmp/shooter-coop-check/client-wave.png' });

  // A client hit travels to the host; the kill, its credit and the team score come back.
  await client.evaluate(id => {
    const g = window.__game, e = g.enemies.byId.get(id);
    g.enemies.damage(e, 900, { part: 'head', crit: true, source: 'rifle', point: e.center.clone(), dir: g.player.forward.clone() });
  }, first);
  await wait(host, id => window.__game.enemies.byId.get(id)?.alive !== true, first);
  await wait(client, id => window.__game.enemies.byId.get(id)?.alive !== true && window.__game.gs.kills === 1, first);
  await wait(host, id => window.__game.scores.get(id)?.kills === 1, clientId);
  await wait(client, id => window.__game.scores.get(id)?.kills === 1, clientId);
  assert.equal((await read(host)).kills, 0);
  const points = (await read(client)).score;
  assert.ok(points > 0);
  await wait(host, points => window.__game.gs.score >= points, points);

  // Enemy damage on the host reaches the client as host-only damage; a player cannot send it.
  await host.evaluate(id => window.__game.remotes.get(id).takeDamage(15, null), clientId);
  await wait(client, () => window.__game.hits.includes(15));
  await client.evaluate(id => {
    const g = window.__game;
    g.net.sendTo(id, 'edmg', { amount: 50, from: null, push: null });
    g.net.sendTo(id, 'pdmg', { amount: 50, from: [0, 1, 0], by: g.net.id, src: 'rifle', crit: false });
    g.net.send('end', { id: 'coop', name: 'WAVE 9' });
  }, hostId);

  // A join in a wave is let in, down: it watches the wave and enters at the wave clear.
  const late = await open('Late tester');
  await join(late, code);
  await wait(late, () => window.__game.gs.state === 'dying' && window.__game.lobby.mode === 'coop' && window.__game.enemies.mirror &&
    !window.__game.player.alive);
  const lateId = (await read(late)).id;
  assert.equal((await read(host)).players, 3);
  await wait(host, id => window.__game.remotes.get(id)?.alive === false, lateId);
  await late.screenshot({ path: '/tmp/shooter-coop-check/late-waits.png' });
  assert.ok(!(await hits(host)).includes(50), 'a client cannot send enemy or PvP damage to a teammate');
  assert.equal((await read(host)).over, null);

  // Down in a wave: no timed respawn; back at the wave clear.
  await down(client);
  await wait(client, () => window.__game.gs.state === 'dying');
  await wait(host, id => window.__game.remotes.get(id).alive === false, clientId);
  await client.waitForTimeout(4500);
  assert.equal((await read(client)).state, 'dying');
  assert.equal((await read(host)).over, null);
  await client.screenshot({ path: '/tmp/shooter-coop-check/client-down.png' });
  await clearWave(host);
  await host.evaluate(() => { window.__game.gs.intermission = 60; });
  for (const p of [client, late]) await wait(p, () => window.__game.gs.state === 'play' && window.__game.player.alive && window.__game.gs.intermission > 0);
  assert.equal((await read(client)).alive, 0);
  assert.equal((await read(host)).accepting, true);

  // The join is in the run; the next wave is scaled for three players.
  assert.equal((await read(late)).wave, 1);
  await armour(late);
  await host.evaluate(() => { window.__game.gs.intermission = 0.2; });
  await Promise.all([host, client, late].map(p => wait(p, () => window.__game.gs.wave === 2)));
  const wave2 = await read(host);
  assert.equal(wave2.queued + wave2.alive, Math.round(Math.round(4 + 1.7 * 2) * 2));
  await wait(late, () => window.__game.enemies.alive > 0);

  // Every player down in one wave ends the run for all, with the wave as the result.
  for (const p of [host, client, late]) await down(p);
  await Promise.all([host, client, late].map(p => wait(p, () => window.__game.gs.state === 'over')));
  for (const p of [host, client, late]) assert.deepEqual((await read(p)).over, { id: 'coop', name: 'WAVE 2' });
  await client.screenshot({ path: '/tmp/shooter-coop-check/run-over.png' });
  // The return delay counts clamped frame time, which software GL stretches: skip most of it.
  await host.evaluate(() => { window.__game.gs.overT = 7.5; });
  await Promise.all([host, client, late].map(p => wait(p, () => window.__game.gs.state === 'lobby', null, 30000)));
  for (const p of [host, client, late]) {
    const s = await read(p);
    assert.equal(s.alive, 0); assert.equal(s.mirror, false);
  }

  // Solo after co-op on the same page: enemies think for themselves again.
  for (const p of [late, client, host]) { await action(p, 'leave'); await wait(p, () => window.__game.gs.state === 'start'); }
  await action(client, 'back'); await action(client, 'start');
  await wait(client, () => window.__game.gs.mode === 'solo' && window.__game.enemies.alive > 0);
  assert.equal((await read(client)).mirror, false);
  // Game time, not wall time: software GL runs few frames a second.
  await client.evaluate(() => { const g = window.__game; g.soloEnemy = g.enemies.list[0]; g.soloFrom = g.soloEnemy.body.pos.clone(); });
  await wait(client, () => window.__game.soloEnemy.body.pos.distanceTo(window.__game.soloFrom) > 0.5, null, 60000);
  assert.deepEqual(errors, []);
  console.log('PASS: real WebRTC co-op lobby, start, mirrored enemies, client hit and credit, team score, host-only enemy damage, a join in a wave that waits for the wave clear, down and return, scaled wave, run end, and solo after co-op. Screenshots: /tmp/shooter-coop-check');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Peer states:', await Promise.all(pages.map(page => read(page).catch(() => null))));
  throw error;
} finally {
  for (const page of pages) await page.evaluate(() => window.__game?.net.leave()).catch(() => {});
  await browser.close();
}

// Real PeerJS/WebRTC browser check. Run with a local app server:
// node tests/online-team.check.mjs http://localhost:3000
// Debug state edits shorten scoring waits; transport, players, menus and scenes are real.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [], pages = [];
const action = (page, act, value = null) => page.evaluate(({ act, value }) => window.__game.hud.onUiAction(act, value, new Event('click')), { act, value });
const read = page => page.evaluate(() => {
  const g = window.__game;
  return { id: g.net.id, state: g.gs.state, mode: g.lobby.mode, teams: g.lobby.teams, match: g.gs.teamMatch, over: g.gs.over,
    pos: g.player.body.pos.toArray(), objects: g.ctx.scene.children.filter(o => o.name === 'teamWorld').length };
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
  await wait(page, () => (window.__game.gs.state === 'lobby' || window.__game.gs.state === 'play') && window.__game.lobby.players.has(window.__game.net.id));
}
async function moveTo(page, where) {
  await page.evaluate(where => {
    const g = window.__game;
    const point = where === 'flag' ? g.gs.teamMatch.flag.pos
      : g.ctx.scene.getObjectByName(where).position.toArray();
    g.player.body.pos.fromArray(point); g.player.body.vel.set(0, 0, 0);
  }, where);
}
async function leave(page) {
  await action(page, 'leave');
  await wait(page, () => window.__game.gs.state === 'start');
  assert.equal((await read(page)).objects, 0);
}

try {
  await mkdir('/tmp/shooter-team-check', { recursive: true });
  const host = await open('Red tester'), client = await open('Blue tester');
  await host.locator('[data-act="onlineMode"][data-mode="flag"]').count().then(async n => {
    if (n) await host.locator('[data-act="onlineMode"][data-mode="flag"]').click();
    else await host.getByRole('button', { name: 'Flag Hold', exact: true }).click();
  });
  await host.locator('input[value="private"]').check();
  await host.locator('[data-act="create"]').click();
  await wait(host, () => window.__game.gs.state === 'lobby');
  const code = await host.evaluate(() => window.__game.net.code);
  await join(client, code);
  assert.equal((await read(client)).mode, 'flag');
  await client.locator('[data-act="startMatch"]').click();
  await Promise.all([host, client].map(p => wait(p, () => window.__game.gs.state === 'play' && !!window.__game.gs.teamMatch)));
  const hostId = (await read(host)).id, clientId = (await read(client)).id;
  assert.equal((await read(host)).teams[hostId], 0);
  assert.equal((await read(client)).teams[clientId], 1);
  await wait(host, () => [...window.__game.remotes.values()].every(r => r.lastSeen > 0));
  await host.screenshot({ path: '/tmp/shooter-team-check/flag-start.png' });

  await moveTo(host, 'flag');
  await wait(client, id => window.__game.gs.teamMatch.flag.carrier === id, hostId);
  await moveTo(host, 'RED BASE');
  await wait(client, () => window.__game.gs.teamMatch.flag.placed === 0 && window.__game.gs.teamMatch.flag.holdLeft < 29.5);
  await moveTo(client, 'RED BASE');
  await wait(host, id => window.__game.gs.teamMatch.flag.carrier === id, clientId);
  assert.equal((await read(host)).match.flag.holdLeft, 30);
  await moveTo(client, 'BLUE BASE');
  await wait(host, () => window.__game.gs.teamMatch.flag.placed === 1);
  await client.screenshot({ path: '/tmp/shooter-team-check/blue-hold.png' });

  // Late join follows the running mode, flag, teams and clocks, not the local menu selection.
  const late = await open('Late teammate');
  await join(late, code);
  await wait(late, () => window.__game.gs.state === 'play' && window.__game.gs.teamMatch?.flag.placed === 1);
  const lateId = (await read(late)).id;
  assert.equal((await read(late)).teams[lateId], 0);
  assert.equal((await read(late)).match.round, 1);

  // A client cannot send host-only objective/score commands through real Net routing.
  await client.evaluate(() => {
    const g = window.__game;
    g.net.send('teamstate', { ...g.gs.teamMatch, scores: [99, 99] });
    g.net.send('end', { id: 'team:1', name: 'BLUE TEAM' });
  });
  assert.deepEqual((await read(host)).match.scores, [0, 0]);
  assert.equal((await read(host)).over, null);

  // Same-team addressed damage is rejected by the victim even if a peer sends it directly.
  const friendlyHit = id => {
    const g = window.__game;
    g.net.sendTo(id, 'pdmg', { amount: 500, from: [0, 1, 0], by: g.net.id, src: 'rifle', crit: false, round: g.gs.teamMatch.round });
  };
  await host.evaluate(friendlyHit, lateId);
  await wait(late, () => window.__game.player.shieldT <= 0);
  assert.equal(await late.evaluate(() => window.__game.player.hp), 110);
  await host.evaluate(friendlyHit, lateId);
  await wait(late, () => window.__game.gs.teamMatch.elapsed % 8 > 0.3);
  assert.equal(await late.evaluate(() => window.__game.player.hp), 110);

  // Full Red wipe: both players receive one wave deadline; Blue's hold keeps running.
  await host.evaluate(() => { const s = window.__game.gs.teamMatch; s.elapsed = Math.ceil(s.elapsed / 8) * 8 + 1; s.flag.holdLeft = 30; });
  for (const p of [host, late]) await p.evaluate(id => {
    const g = window.__game; g.player.lastHitBy = id; g.player.takeDamage(10000);
  }, clientId);
  await wait(host, ids => ids.every(id => Object.hasOwn(window.__game.gs.teamMatch.dead, id)), [hostId, lateId]);
  const dead = (await read(host)).match.dead;
  assert.equal(dead[hostId], dead[lateId]);
  assert.equal((await read(host)).match.flag.placed, 1);
  await host.screenshot({ path: '/tmp/shooter-team-check/team-wipe.png' });
  await Promise.all([host, late].map(p => wait(p, () => window.__game.gs.state === 'play', null, 12000)));

  // Finish one hold; all peers reset at the next round, with one point only.
  await host.evaluate(() => { window.__game.gs.teamMatch.flag.holdLeft = 0.3; });
  await wait(client, () => window.__game.gs.teamMatch.scores[1] === 1 && window.__game.gs.teamMatch.breakLeft > 0);
  await Promise.all([host, client, late].map(p => wait(p, () => window.__game.gs.teamMatch.round === 2, null, 10000)));
  assert.deepEqual((await read(client)).match.scores, [0, 1]);
  assert.equal((await read(late)).match.flag.carrier, null);

  // Force a tied normal-time boundary. First to five must NOT end overtime.
  await host.evaluate(() => { const s = window.__game.gs.teamMatch; s.scores = [4, 4]; s.elapsed = 479.9; });
  await wait(client, () => window.__game.gs.teamMatch.overtime);
  for (let point = 0; point < 2; point++) {
    await host.evaluate(() => {
      const g = window.__game, s = g.gs.teamMatch;
      s.flag.carrier = null; s.flag.placed = 1; s.flag.pos = g.ctx.scene.getObjectByName('BLUE BASE').position.toArray(); s.flag.holdLeft = 0.2;
    });
    if (point === 0) {
      await wait(client, () => window.__game.gs.teamMatch.streak === 1);
      assert.equal((await read(client)).over, null);
      const round = (await read(host)).match.round;
      await wait(host, round => window.__game.gs.teamMatch.round > round, round, 10000);
    }
  }
  await Promise.all([host, client, late].map(p => wait(p, () => window.__game.gs.state === 'over')));
  assert.equal((await read(client)).over.id, 'team:1');
  await client.screenshot({ path: '/tmp/shooter-team-check/blue-win.png' });
  for (const p of [late, client, host]) await leave(p);

  // TDM uses the same room flow, different objective, and shared respawn authority.
  await action(host, 'onlineMode', 'tdm');
  await action(host, 'create');
  await wait(host, () => window.__game.gs.state === 'lobby');
  await join(client, await host.evaluate(() => window.__game.net.code));
  await action(host, 'startMatch');
  await wait(client, () => window.__game.gs.teamMatch?.mode === 'tdm');
  await host.evaluate(() => { window.__game.gs.teamMatch.scores[0] = 39; });
  const killer = (await read(host)).id;
  await client.evaluate(id => { const g = window.__game; g.player.lastHitBy = id; g.player.takeDamage(10000); }, killer);
  await wait(host, () => window.__game.gs.state === 'over');
  await wait(client, () => window.__game.gs.state === 'over');
  assert.equal((await read(host)).over.id, 'team:0');
  assert.deepEqual((await read(client)).match.scores, [40, 0]);
  await leave(client); await leave(host);
  assert.deepEqual(errors, []);
  console.log('PASS: real WebRTC mode selection, late join, flag pickup/place/steal, friendly fire, full wipe/wave, round reset, overtime, TDM result and disposal. Screenshots: /tmp/shooter-team-check');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Peer states:', await Promise.all(pages.map(page => read(page).catch(() => null))));
  throw error;
} finally {
  for (const page of pages) await page.evaluate(() => window.__game?.net.leave()).catch(() => {});
  await browser.close();
}

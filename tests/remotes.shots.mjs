// Remote players' readability (docs/VISUALS.md, R7 and the readability guardrail): a real three-peer
// Flag Hold match (PeerJS/WebRTC, as tests/online-team.check.mjs), the two guests standing side by side
// 10 and 30 m in front of the host and facing it, one of each team, measured on the host per preset.
//   node tests/remotes.shots.mjs URL OUTDIR
// Environment: CS6_PRESETS=low,medium,ultra  CS6_GL=metal|swiftshader
//
// For each guest: its chest's mean sRGB colour (a box a sixth of its apparent height) and luma against
// the ground and wall either side of it, from a synchronous render on the host, then the same with its
// flat model drawn instead of its operator (fe14d35's look on that tier). The run fails if, on a realistic
// preset, a guest's chest reads worse against its background than the flat model's, or does not carry its
// team's hue (red over blue for RED, blue over red for BLUE, by `READABLE.hue`). Screenshots of each view.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3000/';
const out = process.argv[3] ?? '/tmp/cs6-remotes';
const presets = (process.env.CS6_PRESETS ?? 'low,medium,ultra').split(',');
const gl = process.env.CS6_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const args = [...(gl === 'metal' ? ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', `--use-angle=${gl}`]),
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
/** A team's hue on the chest (sRGB, its channel over the other team's), and the ranges measured (m). */
const READABLE = { hue: 12 };
const RANGES = [10, 30];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args });
const errors = [];
const wait = (page, fn, arg, timeout = 30_000) => page.waitForFunction(fn, arg, { timeout });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function open(name, host) {
  const context = await browser.newContext({ viewport: host ? { width: 1440, height: 900 } : { width: 640, height: 400 }, deviceScaleFactor: host ? 2 : 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
  await page.addInitScript(name => { localStorage.setItem('cs6_name', name); localStorage.setItem('cs6_music', '0'); }, name);
  await page.goto(url);
  await wait(page, () => !!window.__game);
  // Guests stay on Low: only the host's view is measured.
  if (!host) await page.evaluate(() => window.__game.hud.onUiAction('gfxPreset', 'low', new Event('click')));
  await page.locator('[data-act="online"]').click();
  return page;
}
const summary = { url, presets: {} };
try {
  const host = await open('Host', true), guests = [await open('Guest A', false), await open('Guest B', false)];
  if (await host.locator('[data-act="onlineMode"][data-mode="flag"]').count()) await host.locator('[data-act="onlineMode"][data-mode="flag"]').click();
  else await host.getByRole('button', { name: 'Flag Hold', exact: true }).click();
  await host.locator('input[value="private"]').check();
  await host.locator('[data-act="create"]').click();
  await wait(host, () => window.__game.gs.state === 'lobby');
  const code = await host.evaluate(() => window.__game.net.code);
  for (const guest of guests) {
    await guest.locator('[data-act="joinCode"]').fill(code);
    await guest.locator('[data-act="join"]').click();
    await wait(guest, () => (window.__game.gs.state === 'lobby' || window.__game.gs.state === 'play') && window.__game.lobby.players.has(window.__game.net.id));
  }
  await host.locator('[data-act="startMatch"]').click();
  await Promise.all([host, ...guests].map(page => wait(page, () => window.__game.gs.state === 'play' && !!window.__game.gs.teamMatch)));
  await wait(host, () => window.__game.remotes.size === 2 && [...window.__game.remotes.values()].every(r => r.lastSeen > 0));
  const ids = await Promise.all(guests.map(guest => guest.evaluate(() => window.__game.net.id)));
  const teams = await host.evaluate(ids => ids.map(id => window.__game.remotes.get(id).team), ids);
  assert.deepEqual([...teams].sort(), [1, 2], 'one guest on each team');
  const start = await host.evaluate(() => window.__game.player.body.pos.toArray());
  for (const preset of presets) {
    await host.evaluate(preset => window.__game.hud.onUiAction('gfxPreset', preset, new Event('click')), preset);
    await wait(host, () => {
      const r = window.__game.ctx.renderer;
      return !r.skyPending && !r.texturesPending && !r.bakePending && !r.bakeFading && !r.weaponsPending && !r.operatorsPending && !(r.propsPending ?? false);
    }, null, 90_000);
    summary.presets[preset] = {};
    for (const range of RANGES) {
      // The guests side by side facing the host, which looks straight at them: they walk in and out of view as the
      // host's preset changes, so an operator is put on at a settings change or out of view (render/operators.ts).
      await Promise.all(guests.map((guest, i) => guest.evaluate(({ start, i, range }) => {
        const g = window.__game;
        g.player.body.pos.set(start[0] + (i ? 0.9 : -0.9) * range / 10, start[1], start[2] - range);
        g.player.body.vel.set(0, 0, 0);
        g.player.yaw = Math.PI; g.player.pitch = 0;
      }, { start, i, range })));
      await pause(1500);
      await host.evaluate(start => {
        const g = window.__game;
        g.player.body.pos.fromArray(start); g.player.body.vel.set(0, 0, 0);
        g.player.yaw = 0; g.player.pitch = 0;
        g.hud.hideScreen?.();
      }, start);
      await pause(400);
      await host.screenshot({ path: `${out}/${preset}-${range}.png`, scale: 'css' });
      summary.presets[preset][range] = await host.evaluate(ids => {
        const g = window.__game, renderer = g.ctx.renderer, context = renderer.three.getContext(), camera = g.ctx.camera;
        renderer.render(g.gs.time, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
        const w = context.drawingBufferWidth, h = context.drawingBufferHeight;
        const read = (p, half) => {
          const x = Math.round((p.x + 1) / 2 * w), y = Math.round((p.y + 1) / 2 * h), size = 2 * half + 1, px = new Uint8Array(size * size * 4);
          context.readPixels(x - half, y - half, size, size, context.RGBA, context.UNSIGNED_BYTE, px);
          const c = [0, 0, 0];
          for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) c[k] += px[i + k];
          return c.map(v => v / (size * size));
        };
        const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        const measure = id => {
          const r = g.remotes.get(id), V = r.body.pos.constructor, root = r._figure.root;
          root.updateMatrixWorld(true);
          const foot = root.position.clone(), top = foot.clone().setY(foot.y + 1.8);
          const tall = Math.abs(top.clone().project(camera).y - foot.clone().project(camera).y) * h / 2;
          const chest = read(foot.clone().setY(foot.y + 1.25).project(camera), Math.max(1, Math.round(tall / 12)));
          const sides = [0.8, -0.8].map(dx => luma(read(foot.clone().add(new V(dx, 1.1, 0)).project(camera), Math.max(1, Math.round(tall / 10)))));
          const background = (sides[0] + sides[1]) / 2;
          return { team: r.team, worn: !!r._figure.rig?.worn, chest: chest.map(v => Math.round(v)), chestLuma: +luma(chest).toFixed(1),
            background: +background.toFixed(1), contrast: +Math.abs(luma(chest) - background).toFixed(1) };
        };
        const seen = ids.map(measure);
        // The same view with the flat look's figures (fe14d35's on every tier): each operator hidden, its flat model drawn.
        const rigs = ids.map(id => g.remotes.get(id)._figure.rig).filter(rig => rig?.worn);
        const swap = flat => {
          for (const rig of rigs) {
            rig.root.getObjectByName('operator').visible = !flat;
            for (const mesh of rig.low) mesh.layers.set(flat ? 0 : 30);
          }
        };
        swap(true);
        renderer.render(g.gs.time, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
        const flat = ids.map(measure);
        swap(false);
        return seen.map((r, i) => ({ ...r, flat: rigs.length ? flat[i] : null }));
      }, ids);
      console.log(preset.padEnd(7), `${range} m`, summary.presets[preset][range].map(r =>
        `team ${r.team}${r.worn ? ' (operator)' : ''}: chest ${r.chest.join('/')} luma ${r.chestLuma} vs bg ${r.background} (${r.contrast}${r.flat ? `, flat ${r.flat.contrast}` : ''})`).join('; '));
    }
  }
  summary.errors = errors;
  await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 1));
  assert.deepEqual(errors, [], 'no browser errors');
  const unreadable = [];
  for (const [preset, views] of Object.entries(summary.presets)) {
    if (preset === 'low') continue;
    for (const [range, guestsSeen] of Object.entries(views)) {
      guestsSeen.forEach((r, i) => {
        const key = `${preset} ${range} m team ${r.team}`;
        if (!r.worn) unreadable.push(`${key}: not wearing its operator`);
        if (r.flat && r.contrast < r.flat.contrast) unreadable.push(`${key}: chest contrast ${r.contrast} (the flat look ${r.flat.contrast})`);
        const [red, , blue] = r.chest, hue = r.team === 1 ? red - blue : blue - red;
        if (hue < READABLE.hue) unreadable.push(`${key}: team hue ${hue}`);
      });
    }
  }
  assert.deepEqual(unreadable, [], 'remote players read at least as well as on Low and show their team');
} finally {
  await browser.close();
}

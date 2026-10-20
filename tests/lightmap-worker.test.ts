import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { Renderer } from '@/engine/render/index';
import { LIGHTMAP_SIZE, bakeFor, bakedTriangles, layoutLightmap, lightmapCharts, runSteps } from '@/engine/render/lightmap';
import { postLayout } from '@/engine/render/lightmapJob';
import { bakeLayoutSteps, laidOut, layoutRequest, replyTransfer, runLayoutRequest } from '@/engine/render/lightmapLayout';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { LaidOut, LayoutReply } from '@/engine/render/lightmapLayout';
import type { LayoutTicket } from '@/engine/render/lightmapJob';
import type { Level } from '@/engine/types';

/** Every map and variant with its own bake (tests/lightmaps.test.ts `MAPS`). */
const MAPS = [['downtown', false], ['downtown', true], ['house', false], ['mexico', false], ['training', false]] as const;
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function build(key: string, arena = false): Level {
  const scene = new THREE.Scene(), world = new World();
  const level = buildLevel(scene, world, key, { arena });
  cleanup.push(() => disposeLevel(scene, level));
  return level;
}

const bytes = (array: Float32Array): Uint8Array => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** Two layouts' `uv1` byte for byte, and the counts the manifest checks. */
function expectSame(a: LaidOut | null, b: LaidOut | null, label: string): void {
  expect(a, label).not.toBeNull();
  expect(b, label).not.toBeNull();
  expect([a!.charts, a!.rows, a!.triangles], label).toEqual([b!.charts, b!.rows, b!.triangles]);
  expect(a!.uvs.length, label).toBe(b!.uvs.length);
  a!.uvs.forEach((uv, i) => {
    expect(uv.length, `${label} surface ${i}`).toBe(b!.uvs[i]!.length);
    expect(bytes(uv).every((v, k) => v === bytes(b!.uvs[i]!)[k]), `${label} surface ${i}`).toBe(true);
  });
}

async function settle(ticket: LayoutTicket): Promise<void> {
  const until = performance.now() + 50_000;
  while (!ticket.done && !ticket.failed && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
}

test('the worker\'s layout, through a structured clone each way, is the main thread\'s to the byte on every map', () => {
  for (const [key, arena] of MAPS) {
    const level = build(key, arena), bake = bakeFor(level)!, label = bake.name;
    const triangles = bakedTriangles(level.surfaces);
    // The old path: the chart pass and packing at once, and in the renderer's steps.
    const once = laidOut(layoutLightmap(lightmapCharts(level.surfaces, level.bounds, triangles), LIGHTMAP_SIZE, bake.info.density));
    const stepped = laidOut(runSteps(bakeLayoutSteps(level.surfaces, level.bounds, triangles, bake.info.density)));
    expectSame(stepped, once, `${label} steps`);
    expect([once!.charts, once!.rows, once!.triangles], label).toEqual([bake.info.charts, bake.info.rows, bake.info.triangles]);
    // The worker's: the request cloned in, the reply's buffers moved out.
    const request = structuredClone(layoutRequest(7, triangles, level.bounds, bake.info.density));
    expect(request.positions).not.toBe(triangles.positions);
    const reply: LayoutReply = { job: request.job, layout: runLayoutRequest(request) };
    const transfer = replyTransfer(reply);
    expect(transfer.length).toBe(triangles.surfaces.length);
    const received = structuredClone(reply, { transfer });
    // Moved, not copied: the sender's buffers are detached.
    expect(reply.layout!.uvs.every(uv => uv.byteLength === 0)).toBe(true);
    expect(received.job).toBe(7);
    expectSame(received.layout, once, `${label} worker`);
    // The main thread's triangles are untouched by the request.
    expect(bakedTriangles(level.surfaces).positions).toEqual(triangles.positions);
  }
});

// The worker's first start compiles its module (three, the manifest): seconds under a loaded suite.
test('the real worker answers with the same bytes, and the renderer takes them in one slot without Math.random', async () => {
  for (const [key, arena] of [['house', false], ['mexico', false]] as const) {
    const level = build(key, arena), bake = bakeFor(level)!;
    const triangles = bakedTriangles(level.surfaces);
    const ticket = postLayout(triangles, level.bounds, bake.info.density);
    expect(ticket).not.toBeNull();
    await settle(ticket!);
    expect(ticket!.failed).toBe(false);
    expect(ticket!.done).toBe(true);
    const once = laidOut(layoutLightmap(lightmapCharts(level.surfaces, level.bounds, triangles), LIGHTMAP_SIZE, bake.info.density));
    expectSame(ticket!.layout, once, `${bake.name} worker`);
  }

  // The renderer: `_checkBake` posts it, `_layBake` takes the answer in one call, and `uv1` is the old layout's.
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  const level = build('downtown'), bake = bakeFor(level)!;
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.high);
  const random = vi.spyOn(Math, 'random');
  renderer._checkBake();
  const pending = renderer._bakeLayout!;
  expect(pending.ticket).not.toBeNull();
  await settle(pending.ticket!);
  expect(pending.ticket!.done).toBe(true);
  expect(renderer._layBake()).toBe(true);
  expect(random).not.toHaveBeenCalled();
  random.mockRestore();
  expect(renderer._bakeLayout).toBeNull();
  expect(renderer._bake?.name).toBe(bake.name);
  const uv1 = level.surfaces.filter(s => s.static).map(s => s.mesh.geometry.getAttribute('uv1').array as Float32Array);
  const once = laidOut(layoutLightmap(lightmapCharts(level.surfaces, level.bounds), LIGHTMAP_SIZE, bake.info.density));
  expectSame({ ...once!, uvs: uv1 }, once, 'downtown uv1');
}, 90_000);

test('with no worker answer the renderer lays the bake out in its steps, to the same bytes', () => {
  const renderer = new Renderer(document.createElement('canvas'));
  cleanup.push(() => renderer.dispose());
  const level = build('house'), bake = bakeFor(level)!;
  renderer.setSurfaces(level.surfaces, level);
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer._checkBake();
  // As with no Worker, or one that failed: the ticket never fills.
  renderer._bakeLayout!.ticket = { job: -1, done: false, failed: true, layout: null };
  let slots = 1;
  while (!renderer._layBake()) slots++;
  expect(slots).toBeGreaterThan(1);
  expect(renderer._bake?.name).toBe(bake.name);
  const uv1 = level.surfaces.filter(s => s.static).map(s => s.mesh.geometry.getAttribute('uv1').array as Float32Array);
  const once = laidOut(layoutLightmap(lightmapCharts(level.surfaces, level.bounds), LIGHTMAP_SIZE, bake.info.density));
  expectSame({ ...once!, uvs: uv1 }, once, 'house uv1');
});

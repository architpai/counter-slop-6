import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { FENCE_TIMEOUT_MS, GpuFences, MATCH_QUIET_MS, MAX_FRAMES_IN_FLIGHT, MatchClock } from '@/engine/render/pacing';
import { Renderer } from '@/engine/render/index';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { FenceGL } from '@/engine/render/pacing';

/** Fences a test signals by hand, in order, like a GPU. */
function fakeGL(): FenceGL & { signal(n: number): void; live: Set<object>; lost: boolean } {
  const pending: object[] = [];
  const live = new Set<object>();
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, SYNC_STATUS: 2, UNSIGNALED: 3, SIGNALED: 4,
    live, lost: false,
    fenceSync: () => { const sync = {}; pending.push(sync); live.add(sync); return sync as WebGLSync; },
    getSyncParameter: (sync: WebGLSync) => (gl.lost ? null : pending.includes(sync) ? gl.UNSIGNALED : gl.SIGNALED),
    deleteSync: (sync: WebGLSync | null) => { if (sync) live.delete(sync); },
    signal: (n: number) => { pending.splice(0, n); },
  };
  return gl;
}

test('the GPU counts as behind with MAX_FRAMES_IN_FLIGHT frames unfinished, and every fence is freed', () => {
  const gl = fakeGL(), fences = new GpuFences(gl);
  expect(MAX_FRAMES_IN_FLIGHT).toBe(6);
  for (let i = 0; i < MAX_FRAMES_IN_FLIGHT - 1; i++) fences.mark(i);
  expect(fences.behind(10)).toBe(false);
  fences.mark(10);
  expect(fences.inFlight(11)).toBe(MAX_FRAMES_IN_FLIGHT);
  expect(fences.behind(11)).toBe(true);
  // The GPU finishes the first frame: one fewer in flight, the next frame runs.
  gl.signal(1);
  expect(fences.inFlight(12)).toBe(MAX_FRAMES_IN_FLIGHT - 1);
  expect(fences.behind(12)).toBe(false);
  expect(gl.live.size).toBe(MAX_FRAMES_IN_FLIGHT - 1);
  gl.signal(MAX_FRAMES_IN_FLIGHT);
  expect(fences.inFlight(13)).toBe(0);
  expect(gl.live.size).toBe(0);
});

test('a fence that never signals stops holding frames back after FENCE_TIMEOUT_MS, and a lost context holds none', () => {
  const gl = fakeGL(), fences = new GpuFences(gl);
  fences.mark(0);
  for (let i = 1; i < MAX_FRAMES_IN_FLIGHT; i++) fences.mark(10 * i);
  expect(fences.behind(FENCE_TIMEOUT_MS - 1)).toBe(true);
  // The oldest timed out; the ones after it are younger, so they stay in flight.
  expect(fences.inFlight(FENCE_TIMEOUT_MS)).toBe(MAX_FRAMES_IN_FLIGHT - 1);
  expect(fences.behind(FENCE_TIMEOUT_MS)).toBe(false);
  fences.mark(100);
  gl.lost = true;
  expect(fences.inFlight(110)).toBe(0);
  // Renders outside the frame loop (a benchmark's) keep a bounded list.
  gl.lost = false;
  for (let i = 0; i < 100; i++) fences.mark(150);
  expect(gl.live.size).toBeLessThanOrEqual(12);
  fences.clear();
  expect(gl.live.size).toBe(0);
});

test('a match is quiet for MATCH_QUIET_MS after it goes live, each time it does', () => {
  const clock = new MatchClock();
  expect([clock.live, clock.quiet(0)]).toEqual([false, false]);
  clock.set(true, 1000);
  expect([clock.live, clock.quiet(1000), clock.quiet(1000 + MATCH_QUIET_MS - 1), clock.quiet(1000 + MATCH_QUIET_MS)]).toEqual([true, true, true, false]);
  // Staying live does not restart it; a pause and a resume does.
  clock.set(true, 5000);
  expect(clock.quiet(5000)).toBe(false);
  clock.set(false, 6000);
  expect(clock.quiet(6000)).toBe(false);
  clock.set(true, 7000);
  expect(clock.quiet(7000 + MATCH_QUIET_MS - 1)).toBe(true);
});

test('the view models compile and draw once at the menu, not in a match, and again after a look change', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const program = (material: THREE.Material) => (renderer.three.properties.get(material) as { currentProgram?: unknown }).currentProgram;
  // A holstered gun: in the rig, hidden. And a character template, never in the scene.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: 0x123456 }));
  gun.visible = false;
  renderer.rig.add(gun);
  const figure = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial());
  renderer.prewarm(figure);
  renderer.setLive(true);
  renderer.render(0, fx);
  expect(program(gun.material)).toBeUndefined();
  expect(program(figure.material)).toBeUndefined();
  // The menu: compiled, then drawn once with the gun shown for that one render only.
  renderer.setLive(false);
  const drawn = new Set<THREE.Object3D>();
  gun.onBeforeRender = () => { drawn.add(gun); };
  renderer.render(0, fx);
  expect(program(gun.material)).toBeDefined();
  expect(program(figure.material)).toBeDefined();
  // The draw waits for the compile to finish off the frame.
  for (let i = 0; i < 200 && !(drawn.has(gun) && renderer._warmups.length === 0); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    renderer.render(0, fx);
  }
  expect(drawn.has(gun)).toBe(true);
  expect(renderer._warmups).toHaveLength(0);
  expect(gun.visible).toBe(false);
  expect(figure.parent).toBeNull();
  // A look change compiles them again for it, again not while a match is live.
  renderer.applyQuality(PRESET_VALUES.medium);
  expect(renderer._programsWarm).toBe(false);
  renderer.setLive(true);
  renderer.render(0, fx);
  expect(renderer._programsWarm).toBe(false);
  renderer.setLive(false);
  renderer.render(0, fx);
  expect(renderer._programsWarm).toBe(true);
  renderer.dispose();
  canvas.remove();
}, 60_000);

test('a GPU behind skips frames only while something streams in', () => {
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  renderer.applyQuality(PRESET_VALUES.low);
  vi.spyOn(renderer._fences, 'behind').mockReturnValue(true);
  // Steady state: a skipped frame would only add a display interval (render/pacing.ts).
  expect(renderer.streaming).toBe(false);
  expect(renderer.gpuBehind).toBe(false);
  let pending = true;
  Object.defineProperty(renderer, 'texturesPending', { get: () => pending });
  expect(renderer.gpuBehind).toBe(true);
  pending = false;
  expect(renderer.gpuBehind).toBe(false);
  renderer.dispose();
});

test('in a live match past its quiet start, the weapons\' warm-up draws one a frame; the rig\'s waits for a menu', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const drawn: THREE.Object3D[] = [];
  const mesh = () => {
    const made = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
    made.onBeforeRender = () => { drawn.push(made); };
    return made;
  };
  // Two templates whose glb landed after Start (compiled already), and the rig's warm-up, held from a menu.
  const template = mesh(), second = mesh();
  const gun = mesh();
  gun.visible = false;
  renderer.rig.add(gun);
  renderer.setLive(true);
  const first = renderer._hold(renderer._warmups, template, () => true, true);
  void renderer._hold(renderer._warmups, second, () => true, true);
  void renderer._hold(renderer._warmups, renderer.rig, () => true);
  renderer.render(0, fx);
  expect(drawn, 'nothing in the quiet start').toEqual([]);
  renderer._match.set(false, 0);
  renderer._match.set(true, performance.now() - MATCH_QUIET_MS);
  renderer.render(0, fx);
  expect(drawn).toEqual([template]);
  expect(template.parent).toBeNull();
  renderer.render(0, fx);
  await first;
  expect(drawn).toEqual([template, second]);
  renderer.render(0, fx);
  renderer.render(0, fx);
  expect(renderer._warmups.map(w => w.root)).toEqual([renderer.rig]);
  expect(drawn).not.toContain(gun);
  // The pause menu draws it, the holstered gun shown for that one render.
  renderer.setLive(false);
  renderer.render(0, fx);
  expect(drawn).toContain(gun);
  expect(gun.visible).toBe(false);
  renderer.dispose();
  canvas.remove();
}, 60_000);

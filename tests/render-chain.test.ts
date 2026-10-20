import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CHECK_SHADER_ERRORS, Renderer, SLOT_BYTES, UPLOAD_GAP_MS, roomEnvironment } from '@/engine/render/index';
import { MATCH_QUIET_MS } from '@/engine/render/pacing';
import { spriteGeometry, spriteMaterial } from '@/engine/render/fx';
import { bladeBlood } from '@/engine/render/blade-blood';
import { weaponMaterial } from '@/engine/render/materials';
import { Composite, RIG_DEPTH } from '@/engine/render/postfx';
import { PRESETS, PRESET_VALUES } from '@/engine/render/quality';
import { aimShadowBox, cascadeCentre, sizeShadowBox } from '@/engine/render/shadows';
import { loadSky } from '@/engine/render/sky';
import type { PostConfig } from '@/engine/render/postfx';
import type { PresetName } from '@/engine/render/quality';
import type { SkySource } from '@/engine/render/sky';
import type { Mood } from '@/engine/types';

// The real loader, wrapped so a test can hold a sky back and land it when it likes.
vi.mock('@/engine/render/sky', async importOriginal => {
  const actual = await importOriginal<typeof import('@/engine/render/sky')>();
  return { ...actual, loadSky: vi.fn(actual.loadSky) };
});

const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0)) done(); });

function makeRenderer(): Renderer {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  return renderer;
}

/** The post passes one frame runs, by material name, plus SMAA when it runs. */
function passes(renderer: Renderer): string[] {
  const names: string[] = [];
  const post = renderer.post, pass = post._pass.bind(post), antialias = post._antialias.bind(post);
  const spy = vi.spyOn(post, '_pass').mockImplementation((three, material, target) => { names.push(material.name); pass(three, material, target); });
  const smaa = vi.spyOn(post, '_antialias').mockImplementation((three, pass, target) => { names.push('smaa'); antialias(three, pass, target); });
  renderer.render(0, fx);
  spy.mockRestore();
  smaa.mockRestore();
  return names;
}

/**
 * One frame's renders of the post scene, and its passes (SMAA's render their own quad). Ultra runs the chain inside
 * one render (`Composite._oneRender`); Low, Medium and High render each pass. No hook stays on the scene.
 */
function postRenders(renderer: Renderer): { renders: number; passes: number } {
  const post = renderer.post, render = vi.spyOn(renderer.three, 'render'), pass = vi.spyOn(post, '_pass');
  renderer.render(0, fx);
  const renders = render.mock.calls.filter(([scene]) => scene === post.scene).length, passes = pass.mock.calls.length;
  render.mockRestore();
  pass.mockRestore();
  expect(post.scene.onAfterRender).toBe(THREE.Object3D.prototype.onAfterRender);
  expect([post._chainCamera, post._inChain, post._final.visible]).toEqual([null, false, true]);
  return { renders, passes };
}

const bloom = ['post:bloom-prefilter', ...Array(4).fill('post:bloom-down'), ...Array(4).fill('post:bloom-up')];
const expected: Record<PresetName, { config: Omit<PostConfig, 'samples'>; samples: number; chain: string[]; lights: number; soft: boolean }> = {
  // Low: the phase-1 single pass (FXAA, soft shoulder, grade, feedback), one shadow box.
  low: { config: { look: 'lowpoly', fxaa: true, smaa: false, ao: 0, depth: false, bloom: false, shafts: false }, samples: 0, chain: ['post:composite'], lights: 1, soft: false },
  medium: { config: { look: 'realistic', fxaa: false, smaa: true, ao: 0, depth: false, bloom: true, shafts: false }, samples: 2,
    chain: [...bloom, 'post:agx', 'smaa', 'post:final'], lights: 1, soft: true },
  high: { config: { look: 'realistic', fxaa: false, smaa: true, ao: 0.5, depth: true, bloom: true, shafts: false }, samples: 2,
    chain: ['post:gtao', 'post:ao-blur', ...bloom, 'post:agx', 'smaa', 'post:final'], lights: 2, soft: true },
  ultra: { config: { look: 'realistic', fxaa: false, smaa: true, ao: 1, depth: true, bloom: true, shafts: true }, samples: 4,
    chain: ['post:gtao', 'post:ao-blur', ...bloom, 'post:agx', 'smaa', 'post:final'], lights: 3, soft: true },
};

test('each preset reaches the renderer: passes, tone mapping, MSAA, AO depth, cascades', () => {
  const renderer = makeRenderer();
  // three checks every program's link here (off only in a production build), so the check below has logs to read.
  expect(CHECK_SHADER_ERRORS).toBe(true);
  expect(renderer.three.debug.checkShaderErrors).toBe(true);
  const maxSamples = renderer.three.capabilities.maxSamples;
  // A lit, shadowed floor and box in view, so every preset compiles the (cascaded) lighting chunk.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshLambertMaterial());
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  floor.receiveShadow = box.castShadow = box.receiveShadow = true;
  box.position.set(0, 1, -4);
  renderer.scene.add(floor, box);
  renderer.camera.position.set(0, 1.6, 0);
  for (const name of PRESETS) {
    renderer.applyQuality(PRESET_VALUES[name]);
    const want = expected[name];
    expect(renderer.post.config).toEqual({ ...want.config, samples: Math.min(want.samples, maxSamples) });
    // The pass chain, which also names the tone mapper: the soft shoulder lives in the
    // composite (Low), AgX in its own pass (realistic).
    expect(passes(renderer), name).toEqual(want.chain);
    // The post chain in one render on Ultra only; Low, Medium and High render each pass, as before Round 6.
    const fast = name === 'ultra';
    expect([renderer._fightCpu, renderer.post._oneRender], name).toEqual([fast, fast]);
    const { renders, passes: count } = postRenders(renderer);
    expect(count, name).toBe(want.chain.filter(pass => pass !== 'smaa').length);
    expect(renders, name).toBe(fast ? 1 : count);
    expect(renderer.post.target.samples).toBe(Math.min(want.samples, maxSamples));
    // AO, the soft particles (High, Ultra) and the light shafts (Ultra) read the depth texture.
    expect(renderer.post.target.depthTexture !== null).toBe(want.config.ao > 0 || want.config.depth || want.config.shafts);
    // One shadow light per box; cascades beyond the sun are dark and shadow-only.
    const lights = [renderer.sun, ...renderer.cascades];
    expect(lights).toHaveLength(want.lights);
    for (const light of renderer.cascades) expect(light.intensity).toBe(0);
    expect(lights.every(light => light.castShadow)).toBe(true);
    expect(renderer.three.shadowMap.type).toBe(want.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap);
    expect(renderer.three.getContext().getError()).toBe(renderer.three.getContext().NO_ERROR);
    // Every program linked (three keeps a failed one's log in `diagnostics`).
    const programs = (renderer.three.info.programs ?? []) as (THREE.WebGLProgram & { diagnostics?: { runnable: boolean } })[];
    const failed = programs.filter(program => program.diagnostics && !program.diagnostics.runnable);
    expect(failed.map(program => program.name), name).toEqual([]);
  }
  // Ultra to Medium and Ultra to High mid-session: back to a render per pass at the next frame, nothing left set; and
  // back to one render on Ultra each time.
  const perPass = (preset: PresetName) => expected[preset].chain.filter(pass => pass !== 'smaa').length;
  for (const name of ['medium', 'high'] as const) {
    renderer.applyQuality(PRESET_VALUES[name]);
    expect([renderer._fightCpu, renderer.post._oneRender], name).toEqual([false, false]);
    expect(postRenders(renderer), name).toEqual({ renders: perPass(name), passes: perPass(name) });
    renderer.applyQuality(PRESET_VALUES.ultra);
    expect([renderer._fightCpu, renderer.post._oneRender], name).toEqual([true, true]);
    expect(postRenders(renderer), name).toEqual({ renders: 1, passes: perPass('ultra') });
  }
  // A custom set with Ultra's values is Ultra; any other custom set keeps the old paths.
  renderer.applyQuality({ ...PRESET_VALUES.ultra });
  expect(renderer._fightCpu).toBe(true);
  renderer.applyQuality({ ...PRESET_VALUES.ultra, fpsTarget: 60 });
  expect([renderer._fightCpu, renderer.post._oneRender]).toEqual([false, false]);
  expect(postRenders(renderer).renders).toBeGreaterThan(1);
  // Off frees every shadow light but the sun, which stops casting.
  renderer.applyQuality({ ...PRESET_VALUES.ultra, shadows: 'off' });
  expect(renderer.cascades).toHaveLength(0);
  expect(renderer.sun.castShadow).toBe(false);
  // AO, bloom and SMAA also work on the flat look: the composite does AO and bloom, SMAA follows it.
  renderer.applyQuality({ ...PRESET_VALUES.low, ao: 'half', bloom: true, antialias: 'smaa' });
  expect(passes(renderer)).toEqual(['post:gtao', 'post:ao-blur', ...bloom, 'post:composite', 'smaa']);
  // A realistic look with FXAA sharpens nothing and anti-aliases in the final pass.
  renderer.applyQuality({ ...PRESET_VALUES.medium, antialias: 'fxaa', bloom: false });
  expect(passes(renderer)).toEqual(['post:agx', 'post:final']);
  expect('FXAA' in renderer.post._final.defines).toBe(true);
  // It compiles every preset's programs: about 5 s alone, three times that beside the other GPU tests.
}, 60_000);

test('soft particles draw into their own layer; a GPU that renders MSAA straight into textures dithers with MSAA on', () => {
  const renderer = makeRenderer();
  renderer.applyQuality(PRESET_VALUES.ultra);
  expect([renderer.msaaDepthReadable, renderer._softFx]).toEqual([true, true]);
  // Something soft in view: the scene target is drawn once, the layer once, and the passes lay it over.
  const puff = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }));
  puff.position.set(0, 1.6, -3);
  renderer.fxScene.add(puff);
  renderer.camera.position.set(0, 1.6, 0);
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  const setTarget = renderer.three.setRenderTarget.bind(renderer.three);
  const spy = vi.spyOn(renderer.three, 'setRenderTarget').mockImplementation((target, ...rest) => { targets.push(target as THREE.WebGLRenderTarget | null); setTarget(target, ...rest); });
  const on: number[] = [];
  puff.onBeforeRender = () => { on.push(renderer.post._softUniforms.softOn.value); };
  renderer.render(0, fx);
  spy.mockRestore();
  expect(targets).toContain(renderer.post._soft);
  expect(on).toEqual([0]);
  // Its frame only: the next frame without anything soft lays nothing over.
  expect(renderer.post._softUniforms.softOn.value).toBe(0);
  expect('SOFT' in renderer.post._tone.defines && 'SOFT' in renderer.post._prefilter.defines).toBe(true);
  expect(renderer.three.getContext().getError()).toBe(renderer.three.getContext().NO_ERROR);
  // Without MSAA it reads the target's own depth texture, which it does not draw into.
  renderer.applyQuality({ ...PRESET_VALUES.ultra, antialias: 'fxaa' });
  expect(renderer._softFx).toBe(true);
  // With WEBGL_multisampled_render_to_texture three attaches the depth texture to the multisampled
  // framebuffer itself, and a tiled GPU need not keep it: with MSAA on, the smoke dithers.
  const has = renderer.three.extensions.has.bind(renderer.three.extensions);
  const ext = vi.spyOn(renderer.three.extensions, 'has').mockImplementation(name => name === 'WEBGL_multisampled_render_to_texture' || has(name));
  renderer.applyQuality(PRESET_VALUES.ultra);
  expect([renderer.msaaDepthReadable, renderer._softFx]).toEqual([false, false]);
  expect('SOFT' in renderer.post._tone.defines).toBe(false);
  renderer.applyQuality({ ...PRESET_VALUES.ultra, antialias: 'smaa' });
  expect(renderer._softFx).toBe(true);
  ext.mockRestore();
  puff.geometry.dispose();
  // It compiles the realistic presets' post passes: a few seconds alone, more beside the other GPU tests.
}, 60_000);

// About 2 s alone; beside the suite's streaming tests in the one browser it has taken 14-17 s (c2c96cf's 14).
test('the soft sprites and the light shafts link at the menu: a first smoke, fire and look at the sun link nothing', async () => {
  const renderer = makeRenderer(), three = renderer.three;
  renderer.camera.position.set(0, 1.6, 0);
  // The pools' draws: one instance of each soft sprite in front of the eye, in the soft layer's scene.
  const pools = (['soft', 'fire-soft'] as const).map(kind => {
    const geometry = spriteGeometry(1);
    geometry.instanceCount = 1;
    (geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute).setXYZW(0, 0, 1.6, -3, 1);
    (geometry.getAttribute('iColor') as THREE.InstancedBufferAttribute).setXYZW(0, 1, 1, 1, 1);
    const mesh = new THREE.Mesh(geometry, spriteMaterial(kind));
    mesh.frustumCulled = false;
    mesh.visible = false;
    renderer.fxScene.add(mesh);
    cleanup.push(() => geometry.dispose());
    return mesh;
  });
  for (const name of ['high', 'ultra'] as const) {
    renderer.applyQuality(PRESET_VALUES[name]);
    expect([renderer._softFx, renderer.post.config.shafts], name).toEqual([true, name === 'ultra']);
    renderer.post.setShafts(0, new THREE.Vector3(0, 0, -1), new THREE.Color(1, 1, 1));
    for (const mesh of pools) mesh.visible = false;
    const targets: unknown[] = [];
    const setTarget = three.setRenderTarget.bind(three);
    const spy = vi.spyOn(three, 'setRenderTarget').mockImplementation((target, ...rest) => { targets.push(target); setTarget(target, ...rest); });
    for (let i = 0; i < 100 && (i < 2 || renderer._compiles.length + renderer._warmups.length > 0); i++) {
      renderer.render(0, fx);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    spy.mockRestore();
    expect(renderer._compiles.length + renderer._warmups.length, name).toBe(0);
    // The late template drew once in the soft layer (and left its scene as it was); on Ultra the shafts into their spare target.
    expect(targets, name).toContain(renderer.post._soft);
    expect(targets.includes(renderer.post._shafts[1]), name).toBe(name === 'ultra');
    expect(renderer.fxScene.children.length === pools.length && renderer.fxScene.children.every((child, i) => child === pools[i]), name).toBe(true);
    const programs = three.info.programs!.length;
    // A fight: smoke and fire in the soft layer, and on Ultra the sun in view with the map's shafts on. A new fog
    // object (as a shadow relink makes) has three key the sprites' programs again, in the layer's scene.
    renderer.scene.fog = (renderer.scene.fog as THREE.Fog).clone();
    for (const mesh of pools) mesh.visible = true;
    renderer.post.setShafts(1, new THREE.Vector3(0, 0, -1), new THREE.Color(1, 1, 1));
    const pass = vi.spyOn(renderer.post, '_pass');
    renderer.render(0, fx);
    const drawn = pass.mock.calls.map(([, material]) => material.name);
    pass.mockRestore();
    expect(drawn.includes('post:shaft-mask') && drawn.includes('post:shaft-blur'), name).toBe(name === 'ultra');
    expect(three.info.programs!.length, name).toBe(programs);
  }
  expect(three.getContext().getError()).toBe(three.getContext().NO_ERROR);
}, 60_000);

test('a first air-slash wave or ban ring, and the Blender sword\'s blade, link nothing after the menu', async () => {
  const renderer = makeRenderer(), three = renderer.three;
  renderer.camera.position.set(0, 1.6, 0);
  // The Blender sword's set material as the weapons' glb makes it, compiled as their warm-up compiles it.
  const { material: steel } = weaponMaterial('sword');
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.8), steel);
  blade.position.set(0, 1.6, -2);
  cleanup.push(() => { blade.geometry.dispose(); steel.dispose(); });
  for (const name of ['low', 'ultra'] as const) {
    renderer.applyQuality(PRESET_VALUES[name]);
    for (let i = 0; i < 100 && (i < 2 || renderer._compiles.length + renderer._warmups.length > 0); i++) {
      renderer.render(0, fx);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(renderer._compiles.length + renderer._warmups.length, name).toBe(0);
    renderer.scene.add(blade);
    three.compile(blade, renderer.camera, renderer.scene);
    renderer.render(0, fx);
    const programs = three.info.programs!.length;
    // Two waves (or rings) in turn, each in a material of its own that goes with it (weapons/wave.ts, enemies/hazards.ts).
    for (let k = 0; k < 2; k++) {
      const wave = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xd2ecff, transparent: true,
        opacity: 0.95, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
      wave.position.set(0, 1.6, -2);
      renderer.scene.add(wave);
      renderer.render(0, fx);
      expect(three.info.programs!.length, `${name} wave ${k}`).toBe(programs);
      wave.removeFromParent();
      wave.geometry.dispose();
      wave.material.dispose();
      renderer.render(0, fx);
      expect(three.info.programs!.length, `${name} wave ${k} gone`).toBe(programs);
    }
    // The sword built on the weapons' ready (weapons/models.ts `makeRealSwordModel`) puts its blood on: no relink.
    bladeBlood(steel, blade, 0, -0.8, 0, 0.02, true).update(0.5);
    renderer.render(0, fx);
    expect(three.info.programs!.length, `${name} sword`).toBe(programs);
    blade.removeFromParent();
  }
  expect(three.getContext().getError()).toBe(three.getContext().NO_ERROR);
}, 60_000);

test('dynamic resolution only moves viewports, a pass switched off frees its targets, and dispose frees them all', () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  cleanup.push(() => { three.dispose(); three.forceContextLoss(); });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(80, 1.6, 0.08, 420);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  camera.position.z = 3;
  const before = three.info.memory.textures;
  const post = new Composite();
  post.configure({ look: 'realistic', samples: 4, fxaa: false, smaa: true, ao: 1, depth: false, bloom: true, shafts: false });
  const frame = (): void => {
    three.setRenderTarget(post.target);
    three.clear();
    three.render(scene, camera);
    post.draw(three, 0, fx, camera);
  };
  post.resize(320, 200, 1.6);
  frame();
  const allocated = three.info.memory.textures;
  expect(allocated).toBeGreaterThan(before);
  frame();
  frame();
  expect(three.info.memory.textures).toBe(allocated);
  // A dynamic-resolution step: the same targets at the same size, drawn into a smaller corner;
  // the LDR frames after the tone pass stay full size.
  const disposed = vi.fn();
  for (const target of [post.target, post._aoRaw, post._aoBlur, post._ldr, ...post._bloom]) target.addEventListener('dispose', disposed);
  post.setScale(0.8);
  frame();
  expect(disposed).not.toHaveBeenCalled();
  expect(three.info.memory.textures).toBe(allocated);
  expect([post.target.width, post._aoRaw.width, post._bloom[0]!.width, post._ldr.width]).toEqual([320, 320, 160, 320]);
  expect([post.target.viewport.z, post._aoRaw.viewport.z, post._bloom[0]!.viewport.z, post._ldr.viewport.z]).toEqual([256, 256, 128, 320]);
  expect(post.target.scissorTest).toBe(true);
  post.configure({ ...post.config, ao: 0.5 });
  frame();
  expect([post._aoRaw.width, post._aoRaw.viewport.z]).toEqual([160, 128]);
  // AO off frees the float depth texture and both AO targets; bloom off frees its levels.
  post.configure({ ...post.config, ao: 0, bloom: false });
  frame();
  expect(post._depth).toBeNull();
  expect(post.target.depthTexture).toBeNull();
  expect(three.info.memory.textures).toBe(allocated - 3 - post._bloom.length);
  post.dispose();
  expect(three.info.memory.textures).toBe(before);
}, 60_000);

test('a reduced dynamic scale shows only this frame: nothing beyond the drawn corner bleeds in', () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  cleanup.push(() => { three.dispose(); three.forceContextLoss(); });
  three.setSize(320, 200, false);
  three.autoClear = false;
  const gl = three.getContext(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(80, 1.6, 0.08, 420);
  const post = new Composite();
  cleanup.push(() => post.dispose());
  post.resize(320, 200, 1.6);
  // The sun ahead and a little up, over open sky: the realistic config draws its light shafts too.
  post.setShafts(1, new THREE.Vector3(0.2, 0.3, -1), new THREE.Color(1, 0.9, 0.8));
  /** Clear the scene to `color`, run the chain and read the canvas back. */
  const draw = (color: number, scale: number): Uint8Array => {
    post.setScale(scale);
    three.setClearColor(color);
    three.setRenderTarget(post.target);
    three.clear();
    three.render(scene, camera);
    post.draw(three, 0, fx, camera);
    const pixels = new Uint8Array(320 * 200 * 4);
    gl.readPixels(0, 0, 320, 200, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const configs: PostConfig[] = [
    { look: 'realistic', samples: 4, fxaa: false, smaa: true, ao: 0.5, depth: false, bloom: true, shafts: true },
    { look: 'lowpoly', samples: 0, fxaa: true, smaa: false, ao: 0, depth: false, bloom: false, shafts: false },
    { look: 'lowpoly', samples: 0, fxaa: false, smaa: true, ao: 1, depth: false, bloom: true, shafts: false },
  ];
  for (const config of configs) {
    post.configure(config);
    draw(0x00ff00, 1);
    const clean = draw(0x00ff00, 0.55);
    // A full-size red frame first: the scissored clear leaves it outside the smaller corner.
    draw(0xff0000, 1);
    const after = draw(0x00ff00, 0.55);
    let differ = 0;
    for (let i = 0; i < clean.length; i++) if (clean[i] !== after[i]) differ++;
    expect(differ, `${config.look}, smaa ${config.smaa}`).toBe(0);
  }
  expect(gl.getError()).toBe(gl.NO_ERROR);
  // Under 1 s alone; beside the other GPU test files it waits its turn for the GPU (9 s at 23af3f9), so it gets the time they do.
}, 60_000);

test('the chain inside one render draws exactly what a render per pass did', () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), depth: false, stencil: false });
  cleanup.push(() => { three.dispose(); three.forceContextLoss(); });
  three.setSize(320, 200, false);
  three.autoClear = false;
  three.info.autoReset = false;
  three.shadowMap.enabled = true;
  const gl = three.getContext(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(80, 1.6, 0.08, 420);
  const bright = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 2) }));
  bright.position.set(0.4, 0, -2);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x406080 }));
  wall.position.set(-1.5, 0, -3);
  scene.add(bright, wall);
  const post = new Composite();
  cleanup.push(() => post.dispose());
  post.resize(320, 200, 1.6);
  post.setShafts(1, new THREE.Vector3(0.2, 0.3, -1), new THREE.Color(1, 0.9, 0.8));
  const frame = (perPass: boolean): { pixels: Uint8Array; calls: number; triangles: number } => {
    three.setClearColor(0x335577);
    three.setRenderTarget(post.target);
    three.clear();
    three.render(scene, camera);
    three.info.reset();
    // `draw` with every pass rendering itself (Low, Medium, High: the path before Round 6), or in one render (Ultra).
    post._oneRender = !perPass;
    post.draw(three, 0.5, fx, camera);
    expect(post.scene.onAfterRender).toBe(THREE.Object3D.prototype.onAfterRender);
    const { calls, triangles } = three.info.render;
    const pixels = new Uint8Array(320 * 200 * 4);
    gl.readPixels(0, 0, 320, 200, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels, calls, triangles };
  };
  const configs: PostConfig[] = [
    { look: 'realistic', samples: 4, fxaa: false, smaa: true, ao: 1, depth: true, bloom: true, shafts: true },
    { look: 'realistic', samples: 2, fxaa: false, smaa: true, ao: 0, depth: false, bloom: true, shafts: false },
    { look: 'realistic', samples: 0, fxaa: true, smaa: false, ao: 0, depth: false, bloom: false, shafts: false },
    { look: 'lowpoly', samples: 0, fxaa: false, smaa: true, ao: 0.5, depth: false, bloom: true, shafts: false },
  ];
  for (const config of configs) {
    post.configure(config);
    for (const scale of [1, 0.7]) {
      post.setScale(scale);
      frame(false);
      const programs = three.info.programs!.length;
      const render = vi.spyOn(three, 'render'), pass = vi.spyOn(post, '_pass');
      const chained = frame(false);
      // The scene pass, then the chain's one render (SMAA's passes render their own quad).
      expect(render.mock.calls.filter(([s]) => s === post.scene)).toHaveLength(1);
      const passes = pass.mock.calls.length;
      expect(passes).toBeGreaterThan(1);
      // The next frame's shadow maps clear their depth: the chain leaves depth writes on, as each render did.
      expect(gl.getParameter(gl.DEPTH_WRITEMASK)).toBe(true);
      render.mockClear();
      pass.mockClear();
      const perPass = frame(true);
      // A render of the post scene per pass, the same passes.
      expect(render.mock.calls.filter(([s]) => s === post.scene)).toHaveLength(passes);
      expect(pass.mock.calls.length).toBe(passes);
      render.mockRestore();
      pass.mockRestore();
      const label = `${config.look}, smaa ${config.smaa}, ao ${config.ao}, scale ${scale}`;
      expect(chained.calls, label).toBeGreaterThan(1);
      expect([chained.calls, chained.triangles], label).toEqual([perPass.calls, perPass.triangles]);
      let differ = 0;
      for (let i = 0; i < chained.pixels.length; i++) if (chained.pixels[i] !== perPass.pixels[i]) differ++;
      expect(differ, label).toBe(0);
      expect(three.info.programs!.length, label).toBe(programs);
    }
  }
  expect(gl.getError()).toBe(gl.NO_ERROR);
}, 60_000);

test('the rig draws into its own depth slice on every tier, so a transparent effect behind a wall stays hidden', async () => {
  const renderer = makeRenderer();
  const gl = renderer.three.getContext(), range = vi.spyOn(gl, 'depthRange');
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), new THREE.MeshBasicMaterial());
  gun.position.set(0.2, -0.2, -0.5);
  renderer.rig.add(gun);
  renderer.prepareRig(gun);
  // An opaque wall, and a bright transparent plane (a tracer, a decal, fire) behind it.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x808080 }));
  wall.position.z = -3;
  const behind = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  behind.position.z = -5;
  renderer.scene.add(wall, behind);
  renderer.camera.position.set(0, 0, 0);
  // Each look's first frames also compile and draw the view models once (`_warmPrograms`): a frame after those.
  const settled = async (): Promise<void> => {
    for (let i = 0; i < 100 && (i < 2 || renderer._compiles.length + renderer._warmups.length > 0); i++) {
      renderer.render(0, fx);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    range.mockClear();
    renderer.render(0, fx);
  };
  const centre = (): number[] => {
    const pixel = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  };
  for (const name of PRESETS) {
    renderer.applyQuality(PRESET_VALUES[name]);
    behind.visible = false;
    await settled();
    const wallOnly = centre();
    behind.visible = true;
    await settled();
    expect(centre(), name).toEqual(wallOnly);
    expect(range.mock.calls, name).toEqual([[0, RIG_DEPTH], [0, 1]]);
  }
}, 60_000);

test('shadow boxes stay on their texel grid, so moving the viewer never swims the shadows', () => {
  const light = new THREE.DirectionalLight();
  light.shadow.mapSize.set(2048, 2048);
  sizeShadowBox(light, 22, 80);
  const texel = 44 / 2048, sun = new THREE.Vector3(-90, 115, -160).normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(sun).normalize(), y = sun.clone().cross(x);
  const onGrid = (value: number): boolean => Math.abs(value / texel - Math.round(value / texel)) < 1e-4;
  const centre = new THREE.Vector3();
  for (const eye of [new THREE.Vector3(3.217, 1.6, -7.91), new THREE.Vector3(-41.05, 7.2, 12.333)]) {
    aimShadowBox(light, cascadeCentre(eye, new THREE.Vector3(0.3, -0.2, -0.9), 12, centre), sun, 80);
    expect(onGrid(light.target.position.dot(x)) && onGrid(light.target.position.dot(y))).toBe(true);
    // The light sits up the sun direction from its target, far enough to see every caster.
    expect(light.position.clone().sub(light.target.position).normalize().dot(sun)).toBeCloseTo(1, 6);
  }
  // The centre goes ahead along the view, flattened to the ground; straight down it stays on the eye.
  expect(cascadeCentre(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, -0.6, -0.8), 10, centre).toArray()).toEqual([1, 2, -7]);
  expect(cascadeCentre(new THREE.Vector3(1, 2, 3), new THREE.Vector3(0, -1, 0), 10, centre).toArray()).toEqual([1, 2, 3]);
  // Texel-sized normal offset: finer boxes push less.
  expect(light.shadow.normalBias).toBeCloseTo(0.9 * texel, 6);
  // The cascade branch sits beside three's own lighting, which single-light scenes still run.
  expect(THREE.ShaderChunk.lights_fragment_begin).toContain('NUM_DIR_LIGHT_SHADOWS > 1');
  expect(THREE.ShaderChunk.lights_fragment_begin).toContain('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
});

/** Hold every sky request until the test lands (or fails) it. */
function holdSkies(): { key: string; resolve: (sky: SkySource) => void }[] {
  const held: { key: string; resolve: (sky: SkySource) => void }[] = [];
  vi.mocked(loadSky).mockImplementation(key => new Promise(resolve => held.push({ key, resolve })));
  cleanup.push(() => vi.mocked(loadSky).mockReset());
  return held;
}

/** A tiny fetched sky for `key` (a flat grey equirect), and a spy on what frees it. */
function fakeSky(key: string): { sky: SkySource; freed: () => boolean } {
  const hdr = new THREE.DataTexture(new Float32Array(64 * 32 * 4).fill(0.5), 64, 32, THREE.RGBAFormat, THREE.FloatType);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  hdr.needsUpdate = true;
  const sh = [[0.4, 0.5, 0.8], ...Array.from({ length: 8 }, () => [0, 0, 0])];
  const sky: SkySource = { key, hdr, background: new THREE.DataTexture(new Uint8Array(4), 1, 1),
    data: { map: key, sunDir: [0, 1, 0], sun: [5, 4, 3], sh: sh as [number, number, number][], fog: [0.6, 0.6, 0.6], background: 1 } };
  const hdr$ = vi.spyOn(hdr, 'dispose'), background$ = vi.spyOn(sky.background, 'dispose');
  return { sky, freed: () => hdr$.mock.calls.length > 0 && background$.mock.calls.length > 0 };
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
/**
 * Render until a landed sky is on: it goes on a step a frame, in the upload slots (`_landSky`). The caps only stop a
 * hang: beside the suite's other GPU tests one 10 ms timer after a first render has taken 4.2 s, so a short wall cap
 * ran out before the first step.
 */
async function land(renderer: Renderer): Promise<number> {
  let frames = 0;
  for (const start = performance.now(); renderer._skyLanding && frames < 3000 && performance.now() - start < 60_000; frames++) {
    renderer.render(0, fx);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(renderer._skyLanding).toBeNull();
  return frames;
}
const moods: Record<'downtown' | 'house' | 'mexico', Mood> = {
  downtown: { sky: 'downtown', fog: 0xc8d6df, hemiIntensity: 0.95, sunDir: [-90, 115, -160], realistic: { exposure: -0.3 } },
  house: { sky: 'house', fog: 0xe6cdb6, hemiIntensity: 1.05, sunDir: [150, 153, 160] },
  mexico: { sky: 'mexico', fog: 0xeddbba, hemiIntensity: 1.1, sunDir: [70, 105, -150] },
};

test('a streamed sky swaps in with uniform writes only, and Low puts the mood back', async () => {
  const actual = await vi.importActual<typeof import('@/engine/render/sky')>('@/engine/render/sky');
  const held = holdSkies();
  const renderer = makeRenderer();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshLambertMaterial());
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  floor.receiveShadow = box.castShadow = true;
  box.position.set(0, 1, -4);
  renderer.scene.add(floor, box);
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer.setMood(moods.downtown);
  renderer.render(0, fx);
  renderer.render(0, fx);
  // Asked for once, on the first realistic frame; the frame never waits for it.
  expect(held.map(sky => sky.key)).toEqual(['downtown']);
  const dome = renderer.sky.material;
  expect(renderer.hemi.intensity).toBe(0.95);
  expect(renderer.probe.visible).toBe(true);
  expect(renderer.probe.sh.coefficients.every(c => c.lengthSq() === 0)).toBe(true);
  expect(renderer.scene.environment).toBe(renderer._roomEnv);
  expect('SKY_MAP' in dome.defines).toBe(false);
  const programs = new Set(renderer.three.info.programs);

  const source = await actual.loadSky('downtown');
  const hdrFreed = vi.spyOn(source.hdr, 'dispose');
  const uploads = vi.spyOn(renderer.three, 'initTexture');
  held.shift()!.resolve(source);
  await settle();
  // Its background's upload, its environment and its look each take a frame of their own.
  expect(await land(renderer)).toBeGreaterThanOrEqual(3);
  expect(uploads).toHaveBeenCalledWith(source.background);
  const sky = renderer._skyAssets!;
  expect([sky.key, sky.data, sky.background]).toEqual(['downtown', source.data, source.background]);
  expect(sky.env.texture.mapping).toBe(THREE.CubeUVReflectionMapping);
  expect(hdrFreed).toHaveBeenCalled();
  // The sky's lights replace the mood's: same light set, the PMREM shaders were compiled with the
  // request, and the dome's sky-image variant at the menu (`_skyProbe`), so no program is new.
  expect([renderer.hemi.visible, renderer.hemi.intensity]).toEqual([true, 0]);
  expect(renderer.sun.intensity).toBeCloseTo(Math.max(...sky.data.sun), 5);
  expect(renderer.probe.sh.coefficients[0]!.lengthSq()).toBeGreaterThan(0);
  // The probe keeps its brightness but only part of the sky's blue (index.ts PROBE_CHROMA).
  const dc = renderer.probe.sh.coefficients[0]!, [r, g, b] = sky.data.sh[0]!;
  expect(0.2126 * dc.x + 0.7152 * dc.y + 0.0722 * dc.z).toBeCloseTo(0.2126 * r + 0.7152 * g + 0.0722 * b, 5);
  expect(dc.z - dc.x).toBeLessThan(b - r);
  expect(renderer.scene.environment).toBe(sky.env.texture);
  expect('SKY_MAP' in dome.defines).toBe(true);
  expect(renderer._sky.skyMap.value).toBe(sky.background);
  const fog = (renderer.scene.fog as THREE.Fog).color;
  expect(fog.equals(new THREE.Color(moods.downtown.fog))).toBe(false);
  // Cool morning haze: the mood's hue survives.
  expect(fog.b).toBeGreaterThan(fog.r);
  renderer.render(0, fx);
  expect(renderer.three.info.programs!.filter(program => !programs.has(program))).toHaveLength(0);

  // Low frees the sky and the PMREM generator, and restores the mood's light, fog and environment, at exposure 1.
  renderer.applyQuality(PRESET_VALUES.low);
  expect(renderer._skyAssets).toBeNull();
  expect(renderer._pmrem).toBeNull();
  expect(renderer.hemi.intensity).toBe(0.95);
  expect(renderer.probe.visible).toBe(false);
  expect(renderer.scene.environment).toBe(renderer._roomEnv);
  // (A shadow-filter change replaces the fog object; see applyQuality.)
  expect((renderer.scene.fog as THREE.Fog).color.equals(new THREE.Color(moods.downtown.fog))).toBe(true);
  expect(renderer.post._exposure).toBe(1);
  expect('SKY_MAP' in dome.defines).toBe(false);
  renderer.render(0, fx);
  expect(held).toHaveLength(0);
}, 90_000);

test('a sky that lands after the map, the look or the renderer changed is freed', async () => {
  const held = holdSkies();
  const renderer = makeRenderer();
  // What `render` does first each frame, without drawing (and compiling) anything.
  const frame = (): void => {
    renderer._landSky();
    if (renderer._skyLoading === null && renderer.skyPending) renderer._requestSky();
  };
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer.setMood(moods.house);
  frame();
  // House is still streaming when the map changes to Mexico: nothing new is asked yet.
  renderer.setMood(moods.mexico);
  frame();
  expect(held.map(sky => sky.key)).toEqual(['house']);
  const house = fakeSky('house');
  held.shift()!.resolve(house.sky);
  await settle();
  frame();
  // Dropped, and the current map's sky requested in its place.
  expect(house.freed()).toBe(true);
  expect(renderer._skyAssets).toBeNull();
  expect(held.map(sky => sky.key)).toEqual(['mexico']);
  // Mexico lands after the switch to Low: dropped, and Low asks for nothing.
  renderer.applyQuality(PRESET_VALUES.low);
  const mexico = fakeSky('mexico');
  held.shift()!.resolve(mexico.sky);
  await settle();
  frame();
  expect(mexico.freed()).toBe(true);
  expect(renderer._skyAssets).toBeNull();
  frame();
  expect(held).toHaveLength(0);
  // Back on a realistic tier it streams again; landing after dispose frees it.
  renderer.applyQuality(PRESET_VALUES.ultra);
  frame();
  expect(held.map(sky => sky.key)).toEqual(['mexico']);
  const late = fakeSky('mexico');
  cleanup.splice(0).forEach(done => done());
  held.shift()!.resolve(late.sky);
  await settle();
  expect(late.freed()).toBe(true);
  expect(renderer._skyAssets).toBeNull();
});

test('an upload slot packs small items up to SLOT_BYTES across streams; a big one goes alone; a slow upload backs off', () => {
  const renderer = makeRenderer();
  let clock = 1000;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  cleanup.push(() => now.mockRestore());
  const queue = (sizes: number[], cost = 0) => {
    const left = [...sizes], sent: number[] = [];
    const pump = (limit: number) => {
      const next = left[0];
      if (next === undefined || next > limit) return 0;
      left.shift();
      sent.push(next);
      clock += cost;
      return next;
    };
    return { sent, pump };
  };
  const small = SLOT_BYTES / 4, big = 2 * SLOT_BYTES;
  const slot = (frame: number, ...pumps: ((limit: number) => number)[]) => {
    renderer._frame = frame;
    for (const pump of pumps) renderer._upload(pump);
  };
  renderer._uploadPace = 1;
  renderer._uploadAt = 0;
  // Three small maps of one stream and the first of the next fill a slot; the gap after it is one gap.
  const a = queue([small, small, small]), b = queue([small, small, small]);
  slot(1, a.pump, b.pump);
  expect([a.sent.length, b.sent.length]).toEqual([3, 1]);
  expect(renderer._uploadAt).toBe(1000 + UPLOAD_GAP_MS);
  // Nothing more before the gap is out, in this frame or the next.
  slot(1, b.pump);
  slot(2, b.pump);
  expect(b.sent.length).toBe(1);
  // A big map goes alone at the start of a slot, the gap after it follows its bytes, and a big map
  // behind a small one waits for the next slot.
  const c = queue([big, small, big]);
  clock = 2000;
  slot(3, c.pump, b.pump);
  expect([c.sent, b.sent.length]).toEqual([[big], 1]);
  expect(renderer._uploadAt).toBeCloseTo(2000 + big / 6e4);
  clock = 3000;
  slot(4, c.pump);
  expect(c.sent).toEqual([big, small]);
  clock = 4000;
  slot(5, c.pump);
  expect(c.sent).toEqual([big, small, big]);
  // Uploads stop joining once the slot has spent `SLOT_PACK_MS` (2 ms) uploading.
  const d = queue([small, small, small], 1.5);
  clock = 5000;
  slot(6, d.pump);
  expect(d.sent.length).toBe(2);
  // An upload slower than 4 ms doubles the pace and closes the slot.
  const e = queue([small, small], 5);
  clock = 6000;
  slot(7, e.pump, b.pump);
  expect([e.sent.length, b.sent.length, renderer._uploadPace]).toEqual([1, 1, 2]);
  expect(renderer._uploadAt).toBe(6000 + 2 * UPLOAD_GAP_MS);
});

test('a sky that lands in a match waits out its quiet start, then goes on a step a frame', async () => {
  const held = holdSkies();
  const renderer = makeRenderer();
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer.setMood(moods.house);
  renderer.render(0, fx);
  const house = fakeSky('house');
  held.shift()!.resolve(house.sky);
  await settle();
  expect(renderer._skyLanding?.key).toBe('house');
  const uploads = vi.spyOn(renderer.three, 'initTexture');
  // Each frame in a quiet start, however long the frames before took (a first frame's timer has taken 4.2 s beside
  // the suite's other GPU tests, past MATCH_QUIET_MS): the match goes live again just before it.
  for (let i = 0; i < 5; i++) {
    renderer.setLive(false);
    renderer.setLive(true);
    renderer._uploadAt = 0;
    renderer.render(0, fx);
  }
  expect(renderer._skyLanding?.uploaded).toBe(false);
  expect(uploads).not.toHaveBeenCalledWith(house.sky.background);
  // Past the quiet start: the background, then the environment, then the look, one frame each.
  renderer._match.set(false, 0);
  renderer._match.set(true, performance.now() - MATCH_QUIET_MS);
  const steps: string[] = [];
  for (let i = 0; i < 3; i++) {
    renderer._uploadAt = 0;
    renderer.render(0, fx);
    const landing = renderer._skyLanding;
    steps.push(landing === null ? 'on' : landing.env ? 'environment' : landing.uploaded ? 'background' : 'waiting');
  }
  expect(steps).toEqual(['background', 'environment', 'on']);
  expect(renderer._skyAssets?.key).toBe('house');
  // A switch to Low halfway through frees what was made so far.
  renderer.setMood(moods.mexico);
  renderer.render(0, fx);
  const mexico = fakeSky('mexico');
  held.shift()!.resolve(mexico.sky);
  await settle();
  renderer._uploadAt = 0;
  renderer.render(0, fx);
  renderer._uploadAt = 0;
  renderer.render(0, fx);
  const env = renderer._skyLanding!.env!;
  const envFreed = vi.spyOn(env, 'dispose');
  renderer.applyQuality(PRESET_VALUES.low);
  expect([mexico.freed(), envFreed.mock.calls.length > 0, renderer._skyLanding]).toEqual([true, true, null]);
}, 60_000);

test('opaque lit materials write the share of their light that AO may darken into alpha', () => {
  const three = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
  cleanup.push(() => { target.dispose(); three.dispose(); three.forceContextLoss(); });
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;
  // Sun straight onto the plane at 3, hemisphere fill at 1: a quarter of the light is ambient.
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(0, 0, 1);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0xffffff, 1));
  const plane = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial());
  scene.add(plane);
  const alpha = (): number => {
    three.setRenderTarget(target);
    three.setClearColor(0x000000, 0);
    three.clear();
    three.render(scene, camera);
    const pixels = new Float32Array(4 * 4 * 4);
    three.readRenderTargetPixels(target, 0, 0, 4, 4, pixels);
    return pixels[4 * 5 + 3]!;
  };
  expect(alpha()).toBeCloseTo(0.25, 2);
  plane.material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  expect(alpha()).toBeCloseTo(0.25, 1);
  // In the sun's shade it is all ambient; so is an unlit surface.
  sun.intensity = 0;
  expect(alpha()).toBeCloseTo(1, 5);
  sun.intensity = 3;
  plane.material = new THREE.MeshBasicMaterial();
  expect(alpha()).toBe(1);
  // A transparent material keeps its own alpha for blending.
  plane.material = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5, blending: THREE.NoBlending });
  expect(alpha()).toBeCloseTo(0.5, 5);
});

test('the room environment compiles its scene at fromScene\'s first draw: the same programs and texels as fromScene alone', () => {
  const run = (early: boolean) => {
    const canvas = document.createElement('canvas');
    const three = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false });
    three.outputColorSpace = THREE.SRGBColorSpace;
    three.toneMapping = THREE.NoToneMapping;
    three.autoClear = false;
    three.shadowMap.enabled = true;
    three.setClearColor(0x8fa3b8);
    const pmrem = new THREE.PMREMGenerator(three), render = three.render;
    const target = early ? roomEnvironment(three, pmrem, new RoomEnvironment()) : pmrem.fromScene(new RoomEnvironment(), 0.04);
    expect(three.render).toBe(render);
    const texels = new Uint16Array(target.width * target.height * 4);
    three.readRenderTargetPixels(target, 0, 0, target.width, target.height, texels);
    // A shader material's key starts with its two shader stages' ids, which count across renderers: left out.
    const programs = three.info.programs!.map(program => `${program.name}|${program.name ? program.cacheKey.split(',').slice(2).join() : program.cacheKey}`);
    expect(three.getContext().getError()).toBe(three.getContext().NO_ERROR);
    target.dispose();
    pmrem.dispose();
    three.dispose();
    three.forceContextLoss();
    return { texels, programs };
  };
  const alone = run(false), early = run(true);
  // The room's programs are made first (the background box's draw first made the basic one), and none is added or changed.
  expect(alone.programs[0]!.startsWith('|basic,')).toBe(true);
  expect(early.programs[0]!.startsWith('|physical,')).toBe(true);
  expect(early.programs).toHaveLength(alone.programs.length);
  expect([...early.programs].sort()).toEqual([...alone.programs].sort());
  let differ = 0;
  for (let i = 0; i < alone.texels.length; i++) if (alone.texels[i] !== early.texels[i]) differ++;
  expect(differ).toBe(0);
  expect(alone.texels.some(v => v !== 0)).toBe(true);
});

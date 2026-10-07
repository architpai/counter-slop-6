import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Renderer } from '@/engine/render/index';
import { MATCH_QUIET_MS } from '@/engine/render/pacing';
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
/** Render until a landed sky is on: it goes on a step a frame, in the upload slots (`_landSky`). */
async function land(renderer: Renderer): Promise<number> {
  let frames = 0;
  for (const start = performance.now(); renderer._skyLanding && performance.now() - start < 5000; frames++) {
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
});

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

test('a sky that lands in a match waits out its quiet start, then goes on a step a frame', async () => {
  const held = holdSkies();
  const renderer = makeRenderer();
  renderer.applyQuality(PRESET_VALUES.medium);
  renderer.setMood(moods.house);
  renderer.render(0, fx);
  renderer.setLive(true);
  const house = fakeSky('house');
  held.shift()!.resolve(house.sky);
  await settle();
  const uploads = vi.spyOn(renderer.three, 'initTexture');
  for (let i = 0; i < 5; i++) {
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
});

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

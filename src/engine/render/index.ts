import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GRADE, LIGHT, SURF } from './palette';
import { Composite, RIG_DEPTH } from './postfx';
import { skyMat } from './materials';
import { ANTIALIAS_SPEC, AO_SCALE, PRESET_VALUES, SHADOW_SPEC, VIEW_SCALE } from './quality';
import { aimShadowBox, cascadeCentre, sizeShadowBox } from './shadows';
import { disposeSky, loadSky } from './sky';
import type { PostFX } from './postfx';
import type { SkyUniforms } from './materials';
import type { GfxValues, ShadowBox } from './quality';
import type { SkyAssets } from './sky';
import type { Mood } from '../types';

export { TONE, TONE_HEX, WHITE_HEX, SMOKE_HEX, SURF } from './palette';
export { surfMat, charMat, toneMat, unlitMat, cloudMat, setFlash } from './materials';
export { boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo, starGeo, ringGeo } from './prims';
export { makeFigure, makeWeaponProp, makeNameTag } from './figure';
export type { PostFX } from './postfx';

/** Half-width of Low's shadow box in metres; it follows the camera instead of covering the level. */
const SHADOW_EXTENT = 35;
/** Enough IBL to stop GLB metal reading as black, not enough to gloss up the toon look. */
const ENV_INTENSITY = 0.35;
/**
 * Realistic tiers, once the map's sky is in: the sky's own PMREM at full
 * strength. The GLB characters get it on top of the sky probe every material
 * gets, which is double the physical sky fill on them alone; that keeps
 * enemies readable in shade (VISUALS.md, readability guardrail).
 */
const REAL_ENV_INTENSITY = 1;
/**
 * Realistic exposure before the mood's own EV. The sky data puts a white
 * horizontal surface in full sun at radiance 1, which AgX shows at 77 % of
 * full scale; this lifts it to 80 % and keeps shade from sinking. The flat
 * palette's bright albedos then sit high on AgX's shoulder, where it
 * desaturates, so each map sets a fraction of a stop less (the levels' moods):
 * House most, for a deeper evening and a green lawn.
 */
const REAL_EXPOSURE = 1.2;
/** The visible sky's lift overhead on realistic tiers (materials.ts `skyMat`); the lighting stays physical. */
const SKY_GAIN = 1.6;
const SKY_SATURATION = 1.3;
/**
 * The realistic fog (and the sky's horizon band) is the physical horizon's
 * brightness in the hue of the mood's own fog colour: House's warm haze,
 * Downtown's cool morning. AgX desaturates it at that brightness, so its
 * colour is pushed this far from grey first; at 1 Downtown's haze reads grey.
 */
const HAZE_CHROMA = 1.5;
/**
 * Share of the sky probe's colour kept on realistic tiers. The probe is sky
 * only, and a clear sky is deep blue, so shade came out navy (grey concrete
 * more saturated than the sky above it). In a real street the sunlit walls
 * and ground bounce warm light into that shade; until baked lighting (R3)
 * brings that bounce, the probe keeps its brightness and loses some of its blue.
 */
const PROBE_CHROMA = 0.6;
/** Towards the sun when a mood sets none; `tools/blender/sky.py` renders training's sky with it. */
export const SUN_DIR = new THREE.Vector3(0.38, 0.82, 0.42).normalize();
/** Far plane and sky-dome radius in metres at the "normal" view distance; both scale with it. */
const FAR = 420;
const SKY_RADIUS = 380;
/** Fog range for a mood that sets none. Per-map ranges live on each level's mood. */
const FOG_NEAR = 50;
const FOG_FAR = 190;
/** The weapon rig's fixed vertical FOV (V8). The world keeps its own, speed kick and all. */
export const VIEW_MODEL_FOV = 65;
const _follow = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _size = new THREE.Vector2();
const _tint = new THREE.Color();
const _haze = new THREE.Color();
const _grey = new THREE.Vector3();
const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  readonly post: Composite;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly hemi: THREE.HemisphereLight;
  /**
   * Realistic tiers: the sky's irradiance as spherical harmonics, in place of
   * the hemisphere light. Both lights stay in the scene on those tiers (the one
   * not in use at zero), so the sky landing mid-match changes uniforms only:
   * a light count is part of every lit shader program, and changing one
   * recompiled them all (a 40-70 ms hitch).
   */
  readonly probe: THREE.LightProbe;
  /** Dark shadow-only lights for cascades 1+ (cascade 0 is `sun`); empty on Low and Medium. */
  readonly cascades: THREE.DirectionalLight[] = [];
  readonly _sky: SkyUniforms;
  /** Reset before every frame; the first rig mesh drawn clears the depth buffer. */
  _rigDepthCleared = false;
  /**
   * While AO reads the depth texture the rig cannot clear depth (the world's
   * would be lost), so it draws into [0, RIG_DEPTH] of the depth range instead.
   */
  _rigDepthRange = false;
  readonly _beforeRig: () => void;
  readonly _afterRig: () => void;
  readonly _prepareRigMesh: (object: THREE.Object3D) => void;
  readonly _onResize: () => void;
  _shadowRadius = 1;
  /** Redraw the shadow map every Nth frame. */
  _shadowEvery = 1;
  _frame = 0;
  _fogNear = FOG_NEAR;
  _fogFar = FOG_FAR;
  _quality: Readonly<GfxValues> = PRESET_VALUES.high;
  /** Dynamic resolution's share of the render-scaled target, per axis. */
  _dynamicScale = 1;
  /** Shadow boxes in force; null is Low's box centred on the eye. */
  _boxes: readonly ShadowBox[] | null = null;
  _mood: Mood = {};
  readonly _roomEnv: THREE.Texture;
  /**
   * One PMREM generator for the room environment and every sky, while a
   * realistic look is in force (Low frees it). Its blur shader, compiled for
   * the room's 256 cube, serves the skies' (tools/blender/sky.py sizes them to
   * match), so a sky landing mid-match compiles nothing.
   */
  _pmrem: THREE.PMREMGenerator | null;
  /** The loaded sky (it may belong to a map other than the current one) and the one loading. */
  _skyAssets: SkyAssets | null = null;
  _skyLoading: string | null = null;
  readonly _skyFailed = new Set<string>();
  _disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.three = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.NoToneMapping;
    this.three.autoClear = false;
    this.three.shadowMap.enabled = true;
    // Updates are requested per frame in `render`, so Low can redraw it every other frame.
    this.three.shadowMap.autoUpdate = false;
    this.three.setClearColor(SURF.fog);
    Object.assign(canvas.style, { position: 'fixed', inset: '0', display: 'block' });
    // No `scene.background`: the dome covers every pixel, and a background colour
    // would make three clear the target again inside each render call.
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SURF.fog, FOG_NEAR, FOG_FAR);
    this._pmrem = new THREE.PMREMGenerator(this.three);
    this.scene.environment = this._roomEnv = this._pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = ENV_INTENSITY;
    this._sky = {
      horizon: { value: new THREE.Color(SURF.fog) }, zenith: { value: new THREE.Color(LIGHT.zenith) },
      sunDir: { value: SUN_DIR.clone() }, sunColor: { value: new THREE.Color(LIGHT.sun) }, sunDisc: { value: 0 },
      skyMap: { value: null }, skyScale: { value: 1 }, skyGain: { value: SKY_GAIN }, skySaturation: { value: SKY_SATURATION },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), skyMat(this._sky));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.08, FAR);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.rig = new THREE.Group();
    this.rig.name = 'viewModelRig';
    this.camera.add(this.rig);
    this.sun = new THREE.DirectionalLight(LIGHT.sun, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.hemi = new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, 1.0);
    this.probe = new THREE.LightProbe();
    // Cascade lights are added after these, so three's light order (shadow casters
    // first, then scene order) keeps the sun as cascade 0.
    this.scene.add(this.sun, this.sun.target, this.hemi, this.probe);
    this.post = new Composite();
    const gl = this.three.getContext();
    this._beforeRig = () => {
      if (this._rigDepthRange) gl.depthRange(0, RIG_DEPTH);
      else if (!this._rigDepthCleared) {
        this.three.clearDepth();
        this._rigDepthCleared = true;
      }
    };
    this._afterRig = () => {
      if (this._rigDepthRange) gl.depthRange(0, 1);
    };
    this._prepareRigMesh = object => {
      if (!isMesh(object)) return;
      object.castShadow = object.receiveShadow = false;
      object.renderOrder = 1000;
      object.onBeforeRender = this._beforeRig;
      object.onAfterRender = this._afterRig;
    };
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.applyQuality(this._quality);
    this.setLevelShadow(new THREE.Vector3(), 80);
  }

  resize(): void {
    const width = Math.max(2, window.innerWidth), height = Math.max(2, window.innerHeight);
    this.three.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this._sizeTarget();
  }

  /** The post targets: canvas pixels × render scale. Dynamic resolution draws into a share of them. */
  _sizeTarget(): void {
    const size = this.three.getSize(_size);
    const ratio = this.three.getPixelRatio() * this._quality.renderScale;
    this.post.resize(Math.max(2, Math.floor(size.x * ratio)), Math.max(2, Math.floor(size.y * ratio)), this.camera.aspect);
  }

  /**
   * Apply a quality preset's values (see `quality.ts`) without a reload. Pixel
   * ratio, render scale, the look, the post chain, shadows and view distance
   * take effect on the next frame; a shadow-filter or cascade-count change
   * recompiles the lit materials once. A realistic look streams the map's sky
   * from its first frame.
   */
  applyQuality(q: Readonly<GfxValues>): void {
    this._quality = q;
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const aa = ANTIALIAS_SPEC[q.antialias], ao = AO_SCALE[q.ao];
    this.post.configure({ look: q.look, samples: Math.min(aa.samples, this.three.capabilities.maxSamples),
      fxaa: aa.fxaa, smaa: aa.smaa, ao, bloom: q.bloom });
    this._rigDepthRange = ao > 0;
    const shadow = SHADOW_SPEC[q.shadows];
    this.sun.castShadow = shadow !== null;
    this._setBoxes(shadow?.boxes ?? null, shadow?.size ?? this.sun.shadow.mapSize.x);
    if (!shadow) {
      // Off frees the map; three builds a new one when shadows come back.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    } else {
      if (this.sun.shadow.mapSize.x !== shadow.size) {
        this.sun.shadow.mapSize.set(shadow.size, shadow.size);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      const type = shadow.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      if (this.three.shadowMap.type !== type) {
        this.three.shadowMap.type = type;
        // three keys programs on the filter but never checks it again once a material has
        // compiled. It does check the fog object, on every fogged material's next draw, so a
        // new one reaches the cached enemy and weapon materials that are not in the scene now.
        // The unfogged ones (clouds) receive no shadows; the traversal still marks those in view.
        if (this.scene.fog instanceof THREE.Fog) this.scene.fog = this.scene.fog.clone();
        this.scene.traverse(node => {
          if (!isMesh(node)) return;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.needsUpdate = true;
        });
      }
      this._shadowEvery = shadow.every;
    }
    const view = VIEW_SCALE[q.viewDistance];
    this.camera.far = FAR * view;
    this.camera.updateProjectionMatrix();
    this.sky.scale.setScalar(view);
    this.setLevelShadow(this.sun.target.position, this._shadowRadius);
    this._applyFog();
    this._applyLook();
    if (q.look !== 'realistic') {
      // The flat look never shows a sky; a realistic tier streams it again.
      disposeSky(this._skyAssets);
      this._skyAssets = null;
      this._pmrem?.dispose();
      this._pmrem = null;
    }
    this.resize();
  }

  /**
   * Make one shadow light per box: the sun for the first, dark shadow-only
   * lights for the rest (render/shadows.ts reads them as cascades). Null, or
   * shadows off, leaves the sun alone with Low's box.
   */
  _setBoxes(boxes: readonly ShadowBox[] | null, size: number): void {
    this._boxes = this.sun.castShadow ? boxes : null;
    const extra = Math.max(0, (this._boxes?.length ?? 1) - 1);
    while (this.cascades.length > extra) {
      const light = this.cascades.pop()!;
      this.scene.remove(light, light.target);
      light.shadow.map?.dispose();
      light.dispose();
    }
    while (this.cascades.length < extra) {
      const light = new THREE.DirectionalLight(0xffffff, 0);
      light.castShadow = true;
      light.shadow.bias = this.sun.shadow.bias;
      this.scene.add(light, light.target);
      this.cascades.push(light);
    }
    for (const light of this.cascades) {
      if (light.shadow.mapSize.x === size) continue;
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  }

  /**
   * Dynamic resolution: the scene, AO and bloom draw into this share of their
   * targets (viewports), and the tone pass scales the frame back up. Nothing
   * is reallocated, so a step costs no more than any other frame.
   */
  setDynamicScale(scale: number): void {
    if (scale === this._dynamicScale) return;
    this._dynamicScale = scale;
    this.post.setScale(scale);
  }

  /** The light's level-wide position and depth range; the ortho boxes themselves follow the viewer. */
  setLevelShadow(center: THREE.Vector3, radius: number): void {
    radius = Math.max(1, radius);
    this._shadowRadius = radius;
    const boxes = this._boxes;
    if (boxes) {
      boxes.forEach((box, i) => sizeShadowBox(this._shadowLight(i), box.extent, radius));
      this._aimBoxes(center, _forward.set(0, 0, -1));
      return;
    }
    const extent = Math.min(radius, SHADOW_EXTENT);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.03;
    this._aimShadow(center);
  }

  /** Box `i`'s light: the sun, then the cascades. */
  _shadowLight(i: number): THREE.DirectionalLight {
    return i === 0 ? this.sun : this.cascades[i - 1]!;
  }

  /** Put every box ahead of `eye` along `forward`, each snapped to its own texel grid. */
  _aimBoxes(eye: THREE.Vector3, forward: THREE.Vector3): void {
    const sunDir = this._sky.sunDir.value;
    this._boxes?.forEach((box, i) =>
      aimShadowBox(this._shadowLight(i), cascadeCentre(eye, forward, box.ahead, _centre), sunDir, this._shadowRadius));
  }

  /** Re-centre the shadow box on `point`, snapped to the texel grid so it does not swim. */
  _aimShadow(point: THREE.Vector3): void {
    const texel = 2 * Math.min(this._shadowRadius, SHADOW_EXTENT) / this.sun.shadow.mapSize.x;
    _follow.set(Math.round(point.x / texel) * texel, Math.round(point.y / texel) * texel, Math.round(point.z / texel) * texel);
    this.sun.position.copy(_offset.copy(this._sky.sunDir.value).multiplyScalar(this._shadowRadius * 2)).add(_follow);
    this.sun.target.position.copy(_follow);
    this.sun.target.updateMatrixWorld();
  }

  /** Freeze the view-model flags once, on attach, instead of every frame. */
  prepareRig(root: THREE.Object3D): void {
    root.traverse(this._prepareRigMesh);
  }

  /**
   * Draw the rig as a `fov` camera would, inside the world pass (V8). Scaling
   * the rig's x and y in camera space by tan(world/2) / tan(fov/2) lands every
   * point on the same screen spot at the same depth, so there is no second
   * pass, and rig points read with `getWorldPosition` (muzzle, ejection port)
   * are already where the player sees them.
   */
  setViewFov(fov: number): void {
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    this.rig.scale.set(k, k, 1);
  }

  /** A level's sky, light, fog and grade. Called with `undefined` to restore the default. */
  setMood(mood: Mood = {}): void {
    this._mood = mood;
    // One direction for the disc and the light, so the sun you see casts the shadows.
    const sunDir = this._sky.sunDir.value;
    if (mood.sunDir) sunDir.fromArray(mood.sunDir).normalize();
    else sunDir.copy(SUN_DIR);
    if (this._boxes) this._aimBoxes(this.sun.target.position, _forward.set(0, 0, -1));
    else this._aimShadow(this.sun.target.position);
    this._fogNear = mood.fogNear ?? FOG_NEAR;
    this._fogFar = mood.fogFar ?? FOG_FAR;
    this._applyFog();
    this._applyLook();
  }

  /**
   * The mood's light, sky and grade for the look in force. Low (and a realistic
   * tier whose sky is still streaming, or failed) uses the mood's colours, the
   * hemisphere light and the gradient dome; a realistic tier with its sky in
   * takes the sun, the sky probe, the fog colour and the environment from the
   * Blender sky, in the same units. Uniform and light writes only.
   */
  _applyLook(): void {
    const mood = this._mood, realistic = this._quality.look === 'realistic';
    const sky = realistic && mood.sky !== undefined && this._skyAssets?.key === mood.sky ? this._skyAssets : null;
    const fog = mood.fog ?? SURF.fog;
    const uniforms = this._sky;
    uniforms.horizon.value.set(mood.horizon ?? fog);
    uniforms.zenith.value.set(mood.zenith ?? LIGHT.zenith);
    uniforms.sunDisc.value = mood.sunDisc ? 1 : 0;
    const dome = this.sky.material;
    if (('SKY_MAP' in dome.defines) !== (sky !== null)) {
      if (sky) dome.defines.SKY_MAP = '';
      else delete dome.defines.SKY_MAP;
      dome.needsUpdate = true;
    }
    this.post.setGrade((realistic ? mood.realistic?.grade : undefined) ?? mood.grade ?? GRADE.neutral);
    this.post.setExposure(realistic ? REAL_EXPOSURE * 2 ** (mood.realistic?.exposure ?? 0) : 1);
    const fogColor = this.scene.fog instanceof THREE.Fog ? this.scene.fog.color : null;
    if (sky) {
      const { sun, sh, fog: horizon, background } = sky.data;
      const peak = Math.max(...sun);
      this.sun.color.setRGB(sun[0] / peak, sun[1] / peak, sun[2] / peak, THREE.LinearSRGBColorSpace);
      this.sun.intensity = peak;
      uniforms.sunColor.value.copy(this.sun.color);
      uniforms.skyMap.value = sky.background;
      uniforms.skyScale.value = background;
      this.hemi.intensity = 0;
      this.probe.visible = true;
      this.probe.sh.fromArray(sh.flat());
      for (const c of this.probe.sh.coefficients) c.lerp(_grey.setScalar(0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z), 1 - PROBE_CHROMA);
      // Same PMREM size as the room environment, so no program changes (tools/blender/sky.py).
      this.scene.environment = sky.env.texture;
      this.scene.environmentIntensity = REAL_ENV_INTENSITY;
      // The physical horizon's brightness in the mood's fog hue (see HAZE_CHROMA).
      const physical = luminance(_haze.setRGB(horizon[0], horizon[1], horizon[2], THREE.LinearSRGBColorSpace));
      const tint = _tint.set(fog), grey = Math.max(1e-4, luminance(tint));
      const haze = _haze.setScalar(grey).lerp(tint, HAZE_CHROMA).multiplyScalar(physical / grey);
      uniforms.horizon.value.copy(haze);
      fogColor?.copy(haze);
      this.three.setClearColor(haze);
      return;
    }
    uniforms.sunColor.value.set(mood.sun ?? LIGHT.sun);
    uniforms.skyMap.value = null;
    fogColor?.set(fog);
    this.three.setClearColor(fog);
    this.sun.color.set(mood.sun ?? LIGHT.sun);
    this.sun.intensity = mood.sunIntensity ?? 2.0;
    // Realistic tiers keep the (empty) probe while the sky streams; see `probe`.
    this.probe.visible = realistic;
    this.probe.sh.zero();
    this.hemi.intensity = mood.hemiIntensity ?? 1.0;
    this.hemi.color.set(mood.hemiSky ?? LIGHT.sky);
    this.hemi.groundColor.set(mood.hemiGround ?? LIGHT.ground);
    this.scene.environment = this._roomEnv;
    this.scene.environmentIntensity = ENV_INTENSITY;
  }

  /** A realistic tier wants the current map's sky and does not have it yet. */
  get skyPending(): boolean {
    const key = this._mood.sky;
    return this._quality.look === 'realistic' && key !== undefined && this._skyAssets?.key !== key && !this._skyFailed.has(key);
  }

  /**
   * Stream the current map's sky, once. `render` asks, so nothing is fetched
   * until a realistic frame is actually drawn (boot builds the menu map before
   * it applies the saved preset). The frame never waits for it: the realistic
   * look runs on the mood's lights until it lands, then `_applyLook` swaps it
   * in. Only the latest map's sky is kept.
   */
  _requestSky(): void {
    const key = this._mood.sky;
    if (!this.skyPending || key === undefined || this._skyLoading === key) return;
    this._skyLoading = key;
    // Compiled here, with the map's first frames, rather than in the frame the sky lands. Into
    // a (linear) target, as the PMREM draws: three keys programs on the output colour space.
    const target = this.three.getRenderTarget();
    this.three.setRenderTarget(this.post.target);
    this._generator().compileEquirectangularShader();
    this.three.setRenderTarget(target);
    loadSky(key).then(source => {
      if (this._skyLoading === key) this._skyLoading = null;
      // The map or the look changed while this one streamed: drop it, and fetch the new map's if still missing.
      if (this._disposed || this._mood.sky !== key || this._quality.look !== 'realistic') {
        disposeSky(source);
        if (!this._disposed) this._requestSky();
        return;
      }
      const env = this._generator().fromEquirectangular(source.hdr);
      source.hdr.dispose();
      disposeSky(this._skyAssets);
      this._skyAssets = { key, data: source.data, env, background: source.background };
      this._applyLook();
    }, (error: unknown) => {
      if (this._skyLoading === key) this._skyLoading = null;
      // Keep the gradient dome and the mood's lights; do not retry every frame.
      this._skyFailed.add(key);
      console.warn(`sky ${key}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  _generator(): THREE.PMREMGenerator {
    return (this._pmrem ??= new THREE.PMREMGenerator(this.three));
  }

  _applyFog(): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    const view = VIEW_SCALE[this._quality.viewDistance];
    this.scene.fog.near = this._fogNear * view;
    this.scene.fog.far = this._fogFar * view;
  }

  dispose(): void {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.post.dispose();
    this._setBoxes(null, this.sun.shadow.mapSize.x);
    this.sun.shadow.map?.dispose();
    this._roomEnv.dispose();
    disposeSky(this._skyAssets);
    this._skyAssets = null;
    this._pmrem?.dispose();
    this._pmrem = null;
    this.scene.environment = null;
    this.probe.dispose();
    this.three.dispose();
    // Drop the WebGL context outright: browsers cap live contexts (~16), and a
    // StrictMode remount plus HMR burns through that cap fast.
    this.three.forceContextLoss?.();
  }

  render(time: number, fx: PostFX): void {
    this._frame++;
    if (this._skyLoading === null && this.skyPending) this._requestSky();
    // The shadow boxes only move on frames that redraw the maps, so a skipped
    // frame samples the old map with the matrix it was drawn with.
    const shadows = this.sun.castShadow && this._frame % this._shadowEvery === 0;
    if (shadows) {
      this.camera.getWorldPosition(_eye);
      if (this._boxes) this._aimBoxes(_eye, this.camera.getWorldDirection(_forward));
      else this._aimShadow(_eye);
    }
    this.three.shadowMap.needsUpdate = shadows;
    this._rigDepthCleared = false;
    this.sky.position.copy(this.camera.position);
    this.three.setRenderTarget(this.post.target);
    this.three.clear();
    this.three.render(this.scene, this.camera);
    this.post.draw(this.three, time, fx, this.camera);
  }
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

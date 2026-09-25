import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GRADE, LIGHT, SURF } from './palette';
import { Composite } from './postfx';
import { skyMat } from './materials';
import { PRESET_VALUES, SHADOW_SPEC, VIEW_SCALE } from './quality';
import type { PostFX } from './postfx';
import type { SkyUniforms } from './materials';
import type { GfxValues } from './quality';
import type { Mood } from '../types';

export { TONE, TONE_HEX, WHITE_HEX, SMOKE_HEX, SURF } from './palette';
export { surfMat, charMat, toneMat, unlitMat, cloudMat, setFlash } from './materials';
export { boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo, starGeo, ringGeo } from './prims';
export { makeFigure, makeWeaponProp, makeNameTag } from './figure';
export type { PostFX } from './postfx';

/** Half-width of the shadow box in metres; it follows the camera instead of covering the level. */
const SHADOW_EXTENT = 35;
/** Enough IBL to stop GLB metal reading as black, not enough to gloss up the toon look. */
const ENV_INTENSITY = 0.35;
const SUN_DIR = new THREE.Vector3(0.38, 0.82, 0.42).normalize();
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
const _size = new THREE.Vector2();

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  readonly post: Composite;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly hemi: THREE.HemisphereLight;
  readonly _sky: SkyUniforms;
  /** Reset before every frame; the first rig mesh drawn clears the depth buffer. */
  _rigDepthCleared = false;
  readonly _clearRigDepth: () => void;
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
    const pmrem = new THREE.PMREMGenerator(this.three);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = ENV_INTENSITY;
    pmrem.dispose();
    this._sky = {
      horizon: { value: new THREE.Color(SURF.fog) }, zenith: { value: new THREE.Color(LIGHT.zenith) },
      sunDir: { value: SUN_DIR.clone() }, sunColor: { value: new THREE.Color(LIGHT.sun) }, sunDisc: { value: 0 },
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
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.post = new Composite();
    this._clearRigDepth = () => {
      if (!this._rigDepthCleared) {
        this.three.clearDepth();
        this._rigDepthCleared = true;
      }
    };
    this._prepareRigMesh = object => {
      if (!isMesh(object)) return;
      object.castShadow = object.receiveShadow = false;
      object.renderOrder = 1000;
      object.onBeforeRender = this._clearRigDepth;
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

  /** The scene target: canvas pixels × render scale × dynamic resolution. */
  _sizeTarget(): void {
    const size = this.three.getSize(_size);
    const ratio = this.three.getPixelRatio() * this._quality.renderScale * this._dynamicScale;
    this.post.resize(Math.max(2, Math.floor(size.x * ratio)), Math.max(2, Math.floor(size.y * ratio)), this.camera.aspect);
  }

  /**
   * Apply a quality preset's values (see `quality.ts`) without a reload. Pixel
   * ratio, render scale, anti-aliasing, shadows and view distance take effect
   * on the next frame; a shadow-filter change recompiles the lit materials once.
   */
  applyQuality(q: Readonly<GfxValues>): void {
    this._quality = q;
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const samples = q.antialias === 'msaa4' ? 4 : q.antialias === 'msaa2' ? 2 : 0;
    this.post.setAntialias(Math.min(samples, this.three.capabilities.maxSamples), q.antialias === 'fxaa');
    const shadow = SHADOW_SPEC[q.shadows];
    this.sun.castShadow = shadow !== null;
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
    this._applyFog();
    this.resize();
  }

  /**
   * Dynamic resolution: resize the scene target, so the clear, the MSAA
   * resolve and the composite all shrink with it. The controller moves at
   * most every half second, so the reallocation is rare.
   */
  setDynamicScale(scale: number): void {
    if (scale === this._dynamicScale) return;
    this._dynamicScale = scale;
    this._sizeTarget();
  }

  /** The light's level-wide position and depth range; the ortho box itself follows the viewer. */
  setLevelShadow(center: THREE.Vector3, radius: number): void {
    radius = Math.max(1, radius);
    this._shadowRadius = radius;
    const extent = Math.min(radius, SHADOW_EXTENT);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    this._aimShadow(center);
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
    const fog = mood.fog ?? SURF.fog;
    // Uniform writes only: nothing to allocate, so nothing to leak on a map change.
    this._sky.horizon.value.set(mood.horizon ?? fog);
    this._sky.zenith.value.set(mood.zenith ?? LIGHT.zenith);
    this._sky.sunColor.value.set(mood.sun ?? LIGHT.sun);
    this._sky.sunDisc.value = mood.sunDisc ? 1 : 0;
    // One direction for the disc and the light, so the sun you see casts the shadows.
    const sunDir = this._sky.sunDir.value;
    if (mood.sunDir) sunDir.fromArray(mood.sunDir).normalize();
    else sunDir.copy(SUN_DIR);
    this._aimShadow(this.sun.target.position);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(fog);
    this.three.setClearColor(fog);
    this._fogNear = mood.fogNear ?? FOG_NEAR;
    this._fogFar = mood.fogFar ?? FOG_FAR;
    this._applyFog();
    this.post.setGrade(mood.grade ?? GRADE.neutral);
    this.sun.color.set(mood.sun ?? LIGHT.sun);
    this.sun.intensity = mood.sunIntensity ?? 2.0;
    this.hemi.intensity = mood.hemiIntensity ?? 1.0;
    this.hemi.color.set(mood.hemiSky ?? LIGHT.sky);
    this.hemi.groundColor.set(mood.hemiGround ?? LIGHT.ground);
  }

  _applyFog(): void {
    if (!(this.scene.fog instanceof THREE.Fog)) return;
    const view = VIEW_SCALE[this._quality.viewDistance];
    this.scene.fog.near = this._fogNear * view;
    this.scene.fog.far = this._fogFar * view;
  }

  dispose(): void {
    window.removeEventListener('resize', this._onResize);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.post.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.three.dispose();
    // Drop the WebGL context outright: browsers cap live contexts (~16), and a
    // StrictMode remount plus HMR burns through that cap fast.
    this.three.forceContextLoss?.();
  }

  render(time: number, fx: PostFX): void {
    this._frame++;
    // The shadow box only moves on frames that redraw the map, so a skipped
    // frame samples the old map with the matrix it was drawn with.
    const shadows = this.sun.castShadow && this._frame % this._shadowEvery === 0;
    if (shadows) this._aimShadow(this.camera.getWorldPosition(_eye));
    this.three.shadowMap.needsUpdate = shadows;
    this._rigDepthCleared = false;
    this.sky.position.copy(this.camera.position);
    this.three.setRenderTarget(this.post.target);
    this.three.clear();
    this.three.render(this.scene, this.camera);
    this.post.draw(this.three, time, fx);
  }
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

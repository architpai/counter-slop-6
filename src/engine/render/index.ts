import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GRADE, LIGHT, SURF } from './palette';
import { Composite, RIG_DEPTH } from './postfx';
import {
  BAKE_UNIFORMS, GRID_UNIFORMS, casterGroups, hiddenMat, levelDepthMat, realMat, realMaterials, skyMat, standInGrid, standInLightmap,
  standInMaps, surfMat, wearMaps,
} from './materials';
import { BAKE_FILE, LIGHTMAP_SIZE, bakeFor, bakedTriangles, layoutLightmap, lightmapCharts, wearLightmapUVs } from './lightmap';
import { ANTIALIAS_SPEC, AO_SCALE, PRESET_VALUES, SHADOW_SPEC, VIEW_SCALE } from './quality';
import { GpuFences, MatchClock } from './pacing';
import { aimShadowBox, cascadeCentre, sizeShadowBox } from './shadows';
import { disposeSky, loadSky } from './sky';
import { TEXTURE_SIZE, resolveMaterial, setInfo, setsFor } from './surfaces';
import { BakeStreamer, TextureStreamer, fetchGrid, ktx2Loader, lightmapLoader, warmCompressedUploads } from './textures';
import { WeaponAssets, weaponTextureSize } from './weapons';
import { FX_UNIFORMS, FxAssets, fxTemplate, fxTextureSize } from './fx';
import type { PostFX } from './postfx';
import type { SkyUniforms } from './materials';
import type { GfxValues, ShadowBox } from './quality';
import type { SkyAssets, SkySource } from './sky';
import type { TextureSet } from './surfaces';
import type { BakedLight, LoadBake } from './textures';
import type { BakeInfo } from './lightmap';
import type { Level, LevelSurface, Mood } from '../types';

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
 * and ground bounce warm light into that shade. The probe keeps its
 * brightness and loses some of its blue. Where a map is baked (R3) the bake
 * carries that bounce instead; the probe still lights backdrops, and Medium's
 * level times its AO map.
 */
const PROBE_CHROMA = 0.6;
/** Towards the sun when a mood sets none; `tools/blender/sky.py` renders training's sky with it. */
export const SUN_DIR = new THREE.Vector3(0.38, 0.82, 0.42).normalize();
/** Far plane and sky-dome radius in metres at the "normal" view distance; both scale with it. */
const FAR = 420;
/** The camera's near plane: the view model is kept beyond it wherever it is in view (weapons/models.ts, `REAL_AIM_DEPTH`). */
export const NEAR = 0.08;
const SKY_RADIUS = 380;
/** Fog range for a mood that sets none. Per-map ranges live on each level's mood. */
const FOG_NEAR = 50;
const FOG_FAR = 190;
/**
 * Streamed map uploads are spaced out in time (`_streamTextures`), so a map
 * textures as fast on a 60 Hz screen or under an FPS cap as at 144 Hz. The
 * download and the transcode are off the main thread; the upload is not, and
 * when maps come faster than the browser's GPU process takes them, one upload
 * blocks until it catches up: on an M4 Pro (ANGLE Metal, Ultra) a 1K or 2K
 * map every 8 ms frame piled up into 25-200 ms stalls. At least
 * `UPLOAD_GAP_MS` apart and at most `UPLOAD_BYTES_PER_MS` on average (a 2K
 * map about every 47 ms, a 1K or 512 one every 24 ms: 60 MB/s), an upload
 * costs 0.1-0.6 ms. An upload slower than `UPLOAD_SLOW_MS` shows the GPU
 * process is behind anyway (a busier machine): the gaps then double, up to 4
 * times, for the rest of that stream.
 */
export const UPLOAD_GAP_MS = 24;
const UPLOAD_BYTES_PER_MS = 6e4;
const UPLOAD_SLOW_MS = 4;
/**
 * The wait after a level load or a look change before the first upload. The
 * GPU process is still busy with the new level's buffers and programs then,
 * and an upload in that time waited 60-130 ms for it (Ultra, second and later
 * maps of a session); half a second later none did.
 */
export const UPLOAD_SETTLE_MS = 500;
/**
 * A map's bake fades in over this long (eased) once it is on the GPU, so the
 * light does not pop: indoors the bake is about half the probe's light, and a
 * short fade reads as the room dimming at spawn.
 */
export const BAKE_FADE_MS = 1500;
/**
 * Point lights the realistic tiers' shots and blasts share (R5): always in
 * the scene there, at zero until an effect takes one, since a light count is
 * part of every lit program and a change would recompile them all mid-match.
 * One: every lit fragment pays for each light, lit or not (0.1 ms a light on
 * Ultra at 2880 x 1800), and a blast takes it from a shot. Low has none.
 */
export const FX_LIGHTS = 1;
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
const _irradiance = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const luminance = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * A caster drawn with the view models' warm-up, so the shadow pass's depth
 * program for the characters (three's own, front-faced) is linked at the menu
 * too, not with a wave's first spawn in a cascade.
 */
const SHADOW_PROBE = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
SHADOW_PROBE.castShadow = true;

/**
 * A root whose shader work is held off a match's frames (`Renderer._compiles`,
 * `_warmups`); `valid` is false once it was freed. `inMatch`: its warm-up draw
 * may also run in a live match once its quiet start is over.
 */
interface Warmup {
  root: THREE.Object3D;
  done: () => void;
  valid: () => boolean;
  inMatch: boolean;
  drawn: boolean;
}

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
  readonly _beforeRig: () => void;
  readonly _afterRig: () => void;
  readonly _prepareRigMesh: (object: THREE.Object3D) => void;
  readonly _onResize: () => void;
  /** A restored context lost every texture; streamed maps keep no CPU copy, so stream them again. */
  readonly _onContextRestored: () => void;
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
  /** The current level's surface meshes; the look in force decides their materials (`_applySurfaces`). */
  _surfaces: readonly LevelSurface[] = [];
  /**
   * Realistic tiers: the level meshes with one material per group, and what
   * the shadow pass draws them with instead (materials.ts `casterGroups`):
   * three draws every group of a multi-material mesh on its own, into every
   * cascade, though the level's all cast alike.
   */
  _casters: { mesh: THREE.Mesh; material: THREE.Material[]; groups: THREE.GeometryGroup[] }[] = [];
  /** The texture sets the current level's tags need. */
  _surfaceSets: readonly TextureSet[] = [];
  /**
   * Realistic tiers: the texture sets streaming or on the level, and their KTX2
   * loader (its transcoder workers). Both null on Low, which loads no texture.
   */
  _textures: TextureStreamer | null = null;
  _ktx2: ReturnType<typeof ktx2Loader> | null = null;
  /** The streamer has been told the current sets and size (`want`). */
  _texturesAsked = false;
  /** No upload before this time (`performance.now()`), and the current stream's slow-down factor (1, 2 or 4). */
  _uploadAt = 0;
  _uploadPace = 1;
  /** A compressed upload has warmed the driver (`warmCompressedUploads`). */
  _uploadsWarm = false;
  /** The streamer's current sets are on the materials. */
  _texturesWorn = false;
  /** The current level's key, arena flag and bounds: which bake it takes, if any (R3). */
  _level: Pick<Level, 'key' | 'arena' | 'bounds'> | null = null;
  /**
   * The current level's bake, once its geometry is checked against the
   * manifest (`_checkBake`, on the first realistic frame); null without one.
   */
  _bake: { name: string; info: BakeInfo } | null = null;
  _bakeChecked: readonly LevelSurface[] | null = null;
  /** Each bake's checked `uv1` per static surface, kept for the session: its geometry is the manifest's, so it never changes. */
  _bakeLayouts = new Map<string, Float32Array[]>();
  /** Realistic tiers: the bake streaming or on the level. Null on Low. */
  _bakes: BakeStreamer | null = null;
  /**
   * The bakes' KTX2 loader: its own transcoder (UASTC to ASTC or BC7) next to
   * the textures'. Made on the first download, kept while the look stays
   * realistic, so a map change does not fetch and compile the transcoder again.
   */
  _bakeKtx2: ReturnType<typeof lightmapLoader> | null = null;
  _bakeAsked = false;
  /** The bake on the materials (its map's name), and when it started fading in (`performance.now()`). */
  _bakeWorn: string | null = null;
  _bakeFade = 0;
  /**
   * Realistic tiers: the Blender weapons and arms (R4), streamed in the
   * upload slots at the Textures size; the view models listen for them.
   * Empty on Low.
   */
  readonly weapons: WeaponAssets;
  /** One fence a frame, so boot keeps the GPU at most `MAX_FRAMES_IN_FLIGHT` frames behind (render/pacing.ts). */
  readonly _fences: GpuFences;
  /** Whether a match is live and in its quiet start, as boot says every frame (`setLive`). */
  readonly _match = new MatchClock();
  /**
   * Shader work kept off a match's frames. `_compiles`: roots whose programs
   * compile off the frame (`compileAsync`), not in a match's quiet start.
   * `_warmups`: roots then drawn once where nobody sees it, never in a
   * match's quiet start, and in a live match only the weapons' template; on
   * ANGLE Metal a program's first draw can stall its frame even once
   * compiled (the Blender weapons' about 0.4 s, 10-11 ms once compiled).
   */
  _compiles: Warmup[] = [];
  _warmups: Warmup[] = [];
  /** Roots whose programs compile for every look put in force (`prewarm`); the rig's view models always do. */
  readonly _prewarmed = new Set<THREE.Object3D>();
  /** The rig's and the prewarmed roots' programs are queued for the look in force. */
  _programsWarm = false;
  /** A downloaded sky being put on a step a frame (`_landSky`): its background uploaded, then its environment made. */
  _skyLanding: { key: string; source: SkySource; uploaded: boolean; env: THREE.WebGLRenderTarget | null } | null = null;
  /**
   * The dome's material with the streamed sky (`SKY_MAP`) on a 1 x 1 stand-in,
   * compiled and drawn once at the menu (`_warmPrograms`), so the sky landing
   * later links no program.
   */
  readonly _skyProbe: THREE.Mesh;
  /**
   * Realistic tiers: the effect atlases (R5, render/fx.ts), streamed in the
   * upload slots at the Textures size; the effects listen for them. Empty on Low.
   */
  readonly fx: FxAssets;
  /**
   * The soft particles' pass (R5): drawn after the scene into their own layer
   * (postfx.ts `drawSoft`), reading the scene's depth, so smoke and fire can
   * fade where they meet it. Only while soft particles are on and something is in it.
   */
  readonly fxScene = new THREE.Scene();
  /** The pooled point lights of shots and blasts (`FX_LIGHTS`, realistic tiers); empty on Low. */
  readonly fxLights: THREE.PointLight[] = [];
  /** Soft particles are in force: a realistic look with them on, and a depth texture to read (`msaaDepthReadable`). */
  _softFx = false;
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
    const standIn = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    standIn.needsUpdate = true;
    const probe = skyMat({ ...this._sky, skyMap: { value: standIn } });
    probe.defines.SKY_MAP = '';
    this._skyProbe = new THREE.Mesh(new THREE.PlaneGeometry(), probe);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.camera = new THREE.PerspectiveCamera(80, 1, NEAR, FAR);
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
    this._fences = new GpuFences(gl as WebGL2RenderingContext);
    // The rig draws into [0, RIG_DEPTH] of the depth range, so it always wins the depth test and the
    // world's depth survives it: AO and the soft particles read that depth, and the transparent world
    // effects (tracers, decals, smoke), which three draws after every opaque mesh, test against it.
    this._beforeRig = () => gl.depthRange(0, RIG_DEPTH);
    this._afterRig = () => gl.depthRange(0, 1);
    this._prepareRigMesh = object => {
      if (!isMesh(object)) return;
      object.castShadow = object.receiveShadow = false;
      object.renderOrder = 1000;
      object.onBeforeRender = this._beforeRig;
      object.onAfterRender = this._afterRig;
    };
    // Between the scene's draw list and its draws: the level's casters swap to their shadow groups for this pass only.
    const shadowMap = this.three.shadowMap, drawShadows = shadowMap.render.bind(shadowMap);
    shadowMap.render = (lights, scene, camera) => {
      if (!shadowMap.needsUpdate || this._casters.length === 0) return drawShadows(lights, scene, camera);
      const own = this._casters.map(({ mesh, material, groups }) => {
        const saved = { material: mesh.material, groups: mesh.geometry.groups };
        mesh.material = material;
        mesh.geometry.groups = groups;
        return saved;
      });
      try {
        drawShadows(lights, scene, camera);
      } finally {
        this._casters.forEach(({ mesh }, i) => {
          mesh.material = own[i]!.material;
          mesh.geometry.groups = own[i]!.groups;
        });
      }
    };
    this.weapons = new WeaponAssets({
      model: url => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url),
      texture: (url, anisotropy) => (this._ktx2 ??= ktx2Loader(this.three)).load(url, anisotropy),
      upload: texture => this.three.initTexture(texture),
      // A template that Low or a lost context freed meanwhile is neither compiled nor drawn.
      compile: root => this._hold(this._compiles, root, () => this.weapons.holds(root)),
      // A glb that lands after Start is drawn once the match's quiet start is over, not held to the next menu.
      warm: root => this._hold(this._warmups, root, () => this.weapons.holds(root), true),
    });
    this.fx = new FxAssets({
      texture: (url, anisotropy) => (this._ktx2 ??= ktx2Loader(this.three)).load(url, anisotropy),
      upload: texture => this.three.initTexture(texture),
    });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._onContextRestored = () => {
      this.weapons.clear();
      this.fx.clear();
      this._releaseTextures();
      this._fences.clear();
      this._programsWarm = false;
    };
    canvas.addEventListener('webglcontextrestored', this._onContextRestored);
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
   * from its first frame. The view models' programs compile again for the new
   * look before the next match shows them (`_warmPrograms`).
   */
  applyQuality(q: Readonly<GfxValues>): void {
    this._quality = q;
    this._programsWarm = false;
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const aa = ANTIALIAS_SPEC[q.antialias], ao = AO_SCALE[q.ao], samples = Math.min(aa.samples, this.three.capabilities.maxSamples);
    // The soft particles read the scene's depth texture: with MSAA, the resolve's copy, which some GPUs do not make.
    this._softFx = q.look === 'realistic' && q.softParticles && (samples === 0 || this.msaaDepthReadable);
    this.post.configure({ look: q.look, samples, fxaa: aa.fxaa, smaa: aa.smaa, ao, depth: this._softFx, bloom: q.bloom });
    this._setFxLights(q.look === 'realistic' ? FX_LIGHTS : 0);
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
    // Low frees the weapons (the flat guns come back) and the effect atlases before the texture loader they share goes.
    if (q.look !== 'realistic') {
      this.weapons.want(null);
      this.fx.want(null);
    }
    this._applySurfaces();
    if (q.look !== 'realistic') {
      // The flat look never shows a sky; a realistic tier streams it again.
      disposeSky(this._skyAssets);
      this._skyAssets = null;
      if (this._skyLanding) {
        this._skyLanding.env?.dispose();
        disposeSky(this._skyLanding.source);
        this._skyLanding = null;
        this._skyLoading = null;
      }
      this._pmrem?.dispose();
      this._pmrem = null;
    }
    this.resize();
  }

  /**
   * The multisampled scene target leaves a depth texture to read (soft
   * particles). With WEBGL_multisampled_render_to_texture (mobile GPUs) three
   * draws it straight into its textures with no resolve, and a tiled GPU need
   * not keep the depth of such a pass: with MSAA the smoke dithers there.
   */
  get msaaDepthReadable(): boolean {
    return !this.three.extensions.has('WEBGL_multisampled_render_to_texture');
  }

  /** Keep `count` pooled point lights in the scene (`FX_LIGHTS`), dark until an effect lights one. */
  _setFxLights(count: number): void {
    while (this.fxLights.length > count) {
      const light = this.fxLights.pop()!;
      this.scene.remove(light);
      light.dispose();
    }
    while (this.fxLights.length < count) {
      const light = new THREE.PointLight(0xffb266, 0, 6, 2);
      light.castShadow = false;
      light.name = 'fx-light';
      this.scene.add(light);
      this.fxLights.push(light);
    }
  }

  /** Where the realistic effects draw (effects.ts `setRealistic`), once their atlases are in; null on Low or before. */
  fxContext(): { scene: THREE.Scene; late: THREE.Scene; camera: THREE.Camera; lights: readonly THREE.PointLight[]; soft: boolean } | null {
    return this._quality.look === 'realistic' && this.fx.ready
      ? { scene: this.scene, late: this.fxScene, camera: this.camera, lights: this.fxLights, soft: this._softFx } : null;
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

  /**
   * The level's surface meshes (`Level.surfaces`). Low keeps them in the flat
   * palette; the realistic tiers texture them and, given the level (its key,
   * arena flag and bounds) and a bake for it, light them with it.
   */
  setSurfaces(surfaces: readonly LevelSurface[], level: Pick<Level, 'key' | 'arena' | 'bounds'> | null = null): void {
    this._surfaces = surfaces;
    this._level = level;
    this._surfaceSets = setsFor(surfaces.flatMap(s => s.materials.filter(tag => tag !== null)));
    this._applySurfaces();
  }

  /**
   * Give every surface mesh the look in force. Low: its flat surface material
   * on the whole mesh, and every streamed texture is freed. Realistic: its
   * tags' PBR materials (materials.ts `realMat`), one per geometry group,
   * cached per tag and colour, wearing whatever they wore last if that is
   * still loaded (a set shared with the previous map, or the previous texture
   * size until the new one is in), else their stand-ins; flat-only groups are
   * hidden, the drones cast no shadow, and the shadow pass draws each run of
   * the visible ones as one (`_casters`). Downloads start with the next
   * realistic frame (`render`), uploads `UPLOAD_SETTLE_MS` later, and a set
   * that failed to load is tried again. A material swap, not a rebuild: the
   * merged geometry serves both looks.
   */
  _applySurfaces(): void {
    this._texturesAsked = this._bakeAsked = false;
    this._casters = [];
    if (this._quality.look !== 'realistic') {
      for (const { mesh, surf, moving } of this._surfaces) {
        mesh.material = surfMat(surf);
        mesh.customDepthMaterial = undefined;
        if (moving) mesh.castShadow = true;
      }
      this._releaseTextures();
      return;
    }
    if (!this._uploadsWarm) warmCompressedUploads(this.three);
    this._uploadsWarm = true;
    this._uploadAt = performance.now() + UPLOAD_SETTLE_MS;
    // Until the first realistic frame checks it (`_checkBake`), a level with a bake in the manifest wears baked materials.
    const baked = this._bakeChecked === this._surfaces ? this._bake !== null : this._level !== null && bakeFor(this._level) !== null;
    for (const { mesh, surf, materials, static: fixed, moving } of this._surfaces) {
      // 30-40 m up, a drone's shadow in the sharp cascades is a hard grey wedge on the ground by the
      // player, the drone itself a speck near the sun: it read as a stray plane in front of the gun.
      if (moving) mesh.castShadow = false;
      const looks = materials.map(tag => {
        if (tag === null) return hiddenMat();
        const real = resolveMaterial(tag, surf);
        return realMat(real, setInfo(real.set), fixed && baked);
      });
      mesh.material = looks.length === 1 ? looks[0]! : looks;
      mesh.customDepthMaterial = levelDepthMat();
      const caster = looks.find(look => look.visible);
      if (looks.length > 1 && caster) this._casters.push({ mesh, material: [caster], groups: casterGroups(mesh.geometry.groups, looks) });
    }
    this._texturesWorn = false;
  }

  /** Free every streamed texture and bake, and put the stand-ins back on the materials that wore them. */
  _releaseTextures(): void {
    this._textures?.clear();
    this._dropFreedMaps();
    this._textures = null;
    this._ktx2?.dispose();
    this._ktx2 = null;
    this._texturesAsked = this._texturesWorn = false;
    this._bakes?.clear();
    this._wearBake(null);
    this._bakes = null;
    this._bakeKtx2?.dispose();
    this._bakeKtx2 = null;
    this._bakeAsked = false;
  }

  /**
   * Once per level, on its first realistic frame (so Low never pays for it):
   * does the level have a bake, and is its geometry the one that was baked?
   * The game hashes the static triangles, lays the lightmap charts out again
   * at the manifest's density (render/lightmap.ts) and puts `uv1` on the
   * static meshes only if the hash, chart count and atlas height all match; a
   * map edited without a new bake keeps the sky probe (and the unit test
   * fails), and its static pieces go back to the unbaked materials. The
   * layout costs 35-65 ms on a desktop (the arena about 130), once per bake
   * a session (`_bakeLayouts`): a restart or a return to the map only hashes,
   * a few ms. It runs in the load's first frame, before the level is shown.
   */
  _checkBake(): void {
    if (this._bakeChecked === this._surfaces) return;
    this._bakeChecked = this._surfaces;
    this._bake = null;
    const level = this._level, bake = level ? bakeFor(level) : null;
    if (!level || !bake) return;
    const triangles = bakedTriangles(this._surfaces);
    let uvs = triangles.hash === bake.info.hash ? this._bakeLayouts.get(bake.name) ?? null : null;
    if (uvs && !uvs.every((uv, i) => uv.length === 2 * triangles.surfaces[i]!.mesh.geometry.getAttribute('position').count)) uvs = null;
    if (!uvs && triangles.hash === bake.info.hash) {
      const layout = layoutLightmap(lightmapCharts(this._surfaces, level.bounds, triangles), LIGHTMAP_SIZE, bake.info.density);
      if (layout && layout.charts.length === bake.info.charts && layout.rows === bake.info.rows && layout.triangles === bake.info.triangles) {
        this._bakeLayouts.set(bake.name, uvs = layout.uvs);
      }
    }
    if (!uvs || uvs.length !== triangles.surfaces.length) {
      console.warn(`bake ${bake.name}: the map changed since it was baked (npm run lightmaps); using the sky probe`);
      this._applySurfaces();
      return;
    }
    wearLightmapUVs(triangles.surfaces, uvs);
    this._bake = bake;
  }

  /**
   * Put a bake on the level's baked materials and the probe grid's uniforms;
   * null takes it off (stand-ins, the probe's light). A new map's bake fades
   * in from the probe; another file of the bake on screen (a Textures change)
   * swaps in place, at full strength.
   */
  _wearBake(light: BakedLight | null): void {
    const lightmap = light?.lightmap ?? standInLightmap();
    for (const material of realMaterials()) if (material.userData.baked) material.lightMap = lightmap;
    GRID_UNIFORMS.probeGrid.value = light?.grid ?? standInGrid();
    if (light?.name !== this._bakeWorn) {
      BAKE_UNIFORMS.bakeMix.value = GRID_UNIFORMS.probeGridMix.value = 0;
      this._bakeFade = performance.now();
    }
    this._bakeWorn = light?.name ?? null;
    if (!light) return;
    const { info } = light;
    BAKE_UNIFORMS.bakeAo.value = light.ao ? 1 : 0;
    BAKE_UNIFORMS.bakeScale.value = light.ao ? info.aoScale : info.scale * Math.PI;
    GRID_UNIFORMS.probeGridMin.value.fromArray(info.grid.min);
    GRID_UNIFORMS.probeGridCells.value.fromArray(info.grid.cells);
    GRID_UNIFORMS.probeGridCell.value = info.grid.cell;
    GRID_UNIFORMS.probeGridScale.value = info.probeScale * Math.PI;
  }

  /**
   * Realistic tiers: keep the level's bake streaming at the file the Textures
   * setting shows (the AO map on low, the 1K or 2K lightmap above), uploaded
   * in the texture streaming's time slots ahead of the textures (two pieces,
   * so the room's light settles first), then swap it onto the materials and
   * fade it in. A new map's request takes the old map's bake off at once.
   */
  _streamBake(): void {
    if (this._quality.look !== 'realistic') return;
    this._checkBake();
    const bake = this._bake;
    if (!this._bakes) {
      if (!bake) return;
      const load: LoadBake = url => (this._bakeKtx2 ??= lightmapLoader(this.three)).load(url);
      this._bakes = new BakeStreamer(load, fetchGrid, texture => this.three.initTexture(texture));
    }
    const bakes = this._bakes;
    if (!this._bakeAsked) {
      bakes.want(bake ? { ...bake, file: BAKE_FILE[this._quality.textures] } : null);
      if (bakes.current === null) this._wearBake(null);
      this._bakeAsked = true;
    }
    const now = performance.now();
    if (!bakes.ready) {
      if (now >= this._uploadAt && !this._match.quiet(now)) {
        const bytes = bakes.pump();
        if (bytes > 0) this._uploadAt = now + Math.max(UPLOAD_GAP_MS, bytes / UPLOAD_BYTES_PER_MS) * this._uploadPace;
      }
      return;
    }
    const light = bakes.take();
    if (light) this._wearBake(light);
    const t = bakes.current ? Math.min(1, (now - this._bakeFade) / BAKE_FADE_MS) : 0;
    BAKE_UNIFORMS.bakeMix.value = GRID_UNIFORMS.probeGridMix.value = t * t * (3 - 2 * t);
  }

  /** A realistic tier's level bake is still streaming (or not yet on the materials, or not yet checked). */
  get bakePending(): boolean {
    if (this._quality.look !== 'realistic') return false;
    if (this._bakeChecked !== this._surfaces) return this._level !== null && bakeFor(this._level) !== null;
    return this._bake !== null
      && (!this._bakeAsked || this._bakes === null || this._bakes.waiting || (this._bakes.current === null && !this._bakes.failed));
  }

  /** The level's bake is on the materials but still fading in from the probe (`BAKE_FADE_MS`): the look is not final yet. */
  get bakeFading(): boolean {
    return this._quality.look === 'realistic' && this._bakeWorn !== null && BAKE_UNIFORMS.bakeMix.value < 1;
  }

  /** The bake's texture objects alive and their GPU bytes, for the tier report. */
  get bakeStats(): { textures: number; residentBytes: number; file: string | null } {
    return { ...(this._bakes?.stats ?? { textures: 0, residentBytes: 0 }), file: this._bakes?.current?.file ?? null };
  }

  /** Any realistic material still wearing a freed texture goes back to its stand-in. */
  _dropFreedMaps(): void {
    for (const material of realMaterials()) {
      const set = material.userData.set as TextureSet, standIn = standInMaps(set, setInfo(set));
      if (material.map !== standIn.albedo && !(material.map && this._textures?.owns(material.map))) wearMaps(material, standIn);
    }
  }

  /**
   * Realistic tiers: keep the level's texture sets streaming at the size the
   * Textures setting asks for (a new map's request frees the previous map's
   * other sets at once), upload one map at a time, spaced out in time
   * (`UPLOAD_GAP_MS`), and once all are on the GPU put them on every level
   * material at once, then free the previous size. The frame never waits:
   * until then the level wears the stand-ins, or the previous size.
   */
  _streamTextures(): void {
    if (this._quality.look !== 'realistic' || this._surfaceSets.length === 0) return;
    if (!this._textures) {
      const ktx2 = (this._ktx2 ??= ktx2Loader(this.three));
      this._textures = new TextureStreamer(ktx2.load, texture => this.three.initTexture(texture));
    }
    const streamer = this._textures;
    if (!this._texturesAsked) {
      streamer.want(this._surfaceSets, TEXTURE_SIZE[this._quality.textures]);
      this._dropFreedMaps();
      this._texturesAsked = true;
      this._uploadPace = 1;
    }
    if (this._texturesWorn) return;
    const now = performance.now();
    if (now >= this._uploadAt && !this._match.quiet(now)) {
      const bytes = streamer.pump();
      if (bytes > 0) {
        if (performance.now() - now > UPLOAD_SLOW_MS) this._uploadPace = Math.min(4, this._uploadPace * 2);
        this._uploadAt = now + Math.max(UPLOAD_GAP_MS, bytes / UPLOAD_BYTES_PER_MS) * this._uploadPace;
      }
    }
    if (!streamer.ready) return;
    for (const material of realMaterials()) {
      const set = material.userData.set as TextureSet;
      wearMaps(material, streamer.maps(set) ?? standInMaps(set, setInfo(set)));
    }
    streamer.prune();
    this._dropFreedMaps();
    this._texturesWorn = true;
  }

  /**
   * Realistic tiers: keep the weapons streaming at the Textures size (from the
   * first realistic frame, so the menu never waits and Low never fetches), as
   * long as a view model wants them. They download at once and upload in the
   * level's slots, paced and backed off like its maps, once the level's bake
   * and texture sets are on (the level is what a map load or look change shows
   * first), never in a match's quiet start. Their programs compiled and were
   * drawn once when the glb landed (render/weapons.ts; at the menu, or past
   * the quiet start of a match begun before it landed), so the view models'
   * swap once all are in compiles nothing, in a match too.
   */
  _streamWeapons(): void {
    const size = weaponTextureSize(this._quality);
    if (size === null || !this.weapons.wanted) return;
    this.weapons.want(size);
    const now = performance.now();
    if (!this.weapons.pending || this.bakePending || this.texturesPending || now < this._uploadAt || this._match.quiet(now)) return;
    const bytes = this.weapons.pump();
    if (bytes > 0) {
      if (performance.now() - now > UPLOAD_SLOW_MS) this._uploadPace = Math.min(4, this._uploadPace * 2);
      this._uploadAt = now + Math.max(UPLOAD_GAP_MS, bytes / UPLOAD_BYTES_PER_MS) * this._uploadPace;
    }
  }

  /**
   * Realistic tiers: keep the effect atlases streaming at the Textures size
   * (from the first realistic frame, while the effects listen; Low never fetches), uploaded in the
   * level's slots once its bake and sets are on, never in a match's quiet
   * start. Their programs were compiled and drawn at the menu (`_warmPrograms`).
   */
  _streamFx(): void {
    const size = fxTextureSize(this._quality);
    if (size === null || !this.fx.wanted) return;
    this.fx.want(size);
    const now = performance.now();
    if (!this.fx.pending || this.bakePending || this.texturesPending || now < this._uploadAt || this._match.quiet(now)) return;
    const bytes = this.fx.pump();
    if (bytes > 0) {
      if (performance.now() - now > UPLOAD_SLOW_MS) this._uploadPace = Math.min(4, this._uploadPace * 2);
      this._uploadAt = now + Math.max(UPLOAD_GAP_MS, bytes / UPLOAD_BYTES_PER_MS) * this._uploadPace;
    }
  }

  /**
   * The effect materials' shared uniforms for this frame (render/fx.ts
   * `FX_UNIFORMS`): the scene's depth and range for the soft particles, a
   * pixel's size for the tracers, the frame for the dithered smoke's noise, and the sky's and sun's light for the lit
   * sprites where the probe grid is not in.
   */
  _updateFx(): void {
    const u = FX_UNIFORMS, target = this.post.target;
    u.fxDepth.value = this.post.depthTexture;
    u.fxDepthSize.value.copy(this.post.softSize);
    u.fxNear.value = this.camera.near;
    u.fxFar.value = this.camera.far;
    u.fxPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.max(1, target.viewport.w);
    u.fxFrame.value = this._frame % 64;
    const ambient = u.fxAmbient.value;
    ambient.setRGB(0, 0, 0);
    if (this.probe.visible) {
      this.probe.sh.getIrradianceAt(_up, _irradiance).multiplyScalar(this.probe.intensity);
      ambient.setRGB(_irradiance.x, _irradiance.y, _irradiance.z);
    }
    if (this.hemi.intensity > 0) {
      ambient.r += (0.6 * this.hemi.color.r + 0.4 * this.hemi.groundColor.r) * this.hemi.intensity;
      ambient.g += (0.6 * this.hemi.color.g + 0.4 * this.hemi.groundColor.g) * this.hemi.intensity;
      ambient.b += (0.6 * this.hemi.color.b + 0.4 * this.hemi.groundColor.b) * this.hemi.intensity;
    }
    u.fxSun.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
  }

  /** Queue `root` for a held compile or warm-up draw; resolves once it is done, or dropped as freed. */
  _hold(list: Warmup[], root: THREE.Object3D, valid: () => boolean, inMatch = false): Promise<void> {
    return new Promise<void>(done => { list.push({ root, done, valid, inMatch, drawn: false }); });
  }

  /**
   * Once per look, while no match is live: compile the programs of every
   * view model in the rig (the flat and the Blender guns alike, hidden or
   * not) and of the prewarmed roots, then draw the rig once where nobody sees
   * it, and on the realistic tiers the dome with a streamed sky (`_skyProbe`).
   * A match then starts without linking or first-drawing any of them.
   */
  _warmPrograms(): void {
    if (this._programsWarm || this._match.live) return;
    this._programsWarm = true;
    for (const root of this._prewarmed) void this._hold(this._compiles, root, () => this._prewarmed.has(root));
    void this._hold(this._compiles, this.rig, () => true).then(() => this._hold(this._warmups, this.rig, () => true));
    void this._hold(this._warmups, SHADOW_PROBE, () => true);
    const probe = this._skyProbe;
    if (this._quality.look === 'realistic') void this._hold(this._compiles, probe, () => true).then(() => this._hold(this._warmups, probe, () => true));
    // The effects' programs (R5): tracers and flat decals on every look, the realistic sprites, decals, casings and flashes too.
    const fx = fxTemplate(this._quality.look, this._softFx);
    void this._hold(this._compiles, fx, () => true).then(() => this._hold(this._warmups, fx, () => true));
  }

  /**
   * The held compiles, outside a match's quiet start: for the post target
   * (linear output), as the world pass draws them, with the scene's lights
   * and fog. The programs link off the frame; `done` follows once they have.
   */
  _runCompiles(): void {
    if (this._compiles.length === 0 || this._match.quiet(performance.now())) return;
    const target = this.three.getRenderTarget();
    this.three.setRenderTarget(this.post.target);
    for (const { root, done, valid } of this._compiles.splice(0)) {
      if (!valid()) {
        done();
        continue;
      }
      // three's `compileAsync`, except that a material freed while its program links (Low, a lost
      // context) counts as done: three's own poll throws on it.
      const materials = [...this.three.compile(root, this.camera, this.scene)];
      const linked = () => this._disposed || materials.every(material =>
        (this.three.properties.get(material) as { currentProgram?: { isReady(): boolean } }).currentProgram?.isReady() !== false);
      const poll = () => { if (linked()) done(); else setTimeout(poll, 10); };
      poll();
    }
    this.three.setRenderTarget(target);
  }

  /**
   * The held warm-up draws, in one extra render of the scene with its lights,
   * into the frame's target, which the frame then clears. With no match live,
   * all of them, with the shadow maps; in a live match past its quiet start,
   * one `inMatch` root a frame (the weapons' template, when the glb lands
   * after Start), without them: the rig, whose every view model it shows,
   * and the shadow caster wait for a menu. A detached root joins the scene
   * below a pixel and never culled; the rig draws with every view model in it
   * shown. The next frame their callers hear of it (the weapons are announced
   * ready); a root freed meanwhile (Low, a lost context) is dropped, never
   * drawn, even once a new one is wanted.
   */
  _drawWarmups(): void {
    for (const warm of this._warmups.filter(w => w.drawn || !w.valid())) {
      this._warmups.splice(this._warmups.indexOf(warm), 1);
      warm.done();
    }
    const live = this._match.live;
    const list = live ? this._warmups.filter(w => w.inMatch).slice(0, 1) : this._warmups;
    if (list.length === 0 || this._match.quiet(performance.now())) return;
    const shown: THREE.Object3D[] = [];
    for (const { root } of list) {
      if (root === this.rig) {
        root.traverse(node => { if (!node.visible) shown.push(node); });
        continue;
      }
      root.scale.setScalar(1e-5);
      root.position.copy(this.camera.position);
      root.traverse(node => { node.frustumCulled = false; });
      this.scene.add(root);
    }
    for (const node of shown) node.visible = true;
    // At a menu with the shadow maps, so the casters' depth programs link too; the frame then keeps these maps.
    if (!live) this.three.shadowMap.needsUpdate ||= this.sun.castShadow;
    this.three.setRenderTarget(this.post.target);
    this.three.render(this.scene, this.camera);
    for (const node of shown) node.visible = false;
    for (const warm of list) {
      warm.drawn = true;
      if (warm.root === this.rig) continue;
      this.scene.remove(warm.root);
      warm.root.scale.setScalar(1);
      warm.root.position.set(0, 0, 0);
      warm.root.traverse(node => { node.frustumCulled = true; });
    }
  }

  /** Boot, every frame: a match is live (being played, no menu over it). Its first seconds stay quiet (render/pacing.ts). */
  setLive(live: boolean): void {
    this._match.set(live, performance.now());
  }

  /**
   * Something is streaming in (a sky, the level's bake or sets, the weapons)
   * and the GPU has `MAX_FRAMES_IN_FLIGHT` frames queued: boot skips this
   * one, so the next upload waits behind no more (render/pacing.ts). With
   * nothing to upload no frame is skipped.
   */
  get gpuBehind(): boolean {
    return this.streaming && this._fences.behind(performance.now());
  }

  /** A realistic tier's sky, level bake or sets, or weapons are still to download, upload or put on. */
  get streaming(): boolean {
    return this.skyPending || this._skyLanding !== null || this.bakePending || this.texturesPending || this.weapons.pending || this.fx.pending;
  }

  /**
   * Compile `root`'s programs (the characters' template) for every look put
   * in force, while no match is live, so no match links them in its first
   * frames. Nothing is drawn: its geometry uploads with its first use.
   */
  prewarm(root: THREE.Object3D): void {
    this._prewarmed.add(root);
    this._programsWarm = false;
  }

  /** A realistic tier's weapons (or a new size of them) are still streaming. */
  get weaponsPending(): boolean {
    return this.weapons.pending;
  }

  /** A realistic tier's level textures are still streaming (or not yet on the materials). */
  get texturesPending(): boolean {
    return this._quality.look === 'realistic' && this._surfaceSets.length > 0 && !this._texturesWorn;
  }

  /** Streamed texture objects alive and their GPU bytes, for the tier report. */
  get textureStats(): { textures: number; residentBytes: number } {
    return { textures: this._textures?.textureCount ?? 0, residentBytes: this._textures?.residentBytes ?? 0 };
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
   * look runs on the mood's lights until it lands (`_landSky`), then
   * `_applyLook` swaps it in. Only the latest map's sky is kept.
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
      this._skyLanding = { key, source, uploaded: false, env: null };
      // The frames put it on (`_landSky`); a disposed renderer has none, so it is freed here.
      if (this._disposed) this._landSky();
    }, (error: unknown) => {
      if (this._skyLoading === key) this._skyLoading = null;
      // Keep the gradient dome and the mood's lights; do not retry every frame.
      this._skyFailed.add(key);
      console.warn(`sky ${key}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Put the downloaded sky on, one step a frame in the upload slots (never in
   * a match's quiet start, render/pacing.ts), so no frame pays for all of it:
   * the background image's upload (8 MB), then the PMREM environment (the
   * HDR's upload and the prefilter's draws), then the look, uniform writes
   * only (the dome's `SKY_MAP` program was compiled and drawn at the menu,
   * `_skyProbe`). A sky for a map or a look no longer in force is dropped,
   * and the current map's fetched if still missing.
   */
  _landSky(): void {
    const landing = this._skyLanding;
    if (!landing) return;
    const { key, source } = landing;
    if (this._disposed || this._mood.sky !== key || this._quality.look !== 'realistic') {
      this._skyLanding = null;
      if (this._skyLoading === key) this._skyLoading = null;
      landing.env?.dispose();
      disposeSky(source);
      if (!this._disposed) this._requestSky();
      return;
    }
    const now = performance.now();
    if (now < this._uploadAt || this._match.quiet(now)) return;
    const pace = (image: { width: number; height: number }, texel: number) => {
      this._uploadAt = now + Math.max(UPLOAD_GAP_MS, image.width * image.height * texel / UPLOAD_BYTES_PER_MS) * this._uploadPace;
    };
    if (!landing.uploaded) {
      this.three.initTexture(source.background);
      landing.uploaded = true;
      pace(source.background.image as ImageBitmap, 4);
      return;
    }
    if (!landing.env) {
      landing.env = this._generator().fromEquirectangular(source.hdr);
      source.hdr.dispose();
      // Half-float RGBA.
      pace(source.hdr.image, 8);
      return;
    }
    this._skyLanding = null;
    if (this._skyLoading === key) this._skyLoading = null;
    disposeSky(this._skyAssets);
    this._skyAssets = { key, data: source.data, env: landing.env, background: source.background };
    this._applyLook();
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
    this.three.domElement.removeEventListener('webglcontextrestored', this._onContextRestored);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    const probe = this._skyProbe.material as THREE.ShaderMaterial;
    this._skyProbe.geometry.dispose();
    (probe.uniforms.skyMap!.value as THREE.Texture).dispose();
    probe.dispose();
    this.post.dispose();
    this._setBoxes(null, this.sun.shadow.mapSize.x);
    this.sun.shadow.map?.dispose();
    this._roomEnv.dispose();
    disposeSky(this._skyAssets);
    this._skyAssets = null;
    this._landSky();
    this.weapons.clear();
    this.fx.clear();
    this._setFxLights(0);
    this._releaseTextures();
    this._fences.clear();
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
    this._landSky();
    if (this._skyLoading === null && this.skyPending) this._requestSky();
    this._streamBake();
    this._streamTextures();
    this._streamFx();
    this._streamWeapons();
    this._warmPrograms();
    this._runCompiles();
    // The shadow boxes only move on frames that redraw the maps, so a skipped
    // frame samples the old map with the matrix it was drawn with.
    const shadows = this.sun.castShadow && this._frame % this._shadowEvery === 0;
    if (shadows) {
      this.camera.getWorldPosition(_eye);
      if (this._boxes) this._aimBoxes(_eye, this.camera.getWorldDirection(_forward));
      else this._aimShadow(_eye);
    }
    this.three.shadowMap.needsUpdate = shadows;
    this.sky.position.copy(this.camera.position);
    this._drawWarmups();
    this._updateFx();
    this.three.setRenderTarget(this.post.target);
    this.three.clear();
    this.three.render(this.scene, this.camera);
    if (this._softFx && this.fxScene.children.some(child => child.visible)) {
      // Into their own layer, reading the depth the scene's render left (postfx.ts `drawSoft`).
      this.fxScene.fog = this.scene.fog;
      this.post.drawSoft(this.three, this.fxScene, this.camera);
    }
    this.post.draw(this.three, time, fx, this.camera);
    this._fences.mark(performance.now());
  }
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

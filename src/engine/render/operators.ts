import * as THREE from 'three';
import manifest from './operator-assets.json';
import { OPERATOR_AO, levelDepthMat, operatorMaterial, wearMaps } from './materials';
import { ClipLibrary, LOOPS, ONE_SHOTS, type ClipGroup, type OperatorMotion } from './operator-motion';
import { ANISOTROPY, TEXTURE_MAPS, TEXTURE_SIZE } from './surfaces';
import { textureBytes } from './textures';
import type { FigureRig, OperatorSource } from './figure';
import type { GfxValues } from './quality';
import type { TextureMap, TextureSize } from './surfaces';
import type { SetMaps } from './textures';
import type { LoadedModel, WeaponLoaders } from './weapons';

/**
 * The realistic tiers' characters (docs/VISUALS.md, R7): Blender-made
 * operators and machines, skinned on bones that sit on the game's own
 * pivots (render/figure.ts), with keyframed clips (render/operator-motion.ts).
 * Made by `npm run operators` (tools/characters/operators.mjs, from the
 * scripts in tools/blender/characters/). Two glbs, LOD0 for the Textures
 * setting's 1K and 2K (High and Ultra) and LOD1 for its 512 (Medium), and
 * three texture sets (`operator`, `kit`, `machine`) at the Textures size.
 * Low loads none of it and keeps the optimised flat models (render/tactical.ts).
 *
 * The flat model stays under every realistic figure as its hit surface
 * (`HIT_LAYER`: rays test it, nothing draws it), so the hit areas, parts
 * and radii are the Low tier's on every tier.
 */
export const OPERATOR_SETS = ['operator', 'kit', 'machine'] as const;
export type OperatorSet = (typeof OPERATOR_SETS)[number];
export const OPERATOR_GLB = ['/models/operators.glb', '/models/operators-lod1.glb'] as const;
export type OperatorLod = 0 | 1;
export const operatorMapUrl = (set: OperatorSet, size: TextureSize, map: TextureMap): string => `/characters/${size}/${set}-${map}.ktx2`;

type Vec3 = readonly [number, number, number];
/** `operator-assets.json`: file sizes, each kind's triangles per LOD and bones, the clips. */
export interface OperatorManifest {
  glb: readonly [number, number];
  sets: Readonly<Record<string, { bytes: Readonly<Partial<Record<`${TextureSize}`, Vec3>>> }>>;
  kinds: Readonly<Record<string, { triangles: readonly [number, number]; bones: readonly (readonly [string, string | null, Vec3])[] }>>;
  clips: Readonly<Record<string, { duration: number; loop: boolean }>>;
}

/** Check `operator-assets.json`, so a hand edit that breaks it fails at load rather than as missing characters. */
export function parseOperatorManifest(raw: unknown): OperatorManifest {
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<OperatorManifest>;
  if (!Array.isArray(m.glb) || m.glb.length !== 2 || typeof m.sets !== 'object' || typeof m.kinds !== 'object' || typeof m.clips !== 'object'
    || m.sets === null || m.kinds === null || m.clips === null) throw new Error('malformed operator-assets.json');
  for (const set of OPERATOR_SETS) {
    const info = m.sets[set];
    if (!info || !Object.values(TEXTURE_SIZE).every(size => info.bytes[`${size}`]?.length === 3)) throw new Error(`operator-assets.json: set ${set}`);
  }
  return m as OperatorManifest;
}

export const OPERATOR_MANIFEST = parseOperatorManifest(manifest);

/** Which glb and map size a look wears: LOD1 with the 512 maps (Medium's), LOD0 above; null on the flat look. */
export function operatorWant(values: Pick<GfxValues, 'look' | 'textures'>): { lod: OperatorLod; size: TextureSize } | null {
  if (values.look !== 'realistic') return null;
  const size = TEXTURE_SIZE[values.textures];
  return { lod: size <= 512 ? 1 : 0, size };
}

/** What a tier downloads for its characters: its glb and every set's maps at its size. */
export function operatorDownloadBytes(lod: OperatorLod, size: TextureSize): number {
  return OPERATOR_SETS.reduce((sum, set) => sum + OPERATOR_MANIFEST.sets[set]!.bytes[`${size}`]!.reduce((a, b) => a + b, 0), OPERATOR_MANIFEST.glb[lod]);
}

/** The layer the flat model's surfaces go to under a worn operator: rays test it (figure.ts `raycastFigure`), no camera draws it. */
export const HIT_LAYER = 30;

/** The pivots a limb can be torn off at (enemies/index.ts `_detach`, players.ts `ragdoll`, the shield's break): each has a rigid gib. */
export const GIB_BONES = ['head', 'torso', 'upperL', 'upperR', 'thighL', 'thighR', 'shield'] as const;

/** One kind's skinned model, shared by every figure of the kind. */
export interface KindTemplate {
  kind: string;
  group: ClipGroup;
  /** Bones parents first: name, parent's index (-1 for a root), rest position under the parent. */
  bones: { name: string; parent: number; position: THREE.Vector3 }[];
  boneInverses: THREE.Matrix4[];
  /** One per material: the geometry (shared, never disposed by a figure) and its set. */
  meshes: { geometry: THREE.BufferGeometry; set: OperatorSet }[];
  /** Per gib bone, per mesh: the geometry of the triangles under that bone's subtree (shares the attributes). */
  gibs: Map<string, THREE.BufferGeometry[]>;
  /**
   * The figure-space sphere its worn meshes are culled by, per camera and shadow cascade, whatever
   * the pose (`restBounds`); three never skins vertices on the CPU for it.
   */
  bounds: THREE.Sphere;
}

/** How far the trunk may move inside the figure (the hips sinking and sliding back in a death fall, a lean), metres of figure space. */
export const BOUNDS_MARGIN = 0.45;
/** The bones that carry the limbs: a limb swings about where it hangs off them. */
const TRUNK = new Set(['hips', 'torso', 'chest']);

interface Maps {
  size: TextureSize;
  sets: Map<OperatorSet, SetMaps> | null;
  uploaded: number;
  bytes: number;
}

/** A kind's clip group: the operators', the walkers', or none for the drones. */
function clipGroup(kind: string, root: THREE.Object3D): ClipGroup {
  if (root.getObjectByName(`${kind}__thighL`) && root.getObjectByName(`${kind}__shoulderL`)) return 'humanoid';
  return root.getObjectByName(`${kind}__thighL`) ? 'machine' : 'drone';
}

/**
 * Streams the operators for the realistic tiers, like the weapons
 * (render/weapons.ts `WeaponAssets`): `want({ lod, size })` downloads the
 * glb and the maps (the menu never waits); `pump()` uploads one map a call
 * in the renderer's upload slots. As soon as a glb is in, its programs
 * compile and it is drawn once where nobody sees it (skinned, and its shadow
 * pass), on stand-in maps; once that is done and the maps are on, `ready`
 * turns true and figures start wearing it (`frame`): a figure made from then
 * on wears it at once, one already in play only while the camera cannot see
 * it, so nothing changes looks in the middle of a fight. `want(null)` (Low)
 * takes it off every figure at once and frees it all.
 */
export class OperatorAssets implements OperatorSource {
  readonly #loaders: WeaponLoaders;
  #want: { lod: OperatorLod; size: TextureSize } | null = null;
  /** The glb being worn or loading, by LOD. */
  #lod: OperatorLod | null = null;
  #template: THREE.Object3D | null = null;
  #kinds = new Map<string, KindTemplate>();
  #clips: ClipLibrary | null = null;
  #loading: OperatorLod | null = null;
  #materials = new Map<OperatorSet, THREE.MeshStandardMaterial>();
  #maps: Maps[] = [];
  #worn: Maps | null = null;
  #failed = false;
  #warm = false;
  #occlusion: number = OPERATOR_AO.withGtao;
  #ready = false;
  #generation = 0;
  readonly #warned = new Set<string>();
  /** Every figure that can wear an operator, and the ones that do. */
  readonly #figures = new Set<FigureRig>();
  readonly #bodies = new Map<FigureRig, OperatorBody>();
  /**
   * Figures that go straight to their operator once it is in, in view or not: those in play at a settings
   * change (another LOD or size, or Low to a realistic tier), which is not a fight's surprise. Only a
   * session's first load keeps the figures already in play on stand-ins until they leave the view.
   */
  readonly #settle = new Set<FigureRig>();
  /** A look has been asked for before: the next change is a settings change (`#settle`). */
  #asked = false;

  constructor(loaders: WeaponLoaders) {
    this.#loaders = loaders;
  }

  get ready(): boolean { return this.#ready; }
  get pending(): boolean {
    return this.#want !== null && !this.#failed && (this.#lod !== this.#want.lod || this.#worn?.size !== this.#want.size || !this.#ready);
  }
  get template(): THREE.Object3D | null { return this.#template; }
  holds(root: THREE.Object3D): boolean { return root === this.#template; }
  get lod(): OperatorLod | null { return this.#ready ? this.#lod : null; }
  /** The clips of the worn glb. */
  get clips(): ClipLibrary | null { return this.#clips; }
  kind(kind: string): KindTemplate | null { return this.#kinds.get(kind) ?? null; }
  /** Figures wearing an operator now. */
  get worn(): number { return this.#bodies.size; }

  /** The baked occlusion's strength (`OPERATOR_AO`, by the AO setting), on the set materials and every figure's copies. */
  occlusion(intensity: number): void {
    this.#occlusion = intensity;
    for (const material of this.#materials.values()) material.aoMapIntensity = intensity;
    for (const body of this.#bodies.values()) {
      for (const mesh of body.meshes) (mesh.material as THREE.MeshStandardMaterial).aoMapIntensity = intensity;
    }
  }

  want(spec: { lod: OperatorLod; size: TextureSize } | null): void {
    const change = this.#asked;
    this.#asked = true;
    if (spec?.lod === this.#want?.lod && spec?.size === this.#want?.size) return;
    if (spec === null) {
      this.clear();
      return;
    }
    if (change) for (const rig of this.#figures) this.#settle.add(rig);
    this.#want = spec;
    this.#failed = false;
    if (this.#lod !== spec.lod && this.#loading !== spec.lod) this.#loadModel(spec.lod);
    for (const maps of this.#maps) if (maps !== this.#worn && maps.size !== spec.size) this.#free(maps);
    this.#maps = this.#maps.filter(maps => maps === this.#worn || maps.size === spec.size);
    if (!this.#maps.some(maps => maps.size === spec.size)) this.#loadMaps(spec.size);
  }

  #warn(what: string, error: unknown): void {
    this.#failed = true;
    if (!this.#warned.has(what)) console.warn(`operators ${what}: ${error instanceof Error ? error.message : String(error)}`);
    this.#warned.add(what);
  }

  #loadModel(lod: OperatorLod): void {
    this.#loading = lod;
    const generation = this.#generation;
    this.#loaders.model(OPERATOR_GLB[lod]).then(gltf => {
      if (generation !== this.#generation || this.#want?.lod !== lod) {
        if (this.#loading === lod) this.#loading = null;
        disposeTree(gltf.scene);
        return;
      }
      this.#loading = null;
      // A LOD change: every figure goes back to its stand-in, then wears the new one as soon as it is in (`#settle`).
      if (this.#template) {
        for (const rig of this.#bodies.keys()) this.#settle.add(rig);
        this.#drop();
      }
      try {
        this.#adopt(gltf, lod);
      } catch (error) {
        // A glb that does not match operator-assets.json (a stale cached file): free what was built, keep the flat models.
        this.#template = gltf.scene;
        this.#drop();
        this.#warn(`LOD${lod}`, error);
        return;
      }
      this.#warmUp();
    }, (error: unknown) => {
      if (generation !== this.#generation) return;
      this.#loading = null;
      this.#warn(`LOD${lod}`, error);
    });
  }

  /** The kinds' templates from the glb: set materials, the attributes renamed, the gibs' index subsets. */
  #adopt(gltf: LoadedModel, lod: OperatorLod): void {
    for (const set of OPERATOR_SETS) {
      if (this.#materials.has(set)) continue;
      const material = operatorMaterial(set);
      material.aoMapIntensity = this.#occlusion;
      this.#materials.set(set, material);
    }
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    for (const kind of Object.keys(OPERATOR_MANIFEST.kinds)) {
      const holder = scene.getObjectByName(`${kind}__body`);
      if (!holder) throw new Error(`operators: ${kind} is missing`);
      const skinned: THREE.SkinnedMesh[] = [];
      holder.traverse(node => { if (node instanceof THREE.SkinnedMesh) skinned.push(node); });
      const skeleton = skinned[0]!.skeleton;
      const index = new Map(skeleton.bones.map((bone, i) => [bone, i]));
      const bones = skeleton.bones.map(bone => ({
        name: bone.name.replace(`${kind}__`, ''),
        parent: bone.parent instanceof THREE.Bone ? index.get(bone.parent) ?? -1 : -1,
        position: bone.position.clone(),
      }));
      const meshes = skinned.map(mesh => {
        const set = (mesh.material as THREE.Material).name as OperatorSet;
        if (!OPERATOR_SETS.includes(set)) throw new Error(`operators: ${kind} wears ${set}`);
        const geometry = mesh.geometry;
        const fx = geometry.getAttribute('_fx');
        if (fx) {
          geometry.deleteAttribute('_fx');
          geometry.setAttribute('fx', fx);
        }
        geometry.userData.shared = true;
        // Worn meshes cull by the kind's own sphere (`KindTemplate.bounds`); none is computed from the skinned vertices.
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
        (mesh.material as THREE.Material).dispose();
        mesh.material = this.#materials.get(set)!;
        // The template is drawn once where nobody sees it (the warm-up), whatever the camera's view.
        mesh.frustumCulled = false;
        // Warmed as the figures draw it: into the shadow maps too, with their depth material.
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.customDepthMaterial = levelDepthMat();
        return { geometry, set };
      });
      const template: KindTemplate = {
        kind, group: clipGroup(kind, scene), bones, boneInverses: skeleton.boneInverses, meshes, gibs: new Map(), bounds: new THREE.Sphere(),
      };
      template.gibs = gibGeometries(template);
      template.bounds = restBounds(template);
      this.#kinds.set(kind, template);
      // A rigid gib's program (a figure's torn-off limb) is warmed with the template: one per material.
      const gib = template.gibs.get('head');
      gib?.forEach((geometry, i) => {
        const mesh = new THREE.Mesh(geometry, this.#materials.get(meshes[i]!.set)!);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.customDepthMaterial = levelDepthMat();
        holder.add(mesh);
      });
    }
    const loops = new Set(Object.entries(OPERATOR_MANIFEST.clips).filter(([, clip]) => clip.loop).map(([name]) => name));
    this.#clips = new ClipLibrary(gltf.animations, loops);
    for (const group of ['humanoid', 'machine'] as const) {
      for (const clip of group === 'humanoid' ? [...LOOPS, ...ONE_SHOTS] : ['idle', 'walk'] as const) {
        if (!this.#clips.get(group, clip)) throw new Error(`operators: no clip ${group}.${clip}`);
      }
    }
    this.#template = scene;
    this.#lod = lod;
  }

  #loadMaps(size: TextureSize): void {
    const maps: Maps = { size, sets: null, uploaded: 0, bytes: 0 };
    this.#maps.push(maps);
    const generation = this.#generation;
    Promise.all(OPERATOR_SETS.map(set => Promise.all(TEXTURE_MAPS.map(map => this.#loaders.texture(operatorMapUrl(set, size, map), ANISOTROPY[size])))
      .then(([albedo, normal, orm]) => [set, { albedo: albedo!, normal: normal!, orm: orm! }] as const))).then(sets => {
      if (generation !== this.#generation || !this.#maps.includes(maps)) {
        for (const [, set] of sets) for (const texture of Object.values(set)) texture.dispose();
        return;
      }
      maps.sets = new Map(sets);
    }, (error: unknown) => {
      if (generation !== this.#generation || !this.#maps.includes(maps)) return;
      this.#warn(`${size} maps`, error);
    });
  }

  #next(): Maps | null {
    return this.#maps.find(maps => maps.size === this.#want?.size && maps !== this.#worn && maps.sets !== null) ?? null;
  }

  /** Upload the next downloaded map; once all are up and the glb is in, put them on. Returns the map's GPU bytes, or 0. */
  pump(): number {
    const maps = this.#next();
    if (!maps?.sets) return 0;
    const total = OPERATOR_SETS.length * TEXTURE_MAPS.length;
    if (maps.uploaded >= total) {
      this.#wear();
      return 0;
    }
    const set = OPERATOR_SETS[Math.floor(maps.uploaded / TEXTURE_MAPS.length)]!;
    const texture = maps.sets.get(set)![TEXTURE_MAPS[maps.uploaded % TEXTURE_MAPS.length]!];
    const bytes = textureBytes(texture);
    this.#loaders.upload(texture);
    if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
    maps.bytes += bytes;
    maps.uploaded++;
    if (maps.uploaded === total) this.#wear();
    return bytes;
  }

  #warmUp(): void {
    const template = this.#template!, generation = this.#generation;
    const warmed = (this.#loaders.compile?.(template) ?? Promise.resolve()).catch(() => {})
      .then(() => (generation === this.#generation && this.#template === template ? this.#loaders.warm?.(template) : undefined));
    warmed.catch(() => {}).then(() => {
      if (generation !== this.#generation || this.#template !== template) return;
      this.#warm = true;
      this.#wear();
    });
  }

  /** Put the wanted size's maps on once they and a warm glb are in; free the size they replace. */
  #wear(): void {
    const maps = this.#next() ?? (this.#worn?.size === this.#want?.size ? this.#worn : null);
    if (!this.#template || !this.#warm || !maps?.sets || maps.uploaded < OPERATOR_SETS.length * TEXTURE_MAPS.length) return;
    if (maps !== this.#worn) {
      for (const [set, material] of this.#materials) wearMaps(material, maps.sets.get(set)!);
      if (this.#worn) this.#free(this.#worn);
      this.#maps = this.#maps.filter(m => m === maps);
      this.#worn = maps;
    }
    this.#ready = true;
  }

  #free(maps: Maps): void {
    for (const set of maps.sets?.values() ?? []) for (const texture of Object.values(set)) texture.dispose();
    maps.sets = null;
  }

  /** A figure that can wear an operator (render/figure.ts, while it lives): it wears one now if they are in, as it spawns. */
  enlist(rig: FigureRig): () => void {
    this.#figures.add(rig);
    if (this.#ready) this.#put(rig);
    return () => {
      this.#figures.delete(rig);
      this.#settle.delete(rig);
      this.#take(rig);
    };
  }

  /**
   * Every frame, before the scene is drawn: figures in play put their
   * operator on while the camera cannot see them (a figure already in view
   * keeps its stand-in until it is not; after a settings change, all at
   * once, `#settle`), then every worn operator follows its figure's pivots
   * and clips.
   */
  frame(camera: THREE.Camera): void {
    if (!this.#ready) return;
    let frustum: THREE.Frustum | null = null;
    for (const rig of this.#figures) {
      const template = this.#kinds.get(rig.kind);
      if (!template || this.#bodies.has(rig) || rig.disposed || rig.lent.size > 0) continue;
      if (this.#settle.has(rig)) {
        this.#put(rig);
        continue;
      }
      frustum ??= _frustum.setFromProjectionMatrix(_matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      if (!seen(rig.root, template.bounds, frustum)) this.#put(rig);
    }
    this.#settle.clear();
    for (const body of this.#bodies.values()) body.sync(this.#clips);
  }

  #put(rig: FigureRig): void {
    const template = this.#kinds.get(rig.kind);
    if (!template || this.#bodies.has(rig)) return;
    this.#bodies.set(rig, new OperatorBody(rig, template, set => this.#materials.get(set)!));
  }

  #take(rig: FigureRig): void {
    this.#bodies.get(rig)?.dispose();
    this.#bodies.delete(rig);
  }

  /** Every figure back to its stand-in (the glb is going, or another LOD replaces it). */
  #drop(): void {
    for (const rig of [...this.#bodies.keys()]) this.#take(rig);
    this.#ready = this.#warm = false;
    if (this.#template) disposeTree(this.#template);
    // The gibs share the meshes' attributes (freed with them above); only their index buffers are their own.
    for (const kind of this.#kinds.values()) for (const gibs of kind.gibs.values()) for (const gib of gibs) gib.dispose();
    this.#template = null;
    this.#kinds.clear();
    this.#clips = null;
    this.#lod = null;
  }

  /** Free the glb, the materials and every map; every figure goes back to its flat model. */
  clear(): void {
    this.#generation++;
    this.#want = null;
    this.#loading = null;
    this.#failed = false;
    this.#settle.clear();
    this.#drop();
    for (const maps of this.#maps) this.#free(maps);
    this.#maps = [];
    this.#worn = null;
    for (const material of this.#materials.values()) material.dispose();
    this.#materials.clear();
  }

  get stats(): { textures: number; residentBytes: number; model: boolean; worn: number } {
    let textures = 0, residentBytes = 0;
    for (const maps of this.#maps) {
      textures += (maps.sets?.size ?? 0) * TEXTURE_MAPS.length;
      residentBytes += maps.bytes;
    }
    return { textures, residentBytes, model: this.#template !== null, worn: this.#bodies.size };
  }
}

const _frustum = new THREE.Frustum();
const _matrix = new THREE.Matrix4();
const _sphere = new THREE.Sphere();

/** The camera can see the figure: its kind's worn bounds (`KindTemplate.bounds`) are in the frustum and it is shown. */
function seen(root: THREE.Object3D, bounds: THREE.Sphere, frustum: THREE.Frustum): boolean {
  for (let node: THREE.Object3D | null = root; node; node = node.parent) if (!node.visible) return false;
  if (!root.parent) return false;
  root.updateWorldMatrix(true, false);
  return frustum.intersectsSphere(_sphere.copy(bounds).applyMatrix4(root.matrixWorld));
}

/**
 * A sphere round the rest pose (skinned once on the CPU) that holds the kind
 * in any pose: each vertex may swing about the joint its limb hangs from
 * (a limb bone's first ancestor off the trunk), so it stays within that
 * joint's distance from the centre plus its own from the joint; a trunk
 * vertex stays where it is. `BOUNDS_MARGIN` covers the trunk's own moves.
 */
function restBounds(template: KindTemplate): THREE.Sphere {
  const armature = new THREE.Group();
  const bones = template.bones.map(({ position }) => {
    const bone = new THREE.Bone();
    bone.position.copy(position);
    return bone;
  });
  template.bones.forEach(({ parent }, i) => (parent >= 0 ? bones[parent]! : armature).add(bones[i]!));
  armature.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones, template.boneInverses);
  // Each bone's limb joint: the bone of its chain that hangs off the trunk (none for the trunk and a root).
  const joint = template.bones.map((_, i) => {
    let at = i;
    for (let up = template.bones[at]!.parent; up >= 0 && !TRUNK.has(template.bones[up]!.name); up = template.bones[at]!.parent) at = up;
    const { name, parent } = template.bones[at]!;
    return TRUNK.has(name) || parent < 0 ? null : bones[at]!.getWorldPosition(new THREE.Vector3());
  });
  const meshes = template.meshes.map(({ geometry }) => {
    const mesh = new THREE.SkinnedMesh(geometry);
    mesh.bind(skeleton, new THREE.Matrix4());
    return mesh;
  });
  const box = new THREE.Box3();
  for (const mesh of meshes) {
    mesh.computeBoundingBox();
    box.union(mesh.boundingBox!);
  }
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  let radius = 0;
  const vertex = new THREE.Vector3();
  for (const mesh of meshes) {
    const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    for (let v = 0; v < joints.count; v++) {
      mesh.getVertexPosition(v, vertex);
      let reach = vertex.distanceTo(sphere.center);
      for (let k = 0; k < 4; k++) {
        const at = weights.getComponent(v, k) > 0 ? joint[joints.getComponent(v, k)] : null;
        if (at) reach = Math.max(reach, at.distanceTo(sphere.center) + vertex.distanceTo(at));
      }
      radius = Math.max(radius, reach);
    }
    (mesh.material as THREE.Material).dispose();
  }
  sphere.radius = radius + BOUNDS_MARGIN;
  return sphere;
}

/**
 * Each gib bone's triangles, per mesh: those whose first corner's heaviest
 * bone is in the bone's subtree. They share the mesh's attributes, so a
 * gib uploads only its index buffer.
 */
function gibGeometries(template: KindTemplate): Map<string, THREE.BufferGeometry[]> {
  const out = new Map<string, THREE.BufferGeometry[]>();
  const under = (bone: number, root: number): boolean => {
    for (let b = bone; b >= 0; b = template.bones[b]!.parent) if (b === root) return true;
    return false;
  };
  for (const name of GIB_BONES) {
    const root = template.bones.findIndex(b => b.name === name);
    if (root < 0) continue;
    out.set(name, template.meshes.map(({ geometry }) => {
      const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight'), index = geometry.index!;
      const heaviest = (v: number) => {
        let best = 0, bone = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights.getComponent(v, k);
          if (w > best) { best = w; bone = joints.getComponent(v, k); }
        }
        return bone;
      };
      const kept: number[] = [];
      for (let i = 0; i < index.count; i += 3) {
        if (under(heaviest(index.getX(i)), root)) kept.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
      const gib = new THREE.BufferGeometry();
      for (const [key, attribute] of Object.entries(geometry.attributes)) gib.setAttribute(key, attribute);
      gib.setIndex(kept);
      gib.userData.shared = true;
      gib.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
      return gib;
    }));
  }
  return out;
}

const _q = new THREE.Quaternion();

/**
 * An operator worn by one figure: its bones (children of the figure's root,
 * mirroring the pivots), the skinned meshes on the figure's own tinted
 * copies of the set materials, and the prop moved into its hand. The flat
 * model's surfaces stay where they are, on `HIT_LAYER`.
 */
export class OperatorBody {
  readonly rig: FigureRig;
  readonly template: KindTemplate;
  readonly bones: THREE.Bone[];
  /** Per bone, the pivot or node it mirrors, or null for a bone of its own (the chest, the feet, the rotors). */
  readonly sources: (THREE.Object3D | null)[];
  readonly skeleton: THREE.Skeleton;
  readonly meshes: THREE.SkinnedMesh[];
  readonly armature = new THREE.Group();
  /** Where the prop sits in the hand: its grip in the gun glove's fist (`FIST`), laid as the weapon group lays it, under the forearm's bone. */
  readonly socket = new THREE.Group();
  /** Where the grip hand and the support hand hold the prop in hand, in the prop's frame (`PROP_HOLDS`). */
  readonly #grip = new THREE.Vector3();
  readonly #support = new THREE.Vector3();
  readonly #gibs: THREE.Mesh[] = [];
  #prop: THREE.Object3D | null = null;
  readonly #materials: (set: OperatorSet) => THREE.Material;

  constructor(rig: FigureRig, template: KindTemplate, materials: (set: OperatorSet) => THREE.Material) {
    this.rig = rig;
    this.template = template;
    this.#materials = materials;
    this.armature.name = 'operator';
    this.bones = template.bones.map(({ name, position }) => {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.copy(position);
      return bone;
    });
    template.bones.forEach(({ parent }, i) => (parent >= 0 ? this.bones[parent]! : this.armature).add(this.bones[i]!));
    this.sources = template.bones.map(({ name }) => rig.parts[name as keyof typeof rig.parts] ?? rig.root.getObjectByName(name) ?? null);
    this.skeleton = new THREE.Skeleton(this.bones, template.boneInverses);
    this.meshes = template.meshes.map(({ geometry, set }) => {
      const mesh = new THREE.SkinnedMesh(geometry, rig.own(materials(set)));
      mesh.name = `operator ${set}`;
      mesh.bind(this.skeleton, new THREE.Matrix4());
      // Culled per camera and per shadow cascade by the kind's sphere, never by its skinned vertices.
      mesh.boundingSphere = template.bounds;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.customDepthMaterial = levelDepthMat();
      // Rays test the flat model; a skinned mesh's own test would skin every vertex on the CPU.
      mesh.raycast = () => {};
      this.armature.add(mesh);
      return mesh;
    });
    rig.root.add(this.armature);
    rig.worn = true;
    for (const mesh of rig.low) mesh.layers.set(HIT_LAYER);
    const fore = this.bones[template.bones.findIndex(b => b.name === 'foreR')];
    if (fore && rig.parts.gunMount) fore.add(this.socket);
    rig.onWeapon = () => this.#holdProp();
    rig.onLend = part => this.#lend(part);
    this.#holdProp();
    this.sync(null);
  }

  /**
   * The prop in hand into the socket, laid as the figure's weapon group lays
   * it (render/figure.ts `setWeapon`): a Blender gun at its true size with
   * its grip in the fist, a flat prop by its origin (its grip).
   */
  #holdProp(): void {
    const prop = this.rig.prop();
    if (this.#prop && this.#prop !== prop) this.#returnProp();
    if (!prop || !this.socket.parent) return;
    const weapon = prop.parent;
    if (!weapon) return;
    this.#prop = prop;
    const hold = prop.name.startsWith('prop__') ? PROP_HOLDS[weapon.name] : undefined;
    const scale = hold ? OPERATOR_PROP_SCALE : 1;
    this.socket.quaternion.copy(weapon.quaternion);
    this.socket.scale.setScalar(scale);
    this.#grip.fromArray(hold?.grip ?? [0, 0, 0]);
    this.socket.position.copy(FIST).sub(_g.copy(this.#grip).multiplyScalar(scale).applyQuaternion(this.socket.quaternion));
    this.#support.fromArray(hold?.support ?? (weapon.name === 'pistol' ? FLAT_PISTOL_SUPPORT : FLAT_LONG_SUPPORT));
    prop.userData.operatorHome = weapon;
    this.socket.add(prop);
  }

  #returnProp(): void {
    const prop = this.#prop, home = prop?.userData.operatorHome as THREE.Object3D | undefined;
    if (prop && home && prop.parent === this.socket) home.add(prop);
    this.#prop = null;
  }

  /**
   * A piece of the figure goes to the debris: the gun takes its prop back
   * (so does a limb that carries it, the gun arm or the torso, as on Low),
   * a limb takes a rigid copy of its part of the operator (in its rest pose),
   * and the body's bones under it fold away.
   */
  #lend(part: THREE.Object3D): void {
    const home = this.#prop?.userData.operatorHome as THREE.Object3D | undefined;
    if (home && attached(home, part)) this.#returnProp();
    const at = this.sources.indexOf(part);
    const name = this.template.bones[at]?.name;
    const gibs = name ? this.template.gibs.get(name) : undefined;
    if (!gibs) return;
    gibs.forEach((geometry, i) => {
      const gib = new THREE.Mesh(geometry, this.meshes[i]!.material);
      gib.name = `operator gib ${name}`;
      // The geometry's (quantised) space to the bone's: its inverse bind matrix.
      gib.matrixAutoUpdate = false;
      gib.matrix.copy(this.template.boneInverses[at]!);
      gib.castShadow = true;
      gib.customDepthMaterial = levelDepthMat();
      gib.raycast = () => {};
      part.add(gib);
      this.#gibs.push(gib);
    });
  }

  /** Follow the pivots (and nodes), times the clips' deltas; a bone whose source left the figure folds to nothing. */
  sync(clips: ClipLibrary | null): void {
    const { rig, template } = this, motion: OperatorMotion = rig.motion;
    for (let i = 0; i < template.bones.length; i++) {
      const { name, position } = template.bones[i]!, bone = this.bones[i]!, source = this.sources[i];
      if (source) {
        if (!attached(source, rig.root) || !source.visible) {
          bone.scale.setScalar(1e-4);
          continue;
        }
        bone.position.copy(source.position);
        bone.quaternion.copy(source.quaternion);
        bone.scale.copy(source.scale);
      } else {
        bone.position.copy(position);
        bone.quaternion.identity();
        bone.scale.setScalar(1);
      }
      if (name.includes('-rotor')) {
        bone.quaternion.multiply(_q.setFromAxisAngle(_up, name.endsWith('F') === name.includes('wingL') ? motion.spin : -motion.spin));
      } else if (clips && motion.group !== 'drone') {
        bone.quaternion.multiply(motion.delta(clips, name, _q));
      }
    }
    if (motion.group === 'humanoid' && this.#prop && (motion.carry === 'long' || motion.carry === 'pistol') && motion.aim > 0.02) this.#reach(motion);
  }

  /**
   * The support hand on the gun (two-bone IK on the left arm's bones, never
   * its pivots): as the figure aims, the left hand goes to the foregrip of
   * a long gun, or round the grip hand on a pistol, the elbow down and out.
   */
  #reach(motion: OperatorMotion): void {
    const at = (name: string) => this.bones[this.template.bones.findIndex(b => b.name === name)];
    const upper = at('upperL'), fore = at('foreL');
    if (!upper || !fore || upper.scale.x < 0.5) return;
    this.rig.root.updateWorldMatrix(true, false);
    this.armature.updateMatrixWorld(true);
    const shoulder = upper.getWorldPosition(_s), scale = this.rig.root.matrixWorld.getMaxScaleOnAxis();
    const a = 0.3 * scale, b = 0.29 * scale;
    // The handguard where the arm reaches it; with the gun arm straight out (the game's aim pose) it often
    // does not, and the hand takes the gun as far forward of the grip as it reaches, or cups the grip hand.
    const grip = this.socket.localToWorld(_g.copy(this.#grip)), target = this.socket.localToWorld(_t.copy(this.#support));
    const reach = (a + b) * 0.98;
    if (target.distanceTo(shoulder) > reach) {
      const along = _d.subVectors(target, grip), from = _o.subVectors(grip, shoulder);
      const qa = along.lengthSq(), qb = 2 * from.dot(along), qc = from.lengthSq() - reach * reach, disc = qb * qb - 4 * qa * qc;
      const t = disc < 0 || qa < 1e-8 ? 0 : Math.min(1, Math.max(0, (-qb + Math.sqrt(disc)) / (2 * qa)));
      target.copy(grip).addScaledVector(along, t);
    }
    const toTarget = _u.subVectors(target, shoulder);
    const d = Math.min(Math.max(toTarget.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
    toTarget.normalize();
    // The elbow hangs down and out, away from the chest.
    const pole = _v.set(-0.5, -1, -0.2).transformDirection(this.rig.root.matrixWorld);
    pole.addScaledVector(toTarget, -pole.dot(toTarget)).normalize();
    const cos = (a * a + d * d - b * b) / (2 * a * d), sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const elbow = _e.copy(shoulder).addScaledVector(toTarget, a * cos).addScaledVector(pole, a * sin);
    const hand = _h.copy(shoulder).addScaledVector(toTarget, d);
    const weight = Math.min(1, motion.aim);
    aimBone(upper, _w.subVectors(elbow, shoulder).normalize(), weight);
    upper.updateMatrixWorld(true);
    aimBone(fore, _w.subVectors(hand, fore.getWorldPosition(_f)).normalize(), weight);
  }

  /** Back to the flat model: its surfaces drawn again, the prop in its weapon group, the operator's pieces gone. */
  dispose(): void {
    this.#returnProp();
    for (const mesh of this.rig.low) mesh.layers.set(0);
    for (const gib of this.#gibs) gib.removeFromParent();
    this.#gibs.length = 0;
    this.armature.removeFromParent();
    this.skeleton.dispose();
    this.rig.onWeapon = this.rig.onLend = null;
    this.rig.worn = false;
    this.rig.disown();
  }
}

const _up = new THREE.Vector3(0, 1, 0);
/** The gun glove's fist in its forearm bone's frame (tools/blender/characters/body.py `glove`, the grip's hollow): a prop's grip goes there. */
export const FIST = new THREE.Vector3(0, -0.3, 0.02);
/** The Blender props are built a quarter over size for the flat figures (tools/weapons/build.mjs `PROP_SCALE`); an operator holds them at their true size. */
export const OPERATOR_PROP_SCALE = 0.8;
/**
 * Each Blender prop's grip (the fist's place on it) and where the support
 * hand holds it (a long gun's handguard or pump, round the grip hand on a
 * pistol), in the prop's frame as built (forward +z, up +y), measured from
 * public/models/weapons.glb.
 */
export const PROP_HOLDS: Readonly<Record<string, { grip: Vec3; support: Vec3 }>> = {
  r4c: { grip: [0, -0.08, 0.01], support: [0, -0.02, 0.42] },
  rifle: { grip: [0, -0.08, 0.07], support: [0, -0.01, 0.4] },
  shotgun: { grip: [0, -0.08, -0.04], support: [0, -0.03, 0.32] },
  sniper: { grip: [0, -0.07, -0.11], support: [0, -0.03, 0.34] },
  pistol: { grip: [0, -0.07, 0.08], support: [-0.04, -0.09, 0.07] },
  knife: { grip: [0, 0.01, 0.04], support: [0, 0.01, 0.04] },
  blade: { grip: [0, 0.01, 0], support: [0, 0.01, 0] },
};
/** A flat prop's support hold (render/figure.ts props: the grip at the origin, +z forward). */
const FLAT_LONG_SUPPORT: Vec3 = [0, -0.04, 0.36];
const FLAT_PISTOL_SUPPORT: Vec3 = [-0.035, -0.07, -0.01];
const _g = new THREE.Vector3();
const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3();
const _e = new THREE.Vector3(), _h = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();
const _d = new THREE.Vector3(), _o = new THREE.Vector3();
const _world = new THREE.Quaternion(), _parent = new THREE.Quaternion(), _turn = new THREE.Quaternion(), _was = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0), _dir = new THREE.Vector3();

/** Turn a limb bone so its length (its -y) points along `dir` in the world, by the shortest turn from where it points, `weight` of the way. */
function aimBone(bone: THREE.Bone, dir: THREE.Vector3, weight: number): void {
  bone.getWorldQuaternion(_world);
  _dir.copy(_down).applyQuaternion(_world);
  _turn.setFromUnitVectors(_dir, dir);
  _world.premultiply(_turn);
  bone.parent!.getWorldQuaternion(_parent);
  _was.copy(bone.quaternion);
  bone.quaternion.copy(_parent.invert().multiply(_world));
  if (weight < 1) bone.quaternion.copy(_was.slerp(bone.quaternion, weight));
}

function attached(part: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = part; node; node = node.parent) if (node === root) return true;
  return false;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse(node => {
    if (node instanceof THREE.Mesh) node.geometry.dispose();
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
  });
}

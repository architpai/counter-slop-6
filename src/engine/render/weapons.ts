import * as THREE from 'three';
import manifest from './weapon-assets.json';
import { weaponMaterial, weaponPropMaterial, wearMaps } from './materials';
import { ANISOTROPY, TEXTURE_MAPS, TEXTURE_SIZE } from './surfaces';
import { textureBytes } from './textures';
import type { GfxValues } from './quality';
import type { TextureMap, TextureSize } from './surfaces';
import type { LoadTexture, SetMaps } from './textures';

/**
 * The realistic tiers' first-person weapons and arms (docs/VISUALS.md, R4):
 * `weapons.glb` (every gun, the knife, the optics and the posed hands, with
 * their clips and sockets) and one KTX2 texture set per model, at the size
 * the Textures setting shows. Made by `tools/weapons/build.mjs` from the
 * Blender scripts in `tools/blender/weapons/`. Low loads none of it.
 */
export const WEAPON_SETS = ['hands', 'optics', 'r4c', 'mp5', 'shotgun', 'sniper', 'pistol', 'knife'] as const;
export type WeaponSet = (typeof WEAPON_SETS)[number];
export const WEAPONS_GLB = '/models/weapons.glb';

/** One set's maps, as `tools/weapons/build.mjs` writes them. */
export const weaponMapUrl = (set: WeaponSet, size: TextureSize, map: TextureMap): string => `/weapons/${size}/${set}-${map}.ktx2`;

type Vec3 = readonly [number, number, number];
/** `weapon-assets.json`: file sizes, triangles per model and clip lengths. */
export interface WeaponManifest {
  glb: number;
  /** Per set: the largest size it is made at (small models stop at 1K), and file bytes per size, in `TEXTURE_MAPS` order. */
  sets: Readonly<Record<string, { maxSize: TextureSize; bytes: Readonly<Partial<Record<`${TextureSize}`, Vec3>>> }>>;
  models: Readonly<Record<string, { set: string; triangles: Readonly<Record<string, number>>; total: number }>>;
  /** Seconds, by `<model>.<clip>`. */
  clips: Readonly<Record<string, number>>;
}

/** Check `weapon-assets.json`: a hand edit that breaks it fails at load, not as missing guns. */
export function parseWeaponManifest(raw: unknown): WeaponManifest {
  const m = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<WeaponManifest>;
  if (typeof m.glb !== 'number' || typeof m.sets !== 'object' || typeof m.models !== 'object' || typeof m.clips !== 'object'
    || m.sets === null || m.models === null || m.clips === null) throw new Error('malformed weapon-assets.json');
  for (const set of WEAPON_SETS) {
    const info = m.sets[set], sizes = Object.values(TEXTURE_SIZE);
    if (!info || !sizes.includes(info.maxSize) || !sizes.every(size => size > info.maxSize || info.bytes[`${size}`]?.length === 3)) {
      throw new Error(`weapon-assets.json: set ${set}`);
    }
  }
  return m as WeaponManifest;
}

export const WEAPON_MANIFEST = parseWeaponManifest(manifest);

/** The texture size the weapons wear for these values, or null on the flat look, which loads none. */
export function weaponTextureSize(values: Pick<GfxValues, 'look' | 'textures'>): TextureSize | null {
  return values.look === 'realistic' ? TEXTURE_SIZE[values.textures] : null;
}

/** The size a set is worn at when a tier asks for `size`: the optics, pistol and knife stop at 1K. */
export function weaponSetSize(set: WeaponSet, size: TextureSize): TextureSize {
  return Math.min(size, WEAPON_MANIFEST.sets[set]!.maxSize) as TextureSize;
}

/** What a tier downloads for its weapons: the glb and every set's maps at its size. */
export function weaponDownloadBytes(size: TextureSize): number {
  return WEAPON_SETS.reduce((sum, set) => sum + WEAPON_MANIFEST.sets[set]!.bytes[`${weaponSetSize(set, size)}`]!.reduce((a, b) => a + b, 0), WEAPON_MANIFEST.glb);
}

/** A glTF as the loaders give it. */
export interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

/** How `WeaponAssets` reaches the network and the GPU; the renderer's in the game, stand-ins in tests. */
export interface WeaponLoaders {
  model(url: string): Promise<LoadedModel>;
  texture: LoadTexture;
  upload(texture: THREE.Texture): void;
  /** Compile the model's shader programs off the frame (the renderer's `compileAsync`); tests leave it out. */
  compile?(root: THREE.Object3D): Promise<void>;
  /** Draw the model once where nobody sees it, so the GPU's first-draw setup is not paid in a frame that shows it. */
  warm?(root: THREE.Object3D): Promise<void>;
}

interface Maps {
  size: TextureSize;
  sets: Map<WeaponSet, SetMaps> | null;
  failed: boolean;
  /** Maps handed to the GPU so far. */
  uploaded: number;
  bytes: number;
}

/**
 * Streams the weapons for the realistic tiers, like the level's texture sets
 * (render/textures.ts `TextureStreamer`): `want(size)` starts the model and
 * the maps at that size downloading (the menu never waits); `pump()` uploads
 * one map a call in the renderer's upload slots. As soon as the model is in
 * (its materials wear stand-in maps, so their programs are already the final
 * ones), its programs compile off the frame and the renderer draws the whole
 * model once where nobody sees it: on ANGLE Metal the first draw of these
 * programs stalls about 0.4 s even once they are compiled, and the glb lands
 * long before the maps, so this happens in the menu (or, when Start came
 * first, once the match's quiet start is over). Once that warm-up is
 * done and every map is in, the materials wear the maps, `ready` turns true
 * and every subscriber hears of it (the view models swap to the Blender
 * guns); nothing compiles then. A size change keeps the old maps on until the
 * new ones are in. `want(null)` (Low) frees it all and the view models go
 * back to the flat guns.
 */
export class WeaponAssets {
  readonly #loaders: WeaponLoaders;
  #size: TextureSize | null = null;
  #template: THREE.Object3D | null = null;
  #clips = new Map<string, Map<string, THREE.AnimationClip>>();
  #loading = false;
  #materials: { material: THREE.Material; set: string | null }[] = [];
  #maps: Maps[] = [];
  #worn: Maps | null = null;
  #failed = false;
  /** The template's programs are compiled and it was drawn once (`WeaponLoaders.compile`, `warm`). */
  #warm = false;
  #ready = false;
  /** Bumped by `clear`, so a download that lands after it is dropped. */
  #generation = 0;
  readonly #listeners = new Set<() => void>();
  /** The figures holding props (render/figure.ts `PropSource`); unlike `#listeners`, they do not make the weapons wanted. */
  readonly #propListeners = new Set<() => void>();
  /** Every prop handed out (`prop`), until it is gone: `clear` hides those it cannot swap (dropped guns). */
  readonly #props = new Set<WeakRef<THREE.Object3D>>();
  readonly #warned = new Set<string>();

  constructor(loaders: WeaponLoaders) {
    this.#loaders = loaders;
  }

  /** The model and the size's maps are on the materials. */
  get ready(): boolean { return this.#ready; }
  /** A realistic tier wants the weapons (or another size of them) and they are not all in yet. */
  get pending(): boolean {
    return this.#size !== null && !this.#failed && (this.#worn?.size !== this.#size || !this.#ready);
  }
  get size(): TextureSize | null { return this.#size; }

  /** `root` is the live template; after a `clear` the old one is freed, even if a new size is wanted again. */
  holds(root: THREE.Object3D): boolean { return root === this.#template; }
  /** The glb's scene once it is in (never drawn in play): the renderer compiles the props' programs from it for each look. */
  get template(): THREE.Object3D | null { return this.#template; }

  /** Some view model listens for the weapons; with none (a renderer without a player), nothing is fetched. */
  get wanted(): boolean { return this.#listeners.size > 0; }

  /** Call `listener` whenever `ready` changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  want(size: TextureSize | null): void {
    if (size === this.#size) return;
    if (size === null) {
      this.clear();
      return;
    }
    this.#size = size;
    this.#failed = false;
    if (!this.#template && !this.#loading) this.#loadModel();
    // A size asked for and then superseded before it was worn is not needed.
    for (const maps of this.#maps) if (maps !== this.#worn && maps.size !== size) this.#free(maps);
    this.#maps = this.#maps.filter(maps => maps === this.#worn || maps.size === size);
    if (!this.#maps.some(maps => maps.size === size)) this.#loadMaps(size);
  }

  #warn(what: string, error: unknown): void {
    this.#failed = true;
    if (!this.#warned.has(what)) console.warn(`weapons ${what}: ${error instanceof Error ? error.message : String(error)}`);
    this.#warned.add(what);
  }

  #loadModel(): void {
    this.#loading = true;
    const generation = this.#generation;
    this.#loaders.model(WEAPONS_GLB).then(gltf => {
      if (generation !== this.#generation) {
        disposeTree(gltf.scene);
        return;
      }
      this.#loading = false;
      this.#adopt(gltf);
      this.#warmUp();
      this.#wear();
    }, (error: unknown) => {
      if (generation !== this.#generation) return;
      this.#loading = false;
      this.#warn('model', error);
    });
  }

  /**
   * The template: materials swapped for the game's (one per glTF name; the
   * enemy props', `prop__<kind>`, their own per set), geometry shared by
   * every instance, clips by model.
   */
  #adopt(gltf: LoadedModel): void {
    const byName = new Map<string, THREE.Material>();
    gltf.scene.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.userData.shared = true;
      const prop = node.name.startsWith('prop__'), set = (node.material as THREE.Material).name, name = prop ? `${set}-prop` : set;
      let material = byName.get(name);
      if (!material) {
        const made = prop ? { material: weaponPropMaterial(set), set } : weaponMaterial(set);
        this.#materials.push(made);
        byName.set(name, material = made.material);
      }
      (node.material as THREE.Material).dispose();
      node.material = material;
    });
    for (const clip of gltf.animations) {
      const [model, name] = clip.name.split('.');
      if (!model || !name) continue;
      // Tracks bind by node name; an instance's nodes lose their `<model>__` prefix.
      for (const track of clip.tracks) track.name = track.name.replace(/^[^.]*?__/, '');
      let clips = this.#clips.get(model);
      if (!clips) this.#clips.set(model, clips = new Map());
      clips.set(name, clip);
    }
    this.#template = gltf.scene;
  }

  #loadMaps(size: TextureSize): void {
    const maps: Maps = { size, sets: null, failed: false, uploaded: 0, bytes: 0 };
    this.#maps.push(maps);
    const generation = this.#generation;
    const setSize = (set: WeaponSet) => weaponSetSize(set, size);
    Promise.all(WEAPON_SETS.map(set => Promise.all(TEXTURE_MAPS.map(map => this.#loaders.texture(weaponMapUrl(set, setSize(set), map), ANISOTROPY[setSize(set)])))
      .then(([albedo, normal, orm]) => [set, { albedo: albedo!, normal: normal!, orm: orm! }] as const))).then(sets => {
      if (generation !== this.#generation || !this.#maps.includes(maps)) {
        for (const [, set] of sets) for (const texture of Object.values(set)) texture.dispose();
        return;
      }
      maps.sets = new Map(sets);
    }, (error: unknown) => {
      if (generation !== this.#generation || !this.#maps.includes(maps)) return;
      maps.failed = true;
      this.#warn(`${size} maps`, error);
    });
  }

  /** The maps of the wanted size, once downloaded and not yet worn. */
  #next(): Maps | null {
    return this.#maps.find(maps => maps.size === this.#size && maps !== this.#worn && maps.sets !== null) ?? null;
  }

  /**
   * Upload the next downloaded map and free its CPU copy; once every map of
   * the wanted size is up (and the model is in), put them on. Returns the
   * map's GPU bytes, or 0 when none was waiting.
   */
  pump(): number {
    const maps = this.#next();
    if (!maps?.sets) return 0;
    const total = WEAPON_SETS.length * TEXTURE_MAPS.length;
    if (maps.uploaded >= total) {
      this.#wear();
      return 0;
    }
    const set = WEAPON_SETS[Math.floor(maps.uploaded / TEXTURE_MAPS.length)]!;
    const texture = maps.sets.get(set)![TEXTURE_MAPS[maps.uploaded % TEXTURE_MAPS.length]!];
    const bytes = textureBytes(texture);
    this.#loaders.upload(texture);
    if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
    maps.bytes += bytes;
    maps.uploaded++;
    if (maps.uploaded === total) this.#wear();
    return bytes;
  }

  /** Compile the template's programs and draw it once; the weapons turn ready once the maps are in too. */
  #warmUp(): void {
    const template = this.#template!, generation = this.#generation;
    const warmed = (this.#loaders.compile?.(template) ?? Promise.resolve()).catch(() => {})
      .then(() => (generation === this.#generation ? this.#loaders.warm?.(template) : undefined));
    warmed.catch(() => {}).then(() => {
      if (generation !== this.#generation) return;
      this.#warm = true;
      this.#announce();
    });
  }

  /** Put the wanted size's maps on the materials once they and the model are in; free the size they replace. */
  #wear(): void {
    const maps = this.#next();
    if (!this.#template || !maps?.sets || maps.uploaded < WEAPON_SETS.length * TEXTURE_MAPS.length) return;
    for (const { material, set } of this.#materials) {
      const worn = set && maps.sets.get(set as WeaponSet);
      if (worn && material instanceof THREE.MeshStandardMaterial) wearMaps(material, worn);
    }
    if (this.#worn) this.#free(this.#worn);
    this.#maps = this.#maps.filter(m => m === maps);
    this.#worn = maps;
    this.#announce();
  }

  /** Ready, the first time the template is warm with maps worn; a later size swap changes no program. */
  #announce(): void {
    if (this.#ready || !this.#warm || !this.#worn) return;
    this.#ready = true;
    this.#notify();
  }

  #free(maps: Maps): void {
    for (const set of maps.sets?.values() ?? []) for (const texture of Object.values(set)) texture.dispose();
    maps.sets = null;
  }

  #notify(): void {
    for (const listener of [...this.#listeners, ...this.#propListeners]) listener();
  }

  /**
   * A new instance of one model of the glb (`r4c`, `mp5`, `acog`, ...): its
   * nodes, their names without the `<model>__` prefix, sharing the
   * template's geometry and materials. Null until `ready`, or for a model the
   * glb lacks.
   */
  instance(model: string): THREE.Object3D | null {
    const source = this.#ready ? this.#template?.getObjectByName(model) : undefined;
    if (!source) return null;
    const copy = source.clone(true);
    copy.traverse(node => { node.name = node.name.replace(`${model}__`, ''); });
    return copy;
  }

  /**
   * An enemy's prop on the realistic tiers (render/figure.ts `PropSource`):
   * a copy of the kind's LOD (geometry and material shared). Null until
   * `ready`, and for a kind without one (the hammer stays the flat prop).
   */
  prop(kind: string): THREE.Object3D | null {
    const source = this.#ready ? this.#template?.getObjectByName(`prop__${kind}`) : undefined;
    if (!source) return null;
    for (const ref of this.#props) if (!ref.deref()) this.#props.delete(ref);
    const copy = source.clone();
    this.#props.add(new WeakRef(copy));
    return copy;
  }

  /** Call `listener` whenever `prop` changes (the weapons turn ready or are freed). Returns the unsubscribe. */
  subscribeProps(listener: () => void): () => void {
    this.#propListeners.add(listener);
    return () => this.#propListeners.delete(listener);
  }

  /** A model's clips by name (`reload`, `equip`, ...), their tracks bound to an instance's node names. */
  clips(model: string): ReadonlyMap<string, THREE.AnimationClip> {
    return this.#clips.get(model) ?? new Map();
  }

  /**
   * Free the model, the materials and every map, and tell the subscribers
   * (the flat guns come back). A prop still around is hidden first: the
   * figures swap those still in hand, but a dropped one (the debris, for its
   * last seconds) would draw the freed geometry and maps.
   */
  clear(): void {
    for (const ref of this.#props) {
      const prop = ref.deref();
      if (prop) prop.visible = false;
    }
    this.#props.clear();
    this.#generation++;
    this.#size = null;
    this.#loading = this.#failed = this.#warm = false;
    for (const maps of this.#maps) this.#free(maps);
    this.#maps = [];
    this.#worn = null;
    if (this.#template) disposeTree(this.#template);
    this.#template = null;
    for (const { material } of this.#materials) material.dispose();
    this.#materials = [];
    this.#clips.clear();
    if (this.#ready) {
      this.#ready = false;
      this.#notify();
    }
  }

  /** Texture objects alive here and their GPU bytes, for the tier report and the leak test. */
  get stats(): { textures: number; residentBytes: number; materials: number; model: boolean } {
    let textures = 0, residentBytes = 0;
    for (const maps of this.#maps) {
      textures += (maps.sets?.size ?? 0) * TEXTURE_MAPS.length;
      residentBytes += maps.bytes;
    }
    return { textures, residentBytes, materials: this.#materials.length, model: this.#template !== null };
  }
}

/** Free a template's geometry (instances share it, so only the asset owner does this). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
  });
}

import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { ANISOTROPY, TEXTURE_MAPS, textureUrl } from './surfaces';
import { bakeUrl, isAoFile } from './lightmap';
import type { BakeFile, BakeInfo } from './lightmap';
import type { TextureSet, TextureSize } from './surfaces';

/** One texture set's three maps, as a material wears them. */
export interface SetMaps {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
}

/** Fetch and decode one map, filtered with this much anisotropy. The game's is `ktx2Loader`'s; tests pass their own. */
export type LoadTexture = (url: string, anisotropy: number) => Promise<THREE.Texture>;
/** Fetch and decode one bake file (a lightmap or AO map). The game's is `lightmapLoader`'s; tests pass their own. */
export type LoadBake = (url: string) => Promise<THREE.Texture>;

interface Entry {
  set: TextureSet;
  size: TextureSize;
  maps: SetMaps | null;
  failed: boolean;
  /** Maps handed to the GPU so far (0-3). */
  uploaded: number;
  /** GPU bytes of the uploaded maps, counted before their CPU copy was freed. */
  bytes: number;
}

/** GPU bytes a map takes once uploaded: every mip level of a compressed texture, else RGBA8 with mips. */
export function textureBytes(texture: THREE.Texture): number {
  const mips = (texture as THREE.CompressedTexture).mipmaps as { data?: ArrayBufferView }[] | undefined;
  if (texture instanceof THREE.CompressedTexture && mips && mips.length > 0) return mips.reduce((sum, mip) => sum + (mip.data?.byteLength ?? 0), 0);
  const image = texture.image as { width?: number; height?: number } | null;
  return Math.round((image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3);
}

/**
 * Streams the texture sets a map needs at the size a tier wants (R2).
 *
 * `want` names the sets and the size; every missing one starts downloading
 * (KTX2 files decode in the loader's workers), and a set that failed before
 * is tried again. Nothing reaches the GPU until `pump`, which uploads one map
 * and frees its CPU copy; the renderer spaces the calls out (render/index.ts,
 * `UPLOAD_GAP_MS`). When every wanted set is uploaded (or failed), `ready`
 * turns true and the renderer puts them all on the materials at once, a
 * uniform change only. A set the new list leaves out (the previous map's) is
 * freed by `want` itself, as no level material wears it any more; the
 * previous size of a wanted set stays on screen until the new one is ready,
 * and `prune` frees it then.
 */
export class TextureStreamer {
  readonly #entries = new Map<string, Entry>();
  readonly #load: LoadTexture;
  readonly #upload: (texture: THREE.Texture) => void;
  #sets: readonly TextureSet[] = [];
  #size: TextureSize = 512;
  #warned = new Set<string>();

  constructor(load: LoadTexture, upload: (texture: THREE.Texture) => void) {
    this.#load = load;
    this.#upload = upload;
  }

  get size(): TextureSize { return this.#size; }
  get sets(): readonly TextureSet[] { return this.#sets; }

  /**
   * Ask for these sets at this size. Frees every set not in the list, at any
   * size, and starts every missing download. The caller puts the stand-ins
   * back on any material that wore a freed set (render/index.ts, `_dropFreedMaps`).
   */
  want(sets: readonly TextureSet[], size: TextureSize): void {
    this.#sets = [...sets];
    this.#size = size;
    for (const [key, entry] of this.#entries) {
      if (sets.includes(entry.set)) continue;
      this.#entries.delete(key);
      if (entry.maps) for (const texture of Object.values(entry.maps)) texture.dispose();
    }
    for (const set of sets) {
      const key = `${set}@${size}`;
      if (this.#entries.get(key)?.failed === false) continue;
      const entry: Entry = { set, size, maps: null, failed: false, uploaded: 0, bytes: 0 };
      this.#entries.set(key, entry);
      Promise.all(TEXTURE_MAPS.map(map => this.#load(textureUrl(set, size, map), ANISOTROPY[size]))).then(([albedo, normal, orm]) => {
        const maps = { albedo: albedo!, normal: normal!, orm: orm! };
        // Pruned or cleared while it downloaded: nobody will wear it.
        if (this.#entries.get(key) !== entry) {
          for (const texture of Object.values(maps)) texture.dispose();
          return;
        }
        entry.maps = maps;
      }, (error: unknown) => {
        if (this.#entries.get(key) !== entry) return;
        entry.failed = true;
        if (!this.#warned.has(set)) console.warn(`textures ${set}: ${error instanceof Error ? error.message : String(error)}`);
        this.#warned.add(set);
      });
    }
  }

  #wanted(): Entry[] {
    return this.#sets.map(set => this.#entries.get(`${set}@${this.#size}`)).filter((e): e is Entry => e !== undefined);
  }

  /** Every wanted set is on the GPU, or failed and will stay on its stand-in. */
  get ready(): boolean {
    return this.#wanted().every(entry => entry.failed || entry.uploaded === 3);
  }

  /**
   * Upload the next waiting map, if any has downloaded, then free its CPU
   * copy: the GPU holds the only one from now on, so a map is never uploaded
   * twice (after a context loss the renderer streams the sets again).
   * Returns the map's GPU bytes, or 0 when none was waiting.
   */
  pump(): number {
    const entry = this.#wanted().find(e => e.maps && e.uploaded < 3);
    if (!entry?.maps) return 0;
    const texture = entry.maps[TEXTURE_MAPS[entry.uploaded]!], bytes = textureBytes(texture);
    this.#upload(texture);
    freeCpuCopy(texture);
    entry.bytes += bytes;
    entry.uploaded++;
    return bytes;
  }

  /** A wanted set's maps once uploaded; null while streaming, after a failure, or for a set not wanted. */
  maps(set: TextureSet): SetMaps | null {
    const entry = this.#sets.includes(set) ? this.#entries.get(`${set}@${this.#size}`) : undefined;
    return entry?.maps && entry.uploaded === 3 ? entry.maps : null;
  }

  /** Is this texture still owned here (not freed)? */
  owns(texture: THREE.Texture): boolean {
    for (const entry of this.#entries.values()) {
      if (entry.maps && (entry.maps.albedo === texture || entry.maps.normal === texture || entry.maps.orm === texture)) return true;
    }
    return false;
  }

  /** Free every set that is not wanted at the wanted size. */
  prune(): void {
    const keep = new Set(this.#sets.map(set => `${set}@${this.#size}`));
    for (const [key, entry] of this.#entries) {
      if (keep.has(key)) continue;
      this.#entries.delete(key);
      if (entry.maps) for (const texture of Object.values(entry.maps)) texture.dispose();
    }
  }

  /** Free everything and want nothing (Low, or the renderer going away). */
  clear(): void {
    this.#sets = [];
    this.prune();
  }

  /** Texture objects alive here, uploaded or not. */
  get textureCount(): number {
    let n = 0;
    for (const entry of this.#entries.values()) if (entry.maps) n += 3;
    return n;
  }

  /** GPU bytes of the uploaded maps. */
  get residentBytes(): number {
    let bytes = 0;
    for (const entry of this.#entries.values()) bytes += entry.bytes;
    return bytes;
  }
}

/** Drop a compressed map's mip data once the GPU has it; its size stays on `image`. */
function freeCpuCopy(texture: THREE.Texture): void {
  if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
}

/**
 * Upload one 4 × 4 compressed texture in the format the KTX2 maps transcode
 * to, and free it. On ANGLE Metal the first compressed upload of a page
 * blocks for about 220 ms, whenever it comes; the renderer calls this as soon
 * as a realistic look is in force (at boot, or in Graphics), so that wait is
 * spent at the menu and not a second into a match.
 */
export function warmCompressedUploads(renderer: THREE.WebGLRenderer): void {
  const { extensions } = renderer;
  const format = extensions.has('WEBGL_compressed_texture_s3tc') ? THREE.RGBA_S3TC_DXT1_Format
    : extensions.has('WEBGL_compressed_texture_etc') ? THREE.RGB_ETC2_Format
    : extensions.has('WEBGL_compressed_texture_etc1') ? THREE.RGB_ETC1_Format : null;
  if (format === null) return;
  const mip = { data: new Uint8Array(8), width: 4, height: 4 } as unknown as ImageData;
  const texture = new THREE.CompressedTexture([mip], 4, 4, format);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  renderer.initTexture(texture);
  texture.dispose();
}

/** Where three's Basis transcoder lives (copied into public/ by tools/textures/build.mjs). */
export const TRANSCODER_PATH = '/basis/';

/**
 * The game's texture loader: KTX2 through three's `KTX2Loader`, set up for
 * tiling (repeat wrap, anisotropic filtering: the caller's, per tier, capped
 * at the GPU's). Albedo is sRGB, the normal and ORM maps are data.
 */
export function ktx2Loader(renderer: THREE.WebGLRenderer): { load: LoadTexture; dispose(): void } {
  const loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
  // ETC1S holds no more than a 4-bit-per-texel format can, so transcode it to one (BC1, else ETC)
  // rather than to ASTC or BC7 at twice the memory for the same texels. BC1 first: where a
  // desktop browser offers ETC at all it may be decompressed behind the scenes.
  const config = (loader as unknown as { workerConfig: Record<string, boolean> }).workerConfig;
  if (config.dxtSupported) config.etc1Supported = config.etc2Supported = false;
  if (config.dxtSupported || config.etc1Supported || config.etc2Supported) config.astcSupported = config.bptcSupported = false;
  const max = renderer.capabilities.getMaxAnisotropy();
  return {
    load: async (url, anisotropy) => {
      const texture = await loader.loadAsync(url);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(anisotropy, max);
      texture.colorSpace = url.endsWith('-albedo.ktx2') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    },
    dispose: () => loader.dispose(),
  };
}

/**
 * The bakes' loader (R3). Lightmaps are UASTC, not ETC1S: smooth light shows
 * ETC1S's blocks and 5-bit steps. They transcode to ASTC or BC7 (the same
 * memory, near UASTC's quality) where the GPU has either; ETC is left out
 * then, as the texture loader leaves it out, because a desktop may decompress
 * it behind the scenes. One worker: a map has two files. A lightmap is sRGB
 * (the file says so), clamped, on `uv1`, and trilinear without anisotropic
 * filtering: its samples along a grazing footprint would reach past a
 * chart's padding (which covers a mip texel and its bilinear neighbour) into
 * the next chart's light, and smooth light gains nothing from them.
 */
export function lightmapLoader(renderer: THREE.WebGLRenderer): { load: LoadBake; dispose(): void } {
  const loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).setWorkerLimit(1).detectSupport(renderer);
  const config = (loader as unknown as { workerConfig: Record<string, boolean> }).workerConfig;
  if (config.astcSupported || config.bptcSupported) config.etc1Supported = config.etc2Supported = false;
  return {
    load: async url => {
      const texture = await loader.loadAsync(url);
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 1;
      texture.channel = 1;
      texture.needsUpdate = true;
      return texture;
    },
    dispose: () => loader.dispose(),
  };
}

/** Fetch a bake's probe grid (`probes.bin`, gzip) as raw RGBA8 texels. */
export async function fetchGrid(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

/** A map's probe grid as a 3D texture: x, then z, then six faces of y layers; sRGB, trilinear. */
export function gridTexture(data: Uint8Array<ArrayBuffer>, info: BakeInfo): THREE.Data3DTexture {
  const [nx, ny, nz] = info.grid.cells;
  if (data.byteLength !== nx * ny * nz * 6 * 4) throw new Error(`probe grid is ${data.byteLength} bytes, not ${nx * ny * nz * 24}`);
  const texture = new THREE.Data3DTexture(data, nx, nz, 6 * ny);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** What the renderer wants of a bake: its map's name, the file for the tier, and the manifest entry. */
export interface BakeRequest {
  name: string;
  file: Exclude<BakeFile, 'probes'>;
  info: BakeInfo;
}

/** One bake on the GPU (or on its way): the lightmap or AO map and the probe grid. */
export interface BakedLight {
  name: string;
  file: Exclude<BakeFile, 'probes'>;
  info: BakeInfo;
  ao: boolean;
  lightmap: THREE.Texture | null;
  grid: THREE.Data3DTexture | null;
  failed: boolean;
  /** Pieces handed to the GPU so far (0-2). */
  uploaded: number;
  bytes: number;
}

/**
 * Streams the current map's bake (R3), like `TextureStreamer` but for one
 * lightmap and one probe grid. `want` names the map and the file the tier
 * shows; nothing reaches the GPU before `pump`, one piece a call, CPU copy
 * freed after. Once both are up, `take` makes them current and frees the
 * previous file. Another map's bake is freed at once by `want` (its lightmap
 * belongs to other UVs), so the renderer must take it off the materials then
 * (`current` turns null); the same map at another size stays current until
 * the new one is taken.
 */
export class BakeStreamer {
  readonly #load: LoadBake;
  readonly #loadGrid: (url: string) => Promise<Uint8Array<ArrayBuffer>>;
  readonly #upload: (texture: THREE.Texture) => void;
  #current: BakedLight | null = null;
  #next: BakedLight | null = null;
  #failed = false;
  #warned = new Set<string>();

  constructor(load: LoadBake, loadGrid: (url: string) => Promise<Uint8Array<ArrayBuffer>>, upload: (texture: THREE.Texture) => void) {
    this.#load = load;
    this.#loadGrid = loadGrid;
    this.#upload = upload;
  }

  get current(): BakedLight | null { return this.#current; }
  /** The last bake asked for failed to load; the level keeps the sky probe until it is asked again. */
  get failed(): boolean { return this.#failed; }

  want(request: BakeRequest | null): void {
    this.#failed = false;
    const same = (light: BakedLight | null) => light !== null && request !== null && light.name === request.name && light.file === request.file;
    if (request === null || (this.#current && this.#current.name !== request.name)) {
      free(this.#current);
      this.#current = null;
    }
    if (request === null || same(this.#current)) {
      free(this.#next);
      this.#next = null;
      return;
    }
    if (same(this.#next) && !this.#next!.failed) return;
    free(this.#next);
    const light: BakedLight = { name: request.name, file: request.file, info: request.info, ao: isAoFile(request.file),
      lightmap: null, grid: null, failed: false, uploaded: 0, bytes: 0 };
    this.#next = light;
    Promise.all([
      this.#load(bakeUrl(request.name, request.file)),
      this.#loadGrid(bakeUrl(request.name, 'probes')).then(data => gridTexture(data, request.info)),
    ]).then(([lightmap, grid]) => {
      // Dropped while it downloaded.
      if (this.#next !== light) {
        lightmap.dispose();
        grid.dispose();
        return;
      }
      light.lightmap = lightmap;
      light.grid = grid;
    }, (error: unknown) => {
      if (this.#next !== light) return;
      light.failed = true;
      if (!this.#warned.has(request.name)) console.warn(`bake ${request.name}: ${error instanceof Error ? error.message : String(error)}`);
      this.#warned.add(request.name);
    });
  }

  /** A bake is on its way or uploaded and not yet taken. */
  get waiting(): boolean {
    return this.#next !== null && !this.#next.failed;
  }

  /** Nothing is left to upload: the wanted bake is up (for `take`), current, failed, or not asked for. */
  get ready(): boolean {
    return this.#next === null || this.#next.failed || this.#next.uploaded === 2;
  }

  /** Upload the next downloaded piece and free its CPU copy; its GPU bytes, or 0 when none waits. */
  pump(): number {
    const light = this.#next;
    if (!light?.lightmap || !light.grid || light.uploaded >= 2) return 0;
    const texture = light.uploaded === 0 ? light.lightmap : light.grid;
    const bytes = light.uploaded === 0 ? textureBytes(texture) : light.grid.image.data?.byteLength ?? 0;
    this.#upload(texture);
    if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
    else light.grid.image.data = null as unknown as Uint8Array<ArrayBuffer>;
    light.bytes += bytes;
    light.uploaded++;
    return bytes;
  }

  /** Make the uploaded bake current (freeing the one it replaces) and return it; null if none is waiting. */
  take(): BakedLight | null {
    const light = this.#next;
    if (light === null || !this.ready) return null;
    this.#next = null;
    this.#failed = light.failed;
    if (light.failed) return null;
    free(this.#current);
    this.#current = light;
    return light;
  }

  /** Free everything and want nothing (Low, a map without a bake, or the renderer going away). */
  clear(): void {
    this.want(null);
  }

  /** Texture objects alive here and GPU bytes uploaded. */
  get stats(): { textures: number; residentBytes: number } {
    let textures = 0, residentBytes = 0;
    for (const light of [this.#current, this.#next]) {
      if (!light) continue;
      textures += (light.lightmap ? 1 : 0) + (light.grid ? 1 : 0);
      residentBytes += light.bytes;
    }
    return { textures, residentBytes };
  }
}

function free(light: BakedLight | null): void {
  light?.lightmap?.dispose();
  light?.grid?.dispose();
}

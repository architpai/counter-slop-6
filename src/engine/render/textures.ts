import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { TEXTURE_MAPS, textureUrl } from './surfaces';
import type { TextureSet, TextureSize } from './surfaces';

/** One texture set's three maps, as a material wears them. */
export interface SetMaps {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
}

/** Fetch and decode one map. The game's is `ktx2Load`; tests pass their own. */
export type LoadTexture = (url: string) => Promise<THREE.Texture>;

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
      Promise.all(TEXTURE_MAPS.map(map => this.#load(textureUrl(set, size, map)))).then(([albedo, normal, orm]) => {
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
 * tiling (repeat wrap, anisotropic filtering). Albedo is sRGB, the normal
 * and ORM maps are data.
 */
export function ktx2Loader(renderer: THREE.WebGLRenderer): { load: LoadTexture; dispose(): void } {
  const loader = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH).detectSupport(renderer);
  // ETC1S holds no more than a 4-bit-per-texel format can, so transcode it to one (BC1, else ETC)
  // rather than to ASTC or BC7 at twice the memory for the same texels. BC1 first: where a
  // desktop browser offers ETC at all it may be decompressed behind the scenes.
  const config = (loader as unknown as { workerConfig: Record<string, boolean> }).workerConfig;
  if (config.dxtSupported) config.etc1Supported = config.etc2Supported = false;
  if (config.dxtSupported || config.etc1Supported || config.etc2Supported) config.astcSupported = config.bptcSupported = false;
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return {
    load: async url => {
      const texture = await loader.loadAsync(url);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.colorSpace = url.endsWith('-albedo.ktx2') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      return texture;
    },
    dispose: () => loader.dispose(),
  };
}

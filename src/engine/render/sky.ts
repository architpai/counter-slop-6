import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

type Vec3 = readonly [number, number, number];

/**
 * `public/sky/<map>/sky.json`, written by `tools/blender/sky.py`. Radiance and
 * irradiance share one scale: a white horizontal surface in full sun (sun and
 * sky) has radiance 1, so these are the realistic tiers' light intensities.
 */
export interface SkyData {
  map: string;
  /** Towards the sun, unit length; must match the level mood's `sunDir`. */
  sunDir: Vec3;
  /** The sun's normal irradiance, per channel: the directional light's colour × intensity. */
  sun: Vec3;
  /** Sky radiance projected onto three's 9 SH basis functions: the light probe. */
  sh: readonly Vec3[];
  /** Mean radiance of the lowest degree above the horizon: the fog colour, before the mood's haze. */
  fog: Vec3;
  /** `sky.webp` stores radiance / background, sRGB-encoded. */
  background: number;
}

/** A fetched sky: the environment still an equirect HDR, the visible background, and the data. */
export interface SkySource {
  key: string;
  data: SkyData;
  hdr: THREE.DataTexture;
  background: THREE.Texture;
}

/** A sky in use: `hdr` turned into the PMREM environment by the renderer's own generator. */
export interface SkyAssets {
  key: string;
  data: SkyData;
  env: THREE.WebGLRenderTarget;
  background: THREE.Texture;
}

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));

/** Check a parsed `sky.json`; a bad file must fall back to the gradient dome, not break the lights. */
export function parseSkyData(raw: unknown): SkyData {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const { map, sunDir, sun, sh, fog, background } = value;
  if (typeof map !== 'string' || !isVec3(sunDir) || !isVec3(sun) || !isVec3(fog)
    || !Array.isArray(sh) || sh.length !== 9 || !sh.every(isVec3)
    || typeof background !== 'number' || !(background > 0)) throw new Error('malformed sky.json');
  return { map, sunDir, sun, sh, fog, background };
}

/** Where a map's sky lives; `next` exports `public/` at the site root. */
export const skyUrl = (key: string, file: string): string => `/sky/${key}/${file}`;

/**
 * Fetch and decode one map's sky. Streams after the map is picked (the caller
 * does not wait on it), so the menu never blocks on it. The PMREM step is the
 * caller's (`Renderer`), with a generator it keeps: a new one per sky compiled
 * its shaders again, about 200 ms, in the frame the sky landed.
 */
export async function loadSky(key: string): Promise<SkySource> {
  const [data, hdr, background] = await Promise.all([
    fetch(skyUrl(key, 'sky.json')).then(response => {
      if (!response.ok) throw new Error(`sky.json: HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    }).then(parseSkyData),
    new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(skyUrl(key, 'env.hdr')),
    // An ImageBitmap, decoded (and flipped for three's equirect layout) off the main thread: an image
    // element's upload converted its pixels on it, 19 ms in the frame the sky landed; this one takes 2-3.
    new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' }).loadAsync(skyUrl(key, 'sky.webp'))
      .then(bitmap => new THREE.Texture(bitmap)),
  ]);
  background.flipY = false;
  background.needsUpdate = true;
  background.colorSpace = THREE.SRGBColorSpace;
  // Magnified everywhere on screen, and mipmaps would seam where the longitude wraps.
  background.generateMipmaps = false;
  background.minFilter = THREE.LinearFilter;
  return { key, data, hdr, background };
}

export function disposeSky(sky: SkyAssets | SkySource | null): void {
  if (sky === null) return;
  if ('env' in sky) sky.env.dispose();
  else sky.hdr.dispose();
  sky.background.dispose();
  (sky.background.image as Partial<ImageBitmap> | null)?.close?.();
}

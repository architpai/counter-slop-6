import * as THREE from 'three';
import manifest from './fx-assets.json';
import { GRID_GLSL, GRID_UNIFORMS, surfMat, unlitMat, withGrid } from './materials';
import { TONE, TONE_HEX } from './palette';
import { TEXTURE_SIZE } from './surfaces';
import { textureBytes } from './textures';
import type { GfxValues } from './quality';
import type { TextureSize } from './surfaces';
import type { LoadTexture } from './textures';

/**
 * The combat effects' render half (docs/VISUALS.md, R5): the self-made
 * effect atlases (tools/blender/effects/, streamed like the weapons), the
 * shared uniforms of the soft-particle pass, the flipbook timing, and the
 * effects' materials. Every material here is made once and kept, like
 * materials.ts's caches: the atlases stream onto them (`wearFx`), so a map
 * landing changes a uniform, never a program. effects.ts and
 * effects-real.ts own the pools that draw with them.
 */

// ------------------------------------------------------------------ atlases

export const FX_ATLASES = ['fire', 'smoke', 'decals', 'decals-normal'] as const;
export type FxAtlas = (typeof FX_ATLASES)[number];
/** One atlas's entry in `fx-assets.json`, written by `tools/effects/build.mjs`. */
export interface AtlasInfo {
  cols: number;
  rows: number;
  alpha: boolean;
  srgb: boolean;
  /** Runs of cells by name: `[first, count]`, cell i at column i % cols, row i / cols from the bottom. */
  layout: Readonly<Record<string, readonly [number, number]>>;
  /** File bytes per Textures size. */
  bytes: Readonly<Record<`${TextureSize}`, number>>;
}

/** Check `fx-assets.json`: a hand edit that breaks it fails at load, not as invisible effects. */
export function parseFxManifest(raw: unknown): Readonly<Record<FxAtlas, AtlasInfo>> {
  const atlases = (typeof raw === 'object' && raw !== null ? (raw as { atlases?: unknown }).atlases : null) ?? null;
  if (typeof atlases !== 'object' || atlases === null) throw new Error('malformed fx-assets.json');
  for (const name of FX_ATLASES) {
    const info = (atlases as Record<string, Partial<AtlasInfo> | undefined>)[name];
    if (!info || !(Number(info.cols) > 0) || !(Number(info.rows) > 0) || typeof info.layout !== 'object' || info.layout === null
      || !Object.values(TEXTURE_SIZE).every(size => typeof info.bytes?.[`${size}`] === 'number')) throw new Error(`fx-assets.json: ${name}`);
    for (const [first, count] of Object.values(info.layout)) {
      if (!(first >= 0 && count > 0 && first + count <= info.cols! * info.rows!)) throw new Error(`fx-assets.json: ${name} layout`);
    }
  }
  return atlases as Record<FxAtlas, AtlasInfo>;
}

export const FX_MANIFEST = parseFxManifest(manifest);
export const fxUrl = (size: TextureSize, atlas: FxAtlas): string => `/fx/${size}/${atlas}.ktx2`;

/** What a tier downloads for its effects: every atlas at its size. */
export function fxDownloadBytes(size: TextureSize): number {
  return FX_ATLASES.reduce((sum, atlas) => sum + FX_MANIFEST[atlas].bytes[`${size}`], 0);
}

/** The atlas size for these values (the Textures setting's, as the level's sets), or null on the flat look, which loads none. */
export function fxTextureSize(values: Pick<GfxValues, 'look' | 'textures'>): TextureSize | null {
  return values.look === 'realistic' ? TEXTURE_SIZE[values.textures] : null;
}

/** A named run of cells: `[first, count]`. */
export function cells(atlas: FxAtlas, name: string): readonly [number, number] {
  const run = FX_MANIFEST[atlas].layout[name];
  if (!run) throw new Error(`fx-assets.json: ${atlas} has no ${name}`);
  return run;
}

// ----------------------------------------------------------------- flipbooks

/** Two neighbouring cells of a flipbook and how far between them. */
export interface Frame { a: number; b: number; blend: number }

/**
 * The flipbook frame at `t` (0 at birth, 1 at death) over `count` cells from
 * `first`: the two cells either side of the exact time and the blend between
 * them, so a 16-frame flipbook plays smoothly at any life. Clamped: a particle
 * past its life holds the last frame.
 */
export function flipbookFrame(t: number, first: number, count: number, out: Frame = { a: 0, b: 0, blend: 0 }): Frame {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (count - 1);
  const i = Math.min(count - 1, Math.floor(x));
  out.a = first + i;
  out.b = first + Math.min(count - 1, i + 1);
  out.blend = x - i;
  return out;
}

// ------------------------------------------------------------------ uniforms

/**
 * Shared by every effect material, written by the renderer each frame. The
 * soft particles' scene depth (`fxDepth`, the depth texture of the scene
 * target; `fxDepthSize`, the size of the layer they draw into, over which
 * `gl_FragCoord` is that texture's UV; and the camera's range), the world size of a pixel at one
 * metre (`fxPixel`: tracers never draw thinner than about a pixel), and the
 * light the lit sprites take where the probe grid is not in: the sky's
 * irradiance and the sun's (`fxAmbient`, `fxSun`).
 */
export const FX_UNIFORMS = {
  fxDepth: { value: null as THREE.Texture | null },
  fxDepthSize: { value: new THREE.Vector2(1, 1) },
  fxNear: { value: 0.08 },
  fxFar: { value: 420 },
  fxPixel: { value: 0.001 },
  /** A frame count (0-63) that moves the dithered smoke's noise. */
  fxFrame: { value: 0 },
  fxAmbient: { value: new THREE.Color(0.6, 0.6, 0.6) },
  fxSun: { value: new THREE.Color(1.5, 1.5, 1.5) },
};

// ----------------------------------------------------------------- stand-ins

function pixel(r: number, g: number, b: number, a: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}
/**
 * The fire atlas's stand-in: a soft warm glow in every cell, 16 texels a cell.
 * The Blender guns' flash quads (weapons/models.ts) wear the fire atlas and do
 * not wait for it, so before it lands, when it fails and after a lost context
 * a shot still flashes, as a plain glow.
 */
function glowCells(): THREE.DataTexture {
  const { cols, rows } = FX_MANIFEST.fire, cell = 16, width = cols * cell, height = rows * cell;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = ((x % cell) + 0.5) / cell * 2 - 1, v = ((y % cell) + 0.5) / cell * 2 - 1;
    const f = Math.max(0, 1 - Math.hypot(u, v)) ** 2, i = (y * width + x) * 4;
    data.set([Math.round(200 * f), Math.round(150 * f), Math.round(90 * f), 255], i);
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
let standIns: Record<FxAtlas, THREE.DataTexture> | undefined;
/**
 * The atlases' stand-ins until their maps are in: the fire a glow per cell
 * (`glowCells`), the rest one texel, clear, the normal flat. The sprites and
 * decals never show them (the effects wait for `ready`); the guns' flash does.
 */
function standIn(atlas: FxAtlas): THREE.DataTexture {
  standIns ??= {
    fire: glowCells(), smoke: pixel(128, 128, 128, 0, THREE.SRGBColorSpace),
    decals: pixel(128, 128, 128, 0, THREE.SRGBColorSpace), 'decals-normal': pixel(128, 128, 255, 255, THREE.NoColorSpace),
  };
  return standIns[atlas];
}

// ------------------------------------------------------------------ geometry

/**
 * An instanced quad for the sprite pools: per instance `iPos` (centre, size),
 * `iColor` (linear tint, HDR for the fire; alpha), `iFrame` (cells a and b,
 * their blend, a rotation) and `iAxis` (w = 0: a billboard; w > 0: stretched
 * w times its size along xyz, facing the eye; w < 0: flat in the plane whose
 * normal is xyz, a ground ring). A cell below 0 is the lit shader's analytic
 * ring (a shockwave), not a texture cell.
 */
export function spriteGeometry(capacity: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const name of ['iPos', 'iColor', 'iFrame', 'iAxis']) {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** An instanced ribbon for the tracers: `iStart` (from, width), `iEnd` (to, life left 0-1), `iColor` (HDR colour, solid share). */
export function tracerGeometry(capacity: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const name of ['iStart', 'iEnd', 'iColor']) {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

// ----------------------------------------------------------------- materials

/** Premultiplied alpha: a colour with alpha 0 adds (glow), with alpha 1 covers (a solid core). */
function premultiplied(material: THREE.ShaderMaterial): THREE.ShaderMaterial {
  material.transparent = true;
  material.depthWrite = false;
  material.premultipliedAlpha = true;
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  // Two-sided and blended: three would draw it twice a frame (back faces, then front) and re-key its
  // program before each. It writes no depth and needs no face order, so once does.
  material.forceSinglePass = true;
  return material;
}

let tracer: THREE.ShaderMaterial | undefined;
/**
 * Tracers on every tier (V5): a camera-facing ribbon with a soft glow round a
 * hot core, fading in over its first eighth (a shot's start by the gun never
 * fills the screen) and brighter towards its end, faded by its life. Never
 * thinner than 1.5 pixels: a thinner one is widened and dimmed to match, so
 * a far tracer does not crawl. Its alpha is the solid share (0 for the
 * player's additive streaks, most for the enemies' red, which must read on
 * sand and sky alike).
 */
export function tracerMaterial(): THREE.ShaderMaterial {
  tracer ??= premultiplied(new THREE.ShaderMaterial({
    name: 'fx:tracer',
    // The ribbon's winding follows its side vector, which may face either way.
    side: THREE.DoubleSide,
    uniforms: { fxPixel: FX_UNIFORMS.fxPixel },
    vertexShader: `
      attribute vec4 iStart, iEnd, iColor;
      uniform float fxPixel;
      varying vec2 vRibbon;
      varying vec4 vColor;
      varying float vFade;
      void main() {
        vec3 p = mix(iStart.xyz, iEnd.xyz, position.x);
        vec3 axis = iEnd.xyz - iStart.xyz;
        vec3 eye = cameraPosition - p;
        vec3 side = cross(axis, eye);
        side = length(side) > 1e-6 ? normalize(side) : vec3(0.0, 1.0, 0.0);
        float pixelWidth = 1.5 * fxPixel * length(eye);
        float width = max(iStart.w, pixelWidth);
        vFade = iEnd.w * iStart.w / width;
        vRibbon = vec2(position.x, position.y);
        vColor = iColor;
        gl_Position = projectionMatrix * viewMatrix * vec4(p + side * position.y * width * 0.5, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vRibbon;
      varying vec4 vColor;
      varying float vFade;
      void main() {
        float across = vRibbon.y * vRibbon.y;
        float glow = exp(-across * 3.5), core = exp(-across * 16.0);
        float along = smoothstep(0.0, 0.12, vRibbon.x) * (0.4 + 0.6 * vRibbon.x);
        float k = along * vFade;
        gl_FragColor = vec4(vColor.rgb * (0.45 * glow + core) * k, vColor.a * clamp(core * 1.6, 0.0, 1.0) * k);
      }
    `,
  }));
  return tracer;
}

/**
 * The dithered smoke's alpha-test threshold (0..1) at a pixel: interleaved
 * gradient noise, moved on every frame (`fxFrame`) and by each sprite's own
 * seed. A fixed 4 x 4 ordered dither showed as a regular dot screen, through
 * the fire added over it too, and overlapping puffs on the same pattern
 * covered no more than one; moving, it reads as a fine grain.
 */
const DITHER_GLSL = `
  uniform float fxFrame;
  float fxDither(vec2 p, float seed) {
    p += 5.588238 * (fxFrame + seed);
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
`;

/** The lit atlas's texels are scaled by this: their shaded grey (mean about 0.43 linear) reads as white. */
export const LIT_TEXEL_GAIN = 2.3;

export type SpriteKind = 'fire' | 'fire-soft' | 'soft' | 'dither';
const sprites = new Map<SpriteKind, THREE.ShaderMaterial>();

/**
 * The sprite pools' material (R5). `fire`: the additive atlas (fireballs,
 * flashes, sparks, the one-frame glow), faded by fog. `soft` and `dither`:
 * the lit atlas (smoke, dust, chips, splinters, shards, and an analytic
 * shockwave ring), lit per sprite by the probe grid's ambient cube at its
 * centre and the sun share it sees (the fixed sky light where there is no
 * grid), so smoke indoors is dark. `soft` (High and Ultra) blends and fades
 * where it meets the scene's depth, drawn after the scene into a layer of
 * its own (`Renderer.fxScene`, postfx.ts `drawSoft`) with no depth test (the
 * fade hides it behind the scene), its instances sorted back to front; `dither`
 * (Medium, or no depth texture) stays in the opaque pass behind a moving
 * noise dither, so it needs no sort. Both fade out within a metre of the eye, so
 * smoke never fills the screen. `fire-soft` is `fire` for the soft pass,
 * faded where it meets the scene too.
 */
export function spriteMaterial(kind: SpriteKind): THREE.ShaderMaterial {
  let material = sprites.get(kind);
  if (material) return material;
  const fire = kind === 'fire' || kind === 'fire-soft';
  const atlas: FxAtlas = fire ? 'fire' : 'smoke';
  const info = FX_MANIFEST[atlas];
  const defines: Record<string, string> = fire ? { FIRE: '' } : { LIT: '' };
  if (kind === 'fire-soft' || kind === 'soft') defines.SOFT = '';
  material = new THREE.ShaderMaterial({
    name: `fx:sprite-${kind}`,
    defines,
    // A stretched or flat sprite's winding follows its axis, which may face either way.
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: standIn(atlas) },
      atlasGrid: { value: new THREE.Vector2(info.cols, info.rows) },
    }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      #ifdef LIT
      ${GRID_GLSL}
      uniform vec3 fxAmbient, fxSun;
      varying vec3 vLight;
      #endif
      attribute vec4 iPos, iColor, iFrame, iAxis;
      uniform vec2 atlasGrid;
      varying vec2 vUvA, vUvB, vQuad;
      varying vec4 vColor;
      varying float vBlend, vViewZ, vSize, vRing;
      #ifndef SOFT
      varying float vSeed;
      #endif
      vec2 cellUv(float c, vec2 q) {
        float col = mod(c, atlasGrid.x), row = floor(c / atlasGrid.x);
        return (vec2(col, row) + q) / atlasGrid;
      }
      void main() {
        vec2 q = position.xy;
        vec3 centre = iPos.xyz;
        float size = iPos.w, c = cos(iFrame.w), s = sin(iFrame.w);
        vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
        vec4 mvPosition;
        if (iAxis.w > 0.0) {
          vec3 axis = normalize(iAxis.xyz), toEye = cameraPosition - centre;
          vec3 side = cross(axis, toEye);
          side = length(side) > 1e-6 ? normalize(side) : vec3(0.0, 1.0, 0.0);
          mvPosition = viewMatrix * vec4(centre + axis * (q.x * size * iAxis.w) + side * (q.y * size), 1.0);
        } else if (iAxis.w < 0.0) {
          vec3 n = normalize(iAxis.xyz);
          vec3 t = normalize(cross(abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
          mvPosition = viewMatrix * vec4(centre + t * r.x + cross(n, t) * r.y, 1.0);
        } else {
          mvPosition = viewMatrix * vec4(centre, 1.0);
          #ifdef FIRE
          // Pulled towards the eye by half its size (at the same size on screen): a figure the fire swells
          // round is behind all of the quad, so the fire adds over the whole of it, its mask too, instead of
          // over only what the plane cuts behind it.
          float d = -mvPosition.z;
          if (d > 0.01) {
            float k = max(d - 0.5 * size, min(d, 0.5)) / d;
            mvPosition.xyz *= k;
            r *= k;
          }
          #endif
          mvPosition.xy += r;
        }
        vec2 uv = q + 0.5;
        vUvA = cellUv(max(iFrame.x, 0.0), uv);
        vUvB = cellUv(max(iFrame.y, 0.0), uv);
        vRing = iFrame.x < 0.0 ? 1.0 : 0.0;
        vQuad = q;
        vBlend = iFrame.z;
        #ifndef SOFT
        // Each puff's own shift of the dither noise, from its random turn.
        vSeed = floor(fract(iFrame.w * 0.1591549) * 64.0);
        #endif
        vColor = iColor;
        vSize = size;
        vViewZ = -mvPosition.z;
        #ifdef LIT
        vec3 light = fxAmbient;
        float sun = 1.0;
        if (probeGridMix > 0.0) {
          // Read a cell up: the grid's lowest probes sit on the ground and see half the sun at best, so a
          // puff 6 cm off a sunlit floor came out darker than the tile it rose from. A cell up is still
          // under the same roof indoors.
          vec3 at = centre + vec3(0.0, probeGridCell, 0.0);
          vec4 up = gridIrradiance(at, vec3(0.0, 1.0, 0.0));
          vec4 facing = gridIrradiance(at, normalize(cameraPosition - at));
          vec4 cube = 0.5 * (up + facing);
          light = mix(light, max(cube.rgb, fxAmbient * probeGridFloor * 0.5), probeGridMix);
          sun = mix(1.0, cube.a, probeGridMix);
        }
        // A puff scatters the sun it stands in about as a floor facing it does (the sun is 55 degrees up).
        vLight = (light + fxSun * sun) * RECIPROCAL_PI;
        #endif
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      uniform sampler2D map;
      varying vec2 vUvA, vUvB, vQuad;
      varying vec4 vColor;
      varying float vBlend, vViewZ, vSize, vRing;
      #ifdef LIT
      varying vec3 vLight;
      #endif
      #ifdef SOFT
      uniform sampler2D fxDepth;
      uniform vec2 fxDepthSize;
      uniform float fxNear, fxFar;
      #else
      ${DITHER_GLSL}
      varying float vSeed;
      #endif
      void main() {
        vec4 t = mix(texture2D(map, vUvA), texture2D(map, vUvB), vBlend);
        // Never across the eye: a puff or a flash within a metre fades out.
        float fade = smoothstep(0.35, 1.2, vViewZ);
        #ifdef SOFT
        float scene = -perspectiveDepthToViewZ(texture2D(fxDepth, gl_FragCoord.xy / fxDepthSize).x, fxNear, fxFar);
        fade *= clamp((scene - vViewZ) / max(0.12, 0.3 * vSize), 0.0, 1.0);
        #endif
        #ifdef FIRE
        vec3 col = t.rgb * vColor.rgb * vColor.a * fade;
        #ifdef USE_FOG
        col *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor = vec4(col, 0.0);
        #else
        // The atlas's puffs and debris carry Blender's own shading, about 0.43 linear on average:
        // that average stands for the tint's full colour, so sunlit dust is as light as its surface.
        t.rgb *= ${LIT_TEXEL_GAIN.toFixed(2)};
        if (vRing > 0.5) {
          float d = length(vQuad) * 2.0;
          t = vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d)));
        }
        float alpha = t.a * vColor.a * fade;
        vec3 col = t.rgb * vColor.rgb * vLight;
        #ifdef USE_FOG
        col = mix(col, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
        #endif
        #ifdef SOFT
        gl_FragColor = vec4(col * alpha, alpha);
        #else
        // Nothing under a tenth: a faint puff's tail dithered into a scatter of lone dots over the view.
        if (alpha < max(0.1, fxDither(gl_FragCoord.xy, vSeed))) discard;
        gl_FragColor = vec4(col, 1.0);
        #endif
        #endif
      }
    `,
  });
  Object.assign(material.uniforms, FX_UNIFORMS, GRID_UNIFORMS);
  if (kind === 'dither') {
    material.transparent = false;
  } else premultiplied(material);
  // The soft layer has no depth buffer: a soft sprite hides behind the scene by its own depth fade.
  if (defines.SOFT !== undefined) material.depthTest = false;
  sprites.set(kind, material);
  return material;
}

let decal: THREE.MeshStandardMaterial | undefined;
/**
 * Bullet holes and scorch marks on the realistic tiers (R5, V10): the decal
 * atlas's albedo, alpha and normal map on a lit `MeshStandardMaterial`, so a
 * hole darkens in shade and indoors (the sun's shadow maps, and the probe
 * grid's light in place of the sky's, as the characters take it) and its
 * crater catches the light. Each instance picks its cell (`decalCell`: the
 * UV offset and scale) and is tinted with the hit surface's colour. Pulled
 * towards the eye in depth (polygon offset), never written to depth, so it
 * never fights the wall.
 */
export function decalMaterial(): THREE.MeshStandardMaterial {
  if (decal) return decal;
  decal = new THREE.MeshStandardMaterial({
    name: 'fx:decal', map: standIn('decals'), normalMap: standIn('decals-normal'), roughness: 0.85, metalness: 0,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  decal.normalScale.set(1, 1);
  decal.onBeforeCompile = shader => {
    withGrid(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 decalCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = vMapUv * decalCell.zw + decalCell.xy;
vNormalMapUv = vNormalMapUv * decalCell.zw + decalCell.xy;`);
  };
  decal.customProgramCacheKey = () => 'fx-decal';
  return decal;
}

let splat: THREE.MeshStandardMaterial | undefined;
/** Blood splats and pools on the realistic tiers (V10): lit like the decals, wet, and pulled towards the eye. */
export function splatMaterial(): THREE.MeshStandardMaterial {
  if (splat) return splat;
  splat = new THREE.MeshStandardMaterial({
    name: 'fx:splat', color: 0xffffff, roughness: 0.32, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  splat.onBeforeCompile = withGrid;
  splat.customProgramCacheKey = () => 'fx-splat';
  return splat;
}

let flatDecal: THREE.MeshBasicMaterial | undefined;
/** The flat look's decals and splats (V10): unlit discs, as before, but pulled towards the eye so they never flicker. */
export function flatDecalMaterial(): THREE.MeshBasicMaterial {
  return flatDecal ??= new THREE.MeshBasicMaterial({
    name: 'fx:flat-decal', color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

const shells = new Map<'brass' | 'shotshell', THREE.MeshStandardMaterial>();
/** Spent casings (R5): polished brass, and the shotgun's red hull on a brass head (vertex colours); lit by the probe grid. */
export function shellMaterial(kind: 'brass' | 'shotshell'): THREE.MeshStandardMaterial {
  let material = shells.get(kind);
  if (!material) {
    material = kind === 'brass'
      ? new THREE.MeshStandardMaterial({ name: 'fx:brass', color: 0xc9a24e, metalness: 1, roughness: 0.28 })
      : new THREE.MeshStandardMaterial({ name: 'fx:shotshell', vertexColors: true, metalness: 0.3, roughness: 0.45 });
    material.onBeforeCompile = withGrid;
    material.customProgramCacheKey = () => `fx-${kind}`;
    shells.set(kind, material);
  }
  return material;
}

let flash: THREE.MeshBasicMaterial | undefined;
/**
 * The Blender guns' muzzle flash (R5, V5): the fire atlas's flash cells on
 * crossed quads, additive and HDR, so the flash itself feeds the bloom. Drawn
 * in one pass (additive, no depth write: face order does not matter).
 */
export function flashMaterial(): THREE.MeshBasicMaterial {
  if (flash) return flash;
  flash = new THREE.MeshBasicMaterial({
    name: 'fx:flash', map: standIn('fire'), color: new THREE.Color(13, 10, 7.5), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, forceSinglePass: true,
  });
  return flash;
}

let lowFlash: THREE.MeshBasicMaterial | undefined;
/** The flat guns' flash stars (V5): the accent colour, now additive, so the flash glows over what is behind it. */
export function lowFlashMaterial(): THREE.MeshBasicMaterial {
  return lowFlash ??= new THREE.MeshBasicMaterial({
    name: 'fx:flat-flash', color: new THREE.Color(TONE_HEX[TONE.ACCENT]).multiplyScalar(1.3), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, forceSinglePass: true,
  });
}

const bolts = new Map<number, THREE.MeshBasicMaterial>();
/** Enemy projectiles (V5): their tone a little over white's brightness, so the realistic tiers' bloom gives them a glow, and still their colour on Low. */
export function boltMaterial(tone: number): THREE.MeshBasicMaterial {
  const hex = TONE_HEX[tone] ?? TONE_HEX[TONE.HOSTILE];
  let material = bolts.get(hex);
  if (!material) bolts.set(hex, material = new THREE.MeshBasicMaterial({ name: 'fx:bolt', color: new THREE.Color(hex).multiplyScalar(1.35) }));
  return material;
}

let hazardSmoke: THREE.MeshBasicMaterial | undefined;
/**
 * A thrown smoke grenade and, on the flat look, its cloud (enemies/hazards.ts):
 * alpha-hashed, so it stays in the opaque pass with no sorting (ARCHITECTURE
 * §3.2). Each grenade wears a clone for its own opacity; the clones share
 * this one's program, which the menu links (`fxTemplate`), since alpha hash
 * is a program variant of its own.
 */
export function hazardSmokeMaterial(): THREE.MeshBasicMaterial {
  return hazardSmoke ??= new THREE.MeshBasicMaterial({ name: 'fx:hazard-smoke', color: 0x809096, alphaHash: true, opacity: 0.85 });
}

/** Put the atlases on the materials that wear them; null puts the stand-ins back. */
export function wearFx(maps: ReadonlyMap<FxAtlas, THREE.Texture> | null): void {
  const at = (atlas: FxAtlas) => maps?.get(atlas) ?? standIn(atlas);
  spriteMaterial('fire').uniforms.map!.value = at('fire');
  spriteMaterial('fire-soft').uniforms.map!.value = at('fire');
  spriteMaterial('soft').uniforms.map!.value = at('smoke');
  spriteMaterial('dither').uniforms.map!.value = at('smoke');
  flashMaterial().map = at('fire');
  const d = decalMaterial();
  d.map = at('decals');
  d.normalMap = at('decals-normal');
}

// ----------------------------------------------------------------- warm-up

const templates = new Map<string, THREE.Group>();
/**
 * One mesh of every effect material a look uses (with `soft`, the soft
 * particles' sprites, else the dithered ones), instanced where the pools are,
 * for the renderer to compile and draw once at the menu (render/index.ts
 * `_warmPrograms`), so a match's first shot, hole or explosion links nothing.
 */
export function fxTemplate(look: 'lowpoly' | 'realistic', soft = false): THREE.Group {
  const key = look === 'realistic' ? `${look}-${soft ? 'soft' : 'dither'}` : look;
  let group = templates.get(key);
  if (group) return group;
  group = new THREE.Group();
  group.name = `fx-template-${key}`;
  const add = (mesh: THREE.Mesh) => { mesh.frustumCulled = false; group!.add(mesh); };
  const trace = tracerGeometry(1);
  trace.instanceCount = 1;
  add(new THREE.Mesh(trace, tracerMaterial()));
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), lowFlashMaterial()));
  add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), boltMaterial(TONE.HOSTILE)));
  // Not effects, but first drawn in a fight: the unlit meshes (a thrown grenade's arc, lasers; enemy
  // bolts used to link this program at the first shot), an enemy's smoke grenade and a thrown grenade's flat-lit body.
  add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), unlitMat(TONE_HEX[TONE.PRIMARY])));
  add(new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 2), hazardSmokeMaterial()));
  const grenade = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 2), surfMat('dark'));
  grenade.castShadow = true;
  add(grenade);
  const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, colour = true) => {
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    if (colour) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.receiveShadow = true;
    add(mesh);
    return mesh;
  };
  instanced(new THREE.PlaneGeometry(0.01, 0.01), flatDecalMaterial());
  if (look === 'realistic') {
    for (const kind of soft ? ['fire-soft', 'soft'] as const : ['fire', 'dither'] as const) {
      const geometry = spriteGeometry(1);
      geometry.instanceCount = 1;
      add(new THREE.Mesh(geometry, spriteMaterial(kind)));
    }
    const plane = new THREE.PlaneGeometry(0.01, 0.01);
    plane.setAttribute('decalCell', new THREE.InstancedBufferAttribute(new Float32Array([0, 0, 1, 1]), 4));
    instanced(plane, decalMaterial());
    instanced(new THREE.PlaneGeometry(0.01, 0.01), splatMaterial());
    instanced(new THREE.CylinderGeometry(0.01, 0.01, 0.01), shellMaterial('brass'), false);
    const hull = new THREE.CylinderGeometry(0.01, 0.01, 0.01);
    hull.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(hull.getAttribute('position').count * 3).fill(1), 3));
    instanced(hull, shellMaterial('shotshell'), false);
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), flashMaterial()));
  }
  templates.set(key, group);
  return group;
}

// ------------------------------------------------------------------ streaming

/** How `FxAssets` reaches the network and the GPU; the renderer's in the game, stand-ins in tests. */
export interface FxLoaders {
  texture: LoadTexture;
  upload(texture: THREE.Texture): void;
}

interface FxMaps {
  size: TextureSize;
  maps: Map<FxAtlas, THREE.Texture> | null;
  failed: boolean;
  uploaded: number;
  bytes: number;
}

/**
 * Streams the effect atlases for the realistic tiers, like the weapons
 * (render/weapons.ts): `want(size)` starts the four atlases downloading (the
 * menu never waits), `pump()` uploads one a call in the renderer's upload
 * slots, and once all four are on the GPU they go on the effect materials,
 * `ready` turns true and every subscriber hears of it (effects.ts switches to
 * the realistic recipes). Their programs are compiled and drawn at the menu
 * with the look's other programs (`fxTemplate`), stand-ins and all, so
 * nothing compiles then. A size change keeps the old atlases on until the new
 * ones are in; `want(null)` (Low) frees them all and the effects go back to
 * the flat recipes.
 */
export class FxAssets {
  readonly #loaders: FxLoaders;
  #size: TextureSize | null = null;
  #sets: FxMaps[] = [];
  #worn: FxMaps | null = null;
  #ready = false;
  #generation = 0;
  readonly #listeners = new Set<() => void>();
  readonly #warned = new Set<string>();

  constructor(loaders: FxLoaders) {
    this.#loaders = loaders;
  }

  get ready(): boolean { return this.#ready; }
  get size(): TextureSize | null { return this.#size; }
  /** A realistic tier wants the atlases (or another size of them) and they are not all in, nor failed. */
  get pending(): boolean {
    const set = this.#sets.find(s => s.size === this.#size);
    return this.#size !== null && this.#worn?.size !== this.#size && !(set?.failed ?? false);
  }

  /** Something listens for the atlases (the game's effects); with none (a renderer alone), nothing is fetched. */
  get wanted(): boolean { return this.#listeners.size > 0; }

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
    for (const set of this.#sets) if (set !== this.#worn && set.size !== size) this.#free(set);
    this.#sets = this.#sets.filter(set => set === this.#worn || set.size === size);
    if (!this.#sets.some(set => set.size === size)) this.#load(size);
  }

  #load(size: TextureSize): void {
    const set: FxMaps = { size, maps: null, failed: false, uploaded: 0, bytes: 0 };
    this.#sets.push(set);
    const generation = this.#generation;
    Promise.all(FX_ATLASES.map(atlas => this.#loaders.texture(fxUrl(size, atlas), 1).then(texture => {
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = FX_MANIFEST[atlas].srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = 1;
      texture.needsUpdate = true;
      return [atlas, texture] as const;
    }))).then(loaded => {
      if (generation !== this.#generation || !this.#sets.includes(set)) {
        for (const [, texture] of loaded) texture.dispose();
        return;
      }
      set.maps = new Map(loaded);
    }, (error: unknown) => {
      if (generation !== this.#generation || !this.#sets.includes(set)) return;
      set.failed = true;
      if (!this.#warned.has(`${size}`)) console.warn(`effects ${size}: ${error instanceof Error ? error.message : String(error)}`);
      this.#warned.add(`${size}`);
    });
  }

  /** Upload the next downloaded atlas and free its CPU copy; once all are up, put them on. Returns its GPU bytes, or 0. */
  pump(): number {
    const set = this.#sets.find(s => s.size === this.#size && s !== this.#worn && s.maps !== null);
    if (!set?.maps) return 0;
    const atlas = FX_ATLASES[set.uploaded];
    if (atlas === undefined) return 0;
    const texture = set.maps.get(atlas)!;
    const bytes = textureBytes(texture);
    this.#loaders.upload(texture);
    if (texture instanceof THREE.CompressedTexture) texture.mipmaps = [];
    set.bytes += bytes;
    set.uploaded++;
    if (set.uploaded === FX_ATLASES.length) this.#wear(set);
    return bytes;
  }

  #wear(set: FxMaps): void {
    wearFx(set.maps);
    if (this.#worn) this.#free(this.#worn);
    this.#sets = this.#sets.filter(s => s === set);
    this.#worn = set;
    if (!this.#ready) {
      this.#ready = true;
      this.#notify();
    }
  }

  #free(set: FxMaps): void {
    for (const texture of set.maps?.values() ?? []) texture.dispose();
    set.maps = null;
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Free every atlas and put the stand-ins back; the effects hear of it and go back to the flat recipes. */
  clear(): void {
    this.#generation++;
    this.#size = null;
    for (const set of this.#sets) this.#free(set);
    this.#sets = [];
    this.#worn = null;
    wearFx(null);
    if (this.#ready) {
      this.#ready = false;
      this.#notify();
    }
  }

  /** Texture objects alive here and their GPU bytes, for the tier report and the leak test. */
  get stats(): { textures: number; residentBytes: number } {
    let textures = 0, residentBytes = 0;
    for (const set of this.#sets) {
      textures += set.maps?.size ?? 0;
      residentBytes += set.bytes;
    }
    return { textures, residentBytes };
  }
}

import * as THREE from 'three';
import { SURF, TONE, TONE_HEX, TOON_STEPS } from './palette';
import type { SurfKey } from './palette';
import type { MaterialTag, RealMaterial, SetInfo, TextureSet } from './surfaces';
import type { SetMaps } from './textures';

const surfaces = new Map<SurfKey, THREE.MeshLambertMaterial>();
const characters = new Map<number, THREE.MeshToonMaterial>();
const unlit = new Map<number, THREE.MeshBasicMaterial>();
const originals = new WeakMap<THREE.Object3D, THREE.Material | THREE.Material[]>();
const labels = new WeakMap<THREE.Texture, THREE.MeshBasicMaterial>();
const posts = new WeakMap<PostUniforms, THREE.ShaderMaterial>();
const gradient = new THREE.DataTexture(new Uint8Array(TOON_STEPS), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.generateMipmaps = false;
gradient.needsUpdate = true;

export type PostUniforms = Record<string, THREE.IUniform>;

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

export function surfMat(key: SurfKey): THREE.MeshLambertMaterial {
  if (!Object.hasOwn(SURF, key)) key = 'block';
  let material = surfaces.get(key);
  if (material === undefined) surfaces.set(key, material = new THREE.MeshLambertMaterial({ color: SURF[key], flatShading: true }));
  return material;
}

export function charMat(color: number): THREE.MeshToonMaterial {
  let material = characters.get(color);
  if (material === undefined) characters.set(color, material = new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  return material;
}

export function toneMat(tone: number): THREE.MeshToonMaterial {
  return charMat(TONE_HEX[tone] ?? TONE_HEX[TONE.PRIMARY]);
}

export function unlitMat(color: number): THREE.MeshBasicMaterial {
  let material = unlit.get(color);
  if (material === undefined) unlit.set(color, material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  return material;
}

export function setFlash(root: THREE.Object3D, on: boolean, tone: number = TONE.HOSTILE): void {
  const material = on ? unlitMat(TONE_HEX[tone] ?? TONE_HEX[TONE.HOSTILE]) : null;
  root.traverse(mesh => {
    if (!isMesh(mesh)) return;
    if (material) {
      if (!originals.has(mesh)) originals.set(mesh, mesh.material);
      mesh.material = material;
    } else {
      const original = originals.get(mesh);
      if (original !== undefined) {
        mesh.material = original;
        originals.delete(mesh);
      }
    }
  });
}

/** The sky dome's uniforms; `setMood` writes them, nothing is rebuilt. */
export type SkyUniforms = {
  horizon: THREE.IUniform<THREE.Color>;
  zenith: THREE.IUniform<THREE.Color>;
  sunDir: THREE.IUniform<THREE.Vector3>;
  sunColor: THREE.IUniform<THREE.Color>;
  /** 0 hides the disc and glow, 1 shows them. */
  sunDisc: THREE.IUniform<number>;
  /** Realistic tiers: the map's Blender sky, an sRGB equirect, and the radiance its white stands for. */
  skyMap: THREE.IUniform<THREE.Texture | null>;
  skyScale: THREE.IUniform<number>;
  /** Realistic tiers: the sky's brightness and saturation above the horizon haze (1 is physical). */
  skyGain: THREE.IUniform<number>;
  skySaturation: THREE.IUniform<number>;
};

/**
 * Unlit, inside-out, never fogged: the sky dome. The horizon-to-zenith gradient
 * and the sun disc are both per pixel, so a mood change is a uniform write.
 * With `SKY_MAP` defined (realistic tiers, once the map's sky has streamed in)
 * the gradient becomes the Blender sky image in three's equirect layout, and
 * the sun is a bright disc only: the image already holds its glow. The image
 * fades into `horizon` (the fog colour) over the lowest 10 degrees, so the sky
 * meets the fogged ground without a seam and wears the mood's haze there.
 */
export function skyMat(uniforms: SkyUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 horizon, zenith, sunDir, sunColor;
      uniform float sunDisc;
      #ifdef SKY_MAP
      uniform sampler2D skyMap;
      uniform float skyScale, skyGain, skySaturation;
      #endif
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        // A disc of about 2.5 degrees with a soft rim, a tight glow and a wide haze.
        // Its HDR core is rolled off to white by the composite's tone mapping.
        float d = max(dot(dir, sunDir), 0.0);
        float disc = smoothstep(0.99905, 0.99935, d);
        #ifdef SKY_MAP
        // A sun of about 1.2 degrees, bright enough to bloom; the image holds the halo.
        vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec3 sky = texture2D(skyMap, uv).rgb * skyScale;
        // Physical sky radiance tone-maps to a dull slate; a photo of a clear day shows a
        // deeper, brighter blue overhead. That lift grows over the lowest 25 degrees.
        float up = smoothstep(0.0, 0.42, dir.y);
        sky = mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, mix(1.0, skySaturation, up)) * mix(1.0, skyGain, up);
        vec3 col = mix(horizon, max(sky, 0.0), smoothstep(0.0, 0.17, dir.y));
        col += sunColor * sunDisc * smoothstep(0.99992, 0.99996, d) * 40.0;
        #else
        vec3 col = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.6));
        col += sunColor * sunDisc * (disc * 3.0 + pow(d, 400.0) * 0.8 + pow(d, 24.0) * 0.18 + pow(d, 4.0) * 0.05);
        #endif
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const reals = new Map<string, THREE.MeshStandardMaterial>();
const standIns = new Map<TextureSet, SetMaps>();
let flatNormal: THREE.DataTexture | undefined;

/** A 1 × 1 map of one colour (0..1 per channel, already in the texture's own encoding). */
function pixel(r: number, g: number, b: number, colorSpace: THREE.ColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b].map(v => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255)).concat(255)), 1, 1);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A set's stand-in maps: one texel each of its mean albedo, a flat normal and
 * its mean occlusion, roughness and metalness. A material wears these until
 * its streamed maps arrive, so the untextured map already shows the right
 * colour and sheen, and swapping in the real maps compiles nothing (a map
 * present or absent is part of the shader program; which texture is not).
 */
export function standInMaps(set: TextureSet, info: SetInfo): SetMaps {
  let maps = standIns.get(set);
  if (maps === undefined) {
    const albedo = new THREE.Color().setRGB(...info.albedo, THREE.LinearSRGBColorSpace).convertLinearToSRGB();
    flatNormal ??= pixel(0.5, 0.5, 1, THREE.NoColorSpace);
    standIns.set(set, maps = {
      albedo: pixel(albedo.r, albedo.g, albedo.b, THREE.SRGBColorSpace),
      normal: flatNormal,
      orm: pixel(info.ao, info.roughness, info.metal, THREE.NoColorSpace),
    });
  }
  return maps;
}

/** Put a set's maps on a realistic material: albedo, normal, and ORM as occlusion, roughness and metalness. */
export function wearMaps(material: THREE.MeshStandardMaterial, maps: SetMaps): void {
  material.map = maps.albedo;
  material.normalMap = maps.normal;
  material.aoMap = material.roughnessMap = material.metalnessMap = maps.orm;
}

/** Every realistic level material made so far (they are cached like the flat ones). */
export function realMaterials(): IterableIterator<THREE.MeshStandardMaterial> {
  return reals.values();
}

/**
 * Macro variation's strength per set: none on glass and water, whose look is
 * their reflection; more on the big open grounds (lawn, sand, concrete yards),
 * where a repeat would show most.
 */
const MACRO: Partial<Record<TextureSet, number>> = { glass: 0, water: 0, grass: 0.16, sand: 0.14, concrete: 0.12 };
const MACRO_DEFAULT = 0.09;

/**
 * The level's shader patch, the same function on every level material so they
 * share one program.
 *
 * Anti-tiling (R2): two octaves of world-space value noise, a few metres
 * across, scale each texel's albedo by ±`macro` and its roughness by ±1.5 ×
 * `macro`. A plaza, a road or a lawn then drifts in tone over tens of metres,
 * so the eye stops finding the texture's repeat.
 *
 * Sky light: the level takes its diffuse sky fill from the light probe alone,
 * as the flat look's Lambert does, and only the specular part of the sky's
 * PMREM (`scene.environment`). Taking the PMREM's diffuse as well would light
 * shade twice, lifting and greying it; the double fill is kept for the GLB
 * characters (render/index.ts, `REAL_ENV_INTENSITY`).
 */
function macroVariation(this: THREE.MeshStandardMaterial, shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.macro = this.userData.macro as THREE.IUniform<number>;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vMacroPos;
uniform float macro;
float macroHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 ) * 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float macroNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( macroHash( i ), macroHash( i + vec3( 1, 0, 0 ) ), f.x ),
		mix( macroHash( i + vec3( 0, 1, 0 ) ), macroHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( macroHash( i + vec3( 0, 0, 1 ) ), macroHash( i + vec3( 1, 0, 1 ) ), f.x ),
		mix( macroHash( i + vec3( 0, 1, 1 ) ), macroHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`)
    .replace('#include <map_fragment>', `#include <map_fragment>
float macroTone = macroNoise( vMacroPos * 0.16 ) * 0.65 + macroNoise( vMacroPos * 0.57 + 7.3 ) * 0.35;
float macroSheen = macroNoise( vMacroPos * 0.41 + 3.1 );
diffuseColor.rgb *= 1.0 + macro * ( macroTone * 2.0 - 1.0 );`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp( roughnessFactor * ( 1.0 + 1.5 * macro * ( macroSheen * 2.0 - 1.0 ) ), 0.03, 1.0 );`)
    .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\niblIrradiance = vec3( 0.0 );');
}
const macroKey = (): string => 'level-pbr';

/**
 * Tags laid over another piece's faces. House's door and window trim shares
 * its reveal faces with the wall it frames (level/house.ts `wall`); once the
 * trim is light painted wood on textured plaster, that tie flickers. Pulled a
 * hair towards the eye, the trim wins it. Low keeps its geometry and Lambert
 * as they were.
 */
const OVERLAY_TAGS: ReadonlySet<MaterialTag> = new Set(['painted-wood']);

/**
 * A realistic level material (R2): PBR with a texture set, tinted so the set's
 * mean albedo lands on the tag's colour. It starts on the set's stand-in maps;
 * the renderer swaps the streamed ones in. Cached per (tag, colour) key.
 */
export function realMat(real: RealMaterial, info: SetInfo): THREE.MeshStandardMaterial {
  let material = reals.get(real.key);
  if (material === undefined) {
    const color = new THREE.Color(real.color);
    color.setRGB(color.r / info.albedo[0], color.g / info.albedo[1], color.b / info.albedo[2], THREE.LinearSRGBColorSpace);
    material = new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 1, flatShading: true });
    if (OVERLAY_TAGS.has(real.tag)) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    material.userData.set = real.set;
    material.userData.macro = { value: MACRO[real.set] ?? MACRO_DEFAULT };
    material.onBeforeCompile = macroVariation;
    material.customProgramCacheKey = macroKey;
    wearMaps(material, standInMaps(real.set, info));
    reals.set(real.key, material);
  }
  return material;
}

let levelDepth: THREE.MeshDepthMaterial | undefined;
/**
 * The shadow pass of the textured level. three's shared depth material takes
 * each caster's `map` and keeps the last one: once the streamed maps are
 * freed, the next caster without a map binds a freed albedo, and three
 * uploads it again, for good. This one is as three's (RGBA-packed depth) but
 * never samples a map (the level has no cut-outs), so no streamed texture
 * reaches the shadow pass.
 */
export function levelDepthMat(): THREE.MeshDepthMaterial {
  if (levelDepth === undefined) {
    levelDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    levelDepth.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '');
    };
    levelDepth.customProgramCacheKey = () => 'level-depth';
  }
  return levelDepth;
}

/**
 * A realistic level mesh's groups as the shadow pass draws them
 * (render/index.ts, `_casters`). Every level material casts alike (opaque,
 * front side, through `levelDepthMat`), so each run of visible groups is one
 * draw on material 0, and a hidden (flat-only) group ends a run: a mesh of
 * ten tags costs one draw per shadow cascade, not ten.
 */
export function casterGroups(groups: readonly THREE.GeometryGroup[], looks: readonly THREE.Material[]): THREE.GeometryGroup[] {
  const runs: THREE.GeometryGroup[] = [];
  for (const { start, count, materialIndex = 0 } of groups) {
    if (!looks[materialIndex]?.visible) continue;
    const last = runs.at(-1);
    if (last && last.start + last.count === start) last.count += count;
    else runs.push({ start, count, materialIndex: 0 });
  }
  return runs;
}

let hidden: THREE.MeshBasicMaterial | undefined;
/** Not drawn and casts no shadow: a flat-only group of a level mesh on the realistic tiers. */
export function hiddenMat(): THREE.MeshBasicMaterial {
  return hidden ??= new THREE.MeshBasicMaterial({ visible: false });
}

let clouds: THREE.MeshLambertMaterial | undefined;
/** Flat-shaded cloud puffs. Unfogged like the dome they sit against; the emissive keeps undersides light. */
export function cloudMat(): THREE.MeshLambertMaterial {
  return clouds ??= new THREE.MeshLambertMaterial({
    color: SURF.cloud, emissive: SURF.cloud, emissiveIntensity: 0.4, flatShading: true, fog: false,
  });
}

// Private factories keep every material constructor in this module.
export function makePostMaterial(uniforms: PostUniforms, vertexShader: string, fragmentShader: string): THREE.ShaderMaterial {
  let material = posts.get(uniforms);
  if (material === undefined) posts.set(uniforms, material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, depthWrite: false, depthTest: false,
  }));
  return material;
}

export function makeLabelMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  let material = labels.get(texture);
  if (material === undefined) {
    material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    material.addEventListener('dispose', () => labels.delete(texture));
    labels.set(texture, material);
  }
  return material;
}

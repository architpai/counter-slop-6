import * as THREE from 'three';
import type { Atmosphere } from '../types';

/**
 * R8: the realistic tiers' aerial perspective, a haze that thickens with
 * distance and towards the ground, on top of the map's linear fog.
 *
 * three's fog chunks are patched once, when this module loads, so every
 * fogged material (the level, props, characters, effects, and shader
 * materials that include the fog chunks) takes it with no material of its
 * own. Along the view ray the haze's density falls off exponentially with
 * height, `haze × exp(−falloff × (y − base))`, and its optical depth is the
 * closed form of that integral from `start` metres out (nothing nearer, so a
 * grunt at 60 m stays as clear as the linear fog left him). Towards the sun
 * the fog colour brightens by `glow` in the sun's hue (forward scattering), and
 * the sky dome's horizon band takes the same glow, so far geometry still
 * meets the sky without a seam.
 *
 * The parameters are three shared uniforms, plain typed arrays: three shares a
 * uniform's value by reference when it copies a material's uniforms unless it
 * is a vector, colour or array, so one write reaches every material and
 * program. At zero haze (Low, and the renderer's default) the patched chunk
 * takes the unpatched path and every fogged pixel is exactly as before.
 */

/** Haze density per metre at `base`, its falloff per metre of height, the base height and the start distance. */
export const FOG_AERIAL = new Float32Array(4);
/** Towards the sun (unit, world space), and the glow lobe's exponent. */
export const FOG_SUN = new Float32Array(4);
/** Linear light added to the fog colour looking straight at the sun. */
export const FOG_GLOW = new Float32Array(3);
/** The glow lobe: `pow(cos, GLOW_POWER)`, about 30 degrees wide at half strength. */
export const GLOW_POWER = 8;

/** The uniforms every fogged material gets (below); also handed to the sky dome for its horizon band. */
export const FOG_UNIFORMS = {
  fogAerial: { value: FOG_AERIAL },
  fogSun: { value: FOG_SUN },
  fogGlow: { value: FOG_GLOW },
};

const PARS_VERTEX = THREE.ShaderChunk.fog_pars_vertex;
const VERTEX = THREE.ShaderChunk.fog_vertex;
const PARS_FRAGMENT = THREE.ShaderChunk.fog_pars_fragment;
const FRAGMENT = THREE.ShaderChunk.fog_fragment;
if (!PARS_VERTEX.includes('varying float vFogDepth;') || !VERTEX.includes('vFogDepth = - mvPosition.z;')
  || !PARS_FRAGMENT.includes('uniform float fogFar;') || !FRAGMENT.includes('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );')) {
  throw new Error('three changed its fog chunks: update render/atmosphere.ts');
}

/**
 * The fog's GLSL, shared by three's chunk and the shader materials that
 * blend their own fog (render/fx.ts sprites, the grime decals):
 * `fogAmount()` is the share of the fog colour, `fogTint()` that colour.
 * `vFogRay` is the eye-to-fragment vector in world space, from the vertex's
 * view position (a camera has no scale, so the view matrix's transpose turns
 * it back).
 */
const AERIAL_GLSL = /* glsl */`
	varying vec3 vFogRay;
	uniform vec4 fogAerial;
	uniform vec4 fogSun;
	uniform vec3 fogGlow;
	float fogAmount() {
		#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		if ( fogAerial.x > 0.0 ) {
			float fogDist = length( vFogRay );
			float fogSpan = max( fogDist - fogAerial.w, 0.0 );
			if ( fogSpan > 0.0 ) {
				// The hazy part of the ray starts fogAerial.w metres out, this high over the base, and climbs by fogRise per metre.
				float fogRise = vFogRay.y / fogDist;
				float fogFrom = max( cameraPosition.y + fogRise * fogAerial.w - fogAerial.z, 0.0 );
				float fogK = fogAerial.y * fogRise * fogSpan;
				float fogAlong = abs( fogK ) > 1e-3 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 - 0.5 * fogK;
				float fogDepth = fogAerial.x * fogSpan * exp( - fogAerial.y * fogFrom ) * fogAlong;
				fogFactor += ( 1.0 - fogFactor ) * ( 1.0 - exp( - fogDepth ) );
			}
		}
		return fogFactor;
	}
	vec3 fogTint() {
		if ( fogAerial.x <= 0.0 ) return fogColor;
		vec3 fogDir = vFogRay / max( length( vFogRay ), 1e-4 );
		return fogColor + fogGlow * pow( max( dot( fogDir, fogSun.xyz ), 0.0 ), fogSun.w );
	}
`;

THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogRay;');
THREE.ShaderChunk.fog_vertex = VERTEX.replace('vFogDepth = - mvPosition.z;',
  'vFogDepth = - mvPosition.z;\n\tvFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;');
THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT.replace(/#endif\s*$/, `${AERIAL_GLSL}\n#endif\n`);
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint(), fogAmount() );
#endif
`;
// Every built-in material with fog copies its uniforms from here when its program is made; the shader materials
// merge `UniformsLib.fog` when they are made (after this module has loaded). A material without them reads zeros:
// linear fog only.
Object.assign(THREE.UniformsLib.fog, FOG_UNIFORMS);
for (const shader of Object.values(THREE.ShaderLib)) if ('fogColor' in shader.uniforms) Object.assign(shader.uniforms, FOG_UNIFORMS);

/** The linear fog's share at `distance` (three's `smoothstep(near, far, depth)`). */
export function linearFog(distance: number, near: number, far: number): number {
  const t = Math.min(1, Math.max(0, (distance - near) / Math.max(1e-6, far - near)));
  return t * t * (3 - 2 * t);
}

/**
 * The haze's share alone along a ray of `distance` metres from an eye at
 * height `eyeY` to a point at `pointY` (the GLSL's `fogAmount` above, with
 * no linear fog); `aerial` as in `FOG_AERIAL`.
 */
export function aerialFog(distance: number, eyeY: number, pointY: number, aerial: ArrayLike<number>): number {
  const [haze = 0, falloff = 0, base = 0, start = 0] = [aerial[0], aerial[1], aerial[2], aerial[3]];
  const span = Math.max(distance - start, 0);
  if (!(haze > 0) || span <= 0) return 0;
  const rise = (pointY - eyeY) / distance;
  const from = Math.max(eyeY + rise * start - base, 0);
  const k = falloff * rise * span;
  const along = Math.abs(k) > 1e-3 ? (1 - Math.exp(-k)) / k : 1 - 0.5 * k;
  return 1 - Math.exp(-haze * span * Math.exp(-falloff * from) * along);
}

/** The whole fog's share, linear and haze together, as the fragment shader blends it (depth ≈ distance along the view). */
export function fogAt(distance: number, eyeY: number, pointY: number, near: number, far: number,
  aerial: ArrayLike<number> = FOG_AERIAL): number {
  const linear = linearFog(distance, near, far);
  return linear + (1 - linear) * aerialFog(distance, eyeY, pointY, aerial);
}

/**
 * Put a map's haze in force (null: none, the flat look). `view` is the view
 * distance's scale (quality.ts `VIEW_SCALE`): the haze starts that much
 * further out, as the linear fog's range stretches, at the same density (the
 * longer view keeps its depth cue; thinned as well, Ultra had the least haze).
 * The glow takes the sun's hue at the fog's own brightness.
 */
export function setAtmosphere(atmosphere: Atmosphere | null, sunDir: THREE.Vector3, sunColor: THREE.Color,
  fogColor: THREE.Color, view = 1): void {
  if (!atmosphere) {
    FOG_AERIAL.fill(0);
    FOG_SUN.fill(0);
    FOG_GLOW.fill(0);
    return;
  }
  FOG_AERIAL.set([atmosphere.haze, atmosphere.falloff, atmosphere.base ?? 0, atmosphere.start * view]);
  FOG_SUN.set([sunDir.x, sunDir.y, sunDir.z, GLOW_POWER]);
  const peak = Math.max(sunColor.r, sunColor.g, sunColor.b, 1e-6);
  const strength = atmosphere.glow * (0.2126 * fogColor.r + 0.7152 * fogColor.g + 0.0722 * fogColor.b) / peak;
  FOG_GLOW.set([sunColor.r * strength, sunColor.g * strength, sunColor.b * strength]);
}

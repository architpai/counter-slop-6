import * as THREE from 'three';

/**
 * Cascaded sun shadows (R1) for three's own materials.
 *
 * A cascade is a directional light that only casts a shadow map: `Renderer`
 * gives the sun's colour to the first light and adds dark ones for the wider
 * cascades. When a scene has more than one shadow-casting directional light,
 * the patched lighting chunk below reads them as cascades of one sun: each
 * fragment takes its shadow from the first (sharpest) map whose box holds it,
 * blends into the next one over the outer eighth of the box, and fades to lit
 * over the outer 1/24 of the last (about 2 m: a wider fade reads as smudged,
 * half-faded shadows from a rooftop). The sun's light is then applied once,
 * shadowed by that. With a single shadow light (Low, Medium) three's own
 * directional loop runs, unchanged.
 *
 * No per-material setup: the lambert, toon and standard shaders all build
 * from this chunk, including the GLB and effects materials made later.
 */
const THREE_CHUNK = THREE.ShaderChunk.lights_fragment_begin;

/**
 * The point lights (render/index.ts `FX_LIGHTS`, the shots' and blasts'
 * pooled light) sit at zero most of the time, but three's loop still works
 * out each one's falloff and runs the whole BRDF for it in every lit
 * fragment. Here a light whose colour is zero (intensity 0: the same uniform
 * for the whole draw) is skipped, and a lit one only shades the fragments in
 * its reach (`visible`: its colour after the falloff is not zero). Either way
 * the skipped light would only have added zero, so every pixel is as before.
 */
const POINT = THREE_CHUNK.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
const SPOT = THREE_CHUNK.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
// The packaged chunks have no blank lines or comments, so the patterns go by the statements alone.
const POINT_INFO = /getPointLightInfo\( pointLight, geometryPosition, directLight \);/;
const POINT_DIRECT = /(RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);\s*)(\}\s*#pragma unroll_loop_end)/;
const POINTS = POINT < 0 || SPOT < POINT ? '' : THREE_CHUNK.slice(POINT, SPOT);
if (!POINT_INFO.test(POINTS) || !POINT_DIRECT.test(POINTS)) throw new Error('three changed lights_fragment_begin: update render/shadows.ts');
const CHUNK = THREE_CHUNK.slice(0, POINT) + POINTS
  .replace(POINT_INFO, 'if ( pointLight.color != vec3( 0.0 ) ) {\n\t\tgetPointLightInfo( pointLight, geometryPosition, directLight );')
  .replace(POINT_DIRECT, 'if ( directLight.visible ) $1}\n\t$2') + THREE_CHUNK.slice(SPOT);

const DIRECTIONAL = CHUNK.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
const AFTER = CHUNK.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
if (DIRECTIONAL < 0 || AFTER < DIRECTIONAL) throw new Error('three changed lights_fragment_begin: update render/shadows.ts');

const CASCADED = /* glsl */`
#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( RE_Direct )

	DirectionalLight directionalLight;
	DirectionalLightShadow directionalLightShadow;
	vec3 cascadeCoord;
	float cascadeEdge, cascadeWeight, cascadeLit = 0.0, cascadeLeft = 1.0;

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {

		cascadeCoord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
		cascadeEdge = max( abs( cascadeCoord.x * 2.0 - 1.0 ), abs( cascadeCoord.y * 2.0 - 1.0 ) );
		if ( cascadeLeft > 0.0 && cascadeEdge < 1.0 && cascadeCoord.z <= 1.0 ) {
			directionalLightShadow = directionalLightShadows[ i ];
			cascadeWeight = cascadeLeft * clamp( ( 1.0 - cascadeEdge ) * ( UNROLLED_LOOP_INDEX == NUM_DIR_LIGHT_SHADOWS - 1 ? 24.0 : 8.0 ), 0.0, 1.0 );
			cascadeLit += cascadeWeight * getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
			cascadeLeft -= cascadeWeight;
		}

	}
	#pragma unroll_loop_end

	cascadeLit += cascadeLeft;

	// The sun (light 0: three puts shadow casters first, and the sun is added before the cascades) and any light
	// past the cascades. Lights 1 to NUM_DIR_LIGHT_SHADOWS - 1 are the cascades: they must stay dark (intensity 0,
	// render/index.ts _setBoxes), as their light is not applied at all.
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

		#if ( UNROLLED_LOOP_INDEX == 0 ) || ( UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS )
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directLight.color *= ( directLight.visible && receiveShadow ) ? cascadeLit : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		#endif

	}
	#pragma unroll_loop_end

#else
`;

THREE.ShaderChunk.lights_fragment_begin = CHUNK.slice(0, DIRECTIONAL) + CASCADED + CHUNK.slice(DIRECTIONAL, AFTER) + '#endif\n\n' + CHUNK.slice(AFTER);

/** One cascade: the half-width of its box in metres and how far ahead of the eye its centre sits. */
export interface Cascade {
  extent: number;
  ahead: number;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _centre = new THREE.Vector3();

/**
 * Where a cascade's box centre goes: `ahead` metres from the eye along the
 * view direction flattened to the ground (nothing when looking straight down).
 */
export function cascadeCentre(eye: THREE.Vector3, forward: THREE.Vector3, ahead: number, out: THREE.Vector3): THREE.Vector3 {
  const length = Math.hypot(forward.x, forward.z);
  out.copy(eye);
  if (length > 1e-3) out.set(eye.x + forward.x / length * ahead, eye.y, eye.z + forward.z / length * ahead);
  return out;
}

/**
 * Aim a shadow light's box at `centre`, snapped to the shadow map's texel grid
 * in the light's own frame (the frame three's shadow camera uses: looking
 * down -`sunDir` with y up). A box that only ever moves by whole texels
 * rasterises every caster the same way, so shadow edges do not swim or
 * shimmer as the viewer walks and turns. The box size never changes with the
 * view (not even with the sprint FOV kick), so the texel size is fixed too.
 */
export function aimShadowBox(light: THREE.DirectionalLight, centre: THREE.Vector3, sunDir: THREE.Vector3, reach: number): void {
  const camera = light.shadow.camera;
  const texel = (camera.right - camera.left) / light.shadow.mapSize.x;
  _x.crossVectors(_up, sunDir).normalize();
  _y.crossVectors(sunDir, _x);
  const x = Math.round(centre.dot(_x) / texel) * texel, y = Math.round(centre.dot(_y) / texel) * texel;
  _centre.copy(sunDir).multiplyScalar(centre.dot(sunDir)).addScaledVector(_x, x).addScaledVector(_y, y);
  light.target.position.copy(_centre);
  light.position.copy(_centre).addScaledVector(sunDir, reach * 2);
  light.target.updateMatrixWorld();
}

/** Size a cascade's box and depth range; shadows cover `reach` metres of level on either side of it. */
export function sizeShadowBox(light: THREE.DirectionalLight, extent: number, reach: number): void {
  const camera = light.shadow.camera;
  camera.left = camera.bottom = -extent;
  camera.right = camera.top = extent;
  camera.near = 0.1;
  camera.far = reach * 4;
  camera.updateProjectionMatrix();
  // The normal offset follows the texel size: Low's 3.4 cm texels used 0.03 m.
  light.shadow.normalBias = Math.max(0.006, 0.9 * 2 * extent / light.shadow.mapSize.x);
}

import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GRADE, SURF, TONE, TONE_HEX } from './palette';
import { makePostMaterial } from './materials';
import type { Look } from './quality';
import type { Grade } from '../types';

/** The four feedback intensities of §3.6, rebuilt by `boot` every frame. */
export interface PostFX {
  hurt: number;
  flash: number;
  slow: number;
  lowHp: number;
}

/** What the pass chain runs; `Renderer.applyQuality` builds it from the quality values. */
export interface PostConfig {
  look: Look;
  /** MSAA samples on the scene target: 0, 2 or 4. */
  samples: number;
  fxaa: boolean;
  smaa: boolean;
  /** GTAO resolution as a share of the scene target: 0 (off), 0.5 or 1. */
  ao: number;
  /**
   * Soft particles (R5): keep the scene's depth texture without AO (AO needs
   * it anyway), for the particles' layer to read (`drawSoft`), and composite
   * that layer over the scene in the bloom and tone passes.
   */
  depth: boolean;
  bloom: boolean;
}

/**
 * The slice of the depth range the weapon rig draws into while the depth
 * texture is read (AO). The world keeps [0, 1]; nothing in it comes closer
 * than 8 cm, which is where world depth reaches this value, so the rig always
 * wins the depth test and every pass can tell rig pixels apart.
 */
export const RIG_DEPTH = 0.01;
/** GTAO: occluders within this many metres darken a point. */
const AO_RADIUS = 1.1;
/** GTAO darkens by at most this share of the ambient light, so enemies in a corner still read. */
const AO_STRENGTH = 0.8;
/** Bloom: exposed brightness where the glow starts, the soft knee below it, and the mix. */
const BLOOM_THRESHOLD = 1.1;
const BLOOM_KNEE = 0.5;
const BLOOM_STRENGTH = 0.05;
/** Half, quarter … 1/32 resolution. */
const BLOOM_LEVELS = 5;
/**
 * The soft particles' layer is drawn at half the scene target's size from
 * this many rows up (a high-DPI frame: still a texel per CSS pixel), at its
 * full size below. Smoke and fire are soft; the layer's clear and reads cost
 * a quarter as much.
 */
const SOFT_HALF_FROM = 1400;
/** Contrast-adaptive sharpen after SMAA: 0 none, 1 the most CAS gives. */
const SHARPEN = 0.35;

/**
 * AO darkens ambient light only. Every opaque lit material writes the share of
 * its light that is not direct (sun) light into alpha, which nothing else reads
 * in the scene target (opaque materials draw without blending), and the AO
 * lookup scales its darkening by it: a sunlit wall or grunt keeps its
 * brightness, a corner in shade darkens fully. Unlit and transparent materials
 * keep their own alpha, so AO applies to them as before.
 */
const OPAQUE_CHUNK = THREE.ShaderChunk.opaque_fragment;
if (!OPAQUE_CHUNK.includes('gl_FragColor = vec4( outgoingLight, diffuseColor.a );')) throw new Error('three changed opaque_fragment: update render/postfx.ts');
THREE.ShaderChunk.opaque_fragment = OPAQUE_CHUNK + /* glsl */`
#if defined( OPAQUE ) && ! defined( PREMULTIPLIED_ALPHA ) && ( defined( LAMBERT ) || defined( PHONG ) || defined( STANDARD ) || defined( TOON ) )
	gl_FragColor.a = 1.0 - clamp( dot( reflectedLight.directDiffuse + reflectedLight.directSpecular, vec3( 0.2126, 0.7152, 0.0722 ) )
		/ max( dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 ), 0.0, 1.0 );
#endif
`;

/**
 * The soft particles' layer over the scene colour (`Composite.drawSoft`): a
 * premultiplied colour and coverage, laid over as blending would have.
 */
const SOFT_GLSL = `
  uniform sampler2D soft;
  uniform float softOn;
  vec3 withSoft(vec3 col, vec2 uv) {
    if (softOn < 0.5) return col;
    vec4 s = texture2D(soft, uv);
    return col * (1.0 - s.a) + s.rgb;
  }
`;

/** Shared by every pass: one triangle over the whole target (or its viewport). */
const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position, 1.0);
  }
`;

/**
 * Dynamic resolution draws into the lower-left corner of each target (its
 * viewport) instead of resizing it. A pass reads its source at
 * `vUv * uvScale`, the share of the source that holds this frame, and clamps
 * its taps to `uvMax`, the centre of the last texel drawn, so what a larger
 * frame left beyond the edge never bleeds in. At full scale this is exactly
 * the sampler's own clamp to edge.
 */
const REGION_GLSL = `
  uniform vec2 uvScale, uvMax;
`;

/** Classic single-pass FXAA (Lottes' "FXAA 2" shape): one edge direction, two blends. */
const fxaa = (luma: string): string => `
  float lumaOf(vec3 c) { return ${luma}; }
  vec3 fxaa(vec2 uv) {
    vec3 nw = tap(uv + vec2(-1.0, -1.0) * texel), ne = tap(uv + vec2(1.0, -1.0) * texel);
    vec3 sw = tap(uv + vec2(-1.0, 1.0) * texel), se = tap(uv + vec2(1.0, 1.0) * texel);
    vec3 m = tap(uv);
    float lNW = lumaOf(nw), lNE = lumaOf(ne), lSW = lumaOf(sw), lSE = lumaOf(se), lM = lumaOf(m);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * texel;
    vec3 a = 0.5 * (tap(uv - dir / 6.0) + tap(uv + dir / 6.0));
    vec3 b = a * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));
    float lB = lumaOf(b);
    return lB < lMin || lB > lMax ? a : b;
  }
`;

/**
 * Per-mood grade on the tone-mapped image (see the Low shader for why it works
 * this way). With S_CURVE (the realistic look) contrast bends through 0.5
 * instead of scaling about it, so black stays black and a dark channel is not
 * cut to 0: that cut turned dark paint in blue shade flat navy.
 */
const GRADE_GLSL = `
  uniform vec3 lift, gain;
  uniform float saturation, contrast;
  vec3 grade(vec3 col) {
    col *= gain;
    vec3 p = sqrt(max(col, 0.0));
    p += lift * (1.0 - p);
    #ifdef S_CURVE
    p = clamp(p, 0.0, 1.0);
    p = mix(0.5 * pow(2.0 * p, vec3(contrast)), 1.0 - 0.5 * pow(2.0 - 2.0 * p, vec3(contrast)), step(0.5, p));
    #else
    p = max((p - 0.5) * contrast + 0.5, 0.0);
    #endif
    col = p * p;
    return clamp(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation), 0.0, 1.0);
  }
`;

/** Gameplay feedback (§3.6), exactly as specified, on linear colour. Always the last step. */
const FEEDBACK_GLSL = `
  uniform float time, aspect, hurtIn, lowHp, flash, slow;
  uniform vec3 hostile, background;
  vec3 feedback(vec3 col, vec2 uv) {
    float vig = smoothstep(0.32, 0.9, length((uv - 0.5) * vec2(aspect, 1.0)));
    float hurt = clamp(hurtIn + lowHp * (0.35 + 0.25 * sin(6.0 * time)), 0.0, 1.0);
    col = mix(col, hostile * 0.9, hurt * vig);
    col = mix(col, background, flash);
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    return mix(col, lum * vec3(0.8, 0.86, 1.0), slow * 0.55);
  }
`;

/**
 * AO lookup for the look passes. At half resolution the four nearest AO texels
 * are weighted by how close their depth is to this pixel's, so the dark of a
 * wall foot does not bleed onto the enemy standing in front of it.
 */
const AO_LOOKUP_GLSL = `
  uniform sampler2D depth, ao;
  /** The AO target's size, and its last texel drawn this frame. */
  uniform vec2 aoSize, aoLast;
  uniform float cameraNear, cameraFar;
  /** One AO texel's (weight, visibility): bilinear weight times depth agreement. */
  vec2 aoTap(vec2 cell, float z, float bilinear) {
    vec2 s = texture2D(ao, (min(cell, aoLast) + 0.5) / aoSize).rg;
    return vec2(bilinear * max(1e-3, 1.0 - abs(s.g - z) / (0.1 * z)), s.r);
  }
  // ambient: the scene's alpha, the share of this pixel's light that AO may darken.
  float occlusion(vec2 uv, float ambient) {
    float d = texture2D(depth, min(uv, uvMax)).x;
    if (d < ${RIG_DEPTH.toFixed(4)} || d >= 1.0) return 1.0;
    float z = -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    vec2 st = uv * aoSize - 0.5, base = floor(st), f = st - base;
    vec2 a = aoTap(base, z, (1.0 - f.x) * (1.0 - f.y)), b = aoTap(base + vec2(1.0, 0.0), z, f.x * (1.0 - f.y));
    vec2 c = aoTap(base + vec2(0.0, 1.0), z, (1.0 - f.x) * f.y), e = aoTap(base + vec2(1.0, 1.0), z, f.x * f.y);
    float sum = a.x * a.y + b.x * b.y + c.x * c.y + e.x * e.y, weight = a.x + b.x + c.x + e.x;
    return mix(1.0, sum / max(weight, 1e-6), ${AO_STRENGTH.toFixed(2)} * clamp(ambient, 0.0, 1.0));
  }
`;

type U<T> = THREE.IUniform<T>;
/** Feedback uniforms, one set shared by the Low composite and the realistic final pass. */
type FeedbackUniforms = {
  time: U<number>; aspect: U<number>; hurtIn: U<number>; lowHp: U<number>; flash: U<number>; slow: U<number>;
  hostile: U<THREE.Color>; background: U<THREE.Color>;
};
type GradeUniforms = { lift: U<THREE.Vector3>; gain: U<THREE.Vector3>; saturation: U<number>; contrast: U<number> };
type AoLookupUniforms = {
  depth: U<THREE.Texture | null>; ao: U<THREE.Texture | null>; aoSize: U<THREE.Vector2>; aoLast: U<THREE.Vector2>;
  cameraNear: U<number>; cameraFar: U<number>;
};
type BloomUniforms = { bloom: U<THREE.Texture | null>; bloomStrength: U<number>; bloomMax: U<THREE.Vector2> };
/** The drawn share of a pass's source (see REGION_GLSL). */
type RegionUniforms = { uvScale: U<THREE.Vector2>; uvMax: U<THREE.Vector2> };

/**
 * The shader's uniform table. A type alias, not an interface, so it keeps the
 * implicit index signature `makePostMaterial` needs.
 */
type CompositeUniforms = FeedbackUniforms & GradeUniforms & AoLookupUniforms & BloomUniforms & RegionUniforms & {
  image: U<THREE.Texture>;
  /** One target texel in UV, for FXAA. */
  texel: U<THREE.Vector2>;
};
/** The soft particles' layer (premultiplied) and whether this frame drew one. */
type SoftUniforms = { soft: U<THREE.Texture>; softOn: U<number> };
type ToneUniforms = GradeUniforms & AoLookupUniforms & BloomUniforms & RegionUniforms & SoftUniforms & {
  image: U<THREE.Texture>;
  exposure: U<number>;
};
type FinalUniforms = FeedbackUniforms & { image: U<THREE.Texture | null>; texel: U<THREE.Vector2> };
type GtaoUniforms = RegionUniforms & {
  depth: U<THREE.Texture | null>; aoSize: U<THREE.Vector2>; texel: U<THREE.Vector2>; projXY: U<THREE.Vector2>;
  cameraNear: U<number>; cameraFar: U<number>; radiusScale: U<number>; radiusMax: U<number>;
};
type BlurUniforms = RegionUniforms & { image: U<THREE.Texture | null>; texel: U<THREE.Vector2> };
type BloomPassUniforms = RegionUniforms & { image: U<THREE.Texture | null>; texel: U<THREE.Vector2> };

const regionUniforms = (): RegionUniforms => ({ uvScale: { value: new THREE.Vector2(1, 1) }, uvMax: { value: new THREE.Vector2(1, 1) } });
const ldrTarget = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(2, 2, {
  type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});
const floatTarget = (format: THREE.PixelFormat, filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(2, 2, {
    format, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    minFilter: filter, magFilter: filter, colorSpace: THREE.LinearSRGBColorSpace,
  });

/**
 * The frame after the scene pass (§3.6).
 *
 * Low (the flat look) is one pass, as before: FXAA, the soft-shoulder tone map,
 * the grade and the feedback, straight to the canvas. The realistic look is a
 * chain: GTAO from the depth buffer, the soft particles' layer laid over the
 * scene (`drawSoft`), threshold bloom at half resolution, AgX
 * tone mapping with the per-map exposure and grade, SMAA, a light
 * contrast-adaptive sharpen, then the feedback last. Each stage switches on
 * with its quality setting, and AO, bloom and SMAA work on either look.
 *
 * Every target is allocated at the render-scaled size and follows `resize`
 * (a window, pixel-ratio or render-scale change) only. Dynamic resolution
 * draws the scene, AO and bloom into a smaller viewport of the same targets
 * (`setScale`: uniform and viewport writes), and the tone pass scales the frame
 * back up, so SMAA, the sharpen and the feedback run at the full size. A
 * frame allocates nothing; a pass that switches off frees its targets, and
 * `dispose` frees them all.
 */
export class Composite {
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms: CompositeUniforms;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly triangle: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** The config in force; read by the renderer and the tests. */
  config: PostConfig = { look: 'lowpoly', samples: 4, fxaa: false, smaa: false, ao: 0, depth: false, bloom: false };
  readonly _low: THREE.ShaderMaterial;
  readonly _tone: THREE.ShaderMaterial;
  readonly _final: THREE.ShaderMaterial;
  readonly _gtao: THREE.ShaderMaterial;
  readonly _blur: THREE.ShaderMaterial;
  readonly _prefilter: THREE.ShaderMaterial;
  readonly _down: THREE.ShaderMaterial;
  readonly _up: THREE.ShaderMaterial;
  readonly _toneUniforms: ToneUniforms;
  readonly _finalUniforms: FinalUniforms;
  readonly _gtaoUniforms: GtaoUniforms;
  readonly _blurUniforms: BlurUniforms;
  readonly _prefilterUniforms: BloomPassUniforms & SoftUniforms & { exposure: U<number> };
  readonly _downUniforms: BloomPassUniforms;
  readonly _upUniforms: BloomPassUniforms;
  /** Raw GTAO, then its denoised copy; r is visibility, g the view depth in metres. */
  readonly _aoRaw = floatTarget(THREE.RGFormat, THREE.NearestFilter);
  readonly _aoBlur = floatTarget(THREE.RGFormat, THREE.NearestFilter);
  readonly _bloom: THREE.WebGLRenderTarget[] = Array.from({ length: BLOOM_LEVELS }, () => floatTarget(THREE.RGBAFormat, THREE.LinearFilter));
  /**
   * The soft particles' layer (R5), premultiplied, at the scene target's size
   * and drawn share; allocated while soft particles are on (`depth`).
   */
  readonly _soft = floatTarget(THREE.RGBAFormat, THREE.LinearFilter);
  /** The layer's size against the scene target's (`SOFT_HALF_FROM`). */
  _softScale = 1;
  readonly _softSizeOut = new THREE.Vector2();
  readonly _softUniforms: SoftUniforms = { soft: { value: this._soft.texture }, softOn: { value: 0 } };
  /** Tone-mapped, sRGB-encoded frames for SMAA and the final pass. */
  readonly _ldr = ldrTarget();
  readonly _ldr2 = ldrTarget();
  _smaa: SMAAPass | null = null;
  _depth: THREE.DepthTexture | null = null;
  /** Allocated size of the scene target. */
  _width = 2;
  _height = 2;
  /** Dynamic resolution's share of it, per axis. */
  _scale = 1;
  _exposure = 1;
  /** The drawn share of the scene target, for the passes that read it. */
  readonly _sceneRegion = regionUniforms();
  readonly _clear = new THREE.Color();

  constructor() {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      // The canvas `antialias` flag does nothing for an offscreen target; MSAA has to live here.
      samples: 4,
    });
    const feedback: FeedbackUniforms = {
      time: { value: 0 }, aspect: { value: 1 },
      hurtIn: { value: 0 }, lowHp: { value: 0 }, flash: { value: 0 }, slow: { value: 0 },
      hostile: { value: new THREE.Color(TONE_HEX[TONE.HOSTILE]) },
      background: { value: new THREE.Color(SURF.sky) },
    };
    const grade: GradeUniforms = {
      lift: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3(1, 1, 1) }, saturation: { value: 1 }, contrast: { value: 1 },
    };
    const aoLookup: AoLookupUniforms = {
      depth: { value: null }, ao: { value: this._aoBlur.texture }, aoSize: { value: new THREE.Vector2(1, 1) },
      aoLast: { value: new THREE.Vector2() }, cameraNear: { value: 0.1 }, cameraFar: { value: 100 },
    };
    const bloom: BloomUniforms = { bloom: { value: this._bloom[0]!.texture }, bloomStrength: { value: BLOOM_STRENGTH },
      bloomMax: { value: new THREE.Vector2(1, 1) } };
    const region = this._sceneRegion;
    this.uniforms = { ...feedback, ...grade, ...aoLookup, ...bloom, ...region,
      image: { value: this.target.texture }, texel: { value: new THREE.Vector2(0.5, 0.5) } };
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this._low = makePostMaterial(this.uniforms, VERTEX, `
      #include <packing>
      uniform sampler2D image;
      uniform vec2 texel;
      varying vec2 vUv;
      ${GRADE_GLSL}
      ${FEEDBACK_GLSL}
      ${REGION_GLSL}

      vec3 tap(vec2 uv) { return texture2D(image, min(uv, uvMax)).rgb; }

      #ifdef FXAA
      ${fxaa('sqrt(dot(min(c, 1.0), vec3(0.299, 0.587, 0.114)))')}
      #endif
      #ifdef AO
      ${AO_LOOKUP_GLSL}
      #endif
      #ifdef BLOOM
      uniform sampler2D bloom;
      uniform float bloomStrength;
      uniform vec2 bloomMax;
      #endif

      // Tone mapping: identity up to the knee, then a soft roll-off to white, so
      // the flat palette keeps its values and only over-lit faces are compressed.
      vec3 shoulder(vec3 c) {
        const float knee = 0.8;
        return min(c, knee) + (1.0 - knee) * (1.0 - exp(-max(c - knee, 0.0) / (1.0 - knee)));
      }

      void main() {
        vec2 uv = vUv * uvScale;
        #ifdef FXAA
        vec3 col = fxaa(uv);
        #else
        vec3 col = tap(uv);
        #endif
        #ifdef AO
        col *= occlusion(uv, texture2D(image, min(uv, uvMax)).a);
        #endif
        #ifdef BLOOM
        col += texture2D(bloom, min(uv, bloomMax)).rgb * bloomStrength;
        #endif
        // Per-mood grade on the tone-mapped image: gain in linear light, then
        // lift and contrast in a perceptual (square-root) space. Lift there
        // tints the shadows but leaves black black, so dark kit (the guns, the
        // slate roofs) keeps its hue from map to map. Saturation last.
        col = grade(shoulder(col));
        // Gameplay feedback (§3.6) stays last and unchanged.
        gl_FragColor = vec4(feedback(col, vUv), 1.0);
        #ifdef LDR_OUT
        // SMAA follows and wants sRGB values; it writes them to the canvas as they are.
        gl_FragColor.rgb = sRGBTransferOETF(gl_FragColor).rgb;
        #else
        #include <colorspace_fragment>
        #endif
      }
    `);

    this._toneUniforms = { ...grade, ...aoLookup, ...bloom, ...region, ...this._softUniforms, image: { value: this.target.texture }, exposure: { value: 1 } };
    this._tone = makePostMaterial(this._toneUniforms, VERTEX, `
      #include <packing>
      uniform sampler2D image;
      uniform float exposure;
      varying vec2 vUv;
      #define S_CURVE
      ${GRADE_GLSL}
      ${REGION_GLSL}
      #ifdef AO
      ${AO_LOOKUP_GLSL}
      #endif
      #ifdef BLOOM
      uniform sampler2D bloom;
      uniform float bloomStrength;
      uniform vec2 bloomMax;
      #endif
      #ifdef SOFT
      ${SOFT_GLSL}
      #endif

      // AgX (Troy Sobotka's, in the common minimal fit): a log encoding over
      // 16.5 stops, a sigmoid, and back. Bright colours desaturate towards white
      // instead of skewing hue, so a sunlit orange wall stays orange.
      vec3 agx(vec3 c) {
        const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
        const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
        const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
          vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
        const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
          vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
        const float minEv = -12.47393, maxEv = 4.026069;
        c = inset * (toRec2020 * c);
        c = clamp((log2(max(c, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
        vec3 x2 = c * c, x4 = x2 * x2;
        c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232;
        // A mild "punchy" look, as Blender's: a touch more contrast before the outset.
        c = pow(max(c, 0.0), vec3(1.12));
        c = fromRec2020 * pow(max(outset * c, 0.0), vec3(2.2));
        // Dark, strongly coloured light (sky-blue shade on blue paint) leaves the sRGB gamut
        // here. Cutting each channel at 0 skews the hue towards flat navy or black; instead
        // move towards grey at the same luminance until the smallest channel is 8 % of it.
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)), m = min(c.r, min(c.g, c.b));
        if (l > 0.0 && m < 0.08 * l) c = l + (c - l) * (0.92 * l / (l - m));
        return clamp(c, 0.0, 1.0);
      }

      // Draws the whole LDR target: at a reduced dynamic scale, this is where the frame scales back up.
      void main() {
        vec2 uv = min(vUv * uvScale, uvMax);
        vec4 scene = texture2D(image, uv);
        vec3 col = scene.rgb;
        #ifdef AO
        col *= occlusion(uv, scene.a);
        #endif
        #ifdef SOFT
        col = withSoft(col, uv);
        #endif
        #ifdef BLOOM
        col += texture2D(bloom, min(uv, bloomMax)).rgb * bloomStrength;
        #endif
        col = grade(agx(col * exposure));
        // sRGB out for SMAA and the sharpen, with half a level of dither against banding in the sky.
        vec3 s = sRGBTransferOETF(vec4(col, 1.0)).rgb;
        float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        gl_FragColor = vec4(s + (noise - 0.5) / 255.0, 1.0);
      }
    `);

    this._finalUniforms = { ...feedback, image: { value: this._ldr.texture }, texel: { value: new THREE.Vector2(0.5, 0.5) } };
    this._final = makePostMaterial(this._finalUniforms, VERTEX, `
      uniform sampler2D image;
      uniform vec2 texel;
      varying vec2 vUv;
      ${FEEDBACK_GLSL}
      vec3 tap(vec2 uv) { return texture2D(image, uv).rgb; }
      #ifdef FXAA
      ${fxaa('dot(c, vec3(0.299, 0.587, 0.114))')}
      #endif

      // AMD's contrast-adaptive sharpening, the one-pass cross form: sharpen
      // less where the neighbourhood is already contrasty. The result stays
      // inside its neighbours' range, so a hard edge (a shadow's texel steps)
      // gets no bright or dark halo.
      vec3 sharpen(vec2 uv) {
        vec3 a = tap(uv + vec2(0.0, texel.y)), b = tap(uv - vec2(texel.x, 0.0)), c = tap(uv);
        vec3 d = tap(uv + vec2(texel.x, 0.0)), e = tap(uv - vec2(0.0, texel.y));
        vec3 lo = min(c, min(min(a, b), min(d, e))), hi = max(c, max(max(a, b), max(d, e)));
        vec3 amp = sqrt(clamp(min(lo, 2.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
        vec3 w = -amp * mix(0.125, 0.2, ${SHARPEN.toFixed(2)});
        return clamp((c + w * (a + b + d + e)) / (1.0 + 4.0 * w), lo, hi);
      }

      void main() {
        #ifdef FXAA
        vec3 col = fxaa(vUv);
        #else
        vec3 col = sharpen(vUv);
        #endif
        col = sRGBTransferEOTF(vec4(col, 1.0)).rgb;
        gl_FragColor = vec4(feedback(col, vUv), 1.0);
        #include <colorspace_fragment>
      }
    `);

    // It reads the scene's depth, so it shares the scene's region.
    this._gtaoUniforms = {
      ...region, depth: { value: null }, aoSize: { value: new THREE.Vector2(1, 1) }, texel: { value: new THREE.Vector2(1, 1) },
      projXY: { value: new THREE.Vector2(1, 1) }, cameraNear: { value: 0.1 }, cameraFar: { value: 100 },
      radiusScale: { value: 1 }, radiusMax: { value: 1 },
    };
    this._gtao = makePostMaterial(this._gtaoUniforms, VERTEX, `
      #include <packing>
      uniform sampler2D depth;
      uniform vec2 aoSize, texel, projXY;
      uniform float cameraNear, cameraFar, radiusScale, radiusMax;
      ${REGION_GLSL}
      #define SLICES 2
      #define STEPS 4
      const float PI = 3.141592653589793, HALF_PI = 1.5707963267948966;
      const float RADIUS = ${AO_RADIUS.toFixed(2)};
      const float RIG = ${RIG_DEPTH.toFixed(4)};

      // A depth-texture UV to view space; the drawn region spans the whole screen.
      vec3 viewAt(vec2 uv, float d) {
        float z = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
        return vec3((uv / uvScale * 2.0 - 1.0) * projXY * -z, z);
      }
      vec3 viewPos(vec2 uv) { return viewAt(uv, texture2D(depth, min(uv, uvMax)).x); }
      // Sample the depth at a texel centre, and place the point there: a UV on a texel edge
      // (every half-resolution pixel centre is one) picks either side and bands flat ground.
      vec2 centre(vec2 uv) { return min((floor(uv / texel) + 0.5) * texel, uvMax); }
      float fastAcos(float x) {
        float r = (-0.156583 * abs(x) + HALF_PI) * sqrt(1.0 - abs(x));
        return x >= 0.0 ? r : PI - r;
      }
      // A 4 x 4 ordered pattern: the blur pass averages exactly one period of it.
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

      // Ground-truth AO (Jimenez et al. 2016, after Intel's XeGTAO): per slice,
      // find the highest horizon on each side within RADIUS and integrate the
      // cosine-weighted visible arc around the (depth-derived) normal.
      void main() {
        // This AO pixel's own depth texel, found in whole numbers (half resolution: 2i).
        vec2 uv = (floor(floor(gl_FragCoord.xy) / (texel * aoSize) + 0.5) + 0.5) * texel;
        float d = texture2D(depth, uv).x;
        vec3 P = viewAt(uv, d);
        if (d < RIG || d >= 1.0) { gl_FragColor = vec4(1.0, -P.z, 0.0, 1.0); return; }
        // The normal from the flatter neighbour on each axis, so silhouettes do not bend it.
        vec3 l = P - viewPos(uv - vec2(texel.x, 0.0)), r = viewPos(uv + vec2(texel.x, 0.0)) - P;
        vec3 b = P - viewPos(uv - vec2(0.0, texel.y)), t = viewPos(uv + vec2(0.0, texel.y)) - P;
        vec3 N = normalize(cross(abs(l.z) < abs(r.z) ? l : r, abs(b.z) < abs(t.z) ? b : t));
        vec3 V = normalize(-P);
        // The radius in AO pixels; a few pixels means too far away to matter.
        float pixels = min(RADIUS * radiusScale / -P.z, radiusMax);
        if (pixels < 2.0) { gl_FragColor = vec4(1.0, -P.z, 0.0, 1.0); return; }
        float falloffMul = -1.0 / (0.615 * RADIUS), falloffAdd = (1.0 - 0.615) / 0.615 + 1.0;
        vec2 cell = floor(gl_FragCoord.xy);
        float sliceNoise = bayer4(cell), stepNoise = bayer4(cell.yx + vec2(1.0, 2.0));
        float visibility = 0.0;
        for (int s = 0; s < SLICES; s++) {
          float phi = (float(s) + sliceNoise) * PI / float(SLICES);
          vec2 omega = vec2(cos(phi), sin(phi));
          vec3 dir = vec3(omega, 0.0);
          vec3 ortho = dir - dot(dir, V) * V;
          vec3 axis = normalize(cross(ortho, V));
          vec3 projN = N - axis * dot(N, axis);
          float projLen = length(projN);
          float cosN = clamp(dot(projN, V) / max(projLen, 1e-4), 0.0, 1.0);
          float n = sign(dot(ortho, projN)) * fastAcos(cosN);
          float low0 = cos(n + HALF_PI), low1 = cos(n - HALF_PI);
          float h0c = low0, h1c = low1;
          for (int j = 0; j < STEPS; j++) {
            float f = (float(j) + stepNoise) / float(STEPS);
            vec2 offset = omega * max(f * f * pixels, float(j) + 1.0) / aoSize;
            vec2 uv0 = centre(uv + offset), uv1 = centre(uv - offset);
            float d0 = texture2D(depth, uv0).x, d1 = texture2D(depth, uv1).x;
            vec3 s0 = viewAt(uv0, d0) - P, s1 = viewAt(uv1, d1) - P;
            float len0 = length(s0), len1 = length(s1);
            // The gun occludes nothing, and neither does the sky.
            float w0 = d0 < RIG || d0 >= 1.0 ? 0.0 : clamp(len0 * falloffMul + falloffAdd, 0.0, 1.0);
            float w1 = d1 < RIG || d1 >= 1.0 ? 0.0 : clamp(len1 * falloffMul + falloffAdd, 0.0, 1.0);
            h0c = max(h0c, mix(low0, dot(s0 / len0, V), w0));
            h1c = max(h1c, mix(low1, dot(s1 / len1, V), w1));
          }
          float h0 = n + clamp(-fastAcos(h1c) - n, -HALF_PI, HALF_PI);
          float h1 = n + clamp(fastAcos(h0c) - n, -HALF_PI, HALF_PI);
          float sinN = sin(n);
          visibility += projLen * ((cosN + 2.0 * h0 * sinN - cos(2.0 * h0 - n)) + (cosN + 2.0 * h1 * sinN - cos(2.0 * h1 - n))) * 0.25;
        }
        // Squared, as XeGTAO's final power does: contact shadows read, open ground stays clear.
        float ao = clamp(visibility / float(SLICES), 0.0, 1.0);
        gl_FragColor = vec4(ao * ao, -P.z, 0.0, 1.0);
      }
    `);

    this._blurUniforms = { image: { value: this._aoRaw.texture }, texel: { value: new THREE.Vector2(1, 1) }, ...regionUniforms() };
    this._blur = makePostMaterial(this._blurUniforms, VERTEX, `
      uniform sampler2D image;
      uniform vec2 texel;
      varying vec2 vUv;
      ${REGION_GLSL}
      // One period of the 4 x 4 noise, weighted by depth so edges stay sharp.
      void main() {
        vec2 uv = vUv * uvScale;
        vec2 centre = texture2D(image, uv).rg;
        float sum = 0.0, weight = 0.0;
        for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
          vec2 s = texture2D(image, min(uv + vec2(float(x), float(y)) * texel, uvMax)).rg;
          float w = max(0.0, 1.0 - abs(s.g - centre.g) / (0.05 * centre.g + 0.02));
          sum += s.r * w;
          weight += w;
        }
        gl_FragColor = vec4(weight > 0.0 ? sum / weight : centre.r, centre.g, 0.0, 1.0);
      }
    `);

    this._prefilterUniforms = { ...region, ...this._softUniforms, image: { value: this.target.texture }, texel: { value: new THREE.Vector2(1, 1) }, exposure: { value: 1 } };
    this._prefilter = makePostMaterial(this._prefilterUniforms, VERTEX, `
      uniform sampler2D image;
      uniform vec2 texel;
      uniform float exposure;
      varying vec2 vUv;
      ${REGION_GLSL}
      #ifdef SOFT
      ${SOFT_GLSL}
      vec3 tap(vec2 uv) { uv = min(uv, uvMax); return withSoft(texture2D(image, uv).rgb, uv); }
      #else
      vec3 tap(vec2 uv) { return texture2D(image, min(uv, uvMax)).rgb; }
      #endif
      // A 4 x 4 box down to half resolution, then a soft threshold on the exposed brightness.
      void main() {
        vec2 uv = vUv * uvScale;
        vec3 c = 0.25 * (tap(uv + vec2(-1.0, -1.0) * texel) + tap(uv + vec2(1.0, -1.0) * texel)
          + tap(uv + vec2(-1.0, 1.0) * texel) + tap(uv + vec2(1.0, 1.0) * texel));
        float bright = max(c.r, max(c.g, c.b)) * exposure;
        float soft = clamp(bright - ${(BLOOM_THRESHOLD - BLOOM_KNEE).toFixed(3)}, 0.0, ${(2 * BLOOM_KNEE).toFixed(3)});
        soft = soft * soft / ${(4 * BLOOM_KNEE + 1e-4).toFixed(4)};
        float keep = max(soft, bright - ${BLOOM_THRESHOLD.toFixed(3)}) / max(bright, 1e-4);
        // Capped, so one sun-disc pixel cannot flood the screen.
        gl_FragColor = vec4(min(c * keep, vec3(32.0)), 1.0);
      }
    `);
    this._downUniforms = { image: { value: null }, texel: { value: new THREE.Vector2(1, 1) }, ...regionUniforms() };
    this._down = makePostMaterial(this._downUniforms, VERTEX, `
      uniform sampler2D image;
      uniform vec2 texel;
      varying vec2 vUv;
      ${REGION_GLSL}
      vec3 tap(vec2 uv) { return texture2D(image, min(uv, uvMax)).rgb; }
      // Dual-filter downsample: the centre and four bilinear diagonals of the source.
      void main() {
        vec2 uv = vUv * uvScale;
        vec3 c = tap(uv) * 4.0 + tap(uv - texel) + tap(uv + texel)
          + tap(uv + vec2(texel.x, -texel.y)) + tap(uv - vec2(texel.x, -texel.y));
        gl_FragColor = vec4(c / 8.0, 1.0);
      }
    `);
    this._upUniforms = { image: { value: null }, texel: { value: new THREE.Vector2(1, 1) }, ...regionUniforms() };
    this._up = makePostMaterial(this._upUniforms, VERTEX, `
      uniform sampler2D image;
      uniform vec2 texel;
      varying vec2 vUv;
      ${REGION_GLSL}
      vec3 tap(vec2 uv) { return texture2D(image, min(uv, uvMax)).rgb; }
      // Dual-filter upsample (a tent), added onto the level above.
      void main() {
        vec2 uv = vUv * uvScale, h = texel * 0.5;
        vec3 c = tap(uv + vec2(-2.0 * h.x, 0.0)) + tap(uv + vec2(2.0 * h.x, 0.0))
          + tap(uv + vec2(0.0, -2.0 * h.y)) + tap(uv + vec2(0.0, 2.0 * h.y))
          + 2.0 * (tap(uv + vec2(-h.x, h.y)) + tap(uv + vec2(h.x, h.y)) + tap(uv + vec2(h.x, -h.y)) + tap(uv + vec2(-h.x, -h.y)));
        gl_FragColor = vec4(c / 12.0, 1.0);
      }
    `);
    this._up.blending = THREE.AdditiveBlending;

    // Named for the three inspector and the pass-chain test.
    const names: [THREE.ShaderMaterial, string][] = [[this._low, 'composite'], [this._tone, 'agx'], [this._final, 'final'],
      [this._gtao, 'gtao'], [this._blur, 'ao-blur'], [this._prefilter, 'bloom-prefilter'], [this._down, 'bloom-down'], [this._up, 'bloom-up']];
    for (const [material, name] of names) material.name = `post:${name}`;
    this.triangle = new THREE.Mesh(geometry, this._low);
    this.triangle.frustumCulled = false;
    this.scene.add(this.triangle);
    this.setGrade(GRADE.neutral);
  }

  dispose(): void {
    this.target.dispose();
    this._depth?.dispose();
    for (const target of [this._aoRaw, this._aoBlur, this._soft, this._ldr, this._ldr2, ...this._bloom]) target.dispose();
    this._smaa?.dispose();
    this._smaa = null;
    this.triangle.geometry.dispose();
    for (const material of [this._low, this._tone, this._final, this._gtao, this._blur, this._prefilter, this._down, this._up]) material.dispose();
  }

  /**
   * The render-scaled size: a no-op at the same size, while a new size
   * reallocates the targets on their next use. Dynamic resolution does not
   * come here (see `setScale`).
   */
  resize(width: number, height: number, aspect: number): void {
    this._width = width;
    this._height = height;
    this.target.setSize(width, height);
    this._softScale = height >= SOFT_HALF_FROM ? 0.5 : 1;
    this._soft.setSize(Math.max(1, Math.round(width * this._softScale)), Math.max(1, Math.round(height * this._softScale)));
    this.uniforms.aspect.value = aspect;
    this.uniforms.texel.value.set(1 / width, 1 / height);
    this._finalUniforms.texel.value.set(1 / width, 1 / height);
    this._gtaoUniforms.texel.value.set(1 / width, 1 / height);
    this._ldr.setSize(width, height);
    this._ldr2.setSize(width, height);
    this._smaa?.setSize(width, height);
    this._sizeAo();
    for (let i = 0, w = width, h = height; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this._bloom[i]!.setSize(w, h);
    }
    this._applyScale();
  }

  _sizeAo(): void {
    const scale = this.config.ao > 0 ? this.config.ao : 0.5;
    const width = Math.max(1, Math.round(this._width * scale)), height = Math.max(1, Math.round(this._height * scale));
    this._aoRaw.setSize(width, height);
    this._aoBlur.setSize(width, height);
    this._gtaoUniforms.aoSize.value.set(width, height);
    this._blurUniforms.texel.value.set(1 / width, 1 / height);
    // Shared by the Low composite and the tone pass.
    this.uniforms.aoSize.value.set(width, height);
  }

  /**
   * Dynamic resolution: draw the scene, AO and bloom into `scale` of each
   * target per axis. Viewport and uniform writes only, so a step costs nothing.
   */
  setScale(scale: number): void {
    this._scale = scale;
    this._applyScale();
  }

  /** Point every viewport and region uniform at the drawn share of its target. */
  _applyScale(): void {
    const scaled = this._scale < 1;
    const width = scaled ? Math.max(2, Math.floor(this._width * this._scale)) : this._width;
    const height = scaled ? Math.max(2, Math.floor(this._height * this._scale)) : this._height;
    setRegion(this._sceneRegion, width, height, this.target);
    this.target.viewport.set(0, 0, width, height);
    // The scissor keeps the scene pass's clear inside the drawn corner.
    this.target.scissor.set(0, 0, width, height);
    this.target.scissorTest = scaled;
    const softWidth = Math.min(this._soft.width, Math.max(1, Math.round(width * this._softScale)));
    const softHeight = Math.min(this._soft.height, Math.max(1, Math.round(height * this._softScale)));
    this._soft.viewport.set(0, 0, softWidth, softHeight);
    this._soft.scissor.set(0, 0, softWidth, softHeight);
    this._soft.scissorTest = scaled;
    const ao = this.config.ao > 0 ? this.config.ao : 0.5;
    const aoWidth = Math.min(this._aoRaw.width, Math.max(1, Math.round(width * ao)));
    const aoHeight = Math.min(this._aoRaw.height, Math.max(1, Math.round(height * ao)));
    this._aoRaw.viewport.set(0, 0, aoWidth, aoHeight);
    this._aoBlur.viewport.set(0, 0, aoWidth, aoHeight);
    setRegion(this._blurUniforms, aoWidth, aoHeight, this._aoRaw);
    this.uniforms.aoLast.value.set(aoWidth - 1, aoHeight - 1);
    this._gtaoUniforms.radiusMax.value = 0.12 * aoHeight;
    for (let i = 0, w = width, h = height; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this._bloom[i]!.viewport.set(0, 0, w, h);
    }
    const first = this._bloom[0]!, drawn = first.viewport;
    this.uniforms.bloomMax.value.set((drawn.z - 0.5) / first.width, (drawn.w - 0.5) / first.height);
  }

  /**
   * Switch passes on and off. Only what changed is rebuilt: MSAA samples or the
   * depth texture rebuild the scene target on its next use, a define change
   * recompiles one material once, and the targets of a pass that switched off
   * are freed (they reallocate if it comes back). Called on quality changes,
   * never per frame.
   */
  configure(config: PostConfig): void {
    const before = this.config;
    this.config = { ...config };
    const depth = config.ao > 0 || config.depth, ao = config.ao > 0;
    if (this.target.samples !== config.samples || (this.target.depthTexture !== null) !== depth) {
      this.target.samples = config.samples;
      if (depth && !this._depth) {
        this._depth = new THREE.DepthTexture(this._width, this._height);
        // 32-bit float depth: 24-bit steps show up as AO bands on flat ground at a distance.
        this._depth.type = THREE.FloatType;
      }
      // With the depth texture still attached, disposing the target frees it too.
      this.target.dispose();
      if (!depth) this._depth = null;
      this.target.depthTexture = this._depth;
    }
    this.uniforms.depth.value = this._gtaoUniforms.depth.value = this._depth;
    if (before.ao !== config.ao) {
      this._sizeAo();
      this._applyScale();
    }
    if (config.smaa && !this._smaa) {
      this._smaa = new SMAAPass(this._width, this._height);
      // Its edge pass discards non-edges, so stale edges must be cleared each frame (see `draw`).
      this._smaa.clear = true;
    }
    if (!config.smaa && this._smaa) {
      this._smaa.dispose();
      this._smaa = null;
    }
    const realistic = config.look === 'realistic';
    if (!ao) for (const target of [this._aoRaw, this._aoBlur]) target.dispose();
    if (!config.bloom) for (const target of this._bloom) target.dispose();
    if (!config.depth) this._soft.dispose();
    // `_ldr` feeds SMAA on the flat look and the final pass on the realistic one; `_ldr2` is SMAA's output there.
    if (!realistic && !config.smaa) this._ldr.dispose();
    if (!realistic || !config.smaa) this._ldr2.dispose();
    setDefines(this._low, { FXAA: config.fxaa, AO: ao, BLOOM: config.bloom, LDR_OUT: config.smaa });
    setDefines(this._tone, { AO: ao, BLOOM: config.bloom, SOFT: config.depth });
    setDefines(this._prefilter, { SOFT: config.depth });
    setDefines(this._final, { FXAA: config.fxaa });
    // The Low composite and the realistic final pass both draw the feedback; only one runs.
    this._prefilterUniforms.exposure.value = realistic ? this._exposure : 1;
  }

  /** The soft particles' layer: its size, for their depth lookup (`gl_FragCoord` over it is the depth texture's UV). */
  get softSize(): THREE.Vector2 {
    return this._softSizeOut.set(this._soft.width, this._soft.height);
  }

  /** The scene's depth texture, while AO or the soft particles keep one (`PostConfig.depth`). */
  get depthTexture(): THREE.DepthTexture | null {
    return this._depth;
  }

  setGrade(grade: Grade): void {
    const u = this.uniforms;
    u.lift.value.fromArray(grade.lift);
    u.gain.value.fromArray(grade.gain);
    u.saturation.value = grade.saturation;
    u.contrast.value = grade.contrast;
  }

  /** The realistic look's exposure (a linear multiplier); Low has none. */
  setExposure(exposure: number): void {
    this._exposure = exposure;
    this._toneUniforms.exposure.value = exposure;
    if (this.config.look === 'realistic') this._prefilterUniforms.exposure.value = exposure;
  }

  /**
   * The soft particles (R5): `scene` drawn into their own single-sampled layer
   * (at half size on a high-DPI frame: `SOFT_HALF_FROM`), which the bloom and
   * tone passes lay over the scene (this frame only). They
   * test no depth buffer: each fades out behind the scene's depth texture
   * itself (render/fx.ts `SOFT`). A second draw into the multisampled scene
   * target cost about 1 ms at Ultra even for one puff: it reloads the MSAA
   * samples and resolves the whole frame again.
   */
  drawSoft(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this._clear);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this._soft);
    renderer.clear(true, false, false);
    renderer.render(scene, camera);
    renderer.setClearColor(this._clear, alpha);
    this._softUniforms.softOn.value = 1;
  }

  _pass(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.triangle.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  draw(renderer: THREE.WebGLRenderer, time: number, fx: PostFX, camera: THREE.PerspectiveCamera): void {
    const config = this.config;
    this.uniforms.time.value = time;
    for (const key of ['hurt', 'lowHp', 'flash', 'slow'] as const) this.uniforms[key === 'hurt' ? 'hurtIn' : key].value = fx[key] ?? 0;
    if (config.ao > 0) {
      const g = this._gtaoUniforms, projection = camera.projectionMatrix.elements;
      g.cameraNear.value = this.uniforms.cameraNear.value = camera.near;
      g.cameraFar.value = this.uniforms.cameraFar.value = camera.far;
      g.projXY.value.set(1 / projection[0]!, 1 / projection[5]!);
      // AO pixels per metre at 1 m: half the drawn AO height times the projection's y scale.
      g.radiusScale.value = 0.5 * this._aoRaw.viewport.w * projection[5]!;
      this._pass(renderer, this._gtao, this._aoRaw);
      this._pass(renderer, this._blur, this._aoBlur);
    }
    if (config.bloom) {
      const source = this.target;
      this._prefilterUniforms.texel.value.set(1 / source.width, 1 / source.height);
      this._pass(renderer, this._prefilter, this._bloom[0]!);
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        const from = this._bloom[i - 1]!;
        this._downUniforms.image.value = from.texture;
        this._downUniforms.texel.value.set(1 / from.width, 1 / from.height);
        setRegion(this._downUniforms, from.viewport.z, from.viewport.w, from);
        this._pass(renderer, this._down, this._bloom[i]!);
      }
      for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
        const from = this._bloom[i]!;
        this._upUniforms.image.value = from.texture;
        this._upUniforms.texel.value.set(1 / from.width, 1 / from.height);
        setRegion(this._upUniforms, from.viewport.z, from.viewport.w, from);
        this._pass(renderer, this._up, this._bloom[i - 1]!);
      }
    }
    const smaa = config.smaa ? this._smaa : null;
    if (config.look === 'realistic') {
      this._pass(renderer, this._tone, this._ldr);
      if (smaa) this._antialias(renderer, smaa, this._ldr2);
      this._finalUniforms.image.value = smaa ? this._ldr2.texture : this._ldr.texture;
      renderer.setRenderTarget(null);
      renderer.clear();
      this._pass(renderer, this._final, null);
    } else if (smaa) {
      this._pass(renderer, this._low, this._ldr);
      renderer.setRenderTarget(null);
      renderer.clear();
      this._antialias(renderer, smaa, null);
    } else {
      renderer.setRenderTarget(null);
      renderer.clear();
      this._pass(renderer, this._low, null);
    }
    this._softUniforms.softOn.value = 0;
  }

  /** SMAA from `_ldr` into `target` (null: the canvas). Its passes clear to transparent black. */
  _antialias(renderer: THREE.WebGLRenderer, smaa: SMAAPass, target: THREE.WebGLRenderTarget | null): void {
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this._clear);
    renderer.setClearColor(0x000000, 0);
    smaa.renderToScreen = target === null;
    smaa.render(renderer, target as THREE.WebGLRenderTarget, this._ldr, 0, false);
    renderer.setClearColor(this._clear, alpha);
  }
}

/** Point a pass at the lower-left `width` × `height` texels of `source` (see REGION_GLSL). */
function setRegion(region: RegionUniforms, width: number, height: number, source: THREE.WebGLRenderTarget): void {
  region.uvScale.value.set(width / source.width, height / source.height);
  region.uvMax.value.set((width - 0.5) / source.width, (height - 0.5) / source.height);
}

/** Set or clear boolean defines; recompiles only when one actually changes. */
function setDefines(material: THREE.ShaderMaterial, flags: Record<string, boolean>): void {
  let changed = false;
  for (const [name, on] of Object.entries(flags)) {
    if ((name in material.defines) === on) continue;
    if (on) material.defines[name] = '';
    else delete material.defines[name];
    changed = true;
  }
  if (changed) material.needsUpdate = true;
}

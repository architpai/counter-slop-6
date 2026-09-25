import * as THREE from 'three';
import { GRADE, SURF, TONE, TONE_HEX } from './palette';
import { makePostMaterial } from './materials';
import type { Grade } from '../types';

/** The four feedback intensities of §3.6, rebuilt by `boot` every frame. */
export interface PostFX {
  hurt: number;
  flash: number;
  slow: number;
  lowHp: number;
}

/**
 * The shader's uniform table. A type alias, not an interface, so it keeps the
 * implicit index signature `makePostMaterial` needs.
 */
type CompositeUniforms = {
  image: THREE.IUniform<THREE.Texture>;
  /** One target texel in UV, for FXAA. */
  texel: THREE.IUniform<THREE.Vector2>;
  lift: THREE.IUniform<THREE.Vector3>;
  gain: THREE.IUniform<THREE.Vector3>;
  saturation: THREE.IUniform<number>;
  contrast: THREE.IUniform<number>;
  time: THREE.IUniform<number>;
  aspect: THREE.IUniform<number>;
  hurtIn: THREE.IUniform<number>;
  lowHp: THREE.IUniform<number>;
  flash: THREE.IUniform<number>;
  slow: THREE.IUniform<number>;
  hostile: THREE.IUniform<THREE.Color>;
  background: THREE.IUniform<THREE.Color>;
};

export class Composite {
  readonly target: THREE.WebGLRenderTarget;
  readonly uniforms: CompositeUniforms;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly triangle: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      // The canvas `antialias` flag does nothing for an offscreen target; MSAA has to live here.
      samples: 4,
    });
    this.uniforms = {
      image: { value: this.target.texture },
      texel: { value: new THREE.Vector2(0.5, 0.5) },
      lift: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3(1, 1, 1) },
      saturation: { value: 1 }, contrast: { value: 1 },
      time: { value: 0 }, aspect: { value: 1 },
      hurtIn: { value: 0 }, lowHp: { value: 0 }, flash: { value: 0 }, slow: { value: 0 },
      hostile: { value: new THREE.Color(TONE_HEX[TONE.HOSTILE]) },
      background: { value: new THREE.Color(SURF.sky) },
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const material = makePostMaterial(this.uniforms, `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position, 1.0);
      }
    `, `
      uniform sampler2D image;
      uniform vec2 texel;
      uniform vec3 lift, gain;
      uniform float saturation, contrast;
      uniform float time, aspect, hurtIn, lowHp, flash, slow;
      uniform vec3 hostile, background;
      varying vec2 vUv;

      vec3 tap(vec2 uv) { return texture2D(image, uv).rgb; }

      #ifdef FXAA
      float lumaOf(vec3 c) { return sqrt(dot(min(c, 1.0), vec3(0.299, 0.587, 0.114))); }
      // Classic single-pass FXAA (Lottes' "FXAA 2" shape): one edge direction, two blends.
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
      #endif

      // Tone mapping: identity up to the knee, then a soft roll-off to white, so
      // the flat palette keeps its values and only over-lit faces are compressed.
      vec3 shoulder(vec3 c) {
        const float knee = 0.8;
        return min(c, knee) + (1.0 - knee) * (1.0 - exp(-max(c - knee, 0.0) / (1.0 - knee)));
      }

      void main() {
        #ifdef FXAA
        vec3 col = fxaa(vUv);
        #else
        vec3 col = tap(vUv);
        #endif
        // Per-mood grade on the tone-mapped image: gain in linear light, then
        // lift and contrast in a perceptual (square-root) space. Lift there
        // tints the shadows but leaves black black, so dark kit (the guns, the
        // slate roofs) keeps its hue from map to map. Saturation last.
        col = shoulder(col) * gain;
        vec3 p = sqrt(max(col, 0.0));
        p += lift * (1.0 - p);
        p = max((p - 0.5) * contrast + 0.5, 0.0);
        col = p * p;
        col = clamp(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, saturation), 0.0, 1.0);
        // Gameplay feedback (§3.6) stays last and unchanged.
        float vig = smoothstep(0.32, 0.9, length((vUv - 0.5) * vec2(aspect, 1.0)));
        float hurt = clamp(hurtIn + lowHp * (0.35 + 0.25 * sin(6.0 * time)), 0.0, 1.0);
        col = mix(col, hostile * 0.9, hurt * vig);
        col = mix(col, background, flash);
        float lum = dot(col, vec3(0.3, 0.5, 0.2));
        col = mix(col, lum * vec3(0.8, 0.86, 1.0), slow * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `);
    this.triangle = new THREE.Mesh(geometry, material);
    this.triangle.frustumCulled = false;
    this.scene.add(this.triangle);
    this.setGrade(GRADE.neutral);
  }

  // ponytail: this class carried two identical `dispose()` bodies; the second one
  // silently won. Only one is kept, which is what ran before.
  dispose(): void {
    this.target.dispose();
    this.triangle.geometry.dispose();
    this.triangle.material.dispose();
  }

  /** A no-op at the same size; a new size reallocates the target on its next use. */
  resize(width: number, height: number, aspect: number): void {
    this.target.setSize(width, height);
    this.uniforms.aspect.value = aspect;
    this.uniforms.texel.value.set(1 / width, 1 / height);
  }

  /** `samples` 0 is plain rendering. Changing it rebuilds the target on its next use. */
  setAntialias(samples: number, fxaa: boolean): void {
    if (this.target.samples !== samples) {
      this.target.samples = samples;
      this.target.dispose();
    }
    const material = this.triangle.material;
    if (('FXAA' in material.defines) !== fxaa) {
      if (fxaa) material.defines.FXAA = '';
      else delete material.defines.FXAA;
      material.needsUpdate = true;
    }
  }

  setGrade(grade: Grade): void {
    const u = this.uniforms;
    u.lift.value.fromArray(grade.lift);
    u.gain.value.fromArray(grade.gain);
    u.saturation.value = grade.saturation;
    u.contrast.value = grade.contrast;
  }

  draw(renderer: THREE.WebGLRenderer, time: number, fx: PostFX): void {
    this.uniforms.time.value = time;
    for (const key of ['hurt', 'lowHp', 'flash', 'slow'] as const) this.uniforms[key === 'hurt' ? 'hurtIn' : key].value = fx[key] ?? 0;
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import { BLOOD } from './palette';

/**
 * Blood on the sword's blade, drawn in its own material: it coats the blade
 * from the tip down towards the guard in streaks along its length, heavier
 * along the edge, wet (glossy, not metal) where fresh and darker as it dries.
 * `Sword.blood` (0..1, +0.42 a kill, drying away) sets how far it reaches.
 * It replaced the old knife's flat smear quads, which stood off the long
 * blade unlit.
 *
 * The mask works in the blade's own frame (`frame`): the shader takes the
 * fragment's world position into it, so a material shared by the guard and
 * grip (the realistic set's) shows blood only between the guard and the tip.
 * That set's material is made with it (materials.ts `weaponMaterial`), so the
 * weapons' warm-up links the program the sword draws with.
 */

interface BloodUniforms {
  uBloodFrame: THREE.IUniform<THREE.Matrix4>;
  /** Guard z, tip z, the blade's centre height at the guard and half height, in the frame. */
  uBloodAxis: THREE.IUniform<THREE.Vector4>;
  /** How far the blade's centre rises by the tip (a curved blade). */
  uBloodRise: THREE.IUniform<number>;
  uBlood: THREE.IUniform<number>;
  uBloodFresh: THREE.IUniform<THREE.Color>;
  uBloodDry: THREE.IUniform<THREE.Color>;
}

export interface BladeBlood {
  /** Show `amount` (0..1) of blood; call after the model's pose is final this frame. */
  update(amount: number): void;
  /** The amount shown. */
  readonly amount: number;
}

const patched = new WeakMap<THREE.Material, BloodUniforms>();

const VERTEX_DECL = /* glsl */`
varying vec3 vBloodWorld;`;
const VERTEX_BODY = /* glsl */`
vBloodWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const FRAGMENT_DECL = /* glsl */`
uniform mat4 uBloodFrame;
uniform vec4 uBloodAxis;
uniform float uBloodRise;
uniform float uBlood;
uniform vec3 uBloodFresh;
uniform vec3 uBloodDry;
varying vec3 vBloodWorld;
float bloodHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bloodNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bloodHash(i), bloodHash(i + vec2(1.0, 0.0)), f.x), mix(bloodHash(i + vec2(0.0, 1.0)), bloodHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bloodMask() {
  if (uBlood <= 0.001) return 0.0;
  vec3 p = (uBloodFrame * vec4(vBloodWorld, 1.0)).xyz;
  float t = (p.z - uBloodAxis.x) / (uBloodAxis.y - uBloodAxis.x);
  float h = (p.y - uBloodAxis.z - uBloodRise * t * t) / uBloodAxis.w;
  if (t < 0.0 || t > 1.02 || abs(h) > 1.4) return 0.0;
  // Streaks run along the blade: the noise is stretched along its length, so blood reaches the guard in runs.
  float n = bloodNoise(vec2(t * 2.2, h * 12.0)) * 0.65 + bloodNoise(vec2(t * 8.0, h * 26.0)) * 0.35;
  float edge = clamp(0.5 - 0.5 * h, 0.0, 1.0);
  float cover = uBlood * 0.8 - (1.0 - t) * 0.9 + edge * 0.2 + (n - 0.5) * 0.7;
  // A thin film where it is just reaching (the steel shows through), thick and opaque where it has pooled.
  return smoothstep(0.0, 0.04, cover) * mix(0.5, 0.95, smoothstep(0.0, 0.3, cover));
}`;
const FRAGMENT_COLOR = /* glsl */`
float bloodAmount = bloodMask();
diffuseColor.rgb = mix(diffuseColor.rgb, mix(uBloodDry, uBloodFresh, clamp(uBlood, 0.0, 1.0) * 0.75), bloodAmount);`;
const FRAGMENT_ROUGH = /* glsl */`
roughnessFactor = mix(roughnessFactor, 0.2, bloodAmount);`;
const FRAGMENT_METAL = /* glsl */`
metalnessFactor = mix(metalnessFactor, 0.0, bloodAmount);`;

/** Patch `material` (once) to draw blade blood; the uniforms live with it, and the first call's colours stay. */
export function patchBladeBlood(material: THREE.Material, realistic: boolean): BloodUniforms {
  const known = patched.get(material);
  if (known) return known;
  const uniforms: BloodUniforms = {
    uBloodFrame: { value: new THREE.Matrix4() },
    uBloodAxis: { value: new THREE.Vector4(0, -1, 0, 1) },
    uBloodRise: { value: 0 },
    uBlood: { value: 0 },
    uBloodFresh: { value: new THREE.Color(realistic ? BLOOD.fresh : BLOOD.low) },
    uBloodDry: { value: new THREE.Color(realistic ? BLOOD.dry : BLOOD.dry) },
  };
  const base = material.onBeforeCompile, baseKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function (shader, renderer) {
    base.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERTEX_DECL}`)
      .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAGMENT_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${FRAGMENT_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>${FRAGMENT_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>${FRAGMENT_METAL}`);
  };
  material.customProgramCacheKey = () => `${baseKey()}|blade-blood`;
  material.needsUpdate = true;
  patched.set(material, uniforms);
  return uniforms;
}

/**
 * Blood on `material`'s blade, in `frame`'s space: the blade runs from
 * `guard` to `tip` along z, centred on `centre` in y, `half` high either
 * side. `realistic` picks the blood's colours.
 */
export function bladeBlood(material: THREE.Material, frame: THREE.Object3D, guard: number, tip: number,
  centre: number, half: number, realistic: boolean, rise = 0): BladeBlood {
  const uniforms = patchBladeBlood(material, realistic);
  const axis = new THREE.Vector4(guard, tip, centre, Math.max(1e-4, half));
  return {
    get amount() { return uniforms.uBlood.value; },
    update(amount: number) {
      uniforms.uBlood.value = Math.max(0, Math.min(1, amount));
      uniforms.uBloodAxis.value.copy(axis);
      uniforms.uBloodRise.value = rise;
      uniforms.uBloodFrame.value.copy(frame.matrixWorld).invert();
    },
  };
}

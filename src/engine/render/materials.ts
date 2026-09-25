import * as THREE from 'three';
import { SURF, TONE, TONE_HEX, TOON_STEPS } from './palette';
import type { SurfKey } from './palette';

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
};

/**
 * Unlit, inside-out, never fogged: the sky dome. The horizon-to-zenith gradient
 * and the sun disc are both per pixel, so a mood change is a uniform write.
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
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = mix(horizon, zenith, pow(max(dir.y, 0.0), 0.6));
        // A disc of about 2.5 degrees with a soft rim, a tight glow and a wide haze.
        // Its HDR core is rolled off to white by the composite's tone mapping.
        float d = max(dot(dir, sunDir), 0.0);
        float disc = smoothstep(0.99905, 0.99935, d);
        col += sunColor * sunDisc * (disc * 3.0 + pow(d, 400.0) * 0.8 + pow(d, 24.0) * 0.18 + pow(d, 4.0) * 0.05);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
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

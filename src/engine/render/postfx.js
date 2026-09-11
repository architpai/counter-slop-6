import * as THREE from 'three';
import { SURF, TONE, TONE_HEX } from './palette';
import { makePostMaterial } from './materials';

export class Composite {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: true, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    });
    this.uniforms = {
      image: { value: this.target.texture }, time: { value: 0 }, aspect: { value: 1 },
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
      uniform float time, aspect, hurtIn, lowHp, flash, slow;
      uniform vec3 hostile, background;
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(image, vUv).rgb;
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
  }

  dispose() {
    this.target.dispose();
    this.triangle.geometry.dispose();
    this.triangle.material.dispose();
  }

  resize(width, height, aspect) {
    this.target.setSize(width, height);
    this.uniforms.aspect.value = aspect;
  }

  draw(renderer, time, fx) {
    this.uniforms.time.value = time;
    for (const key of ['hurt', 'lowHp', 'flash', 'slow']) this.uniforms[key === 'hurt' ? 'hurtIn' : key].value = fx[key] ?? 0;
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.triangle.geometry.dispose();
    this.triangle.material.dispose();
  }
}

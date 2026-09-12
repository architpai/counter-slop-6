import * as THREE from 'three';
import { LIGHT, SURF } from './palette';
import { Composite } from './postfx';
import { skyMat } from './materials';
import type { PostFX } from './postfx';

export { TONE, TONE_HEX, WHITE_HEX, SMOKE_HEX, SURF } from './palette';
export { surfMat, charMat, toneMat, unlitMat, setFlash, mergeByMaterial } from './materials';
export { boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo, starGeo, ringGeo } from './prims';
export { makeFigure, makeWeaponProp, makeNameTag } from './figure';
export type { PostFX } from './postfx';

export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: THREE.Group;
  readonly sun: THREE.DirectionalLight;
  readonly post: Composite;
  readonly sky: THREE.Mesh;
  /** Reset before every frame; the first rig mesh drawn clears the depth buffer. */
  _rigDepthCleared = false;
  readonly _clearRigDepth: () => void;
  readonly _prepareRigMesh: (object: THREE.Object3D) => void;
  readonly _onResize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: false, powerPreference: 'high-performance' });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.NoToneMapping;
    this.three.autoClear = false;
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(canvas.style, { position: 'fixed', inset: '0', display: 'block' });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SURF.sky);
    this.scene.fog = new THREE.Fog(SURF.fog, 70, 300);
    this.sky = makeSkyDome();
    this.scene.add(this.sky);
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.08, 420);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.rig = new THREE.Group();
    this.rig.name = 'viewModelRig';
    this.camera.add(this.rig);
    this.sun = new THREE.DirectionalLight(LIGHT.sun, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target, new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, 1.25));
    this.post = new Composite();
    this._clearRigDepth = () => {
      if (!this._rigDepthCleared) {
        this.three.clearDepth();
        this._rigDepthCleared = true;
      }
    };
    this._prepareRigMesh = object => {
      if (!isMesh(object)) return;
      object.castShadow = object.receiveShadow = false;
      object.renderOrder = 1000;
      object.onBeforeRender = this._clearRigDepth;
    };
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.setLevelShadow(new THREE.Vector3(), 80);
    this.resize();
  }

  resize(): void {
    const width = Math.max(2, window.innerWidth), height = Math.max(2, window.innerHeight);
    this.three.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const ratio = this.three.getPixelRatio();
    this.post.resize(Math.floor(width * ratio), Math.floor(height * ratio), this.camera.aspect);
  }

  setLevelShadow(center: THREE.Vector3, radius: number): void {
    radius = Math.max(1, radius);
    this.sun.position.set(0.38, 0.82, 0.42).normalize().multiplyScalar(radius * 2).add(center);
    this.sun.target.position.copy(center);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -radius;
    camera.right = camera.top = radius;
    camera.near = 0.1;
    camera.far = radius * 4;
    camera.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.needsUpdate = true;
  }

  dispose(): void {
    window.removeEventListener('resize', this._onResize);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.post.dispose();
    this.three.dispose();
    // Drop the WebGL context outright: browsers cap live contexts (~16), and a
    // StrictMode remount plus HMR burns through that cap fast.
    this.three.forceContextLoss?.();
  }

  render(time: number, fx: PostFX): void {
    this.rig.traverse(this._prepareRigMesh);
    this._rigDepthCleared = false;
    this.sky.position.copy(this.camera.position);
    this.three.setRenderTarget(this.post.target);
    this.three.clear();
    this.three.render(this.scene, this.camera);
    this.post.draw(this.three, time, fx);
  }
}

/** Horizon (fog) to zenith gradient baked into vertex colours; follows the camera each frame. */
function makeSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(380, 24, 12);
  const position = geometry.attributes.position;
  if (!position) throw new Error('Sky dome has no positions.');
  const colors = new Float32Array(position.count * 3);
  const horizon = new THREE.Color(SURF.fog), zenith = new THREE.Color(LIGHT.zenith), color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.pow(Math.max(0, position.getY(i) / 380), 0.6);
    color.copy(horizon).lerp(zenith, t).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, skyMat());
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

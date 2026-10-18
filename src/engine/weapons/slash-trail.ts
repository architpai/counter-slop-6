import { AdditiveBlending, BufferGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Ctx } from '../types';

/**
 * The sword's slash smear: a ribbon in the view-model rig through where the
 * blade has been over the last moment, from its tip to partway down it,
 * bright at the newest edge and the tip, thinning towards the blade and
 * fading behind. It samples the blade every frame of a slash, so it follows
 * the swing exactly on either look. It replaces the old knife's row of
 * dashes. A child of the rig: it follows the view and draws over the world
 * like the sword itself, on every quality tier.
 */

/** Samples kept: a slash is about 20 frames at 60 fps. */
const SAMPLES = 24;
/** Seconds a sample lasts. */
const LIFE = 0.13;
/** Where the ribbon's inner edge is down the blade: 0 at the grip, 1 at the tip. */
const INNER = 0.45;

const VERTEX = /* glsl */`
attribute float age;
varying float vAge;
varying float vEdge;
void main() {
  vAge = age;
  vEdge = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Additive: black adds nothing. Older samples thin towards the tip, so it reads as a crescent tapering away. */
const FRAGMENT = /* glsl */`
uniform vec3 color;
varying float vAge;
varying float vEdge;
void main() {
  float life = clamp(1.0 - vAge, 0.0, 1.0);
  if (life <= 0.0 || vEdge < 1.0 - life) discard;
  float edge = smoothstep(1.0 - life, 1.0 - life + 0.3, vEdge) * smoothstep(1.0, 0.85, vEdge);
  float glow = life * life * edge;
  gl_FragColor = vec4(mix(color, vec3(1.0), life * 0.55) * glow, 1.0);
}`;

const tip = new Vector3(), grip = new Vector3();

export class SlashTrail {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  _rig: Object3D;
  /** Ring of samples, newest first: tip and inner point (rig space) and age in seconds. */
  _tips: Vector3[];
  _inner: Vector3[];
  _ages: number[];
  _count = 0;
  _positions: Float32BufferAttribute;
  _age: Float32BufferAttribute;

  constructor(ctx: Ctx) {
    this._rig = ctx.renderer.rig;
    this._tips = Array.from({ length: SAMPLES }, () => new Vector3());
    this._inner = Array.from({ length: SAMPLES }, () => new Vector3());
    this._ages = new Array<number>(SAMPLES).fill(Infinity);
    const geometry = new BufferGeometry();
    this._positions = new Float32BufferAttribute(new Float32Array(SAMPLES * 2 * 3), 3).setUsage(DynamicDrawUsage);
    this._age = new Float32BufferAttribute(new Float32Array(SAMPLES * 2), 1).setUsage(DynamicDrawUsage);
    const uv: number[] = [], index: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      uv.push(i / (SAMPLES - 1), 0, i / (SAMPLES - 1), 1);
      if (i < SAMPLES - 1) index.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    geometry.setAttribute('position', this._positions);
    geometry.setAttribute('age', this._age);
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    const material = new ShaderMaterial({
      uniforms: { color: { value: new Vector3(0.62, 0.84, 1) } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'slash-trail';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this._rig.add(this.mesh);
    ctx.renderer.prepareRig?.(this.mesh);
    this.mesh.renderOrder = 1001;
  }

  /**
   * One frame: age the samples, and while `slashing` add the blade as it is
   * now (`root`, the grip, to `tipNode`, the point).
   */
  update(dt: number, slashing: boolean, root: Object3D, tipNode: Object3D): void {
    for (let i = 0; i < this._count; i++) this._ages[i]! += dt;
    while (this._count > 0 && this._ages[this._count - 1]! > LIFE) this._count--;
    if (slashing) {
      root.updateMatrixWorld(true);
      this._rig.worldToLocal(tipNode.getWorldPosition(tip));
      this._rig.worldToLocal(root.getWorldPosition(grip));
      // Newest first: shift the ring down one.
      const lastTip = this._tips[SAMPLES - 1]!, lastInner = this._inner[SAMPLES - 1]!;
      for (let i = SAMPLES - 1; i > 0; i--) {
        this._tips[i] = this._tips[i - 1]!; this._inner[i] = this._inner[i - 1]!; this._ages[i] = this._ages[i - 1]!;
      }
      this._tips[0] = lastTip.copy(tip);
      this._inner[0] = lastInner.copy(grip).lerp(tip, INNER);
      this._ages[0] = 0;
      this._count = Math.min(SAMPLES, this._count + 1);
    }
    this.mesh.visible = this._count >= 2;
    if (!this.mesh.visible) return;
    const pos = this._positions, age = this._age;
    for (let i = 0; i < SAMPLES; i++) {
      // Unused slots repeat the oldest sample, fully aged, so they draw nothing.
      const k = Math.min(i, this._count - 1), a = i < this._count ? this._ages[k]! / LIFE : 1;
      const inner = this._inner[k]!, outer = this._tips[k]!;
      pos.setXYZ(2 * i, inner.x, inner.y, inner.z);
      pos.setXYZ(2 * i + 1, outer.x, outer.y, outer.z);
      age.setX(2 * i, a); age.setX(2 * i + 1, a);
    }
    pos.needsUpdate = age.needsUpdate = true;
  }

  hide(): void {
    this._count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

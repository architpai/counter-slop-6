import * as THREE from 'three';
import { TONE, TONE_HEX, toneMat, unlitMat, boxGeo, cylGeo, sphereGeo, torusGeo, starGeo } from '../render/index';
import type { GunKind, Triple } from './stats';

const PRIMARY = TONE.PRIMARY, DARK = TONE.DARK, SIGHT = TONE.HOSTILE;

/** The rest pose `remember()` stashes on a part the animators move. */
export interface RestPose {
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
}

/** three types `userData` as `any`; this is the one place that shape is named. */
export const restPose = (node: THREE.Object3D): RestPose => node.userData as RestPose;

/** Blood level at which a blade smear becomes visible. */
interface SmearData {
  threshold: number;
}
export const smearThreshold = (smear: THREE.Mesh): number => (smear.userData as SmearData).threshold;

/** Moving parts, by the name the animators use. Each model builds only its own. */
export interface ModelParts {
  /** Every model has one; the reload and shell poses move it. */
  leftHand: THREE.Object3D;
  mag?: THREE.Object3D;
  cylinder?: THREE.Object3D;
  foreEnd?: THREE.Object3D;
  bolt?: THREE.Object3D;
}

/** What a `ViewModel` needs from any view model. */
export interface WeaponModel {
  root: THREE.Group;
  parts: ModelParts;
  /** Gun: the barrel end. Katana: the blade tip. */
  muzzle: THREE.Group;
  bloodSmears: THREE.Mesh[];
}

export interface GunModel extends WeaponModel {
  eject: THREE.Group;
  flash: THREE.Group;
}

function group(parent: THREE.Object3D | null, name: string, position: Triple = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  parent?.add(node);
  return node;
}

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
  material: THREE.Material, position: Triple = [0, 0, 0], rotation: Triple = [0, 0, 0]) {
  const node = new THREE.Mesh(geometry, material);
  node.name = name;
  node.position.set(...position);
  node.rotation.set(...rotation);
  node.renderOrder = 1000;
  node.castShadow = node.receiveShadow = false;
  parent.add(node);
  return node;
}

const box = (parent: THREE.Object3D, name: string, size: Triple, pos: Triple, tone: number = PRIMARY, rot?: Triple) =>
  mesh(parent, name, boxGeo(...size), toneMat(tone), pos, rot);
const cylinder = (parent: THREE.Object3D, name: string, radius: number, length: number, pos: Triple,
  tone: number = PRIMARY, sides = 8) =>
  mesh(parent, name, cylGeo(radius, length, sides, 'z'), toneMat(tone), pos);
const sphere = (parent: THREE.Object3D, name: string, radius: number, pos: Triple, tone: number = PRIMARY, segments = 8) =>
  mesh(parent, name, sphereGeo(radius, segments), toneMat(tone), pos);

function remember<T extends THREE.Object3D>(node: T): T {
  node.userData.restPos = node.position.clone();
  node.userData.restRot = node.rotation.clone();
  return node;
}

function hand(parent: THREE.Object3D, name: string, pos: Triple, direction: Triple) {
  const node = group(parent, name, pos);
  sphere(node, `${name}-fist`, 0.062, [0, 0, 0]);
  const length = 0.42, dir = new THREE.Vector3(...direction).normalize();
  const geo = cylGeo(0.05, length, 7, 'y');
  const points = geo.getAttribute('position');
  for (let i = 0; i < points.count; i++) {
    const taper = (0.045 + 0.01 * points.getY(i) / length) / 0.05;
    points.setX(i, points.getX(i) * taper);
    points.setZ(i, points.getZ(i) * taper);
  }
  geo.computeVertexNormals();
  const arm = mesh(node, `${name}-forearm`, geo, toneMat(PRIMARY));
  arm.position.copy(dir).multiplyScalar(length / 2);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return remember(node);
}

function twoSided(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = flat.getAttribute('position'), vertices: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    for (const n of [i, i + 1, i + 2, i + 2, i + 1, i]) vertices.push(p.getX(n), p.getY(n), p.getZ(n));
  }
  if (flat !== geometry) flat.dispose();
  geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}

function flash(parent: THREE.Object3D) {
  const node = group(parent, 'muzzle-flash');
  const material = unlitMat(TONE_HEX[TONE.ACCENT]);
  mesh(node, 'flash-star-front', twoSided(starGeo(7, 0.16, 0.06)), material);
  mesh(node, 'flash-star-side', twoSided(starGeo(5, 0.11, 0.04)), material, [0, 0, 0], [0, Math.PI / 2, 0]);
  mesh(node, 'flash-star-top', twoSided(starGeo(5, 0.10, 0.04)), material, [0, 0, 0], [Math.PI / 2, 0, 0]);
  node.visible = false;
  return node;
}

/** A model under construction: the required parts are not all built yet. */
interface Draft {
  root: THREE.Group;
  parts: Partial<ModelParts>;
  bloodSmears: THREE.Mesh[];
}

function model(name: string): Draft {
  const root = group(null, `${name}-viewmodel`);
  root.scale.setScalar(0.46);
  root.visible = false;
  return { root, parts: {}, bloodSmears: [] };
}

export function makeGunModel(kind: GunKind): GunModel {
  if (!['rifle', 'shotgun', 'sniper', 'revolver'].includes(kind)) throw new RangeError(`Unknown gun kind: ${kind}`);
  const result = model(kind), { root, parts } = result;
  let muzzlePos: Triple, ejectPos: Triple, leftHand: THREE.Object3D;
  if (kind === 'rifle') {
    box(root, 'receiver', [0.09, 0.12, 0.50], [0, 0, 0]);
    box(root, 'handguard', [0.075, 0.085, 0.36], [0, 0, -0.42]);
    cylinder(root, 'barrel', 0.018, 0.42, [0, 0.02, -0.75], DARK);
    parts.mag = remember(box(root, 'magazine', [0.06, 0.20, 0.10], [0, -0.16, -0.06], PRIMARY, [0.15, 0, 0]));
    box(root, 'stock', [0.07, 0.11, 0.30], [0, -0.01, 0.40]);
    box(root, 'grip', [0.05, 0.14, 0.06], [0, -0.13, 0.12], PRIMARY, [0.3, 0, 0]);
    const sight = group(root, 'sight-ring', [0, 0.12, -0.05]);
    for (const side of [-1, 1]) {
      box(sight, `sight-horizontal-${side}`, [0.075, 0.012, 0.03], [0, side * 0.035, 0]);
      box(sight, `sight-vertical-${side}`, [0.012, 0.07, 0.03], [side * 0.0375, 0, 0]);
    }
    box(root, 'sight-base', [0.03, 0.018, 0.05], [0, 0.062, -0.05], DARK);
    mesh(root, 'reticle-ring', torusGeo(0.0075, 0.0018, 5, 14), toneMat(SIGHT), [0, 0.12, -0.05]);
    sphere(root, 'reticle-dot', 0.0015, [0, 0.12, -0.05], SIGHT, 5);
    hand(root, 'right-hand', [0.02, -0.15, 0.13], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.08, -0.40], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.02, -0.98]; ejectPos = [0.06, 0.02, 0.02];
  } else if (kind === 'shotgun') {
    box(root, 'receiver', [0.09, 0.13, 0.42], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.021, 0.92, [0, 0.05, -0.62], DARK);
    cylinder(root, 'tube-magazine', 0.019, 0.72, [0, -0.02, -0.50]);
    parts.foreEnd = remember(box(root, 'fore-end', [0.078, 0.085, 0.27], [0, 0.01, -0.46]));
    box(root, 'stock', [0.07, 0.12, 0.34], [0, -0.04, 0.42], PRIMARY, [0.08, 0, 0]);
    box(root, 'grip', [0.05, 0.13, 0.06], [0, -0.13, 0.16], PRIMARY, [0.35, 0, 0]);
    sphere(root, 'front-bead', 0.013, [0, 0.095, -1.00], SIGHT, 6);
    box(root, 'rear-sight', [0.03, 0.025, 0.02], [0, 0.085, -0.02], DARK);
    hand(root, 'right-hand', [0.02, -0.16, 0.17], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.04, -0.06, -0.45], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.05, -1.09]; ejectPos = [0.06, 0.03, 0.05];
  } else if (kind === 'sniper') {
    box(root, 'receiver', [0.085, 0.115, 0.60], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.024, 1.25, [0, 0.02, -0.92], DARK);
    cylinder(root, 'muzzle-brake', 0.032, 0.16, [0, 0.02, -1.50], DARK);
    parts.mag = remember(box(root, 'magazine', [0.055, 0.16, 0.14], [0, -0.14, -0.06]));
    box(root, 'stock', [0.075, 0.13, 0.44], [0, -0.02, 0.50], PRIMARY, [0.04, 0, 0]);
    box(root, 'grip', [0.05, 0.14, 0.07], [0, -0.13, 0.20], PRIMARY, [0.3, 0, 0]);
    box(root, 'cheek-riser', [0.06, 0.05, 0.16], [0, 0.07, 0.42]);
    cylinder(root, 'scope-tube', 0.052, 0.56, [0, 0.135, -0.10]);
    cylinder(root, 'objective-bell', 0.066, 0.07, [0, 0.135, -0.36]);
    cylinder(root, 'ocular-bell', 0.062, 0.07, [0, 0.135, 0.14]);
    box(root, 'scope-mount-front', [0.03, 0.09, 0.035], [0, 0.085, -0.24], DARK);
    box(root, 'scope-mount-rear', [0.03, 0.09, 0.035], [0, 0.085, 0.02], DARK);
    const reticle = group(root, 'scope-crosshair', [0, 0.135, -0.38]);
    box(reticle, 'scope-crosshair-horizontal', [0.09, 0.006, 0.004], [0, 0, 0], SIGHT);
    box(reticle, 'scope-crosshair-vertical', [0.006, 0.09, 0.004], [0, 0, 0], SIGHT);
    parts.bolt = remember(box(root, 'bolt-handle', [0.026, 0.026, 0.16], [0.07, 0.05, 0.16], DARK));
    sphere(parts.bolt, 'bolt-knob', 0.032, [0, 0, 0.08], DARK, 6);
    box(root, 'bipod-left', [0.02, 0.26, 0.02], [-0.07, -0.13, -0.78], DARK, [0, 0, 0.35]);
    box(root, 'bipod-right', [0.02, 0.26, 0.02], [0.07, -0.13, -0.78], DARK, [0, 0, -0.35]);
    hand(root, 'right-hand', [0.02, -0.16, 0.24], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.09, -0.50], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.02, -1.60]; ejectPos = [0.06, 0.04, 0.06];
  } else {
    box(root, 'frame', [0.045, 0.09, 0.20], [0, 0, 0]);
    cylinder(root, 'barrel', 0.02, 0.30, [0, 0.035, -0.24], DARK);
    box(root, 'barrel-rib', [0.03, 0.03, 0.26], [0, 0.005, -0.22]);
    parts.cylinder = remember(group(root, 'cylinder', [0, 0, -0.02]));
    cylinder(parts.cylinder, 'cylinder-drum', 0.05, 0.11, [0, 0, 0], PRIMARY, 6);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      cylinder(parts.cylinder, `cylinder-chamber-${i}`, 0.012, 0.115, [Math.cos(a) * 0.032, Math.sin(a) * 0.032, 0], DARK, 5);
    }
    box(root, 'grip', [0.045, 0.14, 0.055], [0, -0.10, 0.07], DARK, [0.4, 0, 0]);
    box(root, 'hammer', [0.02, 0.045, 0.035], [0, 0.05, 0.10], PRIMARY, [-0.4, 0, 0]);
    box(root, 'front-sight', [0.01, 0.03, 0.02], [0, 0.075, -0.34], SIGHT);
    box(root, 'rear-sight-left', [0.012, 0.025, 0.015], [-0.014, 0.06, 0.08]);
    box(root, 'rear-sight-right', [0.012, 0.025, 0.015], [0.014, 0.06, 0.08]);
    hand(root, 'right-hand', [0, -0.13, 0.08], [0.45, -0.55, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.17, 0.02], [-0.4, -0.7, 1]);
    muzzlePos = [0, 0.035, -0.40]; ejectPos = [-0.05, 0.02, 0];
  }
  const muzzle = group(root, 'muzzle', muzzlePos);
  const eject = group(root, 'eject', ejectPos);
  return { root, parts: { ...parts, leftHand }, muzzle, eject, flash: flash(muzzle), bloodSmears: result.bloodSmears };
}

export function makeKatanaModel(): WeaponModel {
  const { root, bloodSmears } = model('katana');
  box(root, 'blade', [0.012, 0.035, 1.00], [0, 0, -0.55]);
  box(root, 'blade-tip', [0.012, 0.02, 0.08], [0, 0.007, -1.07], PRIMARY, [0.3, 0, 0]);
  box(root, 'guard', [0.10, 0.10, 0.02], [0, 0, -0.05], DARK);
  box(root, 'handle-core', [0.03, 0.036, 0.30], [0, 0, 0.12], DARK);
  for (let i = 0; i < 6; i++) box(root, `handle-wrap-${i}`, [0.036, 0.04, 0.02], [0, 0, 0.02 + i * 0.045]);
  hand(root, 'front-hand', [0, -0.005, 0.05], [0.5, -0.5, 1]);
  const leftHand = hand(root, 'rear-hand', [0, -0.005, 0.20], [-0.4, -0.7, 1]);
  const muzzle = group(root, 'tip', [0, 0, -1.05]);
  /** `[centre, length, bloodThreshold, side]` */
  const smears: [number, number, number, number][] = [[-0.34, 0.30, 0, 1], [-0.70, 0.26, 0.18, -1], [-0.95, 0.17, 0.40, 1], [-0.52, 0.22, 0.58, -1], [-0.20, 0.20, 0.74, 1], [-0.84, 0.20, 0.88, -1]];
  smears.forEach(([center, length, threshold, side], i) => {
    const bottom = -0.92 * 0.0168, top: Triple[] = [], vertices: number[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, u = -length / 2 + length * t;
      const taper = Math.sin(Math.PI * Math.min(1, 1.15 * t));
      const v = bottom + 1.84 * 0.0168 * (0.30 + 0.70 * taper * (0.55 + 0.45 * Math.abs(Math.sin(7 * t + 2.1 * i))));
      top.push([0, v, u]);
    }
    for (let k = 0; k < 12; k++) {
      // 13 ridge points make 12 quads, so both ends of every quad exist.
      const from = top[k], to = top[k + 1];
      if (!from || !to) continue;
      const a: Triple = [0, bottom, from[2]], b: Triple = [0, bottom, to[2]];
      vertices.push(...a, ...from, ...to, ...a, ...to, ...b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const smear = mesh(root, `blood-smear-${i}`, twoSided(geometry), toneMat(SIGHT), [side * 0.0067, 0, center]);
    smear.userData.threshold = threshold;
    smear.visible = false;
    bloodSmears.push(smear);
  });
  return { root, parts: { leftHand }, muzzle, bloodSmears };
}

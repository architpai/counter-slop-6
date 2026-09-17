import * as THREE from 'three';
import { TONE, TONE_HEX, toneMat, unlitMat, charMat, boxGeo, cylGeo, sphereGeo, torusGeo, starGeo } from '../render/index';
import type { GunKind, Triple } from './stats';
import { tacticalPart } from '../render/tactical';
import { OPTIC_COLOR } from '../render/palette';

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
  slide?: THREE.Object3D;
  acog?: THREE.Object3D;
  holo?: THREE.Object3D;
}

/** What a `ViewModel` needs from any view model. */
export interface WeaponModel {
  root: THREE.Group;
  parts: ModelParts;
  /** Gun: the barrel end. Melee: the knife tip. */
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
  const side = name.includes('left') ? 'L' : 'R';
  const sleeve = tacticalPart('player', `viewhand${side}`);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...direction).normalize());
  node.add(sleeve);
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
  if (!['r4c', 'rifle', 'pistol', 'shotgun', 'sniper', 'revolver'].includes(kind)) throw new RangeError(`Unknown gun kind: ${kind}`);
  const result = model(kind), { root, parts } = result;
  let muzzlePos: Triple, ejectPos: Triple, leftHand: THREE.Object3D;
  if (kind === 'rifle' || kind === 'r4c') {
    if (kind === 'r4c') {
      box(root, 'receiver', [0.115, 0.15, 0.50], [0, 0, 0], DARK);
      box(root, 'upper-receiver', [0.105, 0.055, 0.52], [0, 0.075, -0.01], PRIMARY);
      box(root, 'magwell', [0.09, 0.08, 0.16], [0, -0.075, -0.11], DARK);
      parts.mag = remember(group(root, 'magazine', [0, -0.12, -0.11]));
      box(parts.mag, 'magazine-body', [0.07, 0.23, 0.14], [0, -0.085, 0], DARK, [0.12, 0, 0]);
      box(parts.mag, 'magazine-base', [0.078, 0.025, 0.15], [0, -0.20, -0.015], PRIMARY, [0.12, 0, 0]);
      const handguard = group(root, 'railed-handguard', [0, 0.02, -0.55]);
      box(handguard, 'handguard-core', [0.095, 0.11, 0.52], [0, 0, 0], DARK);
      for (let i = 0; i < 8; i++) {
        box(handguard, `top-rail-${i}`, [0.105, 0.025, 0.035], [0, 0.068, -0.23 + i * 0.065], PRIMARY);
        for (const side of [-1, 1]) box(handguard, `vent-${side}-${i}`, [0.008, 0.025, 0.035], [side * 0.05, 0, -0.23 + i * 0.065], PRIMARY);
      }
      cylinder(root, 'barrel', 0.022, 0.32, [0, 0.02, -0.96], DARK);
      cylinder(root, 'flash-hider', 0.033, 0.09, [0, 0.02, -1.115], PRIMARY);
      cylinder(root, 'buffer-tube', 0.032, 0.27, [0, 0.035, 0.36], DARK);
      box(root, 'stock', [0.095, 0.13, 0.27], [0, -0.015, 0.43], DARK, [0.08, 0, 0]);
      box(root, 'stock-pad', [0.105, 0.20, 0.035], [0, -0.025, 0.56], PRIMARY);
      box(root, 'grip', [0.06, 0.17, 0.08], [0, -0.15, 0.13], DARK, [0.3, 0, 0]);
      box(root, 'trigger-guard', [0.045, 0.025, 0.11], [0, -0.115, 0.035], PRIMARY);
      box(root, 'charging-handle', [0.15, 0.025, 0.04], [0, 0.075, 0.25], DARK);
      box(root, 'ejection-port', [0.008, 0.035, 0.12], [0.061, 0.03, 0.015], PRIMARY);
    } else {
      box(root, 'receiver', [0.10, 0.13, 0.48], [0, 0, 0], DARK);
      box(root, 'receiver-trim', [0.106, 0.035, 0.42], [0, 0.066, 0.01], PRIMARY);
      parts.mag = remember(group(root, 'magazine', [0, -0.06, -0.04]));
      box(parts.mag, 'magazine-upper', [0.062, 0.13, 0.09], [0, -0.055, 0], DARK, [0.12, 0, 0]);
      box(parts.mag, 'magazine-middle', [0.062, 0.105, 0.09], [0, -0.16, -0.024], DARK, [0.30, 0, 0]);
      box(parts.mag, 'magazine-lower', [0.062, 0.10, 0.09], [0, -0.245, -0.06], DARK, [0.46, 0, 0]);
      box(root, 'magazine-lip', [0.065, 0.025, 0.12], [0, -0.055, -0.04], PRIMARY, [0.18, 0, 0]);
      const handguard = group(root, 'ribbed-handguard', [0, 0, -0.39]);
      box(handguard, 'handguard-core', [0.082, 0.09, 0.32], [0, 0, 0], DARK);
      for (let i = 0; i < 5; i++) box(handguard, `handguard-rib-${i}`, [0.088, 0.012, 0.035], [0, 0.05, -0.13 + i * 0.065], PRIMARY);
      cylinder(root, 'barrel', 0.018, 0.38, [0, 0.015, -0.75], DARK);
      mesh(root, 'front-sight-hood', torusGeo(0.034, 0.007, 5, 12), toneMat(DARK), [0, 0.083, -0.88]);
      box(root, 'front-sight-post', [0.008, 0.036, 0.015], [0, 0.066, -0.88], DARK);
      for (const side of [-1, 1]) cylinder(root, `stock-rail-${side}`, 0.009, 0.30, [side * 0.052, 0.018, 0.36], DARK);
      box(root, 'stock-end', [0.085, 0.17, 0.035], [0, -0.025, 0.51], DARK);
      box(root, 'grip', [0.052, 0.15, 0.065], [0, -0.14, 0.13], DARK, [0.3, 0, 0]);
      box(root, 'charging-handle', [0.018, 0.025, 0.11], [-0.06, 0.075, -0.08], PRIMARY, [0, 0.2, 0]);
    }
    const acogBody = charMat(new THREE.Color(OPTIC_COLOR.acogBody).getHex());
    const acogRim = charMat(new THREE.Color(OPTIC_COLOR.acogRim).getHex());
    const holoBody = charMat(new THREE.Color(OPTIC_COLOR.holoBody).getHex());
    const holoBase = charMat(new THREE.Color(OPTIC_COLOR.holoBase).getHex());
    const acog = parts.acog = group(root, 'acog');
    mesh(acog, 'acog-tube', cylGeo(0.045, 0.34, 8, 'z'), acogBody, [0, 0.145, -0.10]);
    mesh(acog, 'acog-objective', cylGeo(0.062, 0.055, 8, 'z'), acogRim, [0, 0.145, -0.29]);
    mesh(acog, 'acog-ocular', cylGeo(0.066, 0.065, 16, 'z'), acogBody, [0, 0.145, 0.09]);
    mesh(acog, 'acog-ocular-rim', torusGeo(0.057, 0.009, 6, 24), acogRim, [0, 0.145, 0.125]);
    mesh(acog, 'acog-prism-body', boxGeo(0.11, 0.07, 0.19), acogBody, [0, 0.125, -0.04]);
    mesh(acog, 'acog-elevation-turret', cylGeo(0.035, 0.035, 12, 'y'), acogBody, [0, 0.204, -0.045]);
    mesh(acog, 'acog-windage-turret', cylGeo(0.03, 0.035, 12, 'y'), acogBody, [0.063, 0.15, -0.045], [0, 0, Math.PI / 2]);
    mesh(acog, 'acog-mount-front', boxGeo(0.035, 0.085, 0.035), acogBody, [0, 0.087, -0.20]);
    mesh(acog, 'acog-mount-rear', boxGeo(0.035, 0.085, 0.035), acogBody, [0, 0.087, 0.04]);
    const holo = parts.holo = group(root, 'holo');
    holo.visible = false;
    mesh(holo, 'holo-base', boxGeo(0.15, 0.035, 0.22), holoBase, [0, 0.088, -0.10]);
    mesh(holo, 'holo-battery', boxGeo(0.12, 0.055, 0.10), holoBase, [0, 0.12, -0.22]);
    for (const side of [-1, 1]) mesh(holo, `holo-frame-${side}`, boxGeo(0.02, 0.12, 0.06), holoBody, [side * 0.065, 0.16, -0.08]);
    mesh(holo, 'holo-frame-top', boxGeo(0.15, 0.02, 0.06), holoBody, [0, 0.22, -0.08]);
    mesh(holo, 'holo-dot', sphereGeo(0.003, 6), unlitMat(new THREE.Color(OPTIC_COLOR.reticle).getHex()), [0, 0.145, -0.08]);
    hand(root, 'right-hand', [0.02, -0.15, 0.14], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.08, kind === 'r4c' ? -0.50 : -0.38], [-0.35, -0.9, 0.9]);
    muzzlePos = kind === 'r4c' ? [0, 0.02, -1.16] : [0, 0.015, -0.96]; ejectPos = [0.06, 0.02, 0.02];
  } else if (kind === 'pistol') {
    box(root, 'frame', [0.065, 0.12, 0.24], [0, 0, 0], DARK);
    parts.slide = remember(box(root, 'slide', [0.07, 0.075, 0.30], [0, 0.065, -0.10], PRIMARY));
    box(root, 'slide-serration-front', [0.075, 0.012, 0.04], [0, 0.09, -0.20], DARK);
    box(root, 'barrel', [0.035, 0.04, 0.24], [0, 0.055, -0.28], DARK);
    box(root, 'grip', [0.06, 0.22, 0.08], [0, -0.13, 0.10], DARK, [0.18, 0, 0]);
    parts.mag = remember(box(root, 'magazine', [0.045, 0.19, 0.065], [0, -0.12, 0.10], DARK, [0.18, 0, 0]));
    box(root, 'trigger-guard', [0.055, 0.035, 0.10], [0, -0.055, -0.02], DARK, [0.2, 0, 0]);
    box(root, 'trigger', [0.012, 0.04, 0.018], [0, -0.055, -0.015], PRIMARY, [0.2, 0, 0]);
    box(root, 'front-sight', [0.012, 0.025, 0.02], [0, 0.115, -0.27], SIGHT);
    box(root, 'rear-sight-left', [0.012, 0.022, 0.018], [-0.022, 0.108, 0.035], DARK);
    box(root, 'rear-sight-right', [0.012, 0.022, 0.018], [0.022, 0.108, 0.035], DARK);
    root.updateMatrixWorld(true);
    for (const name of ['slide-serration-front', 'front-sight', 'rear-sight-left', 'rear-sight-right']) {
      const part = root.getObjectByName(name);
      if (part) parts.slide.attach(part);
    }
    hand(root, 'right-hand', [0.02, -0.13, 0.12], [0.4, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.045, -0.16, 0.08], [-0.35, -0.8, 1]);
    muzzlePos = [0, 0.055, -0.42]; ejectPos = [0.05, 0.08, -0.08];
  } else if (kind === 'shotgun') {
    box(root, 'receiver', [0.09, 0.13, 0.42], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.021, 0.92, [0, 0.05, -0.62], DARK);
    cylinder(root, 'tube-magazine', 0.019, 0.72, [0, -0.02, -0.50], DARK);
    parts.foreEnd = remember(box(root, 'fore-end', [0.078, 0.085, 0.27], [0, 0.01, -0.46], DARK));
    box(root, 'stock', [0.07, 0.12, 0.34], [0, -0.04, 0.42], DARK, [0.08, 0, 0]);
    box(root, 'grip', [0.05, 0.13, 0.06], [0, -0.13, 0.16], DARK, [0.35, 0, 0]);
    sphere(root, 'front-bead', 0.013, [0, 0.095, -1.00], SIGHT, 6);
    box(root, 'rear-sight', [0.03, 0.025, 0.02], [0, 0.085, -0.02], DARK);
    hand(root, 'right-hand', [0.02, -0.16, 0.17], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.04, -0.06, -0.45], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.05, -1.09]; ejectPos = [0.06, 0.03, 0.05];
  } else if (kind === 'sniper') {
    box(root, 'receiver', [0.085, 0.115, 0.60], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.024, 1.25, [0, 0.02, -0.92], DARK);
    cylinder(root, 'muzzle-brake', 0.032, 0.16, [0, 0.02, -1.50], DARK);
    parts.mag = remember(box(root, 'magazine', [0.055, 0.16, 0.14], [0, -0.14, -0.06], DARK));
    box(root, 'stock', [0.075, 0.13, 0.44], [0, -0.02, 0.50], DARK, [0.04, 0, 0]);
    box(root, 'grip', [0.05, 0.14, 0.07], [0, -0.13, 0.20], DARK, [0.3, 0, 0]);
    box(root, 'cheek-riser', [0.06, 0.05, 0.16], [0, 0.07, 0.42], DARK);
    cylinder(root, 'scope-tube', 0.052, 0.56, [0, 0.135, -0.10], DARK);
    cylinder(root, 'objective-bell', 0.066, 0.07, [0, 0.135, -0.36], DARK);
    cylinder(root, 'ocular-bell', 0.062, 0.07, [0, 0.135, 0.14], DARK);
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

export function makeMeleeModel(): WeaponModel {
  const { root, bloodSmears } = model('melee');
  mesh(root, 'blade', boxGeo(0.012, 0.035, 0.42), charMat(0xcbdbe3), [0, 0, -0.25]);
  mesh(root, 'blade-tip', boxGeo(0.012, 0.02, 0.07), charMat(0xcbdbe3), [0, 0.007, -0.49], [0.3, 0, 0]);
  box(root, 'guard', [0.10, 0.07, 0.02], [0, 0, -0.04], DARK);
  box(root, 'textured-grip', [0.035, 0.042, 0.18], [0, 0, 0.07], DARK);
  for (let i = 0; i < 4; i++) box(root, `grip-ridge-${i}`, [0.041, 0.048, 0.018], [0, 0, 0.005 + i * 0.045], PRIMARY);
  hand(root, 'striking-right-hand', [0, -0.005, 0.01], [0.5, -0.5, 1]);
  const leftHand = hand(root, 'supporting-left-hand', [-0.05, -0.035, 0.12], [-0.4, -0.7, 1]);
  const muzzle = group(root, 'tip', [0, 0, -0.47]);
  const smears: [number, number, number, number][] = [[-0.15, 0.12, 0, 1], [-0.29, 0.11, 0.18, -1], [-0.42, 0.08, 0.40, 1], [-0.22, 0.10, 0.58, -1], [-0.10, 0.08, 0.74, 1], [-0.36, 0.09, 0.88, -1]];
  smears.forEach(([center, length, threshold, side], i) => {
    const bottom = -0.92 * 0.0168, top: Triple[] = [], vertices: number[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, u = -length / 2 + length * t;
      const taper = Math.sin(Math.PI * Math.min(1, 1.15 * t));
      const v = bottom + 1.84 * 0.0168 * (0.30 + 0.70 * taper * (0.55 + 0.45 * Math.abs(Math.sin(7 * t + 2.1 * i))));
      top.push([0, v, u]);
    }
    for (let k = 0; k < 12; k++) {
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

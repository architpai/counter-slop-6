import * as THREE from 'three';
import { TONE, TONE_HEX, toneMat, unlitMat, boxGeo, cylGeo, sphereGeo, torusGeo, starGeo } from '../render/index';

const PRIMARY = TONE.PRIMARY, DARK = TONE.DARK, SIGHT = TONE.HOSTILE;

function group(parent, name, position = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  parent?.add(node);
  return node;
}

function mesh(parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const node = new THREE.Mesh(geometry, material);
  node.name = name;
  node.position.set(...position);
  node.rotation.set(...rotation);
  node.renderOrder = 1000;
  node.castShadow = node.receiveShadow = false;
  parent.add(node);
  return node;
}

const box = (parent, name, size, pos, tone = PRIMARY, rot) =>
  mesh(parent, name, boxGeo(...size), toneMat(tone), pos, rot);
const cylinder = (parent, name, radius, length, pos, tone = PRIMARY, sides = 8) =>
  mesh(parent, name, cylGeo(radius, length, sides, 'z'), toneMat(tone), pos);
const sphere = (parent, name, radius, pos, tone = PRIMARY, segments = 8) =>
  mesh(parent, name, sphereGeo(radius, segments), toneMat(tone), pos);

function remember(node) {
  node.userData.restPos = node.position.clone();
  node.userData.restRot = node.rotation.clone();
  return node;
}

function hand(parent, name, pos, direction) {
  const node = group(parent, name, pos);
  sphere(node, `${name}-fist`, 0.062, [0, 0, 0]);
  const length = 0.42, dir = new THREE.Vector3(...direction).normalize();
  const geo = cylGeo(0.05, length, 7, 'y');
  const points = geo.attributes.position;
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

function twoSided(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = flat.attributes.position, vertices = [];
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

function flash(parent) {
  const node = group(parent, 'muzzle-flash');
  const material = unlitMat(TONE_HEX[TONE.ACCENT]);
  mesh(node, 'flash-star-front', twoSided(starGeo(7, 0.16, 0.06)), material);
  mesh(node, 'flash-star-side', twoSided(starGeo(5, 0.11, 0.04)), material, [0, 0, 0], [0, Math.PI / 2, 0]);
  mesh(node, 'flash-star-top', twoSided(starGeo(5, 0.10, 0.04)), material, [0, 0, 0], [Math.PI / 2, 0, 0]);
  node.visible = false;
  return node;
}

function model(name) {
  const root = group(null, `${name}-viewmodel`);
  root.scale.setScalar(0.46);
  root.visible = false;
  return { root, parts: {}, muzzle: null, eject: null, flash: null, bloodSmears: [] };
}

export function makeGunModel(kind) {
  if (!['rifle', 'shotgun', 'sniper', 'revolver'].includes(kind)) throw new RangeError(`Unknown gun kind: ${kind}`);
  const result = model(kind), { root, parts } = result;
  let muzzlePos, ejectPos;
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
    parts.leftHand = hand(root, 'left-hand', [-0.05, -0.08, -0.40], [-0.35, -0.9, 0.9]);
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
    parts.leftHand = hand(root, 'left-hand', [-0.04, -0.06, -0.45], [-0.35, -0.9, 0.9]);
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
    parts.leftHand = hand(root, 'left-hand', [-0.05, -0.09, -0.50], [-0.35, -0.9, 0.9]);
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
    parts.leftHand = hand(root, 'left-hand', [-0.05, -0.17, 0.02], [-0.4, -0.7, 1]);
    muzzlePos = [0, 0.035, -0.40]; ejectPos = [-0.05, 0.02, 0];
  }
  result.muzzle = group(root, 'muzzle', muzzlePos);
  result.eject = group(root, 'eject', ejectPos);
  result.flash = flash(result.muzzle);
  return result;
}

export function makeKatanaModel() {
  const result = model('katana'), { root, parts, bloodSmears } = result;
  box(root, 'blade', [0.012, 0.035, 1.00], [0, 0, -0.55]);
  box(root, 'blade-tip', [0.012, 0.02, 0.08], [0, 0.007, -1.07], PRIMARY, [0.3, 0, 0]);
  box(root, 'guard', [0.10, 0.10, 0.02], [0, 0, -0.05], DARK);
  box(root, 'handle-core', [0.03, 0.036, 0.30], [0, 0, 0.12], DARK);
  for (let i = 0; i < 6; i++) box(root, `handle-wrap-${i}`, [0.036, 0.04, 0.02], [0, 0, 0.02 + i * 0.045]);
  hand(root, 'front-hand', [0, -0.005, 0.05], [0.5, -0.5, 1]);
  parts.leftHand = hand(root, 'rear-hand', [0, -0.005, 0.20], [-0.4, -0.7, 1]);
  result.muzzle = group(root, 'tip', [0, 0, -1.05]);
  const smears = [[-0.34, 0.30, 0, 1], [-0.70, 0.26, 0.18, -1], [-0.95, 0.17, 0.40, 1], [-0.52, 0.22, 0.58, -1], [-0.20, 0.20, 0.74, 1], [-0.84, 0.20, 0.88, -1]];
  smears.forEach(([center, length, threshold, side], i) => {
    const bottom = -0.92 * 0.0168, top = [], vertices = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12, u = -length / 2 + length * t;
      const taper = Math.sin(Math.PI * Math.min(1, 1.15 * t));
      const v = bottom + 1.84 * 0.0168 * (0.30 + 0.70 * taper * (0.55 + 0.45 * Math.abs(Math.sin(7 * t + 2.1 * i))));
      top.push([0, v, u]);
    }
    for (let k = 0; k < 12; k++) {
      const a = [0, bottom, top[k][2]], b = [0, bottom, top[k + 1][2]];
      vertices.push(...a, ...top[k], ...top[k + 1], ...a, ...top[k + 1], ...b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const smear = mesh(root, `blood-smear-${i}`, twoSided(geometry), toneMat(SIGHT), [side * 0.0067, 0, center]);
    smear.userData.threshold = threshold;
    smear.visible = false;
    bloodSmears.push(smear);
  });
  return result;
}

import * as THREE from 'three';
import { rand } from '../util';
import { TONE, TONE_HEX, makeFigure, surfMat } from '../render/index';
import type { SurfKey } from '../render/palette';
import type { BreakableKind } from '../types';
import type { FigureParts } from '../render/figure';
import type { BuildOpts, LevelBuilder } from './build';

/**
 * Every part in `FigureParts` is optional because blobs and flyers have no
 * limbs. The mariachis are humanoids, so the joints they pose are all present.
 * Derived from the real type rather than re-declared, so a rename in
 * `render/figure` breaks here instead of drifting.
 */
type HumanoidJoints = Required<Pick<FigureParts,
  'head' | 'torso' | 'gunMount' | 'upperL' | 'upperR' | 'foreL' | 'foreR'>>;

type Point = readonly [number, number, number];
type Box6 = readonly [number, number, number, number, number, number];

const ORANGE: BuildOpts = { tone: TONE.ACCENT };
const DARK_VISUAL: BuildOpts = { tone: TONE.DARK, noCollide: true };
const HALF_PI = Math.PI / 2;

// Mexico retains the known defects listed in levels.md §7 until its release gate passes.
export function buildMexico(b: LevelBuilder) {
  b.level.key = 'mexico';
  b.level.playerStart.set(0, 0, 16);
  b.level.bounds = { minX: -62, maxX: 62, minZ: -62, maxZ: 62 };
  b.box(0, -1, 0, 134, 1, 134, { surface: 'ground' });
  b.collider(0, 62, 0, 164, 6, 164, { noNav: true, noGrapple: true });
  for (let i = -2; i <= 2; i++) {
    for (const [x, z, w, d] of [[24 * i, -62, 19, 8], [24 * i, 62, 19, 8],
      [-62, 24 * i, 8, 19], [62, 24 * i, 8, 19]] as const) {
      b.box(x, 0, z, w, 11, d);
      b.box(x + rand(-1.2, 1.2), 11, z + rand(-1.2, 1.2), 0.78 * w, 7, 0.78 * d);
      b.box(x + rand(-1, 1), 18, z + rand(-1, 1), 0.5 * w, 5, 0.5 * d);
    }
  }
  for (let i = -2; i <= 1; i++) {
    const q = 24 * i + 12;
    for (const [x, z] of [[q, -57], [q, 57], [-57, q], [57, q]] as const) b.marker('spawns', x, 0, z);
  }

  b.slab(-24, -24, 24, 24, 0.15, 0.15, { surface: 'ground' });
  b.cylinder(0, 0, 0, 5.5, 1.1);
  b.cylinder(0, 1.1, 0, 1.2, 2.6);
  b.cylinder(0, 3.7, 0, 2.4, 0.5);
  b.sphere(0, 5.4, 0, 0.7);
  b.cylinder(0, 1.06, 0, 5.1, 0.08, { noCollide: true, segments: 20, surface: 'water' });
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const geo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6).rotateZ(-0.35).rotateY(-a);
    b.mesh(geo, [1.7 * Math.cos(a), 5, 1.7 * Math.sin(a)], { surface: 'water' });
  }
  b.ring(0, 7.2, 0);
  b.cylinder(0, 13, 0, 8, 0.45, ORANGE);
  b.cylinder(0, 13.45, 0, 3.2, 3, ORANGE);
  b.cylinder(0, 13.65, 0, 3.3, 0.5, { noCollide: true, segments: 16, tone: TONE.BOSS });
  for (let k = 0; k < 6; k++) {
    const a = k * Math.PI / 3;
    b.ring(7.2 * Math.cos(a), 12.2, 7.2 * Math.sin(a));
  }
  b.ring(0, 17.5, 0);
  bandstand(b);
  church(b);
  houses(b);
  for (const [from, to, n] of [
    [[-34.5, 6.4, -20], [-8, 30.6, 42], 22],
    [[34.5, 7.4, -18], [8, 21.2, 42], 22],
    [[-34.5, 5.4, -4], [34.5, 5.9, 0], 26],
    [[-34.5, 7.9, 14], [34.5, 6.9, 16], 26],
  ] as const) banner(b, from, to, n);
  market(b);
  tacoCart(b);

  for (const [x, z, r] of [[-52, -46, 2.2], [52, 48, 2.6], [-52, 48, 1.8],
    [52, -48, 2], [0, -52, 1.6], [0, 52, 1.6]] as const) {
    b.sphere(x, 0.55 * r, z, r);
    b.collider(x, 0, z, 1.5 * r, 1.2 * r, 1.5 * r);
  }
  for (const [x, z, w, d] of [[-12, -12, 8, 0.5], [12, -12, 8, 0.5],
    [-30, 34, 0.5, 8], [30, 34, 0.5, 8]] as const) b.box(x, 0, z, w, 1.1, d, ORANGE);
  b.cylinder(-14, 0, 8, 1.3, 1);
  b.box(-14, 1, 8, 0.15, 2, 0.15, DARK_VISUAL);
  b.box(-14, 3, 8, 2.2, 0.3, 0.3, DARK_VISUAL);

  const snipers: readonly Point[] = [[-10, 30.6, 46], [10, 15, 46], [-40, 7.5, 14], [40, 7, -18],
    [0, 5.9, -26], [0, 13.45, 0]];
  for (const p of snipers) b.marker('snipers', ...p);
  const pickups: readonly Point[] = [[22, 0, 6.5], [26, 0, 6.5], [24, 0, 1.5], [0, 1.25, 8],
    [-20, 0, 0], [20, 0, -14], [0, 0, -36], [-40, 6, -20], [40, 5.5, 0],
    [0, 11, 44], [0, 13.5, 0], [-24, 0, 24], [24, 0, 24]];
  for (const p of pickups) b.marker('pickups', ...p);
  const arenaSpawns: readonly Point[] = [[-40, 6.2, -20], [40, 7.2, -18], [-40, 7.7, 14], [40, 6.7, 16],
    [0, 11.2, 44], [0, 5.6, -26], [-46, 0, 0], [46, 0, 0], [0, 0, -50],
    [-30, 0, 46], [30, 0, 46], [0, 13.6, 0], [-10, 30.8, 46]];
  for (const p of arenaSpawns) b.marker('arenaSpawns', ...p);

  b.sphere(70, 95, -150, 14, ORANGE);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    b.mesh(new THREE.BoxGeometry(7, 0.9, 0.9), [70 + 21 * Math.cos(a), 95 + 21 * Math.sin(a), -150],
      { ...ORANGE, rotation: new THREE.Euler(0, 0, a) });
  }
  for (const [x, z, w, h] of [[-120, -160, 60, 30], [40, -190, 90, 36],
    [150, -120, 70, 26], [-170, 60, 50, 24], [160, 90, 80, 30], [-60, 190, 100, 34]] as const) {
    b.box(x, 0, z, w, h, 30, { noCollide: true });
    b.box(x, h, z, 0.6 * w, 0.5 * h, 22, { noCollide: true });
  }
  b.planes(3, 30, 26, { scale: 1.4, radiusStep: 8, heightStep: 6, speed: 0.11 });
}

function bandstand(b: LevelBuilder) {
  b.cylinder(0, 0, -26, 6.5, 1.2);
  b.stairs(0, 0, -19.5, '-z', 4, 4.5, { rise: 0.3, run: 0.5 });
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8;
    b.cylinder(5.6 * Math.cos(a), 1.2, -26 + 5.6 * Math.sin(a), 0.22, 4.2,
      { ...ORANGE, noCollide: true });
  }
  b.mesh(new THREE.ConeGeometry(7.6, 3.2, 8), [0, 7, -26], ORANGE);
  b.cylinder(0, 5.4, -26, 7.6, 0.3, { segments: 8, noCollide: true });
  b.collider(0, 5.4, -26, 9, 0.5, 9, { noNav: true });
  b.ring(0, 9.4, -26);
  for (const [x, z, yaw, trumpet] of [[-2.6, -27.5, 0.4, false], [0, -28.5, 0, true],
    [2.6, -27.5, -0.4, false]] as const) {
    const figure = makeFigure({ kind: 'humanoid', color: TONE_HEX[TONE.DARK], scale: 1,
      hat: 'none', bodyWidth: 1.05, headSize: 1, limbR: 0.034, weapon: 'none' });
    const { root } = figure;
    const parts = figure.parts as HumanoidJoints;
    root.position.set(x, 1.2, z);
    root.rotation.y = yaw;
    parts.head.add(part(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 8), 0, 0.5, 0, 'accent'),
      part(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 8), 0, 0.66, 0, 'accent'),
      part(new THREE.TorusGeometry(0.24, 0.03, 6, 12).rotateX(HALF_PI), 0, 0.56, 0, 'boss'));
    if (trumpet) {
      parts.gunMount.add(
        part(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8).rotateX(HALF_PI), 0, 0.02, 0.25, 'accent'),
        part(new THREE.CylinderGeometry(0.14, 0.05, 0.16, 8).rotateX(HALF_PI), 0, 0.02, 0.55, 'accent'));
      parts.upperR.rotation.x = -1.6;
      parts.upperL.rotation.set(-1.5, 0.4, 0);
      parts.foreL.rotation.x = -0.4;
      parts.head.rotation.x = -0.25;
    } else {
      parts.gunMount.add(part(new THREE.BoxGeometry(0.34, 0.12, 0.5), 0, 0.02, 0.05, 'accent'),
        part(new THREE.BoxGeometry(0.06, 0.05, 0.7), 0, 0.06, 0.55, 'dark'));
      parts.upperR.rotation.x = -0.9;
      parts.upperL.rotation.set(-1, 0.5, 0);
      parts.foreL.rotation.x = -0.9;
    }
    b.addObject(root);
    b.level.animated.push({ mesh: root, update(t: number) {
      const s = Math.sin(6 * t + x);
      root.position.y = 1.2 + 0.08 * Math.max(0, s);
      parts.torso.rotation.z = 0.04 * s;
      if (trumpet) parts.head.rotation.z = 0.08 * Math.sin(4 * t + x);
      else parts.foreR.rotation.x = -0.5 + 0.25 * Math.sin(9 * t + x);
    } });
  }
}

function church(b: LevelBuilder) {
  const shell: readonly Box6[] = [[0, 0, 44, 24, 11, 16], [0, 11, 44, 24, 1.6, 4.5],
    [0, 12.6, 44, 3, 1.2, 3], [0, 13.8, 44, 0.3, 2.2, 0.3], [0, 15.2, 44, 1.4, 0.3, 0.3],
    [-10, 0, 46, 6, 26, 6], [-10, 30, 46, 7.2, 0.6, 7.2],
    [-10, 30.6, 46, 0.3, 3, 0.3], [-10, 32.4, 46, 1.6, 0.3, 0.3],
    [10, 0, 46, 6, 15, 6], [10, 20.8, 46, 0.3, 2, 0.3]];
  for (const box of shell) b.box(...box);
  b.slab(-7, 33.5, 7, 36.5, 0.8, 0.8);
  for (const x of [-3.2, 3.2]) b.box(x, 0, 35.8, 0.5, 5.4, 0.5, DARK_VISUAL);
  b.mesh(new THREE.TorusGeometry(3.2, 0.25, 6, 16, Math.PI), [0, 5.4, 35.8], { tone: TONE.DARK });
  for (const x of [-8, 8]) for (const y of [3, 7]) b.box(x, y, 35.9, 1.6, 2.2, 0.3, DARK_VISUAL);
  for (const x of [-12.5, -7.5]) for (const z of [43.5, 48.5]) b.box(x, 26, z, 0.6, 4, 0.6);
  b.sphere(-10, 28.2, 46, 0.95, ORANGE);
  b.ring(-10, 27.4, 42.2);
  b.ring(-10, 33.8, 46);
  for (const y of [8, 15, 21]) b.box(-10, y, 42.4, 6, 0.4, 1.3, ORANGE);
  for (const y of [11, 18, 24]) b.box(-13.6, y, 46, 1.3, 0.4, 6, ORANGE);
  b.sphere(10, 17.4, 46, 3.6, ORANGE);
  b.collider(10, 15, 46, 6, 5, 6, { noNav: true });
  b.ring(10, 21.6, 46);
  for (const y of [6, 11]) b.box(13.6, y, 46, 1.3, 0.4, 6, ORANGE);
}

function houses(b: LevelBuilder) {
  for (const [x, z, w, d, h, tone, side] of [
    [-40, -20, 11, 9, 6, TONE.HEAL, 1], [-40, -4, 9, 8, 5, TONE.BOSS, 1],
    [-40, 14, 12, 10, 7.5, TONE.ACCENT, 1], [40, -18, 12, 9, 7, TONE.BOSS, -1],
    [40, 0, 9, 8, 5.5, TONE.HEAL, -1], [40, 16, 11, 10, 6.5, TONE.ACCENT, -1],
  ] as const) {
    b.box(x, 0, z, w, h, d);
    b.box(x, h, z, w + 0.6, 0.35, d + 0.6, ORANGE);
    b.rail(x - w / 2, z - d / 2, x + w / 2, z - d / 2, h + 0.35, ORANGE);
    const doorX = x + side * (w / 2 + 0.01);
    b.box(doorX, 0, z, 0.15, 2.6, 1.4, { tone, noCollide: true });
    b.box(doorX, 2.6, z, 0.15, 0.3, 1.8, DARK_VISUAL);
    for (const s of [-1, 1]) b.box(doorX, 1.6, z + s * 0.32 * d, 0.12, 1.1, 1.1, DARK_VISUAL);
    const n = Math.round(h / 0.3);
    b.stairs(x - side * (w / 2 + 0.3), 0, z + d / 2 + 0.9, side > 0 ? '+x' : '-x', n, 1.6,
      { rise: h / n, run: 0.42 });
    b.box(x, h + 0.35, z + d / 2 - 1.2, 2.2, 0.9, 1.4, ORANGE);
    b.ring(x, h + 3.2, z);
  }
}

function banner(b: LevelBuilder, from: Point, to: Point, n: number) {
  const dx = (to[0] - from[0]) / n;
  const dz = (to[2] - from[2]) / n;
  const rotation = new THREE.Euler(0, -Math.atan2(dz, dx), 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = from[0] + dx * i, z = from[2] + dz * i;
    const y = from[1] + (to[1] - from[1]) * t - 1.2 * Math.sin(Math.PI * t);
    if (i < n) b.mesh(new THREE.BoxGeometry(Math.hypot(dx, dz) + 0.05, 0.05, 0.05),
      [x + dx / 2, y, z + dz / 2], { tone: TONE.DARK, rotation });
    if (i % 2) b.mesh(new THREE.BoxGeometry(0.7, 0.55, 0.02), [x, y - 0.32, z],
      { tone: [TONE.BOSS, TONE.HEAL, TONE.ACCENT][i % 3], rotation });
    if (i === Math.floor(n / 2)) b.ring(x, y - 1.2, z);
  }
}

function market(b: LevelBuilder) {
  for (const [x, z, w, d] of [[-20, 22, 4.5, 2.4], [-13, 22, 4.5, 2.4],
    [20, 22, 4.5, 2.4], [13, 22, 4.5, 2.4], [-24, -12, 2.4, 4.5], [26, -8, 2.4, 4.5]] as const) {
    b.box(x, 0, z, w, 0.9, d, { surface: 'wood' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      b.box(x + sx * (w / 2 - 0.15), 0, z + sz * (d / 2 - 0.15), 0.14, 2.9, 0.14, DARK_VISUAL);
    for (let i = 0; i < 5; i++) b.box(x, 2.92, z - (d + 0.6) / 2 + (i + 0.5) * (d + 0.6) / 5,
      w + 0.6, 0.06, (d + 0.6) / 5, { tone: i % 2 ? TONE.BOSS : TONE.ACCENT, noCollide: true });
    b.collider(x, 2.9, z, w + 0.6, 0.12, d + 0.6, { noNav: true });
  }
  for (const [x, y, z] of [[-20, 1.3, 22], [13, 1.3, 22], [-24, 1.3, -12], [26, 1.3, -8],
    [0, 6.4, 8], [-9, 9.5, 12], [9, 9.5, 12]] as const) prop(b, 'pinata', x, y, z);
  for (const [x, z] of [[-17.5, 24.5], [-9.5, 24.5], [16.5, 24.5], [23.5, 24.5],
    [-27.5, -9], [-27.5, -15], [29, -5], [29, -11]] as const) prop(b, 'crate', x, 0, z);
  for (const [x, z] of [[-33, -14], [-33, -12.6], [-33, -6], [-33, 10], [-33, 20], [33, -12],
    [33, -3], [33, 6], [33, 22], [-6, 30], [6, 30], [-18, 31], [18, 31], [-3, -33], [3, -33]] as const)
    prop(b, rand() < 0.3 ? 'potL' : 'potS', x, 0, z);
  for (const [x, z] of [[-18, -30], [18, -30], [-30, 30], [30, 30]] as const) prop(b, 'barrel', x, 0, z);
  for (const [x, z, h] of [[-46, -40, 2.8], [-50, -28, 2.2], [-48, 30, 3], [-44, 44, 2.4],
    [46, -44, 2.6], [50, -30, 2.2], [48, 34, 3.2], [44, 46, 2.5], [-30, -48, 2.8],
    [30, -48, 2.4], [-28, 48, 2.6], [28, 50, 2.9], [12, -44, 2.2], [-12, -44, 2.6]] as const)
    prop(b, 'cactus', x, 0, z, h);
}

// ponytail: only the cactus branch reads `height`, and only cactus callers pass it. The `= 0`
// is a type floor for the other kinds, not a real default.
function prop(b: LevelBuilder, kind: BreakableKind, x: number, y: number, z: number, height = 0) {
  const parts: THREE.Mesh[] = [];
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, surface: SurfKey) =>
    parts.push(part(new THREE.BoxGeometry(w, h, d), px, py, pz, surface));
  const cylinder = (rt: number, rb: number, h: number, px: number, py: number, pz: number,
    surface: SurfKey, seg = 8, rotZ = 0) =>
    parts.push(part(new THREE.CylinderGeometry(rt, rb, h, seg).rotateZ(rotZ), px, py, pz, surface));
  const torus = (r: number, tube: number, py: number, surface: SurfKey) =>
    parts.push(part(new THREE.TorusGeometry(r, tube, 6, 12).rotateX(HALF_PI), 0, py, 0, surface));
  let w: number, h: number, d: number, hp = 1, tone: number = TONE.ACCENT;
  if (kind === 'potS' || kind === 'potL') {
    const big = kind === 'potL';
    const radius = big ? 0.55 : 0.4, visualH = big ? 1.2 : 0.85;
    w = d = big ? 1.2 : 0.9;
    h = big ? 1.3 : 0.9;
    cylinder(0.75 * radius, radius, visualH, 0, visualH / 2, 0, 'accent', 9);
    torus(big ? 0.396 : 0.288, 0.05, visualH, 'dark');
    torus(big ? 0.539 : 0.392, 0.04, big ? 0.54 : 0.38, 'boss');
  } else if (kind === 'crate') {
    w = h = d = 1.1; hp = 30; tone = TONE.PRIMARY;
    box(1.1, 1.1, 1.1, 0, 0.55, 0, 'block');
    for (const py of [0.2, 0.9]) box(1.14, 0.12, 0.12, 0, py, 0.56, 'dark');
  } else if (kind === 'barrel') {
    w = d = 1.1; h = 1.2; hp = 30;
    cylinder(0.5, 0.45, 1.2, 0, 0.6, 0, 'accent', 10);
    for (const py of [0.25, 0.95]) torus(0.5, 0.04, py, 'dark');
  } else if (kind === 'cactus') {
    w = d = 0.9; h = height; hp = 40; tone = TONE.HEAL;
    cylinder(0.28, 0.34, h, 0, h / 2, 0, 'foliage');
    cylinder(0.16, 0.18, 0.9, 0.6, 0.55 * h, 0, 'foliage');
    cylinder(0.17, 0.17, 0.7, 0.35, 0.38 * h, 0, 'foliage', 8, HALF_PI);
    cylinder(0.14, 0.16, 0.7, -0.55, 0.7 * h, 0, 'foliage');
    cylinder(0.15, 0.15, 0.6, -0.3, 0.55 * h, 0, 'foliage', 8, HALF_PI);
    parts.push(part(new THREE.SphereGeometry(0.16, 8, 6), 0, h + 0.05, 0, 'boss'));
  } else {
    w = 1.1; h = 0.9; d = 0.6; tone = TONE.BOSS;
    box(0.9, 0.5, 0.45, 0, 0.55, 0, 'boss');
    for (const px of [-0.3, 0, 0.3]) box(0.1, 0.52, 0.47, px, 0.55, 0, px === 0 ? 'accent' : 'foliage');
    box(0.34, 0.3, 0.3, 0.6, 0.72, 0, 'boss');
    for (const pz of [-0.1, 0.1]) box(0.1, 0.22, 0.08, 0.62, 0.95, pz, 'accent');
    for (const px of [-0.3, 0.3]) for (const pz of [-0.15, 0.15]) box(0.12, 0.34, 0.12, px, 0.15, pz, 'boss');
    box(0.03, 2.2, 0.03, 0, 1.85, 0, 'dark');
  }
  b.breakable(kind, x, y, z, w, h, d, parts, { hp, tone });
}

function part(geometry: THREE.BufferGeometry, x: number, y: number, z: number, surface: SurfKey) {
  const mesh = new THREE.Mesh(geometry, surfMat(surface));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function tacoCart(b: LevelBuilder) {
  b.box(24, 0, 4, 3.2, 1.3, 1.6, ORANGE);
  b.box(24, 1.3, 4, 3.4, 0.9, 1.8);
  for (const x of [22.5, 25.5]) b.box(x, 0, 4, 0.14, 3.6, 0.14, DARK_VISUAL);
  for (let i = 0; i < 4; i++) b.box(24, 3.59, 3 + 0.55 * i, 3.6, 0.06, 0.55,
    { noCollide: true, tone: i % 2 ? TONE.HEAL : TONE.ACCENT });
  for (const x of [23.1, 24.9]) b.mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 8).rotateZ(HALF_PI),
    [x, 0.34, 3.1], { tone: TONE.DARK });
  b.mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 12, 1, false, -HALF_PI, Math.PI).rotateX(HALF_PI),
    [24, 4.6, 4], ORANGE);
  b.box(24, 4.55, 4, 1.3, 0.14, 0.3, { noCollide: true, tone: TONE.HEAL });
  b.box(24, 4.71, 4, 1.1, 0.1, 0.2, DARK_VISUAL);
}

import * as THREE from 'three';
import { SURF, TONE, boxGeo, cylGeo, coneGeo, torusGeo, unlitMat } from '../render/index';
import type { BuildOpts, LevelBuilder, MarkerKind } from './build';
import type { SurfKey } from '../render/palette';

type Point = readonly [number, number, number];
type Segment = readonly [number, number, number, number];
type Rect = readonly [number, number, number, number];
type Box6 = readonly [number, number, number, number, number, number];

const visual: BuildOpts = { noCollide: true };
const dark: BuildOpts = { mat: 'dark', noCollide: true };
const concrete: BuildOpts = { mat: 'blockAlt' };
const deep: BuildOpts = { mat: 'blockDeep' };
const metal: BuildOpts = { mat: 'metal' };
const wood: BuildOpts = { mat: 'wood' };
const road: BuildOpts = { mat: 'road', noCollide: true };

function markers(b: LevelBuilder, kind: MarkerKind, points: readonly Point[]) {
  for (const point of points) b.marker(kind, ...point);
}

function rails(b: LevelBuilder, y: number, segments: readonly Segment[], opts?: BuildOpts) {
  for (const segment of segments) b.rail(...segment, y, opts);
}

export function buildDowntown(b: LevelBuilder) {
  const arena = b.level.arena, p = arena ? 68 : 55, ph = arena ? 30 : 18;
  const e = p - 3.8, d = p - 3;
  b.box(0, -1, 0, 2 * p + 6, 1, 2 * p + 6, { mat: 'ground' });
  for (const sign of [-1, 1]) {
    b.box(0, 0, sign * p, 2 * p + 6, ph, 6, concrete);
    b.box(sign * p, 0, 0, 6, ph, 2 * p + 6, concrete);
  }
  buildStreets(b, p);
  for (const [x, z, w, depth] of [
    [-30, -e, 8, 1.6], [30, -e, 8, 1.6], [-e, 40, 1.6, 8], [e, -10, 1.6, 8],
    [-e, -30, 1.6, 6], [e, 35, 1.6, 6], [10, e, 8, 1.6], [-40, e, 6, 1.6],
  ] as const) {
    for (const y of arena ? [9, 5.5, 16] : [9, 5.5]) b.box(x, y, z, w, 0.4, depth, metal);
    if (arena) b.ring(x, 20, z);
  }
  for (const [x, z] of [[-d, 0], [d, 0], [-d, 30], [d, -30], [-d, -30], [d, 30]] as const) {
    b.box(x, 0, z - 1.2, 0.5, 3.2, 0.3, dark);
    b.box(x, 0, z + 1.2, 0.5, 3.2, 0.3, dark);
    b.box(x, 3, z, 0.5, 0.3, 2.7, dark);
    b.marker('spawns', x - Math.sign(x) * 1.2, 0, z);
  }
  for (const [x, z] of [[0, -d], [0, d], [-30, d], [30, d]] as const) {
    b.box(x - 1.2, 0, z, 0.3, 3.2, 0.5, dark);
    b.box(x + 1.2, 0, z, 0.3, 3.2, 0.5, dark);
    b.box(x, 3, z, 2.7, 0.3, 0.5, dark);
    b.marker('spawns', x, 0, z - Math.sign(z) * 1.2);
  }
  if (arena) buildArena(b);
  else buildTower(b);
  buildA(b);
  buildB(b);
  buildHighway(b);
  buildHouses(b);
  if (!arena) buildPlaza(b);
  buildSky(b);
  if (!arena) b.planes(3, 30, 30, { scale: 1.4, radiusStep: 8, heightStep: 6, speed: 0.11 });
  b.level.teamSpawns = ([
    [[-40, 0, 18], [-34, 12, 12], [-48, 7, -30], [-52, 0, 30], [-30, 7, -48]],
    [[40, 0, 8], [34, 12, 18], [48, 7, -30], [52, 0, 30], [16, 7, -45]],
  ] as const).map(team => team.map(point => new THREE.Vector3(...point)));
}

function buildArena(b: LevelBuilder) {
  markers(b, 'arenaSpawns', [
    [-34, 12.2, 12], [34, 12.2, 12], [-30, 7.2, -45], [16, 7.2, -45], [0, 7.4, -30],
    [-44, 0, -10], [44, 0, -10], [-40, 0, 40], [40, 0, 40], [0, 0, 55],
    [-58, 0, 0], [58, 0, 0], [0, 0, -58], [-54, 0, 54], [54, 0, -54],
  ]);
  const blocks: readonly Box6[] = [[-8, 0, 20, 3, 1, 1.2], [10, 0, 26, 1.4, 1.2, 1.4],
    [-12, 0, -8, 2.4, 0.8, 2.4], [14, 0, -4, 2.4, 0.8, 2.4]];
  for (const values of blocks) b.box(...values);
  for (const [x, z] of [[-56, 30], [56, -30], [30, -56], [-30, 56]] as const) {
    b.box(x, 0, z, 0.3, 7, 0.3, { noNav: true });
    b.box(x, 7, z, 1.4, 0.3, 0.3, visual);
    b.sphere(x + 0.7, 6.8, z, 0.45, { tone: TONE.ACCENT });
  }
  for (let k = 0; k < 8; k++) {
    const geo = new THREE.TorusGeometry(120, 0.6, 6, 80, Math.PI);
    b.mesh(geo, [0, -30, 0], { rotation: new THREE.Euler(0, k * Math.PI / 8, 0) });
  }
  for (const y of [38, 54, 68, 80, 88]) {
    const radius = Math.sqrt(120 ** 2 - (y + 30) ** 2);
    b.mesh(torusGeo(radius, 0.5, 6, 80), [0, y, 0],
      { rotation: new THREE.Euler(Math.PI / 2, 0, 0) });
  }
  b.sphere(0, 90, 0, 2.4, { tone: TONE.HOSTILE });
  const shell: BuildOpts = { noNav: true, noGrapple: true };
  b.collider(0, 88, 0, 300, 10, 300, shell);
  for (let y = 30; y < 88; y += 4) {
    const radius = Math.sqrt(Math.max(0, 120 ** 2 - (y + 34) ** 2));
    if (radius > 74) continue;
    const o = radius + 80;
    b.collider(0, y, -o, 320, 4, 160, shell);
    b.collider(0, y, o, 320, 4, 160, shell);
    b.collider(-o, y, 0, 160, 4, 320, shell);
    b.collider(o, y, 0, 160, 4, 320, shell);
  }
  for (const [x, y, z, size] of [[0, 24, 0, 8], [-42, 18, -24, 6], [44, 21, 30, 6],
    [28, 27, -46, 5], [-30, 30, 44, 5]] as const) {
    b.box(x, y, z, size, 0.5, size, { noNav: true });
    const domeY = Math.sqrt(Math.max(1, 120 ** 2 - x * x - z * z)) - 30;
    b.box(x, y + 0.5, z, 0.12, Math.max(1, domeY - y - 0.5), 0.12, dark);
    b.ring(x, y - 1.3, z);
  }
  b.planes(4, 30, 26, { scale: 1.7, radiusStep: 9, heightStep: 6, speed: 0.11 });
}

/** Asphalt under the highway and two avenues flanking the tower, with lane dashes. */
function buildStreets(b: LevelBuilder, p: number) {
  const edge = p - 3;
  b.box(0, 0, -30, 2 * edge, 0.04, 10, road);
  const paint: BuildOpts = { mat: 'paving', noCollide: true };
  for (const x of [-16, 16]) {
    b.box(x, 0, -2, 6, 0.04, 2 * edge, road);
    for (const side of [-1, 1]) b.box(x + side * 2.8, 0.04, -2, 0.12, 0.01, 2 * edge, paint);
    for (let z = -edge + 2; z < edge; z += 4) b.box(x, 0.04, z, 0.16, 0.02, 2, paint);
  }
  for (let x = -edge + 2; x < edge; x += 4) {
    if (Math.abs(x + 16) < 4 || Math.abs(x - 16) < 4) continue;
    b.box(x, 0.04, -30, 2, 0.02, 0.16, paint);
  }
  // Broad paving joints give the courtyard scale without adding collision or props.
  b.box(0, 0, 30, 24, 0.012, 40, { mat: 'block', noCollide: true });
  const joints: BuildOpts = { mat: 'ground', noCollide: true };
  for (let z = 10; z <= 50; z += 4) b.box(0, 0.012, z, 24, 0.005, 0.025, joints);
  for (let x = -12; x <= 12; x += 4) b.box(x, 0.012, 30, 0.025, 0.005, 40, joints);
  for (const x of [-16, 16]) for (let z = 30; z <= 34; z += 0.8) b.box(x, 0.045, z, 5.4, 0.01, 0.35, paint);
}

function buildTower(b: LevelBuilder) {
  for (const top of [4, 8, 12, 16]) {
    b.slab(-7, -7, 7, 7, top, 0.4, concrete);
    b.box(0, top - 0.18, 7.015, 14, 0.12, 0.03, { mat: 'metal', noCollide: true });
  }
  for (const [x, z] of [[-6.6, -6.6], [6.6, -6.6], [-6.6, 6.6], [6.6, 6.6],
    [0, -6.6], [0, 6.6], [-6.6, 0], [6.6, 0]] as const) b.box(x, 0, z, 0.8, 16, 0.8, deep);
  for (const x of [-6.6, 0, 6.6]) {
    b.box(x, 0.35, 7.01, 0.65, 1.3, 0.025, { mat: 'accent', noCollide: true });
    b.box(x, 0.8, 7.025, 0.65, 0.18, 0.025, dark);
  }
  for (const y of [4, 8, 12]) rails(b, y, [
    [-7, 7, -1.5, 7], [1.5, 7, 7, 7], [-7, -7, -7, y === 12 ? 4.6 : 7],
    [-7, -7, -6.5, -7], [-4.7, -7, 1.3, -7], [3.5, -7, 7, -7],
    [7, -7, 7, y === 12 ? 4.6 : 7],
  ]);
  rails(b, 16, [[-5, -7, 7, -7], [-7, 7, -1.5, 7], [1.5, 7, 7, 7],
    [-7, -7, -7, 7], [7, -7, 7, 3]]);
  b.box(5.5, 16, 5.5, 1, 10, 1, deep);
  b.box(5.5, 25.2, 5.5, 1.6, 1.4, 1.6, { mat: 'accent', noCollide: true });
  b.box(11.5, 25, 5.5, 16, 0.8, 0.8, metal);
  b.box(1, 25, 5.5, 5, 0.8, 0.8, metal);
  b.box(-0.5, 23.6, 5.5, 2, 1.6, 1.6, deep);
  b.box(19, 20.5, 5.5, 0.08, 4.6, 0.08, dark);
  b.ring(19, 19.8, 5.5, 'x');
  b.ring(19.5, 24.6, 5.5, 'z');
  for (let i = 0; i < 4; i++) {
    const even = i % 2 === 0, y = i * 4;
    b.stairs(even ? -5 : 1.3, y, even ? -8.3 : -10.3, even ? '+x' : '-x', 14, 1.8, concrete);
    const [x1, x2]: [number, number] = even ? [1.3, 3.5] : [-7.2, -5];
    b.slab(x1, -11.4, x2, -7, y + 4, 0.4, concrete);
    b.rail(x1, -11.4, x2, -11.4, y + 4);
  }
  markers(b, 'spawns', [[0, 8, 0], [0, 4, 3]]);
  markers(b, 'snipers', [[0, 16, -3]]);
  markers(b, 'pickups', [[0, 12, 0], [-4, 8, 4], [0, 16, 0]]);
}

function buildA(b: LevelBuilder) {
  for (const y of [4, 8, 12]) b.slab(-43, 4, -25, 20, y, 0.4, concrete);
  b.wall('z', 4, 20, -25, 0, 12, 0.4, [[10, 13, 0, 3.2], [6, 9, 5, 7],
    [14, 17, 5, 7], [6, 9, 9, 11], [14, 17, 9, 11]]);
  b.wall('z', 4, 20, -43, 0, 12, 0.4, [[8, 11, 0, 3.2], [8, 11, 4.5, 7.5], [8, 11, 8.5, 11.5]]);
  b.wall('x', -43, -25, 4, 0, 12, 0.4, [[-36, -33, 0, 3.2], [-40, -37, 5, 7],
    [-31, -28, 5, 7], [-36, -32, 8.5, 11.5]]);
  b.wall('x', -43, -25, 20, 0, 12, 0.4, [[-36, -32, 0, 3.2], [-31, -27, 0, 3.2],
    [-42, -39, 0, 3.2], [-37.2, -33.5, 4.05, 7.2], [-36, -32, 8.4, 11.4],
    [-41, -27, 4.6, 7.6], [-29, -25.5, 8.05, 11.2]]);
  b.wall('x', -43, -25, 12, 0, 4, 0.3, [[-40, -37.5], [-30, -27.5]]);
  b.wall('x', -43, -25, 12, 4, 4, 0.3, [[-36, -32]]);
  b.wall('z', 4, 20, -34, 8, 4, 0.3, [[8, 11], [14, 17]]);
  rails(b, 12, [[-43, 4, -37, 4], [-31, 4, -25, 4], [-43, 20, -37.4, 20],
    [-34.4, 20, -25, 20], [-43, 4, -43, 20], [-25, 4, -25, 4.6], [-25, 7.4, -25, 9], [-25, 15, -25, 20]]);
  for (let i = 0; i < 3; i++) {
    const even = i % 2 === 0, y = i * 4;
    b.stairs(even ? -28.5 : -34.8, y, even ? 21.2 : 23.2, even ? '-x' : '+x', 14, 1.8, metal);
    const [x1, x2]: [number, number] = even ? [-37, -34.8] : [-28.5, -26.3];
    b.slab(x1, 20.2, x2, 24.4, y + 4, 0.4, metal);
    b.rail(x1, 24.4, x2, 24.4, y + 4);
  }
  const end = b.level.arena ? 24.2 : -7, length = end + 25.2;
  b.slab(-25.2, 4.8, end, 7.2, 12, 0.4, { mat: 'accent' });
  for (let i = 0; i <= Math.floor(length); i++) {
    b.box(-25 + i, 12, 5, 0.06, 0.02, i % 5 === 0 ? 0.6 : 0.35, dark);
  }
  b.rail(-25, 7.2, end, 7.2, 12, { mat: 'accent' });
  if (b.level.arena) b.rail(-25, 4.8, end, 4.8, 12, { mat: 'accent' });
  for (const y of [3.8, 7.8, 11.8]) b.box(-34, y, 20.22, 18, 0.16, 0.04, { mat: 'metal', noCollide: true });
  markers(b, 'spawns', [[-34, 12, 12], [-40, 0, 18]]);
  markers(b, 'snipers', [[-27, 12, 6]]);
  markers(b, 'pickups', [[-34, 4, 12], [-30, 12, 16], [-40, 8, 8]]);
}

function buildB(b: LevelBuilder) {
  const floors: readonly Rect[] = [[24, 4, 44, 9], [24, 15, 44, 20], [24, 9, 31, 15], [37, 9, 44, 15]];
  for (const rectangle of floors) {
    b.slab(...rectangle, 12, 0.4, { mat: 'roof' });
  }
  b.wall('z', 4, 20, 24, 0, 12, 0.4, [[10, 14, 0, 3.6], [6, 9, 7, 10], [15, 18, 7, 10]], concrete);
  b.wall('z', 4, 20, 44, 0, 12, 0.4, [[7, 10, 0, 3.2], [14, 17, 0, 3.2], [8, 16, 7, 10]], concrete);
  b.wall('x', 24, 44, 4, 0, 12, 0.4, [[32, 36, 0, 3.6], [27, 30, 7, 10], [38, 41, 7, 10]], concrete);
  b.wall('x', 24, 44, 20, 0, 12, 0.4, [[26, 29, 0, 3.2], [39, 42, 0, 3.2],
    [33.5, 36.5, 4.05, 7.2], [25.5, 28.5, 8.05, 11.2], [32, 36, 8, 11]], concrete);
  const ledges: readonly Rect[] = [[24.4, 4.4, 26, 19.6], [42, 4.4, 43.6, 19.6],
    [26, 4.4, 42, 6], [26, 18, 42, 19.6]];
  for (const rectangle of ledges) b.slab(...rectangle, 6, 0.3, metal);
  rails(b, 6, [[26, 6, 26, 9], [26, 15, 26, 17], [42, 6, 42, 18],
    [26, 6, 31, 6], [37, 6, 42, 6], [28.2, 18, 42, 18]]);
  b.stairs(27.2, 0, 8.6, '+z', 21, 1.6, { rise: 6 / 21, mat: 'metal' });
  b.box(34, 0, 12, 2.4, 2.4, 2.4, wood);
  b.box(36.4, 0, 12, 2.4, 1.2, 2.4, wood);
  b.box(30, 0, 16, 1.6, 1.6, 1.6, { tone: TONE.HEAL });
  for (let i = 0; i < 3; i++) {
    const even = i % 2 === 0, y = i * 4;
    b.stairs(even ? 27.5 : 33.8, y, even ? 21.2 : 23.2, even ? '+x' : '-x', 14, 1.8, metal);
    const [x1, x2]: [number, number] = even ? [33.8, 36] : [25.3, 27.5];
    b.slab(x1, 20.2, x2, 24.4, y + 4, 0.4, metal);
    b.rail(x1, 24.4, x2, 24.4, y + 4);
  }
  rails(b, 12, [[24, 4, 31, 4], [37, 4, 44, 4], [24, 20, 33.4, 20],
    [36.4, 20, 44, 20], [44, 4, 44, 20], [24, 4, 24, 4.6], [24, 7.4, 24, 9], [24, 15, 24, 20]]);
  b.box(15.5, 11.6, 6, 17.4, 0.4, 2.2, metal);
  b.rail(7, 4.9, 24, 4.9, 12);
  for (const y of [3.8, 11.8]) b.box(34, y, 20.22, 20, 0.16, 0.04, { mat: 'block', noCollide: true });
  markers(b, 'spawns', [[34, 12, 18], [40, 0, 8]]);
  markers(b, 'snipers', [[26, 12, 18]]);
  markers(b, 'pickups', [[34, 2.4, 12], [34, 6, 19], [42, 12, 6]]);
}

function buildHighway(b: LevelBuilder) {
  b.slab(-52, -34.5, 52, -25.5, 7, 0.6, { mat: 'road' });
  b.wall('x', -52, 52, -34.3, 7, 0.9, 0.4, [[-33, -29], [27, 31], [-2, 2]], concrete);
  b.wall('x', -52, 52, -25.7, 7, 0.9, 0.4, [[-36.5, -33], [33, 36.5]], concrete);
  for (let x = -48; x <= 48; x += 12) b.box(x, 0, -30, 1.4, 6.4, 1.4, concrete);
  b.stairs(-46.5, 0, -24.5, '+x', 25, 2, { rise: 0.28, mat: 'road' });
  b.stairs(46.5, 0, -24.5, '-x', 25, 2, { rise: 0.28, mat: 'road' });
  // Flat turning landings connect the final tread to the highway barrier openings.
  b.slab(-35.25, -25.5, -33, -23.5, 7, 0.4, concrete);
  b.slab(33, -25.5, 35.25, -23.5, 7, 0.4, concrete);
  b.rail(-35.25, -23.5, -33, -23.5, 7);
  b.rail(33, -23.5, 35.25, -23.5, 7);
  for (let x = -49; x <= 47; x += 4) b.box(x, 7, -30, 2, 0.02, 0.2, dark);
  markers(b, 'spawns', [[-48, 7, -30], [48, 7, -30]]);
  markers(b, 'snipers', [[0, 7, -30]]);
  markers(b, 'pickups', [[-10, 7, -30], [24, 7, -30]]);
}

function buildHouses(b: LevelBuilder) {
  for (const [x, h, mat] of [[-30, 7, 'wood'], [-8, 11, 'blockAlt'], [16, 7, 'roof']] as const) {
    b.box(x, 0, -45, 14, h, 10, { mat });
  }
  for (const x of [-31, 29, 0]) b.box(x, 6.7, -37.25, 2.6, 0.3, 5.5, metal);
  for (const x of [-32.3, -29.7, 27.7, 30.3]) b.rail(x, -40, x, -34.5, 7);
  b.stairs(-23, 7, -45, '+x', 14, 2.2, metal);
  b.slab(-16.9, -46.1, -15, -43.9, 11, 0.4, metal);
  b.stairs(9, 7, -45, '-x', 14, 2.2, metal);
  b.slab(-1, -46.1, 2.9, -43.9, 11, 0.4, metal);
  b.box(-33, 7, -48, 1.2, 1.6, 1.2, wood);
  b.box(19, 7, -42, 1.2, 1.4, 1.2, wood);
  b.cylinder(-10, 11, -47.5, 1.4, 2.6, { segments: 14, mat: 'metal' });
  b.box(-5, 11, -42, 0.1, 4, 0.1, dark);
  markers(b, 'spawns', [[-8, 11, -45], [-30, 7, -48], [16, 7, -45]]);
  markers(b, 'snipers', [[-8, 11, -48], [16, 7, -43]]);
  markers(b, 'pickups', [[-8, 11, -43], [-30, 7, -45]]);
}

function buildPlaza(b: LevelBuilder) {
  const props: readonly (readonly [Box6, SurfKey | number])[] = [
    [[-14, 0, 34, 2.5, 2.6, 6.2], TONE.HEAL], [[-14, 2.6, 34, 2.5, 2.6, 6.2], TONE.ACCENT],
    [[14, 0, 36, 6.2, 2.6, 2.5], TONE.PRIMARY], [[17, 2.6, 36, 3, 2.6, 2.5], TONE.HEAL],
    [[-6, 0, 28, 1.4, 1.4, 1.4], 'wood'], [[-4.5, 0, 28.5, 1.2, 1.2, 1.2], 'wood'],
    [[-5.3, 1.4, 28.2, 1, 1, 1], 'wood'], [[8, 0, 26, 1.6, 1.6, 1.6], 'wood'],
    [[9.6, 0, 26.4, 1.2, 1.2, 1.2], 'wood'],
    [[24, 0.6, 40, 11, 3.2, 2.8], 'blockAlt'], [[38, 0, 40, 6, 2.2, 3.2], TONE.BOSS],
    [[38, 2.2, 40, 6, 0.8, 3.2], 'dark'],
  ];
  for (const [values, look] of props) {
    b.box(...values, typeof look === 'string' ? { mat: look } : { tone: look });
  }
  b.box(24, 0, 40, 10, 0.6, 2.6, { ...visual, mat: 'dark' });
  for (const x of [20, 28]) for (const z of [41.5, 38.5]) {
    b.cylinder(x, 0, z, 0.55, 0.4, { ...dark, segments: 10 });
  }
  b.mesh(cylGeo(0.8, 16, 6, 'x'), [-30, 0.8, 44], { tone: TONE.ACCENT });
  b.collider(-30, 0, 44, 16, 1.6, 1.6);
  const tip = coneGeo(0.8, 2.4, 6);
  tip.rotateZ(-Math.PI / 2);
  b.mesh(tip, [-20.8, 0.8, 44], { mat: 'dark' });
  b.collider(-20.8, 0, 44, 2.4, 1.6, 1.6);
  b.mesh(cylGeo(0.82, 1.6, 8, 'x'), [-38.8, 0.82, 44], { tone: TONE.BOSS });
  b.collider(-38.8, 0, 44, 1.6, 1.64, 1.64);
  b.cylinder(-40, 0, 32, 2.6, 3.4, { segments: 16, mat: 'blockAlt' });
  b.mesh(torusGeo(1.4, 0.35), [-36.6, 1.8, 32], metal);
  for (const [x, z] of [[-10, 46], [10, 46], [-22, 24], [22, 24]] as const) {
    b.box(x, 0, z, 0.25, 6, 0.25, deep);
    b.box(x, 6, z, 1.4, 0.3, 0.5, { ...visual, mat: 'accent' });
  }
  for (const x of [-4, 4]) {
    b.box(x, 0.4, 46, 3, 0.15, 0.6, wood);
    b.box(x, 0, 46, 2.6, 0.4, 0.2, { ...visual, mat: 'dark' });
  }
  markers(b, 'pickups', [[-6, 0, 36], [6, 0, 36], [-30, 1.6, 44], [38, 3, 40], [0, 0, 10]]);
  const benches: readonly Box6[] = [[-16, 0, -8, 2.2, 1.2, 2.2], [18, 0, -10, 2.2, 1.6, 2.2],
    [-20, 0, 8, 1.6, 1, 3], [20, 0, -2, 3, 1, 1.6], [-8, 0, -18, 4, 1.1, 1.2],
    [8, 0, -18, 4, 1.1, 1.2], [0, 0, 22, 5, 0.5, 1.4]];
  for (const values of benches) b.box(...values, wood);
  b.box(-24, 0, -18, 2.4, 2.6, 2.4, { tone: TONE.ACCENT });
  b.box(26, 0, -18, 2.4, 2.6, 2.4, { tone: TONE.HEAL });
}

function buildSky(b: LevelBuilder) {
  // Sun and clouds sit against the sky dome, so they are unlit like it.
  const sun: BuildOpts = { noCollide: true, separate: true };
  const glow = (mesh: THREE.Mesh, color: number) => {
    mesh.material = unlitMat(color);
    mesh.castShadow = false;
  };
  glow(b.sphere(-90, 110, -160, 12, { ...sun, segments: 12 }), SURF.accent);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    glow(b.mesh(boxGeo(6, 0.7, 0.7), [-90 + 19 * Math.cos(angle), 110 + 19 * Math.sin(angle) - 0.35, -160],
      { ...sun, rotation: new THREE.Euler(0, 0, angle) }), SURF.accent);
  }
  for (const [x, y, z, s] of [[60, 70, -170, 1], [-20, 75, -190, 1.3], [140, 60, -80, 0.9],
    [-150, 65, 40, 1.1], [30, 80, 180, 1.2], [-90, 60, 170, 0.8]] as const) {
    for (let i = 0; i < 6; i++) {
      glow(b.sphere(x + (i - 2.5) * 5 * s, y + 2.5 * s * Math.sin(1.7 * i), z, (4 + i % 3) * s, sun), SURF.cloud);
    }
  }
}

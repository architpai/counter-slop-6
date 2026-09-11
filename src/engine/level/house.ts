import * as THREE from 'three';
import { SURF, boxGeo, cylGeo, sphereGeo, unlitMat } from '../render/index';
import type { BuildOpts, Gap, LevelBuilder, MarkerKind } from './build';

/**
 * THE HOUSE: a two-storey suburban home with a basement, laid out for room-to-room fights.
 * Front yard and street are +z, the back garden -z. Three floors:
 *
 *   basement (-3.6)  training | hall  | garage        1F (0)  living | lobby   | office
 *                    laundry  | boiler| storage               hall   | kitchen | dining
 *   2F (3.6)         master   | hall  | kid's room
 *                    bathroom | hall  | workshop
 *
 * Columns split at x = -4 and 3, rows at z = 1. The front stairs climb the lobby,
 * the back hall drops to the basement, the garage opens onto a sunken driveway
 * and a well of steps outside the training room leads down from the front lawn.
 */

type Rect = readonly [number, number, number, number];
type Point = readonly [number, number, number];

const siding: BuildOpts = { mat: 'siding' };
const plaster: BuildOpts = { mat: 'plaster' };
const wood: BuildOpts = { mat: 'wood' };
const concrete: BuildOpts = { mat: 'blockAlt' };
const dark: BuildOpts = { mat: 'dark' };
const metal: BuildOpts = { mat: 'metal' };
const ceiling: BuildOpts = { mat: 'plaster', noCollide: true };

const H = 3.3;                      // clear height of every storey
const HX = H + 0.3;                 // exterior walls also hide the edge of the slab above
const B = -3.6, F1 = 0, F2 = 3.6;   // floor tops
const EAVE = 7.2, RIDGE = 10.4;

const door = (a: number): Gap => [a, a + 1.8, 0, 2.6];
const window = (a: number, w = 2): Gap => [a, a + w, 1.0, 2.4];

/** Subtract one hole from a list of rectangles. */
function cut(rects: Rect[], [hx1, hz1, hx2, hz2]: Rect): Rect[] {
  const out: Rect[] = [];
  for (const [x1, z1, x2, z2] of rects) {
    if (hx1 >= x2 || hx2 <= x1 || hz1 >= z2 || hz2 <= z1) { out.push([x1, z1, x2, z2]); continue; }
    if (z1 < hz1) out.push([x1, z1, x2, hz1]);
    if (hz2 < z2) out.push([x1, hz2, x2, z2]);
    const a = Math.max(z1, hz1), c = Math.min(z2, hz2);
    if (x1 < hx1) out.push([x1, a, hx1, c]);
    if (hx2 < x2) out.push([hx2, a, x2, c]);
  }
  return out;
}

function markers(b: LevelBuilder, kind: MarkerKind, points: readonly Point[]) {
  for (const point of points) b.marker(kind, ...point);
}

export function buildHouse(b: LevelBuilder) {
  b.level.mood = { horizon: 0xf3c39a, zenith: 0x5f86c9, fog: 0xe6c6ad, sun: 0xffd6a3, sunIntensity: 2.0, hemiIntensity: 1.4, hemiSky: 0xd8c4c8, hemiGround: 0xa89e8c };
  buildGround(b);
  buildBasement(b);
  buildFirst(b);
  buildSecond(b);
  buildRoof(b);
  buildFurniture(b);
  buildYard(b);
  buildNeighbourhood(b);
  b.planes(2, 26, 16, { scale: 1.2, radiusStep: 8, heightStep: 5, speed: 0.1 });

  markers(b, 'spawns', [
    [-14, 0, 14], [14, 0, 20], [0, 0, 26], [-18, 0, -4], [19, 0, -4], [-8, 0, -18], [16, 0, -20],
    [-26, 0, 18], [26, 0, 6], [0, 0, -27], [-26, 0, -18], [26, 0, -22],
    [13.5, B, 4], [6, B, 6], [-7, B, 2.5], [-1, B, -2.5], [-11.8, B, 5.5],
    [-7, 0, -3.5], [8.5, 0, -4.8], [-7, F2, 2.5], [5, F2, -3.5],
  ]);
  markers(b, 'snipers', [[0, F2, 9.6], [6, 3.0, -17], [0, RIDGE, 1], [-6, 0.3, -8.5], [22, 6.2, 24]]);
  markers(b, 'pickups', [
    [-2, 0, 4.5], [-2.5, 0, -3.5], [8, 0, 0], [5, 0, 3], [-8.5, 0, 2.5],
    [-5.5, F2, 6.5], [5, F2, 6.5], [5, F2, -2], [8.5, B, 7], [4.5, B, -4.5], [-5.5, B, 6.5], [-0.5, B, 4.5],
    [-6, 0.3, -7.5], [1.5, 0, 9.5], [6, 0, -17], [0, 0, -12],
  ]);
  markers(b, 'arenaSpawns', [
    [-14, 0, 14], [14, 0, 20], [-18, 0, -4], [19, 0, -4], [16, 0, -20], [-26, 0, 18],
    [13.5, B, 4], [-7, B, 2.5], [-7, 0, -3.5], [-7, F2, 2.5], [5, F2, -3.5], [0, F2, 9.6],
  ]);
  b.level.teamSpawns = ([
    [[-14, 0, 14], [-18, 0, -4], [-26, 0, 18], [-7, F2, 2.5], [-7, B, 2.5]],
    [[14, 0, 20], [19, 0, -4], [26, 0, 6], [5, F2, -3.5], [13.5, B, 4]],
  ] as const).map(team => team.map(point => new THREE.Vector3(...point)));
}

// --------------------------------------------------------------- ground

function buildGround(b: LevelBuilder) {
  // Lawn everywhere except the house, the driveway pit and the basement stairwell.
  let lawn: Rect[] = [[-62, -62, 62, 62]];
  for (const hole of [[-10, -6, 10, 8], [10, -0.3, 17.3, 15.3], [-13.9, 4.2, -10, 11.6]] as const) lawn = cut(lawn, hole);
  for (const [x1, z1, x2, z2] of lawn) b.box((x1 + x2) / 2, -1, (z1 + z2) / 2, x2 - x1, 1, z2 - z1, { mat: 'lawn' });
  // Streets and paths sit a hair above the lawn.
  const path: BuildOpts = { mat: 'road', noCollide: true };
  b.box(0, 0, 34, 124, 0.05, 8, path);
  b.box(34, 0, 0, 8, 0.05, 124, path);
  b.box(13.5, 0, 22.5, 6, 0.05, 15, path);
  b.box(-1, 0, 20.5, 2, 0.05, 20, { mat: 'plaster', noCollide: true });
  for (let x = -60; x < 60; x += 6) b.box(x + 1.5, 0.05, 34, 3, 0.02, 0.2, dark);
  for (let z = -60; z < 60; z += 6) b.box(34, 0.05, z + 1.5, 0.2, 0.02, 3, dark);
  // Invisible bounds: the street is the edge of the map.
  const shell: BuildOpts = { noNav: true, noShoot: true, noGrapple: true };
  for (const sign of [-1, 1]) {
    b.collider(0, -1, sign * 31, 70, 40, 2, shell);
    b.collider(sign * 31, -1, 0, 2, 40, 70, shell);
  }
}

// ------------------------------------------------------------- basement

function buildBasement(b: LevelBuilder) {
  b.slab(-10, -6, 10, 8, B, 0.4, { mat: 'road' });
  b.wall('x', -10, 10, -6, B, HX, 0.3, [], concrete);
  b.wall('x', -10, 10, 8, B, HX, 0.3, [], concrete);
  b.wall('z', -6, 8, -10, B, HX, 0.3, [door(5)], concrete);
  b.wall('z', -6, 8, 10, B, HX, 0.3, [[2, 4.4, 0, 2.6], [5, 7.4, 0, 2.6]], concrete);
  b.wall('z', -6, 8, -4, B, H, 0.3, [door(3), door(-5)], plaster);
  b.wall('z', -6, 8, 3, B, H, 0.3, [door(3), door(-5)], plaster);
  b.wall('x', -10, 10, 1, B, H, 0.3, [door(-9), [-6, -4.2, 0, H], door(-1), door(5.5)], plaster);
  // Back-hall stairs: bottom in the training room, top in the 1F back hall.
  b.stairs(-5.1, B, 1.1, '-z', 9, 1.6, { rise: 0.4, run: 0.45, mat: 'road' });

  // Sunken driveway east of the garage, ramping up to the street.
  b.slab(10, 0, 17, 9, B, 0.4, { mat: 'road' });
  b.stairs(13.5, B, 9, '+z', 12, 7, { rise: 0.3, run: 0.5, mat: 'road' });
  b.box(17.15, B, 7.5, 0.3, 3.6, 15.3, concrete);
  b.box(13.5, B, -0.15, 7.3, 3.6, 0.3, concrete);
  b.box(10.15, B, 11.5, 0.3, 3.6, 7.3, concrete);
  // Stair well outside the training room, front-left corner.
  b.slab(-13.6, 4.5, -10, 7.5, B, 0.4, { mat: 'road' });
  b.stairs(-11.8, B, 7.5, '+z', 9, 3.2, { rise: 0.4, run: 0.45, mat: 'road' });
  b.box(-13.75, B, 8, 0.3, 3.6, 7.3, concrete);
  b.box(-11.8, B, 4.35, 3.9, 3.6, 0.3, concrete);
  b.rail(-13.9, 4.2, -13.9, 11.6, 0, wood);
  b.rail(-13.9, 4.2, -10, 4.2, 0, wood);
}

// -------------------------------------------------------------- first floor

function buildFirst(b: LevelBuilder) {
  let floor: Rect[] = [[-10, -6, 10, 8]];
  floor = cut(floor, [-6, -2.95, -4.2, 1.1]);
  for (const [x1, z1, x2, z2] of floor) {
    b.slab(x1, z1, x2, z2, F1, 0.3, wood);
    b.slab(x1, z1, x2, z2, F1 - 0.3, 0.02, ceiling);
  }
  b.rail(-6, -2.95, -6, 1.1, F1, wood);
  b.wall('x', -10, 10, 8, F1, HX, 0.3, [door(-1.9), window(-8.5, 3), window(5, 3)], siding);
  b.wall('x', -10, 10, -6, F1, HX, 0.3, [door(-9), window(-2.5, 3), door(5)], siding);
  b.wall('z', -6, 8, -10, F1, HX, 0.3, [window(3, 3), window(-4)], siding);
  b.wall('z', -6, 8, 10, F1, HX, 0.3, [window(-4, 3), window(3, 3)], siding);
  b.wall('z', -6, 8, -4, F1, H, 0.3, [door(3), door(-3)], plaster);
  b.wall('z', -6, 8, 3, F1, H, 0.3, [[6.3, 7.9, 0, 2.6], door(-3)], plaster);
  b.wall('x', -10, 10, 1, F1, H, 0.3, [door(-9), door(-2.5), door(5.5)], plaster);
  // Front stairs: up from the door side, out into the 2F rear hall through the z = 1 wall.
  b.stairs(2, F1, 6.3, '-z', 10, 1.6, { rise: 0.36, run: 0.5, mat: 'wood' });

  // Rear deck and front porch.
  b.slab(-10, -9, -2, -6, 0.3, 0.3, wood);
  b.rail(-10, -9, -2, -9, 0.3, wood);
  b.rail(-2, -9, -2, -6, 0.3, wood);
  b.box(0, 0, 9.25, 6, 0.05, 2.5, { mat: 'plaster', noCollide: true });
  b.slab(-3.3, 8, 3.3, 10.8, F2, 0.3, wood);
  for (const x of [-3, 3]) b.box(x, 0, 10.5, 0.3, F2, 0.3, wood);
  b.rail(-3.3, 10.8, 3.3, 10.8, F2, wood);
  b.rail(-3.3, 8, -3.3, 10.8, F2, wood);
  b.rail(3.3, 8, 3.3, 10.8, F2, wood);
  b.box(-0.9, 0, 8.6, 0.6, 1.1, 0.4, { mat: 'metal', noCollide: true }); // mailbox by the door? no: a boot rack
}

// ------------------------------------------------------------- second floor

function buildSecond(b: LevelBuilder) {
  let floor: Rect[] = [[-10, -6, 10, 8]];
  floor = cut(floor, [1.1, 1.3, 3, 6.3]);
  for (const [x1, z1, x2, z2] of floor) {
    b.slab(x1, z1, x2, z2, F2, 0.3, wood);
    b.slab(x1, z1, x2, z2, F2 - 0.3, 0.02, ceiling);
  }
  b.rail(1.1, 1.3, 1.1, 6.3, F2, wood);
  b.rail(1.1, 6.3, 3, 6.3, F2, wood);
  b.wall('x', -10, 10, 8, F2, H, 0.3, [door(-1.9), window(-8.5, 3), window(5, 3)], siding);
  b.wall('x', -10, 10, -6, F2, H, 0.3, [window(-2), window(5, 3), [-9, -7, 1.4, 2.4]], siding);
  b.wall('z', -6, 8, -10, F2, H, 0.3, [window(3, 3), window(-4)], siding);
  b.wall('z', -6, 8, 10, F2, H, 0.3, [window(-4, 3), window(3, 3)], siding);
  b.wall('z', -6, 8, -4, F2, H, 0.3, [door(3), door(-3)], plaster);
  b.wall('z', -6, 8, 3, F2, H, 0.3, [[6.3, 7.9, 0, 2.6], door(-3)], plaster);
  b.wall('x', -10, 10, 1, F2, H, 0.3, [door(-2.5), [1.1, 3, 0, H]], plaster);
}

// ---------------------------------------------------------------- roof

function buildRoof(b: LevelBuilder) {
  b.slab(-10.6, -6.6, 10.6, 8.6, EAVE, 0.3, plaster);
  const half = 7.6, rise = RIDGE - EAVE, pitch = Math.atan2(rise, half), length = Math.hypot(half, rise);
  for (const side of [-1, 1]) {
    // Visual slope, then invisible steps so the roof is walkable (snipers, grapples).
    b.mesh(boxGeo(21.4, 0.3, length + 0.2), [0, EAVE + rise / 2, 1 + side * half / 2],
      { mat: 'shingle', rotation: new THREE.Euler(side * pitch, 0, 0) });
    const steps = 8, run = half / steps;
    for (let i = 0; i < steps; i++) {
      const z = 1 + side * (half - (i + 0.5) * run);
      b.collider(0, EAVE, z, 20.6, (i + 0.5) * (rise / steps) + 0.2, run, { noNav: true });
    }
  }
  const shape = new THREE.Shape([new THREE.Vector2(6, EAVE), new THREE.Vector2(-8, EAVE), new THREE.Vector2(-1, RIDGE)]);
  for (const x of [-10, 9.7]) {
    const gable = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
    gable.rotateY(Math.PI / 2);
    b.mesh(gable, [x, 0, 0], { ...siding, separate: true });
  }
  b.box(6, EAVE, -2, 1.2, 4.6, 1.2, concrete);
  b.ring(6, 12.2, -2);
}

// ------------------------------------------------------------ furniture

function buildFurniture(b: LevelBuilder) {
  const cloth: BuildOpts = { mat: 'blockAlt' };
  const white: BuildOpts = { mat: 'plaster' };
  // basement
  b.box(-7, B, 4.5, 0.5, 0.5, 1.6, dark);                 // weight bench
  b.mesh(cylGeo(0.05, 2.2, 6, 'x'), [-7, B + 1.1, 4.9], metal);
  for (const x of [-8, -6]) b.mesh(cylGeo(0.22, 0.12, 8, 'x'), [x, B + 1.1, 4.9], dark);
  b.box(-9.6, B, 6.5, 0.5, 2, 2.4, metal);               // rack
  b.mesh(cylGeo(0.3, 1.2, 8, 'y'), [-6, B + 1.9, 7], { mat: 'hot' }); // punching bag
  for (const x of [-9.4, -8.6]) b.box(x, B, -4.6, 0.7, 0.9, 0.7, white); // washer, dryer
  b.box(-9.6, B, -1, 0.5, 2, 3, metal);
  b.mesh(cylGeo(0.6, 2.4, 10, 'y'), [-1, B + 1.2, -5], metal); // boiler
  b.collider(-1, B, -5, 1.2, 2.4, 1.2);
  b.box(2.2, B, -4.5, 0.6, 1.6, 0.6, white);              // water heater
  const car = { mat: 'hot' } as const;
  b.box(6.5, B + 0.35, 4.7, 1.9, 0.75, 4.2, car);
  b.box(6.5, B + 1.1, 4.4, 1.6, 0.6, 2, dark);
  b.collider(6.5, B, 4.7, 1.9, 1.6, 4.2);
  for (const z of [3.2, 6.2]) for (const x of [5.5, 7.5]) b.mesh(cylGeo(0.35, 0.3, 8, 'x'), [x, B + 0.35, z], dark);
  b.box(6, B, 7.55, 5, 0.9, 0.8, wood);                  // garage workbench
  b.box(6.5, B, -2.5, 1.6, 0.9, 4, siding);               // the boat
  b.box(6.5, B + 0.9, -2.5, 1.2, 0.3, 3, dark);
  b.box(9.6, B, -4, 0.5, 2, 3, metal);
  for (const [x, z] of [[4, -5.2], [4, -4], [5.2, -5.2]] as const) b.box(x, B, z, 1, 1, 1, wood);
  // first floor
  b.box(-7, F1, 6.2, 3, 0.9, 1.1, cloth);                 // sofa
  b.box(-7, F1, 4.3, 1.6, 0.45, 0.9, wood);              // coffee table
  b.box(-7, F1, 1.5, 2, 0.6, 0.5, dark);                 // tv cabinet
  b.box(-7, F1 + 0.6, 1.5, 1.6, 0.9, 0.1, dark);
  b.box(7, F1, 5, 2, 0.8, 1, wood);                      // desk
  b.box(7, F1, 3.7, 0.5, 0.5, 0.5, dark);
  b.box(9.65, F1, 2.2, 0.5, 2.2, 1.6, wood);             // bookshelf
  b.box(-0.5, F1, -2.5, 2.4, 0.95, 1.1, white);          // kitchen island
  b.box(-1, F1, -5.55, 5, 0.9, 0.6, white);
  b.box(2.5, F1, -5.4, 0.9, 1.9, 0.8, metal);            // fridge
  b.box(6.5, F1, -2.5, 2.6, 0.78, 1.2, wood);            // dining table
  for (const [x, z] of [[5.5, -3.6], [7.5, -3.6], [5.5, -1.4], [7.5, -1.4]] as const) b.box(x, F1, z, 0.45, 0.45, 0.45, dark);
  b.box(-9.65, F1, -5.2, 0.5, 1, 1.2, wood);             // hall bench
  // second floor
  b.box(-7, F2, 5.2, 2, 0.6, 2.2, white);                // master bed
  b.box(-7, F2, 6.4, 2.1, 1.2, 0.2, wood);
  b.box(-9.65, F2, 2, 0.5, 1, 1.6, wood);
  b.box(7.5, F2, 5.5, 1.2, 0.55, 2, { mat: 'boss' });    // kid's bed, pink
  b.box(9.65, F2, 3, 0.5, 0.8, 1.4, wood);
  b.box(5.5, F2, 7.3, 0.8, 0.6, 0.8, { mat: 'accent' }); // toy box
  b.box(-8.5, F2, -5.1, 1.7, 0.6, 0.8, white);           // tub
  b.box(-9.5, F2, -2.5, 0.5, 0.8, 0.7, white);           // toilet
  b.box(-6.5, F2, -5.5, 0.6, 0.9, 0.5, white);           // sink
  b.box(7, F2, -5.3, 3, 0.9, 0.8, wood);                 // workbench
  b.box(9.65, F2, -3, 0.5, 2, 2, metal);
  b.box(5, F2, -1, 1.2, 0.7, 0.5, { mat: 'accent' });    // sawhorse
  b.box(-0.5, F2, -5.55, 1.6, 0.9, 0.5, wood);           // rear hall console
  // Rugs and tiled floors: a colour per room so you know where you are.
  const rug = (x: number, y: number, z: number, w: number, d: number, mat: BuildOpts['mat']) => b.box(x, y, z, w, 0.03, d, { mat, noCollide: true });
  rug(-7, F1, 4, 4, 3.2, 'hot');
  rug(6.5, F1, -2.5, 4.5, 3.6, 'accent');
  rug(6.5, F1, 4.5, 3.6, 3, 'foliage');
  rug(-0.5, F1, -2.5, 6.4, 6.4, 'plaster');
  rug(-7, F2, 4.2, 4.6, 3.6, 'blockDeep');
  rug(6.5, F2, 4.5, 4.8, 4, 'boss');
  rug(-7, F2, -2.5, 5.6, 6.6, 'plaster');
  rug(-1, F2, -2.5, 3, 2, 'hot');
  rug(-7, B, 4.5, 4.6, 5, 'blockDeep');
}

// ------------------------------------------------------------------ yard

function tree(b: LevelBuilder, x: number, z: number, s = 1) {
  b.cylinder(x, 0, z, 0.35 * s, 3.2 * s, { segments: 7, mat: 'wood' });
  const leaf: BuildOpts = { mat: 'foliage', noCollide: true };
  b.sphere(x, 4.3 * s, z, 2.3 * s, { ...leaf, segments: 8 });
  b.sphere(x + 1.3 * s, 3.6 * s, z + 0.6 * s, 1.5 * s, { ...leaf, segments: 7 });
  b.sphere(x - 1.1 * s, 3.9 * s, z - 0.9 * s, 1.6 * s, { ...leaf, segments: 7 });
}

function fenceRun(b: LevelBuilder, x1: number, z1: number, x2: number, z2: number, gaps: readonly (readonly [number, number])[] = []) {
  const alongX = x1 !== x2;
  const from = alongX ? x1 : z1, to = alongX ? x2 : z2, fixed = alongX ? z1 : x1;
  const cuts = [from, ...gaps.flatMap(g => [g[0], g[1]]), to];
  for (let i = 0; i < cuts.length; i += 2) {
    const lo = cuts[i], hi = cuts[i + 1];
    if (lo === undefined || hi === undefined || hi - lo < 0.1) continue;
    const mid = (lo + hi) / 2;
    if (alongX) b.box(mid, 0, fixed, hi - lo, 1.8, 0.1, wood);
    else b.box(fixed, 0, mid, 0.1, 1.8, hi - lo, wood);
    for (let p = lo; p <= hi; p += 2.5) {
      if (alongX) b.box(p, 0, fixed, 0.15, 2, 0.15, { ...wood, noCollide: true });
      else b.box(fixed, 0, p, 0.15, 2, 0.15, { ...wood, noCollide: true });
    }
  }
}

function buildYard(b: LevelBuilder) {
  // Back garden fence with a gate on each side.
  fenceRun(b, -22, -24, 22, -24, [[-1, 1]]);
  fenceRun(b, -22, -24, -22, 12, [[6, 8]]);
  fenceRun(b, 22, -24, 22, 12, [[-8, -6]]);
  // The summer house: a sniper's shed at the bottom of the garden.
  b.wall('x', 2, 10, -20, 0, 2.6, 0.2, [], wood);
  b.wall('x', 2, 10, -14, 0, 2.6, 0.2, [door(5)], wood);
  b.wall('z', -20, -14, 2, 0, 2.6, 0.2, [window(-18, 1.5)], wood);
  b.wall('z', -20, -14, 10, 0, 2.6, 0.2, [], wood);
  b.slab(1.7, -20.3, 10.3, -13.7, 2.9, 0.3, { mat: 'shingle' });
  b.box(2.5, 2.9, -19.5, 0.1, 2.6, 0.1, dark);
  b.ring(2.5, 5.7, -19.5);
  b.box(-6, 0, -14, 1.8, 0.75, 1, wood);                  // picnic table
  for (const z of [-14.9, -13.1]) b.box(-6, 0, z, 1.8, 0.45, 0.3, wood);
  for (const x of [11, 12]) b.mesh(cylGeo(0.4, 1, 8, 'y'), [x, 0.5, -7.5], metal); // bins
  b.collider(11.5, 0, -7.5, 2, 1, 1);
  b.box(-11.5, 0, 12.5, 0.15, 1.1, 0.15, dark);          // mailbox
  b.box(-11.5, 1.1, 12.5, 0.4, 0.3, 0.6, { mat: 'hot' });
  tree(b, -18, -8, 1.5);
  b.ring(-18, 7.5, -8);
  tree(b, 17, -18, 1.1);
  tree(b, -26, 10, 1);
  tree(b, -14, 22, 1.1);
  tree(b, 26, -8, 1);
  for (const [x, z] of [[-8, 9.5], [-5.5, 9.5], [5.5, 9.5], [8, 9.5], [-11, 2], [-11, -1], [-11, -4]] as const) {
    b.sphere(x, 0.6, z, 0.8, { mat: 'foliage', segments: 7, noCollide: true });
  }
  for (const [x, z] of [[-6.5, 10.8], [7, 10.8]] as const) b.box(x, 0, z, 3, 0.25, 0.8, { mat: 'hot', noCollide: true });
  // Construction site scaffold up the street: a perch with a view of the front.
  for (const [x, z] of [[20, 22], [24, 22], [20, 26], [24, 26]] as const) b.box(x, 0, z, 0.2, 6, 0.2, metal);
  b.slab(19.5, 21.5, 24.5, 26.5, 6, 0.2, metal);
  b.slab(19.5, 21.5, 24.5, 26.5, 3, 0.2, metal);
  b.rail(19.5, 26.5, 24.5, 26.5, 6, metal);
  b.rail(24.5, 21.5, 24.5, 26.5, 6, metal);
  b.ring(22, 7.5, 24);
  b.box(27, 0, 21, 3, 1.4, 4, { mat: 'wood', noNav: true }); // lumber
  b.sphere(26, 0.2, 15.5, 2.2, { mat: 'ground', segments: 8 });  // sand pile
}

// --------------------------------------------------------- neighbourhood

function neighbour(b: LevelBuilder, x: number, z: number, w: number, d: number, h: number, mat: BuildOpts['mat']) {
  b.box(x, 0, z, w, h, d, { mat, noCollide: true });
  const rise = 2.6, half = d / 2 + 0.5, pitch = Math.atan2(rise, half), length = Math.hypot(half, rise);
  for (const side of [-1, 1]) {
    b.mesh(boxGeo(w + 1, 0.3, length), [x, h + rise / 2, z + side * half / 2],
      { mat: 'shingle', noCollide: true, rotation: new THREE.Euler(side * pitch, 0, 0) });
  }
}

function buildNeighbourhood(b: LevelBuilder) {
  neighbour(b, -26, 48, 14, 10, 6, 'siding');
  neighbour(b, 0, 50, 12, 9, 3.4, 'blockAlt');
  neighbour(b, 24, 48, 16, 10, 6.5, 'plaster');
  neighbour(b, -48, 16, 10, 14, 6, 'siding');
  neighbour(b, -48, -16, 12, 12, 3.6, 'blockAlt');
  neighbour(b, -26, -48, 14, 10, 6.4, 'plaster');
  neighbour(b, 16, -48, 12, 10, 3.5, 'siding');
  for (const [x, z, s] of [[-42, 36, 1.4], [-42, -38, 1.2], [36, -44, 1.5], [-10, -42, 1.1], [42, 44, 1.3]] as const) tree(b, x, z, s);
  // The river and its docks, east of the side street.
  b.box(68, -1.2, 0, 60, 0.8, 130, { mat: 'water', noCollide: true });
  b.slab(38, -3, 50, 3, 0.25, 0.25, wood);
  for (const [x, z] of [[39, -2.6], [39, 2.6], [49, -2.6], [49, 2.6]] as const) b.box(x, -1, z, 0.3, 1.5, 0.3, { ...wood, noCollide: true });
  b.box(46, 0.25, -1.2, 3, 0.6, 1.2, { mat: 'siding', noCollide: true });   // moored boat
  // A low evening sun and a few clouds, unlit against the dome.
  const glow = (mesh: THREE.Mesh, color: number) => {
    mesh.material = unlitMat(color);
    mesh.castShadow = false;
  };
  glow(b.sphere(150, 52, 160, 14, { segments: 12, separate: true, noCollide: true }), SURF.accent);
  for (const [x, y, z, s] of [[-80, 70, 150, 1.2], [60, 78, 190, 1.4], [-160, 62, 20, 1], [120, 66, -140, 1.1]] as const) {
    for (let i = 0; i < 5; i++) {
      glow(b.mesh(sphereGeo((4 + i % 3) * s, 8), [x + (i - 2) * 5 * s, y + 2 * s * Math.sin(1.7 * i), z],
        { separate: true, noCollide: true }), SURF.cloud);
    }
  }
}

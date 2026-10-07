import { Dresser } from './dressing';
import type { BuildOpts, LevelBuilder } from './build';
import type { DressMap, Wall } from './dressing';

/**
 * The House's realistic-tier dressing (docs/VISUALS.md, R6, V14, V16): the
 * house gets gutters and drainpipes, a porch lamp, its number, a meter box,
 * pictures and posters in its rooms, ceiling lights and pipes in the
 * basement; the neighbourhood past the yard's invisible edge (the streets
 * and gardens beyond `SHELL`, where nobody walks) fills with parked cars,
 * bins, picket fences, hedges, trees, planters, a barbecue, a bench and a
 * clown gnome, with kerbs and grime on its streets; and past the neighbours
 * a treeline and distant houses give the evening haze some depth. Low draws
 * none of it (level/dressing.ts).
 *
 * level/house.ts draws its plan in "blueprint metres" scaled by 1.3; this
 * works in world metres.
 */

const S = 1.3;
const YAW_OF: Readonly<Record<Wall['face'], number>> = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };
/** The invisible walls round the yard (level/house.ts `buildGround`): nothing inside may stand on the ground. */
const SHELL = 41.8;
const F2 = 3.6 * S, EAVE = 7.2 * S;
/** The house's outer wall faces: x = ±13.195, z from -7.995 to 10.595. */
const HX = 10 * S + 0.15 * S, ZB = -6 * S - 0.15 * S, ZF = 8 * S + 0.15 * S;
const KERB: BuildOpts = { mat: 'plaster', material: 'concrete', tint: 0xd8d6d0 };
/** Painted boards, as the house's own trim round its openings (level/house.ts `wall`). */
const BOARD: BuildOpts = { mat: 'plaster', material: 'painted-wood' };
const FASCIA_PROUD = 0.03;

export const dressHouse: DressMap = (b, pass, world) => {
  const d = new Dresser(b, 'house', 0x40a5e, pass, world);
  const front: Wall = { face: '+z', plane: ZF }, back: Wall = { face: '-z', plane: ZB };
  const east: Wall = { face: '+x', plane: HX }, west: Wall = { face: '-x', plane: -HX };

  // ---- the house's edges: a fascia board round the eaves and the porch roof, boards up its corners, a base
  // course along the front, back and west walls (the east one, over the driveway, closes the east yard's long views and
  // stays plain: docs/VISUALS.md, readability), stringers on its stairs
  d.fascia(-10.6 * S, -6.6 * S, 10.6 * S, 8.6 * S, EAVE, 0.45, FASCIA_PROUD, BOARD);
  d.fascia(-3.3 * S, 8 * S, 3.3 * S, 10.8 * S, F2, 0.4, 0.03, BOARD);
  for (const x of [-HX, HX]) {
    for (const z of [ZB, ZF]) {
      // One board on each face, the x face's wrapping the other's edge.
      const sx = Math.sign(x), sz = Math.sign(z), t = 0.035, w = 0.18;
      d.trim(x + sx * t / 2, 0, z + sz * (t - w) / 2, t, EAVE - 0.45, w + t, BOARD);
      d.trim(x - sx * w / 2, 0, z + sz * t / 2, w, EAVE - 0.45, t, BOARD);
    }
  }
  // The west wall's run stops at the stair well (level/house.ts `buildGround`), which drops to the basement there.
  for (const [wall, a0, a1] of [[front, -HX, HX], [back, -HX, HX], [west, ZB, 4.5 * S]] as const) {
    d.facade(wall, a0, a1, 0, EAVE, { plinth: { height: 0.35, opts: { mat: 'blockAlt', material: 'concrete', tint: 0xd8d4cc } } });
  }
  d.stairs();

  // ---- the house: gutters under both eaves, drainpipes at the corners, the porch lamp and number
  for (const [wall, z] of [[front, 8.6 * S], [back, -6.6 * S]] as const) {
    d.onWall('gutter', { face: wall.face, plane: z }, 0, EAVE - 0.39, { scale: [21.2 * S, 1, 1], out: FASCIA_PROUD + 0.002 });
    for (const x of [-HX + 0.5, HX - 0.5]) d.onWall('downpipe', wall, x, 0, { scale: [1, EAVE - 0.35, 1] });
  }
  d.onWall('lamp-wall', front, 0.35, 2.55);
  d.sign('number', front, 0.95, 2.2, 0.32, 0.32);
  d.onWall('meter-box', east, 6 * S, 1.1);
  d.onWall('ac-wall', east, -2.2 * S, F2 + 1.9);
  d.onWall('vent-wall', west, 0.5 * S, 0.3);
  // Grime at the foot of the front, back and west walls; the east one, over the driveway, closes the east yard's long
  // views and stays plain (docs/VISUALS.md, readability).
  for (const wall of [front, back, west]) {
    const a0 = wall.face.endsWith('x') ? ZB : -HX, a1 = wall.face.endsWith('x') ? ZF : HX;
    for (let a = a0 + 0.8; a < a1 - 1; a += 3.2) d.wallDecal('base', wall, a + 1.6, 0.4, 3.4, 0.8, 0.35);
  }

  // ---- inside: pictures and posters on walls clear of every opening
  const inside: [Wall, number, number, number, string[]][] = [
    [{ face: '+x', plane: -10 * S + 0.195 }, 1 * S, 8 * S, 0, ['portrait', 'landscape']],
    [{ face: '-z', plane: 8 * S - 0.195 }, -10 * S, -4 * S, 0, ['landscape']],
    [{ face: '+z', plane: -6 * S + 0.195 }, -4 * S, 3 * S, 0, ['portrait']],
    [{ face: '-x', plane: 10 * S - 0.195 }, 1 * S, 8 * S, F2, ['drawing', 'counter-slop']],
    [{ face: '+x', plane: -10 * S + 0.195 }, 1 * S, 8 * S, F2, ['portrait', 'landscape']],
    [{ face: '+x', plane: -10 * S + 0.195 }, 1 * S, 8 * S, -3.6 * S, ['clown-college', 'counter-slop', 'respawn']],
  ];
  for (const [wall, a0, a1, floor, pictures] of inside) {
    const openings = d.openings(wall, a0, a1, floor, floor + 3.3 * S);
    let a = a0 + 0.9;
    for (const name of pictures) {
      const poster = !['portrait', 'landscape', 'drawing'].includes(name), w = poster ? 0.7 : 0.9, h = poster ? 1 : 0.7;
      while (a < a1 - 0.9 && openings.some(o => a + w / 2 + 0.2 > o.a0 && a - w / 2 - 0.2 < o.a1 && floor + 2.6 > o.y0)) a += 0.3;
      if (a >= a1 - 0.9) break;
      d.sign(name, wall, a, floor + 1.45, w, h, poster ? 'poster' : 'frame');
      a += w + 1.4;
    }
  }
  // The basement: fittings under its ceiling, a pipe run along its walls.
  // The garage's fitting hangs clear of the car's roof (level/house.ts `buildFurniture`).
  for (const x of [-7, 0, 9]) for (const z of [-3, 4]) d.prop('light-ceiling', x * S, -0.42, z * S, { yaw: Math.PI / 2 });
  d.onWall('pipe-h', { face: '-z', plane: 8 * S - 0.195 }, 0, -0.9, { scale: [24, 1, 1] });
  d.onWall('pipe-h', { face: '+x', plane: -10 * S + 0.195 }, 1 * S, -1.1, { scale: [16, 1, 1] });
  for (const [x, z] of [[-6, 5], [4, -4], [-8, -3], [6, 6]] as const) d.groundDecal('damp', x * S, -3.6 * S + 0.001, z * S, 2.4, 2.4, x, 0.55);
  d.groundDecal('oil', 6.5 * S, -3.6 * S + 0.001, 5 * S, 1.8, 1.8, 0.5, 0.8);
  d.groundDecal('oil', 13.5 * S, -3.6 * S + 0.001, 4 * S, 1.6, 1.6, 1.1, 0.6);

  // Every room from the inside (level/house.ts's plan: columns split at x = -4 and 3, rows at z = 1): skirting, switches
  // and conduit, radiators under the windows, a clock or a picture up high, dirt along the skirting and scuffs on the
  // floors; the basement's rooms get shelving where there is room.
  const skirting: BuildOpts = { mat: 'plaster', material: 'painted-wood' };
  const pictures = ['clock', 'high-voltage', 'landscape', 'drawing', 'clock', 'portrait', 'respawn', 'clock', 'counter-slop'];
  let hung = 0;
  for (const floor of [-3.6 * S, 0, F2]) {
    for (const [x0, x1] of [[-10, -4], [-4, 3], [3, 10]] as const) {
      for (const [z0, z1] of [[-6, 1], [1, 8]] as const) {
        d.room((x0 + 0.15) * S, (z0 + 0.15) * S, (x1 - 0.15) * S, (z1 - 0.15) * S, floor, 3.3 * S,
          { skirting, pictures: [pictures[hung++ % pictures.length]!], grime: floor < 0 ? 0.6 : 0.4, shelves: floor < 0 });
      }
    }
  }

  // ---- the garden: the mower by the garage, a hose on the wall, pots and planters along the west fence, edging
  // along the front path, oil and tyre marks on the driveway, dirt and leaves on the lawn
  const garage = [[22.1 - 0.4, 2], [22.1 - 0.4, 4], [22.1 - 0.4, 7], [13.4 + 0.45, 7], [13.4 + 0.45, 3]] as const;
  for (const [x, z] of garage) if (d.propIfClear('mower', x, -3.6 * S, z * S, { yaw: x > 18 ? -Math.PI / 2 : Math.PI / 2 })) break;
  for (const [wall, a] of [[east, 3 * S], [east, -3 * S], [west, 2 * S], [back, 6 * S]] as const) {
    const [x, , z] = d.at(wall, a, 0.95, 0.002);
    if (d.propIfClear('hose-reel', x, 0.95, z, { yaw: YAW_OF[wall.face] })) break;
  }
  let planted = 0;
  // Along the west fence; the east and back ones close the yard's long views, where grunts stand against them.
  for (const [x0, z0, x1, z1, yaw] of [[-22 * S + 0.35, -23 * S, -22 * S + 0.35, 11 * S, Math.PI / 2]] as const) {
    for (let t = 0.05; t < 1; t += d.range(0.06, 0.12)) {
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, piece = d.pick(['pot', 'pot', 'planter', 'bin', 'pot']);
      if (planted >= 14) continue;
      const turn = piece === 'pot' ? d.range(0, 6) : 0, tint = piece === 'bin' ? d.pick([0xffffff, 0x8fa4c8]) : 0xffffff;
      if (d.propIfClear(piece, x, 0, z, { yaw: yaw + turn, tint })) planted++;
    }
  }
  const edging: BuildOpts = { mat: 'plaster', material: 'concrete', tint: 0xcfcac0 };
  for (const x of [-2 * S - 0.05, 0.05]) d.trim(x, 0, 20.5 * S, 0.1, 0.07, 19.6 * S, edging);
  for (let z = 11 * S; z < 30 * S; z += d.range(1.8, 3)) {
    d.groundDecal(d.pick(['stain', 'cracks', 'leaf-litter']), -1 * S + d.range(-0.4, 0.4), 0.05, z, 1.3, 1.3, d.range(0, 6), 0.6);
  }
  for (let z = 16 * S; z < 30 * S; z += d.range(2.5, 4)) {
    d.groundDecal(d.pick(['tyres', 'oil', 'tyres', 'patch']), 13.5 * S + d.range(-1, 1), 0.05, z, 1.8, 2.6, d.range(-0.1, 0.1), 0.65);
  }
  for (const [x, z] of [[-18, -8], [17, -18], [-26, 10], [-14, 22], [26, -8]] as const) {
    for (let k = 0; k < 4; k++) d.groundDecal('leaf-litter', x * S + d.range(-2.5, 2.5), 0.002, z * S + d.range(-2.5, 2.5), 2, 2, d.range(0, 6), 0.8);
  }
  // Bare, worn lawn where feet cut the corners: by the porch, the path's ends and the gates.
  for (const [x, z] of [[1.5, 11.5], [-3.5, 11], [-1, 30], [-22, 7], [22, -7], [0, -24], [-12, 14], [10, 12]] as const) {
    d.groundDecal('dirt', x * S + d.range(-0.5, 0.5), 0.002, z * S + d.range(-0.5, 0.5), d.range(2, 3.2), d.range(2, 3.2), d.range(0, 6), 0.7);
  }
  for (let i = 0; i < 30; i++) {
    const x = d.range(-28, 28) * S, z = d.range(-28, 29) * S;
    if (Math.abs(x) < 11 * S && z > -7 * S && z < 9 * S) continue;
    d.groundDecal(d.pick(['dirt', 'leaf-litter', 'moss']), x, 0.002, z, d.range(1.5, 3), d.range(1.5, 3), d.range(0, 6), d.range(0.4, 0.65));
  }

  // ---- the streets beyond the yard: kerbs, parked cars, bins, grime
  const street = 34 * S, lane = 4 * S, end = 62 * S;
  // The near kerbs break where the front path and the driveway meet the street, and at the crossing.
  const kerbs = (from: number, to: number, gaps: readonly (readonly [number, number])[], place: (a0: number, a1: number) => void) => {
    let a = from;
    for (const [g0, g1] of [...gaps, [to, to]] as const) {
      if (g0 - a > 0.2) place(a, g0);
      a = g1;
    }
  };
  const alongX = (z: number) => (a0: number, a1: number) => d.trim((a0 + a1) / 2, 0, z, a1 - a0, 0.12, 0.2, KERB);
  const alongZ = (x: number) => (a0: number, a1: number) => d.trim(x, 0, (a0 + a1) / 2, 0.2, 0.12, a1 - a0, KERB);
  kerbs(-end, end, [[-2.1 * S, 0.1 * S], [10.4 * S, 16.6 * S], [street - lane - 0.2, street + lane + 0.2]], alongX(street - lane - 0.1));
  kerbs(-end, end, [[street - lane - 0.2, street + lane + 0.2]], alongX(street + lane + 0.1));
  kerbs(-end, end, [[street - lane - 0.2, street + lane + 0.2]], alongZ(street - lane - 0.1));
  kerbs(-end, end, [[street - lane - 0.2, street + lane + 0.2]], alongZ(street + lane + 0.1));
  const paints = [0xc8403a, 0x2f58a8, 0xe6e4de, 0x3a3f44, 0x6f8a5a, 0xd0a040];
  for (let x = -70; x < 72; x += d.range(9, 16)) {
    if (d.random() < 0.7) d.prop('car', x, 0.065, street + 2.4, { yaw: Math.PI / 2 + (d.random() < 0.5 ? 0 : Math.PI), tint: d.pick(paints) });
    d.groundDecal(d.pick(['patch', 'cracks', 'oil']), x + d.range(-3, 3), 0.065, street + d.range(-3, 3), 2, 2, d.range(0, 6), 0.7);
  }
  for (let z = -70; z < 72; z += d.range(9, 16)) {
    if (z > 30 && z < 52) continue;
    if (d.random() < 0.7) d.prop('car', street + 2.4, 0.065, z, { yaw: d.random() < 0.5 ? 0 : Math.PI, tint: d.pick(paints) });
    d.groundDecal(d.pick(['patch', 'cracks', 'oil']), street + d.range(-3, 3), 0.065, z + d.range(-3, 3), 2, 2, d.range(0, 6), 0.7);
  }
  for (let x = -62; x < 62; x += 7) d.groundDecal('cover', x, 0.065, street, 0.9, 0.9, 0, x % 2 ? 0.8 : 0);

  // ---- the neighbours' gardens: fences, hedges, bins, mailboxes, trees and garden things
  /** A front garden behind a picket fence at (x, z), the yard running along (dx, dz) away from the street. */
  const garden = (x: number, z: number, dx: number, dz: number) => {
    const yaw = Math.atan2(-dx, -dz), tx = Math.cos(yaw), tz = -Math.sin(yaw);
    const at = (u: number, v: number): [number, number, number] => [x + u * tx + v * dx, 0, z + u * tz + v * dz];
    for (let u = -7; u <= 7; u += 2) d.prop('picket', ...at(u, 0), { yaw });
    d.prop('mailbox', ...at(-8.2, -0.4), { yaw });
    d.prop('bin', ...at(8.4, -0.5), { yaw: yaw + d.range(-0.3, 0.3), tint: d.pick([0xffffff, 0x8fa4c8, 0xc8a070]) });
    d.prop('hedge', ...at(-4.5, 1.2), { yaw });
    d.prop('planter', ...at(3.5, 1.5), { yaw });
    if (d.random() < 0.5) d.prop('gnome', ...at(1.8, 2.2), { yaw: yaw + d.range(-0.6, 0.6) });
  };
  // North of the street (the neighbours' fronts face it), and the west and south gardens beyond the shell.
  for (const x of [-34, 0, 31]) garden(x, street + lane + 2.3, 0, 1);
  for (const z of [-21, 21]) garden(-SHELL - 8, z, -1, 0);
  for (const x of [-34, 21]) garden(x, -SHELL - 7.5, 0, -1);
  d.prop('bbq', -SHELL - 12, 0, 6, { yaw: 0.4 });
  d.prop('bench', -SHELL - 11, 0, -8, { yaw: Math.PI / 2 });
  d.prop('gnome', -SHELL - 6.5, 0, 2, { yaw: 1.4 });
  d.prop('bbq', 8, 0, -SHELL - 12, { yaw: 2.2 });
  d.prop('bench', -12, 0, -SHELL - 11, { yaw: 0 });
  for (const [x, z, s] of [[-SHELL - 4, -34, 1.1], [-SHELL - 5, 36, 0.95], [-20, -SHELL - 4, 1.2], [6, -SHELL - 5, 1], [-50, street + 12, 1.1],
    [12, street + 13, 1.25], [-SHELL - 14, -2, 1.1], [37, -SHELL - 12, 1.15]] as const) {
    d.prop('tree', x, 0, z, { yaw: x + z, scale: s, tint: d.pick([0xffffff, 0xe8f0d8, 0xf0e8c8]) });
  }
  // Across the street a For Sale sign on a fence, the neighbourhood watch and a slow sign on the others.
  d.sign('for-sale', { face: '-z', plane: street + lane + 2.26 }, -30, 0.3, 0.9, 0.6);
  d.sign('watch', { face: '-z', plane: street + lane + 2.26 }, 4, 0.3, 0.7, 0.7);
  d.sign('drive-slow', { face: '-z', plane: street + lane + 2.26 }, 27, 0.3, 0.8, 0.8);
  d.sign('beware', { face: '+x', plane: -SHELL - 8 + 0.04 }, 18, 0.3, 0.6, 0.6);

  // ---- beyond the east street, by the river: a builder's corner (pallets, crates, drums, bags, a fence and cones)
  const yard = street + lane + 3.5;
  for (const z of [-18, -16, -14, -12]) d.prop('fence', yard + 4.2, 0, z, { yaw: Math.PI / 2 });
  for (const [piece, x, z, yaw] of [['pallet', yard + 1, -17, 0.1], ['pallet', yard + 1.1, -17.05, 0.3], ['crate', yard + 2.6, -15.4, 0.4],
    ['crate-small', yard + 2.7, -14.3, 1.2], ['barrel', yard + 1, -13.2, 0], ['barrel', yard + 1.6, -12.6, 0], ['trash-bags', yard + 0.8, -11.5, 2],
    ['cardboard', yard + 2.2, -11.2, 0.6], ['rubble', yard + 2.4, -19.5, 0.3], ['cone', street + 3.5, -20.5, 0], ['cone', street + 3.5, -9.5, 0]] as const) {
    d.prop(piece, x, piece === 'pallet' && x > yard + 1.05 ? 0.144 : 0, z, { yaw, tint: piece === 'barrel' ? d.pick([0x2f58a8, 0x3f6a45]) : 0xffffff });
  }
  // Bags and boxes out by the neighbours' bins, litter along the street's far side.
  for (const x of [-34, 0, 31]) {
    d.prop('trash-bags', x + 9.6, 0, street + lane + 1.5, { yaw: d.range(0, 6) });
    if (d.random() < 0.6) d.prop('cardboard', x + 10.4, 0, street + lane + 1.2, { yaw: d.range(0, 6) });
  }
  for (let x = -60; x < 60; x += d.range(5, 11)) d.prop('litter', x, 0.065, street + lane - 0.6, { yaw: d.range(0, 6), scale: d.range(0.6, 1) });

  // ---- the neighbours' houses (level/house.ts `buildNeighbourhood`): windows and a door on the side facing the yard
  for (const [x, z, w, depth, h] of [[-26, 48, 14, 10, 6], [0, 50, 12, 9, 3.4], [24, 48, 16, 10, 6.5], [-48, 16, 10, 14, 6],
    [-48, -16, 12, 12, 3.6], [-26, -48, 14, 10, 6.4], [16, -48, 12, 10, 3.5]] as const) {
    const onX = Math.abs(x) > Math.abs(z), sign = onX ? -Math.sign(x) : -Math.sign(z);
    const wall: Wall = onX ? { face: sign > 0 ? '+x' : '-x', plane: (x + sign * w / 2) * S } : { face: sign > 0 ? '+z' : '-z', plane: (z + sign * depth / 2) * S };
    const centre = (onX ? z : x) * S, span = (onX ? depth : w) * S;
    for (const y of h * S > 6 ? [1.1, 4.2] : [1.1]) {
      for (let a = centre - span / 2 + 1.6; a < centre + span / 2 - 1.2; a += 2.6) {
        if (y < 2 && Math.abs(a - centre) < 1.4) continue;
        d.onWall('window', wall, a, y, { tint: 0xf4f0e8 });
      }
    }
    d.onWall('door-wood', wall, centre, 0, { tint: d.pick([0xffffff, 0xc8d8e8, 0xe8c8b8]) });
    d.onWall('lamp-wall', wall, centre + 0.9, 2.4);
    for (let a = centre - span / 2 + 0.5; a < centre + span / 2 - 1; a += 3) d.wallDecal('base', wall, a + 1.5, 0.4, 3.2, 0.8, 0.35);
  }

  // ---- the backdrop (V14): a treeline beyond the neighbours, and a few distant houses, in the haze
  for (let i = 0; i < 44; i++) {
    const angle = (i + d.range(-0.35, 0.35)) / 44 * Math.PI * 2, r = d.range(92, 132);
    const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
    if (x > 55 && Math.abs(z) < 120 && x < 125) continue;
    d.prop('tree-far', x, 0, z, { yaw: d.range(0, 6), scale: d.range(0.8, 1.3), tint: d.pick([0xffffff, 0xe0ecd0, 0xf0e8c8, 0xd4e0c4]) });
  }
  for (const [x, z, yaw] of [[-80, 70, 0.6], [-95, -20, 1.5], [-70, -85, 2.4], [10, -96, 3.1], [40, 88, 0.1], [-30, 100, 0.2], [-100, 35, 1.2]] as const) {
    d.prop('house-far', x, 0, z, { yaw, scale: d.range(0.9, 1.15), tint: d.pick([0xffffff, 0xe8d8c8, 0xd8e0e8]) });
  }

  // ---- last, so the generator's draws above stay as they were: garden things, boxes and bags tucked against the
  // summer house, the picnic table, the bins and the builders' scaffold and lumber, where the walker grid leaves room;
  // papers blown against the bins and the lumber.
  d.tuck([-27, -29.5, 27, -8.6], 0, 11, ['pot', 'pot', 'crate-small', 'cardboard'], 6);
  d.tuck([13.6, -8.6, 27, 14], 0, 5, ['trash-bags', 'cardboard', 'crate-small'], 3);
  d.tuck([24, 26, 40, 36], 0, 5, ['cone', 'crate-small', 'cardboard', 'barrel'], 5);
  for (const [x, z] of [[14.2, -9.2], [16.4, -10.6], [33.2, 26.4], [36.6, 29.4], [-5.5, -17.2]] as const) {
    d.prop(d.pick(['papers', 'papers', 'cardboard-flat', 'leaves']), x, 0.002, z, { yaw: d.range(0, 6), scale: d.range(0.8, 1.1) });
  }
  // Fallen leaves under the yard's trees and blown against the house's front, back and west walls (flat enough to walk
  // over; the east wall stays plain), bare earth along those walls' feet and round the flower beds by the porch.
  for (const [x, z] of [[-18, -8], [17, -18], [-26, 10], [-14, 22], [26, -8]] as const) {
    for (let k = 0; k < 4; k++) d.prop('leaves', x * S + d.range(-2.2, 2.2), 0.002, z * S + d.range(-2.2, 2.2), { yaw: d.range(0, 6), scale: d.range(0.7, 1.1) });
  }
  for (const wall of [front, back, west]) {
    const a0 = wall.face.endsWith('x') ? ZB : -HX, a1 = wall.face.endsWith('x') ? 4.5 * S : HX;
    d.footDirt(wall, a0 + 0.4, a1 - 0.4, 0.002, 0.45, 0.8);
    for (let a = a0 + 1; a < a1 - 1; a += d.range(2.5, 4.5)) {
      const [x, , z] = d.at(wall, a, 0, d.range(0.2, 0.5));
      d.prop('leaves', x, 0.002, z, { yaw: d.range(0, 6), scale: d.range(0.6, 0.9) });
    }
  }
  for (const x of [-6.5, 7]) d.groundDecal('dirt', x * S, 0.002, 10.8 * S, 3 * S + 0.6, 0.8 * S + 0.6, 0, 0.6);
  return d.dressing;
};

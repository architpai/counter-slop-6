import { Dresser } from './dressing';
import { pieceInfo } from '../render/props';
import type { BuildOpts, LevelBuilder } from './build';
import type { DressMap, Opening, Wall } from './dressing';

/**
 * Downtown's realistic-tier dressing (docs/VISUALS.md, R6, V14, V16): the two
 * blocks' facades trimmed round their real openings, shop awnings and signs
 * over their doors, AC units, pipes, lamps and vents on their walls; the
 * perimeter wall dressed as the backs of buildings (fake doors and windows,
 * billboards, posters, pipes, tanks and antennas on its top); the row of
 * houses by the highway given windows, doors and trim; kerbs along the
 * streets; ceiling lights in the tower and the blocks; power cables
 * overhead; grime on every wall and street; and the skyline ring beyond the
 * perimeter. Low draws none of it (level/dressing.ts).
 */

const CAST: BuildOpts = { mat: 'blockAlt', material: 'cast-concrete' };
const LIGHT_CONCRETE: BuildOpts = { mat: 'block', material: 'concrete', tint: 0xf2efe8 };
const STUCCO_TRIM: BuildOpts = { mat: 'block', material: 'stucco', tint: 0xe9e4da };
const KERB: BuildOpts = { mat: 'ground', material: 'cast-concrete', tint: 0xd8d6d0 };
/** The tower's floor edges, in its frame's painted steel. */
const STEEL_EDGE: BuildOpts = { mat: 'blockDeep', material: 'painted-metal' };
/**
 * How dark the grime at a wall's foot gets. Grunts at 30-70 m stand in front of wall bases, so that
 * band stays light and plain (the readability guardrail, docs/VISUALS.md): no damp, cracks or
 * graffiti below head height on the walls that close the long views.
 */
const GRIME_BASE = 0.35;
/** Oil drums in a few paints. */
export const BARRELS = [0x2f58a8, 0xb8382f, 0x3f6a45, 0xd0a040, 0x5a5f63];
const YAW_OF: Readonly<Record<Wall['face'], number>> = { '+z': 0, '+x': Math.PI / 2, '-z': Math.PI, '-x': -Math.PI / 2 };

/** A facade: its wall, its span along it, and its height. */
type Face = readonly [Wall, number, number, number];

function block(x0: number, z0: number, x1: number, z1: number, height: number): Face[] {
  const t = 0.2;
  return [
    [{ face: '-z', plane: z0 - t }, x0 - t, x1 + t, height], [{ face: '+z', plane: z1 + t }, x0 - t, x1 + t, height],
    [{ face: '-x', plane: x0 - t }, z0 - t, z1 + t, height], [{ face: '+x', plane: x1 + t }, z0 - t, z1 + t, height],
  ];
}

/** Is a rectangle on a facade clear of every opening (by `margin`) and inside its span? */
function clear(openings: readonly Opening[], a0: number, a1: number, y0: number, y1: number, margin = 0.3): boolean {
  return openings.every(o => a1 < o.a0 - margin || a0 > o.a1 + margin || y1 < o.y0 - margin || y0 > o.y1 + margin);
}

export const dressDowntown: DressMap = (b, pass, world) => {
  const d = new Dresser(b, 'downtown', 0xd0e7, pass, world);
  const arena = b.level.arena, p = arena ? 68 : 55, ph = arena ? 30 : 18, inner = p - 3;

  // ---- the two blocks: A in white render, B in brick
  const blocks: [Face[], BuildOpts, readonly string[]][] = [
    [block(-43, 4, -25, 20, 12), STUCCO_TRIM, ['slop-mart', 'laundromat', 'staff-only', 'respawn']],
    [block(24, 4, 44, 20, 12), LIGHT_CONCRETE, ['gg-burgers', 'clown-college', 'exit', 'exit']],
  ];
  const awnings = [0xb8382f, 0x2c8f95, 0xe0762a, 0x5b3a8a, 0x3f6a45];
  for (const [faces, trim, signs] of blocks) {
    let door = 0;
    for (const [wall, a0, a1, height] of faces) {
      // The faces the long views run past (south, over the street, and towards the tower) keep their feet plain: a
      // base course, a pilaster, a drainpipe or a bench there is what a grunt is read against across the map
      // (docs/VISUALS.md, readability).
      const plain = wall.face === '-z' || (wall.plane < 0 ? wall.face === '+x' : wall.face === '-x');
      const openings = d.facade(wall, a0, a1, 0, height, {
        // B's cornice would move its shadow's edge on the ground where the arena's 10 m grunt stands: only A has one.
        ...(trim === LIGHT_CONCRETE ? {} : { cornice: { height: 0.4, opts: trim } }),
        frames: { width: 0.13, opts: trim, sill: LIGHT_CONCRETE }, grime: { base: plain ? 0 : GRIME_BASE, leaks: 0.7 },
        ...(plain ? {} : { plinth: { height: 0.55, opts: CAST }, pilasters: { width: 0.42, opts: trim } }),
      });
      // South faces carry the fire escapes: nothing hangs out over their landings.
      const escape = wall.face === '+z', taken: Opening[] = [...openings];
      for (const o of openings) {
        if (!o.door || escape) continue;
        const mid = (o.a0 + o.a1) / 2, width = o.a1 - o.a0;
        const sign = signs[door++ % signs.length]!, others = openings.filter(other => other !== o);
        if (sign === 'exit') {
          if (clear(others, mid - 0.35, mid + 0.35, o.y1 + 0.3, o.y1 + 0.65)) d.sign(sign, wall, mid, o.y1 + 0.3, 0.7, 0.35);
          continue;
        }
        const board = Math.min(4.2, width + 1.2);
        if (!clear(others, mid - board / 2, mid + board / 2, o.y1 + 0.1, o.y1 + 2.25)) continue;
        // No awning on the south faces: its shadow falls on the doorway where the long views stage a grunt (readability).
        if (wall.face !== '-z') d.onWall('awning', wall, mid, o.y1 + 0.95, { scale: [width + 0.5, 1, 1.15], tint: awnings[door % awnings.length] });
        d.sign(sign, wall, mid, o.y1 + 1.15, board, 1.1);
        taken.push({ a0: mid - board / 2 - 0.6, a1: mid + board / 2 + 0.6, y0: o.y1, y1: o.y1 + 2.25, door: false });
        for (const a of [o.a0 - 0.5, o.a1 + 0.5]) if (clear(others, a - 0.2, a + 0.2, o.y1, o.y1 + 0.6)) d.onWall('lamp-wall', wall, a, o.y1 + 0.2);
      }
      // AC units between the upper windows, a vent low down, a drainpipe at each end.
      for (const y of escape ? [] : [5.1, 9.1]) {
        for (let a = a0 + 1.6; a < a1 - 1.6; a += 3.1) {
          if (clear(taken, a - 0.5, a + 0.5, y - 0.1, y + 0.8) && d.random() < 0.45) d.onWall('ac-wall', wall, a, y);
        }
      }
      for (let a = a0 + 2; a < a1 - 2; a += 4.3) {
        if (clear(taken, a - 0.35, a + 0.35, 0.2, 0.7) && d.random() < 0.35) d.onWall('vent-wall', wall, a, 0.25);
      }
      for (const a of plain ? [] : [a0 + 0.75, a1 - 0.75]) {
        if (clear(taken, a - 0.1, a + 0.1, 0, height, 0.05)) d.onWall('downpipe', wall, a, 0, { scale: [1, height - 0.2, 1] });
      }
      // Dirt along the foot, and a bench, a planter or a bin against it where the walker grid leaves room, clear of the doors.
      if (!plain) d.footDirt(wall, a0 + 0.3, a1 - 0.3, 0, 0.5);
      let furniture = 0;
      for (let a = a0 + 1.4; a < a1 - 1.4 && furniture < 2 && !plain; a += d.range(2.2, 3.4)) {
        if (!clear(openings, a - 1, a + 1, 0, 1.2, 2.5)) continue;
        const piece = d.pick(['bench', 'planter-box', 'bin-street']), [x, , z] = d.at(wall, a, 0, piece === 'bin-street' ? 0.3 : 0.28);
        if (d.propIfClear(piece, x, 0, z, { yaw: YAW_OF[wall.face] })) furniture++;
      }
    }
  }

  // ---- edges on the large masses: stringers down every flight, a steel edge round the tower's floors, the highway
  // deck's edges and coping on its barriers (the perimeter's coping is with its dressing, below)
  d.stairs();
  if (!arena) for (const top of [4, 8, 12, 16]) d.fascia(-7, -7, 7, 7, top, 0.42, 0.045, STEEL_EDGE);
  d.fascia(-52, -34.5, 52, -25.5, 7, 0.6, 0.04, CAST);
  for (const wall of [{ face: '+z', plane: -34.1 }, { face: '-z', plane: -25.9 }] as Wall[]) d.coping(wall, -52, 52, 7.9, 0.4, 0.06, 0.04, CAST);

  // ---- inside: A's three floors and B's hall (skirting, switches and conduit, radiators, posters, shelving, dirt)
  const skirting: BuildOpts = { mat: 'dark', material: 'painted-wood' };
  for (const [floor, pictures] of [[0, ['staff-only', 'clock', 'lost-cat']], [4, ['respawn', 'landscape', 'clock']], [8, ['counter-slop', 'portrait']]] as const) {
    d.room(-42.8, 4.2, -25.2, 19.8, floor, 3.6, { skirting, pictures, grime: 0.55, shelves: true });
  }
  d.room(24.2, 4.2, 43.8, 19.8, 0, 12, { skirting, pictures: ['no-slop', 'high-voltage', 'clock', 'vote-bob'], grime: 0.6, shelves: true });

  // ---- ceilings: fluorescent fittings under every floor of A and the tower, and under B's roof (its hall is open to it)
  for (const [x0, z0, x1, z1, ceilings] of [[-43, 4, -25, 20, [3.6, 7.6, 11.6]], [24, 4, 44, 20, [11.6]]] as const) {
    for (const y of ceilings) {
      for (let x = x0 + 3; x < x1 - 2; x += 5) for (let z = z0 + 3; z < z1 - 2; z += 5) d.prop('light-ceiling', x, y, z, { yaw: Math.PI / 2 });
    }
  }
  if (!arena) {
    for (const y of [3.6, 7.6, 11.6]) for (const x of [-3.5, 3.5]) for (const z of [-3.5, 3.5]) d.prop('light-ceiling', x, y, z);
  }
  // Under the highway's deck, one fitting between each pair of piers.
  for (let x = -42; x <= 42; x += 12) d.prop('light-ceiling', x, 6.4, -30, { yaw: Math.PI / 2 });

  // ---- the perimeter wall, dressed as the backs of the city's buildings
  const perimeter: Wall[] = [{ face: '+x', plane: -inner }, { face: '-x', plane: inner }, { face: '+z', plane: -inner }, { face: '-z', plane: inner }];
  const gates = arena ? [] : [0, 30, -30];
  const billboards = ['counter-slop', 'vote-bob', 'respawn', 'honk', 'clown-college', 'gg-burgers', 'no-slop', 'slop-mart'];
  // Light posters, over head height: grunts at range stand against the perimeter (the readability guardrail).
  const posters = ['lost-cat', 'respawn', 'slop-mart', 'no-parking'];
  // The perimeter's ledges, along each wall (level/downtown.ts): nothing hangs in front of them.
  const ledges: readonly (readonly number[])[] = [[40, -30], [-10, 35], [-30, 30], [10, -40]];
  perimeter.forEach((wall, side) => {
    // Coping along its top edge; the walls along x butt against the others' (no two caps overlap at a corner).
    const end = wall.face.endsWith('x') ? inner - 0.1 : inner;
    d.coping(wall, -end, end, ph, 0.6, 0.06, 0.05, CAST);
    // No base course or grime along the perimeter's foot: seen from across the map, the band a grunt's background is
    // read in (docs/VISUALS.md, readability) falls there, so it stays the plain wall it always was.
    const openings = d.openings(wall, -inner, inner, 0, ph);
    const busy = (a: number, pad: number) => gates.some(g => Math.abs(a - g) < 2.2 + pad) || openings.some(o => a > o.a0 - pad && a < o.a1 + pad);
    const board = d.range(-18, 18), boards: [number, number][] = [[board, 8], [board > 0 ? board - 24 : board + 24, 6]];
    const covered = (a: number, pad: number) => boards.some(([c, w]) => Math.abs(a - c) < w / 2 + pad) || ledges[side]!.some(l => Math.abs(a - l) < 4 + pad);
    // Lamps over head height every so often (no doors down at street level: across the map the wall's foot is what a
    // grunt is read against, docs/VISUALS.md, readability), and windows in rows above the ledges.
    for (let a = -inner + 6 + side * 2; a < inner - 5; a += 13) if (!busy(a, 1.2) && d.random() < 0.7) d.onWall('lamp-wall', wall, a, 3.4);
    for (const y of arena ? [12.5, 16, 20.5, 24] : [12.4, 15.2]) {
      for (let a = -inner + 4.5 + (side % 2) * 1.5; a < inner - 4; a += 3.6) {
        if (d.random() < 0.72 && !covered(a, 0.8)) d.onWall('window', wall, a, y, { tint: d.pick([0xffffff, 0xf0e2c8, 0xd0dce6]) });
      }
    }
    // A billboard high up on each wall, posters and graffiti over head height, drainpipes down it.
    boards.forEach(([centre, width], i) => d.sign(billboards[side * 2 + i]!, wall, centre, arena ? 26 : 10.1, width, width * 0.45));
    for (let a = -inner + 3; a < inner - 3; a += 5.5) {
      if (busy(a, 1.2)) continue;
      const roll = d.random();
      if (roll < 0.22) d.sign(d.pick(posters), wall, a, 2.3, 0.8, 1.1, 'poster');
      else if (roll < 0.34) d.wallDecal(d.pick(['graffiti-slop', 'graffiti-clown']), wall, a, 3.9, 2.4, 2.4, d.range(0.55, 0.85));
      else if (roll < 0.5) d.wallDecal('damp', wall, a, d.range(4, 7), 2.5, 2.5, 0.6);
    }
    for (let a = -inner + 9; a < inner - 8; a += 17) if (!busy(a, 0.4) && !covered(a, 0.3)) d.onWall('downpipe', wall, a, 0, { scale: [1, ph - 0.3, 1] });
    for (let a = -inner + 2; a < inner - 2; a += 7) d.wallDecal('leaks', wall, a + d.range(-1, 1), ph - 1.2, 3, 2.4, 0.55);
    // Tanks and antennas along the wall's top, beyond the level's bounds: the walker grid (and a grappling player) stops
    // at them, 3 m in from the wall's face.
    const top: Wall = { face: wall.face, plane: wall.plane };
    for (let a = -inner + 8 + side * 3; a < inner - 6; a += 21) {
      const [x, , z] = d.at(top, a, ph, -5.4);
      d.prop(d.random() < 0.55 ? 'water-tank' : 'antenna', x, ph, z, { yaw: d.range(0, Math.PI), scale: d.range(0.9, 1.15) });
    }
    // Rooftop clutter between them: condensers, vents, and what the roofers left.
    for (let a = -inner + 3 + side * 2; a < inner - 3; a += d.range(4.5, 8)) {
      const [x, , z] = d.at(top, a, ph, -d.range(4.7, 5.2));
      const piece = d.pick(['ac-roof', 'ac-roof', 'vent-roof', 'vent-roof', 'crate', 'pallet', 'barrel', 'trash-bags']);
      d.prop(piece, x, ph, z, { yaw: YAW_OF[wall.face] + (piece.startsWith('ac') ? 0 : d.range(0, 6)), tint: piece === 'barrel' ? d.pick(BARRELS) : 0xffffff });
    }
  });

  // ---- the row of houses by the highway: windows, doors, trim
  const houses: [number, number, number][] = [[-30, 7, 0xffffff], [-8, 11, 0xe9e4da], [16, 7, 0xffffff]];
  for (const [x, height] of houses) {
    const faces = block(x - 6.8, -49.8, x + 6.8, -40.2, height);
    for (const [wall, a0, a1, h] of faces) {
      d.facade(wall, a0, a1, 0, h, { plinth: { height: 0.45, opts: CAST }, cornice: { height: 0.3, opts: LIGHT_CONCRETE }, grime: { base: GRIME_BASE, leaks: 0 } });
    }
    const south: Wall = { face: '+z', plane: -40 }, north: Wall = { face: '-z', plane: -50 };
    for (const wall of [south, north]) {
      for (const y of height > 8 ? [1.1, 4.6, 8.1] : [1.1, 4.3]) {
        for (let a = x - 5; a <= x + 5.01; a += 2.5) {
          // The fronts' ground floors stay blank: a 70 m figure on the street before them is read against them.
          if (wall === south && y < 2) continue;
          d.onWall('window', wall, a, y, { tint: height > 8 ? 0xd8dde2 : 0xffffff });
          d.wallDecal('leaks', wall, a, y - 0.5, 1.1, 1, 0.5);
        }
      }
    }
    d.onWall(height > 8 ? 'door-metal' : 'door-wood', south, x, 0);
    d.onWall('lamp-wall', south, x + 0.9, 2.45);
    // Clear of the perimeter's ledges behind the row (x = ±30).
    d.onWall('ac-wall', north, x > -20 ? x + 3.2 : x - 5.4, height - 1.3);
    for (const a of [x - 6.6, x + 6.6]) d.onWall('downpipe', south, a, 0, { scale: [1, height - 0.2, 1] });
  }
  d.sign('for-sale', { face: '+z', plane: -40 }, -24.5, 2.4, 1.4, 1);
  d.sign('parking', { face: '+z', plane: -40 }, 9.8, 2.3, 0.8, 0.8);

  // ---- the highway: grime and posters on its piers, leaks from its deck
  for (let x = -48; x <= 48; x += 12) {
    for (const wall of [{ face: '+z', plane: -29.3 }, { face: '-z', plane: -30.7 }] as Wall[]) {
      d.wallDecal('base', wall, x, 0.4, 1.4, 0.8, GRIME_BASE);
      d.wallDecal('leaks', wall, x, 5.4, 1.4, 2, 0.7);
      if (d.random() < 0.35) d.wallDecal('graffiti-slop', wall, x, 3.4, 1.4, 1.4, 0.7);
    }
    for (const wall of [{ face: '+x', plane: x + 0.7 }, { face: '-x', plane: x - 0.7 }] as Wall[]) d.wallDecal('base', wall, -30, 0.4, 1.4, 0.8, GRIME_BASE);
  }
  for (const z of [-34.5, -25.5]) for (let x = -50; x < 50; x += 6) d.wallDecal('leaks', { face: z < -30 ? '-z' : '+z', plane: z }, x + d.range(0, 3), 5.6, 2.6, 1.6, 0.6);

  // ---- kerbs along the avenues and the road under the highway, broken at the crossings
  const edge = inner, kerb = (x0: number, z0: number, x1: number, z1: number) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    d.trim((x0 + x1) / 2, 0, (z0 + z1) / 2, alongX ? Math.abs(x1 - x0) : 0.18, 0.12, alongX ? 0.18 : Math.abs(z1 - z0), KERB);
  };
  for (const x of [-16, 16]) {
    for (const side of [-1, 1]) {
      const kx = x + side * 3.09;
      kerb(kx, -edge, kx, -35.1);
      kerb(kx, -24.9, kx, edge);
    }
  }
  for (const z of [-35.09, -24.91]) {
    kerb(-edge, z, -19.1, z);
    kerb(-12.9, z, 12.9, z);
    kerb(19.1, z, edge, z);
  }

  // Dirt and leaves in the gutters along the kerbs.
  for (const x of [-16, 16]) {
    for (const side of [-1, 1]) {
      const wall: Wall = { face: side > 0 ? '-x' : '+x', plane: x + side * 3 };
      d.footDirt(wall, -edge + 1, -35.5, 0.04, 0.55, 0.6);
      d.footDirt(wall, -24.5, edge - 1, 0.04, 0.55, 0.6);
    }
  }

  // ---- the streets: patches, cracks, covers, drains, oil and skid marks
  for (const x of [-16, 16]) {
    for (let z = -48; z < 48; z += 7) {
      const roll = d.random();
      if (roll < 0.25) d.groundDecal('patch', x + d.range(-1.5, 1.5), 0.04, z, d.range(1.4, 2.4), d.range(1.2, 2.2), d.range(0, 0.3), 0.8);
      else if (roll < 0.4) d.groundDecal('cracks', x + d.range(-2, 2), 0.04, z, 1.5, 1.5, d.range(0, 6), 0.5);
      else if (roll < 0.55) d.groundDecal('oil', x + d.range(-1.5, 1.5), 0.04, z, 1.3, 1.3, d.range(0, 6), 0.7);
      else if (roll < 0.65) d.groundDecal('skid', x + d.range(-1, 1), 0.04, z, 1.6, 4.5, d.range(-0.2, 0.2), 0.6);
    }
    for (let z = -44; z < 48; z += 22) d.groundDecal('cover', x, 0.04, z, 0.95, 0.95, 0, 0.9);
    for (let z = -40; z < 48; z += 16) d.groundDecal('drain', x + 2.55, 0.04, z, 0.9, 0.5, Math.PI / 2, 0.9);
    // Grime gathers in the gutters by the drains and where cars stop.
    for (let z = -40; z < 48; z += 16) d.scatter(x + 2.3, 0.04, z, 1.4, 3, ['stain', 'oil', 'leaf-litter'], 0.55);
  }
  for (let x = -48; x < 48; x += 6.5) {
    const roll = d.random();
    if (roll < 0.3) d.groundDecal('patch', x, 0.04, -30 + d.range(-3, 3), d.range(1.5, 2.6), d.range(1.2, 2), d.range(0, 0.3), 0.8);
    else if (roll < 0.55) d.groundDecal('oil', x, 0.04, -30 + d.range(-3, 3), 1.2, 1.2, d.range(0, 6), 0.6);
    else if (roll < 0.68) d.groundDecal('cracks', x, 0.04, -30 + d.range(-3, 3), 1.5, 1.5, d.range(0, 6), 0.5);
  }
  // Litter, papers and flattened boxes along the kerbs and walls: flat enough to walk over.
  for (let i = 0; i < 52; i++) {
    const x = d.pick([-19.4, -12.6, 12.6, 19.4]) + d.range(-0.3, 0.3), z = d.range(-50, 50);
    if (Math.abs(z + 30) < 6) continue;
    d.prop(d.pick(['litter', 'litter', 'papers', 'cardboard-flat']), x, 0, z, { yaw: d.range(0, 6), scale: d.range(0.7, 1.1) });
  }
  // The ground's grime gathers where wear collects: round the feet of the benches, lamps, the pencil, the concrete pipe,
  // the tower and the highway's piers, and a few large, faint patches over the open ground between (the arena's
  // fainter, and its north side, the lane its spawns look down, clean: docs/VISUALS.md, readability).
  const worn = ['stain', 'stain', 'ground', 'puddle', 'oil', 'gum', 'burn'];
  const spots: [number, number, number][] = [[-16, -8, 2.2], [18, -10, 2.2], [-20, 8, 2], [20, -2, 2], [-8, -18, 2.4], [8, -18, 2.4], [0, 22, 2.6],
    [-7.5, -7.5, 1.6], [7.5, -7.5, 1.6], [-7.5, 7.5, 1.6], [7.5, 7.5, 1.6], [-40, 32, 3.2], [-30, 42, 3], [24, 38, 3.2], [-22, 24, 1.4], [22, 24, 1.4]];
  for (let x = -48; x <= 48; x += 12) spots.push([x, -27.5, 1.3], [x, -32.5, 1.3]);
  for (const [x, z, radius] of spots) {
    if ((arena && (z > 36 || (Math.abs(x) < 8 && Math.abs(z) < 8))) || (Math.abs(x) < 12.2 && z > 9.8)) continue;
    // Under the highway the road's top is 4 cm up.
    d.scatter(x, Math.abs(z + 30) < 5.5 ? 0.04 : 0.001, z, radius, Math.round(radius * 1.6), worn, arena ? 0.4 : 0.6);
  }
  for (let i = 0; i < 10; i++) {
    const x = d.range(-50, 50), z = d.range(-50, 50), size = d.range(3.5, 5.5);
    if (Math.abs(Math.abs(x) - 16) < 3.5 || Math.abs(z + 30) < 5.5 || (Math.abs(x) < 12.2 && z > 9.8) || (arena && z > 36)) continue;
    d.groundDecal(d.pick(['ground', 'ground', 'stain']), x, 0.001, z, size, size * d.range(0.7, 1.3), d.range(0, 6), d.range(0.2, 0.3));
  }
  // The plaza's paving (both layouts): grime in the joints along its edges, stains, gum and footprints along the lines
  // people walk and round what stands on it, a few large faint patches. The arena's plaza, the background of its long
  // lanes, fainter, and none past z = 36.
  const tiles = arena ? 0.55 : 1, top = arena ? 36 : 49.5;
  for (let z = 11; z < top; z += d.range(2.5, 4)) {
    for (const x of [-11.3, 11.3]) if (d.random() < 0.7) d.groundDecal('tile-grime', x + d.range(-0.3, 0.3), 0.013, z, 1.6, 2.4, 0, 0.6 * tiles);
  }
  for (let x = -10; x <= 10; x += d.range(2.8, 4)) d.groundDecal('tile-grime', x, 0.013, 10.9, 2.4, 1.6, 0, 0.6 * tiles);
  const walked: [number, number, number, number, number][] = arena ? [[0, 20, 2.5, 22, 0]] : [[0, 30, 3, 14, 0], [-6, 38, 2.5, 10, 0.8], [6, 22, 2.5, 9, -0.6]];
  for (const [x, z, w, l, turn] of walked) {
    d.groundDecal('worn', x, 0.013, z, w, l, turn, 0.7 * tiles);
    for (let t = -0.45; t <= 0.45; t += d.range(0.12, 0.2)) {
      const px = x + Math.sin(turn) * t * l + d.range(-0.6, 0.6), pz = z - Math.cos(turn) * t * l;
      d.groundDecal(d.pick(['gum', 'footprints', 'stain', 'gum']), px, 0.013, pz, d.range(0.6, 1.4), d.range(0.8, 1.6), turn, d.range(0.5, 0.75) * tiles);
    }
  }
  const standing: [number, number, number][] = arena ? [[-8, 20, 1.8], [10, 26, 1.4]]
    : [[-6, 28, 1.8], [8, 26, 1.6], [-12, 31.5, 1.4], [-12, 36.8, 1.4], [11, 37.6, 1.6], [-4, 46, 1.6], [4, 46, 1.6], [-10, 46, 1.2], [10, 46, 1.2]];
  for (const [x, z, radius] of standing) d.scatter(x, 0.013, z, radius, 4, ['stain', 'puddle', 'gum', 'leaf-litter', 'stain'], 0.7 * tiles);
  for (let i = 0; i < 5; i++) {
    const size = d.range(3, 4.5);
    d.groundDecal(d.pick(['ground', 'stain']), d.range(-9, 9), 0.013, d.range(12, top - 2), size, size * d.range(0.8, 1.2), d.range(0, 6), d.range(0.2, 0.3) * tiles);
  }
  // Dirty joints in patches, and spills where something was dropped or stood: grouped, a few metres each.
  for (let i = 0; i < 9; i++) {
    const x = d.range(-10, 10), z = d.range(12, top - 1.5);
    d.scatter(x, 0.013, z, d.range(1.2, 2.2), 3, i % 3 ? ['tile-grime', 'tile-grime', 'stain'] : ['puddle', 'stain', 'gum'], 0.6 * tiles);
  }
  // Papers, litter and leaves blown about the paving, flat enough to walk over.
  for (let i = 0; i < 14; i++) {
    const edge = d.random() < 0.6, x = edge ? d.pick([-1, 1]) * d.range(9.5, 11.6) : d.range(-9, 9), z = d.range(11, top - 1);
    d.prop(d.pick(['papers', 'litter', 'leaves', 'papers', 'cardboard-flat']), x, 0.013, z, { yaw: d.range(0, 6), scale: d.range(0.7, 1.1) });
  }
  if (!arena) {
    // Leaves, papers and flattened boxes blown against the plaza's containers, crates and benches.
    for (const [x, z] of [[-12.4, 31.5], [-12.4, 36.8], [11.2, 37.6], [-4.4, 29.6], [9.2, 27.6], [16.6, 38.2], [-5.2, 45.3], [5.2, 45.3]] as const) {
      d.groundDecal('leaf-litter', x, 0.013, z, 1.8, 1.8, d.range(0, 6), 0.8);
      d.prop(d.pick(['leaves', 'leaves', 'papers', 'cardboard-flat']), x + d.range(-0.3, 0.3), 0.013, z + d.range(-0.3, 0.3), { yaw: d.range(0, 6) });
    }
    // Bags, boxes and a drum tucked against the plaza's crates, containers and the truck, where nobody walks.
    d.tuck([-30, 10, 30, 50], 0, 12, ['trash-bags', 'cardboard', 'crate-small', 'barrel'], 10);
    // Cables strung between the plaza's lamps and to the blocks and the perimeter, overhead.
    for (const [from, to, sag] of [[[-10, 6.1, 46], [10, 6.1, 46], 0.6], [[-10, 6.1, 46], [-19, 12.5, inner - 0.05], 0.4],
      [[10, 6.1, 46], [19, 12.5, inner - 0.05], 0.4], [[-22, 6.1, 24], [-24.8, 10.6, 18], 0.4], [[22, 6.1, 24], [23.8, 10.6, 18], 0.4]] as const) {
      d.cable(from, to, sag);
    }
  }
  // Clutter against the highway's piers and the tower's feet, where the walker grid leaves room.
  d.tuck([-52, -34, 52, 8], 0, 3, ['trash-bags', 'cardboard', 'crate-small', 'cone'], 8);

  // ---- power and phone cables overhead, from the blocks to the perimeter
  for (const z of [7, 13.5, 18]) {
    d.cable([-43.3, 10.4, z], [-inner + 0.05, 13 + d.range(-0.6, 0.6), z + d.range(-2, 2)], 0.7);
    d.cable([44.3, 10.4, z], [inner - 0.05, 13 + d.range(-0.6, 0.6), z + d.range(-2, 2)], 0.7);
  }
  for (const [x, height] of houses) {
    const a = x > -20 ? x + 3 : x - 5.8;
    d.cable([a, height - 0.6, -50.05], [a + d.range(-1, 1), 13, -inner + 0.05], 0.4);
  }

  // ---- the skyline beyond the perimeter (V14): distant blocks in a ring, fogged
  const towers = ['skyline-a', 'skyline-b', 'skyline-c', 'skyline-d', 'skyline-e'];
  // The arena's square play space reaches 92 m out at its corners, under a dome of 116: its blocks stand off its sides only.
  // Tinted towards the fog's blue-grey. No block rises behind the tower's levels or the catwalks as the start sees
  // them (its tops under 0.23 of the way up from there: just over the perimeter's top), so grunts up there stand
  // against the sky (the readability guardrail); elsewhere a block's top stays under 0.36 of its distance from the middle.
  const count = 22, from = arena ? 92 : 115, to = arena ? 106 : 175, start = b.level.playerStart;
  for (let i = 0; i < count; i++) {
    const angle = (i + d.range(-0.3, 0.3)) / count * Math.PI * 2, r = d.range(from, to);
    if (arena && Math.abs(Math.sin(2 * angle)) > 0.45) continue;
    const piece = towers[i % towers.length]!, x = Math.cos(angle) * r, z = Math.sin(angle) * r, y = d.range(-6, 0), scale = d.range(0.8, 1.15);
    const seen = Math.hypot(x - start.x, z - start.z), behind = !arena && z < start.z && Math.abs(x) < 0.85 * (start.z - z);
    const cap = behind ? 0.23 * seen + 1.6 : 0.36 * r, tall = pieceInfo(piece).max[1] * scale;
    d.prop(piece, x, y, z, { yaw: d.range(0, Math.PI), scale: [scale, scale * Math.min(1, (cap - y) / tall), scale],
      tint: d.pick([0xc4ccd2, 0xb8c0c8, 0xccd0d0, 0xbcc4cc]) });
  }

  // ---- last, so the generator's draws above stay as they were: at eye level on the blocks' dressed faces (not the
  // plain ones the long views run past), a meter box with its conduit up the wall and a few posters and stickers, clear
  // of the openings; papers and leaves blown against their feet.
  for (const [faces] of blocks) {
    for (const [wall, a0, a1, height] of faces) {
      if (wall.face === '-z' || (wall.plane < 0 ? wall.face === '+x' : wall.face === '-x')) continue;
      const openings = d.openings(wall, a0, a1, 0, height);
      let meter = false, posted = 0;
      for (let a = a0 + 1.6; a < a1 - 1.6; a += d.range(1.6, 2.6)) {
        if (!clear(openings, a - 0.5, a + 0.5, 0.4, 3.2, 0.2)) continue;
        if (!meter) {
          d.onWall('meter-box', wall, a, 1.65);
          d.onWall('conduit', wall, a, 2.15, { scale: [1, 1.4, 1] });
          meter = true;
        } else if (posted < 3 && d.random() < 0.6) {
          d.sign(d.pick(['lost-cat', 'respawn', 'no-parking', 'vote-bob', 'slop-mart']), wall, a, d.range(1.1, 1.4), 0.6, 0.85, 'poster');
          posted++;
        }
      }
      for (let a = a0 + 1; a < a1 - 1; a += d.range(2.5, 4.5)) {
        const [x, , z] = d.at(wall, a, 0, d.range(0.2, 0.6));
        d.prop(d.pick(['papers', 'leaves', 'litter', 'leaves']), x, 0.002, z, { yaw: d.range(0, 6), scale: d.range(0.6, 0.9) });
      }
    }
  }
  return d.dressing;
};

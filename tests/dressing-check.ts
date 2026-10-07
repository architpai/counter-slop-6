import * as THREE from 'three';
import { NAV_HEADROOM, NavGrid } from '@/engine/nav';
import { WALK_COLUMN, WALK_FLOOR } from '@/engine/level/dressing';
import { placementBox } from '@/engine/render/props';
import type { World } from '@/engine/physics';
import type { Level } from '@/engine/types';

/**
 * Where a map's realistic-tier dressing (docs/VISUALS.md, R6) could get in
 * the way of play, for tests/dressing.test.ts (and by hand, through Node).
 *
 * Walk volume: every nav node players and enemies can reach (a component of
 * the walker grid holding a spawn, a perch, a pickup or the start, or with a
 * top a grapple can land on: a rock stack's tiers, a wall's top) and the
 * middle of every link between two of them, as a column `COLUMN` either
 * side of its middle, from `FLOOR` over the floor (flat dressing: decals,
 * kerbs) to the grid's headroom. Sightlines: from every spawn at eye height
 * to every other marker at eye height within `SIGHT_RANGE`, where the
 * colliders let it through. A piece may touch neither; cables thinner than
 * `THIN` do not block a line (they are a pixel or two wide), and a hit
 * within `GRAZE` of a collider is on a line that already grazes it.
 */
export const COLUMN = WALK_COLUMN;
export const FLOOR = WALK_FLOOR;
export const HEADROOM = NAV_HEADROOM;
export const EYE = 1.6;
export const SIGHT_RANGE = 70;
export const THIN = 0.03;
/** A sightline hit this near a collider grazes that collider already (level/dressing.ts `WALL_DEPTH`, and a little). */
export const GRAZE = 0.14;

export interface Blocker {
  what: string;
  box: THREE.Box3;
  /** Triangles for realistic-only trim; boxes stand for props and cable segments. */
  triangle?: THREE.Triangle;
  thin: boolean;
}

/** Every visual piece of a level's dressing: kit props by their bounds, cable segments, and the realistic-only trim's triangles. */
export function blockers(level: Level): Blocker[] {
  const out: Blocker[] = [];
  for (const p of level.dressing?.props ?? []) out.push({ what: `${p.piece} @ ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`, box: placementBox(p), thin: false });
  for (const c of level.dressing?.cables ?? []) {
    const a = new THREE.Vector3(...c.from), b = new THREE.Vector3(...c.to), prev = a.clone();
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, point = a.clone().lerp(b, t);
      point.y -= 4 * c.sag * t * (1 - t);
      out.push({ what: `cable @ ${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)}`,
        box: new THREE.Box3().setFromPoints([prev, point]).expandByScalar(c.radius), thin: 2 * c.radius < THIN });
      prev.copy(point);
    }
  }
  for (const surface of level.surfaces) {
    if (!surface.realOnly) continue;
    const g = surface.mesh.geometry, position = g.getAttribute('position'), index = g.index!;
    surface.mesh.updateWorldMatrix(true, false);
    for (let i = 0; i < index.count; i += 3) {
      const tri = new THREE.Triangle(...[0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + k)).applyMatrix4(surface.mesh.matrixWorld)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]);
      const box = new THREE.Box3().setFromPoints([tri.a, tri.b, tri.c]);
      out.push({ what: `trim (${surface.surf}) @ ${box.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(1)).join(',')}`, box, triangle: tri, thin: false });
    }
  }
  return out;
}

function touches(blocker: Blocker, box: THREE.Box3): boolean {
  if (!blocker.box.intersectsBox(box)) return false;
  return blocker.triangle ? box.intersectsTriangle(blocker.triangle) : true;
}

/** The markers play happens at. */
export function markers(level: Level): THREE.Vector3[] {
  return [level.playerStart, ...level.spawns, ...level.snipers, ...level.pickups, ...level.arenaSpawns, ...level.teamSpawns.flat(),
    ...(level.bossPerch ? [level.bossPerch.position, ...level.bossPerch.route] : [])];
}

/** The walker grid's nodes in components a player can reach (a marker's, or a grapple's), and their links' middles. */
export function walkColumns(level: Level, world: World): THREE.Box3[] {
  const nav = new NavGrid(world, level.bounds, 1);
  nav.build();
  const component = new Int32Array(nav.nodes.length).fill(-1);
  let count = 0;
  for (const start of nav.nodes) {
    if (component[start.id] !== -1) continue;
    const stack = [start.id];
    component[start.id] = count;
    while (stack.length) {
      for (const link of nav.nodes[stack.pop()!]!.links) {
        if (component[link.to] === -1) { component[link.to] = count; stack.push(link.to); }
      }
    }
    count++;
  }
  const live = new Set<number>(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
  for (const m of markers(level)) {
    for (const node of nav.nodes) if (Math.abs(node.x - m.x) < 1.5 && Math.abs(node.z - m.z) < 1.5 && Math.abs(node.y - m.y) < 1.2) live.add(component[node.id]!);
  }
  // A grapple reaches any top that is not noGrapple (player/grapple.ts), so a player can stand on every component with
  // one: a rock stack's tiers, a wall's top.
  for (const node of nav.nodes) {
    if (live.has(component[node.id]!)) continue;
    const under = world.query(lo.set(node.x - 0.05, node.y - 0.01, node.z - 0.05), hi.set(node.x + 0.05, node.y + 0.01, node.z + 0.05));
    if (under.some(box => !box.data.noNav && !box.data.noGrapple && Math.abs(box.max.y - node.y) < 1e-3)) live.add(component[node.id]!);
  }
  const columns: THREE.Box3[] = [];
  const column = (x: number, y: number, z: number) => columns.push(new THREE.Box3(new THREE.Vector3(x - COLUMN, y + FLOOR, z - COLUMN), new THREE.Vector3(x + COLUMN, y + HEADROOM, z + COLUMN)));
  for (const node of nav.nodes) {
    if (!live.has(component[node.id]!)) continue;
    column(node.x, node.y, node.z);
    for (const link of node.links) {
      if (link.to < node.id) continue;
      const other = nav.nodes[link.to]!;
      column((node.x + other.x) / 2, Math.max(node.y, other.y), (node.z + other.z) / 2);
    }
  }
  return columns;
}

/** Pieces that stand in the walk volume, with the first column each touches. */
export function inWalkVolume(level: Level, world: World, list = blockers(level)): string[] {
  const columns = walkColumns(level, world), out: string[] = [];
  // Columns by the metre cells they reach, so each piece meets only its neighbours'.
  const cells = new Map<string, THREE.Box3[]>();
  const each = (box: THREE.Box3, visit: (key: string) => void) => {
    for (let x = Math.floor(box.min.x); x <= Math.floor(box.max.x); x++) for (let z = Math.floor(box.min.z); z <= Math.floor(box.max.z); z++) visit(`${x},${z}`);
  };
  for (const column of columns) each(column, key => { let list = cells.get(key); if (!list) cells.set(key, list = []); list.push(column); });
  for (const blocker of list) {
    const near = new Set<THREE.Box3>();
    each(blocker.box, key => { for (const column of cells.get(key) ?? []) near.add(column); });
    const hit = [...near].find(column => touches(blocker, column));
    if (hit) out.push(`${blocker.what} in the walk column at ${hit.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(1)).join(',')}`);
  }
  return out;
}

/** The sightlines between markers the colliders leave open (eye height, within range), as segments. */
export function sightlines(level: Level, world: World): [THREE.Vector3, THREE.Vector3][] {
  const eyes = markers(level).map(m => m.clone().setY(m.y + EYE)), out: [THREE.Vector3, THREE.Vector3][] = [];
  const seen = new Set<string>();
  for (const from of [...level.spawns, ...level.arenaSpawns, level.playerStart].map(m => m.clone().setY(m.y + EYE))) {
    for (const to of eyes) {
      const key = [from, to].map(v => v.toArray().map(c => c.toFixed(2)).join()).sort().join('|');
      if (seen.has(key) || from.distanceTo(to) < 1 || from.distanceTo(to) > SIGHT_RANGE) continue;
      seen.add(key);
      if (world.lineOfSight(from, to)) out.push([from, to]);
    }
  }
  return out;
}

/** Pieces that cut an open sightline between markers. */
export function blockingSightlines(level: Level, world: World, list = blockers(level)): string[] {
  const out: string[] = [], ray = new THREE.Ray(), hit = new THREE.Vector3(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
  for (const [from, to] of sightlines(level, world)) {
    const length = from.distanceTo(to);
    ray.set(from, to.clone().sub(from).normalize());
    for (const blocker of list) {
      if (blocker.thin) continue;
      const near = ray.intersectBox(blocker.box, hit);
      if (!near || near.distanceTo(from) > length) continue;
      const point = blocker.triangle ? ray.intersectTriangle(blocker.triangle.a, blocker.triangle.b, blocker.triangle.c, false, hit) : near;
      // A line that already grazes a collider there (along a wall, round a corner) is not one a wall piece can take away.
      if (point && point.distanceTo(from) < length && world.query(lo.copy(point).subScalar(GRAZE), hi.copy(point).addScalar(GRAZE)).length === 0) {
        out.push(`${blocker.what} cuts ${from.toArray().map(v => v.toFixed(1))} -> ${to.toArray().map(v => v.toFixed(1))}`);
        break;
      }
    }
  }
  return out;
}

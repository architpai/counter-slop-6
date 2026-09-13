import { Vector3 } from 'three';
import { Body } from '../physics';
import type { NavGrid } from '../nav';
import type { Ctx, Level } from '../types';

type Point = [number, number, number];

/** Authored markers only: never add collision or change the map's navigation. */
export function assignBossPerch(level: Level): void {
  let position: Point, route: Point[];
  if (level.key === 'downtown' && !level.arena) {
    position = [0, 16, -3];
    route = [[-10, 0, 42], [-10, 0, -13], [-6.5, 0, -13], [-6.5, 0, -8.3],
      [2.4, 4, -8.3], [2.4, 4, -10.3], [-5.7, 8, -10.3], [-5.7, 8, -8.3],
      [2.4, 12, -8.3], [2.4, 12, -10.3], [-5.7, 16, -10.3], [-5.7, 16, -5.5], position];
  } else if (level.key === 'mexico') {
    // Northwest house: the existing exterior flight reaches its 6.35 m roof.
    position = [-40, 6.35, -20];
    route = [[-26, 0, 16], [-30.5, 0, 16], [-30.5, 0, -11], [-47, 0, -11],
      [-47, 0, -14.3], [-46.4, 0, -14.3], [-37.2, 6.35, -14.3], [-37.2, 6.35, -17], position];
  } else if (level.key === 'house') {
    position = [0, 13.52, 1.3];
    // The interior stairs stop at 2F. The sealed roof has no walking entrance;
    // its invisible slope steps serve grapples, not a ground-to-roof stairway.
    route = [];
  } else {
    delete level.bossPerch;
    return;
  }
  level.bossPerch = { position: new Vector3(...position), route: route.map(p => new Vector3(...p)) };
}

const finite = (p: Vector3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

function navEndpoint(nav: NavGrid, position: Vector3): boolean {
  const node = nav.nodes[nav.nearest(position, 1, .1)];
  // nearest() can return a fallback on another storey. It is not proof of support.
  return !!node && Math.abs(node.y - position.y) < .1
    && Math.hypot(node.x - position.x, node.z - position.z) < 1.5;
}

/** Walk the authored route with player physics, without jumping or grappling. */
export function validBossPerch({ level, world, nav, bossNav }: Pick<Ctx, 'level' | 'world' | 'nav' | 'bossNav'>): Vector3 | null {
  const marker = level.bossPerch;
  if (!marker || !finite(marker.position) || !marker.route.length || !marker.route.every(finite)
    || !finite(level.playerStart)) return null;
  const position = marker.position;
  // AIMBOT is a scale-1.6 humanoid, not the larger generic boss-grid body.
  if (world.overlapsBody(new Body(position, .528, 2.96))) return null;
  for (const [dx, dz] of [[0, 0], [-.527, -.527], [-.527, .527], [.527, -.527], [.527, .527]] as const) {
    if (Math.abs(world.groundBelow(position.x + dx, position.y + .03, position.z + dz, .06) - position.y) > .01) return null;
  }
  if (!navEndpoint(nav, position) || !navEndpoint(bossNav, position)) return null;

  const body = new Body(level.playerStart, .35, 1.75, .55);
  // Spawn markers can sit slightly inside the plaza paving. Settle in place;
  // never teleport to a nav node or to the first authored approach point.
  for (let frame = 0; frame < 60; frame++) {
    body.vel.y -= 26 / 60;
    world.moveBody(body, 1 / 60);
  }
  if (!body.onGround || world.overlapsBody(body) || body.pos.distanceTo(level.playerStart) > .55
    || !navEndpoint(nav, body.pos)) return null;
  for (const target of [...marker.route, position]) {
    for (let frame = 0; frame < 900; frame++) {
      const dx = target.x - body.pos.x, dz = target.z - body.pos.z, distance = Math.hypot(dx, dz);
      if (distance < .07) break;
      const speed = Math.min(4, distance * 60);
      body.vel.set(dx / distance * speed, body.vel.y - 26 / 60, dz / distance * speed);
      world.moveBody(body, 1 / 60);
    }
    if (body.pos.distanceTo(target) >= .1 || !body.onGround || world.overlapsBody(body)) return null;
  }
  return position.clone();
}

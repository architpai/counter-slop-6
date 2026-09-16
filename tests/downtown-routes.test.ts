import { expect, test } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Body, World } from '@/engine/physics';
import { buildLevel, disposeLevel } from '@/engine/level';

type Point = [number, number, number];
const routes: [string, Point[]][] = [
  ['tower first landing', [[-6.5, 0, -8.3], [2.4, 4, -8.3], [2.4, 4, -5.5]]],
  ['tower second landing', [[2.4, 4, -10.3], [-5.7, 8, -10.3], [-5.7, 8, -5.5]]],
  ['tower third landing', [[-5.7, 8, -8.3], [2.4, 12, -8.3], [2.4, 12, -5.5]]],
  ['tower roof landing', [[2.4, 12, -10.3], [-5.7, 16, -10.3], [-5.7, 16, -5.5]]],
  ['A floor 1 door', [[-27, 0, 21.2], [-35.8, 4, 21.2], [-35.8, 4, 18.8]]],
  ['A floor 2 door', [[-36.3, 4, 23.2], [-27.4, 8, 23.2], [-27.4, 8, 18.8]]],
  ['A roof door', [[-27.4, 8, 21.2], [-35.8, 12, 21.2], [-35.8, 12, 18.8]]],
  ['B full fire escape', [[26, 0, 21.2], [34.8, 4, 21.2], [34.8, 4, 23.2], [26.4, 8, 23.2], [26.4, 8, 21.2], [34.8, 12, 21.2], [34.8, 12, 18.8]]],
  ['B interior landing', [[27.2, 0, 6.5], [27.2, 6, 18.8]]],
  ['west highway landing', [[-48, 0, -24.5], [-34, 7, -24.5], [-34, 7, -28]]],
  ['east highway landing', [[48, 0, -24.5], [34, 7, -24.5], [34, 7, -28]]],
  ['A to tower bridge', [[-26, 12, 5.5], [-5, 12, 5.5]]],
  ['tower to B bridge', [[5, 12, 5.5], [25.5, 12, 5.5]]],
  ['west house rooftop', [[-24.5, 7, -45], [-14, 11, -45]]],
  ['east house rooftop', [[10.5, 7, -45], [-2, 11, -45]]],
];

for (const arena of [false, true]) test(`Downtown ${arena ? 'arena' : 'solo'} stairs connect to walkable landings and bridges`, () => {
  const scene = new Scene(), world = new World();
  const level = buildLevel(scene, world, 'downtown', { arena });
  try {
    for (const [name, points] of routes) {
      if (arena && name.startsWith('tower ') && !name.includes('bridge')) continue; // Arena has no central tower.
      const body = new Body(new Vector3(...points[0]!), .35, 1.75, .55);
      body.onGround = true;
      for (const [x, y, z] of points.slice(1)) {
        for (let frame = 0; frame < 900; frame++) {
          const dx = x - body.pos.x, dz = z - body.pos.z, distance = Math.hypot(dx, dz);
          if (distance < .07) break;
          const speed = Math.min(4, distance * 60);
          body.vel.set(dx / distance * speed, body.vel.y - 26 / 60, dz / distance * speed);
          world.moveBody(body, 1 / 60);
        }
        expect(body.pos.distanceTo(new Vector3(x, y, z)), `${name}: reached ${body.pos.toArray()} instead of ${[x, y, z]}`).toBeLessThan(.1);
      }
    }
  } finally { disposeLevel(scene, level); world.clear(); }
});

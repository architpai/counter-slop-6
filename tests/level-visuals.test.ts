import { expect, test } from 'vitest';
import { Scene } from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';

// Decorative trim must not change collision, navigation or spawns.
// Downtown includes the intended stair-landing and rail-opening fixes;
// downtown-routes.test.ts verifies those routes with walking bodies.
const baseline = {
  downtown: '1cf24dad1c58f85f937ffb033791a285963698d4b50f616c17214b38268b00fe',
  house: 'db9fb9825dc0dcd6e71b13bf1a6db5bbfde738232e4d5fd409712c691fa5219e',
  mexico: 'c778bdf88edacf2a16541629e06e232dd3bd8fc9c179b3abcb2591247e90e141',
};

test('visual polish preserves the playable maps', async () => {
  for (const [key, expected] of Object.entries(baseline)) {
    const scene = new Scene(), world = new World();
    const level = buildLevel(scene, world, key);
    try {
      const nav = new NavGrid(world, level.bounds, 1);
      nav.build();
      const shape = {
        boxes: world.boxes.map(b => [b.min.toArray(), b.max.toArray(), b.data.noNav, b.data.noShoot, b.data.noGrapple]),
        start: level.playerStart.toArray(),
        spawns: level.spawns.map(v => v.toArray()),
        snipers: level.snipers.map(v => v.toArray()),
        pickups: level.pickups.map(v => v.toArray()),
        nodes: nav.nodes.length,
      };
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(shape)));
      const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      expect(actual, `${key} collision and markers`).toBe(expected);
    } finally {
      disposeLevel(scene, level);
    }
  }
});

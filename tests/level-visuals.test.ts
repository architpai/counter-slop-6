import { expect, test } from 'vitest';
import { Scene } from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';

// Decorative trim must not change collision, navigation or spawns.
// Downtown includes the intended stair-landing and rail-opening fixes;
// downtown-routes.test.ts verifies those routes with walking bodies.
// Node counts reflect the 0.42 nav clearance (physics-nav.md 5.3).
const baseline = {
  downtown: 'd4cba9f111e79fc4b422ef82e905f3e6f529ee1865a674702ca08f0d0210a9c1',
  house: 'c2c62a1d4dfd5d56b95e9ae1923ffc10ef77d84116f27c96556be5aa885d6a87',
  mexico: 'b6e7e398997c31deae6bf346ff1794004201d6deb17030cbca92aaa93c827fd9',
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

import { expect, test } from 'vitest';
import { Scene } from 'three';
import { buildLevel, disposeLevel } from '@/engine/level';
import { World } from '@/engine/physics';
import { NavGrid } from '@/engine/nav';

// Captured from newmap2 before visual polish. Change these only for an intended
// layout change: decorative trim must not change collision, navigation or spawns.
const baseline = {
  downtown: 'ff40e3e64be1aded7c01ab7d81a86d82f2427560a883d3248e66c56b463960bb',
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

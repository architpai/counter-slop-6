import { expect, test } from 'vitest';
import { Mesh } from 'three';
import { makeModel } from '@/engine/enemies/model';
import { TYPES } from '@/engine/enemies/types';
import { makeFigure, makeWeaponProp } from '@/engine/render/figure';
import { GUN_LOADOUT } from '@/engine/weapons/stats';

test('every enemy has a distinct clown mask without changing its hit anchors', () => {
  const signatures = new Set<string>();
  for (const stats of Object.values(TYPES)) {
    const { figure, hits } = makeModel(stats);
    try {
      // The mask is merged into the part it rides (V12: the head, or a machine's body); the asset
      // loader has checked every kind's `clown-mask-<kind>` is in the file. Compare the baked
      // vertices and their colours, which hold each mask's shape and paint.
      const face = figure.parts.head?.getObjectByName(figure.parts.head === figure.parts.torso ? 'torso-surface' : 'head-surface');
      expect(face, stats.key).toBeDefined();
      const meshes: unknown[] = [];
      face?.traverse(o => {
        if (o instanceof Mesh) meshes.push([Array.from(o.geometry.attributes.position.array), Array.from(o.geometry.attributes.color.array)]);
      });
      signatures.add(JSON.stringify(meshes));
      expect(hits.length).toBe(stats.kind === 'humanoid' ? (stats.shield ? 12 : 11) : stats.key === 'moderator' ? 2 : 1);
      expect(hits.some(h => h.part === (stats.kind === 'humanoid' ? 'head' : 'torso'))).toBe(true);
      figure.setEyes(true);
      expect(figure.parts.eyes?.visible).toBe(false);
      expect(figure.parts.deadEyes?.visible).toBe(true);
      figure.setEyes(false);
      expect(figure.parts.eyes?.visible).toBe(true);
      if (stats.shield) {
        const shield = figure.dropShield();
        expect(shield).not.toBeNull();
        expect(figure.anchors.shield).toBeUndefined();
        shield?.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
      }
    } finally { figure.dispose(); }
  }
  expect(signatures.size).toBe(Object.keys(TYPES).length);
  const remote = makeFigure({ kind: 'humanoid' });
  expect(remote.root.getObjectByName('head-surface')).toBeUndefined();
  remote.dispose();
  expect([...GUN_LOADOUT]).toEqual(['r4c', 'rifle', 'shotgun', 'sniper', 'pistol']);
  for (const kind of GUN_LOADOUT) {
    const prop = makeWeaponProp(kind);
    expect(prop.name).toBe(kind);
    prop.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
  }
  const slots: readonly string[] = GUN_LOADOUT;
  const fallback = makeWeaponProp(slots[99] === undefined ? GUN_LOADOUT[0] : 'none');
  expect(fallback.name).toBe('r4c');
  fallback.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
});

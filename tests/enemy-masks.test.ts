import { expect, test } from 'vitest';
import { Mesh } from 'three';
import { makeModel } from '@/engine/enemies/model';
import { TYPES } from '@/engine/enemies/types';
import { makeFigure, makeWeaponProp } from '@/engine/render/figure';

test('every enemy has a distinct clown mask without changing its hit anchors', () => {
  const signatures = new Set<string>();
  for (const stats of Object.values(TYPES)) {
    const { figure, hits } = makeModel(stats);
    try {
      const mask = figure.root.getObjectByName(`clown-mask-${stats.key}`);
      expect(mask, stats.key).toBeDefined();
      expect(mask?.getObjectByName('mask-shell')).toBeDefined();
      expect(mask?.getObjectByName('clown-nose')).toBeDefined();
      const meshes: unknown[] = [];
      mask?.traverse(o => {
        if (o instanceof Mesh) meshes.push([o.geometry.type, o.position.toArray(), o.scale.toArray(),
          'color' in o.material ? o.material.color.getHex() : null]);
      });
      signatures.add(JSON.stringify(meshes));
      expect(hits.length).toBe(stats.kind === 'humanoid' ? (stats.shield ? 12 : 11) : 1);
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
  expect(remote.root.getObjectByName('mask-shell')).toBeUndefined();
  remote.dispose();
  const prop = makeWeaponProp(3);
  expect(prop.name).toBe('pistol');
  prop.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); });
});

import { afterEach, expect, test, vi } from 'vitest';
import { Group, Mesh, Vector3 } from 'three';
import { boundFigure, raycastFigure, unboundFigure } from '@/engine/render/figure';
import { animate, makeModel, syncModel } from '@/engine/enemies/model';
import type { EnemyRecord } from '@/engine/enemies';
import { TYPES } from '@/engine/enemies/types';
import type { EnemyKind } from '@/engine/types';

afterEach(() => { vi.restoreAllMocks(); });

/** Seeded, so a failure repeats. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function record(type: EnemyKind, scene: Group): EnemyRecord {
  const stats = TYPES[type], { figure, root, hits, nodes } = makeModel(stats);
  scene.add(root);
  return { stats, figure, root, type, nodes, hits, body: { vel: new Vector3(), onGround: true }, center: new Vector3(),
    walkAmt: 0, phase: 0, age: 1, flinch: 0, flashT: 0, aimAmt: 0, fuseT: -1, attackT: 0, shieldHp: stats.shield ? 2 : 0,
    state: 'hunt', target: null, yaw: 0, bossAttack: null, payload: true, weakT: 0, yankableT: 0, guardT: 0 } as unknown as EnemyRecord;
}

test('a bounded figure gives the same hits as the whole tree, and skips the rays that miss it', () => {
  const random = mulberry32(0x5eed);
  const between = (a: number, b: number) => a + (b - a) * random();
  const scene = new Group();
  // A moved parent: the bound follows the root's whole chain.
  scene.position.set(3, -0.5, 2); scene.rotation.y = 0.4;
  const origin = new Vector3(), target = new Vector3(), direction = new Vector3();
  let raycasts = 0;
  const counted = vi.spyOn(Mesh.prototype, 'raycast');
  let same = 0, hits = 0, bounded = 0, whole = 0;
  /** The bounded answer, then the whole tree's (no bound), compared to the bit; the bound is put back after. */
  const compare = (e: EnemyRecord, label: string) => {
    raycasts = counted.mock.calls.length;
    const max = random() < 0.2 ? Infinity : between(0.2, 12);
    const a = raycastFigure(e.root, origin, direction, max);
    bounded += counted.mock.calls.length - raycasts;
    unboundFigure(e.root);
    raycasts = counted.mock.calls.length;
    const b = raycastFigure(e.root, origin, direction, max);
    whole += counted.mock.calls.length - raycasts;
    boundFigure(e.root);
    expect(a?.part, label).toBe(b?.part);
    expect(a?.dist, label).toBe(b?.dist);
    expect(a?.point.toArray(), label).toEqual(b?.point.toArray());
    same++;
    if (b) hits++;
  };
  for (const type of Object.keys(TYPES) as EnemyKind[]) {
    const e = record(type, scene), scale = e.stats.scale;
    e.root.position.set(between(-20, 20), between(-1, 3), between(-20, 20));
    e.root.scale.setScalar(scale);
    for (let pose = 0; pose < 6; pose++) {
      e.yaw = e.root.rotation.y = between(-Math.PI, Math.PI);
      e.body.vel.set(between(-4, 4), 0, between(-4, 4));
      e.body.onGround = random() < 0.8;
      e.aimAmt = random(); e.flinch = random();
      e.weakT = random() < 0.5 ? 1 : 0;
      e.state = random() < 0.2 ? 'stunned' : 'hunt';
      for (let i = 0; i < 10; i++) animate(e, 1 / 60);
      syncModel(e);
      if (pose === 3 && e.stats.shield) { e.figure.dropShield(); syncModel(e); }
      for (let ray = 0; ray < 120; ray++) {
        // Aimed into the figure's space, from near (sometimes inside its bound) and far, or anywhere.
        target.copy(e.center).add(direction.set(between(-1, 1), between(-1.4, 1.2), between(-1, 1)).multiplyScalar(scale));
        origin.copy(target).add(direction.set(between(-1, 1), between(-1, 1), between(-1, 1)).setLength(between(0.05, 8) * scale));
        if (random() < 0.8) direction.subVectors(target, origin).normalize();
        else direction.set(between(-1, 1), between(-1, 1), between(-1, 1)).normalize();
        compare(e, `${type} pose ${pose} ray ${ray}`);
      }
      // The root moved, or grew (a hit ends the spawn-in), with no `syncModel` yet: the bound does not hold.
      e.root.position.x += 0.3;
      e.root.scale.setScalar(scale * 1.2);
      for (let ray = 0; ray < 20; ray++) {
        origin.copy(e.root.getWorldPosition(target)).add(direction.set(between(-3, 3), between(0, 2), between(-3, 3)));
        target.y += between(0, 1.8) * scale;
        direction.subVectors(target, origin).normalize();
        compare(e, `${type} moved ${pose} ray ${ray}`);
      }
      e.root.position.x -= 0.3;
      e.root.scale.setScalar(scale);
    }
    e.figure.dispose();
  }
  expect(same).toBeGreaterThan(10000);
  // Both answers well represented, and most rays never reach a mesh test.
  expect(hits).toBeGreaterThan(same * 0.1);
  expect(same - hits).toBeGreaterThan(same * 0.2);
  expect(bounded).toBeLessThan(whole * 0.5);
});

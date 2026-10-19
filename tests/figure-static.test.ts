import { expect, test } from 'vitest';
import { Group, Vector3, type Object3D } from 'three';
import { animate, deathPose, makeModel, planDeath, syncModel } from '@/engine/enemies/model';
import type { EnemyRecord } from '@/engine/enemies';
import { TYPES } from '@/engine/enemies/types';
import type { EnemyKind } from '@/engine/types';
import type { FigurePartName, WeaponPropKind } from '@/engine/render/figure';

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
    state: 'hunt', target: null, yaw: 0, bossAttack: null, payload: true, weakT: 0, yankableT: 0, guardT: 0, id: 7 } as unknown as EnemyRecord;
}

/** Every node as three r170 drew it before `freeze`: all compose their local matrix at each update. */
function thaw(root: Object3D): void {
  root.traverse(node => { node.matrixAutoUpdate = true; });
}

function nodes(roots: readonly Object3D[]): Object3D[] {
  const out: Object3D[] = [];
  for (const root of roots) root.traverse(node => { out.push(node); });
  return out;
}

test('frozen figure nodes give the same local and world matrices, to the bit, as composing them every update', () => {
  let compared = 0, frozen = 0;
  const weapons: WeaponPropKind[] = ['pistol', 'shotgun', 'blade', 'sniper', 'rifle', 'hammer'];
  for (const type of Object.keys(TYPES) as EnemyKind[]) {
    // Two figures of the kind, driven alike: `a` as made (frozen nodes), `b` with every node composing.
    const sceneA = new Group(), sceneB = new Group();
    for (const scene of [sceneA, sceneB]) { scene.position.set(3, -0.5, 2); scene.rotation.y = 0.4; }
    const a = record(type, sceneA), b = record(type, sceneB);
    thaw(b.root);
    a.root.traverse(node => { if (!node.matrixAutoUpdate) frozen++; });
    const lentA: Object3D[] = [], lentB: Object3D[] = [];
    const same = (label: string) => {
      const x = nodes([a.root, ...lentA]), y = nodes([b.root, ...lentB]);
      expect(x.length, label).toBe(y.length);
      for (let i = 0; i < x.length; i++) {
        const m = x[i]!.matrixWorld.elements, n = y[i]!.matrixWorld.elements, l = x[i]!.matrix.elements, k = y[i]!.matrix.elements;
        for (let j = 0; j < 16; j++) {
          if (!Object.is(m[j], n[j]) || !Object.is(l[j], k[j])) {
            throw new Error(`${type} ${label}: ${x[i]!.name || x[i]!.type} element ${j}: ${l[j]}/${m[j]} vs ${k[j]}/${n[j]}`);
          }
        }
      }
      for (let i = 0; i < a.hits.length; i++) expect(a.hits[i]!.center.toArray(), label).toEqual(b.hits[i]!.center.toArray());
      expect(a.center.toArray(), label).toEqual(b.center.toArray());
      compared += x.length;
    };
    const random = mulberry32(0x5eed + type.length);
    const between = (lo: number, hi: number) => lo + (hi - lo) * random();
    // Each figure's step on the same `Math.random` draws (the bomber's spark, `animate`).
    const both = (step: (e: EnemyRecord) => void) => {
      const seed = (random() * 0x100000000) >>> 0, own = Math.random;
      try {
        for (const e of [a, b]) { Math.random = mulberry32(seed); step(e); }
      } finally { Math.random = own; }
    };
    const scale = a.stats.scale;
    both(e => { e.root.position.set(4, 0.2, -6); e.root.scale.setScalar(scale); });
    for (let frame = 0; frame < 40; frame++) {
      const yaw = between(-Math.PI, Math.PI), vx = between(-4, 4), vz = between(-4, 4), ground = random() < 0.8;
      const aim = random(), flinch = random(), weak = random() < 0.5 ? 1 : 0, stunned = random() < 0.2;
      const blade = random() < 0.3 ? between(0, 0.55) : 0;
      both(e => {
        e.yaw = e.root.rotation.y = yaw;
        e.root.position.x += 0.05;
        e.body.vel.set(vx, 0, vz); e.body.onGround = ground;
        e.aimAmt = aim; e.flinch = flinch; e.weakT = weak; e.attackT = blade;
        e.state = stunned ? 'stunned' : 'hunt';
        e.age += 1 / 60;
        animate(e, 1 / 60);
        syncModel(e);
      });
      same(`frame ${frame}`);
      if (frame % 9 === 4 && a.figure.parts.gunMount) {
        const kind = weapons[(frame / 9) | 0]!;
        both(e => { e.figure.setWeapon(kind); });
        thaw(b.root);
        both(e => { syncModel(e); });
        same(`weapon ${kind}`);
      }
      if (frame === 20 && a.stats.shield) {
        const plates = [a.figure.dropShield(), b.figure.dropShield()];
        plates.forEach((plate, i) => { if (plate) { (i ? sceneB : sceneA).add(plate); (i ? lentB : lentA).push(plate); } });
        both(e => { syncModel(e); });
        same('shield dropped');
      }
    }
    // The death, as enemies/index.ts `kill`: pieces torn off to the debris (effects.ts `debris`), then the fall.
    const world = { raycast: () => null };
    const debris = (name: FigurePartName) => {
      for (const [e, scene, lent] of [[a, sceneA, lentA], [b, sceneB, lentB]] as const) {
        const part = e.figure.parts[name];
        if (!part?.parent) continue;
        const at = part.getWorldPosition(new Vector3());
        // `lend` comes first: the call's argument.
        e.figure.lend(part);
        scene.attach(part);
        part.position.copy(scene.worldToLocal(at));
        lent.push(part);
      }
    };
    for (const name of ['weapon', 'head', 'upperR', 'thighL'] as const) debris(name);
    const deaths = [a, b].map(e => planDeath(world, e, new Vector3(0.6, 0, 0.8), true));
    for (let frame = 0; frame < 120; frame++) {
      const t = frame / 30, spin = between(-8, 8);
      both(e => {
        const i = e === a ? 0 : 1;
        deathPose(e, deaths[i]!, t);
        for (const part of i ? lentB : lentA) {
          part.rotation.x += spin / 60; part.rotation.z -= spin / 90;
          part.position.y -= 0.01;
          part.scale.setScalar(Math.max(0.001, 1 - frame / 150));
        }
      });
      // The renderer's scene update, then a reach on its own (ai.ts's muzzle, a ray's update).
      sceneA.updateMatrixWorld(); sceneB.updateMatrixWorld();
      same(`death ${frame}`);
      a.figure.parts.tip?.getWorldPosition(new Vector3()); b.figure.parts.tip?.getWorldPosition(new Vector3());
      a.root.updateWorldMatrix(true, true); b.root.updateWorldMatrix(true, true);
      same(`death reach ${frame}`);
    }
    a.figure.dispose(); b.figure.dispose();
  }
  // Every kind froze its surfaces at least; the comparisons covered thousands of nodes.
  expect(frozen).toBeGreaterThan(Object.keys(TYPES).length * 10);
  expect(compared).toBeGreaterThan(100000);
});

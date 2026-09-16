import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Box3, BoxGeometry, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { makeFigure } from '@/engine/render/figure';
import { makeModel, animate, syncModel, corpse } from '@/engine/enemies/model';
import type { EnemyRecord } from '@/engine/enemies';
import { TYPES } from '@/engine/enemies/types';
import { Renderer, setFlash, surfMat } from '@/engine/render';
import { TACTICAL_MODELS } from '@/engine/render/tactical';
import type { EnemyKind } from '@/engine/types';

const mesh = (root: { getObjectByName(name: string): unknown }, name: string): Mesh => {
  const node = root.getObjectByName(name);
  const object = node instanceof Object3D ? node.getObjectByProperty('isMesh', true) : null;
  if (!(object instanceof Mesh)) throw new Error(`Missing mesh: ${name}`);
  return object;
};

test('tactical assets preserve joints, head targets, materials and instance ownership', () => {
  for (const stats of Object.values(TYPES)) {
    const type = stats.key;
    const { figure, hits } = makeModel(stats);
    const other = makeModel(stats).figure;
    try {
      figure.root.scale.setScalar(stats.scale);
      expect(figure.root.userData.tactical).toBe(type);
      expect(hits).toHaveLength(stats.kind === 'humanoid' ? (stats.shield ? 12 : 11) : 1);
      for (const part of TACTICAL_MODELS[type]) expect(figure.parts[part]?.getObjectByName(`${part}-surface`), `${type}/${part}`).toBeDefined();
      if (stats.kind === 'humanoid') {
        const head = hits.find(hit => hit.part === 'head')!;
        expect(head.r).toBeCloseTo(.195 * stats.scale);
        expect(head.obj.getWorldPosition(new Vector3()).y).toBeCloseTo(1.65 * stats.scale);
      } else {
        expect(figure.parts.head).toBe(figure.parts.torso);
        expect(figure.anchors.head).toBe(figure.anchors.torso);
        expect(hits[0]!.r).toBeCloseTo((stats.flying ? .48 : .5) * stats.scale);
      }
      const bounds = new Box3().setFromObject(figure.root);
      if (!stats.flying) {
        const foot = new Box3().setFromObject(figure.parts.shinL!);
        expect(Math.abs(foot.min.y), `${type} feet meet the floor`).toBeLessThan(.06 * stats.scale);
      }
      expect(bounds.max.y).toBeGreaterThan((stats.kind === 'humanoid' ? 1.8 : .7) * stats.scale);
      const shell = mesh(figure.root, 'mask-shell');
      const otherShell = mesh(other.root, 'mask-shell');
      expect(shell.geometry).not.toBe(otherShell.geometry);
      expect(shell.material).toBe(otherShell.material);
      expect(shell.material).toBeInstanceOf(MeshStandardMaterial);
      const original = shell.material;
      setFlash(figure.root, true);
      expect(shell.material).not.toBe(original);
      expect(otherShell.material).toBe(original);
      setFlash(figure.root, false);
      expect(shell.material).toBe(original);
      let releases = 0;
      shell.geometry.addEventListener('dispose', () => releases++);
      figure.dispose(); figure.dispose();
      expect(releases).toBe(1);
      expect(otherShell.geometry.attributes.position?.count).toBeGreaterThan(0);
    } finally { figure.dispose(); other.dispose(); }
  }
  const player = makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff });
  expect(player.root.getObjectByName('clown-nose')).toBeUndefined();
  expect(player.root.getObjectByName('goggle-lens')).toBeDefined();
  player.dispose();
  const decorative = makeFigure({ kind: 'humanoid', hat: 'cap' });
  expect(decorative.root.userData.tactical).toBeUndefined();
  expect(decorative.parts.hat).toBeDefined();
  decorative.dispose();
});

test('render the tactical cast and exercise each animation rig', async () => {
  await page.viewport(1440, 900);
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const ground = new Mesh(new BoxGeometry(200, .1, 200), surfMat('road'));
  ground.position.y = -.06;
  ground.receiveShadow = true;
  renderer.scene.add(ground);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const rows: { name: string; kinds: EnemyKind[]; gap: number; distance: number; height: number }[] = [
    { name: 'lineup', kinds: ['grunt', 'heavy'], gap: 1.6, distance: 7.2, height: 1.05 },
    { name: 'specialists', kinds: ['rusher', 'sniper', 'shield'], gap: 1.6, distance: 7.2, height: 1.05 },
    { name: 'machines', kinds: ['bomber', 'flyer'], gap: 1.8, distance: 6, height: .8 },
    { name: 'bosses', kinds: ['boss', 'hitbox', 'lagspike'], gap: 3.9, distance: 19, height: 2.5 },
  ];
  try {
    for (const row of rows) {
      const models = row.kinds.map(type => ({ type, ...makeModel(TYPES[type]) }));
      const figures = models.map(model => model.figure);
      if (row.name === 'lineup') figures.unshift(makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff, weapon: 'rifle' }));
      try {
        figures.forEach((figure, i) => {
          figure.root.position.x = (i - (figures.length - 1) / 2) * row.gap;
          const model = models.find(model => model.figure === figure);
          figure.root.scale.setScalar(model ? TYPES[model.type].scale : 1);
          figure.root.rotation.y = -.12;
          if (figure.parts.upperR) figure.parts.upperR.rotation.x = -.3;
          if (figure.parts.foreR) figure.parts.foreR.rotation.x = -.2;
          renderer.scene.add(figure.root);
        });
        renderer.setLevelShadow(new Vector3(), row.distance);
        renderer.camera.position.set(row.distance * .36, row.height * 2.3, row.distance);
        renderer.camera.lookAt(0, row.height, 0);
        renderer.camera.fov = 38;
        renderer.camera.updateProjectionMatrix();
        renderer.render(0, fx);
        await page.screenshot({ path: `.vitest/tactical-${row.name}.png` });
        for (const { type, figure, hits } of models) {
          const record = { stats: TYPES[type], figure, root: figure.root, type, body: { vel: new Vector3(3, 0, 3), onGround: true },
            walkAmt: 0, phase: 0, age: 1, flinch: 0, aimAmt: 1, fuseT: -1, attackT: 0, shieldHp: type === 'shield' ? 2 : 0,
            state: 'hunt', target: null, yaw: 0, hits, center: new Vector3(), bossAttack: null } as unknown as EnemyRecord;
          for (let i = 0; i < 45; i++) animate(record, 1 / 60);
          record.body.onGround = false; animate(record, 1 / 60);
          record.state = 'stunned'; animate(record, 1 / 60);
          record.body.onGround = true; record.state = 'hunt';
          record.body.vel.set(0, 0, 0);
          record.attackT = type === 'rusher' ? .3 : 0;
          record.fuseT = type === 'bomber' ? .5 : -1;
          if (type === 'boss') record.bossAttack = { kind: 'stomp', t: .6, fired: false };
          for (let i = 0; i < 90; i++) animate(record, 1 / 60);
          syncModel(record);
          if (type === 'shield') {
            const hand = figure.parts.foreL!.localToWorld(new Vector3(0, -.303, .008));
            figure.parts.torso!.worldToLocal(hand);
            expect(hand.z + .05).toBeLessThan(.425); // Glove stays behind the plate.
            expect(hand.y).toBeCloseTo(.42, 1);
          }
          for (const hit of hits) expect(hit.center.toArray().every(Number.isFinite)).toBe(true);
          figure.root.traverse(part => expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true));
          record.deadT = 0; record.topple = { axis: 'x', sign: 1, t: 0 };
          corpse(record, .2);
          expect(figure.root.rotation.x).toBeGreaterThan(0);
          figure.root.rotation.x = 0;
        }
        renderer.render(1, fx);
        await page.screenshot({ path: `.vitest/tactical-${row.name}-action.png` });
      } finally { figures.forEach(figure => figure.dispose()); }
    }
  } finally {
    ground.geometry.dispose();
    renderer.dispose();
    canvas.remove();
  }
});

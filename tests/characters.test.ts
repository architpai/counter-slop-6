import { expect, test } from 'vitest';
import { Group, Matrix4, Mesh, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import manifest from '@/engine/render/character-assets.json';
import weaponManifest from '@/engine/render/weapon-assets.json';
import { DEATH_END, DEATH_FALL, DEATH_SINK, FLASH_TIME, SINK, corpse, deathPose, flash, killPose, makeModel, planDeath } from '@/engine/enemies/model';
import type { Death } from '@/engine/enemies/model';
import type { EnemyRecord } from '@/engine/enemies';
import { TYPES } from '@/engine/enemies/types';
import { World } from '@/engine/physics';
import { Renderer } from '@/engine/render';
import { HIT_TINT, figureTemplate, flashAmount, makeFigure, raycastFigure } from '@/engine/render/figure';
import type { FigureAnchorName } from '@/engine/render/figure';
import { characterMat, tintable } from '@/engine/render/materials';
import { PRESET_VALUES } from '@/engine/render/quality';
import { TACTICAL_MODELS, TACTICAL_NODES } from '@/engine/render/tactical';

/** The file as the game loads it, unmerged: every batch a mesh of its own under its part. */
const source = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/models/tactical.glb')).scene;
source.updateMatrixWorld(true);
const baseName = (node: Object3D): string => String(node.userData.name ?? node.name).replace(/^[a-z]+__/, '').replace(/\.\d+$/, '');

test('the model file is optimised and within its budget (V12)', async () => {
  const bytes = new Uint8Array(await (await fetch('/models/tactical.glb')).arrayBuffer());
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  expect(bytes.length).toBe(manifest.bytes);
  expect(hash).toBe(manifest.sha256);
  // 10.4 MB and 238k triangles as exported; 1-2 MB is the plan's target.
  expect(manifest.bytes).toBeLessThan(2e6);
  expect(manifest.triangles).toBeLessThan(manifest.source.triangles / 2);
  let uvs = 0, masks = 0;
  source.traverse(node => {
    if (node instanceof Mesh && node.geometry.getAttribute('uv')) uvs++;
    if (baseName(node) !== 'mask-shell') return;
    let triangles = 0;
    node.traverse(part => { if (part instanceof Mesh) triangles += part.geometry.index!.count / 3; });
    masks = Math.max(masks, triangles);
  });
  expect(uvs).toBe(0);
  // The mask shell was 4,140 triangles on each of 22 masks.
  expect(masks).toBeGreaterThan(300);
  expect(masks).toBeLessThan(650);
  // The enemies' Blender guns (render/weapons.ts `prop`): one cheap mesh per prop kind.
  expect(Object.keys(weaponManifest.props).sort()).toEqual(['blade', 'knife', 'pistol', 'r4c', 'rifle', 'shotgun', 'sniper']);
  for (const triangles of Object.values(weaponManifest.props)) expect(triangles).toBeLessThanOrEqual(1200);
});

test('merging keeps every pivot, node and triangle, and every hit area', () => {
  for (const stats of Object.values(TYPES)) {
    const type = stats.key;
    const { figure } = makeModel(stats);
    const reference = makeModel(stats).figure;
    try {
      figure.root.scale.setScalar(stats.scale);
      reference.root.scale.setScalar(stats.scale);
      // The reference wears the file's own parts, tagged as the game tagged them before V12.
      for (const part of TACTICAL_MODELS[type]) {
        const pivot = reference.parts[part]!, merged = pivot.getObjectByName(`${part}-surface`)!;
        const raw = source.getObjectByName(`${type}__${part}-surface`)!.clone(true);
        raw.position.set(0, 0, 0);
        raw.traverse(node => {
          if (node instanceof Mesh) node.userData.hitPart = stats.kind === 'humanoid' || part === 'head'
            ? ({ head: 'head', torso: 'torso', hips: 'hips', shield: 'shield', upperL: 'armL', upperR: 'armR', foreL: 'foreL', foreR: 'foreR',
              thighL: 'legL', thighR: 'legR', shinL: 'shinL', shinR: 'shinR' } as Record<string, FigureAnchorName>)[part] ?? 'torso' : 'torso';
        });
        raw.traverse(node => { if (baseName(node) === 'heavy-melee') node.traverse(child => { delete child.userData.hitPart; }); });
        pivot.remove(merged);
        pivot.add(raw);
        // The merged part: the same triangles, one mesh (and one per kept node), at the pivot.
        const ours = figure.parts[part]!.getObjectByName(`${part}-surface`)!;
        expect(ours.position.lengthSq(), `${type}/${part}`).toBe(0);
        let rawTriangles = 0, triangles = 0, meshes = 0;
        raw.traverse(node => { if (node instanceof Mesh) rawTriangles += node.geometry.index!.count / 3; });
        ours.traverse(node => { if (node instanceof Mesh) { triangles += node.geometry.index!.count / 3; meshes++; } });
        expect(triangles, `${type}/${part}`).toBe(rawTriangles);
        const kept = TACTICAL_NODES.filter(name => raw.getObjectByName(`${type}__${name}`));
        expect(meshes, `${type}/${part}`).toBeLessThanOrEqual(1 + kept.length);
        for (const name of kept) {
          const node = ours.getObjectByName(name)!, original = raw.getObjectByName(`${type}__${name}`)!;
          raw.updateMatrixWorld(true);
          const expected = new Matrix4().copy(raw.matrixWorld).invert().multiply(original.matrixWorld).elements;
          new Matrix4().compose(node.position, node.quaternion, node.scale).elements.forEach((value, k) => expect(value, `${type}/${name}`).toBeCloseTo(expected[k]!, 5));
        }
      }
      // Rays from the front and the side over the whole figure hit the same part at the same distance.
      figure.root.updateMatrixWorld(true);
      const height = (stats.kind === 'humanoid' ? 2 : stats.flying ? 1.2 : 1.4) * stats.scale, width = 1.2 * stats.scale;
      const origin = new Vector3(), directions = [new Vector3(0, 0, -1), new Vector3(-1, 0, 0)];
      let hits = 0;
      for (const direction of directions) {
        // Off the round numbers the parts' edges sit on: an exact edge rounds either way in either geometry.
        for (let i = 0; i < 25; i++) for (let j = 0; j < 41; j++) {
          const across = ((i + 0.371) / 25 - 0.5) * width, up = (j + 0.413) / 41 * height;
          origin.set(direction.x ? 5 : across, up, direction.x ? across : 5);
          const a = raycastFigure(figure.root, origin, direction, 10), b = raycastFigure(reference.root, origin, direction, 10);
          expect(a?.part, `${type} ray ${i},${j}`).toBe(b?.part);
          if (a && b) {
            expect(Math.abs(a.dist - b.dist), `${type} ray ${i},${j}`).toBeLessThan(1e-4);
            hits++;
          }
        }
      }
      expect(hits, type).toBeGreaterThan(40);
    } finally { figure.dispose(); reference.dispose(); }
  }
});

test('an enemy draws in 11-15 calls, and casts from a few large parts', () => {
  for (const stats of Object.values(TYPES)) {
    const { figure } = makeModel(stats);
    try {
      let meshes = 0, casters = 0;
      figure.root.traverse(node => {
        if (!(node instanceof Mesh) || !node.visible) return;
        meshes++;
        if (node.castShadow) casters++;
      });
      // Humanoids: 11 parts and the prop; machines fewer; a kept node (payload, vent, ring, cleaver) one more.
      expect(meshes, stats.key).toBeLessThanOrEqual(15);
      expect(meshes, stats.key).toBeGreaterThanOrEqual(stats.kind === 'humanoid' ? 11 : 4);
      expect(casters, stats.key).toBeLessThanOrEqual(8);
    } finally { figure.dispose(); }
  }
});

/** An enemy record with what `flash`, `corpse` and `deathPose` read. */
function record(stats = TYPES.grunt): EnemyRecord {
  const { figure, hits, nodes } = makeModel(stats);
  figure.root.scale.setScalar(stats.scale);
  return { stats, figure, root: figure.root, hits, nodes, flashT: 0, deadT: 0, death: null, rootDetached: false } as unknown as EnemyRecord;
}

test('the hit tint peaks and fades to none in FLASH_TIME, at any frame rate (V15)', () => {
  expect(flashAmount(FLASH_TIME, FLASH_TIME)).toBe(HIT_TINT);
  expect(flashAmount(FLASH_TIME / 2, FLASH_TIME)).toBeCloseTo(HIT_TINT / 2);
  expect(flashAmount(0, FLASH_TIME)).toBe(0);
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const e = record(), tints: number[] = [];
    e.figure.setTint = amount => { tints.push(amount); };
    e.flashT = FLASH_TIME;
    flash(e, 0);
    expect(tints.at(-1)).toBe(HIT_TINT);
    let t = 0;
    for (; e.flashT > 0; t += dt) flash(e, dt);
    // Off at the first step past FLASH_TIME, and fading all the way.
    expect(tints.at(-1)).toBe(0);
    expect(t).toBeGreaterThanOrEqual(FLASH_TIME - 1e-9);
    expect(t).toBeLessThan(FLASH_TIME + dt + 1e-9);
    for (let i = 1; i < tints.length; i++) expect(tints[i]!).toBeLessThanOrEqual(tints[i - 1]!);
    e.figure.dispose();
  }
});

test('a death falls along the hit, the same at any frame rate, and sinks away (V15)', () => {
  const death = (e: EnemyRecord): Death => ({ dir: new Vector3(0.6, 0, 0.8), from: new Vector3(2, 0, -3), yaw: 0.4, slide: 0.5, tilt: Math.PI / 2, sink: SINK, seed: 0.37, pose: killPose(e.figure) });
  const pose = (dt: number, t: number) => {
    const e = record();
    e.death = death(e);
    for (let steps = Math.round(t / dt), i = 0; i < steps; i++) corpse(e, dt);
    e.root.updateMatrixWorld(true);
    const joints = ['torso', 'head', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
    const out = [...e.root.matrixWorld.elements, ...joints.flatMap(name => e.figure.parts[name]!.rotation.toArray().slice(0, 3) as number[])];
    e.figure.dispose();
    return out;
  };
  for (const t of [0.2, 0.9, 3.6]) {
    const a = pose(1 / 30, t), b = pose(1 / 120, t), c = pose(1 / 240, t);
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i]!, 9);
      expect(c[i]).toBeCloseTo(a[i]!, 9);
    }
  }
  // On its back along the hit, knocked the slide's length, then below the floor by the end.
  const e = record();
  e.death = death(e);
  deathPose(e, e.death, DEATH_SINK);
  expect(new Vector3(0, 1, 0).applyQuaternion(e.root.quaternion).dot(e.death.dir)).toBeGreaterThan(0.95);
  expect(new Vector3(0, 0, 1).applyQuaternion(e.root.quaternion).y).toBeGreaterThan(0.9);
  expect(e.root.position.clone().setY(0).distanceTo(new Vector3(2, 0, -3))).toBeCloseTo(0.5);
  deathPose(e, e.death, DEATH_END);
  const bounds = new Group().add(e.root.clone());
  bounds.updateMatrixWorld(true);
  let top = -Infinity;
  bounds.traverse(node => {
    if (!(node instanceof Mesh) || !node.visible) return;
    node.geometry.computeBoundingBox();
    top = Math.max(top, node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld).max.y);
  });
  expect(top).toBeLessThan(0.05);
  e.figure.dispose();
});

test('a death starts from the pose at the kill: nothing snaps on the first frame (V15)', () => {
  const joints = ['torso', 'head', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'] as const;
  const state = (e: EnemyRecord) => [...joints.flatMap(name => e.figure.parts[name]!.rotation.toArray().slice(0, 3) as number[]),
    e.figure.parts.hips!.position.y, e.figure.parts.hips!.position.z];
  const plan = (e: EnemyRecord): Death => ({ dir: new Vector3(0, 0, 1), from: new Vector3(), yaw: 0, slide: 0.5, tilt: Math.PI / 2, sink: SINK, seed: 0.37, pose: killPose(e.figure) });
  // Aiming at something up and to its left, mid-stride (as enemies/model.ts `animate` leaves it).
  const aiming = record(), p = aiming.figure.parts;
  p.upperR!.rotation.set(-1.35, 0, 0.08);
  p.upperL!.rotation.set(-1.2, 0.6, -0.08);
  p.torso!.rotation.set(0.1, -0.35, 0);
  p.head!.rotation.set(-0.5, 0.9, 0.02);
  p.thighL!.rotation.x = 0.7;
  p.thighR!.rotation.x = -0.7;
  p.shinL!.rotation.x = 0.8;
  p.hips!.position.y = 0.91;
  const before = state(aiming), death = plan(aiming);
  deathPose(aiming, death, 1 / 240);
  const after = state(aiming);
  for (let i = 0; i < before.length; i++) expect(Math.abs(after[i]! - before[i]!), `value ${i}`).toBeLessThan(0.05);
  // Where it ends is the death's own pose, whatever it started from.
  const still = record();
  deathPose(aiming, death, DEATH_FALL);
  deathPose(still, plan(still), DEATH_FALL);
  const [a, b] = [state(aiming), state(still)];
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, 9);
  aiming.figure.dispose();
  still.figure.dispose();
});

/** The highest and lowest points of a figure's visible meshes, in the world. */
function heights(root: Object3D): { top: number; bottom: number } {
  root.updateMatrixWorld(true);
  let top = -Infinity, bottom = Infinity;
  root.traverse(node => {
    if (!(node instanceof Mesh) || !node.visible) return;
    node.geometry.computeBoundingBox();
    const box = node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld);
    top = Math.max(top, box.max.y);
    bottom = Math.min(bottom, box.min.y);
  });
  return { top, bottom };
}

test('a death keeps the feet down as it tips, and sinks no deeper than its slab (V15)', () => {
  const e = record();
  const death: Death = { dir: new Vector3(0, 0, 1), from: new Vector3(), yaw: 0, slide: 0.5, tilt: Math.PI / 2, sink: SINK, seed: 0.37, pose: killPose(e.figure) };
  const foot = (name: 'shinL' | 'shinR') => e.figure.parts[name]!.localToWorld(new Vector3(0, -0.42, 0));
  for (const t of [0.05, 0.15, 0.25, 0.35]) {
    deathPose(e, death, t);
    e.root.updateMatrixWorld(true);
    // Not lifted off the floor as it starts to tip, and the knees give while the feet stay where they stood.
    if (t <= 0.15) expect(e.root.position.y, `t ${t}`).toBeLessThan(0.01);
    // A foot comes up a little only when a hit from behind spins the body about it.
    for (const name of ['shinL', 'shinR'] as const) expect(Math.abs(foot(name).y), `${name} at ${t}`).toBeLessThan(t <= 0.15 ? 0.05 : 0.1);
  }
  deathPose(e, death, DEATH_FALL * 0.4);
  expect(e.figure.parts.shinL!.rotation.x, 'the knees give early').toBeGreaterThan(1);
  expect(e.figure.parts.hips!.position.y).toBeLessThan(0.8);
  // On a 0.4 m slab it sinks 0.35 m and shrinks the rest of the way: nothing below the slab, nothing above the floor.
  death.sink = 0.35;
  deathPose(e, death, DEATH_END);
  const { top, bottom } = heights(e.root);
  expect(top).toBeLessThan(0.02);
  expect(bottom).toBeGreaterThan(-0.4);
  e.figure.dispose();
});

test('a death falls aside of a wall behind the body, or slumps against it (V15)', () => {
  const world = new World();
  // The ground, 1 m thick, and a wall 0.7 m behind an enemy facing -z (a shot pushes it to +z).
  world.addBox(new Vector3(-20, -1, -20), new Vector3(20, 0, 20));
  world.addBox(new Vector3(-20, 0, 0.7), new Vector3(20, 3, 1));
  world.finalize();
  const { figure } = makeModel(TYPES.grunt);
  const e = { id: 7, yaw: Math.PI, root: new Group(), stats: TYPES.grunt, figure };
  const open = planDeath(world, e, new Vector3(0, 0, -1), false);
  expect(open.dir.z).toBeCloseTo(-1);
  expect(open).toMatchObject({ slide: 0.5, tilt: Math.PI / 2, sink: SINK });
  const walled = planDeath(world, e, new Vector3(0, 0, 1), false);
  expect(walled.dir.z, 'not into the wall').toBeCloseTo(0);
  expect(Math.abs(walled.dir.x)).toBeCloseTo(1);
  expect(walled.tilt).toBe(Math.PI / 2);
  // Deterministic: the same id picks the same side.
  expect(planDeath(world, e, new Vector3(0, 0, 1), false).dir.toArray()).toEqual(walled.dir.toArray());
  // Boxed in on every side: it takes the roomiest way and slumps, lying no further than the room there.
  world.addBox(new Vector3(-20, 0, -1.2), new Vector3(20, 3, -1));
  world.addBox(new Vector3(0.9, 0, -1), new Vector3(1.2, 3, 0.7));
  world.addBox(new Vector3(-1.2, 0, -1), new Vector3(-1.1, 3, 0.7));
  world.finalize();
  const boxed = planDeath(world, e, new Vector3(0, 0, 1), false);
  expect(boxed.dir.x).toBeCloseTo(-1);
  expect(boxed.slide).toBe(0);
  expect(Math.sin(boxed.tilt) * 2).toBeLessThanOrEqual(1.1 + 1e-9);
  expect(boxed.tilt).toBeGreaterThan(0.4);
  // A thin slab under the body: it sinks less than the slab is thick.
  const slab = new World();
  slab.addBox(new Vector3(-20, 3.6, -20), new Vector3(20, 4, 20));
  slab.finalize();
  const upstairs = planDeath(slab, { ...e, root: new Group().translateY(4) }, new Vector3(0, 0, 1), true);
  expect(upstairs.sink).toBeCloseTo(0.35);
  figure.dispose();
});

test('a figure frees its own materials once it and every piece it lent are gone', () => {
  const { figure } = makeModel(TYPES.grunt);
  const owned = new Set<Material>();
  figure.root.traverse(node => { if (node instanceof Mesh && tintable(node.material as Material) && node.material !== characterMat()) owned.add(node.material as Material); });
  expect(owned.size).toBeGreaterThan(0);
  const freed = new Set<Material>();
  for (const material of owned) material.addEventListener('dispose', () => freed.add(material));
  // As effects.ts `debris` takes them: into the scene, out of the figure.
  const scene = new Group();
  scene.attach(figure.parts.weapon!);
  scene.attach(figure.parts.upperR!);
  const gun = figure.lend(figure.parts.weapon!), arm = figure.lend(figure.parts.upperR!);
  figure.dispose();
  expect(freed.size).toBe(0);
  gun();
  gun();
  expect(freed.size).toBe(0);
  arm();
  expect(freed.size).toBe(owned.size);
});

test('a figure frees the copies of a prop it swaps out, so preset changes do not pile them up', () => {
  const figure = makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff, weapon: 'knife' });
  const props = () => {
    const found: Material[] = [];
    figure.parts.weapon!.traverse(node => { if (node instanceof Mesh) found.push(node.material as Material); });
    return found;
  };
  const freed = new Set<Material>(), seen: Material[] = [];
  for (const kind of ['rifle', 'rifle', 'shotgun', 'knife'] as const) {
    const held = props();
    expect(held.length).toBe(1);
    for (const material of held) {
      expect(tintable(material)).toBe(true);
      material.addEventListener('dispose', () => freed.add(material));
      seen.push(material);
    }
    figure.setWeapon(kind);
    // Each prop the figure let go of is freed; the one now in hand is not.
    expect(freed.size).toBe(seen.length);
    for (const material of seen) expect(freed.has(material)).toBe(true);
    for (const material of props()) expect(freed.has(material)).toBe(false);
  }
  const last = props()[0]!;
  last.addEventListener('dispose', () => freed.add(last));
  figure.dispose();
  expect(freed.has(last)).toBe(true);
});

/** The enemies (every kind, or the first `count`) and the player's figure in a row before the camera. */
function lineup(renderer: Renderer, count?: number): { figures: EnemyRecord[]; player: ReturnType<typeof makeFigure> } {
  const figures = Object.values(TYPES).slice(0, count).map((stats, i) => {
    const e = record(stats);
    e.root.position.set((i % 6 - 2.5) * 2, 0, -4 - Math.floor(i / 6) * 3);
    renderer.scene.add(e.root);
    return e;
  });
  const player = makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff, weapon: 'knife' });
  renderer.scene.add(player.root);
  return { figures, player };
}

// It compiles the whole chain three times under software GL: a minute or more beside the other render tests.
test('the menu warm-up covers every character program: none links once enemies spawn', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  renderer.prewarm(figureTemplate()!);
  // The realistic tiers' props come from the weapons, which stream only while something wants them.
  const listen = renderer.weapons.subscribe(() => {});
  const yieldTo = () => new Promise<void>(resolve => setTimeout(resolve, 20));
  try {
    for (const preset of ['low', 'medium', 'ultra'] as const) {
      renderer.applyQuality(PRESET_VALUES[preset]);
      const realistic = preset !== 'low';
      for (let start = performance.now(); ; await yieldTo()) {
        if (performance.now() - start > 50_000) throw new Error(`${preset}: warm-up timed out`);
        renderer.render(0, fx);
        if (renderer._compiles.length === 0 && renderer._warmups.length === 0 && renderer._programsWarm && (!realistic || renderer.weapons.ready)) break;
      }
      renderer.render(0, fx);
      const programs = renderer.three.info.programs!.length;
      const { figures, player } = lineup(renderer);
      try {
        if (realistic) expect(figures[0]!.figure.parts.weapon!.children[0]!.name, 'a Blender prop in hand').toBe('prop__rifle');
        // A dropped gun, as the debris holds it: in the scene, casting.
        const dropped = figures[2]!.figure.parts.weapon!;
        renderer.scene.attach(dropped);
        dropped.traverse(node => { node.castShadow = true; });
        renderer.render(0, fx);
        for (const [i, e] of figures.entries()) {
          e.figure.setTint(HIT_TINT, 0xff4757);
          if (i % 2) {
            const death = e.death = { dir: new Vector3(1, 0, 0), from: e.root.position.clone(), yaw: 0, slide: 0.4, tilt: Math.PI / 2, sink: SINK / 2, seed: i / 22, pose: killPose(e.figure) };
            deathPose(e, death, i % 4 === 1 ? 0.8 : 3.7);
          }
        }
        player.setTint(HIT_TINT, 0x4c7dff);
        renderer.render(0, fx);
        renderer.render(0, fx);
        expect(renderer.three.info.programs!.length, preset).toBe(programs);
      } finally {
        for (const e of figures) e.figure.dispose();
        player.dispose();
        renderer.scene.remove(figures[2]!.figure.parts.weapon!);
      }
    }
    // A look put in force in a live match: the templates hold its programs, so a wave's last death frees none.
    renderer._match.set(true, performance.now() - 10_000);
    renderer.applyQuality(PRESET_VALUES.high);
    for (let start = performance.now(); ; await yieldTo()) {
      if (performance.now() - start > 50_000) throw new Error('high in a match: compiles timed out');
      renderer.render(0, fx);
      if (renderer._compiles.length === 0 && renderer._charactersHeld) break;
    }
    const ids = () => renderer.three.info.programs!.map(program => program.id).sort().join();
    let first = '';
    for (let wave = 0; wave < 3; wave++) {
      const { figures, player } = lineup(renderer, 4);
      renderer.render(0, fx);
      for (const e of figures) e.figure.dispose();
      player.dispose();
      renderer.render(0, fx);
      if (wave === 0) first = ids();
      else expect(ids(), `wave ${wave}`).toBe(first);
    }
    // Low frees the Blender guns: a dropped one still in the scene (the figure gone, or still alive) is hidden, not drawn freed.
    const { figures, player } = lineup(renderer, 4);
    const gone = figures[0]!, alive = figures[1]!, armed = figures[3]!;
    for (const e of [gone, alive]) renderer.scene.attach(e.figure.parts.weapon!);
    const guns = [gone, alive].map(e => e.figure.parts.weapon!.children[0]!);
    expect(guns.map(gun => gun.name)).toEqual(['prop__rifle', 'prop__blade']);
    renderer.render(0, fx);
    gone.figure.dispose();
    renderer.applyQuality(PRESET_VALUES.low);
    renderer.render(0, fx);
    renderer.render(0, fx);
    expect(guns.map(gun => gun.visible)).toEqual([false, false]);
    expect(armed.figure.parts.weapon!.children[0]!.name, 'the flat prop back in hand').not.toMatch(/^prop__/);
    for (const e of figures) e.figure.dispose();
    player.dispose();
    for (const gun of guns) gun.parent?.removeFromParent();
  } finally {
    listen();
    renderer.dispose();
    canvas.remove();
  }
}, 300_000);

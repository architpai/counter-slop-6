import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, Frustum, Group, Material, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Raycaster, Scene, SkinnedMesh, Vector3 } from 'three';
import type { Intersection, Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  BOUNDS_MARGIN, FIST, GIB_BONES, HIT_LAYER, OPERATOR_GLB, OPERATOR_PROP_SCALE, PROP_HOLDS, OPERATOR_MANIFEST, OPERATOR_SETS, OperatorAssets, operatorDownloadBytes, operatorMapUrl, operatorWant,
} from '@/engine/render/operators';
import { LOOPS, OperatorMotion, RUN_FULL, loopWeights } from '@/engine/render/operator-motion';
import type { MotionInput } from '@/engine/render/operator-motion';
import { makeFigure, raycastFigure, useOperatorSource, usePropSource } from '@/engine/render/figure';
import { levelDepthMat } from '@/engine/render/materials';
import type { Figure } from '@/engine/render/figure';
import { TACTICAL_MODELS, TACTICAL_NODES } from '@/engine/render/tactical';
import { PRESET_VALUES } from '@/engine/render/quality';
import { TEXTURE_MAPS } from '@/engine/render/surfaces';
import { animate, makeModel } from '@/engine/enemies/model';
import { EnemyManager } from '@/engine/enemies/index';
import { TYPES } from '@/engine/enemies/types';
import type { Ctx, EnemyKind } from '@/engine/types';
import type { EnemyRecord } from '@/engine/enemies/index';

const MB = 1e6;
const KINDS = Object.keys(TACTICAL_MODELS) as (keyof typeof TACTICAL_MODELS)[];

/** The game's glbs and decoder; the maps are 1 x 1 stand-ins counted in and out (no GPU, no transcoder). */
const live = { textures: 0 };
const loaders = {
  model: (url: string) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url),
  texture: async (url: string): Promise<Texture> => {
    const texture = new DataTexture(new Uint8Array(4), 1, 1);
    texture.name = url;
    live.textures++;
    texture.addEventListener('dispose', () => { live.textures--; });
    return texture;
  },
  upload: () => {},
};

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1500 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (!check()) throw new Error(`timed out waiting for ${what}`);
}

async function stream(assets: OperatorAssets): Promise<void> {
  await until(() => { assets.pump(); return !assets.pending; }, 'the operators to stream');
}

/** A figure of a kind, as the game makes it: enemies through their model, the player as players.ts does. */
function figureOf(kind: string): Figure {
  if (kind === 'player') return makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff, weapon: 'r4c', bodyWidth: 1, limbR: 0.033, hat: 'cap' });
  const stats = TYPES[kind as EnemyKind];
  const { figure } = makeModel(stats);
  figure.root.scale.setScalar(stats.scale);
  return figure;
}

/** The meshes a camera draws under a root, with their draws (one per material group). */
function draws(root: Object3D): number {
  let n = 0;
  root.traverse(node => {
    if (!(node instanceof Mesh) || !node.layers.isEnabled(0)) return;
    for (let p: Object3D | null = node; p; p = p.parent) if (!p.visible) return;
    n += Array.isArray(node.material) ? node.material.length : 1;
  });
  return n;
}

/**
 * A skinned mesh frozen in its current pose, as a plain mesh (its skinned positions, its other attributes and
 * index shared, in its place): rays test it without skinning three vertices per triangle per ray on the CPU,
 * which held up the other test files' timers.
 */
function posed(mesh: SkinnedMesh): Mesh {
  const geometry = new BufferGeometry(), count = mesh.geometry.getAttribute('position').count;
  const positions = new Float32Array(count * 3), v = new Vector3();
  for (let i = 0; i < count; i++) mesh.getVertexPosition(i, v).toArray(positions, i * 3);
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) if (name !== 'position') geometry.setAttribute(name, attribute);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(mesh.geometry.index);
  const frozen = new Mesh(geometry, new MeshBasicMaterial());
  frozen.matrixAutoUpdate = false;
  frozen.matrixWorld.copy(mesh.matrixWorld);
  return frozen;
}

test('tier selection, URLs and the download budget', () => {
  expect(operatorWant(PRESET_VALUES.low)).toBeNull();
  expect(operatorWant(PRESET_VALUES.medium)).toEqual({ lod: 1, size: 512 });
  expect(operatorWant(PRESET_VALUES.high)).toEqual({ lod: 0, size: 1024 });
  expect(operatorWant(PRESET_VALUES.ultra)).toEqual({ lod: 0, size: 2048 });
  expect(operatorMapUrl('kit', 1024, 'orm')).toBe('/characters/1024/kit-orm.ktx2');
  // Every character at Ultra: 15 MB at most (docs/VISUALS.md, R7).
  expect(operatorDownloadBytes(0, 2048)).toBeLessThan(15 * MB);
  expect(operatorDownloadBytes(1, 512)).toBeLessThan(operatorDownloadBytes(0, 1024));
});

test('every kind has an operator, LOD1 lighter than LOD0, within the triangle budget', () => {
  expect(Object.keys(OPERATOR_MANIFEST.kinds).sort()).toEqual([...KINDS].sort());
  for (const [kind, { triangles: [lod0, lod1] }] of Object.entries(OPERATOR_MANIFEST.kinds)) {
    expect(lod0, kind).toBeLessThanOrEqual(26000);
    // LOD1 keeps the mask whole (tools/characters/operators.mjs `maskLock`): on the machines and the sentry, a small
    // model round a large mask, that is a quarter of LOD0.
    const humanoid = kind === 'player' || (TYPES[kind as EnemyKind].kind ?? 'humanoid') === 'humanoid' && kind !== 'turret';
    expect(lod1, kind).toBeLessThan(lod0 * (humanoid ? 0.5 : 0.8));
  }
});

test('every file the tiers ask for is on the server, at the size the manifest says', async () => {
  for (const [lod, url] of OPERATOR_GLB.entries()) {
    const bytes = (await (await fetch(url)).arrayBuffer()).byteLength;
    expect(bytes, url).toBe(OPERATOR_MANIFEST.glb[lod]);
  }
  for (const set of OPERATOR_SETS) {
    for (const size of [512, 1024, 2048] as const) {
      for (const [i, map] of TEXTURE_MAPS.entries()) {
        const response = await fetch(operatorMapUrl(set, size, map));
        expect(response.ok, `${set} ${size} ${map}`).toBe(true);
        expect((await response.arrayBuffer()).byteLength).toBe(OPERATOR_MANIFEST.sets[set]!.bytes[`${size}`]![i]);
      }
    }
  }
});

test('every bone sits on its pivot, and every pivot the game moves has a bone', async () => {
  for (const lod of [0, 1] as const) {
    const gltf = await loaders.model(OPERATOR_GLB[lod]);
    for (const kind of KINDS) {
      const figure = figureOf(kind);
      try {
        const armature = gltf.scene.getObjectByName(`${kind}__body`)!;
        let skinned: SkinnedMesh | null = null;
        armature.traverse(node => { if (node instanceof SkinnedMesh) skinned ??= node; });
        expect(skinned, kind).not.toBeNull();
        const bones = skinned!.skeleton.bones;
        const names = new Set(bones.map(b => b.name.replace(`${kind}__`, '')));
        // The pivots the flat model hangs its parts on, and the nodes the game moves by name.
        for (const part of TACTICAL_MODELS[kind]) expect(names.has(part), `${kind}: ${part}`).toBe(true);
        for (const node of TACTICAL_NODES) if (figure.root.getObjectByName(node)) expect(names.has(node), `${kind}: ${node}`).toBe(true);
        if (figure.parts.shoulderL && figure.parts.shoulderL !== figure.parts.upperL) expect(names.has('shoulderL'), kind).toBe(true);
        for (const bone of bones) {
          const name = bone.name.replace(`${kind}__`, '');
          const pivot = figure.parts[name as keyof Figure['parts']] ?? figure.root.getObjectByName(name);
          if (!pivot) continue;
          // At rest, a bone is its pivot: same place under the same parent, no turn.
          expect(bone.position.distanceTo(pivot.position), `${kind}/${name}`).toBeLessThan(1e-4);
          expect(bone.quaternion.angleTo(new Quaternion()), `${kind}/${name}`).toBeLessThan(1e-4);
          const up = bone.parent;
          if (!up || !(up as { isBone?: boolean }).isBone) continue;
          const parent = up.name.replace(`${kind}__`, '');
          const pivotParent = figure.parts[parent as keyof Figure['parts']];
          if (pivotParent) expect(pivot.parent === pivotParent || pivot.parent?.parent === pivotParent, `${kind}/${name} under ${parent}`).toBe(true);
        }
      } finally { figure.dispose(); }
    }
  }
});

test('clip selection by speed, sideways motion, crouch and aim', () => {
  const at = (input: Partial<MotionInput>) => loopWeights({ speed: 0, phase: 0, lateral: 0, aim: 0, carry: 'long', onGround: true, crouch: false, flinch: 0, melee: null, ...input }, 'humanoid');
  expect(at({})).toMatchObject({ idle: 1, walk: 0, run: 0 });
  expect(at({ speed: 2 })).toMatchObject({ idle: 0, walk: 1, run: 0 });
  expect(at({ speed: RUN_FULL + 1 })).toMatchObject({ walk: 0, run: 1 });
  const side = at({ speed: 2, lateral: -1 });
  expect(side.strafeL).toBe(1);
  expect(side.walk + side.strafeR).toBe(0);
  expect(at({ speed: 2, lateral: 0.4 }).strafeR).toBeGreaterThan(0.4);
  expect(at({ crouch: true }).crouch).toBe(1);
  expect(at({ aim: 0.7 }).aim).toBeCloseTo(0.7);
  expect(at({ aim: 1, carry: 'blade' }).aim).toBe(0);
  expect(at({ speed: 3, onGround: false }).walk).toBe(0);
  // A corpse and a drone play no loops; a walker never runs, strafes, crouches or aims.
  expect(Object.values(at({ still: true })).every(w => w === 0)).toBe(true);
  const walker = loopWeights({ speed: 8, phase: 0, lateral: 1, aim: 1, carry: 'long', onGround: true, crouch: true, flinch: 0, melee: null }, 'machine');
  expect(walker).toMatchObject({ walk: 1, run: 0, strafeL: 0, strafeR: 0, crouch: 0, aim: 0 });
  for (const weights of [at({ speed: 1 }), at({ speed: 5, lateral: 0.3 })]) {
    expect(weights.idle + weights.walk + weights.run + weights.strafeL + weights.strafeR).toBeCloseTo(1);
  }
});

test('the stride loops follow the procedural phase, one-shots play and fade, at any frame rate', () => {
  const input: MotionInput = { speed: 3, phase: 0, lateral: 0, aim: 0, carry: 'long', onGround: true, crouch: false, flinch: 0, melee: null };
  for (const dt of [1 / 30, 1 / 144]) {
    const motion = new OperatorMotion('humanoid');
    let phase = 0;
    for (let t = 0; t < 1; t += dt) motion.update(dt, { ...input, phase: phase = 5 * t });
    expect(motion.cycle).toBeCloseTo((phase / (2 * Math.PI)) % 1, 9);
    expect(motion.weights.walk).toBeGreaterThan(0.99);
    motion.trigger('fire');
    motion.trigger('reload');
    expect([...motion.shots.keys()].sort()).toEqual(['fire', 'reload']);
    for (let t = 0; t < 0.5; t += dt) motion.update(dt, input);
    expect(motion.shots.has('fire'), 'the recoil is over').toBe(false);
    expect(motion.shots.has('reload'), 'the reload plays on').toBe(true);
    for (let t = 0; t < 2; t += dt) motion.update(dt, input);
    expect(motion.shots.size).toBe(0);
    // The melee plays at the swing's own progress, and fades when it ends.
    motion.update(dt, { ...input, melee: 0.4 });
    expect(motion.shots.get('melee')?.t).toBe(0.4);
    for (let t = 0; t < 0.3; t += dt) motion.update(dt, input);
    expect(motion.shots.has('melee')).toBe(false);
  }
});

test('an operator goes on at spawn, or later only out of view, and hit areas stay the flat model\'s', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const camera = new PerspectiveCamera(70, 1.6, 0.1, 500);
  camera.position.set(0, 1.6, 6);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const scene = new Group();
  const early = figureOf('grunt'), behind = figureOf('grunt');
  scene.add(early.root, behind.root);
  behind.root.position.set(0, 0, 20);
  scene.updateMatrixWorld(true);
  try {
    assets.want({ lod: 0, size: 1024 });
    await stream(assets);
    expect(assets.ready).toBe(true);
    assets.frame(camera);
    // The one in view keeps its stand-in; the one behind the camera puts its operator on.
    expect(early.root.getObjectByName('operator'), 'in view').toBeUndefined();
    expect(behind.root.getObjectByName('operator'), 'out of view').toBeDefined();
    early.root.position.set(0, 0, 30);
    scene.updateMatrixWorld(true);
    assets.frame(camera);
    expect(early.root.getObjectByName('operator'), 'once out of view').toBeDefined();
    // A figure made now wears one at once, in view or not.
    const spawned = figureOf('medic');
    scene.add(spawned.root);
    expect(spawned.root.getObjectByName('operator')).toBeDefined();
    spawned.dispose();

    // Every kind: the same hit parts at the same distances as the flat model, and at most 15 draws.
    for (const kind of KINDS) {
      const worn = figureOf(kind);
      // The reference is a figure made with no operators about: the flat model as Low draws it.
      useOperatorSource(null);
      const flat = figureOf(kind);
      useOperatorSource(assets);
      assets.frame(camera);
      const real = worn.root.getObjectByName('operator');
      try {
        expect(real, kind).toBeDefined();
        // Pretend the flat one is on Low: its surfaces on the default layer; the worn one's on HIT_LAYER.
        for (const mesh of worn.rig!.low) expect(mesh.layers.isEnabled(HIT_LAYER), kind).toBe(true);
        expect(draws(worn.root), kind).toBeLessThanOrEqual(15);
        worn.root.updateMatrixWorld(true);
        flat.root.updateMatrixWorld(true);
        const stats = kind === 'player' ? null : TYPES[kind as EnemyKind];
        const scale = stats?.scale ?? 1;
        const height = (stats?.kind === 'humanoid' || !stats ? 2 : stats.flying ? 1.2 : 1.4) * scale, width = 1.2 * scale;
        const origin = new Vector3(), directions = [new Vector3(0, 0, -1), new Vector3(-1, 0, 0)];
        let hits = 0;
        for (const direction of directions) {
          for (let i = 0; i < 13; i++) for (let j = 0; j < 21; j++) {
            const across = ((i + 0.371) / 13 - 0.5) * width, up = (j + 0.413) / 21 * height;
            origin.set(direction.x ? 5 : across, up, direction.x ? across : 5);
            const a = raycastFigure(worn.root, origin, direction, 10), b = raycastFigure(flat.root, origin, direction, 10);
            expect(a?.part, `${kind} ray ${i},${j}`).toBe(b?.part);
            if (a && b) {
              expect(Math.abs(a.dist - b.dist)).toBeLessThan(1e-4);
              hits++;
            }
          }
        }
        expect(hits, kind).toBeGreaterThan(20);
      } finally { worn.dispose(); flat.dispose(); }
    }
  } finally {
    early.dispose();
    behind.dispose();
    assets.clear();
    useOperatorSource(null, assets);
  }
});

test('bones follow the pivots and the clips, a torn-off limb takes a rigid copy, and Low takes it all off', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const camera = new PerspectiveCamera();
  try {
    assets.want({ lod: 1, size: 512 });
    await stream(assets);
    const figure = figureOf('grunt'), rig = figure.rig!;
    const body = figure.root.getObjectByName('operator')!;
    const bone = (name: string) => body.getObjectByName(name)!;
    figure.parts.thighL!.rotation.x = -0.7;
    figure.parts.hips!.position.y = 0.8;
    assets.frame(camera);
    expect(bone('thighL').quaternion.angleTo(figure.parts.thighL!.quaternion)).toBeLessThan(0.3);
    expect(bone('hips').position.y).toBeCloseTo(0.8);
    // The prop sits in the operator's hand, the muzzle tip stays on the pivots.
    const prop = rig.prop()!;
    expect(prop.parent?.parent?.name).toBe('foreR');
    expect(figure.parts.tip!.parent).toBe(figure.parts.weapon);
    // A shot's recoil moves the gun arm's bone, never its pivot.
    const before = figure.parts.upperR!.quaternion.clone();
    rig.motion.trigger('fire');
    rig.motion.update(0.04, { speed: 0, phase: 0, lateral: 0, aim: 1, carry: 'long', onGround: true, crouch: false, flinch: 0, melee: null });
    assets.frame(camera);
    expect(figure.parts.upperR!.quaternion.equals(before)).toBe(true);
    expect(bone('upperR').quaternion.angleTo(before)).toBeGreaterThan(0.01);
    // The head torn off: a rigid copy rides it, the body's head folds away; the dropped gun takes its prop back.
    const scene = new Group();
    scene.attach(figure.parts.head!);
    const back = figure.lend(figure.parts.head!);
    scene.attach(figure.parts.weapon!);
    const gun = figure.lend(figure.parts.weapon!);
    assets.frame(camera);
    expect(figure.parts.head!.getObjectByName('operator gib head')).toBeDefined();
    expect(bone('head').scale.x).toBeLessThan(1e-3);
    expect(prop.parent).toBe(figure.parts.weapon);
    // Low: the operator comes off every figure, the flat surfaces (the torn head's too) draw again.
    assets.clear();
    expect(figure.root.getObjectByName('operator')).toBeUndefined();
    expect(figure.parts.head!.getObjectByName('operator gib head')).toBeUndefined();
    for (const mesh of rig.low) expect(mesh.layers.isEnabled(0)).toBe(true);
    back();
    gun();
    figure.dispose();
  } finally {
    assets.clear();
    useOperatorSource(null, assets);
  }
  expect(GIB_BONES).toContain('head');
});

test('worn operators cull by their kind\'s bounds, cast through a map-free depth material, and hold the gun by its grip', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  // A Blender prop in hand, as render/weapons.ts gives one (its name is all the operator reads).
  const prop = new Mesh();
  prop.name = 'prop__rifle';
  usePropSource({ prop: kind => (kind === 'rifle' ? prop.clone() : null), subscribeProps: () => () => {} });
  const camera = new PerspectiveCamera(70, 1.6, 0.1, 500);
  const frustum = new Frustum();
  const look = (z: number) => {
    camera.position.set(0, 1.6, 6);
    camera.lookAt(0, 1, z);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  };
  try {
    assets.want({ lod: 0, size: 1024 });
    await stream(assets);
    for (const kind of KINDS) {
      const figure = figureOf(kind);
      try {
        figure.root.updateMatrixWorld(true);
        look(0);
        assets.frame(camera);
        const template = assets.kind(kind)!;
        expect(figure.rig!.worn, kind).toBe(true);
        const meshes: SkinnedMesh[] = [];
        figure.root.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node); });
        expect(meshes.length, kind).toBeGreaterThan(0);
        // Far-reaching poses: an arm up (a throw's wind-up, the cleaver's), the other forward (an aim), a knee up, the hips sunk
        // and back as in a death fall.
        const p = figure.parts;
        p.upperR?.rotation.set(-3, 0, 0.7);
        p.upperL?.rotation.set(-1.4, 0.6, 0);
        p.thighL?.rotation.set(-1.2, 0, 0);
        p.hips?.position.add(new Vector3(0, -BOUNDS_MARGIN * 0.6, -BOUNDS_MARGIN * 0.6));
        figure.root.updateMatrixWorld(true);
        assets.frame(camera);
        figure.root.updateMatrixWorld(true);
        for (const mesh of meshes) {
          // Culled per camera and cascade, by the kind's sphere, never by skinning on the CPU.
          expect(mesh.frustumCulled, kind).toBe(true);
          expect(mesh.boundingSphere, kind).toBe(template.bounds);
          expect(mesh.customDepthMaterial, kind).toBe(levelDepthMat());
          // The sphere holds those poses' skinned vertices.
          let reach = 0;
          const vertex = new Vector3();
          for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
            reach = Math.max(reach, mesh.getVertexPosition(i, vertex).distanceTo(template.bounds.center));
          }
          expect(reach, kind).toBeLessThanOrEqual(template.bounds.radius);
          expect(frustum.intersectsObject(mesh), `${kind} in view`).toBe(true);
        }
        look(12);
        for (const mesh of meshes) expect(frustum.intersectsObject(mesh), `${kind} behind the camera`).toBe(false);
      } finally { figure.dispose(); }
    }
    // The gun's grip sits in the gun glove's fist, at the gun's true size.
    const grunt = makeFigure({ kind: 'humanoid', tactical: 'grunt', weapon: 'rifle' });
    try {
      assets.frame(camera);
      const held = grunt.rig!.prop()!, body = grunt.root.getObjectByName('operator')!;
      expect(held.name).toBe('prop__rifle');
      body.updateMatrixWorld(true);
      const socket = held.parent!, fore = body.getObjectByName('foreR')!;
      expect(socket.parent).toBe(fore);
      expect(socket.scale.x).toBeCloseTo(OPERATOR_PROP_SCALE);
      const grip = socket.localToWorld(new Vector3().fromArray(PROP_HOLDS.rifle!.grip));
      expect(grip.distanceTo(fore.localToWorld(FIST.clone()))).toBeLessThan(1e-6);
    } finally { grunt.dispose(); }
  } finally {
    assets.clear();
    useOperatorSource(null, assets);
    usePropSource(null);
  }
});

test('three Low <-> realistic trips leave no map or operator behind', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const camera = new PerspectiveCamera();
  const base = live.textures;
  try {
    const figures = ['grunt', 'flyer', 'bomber', 'player'].map(figureOf);
    for (const want of [{ lod: 0, size: 1024 }, { lod: 1, size: 512 }, { lod: 0, size: 2048 }] as const) {
      assets.want(want);
      await stream(assets);
      assets.frame(camera);
      expect(assets.stats.worn).toBe(figures.length);
      expect(assets.stats.textures).toBe(OPERATOR_SETS.length * TEXTURE_MAPS.length);
      assets.want(null);
      expect(assets.stats).toMatchObject({ textures: 0, model: false, worn: 0 });
      expect(live.textures).toBe(base);
      for (const figure of figures) expect(figure.root.getObjectByName('operator')).toBeUndefined();
    }
    // Figures that go free their own copies of the operator materials.
    assets.want({ lod: 1, size: 512 });
    await stream(assets);
    assets.frame(camera);
    const owned = new Set<Material>();
    for (const figure of figures) figure.root.traverse(node => { if (node instanceof SkinnedMesh) owned.add(node.material as Material); });
    let freed = 0;
    for (const material of owned) material.addEventListener('dispose', () => { freed++; });
    for (const figure of figures) figure.dispose();
    expect(freed).toBe(owned.size);
    expect(assets.stats.worn).toBe(0);
  } finally {
    assets.clear();
    useOperatorSource(null, assets);
  }
  expect(LOOPS).toContain('idle');
});

test('a torn-off gun arm or torso carries the gun away with it, as on Low', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const camera = new PerspectiveCamera();
  try {
    assets.want({ lod: 1, size: 512 });
    await stream(assets);
    for (const part of ['upperR', 'torso'] as const) {
      const figure = figureOf('grunt'), scene = new Group();
      try {
        assets.frame(camera);
        const prop = figure.rig!.prop()!, limb = figure.parts[part]!;
        expect(prop.parent?.parent?.name, part).toBe('foreR');
        scene.attach(limb);
        const back = figure.lend(limb);
        assets.frame(camera);
        // Back in its weapon group, under the limb in the debris, at its own size.
        expect(prop.parent, part).toBe(figure.parts.weapon);
        let under = false;
        for (let node = prop.parent; node; node = node.parent) under ||= node === limb;
        expect(under, part).toBe(true);
        scene.updateMatrixWorld(true);
        expect(prop.getWorldScale(new Vector3()).x, part).toBeGreaterThan(0.5);
        back();
      } finally { figure.dispose(); }
    }
  } finally {
    assets.clear();
    useOperatorSource(null, assets);
  }
});

test('a glb that does not match the manifest fails over to the flat models instead of pending for ever', async () => {
  const warn = console.warn;
  const warned: unknown[] = [];
  console.warn = (...args: unknown[]) => { warned.push(args[0]); };
  // A stale glb: one kind short of operator-assets.json.
  const assets = new OperatorAssets({ ...loaders, model: async url => {
    const gltf = await loaders.model(url);
    gltf.scene.getObjectByName('medic__body')!.removeFromParent();
    return gltf;
  } });
  useOperatorSource(assets);
  const figure = figureOf('grunt');
  try {
    assets.want({ lod: 1, size: 512 });
    await until(() => { assets.pump(); return !assets.pending; }, 'the load to fail');
    expect(assets.ready).toBe(false);
    expect(assets.stats.model).toBe(false);
    expect(assets.kind('grunt')).toBeNull();
    assets.frame(new PerspectiveCamera());
    expect(figure.rig!.worn).toBe(false);
    expect(String(warned[0])).toContain('medic is missing');
  } finally {
    console.warn = warn;
    figure.dispose();
    assets.clear();
    useOperatorSource(null, assets);
  }
});

test('a settings change puts the new operators on figures in view at once; a first load waits for them to leave the view', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const camera = new PerspectiveCamera(70, 1.6, 0.1, 500);
  camera.position.set(0, 1.6, 6);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const scene = new Group();
  const figures = ['grunt', 'medic', 'hitbox'].map(figureOf);
  for (const [i, figure] of figures.entries()) {
    figure.root.position.set(i - 1, 0, 0);
    scene.add(figure.root);
  }
  scene.updateMatrixWorld(true);
  const worn = () => figures.filter(f => f.rig!.worn).length;
  try {
    assets.want({ lod: 1, size: 512 });
    await stream(assets);
    assets.frame(camera);
    expect(worn(), 'the first load, in view').toBe(0);
    for (const figure of figures) figure.root.position.z = 30;
    scene.updateMatrixWorld(true);
    assets.frame(camera);
    for (const figure of figures) figure.root.position.z = 0;
    scene.updateMatrixWorld(true);
    expect(worn()).toBe(3);
    // Medium to Ultra: LOD0 on all of them as soon as it is in, in view.
    assets.want({ lod: 0, size: 2048 });
    await stream(assets);
    assets.frame(camera);
    expect(assets.lod).toBe(0);
    expect(worn(), 'LOD1 to LOD0').toBe(3);
    const template = assets.kind('grunt')!;
    const skinned = figures[0]!.root.getObjectByName('operator')!.children.find(c => c instanceof SkinnedMesh) as SkinnedMesh;
    expect(skinned.geometry).toBe(template.meshes[0]!.geometry);
    // Ultra to Low and back: every figure in view wears one again once they are in.
    assets.want(null);
    expect(worn()).toBe(0);
    assets.want({ lod: 1, size: 512 });
    await stream(assets);
    assets.frame(camera);
    expect(worn(), 'Low to Medium').toBe(3);
    // A figure made after the change and before the operators land keeps the out-of-view rule.
    assets.want(null);
    assets.want({ lod: 0, size: 1024 });
    const late = figureOf('grunt');
    scene.add(late.root);
    scene.updateMatrixWorld(true);
    await stream(assets);
    assets.frame(camera);
    expect(late.rig!.worn).toBe(false);
    expect(worn()).toBe(3);
    late.dispose();
  } finally {
    for (const figure of figures) figure.dispose();
    assets.clear();
    useOperatorSource(null, assets);
  }
});

test('THE HITBOX, THE LAG SPIKE and the bomber keep their legs whole through the stride, seen from the side', async () => {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  const ray = new Raycaster();
  try {
    assets.want({ lod: 0, size: 1024 });
    await stream(assets);
    for (const kind of ['hitbox', 'lagspike', 'bomber']) {
      const figure = figureOf(kind);
      try {
        assets.frame(new PerspectiveCamera());
        const meshes: SkinnedMesh[] = [];
        figure.root.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node); });
        /** The left leg's own surface (its thigh's and shin's bones) under a ray across the figure, from its right. */
        let frozen: Mesh[] = [];
        const leg = (at: Vector3): boolean => {
          ray.set(new Vector3(at.x + 3, at.y, at.z), new Vector3(-1, 0, 0));
          return frozen.some((still, m) => {
            const hits: Intersection[] = [], mesh = meshes[m]!;
            still.raycast(ray, hits);
            const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
            return hits.some(hit => {
              let best = 0;
              for (let k = 1; k < 4; k++) if (weights.getComponent(hit.face!.a, k) > weights.getComponent(hit.face!.a, best)) best = k;
              const bone = mesh.skeleton.bones[joints.getComponent(hit.face!.a, best)]!.name.replace(`${kind}__`, '');
              return bone === 'thighL' || bone === 'shinL';
            });
          });
        };
        // The walk's widest knee (enemies/model.ts: the shin bends up to 1.1 as the thigh swings 0.9 either way), and the air pose.
        for (const [thigh, shin] of [[0, 0], [-0.9, 1.1], [0.9, 0], [-0.5, 1]]) {
          figure.parts.thighL!.rotation.x = thigh!;
          figure.parts.shinL!.rotation.x = shin!;
          figure.root.updateMatrixWorld(true);
          assets.frame(new PerspectiveCamera());
          figure.root.updateMatrixWorld(true);
          frozen = meshes.map(posed);
          // Down the leg's middle, a centimetre (of the kind's own size) at a time: hip to knee, then knee to ankle.
          const hip = figure.parts.thighL!.getWorldPosition(new Vector3()), knee = figure.parts.shinL!.getWorldPosition(new Vector3());
          const ankle = figure.parts.shinL!.localToWorld(new Vector3(0, -0.14, 0));
          const holes: number[] = [];
          for (const [from, to] of [[hip, knee], [knee, ankle]] as const) {
            const steps = Math.ceil(from.distanceTo(to) / (0.01 * figure.root.scale.x));
            for (let i = 0; i <= steps; i++) if (!leg(from.clone().lerp(to, i / steps))) holes.push(i);
          }
          expect(holes, `${kind}: a gap down the leg at thigh ${thigh}, shin ${shin}`).toEqual([]);
          for (const still of frozen) still.geometry.dispose();
        }
      } finally { figure.dispose(); }
    }
  } finally {
    assets.clear();
    useOperatorSource(null, assets);
  }
});

test('the clips follow what an enemy does: its shots, a reload after the burst, a hit, a throw; a blade never recoils', () => {
  const enemies = new EnemyManager({ scene: new Scene(), game: { mode: 'training' } } as unknown as Ctx);
  /** One step of a worn operator's enemy before and after `act`: the one-shots it started. */
  const cues = (kind: EnemyKind, act: (e: EnemyRecord) => void): string[] => {
    const e = enemies.spawn(kind, new Vector3());
    const rig = e.figure.rig!;
    rig.worn = true;
    animate(e, 1 / 60);
    rig.motion.shots.clear();
    act(e);
    animate(e, 1 / 60);
    rig.worn = false;
    return [...rig.motion.shots.keys()].sort();
  };
  try {
    expect(cues('grunt', () => {})).toEqual([]);
    expect(cues('grunt', e => { e.shots++; e.burstLeft = 2; e.attackCd = 0.1; })).toEqual(['fire']);
    expect(cues('grunt', e => { e.shots++; e.burstLeft = 0; e.attackCd = 2.5; })).toEqual(['fire', 'reload']);
    // A pistol recoils and does not change magazines after a burst; the parry's deflections (its projectiles) are no gunshots.
    expect(cues('sapper', e => { e.shots++; e.burstLeft = 0; e.attackCd = 2.5; })).toEqual(['fire']);
    expect(cues('parry', e => { e.shots++; e.burstLeft = 0; e.attackCd = 2.5; })).toEqual([]);
    expect(cues('grunt', e => { e.flinch += 0.8; })).toEqual(['hit']);
    expect(cues('smoker', e => { e.specialCd += 6; })).toEqual(['throw']);
    expect(cues('boss', e => { e.bossAttack = { kind: 'throw', t: 0.2, fired: true }; })).toEqual(['throw']);
    // The melee plays at the swing's own progress.
    expect(cues('parry', e => { e.attackT = 0.3; })).toEqual(['melee']);
  } finally { enemies.clear(); }
});

test('every mask shows its paint from the front: eyes, cheeks and grin above the shell, facing out', async () => {
  // Points of the flat look's mask design (tools/blender/characters/masks.py, its outlines in the flat mask's
  // space): the eyes, the cheek marks, the grin's red corners and its dark cut. Seen straight on, each must show
  // paint (or a kind's extra over it), never the bare shell: a decal sunk under the shell, or facing inwards
  // (which the game culls), leaves the shell's white.
  const EYES = [[-0.04, 1.705], [0.04, 1.705]] as const, Y0 = 1.535, HEIGHT = 0.275;
  const low = [[-0.083, 0.152], [0.083, 0.152], [-0.09, 0.074], [0.09, 0.074], [0, 0.03], [-0.05, 0.045], [0.05, 0.045]] as const;
  const ray = new Raycaster();
  for (const lod of [0, 1] as const) {
    const gltf = await loaders.model(OPERATOR_GLB[lod]);
    gltf.scene.updateMatrixWorld(true);
    for (const kind of KINDS) {
      if (kind === 'player') continue;
      const meshes: SkinnedMesh[] = [];
      gltf.scene.getObjectByName(`${kind}__body`)!.traverse(node => { if (node instanceof SkinnedMesh) meshes.push(node); });
      // The shell (its faint glow, masks.py MASK_GLOW) where it rests: its size gives the design's.
      const shell = (mesh: SkinnedMesh, i: number) => Math.abs(mesh.geometry.getAttribute('_fx').getX(i) - 0.13) < 0.02;
      const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
      for (const mesh of meshes) {
        for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
          if (shell(mesh, i)) { mesh.getVertexPosition(i, v); min.min(v); max.max(v); }
        }
      }
      const scale = (max.y - min.y) / HEIGHT, cx = (min.x + max.x) / 2, frozen = meshes.map(posed);
      const points = [...EYES.map(([x, y]) => [x, y] as const), ...low.map(([x, y]) => [x * 0.7 * 1.08, Y0 + (y + 0.042) / 0.365 * HEIGHT] as const)];
      for (const [x, y] of points) {
        ray.set(new Vector3(cx + x * scale, min.y + (y - Y0) * scale, max.z + 1), new Vector3(0, 0, -1));
        const hits: (Intersection & { mesh: SkinnedMesh })[] = [];
        meshes.forEach((mesh, m) => {
          const found: Intersection[] = [];
          frozen[m]!.raycast(ray, found);
          hits.push(...found.map(hit => ({ ...hit, mesh })));
        });
        hits.sort((a, b) => a.distance - b.distance);
        const first = hits[0];
        expect(first, `${kind} LOD${lod} (${x.toFixed(3)}, ${y.toFixed(3)})`).toBeDefined();
        expect(shell(first!.mesh, first!.face!.a), `LOD${lod} ${kind}: bare shell at (${x.toFixed(3)}, ${y.toFixed(3)})`).toBe(false);
      }
      for (const still of frozen) still.geometry.dispose();
    }
  }
});

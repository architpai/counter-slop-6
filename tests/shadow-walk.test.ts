import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import type { Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OperatorAssets } from '@/engine/render/operators';
import { WeaponAssets } from '@/engine/render/weapons';
import { makeFigure, useOperatorSource, usePropSource } from '@/engine/render/figure';
import type { Figure, WeaponPropKind } from '@/engine/render/figure';
import { Renderer } from '@/engine/render/index';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { PresetName } from '@/engine/render/quality';
import { TACTICAL_MODELS } from '@/engine/render/tactical';
import { makeModel } from '@/engine/enemies/model';
import { TYPES } from '@/engine/enemies/types';
import { Gun, Sword } from '@/engine/weapons/index';
import type { GunKind } from '@/engine/weapons/index';
import { REAL_GUN } from '@/engine/weapons/models';
import type { Ctx, EnemyKind, Player } from '@/engine/types';

const KINDS = Object.keys(TACTICAL_MODELS) as (keyof typeof TACTICAL_MODELS)[];
const PROPS: WeaponPropKind[] = ['none', 'r4c', 'rifle', 'pistol', 'shotgun', 'sniper', 'lmg', 'blade', 'knife', 'hammer'];

/** The game's glbs and decoder; the maps are 1 x 1 stand-ins (no GPU, no transcoder). */
const loaders = {
  model: (url: string) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url),
  texture: async (url: string): Promise<Texture> => {
    const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    texture.name = url;
    return texture;
  },
  upload: () => {},
};

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1500 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (!check()) throw new Error(`timed out waiting for ${what}`);
}

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });

/** The Blender props in hand, as the realistic tiers give them (render/weapons.ts `prop`). */
async function props(): Promise<WeaponAssets> {
  const weapons = new WeaponAssets(loaders);
  weapons.want(512);
  await until(() => { weapons.pump(); return !weapons.pending; }, 'the weapons to stream');
  expect(weapons.ready).toBe(true);
  usePropSource(weapons);
  cleanup.push(() => { usePropSource(null, weapons); weapons.clear(); });
  return weapons;
}

async function operators(): Promise<OperatorAssets> {
  const assets = new OperatorAssets(loaders);
  useOperatorSource(assets);
  cleanup.push(() => { assets.clear(); useOperatorSource(null, assets); });
  return assets;
}

async function wear(assets: OperatorAssets, lod: 0 | 1): Promise<void> {
  assets.want({ lod, size: lod === 1 ? 512 : 1024 });
  await until(() => { assets.pump(); return !assets.pending; }, 'the operators to stream');
}

/** A figure of a kind, as the game makes it: enemies through their model, the player as players.ts does. */
function figureOf(kind: string, weapon?: WeaponPropKind): Figure {
  if (kind === 'player') {
    return makeFigure({ kind: 'humanoid', tactical: 'player', color: 0x4c7dff, scale: 1, bodyWidth: 1, headSize: 1, limbR: 0.033, hat: 'cap', smile: false, shield: false, weapon: weapon ?? 'r4c' });
  }
  const stats = TYPES[kind as EnemyKind];
  const { figure, nodes } = makeModel(stats);
  figure.root.scale.setScalar(stats.scale);
  // The aimbot's cooling core, shown while it is weak.
  if (nodes.core) nodes.core.visible = true;
  if (weapon) figure.setWeapon(weapon);
  return figure;
}

const isCaster = (node: Object3D, layers: THREE.Layers): boolean =>
  ((node as THREE.Mesh).isMesh || (node as THREE.Line).isLine || (node as THREE.Points).isPoints) === true && node.castShadow && node.layers.test(layers);

/**
 * What one cascade of three r170's shadow pass draws (`WebGLShadowMap` `renderObject`, PCF): depth first from the
 * scene, every node it reaches counted, a hidden one ending the walk there; a caster on the camera's layers drawn.
 * Its frustum test reads neither visibility nor order.
 */
function walk(node: Object3D, layers: THREE.Layers, shown: (node: Object3D) => boolean, out: { casters: Object3D[]; visits: number }): void {
  out.visits++;
  if (!shown(node)) return;
  if (isCaster(node, layers)) out.casters.push(node);
  for (const child of node.children) walk(child, layers, shown, out);
}

/**
 * Around `shadowSwap` without the walk (Low, Medium): nothing hidden. With it (High, Ultra): the same casters in the same order with the hidden subtrees as without, none of them under a
 * hidden node, and every node shown or not as before once it is over. Returns the nodes hidden and the visits saved.
 */
function check(assets: OperatorAssets, scene: Object3D, camera: THREE.Camera, what: string): { hidden: Object3D[]; saved: number } {
  const before = new Map<Object3D, boolean>();
  scene.traverse(node => before.set(node, node.visible));
  const reference = { casters: [] as Object3D[], visits: 0 }, drawn = { casters: [] as Object3D[], visits: 0 };
  const hidden: Object3D[] = [];
  // Low and Medium (no walk): the merged draws only, every node shown as it was.
  assets.shadowSwap(true, false);
  try {
    scene.traverse(node => expect(node.visible, `${what}, no walk: ${node.name}`).toBe(before.get(node)));
  } finally {
    assets.shadowSwap(false);
  }
  scene.traverse(node => expect(node.visible, `${what}, no walk: ${node.name} after`).toBe(before.get(node)));
  // High and Ultra.
  assets.shadowSwap(true, true);
  try {
    walk(scene, camera.layers, node => before.get(node)!, reference);
    walk(scene, camera.layers, node => node.visible, drawn);
    scene.traverse(node => { if (before.get(node) && !node.visible) hidden.push(node); });
  } finally {
    assets.shadowSwap(false);
  }
  const lost = reference.casters.filter(node => !drawn.casters.includes(node)).map(node => {
    const path: string[] = [];
    for (let p: Object3D | null = node; p; p = p.parent) path.push(`${p.name || p.type}${p.visible ? '' : '(hidden)'}`);
    return path.join(' < ');
  });
  expect(lost, what).toEqual([]);
  expect(drawn.casters.length, what).toBe(reference.casters.length);
  expect(drawn.casters.every((node, i) => node === reference.casters[i]), `${what}: the same casters in the same order`).toBe(true);
  expect(reference.casters.length, what).toBeGreaterThan(0);
  for (const root of hidden) root.traverse(node => expect(isCaster(node, camera.layers), `${what}: ${node.name} under ${root.name}`).toBe(false));
  scene.traverse(node => expect(node.visible, `${what}: ${node.name} back`).toBe(before.get(node)));
  return { hidden, saved: reference.visits - drawn.visits };
}

test('the shadow pass skips what a worn operator cannot cast, and draws the same casters in the same order', async () => {
  await props();
  const assets = await operators();
  // The camera three hands the shadow pass: the default layer only.
  const camera = new THREE.PerspectiveCamera();
  for (const lod of [0, 1] as const) {
    await wear(assets, lod);
    // Each kind alone: its pivots and its bones hidden, and the visits that saves per cascade (at 7c00ea2, both LODs:
    // 67 on most humanoids, 70-72 on the shield carriers and two bosses, 53-61 on the blobs, 22-30 on the flyers).
    for (const kind of KINDS) {
      const scene = new THREE.Scene(), figure = figureOf(kind);
      scene.add(figure.root);
      try {
        assets.frame(camera);
        expect(figure.rig!.worn, kind).toBe(true);
        const { hidden, saved: visits } = check(assets, scene, camera, `lod ${lod} ${kind}`);
        expect(hidden[0], kind).toBe(figure.parts.hips ?? figure.parts.torso);
        expect(hidden.slice(1).every(node => (node as THREE.Bone).isBone && node.parent === figure.rig!.armature), kind).toBe(true);
        expect(hidden.length, kind).toBeGreaterThan(1);
        expect(visits, kind).toBeGreaterThan(20);
      } finally { figure.dispose(); }
    }
  }

  // Every kind, and grunts and players with every prop, through what a fight does to them.
  await wear(assets, 0);
  const scene = new THREE.Scene(), figures: Figure[] = [];
  const add = (figure: Figure): Figure => {
    const i = figures.push(figure) - 1;
    figure.root.position.set((i % 8) * 2.5, 0, Math.floor(i / 8) * 2.5);
    figure.root.rotation.y = i * 0.7;
    scene.add(figure.root);
    return figure;
  };
  for (const kind of KINDS) add(figureOf(kind));
  const grunts = new Map<WeaponPropKind, Figure>();
  for (const weapon of PROPS) {
    grunts.set(weapon, add(figureOf('grunt', weapon)));
    add(figureOf('player', weapon));
  }
  cleanup.push(() => { for (const figure of figures) figure.dispose(); });
  const by = (kind: string) => figures.find(figure => figure.rig?.kind === kind)!;
  assets.frame(camera);
  expect(assets.worn).toBe(figures.length);
  const all = (what: string) => check(assets, scene, camera, what);
  expect(all('worn').hidden.length).toBeGreaterThan(2 * figures.length - 1);
  for (const figure of figures) figure.setTint(1, 0xff4757);
  all('tinted');
  for (const figure of figures) {
    figure.setEyes(true);
    figure.parts.upperR?.rotation.set(-1.5, 0, 0.4);
    figure.parts.thighL?.rotation.set(-0.8, 0, 0);
  }
  assets.frame(camera);
  all('posed, dead eyes');
  // A weapon swap: a new prop to the hand.
  by('player').setWeapon('shotgun');
  figures[figures.length - 1]!.setWeapon('pistol');
  assets.frame(camera);
  all('swapped');

  // Pieces to the debris as effects.ts `debris` takes them: lent first, then into the scene, every mesh casting.
  const debris = (figure: Figure, part: Object3D): (() => void) => {
    const gone = figure.lend(part);
    scene.attach(part);
    part.traverse(node => { if ((node as THREE.Mesh).isMesh) { node.castShadow = true; node.receiveShadow = false; } });
    return () => { part.removeFromParent(); gone(); };
  };
  const [head, gun, arm, torso, body, shield, refused] = [by('grunt'), grunts.get('rifle')!, by('sniper'), by('heavy'), by('medic'), by('shield'), by('breacher')];
  const back = [
    debris(head, head.parts.head!),
    debris(gun, gun.parts.weapon!),
    debris(arm, arm.parts.upperR!),
    debris(torso, torso.parts.torso!),
    debris(body, body.root),
    debris(shield, shield.dropShield()!),
  ];
  // A lend the debris refused (enemies/index.ts calls `lend` before `debris` takes it): the gib stays on the figure.
  refused.lend(refused.parts.head!)();
  assets.frame(camera);
  const lent = all('lent');
  for (const figure of [head, gun, arm, torso, body, shield, refused]) {
    expect(lent.hidden.includes(figure.parts.hips ?? figure.parts.torso!), figure.rig!.kind).toBe(false);
  }
  for (const done of back) done();
  assets.frame(camera);
  const after = all('debris gone');
  // A dropped gun leaves no gib: the walk skips that body again; the others keep a gib and are walked.
  expect(after.hidden.includes(gun.parts.hips!)).toBe(true);
  expect(after.hidden.includes(head.parts.hips!)).toBe(false);
  expect(after.hidden.includes(refused.parts.hips!)).toBe(false);
  // Disposed with a piece still lent (a corpse, or a player's ragdoll), and a settings change to LOD1 with them all in play.
  const late = by('flyer'), piece = debris(late, late.root);
  late.dispose();
  all('disposed');
  piece();
  await wear(assets, 1);
  assets.frame(camera);
  const lod1 = all('lod 1 on the same figures');
  // The new body takes the dropped gun's prop back into its hand, casting since the debris had it: its bones are walked.
  expect(lod1.hidden.includes(gun.parts.hips!)).toBe(true);
  expect(lod1.hidden.some(node => node.parent === gun.rig!.armature)).toBe(false);
  expect(lod1.hidden.some(node => node.parent === grunts.get('pistol')!.rig!.armature)).toBe(true);
}, 120_000);

test('the merged and walked shadow draws give the same shadow map as the full walk', async () => {
  await props();
  const assets = await operators();
  const renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100), target = new THREE.WebGLRenderTarget(16, 16);
  camera.position.set(0, 10, 15);
  camera.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.position.set(5, 12, 4);
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 0.5, far: 40 });
  scene.add(sun, sun.target);
  scene.overrideMaterial = new THREE.MeshBasicMaterial();
  const figures: Figure[] = [];
  cleanup.push(() => {
    for (const figure of figures) figure.dispose();
    (scene.overrideMaterial as THREE.Material).dispose();
    target.dispose();
    renderer.dispose();
  });
  const drawShadows = renderer.shadowMap.render.bind(renderer.shadowMap);
  let walked: 'full' | 'walked' | 'medium' = 'full', calls = 0;
  renderer.shadowMap.render = (lights, at, from) => {
    const before = renderer.info.render.calls, shown = new Map<Object3D, boolean>();
    at.traverse(node => shown.set(node, node.visible));
    // Medium and Low: the merged draws without the walk, nothing hidden.
    assets.shadowSwap(true, walked !== 'medium');
    if (walked === 'medium') at.traverse(node => expect(node.visible).toBe(shown.get(node)));
    // The full walk: the merged draws, every node shown as it was.
    if (walked === 'full') at.traverse(node => { node.visible = shown.get(node)!; });
    try { drawShadows(lights, at, from); } finally { assets.shadowSwap(false); }
    calls = renderer.info.render.calls - before;
  };
  const shot = (walk: typeof walked) => {
    walked = walk;
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const map = sun.shadow.map!, texels = new Uint8Array(map.width * map.height * 4);
    renderer.readRenderTargetPixels(map, 0, 0, map.width, map.height, texels);
    return { texels, calls };
  };
  await wear(assets, 0);
  const kinds = [...KINDS, 'grunt', 'player'];
  for (const [i, kind] of kinds.entries()) {
    const figure = figureOf(kind, i >= KINDS.length ? 'rifle' : undefined);
    figures.push(figure);
    figure.root.position.set((i % 6) * 2.2 - 6, 0, Math.floor(i / 6) * 2.2 - 4);
    figure.root.rotation.y = i * 0.7;
    figure.parts.upperR?.rotation.set(-1.5, 0, 0.4);
    figure.parts.thighL?.rotation.set(-0.8, 0, 0);
    scene.add(figure.root);
  }
  scene.updateMatrixWorld(true);
  assets.frame(camera);
  const full = shot('full'), skipped = shot('walked'), medium = shot('medium');
  let cast = 0;
  for (let i = 0; i < full.texels.length; i += 4) if (full.texels[i] !== 255 || full.texels[i + 3] !== 255) cast++;
  expect(cast, 'the figures cast').toBeGreaterThan(10000);
  expect(skipped.texels.every((v, i) => v === full.texels[i]), 'the same shadow map').toBe(true);
  expect(skipped.calls).toBe(full.calls);
  expect(medium.texels.every((v, i) => v === full.texels[i]), 'the same shadow map without the walk').toBe(true);
  expect(medium.calls).toBe(full.calls);
}, 60_000);

test('nothing in the view-model rig casts, and the shadow pass walks past it while the main pass draws it', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  cleanup.push(() => { renderer.dispose(); canvas.remove(); });
  // Every view model on both looks (the Blender ones on stand-in maps), flagged by the renderer as the game does.
  const weapons = new WeaponAssets(loaders);
  const ctx = {
    renderer: { rig: renderer.rig, weapons, prepareRig: (root: Object3D) => renderer.prepareRig(root) },
    camera: { position: new THREE.Vector3() },
    audio: new Proxy({}, { get: () => () => {} }),
    effects: new Proxy({ shake: 0 }, { get: (_target, key) => key === 'shake' ? 0 : () => {} }),
    input: { rumble: () => {} },
    enemies: null,
    world: { raycast: () => null, lineOfSight: () => true },
    game: { raycastPlayers: () => null, onShot: () => {}, hitstop: () => {} },
  } as unknown as Ctx;
  const player = { eye: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), headshotT: 0,
    recoil: () => {}, kickFov: () => {}, aimDir: (_s: number, out: THREE.Vector3) => out.set(0, 0, -1) } as unknown as Player;
  const held = [...(['r4c', 'rifle', 'shotgun', 'sniper', 'pistol', 'lmg', 'revolver'] as const).map(kind => new Gun(ctx, player, kind)), new Sword(ctx, player)];
  cleanup.push(() => { for (const weapon of held) weapon.dispose(); weapons.clear(); });
  const noCaster = (look: string) => {
    let meshes = 0;
    renderer.rig.traverse(node => {
      if ((node as THREE.Mesh).isMesh) meshes++;
      expect(((node as THREE.Mesh).isMesh || (node as THREE.Line).isLine || (node as THREE.Points).isPoints) === true && node.castShadow, `${look}: ${node.name}`).toBe(false);
    });
    expect(meshes, look).toBeGreaterThan(held.length);
  };
  noCaster('flat');
  weapons.want(512);
  await until(() => { weapons.pump(); return !weapons.pending; }, 'the weapons to stream');
  for (const weapon of held) expect(!!weapon._model.real, weapon.kind).toBe(weapon instanceof Sword || REAL_GUN[weapon.kind as GunKind] !== undefined);
  noCaster('realistic');
  // With one view model shown, a cascade's walk stops at the rig instead of visiting its shown nodes (18 to 37 at
  // 7c00ea2, the hidden models' roots included).
  for (const weapon of held) {
    weapon.root.visible = true;
    const visits = { casters: [] as Object3D[], visits: 0 };
    walk(renderer.rig, renderer.camera.layers, node => node.visible, visits);
    expect(visits.visits - 1, weapon.kind).toBeGreaterThan(held.length);
    weapon.root.visible = false;
  }

  // A caster in view records the rig's state in each cascade; a rig mesh, that the main pass drew it.
  const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  box.castShadow = true;
  box.position.set(0, 1, -4);
  const seen: boolean[] = [];
  box.onBeforeShadow = () => { seen.push(renderer.rig.visible); };
  renderer.scene.add(box);
  renderer.camera.position.set(0, 1.6, 0);
  const probe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), new THREE.MeshBasicMaterial());
  probe.position.set(0.2, -0.2, -0.5);
  renderer.rig.add(probe);
  renderer.prepareRig(probe);
  let drawn = 0;
  const rigDepth = probe.onBeforeRender;
  probe.onBeforeRender = (...args) => { drawn++; rigDepth.apply(probe, args); };
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  const swaps = vi.spyOn(renderer.operators, 'shadowSwap');
  // High and Ultra hide the rig for each shadow redraw; Low and Medium walk it as before, also after a change mid-session.
  for (const preset of ['high', 'medium', 'low', 'high'] as PresetName[]) {
    renderer.applyQuality(PRESET_VALUES[preset]);
    const walk = preset === 'high' || preset === 'ultra';
    expect(renderer._fightCpu, preset).toBe(walk);
    // Past the first frames' compiles and warm-up draws (which show the whole rig once).
    for (let i = 0; i < 100 && (i < 2 || renderer._compiles.length + renderer._warmups.length > 0); i++) {
      renderer.render(0, fx);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    for (const shown of [true, false]) {
      const what = `${preset}, rig shown: ${shown}`;
      renderer.rig.visible = shown;
      seen.length = drawn = 0;
      swaps.mockClear();
      // Low redraws its shadow map every other frame.
      renderer.render(0, fx);
      renderer.render(0, fx);
      expect(seen.length, what).toBeGreaterThan(0);
      expect(seen.every(visible => visible === (walk ? false : shown)), what).toBe(true);
      expect(swaps.mock.calls.filter(([on]) => on).every(([, walked]) => walked === walk), what).toBe(true);
      expect(swaps.mock.calls.length, what).toBeGreaterThan(0);
      expect(renderer.rig.visible, what).toBe(shown);
      expect(drawn, what).toBe(shown ? 2 : 0);
    }
  }
  swaps.mockRestore();
  // Four looks' compiles: beside the other GPU test files it waits its turn for the GPU.
}, 120_000);

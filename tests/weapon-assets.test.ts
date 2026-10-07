import { afterAll, expect, test, vi } from 'vitest';
import { BoxGeometry, DataTexture, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { BufferGeometry, Material, Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  WEAPON_MANIFEST, WEAPON_SETS, WeaponAssets, weaponDownloadBytes, weaponMapUrl, weaponSetSize, weaponTextureSize,
} from '@/engine/render/weapons';
import { NEAR, Renderer, VIEW_MODEL_FOV } from '@/engine/render/index';
import { MATCH_QUIET_MS } from '@/engine/render/pacing';
import { PRESET_VALUES } from '@/engine/render/quality';
import { TEXTURE_MAPS } from '@/engine/render/surfaces';
import { Gun, GUN_STATS, Melee } from '@/engine/weapons/index';
import { SLASH_TIME } from '@/engine/weapons/melee';
import { REAL_AIM_DEPTH, REAL_GUN, makeRealGunModel } from '@/engine/weapons/models';
import type { GunKind } from '@/engine/weapons/index';
import type { Ctx, Player, WeaponState } from '@/engine/types';

const MB = 1e6;
const neutral: WeaponState = { fire: false, firePressed: false, aim: false, reloadPressed: false,
  meleePressed: false, sprinting: false, grounded: true, speed: 0, sliding: false,
  lookDelta: { x: 0, y: 0 }, strafe: 0, bobPhase: 0, bobAmt: 0, landDip: 0, slideTilt: 0, blockFire: false };

/** The game's glb and decoder; the maps are 1 x 1 stand-ins counted in and out (no GPU, no transcoder). */
const live = { textures: 0, geometries: 0 };
const loaders = {
  model: async (url: string) => {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    gltf.scene.traverse(node => {
      if (!(node instanceof Mesh)) return;
      const geometry = node.geometry as BufferGeometry;
      if (geometry.userData.counted) return;
      geometry.userData.counted = true;
      live.geometries++;
      geometry.addEventListener('dispose', () => {
        if (geometry.userData.freed) return;
        geometry.userData.freed = true;
        live.geometries--;
      });
    });
    return gltf;
  },
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
  for (let i = 0; i < 400 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (!check()) throw new Error(`timed out waiting for ${what}`);
}

/** Pump uploads until the wanted size is worn. */
async function stream(assets: WeaponAssets): Promise<void> {
  await until(() => { assets.pump(); return !assets.pending; }, 'the weapons to stream');
}

// The slice of `Ctx` a view model touches while it only draws.
const rig = new Group();
const assets = new WeaponAssets(loaders);
const ctx = {
  renderer: { rig, weapons: assets, prepareRig: () => {} },
  camera: { position: new Vector3() },
  audio: new Proxy({}, { get: () => () => {} }),
  effects: new Proxy({ shake: 0 }, { get: (target, key) => key === 'shake' ? 0 : () => {} }),
  input: { rumble: () => {} },
  enemies: null,
  world: { raycast: () => null, lineOfSight: () => true },
  game: { raycastPlayers: () => null, onShot: () => {}, hitstop: () => {} },
} as unknown as Ctx;
const player = { eye: new Vector3(), forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), headshotT: 0,
  recoil: () => {}, kickFov: () => {}, aimDir: (_s: number, out: Vector3) => out.set(0, 0, -1) } as unknown as Player;
const guns = (['r4c', 'rifle', 'shotgun', 'sniper', 'pistol'] as const).map(kind => new Gun(ctx, player, kind));
const melee = new Melee(ctx, player);

afterAll(() => {
  for (const weapon of [...guns, melee]) weapon.dispose();
  assets.clear();
});

test('tier selection, URLs and the download budget', () => {
  expect(weaponTextureSize(PRESET_VALUES.low)).toBeNull();
  expect([PRESET_VALUES.medium, PRESET_VALUES.high, PRESET_VALUES.ultra].map(weaponTextureSize)).toEqual([512, 1024, 2048]);
  expect(weaponTextureSize({ look: 'lowpoly', textures: 'high' })).toBeNull();
  expect(weaponMapUrl('r4c', 1024, 'albedo')).toBe('/weapons/1024/r4c-albedo.ktx2');
  // Small models stop at 1K; the rifles and the hands go to 2K on Ultra.
  expect(['optics', 'pistol', 'knife'].map(set => weaponSetSize(set as never, 2048))).toEqual([1024, 1024, 1024]);
  expect(weaponSetSize('r4c', 2048)).toBe(2048);
  expect(weaponSetSize('hands', 512)).toBe(512);
  const bytes = [512, 1024, 2048].map(size => weaponDownloadBytes(size as 512));
  expect(bytes[0]! < bytes[1]! && bytes[1]! < bytes[2]!).toBe(true);
  expect(bytes[2]!, 'Ultra downloads at most 10 MB of weapons').toBeLessThanOrEqual(10 * MB);
});

test('every set and size the tiers ask for is on the server', async () => {
  const urls = ['/models/weapons.glb'];
  for (const set of WEAPON_SETS) {
    for (const size of [512, 1024, 2048] as const) for (const map of TEXTURE_MAPS) urls.push(weaponMapUrl(set, weaponSetSize(set, size), map));
  }
  const missing: string[] = [];
  for (const url of new Set(urls)) if (!(await fetch(url, { method: 'HEAD' })).ok) missing.push(url);
  expect(missing).toEqual([]);
});

test('triangle budget per first-person model, hands and optics included', () => {
  const optic = Math.max(WEAPON_MANIFEST.models.acog!.total, WEAPON_MANIFEST.models.holo!.total);
  for (const [kind, model] of Object.entries(REAL_GUN)) {
    const total = WEAPON_MANIFEST.models[model]!.total + (kind === 'r4c' || kind === 'rifle' ? optic : 0);
    expect(total, `${kind} (${model}) triangles`).toBeLessThanOrEqual(25_000);
  }
  expect(WEAPON_MANIFEST.models.knife!.total).toBeLessThanOrEqual(25_000);
});

test('clip lengths match the gameplay timings in stats.ts', () => {
  const clips = WEAPON_MANIFEST.clips;
  for (const [kind, model] of Object.entries(REAL_GUN) as [GunKind, string][]) {
    const s = GUN_STATS[kind];
    expect(clips[`${model}.equip`], `${model} equip`).toBeCloseTo(s.drawTime, 6);
    if (s.reloadType === 'magazine') {
      expect(clips[`${model}.reload`], `${model} reload`).toBeCloseTo(s.reloadDuration, 6);
      expect(clips[`${model}.reload-empty`], `${model} empty reload`).toBeCloseTo(s.reloadDuration, 6);
    } else {
      expect(clips[`${model}.shell`], `${model} shell`).toBeCloseTo(s.reloadDuration, 6);
    }
    if (s.cycleDuration) expect(clips[`${model}.cycle`], `${model} cycle`).toBeCloseTo(s.cycleDuration, 6);
  }
  expect(clips['knife.slash']).toBeCloseTo(SLASH_TIME, 6);
  expect(clips['knife.slash-back']).toBeCloseTo(SLASH_TIME, 6);
  // The guard runs on the block's blend, not a clock: it only has to be there.
  expect(clips['knife.guard']).toBeGreaterThan(0);
});

test('streams in, swaps every view model, and frees everything on Low with nothing left behind', async () => {
  expect(guns.every(gun => !gun._model.real) && !melee._model.real).toBe(true);
  // The view models listen; a renderer with none fetches nothing.
  expect(assets.wanted).toBe(true);
  expect(new WeaponAssets(loaders).wanted).toBe(false);
  let heard = 0;
  const off = assets.subscribe(() => { heard++; });
  for (let trip = 0; trip < 3; trip++) {
    assets.want(512);
    await stream(assets);
    expect(assets.ready).toBe(true);
    expect(assets.stats.textures).toBe(WEAPON_SETS.length * TEXTURE_MAPS.length);
    for (const gun of guns) {
      expect(gun._model.real, `${gun.kind} wears its Blender model`).toBeDefined();
      expect(gun.root.parent).toBe(rig);
    }
    expect(melee._model.real).toBeDefined();
    // One model per weapon in the rig, whichever look.
    expect(rig.children.length).toBe(guns.length + 1);
    assets.want(null);
    expect(assets.ready).toBe(false);
    expect(guns.every(gun => !gun._model.real && gun.root.parent === rig) && !melee._model.real).toBe(true);
    expect(rig.children.length).toBe(guns.length + 1);
    expect(live, 'Low frees every map and the model').toEqual({ textures: 0, geometries: 0 });
    expect(assets.stats).toEqual({ textures: 0, residentBytes: 0, materials: 0, model: false });
  }
  expect(heard).toBe(6);
  off();
});

test('a texture size change keeps the old maps on until the new ones are in, then frees them', async () => {
  assets.want(512);
  await stream(assets);
  const before = guns[0]!._model;
  assets.want(1024);
  expect(assets.ready && assets.pending).toBe(true);
  await stream(assets);
  expect(assets.stats.textures).toBe(WEAPON_SETS.length * TEXTURE_MAPS.length);
  expect(live.textures).toBe(WEAPON_SETS.length * TEXTURE_MAPS.length);
  // The same model instances stay on: only the maps changed.
  expect(guns[0]!._model).toBe(before);
  assets.want(null);
  expect(live).toEqual({ textures: 0, geometries: 0 });
});

test('muzzle, ejection port and sight sockets come from the Blender models', async () => {
  assets.want(512);
  await stream(assets);
  for (const kind of Object.keys(REAL_GUN) as GunKind[]) {
    const model = makeRealGunModel(kind, assets)!;
    model.root.updateMatrixWorld(true);
    const muzzle = model.muzzle.getWorldPosition(new Vector3()), eject = model.eject.getWorldPosition(new Vector3());
    // The muzzle is the model's most forward point (three: -Z forward), give or take the barrel's crown.
    let front = 0;
    const shown = (node: Object3D): boolean => node.visible && (!node.parent || shown(node.parent));
    model.root.traverse(node => {
      // The gun's own meshes: not the hands, not the hidden flash or the other optic.
      if (!(node instanceof Mesh) || !shown(node) || node.parent?.name.endsWith('-hand')) return;
      node.geometry.computeBoundingBox();
      front = Math.min(front, node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld).min.z);
    });
    expect(muzzle.z - front, `${kind} muzzle at the barrel's end`).toBeLessThan(0.012);
    expect(eject.x, `${kind} ejects to the right`).toBeGreaterThan(0.008);
    expect(eject.z, `${kind} ejects from the receiver, behind the muzzle`).toBeGreaterThan(muzzle.z + 0.06);
    const sights = model.sights ?? {};
    if (kind === 'r4c' || kind === 'rifle') expect(sights.acog && sights.holo, `${kind} optics have sights`).toBeTruthy();
    else expect(sights[kind === 'sniper' ? 'sniper' : 'iron'], `${kind} sight`).toBeTruthy();
    model.real?.mixer.stopAllAction();
  }
  // The gun reads its tracer origin from the Blender muzzle, and its full aim puts the sight on the camera axis,
  // the model drawn REAL_AIM_DEPTH times further out (scaled about the eye, so it looks the same).
  for (const gun of guns) {
    gun.equip();
    for (let i = 0; i < 120; i++) gun.animate({ ...neutral, aim: true }, 1 / 60);
    gun.root.updateMatrixWorld(true);
    const depth = gun._aimDepth(gun._model);
    expect(depth, `${gun.kind} drawn further out`).toBeCloseTo(REAL_AIM_DEPTH, 6);
    expect(gun.root.scale.x).toBeCloseTo(depth, 6);
    const sight = gun._model.sights?.[gun.scope ? gun.scopeKind : 'iron'];
    expect(sight, `${gun.kind} has its aim point`).toBeDefined();
    const onScreen = gun.root.localToWorld(sight!.clone()).divideScalar(depth);
    // Each gun's eye sits at its own place along it (`RealLook.eye`), so the sight is that far ahead.
    const eye = gun._model.real?.eye, ahead = eye == null ? GUN_STATS[gun.kind].eyeDistance : -eye - sight!.z;
    expect(onScreen.distanceTo(new Vector3(0, 0, -ahead)), `${gun.kind} sight on the camera axis`).toBeLessThan(1e-6);
    if (gun.kind === 'shotgun') expect(ahead, 'the shotgun\'s front sight at a cheek weld').toBeCloseTo(0.72, 3);
    if (gun.kind === 'pistol') expect(ahead, 'the pistol\'s post at arm\'s length').toBeCloseTo(0.55, 3);
    // A gun with open sights keeps its receiver well ahead of the eye at full aim (the stock and arms may pass it, below the view).
    if (!gun.scope) expect(gun.root.position.z / depth, `${gun.kind} receiver ahead of the eye`).toBeLessThan(-0.15);
    // A long gun's butt is behind the eye, at the shoulder: in front of it, its butt pad was a black block square to the eye.
    if (gun.kind !== 'pistol') {
      let rear = -Infinity;
      gun.root.traverse(node => {
        if (!(node instanceof Mesh) || node.parent?.name.endsWith('-hand')) return;
        node.geometry.computeBoundingBox();
        rear = Math.max(rear, node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld).max.z);
      });
      expect(rear, `${gun.kind} butt behind the eye`).toBeGreaterThan(0.05);
    }
    // Effects leave from where the gun looks to be: the unscaled muzzle.
    const muzzle = gun._socket(gun._model.muzzle, new Vector3());
    expect(muzzle.distanceTo(gun._model.muzzle.getWorldPosition(new Vector3()).divideScalar(depth)), `${gun.kind} muzzle effects`).toBeLessThan(1e-6);
    gun.unequip();
  }
  assets.want(null);
});

/**
 * The near plane's cut through `root`'s shown meshes that lands in a `fov` view
 * of `aspect`, as the rig draws them (its local space is camera space): the
 * points where a triangle crosses the plane, inside the view. The cut opens a
 * mesh, and the eye sees through it to faces it was never meant to show.
 */
function nearCutsInView(root: Object3D, fov: number, aspect: number): Vector3[] {
  const h = NEAR * Math.tan((fov * Math.PI) / 360), w = h * aspect, found: Vector3[] = [];
  const shown = (node: Object3D): boolean => node.visible && (node === root || (!!node.parent && shown(node.parent)));
  const inView = (a: Vector3, b: Vector3): boolean => {
    // The segment a-b on the plane against the view's rectangle (Liang-Barsky).
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x + w], [dx, w - a.x], [-dy, a.y + h], [dy, h - a.y]] as const) {
      if (p === 0) { if (q < 0) return false; continue; }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
    return true;
  };
  root.updateMatrixWorld(true);
  const tri = [new Vector3(), new Vector3(), new Vector3()];
  root.traverse(node => {
    if (!(node instanceof Mesh) || !shown(node)) return;
    const geometry = node.geometry as BufferGeometry, index = geometry.index, count = index ? index.count : geometry.attributes.position!.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k++) node.getVertexPosition(index ? index.getX(i + k) : i + k, tri[k]!).applyMatrix4(node.matrixWorld);
      const cut: Vector3[] = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k]!, b = tri[(k + 1) % 3]!, da = -a.z - NEAR, db = -b.z - NEAR;
        if ((da < 0) !== (db < 0)) cut.push(a.clone().lerp(b, da / (da - db)));
      }
      if (cut.length === 2 && inView(cut[0]!, cut[1]!)) found.push(cut[0]!);
    }
  });
  return found;
}

test('the near plane never cuts a Blender gun or its hands where the eye can see, from the hip to full aim', async () => {
  assets.want(512);
  await stream(assets);
  // A scoped gun hides at 80 % aim (the HUD's optic takes over); 16:9 and a little wider.
  for (const gun of guns) {
    gun.equip();
    for (let i = 0; i < 120; i++) gun.animate(neutral, 1 / 60);
    for (const aim of gun.scope ? [0, 0.2, 0.4, 0.6, 0.79] : [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      gun.aimAmt = aim;
      gun._pose({ ...neutral, aim: true }, 0);
      const cuts = nearCutsInView(gun.root, VIEW_MODEL_FOV, 2);
      expect(cuts.length, `${gun.kind} at ${aim} aim: cut open at ${cuts[0]?.toArray().map(v => v.toFixed(3))}`).toBe(0);
    }
    gun.aimAmt = 0;
    gun.unequip();
  }
  assets.want(null);
});

test('the clips follow the game timers, and stop back at rest', async () => {
  assets.want(512);
  await stream(assets);
  const r4c = guns[0]!, clip = r4c._model.real!.clips.get('reload')!;
  r4c.equip();
  for (let i = 0; i < 60; i++) r4c.animate(neutral, 1 / 60);
  const mag = r4c._model.parts.mag!, rest = mag.position.clone();
  r4c.mag = 10;
  r4c.startReload();
  for (let i = 0; i < 66; i++) r4c.animate(neutral, 1 / 60);
  expect(r4c._action?.getClip()).toBe(clip);
  // 66 of the reload's 132 frames: the clip is at half its length, and the magazine is out.
  expect(r4c._action!.time / clip.duration).toBeCloseTo(66 / 60 / GUN_STATS.r4c.reloadDuration, 5);
  expect(mag.position.distanceTo(rest)).toBeGreaterThan(0.05);
  for (let i = 0; i < 80; i++) r4c.animate(neutral, 1 / 60);
  expect(r4c.reloading).toBe(false);
  expect(r4c.mag).toBe(30);
  expect(r4c._action).toBeNull();
  expect(mag.position.distanceTo(rest)).toBeLessThan(1e-9);
  // An empty magazine plays the empty reload, as long.
  r4c.mag = 0;
  r4c.startReload();
  r4c.animate(neutral, 1 / 60);
  expect(r4c._action?.getClip().name).toBe('r4c.reload-empty');
  r4c.unequip();
  expect(r4c._action).toBeNull();
  expect(mag.position.distanceTo(rest)).toBeLessThan(1e-9);
  assets.want(null);
});

test('a swap poses the new model at once, hip or aimed, with no frame to settle', async () => {
  const gun = guns[0]!;
  gun.resetAmmo();
  gun.equip();
  for (const aim of [false, true]) {
    for (let i = 0; i < 90; i++) gun.animate({ ...neutral, aim }, 1 / 60);
    for (const size of [512, null] as const) {
      if (size) {
        assets.want(size);
        await stream(assets);
      } else assets.want(null);
      expect(!!gun._model.real).toBe(size !== null);
      // What the swap left is what the next frame draws: the paused game (no frames) shows it posed.
      const swapped = gun.root.position.clone(), turned = gun.root.rotation.toArray().slice(0, 3) as number[];
      gun.animate({ ...neutral, aim }, 1e-4);
      expect(gun.root.position.distanceTo(swapped), `${aim ? 'aimed' : 'hip'} swap to ${size ?? 'Low'}`).toBeLessThan(1e-3);
      gun.root.rotation.toArray().slice(0, 3).forEach((angle, i) => expect(angle as number).toBeCloseTo(turned[i]!, 3));
    }
  }
  gun.unequip();
});

test('Blender triggers pull while fire is held; the knife raises its guard; view-model lighting', async () => {
  assets.want(512);
  await stream(assets);
  const pistol = guns.find(gun => gun.kind === 'pistol')!, trigger = pistol._model.parts.trigger!;
  const rest = trigger.rotation.x;
  pistol.equip();
  pistol.mag = pistol.reserve = 0;
  for (let i = 0; i < 20; i++) pistol.animate({ ...neutral, fire: true }, 1 / 60);
  expect(rest - trigger.rotation.x, 'pulled back').toBeGreaterThan(0.25);
  for (let i = 0; i < 20; i++) pistol.animate(neutral, 1 / 60);
  expect(trigger.rotation.x).toBeCloseTo(rest, 3);
  pistol.unequip();
  // The flat guns have no moving trigger.
  expect(pistol._low.parts.trigger).toBeUndefined();
  melee.equip();
  for (let i = 0; i < 40; i++) melee.animate({ ...neutral, aim: true }, 1 / 60);
  expect(melee._action?.getClip().name).toBe('knife.guard');
  expect(melee._action!.time / melee._action!.getClip().duration).toBeCloseTo(melee._blockAmt, 5);
  for (let i = 0; i < 60; i++) melee.animate(neutral, 1 / 60);
  expect(melee._action).toBeNull();
  melee.unequip();
  // Every lit Blender material takes the view model's share of the probe grid (materials.ts, V18);
  // unlit reticles and flash and the holo's see-through window take no light to share.
  const lit = new Set<Material>();
  guns[0]!._model.root.traverse(node => {
    if (node instanceof Mesh && !(node.material instanceof MeshBasicMaterial) && !(node.material as Material).transparent) lit.add(node.material as Material);
  });
  expect(lit.size).toBeGreaterThan(2);
  for (const material of lit) expect(material.defines?.GRID_VIEW_MODEL, material.name).toBe('');
  assets.want(null);
});

test('the programs compile and draw once as soon as the glb is in, ready waits for that and every map, and a clear cancels it', async () => {
  const steps: string[] = [];
  let finishWarm: () => void = () => {};
  const staged = new WeaponAssets({
    ...loaders,
    compile: async () => { steps.push('compile'); },
    warm: () => new Promise<void>(resolve => { steps.push('warm'); finishWarm = resolve; }),
  });
  // No map uploaded: the materials wear stand-ins with every map already on, so the programs are final.
  staged.want(512);
  await until(() => steps.includes('warm'), 'the warm-up');
  expect(staged.stats.residentBytes).toBe(0);
  expect(staged.ready).toBe(false);
  expect(staged.pending).toBe(true);
  finishWarm();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(staged.ready).toBe(false);
  await stream(staged);
  expect(staged.ready).toBe(true);
  expect(steps).toEqual(['compile', 'warm']);
  // A size change later compiles nothing: only its maps stream.
  staged.want(1024);
  await stream(staged);
  expect(steps).toEqual(['compile', 'warm']);
  staged.clear();
  // Again, with every map in before the warm-up is drawn: not ready until it is, and Low in between cancels it.
  staged.want(512);
  const all = WEAPON_SETS.length * TEXTURE_MAPS.length;
  await until(() => { staged.pump(); return steps.length === 4 && staged.stats.textures === all && staged.pump() === 0; }, 'the maps and the second warm-up');
  expect(staged.ready).toBe(false);
  staged.clear();
  finishWarm();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(staged.ready).toBe(false);
  expect(live).toEqual({ textures: 0, geometries: 0 });
});

// The renderer tests' first frame compiles the whole chain: seconds of software GL in the full parallel suite.
test('the renderer drops a warm-up whose template was freed, even once the weapons are wanted again', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const listen = renderer.weapons.subscribe(() => {});
  // As after a lost context (or Low) cleared the weapons between their compile and the warm-up draw.
  const stale = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  const dropped = renderer._hold(renderer._warmups, stale, () => renderer.weapons.holds(stale));
  renderer.applyQuality(PRESET_VALUES.ultra);
  const added = vi.spyOn(renderer.scene, 'add');
  renderer.render(0, { hurt: 0, flash: 0, slow: 0, lowHp: 0 });
  // The frame asked for the weapons again (a new template is on its way), and the old one was not drawn.
  expect(renderer.weapons.size).not.toBeNull();
  expect(added).not.toHaveBeenCalledWith(stale);
  expect(stale.parent).toBeNull();
  await dropped;
  expect(renderer._warmups.map(w => w.root)).not.toContain(stale);
  listen();
  renderer.dispose();
  canvas.remove();
}, 60_000);

test('the renderer uploads the weapons once the level\'s bake and sets are on, never in a match\'s quiet start', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  // The level's streams, held by hand: a real level's would take seconds of renders to come in.
  const level = { bake: true, textures: true };
  Object.defineProperty(renderer, 'bakePending', { get: () => level.bake });
  Object.defineProperty(renderer, 'texturesPending', { get: () => level.textures });
  const listen = renderer.weapons.subscribe(() => {});
  const pump = vi.spyOn(renderer.weapons, 'pump');
  renderer.applyQuality(PRESET_VALUES.medium);
  // The weapons download meanwhile (a size is wanted), but no upload slot goes to them until the
  // level is on. The waits yield through a message channel: a parallel run's frames throttle timers.
  const yieldTo = () => new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); });
  const renderUntil = async (done: () => boolean, what: string) => {
    for (let start = performance.now(), last = -Infinity; !done(); await yieldTo()) {
      const now = performance.now();
      if (now - start > 45_000) throw new Error(`timed out waiting for ${what}`);
      if (now - last < 50) continue;
      renderer.render(0, fx);
      last = now;
    }
  };
  const frames = () => { for (let i = 0; i < 5; i++) renderer.render(0, fx); };
  const all = WEAPON_SETS.length * TEXTURE_MAPS.length;
  await renderUntil(() => renderer.weapons.stats.textures === all, 'the weapons to download');
  expect(renderer.weapons.size).toBe(512);
  for (const [bake, textures] of [[true, true], [false, true], [true, false]] as const) {
    level.bake = bake;
    level.textures = textures;
    frames();
    expect(pump, `bake ${bake}, textures ${textures}`).not.toHaveBeenCalled();
  }
  // A match's quiet start takes no upload, even with the level in.
  level.bake = level.textures = false;
  renderer.setLive(true);
  frames();
  expect(pump).not.toHaveBeenCalled();
  // Past it, the weapons take the slots.
  renderer._match.set(false, 0);
  renderer._match.set(true, performance.now() - MATCH_QUIET_MS);
  await renderUntil(() => pump.mock.results.some(r => r.value > 0), 'a weapon upload in a match after the level');
  // And in the menu.
  pump.mockClear();
  renderer.setLive(false);
  await renderUntil(() => pump.mock.results.some(r => r.value > 0), 'a weapon upload in the menu');
  listen();
  renderer.dispose();
  canvas.remove();
}, 60_000);

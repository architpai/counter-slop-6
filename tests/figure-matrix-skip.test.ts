import { afterEach, expect, test } from 'vitest';
import { BoxGeometry, DataTexture, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OperatorAssets } from '@/engine/render/operators';
import { useOperatorSource, usePropSource } from '@/engine/render/figure';
import type { WeaponPropKind } from '@/engine/render/figure';
import { staleFigure } from '@/engine/render/fresh';
import { EnemyManager } from '@/engine/enemies/index';
import type { EnemyRecord } from '@/engine/enemies/index';
import { syncModel } from '@/engine/enemies/model';
import { TYPES } from '@/engine/enemies/types';
import { World } from '@/engine/physics';
import type { Ctx, EnemyKind } from '@/engine/types';

/**
 * render/fresh.ts: the renderer's scene update leaves a figure that `syncModel` has just updated. A fight driven
 * through moves, poses, hits, deaths, debris, shields, weapon and look changes; after every step the scene is
 * updated as the game does it, then again with every figure stale (three r170's whole walk, from the same state):
 * every node (figures, worn operators' bones, pieces out in the debris) has the same local and world matrices from
 * both, to the bit. The second walk puts back the flags it cleared, so the game's state goes on as the game left it.
 */

/** Seeded, so a failure repeats. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const loaders = {
  model: (url: string) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url),
  texture: async (): Promise<Texture> => new DataTexture(new Uint8Array(4), 1, 1),
  upload: () => {},
};

async function stream(assets: OperatorAssets): Promise<void> {
  for (let i = 0; i < 1500 && assets.pending; i++) {
    assets.pump();
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (assets.pending) throw new Error('timed out waiting for the operators');
}

/** The realistic props as render/weapons.ts serves them, on or off (a look change swaps every prop in hand). */
function props() {
  const listeners = new Set<() => void>();
  const source = {
    on: false,
    prop(kind: WeaponPropKind): Object3D | null {
      if (!source.on || kind === 'none') return null;
      const mesh = new Mesh(new BoxGeometry(0.08, 0.12, 0.6), new MeshStandardMaterial());
      mesh.name = `prop__${kind}`;
      return mesh;
    },
    subscribeProps(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    flip() {
      source.on = !source.on;
      for (const listener of [...listeners]) listener();
    },
  };
  return source;
}

interface Copy {
  scene: Scene;
  enemies: EnemyManager;
  /** effects.ts `debris`: the piece goes to the scene and flies, then leaves. */
  debris: { mesh: Object3D; vel: Vector3; spin: Vector3; life: number; gone?: () => void }[];
}

function copy(): Copy {
  const scene = new Scene();
  // A parent with a transform of its own: every root's world matrix is a real product.
  scene.position.set(3, -0.5, 2);
  scene.rotation.y = 0.4;
  const world = new World();
  world.addBox(new Vector3(-200, -1, -200), new Vector3(200, 0, 200));
  world.finalize();
  const noop = () => {};
  const quiet = new Proxy({}, { get: () => noop });
  const debris: Copy['debris'] = [];
  const at = new Vector3();
  const effects = {
    ...Object.fromEntries(['blood', 'sparks', 'fountain', 'bloodPool', 'explosion', 'strokeBurst', 'particle', 'tracer'].map(name => [name, noop])),
    debris(mesh: Object3D, pos: Vector3, vel: Vector3, spin: Vector3, o: { life?: number; gone?: () => void } = {}) {
      // Full, or a piece it already has: it refuses, and the piece stays where it is.
      if (Math.random() < 0.15 || debris.some(d => d.mesh === mesh)) {
        o.gone?.();
        return;
      }
      scene.attach(mesh);
      mesh.position.copy(scene.worldToLocal(at.copy(pos)));
      debris.push({ mesh, vel: vel.clone(), spin: spin.clone(), life: o.life ?? 8, gone: o.gone });
    },
  };
  const ctx = {
    scene, world, effects, audio: quiet, hud: quiet, input: quiet, player: null,
    game: { mode: 'training', targets: () => [], hitstop: noop, addScore: noop },
  } as unknown as Ctx;
  const enemies = ctx.enemies = new EnemyManager(ctx);
  return { scene, enemies, debris };
}

function stepDebris(c: Copy, dt: number): void {
  for (let i = c.debris.length - 1; i >= 0; i--) {
    const d = c.debris[i]!;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.vel.y -= 20 * dt;
    d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
    if ((d.life -= dt) > 0) continue;
    c.debris.splice(i, 1);
    d.mesh.removeFromParent();
    d.gone?.();
  }
}

function nodes(scene: Scene): Object3D[] {
  const out: Object3D[] = [];
  scene.traverse(node => { out.push(node); });
  return out;
}

/**
 * The scene update as the game makes it, then three's whole one from the same state, compared node by node: the
 * same local and world matrices to the bit. Returns the nodes compared and both walks' matrix products.
 */
function check(c: Copy, label: string): { nodes: number; fast: number; whole: number } {
  const fast = products(() => c.scene.updateMatrixWorld());
  const list = nodes(c.scene);
  const local = new Float64Array(list.length * 16), world = new Float64Array(list.length * 16);
  const flags = list.map(node => node.matrixWorldNeedsUpdate);
  list.forEach((node, i) => { local.set(node.matrix.elements, i * 16); world.set(node.matrixWorld.elements, i * 16); });
  for (const e of c.enemies.list) staleFigure(e.root);
  const whole = products(() => c.scene.updateMatrixWorld());
  const after = nodes(c.scene);
  if (after.length !== list.length) throw new Error(`${label}: ${list.length} nodes vs ${after.length}`);
  list.forEach((node, i) => {
    const m = node.matrixWorld.elements, l = node.matrix.elements;
    for (let j = 0; j < 16; j++) {
      if (!Object.is(world[i * 16 + j], m[j]) || !Object.is(local[i * 16 + j], l[j])) {
        throw new Error(`${label}: ${node.name || node.type} (parent ${node.parent?.name}) element ${j}: `
          + `${local[i * 16 + j]}/${world[i * 16 + j]} vs three's ${l[j]}/${m[j]}`);
      }
    }
    node.matrixWorldNeedsUpdate = flags[i]!;
  });
  return { nodes: list.length, fast, whole };
}

/** Matrix products during `run`: one per world matrix three computes. */
function products(run: () => void): number {
  const multiply = Matrix4.prototype.multiplyMatrices;
  let n = 0;
  Matrix4.prototype.multiplyMatrices = function (this: Matrix4, p: Matrix4, q: Matrix4) {
    n++;
    return multiply.call(this, p, q);
  };
  try { run(); } finally { Matrix4.prototype.multiplyMatrices = multiply; }
  return n;
}

const KINDS = Object.keys(TYPES) as EnemyKind[];
const SOURCES: string[] = ['melee', 'blast', 'deflect', 'wave', 'r4c', 'fall'];
const WEAPONS: WeaponPropKind[] = ['pistol', 'shotgun', 'blade', 'sniper', 'rifle', 'hammer', 'none'];

const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });

test('a figure syncModel has updated keeps every matrix three\'s whole scene update gives, to the bit', { timeout: 120_000 }, async () => {
  const assets = new OperatorAssets(loaders), source = props(), c = copy();
  // Seeded, so a failure repeats: the fight's own draws and the uuids alike.
  const own = Math.random;
  Math.random = mulberry32(0x6d61);
  useOperatorSource(assets);
  usePropSource(source);
  cleanups.push(() => {
    c.enemies.clear();
    assets.clear();
    useOperatorSource(null, assets);
    usePropSource(null, source);
    Math.random = own;
  });
  const camera = new PerspectiveCamera(70, 1.6, 0.1, 500);
  const live = () => c.enemies.list.filter(e => e.alive);
  const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
  // As training.ts places a target: standing at once, then brought up to date; or spawning in (enemies `spawnPose`).
  const place = (kind: EnemyKind, standing: boolean) => {
    const e = c.enemies.spawn(kind, new Vector3(Math.random() * 40 - 20, kind === 'flyer' || kind === 'carrier' ? 1.5 : 0, Math.random() * 40 - 20));
    if (standing) {
      e.state = 'hunt';
      e.root.scale.setScalar(e.stats.scale);
      syncModel(e);
    }
    return e;
  };
  for (const kind of KINDS) place(kind, true);

  let compared = 0, fast = 0, whole = 0, worn = 0;
  const FRAMES = 420;
  for (let frame = 0; frame < FRAMES; frame++) {
    const dt = 1 / 60;
    // The step: the targets moved about and posed (what the AI would do), then the manager's update.
    for (const e of live()) {
      e.body.vel.x += Math.random() * 6 - 3; e.body.vel.z += Math.random() * 6 - 3;
      e.yawTo = Math.random() * 6 - 3;
      e.aimAmt = Math.random() < 0.5 ? Math.random() : 0;
      e.attackT = Math.random() < 0.2 ? Math.random() * 0.55 : 0;
      e.weakT = Math.random() < 0.3 ? 1 : 0;
      e.guardT = Math.random() < 0.3 ? 1 : 0;
      if (e.type === 'bomber') e.fuseT = Math.random() < 0.3 ? 0.5 : -1;
      if (Math.random() < 0.05) { e.state = 'stunned'; e.age = 0; e.stunDuration = 0.3; }
      if (e.body.pos.y < -0.5) e.body.pos.y = 0;
    }
    c.enemies.update(dt);
    stepDebris(c, dt);
    // Now and then two steps before a frame, the second one standing still (the root where it was) but posed anew.
    if (Math.random() < 0.1) {
      for (const e of live()) { e.body.vel.set(0, 0, 0); e.yawTo = e.yaw; e.aimAmt = Math.random(); e.flinch = Math.random(); }
      c.enemies.update(dt);
      stepDebris(c, dt);
    }
    // Between the step's update and the frame: hits, deaths, a shield broken, a new target, a gun changed, mutations...
    const r = Math.random(), list = live(), e = pick(list);
    if (e && r < 0.06) c.enemies.damage(e, 5 + Math.random() * 20, { dir: new Vector3(Math.random() - 0.5, 0, 1).normalize(), part: 'torso', source: 'r4c' });
    else if (e && r < 0.1) {
      c.enemies.damage(e, e.hp + Math.random() * e.maxHp, { dir: new Vector3(1, 0.2, Math.random()).normalize(), part: 'torso',
        source: pick(SOURCES), crit: Math.random() < 0.3 });
    } else if (e && r < 0.12 && e.shieldHp > 0) c.enemies._breakShield(e);
    else if (e && r < 0.14) e.figure.setWeapon(pick(WEAPONS)!);
    else if (r < 0.17 && list.length < 40) place(pick(KINDS)!, Math.random() < 0.5);
    else if (r < 0.19 && list.length < 40) {
      // As a boss's summon: spawned, then at full size at once (enemies/boss.ts).
      const child = c.enemies.spawn(Math.random() < 0.5 ? 'bomber' : 'flyer', new Vector3(Math.random() * 10, 1, Math.random() * 10));
      child.state = 'hunt'; child.root.scale.setScalar(child.stats.scale);
    } else if (e && r < 0.21) {
      // A co-op mirror's snapshot: the root moved after its update.
      e.root.position.x += 0.01;
    } else if (e && r < 0.23) c.enemies.damage(e, 1, { part: 'shield', source: 'melee' });
    if (frame === 30 || frame === 260) c.enemies.setMutations(99);
    // Rays as the training ground and the weapons cast them (`raycastFigure`: a miss on the bound, or the hit surfaces).
    for (let i = 0; i < 3; i++) {
      c.enemies.raycast(new Vector3(Math.random() * 40 - 20, 1.2, -30), new Vector3(Math.random() - 0.5, 0, 1).normalize(), 80);
    }
    // The parent moves after the step's update: a root's world matrix is no longer the one its owner left.
    if (frame === 200) c.scene.position.x += 0.25;

    // The frame (render/index.ts `render`): the look changes (operators on, out of view only at the first load; another
    // LOD; Low; on again), props on and off, the operators put on and posed, then the scene update.
    if (frame === 40) { assets.want({ lod: 1, size: 512 }); await stream(assets); }
    if (frame === 150) { assets.want({ lod: 0, size: 1024 }); await stream(assets); }
    if (frame === 250) assets.want(null);
    if (frame === 300) { assets.want({ lod: 1, size: 512 }); await stream(assets); }
    if (frame % 70 === 20) source.flip();
    camera.position.set(Math.sin(frame / 40) * 30 + 3, 2, Math.cos(frame / 40) * 30 + 2);
    camera.lookAt(3, 1, 2);
    camera.updateMatrixWorld();
    assets.frame(camera);
    worn += assets.worn;
    const result = check(c, `frame ${frame}`);
    compared += result.nodes; fast += result.fast; whole += result.whole;
  }
  // The operators were worn for much of it, and the frames left most figure nodes alone.
  expect(worn).toBeGreaterThan(FRAMES * 5);
  expect(compared).toBeGreaterThan(300_000);
  expect(fast).toBeLessThan(whole * 0.6);
  console.info(`figure-matrix-skip: ${compared} nodes compared; world-matrix products ${fast} vs ${whole} in three's whole walk`);
});

test('a write after syncModel that does not mark the figure stale shows (so the check above would catch a missed writer)', () => {
  const c = copy();
  cleanups.push(() => { c.enemies.clear(); });
  const e = c.enemies.spawn('grunt', new Vector3(1, 0, 1));
  e.state = 'hunt';
  e.root.scale.setScalar(1);
  syncModel(e);
  e.figure.parts.upperR!.rotation.x = -1.4;
  expect(() => check(c, 'unmarked')).toThrow(/element/);
  // Marked stale, the same kind of write is walked.
  syncModel(e);
  e.figure.parts.upperR!.rotation.x = -0.4;
  staleFigure(e.root);
  expect(check(c, 'marked').nodes).toBeGreaterThan(40);
});

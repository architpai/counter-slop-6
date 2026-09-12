import { afterAll, expect, test } from 'vitest';
import { Mesh, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import { encodeState, RemotePlayer } from '@/engine/players';
import type { Ctx, Enemy, Player } from '@/engine/types';

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const near = (actual: number | undefined, expected: number, message: string): void =>
  assert(actual !== undefined && Math.abs(actual - expected) < 1e-8, message);
const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
};

interface TracerCall { from: Vector3; to: Vector3; tone?: number; thick?: number; life?: number }
interface DebrisCall { mesh: Object3D; pos: Vector3; vel: Vector3; spin: Vector3; options?: unknown }
const calls: { tracers: TracerCall[]; sounds: string[]; debris: DebrisCall[]; blood: number; pools: number } =
  { tracers: [], sounds: [], debris: [], blood: 0, pools: 0 };
const scene = new Scene();

// Only the `Ctx` members `RemotePlayer` reaches for. A real one needs a WebGL
// renderer, a net peer and a level, none of which this check exercises.
const ctx = {
  scene, camera: new PerspectiveCamera(), player: { eye: new Vector3(5, 2, 6) },
  effects: {
    tracer: (from: Vector3, to: Vector3, tone?: number, thick?: number, life?: number) =>
      calls.tracers.push({ from: from.clone(), to: to.clone(), tone, thick, life }),
    debris: (mesh: Object3D, pos: Vector3, vel: Vector3, spin: Vector3, options?: unknown) => {
      scene.attach(mesh);
      calls.debris.push({ mesh, pos: pos.clone(), vel, spin, options });
    },
    blood: () => calls.blood++, bloodPool: () => calls.pools++,
  },
  audio: { remoteShot: (kind: string) => calls.sounds.push(kind) },
} as unknown as Ctx;

const player = {
  body: { pos: new Vector3(1.234, 2.346, -3.456), vel: new Vector3(1.24, -2.36, 3.45), onGround: true },
  yaw: 0.234, pitch: -0.456, wi: 3, hp: 100.6,
  crouching: true, sliding: true, blocking: true, aiming: true, firing: true, alive: true, parryWindow: true,
  melee: { active: true },
  grapple: { mode: 'on', hook: new Vector3(8.16, 9.24, -10.38) },
} as unknown as Player;

const packet = encodeState(player);
const remote = new RemotePlayer(ctx, 'remote', '  FourteenCharacterName  ');
const moving = new RemotePlayer(ctx, 'moving', 'moving');
const state = (x: number, yaw = 0, flags = 80, wi = 0, vx = 0): number[] => [x, 0, 0, yaw, 0, wi, flags, 110, vx, 0, 0];
let damage = 0;

afterAll(() => {
  for (const { mesh } of calls.debris) {
    mesh.removeFromParent();
    mesh.traverse(part => { if (part instanceof Mesh) part.geometry.dispose(); });
  }
});

test('state encoding', () => {
  assert(JSON.stringify(packet) === JSON.stringify([1.23, 2.35, -3.46, 0.23, -0.46, 3, 1023, 101, 1.2, -2.4, 3.5, 8.2, 9.2, -10.4]),
    'State encoding keeps field order, rounding, all ten flags, and grapple coordinates.');
  player.grapple.mode = 'idle';
  assert(encodeState(player).length === 11 && !(must(encodeState(player)[6], 'flags') & 128), 'Idle grapple has no hook fields or flag.');
});

test('a remote decodes its first state', () => {
  assert(remote.name === 'FourteenCharac' && !remote.visible && remote.body.pos.y === -50 && remote.hp === 100,
    'Remote starts hidden with a bounded name and initial health.');
  assert(remote.isLocal === false && remote.speed === 0 && remote.blockRadius === 0, 'Remote implements the Target constants.');
  remote.push(packet, 1);
  remote.update(0, 1);
  assert(remote.visible && remote.hits.length === 11 && remote.hp === 101 && remote.lastSeen === 1000,
    'First valid state shows the avatar and stamps arrival milliseconds.');
  assert(remote.crouching && remote.sliding && remote.blocking && remote.aiming && remote.firing &&
    remote.grappling && remote.parryWindow && remote.body.onGround && remote.alive, 'State flags decode independently.');
  near(remote.body.pos.x, 1.23, 'First state snaps to its position.');
  near(remote.eye.y, 3.23, 'Crouching eye height is 0.88.');
  near(remote.center.y, 2.35 + 1.05 * 0.55, 'Crouching center follows body height.');
  near(remote.forward.length(), 1, 'Forward is normalized.');
  near(remote.right.dot(remote.forward), 0, 'Right is perpendicular to forward.');
  const figure = must(remote._figure, 'figure');
  near(must(figure.anchors.armL, 'armL anchor').position.y, -0.15, 'Remote upper-arm hit anchor uses the midpoint.');
  near(must(figure.anchors.foreL, 'foreL anchor').position.y, -0.14, 'Remote forearm hit anchor uses the midpoint.');
  assert(must(figure.parts.upperR, 'upperR').rotation.x === -1.8, 'Knife guard raises the right arm.');
});

test('invalid packets are rejected whole', () => {
  const seen = remote.lastSeen;
  const invalid: unknown[] = [null, {}, [], packet.slice(0, 10), [...packet, 2]];
  const mutations: [number, number][] = [[0, Infinity], [2, 10001], [3, NaN], [4, 1.61], [5, 0.2],
    [6, 1024], [7, -1], [7, 121], [8, 10001], [12, NaN]];
  for (const [index, value] of mutations) {
    const bad = [...packet]; bad[index] = value; invalid.push(bad);
  }
  for (const bad of invalid) remote.push(bad, 2);
  assert(remote.lastSeen === seen && remote.hp === 101, 'Invalid packets make no partial change.');
});

test('delayed interpolation and extrapolation', () => {
  moving.push(state(0, 3.1), 1);
  moving.push(state(2, -3.1, 80, 0, 2), 1.1);
  moving.update(0.05, 1.13);
  const blend = 1 - Math.exp(-22 * 0.05);
  near(moving.body.pos.x, blend, '80 ms delayed interpolation eases toward the midpoint at rate 22.');
  near(moving.forward.x, 0, 'Yaw takes the shortest arc across the PI boundary.');
  assert(moving.forward.z > 0.99, 'Yaw does not interpolate through zero across the boundary.');
  const previous = moving.body.pos.x;
  moving.update(0.05, 9);
  near(moving.body.pos.x, previous + (2.7 - previous) * blend, 'Extrapolation stops after 350 ms.');
  moving.push(state(40), 10);
  moving.update(0.01, 10.08);
  near(moving.body.pos.x, 40, 'A correction above six metres teleports.');
  moving.push(state(40, 1e308), 11);
  moving.push(state(40, -1e308), 12);
  moving.update(0.05, 12.08);
  assert(Number.isFinite(moving.forward.x), 'Finite extreme yaw cannot overflow its interpolation delta.');
});

test('optional triples, weapon fallback and the name tag', () => {
  const hook = remote.hook.clone();
  remote.push(state(0, 0, 208, 99).slice(0, 8), 3);
  remote.update(0.05, 3.08);
  assert(!remote.grappling && remote.hook.equals(hook) && remote.body.vel.lengthSq() === 0,
    'Missing optional triples zero velocity and retain the unused hook.');
  assert(remote._wi === 0 && remote.body.height === 1.75, 'Unknown weapon uses a rifle and standing height returns.');
  remote.push(state(0, 0, 80, 3), 3.01);
  assert(remote._figure?.parts.weapon?.name === 'pistol', 'Slot 4 renders the pistol, not a blade.');
  remote.push(state(0, 0, 80 | 512, 3), 3.02);
  assert(remote._figure?.parts.weapon?.name === 'knife' && remote._wi === 3, 'Melee renders independently of the pistol slot.');
  remote.push(state(0, 0, 80, 3), 3.03);
  assert(remote._figure?.parts.weapon?.name === 'pistol', 'Ending melee restores the selected gun.');
  remote.name = '<script>name';
  remote.update(0.01, 3.09);
  assert(remote._tagName === '<script>name', 'A bounded name change rebuilds the canvas label.');
});

test('shot batches, the muzzle flash and damage', () => {
  remote.shots('sniper', [1, 2, 3, 4, 5, 6]);
  assert(calls.tracers.length === 2 && must(calls.tracers[0], 'tracer').thick === 0.03 && must(calls.tracers[0], 'tracer').life === 0.06 &&
    calls.sounds[0] === 'sniper', 'Shot endpoints become the correct tracers and one sound.');
  remote.shots('unknown', [1, 2, 3]);
  assert(must(calls.tracers[2], 'tracer').thick === 0.02 && calls.sounds[1] === 'rifle', 'Unknown shot kind uses rifle cues.');
  remote.shots('rifle', [1, 2, 3, 4, NaN, 6]);
  remote.shots('rifle', [1, 2]);
  remote.shots('rifle', Array(93).fill(0));
  assert(calls.tracers.length === 3, 'Invalid shot batches are rejected before drawing any tracer.');
  near(remote._flashT, 0.08, 'Shots reset the flash timer.');
  remote.update(0.05, 3.14);
  remote.update(0.04, 3.18);
  near(remote._flashT, 0, 'Flash ends after 80 ms.');

  remote.onDamage = amount => { damage += amount; };
  remote.takeDamage(12, new Vector3());
  remote.takeDamage(NaN);
  remote.takeDamage(-1);
  remote.takeDamage(12, [0, 0, 0] as unknown as Vector3);
  assert(damage === 12 && remote.hp === 110, 'Remote damage validates and forwards without changing owner health.');
  remote.blocking = true;
  const melee = (center: Vector3) => ({ center }) as unknown as Enemy;
  assert(remote.tryBlockMelee(melee(remote.eye.clone().add(remote.forward))), 'A guard blocks a front melee hit.');
  assert(!remote.tryBlockMelee(melee(remote.eye.clone().sub(remote.forward))) && !remote.tryDeflect(),
    'A guard does not block from behind or deflect projectiles locally.');
});

test('death, ragdoll and respawn', () => {
  remote.push(state(0, 0, 16), 4);
  remote.update(0.05, 4.08);
  assert(!remote.alive && must(remote._figure, 'figure').root.rotation.x > 0 && remote.deadT === 0.05, 'Dead flag starts the slump and dead timer.');
  const tracers = calls.tracers.length;
  remote.shots('rifle', [1, 2, 3]);
  remote.takeDamage(12);
  assert(calls.tracers.length === tracers && damage === 12, 'A dead remote ignores shots and damage.');
  remote.push(state(1), 4.1);
  remote.update(0.05, 4.18);
  assert(remote.visible && remote.alive, 'An alive packet recovers a slump without a ragdoll.');

  remote.ragdoll([2, 0, 0], true);
  assert(remote.visible && calls.debris.length === 0, 'An invalid ragdoll direction makes no change.');
  remote.ragdoll([0, 0, -1], true);
  assert(!remote.visible && !remote.alive && calls.debris.length >= 2 && calls.blood === 1 && calls.pools === 1,
    'Overkill transfers head and body to debris with blood.');
  assert(remote.hits.every(hit => hit.obj.position.y === -100), 'Ragdoll parks every hit sphere.');
  assert(remote._tag === null && !remote._rope.visible && !remote._hookMesh.visible, 'Ragdoll releases the tag and hides grapple objects.');
  const debrisCount = calls.debris.length;
  remote.ragdoll(null, true);
  assert(calls.debris.length === debrisCount, 'Ragdoll happens once per life.');
  remote.push(state(8, 0, 80, 2), 5);
  remote.update(0, 5);
  assert(remote.alive && remote.visible && remote.body.pos.x === 8 && remote._a === null && remote._wi === -1,
    'Respawn clears the old interpolation and uses the default rifle for one packet.');
  remote.push(state(8, 0, 80, 2), 5.05);
  assert(remote._wi === 2, 'The packet after respawn applies the selected weapon.');
});

test('disposal', () => {
  const figureRoot = must(remote._figure, 'figure').root;
  remote.dispose();
  remote.dispose();
  moving.dispose();
  assert(!scene.children.includes(figureRoot) && !remote.visible && remote.hits.every(hit => hit.obj.position.y === -100),
    'Disposal removes the avatar and is safe twice.');
  remote.push(state(10), 6);
  assert(!remote.visible, 'A disposed remote cannot be revived by a late packet.');
  assert(calls.debris.every(item => scene.children.includes(item.mesh)), 'Disposal preserves debris owned by effects.');
});

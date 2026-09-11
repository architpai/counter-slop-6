import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Effects } from '@/engine/effects';
import { World } from '@/engine/physics';
import { unlitMat, TONE_HEX } from '@/engine/render/index';
import type { Box } from '@/engine/physics';
import type { RayHit } from '@/engine/types';

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const must = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
};

// A real (empty) World: its raycast already returns null, and the collision
// section swaps in its own probe.
const scene = new THREE.Scene();
const world = new World();
const effects = new Effects(scene, world);
const pool = (name: string): THREE.InstancedMesh => {
  const mesh = scene.getObjectByName(`effects:${name}`);
  if (!(mesh instanceof THREE.InstancedMesh)) throw new Error(`no pool ${name}`);
  return mesh;
};
const instanced = (o: THREE.Object3D): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh;
const origin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
const quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
const box = (data: Box['data']): Box => ({ min: new THREE.Vector3(), max: new THREE.Vector3(), data, id: 0 });

test('tracer pools', () => {
  assert(scene.children.length === 8, 'Effects has eight fixed instance pools');
  effects.tracer(origin, new THREE.Vector3(0, -10, 0));
  effects.tracer(origin, origin);
  effects.update(0.01);
  assert(pool('strokes').count === 1, 'Zero-length tracer is ignored');
  pool('strokes').getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  assert(Math.abs(position.y + 5) < 1e-6 && Math.abs(scale.y - 10) < 1e-6, 'Downward tracer preserves midpoint and length');
  assert(up.clone().applyQuaternion(quaternion).y < -0.99, 'Tracer supports the negative Y axis');
  effects.update(0.1);
  assert(pool('strokes').count === 0, 'Expired tracers are removed');
});

test('particle, decal and pool capacities', () => {
  for (let i = 0; i < 710; i++) effects.particle({ kind: 'drop', pos: origin });
  for (let i = 0; i < 610; i++) effects.particle({ kind: 'stroke', pos: origin, vel: origin });
  effects.update(0.01);
  assert(pool('drops').count === 700 && pool('strokes').count === 600, 'Particle drawing respects fixed capacities');
  for (let i = 0; i < 270; i++) effects.decal(new THREE.Vector3(i, 0, 0), up, 0, 1, 'hole');
  assert(pool('holes').count === 260, 'Hole pool remains bounded');
  pool('holes').getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  assert(Math.abs(position.x - 260) < 1e-5, 'Hole ring overwrites the oldest mark');
  effects.shake = 0.7;
  effects.clear();
  assert(scene.children.every(mesh => instanced(mesh) && mesh.count === 0) && effects.shake === 0.7, 'Clear resets pools and preserves shake');
});

test('emitters and particle collision', () => {
  effects.fountain(origin, up, 0.8);
  effects.update(0.025);
  effects.update(0);
  assert(pool('drops').count === 1, 'Fountain emits forty drops per second');
  effects.clear();
  let swept = false;
  world.raycast = (o: THREE.Vector3, d: THREE.Vector3, distance = 1000,
    ignore?: (b: Box) => boolean): RayHit | null => {
    assert(typeof ignore === 'function' && ignore(box({ noShoot: true })), 'Particles skip noShoot colliders');
    if (swept) return null;
    swept = true;
    assert(Math.abs(distance - 0.125) < 1e-8, 'Particle sweep includes half its diameter');
    return { dist: distance, point: origin.clone(), normal: up.clone(), box: box({}) };
  };
  effects.particle({ kind: 'drop', pos: new THREE.Vector3(0, 0.1, 0),
    vel: new THREE.Vector3(0, -2, 0), gravity: 0, size: 0.05, collide: 'decal' });
  effects.update(0.05);
  assert(swept && pool('drops').count === 0, 'Collision removes the particle and creates a decal');
  assert(scene.children.filter(mesh => mesh.name.startsWith('effects:splats')).some(mesh => instanced(mesh) && mesh.count), 'Colliding particle deposits a splat');
  effects.clear();
  world.raycast = () => null;
});

test('debris ownership and expiry', () => {
  const parent = new THREE.Group();
  parent.position.set(3, 4, 5);
  parent.rotation.y = 0.7;
  parent.scale.setScalar(2);
  scene.add(parent);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), unlitMat(TONE_HEX[0]));
  parent.add(mesh);
  scene.updateMatrixWorld(true);
  const worldQuat = mesh.getWorldQuaternion(new THREE.Quaternion());
  let disposed = false;
  mesh.geometry.addEventListener('dispose', () => { disposed = true; });
  effects.debris(mesh, mesh.getWorldPosition(new THREE.Vector3()), origin, origin, { life: 0.02, blood: true });
  assert(mesh.parent === scene && Math.abs(mesh.scale.x - 2) < 1e-9 && Math.abs(mesh.quaternion.dot(worldQuat)) > 0.99999,
    'Debris transfers ownership and preserves the world transform');
  effects.update(0.03);
  assert(mesh.parent === null && disposed, 'Debris expiry removes the mesh and releases its geometry');

  const pieces: THREE.Object3D[] = [];
  for (let i = 0; i < 71; i++) {
    const piece = new THREE.Object3D();
    pieces.push(piece);
    effects.debris(piece, origin, origin, origin);
  }
  assert(must(pieces[0], 'first piece').parent === null && must(pieces[70], 'last piece').parent === scene, 'Debris cap removes the oldest piece');
  effects.clear();
  assert(pieces.every(piece => piece.parent === null), 'Clear removes every owned debris piece');
  effects.boom(origin);
  effects.explosion(origin);
  assert(Math.abs(effects.shake - 2) < 1e-10, 'Only explosion recipes add their specified shake');
  effects.clear();
  scene.remove(parent);
  for (const mesh of scene.children) if (instanced(mesh)) mesh.geometry.dispose();
});

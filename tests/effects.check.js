import * as THREE from 'three';
import { Effects } from '../src/effects.js';
import { unlitMat, TONE_HEX } from '../src/render/index.js';

export function run(assert) {
  const scene = new THREE.Scene();
  const world = { raycast: () => null };
  const effects = new Effects(scene, world);
  const pool = name => scene.getObjectByName(`effects:${name}`);
  const origin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
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
  assert(scene.children.every(mesh => mesh.count === 0) && effects.shake === 0.7, 'Clear resets pools and preserves shake');

  effects.fountain(origin, up, 0.8);
  effects.update(0.025);
  effects.update(0);
  assert(pool('drops').count === 1, 'Fountain emits forty drops per second');
  effects.clear();
  let swept = false;
  world.raycast = (o, d, distance, ignore) => {
    assert(typeof ignore === 'function' && ignore({ data: { noShoot: true } }), 'Particles skip noShoot colliders');
    if (swept) return null;
    swept = true;
    assert(Math.abs(distance - 0.125) < 1e-8, 'Particle sweep includes half its diameter');
    return { point: origin.clone(), normal: up.clone() };
  };
  effects.particle({ kind: 'drop', pos: new THREE.Vector3(0, 0.1, 0),
    vel: new THREE.Vector3(0, -2, 0), gravity: 0, size: 0.05, collide: 'decal' });
  effects.update(0.05);
  assert(swept && pool('drops').count === 0, 'Collision removes the particle and creates a decal');
  assert(scene.children.filter(mesh => mesh.name.startsWith('effects:splats')).some(mesh => mesh.count), 'Colliding particle deposits a splat');
  effects.clear();

  world.raycast = () => null;
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

  const pieces = [];
  for (let i = 0; i < 71; i++) {
    const piece = new THREE.Object3D();
    pieces.push(piece);
    effects.debris(piece, origin, origin, origin);
  }
  assert(pieces[0].parent === null && pieces[70].parent === scene, 'Debris cap removes the oldest piece');
  effects.clear();
  assert(pieces.every(piece => piece.parent === null), 'Clear removes every owned debris piece');
  effects.boom(origin);
  effects.explosion(origin);
  assert(Math.abs(effects.shake - 2) < 1e-10, 'Only explosion recipes add their specified shake');
  effects.clear();
  scene.remove(parent);
  for (const mesh of scene.children) mesh.geometry.dispose();
}

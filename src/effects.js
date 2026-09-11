import * as THREE from 'three';
import { clamp, lerp, rand, randInt, TAU } from './util.js';
import { TONE, TONE_HEX, WHITE_HEX, SMOKE_HEX, unlitMat } from './render/index.js';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const previous = new THREE.Vector3();
const motion = new THREE.Vector3();
const drawAxis = new THREE.Vector3();
const surfaceNormal = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const offset = new THREE.Vector3();
const probe = new THREE.Vector3();
const probeDir = new THREE.Vector3();
const inPlane = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const localPosition = new THREE.Vector3();
const transform = new THREE.Object3D();
const basis = new THREE.Matrix4();
const spin = new THREE.Quaternion();
const color = new THREE.Color();
const seeThrough = box => !!box.data?.noShoot;
const finiteVector = v => v?.isVector3 && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
const toneId = n => Number.isInteger(n) && n >= 0 && n < TONE_HEX.length ? n : TONE.HOSTILE;

function unit(v) {
  return v.lengthSq() > 1e-20 ? v.normalize() : v.copy(UP);
}

function randomVector(yMin = -1, yMax = 1, xz = 1) {
  return new THREE.Vector3(rand(-xz, xz), rand(yMin, yMax), rand(-xz, xz));
}

function makePool(scene, name, geometry, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, unlitMat(WHITE_HEX), capacity);
  mesh.name = `effects:${name}`;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, color.setHex(TONE_HEX[TONE.HOSTILE]));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return { mesh, capacity, next: 0, generations: new Uint32Array(capacity) };
}

function blobGeometry(seed) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 20; i++) {
    const angle = i / 20 * TAU;
    const finger = (i + seed * 3) % 7 === 0 ? 1.35 : 1;
    const r = rand(0.42, 0.52) * finger;
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const shapes = [shape];
  for (let i = 0, n = 3 + seed % 3; i < n; i++) {
    const angle = rand(0, TAU), r = rand(0.6, 0.82), dot = new THREE.Shape();
    dot.absarc(Math.cos(angle) * r, Math.sin(angle) * r, rand(0.045, 0.095), 0, TAU, false);
    shapes.push(dot);
  }
  return new THREE.ShapeGeometry(shapes, 4);
}

function put(pool, index, matrix, hex) {
  pool.mesh.setMatrixAt(index, matrix);
  pool.mesh.setColorAt(index, color.setHex(hex));
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.mesh.instanceColor.needsUpdate = true;
}

function slot(pool) {
  const index = pool.next;
  pool.next = (index + 1) % pool.capacity;
  pool.mesh.count = Math.min(pool.capacity, pool.mesh.count + 1);
  pool.generations[index]++;
  return index;
}

function face(normal, streakDir) {
  surfaceNormal.copy(normal);
  unit(surfaceNormal);
  if (finiteVector(streakDir)) {
    inPlane.copy(streakDir).addScaledVector(surfaceNormal, -streakDir.dot(surfaceNormal));
    if (inPlane.lengthSq() > 1e-10) {
      inPlane.normalize();
      xAxis.crossVectors(inPlane, surfaceNormal).normalize();
      basis.makeBasis(xAxis, inPlane, surfaceNormal);
      transform.quaternion.setFromRotationMatrix(basis);
      return true;
    }
  }
  transform.quaternion.setFromUnitVectors(FRONT, surfaceNormal);
  spin.setFromAxisAngle(FRONT, rand(0, TAU));
  transform.quaternion.multiply(spin);
  return false;
}

function surfaceBasis(normal) {
  surfaceNormal.copy(normal);
  unit(surfaceNormal);
  tangent.crossVectors(Math.abs(surfaceNormal.y) < 0.9 ? UP : FRONT, surfaceNormal).normalize();
  bitangent.crossVectors(surfaceNormal, tangent);
}

export class Effects {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.shake = 0;
    this._particles = [];
    this._growing = [];
    this._debris = [];
    this._bloodyGibs = 0;
    this._drops = makePool(scene, 'drops', new THREE.IcosahedronGeometry(0.5, 1), 700);
    this._strokes = makePool(scene, 'strokes', new THREE.BoxGeometry(1, 1, 1), 600);
    this._splats = Array.from({ length: 5 }, (_, i) => makePool(scene, `splats-${i}`, blobGeometry(i), 300));
    this._holes = makePool(scene, 'holes', new THREE.CircleGeometry(0.5, 8), 260);
    this._pools = [this._drops, this._strokes, ...this._splats, this._holes];
  }

  particle(p) {
    if (!p || !['drop', 'stroke', 'emitter'].includes(p.kind) || !finiteVector(p.pos)) return;
    const life = finite(p.life, 1), size = Math.max(0, finite(p.size, 0.05));
    if (life <= 0 || size === 0) return;
    this._particles.push({
      kind: p.kind, pos: p.pos.clone(), vel: finiteVector(p.vel) ? p.vel.clone()
        : p.kind === 'emitter' || p.fixedLen > 0 ? null : new THREE.Vector3(),
      life, maxLife: life, size, tone: toneId(p.tone), gravity: finite(p.gravity, 20),
      drag: Math.max(0, finite(p.drag, 0)), collide: p.collide === 'decal' ? 'decal' : 'none',
      stretch: Math.max(0, finite(p.stretch, 0.03)), fixedLen: Math.max(0, finite(p.fixedLen, 0)),
      axis: finiteVector(p.axis) ? unit(p.axis.clone()) : null,
      decalSize: Math.max(0, finite(p.decalSize, 3)), shrink: p.shrink !== false,
      grow: Math.max(0, finite(p.grow, 0)), rate: Math.max(0, finite(p.rate, 0)), acc: 0,
      emitDir: finiteVector(p.emitDir) ? p.emitDir.clone() : UP.clone(), hex: TONE_HEX[toneId(p.tone)],
    });
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this._drops.mesh.count = this._strokes.mesh.count = 0;
    // New particles draw at birth but start their simulation on the following frame.
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.life -= dt;
      if (p.life <= 0) { this._particles.splice(i, 1); continue; }
      if (p.kind === 'emitter') {
        p.acc += dt * p.rate;
        while (p.acc >= 1) {
          p.acc--;
          this.particle({ kind: 'drop', pos: p.pos,
            vel: randomVector().multiplyScalar(1.2).addScaledVector(p.emitDir, rand(2, 5)),
            size: rand(0.02, 0.05), life: rand(1, 2), tone: p.tone,
            collide: 'decal', gravity: 22, decalSize: 6 });
        }
        continue;
      }
      if (p.vel) {
        previous.copy(p.pos);
        p.vel.y -= p.gravity * dt;
        if (p.drag > 0) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.pos.addScaledVector(p.vel, dt);
        motion.subVectors(p.pos, previous);
        const moved = motion.length();
        if (p.collide === 'decal' && moved >= 1e-5) {
          motion.divideScalar(moved);
          const hit = this.world.raycast(previous, motion, moved + p.size * 0.5, seeThrough);
          if (hit) {
            this.splat(hit.point, hit.normal, p.tone, p.size * p.decalSize * 0.75,
              motion, p.size > 0.035 ? 2 : 1);
            this._particles.splice(i, 1);
            continue;
          }
        }
        if (p.pos.y < -10) { this._particles.splice(i, 1); continue; }
      }
    }
    for (let i = this._growing.length - 1; i >= 0; i--) {
      const g = this._growing[i];
      if (g.pool.generations[g.index] !== g.generation) { this._growing.splice(i, 1); continue; }
      g.time += dt;
      const f = Math.min(1, g.time / g.duration), e = 1 - (1 - f) ** 2;
      transform.position.copy(g.pos);
      transform.quaternion.copy(g.quat);
      transform.scale.set(g.size * e, g.size * e, 1);
      transform.updateMatrix();
      put(g.pool, g.index, transform.matrix, g.hex);
      if (f >= 1) this._growing.splice(i, 1);
    }
    for (let i = this._debris.length - 1; i >= 0; i--) this._stepDebris(i, dt);
    for (const p of this._particles) if (p.kind !== 'emitter') this._draw(p);
  }

  _draw(p) {
    const pool = p.kind === 'drop' ? this._drops : this._strokes;
    if (pool.mesh.count === pool.capacity) return;
    const frac = clamp(p.life / p.maxLife, 0, 1);
    transform.position.copy(p.pos);
    if (p.kind === 'drop') {
      const f = p.grow > 0 ? lerp(1, p.grow, 1 - frac) : p.shrink ? 0.4 + 0.6 * frac : 1;
      transform.scale.setScalar(p.size * f);
      transform.quaternion.identity();
    } else {
      const speed = p.vel ? p.vel.length() : 0;
      let length;
      if (p.fixedLen > 0) { drawAxis.copy(p.axis || UP); length = p.fixedLen; }
      else if (speed > 1e-10) {
        drawAxis.copy(p.vel).divideScalar(speed);
        length = clamp(speed * p.stretch, p.size * 2, 1.6);
      } else { drawAxis.copy(UP); length = p.size; }
      const width = p.size * (p.shrink ? 0.5 + 0.5 * frac : 1);
      transform.quaternion.setFromUnitVectors(UP, drawAxis);
      transform.scale.set(width, length, width);
    }
    transform.updateMatrix();
    put(pool, pool.mesh.count++, transform.matrix, p.hex);
  }

  decal(point, normal, tone, size, kind = 'splat', streakDir = null, stretch = 1) {
    if (!finiteVector(point) || !finiteVector(normal) || !Number.isFinite(size) || size <= 0) return;
    const pool = kind === 'hole' ? this._holes : this._splats[randInt(0, 4)];
    const index = slot(pool), streak = face(normal, streakDir);
    transform.position.copy(point).addScaledVector(surfaceNormal, rand(0.012, 0.03));
    transform.scale.set(streak ? size * rand(0.6, 0.85) : size,
      streak ? size * Math.max(0, finite(stretch, 1)) * rand(0.9, 1.5) : size * rand(0.7, 1.3), 1);
    transform.updateMatrix();
    put(pool, index, transform.matrix, TONE_HEX[toneId(tone)]);
  }

  _surfaceAt(point, normal, delta) {
    probe.copy(point).add(delta).addScaledVector(normal, 0.35);
    probeDir.copy(normal).negate();
    let hit = this.world.raycast(probe, probeDir, 2.2, seeThrough);
    const length = delta.length();
    if (!hit && length > 0.0001) {
      probe.copy(point).add(delta).addScaledVector(normal, 0.05);
      probeDir.copy(delta).multiplyScalar(-1 / length);
      hit = this.world.raycast(probe, probeDir, length + 0.3, seeThrough);
    }
    return hit;
  }

  splat(point, normal, tone, size, streakDir = null, cluster = 3) {
    if (!finiteVector(point) || !finiteVector(normal) || !Number.isFinite(size) || size <= 0) return;
    this.decal(point, normal, tone, size * rand(0.55, 0.8), 'splat', streakDir);
    for (let i = 0; i < Math.max(0, finite(cluster, 3)); i++) {
      // decal changes the shared normal, so rebuild the original surface basis for each mark.
      surfaceBasis(normal);
      const a = rand(0, TAU), radius = size * rand(0.3, 1.15);
      offset.copy(tangent).multiplyScalar(Math.cos(a) * radius).addScaledVector(bitangent, Math.sin(a) * radius);
      if (finiteVector(streakDir)) offset.addScaledVector(streakDir, size * rand(0, 0.7));
      const hit = this._surfaceAt(point, surfaceNormal, offset);
      if (hit) this.decal(hit.point, hit.normal, tone, size * rand(0.2, 0.5), 'splat', streakDir);
    }
    if (Math.abs(normal.y) < 0.55 && rand() < 0.75) {
      surfaceBasis(normal);
      offset.copy(DOWN).multiplyScalar(size * rand(0.5, 1.3));
      const hit = this._surfaceAt(point, surfaceNormal, offset);
      if (hit) this.decal(hit.point, hit.normal, tone, size * rand(0.16, 0.3), 'splat', DOWN, rand(2.5, 5));
    }
  }

  bloodPool(pos, size = 1.3, tone = TONE.HOSTILE) {
    if (!finiteVector(pos) || !Number.isFinite(size) || size <= 0) return;
    probe.copy(pos).addScaledVector(UP, 0.5);
    const floor = this.world.raycast(probe, DOWN, 5, seeThrough);
    if (!floor) return;
    for (let i = 0; i < 3; i++) {
      let hit = floor;
      if (i > 0) {
        surfaceBasis(floor.normal);
        const a = rand(0, TAU), r = size * rand(0.15, 0.5);
        offset.copy(tangent).multiplyScalar(Math.cos(a) * r).addScaledVector(bitangent, Math.sin(a) * r);
        hit = this._surfaceAt(floor.point, surfaceNormal, offset);
        if (!hit) continue;
      }
      const pool = this._splats[randInt(0, 4)], index = slot(pool);
      face(hit.normal, null);
      transform.position.copy(hit.point).addScaledVector(surfaceNormal, rand(0.02, 0.04));
      const g = { pool, index, generation: pool.generations[index], time: 0, duration: rand(0.5, 1.1),
        size: size * (i === 0 ? rand(0.75, 1) : rand(0.3, 0.6)),
        pos: transform.position.clone(), quat: transform.quaternion.clone(), hex: TONE_HEX[toneId(tone)] };
      this._growing.push(g);
      transform.scale.set(0, 0, 1);
      transform.updateMatrix();
      put(pool, index, transform.matrix, g.hex);
    }
  }

  debris(mesh, pos, vel, angVel, o = {}) {
    if (!mesh?.isObject3D || !finiteVector(pos) || !finiteVector(vel) || !finiteVector(angVel)) return;
    const existing = this._debris.findIndex(d => d.mesh === mesh);
    if (existing !== -1) return;
    if (this._debris.length >= 70) this._removeDebris(0);
    this.scene.attach(mesh);
    mesh.position.copy(this.scene.worldToLocal(localPosition.copy(pos)));
    mesh.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = false; } });
    const d = { mesh, pos: pos.clone(), vel: vel.clone(), angVel: angVel.clone(),
      scale: mesh.scale.clone(), life: finite(o.life, 10), radius: Math.max(0, finite(o.radius, 0.18)),
      blood: o.blood === true, bounces: 0, atRest: false, trailT: 0 };
    this._debris.push(d);
    if (d.blood) this._bloodyGibs++;
  }

  _removeDebris(index) {
    const [d] = this._debris.splice(index, 1);
    d.mesh.removeFromParent();
    const geometries = new Set();
    d.mesh.traverse(child => { if (child.geometry) geometries.add(child.geometry); });
    for (const geometry of geometries) geometry.dispose();
    if (d.blood) this._bloodyGibs--;
  }

  _stepDebris(index, dt) {
    const d = this._debris[index];
    if (!d.atRest) {
      previous.copy(d.pos);
      d.vel.y -= 20 * dt;
      d.pos.addScaledVector(d.vel, dt);
      motion.subVectors(d.pos, previous);
      const moved = motion.length();
      if (moved >= 1e-6) {
        motion.divideScalar(moved);
        const hit = this.world.raycast(previous, motion, moved + d.radius);
        if (hit) {
          d.pos.copy(hit.point).addScaledVector(hit.normal, d.radius);
          const vn = d.vel.dot(hit.normal);
          if (vn < 0) {
            d.vel.addScaledVector(hit.normal, -1.35 * vn).multiplyScalar(0.55);
            d.angVel.multiplyScalar(0.5);
          }
          d.bounces++;
          if (d.blood && d.bounces <= 3) this.splat(hit.point, hit.normal, TONE.HOSTILE, rand(0.4, 0.85), null, 2);
          if (d.vel.lengthSq() < 1 && hit.normal.y > 0.5) { d.atRest = true; d.vel.set(0, 0, 0); }
        }
      }
      d.mesh.rotation.x += d.angVel.x * dt;
      d.mesh.rotation.y += d.angVel.y * dt;
      d.mesh.rotation.z += d.angVel.z * dt;
      if (d.blood && d.vel.lengthSq() > 3) {
        d.trailT += dt;
        while (d.trailT >= 0.05) {
          d.trailT -= 0.05;
          this.particle({ kind: 'drop', pos: d.pos, vel: randomVector().addScaledVector(d.vel, 0.3),
            size: rand(0.02, 0.045), life: 1.5, tone: TONE.HOSTILE, collide: 'decal', gravity: 22, decalSize: 6 });
        }
      }
      if (d.pos.y < -8) d.life = 0;
      d.mesh.position.copy(this.scene.worldToLocal(localPosition.copy(d.pos)));
    }
    d.life -= dt;
    if (d.life <= 0) { this._removeDebris(index); return; }
    d.mesh.scale.copy(d.scale).multiplyScalar(d.life < 0.6 ? Math.max(0.001, d.life / 0.6) : 1);
  }

  clear() {
    this._particles.length = this._growing.length = 0;
    while (this._debris.length) this._removeDebris(this._debris.length - 1);
    for (const pool of this._pools) {
      pool.mesh.count = pool.next = 0;
      pool.generations.fill(0);
    }
  }

  sparks(point, normal, tone = TONE.PRIMARY, n = 6, speed = 7) {
    if (!finiteVector(normal)) return;
    for (let i = 0; i < finite(n, 6); i++) {
      const vel = unit(randomVector());
      if (vel.dot(normal) < 0) vel.negate();
      unit(vel.addScaledVector(normal, 0.6)).multiplyScalar(rand(0.4 * speed, speed));
      this.particle({ kind: 'stroke', pos: point, vel, tone, size: rand(0.012, 0.025),
        life: rand(0.15, 0.35), gravity: 14, stretch: 0.035 });
    }
  }

  strokeBurst(pos, tone, n = 16, speed = 6, o = {}) {
    for (let i = 0; i < finite(n, 16); i++) this.particle({ kind: 'stroke', pos, tone,
      vel: unit(randomVector()).multiplyScalar(rand(0.3 * speed, speed)),
      size: o.size ?? rand(0.02, 0.04), life: o.life ?? rand(0.25, 0.5),
      gravity: o.gravity ?? 0, stretch: o.stretch ?? 0.05, drag: o.drag ?? 3 });
  }

  tracer(from, to, tone = TONE.PRIMARY, thick = 0.022, life = 0.06) {
    if (!finiteVector(from) || !finiteVector(to)) return;
    const axis = to.clone().sub(from), length = axis.length();
    if (length < 0.05) return;
    this.particle({ kind: 'stroke', pos: from.clone().add(to).multiplyScalar(0.5),
      axis: axis.divideScalar(length), fixedLen: length, size: thick, life, tone, gravity: 0, shrink: false });
  }

  bulletImpact(point, normal, tone = TONE.PRIMARY) {
    this.decal(point, normal, tone, rand(0.06, 0.1), 'hole');
    this.sparks(point, normal, tone, 5);
  }

  blood(pos, dir, amount = 1, o = {}) {
    if (!finiteVector(dir) || !Number.isFinite(amount) || amount <= 0) return;
    const tone = o.tone ?? TONE.HOSTILE;
    for (let i = 0; i < Math.round(14 * amount); i++) this.particle({ kind: 'drop', pos, tone,
      vel: randomVector(-0.5, 1.2).multiplyScalar(rand(1, 4.5)).addScaledVector(dir, rand(1, 6)),
      size: rand(0.02, 0.065), life: rand(1.2, 2.6), collide: 'decal', gravity: 22, decalSize: rand(4, 8) });
    for (let i = 0; i < Math.round(7 * amount); i++) this.particle({ kind: 'stroke', pos, tone,
      vel: randomVector(-0.3, 1).multiplyScalar(rand(1, 4)).addScaledVector(dir, rand(6, 15)),
      size: rand(0.02, 0.04), life: rand(0.3, 0.6), collide: 'decal', gravity: 12, stretch: 0.05, decalSize: 5 });
    for (let i = 0; i < Math.round(6 * amount); i++) this.particle({ kind: 'drop', pos, tone,
      vel: randomVector(-0.2, 1).multiplyScalar(rand(0.5, 2.5)).addScaledVector(dir, rand(0, 2)),
      size: rand(0.012, 0.03), life: rand(0.3, 0.7), gravity: 6, drag: 2 });
  }

  drip(pos, amount = 1) {
    this.particle({ kind: 'drop', pos, vel: randomVector(-0.4, 0.2, 0.3),
      size: rand(0.018, 0.03) + 0.02 * finite(amount, 1), life: rand(1, 1.8),
      tone: TONE.HOSTILE, collide: 'decal', gravity: 20, decalSize: 5 });
  }

  fountain(pos, dir, dur = 0.8, tone = TONE.HOSTILE) {
    this.particle({ kind: 'emitter', pos, life: dur, emitDir: dir, rate: 40, tone });
  }

  shell(pos, vel, tone = TONE.ACCENT, size = 0.02) {
    this.particle({ kind: 'stroke', pos, vel, tone, size, life: rand(0.9, 1.4),
      gravity: 22, stretch: 0.012, drag: 0.5, shrink: false });
  }

  _smokeParticle(p) {
    const before = this._particles.length;
    this.particle(p);
    if (this._particles.length > before) this._particles[this._particles.length - 1].hex = SMOKE_HEX;
  }

  smoke(pos, dir, n = 3) {
    if (!finiteVector(dir)) return;
    for (let i = 0; i < finite(n, 3); i++) this._smokeParticle({ kind: 'drop', pos,
      vel: randomVector(0.6, 1.4, 0.5).addScaledVector(dir, rand(0.6, 1.8)),
      size: rand(0.04, 0.07), life: rand(0.45, 0.8), tone: TONE.PRIMARY,
      gravity: -1.2, drag: 3, grow: 3.2, shrink: false });
  }

  explosion(pos, radius = 4, tone = TONE.DARK) {
    if (!finiteVector(pos)) return;
    for (let i = 0; i < 40; i++) this.particle({ kind: 'drop', pos, tone,
      vel: unit(randomVector(-0.2, 1)).multiplyScalar(rand(4, 14)),
      size: rand(0.03, 0.1), life: rand(1, 2), collide: 'decal', gravity: 20, decalSize: rand(3, 6) });
    for (let i = 0; i < 26; i++) this.particle({ kind: 'stroke', pos, tone: i % 3 === 0 ? TONE.ACCENT : tone,
      vel: unit(randomVector(-0.3, 1)).multiplyScalar(rand(10, 22)),
      size: rand(0.03, 0.06), life: rand(0.2, 0.45), gravity: 6, stretch: 0.05 });
    for (let i = 0; i < 8; i++) this._smokeParticle({ kind: 'drop', pos, tone: TONE.PRIMARY,
      vel: randomVector(0.5, 1.5).multiplyScalar(rand(1, 3)), size: rand(0.12, 0.25),
      life: rand(0.7, 1.2), gravity: -1.5, drag: 2.5, grow: 3, shrink: false });
    this.bloodPool(pos, radius * 0.9, tone);
    this.shake += 0.5;
  }

  boom(pos, radius = 5) {
    if (!finiteVector(pos) || !Number.isFinite(radius) || radius <= 0) return;
    const k = radius / 5;
    for (let i = 0; i < 4; i++) this.particle({ kind: 'drop', pos, tone: TONE.ACCENT,
      vel: unit(randomVector(0.2, 1)).multiplyScalar(rand(0.3, 1.6)), size: rand(2.2, 3.2) * k,
      life: rand(0.3, 0.45), gravity: -2, drag: 3, grow: 3.2, shrink: false });
    for (let i = 0; i < 26; i++) this.particle({ kind: 'drop', pos, tone: i % 5 === 0 ? TONE.DARK : TONE.ACCENT,
      vel: unit(randomVector(-0.3, 1)).multiplyScalar(rand(2, 8)), size: rand(0.9, 1.9) * k,
      life: rand(0.35, 0.6), gravity: -3, drag: 4, grow: 2.8, shrink: false });
    for (let i = 0; i < 64; i++) this.particle({ kind: 'stroke', pos, tone: i % 4 === 0 ? TONE.DARK : TONE.ACCENT,
      vel: unit(randomVector(-0.15, 0.9)).multiplyScalar(rand(14, 34) * k), size: rand(0.09, 0.2) * k,
      life: rand(0.3, 0.55), gravity: 8, stretch: 0.09, drag: 2 });
    for (let i = 0; i < 30; i++) this.particle({ kind: 'drop', pos, tone: TONE.DARK,
      vel: unit(randomVector(0.2, 1)).multiplyScalar(rand(3, 10) * k), size: rand(0.06, 0.14),
      life: rand(0.8, 1.6), collide: 'decal', gravity: 16, decalSize: rand(3, 7) * k });
    for (let i = 0; i < 18; i++) this._smokeParticle({ kind: 'drop', pos, tone: TONE.DARK,
      vel: randomVector(0.8, 2).multiplyScalar(rand(1.2, 3.4)), size: rand(0.35, 0.7) * k,
      life: rand(1, 1.8), gravity: -2, drag: 2.2, grow: 3.6, shrink: false });
    this.bloodPool(pos, radius * 0.8, TONE.DARK);
    this.shake += 0.8;
  }
}

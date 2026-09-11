import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfMat, TONE, boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo } from '../render/index.js';

const surfaces = ['block', 'hot', 'dark', 'accent', 'foliage', 'boss'];
const yAxis = new THREE.Vector3(0, 1, 0);

export class LevelBuilder {
  constructor(scene, world, key, arena) {
    this.scene = scene;
    this.world = world;
    this.tone = TONE;
    this.parts = new Map();
    const p = key === 'mexico' ? 62 : arena ? 68 : 55;
    this.level = {
      key, arena, playerStart: new THREE.Vector3(0, 0, key === 'mexico' ? 16 : 42),
      bounds: { minX: -p, maxX: p, minZ: -p, maxZ: p },
      spawns: [], snipers: [], pickups: [], rings: [], arenaSpawns: [], teamSpawns: [],
      movers: [], animated: [], breakables: [], meshes: [],
      shadow: { center: new THREE.Vector3(), radius: p * 1.15 },
    };
  }

  addObject(obj) {
    obj.traverse(child => {
      if (child.isMesh) child.castShadow = child.receiveShadow = true;
    });
    this.scene.add(obj);
    this.level.meshes.push(obj);
    return obj;
  }

  mesh(geometry, pos, opts = {}) {
    const key = opts.mat ?? opts.surface ?? surfaces[opts.tone ?? TONE.PRIMARY];
    const object = new THREE.Mesh(geometry, surfMat(key));
    if (Array.isArray(pos)) object.position.fromArray(pos);
    else object.position.copy(pos);
    if (opts.rotation) object.rotation.copy(opts.rotation);
    if (opts.separate) return this.addObject(object);
    object.updateMatrix();
    geometry.applyMatrix4(object.matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geometry);
    return object;
  }

  collider(x, y, z, w, h, d, opts = {}) {
    return this.world.addBox(new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h, z + d / 2), {
        noNav: !!opts.noNav, noShoot: !!opts.noShoot,
        noGrapple: !!opts.noGrapple, ...(opts.tag === undefined ? {} : { tag: opts.tag }),
      });
  }

  box(x, y, z, w, h, d, opts = {}) {
    this.mesh(boxGeo(w, h, d), [x, y + h / 2, z], opts);
    return opts.noCollide ? null : this.collider(x, y, z, w, h, d, opts);
  }

  slab(x1, z1, x2, z2, top, thickness, opts = {}) {
    return this.box((x1 + x2) / 2, top - thickness, (z1 + z2) / 2,
      x2 - x1, thickness, z2 - z1, opts);
  }

  wall(axis, a1, a2, fixed, base, height, thickness, gaps = [], opts = {}) {
    const cuts = [...new Set([a1, a2, ...gaps.flatMap(g => [
      Math.max(a1, Math.min(a2, g[0])), Math.max(a1, Math.min(a2, g[1])),
    ])])].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2;
      if (hi - lo < 0.005) continue;
      const holes = gaps.filter(g => g[0] < mid && g[1] > mid)
        .map(g => [Math.max(0, g[2] ?? 0), Math.min(height, g[3] ?? height)])
        .filter(g => g[1] > g[0]).sort((a, b) => a[0] - b[0]);
      let bottom = 0;
      const solid = top => {
        if (top - bottom < 0.005) return;
        if (axis === 'x') this.box(mid, base + bottom, fixed, hi - lo, top - bottom, thickness, opts);
        else this.box(fixed, base + bottom, mid, thickness, top - bottom, hi - lo, opts);
      };
      for (const [from, to] of holes) { solid(from); bottom = Math.max(bottom, to); }
      solid(height);
    }
  }

  stairs(x, y, z, dir, n, width, opts = {}) {
    const rise = opts.rise ?? 4 / 14, run = opts.run ?? 0.45;
    const alongX = dir.endsWith('x'), sign = dir.startsWith('-') ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const distance = sign * (i + 0.5) * run;
      this.box(x + (alongX ? distance : 0), y, z + (alongX ? 0 : distance),
        alongX ? run + 0.004 : width, (i + 1) * rise,
        alongX ? width : run + 0.004, opts);
    }
  }

  rail(x1, z1, x2, z2, y, opts = {}) {
    const length = Math.hypot(x2 - x1, z2 - z1), alongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const x = (x1 + x2) / 2, z = (z1 + z2) / 2;
    this.box(x, y + 0.9, z, alongX ? length : 0.12, 0.12, alongX ? 0.12 : length,
      { ...opts, noCollide: true });
    const n = Math.max(1, Math.round(length / 2));
    for (let i = 0; i <= n; i++) {
      this.box(x1 + (x2 - x1) * i / n, y, z1 + (z2 - z1) * i / n, 0.1, 0.9, 0.1,
        { ...opts, noCollide: true });
    }
    return this.collider(x, y, z, alongX ? length : 0.12, 1, alongX ? 0.12 : length,
      { ...opts, noNav: true, noShoot: true });
  }

  cylinder(x, y, z, r, h, opts = {}) {
    this.mesh(cylGeo(r, h, opts.segments ?? 8), [x, y + h / 2, z], opts);
    return opts.noCollide ? null : this.collider(x, y, z, 1.6 * r, h, 1.6 * r, opts);
  }

  sphere(x, y, z, r, opts = {}) {
    return this.mesh(sphereGeo(r, opts.segments ?? 8), [x, y, z], opts);
  }

  ring(x, y, z, orientation = 'y') {
    const rotation = new THREE.Euler(orientation === 'y' ? Math.PI / 2 : 0,
      orientation === 'x' ? Math.PI / 2 : 0, 0);
    this.mesh(torusGeo(0.6, 0.1), [x, y, z], { mat: 'accent', rotation });
    this.marker('rings', x, y, z);
  }

  marker(kind, x, y, z) { this.level[kind].push(new THREE.Vector3(x, y, z)); }

  planes(n, baseRadius, baseHeight, opts = {}) {
    const scale = opts.scale ?? 1, radiusStep = opts.radiusStep ?? 12;
    const heightStep = opts.heightStep ?? 6, speed = opts.speed ?? 0.11;
    for (let i = 0; i < n; i++) {
      const geo = coneGeo(1.2 * scale, 4 * scale, 3);
      geo.rotateX(Math.PI / 2);
      const mesh = this.mesh(geo, [0, 0, 0], { ...opts, separate: true });
      const r = baseRadius + i * radiusStep, h = baseHeight + i * heightStep;
      const s = speed + 0.01 * i, phase = 2.1 * i;
      const next = new THREE.Vector3();
      const update = time => {
        const a = s * time + phase, ahead = a + 0.05;
        mesh.position.set(Math.cos(a) * r, h + 3 * Math.sin(2.3 * a), 0.7 * r * Math.sin(a));
        next.set(Math.cos(ahead) * r, h + 3 * Math.sin(2.3 * ahead), 0.7 * r * Math.sin(ahead));
        mesh.lookAt(next);
        mesh.rotateZ(0.6 * Math.sin(3 * a));
      };
      update(0);
      this.level.movers.push({ mesh, radius: 2.2 * scale });
      this.level.animated.push({ mesh, update });
    }
  }

  breakable(kind, x, y, z, w, h, d, parts, opts = {}) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(...parts);
    this.addObject(group);
    const box = this.collider(x, y, z, w, h, d, { noNav: true });
    const prop = { id: this.level.breakables.length, kind, group, hp: opts.hp ?? 1,
      pos: new THREE.Vector3(x, y + h / 2, z), alive: true, tone: opts.tone ?? TONE.ACCENT, box };
    box.data.breakable = prop;
    this.level.breakables.push(prop);
    return prop;
  }

  finish() {
    for (const [key, parts] of this.parts) {
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      this.addObject(new THREE.Mesh(geometry, surfMat(key)));
    }
    this.parts.clear();
    this.world.finalize();
    return this.level;
  }
}

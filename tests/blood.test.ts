import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Effects, GORE_SCALE } from '@/engine/effects';
import { World } from '@/engine/physics';
import { BLOOD, TONE, TONE_HEX } from '@/engine/render/index';

function setup() {
  const scene = new THREE.Scene(), world = new World();
  // A floor, and a wall 2 m ahead along -z.
  world.addBox(new THREE.Vector3(-20, -1, -20), new THREE.Vector3(20, 0, 20));
  world.addBox(new THREE.Vector3(-5, 0, -3.2), new THREE.Vector3(5, 4, -3));
  world.finalize();
  const effects = new Effects(scene, world);
  const splatCount = () => effects._splats.reduce((n, pool) => n + pool.mesh.count, 0);
  return { effects, splatCount };
}

const wound = new THREE.Vector3(0, 1.2, -1), shot = new THREE.Vector3(0, 0, -1);

test('blood is a deep red on Low, not the HUD alarm pink, and machines keep their oil', () => {
  const { effects } = setup();
  expect(effects.bloodHex(TONE.HOSTILE)).toBe(BLOOD.low);
  expect(effects.bloodHex(TONE.HOSTILE)).not.toBe(TONE_HEX[TONE.HOSTILE]);
  expect(effects.bloodHex(TONE.DARK)).toBe(TONE_HEX[TONE.DARK]);
});

test('a hit sprays layered blood that streaks along the shot, and spatters the wall behind', () => {
  const { effects, splatCount } = setup();
  effects.blood(wound, shot, 1.5);
  const blood = effects._particles.filter(p => p.blood);
  expect(blood.length).toBeGreaterThan(30);
  expect(blood.every(p => p.hex === BLOOD.low)).toBe(true);
  expect(blood.filter(p => p.kind === 'stroke').length, 'stretched streaks in the exit cone').toBeGreaterThan(15);
  const ahead = blood.filter(p => p.vel && p.vel.dot(shot) > 0).length;
  expect(ahead / blood.length, 'most of it thrown along the shot').toBeGreaterThan(0.7);
  expect(splatCount(), 'the wall 2 m behind takes a spatter at once').toBeGreaterThan(0);
  // The drops land and leave marks of their own.
  const before = splatCount();
  for (let i = 0; i < 120; i++) effects.update(1 / 60);
  expect(splatCount()).toBeGreaterThan(before);
});

test('the gore setting scales the blood, and Off draws none', () => {
  const count = (gore: number) => {
    const { effects, splatCount } = setup();
    effects.gore = gore;
    effects.blood(wound, shot, 1.5);
    effects.bloodPool(new THREE.Vector3(0, 0, 0), 1.3);
    effects.drip(wound);
    return { particles: effects._particles.length, splats: splatCount() + effects._growing.length };
  };
  const full = count(GORE_SCALE.full), reduced = count(GORE_SCALE.reduced), off = count(GORE_SCALE.off);
  expect(off).toEqual({ particles: 0, splats: 0 });
  expect(reduced.particles).toBeLessThan(full.particles * 0.7);
  expect(reduced.particles).toBeGreaterThan(0);
});

test('a sword cut throws more of it along the swing', () => {
  const plain = setup(), cut = setup();
  plain.effects.blood(wound, shot, 1);
  cut.effects.blood(wound, shot, 1, { fan: true });
  expect(cut.effects._particles.length).toBeGreaterThan(plain.effects._particles.length + 8);
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a pool on a stair keeps to its step instead of hanging over the edge', () => {
  // A step: the floor at 0 for z > 0, a riser up to 0.3 m for z < 0.
  const world = new World();
  world.addBox(new THREE.Vector3(-5, -1, 0), new THREE.Vector3(5, 0, 5));
  world.addBox(new THREE.Vector3(-5, -1, -5), new THREE.Vector3(5, 0.3, 0));
  world.finalize();
  const steps: { top: number; z: [number, number] }[] = [{ top: 0, z: [0, 5] }, { top: 0.3, z: [-5, 0] }];
  // The satellite pools scatter at random, and about one seed in nine puts one up on the riser's top (it must keep to
  // that step, not to the lower one). Fixed seeds keep the run the same each time and cover both steps. Seed 2 is
  // one that failed the old check (which held every pool to the lower step's edge): it puts two pools on the riser.
  const own = Math.random, onStep = [0, 0];
  try {
    for (let seed = 1; seed <= 200; seed++) {
      Math.random = mulberry32(seed);
      const effects = new Effects(new THREE.Scene(), world);
      effects.bloodPool(new THREE.Vector3(0, 0.5, 0.35), 1.3);
      expect(effects._growing.length, `seed ${seed}: a pool`).toBeGreaterThan(0);
      const riser = onStep[1]!;
      for (const g of effects._growing) {
        // Which step the pool lies on, by its height: 2-4 cm over the step's top, not floating or sunk.
        const s = steps.findIndex(s => g.pos.y - s.top >= 0.015 && g.pos.y - s.top <= 0.045);
        expect(s, `seed ${seed}: pool at y = ${g.pos.y.toFixed(3)} lies on a step`).toBeGreaterThanOrEqual(0);
        onStep[s]!++;
        const [near, far] = steps[s]!.z, r = g.size / 2, at = `seed ${seed}: pool at z = ${g.pos.z.toFixed(3)}, size ${g.size.toFixed(3)}`;
        expect(g.pos.z - r, `${at} keeps to its step`).toBeGreaterThanOrEqual(near - 0.01);
        expect(g.pos.z + r, `${at} keeps to its step`).toBeLessThanOrEqual(far + 0.01);
        expect(Math.abs(g.pos.x) + r, `${at} keeps to its step`).toBeLessThanOrEqual(5.01);
      }
      if (seed === 2) expect(onStep[1]! - riser, 'seed 2 puts pools up on the riser').toBeGreaterThan(0);
      const open = new Effects(new THREE.Scene(), world);
      open.bloodPool(new THREE.Vector3(0, 0.5, 3), 1.3);
      expect(Math.max(...open._growing.map(g => g.size)), `seed ${seed}: on open floor it keeps its size`).toBeGreaterThan(0.9);
    }
  } finally { Math.random = own; }
  expect(onStep[0], 'pools on the lower step').toBeGreaterThan(0);
  expect(onStep[1], 'pools up on the riser').toBeGreaterThan(0);
});

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

import { afterEach, expect, test } from 'vitest';
import * as THREE from 'three';
import type { Object3D } from 'three';
import { Renderer } from '@/engine/render/index';
import { PRESET_VALUES } from '@/engine/render/quality';
import type { PresetName } from '@/engine/render/quality';
import { WeaponAssets } from '@/engine/render/weapons';
import { Gun, Sword } from '@/engine/weapons/index';
import type { Ctx, Player } from '@/engine/types';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const done of cleanup.splice(0).reverse()) done(); });

/** A number list as its float64 bits, so -0 and +0 (or any last-bit change) differ. */
const bits = (values: ArrayLike<number>): number[] => Array.from(new Uint32Array(new Float64Array(Array.from(values)).buffer));

/** A renderer with every view model in its rig, as the game holds them (the flat models: no streaming). */
function rigged(): { renderer: Renderer; nodes: Object3D[]; held: (Gun | Sword)[]; probe: THREE.Mesh } {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new Renderer(canvas);
  const weapons = new WeaponAssets({ model: () => new Promise(() => {}), texture: () => new Promise(() => {}), upload: () => {} });
  const ctx = {
    renderer: { rig: renderer.rig, weapons, prepareRig: (root: Object3D) => renderer.prepareRig(root) },
    camera: renderer.camera,
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
  // Always shown, in front of the eye: its draw records the matrices the GPU gets.
  const probe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.4), new THREE.MeshBasicMaterial());
  probe.position.set(0.2, -0.2, -0.5);
  probe.add(new THREE.Object3D());
  renderer.rig.add(probe);
  renderer.prepareRig(probe);
  const nodes: Object3D[] = [];
  renderer.rig.traverse(node => { nodes.push(node); });
  cleanup.push(() => { for (const weapon of held) weapon.dispose(); weapons.clear(); renderer.dispose(); canvas.remove(); });
  return { renderer, nodes, held, probe };
}

test('the frame refreshes the camera alone before the operators; every rig matrix after render, and each drawn, is the same to the bit', async () => {
  // A: the frame as it is. B: as it was, the camera's whole subtree walked at that line (`updateMatrixWorld()`).
  const a = rigged(), b = rigged();
  const calls = new Map<Renderer, number>([[a.renderer, 0], [b.renderer, 0]]);
  for (const { renderer } of [a, b]) {
    const camera = renderer.camera, own = camera.updateWorldMatrix.bind(camera);
    camera.updateWorldMatrix = (parents: boolean, children: boolean) => {
      if (parents !== false || children !== false) return own(parents, children);
      calls.set(renderer, calls.get(renderer)! + 1);
      if (renderer === b.renderer) camera.updateMatrixWorld();
      else own(parents, children);
    };
  }
  expect(a.nodes.length).toBe(b.nodes.length);
  expect(a.nodes.length).toBeGreaterThan(50);
  const fx = { hurt: 0, flash: 0, slow: 0, lowHp: 0 };
  type Record = { frame: number[][]; props: number[][]; drawn: number[][]; after: number[][]; eye: number[][]; rigAtFrame: number[][] };
  const records = new Map<Renderer, Record>();
  for (const { renderer, probe, nodes } of [a, b]) {
    const record: Record = { frame: [], props: [], drawn: [], after: [], eye: [], rigAtFrame: [] };
    records.set(renderer, record);
    const camera = renderer.camera;
    const view = () => [...camera.matrixWorld.elements, ...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements];
    // What the readers between that line and the scene walk see of the camera.
    const frame = renderer.operators.frame.bind(renderer.operators);
    renderer.operators.frame = (cam: THREE.Camera) => {
      record.frame.push(view());
      record.rigAtFrame.push(nodes.flatMap(node => node.matrixWorld.elements));
      frame(cam);
    };
    const update = renderer.props.update.bind(renderer.props);
    renderer.props.update = (cam: THREE.Camera) => { record.props.push(view()); update(cam); };
    const depth = probe.onBeforeRender;
    probe.onBeforeRender = function (...args) {
      record.drawn.push([...probe.matrixWorld.elements, ...probe.modelViewMatrix.elements]);
      depth.apply(this, args);
    };
  }
  // The same moves on both: the eye, the FOV and the rig's scale (`setViewFov`), every rig node, one view model shown.
  const move = ({ renderer, nodes, held }: ReturnType<typeof rigged>, f: number) => {
    const camera = renderer.camera;
    camera.position.set(Math.sin(f * 0.37) * 3, 1.6 + Math.sin(f * 0.11) * 0.2, Math.cos(f * 0.29) * 3);
    camera.rotation.set(Math.sin(f * 0.13) * 0.4, f * 0.07, Math.sin(f * 0.5) * 0.01, 'YXZ');
    camera.fov = 70 + (f % 5);
    camera.updateProjectionMatrix();
    renderer.setViewFov(60 + (f % 7));
    nodes.forEach((node, i) => {
      if (node === renderer.rig) return;
      node.position.x += Math.sin(f + i) * 1e-3;
      node.rotation.y = Math.sin(f * 0.7 + i) * 0.1;
    });
    held.forEach((weapon, i) => { weapon.root.visible = i === f % held.length; });
  };
  let f = 0;
  // Both looks (Ultra: the realistic one with its rig-hidden shadow walk and one-render post chain), live changes between.
  for (const preset of ['low', 'ultra', 'low'] as PresetName[]) {
    for (const rig of [a, b]) rig.renderer.applyQuality(PRESET_VALUES[preset]);
    for (let i = 0; i < 6; i++, f++) {
      for (const rig of [a, b]) {
        move(rig, f);
        rig.renderer.render(f / 60, fx);
        const record = records.get(rig.renderer)!, camera = rig.renderer.camera;
        record.eye.push([...camera.matrixWorld.elements, ...camera.matrixWorldInverse.elements, ...camera.projectionMatrix.elements]);
        record.after.push(rig.nodes.flatMap(node => node.matrixWorld.elements));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const ra = records.get(a.renderer)!, rb = records.get(b.renderer)!;
  for (const key of ['frame', 'props', 'drawn', 'after'] as const) {
    expect(ra[key].length, key).toBe(rb[key].length);
    ra[key].forEach((values, i) => { expect(bits(values), `${key} ${i}`).toEqual(bits(rb[key][i]!)); });
  }
  expect(ra.frame.length).toBe(f);
  expect(ra.drawn.length).toBeGreaterThanOrEqual(f);
  expect([calls.get(a.renderer), calls.get(b.renderer)]).toEqual([f, f]);
  // The operators and props saw this frame's camera: the one the scene walk then drew with.
  for (const record of [ra, rb]) {
    record.frame.forEach((values, i) => { expect(bits(values), `frame ${i}`).toEqual(bits(record.eye[i]!)); });
    record.props.forEach((values, i) => { expect(bits(values), `props ${i}`).toEqual(bits(record.eye[i]!)); });
  }
  // Only B walked the rig there: A's rig waits for the scene walk (what the change saves), and nothing read it between.
  // (A look's first frames draw its warm-ups in a render of their own before that line, which walks the rig too.)
  rb.rigAtFrame.forEach((values, i) => { expect(bits(values), `B's rig ${i}`).toEqual(bits(rb.after[i]!)); });
  expect(ra.rigAtFrame.filter((values, i) => bits(values).join() !== bits(ra.after[i]!).join()).length).toBeGreaterThan(f / 2);
  // Each frame's eye and rig moved: none of these compares a matrix that stood still.
  expect(new Set(ra.after.map(values => bits(values).join())).size).toBe(f);
}, 240_000);

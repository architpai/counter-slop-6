import * as THREE from 'three';
import { TONE, toneMat, unlitMat, charMat, bladeMaterial, boxGeo, cylGeo, sphereGeo, torusGeo, starGeo } from '../render/index';
import { cells, flashMaterial, lowFlashMaterial, FX_MANIFEST } from '../render/fx';
import type { GunKind, ScopeKind, Triple } from './stats';
import { tacticalPart } from '../render/tactical';
import { OPTIC_COLOR } from '../render/palette';
import type { WeaponAssets } from '../render/weapons';
import { bladeBlood } from '../render/blade-blood';
import type { BladeBlood } from '../render/blade-blood';

const PRIMARY = TONE.PRIMARY, DARK = TONE.DARK, SIGHT = TONE.HOSTILE;
/** The flat models are built in their own units at this scale; the Blender models are in metres. */
export const LOW_SCALE = 0.46;

/** The rest pose `remember()` stashes on a part the animators move. */
export interface RestPose {
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
}

/** three types `userData` as `any`; this is the one place that shape is named. */
export const restPose = (node: THREE.Object3D): RestPose => node.userData as RestPose;

/** Moving parts, by the name the animators use. Each model builds only its own. */
export interface ModelParts {
  /** Every model has one; the reload and shell poses move it. */
  leftHand: THREE.Object3D;
  mag?: THREE.Object3D;
  cylinder?: THREE.Object3D;
  foreEnd?: THREE.Object3D;
  bolt?: THREE.Object3D;
  slide?: THREE.Object3D;
  acog?: THREE.Object3D;
  holo?: THREE.Object3D;
  /** Blender models: pulled while the trigger is held. */
  trigger?: THREE.Object3D;
}

/** A Blender model's own motion and pose (docs/VISUALS.md, R4). */
export interface RealLook {
  /** Keyframed clips by name (`reload`, `reload-empty`, `equip`, `cycle`, `shell`, `slash`), bound to this model's nodes. */
  clips: ReadonlyMap<string, THREE.AnimationClip>;
  mixer: THREE.AnimationMixer;
  /** Camera-space hip pose: slimmer than the flat guns, the Blender ones sit a little closer (visual only). */
  restPos: Triple;
  restRot: Triple;
  /**
   * Where the eye sits along the gun at full aim, whatever the sight: metres
   * forward of the model's origin (negative: behind it), where a real gun of
   * this length puts it. Null keeps `GunStats.eyeDistance` behind the sight.
   */
  eye: number | null;
}

/** What a `ViewModel` needs from any view model. */
export interface WeaponModel {
  root: THREE.Group;
  parts: ModelParts;
  /** Gun: the barrel end. Sword: the blade tip. */
  muzzle: THREE.Object3D;
  /** The sword's blade blood (render/blade-blood.ts); absent on the guns. */
  blood?: BladeBlood | null;
  /** Scales the procedural part offsets: 1 on the flat models (their own units), `LOW_SCALE` on the Blender models (metres). */
  unit: number;
  /** The Blender model's clips and hip pose; absent on the flat look. */
  real?: RealLook;
}

export interface GunModel extends WeaponModel {
  eject: THREE.Object3D;
  flash: THREE.Group;
  /** The flash's bright core, shown on a shot's first frame only (V5). */
  flashCore: THREE.Object3D;
  /** A Blender gun's flash picks one of the atlas's flashes for each shot (R5); the flat stars have one look. */
  pickFlash: (() => void) | null;
  /** Blender models: the aim point in root space per optic, `iron` for open sights. The flat models aim from `GunStats.sight`. */
  sights?: Partial<Record<ScopeKind | 'iron', THREE.Vector3>>;
}

function group(parent: THREE.Object3D | null, name: string, position: Triple = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  parent?.add(node);
  return node;
}

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry,
  material: THREE.Material, position: Triple = [0, 0, 0], rotation: Triple = [0, 0, 0]) {
  const node = new THREE.Mesh(geometry, material);
  node.name = name;
  node.position.set(...position);
  node.rotation.set(...rotation);
  node.renderOrder = 1000;
  node.castShadow = node.receiveShadow = false;
  parent.add(node);
  return node;
}

const box = (parent: THREE.Object3D, name: string, size: Triple, pos: Triple, tone: number = PRIMARY, rot?: Triple) =>
  mesh(parent, name, boxGeo(...size), toneMat(tone), pos, rot);
const cylinder = (parent: THREE.Object3D, name: string, radius: number, length: number, pos: Triple,
  tone: number = PRIMARY, sides = 8) =>
  mesh(parent, name, cylGeo(radius, length, sides, 'z'), toneMat(tone), pos);
const sphere = (parent: THREE.Object3D, name: string, radius: number, pos: Triple, tone: number = PRIMARY, segments = 8) =>
  mesh(parent, name, sphereGeo(radius, segments), toneMat(tone), pos);

function remember<T extends THREE.Object3D>(node: T): T {
  node.userData.restPos = node.position.clone();
  node.userData.restRot = node.rotation.clone();
  return node;
}

function hand(parent: THREE.Object3D, name: string, pos: Triple, direction: Triple) {
  const node = group(parent, name, pos);
  const side = name.includes('left') ? 'L' : 'R';
  const sleeve = tacticalPart('player', `viewhand${side}`);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...direction).normalize());
  node.add(sleeve);
  return remember(node);
}

function twoSided(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = flat.getAttribute('position'), vertices: number[] = [];
  for (let i = 0; i < p.count; i += 3) {
    for (const n of [i, i + 1, i + 2, i + 2, i + 1, i]) vertices.push(p.getX(n), p.getY(n), p.getZ(n));
  }
  if (flat !== geometry) flat.dispose();
  geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The flat guns' flash (V5): three additive stars, and a small hot core beside them for a shot's first frame. */
function flash(parent: THREE.Object3D): { flash: THREE.Group; flashCore: THREE.Object3D; pickFlash: null } {
  const node = group(parent, 'muzzle-flash');
  const material = lowFlashMaterial();
  mesh(node, 'flash-star-front', twoSided(starGeo(7, 0.16, 0.06)), material);
  mesh(node, 'flash-star-side', twoSided(starGeo(5, 0.11, 0.04)), material, [0, 0, 0], [0, Math.PI / 2, 0]);
  mesh(node, 'flash-star-top', twoSided(starGeo(5, 0.10, 0.04)), material, [0, 0, 0], [Math.PI / 2, 0, 0]);
  node.visible = false;
  node.userData.scale = null;
  const core = mesh(parent, 'muzzle-flash-core', twoSided(starGeo(8, 0.07, 0.045)), material);
  core.visible = false;
  return { flash: node, flashCore: core, pickFlash: null };
}

/** A quad's UVs set to atlas cell `cell` of the fire atlas. */
function toCell(geometry: THREE.BufferGeometry, cell: number): void {
  const { cols, rows } = FX_MANIFEST.fire;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute, base = geometry.userData.uv as Float32Array;
  const u0 = (cell % cols) / cols, v0 = Math.floor(cell / cols) / rows;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + base[2 * i]! / cols, v0 + base[2 * i + 1]! / rows);
  uv.needsUpdate = true;
}

/** A plane `w` x `h` whose UVs can move to any cell of the fire atlas (`toCell`). */
function cellPlane(w: number, h: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(w, h);
  geometry.userData.uv = Float32Array.from(geometry.getAttribute('uv').array);
  return geometry;
}

/**
 * The Blender guns' flash (R5, V5), in metres at the muzzle, the barrel along
 * -z: the fire atlas's flash seen down the barrel on a quad across it, its
 * side view on two crossed quads along it (the plume leaves the cell's left
 * edge, so they sit ahead of the muzzle), and the one-frame glow core. Each
 * shot picks one of the four variants for the front and each side.
 */
function realFlash(muzzle: THREE.Object3D, scale: number): { flash: THREE.Group; flashCore: THREE.Object3D; pickFlash: () => void } {
  const node = group(muzzle, 'muzzle-flash');
  node.userData.scale = scale;
  const material = flashMaterial();
  const front = mesh(node, 'flash-front', cellPlane(0.22, 0.22), material);
  const sides = [0, Math.PI / 2].map(roll => {
    const geometry = cellPlane(0.26, 0.26);
    geometry.rotateY(Math.PI / 2);
    geometry.translate(0, 0, -0.26 * 0.45);
    geometry.rotateZ(roll);
    return mesh(node, `flash-side-${roll ? 'b' : 'a'}`, geometry, material);
  });
  node.visible = false;
  const core = mesh(muzzle, 'muzzle-flash-core', cellPlane(0.09, 0.09), material);
  toCell(core.geometry, cells('fire', 'glow')[0]);
  core.visible = false;
  const [frontFirst, frontCount] = cells('fire', 'flashFront'), [sideFirst, sideCount] = cells('fire', 'flashSide');
  const pickFlash = () => {
    toCell(front.geometry, frontFirst + Math.floor(Math.random() * frontCount));
    for (const side of sides) toCell(side.geometry, sideFirst + Math.floor(Math.random() * sideCount));
  };
  pickFlash();
  return { flash: node, flashCore: core, pickFlash };
}

/** A model under construction: the required parts are not all built yet. */
interface Draft {
  root: THREE.Group;
  parts: Partial<ModelParts>;
}

function model(name: string): Draft {
  const root = group(null, `${name}-viewmodel`);
  root.scale.setScalar(0.46);
  root.visible = false;
  return { root, parts: {} };
}

export function makeGunModel(kind: GunKind): GunModel {
  if (!['r4c', 'rifle', 'pistol', 'shotgun', 'sniper', 'lmg', 'revolver'].includes(kind)) throw new RangeError(`Unknown gun kind: ${kind}`);
  const result = model(kind), { root, parts } = result;
  let muzzlePos: Triple, ejectPos: Triple, leftHand: THREE.Object3D;
  if (kind === 'rifle' || kind === 'r4c') {
    if (kind === 'r4c') {
      box(root, 'receiver', [0.115, 0.15, 0.50], [0, 0, 0], DARK);
      box(root, 'upper-receiver', [0.105, 0.055, 0.52], [0, 0.075, -0.01], PRIMARY);
      box(root, 'magwell', [0.09, 0.08, 0.16], [0, -0.075, -0.11], DARK);
      parts.mag = remember(group(root, 'magazine', [0, -0.12, -0.11]));
      box(parts.mag, 'magazine-body', [0.07, 0.23, 0.14], [0, -0.085, 0], DARK, [0.12, 0, 0]);
      box(parts.mag, 'magazine-base', [0.078, 0.025, 0.15], [0, -0.20, -0.015], PRIMARY, [0.12, 0, 0]);
      const handguard = group(root, 'railed-handguard', [0, 0.02, -0.55]);
      box(handguard, 'handguard-core', [0.095, 0.11, 0.52], [0, 0, 0], DARK);
      for (let i = 0; i < 8; i++) {
        box(handguard, `top-rail-${i}`, [0.105, 0.025, 0.035], [0, 0.068, -0.23 + i * 0.065], PRIMARY);
        for (const side of [-1, 1]) box(handguard, `vent-${side}-${i}`, [0.008, 0.025, 0.035], [side * 0.05, 0, -0.23 + i * 0.065], PRIMARY);
      }
      cylinder(root, 'barrel', 0.022, 0.32, [0, 0.02, -0.96], DARK);
      cylinder(root, 'flash-hider', 0.033, 0.09, [0, 0.02, -1.115], PRIMARY);
      cylinder(root, 'buffer-tube', 0.032, 0.27, [0, 0.035, 0.36], DARK);
      box(root, 'stock', [0.095, 0.13, 0.27], [0, -0.015, 0.43], DARK, [0.08, 0, 0]);
      box(root, 'stock-pad', [0.105, 0.20, 0.035], [0, -0.025, 0.56], PRIMARY);
      box(root, 'grip', [0.06, 0.17, 0.08], [0, -0.15, 0.13], DARK, [0.3, 0, 0]);
      box(root, 'trigger-guard', [0.045, 0.025, 0.11], [0, -0.115, 0.035], PRIMARY);
      box(root, 'charging-handle', [0.15, 0.025, 0.04], [0, 0.075, 0.25], DARK);
      box(root, 'ejection-port', [0.008, 0.035, 0.12], [0.061, 0.03, 0.015], PRIMARY);
    } else {
      box(root, 'receiver', [0.10, 0.13, 0.48], [0, 0, 0], DARK);
      box(root, 'receiver-trim', [0.106, 0.035, 0.42], [0, 0.066, 0.01], PRIMARY);
      parts.mag = remember(group(root, 'magazine', [0, -0.06, -0.04]));
      box(parts.mag, 'magazine-upper', [0.062, 0.13, 0.09], [0, -0.055, 0], DARK, [0.12, 0, 0]);
      box(parts.mag, 'magazine-middle', [0.062, 0.105, 0.09], [0, -0.16, -0.024], DARK, [0.30, 0, 0]);
      box(parts.mag, 'magazine-lower', [0.062, 0.10, 0.09], [0, -0.245, -0.06], DARK, [0.46, 0, 0]);
      box(root, 'magazine-lip', [0.065, 0.025, 0.12], [0, -0.055, -0.04], PRIMARY, [0.18, 0, 0]);
      const handguard = group(root, 'ribbed-handguard', [0, 0, -0.39]);
      box(handguard, 'handguard-core', [0.082, 0.09, 0.32], [0, 0, 0], DARK);
      for (let i = 0; i < 5; i++) box(handguard, `handguard-rib-${i}`, [0.088, 0.012, 0.035], [0, 0.05, -0.13 + i * 0.065], PRIMARY);
      cylinder(root, 'barrel', 0.018, 0.38, [0, 0.015, -0.75], DARK);
      mesh(root, 'front-sight-hood', torusGeo(0.034, 0.007, 5, 12), toneMat(DARK), [0, 0.083, -0.88]);
      box(root, 'front-sight-post', [0.008, 0.036, 0.015], [0, 0.066, -0.88], DARK);
      for (const side of [-1, 1]) cylinder(root, `stock-rail-${side}`, 0.009, 0.30, [side * 0.052, 0.018, 0.36], DARK);
      box(root, 'stock-end', [0.085, 0.17, 0.035], [0, -0.025, 0.51], DARK);
      box(root, 'grip', [0.052, 0.15, 0.065], [0, -0.14, 0.13], DARK, [0.3, 0, 0]);
      box(root, 'charging-handle', [0.018, 0.025, 0.11], [-0.06, 0.075, -0.08], PRIMARY, [0, 0.2, 0]);
    }
    const acogBody = charMat(new THREE.Color(OPTIC_COLOR.acogBody).getHex());
    const acogRim = charMat(new THREE.Color(OPTIC_COLOR.acogRim).getHex());
    const holoBody = charMat(new THREE.Color(OPTIC_COLOR.holoBody).getHex());
    const holoBase = charMat(new THREE.Color(OPTIC_COLOR.holoBase).getHex());
    const acog = parts.acog = group(root, 'acog');
    mesh(acog, 'acog-tube', cylGeo(0.045, 0.34, 8, 'z'), acogBody, [0, 0.145, -0.10]);
    mesh(acog, 'acog-objective', cylGeo(0.062, 0.055, 8, 'z'), acogRim, [0, 0.145, -0.29]);
    mesh(acog, 'acog-ocular', cylGeo(0.066, 0.065, 16, 'z'), acogBody, [0, 0.145, 0.09]);
    mesh(acog, 'acog-ocular-rim', torusGeo(0.057, 0.009, 6, 24), acogRim, [0, 0.145, 0.125]);
    mesh(acog, 'acog-prism-body', boxGeo(0.11, 0.07, 0.19), acogBody, [0, 0.125, -0.04]);
    mesh(acog, 'acog-elevation-turret', cylGeo(0.035, 0.035, 12, 'y'), acogBody, [0, 0.204, -0.045]);
    mesh(acog, 'acog-windage-turret', cylGeo(0.03, 0.035, 12, 'y'), acogBody, [0.063, 0.15, -0.045], [0, 0, Math.PI / 2]);
    mesh(acog, 'acog-mount-front', boxGeo(0.035, 0.085, 0.035), acogBody, [0, 0.087, -0.20]);
    mesh(acog, 'acog-mount-rear', boxGeo(0.035, 0.085, 0.035), acogBody, [0, 0.087, 0.04]);
    const holo = parts.holo = group(root, 'holo');
    holo.visible = false;
    mesh(holo, 'holo-base', boxGeo(0.15, 0.035, 0.22), holoBase, [0, 0.088, -0.10]);
    mesh(holo, 'holo-battery', boxGeo(0.12, 0.055, 0.10), holoBase, [0, 0.12, -0.22]);
    for (const side of [-1, 1]) mesh(holo, `holo-frame-${side}`, boxGeo(0.02, 0.12, 0.06), holoBody, [side * 0.065, 0.16, -0.08]);
    mesh(holo, 'holo-frame-top', boxGeo(0.15, 0.02, 0.06), holoBody, [0, 0.22, -0.08]);
    mesh(holo, 'holo-dot', sphereGeo(0.003, 6), unlitMat(new THREE.Color(OPTIC_COLOR.reticle).getHex()), [0, 0.145, -0.08]);
    hand(root, 'right-hand', [0.02, -0.15, 0.14], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.08, kind === 'r4c' ? -0.50 : -0.38], [-0.35, -0.9, 0.9]);
    muzzlePos = kind === 'r4c' ? [0, 0.02, -1.16] : [0, 0.015, -0.96]; ejectPos = [0.06, 0.02, 0.02];
  } else if (kind === 'lmg') {
    box(root, 'receiver', [0.12, 0.17, 0.52], [0, 0, 0], DARK);
    box(root, 'feed-cover', [0.125, 0.04, 0.46], [0, 0.10, 0.01], PRIMARY);
    box(root, 'rear-sight', [0.04, 0.045, 0.03], [0, 0.135, 0.17], DARK);
    // The 100-round box hangs under the feed tray, with its belt up the left side.
    parts.mag = remember(group(root, 'magazine', [-0.02, -0.085, -0.15]));
    box(parts.mag, 'ammo-box', [0.19, 0.27, 0.22], [0, -0.135, 0], DARK);
    box(parts.mag, 'ammo-box-base', [0.20, 0.03, 0.23], [0, -0.275, 0], PRIMARY);
    box(parts.mag, 'belt', [0.03, 0.16, 0.10], [-0.065, 0.07, 0.01], DARK, [0, 0, -0.35]);
    box(root, 'handguard', [0.105, 0.15, 0.42], [0, -0.01, -0.48], DARK);
    for (let i = 0; i < 5; i++) box(root, `heat-vent-${i}`, [0.11, 0.02, 0.035], [0, 0.07, -0.64 + i * 0.075], PRIMARY);
    cylinder(root, 'barrel', 0.026, 0.56, [0, 0.03, -0.97], DARK);
    cylinder(root, 'flash-hider', 0.034, 0.09, [0, 0.03, -1.27], PRIMARY);
    box(root, 'gas-block', [0.06, 0.10, 0.07], [0, 0.02, -0.95], DARK);
    box(root, 'front-sight', [0.012, 0.11, 0.02], [0, 0.10, -0.95], DARK);
    for (const side of [-1, 1]) box(root, `bipod-${side}`, [0.018, 0.018, 0.34], [side * 0.03, -0.06, -1.10], DARK);
    box(root, 'carry-handle', [0.03, 0.03, 0.20], [-0.07, 0.10, -0.38], DARK);
    box(root, 'stock', [0.085, 0.16, 0.36], [0, -0.01, 0.44], DARK, [0.05, 0, 0]);
    box(root, 'stock-pad', [0.095, 0.24, 0.035], [0, -0.03, 0.63], PRIMARY);
    box(root, 'grip', [0.06, 0.18, 0.08], [0, -0.17, 0.16], DARK, [0.3, 0, 0]);
    box(root, 'trigger-guard', [0.045, 0.025, 0.12], [0, -0.115, 0.07], PRIMARY);
    box(root, 'charging-handle', [0.035, 0.03, 0.05], [-0.075, 0.02, 0.02], PRIMARY);
    hand(root, 'right-hand', [0.02, -0.17, 0.17], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.10, -0.46], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.03, -1.32]; ejectPos = [0.065, -0.02, -0.06];
  } else if (kind === 'pistol') {
    // The .50: a tall slab slide over a full-length barrel, a top rib, a squared muzzle face, a wide grip.
    box(root, 'frame', [0.08, 0.10, 0.30], [0, 0, -0.02], DARK);
    parts.slide = remember(box(root, 'slide', [0.09, 0.10, 0.50], [0, 0.09, -0.15], PRIMARY));
    box(root, 'top-rib', [0.04, 0.022, 0.44], [0, 0.15, -0.16], DARK);
    box(root, 'muzzle-face', [0.096, 0.106, 0.03], [0, 0.09, -0.41], DARK);
    box(root, 'bore', [0.034, 0.034, 0.012], [0, 0.10, -0.428], SIGHT);
    for (let i = 0; i < 4; i++) box(root, `slide-serration-${i}`, [0.096, 0.07, 0.012], [0, 0.085, 0.0 + i * 0.022], DARK);
    box(root, 'front-sight', [0.014, 0.03, 0.022], [0, 0.175, -0.37], SIGHT);
    box(root, 'rear-sight-left', [0.016, 0.03, 0.02], [-0.026, 0.175, 0.07], DARK);
    box(root, 'rear-sight-right', [0.016, 0.03, 0.02], [0.026, 0.175, 0.07], DARK);
    box(root, 'hammer', [0.03, 0.05, 0.03], [0, 0.12, 0.115], DARK, [-0.4, 0, 0]);
    box(root, 'grip', [0.076, 0.25, 0.11], [0, -0.15, 0.06], DARK, [0.18, 0, 0]);
    parts.mag = remember(group(root, 'magazine', [0, -0.13, 0.06]));
    box(parts.mag, 'magazine-body', [0.056, 0.21, 0.08], [0, 0, 0], DARK, [0.18, 0, 0]);
    box(parts.mag, 'magazine-base', [0.07, 0.03, 0.10], [0, -0.135, 0.025], PRIMARY, [0.18, 0, 0]);
    box(root, 'trigger-guard', [0.062, 0.035, 0.15], [0, -0.075, -0.07], DARK, [0.12, 0, 0]);
    box(root, 'trigger-guard-front', [0.062, 0.075, 0.025], [0, -0.06, -0.14], DARK);
    box(root, 'trigger', [0.014, 0.05, 0.02], [0, -0.06, -0.04], PRIMARY, [0.2, 0, 0]);
    root.updateMatrixWorld(true);
    for (const name of ['top-rib', 'muzzle-face', 'bore', 'front-sight', 'rear-sight-left', 'rear-sight-right',
      ...[0, 1, 2, 3].map(i => `slide-serration-${i}`)]) {
      const part = root.getObjectByName(name);
      if (part) parts.slide.attach(part);
    }
    hand(root, 'right-hand', [0.02, -0.15, 0.10], [0.4, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.18, 0.06], [-0.35, -0.8, 1]);
    muzzlePos = [0, 0.10, -0.44]; ejectPos = [0.05, 0.14, -0.05];
  } else if (kind === 'shotgun') {
    box(root, 'receiver', [0.09, 0.13, 0.42], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.021, 0.92, [0, 0.05, -0.62], DARK);
    cylinder(root, 'tube-magazine', 0.019, 0.72, [0, -0.02, -0.50], DARK);
    parts.foreEnd = remember(box(root, 'fore-end', [0.078, 0.085, 0.27], [0, 0.01, -0.46], DARK));
    box(root, 'stock', [0.07, 0.12, 0.34], [0, -0.04, 0.42], DARK, [0.08, 0, 0]);
    box(root, 'grip', [0.05, 0.13, 0.06], [0, -0.13, 0.16], DARK, [0.35, 0, 0]);
    sphere(root, 'front-bead', 0.013, [0, 0.095, -1.00], SIGHT, 6);
    box(root, 'rear-sight', [0.03, 0.025, 0.02], [0, 0.085, -0.02], DARK);
    hand(root, 'right-hand', [0.02, -0.16, 0.17], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.04, -0.06, -0.45], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.05, -1.09]; ejectPos = [0.06, 0.03, 0.05];
  } else if (kind === 'sniper') {
    box(root, 'receiver', [0.085, 0.115, 0.60], [0, 0, 0.05]);
    cylinder(root, 'barrel', 0.024, 1.25, [0, 0.02, -0.92], DARK);
    cylinder(root, 'muzzle-brake', 0.032, 0.16, [0, 0.02, -1.50], DARK);
    parts.mag = remember(box(root, 'magazine', [0.055, 0.16, 0.14], [0, -0.14, -0.06], DARK));
    box(root, 'stock', [0.075, 0.13, 0.44], [0, -0.02, 0.50], DARK, [0.04, 0, 0]);
    box(root, 'grip', [0.05, 0.14, 0.07], [0, -0.13, 0.20], DARK, [0.3, 0, 0]);
    box(root, 'cheek-riser', [0.06, 0.05, 0.16], [0, 0.07, 0.42], DARK);
    cylinder(root, 'scope-tube', 0.052, 0.56, [0, 0.135, -0.10], DARK);
    cylinder(root, 'objective-bell', 0.066, 0.07, [0, 0.135, -0.36], DARK);
    cylinder(root, 'ocular-bell', 0.062, 0.07, [0, 0.135, 0.14], DARK);
    box(root, 'scope-mount-front', [0.03, 0.09, 0.035], [0, 0.085, -0.24], DARK);
    box(root, 'scope-mount-rear', [0.03, 0.09, 0.035], [0, 0.085, 0.02], DARK);
    const reticle = group(root, 'scope-crosshair', [0, 0.135, -0.38]);
    box(reticle, 'scope-crosshair-horizontal', [0.09, 0.006, 0.004], [0, 0, 0], SIGHT);
    box(reticle, 'scope-crosshair-vertical', [0.006, 0.09, 0.004], [0, 0, 0], SIGHT);
    parts.bolt = remember(box(root, 'bolt-handle', [0.026, 0.026, 0.16], [0.07, 0.05, 0.16], DARK));
    sphere(parts.bolt, 'bolt-knob', 0.032, [0, 0, 0.08], DARK, 6);
    box(root, 'bipod-left', [0.02, 0.26, 0.02], [-0.07, -0.13, -0.78], DARK, [0, 0, 0.35]);
    box(root, 'bipod-right', [0.02, 0.26, 0.02], [0.07, -0.13, -0.78], DARK, [0, 0, -0.35]);
    hand(root, 'right-hand', [0.02, -0.16, 0.24], [0.5, -0.6, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.09, -0.50], [-0.35, -0.9, 0.9]);
    muzzlePos = [0, 0.02, -1.60]; ejectPos = [0.06, 0.04, 0.06];
  } else {
    box(root, 'frame', [0.045, 0.09, 0.20], [0, 0, 0]);
    cylinder(root, 'barrel', 0.02, 0.30, [0, 0.035, -0.24], DARK);
    box(root, 'barrel-rib', [0.03, 0.03, 0.26], [0, 0.005, -0.22]);
    parts.cylinder = remember(group(root, 'cylinder', [0, 0, -0.02]));
    cylinder(parts.cylinder, 'cylinder-drum', 0.05, 0.11, [0, 0, 0], PRIMARY, 6);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      cylinder(parts.cylinder, `cylinder-chamber-${i}`, 0.012, 0.115, [Math.cos(a) * 0.032, Math.sin(a) * 0.032, 0], DARK, 5);
    }
    box(root, 'grip', [0.045, 0.14, 0.055], [0, -0.10, 0.07], DARK, [0.4, 0, 0]);
    box(root, 'hammer', [0.02, 0.045, 0.035], [0, 0.05, 0.10], PRIMARY, [-0.4, 0, 0]);
    box(root, 'front-sight', [0.01, 0.03, 0.02], [0, 0.075, -0.34], SIGHT);
    box(root, 'rear-sight-left', [0.012, 0.025, 0.015], [-0.014, 0.06, 0.08]);
    box(root, 'rear-sight-right', [0.012, 0.025, 0.015], [0.014, 0.06, 0.08]);
    hand(root, 'right-hand', [0, -0.13, 0.08], [0.45, -0.55, 1]);
    leftHand = hand(root, 'left-hand', [-0.05, -0.17, 0.02], [-0.4, -0.7, 1]);
    muzzlePos = [0, 0.035, -0.40]; ejectPos = [-0.05, 0.02, 0];
  }
  const muzzle = group(root, 'muzzle', muzzlePos);
  const eject = group(root, 'eject', ejectPos);
  return { root, parts: { ...parts, leftHand }, muzzle, eject, ...flash(muzzle), unit: 1 };
}

/** The flat sword's blade length past the guard, in the flat models' units (0.67 m at `LOW_SCALE`). */
const SWORD_BLADE = 1.45;

/**
 * The flat sword (low tier): a long single-edged blade with a dark spine,
 * a square guard and a wrapped two-hand grip, held in both fists. The blade
 * runs along -z from the guard at the origin, as the knife's did.
 */
export function makeSwordModel(): WeaponModel {
  const { root } = model('sword');
  // Its own steel, not the shared cache's: the blade's blood is drawn in it (blade-blood.ts).
  const steel = bladeMaterial(0xcbdbe3);
  mesh(root, 'blade', boxGeo(0.014, 0.05, SWORD_BLADE), steel, [0, 0, -0.04 - SWORD_BLADE / 2]);
  box(root, 'spine', [0.017, 0.012, SWORD_BLADE - 0.06], [0, 0.022, -0.07 - SWORD_BLADE / 2], DARK);
  mesh(root, 'blade-tip', boxGeo(0.014, 0.034, 0.12), steel, [0, 0.008, -0.07 - SWORD_BLADE], [0.32, 0, 0]);
  box(root, 'guard', [0.13, 0.11, 0.028], [0, 0, -0.03], DARK);
  box(root, 'collar', [0.05, 0.06, 0.05], [0, 0, 0.0], PRIMARY);
  box(root, 'grip', [0.042, 0.05, 0.52], [0, 0, 0.27], DARK);
  for (let i = 0; i < 7; i++) box(root, `grip-wrap-${i}`, [0.048, 0.056, 0.022], [0, 0, 0.07 + i * 0.07], PRIMARY, [0, 0, i % 2 ? 0.4 : -0.4]);
  box(root, 'pommel', [0.056, 0.064, 0.04], [0, 0, 0.55], DARK);
  hand(root, 'striking-right-hand', [0, -0.005, 0.06], [0.5, -0.5, 1]);
  const leftHand = hand(root, 'supporting-left-hand', [0, -0.01, 0.42], [-0.3, -0.6, 1]);
  const muzzle = group(root, 'tip', [0, 0.008, -0.12 - SWORD_BLADE]);
  const blood = bladeBlood(steel, root, -0.04, -0.13 - SWORD_BLADE, 0, 0.025, false);
  return { root, parts: { leftHand }, muzzle, blood, unit: 1 };
}

// ---------------------------------------------------------------- Blender models (R4)

/** The Blender model of each gun kind; the revolver is not issued and keeps its flat model on every tier. */
export const REAL_GUN: Readonly<Partial<Record<GunKind, string>>> = { r4c: 'r4c', rifle: 'mp5', shotgun: 'shotgun', sniper: 'sniper', pistol: 'pistol', lmg: 'lmg' };

/**
 * Camera-space hip pose of each Blender model, `[position, rotation]`, and
 * where its eye sits along it at full aim (`RealLook.eye`). They have real
 * proportions, a third as thick as the flat guns, so they sit a little closer
 * and turn a touch towards the centre to fill the corner the way the flat
 * ones do. The flat guns aim from a fixed distance behind the sight (the
 * shotgun's bead 0.52 m out, the pistol's post 0.30 m, the scoped guns' optic
 * 0.34-0.42 m); with real lengths that put the shotgun's receiver behind the
 * eye, the pistol's hands over the screen, and the scoped guns' butt pads
 * 10-30 cm in front of the eye, a black block square to it on every aim-in.
 * So each eye sits where a shooter's does: a cheek weld on the long guns
 * (the shotgun's front sight 0.72 m out; much further and the eye looks down
 * the stock's comb), the stock behind and under the eye, the optic's
 * eyepiece 7-9 cm ahead; the pistol held out in both hands, its post about
 * 0.55 m out, where the hands leave the slide and frame in view. Visual
 * only: aim direction, spread and recoil are unchanged.
 */
const REAL_REST: Readonly<Record<string, readonly [Triple, Triple, number | null]>> = {
  r4c: [[0.15, -0.13, -0.29], [-0.06, 0.04, 0], -0.13],
  mp5: [[0.15, -0.13, -0.31], [-0.06, 0.04, 0], -0.15],
  shotgun: [[0.14, -0.12, -0.25], [-0.06, 0.04, 0], -0.17],
  sniper: [[0.15, -0.13, -0.26], [-0.06, 0.04, 0], -0.23],
  // The .50's front post 0.55 m out, its flank turned a touch further into view.
  pistol: [[0.13, -0.115, -0.35], [-0.03, 0.12, 0.05], -0.382],
  // A cheek weld on the fixed stock: the front post 0.57 m out, the rear notch 14 cm ahead of the eye.
  lmg: [[0.15, -0.13, -0.27], [-0.06, 0.04, 0], -0.20],
  sword: [[0.24, -0.15, -0.38], [0.70, 0.05, -0.95], null],
};

/**
 * How much further out a Blender model is drawn at full aim (in step with the
 * aim), scaled about the eye: it looks exactly the same, but no part the eye
 * sees is nearer than the camera's near plane (0.08 m). At a cheek weld the
 * shotgun's stock runs 6-9 cm under the eye; the plane cut it open, showing
 * a black block (the receiver's hidden back face, through the cut stock)
 * under a flat shelf (the cut's edge) below the sights. Visual only: the
 * muzzle and ejection effects leave from where the unscaled gun would put
 * them (`ViewModel._socket`).
 */
export const REAL_AIM_DEPTH = 1.5;

/**
 * Each Blender gun's flash size (R5): a suppressor-less rifle's is about a
 * hand across, the MP5's and the pistol's smaller, the shotgun's and the
 * sniper's big. The flat guns scale theirs by `GunStats.flashScale`.
 */
const REAL_FLASH: Readonly<Partial<Record<GunKind, number>>> = { r4c: 1.1, rifle: 0.85, pistol: 1.3, shotgun: 1.6, sniper: 1.45, lmg: 1.2 };

/** Moving parts of the Blender models, by the flat models' names for them. */
const REAL_PARTS = [['mag', 'magazine'], ['bolt', 'bolt'], ['slide', 'slide'], ['foreEnd', 'fore-end'], ['trigger', 'trigger']] as const;

/** A Blender model's instance under a `<name>-viewmodel` root, hidden until equipped, with its mixer and hip pose. */
function realRoot(assets: WeaponAssets, model: string, name: string): { root: THREE.Group; node: THREE.Object3D; real: RealLook } | null {
  const node = assets.instance(model);
  if (!node) return null;
  const root = group(null, `${name}-viewmodel`);
  root.add(node);
  root.visible = false;
  const [restPos, restRot, eye] = REAL_REST[model] ?? [[0.2, -0.17, -0.36], [0, 0, 0], null];
  return { root, node, real: { clips: assets.clips(model), mixer: new THREE.AnimationMixer(node), restPos: [...restPos], restRot: [...restRot], eye } };
}

function socket(node: THREE.Object3D, name: string, model: string): THREE.Object3D {
  const found = node.getObjectByName(name);
  if (!found) throw new Error(`weapons.glb: ${model} has no ${name}`);
  return found;
}

/**
 * The realistic tiers' model of a gun (R4): the Blender gun and gloved hands
 * from `weapons.glb`, its optics hung on its `optic-mount`, the muzzle and
 * ejection sockets where the model's barrel and port are, and the aim points
 * of its sights. Null for a kind without one, or until the assets are in.
 */
export function makeRealGunModel(kind: GunKind, assets: WeaponAssets): GunModel | null {
  const model = REAL_GUN[kind];
  const made = model ? realRoot(assets, model, kind) : null;
  if (!model || !made) return null;
  const { root, node, real } = made;
  const parts: Partial<ModelParts> = {};
  for (const [key, name] of REAL_PARTS) {
    const part = node.getObjectByName(name);
    if (part) parts[key] = remember(part);
  }
  const leftHand = remember(socket(node, 'left-hand', model));
  const muzzle = socket(node, 'muzzle', model), eject = socket(node, 'eject', model);
  const mount = node.getObjectByName('optic-mount');
  const sights: NonNullable<GunModel['sights']> = {};
  for (const optic of mount ? (['acog', 'holo'] as const) : []) {
    const scope = assets.instance(optic);
    if (!scope) continue;
    // The glb keeps the optics apart for their bake; on the gun each sits on the mount.
    scope.position.set(0, 0, 0);
    mount?.add(scope);
    parts[optic] = scope;
  }
  if (parts.holo) parts.holo.visible = false;
  root.updateMatrixWorld(true);
  const aim = (point: THREE.Object3D | undefined) => point?.getWorldPosition(new THREE.Vector3());
  sights.acog = aim(parts.acog?.getObjectByName('sight'));
  sights.holo = aim(parts.holo?.getObjectByName('sight'));
  sights[kind === 'sniper' ? 'sniper' : 'iron'] = aim(node.getObjectByName('sight'));
  return { root, parts: { ...parts, leftHand }, muzzle, eject, ...realFlash(muzzle, REAL_FLASH[kind] ?? 1), unit: LOW_SCALE, sights, real };
}

/** The realistic tiers' sword (R4): the Blender blade and gloved hands, its blade's blood drawn in the set's material. */
export function makeRealSwordModel(assets: WeaponAssets): WeaponModel | null {
  const made = realRoot(assets, 'sword', 'sword');
  if (!made) return null;
  const { root, node, real } = made;
  const leftHand = remember(socket(node, 'left-hand', 'sword'));
  const muzzle = socket(node, 'tip', 'sword');
  // The glb joins the blade with the guard and grip (`body`, in the set's material): the blood is masked to the
  // blade by its place along it, from the `smears` socket at its root (the frame) to the `tip`, which also gives
  // how far the curved blade rises.
  const frame = socket(node, 'smears', 'sword'), body = node.getObjectByName('body');
  const material = body instanceof THREE.Mesh ? body.material as THREE.Material : null;
  root.updateWorldMatrix(true, true);
  const point = frame.worldToLocal(muzzle.getWorldPosition(new THREE.Vector3()));
  const blood = material ? bladeBlood(material, frame, 0, point.z, 0, 0.018, true, point.y) : null;
  return { root, parts: { leftHand }, muzzle, blood, unit: LOW_SCALE, real };
}

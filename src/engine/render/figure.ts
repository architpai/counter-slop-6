import * as THREE from 'three';
import { rand } from '../util';
import { TONE, TONE_HEX, WHITE_HEX } from './palette';
import { charMat, unlitMat, makeLabelMaterial } from './materials';
import { boxGeo, cylGeo, sphereGeo, coneGeo, torusGeo } from './prims';

const DARK = TONE_HEX[TONE.DARK], ACCENT = TONE_HEX[TONE.ACCENT];

export type FigureKind = 'humanoid' | 'blob' | 'flyer';
export type BlobKind = 'bomber' | 'hitbox' | 'lagspike';
export type HatKind = 'none' | 'cap' | 'band' | 'helmet' | 'hood' | 'crown';
export type WeaponPropKind = 'none' | 'rifle' | 'pistol' | 'shotgun' | 'sniper' | 'blade' | 'knife' | 'hammer';
export type ClownMask = 'grunt' | 'rusher' | 'heavy' | 'sniper' | 'shield' | 'bomber' | 'flyer' | 'boss' | 'hitbox' | 'lagspike';

export interface FigureOpts {
  kind: FigureKind;
  /** Blob accessory set; default bomber. */
  blob?: BlobKind;
  /** Tone hex. Defaults to HOSTILE. */
  color?: number;
  /** Type scale, default 1. */
  scale?: number;
  bodyWidth?: number;
  headSize?: number;
  limbR?: number;
  hat?: HatKind;
  smile?: boolean;
  shield?: boolean;
  weapon?: WeaponPropKind;
  /** Enemy-only; remote players keep their unmasked faces. */
  mask?: ClownMask;
}

/**
 * The named joints and props every owner reaches into. Which ones exist depends
 * on the kind, so all are optional:
 *
 * - every kind: `hips`, `torso`, `head`, `face`, `eyes`, `deadEyes`, `tip`
 * - humanoid and blob: the arm, forearm, thigh and shin joints
 * - humanoid only: `hat`, `gunMount`, `weapon`, and `shield` when asked for
 * - flyer: `wingL`, `wingR`, `tail`; `hips` and `head` alias `torso`
 * - blob: `cap`, `fuse`, `spark` (bomber), `lid` (hitbox), `spikes` (lagspike)
 */
export interface FigureParts {
  hips?: THREE.Object3D;
  torso?: THREE.Object3D;
  head?: THREE.Object3D;
  face?: THREE.Object3D;
  eyes?: THREE.Object3D;
  deadEyes?: THREE.Object3D;
  hat?: THREE.Object3D;
  shoulderL?: THREE.Object3D;
  shoulderR?: THREE.Object3D;
  upperL?: THREE.Object3D;
  upperR?: THREE.Object3D;
  foreL?: THREE.Object3D;
  foreR?: THREE.Object3D;
  thighL?: THREE.Object3D;
  thighR?: THREE.Object3D;
  shinL?: THREE.Object3D;
  shinR?: THREE.Object3D;
  /** Right forearm mount at (0, -0.29, 0.07). */
  gunMount?: THREE.Object3D;
  weapon?: THREE.Object3D;
  /** Muzzle / nose point, read for projectile and tracer origins. */
  tip?: THREE.Object3D;
  shield?: THREE.Object3D;
  wingL?: THREE.Object3D;
  wingR?: THREE.Object3D;
  tail?: THREE.Object3D;
  cap?: THREE.Object3D;
  fuse?: THREE.Object3D;
  spark?: THREE.Object3D;
  lid?: THREE.Object3D;
  spikes?: THREE.Object3D;
}
export type FigurePartName = keyof FigureParts;

/**
 * Hit-sphere centres, world-updated by the owner. `torso` and `head` always
 * exist (blob and flyer alias `head` to `torso`); the rest follow the limbs the
 * kind has, and `shield` only while the plate is attached.
 */
export interface FigureAnchors {
  head?: THREE.Object3D;
  torso?: THREE.Object3D;
  hips?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  foreL?: THREE.Object3D;
  foreR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  shinL?: THREE.Object3D;
  shinR?: THREE.Object3D;
  shield?: THREE.Object3D;
}
export type FigureAnchorName = keyof FigureAnchors;

export interface Figure {
  root: THREE.Group;
  parts: FigureParts;
  anchors: FigureAnchors;
  /** Normal eyes / X eyes. */
  setEyes(dead: boolean): void;
  setWeapon(kind: WeaponPropKind): void;
  /** Detach for debris, remove its anchor. */
  dropShield(): THREE.Object3D | null;
  dispose(): void;
}

interface FaceSets {
  root: THREE.Group;
  eyes: THREE.Group;
  dead: THREE.Group;
}

/** Duck-typed like the rest of three, so a mesh from any build still matches. */
function isMesh(node: THREE.Object3D): node is THREE.Mesh {
  return 'isMesh' in node && node.isMesh === true;
}

function group(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0): THREE.Group {
  const object = new THREE.Group();
  object.name = name;
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number,
  x = 0, y = 0, z = 0, unlit = false): THREE.Mesh {
  const object = new THREE.Mesh(geo, unlit ? unlitMat(color) : charMat(color));
  object.position.set(x, y, z);
  object.castShadow = !unlit;
  parent.add(object);
  return object;
}

function oval(parent: THREE.Object3D, color: number, x: number, y: number, z: number,
  rx: number, ry: number, rz: number): THREE.Mesh {
  const object = mesh(parent, sphereGeo(1), color, x, y, z);
  object.scale.set(rx, ry, rz);
  return object;
}

function release(root: THREE.Object3D): void {
  root.traverse(object => { if (isMesh(object)) object.geometry.dispose(); });
  root.removeFromParent();
}

function face(parent: THREE.Object3D, radius: number, smile?: boolean, mask?: ClownMask): FaceSets {
  if (mask) return clownFace(parent, radius, mask);
  const root = group(parent, 'face');
  const eyes = group(root, 'eyes'), dead = group(root, 'deadEyes');
  for (const sign of [-1, 1]) {
    const x = sign * radius * 0.37;
    oval(eyes, DARK, x, radius * 0.12, radius * 0.91, radius * 0.075, radius * 0.15, radius * 0.08);
    for (const turn of [-1, 1]) {
      const mark = mesh(dead, boxGeo(radius * 0.23, radius * 0.055, radius * 0.055), DARK,
        x, radius * 0.12, radius * 0.95);
      mark.rotation.z = turn * Math.PI / 4;
    }
  }
  if (smile) {
    const mouth = mesh(root, new THREE.TorusGeometry(radius * 0.34, radius * 0.038, 4, 8, Math.PI),
      DARK, 0, -radius * 0.08, radius * 0.93);
    mouth.rotation.z = Math.PI;
  } else {
    mesh(root, boxGeo(radius * 0.3, radius * 0.045, radius * 0.045), DARK, 0, -radius * 0.29, radius * 0.92);
  }
  dead.visible = false;
  return { root, eyes, dead };
}

function clownFace(parent: THREE.Object3D, r: number, kind: ClownMask): FaceSets {
  const root = group(parent, `clown-mask-${kind}`);
  const eyes = group(root, 'eyes'), dead = group(root, 'deadEyes');
  const ivory = 0xeee4d1, ink = 0x151b23, red = 0xb92e3c;
  const paint = { grunt: red, rusher: 0x242b48, heavy: 0x566270, sniper: 0x264b68,
    shield: 0x315850, bomber: 0xcb652d, flyer: 0x52758d, boss: 0xb08a40,
    hitbox: 0x855382, lagspike: 0x596a80 }[kind];
  const shell = oval(root, ivory, 0, -r * 0.02, r * 0.84, r * 1.02, r * 1.08, r * 0.32);
  shell.name = 'mask-shell';
  if (kind === 'shield') {
    const half = mesh(root, boxGeo(r * 0.72, r * 1.6, r * 0.08), paint, r * 0.4, 0, r * 1.06);
    half.name = 'split-face';
  }
  for (const sign of [-1, 1]) {
    const x = sign * r * 0.39;
    oval(eyes, ink, x, r * 0.16, r * 1.1, r * 0.23, r * 0.20, r * 0.07);
    const brow = mesh(root, boxGeo(r * 0.44, r * 0.08, r * 0.06), paint, x, r * 0.43, r * 1.08);
    brow.rotation.z = sign * (kind === 'sniper' ? 0.35 : -0.25);
    for (const turn of [-1, 1]) {
      const mark = mesh(dead, boxGeo(r * 0.35, r * 0.07, r * 0.05), red, x, r * 0.16, r * 1.17);
      mark.rotation.z = turn * Math.PI / 4;
    }
    if (kind === 'rusher' || kind === 'boss' || kind === 'flyer') {
      const diamond = mesh(root, boxGeo(r * 0.22, r * 0.22, r * 0.04), paint, x, -r * 0.16, r * 1.12);
      diamond.rotation.z = Math.PI / 4;
      diamond.scale.y = kind === 'rusher' ? 1.7 : 1;
    } else if (kind === 'sniper') {
      const tear = mesh(root, coneGeo(r * 0.09, r * 0.4, 3), paint, x, -r * 0.22, r * 1.1);
      tear.rotation.z = Math.PI;
    } else {
      oval(root, paint, sign * r * 0.68, -r * 0.22, r * 1.04, r * 0.19, r * 0.12, r * 0.045);
    }
  }
  const nose = oval(root, kind === 'boss' ? paint : red, 0, -r * 0.04, r * 1.23, r * 0.19, r * 0.17, r * 0.19);
  nose.name = 'clown-nose';
  const armored = kind === 'heavy' || kind === 'hitbox';
  if (armored) {
    const jaw = mesh(root, boxGeo(r * 1.5, r * 0.5, r * 0.15), paint, 0, -r * 0.6, r * 0.98);
    jaw.name = kind === 'heavy' ? 'armored-grin' : 'block-grin';
    for (let i = -2; i <= 2; i++) mesh(root, boxGeo(r * 0.12, r * 0.25, r * 0.06), ivory, i * r * 0.24, -r * 0.59, r * 1.08);
  } else {
    const mouth = mesh(root, new THREE.TorusGeometry(r * 0.46, r * 0.075, 4, 10, Math.PI),
      red, 0, -r * 0.29, r * 1.08);
    mouth.name = 'painted-grin';
    mouth.rotation.z = kind === 'sniper' ? 0 : Math.PI;
    if (kind === 'bomber') {
      oval(root, ink, 0, -r * 0.52, r * 1.11, r * 0.32, r * 0.23, r * 0.04);
      mesh(root, boxGeo(r * 0.42, r * 0.10, r * 0.05), ivory, 0, -r * 0.37, r * 1.17);
    }
  }
  if (kind === 'grunt' || kind === 'bomber') {
    for (const sign of [-1, 1]) {
      const puff = oval(root, paint, sign * r * 1.05, r * 0.42, r * 0.4, r * 0.3, r * 0.38, r * 0.25);
      puff.name = 'clown-hair';
    }
  } else if (kind === 'lagspike') {
    for (const sign of [-1, 1]) for (let i = 0; i < 3; i++) {
      const spike = mesh(root, coneGeo(r * 0.13, r * 0.48, 3), paint, sign * r * (0.8 + i * 0.09), r * (0.65 - i * 0.5), r * 0.7);
      spike.rotation.z = -sign * (0.6 + i * 0.5);
      spike.name = 'jagged-mask-edge';
    }
  } else if (kind === 'boss') {
    mesh(root, boxGeo(r * 0.13, r * 0.38, r * 0.04), paint, 0, r * 0.7, r * 0.99).rotation.z = Math.PI / 4;
  }
  dead.visible = false;
  return { root, eyes, dead };
}

function hat(parent: THREE.Object3D, kind: HatKind, color: number, size: number): THREE.Group {
  const root = group(parent, 'hat', 0, 0.26, 0);
  if (kind === 'cap') {
    oval(root, color, 0, 0.245 * size, -0.015, 0.285 * size, 0.12 * size, 0.255 * size);
    mesh(root, boxGeo(0.31 * size, 0.035, 0.23 * size), DARK, 0, 0.205 * size, 0.235 * size);
  } else if (kind === 'band') {
    const band = mesh(root, torusGeo(0.262 * size, 0.036, 4, 12), ACCENT, 0, 0.125 * size, 0);
    band.rotation.x = Math.PI / 2;
    for (let i = -1; i <= 1; i++) {
      const spike = mesh(root, coneGeo(0.055, 0.2, 3), color, i * 0.13, 0.34, -0.025);
      spike.rotation.z = -i * 0.35;
    }
    const ribbon = mesh(root, boxGeo(0.08, 0.27, 0.025), ACCENT, 0.22, 0.02, -0.19);
    ribbon.rotation.z = -0.4;
  } else if (kind === 'helmet') {
    mesh(root, new THREE.SphereGeometry(0.3 * size, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      DARK, 0, 0.1 * size, 0);
    mesh(root, boxGeo(0.62 * size, 0.05, 0.51 * size), DARK, 0, 0.105 * size, 0);
  } else if (kind === 'hood') {
    oval(root, DARK, 0, 0.035, -0.075, 0.32 * size, 0.345 * size, 0.25 * size);
    // The face remains outside the hood's front edge.
  } else if (kind === 'crown') {
    mesh(root, cylGeo(0.3 * size, 0.13, 8, 'y'), ACCENT, 0, 0.275 * size, 0);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      mesh(root, coneGeo(0.075, 0.22, 3), ACCENT,
        Math.cos(a) * 0.24 * size, 0.43 * size, Math.sin(a) * 0.24 * size);
    }
  }
  return root;
}

function weaponProp(kind: WeaponPropKind, color: number): THREE.Group {
  const root = new THREE.Group();
  root.name = kind;
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, c = color) =>
    mesh(root, boxGeo(w, h, d), c, x, y, z);
  const barrel = (r: number, length: number, x: number, y: number, z: number) =>
    mesh(root, cylGeo(r, length), DARK, x, y, z);
  if (kind === 'knife') {
    addBox(0.018, 0.055, 0.30, 0, 0.04, 0.16, 0xcbdbe3);
    addBox(0.09, 0.07, 0.025, 0, 0.04, -0.01, DARK);
    addBox(0.04, 0.045, 0.15, 0, 0.04, -0.10, DARK);
  } else if (kind === 'pistol') {
    addBox(0.075, 0.09, 0.28, 0, 0.08, 0.10, DARK);
    barrel(0.018, 0.18, 0, 0.07, 0.20);
    addBox(0.06, 0.16, 0.09, 0, -0.04, 0.01, DARK).rotation.x = -0.2;
    addBox(0.07, 0.025, 0.12, 0, -0.01, 0.13, color);
  } else if (kind === 'blade') {
    addBox(0.02, 0.05, 0.95, 0, 0.04, 0.42);
    addBox(0.11, 0.11, 0.03, 0, 0.04, -0.06, ACCENT);
    addBox(0.035, 0.045, 0.24, 0, 0.04, -0.19, DARK);
  } else if (kind === 'hammer') {
    // Ban hammer: a long handle and a fat two-tone head.
    barrel(0.045, 0.7, 0, 0.05, 0.2);
    addBox(0.42, 0.2, 0.2, 0, 0.05, 0.58, ACCENT);
    addBox(0.06, 0.22, 0.22, 0, 0.05, 0.58, DARK);
  } else if (kind === 'shotgun') {
    addBox(0.1, 0.13, 0.66, 0, 0.02, 0.2);
    barrel(0.035, 0.5, 0, 0.08, 0.5);
    addBox(0.11, 0.065, 0.2, 0, -0.005, 0.47, DARK);
    addBox(0.075, 0.1, 0.19, 0, -0.005, -0.19, DARK);
  } else if (kind === 'sniper') {
    addBox(0.075, 0.11, 0.6, 0, 0.02, 0.15);
    barrel(0.025, 0.95, 0, 0.05, 0.72);
    addBox(0.06, 0.07, 0.22, 0, 0.13, 0.06, DARK);
    addBox(0.04, 0.13, 0.11, 0, -0.08, 0.02, DARK);
  } else if (kind !== 'none') {
    addBox(0.085, 0.12, 0.40, 0, 0.02, 0.15, DARK);
    barrel(0.027, 0.25, 0, 0.05, 0.46);
    const mag = addBox(0.06, 0.19, 0.09, 0, -0.105, 0.13, DARK);
    mag.rotation.x = -0.15;
    const lowerMag = addBox(0.06, 0.10, 0.09, 0, -0.24, 0.17, DARK);
    lowerMag.rotation.x = -0.35;
    for (const sign of [-1, 1]) addBox(0.015, 0.02, 0.26, sign * 0.04, 0.02, -0.15, DARK);
    addBox(0.07, 0.14, 0.035, 0, -0.02, -0.28, DARK);
    barrel(0.04, 0.24, 0, 0.14, 0.13);
  }
  return root;
}

export function makeWeaponProp(index: number): THREE.Group {
  return weaponProp((['rifle', 'shotgun', 'sniper', 'pistol'] as const)[index] ?? 'rifle', TONE_HEX[TONE.HOSTILE]);
}

/** A part the branch above has just built. Throws only if a name is misspelled. */
function built(part: THREE.Object3D | undefined, name: FigurePartName): THREE.Object3D {
  if (!part) throw new Error(`figure: part "${name}" was not built`);
  return part;
}

export function makeFigure(o: FigureOpts): Figure {
  const root = new THREE.Group();
  root.name = o.kind;
  root.scale.setScalar(o.scale ?? 1);
  const parts: FigureParts = {}, anchors: FigureAnchors = {};
  const color = o.color ?? TONE_HEX[TONE.HOSTILE];
  let eyeSets: FaceSets, weapon: THREE.Group | null = null;
  const joint = (name: FigurePartName, parent: THREE.Object3D, x: number, y: number, z: number) =>
    (parts[name] = group(parent, name, x, y, z));
  const anchor = (name: FigureAnchorName, parent: THREE.Object3D, x = 0, y = 0, z = 0) =>
    (anchors[name] = group(parent, `${name}Hit`, x, y, z));
  const legs = (hips: THREE.Object3D, width: number, thighLength: number, shinLength: number,
    radius: number, offset: number) => {
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const thigh = joint(`thigh${side}`, hips, sign * width, offset, 0);
      mesh(thigh, cylGeo(radius * 1.15, thighLength, 7, 'y'), color, 0, -thighLength / 2, 0);
      anchor(`leg${side}`, thigh, 0, -thighLength * 0.55, 0);
      const shin = joint(`shin${side}`, thigh, 0, -thighLength, 0);
      mesh(shin, cylGeo(radius * 1.06, shinLength, 7, 'y'), color, 0, -shinLength / 2, 0);
      anchor(`shin${side}`, shin, 0, -shinLength * 0.55, 0);
      oval(shin, DARK, 0, -shinLength + 0.03, 0.065, radius * 2.4, 0.055, 0.145);
    }
  };

  if (o.kind === 'flyer') {
    const body = joint('torso', root, 0, 0.6, 0);
    parts.hips = parts.head = body;
    anchor('torso', body);
    anchors.head = anchors.torso;
    const dart = mesh(body, coneGeo(0.32, 1.25, 3), color, 0, 0, 0.08);
    dart.rotation.x = Math.PI / 2;
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const wing = joint(`wing${side}`, body, sign * 0.48, 0, -0.14);
      mesh(wing, boxGeo(0.86, 0.025, 0.5), color);
    }
    const tail = mesh(body, coneGeo(0.16, 0.38, 3), DARK, 0, 0.13, -0.52);
    tail.rotation.x = -Math.PI / 2;
    parts.tail = tail;
    const faceMount = joint('face', body, 0, -0.06, 0.3);
    faceMount.scale.setScalar(0.72);
    eyeSets = face(faceMount, 0.24, true, o.mask);
    parts.tip = group(body, 'tip', 0, 0, 0.7);
  } else if (o.kind === 'blob') {
    const hips = joint('hips', root, 0, 0.5, 0);
    const torso = joint('torso', hips, 0, 0, 0);
    parts.head = torso;
    anchor('hips', hips);
    anchor('torso', torso, 0, 0.32, 0);
    anchors.head = anchors.torso;
    oval(torso, color, 0, 0.32, 0, 0.44, 0.44, 0.44);
    const faceMount = joint('face', torso, 0, 0.32, 0.17);
    eyeSets = face(faceMount, 0.28, o.smile, o.mask);
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const arm = joint(`upper${side}`, torso, sign * 0.42, 0.42, 0);
      parts[`shoulder${side}`] = arm;
      mesh(arm, cylGeo(0.038, 0.26, 6, 'y'), color, 0, -0.13, 0);
      anchor(`arm${side}`, arm, 0, -0.143, 0);
      const fore = joint(`fore${side}`, arm, 0, -0.26, 0);
      oval(fore, color, 0, 0, 0, 0.07, 0.07, 0.07);
    }
    legs(hips, 0.16, 0.26, 0.24, 0.035, -0.06);
    parts.tip = group(torso, 'tip', 0, 0.5, 0.5);
    if (o.blob === 'hitbox') {
      parts.lid = mesh(torso, boxGeo(0.7, 0.32, 0.5), color, 0, 0.86, 0);
      mesh(torso, boxGeo(0.71, 0.055, 0.51), DARK, 0, 0.705, 0);
    } else if (o.blob === 'lagspike') {
      const spikes = parts.spikes = group(torso, 'spikes');
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2;
        const spike = mesh(spikes, coneGeo(0.12, 0.42, 5), color,
          Math.cos(a) * 0.42, 0.32 + Math.sin(2.3 * a) * 0.25, Math.sin(a) * 0.42);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      }
    } else {
      parts.cap = mesh(torso, cylGeo(0.14, 0.085, 8, 'y'), DARK, 0, 0.76, 0);
      const path = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(-0.02, 1.15, 0), new THREE.Vector3(0.24, 1.14, 0));
      parts.fuse = mesh(torso, new THREE.TubeGeometry(path, 7, 0.025, 5, false), DARK);
      parts.spark = mesh(torso, sphereGeo(0.075), ACCENT, 0.24, 1.14, 0, true);
    }
  } else {
    const width = o.bodyWidth ?? 1, size = o.headSize ?? 1, radius = o.limbR ?? 0.033;
    const hips = joint('hips', root, 0, 0.86, 0);
    const torso = joint('torso', hips, 0, 0.04, 0);
    anchor('hips', hips);
    anchor('torso', torso, 0, 0.26, 0);
    oval(torso, color, 0, 0.26, 0, 0.3 * width, 0.3, 0.19 * width);
    mesh(torso, new THREE.CylinderGeometry(0.045, 0.05, 0.12, 7), color, 0, 0.56, 0);
    const head = joint('head', torso, 0, 0.62, 0);
    anchor('head', head, 0, 0.26, 0);
    oval(head, color, 0, 0.26, 0, 0.275 * size * rand(0.95, 1.06), 0.3 * size, 0.25 * size);
    const faceMount = joint('face', head, 0, 0.26, 0.015 * size);
    faceMount.scale.setScalar(size);
    eyeSets = face(faceMount, 0.25, o.smile, o.mask);
    parts.hat = hat(head, o.hat ?? 'none', color, size);
    for (const [side, sign] of [['L', -1], ['R', 1]] as const) {
      const shoulder = joint(`shoulder${side}`, torso, sign * 0.26 * width, 0.46, 0);
      const upper = joint(`upper${side}`, shoulder, 0, 0, 0);
      mesh(upper, cylGeo(radius, 0.3, 7, 'y'), color, 0, -0.15, 0);
      anchor(`arm${side}`, upper, 0, -0.165, 0);
      const fore = joint(`fore${side}`, upper, 0, -0.3, 0);
      mesh(fore, cylGeo(radius * (0.03 / 0.033), 0.28, 7, 'y'), color, 0, -0.14, 0);
      anchor(`fore${side}`, fore, 0, -0.154, 0);
      oval(fore, color, 0, -0.3, 0, 0.076, 0.076, 0.076);
    }
    legs(hips, 0.13 * width, 0.42, 0.42, radius, -0.02);
    parts.gunMount = group(built(parts.foreR, 'foreR'), 'gunMount', 0, -0.29, 0.07);
    if (o.shield) {
      const shield = joint('shield', torso, -0.17, 0.34, 0.46);
      mesh(shield, boxGeo(0.92, 1.3, 0.07), color);
      mesh(shield, boxGeo(0.1, 1.1, 0.035), DARK, 0, 0, 0.045);
      mesh(shield, boxGeo(0.75, 0.1, 0.035), DARK, 0, 0.12, 0.045);
      anchor('shield', shield);
    }
  }

  parts.eyes = eyeSets.eyes;
  parts.deadEyes = eyeSets.dead;
  let disposed = false;
  const figure: Figure = {
    root, parts, anchors,
    setEyes(dead) { eyeSets.eyes.visible = !dead; eyeSets.dead.visible = !!dead; },
    setWeapon(kind) {
      const mount = parts.gunMount;
      if (!mount) return;
      if (weapon) release(weapon);
      weapon = weaponProp(kind, color);
      // Props point down +z; the forearm hangs down -y. Lay the prop along the forearm so a raised arm aims it forward.
      weapon.rotation.x = Math.PI / 2;
      mount.add(weapon);
      parts.weapon = weapon;
      parts.tip = group(weapon, 'tip', 0, 0.05, kind === 'blade' ? 0.92 : kind === 'knife' || kind === 'pistol' ? 0.31 : kind === 'rifle' ? 0.59 : kind === 'hammer' ? 0.6 : 0.78);
    },
    dropShield() {
      const shield = parts.shield;
      if (!shield) return null;
      shield.updateWorldMatrix(true, false);
      const world = shield.matrixWorld.clone();
      shield.removeFromParent();
      world.decompose(shield.position, shield.quaternion, shield.scale);
      delete parts.shield;
      delete anchors.shield;
      return shield;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release(root);
    },
  };
  figure.setWeapon(o.weapon ?? 'none');
  return figure;
}

export function makeNameTag(name: unknown): THREE.Group {
  const text = (typeof name === 'string' ? name.trim().slice(0, 14) : '') || 'recruit';
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('figure: no 2d canvas context for the name tag');
  const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
  context.fillStyle = css(TONE_HEX[TONE.HOSTILE]);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = css(WHITE_HEX);
  context.font = '700 64px "Space Grotesk", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const material = makeLabelMaterial(texture);
  const root = new THREE.Group();
  root.name = 'nameTag';
  const plaque = new THREE.Mesh(boxGeo(0.5, 0.28, 0.02), material);
  root.add(plaque);
  root.userData.name = text;
  let disposed = false;
  root.userData.dispose = () => {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    plaque.geometry.dispose();
    material.dispose();
    texture.dispose();
  };
  return root;
}

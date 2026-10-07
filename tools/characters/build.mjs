// Optimise the characters' model file (docs/VISUALS.md, V12): public/models/tactical.glb, rebuilt from itself.
//
//   node tools/characters/build.mjs             optimise public/models/tactical.glb in place
//   node tools/characters/build.mjs --in FILE   from another raw export (assets/models/build_tactical.py writes one)
//   node tools/characters/build.mjs --dry       report what it would do, write nothing
//
// The raw export (Blender's glTF exporter) is 10.4 MB for what a figure 5-60 m away shows: bevels and
// spheres of 300-600 triangles on parts a centimetre across, a 4,140-triangle mask shell on all 22
// masks, a UV set nothing samples, identical meshes stored once per copy, and no compression. This:
// 1. drops TEXCOORD_0 (the characters wear flat PBR colours, no texture) and the zero-area triangles;
// 2. simplifies every mesh with meshoptimizer to ERROR metres of geometric error (below a pixel at the
//    closest the game shows a figure), which takes out the bevel rings, rivet spheres and rounded
//    fingers, teeth, vents and antenna tips but keeps every silhouette; the mask shell goes to
//    about 600 triangles, its outline and eye holes as they were (TARGETS). Flat-shaded parts stay flat: they are simplified on their positions
//    and get their face normals back; smooth ones keep their own normals (the simplifier keeps
//    vertices, it does not move them) and their seams;
// 3. welds, shares identical meshes, and writes quantised, meshopt-compressed geometry
//    (KHR_mesh_quantization, EXT_meshopt_compression);
// 4. records the file's size, SHA-256 and triangles per kind in src/engine/render/character-assets.json,
//    which the game's tests hold it to.
// A file this script wrote carries `asset.extras.characters` and is not optimised twice: rebuild the raw
// export first (see assets/models/README.md), or pass it with --in.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const glbPath = path.join(root, 'public/models/tactical.glb');
const manifestPath = path.join(root, 'src/engine/render/character-assets.json');
const VERSION = 1;
/**
 * Geometric error every mesh may take, in metres. The closest the game frames a figure is the model
 * check's portrait (5 m at a 30 degree FOV, 1440 x 900: 3 mm a pixel); in play, 5 m at 82 degrees is 1 cm.
 */
const ERROR = 0.002;
/**
 * Per batch and material (`<node name>/<material>`, the node name without its kind): a triangle target
 * and the error it may spend on it; `border` keeps its open edges as they are, and `normals` weighs its
 * shading over NORMAL_WEIGHT. The mask is read by its outline, its eye holes and its smooth face: those
 * stay, and only the inner faces thin out, where the shading can spare them (no creases, no lobed chin).
 */
const TARGETS = {
  'mask-shell/mask-ivory': { triangles: 600, error: 0.004, border: true, normals: 0.5 },
  // Detail no figure shows at play distance: flattened to plates and stubs, their outline kept.
  'antenna-tip/signal-violet': { triangles: 0, error: 0.004 },
  'cheek-vent/mask-ink': { triangles: 0, error: 0.004 },
  'curled-finger/black-rubber': { triangles: 0, error: 0.004 },
  'grin-tooth/mask-ivory': { triangles: 0, error: 0.004 },
  'rage-jaw-tooth/gunmetal-hardware': { triangles: 0, error: 0.004 },
};
/** How much a normal's change counts against a position's (in metres per unit of normal) when simplifying smooth parts (TARGETS may set more). */
const NORMAL_WEIGHT = 0.05;
/** Below this a triangle has no area (the thin plates of the goggles and the view tab had 132). */
const MIN_AREA = 1e-10;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const input = args.includes('--in') ? path.resolve(args[args.indexOf('--in') + 1]) : glbPath;

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sourceBytes = await readFile(input);
const doc = await io.readBinary(sourceBytes);
const asset = doc.getRoot().getAsset();
if (asset.extras?.characters) {
  console.log(`${path.relative(root, input)} is already optimised (version ${asset.extras.characters.version}); pass the raw export with --in`);
  process.exit(0);
}

/** A node's name without its `<kind>__` prefix and Blender's `.001` suffix. */
const batchName = node => node.getName().replace(/^[a-z]+__/, '').replace(/\.\d+$/, '');
const kindOf = node => node.getName().split('__')[0];

/** Triangles per kind, counting only what the game uses: the `<kind>__<part>-surface` subtrees. */
function census() {
  const byKind = {};
  let total = 0;
  const visit = (node, kind, used) => {
    used ||= node.getName().endsWith('-surface');
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const tris = (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
      total += tris;
      if (used) byKind[kind] = (byKind[kind] ?? 0) + tris;
    }
    for (const child of node.listChildren()) visit(child, kind, used);
  };
  for (const top of doc.getRoot().listScenes()[0].listChildren()) visit(top, kindOf(top), false);
  return { total, byKind };
}

const before = census();
let zeroArea = 0;

// ---- 1. no UVs, no zero-area triangles
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    // The exporter shares accessors between primitives; each is edited on its own below (step 3 shares them again).
    prim.setAttribute('TEXCOORD_0', null);
    for (const semantic of prim.listSemantics()) prim.setAttribute(semantic, prim.getAttribute(semantic).clone());
    prim.setIndices(prim.getIndices().clone());
    const kept = withArea(prim.getAttribute('POSITION').getArray(), prim.getIndices().getArray());
    zeroArea += prim.getIndices().getCount() / 3 - kept.length / 3;
    prim.getIndices().setArray(kept);
  }
}
await doc.transform(weld());

/** The triangles of `indices` that have an area, as a Uint32Array. */
function withArea(positions, indices) {
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2];
    const vx = positions[3 * c] - positions[3 * a], vy = positions[3 * c + 1] - positions[3 * a + 1], vz = positions[3 * c + 2] - positions[3 * a + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area > MIN_AREA) kept.push(a, b, c);
  }
  return new Uint32Array(kept);
}

/** Every triangle's three normals are equal: a flat-shaded part. */
function isFlat(normals, indices) {
  for (let t = 0; t < indices.length; t += 3) {
    for (const k of [1, 2]) {
      const a = 3 * indices[t], b = 3 * indices[t + k];
      if (Math.abs(normals[a] - normals[b]) + Math.abs(normals[a + 1] - normals[b + 1]) + Math.abs(normals[a + 2] - normals[b + 2]) > 1e-3) return false;
    }
  }
  return true;
}

// ---- 2. simplify
const simplified = new Set();
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || simplified.has(mesh)) continue;
  simplified.add(mesh);
  for (const prim of mesh.listPrimitives()) {
    const target = TARGETS[`${batchName(node)}/${prim.getMaterial()?.getName()}`];
    let positions = new Float32Array(prim.getAttribute('POSITION').getArray());
    const normals = prim.getAttribute('NORMAL').getArray();
    const indices = new Uint32Array(prim.getIndices().getArray());
    const count = target ? Math.min(indices.length, 3 * target.triangles) : 0;
    const error = target?.error ?? ERROR;
    if (isFlat(normals, indices)) {
      // Simplified on its positions alone (every face is split for its normal), then split per face again.
      // The simplifier reads a position's other copies as a seam, so it gets one vertex per position.
      const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
      const welded = indices.map(i => remap[i]);
      const [, unique] = MeshoptSimplifier.compactMesh(welded);
      const compact = new Float32Array(3 * unique);
      welded.forEach((vertex, i) => compact.set(positions.subarray(3 * remap[indices[i]], 3 * remap[indices[i]] + 3), 3 * vertex));
      const [kept] = MeshoptSimplifier.simplify(welded, compact, 3, count, error, ['ErrorAbsolute']);
      positions = compact;
      const faces = withArea(positions, kept);
      const flatPositions = new Float32Array(faces.length * 3), flatNormals = new Float32Array(faces.length * 3);
      for (let t = 0; t < faces.length; t += 3) {
        const [a, b, c] = [faces[t], faces[t + 1], faces[t + 2]];
        const ux = positions[3 * b] - positions[3 * a], uy = positions[3 * b + 1] - positions[3 * a + 1], uz = positions[3 * b + 2] - positions[3 * a + 2];
        const vx = positions[3 * c] - positions[3 * a], vy = positions[3 * c + 1] - positions[3 * a + 1], vz = positions[3 * c + 2] - positions[3 * a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz);
        for (let k = 0; k < 3; k++) {
          flatPositions.set(positions.subarray(3 * faces[t + k], 3 * faces[t + k] + 3), 3 * (t + k));
          flatNormals.set([nx / length, ny / length, nz / length], 3 * (t + k));
        }
      }
      prim.getAttribute('POSITION').setArray(flatPositions);
      prim.getAttribute('NORMAL').setArray(flatNormals);
      prim.getIndices().setArray(Uint32Array.from({ length: faces.length }, (_, i) => i));
    } else {
      // Normals and their seams stay as authored; the simplifier only keeps a subset of the vertices,
      // and weighs the normals so a kept vertex's normal still suits the larger faces around it.
      const [kept] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, new Float32Array(normals), 3,
        Array(3).fill(target?.normals ?? NORMAL_WEIGHT), null, count, error, target?.border ? ['ErrorAbsolute', 'LockBorder'] : ['ErrorAbsolute']);
      prim.getIndices().setArray(withArea(positions, kept));
    }
  }
}

// ---- 3. weld, share, compress
await doc.transform(
  weld(),
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
  prune({ keepLeaves: true, keepAttributes: false }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
const after = census();
asset.extras = { ...asset.extras, characters: { version: VERSION } };
const out = Buffer.from(await io.writeBinary(doc));
const sha256 = createHash('sha256').update(out).digest('hex');
console.log(`triangles ${before.total} -> ${after.total}; zero-area triangles removed ${zeroArea}; meshes ${doc.getRoot().listMeshes().length}`);
for (const kind of Object.keys(after.byKind).sort()) console.log(`  ${kind.padEnd(13)} ${String(before.byKind[kind]).padStart(6)} -> ${after.byKind[kind]}`);
console.log(`${(sourceBytes.length / 1e6).toFixed(2)} MB -> ${(out.length / 1e6).toFixed(2)} MB`);
if (dry) process.exit(0);
await writeFile(glbPath, out);
await writeFile(manifestPath, `${JSON.stringify({ version: VERSION, bytes: out.length, sha256, triangles: after.total, kinds: after.byKind,
  source: { bytes: sourceBytes.length, triangles: before.total } }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, glbPath)} and ${path.relative(root, manifestPath)}`);

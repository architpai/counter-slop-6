// Regenerate the first-person weapons and arms of the realistic tiers (docs/VISUALS.md, R4).
//
//   node tools/weapons/build.mjs               model and bake every set in Blender, then pack and encode
//   node tools/weapons/build.mjs r4c pistol    only these sets (the others' last build is packed with them)
//   node tools/weapons/build.mjs --pack        pack and encode the last build again (no Blender)
//   node tools/weapons/build.mjs --glb         pack the glb again only (no Blender, the maps as they are)
//
// 1. Blender runs tools/blender/weapons/<set>.py for each set, hands and optics first (the guns
//    append the posed hands and preview the optics), into tools/weapons/.build/<set>/: model.glb
//    (nodes, clips and sockets; material names only), raw RGBA8 albedo, normal and ORM maps at
//    2048, 1024 and 512, PNG previews and meta.json (triangles per node, clip lengths, sockets).
// 2. gltf-transform merges the sets' models into public/models/weapons.glb: one scene, the clips
//    resampled (lossless), meshes welded, quantised and meshopt-compressed (EXT_meshopt_compression).
//    It adds each enemy prop's LOD (`prop__<kind>`, PROPS): the gun without hands, glass or clips,
//    merged into one mesh of its set's material in the flat props' frame, and simplified.
// 3. ktx2-encoder writes public/weapons/<size>/<set>-<map>.ktx2 (Basis ETC1S with mipmaps).
// 4. src/engine/render/weapon-assets.json records every set's file sizes, every model's
//    triangles, the clip lengths and the glb's size; the game and the tests read it.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, meshopt, prune, resample, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix3, Matrix4, Vector3 } from 'three';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = path.join(root, 'tools/blender/weapons');
const build = path.join(root, 'tools/weapons/.build');
const glbPath = path.join(root, 'public/models/weapons.glb');
const textureDir = path.join(root, 'public/weapons');
const manifestPath = path.join(root, 'src/engine/render/weapon-assets.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
/** Build order: the guns append the hands and preview the optics. */
const SETS = ['hands', 'optics', 'r4c', 'mp5', 'shotgun', 'sniper', 'pistol', 'knife'];
const SIZES = [512, 1024, 2048];
/**
 * Small models stop at 1K: at the top tier their atlases' texels would be far finer on screen than
 * the guns' (the optics, the pistol and the knife cover a fraction of the screen a rifle does), and
 * the Ultra download stays within its 10 MB (docs/VISUALS.md, R4).
 */
const MAX_SIZE = { optics: 1024, pistol: 1024, knife: 1024 };
const MAPS = ['albedo', 'normal', 'orm'];
/** As the level textures (tools/textures/build.mjs): ETC1S, normals at the codec's normal-map tuning. */
const ENCODE = {
  albedo: { qualityLevel: 200, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { qualityLevel: 255, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  orm: { qualityLevel: 150, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};

const args = process.argv.slice(2);
const glbOnly = args.includes('--glb');
const packOnly = glbOnly || args.includes('--pack');
const wanted = args.filter(a => !a.startsWith('--'));
for (const name of wanted) if (!SETS.includes(name)) throw new Error(`no set ${name} (${SETS.join(', ')})`);

if (!packOnly) {
  for (const name of SETS.filter(s => wanted.length === 0 || wanted.includes(s))) {
    const started = Date.now();
    const result = spawnSync(blender, ['--background', '--factory-startup', '--python', path.join(scripts, `${name}.py`), '--', '--out', build],
      { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (result.status !== 0 || !existsSync(path.join(build, name, 'meta.json'))) {
      process.stderr.write(result.stdout + result.stderr);
      throw new Error(`Blender failed on ${name}`);
    }
    console.log(`built ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

// ---- 2. one glb
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = new Document();
const meta = {};
for (const name of SETS) {
  const metaFile = path.join(build, name, 'meta.json');
  if (!existsSync(metaFile)) {
    console.warn(`no build of ${name} yet`);
    continue;
  }
  meta[name] = JSON.parse(await readFile(metaFile, 'utf8'));
  const file = path.join(build, name, 'model.glb');
  if (existsSync(file)) mergeDocuments(doc, await io.read(file));
}
// Every set's scene into the first.
const [scene, ...others] = doc.getRoot().listScenes();
for (const other of others) {
  for (const node of other.listChildren()) scene.addChild(node);
  other.dispose();
}
doc.getRoot().setDefaultScene(scene);
// Quantisation folds each mesh's dequantisation into its node's transform. A part the game moves
// (clips, or the procedural pose on the flat look's part names) keeps the transform it was authored
// with, its pivot, so its mesh moves down onto a child node first. Static bodies and the optics'
// shells keep the mesh on the named node, where the game reads their materials by name.
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(), name = node.getName();
  if (!mesh || name.endsWith('__body') || name.startsWith('acog__') || name.startsWith('holo__')) continue;
  node.setMesh(null).addChild(doc.createNode('').setMesh(mesh));
}
// ---- the enemy props' LODs (render/weapons.ts `prop`)
/** An enemy's prop kind (render/figure.ts `WeaponPropKind`) and the model it is made from; the blade is a long knife. */
const PROPS = { r4c: 'r4c', rifle: 'mp5', shotgun: 'shotgun', sniper: 'sniper', pistol: 'pistol', knife: 'knife', blade: 'knife' };
/** Where each prop's muzzle (or point) is in the flat props' frame (figure.ts `setWeapon`): projectiles leave from there. */
const TIP = { r4c: 0.78, rifle: 0.59, shotgun: 0.78, sniper: 0.78, pistol: 0.31, knife: 0.31, blade: 0.92 };
/** The enemies' guns read as large as the flat props at range: the Blender guns, grip at the hand, a quarter up. */
const PROP_SCALE = 1.25;
/** How far a gun may slide along the hand for its muzzle to meet the tip; the rest is left as a gap. */
const PROP_SLIDE = 0.1;
/**
 * Across the barrel (x and y, not along it): the characters are chunky and stylised, so a gun of
 * true proportions reads as a sliver in their hands at 10-30 m. The length stays, so the muzzle
 * still meets the tip.
 */
const PROP_BULK = 1.3;
/** The blade: the knife's handle and guard as they are, its blade (past the guard) drawn out to the tip, all a little thicker. */
const BLADE = { guard: 0.114, thickness: 1.6 };
/** Triangles a prop keeps: at 5-60 m a gun is a few dozen pixels long. */
const PROP_TRIANGLES = 1200;
await MeshoptSimplifier.ready;
const propTriangles = {};
for (const [kind, model] of Object.entries(PROPS)) {
  const top = scene.listChildren().find(node => node.getName() === model);
  const pivot = doc.getRoot().listNodes().find(node => node.getName() === `${model}__pivot`);
  const muzzle = doc.getRoot().listNodes().find(node => node.getName() === `${model}__${model === 'knife' ? 'tip' : 'muzzle'}`);
  const material = doc.getRoot().listMaterials().find(m => m.getName() === model);
  if (!top || !pivot || !muzzle || !material) {
    console.warn(`no prop for ${kind}: ${model} is not built`);
    continue;
  }
  // The flat props' frame: the grip (the model's pivot) at the hand, forward +z (the models point down -z).
  const frame = new Matrix4().makeScale(-PROP_SCALE, PROP_SCALE, -PROP_SCALE).multiply(new Matrix4().fromArray(pivot.getWorldMatrix()).invert());
  const muzzleZ = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(muzzle.getWorldMatrix())).applyMatrix4(frame).z;
  const shift = kind === 'blade' ? 0 : Math.max(-PROP_SLIDE, Math.min(PROP_SLIDE, TIP[kind] - muzzleZ));
  const stretch = kind === 'blade' ? (TIP.blade - BLADE.guard) / (muzzleZ - BLADE.guard) : 1;
  const bulk = kind === 'blade' ? BLADE.thickness : PROP_BULK;
  const positions = [], normals = [], uvs = [], indices = [];
  const visit = node => {
    if (/-hand$/.test(node.getName())) return;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (prim.getMaterial()?.getName() !== model) continue;
      const matrix = frame.clone().multiply(new Matrix4().fromArray(node.getWorldMatrix()));
      const normalMatrix = new Matrix3().getNormalMatrix(matrix);
      const base = positions.length / 3, p = prim.getAttribute('POSITION'), n = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
      const v = new Vector3(), el = [0, 0, 0];
      for (let i = 0; i < p.getCount(); i++) {
        v.fromArray(p.getElement(i, el)).applyMatrix4(matrix);
        if (kind === 'blade' && v.z > BLADE.guard) v.z = BLADE.guard + (v.z - BLADE.guard) * stretch;
        positions.push(v.x * bulk, v.y * bulk, v.z + shift);
        // A normal takes the inverse of the widening, so the faces still shade as they face.
        v.fromArray(n.getElement(i, el)).applyMatrix3(normalMatrix);
        v.set(v.x / bulk, v.y / bulk, v.z).normalize();
        normals.push(v.x, v.y, v.z);
        uvs.push(...uv.getElement(i, [0, 0]));
      }
      const index = prim.getIndices();
      for (let i = 0; i < index.getCount(); i++) indices.push(base + index.getScalar(i));
    }
    for (const child of node.listChildren()) visit(child);
  };
  visit(top);
  // The UVs weigh in, so the atlas's islands hold as the triangles go.
  const vertexData = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) vertexData.set([...normals.slice(3 * i, 3 * i + 3).map(c => c * 0.02), uvs[2 * i] * 0.5, uvs[2 * i + 1] * 0.5], 5 * i);
  const [simple] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices), new Float32Array(positions), 3, vertexData, 5,
    [1, 1, 1, 1, 1], null, 3 * PROP_TRIANGLES, 0.01, ['ErrorAbsolute', 'Permissive']);
  // A gun has hundreds of small UV islands, more than a prop keeps triangles, so most kept triangles
  // join corners from two or three of them; their UVs would span the atlas between the islands and
  // pick up whatever lies there (the blue of the magazine's base along a handguard). Such a triangle
  // takes one flat texel instead: the middle of a source triangle at its corner of the island most
  // of its corners come from.
  const island = new Int32Array(positions.length / 3).map((_, i) => i), byKey = new Map();
  const find = i => { while (island[i] !== i) i = island[i] = island[island[i]]; return i; };
  for (let i = 0; i < island.length; i++) {
    const key = [...positions.slice(3 * i, 3 * i + 3), ...uvs.slice(2 * i, 2 * i + 2)].map(c => Math.round(c * 1e5)).join();
    if (byKey.has(key)) island[find(i)] = find(byKey.get(key)); else byKey.set(key, i);
  }
  const inside = new Float32Array(uvs.length).fill(NaN);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    island[find(b)] = island[find(c)] = find(a);
    for (const v of [a, b, c]) if (Number.isNaN(inside[2 * v])) for (const k of [0, 1]) inside[2 * v + k] = (uvs[2 * a + k] + uvs[2 * b + k] + uvs[2 * c + k]) / 3;
  }
  const kept = new Uint32Array(simple);
  for (let t = 0; t < kept.length; t += 3) {
    const corners = [kept[t], kept[t + 1], kept[t + 2]], homes = corners.map(find);
    if (homes[0] === homes[1] && homes[0] === homes[2]) continue;
    const from = corners[homes[1] === homes[2] ? 1 : 0];
    for (let k = 0; k < 3; k++) {
      const v = corners[k];
      kept[t + k] = positions.length / 3;
      positions.push(...positions.slice(3 * v, 3 * v + 3));
      normals.push(...normals.slice(3 * v, 3 * v + 3));
      uvs.push(inside[2 * from], inside[2 * from + 1]);
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const accessor = (array, type) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc.createPrimitive().setMaterial(material)
    .setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(new Float32Array(uvs), 'VEC2'))
    .setIndices(accessor(kept, 'SCALAR'));
  scene.addChild(doc.createNode(`prop__${kind}`).setMesh(doc.createMesh(`prop__${kind}`).addPrimitive(prim)));
  propTriangles[kind] = kept.length / 3;
}
// Materials are names only (the game builds its own); merging them by value would lose the names.
await doc.transform(
  unpartition(),
  resample(),
  weld(),
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
  prune({ keepLeaves: true, keepAttributes: true }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await mkdir(path.dirname(glbPath), { recursive: true });
await writeFile(glbPath, await io.writeBinary(doc));
const glbBytes = (await stat(glbPath)).size;
console.log(`wrote ${path.relative(root, glbPath)} (${(glbBytes / 1e6).toFixed(2)} MB)`);

// ---- 3. textures (kept as they are with --glb)
/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per set. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}
const sets = glbOnly ? JSON.parse(await readFile(manifestPath, 'utf8')).sets : {};
for (const name of glbOnly ? [] : SETS) {
  const folder = path.join(build, name);
  if (!existsSync(path.join(folder, `${SIZES[0]}-albedo.rgba`))) continue;
  const bytes = {}, maxSize = MAX_SIZE[name] ?? SIZES.at(-1);
  for (const size of SIZES.filter(s => s <= maxSize)) {
    await mkdir(path.join(textureDir, `${size}`), { recursive: true });
    bytes[size] = [];
    for (const map of MAPS) {
      const raw = new Uint8Array(await readFile(path.join(folder, `${size}-${map}.rgba`)));
      const ktx2 = await quietly(() => encodeToKTX2(raw, {
        isUASTC: false, compressionLevel: 2, generateMipmap: true, isKTX2File: true, ...ENCODE[map],
        imageDecoder: async () => ({ width: size, height: size, data: raw }),
      }));
      await writeFile(path.join(textureDir, `${size}`, `${name}-${map}.ktx2`), ktx2);
      bytes[size].push(ktx2.length);
    }
  }
  sets[name] = { maxSize, bytes };
  const mb = size => (bytes[size] ? (bytes[size].reduce((a, b) => a + b, 0) / 1e6).toFixed(2) : '-');
  console.log(`encoded ${name}: 2048 ${mb(2048)} MB, 1024 ${mb(1024)} MB, 512 ${mb(512)} MB`);
}

// ---- 4. manifest
const models = {}, clips = {};
for (const name of Object.keys(meta)) {
  for (const [model, info] of Object.entries(meta[name].nodes ?? {})) models[model] = { set: name, triangles: info.triangles, total: info.total };
  Object.assign(clips, meta[name].clips ?? {});
}
await writeFile(manifestPath, `${JSON.stringify({ version: 1, glb: glbBytes, sets, models, clips, props: propTriangles }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)}`);

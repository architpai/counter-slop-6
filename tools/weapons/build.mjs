// Regenerate the first-person weapons and arms of the realistic tiers (docs/VISUALS.md, R4).
//
//   node tools/weapons/build.mjs               model and bake every set in Blender, then pack and encode
//   node tools/weapons/build.mjs r4c pistol    only these sets (the others' last build is packed with them)
//   node tools/weapons/build.mjs --pack        pack and encode the last build again (no Blender)
//
// 1. Blender runs tools/blender/weapons/<set>.py for each set, hands and optics first (the guns
//    append the posed hands and preview the optics), into tools/weapons/.build/<set>/: model.glb
//    (nodes, clips and sockets; material names only), raw RGBA8 albedo, normal and ORM maps at
//    2048, 1024 and 512, PNG previews and meta.json (triangles per node, clip lengths, sockets).
// 2. gltf-transform merges the sets' models into public/models/weapons.glb: one scene, the clips
//    resampled (lossless), meshes welded, quantised and meshopt-compressed (EXT_meshopt_compression).
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
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
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
const packOnly = args.includes('--pack');
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

// ---- 3. textures
/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per set. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}
const sets = {};
for (const name of SETS) {
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
await writeFile(manifestPath, `${JSON.stringify({ version: 1, glb: glbBytes, sets, models, clips }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)}`);

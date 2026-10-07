// Regenerate the realistic operators of the Medium, High and Ultra tiers (docs/VISUALS.md, R7).
//
//   node tools/characters/operators.mjs            model, rig, key and bake every kind in Blender, then pack and encode
//   node tools/characters/operators.mjs --pack     pack and encode the last build again (no Blender)
//   node tools/characters/operators.mjs --quick    bake with few samples (to check the pipeline)
//
// 1. Blender runs tools/blender/characters/build.py into tools/characters/.build/: model.glb (every
//    kind's skinned mesh on its armature, the clip rigs with their clips), raw RGBA8 maps of the
//    three texture sets (operator, kit, machine) at 2048, 1024 and 512, previews and meta.json.
// 2. gltf-transform writes public/models/operators.glb (LOD0: High and Ultra) and
//    public/models/operators-lod1.glb (LOD1: Medium, meshoptimizer-simplified): the clips keep their
//    rotation channels only (the game composes them onto its pivots, render/operator-motion.ts),
//    meshes welded, quantised and meshopt-compressed.
// 3. ktx2-encoder writes public/characters/<size>/<set>-<map>.ktx2 (Basis ETC1S with mipmaps).
// 4. src/engine/render/operator-assets.json records the files' sizes, every kind's triangles per LOD
//    and bones, and the clips; the game and tests/operators.test.ts read it.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'tools/blender/characters/build.py');
const build = path.join(root, 'tools/characters/.build');
const glbPaths = [path.join(root, 'public/models/operators.glb'), path.join(root, 'public/models/operators-lod1.glb')];
const textureDir = path.join(root, 'public/characters');
const manifestPath = path.join(root, 'src/engine/render/operator-assets.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const SETS = ['operator', 'kit', 'machine'];
const SIZES = [512, 1024, 2048];
const MAPS = ['albedo', 'normal', 'orm'];
/** As the weapons' (tools/weapons/build.mjs): ETC1S, normals at the codec's normal-map tuning. */
const ENCODE = {
  albedo: { qualityLevel: 200, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { qualityLevel: 255, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  orm: { qualityLevel: 150, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};
/**
 * LOD1 keeps this share of LOD0's triangles, within this error (metres, relative to each mesh's
 * size in gltf-transform's terms): at Medium's 512 maps and 30-60 m, a figure is under 200 pixels tall.
 */
const LOD1 = { ratio: 0.42, error: 0.004 };
/**
 * The masks stay whole in LOD1: their shell's face (the vertices with its faint glow, `_FX` at masks.py
 * `MASK_GLOW`, facing forward) and everything within `MASK_REACH` of it (the paint 2-3.5 mm over it, the teeth, the nose's base) are locked.
 * Simplified, the shell's faces rose through the paint over them (an eye with a hole, the grin's cut split).
 */
const MASK_GLOW = 0.13;
const MASK_REACH = 0.006;

/** Which vertices of a primitive LOD1 keeps where they are: the mask's. */
function maskLock(prim) {
  const position = prim.getAttribute('POSITION'), normal = prim.getAttribute('NORMAL'), fx = prim.getAttribute('_FX');
  const lock = new Uint8Array(position.getCount());
  if (!fx) return lock;
  const cell = p => p.map(v => Math.floor(v / MASK_REACH)).join(',');
  const shell = new Map(), p = [], f = [], n = [];
  for (let i = 0; i < position.getCount(); i++) {
    // The shell's face (its inside, which nothing paints, simplifies as the rest does).
    if (Math.abs(fx.getElement(i, f)[0] - MASK_GLOW) > 0.01 || normal.getElement(i, n)[2] < 0.2) continue;
    const at = position.getElement(i, p).slice();
    const key = cell(at);
    if (!shell.has(key)) shell.set(key, []);
    shell.get(key).push(at);
  }
  if (shell.size === 0) return lock;
  for (let i = 0; i < position.getCount(); i++) {
    const at = position.getElement(i, p);
    const [cx, cy, cz] = at.map(v => Math.floor(v / MASK_REACH));
    search: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const q of shell.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        if (Math.hypot(q[0] - at[0], q[1] - at[1], q[2] - at[2]) <= MASK_REACH) { lock[i] = 1; break search; }
      }
    }
  }
  return lock;
}

/** gltf-transform's simplify per primitive, its mask locked (`maskLock`). */
const simplifyKeepingMasks = doc => {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const lock = maskLock(prim);
      const simplifier = {
        simplify: (indices, positions, stride, target, error) =>
          MeshoptSimplifier.simplifyWithAttributes(indices, positions, stride, new Float32Array(0), 0, [], lock, target, error, []),
      };
      simplifyPrimitive(prim, { simplifier, ratio: LOD1.ratio, error: LOD1.error, lockBorder: false });
    }
  }
};

const args = process.argv.slice(2);
const packOnly = args.includes('--pack');
if (!packOnly) {
  const started = Date.now();
  const result = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', '--out', build, ...(args.includes('--quick') ? ['--quick'] : []), '--preview'],
    { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (result.status !== 0 || !existsSync(path.join(build, 'meta.json'))) {
    process.stderr.write(result.stdout.slice(-20000) + result.stderr.slice(-20000));
    throw new Error('Blender failed on the operators');
  }
  console.log(`built the operators (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const meta = JSON.parse(await readFile(path.join(build, 'meta.json'), 'utf8'));

/** The build's glb as the game loads it, simplified for a LOD past 0. */
async function pack(lod) {
  const doc = await io.read(path.join(build, 'model.glb'));
  // The game composes the clips' rotations onto its own pivots; their translations and scales are the rest pose.
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      if (channel.getTargetPath() !== 'rotation') {
        const sampler = channel.getSampler();
        channel.dispose();
        if (sampler && sampler.listParents().every(p => p === animation)) sampler.dispose();
      }
    }
  }
  // Materials are names only (the game builds its own, render/materials.ts `operatorMaterial`).
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  const steps = [resample(), weld()];
  if (lod > 0) steps.push(simplifyKeepingMasks);
  steps.push(prune({ keepLeaves: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...steps);
  const triangles = {};
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const kind = node.getName().replace(/__body$/, '');
    triangles[kind] = mesh.listPrimitives().reduce((n, prim) => n + (prim.getIndices()?.getCount() ?? 0) / 3, 0);
  }
  await mkdir(path.dirname(glbPaths[lod]), { recursive: true });
  await writeFile(glbPaths[lod], await io.writeBinary(doc));
  const bytes = (await stat(glbPaths[lod])).size;
  console.log(`wrote ${path.relative(root, glbPaths[lod])} (${(bytes / 1e6).toFixed(2)} MB, ${Object.values(triangles).reduce((a, b) => a + b, 0)} triangles)`);
  return { bytes, triangles };
}
const lods = [await pack(0), await pack(1)];

/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per set. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}
const sets = {};
for (const name of SETS) {
  const folder = path.join(build, name);
  if (!existsSync(path.join(folder, `${SIZES[0]}-albedo.rgba`))) throw new Error(`no maps for ${name}: run the Blender build first`);
  const bytes = {};
  for (const size of SIZES) {
    if (!existsSync(path.join(folder, `${size}-albedo.rgba`))) continue;
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
  sets[name] = { bytes };
  const mb = size => (bytes[size] ? (bytes[size].reduce((a, b) => a + b, 0) / 1e6).toFixed(2) : '-');
  console.log(`encoded ${name}: 2048 ${mb(2048)} MB, 1024 ${mb(1024)} MB, 512 ${mb(512)} MB`);
}

const kinds = {};
for (const [kind, info] of Object.entries(meta.kinds)) {
  kinds[kind] = { triangles: [lods[0].triangles[kind], lods[1].triangles[kind]], bones: info.bones.map(([name, parent, at]) => [name, parent, at.map(v => +v.toFixed(5))]) };
}
await writeFile(manifestPath, `${JSON.stringify({ version: 1, glb: lods.map(l => l.bytes), sets, kinds, clips: meta.clips }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)}`);

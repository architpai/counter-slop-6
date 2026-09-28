// Regenerate the realistic tiers' detail kit (docs/VISUALS.md, R6, V14 and V16).
//
//   node tools/props/build.mjs              model every kit and render the atlases in Blender, then pack and encode
//   node tools/props/build.mjs mexico atlas only these scripts (the others' last build is packed with them)
//   node tools/props/build.mjs --pack       pack and encode the last build again (no Blender)
//
// 1. Blender runs tools/blender/props/<script>.py (common, downtown, house, mexico: the kit pieces;
//    atlas: the signs and grime atlases) into tools/props/.build/<script>/: pieces.json and mesh.bin
//    (triangles per piece and texture set), or raw RGBA8 atlases at 256, 128 and 64 texels a cell.
// 2. gltf-transform packs public/props/<family>.glb per map family: the common pieces and the family's
//    own, one node and mesh per piece (named for it), one primitive per texture set (its material
//    named for the set; the game builds its own), welded, quantised and meshopt-compressed.
// 3. ktx2-encoder writes public/props/<size>/<atlas>.ktx2 (Basis ETC1S with mipmaps), where <size> is the
//    Textures setting's size that picks it (512 Medium, 1024 High, 2048 Ultra), as the level's sets; the
//    signs have no 512 (Medium loads their 1024).
// 4. src/engine/render/prop-assets.json records every piece (family, flags, bounds, triangles, sets),
//    each glb's size and the atlases' grids, cell names and sizes; the game and the tests read it.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = path.join(root, 'tools/blender/props');
const build = path.join(root, 'tools/props/.build');
const publicDir = path.join(root, 'public/props');
const manifestPath = path.join(root, 'src/engine/render/prop-assets.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const KITS = ['common', 'downtown', 'house', 'mexico'];
const FAMILIES = ['downtown', 'house', 'mexico'];
const SCRIPTS = [...KITS, 'atlas'];
const ATLASES = ['signs', 'grime'];
/** Texels a cell for each Textures size, as the effect atlases (tools/effects/build.mjs). */
const CELL = { 512: 64, 1024: 128, 2048: 256 };
/** The signs' lettering smears at 64 texels a cell, so Medium loads the 1024 one too (render/props.ts `atlasSize`). */
const SMALLEST = { signs: 1024, grime: 512 };
const ENCODE = { qualityLevel: 200, isPerceptual: true, isSetKTX2SRGBTransferFunc: true };

const args = process.argv.slice(2);
const packOnly = args.includes('--pack');
const wanted = args.filter(a => !a.startsWith('--'));
for (const name of wanted) if (!SCRIPTS.includes(name)) throw new Error(`no script ${name} (${SCRIPTS.join(', ')})`);

if (!packOnly) {
  for (const name of SCRIPTS.filter(s => wanted.length === 0 || wanted.includes(s))) {
    const started = Date.now();
    const done = name === 'atlas' ? ATLASES.map(a => path.join(build, a, 'meta.json')) : [path.join(build, name, 'pieces.json')];
    const result = spawnSync(blender, ['--background', '--factory-startup', '--python', path.join(scripts, `${name}.py`), '--', '--out', build],
      { encoding: 'utf8', maxBuffer: 256 << 20 });
    if (result.status !== 0 || !done.every(file => existsSync(file))) {
      process.stderr.write(result.stdout.slice(-4000) + result.stderr.slice(-4000));
      throw new Error(`Blender failed on ${name}`);
    }
    console.log(`built ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

// ---- 2. one glb per family
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const kits = {};
for (const kit of KITS) {
  const index = JSON.parse(await readFile(path.join(build, kit, 'pieces.json'), 'utf8'));
  const bin = await readFile(path.join(build, kit, 'mesh.bin'));
  kits[kit] = { pieces: index.pieces, data: new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4) };
}
const pieces = {}, glbs = {};
for (const [kit, { pieces: list }] of Object.entries(kits)) {
  for (const [name, info] of Object.entries(list)) {
    if (pieces[name]) throw new Error(`piece ${name} is in two kits`);
    pieces[name] = { kit, small: info.small, backdrop: info.backdrop, min: info.min, max: info.max, triangles: info.triangles,
      sets: info.parts.map(p => p.set) };
  }
}
await mkdir(publicDir, { recursive: true });
for (const family of FAMILIES) {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const scene = doc.createScene(family);
  const materials = new Map();
  const material = set => {
    if (!materials.has(set)) materials.set(set, doc.createMaterial(set));
    return materials.get(set);
  };
  for (const kit of ['common', family]) {
    const { pieces: list, data } = kits[kit];
    for (const [name, info] of Object.entries(list)) {
      const mesh = doc.createMesh(name);
      for (const { set, first, count } of info.parts) {
        const corners = count * 3, at = first * 3 * 11;
        const position = new Float32Array(corners * 3), normal = new Float32Array(corners * 3);
        const uv = new Float32Array(corners * 2), colour = new Float32Array(corners * 3);
        for (let i = 0; i < corners; i++) {
          const o = at + i * 11;
          position.set(data.subarray(o, o + 3), 3 * i);
          normal.set(data.subarray(o + 3, o + 6), 3 * i);
          uv.set(data.subarray(o + 6, o + 8), 2 * i);
          colour.set(data.subarray(o + 8, o + 11), 3 * i);
        }
        // Level UVs run over many tiles, which quantisation cannot hold; a texture tiles, so each primitive's
        // UVs move by whole tiles to start at 0 and scale into 0..1. The game scales them back (`extras.uv`).
        const lo = [0, 1].map(k => Math.floor(Math.min(...uv.filter((_, i) => i % 2 === k))));
        const span = [0, 1].map(k => Math.max(1, Math.ceil(Math.max(...uv.filter((_, i) => i % 2 === k)) - lo[k])));
        for (let i = 0; i < uv.length; i++) uv[i] = (uv[i] - lo[i % 2]) / span[i % 2];
        const accessor = (array, type) => doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
        mesh.addPrimitive(doc.createPrimitive().setMaterial(material(set)).setExtras({ uv: [...lo, ...span] })
          .setAttribute('POSITION', accessor(position, 'VEC3'))
          .setAttribute('NORMAL', accessor(normal, 'VEC3'))
          .setAttribute('TEXCOORD_0', accessor(uv, 'VEC2'))
          .setAttribute('COLOR_0', accessor(colour, 'VEC3')));
      }
      scene.addChild(doc.createNode(name).setMesh(mesh));
    }
  }
  doc.getRoot().setDefaultScene(scene);
  await doc.transform(weld(), prune({ keepLeaves: true, keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizeTexcoord: 14 }));
  const file = path.join(publicDir, `${family}.glb`);
  await writeFile(file, await io.writeBinary(doc));
  glbs[family] = (await stat(file)).size;
  console.log(`wrote ${path.relative(root, file)} (${(glbs[family] / 1e6).toFixed(2)} MB)`);
}

// ---- 3. atlases
/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per atlas. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}
const atlases = {};
for (const atlas of ATLASES) {
  const meta = JSON.parse(await readFile(path.join(build, atlas, 'meta.json'), 'utf8'));
  const bytes = {};
  for (const [size, cell] of Object.entries(CELL)) {
    if (Number(size) < SMALLEST[atlas]) continue;
    const [width, height] = meta.sizes[cell];
    const raw = new Uint8Array(await readFile(path.join(build, atlas, `${width}x${height}.rgba`)));
    const ktx2 = await quietly(() => encodeToKTX2(raw, {
      isUASTC: false, compressionLevel: 2, generateMipmap: true, isKTX2File: true, ...ENCODE,
      imageDecoder: async () => ({ width, height, data: raw }),
    }));
    await mkdir(path.join(publicDir, size), { recursive: true });
    await writeFile(path.join(publicDir, size, `${atlas}.ktx2`), ktx2);
    bytes[size] = ktx2.length;
  }
  atlases[atlas] = { cols: meta.cols, rows: meta.rows, cells: Object.entries(meta.layout).sort((a, b) => a[1][0] - b[1][0]).map(([name]) => name), bytes };
  console.log(`encoded ${atlas}: ${Object.entries(bytes).map(([s, b]) => `${s} ${(b / 1e6).toFixed(2)} MB`).join(', ')}`);
}

// ---- 4. manifest
await writeFile(manifestPath, `${JSON.stringify({ version: 1, glbs, atlases, pieces }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)}`);

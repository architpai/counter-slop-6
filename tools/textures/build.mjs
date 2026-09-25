// Regenerate the realistic tiers' texture library (docs/VISUALS.md, R2).
//
//   node tools/textures/build.mjs              bake every material in Blender, then encode
//   node tools/textures/build.mjs brick sand   only these sets
//   node tools/textures/build.mjs --encode     encode the last bake again (no Blender)
//
// 1. Blender bakes each tools/blender/materials/<set>.py (not lib.py) into tools/textures/.build/<set>/:
//    raw RGBA8 albedo, normal and ORM at 2048, 1024 and 512, previews and meta.json.
// 2. ktx2-encoder (Basis Universal, ETC1S with mipmaps) writes public/textures/<size>/<set>-<map>.ktx2.
// 3. src/engine/render/texture-sets.json gets each set's tile, mean values and file sizes.
// 4. three's Basis transcoder is copied to public/basis/ for KTX2Loader.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = path.join(root, 'tools/blender/materials');
const build = path.join(root, 'tools/textures/.build');
const publicDir = path.join(root, 'public/textures');
const manifestPath = path.join(root, 'src/engine/render/texture-sets.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const SIZES = [512, 1024, 2048];
const MAPS = ['albedo', 'normal', 'orm'];
/**
 * ETC1S for every map: it transcodes to BC7, ASTC or ETC on the GPU and is 5-10x smaller to
 * download than UASTC. Normals get the codec's normal-map tuning and the highest quality level.
 */
const ENCODE = {
  albedo: { qualityLevel: 200, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { qualityLevel: 255, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  orm: { qualityLevel: 180, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};

const args = process.argv.slice(2);
const encodeOnly = args.includes('--encode');
const all = (await readdir(scripts)).filter(f => f.endsWith('.py') && f !== 'lib.py').map(f => f.slice(0, -3)).sort();
const wanted = args.filter(a => !a.startsWith('--'));
for (const name of wanted) if (!all.includes(name)) throw new Error(`no tools/blender/materials/${name}.py`);
const sets = wanted.length > 0 ? wanted : all;

if (!encodeOnly) {
  for (const name of sets) {
    const started = Date.now();
    const result = spawnSync(blender, ['--background', '--factory-startup', '--python', path.join(scripts, `${name}.py`), '--', '--out', build],
      { encoding: 'utf8', maxBuffer: 64 << 20 });
    if (result.status !== 0 || !existsSync(path.join(build, name, 'meta.json'))) {
      process.stderr.write(result.stdout + result.stderr);
      throw new Error(`Blender failed on ${name}`);
    }
    console.log(`baked ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per set. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}

const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { sets: {} };
for (const name of sets) {
  const meta = JSON.parse(await readFile(path.join(build, name, 'meta.json'), 'utf8'));
  const bytes = {};
  for (const size of SIZES) {
    await mkdir(path.join(publicDir, `${size}`), { recursive: true });
    bytes[size] = [];
    for (const map of MAPS) {
      const raw = new Uint8Array(await readFile(path.join(build, name, `${size}-${map}.rgba`)));
      const ktx2 = await quietly(() => encodeToKTX2(raw, {
        isUASTC: false, compressionLevel: 2, generateMipmap: true, isKTX2File: true, ...ENCODE[map],
        imageDecoder: async () => ({ width: size, height: size, data: raw }),
      }));
      await writeFile(path.join(publicDir, `${size}`, `${name}-${map}.ktx2`), ktx2);
      bytes[size].push(ktx2.length);
    }
  }
  manifest.sets[name] = { tile: meta.tile, albedo: meta.albedo, roughness: meta.roughness, metal: meta.metal, ao: meta.ao, bytes };
  const total = bytes[2048].reduce((a, b) => a + b, 0);
  console.log(`encoded ${name}: 2048 ${(total / 1e6).toFixed(2)} MB, 1024 ${(bytes[1024].reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} MB, 512 ${(bytes[512].reduce((a, b) => a + b, 0) / 1e6).toFixed(2)} MB`);
}
// Drop sets whose script is gone, with their files.
for (const name of Object.keys(manifest.sets)) {
  if (all.includes(name)) continue;
  delete manifest.sets[name];
  for (const size of SIZES) for (const map of MAPS) await rm(path.join(publicDir, `${size}`, `${name}-${map}.ktx2`), { force: true });
}
manifest.sets = Object.fromEntries(Object.entries(manifest.sets).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, `${JSON.stringify({ version: 1, sets: manifest.sets }, null, 1)}\n`);

const basis = path.join(root, 'node_modules/three/examples/jsm/libs/basis');
await mkdir(path.join(root, 'public/basis'), { recursive: true });
for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(path.join(basis, file), path.join(root, 'public/basis', file));
console.log(`wrote ${path.relative(root, manifestPath)} (${Object.keys(manifest.sets).length} sets)`);

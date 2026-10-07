// Regenerate the realistic tiers' effect atlases (docs/VISUALS.md, R5).
//
//   node tools/effects/build.mjs              render every atlas in Blender, then encode
//   node tools/effects/build.mjs fire decals  only these scripts (the others' last build is encoded with them)
//   node tools/effects/build.mjs --encode     encode the last build again (no Blender)
//
// 1. Blender runs tools/blender/effects/<script>.py (fire, smoke, decals) into tools/effects/.build/<atlas>/:
//    raw RGBA8 at 256, 128 and 64 texels a cell (Ultra, High, Medium), PNG previews and meta.json (grid, layout).
// 2. ktx2-encoder (Basis ETC1S with mipmaps) writes public/fx/<size>/<atlas>.ktx2, where <size> is the
//    Textures setting's size (2048, 1024, 512) that picks it, as the level's texture sets do.
// 3. src/engine/render/fx-assets.json records each atlas's grid, cell layout and file sizes; the game and
//    the tests read it.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scripts = path.join(root, 'tools/blender/effects');
const build = path.join(root, 'tools/effects/.build');
const publicDir = path.join(root, 'public/fx');
const manifestPath = path.join(root, 'src/engine/render/fx-assets.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
const SCRIPTS = { fire: ['fire'], smoke: ['smoke'], decals: ['decals', 'decals-normal'] };
/** Texels a cell for each Textures size: the level's 512 / 1K / 2K tiers (Medium, High, Ultra). */
const CELL = { 512: 64, 1024: 128, 2048: 256 };
const ENCODE = {
  colour: { qualityLevel: 190, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { qualityLevel: 255, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
};

const args = process.argv.slice(2);
const encodeOnly = args.includes('--encode');
const wanted = args.filter(a => !a.startsWith('--'));
for (const name of wanted) if (!SCRIPTS[name]) throw new Error(`no script ${name} (${Object.keys(SCRIPTS).join(', ')})`);

if (!encodeOnly) {
  for (const name of Object.keys(SCRIPTS).filter(s => wanted.length === 0 || wanted.includes(s))) {
    const started = Date.now();
    const result = spawnSync(blender, ['--background', '--factory-startup', '--python', path.join(scripts, `${name}.py`), '--', '--out', build],
      { encoding: 'utf8', maxBuffer: 256 << 20 });
    if (result.status !== 0 || !SCRIPTS[name].every(atlas => existsSync(path.join(build, atlas, 'meta.json')))) {
      process.stderr.write(result.stdout.slice(-4000) + result.stderr.slice(-4000));
      throw new Error(`Blender failed on ${name}`);
    }
    console.log(`rendered ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per atlas. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}

const atlases = {};
let total = { 512: 0, 1024: 0, 2048: 0 };
for (const atlas of Object.values(SCRIPTS).flat()) {
  const meta = JSON.parse(await readFile(path.join(build, atlas, 'meta.json'), 'utf8'));
  const bytes = {};
  for (const [size, cell] of Object.entries(CELL)) {
    const [width, height] = meta.sizes[cell];
    const raw = new Uint8Array(await readFile(path.join(build, atlas, `${width}x${height}.rgba`)));
    const ktx2 = await quietly(() => encodeToKTX2(raw, {
      isUASTC: false, compressionLevel: 2, generateMipmap: true, isKTX2File: true, ...(meta.srgb ? ENCODE.colour : ENCODE.normal),
      imageDecoder: async () => ({ width, height, data: raw }),
    }));
    await mkdir(path.join(publicDir, size), { recursive: true });
    await writeFile(path.join(publicDir, size, `${atlas}.ktx2`), ktx2);
    bytes[size] = ktx2.length;
    total[size] += ktx2.length;
  }
  atlases[atlas] = { cols: meta.cols, rows: meta.rows, alpha: meta.alpha, srgb: meta.srgb, layout: meta.layout, bytes };
  console.log(`encoded ${atlas}: ${Object.entries(bytes).map(([s, b]) => `${s} ${(b / 1e6).toFixed(2)} MB`).join(', ')}`);
}
await writeFile(manifestPath, `${JSON.stringify({ version: 1, atlases }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)}: ${Object.entries(total).map(([s, b]) => `${s} ${(b / 1e6).toFixed(2)} MB`).join(', ')}`);

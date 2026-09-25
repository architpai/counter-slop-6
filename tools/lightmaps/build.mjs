// Regenerate every map's baked lighting (docs/VISUALS.md, R3; README.md in this folder).
//
//   node tools/lightmaps/build.mjs                 export, bake in Blender and encode every map
//   node tools/lightmaps/build.mjs house mexico    only these bakes
//   node tools/lightmaps/build.mjs --encode        encode the last bake again (no Blender)
//   node tools/lightmaps/build.mjs --quick         a few samples per texel, to check the pipeline
//
// 1. export.ts builds each map with the game's own code (Node, TypeScript as is) and writes its
//    static geometry, lightmap UVs and probe grid to tools/lightmaps/.build/<name>/.
// 2. Blender (tools/blender/bake_level.py) bakes the lightmap, AO map and probe grid with Cycles.
// 3. ktx2-encoder writes public/maps/<name>/light-2048.ktx2 (3 mip levels), light-1024.ktx2 (2) and
//    ao-512.ktx2 (1): UASTC with RDO and Zstandard, sRGB, each mip level encoded from
//    the bake's own box-filtered level (the encoder's mip filter is wider than a chart's padding),
//    and probes.bin (the probe grid, gzip).
// 4. src/engine/render/lightmaps.json gets each bake's hash, layout, scales, file sizes and time.
// Environment: BLENDER=/path/to/blender (default /opt/homebrew/bin/blender).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { encodeToKTX2 } from 'ktx2-encoder';
import { read, write } from 'ktx-parse';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(root, 'tools/lightmaps/.build');
const manifestPath = path.join(root, 'src/engine/render/lightmaps.json');
const blender = process.env.BLENDER ?? '/opt/homebrew/bin/blender';
/** Each file: its size and how many levels it keeps (render/lightmap.ts `bakeMips`). */
const FILES = { 'light-2048': [2048, 3], 'light-1024': [1024, 2], 'ao-512': [512, 1] };
/** UASTC: RDO trades a little error for a much better Zstandard ratio; smooth light hides it. */
const ENCODE = { isUASTC: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1, needSupercompression: true,
  isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: false, isKTX2File: true };

const args = process.argv.slice(2);
const names = args.filter(a => !a.startsWith('--'));
const encodeOnly = args.includes('--encode');

function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`${path.basename(command)} failed`);
  }
  return result.stdout;
}

if (!encodeOnly) {
  const exported = run(process.execPath, ['--no-warnings', '--experimental-transform-types', '--import', './tools/lightmaps/register.mjs',
    'tools/lightmaps/export.ts', ...names]);
  process.stdout.write(exported);
  const bakes = names.length > 0 ? names : [...exported.matchAll(/^EXPORT ([\w-]+):/gm)].map(m => m[1]);
  for (const name of bakes) {
    const baked = run(blender, ['--background', '--factory-startup', '--python', 'tools/blender/bake_level.py', '--', name,
      ...(args.includes('--quick') ? ['--quick'] : [])]);
    process.stdout.write(baked.split('\n').filter(line => line.startsWith('BAKE')).join('\n') + '\n');
  }
}

/** The Basis encoder prints its progress from WebAssembly; keep the log to one line per file. */
async function quietly(task) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try { return await task(); } finally { process.stdout.write = write; }
}

/** Encode each level on its own, then put the levels in one container. */
async function encodeLevels(dir, file, size, levels) {
  const containers = [];
  for (let level = 0; level < levels; level++) {
    const side = size >> level;
    const raw = new Uint8Array(await readFile(path.join(dir, `${file}-L${level}.rgba`)));
    const ktx2 = await quietly(() => encodeToKTX2(raw, { ...ENCODE, imageDecoder: async () => ({ width: side, height: side, data: raw }) }));
    containers.push(read(ktx2));
  }
  const container = containers[0];
  container.levels = containers.map(c => c.levels[0]);
  container.levelCount = levels;
  return write(container);
}

const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { version: 1, size: 2048, bakes: {} };
const wanted = names.length > 0 ? names : Object.keys(manifest.bakes).concat(
  (await import('node:fs')).readdirSync(build).filter(d => existsSync(path.join(build, d, 'bake.json'))));
for (const name of [...new Set(wanted)]) {
  const dir = path.join(build, name);
  const spec = JSON.parse(await readFile(path.join(dir, 'mesh.json'), 'utf8'));
  const bake = JSON.parse(await readFile(path.join(dir, 'bake.json'), 'utf8'));
  const out = path.join(root, 'public/maps', name);
  await mkdir(out, { recursive: true });
  const bytes = {};
  for (const [file, [size, levels]] of Object.entries(FILES)) {
    const data = await encodeLevels(dir, file, size, levels);
    await writeFile(path.join(out, `${file}.ktx2`), data);
    bytes[file] = data.length;
  }
  const probes = gzipSync(await readFile(path.join(dir, 'probes.rgba')), { level: 9 });
  await writeFile(path.join(out, 'probes.bin'), probes);
  bytes.probes = probes.length;
  manifest.bakes[name] = {
    map: spec.map, arena: spec.arena, hash: spec.hash, density: spec.density, triangles: spec.triangles, charts: spec.charts.length,
    rows: spec.rows, scale: bake.scale, aoScale: bake.aoScale, probeScale: bake.probeScale, grid: spec.grid, bytes,
    sky: bake.sky, sun: bake.sun, seconds: bake.seconds, samples: bake.samples, device: bake.device,
  };
  const mb = n => (n / 1e6).toFixed(2);
  console.log(`encoded ${name}: light 2048 ${mb(bytes['light-2048'])} MB, 1024 ${mb(bytes['light-1024'])} MB, ao ${mb(bytes['ao-512'])} MB, `
    + `probes ${mb(bytes.probes)} MB (bake ${bake.seconds} s${bake.quick ? ', QUICK' : ''})`);
}
manifest.bakes = Object.fromEntries(Object.entries(manifest.bakes).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestPath, `${JSON.stringify({ version: 1, size: manifest.size, bakes: manifest.bakes }, null, 1)}\n`);
console.log(`wrote ${path.relative(root, manifestPath)} (${Object.keys(manifest.bakes).length} bakes)`);

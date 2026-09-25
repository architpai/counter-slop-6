# Baked lighting (R3)

Each map's static level carries light baked in Cycles under that map's own physical sky and sun
(`public/sky/<map>/`): sky light and every bounce, the sun's included, but not the sun's direct light,
which the game draws with its dynamic sun and shadow maps. A probe grid of the same light lights what
moves (enemies, the view model, Mexico's props). Nothing is downloaded or hand-painted.

## Regenerate everything

```sh
npm run lightmaps                     # export, bake and encode every map (about 6 minutes on an M4 Pro)
npm run lightmaps -- house mexico     # only these bakes
npm run lightmaps -- --encode         # encode the last bake again, without Blender
npm run lightmaps -- --quick house    # a few samples per texel, to check the pipeline
```

Re-bake after any change to a map's static geometry or materials (`tests/lightmaps.test.ts` fails until
you do: it compares each map's geometry hash with its bake's), and after re-rendering a sky
(`tools/blender/sky.py`; the test compares the sun too). Needs Node 24 (it runs the game's TypeScript as
is), Blender 5.x (`BLENDER=/path/to/blender`, default `/opt/homebrew/bin/blender`; Cycles uses the GPU
when Blender finds one) and the `ktx2-encoder` and `ktx-parse` dev dependencies. `tools/lightmaps/build.mjs`:

1. **Export** (`export.ts`, through `register.mjs`/`hooks.mjs` so Node resolves the game's imports):
   builds every map and variant with the game's own `LevelBuilder` (downtown, downtown's arena, house,
   mexico, training; the other arenas share their map's geometry and bake), lays out the lightmap charts
   with the game's own packer (`src/engine/render/lightmap.ts`) at the highest density that fits a
   2048² atlas, and writes `tools/lightmaps/.build/<name>/mesh.bin` and `mesh.json` (git-ignored):
   world-space triangles, their `uv1`, each material's linear albedo, which pieces are decals (thinner
   than 3 cm: baked, but they neither shade nor light), the charts' cells, and the probe grid's box.
2. **Bake** (`tools/blender/bake_level.py`): two Cycles passes (every indirect path with the sun; then
   direct light with the sun hidden, the sky's own), OIDN through the compositor with each chart's cell
   as albedo and its normal as aux images, each chart pushed out into its own padding, and three
   outputs: the lightmap (white-surface radiance), the AO map (that light over the sky probe's for the
   same face) and the probe grid (an ambient cube per cell, and the cell's share of sun).
3. **Encode**: `public/maps/<name>/light-2048.ktx2` (3 mip levels), `light-1024.ktx2` (2) and
   `ao-512.ktx2` (1): UASTC with RDO and Zstandard, sRGB of value / scale, each mip level encoded
   from the bake's own box-filtered level; and `probes.bin` (gzip).
4. **Manifest**: `src/engine/render/lightmaps.json`: per bake the geometry hash, density, chart count,
   atlas rows, scales, probe grid, sky, file sizes, samples and bake time.

Commit the regenerated `public/maps/<name>/` and `lightmaps.json`. `tools/lightmaps/.build/<name>/light.png`
is a preview of the atlas.

## Which tier shows what

The Textures setting picks the file, as it picks the texture size: low (Medium) the AO map, medium
(High) the 1K lightmap, high (Ultra) the 2K one. Every realistic tier takes the probe grid.

# Material texture library (R2)

The realistic tiers' texture sets. Every set is a Blender procedural node graph in this folder, baked
headless with Cycles. Nothing is downloaded: no image, scan or HDRI is read from disk.

## Regenerate everything

```sh
npm run textures                      # bake all 28 sets in Blender, then encode (about 10 minutes)
npm run textures -- brick sand        # only these sets
npm run textures -- --encode          # encode the last bake again, without Blender
```

`tools/textures/build.mjs` needs Blender 5.x (`BLENDER=/path/to/blender`, default
`/opt/homebrew/bin/blender`) and the `ktx2-encoder` dev dependency. It:

1. runs `blender --background --factory-startup --python <set>.py -- --out tools/textures/.build` for
   each script (not `lib.py`). The bake writes raw RGBA8 albedo, normal and ORM maps at 2048, 1024 and
   512, PNG previews and a `meta.json` into `tools/textures/.build/<set>/` (git-ignored);
2. encodes each map to KTX2 (Basis Universal ETC1S, with mipmaps) as
   `public/textures/<size>/<set>-<map>.ktx2`;
3. writes `src/engine/render/texture-sets.json`: each set's tile size, mean albedo, roughness,
   metalness and AO, and the file sizes (the game's stand-ins, tints and budget test read it);
4. copies three's Basis transcoder into `public/basis/` for `KTX2Loader`.

Commit the regenerated `public/textures/`, `public/basis/` and `texture-sets.json`.

To look at one set alone: `blender --background --factory-startup --python tools/blender/materials/brick.py -- --size 512`
and open `tools/textures/.build/brick/preview-*.png`.

## How a script works

`lib.py` has the shared parts; a script only builds its graph:

```python
TILE = 0.9          # metres one tile covers in the game

def build(g):       # g: lib.Graph; methods take numbers or sockets and return sockets
    ...
    return {'albedo': colour, 'roughness': value, 'metal': value, 'height': metres}

lib.run('brick', TILE, build, ao_radius=0.03, ao_depth=0.006)
```

- **Tiling.** `g.noise` and `g.voronoi` sample 4D textures on a flat torus (u around one circle, v
  around the other), so they repeat seamlessly; `fu`/`fv` are about the features per tile along u
  and v. Patterns made from UV maths (`g.cells`, `g.edge`: bricks, planks, tiles) use whole counts per
  tile. `g.white(cell ids)` gives a random value per brick or board.
- **Bake.** Four Cycles EMIT bakes of a 1 x 1 plane (albedo in linear RGB, roughness, metalness,
  height in metres). Numpy then derives the normal map from the height's slopes and an AO (cavity)
  term from how far each texel sits below its blurred neighbourhood, both wrapping at the tile edges,
  and box-filters the 2048 bake to 1024 and 512.
- **Conventions.** Rows are stored bottom first (row 0 is v = 0), as WebGL uploads with flipY off;
  normals are tangent space with +x along u and +y along v (three.js / OpenGL). ORM is occlusion in
  red, roughness in green, metalness in blue. Albedo is sRGB; the game tints each set to a tag's colour
  (`render/palette.ts`, `MATERIAL_COLOR`) by dividing by the set's mean, so keep contrast moderate and
  the mean near the material's typical colour.
- **Game side.** `TILE` feeds the UVs (`render/surfaces.ts`, `planarUVs`). A new set also needs an entry in
  `TEXTURE_SETS` and at least one tag in `MATERIAL_SET`; `tests/materials.test.ts` checks the rest.

## Sizes (KTX2 files, all three maps)

| Set | Tile (m) | 512 | 1024 | 2048 |
|---|---|---|---|---|
| asphalt | 4 | 0.09 MB | 0.34 MB | 1.56 MB |
| brick | 0.9 | 0.12 | 0.40 | 1.34 |
| cast-concrete | 2.4 | 0.04 | 0.16 | 0.58 |
| concrete | 3 | 0.13 | 0.43 | 1.47 |
| corrugated | 1.2 | 0.04 | 0.13 | 0.35 |
| fabric | 0.5 | 0.10 | 0.39 | 1.56 |
| foliage | 1.5 | 0.22 | 0.67 | 2.29 |
| glass | 2 | 0.03 | 0.08 | 0.17 |
| grass | 3 | 0.13 | 0.55 | 2.21 |
| paint | 1 | 0.06 | 0.23 | 0.76 |
| painted-metal | 1.5 | 0.07 | 0.25 | 0.87 |
| paving | 2.4 | 0.07 | 0.29 | 1.26 |
| planks | 2.4 | 0.04 | 0.10 | 0.36 |
| plaster | 2 | 0.10 | 0.35 | 1.30 |
| road-paint | 2 | 0.02 | 0.26 | 1.41 |
| roof-tile | 1.2 | 0.10 | 0.39 | 1.58 |
| rust | 1.5 | 0.16 | 0.52 | 1.97 |
| sand | 4 | 0.04 | 0.27 | 1.41 |
| sandstone | 4 | 0.13 | 0.50 | 1.92 |
| shingles | 1.2 | 0.09 | 0.44 | 1.95 |
| siding | 1.2 | 0.03 | 0.07 | 0.20 |
| steel | 1 | 0.08 | 0.22 | 0.66 |
| stucco | 2 | 0.12 | 0.46 | 1.67 |
| terracotta | 1 | 0.09 | 0.41 | 1.65 |
| tile | 1.2 | 0.03 | 0.07 | 0.22 |
| tread-plate | 0.6 | 0.06 | 0.15 | 0.43 |
| water | 4 | 0.03 | 0.11 | 0.39 |
| wood | 1.5 | 0.09 | 0.29 | 0.96 |

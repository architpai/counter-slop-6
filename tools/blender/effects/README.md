# Effect atlases (R5)

The realistic tiers' combat effects: flipbooks, debris sprites and bullet-hole decals. Every cell is
made in Blender from procedural volumes, procedurally displaced meshes or procedural node graphs,
headless. Nothing is downloaded: no image, scan, simulation cache or HDRI is read from disk.

## Regenerate everything

```sh
npm run effects                       # render all three scripts in Blender, then encode (about 1.5 minutes)
npm run effects -- fire decals        # only these scripts (the others' last build is encoded with them)
npm run effects -- --encode           # encode the last build again, without Blender
```

`tools/effects/build.mjs` needs Blender 5.x (`BLENDER=/path/to/blender`, default
`/opt/homebrew/bin/blender`) and the `ktx2-encoder` dev dependency. It:

1. runs `blender --background --factory-startup --python <script>.py -- --out tools/effects/.build`
   for `fire.py`, `smoke.py` and `decals.py`. Each writes raw RGBA8 atlases at 256, 128 and 64 texels
   a cell (Ultra, High, Medium), PNG previews and a `meta.json` (grid and cell layout) into
   `tools/effects/.build/<atlas>/` (git-ignored);
2. encodes each atlas to KTX2 (Basis Universal ETC1S, with mipmaps) as `public/fx/<size>/<atlas>.ktx2`,
   where `<size>` is the Textures setting's size that picks it (512 Medium, 1024 High, 2048 Ultra);
3. writes `src/engine/render/fx-assets.json`: each atlas's grid, cell layout and file sizes (the
   game reads the layout from it; `tests/fx.test.ts` checks it, the files and the 4 MB Ultra budget).

Commit the regenerated `public/fx/` and `fx-assets.json`.

To look at one script alone: `blender --background --factory-startup --python tools/blender/effects/fire.py -- --out /tmp/fx`
and open `/tmp/fx/fire/preview.png`.

## The atlases

| Atlas | Grid | Cells | Made from |
|---|---|---|---|
| `fire` (RGB, additive) | 8 x 4 | fireball flipbook (16), muzzle flash down the barrel (4) and from the side (4), sparks (4), the one-frame glow of a blast | Cycles renders of emission volumes: 4D noise shaping the density, blackbody colour. Each flash is one 3D field rendered from both ends, so its front and side views agree. |
| `smoke` (RGBA, lit) | 8 x 6 | smoke puff flipbook (16), dust burst flipbook (16), stone chips (8), wood splinters (4), glass shards (4) | Cycles renders of scattering volumes lit by a sun and a grey sky (denoised), and of meshes displaced by Blender's procedural textures |
| `decals` (RGBA) and `decals-normal` (RGB) | 4 x 4 | bullet holes for metal (2), masonry (3), wood (3), glass (2) and soft ground (2), a scorch mark | EMIT bakes of node graphs over a plane: albedo, alpha and height; the normal map from the height in numpy, faded out with the alpha |

- **Conventions.** Rows are stored bottom first (row 0 is v = 0), as WebGL uploads with flipY off;
  cell `i` sits at column `i % cols`, row `i / cols` from the bottom. Colour is sRGB, alpha linear
  and straight (the colour of a nearly clear texel is its neighbourhood's, so mips and filtering
  pull in no dark fringe). The fire atlas is normalised per group (its brightest texel is 1); the
  game sets each effect's intensity. Everything is near neutral: the game tints debris, dust and
  holes with the hit surface's colour (`render/impacts.ts`). The masonry, wood and soil holes are
  grey at their rim (`SURFACE_GREY` in `decals.py`, `DECAL_GREY` in `effects-real.ts`, kept equal):
  the game's tint is the surface's colour over that grey, so a rim is its wall's own colour and only
  the darker crater and hole read (a wood hole's torn rim a little lighter). Their outer crater fades
  into the wall, since the wall's baked light and the decal's probe light differ in shade.
- **Scripts.** `lib.py` has the scene set-up, the expression wrapper for node graphs
  (`VolumeGraph`: `g.smooth(r, 0.4, 0.9) * g.noise(g.p, 3, w)`), the renderer, the plane baker and
  the atlas writer; each script only builds its fields and meshes.
- **Game side.** `render/fx.ts` streams the atlases (`FxAssets`) and names the cells (`cells`);
  `effects-real.ts` draws them. A new cell run needs a `LAYOUT` entry in its script; the game finds
  it by name.

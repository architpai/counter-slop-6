# Detail kit (R6, V14, V16)

The realistic tiers' map dressing: the props that make the maps read as built, lived-in places
(doors and windows for closed walls, AC units, pipes, gutters, lamps, vents, signs, posters, crates,
pallets, drums, bags, litter, fences, awnings, cars, garden things, adobe vigas, canales and niches),
the backdrops beyond the play space (Downtown's skyline, Mexico's faceted mesas, House's treeline and
distant houses), the grapple drone, and two atlases: `signs` (shop and street signs, posters, tiles
and pictures with original text and art) and `grime` (multipliers for stains, leaks, cracks, road
patches, covers, soot, moss, graffiti, ground stains, dried puddles, gum, fallen leaves, tyre tracks,
dirt against an edge, drifted sand, scuffs, wide cracks, a water line, rain streaks, plaster cracks,
joint grime, a burn, bare earth, footprints). Everything is made here from code: Blender's modifiers and
its built-in font, numpy noise. Nothing is downloaded or hand-painted. Low never loads any of it.

## Regenerate everything

```sh
npm run props                       # model every kit and render both atlases in Blender, then pack and encode (about 20 s)
npm run props -- mexico atlas       # only these scripts (the others' last build is packed with them)
npm run props -- --pack             # pack and encode the last build again, without Blender
```

`tools/props/build.mjs` needs Blender 5.x (`BLENDER=/path/to/blender`, default
`/opt/homebrew/bin/blender`) and the `@gltf-transform/*`, `meshoptimizer` and `ktx2-encoder` dev
dependencies. It:

1. runs `blender --background --factory-startup --python <script>.py -- --out tools/props/.build` for
   `common.py`, `downtown.py`, `house.py`, `mexico.py` (the pieces: `pieces.json` and `mesh.bin`,
   triangles per piece and texture set) and `atlas.py` (raw RGBA8 atlases at 256, 128 and 64 texels a
   cell and a `meta.json`), into `tools/props/.build/` (git-ignored);
2. packs `public/props/<family>.glb` for each map family: the common pieces and the family's own, one
   node and mesh per piece named for it, one primitive per texture set (its material named for the
   set: the game builds its own), welded, quantised and meshopt-compressed. Level UVs run over many
   tiles, which quantisation cannot hold, so each primitive's UVs move by whole tiles to start at 0 and
   scale into 0..1, and `extras.uv` records how to scale them back;
3. encodes both atlases to KTX2 (Basis ETC1S with mipmaps) as `public/props/<size>/<atlas>.ktx2`,
   `<size>` the Textures setting's size that picks it (512 Medium, 1024 High, 2048 Ultra); the signs have
   no 512, Medium loads their 1024 (at 64 texels a cell a shop sign's lettering smears);
4. writes `src/engine/render/prop-assets.json`: every piece's kit, flags, bounds, triangles and sets,
   each glb's size, and the atlases' grids, cell names and sizes. The game and the tests read it
   (`tests/dressing.test.ts` checks the files, the 8 MB budget at Ultra for every map together and
   each map's total under 60 MB).

Commit the regenerated `public/props/` and `prop-assets.json`. To look at one script alone:
`blender --background --factory-startup --python tools/blender/props/common.py -- --out /tmp/props --preview`
and open `/tmp/props/common/preview.png` (a Workbench contact sheet).

## Conventions

- **Frame.** Pieces are authored in three.js's frame, in metres (`lib.py` turns them into Blender's
  only to run its modifiers): +y up; a wall piece's back is its wall at z = 0, its front +z, its origin
  the bottom middle of its back; a floor piece stands on its origin; a hanging piece (lantern, ristra,
  ceiling light) hangs from its origin. Wall pieces stay within 0.12 m of their wall below head height
  (level/dressing.ts `WALL_DEPTH`): the maps' walkers never come nearer.
- **Materials.** Each part wears one of the level's texture sets (`render/surfaces.ts`
  `TEXTURE_SETS`), so a prop's concrete, steel or planks match the walls' and stream with them, and a
  vertex colour: the linear albedo the part averages to. The game's material is white over the set's
  mean, so the vertex colour is the colour; a placement's `tint` multiplies over it (the drums, doors,
  awnings and cars are light, to take any paint). UVs are the level's planar ones (per triangle, in
  metres over the set's tile). A sign's or poster's face (`sign=True`) is the `signs` set instead: 0..1
  over the face, which the game maps to the placement's cell.
- **Flags.** Pieces merge per 32 m cell (so the camera and each shadow cascade draw only the cells in
  view); `small` pieces are hidden beyond 48 m and cast no shadow; `backdrop` pieces stand beyond the
  play space, lit by the sky probe alone, casting nothing, merged into one mesh. Floor pieces the maps
  set down inside the play space stand only where the walker grid leaves room (`Dresser.propIfClear`);
  the rest are under 13 cm tall (litter, leaves, stones), within 12 cm of a wall below head height,
  overhead, or beyond where anyone walks.
- **Atlases.** Rows bottom first, cell `i` at column `i % cols`, row `i / cols` (as the effect atlases,
  whose `write_atlas` is reused). The maps pick cells by name (`render/props.ts` `atlasCell`). Grime is
  a multiplier: white leaves the face under it as it is, and every cell but the edge dirt (dark along
  the edge it is laid against) fades to white at its border.

## The pieces

| Script | Pieces |
|---|---|
| `common.py` | crate, small crate, pallet, oil drum, rubbish bags, flattened boxes, rubble, litter, fallen leaves, split AC unit, roof condenser, roof and wall vents, drainpipe (1 m, scaled), gutter (1 m), meter box, wall lamp, sign board, poster, picture frame, window with frame, glass and sill, metal and wooden doors in frames, welded fence, traffic cone, pipe run (1 m), ceiling fitting, bench, wooden planter, concrete planter, street bin, flower pot, steel shelving, radiator, switch plate, conduit (1 m, scaled), wall clock, the grapple drone (delta body, four ducted rotors, a yellow hook ring at the mover's origin) |
| `downtown.py` | shop awning, roof antenna, water tank, five skyline blocks with window bands (backdrop) |
| `house.py` | hatchback, wheelie bin, picket fence, hedge, mailbox, barbecue, clown garden gnome, push mower, hose reel, tree, far treeline clump and distant house (backdrop) |
| `mexico.py` | viga, canal, niche with a candle, ristra of chillies, tin lantern, hanging flower pot, clay jar, grain sacks, crate of fruit, loose stones, three faceted, stepped and banded mesas (backdrop) |
| `atlas.py` | `signs` 8 × 4 and `grime` 8 × 4 |

Where they go is each map's dressing (`src/engine/level/*-dressing.ts`, docs/ARCHITECTURE.md §6.5).

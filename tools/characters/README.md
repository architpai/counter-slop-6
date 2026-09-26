# Character model file (V12)

`public/models/tactical.glb` holds the player and all 22 enemies (see `assets/models/README.md` for the
models themselves). Blender's export of it is 10.4 MB and 238k triangles; the game ships it optimised
to about 1.1 MB and 115k triangles. Nothing is downloaded or hand-edited: `tools/characters/build.mjs`
rebuilds the file from the export.

## Rebuild

```sh
blender -b --python assets/models/build_tactical.py   # the raw export, into public/models/tactical.glb
npm run characters                                    # optimise it in place
npm run characters -- --in raw.glb                    # or from a raw export elsewhere
npm run characters -- --dry                           # report only
```

A file the script wrote carries `asset.extras.characters` and is not optimised twice. The script needs
the dev dependencies `@gltf-transform/*` and `meshoptimizer`, and no Blender. It:

1. drops `TEXCOORD_0` (the characters wear flat PBR colours, no texture) and the 132 triangles with no
   area (under 1e-10 m², in the goggles' and the view tab's thin plates);
2. simplifies every mesh with meshoptimizer to 2 mm of geometric error, below a pixel at the closest
   the game frames a figure (the model check's portrait), and the detail no figure shows at play
   distance (antenna tips, cheek vents, curled fingers, teeth) to 4 mm, their outlines kept. The mask
   shell goes from 4,140 to about 630 triangles, under the 4 mm its paint sits above it, so no brow or
   tear sinks into it (a 420-triangle shell covered the brows). Its open edges (the outline and the eye
   holes) are locked and its shading weighs ten times a plain smooth part's: at 520 triangles without
   them the chin's edge came out notched in two lobes, the eye holes lost their ovals and the inner
   faces showed creases. Flat-shaded parts are simplified on their positions
   and get their face normals back; smooth ones keep their own normals (weighed in, so a kept vertex's
   normal suits the larger faces) and their seams;
3. welds, shares identical meshes (the L/R copies and the parts every kind wears), and writes
   quantised, meshopt-compressed geometry (`KHR_mesh_quantization`, `EXT_meshopt_compression`);
4. writes `src/engine/render/character-assets.json`: the file's size and SHA-256, and its triangles
   per kind, which `tests/characters.test.ts` holds the file to (2 MB at most).

## At load

`src/engine/render/tactical.ts` merges each part (`<kind>__<part>-surface`, the tree of material batches
the exporter writes) into one mesh per rigid pivot: every material's colour, roughness, metalness and
glow move into vertex attributes and one material draws them all (`characterMat`). The nodes the game
moves while it plays (the carrier's payload, the aimbot's vent, the moderator's ring, the ragequit's
cleaver) stay nodes of their own. A humanoid is 11 meshes and its prop, and only its body, head and
legs cast shadows.

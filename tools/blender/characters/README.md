# Realistic operators (R7)

The Medium, High and Ultra tiers' characters: every enemy kind and the remote player's operator, as
skinned Blender models with keyframed clips, and their three texture sets. Every mesh, weight, clip
and texture is made by the Python scripts in this folder, run headless in Blender. Nothing is
downloaded: no model, image, scan or HDRI is read from disk. Low keeps the optimised flat models
(`public/models/tactical.glb`, `tools/characters/README.md`) and never loads any of this.

## Regenerate everything

```sh
npm run operators                    # model, weight, key and bake every kind in Blender, then pack and encode (about 8 minutes)
npm run operators -- --pack          # pack and encode the last build again, without Blender
npm run operators -- --quick         # bake with a few samples, to check the pipeline
```

`tools/characters/operators.mjs` needs Blender 5.x (`BLENDER=/path/to/blender`, default
`/opt/homebrew/bin/blender`) and the dev dependencies `ktx2-encoder`, `@gltf-transform/*` and
`meshoptimizer`. It runs `build.py` into `tools/characters/.build/` (git-ignored: `model.glb`,
the maps as raw RGBA8 at 2048, 1024 and 512, `meta.json`, and a front, three-quarter and back
preview of every kind with its baked maps, `preview-<kind>-<n>.png`), then writes
`public/models/operators.glb` (LOD0), `public/models/operators-lod1.glb` (LOD1, meshoptimizer
simplified to 42 %, the masks locked), `public/characters/<size>/<set>-<map>.ktx2` (Basis ETC1S) and
`src/engine/render/operator-assets.json` (sizes, triangles per kind and LOD, bones, clips), which the
game and `tests/operators.test.ts` read. Commit those. One kind alone, without baking (seconds):

```sh
blender --background --factory-startup --python tools/blender/characters/build.py -- --no-bake --preview --only grunt,medic --out /tmp/op
```

## The scripts

- `sdf.py`: signed distance fields in numpy (ellipsoids, round cones, rounded boxes, smooth union
  and cut) and a surface-nets mesher. The soft shapes (trousers, shirt, head, boots, pouches,
  hoods, cap, helmets, the ghillie) are unions of primitives blended with a smooth minimum, meshed,
  smoothed and decimated, so muscles, cloth and joints flow into each other like a sculpt.
- `core.py`: game-space helpers (`G()`: game +Y up, +Z forward, to Blender's axes), the finishes,
  mesh builders (bevelled boxes, lathes, rings, curved plates, straps), vertex colours, the rig,
  clips and export. It imports the weapon scripts' helpers (`tools/blender/weapons/lib.py`) for the
  bake, bevels and booleans.
- `body.py`: the operator's clothed body on the game's pivots (width 1), gloves from the first-person
  hands' soft parts (`tools/blender/weapons/hands.py`) posed round the gun's grip and the support
  hold, the bone weights, and `fit()`, which widens a body for a kind's build by its bones.
- `gear.py`: plate carriers, pouches, belts, pads, radios, headsets, and the headgear the game's hats
  name (`enemies/types.ts` `hat`): cap, band, FAST, riot and EOD helmets, hood, crown, goggles.
- `masks.py`: the clown masks. A moulded shell a little over a face's size, its paint as thin decals
  following it: each kind keeps the flat look's design (`assets/models/build_tactical.py` `mask`, its
  outlines mapped onto this shell) and its extras (the sniper's tears, the medic's cross, the aimbot's
  glowing optic...). A decal's triangles are split until none parts from the shell's curve by more
  than 0.4 mm, laid 2.2-3.5 mm over it and turned to face out one by one (the game culls a face turned
  in; Cycles' previews do not); the packer keeps each mask's face and paint whole in LOD1.
- `kits.py`: one block of colour or shape per role that reads at 30-60 m (docs/VISUALS.md, V3).
- `machines.py`: the drones (quadcopters on the wing pivots, spinning rotor bones), the moderator
  gunship and its ring, the bomber, THE HITBOX and THE LAG SPIKE walkers (their knees hinge drums
  round the shin's pivot, so the leg stays whole as it bends).
- `roster.py`: every humanoid kind's build, gear and zone colours; `clips.py`: the clips;
  `build.py`: the whole build.

## Conventions

- **Pivots are bones.** Each kind's armature puts a bone on every pivot `render/figure.ts` builds
  for it (same name, rest position and parent), pointing up with no roll, so a bone's frame is the
  game's axes and the glTF joints come out as pure translations. The nodes the game moves by name
  (`render/tactical.ts` `TACTICAL_NODES`) are bones too; `chest`, `footL`, `footR` and the rotors are
  bones of the operator's own. The game drives bones from its pivots, so its procedural animation and
  death poses move the operator, and hit areas (the flat model, kept) never do.
- **Clips** are keyed on the clip rigs `humanoid` and `machine` as rotations from rest (game Euler
  XYZ) at 30 frames a second, exported as `<rig>.<clip>`; the game keeps their rotation channels and
  composes them onto the pivots' pose (`render/operator-motion.ts`). The stride loops span one cycle
  of the game's procedural stride, played at its phase.
- **Texture sets.** `operator` (body, gloves, boots, common gear, headgear, the mask shell and the
  swatches), `kit` (the role kits), `machine`. A piece is made once in a canonical form, unwrapped
  into its set's atlas and baked (a joined copy per set: Cycles bakes each object of a multi-object
  bake on its own); every kind rebuilds its pieces (the builders are deterministic) and takes the
  canonical UVs. Small parts with no texture space of their own (paint, studs, the masks' features)
  map to a swatch of their finish. The atlas holds a neutral finish (clean at `BASE` grey, wear
  lighter, grime and ground dirt darker, fabric weave, folds and seams in the normal map); the
  vertex colour gives each kind its colours, divided by the finish's base.
- **Vertex data.** `COLOR_0` is the kind's zone colours; `_FX` is a glow's strength, or -1 on the
  player's team mark (armbands, helmet band, ID panel), which the game colours with the team tone.
- **Materials** are the set names only; the game builds `operatorMaterial` per set.

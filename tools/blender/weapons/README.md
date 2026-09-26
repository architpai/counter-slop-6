# First-person weapons and arms (R4)

The realistic tiers' view models: the R4-C, the MP5, the pump shotgun, the sniper rifle, the pistol,
the combat knife, the ACOG and holographic sights, and the gloved hands with sleeves. Every mesh,
pose, clip and texture is made by the Python scripts in this folder, run headless in Blender. Nothing
is downloaded: no model, image, scan or HDRI is read from disk. Low keeps the code-built guns of
`src/engine/weapons/models.ts` and never loads any of this.

## Regenerate everything

```sh
npm run weapons                    # model, pose and bake every set in Blender, then pack and encode (about 8 minutes)
npm run weapons -- r4c pistol      # only these sets; the others' last build is packed with them
npm run weapons -- --pack          # pack and encode the last build again, without Blender
```

`tools/weapons/build.mjs` needs Blender 5.x (`BLENDER=/path/to/blender`, default
`/opt/homebrew/bin/blender`) and the dev dependencies `ktx2-encoder`, `@gltf-transform/*` and
`meshoptimizer`. It:

1. runs each script, `hands.py` and `optics.py` first (the guns pose the hands from
   `hands.blend` and preview the optics on their rails), into `tools/weapons/.build/<set>/`
   (git-ignored): `model.glb` (the set's nodes, clips and sockets; materials are names only),
   raw RGBA8 albedo, normal and ORM maps at 2048, 1024 and 512, PNG previews and `meta.json`
   (triangles per node, clip lengths, socket positions);
2. merges the sets' models into `public/models/weapons.glb`: one scene, the clips resampled,
   meshes welded, quantised and meshopt-compressed. A part the game moves keeps the transform it
   was authored with (its pivot); its mesh hangs on a child node, since quantisation folds a
   dequantisation transform into the mesh's node;
3. encodes the maps to KTX2 (Basis ETC1S with mipmaps) as `public/weapons/<size>/<set>-<map>.ktx2`.
   The optics, pistol and knife stop at 1024 (`MAX_SIZE`), so Ultra stays within 10 MB;
4. writes `src/engine/render/weapon-assets.json`: file sizes per set and size, triangles per model
   and node, and every clip's length. The game and `tests/weapon-assets.test.ts` read it.

Commit the regenerated `public/models/weapons.glb`, `public/weapons/` and `weapon-assets.json`.

Look at one set alone, without baking (a few seconds):

```sh
blender --background --factory-startup --python tools/blender/weapons/r4c.py -- --preview --no-bake
```

and open `tools/weapons/.build/r4c/preview-*.png` (the hip view at the game's 65 degree view-model
FOV, orthographic sides), `hand-*.png` (both hands close up) and `clip-*.png` (clip frames at
the hip). `--quick` bakes with a few samples, to check the pipeline.

## Conventions

- **Axes and units.** Blender +Y is forward (the barrel), +Z up, +X right; the glTF export turns
  that into three's -Z forward, +Y up. Metres. Each model's origin sits where the flat model's
  does (the receiver, or the knife's grip), so the hip and aim poses carry over.
- **Nodes.** A model is a root empty (`r4c`), a `pivot` under it and its parts. Blender names are
  `<model>__<part>` (unique across the merged glb); the game strips the prefix. The game's
  procedural pose moves the root; clips move the `pivot` (the whole gun, for a reload's roll) and
  the parts. Static pieces are joined into `body`; moving parts (`magazine`, `slide`, `bolt`,
  `fore-end`, `charging-handle`, `cocking-handle`, `trigger`, `shell`, `left-hand`, `right-hand`)
  keep their own node with its origin on the pivot it turns about.
- **Sockets** are empties: `muzzle` (tracers, flash and smoke leave from it), `eject` (shells),
  `sight` (the point the aim pose puts on the screen centre: the iron sight's post, the sniper's
  eyepiece, an optic's axis at its eyepiece), `optic-mount` (the rifles' rail, where the game hangs
  the ACOG or holo), and the knife's `tip` and `smears` (the flat knife's blade frame on this blade,
  where the game lays the blood smears).
- **Clips** run at 100 frames a second, so every gameplay duration in `weapons/stats.ts` is a whole
  number of frames, and each clip is exactly as long as the timing it shows: `reload` and
  `reload-empty` (`reloadDuration`), `equip` (`drawTime`), `cycle` (`cycleDuration`: the pump, the
  bolt), `shell` (the shotgun's per-shell `reloadDuration`), the knife's `slash` and `slash-back`
  (`SLASH_TIME`); the knife's `guard` plays at the block's blend, so its length only sets its
  frames. `lib.Clip` keys each part relative to its rest pose (or to a key's `base`), at shares of
  the clip, with rest keys at both ends; each clip becomes an NLA track `<model>.<clip>` on every node it moves,
  which the exporter merges into one glTF animation. The game drives a clip from its own timer
  (the reload's progress, not the clock), so it cannot drift from the gameplay.
- **Hands** (`hands.py`) are one rest-pose right hand, glove and sleeve, fused from soft parts by a
  voxel remesh, decimated to about 3,750 triangles, weighted to a small bone set, unwrapped and
  baked once into the `hands` set. `hands.hand()` poses a copy by linear-blend skinning in numpy
  from what the hand should do (the wrist point, the direction to the knuckles, the way the back of
  the hand faces, the direction to the elbow, and each finger's curl), so every posed copy keeps the
  atlas; a left hand is the posed right hand mirrored. The sleeve stops behind the glove's cuff, so
  the camera sees the whole hand. A clip keys a hand's other holds (the magazine, the bolt catch)
  from their own hand frame (`hands.basis()` as the keys' `base`), so a grip can be posed again
  without moving the reloads; `hands.palm()` places what a hand holds (the shotgun's shell).
- **Finishes** (`lib.FINISHES`) are Cycles node graphs baked into each set's atlas: anodised and
  parkerised metal, painted steel, polymers (stippled on grips), rubber, satin blade steel, brass,
  glove fabric, leather palms, sleeve weave. Edge wear comes from the difference between a wide
  Bevel node's normal and the surface normal, grime from a short local AO node, and the normal map
  from a narrow Bevel node (rounded edges on every hard corner) plus each finish's bump detail
  (stippling, knurling, weave, grain). Ambient occlusion is baked from the set's own geometry. The
  optic shells bake near white; the game tints them with `OPTIC_COLOR`, so model and overlay match.
- **Identity.** The player blue stays as small accents: magazine base plates, the R4-C's
  charging-handle latch, the knife's spacer; the shotgun's front sight fibre is the flat look's
  red accent, and its saddle shells are a stock dark red, not a block of blue at the hip. The
  sleeves are a muted blue-grey, the gloves a neutral charcoal (a warm grey read olive under the
  evening maps' light).

## Game side

`src/engine/render/weapons.ts` (`WeaponAssets`, owned by the renderer) streams the glb and the maps
at the Textures size from the first realistic frame, in the upload slots after the bake's, and frees
them on Low. `src/engine/weapons/models.ts` (`makeRealGunModel`, `makeRealMeleeModel`) builds a
weapon's model from an instance of it, and every view model (`weapons/gun.ts`, `ViewModel`) swaps
to it once the assets are in and back when they go.

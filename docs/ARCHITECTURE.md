# ARCHITECTURE — browser FPS

> Current online extension: [Online team modes](spec/online-team-modes.md) defines the team-rule, HUD, and wire additions to this original rebuild contract. The current implementation uses TypeScript/React/Next static export; the original delivery instructions below are historical.

> **Status (2026-09-19):** the delivery mechanism changed. The game ships as Next.js +
> TypeScript, built with `next build` (`output: 'export'` in `next.config.ts`) and mounted by
> `src/components/GameMount.tsx`. `src/engine/*` implements the modules described below as
> `.ts` files under `src/engine/` (`src/main.js` → `src/engine/boot.ts`; `src/game/*` →
> `src/engine/game/*`; `src/render/*` → `src/engine/render/*`; the rest follow the same
> `src/<module>/*` → `src/engine/<module>/*` pattern). Header rules 4 and 5 below no longer apply.

This file is the integration contract for the rebuild. It is written so that fifteen people can
implement fifteen modules in parallel, from this file plus their own spec document, and have the
result link together on the first try.

Read this file completely before writing code. Then read only your own spec sections (listed in
your module's **Implementer checklist**).

**Rules that override personal preference:**

1. A module's public surface is exactly what this file declares. Do not add, rename, or re-order
   public exports. If a signature here is wrong for the spec, raise it — do not "fix" it locally.
2. Behaviour comes from the spec documents in `docs/spec/`. Every number, timing and formula there
   is normative. This file never contradicts them; where it looks like it does, the spec wins,
   except for **look** (section 3), which this file replaces wholesale.
3. Runtime cross-module calls go through the shared **context object** (`ctx`, section 5.1).
   Static `import` is only for pure things: classes you construct, factories, constants, math.
   This is what keeps the dependency graph acyclic.
4. ~~No bundler, no build step, no transpile. Everything is a real ES module served as a static
   file. Browsers do **not** resolve directory imports: always import the explicit file
   (`import { Renderer } from './render/index.js'`).~~ (superseded, see Status)
5. ~~No `npm install`, no framework, no TypeScript. The `.d.ts`-style blocks below are
   documentation of JavaScript shapes, not files to write.~~ (superseded, see Status)


## Contents

1. [Runtime, delivery and file layout](#1-runtime-delivery-and-file-layout)
2. [Global conventions](#2-global-conventions)
3. [Visual system](#3-visual-system) — palette, materials, lighting, post, type
4. [Dependency graph](#4-dependency-graph)
5. [Shared data structures](#5-shared-data-structures)
6. [Modules](#6-modules) — util · input · physics · nav · level · render · effects · audio · hud · player · weapons · enemies · players · net · main
7. [Frame update order in `main`](#7-frame-update-order-in-main)
8. [Boot sequence](#8-boot-sequence-game-loopmd-2)
9. [Cross-cutting integration rules](#9-cross-cutting-integration-rules)
10. [Decisions this document makes](#10-decisions-this-document-makes-and-why)
11. [First-week order of work](#11-first-week-order-of-work)

---

## 1. Runtime, delivery and file layout

### 1.1 Delivery

Static files only. Any static server works (`python3 -m http.server`, a CDN bucket, GitHub Pages).
There is no server component; multiplayer is peer-to-peer (see `net`).

### 1.2 `index.html` (owned by the `main` implementer)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Counter Slop 6</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600;700&display=swap">
<link rel="stylesheet" href="./styles.css">

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"></script>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="hud"></div>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

Notes:

- The PeerJS script is a classic script tag, loaded **before** the module script, so `window.Peer`
  exists by the time `net` first needs it. `net` must still tolerate its absence
  (error text `"networking library did not load"`, see `networking.md` §2.1).
- Only two `three/addons/` files may be used: `utils/BufferGeometryUtils.js` (geometry merging in
  `level` and `render`). Nothing else from addons. No post-processing addons — the composite pass
  is hand-written (section 3.6).
- `#game` and `#hud` are the only two elements in the body. `main` passes them to `Renderer` and
  `Hud`.

### 1.3 File tree

```
index.html
styles.css                    # all HUD/menu CSS. Owner: hud implementer.
docs/ARCHITECTURE.md          # this file
docs/spec/*.md                # behaviour specs
src/
  main.js                     # entry. Owner: main.
  game/                       # private to main; nobody else imports these
    state.js
    ui.js
    solo.js
    ffa.js
    pickups.js
    breakables.js
  util.js
  input.js
  physics.js
  nav.js
  audio.js
  audio.tunes.js              # private to audio (note tables)
  net.js
  players.js
  effects.js
  level/
    index.js  build.js  downtown.js  mexico.js  props.js
  render/
    index.js  palette.js  materials.js  prims.js  figure.js  postfx.js
  hud/
    index.js  elements.js  screens.js  labels.js
  player/
    index.js  movement.js  grapple.js  grenades.js  camera.js
  weapons/
    index.js  stats.js  gun.js  katana.js  models.js
  enemies/
    index.js  types.js  model.js  ai.js  boss.js  flyer.js  projectiles.js
```

A module with a directory publishes **only** what its `index.js` re-exports. The sibling files are
private; no other module may import them. A module that is a single file publishes that file.

### 1.4 Ownership map (avoid merge conflicts)

| Artefact | Sole owner |
|---|---|
| `index.html` | main |
| `styles.css`, everything inside `#hud` | hud |
| The `THREE.Scene`, camera, canvas sizing, materials, lights, shadow config | render |
| Anything added to the scene as level geometry, and the physics boxes for it | level |
| Particle/decal/debris pools in the scene | effects |
| The camera transform and FOV each frame | player (render owns the object, player writes it) |
| `localStorage` reads/writes | main only (through `util.store`) |
| `window.__game` debug handle | main |

---

## 2. Global conventions

- **Units.** Metres, seconds, radians. Y is up. At yaw 0 the player looks down −Z; right is +X.
- **Vectors.** All world-space positions, directions and velocities are `THREE.Vector3`.
  Never plain `{x,y,z}` objects across a module boundary, with two exceptions: the network wire
  format (plain number arrays, section 5.9) and 2-D screen/input vectors (`{x, y}` numbers).
- **Vector hygiene.** Functions that return a vector either return a **new** `Vector3` or accept an
  optional `out` parameter and return it. Never return an internal scratch vector without saying so
  in the signature comment. Fields such as `player.eye` are **live internal vectors**: read them,
  copy them if you keep them, never mutate them.
- **Time.** `dt` is always seconds. `dt` is clamped to 0.05 s by `main` before anything sees it.
  "real dt" is that clamped wall-clock value; "scaled dt" (`sdt`) is `dt × timeScale`.
  Each module's `update()` documents which one it must be given.
- **Randomness.** `Math.random()` via `util.rand/randInt/choose`. No seeding, no determinism
  requirement (grenades are the only cross-peer simulation and they are deterministic from the
  launch state because they use no randomness).
- **Angles.** `wrapAngle` maps to `[-PI, PI)`. Yaw for characters is `atan2(dx, dz)`.
- **Naming.** `camelCase` members, `PascalCase` classes, `SCREAMING_SNAKE` module constants.
  Booleans read as predicates (`alive`, `onGround`, `reloading`). Timers that count **down** end in
  `T` or `Cd` (`respawnT`, `dashCd`); accumulators that count **up** end in `Time`.
- **No exceptions for flow control.** Public methods return `null` for "nothing found" and are
  safe to call with junk input from the network.
- **Network input is hostile.** Every message handler validates types and ranges before use
  (`networking.md` §4: a non-object payload is ignored).
- **No `console.log` in committed code** except behind `if (DEBUG)`.

---

## 3. Visual system

The look is flat-shaded low-poly: no outline pass, no hatching, no texture grain, no screen-space
wobble, no hand-written fonts, no random element rotations. Every **size, position, timing, count
and formula** in the specs is kept exactly.

Target: **clean low-poly, flat-shaded, bold limited palette, soft shadows, no outlines.**

### 3.1 Palette

Two palettes. Both live in `src/render/palette.js` and are the only place colours are written down.

**Tone palette** — indices 0–5, used for characters, effects, particles, decals, projectiles,
pickups, tracers, prop debris.

| Id | Name | Hex | Replaces | Meaning |
|---|---|---|---|---|
| 0 | `PRIMARY` | `#4C7DFF` | blue | The player: tracers, own sparks, bullet holes, own gear, ammo pickups, spawn bursts |
| 1 | `HOSTILE` | `#FF4757` | red | Enemies and remote players: blood, enemy projectiles, laser telegraph, enemy swing arcs |
| 2 | `DARK` | `#2A3140` | black | Heavy/boss tone, soot, smoke, explosions, dark gun parts |
| 3 | `ACCENT` | `#FFB020` | orange | Muzzle flash, sparks, casings, grenade fire, parry sparks |
| 4 | `HEAL` | `#37D67A` | green | Health pickups, cactus |
| 5 | `BOSS` | `#C56BFF` | pink | Boss tone attacks, piñata burst |

**Surface palette** — named keys, used by `level` geometry only. Where a level spec table says an
name, map it: BLUE → `block`, BLACK → `dark`, ORANGE → `accent`, GREEN → `foliage`,
PINK → `boss`, RED → `hot`.

| Key | Hex | Use |
|---|---|---|
| `sky` | `#A8D2E2` | the parry flash's colour (no scene background: the dome covers every pixel) |
| `fog` | `#CBDDE2` | default fog and clear colour (each mood sets its own) |
| `ground` | `#B5B7AD` | ground plane, paving |
| `road` | `#52606A` | highway deck, asphalt |
| `block` | `#E5E4D9` | default building mass (the "BLUE" default of the level spec) |
| `blockAlt` | `#96A9B4` | secondary mass, concrete |
| `blockDeep` | `#405562` | shaded mass, undersides, tower |
| `roof` | `#C87651` | roofs, terracotta, tile |
| `wood` | `#9F7858` | planks, stalls, crates |
| `metal` | `#B8C6CC` | rails, catwalks, fire escapes, cranes |
| `dark` | `#263640` | trim, frames, doors, windows |
| `accent` | `#E7B34F` | highlights, rings, signage |
| `foliage` | `#4F8766` | cactus, plants, trees |
| `water` | `#40B7B7` | fountain, well, lake |
| `hot` | `#C96557` | rare warning surfaces |
| `boss` | `#A887B7` | surfaces marked PINK in the level spec |
| `cloud` | `#FBFAF5` | the merged cloud mesh (`cloudMat`, unfogged) |
| `lawn` | `#829B65` | House's lawns |
| `siding` | `#F0E6D2` | House's clapboard, Mexico's white stucco |
| `shingle` | `#3E5262` | House's roofs |
| `plaster` | `#D9DCD5` | interior walls |
| `adobe` | `#E5BD92` | Mexico's adobe houses |
| `sandstone` | `#BE845D` | Mexico's rocks, rock stacks and mesas |
| `sand` | `#DBC59C` | Mexico's ground |
| `paving` | `#E1D8C3` | plazas and paths |

Rules: at most **12 distinct materials visible in one frame** of level geometry on Low. Do not tint
per-object; pick a palette key. No external image textures, normal maps or emissive maps on
materials. The only generated textures are the three-step toon gradient, opaque name-tag labels
made by render and, on the realistic tiers with light shafts and bloom on, the lens dirt (R8,
`postfx.ts` `lensDirt`: drawn once from a fixed seed). Three exceptions, all realistic tiers only and all self-made in Blender: each map's
sky images, streamed from `public/sky/<map>/`, feed the sky dome and the environment (§3.3); the
level's texture sets (§3.2, material tags); and each map's baked lighting, a lightmap or AO map and
a probe grid streamed from `public/maps/<map>/` (§3.3, baked lighting).

**Material tags** (realistic tiers, R2). Every level primitive also carries a `material` tag
(`BuildOpts.material`; `render/surfaces.ts` lists 34: concrete, cast-concrete, brick, plaster, stucco,
adobe, siding, asphalt, road-paint, paving, tile, wood, bark, painted-wood, planks, plastic,
painted-metal, steel, tread-plate, rust, corrugated, glass, sand, sandstone, terracotta, roof-tile,
shingles, grass, fabric, foliage, flowers, cactus, water, spray); without one, its surface key's
default applies (`DEFAULT_MATERIAL`). Low ignores the tag and draws the surface key exactly as
before. The realistic tiers draw the tag: its texture set (`MATERIAL_SET`, 28 sets, one Blender
script each in `tools/blender/materials/`) tinted to the tag's colour in `palette.ts`
(`MATERIAL_COLOR`): plausible albedos for natural materials (asphalt dark, grass and concrete
mid, sand light), or the piece's own surface colour for paint, plaster, render, paving and fabric,
so a map's colour scheme survives. Texture contrast stays moderate so enemies read against every
wall. Detail a texture already carries, such as the plaza joint strips, is `BuildOpts.flatOnly`:
drawn on Low, hidden on the realistic tiers, so it does not draw a second grid over the texture's.

### 3.2 Materials

Three material families, all created and cached by `render/materials.js`. Nothing else may call a
`THREE.*Material` constructor.

| Family | Type | Used by |
|---|---|---|
| `surface` | `MeshLambertMaterial({ color, flatShading: true })` | level geometry, breakable props, pickups, grenades, debris, grapple hook |
| `character` | `MeshToonMaterial({ color, gradientMap: 3-step })` | the flat look's first-person view models and the legacy figures (Mexico's musicians); `propMat()`, the same toon shading with each part's colour in a vertex colour, for the flat weapon props |
| `characterMat` | `MeshStandardMaterial({ vertexColors, side: DoubleSide })`, patched | the Blender characters (`tactical.glb`): enemies, remote players, the flat look's view hands (V12, below) |
| `operatorMaterial` | `MeshStandardMaterial({ vertexColors })` with a set's maps, patched, skinned | the realistic tiers' operators (`operators.glb`, R7, below): one per texture set (`operator`, `kit`, `machine`) |
| `unlit` | `MeshBasicMaterial({ color })` | particles, decals, tracers, muzzle flash, enemy laser, projectiles, name tags, focus/UI world marks |

- The toon gradient map is a 3-pixel `DataTexture` (`NearestFilter`, no mips) built in
  `materials.js`. Three tonal steps, no rim light, no specular.
- `flatShading: true` on every surface material; geometry is authored low-poly (cylinders 6–8
  sides, spheres 8 segments, cones 3–6 sides).
- **The characters' material** (V12, `characterMat`): every part of `tactical.glb` wears flat PBR
  factors, so `render/tactical.ts` moves each material's colour, roughness, metalness and glow into
  vertex attributes (`color`, and `pbr`: roughness, metalness, glow over `CHARACTER_GLOW`, and 1 on
  the player's mark) when it merges a pivot's parts into one mesh, and this one material, one
  program (`customProgramCacheKey` `character`), draws every figure. It is lit by the probe grid
  like any moving thing, and the player's mark takes a `markColor` uniform.
- **The operators' material** (R7, `operatorMaterial`): a texture set's neutral maps (fabric
  weave and folds, seams, wear, grime; ORM) times the vertex colour, which carries each kind's kit
  colours, so one atlas serves every kind. The `fx` vertex attribute is a glow (0..1 of
  `CHARACTER_GLOW`; a faint one, the masks' glaze, strongest where the surface faces the viewer and
  0.3 of it at the outline, `GLAZE_RIM`, so the mask's relief shows) or the player's team colour,
  which takes the figure's `markColor`: -1 its tone (armbands, helmet band), -0.6 a light tint of it
  (the carrier; `TEAM_TINT`, lifted mostly through green). Probe-grid lit and hit-tinted like
  `characterMat`; one program (`operator`) for every set, skinned. Its light is rebalanced for
  readability (`OPERATOR_LIGHT`: the direct light's diffuse at 1.3; the ambient at 0.9 in the open,
  up to 2.0 where the probe grid's light before its floor is a small share of the open sky's, a room)
  and its baked occlusion follows the AO setting (`OPERATOR_AO`: 0.5 with GTAO, 0.6 without); both are
  balanced against fe14d35's flat look view by view (`tests/tiers.shots.mjs`, `tests/indoor.shots.mjs`).
- **Hit flash** (V15) is a tint on a figure's own materials, not a swap: a tactical figure wears
  its own copies (`ownMaterial`) of the character material and of its prop's (`propMat`, or on
  the realistic tiers `weaponPropMaterial`), bound to one `hitTint` uniform per figure, which adds
  light as emission (`Figure.setTint(amount, tone)`), so the lit kit keeps its shading and
  brightens towards the tone. The copies share the originals' programs (same patch and key; the
  originals stay alive in the warm-up templates, holding the programs, which a look put in force in
  a live match compiles there too) and read the originals' maps
  (a streamed set swapped there reaches every copy). Enemy: `HIT_TINT` (0.5) of the tone at the
  hit, fading to none over `FLASH_TIME` (0.12 s, `flashAmount`); remote player: the same over its
  0.08 s shot flash. The legacy figures never flash.
- Instanced pools (`effects`) use `InstancedMesh` + `setColorAt` for per-instance colour. The flat
  look's particles are always unlit; "outline" particles (smoke rings) simply use a pale grey
  (`#DDE4EC`) and keep their `grow` behaviour. Its hole discs and blood splats wear
  `flatDecalMaterial` (unlit, pulled towards the eye by a polygon offset, so they never flicker).
- **The effects family** (R5, `render/fx.ts`, each made once and cached like the rest):
  `tracerMaterial` (every tier: camera-facing ribbons with premultiplied alpha, so one draw holds
  the player's additive glow and the enemies' solid red), `lowFlashMaterial` (the flat guns' flash
  stars, additive), `lowGlowMaterial` (the flat grenade's fire: additive, front faces only, each blob
  fading out with its instance colour and, within it, from where it faces the eye to nothing at its rim,
  so overlapping blobs show no faceted edge), `boltMaterial()` (enemy projectiles: one instanced mesh for
  every bolt in flight, `enemies/projectiles.ts`, each instance its tone a little over white,
  `boltColor`, laid out once a frame at the end of the enemies' update), and on the
  realistic tiers `spriteMaterial` (`fire` and `fire-soft`: the fire atlas, additive, a billboard
  pulled towards the eye by half its size so a figure it swells round is behind all of it; `soft`:
  the lit atlas, premultiplied, faded against the scene's depth in the soft-particle layer, with no
  depth test; `dither`: the lit atlas behind a moving noise dither in the scene pass), `decalMaterial` (bullet holes and scorch
  marks: a `MeshStandardMaterial` with the decal atlas's albedo, alpha and normal map, lit by the
  sun, its shadow maps and the probe grid, polygon-offset, not written to depth),
  `splatMaterial` (blood, lit the same way), `shellMaterial` (brass; the shotshell's red hull in
  vertex colours), `flashMaterial` (the Blender guns' flash quads, additive, HDR) and
  `hazardSmokeMaterial` (an enemy's smoke grenade: alpha-hashed, a clone per grenade for its
  opacity). The streamed atlases go on them as uniforms (`wearFx`), so no program changes when they
  land. The blended two-sided ones (tracers, sprites, flashes) set `forceSinglePass`: three would
  draw each twice a frame, back faces then front, and re-key its program before each.
- Everything else is opaque. The exceptions: those effect materials, the window of the Blender
  holographic sight on the realistic tiers (`weaponMaterial('holo-glass')`, drawn last in the
  rig), and the moderator's ban ring (a thin ring on the ground). The hazard smoke grenade's cloud,
  once the scene's one blended volume, is alpha-hashed on Low (the opaque pass, no sorting) and
  drawn as lit smoke sprites on the realistic tiers.
- Two scenery materials sit outside the families, both made in `materials.ts`: the sky dome's
  `ShaderMaterial` (`skyMat`, §3.3) and the unfogged flat-shaded cloud Lambert (`cloudMat`).
- **Realistic level materials** (`realMat`, Medium and up): a `MeshStandardMaterial` per (tag,
  colour), cached like the families, with the tag's texture set as albedo, tangent-space normal and
  ORM (occlusion, roughness, metalness in one map; roughness and metalness scalars 1). Its colour is
  the tag's colour divided by the set's mean albedo, so the texture averages to that colour. Until
  the set streams in it wears the set's stand-ins, 1 × 1 maps of the set's mean values
  (`standInMaps`): the untextured level already has the right colour and sheen, and swapping in the
  real maps changes no shader program. They are flat-shaded like the surface family, so low-poly
  trees and rocks keep their facets. One `onBeforeCompile` patch on all of them (one program) adds
  the anti-tiling macro variation: two octaves of world-space value noise a few metres across scale
  albedo by ±9 % and roughness by ±14 % (±12-16 % albedo on concrete, sand and grass, none on glass
  and water), so plazas, roads, lawns and sand do not show their repeat. The same patch drops the
  sky PMREM's diffuse term: the level's diffuse sky fill is the light probe alone, as Low's Lambert
  gets, and the PMREM gives it specular only (the GLB characters keep both, §3.3). Their shadow
  pass uses `levelDepthMat`, a depth material that never samples a map: three's shared one keeps the
  last caster's `map`, and after the streamed maps are freed it would bind a freed albedo and upload
  it again for good.
- **Geometry and UVs.** `LevelBuilder` merges pieces into one mesh per surface key, as before R2,
  with one geometry group per tag (`LevelSurface.materials`, in group order; `null` for the
  flat-only group). `Renderer.setSurfaces(level.surfaces)` gives Low the surface Lambert on the whole
  mesh, one draw call per surface key exactly as before (489, 525 and 2328 over 6 frames on
  Downtown, House and Mexico), and the realistic tiers a material array, one draw per tag (the
  flat-only group gets an invisible material, which three skips): a swap with no rebuild. three
  draws each group of such a mesh on its own in every shadow cascade as well, though the level's
  materials all cast alike, so the renderer wraps `shadowMap.render`: for that pass only, each
  multi-tag mesh wears one of its materials and its groups merged into runs (`casterGroups`; a
  flat-only group ends a run), one draw per cascade. Ultra's shadow draws went from 93, 122 and 368
  to 41, 46 and 316 on Downtown, House and Mexico. Every piece
  gets UVs at merge time by planar projection per triangle in world space (`planarUVs`), in its set's
  tile size (metres per tile, from the bake): walls keep v vertical and u along the wall, floors and
  slopes use u along x, each face's frame lies in its own plane (a roof or ramp is not stretched),
  and coplanar faces share one frame, so a wall built from many boxes wears one seamless texture.
  Boxes stay indexed (their faces share no vertices); smooth spheres, cylinders and tori share
  vertices across faces and are split into separate triangles, which is why the level has more
  vertices than before (Low: 37.5k, 29.4k and 68.1k on Downtown, House and Mexico, from 35.7k, 24.3k
  and 34.5k; no measurable render cost). Normal maps use three's derivative tangent frame, so there
  is no tangent attribute. Loose pieces (breakable props, figure accessories) come from
  `LevelBuilder.part` and are tagged the same way. Mexico's breakable props draw from one batch per
  surface key with a group per tag (V19, `LevelBuilder._batchBreakables`: 249 part meshes, 48 props,
  in 7 meshes), their parts kept in the props' groups, hidden, as level surfaces that wear the look in
  force: a break shows them for the debris and collapses that prop's vertices in its batches onto one
  point (a partial upload), when the group leaves the scene. The mariachis' meshes merge per moving
  pivot and material (`LevelBuilder.rigid`: 23 meshes a musician to 7), so the band still sways.
  The static level also gets a second UV set, `uv1`, for its lightmap (§3.3, baked lighting), made by
  a deterministic chart packer (`render/lightmap.ts`); Low never makes it. The first realistic frame
  checks the geometry's hash and puts `uv1` on (the session's checked layout, or zeros), and
  `_layBake` lays the charts out in steps of about 4 ms in the upload slots while the bake downloads
  (`lightmapChartSteps`, `layoutSteps`: generators that pause between passes and every few thousand
  triangles or 512 packed cells), before it goes on.
- **Baked variant** (R3): on a map with a bake in the manifest, the static level's realistic
  materials are `realMat(real, info, true)`, cached apart (one more program): the same PBR material
  wearing a lightmap on `uv1` (a 1 × 1 stand-in until the bake is in) and a patch that takes its
  diffuse sky light from the bake instead of the probe (below); if the first realistic frame finds
  the geometry changed since the bake, they go back to the plain variant. Loose pieces (Mexico's props, the
  drones) keep the plain variant, lit by the probe grid. `gridLit(material)` puts the probe grid on
  a moving thing's material: every `charMat` (view model, legacy figures); the character and prop
  materials add the same patch themselves;
  `gridLit(material, true)` (the Blender weapons) adds the `GRID_VIEW_MODEL` define, which keeps
  60 % of the open sky's light as its floor (`probeGridViewFloor`) where characters keep 75 %, so
  the gun darkens further indoors and the darkest room's gun still reads (luma ≥ 10).
- **Realistic weapon materials** (R4, `weaponMaterial(name)`, owned and freed by
  `render/weapons.ts`): one per glTF material name of `weapons.glb`. A texture set's name (`r4c`,
  `hands`, ...) is a `gridLit` `MeshStandardMaterial` wearing that set's albedo, normal and ORM
  (`wearMaps`) once they are in, and one-texel stand-ins until then (so its program never changes); an optic shell (`optic-acog-body`, `optic-acog-rim`,
  `optic-holo-body`, `optic-holo-base`) wears the optics set tinted with its `OPTIC_COLOR`, so the
  model and the aiming overlay match; `lens` is dark glass (`MeshPhysicalMaterial`) whose coating
  tints its reflection green-gold, on domed lenses, `holo-glass` the see-through
  window, `reticle` unlit in the reticle colour.
- The post passes (§3.6) are `ShaderMaterial`s from `makePostMaterial`; SMAA comes from three's
  `SMAAPass` addon, which builds its own.

### 3.3 Lighting and shadows

Replaces `rendering-effects.md` §4 in full. There are two looks (`quality.ts`, `Look`): Low's flat
low-poly look (`lowpoly`) and the HDR pipeline of the realistic tiers (`realistic`, Medium and up).

**Low (and a realistic tier whose sky has not streamed in yet):**

- One `DirectionalLight`, colour `#FFEFD6`, intensity 2.0 (the moods set their own: 2.1–2.25, warmer), direction `normalize(0.38, 0.82, 0.42)`
  (kept from the spec, `SUN_DIR`) unless the level's mood sets `sunDir` (House, Downtown and Mexico
  do, about 32–35° up, so the dome's sun disc sits in view), positioned at
  `shadowCenter + dir × (radius × 2)`.
- One `HemisphereLight`, sky `#AFCBE1`, ground `#626772`, intensity 1.0 (the moods set their own), and a `RoomEnvironment`
  PMREM at 0.35 so GLB metal does not read black.
- No point lights, no ambient light.

**Realistic tiers**, once the map's sky is in: every light comes from the map's Blender sky
(`tools/blender/sky.py`, rendered with the physical Multiple Scattering sky for the mood's
`sunDir`). `sky.json` holds the sun's irradiance, the sky's irradiance as 9 SH coefficients, the
horizon colour and the background scale, all in one unit: a white horizontal surface in full sun
has radiance 1. The sun light takes the sun's colour and intensity (about 5); a `LightProbe` with
the SH replaces the hemisphere light (its lower half is a neutral grey floor as bright as 30 % of
the map's sunlit ground: bounce light, grey so interiors and eaves do not take the lawn's green).
The probe keeps 60 % of the sky's colour at full brightness (`PROBE_CHROMA`): a sky-only probe
has none of the warm bounce from sunlit walls, and at full colour shade on grey concrete read navy.
On a baked map the bake carries that bounce instead (below); the probe still lights backdrops, and
Medium's level times its AO map.
The sky's PMREM (`env.hdr`, 1024 × 512, so a 256 cube like the room environment's) is the
environment at full strength. The GLB characters take its diffuse on top of the probe, a double
sky fill that keeps them readable in shade; the level's materials take only its specular (§3.2). The fog and clear colour are the radiance of the lowest degree of
sky in the hue of the mood's own fog colour, its colour pushed 1.5× from grey (`HAZE_CHROMA`)
because AgX desaturates it at that brightness: House's warm haze, Downtown's cool morning. The
mood's `sky` names the folder; its `realistic` field sets an exposure (stops: Downtown −0.3, House
−0.5, Mexico −0.15) and a grade for this look. Low never fetches a sky, and switching to it frees a
loaded one. The sky streams from the first realistic frame on the map and lands without a hitch:
the realistic look keeps the hemisphere light and the probe in the scene (the one not in use at
0), so the light counts in every lit program stay the same; the environment keeps its cube size;
one `PMREMGenerator` lives with the renderer on realistic tiers, compiled for the room environment
and, when the sky is asked for, for the equirect step; the dome's streamed-sky program (`SKY_MAP`)
is compiled and drawn once at the menu on a 1 × 1 stand-in (`_skyProbe`, with the menu warm-up
described under texture streaming below); and `sky.webp` arrives as an `ImageBitmap`, decoded and flipped off the main
thread (its upload costs 3 ms; an image element's cost 19). A downloaded sky goes on a step a
frame in the upload slots, never in a match's quiet start: the background's upload, then the
PMREM environment (3–4 ms), then the look. A sky that lands after the map or the look changed is
freed, with whatever of it was already made.

- **Shadows** follow the quality setting (`render/quality.ts`, `SHADOW_SPEC`): off; Low's 2048² PCF
  box centred on the eye (half-width 35 m), redrawn every 2nd frame; Medium's one 2048² PCFSoft box
  pushed 28 m ahead of the eye (half-width 45 m); High's 2 and Ultra's 3 cascades, 2048² PCFSoft each
  (half-widths 14/45 m and 8/22/60 m, each pushed ahead of the eye). `bias = -0.0004`; `normalBias`
  0.03 on Low's box, 0.9 of a texel on the others. Every box has a fixed size and snaps to its
  own texel grid in the light's frame (`render/shadows.ts`), so shadows do not swim as the viewer
  moves or turns, and the sprint FOV kick does not resize them. A cascade is a dark, shadow-only
  `DirectionalLight`; `shadows.ts` patches three's `lights_fragment_begin` once so that a scene
  with more than one shadow-casting directional light takes each fragment's shadow from the
  sharpest box holding it (blending over the outer eighth into the next, fading to lit over the
  outer 1/24 of the last, about 2 m, so the far end of the shadows is a clean edge rather than a
  smear) and applies the sun once. With one shadow light the chunk runs unchanged. Every
  realistic tier filters with PCFSoft (the same cost as PCF; Medium's 4.4 cm texels step without
  it).
  `shadowMap.autoUpdate` is off and `render` requests each redraw; the boxes only move on frames
  that redraw the maps. The depth range is fitted per level by
  `renderer.setLevelShadow(center, radius)` — `level` reports these in `level.shadow`.
- `castShadow = true` on level geometry, characters, props, debris and the grapple hook. The
  drones cast none on the realistic tiers (`LevelSurface.moving`): 30–40 m up, a drone's shadow in
  the sharp cascades was a hard grey wedge on the ground by the player, the drone itself a speck
  near the sun.
  `receiveShadow = true` on level geometry only. Particles, decals, tracers, view models and the
  weapon rig cast and receive nothing.
- **Atmospheric perspective** (the spec's distance fade, §4) is a linear `THREE.Fog` whose range
  each level's mood sets (`fogNear`/`fogFar`, roughly 50–55 m to 180–260 m; default 50–190), so a
  grunt at 60 m stays clear. The view-distance setting ("normal" or "long", ×1.3) scales the fog
  range, the far plane (420 m at "normal") and the sky dome together; it never pulls the fog in.
  **Haze** (R8, realistic tiers, `render/atmosphere.ts`): on top of it an aerial perspective whose
  density falls off exponentially with height, `haze × exp(−falloff × (y − base))` per metre, integrated
  in closed form along the view ray from `start` out, at least the play space's width (its bounds side to side: House and
  Training 80 m, Downtown 110, its arena 140, Mexico 125), so a grunt anywhere straight across it wears none; it thickens with distance
  and towards the ground and thins looking down from a roof or up at the skyline; towards the sun the
  fog colour brightens by `glow` in the sun's hue (`pow(cos, 8)`). Per map in `palette.ts`
  (`ATMOSPHERE`, on the mood's `realistic.atmosphere`; the arena its own entry): Downtown 0.006 /m (a clear
  morning), House 0.009, Mexico 0.014 thinning slowest with height (a hot haze), Training 0.005. The view distance
  starts it that much further out, at the same density. three's fog chunks are patched once
  (`fogAmount()`, `fogTint()`, a world-space `vFogRay` varying), so every fogged material takes it; the
  effect sprites and the grime decals call the same functions. The parameters are three shared uniforms
  whose values are plain typed arrays, added to `UniformsLib.fog` and every `ShaderLib` entry with fog,
  so one write reaches every program (three shares such a value by reference when it copies
  uniforms). At zero haze (Low) the chunk takes the unpatched path: Low's fog is exactly as before. The
  sky dome's horizon band takes the same glow, so far geometry still meets the sky without a seam.
  `renderer.fogAt(distance, eyeY, pointY)` gives the shader's share on the CPU (the tier checks read a
  60 m grunt's fog there).
- **Sky**: one dome (`skyMat`, a `ShaderMaterial`) follows the camera. On Low it draws the
  horizon-to-zenith gradient per pixel and, when the mood sets `sunDisc`, a sun disc with glow
  along `sunDir`. With `SKY_MAP` defined (realistic, sky loaded) it draws `sky.webp` (an sRGB
  equirect in three's layout, times the background scale) and a small HDR sun disc that blooms.
  Overhead the image gets ×1.6 brightness and ×1.3 saturation, ramping in over the lowest 25°
  (physical sky radiance tone-maps to a dull slate); the lowest 10° fade into the hazed fog
  colour, so the sky meets the fogged ground without a seam. The lighting stays physical.
  The same direction aims the shadow-casting lights, so the visible sun and the shadows agree;
  moods keep it 30° or more up. A mood change writes uniforms only. Clouds are one merged, unfogged
  low-poly mesh per level (`LevelBuilder.clouds`). There is no `scene.background`: the dome covers
  every pixel.
- **Texture streaming** (`render/textures.ts`, R2): the first realistic frame on a map asks for the
  texture sets its tags need at the Textures setting's size (Graphics → Advanced: low 512, medium 1K,
  high 2K; Medium, High and Ultra default to them). The frame never waits: KTX2 files (Basis ETC1S,
  mipmapped) download and transcode in `KTX2Loader`'s workers, to BC1 where the GPU has it, else
  ETC, since ETC1S holds no more than those 4-bit formats and BC7 or ASTC would double the memory.
  `render` then uploads one map at a time and frees its CPU copy (the GPU holds the only one; a
  restored context streams again). Uploads are paced in time, not frames, so a map textures as fast
  at 60 Hz or under an FPS cap as at 144 Hz: they wait 500 ms after a level load or a look change
  (`UPLOAD_SETTLE_MS`), then come at least 24 ms apart (`UPLOAD_GAP_MS`) and at most 60 MB/s on
  average (a 2K map about every 47 ms); an upload slower than 4 ms doubles the gap, up to 4 times,
  for the rest of that stream. At 60 Hz a map is textured 2-3 s after it loads (Ultra Downtown
  2.9 s, was 6.2 s). The
  first compressed upload of a page costs ANGLE Metal about 220 ms whenever it comes, so the first
  realistic look uploads a 4 × 4 one (`warmCompressedUploads`), at the menu. On an M4 Pro no
  streaming frame then passes 8 ms (it was up to 230 ms). With vsync off (as
  `tests/tiers.shots.mjs` runs) the page queued 54–73 frames ahead of the GPU and each upload
  waited behind them (240–340 ms frames while a map streamed on Ultra); `render/pacing.ts` puts a
  fence after every frame and, while something streams (`renderer.streaming`: the sky, the level's
  bake or sets, the weapons), boot skips a frame while 6 are unfinished (`renderer.gpuBehind`), so
  no upload waits behind more. A skipped frame costs a display interval (the browser sends the next
  animation frame about 18 ms later), so with nothing to upload none is skipped. With vsync on the
  browser keeps its own queue shorter (1 frame on the M4 Pro, up to 5 under SwiftShader), so
  nothing is skipped.
  A match's first 3 s (`MATCH_QUIET_MS`, from `renderer.setLive`, which boot calls every frame;
  an online match stays live under its menu, since it plays on) take no upload, no sky step and no
  program compile, so the first frames a player moves in are even; what streams on meanwhile
  resumes after it. Nothing a match shows links a program in it:
  once per look, while no match is live, the renderer compiles off the frame the programs of every
  view model in the rig, of the prewarmed templates (the characters', the pickups') and, on the
  realistic tiers, the dome's streamed sky, then draws the rig, the sky stand-in and a shadow
  caster once into the frame's target (`_warmPrograms`, `_runCompiles`, `_drawWarmups`): on ANGLE
  Metal a program's first draw can stall its frame even once it is compiled. The Blender weapons'
  template joins that queue as soon as its glb lands (`render/weapons.ts`; its materials wear
  one-texel stand-in maps, so the programs are final before the maps are in). It is the one
  warm-up that also draws in a live match, past its quiet start, one a frame (the glb landed after
  Start); the rig's and the shadow caster's wait for a menu. Once every wanted set is on the GPU the
  renderer puts them on all level materials at once (uniform changes only). A new map's request
  frees the previous map's sets it does not use at once (no level material wears them; any cached
  material that did goes back to its stand-in), so GPU memory across a map change never passes the
  larger map's own; the previous size of a set still wanted stays on screen until the new size is in, then is
  freed, so no loading overlay is needed. A set shared with the previous map is not fetched
  again. A failed set keeps its stand-in and is tried again on the next level load or setting
  change. Low loads none and switching to it frees them all. `renderer.texturesPending` is true
  until the level's sets are on; `textureStats` reports what is resident. Per map download: Medium
  1.1–1.5 MB, High 3.9–5.6 MB, Ultra 15.2–21.9 MB; resident on the GPU 8–12, 32–46 and 126–185 MB,
  with no CPU copy. Anisotropic filtering follows the size (4×, 8×, 16× at 512, 1K, 2K; capped at
  the GPU's), so grazing roads and sand keep their detail on each tier.
- **Baked lighting** (R3, `render/lightmap.ts`, `tools/lightmaps/`, `tools/blender/bake_level.py`;
  `npm run lightmaps` regenerates every bake). Each map's static level is baked in Cycles under its
  own sky and sun: sky light and every bounce, the sun's included, but not the sun's direct light,
  which stays the dynamic sun with its shadow maps. The game rebuilds the lightmap charts from the
  level (every planar piece projected at one density per map, about 17–21 cm a texel at 2K, 4 texels
  of padding on a 4-texel grid) and uses the bake only if the geometry hash, chart, triangle and atlas
  row counts match `lightmaps.json`, so an edited map falls back to the probe (and
  `tests/lightmaps.test.ts` fails until it is re-baked). The layout costs 35–65 ms (the arena about
  130) in a level's first realistic frame, once per bake a session: the renderer keeps each checked
  layout, so a restart or a return to the map only hashes the triangles (3–6 ms). The Textures setting picks the file: low
  (Medium) `ao-512.ktx2`, the bake's light over the probe's at a quarter size (the probe's colour,
  the bake's occlusion and bounce, up to 4×); medium (High) `light-1024.ktx2`; high (Ultra) `light-2048.ktx2`: UASTC,
  transcoded to ASTC or BC7, sRGB of light / scale, trilinear with no anisotropic filtering (its
  footprint would reach past a chart's padding into the next chart's light). On baked faces the bake's light replaces the
  probe's, so shade is lit once, with the warm bounce the probe lacked; the sky's reflections dim by
  the same share of the open sky's light; a soft floor (60 % of the open sky's light, as a 4-norm, so
  open ground gains about 3 %) keeps rooms lit only through a door readable, dark brick included; and
  sand in shade takes a warm lift (`SHADE_LIFT` in `materials.ts`, fading out where the sun lights
  the face), so it reads as light sand about a stop under sunlit sand. Faces with no texels (never seen, or backdrop beyond the bounds or above 50 m) keep
  the probe. `probes.bin` is the map's probe grid: an ambient cube per 1.5–4 m cell and the cell's
  share of sun, one sRGB 3D texture sampled per fragment by everything `gridLit` (characters, view
  model on either look, figures, loose props): its light replaces the probe's, the environment's diffuse and
  reflections dim with it, a mesh that receives no shadows (the view model) loses the sun where the
  cell cannot see it (down to 30 %), and characters keep at least 75 % of the open sky's ambient
  (the Blender view model 60 %). The
  bake streams ahead of the level's texture sets in the same paced upload slots (it is on about
  0.6 s after a level starts) and fades in, eased, over 1.5 s; its KTX2 loader (a second
  transcoder) is made on the first download and kept while the look stays realistic, so a map
  change does not fetch and compile it again. A new map takes the old one's off at once, a size
  change keeps the old file until the new one is in and then swaps it in place at full strength,
  and Low frees it all (the grid's mix is 0 there and the patched shaders take their old path).
  `renderer.bakePending` is true until it is on and `renderer.bakeFading` until its fade is done
  (screenshot scripts wait for both); `bakeStats` reports it. Per map download:
  Medium 0.38–0.47 MB, High 0.79–0.90 MB, Ultra 2.1–2.3 MB; resident on the GPU about 0.9, 2 and 6 MB.
- **Sky streaming** (`render/sky.ts`): the first realistic frame drawn on a map asks for its sky
  (so boot, which builds the menu map before it applies the saved preset, fetches nothing on Low);
  the frame never waits. `renderer.skyPending` is true until it is
  in (or failed; a failure keeps the Low-style lights). Only the latest map's sky is kept. Each
  map's three files total under 0.4 MB.

### 3.4 Camera and canvas

From `rendering-effects.md` §2 and §3.1: perspective, near 0.08, far 420 (scaled by view distance),
rotation order `YXZ`, canvas fills the window and resizes with it. The pixel ratio is
`min(devicePixelRatio, cap)` with the cap from the quality preset (1.5 or 2), applied live.
`antialias: false` on the canvas (anti-aliasing lives in the composite, §3.6).
`outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping` (tone mapping is in the composite).

The weapon rig is drawn in the world pass with a fixed 65° vertical view-model FOV
(`VIEW_MODEL_FOV`) that blends to the world FOV as the gun comes up to the eye, so ADS and scopes
are unchanged. `renderer.setViewFov` scales the rig group in camera space by
tan(world FOV / 2) / tan(view FOV / 2) in x and y, which puts every rig point on the screen spot
and depth a camera at the view FOV would give it; no second pass, no second MSAA resolve. Rig
meshes have `renderOrder` 1000 and each draws with `gl.depthRange(0, RIG_DEPTH)` (0.01; world depth
only gets that low within 8 cm of the eye) and restores it after, so the gun never clips into walls
and the world's depth survives it on every tier: AO and the soft particles read it (§3.6; they treat
that slice as "not the world"), and the transparent world effects, which three draws after every
opaque mesh, rig included, still test against the walls. (Up to R4 the first rig mesh cleared depth
on the tiers without AO; with R5's transparent tracers, decals and fire that let them show through
walls.) Muzzle and ejection points read with `getWorldPosition` are already where the player sees
them. On the realistic tiers the Blender view models (R4) sit at their own hip pose
(`REAL_REST` in `weapons/models.ts`, visual only) and eye place at full aim, and read their muzzle, ejection port and sight
from the model's sockets. At full aim a Blender gun is drawn `REAL_AIM_DEPTH` (1.5) times further
out, scaled about the eye in step with the aim, so it looks the same but nothing the eye sees is
nearer than the camera's 0.08 m near plane (`NEAR`; the shotgun's stock, 6–9 cm under a cheek
weld, was cut open by it; `tests/weapon-assets.test.ts` checks that no triangle of a gun or hand
crosses the plane in view from the hip to full aim); its effects leave from the unscaled sockets (`ViewModel._socket`).

### 3.5 Typography and HUD look

- Display face: **Space Grotesk** 700 (titles, big numbers, weapon names, centre messages) and 500
  (labels). Body face: **Inter** 400/600 (hints, controls table, lists). Fallback stack:
  `'Space Grotesk', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`.
- HUD colour tokens (CSS custom properties on `#hud`, defined once in `styles.css`):

```css
:root{
  --fg:#F2F5FA; --fg-dim:#9AA6B8; --hot:#FF4757; --cool:#4C7DFF;
  --good:#37D67A; --warn:#FFB020;
  --panel:#131A26; --panel-2:#1B2433; --line:#2C3648;
  --shadow:0 10px 40px rgba(0,0,0,.45);
  --r:10px;                      /* uniform corner radius */
}
```

- No decorative tilt on HUD panels or text. Directional
  damage indicators and hit-marker bars keep their functional rotations. No multiply blend modes. Panels are `--panel` at 92 % alpha
  with a 1 px `--line` border, radius `--r`, and `--shadow`.
- Bars (health, boss, focus gauge) are solid fills, not hatch patterns. Low-health/ready states
  switch the fill to `--hot`. Every **size, position, duration and easing** in `hud-audio-ui.md`
  §3 is kept exactly, including the 0.15 s bar eases, the 0.2 s hit-marker animation, the 1.7 s
  kill-feed line life and the responsive rule at ≤ 900 px.
- The sniper scope mask uses `--panel` (opaque) instead of backdrop colour; geometry (30 vh radius,
  60.5 vh ring, dashed cross, 5 px centre dot) unchanged.

### 3.6 Post-processing

The two-pass tone pipeline (`rendering-effects.md` §6.1–6.2) is replaced by:

1. Render the scene into a `WebGLRenderTarget` (`RGBAFormat`, `HalfFloatType`,
   `LinearSRGBColorSpace`, depth buffer, no stencil, no mips, `LinearFilter`) sized canvas × render
   scale, with 0, 2 or 4 MSAA samples from the quality setting and, while AO or the soft particles
   are on, a 32-bit float `DepthTexture` (resolved with the colour when MSAA is on). Dynamic resolution never reallocates: the scene,
   GTAO and bloom draw into the lower-left share of their targets (`target.viewport`, and a
   scissor for the clear), each pass reads its source through a `uvScale` and clamps its taps to
   the last texel drawn, and the look pass scales the frame back up into the full-size 8-bit
   target (Low without SMAA: straight to the canvas), so SMAA, the sharpen and the feedback run at
   full size. A step is a few uniform and viewport writes. Targets reallocate only on a window,
   pixel-ratio or render-scale change; a pass switched off frees its targets (AO also its depth
   texture), and a frame allocates nothing. The rig is part of this pass (§3.4).
   The depth texture is also kept while light shafts are on (below).
   **Soft particles** (R5, Graphics → Soft particles; High and Ultra): when the realistic effects
   have anything in `Renderer.fxScene` (smoke, dust, fire), that small scene is drawn after the
   scene into a layer of its own (`Composite.drawSoft`: a single-sampled half-float target,
   premultiplied, cleared to clear; at half the scene target's size from 1400 rows up, a texel per
   CSS pixel at DPR 2, else full size). Each sprite reads the scene's depth at its pixel and fades
   out where it meets a surface (over 0.3 of its size) or lies behind it, rig included (the rig
   keeps its depth slice, as always), so the layer needs no depth test and no depth buffer. The
   bloom prefilter and the tone pass lay the layer over the scene colour (`withSoft`: colour × (1 −
   coverage) + layer) that frame only. Drawn into the multisampled scene target instead, as first
   built, the pass cost about 1 ms on Ultra for a single puff (the MSAA samples reloaded and the
   whole frame resolved again); the layer costs about 0.2 ms. Nothing in the scene: no layer drawn
   or read. Without MSAA the depth texture is the scene target's own, which the layer, drawing
   elsewhere, reads as well. A GPU with `WEBGL_multisampled_render_to_texture` (mobile) renders
   MSAA straight into the textures with no resolve and need not keep that pass's depth
   (`Renderer.msaaDepthReadable`): with MSAA on there, and with the setting off (Medium), the smoke
   draws in the scene pass behind a dither instead (interleaved gradient noise moved every frame and
   per puff; nothing under a tenth drawn), needing no sort.
2. The passes after it (`render/postfx.ts`, `Composite`), each switched by its quality setting:
   - **GTAO** (Ambient occlusion: half or full resolution): ground-truth AO after XeGTAO, 2 slices ×
     4 steps × 2 sides within 1.1 m, normals from depth, a 4 × 4 ordered noise that a depth-aware
     4 × 4 blur removes, squared. Applied as `mix(1, ao, 0.8 × ambient)` with a depth-aware
     upsample, so a wall's dark does not bleed onto the enemy in front of it; the rig and the sky
     get none. `ambient` is the scene target's alpha: every opaque lit material writes the share of
     its light that is not direct light there (a patched `opaque_fragment` chunk), so AO darkens
     ambient light only and a sunlit wall or grunt keeps its brightness.
   - **Bloom** (on/off): a soft threshold at exposed brightness 1.1 into half resolution, then a
     dual-filter chain down to 1/32 and back up, added at 0.05.
   - **Light shafts** (R8, Graphics → "Light shafts, lens dirt", Ultra's default; realistic tiers, and like the
     soft particles not with MSAA on a GPU that keeps no MSAA depth): at a quarter of the scene
     target's size, a mask of the open sky (depth at the far plane, four taps a texel) in a Gaussian
     0.1 screen heights round the sun's place on the screen (the disc and its halo), then a radial
     blur towards the sun in two passes (16 taps over the whole way, each 0.92 of the last; then 16
     over a sixteenth). The last pass fades the rays with their distance from the sun on the screen
     (a Gaussian 0.4 screen heights) and to 0.6 over a surface (the texel's own open sky, carried
     through the passes in green), so they stay round the sun and never veil the frame. Added in the
     tone pass before the exposure in the sun's hue, times the map's `shafts` strength
     (`ATMOSPHERE`) and 0.3. It fades as the sun leaves the frame by half a screen and is off behind
     the eye (no pass runs then). With bloom on it brings the **lens dirt**: a greyscale film of
     smudges, specks and streaks (`lensDirt`, 320 × 180, made once), times the bloom's 1/8-resolution
     level, added at 0.7, so a bright source (the sun, a muzzle flash, a blast) lights the specks
     round it.
   - **Look pass.** Low: one full-screen triangle (orthographic camera, depth test off) that samples
     the target (through FXAA on Low), multiplies AO and adds bloom when on, tone-maps it (identity
     to 0.8, then a soft roll-off to white, so the flat palette keeps its values), applies the
     mood's grade (gain in linear light; lift and contrast in a square-root space, so lift tints
     the shadows without raising black; then saturation; `GRADE` in `palette.ts`), then the four
     feedback overlays **exactly** as `rendering-effects.md` §6.3 specifies, in that order: hurt
     vignette (with the low-health pulse term), parry flash toward the background colour,
     slow-motion desaturation `mix(col, lum * vec3(0.8,0.86,1.0), slow*0.55)`. The "sketch
     modulation" `scr` becomes a constant `1.0` (no texture). It ends with
     `#include <colorspace_fragment>` for the canvas, or encodes sRGB itself when SMAA follows.
     Realistic: AO, the soft particles' layer, bloom and the lens dirt, the light shafts, the
     exposure (`1.2 × 2^mood.realistic.exposure`), **AgX** (with a mild
     punchy contrast; a colour that leaves the sRGB gamut moves towards grey at the same luminance
     until its smallest channel is 8 % of it, instead of being cut at 0), the mood's realistic
     grade (`REAL_GRADE`, saturation 1.03–1.05, its contrast an S-curve that keeps black at black:
     Downtown a clear cool morning, House a warm late afternoon, Mexico hot, Training neutral),
     sRGB with half a level of dither, into an 8-bit target.
   - **SMAA** (three's `SMAAPass`, anti-aliasing "SMAA" or "MSAA n× + SMAA") on the sRGB frame.
   - **Realistic final pass**: a light contrast-adaptive sharpen (AMD CAS, 0.35, its result kept
     inside the neighbours' range so hard edges get no halo), or FXAA when that is the
     anti-aliasing setting, then back to linear and the same four feedback overlays, last, to the
     canvas.
3. Nothing else. No outline detection, no hatching, no jitter, no grain. No TAA.

Low is exactly the phase-1 single pass; AO, bloom and SMAA also work on the flat look when a player
turns them on in Custom.

Quality (`render/quality.ts`): presets Low/Medium/High/Ultra plus Custom, auto-detected once per
device (touch, `deviceMemory`, cores, GPU renderer string, `maxTextureSize`) and checked by a
two-second benchmark in the menu backdrop, which steps Auto down one preset if it misses 60 fps
and a second sample at half the pixels runs faster than 0.9 of full (otherwise the miss is a
refresh cap or a CPU limit that a lower preset would not fix; the realistic look's shadow maps and
full-size SMAA and final passes do not scale, so a GPU-bound frame only falls to about 0.75). Phones and tablets always start on Low.
Stored in the versioned `cs6_gfx` record. `boot` applies every change live
(`Renderer.applyQuality`, `Effects.setDetail`, the frame limiter) and runs the dynamic-resolution
controller in every state, also before the benchmark has run. The controller's signal is the rAF
interval, so it tests its floor: if two seconds there have not bought 10 % over full scale, the
interval is a display or browser cap, which becomes the target, and the scale returns to full.
When it sits at its floor for about ten seconds while still missing, it offers a one-time "Lower
quality?" prompt (inside the menu panel while one is open) and never changes the preset by itself.

`§6.3 is normative and must not be reinterpreted` — it is gameplay feedback, not style.

---

## 4. Dependency graph

Runtime calls go through `ctx`. The arrows below are **static `import` edges only**.

Layers, lowest first. A module may only import from a **lower** layer (plus `three`).

```
L0  input          net                                  (no imports at all)
L1  util           audio  hud                           (util only)
L2  physics        render                               (util)
L3  nav            effects        players               (physics / render / util)
L4  level          weapons        enemies               (render + physics + util)
L5  player                                              (render + physics + util + weapons)
L6  main  +  src/game/*                                 (everything)
```

The only intra-layer-ish edge is `player -> weapons` (L5 -> L4), which is why they are on separate
layers. There is no path back: `weapons` never imports `player`, `enemies` never imports `players`,
`render` never imports anything above L1. The graph is acyclic; `main` is the only sink.


| Module | May import |
|---|---|
| `util` | `three` |
| `input` | *(nothing)* |
| `physics` | `three`, `util` |
| `nav` | `three`, `util`, `physics` (types/constants only) |
| `level` | `three`, `three/addons/utils/BufferGeometryUtils.js`, `util`, `render`, `physics` |
| `render` | `three`, `three/addons` (BufferGeometryUtils, RoomEnvironment, GLTFLoader, RGBELoader, SMAAPass), `util` |
| `effects` | `three`, `util`, `render` |
| `audio` | `util`, `audio.tunes.js` |
| `hud` | `util` |
| `player` | `three`, `util`, `render`, `weapons`, `physics` |
| `weapons` | `three`, `util`, `render`, `physics` |
| `enemies` | `three`, `util`, `render`, `physics` |
| `players` | `three`, `util`, `render` |
| `net` | *(nothing; reads the global `Peer`)* |
| `main` | everything, plus `src/game/*` |

`player → weapons` is the only gameplay-to-gameplay import (the player constructs its loadout).
`weapons` must never import `player`; it receives everything it needs through `ctx` and the
per-frame `WeaponState` record.

There are no other edges. If you find yourself needing one, you need a `ctx` hook instead.

---

## 5. Shared data structures

These shapes cross module boundaries. They are declared once, here.

### 5.1 The context object (`Ctx`)

Built by `main` during boot and passed to every subsystem constructor. `level` and `nav` are
**replaced** on every level rebuild — always read `ctx.level`, never cache it across a frame.

```ts
interface Ctx {
  // rendering / world
  scene:     THREE.Scene;
  camera:    THREE.PerspectiveCamera;
  renderer:  Renderer;
  world:     World;
  nav:       NavGrid;          // replaced on level rebuild
  bossNav:   NavGrid;          // same grid at boss clearance (0.95 wide, 5.1 m headroom); bosses path on it
  level:     Level;            // replaced on level rebuild

  // services
  input:     Input;
  hud:       Hud;
  effects:   Effects;
  audio:     Audio;
  net:       Net;

  // actors (assigned after their own construction; may be null during boot)
  enemies:   EnemyManager | null;
  player:    Player | null;
  remotes:   Map<string, RemotePlayer>;

  // hooks provided by main (section 5.2)
  game:      GameHooks;
}
```

Construction order in boot: `renderer` → `world` → `audio` → `net` → `level` → `nav` → `input`
→ `hud` → `effects` → settings → game state, lobby, scores and remotes → `game` hooks → `ctx`
literal → `enemies` → `player`. `Audio` construction does not create an audio context;
`Net` construction does not open a connection. Every service in `ctx` exists before an actor is built.
Any subsystem that needs `ctx.player` inside its constructor is wrong; read it at update time.

### 5.2 `GameHooks` — what `main` provides to everyone else

Every hook is always present (never `undefined`); the offline versions are cheap no-ops or return
empty results, so callers never need existence checks.

```ts
interface GameHooks {
  // time and score
  hitstop(duration: number, scale: number): void;
  addScore(points: number, label?: string | null): void;
  onPlayerDeath(): void;

  // player-vs-player (see game-loop.md §24-26, networking.md §9)
  targets(): Target[];                               // local player first, then remotes
  canHurt(t: Target): boolean;                       // online && t is not the local player
  raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null;
  playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[];
  hitPlayer(t: RemotePlayer, damage: number, info: HitInfo): void;
  cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean;
  onShot(end: THREE.Vector3): void;

  // breakable props (game-loop.md §29, levels.md §9.7)
  breakHit(prop: Breakable, damage: number, point: THREE.Vector3, dir: THREE.Vector3): void;
  breakablesInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): Breakable[];
  blastBreakables(center: THREE.Vector3, radius: number): void;

  // read-only state queries
  readonly state: GameStateName;                     // 'start'|'lobby'|'play'|'pause'|'dying'|'dead'|'over'
  readonly mode: 'solo' | 'ffa';
  isOnline(): boolean;                               // mode === 'ffa'
  inMatch(): boolean;                                // net.active && state is play|dying|over
  playing(): boolean;                                // state is play|dying
}
```

`PlayerHit` is `{ player: RemotePlayer; part: string; dist: number; point: THREE.Vector3 }`.

### 5.3 `Target` — anything an enemy or a blast can hurt

Implemented by `Player` (local) and `RemotePlayer`. `enemies.md` §18.4 is the behaviour contract.

```ts
interface Target {
  alive: boolean;
  isLocal: boolean;
  name: string;
  body: { pos: THREE.Vector3; vel: THREE.Vector3; halfW: number; height: number; onGround: boolean };
  center: THREE.Vector3;              // feet + height*0.55
  eye:    THREE.Vector3;
  forward: THREE.Vector3;
  right:   THREE.Vector3;
  readonly speed: number;             // |velocity|; remote players report 0
  readonly aiming: boolean;           // down sights; enemies read aiming/firing as "busy" cues
  readonly firing: boolean;
  readonly blockRadius: number;       // local: 0.95 while guarding and off cooldown, else 0; remote: 0
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;
  knockback(dir: THREE.Vector3, amount: number): void;
  tryDeflect(p: Projectile): false | { perfect: boolean; returned: boolean };   // remote: always false
  tryBlockMelee(e: Enemy): boolean;
}
```

### 5.4 Hit information

One record for every damage event, from any source, to any victim.

```ts
interface HitInfo {
  point?:  THREE.Vector3;    // world hit point
  dir?:    THREE.Vector3;    // unit direction the damage travelled
  part?:   string;           // 'head'|'torso'|'hips'|'armL'|'armR'|'foreL'|'foreR'|
                             // 'legL'|'legR'|'shinL'|'shinR'|'shield'|'blade'
  source?: string;           // 'rifle'|'shotgun'|'sniper'|'revolver'|'katana'|'focus'|
                             // 'deflect'|'blast'|'fall'|'grenade'
  crit?:   boolean;          // true only when part === 'head'
  dist?:   number;           // ray entry distance (guns, for falloff)
  slashDir?: number;         // katana swing side, +1 / -1
}

interface LastHit {          // player.lastHit, used for kill credit (game-loop.md §20)
  from: THREE.Vector3 | null;
  crit: boolean;
  amount: number;
  src: string;
}
```

### 5.5 Physics records

```ts
interface BoxData {
  noNav?: boolean;        // top face is not a nav surface
  noShoot?: boolean;      // see-through: rays, vision, particles pass
  noGrapple?: boolean;    // grapple ray passes
  tag?: any;              // free label, read by nobody
  breakable?: Breakable;  // back-reference set by level for prop colliders
  material?: MaterialTag; // R5: what the collider's piece is made of (level/build.ts writes it)
  surf?: SurfKey;         // and its flat-palette key; a bullet's impact and hole follow both
  overlays?: SurfaceOverlay[]; // R5: thin pieces with no collider laid on its faces (a path on the lawn)
}
interface Box { min: THREE.Vector3; max: THREE.Vector3; data: BoxData; id: number }
interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; box: Box }
```

`LevelBuilder` tags every collider it makes with a mesh (`box`, `cylinder`) with that piece's
material tag and surface key; at `finish` a bare collider (a `collider()` call standing for pieces
drawn without one: House's stair ramps and furniture, roof colliders) takes the tag of the visible
piece whose box it overlaps most. Boxes nothing visible stands for (the invisible map shell) stay
untagged and read as concrete (`render/impacts.ts`, `surfaceOf`). A thin visible piece with no
collider of its own (`noCollide`, at most 25 cm thick) whose inner side lies within 6 cm into or 12
cm off a collider's face goes on that collider's `overlays` (`_listOverlays`): House's path and
streets on the lawn, road paint, bands on walls. `Effects.bulletImpact` asks `surfaceAt` which piece
the eye sees at the hit (the outermost overlay over that spot, else the collider) and moves the hit
out to its face, so its recipe and hole are that piece's. Gameplay never reads these fields.

`Body` is a class declared by `physics` (section 6.3). Its fields are the authoritative list in
`physics-nav.md` §3.1.

### 5.6 Level records

```ts
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

interface Level {
  key: 'downtown' | 'mexico';
  arena: boolean;
  playerStart: THREE.Vector3;
  bounds: Bounds;
  spawns: THREE.Vector3[];        // ground enemy spawn points
  snipers: THREE.Vector3[];       // sniper perches
  pickups: THREE.Vector3[];       // pickup spots
  rings: THREE.Vector3[];         // fixed grapple anchors
  arenaSpawns: THREE.Vector3[];   // FFA spawns; empty => fall back to `spawns`
  teamSpawns: THREE.Vector3[][];  // built, read by nobody
  movers: GrappleMover[];         // moving grapple targets (drones)
  animated: Animated[];           // per-frame decoration
  breakables: Breakable[];        // Mexico only; id === index
  meshes: THREE.Object3D[];       // everything to remove on rebuild
  surfaces: LevelSurface[];       // every surface-palette mesh with its material tag (§3.1)
  dressing: LevelDressing | null; // R6: the realistic tiers' kit props, cables and grime; null on Training
  shadow: { center: THREE.Vector3; radius: number };   // directional-light shadow fit
}

interface LevelSurface {
  mesh: THREE.Mesh; surf: SurfKey;
  materials: readonly (MaterialTag | null)[];  // one per group; null = flat-only
  static: boolean;                              // baked with the level (R3)
  moving?: boolean;                             // a drone
  realOnly?: boolean;                           // R6 trim, kerbs, rock shells: drawn on the realistic tiers only, hidden on Low
  colours?: Float32Array;                       // V16 tints and the shells' strata, per vertex; put on the geometry only by a realistic look
}

// R6: visual only. Nothing here is a collider, a nav surface or a target.
type PropFamily = 'downtown' | 'house' | 'mexico';      // which kit glb the map dresses with
interface PropPlacement { piece: string; x: number; y: number; z: number; yaw: number;
  scale: [number, number, number]; tint: number /* sRGB over the piece's colours */; cell: number /* signs atlas cell */ }
interface CablePlacement { from: Vec3; to: Vec3; sag: number; radius: number }
interface DecalPlacement { cell: number /* grime atlas */; x: number; y: number; z: number;
  facing: '+x' | '-x' | '+y' | '+z' | '-z'; width: number; height: number; turn: number; strength: number }
interface LevelDressing { family: PropFamily; props: PropPlacement[]; cables: CablePlacement[]; decals: DecalPlacement[] }

interface GrappleMover { mesh: THREE.Object3D; radius: number }
interface Animated { mesh: THREE.Object3D; update(time: number): void }

interface Breakable {
  id: number;                     // index in level.breakables
  kind: 'potS'|'potL'|'crate'|'barrel'|'cactus'|'pinata';
  group: THREE.Group;             // its meshes; children become debris on break
  hp: number;
  pos: THREE.Vector3;             // centre = base + height/2
  alive: boolean;
  tone: number;                   // TONE id for its burst/debris tint
  box: Box;                       // its collider, removed on break
}
```

### 5.7 Pickup record (owned by `main`, `src/game/pickups.js`)

```ts
interface Pickup {
  id: number;                 // host-assigned online; local counter offline (both start at 1)
  kind: 'ammo' | 'health';
  mesh: THREE.Object3D;
  baseY: number;              // spot.y + 0.6
  phase: number;              // bob phase, uniform [0,6) at spawn
  life: number;               // 45 s; only the host / an offline game ages it
}
```

### 5.8 Enemy and projectile records

Full field list in `enemies.md` §3.1 and §11. The cross-module surface is:

```ts
interface Enemy {
  id: number;
  type: string;               // 'grunt'|'rusher'|'heavy'|'sniper'|'shield'|'bomber'|'flyer'|
                              // 'boss'|'hitbox'|'lagspike'
  stats: EnemyType;           // catalogue row: name, hp, speed, score, scale, boss, flying, tone…
  hp: number; maxHp: number;
  alive: boolean;
  state: 'spawn' | 'hunt' | 'stunned' | 'dead';
  body: Body;
  center: THREE.Vector3;      // torso world position (live vector)
  yaw: number;
  root: THREE.Group;
}

interface Projectile {
  id: number;
  pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3;
  damage: number; owner: Enemy | null; life: number;
  deflected: boolean; tone: number; thickness: number;
  origin: THREE.Vector3;      // spawn point; used as the "hit from" position
  blast: boolean;
}
```

### 5.9 Network wire formats

**Envelope** (`networking.md` §4). Every message is exactly this object:

```ts
interface Envelope {
  t: string;         // message type
  d: any;            // payload
  from?: string;     // set by the host on everything it sends (except `refused`),
                     // and on relayed copies (= original sender)
  to?: string;       // client -> host -> that client
  relay?: boolean;   // client asks the host to forward to all others
}
```

**Local state packet** `ps` — a flat number array, sent every 3rd network tick while in a match:

| Index | Field | Quantisation |
|---|---|---|
| 0,1,2 | body position x, y (feet), z | 2 dp |
| 3 | yaw | 2 dp |
| 4 | pitch | 2 dp |
| 5 | weapon index | int 0..3 (0 rifle, 1 shotgun, 2 sniper, 3 katana) |
| 6 | flag bits | int, table below |
| 7 | health | rounded int |
| 8,9,10 | velocity x, y, z | 1 dp |
| 11,12,13 | grapple hook x, y, z | 1 dp, **present only while grappling** |

Flag bits: `1` crouching, `2` sliding, `4` blocking, `8` aiming, `16` on ground, `32` firing,
`64` alive, `128` grappling, `256` parry window.

Decoding: velocity only if `length > 10`; hook only if bit 128 **and** `length > 13`; weapon index
outside 0..3 renders a rifle; a packet from an unknown id is dropped.

**Remote snapshot pair** used for interpolation:

```ts
interface Snap { p: THREE.Vector3; yaw: number; pitch: number; t: number }  // t = local arrival time (s)
```

**Score row**: `{ id: string, name: string, kills: number, deaths: number }`.
Table order is insertion order; display order is kills desc, then deaths asc.

**Lobby model** (held by `main`):

```ts
interface Lobby {
  players: Map<string, string>;   // peer id -> name, insertion ordered
  hostId: string | null;
  isPublic: boolean;              // default true
  status: string;
  code: string | null;
  map: string | null;             // null until the host sets one
}
```

### 5.10 `WeaponState` — player → weapon, once per frame

```ts
interface WeaponState {
  fire: boolean;          // fire held
  firePressed: boolean;   // fire went down this frame
  aim: boolean;           // gun: aim held with a gun; katana: aim held (= guard)
  reloadPressed: boolean;
  meleePressed: boolean;  // only when the katana is equipped
  sprinting: boolean;
  grounded: boolean;
  speed: number;          // horizontal speed
  sliding: boolean;
  lookDelta: { x: number; y: number };   // radians this frame, invert already applied
  strafe: number;         // -1..1
  bobPhase: number;
  bobAmt: number;
  landDip: number;        // clamp(-landDipSpring.value * 0.08, -0.5, 0.5)
  slideTilt: number;      // 1 while sliding else 0
  blockFire: boolean;     // true when the player is dead
}
```

The **neutral state** (dead, dash-locked, focus-driven slash) is the same object with
`fire/firePressed/aim/reloadPressed/meleePressed/sprinting = false`, `speed = 0`,
`blockFire = !player.alive`.

### 5.11 Global game state (owned by `main`, `src/game/state.js`)

```ts
type GameStateName = 'start'|'lobby'|'play'|'pause'|'dying'|'dead'|'over';

interface GameState {
  state: GameStateName;   // 'start'
  mode: 'solo'|'ffa';     // 'solo'
  menu: boolean;          // an overlay is open while state === 'play'
  time: number;           // game clock: += sdt while playing, += dt otherwise
  hitstopT: number; hitstopScale: number;
  wave: number; score: number; combo: number; comboT: number; kills: number;
  intermission: number; queue: string[]; spawnT: number; maxAlive: number;
  deathT: number;
  focus: FocusState;      // game-loop.md §15
  katanaStreak: number;
  boss: Enemy | null;
  respawnT: number; matchT: number;
  over: { id: string; name: string } | null; overT: number;
}
```

Constants: FFA kill target 20, FFA time limit 480 s, FFA respawn delay 3.5 s, max grenades 5,
katana slot index 3.

### 5.12 Persistent storage keys

All values are strings in `localStorage`, read and written **only** by `main` through `util.store`.

| Key | Default | Meaning |
|---|---|---|
| `cs6_map` | `downtown` | picked map key |
| `cs6_best` | `0` | best solo score |
| `cs6_music` | on (anything but `0`) | music wanted |
| `cs6_checkpoint` | `0` | highest checkpoint wave |
| `cs6_name` | `recruit` + random 10–99 | player name, ≤ 14 chars |
| `cs6_sens` | `100` | look sensitivity percent (25–250, step 5) |
| `cs6_invert` | off (`1` = inverted) | invert vertical look |
| `cs6_gfx` | Auto | graphics quality: versioned JSON (`{ v: 1, preset, custom, fpsCounter, auto }`), read and written by `render/quality.ts` |

---

## 6. Modules

Spec abbreviations used in the checklists:

| Tag | File |
|---|---|
| **GL** | `docs/spec/game-loop.md` |
| **PN** | `docs/spec/physics-nav.md` |
| **PI** | `docs/spec/player-input.md` |
| **W** | `docs/spec/weapons.md` |
| **E** | `docs/spec/enemies.md` |
| **RE** | `docs/spec/rendering-effects.md` |
| **HA** | `docs/spec/hud-audio-ui.md` |
| **N** | `docs/spec/networking.md` |
| **L** | `docs/spec/levels.md` |

---

### 6.1 `util`

**File:** `src/util.js`
**Imports:** `three`
**Responsibility:** pure math, springs, timers, RNG, angle/vector helpers, storage wrapper.
Zero state except the storage wrapper. No DOM, no scene, no `ctx`.

```ts
export const TAU: number;                                   // 6.283185307179586

export function clamp(v: number, a: number, b: number): number;
export function lerp(a: number, b: number, t: number): number;
export function damp(a: number, b: number, lambda: number, dt: number): number;   // exponential approach
export function smoothstep(a: number, b: number, x: number): number;
export function approach(cur: number, target: number, maxDelta: number): number;
export function easeOut(t: number): number;                 // 1 - (1-t)^3
export function easeInOut(t: number): number;               // cubic in-out

export function rand(a?: number, b?: number): number;       // uniform [a,b), defaults 0,1
export function randInt(a: number, b: number): number;      // inclusive both ends
export function choose<T>(arr: T[]): T;
export function randDir(out?: THREE.Vector3): THREE.Vector3;
export function shuffle<T>(arr: T[]): T[];                  // in-place Fisher-Yates, returns arr

export function wrapAngle(a: number): number;               // -> [-PI, PI)
export function angleLerp(a: number, b: number, t: number): number;   // shortest arc, not re-wrapped

export function v3(x?: number, y?: number, z?: number): THREE.Vector3;
export function round(n: number, dp: number): number;       // wire quantisation
export function round1(n: number): number;
export function round2(n: number): number;

export class Spring {                                       // PN 6.5
  constructor(k?: number, d?: number);                      // defaults 120, 14
  value: number; vel: number; target: number; k: number; d: number;
  update(dt: number): number;                               // 3 sub-steps when dt > 0.02
  kick(v: number): void;                                    // vel += v
  set(v: number): void;                                     // value = v, vel = 0
}

export class Spring3 {                                      // PN 6.6
  constructor(k?: number, d?: number);
  value: THREE.Vector3; vel: THREE.Vector3; target: THREE.Vector3;
  update(dt: number): THREE.Vector3;
  kick(x: number, y: number, z: number): void;
}

export class Cooldown {                                     // PN 6.7
  constructor(duration?: number);
  t: number; duration: number;
  update(dt: number): void;
  ready(): boolean;
  start(d?: number): void;
  frac(): number;
}

export function quatFromY(dir: THREE.Vector3, out?: THREE.Quaternion): THREE.Quaternion;
export function alignSegment(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3,
                             thickness?: number): void;      // PN 6.8; hides obj when |to-from| < 1e-5

export const store: {
  getStr(key: string, def: string): string;
  getNum(key: string, def: number): number;
  getBool(key: string, def: boolean): boolean;               // "1" true, "0" false
  set(key: string, value: string | number | boolean): void;
};
export const SKEY: { MAP: string; BEST: string; MUSIC: string; CHECKPOINT: string;
                     NAME: string; SENS: string; INVERT: string };
```

**Events:** none.

**Implementer checklist**

1. PN §6.1 scalar helpers (`clamp`, `lerp`, `damp`, `smoothstep`, `approach`) — exact formulas.
2. PN §6.2 random helpers, including the cube-biased `randDir`.
3. PN §6.3 angle helpers (`wrapAngle`, `angleLerp`).
4. PN §6.4 `v3`.
5. PN §6.5 scalar damped spring, including the 3-sub-step rule at `dt > 0.02`.
6. PN §6.6 3-D damped spring (per-component force, same k/d).
7. PN §6.7 cooldown timer.
8. PN §6.8 orientation helpers (`quatFromY`, `alignSegment` with the midpoint / +Y / thickness rule).
9. W §2 shared math helpers (`easeOut`, `easeInOut`).
10. GL §18.2 uniform Fisher–Yates `shuffle` (used to deal FFA spawn indices).
11. N §5 "Field formats" — the rounding helpers used by the wire format.
12. HA §9 / this file §5.12 — `store` and the key names/defaults.

---

### 6.2 `input`

**File:** `src/input.js`
**Imports:** *(nothing)*
**Responsibility:** merge keyboard, mouse and one standard-mapping gamepad into named boolean
actions plus a move vector and a per-frame look delta. Owns pointer lock and rumble. Knows nothing
about the game.

```ts
export type Action =
  'forward'|'back'|'left'|'right'|'jump'|'sprint'|'crouch'|'reload'|'grapple'|'melee'|
  'slot1'|'slot2'|'slot3'|'slot4'|'slot5'|'pause'|'confirm'|'grenade'|'dash'|'music'|
  'talk'|'score'|'fire'|'aim'|'nextWeapon'|'prevWeapon';

export class Input {
  constructor(canvas: HTMLCanvasElement);

  readonly move: { x: number; y: number };     // normalised only when |move| > 1
  readonly look: { x: number; y: number };     // radians THIS frame; +x turns left, +y looks up
  mouseSens: number;                           // default 0.0022 rad/px
  padSensX: number;                            // default 3.4 rad/s
  padSensY: number;                            // default 2.6 rad/s
  invertY: boolean;                            // default false

  readonly usingGamepad: boolean;
  readonly locked: boolean;                    // pointer lock element === canvas
  anyInput: boolean;                           // set by any key/mouse/pad activity; main clears it

  onLockChange: ((locked: boolean) => void) | null;
  onDeviceChange: ((device: 'keyboard' | 'gamepad') => void) | null;

  update(dt: number): void;                    // call FIRST every frame, with real dt
  down(a: Action): boolean;                    // the spec's "held"
  pressed(a: Action): boolean;
  released(a: Action): boolean;
  consume(a: Action): void;                    // force false for the rest of this frame
  anyPressed(): boolean;

  requestLock(): void;                         // raw movement, plain fallback, 1200 ms retry
  exitLock(): void;
  rumble(strong?: number, weak?: number, ms?: number): void;   // defaults 0.5, 0.5, 80
  dispose(): void;                             // remove every listener
}
```

**Events emitted:** `onLockChange(locked)`, `onDeviceChange('keyboard'|'gamepad')`.
**Events consumed:** DOM `keydown/keyup/mousedown/mouseup/mousemove/wheel/contextmenu`,
`pointerlockchange`, `visibilitychange`, window `blur`, Gamepad API polling.

**Implementer checklist**

1. PI §2.1 the action list, exactly these names.
2. PI §2.2 keyboard bindings by `event.code`; auto-repeat ignored; the Shift-modifier guard; the
   `preventDefault` set (Space, Tab, ArrowUp, ArrowDown).
3. PI §2.3 mouse bindings, wheel accumulator → one-frame `nextWeapon`/`prevWeapon`, the 400 px
   spike guard, context menu suppression, movement only while locked.
4. PI §2.4 gamepad button map, 0.35 analogue threshold, 0.14 dead zone, `|v|^1.8` response curve,
   full-deflection turn acceleration (×1 → ×1.9 over 0.25–0.85 s), pad selection.
5. PI §2.5 `down`/`pressed`/`released`/`consume`/`anyPressed`, including the gamepad-only edge
   clause and the documented side effect of `consume`.
6. PI §2.6 move and look vector assembly, normalisation rule, invert applied last.
7. PI §2.7 sensitivity fields (main writes them from storage).
8. PI §2.8 device switching and when `onDeviceChange` fires (not on mouse move).
9. PI §2.9 pointer lock: raw-movement attempt, plain fallback, 1200 ms retry, lock-wanted flag.
10. PI §2.10 clear all raw flags on page hide / window blur.
11. PI §2.11 rumble (dual-rumble, clamped, errors swallowed).
12. PI §2.12 no touch support.

---

### 6.3 `physics`

**File:** `src/physics.js`
**Imports:** `three`, `util`
**Responsibility:** the static AABB world, character bodies, push-out movement, raycasts, ground
probe, line of sight. No gravity, no gameplay, no scene access.

```ts
export const EPS: number;                       // 1e-4
export const seeThrough: (box: Box) => boolean; // skip boxes with data.noShoot

export class Body {                             // PN 3.1
  constructor(pos: THREE.Vector3, halfW: number, height: number, stepHeight?: number); // step 0.55
  pos: THREE.Vector3;                           // centre of the feet
  vel: THREE.Vector3;
  halfW: number; height: number; stepHeight: number;
  onGround: boolean; hitWall: boolean; hitCeil: boolean;
  wallNormal: THREE.Vector3; landVel: number;
  noSnap: boolean; alwaysStep: boolean;
  blockedX: number; blockedZ: number;           // internal, -1/0/+1
  min(out?: THREE.Vector3): THREE.Vector3;      // shrunken collision box, PN 3.2
  max(out?: THREE.Vector3): THREE.Vector3;
}

export class World {
  constructor();
  readonly boxes: Box[];

  addBox(min: THREE.Vector3, max: THREE.Vector3, data?: BoxData): Box;   // copies min/max
  finalize(): void;                             // (re)build the spatial hash
  removeBox(box: Box): void;                    // removes and re-finalizes
  clear(): void;

  query(min: THREE.Vector3, max: THREE.Vector3, out?: Box[]): Box[];     // strict overlap
  overlapsAABB(min: THREE.Vector3, max: THREE.Vector3): boolean;
  overlapsBody(body: Body): boolean;

  moveBody(body: Body, dt: number): void;       // sub-stepped integration; writes the body flags

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist?: number,
          ignore?: (box: Box) => boolean): RayHit | null;                // maxDist default 1000
  groundBelow(x: number, y: number, z: number, maxDrop?: number): number;// default 100
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, ignore?: (box: Box) => boolean): boolean;
}
```

**Events:** none. `World` never calls back into gameplay.

**Implementer checklist**

1. PN §2.1 every constant (epsilon 1e-4, hash cell 8, push-out 4 iterations, slack 0.03,
   step margins, sub-step cap 10 / min length 0.2 / 0.8 × half-width, ray defaults).
2. PN §2.2 collider record; min/max are **copied** on add.
3. PN §2.3 the data flags and who reads them.
4. PN §2.4 add / finalize / remove / clear, including "queries do not see a box until finalize but
   raycasts do".
5. PN §2.5 spatial hash keying and the per-query stamp de-duplication.
6. PN §2.6 strict overlap test (touching faces do not overlap); overlap queries ignore predicates.
7. PN §3.1–3.2 body record and the ε-shrunken collision box.
8. PN §3.4 axis push-out: candidate corrections, the `|move| + 0.03` limit, largest-magnitude wins,
   returned push sign.
9. PN §3.5 horizontal move with step-up: flat attempt, raised attempt, acceptance test, wall normal
   from push signs.
10. PN §3.6 one integration step: flag reset, `wasOnGround` for step permission, velocity zeroing,
    ground snap conditions.
11. PN §3.7 sub-stepping and how the flags are combined across sub-steps.
12. PN §4.1 raycast slab method: `tmax` seeded with the best distance, the "origin inside a box
    never hits it" rule, normal sign convention, returned record.
13. PN §4.2 export `seeThrough`.
14. PN §4.3 `groundBelow` (returns `y - maxDrop` on a miss).
15. PN §4.4 `lineOfSight` including the 1e-4 degenerate case.
16. PN §7.7 keep the public shapes exactly as tabulated.

Not this module's job: gravity (PN §3.8), the sweep patterns of PN §4.5 (each caller does its own),
the focus dash march (main).

---

### 6.4 `nav`

**File:** `src/nav.js`
**Imports:** `three`, `util`, `physics` (types only)
**Responsibility:** build a multi-level walkability graph from the collision world and answer A*
path requests. Read-only with respect to the world.

```ts
export interface NavNode { id: number; x: number; y: number; z: number;
                           ix: number; iz: number; links: NavLink[] }
export interface NavLink { to: number; cost: number; dy: number }
export type NavPath = THREE.Vector3[] & { complete: boolean };

export class NavGrid {
  constructor(world: World, bounds: Bounds, cell?: number, clearance?: number, headroom?: number);
                                        // cell 1.0; clearance 0.42 / headroom 1.85 for walkers, 0.95 / 5.1 for the boss grid
  build(): void;                                              // call once after level.finalize()
  readonly nodes: NavNode[];
  nearest(pos: THREE.Vector3, radius?: number, maxDrop?: number): number;  // node id or -1
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxExpand?: number): NavPath | null;
  randomNode(): NavNode | null;
}
```

**Events:** none.

**Implementer checklist**

1. PN §5.1 every constant, verbatim.
2. PN §5.2 grid layout, cell centres, node record.
3. PN §5.3 node generation: the thin probe column, distinct top faces of non-`noNav` boxes, the
   −5..70 window, the 0.6 × 1.35 × 0.6 clearance test against **all** boxes.
4. PN §5.4 link generation: neighbour order, ±1.35/−8 limits, the diagonal corner rule, the link
   clearance box, the drop column test. Links are directed.
5. PN §5.5 link cost with the climb multiplier and drop surcharge.
6. PN §5.6 nearest node: filtered score (weight 1.5) and fallback score (weight 2.0), radii and
   drop limits for start (3, 3) and goal (4, 8), rise limit 2.2.
7. PN §5.7 A*: binary heap, no decrease-key, per-search generation stamps, heuristic weight 1.15,
   expansion cap 40 000, "best so far" fallback, the `complete` flag.
8. PN §5.9 `randomNode`.
9. PN §5.10 rebuild rules — the grid is **not** rebuilt when a breakable's box is removed.
10. E §18.3 and L §4 restate the same numbers; they must agree.

---

### 6.5 `level`

**Files:** `src/level/index.js` (public), `build.js`, `downtown.js`, `mexico.js`, `props.js`, and for the
realistic tiers' dressing (R6) `dressing.ts` (the `Dresser` helpers) with `downtown-dressing.ts`,
`house-dressing.ts` and `mexico-dressing.ts`
**Imports:** `three`, `three/addons/utils/BufferGeometryUtils.js`, `util`, `render`, `physics`
**Responsibility:** build map geometry and colliders, place all markers, create breakable props,
merge static geometry per material, return the `Level` record.

```ts
export const LEVELS: { key: string; name: string; blurb: string }[];  // only "ready" maps
export function validKey(key: unknown): string;                       // unknown -> 'downtown'

export function buildLevel(scene: THREE.Scene, world: World, key?: string,
                           opts?: { arena?: boolean }): Level;
export function disposeLevel(scene: THREE.Scene, level: Level): void; // remove + dispose geometry

// internal helpers exported for the Mexico/Downtown builders and for tests
export interface BuildOpts { mat?: string; noCollide?: boolean; noNav?: boolean;
                             noShoot?: boolean; noGrapple?: boolean; tag?: any;
                             material?: MaterialTag; flatOnly?: boolean;    // R2: what it is made of; Low only
                             realOnly?: boolean; tint?: number;             // R6: realistic tiers only; a per-building shade
                             ownUVs?: boolean }                             // R6: the geometry brings its UVs (a displaced shell)
```

`buildLevel` must:

- add every collider through one internal helper taking `(cx, bottomY, cz, w, h, d, opts)` so
  "y" always means the bottom of a piece;
- call `world.finalize()` exactly once at the end;
- merge static visual geometry into **one mesh per surface material** and push those meshes plus
  every stand-alone object (drones, breakable groups, mariachi figures) into `level.meshes`;
- set `castShadow` and `receiveShadow` on the merged meshes;
- compute `level.shadow` = a sphere covering the play field (`center` = field centre,
  `radius` = the bounds half-size × 1.15).

**Events:** none. `level.animated[i].update(time)` is called by `main` every frame.

**Dressing (R6, V14, V16; realistic tiers only).** Each map's dressing (`dressDowntown`,
`dressHouse`, `dressMexico`, a `DressMap`; Training has none) runs in two passes (`DressPass`) of the
same code, each skipping the other's pieces. The *trim* pass runs after the map's builder and before
`finish` (its pieces are level geometry, baked with it). The *props* pass runs on the first read of
`level.dressing`, a lazy property `buildLevel` defines, which the renderer makes on a realistic look's
first frame (`_dress`): so Low never makes its tables. It scans a world of the colliders as built
(play removes breakables and adds charges), and trim never draws from the map's generator, so the two
passes agree. A `Dresser` (level/dressing.ts) finalises the world once (trim pass) so it can query the
colliders built so far, and places, all deterministically (tables and one seeded generator per map):

- *trim* (`realOnly` boxes: no collider, not a `pieces` entry, so impact tags and overlays stay as
  they were): plinths, cornices, pilasters, frames and sills round openings, window trim, kerbs, path
  edging, and `Dresser.room`'s skirting inside Downtown's blocks and every House room (with switches,
  conduit, radiators, pictures up high, dirt along the skirting, shelving where there is room); edges
  on the large masses: `stringers` down every stair flight's open sides (`LevelBuilder.flights` records
  each `stairs` call; the band's top follows the risers' feet, so it never rises over a tread),
  `fascia` round a slab's sides (the tower's floors, the highway deck, House's eaves and porch roof),
  `coping` along a wall's top over its solid runs (the highway's barriers, the perimeter's edge),
  House's corner boards.
  Mexico's rock stacks get `rockShell`s: each tier's four sides and top (and, on a tier over another,
  its underside) as grids with their own UVs (`ownUVs`, so a face stays one lightmap chart), the
  vertical and top edges cut back in a facet and the top edges broken back in places, stepped in the
  stack's strata and moved by noise, 6 cm out of the collider at most, one mesh a stack; the stack
  boxes themselves are `flatOnly`.
  `Dresser.facade` reads a facade's openings from its colliders (the wall boxes' rectangles on a grid
  of their own edges), so trim follows the real openings and never stands in one; a window a walker
  can step through (a floor within 0.6 m under it) gets no sill. `finish` merges realistic-only pieces
  into meshes of their own per surface key (`LevelSurface.realOnly`, built on `hiddenMat`); they are
  static, so they are baked with the level (R3).
- *kit props, cables and grime decals* on `level.dressing` (render/props.ts draws them). A floor
  piece inside the play space goes through `propIfClear`, which runs the walker grid's node test
  (nav.ts) on the cells round it and places it only where no node's column or link middle reaches
  it (`clearOfWalkers`); `tuck` tries clutter round the foot of the loose things on the ground
  (crates, containers, piers) the same way; `footDirt` lays the `edge-dirt` cell along a wall's foot,
  `scatter` groups grime where wear collects.

Two map-builder changes go with it (V14, V16): `BuildOpts.tint` gives a building a shade of its own,
carried as a vertex colour that the realistic materials multiply in (`realMat` has `vertexColors`).
The colours wait on the CPU (`LevelSurface.colours`, null where all white): the renderer puts a
`color` attribute on each level mesh when a realistic look goes on (white where it has none) and takes
it off again on the flat look while it has never been drawn, so Low never uploads it (the first level
is built before the quality is applied). Mexico's stepped box mesas (`MESAS`) and rock stacks
(`ROCK_STACKS`, exported with the same boxes and jitter) are `flatOnly`, so the realistic tiers show
the kit's faceted mesas and the shells in their place while Low keeps the boxes.

Nothing may stand where a walker goes or a line of fire runs: wall pieces stay within
`WALL_DEPTH` (0.12 m) of their wall below head height, floor pieces stand where the walker grid leaves
room or outside the play space (House's neighbourhood past its invisible walls, the Downtown
perimeter's top beyond the level's bounds), flat ones (decals, litter, stones) under `WALK_FLOOR`
(0.13 m), the rest hangs overhead. `tests/dressing-check.ts` checks every piece against the walk volume
(`WALK_COLUMN` round every walker-grid node and link middle a player can reach: a marker's component,
or one with a top a grapple lands on, as the rock stacks' tiers and the perimeter's top) and the
markers' open sightlines (tests/dressing.test.ts), and the gameplay hashes (colliders with flags and
impact tags, markers, nav graph, drone paths) must equal c2c96cf's. Where the long views stage their
grunts (tests/tiers.shots.mjs), the walls and ground they are read against keep their feet plain
(docs/VISUALS.md, R6, readability).

**Implementer checklist**

1. L §1.1 level list, display names, blurbs, `validKey` fallback.
2. L §1.2 build modes (arena on/off) and the rebuild contract.
3. L §2 coordinate and box conventions.
4. L §3.1–3.12 every primitive: box, slab, wall-with-gaps, stairs, rail (1.0-high `noNav`+`noShoot`
   collider), cylinder (1.6 r square footprint), sphere (visual only), grapple ring, markers,
   drones (orbit maths + mover radius), breakable prop, finish/merge.
5. L §4 collider flags and the `breakable` back-reference.
6. L §5 the level record fields.
7. L §6.1–6.13 Counter Slop 6: ground and perimeter, arena-only additions, central tower,
   buildings A and B, highway, row houses, south plaza, sky props, planes, marker totals, and the
   railing seams table (enemy reach depends on it).
8. L §7.1–7.11 Mexico: mesas and sky lid, plaza, bandstand and mariachis, church, adobe
   houses, banners, market with piñatas/crates/pots/barrels, taco cart, rocks and well, markers,
   sky.
9. L §8 bounds per map and mode.
10. L §9.1–9.9 the interfaces, especially §9.7 breakable hit points per kind.
11. GL §2 the fields `main` reads off the record, and the level-rebuild teardown order.
12. This file §3.1 — map every spec name to a surface palette key; §3.3 — shadow flags.

---

### 6.6 `render`

**Files:** `src/render/index.js` (public), `palette.js`, `materials.js`, `prims.js`, `figure.js`,
`postfx.js` (the pass chain, R8's light shafts and lens dirt), `atmosphere.ts` (R8: the haze's fog
chunk patch, shared uniforms and CPU mirror), `quality.ts`, `shadows.ts` (cascades), `sky.ts` (sky
streaming), `tactical.ts`,
`weapons.ts` (the realistic tiers' first-person weapons and arms, R4, and `weapon-assets.json`),
`operators.ts` (R7: the realistic operators' streamer `OperatorAssets`, `OperatorBody`, and
`operator-assets.json`), `operator-motion.ts` (R7: the clips' library and blending), `fx.ts` (R5: the effect atlases' manifest `fx-assets.json` and streamer `FxAssets`, the effect
materials, flipbook timing, `FX_UNIFORMS`), `impacts.ts` (R5: material tag → surface family →
impact recipe), `props.ts` (R6: the detail kit's manifest `prop-assets.json`, streamer `PropAssets`,
merging of a map's dressing, decals, cables, the drone)
**Imports:** `three`, `three/addons` (BufferGeometryUtils, RoomEnvironment, GLTFLoader, meshopt decoder, RGBELoader, SMAAPass), `util`
**Responsibility:** the renderer, scene, camera, lights, shadows, the full-screen composite pass,
the whole material/palette system, low-poly primitive factories, and the **shared humanoid /
blob / flyer figure builder** used by both `enemies` and `players`.

```ts
// ---- palette.js
export const TONE: { PRIMARY: 0; HOSTILE: 1; DARK: 2; ACCENT: 3; HEAL: 4; BOSS: 5 };
export const TONE_HEX: number[];                       // index -> 0xRRGGBB
export const WHITE_HEX: number;                       // 0xFFFFFF, instanced base colour
export const SMOKE_HEX: number;                       // 0xDDE4EC, pale smoke rings
export type SurfKey = 'sky'|'fog'|'ground'|'road'|'block'|'blockAlt'|'blockDeep'|'roof'|
                      'wood'|'metal'|'dark'|'accent'|'foliage'|'water'|'hot'|'boss';
export const SURF: Record<SurfKey, number>;

// ---- materials.js
export function surfMat(key: SurfKey): THREE.MeshLambertMaterial;     // cached, flatShading
export function charMat(color: number): THREE.MeshToonMaterial;       // cached per colour
export function toneMat(tone: number): THREE.MeshToonMaterial;        // cached, character family
export function unlitMat(color: number): THREE.MeshBasicMaterial;     // cached
export function characterMat(): THREE.MeshStandardMaterial;          // V12: the Blender characters' one material (vertex colour and pbr attributes)
export function propMat(): THREE.MeshToonMaterial;                    // the flat weapon props, vertex-coloured toon
export function weaponPropMaterial(set: string): THREE.MeshStandardMaterial;  // an enemy's Blender gun (weapons.ts owns it), PROP_METALNESS of its maps' metal
export function ownMaterial<T extends THREE.Material>(material: T, tint: HitTint, mark?: number): T;  // V15: a figure's copy, same program
export function mergeByMaterial(parts: { geo: THREE.BufferGeometry; key: SurfKey }[]): THREE.Mesh[];

// ---- prims.js  (all return geometry; positions in local space, low-poly segment counts)
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry;
export function cylGeo(r: number, len: number, seg?: number, axis?: 'x'|'y'|'z'): THREE.BufferGeometry;
export function sphereGeo(r: number, seg?: number): THREE.BufferGeometry;
export function coneGeo(r: number, len: number, seg?: number): THREE.BufferGeometry;
export function torusGeo(r: number, tube: number, seg?: number, rings?: number): THREE.BufferGeometry;
export function starGeo(points: number, outer: number, inner: number): THREE.BufferGeometry;
export function ringGeo(r: number, thickness: number, seg?: number): THREE.BufferGeometry;

// ---- figure.js  (shared skeleton; E 4.2-4.5, N 11.1/11.3)
export type FigureKind = 'humanoid' | 'blob' | 'flyer';
export type HitPart = 'head'|'torso'|'hips'|'armL'|'armR'|'foreL'|'foreR'|
                      'legL'|'legR'|'shinL'|'shinR';
export interface FigureOpts {
  kind: FigureKind;
  blob?: 'bomber'|'hitbox'|'lagspike'; // blob accessory set; default bomber
  color: number;                 // tone hex
  scale?: number;                // type scale, default 1
  bodyWidth?: number; headSize?: number; limbR?: number;
  hat?: 'none'|'cap'|'band'|'helmet'|'hood'|'crown';
  smile?: boolean;
  shield?: boolean;
  weapon?: 'none'|'rifle'|'shotgun'|'sniper'|'blade'|'hammer';
}
export interface Figure {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;      // hips, torso, head, shoulderL/R, upperL/R, foreL/R,
                                              // thighL/R, shinL/R, gunMount, shield, tip …
  anchors: Record<HitPart, THREE.Object3D>;   // hit-sphere centres, world-updated by the owner
  setEyes(dead: boolean): void;               // normal eyes / X eyes
  setWeapon(kind: 'none'|'rifle'|'shotgun'|'sniper'|'blade'|'hammer'): void;
  setTint(amount: number, color: number): void;  // V15 hit tint; tactical figures only
  lend(part: THREE.Object3D): () => void;          // a part (or the root) handed to effects.debris: its own materials stay until the returned call (the debris's `gone`)
  dropShield(): THREE.Object3D | null;        // detach for debris, remove its anchor
  dispose(): void;
}
export function makeFigure(o: FigureOpts): Figure;
export function makeWeaponProp(kind: WeaponPropKind): THREE.Group;   // remote-player hand props, N 11.3; callers map slot -> kind (render knows no loadout)
export function figureTemplate(): THREE.Object3D | null;             // the merged characters and a flat prop, for Renderer.prewarm
export function usePropSource(source: PropSource | null): void;      // the renderer's WeaponAssets: the realistic tiers' Blender props
export function flashAmount(left: number, length: number): number;   // V15: the tint left seconds before a flash ends
export function makeNameTag(name: string): THREE.Group;      // N 11.2; opaque generated canvas label

// ---- index.js
export interface PostFX { hurt: number; flash: number; slow: number; lowHp: number }
export class Renderer {
  constructor(canvas: HTMLCanvasElement);
  readonly three: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: THREE.Group;                  // child of camera; a flat weapon root has scale 0.46, a Blender one 1 (metres)
  readonly sun: THREE.DirectionalLight;
  resize(): void;                             // self-registered on window resize
  readonly cascades: THREE.DirectionalLight[]; // dark shadow-only lights for cascades 1+ (High, Ultra)
  readonly probe: THREE.LightProbe;           // realistic tiers: the sky's SH irradiance
  readonly skyPending: boolean;               // a realistic tier is still streaming the map's sky
  readonly weapons: WeaponAssets;             // R4: streams weapons.glb and its maps on realistic tiers (downloads at once, uploads once the level's bake and texture sets are on); compiles and warms (one hidden draw of the live template) their programs as soon as the glb is in; the view models subscribe
  readonly weaponsPending: boolean;           // a realistic tier is still streaming the weapons (or a new size of them)
  readonly fx: FxAssets;                      // R5: streams the effect atlases on realistic tiers while the effects listen; uploads once the level's bake and sets are on; frees them on Low
  readonly fxScene: THREE.Scene;              // R5: the soft particles, drawn after the scene into their own layer when soft particles are on and it holds something
  readonly msaaDepthReadable: boolean;        // R5: false with WEBGL_multisampled_render_to_texture (no soft particles with MSAA there)
  readonly fxLights: THREE.PointLight[];      // R5: FX_LIGHTS pooled point lights, always in the scene on realistic tiers (dark until an effect takes one); none on Low
  readonly props: PropAssets;                 // R6: streams the map family's kit glb (past a match's quiet start) and the signs and grime atlases on realistic tiers (after the level's bake and sets), merges the dressing, puts the kit's drone on the movers; frees it all on Low
  readonly propsPending: boolean;             // a realistic tier's kit (or the current map's merge of it) is still to come in
  fxContext(): RealContext | null;            // R5: where the realistic effects draw, once the atlases are in; null on Low
  readonly streaming: boolean;                // a realistic tier's sky, level bake or sets, weapons or effect atlases are still to come in
  readonly gpuBehind: boolean;                // streaming, with 6 frames unfinished on the GPU (vsync off): boot skips this one (render/pacing.ts)
  setLive(live: boolean): void;               // boot, every frame: a match is being played (no menu over it, or online); its first 3 s stay quiet
  prewarm(root: THREE.Object3D): void;        // compile a template's programs (the characters', a pickup's) for every look, and draw it once with the shadow maps, at the menu
  applyQuality(values: GfxValues): void;      // live: look, pixel ratio, render scale, AA, AO, bloom, light shafts, shadows, view distance
  setDynamicScale(scale: number): void;       // dynamic resolution: the drawn 0-1 share of each target
  setLevelShadow(center: THREE.Vector3, radius: number): void;
  setMood(mood?: Mood): void;                 // sky, sun disc, light, fog range, haze and shafts (R8), grade, exposure; streams the sky
  fogAt(distance: number, eyeY: number, pointY: number): number; // R8: the fog's share (linear and haze) the look in force draws on that ray
  prepareRig(root: THREE.Object3D): void;     // shadow flags, draw order, depth clear, once on attach
  setViewFov(fov: number): void;              // V8: scales the rig in camera space (§3.4); the player camera calls it
  render(time: number, fx: PostFX): void;     // called last, exactly once per frame
}
```

**Events:** listens to window `resize`. Emits nothing.

`makeNameTag` makes an opaque 0.5 × 0.28 × 0.02 plaque with a generated `CanvasTexture` label.
Draw the bounded name with the canvas text API (no HTML or external images). Render owns its
unique label material and texture; the returned group's `userData.dispose()` releases them and
its geometry, and is safe to call twice. The remote owner calls it when removing the tag on
ragdoll, respawn replacement or disposal. Keep the placement and billboard rule of N §11.2.

**Characters (V12).** `tactical.glb` is optimised by `tools/characters/build.mjs` (simplified,
deduplicated, quantised and meshopt-compressed: 1.1 MB, `character-assets.json` holds its size and
hash). `loadTacticalModels` (boot, before the game starts) merges each `<kind>__<part>-surface`
tree into one mesh per rigid pivot on `characterMat` (§3.2), in the part's own space, so the pivots
`makeFigure` builds, and every name the AI, specials and animations reach through `figure.parts`,
stay as they were; the nodes the game moves by name (`TACTICAL_NODES`: the carrier's payload, the
aimbot's vent, the moderator's ring, the ragequit's cleaver) stay nodes of their own. A humanoid
is 11 meshes and its prop (about 50 before), a spawn builds only nodes, and only the body, head
and legs cast shadows (the arms, props and small machine parts do not). Hit areas are the merged
meshes' own triangles, the same ones, tagged per pivot as before (`tests/characters.test.ts` casts
the same rays at both). Weapon props are built once per kind and shared: the flat look's are one
vertex-coloured mesh each (`propMat`), and on the realistic tiers an enemy holds the Blender gun's
LOD (`prop__<kind>` in `weapons.glb`: no hands, glass or clips, one mesh of its set's material,
1,200 triangles), which `WeaponAssets.prop` serves once the weapons are in; live figures swap props
when that changes (`PropSource.subscribeProps`), and `WeaponAssets.clear` hides the copies it cannot
swap (a dropped gun in the debris) before it frees their geometry and maps. The hammer stays flat.
A figure's own materials (V15) outlive it while any piece it lent to the debris (`Figure.lend`,
passed to `effects.debris` as `gone`) is still there; a ragdolled remote player and a dead flyer lend
their whole root and dispose the figure at once. `figureTemplate()` (every
merged part and a flat prop) is prewarmed at the menu: compiled and drawn once with the shadow
maps, so a match's first spawns link, upload and first-draw nothing; the Blender props' programs
warm with the weapons' template.

**Detail kit (R6, V14, V16), realistic tiers.** `render/props.ts` (`PropAssets`, owned by the renderer,
its `root` in the scene) streams `public/props/<family>.glb` (the common pieces and the family's own,
made by `npm run props` from `tools/blender/props/`) and the `signs` and `grime` atlases at the Textures
size (the signs at 1024 at least, `atlasSize`), in the upload slots once the level's bake and sets are on; the glb is fetched
(`fetch`) only past a match's quiet start, as three parses it on the main thread; Low fetches none. On the level's first realistic
frame `_dress` reads `level.dressing` (making its tables) and adds the dressing's texture sets (`dressingSets`) to the level's, so the kit's materials (`kitMat`: the
level's PBR patch, smooth-shaded, white over the set's mean so the vertex colour is the albedo; grid-lit,
or sky-probe-only for backdrops) wear the level's streamed maps. `mergeDressing` merges the placements
(transformed, tinted, UVs re-stretched to square texels as the level's, a sign's face mapped to its cell):
the pieces that cast shadows (with the cables) and the small pieces each per 32 m cell (`PROP_CELL`,
so the camera and each shadow cascade cull cells; the small ones hidden beyond 48 m, `update`), the
backdrops in one mesh; each draws once per texture set, and each caster cell's shadow pass is one run,
like the level's `_casters` (the shadow pass swaps them in only on frames that redraw the maps). Medium (the low Textures size,
`propDetail`) merges in cells twice as wide and hides the small pieces from 24 m; a Textures change across it merges again. Once
uploaded, the merged arrays are dropped (`freeOnUpload`). The decals are one mesh on `grimeMat` (multiplied over the frame, faded to white by
the fog), the cables tubes in the shadow mesh. The merge compiles and draws once unseen (the held
compile and warm-up, in a match past its quiet start too) before it is shown; then each drone
(`level.movers`) takes the kit's drone as a child at the mover's scale, and its flat cone the hidden
material (`_applySurfaces` keeps it hidden). A new map re-merges from the kit in memory; Low frees it all
and gives the cones back.

**Operators (R7), realistic tiers.** `render/operators.ts` (`OperatorAssets`, owned by the renderer)
streams `operators.glb` (LOD0, for the Textures setting's 1K and 2K: High and Ultra) or
`operators-lod1.glb` (LOD1, its 512: Medium) and the three texture sets at the Textures size, in
the upload slots after the level's bake and sets, never in a match's quiet start, and only in a game
that prewarms the characters' template (boot); Low fetches none. Made by `npm run operators`
(`tools/characters/operators.mjs`, the Blender scripts in `tools/blender/characters/`). Each kind is
one skinned mesh per set on an armature whose bones sit on the pivots `makeFigure` builds (same
names, rest positions and parents; the nodes the game moves by name are bones too), plus bones of
its own (`chest`, the feet, the drones' rotors). Every figure with a Blender model enlists with it
(`FigureRig`, `useOperatorSource`): a figure made once the operators are in wears one at once (at
spawn); one already in play when a session's first operators land puts it on only in a frame where
the camera cannot see it (`OperatorAssets.frame`, before each render), so nothing changes looks
mid-fight; after a settings change (another LOD or size, or Low to a realistic tier) the figures in
play at the change put the new one on as soon as it is in, in view or not (`#settle`). Low, a lost
context or a LOD change takes every operator off at once. A glb that does not match
`operator-assets.json` is freed with a warning and the flat models stay (`pending` turns false). LOD1
is simplified with each mask's face and paint locked (`tools/characters/operators.mjs` `maskLock`).
A worn operator (`OperatorBody`):
- **Hit areas do not change.** The flat model's merged parts stay on their pivots as the hit
  surfaces, moved to `HIT_LAYER` (30): `raycastFigure`'s ray tests that layer, no camera draws it
  (nor the shadow pass). Radii, parts and anchors are the flat model's; the skinned mesh has no ray
  test of its own. `tests/operators.test.ts` casts the same rays at every kind worn and flat.
- **Bones follow the pivots.** Each frame a bone copies its pivot's local position, rotation and
  scale, times the clips' rotation for it (`OperatorMotion.delta`); a pivot lent to the debris (a
  torn-off limb) folds its bone to nothing, and the limb takes a rigid copy of its part of the
  operator (`GIB_BONES`: the triangles whose heaviest bone is in its subtree, sharing the mesh's
  attributes, placed by the bone's inverse bind matrix). A hidden node (the carrier's dropped
  payload) folds its bone. The V15 death poses drive the pivots, so they drive the operator.
- **Clips** (`render/operator-motion.ts`): the owners (`enemies/model.ts` `drive`, `players.ts`)
  tell the figure's `motion` its speed, stride phase, sideways share, aim, carry and crouch each
  step, and the one-shots as they happen (a gun's shot and the reload after a long gun's burst, a
  hit, a throw; the melee at the swing's progress; a blade's projectiles, the parry's deflections,
  play no recoil). `loopWeights` blends idle, walk, run and the strafes by speed and
  direction, with the crouch and aim poses on top; the stride loops play at the procedural phase,
  so the feet do not slide. The support hand reaches the gun's foregrip (or the pistol's grip) by
  two-bone IK on the left arm's bones while it aims. None of it touches a pivot.
- **The prop** moves from the weapon group into a socket under the gun forearm's bone (the prop's lay),
  so the gun moves with the clips: a Blender gun at its true size (`OPERATOR_PROP_SCALE` undoes the flat
  figures' 1.25) with its grip in the glove's fist (`FIST`, per-gun `PROP_HOLDS`), a flat prop by its
  origin. The weapon group keeps its `tip` on the pivots, where projectiles leave from. A lent gun
  (dropped) takes its prop back, and so does a lent limb that carries it (the gun arm, the torso), so
  the gun flies off with it as on Low. While it aims, the left arm's bones reach for the prop's handguard
  (`PROP_HOLDS.support`) by two-bone IK, or as far along the gun from the grip as they reach.
- **Draws and shadows.** One skinned draw per set a kind wears (a humanoid 1-2, a machine 1-2) and the
  prop; at most 15 an enemy (tested). Each skinned mesh is frustum-culled per camera and per shadow
  cascade by its kind's sphere (`KindTemplate.bounds`, set as the mesh's `boundingSphere`, so three never
  skins vertices on the CPU for it): the rest pose's, each vertex free to swing about the joint its limb
  hangs from, plus `BOUNDS_MARGIN` for the trunk's moves; the swap's "out of view" test uses it too. The
  shadow pass draws them with `levelDepthMat` (no map sampled), since three's shared depth material keeps
  the last caster's `map` and would bind an operator map a Textures change freed. Its materials are the
  figure's own tinted copies (`FigureRig.own`), freed when it comes off or the figure goes.
- **Clips only while worn.** `FigureRig.worn` says a figure wears an operator; the owners skip the clip
  state otherwise (Low, or a stand-in), and a corpse (enemy or remote player) lets its loops fade
  (`STILL`). The clip layer allocates nothing a frame (clips by group and name, reused inputs).
- **Warm-up.** When a glb lands its programs compile and it is drawn once where nobody sees it, with
  its shadow pass and a rigid gib, before any figure wears it; the renderer holds its template with
  the characters' (`_warmPrograms`), so no program links once every kind has spawned.

**Implementer checklist**

1. RE §2 renderer creation, pixel ratio, resize behaviour, the HUD layer sitting above the canvas.
2. RE §3.1 camera parameters and rotation order.
3. RE §3.6 the weapon rig: child of the camera, scaled in x and y only for the view-model FOV (§3.4); each flat weapon root has uniform scale 0.46,
   applied exactly once (the Blender models of the realistic tiers are in metres, scale 1). Only the equipped weapon is visible, drawn in front of the world, never shadowed.
4. RE §4 → **replaced by** this file §3.3 (sun + hemisphere + quality-dependent PCF shadows + fog).
5. RE §5 → **replaced by** this file §3.1–3.2 (the material families, per-instance colour, the
   hit tint of V15), keeping RE §5.4's flash triggers.
6. RE §6.1–6.2 → **replaced by** this file §3.6 (single scene pass into a render target).
7. RE §6.3 **kept verbatim**: the four intensities and the exact overlay formulas and order.
8. E §4.2 humanoid template: every vertical offset, the limb lengths, the shoulder/leg offsets,
   the weapon mount at `(0, -0.29, 0.07)` on the right forearm, the muzzle tip z (0.78 gun /
   0.92 blade / 0.6 hammer), the shield plate placement, the 0.95–1.06 head jitter.
9. E §4.3 the hit-anchor set and radii table (the owner reads world positions from `anchors`).
10. E §4.4 bomber / blob template (body sphere, arms, legs, cap, fuse, spark; hitbox block;
    lagspike's 9 spikes).
11. E §4.5 flyer template (cone, wings, tail, face group).
12. N §11.1 remote skeleton dimensions (identical to the humanoid template) and §11.3 the four
    weapon props.
13. W §17.1 the primitive helpers the gun view models need (`box`, `cylinder`, `sphere`, `frame`,
    `hand`, anchors, the flash star cluster).
14. HA §1 the canvas/HUD layering requirement (canvas side only).
15. This file §3 in full — the visual target is this module's product.

---

### 6.7 `effects`

**Files:** `src/effects.ts`, `effects-real.ts` (R5: the realistic tiers' pools and recipes)
**Imports:** `three`, `util`, `render`
**Responsibility:** all particles, decals, blood pools, rigid debris, tracers, explosions, casings,
the pooled lights' use, and the shared screen-shake accumulator. Pools are instanced meshes owned
by this module.

Two sets of recipes (docs/VISUALS.md, R5, V5, V10, V11). The flat look keeps its eight instanced
pools and recipes, with the cheap fixes: tracers are ribbons in one more pool (`effects:tracers`,
every tier), the flash is additive and a size per gun, holes and sparks take the hit surface's
colour, decals are polygon-offset. While a realistic look is in force and its atlases are in,
`boot` hands the renderer's `fxContext()` to `setRealistic`, and the recipes go to `RealEffects`
(`effects-real.ts`): flipbook sprites (a fire pool, additive; a lit pool of smoke, dust, chips,
splinters, shards and shockwave rings, soft or dithered), lit decals (bullet holes by surface
family, scorch marks), bouncing casings and the pooled lights. Every pool is a fixed size scaled by
the effects detail, the oldest slot reused when full; `setRealistic(null)` (Low, or the atlases
freed) disposes them all, and a change of soft particles builds them again. A hazard's smoke cloud
handle (`smokeCloud`) reports `live` false once the `RealEffects` that made it is cleared or freed,
and the hazard asks for a new one; cloud stamps are their own counter, so stopping a cloud trims
only its puffs.

```ts
export interface ParticleSpec {
  kind: 'drop'|'stroke'|'emitter';
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life?: number; size?: number; tone?: number;
  gravity?: number; drag?: number;
  collide?: 'none'|'decal';
  stretch?: number; fixedLen?: number; axis?: THREE.Vector3;
  decalSize?: number; shrink?: boolean; grow?: number;
  rate?: number; emitDir?: THREE.Vector3;
}

export class Effects {
  constructor(scene: THREE.Scene, world: World);
  shake: number;                       // read-modify-written by the player camera step
  shakeFrom: THREE.Vector3;            // weighted source of directional jolts (V17)
  shakePush: number;                   // their strength; the camera step consumes and zeroes it
  detail: number;                      // effects-detail share, 0.1-1 (quality setting)

  push(from: THREE.Vector3, amount: number): void;  // a jolt the camera tips away from
  setDetail(scale: number): void;      // thins cosmetic particles and pool use; tracers exempt

  update(dt: number): void;            // scaled dt while playing, real dt otherwise
  clear(): void;                       // particles, growing pools, debris, pool counters

  // recipes — every default matches RE section 8
  sparks(point: THREE.Vector3, normal: THREE.Vector3, tone?: number, n?: number, speed?: number): void;
  strokeBurst(pos: THREE.Vector3, tone: number, n?: number, speed?: number,
              o?: { life?: number; size?: number; gravity?: number; drag?: number; stretch?: number }): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, tone?: number, thick?: number, life?: number): void;
  bulletTracer(from: THREE.Vector3, to: THREE.Vector3, thick?: number, life?: number): void;  // a bullet's: warm white on realistic tiers
  bulletImpact(point: THREE.Vector3, normal: THREE.Vector3, surface?: BoxData | null, from?: THREE.Vector3 | null): void;  // recipe from the collider's tag
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, scale?: number): void;   // enemies, remote players: side-on flash
  muzzleLight(pos: THREE.Vector3, scale?: number): void;                       // the player's shot: 50 ms of pooled light (realistic)
  muzzleSmoke(pos: THREE.Vector3, dir: THREE.Vector3, wisp: boolean, amount?: number): void;  // per shot; a wisp after a burst (realistic)
  smokeCloud(pos: THREE.Vector3, radius: number, duration: number): { stop(): void } | null;  // hazard smoke, realistic tiers
  setRealistic(context: RealContext | null): void;
  readonly realistic: boolean;
  blood(pos: THREE.Vector3, dir: THREE.Vector3, amount?: number, o?: { tone?: number }): void;
  drip(pos: THREE.Vector3, amount?: number): void;
  fountain(pos: THREE.Vector3, dir: THREE.Vector3, dur?: number, tone?: number): void;
  shell(pos: THREE.Vector3, vel: THREE.Vector3, tone?: number, size?: number, kind?: ShellKind | null): void;  // realistic: a bouncing casing
  smoke(pos: THREE.Vector3, dir: THREE.Vector3, n?: number): void;
  explosion(pos: THREE.Vector3, radius?: number, tone?: number, scorch?: boolean): void;  // realistic: a scorch (a dark blast's by default; charges, payloads) or the tone's splat
  boom(pos: THREE.Vector3, radius?: number): void;
  bloodPool(pos: THREE.Vector3, size?: number, tone?: number): void;
  decal(point: THREE.Vector3, normal: THREE.Vector3, tone: number, size: number,
        kind?: 'splat'|'hole', streakDir?: THREE.Vector3 | null, stretch?: number): void;
  splat(point: THREE.Vector3, normal: THREE.Vector3, tone: number, size: number,
        streakDir?: THREE.Vector3 | null, cluster?: number): void;
  debris(mesh: THREE.Object3D, pos: THREE.Vector3, vel: THREE.Vector3, angVel: THREE.Vector3,
         o?: { life?: number; radius?: number; blood?: boolean }): void;
  particle(p: ParticleSpec): void;     // raw spawn (boss stomp ring)
}
```

`debris()` re-parents a **caller-owned** mesh into the scene with `scene.attach` semantics and owns
it from then on; the caller must not remove it.

**Events:** none. Read/writes `effects.shake` (the player camera step decays it).

**Implementer checklist**

1. RE §7.1 pool shapes and capacities (drops 700, strokes 600, 5 × splat 300, holes 260) and the
   full/ring-buffer behaviour.
2. RE §7.2 particle model and every default.
3. RE §7.3 simulation: emitters, gravity/drag integration, the decal sweep (padding `size × 0.5`,
   see-through predicate), removal below y = −10.
4. RE §7.4 drawing rules for drops and strokes (shrink/grow, stretch, fixed-length tracers).
5. RE §7.5 decal placement, lift-off, streak orientation, scale ranges.
6. RE §7.6 the wrapping surface search.
7. RE §7.7 splat clusters including the 75 % wall-drip rule.
8. RE §7.8 growing blood pools (3 marks, easing, durations).
9. RE §7.9 rigid debris: cap 70, bounce maths, bloody trails, the last-0.6 s shrink.
10. RE §7.10 `clear()` (does **not** reset shake).
11. RE §8.1–8.13 every recipe with every constant.
12. RE §10 the tracer geometry rules (callers pass end points; the katana arc and enemy swing arcs
    are drawn by their owners through `tracer`). Since R5 they draw as ribbons in `effects:tracers`
    (no longer fixed-length strokes), faded over their life; the hostile tone's are a quarter
    thinner and mostly solid.
13. RE §11 the death/dismemberment recipes (`enemies`/`players` call them; the parameter tables
    live here).
14. RE §14 the shake accumulator contract.
15. PN §4.5 the sweep parameters for particles and debris.

---

### 6.8 `audio`

**Files:** `src/audio.js` (public), `src/audio.tunes.js` (note tables)
**Imports:** `util`, `audio.tunes.js`
**Responsibility:** the whole synthesised sound engine — voices, positional model, one-shot cues,
the grapple reel loop, and the two music tunes with their scheduler. No files, no `<audio>` tags.

```ts
export class Audio {
  constructor();
  readonly ctx: AudioContext | null;
  init(): void;                                   // lazy create; no-op if already made
  resume(): void;
  setListener(eye: THREE.Vector3, right: THREE.Vector3): void;   // every frame
  setTune(key: 'downtown' | 'mexico'): void;
  music(on: boolean): void;
  readonly musicPlaying: boolean;
  setIntensity(v: number): void;                  // 0..1, every frame
  reelLoop(on: boolean): void;

  // one-shots. `pos` is optional world position => positional; otherwise centred.
  shot(): void; shotgunFire(): void; sniperFire(): void; revolver(): void;
  pump(): void; shellCue(): void; cylinder(): void; reload(): void; empty(): void;
  winded(): void; switchWeapon(): void;
  katanaSwing(): void; katanaHit(): void; parry(): void; perfectParry(): void;
  grappleFire(): void; grappleHit(): void; grappleRelease(): void;
  footstep(vol: number): void; jump(): void; land(h: number): void; slide(): void;
  wallJump(): void; mantle(): void; dash(): void; hurt(): void; death(): void;
  hitEnemy(): void; headshot(): void;             // centred: shooter feedback, never positional
  kill(strong?: boolean): void; enemyDie(pos: THREE.Vector3): void; gib(pos: THREE.Vector3): void;
  spawn(pos: THREE.Vector3): void; lunge(pos: THREE.Vector3): void;
  bulletImpact(pos: THREE.Vector3): void; ricochet(pos: THREE.Vector3): void;
  pickup(): void; wave(): void; waveClear(): void;
  focusIn(): void; focusSlash(): void;
  explosion(pos: THREE.Vector3): void; fuse(pos: THREE.Vector3): void;
  flyerDive(pos: THREE.Vector3): void; flyerBuzz(pos: THREE.Vector3): void;
  stomp(pos: THREE.Vector3): void; bossRoar(pos: THREE.Vector3): void;
  shieldHit(pos: THREE.Vector3): void; smash(pos: THREE.Vector3, big?: boolean): void;
  remoteShot(kind: string, pos: THREE.Vector3): void;
  enemyShot(pos: THREE.Vector3): void; enemyShotgun(pos: THREE.Vector3): void;
  enemySniper(pos: THREE.Vector3): void; sniperAim(pos: THREE.Vector3): void;
}
```

Naming note: the reload cue named `shell` in HA §11 is exported as `shellCue()` so it does not
collide with the effects casing recipe in reader's minds; everything else keeps its spec name.

**Events:** none. `main` calls `init`/`resume` on the first pointer-down or key-down and when play
begins, and re-tries every 2 s while playing.

**Implementer checklist**

1. HA §10 engine: lazy context, graph (`voice → env gain → panner → master 0.55 → compressor`),
   music gain 0.05 bypassing the panner, the 2 s white-noise buffer with a random start offset.
2. HA §10 positional model: `1 / (1 + 0.09 d)` and the pan formula with the listener right vector.
3. HA §10 noise voice and tone voice parameter sets and envelope shapes.
4. HA §10 the grapple reel loop (single instance, 0.12 s ramp on, 0.05 s ramp off, end +0.3 s).
5. HA §11 every cue row — layers, frequencies, sweeps, durations, gains and delays.
6. HA §12.1 the scheduler: 100 ms timer, 0.7 s look-ahead, the throttled-tab jump, step length,
   intensity input.
7. HA §12.2 chord tables and the note tables (HOOK, TAIL A/B, BRIDGE, BREAK, CHORUS).
8. HA §12.3 the 8-bit theme: 7 sections, bass styles, drum styles, arpeggio, counter voice, octave
   shadow, echo.
9. HA §12.4 the mariachi waltz: chords, lead bars, harmony rule, strum, hats, fills.
10. HA §13 the listener / intensity / tune contract.

---

### 6.9 `hud`

**Files:** `src/hud/index.js` (public), `elements.js`, `screens.js`, `labels.js`, plus `styles.css`
**Imports:** `util`
**Responsibility:** every DOM element above the canvas: gameplay HUD, menus, screens, control
labels, kill feed, messages, tips. Owns all CSS. Contains **no** game logic: it renders what it is
told and reports clicks upward.

```ts
export interface SlotView { name: string; active: boolean; ammo: string; empty: boolean }

export class Hud {
  constructor(root: HTMLElement);

  // callbacks up to main
  onScreenClick: (() => void) | null;                       // click on the overlay background
  onUiAction: ((act: string, value: string | null, ev: Event) => void) | null;
                       // fired for any click on [data-act]; also for change/input on
                       // [data-act] form controls, and Enter inside [data-act="joinCode"]

  update(dt: number): void;                                 // message + tip countdowns, real dt
  setGameplayVisible(on: boolean): void;                    // the "no gameplay" state, inverted
  setDevice(pad: boolean): void;
  key(action: string): string;                              // HA 5 label table
  controlsHTML(): string;                                   // HA 6, current device

  // per-frame gameplay feed
  setAmmo(mag: number, reserve: number, magSize: number, reloading: boolean): void;
  setKatanaAmmo(): void;
  setSlots(slots: SlotView[]): void;
  setGrenades(n: number): void;
  setBreath(frac: number): void;
  setHealth(hp: number, max: number): void;
  setSpread(px: number): void;
  setCrosshairMode(mode: '' | 'katana'): void;
  setAds(on: boolean): void;
  setScope(on: boolean): void;
  setGrappleTarget(state: 0 | 1 | 2): void;
  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void;
  setFocusMark(x: number | null, y?: number): void;
  setBoss(name: string | null, frac?: number): void;

  // event feed
  hitmarker(kill: boolean, crit: boolean): void;
  damageFrom(angle: number): void;
  setScore(score: number, combo: number): void;
  setWave(wave: number, left: number): void;
  setModifier(text: string): void;
  setTimer(text: string): void;
  setWeapon(name: string, hint: string): void;
  message(main: string, sub?: string, dur?: number): void;
  tip(html: string, dur?: number): void;
  kill(text: string, pts?: number): void;

  // online panels
  setPvpScore(html: string | null): void;                   // null hides and restores wave lines
  setBoard(html: string | null): void;                      // scoreboard overlay
  boardHidden(): boolean;

  // screens
  showScreen(html: string): void;
  hideScreen(): void;
}

export const Screens: {
  main(m: MainModel): string;
  online(m: OnlineModel): string;
  lobby(m: LobbyModel): string;
  pause(m: PauseModel): string;
  menu(m: MenuModel): string;
  matchOn(m: { confirmKey: string }): string;
  dead(m: DeadModel): string;
  over(m: OverModel): string;
  scoreboard(m: BoardModel): string;                        // for setBoard
  pvpScore(m: PvpModel): string;                            // for setPvpScore
};
```

Screen models are plain data (no DOM, no game objects). Example:

```ts
interface MainModel {
  best: number; checkpoint: number; mapKey: string;
  maps: { key: string; name: string; blurb: string }[];
  sens: number; invert: boolean; music: boolean;
  confirmKey: string;
}
interface LobbyModel {
  code: string; isPublic: boolean; isHost: boolean; mapKey: string;
  maps: { key: string; name: string; blurb: string }[];
  players: { id: string; name: string; host: boolean; self: boolean }[];
  status: string;
}
interface OnlineModel { name: string; isPublic: boolean; status: string; busy: boolean;
                        code: string }
interface PauseModel  { wave: number; score: number; sens: number; invert: boolean;
                        music: boolean; confirmKey: string }
interface MenuModel   { code: string; rows: BoardRow[]; sens: number; invert: boolean;
                        music: boolean; confirmKey: string }
interface DeadModel   { waves: number; kills: number; score: number; best: number;
                        newBest: boolean; checkpoint: number; confirmKey: string }
interface OverModel   { youWin: boolean; winnerName: string; rows: BoardRow[] }
interface BoardModel  { rows: BoardRow[]; code: string }
interface PvpModel    { rows: BoardRow[]; selfId: string }   // top 3 + self if ranked 4th or lower
interface BoardRow    { id: string; name: string; kills: number; deaths: number; self: boolean }
```

Every interactive element carries `data-act` (and `data-val` where needed) and calls
`stopPropagation` so it does not read as a background click. Action names used by `main`:
`start`, `online`, `back`, `quickPlay`, `create`, `join`, `joinCode`, `visibility`, `name`,
`pickMap`, `checkpoint`, `mainMenu`, `startMatch`, `leave`, `leaveMatch`, `sens`, `invert`,
`music`.

**Events emitted:** `onScreenClick`, `onUiAction`.
**Events consumed:** DOM clicks/inputs inside the overlay only. It never listens on `window`.

**Implementer checklist**

1. HA §1 page/DOM structure, element order, the initial values before the first frame.
2. HA §2 the three global states and exactly what each hides.
3. HA §3.1 crosshair (sizes, gap formula, 0.06 s ease, katana mode, ADS hide).
4. HA §3.2 ADS and the sniper scope overlay geometry.
5. HA §3.3 grapple reticle states and the breath bar.
6. HA §3.4 hit marker, including the restart-mid-animation requirement and the kill/crit variants.
7. HA §3.5 damage direction indicator (placement, rotation, 1.0 s fade, several at once).
8. HA §3.6 score and combo block.
9. HA §3.7 wave / modifier / enemies-left / timer block.
10. HA §3.8 live mini leaderboard and §3.9 the scoreboard overlay.
11. HA §3.10 boss bar, §3.11 health, §3.12 ammo/tally/grenades, §3.13 slots/weapon name/hint.
12. HA §3.14 tip line, §3.15 centre message (entrance animation), §3.16 kill feed (1.7 s, max 6).
13. HA §3.17 focus meter and §3.18 focus target marker.
14. HA §4 the per-frame update contract and its order.
15. HA §5 control label tables for both devices.
16. HA §6 the controls help text, verbatim, both columns, and the ≤ 900 px stacking rule.
17. HA §7.1 overlay/panel behaviour and click propagation.
18. HA §7.2 settings block, checkpoints block, map picker, main-menu button.
19. HA §7.3–7.10 every screen's content and prompts.
20. HA §8 the exact message, tip and kill-feed strings this module renders.
21. RE §12 hit marker / damage indicator / low-health presentation.
22. PI §15 the HUD outputs driven by the player.
23. This file §3.5 — the type and colour system; keep every size and timing from HA §3.

---

### 6.10 `player`

**Files:** `src/player/index.js` (public), `movement.js`, `grapple.js`, `grenades.js`, `camera.js`
**Imports:** `three`, `util`, `render`, `weapons`, `physics`
**Responsibility:** the local player — look, movement, grapple, health, guard/parry, camera,
grenades, weapon handling, death and the idle camera. Implements `Target`.

```ts
export type GrappleMode = 'idle' | 'fly' | 'on';

export class Player {
  constructor(ctx: Ctx);

  // identity / stats
  name: string; team: number;
  hp: number; maxHp: number; alive: boolean;
  regenDelay: number; regenRate: number; sinceDamage: number;
  grenades: number; readonly maxGrenades: number;      // 5
  breath: number;                                      // grapple stamina 0..1
  hurtFx: number; flashFx: number;
  shieldT: number;                                     // spawn protection, set by main
  lastHitBy: string | null; lastHit: LastHit | null;   // set by main / PvP
  gravityScale: number; dashLock: boolean;

  // transform (live vectors — read, do not mutate)
  body: Body;
  yaw: number; pitch: number; roll: number;
  readonly eye: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly speed: number;
  readonly isLocal: true;

  // movement state read by others
  crouching: boolean; sliding: boolean; aiming: boolean; firing: boolean;
  grapple: { mode: GrappleMode; hook: THREE.Vector3; anchor: THREE.Vector3 };

  // weapons
  weapons: Weapon[]; wi: number; readonly weapon: Weapon;

  // callbacks
  onThrow: ((d: { pos: number[]; vel: number[] }) => void) | null;   // network grenade replication

  // lifecycle
  update(dt: number): void;                            // scaled dt; only while play/dying
  idleCam(time: number): void;                         // non-playing states
  reset(pos: THREE.Vector3): void;

  // damage / guard  (Target surface)
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;
  knockback(dir: THREE.Vector3, amount: number): void;
  die(): void;
  tryDeflect(p: Projectile): false | { perfect: boolean; returned: boolean };
  tryBlockMelee(e: Enemy): boolean;
  readonly blockRadius: number;
  readonly blocking: boolean;
  readonly parryWindow: boolean;

  // things others do to the player
  heal(amount: number): number;                       // positive finite amount; dead -> 0; cap at maxHp; return HP restored
  addAmmoAll(frac?: number): void;                     // default 0.5
  throwGrenade(remote?: { pos: number[]; vel: number[] }): void;
  clearNades(): void;
  switchTo(index: number, silent?: boolean): void;
  recoil(pitch: number, yaw: number): void;
  kickFov(v: number): void;
  lunge(speed: number): void;
  detachGrapple(boost: boolean): void;
  aimDir(spread: number, out?: THREE.Vector3): THREE.Vector3;
  weaponState(): WeaponState;                          // also used by main to start a focus slash
}
```

**Events emitted:** `onThrow` (grenade); `ctx.game.onPlayerDeath()` on death;
`ctx.hud.*` for weapon name/hint, crosshair mode, ADS/scope, grapple reticle, damage direction,
tips and the "OUT OF BOUNDS" message; `ctx.audio.*` for every movement/health cue;
`ctx.effects.*` for dash/double-jump bursts and the shake accumulator;
`ctx.game.hitstop/addScore` on parries.
**Events consumed:** `ctx.input` every frame; `ctx.game` PvP and breakable hooks through the
weapons it owns; `pdmg`/`nade`/`cut`/`parry` effects applied by `main` through the methods above.

**Implementer checklist**

1. PI §3.1–3.5 constants and the full initial state.
2. PI §3.6 `reset` (also used by online respawn).
3. PI §4 the per-frame update order — implement it in exactly that order.
4. PI §5 look, look multipliers while aiming, forward/flat-forward/right derivation.
5. PI §6.1–6.7 wish direction, sprint, ADS flag, crouch, slide, ground and air acceleration.
6. PI §6.8–6.11 jump buffer, coyote, ground jump, wall jump, double jump, air dash.
7. PI §6.12 gravity, no-snap rule, 48 m/s cap, hand-off to `world.moveBody`.
8. PI §6.13 mantle probes and launch.
9. PI §6.14 landing detection and land-grace friction.
10. PI §6.15 out-of-bounds respawn (20 damage, teleport, message).
11. PI §6.16 the focus dash-lock frame behaviour (main drives the body).
12. PI §7.1–7.8 grapple: hand point, target search priority, firing, fly, attached physics, detach,
    stamina, reticle states.
13. PI §8.1–8.6 damage, knockback, regeneration, pickups/heals, death.
14. PI §9.1–9.3 guard radius, projectile deflect, melee parry, being parried online.
15. PI §10.1–10.6 eye/centre, bob and footsteps, roll/shake/springs, FOV, recoil entry points, the
    four post-effect scalars.
16. PI §11.1–11.6 grenade charge, launch parameters, throw, flight, explosion, arc preview.
17. PI §12.1–12.4 slots, quick melee, the `WeaponState` record, post-animate flags.
18. PI §14.1 dead-state simulation and §14.2 the idle camera.
19. PI §16.2 keep the public surface exactly as listed there and here.
20. N §12 the online stat overrides applied by `main` on reset.
21. RE §3.2–3.4 camera placement, FOV control, shake consumption (the player writes the camera).
22. GL §30 the player half of the off-the-page rules.

---

### 6.11 `weapons`

**Files:** `src/weapons/index.js` (public), `stats.js`, `gun.js`, `katana.js`, `models.js`
**Imports:** `three`, `util`, `render`, `physics`
**Responsibility:** the four view models, gun ballistics, spread, reload and cycle state machines,
the katana (slash, guard, parry flick, blade blood). Hitscan resolution and the routing of damage
to enemies / players / breakables.

```ts
export type GunKind = 'rifle' | 'shotgun' | 'sniper' | 'revolver';

export interface GunStats { /* W section 4, one field per table row */ }
export const GUN_STATS: Record<GunKind, GunStats>;

export interface Weapon {
  readonly kind: string;            // GunKind | 'katana'
  readonly name: string;
  readonly hint: string;
  readonly isGun: boolean;
  readonly scope: boolean;
  readonly root: THREE.Group;       // child of ctx.renderer.rig
  readonly adsFov: number;
  readonly adsSpeed: number;        // walk-speed multiplier while aiming; 1 for the knife
  aimAmt: number;
  mag: number; reserve: number; magSize: number; reloading: boolean;
  readonly spreadPx: number;
  equip(): void;
  unequip(): void;
  animate(st: WeaponState, dt: number): void;
  addAmmo(n: number): void;
  resetAmmo(): void;
  dispose(): void;                            // cancel owned timers and remove/release the view model
  kickPos(x: number, y: number, z: number): void;   // external spring kicks (grapple, grenade)
  kickRot(x: number, y: number, z: number): void;
}

export class Gun implements Weapon {
  constructor(ctx: Ctx, player: Player, kind: GunKind);
  startReload(): void;
}

export class Katana implements Weapon {
  constructor(ctx: Ctx, player: Player);
  blocking: boolean; blockT: number; cooldown: number; blood: number; combo: number;
  startSlash(st: WeaponState): void;      // also used by the focus system
  addBlood(amount: number): void;         // +0.42 per katana/focus kill
  onDeflect(perfect: boolean): void;      // parry flick
}

export function makeLoadout(ctx: Ctx, player: Player): Weapon[];  // [rifle, shotgun, sniper, katana]
```

**Two looks of every view model (R4).** Each weapon keeps its flat model (`makeGunModel`,
`makeMeleeModel`: the code-built guns and hands, Low's look, built in their own units at scale
0.46) for its whole life. On the realistic tiers, once `renderer.weapons` has `weapons.glb` and its
maps in, every view model (`ViewModel._syncLook`, on the assets' subscription) builds its Blender
model (`makeRealGunModel`, `makeRealMeleeModel`: an instance of the glb's model, its optics on the
`optic-mount`, the knife's blood smears laid along its blade) and swaps to it; when the assets go
(Low) it swaps back and drops it. `root` is the model in use, so the swap changes what draws the
weapon and nothing of its state; the springs, sway, aim and visibility carry over, the root moved
from the old model's hip and aim poses to the new one's, so even a paused game shows it posed. A
Blender model brings:
- its hip pose (`RealLook.restPos`/`restRot`) and its aim point per optic (`GunModel.sights`: the
  sight socket that full aim puts on the camera axis, with the eye at the model's own place along
  the gun, `RealLook.eye`, whatever the optic: a cheek weld on the long guns, the butt behind the
  eye (the shotgun's front sight 0.72 m out, an optic's eyepiece 6-9 cm), the pistol's post
  0.55 m out; the flat models keep `GunStats.sight` and `eyeDistance`);
- `unit` 0.46 instead of 1, which scales the procedural part offsets (slide recoil, the flat
  reload's magazine drop), because its parts are in metres;
- muzzle and ejection sockets where its barrel and port are (the flash stars hang there at the
  flat model's scale);
- a trigger (`ModelParts.trigger`) that turns back while fire is held;
- keyframed clips (`reload`, `reload-empty`, `equip`, `cycle`, `shell`, `slash`, `slash-back`,
  `guard`) and an `AnimationMixer`. `_want(clip, t)` asks for one at the progress of the game's
  own timer (the reload's, the pump or bolt cycle's, the draw's, the knife's guard blend), and
  `_applyClip` holds it there after the
  procedural pose, so a clip always spans exactly the gameplay duration in `stats.ts`. Clips move
  the model's `pivot` and parts; the root keeps the sway, bob, recoil springs and rack kick.
  Where a model has no clip for an action, the procedural motion runs as on the flat look.
  Stopping a clip (the action ends, is interrupted, or the gun is holstered) puts its nodes back
  at rest. Gameplay (timings, ammo, rays, damage) is identical on both looks.

**Events emitted:** `ctx.game.onShot(end)` for every ray; `ctx.game.hitPlayer`,
`ctx.game.breakHit`, `ctx.game.cutRopes`, `ctx.game.breakablesInArc`; `ctx.enemies.damage`;
`ctx.game.hitstop`; `ctx.effects.*`; `ctx.audio.*`; `ctx.input.rumble`;
`player.recoil/kickFov/lunge/aimDir`.
**Events consumed:** the `WeaponState` record once per frame; external spring kicks.

**Implementer checklist**

1. W §1 loadout and slot indices; the revolver is implemented but not issued.
2. W §3.1–3.6 view-model frame, rest/aim poses, sight alignment, springs, the per-frame pose blend
   (step by step), equip/unequip, the scoped visibility rule.
3. W §4 the stat table — every column, every gun.
4. W §5 the runtime state fields.
5. W §6 spread, bloom, the square distribution, the crosshair pixel formula.
6. W §7 the gun frame update order and the reload/fire gates.
7. W §8 firing: the 12 numbered steps.
8. W §9 hit detection and the a–e resolution priority.
9. W §10 damage, head multipliers and falloff, for enemies and for players.
10. W §11.1–11.5 all three reload types, their poses, timings, interruption rules, auto-reload and
    the empty click.
11. W §12 the pump / bolt cycle including the negative-`t` window and the rack event.
12. W §13 recoil scaling by aim.
13. W §14 aim-down-sights behaviour.
14. W §15 shell casings and the eject velocity.
15. W §16 muzzle flash mesh, muzzle burst, smoke, tracers, impacts.
16. W §17.2–17.5 the four gun models, part by part, with the muzzle and eject anchors.
17. W §18.1–18.10 the katana: stats, geometry, state machine, slash start and trail, animation,
    hit test, guard pose, parry flick, blade blood, quick melee.
18. W §19 switching, §20 ammo and reset, §21 audio cues, §22 the interface contracts.

---

### 6.12 `enemies`

**Files:** `src/enemies/index.js` (public), `types.js`, `model.js`, `ai.js`, `boss.js`,
`flyer.js`, `projectiles.js`
**Imports:** `three`, `util`, `render`, `physics`
**Responsibility:** every enemy, their AI, attacks, bosses, projectiles, damage, death and gore.
The manager owns the enemy list and the projectile pool. It does **not** decide when to spawn —
`main` does.

```ts
export interface EnemyType {
  key: string; name: string; hp: number; speed: number; weapon: string; score: number;
  scale: number; tone: number; boss?: boolean; flying?: boolean;
  /* plus the ranged/melee parameter block of E section 2.2 and 2.3 */
}
export const TYPES: Record<string, EnemyType>;
export const BOSS_ORDER: string[];                 // ['boss', 'hitbox', 'lagspike']

export class EnemyManager {
  constructor(ctx: Ctx);
  readonly list: Enemy[];
  readonly alive: number;
  mods: { speed: number; damage: number };
  mirror: boolean;                                  // true = client mirror (dormant)

  // callbacks set by main
  onKill: ((e: Enemy, info: HitInfo, overkill: boolean) => void) | null;
  onBoss: ((e: Enemy) => void) | null;
  onSpawn: ((e: Enemy) => void) | null;
  onClientHit: ((e: Enemy, amount: number, info: HitInfo) => void) | null;
  onFire: ((p: Projectile) => void) | null;

  spawn(type: string, pos: THREE.Vector3, id?: number): Enemy;
  update(dt: number): void;                         // scaled dt
  clear(): void;                                    // enemies, corpses, projectiles

  damage(e: Enemy, amount: number, info: HitInfo): void;
  kill(e: Enemy, info: HitInfo): void;
  killMirror(id: number, info: HitInfo): void;
  yank(e: Enemy, target: THREE.Vector3): void;
  blastEnemies(center: THREE.Vector3, radius: number, damage: number, except?: Enemy | null): void;
  explode(e: Enemy, scale: number): void;           // bomber detonation

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, ignore?: Enemy | null):
    { enemy: Enemy; part: string; dist: number; point: THREE.Vector3 } | null;
  inArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number):
    { enemy: Enemy; dist: number }[];
  nearestVisible(from: THREE.Vector3, forward: THREE.Vector3, cosHalf: number, max: number): Enemy | null;
  eye(e: Enemy): THREE.Vector3;

  snapshot(): number[][];                           // host rows, E 17.2 (dormant)
  applySnapshot(rows: number[][], now: number): void;
}
```

**Events emitted:** `onKill` / `onBoss` / `onSpawn` / `onClientHit` / `onFire`;
`ctx.game.hitstop`, `ctx.game.addScore` (shield break); `ctx.hud.hitmarker`;
`ctx.effects.*`; `ctx.audio.*`; `ctx.input.rumble`.
**Events consumed:** `ctx.game.targets()` for target selection and attacks;
`ctx.nav.findPath`; `ctx.world` for movement, rays and line of sight; `enemies.mods` set by `main`.

**Implementer checklist**

1. E §2.1–2.5 the catalogue: stats, ranged parameters, melee/special parameters, tone and model
   kind, humanoid proportions.
2. E §3.1 the enemy record with every initial value; §3.2 spawning; §3.3 the coarse state machine
   including the spawn growth animation and the stunned rules.
3. E §4.1 bodies; §4.3 hit spheres and the ray rule. (§4.2/4.4/4.5 geometry lives in `render`;
   this module decorates it and reads the anchors.)
4. E §5 the per-frame update order, the target-space push and the removal rule.
5. E §6.1–6.6 steering, ground-ahead probe, approach slots, pairwise separation, wander, path
   following with jumps and unsticking.
6. E §7.1–7.4 the ground AI for bomber, rusher, boss dispatch and the four ranged classes.
7. E §8.1–8.4 fire control: sniper aim-up and laser, bursts, shotgun, one-shot spawning.
8. E §9.1–9.3 the three bosses, every attack phase, timing and counter.
9. E §10 the flyer brain and avoidance.
10. E §11 projectiles, §11.1 the segment test, §11.2 deflect/redirect, §11.3 blast burst.
11. E §12.1–12.8 damage entry, the multiplier quirk, shields, health damage, bomber detonation,
    yank, and the query helpers.
12. E §13.1–13.4 kill, fall death, boss death, corpse update. V15 replaces the corpse's topple and
    8-9 s scale-down: `kill` fixes a `Death` (`planDeath`: the killing hit's direction on the ground,
    or straight back for a hit from above, turned aside, or back, where a wall or crate would take the
    lying body, else slumping against it; a slide of 0.5 m, 0.9 on an overkill; a sink no deeper than
    the floor slab; a seed from the id, so a host and its mirrors agree), and `deathPose` poses the
    body from the time since death alone (frame-rate independent): knocked along the fall over
    0.35 s, the knees giving with the feet on the floor as it topples onto its back over 0.6 s, the
    limbs thrown on their pivots from their angles at the kill (`Death.pose`, `killPose`), lying still, then sinking (shrinking the rest of the way on a thin
    slab) from 3.2 s to 4 s (`DEATH_END`), when it is removed (it was 9 s; nothing reads a corpse: waves count
    `alive`, training respawns after 3 s). Gibs and a dropped weapon leave as debris as before, and
    the pose leaves a limb debris owns alone. The hit tint fades on the corpse too.
13. E §14 animation and telegraphs (the readable wind-up windows are gameplay).
14. E §16 the payload `onKill` must provide.
15. E §17.1–17.6 the replication contract (implement `snapshot`/`applySnapshot`/`killMirror` and
    the `mirror` flag; nothing wires them yet).
16. E §18.1–18.7 the interfaces.

Not this module: wave composition and spawn placement (GL §12–13, `main`), boss hp scaling
(GL §12), score labels (GL §14).

---

### 6.13 `players` (remote avatars)

**File:** `src/players.js`
**Imports:** `three`, `util`, `render`
**Responsibility:** encode the local player's state packet, and represent every other player:
snapshot buffering, interpolation, pose, weapon prop, name tag, rope, hit spheres, ragdoll.
Implements `Target`. Contains no transport code.

```ts
export function encodeState(p: Player): number[];        // the `ps` array of section 5.9

export interface HitSphere { part: string; r: number; obj: THREE.Object3D }

export class RemotePlayer {
  constructor(ctx: Ctx, id: string, name: string, team?: number, tone?: number);

  readonly id: string;
  name: string;
  alive: boolean; hp: number;
  readonly visible: boolean;                            // current figure exists and is visible
  body: { pos: THREE.Vector3; vel: THREE.Vector3; halfW: number; height: number; onGround: boolean };
  readonly center: THREE.Vector3;
  readonly eye: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly isLocal: false;
  readonly speed: 0;
  readonly blockRadius: 0;

  crouching: boolean; sliding: boolean; blocking: boolean; aiming: boolean;
  firing: boolean; grappling: boolean; parryWindow: boolean;
  hook: THREE.Vector3;
  hits: HitSphere[];
  lastSeen: number;                                      // ms stamp of the last `ps`
  deadT: number;

  onDamage: ((amount: number, from: THREE.Vector3 | null) => void) | null;

  push(arr: number[], now: number): void;                // a received `ps`
  update(dt: number, now: number): void;                 // interpolate + pose, real dt
  shots(kind: string, ends: number[]): void;             // draw tracers + flash + sound
  ragdoll(dir: number[] | null, over: boolean): void;
  flash(): void;
  dispose(): void;

  // Target surface
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;   // routes to onDamage
  knockback(): void;                                     // no-op
  tryDeflect(): false;
  tryBlockMelee(e: Enemy): boolean;
}
```

**Events emitted:** `onDamage` (set by `main`, which turns it into a `pdmg` message);
`ctx.effects.*` for tracers, flash, ragdoll debris and blood; `ctx.audio.remoteShot/enemyDie`.
**Events consumed:** `push` from `main`'s `ps` handler; `shots` from the `shots` handler;
`ragdoll` from the `pdead` handler.

**Implementer checklist**

1. N §7 the encoding table, the flag bits and every decoding rule.
2. N §8.1 snapshot buffering, the synthetic first snapshot, weapon-prop rebuild, alive transitions,
   the fresh-figure-on-respawn rule, the last-seen stamp, the pre-first-packet state.
3. N §8.2 interpolation and extrapolation: 80 ms delay, 350 ms extrapolation cap, the 6 m teleport
   threshold, the rate-22 ease, shortest-arc yaw.
4. N §8.3 derived geometry (height, eye, centre, forward, right, root yaw + PI).
5. N §8.4 the eleven hit spheres and the (0, −100, 0) parking rule for corpses.
6. N §11.1 skeleton dimensions and §11.2 the name tag (render the name; keep the placement and the
   billboard yaw formula).
7. N §11.3 the four weapon props and the out-of-range fallback.
8. N §11.4 the full pose/animation table — every readable cue.
9. N §11.5 the rope and hook (the same points the katana cuts).
10. N §11.6 hit flash and shot tracers (muzzle point, thickness by kind, 0.06 s, dead-remote rule).
11. N §11.7 slump and ragdoll, once per life.
12. N §11.8 respawn, §11.9 the health field.
13. E §18.4 the remote-player `Target` surface (block radius 0, speed 0, melee-block rule).

---

### 6.14 `net`

**File:** `src/net.js`
**Imports:** *(nothing; reads the global `Peer`)*
**Responsibility:** PeerJS transport only — peer lifecycle, lobby codes, hosting, joining, quick
play, the message envelope and routing. It knows nothing about players, scores or the game.

```ts
export const NET: {
  PREFIX_LIVE: 'shooter-rebuild-v1-'; PREFIX_DEV: 'shooter-rebuild-dev-v1-';
  PUBLIC_SLOTS: 8; CODE_LEN: 5; CODE_ALPHABET: string; CODE_RETRIES: 3;
  MAX_PLAYERS: 8; SIGNAL_TIMEOUT: 12000; JOIN_TIMEOUT: 14000; QUICK_TIMEOUT: 11000;
  REFUSE_CLOSE_DELAY: 400; SILENT_TIMEOUT: 9000;
};

export class Net {
  constructor();
  readonly id: string | null;
  readonly code: string | null;
  hostId: string | null;
  isHost: boolean;
  isPublic: boolean;
  readonly active: boolean;                 // a peer exists and is connected
  accepting: boolean;                       // host may refuse new joins
  readonly conns: Map<string, any>;         // peer id -> PeerJS DataConnection

  onPeerJoin: ((id: string, meta: any) => void) | null;    // host only
  onPeerLeave: ((id: string) => void) | null;              // host only
  onDisconnect: (() => void) | null;                       // client: the host went away

  host(o?: { isPublic?: boolean; code?: string }): Promise<void>;
  join(code: string, meta?: any): Promise<void>;
  quickJoin(meta?: any, onStatus?: (s: string) => void): Promise<void>;
  leave(): void;
  close(id: string): void;                  // forget one peer without a "peer left" event

  on(type: string, fn: (data: any, from: string) => void): void;   // one handler per type
  send(type: string, data: any, relay?: boolean): void;
  broadcast(type: string, data: any): void;                        // send with relay = true
  sendTo(id: string, type: string, data: any): void;
}
```

`host`, `join` and `quickJoin` reject with an `Error` whose message is one of the raw strings in
N §3.7 / HA §7.12; `main` maps them to friendly text.

**Events emitted:** `onPeerJoin`, `onPeerLeave`, `onDisconnect`, plus every registered message
handler.
**Events consumed:** PeerJS `open`, `connection`, `data`, `close`, `error`, `disconnected`.

**Implementer checklist**

1. N §2.1 library loading check, peer options, ICE servers, connection options
   (`reliable`, `serialization: 'json'`, metadata `{ name }`), the non-object payload guard.
2. N §2.2 the id namespace and the localhost dev prefix.
3. N §2.3 private code alphabet and length; public `PUB0..PUB7`; upper-casing.
4. N §2.5 every constant.
5. N §3.1 hosting: public slot walk, `unavailable-id` retries, the 12 s open rule, the
   "all public lobbies are busy" error.
6. N §3.2 joining: the knock, the five race outcomes, the `peer-unavailable` id parsing, adoption.
7. N §3.3 quick play: 8 simultaneous knocks, first welcome wins, the 11 s cap, the
   "no open public lobbies" result.
8. N §3.4 accepting: capacity/closed refusals, the 400 ms close delay, `welcome`, `onPeerJoin`.
9. N §3.5 keep-alive reconnect, drop handling, the deliberate-leave flag, teardown.
10. N §4 envelope validation, connection-derived sender identity, message-role checks, then
    routing (forward addressed, relay, dispatch). Main validates payload fields before applying them.
11. N §6 the tick contract this module supports (`main` drives; `net` only sends).
12. HA §7.12 the raw error strings.

Not this module: the silent-peer timeout (`main`, it needs remote state), the friendly error
mapping (`main`), and every message's meaning (`main`).

---

### 6.15 `main`

**Files:** `src/main.js` (entry) plus the private `src/game/` set:
`state.js`, `ui.js`, `solo.js`, `ffa.js`, `pickups.js`, `breakables.js`
**Imports:** everything. `main` is the only module allowed cycles-by-convenience; nothing imports
`main` or `src/game/*`.

**Responsibility:** boot, the frame loop, the top-level state machine, screens and menus, run
control, solo waves and scoring, the focus slash, pickups, breakable props, the FFA lobby and
match, PvP hit resolution, all network message handlers, the per-frame HUD feed, and the
`GameHooks` object of section 5.2.

Internal split (guidance, not a contract — only `main.js` is imported from outside `src/game/`):

| File | Contents |
|---|---|
| `state.js` | the `GameState` record, constants, `resetRun`, `beginCommon`, `beginSolo`, `beginAtWave`, `pause`, `resume`, `mainMenu`, level rebuild, settings load/apply |
| `ui.js` | screen view-models, `showScreen` calls, the `onUiAction` router, the screen-click rule, friendly error mapping |
| `solo.js` | wave director, spawn placement, modifiers, scoring/combo/kill labels, the focus slash, the dead screen |
| `ffa.js` | lobby model, match lifecycle, spawn dealing, respawn, scores, win/time limit, remote bookkeeping, PvP hit resolution, rope cutting, shot relay, every message handler |
| `pickups.js` | pickup list, spawn/update/collect/remove, the arena spawner, the `pickup`/`take`/`taken` messages |
| `breakables.js` | `breakHit`, `breakablesInArc`, `blastBreakables`, `break`, the `brk` message, quiet breaks for late joiners |

```ts
// src/main.js exports nothing. It attaches a debug handle:
declare global { interface Window { __game: {
  ctx: Ctx; gs: GameState; player: Player; enemies: EnemyManager; net: Net;
  remotes: Map<string, RemotePlayer>; lobby: Lobby; scores: Map<string, ScoreRow>;
  pickups: Pickup[]; beginSolo(): void; beginTraining(): void; jumpToWave(n: number): void;   // jumpToWave is debug only
} } }
```

**Events emitted:** every `GameHooks` method (section 5.2); all network sends;
`hud.showScreen/message/tip/kill/...`; `audio` wave/pickup/kill cues; `renderer.render`.
**Events consumed:** `input.onLockChange`, `input.onDeviceChange`; `hud.onScreenClick`,
`hud.onUiAction`; `net.onPeerJoin`, `net.onPeerLeave`, `net.onDisconnect` and all 20 message
types; `enemies.onKill`, `enemies.onBoss`; `player.onThrow`; `remote.onDamage`;
window `pagehide`; a 250 ms `setInterval` keep-alive.

**Implementer checklist**

1. GL §2 boot sequence, in that order (see also section 8 of this file).
2. GL §3 persistent settings: load, apply to input, write back; the name box rules.
3. GL §4 the game-state record and its constants.
4. GL §5 the top-level state machine and every transition.
5. GL §6 the loop, the 0.05 s clamp, the hidden-tab keep-alive.
6. GL §7 time scale: hit-stop and focus slow motion.
7. GL §8 the per-frame update order (reproduced in section 7 of this file).
8. GL §9 orchestration-level input handling, pointer lock, screen clicks.
9. GL §10 every screen and the two menu actions.
10. GL §11 run control: reset run, begin common, begin solo, begin at wave, pause, resume,
    jump-to-wave.
11. GL §12 solo waves: roster, modifiers, wave setup, the wave update, boss hp scaling.
12. GL §13 enemy spawn placement (default, sniper, flyer, boss with its fallback search).
13. GL §14 scoring, combo, kill labels, drops, the boss hook.
14. GL §15 the focus slash: candidate search, enter/end, update, dash, execute.
15. GL §16 solo death and the dead screen.
16. GL §17 FFA lobby flow, including the friendly error mapping and leave-online.
17. GL §18 FFA match lifecycle and the late-joiner path.
18. GL §19 FFA spawn placement (arena spawn rule, farthest index, the initial deal).
19. GL §20 death, respawn, spawn shield, the tally.
20. GL §21 scoreboard and score HUD.
21. GL §22 win conditions, the time limit, match end, return to lobby.
22. GL §23 remote bookkeeping, the network update order, the 9 s silent-peer timeout.
23. GL §24 PvP hit resolution: `raycastPlayers`, `playersInArc`, `hitPlayer`, `pdmg`, `parry`.
24. GL §25 rope cutting; GL §26 shot tracers over the network.
25. GL §27 the message catalogue — all 20 types, both directions.
26. GL §28 pickups; GL §29 breakable props; GL §30 out-of-bounds.
27. GL §31 the kill feed entries; GL §32 the per-frame HUD feed; GL §33 audio hooks.
28. GL §34 provide every hook in the "Provided by this subsystem" table.
29. N §9.1–9.9 the authority rules (they refine GL §24–29 for the network).
30. N §10.1–10.5 lobby sync, match start and spawn assignment, late joiners, match end, leaving.
31. PI §2.13 game-level input handling.
32. HA §7.11 the screen flow, and §7.12 the friendly status mapping.
33. E §15.1–15.6 the spawn director (composition, modifiers, the spawn loop, boss scaling, spawn
    positions) — the same rules as GL §12–13; implement once.

---

## 7. Frame update order in `main`

One `step(nowMs)` per animation frame, plus the hidden-tab keep-alive. This is `game-loop.md` §8,
made explicit. **Implement it in this order.**

```
step(nowMs):

 0. dt = min(0.05, (nowMs - lastStep) / 1000);  lastStep = nowMs
      (lastStep is initialised at script load, so the first frame is clamped too)

 1. input.update(dt)                                   // real dt, always first

 2. menu / screen key handling                          (GL 9)
      start|pause|dead + pressed(jump|confirm) [+ pause while paused] -> screen click
      play + pressed(pause)  -> resume if menu open, else pause + exit lock
      play + menu + pressed(jump|confirm) -> resume

 3. music toggle: pressed('music') -> flip, store, audio.music(...), tip 1.5 s

 4. scoreboard visibility                               (GL 21)
      online && playing: keyboard -> down('score'); gamepad -> pressed('score') toggles a latch
      otherwise: latch = false

 5. pointer-lock tip timer (real dt)                    (GL 8.6)

 6. scale = hitstopT > 0 ? (hitstopT -= dt, hitstopScale)
          : focus.active ? 0.26
          : 1
    sdt = dt * scale

 7. focus update (REAL dt) when state==='play' && mode==='solo', else endFocus()   (GL 15)

 8. if playing (state 'play' or 'dying'):
      8.1  gs.time += sdt;   if (player.shieldT > 0) player.shieldT -= dt
      8.2  music heal timer (real dt, 2 s period)
      8.3  bounds guard: outside bounds+8 or y>150 -> body.y = -100        (GL 30)
      8.4  player.update(sdt)
      8.5  enemies.update(sdt)
      8.6  effects.update(sdt)
      8.7  pickups.update(sdt)
      8.8  netUpdate(dt)                       // REAL dt, see 7.1 below
      8.9  if state==='play' && solo: waveUpdate(sdt)                      (GL 12)
      8.10 if online: arenaPickupSpawner(dt)                               (GL 28)
      8.11 combo decay by sdt; at 0 -> combo = 0, hud.setScore(score, 0)
      8.12 if state==='dying': deathT += dt
             ffa  -> respawn countdown (real dt)                           (GL 20)
             solo -> after 1.7 s: state='dead', dead screen, exit lock     (GL 16)

 9. else (not playing):
      9.1  gs.time += dt
      9.2  if state is start|dead|lobby|over: player.idleCam(gs.time)
      9.3  effects.update(dt);  if (net.active) netUpdate(dt)
      9.4  if state==='over': overT += dt; host only: after 8 s send `backtolobby`, go to lobby

10. for each level.animated: a.update(gs.time)

11. audio.setListener(player.eye, player.right)

12. HUD feed, in this order                             (GL 32, HA 4)
      12.1 weapon is a gun ? hud.setAmmo(mag, reserve, magSize, reloading) : hud.setKatanaAmmo()
      12.2 hud.setSlots(...)  for all four weapons
      12.3 hud.setGrenades(player.grenades)
      12.4 hud.setBreath(player.breath)
      12.5 hud.setHealth(player.hp, player.maxHp)
      12.6 hud.setSpread(weapon.spreadPx)
      12.7 hud.update(dt)                                // message + tip countdowns, REAL dt
      12.8 hud.setFocusMeter(...)                        // GL 32 / HA 3.17
      12.9 boss bar: alive -> hud.setBoss(name, hp/maxHp); dead -> hud.setBoss(null)

13. audio.setIntensity(clamp((enemies.alive + queue.length + 2*remotes.size)/12, 0, 1)
                       * (intermission > 0 ? 0.25 : 1))

14. renderer.render(gs.time, {
      hurt:  player.hurtFx,
      flash: player.flashFx,
      slow:  scale < 1 ? 1 : 0,
      lowHp: (player.alive && player.hp < 30) ? 1 - player.hp / 30 : 0
    })
```

Score, wave, modifier, timer, PvP score and the kill feed are **event-driven**, not part of the
per-frame feed: they are pushed when they change.

### 7.1 `netUpdate(dt)` internal order (`networking.md` §6)

```
if (!net.active) return
tick++
1. for each remote: remote.update(dt, nowSeconds)
2. if inMatch(): silent-peer check (lastSeen older than 9000 ms -> drop, feed, host cleanup)
     client timing out hostId -> leave online, stop this netUpdate
3. if (tick % 3 === 0 && inMatch()): net.broadcast('ps', encodeState(player))
4. if (shotQueue.length): net.broadcast('shots', { k: weapon.kind, e: shotQueue }); shotQueue = []
5. if (isHost && inMatch() && !gs.over): matchT += dt; if (matchT > 480) end the match
```

### 7.2 Hidden-tab keep-alive

A 250 ms interval: if `net.active` and more than 300 ms have passed since `lastStep`, run one
`step(performance.now())`. It never starts a second animation-frame chain.
With timer-only steps at regular 250 ms intervals, the threshold permits a step every 500 ms:
about 2 Hz, 0.67 state packets/s, and 10% simulation speed. Browser throttling can make this slower.

---

## 8. Boot sequence (`game-loop.md` §2)

```
 1. renderer = new Renderer(canvas)            // scene, camera, rig, lights, post target
    scene = renderer.scene; camera = renderer.camera
    world    = new World()
    audio    = new Audio()                    // no AudioContext until a user gesture
    net      = new Net()                      // no peer or connection until host/join
 2. mapKey   = validKey(store.getStr(SKEY.MAP, 'downtown'))
 3. level    = buildLevel(scene, world, mapKey, { arena: false })
    renderer.setLevelShadow(level.shadow.center, level.shadow.radius)
    nav      = new NavGrid(world, level.bounds, 1); nav.build()
 4. remember loadedKey = mapKey, loadedArena = false
 5. audio.setTune(mapKey === 'mexico' ? 'mexico' : 'downtown')
 6. input  = new Input(canvas)
    hud    = new Hud(document.getElementById('hud'))
    effects= new Effects(scene, world)
 7. load persistent settings (section 5.12) and apply the look settings to input
 8. gs = makeGameState(); lobby = emptyLobby(); scores = new Map(); remotes = new Map()
 9. hooks = makeGameHooks()                    // closures read the current gs/ctx when called
    ctx = { scene, camera, renderer, world, nav, level, input, hud, effects, audio, net,
            enemies: null, player: null, remotes, game: hooks }
10. enemies = ctx.enemies = new EnemyManager(ctx)
    player = ctx.player = new Player(ctx); player.name = storedName
11. publish the debug handle using these same objects
12. register every net message handler and the enemy manager hooks
13. register: hud.onScreenClick, hud.onUiAction, canvas click, input.onLockChange,
    input.onDeviceChange, window 'pagehide' (leave the session), and a one-shot
    pointerdown/keydown wake for the audio context
14. hud.setDevice(input.usingGamepad); apply look settings; hud.setWeapon(name, hint);
    show the main screen
15. start requestAnimationFrame(step) and the 250 ms keep-alive interval
```

Level rebuild (`game-loop.md` §2 "Level rebuild") is the same sequence steps 3–5, preceded by
`disposeLevel(scene, oldLevel)` and `world.clear()`, and followed by replacing `ctx.level` and
`ctx.nav`. `main` clears pickups, enemies and effects itself; the level does not.

---

## 9. Cross-cutting integration rules

1. **Nobody caches `ctx.level` or `ctx.nav`** across frames. Read them each time.
2. **Nobody caches another module's live vectors.** `player.eye`, `enemy.center`, `remote.center`
   are internal and change in place. Copy before storing.
3. **`update(dt)` contracts.** `input` and `hud` take real dt. `player`, `enemies`, `effects` (while
   playing) and pickups take scaled dt. `effects` takes real dt while not playing. `net` always
   takes real dt.
4. **Only `main` mutates `GameState`.** Other modules read it through `ctx.game`'s accessors.
5. **Browser ownership.** Only `main` accesses storage (through `util.store`), changes
   `document.title`, and owns game-state/keep-alive timers. Input owns its input, focus, pointer-lock
   and device listeners and pointer-lock retry timer. Hud owns DOM and listeners inside `#hud`.
   Renderer owns the canvas and its resize listener. Audio owns its AudioContext and the 100 ms
   music scheduler. Net reads `window.Peer` and location for its namespace and owns connection,
   signalling, join and refusal timers. A gun may own one cancellable real-time 250 ms auto-reload
   timer; cancel it on reset/disposal, and recheck empty/not-reloading when it fires. Other gameplay
   timers count down in `update`. Each owner removes its listeners/timers when it is disposed.
6. **Damage always flows through one entry point per victim kind**: `enemies.damage(e, amount, info)`
   for bots, `game.hitPlayer(target, damage, info)` for remote players, `player.takeDamage(...)`
   for the local player. Main uses `player.heal(amount)` for pickups, wave rewards and focus heals.
   Reset and boss scaling are the only external stat setup; otherwise never write `hp` from outside.
7. **Effects never call gameplay.** `effects.debris(mesh, …)` takes ownership of a mesh; the caller
   must not remove or reuse it.
8. **`render` never reads gameplay state.** Everything it needs arrives as arguments to `render()`.
9. **The HUD never reads gameplay state.** It has setters only. The single read-back allowed is
   `hud.boardHidden()`.
10. **Network payloads are validated at the handler.** Unknown ids, wrong types, out-of-range
    indices and missing fields are dropped silently — never thrown.
11. **Ids.** Enemy ids and projectile ids share one counter starting at 1. Pickup ids are a separate
    counter starting at 1 (host-authoritative online). Breakable ids are level build indices.
    Player ids are PeerJS peer ids.
12. **Sound and effect ownership.** Whoever causes an event plays its cue: weapons play fire cues,
    enemies play their own cues, `main` plays wave/pickup/kill cues, `player` plays movement cues.
    No module plays another's cue.
13. **Frame budget.** Target 60 fps on an integrated GPU at 1080p. Do not allocate `Vector3`s in
    per-frame loops; use module-level scratch vectors. Instanced pools are pre-allocated at
    construction and never resized.

---

## 10. Decisions this document makes (and why)

| Decision | Reason |
|---|---|
| Two palettes (tone + surface) | a level built from six saturated character colours cannot look clean |
| Shared figure builder lives in `render` | `enemies` and `players` both need it and neither may import the other |
| Runtime calls go through `ctx`, imports only for factories | the only way to keep 15 parallel modules acyclic |
| `main` is split into `src/game/*` | `game-loop.md` is 35 sections; one file would be unreviewable. The split is private, so it costs no integration risk |
| Post-processing is hand-written, not `EffectComposer` | one shader, no addon surface, and `rendering-effects.md` §6.3 must be exact |
| `BufferGeometryUtils` is the only addon | level geometry must merge per material to hit the frame budget |
| Soft shadows | the flat-shaded low-poly target needs shadows for depth readability; fog gives distance fade |
| Outlines removed entirely | explicit product direction; silhouette readability comes from flat colour blocks + shadows + the toon ramp on characters |
| `audio.shellCue()` renamed from the spec's `shell` | avoids confusion with `effects.shell()`; it is the only rename in the codebase |

---

## 11. First-week order of work

Nothing below is a schedule; it is the order that unblocks the most people.

1. `util`, `render` (palette, materials, primitives, `Renderer` with the composite pass),
   `physics`. Everything else is blocked on these three.
2. `input`, `hud` (empty setters that log, then real DOM), `audio` (silent stubs, then real),
   `effects`, `nav`.
3. `level` (Downtown solo first — it is the only map that ships).
4. `player` + `weapons` together (they share the view-model frame).
5. `enemies`.
6. `main` solo path: boot, loop, screens, waves, scoring, pickups, focus.
7. `net`, `players`, `main` FFA path.
8. `level` arena variant, Mexico, breakables.

A module is "done" when every numbered item in its checklist is implemented and its spec sections
have been re-read against the code once.

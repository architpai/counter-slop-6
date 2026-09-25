# Counter Slop 6 — Visual Plan

Date: 2026-09-25 · Branch: `improved-visuals` (off `improvements` at `f62de0e`)

## Direction (decided 2026-09-25)

- **Desktop goes realistic:** Counter-Strike / Rainbow Six Siege style, or the best a browser can do. Examples: PBR materials, baked lighting, real shadows and AO, HDR, and detailed guns.
- **Quality scales with the machine, and the player can override it.** An auto-detected preset plus an Advanced panel with individual settings.
- **The lowest tier keeps today's low-poly flat look.** That look already runs on phones. There are two looks to maintain, and the low tier still gets the cheap fixes from the survey.
- **All assets are self-made.** No downloaded models, textures or HDRIs. Materials are Blender procedural node graphs baked to tileable texture sets. Skies are rendered from Blender's physical (Nishita) sky. Lighting is baked in Cycles. Models are made in Blender.
- **Identity stays.** Operators become realistic but keep the clown masks and the joke names.
- **Download:** the menu loads fast. Each map streams its textures (KTX2) at the size the tier needs, up to about 60 MB on the top tier.

**Realism ceiling (honest):** self-made procedural materials, baked light and good post-processing can make the environments look like mid-2010s CS. Realistic characters and gun animation are the hardest part, because there are no scanned or purchased assets. They land last, and they will look simpler than the environments.

Survey sources:
- Real-GPU screenshots of all 3 maps, 5 weapons, 22 enemies and the menus at 1440×900 — `/tmp/cs6-visual-survey/`
- A code survey of `src/engine/render`, `effects.ts`, `weapons`, `enemies` and the HUD
- A headless Blender audit of `public/models/tactical.glb` — `/tmp/cs6-blender-survey/`

## What the survey found (today's look)

1. **Enemies are the weakest visual and gameplay read.** Characters are dark grey, olive and navy PBR (`MeshStandardMaterial`, 8 of 18 materials near-black) on a Lambert world in pastel greys. At play distance a grunt is a small grey figure against grey Downtown walls (`downtown-firing.png`). The 11 standard humanoids share one silhouette and one palette; only small accessories differ (`enemies-sheet.png`).
2. **Three lighting models are on screen at once.** The world uses Lambert, the guns use Toon (3-step) and the characters and hands use PBR (`materials.ts`, `tactical.ts:65`). This contradicts ARCHITECTURE §3.2.
3. **The image is flat.** There is no ambient occlusion, no tone mapping, no grade and no bloom. Post-processing does gameplay feedback only (`postfx.ts:54-76`). The fog is 70–300 m on every map, so there is almost no depth cue inside the ±60 m play space (`render/index.ts:51`). Downtown has no mood and uses the defaults.
4. **The sky is clip-art.** Downtown uses a 2D sun with 12 ray sticks and 36 cloud spheres (49 draw calls), and fog washes out about 60% of them (`downtown.ts:327-345`).
5. **The map edges are dead.** Looking out from Downtown, you see a flat navy perimeter wall with floating ledges (`downtown-spawn-2.png`). Mexico's backdrop is stair-stepped box mesas.
6. **Combat effects are crude:**
   - The hip-fire muzzle flash is 3 flat orange star planes that cover about ¼ of the screen (`house-firing.png`).
   - Every impact is a blue disc, whatever surface it hits.
   - Explosions are opaque growing balls.
   - Tracers are opaque 2 cm boxes.
   - There is no light from shots.
   - Screen shake is white noise.
7. **The first-person view is weak:**
   - The view model shares the world FOV, which is 82 and rises to about 100 at speed (`camera.ts:90-92`).
   - The hand is a sleeve block with a small fist and no thumb, and from the player's angle the sleeve hides most of it (Blender audit).
   - The shotgun, sniper and pistol are mostly one flat blue slab (`weapon-*.png`).
8. **Nothing scales for mobile.** DPR is capped at 1.5, with 4× MSAA HalfFloat and 2048² PCFSoft shadows on every device (`render/index.ts:41-47`, `postfx.ts:42`). Any new effect needs a tier first.
9. **The model file is heavy for what it shows.** `tactical.glb` is 10.4 MB and 238k tris with no compression, 53% duplicate bytes and unused UVs. `mask-shell` alone is 4,140 tris × 22 copies (38% of all tris). Each enemy is about 50 draw calls, and the shadow pass doubles that.

What already works: the menus and HUD are clean and readable at 1440×900 and 900×600. The House palette and low-poly trees look good. The ACOG/holo scope overlay reads well. The enemy mask idea gives the game character.

---

---

## Quality system (Q) — built first, needed by everything

### Presets

| Setting | Low (today's look) | Medium | High | Ultra |
|---|---|---|---|---|
| Look | low-poly flat (Lambert) | realistic | realistic | realistic |
| Render scale | 0.75 × DPR ≤ 1.5 | 1.0 × DPR ≤ 1.5 | 1.0 × DPR ≤ 2 | 1.0 × DPR ≤ 2 |
| Dynamic resolution | on (0.6–1.0) | on (0.7–1.0) | on (0.8–1.0) | off by default |
| Anti-aliasing | FXAA | SMAA | MSAA 4× + SMAA | TAA + SMAA |
| Shadows | 2048², PCF, update every 2nd frame (1024² was too blocky over the 70 m box) | 2048² PCF | 2 cascades 2048² PCFSoft | 3 cascades 4096² PCFSoft |
| Ambient occlusion | baked vertex AO | baked AO map | baked AO + GTAO half-res | baked AO + GTAO full-res |
| Lighting | sun + hemisphere | baked lightmap + sun | baked lightmap + sun + dynamic lights | same + light shafts |
| Textures | none | 512 px | 1K | 2K |
| Bloom / grade | grade only | grade + bloom | grade + bloom | grade + bloom + lens dirt |
| Effects detail | reduced counts | normal | normal + soft particles | full |
| Characters | current GLB, merged | realistic LOD1 | realistic LOD0 | LOD0 |
| Download (per map) | ~0 MB | ~8 MB | ~20 MB | ~45 MB |

### Auto-detect
- Pick a start preset from touch/`isMobile`, `navigator.deviceMemory`, `hardwareConcurrency`, the GPU renderer string (`WEBGL_debug_renderer_info`, e.g. integrated vs discrete) and `maxTextureSize`.
- Then run a 2-second benchmark in the menu backdrop and move one step down if it misses the target.
- In game, dynamic resolution holds the frame-time target. If it sits at its floor for about 10 s, show a one-time "Lower quality?" prompt; never change quality silently.

### Player controls (Settings → Graphics)
- **Preset:** Auto / Low / Medium / High / Ultra / Custom. Auto shows the preset it chose.
- **Advanced:** render scale, dynamic resolution + FPS target (30/60/90/120/uncapped), anti-aliasing, shadows, ambient occlusion, textures, bloom, effects detail, view distance, and an FPS counter. Changing any one of them switches the preset to Custom.
- **Apply without a reload** where possible. Texture quality and Low↔realistic swaps reload the map assets behind a short loading screen.
- **Storage:** one versioned `cs6_gfx` key in localStorage, plus "Reset to Auto".

Where: new `src/engine/render/quality.ts` (presets, detect, benchmark, dynamic resolution), `render/index.ts:41-47`, `postfx.ts`, `hud/store.ts`, `components/hud/Screens.tsx` (Settings tab).

---

## Realistic pipeline (R) — Medium and above

### R1 — HDR render chain
- Physically based light units with AgX tone mapping.
- Composite chain: a GTAO pass, bloom, a colour grade (per-map LUT made in Blender), SMAA/TAA, and a light sharpen.
- Keep the existing gameplay feedback (hurt vignette, parry flash, slow-mo) as the last step.
- Cascaded shadow maps (three `CSM` addon) replace the single shadow box.
- A PMREM environment from each map's Blender sky, for reflections on metal and glass.

Where: `render/postfx.ts` (move to a pass chain), `render/index.ts`.

### R2 — Material system and texture library (self-made)
- **Map tags:** add a `material` tag to every map primitive (concrete, cast-concrete, brick, plaster, asphalt, paving, wood, painted-metal, steel, glass, sand, adobe, terracotta, grass, soil, fabric…). Today the maps only use the 6 surface keys (`build.ts:8`).
- **Low tier** maps each tag back to today's surface colour, so it looks the same.
- **Texture library:** Blender procedural node graphs, one per material, baked headless to tileable albedo, normal and ORM maps, then encoded to KTX2 at 512, 1K and 2K. The generator scripts live in the repo, so every texture can be rebuilt and nothing is downloaded.
- **UVs:** built at merge time by world-space box projection, so the existing box geometry can wear textures right away. Add a second UV set for lightmaps.
- **Colliders do not change** (`build.ts:102-114`), so gameplay, nav and the stair tests keep their baselines.

Where: new `tools/blender/materials/*.py`, `tools/textures/` (KTX2 encode), `level/build.ts`, `render/materials.ts`, `level/*.ts` (tagging).

### R3 — Baked lighting and AO (the CS look)
- A headless script exports each map's merged visual geometry. Blender unwraps the lightmap UVs, bakes Cycles direct + indirect light and AO with the map's sun and sky, and writes a lightmap atlas as KTX2.
- **Medium** uses the AO bake only. **High and Ultra** use the full lightmap.
- The sun stays dynamic for shadows on characters and props.
- A test checks that the baked atlas matches the current map geometry hash, so a map edit without a re-bake fails CI.

Where: new `tools/blender/bake_level.py`, a level export hook in `level/build.ts`, `public/maps/<key>/`.

### R4 — Weapons and arms
- Blender-made realistic guns (R4-C, MP5, shotgun, sniper, pistol, knife), with bevels and PBR texture sets baked from high-poly detail, as `weapons.glb`.
- Gloved arms with sleeves.
- A separate view-model FOV (fixed about 65°), plus receive-shadow and a shelter dimming.
- Keyframed reload, equip and inspect clips made in Blender, replacing the procedural springs where they look stiff.
- The 3D optics still work on High and Ultra (a render-to-texture scope, with the SVG overlay kept on Low and Medium).

Where: `weapons/models.ts`, `weapons/gun.ts`, `player/camera.ts`, new `tools/blender/weapons/`.

### R5 — Effects
- Muzzle-flash and explosion flipbooks rendered in Blender.
- Soft-particle smoke (dithered on Medium).
- Sparks and dust that pick up the hit surface's material tag.
- Bullet-hole decals per material with normal maps.
- Shell ejection, pooled dynamic lights (muzzle, explosion), glowing tracers, and directional screen shake.

Where: `effects.ts`, `weapons/gun.ts`, `enemies/projectiles.ts`, `player/camera.ts`.

### R6 — Map detail kits
- Self-made prop and trim kits: doors, window frames with glass, AC units, pipes, cables, signage, crates, pallets, barrels, rubble, fences, market stalls, adobe details.
- Instance them per map, with bevelled edges on large masses.
- Map backdrops: a Downtown skyline and Mexico mesas.
- **Rule:** visual-only additions use `noCollide`, and collider changes need an explicit gameplay review.

### R7 — Characters
- Realistic operator bodies in Blender, with the clown masks kept.
- A skinned rig with keyframed idle, walk, run, strafe, shoot, reload, hit and death clips. This replaces rigid procedural pivots.
- One kit colour and shape per role so enemies stay readable at range (see V3).
- LOD0 and LOD1, merged per material, meshopt-compressed.
- The current GLB stays as the Low tier.

### R8 — Atmosphere
- Height fog and a per-map time of day.
- Light shafts and lens dirt on Ultra.
- Grade LUTs tuned per map.

### Readability guardrail
Realism must not hide enemies. Every R step is checked against a fixed set of "can you see the enemy" screenshots (enemies at 10, 30 and 60 m, in light and shadow, on each map). A subtle rim term and kit contrast are allowed; outlines are not (no ink look).

---

## Low-tier fixes from the survey (V)

These came from the survey of today's look. On the realistic path, the R items cover or replace most of them. They still apply to the Low tier, and the cheap ones (V4–V8, V10, V17) help every tier.

| Rank | ID | Suggestion | Effort | Cost (desktop / mobile) |
|---|---|---|---|---|
| 1 | V1 | Quality tiers | M | enabler / saves |
| 2 | V2 | Enemy palette and one lighting model | M | saves / saves |
| 3 | V3 | Enemy role readability | M | none |
| 4 | V4 | Tone mapping, per-map grade, Downtown mood | S | tiny / tiny |
| 5 | V5 | Muzzle flash and tracer rewrite | S | tiny / tiny |
| 6 | V6 | Sky and fog per map | S | saves / saves |
| 7 | V7 | Baked vertex AO for level geometry | M | none / none |
| 8 | V8 | Separate view-model FOV | S | none |
| 9 | V9 | Selective bloom | M | medium / off |
| 10 | V10 | Surface-aware impacts and lit decals | S | tiny |
| 11 | V11 | Explosion rewrite | M | small / small |
| 12 | V12 | `tactical.glb` optimisation and merged enemy draws | M | saves a lot |
| 13 | V13 | Blender first-person hands and weapons | L | small |
| 14 | V14 | Map backdrops (Downtown skyline, Mexico mesas) | M | small / small |
| 15 | V15 | Enemy hit flash and death animation | M | tiny |
| 16 | V16 | Surface variety on buildings and ground | M | tiny |
| 17 | V17 | Smoothed, directional screen shake | S | none |
| 18 | V18 | View model darkens when sheltered | S | tiny |
| 19 | V19 | Draw-call cleanup: Mexico breakables, level chunks for culling | M | saves |
| 20 | V20 | Optional SSAO/GTAO on the high tier | M | high / off |

### V1 — Quality tiers (do first)
The Quality system (Q) above now covers this item; this entry is kept for the record.
Add `low / medium / high` with `auto`: touch or low-DPR devices start at `low` or `medium`, and there is a setting in the Settings tab. Each tier controls DPR cap, MSAA samples, shadow size and filter, shadow update rate, bloom, SSAO and particle counts. Nothing below can ship safely on phones without it.
Where: `render/index.ts:41-47`, `postfx.ts:37-43`, `hud/store.ts` (setting), `input.ts:116` (touch detect).

### V2 — Enemy palette and one lighting model
Swap the GLB `MeshStandardMaterial`s at load for the project's flat Lambert (or Toon) with bold, lighter colours: raise the value of fabric and armour, and keep the masks white and the marks red. The world, guns and characters then share one look. Lambert is also cheaper than PBR, and the RoomEnvironment is then only needed for metal accents, if at all.
Where: `render/tactical.ts:56-76`, `materials.ts`, and a palette table in `palette.ts`. Blender: optional recolour at source.

### V3 — Enemy role readability
Give each role one large colour block or shape that reads at 30 m: a vest panel, a backpack, a pauldron or a helmet colour. Examples: medic white/red, sapper hazard ochre, parry violet, rusher red, sniper ghillie green. Add a subtle fresnel rim tint (in the shader, not an outline) so enemies separate from same-value walls. This keeps the no-ink rule.
Where: `tactical.ts`, `enemies/types.ts` (a colour per role), and Blender for the new shapes.

### V4 — Tone mapping, grade, Downtown mood
Enable a tone mapper (AgX or ACES) in the composite. Add a small per-mood grade (lift/gain, saturation, contrast) to the existing full-screen pass, which costs almost nothing. Give Downtown its own mood; for example, a cool morning with warm sun would separate it from Mexico and House.
Where: `postfx.ts` composite shader, `palette.ts`, `downtown.ts`.

### V5 — Muzzle flash and tracers
Scale the flash to each weapon and make it smaller at hip. Use additive blending with a 1-frame bright core. Add one pooled point light, 40–60 ms, off on `low`. Replace tracers with thin additive streaks that fade, and make enemy tracers thinner but still red so they stay readable.
Where: `weapons/models.ts:108-116`, `gun.ts:327-335,393`, `effects.ts:483-489`.

### V6 — Sky and fog
Replace the sun, ray sticks and cloud spheres with the gradient sky dome plus a sun-disc glow in its shader, and a few merged low-poly cloud meshes with `fog: false` (49 draws become about 2). Set the fog range per map (about 45–180 m) so distance has depth. Also fix the sky-attribute leak on `setMood` and remove the redundant `scene.background` clear.
Where: `downtown.ts:327-345`, `render/index.ts:50-51,164-184`, `palette.ts`.

### V7 — Baked vertex AO
At `finish()`, bake per-vertex AO into the merged static level: raycast a few hemisphere samples per vertex, or use cheap box-contact darkening. This grounds crates, stairs and wall bases with zero runtime cost, and it works on every tier.
Where: `level/build.ts:231-239`. Needs `vertexColors` on the level Lambert materials.

### V8 — View-model FOV
Render the rig with its own projection at a fixed ~65° FOV. The world can keep its speed FOV kick, but the gun stops stretching.
Where: `render/index.ts:72-83` (rig pass), `player/camera.ts:90-92`.

### V9 — Selective bloom
Add a cheap threshold bloom at half resolution: muzzle flash, explosions, grapple rings, arming lights and the sun disc. Use it on `high` and `medium` only.
Where: `postfx.ts`. It uses the existing HalfFloat target, so bright values already survive.

### V10 — Impacts and decals
Colour sparks and dust from the hit surface's palette key (concrete grey dust, wood chips, sand puffs) instead of a blue disc on everything. Add `polygonOffset` to the decals. Give blood and scorch decals a Lambert-lit variant, so they darken in shadow.
Where: `gun.ts:386`, `effects.ts:309,491-494`.

### V11 — Explosions
Order: a white flash sphere (1 frame), then an additive fireball that fades, then a flat shockwave ring on the ground and a scorch decal. Smoke uses alpha-hash or dither fade, so it stays in the opaque pass and needs no sorting. Add a 100 ms point light. Also fix the hazard smoke, which is the only transparent material in the scene.
Where: `effects.ts:555-575`, `enemies/hazards.ts:78`.

### V12 — Model file optimisation
Use headless Blender and gltf-transform to:
- decimate `mask-shell` from 4,140 to about 500 tris
- share identical meshes
- drop TEXCOORD_0
- apply meshopt with quantisation, to get from 10.4 MB to about 1–2 MB
- at load, merge the parts of each rigid pivot by material, to get from about 50 to about 10–15 draws per enemy

This is the budget that pays for V9 and V20, and it makes the first load much faster on phones.
Where: an asset pipeline script under `tools/` (new), and `tactical.ts` for the merge.

### V13 — First-person hands and weapons in Blender
Rebuild the view hand: a readable glove with thumb and fingers, and a shorter sleeve that does not cover the fist from the camera. Author the five guns as a `weapons.glb` with chamfered, two-tone bold forms in place of code-built boxes. The shotgun, sniper and pistol read as single slabs today, and the R4-C is 30+ separate meshes.
Where: `weapons/models.ts`, a new GLB, and Blender.

### V14 — Map backdrops
- **Downtown:** a merged ring of low-poly skyline cards beyond the perimeter wall, with fog, and window strips on the wall itself.
- **Mexico:** replace the stair-stepped box mesas with faceted Blender mesas.

This hides the "box room" feeling at the edges.
Where: `downtown.ts`, `mexico.ts`, and Blender.

### V15 — Enemy hit and death
Use a short additive or emissive tint on hit instead of swapping every mesh to solid colour. For death, use a directional knockback and tumble on the existing part pivots, then a quick fade or sink in place of the 8–9 s scale-down.
Where: `materials.ts:46-61`, `enemies/model.ts:171-178`, `enemies/index.ts:414,439-492`.

### V16 — Surface variety
Add per-building vertex tint variation, lit window strips, roof clutter, and ground stains and cracks as merged decals. This breaks up large single-colour planes (the Downtown plaza and the Mexico ground) at no draw-call cost.
Where: `level/*.ts`, `build.ts`.

### V17 — Screen shake
Use smoothed noise with a direction from the damage source, and decay per impulse.
Where: `player/camera.ts:80-86`.

### V18 — View model under cover
Raycast upward (at low frequency) and dim the rig when the player is under a roof, so the gun is not sunlit inside the House.
Where: `weapons/gun.ts`, `models.ts:66`.

### V19 — Draw-call cleanup
Instance or merge Mexico's roughly 250 breakable part meshes and the 3 mariachi figures. Split the merged level into spatial chunks, so frustum culling and the shadow pass can skip what is off-screen. Instance enemy projectiles.
Where: `mexico.ts:150-184,280-331`, `build.ts`, `projectiles.ts:35`.

### V20 — SSAO or GTAO, high tier only
Add a screen-space AO pass on top of V7 for dynamic objects, meaning characters and props. Use it only after V12 frees the budget.

---

## Order of work (PR-sized)

1. **Q — Quality system.** Presets, auto-detect, dynamic resolution and the Graphics settings UI. Low = today's look, and nothing else changes visually. The realistic tiers show today's look until R1 lands. This PR also carries the cheap V items that help every tier: V4, V6 (sky and fog), V8 (view-model FOV) and V17.
   - **Progress (2026-09-25): built.** `render/quality.ts` (presets, `cs6_gfx` v1, detect, menu benchmark, dynamic resolution, frame limiter, one-time "Lower quality?" prompt); Settings → Graphics with Advanced; live apply of render scale, pixel-ratio cap, dynamic resolution (resizes the target; learns display and power-saving caps instead of treating them as load, judged on frame-time medians so one hitch cannot hide a cap) + FPS target (no preset caps it), AA (FXAA on Low, MSAA 2×/4×), shadows (off frees the map / 2048 PCF every 2nd frame, since 1024 made Low's near shadows blocky / 2048 PCF / 2048 PCFSoft / 4096 PCFSoft), effects detail, view distance (normal / long; no "short", which saved nothing and fogged out 60 m enemies), FPS counter. Phones always auto-detect to Low. AO, textures and bloom are not exposed yet. V4: soft-shoulder tone map and per-mood grade in the composite (lift in a square-root space, so black stays black and dark kit keeps its hue), Downtown's cool-morning mood. V6: sun disc and glow in the dome shader, merged unfogged clouds (Downtown, and House/Mexico too, whose old sun and clouds would have vanished in the tighter fog), per-map fog ranges, no attribute rebuild on `setMood`, no `scene.background`. One sun direction per map for the disc and the light; Downtown and Mexico put it about 32° up where their old sun spheres stood, so it shows from the spawn. V8: 65° view-model FOV by scaling the rig in camera space inside the world pass (no second pass). V17: smoothed value-noise shake plus a directional jolt from damage sources. `tests/tiers.shots.mjs` records the per-preset screenshot set, frame times (DPR 2, vsync off, warm-up discarded) and the fog at 60 m; sun or shade is tested from knee to head and around the feet against shadow-casting meshes, and a shade grunt outside the shadow box is flagged. Grunts past the shadow box's 35 m half-width render lit whatever stands over them until CSM (R1).
2. **R1 — HDR chain + skies.** Tone mapping, GTAO, bloom, grade, SMAA/TAA, CSM, and Blender-rendered skies and environments.
3. **R2 — Materials, Downtown pilot.** The material tags, box UVs, the first 8 procedural texture sets and a KTX2 pipeline, then Downtown realistic on Medium and above.
4. **R3 — Baked lighting, Downtown.** Once it looks right, R2 and R3 for House and Mexico.
5. **R4 — Weapons and arms.**
6. **R5 — Effects.**
7. **V12 + R7 — Model pipeline, then characters.** Optimise the GLB first (it helps the Low tier too), then build the realistic operators.
8. **R6 + R8 — Detail kits and atmosphere.**

Each step keeps the existing checks green (TypeScript, vitest, smoke, stairs, mobile, visual). Each step adds a fixed-viewpoint screenshot set per tier, so changes can be compared before and after.

## Housekeeping found on the way
- `docs/spec/rendering-effects.md` §4–6 still describes the old ink pipeline (single light, no shadows, outline/hatch composite). Update it or mark it superseded.
- ~~ARCHITECTURE §3.4 and §3.6 still say `antialias: true` and an `UnsignedByteType` target.~~ Fixed with step 1.
- `tactical.glb` has 132 zero-area triangles in thin plates (goggle frame and lens, view blue tab).

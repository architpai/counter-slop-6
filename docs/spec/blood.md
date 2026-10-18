# Blood

This change replaces the blood recipe and colours in [Rendering and effects](rendering-effects.md) and the blood notes in `docs/VISUALS.md` (V10). Runtime constants are in `src/engine/effects.ts`, `effects-real.ts` and `render/palette.ts`.

## Colour

Blood no longer uses `TONE.HOSTILE` (#FF4757, the HUD's alarm pink, which read as paint). Machines keep `TONE.DARK` (oil). The colours are `BLOOD` in `render/palette.ts`:

| | Hex |
|---|---|
| Fresh blood, realistic tiers | #7A0C10 |
| Dried blood (decals dry to it over 6 s) and pools | #3C0608 |
| Mist | #8A1416 |
| Low tier, one colour | #9A1119 |

`Effects.bloodHex(tone)` maps HOSTILE to blood and leaves every other tone (a piñata's colours, a scorch's dark) as it was.

## A wound (`Effects.blood(pos, dir, amount, { tone, fan })`)

`amount` grows with the hit's damage: 0.5 + damage / 70, capped at 2.2, and × 1.6 on a boss. All counts are × the gore share and thinned by the Effects detail setting.

- **Exit cone:** 16 × amount thin streaks thrown along the shot at 3–9 m/s, spread ±0.6–2.4 m/s, stretched along their flight.
- **Heavy drops:** 7 × amount larger drops at 1.2–4 m/s that fall nearer and make the floor's splashes.
- **Back spatter:** 4 × amount small drops thrown 1–3 m/s back towards the shooter.
- **Sword fan** (`fan`: the sources `melee`, `wave` and `focus`): 12 × amount more streaks thrown sideways along the swing.
- **Mist:** on the realistic tiers, 2 + 2 × amount small puffs of the smoke flipbook in the mist colour (alpha 0.55, 0.22–0.4 s, growing ×3.2). On Low, 6 × amount fine drops that hang and fade in 0.25–0.5 s.
- **Wall behind:** when amount × gore ≥ 0.45, a ray follows the shot 2.5 m past the wound. A surface there takes a spatter 0.55–1.5 m long, thrown along the shot.

## Where blood lands (`bloodDecal`)

- A drop that hits a surface leaves a mark shaped by how it landed:
  - On a wall, a large drop has a 45 % chance to leave a **drip** run.
  - Otherwise, a drop that comes in at a slant (|motion · normal| < 0.55) leaves a **spatter** thrown along its motion.
  - Any other drop leaves a round **splat**.
- **Realistic tiers:** the decal atlas's blood cells (13 spatter thrown along +u, 14 round splat, 15 drip running down −v; see `tools/blender/effects/README.md`).
  - Each mark is tinted fresh × 1.35 (making up for the cells' 0.75 grey where the blood is thick) and turned so a spatter points along its throw and a drip runs down the wall.
  - A spatter is stretched 1.1–1.5× along it.
  - Marks dry to the dried colour over 6 s (smoothstep, updated four times a second).
  - The decal ring grew from 192 to 288 to hold blood and bullet holes together.
- **Low tier:** the flat blob discs in the Low colour. A spatter streaks along its throw with satellite drops, and a drip runs down.
- **Pools** under bodies and the trails and splats of bloody gibs use the same colours and follow the gore setting.

## Blood on the sword (`weapons/blade-blood.ts`)

The blade's blood is drawn in its own material, not by quads. The old knife's six smear quads were flat, unlit HUD pink, and on the long sword they stood off its edge.
- **Mask:** each fragment's world position is taken into the blade's frame. On the realistic tier that frame is the glb's `smears` socket at the blade's root to the `tip` socket, which also gives the curved blade's rise; there, blade, guard and grip are one mesh in one material. On Low it is the flat model's root, and the blade gets its own material, separate from the shared cache.
- **Coverage:** with `t` running 0 at the guard to 1 at the tip and `h` the height across the blade (−1 at the edge), coverage = blood × 0.8 − (1 − t) × 0.9 + edge × 0.2 + noise. The noise is stretched along the blade. So blood starts at the tip, runs towards the guard in streaks as `Sword.blood` grows (+0.42 a kill, drying away at 0.05/s), and sits heavier along the edge.
- **Look:** where it only just reaches it is a half-transparent film over the steel, and where it is thick it is opaque. Its colour goes from dried towards fresh with the amount, it is wet (roughness 0.2) and not metal. Nothing shows outside the blade's span.

## Pools on uneven ground

A pool is only as wide as the flat ground under it. `_flatRadius` checks eight points round its rim, at shrinking radii, until they all find ground within 4 cm of its height. So on a stair a pool keeps to its step, where it used to hang over the edge as a dark slab. On the realistic tiers a pool is the atlas's round splat, grown in place over 0.5–1.1 s and drying.

## Gore setting

Settings → **Blood**: Off, Reduced or Full (default Full), saved as `cs6_gore`. `Effects.gore` is 0, 0.5 or 1 (`GORE_SCALE`). It scales every blood count, and pool sizes by 0.6 + 0.4 × the share. Off draws no blood, mist, decals, pools, drips or gib trails. Gibs still fly.

## Checks

`tests/blood.test.ts` covers the colour, the layered spray, the wall spatter, the gore levels and the sword fan. With a local server running, `node tests/blood.shots.mjs URL [dir] [preset]` shoots an enemy in front of a wall in training and takes screenshots.

# Combat rehaul

This change replaces the old loadout, katana controls, rifle sight, face models, and related wire fields in the other subsystem specifications. Unchanged mechanics still follow those specifications. Runtime constants are in `src/engine/weapons/stats.ts`.

## Solo run progression

Every new solo run starts at wave 1, including retries after death and starts after returning to the main menu or reloading the page. Checkpoint buttons, boss-wave unlocks, checkpoint persistence and wave-skip entry points have been removed. Old saved checkpoint values are ignored. Pause/resume keeps the current run, and personal-best scores remain saved. This replaces checkpoint behaviour in the older subsystem specifications.

## Loadout and controls

- Slots **1–5**: R4-C, MP5, shotgun, sniper, pistol. Wheel and controller next/previous cycle only these guns. `GUN_LOADOUT` in `stats.ts` owns both local and remote slot order. The revolver remains defined but is not issued.
- The R4-C uses kind `r4c`, a longer railed handguard, box magazine, solid adjustable stock and the shared ACOG/Holo models and overlays. ACOG is the default at 38° ADS FOV; Holo uses 82°. It reuses the heavier `shot` audio cue locally and positionally online. R4-C and MP5 optic choices are independent.
- The MP5 retains the internal `rifle` kind. It has a curved magazine, ribbed handguard, sliding stock, hooded front sight and tube ACOG. Its 38° ADS FOV gives about 2.5× magnification from the 82° base FOV. The overlay follows the classic NATO ACOG in Rainbow Six Siege: a thick circular housing, four corner bolts, side lugs, top adjustment cap and lower mount, with the surroundings visible outside the optic. A small red chevron has its outer tip exactly at screen centre; a red upper range scale continues into a thin black lower stem. There are no horizontal wings or floating scope labels. The lens and housing scale together with the viewport. Reference: [Ubisoft's ACOG comparison](https://www.ubisoft.com/en-gb/game/rainbow-six/siege/news-updates/77PNM7F9qztJpYi0WkRxoY/dev-blog-sights-scopes-in-y5s3).
- The pistol uses semi-automatic fire, a 15-round magazine, a moving slide and a magazine reload.
- Shotgun stats and sniper PvE stats are unchanged; sniper PvP damage is now 100 with a ×2 head multiplier. The sniper keeps its separate scope overlay. All scope overlays start at aim blend ≥ 0.8, when the gun model hides. The grapple ring is hidden while scoped.
- Tap **F/V/6**, mouse forward, **RB/R1**, or D-pad down to strike with the combat knife. Hold the same control to raise the guard after the strike cooldown. Aim remains RMB/LT/L2; fire remains LMB/RT/R2.
- Melee belongs to `player.melee`, not a weapon slot. It preserves the gun selection and works while empty or reloading. The selected gun's reload continues during melee; firing and ADS stop until the knife is put away. Death/reset cancel pending strikes and guard state.
- Knife damage is 75 against enemies, 55 against players. Range is 2.1 with a 0.8-radian half-angle and an obstruction check. Rope range is 2.4; breakable range is 2.2. Swing/cooldown are 0.27/0.33 seconds. Airborne/sprint lunge is 3.5. Existing parry and focus rewards remain; focus uses the independent knife, without a forced slot switch.
- The HUD always shows gun ammunition. A separate unlimited-melee hint sits below the five gun rows. It does not replace the ammo display.

## Five-weapon balance

These are initial playtest values, not claims of measured competitive balance. No movement-speed bonuses or new draw/fire delays are added. Aim transition and weapon-switch behaviour remain shared.

| Slot / role | PvE body damage | Head multiplier | Head damage | Shot interval | Magazine / reload |
|---|---:|---:|---:|---:|---|
| 1 R4-C — medium-range damage | 36 | 2.5 | 90 | 0.08 s | 30 / 2.2 s |
| 2 MP5 — tracking and moving fire | 22 | 2.6 | 57.2 | 0.075 s | 30 / 1.65 s |
| 3 Shotgun — close burst | 19 × 10 pellets | 1.8 | 34.2 per pellet | 0.78 s | 6 / 0.45 s per shell |
| 4 Sniper — distant precision | 150 | 3 | 450 | ~0.97 s effective | 5 / 2.1 s |
| 5 Pistol — accurate close-range finishing | 40 | 2.6 | 104 | 0.18 s, semi-auto | 15 / 1 s |

The R4-C delivers 450 theoretical body DPS versus 293.3 for the MP5, before reloads, misses, distance or wave modifiers. It pays for that with 50% more vertical camera kick (0.0105 versus 0.007), wider hip spread (0.022 versus 0.012), larger spread kick (0.007 versus 0.005) and a larger movement penalty (0.0012 versus 0.0005).

MP5 hip spread improves from 0.016 to 0.012 and movement penalty from 0.0008 to 0.0005. Pistol hip/ADS spread is 0.008/0.002, spread kick/max is 0.006/0.035, movement penalty is 0.0004, and vertical camera kick drops from 0.023 to 0.014 with smaller visual kicks. It has the best hip accuracy among the issued guns, but only 222.2 theoretical body DPS and a short full-damage range. A close headshot kills a normal 100-HP Recruit; a body kill still takes three shots (0.36 seconds from the first hit), compared with five MP5 shots (0.30 seconds) or three R4-C shots (0.16 seconds).

Sniper fire remains gated by its 0.85-second bolt cycle plus the existing 0.12-second offset, despite the 0.2-second base fire interval. Its 450-damage PvE headshot kills a 320-HP Juggernaut. Shotgun peak damage is 190 body / 342 head per complete blast; all ten pellets must connect with that region. Bullets still cannot break shields.

| Weapon | PvE falloff | PvP body / head multiplier | PvP falloff |
|---|---|---|---|
| R4-C | `[28, 88, 0.55]` | 26 / 1.8 | `[24, 74, 0.45]` |
| MP5 | `[18, 55, 0.4]` | 18 / 1.8 | `[15, 45, 0.4]` |
| Shotgun | `[11, 32, 0.22]` | 16 per pellet / 1.6 | `[9, 26, 0.15]` |
| Sniper | none | 100 / 2 | none |
| Pistol | `[12, 40, 0.35]` | 32 / 2 | `[12, 40, 0.35]` |

Falloff tuples are `[fullRange, zeroRange, minScale]`. Damage scale is `clamp(1 - (distance - fullRange) / (zeroRange - fullRange), minScale, 1)`: the minimum is reached **before** zeroRange. For example, R4-C PvE reaches its 55% floor at 55 units, and pistol PvE reaches its 35% floor at 30.2 units. Do not interpret zeroRange as the distance where the floor first starts.

Health is unchanged: **120 solo/training, 110 FFA**. PvP damage is rounded to an integer by the existing network send path. At full damage against 110 HP, body/head hit counts are R4-C 5/3, MP5 7/4, sniper 2/1 and pistol 4/2. The shotgun can kill in one close blast if enough pellets connect. The sniper no longer kills a full-health online player with a body hit.

R4-C starts with 150 reserve rounds and caps at 300. Other reserves are unchanged. Each gun retains its own ammunition. The headshot follow-up window reduces recoil/spread, not damage; wave modifiers still apply after enemy hit damage.

## Training ground and optics

- **TRAINING GROUND** on the main menu opens a separate range with all ten enemy types in labelled lanes. Targets do not move or attack unless pulled by the grapple. They keep normal health, hit reactions, shields and death effects, and respawn after three seconds. The player takes no damage, including grenade and bomber blast damage. Reserve ammunition and grenades replenish; magazine reloads work normally. Pause → **RESET RANGE** restores targets and starting position. Training does not save solo progress or replace the saved combat map.
- **Weapons** is a separate main-menu page. Pause and the online match menu also have a **Weapons** page beside **Controls** and **Settings**, keeping each view readable on small screens. The lobby exposes the same customization in an expandable **Weapons** section. General settings and the play page no longer contain standalone optic controls. Only the two configurable guns are listed: R4-C and MP5, each with independent **ACOG · 2.5×** and **Holo · 1×** buttons. No future attachment slots or upgrade framework are added.
- **ACOG** uses the existing 38° view; **Holo** uses an 82° view and a red ring/dot sight. Choices immediately update each gun's model, overlay, zoom and sensitivity behaviour without changing combat stats, ammo, or the selected gun. The MP5 keeps the existing `cs6_optic` preference; the R4-C uses `cs6_r4c_optic`. Missing or invalid saved values default to ACOG. Both choices survive weapon switches, reloads, resets and page reloads. Invalid UI values are ignored.
- Look/Holo sensitivity remains 25–250, default **100**. Independent **ACOG** and **sniper** sensitivity use the same range, default **120** and **150**, saved as `cs6_acog_sens` and `cs6_sniper_sens`. At 100, magnified optics use the existing 0.38 scoped turn-speed baseline. These values apply to mouse and controller and do not change when general look sensitivity changes. Holo retains the standard 0.62 non-magnified ADS multiplier.
- Magnification relative to the stationary 82° view is `tan(82° / 2) / tan(ADS_FOV / 2)`: **ACOG ≈ 2.52×**, **sniper ≈ 4.93×**, **Holo = 1×**. Sniper magnification is about **1.95×** that of ACOG. Zoom changes the whole camera view; there is no separate lens render.

## Hit registration

Gun rays now start at the rendered camera position and use its forward/right/up axes, including recoil, roll and shake. A zero-spread shot therefore follows the visible reticle. Normal weapon spread, movement penalties and damage falloff still apply.

Enemy and remote-player hits use Three.js mesh raycasts against the articulated model surfaces rather than separated joint spheres. This removes gaps at boots and between limbs and avoids hits in empty space around a smaller head. Humanoid head surfaces count as headshots; machine surfaces remain body hits. Weapons and name tags are not damage surfaces. Shields stop bullets only where their visible geometry is hit, and detached shields no longer block shots. World cover still wins if it is closer. The nearest player hit also wins over a more distant player's guard.

Legacy joint anchors remain for AI aiming and debug inspection. Multiplayer still uses peer-authoritative damage without lag compensation; these fixes do not change that network model.

## Downtown route corrections

Added turning platforms at both highway stair exits. Opened the tower's north rails at the stair landings, corrected a duplicated north rail into the missing west rail, and opened the level-12 bridge entrances at the tower and buildings A/B. `tests/downtown-routes.test.ts` walks complete routes through stairs, landings and entrances in solo and arena layouts; it does not merely check the highest stair tread.

## Hit and kill markers

- Body damage: white, four separated diagonal ticks, **150 ms**.
- Headshot damage: red, double diagonal ticks, **220 ms**.
- Kill confirmation: a separate gold skull below the aiming point, **350 ms**. A headshot kill shows the red ticks and gold skull together. Later body or shield hits do not restart or cancel the skull.
- Blocked shield/guard contact: blue corner brackets, **150 ms**, not a damage marker.

All markers leave the exact aiming point clear and have dark outlines for contrast. Reduced-motion mode removes the hit-marker scale effect. Multiplayer kills show the skull on the victim's death notification, not on predicted damage; damage and scoring rules are unchanged.

## Headshot feedback

An accepted gun headshot gives the shooter a brief camera-roll wobble and a **0.28-second** follow-up window. It does not move the aim direction or select a target.

- Only positive health damage to a head counts. Shields, misses, body hits, melee, focus executions and returned projectiles do not qualify.
- The roll spring uses stiffness 360 and damping 25. Its velocity is set to alternating ±0.18, rather than accumulated. Hits within 0.06 seconds refresh the window without another kick, so shotgun pellets do not multiply the wobble.
- During the window, gun camera recoil, view-model kick and spread kick are multiplied by 0.6. Spread recovery uses rate 22 instead of 7; camera recoil velocities get extra damping at rate 12.
- Death/reset clear the roll and window. The window uses simulation time.

## Enemy masks

All ten enemy types use Blender-authored models with distinct clown masks. Humanoids wear tactical equipment; the bomber, flyer, Hitbox and Lag Spike use mechanical bodies. The rusher is light, the sniper has an open hood, the shield carrier has a detachable riot shield, and the Admin has command armour and a crest. Masks use shaped shells, recessed eyes, angular red noses and painted grins, without cartoon death-eye swaps. Humanoid head anchors remain at local head Y = 0.13; gun hits follow the visible head mesh. Machines remain torso targets; their masks do not introduce headshots. Remote-player figures use the unmasked tactical operator model, with matching first-person gloves and sleeves. Attacks, damage, spawn scales and special equipment remain intact. See `assets/models/README.md` for source files, integration and checks.

## Network changes

- Zero-based network weapon indices **0–4** mean R4-C, MP5, shotgun, sniper, pistol; unknown indices show the R4-C. All peers must use the updated loadout order. Bit **512** means melee active; valid flags are 0–1023. Blocking and parry bits retain their meanings but no longer depend on a selected blade slot. Remote figures show the knife while bit 512 is set and restore the selected gun afterward.
- Damage source `melee` replaces `katana`; `pistol` and `r4c` are gun sources. `rifle` displays as MP5 and `r4c` as R4-C. R4-C participates in the same confirmed-headshot feedback as other guns.
- `pdmg` may include a non-negative safe-integer `hitId`. An addressed `headshot { hitId }` reply is sent only after the victim accepts critical damage. Spawn-protected damage gets no reply.
- The shooter accepts the reply only from the expected roster member, for a pending head hit less than one second old, and consumes it once. Pending entries are capped at 64 and cleared on leaving the session. This follows the existing peer-authoritative damage model; it is not anti-cheat.

## Checks

`npm run typecheck`, `npm test`, and `npm run build` cover types and browser unit tests. With a local server running, use `node tests/smoke.mjs URL`, `node tests/visual.check.mjs URL`, and `node tests/weapon-rehaul.check.mjs URL` for runtime, menu and weapon screenshots. `node tests/model-rework.check.mjs URL` checks every enemy model, hit area, special action and asset failure handling. `node tests/training.check.mjs URL` checks passive targets, damage, cover, respawn/reset, saved optics, zoom and independent mouse/controller sensitivity. `node tests/stairs.mjs URL` checks walking and camera smoothing on Downtown and House stairs.

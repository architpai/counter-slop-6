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
- Tap **F/V/6**, mouse forward, **RB/R1**, or D-pad down to strike with the combat knife. A grounded strike steps 1.6 forward; a sprinting or airborne strike lunges 3.5. Hold the same control to raise the guard after the strike cooldown. Aim remains RMB/LT/L2; fire remains LMB/RT/R2.
- Melee belongs to `player.melee`, not a weapon slot. It preserves the gun selection and works while empty or reloading. The selected gun's reload continues during melee; firing and ADS stop until the knife is put away. Death/reset cancel pending strikes and guard state.
- Knife damage is 75 against enemies, 55 against players. Range is 2.1 with a 0.8-radian half-angle and an obstruction check. Rope range is 2.4; breakable range is 2.2. Swing/cooldown are 0.27/0.33 seconds. Airborne/sprint lunge is 3.5; a grounded strike steps 1.6. Existing parry and focus rewards remain; focus uses the independent knife, without a forced slot switch.
- The HUD always shows gun ammunition. A separate unlimited-melee hint sits below the five gun rows. It does not replace the ammo display.

## Five-weapon balance

These are initial playtest values, not claims of measured competitive balance. Aim transition and weapon-switch behaviour remain shared, but two per-gun stats now separate the roles: `adsSpeed` (walk-speed multiplier while aiming) and `drawTime` (seconds from draw until the gun can fire, also the raise length).

| Slot / role | PvE body damage | Head multiplier | Head damage | Shot interval | Magazine / reload |
|---|---:|---:|---:|---:|---|
| 1 R4-C — medium-range damage | 36 | 2.5 | 90 | 0.08 s | 30 / 2.2 s |
| 2 MP5 — tracking and moving fire | 22 | 2.6 | 57.2 | 0.075 s | 30 / 1.65 s |
| 3 Shotgun — close burst | 19 × 10 pellets | 1.8 | 34.2 per pellet | 0.78 s | 6 / 0.45 s per shell |
| 4 Sniper — distant precision | 150 | 3 | 450 | ~0.97 s effective | 5 / 2.1 s |
| 5 Pistol — accurate close-range finishing | 40 | 2.6 | 104 | 0.18 s, semi-auto | 15 / 1 s |

The R4-C delivers 450 theoretical body DPS versus 293.3 for the MP5, before reloads, misses, distance or wave modifiers. It pays for that with 50% more vertical camera kick (0.0105 versus 0.007), wider hip spread (0.022 versus 0.012), larger spread kick (0.007 versus 0.005), a larger movement penalty (0.0012 versus 0.0005), a 0.42 s draw and 70 % walk speed while aiming.

**MP5 niche — run and gun.** Rather than nerf the R4-C, the MP5 is the only gun with no ADS slowdown (`adsSpeed` 1 versus 0.7 R4-C, 0.8 shotgun, 0.55 sniper, 0.95 pistol), the fastest draw with the pistol (0.22 s versus 0.42 R4-C, 0.45 shotgun, 0.6 sniper, 0.2 pistol), and a tighter ADS cone (0.0015 versus 0.0025). It is the gun you aim while strafing and the gun you swap to when the R4-C runs dry mid-fight; the R4-C is the gun you plant and shoot with. Sprinting now drops out while fire is held (`player-input.md` 6.2), so neither gun hip-fires at 10.6 m/s.

| Gun | adsSpeed | drawTime |
|---|---:|---:|
| R4-C | 0.7 | 0.42 s |
| MP5 | 1.0 | 0.22 s |
| Shotgun | 0.8 | 0.45 s |
| Sniper | 0.55 | 0.6 s |
| Pistol | 0.95 | 0.2 s |
| Revolver (not issued) | 0.9 | 0.3 s |

**Boss heads.** Against `stats.boss` enemies every gun's head multiplier is capped at 1.5 (`weapons.md` §8 step 11). Boss heads are 2.4–2.7× scale; uncapped, R4-C headshots killed THE ADMIN in 2.3 s.

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

## Polish pass

Findings from the mechanics review, fixed together. Gun balance (R4-C dominance, boss head multiplier, sprint fire, ADS speed, draw lockout, click buffer) is deliberately left for a later pass.

- **Focus execute vs bosses.** The dash-slash no longer deletes a boss. A boss takes 25 % of its max HP from an execute (wave damage modifiers still apply); every other enemy still dies. When the target survives, focus ends at once — streak and chain reset — because a held dash would otherwise re-dash and re-execute every frame while the target stands inside reach. See `game-loop.md` §15.
- **Nav clearance.** Node and link clearance tests use ± 0.42 instead of 0.3 / 0.25. The old value admitted nodes a 0.33-wide grunt could not stand on; Downtown spawn `[-40, 0, 18]` walked into a 0.4-wide column beside such a node and hopped there forever. Every spawn on all three maps now reaches the player (58/58 in the pathing probe); node counts drop about 4 % (Downtown 15685 → 15072, House 6806 → 6546, Mexico 17787 → 17443) and `tests/level-visuals.test.ts` baselines follow. See `physics-nav.md` §5.3.
- **Reload and holstering.** Switching weapons cancels a reload in progress instead of pausing it (the magazine used to hang in mid-air until the gun came back). Drawing an empty gun starts its reload automatically. Ammo only transfers at completion, so cancelling never loses rounds. See `weapons.md` §11.5 and §19.
- **Muzzle smoke.** Automatic guns emit one puff per shot instead of two; the shotgun keeps five. At 12–13 shots a second, two 0.2 m puffs 0.3 m from the camera covered the reticle.
- **Hit confirms.** `hitEnemy` and `headshot` are centred, non-positional cues. They used to fade with `1 / (1 + 0.09 d)` like world sounds, so a 20 m hit ticked at a third of the gun's volume.
- **Sniper hit-stop.** A sniper hit requests hit-stop (0.04 s, scale 0.3), as the shotgun already did (0.03 s, 0.3). A 150-damage body hit on a Juggernaut no longer feels like a miss.
- **Tip line.** Sits at bottom 9 % rather than 24 %, so it no longer overlaps the ACOG / sniper lens while aiming.
- **Draw lockout.** A gun fires only once its raise passes 85 % of `drawTime` (`weapons.md` §3.4, §7, §19). The raise animation used to be cosmetic: sniper → pistol → fire on the same frame.
- **Semi-auto press buffer.** A fire press stays queued for 0.1 s, so a click that lands just before the interval ends fires when it does (`weapons.md` §7 step 6). The pistol used to eat clicks faster than 5.5/s.
- **Magazine reload animation.** Rewritten so it reads (`weapons.md` §11.2): muzzle up, underside rolled toward the eye, gun lifted 0.12 so the well is on screen; the left hand leaves the fore-end, pulls the magazine out of frame, brings it back, seats it with a bump and returns; the rack kick stays at 86 %. The old version dipped the gun and dropped the magazine below the frame with the hand glued to the fore-end.
- **Sprint cancels on fire.** `sprinting` requires fire not held (`player-input.md` 6.2). The lowered sprint pose no longer shoots at full sprint speed.
- **ADS movement slowdown** via `adsSpeed` (above; `player-input.md` 6.6).
- **Double jump removed.** `AIR_JUMPS = 0` in `movement.ts` (`player-input.md` 6.10). Air dash, wall jump, slide, mantle and grapple carry the movement kit; the wave-5 tip and the controls page now teach the air dash and wall jump instead.
- **Knife step-in.** A grounded stab adds a flat 1.6 forward step (no hop, no cue); sprint/air keep the 3.5 lunge (`weapons.md` §18). Rushers strike from 3 m and the blade reaches 2.1, so a standing stab used to whiff while their swing landed.
- **Knife state on focus.** A focus dash cancels the swing and guard (`Melee._cancel`) without wiping blade blood or the combo; it used to run the full reset.
- **Regen gate removed.** Health regenerates after the delay regardless of sprinting or grappling (`player-input.md` 8.3).
- **Rifle cover roll** on being hit is 0.15 per hit, not 0.5: at 12 hits a second an automatic sent every rifleman to cover on the first burst, turning every grunt into a chase.
- **Rusher strike needs line of sight** (`e.hasLOS`) at the strike frame, so it no longer lands through a doorframe or thin cover.
- **Projectile hit radius** against the player is 0.42, not 0.5 (`enemies.md` §11.1): 0.42 around centre / eye / feet approximates the 0.35 body capsule.
- **Early waves.** First spawn at 1 s (was 2), spawn interval `max(0.7, 2.2 − 0.13 n)` (was 2.9 − 0.13 n), `maxAlive` base 4 (was 3). Wave 1 used to be 17 s of waiting for six grunts. **Enter** skips the 8 s intermission on keyboard (`game-loop.md` §12).
- **Kill feed.** Plain kills no longer post "RECRUIT +100"; only bosses, headshots, knife kills, executions, returns, falls and airborne kills reach the feed (`game-loop.md` §14).
- **Debug wave jump.** `window.__game.jumpToWave(n)` restarts the solo run at wave n. No UI reaches it; it exists so waves 10+ can be tested without playing there (`game-loop.md` §34).
- **Layering.** `render/figure.ts` no longer imports `weapons/stats`; `makeWeaponProp(kind)` takes the prop kind and `players.ts` resolves the slot.

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

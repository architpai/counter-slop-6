# Combat rehaul

This change replaces the old loadout, katana controls, rifle sight, face models, and related wire fields in the other subsystem specifications. Unchanged mechanics still follow those specifications. Runtime constants are in `src/engine/weapons/stats.ts`.

## Loadout and controls

- Slots **1–4**: MP5, shotgun, sniper, pistol. Wheel and controller next/previous cycle only these guns. The revolver remains defined but is not issued.
- The MP5 retains the internal `rifle` kind. It has a curved magazine, ribbed handguard, sliding stock, hooded front sight and tube ACOG. Its 38° ADS FOV gives about 2.5× magnification from the 82° base FOV. The overlay follows the classic NATO ACOG in Rainbow Six Siege: a thick circular housing, four corner bolts, side lugs, top adjustment cap and lower mount, with the surroundings visible outside the optic. A small red chevron has its outer tip exactly at screen centre; a red upper range scale continues into a thin black lower stem. There are no horizontal wings or floating scope labels. The lens and housing scale together with the viewport. Reference: [Ubisoft's ACOG comparison](https://www.ubisoft.com/en-gb/game/rainbow-six/siege/news-updates/77PNM7F9qztJpYi0WkRxoY/dev-blog-sights-scopes-in-y5s3).
- The pistol uses semi-automatic fire, a 15-round magazine, a moving slide and a magazine reload.
- Shotgun and sniper stats are unchanged. The sniper keeps its separate scope overlay. All scope overlays start at aim blend ≥ 0.8, when the gun model hides. The grapple ring is hidden while scoped.
- Tap **F/V**, mouse forward, **RB/R1**, or D-pad down to strike with the combat knife. Hold the same control to raise the guard after the strike cooldown. Aim remains RMB/LT/L2; fire remains LMB/RT/R2.
- Melee belongs to `player.melee`, not a weapon slot. It preserves the gun selection and works while empty or reloading. The selected gun's reload continues during melee; firing and ADS stop until the knife is put away. Death/reset cancel pending strikes and guard state.
- Knife damage is 75 against enemies, 55 against players. Range is 2.1 with a 0.8-radian half-angle and an obstruction check. Rope range is 2.4; breakable range is 2.2. Swing/cooldown are 0.27/0.33 seconds. Airborne/sprint lunge is 3.5. Existing parry and focus rewards remain; focus uses the independent knife, without a forced slot switch.
- The HUD always shows gun ammunition. A separate unlimited-melee hint sits below the four gun rows. It does not replace the ammo display.

## Training ground and optics

- **TRAINING GROUND** on the main menu opens a separate range with all ten enemy types in labelled lanes. Targets do not move or attack unless pulled by the grapple. They keep normal health, hit reactions, shields and death effects, and respawn after three seconds. The player takes no damage, including grenade and bomber blast damage. Reserve ammunition and grenades replenish; magazine reloads work normally. Pause → **RESET RANGE** restores targets and starting position. Training does not unlock checkpoints or replace the saved combat map.
- MP5 optic choice is available before play, in the lobby and in pause settings. **ACOG** uses the existing 38° view; **Holo** uses an 82° view and a red ring/dot sight. Both the equipped model and aim overlay change. The choice is saved locally as `cs6_optic`.
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

- State slot 3 now means pistol. Bit **512** means melee active; valid flags are 0–1023. Blocking and parry bits retain their meanings but no longer depend on a selected blade slot. Remote figures show the knife while bit 512 is set and restore the selected gun afterward.
- Damage source `melee` replaces `katana`; `pistol` is added. `rifle` displays as MP5.
- `pdmg` may include a non-negative safe-integer `hitId`. An addressed `headshot { hitId }` reply is sent only after the victim accepts critical damage. Spawn-protected damage gets no reply.
- The shooter accepts the reply only from the expected roster member, for a pending head hit less than one second old, and consumes it once. Pending entries are capped at 64 and cleared on leaving the session. This follows the existing peer-authoritative damage model; it is not anti-cheat.

## Checks

`npm run typecheck`, `npm test`, and `npm run build` cover types and browser unit tests. With a local server running, use `node tests/smoke.mjs URL`, `node tests/visual.check.mjs URL`, and `node tests/weapon-rehaul.check.mjs URL` for runtime, menu and weapon screenshots. `node tests/model-rework.check.mjs URL` checks every enemy model, hit area, special action and asset failure handling. `node tests/training.check.mjs URL` checks passive targets, damage, cover, respawn/reset, saved optics, zoom and independent mouse/controller sensitivity. `node tests/stairs.mjs URL` checks walking and camera smoothing on Downtown and House stairs.

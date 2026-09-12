# Combat rehaul

This change replaces the old loadout, katana controls, rifle sight, face models, and related wire fields in the other subsystem specifications. Unchanged mechanics still follow those specifications. Runtime constants are in `src/engine/weapons/stats.ts`.

## Loadout and controls

- Slots **1–4**: MP5, shotgun, sniper, pistol. Wheel and controller next/previous cycle only these guns. The revolver remains defined but is not issued.
- The MP5 retains the internal `rifle` kind. It has a curved magazine, ribbed handguard, sliding stock, hooded front sight and tube ACOG. Its 25° ADS FOV gives about 4× magnification from the 82° base FOV. The overlay uses a red chevron and range marks, not a holographic dot.
- The pistol uses semi-automatic fire, a 15-round magazine, a moving slide and a magazine reload.
- Shotgun and sniper stats are unchanged. The sniper keeps its separate scope overlay. Both scope overlays start at aim blend ≥ 0.8, when the gun model hides. The grapple ring is hidden while scoped.
- Tap **F/V**, mouse forward, **RB/R1**, or D-pad down to strike with the combat knife. Hold the same control to raise the guard after the strike cooldown. Aim remains RMB/LT/L2; fire remains LMB/RT/R2.
- Melee belongs to `player.melee`, not a weapon slot. It preserves the gun selection and works while empty or reloading. The selected gun's reload continues during melee; firing and ADS stop until the knife is put away. Death/reset cancel pending strikes and guard state.
- Knife damage is 75 against enemies, 55 against players. Range is 2.1 with a 0.8-radian half-angle and an obstruction check. Rope range is 2.4; breakable range is 2.2. Swing/cooldown are 0.27/0.33 seconds. Airborne/sprint lunge is 3.5. Existing parry and focus rewards remain; focus uses the independent knife, without a forced slot switch.
- The HUD always shows gun ammunition. A separate unlimited-melee hint sits below the four gun rows. It does not replace the ammo display.

## Headshot feedback

An accepted gun headshot gives the shooter a brief camera-roll wobble and a **0.28-second** follow-up window. It does not move the aim direction or select a target.

- Only positive health damage to a head counts. Shields, misses, body hits, melee, focus executions and returned projectiles do not qualify.
- The roll spring uses stiffness 360 and damping 25. Its velocity is set to alternating ±0.18, rather than accumulated. Hits within 0.06 seconds refresh the window without another kick, so shotgun pellets do not multiply the wobble.
- During the window, gun camera recoil, view-model kick and spread kick are multiplied by 0.6. Spread recovery uses rate 22 instead of 7; camera recoil velocities get extra damping at rate 12.
- Death/reset clear the roll and window. The window uses simulation time.

## Enemy masks

Every enemy type opts into a distinct procedural clown mask. Remote-player figures remain unmasked. The masks use ivory shells, dark eye sockets, red noses and varied paint, mouths and side shapes. Existing hats, shields, body shapes, death-eye swaps and hit anchors remain. Masks do not add hit spheres; blob/flyer masks remain torso targets.

## Network changes

- State slot 3 now means pistol. Bit **512** means melee active; valid flags are 0–1023. Blocking and parry bits retain their meanings but no longer depend on a selected blade slot. Remote figures show the knife while bit 512 is set and restore the selected gun afterward.
- Damage source `melee` replaces `katana`; `pistol` is added. `rifle` displays as MP5.
- `pdmg` may include a non-negative safe-integer `hitId`. An addressed `headshot { hitId }` reply is sent only after the victim accepts critical damage. Spawn-protected damage gets no reply.
- The shooter accepts the reply only from the expected roster member, for a pending head hit less than one second old, and consumes it once. Pending entries are capped at 64 and cleared on leaving the session. This follows the existing peer-authoritative damage model; it is not anti-cheat.

## Checks

`npm run typecheck`, `npm test`, and `npm run build` cover types and browser unit tests. With a local server running, use `node tests/smoke.mjs URL`, `node tests/visual.check.mjs URL`, and `node tests/weapon-rehaul.check.mjs URL` for runtime, menu and weapon screenshots.

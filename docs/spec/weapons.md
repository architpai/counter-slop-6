# Weapons Subsystem Specification

> Current combat changes: [Combat rehaul](combat-rehaul.md). It replaces the old loadout, katana, rifle stats/sight and scope rules below.

This document describes the behaviour of the first-person weapons: three guns in the player's loadout (rifle, shotgun, sniper), one gun that is defined but not issued (revolver), and the katana. It covers stats, timing, state machines, view-model geometry and animation, hit detection, spawned effects, audio cues, and the contracts with the other subsystems.

All distances are in world units (1 unit ≈ 1 metre). All angles are in radians unless stated. All times are in seconds. "Frame time" is the simulation step for the current frame.

## Table of contents

1. [Overview and loadout](#1-overview-and-loadout)
2. [Shared math helpers](#2-shared-math-helpers)
3. [Shared view-model behaviour](#3-shared-view-model-behaviour)
   - 3.1 Coordinate frame and scale
   - 3.2 Rest pose, aim pose, sight alignment
   - 3.3 Springs
   - 3.4 Per-frame pose blend (sway, bob, sprint, recoil, raise, land dip, slide tilt)
   - 3.5 Equip / unequip / draw
   - 3.6 Scoped weapon visibility rule
4. [Gun stat table](#4-gun-stat-table)
5. [Gun runtime state](#5-gun-runtime-state)
6. [Spread and bloom](#6-spread-and-bloom)
7. [Gun frame update and firing rules](#7-gun-frame-update-and-firing-rules)
8. [Firing a shot](#8-firing-a-shot)
9. [Hit detection (hitscan ray)](#9-hit-detection-hitscan-ray)
10. [Damage, headshots, and falloff](#10-damage-headshots-and-falloff)
11. [Reloading](#11-reloading)
    - 11.1 Common rules
    - 11.2 Magazine reload (rifle, sniper)
    - 11.3 Shell-by-shell reload (shotgun)
    - 11.4 Cylinder reload (revolver)
    - 11.5 Auto-reload and empty click
12. [Pump / bolt cycle (shotgun, sniper)](#12-pump--bolt-cycle-shotgun-sniper)
13. [Recoil and camera kick](#13-recoil-and-camera-kick)
14. [Aim-down-sights](#14-aim-down-sights)
15. [Shell casings](#15-shell-casings)
16. [Muzzle flash, smoke, tracers, impacts](#16-muzzle-flash-smoke-tracers-impacts)
17. [Gun view-model geometry](#17-gun-view-model-geometry)
    - 17.1 Primitive helpers
    - 17.2 Rifle
    - 17.3 Shotgun
    - 17.4 Sniper
    - 17.5 Revolver
18. [Katana](#18-katana)
    - 18.1 Stats and state
    - 18.2 Geometry
    - 18.3 Input and state machine
    - 18.4 Starting a slash
    - 18.5 Slash animation
    - 18.6 Slash hit test and damage
    - 18.7 Guard (block) pose
    - 18.8 Parry flick and deflect feedback
    - 18.9 Blade blood (tone) accumulation
    - 18.10 Quick-melee from a gun
19. [Weapon switching](#19-weapon-switching)
20. [Ammo pickups and reset](#20-ammo-pickups-and-reset)
21. [Audio cues](#21-audio-cues)
22. [Interfaces with other subsystems](#22-interfaces-with-other-subsystems)
    - 22.1 Player → weapon: the per-frame input/state record
    - 22.2 Weapon → player
    - 22.3 Weapon → enemies
    - 22.4 Weapon → world / physics
    - 22.5 Weapon → remote players (versus) and game callbacks
    - 22.6 Weapon → effects
    - 22.7 Weapon → audio and input (rumble)
    - 22.8 Weapon → HUD (what the weapon exposes each frame)
    - 22.9 Weapon → network
    - 22.10 Game → katana (blood, forced cooldown, focus mode)

---

## 1. Overview and loadout

- The player carries four weapons in fixed slots: slot 1 rifle, slot 2 shotgun, slot 3 sniper, slot 4 katana. The katana index is 3 (zero-based).
- A fifth weapon, the revolver, is fully defined (stats, model, reload) but is not placed in the loadout. It must be implemented so it can be issued later; its rules are given in this document with the other guns.
- The three guns and the revolver are hitscan. There are no projectile weapons in this subsystem (no bullet travel time, no gravity, no lifetime). Ray length for every shot is 300 units.
- The katana is a melee weapon with an arc hit test, a guard (block) pose, and a parry flick.
- Every weapon has a first-person view model attached to the camera. The weapon that is equipped is the only one updated each frame; holstered weapons are hidden and their frame-driven timers do not advance. The delayed auto-reload callback uses real time and follows section 11.5.

## 2. Shared math helpers

These helpers are used throughout. An implementer must reproduce them exactly.

| Helper | Definition |
|---|---|
| clamp(v, a, b) | v limited to the range [a, b] |
| lerp(a, b, t) | a + (b − a) · t |
| damp(a, b, λ, dt) | lerp(a, b, 1 − e^(−λ·dt)) — exponential approach of a toward b with rate λ per second |
| rand(a, b) | uniform random number in [a, b) |
| easeOut(t) | 1 − (1 − t)³ |
| easeInOut(t) | if t < 0.5: 4t³ ; else 1 − (−2t + 2)³ / 2 |
| TAU | 2π |

Damped 3-D spring ("Spring3"): has a value vector, a velocity vector, a target vector (always zero for weapons), stiffness k and damping d. Each update with step dt: if dt > 0.02 the step is split into 3 sub-steps, else 1. For each sub-step h: force = (target − value)·k − velocity·d; velocity += force·h; value += velocity·h. A "kick(x, y, z)" adds (x, y, z) to the velocity. The 1-D spring used by the player camera works the same way on scalars.

## 3. Shared view-model behaviour

### 3.1 Coordinate frame and scale

- The view model root is a child of the camera. Its local axes are camera axes: +x right, +y up, −z forward (into the screen).
- The root is uniformly scaled by **0.46**. All geometry positions and sizes in section 17 and 18.2 are in unscaled model units (multiply by 0.46 to get camera-space size). The shared camera rig has scale 1. Root rest/aim positions are camera-space translations and are not multiplied by 0.46 again.
- The root is hidden until the weapon is equipped.

### 3.2 Rest pose, aim pose, sight alignment

Each view model has:

- **Rest position** (camera space). Default (0.20, −0.17, −0.36). Overridden per weapon (see tables).
- **Rest rotation** (Euler x, y, z). Default (0, 0, 0). Only the katana overrides it.
- **Aim position**: where the model sits when fully aimed. Default (0, −0.13, −0.30). For guns it is computed from the sight alignment below; for the katana it equals the rest position.
- **ADS field of view**, default 60 (guns override).

Sight alignment: each gun declares a sight point (sx, sy, sz) in model units and an eye distance D. The aim position is then:

aimPos = (−sx · 0.46, −sy · 0.46, −sz · 0.46 − D)

This places the sight point exactly on the camera axis, D units in front of the eye.

| Gun | Sight point (model units) | D | Resulting aim position (camera space) |
|---|---|---|---|
| Rifle | (0, 0.12, −0.05) | 0.30 | (0, −0.0552, −0.277) |
| Shotgun | (0, 0.095, −1.00) | 0.52 | (0, −0.0437, −0.060) |
| Sniper | (0, 0.135, 0) | 0.42 | (0, −0.0621, −0.420) |
| Revolver | (0, 0.08, −0.34) | 0.42 | (0, −0.0368, −0.2636) |

### 3.3 Springs

Each view model owns two 3-D springs, both with zero target:

- **Recoil position spring**: stiffness 260, damping 18. Its value is added to the model position.
- **Recoil rotation spring**: stiffness 220, damping 16. Its value is added to the model rotation.

Both are updated once per frame with the frame time, before the pose is composed.

### 3.4 Per-frame pose blend

Inputs come from the player's per-frame state record (see 22.1): look delta (lx, ly), aim flag, strafe axis, bob phase, bob amount, sprint flag, land dip, slide tilt.

Step by step, each frame:

1. Clamp look delta: lx = clamp(lookDelta.x, −0.12, 0.12), ly = clamp(lookDelta.y, −0.12, 0.12).
2. Aim amount: aimAmt = damp(aimAmt, aim ? 1 : 0, 14, dt). Let ia = 1 − aimAmt ("inverse aim").
3. Sway position (damped, rate 10):
   - swayPos.x → lx · 0.5 · (0.3 + 0.7·ia)
   - swayPos.y → ly · 0.35 · (0.3 + 0.7·ia)
4. Sway rotation:
   - swayRot.y → lx · 1.4 · ia (rate 10)
   - swayRot.x → ly · 0.9 · ia (rate 10)
   - swayRot.z → (−lx · 1.8 − strafe · 0.06) · ia (rate 8)
5. Bob: bobX = sin(bobPhase) · 0.013 · bobAmt · (0.15 + 0.85·ia); bobY = |cos(bobPhase)| · 0.013 · bobAmt · (0.15 + 0.85·ia).
6. Sprint amount: sprintAmt = damp(sprintAmt, (sprinting and not aiming) ? 1 : 0, 8, dt).
7. Update both recoil springs.
8. Draw/raise progress: equipT = min(1, equipT + dt / drawTime), where drawTime is the gun's stat (R4-C 0.42 s, MP5 0.22, shotgun 0.45, sniper 0.6, pistol 0.2, revolver 0.3; knife 0.31). Raise offset eq = 1 − easeOut(equipT). A gun is **drawn** (may fire) once equipT ≥ 0.85; the last 15 % is settle. `resetAmmo` does not reset equipT — only `equip` does, and a player reset re-equips.
9. Position = lerp(restPos, aimPos, aimAmt), then:
   - x += swayPos.x + bobX + recoilPos.x · (0.3 + 0.7·ia) + sprintAmt · 0.06
   - y += swayPos.y + bobY + recoilPos.y · (0.3 + 0.7·ia) − eq · 0.32 − landDip · 0.35 · ia − sprintAmt · 0.09
   - z += recoilPos.z + sprintAmt · 0.05
10. Rotation (Euler):
    - x = restRot.x · ia + swayRot.x + recoilRot.x − eq · 0.9 + sprintAmt · 0.4 + landDip · 0.5 · ia
    - y = restRot.y · ia + swayRot.y + recoilRot.y · (0.4 + 0.6·ia) − sprintAmt · 0.55
    - z = restRot.z · ia + swayRot.z + recoilRot.z · (0.3 + 0.7·ia) + sprintAmt · 0.18 + slideTilt · 0.4 · ia
11. Scoped visibility rule (3.6).
12. The weapon-specific per-frame update runs (guns: section 7; katana: 18.3). Reload, pump, slash and guard animations add their offsets on top of the pose composed above (or, for the katana guard, blend the whole pose toward an absolute target).

Note the recoil springs are also kicked by the player's grapple (see 22.2), so the weapon must accept external kicks at any time.

### 3.5 Equip / unequip / draw

- Equip: set equipT = 0 and show the root. The model then rises from 0.32 below and 0.9 rad pitched down over 0.3125 s (eased out).
- Unequip: hide the root. Nothing else is reset — a reload, pump cycle, fire cooldown, flash timer or slash in progress is frozen and resumes when the weapon is equipped again. A pending auto-reload callback still runs after its real-time delay (11.5); any reload it starts remains frozen until re-equip.
- There is no draw lockout: a freshly equipped weapon may fire on the same frame it is equipped (subject to its own fire timer).

### 3.6 Scoped weapon visibility rule

A weapon flagged as scoped (the sniper) hides its whole view model while aimAmt ≥ 0.8 and shows it again when aimAmt < 0.8, evaluated every frame. The HUD scope overlay (owned by the HUD) is switched on when aimAmt > 0.62 (see 22.8).

## 4. Gun stat table

| Stat | Rifle | Shotgun | Sniper | Revolver (not issued) |
|---|---|---|---|---|
| HUD name | RIFLE | SHOTGUN | SNIPER | REVOLVER |
| HUD hint | "auto · put the red dot on them" | "pump · devastating up close" | "scoped bolt action · one shot, one kill" | "hand cannon · headshots delete" |
| Kind identifier | rifle | shotgun | sniper | revolver |
| Scoped | no | no | yes | no |
| Magazine size | 35 | 6 | 5 | 6 |
| Starting reserve | 175 | 36 | 25 | 36 |
| Max reserve | 350 | 72 | 50 | 72 |
| Fire interval (s) | 1/11 ≈ 0.0909 (11 shots/s) | 0.78 | 0.20 (but see cycle) | 0.30 |
| Trigger | automatic (hold) | semi (press) | semi (press) | semi (press) |
| Damage per pellet (vs enemies) | 24 | 19 | 150 | 62 |
| Headshot multiplier (vs enemies) | 2.6 | 1.8 | 3.0 | 3.0 |
| Pellets per shot | 1 | 10 | 1 | 1 |
| Hip spread (base) | 0.018 | 0.062 | 0.075 | 0.006 |
| ADS spread (base) | 0.004 | 0.034 | 0.0004 | 0.002 |
| Spread kick per shot | 0.011 | 0 | 0.05 | 0.02 |
| Spread maximum | 0.09 | 0.10 | 0.14 | 0.06 |
| Move spread per unit of speed | 0.0012 | 0.0006 | 0.004 | 0.0015 |
| ADS FOV (degrees) | 58 | 68 | 20 | 52 |
| Camera kick [pitch, yaw] | [0.011, 0.004] | [0.05, 0.012] | [0.055, 0.008] | [0.038, 0.007] |
| Model kick [px, py, pz, rx, ry, rz] | [0.25, 0.3, 2.4, −3.2, 0.9, 1.2] | [0.4, 0.6, 5, −9, 2, 3] | [0.25, 0.8, 4.5, −11, 1.2, 2] | [0.3, 0.9, 3.2, −10, 1.5, 2.5] |
| FOV kick | 1.2 | 4 | 4.5 | 2.5 |
| Reload duration (s) | 1.45 (whole mag) | 0.45 (per shell) | 2.1 (whole mag) | 1.9 (whole cylinder) |
| Reload type | magazine | shells | magazine | cylinder |
| Damage falloff (vs enemies) [start, end, floor] | none | [11, 32, 0.22] | none | none |
| Tracer thickness | 0.02 | 0.014 | 0.03 | 0.026 |
| Muzzle flash scale | 1.0 | 1.9 | 1.7 | 1.35 |
| Fire sound cue | "shot" | "shotgunFire" | "sniperFire" | "revolver" |
| Shell casing [size, colour] | [0.02, orange] | [0.035, red] | [0.03, orange] | none |
| Cycle (pump/bolt) duration (s) | none | 0.45 | 0.85 | none |
| Versus (PvP) [damage, head mult, falloff] | [19, 1.8, none] | [16, 1.6, [9, 26, 0.15]] | [150, 1.5, none] | [52, 2.9, [9, 34, 0.42]] |
| Rest position (camera space) | (0.20, −0.17, −0.36) | (0.20, −0.19, −0.34) | (0.21, −0.19, −0.36) | (0.19, −0.20, −0.30) |

Effective time between shots (the larger of fire interval and cycle lockout, see section 12): rifle 0.0909 s; shotgun 0.78 s; sniper 0.97 s; revolver 0.30 s.

## 5. Gun runtime state

Every gun keeps:

| Field | Initial | Meaning |
|---|---|---|
| mag | magazine size | rounds in the magazine |
| reserve | starting reserve | rounds carried |
| starting reserve | starting reserve | remembered for player reset |
| fire timer | 0 | counts down; may fire when ≤ 0 |
| reloading | false | a reload is in progress |
| reload timer | 0 | seconds into the current reload (or current shell) |
| current spread | hip spread | see section 6 |
| flash timer | 0 | muzzle flash visible while > 0 |
| pump timer | 0 | pump/bolt cycle lockout, counts down |
| pumped flag | false | the cycle's "rack" event has fired |
| racked flag | false | the reload's one-shot event has fired |
| need-pump flag | false | shotgun: a pump is owed after a shell reload (see 11.3) |
| aim amount, sprint amount, equip progress | 0 | see section 3 |

## 6. Spread and bloom

Spread is a scalar s. A shot direction is built from the player's forward vector f and right vector r:

dir = normalize( f + r · rand(−s, s) + (0, rand(−s, s), 0) )

So the distribution is a square (not a disc) of half-width s in the plane perpendicular to the view at unit distance; the angular half-width is atan(s). Each pellet of a shotgun draws its own random offset.

Per-frame bloom dynamics (guns only), before firing checks:

1. base = aiming ? ADS spread : hip spread.
2. moveAdd = horizontalSpeed · moveSpread + (grounded ? 0 : 0.01) + (sliding ? 0.008 : 0).
3. currentSpread = damp(currentSpread, base + moveAdd, 7, dt).

The damp is not clamped to the spread maximum; only the per-shot kick is clamped. On each shot the spread value used for that shot is the current value before the kick; after the shot currentSpread = min(currentSpread + spreadKick, spreadMax).

Crosshair size exposed to the HUD (pixels): guns 5 + currentSpread · 900; katana constant 4. Examples: rifle hip 21.2 px, rifle ADS 8.6 px, rifle max 86 px; sniper hip 72.5 px, sniper ADS 5.36 px; shotgun hip 60.8 px.

## 7. Gun frame update and firing rules

Executed each frame for the equipped gun, after the shared pose blend (3.4), in this order:

1. fire timer −= dt. If flash timer > 0: flash timer −= dt; when it reaches ≤ 0 hide the flash.
2. Bloom update (section 6).
3. If pump timer > 0: run the cycle animation (section 12).
4. If reloading: run the reload of the gun's type (section 11). For magazine and cylinder reloads, **the frame ends here** — no reload press and no fire input is examined while such a reload runs (they cannot be cancelled). The shell reload falls through to the steps below (it can be interrupted by firing).
5. Reload press: if reload was pressed this frame AND mag < magazine size AND reserve > 0 AND not reloading AND pump timer ≤ 0 → start reload (11.1) and end the frame.
6. Want-fire: automatic guns use "fire held". Semi-automatic guns use a **press buffer**: a fire press sets the buffer to 0.1 s, otherwise it counts down; want-fire = buffer > 0. A click that lands up to 100 ms before the fire interval ends therefore still fires when it does, instead of being eaten. The buffer is cleared whenever step 7 passes its gate (fired, empty click or not).
7. If want-fire AND fire timer ≤ 0 AND pump timer ≤ 0 AND fire is not blocked (player dead) AND the gun is drawn (3.4 step 8):
   - If mag ≤ 0: only on a fire *press* (not hold): play the empty-click cue and start a reload (11.1).
   - Else: if a (shell) reload is running, cancel it (reloading = false; the left hand snaps back to its rest position) and fire (section 8).

## 8. Firing a shot

1. fire timer = fire interval. mag −= 1.
2. spreadNow = currentSpread; then currentSpread = min(currentSpread + spreadKick, spreadMax).
3. For each pellet (1 or 10): cast one hitscan ray from the player's eye position along a fresh spread direction (section 6) and resolve it (section 9). Count the rays that hit a damageable target.
4. Muzzle flash: show it, flash timer = 0.045 s, random roll about its forward axis in [0, 2π), uniform scale = flashScale · rand(0.8, 1.4).
5. Effects at the muzzle's world position: a stroke burst (orange, count = 4 + pellets, speed = 6 · flashScale, life 0.08, size 0.03, no gravity, drag 8) and muzzle smoke along the player's forward vector (5 puffs for the shotgun, 1 for an automatic gun, 2 for any other gun — automatics fire fast enough that 2 per shot filled the sight picture).
6. Shell casing: if the gun has a casing definition and its reload type is not "shells", eject one casing now (section 15). (Rifle and sniper eject on fire; the shotgun ejects during the pump; the revolver never ejects.)
7. If the gun has a cycle duration: pump timer = cycle duration + 0.12; pumped flag = false; if reload type is "shells" set the need-pump flag.
8. Model kick with K = model kick array: recoil position spring kick ( rand(−K0, K0), rand(0.4·K1, K1), K2 ); recoil rotation spring kick ( K3, rand(−K4, K4), rand(−K5, K5) ).
9. Camera kick: pitch = camKick[0] · (aiming ? 0.7 : 1) + rand(0, camKick[0] · 0.3); yaw = rand(−camKick[1], camKick[1]); call the player's recoil(pitch, yaw) and FOV kick(fovKick) (see 22.2).
10. Play the gun's fire cue. Gamepad rumble: strong 0.15 + fovKick · 0.08, weak 0.5, duration 40 + fovKick · 15 ms. Screen shake amount += 0.02 + fovKick · 0.02.
11. Against a boss (`stats.boss`), the head multiplier is capped at 1.5 for every gun; boss heads are 2.4–2.7× scale and an uncapped 2.5× turned a boss into a two-second magazine. If at least one pellet hit: the shotgun requests hit-stop for 0.03 s at time scale 0.3; the sniper for 0.04 s at 0.3. Other guns leave hit-stop to kills.
12. If mag is now 0 and the reload type is "magazine": schedule one callback for 250 ms later (real time). If mag is still 0 and not reloading when it runs, start a reload, even if a pump/bolt cycle is running. Cancel the callback on player reset or weapon disposal (11.5).

Derived per-gun values for step 10: rifle rumble (0.246, 0.5, 58 ms), shake +0.044; shotgun (0.47, 0.5, 100 ms), +0.10; sniper (0.51, 0.5, 107.5 ms), +0.11; revolver (0.35, 0.5, 77.5 ms), +0.07.

## 9. Hit detection (hitscan ray)

Given origin (player eye) and unit direction, maximum distance 300:

1. Query three sources, each returning the nearest hit or nothing:
   - **Enemies**: sphere tests against every living enemy's hit spheres; returns enemy, part name, distance, point.
   - **World**: axis-aligned box raycast, ignoring boxes flagged "no-shoot" (see-through); returns distance, point, surface normal, box (with its data, including an optional breakable reference).
   - **Remote players** (only when the versus hook exists): sphere tests against living, hurtable remote players' hit spheres, plus a "blade" sphere (radius 0.42, centred 0.5 in front of the chest at +0.3 height) when that player is blocking; returns player, part, distance, point.
2. Resolve in this priority:
   - a. If a remote player was hit and it is nearer than both the enemy hit and the world hit (or those do not exist): the ray ends there; apply versus damage (section 10) through the game's hit-player hook with info {point, dir, part, source = gun kind, crit, dist}. Counts as a hit.
   - b. Else if the world hit exists, its box is a breakable prop, it is nearer than the enemy hit (or none), and the break hook exists: the ray ends there; call the break hook with (breakable, base damage of the gun — no head/falloff scaling, point, dir). Counts as a hit.
   - c. Else if the enemy hit exists and is nearer than the world hit (or none): the ray ends there; apply enemy damage (section 10) with info {point, dir, part, source = gun kind, crit}. Counts as a hit.
   - d. Else if the world hit exists: the ray ends there; spawn a bullet impact (point, normal, blue); with probability 0.25 play the ricochet cue positioned at the point. Not a hit.
   - e. Else: the ray ends at origin + dir · 300. Not a hit.
3. Draw a tracer from the muzzle's world position to the end point (blue, thickness = the gun's tracer thickness, life 0.05 s).
4. Call the "shot fired" hook with the end point (used by networking, 22.9).

There is no penetration: each ray stops at its first resolved surface. "Crit" is true only when the part name is exactly "head". A hit on an enemy's "shield" part is passed to the enemy system unchanged (the enemy system decides that bullets do no damage to shields).

## 10. Damage, headshots, and falloff

Versus enemies:

damage = baseDamage · (part = head ? headMul : 1)

If the gun has a falloff [start, end, floor]:

damage ·= clamp( 1 − (dist − start) / (end − start), floor, 1 )

i.e. full damage up to `start`, linear decrease until `end`, never below `floor` of full.

Versus remote players the same formula uses the gun's PvP triple [damage, head mult, falloff] instead (see table). If a gun had no PvP triple the enemy values would be used; all four guns define one.

Each shotgun pellet is scored independently (own random offset, own part, own falloff distance). Maximum shotgun damage vs enemies inside 11 units: 190 body / 342 all-head.

Numbers (vs enemies): rifle 24 / 62.4 head; shotgun pellet 19 / 34.2 head, at ≥ 32 units 4.18 / 7.52; sniper 150 / 450; revolver 62 / 186.

## 11. Reloading

### 11.1 Common rules

Start reload is a no-op if already reloading, or mag is full, or reserve is 0. Otherwise: reloading = true, reload timer = 0, racked flag = false, and play the reload cue for the type: magazine → "reload" cue; shells → "shell" cue; cylinder → "cylinder" cue.

Rounds already in the magazine are never lost; a reload only tops up. The ammo transfer for magazine and cylinder types happens only at the very end (take = min(magSize − mag, reserve); mag += take; reserve −= take). Switching weapons mid-reload freezes it; it resumes on re-equip.

### 11.2 Magazine reload (R4-C 2.2 s, MP5 1.65 s, sniper 2.1 s, pistol 1 s)

The old animation dipped the gun *down* while the magazine dropped *below* the frame and the left hand never moved, so a reload read as "the gun dips". The current one lifts the gun so the magazine well is on screen and drives the hand.

With t = reloadTimer / reloadDuration (0 → 1):

- Tilt envelope: tilt = easeOut(clamp(t / 0.16, 0, 1)) · (t < 0.84 ? 1 : 1 − easeOut(clamp((t − 0.84) / 0.16, 0, 1))). In over the first 16 %, out over the last 16 %.
- Model offsets added: rotation x += 0.45·tilt (muzzle up), y += 0.12·tilt, z −= 0.7·tilt (underside rolled toward the eye); position x −= 0.04·tilt, y += 0.12·tilt, z += 0.05·tilt.
- Magazine travel, drop ∈ [0, 1] (0 seated, 1 out of frame): out = easeInOut(clamp((t − 0.16) / 0.26, 0, 1)), back = easeInOut(clamp((t − 0.5) / 0.26, 0, 1)); drop = t < 0.5 ? out : 1 − back. Seat bump: for 0.76 ≤ t < 0.84, sin((t − 0.76) / 0.08 · π) · 0.015 added to y. Mag mesh: position = rest + (0, −0.5·drop + seat, 0.08·drop); rotation z = rest + 0.55·drop, x = rest − 0.2·drop.
- Left hand: grip = easeInOut(clamp((t − 0.04) / 0.12, 0, 1)) − easeInOut(clamp((t − 0.8) / 0.12, 0, 1)) (0 → 1 → 0). Hand position = lerp(rest, magPosition + (−0.05, −0.09, 0.02), grip); hand roll z = rest + 0.6·grip. The hand therefore leaves the fore-end, follows the magazine out of frame and back, and returns. A gun without a magazine part (none today) drops the hand by 0.12·drop instead.
- Rack event, once when t > 0.86: recoil rotation spring kick (−2.5, 0, 0); recoil position spring kick (0, 0, 0.6).
- Completion when reloadTimer ≥ duration: transfer ammo, reloading = false, magazine and hand snapped to rest.

Phase timings as fractions of the duration: tilt-in 0–0.16, hand to mag 0.04–0.16, mag out 0.16–0.42, mag back 0.5–0.76, seat 0.76–0.84, hand home 0.8–0.92, rack 0.86, tilt-out 0.84–1.

Cannot be interrupted by fire or reload input.

### 11.3 Shell-by-shell reload (shotgun, 0.45 s per shell)

Each shell is one cycle of the reload timer:

- s = sin( min(1, reloadTimer / 0.45) · π ).
- Offsets: rotation z += 0.35·s, x += 0.15·s; position y −= 0.04·s. The left hand mesh moves to restPos + (0.1·s, −0.12·s, 0.55·s) (i.e. it swings back toward the loading port).
- When reloadTimer ≥ 0.45: mag += 1, reserve −= 1, reloadTimer = 0. Then if mag is full or reserve is 0: reloading = false, left hand snaps to rest, and if the need-pump flag is set a pump cycle begins (pump timer = 0.45, without the extra 0.12). Otherwise play the "shell" cue again and continue with the next shell.
- Interruption: pressing fire (with mag > 0) on any frame cancels the reload immediately (shells already inserted are kept) and fires. A reload press during a shell reload does nothing.
- A full reload from empty takes 6 × 0.45 = 2.7 s.

Note on the need-pump flag: it is set by every shotgun shot and cleared when the pump cycle finishes; because a reload cannot start while a pump cycle runs, the flag is normally already clear when a reload completes, so the "pump after reload" branch is latent. Implement it as stated for fidelity.

### 11.4 Cylinder reload (revolver, 1.9 s)

With t = reloadTimer / 1.9:

- open = t < 0.25 ? easeOut(t / 0.25) : t > 0.8 ? 1 − easeOut((t − 0.8) / 0.2) : 1.
- Offsets: rotation z += 0.9·open, x += 0.3·open; position x −= 0.05·open, y += 0.02·open. The cylinder group rolls out: its z rotation = −1.5·open.
- Once when t > 0.3: play the "shell" cue and attempt to eject 6 casings with lateral spread factor 0.7 — the revolver has no casing definition, so nothing visible is spawned (only the cue).
- Completion at 1.9 s: transfer ammo, reloading = false, cylinder group rotation reset to 0.
- Cannot be interrupted. Absolute timings: swing-out 0–0.475 s, eject cue 0.57 s, swing-in 1.52–1.9 s.

### 11.5 Auto-reload and empty click

- Magazine guns (rifle, sniper) auto-reload 250 ms of real time after the shot that emptied the magazine, if still empty and not already reloading. The common reload rules still apply, including the reserve-ammo check. This delayed callback can start a reload during the sniper's bolt cycle; only manual reload input is blocked by that cycle.
- The callback uses a weapon-owned timer. Its delay continues while holstered, paused, or in hit-stop. Only the equipped weapon advances the reload animation. Cancel any pending callback on player reset or weapon disposal so it cannot affect a later run.
- Drawing a gun whose magazine is empty starts its reload at once (subject to the common reload rules), so a gun holstered mid-reload is not left empty and silent on return.
- Any gun with mag = 0: a fire *press* plays the empty click and starts a reload (if reserve > 0). Holding fire on an empty automatic rifle does nothing after the first press.

## 12. Pump / bolt cycle (shotgun, sniper)

Started by a shot with pump timer = cycleDuration + 0.12 (shotgun 0.57 s, sniper 0.97 s). While pump timer > 0 the gun cannot fire or start a reload from manual input. The delayed automatic reload in 11.5 may start during the cycle. Each frame:

1. pumpTimer −= dt.
2. t = 1 − pumpTimer / cycleDuration. Note t starts negative (shotgun −0.267, sniper −0.141) and reaches 0 at 0.12 s after the shot.
3. s = sin( min(1, t · 1.15) · π ). For negative t this is negative (shotgun starts at ≈ −0.82, sniper ≈ −0.49, rising to 0 at 0.12 s); it peaks at +1 when t = 0.435 and returns to 0 at t = 0.87, staying 0 until t = 1.
4. Moving parts: shotgun fore-end z = restZ + s · 0.16 (slides back toward the shooter at the peak). Sniper bolt handle z = restZ + s · 0.2 and its roll (z rotation) = −s · 1.1 (lifts up and back).
5. Whole-model offsets: rotation x += s · 0.12, z += s · 0.15; position y −= s · 0.02.
6. Rack event, once when t > 0.45 (shotgun at 0.3225 s, sniper at 0.5025 s after the shot): play the "pump" cue, eject one casing (section 15; the shotgun's casing is spawned here), recoil rotation spring kick (−1.5, 0, 1).
7. When pumpTimer ≤ 0: pumped flag false, need-pump flag false, fore-end / bolt handle snapped to rest.

## 13. Recoil and camera kick

Model recoil is entirely spring driven (3.3) with kicks from section 8 step 8, section 11.2, section 12 and the katana. The value of the position spring is scaled by (0.3 + 0.7·ia) on x and y (full on z); the rotation spring by 1 on x, (0.4 + 0.6·ia) on y, (0.3 + 0.7·ia) on z — so aiming reduces visual recoil but never removes it.

Camera recoil is applied by the player (22.2): given (p, y) from section 8 step 9, the player's pitch is permanently raised by p · 0.55 (clamped to ±1.5 rad), a 1-D pitch spring (k 190, d 17) is kicked by p · 22 and a yaw spring (k 190, d 17) by y · 30; the springs settle back, the 0.55·p part stays (the player must pull down to compensate). FOV kick: a 1-D spring (k 220, d 14) kicked by fovKick · 30 is added to the camera FOV.

There is no fixed recoil pattern; all randomness is uniform as listed.

## 14. Aim-down-sights

- Aiming is available only for guns; the katana's aim input means "guard" (section 18.7).
- The player reports the aim flag; the view model blends aimAmt toward 1 at rate 14 (≈ 90 % in 0.16 s) and back at the same rate.
- Camera FOV while aiming = the gun's ADS FOV (58 / 68 / 20 / 52), approached at rate 16 when aiming and rate 8 when releasing; the normal FOV is 82 plus movement bonuses (owned by the player).
- Look sensitivity while aiming (player-owned): × 0.38 for the scoped sniper, × 0.62 for other guns.
- Spread uses the ADS base while aiming (section 6); camera pitch kick is × 0.7 while aiming.
- HUD: ADS crosshair style when aimAmt > 0.55; scope overlay when the gun is scoped and aimAmt > 0.62; sniper model hidden at aimAmt ≥ 0.8.
- Sway and bob shrink while aiming per the (0.3 + 0.7·ia) and (0.15 + 0.85·ia) factors; the rest rotation is scaled by ia so a gun levels out when aimed.

## 15. Shell casings

Ejection (with lateral factor `spread`, default 1): from the gun's eject point (world position), velocity = playerRight · rand(1.5, 2.5) · spread + playerForward · rand(−0.5, 0.5), plus vertical rand(1.5, 2.8). Spawned through the effects system's casing particle with the gun's casing colour and size (rifle 0.02 orange; shotgun 0.035 red; sniper 0.03 orange). The effects system gives casings gravity 22, life 0.9–1.4 s, drag 0.5.

## 16. Muzzle flash, smoke, tracers, impacts

- **Muzzle flash mesh** (part of the view model, at the muzzle point): three flat stars sharing one centre — a 7-point star (outer radius 0.16, inner 0.06) in the model's xy-plane, a 5-point star (0.11 / 0.04) rotated 90° about y, a 5-point star (0.10 / 0.04) rotated 90° about x. Hidden by default; on each shot shown for 0.045 s with random roll and scale flashScale · rand(0.8, 1.4).
- **Muzzle burst**: stroke particles at the muzzle, count 4 + pellets, speed 6 · flashScale, life 0.08 s, size 0.03, no gravity, drag 8, orange.
- **Muzzle smoke**: 2 puffs (5 for the shotgun, 1 for automatics) drifting along the player's forward.
- **Tracer**: one per pellet from muzzle to ray end, thickness per gun, life 0.05 s, blue.
- **Impact** on non-breakable world: bullet-impact effect at (point, normal) in blue (the effects system makes a small hole decal 0.06–0.1 and 5 sparks) plus a 25 % chance of a positional ricochet cue.
- The katana slash trail is described in 18.4.

## 17. Gun view-model geometry

### 17.1 Primitive helpers

All positions are (x, y, z) in unscaled model units in the root's frame; the root is scaled 0.46. Materials are tagged **primary**, **dark**, or **accent** (colours in section 23).

- **box(w, h, d) at (x, y, z)**: axis-aligned box of width w (x), height h (y), depth d (z), centred at the point, optionally with an Euler rotation.
- **cylinder(r, L) at (x, y, z)**: a cylinder of radius r and length L lying along the z axis (8 sides unless noted). "along x" means the axis is x instead.
- **sphere(r) at (x, y, z)**: 8 segments unless noted.
- **frame(w, h, t, d) at (x, y, z)**: a rectangular ring in the xy-plane made of four boxes: top and bottom bars (w × t × d) at y = ±h/2, and side bars (t × h × d) at x = ±w/2.
- **hand at (x, y, z) toward direction v, length L = 0.42**: a fist sphere r 0.062 at the point, plus a forearm: a tapered cylinder (radius 0.04 at the fist end, 0.05 at the far end, length L, 7 sides) whose axis is the normalised v and whose centre is point + v̂ · L/2. Directions with positive z point back toward the shoulder.
- **Muzzle point**, **eject point**: invisible anchors whose world positions are used for tracers/flash/burst and casings.
- **Flash**: the star cluster of section 16 placed at the muzzle point, initial scale 1.

Each gun also declares which mesh is its magazine (mag reload animation), fore-end (shotgun pump), bolt handle (sniper cycle), cylinder group (revolver reload) and left hand (shotgun reload). The left hand rest position is remembered so it can be restored.

### 17.2 Rifle

| Part | Shape | Position / notes | Material |
|---|---|---|---|
| Receiver | box 0.09 × 0.12 × 0.50 | (0, 0, 0) | primary |
| Handguard | box 0.075 × 0.085 × 0.36 | (0, 0, −0.42) | primary |
| Barrel | cylinder r 0.018, L 0.42 | (0, 0.02, −0.75) | dark |
| Magazine (animated) | box 0.06 × 0.20 × 0.10 | (0, −0.16, −0.06), pitched 0.15; rest y = −0.16 | primary |
| Stock | box 0.07 × 0.11 × 0.30 | (0, −0.01, 0.40) | primary |
| Grip | box 0.05 × 0.14 × 0.06 | (0, −0.13, 0.12), pitched 0.3 | primary |
| Sight ring | frame 0.075 × 0.07, bar 0.012, depth 0.03 | (0, 0.12, −0.05) | primary |
| Sight base | box 0.03 × 0.018 × 0.05 | (0, 0.062, −0.05) | dark |
| Reticle ring | torus radius 0.0075, tube 0.0018 (5 × 14 segments) | (0, 0.12, −0.05) | accent |
| Reticle dot | sphere r 0.0015 (5 seg) | (0, 0.12, −0.05) | accent |
| Right hand | hand | (0.02, −0.15, 0.13) toward (0.5, −0.6, 1) | primary |
| Left hand | hand | (−0.05, −0.08, −0.40) toward (−0.35, −0.9, 0.9) | primary |
| Muzzle point | anchor | (0, 0.02, −0.98) | — |
| Eject point | anchor | (0.06, 0.02, 0.02) | — |
| Flash | star cluster | at the muzzle point | accent-orange |

No front post: when aimed the player sees only the ring and the floating dot on the camera axis.

### 17.3 Shotgun

Rest position (0.20, −0.19, −0.34).

| Part | Shape | Position / notes | Material |
|---|---|---|---|
| Receiver | box 0.09 × 0.13 × 0.42 | (0, 0, 0.05) | primary |
| Barrel | cylinder r 0.021, L 0.92 | (0, 0.05, −0.62) | dark |
| Tube magazine | cylinder r 0.019, L 0.72 | (0, −0.02, −0.50) | primary |
| Fore-end (animated) | box 0.078 × 0.085 × 0.27 | (0, 0.01, −0.46); rest z = −0.46 | primary |
| Stock | box 0.07 × 0.12 × 0.34 | (0, −0.04, 0.42), pitched 0.08 | primary |
| Grip | box 0.05 × 0.13 × 0.06 | (0, −0.13, 0.16), pitched 0.35 | primary |
| Front bead | sphere r 0.013 (6 seg) | (0, 0.095, −1.00) | accent |
| Rear sight | box 0.03 × 0.025 × 0.02 | (0, 0.085, −0.02) | dark |
| Right hand | hand | (0.02, −0.16, 0.17) toward (0.5, −0.6, 1) | primary |
| Left hand (animated in reload) | hand | (−0.04, −0.06, −0.45) toward (−0.35, −0.9, 0.9) | primary |
| Muzzle point | anchor | (0, 0.05, −1.09) | — |
| Eject point | anchor | (0.06, 0.03, 0.05) | — |
| Flash | star cluster | at the muzzle point | accent-orange |

### 17.4 Sniper

Rest position (0.21, −0.19, −0.36).

| Part | Shape | Position / notes | Material |
|---|---|---|---|
| Receiver | box 0.085 × 0.115 × 0.60 | (0, 0, 0.05) | primary |
| Barrel | cylinder r 0.024, L 1.25 | (0, 0.02, −0.92) | dark |
| Muzzle brake | cylinder r 0.032, L 0.16 | (0, 0.02, −1.50) | dark |
| Magazine (animated) | box 0.055 × 0.16 × 0.14 | (0, −0.14, −0.06); rest y = −0.14 | primary |
| Stock | box 0.075 × 0.13 × 0.44 | (0, −0.02, 0.50), pitched 0.04 | primary |
| Grip | box 0.05 × 0.14 × 0.07 | (0, −0.13, 0.20), pitched 0.3 | primary |
| Cheek riser | box 0.06 × 0.05 × 0.16 | (0, 0.07, 0.42) | primary |
| Scope tube | cylinder r 0.052, L 0.56 | (0, 0.135, −0.10) | primary |
| Objective bell | cylinder r 0.066, L 0.07 | (0, 0.135, −0.36) | primary |
| Ocular bell | cylinder r 0.062, L 0.07 | (0, 0.135, 0.14) | primary |
| Scope mounts (×2) | box 0.03 × 0.09 × 0.035 | (0, 0.085, −0.24) and (0, 0.085, 0.02) | dark |
| Crosshair (horizontal) | box 0.09 × 0.006 × 0.004 | in a group at (0, 0.135, −0.38) | accent |
| Crosshair (vertical) | box 0.006 × 0.09 × 0.004 | same group | accent |
| Bolt handle (animated) | box 0.026 × 0.026 × 0.16 | (0.07, 0.05, 0.16); rest z = 0.16 | dark |
| Bolt knob | sphere r 0.032 (6 seg) | (0.07, 0.05, 0.24) | dark |
| Bipod leg left | box 0.02 × 0.26 × 0.02 | (−0.07, −0.13, −0.78), rolled +0.35 | dark |
| Bipod leg right | box 0.02 × 0.26 × 0.02 | (0.07, −0.13, −0.78), rolled −0.35 | dark |
| Right hand | hand | (0.02, −0.16, 0.24) toward (0.5, −0.6, 1) | primary |
| Left hand | hand | (−0.05, −0.09, −0.50) toward (−0.35, −0.9, 0.9) | primary |
| Muzzle point | anchor | (0, 0.02, −1.60) | — |
| Eject point | anchor | (0.06, 0.04, 0.06) | — |
| Flash | star cluster | at the muzzle point | accent-orange |

The scope crosshair sits on the sight point so that the ADS view lines up with it; the whole model is hidden once nearly fully aimed (3.6) and the HUD scope overlay takes over.

### 17.5 Revolver

Rest position (0.19, −0.20, −0.30).

| Part | Shape | Position / notes | Material |
|---|---|---|---|
| Frame | box 0.045 × 0.09 × 0.20 | (0, 0, 0) | primary |
| Barrel | cylinder r 0.02, L 0.30 | (0, 0.035, −0.24) | dark |
| Barrel rib | box 0.03 × 0.03 × 0.26 | (0, 0.005, −0.22) | primary |
| Cylinder group (animated) | group | at (0, 0, −0.02) | — |
| — drum | cylinder r 0.05, L 0.11, 6 sides | group origin | primary |
| — chambers (×6) | cylinder r 0.012, L 0.115, 5 sides | (cos a · 0.032, sin a · 0.032, 0) for a = i/6 · 2π, i = 0..5 | dark |
| Grip | box 0.045 × 0.14 × 0.055 | (0, −0.10, 0.07), pitched 0.4 | dark |
| Hammer | box 0.02 × 0.045 × 0.035 | (0, 0.05, 0.10), pitched −0.4 | primary |
| Front sight | box 0.01 × 0.03 × 0.02 | (0, 0.075, −0.34) | accent |
| Rear sight blades (×2) | box 0.012 × 0.025 × 0.015 | (−0.014, 0.06, 0.08) and (0.014, 0.06, 0.08) | primary |
| Right hand | hand | (0, −0.13, 0.08) toward (0.45, −0.55, 1) | primary |
| Left hand | hand | (−0.05, −0.17, 0.02) toward (−0.4, −0.7, 1) | primary |
| Muzzle point | anchor | (0, 0.035, −0.40) | — |
| Eject point | anchor | (−0.05, 0.02, 0) | — |
| Flash | star cluster | at the muzzle point | accent-orange |

## 18. Katana

### 18.1 Stats and state

| Stat | Value |
|---|---|
| HUD name / hint | KATANA / "slash · hold aim to block & return bullets" |
| Kind identifier | katana |
| Damage vs enemies | 75 per hit |
| Damage vs remote players | 55 per hit |
| Slash duration | 0.27 s |
| Cooldown after a slash starts | 0.33 s (= 0.27 + 0.06) |
| Hit moment | when swing progress t > 0.32 (0.0864 s after the swing starts), once per swing |
| Combo window | 0.9 s after each swing; the combo counter resets to 0 when it expires |
| Enemy arc | range 3.0, half-angle 0.95 rad (cos ≈ 0.5817, ≈ 54.4°) |
| Player arc (versus) | range 3.0, half-angle 0.95 rad, plus line-of-sight |
| Rope cut reach | 3.4 |
| Breakable arc | range 3.2, half-angle 1.0 rad (cos ≈ 0.5403) |
| Lunge | +3.5 velocity along forward when the swing starts while sprinting or airborne; otherwise a flat +1.6 step (no hop, no cue) so a grounded stab reaches a rusher that strikes from 3 m |
| FOV kick on swing | 2 |
| Rest position / rotation | (0.27, −0.25, −0.40) / (0.75, 0.15, −0.35) |
| Aim position | same as rest position |
| Guard position / rotation | (0.21, −0.31, −0.36) / (1.40, 0.30, 1.24) |
| Crosshair spread pixels | 4 (constant) |
| Ammo | infinite (HUD shows ∞) |

Runtime state: slash timer (counts down from 0.27), combo counter, combo timer, blocking flag, block-held time, block amount (0..1 blend), hit-done flag, cooldown timer, parry swing (0..1), parry direction (±1, starts +1), blood level (0..1), deflect kick (decays at 6 per second; kept but has no visible effect).

Swing side: s = +1 when the combo counter is odd, −1 when even. Consecutive swings alternate sides.

### 18.2 Geometry

| Part | Shape | Position / notes | Material |
|---|---|---|---|
| Blade | box 0.012 × 0.035 × 1.00 | (0, 0, −0.55) | primary |
| Tip | box 0.012 × 0.02 × 0.08 | (0, 0.007, −1.07), pitched 0.3 | primary |
| Guard (tsuba) | box 0.10 × 0.10 × 0.02 | (0, 0, −0.05) | dark |
| Handle core | box 0.03 × 0.036 × 0.30 | (0, 0, 0.12) | dark |
| Handle wraps (×6) | box 0.036 × 0.04 × 0.02 | (0, 0, 0.02 + i · 0.045), i = 0..5 | primary |
| Front hand | hand | (0, −0.005, 0.05) toward (0.5, −0.5, 1) | primary |
| Rear hand | hand | (0, −0.005, 0.20) toward (−0.4, −0.7, 1) | primary |
| Tip anchor | anchor | (0, 0, −1.05) | — |
| Blood smears (×6) | flat ragged shapes on the blade faces | see 18.9 | accent (filled, double-sided) |

Blood smear geometry: blade half-height BH = 0.0168, face offset BX = 0.0067. Six smears defined by (centre z, length, threshold, side): (−0.34, 0.30, 0.00, +1), (−0.70, 0.26, 0.18, −1), (−0.95, 0.17, 0.40, +1), (−0.52, 0.22, 0.58, −1), (−0.20, 0.20, 0.74, +1), (−0.84, 0.20, 0.88, −1). Each is a closed 2-D polygon built with u along the blade from −len/2 to +len/2 and v vertical: the bottom edge is flat at v = −0.92·BH; the top edge is sampled at 13 points k = 0..12 with t = k/12, u = −len/2 + len·t, taper = sin(π · min(1, 1.15·t)), and v = −0.92·BH + 1.84·BH · ( 0.30 + 0.70 · taper · ( 0.55 + 0.45 · | sin(7t + 2.1·i) | ) ) where i is the smear index. The polygon is rotated so u maps to the blade's z axis and v to y, and placed at (side · BX, 0, centre z) — flush with one face of the blade and always inside its silhouette. All start hidden.

### 18.3 Input and state machine

Each frame (after the shared pose blend):

1. cooldown −= dt; comboTimer −= dt; if comboTimer ≤ 0 → combo = 0. deflectKick = max(0, deflectKick − 6·dt). parrySwing = max(0, parrySwing − 4.5·dt).
2. Blood update (18.9).
3. Guard intent: wantBlock = aim held AND fire not held AND slash timer ≤ 0 AND cooldown ≤ 0. If wantBlock and not previously blocking → blockHeldTime = 0. blocking = wantBlock; if blocking, blockHeldTime += dt. blockAmt = damp(blockAmt, blocking ? 1 : 0, 16, dt).
4. If blockAmt > 0.001: blend the already-composed pose toward the guard pose (18.7).
5. If parrySwing > 0: add the parry flick (18.8).
6. If slash timer > 0: advance the slash (18.5). Else, if ( fire pressed this frame, OR fire held while combo > 0 ) AND cooldown ≤ 0 AND fire not blocked → start a slash (18.4).
7. If melee pressed this frame AND slash timer ≤ 0 AND cooldown ≤ 0 → start a slash (no dead-player check here).

Holding fire therefore chains swings automatically every 0.33 s once the first swing has started, alternating sides, for as long as the button is held.

### 18.4 Starting a slash

1. slashTimer = 0.27; hitDone = false; combo += 1; comboTimer = 0.9; cooldown = 0.33.
2. Play the "katanaSwing" cue; camera FOV kick 2.
3. If the player is sprinting or not grounded: lunge(3.5); otherwise `player.step(1.6)` adds 1.6 units/s along the flat forward with no hop, cue or FOV kick. Lunge(5.5) is the pre-rehaul value; lunge(v) — the player adds 5.5 units/s along its forward (forward y clamped to −0.2..0.5 before normalising); if grounded, vertical velocity becomes at least 2.5 and the player leaves the ground; the "dash" cue plays and an extra FOV kick 3 is applied (player-owned behaviour).
4. Slash trail: 9 short tracer segments describing an arc 1.3 units in front of the eye. With s the swing side, for i = 0..8: a = (−1.1 + 2.2 · i/8) · s and b = a + 0.12 · s; the arc point for angle θ is eye + forward·1.3 + right·(cos θ · 0.9 · s) + up·(sin θ · 0.55 − 0.1); draw a tracer from point(a) to point(b), thickness 0.03 − 0.002·i, life 0.12 + 0.01·i, blue.

### 18.5 Slash animation

t = 1 − slashTimer / 0.27 (0 → 1), e = easeInOut(t), s = swing side. Offsets added to the composed pose:

- rotation z += s · (1.3 − 2.7·e); x += 0.7 − 1.5·e; y += s · (−0.35 + 0.8·e)
- position x += s · (0.2 − 0.45·e); y += 0.14 − 0.24·e; z −= 0.12 · sin(t·π)

When t > 0.32 and the hit has not been done: mark it done and run the hit test (18.6).

### 18.6 Slash hit test and damage

Hit direction used for blood/knockback: d = normalize( forward + (−forward.z, 0, forward.x) · 0.7 · s + (0, −0.35, 0) ) — forward, pushed sideways in the swing direction and downward.

1. Enemies in arc (eye, forward, range 3.0, cos 0.95): for each, damage 75 with info { point = enemy centre with y + rand(−0.2, 0.4), dir = d, part "torso", source "katana", crit false, slashDir = s }. The arc query (enemy-owned) uses distance = |centre − eye| minus 1.2 for bosses, accepts distance ≤ range + 0.3, and requires the direction dot ≥ cos(0.95) unless distance ≤ 0.3; results are nearest-first.
2. Remote players in arc (same range and cone, with line of sight): 55 damage each via the hit-player hook with info { point = their centre, dir = d, part "torso", source "katana", crit false }.
3. Rope cut hook (eye, forward, 3.4): may cut a remote player's grapple rope.
4. Breakables in arc (eye, forward, 3.2, cos 1.0): break hook with (breakable, 75, its position, d).
5. If anything was hit by steps 1–4: play "katanaHit", hit-stop 0.07 s at scale 0.12, screen shake += 0.12, rumble (0.7, 0.4, 90 ms), recoil position spring kick (0, 0, 1.5).

A swing never deflects bullets; only the raised guard does.

### 18.7 Guard (block) pose

While blockAmt > 0.001, with b = blockAmt: position = lerp(currentPosition, guardPosition, b); each rotation component = lerp(current, guardRotation, b). This blends the *whole* pose (after sway, bob, recoil, and the rest rotation which has already been scaled by ia because the aim input is held) toward an absolute target rather than adding an offset. The blade ends up upright, close to the face.

Gameplay meaning of the guard is owned by the player module but depends on weapon state: the player is "blocking" when the katana is equipped and its blocking flag is true; block radius 0.95 while blocking and the player's block cooldown (0.19 s after each deflect) has expired; a deflect is "perfect" when blockHeldTime < 0.26 s; the melee-parry window is open while blocking and the player's own block-held counter < 0.55 s. Blocked projectiles are returned on a perfect block or with 35 % chance otherwise. Bullets fired by remote players at a blocking player can strike its "blade" sphere (section 9) and are deflected, with 40 % chance of being returned at 60 % damage to the shooter.

### 18.8 Parry flick and deflect feedback

onDeflect(perfect): parrySwing = 1; parryDirection flips sign; recoil rotation spring kick ( perfect ? −3.5 : −2, parryDirection · 2, parryDirection · 2.5 ); recoil position spring kick ( parryDirection · 0.15, 0.15, 1.2 ).

Flick animation while parrySwing > 0: f = sin( min(1, parrySwing) · π ); rotation z += parryDirection · f · 0.42; y += parryDirection · f · 0.16; position x += parryDirection · f · 0.035. parrySwing decays at 4.5 per second (≈ 0.22 s).

### 18.9 Blade blood (tone) accumulation

- bloodLevel decays by 0.05 per second, floor 0.
- addBlood(amount): bloodLevel = clamp(bloodLevel + amount, 0, 1). The game adds 0.42 per katana or focus-execution kill (22.10). Three quick kills saturate the blade; a full blade clears in 20 s.
- Each frame, smear i is visible when bloodLevel > its threshold. When visible: f = clamp( (bloodLevel − threshold) / 0.28, 0.2, 1 ); scale = (1, 0.35 + 0.65·f, 0.4 + 0.6·f) — it fills out in height and grows along the blade as the level rises, never past the steel.

### 18.10 Quick-melee from a gun

Player-owned but weapon-facing: pressing melee while a gun is equipped switches to the katana, starts a slash immediately with the current state record, and arms a 0.85 s return timer. While the timer runs, pressing fire, aim or melee on the katana cancels the return; otherwise when it expires the player switches back to the previously equipped gun. The previous-weapon index is updated on every switch away from a non-katana weapon.

## 19. Weapon switching

- Slot keys 1–5 select min(key − 1, 3); next/previous cycle with wrap-around. Selecting the already-equipped slot is ignored.
- Switch: hide the old weapon, show the new with a fresh raise (3.5), play the "switchWeapon" cue (except on silent switches such as reset), update the HUD weapon name and hint, and set the crosshair mode to "katana" for the katana and the default otherwise.
- No holster time. A **draw lockout** of 0.85 × drawTime (3.4) applies before the drawn gun can fire; reload input is not blocked. Fire, pump and slash timers of the holstered weapon are frozen.
- Holstering **cancels** a reload in progress: reloading = false, reload time = 0, and the magazine / cylinder / left-hand parts snap back to rest. No ammo moves (ammo only transfers at completion), so nothing is lost; the reload restarts from zero on the next reload input or, if the magazine is empty, automatically on draw (11.5).
- Edge case: the muzzle flash timer is frozen too, so a flash that was visible at the moment of switching is still visible when that gun is re-equipped and hides 0–45 ms later.

## 20. Ammo pickups and reset

- addAmmo(n) on a gun: reserve = min(reserve + n, max reserve).
- Ammo pickup: every gun receives round(maxReserve · 0.4): rifle +140, shotgun +29, sniper +20 (revolver would get +29). The general "add ammo to all" call defaults to a 0.5 fraction when no fraction is given.
- Player reset (new game / respawn): cancel each gun's pending auto-reload callback; then mag = magazine size, reserve = its starting reserve, reloading = false, pump timer = 0; the rifle (slot 1) is equipped silently.

## 21. Audio cues

Cues triggered by this subsystem (the audio subsystem defines their sound):

| Cue | When |
|---|---|
| shot | rifle fires |
| shotgunFire | shotgun fires |
| sniperFire | sniper fires |
| revolver | revolver fires |
| empty | fire pressed with an empty magazine |
| reload | magazine reload starts (rifle, sniper) |
| shell | shell reload starts and after each shell that is not the last; revolver cylinder ejection event |
| cylinder | cylinder reload starts |
| pump | pump/bolt rack event |
| ricochet (positional) | 25 % of world impacts |
| katanaSwing | slash starts |
| katanaHit | slash hits anything |
| switchWeapon | weapon switch (player-owned) |
| dash | katana lunge (player-owned) |

Hit confirmation sounds (hitEnemy, headshot, shieldHit) and parry sounds are played by the enemy, game and player modules, not by the weapon.

## 22. Interfaces with other subsystems

### 22.1 Player → weapon: the per-frame input/state record

The player builds this record every frame and passes it to the equipped weapon's animate call together with the frame time. During the dead-player update or a scripted dash, use a neutral record: fire, firePressed, aim, reloadPressed, meleePressed, and sprinting are false; speed is 0; blockFire is true only when the player is dead. No actionable input reaches the weapon in these states. Non-playing menu states do not animate the weapon. The focus system can still call startSlash directly with a neutral record.

| Field | Type | Meaning |
|---|---|---|
| fire | bool | fire button held |
| firePressed | bool | fire button went down this frame |
| aim | bool | for guns: aim held and a gun is equipped; for the katana: aim held |
| reloadPressed | bool | reload went down this frame |
| meleePressed | bool | melee went down this frame, only when the katana is equipped (otherwise the player consumes it for quick-melee) |
| sprinting | bool | player is sprinting |
| grounded | bool | player body is on the ground |
| speed | number | horizontal speed (units/s) |
| sliding | bool | player is sliding |
| lookDelta | {x, y} | this frame's look rotation delta (radians), y already sign-adjusted for invert |
| strafe | number | −1..1 sideways move axis |
| bobPhase | number | walking bob phase (radians, advances at 7 + speed·0.5 per second while moving) |
| bobAmt | number | 0..1.4 bob intensity |
| landDip | number | clamp(−landingSpringValue · 0.08, −0.5, 0.5) |
| slideTilt | number | 1 while sliding else 0 |
| blockFire | bool | true when the player is dead (prevents firing / slashing via fire) |

### 22.2 Weapon → player

- eye position, forward vector, right vector (unit, world space) — read for rays, arcs, casings, trails.
- aimDir(spread) → direction per section 6.
- recoil(pitch, yaw) and kickFov(amount) per section 13.
- lunge(speed) per 18.4.
- The player reads from the weapon: kind, isGun, scope flag, aimAmt, adsFov, blocking, blockHeldTime, name, hint, and kicks the weapon's recoil springs itself: on grenade throw (−0.4, 0.5, 1.2) position and (−3, 0, −1.5) rotation; on grapple fire (−0.3, 0.2, 0.5) position.
- The player's per-frame "firing" flag = fire held AND a gun is equipped (sent over the network).

### 22.3 Weapon → enemies

- raycast(origin, dir, 300) → nearest { enemy, part, dist, point } or none. Enemy parts are named head, torso, hips, armL/R, foreL/R, legL/R, shinL/R, and shield (front-most sphere on shielded enemies); simple enemies expose only torso.
- inArc(pos, dir, range, cosHalf) → list of { enemy, dist } nearest-first (rules in 18.6).
- damage(enemy, amount, info) with info { point, dir, part, source (gun kind or "katana"), crit, optional slashDir }. The enemy system applies its own rules: shield parts take no bullet damage (katana lowers shield HP by 1), crit plays a headshot cue, kills trigger hit-stop, etc.

### 22.4 Weapon → world / physics

- raycast(origin, dir, 300, ignore = see-through predicate) → { dist, point, normal (axis-aligned unit), box } or none. The see-through predicate excludes boxes whose data has the no-shoot flag. Breakable props are boxes whose data carries a breakable reference.

### 22.5 Weapon → remote players (versus) and game callbacks

All optional; the weapon checks for their presence:

- raycastPlayers(origin, dir, 300) → { player, part, dist, point } or none (parts as enemies, plus "blade").
- playersInArc(pos, dir, range, cosHalf) → list of remote players.
- hitPlayer(player, damage, info) — the game applies deflection ("blade"), remote parry (front hit by a katana while the target's parry window is open → this katana's cooldown is raised to at least 0.6 s and no damage), blood, hit marker and network message.
- breakHit(breakable, damage, point, dir); breakablesInArc(pos, dir, range, cosHalf) → list of breakables with a position.
- cutRopes(eye, dir, range) → bool.
- onShot(endPoint) — every ray.
- game.hitstop(duration, timeScale).

### 22.6 Weapon → effects

Calls with exact parameters: tracer(from, to, colour, thickness, life); strokeBurst(pos, colour, count, speed, {life, size, gravity, drag}); smoke(pos, dir, count); shell(pos, velocity, colour, size); bulletImpact(point, normal, colour); and the shared screen-shake accumulator (added to, decays in the player's camera update at rate 7).

### 22.7 Weapon → audio and input (rumble)

Cues per section 21. Rumble(strong 0..1, weak 0..1, milliseconds) is a fire-and-forget gamepad call.

### 22.8 Weapon → HUD (what the weapon exposes each frame)

The game reads these from the equipped weapon every frame and pushes them to the HUD:

| Exposed value | Guns | Katana |
|---|---|---|
| name, hint | per table | KATANA / hint |
| isGun | true | false |
| mag, reserve, magSize, reloading | live values → ammo counter with tally marks and "reloading…" label | HUD shows ∞ |
| slot summary for all four | "mag/reserve", empty flag when mag = 0 and reserve = 0 | "∞" |
| spreadPx | 5 + currentSpread · 900 | 4 |
| aimAmt | ADS crosshair when > 0.55; scope overlay when scoped and > 0.62 | — |
| kind | crosshair mode default | crosshair mode "katana" |

### 22.9 Weapon → network

Every ray end point (rounded to 0.1) is queued via the shot hook; once per network tick the queue is broadcast with the shooter's weapon kind. Receivers draw a tracer per end point from a point near the remote figure's gun (body position + right·0.3 + forward·0.8, y + 1.35 + forward.y·0.8) with thickness by kind (rifle 0.02, shotgun 0.014, sniper 0.03, otherwise 0.02), life 0.06, and play a remote shot cue and a model flash. The 20 Hz state packet carries the weapon index and flags for blocking, aiming, firing and parry window.

### 22.10 Game → katana (blood, forced cooldown, focus mode)

- addBlood(0.42) on every kill whose source is "katana" or "focus".
- cooldown may be raised externally to ≥ 0.6 s when a remote player parries a slash.
- Focus mode (game-owned) calls startSlash with a neutral state record when an execution dash lands or is blocked. That swing runs the normal animation and the normal arc hit test (18.5–18.6); the execution itself applies its own separate damage with source "focus".


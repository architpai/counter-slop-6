# Player and Input Subsystem Specification

> Current combat changes: [Combat rehaul](combat-rehaul.md). It replaces the old katana slot/controls, quick-melee switching and related camera rules below.

This document describes, in full, the behaviour of the first-person player and the input layer of the design. It is a specification: it says WHAT happens, with every constant, formula, state and timing, so that an implementer can build identical gameplay from it alone.

Conventions used throughout:

- Units: metres, seconds, radians. Speeds in m/s, accelerations in m/s².
- World axes: Y is up. At yaw = 0 the player looks along −Z; the player's right-hand direction is +X.
- "Frame time" (dt) is the simulation step passed to the player each frame (see 1.1).
- "damp(current, target, rate, dt)" means exponential smoothing: `current + (target − current) × (1 − e^(−rate × dt))`. The word "damps toward X at rate R" always refers to this formula.
- "U(a, b)" means a uniformly random number between a and b.
- A "spring" is a damped scalar spring with stiffness k and damping d. Each step: `accel = (target − value) × k − velocity × d`, `velocity += accel × h`, `value += velocity × h`. If dt > 0.02 the update is split into 3 equal sub-steps (h = dt / 3), else one step (h = dt). Target is always 0 for every spring in this subsystem. "Kick by v" means `velocity += v`. A "3-D spring" is the same thing applied to a vector, kicked per component.
- clamp(v, lo, hi) clamps v into [lo, hi].

## Table of contents

1. [Frame loop contract](#1-frame-loop-contract)
2. [Input layer](#2-input-layer)
   - 2.1 Actions
   - 2.2 Keyboard bindings
   - 2.3 Mouse bindings
   - 2.4 Gamepad bindings and stick processing
   - 2.5 Key-state semantics (held / pressed / released / consume)
   - 2.6 Movement and look vectors
   - 2.7 Sensitivity settings
   - 2.8 Device switching
   - 2.9 Pointer lock
   - 2.10 Focus loss
   - 2.11 Rumble
   - 2.12 Touch
   - 2.13 Game-level input handling (menus, pause, scoreboard)
3. [Player: constants and state](#3-player-constants-and-state)
4. [Player: per-frame update order](#4-player-per-frame-update-order)
5. [Look and orientation](#5-look-and-orientation)
6. [Movement](#6-movement)
   - 6.1 Wish direction
   - 6.2 Sprint
   - 6.3 Aim-down-sights flag
   - 6.4 Crouch
   - 6.5 Slide
   - 6.6 Ground acceleration and friction
   - 6.7 Air acceleration
   - 6.8 Jump buffer, coyote time, ground jump
   - 6.9 Wall jump
   - 6.10 Double jump
   - 6.11 Air dash
   - 6.12 Gravity, speed cap, integration
   - 6.13 Mantle
   - 6.14 Landing
   - 6.15 Out-of-bounds respawn
   - 6.16 Focus-dash lock (external body control)
7. [Grapple hook](#7-grapple-hook)
8. [Health, damage, regeneration, death](#8-health-damage-regeneration-death)
9. [Katana guard: block and parry](#9-katana-guard-block-and-parry)
10. [Camera](#10-camera)
11. [Grenades](#11-grenades)
12. [Weapon handling by the player](#12-weapon-handling-by-the-player)
13. [Weapons](#13-weapons)
    - 13.1 Shared view-model behaviour
    - 13.2 Gun statistics
    - 13.3 Spread model
    - 13.4 Firing
    - 13.5 Hit resolution and damage
    - 13.6 Reloading
    - 13.7 Pump / bolt cycle
    - 13.8 Katana
14. [Dead-state behaviour and idle camera](#14-dead-state-behaviour-and-idle-camera)
15. [HUD outputs driven by this subsystem](#15-hud-outputs-driven-by-this-subsystem)
16. [Interfaces with other subsystems](#16-interfaces-with-other-subsystems)

---

## 1. Frame loop contract

- The game runs one step per animation frame. Real elapsed time is clamped: `dt = min(0.05, elapsed seconds)`.
- The input layer is updated FIRST every frame with the real (clamped) dt.
- A time scale is then computed: during hit-stop it is the hit-stop scale; during "focus" (katana slow-motion, solo only) it is 0.26; otherwise 1. The player is updated with `scaled dt = dt × scale`.
- The player update runs only while the game state is "play" or "dying". In "start", "dead", "lobby" and "over" states the player is not simulated and the idle camera is used instead (section 14).
- After the player update the HUD is refreshed from player fields (section 15).

## 2. Input layer

The input layer merges keyboard, mouse and a standard-mapping gamepad into one set of named boolean actions plus two 2-D vectors (move, look).

### 2.1 Actions

`forward, back, left, right, jump, sprint, crouch, reload, grapple, melee, slot1, slot2, slot3, slot4, slot5, pause, confirm, grenade, dash, music, talk, score, fire, aim, nextWeapon, prevWeapon`.

### 2.2 Keyboard bindings

Bindings are by physical key code (layout independent).

| Key(s) | Action |
|---|---|
| W, Arrow Up | forward |
| S, Arrow Down | back |
| A, Arrow Left | left |
| D, Arrow Right | right |
| Space | jump |
| Left Shift, Right Shift | sprint |
| Left Ctrl, C | crouch |
| R | reload |
| Q, E | grapple |
| F, V | melee |
| 1, 2, 3, 4, 5 (main row) | slot1 … slot5 |
| Escape, P | pause |
| Enter | confirm |
| G | grenade |
| X, Left Alt | dash |
| M | music |
| T | talk |
| Tab | score |

Key-down handling:
- Auto-repeat key-down events are ignored.
- The mapped action's raw key flag is set true. If the gamepad was the active device, the device-change callback is fired with "keyboard" and the active device becomes keyboard/mouse.
- Independently of which key was pressed: if the event's Shift modifier flag is NOT set, the raw sprint flag is forced false (guards against a stuck Shift).
- Default browser behaviour is suppressed for Space, Tab, Arrow Up and Arrow Down.
- The "any input seen" flag is set (used by the audio subsystem to resume the audio context).

Key-up handling: the mapped action's raw flag is cleared; the same Shift guard is applied.

### 2.3 Mouse bindings

| Button index | Action |
|---|---|
| 0 (left) | fire |
| 2 (right) | aim |
| 1 (middle) | grapple |
| 3 (back) | grapple |
| 4 (forward) | melee |

- Mouse-down: sets the raw mouse flag; switches active device to keyboard/mouse (firing the device-change callback if it changed); sets "any input seen"; suppresses default behaviour for buttons 1, 3 and 4.
- Mouse-up: clears the raw flag.
- The context menu is always suppressed.
- Wheel: each wheel event adds `sign(deltaY)` to a wheel accumulator (passive listener). Accumulator > 0 at frame time becomes a one-frame `nextWeapon`, < 0 becomes `prevWeapon`; the accumulator is then reset to 0.
- Mouse move: processed ONLY while the pointer is locked. Per-event movement deltas (px) are accumulated. Spike guard: if a single event's |Δx| > 400 px that axis delta is treated as 0 for that event; likewise for Δy. Mouse movement marks the active device as keyboard/mouse but does NOT fire the device-change callback.

### 2.4 Gamepad bindings and stick processing

Standard gamepad mapping (DualSense names given for reference):

| Button index | Name | Action |
|---|---|---|
| 0 | Cross | jump |
| 1 | Circle | crouch |
| 2 | Square | reload |
| 3 | Triangle | nextWeapon |
| 4 | L1 | grapple |
| 5 | R1 | melee |
| 6 | L2 | aim |
| 7 | R2 | fire |
| 8 | Create | score |
| 9 | Options | pause |
| 10 | L3 | sprint |
| 11 | R3 | grenade |
| 12 | D-pad up | grenade |
| 13 | D-pad down | slot5 |
| 14 | D-pad left | prevWeapon |
| 15 | D-pad right | nextWeapon |
| 17 | Touchpad click | confirm |

- A button counts as pressed if its "pressed" flag is set OR its analogue value > 0.35.
- Pad selection: when a pad connects, its index is remembered. Each frame, use the remembered pad if present, otherwise the first connected pad found (and remember it). No pad → no gamepad input this frame.
- Dead zone (applied per axis): `dz(v) = 0 if |v| < 0.14, else (v − sign(v) × 0.14) / 0.86`.
- Left stick (axes 0, 1): if either processed axis is non-zero, it REPLACES the keyboard move vector: `move.x = dz(axis0)`, `move.y = −dz(axis1)`.
- Right stick (axes 2, 3): if either processed axis is non-zero:
  - `mag = hypot(rx, ry)`. If mag > 0.94 the "full-deflection hold time" accumulates by dt, else it resets to 0. If the stick is centred the hold time also resets to 0.
  - Turn acceleration: `accel = 1 + clamp((holdTime − 0.25) / 0.6, 0, 1) × 0.9` (ramps from ×1 to ×1.9 between 0.25 s and 0.85 s of full deflection).
  - Response curve: `curve(v) = sign(v) × |v|^1.8`.
  - Look contribution (radians this frame): `look.x += −curve(rx) × padSensX × accel × dt`, `look.y += −curve(ry) × padSensY × accel × dt` (before the invert-Y step of 2.6).
- Any non-zero stick or pressed button marks the pad as active this frame: if the active device was not the gamepad, the device-change callback fires with "gamepad"; the active device becomes the gamepad; "any input seen" is set.
- A separate gamepad-only button state (this frame and previous frame) is kept for edge detection (2.5).

### 2.5 Key-state semantics (held / pressed / released / consume)

Each frame the input layer rebuilds a merged action state:
1. previous-state := current merged state of last frame; current := empty.
2. Every raw keyboard flag that is true sets its action true.
3. Every raw mouse-button flag that is true sets its action true.
4. Wheel accumulator sets nextWeapon/prevWeapon (2.3) and resets.
5. Every pressed gamepad button sets its action true (merged state) and also records it in the gamepad-only state; the gamepad-only previous state is rotated the same way.

Queries:
- **held(action)**: merged state is true this frame.
- **pressed(action)**: (merged true this frame AND merged false last frame) OR (gamepad-only true this frame AND gamepad-only false last frame). The second clause makes a gamepad press register as an edge even when the same action is already held on the keyboard.
- **released(action)**: merged false this frame AND merged true last frame.
- **consume(action)**: forces the merged state for the action false for the rest of this frame. Side effect: because next frame's previous-state is a copy of this frame's (consumed) state, a still-held action will read as "pressed" again next frame and "released" will not fire for it. Used by the game to eat the fire press that starts a focus dash.
- **anyPressed()**: true if any merged action is true this frame and false last frame.

### 2.6 Movement and look vectors

Computed once per frame after state rotation:
- Keyboard move: `x = (right ? 1 : 0) − (left ? 1 : 0)`, `y = (forward ? 1 : 0) − (back ? 1 : 0)`. Overridden by the left stick when it is deflected (2.4).
- The move vector is normalised only if its length > 1 (diagonal keyboard = length 1; stick magnitudes below 1 are kept).
- Mouse look: `look.x = −accumulatedΔx × mouseSens`, `look.y = −accumulatedΔy × mouseSens`, then the accumulators reset. Positive look.x turns LEFT (yaw increases); positive look.y looks UP. Gamepad contribution is added (2.4).
- If invert-Y is on, `look.y` is negated after all sources are summed.
- The look vector is a per-frame angular delta in radians, consumed by the player (section 5) and also given to the weapon view model as "look delta" for sway.

### 2.7 Sensitivity settings

- Defaults: mouse 0.0022 rad per pixel; pad X 3.4 rad/s; pad Y 2.6 rad/s (at full deflection, before curve and acceleration).
- A user "sensitivity" percentage (default 100) scales all three linearly: `mouseSens = 0.0022 × pct / 100`, `padSensX = 3.4 × pct / 100`, `padSensY = 2.6 × pct / 100`. An invert-Y boolean (default off) is also user-settable. Both persist in local storage under keys "cs6_sens" and "cs6_invert" ("1" = inverted).

### 2.8 Device switching

- The "using gamepad" flag flips to true on any pad activity and to false on any key-down, mouse-down or (silently) mouse-move.
- The device-change callback fires only on key-down, mouse-down and pad activity, and only when the flag actually changes. The game uses it to switch HUD button labels (keyboard set vs. gamepad set) and to re-display the current weapon name and hint.
- Gameplay differences when the gamepad is active: sprint is a toggle (6.2); pointer lock is not requested; the scoreboard key toggles instead of holding (2.13).

### 2.9 Pointer lock

- The lock target is the game canvas. The locked flag is true only when the document's lock element is that canvas. Every lock-change event fires a callback with the new locked state.
- **Request lock**: sets "lock wanted" true. If already locked, nothing else. Otherwise attempts a lock with raw (unadjusted) movement; if that fails, attempts a plain lock; if that also fails, schedules a retry 1200 ms later, which re-requests only if lock is still wanted and not yet held. (Browsers refuse a new lock for roughly a second after Escape released the last one; the retry covers that.)
- **Exit lock**: sets "lock wanted" false, cancels any pending retry, and exits pointer lock if any element holds it.
- Game-level behaviour:
  - When gameplay begins or resumes, lock is requested unless the gamepad is the active device.
  - Clicking the canvas while playing, not in a menu, not locked and not on gamepad requests the lock.
  - Losing the lock while playing (state "play", no menu open, keyboard/mouse device) pauses the game.
  - Pausing via the pause action, dying (solo, after the 1.7 s dying delay), match end and returning to the main menu all exit the lock.
  - While playing on keyboard/mouse without lock, a tip "click to grab the mouse" is shown every 2.5 s (first after 0.5 s), for 2 s.
  - Online: 250 ms after joining play, if not locked and not on gamepad, a "click anywhere (or press confirm) to play" menu overlay is shown.

### 2.10 Focus loss

When the page becomes hidden, or the window loses focus, ALL raw keyboard flags and ALL raw mouse-button flags are cleared (so nothing stays held).

### 2.11 Rumble

`rumble(strong, weak, milliseconds)` (defaults 0.5, 0.5, 80): plays a dual-rumble effect on the most recently polled gamepad's vibration actuator with the two magnitudes clamped to [0, 1]. No-op without a pad or actuator; errors are swallowed. Every call site and its values are listed where they occur in this document.

### 2.12 Touch

There is no touch input. Touch devices are not supported.

### 2.13 Game-level input handling (menus, pause, scoreboard)

Handled by the game shell every frame after the input update:
- In "start", "pause" or "dead" state: `pressed(jump)` or `pressed(confirm)` (or `pressed(pause)` while paused) acts as a click on the current menu screen.
- In "play" state: `pressed(pause)` resumes if a menu overlay is open, else pauses and exits pointer lock. If a menu overlay is open, `pressed(jump)` or `pressed(confirm)` resumes.
- `pressed(music)` toggles music (persisted; tip "music on"/"music off" for 1.5 s).
- Online only: on gamepad, `pressed(score)` toggles the scoreboard; on keyboard the scoreboard shows while `held(score)`. It never shows while a menu overlay is open.
- Pause (solo) sets state "pause"; online, pause only opens the overlay and the match keeps running.

## 3. Player: constants and state

### 3.1 Movement constants

| Constant | Value | Meaning |
|---|---|---|
| Gravity | 26 m/s² | downward acceleration |
| Walk speed | 6.6 | max ground speed, normal |
| Sprint speed | 10.6 | max ground speed, sprinting |
| Crouch speed | 3.6 | max ground speed, crouched (not sliding) |
| Ground acceleration | 140 m/s² | rate of approach to max speed on ground |
| Friction | 8 /s | ground speed decay factor |
| Air acceleration | 36 m/s² | rate of approach to air cap |
| Air cap | 7.5 | max speed the air control will accelerate TOWARD along wish direction |
| Jump velocity | 9.6 m/s | vertical speed given by a ground jump |
| Standing height | 1.75 | collision box height |
| Crouch height | 1.05 | collision box height crouched |
| Eye height standing | 1.6 | camera height above feet |
| Eye height crouched | 0.88 | |
| Body half-width | 0.35 | collision box half extent in X and Z |
| Step height | 0.55 | max ledge the body can step up |
| Coyote time | 0.13 s | jump allowed this long after leaving ground |
| Jump buffer | 0.15 s | a jump press is remembered this long |
| Terminal speed cap | 48 m/s | total velocity magnitude cap |

### 3.2 Grapple stamina ("breath") constants

| Constant | Value |
|---|---|
| Cost per hook fired | 0.07 |
| Drain while attached | 0.09 /s |
| Recovery on ground | 0.45 /s |
| Recovery in air | 0.16 /s |
| Minimum to fire | 0.1 |
| Stamina range | 0 … 1, starts at 1 |

### 3.3 Health constants

| | Solo | Online (free-for-all) |
|---|---|---|
| Max HP | 120 | 110 |
| Regen delay after last damage | 4.5 s | 4 s |
| Regen rate | 11 HP/s | 14 HP/s |

There is no armour.

### 3.4 Other constants

- Parry window: 0.55 s after the guard comes up (melee parry).
- Perfect-deflect window: 0.26 s after the guard comes up (projectile deflect).
- Block cooldown after a deflect: 0.19 s. Guard reach radius: 0.95 m.
- Grenades: start with 3, max 5, throw cooldown 0.55 s, full charge takes 1.1 s of holding.
- Camera springs: recoil pitch (k 190, d 17), recoil yaw (k 190, d 17), FOV kick (k 220, d 14), land dip (k 170, d 15).
- Base FOV 82°.
- Katana slot index: 3 (fourth weapon). Loadout order: rifle, shotgun, sniper, katana.

### 3.5 Initial state (constructor)

Body at level start position, standing height, zero velocity, not on ground. Yaw 0, pitch 0, roll 0. HP = max. Alive. Grapple stamina 1. Grenade charge 0. Hurt effect 0, flash effect 0. "Time since last damage" = 10. Weapon index 0 (rifle) equipped; previous-weapon index 0; quick-melee return timer 0. Bob phase 0, bob amount 0, step distance 0, eye height = standing. Not crouching, not sliding, slide time 0, coyote 0, jump buffer 0, wall-touch timer 9 (i.e. "long ago"), wall-jump cooldown 0, mantle cooldown 0, dash cooldown 0, air jumps 1, block cooldown 0, land-grace 0, sprint toggle off, was-on-ground true, air time 0. Grapple state idle. Death timer 0, gravity scale 1, dash-lock off. Grenades 3, no live grenades, grenade cooldown 0, firing false. Each gun's starting reserve is recorded so a reset can restore it.

### 3.6 Reset (used on game start, retry and online respawn)

Given a spawn position: grenade charge 0 and held flag off (arc preview hidden); stamina 1; block-held timer 0; body moved to position, velocity zero, off ground, standing height; HP = max; alive; yaw, pitch, roll 0; hurt/flash effects 0; not crouching/sliding; death timer 0; time since damage 10; dash cooldown 0; air jumps 1; gravity scale 1; dash-lock off; grapple detached (no boost); every gun: pending auto-reload callback cancelled, magazine full, reserve = starting reserve, not reloading, pump timer 0; switch to weapon 0 silently; view model visible; eye height standing; grenades 3; all live grenades removed.

## 4. Player: per-frame update order

Given scaled dt (section 1):

1. Time-since-last-damage += dt.
2. If dead → run the dead-state update (section 14) and stop.
3. View model made visible.
4. Look (section 5).
5. If dash-lock is on → freeze body (6.16), update camera and view model, stop.
6. Read move vector; compute wish direction (6.1); sprint (6.2); aim flag (6.3); horizontal speed = hypot(vel.x, vel.z).
7. Crouch / slide (6.4, 6.5).
8. Decrement land-grace, dash cooldown, block cooldown by dt.
9. Ground or air acceleration (6.6, 6.7).
10. Jump buffer, wall-touch tracking, jump / wall jump / double jump (6.8–6.10).
11. Air dash (6.11).
12. Gravity (6.12); grapple update (section 7); mantle attempt (6.13); no-snap flag; speed cap; body integration by the physics world.
13. Out-of-bounds check (6.15).
14. Landing detection (6.14); remember on-ground state.
15. Regeneration (8.3); block-held timer; grapple stamina; bob and footsteps (10.2).
16. Camera update (section 10).
17. Grenade charge / throw / arc preview / live grenade simulation (section 11).
18. Weapon slot switching, quick melee, weapon state object, weapon animate (section 12).
19. HUD aim-down-sights and scope flags (section 15).

## 5. Look and orientation

- Look multiplier: 1 normally; while aiming, 0.62 for non-scoped guns and 0.38 for the scoped gun (sniper).
- `yaw += look.x × mult`; `pitch = clamp(pitch + look.y × mult, −1.5, +1.5)` (±85.9°).
- Forward vector (full 3-D): `(−sin(yaw) × cos(pitch), sin(pitch), −cos(yaw) × cos(pitch))`.
- Flat forward: `(−sin(yaw), 0, −cos(yaw))`. Right: `(cos(yaw), 0, −sin(yaw))`.
- The camera's rotation order is yaw about Y, then pitch about X, then roll about Z.
- External override: during a focus dash (game-driven) yaw and pitch are set directly by the game to face the target (pitch clamped ±1.2).

## 6. Movement

### 6.1 Wish direction

`wish = flatForward × move.y + right × move.x`. `wishLen = min(1, |wish|)`; wish is normalised if its length > 0.0001. The move vector is stored for the camera (roll) and view model (strafe sway).

### 6.2 Sprint

- Gamepad active: `pressed(sprint)` toggles the sprint toggle; the toggle is cleared whenever forward input (move.y) < 0.1.
- Keyboard: sprint toggle = `held(sprint)`.
- Effective sprinting = toggle AND move.y > 0.1 AND not crouching AND not aiming.

### 6.3 Aim-down-sights flag

Aiming = `held(aim)` AND the current weapon is a gun. (For the katana, `held(aim)` instead means "guard up" and is passed to the weapon as its aim flag, but it does not count as aiming for movement/FOV purposes.)

### 6.4 Crouch

- Want-crouch = (`held(crouch)` AND on ground) OR sliding.
- If not wanting to crouch but currently crouched: tentatively set standing height; if the standing body overlaps the world, stay crouched.
- Body height = crouch height when crouching, else standing height.
- Max ground speed while crouched and not sliding = 3.6.

### 6.5 Slide

- Start: `pressed(crouch)` while on ground, horizontal speed > 6.3, not already sliding. Boost = clamp(12.8 − speed, 0, 4.5) added along the current horizontal velocity direction, so the resulting speed is `max(speed, min(speed + 4.5, 12.8))`. Slide sound; FOV kick 2.5; land-dip kick −2.5; slide timer 0.
- While sliding: timer += dt. Slide ends when crouch is released, or horizontal speed < 3.5, or airborne for more than 0.35 s.
- Sliding forces crouch (6.4).
- Ground physics while sliding: horizontal speed decays linearly at 6.5 m/s²; steering adds `wish × 6 × dt` but the result is scaled back so horizontal speed never exceeds the pre-steer speed.
- Jumping out of a slide multiplies horizontal velocity by 1.06 and ends the slide.

### 6.6 Ground acceleration and friction

When on ground (and not sliding):
- Coyote timer = 0.13, air time = 0, air jumps = 1.
- Friction factor `fr = 8`, or `8 × 0.25 = 2` during land-grace (6.14). Horizontal speed scales by `max(0, 1 − fr × dt)`.
- If wishLen > 0: `cur = vel_xz · wish`; `add = min(maxSpeed × wishLen − cur, 140 × dt)`; if add > 0, `vel_xz += wish × add`. maxSpeed is 3.6 crouched, 10.6 sprinting, else 6.6.

### 6.7 Air acceleration

When airborne: coyote −= dt; air time += dt. If wishLen > 0: `cur = vel_xz · wish`; `add = min(7.5 × wishLen − cur, 36 × dt)`; if add > 0, `vel_xz += wish × add`. (Speed above 7.5 along the wish direction is never reduced by this; it only tops up.)

### 6.8 Jump buffer, coyote time, ground jump

- `pressed(jump)` sets jump buffer = 0.15; otherwise buffer −= dt.
- Wall-jump cooldown and mantle cooldown −= dt.
- Wall touch: if the body hit a wall this frame (physics flag) and is airborne, wall-touch timer = 0 and the wall normal is stored; else wall-touch += dt.
- While the buffer > 0, the first matching option below is taken:
  1. Grapple attached → buffer = 0; detach with launch boost (7.6).
  2. On ground OR coyote > 0 → buffer = 0; coyote = 0; `vel.y = 9.6`; off ground; air jumps = 1; slide-jump boost if sliding (6.5); jump sound; land-dip kick −1.2.
  3. Wall jump (6.9).
  4. Double jump (6.10).

### 6.9 Wall jump

Conditions: wall-touch < 0.12 s, wall-jump cooldown ≤ 0, vel.y < 7. Effect: buffer = 0; cooldown = 0.35; with wall normal n and flat forward f: `vel.x = n.x × 7.5 + vel.x × 0.35 + f.x × 2.5`, `vel.z = n.z × 7.5 + vel.z × 0.35 + f.z × 2.5`, `vel.y = 9.2`. Wall-jump sound. Camera roll += −0.1 if n · right > 0 else +0.1. FOV kick 2; land-dip kick −1.5; air jumps = 1 (a wall jump restores the double jump).

### 6.10 Double jump

Condition: air jumps > 0. Effect: buffer = 0; air jumps −= 1; `vel.y = 9.6 × 0.92 = 8.832`; if wishLen > 0: `cur = vel_xz · wish`; `add = max(0, 7.5 × wishLen − cur)`; `vel_xz += wish × add` (redirects toward steering, instantly, up to 7.5). Jump sound; FOV kick 1.6; land-dip kick −1.4; a burst of 9 blue stroke particles at 0.7 m below body centre (speed 4.5, life 0.28, size 0.028, gravity −2).

### 6.11 Air dash

Trigger: (`pressed(dash)` OR (`pressed(crouch)` while airborne)) AND airborne AND dash cooldown ≤ 0 AND grapple not attached. Direction = wish if wishLen > 0 else flat forward. Effect: cooldown = 1.3; `cur = vel_xz · dir`; `target = max(cur + 6, 14)`; `vel_xz += dir × (target − cur)`; `vel.y = max(vel.y, 2)`. Dash sound; FOV kick 4; rumble(0.3, 0.6, 70 ms); camera roll += (dir · right) × 0.08; burst of 10 blue stroke particles 0.6 m behind body centre (speed 5, life 0.25, size 0.03).

### 6.12 Gravity, speed cap, integration

- `vel.y −= 26 × gravityScale × (grapple attached ? 0.88 : 1) × dt`. Gravity scale is 1 unless set externally.
- Grapple update (section 7), then mantle attempt (6.13).
- No-snap flag for the physics world = grapple attached OR vel.y > 0.5 (prevents ground snapping when walking off ledges while rising).
- If |vel| > 48, vel is scaled to 48.
- The physics world integrates the body (swept AABB with step-up; it reports on-ground, hit-wall + wall normal, hit-ceiling and landing velocity).

### 6.13 Mantle

Attempted every frame when: airborne, mantle cooldown ≤ 0, move.y > 0.3, vel.y < 8, grapple not attached.
1. Ray from (body position + 1.0 up) along flat forward, length 0.95 — must hit something.
2. Ray downward from (body position + flatForward × 0.95, +2.75 up), length 2.25 — must hit with an upward-facing normal (n.y ≥ 0.5).
3. `dy = hitTop.y − body.y` must be in [0.5, 2.4].
4. The box from (x − hw, top + 0.08, z − hw) to (x + hw, top + 1.05, z + hw) at the probe XZ must not overlap the world (hw = 0.35).
5. Effect: `vel.y = min(11, sqrt(2 × 26 × (dy + 0.45)))`; horizontal velocity set to flatForward × 3.2; mantle cooldown 0.7; mantle sound; land-dip kick −2.5; FOV kick 1.5.

### 6.14 Landing

On the frame the body goes from airborne to on-ground: `impact = clamp(−landingVelocity / 14, 0, 1.5)`; land-dip kick `−(impact × 6 + 0.5)`; land sound with intensity impact. If impact > 0.8: screen shake += impact × 0.15 and rumble(impact × 0.4, 0.2, 80 ms). If horizontal speed > 9: land-grace = 0.4 s (friction reduced to a quarter, letting a fast landing keep its speed).

### 6.15 Out-of-bounds respawn

After integration, if body.y < −12 or |x| > 95 or |z| > 95: detach grapple (no boost); teleport to the level start position; zero velocity; take 20 damage (no direction); message "OUT OF BOUNDS" / "respawned at spawn" for 1.8 s. (The game shell additionally forces body.y = −100 when the body is more than 8 m outside the level's XZ bounds or above y = 150, which triggers this path next frame.)

### 6.16 Focus-dash lock (external body control)

When the game sets the dash-lock flag (katana focus dash), the player each frame: zeroes velocity, marks off-ground, sets coyote = 0.13, updates the camera and animates the weapon with a neutral state (no fire, no aim, speed 0), and skips everything else (no movement, jumping, grapple, grenades or weapon input). The game moves the body directly and sets yaw/pitch. The lock is cleared by the game when the dash ends.

## 7. Grapple hook

State machine: **idle → fly → on → idle**. Fields: anchor point, hook position, hand origin, fly timer and duration, rope length, re-fire cooldown, target enemy (optional), target mover (optional), line-of-sight-blocked accumulator, generic timer, time attached ("swing time").

### 7.1 Hand position

`hand = eye + right × (−0.55) + forward × 0.9`, then y −= 0.42. This is where the rope visually starts and where the hook flies from.

### 7.2 Target search (also used every 0.08 s while idle for the HUD reticle)

Ray origin = eye, direction = forward, max distance 75.
1. World ray (ignoring boxes flagged "no grapple") → `wallDist` (75 if no hit).
2. **Exact enemy hit**: enemy hit-sphere raycast up to `min(50, wallDist + 0.5)`. If hit → target = hit point, enemy reference.
3. **Grapple movers** (moving swing points, e.g. drones): for each, `t` = distance along the ray to its centre; require 2 ≤ t ≤ min(75, wallDist + 1); lateral offset from the ray `lat = sqrt(|rel|² − t²)`; accept if `lat < mover.radius + 0.3 + t × 0.012`; choose the smallest lateral. Target point = mover centre (updates each frame).
4. **Near-miss enemy**: for each alive enemy not in its spawn state: require 1.5 ≤ t ≤ min(45, wallDist + 1.5), `lat ≤ 1.1 + t × 0.06`, smallest lateral wins, and line of sight from eye to enemy centre must be clear. Target = enemy centre.
5. **Grapple rings** (fixed level points): require 2 ≤ t ≤ min(75, wallDist + 1.5), `lat ≤ 0.8 + t × 0.02`; smallest lateral wins.
6. **Wall**: if the world ray hit, target = hit point + normal × 0.12.
7. Otherwise no target.

### 7.3 Firing (idle, `pressed(grapple)`, cooldown ≤ 0)

- If stamina < 0.1: "winded" sound, tip "grapple needs a breather" for 0.9 s, nothing fires.
- If no target: "empty" click sound.
- Else stamina −= 0.07; state = fly; anchor = target point; hand origin computed; hook = origin; fly timer 0; `flyDuration = clamp(targetDistance / 110, 0.04, 0.6)`; enemy/mover references stored. Grapple-fire sound; rumble(0.15, 0.4, 40 ms); weapon position spring kicked (−0.3, 0.2, 0.5).

### 7.4 Fly

Anchor tracks the mover if any. Fly timer += dt; `f = min(1, timer / duration)`; hook = lerp(origin, anchor, f). When f reaches 1:
- Enemy target: if still alive → the enemy subsystem "yanks" it toward the player's body centre (enemy is stunned 1.3 s and launched at the player at speed clamp(dist × 1.6, 10, 26) with vertical clamp(dist × 0.5, 4, 9); bosses only flinch), score +30 "YANKED", grapple-hit sound, rumble(0.5, 0.5, 90 ms). Then detach (no boost) regardless.
- Otherwise: state = on; `ropeLength = max(1.5, distance(bodyCentre, anchor) × 0.94)`; blocked accumulator 0; timers 0; grapple-hit sound; reel loop sound on; HUD reticle "attached"; rumble(0.3, 0.6, 60 ms); if on ground: `vel.y = max(vel.y, 5)` and off ground.

### 7.5 Attached ("on")

Each frame:
- Anchor tracks the mover if any; hook = anchor; swing time += dt.
- `d` = unit vector from body centre to anchor; `dist` = that distance; `vAlong = vel · d`; reeling = `held(grapple)`.
- Reeling: `ropeLength = max(1.5, ropeLength − 14 × dt)`; if vAlong < 22: `vel += d × 42 × dt`.
- Not reeling: if vAlong < 6: `vel += d × 3 × dt` (gentle tension). Swing pump: if move.y > 0.3 and bodyCentre.y < anchor.y − 1: `vel += flatForward(normalised, from the 3-D forward with y removed) × 10 × dt`.
- Rope constraint: if dist > ropeLength: if vAlong < 0 (moving away) remove that component (`vel −= d × vAlong`); then move the body toward the anchor by `min(dist − ropeLength, 0.35) × 0.85`; if that puts the body inside the world, undo the move.
- If on ground, reeling and d.y > 0.2: `vel.y = max(vel.y, 4.5)` and off ground.
- Every 0.15 s: line of sight eye → anchor; blocked → accumulator += 0.15, else accumulator = 0.
- Detach when any of: `pressed(grapple)`; dist < 1.3 (this one detaches WITH boost); accumulator > 0.3; dist > 90; on ground AND swing time > 0.6 AND not reeling.
- Gravity while attached is 88% (6.12). Health regen is suspended while not idle (8.3). Air dash is not allowed while attached. FOV +3 while attached (10.4).

### 7.6 Detach(boost)

If idle, nothing. Else: state = idle; re-fire cooldown 0.12; clear enemy/mover refs; hide rope and hook; reel loop sound off; HUD reticle off. If the state was "on": with boost → `vel.y = max(vel.y, 0) + 8`, horizontal velocity × 1.12, jump sound, FOV kick 3; without boost → `vel.y += 2.5`, release sound. Boost is used for the jump-launch and the "reached the anchor" case; no boost for stamina exhaustion, enemy yank, out-of-bounds, death, reset, line-of-sight loss, manual release and the network "rope cut" event.

### 7.7 Stamina

Each frame: attached → stamina −= 0.09 × dt; otherwise += (on ground ? 0.45 : 0.16) × dt; clamp to [0, 1]. If attached and stamina ≤ 0: detach (no boost) and tip "out of breath · land to recover" for 1.4 s. The HUD shows the breath bar only when stamina < 0.995, flagged "low" below 0.2.

### 7.8 Visuals the player must perceive

While not idle: a thin rope (thickness 0.008) from the hand position to the hook position, and a hook marker at the hook position aligned with the rope. Reticle states: 0 off, 1 "target available" (shown while idle and a target exists, refreshed every 0.08 s), 2 "attached".

## 8. Health, damage, regeneration, death

### 8.1 Taking damage

`takeDamage(amount, fromPosition?)`: ignored if dead. `hp −= amount`; time-since-damage = 0; hurt effect = min(1, hurt + amount / 40); screen shake += 0.2 + amount / 80; hurt sound; rumble(0.8, 0.5, 160 ms). If a source position is given, a HUD damage-direction indicator is shown at angle `atan2(rel · right, rel · forward)` where rel = source − eye (0 = ahead, positive = to the right). If hp ≤ 0: hp = 0 and die.

Online: incoming damage messages are ignored while spawn protection (2 s after respawn) is active or when not in play state.

### 8.2 Knockback

`knockback(direction, amount)`: `vel += direction × amount`; `vel.y += amount × 0.5`; off ground.

### 8.3 Regeneration

If time-since-damage > regen delay AND hp < max AND not sprinting AND grapple idle: `hp = min(max, hp + regenRate × dt)`.

### 8.4 Healing and resupply from the game shell

- Health pickup: +35 HP (capped). Ammo pickup: every gun's reserve += round(maxReserve × 0.4) (capped at maxReserve), and +1 grenade (capped at 5).
- Wave cleared (solo): +40 HP. Each new wave: +1 grenade (capped).
- Focus execute: +6 HP.
- `addAmmoAll(fraction)` (default 0.5) is the generic entry point: reserve += round(maxReserve × fraction) per gun.

### 8.5 Death

`die()`: alive = false; death timer 0; death sound; detach grapple (no boost); notify the game. Game shell: solo → state "dying", after 1.7 s state "dead" (death screen, pointer lock released); online → broadcast death, respawn after 3.5 s via reset at an arena spawn with 2 s spawn protection. Dead-state simulation is in section 14.

### 8.6 Damage the player receives from other subsystems (for reference)

Enemy projectiles: direct hit = projectile damage (catch radius 0.5, or 0.9 for blast projectiles); blast projectile burst: `dmg × (1 − d / 3.5)` within 3.5 m plus knockback 6. Enemy melee: template damage × difficulty multiplier (may be parried, 9.2). Various enemy slams/stomps: listed in the enemy spec; each also applies knockback of 7–13. Own grenade: 10 + 34 × (1 − d / 6.08), i.e. 10 at the edge up to 44 at the centre, plus knockback 9. Deflected-by-remote-player bullet returned: 60% of the shot's damage.

## 9. Katana guard: block and parry

- **Blocking** = katana equipped AND the katana's blocking flag (13.8) is set.
- **Block-held timer**: accumulates dt while blocking, resets to 0 otherwise.
- **Guard radius** = 0.95 if blocking and block cooldown ≤ 0, else 0. The enemy projectile system uses `max(normal catch radius, guard radius)` as the segment-vs-player catch radius for the local player, so a raised guard catches bullets that would otherwise miss by up to ≈0.95 m.
- **Parry window** = blocking AND block-held < 0.55 s.

### 9.1 Projectile deflect — `tryDeflect(projectile)`

Fails (returns "no") if dead, not blocking, or block cooldown > 0. Fails if the incoming direction (negated projectile velocity, normalised) · forward < 0.55 (bullets from the flank or back are not blocked). Otherwise:
- perfect = katana block time < 0.26 s.
- returned = perfect OR 35% chance.
- block cooldown = 0.19.
- Katana plays its parry flick (13.8) with the perfect flag; perfect-parry or parry sound; orange sparks at the projectile (14 if perfect else 8, speed 10) directed back along the incoming path; blue stroke burst (8 or 5, speed 4.5, life 0.2, size 0.028); rumble(0.4, 0.6, 70 ms); hit-stop 0.07 s at scale 0.18 if perfect, else 0.025 s at 0.18; screen shake += 0.06; flash effect 0.35 (perfect) or 0.1; score +60 "PERFECT PARRY" or +15 "BLOCKED".
- Returns {perfect, returned}. The projectile system then: if returned → re-aims the projectile (at its owner if perfect, else the nearest visible enemy within a 0.7 rad half-angle cone and 70 m, else its owner) at 1.6× speed and marks it deflected (it can now damage enemies with source "deflect"); if not returned → the projectile is destroyed with a small red burst.

### 9.2 Melee parry — `tryBlockMelee(enemy)`

Fails if dead, parry window closed, or block cooldown > 0. Fails if (enemy centre − eye, normalised) · forward < 0.35. Otherwise: katana parry flick (perfect); parry sound; hit-stop 0.06 s at 0.15; 12 orange sparks 0.8 m ahead of the eye directed back at the player (speed 8); score +40 "BLOCKED"; rumble(0.6, 0.6, 100 ms); returns true. Note it does NOT set the block cooldown. The enemy system then stuns the attacker (1.1 s, thrown back at 7 m/s with 3.5 up; divers: stunned and bounced).

### 9.3 Being parried online

When the local player's katana slash hits a remote player who is blocking, facing (dot > 0.6), hit on a front part, within their parry window: the local katana cooldown is raised to at least 0.6 s, hit-stop 0.08 at 0.15, rumble(0.6, 0.3, 90 ms), tip "PARRIED" 0.9 s, and no damage is sent. A local bullet that hits a remote player's blade: 40% chance it is "returned" — the local player takes 60% of the shot damage from that player's position (tip "RETURNED", rumble 0.5/0.4/90 ms), else tip "DEFLECTED".

## 10. Camera

### 10.1 Eye and centre

- Target eye height = 0.88 crouched, else 1.6. While alive, eye height damps toward the target at rate 14 (while dead it is driven by section 14).
- Eye = body position + (0, eyeHeight + landDip × 0.07 + bobY, 0).
- Body centre (used for grapple, blasts, aim assist) = body position + (0, bodyHeight × 0.55, 0).

### 10.2 Bob and footsteps

- moving = on ground AND horizontal speed > 0.6 AND not sliding.
- Bob amount damps at rate 8 toward `clamp(speed / 7, 0.3, 1.4)` when moving, else 0.
- When moving: bob phase += dt × (7 + speed × 0.5); step distance += speed × dt; when step distance > (sprinting ? 2.5 : 2.0) it resets and a footstep sound plays at volume clamp(speed / 8, 0.3, 1).
- bobY = |sin(phase)| × 0.03 × bobAmt; bobX = cos(phase × 0.5) × 0.018 × bobAmt (applied along right).

### 10.3 Roll, shake, springs

- All four camera springs are stepped every frame.
- Alive: roll damps at rate 9 toward `−move.x × 0.022 + (sliding ? −0.08 : 0)`. Wall jumps and dashes add impulses to roll directly (6.9, 6.11).
- Screen shake: a shared "shake amount" (effects subsystem) is read, then damped toward 0 at rate 7; `shk = min(amount, 1.2)`.
- Camera position = eye + right × (bobX + (U(0,1) − 0.5) × shk × 0.07); y += (U(0,1) − 0.5) × shk × 0.07.
- Camera rotation: pitch = pitch + recoilPitchSpring + (U(0,1) − 0.5) × shk × 0.035; yaw = yaw + recoilYawSpring + (U − 0.5) × shk × 0.035; roll = roll + sin(phase × 0.5) × 0.004 × bobAmt.

### 10.4 Field of view

- Target FOV = 82 + clamp((|vel| − 7) / 16, 0, 1) × 8 + (sprinting ? 3 : 0) + (sliding ? 4 : 0) + (grapple attached ? 3 : 0) + fovKickSpring.
- If aiming: target FOV = the current weapon's ADS FOV instead.
- Actual FOV damps toward the target at rate 16 while aiming, else 8. The projection is updated when it changes by more than 0.01°.

### 10.5 Recoil and kick entry points

- `recoil(p, y)`: `pitch = clamp(pitch + p × 0.55, −1.5, 1.5)` (permanent climb); recoil-pitch spring kicked by p × 22; recoil-yaw spring kicked by y × 30.
- `kickFov(v)`: FOV-kick spring kicked by v × 30.
- Land-dip spring: kicked negative on jumps/landings (values listed where they occur); it lowers the eye by 0.07 per unit and feeds the view model as `clamp(−value × 0.08, −0.5, 0.5)`.

### 10.6 Post effects the renderer receives

Hurt effect (0–1, damps toward 0 at rate 3), flash effect (damps at rate 10), low-HP factor = `1 − hp / 30` when alive and hp < 30 else 0, and a slow-motion flag when time scale < 1.

## 11. Grenades

### 11.1 Charge and throw input

- While `held(grenade)` AND grenades > 0 AND grenade cooldown ≤ 0 AND alive AND not dash-locked: charge = min(1, charge + dt / 1.1); "held" flag on; arc preview shown for the current charge.
- Otherwise, if the held flag was on: clear it; if grenades > 0 and cooldown ≤ 0 and alive → throw with the accumulated charge; charge = 0. Preview hidden.
- Grenade cooldown −= dt each frame.

### 11.2 Launch parameters (charge c in 0…1)

- Start position = eye + right × 0.25 + forward × 0.6, then y −= 0.15.
- Velocity = forward × (9 + 20c) + bodyVelocity × 0.5; then y += 3.5 + 2.5c.

### 11.3 Throw

grenades −= 1; cooldown = 0.55; weapon position spring kicked (−0.4, 0.5, 1.2) and rotation spring (−3, 0, −1.5); grapple-fire sound; rumble(0.2, 0.4, 50 ms); the throw callback (network) receives position and velocity rounded to 2 decimals. A grenade object is created: radius 0.16 sphere with a small ring and cap on top; random angular velocity U(−6, 6) rad/s on each axis; fuse 2.3 s; owned-by-me flag; not at rest; tick timer 0. Remote grenades (from the network) are created with the given position/velocity, owned-by-me false, and no cooldown/count change.

### 11.4 Grenade physics (per frame, until at rest)

- `vel.y −= 22 × dt`; position += vel × dt.
- Sweep test: world ray from the previous position along the motion, length = moved distance + 0.16. On hit: position = hit point + normal × 0.16; `vn = vel · normal`; if vn < 0: `vel += normal × (−1.45 × vn)` (restitution 0.45), then `vel × 0.55`, angular velocity × 0.6, shell-clink sound. If |vel| < 1.2 and normal.y > 0.5 → at rest, velocity zeroed.
- Mesh rotates by its angular velocity.
- Fuse sparks: a 2-particle orange burst 0.22 m above the grenade (speed 2.5, life 0.12, size 0.02) at 5 Hz, rising to 14 Hz when the fuse < 0.8 s.
- fuse −= dt; at ≤ 0 → explode and remove.

### 11.5 Explosion

Radius R = 6.4; centre c = grenade position + 0.25 up. Boom effect of radius R; explosion sound at c; rumble(0.9, 0.9, 220 ms).
- If owned by me: enemies within R take `120 × (1 − d / R × 0.6)` (enemy subsystem's blast), and breakables within 0.9R are broken.
- Self (any grenade, mine or remote): `d` = distance from body centre to c; if alive and d < 0.95R (6.08): damage `10 + 34 × (1 − d / 6.08)` from c, knockback 9 along (centre − c).
- Remote players (mine only, when hurting them is allowed): if dd < 6.08 → `12 + 50 × (1 − dd / 6.08)`.

### 11.6 Arc preview (while charging)

26 dots plus a landing ring. Simulate the launch (11.2) with fixed steps of 1/30 s for up to 70 steps using the same gravity (22) and the same bounce rules; stop early if the rest condition is met. Every second step starting at step 6 places the next dot at the simulated position (scale 0.8 + 0.6c); unused dots hidden. The landing ring (radius 0.55, lying flat) is placed at the final position + 0.02 up with scale 0.8 + 0.5c.

## 12. Weapon handling by the player

### 12.1 Slots and switching

- `pressed(slotN)` for N = 1…5 → switch to weapon index min(N − 1, 3). `pressed(nextWeapon)` / `pressed(prevWeapon)` cycle through the 4 weapons.
- `switchTo(i, silent)`: ignore if out of range, or if i is the current index and not silent. If the current weapon is not the katana, remember it as the "previous weapon". Unequip current, equip new (equip raise animation restarts), play switch sound unless silent, tell the HUD the weapon name and hint, and set the crosshair mode ("katana" or normal).

### 12.2 Quick melee

`pressed(melee)` while a gun is equipped: switch to the katana, set the return timer to 0.85 s, start a slash immediately, and suppress the melee-pressed flag in this frame's weapon state. While the return timer > 0: if the katana is equipped and (fire pressed OR aim held OR melee pressed) → the timer is cancelled (the player keeps the katana); otherwise timer −= dt and at ≤ 0 the previous weapon is re-equipped.

### 12.3 Weapon state object (passed to the weapon every frame)

| Field | Value |
|---|---|
| fire | `held(fire)` |
| firePressed | `pressed(fire)` |
| aim | aiming (6.3) OR (`held(aim)` AND katana equipped) |
| reloadPressed | `pressed(reload)` |
| meleePressed | `pressed(melee)` AND katana equipped (false in the quick-melee frame) |
| sprinting | effective sprint (6.2) |
| grounded | on ground |
| speed | horizontal speed |
| sliding | sliding flag |
| lookDelta | this frame's look vector (x, y radians) |
| strafe | move.x |
| bobPhase, bobAmt | from 10.2 |
| landDip | clamp(−landDipSpring × 0.08, −0.5, 0.5) |
| slideTilt | 1 if sliding else 0 |
| blockFire | true when dead (no firing) |

In the dead state and dash-lock state a neutral state is passed: fire/firePressed/aim/reloadPressed/meleePressed false, speed 0, sprinting false, blockFire = not alive. No actionable input reaches the weapon. The game can still call startSlash directly with this neutral state for a focus slash.

### 12.4 After animating

- "firing" flag (for the network) = fire held AND gun equipped.
- HUD ADS flag = gun AND weapon aim amount > 0.55. HUD scope overlay = weapon has a scope AND aim amount > 0.62.

## 13. Weapons

### 13.1 Shared view-model behaviour

Root positions are in camera space (x right, y up, −z forward) and are not multiplied by the model scale. The weapon root scales its geometry by 0.46; the shared camera rig stays at scale 1, so the model scale is applied once.

- Hip position: (0.2, −0.17, −0.36) by default; shotgun (0.2, −0.19, −0.34); sniper (0.21, −0.19, −0.36); revolver (0.19, −0.2, −0.3); katana (0.27, −0.25, −0.4) with hip rotation (0.75, 0.15, −0.35).
- ADS position from the gun's sight offset (sx, sy, sz) and eye-to-sight distance D: `(−sx × 0.46, −sy × 0.46, −sz × 0.46 − D)` — the sight point lands on the camera axis at distance D. The katana's ADS position equals its hip position.
- Position spring: 3-D spring (k 260, d 18). Rotation spring: 3-D spring (k 220, d 16).
- Per frame (state = section 12.3):
  - lx, ly = look delta clamped to ±0.12.
  - aim amount damps toward (aim ? 1 : 0) at rate 14; `ia = 1 − aim`.
  - sway position: x damps (rate 10) toward `lx × 0.5 × (0.3 + 0.7ia)`; y toward `ly × 0.35 × (0.3 + 0.7ia)`.
  - sway rotation: y damps (rate 10) toward `lx × 1.4 × ia`; x toward `ly × 0.9 × ia`; z damps (rate 8) toward `(−lx × 1.8 − strafe × 0.06) × ia`.
  - bob: x = sin(phase) × 0.013 × bobAmt × (0.15 + 0.85ia); y = |cos(phase)| × 0.013 × bobAmt × (0.15 + 0.85ia).
  - sprint amount damps (rate 8) toward 1 if sprinting and not aiming, else 0.
  - springs stepped.
  - equip progress += dt × 3.2 (capped at 1); `eq = 1 − easeOut(progress)` with easeOut(t) = 1 − (1 − t)³ → the weapon rises into view over 0.3125 s.
  - position = lerp(hip, ADS, aim) + (swayX + bobX + springPos.x × (0.3 + 0.7ia) + sprint × 0.06, swayY + bobY + springPos.y × (0.3 + 0.7ia) − eq × 0.32 − landDip × 0.35 × ia − sprint × 0.09, springPos.z + sprint × 0.05).
  - rotation = (hipRot.x × ia + swayRot.x + springRot.x − eq × 0.9 + sprint × 0.4 + landDip × 0.5 × ia, hipRot.y × ia + swayRot.y + springRot.y × (0.4 + 0.6ia) − sprint × 0.55, hipRot.z × ia + swayRot.z + springRot.z × (0.3 + 0.7ia) + sprint × 0.18 + slideTilt × 0.4 × ia).
  - Scoped weapon: the model is hidden once aim amount ≥ 0.8 (the scope overlay takes over).
  - Then the weapon-specific update runs (13.4–13.8), which may add further pose offsets for reload/pump/slash.

### 13.2 Gun statistics

Four guns are defined; the loadout uses rifle, shotgun and sniper. The revolver is defined but not equipped in the design loadout (included for completeness).

| Stat | Rifle | Shotgun | Sniper | Revolver |
|---|---|---|---|---|
| Display name | RIFLE | SHOTGUN | SNIPER | REVOLVER |
| Hint text | "auto · put the red dot on them" | "pump · devastating up close" | "scoped bolt action · one shot, one kill" | "hand cannon · headshots delete" |
| Type | hitscan, automatic | hitscan, semi, pump | hitscan, semi, bolt, scoped | hitscan, semi |
| Magazine | 35 | 6 | 5 | 6 |
| Starting reserve | 175 | 36 | 25 | 36 |
| Max reserve | 350 | 72 | 50 | 72 |
| Shot interval (s) | 1/11 ≈ 0.0909 (660 rpm) | 0.78 | 0.2 (bolt cycle dominates) | 0.3 |
| Damage per pellet (vs enemies) | 24 | 19 | 150 | 62 |
| Headshot multiplier | 2.6 | 1.8 | 3 | 3 |
| Pellets | 1 | 10 | 1 | 1 |
| Hip spread (rad-ish, see 13.3) | 0.018 | 0.062 | 0.075 | 0.006 |
| ADS spread | 0.004 | 0.034 | 0.0004 | 0.002 |
| Spread kick per shot | 0.011 | 0 | 0.05 | 0.02 |
| Spread max | 0.09 | 0.1 | 0.14 | 0.06 |
| Movement spread per m/s | 0.0012 | 0.0006 | 0.004 | 0.0015 |
| ADS FOV (deg) | 58 | 68 | 20 | 52 |
| Sight offset (x, y, z) and eye distance | (0, 0.12, −0.05), 0.3 | (0, 0.095, −1.0), 0.52 | (0, 0.135, 0), 0.42 | (0, 0.08, −0.34), 0.42 |
| Camera kick (pitch, yaw) | 0.011, 0.004 | 0.05, 0.012 | 0.055, 0.008 | 0.038, 0.007 |
| Model kick (px, py, pz, rx, ry, rz) | 0.25, 0.3, 2.4, −3.2, 0.9, 1.2 | 0.4, 0.6, 5, −9, 2, 3 | 0.25, 0.8, 4.5, −11, 1.2, 2 | 0.3, 0.9, 3.2, −10, 1.5, 2.5 |
| FOV kick | 1.2 | 4 | 4.5 | 2.5 |
| Reload duration (s) | 1.45 | 0.45 per shell | 2.1 | 1.9 |
| Reload type | magazine | shells (one at a time) | magazine | cylinder |
| Falloff [start m, end m, min mult] (vs enemies) | none | [11, 32, 0.22] | none | none |
| Cycle (pump/bolt) duration (s) | — | 0.45 | 0.85 | — |
| Tracer width | 0.02 | 0.014 | 0.03 | 0.026 |
| Muzzle flash scale | 1 | 1.9 | 1.7 | 1.35 |
| Ejected shell (size, colour) | 0.02 orange | 0.035 red | 0.03 orange | none |
| PvP damage, head mult, falloff | 19, 1.8, none | 16, 1.6, [9, 26, 0.15] | 150, 1.5, none | 52, 2.9, [9, 34, 0.42] |
| Scope | no | no | yes | no |

Effective fire rates: shotgun is limited by the pump (0.45 + 0.12 = 0.57 s lockout after each shot, then the 0.78 s interval — so one shot per 0.78 s); sniper by the bolt (0.85 + 0.12 = 0.97 s per shot).

### 13.3 Spread model

- The gun keeps a "current spread" value, initialised to the hip spread.
- Each frame: `base = aim ? adsSpread : hipSpread`; `moveAdd = speed × movementSpread + (airborne ? 0.01 : 0) + (sliding ? 0.008 : 0)`; current spread damps toward base + moveAdd at rate 7.
- On each shot: current spread is sampled BEFORE the kick, then `current = min(current + spreadKick, spreadMax)`.
- Shot direction: `forward + right × U(−s, s) + up × U(−s, s)`, normalised, where s = sampled spread. (So s ≈ maximum angular deviation in radians per axis, uniform square distribution.)
- Crosshair gap in pixels = 5 + currentSpread × 900 (katana: fixed 4). The HUD hides the crosshair while ADS.

### 13.4 Firing

- Shot timer −= dt. Muzzle flash timer −= dt; flash hidden at ≤ 0.
- Reload input: `reloadPressed` AND magazine < size AND reserve > 0 AND not reloading AND pump timer ≤ 0 → start reload, and nothing else this frame.
- Want-fire = automatic ? fire held : fire pressed.
- Fire is allowed when want-fire AND shot timer ≤ 0 AND pump timer ≤ 0 AND not blockFire. If the magazine is empty: on a fire PRESS play the empty click and start a reload. Otherwise: if a shell-by-shell reload is in progress it is abandoned (left hand snaps back) and the shot fires. (Magazine and cylinder reloads never reach this point — see 13.6.)
- Firing: shot timer = interval; magazine −= 1; for each pellet cast a ray from the eye in a spread direction (13.3); count hits. Effects: muzzle flash visible for 0.045 s, random roll, scale = flashScale × U(0.8, 1.4); (4 + pellets) orange stroke particles at the muzzle at speed 6 × flashScale (life 0.08, size 0.03, no gravity, drag 8); smoke puffs (5 for shotgun, else 2); a shell is ejected unless the gun reloads shells; if the gun has a cycle: pump timer = cycle + 0.12, and for shell-reloaders a "needs pump" flag is set; position spring kicked (U(−k0, k0), U(0.4k1, k1), k2); rotation spring kicked (k3, U(−k4, k4), U(−k5, k5)); camera recoil(pitchKick × (aiming ? 0.7 : 1) + U(0, pitchKick × 0.3), U(−yawKick, yawKick)); FOV kick by fovKick; fire sound; rumble(0.15 + fovKick × 0.08, 0.5, 40 + fovKick × 15 ms); screen shake += 0.02 + fovKick × 0.02; shotgun with ≥ 1 hit → hit-stop 0.03 s at 0.3.
- Magazine-type guns auto-reload after 250 ms of real time when the magazine reaches 0 (if still empty, reserve > 0, and not already reloading), even during a pump/bolt cycle. The delayed callback continues while holstered, paused, or in hit-stop; the reload animation advances only when the weapon is equipped and updated. Cancel the callback on player reset or weapon disposal (weapons.md §11.5).
- Shell ejection: from the gun's eject point, velocity = right × U(1.5, 2.5) × spreadFactor + forward × U(−0.5, 0.5), y += U(1.5, 2.8); the effects subsystem draws it with the gun's shell size and colour.

### 13.5 Hit resolution and damage

For each pellet ray (max range 300 m):
1. Enemy hit-sphere raycast; world raycast ignoring boxes flagged "no shoot"; remote-player raycast (online).
2. Priority: the closest remote player (if closer than both enemy and world) → PvP damage: `pvpDamage × (head ? pvpHeadMult : 1)`, then if a PvP falloff exists `× clamp(1 − (dist − start) / (end − start), min, 1)`; passed to the game's hit-player handler with the hit info (point, direction, part, source = gun kind, crit, distance).
3. Else a breakable world box closer than any enemy → break-hit with base damage.
4. Else an enemy closer than the world → `damage × (head ? headMult : 1)`, times the falloff clamp above if the gun has one; passed to the enemy subsystem's damage entry with (point, direction, part, source = gun kind, crit).
5. Else a world hit → bullet impact effect at the point along the normal; 25% chance of a ricochet sound.
6. Else the ray ends 300 m out.
Always: a tracer from the muzzle to the end point (width per gun, life 0.05); the "shot fired" callback receives the end point (network shot replication).

### 13.6 Reloading

Start: refused if already reloading, magazine full, or reserve 0. Plays the reload / shell / cylinder sound by type.

- **Magazine** (rifle 1.45 s, sniper 2.1 s): at completion, `take = min(magSize − mag, reserve)`; mag += take; reserve −= take. Pose during reload, with t = progress 0…1: tilt = sin(clamp(t / 0.22) × π/2) fading out over t 0.82…1: rotation += (−0.3, 0.25, 0.5) × tilt, position += (0.03, −0.07, 0) × tilt; the magazine mesh drops and swings between t 0.18 and 0.68 (y −0.3 × sin, roll 0.6 × sin); at t > 0.86 a rack kick: rotation spring (−2.5, 0, 0), position spring (0, 0, 0.6). While a magazine reload runs, fire and reload input are NOT processed at all (the reload cannot be interrupted).
- **Cylinder** (revolver 1.9 s): opens over t 0…0.25, closes over 0.8…1; pose: rotation += (0.3, 0, 0.9) × open, position += (−0.05, 0.02, 0) × open, cylinder swung out −1.5 rad; at t > 0.3 six shells are ejected at 0.7 spread with a shell sound; ammo transferred at completion. Like the magazine reload, it cannot be interrupted: fire and reload input are ignored until it completes.
- **Shells** (shotgun 0.45 s each): pose per shell s = sin(progress × π): rotation += (0.15, 0, 0.35) × s, position.y −= 0.04 × s, left hand moves (+0.1, −0.12, +0.55) × s. At each 0.45 s: mag += 1, reserve −= 1, timer resets; if now full or reserve 0 → reload ends, left hand returns, and if a pump is owed (the gun fired since its last pump) the pump cycle starts; otherwise a shell sound plays and the next shell begins. Firing interrupts the shell reload at any time (a partially loaded magazine keeps what it got).

### 13.7 Pump / bolt cycle

While the pump timer > 0 (set to cycle + 0.12 on firing): timer −= dt; `t = 1 − timer / cycle`; `s = sin(min(1, t × 1.15) × π)`. Fore-end slides back by 0.16 × s (shotgun); bolt handle slides 0.2 × s and rotates −1.1 × s rad (sniper). Pose: rotation += (0.12, 0, 0.15) × s, position.y −= 0.02 × s. At t > 0.45 (once): pump sound, shell ejected, rotation spring kicked (−1.5, 0, 1). At timer ≤ 0: parts return, "needs pump" cleared. No firing or reload input while the pump timer > 0.

### 13.8 Katana

- Name "KATANA", hint "slash · hold aim to block & return bullets". Infinite ammo. Damage 75 vs enemies, 55 vs remote players; also breaks breakables with 75.
- Slash duration 0.27 s; slash cooldown = 0.27 + 0.06 = 0.33 s; combo counter with a 0.9 s combo timer (resets combo to 0 when it expires); alternating swing side: odd combo = right-to-left (s = +1), even = left-to-right (s = −1).
- **Start slash** (triggered, only when no slash is in progress and cooldown ≤ 0, by: fire pressed, or fire held while combo > 0 (chain) — both also require not blockFire; or melee pressed, which ignores blockFire): slash timer = 0.27; hit-done false; combo += 1; combo timer 0.9; cooldown 0.33; swing sound; FOV kick 2; if sprinting or airborne → lunge 5.5 (below); 9 fading blue arc tracers 1.3 m ahead of the eye sweeping across ±1.1 rad on a 0.9 × 0.55 ellipse.
- **Lunge(speed)**: d = forward with y clamped to [−0.2, 0.5], normalised; `vel += d × speed`; if on ground: `vel.y = max(vel.y, 2.5)` and off ground; dash sound; FOV kick 3.
- **Slash pose** (t = progress, e = ease-in-out cubic of t): rotation += (0.7 − 1.5e, s × (−0.35 + 0.8e), s × (1.3 − 2.7e)); position += (s × (0.2 − 0.45e), 0.14 − 0.24e, −0.12 × sin(tπ)).
- **Hit** at t > 0.32 (≈0.086 s into the swing), once per slash: all alive enemies within 3.0 m (+0.3 slack; bosses measured 1.2 m closer) of the eye and inside a cone of half-angle 0.95 rad (≈54°) about forward (anything within 0.3 m always counts) take 75 damage (source "katana", torso, hit point = enemy centre with y + U(−0.2, 0.4), direction = forward pushed sideways by s × 0.7 and down 0.35, normalised; slash side passed along). Remote players in the same arc with line of sight: 55 via the hit-player handler. Remote players' grapple ropes within 3.4 m are cut. Breakables within 3.2 m inside cos(1.0) are broken. If anything was hit: hit sound, hit-stop 0.07 s at 0.12, screen shake += 0.12, rumble(0.7, 0.4, 90 ms), position spring kicked (0, 0, 1.5).
- **Guard**: want-block = aim held AND fire not held AND no slash in progress AND cooldown ≤ 0. Entering block resets the katana's block timer to 0; the timer accumulates dt while blocking. Block amount damps toward (blocking ? 1 : 0) at rate 16. The pose lerps by block amount toward guard position (0.21, −0.31, −0.36) and guard rotation (1.40, 0.30, 1.24) (absolute blend, applied after the shared pose).
- **Parry flick** (`onDeflect(perfect)`): parry-swing = 1 and the flick side alternates; rotation spring kicked (perfect ? −3.5 : −2, side × 2, side × 2.5); position spring kicked (side × 0.15, 0.15, 1.2). Parry-swing decays at 4.5/s; while > 0, with e = sin(min(1, swing) × π): rotation += (0, side × 0.16e, side × 0.42e), position.x += side × 0.035e.
- **Blood on the blade**: level 0…1; +0.42 per katana/focus kill (game shell); decays 0.05/s. Six streak meshes become visible when level exceeds 0, 0.18, 0.40, 0.58, 0.74, 0.88 respectively; each scales with f = clamp((level − threshold) / 0.28, 0.2, 1) → height 0.35 + 0.65f, length 0.4 + 0.6f.
- Crosshair: katana mode shows only the vertical ticks (see 15).

## 14. Dead-state behaviour and idle camera

### 14.1 Dead (alive = false, game state "dying"/"dead")

Each frame: death timer += dt; eye height damps toward 0.35 at rate 3; roll damps toward 0.9 at rate 3; pitch damps toward −0.35 at rate 3; horizontal velocity damps toward 0 at rate 4; gravity applies; body integrates; forward/right recomputed; live grenades still simulate; camera updates (no roll/eye damping of the alive path; springs still run); weapon animates with a neutral state (blockFire true). No input is processed.

### 14.2 Idle camera (menus)

In non-playing states the camera orbits: position = (sin(t × 0.08) × 70, 30 + sin(t × 0.23) × 4, cos(t × 0.08) × 70), looking at (0, 10, 0); FOV forced to 70; the view model is hidden; eye/centre/forward/right follow the camera (right = (forward.z, 0, −forward.x) normalised).

## 15. HUD outputs driven by this subsystem

Refreshed every frame by the game shell from player fields:
- Ammo: magazine, reserve, magazine size, reloading flag (gun) or "∞" (katana); a tally of up to 40 marks for rounds in the magazine.
- Slot list: name, active flag, "mag/reserve" or "∞", empty flag (mag 0 and reserve 0).
- Grenade count (pips), grapple stamina (bar shown only below 0.995; "low" < 0.2), health (bar + integer; "low" style below 30%).
- Crosshair gap from weapon spread (13.3); crosshair hidden in ADS; katana mode: only top/bottom ticks, 16 px tall. Normal crosshair: four 3 × 12 px ticks at gap distance from centre plus a centre dot.
- Scope overlay (sniper, aim amount > 0.62): full-screen mask with a circular window of 60 vh diameter, ring, dashed cross lines, centre dot.
- Grapple reticle: dashed 30 px circle at centre; visible when a target is available; solid and shrunk to 65% when attached.
- Weapon name and hint on switch; damage-direction indicator (angle) on damage; messages/tips as listed in this document.
- Online: the grapple stamina is also shown on the side gauge labelled "GRAPPLE".

## 16. Interfaces with other subsystems

### 16.1 Consumed by the player from the game context

- **Camera**: the player owns the camera transform and FOV; the view-model rig is a child of the camera.
- **Physics world**: `makeBody(position, halfWidth 0.35, height, stepHeight 0.55)` → body record with position, velocity, half-width, height, step height, on-ground, hit-wall, hit-ceiling, wall normal, landing velocity, no-snap flag. `moveBody(body, dt)` integrates and fills the flags. `overlapsBody(body)`, `overlapsAABB(min, max)`, `raycast(origin, dir, maxDist, ignorePredicate)` → {distance, point, normal, box} or none, `hasLineOfSight(a, b)`. Box data flags read: "no grapple" (grapple ray ignores), "no shoot" (bullets pass through), "breakable" (bullet/katana hits break it).
- **Level**: start position; list of grapple ring points; list of grapple movers ({mesh with position, radius}); XZ bounds (for the shell's out-of-bounds check).
- **Enemies**: `raycast(origin, dir, maxDist)` → {enemy, part, distance, point}; `inArc(pos, dir, range, cosHalfAngle)` → sorted list of {enemy, distance}; `damage(enemy, amount, info{point, dir, part, source, crit, slashDir?})`; `yank(enemy, targetPoint)`; `blastEnemies(centre, radius, damage, except)`; `nearestVisible(...)` (used by the projectile system after a deflect); enumerable list of enemies with alive flag, state and centre; a difficulty damage multiplier applied on the enemy side.
- **Effects**: shared screen-shake amount (read/written by the camera); stroke bursts, sparks, boom, tracer, smoke, shell, bullet impact, blood.
- **Audio**: named one-shot events (jump, land(impact), footstep(volume), slide, dash, wall-jump, mantle, hurt, death, grapple fire/hit/release, reel loop on/off, winded, empty, switch weapon, reload/shell/cylinder/pump, per-gun fire sounds, ricochet, katana swing/hit, parry, perfect parry, explosion(pos), shell clink) and a listener update (eye position, right vector) each frame.
- **HUD**: weapon name/hint, crosshair mode, ADS flag, scope flag, grapple reticle state (0/1/2), tips, messages, damage direction.
- **Game**: `hitstop(duration, scale)`, `addScore(points, label)`, `onPlayerDeath()`, plus the focus-dash control of dash-lock, yaw, pitch and body position.
- **Game-shell callbacks (optional; online/level features)**: `targets()` → all player-like targets (local first); `canHurt(target)`; `raycastPlayers(origin, dir, maxDist)` → {player, part, distance, point}; `playersInArc(pos, dir, range, cosHalf)`; `hitPlayer(target, damage, info)`; `cutRopes(eye, dir, range)`; `breakHit(breakable, damage, point, dir)`; `breakablesInArc(pos, dir, range, cosHalf)`; `blastBreakables(centre, radius)`; `onShot(endPoint)`.

### 16.2 Provided by the player to others

- Fields read externally: eye, body centre, forward, right, body (position/velocity/on-ground), yaw, pitch, hp, max hp, alive, crouching, sliding, aiming, blocking, parry window, grapple state and hook position, weapon list/index/current weapon (name, hint, kind, is-gun, mag, reserve, mag size, reloading, spread px, aim amount, scope, ADS FOV, blocking, block time, cooldown), grenades, max grenades, grapple stamina, hurt/flash effects, speed, firing flag, team, name, last-hit-by / last-hit records (set by the shell), spawn-protection timer (set by the shell), dash-lock, gravity scale.
- Methods called externally: `update(dt)`, `reset(position)`, `idleCam(time)`, `takeDamage(amount, fromPos)`, `knockback(dir, amount)`, `tryDeflect(projectile{pos, vel})`, `tryBlockMelee(enemy)`, guard radius getter, `throwGrenade(remote{pos[3], vel[3]})`, `addAmmoAll(fraction)`, `switchTo(index, silent)`, `recoil(p, y)`, `kickFov(v)`, `lunge(speed)`, `detachGrapple(boost)`, `aimDir(spread)`, weapon-state builder (used by the shell to start focus slashes), `clearNades()`.
- Callback set by the shell: `onThrow({pos, vel})` for network grenade replication.
- **Network encoding** (by the players module, every 3rd frame in a match): [x, y, z (2 dp), yaw, pitch (2 dp), weapon index, flag bits (1 crouching, 2 sliding, 4 blocking, 8 aiming, 16 on ground, 32 firing, 64 alive, 128 grappling, 256 parry window), rounded hp, vel x/y/z (1 dp), and if grappling the hook x/y/z (1 dp)].
- Incoming network events handled via the player: "pdmg" (damage with source position, ignored during spawn protection), "nade" (remote grenade), "cut" (detach grapple, no boost, tip "your rope got cut", rumble 0.5/0.3/80 ms), "parry" (feedback only).


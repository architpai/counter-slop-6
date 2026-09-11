# Rendering Pipeline and Visual Effects Specification

This document describes WHAT the rendering and effects subsystem does, so that an implementer can rebuild identical gameplay-relevant visuals. 

Units: world units are metres. Times are seconds. Angles are radians unless stated. "rand(a, b)" means a uniform random real number in [a, b]. "randvec(x∈[a,b], y∈[c,d], z∈[e,f])" means a vector whose components are drawn independently from those ranges. "normalize" means scale to unit length. "damp(current, target, λ, dt)" means `current + (target − current) × (1 − e^(−λ·dt))`, an exponential approach with rate λ per second.

## Table of contents

1. [Overview of the frame](#1-overview-of-the-frame)
2. [Renderer, canvas and resize behaviour](#2-renderer-canvas-and-resize-behaviour)
3. [Scene and camera](#3-scene-and-camera)
   - 3.1 Camera parameters
   - 3.2 Camera placement relative to the player (gameplay camera)
   - 3.3 Field of view control
   - 3.4 Screen shake
   - 3.5 Idle (menu) camera
   - 3.6 First-person weapon rig
4. [Lighting](#4-lighting)
5. [Material system](#5-material-system)
   - 5.1 Material parameters
   - 5.2 Material categories and what uses them
   - 5.3 Per-instance override (instanced meshes)
   - 5.4 Hit flash (fill toggling)
6. [Two-pass render pipeline](#6-two-pass-render-pipeline)
   - 6.1 Pass 1: scene to attribute buffer
   - 6.2 Pass 2: full-screen composite
   - 6.3 Full-screen feedback overlays (gameplay-relevant)
7. [Effects system: pools, particles, decals, debris](#7-effects-system-pools-particles-decals-debris)
   - 7.1 Pools and capacities
   - 7.2 Particle model
   - 7.3 Particle simulation
   - 7.4 Particle drawing rules
   - 7.5 Decal placement
   - 7.6 Surface search for wrapping decals
   - 7.7 Splat clusters
   - 7.8 Growing pools (blood pools)
   - 7.9 Rigid debris (gibs, dropped parts, broken props)
   - 7.10 Clearing
8. [Effect recipes (every constant)](#8-effect-recipes-every-constant)
   - 8.1 Sparks
   - 8.2 Stroke burst
   - 8.3 Tracer
   - 8.4 Bullet impact
   - 8.5 Blood
   - 8.6 Drip
   - 8.7 Fountain (emitter)
   - 8.8 Shell casing
   - 8.9 Smoke
   - 8.10 Explosion (burst)
   - 8.11 Boom (grenade blast)
   - 8.12 Blood pool
   - 8.13 Boss stomp ring
9. [Muzzle flash](#9-muzzle-flash)
10. [Tracers, slash arcs and telegraphs](#10-tracers-slash-arcs-and-telegraphs)
11. [Death and dismemberment effects](#11-death-and-dismemberment-effects)
12. [HUD feedback: hit marker, damage indicator, low health](#12-hud-feedback-hit-marker-damage-indicator-low-health)
13. [Spawn trigger table](#13-spawn-trigger-table)
14. [Screen shake source table](#14-screen-shake-source-table)
15. [Interfaces with other subsystems](#15-interfaces-with-other-subsystems)

---

## 1. Overview of the frame

Each animation frame the game loop does the following, in this order (details of the loop itself belong to the game-loop spec; only what touches rendering is listed here):

1. Compute the raw frame time `dt`, clamped to a maximum of 0.05 s.
2. Compute a time scale: 1 normally; the hit-stop scale while a hit-stop is active; otherwise 0.26 while "focus" slow motion is active. `sdt = dt × scale`.
3. While playing (state "play" or "dying"): update the player (which places the camera), the enemies, the effects system with `sdt`, and pickups.
4. While not playing (menus, dead screen, lobby, game over): the idle camera is placed, and the effects system is updated with the raw `dt`.
5. Level decoration animations are updated with the game clock.
6. HUD values are pushed.
7. The renderer is asked to render with the game clock and a small set of full-screen feedback intensities (see 6.3).

The game clock advances by `sdt` while playing and by `dt` otherwise. Everything time-based inside the renderer (the low-health pulse) uses this game clock, so it slows during slow motion.

## 2. Renderer, canvas and resize behaviour

- One full-window canvas, fixed to the viewport, covers the whole page. A DOM HUD layer sits above it (pointer-events disabled).
- The 3D renderer is created with antialiasing OFF, no stencil buffer, "high performance" power preference, linear output colour space, and automatic clearing OFF (the pipeline clears manually).
- Pixel ratio = min(device pixel ratio, 1.5). This is fixed at start-up.
- On start and on every window resize:
  - CSS size = window inner width × inner height (each at least 2 px).
  - Render buffer size = floor(width × pixelRatio) × floor(height × pixelRatio). The off-screen attribute buffer (section 6.1) is resized to the same.
  - Camera aspect = width / height; the projection matrix is rebuilt.
  - The composite pass receives the render buffer resolution, the aspect, and a "ruled line spacing" of renderHeight / 13.5 pixels (cosmetic only).
- There is no render-scale option; resolution always follows the window.

## 3. Scene and camera

### 3.1 Camera parameters

| Parameter | Value |
|---|---|
| Projection | perspective |
| Initial vertical FOV | 80° (immediately overridden by the player controller, see 3.3) |
| Near plane | 0.08 |
| Far plane | 420 |
| Aspect | window width / height |
| Rotation order | yaw (Y) → pitch (X) → roll (Z) ("YXZ") |

The camera is a child of the scene. The first-person weapon rig is a child of the camera (section 3.6), so weapons ride with the camera automatically.

### 3.2 Camera placement relative to the player (gameplay camera)

Every player update ends with a camera placement step. Definitions:

- `body.pos` = the bottom-centre of the player's collision box; `body.height` = 1.75 standing, 1.05 crouching.
- Eye height target: 1.6 standing, 0.88 crouching. The current eye height approaches the target with `damp(eyeH, target, 14, dt)` while alive; it freezes when dead.
- Four scalar damped springs (stiffness k, damping d; velocity kicks add to velocity; sub-stepped 3× when dt > 0.02 s):
  - recoil pitch: k = 190, d = 17
  - recoil yaw: k = 190, d = 17
  - FOV kick: k = 220, d = 14
  - land dip: k = 170, d = 15
- Head bob: `bobAmt` approaches (moving ? clamp(horizontalSpeed / 7, 0.3, 1.4) : 0) with λ = 8. While moving, `bobPhase += dt × (7 + 0.5 × horizontalSpeed)`.
  - `bobY = |sin(bobPhase)| × 0.03 × bobAmt`
  - `bobX = cos(bobPhase × 0.5) × 0.018 × bobAmt`
- Roll: while alive, `roll = damp(roll, −strafeInput × 0.022 + (sliding ? −0.08 : 0), 9, dt)`. Wall jumps add ±0.1 instantly (sign opposite the wall side); air dashes add `(dashDir · right) × 0.08`.

Placement:

- `eye = (body.pos.x, body.pos.y + eyeH + landDip.value × 0.07 + bobY, body.pos.z)`
- `center = (body.pos.x, body.pos.y + body.height × 0.55, body.pos.z)` (used by effects as the torso point)
- `camera.position = eye + right × (bobX + shakeOffsetX) + (0, shakeOffsetY, 0)` (shake offsets in 3.4)
- `camera.rotation = (pitch + recoilPitch.value + shakePitch, yaw + recoilYaw.value + shakeYaw, roll + sin(bobPhase × 0.5) × 0.004 × bobAmt)`

Recoil input from weapons: `recoil(p, y)` sets `pitch = clamp(pitch + p × 0.55, −1.5, 1.5)`, kicks the recoil-pitch spring velocity by `p × 22` and the recoil-yaw spring velocity by `y × 30`. Per-gun `p` and `y` values are in the weapons spec (rifle 0.011/0.004, shotgun 0.05/0.012, sniper 0.055/0.008, revolver 0.038/0.007; `p` is multiplied by 0.7 when aiming and gets `+ rand(0, 0.3 × p)`; `y` is `rand(−y, y)`).

Land dip: on landing, the spring is kicked by `−impact × 6 − 0.5` where `impact = clamp(−landingVerticalSpeed / 14, 0, 1.5)`; jumps kick it by −1.2 to −1.5, slides and mantles by −2.5.

### 3.3 Field of view control

Target vertical FOV each frame (degrees):

```
fov = 82
    + clamp((speed3D − 7) / 16, 0, 1) × 8
    + (sprinting ? 3 : 0)
    + (sliding ? 4 : 0)
    + (grapple attached ? 3 : 0)
    + fovKickSpring.value
```

If the player is aiming, the target is instead the weapon's aim FOV: rifle 58, shotgun 68, sniper 20, revolver 52 (view-model default 60). The displayed FOV approaches the target with λ = 16 while aiming, λ = 8 otherwise. The projection matrix is rebuilt only when the FOV changes by more than 0.01°.

`kickFov(v)` adds `v × 30` to the FOV-kick spring velocity. Sources: gun fire (rifle 1.2, shotgun 4, sniper 4.5, revolver 2.5), air dash 4, lunge 3, wall jump 2, double jump 1.6, slide 2.5, mantle 1.5, grapple launch 3, katana slash 2, focus dash start 5, focus execution 6.

### 3.4 Screen shake

The effects system holds one scalar shake accumulator. Any subsystem adds to it (table in section 14). During the camera placement step:

1. `s = accumulator` (read before decay), then `accumulator = damp(accumulator, 0, 7, dt)` (i.e. multiplied by e^(−7·dt)).
2. `shk = min(s, 1.2)`.
3. Position offsets: `shakeOffsetX = (rand − 0.5) × shk × 0.07` along the camera right vector; `shakeOffsetY = (rand − 0.5) × shk × 0.07` vertical (so ±0.035 × shk metres).
4. Rotation offsets: `shakePitch = (rand − 0.5) × shk × 0.035`, `shakeYaw = (rand − 0.5) × shk × 0.035` (so ±0.0175 × shk radians).

Fresh random numbers every frame (white-noise jitter, no smoothing). The accumulator is not cleared on death or reset; it decays naturally.

### 3.5 Idle (menu) camera

Used in the start, dead, lobby and game-over states, with `t` = game clock:

- Position = `(sin(0.08 t) × 70, 30 + sin(0.23 t) × 4, cos(0.08 t) × 70)` — a slow orbit of radius 70 at height 30 ± 4.
- Looks at `(0, 10, 0)`.
- FOV forced to 70°.
- The weapon rig is hidden. The player's eye, center and forward vectors are set from the camera so audio listener and effects still work.

### 3.6 First-person weapon rig

- A group ("rig") is a child of the camera with unit scale (1, 1, 1). Each weapon's root is a child of the rig. Only the equipped weapon's root is visible.
- Every weapon root is uniformly scaled by 0.46.
- Rest position (camera space, metres) per weapon: rifle (0.2, −0.17, −0.36); shotgun (0.2, −0.19, −0.34); revolver (0.19, −0.2, −0.3); sniper (0.21, −0.19, −0.36); katana (0.27, −0.25, −0.4) with rest rotation (0.75, 0.15, −0.35) and a block pose at (0.21, −0.31, −0.36) rotation (1.40, 0.30, 1.24).
- Aim position for guns is derived from a per-gun "sight" tuple (x, y, z, dist): `aimPos = (−x × 0.46, −y × 0.46, −z × 0.46 − dist)`. Sight tuples: rifle (0, 0.12, −0.05, 0.3); shotgun (0, 0.095, −1.0, 0.52); sniper (0, 0.135, 0, 0.42); revolver (0, 0.08, −0.34, 0.42). Katana aim position = its rest position.
- The rig is hidden when the sniper is at least 80% into its aim blend (the scope overlay in the HUD takes over).
- View-model motion (sway, bob, recoil springs k = 260/d = 18 for position, k = 220/d = 16 for rotation, equip rise of 0.32 m and 0.9 rad over 1/3.2 s, sprint offsets, land dip) is specified in the weapons/player spec; from the rendering side the only requirement is that the rig is drawn with depth so it appears in front of the world, and that it is treated as "near" (camera distance < 2) by the composite pass (section 6.2).

## 4. Lighting

- There is exactly one light: a fixed directional light with world-space direction `normalize(0.38, 0.82, 0.42)` (pointing from the surface toward the light: up, slightly toward +x/+z).
- No shadows, no point lights, no ambient term, no fog colour.
- Each frame the light direction is transformed into view space with the camera's inverse world matrix and given to all materials.
- Shading input per pixel: `ndl = dot(n, L) × 0.5 + 0.5` (half-Lambert; `n` is the view-space normal, flipped on back faces).
- Per-material shade: `shade = clamp(ndl × shadeScale + shadeBias, 0, 1)`. Fill materials force `shade = −1` (meaning "solid"). Shade 1 = fully lit, 0 = fully dark. The composite pass (section 6) converts shade into whatever tonal rendering the new art style wants; the design converts it into hatching density.
- Distance fade: surface tone fades to 28% strength between camera distance 14 and 110; outlines fade to 45% strength between 30 and 220 (smoothstep). This is an atmospheric-perspective effect and should be kept in some form so far geometry reads lighter.

## 5. Material system

All 3D objects use one custom material type ("tone material"). It does not output colour directly; it outputs attributes consumed by the composite pass.

### 5.1 Material parameters

| Parameter | Default | Meaning |
|---|---|---|
| tone | 0 (blue) | Colour index 0–5 (see table below) |
| fill | false | true = solid silhouette of the tone, unshaded |
| shadeScale | 1 | Multiplier on the half-Lambert term |
| shadeBias | 0 | Added to the shaded term |
| side | front | front-only or double-sided |

Colour indices (gameplay meaning):

| Index | Name | Gameplay meaning |
|---|---|---|
| 0 | BLUE | Default world/ally colour; player tracers, sparks of the player's own actions, bullet holes, player gear |
| 1 | RED | Enemy colour; blood, enemy projectiles, enemy laser telegraph, enemy sword arcs, katana blood smears, remote player hit tracers |
| 2 | BLACK | "Heavy" enemies and bosses; soot, smoke rings, explosions, gun barrels and dark parts |
| 3 | ORANGE | Muzzle flash, sparks, shell casings, grenade fire, spark of a parry |
| 4 | GREEN | Health pickups; cactus "blood" |
| 5 | PINK | Boss tone attacks; piñata burst |

### 5.2 Material categories and what uses them

1. **Shaded outline** (fill false, shadeScale 1, shadeBias 0): all static level geometry (merged per colour index), drones, grapple hook, grenade body, pickup bodies, weapon view-model bodies (blue) and barrels (black), enemy laser holder, the player's rope hook.
2. **Unshaded outline / always lit** (fill false, shadeScale 0, shadeBias 1 → shade = 1): all enemy body meshes, all remote player body meshes, the level's NPC figures, the boss's hammer (orange) and hitbox (pink). These read as plain outlines with no tone, so silhouettes stay readable.
3. **Darkened outline** (fill false, shadeScale 1, shadeBias −0.3): the player's grapple rope only.
4. **Fill / solid** (fill true): all particles (unless the particle explicitly asks for outline), all decals, the muzzle flash stars (orange, double-sided), enemy projectiles (red, per-instance colour), the enemy laser telegraph (red), enemy/remote "solid" parts (black; or red for black-tone enemies; double-sided), red sights and the revolver front sight, the katana blood smears (red, double-sided), the remote player's name-tag flag (their tone, double-sided), the grapple's landing marker ring parts, and enemy spark ornaments.

### 5.3 Per-instance override (instanced meshes)

Instanced meshes carry a per-instance 3-component colour attribute that is NOT a colour: component 0 = tone index, component 1 = fill flag (≥ 0.5 means solid), component 2 unused. When present, it overrides the material's tone and fill for that instance. All effect pools (drops, strokes, splats, holes) and the enemy projectile mesh use this. A non-instanced mesh uses the material values.

### 5.4 Hit flash (fill toggling)

A body flashes by switching its outline material to fill mode (solid tone) and back:

- Enemy takes damage (not on shield): fill ON for 0.07 s.
- Remote player takes a hit (from this client's shot, or reported): fill ON for 0.08 s.
- Bomber enemy while its fuse is burning: fill ON, re-armed every frame with a 0.02 s timer, so it stays solid until it explodes.
- Enemies also "flinch" (animation) at the same time — enemies spec.

## 6. Two-pass render pipeline

### 6.1 Pass 1: scene to attribute buffer

- Target: an off-screen colour buffer at render resolution, 4 channels, 16-bit float, nearest filtering, no mipmaps, plus a 32-bit float depth texture. No stencil.
- Cleared every frame to colour (1, 0, 0, 0) and depth 1. Because of the channel meanings this means "fully lit, blue, flat normal".
- Every tone material writes: channel 0 = shade (−1 for fill), channel 1 = tone index, channels 2–3 = view-space normal x and y.
- The whole scene (world, characters, particles, decals, weapon rig) is rendered once with the gameplay camera. Depth test normal. No transparency anywhere; everything is opaque.
- "Sky" = any pixel whose depth is ≥ 0.99999 (nothing drawn). The sky shows the plain background.

### 6.2 Pass 2: full-screen composite

A full-screen quad (orthographic, depth test off) reads the attribute buffer and the depth texture and produces the final image. Inputs each frame: game clock, near and far planes, inverse projection matrix, camera world matrix, render resolution, aspect, and the four feedback intensities (6.3). Steps in the design, in order:

1. Screen-space jitter of the sample position (look only).
2. **Outline detection** from depth: linearise depth, compute the second difference of 1/depth across ±1.15 px (scaled by renderHeight/900) horizontally and vertically, normalise by 1/depth, and smoothstep 0.07→0.30. Because 1/depth is affine across any plane this only fires on true silhouettes. Also a normal-difference term: length of the normal.xy difference across the same offsets, summed, smoothstep 0.42→0.85. Edge = max of the two. The outline takes the colour of the nearest of the five samples.
3. **Tone** from the shade channel . The important thresholds are: a fill pixel (shade < 0) is fully painted; otherwise tone appears progressively below shade 0.64, 0.42, 0.24 and 0.12 (ever darker bands). Surfaces closer than 2 m (the weapon rig) use a screen-anchored pattern; others use a world-anchored pattern with distance-stepped density. (All look-only; see section 16.)
4. Distance fades from section 4.
5. Background .
6. Composite: background → tone (0.72 strength × fade) → outline (0.75–1.1 random per-pixel weight × edge fade).
7. Feedback overlays (6.3).

An implementer replacing the style must keep steps 2 and 3 as "outline + tone from shade" in whatever form, and MUST keep step 7 exactly.

### 6.3 Full-screen feedback overlays (gameplay-relevant)

The renderer receives four intensities each frame:

| Intensity | Source value | Behaviour |
|---|---|---|
| hurt | player's the player's hurt intensity | `hurtIntensity = min(1, hurtIntensity + damage / 40)` on each damage event; decays with `damp(hurtIntensity, 0, 3, dt)` |
| lowHp | `1 − hp / 30` when alive and hp < 30, else 0 | Steady, from the HP value |
| flash | player's the player's flash intensity | Set to 0.35 on a perfect parry, 0.1 on a normal parry; decays with `damp(flashIntensity, 0, 10, dt)` |
| slow | 1 if the frame's time scale < 1 (hit-stop or focus), else 0 | Binary |

Applied in this order to the composited colour `col`:

1. **Hurt vignette.** `vig = smoothstep(0.32, 0.9, |(uv − 0.5) × (aspect, 1)|)` (0 at centre, 1 in the corners). A sketch modulation `scr` in [0.55, 1] varies across the screen . `hurt = clamp(hurtIn + lowHp × (0.35 + 0.25 × sin(6 × time)), 0, 1)`. `col = mix(col, RED × 0.9, hurt × vig × scr)`. So low health produces a pulsing red vignette at ~0.95 Hz whose strength grows as HP falls below 30, and each hit adds a red flash of the edges that fades in about a second.
2. **Parry flash.** `col = mix(col, backgroundColour, flash)` — a whiteout toward the background.
3. **Slow-motion tint.** `lum = 0.3 R + 0.5 G + 0.2 B`; `col = mix(col, lum × (0.8, 0.86, 1.0), slow × 0.55)` — 55% desaturation with a cool tint while time is slowed.

Output is opaque.

## 7. Effects system: pools, particles, decals, debris

One effects object owns everything below. It is created with the scene and the collision world and is updated once per frame with the (possibly time-scaled) `dt`.

### 7.1 Pools and capacities

Each pool is one instanced mesh with frustum culling disabled, dynamic instance matrices and per-instance tone/fill (5.3). All pool materials are red fill by default (overridden per instance).

| Pool | Base shape (before scaling) | Capacity | Sides | Behaviour when full |
|---|---|---|---|---|
| drops | sphere-like polyhedron, radius 0.5 (diameter 1) | 700 | front | extra live particles are not drawn that frame |
| strokes | unit cube (1 × 1 × 1) | 600 | front | extra live particles are not drawn that frame |
| splats | 5 pools, each a distinct blob shape ≈ 1 unit across with 3–5 satellite dots (7.5) | 300 each | double | ring buffer: the oldest decal is overwritten |
| holes | flat disc, diameter 1, 8 segments | 260 | double | ring buffer: the oldest hole is overwritten |

Drops and strokes are rebuilt from the live particle list every frame; decals persist in place until overwritten or cleared.

### 7.2 Particle model

A particle has: kind (drop, stroke or emitter), position, velocity (may be absent for fixed tracers), life remaining, max life, size, tone, fill flag, gravity, drag, collision mode (none or "decal"), stretch factor, fixed length, fixed axis, decal size multiplier, shrink flag, emit rate, emit accumulator, grow factor.

Defaults when a recipe does not specify: life 1, size 0.05, RED, fill true, gravity 20, drag 0, no collision, stretch 0.03, fixed length 0, no axis, decal size multiplier 3, shrink true, rate 0, grow 0.

### 7.3 Particle simulation

Per frame, for every particle:

1. `life −= dt`; remove if ≤ 0.
2. Emitters: `acc += dt × rate`; while `acc ≥ 1`: `acc −= 1` and spawn one drop at the emitter position with velocity `emitDir × rand(2, 5) + randvec(±1, ±1, ±1) × 1.2`, size rand(0.02, 0.05), life rand(1, 2), the emitter's tone, collision "decal", gravity 22, decal size 6. Emitters do not move.
3. Moving particles: `vel.y −= gravity × dt`; if drag > 0, `vel *= max(0, 1 − drag × dt)`; `pos += vel × dt`.
4. Collision (only if collision mode is set): cast a ray from the previous position along the movement direction with length `moved + size × 0.5` against the world, ignoring boxes flagged "no-shoot" (see-through). On a hit with mode "decal": place a splat cluster (7.7) at the hit point with the hit normal, the particle's tone, size `particle.size × decalSize × 0.75`, streak direction = movement direction, cluster count 2 if size > 0.035 else 1; then remove the particle.
5. Remove any moving particle whose y < −10.

### 7.4 Particle drawing rules

Let `frac = life / maxLife` (1 at birth, 0 at death).

- **Drop**: uniform scale `s = size × f` where `f = lerp(1, grow, 1 − frac)` if grow > 0; else `0.4 + 0.6 × frac` if shrink; else 1. No rotation. Diameter on screen = s (the base shape is 1 unit across).
- **Stroke**: an elongated box aligned to a direction. If a fixed length is set (tracers), direction = fixed axis and length = fixed length. Otherwise direction = velocity direction and `length = clamp(speed × stretch, size × 2, 1.6)`; a stationary stroke points up with length = size. Width `w = size × (shrink ? 0.5 + 0.5 × frac : 1)`. Scale = (w, length, w) with the box's Y axis rotated onto the direction; positioned at the particle position (the stroke is centred on it).
- Fill flag and tone are copied per instance.

### 7.5 Decal placement

`decal(point, normal, tone, size, kind, streakDir, stretch)`:

- Pool: "hole" kind → holes pool; otherwise one of the five splat pools chosen at random.
- Position = point + normal × rand(0.012, 0.03) (lifted off the surface).
- If a streak direction is given and its component in the surface plane is non-negligible: orient the decal's long (Y) axis along that in-plane direction, and scale = (size × rand(0.6, 0.85), size × stretch × rand(0.9, 1.5), 1). Default stretch = 1.
- Otherwise: face the normal, spin by a random angle about the normal, scale = (size, size × rand(0.7, 1.3), 1).
- Splat shape (any 2D blob will do; the design is a 20-point closed outline with base radius 0.42–0.52, three long "fingers" and 3–5 satellite dots of radius 0.045–0.095 placed at 0.6–0.82 from the centre; five seeds give five shapes). Hole shape: a disc.

### 7.6 Surface search for wrapping decals

`surfaceAt(point, normal, offset)` finds the surface a secondary mark should sit on so that clusters wrap over edges:

1. `c = point + offset`. Cast from `c + normal × 0.35` along `−normal` up to 2.2 units (ignoring see-through boxes). If hit, use it.
2. Otherwise, if `|offset| > 0.0001`: cast from `c + normal × 0.05` along `−offset/|offset|` for `|offset| + 0.3`. Return that hit or nothing.

### 7.7 Splat clusters

`splat(point, normal, tone, size, streakDir, cluster = 3)`:

1. Main mark: decal at the point, size `size × rand(0.55, 0.8)`, streak direction as given.
2. Build a tangent basis on the surface. For `cluster` times: pick angle rand(0, 2π), radius `size × rand(0.3, 1.15)`; offset in the tangent plane; if a streak direction exists add `streakDir × size × rand(0, 0.7)`. Find the surface with 7.6; if found, decal there with size `size × rand(0.2, 0.5)` and the streak direction.
3. If the surface is a wall (`|normal.y| < 0.55`) and with 75% chance: offset straight down by `size × rand(0.5, 1.3)`; find the surface; if found, decal with size `size × rand(0.16, 0.3)`, streak direction = down, stretch = rand(2.5, 5) (a run-down drip).

### 7.8 Growing pools (blood pools)

`bloodPool(pos, size = 1.3, tone = RED)`:

1. Cast down from `pos + (0, 0.5, 0)` up to 5 units (ignoring see-through). No hit → nothing.
2. Three marks: the first at the hit point; the other two offset in the floor plane by radius `size × rand(0.15, 0.5)` at a random angle, each resolved with 7.6 (skipped if no surface).
3. Each mark takes a random splat pool slot, faces the surface normal with a random spin, is lifted `rand(0.02, 0.04)` off the surface, and grows from scale 0 to its final size over duration `rand(0.5, 1.1)` with easing `e = 1 − (1 − f)²`. Final size = `size × rand(0.75, 1)` for the first mark, `size × rand(0.3, 0.6)` for the others.
4. Growing marks are advanced every frame and removed from the growing list when complete (the decal stays).

### 7.9 Rigid debris (gibs, dropped parts, broken props)

`debris(mesh, pos, vel, angVel, {life = 10, radius = 0.18, blood = false})` re-parents an existing mesh into the scene at world position `pos` and simulates it:

- Cap: 70 debris objects; adding a 71st removes the oldest from the scene immediately.
- A counter of "bloody gibs alive" is maintained (incremented on add if blood, decremented on removal).
- Per frame while not at rest:
  - `vel.y −= 20 × dt`; move by `vel × dt`.
  - Cast from the previous position along the motion for `moved + radius` against the world (NOT ignoring see-through boxes). On hit: snap to `hit.point + normal × radius`; if moving into the surface (`vn = vel · normal < 0`): `vel += normal × (−1.35 × vn)` (bounce with 35% extra), then `vel *= 0.55`, `angVel *= 0.5`. Bounce counter increments. If bloody and this is one of the first 3 bounces: splat at the hit with RED, size rand(0.4, 0.85), no streak, cluster 2. If `|vel| < 1` and the surface is floor-like (`normal.y > 0.5`): come to rest (velocity zeroed, no further motion).
  - Rotation integrates angular velocity per axis (Euler).
  - If bloody and `|vel|² > 3`: every 0.05 s spawn a trailing drop with velocity `vel × 0.3 + randvec(±1, ±1, ±1)`, size rand(0.02, 0.045), life 1.5, RED, collision "decal", gravity 22, decal size 6.
  - If y < −8: life set to 0.
- `life −= dt` always (also at rest). During the last 0.6 s the mesh scale shrinks linearly to 0.001 × its base scale. At life ≤ 0 the mesh is removed from the scene.

### 7.10 Clearing

`clear()` empties the particle list, the growing list, removes all debris meshes from the scene, and resets all pools (count 0, ring index 0). Called on new game / wave jump. The shake accumulator is NOT reset.

## 8. Effect recipes (every constant)

All spawn positions are copied at spawn time. "Random unit direction" = normalize(randvec(±1, ±1, ±1)) unless a component range is given, in which case the given ranges are used before normalising.

### 8.1 Sparks

`sparks(point, normal, tone = BLUE, n = 6, speed = 7)`. For each of `n`:
- direction = random unit direction, flipped if it points into the surface (dot with normal < 0), then `+ normal × 0.6`, normalised, × rand(0.4 × speed, speed).
- Stroke; size rand(0.012, 0.025); life rand(0.15, 0.35); gravity 14; stretch 0.035; no collision; fill; shrink.

### 8.2 Stroke burst

`strokeBurst(pos, tone, n = 16, speed = 6, options)`. For each of `n`:
- velocity = random unit direction × rand(0.3 × speed, speed).
- Stroke; size = options.size or rand(0.02, 0.04); life = options.life or rand(0.25, 0.5); gravity = options.gravity or 0; stretch = options.stretch or 0.05; drag = options.drag or 3; no collision; fill; shrink.

### 8.3 Tracer

`tracer(from, to, tone = BLUE, thick = 0.022, life = 0.06)`:
- Ignored if the segment is shorter than 0.05.
- One stroke centred at the midpoint, fixed axis = segment direction, fixed length = segment length, width = thick, no velocity, no gravity, no shrink (constant width and length for its whole life), fill.

### 8.4 Bullet impact

`bulletImpact(point, normal, tone = BLUE)`: one hole decal (diameter rand(0.06, 0.1)) + sparks(point, normal, tone, 5) at default speed 7.

### 8.5 Blood

`blood(pos, dir, amount = 1, {tone = RED})` — `dir` is the direction the shot was travelling. Three groups:

1. Heavy drops, count = round(14 × amount): velocity `dir × rand(1, 6) + randvec(x ±1, y ∈ [−0.5, 1.2], z ±1) × rand(1, 4.5)`; drop; size rand(0.02, 0.065); life rand(1.2, 2.6); collision decal; gravity 22; decal size rand(4, 8).
2. Fast streaks, count = round(7 × amount): velocity `dir × rand(6, 15) + randvec(x ±1, y ∈ [−0.3, 1], z ±1) × rand(1, 4)`; stroke; size rand(0.02, 0.04); life rand(0.3, 0.6); collision decal; gravity 12; stretch 0.05; decal size 5.
3. Mist, count = round(6 × amount): velocity `randvec(x ±1, y ∈ [−0.2, 1], z ±1) × rand(0.5, 2.5) + dir × rand(0, 2)`; drop; size rand(0.012, 0.03); life rand(0.3, 0.7); no collision; gravity 6; drag 2.

### 8.6 Drip

`drip(pos, amount = 1)`: one drop, velocity randvec(x ±0.3, y ∈ [−0.4, 0.2], z ±0.3); size rand(0.018, 0.03) + 0.02 × amount; life rand(1, 1.8); RED; collision decal; gravity 20; decal size 5. (Defined but not called anywhere in the design.)

### 8.7 Fountain (emitter)

`fountain(pos, dir, dur = 0.8, tone = RED)`: an emitter particle at `pos` with life `dur`, emit direction `dir`, rate 40 drops per second; each drop as in 7.3 step 2.

### 8.8 Shell casing

`shell(pos, vel, tone = ORANGE, size = 0.02)`: one stroke; life rand(0.9, 1.4); gravity 22; stretch 0.012; drag 0.5; no collision; no shrink; length follows velocity (`clamp(speed × 0.012, 2 × size, 1.6)`), so it tumbles as a short dash. Casings pass through geometry.

Eject velocity (from the gun's eject point, world space): `right × rand(1.5, 2.5) × spread + forward × rand(−0.5, 0.5) + (0, rand(1.5, 2.8), 0)`, where spread = 1 on firing and 0.7 during the sniper's rack (which ejects 6 at once). Per-gun casing (size, tone): rifle (0.02, ORANGE); shotgun (0.035, RED); sniper (0.03, ORANGE); revolver none. Shotgun casings eject on the pump, not on fire.

### 8.9 Smoke

`smoke(pos, dir, n = 3)`. For each: velocity `dir × rand(0.6, 1.8) + randvec(x ±0.5, y ∈ [0.6, 1.4], z ±0.5)`; drop; size rand(0.04, 0.07); life rand(0.45, 0.8); BLUE; **outline (fill false)**; gravity −1.2 (rises); drag 3; grow 3.2; no shrink. Reads as small hollow rings that expand ×3.2 while rising.

### 8.10 Explosion (burst)

`explosion(pos, radius = 4, tone = BLACK)`:

1. 40 drops: direction randvec(x ±1, y ∈ [−0.2, 1], z ±1) normalised × rand(4, 14); size rand(0.03, 0.1); life rand(1, 2); tone; collision decal; gravity 20; decal size rand(3, 6).
2. 26 strokes: direction randvec(x ±1, y ∈ [−0.3, 1], z ±1) normalised × rand(10, 22); size rand(0.03, 0.06); life rand(0.2, 0.45); every 3rd is ORANGE, others the given tone; gravity 6; stretch 0.05; no collision.
3. 8 smoke rings: velocity randvec(x ±1, y ∈ [0.5, 1.5], z ±1) × rand(1, 3); drop; size rand(0.12, 0.25); life rand(0.7, 1.2); BLUE outline; gravity −1.5; drag 2.5; grow 3; no shrink.
4. bloodPool(pos, radius × 0.9, tone).
5. Shake += 0.5.

Note: `radius` only affects the pool; particle speeds are fixed.

### 8.11 Boom (grenade blast)

`boom(pos, radius = 5)`, `k = radius / 5`:

1. Fireball core, 4 drops: direction randvec(x ±1, y ∈ [0.2, 1], z ±1) normalised × rand(0.3, 1.6); size rand(2.2, 3.2) × k; life rand(0.3, 0.45); ORANGE fill; gravity −2; drag 3; grow 3.2; no shrink. (These balloon to ~7–10 m.)
2. Fireball cloud, 26 drops: direction randvec(x ±1, y ∈ [−0.3, 1], z ±1) normalised × rand(2, 8); size rand(0.9, 1.9) × k; life rand(0.35, 0.6); every 5th BLACK, others ORANGE; fill; gravity −3; drag 4; grow 2.8; no shrink.
3. Thrown strokes, 64: direction randvec(x ±1, y ∈ [−0.15, 0.9], z ±1) normalised × rand(14, 34) × k; size rand(0.09, 0.2) × k; life rand(0.3, 0.55); every 4th BLACK, others ORANGE; gravity 8; stretch 0.09; drag 2; no collision.
4. Soot, 30 drops: direction randvec(x ±1, y ∈ [0.2, 1], z ±1) normalised × rand(3, 10) × k; size rand(0.06, 0.14); life rand(0.8, 1.6); BLACK; collision decal; gravity 16; decal size rand(3, 7) × k.
5. Smoke column, 18 drops: velocity randvec(x ±1, y ∈ [0.8, 2.0], z ±1) × rand(1.2, 3.4); size rand(0.35, 0.7) × k; life rand(1.0, 1.8); BLACK outline; gravity −2; drag 2.2; grow 3.6; no shrink.
6. bloodPool(pos, radius × 0.8, BLACK) (scorch).
7. Shake += 0.8.

### 8.12 Blood pool

See 7.8.

### 8.13 Boss stomp ring

On the boss's stomp landing (enemies spec), besides `explosion(footPos + (0, 0.2, 0), 7, BLACK)` and shake 0.9, 24 strokes are spawned directly on a ring of radius 3 around the boss's feet at height +0.3, evenly spaced by angle, each with velocity `(cos a × 14, 2, sin a × 14)`, size 0.06, life 0.4, BLACK, gravity 4, stretch 0.06, drag 3.

## 9. Muzzle flash

Two parts happen on every gun shot (player's guns only):

1. **Flash mesh**: a group of three flat star shapes, ORANGE fill, double-sided, parented to the gun model at the muzzle point: a 7-point star (outer radius 0.16, inner 0.06) facing the barrel axis, a 5-point star (0.11 / 0.04) rotated 90° about Y, and a 5-point star (0.10 / 0.04) rotated 90° about X — so it reads as a spiky burst from any angle. All radii are in gun-model units (multiplied by the weapon-root scale 0.46 on screen). Per shot: visible for 0.045 s, random roll about the barrel axis, uniform scale = `flashScale × rand(0.8, 1.4)`. Per-gun flashScale: rifle 1, shotgun 1.9, sniper 1.7, revolver 1.35. Muzzle point (gun-model space): rifle (0, 0.02, −0.98); shotgun (0, 0.05, −1.09); revolver (0, 0.035, −0.4); sniper (0, 0.02, −1.6).
2. **Burst particles** at the muzzle's world position: strokeBurst with count `4 + pellets` (rifle 5, shotgun 14, sniper 5, revolver 5), speed `6 × flashScale`, life 0.08, size 0.03, gravity 0, drag 8, ORANGE; plus smoke(muzzle, player forward, 5 for shotgun else 2).

Also on every shot: camera recoil and FOV kick (3.2/3.3), shake += `0.02 + fovKick × 0.02`, and a shell eject for guns with casings except the shotgun.

Enemy gunfire flashes are particles only: 4 ORANGE strokes, speed 4, life 0.07, size 0.03 at the enemy muzzle; enemy shotgun 8 strokes, speed 5, life 0.1, size 0.04.

## 10. Tracers, slash arcs and telegraphs

| Effect | From → to | Tone | Thickness | Life |
|---|---|---|---|---|
| Player hitscan shot (each pellet) | gun muzzle world position → hit point (or 300 m along the ray if nothing hit) | BLUE | rifle 0.02, shotgun 0.014, sniper 0.03, revolver 0.026 | 0.05 |
| Remote player's shots (network) | remote gun point = `body.pos + right × 0.3 + forward × 0.8 + (0, 1.35 + forward.y × 0.8, 0)` → each reported end point | BLUE | by weapon kind: rifle 0.02, shotgun 0.014, sniper 0.03, else 0.02 | 0.06 |
| Katana slash arc | 9 segments; for i = 0..8 with `a = (−1.1 + 2.2 i / 8) × s`, `b = a + 0.12 s` (s = +1 or −1 alternating each combo swing): point(θ) = `eye + forward × 1.3 + right × cos θ × 0.9 × s + up × (sin θ × 0.55 − 0.1)`; segment from point(a) to point(b) | BLUE | 0.03 − 0.002 i | 0.12 + 0.01 i |
| Enemy sword swing telegraph | 5 segments on a horizontal arc of radius 1.5 around the enemy centre: angles `yaw + (−0.9 + 0.45 i)` to `+0.45`, heights `+0.5 − 0.18 i` to `+0.5 − 0.18 (i+1)` | RED | 0.025 | 0.16 |
| Focus dash trail | every 0.02 s: from the last trail point → player centre (then trail point = centre) plus strokeBurst(centre, BLUE, 2, 5, life 0.22, size 0.03) | BLUE | 0.045 | 0.28 |
| Returned bullet (PvP blade deflect back at you) | hit point → your eye | RED | 0.03 | 0.08 |

**Enemy laser telegraph** (sniper-type enemies while charging): a solid RED cylinder mesh (5 segments, frustum culling off) from the enemy's muzzle toward the aim point, stopped 1.6 m short of the aim point; hidden if the distance is under 2 m; thickness (radius scale) = `0.006 + 0.012 × charge²` where charge ∈ [0, 1]. Removed on the enemy's death.

**Enemy projectiles**: an instanced mesh of unit cubes (cap 240, RED fill by default, per-instance tone — turns BLUE when deflected) stretched along their velocity; their sizes are in the enemies spec.

## 11. Death and dismemberment effects

Gibs use `debris()` (7.9) on the character's actual body-part groups, re-parented to the scene at their world transform, with `blood = true` so they bleed and splat as they bounce.

**Enemy death** (host side; enemies spec owns the decision logic, listed here for the visuals):
- Flying enemy: whole body as one debris (velocity `dir × 4 + randvec(±2, 1, ±2)`, angular randvec(±9, ±9, ±9), radius 0.5, life 8) + blood(centre, dir, 1).
- Ground enemy, "overkill" cases (negative HP beyond 35% of max, katana, headshot, deflect or blast kill): detach parts with velocity `dir × rand(3, 7) + extra + (0, rand(2, 5), 0)`, angular randvec(±8, ±8, ±8), life rand(7, 10):
  - Head (radius 0.25, extra randvec(±2, 3, ±2)) on crit, or 35% chance on katana/focus kills; plus a fountain at the torso top (+0.35) upward for 0.9 s.
  - Katana/focus kills: 40% right arm, 30% left arm (radius 0.12, extra randvec(±3, 2, ±3)), else torso (radius 0.3, extra randvec(±2, 2, ±2)) plus a fountain at the hips for 0.7 s.
  - Deflect/blast or HP below −60% of max: 1–2 random limbs/torso (radius 0.15); bosses lose all 5.
- Always: bloodPool(feet, rand(1.1, 1.8) × (boss ? 2.5 : 1)) and blood(centre, dir, 1.2); with 60% chance the held gun is detached with the same helper (radius 0.08, extra randvec(±2, 2, ±2), bloody like the other parts); a shield, if any, breaks off (radius 0.4, blood false, life 8, velocity randvec(±3, 4, ±3), angular randvec(±6, ±6, ±6)).
- Boss death adds explosion(centre, 6, BLACK).
- Bomber enemies explode instead: explosion(centre, blastRadius × 0.8 when killed, ×1 when self-detonating, BLACK).
- The remaining corpse topples (enemies spec) and shrinks to nothing between 8.3 s and 9 s after death, then is removed.
- Tone colour for all of the above: BLACK for black-tone enemy types, RED otherwise.

**Remote player death** (ragdoll): name tag, rope and hook hidden; if "overkill": head detached (radius 0.25, extra randvec(±2, 3, ±2)) and 50% chance one arm (radius 0.12, extra randvec(±3, 2, ±3)); limbs are given random limp rotations (x ±1.2, z ±0.6), eyes swap to X-eyes; the whole body becomes debris with velocity `dir × rand(5, 8) + (0, rand(3.5, 5.5), 0) + lastVelocity × 0.4`, angular randvec(±4.5, ±3, ±4.5), radius 0.55, blood true, life 8; blood(centre, dir, 1.3); bloodPool(feet, rand(1.2, 1.8), RED). Detached parts use velocity `dir × rand(4, 8) + extra + (0, rand(2, 5), 0)`, angular randvec(±8, ±8, ±8), life rand(7, 10).

**Local player death** has no world effect; the camera stays where it is and the "dying" state runs (game-loop spec).

**Breakable props**: each child mesh becomes non-bloody debris (velocity `dir × rand(2, 6) + (rand(−3, 3), rand(2.5, 6.5), rand(−3, 3))`, angular randvec(±9, ±9, ±9), radius 0.14, life rand(6, 9)). Then by kind: piñata → three strokeBursts (PINK, ORANGE, GREEN; 16 each, speed 7, life 0.7, size 0.05) + explosion(pos, 2.5, PINK); cactus → blood(pos, dir, 1.4, GREEN) + bloodPool((x, 0, z), 1.1, GREEN); anything else → strokeBurst(pos, prop tone, 12, 5, life 0.35, size 0.04) + smoke(pos, up, 3). A non-fatal hit on a prop: strokeBurst(point, prop tone, 5, 4, life 0.2, size 0.03).

## 12. HUD feedback: hit marker, damage indicator, low health

These are DOM elements over the canvas, centred on the crosshair. The design uses multiply blending; the replacement look follows `docs/ARCHITECTURE.md` §3.5. Keep the rotations that form the hit-marker X and show the damage-source direction; these are not decorative tilt.

**Hit marker.** An X made of two bars, each 2.5 px wide × 28 px tall, centred, rotated +45° and −45°. Normally hidden (opacity 0). On trigger it restarts a 0.2 s ease-out animation from opacity 1 / scale 1.5 to opacity 0 / scale 1. Variants: *kill* → bars in RED and 38 px tall; *crit* → bars 4 px wide (combinable). Triggered by: any damage to an enemy (kill = enemy HP ≤ 0 after the hit, crit = headshot); shield hits (plain); client-side predicted hits in a networked match (crit only); hits on another player (crit only); grenade damage to another player (plain).

**Damage direction indicator.** Each time the local player takes damage with a known source position: a RED triangle 32 px wide × 22 px tall, apex pointing away from the centre, placed 140 px from the screen centre (its base 118 px out), rotated about the screen centre by `angle = atan2(dot(toSource, right), dot(toSource, forward))` in degrees — 0° is straight ahead (top of screen), positive turns clockwise (source on the right). It starts at 90% opacity and fades linearly to 0 over 1.0 s, then is removed. Several may coexist.

**Low health.** The HUD gets a "low" state when hp/maxHp < 0.3 (bars turn red). Independently, the renderer's `lowHp` intensity (6.3) drives the pulsing red vignette when hp < 30 (max HP is 120).

**Crosshair/spread, scope overlay, focus mark** belong to the HUD spec; the focus mark position is the target's centre projected with the gameplay camera to pixels (`(ndc.x × 0.5 + 0.5) × width`, `(−ndc.y × 0.5 + 0.5) × height`), hidden when the projected depth is not in front.

## 13. Spawn trigger table

Every place in the design that spawns an effect, with exact arguments. (`sb` = strokeBurst with (tone, count, speed, {life, size, …}).)

| Trigger | Effects |
|---|---|
| Player gun shot (per shot) | Muzzle flash (9); per pellet: tracer (10); on world hit: bulletImpact(point, normal, BLUE); shell (8.8) |
| Player bullet hits enemy | blood(hitPoint or centre, shotDir, clamp(0.5 + dmg/70, 0.5, 2.2) × (boss ? 1.6 : 1), enemy tone); hit flash 0.07 s; hit marker |
| Player bullet hits enemy shield | sparks(point, −shotDir, ORANGE, 8, 8); hit marker (plain) |
| Shield breaks | shield mesh → debris(velocity randvec(±3, 4, ±3), angular randvec(±6, ±6, ±6), radius 0.4, life 8) |
| Player hits another player (PvP) | blood(point, dir, clamp(0.4 + dmg/80, 0.4, 1.6), RED); remote flash 0.08 s; hit marker(crit) |
| Player bullet hits raised blade (PvP) | sb(ORANGE, 8, 6, life 0.22, size 0.035); 40%: tracer(point → own eye, RED, 0.03, 0.08) |
| Slash parried by other player's guard | sb(ORANGE, 10, 6, life 0.25, size 0.04) |
| Slash cuts another player's rope | sb(ORANGE, 10, 5, life 0.25, size 0.035) at the cut point |
| Your rope gets cut (network) | sb(ORANGE, 8, 4, life 0.25, size 0.03) at your centre |
| Someone parried your shot (network) | sb(ORANGE, 8, 5, life 0.2, size 0.03) at eye + forward × 0.5 |
| Katana slash start | 9 arc tracers (10); FOV kick 2 |
| Katana hits something | shake += 0.12; hit-stop 0.07 s at 0.12 |
| Player deflects a projectile | sparks(projPos, −projDir, ORANGE, perfect ? 14 : 8, 10); sb(BLUE, perfect ? 8 : 5, 4.5, life 0.2, size 0.028); shake += 0.06; flash 0.35/0.1; hit-stop |
| Projectile deflected (enemy side, retargeted) | sparks(pos, newDir, ORANGE, 10, 9); sb(BLUE, 8, 4, life 0.2) |
| Projectile knocked away (not returned) | sb(RED, 5, 6, life 0.18, size 0.03) |
| Player blocks a melee swing | sparks(eye + forward × 0.8, −forward, ORANGE, 12, 8) |
| Enemy projectile hits world | bulletImpact(point, normal, projectile tone) |
| Enemy blast projectile hits world | explosion(point, 2.5, BLACK) |
| Enemy fires (rifle-type) | sb(ORANGE, 4, 4, life 0.07, size 0.03) at muzzle |
| Enemy fires (shotgun) | sb(ORANGE, 8, 5, life 0.1, size 0.04) at muzzle |
| Enemy sword swing | 5 RED arc tracers (10) |
| Enemy spawns | sb(enemy tone or RED, boss ? 60 : 26, boss ? 10 : 6, life 0.5, size 0.03) at spawn + (0, 1, 0) |
| Enemy yanked by grapple | blood(centre, pullDir, 0.4) |
| Enemy dies | see section 11 |
| Boss stomp | shake += 0.9; explosion(feet + 0.2 up, 7, BLACK); 24-stroke ring (8.13) |
| Boss charge hits player | shake += 0.5 |
| Boss charge hits wall | sb(PINK, 30, 9, life 0.4, size 0.05); shake += 0.6 |
| Boss charging (every 0.1 s) | sb(PINK, 4, 3, life 0.35, size 0.06) at feet + 0.3 up |
| Boss slam | shake += 0.8; explosion(feet + 0.2 up, 6, PINK) |
| Boss roar | sb(BLACK, 40, 10, life 0.5, size 0.05) at centre |
| LagSpike boss lands a hop | shake += 0.4; bloodPool(feet, 3.5, BLACK) |
| Player takes damage | hurt += dmg/40; shake += 0.2 + dmg/80; damage indicator |
| Player hard landing (impact > 0.8) | shake += impact × 0.15 |
| Grenade in flight (fuse ticks: 5 Hz, 14 Hz in the last 0.8 s) | sb(ORANGE, 2, 2.5, life 0.12, size 0.02) at grenade + 0.22 up |
| Grenade explodes | boom(centre, blastRadius) |
| Player double jump | sb(BLUE, 9, 4.5, life 0.28, size 0.028, gravity −2) at centre − (0, 0.7, 0) |
| Player air dash | sb(BLUE, 10, 5, life 0.25, size 0.03) at centre − dir × 0.6 |
| Focus dash (each 0.02 s) | trail tracer + sb(BLUE, 2, 5, life 0.22, size 0.03) |
| Focus execution | shake += 0.35; hit-stop 0.1 s at 0.08; FOV kick 6 |
| Pickup collected | sb(ammo ? BLUE : GREEN, 12, 4, life 0.3) at the pickup |
| Player respawns (online) | sb(BLUE, 24, 6, life 0.5, size 0.03) at centre |
| Prop hit / broken | see section 11 |
| Remote player shots (network) | tracers (10) + remote model flash |

## 14. Screen shake source table

| Source | Amount added |
|---|---|
| Player takes damage | 0.2 + damage / 80 |
| Gun fire | 0.02 + fovKick × 0.02 (rifle 0.044, shotgun 0.10, sniper 0.11, revolver 0.07) |
| Katana hit | 0.12 |
| Successful deflect | 0.06 |
| Hard landing (impact > 0.8) | impact × 0.15 (impact ≤ 1.5) |
| Focus execution | 0.35 |
| Grenade boom | 0.8 |
| Tone explosion (any) | 0.5 |
| Boss stomp | 0.9 (+0.5 from its explosion) |
| Boss charge hits player | 0.5 |
| Boss charge hits wall | 0.6 |
| Boss slam | 0.8 (+0.5 from its explosion) |
| LagSpike hop landing | 0.4 |

Decay and application: section 3.4.

## 15. Interfaces with other subsystems

**Renderer → game loop.** The renderer exposes: the scene, the camera, a `resize()` (self-registered on window resize), and `render(time, {hurt, flash, slow, lowHp})`. The game loop calls `render` exactly once per frame, last, with the game clock and the four intensities from section 6.3. The renderer updates the camera's matrices itself (the player only sets position/rotation/FOV).

**Renderer → all mesh-owning subsystems.** A factory `makeInkMaterial({tone, fill, shadeScale, shadeBias, side})` and two setters (`setInk(material, tone)`, `setFill(material, on)`) are the only way to make a drawable material. Instanced meshes must provide the per-instance (tone, fill, 0) attribute (5.3). Levels merge geometry per tone index into one mesh each with default parameters.

**Effects ← game loop.** Constructed with (scene, world). `update(dt)` once per frame with `sdt` while playing, raw `dt` otherwise. `clear()` on new game or wave jump. The public shake accumulator is read-modify-written by the player's camera step (3.4).

**Effects → physics world.** `world.raycast(origin, direction, maxDistance, ignorePredicate)` returns `{dist, point, normal, box}` or nothing; the normal is axis-aligned (boxes are AABBs). Particles and decal searches pass the "see-through" predicate (boxes whose data has `noShoot = true` are ignored); debris passes no predicate (collides with everything).

**Effects → scene.** Debris re-parents caller-owned meshes into the scene (`scene.attach` semantics: world transform preserved) and removes them at end of life. Callers must not remove those meshes themselves. Pools are added to the scene at construction.

**Effects ← callers.** Public recipe functions: decal, splat, bloodPool, bulletImpact, sparks, strokeBurst, tracer, blood, drip, boom, fountain, shell, smoke, explosion, debris, plus a raw single-particle spawn used by the boss stomp ring. All positions are world-space vectors and are copied. A counter of bloody gibs alive is maintained and exposed but nothing in the design reads it.

**Player → renderer feedback.** The player owns the player's hurt intensity, the player's flash intensity, HP; the game loop maps them to the four intensities (6.3). The HUD's `hitmarker(kill, crit)` and `damageFrom(angle)` are called by the enemy manager, the PvP hit handler and the player's damage handler as listed in sections 12–13.

**Weapons → effects/renderer.** The weapon owns the muzzle-flash mesh and calls strokeBurst/smoke/tracer/bulletImpact/shell as in section 9; it calls `player.recoil`, `player.kickFov` and adds shake. The rig is parented to the camera by the player.

**Network → effects.** Remote shots arrive as (weapon kind, list of end points) and are drawn as tracers from the sender's model (10). Remote hits call the remote model's flash; remote deaths call the ragdoll (11).


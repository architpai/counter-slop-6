# Enemy System Specification

> Current combat changes: [Combat rehaul](combat-rehaul.md). It adds clown masks, gun-headshot feedback and the `melee` damage source.

Behavioural specification of the enemy subsystem: enemy and boss types, AI, attacks, the wave/spawn director, hit reactions, death, drops and the network replication format. Written so that an implementer can build identical gameplay from it alone.

Units: world distance units are metres (the player body is 1.75 tall, 0.35 half-width). Time is in seconds. Angles are in radians. Yaw convention: yaw 0 faces +Z; yaw = atan2(dx, dz) where (dx, dz) is the horizontal direction the enemy wants to face. "Horizontal distance" means the distance in the XZ plane only.

## Table of contents

1. [Overview and roles](#1-overview-and-roles)
2. [Enemy type catalogue](#2-enemy-type-catalogue)
3. [Shared enemy record and life cycle](#3-shared-enemy-record-and-life-cycle)
4. [Body, hit spheres and model geometry](#4-body-hit-spheres-and-model-geometry)
5. [Per-frame update (authoritative side)](#5-per-frame-update-authoritative-side)
6. [Movement primitives](#6-movement-primitives)
7. [Ground AI by weapon class](#7-ground-ai-by-weapon-class)
8. [Ranged fire control](#8-ranged-fire-control)
9. [Bosses](#9-bosses)
10. [Flyer (backdrop wasp)](#10-flyer-backdrop-wasp)
11. [Enemy projectiles](#11-enemy-projectiles)
12. [Damage, hit reactions, shields, yank](#12-damage-hit-reactions-shields-yank)
13. [Death, gore, corpse cleanup](#13-death-gore-corpse-cleanup)
14. [Animation and telegraphs (gameplay-relevant)](#14-animation-and-telegraphs-gameplay-relevant)
15. [Spawn director (solo waves)](#15-spawn-director-solo-waves)
16. [Score, kill labels and drops](#16-score-kill-labels-and-drops)
17. [Network replication](#17-network-replication)
18. [Interfaces with other subsystems](#18-interfaces-with-other-subsystems)

---

## 1. Overview and roles

The enemy manager owns:

- a list of enemy records (alive and recently dead), a running count of alive enemies, and a map from numeric id to enemy;
- the pool of enemy projectiles (bullets, pellets, lobbed tone bombs);
- two global modifiers set by the wave director: a **speed multiplier** and a **damage multiplier** (both default 1);
- a **mirror flag**. When false this instance is authoritative (solo play or the host of a match): it runs AI, physics, health and death. When true it is a client mirror: it only eases enemies toward host snapshots, plays hit/death visuals, and reports hits to the host (see section 17).
- callbacks the game layer hooks: `on kill`, `on boss` (boss health changed / boss appeared / boss died), `on spawn` (authoritative side only), `on client hit` (mirror side only), and the projectile `on fire` hook.

Every enemy chooses a **target** from the list of possible targets supplied by the game (the local player in solo play; all players in a match). Targets expose a common surface described in section 18.

There are four coarse states shared by all enemies: **spawn**, **hunt**, **stunned**, **dead**. Finer behaviour (attack phases, flyer flight phases, boss attacks) lives in per-enemy sub-state described below.

---

## 2. Enemy type catalogue

### 2.1 Stats table

All damage values are the base value before the global damage multiplier (section 12.2 explains exactly where the multiplier applies). "Cooldown" is a uniform random range drawn after each attack. "Scale" is the whole-model scale factor; body and hit-sphere sizes multiply by it.

| Type key | Display name | HP | Move speed | Weapon class | Score | Scale | Notes |
|---|---|---|---|---|---|---|---|
| grunt | GRUNT | 100 | 5.2 | rifle | 100 | 1.0 | 3-round bursts |
| rusher | RUSHER | 70 | 7.6 | blade (melee) | 120 | 0.95 | lunges and slashes |
| heavy | HEAVY | 320 | 3.0 | shotgun | 260 | 1.25 | 7 pellets |
| sniper | SNIPER | 60 | 3.6 | sniper | 180 | 1.05 | stationary once in range; laser telegraph |
| shield | SHIELD MAIN | 150 | 3.8 | pistol | 200 | 1.05 | carries a breakable shield (2 hits) |
| bomber | LIVE NADE | 26 | 6.5 | bomb (suicide) | 150 | 0.9 | black tone; fuse then explode |
| flyer | ATTACK DRONE | 40 | 6.2 | dive (melee) | 140 | 1.5 | flying; orbits then dives |
| boss | THE ADMIN | 2600 | 3.2 | boss (stomp / throw) | 2500 | 2.7 | humanoid boss; black tone; crown |
| hitbox | THE HITBOX | 3400 | 4.2 | boss (charge / wipe) | 3200 | 2.6 | blob boss; pink tone |
| lagspike | THE LAG SPIKE | 3000 | 3.0 | boss (spray / summon / hop) | 3600 | 2.4 | blob boss; black tone |

The boss list, in order, is: admin, hitbox, lagspike. Wave 5 spawns the first, wave 10 the second, wave 15 the third, wave 20 the first again, and so on (section 15).

### 2.2 Ranged weapon parameters

| Type | Engage range | Stop distance | Keep-away distance | Burst count | Burst interval | Cooldown | Damage/shot | Spread | Projectile speed | Projectile thickness |
|---|---|---|---|---|---|---|---|---|---|---|
| grunt (rifle) | 28 | 16 | 7 | 3 | 0.15 | 1.6 – 2.6 | 6 | 0.055 | 36 | 0.045 |
| heavy (shotgun) | 18 | 9 | 5 | 7 pellets at once | – | 2.4 – 3.2 | 5 per pellet | 0.13 | 32 × random(0.85 – 1.1) per pellet | 0.05 |
| sniper | 90 | 90 | 15 (unused; stationary) | 1 | – | 2.8 – 3.8 | 22 | 0.006 | 95 | 0.07 |
| shield (pistol) | 20 | 8 | 4 | 2 | 0.2 | 1.8 – 2.6 | 5 | 0.06 | 34 | 0.045 |

The sniper additionally has an **aim-up time of 1.7 s** and is flagged **stationary**.

### 2.3 Melee / special parameters

| Type | Parameter | Value | Meaning |
|---|---|---|---|
| rusher | lunge distance | 2.9 | starts the wind-up when the target is closer than this (horizontal) |
| rusher | reach | 3.0 | the slash lands if the target is closer than this when it connects |
| rusher | standoff | 1.9 | backs off if the target is closer than this while waiting |
| rusher | cooldown | 1.0 – 1.5 | between slashes |
| rusher | damage | 15 | per slash |
| bomber | fuse trigger range | 3.4 | lights the fuse when this close (horizontal) with line of sight |
| bomber | fuse time | 1.05 | seconds from lighting to detonation |
| bomber | blast radius | 4.2 | full radius when it detonates itself; 0.8 × that (3.36) when killed |
| bomber | damage | 24 | at the centre of the blast, falling off with distance |
| flyer | damage | 10 | per successful dive |
| flyer | cooldown | 2.8 – 4.2 | between dives |
| admin | range | 32 | throws when the target is within this |
| admin | cooldown | 2.6 – 3.6 | after a stomp (a throw uses 0.6 × these: 1.56 – 2.16) |
| admin | damage | 22 | stomp damage; the thrown bomb does 0.9 × 22 = 19.8 |
| hitbox | range | 30 | charges when 3 < distance < 30 |
| hitbox | cooldown | 2.2 – 3.2 | |
| hitbox | damage | 26 | charge hit; the wipe does 0.8 × 26 = 20.8 |
| lagspike | range | 34 | sprays when closer than this |
| lagspike | cooldown | 2.4 – 3.4 | |
| lagspike | damage | 20 | spray bomb 0.55 × 20 = 11 each; hop landing 0.7 × 20 = 14 |

Unused stat fields that exist on bosses (stop 6/8/10, keep 0) have no effect on their behaviour.

### 2.4 Tone colour, model kind, hat

| Type | Tone colour (gameplay: the colour of blood/spray it emits) | Model kind | Headwear (silhouette) |
|---|---|---|---|
| grunt | red | humanoid | cap |
| rusher | red | humanoid (smiling face) | headband with spikes |
| heavy | red | humanoid, wide | helmet |
| sniper | red | humanoid, thin | hood |
| shield | red | humanoid with shield | helmet |
| bomber | black | round bomb body with fuse | – |
| flyer | red | backdrop dart with wings | – |
| admin | black | humanoid, giant | crown |
| hitbox | pink | round blob with a lid block on top | – |
| lagspike | black | round blob with 9 spikes | – |

Enemies with black tone bleed black; every other enemy (including the pink hitbox) bleeds red.

### 2.5 Body proportions (humanoids)

Multipliers applied to the humanoid template (section 4.2): body width, head size, limb thickness.

| Type | body width | head size | limb radius |
|---|---|---|---|
| grunt | 1.0 | 1.0 | 0.032 |
| rusher | 0.82 | 0.95 | 0.027 |
| heavy | 1.55 | 0.88 | 0.05 |
| sniper | 0.78 | 0.92 | 0.026 |
| shield | 1.2 | 0.9 | 0.042 |
| admin | 1.35 | 1.15 | 0.06 |

Every humanoid also gets a random per-instance head-width jitter factor in the range 0.95 – 1.06 (visual only).

---

## 3. Shared enemy record and life cycle

### 3.1 Fields (with initial values at spawn)

| Field | Initial value | Meaning |
|---|---|---|
| id | next free numeric id (shared counter with projectiles, starts at 1) or the id supplied by the host | replication key |
| type, stats | from the catalogue | |
| hp, max hp | type HP (bosses may be scaled by the director, section 15.5) | |
| alive | true | |
| state | spawn | spawn / hunt / stunned / dead |
| age | 0 | seconds since spawn; reset to 0 when entering stunned |
| body | see section 4.1 | physics body |
| centre | torso world position | used for aiming at the enemy, blast distances, line-of-sight origins |
| yaw | random in [0, 2π) | current facing |
| target yaw | 0 | facing the enemy eases toward |
| walk-cycle phase | random in [0, 2π) | animation |
| walk amount | 0 | 0..1 blend of walk animation |
| aim amount | 0 | 0..1 blend of "gun raised" pose; also replicated |
| flinch | 0 | 0..1, decays; hit reaction pose |
| flash timer / flash on | 0 / false | solid-fill flash on hit |
| path, path index, path timer, path goal | none / 0 / 0 / none | path following |
| LOS timer / has LOS | 0 / false | cached line-of-sight |
| attack cooldown | random 0.6 – 1.4 | time until the first attack is allowed |
| burst left / burst timer | 0 / 0 | ranged bursts |
| aim timer | 0 | sniper aim-up |
| attack timer / attack has hit | 0 / false | rusher swing |
| stun duration | 0 | |
| stuck timer | 0 | wall-bump escape |
| strafe direction / strafe timer | random ±1 / random 1 – 2 | ranged strafing |
| dead timer | 0 | seconds since death |
| approach slot angle | (global slot counter) × 2.39996 (the golden angle); the counter increments once per spawn and never resets | fan-out slot around the target |
| approach slot radius | 0 | |
| approach re-roll timer | random 0 – 2 | |
| keep multiplier | random 0.75 – 1.35 | scales stop/keep distances per individual |
| back-off timer | 0 | rusher retreat after a swing |
| fuse timer | −1 (unlit) | bomber; ≥ 0 means lit |
| shield hp | 2 if the type has a shield, else 0 | |
| flight phase / flight timer / orbit direction | orbit / random 0 – 3 / random ±1 | flyer |
| boss attack | none | current boss attack sub-state |
| root detached | false | model handed to the debris system (no topple, no scale-down) |
| retarget timer | 0 | |
| laser | none | sniper beam object |
| charge count (hitbox), spray count (lagspike), hop timer (lagspike, starts at 1) | 0 / 0 / 1 | boss pattern counters |
| hopping flag (lagspike) | false | true from take-off until the landing slam has fired |
| aim point / aim warned (sniper) | none / false | the point the laser chases; whether the half-charge warning sound has played |
| dive hit flag (flyer) | false | set when the current dive has connected (hit or blocked) |
| topple | none | death animation record: axis, sign, progress (section 13.4) |
| snapshot older / snapshot newest | none | mirror-side interpolation pair (section 17.3) |

The retarget timer is unset on the first frame and is treated as 0, so the enemy picks a target on its first update.

### 3.2 Spawning

`spawn(type, position, optional id)`:

1. Build the model and physics body (section 4). Model scale starts at 0.001 (invisible point).
2. Register in the list and id map; alive count += 1.
3. On the authoritative side, call `on spawn(enemy)`.
4. Spawn burst effect at position + 1 up: 26 stroke particles at speed 6 (bosses: 60 at speed 10), life 0.5, size 0.03, in the type's tone (red if the type has none). Play the spawn sound at the position.
5. Bosses: play the boss roar at the position and call `on boss(enemy)`.
6. Return the record. Bosses that summon minions set the minion's state directly to hunt and full scale, skipping the spawn animation.

Body flags: the body is allowed to step up even while airborne ("always step"). Flyers never snap down to the ground.

### 3.3 State machine (coarse)

| From | To | When |
|---|---|---|
| spawn | hunt | age ≥ 0.6 s, or the enemy takes health damage (any amount, not shield hits) |
| hunt | stunned | yanked by the grapple (non-boss), melee blocked by a target's parry (rusher, flyer) |
| stunned | hunt | ground enemy: age > stun duration. Flyer: it touches the ground or age > 2.2 |
| any live state | dead | hp ≤ 0, fell below y = −6, or self-detonation (bomber) |

During **spawn**: the model grows from scale 0.001 to full over 0.6 s with a wobble: scale = f × S × (1 + sin(60 × age) × 0.12 × (1 − f)), where f = clamp(age / 0.6, 0, 1) and S is the type scale. No AI runs, no gravity, no movement; the model sits at the body position, hit spheres are synced so the enemy **can already be shot** (it is alive). The focus-slash targeting in the game layer excludes spawn-state enemies; nothing else does.

During **stunned** (ground enemies): no thinking; gravity and body movement still apply, so the stun velocity carries the enemy through the air. The sniper laser is hidden. On exit the enemy resumes hunting with whatever cooldowns it had. The "never share the target's space" push (section 5, step 11) and pairwise separation (6.4) still apply to stunned enemies.

Edge case: pairwise separation (6.4) also applies velocity impulses to enemies still in **spawn** (they are alive and grounded), but the body is not moved during spawn, so any accumulated velocity is released on the first hunt frame.

---

## 4. Body, hit spheres and model geometry

### 4.1 Physics body

An axis-aligned box body moved by the physics subsystem (section 18.2):

- half width = 0.45 for flyers; otherwise min(0.33 × scale, 0.9)
- height = (0.8 for flyers, 1.85 otherwise) × scale
- step height = 1.2 for bosses, 0.6 otherwise
- always-step = true (can climb steps while airborne); flyers: no ground snap
- gravity: ground enemies −24 /s² every frame while not in spawn; flyers have no gravity except while stunned (−20 /s²)

Examples: grunt 0.33 × 1.85; heavy 0.4125 × 2.31; admin 0.891 × 5.0; hitbox 0.858 × 4.81; flyer 0.45 × 1.2.

### 4.2 Humanoid template (unscaled; multiply everything by the type scale)

Vertical layout from the feet (y = 0):

- hips pivot at 0.86 (bobs up by |cos(phase)| × 0.07 × walk amount; −0.05 while airborne)
- torso group at hips + 0.04 = 0.90; torso oval centred 0.26 above that (1.16), radii (0.3 × body width, 0.3, 0.19 × body width)
- neck 0.12 tall at torso group + 0.56
- head group at torso group + 0.62 = 1.52; head oval centred 0.26 above that (**head centre 1.78**), radii (0.275 × head size × jitter, 0.3 × head size, 0.25 × head size)
- shoulders at torso group + 0.46 (1.36), ±0.26 × body width sideways; upper arm length 0.3, forearm length 0.28, mitten hand at the forearm end
- legs hang from hips at −0.02, ±0.13 × body width sideways; thigh 0.42, shin 0.42, shoe at the shin end
- the weapon hangs from the right forearm at (0, −0.29, 0.07); the **muzzle/tip point** is at (0, 0.05, z) inside the weapon, z = 0.78 for guns, 0.92 for the blade, 0.4 for the boss hammer
- shield (shieldbearer only): a plate 0.92 wide × 1.3 tall × 0.07 thick, on the left of the torso at (−0.17, 0.34, 0.46) relative to the torso group, i.e. held in front-left of the chest

Limb "mid markers" for hit spheres sit 55 % of the way down each limb segment.

### 4.3 Hit spheres

Ray hits against enemies use spheres centred on model part world positions, radius = listed radius × type scale. The **first hit along the ray** (smallest distance) wins regardless of list order. A sphere counts only if its centre projects onto the ray between 0 and the max distance and the entry point is at a non-negative distance — a ray starting inside a sphere does not hit that sphere. Only alive enemies (including those still in spawn) are tested; an optional "ignore this enemy" argument excludes one enemy.

Humanoid: head 0.3, torso 0.33, hips 0.2, upper arms 0.11 each, forearms 0.10 each, thighs 0.13 each, shins 0.11 each. Shieldbearer adds shield 0.66 (centred on the shield plate) until the shield breaks.

Bomber and blob bosses: one sphere, torso, 0.5. Flyer: one sphere, torso (the body pivot), 0.48.

The enemy **centre** is the torso part's world position. The enemy **eye** (line-of-sight origin for ground enemies) is the head part's world position; for bombers, blobs and flyers the head part is the torso/body part.

### 4.4 Bomber / blob template (unscaled)

- hips pivot at 0.5; body sphere radius 0.44 centred 0.32 above the torso group (centre at 0.82)
- face on the front of the sphere; two short arms from ±0.42 at height 0.42 (length 0.26); two legs (thigh 0.26 + shin 0.24) hanging from the hips pivot at ±0.16 sideways, −0.06 down
- bomber only: a cap on top at 0.76, a curved fuse rising to (0.24, 1.14, 0) and a **spark** ball (radius 0.075, orange) at the fuse end. The spark scales each frame to 0.7 + random(0 – 0.8), plus 1.5 while the fuse is lit (it visibly flares).
- hitbox: a lid block 0.7 × 0.32 × 0.5 on top of the sphere at height 0.86 with a thin dark band under it
- lagspike: 9 spikes (cones 0.42 long, base radius 0.12) pointing outward around the sphere at radius 0.42, spike i at angle i/9 × 2π, height 0.32 + sin(2.3 × angle) × 0.25
- Blob "tip" (unused for attacks): (0, 0.5, 0.5) relative to the torso group

### 4.5 Flyer template (unscaled ×1.5)

- body pivot at 0.6 above the body position (bobs ± 0.1 with sin(3 × age))
- a 3-sided cone 1.25 long, radius 0.32, pointing forward (+Z), offset 0.08 forward
- two wings 0.86 × 0.025 × 0.5 at ±0.48 sideways, −0.14 back; a tail fin behind
- face group at (0, −0.06, 0.3), scale 0.72

---

## 5. Per-frame update (authoritative side)

For each enemy, in list order, with frame time dt (the game clamps dt to ≤ 0.05 s and may scale it during hit-stop / focus slow-motion):

1. age += dt.
2. Dead enemies: run the corpse update (section 13.4) and skip the rest.
3. **Target selection**: the retarget timer counts down; if the current target is alive and the timer is > 0, keep it. Otherwise set the timer to 0.5 and pick the alive target whose feet position is nearest (squared distance) to the enemy body. If nobody is alive, fall back to the local player (who is dead) — the enemy then "wanders" (stands still).
4. Flash timer counts down; when it expires the solid-fill flash turns off. Flinch decays toward 0 with an exponential damp of rate 9 (value ← lerp(value, 0, 1 − e^(−9 dt))).
5. If in **spawn**: apply the growth animation, place the model, sync hit spheres, and if age ≥ 0.6 switch to hunt at full scale. Skip the rest.
6. If stunned and the enemy has a laser, hide the laser.
7. Flyers: run the flyer brain (section 10) then move the body. Ground enemies: if stunned and age > stun duration → hunt. If not stunned: think (section 7) if the target is alive, else wander (section 6.5). Then apply gravity (vel.y −= 24 dt) and move the body through the physics world.
8. If body y < −6: kill with source "fall" (direction straight up).
9. Ease yaw toward target yaw using the shortest angular path with factor 1 − e^(−10 dt).
10. Place the model at the body position with rotation = yaw.
11. **Never share the target's space** (ground enemies only): let r = 0.36 + enemy half width + 0.12. If the horizontal distance to the target's feet is < r and |Δy| < 1.7, push the enemy horizontally out to exactly r along the line from the target. If that pushed position overlaps world geometry, undo the push.
12. Animate (section 14) and sync hit spheres and centre from the model.

After all enemies: run pairwise separation (section 6.4), update projectiles (section 11), then remove any dead enemy whose dead timer exceeds 9 s (also removing its laser and, unless the model was handed to the debris system, its model). On the authoritative side the id-to-enemy map keeps the stale entry (harmless because ids are never reused); the mirror side deletes it.

Dead enemies keep their body where it was; they are excluded from separation, target selection and hit tests, but their corpse model remains visible until removal.

---

## 6. Movement primitives

### 6.1 Steer toward a point

Inputs: goal (x, z), desired speed, acceleration.

- Horizontal vector to the goal; if its length < 0.0001, damp horizontal velocity toward 0 with rate 8 and stop.
- Normalise. Acceleration budget a = accel × dt on the ground, or 0.3 × accel × dt while airborne.
- desired speed ×= global speed multiplier.
- vel.x += clamp(dir.x × speed − vel.x, −a, a); same for z.
- target yaw = atan2(dir.x, dir.z).

### 6.2 Ground-ahead probe

From (body + dir × 0.9, y + 0.5), cast down 3.5. True if something is hit. Used before strafing so ranged enemies do not walk off edges. This probe (and the flyer avoidance rays in section 10) does **not** ignore see-through geometry, so a railing counts as ground.

### 6.3 Approach slot (fan-out around the target)

Each enemy keeps a personal slot angle and slot radius so a group surrounds the target instead of forming a line.

- The re-roll timer counts down. On expiry: timer = random 2.5 – 5; slot angle += random(−0.7, 0.7); slot radius = random 2 – 4.5 for melee types (blade, bomb), random 4.5 – 9 for everyone else.
- d = horizontal distance from the enemy to the target.
- r = clamp(0.55 × d, min(2, 0.9 × d), slot radius). (Lower bound applies first: if 0.55 d is below the lower bound, r = lower bound even if that exceeds the slot radius.)
- If |target y − enemy y| > 1.5 (target is on another level), r = min(r, 1.1) so the enemy aims almost exactly at the target and does not walk off ramps.
- Approach point = (target.x + cos(angle) × r, target.y, target.z + sin(angle) × r).

### 6.4 Pairwise separation

Every 0.05 s, for each pair of alive **ground** enemies: rr = halfW_a + halfW_b + 0.75. If their horizontal distance d < rr, d > 0.001 and |Δy| ≤ 1.5: push = (rr − d) × 9, applied as an instantaneous horizontal velocity change of magnitude push to each, away from the other. (Not scaled by dt: it is a velocity impulse each 0.05 s.)

### 6.5 Wander (no live target)

Horizontal velocity damps toward 0 with rate 6; aim amount damps toward 0 with rate 5. The enemy stands where it is (gravity still applies).

### 6.6 Path following ("follow")

Inputs: the target feet position and desired speed. The nav subsystem (section 18.3) supplies A* paths over a 1 m grid.

1. Path timer −= dt. Compute the approach point (6.3); that is the goal handed to the pathfinder.
2. The path is **stale** if there is no path, the path index is past the end, or (path timer ≤ 0 and (there is no recorded path goal, or the recorded goal is > 3.5 from the new approach point, or the path was flagged incomplete)).
3. If stale and (path timer ≤ 0 or no path): path timer = 0.8 + random(0 – 0.6); request a path from the body position to the approach point. If a non-empty path returns: store it, index 0, record the goal; then skip leading waypoints while (index < last) and the waypoint is within 0.7 horizontally and < 1 vertically of the body.
4. Current waypoint: if within 0.5 horizontally and < 1.2 vertically, advance the index; the goal is the next waypoint if any. Otherwise the goal is the current waypoint. If there is no goal, the goal is the approach point itself.
5. Steer toward the goal (6.1) with acceleration 40.
6. Jumping and unsticking (only when on the ground):
   - If goal.y > body.y + 0.6 and the horizontal distance to the goal < 1.7: jump (vel.y = 9, on-ground cleared).
   - Else if the body bumped a wall this frame: stuck timer += dt; when it passes through the window 0.35 – 0.4, force an immediate repath (path timer = 0); when it exceeds 0.9: jump (vel.y = 9), stuck timer = 0, force repath.
   - Else stuck timer = 0.

---

## 7. Ground AI by weapon class

Common preamble each frame for a hunting ground enemy with a live target:

- dx, dz = target feet − enemy body (horizontal); dist = horizontal distance; dy = target y − enemy y.
- **Line of sight** is re-evaluated when its timer expires: timer = 0.12 + random(0 – 0.1); LOS = an unobstructed ray from the enemy eye (section 4.3) to the target's centre, ignoring "see-through" geometry (world boxes flagged no-shoot, e.g. railings).
- Attack cooldown −= dt.
- yawTo = atan2(dx, dz).

Then branch on weapon class.

### 7.1 Bomber (weapon "bomb")

1. **Fuse lit** (fuse timer ≥ 0): fuse timer −= dt; horizontal velocity damps toward 0 with rate 4; face the target; the solid-fill flash is forced on every frame (the body reads as solid until it blows); a fuse tick sound plays each time the fuse timer crosses a 1/8 s boundary; when the fuse timer ≤ 0 → **self-detonate** (section 12.6, scale 1). Nothing else runs.
2. **Trigger**: if dist < 3.4 and |dy| < 2.2 and LOS: fuse timer = 1.05, play the fuse sound, stop for this frame.
3. **Chase**: if LOS and dist < 12 and |dy| < 1.5 → steer straight at the target feet at speed 6.5 with acceleration 45. Otherwise path-follow at 6.5.

A bomber never attacks in any other way. Killing it (hp ≤ 0) detonates it at 0.8 scale (section 13.1).

### 7.2 Rusher (weapon "blade")

Aim amount damps to 0 (rate 8). Then, in priority order:

1. **Back-off** (back-off timer > 0): timer −= dt; face the target; accelerate **away** from the target at 0.55 × 7.6 = 4.18 with acceleration budget 26 × dt per axis (not multiplied by the global speed modifier). Stop.
2. **Swinging** (attack timer > 0): attack timer −= dt; horizontal velocity damps toward 0 (rate 8); face the target. When the attack timer first drops below 0.18 (the "connect" moment, 0.37 s after the wind-up began):
   - Mark the swing as having connected.
   - Draw the swing arc as 5 short red tracer segments, life 0.16, thickness 0.025, sweeping around the enemy: segment i (0..4) goes from angle −0.9 + 0.45 i to −0.9 + 0.45 (i+1) relative to the enemy yaw, at radius 1.5 from the centre, dropping from centre.y + 0.5 − 0.18 i to centre.y + 0.5 − 0.18 (i+1). This is the visible slash the player reacts to.
   - If dist < 3.0 and |dy| < 1.7: ask the target to **block the melee** (section 18.4). If blocked: the rusher becomes stunned for 1.1 s (age reset to 0), velocity set to (−dx/dist × 7, 3.5, −dz/dist × 7) — knocked back and up. If not blocked: the target takes 15 × damage multiplier from the enemy's centre.
   - If out of reach: play the swing (miss) sound.
   - Cooldown = random 1.0 – 1.5; back-off timer = random 0.45 – 0.75.
   Stop.
3. **Wind-up trigger**: if dist < 2.9 and |dy| < 1.7 and cooldown ≤ 0 and LOS: attack timer = 0.55; connected = false; play the lunge sound; add (dx/dist × 2.5, 0, dz/dist × 2.5) to velocity (a small hop forward). Stop. The swing connects 0.37 s later; the whole animation lasts 0.55 s.
4. **Close-quarters positioning** (LOS and dist < 9 and |dy| < 1.6):
   - If dist < 1.9 and |dy| < 1.2: retreat from the target at 0.4 × 7.6 = 3.04 with acceleration budget 24 × dt (no speed modifier); face the target.
   - Else: goal = the approach slot point if dist > 4.5, else the target feet; steer at 7.6 with acceleration 45. If on the ground and bumping a wall: stuck timer += dt; when > 0.25 jump (vel.y = 9) and reset.
5. Otherwise path-follow at 7.6.

### 7.3 Bosses (weapon "boss")

Dispatch to the boss brain (section 9).

### 7.4 Ranged (rifle, shotgun, pistol, sniper)

Let stop′ = stop × keep multiplier and keep′ = keep × keep multiplier (the per-enemy random 0.75 – 1.35).

**In range** (LOS and dist < range):

- Aim amount damps toward 1 (rate 8); face the target.
- Stationary types (sniper): no movement at all.
- Else if dist > stop′: path-follow at 0.8 × speed while also running fire control (section 8); face the target; stop.
- Else if |dy| > 1.2 (target is above or below): path-follow at 0.85 × speed while running fire control; face the target; stop. (In this branch the spread's target-speed term uses the local player's speed rather than the actual target's.)
- Else choose a horizontal move direction (mx, mz) with (nx, nz) = unit vector to the target:
  - dist < keep′ → move away: (−nx, −nz).
  - dist > 0.7 × range and weapon is shotgun → move in: (nx, nz).
  - otherwise **strafe**: strafe timer −= dt; on expiry timer = random 0.8 – 2 and the strafe direction flips; (mx, mz) = (−nz, nx) × strafe direction.
  - Strafe/approach speed = full speed for the shotgun, 0.5 × speed for others (**not** multiplied by the global speed modifier).
  - If a move is chosen and the ground-ahead probe (6.2) succeeds: accelerate toward (mx, mz) × that speed with budget 30 × dt per axis. Else damp horizontal velocity to 0 (rate 8).
- Run fire control (section 8).

**Out of range or no LOS**:

- Aim amount damps toward 0 (rate 5); any burst in progress is cancelled (burst left = 0); sniper aim timer = 0 and its aim point cleared; laser hidden.
- Stationary types during their first 5 s of life: stand still (damp rate 8) and face the target. Otherwise path-follow at full speed.
- If LOS, face the target.

Net effect per type: grunts advance to ~16 m, then strafe sideways while bursting, backing off inside 7 m. Heavies press in to ~9 m, walk straight at the target beyond 12.6 m, back off inside 5 m. Shieldbearers close to ~8 m. Snipers stand where they spawned as long as they can see the target within 90 m; after 5 s alive with no view they walk toward the target at 3.6.

---

## 8. Ranged fire control

Called each frame while in range. Muzzle = the weapon tip world position (section 4.2).

### 8.1 Sniper

1. If cooldown > 0: hide the laser and stop.
2. Aim timer += dt.
3. Aim point: on the first frame it is set to the target centre; afterwards it eases toward the target centre with factor 1 − e^(−2.6 dt) (it **chases** the player; a player who keeps moving is missed).
4. Show the laser from the muzzle to the aim point with charge = clamp(aim timer / 1.7, 0, 1) (section 8.4).
5. When the aim timer passes 0.85 (half of 1.7) the "sniper aiming" warning sound plays once (guarded by the aim-warned flag). Edge case: the flag is cleared only when a shot fires. If the sniper loses range or line of sight mid-aim (aim timer and aim point reset, section 7.4) the flag stays set, so the next aim-up is silent until a shot has actually been fired.
6. When the aim timer ≥ 1.7: aim timer = 0, warning reset, cooldown = random 2.8 – 3.8; fire one shot (8.3) at the **aim point** (not the current target position) with spread 0.006, speed 95, damage 22, thickness 0.07; play the sniper shot; hide the laser; clear the aim point.

### 8.2 Burst and shotgun

- If a burst is in progress (burst left > 0): burst timer −= dt; when ≤ 0: burst timer = burst interval; burst left −= 1; fire one shot at the target's centre (spread, speed, damage, thickness 0.045); play the shot sound; if that was the last shot, cooldown = random cooldown range. Stop.
- Else if cooldown ≤ 0:
  - Shotgun: fire all 7 pellets at once at the target centre, each with speed 32 × random(0.85 – 1.1), thickness 0.05; play the shotgun sound; cooldown = random 2.4 – 3.2; muzzle burst of 8 orange strokes (speed 5, life 0.1, size 0.04).
  - Otherwise: burst left = burst count, burst timer = 0 (the first round leaves on the next frame).

### 8.3 Fire one shot

- Direction = (aim position − muzzle); add random(−0.2, 0.3) to its y component; normalise.
- Effective spread s = base spread × (1 + target speed × 0.06), where target speed is the magnitude of the target's full 3-D velocity (remote players report 0).
- Add random(−s, s) independently to x, y and z; normalise.
- Spawn a projectile (section 11) from the muzzle with that direction, the given speed, damage × global damage multiplier, owner = this enemy, red tone, given thickness, no blast.
- Muzzle flash: 4 orange strokes, speed 4, life 0.07, size 0.03.

### 8.4 Sniper laser telegraph

A thin solid red beam from the muzzle toward the aim point, **shortened by 1.6 at the far end** so it never fills the player's screen. Hidden if the muzzle-to-aim-point length < 2. Radius = 0.006 + 0.012 × charge² (grows from 0.006 to 0.018 as the shot charges). Hidden when the cooldown runs, when the enemy loses range/LOS, when stunned; destroyed on death.

---

## 9. Bosses

All three bosses share: the game's boss health bar callback is invoked on spawn, on every damage event and on death; they cannot be stunned or yanked (a yank only sets flinch = 1); on death they explode (section 13.3). While a boss attack sub-state is active the boss does not path-follow or chase; it faces the target and damps its horizontal velocity, except during the hitbox's charge run and skid, where the facing is frozen at the locked charge direction and the velocity is driven by the charge. The attack cooldown keeps counting down during an attack (it is reset when the attack ends). If the cooldown is ≤ 0 and line of sight holds but no decision rule matches (for example the hitbox's target is ≤ 3 away when no wipe is due, or the admin's target is beyond 32), the boss simply keeps moving and re-checks every frame.

Minions a boss summons (bombers, wasps) are ordinary enemies: they are registered normally, receive the `on spawn` callback, the spawn burst and sound, count toward the alive count (so the wave does not clear until they die), award score and drops on death, and take an approach slot.

### 9.1 THE ADMIN (humanoid, stomp / throw)

Aim amount damps toward (LOS ? 1 : 0) at rate 6.

**Decision** (no attack running, cooldown ≤ 0, LOS):
- dist < 7 and |dy| < 3 → **stomp**; play the roar.
- else dist < 32 → **throw**.

**Movement** (no attack running): if LOS and dist < 14 and |dy| < 2, steer straight at the target at 3.2 (acceleration 30); else path-follow at 3.2. Face the target if LOS.

**Stomp** (attack timer t counts up; horizontal velocity damps at rate 5):
- Wind-up 0 – 0.75 s: right arm raises (section 14).
- At t > 0.75 (once): stomp sound; screen shake += 0.9; black explosion effect radius 7 at the feet + 0.2; a ring of 24 black strokes at radius 3 around the feet flying outward at 14 with 2 up (size 0.06, life 0.4, gravity 4, stretch 0.06, drag 3). Every alive target within **horizontal 7.5** whose feet y < boss y + 2.5 takes **22 × damage multiplier** from the boss centre and is knocked back 9 away from the boss centre. Every other enemy within 6 of the boss feet takes 60 blast damage (falloff per section 12.5).
- Ends at t > 1.3: cooldown = random 2.6 – 3.6.

**Throw**:
- Wind-up 0 – 0.6 s (arm raise).
- At t > 0.6 (once): from the head position + 1 up, direction = toward the target centre with its y component increased by 0.012 × distance (a lob), normalised. Fire a **blast projectile** (section 11): speed 24, damage 19.8 (0.9 × 22, **not** multiplied by the damage modifier), black tone, thickness 0.4. Play the enemy shot sound.
- Ends at t > 1.0: cooldown = random 1.56 – 2.16.

### 9.2 THE HITBOX (blob, charge / wipe / bomber summon)

Aim amount damps to 0 at rate 6. It keeps a **charge counter**.

**Decision** (no attack running, cooldown ≤ 0, LOS):
- If charge counter mod 3 == 2 and dist < 12 → **wipe**, and charge counter += 1.
- Else if 3 < dist < 30 → **charge**.
So the intended rhythm is charge, charge, wipe, repeat; if the target is ≥ 12 away when a wipe is due, it charges instead and the counter advances past the wipe slot.

**Movement** (no attack): LOS and dist < 16 and |dy| < 2 → steer straight at 4.2 (accel 30); else path-follow at 4.2. Face the target if LOS.

**Charge** (t counts up):
- 0 – 0.7 s wind-up: face the target, horizontal velocity damps (rate 8). At t > 0.55 the charge direction is **locked** to the horizontal direction toward the target's feet and the roar plays. (The last 0.15 s of the wind-up cannot re-aim.)
- 0.7 – 1.9 s run: horizontal velocity = locked direction × 17 × speed multiplier, re-applied every frame (vertical velocity untouched, gravity applies). Every frame, the first alive target found within horizontal 2.6 and |Δy| < 3 is hit, and the charge carries a single "has hit" flag, so **at most one hit per charge in total** (a second target in the path is not hit): 26 × damage multiplier from the boss centre; knockback 13 along (target centre − boss centre) with y forced to 0.2 before normalising; screen shake += 0.5. If the body hits a wall the run ends immediately (t set to 1.9): 30 pink strokes at speed 9 (life 0.4, size 0.05), stomp sound, shake += 0.6. Every 0.1 s of the run, 4 pink dust strokes at the feet + 0.3 (speed 3, life 0.35, size 0.06).
- 1.9 – 2.7 s skid: horizontal velocity damps at rate 4.
- At t > 2.7: attack ends, cooldown = random 2.2 – 3.2, charge counter += 1.
The run covers up to about 20 m; keep moving sideways and it skids past.

**Rub**: face the target, damp (rate 6).
- At t > 0.9 (once): stomp sound; shake += 0.8; pink explosion effect radius 6 at the feet + 0.2. Spawn up to 2 bombers, but only while (live bombers + already spawned this wipe) < 4, each at a random angle at radius 3 from the boss feet, skipping the spawn animation (state hunt, full scale). Every alive target within horizontal 6.5 with feet y < boss y + 3 takes 20.8 × damage multiplier and knockback 9 away from the boss centre.
- Ends at t > 1.6: cooldown = random 2.2 – 3.2.

### 9.3 THE LAG SPIKE (blob, hop / spray / wasp summon)

Aim amount damps toward (LOS ? 1 : 0) at rate 6. Keeps a **spray counter** and a **hop timer** (starts at 1).

**Hopping** (checked every frame before decisions, even during cooldown, but not while an attack runs): hop timer −= dt. If on the ground, hop timer ≤ 0 and dist > 4: hop timer = random 1.6 – 2.4; velocity = (nx × 11, 13, nz × 11) toward the target (no speed modifier); on-ground cleared; "hopping" set. With gravity 24 that is ~1.08 s of air and ~12 m of travel. On **landing** (hopping flag set and on the ground): hopping cleared; stomp sound; shake += 0.4; a black pool decal of size 3.5 at the feet; every alive target within horizontal 4.5 and |Δy| < 2.5 takes **14 × damage multiplier** and knockback 8 away from the boss centre.

Edge case: an attack can begin while the boss is airborne mid-hop (decisions only need cooldown ≤ 0 and line of sight). The hop timer and the landing check are skipped while the attack runs, so if it lands during the attack, the landing slam fires on the first frame after the attack ends (the hopping flag is still set and the boss is on the ground).

**Decision** (no attack, cooldown ≤ 0, LOS):
- If spray counter mod 3 == 2 → **summon**, spray counter += 1.
- Else if dist < 34 → **spray**.
Rhythm: spray, spray, summon.

**Movement** (no attack, not mid-hop): LOS and dist < 14 and |dy| < 2 → steer straight at 3.0 (accel 30); else path-follow at 3.0. Face the target if LOS.

**Spray**: face the target, damp (rate 6). Nine shots, shot k (0..8) fires when t > 0.6 + 0.09 k (so between 0.6 s and 1.32 s). Origin = torso position + 0.8 up. Base angle = direction to the target's feet; shot angle = base + (k − 4) × 0.19 (a fan of ±0.76 rad, 43.5°, centred on the target). Direction = (sin(angle), 0.18 + random(−0.05, 0.05), cos(angle)) normalised. Each is a **blast projectile**: speed 20, damage 11 × damage multiplier, black, thickness 0.3. The enemy shot sound plays on the first. Ends at t > 1.8: cooldown = random 2.4 – 3.4; spray counter += 1.

**Summon**: face, damp. At t > 0.8 (once): roar; 40 black strokes at speed 10 (life 0.5, size 0.05). Spawn up to 3 flyers while (live flyers + spawned this summon) < 6, at centre + (random ±2, 2 + i, random ±2), skipping the spawn animation. Ends at t > 1.4: cooldown = random 2.4 – 3.4.

---

## 10. Flyer (backdrop wasp)

Flyers ignore the ground brain entirely (they also skip the "wander" rule: a flyer keeps orbiting and climbing around the centre of its target even when that target is dead; only the dive requires a living target). Each frame: flight timer −= dt, cooldown −= dt. c = target centre.

**Fly-to primitive** (target point, speed, accel): desired velocity = unit(target − body) × speed × speed multiplier; change velocity toward it by at most accel × dt; if within 0.3 of the point, velocity ×= max(0, 1 − 4 dt).

Flight phases:

- **Orbit**: angle = atan2(body.x − c.x, body.z − c.z) + orbit direction × 0.45; want = (c.x + sin(angle) × 11, c.y + 6 + sin(1.3 × age) × 1.5, c.z + cos(angle) × 11); fly-to at 6.2, accel 22. So it circles at radius 11, 4.5 – 7.5 above the target's centre. If cooldown ≤ 0, the target is alive and there is LOS from the flyer centre to the target centre → **dive**: flight timer = 1.6, hit flag cleared, dive sound. A buzz sound triggers with probability 1.5 × dt per frame.
- **Dive**: fly-to the target centre at 16, accel 28. When the centre-to-centre distance < 1.4 and it has not hit yet: mark hit; ask the target to block the melee; if blocked → stunned (flight phase and state), age reset, velocity = (−0.3 vx, −3, −0.3 vz); else the target takes 10 × damage multiplier from the flyer centre and knockback 3 along the flyer's velocity direction. The dive ends (→ **climb**, flight timer 1.1, cooldown = random 2.8 – 4.2) when the flight timer ≤ 0, or it has hit, or the body bumped a wall.
- **Climb**: want = (c.x + (body.x − c.x) × 1.5, c.y + 8, c.z + (body.z − c.z) × 1.5), fly-to at 6.2, accel 18; when the flight timer ≤ 0 → orbit.
- **Stunned**: gravity −20 /s². When on the ground or age > 2.2 → climb, flight timer 1.2, state hunt.

Obstacle avoidance every frame: if speed > 0.5, cast 3.5 along the velocity from the centre; on a hit, velocity += surface normal × 14 dt and vel.y += 12 dt. Cast 2.5 straight down from the centre; on a hit vel.y += 12 dt. Facing follows the velocity direction whenever speed² > 0.1.

Flyers are excluded from pairwise separation and from the target-space push, do not fall-die differently (the y < −6 rule still applies), and on death tumble away whole (section 13.1).

---

## 11. Enemy projectiles

One pool, max 240 live projectiles; when full the oldest is dropped. Each projectile: id (shared id counter unless supplied), position, previous position, velocity = direction × speed, damage, owner enemy, life 4 s, deflected flag, tone, thickness, origin (spawn point, used as the "hit from" position), blast flag.

Rendering: a box along the velocity, cross-section = thickness, length = thickness for blast projectiles, otherwise clamp(speed × 0.02, 0.35, 0.9). Colour = tone.

Update per projectile each frame:

1. life −= dt; remove if ≤ 0.
2. previous = position. Blast projectiles fall: vel.y −= 9 dt. position += velocity × dt.
3. Segment previous → position. Zero length: keep, skip.
4. **World**: ray along the segment ignoring see-through geometry. Hit: blast → **burst** at the hit point; else bullet-impact decal in the projectile's tone at the hit point/normal and a 50 % chance of the impact sound. Remove.
5. **Not deflected** — test against every alive target in order:
   - catch radius = max(blast ? 0.9 : 0.5, local player ? its block radius : 0). The block radius is 0.95 while the local player is blocking and off block-cooldown, else 0.
   - Segment-vs-target test (11.1) with the catch radius; skip the target if it fails.
   - Local player: ask it to **deflect** the projectile (section 18.4). If it answers:
     - "returned" → redirect (11.2) and keep the projectile;
     - "blocked, not returned" → the projectile is destroyed with a small red burst (5 strokes, speed 6, life 0.18, size 0.03).
     If it did not deflect: re-test with the tight radius (0.9 blast / 0.5 else); on a hit, blast → burst at the projectile position; else the player takes the projectile's damage with "from" = the projectile's origin. Consumed either way.
   - Remote player: segment test with the tight radius; on a hit the projectile simply disappears on this machine (that player's own client handles their damage).
6. **Deflected**: ray along the segment against enemy hit spheres (ignoring nothing). Hit: blast → burst at the point; else damage that enemy with the projectile's damage, source "deflect", the hit part, crit if the part is the head. Remove.

### 11.1 Segment-vs-target test

Three sample points on the target: its centre, its eye, and centre − 0.55 in y. For the first two use radius r; for the low point use r − 0.05. Hit if the closest point on the segment to any sample is within that radius.

### 11.2 Deflect / redirect

Flags the projectile deflected, tone → blue, damage ×= 3.5 for a perfect parry else 2.2, life = 3. Target choice: on a perfect parry, the owner if alive; otherwise the nearest alive enemy within 70 inside a cone of half-angle 0.7 rad (≈ 40°, i.e. dot with forward ≥ cos 0.7 ≈ 0.765) around the player's forward that has LOS from the player's eye to the enemy centre (ignoring see-through geometry; enemies closer than 0.01 are skipped), falling back to the owner if alive. New speed = old speed × 1.6 toward the chosen enemy's centre, or along the player's forward if none. Effects: 10 orange sparks at speed 9, 8 blue strokes at speed 4 life 0.2.

**Deflect arc** (used by the player's guard): every non-deflected projectile within a range and cone of the player is redirected as a non-perfect parry; returns the count.

### 11.3 Burst (blast projectile explosion)

Black explosion effect radius 2.5 at the point; explosion sound. The **local player** (only) within 3.5: damage = projectile damage × (1 − d / 3.5), knockback 6 away. On the authoritative side, enemies within 3.5 take blast damage of 1.5 × the projectile damage (section 12.5), excluding the owner.

---

## 12. Damage, hit reactions, shields, yank

### 12.1 Damage entry point

`damage(enemy, amount, info)` where info carries: hit point, hit direction, part name (head/torso/hips/limb/shield), source string, crit flag. Sources with special meaning: "katana", "focus", "deflect", "blast", "fall"; gun sources are arbitrary strings. Ignored if the enemy is dead. Mirror behaviour: section 17.4.

### 12.2 Where the global multipliers apply

- **Speed multiplier**: the steer primitive (all path following and direct chases), the flyer fly-to (orbit, dive, climb), the hitbox charge run. It does **not** apply to ranged strafing/back-off, the rusher's retreat/back-off, the lagspike hop, or projectile speeds.
- **Damage multiplier**: enemy bullets and pellets, rusher slash, bomber blast, flyer dive, admin stomp, hitbox charge and wipe, lagspike spray bombs and hop landing. It does **not** apply to the admin's thrown bomb. It **also multiplies damage the enemy takes** (see 12.3) — a faithful quirk of the design: the "hits harder" modifier (×1.4) makes enemies take 40 % more damage too, and the "fast" modifier (×0.85) makes them 15 % tougher.

### 12.3 Shield hits

If the hit part is "shield": orange sparks (8, speed 8) opposite to the hit direction; shield-hit sound; if the source is "katana" or "blast", shield hp −= 1 and at 0 the shield breaks (12.4). A neutral hitmarker is shown. **No health damage**; nothing else happens. Bullets therefore never break the shield; only slashes and explosions do (two of them).

### 12.4 Shield break

The shield plate detaches as debris (initial velocity (random ±3, 4, random ±3), spin ±6 per axis, radius 0.4, no blood, life 8); the shield hit sphere is removed; shield-hit sound; score +40 with label "SHIELD BROKEN".

### 12.5 Health damage

1. amount ×= damage multiplier.
2. hp −= amount; flinch = 1; flash on for 0.07 s (the model draws solid-filled).
3. Blood in the enemy's tone (black if black-toned, else red) at the hit point along the hit direction (or straight up if none), amount clamp(0.5 + amount / 70, 0.5, 2.2), × 1.6 for bosses.
4. Sound: headshot cue on crit, else the hit cue. Hitmarker (kill = hp ≤ 0, crit). Controller rumble (0.1 low, 0.3 high, 30 ms) unless the source is "deflect".
5. If in spawn state → hunt at full scale.
6. Boss → boss bar callback.
7. hp ≤ 0 → hit-stop (0.05 s on crit else 0.025 s, time scale 0.25) then **kill** (section 13).

**Blast damage helper** (point, radius, base damage, excluded enemy): every alive enemy other than the excluded one whose centre is within radius takes base × (1 − 0.6 × d / radius), source "blast", part torso, direction away from the point, no crit.

### 12.6 Bomber detonation

`explode(enemy, scale)`; R = 4.2 × scale. Black explosion effect radius R; explosion sound. Every alive target within R of the enemy centre (3-D distance) takes 24 × damage multiplier × sqrt(1 − d / R) from the centre and knockback 7 away. Other enemies within R take blast damage 70 (excluding the bomber; the blast helper's falloff applies, so 70 × (1 − 0.6 d / R)). If the bomber was still alive: mark dead, alive count −= 1, fire `on kill` with source "blast", direction up, overkill = true. The model is removed immediately and the dead timer set to 99 so the record is cleaned up at the end of the same update. Because a bomber has 26 hp, one detonation kills every other bomber within R, which detonates them in turn (chain reaction, each at the 0.8 "killed" scale).

### 12.7 Yank (grapple pull)

Bosses: flinch = 1 only. Others: state stunned, age 0, stun duration 1.3, path cleared, flyer flight phase stunned; velocity = unit(target point − body) × clamp(distance × 1.6, 10, 26) with vel.y = clamp(distance × 0.5, 4, 9); on-ground cleared; blood 0.4 at the centre along that direction.

### 12.8 Query helpers offered to weapons

- **raycast**(origin, dir, max distance, optional enemy to ignore) → nearest hit {enemy, part, distance, point} over all alive enemies' hit spheres, or none.
- **in arc**(pos, dir, range, cos half-angle) → alive enemies whose centre distance (minus 1.2 for bosses) ≤ range + 0.3 and either within 0.3 or inside the cone; sorted nearest first, each with its distance.
- **nearest visible**(from, forward, cos half-angle, max distance) → nearest alive enemy inside the cone with LOS (ignoring see-through geometry).
- **blast enemies**, **yank**, **damage** as above; **eye**(enemy) → head world position.

---

## 13. Death, gore, corpse cleanup

### 13.1 Kill

Common: alive = false, state dead, dead timer 0, alive count −= 1, velocity zeroed, laser destroyed, face swapped to X-eyes. dir = info direction (or (0, 0.5, 0)) normalised.

- **Bomber**: detonate at scale 0.8 (R = 3.36); `on kill(enemy, info, overkill = true)`; done.
- **Flyer**: enemy-death sound; the whole model is handed to the debris system with velocity dir × 4 + (random ±2, 1, random ±2), spin ±9 per axis, radius 0.5, bleeding, life 8; blood 1 at the centre; `on kill(…, true)`; done.
- **Everyone else**: enemy-death sound, then:
  - overkill = (−hp > 0.35 × max hp) or source is katana, or crit, or source is deflect, or source is blast.
  - A "detach" operation hands a body part to the debris system with velocity dir × random(3 – 7) + extra, +random(2 – 5) up, spin ±8 per axis, bleeding, life random 7 – 10.
  - If overkill: gib sound. If crit, or ((katana or focus) and 35 % chance): detach the head (extra (±2, 3, ±2), radius 0.25) and start an tone fountain at the torso + 0.35 up, upward, 0.9 s. If katana or focus: 40 % right arm, 30 % left arm (radius 0.12, extra (±3, 2, ±3)), else the torso (radius 0.3, extra (±2, 2, ±2)) plus a 0.7 s fountain at the hips. Else if source is deflect or blast, or −hp > 0.6 × max hp: detach k random distinct parts from {left arm, right arm, left leg, right leg, torso} where k = 5 for bosses else random 1 – 2 (radius 0.15).
  - Start a **topple**: axis x or z (50/50); sign = +1 if dir.z > 0 else 50/50 ±1.
  - Blood pool decal at the feet of size random 1.1 – 1.8 (× 2.5 for bosses) in the tone; blood 1.2 at the centre.
  - 60 % chance the weapon prop detaches (radius 0.08).
  - If a shield is still attached, break it (12.4).
  - Bosses: black explosion radius 6 at the centre, explosion sound, boss bar callback (bar hides).
  - `on kill(enemy, info, overkill)`.

### 13.2 Fall death

Body y < −6 → kill with source "fall" and direction up (no crit, no overkill unless the hp test says so — hp is unchanged so overkill is false).

### 13.3 Boss death

As above plus the explosion; the game layer hides the boss bar and clears its boss reference.

### 13.4 Corpse update

dead timer += dt. If the model was not handed to debris and a topple exists: topple t rises at 2.2 per second to 1; angle = sign × π/2 × (1 − (1 − t)²) (ease-out) applied around the chosen axis on the model root (the whole figure tips over in ~0.45 s). After 8.3 s the corpse shrinks: scale = (9 − dead timer) / 0.7 × type scale. At dead timer > 9 the record is removed. The model keeps its death yaw.

---

## 14. Animation and telegraphs (gameplay-relevant)

All rotations in radians. s = sin(phase), c = cos(phase), w = walk amount.

- Walk amount eases toward clamp(horizontal speed / 4, 0, 1) at rate 10. Phase advances by (horizontal speed × 2.2 + (3 if speed > 0.4)) per second.
- Legs: thigh L = 0.9 s w, thigh R = −0.9 s w; shins max(0, c) × 1.1 w and max(0, −c) × 1.1 w. Airborne: thighs −0.5 / 0.6, shins 1.0 / 0.5 (a tucked jump pose).
- Head tracks the target: yaw within ±1.1 of the body (minus torso twist), pitch = −atan2(dy, horizontal) × 0.8 clamped ±0.6; slight roll with the walk.
- **Hit flinch**: torso pitches forward by flinch × 0.35 – 0.4 (decays at rate 9).
- **Stunned pose** (ground): torso pitched 0.6, both arms thrown up (−2.5), legs splayed (−0.8 / 0.9).

Bomber / blobs: arms held up (−2.4) waving ±0.4 at 20 rad/s while walking; hips bob; **fuse lit**: torso shakes ±0.15 at 40 rad/s and the head twists ±0.3 at 30 rad/s, and the spark flares (4.4). The lit bomber is also drawn solid-filled (section 7.1).

Rusher: wind-up = clamp((0.55 − attack timer) / 0.37, 0, 1) while attack timer > 0.18 — the right arm rises up and back (−2.2 pitch, +0.7 roll), forearm folds, torso leans back −0.25 and twists +0.5. Strike = 1 − attack timer / 0.18 during the last 0.18 s — the arm chops down (+1.5), torso lunges forward +0.55 and twists −0.6. Player-readable window: 0.37 s of wind-up before the hit.

Ranged: aim amount blends from a swinging-arms walk to a raised-gun pose (right arm −1.35 pitch, left arm −1.2 pitch with 0.6 yaw, torso twisted −0.35). Shieldbearer's left arm is fixed holding the shield (−1.2 pitch, 0.3 yaw, forearm −0.9).

Admin: stomp raise = clamp(t / 0.6, 0, 1) for t < 0.75, then slam = 1 (arm −2.4 pitch raise, +0.9 slam; torso −0.3 raise, +0.5 slam). Throw raise = clamp(t / 0.5, 0, 1) for t < 0.6.

Flyer: wings flap ±0.35 at 14 rad/s; body rolls with lateral velocity (±0.8) and pitches with vertical velocity (±0.6); while stunned it spins about its length at 12 rad/s.

---

## 15. Spawn director (solo waves)

The director lives in the game layer but is specified here because it defines wave composition.

### 15.1 Roster and unlock waves

| Type | First wave | Base weight |
|---|---|---|
| grunt | 1 | 10 |
| rusher | 2 | 6 |
| bomber | 3 | 3 |
| sniper | 3 | 4 |
| flyer | 4 | 4 |
| heavy | 5 | 4 |
| shield | 6 | 4 |

Effective weight on wave n for a type unlocked at wave f: w × min(1, 0.3 + 0.25 × (n − f)). A freshly unlocked type has 30 % of its weight, growing 25 points per wave to full at f + 3. The wave queue is filled by weighted random draws from all unlocked types.

### 15.2 Wave modifiers

| Index | Name | speed × | damage × |
|---|---|---|---|
| 0 | (none) | 1 | 1 |
| 1 | CAFFEINATED · they move fast | 1.35 | 0.85 |
| 2 | JUICED · they hit harder | 0.9 | 1.4 |
| 3 | SWARM · more of them, thinner | 1.15 | 0.9 |

Allowed on wave n: boss waves and n < 4 → only index 0; n < 6 → indices 0–2; else all four; chosen uniformly at random among the allowed. Remember the multiplier quirk in 12.2.

### 15.3 Wave setup (wave n)

- queue cleared; first spawn timer = 2 s; boss reference cleared; boss bar hidden.
- boss wave if n > 0 and n mod 5 == 0.
- max alive = min(3 + floor(0.8 n) + (swarm ? 3 : 0), swarm ? 20 : 16).
- count = round(min(4 + 1.7 n, 28) × (swarm ? 1.35 : 1)).
- Boss wave: count = min(6 + n, 14) and the boss type (list index (n/5 − 1) mod 3) is pushed **first** into the queue.
- Then `count` weighted draws are appended.
- Messages: boss wave "WAVE n / <BOSS NAME> IS COMING" (3 s) with a boss roar at the player's position; otherwise "WAVE n" with a subtitle (2.6 s): on wave 1 "they are pushing · hold the site", otherwise the modifier's name, or (no modifier) one of "tone harder", "keep sketch", "stay off the ground", "swing for it", "return their bullets" at random. Wave sound. A control tip (7 s) on waves 1–5 (grapple, block, airborne kills, grenade, double jump). The player gets +1 grenade (capped at the max, 5). 7 pickups are placed at random pickup spots: 5 ammo, 2 health. On every wave n ≥ 5 with n mod 5 == 0 that is beyond the saved checkpoint, the checkpoint is saved and the kill feed shows "CHECKPOINT · WAVE n".
- Jumping to a checkpoint wave and restarting both clear all enemies and projectiles and reset the two modifiers to 1 before starting the wave.

### 15.4 Spawn loop (every frame in play)

- During an intermission: count it down, show "next wave in N"; at 0 start wave n + 1.
- Else if the queue is non-empty and alive < max alive: spawn timer −= dt; at ≤ 0: spawn timer = max(0.7, 2.9 − 0.13 n); pop the next type and spawn it at a picked position (15.5).
- If the queue is empty and alive == 0: intermission = 8 s; "WAVE n CLEARED / catch your breath · +200n" (2.5 s); score +200 × n (combo multiplier applies, no label); wave-clear sound; the player heals 40 (capped at 120). Boss-summoned minions count as alive, so they must die too.
- The director only runs in solo play; in the online (versus) mode no enemies are spawned, although the enemy manager still updates (there is nothing to update).
- HUD "enemies left" = alive + queued.

### 15.5 Boss health scaling

When a boss is spawned on wave n: hp = max hp = round(base hp × (1 + 0.35 × floor((n − 5) / 15))). Waves 5–19: ×1; 20–34: ×1.35; 35–49: ×1.7; and so on.

### 15.6 Spawn position rules

Let P = the player's feet position. The level provides ground spawn spots, sniper perches, bounds, and the player start.

- **Sniper**: choose from the sniper perches; otherwise like the default rule.
- **Flyer**: random angle, radius 22 – 32 around P, x/z clamped to the level bounds inset by 4, y = P.y + 12 – 18.
- **Boss**: a spot "fits" if the box from (spot − 1.1, spot.y + 0.1, spot − 1.1) to (spot + 1.1, spot.y + 5.2, spot + 1.1) is free of world geometry. Prefer a fitting spot farther than 20 from P; else any fitting spot; else up to 200 random tries at radius 22 – 40 around P (clamped to ±44), dropping a ray from y = 30 down 40 to find the ground, accepting y > −3 and fitting; else the player start.
- **Default**: candidates = spots with 14 < distance to P < 48; if fewer than 2, spots with distance > 14; prefer candidates **not visible** from the player's eye to (spot + 1.2 up); fall back to visible candidates, then to any spot.

---

## 16. Score, kill labels and drops

Handled by the game layer's `on kill(enemy, info, overkill)`:

- kills += 1; combo += 1; combo timer = 3.5 s. Score multiplier = 1 + 0.25 × min(combo, 9).
- Base points = the type's score value; label = the type's display name. Then, in order: crit → label "HEADSHOT", +60. Source katana → label "SLICED" if overkill else "CUT DOWN", +50. Source focus → "EXECUTED", +150. Source deflect → "RETURN TO SENDER", +120. Source fall → "FELL OFF THE MAP". Otherwise, if the player is airborne and the source is not deflect → label += " · AIRBORNE", +40.
- Katana/focus kills feed the katana streak (3 → focus mode); a non-blast kill of another source resets it.
- Kill sound (emphasised on crit or boss).
- **Drops** at the enemy's feet: 50 % ammo pickup, 12 % health pickup, 38 % nothing. A pickup is placed 0.6 above the given position, bobs ± 0.12 and rotates, lives 45 s, and is collected when within 1.5 of the player's centre: ammo adds round(0.4 × max reserve) to every gun's reserve, capped at its maximum, plus +1 grenade capped at 5 ("+AMMO · +GRENADE"); health = +35 hp ("+35 HP"). The bomber's `on kill` fires from its detonation, so bombers also drop.

Scores awarded by other systems for interacting with enemies: shield break +40 "SHIELD BROKEN" (from the enemy system itself); grapple yank +30 "YANKED"; melee parry +40 "BLOCKED"; bullet block +15 "BLOCKED" or +60 "PERFECT PARRY". All go through the same combo multiplier.

---

## 17. Network replication

Designed contract for host-authoritative enemies. In the design the hooks exist and are complete, but the shipped online mode is player-versus-player with no enemies, so nothing wires them; an implementation that adds co-op must follow this contract.

### 17.1 Roles

- **Host** (mirror flag false): runs sections 5–13. Emits `on spawn(enemy)` on every spawn, `on kill` on every death, and the projectile `on fire(projectile)` for every projectile it creates locally (those created with a supplied id do not re-emit).
- **Client** (mirror flag true): creates enemies with `spawn(type, position, host id)`, applies snapshots, runs projectiles locally (so the local player takes hits from them), reports hits via `on client hit`, and runs death visuals via `kill mirror`.

### 17.2 Snapshot row (host → clients, every few frames)

One array per **alive** enemy, fields in this exact order:

| # | Field | Encoding |
|---|---|---|
| 0 | enemy id | integer |
| 1 | body x | rounded to 2 decimals |
| 2 | body y | 2 decimals |
| 3 | body z | 2 decimals |
| 4 | yaw | 2 decimals |
| 5 | state code | 0 spawn, 1 hunt, 2 stunned, 3 dead (unknown → 1) |
| 6 | hp | rounded integer |
| 7 | aim amount | 2 decimals |
| 8 | attack timer (rusher swing) | 2 decimals |
| 9 | fuse lit | 1 if fuse timer ≥ 0 else 0 |
| 10 | boss attack active | 1 if a boss attack sub-state exists else 0 |

Dead enemies are omitted; death is sent separately (17.5).

### 17.3 Client application and interpolation

For each row whose id maps to an alive local mirror:

- Shift the previous "newest" snapshot to "older" (if there was none, synthesise one from the current position/yaw stamped 0.08 s before now). Store the row as the newest with the receive time.
- State: if the mirror is still in spawn and the row says otherwise, jump to that state at full scale; if not in spawn, adopt the row state.
- Copy hp, aim amount, attack timer. Fuse timer = 0.5 if the fuse flag is set, else −1. Boss attack: if the flag is set keep the existing sub-state or create a placeholder "stomp at t = 0.3"; else clear it.
- Bosses: boss bar callback.

Mirror per-frame update: age, corpse update, flash/flinch decay and the spawn growth animation run as on the host (the spawn animation also ends locally at age 0.6 even without a snapshot). Rendering lags 100 ms behind the newest snapshot: span = max(0.02, newest.time − older.time); k = clamp((now − 0.1 − older.time) / span, 0, 1.2) (up to 20 % extrapolation); position = lerp(older, newest, k); velocity is derived from the position change (clamped to 30, used for animation); on-ground = |derived vy| < 0.5; yaw = shortest-path lerp. Then animate (head tracking uses the local player's centre), sync hit spheres, and set the sniper laser visible only while aim amount > 0.9. Note that the mirror never creates a laser object (only the host's fire control does), so in the design a mirrored sniper shows no beam; an implementation that wants the telegraph on clients must build the beam from the snapshot (aim amount ≥ 0.9 means "charging"). Projectiles update normally. Corpses are removed after 9 s and their ids released. No AI, gravity, fall death, target-space push or separation runs on the mirror.

### 17.4 Client hit reporting

On the client, `damage()` does not touch health: for non-shield hits it sets flinch = 1, flashes 0.07 s, spawns blood (amount clamp(0.5 + amount / 70, 0.5, 2.2), tone by type) and a non-kill hitmarker; then calls `on client hit(enemy, amount, info)` so the game layer can send (id, amount, part, source, crit, point, direction) to the host, which applies the real damage.

### 17.5 Death replication

Host → clients: (enemy id, info with source, crit, direction as a 3-array, point as a 3-array). The client calls `kill mirror(id, info)`, which runs the full death visuals (section 13) with the `on kill` callback suppressed so no score is awarded locally.

### 17.6 Projectiles

The enemy system provides the hook; the message layout below is the intended (not shipped) contract. Host → clients on `on fire`: (id, position, direction, speed, damage, owner id, tone, thickness, blast flag). Clients create it with the same id (creating with a supplied id does not re-fire the hook). Client-side bursts do not damage enemies (the blast helper is skipped in mirror mode). Player damage from projectiles is always applied locally on the machine of the player hit: a remote player's hit simply removes the projectile on this machine.

---

## 18. Interfaces with other subsystems

### 18.1 Game layer → enemy manager

- `spawn(type, position, optional id)`, `clear()` (removes everything including projectiles), `update(dt)`, `alive` count, enemy list, `mods.speed`, `mods.damage`, `mirror` flag, `targets()` provider, the callbacks in section 1.
- Context expected by the manager: scene, world (physics), nav, effects, HUD, input, audio, game (hit-stop and score), player, optional targets provider.
- The game clamps the frame time to ≤ 0.05 s and passes a scaled time (× hit-stop scale, or × 0.26 while focus mode is active) to the enemy update, so all enemy timers slow down under hit-stop and focus.

Callers into the enemy system (what they pass):

| Caller | Call | Details |
|---|---|---|
| guns | raycast(muzzle origin, direction, 300) then damage | source = the weapon kind string; crit if the part is "head"; damage = base × head multiplier (× distance falloff for weapons that have it). A world hit closer than the enemy hit wins. |
| katana slash | in arc(player eye, forward, 3.0, cos 0.95) then damage(…, 75, part "torso", source "katana", no crit) | hit point = enemy centre + random(−0.2, 0.4) in y; direction = forward tilted sideways by the slash direction and down 0.35 |
| focus execute | damage(target, 100000, part "head", source "focus", crit true) | always a kill; only targets not in spawn state within 24, in view and with LOS |
| grenade | blast enemies(centre + 0.25 up, 6.4, 120, none) | thrower's machine only |
| grapple | raycast(eye, forward, min(50, wall distance + 0.5)); if none, a forgiving search for an alive non-spawn enemy whose centre lies within lateral tolerance 1.1 + 0.06 × distance of the aim line (distance 1.5 – min(45, wall + 1.5), needs LOS) | on reel-in contact: yank(enemy, player centre) and +30 "YANKED" |
| HUD boss bar | reads boss hp / max hp every frame while a boss is alive | |
| audio intensity | (alive + queued + 2 × remote players) / 12, clamped 0 – 1, × 0.25 during intermission | |

### 18.2 Physics world (used by enemies)

- make body(position, half width, height, step height) → body with position, velocity, on-ground, hit-wall + wall normal, hit-ceiling flags, always-step and no-snap options.
- move body(body, dt): swept AABB move with step-up and sub-stepping; sets the flags above.
- raycast(origin, dir, max distance, ignore predicate) → {distance, point, normal, box} or none.
- has line of sight(a, b, ignore predicate) → bool. The "see-through" predicate ignores boxes tagged no-shoot (railings and the like).
- overlaps body(body) → bool (used to validate the target-space push).
- ground below(x, y, z, max drop) → ground y (boss spawn search).

### 18.3 Nav grid

find path(from, to) → ordered list of waypoints (x, y, z) from the nearest node to `from` toward the nearest node to `to`, with a **complete** flag (false when the search hit its expansion limit of 40 000 nodes or the goal was unreachable, in which case the path ends at the expanded node with the lowest heuristic, i.e. closest to the goal); none if no node is near either end. The nearest-node search looks 3 cells around `from` (accepting nodes from 3 below to 2.2 above) and 4 cells around `to` (8 below to 2.2 above), falling back to the best node by horizontal distance + 2 × |Δy| if none qualifies. Nodes are 1 m apart at cell centres on every walkable surface (each box top between −5 and 70 not flagged no-nav, with 0.6 × 1.35 × 0.6 of clearance above); links join the 8 neighbours allowing up to 1.35 rise and 8 drop, need a 1.2 m tall clear corridor above knee height (so 1 m railings block), diagonal links need a node in both adjacent cells, and drops over 0.6 need a clear vertical column. Link cost = 3-D length, × (1 + 1.1 × rise) for rises over 0.6, + 0.35 × drop for drops over 0.6. A* with heuristic 1.15 × straight-line distance.

### 18.4 Targets (players)

Each target exposes: alive; body (feet position, velocity, half width 0.35, height 1.75 standing / 1.05 crouched); centre (feet + 0.55 × height); eye (feet + 1.6 standing / 0.88 crouched); forward vector; is-local flag; block radius; speed; take damage(amount, from position); knockback(direction, amount); try deflect(projectile); try block melee(enemy).

Local player:

- block radius = 0.95 while guarding and off block-cooldown, else 0. speed = 3-D velocity magnitude.
- take damage: hp −= amount (max hp 120); hurt overlay += amount / 40; screen shake += 0.2 + amount / 80; hurt sound; rumble; if a "from" position is given the HUD shows a damage direction indicator toward it; hp ≤ 0 → death.
- knockback(direction, amount): velocity += direction × amount, plus 0.5 × amount upward, on-ground cleared.
- try deflect(projectile) → false, or {perfect, returned}: refuses unless alive, guarding, and off block-cooldown, and requires the projectile's reversed flight direction to have dot ≥ 0.55 with the forward (flank/back shots pass); perfect if the guard came up < 0.26 s ago; returned = perfect or 35 % chance; sets a 0.19 s block-cooldown; plays parry effects and awards +60 "PERFECT PARRY" or +15 "BLOCKED"; hit-stop 0.07 (perfect) or 0.025 at scale 0.18.
- try block melee(enemy) → true when alive, guarding for less than 0.55 s (the parry window), off block-cooldown, and the enemy centre is within dot ≥ 0.35 of the forward from the eye; on success: parry sound, hit-stop 0.06 at scale 0.15, +40 "BLOCKED", rumble.

Remote players (versus mode; never targeted by enemies in the shipped game but the surface exists): block radius 0; speed 0; take damage forwards (amount, from) to that player's owner over the network; knockback is a no-op; try deflect always false; try block melee → true whenever the player is guarding (no parry window, no cooldown) and the enemy is within dot > 0.35 of the forward.

### 18.5 Effects

Calls made (parameters as listed in the sections above): stroke burst(pos, tone, count, speed, {life, size}); blood(pos, dir, amount, {tone}); sparks(pos, normal, tone, count, speed); explosion(pos, radius, tone); blood pool(pos, size, tone); fountain(pos, dir, duration, tone); debris(object, pos, velocity, angular velocity, {radius, blood, life}); tracer(from, to, tone, thickness, life); bullet impact(point, normal, tone); raw stroke particle spawn (stomp ring); screen shake accumulator.

### 18.6 HUD / game / input / audio

- HUD: hitmarker(kill, crit); boss bar via the `on boss` callback → set boss(name, hp fraction) / hide.
- Game: hit-stop(duration, time scale); add score(points, label).
- Input: rumble(low, high, milliseconds).
- Audio cues (positional unless noted): spawn, boss roar, enemy shot, shotgun, sniper aim, sniper shot, fuse tick, explosion, lunge, katana swing (miss), flyer dive, flyer buzz, stomp, hit enemy, headshot, shield hit, enemy die, gib, bullet impact.

### 18.7 Other players' models

The humanoid builder and weapon-prop builder are shared with the remote-player renderer (same skeleton, same hit sphere list without the shield).

---


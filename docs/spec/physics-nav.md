# Physics World, Navigation Grid, and Utility Helpers — Behaviour Specification

This document describes WHAT the physics, navigation, and utility subsystems do. An implementer must be able to build identical gameplay from this document alone.

All lengths are in world units (one unit is approximately one metre). All times are in seconds. The world axes are X (left/right), Y (up), Z (forward/back). Y increases upward.

## Table of contents

1. [Overview](#1-overview)
2. [Physics world](#2-physics-world)
   - 2.1 [Constants](#21-constants)
   - 2.2 [Colliders (static boxes)](#22-colliders-static-boxes)
   - 2.3 [Collider data flags](#23-collider-data-flags)
   - 2.4 [World life cycle: add, finalize, remove, clear](#24-world-life-cycle-add-finalize-remove-clear)
   - 2.5 [Spatial hash](#25-spatial-hash)
   - 2.6 [Overlap queries](#26-overlap-queries)
3. [Character bodies](#3-character-bodies)
   - 3.1 [Body record](#31-body-record)
   - 3.2 [Body collision box](#32-body-collision-box)
   - 3.3 [Body sizes used in the game](#33-body-sizes-used-in-the-game)
   - 3.4 [Axis push-out (depenetration)](#34-axis-push-out-depenetration)
   - 3.5 [Horizontal move with step-up](#35-horizontal-move-with-step-up)
   - 3.6 [One integration step](#36-one-integration-step)
   - 3.7 [Sub-stepping of fast bodies](#37-sub-stepping-of-fast-bodies)
   - 3.8 [Gravity, jump, and slopes (owned by other subsystems)](#38-gravity-jump-and-slopes-owned-by-other-subsystems)
   - 3.9 [Worked examples](#39-worked-examples)
4. [Raycast, sweeps, ground-below, and line of sight](#4-raycast-sweeps-ground-below-and-line-of-sight)
   - 4.1 [Raycast](#41-raycast)
   - 4.2 [Ignore predicates](#42-ignore-predicates)
   - 4.3 [Ground below](#43-ground-below)
   - 4.4 [Line of sight](#44-line-of-sight)
   - 4.5 [Sweep semantics used by projectiles and particles](#45-sweep-semantics-used-by-projectiles-and-particles)
5. [Navigation grid](#5-navigation-grid)
   - 5.1 [Constants](#51-constants)
   - 5.2 [Grid layout](#52-grid-layout)
   - 5.3 [Node generation (walkable surfaces)](#53-node-generation-walkable-surfaces)
   - 5.4 [Link generation](#54-link-generation)
   - 5.5 [Link cost](#55-link-cost)
   - 5.6 [Nearest node](#56-nearest-node)
   - 5.7 [Path finding (A*)](#57-path-finding-a)
   - 5.8 [Path smoothing and following](#58-path-smoothing-and-following)
   - 5.9 [Random node](#59-random-node)
   - 5.10 [Rebuild rules](#510-rebuild-rules)
6. [Utility helpers](#6-utility-helpers)
   - 6.1 [Scalar helpers](#61-scalar-helpers)
   - 6.2 [Random helpers](#62-random-helpers)
   - 6.3 [Angle helpers](#63-angle-helpers)
   - 6.4 [Vector helpers](#64-vector-helpers)
   - 6.5 [Damped spring (scalar)](#65-damped-spring-scalar)
   - 6.6 [Damped spring (3-D)](#66-damped-spring-3-d)
   - 6.7 [Cooldown timer](#67-cooldown-timer)
   - 6.8 [Orientation helpers](#68-orientation-helpers)
7. [Interfaces with other subsystems](#7-interfaces-with-other-subsystems)

---

## 1. Overview

The physics subsystem is an **axis-aligned box world**. Every solid thing in a level is a static axis-aligned bounding box (AABB). There are no slopes, no rotated colliders, no capsules, and no dynamic rigid bodies. Moving characters are **axis-aligned boxes with a square footprint** ("bodies"). Movement is resolved by push-out along one axis at a time, with a step-up rule for stairs and ledges and a snap-down rule to keep bodies attached to the ground.

The navigation subsystem is a **multi-level grid** generated from the collision world. Every grid cell can hold several nodes, one per walkable surface at that XZ location. Nodes link to their eight neighbours. Paths are found with A*.

The utility module holds small math helpers (clamp, lerp, exponential damping, random ranges, angle wrapping), a damped spring (scalar and 3-D), a cooldown timer, and two orientation helpers.

---

## 2. Physics world

### 2.1 Constants

| Name (plain English) | Value | Meaning |
|---|---|---|
| Epsilon | 0.0001 | Skin thickness. The body's collision box is shrunk by this amount on every face. Push-out corrections add this amount so the body rests exactly flush with a surface without overlap. |
| Spatial hash cell size | 8 | Width and depth (X and Z) of one bucket of the spatial hash. The hash is two-dimensional; Y is not hashed. |
| Hash key offset | 4096 | Added to each cell index before the key is computed so negative indices produce positive keys. |
| Hash key stride | 8192 | Multiplier for the X index in the key. Key = (ix + 4096) × 8192 + (iz + 4096). |
| Push-out iterations | 4 | Maximum number of push-out passes per axis per step. |
| Push-out slack | 0.03 | Extra distance added to the requested move when deciding whether a correction "against the motion" is small enough to be trusted. |
| Step-up acceptance margin | 0.000001 | The stepped move must gain more than this much (squared horizontal distance) over the flat move to be accepted. |
| Step-up height tolerance | 0.001 | After a step-up the body may not end lower than its original height minus this value. |
| Sub-step cap | 10 | Maximum number of sub-steps per body per frame. |
| Minimum sub-step length | 0.2 | Lower bound on the distance a body may travel in one sub-step. |
| Sub-step fraction of half-width | 0.8 | A body may travel at most 0.8 × half-width per sub-step (but never less than 0.2). |
| Raycast default range | 1000 | Maximum distance if a caller gives none. |
| Raycast parallel threshold | 0.000000001 (1e-9) | A direction component with absolute value below this is treated as parallel to that axis's slabs. |
| Ground-below default drop | 100 | Maximum search distance of the ground-below query if none is given. |
| Line-of-sight minimum length | 0.0001 | Two points closer than this always have line of sight. |
| World bounds (informational) | min (−60, −20, −60), max (60, 80, 60) | Stored on the world. No subsystem reads this value in the design. It can be omitted. |

### 2.2 Colliders (static boxes)

A collider is one axis-aligned box. It is defined by:

- **min corner** (x, y, z) — the lowest coordinate on each axis;
- **max corner** (x, y, z) — the highest coordinate on each axis;
- **data** — a small record of flags and tags (see 2.3). The default is an empty record;
- **id** — the index in the box list at the time the box was added. It is never renumbered, even after another box is removed. Nothing reads it in the design;
- an internal **query stamp** used to avoid reporting the same box twice from one query (starts at −1).

The world copies the min and max values when the box is added. Later changes to the caller's min/max objects have no effect.

The level builder creates all colliders through one helper that takes a **centre X, bottom Y, centre Z, width, height, depth**. The collider then spans:

- X from centre X − width/2 to centre X + width/2
- Y from bottom Y to bottom Y + height
- Z from centre Z − depth/2 to centre Z + depth/2

So "y" for a level piece always means the bottom of the piece.

### 2.3 Collider data flags

| Flag | Type | Default | Meaning | Read by |
|---|---|---|---|---|
| noNav | boolean | false | The top face of this box is **not** a walkable surface for the navigation grid. The box still blocks nav clearance tests and still blocks movement. Used for rails, decorative posts, landing pads, the sky lid, breakable props, and thin lips. | Navigation node generation (5.3) |
| noShoot | boolean | false | Bullets, enemy projectiles, decal probes, line-of-sight checks, and particle sweeps pass through this box. Bodies still collide with it. Used for railings (1.0 tall, 0.12 thick). | The "see-through" ignore predicate (4.2) |
| noGrapple | boolean | false | The grappling hook cannot attach to this box. Used for the sky lid and the dome shell. | The player's "no grapple" ignore predicate (4.2) |
| tag | any | undefined | Free label given by the level builder. Nothing in physics reads it. | Level / gameplay only |
| breakable | object reference | undefined | Set by the level after the box is created. Points to the breakable-prop record that owns this box. When a hitscan weapon ray hits a box with this reference, the weapon subsystem calls the "break hit" hook with the prop, the weapon damage, the hit point and the ray direction. | Weapons subsystem |

Boxes can be created with any combination of these flags. The level's box helper also accepts a `noCollide` option; such a piece creates **no collider at all** (only visual geometry), so it never reaches the physics world.

### 2.4 World life cycle: add, finalize, remove, clear

- **Add box**: appends the box to the world's list. It does NOT insert it into the spatial hash. Queries and body movement do not see a box until the world is finalized. Raycasts DO see it immediately because raycasts scan the flat list (see 4.1).
- **Finalize**: clears the spatial hash and inserts every box in the list. The level builder calls this once after all colliders are added.
- **Remove box**: if the box is in the list, it is removed from the list and the whole spatial hash is rebuilt. If the box is not in the list nothing happens. Used when a breakable prop is destroyed.
- **Clear**: empties the list, empties the hash, and resets the query counter. Used before a different map is built into the same world instance.

### 2.5 Spatial hash

The hash maps a 2-D cell key to a list of boxes. When a box is inserted, it is added to every cell whose X index lies between floor(min.x / 8) and floor(max.x / 8) inclusive and whose Z index lies between floor(min.z / 8) and floor(max.z / 8) inclusive. Y is ignored. A box that spans many cells is listed in each of them.

The key of cell (ix, iz) is (ix + 4096) × 8192 + (iz + 4096). Any equivalent unique key works.

Each query increments a global query counter. When a query visits a box it stamps the box with the counter value; a box already stamped with the current value is skipped. This deduplicates boxes that span several cells.

### 2.6 Overlap queries

**Query (AABB)** — given a min and a max corner, returns every box that overlaps the query box. The test is strict on all three axes:

box.min.x < query.max.x AND box.max.x > query.min.x AND (same for Y) AND (same for Z)

Two boxes that only touch on a face do **not** overlap. The query visits only the hash cells covered by the query's X and Z extents, so it is cheap.

**Overlaps AABB** — true if the query returns at least one box.

**Overlaps body** — true if the body's collision box (3.2) overlaps at least one box.

Note that queries do not honour any ignore predicate. Rails (noShoot) and the sky lid still count as solid for all overlap and movement purposes.

---

## 3. Character bodies

### 3.1 Body record

A body is created from a position, a half-width, a height and an optional step height (default 0.55). It has these fields:

| Field | Initial value | Meaning |
|---|---|---|
| position | copy of the given position | The **centre of the feet**: X and Z are the centre of the footprint, Y is the bottom of the body. |
| velocity | (0, 0, 0) | Units per second. |
| half-width | as given | Half of the footprint side. The footprint is a square of side 2 × half-width. |
| height | as given | Distance from feet to top. Other subsystems may change this at runtime (the player crouches by setting a smaller height). |
| step height | as given (default 0.55) | Maximum ledge height the body climbs automatically while moving horizontally. Also the probe distance of the ground snap. |
| on ground | false | True after a step in which the body was pushed **up** by a surface (or snapped down to one). |
| hit wall | false | True after a step in which horizontal motion was blocked. |
| hit ceiling | false | True after a step in which the body was pushed **down** by a surface. |
| wall normal | (0, 0, 0) | Unit vector pointing away from the wall that blocked the body (see 3.5). |
| land velocity | 0 | The vertical velocity the body had at the instant it was pushed up by ground during the step (negative when it was falling). |
| no snap | false | If true, the ground snap (3.6) is disabled. |
| always step | false | If true, the step-up rule is allowed even when the body was not on the ground at the start of the step. |
| blocked-X, blocked-Z | 0 | Internal. The sign (−1, 0, +1) of the last push-out along X and Z in the most recent horizontal move. |

### 3.2 Body collision box

The body's collision box, computed whenever needed from the current position:

- min = (x − half-width + ε, y + ε, z − half-width + ε)
- max = (x + half-width − ε, y + height − ε, z + half-width − ε)

where ε is the epsilon 0.0001. The box is therefore a fraction smaller than the nominal body on every side. This lets a body rest exactly at y = surface height, or stand exactly flush against a wall, without being counted as overlapping.

### 3.3 Body sizes used in the game

These values are chosen by other subsystems and passed to the body constructor. They are listed here because the collision behaviour depends on them.

| Body | Half-width | Height | Step height | Always step | No snap |
|---|---|---|---|---|---|
| Local player, standing | 0.35 | 1.75 | 0.55 | false | true while grappling or while vertical velocity > 0.5; false otherwise (set every frame) |
| Local player, crouching / sliding | 0.35 | 1.05 | 0.55 | false | same rule |
| Remote (network) player | 0.35 | 1.75 | — | — | — (never moved by physics; position and on-ground flag arrive over the network) |
| Ground enemy | min(0.33 × scale, 0.9) | 1.85 × scale | 0.6 (1.2 for bosses) | true | false |
| Flying enemy | 0.45 | 0.8 × scale | 0.6 (1.2 for bosses) | true | true |

"scale" is the enemy type's size multiplier (1 for normal enemies; larger for bosses).

The player's uncrouch check: when the player wants to stand, its height is set to 1.75 and the world's overlaps-body test is run; if the taller box overlaps anything, the player stays crouched.

### 3.4 Axis push-out (depenetration)

This is the core operation. Inputs: a body, one axis (X, Y or Z), and the signed distance the body just moved along that axis ("move"). Output: the sign of the push that was applied (−1, 0 or +1).

Definitions:
- dir = sign(move) (−1, 0 or +1)
- limit = |move| + 0.03

Repeat up to 4 times:

1. Compute the body collision box and query all overlapping boxes. If there are none, stop.
2. For each overlapping box compute two candidate corrections along the axis:
   - **back correction** = box.min − bodyBox.max − ε (a negative number: moving the body this far along the axis puts its max face just before the box's min face)
   - **forward correction** = box.max − bodyBox.min + ε (a positive number: moving the body this far puts its min face just after the box's max face)
3. Choose one correction for that box:
   - if dir > 0 and |back correction| ≤ limit: use the back correction (undo the motion);
   - else if dir < 0 and forward correction ≤ limit: use the forward correction (undo the motion);
   - else use whichever of the two has the smaller absolute value (the shortest way out). This is also what happens when move is 0.
4. Among all overlapping boxes keep the correction with the **largest absolute value**.
5. If the kept correction is exactly 0, stop. Otherwise add it to the body's position on that axis and remember its sign as the push sign.

Return the push sign of the **last** iteration that applied a push (0 if none was ever applied).

Consequences:
- After a push the body face is exactly at the box face (the ε in the correction cancels the ε in the shrunken body box). Example: pushed up onto a floor whose top is at y = 3.0 gives body position y = 3.0 exactly.
- A body that started overlapping a thin box from the "wrong" side is pushed out the short way, not necessarily against its motion.
- Because the limit includes the 0.03 slack, a body that moved 0.1 into a wall and needs a 0.12 push (say, because of the ε terms or a prior overlap) is still pushed back rather than through.

### 3.5 Horizontal move with step-up

Inputs: body, displacement (dx, dz), and a flag "can step".

1. Set blocked-X and blocked-Z to 0. If dx and dz are both exactly 0, return immediately (the wall flags are left as they were reset by the step in 3.6, i.e. no wall).
2. Remember the original position (ox, oy, oz).
3. **Flat attempt**: add dx to X and run the axis push-out on X with move = dx (result rx). Then add dz to Z and run the push-out on Z with move = dz (result rz). X is always resolved before Z.
4. If rx and rz are both 0 the move succeeded; return (no wall).
5. Remember the flat result position (nx, nz).
6. **Step attempt**, only if "can step" is true and the body's step height is > 0:
   - Move the body back to (ox, oy + step height, oz).
   - If the body overlaps anything at that raised position, the step attempt is abandoned (go to 7).
   - Otherwise repeat the flat attempt from the raised position: add dx, push-out X (rx2); add dz, push-out Z (rz2).
   - Lower Y by step height, then run the push-out on Y with move = −step height. This lands the body on top of whatever it is now above (a ledge up to step height + 0.03 tall) or returns it to the original height if nothing is there.
   - Let d1 = squared horizontal distance travelled by the flat attempt, d2 = squared horizontal distance travelled by the step attempt.
   - The step is **accepted** if d2 > d1 + 0.000001 AND the body's Y ≥ oy − 0.001 AND the body does not overlap anything.
   - If accepted: blocked-X = rx2, blocked-Z = rz2. If either is non-zero the body also hit a wall on the upper level: set hit-wall true and wall normal = normalize(rx2, 0, rz2).
   - If not accepted: restore the flat result (nx, oy, nz).
7. If no step was accepted: blocked-X = rx, blocked-Z = rz, hit-wall = true, wall normal = normalize(rx, 0, rz).

The wall normal is built from push signs, so it is one of the eight directions (±1, 0, 0), (0, 0, ±1) or the four diagonals (±0.7071, 0, ±0.7071). It points **away** from the wall (toward the body).

A step-up never lowers the body. A body can never step up more than step height + 0.03 (the slack) in one horizontal move. The step-up rule also handles walking off a small ledge onto lower ground: the step attempt does not help there; the ground snap (3.6) does.

### 3.6 One integration step

Inputs: body, dt. This is the per-sub-step body update.

1. Reset: hit-wall = false, hit-ceiling = false, wall normal = (0, 0, 0), land velocity = 0.
2. Remember "was on ground" = the on-ground flag from the previous step.
3. **Horizontal**: run the horizontal move (3.5) with dx = velocity.x × dt, dz = velocity.z × dt, and can-step = (was on ground) OR (always-step flag).
4. If blocked-X ≠ 0 set velocity.x = 0. If blocked-Z ≠ 0 set velocity.z = 0. (Velocity into a wall is killed; velocity along the wall is kept — this is what gives sliding along walls.)
5. **Vertical**: dy = velocity.y × dt. Add dy to Y. Run the axis push-out on Y with move = dy (result r).
6. Set on-ground = false. Then:
   - if r > 0 (pushed up: the body was standing in or fell into a floor): on-ground = true, land velocity = velocity.y (the value before zeroing), and if velocity.y < 0 set velocity.y = 0.
   - else if r < 0 (pushed down: the body's head hit a ceiling): hit-ceiling = true, and if velocity.y > 0 set velocity.y = 0.
7. **Ground snap**: if on-ground is false, was-on-ground is true, velocity.y ≤ 0, and the no-snap flag is false:
   - lower Y by the step height (the probe distance);
   - run the axis push-out on Y with move = −step height (result r2);
   - if r2 > 0: on-ground = true, velocity.y = 0, and the body stays where the push-out left it (on the surface below);
   - else: restore Y (add the step height back). The body is now airborne.

Notes:
- A body standing still under gravity is pushed up by a tiny amount each frame (gravity × dt² of penetration), so on-ground stays true and land velocity is set every frame to −gravity × dt. Callers that want a "landing" event must detect the false→true transition of on-ground, not the land velocity itself.
- The ground snap keeps a body attached when it walks down stairs or off a ledge lower than the step height. Walking off a ledge taller than the step height makes the body airborne.
- A body moving up (velocity.y > 0) that intersects a floor from below is treated as a ceiling hit only if the push is downward; the push-out prefers the "undo the motion" direction when it fits within |dy| + 0.03, so a jumping body that clips a thin platform from below is pushed back down.
- The horizontal pass uses "was on ground" from the previous step, not the current one. So a body that just left the ground still gets one horizontal move with step-up allowed.

### 3.7 Sub-stepping of fast bodies

The public "move body" operation wraps the integration step so a fast body never tunnels through thin walls.

1. speed = |velocity| (3-D length).
2. max step length = max(0.2, 0.8 × half-width).
3. n = ceil(speed × dt / max step length), clamped to the range 1..10.
4. If n = 1, run one integration step with the full dt.
5. Otherwise run n integration steps with dt / n each, and combine the flags:
   - hit-wall = true if any sub-step set it; wall normal = the normal from the **last** sub-step that hit a wall;
   - hit-ceiling = true if any sub-step set it;
   - land velocity = the land velocity of the **last** sub-step whose land velocity was non-zero;
   - on-ground = the value from the final sub-step.
6. Write those combined flags back onto the body.

Example: player half-width 0.35 gives a max step length of 0.28. The player's speed is capped at 48 units/s by the player subsystem; at 60 Hz that is 0.8 units per frame, so it uses 3 sub-steps. An enemy of half-width 0.33 (max step 0.264) yanked at 26 units/s at 60 Hz moves 0.43 per frame and uses 2 sub-steps. Because n is capped at 10, a body faster than 10 × max step length per frame can still tunnel; no body in the game reaches that.

### 3.8 Gravity, jump, and slopes (owned by other subsystems)

The physics world applies **no gravity** and knows nothing about jumping. Callers add gravity to velocity.y before calling "move body" each frame. For reference, these are the values used:

| Body | Gravity (units/s²) | Jump / launch |
|---|---|---|
| Local player, alive | 26 × gravity scale × (0.88 while grappling, else 1) | Jump sets velocity.y = 9.6; double jump = 9.6 × 0.92; wall jump = 9.2; mantle = min(11, √(2 × 26 × (ledge height + 0.45))) |
| Local player, dead | 26 | — |
| Ground enemy | 24 | Path hop or unstick hop: velocity.y = 9; charging enemies: velocity.y = 13 |
| Flying enemy, stunned | 20 (otherwise its own flight steering) | — |
| Grenade | 22 | — |
| Enemy blast projectile | 9 | — |
| Debris | 20 | — |

There are **no slopes**. Every surface is flat and horizontal (box tops) or vertical (box sides). Stairs are built from stacked boxes, each tread no higher than the walkers' step height (0.55 for the player, 0.6 for enemies), so bodies climb them with the step-up rule and descend them with the ground snap.

The player subsystem clamps the body's speed to 48 units/s before moving it. The enemy subsystem is expected to do its own limiting.

### 3.9 Worked examples

- **Walking into a 0.4-tall kerb** (step height 0.55, on ground): the flat attempt is blocked (rx ≠ 0). The step attempt raises the body 0.55, moves it, then lowers it 0.55 with push-out; the push-out lifts it 0.4 onto the kerb (0.4 ≤ 0.55 + 0.03). d2 > d1, Y = original + 0.4 ≥ original − 0.001, no overlap → accepted. No wall flag.
- **Walking into a 0.7-tall kerb**: the raised body (0.55 up) still overlaps the kerb, so the step attempt is abandoned. The flat result stands: blocked, hit-wall true, wall normal points back at the player, velocity into the wall zeroed.
- **Walking off a 0.5 ledge**: the horizontal move succeeds. The vertical pass moves down by gravity × dt only, no push (r = 0), so on-ground is false. Snap: was on ground, velocity.y ≤ 0, no-snap false → probe down 0.55, push-out lifts the body onto the lower floor (0.5 − gravity·dt² ≤ 0.58) → on-ground true, velocity.y = 0. The body walks smoothly down the ledge.
- **Walking off a 2-unit ledge**: same, but the probe finds nothing → Y restored, on-ground false, the body falls.
- **Jumping while pressing into a wall**: each step the horizontal pass blocks and zeroes velocity.x (or .z); hit-wall is set with the wall normal. The player subsystem reads hit-wall AND not on-ground to allow a wall jump for 0.12 s after the last contact.

---

## 4. Raycast, sweeps, ground-below, and line of sight

### 4.1 Raycast

Inputs: origin O, direction D (callers always pass a unit vector; distances are measured in multiples of D), maximum distance (default 1000), and an optional ignore predicate that receives a box and returns true to skip it.

The raycast scans the **flat box list**, not the spatial hash, so it also sees boxes added after the last finalize. Every box not skipped by the predicate is tested with the slab method:

- tmin starts at 0; tmax starts at the current best hit distance (initially the maximum distance). Because tmax starts at the best-so-far, boxes farther than the current best are rejected early.
- For each axis: if |D on that axis| < 1e-9 the ray is parallel to those slabs; if O on that axis is outside [box.min, box.max] the box is missed, otherwise the axis imposes no constraint. Else compute t1 = (box.min − O) / D and t2 = (box.max − O) / D for that axis, with entry sign −1; if t1 > t2 swap them and set the entry sign to +1. If t1 > tmin, set tmin = t1 and record this axis and sign as the entry face. If t2 < tmax, set tmax = t2. If tmin > tmax the box is missed.
- If no axis ever raised tmin above 0, the box is skipped. This means **a ray whose origin is inside a box never hits that box** (and a ray whose origin lies exactly on a face is treated as inside for that axis).
- Boxes entirely behind the origin are missed (tmax < 0 < tmin).
- If tmin is smaller than the best distance so far, the box becomes the best hit.

Result: null if nothing was hit within the range; otherwise a record with:
- **distance** = tmin of the best box;
- **point** = O + D × distance;
- **normal** = a unit axis vector on the entry axis with the entry sign. The sign is −1 when the ray entered through the box's min face (ray moving in the positive direction on that axis) and +1 when it entered through the max face. In other words the normal always opposes the ray on that axis;
- **box** = the box that was hit (so callers can read its data flags, e.g. breakable).

### 4.2 Ignore predicates

Two predicates are used throughout the game:

- **See-through**: skip a box if its data has noShoot = true. Exported by the physics module. Used by hitscan weapons, enemy projectiles, decal placement, particle collision, enemy line-of-sight, katana target search and the flyer's dive check.
- **No-grapple**: skip a box if its data has noGrapple = true. Defined by the player subsystem. Used only by the grapple hook ray.

Callers that pass no predicate (mantle probes, ground-ahead probes, flyer avoidance, grenades, debris, the ground-below query, spawn hiding checks, and the multiplayer arc check) collide with every box including rails and the sky lid.

### 4.3 Ground below

Inputs: x, y, z, and a maximum drop (default 100). Casts a ray straight down from (x, y, z) with range = maximum drop and no ignore predicate. Returns the Y coordinate of the hit point, or (y − maximum drop) if nothing was hit. Because rays do not hit the box they start inside, a start point inside a box finds the next surface below that box.

Usage in the game: boss spawn search calls ground-below with start height 30 and drop 40, then rejects results below −3.

### 4.4 Line of sight

Inputs: point A, point B, optional ignore predicate. If |B − A| < 0.0001 the result is true. Otherwise cast from A in the direction of B with range |B − A|; the result is true when nothing is hit. All rules of 4.1 apply (a start point inside a box ignores that box).

### 4.5 Sweep semantics used by projectiles and particles

The physics world has no dedicated sweep or continuous-collision function. Every moving point object (bullets, enemy projectiles, grenades, particles, debris) is moved by its owner as follows each frame:

1. Remember the previous position P0. Integrate velocity (and gravity/drag) to get the new position P1.
2. displacement = P1 − P0, length L. If L is below a tiny threshold (1e-6 for projectiles and debris, 1e-5 for particles) skip the collision test.
3. Cast a ray from P0 along the normalized displacement with range = L + padding.
4. If the ray hits, the object collides at the hit point and reacts.

Per-object parameters:

| Object | Padding | Ignore predicate | Reaction |
|---|---|---|---|
| Enemy projectile (bullet or blast) | 0 | See-through | Blast: explode at the hit point. Bullet: impact effect at the hit point with the hit normal; the projectile is removed. |
| Hitscan weapon | n/a (ray of length 300 from the eye) | See-through | Compared with the enemy hit-sphere raycast by distance; the nearer hit wins. If the box has a breakable reference and it is nearer than any enemy hit, the break-hit hook fires. The visual tracer starts at the muzzle. |
| Grenade (live and the aim-preview arc) | 0.16 (its radius) | none | Position = hit point + normal × 0.16. If velocity·normal < 0: velocity += normal × (−1.45 × velocity·normal), then velocity × 0.55, angular velocity × 0.6. If speed < 1.2 and normal.y > 0.5 the grenade comes to rest. The preview arc simulates with a fixed 1/30 s step, gravity 22, for up to 70 steps. |
| Tone particle with "collide" | size × 0.5 | See-through | If the particle is a decal type it places a splat at the hit point with the hit normal; the particle is removed. |
| Debris chunk | its radius | none | Position = hit point + normal × radius; reflect as the grenade does with factor 1.35 and speed × 0.55, spin × 0.5; bounce count incremented. |
| Decal surface probe | ray of 2.2 back into the surface, then a second ray of |offset| + 0.3 | See-through | Finds the face to draw on; used by splats near edges. |
| Blood pool probe | ray of 5 downward from 0.5 above the position | See-through | Pool is placed on the hit; nothing is drawn if there is no hit. |

The player's focus dash does not use rays. It marches the body in horizontal slices of at most 0.22 units; if a slice overlaps the world it tries once to raise the body by 0.65 and, if still overlapping, undoes the slice and stops (see 7).

---

## 5. Navigation grid

### 5.1 Constants

| Name | Value | Meaning |
|---|---|---|
| Cell size | 1.0 | Grid spacing in X and Z. |
| Surface probe column half-width | 0.05 | Half-size in X and Z of the thin column used to find boxes under a cell centre. |
| Surface probe column Y range | −30 to 90 | Vertical extent of the probe column. |
| Surface height limits | −5 to 70 | Surfaces below −5 or above 70 are ignored. |
| Node clearance half-width | 0.3 | Half-size in X and Z of the clearance box tested above a candidate surface. |
| Node clearance Y range | surface + 0.5 to surface + 1.85 | The clearance box must be free of every box (noNav boxes included). |
| Max climb per link | 1.35 | A link may rise at most this much. |
| Max drop per link | 8 | A link may fall at most this much. |
| Diagonal corner tolerance | 0.75 | For a diagonal link, both adjacent cardinal cells must hold a node within this height of the source or the destination. |
| Link clearance XZ margin | 0.25 | The link clearance box extends this far beyond the two node centres in X and Z. |
| Link clearance Y range | base + 0.5 to base + 1.7, where base = max(A.y, B.y) | Starts above knee height so the next stair tread does not read as a wall; 1.0-tall railings still block. |
| Drop check threshold | dy < −0.6 | Links that fall more than 0.6 get the extra drop-column test. |
| Drop column half-width | 0.2 | X and Z half-size of the drop column at the destination. |
| Drop column Y range | B.y + 0.05 to A.y + 0.05 | Must be free of boxes. |
| Climb cost threshold | dy > 0.6 | Above this the cost is multiplied by (1 + 1.1 × dy). |
| Drop cost threshold | dy < −0.6 | Below this the cost gains 0.35 × (−dy). |
| Heuristic weight | 1.15 | A* heuristic = 1.15 × straight-line 3-D distance to the goal node. |
| Default max expansions | 40000 | A* gives up after expanding this many nodes. |
| Nearest-node search radius (start) | 3 cells | Square search window for the path start. |
| Nearest-node max drop (start) | 3 | A node may be at most 3 below the query point. |
| Nearest-node search radius (goal) | 4 cells | |
| Nearest-node max drop (goal) | 8 | |
| Nearest-node max rise | 2.2 | A node may be at most 2.2 above the query point (both start and goal). |
| Nearest-node vertical weight (filtered) | 1.5 | score = horizontal distance + 1.5 × |dy|. |
| Nearest-node vertical weight (fallback) | 2.0 | score = horizontal distance + 2.0 × |dy|. |

### 5.2 Grid layout

The grid is built from the world and a bounds record {minX, maxX, minZ, maxZ} supplied by the level:

- Counter Slop 6, solo: ±55 on both axes. Counter Slop 6, arena (multiplayer): ±68. Mexico: ±62.

Column count nx = ceil((maxX − minX) / cell); row count nz = ceil((maxZ − minZ) / cell). Cell (ix, iz) has its centre at x = minX + (ix + 0.5) × cell, z = minZ + (iz + 0.5) × cell. Each cell holds either nothing or a list of node ids. A node has: world x, y, z (y = the surface height, i.e. the feet position of a body standing there), its cell indices, and a list of outgoing links.

### 5.3 Node generation (walkable surfaces)

For every cell, in row-major order (all ix for iz = 0, then iz = 1, ...):

1. Query the world with the thin column: X from centre − 0.05 to centre + 0.05, Y from −30 to 90, Z from centre − 0.05 to centre + 0.05. If nothing overlaps, the cell is empty.
2. Collect the set of distinct top-face heights (max.y) of every overlapping box whose noNav flag is false.
3. For each distinct height y in ascending order:
   - skip if y < −5 or y > 70;
   - test the clearance box X centre ± 0.3, Y from y + 0.5 to y + 1.85, Z centre ± 0.3 against **all** boxes (noNav included). If it overlaps anything, skip;
   - otherwise create a node at (centre x, y, centre z) and add its id to the cell.

Node ids are assigned in creation order. One cell can hold several nodes (street level, a balcony, a rooftop). A surface with less than 0.5 of headroom below a structure still gets a node if the structure starts above y + 1.85 (so bridges and overhangs work); a surface directly under a box that starts between y + 0.5 and y + 1.85 gets none.

Breakable props and rails are noNav, so their tops are never nodes, but they still block clearance and links.

### 5.4 Link generation

After all nodes exist, for every node A and each of the eight neighbour directions (dx, dz) in the order (+1,0), (−1,0), (0,+1), (0,−1), (+1,+1), (+1,−1), (−1,+1), (−1,−1):

1. The neighbour cell (A.ix + dx, A.iz + dz) must be inside the grid and must hold nodes.
2. For every node B in that cell, with dy = B.y − A.y:
   - reject if dy > 1.35 or dy < −8;
   - if the direction is diagonal (dx ≠ 0 and dz ≠ 0): reject unless BOTH cardinal cells (A.ix + dx, A.iz) and (A.ix, A.iz + dz) contain at least one node whose height is within 0.75 of A.y or within 0.75 of B.y. This prevents cutting corners around walls and across height jumps;
   - reject if the link clearance box overlaps any box. The box spans X from min(A.x, B.x) − 0.25 to max(A.x, B.x) + 0.25, Z likewise, Y from base + 0.5 to base + 1.7 with base = max(A.y, B.y);
   - if dy < −0.6, reject if the drop column overlaps any box: X from B.x − 0.2 to B.x + 0.2, Z likewise, Y from B.y + 0.05 to A.y + 0.05. (The walker must be able to fall straight down at B.)
   - otherwise add a directed link A → B with the cost in 5.5 and the stored dy.

Links are directed. B → A is evaluated on its own when B is processed, so the reverse link may be absent (e.g. a drop of 5 has a link down but no link up because 5 > 1.35) or may have a different cost.

### 5.5 Link cost

- horizontal = cell size × √(dx² + dz²) → 1.0 for cardinal, 1.4142 for diagonal.
- cost = √(horizontal² + dy²).
- If dy > 0.6: cost = cost × (1 + 1.1 × dy).
- Else if dy < −0.6: cost = cost + 0.35 × (−dy).
- Otherwise cost is unchanged.

Example: a diagonal climb of 1.0 costs √(2 + 1) × (1 + 1.1) = 1.732 × 2.1 = 3.637. A cardinal drop of 4 costs √(1 + 16) + 1.4 = 4.123 + 1.4 = 5.523.

### 5.6 Nearest node

Inputs: a world position, a search radius r in cells (default 3), a maximum drop (default 4). The maximum rise is always 2.2.

1. Compute the query cell (cx, cz) = floor((pos − grid min) / cell) on each axis.
2. Visit every cell with ix in [cx − r, cx + r] and iz in [cz − r, cz + r] that is inside the grid and holds nodes.
3. For every node: dy = node.y − pos.y; h = horizontal (XZ) distance from pos to the node centre.
   - fallback score = h + 2.0 × |dy|; keep the node with the lowest fallback score over ALL visited nodes;
   - if dy < −maximum drop or dy > 2.2 the node is not eligible for the filtered result;
   - filtered score = h + 1.5 × |dy|; keep the eligible node with the lowest filtered score.
4. Return the best filtered node if one exists, else the best fallback node, else "none" (−1).

Note that the search window is centred on the query cell even if the query position is outside the grid; cells outside the grid are simply skipped.

### 5.7 Path finding (A*)

Inputs: from position, to position, optional maximum expansions (default 40000).

1. start = nearest node(from, radius 3, max drop 3); goal = nearest node(to, radius 4, max drop 8). If either is "none", return null.
2. Heuristic h(n) = 1.15 × √((n.x − G.x)² + (n.y − G.y)² + (n.z − G.z)²) where G is the goal node. The weight 1.15 makes the search greedier than plain A*; paths can be slightly longer than optimal.
3. Standard A* with:
   - an open list ordered by f = g + h (a binary min-heap; ties broken arbitrarily). There is no decrease-key: a node may be pushed several times and stale entries are discarded when popped;
   - a closed set; a popped node already closed is skipped;
   - per-search generation stamps so g values and parent pointers from earlier searches are ignored;
   - g(start) = 0, parent(start) = none.
4. Loop while the open list is not empty:
   - pop the lowest-f node "cur"; skip it if closed; close it;
   - if cur is the goal: mark found, best = cur, stop;
   - count one expansion; if the count exceeds the maximum, stop;
   - if h(cur) is strictly lower than the best heuristic seen so far, remember cur as "best" (the node that got closest to the goal). The initial best is the start node with its own h;
   - for every link cur → next: tentative g = g(cur) + link cost; if next has not been reached in this search or tentative g < g(next): set g(next), parent(next) = cur, push next with f = tentative g + h(next).
5. Build the path by following parents from "best" back to the start and reversing it. Each element is a world point (node x, node y, node z) — node y is the surface height (feet level).
6. The path carries a **complete** flag: true if the goal was reached, false if the search ran out of expansions or exhausted the open list (unreachable goal). In the incomplete case the path leads to the closest node found.

The path always has at least one point (the start node). Null is returned only when no start or goal node exists within the search windows.

### 5.8 Path smoothing and following

The navigation module performs **no smoothing**. Paths are the raw sequence of node centres, one per cell (cardinal or diagonal steps).

The enemy subsystem follows a path with these rules (documented here so the intended behaviour of the raw path is clear):

- After a new path is received, leading points that are within 0.7 horizontally and 1.0 vertically of the enemy are skipped.
- The enemy steers toward the current point. When it is within 0.5 horizontally and 1.2 vertically of that point it advances to the next point. When the path is exhausted it steers straight for the target.
- An enemy on the ground whose current point is more than 0.6 above it and within 1.7 horizontally jumps (velocity.y = 9).
- A path is re-requested when the enemy has no path, has consumed it, or when its 0.8–1.4 s replan timer expires while the target moved more than 3.5 from the path's goal or the previous path was incomplete.
- If the enemy is on the ground and blocked by a wall for 0.35 s it forces a replan; after 0.9 s it hops (velocity.y = 9) and replans.

### 5.9 Random node

Returns one node chosen uniformly at random from all nodes. Not used by any other subsystem in the design, but available.

### 5.10 Rebuild rules

The grid is built once after a level is built and finalized, and again whenever the level is rebuilt (map change or arena mode change). It is **not** rebuilt when a breakable prop's box is removed. Breakable boxes are noNav so they never create nodes, but links that ran through them stay blocked for the rest of the session even after the prop is destroyed.

---

## 6. Utility helpers

All helpers are pure functions unless stated. "random()" means a uniform random number in [0, 1).

### 6.1 Scalar helpers

| Helper | Definition | Notes |
|---|---|---|
| TAU | 2π ≈ 6.283185 | |
| clamp(v, a, b) | if v < a → a; else if v > b → b; else v | Not symmetric if a > b: the lower bound wins. |
| lerp(a, b, t) | a + (b − a) × t | Not clamped; t outside [0, 1] extrapolates. |
| damp(a, b, λ, dt) | lerp(a, b, 1 − e^(−λ × dt)) | Frame-rate-independent exponential approach of a toward b. λ is the rate per second. Used everywhere for velocity friction, camera smoothing, and animation blending. |
| smoothstep(a, b, x) | t = clamp((x − a) / (b − a), 0, 1); result = t² × (3 − 2t) | Not used outside the utility module in the design. |
| approach(cur, target, maxDelta) | if cur < target: min(cur + maxDelta, target); else max(cur − maxDelta, target) | Linear approach by at most maxDelta. Not used outside the utility module. |

### 6.2 Random helpers

| Helper | Definition | Notes |
|---|---|---|
| rand(a = 0, b = 1) | a + random() × (b − a) | Uniform in [a, b). |
| randInt(a, b) | floor(rand(a, b + 1)) | Uniform integer in a..b inclusive. |
| choose(array) | array[floor(random() × length)] | Uniform pick. Undefined result for an empty array. |
| randDir() | normalize(vector with each component = rand(−1, 1)) | Not uniform on the sphere (cube-biased). Not used outside the utility module. |

### 6.3 Angle helpers

| Helper | Definition | Notes |
|---|---|---|
| wrapAngle(a) | ((a + π) mod τ + τ) mod τ − π | Result is in [−π, π). Works for negative inputs. |
| angleLerp(a, b, t) | a + wrapAngle(b − a) × t | Interpolates along the shortest arc. Result is not itself wrapped. Used for enemy yaw turning: yaw = angleLerp(yaw, targetYaw, 1 − e^(−10 dt)). |

### 6.4 Vector helpers

| Helper | Definition |
|---|---|
| v3(x = 0, y = 0, z = 0) | Creates a 3-D vector. Not used outside the utility module. |

### 6.5 Damped spring (scalar)

State: value (starts 0), velocity (starts 0), target (starts 0), stiffness k (default 120), damping d (default 14).

Update(dt):
- steps = 3 if dt > 0.02, else 1; h = dt / steps.
- Repeat "steps" times: force = (target − value) × k − velocity × d; velocity += force × h; value += velocity × h. (Semi-implicit Euler.)
- Return value.

Kick(v): velocity += v. Set(v): value = v, velocity = 0.

Instances in the game (k, d): player recoil pitch (190, 17), player recoil yaw (190, 17), field-of-view kick (220, 14), landing dip (170, 15). Typical kicks: landing dip −(impact × 6 + 0.5) where impact = clamp(−land velocity / 14, 0, 1.5); jump −1.2; wall jump −1.5; double jump −1.4; slide −2.5; mantle −2.5; FOV kick v × 30; recoil pitch p × 22, yaw y × 30.

### 6.6 Damped spring (3-D)

Same as 6.5 but value, velocity and target are 3-D vectors and the force is computed per component with the same k and d. Kick(x, y, z) adds to the velocity components. There is no Set. Instances: weapon recoil position (260, 18) and weapon recoil rotation (220, 16); a grenade throw kicks them by (−0.4, 0.5, 1.2) and (−3, 0, −1.5). Grapple fire kicks only the position spring, by (−0.3, 0.2, 0.5).

### 6.7 Cooldown timer

State: remaining time (starts 0), duration (given at creation, default 0).

- Update(dt): if remaining > 0, remaining −= dt. It can go slightly negative and stays there.
- Ready(): remaining ≤ 0.
- Start(d = duration): remaining = d.
- Fraction: if duration > 0, clamp(remaining / duration, 0, 1); else 0.

Not used outside the utility module in the design (timers elsewhere are plain numbers).

### 6.8 Orientation helpers

- **Rotation from +Y to a direction**: returns the quaternion that rotates the unit vector (0, 1, 0) onto the given unit direction. Not used outside the utility module.
- **Align an object along a segment** (from point, to point, thickness = 1): d = to − from, L = |d|. If L < 0.00001 the object is hidden and nothing else changes. Otherwise the object is made visible, its position is set to the midpoint of the segment, its orientation rotates +Y onto d / L, and its scale is set to (thickness, L, thickness). This assumes the object's mesh is a unit-length shape along +Y. Used for the enemy laser beam (thickness 0.006 + 0.012 × charge²) and the player's grapple rope (thickness 0.008, from the hand position to the hook).

---

## 7. Interfaces with other subsystems

### 7.1 Level → physics

- The level builder creates one world-box per solid piece through its collider helper, passing (min corner, max corner, data record). The data record always has the keys noNav, noShoot, noGrapple (booleans, false when not given) and tag (may be undefined).
- After all pieces are created, the level calls **finalize** once.
- Breakable props keep the returned box record and set `breakable` in its data to the prop record. When the prop is destroyed, the main loop calls **remove box** with that record.
- Before a new map is built into the same world, the main loop calls **clear**.
- The level exposes a bounds record {minX, maxX, minZ, maxZ} and a player start position. The main loop constructs a new navigation grid (cell 1.0) from the world and those bounds after every level build.

### 7.2 Player → physics

- Creates its body with half-width 0.35, height 1.75, step height 0.55 at the level's player start. Respawn copies a position, zeroes velocity, clears on-ground and resets height to 1.75.
- Each frame: applies gravity, its own acceleration/friction, sets the no-snap flag (grappling or velocity.y > 0.5), clamps speed to 48, then calls **move body**.
- Reads on-ground (movement mode, jump, coyote time, landing detection by false→true transition), hit-wall and wall normal (wall jump within 0.12 s of contact, only when airborne), land velocity (landing impact = clamp(−landVel / 14, 0, 1.5)), and hit-ceiling is available but unused.
- Uses **overlaps body** to refuse standing up while crouched, and to reject the grapple rope-length correction when it would push the body into geometry (correction = min(overshoot, 0.35) × 0.85 along the rope).
- Mantle probe: a ray from (feet + 1.0 up) along the flat forward direction, range 0.95, must hit; then a ray straight down from (feet + forward × 0.95, feet.y + 2.75), range 2.25, must hit a face with normal.y > 0.5; the ledge height dy = hit.y − feet.y must be in [0.5, 2.4]; and an AABB of the body's half-width from hit.y + 0.08 to hit.y + 1.05 at the forward position must be free (**overlaps AABB**).
- Grapple ray: **raycast** from the eye along the aim with the no-grapple predicate; the enemy hit-sphere raycast is limited to min(50, wall distance + 0.5). Every 0.15 s while attached, **line of sight** from the eye to the anchor is checked; 0.3 s of blockage detaches.
- Katana lock-on and multiplayer arc checks use **line of sight** without a predicate.
- Grenades and the aim-preview arc use the sweep in 4.5.
- Out-of-page rule: after moving, if feet.y < −12 or |x| > 95 or |z| > 95 the player is respawned at the level start with 20 damage. Separately, the main loop forces y = −100 when the player is more than 8 outside the level bounds or above y = 150, which triggers the same respawn.

### 7.3 Enemies → physics and navigation

- Bodies as in 3.3; always-step true; flyers no-snap. Position is the feet; the visual root follows the body position each frame.
- Ground enemies: gravity 24 per second added to velocity.y, then **move body**. Killed by a fall if feet.y < −6.
- Flying enemies: their own steering, then **move body**. Avoidance: a ray from the enemy centre along its velocity direction, range 3.5, no predicate — on a hit, velocity += normal × 14 × dt and velocity.y += 12 × dt; a ray straight down from the centre, range 2.5 — on a hit velocity.y += 12 × dt.
- Ground-ahead probe: a ray straight down from (feet + direction × 0.9, feet.y + 0.5), range 3.5, no predicate; "no hit" means a cliff edge.
- Player separation: after moving, a ground enemy closer than (0.36 + its half-width + 0.12) horizontally and within 1.7 vertically of the local player is pushed straight out to that radius; if **overlaps body** is then true the push is undone.
- Line of sight to the player's centre from the enemy's eye every 0.12–0.22 s with the see-through predicate; flyers check it from their centre before diving.
- Path requests: **find path**(feet position, approach point) with defaults; reads the returned point list and its complete flag as described in 5.8.
- Reads on-ground (jump decisions, animation), hit-wall (unstick logic, charge attack impact, flyer dive abort).
- Network-mirrored enemies are not moved by physics; their position is interpolated from snapshots and on-ground is set to |velocity.y| < 0.5.
- Projectiles: the sweep in 4.5, then a segment-versus-player test, and for deflected projectiles the enemy hit-sphere raycast.

### 7.4 Weapons, effects → physics

- Hitscan: **raycast** from the eye, range 300, see-through predicate; compared by distance with the enemy hit-sphere raycast; reads the hit box's breakable reference. The visual tracer starts at the muzzle.
- Effects: decal probes, blood pool probe, particle collision and debris bouncing as in 4.5.

### 7.5 Main loop → physics and navigation

- Owns the single world and the current navigation grid; rebuilds the grid after every level build and stores it on the shared context for enemies.
- Boss spawn fit test: **overlaps AABB** of a box 2.2 wide and deep (±1.1) from spawn.y + 0.1 to spawn.y + 5.2 must be false. Fallback search: 200 random points 22–40 from the player, clamped to ±44, height from **ground below**(x, 30, z, drop 40), accepted if y > −3 and the fit test passes.
- Spawn hiding: candidates are preferred when **line of sight** from the player's eye to (spawn + 1.2 up) is false (no predicate).
- Focus dash: marches the player body toward the target in slices of at most 0.22 units per slice up to 46 units/s × dt; on **overlaps body** it lifts the body 0.65, and if still overlapping it undoes the slice and stops the march. Vertical approach moves up to 46 × dt per frame and is undone if it overlaps; 0.08 s of vertical blockage ends the dash as "blocked".

### 7.6 Remote players

Remote players have a body-shaped record (half-width 0.35, height 1.75) but are never passed to the world; their on-ground flag is a network bit.

### 7.7 Data shapes summary

| Contract | Shape |
|---|---|
| Add box | (min {x,y,z}, max {x,y,z}, data {noNav?, noShoot?, noGrapple?, tag?}) → box record {min, max, data, id} |
| Query / overlaps AABB | (min {x,y,z}, max {x,y,z}) → list of box records / boolean |
| Overlaps body | (body) → boolean |
| Move body | (body, dt) → mutates body position, velocity, on-ground, hit-wall, wall normal, hit-ceiling, land velocity |
| Raycast | (origin {x,y,z}, unit direction {x,y,z}, max distance, ignore predicate(box) → boolean) → null or {distance, point, normal, box} |
| Ground below | (x, y, z, max drop) → y of surface or y − max drop |
| Line of sight | (point A, point B, ignore predicate) → boolean |
| Body constructor | (position, half-width, height, step height = 0.55) → body record (3.1) |
| Nav grid constructor | (world, {minX, maxX, minZ, maxZ}, cell = 1.0) then build() |
| Find path | (from position, to position, max expansions = 40000) → null or list of points {x,y,z} with a boolean "complete" attached |
| Nearest node | (position, radius cells, max drop) → node id or −1 |

---


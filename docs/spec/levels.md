# Levels subsystem specification

This document describes the two playable maps, how they are built, and every object in them.
It is written so that a person can build the same gameplay from it alone. It describes the result, not the code.

## Table of contents

1. [Overview and level metadata](#1-overview-and-level-metadata)
2. [Coordinate system and conventions](#2-coordinate-system-and-conventions)
3. [Building primitives](#3-building-primitives)
4. [Collider flags and how other systems treat them](#4-collider-flags-and-how-other-systems-treat-them)
5. [The level record (builder output)](#5-the-level-record-builder-output)
6. [Map 1: Counter Slop 6](#6-map-1-counter-slop-6)
7. [Map 2: Mexico](#7-map-2-figure-mexico)
8. [Boundaries and kill zones](#8-boundaries-and-kill-zones)
9. [Interfaces with other subsystems](#9-interfaces-with-other-subsystems)

---

## 1. Overview and level metadata

There are two maps. Each map is built by one shared builder into:

- **Visual geometry**: static shapes merged into one drawable mesh per tone, plus a small
  number of separate meshes (drones, breakable props, mariachi figures) that must move or be
  removed on their own.
- **Physics colliders**: axis-aligned boxes in the collision world. Bodies (player, enemies), bullets
  (ray casts), line-of-sight checks, the grapple hook and the enemy navigation grid all read these
  boxes. The navigation grid is generated from the colliders after the level is built.

### 1.1 Level list

| Key | Display name | Blurb | Available |
|---|---|---|---|
| `downtown` | COUNTER SLOP 6 | "streets, rooftops and fire escapes" | Always |
| `mexico` | MEXICO | "a sun-baked plaza · piñatas, tacos and mariachi" | Only when the **Mexico-ready flag** is true. In the design this flag is **false**, so the list contains only Downtown. |

The initial release includes Downtown only. Keep the Mexico-ready flag **false** until the
checks at the start of section 7 pass.

Rules that use the list:

- The main menu shows a map selector only when the list has **two or more** entries. Each button
  shows the name and the blurb. Buttons are disabled for lobby members who are not the host.
- The last chosen map key is stored in browser storage under `cs6_map`. When the stored key
  (or a map key received from a match host) is not in the list, it falls back to `downtown`.
- The music tune is chosen from the key: `mexico` gets the Mexico tune, anything else the Downtown
  tune (see section 9).

### 1.2 Build modes

The builder takes a map key and an **arena** flag:

- Arena **off** = solo wave mode. Downtown builds its "tight block" (55-unit half-size, central
  tower, south plaza, low perimeter).
- Arena **on** = online free-for-all. Downtown builds a wider field (68-unit half-size, no tower,
  no plaza, high perimeter, a dome, hanging pads, more spawn points).
- Mexico accepts the flag but builds the **same** geometry in both modes.

The level is rebuilt (old meshes removed and disposed, physics world cleared, navigation grid
regenerated) whenever the key or the arena flag changes, and also, on a game reset, whenever at
least one breakable prop has been broken (so props come back).

---

## 2. Coordinate system and conventions

- Right-handed, **Y up**. Ground surface is at y = 0. X and Z are horizontal.
- Positions are in world units ("metres"); the player body is 0.35 half-width and stands
  1.75 high (1.05 crouched) with a 0.55 step-up height. Enemies use the same physics system but
  different body sizes and step heights: 0.6 for ordinary enemies and 1.2 for bosses (see
  `enemies.md` section 4.1). The player's jump reaches about 1.77 units (jump speed 9.6 under
  gravity 26). A 1.0-high railing blocks player and ordinary enemy walking, and blocks nav links.
  The player can jump over it; bosses can step over it, and enemy AI jumps can cross it without
  a nav link (see `enemies.md` sections 6.6 and 7.2).
- In all tables below, a **box** is given as: centre X, bottom Y, centre Z, size X (width), size Y
  (height), size Z (depth). The box spans X ± width/2, Y from bottom to bottom + height, Z ±
  depth/2. Rotation is always zero (all colliders are axis-aligned); the few rotated shapes are
  visual-only and are described explicitly.
- "Top at Y" for a slab means the walkable surface is at that height.
- Tone names (BLUE, RED, BLACK, ORANGE, GREEN, PINK) identify the colour class of a shape. The
  default tone of every shape is BLUE unless stated. Colour is not gameplay-relevant except for the
  tint of debris/burst effects of breakables (section 7.3) and the pickup models. The palette
  itself is in section 10.
- Random values: the notation rand(a, b) means a uniform random number in [a, b], drawn once at
  build time. Only the Mexico mesas and Mexico pot sizes use randomness.

---

## 3. Building primitives

Every map is assembled from the following primitives. An implementer must reproduce the collider
and surface results exactly; the visual mesh may be built any way that gives the same silhouette
and the same walkable/blocking behaviour.

### 3.1 Box

Inputs: centre X, bottom Y, centre Z, width, height, depth, options.

- Adds a visual box of that size with its base at bottom Y.
- Unless the option **no-collide** is set, adds one collider with identical extents, carrying the
  flags no-nav, no-shoot, no-grapple and an optional tag from the options (section 4).
- Option **tone** sets the colour class (default BLUE).

### 3.2 Slab

Inputs: X1, Z1, X2, Z2, top Y, thickness, options. Equivalent to a box centred at ((X1+X2)/2,
(Z1+Z2)/2), width X2−X1, depth Z2−Z1, bottom at top Y − thickness, height = thickness. The walking
surface is at top Y.

### 3.3 Wall with gaps

Inputs: start A1, end A2 along one horizontal axis, the fixed coordinate on the other axis, base Y,
height H, thickness T, a list of gaps, options.

- A **wall along X** runs from X = A1 to A2 at a fixed Z; its thickness T is in Z. A **wall along
  Z** runs from Z = A1 to A2 at a fixed X; thickness in X.
- Each gap is (G1, G2, gap bottom, gap top) with the along-axis range G1..G2 and the vertical range
  measured from the wall base (default bottom 0, default top H). Gaps may overlap.
- Result: the solid part of the wall rectangle (along-axis range A1..A2 × vertical range 0..H) minus
  the union of the gap rectangles, produced as a set of axis-aligned boxes. The design cuts the
  wall into vertical strips at every gap edge, in each strip makes solid pieces between the gap
  vertical ranges, and merges neighbouring strips whose pieces have identical vertical ranges.
  Any decomposition of the same solid region into boxes is acceptable: gameplay depends only on the
  solid region. Pieces thinner than 0.005 in either direction are dropped.
- Each piece is a Box (3.1) with the wall's thickness, base Y + piece bottom, height = piece top −
  piece bottom, and the given options (default BLUE, collides).

### 3.4 Stairs

Inputs: start X, base Y, start Z, direction (+x, −x, +z or −z), step count N, width W, options
rise (default 4/14 ≈ 0.2857) and run (default 0.45).

- Step i (i = 0..N−1) is a Box whose centre along the direction is start + (i + 0.5) × run, whose
  bottom is the **base Y** (every step is solid from the base up), whose height is (i + 1) × rise,
  whose size along the direction is run + 0.004 (a 4 mm overlap), and whose size across the
  direction is W (centred on the start line).
- The top of the last step is at base Y + N × rise, at along-position start + N × run.
- Because step height (rise) is below the body step-up height of 0.55 and stairs are solid to
  their base, both the player and enemies walk them.

### 3.5 Rail (railing)

Inputs: X1, Z1, X2, Z2 (an axis-aligned segment), floor Y, options (tone).

- Visual bar: a no-collide box centred on the segment midpoint at Y + 0.9, cross-section 0.12 ×
  0.12, as long as the segment.
- Visual posts: n = max(1, round(length / 2)); n + 1 posts equally spaced from the start point to
  the end point (inclusive), each a no-collide box 0.1 × 0.9 × 0.1 with its base at Y.
- One collider centred on the midpoint at Y: as long as the segment, **1.0 high**, 0.12 thick.
  Flags: **no-nav** and **no-shoot** (section 4). A railing blocks player and ordinary enemy
  walking, lets bullets and vision through, does not create navigation nodes on top of itself,
  and blocks navigation links that cross it. Bosses can step over it, and jumps can cross it.
  It does **not** carry no-grapple, so the grapple hook's wall ray can hit a railing and attach
  to it.
- The along-axis is chosen as X when |X2 − X1| > |Z2 − Z1|, else Z. Every railing in both maps is
  strictly axis-aligned.

### 3.6 Cylinder

Inputs: centre X, bottom Y, centre Z, radius r, height h, options (segments, tone, no-collide).

- Visual vertical cylinder from Y to Y + h.
- Unless no-collide: a collider box with footprint **1.6 r × 1.6 r** (a square inscribed in the
  circle, slightly inside the rim) and height h.

### 3.7 Sphere

Inputs: centre X, Y, Z, radius, options. **Visual only, never a collider.**

### 3.8 Grapple ring

Inputs: X, Y, Z, orientation (z = ring stands in the XY plane, x = stands in the YZ plane, y = lies
flat). Visual: a torus of major radius 0.6 and tube radius 0.1, ORANGE. Gameplay: records the
centre point (X, Y, Z) as a **grapple anchor** in the level record. The orientation is only visual.

### 3.9 Markers

- **Enemy spawn point** (X, Y, Z): appended to the level's enemy spawn list.
- **Sniper perch** (X, Y, Z): appended to the sniper list (enemy snipers spawn only here).
- **Pickup location** (X, Y, Z): appended to the pickup list.
- **Arena spawn** (X, Y, Z): appended to the match spawn list.

### 3.10 Drones (decorative, grapple-able movers)

Inputs: count n, base radius, base height, options scale (default 1), radius step (default 12),
height step (default 6), speed (default 0.11), tone.

For each i = 0..n−1:

- Visual: a 3-sided cone (a backdrop dart) of base radius 1.2 × scale and length 4 × scale, nose
  pointing along its direction of travel. Own mesh, not merged, not a collider.
- Registered as a **grapple mover** with grab radius 2.2 × scale.
- Orbit parameters: r = base radius + i × radius step; h = base height + i × height step; phase
  φ = 2.1 × i; angular speed s = speed + 0.01 × i (radians per second of game time).
- Position at game time t, with a = s × t + φ:
  - x = cos(a) × r
  - y = h + 3 × sin(2.3 a)
  - z = 0.7 × r × sin(a)
- Orientation: the nose points at the position the plane will have at a + 0.05; the plane is then
  rolled about its long axis by 0.6 × sin(3 a) radians.
- Updated every frame from the level's animated list with the current game time.

### 3.11 Breakable prop (Mexico only)

Inputs: kind, X, bottom Y, Z, collider width, height, depth, a visual build, options hit points and
tone.

- Visual: a group of separate meshes positioned at (X, Y, Z). Kept as its own object so its parts
  can fly apart.
- Collider: one box with the given extents, flagged **no-nav**, and carrying a back-reference to the
  prop.
- Record: id (index in the breakables list, starting at 0), kind, hit points (default 1), the
  centre point (X, Y + height/2, Z), alive = true, tone (default ORANGE), and the collider handle.

### 3.12 Finish

After all objects are placed: merge all static visual shapes into one mesh per tone, add them
to the scene, list them in the level's mesh list, and finalize the physics world (build its spatial
hash). Return the level record.

---

## 4. Collider flags and how other systems treat them

| Flag | Meaning | Consumers |
|---|---|---|
| (none) | Solid for everything. | Bodies, bullets, vision, grapple, nav. |
| no-nav | The top surface is not a navigation surface: the nav grid does not create walkable nodes on top of this box. The box still blocks bodies and still blocks nav links that pass through it. | Nav grid generation. |
| no-shoot ("see-through") | Bullets, blade sweeps, tracer/particle collisions, enemy line-of-sight, enemy vision-cone checks and blood-pool ground probes ignore this box. Bodies are still blocked. | Player and enemy ray casts, effects. |
| no-grapple | The grapple hook's wall ray ignores this box (the hook flies through it and can hit whatever is behind). Bodies are still blocked. | Player grapple targeting. |
| tag | Free-form label. **Never read** by any other module in the design. |  |
| breakable (back-reference) | Set on breakable-prop colliders. Read by the **weapons** module: when a bullet ray's first collider hit carries this reference (and no enemy or remote player is closer along the ray), the shot calls the break-hit hook with the weapon's base damage instead of drawing a wall impact (section 9.7). Blade sweeps and grenade blasts find props through the breakables list instead. | Weapons (bullet rays). |

Navigation grid facts that depend on level geometry (so that implementers keep the same enemy
reach):

- Cell size 1.0; the grid covers the level bounds (section 5) with ceil(extent) cells per axis;
  cell centres are at bounds min + (index + 0.5). With integer bounds, every node sits on a
  half-integer X and Z.
- For each cell, every collider that intersects the thin column (x ± 0.05, y −30..90, z ± 0.05)
  through the cell centre is collected. A node is created at the cell centre on the **top face** of
  every such collider that is not no-nav, whose top is between y = −5 and y = 70, provided the box
  from (x ± 0.3, top + 0.5, z ± 0.3) to top + 1.85 is free of any collider (including no-nav ones).
  One cell can hold several nodes at different heights (floors of a building).
- Links go to the 8 neighbouring cells, to every node there whose height difference dy satisfies
  −8 ≤ dy ≤ 1.35. A link is blocked if any collider overlaps the box that spans both node centres,
  widened by 0.25 in X and Z, from (higher top + 0.5) to (higher top + 1.7). A drop steeper than
  0.6 also needs the column (lower node x ± 0.2, z ± 0.2) from lower top + 0.05 up to higher top +
  0.05 to be free. A diagonal link needs, in **both** orthogonal neighbour cells, some node within
  0.75 in height of either end.
- Link cost = sqrt(horizontal² + dy²); if dy > 0.6 it is multiplied by (1 + 1.1 dy); if dy < −0.6,
  0.35 × |dy| is added. (Costs belong to the enemy subsystem; they are listed so that the level
  data produces the same routes.)

---

## 5. The level record (builder output)

| Field | Content | Downtown default | Mexico value |
|---|---|---|---|
| key | Map key string. | `downtown` | `mexico` |
| player start | Where the local player is placed on reset in solo and whenever they fall off the map. | (0, 0, 42) | (0, 0, 16) |
| bounds | min X, max X, min Z, max Z. Used for the nav grid extent, flyer spawn clamping and the out-of-bounds kill check. | ±55 solo, ±68 arena | ±62 |
| enemy spawns | List of points. | see 6.x | see 7.x |
| sniper perches | List of points. | | |
| pickup locations | List of points. | | |
| rings | List of grapple anchor points. | | |
| arena spawns | Match spawn points. Empty in Downtown solo; when empty, the enemy spawn list is used for matches. | | |
| team spawns | Two lists of 5 points each (Downtown only). **Not read by any other module.** | | not set |
| grapple movers | List of {mesh, radius} (drones). | | |
| animated | List of {mesh, update(time)} callbacks run each frame. | | |
| breakables | List of breakable records (Mexico only; empty for Downtown). | | |
| meshes | Every scene object the level owns, for removal on rebuild. | | |

---

## 6. Map 1: Counter Slop 6

Symbols used in this section:

| Symbol | Solo | Arena | Meaning |
|---|---|---|---|
| P | 55 | 68 | Half-size of the play field (bounds). |
| T | 6 | 6 | Perimeter wall thickness. |
| PH | 18 | 30 | Perimeter wall height. |
| E | 51.2 | 64.2 | Ledge line (P − 3.8). |
| D | 52 | 65 | Inner face of the perimeter wall (P − 3) where door frames sit. |

Sections marked **(solo only)** exist only when the arena flag is off; **(arena only)** only when it
is on. Everything else exists in both modes.

### 6.1 Ground and perimeter

| Object | Centre X | Bottom Y | Centre Z | Width | Height | Depth | Notes |
|---|---|---|---|---|---|---|---|
| Ground | 0 | −1 | 0 | 2P + 6 | 1 | 2P + 6 | Top at y = 0. Spans ±58 solo, ±71 arena. |
| North wall | 0 | 0 | −P | 2P + 6 | PH | 6 | Solid; spans Z −P−3..−P+3. |
| South wall | 0 | 0 | +P | 2P + 6 | PH | 6 | |
| West wall | −P | 0 | 0 | 6 | PH | 2P + 6 | |
| East wall | +P | 0 | 0 | 6 | PH | 2P + 6 | |

**Perimeter ledges** (stand-on shelves stuck to the inside of the walls). For each entry: one box at
bottom Y 9 (0.4 high, top 9.4) and one at bottom Y 5.5 (top 5.9), same footprint. In arena mode a
third box at bottom Y 16 (top 16.4) and a flat **grapple ring** at (X, 20, Z) are added.

| # | Centre X | Centre Z | Width | Depth |
|---|---|---|---|---|
| 1 | −30 | −E | 8 | 1.6 |
| 2 | 30 | −E | 8 | 1.6 |
| 3 | −E | 40 | 1.6 | 8 |
| 4 | E | −10 | 1.6 | 8 |
| 5 | −E | −30 | 1.6 | 6 |
| 6 | E | 35 | 1.6 | 6 |
| 7 | 10 | E | 8 | 1.6 |
| 8 | −40 | E | 6 | 1.6 |

**Door frames and perimeter enemy spawns.** Visual-only BLACK frames drawn on the inner wall face
(no colliders), each with an enemy spawn point 1.2 units inside the frame at ground level.

Frames on the east/west walls (frame across Z): two posts at (X, 0, Z ∓ 1.2), each 0.5 × 3.2 × 0.3,
and a lintel at (X, 3.0, Z) of 0.5 × 0.3 × 2.7.

| Frame X | Frame Z | Spawn point |
|---|---|---|
| −D | 0 | (−D + 1.2, 0, 0) |
| D | 0 | (D − 1.2, 0, 0) |
| −D | 30 | (−D + 1.2, 0, 30) |
| D | −30 | (D − 1.2, 0, −30) |
| −D | −30 | (−D + 1.2, 0, −30) |
| D | 30 | (D − 1.2, 0, 30) |

Frames on the north/south walls (frame across X): posts at (X ∓ 1.2, 0, Z), each 0.3 × 3.2 × 0.5,
lintel at (X, 3.0, Z) of 2.7 × 0.3 × 0.5.

| Frame X | Frame Z | Spawn point |
|---|---|---|
| 0 | −D | (0, 0, −D + 1.2) |
| 0 | D | (0, 0, D − 1.2) |
| −30 | D | (−30, 0, D − 1.2) |
| 30 | D | (30, 0, D − 1.2) |

Solo values: D − 1.2 = 50.8. Arena: 63.8.

### 6.2 Arena-only additions

**Match spawn points** (arena spawn list, 15 entries):

| # | X | Y | Z | Where |
|---|---|---|---|---|
| 1 | −34 | 12.2 | 12 | Building A roof |
| 2 | 34 | 12.2 | 12 | Building B roof |
| 3 | −30 | 7.2 | −45 | Row house 1 roof |
| 4 | 16 | 7.2 | −45 | Row house 3 roof |
| 5 | 0 | 7.4 | −30 | Highway |
| 6 | −44 | 0 | −10 | Field |
| 7 | 44 | 0 | −10 | Field |
| 8 | −40 | 0 | 40 | Field |
| 9 | 40 | 0 | 40 | Field |
| 10 | 0 | 0 | 55 | Field |
| 11 | −58 | 0 | 0 | Outer ring |
| 12 | 58 | 0 | 0 | Outer ring |
| 13 | 0 | 0 | −58 | Outer ring |
| 14 | −54 | 0 | 54 | Outer ring |
| 15 | 54 | 0 | −54 | Outer ring |

**Low field cover** (solid boxes, BLUE):

| Centre X | Bottom Y | Centre Z | W | H | D |
|---|---|---|---|---|---|
| −8 | 0 | 20 | 3 | 1 | 1.2 |
| 10 | 0 | 26 | 1.4 | 1.2 | 1.4 |
| −12 | 0 | −8 | 2.4 | 0.8 | 2.4 |
| 14 | 0 | −4 | 2.4 | 0.8 | 2.4 |

**Flag poles** at (X, Z) ∈ {(−56, 30), (56, −30), (30, −56), (−30, 56)}: a pole box 0.3 × 7 × 0.3
at ground (collides, **no-nav**), a no-collide cross-arm 1.4 × 0.3 × 0.3 with bottom at y 7, and a
visual ORANGE sphere of radius 0.45 at (X + 0.7, 6.8, Z).

**The dome (visual).** Sphere radius R = 120 centred at (0, −30, 0), so its apex is at y = 90.
Drawn as 8 half-torus ribs (major radius 120, tube 0.6, half circle, rotated about Y by k × 22.5°
for k = 0..7, centred at (0, −30, 0)) and 5 horizontal rings (tube 0.5) at the heights below, plus
a RED sphere of radius 2.4 at the apex (0, 90, 0). No colliders from the visual shapes.

| Ring height | Ring radius |
|---|---|
| 38 | 98.87 |
| 54 | 85.70 |
| 68 | 69.25 |
| 80 | 47.96 |
| 88 | 21.82 |

**The dome shell (invisible colliders, flags no-nav + no-grapple).** These stop bodies leaving the
map through the sky and shrug off the hook.

- A lid: box centred (0, 0), bottom 88, size 300 × 10 × 300 (spans y 88..98).
- Horizontal bands every 4 units from y = PH (30) upward to below 88. For a band with bottom y0,
  the inner radius is inner = sqrt(R² − (y0 + 4 + 30)²) (0 if negative). Bands whose inner radius
  is larger than P + T = 74 are skipped. For the remaining bands, four boxes are added with
  o = inner + 80: (0, y0, −o) size 320 × 4 × 160; (0, y0, +o) same; (−o, y0, 0) size 160 × 4 × 320;
  (+o, y0, 0) same. Their inner faces sit at distance "inner" from the centre. With arena values the
  bands that exist are:

| Band bottom y0 | inner | Box inner face at ± |
|---|---|---|
| 62 | 72.00 | 72.00 |
| 66 | 66.33 | 66.33 |
| 70 | 59.87 | 59.87 |
| 74 | 52.31 | 52.31 |
| 78 | 43.08 | 43.08 |
| 82 | 30.72 | 30.72 |
| 86 | 0 | 0 (the four boxes meet and fully cover the centre) |

Between the wall top (y = 30) and y = 62 there are no shell colliders beyond the walls; the
out-of-bounds rules of section 8 catch anyone who swings out there.

**Hanging pads** (each: a pad box 0.5 high flagged **no-nav** with top at Y + 0.5; a visual BLACK
cable 0.12 × 0.12 from the pad top up to the dome surface, height max(1, domeY − (Y + 0.5)) where
domeY = sqrt(max(1, R² − X² − Z²)) − 30; and a flat grapple ring 1.3 **below** the pad bottom at
(X, Y − 1.3, Z)):

| Centre X | Bottom Y | Centre Z | Width | Depth | Pad top | Ring Y | Cable height |
|---|---|---|---|---|---|---|---|
| 0 | 24 | 0 | 8 | 8 | 24.5 | 22.7 | 65.5 |
| −42 | 18 | −24 | 6 | 6 | 18.5 | 16.7 | 61.3 |
| 44 | 21 | 30 | 6 | 6 | 21.5 | 19.7 | 56.0 |
| 28 | 27 | −46 | 5 | 5 | 27.5 | 25.7 | 49.7 |
| −30 | 30 | 44 | 5 | 5 | 30.5 | 28.7 | 47.0 |

**Arena drones**: 4 planes, base radius 30, base height 26, scale 1.7, radius step 9, height
step 6, speed 0.11, BLUE. Cone radius 2.04, length 6.8, grab radius 3.74.

| i | Orbit r | Height h | Phase | Speed |
|---|---|---|---|---|
| 0 | 30 | 26 | 0 | 0.11 |
| 1 | 39 | 32 | 2.1 | 0.12 |
| 2 | 48 | 38 | 4.2 | 0.13 |
| 3 | 57 | 44 | 6.3 | 0.14 |

### 6.3 Central tower (solo only)

A 14 × 14 open-frame tower centred at the origin, four floors 4 units apart.

| Object | Details |
|---|---|
| Floors | Slabs from (−7, −7) to (7, 7), 0.4 thick, tops at **4, 8, 12, 16**. |
| Pillars | 8 boxes 0.8 × 16 × 0.8 from y 0 at (X, Z) ∈ {(−6.6, −6.6), (6.6, −6.6), (−6.6, 6.6), (6.6, 6.6), (0, −6.6), (0, 6.6), (−6.6, 0), (6.6, 0)}. |

Railings on floors 1–3 (floor Y = 4, 8, 12), each per section 3.5. Note carefully: the design
places a **full-length railing on the north edge** and **no railing on the west edge**; the two
short north pieces overlap the full one. (The design source comments call the full piece
"west" and the short pieces "north with landing gaps", but the geometry actually built is as
listed here, and gameplay follows the geometry.)

| Edge | Segment(s) | Gap |
|---|---|---|
| South (z = 7) | (−7, 7)→(−1.5, 7) and (1.5, 7)→(7, 7) | x −1.5..1.5 |
| North (z = −7) | (−7, −7)→(7, −7) full length, plus overlapping pieces (−7, −7)→(−6.5, −7) and (3.5, −7)→(7, −7) | none (the full piece closes the intended landing gap x −6.5..3.5) |
| East (x = 7) | (7, −7)→(7, 7) | none |
| West (x = −7) | none | fully open |

Consequences the implementer must keep: on floors 1–3 the exterior-stair landings (which touch the
floor edge at z = −7) are separated from the floor by a 1.0-high railing, so the player hops it and
enemies get no nav link there; the ruler bridge (section 6.4) enters floor 3 across the open west
edge; the plank bridge (6.5) meets floor 3's railed east edge. Only the roof (Y = 16) has a real
opening on the north edge (x −7..−5) for the last landing.

Roof parapet (Y = 16): (−5, −7)→(7, −7); (−7, 7)→(−1.5, 7); (1.5, 7)→(7, 7); (−7, −7)→(−7, 7);
(7, −7)→(7, 3).

**Crane on the roof:**

| Part | Centre X | Bottom Y | Centre Z | W | H | D | Collides | Tone |
|---|---|---|---|---|---|---|---|---|
| Mast | 5.5 | 16 | 5.5 | 1 | 10 | 1 | yes | BLUE |
| Cab | 5.5 | 25.2 | 5.5 | 1.6 | 1.4 | 1.6 | no | BLUE |
| Jib | 11.5 | 25 | 5.5 | 16 | 0.8 | 0.8 | yes (walkable beam, x 3.5..19.5, top 25.8) | BLUE |
| Counter-jib | 1 | 25 | 5.5 | 5 | 0.8 | 0.8 | yes (x −1.5..3.5) | BLUE |
| Counterweight | −0.5 | 23.6 | 5.5 | 2 | 1.6 | 1.6 | yes | BLUE |
| Hook cable | 19 | 20.5 | 5.5 | 0.08 | 4.6 | 0.08 | no | BLACK |

Grapple rings: (19, 19.8, 5.5) standing in the YZ plane; (19.5, 24.6, 5.5) standing in the XY
plane. **These two are the only rings in Downtown solo.**

**Exterior switchback stairs, north face.** Four flights of 14 steps (rise 4/14, run 0.45, width
1.8), alternating between two lanes so no flight is directly under the next. After each flight a
landing slab (0.4 thick) and a railing on its north edge (z = −11.4).

| Flight | Direction | Start X | Lane Z (centre) | Base Y | End X | Top Y | Landing X range | Landing Z range | Landing top |
|---|---|---|---|---|---|---|---|---|---|
| 0 | +x | −5 | −8.3 | 0 | 1.3 | 4 | 1.3..3.5 | −11.4..−7 | 4 |
| 1 | −x | 1.3 | −10.3 | 4 | −5 | 8 | −7.2..−5 | −11.4..−7 | 8 |
| 2 | +x | −5 | −8.3 | 8 | 1.3 | 12 | 1.3..3.5 | −11.4..−7 | 12 |
| 3 | −x | 1.3 | −10.3 | 12 | −5 | 16 | −7.2..−5 | −11.4..−7 | 16 |

Tread strips: lane −8.3 spans z −9.2..−7.4; lane −10.3 spans z −11.2..−9.4. Every step is solid
from its flight's base Y, so flights 1 and 3 hang in the air beside the tower (their undersides are
at y 4 and 12). The landing railings sit on the landings' outer (north, z = −11.4) edge only.

Markers (solo only): enemy spawns (0, 8, 0) and (0, 4, 3); sniper perch (0, 16, −3); pickups
(0, 12, 0), (−4, 8, 4), (0, 16, 0).

### 6.4 Building A (west): three floors, fire escape, ruler bridge

Footprint X −43..−25, Z 4..20. Floor spacing 4.

| Object | Details |
|---|---|
| Floors | Slabs over the full footprint, 0.4 thick, tops at **4, 8, 12** (12 is the roof). |

Exterior walls: base Y 0, height 12, thickness 0.4. Gaps are (along-range, bottom, top) relative to
the wall base.

| Face | Wall | Gaps |
|---|---|---|
| East (x = −25, along Z 4..20) | wall along Z | z 10..13 y 0..3.2 (door); z 6..9 y 5..7; z 14..17 y 5..7; z 6..9 y 9..11; z 14..17 y 9..11 |
| West (x = −43) | wall along Z | z 8..11 y 0..3.2; z 8..11 y 4.5..7.5; z 8..11 y 8.5..11.5 |
| North (z = 4, along X −43..−25) | wall along X | x −36..−33 y 0..3.2; x −40..−37 y 5..7; x −31..−28 y 5..7; x −36..−32 y 8.5..11.5 |
| South (z = 20) | wall along X | x −36..−32 y 0..3.2; x −31..−27 y 0..3.2; x −42..−39 y 0..3.2; x −37.2..−33.5 y 4.05..7.2; x −36..−32 y 8.4..11.4; x −41..−27 y 4.6..7.6; x −29..−25.5 y 8.05..11.2 |

Interior partitions (thickness 0.3):

| Partition | Base Y | Height | Gaps (full height) |
|---|---|---|---|
| Along X at z = 12, x −43..−25 | 0 | 4 | x −40..−37.5; x −30..−27.5 |
| Along X at z = 12, x −43..−25 | 4 | 4 | x −36..−32 |
| Along Z at x = −34, z 4..20 | 8 | 4 | z 8..11; z 14..17 |

Roof parapet railings (Y = 12): (−43, 4)→(−37, 4); (−31, 4)→(−25, 4); (−43, 20)→(−37.4, 20);
(−34.4, 20)→(−25, 20); (−43, 4)→(−43, 20); (−25, 4)→(−25, 9); (−25, 15)→(−25, 20).

**Fire escape (south face, z 20.2..24.4).** Three flights of 14 steps (rise 4/14, run 0.45, width
1.8) with landing slabs (Z 20.2..24.4, 0.4 thick) and a railing along each landing's south edge
(z = 24.4).

| Flight | Direction | Start X | Lane Z | Base Y | End X | Top Y | Landing X range | Landing top |
|---|---|---|---|---|---|---|---|---|
| 0 | −x | −28.5 | 21.2 | 0 | −34.8 | 4 | −37..−34.8 | 4 |
| 1 | +x | −34.8 | 23.2 | 4 | −28.5 | 8 | −28.5..−26.3 | 8 |
| 2 | −x | −28.5 | 21.2 | 8 | −34.8 | 12 | −37..−34.8 | 12 |

**Ruler bridge** from the A roof eastward at deck top y = 12. Its east end is X = −7 in solo (meets
the tower's third floor) and X = 24.2 in arena (reaches Building B's roof).

| Part | Solo | Arena |
|---|---|---|
| Deck (ORANGE, collides) | centre (−16.1, 11.6, 6), size 18.2 × 0.4 × 2.4 → x −25.2..−7, z 4.8..7.2 | centre (−0.5, 11.6, 6), size 49.4 × 0.4 × 2.4 → x −25.2..24.2 |
| Tick marks (BLACK, no-collide) | for i = 0..floor(length): box at (−25 + i, 12, 5) of 0.06 × 0.02 × (0.6 if i is a multiple of 5, else 0.35) | same rule, length 49.4 → i = 0..49 |
| Railing (ORANGE) | (−25, 7.2)→(−7, 7.2) at Y 12 | (−25, 7.2)→(24.2, 7.2) and a second rail (−25, 4.8)→(24.2, 4.8), both at Y 12 |

Seams: at the A end the deck (z 4.8..7.2) meets Building A's east parapet piece (−25, 4)→(−25, 9),
so a 1.0-high railing crosses the walkway there (player hops it; no nav link). At the solo tower
end the deck enters floor 3 across the tower's open west edge. In arena the far end meets Building
B's west parapet piece (24, 4)→(24, 9), again a railed seam. See also section 6.13.

Markers: enemy spawns (−34, 12, 12) roof and (−40, 0, 18) ground floor; sniper perch (−27, 12, 6);
pickups (−34, 4, 12), (−30, 12, 16), (−40, 8, 8).

### 6.5 Building B (east): warehouse with catwalk and skylight

Footprint X 24..44, Z 4..20, walls 12 high.

**Roof** at top y 12 (0.4 thick) with a 6 × 6 skylight hole at x 31..37, z 9..15, built as four
slabs: (24, 4)→(44, 9); (24, 15)→(44, 20); (24, 9)→(31, 15); (37, 9)→(44, 15).

Exterior walls (base 0, height 12, thickness 0.4):

| Face | Gaps |
|---|---|
| West (x = 24, z 4..20) | z 10..14 y 0..3.6 (door); z 6..9 y 7..10; z 15..18 y 7..10 |
| East (x = 44) | z 7..10 y 0..3.2; z 14..17 y 0..3.2; z 8..16 y 7..10 |
| North (z = 4, x 24..44) | x 32..36 y 0..3.6; x 27..30 y 7..10; x 38..41 y 7..10 |
| South (z = 20) | x 26..29 y 0..3.2; x 39..42 y 0..3.2; x 33.5..36.5 y 4.05..7.2; x 25.5..28.5 y 8.05..11.2; x 32..36 y 8..11 |

**Interior catwalk**, top y 6, 0.3 thick, 1.6 wide around the inside of the walls:

| Slab | X range | Z range |
|---|---|---|
| West run | 24.4..26 | 4.4..19.6 |
| East run | 42..43.6 | 4.4..19.6 |
| North run | 26..42 | 4.4..6 |
| South run | 26..42 | 18..19.6 |

Catwalk railings (Y = 6), all on the inner edges of the runs: (26, 6)→(26, 9); (26, 15)→(26, 17);
(42, 6)→(42, 18); (26, 6)→(31, 6); (37, 6)→(42, 6); (26, 18)→(42, 18). Openings: on the west run's
inner edge (x = 26) z 9..15 and z 17..18; on the north run's inner edge (z = 6) x 31..37 (under the
skylight). The east run (x = 42) and the south run (z = 18) are railed along their whole inner edge.

**Interior stairs**: start (26.2, 0, 8.6), direction +z, 21 steps, rise 6/21 ≈ 0.2857, run 0.45,
width 1.6 (x 25.4..27.0). Arrives at z = 18.05, y = 6. The stair strip overlaps the west run
(x 24.4..26) in plan, and the west run's inner railing line (x = 26) passes through the middle of
the strip: the railing pieces at z 6..9 and z 15..17 stand over the steps (at z 15..17 the treads
are at y 4.3..5.7 and the railing occupies y 6..7, so a standing body must keep to the east side,
x ≥ 26.4, or the west side), and the top of the stairs (z 18.05) faces the south run's railing
(x 26..42 at z = 18). A body leaves the stairs onto the west run through the z 17..18 opening
(the step tops there, 5.4..5.7, are within step-up height of the catwalk top 6). Enemies get nav
nodes on the steps but their links onto the catwalk are limited by the same railings.

**Crates inside** (solid boxes):

| Centre X | Bottom Y | Centre Z | W | H | D | Tone |
|---|---|---|---|---|---|---|
| 34 | 0 | 12 | 2.4 | 2.4 | 2.4 | BLUE |
| 36.4 | 0 | 12 | 2.4 | 1.2 | 2.4 | BLUE |
| 30 | 0 | 16 | 1.6 | 1.6 | 1.6 | GREEN |

**Exterior switchback (south face, z 20.2..24.4)**, three flights of 14 steps (rise 4/14, run
0.45, width 1.8), landings 0.4 thick spanning Z 20.2..24.4, railing along each landing's z = 24.4
edge:

| Flight | Direction | Start X | Lane Z | Base Y | End X | Top Y | Landing X range | Landing top |
|---|---|---|---|---|---|---|---|---|
| 0 | +x | 27.5 | 21.2 | 0 | 33.8 | 4 | 33.8..36 | 4 |
| 1 | −x | 33.8 | 23.2 | 4 | 27.5 | 8 | 25.3..27.5 | 8 |
| 2 | +x | 27.5 | 21.2 | 8 | 33.8 | 12 | 33.8..36 | 12 |

Roof parapet railings (Y = 12): (24, 4)→(31, 4); (37, 4)→(44, 4); (24, 20)→(33.4, 20);
(36.4, 20)→(44, 20); (44, 4)→(44, 20); (24, 4)→(24, 9); (24, 15)→(24, 20).

**Plank bridge** (both modes): box centre (15.5, 11.6, 6), size 17.4 × 0.4 × 2.2 → x 6.8..24.2,
z 4.9..7.1, top 12. Railing (7, 4.9)→(24, 4.9) at Y 12 (north side only; the south side z 7.1 is
open). In solo it joins the tower's third floor to the B roof; in arena (no tower) it lies inside
the ruler bridge's footprint (the ruler deck x −25.2..24.2, z 4.8..7.2 at the same top height), so
A roof and B roof are joined by one continuous walkway with the plank's railing coincident with the
ruler's z 4.8 railing. Seams: at the B end the bridge meets B's west parapet piece (24, 4)→(24, 9)
(a 1.0-high railing across the walkway); at the tower end (solo) it meets floor 3's full east
railing (7, −7)→(7, 7). See section 6.13.

Markers: enemy spawns (34, 12, 18) roof and (40, 0, 8) inside; sniper perch (26, 12, 18);
pickups (34, 2.4, 12), (34, 6, 19), (42, 12, 6).

**Intentional playable correction:** the first pickup is on the 2.4-high crate. The design
point (34, 0, 12) placed it inside that solid crate, outside the player's 1.5 collection range.

### 6.6 Highway (elevated road, z = −30, deck top y = 7)

| Object | Details |
|---|---|
| Deck | Slab (−52, −34.5)→(52, −25.5), 0.6 thick, top 7 (y 6.4..7). |
| North barrier | Wall along X at z = −34.3, base 7, height 0.9, thickness 0.4, x −52..52, gaps (full height) x −33..−29, x 27..31, x −2..2 (openings toward the row-house bridges). |
| South barrier | Same at z = −25.7, gaps x −36.5..−33 and x 33..36.5 (ramp arrivals). |
| Pillars | Boxes 1.4 × 6.4 × 1.4 at ground, at x = −48, −36, −24, −12, 0, 12, 24, 36, 48, z = −30. |
| West ramp | Stairs start (−46.5, 0, −24.5), +x, 25 steps, rise 0.28, run 0.45, width 2 (z −25.5..−23.5). Ends x −35.25, top 7. |
| East ramp | Stairs start (46.5, 0, −24.5), −x, 25 steps, rise 0.28, run 0.45, width 2. Ends x 35.25, top 7. |
| Road dashes | BLACK no-collide boxes 2 × 0.02 × 0.2 with bottom at y 7, centred at x = −49, −45, …, 47 (25 dashes, every 4 units), z −30. |

Markers: enemy spawns (−48, 7, −30), (48, 7, −30); sniper perch (0, 7, −30); pickups
(−10, 7, −30), (24, 7, −30).

### 6.7 Row houses (north, z = −45)

| Object | Centre X | Bottom Y | Centre Z | W | H | D | Notes |
|---|---|---|---|---|---|---|---|
| House 1 | −30 | 0 | −45 | 14 | 7 | 10 | x −37..−23, z −50..−40, roof 7 |
| House 2 | −8 | 0 | −45 | 14 | 11 | 10 | x −15..−1, roof 11 |
| House 3 | 16 | 0 | −45 | 14 | 7 | 10 | x 9..23, roof 7 |
| Bridge (highway → house 1) | −31 | 6.7 | −37.25 | 2.6 | 0.3 | 5.5 | z −40..−34.5, top 7 |
| Bridge (highway → house 3) | 29 | 6.7 | −37.25 | 2.6 | 0.3 | 5.5 | top 7 |
| Bridge (highway, centre) | 0 | 6.7 | −37.25 | 2.6 | 0.3 | 5.5 | top 7; ends at z −40 in the gap between houses 2 and 3 |
| Bridge railings (Y 7) | | | | | | | (−32.3, −40)→(−32.3, −34.5); (−29.7, −40)→(−29.7, −34.5); (27.7, −40)→(27.7, −34.5); (30.3, −40)→(30.3, −34.5) |
| Stairs house 1 → house 2 | start (−23, 7, −45), +x, 14 steps, rise 4/14, run 0.45, width 2.2 (z −46.1..−43.9) | | | | | | ends x −16.7, top 11; steps are solid from y 7 (they hang over the gap) |
| Landing | slab (−16.9, −46.1)→(−15, −43.9), top 11, 0.4 thick | | | | | | meets house 2's west face |
| Stairs house 3 → house 2 | start (9, 7, −45), −x, 14 steps, same sizes | | | | | | ends x 2.7, top 11 |
| Landing | slab (−1, −46.1)→(2.9, −43.9), top 11, 0.4 thick | | | | | | meets house 2's east face |
| Chimney | −33 | 7 | −48 | 1.2 | 1.6 | 1.2 | |
| Chimney | 19 | 7 | −42 | 1.2 | 1.4 | 1.2 | |
| Water tank | cylinder centre (−10, −47.5), bottom 11, radius 1.4, height 2.6, 14 segments | | | | | | collider 2.24 × 2.6 × 2.24 |
| Antenna | −5 | 11 | −42 | 0.1 | 4 | 0.1 | no-collide, BLACK |

Markers: enemy spawns (−8, 11, −45), (−30, 7, −48), (16, 7, −45); sniper perches (−8, 11, −48),
(16, 7, −43); pickups (−8, 11, −43), (−30, 7, −45).

### 6.8 South plaza and field cover (solo only)

All boxes collide unless noted.

| Object | Centre X | Bottom Y | Centre Z | W | H | D | Tone / notes |
|---|---|---|---|---|---|---|---|
| Container (lower) | −14 | 0 | 34 | 2.5 | 2.6 | 6.2 | GREEN |
| Container (upper) | −14 | 2.6 | 34 | 2.5 | 2.6 | 6.2 | ORANGE, stacked |
| Container | 14 | 0 | 36 | 6.2 | 2.6 | 2.5 | BLUE |
| Container (upper, short) | 17 | 2.6 | 36 | 3 | 2.6 | 2.5 | GREEN |
| Crate | −6 | 0 | 28 | 1.4 | 1.4 | 1.4 | |
| Crate | −4.5 | 0 | 28.5 | 1.2 | 1.2 | 1.2 | |
| Crate (stacked) | −5.3 | 1.4 | 28.2 | 1.0 | 1.0 | 1.0 | |
| Crate | 8 | 0 | 26 | 1.6 | 1.6 | 1.6 | |
| Crate | 9.6 | 0 | 26.4 | 1.2 | 1.2 | 1.2 | |
| Bus body | 24 | 0.6 | 40 | 11 | 3.2 | 2.8 | roof top at 3.8 (climbable) |
| Bus underside | 24 | 0 | 40 | 10 | 0.6 | 2.6 | no-collide |
| Bus wheels | x ∈ {20, 28}, z ∈ {41.5, 38.5} | 0 | | r 0.55 | 0.4 | | vertical cylinders, 10 segments, no-collide, BLACK |
| Pencil body | −30 | 0 | 44 | 16 | 1.6 | 1.6 | visual: 6-sided cylinder radius 0.8 lying along X, centre height 0.8, ORANGE; collider as given |
| Pencil tip | −20.8 | 0 | 44 | 2.4 | 1.6 | 1.6 | visual: cone radius 0.8 length 2.4 pointing +x, BLACK |
| Pencil hitbox | −38.8 | 0 | 44 | 1.6 | 1.64 | 1.64 | visual: 8-sided cylinder radius 0.82 length 1.6 along X, PINK |
| Hitbox block | 38 | 0 | 40 | 6 | 2.2 | 3.2 | PINK |
| Hitbox block top | 38 | 2.2 | 40 | 6 | 0.8 | 3.2 | BLUE, top at 3.0 |
| Coffee mug | cylinder centre (−40, 32), bottom 0, radius 2.6, height 3.4, 16 segments | | | | | | collider 4.16 × 3.4 × 4.16 |
| Mug handle | torus major 1.4, tube 0.35 at (−36.6, 1.8, 32) standing in the XY plane | | | | | | visual only, BLUE |
| Lamp posts | at (X, Z) ∈ {(−10, 46), (10, 46), (−22, 24), (22, 24)} | | | | | | pole box 0.25 × 6 × 0.25 (collides); head box 1.4 × 0.3 × 0.5 bottom at 6 (no-collide) |
| Benches | at (X, Z) ∈ {(−4, 46), (4, 46)} | | | | | | seat box 3 × 0.15 × 0.6 with bottom at 0.4 (collides); base box 2.6 × 0.4 × 0.2 at ground (no-collide) |

Pickups (solo plaza): (−6, 0, 36), (6, 0, 36), (−30, 1.6, 44) on the pencil, (38, 3, 40) on the
hitbox, (0, 0, 10).

Scattered cover in the open middle (solo only):

| Centre X | Bottom Y | Centre Z | W | H | D | Tone |
|---|---|---|---|---|---|---|
| −16 | 0 | −8 | 2.2 | 1.2 | 2.2 | BLUE |
| 18 | 0 | −10 | 2.2 | 1.6 | 2.2 | BLUE |
| −20 | 0 | 8 | 1.6 | 1.0 | 3 | BLUE |
| 20 | 0 | −2 | 3 | 1.0 | 1.6 | BLUE |
| −8 | 0 | −18 | 4 | 1.1 | 1.2 | BLUE |
| 8 | 0 | −18 | 4 | 1.1 | 1.2 | BLUE |
| 0 | 0 | 22 | 5 | 0.5 | 1.4 | BLUE |
| −24 | 0 | −18 | 2.4 | 2.6 | 2.4 | ORANGE |
| 26 | 0 | −18 | 2.4 | 2.6 | 2.4 | GREEN |

### 6.9 Sky props (both modes, visual only, no colliders)

- **Sun**: sphere radius 12 at (−90, 110, −160), 12 segments. Twelve rays: boxes 6 × 0.7 × 0.7
  rotated about Z by a = i × 30° (i = 0..11), centred at (−90 + 19 cos a, 110 + 19 sin a, −160).
- **Clouds**: for each cloud centre (cx, cy, cz) with scale s, six spheres i = 0..5 at
  (cx + (i − 2.5) × 5 s, cy + 2.5 s × sin(1.7 i), cz) with radius (4 + (i mod 3)) × s.

| cx | cy | cz | s |
|---|---|---|---|
| 60 | 70 | −170 | 1 |
| −20 | 75 | −190 | 1.3 |
| 140 | 60 | −80 | 0.9 |
| −150 | 65 | 40 | 1.1 |
| 30 | 80 | 180 | 1.2 |
| −90 | 60 | 170 | 0.8 |

These are far outside the bounds and only need to be visible above the perimeter wall.

### 6.10 Solo drones

3 planes, base radius 30, base height 30, scale 1.4, radius step 8, height step 6, speed 0.11,
BLUE. Cone radius 1.68, length 5.6, grab radius 3.08.

| i | Orbit r | Height h | Phase | Speed |
|---|---|---|---|---|
| 0 | 30 | 30 | 0 | 0.11 |
| 1 | 38 | 36 | 2.1 | 0.12 |
| 2 | 46 | 42 | 4.2 | 0.13 |

### 6.11 Team spawns (defined, unused)

Two lists are stored on the level record but no other module reads them:

- Team 1: (−40, 0, 18), (−34, 12, 12), (−48, 7, −30), (−52, 0, 30), (−30, 7, −48)
- Team 2: (40, 0, 8), (34, 12, 18), (48, 7, −30), (52, 0, 30), (16, 7, −45)

### 6.12 Downtown marker totals

| List | Solo | Arena |
|---|---|---|
| Enemy spawns | 21 (10 perimeter, 2 tower, 2 A, 2 B, 2 highway, 3 houses) | 19 (no tower) |
| Sniper perches | 6 | 5 (no tower) |
| Pickup locations | 18 | 10 (no tower, no plaza) |
| Grapple rings | 2 (crane) | 13 (8 ledge rings at y 20, 5 pad rings) |
| Arena spawns | 0 (matches fall back to enemy spawns) | 15 |
| Grapple movers | 3 planes | 4 planes |
| Breakables | 0 | 0 |

### 6.13 Railing seams that cross walkways (both modes unless noted)

Every place where a 1.0-high railing collider stands across a walkable connection. The player
crosses these by jumping (or mantling). These rails block ordinary walking and enemy nav links;
boss step height and enemy AI jumps can still permit crossing. Keep both the colliders and the
enemy movement rules.

| Seam | Railing piece | Walkway it crosses |
|---|---|---|
| Tower floors 1–3, north edge (solo) | (−7, −7)→(7, −7) at Y 4, 8, 12 | Exterior stair landings (x 1.3..3.5 and −7.2..−5) |
| Tower floor 3, east edge (solo) | (7, −7)→(7, 7) at Y 12 | Plank bridge (z 4.9..7.1) |
| Building A roof, east parapet | (−25, 4)→(−25, 9) at Y 12 | Ruler bridge deck (z 4.8..7.2) |
| Building B roof, west parapet | (24, 4)→(24, 9) at Y 12 | Plank bridge (solo) / ruler + plank bridge (arena) |
| Building B catwalk, south run | (26, 18)→(42, 18) at Y 6 | Top of the interior stairs (x 25.4..27, z 18.05) — bypassed via the z 17..18 opening onto the west run |

Connections that are open (no railing across them): fire-escape and switchback landings onto the
A and B roofs (the parapets have openings x −37..−31 and x −37.4..−34.4 on A, x 31..37 and
x 33.4..36.4 on B, in front of the top landings), the highway ramps (barrier openings x −36.5..−33
and 33..36.5), the highway-to-house bridges (barrier openings x −33..−29, 27..31, −2..2), the
row-house stairs, the tower roof's north opening (x −7..−5), and the perimeter ledges (no
railings at all).

---

## 7. Map 2: Mexico

Bounds ±62 (P = 62). Player start (0, 0, 16). Key `mexico`. Same geometry in solo and arena.

**Before enabling Mexico:** keep this map disabled until both checks below pass. The tables
retain the design data; they do not yet define a safe set of spawn and pickup positions.

- **Shared colliders:** replace random solid mesa offsets (7.1) and random pot collider sizes
  (7.7) with fixed collider data, or specify shared build randomness for every peer. Matching
  breakable ids alone does not make the collision worlds match. Verify that peers build the
  same colliders before a match starts.
- **Marker clearance:** check every sniper and arena spawn with its full body box, and check
  that every pickup can be collected. Resolve these known overlaps before enabling the map:
  sniper (10, 15, 46) is inside the dome collider (7.4); sniper (0, 13.45, 0), arena spawn
  (0, 13.6, 0), and pickup (0, 13.5, 0) are inside the sombrero crown (7.2); sniper
  (−10, 30.6, 46) and arena spawn (−10, 30.8, 46) intersect the belfry cross post (7.4);
  arena spawn (0, 11.2, 44) and pickup (0, 11, 44) intersect the church roof ridge (7.4).
  The house sniper points (−40, 7.5, 14) and (40, 7, −18), and house arena points
  (−40, 6.2, −20), (40, 7.2, −18), (−40, 7.7, 14), (40, 6.7, 16), are below the roof
  surfaces in 7.5. The bandstand arena point (0, 5.6, −26) is below its roof top 5.9 (7.3).
  Do not depend on physics push-out to repair these initial positions.

### 7.1 Ground, mesas, sky lid, edge spawns

| Object | Details |
|---|---|
| Ground | Box centre (0, 0), bottom −1, size 134 × 1 × 134 (top y 0, spans ±67). |
| Sky lid | Invisible collider centre (0, 0), bottom 62, size 164 × 6 × 164 (y 62..68), flags **no-nav + no-grapple**. |

**Mesas** (stepped rock stacks; each is three solid boxes). For a mesa with centre (X, Z), width W,
depth D:

| Tier | Centre | Bottom Y | Size |
|---|---|---|---|
| 1 | (X, Z) | 0 | W × 11 × D |
| 2 | (X + rand(−1.2, 1.2), Z + rand(−1.2, 1.2)) | 11 | 0.78 W × 7 × 0.78 D |
| 3 | (X + rand(−1, 1), Z + rand(−1, 1)) | 18 | 0.5 W × 5 × 0.5 D |

Twenty mesas: for i = −2..2, at (24 i, −62) and (24 i, 62) with W 19, D 8; at (−62, 24 i) and
(62, 24 i) with W 8, D 19. So there is a 5-unit gap between neighbouring mesas along each edge
(gap centres at ±12 and ±36).

**Enemy spawn points** (16), in those gaps: for i = −2..1, at (24 i + 12, 0, −57), (24 i + 12,
0, 57), (−57, 0, 24 i + 12) and (57, 0, 24 i + 12). That is X or Z ∈ {−36, −12, 12, 36} paired
with ±57 on the other axis.

### 7.2 The plaza: paving, fountain, floating sombrero

| Object | Details |
|---|---|
| Paving | Slab (−24, −24)→(24, 24), top 0.15, thickness 0.15 (a 0.15 step everyone walks over). |
| Fountain basin | Cylinder centre (0, 0), bottom 0, radius 5.5, height 1.1 (collider 8.8 × 1.1 × 8.8). |
| Fountain column | Cylinder bottom 1.1, radius 1.2, height 2.6 (collider 1.92 × 2.6 × 1.92, y 1.1..3.7). |
| Upper bowl | Cylinder bottom 3.7, radius 2.4, height 0.5 (collider 3.84 × 0.5 × 3.84, top 4.2). |
| Finial | Visual BLUE sphere radius 0.7 at (0, 5.4, 0). |
| Water disc | Visual BLUE cylinder radius 5.1, height 0.08, centred at y 1.1, 20 segments. |
| Spouts | 8 visual thin cylinders radius 0.06, length 2.6, tilted 0.35 rad from vertical, at angle a = k × 45° (k = 0..7), centred at (1.7 cos a, 5.0, 1.7 sin a). |
| Ring | Flat grapple ring at (0, 7.2, 0). |
| Sombrero brim | Cylinder centre (0, 0), bottom 13, radius 8, height 0.45, ORANGE (collider 12.8 × 0.45 × 12.8, top 13.45 — a floating platform). |
| Sombrero crown | Cylinder bottom 13.45, radius 3.2, height 3, ORANGE (collider 5.12 × 3 × 5.12, top 16.45). |
| Hat band | Visual PINK cylinder radius 3.3, height 0.5, centred at y 13.9, 16 segments. |
| Brim rings | 6 flat grapple rings at (7.2 cos a, 12.2, 7.2 sin a) for a = k × 60°, k = 0..5 (just under the brim edge). |
| Top ring | Flat grapple ring at (0, 17.5, 0). |

### 7.3 The bandstand and the mariachi band

| Object | Details |
|---|---|
| Stage | Cylinder centre (0, −26), bottom 0, radius 6.5, height 1.2 (collider 10.4 × 1.2 × 10.4, top 1.2). |
| Steps | Stairs start (0, 0, −19.5), direction −z, 4 steps, rise 0.3, run 0.5, width 4.5 (x −2.25..2.25). Ends z −21.5, top 1.2. |
| Posts | 8 visual ORANGE cylinders radius 0.22, height 4.2, bottom 1.2, no-collide, at (5.6 cos a, −26 + 5.6 sin a) for a = k × 45° + 22.5°. |
| Roof cone | Visual ORANGE 8-sided cone radius 7.6, height 3.2, centred at y 7.0 (spans 5.4..8.6) over (0, −26). |
| Roof disc | Visual BLUE 8-sided cylinder radius 7.6, height 0.3, centred y 5.55. |
| Roof collider | Box centre (0, −26), bottom 5.4, size 9 × 0.5 × 9, **no-nav** (a 9 × 9 stand-able roof, top 5.9). |
| Ring | Flat grapple ring at (0, 9.4, −26). |

**Mariachis** (three decorative humanoid figures; no colliders, not enemies, cannot be hit):

| Figure | Position (feet) | Yaw (rad) | Instrument |
|---|---|---|---|
| 1 | (−2.6, 1.2, −27.5) | 0.4 | guitar |
| 2 | (0, 1.2, −28.5) | 0 | trumpet |
| 3 | (2.6, 1.2, −27.5) | −0.4 | guitar |

Each is built with the shared humanoid figure builder (enemies subsystem) using: weapon type
"rifle" (then the gun's child meshes are removed), scale 1, hat "none", body width 1.05, head size
1, limb radius 0.034, BLACK tone drawn flat (no shading). Added on top of the head (offset +0.5 up
in head space): a sombrero made of a brim cylinder radius 0.62 height 0.05 (ORANGE), a crown
cylinder radius 0.22 top / 0.26 bottom height 0.28 raised 0.16 (ORANGE), and a PINK band torus
major 0.24 tube 0.03 raised 0.06. Held in the gun slot:

- Guitar: ORANGE box 0.34 × 0.12 × 0.5 at (0, 0.02, 0.05) and a BLACK neck box 0.06 × 0.05 × 0.7 at
  (0, 0.06, 0.55). Pose: right upper arm pitch −0.9, left upper arm pitch −1.0 and yaw 0.5, left
  forearm pitch −0.9.
- Trumpet: ORANGE tube radius 0.035 length 0.55 along the forward axis at (0, 0.02, 0.25) and an
  ORANGE bell cone radius 0.14→0.05 length 0.16 at (0, 0.02, 0.55). Pose: right upper arm −1.6,
  left upper arm −1.5 with yaw 0.4, left forearm −0.4, head pitch −0.25.

Animation each frame, with t = game time and x = the figure's X: s = sin(6 t + x);
height = 1.2 + 0.08 × max(0, s); torso roll about Z = 0.04 s; guitar players: right forearm pitch =
−0.5 + 0.25 sin(9 t + x); trumpet player: head roll about Z = 0.08 sin(4 t + x).

### 7.4 The church

| Part | Centre X | Bottom Y | Centre Z | W | H | D | Notes |
|---|---|---|---|---|---|---|---|
| Nave | 0 | 0 | 44 | 24 | 11 | 16 | x −12..12, z 36..52; roof top 11 |
| Roof ridge | 0 | 11 | 44 | 24 | 1.6 | 4.5 | z 41.75..46.25, top 12.6 |
| Cupola | 0 | 12.6 | 44 | 3 | 1.2 | 3 | top 13.8 |
| Cross post | 0 | 13.8 | 44 | 0.3 | 2.2 | 0.3 | |
| Cross bar | 0 | 15.2 | 44 | 1.4 | 0.3 | 0.3 | |
| Front step | slab (−7, 33.5)→(7, 36.5), top 0.8, thickness 0.8 | | | | | | |
| Door posts | ±3.2 | 0 | 35.8 | 0.5 | 5.4 | 0.5 | no-collide, BLACK |
| Door arch | half torus major 3.2, tube 0.25, upper half, in the XY plane at (0, 5.4, 35.8) | | | | | | visual, BLACK |
| Windows | ±8 | 3 and 7 | 35.9 | 1.6 | 2.2 | 0.3 | 4 boxes, no-collide, BLACK |
| **Bell tower** | −10 | 0 | 46 | 6 | 26 | 6 | x −13..−7, z 43..49, top 26 |
| Belfry posts | −10 ± 2.5 | 26 | 46 ± 2.5 | 0.6 | 4 | 0.6 | 4 posts, collide |
| Belfry cap | −10 | 30 | 46 | 7.2 | 0.6 | 7.2 | stand-able, top 30.6 |
| Cap cross post | −10 | 30.6 | 46 | 0.3 | 3 | 0.3 | |
| Cap cross bar | −10 | 32.4 | 46 | 1.6 | 0.3 | 0.3 | |
| Bell | visual ORANGE sphere radius 0.95 at (−10, 28.2, 46) | | | | | | |
| Rings | flat rings at (−10, 27.4, 42.2) and (−10, 33.8, 46) | | | | | | |
| Tower ledges (north face) | −10 | 8, 15, 21 | 42.4 | 6 | 0.4 | 1.3 | ORANGE; tops 8.4, 15.4, 21.4; z 41.75..43.05 |
| Tower ledges (west face) | −13.6 | 11, 18, 24 | 46 | 1.3 | 0.4 | 6 | ORANGE; tops 11.4, 18.4, 24.4; x −14.25..−12.95 |
| **Dome tower** | 10 | 0 | 46 | 6 | 15 | 6 | x 7..13, z 43..49, top 15 |
| Dome | visual ORANGE sphere radius 3.6 at (10, 17.4, 46) | | | | | | |
| Dome collider | 10 | 15 | 46 | 6 | 5 | 6 | no-nav (y 15..20) |
| Spike | 10 | 20.8 | 46 | 0.3 | 2 | 0.3 | |
| Ring | flat ring at (10, 21.6, 46) | | | | | | |
| Dome tower ledges (east face) | 13.6 | 6, 11 | 46 | 1.3 | 0.4 | 6 | ORANGE; tops 6.4, 11.4 |

The ledges form the climbing route up the bell tower (rises of 3 units between successive ledges,
alternating between the north and west faces: 8.4 → 11.4 → 15.4 → 18.4 → 21.4 → 24.4, then the
belfry cap at 30.6) and up the dome tower (6.4 → 11.4 → 15). The first ledge is 8.4 above the
ground and no ledge is within the 1.35 nav rise of another, so these are player-only routes (jump,
mantle, grapple to the rings at (−10, 27.4, 42.2), (−10, 33.8, 46) and (10, 21.6, 46), or the
banner ring above the plaza); enemies never path onto them. Sniper perches and match spawns are
nevertheless placed on the belfry cap and the dome tower top (section 7.10): the spawner puts
those enemies there directly, and they can only leave by falling or dropping through nav links.

### 7.5 Adobe houses

A house with centre (X, Z), width W (X size), depth D (Z size), height H, door tone and side S
(+1 = door faces east / stairs on the west side; −1 = door faces west / stairs on the east side)
consists of:

| Part | Details |
|---|---|
| Body | Box (X, 0, Z), W × H × D. |
| Parapet | Box (X, H, Z), (W + 0.6) × 0.35 × (D + 0.6), ORANGE. Roof surface effectively at H + 0.35. |
| North railing | Rail from (X − W/2, Z − D/2) to (X + W/2, Z − D/2) at floor Y = H + 0.35, ORANGE. |
| Door | No-collide box at (X + S(W/2 + 0.01), 0, Z), 0.15 × 2.6 × 1.4, door tone. |
| Lintel | No-collide BLACK box at (X + S(W/2 + 0.01), 2.6, Z), 0.15 × 0.3 × 1.8. |
| Windows | Two no-collide BLACK boxes at (X + S(W/2 + 0.01), 1.6, Z ± 0.32 D), 0.12 × 1.1 × 1.1. |
| Stairs | N = round(H / 0.3) steps, rise H / N, run 0.42, width 1.6, along the south face: start (X − S(W/2 + 0.3), 0, Z + D/2 + 0.9), direction +x if S = +1 else −x. Tread strip z from Z + D/2 + 0.1 to Z + D/2 + 1.7. |
| Roof hut | Box (X, H + 0.35, Z + D/2 − 1.2), 2.2 × 0.9 × 1.4, ORANGE (a low block on the roof by the south edge). |
| Ring | Flat grapple ring at (X, H + 3.2, Z). |

| House | X | Z | W | D | H | Door | S | Steps N | Rise | Stairs start X | Stairs end X | Stairs Z centre | Roof Y | Ring Y |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W1 | −40 | −20 | 11 | 9 | 6 | GREEN | +1 | 20 | 0.300 | −45.8 | −37.4 | −15.6 | 6.35 | 9.2 |
| W2 | −40 | −4 | 9 | 8 | 5 | PINK | +1 | 17 | 0.294 | −44.8 | −37.66 | 0.9 | 5.35 | 8.2 |
| W3 | −40 | 14 | 12 | 10 | 7.5 | ORANGE | +1 | 25 | 0.300 | −46.3 | −35.8 | 19.9 | 7.85 | 10.7 |
| E1 | 40 | −18 | 12 | 9 | 7 | PINK | −1 | 23 | 0.304 | 46.3 | 36.64 | −12.6 | 7.35 | 10.2 |
| E2 | 40 | 0 | 9 | 8 | 5.5 | GREEN | −1 | 18 | 0.306 | 44.8 | 37.24 | 4.9 | 5.85 | 8.7 |
| E3 | 40 | 16 | 11 | 10 | 6.5 | ORANGE | −1 | 22 | 0.295 | 45.8 | 36.56 | 21.9 | 6.85 | 9.7 |

### 7.6 Papel picado banners (visual, with one ring each)

A banner from point 1 (x1, y1, z1) to point 2 (x2, y2, z2) with n segments: sample points at
t = i/n for i = 0..n; x and z interpolate linearly; y = linear interpolation − 1.2 sin(π t) (a sag
of 1.2 at the middle). Between consecutive points a BLACK bar 0.05 × 0.05 is drawn. At every odd i
a flag 0.7 × 0.55 × 0.02 hangs 0.32 below the point, coloured PINK / GREEN / ORANGE by i mod 3
(0 → PINK, 1 → GREEN, 2 → ORANGE). At i = floor(n/2) a flat grapple ring is placed 1.2 below the
line point. No colliders.

| Banner | From | To | n | Mid-line point (i = n/2) | Ring position |
|---|---|---|---|---|---|
| 1 | (−34.5, 6.4, −20) | (−8, 30.6, 42) | 22 | (−21.25, 17.3, 11) | (−21.25, 16.1, 11) |
| 2 | (34.5, 7.4, −18) | (8, 21.2, 42) | 22 | (21.25, 13.1, 12) | (21.25, 11.9, 12) |
| 3 | (−34.5, 5.4, −4) | (34.5, 5.9, 0) | 26 | (0, 4.45, −2) | (0, 3.25, −2) |
| 4 | (−34.5, 7.9, 14) | (34.5, 6.9, 16) | 26 | (0, 6.2, 15) | (0, 5.0, 15) |

Bars: each bar is horizontal at the height of its starting sample point (not tilted to follow the
sag), of length (segment horizontal length + 0.05), rotated in plan to follow the line. Flags are
rotated in plan to face along the line. Banners 1 and 2 end at the belfry cap and the dome tower;
banners 3 and 4 run west–east across the plaza just above head height at the middle (line 4.45
and 6.2 over the plaza centre).

### 7.7 The market: stalls, piñatas, crates, pots, barrels

**Stall** with centre (X, Z), width W, depth D:

| Part | Details |
|---|---|
| Counter | Box (X, 0, Z), W × 0.9 × D, collides. |
| Posts | 4 no-collide BLACK boxes 0.14 × 2.9 × 0.14 at the corners (X ± (W/2 − 0.15), Z ± (D/2 − 0.15)). |
| Canopy | 5 visual strips, each (W + 0.6) × 0.06 × (D + 0.6)/5, centred at height 2.95 (spanning 2.92..2.98), laid side by side along Z starting at Z − (D + 0.6)/2 (strip i centred at Z − (D + 0.6)/2 + (i + 0.5)(D + 0.6)/5); strip i is ORANGE for even i, PINK for odd i. |
| Canopy collider | Box (X, 2.9, Z), (W + 0.6) × 0.12 × (D + 0.6), **no-nav** (top 3.02; stand-able). |

| Stall | X | Z | W | D |
|---|---|---|---|---|
| 1 | −20 | 22 | 4.5 | 2.4 |
| 2 | −13 | 22 | 4.5 | 2.4 |
| 3 | 20 | 22 | 4.5 | 2.4 |
| 4 | 13 | 22 | 4.5 | 2.4 |
| 5 | −24 | −12 | 2.4 | 4.5 |
| 6 | 26 | −8 | 2.4 | 4.5 |

**Breakable prop types** (see 3.11; the collider is centred at (X, Z) with the given size, the hit
point value is what damage must reach to break it):

| Kind | Collider W × H × D | HP | Tone (debris tint) | Visual parts (relative to base at (X, Y, Z)) |
|---|---|---|---|---|
| Pot (small) | 0.9 × 0.9 × 0.9 | 1 | ORANGE | ORANGE 9-sided cylinder, top radius 0.30, bottom radius 0.40, height 0.85; BLACK rim torus major 0.288 tube 0.05 at height 0.85; PINK band torus major 0.392 tube 0.04 at height 0.38. |
| Pot (big) | 1.2 × 1.3 × 1.2 | 1 | ORANGE | Same shape with radius 0.55 (top 0.4125), height 1.2; rim torus major 0.396 at 1.2; band torus major 0.539 at 0.54. |
| Crate | 1.1 × 1.1 × 1.1 | 30 | BLUE | BLUE cube 1.1 centred at height 0.55; two BLACK bands 1.14 × 0.12 × 0.12 at heights 0.2 and 0.9 on the +z face (z + 0.56). |
| Barrel | 1.1 × 1.2 × 1.1 | 30 | ORANGE | ORANGE 10-sided cylinder top radius 0.5, bottom 0.45, height 1.2; BLACK hoops (torus major 0.5 tube 0.04) at heights 0.25 and 0.95. |
| Cactus (height h) | 0.9 × h × 0.9 | 40 | GREEN | GREEN trunk cylinder top 0.28 bottom 0.34 height h; arm cylinders: (0.6, 0.55 h, 0) vertical r 0.16/0.18 h 0.9; (0.35, 0.38 h, 0) horizontal along X r 0.17 length 0.7; (−0.55, 0.7 h, 0) vertical r 0.14/0.16 h 0.7; (−0.3, 0.55 h, 0) horizontal r 0.15 length 0.6; PINK flower sphere r 0.16 at (0, h + 0.05, 0). |
| Piñata | 1.1 × 0.9 × 0.6 | 1 | PINK | PINK body 0.9 × 0.5 × 0.45 at height 0.55; three stripes 0.1 × 0.52 × 0.47 at x −0.3 (GREEN), 0 (ORANGE), 0.3 (GREEN); PINK head 0.34 × 0.3 × 0.3 at (0.6, 0.72, 0); ORANGE ears 0.1 × 0.22 × 0.08 at (0.62, 0.95, ±0.1); four PINK legs 0.12 × 0.34 × 0.12 at (±0.3, 0.15, ±0.15); BLACK string 0.03 × 2.2 × 0.03 centred at height 1.85 (spans 0.75..2.95). |

Placements:

| Kind | Positions (X, Y, Z) or (X, Z) with Y = 0 |
|---|---|
| Piñatas | (−20, 1.3, 22), (13, 1.3, 22), (−24, 1.3, −12), (26, 1.3, −8) — hanging over stalls; (0, 6.4, 8), (−9, 9.5, 12), (9, 9.5, 12) — hanging in the air over the plaza |
| Crates | (−17.5, 24.5), (−9.5, 24.5), (16.5, 24.5), (23.5, 24.5), (−27.5, −9), (−27.5, −15), (29, −5), (29, −11) |
| Pots | (−33, −14), (−33, −12.6), (−33, −6), (−33, 10), (−33, 20), (33, −12), (33, −3), (33, 6), (33, 22), (−6, 30), (6, 30), (−18, 31), (18, 31), (−3, −33), (3, −33). Each is **big with probability 0.3**, decided at build time. |
| Barrels | (−18, −30), (18, −30), (−30, 30), (30, 30) |
| Cacti (X, Z, h) | (−46, −40, 2.8), (−50, −28, 2.2), (−48, 30, 3.0), (−44, 44, 2.4), (46, −44, 2.6), (50, −30, 2.2), (48, 34, 3.2), (44, 46, 2.5), (−30, −48, 2.8), (30, −48, 2.4), (−28, 48, 2.6), (28, 50, 2.9), (12, −44, 2.2), (−12, −44, 2.6) |

Breakable ids are assigned in creation order: piñatas 0–6, crates 7–14, pots 15–29, barrels 30–33,
cacti 34–47 (48 breakables in total). Ids must match between host and clients because breaks are
sent by id (section 9).

### 7.8 The taco cart

| Part | Details |
|---|---|
| Base | Box (24, 0, 4), 3.2 × 1.3 × 1.6, ORANGE, collides. |
| Counter | Box (24, 1.3, 4), 3.4 × 0.9 × 1.8, BLUE, collides (top 2.2). |
| Posts | No-collide BLACK boxes 0.14 × 3.6 × 0.14 at (22.5, 0, 4) and (25.5, 0, 4). |
| Canopy | 4 visual strips 3.6 × 0.06 × 0.55, centred at height 3.62 (spanning 3.59..3.65) and at z = 3 + 0.55 i (i = 0..3), ORANGE for even i, GREEN for odd. No collider. |
| Wheels | Two visual BLACK cylinders radius 0.34, thickness 0.14, axle along X, at (23.1, 0.34, 3.1) and (24.9, 0.34, 3.1). |
| Sign | Visual taco: ORANGE half-cylinder radius 0.7 length 0.35 (shell) at (24, 4.6, 4); GREEN box 1.3 × 0.14 × 0.3 at (24, 4.62, 4); BLACK box 1.1 × 0.1 × 0.2 at (24, 4.76, 4). |
| Pickup locations | (22, 0, 6.5), (26, 0, 6.5), (24, 0, 1.5). |

### 7.9 Rocks, low walls, well

**Rocks** (X, Z, r): visual BLUE sphere of radius r centred at height 0.55 r; collider box (X, 0, Z)
of 1.5 r × 1.2 r × 1.5 r.

| X | Z | r | Collider |
|---|---|---|---|
| −52 | −46 | 2.2 | 3.3 × 2.64 × 3.3 |
| 52 | 48 | 2.6 | 3.9 × 3.12 × 3.9 |
| −52 | 48 | 1.8 | 2.7 × 2.16 × 2.7 |
| 52 | −48 | 2.0 | 3.0 × 2.4 × 3.0 |
| 0 | −52 | 1.6 | 2.4 × 1.92 × 2.4 |
| 0 | 52 | 1.6 | 2.4 × 1.92 × 2.4 |

**Low walls** (ORANGE, collide): (−12, 0, −12) 8 × 1.1 × 0.5; (12, 0, −12) 8 × 1.1 × 0.5;
(−30, 0, 34) 0.5 × 1.1 × 8; (30, 0, 34) 0.5 × 1.1 × 8.

**Well**: cylinder centre (−14, 8), bottom 0, radius 1.3, height 1.0 (collider 2.08 × 1.0 × 2.08);
no-collide BLACK post 0.15 × 2.0 × 0.15 with bottom at 1 and crossbar 2.2 × 0.3 × 0.3 with bottom at
3, both at (−14, 8).

### 7.10 Mexico markers

| List | Points |
|---|---|
| Enemy spawns (16) | see 7.1 |
| Sniper perches (6) | (−10, 30.6, 46) belfry cap; (10, 15, 46) dome tower top; (−40, 7.5, 14) house W3 roof; (40, 7, −18) house E1 roof; (0, 5.9, −26) bandstand roof; (0, 13.45, 0) sombrero brim |
| Pickup locations (13) | In list order: the three taco-cart points (22, 0, 6.5), (26, 0, 6.5), (24, 0, 1.5), then (0, 1.25, 8), (−20, 0, 0), (20, 0, −14), (0, 0, −36), (−40, 6, −20), (40, 5.5, 0), (0, 11, 44), (0, 13.5, 0), (−24, 0, 24), (24, 0, 24). (Order never matters: pickups are drawn at random from the list.) |
| Arena spawns (13) | (−40, 6.2, −20), (40, 7.2, −18), (−40, 7.7, 14), (40, 6.7, 16), (0, 11.2, 44), (0, 5.6, −26), (−46, 0, 0), (46, 0, 0), (0, 0, −50), (−30, 0, 46), (30, 0, 46), (0, 13.6, 0), (−10, 30.8, 46) |
| Grapple rings (22) | fountain 1, sombrero 7, bandstand 1, bell tower 2, dome tower 1, houses 6, banners 4 |
| Grapple movers | 3 drones |
| Breakables | 48 |

### 7.11 Mexico sky (visual only) and planes

- **Sun**: ORANGE sphere radius 14 at (70, 95, −150) with 12 ORANGE rays, boxes 7 × 0.9 × 0.9
  rotated about Z by i × 30°, centred at (70 + 21 cos a, 95 + 21 sin a, −150).
- **Far mesas** (BLUE, no colliders): for each (X, Z, W, H): a box W × H × 30 with bottom at 0
  centred (X, Z), and a top box 0.6 W × 0.5 H × 22 centred at height 1.25 H.

| X | Z | W | H |
|---|---|---|---|
| −120 | −160 | 60 | 30 |
| 40 | −190 | 90 | 36 |
| 150 | −120 | 70 | 26 |
| −170 | 60 | 50 | 24 |
| 160 | 90 | 80 | 30 |
| −60 | 190 | 100 | 34 |

- **Drones**: 3 planes, base radius 30, base height 26, scale 1.4, radius step 8, height step
  6, speed 0.11 (orbits r 30/38/46, heights 26/32/38, phases 0/2.1/4.2, speeds 0.11/0.12/0.13; cone
  radius 1.68, length 5.6, grab radius 3.08).

---

## 8. Boundaries and kill zones

These rules are applied by the game loop and the player/enemy modules using the level record.

| Rule | Condition | Effect |
|---|---|---|
| Player far outside the field | Each frame while playing: player X < minX − 8 or > maxX + 8, or Z < minZ − 8 or > maxZ + 8, or Y > 150 | Player Y is set to −100 (which triggers the next rule the same frame). |
| Player fell off the map | After the player body moves: Y < −12, or |X| > 95, or |Z| > 95 | Grapple detached; body teleported to the level's **player start**; velocity zeroed; 20 damage (no attacker); on-screen message "OUT OF BOUNDS / respawned at spawn" for 1.8 s. |
| Enemy fell | Enemy body Y < −6 (checked each enemy update) | The enemy is killed with cause "fall"; the kill-feed label reads "FELL OFF THE MAP" (no "airborne" bonus text). |
| Nav grid vertical window | Surfaces below y −5 or above y 70 get no nodes | Enemies never path onto the dome pads above 70 (none exist) or below the ground. |

Notes:

- Downtown solo bounds are ±55, so the "far outside" check trips at ±63; the perimeter wall's outer
  face is at ±58. Arena bounds ±68 trip at ±76; walls end at ±71. Mexico ±62 trips at ±70; the
  ground ends at ±67 and mesas at ±66.
- The physics world's own default bounds (±60 horizontal, −20..80 vertical) are not read by any
  module and have no effect.
- Both maps have a solid ground plane, so the only way below y 0 is to leave the ground's extent
  horizontally (Downtown: beyond ±58/±71; Mexico: beyond ±67).

---

## 9. Interfaces with other subsystems

### 9.1 Build call (main loop → levels)

- Input: the scene to add meshes to, the physics world to add colliders to, a map key (default
  `downtown`), and an options object with the arena flag.
- Before a rebuild the caller removes and disposes every object in the previous level's mesh list,
  empties its animated list and clears the physics world.
- Output: the level record of section 5. The caller then builds a navigation grid over the level
  bounds with cell 1.0, publishes the level and grid on the shared context used by player, enemies
  and effects, and selects the music tune (`mexico` for the Mexico key, `downtown` otherwise).

### 9.2 Physics world (levels → physics)

- "Add box(min corner, max corner, data)" for every collider; data carries no-nav, no-shoot,
  no-grapple (booleans, false when not set) and tag. The returned box handle is kept for
  breakables so it can be removed later ("remove box", which re-finalizes the spatial hash).
- "Finalize" once after all boxes are added (builds the spatial hash, cell size 8).
- The world exposes ray casts (with an ignore predicate), AABB overlap tests, ground probes and
  swept body movement to everyone else; the level only adds boxes.

### 9.3 Navigation grid (physics → nav)

Described in section 4. The grid reads only the collider list and the level bounds.

### 9.4 Player (levels → player)

- Player start: used for the initial body position, solo resets, and the off-the-page reset.
- Grapple targeting, in priority order, all limited to 75 units and to a wall ray that ignores
  no-grapple boxes: (1) an exact hit on an enemy; (2) a **grapple mover** whose centre lies between
  2 units and (wall distance + 1) along the aim line and within lateral distance
  radius + 0.3 + 0.012 × distance — nearest lateral wins; (3) a near-miss enemy; (4) a **ring**
  whose centre lies between 2 and (wall distance + 1.5) along the aim line and within lateral
  distance 0.8 + 0.02 × distance — nearest lateral wins; (5) the wall hit point pushed 0.12 out
  along its normal. A grapple attached to a mover follows the mover's mesh position each frame.
  While attached, the player re-checks line of sight from the eye to the anchor every 0.15 s
  against **all** colliders (see-through railings included) and accumulates "blocked" time; the
  level's rails and pads therefore can cut a swing short. The near-miss enemy test (3) also uses
  an all-colliders line-of-sight check.
- Grenade blasts: the player calls the "blast breakables" hook with the blast centre and radius.

### 9.5 Enemies (levels → enemies, enemies → levels)

- Solo wave spawning picks positions from the level lists: snipers use the sniper perch list; all
  other ground types use the enemy spawn list; flyers ignore the lists and spawn at a random
  bearing 22–32 units from the player, 12–18 above the player's height, clamped to bounds ± 4.
  For non-boss types: candidates are spots 14–48 units from the player (if fewer than 2, any spot
  more than 14 away); among those, spots not visible from the player's eye (line of sight to the
  spot + 1.2 up) are preferred; if nothing qualifies, any spot. Bosses use spots where a 2.2-wide,
  5.1-high box (from 0.1 above the spot) is free, preferring those more than 20 away, then any free
  spot, then up to 200 random probes 22–40 units from the player clamped to ±44 with a ground probe
  from y 30 (accepting a ground above −3), and finally the player start.
- Matches: the spawn pool is the arena spawn list when it is non-empty, otherwise the enemy spawn
  list. Match start deals each lobby member a distinct index from a shuffled pool; a late joiner
  gets the index farthest from every living body; respawns pick randomly among the 3 spots farthest
  from the nearest living remote player.
- The Mexico mariachis are built with the enemies module's humanoid figure builder (options listed
  in 7.3) but are never registered as enemies.
- Enemy bodies: line of sight and vision use the no-shoot ignore rule; falling below y −6 kills.

### 9.6 Pickups (levels → main loop)

- Each solo wave start spawns 7 pickups (5 ammo, then 2 health) at randomly chosen pickup
  locations (duplicates allowed). In matches the host spawns one ammo pickup every 7 s at a random
  pickup location while fewer than 10 pickups exist.
- A pickup is placed 0.6 above its location, bobs ±0.12 with period 2π/2.5 s, spins 1.8 rad/s,
  lives 45 s, and is collected within 1.5 of the player's centre. Ammo: add
  round(0.4 × max reserve) to every gun's reserve, capped at its maximum, and +1 grenade
  (capped at 5). Health: +35 HP; the Mexico health model is a taco and the
  HUD says "TACO · +35 HP" (Downtown: a cross and "+35 HP").

### 9.7 Breakables (levels ↔ main loop, network)

- Hooks the main loop provides on the shared context: **break hit** (prop, damage, point,
  direction) subtracts damage from hit points and breaks the prop at ≤ 0, otherwise shows a small
  burst in the prop's tone (5 strokes, life 0.2 s, size 0.03) and plays the shield-hit sound at the
  point; **breakables in arc** (origin, direction, range, cosine of half-angle) returns living
  props whose centre is within range + 0.5 and inside the cone (or within 0.4 of the origin);
  **blast breakables** (centre, radius) breaks every living prop whose centre is within 0.9 × radius,
  pushing debris away from the centre.
- Who calls them: **bullets** — every fired ray (each shotgun pellet separately) ray-casts the
  world ignoring see-through boxes; if the first box hit carries a breakable back-reference and no
  enemy (or remote player) is hit closer along the ray, the weapon calls break hit with its base
  damage (rifle 24, shotgun 19 per pellet, sniper 150, revolver 62; no head multiplier, no
  fall-off), the tracer ends at that point, and the shot counts as a hit. Because the prop's
  collider is what the ray meets, a prop shields whatever is behind it. **Blade** — each sweep
  calls breakables in arc from the eye along the view direction with range 3.2 and half-angle
  1.0 rad, then break hit for each with the blade damage (direction = the sweep direction) and the
  sweep registers as a hit (hit-stop, shake). **Grenades** — the local player's blast calls blast
  breakables with the blast centre and radius. So pots and piñatas (1 HP) break from any hit;
  crates and barrels (30 HP) need 2 rifle rounds, 2 shotgun pellets, 1 revolver or sniper round;
  cacti (40 HP) need 2 rifle rounds, 3 shotgun pellets, 1 revolver or sniper round.
- Breaking: mark dead, remove the collider from the world, detach every visual part and launch it
  as debris (velocity = direction × rand(2, 6) plus rand(−3, 3) in X and Z and rand(2.5, 6.5) up;
  angular velocity rand(−9, 9) per axis; debris radius 0.14; life rand(6, 9) s), then per kind:
  piñata → three colour bursts (PINK, ORANGE, GREEN), a 2.5-radius PINK explosion effect, and (solo
  or host) two health pickups at the prop centre offset rand(−1.2, 1.2) in X and Z, plus +25 score
  labelled "PIÑATA" in solo; cactus → GREEN blood spray and a 1.1-radius GREEN pool on the ground;
  others → a burst in the prop's tone and smoke. A smash sound plays (a "heavy" variant for barrel,
  crate and cactus).
- Network: a locally caused break broadcasts the prop **id**; receivers break the same id without
  re-broadcasting. A late joiner receives the list of already-broken ids and breaks them silently
  (no effects). A game reset rebuilds the level if any prop is broken.

### 9.8 Animated objects (levels → main loop)

Every frame, after gameplay updates (also while in menus), each entry's update callback is called
with the current game time (which is scaled by hit-stop/focus while playing and runs at real time
otherwise).

### 9.9 Menu and persistence (levels → HUD/main)

The level list drives the map selector (shown only with ≥ 2 maps), the map name shown in lobby
screens (first list entry's name when the key is unknown), the browser-storage key `cs6_map`,
and validation of the host's map key. Which key is built: in an online match the lobby's map (the
host's choice, falling back to the local pick), otherwise the local pick; entering the lobby screen
builds the arena variant, returning to the main menu or starting solo builds the solo variant.

---


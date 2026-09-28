"""
The detail kit every map dresses with (docs/VISUALS.md, R6): crates, pallets,
barrels, bags, rubble, litter and leaves, wall-mounted AC units, vents, pipes,
meter boxes, lamps, ceiling lights, signs and posters, fake doors and windows
for closed walls, fences, traffic cones, benches, planters, pots and bins,
and for the rooms shelving, radiators, switches, conduit, clocks and picture
frames, and the
grapple drone.

Frames (lib.py): +y up; a wall piece's back is its wall (z = 0), its front
+z, its origin at the bottom middle of the back; a floor piece stands on its
origin. Colours are the albedo each part averages to (sRGB); the game
multiplies a placement's tint over them, so the barrel and the door panels
are light, to take any paint.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, lathe, piece, prism, sphere, torus, tube  # noqa: E402

lib.reset()
PLANKS, STEEL, PAINT, METAL = 0x8f6c4d, 0x8e9397, 0xd9d9d4, 0xd6d7d2
DARK = 0x2b2f33


def crate(name, size, small=False):
    piece(name, small=small)
    s = size
    box((s * 0.94, s * 0.94, s * 0.94), (0, s / 2, 0), 'planks', PLANKS, bevel=0.006 * s, segments=1)
    # Framing boards proud of the faces on every edge, and a brace across two sides.
    w, t = 0.085 * s, 0.03 * s
    for x in (-1, 1):
        for z in (-1, 1):
            box((w, s, w), (x * (s - w) / 2, s / 2, z * (s - w) / 2), 'planks', 0x86633f, bevel=0.004, segments=1)
    for y in (w / 2, s - w / 2):
        for z in (-1, 1):
            box((s - 2 * w, w, t), (0, y, z * (s / 2 - t / 2 + 0.004)), 'planks', 0x8a6848, bevel=0.003, segments=1)
        for x in (-1, 1):
            box((t, w, s - 2 * w), (x * (s / 2 - t / 2 + 0.004), y, 0), 'planks', 0x8a6848, bevel=0.003, segments=1)
    diagonal = math.hypot(s - 2 * w, s - 2 * w)
    for z in (-1, 1):
        box((diagonal * 0.98, w * 0.9, t), (0, s / 2, z * (s / 2 - t / 2 + 0.006)), 'planks', 0x937151, bevel=0.003,
            rotation=(0, 0, math.pi / 4 * z), segments=1)


crate('crate', 1.0)
crate('crate-small', 0.6, small=True)

piece('pallet')
# Chamfered deck boards; the blocks and bottom boards, in shade under the deck, are plain boxes.
for i in range(5):
    box((1.2, 0.022, 0.14), (0, 0.133, -0.43 + i * 0.215), 'planks', 0x9b7a55, bevel=0.003, segments=1)
for x in (-0.55, 0, 0.55):
    box((0.1, 0.078, 1.0), (x, 0.083, 0), 'planks', 0x87694a, bevel=0.004, segments=1)
    for z in (-0.44, 0, 0.44):
        box((0.12, 0.078, 0.12), (x, 0.039, z), 'planks', 0x7e6044)
for z in (-0.44, 0, 0.44):
    box((1.2, 0.02, 0.1), (0, 0.01, z), 'planks', 0x8f6c4d)

piece('barrel')
# A 200-litre drum: rolled hoops, a lid with its rim and bungs. Light paint; the placement tints it.
profile = [(0.0, 0.0), (0.27, 0.0), (0.285, 0.012), (0.285, 0.03), (0.28, 0.04)]
for y in (0.29, 0.59):
    profile += [(0.28, y - 0.02), (0.292, y - 0.008), (0.292, y + 0.008), (0.28, y + 0.02)]
profile += [(0.28, 0.85), (0.285, 0.86), (0.285, 0.885), (0.27, 0.89), (0.262, 0.878), (0.0, 0.878)]
lathe(profile, 16, texture_set='painted-metal', colour=0xc9ccc8)
cylinder(0.03, 0.02, (0.13, 0.888, 0.05), 'steel', STEEL, segments=8)
cylinder(0.022, 0.02, (-0.15, 0.888, -0.02), 'steel', STEEL, segments=8)

piece('trash-bags', small=True)
for i, (x, z, r, sq) in enumerate(((-0.22, 0.05, 0.3, 0.8), (0.2, -0.08, 0.27, 0.85), (0.05, 0.22, 0.24, 0.75), (0.34, 0.2, 0.2, 0.7))):
    bag = sphere(r, (x, r * sq * 0.92, z), 'paint', 0x1d2023 if i % 3 else 0x2d3a2a, subdivisions=2, scale=(1, sq, 1.05), name='bag', flat=False)
    lib.add_displace(bag, 0.06, 0.18, seed=i, kind='CLOUDS')
    cylinder(0.035, 0.1, (x, r * sq * 1.8 + 0.02, z), 'paint', 0x1d2023, segments=6, top=0.015)

piece('cardboard', small=True)
for i, (y, turn) in enumerate(((0.0, 0.1), (0.035, -0.25), (0.07, 0.4))):
    box((0.62, 0.03, 0.44), (0.05 * i, y + 0.015, 0.03 * i), 'paint', 0xa47a4e, bevel=0.004, rotation=(0, turn, 0))
box((0.36, 0.3, 0.3), (-0.14, 0.255, -0.05), 'paint', 0xb28a5c, bevel=0.006, rotation=(0, 0.3, 0))

piece('rubble')
rand = lib.rng(7)
mound = sphere(0.72, (0, -0.28, 0), 'concrete', 0x8c8a84, subdivisions=2, scale=(1.05, 0.62, 0.8), name='mound')
lib.add_displace(mound, 0.16, 0.25, seed=3)
for i in range(16):
    size = rand.uniform(0.1, 0.32, 3) * (1, 0.7, 1)
    a = rand.uniform(0, math.tau)
    d = rand.uniform(0.15, 0.75)
    colour = (0x9a978f, 0x85523f, 0x7d7a73)[i % 3]
    box(tuple(size), (math.cos(a) * d, size[1] * 0.4 + max(0.0, 0.2 - d * 0.25), math.sin(a) * d * 0.8),
        'concrete' if colour != 0x85523f else 'brick', colour, bevel=0.012, rotation=tuple(rand.uniform(-0.6, 0.6, 3)), segments=1)

piece('litter', small=True)
rand = lib.rng(11)
for i in range(9):
    colour = (0xe8e4d8, 0xd9c79a, 0xb9b2a3, 0x8a6a45)[i % 4]
    box((rand.uniform(0.12, 0.3), 0.003, rand.uniform(0.15, 0.32)), (rand.uniform(-0.45, 0.45), 0.004 + i * 0.001, rand.uniform(-0.45, 0.45)),
        'paint', colour, rotation=(0, rand.uniform(0, math.tau), 0))
for i in range(3):
    cylinder(0.033, 0.12, (rand.uniform(-0.4, 0.4), 0.033, rand.uniform(-0.4, 0.4)), 'paint', (0xb33a2c, 0x3b6ea8, 0xd0d4d6)[i],
             segments=10, axis='x', rotation=(0, rand.uniform(0, math.tau), 0))

piece('papers', small=True)
# Blown newspaper and flyers, a flattened cup: flat on the ground (under 5 cm), about a metre across.
rand = lib.rng(13)
for i in range(7):
    w, d = rand.uniform(0.22, 0.42), rand.uniform(0.18, 0.3)
    box((w, 0.003, d), (rand.uniform(-0.4, 0.4), 0.003 + i * 0.001, rand.uniform(-0.4, 0.4)), 'paint', (0xdedbd2, 0xcfcac0, 0xe9e4d6, 0xb7c3cc)[i % 4],
        rotation=(rand.uniform(-0.05, 0.05), rand.uniform(0, math.tau), rand.uniform(-0.05, 0.05)))
cylinder(0.04, 0.1, (0.28, 0.04, -0.3), 'paint', 0xd8d3c6, segments=10, axis='x', rotation=(0, 0.8, 0), top=0.028)
box((0.07, 0.01, 0.07), (-0.3, 0.005, 0.32), 'paint', 0xc0392b, rotation=(0, 0.5, 0))

piece('cardboard-flat', small=True)
# Flattened boxes laid on the ground (under 4 cm), a metre across: what is left after a delivery.
rand = lib.rng(19)
for i in range(3):
    box((rand.uniform(0.6, 0.85), 0.008, rand.uniform(0.45, 0.62)), (rand.uniform(-0.2, 0.2), 0.005 + i * 0.01, rand.uniform(-0.15, 0.15)), 'paint',
        (0xa47a4e, 0xb28a5c, 0x9a7048)[i], bevel=0.002, rotation=(0, rand.uniform(-0.6, 0.6), 0))
    box((0.5, 0.009, 0.05), (rand.uniform(-0.1, 0.1), 0.012 + i * 0.01, rand.uniform(-0.1, 0.1)), 'paint', 0xc9b48a, rotation=(0, rand.uniform(0, math.tau), 0))

piece('ac-wall')
# A split unit's outdoor half on two brackets, its fan behind a round grille.
box((0.84, 0.58, 0.3), (0, 0.33, 0.19), 'painted-metal', METAL, bevel=0.018, segments=2)
torus(0.19, 0.022, (-0.12, 0.33, 0.342), 'steel', 0x505559, segments=16, sides=4, axis='z')
cylinder(0.19, 0.01, (-0.12, 0.33, 0.336), 'steel', 0x2c3034, segments=16, axis='z')
for k in range(4):
    box((0.34, 0.012, 0.012), (-0.12, 0.33, 0.346), 'steel', 0x3f4448, rotation=(0, 0, k * math.pi / 4))
for i in range(9):
    box((0.2, 0.012, 0.02), (0.25, 0.14 + i * 0.045, 0.345), 'painted-metal', 0xbfc1bb)
for x in (-0.3, 0.3):
    box((0.04, 0.04, 0.4), (x, 0.02, 0.2), 'steel', 0x6d7276, bevel=0.004)
    box((0.04, 0.3, 0.04), (x, 0.17, 0.02), 'steel', 0x6d7276, bevel=0.004)
tube([(0.36, 0.2, 0.2), (0.46, 0.2, 0.2), (0.46, 0.2, 0.03)], 0.012, 'steel', 0xa9a39a, segments=6)
tube([(0.36, 0.26, 0.2), (0.5, 0.26, 0.2), (0.5, 0.26, 0.03)], 0.009, 'steel', 0xa9a39a, segments=6)

piece('ac-roof')
box((1.1, 0.82, 1.1), (0, 0.49, 0), 'painted-metal', 0xc8cac4, bevel=0.02, segments=2)
torus(0.4, 0.03, (0, 0.905, 0), 'steel', 0x4a4f53, segments=16, sides=4)
cylinder(0.4, 0.01, (0, 0.9, 0), 'steel', 0x25292c, segments=16)
for k in range(3):
    box((0.8, 0.014, 0.014), (0, 0.912, 0), 'steel', 0x3f4448, rotation=(0, k * math.pi / 3, 0))
for side in range(4):
    a = side * math.pi / 2
    for i in range(6):
        box((0.9, 0.03, 0.02), (math.sin(a) * 0.556, 0.2 + i * 0.1, math.cos(a) * 0.556), 'steel', 0x7a7f82, rotation=(0, a, 0))
for x in (-0.45, 0.45):
    box((0.1, 0.08, 1.2), (x, 0.04, 0), 'steel', 0x5a5f63, bevel=0.005)

piece('vent-roof', small=True)
lathe([(0.0, 0.0), (0.11, 0.0), (0.11, 0.42), (0.26, 0.46), (0.28, 0.5), (0.2, 0.6), (0.0, 0.62)], 12, texture_set='steel', colour=0x9a9fa2)
cylinder(0.17, 0.05, (0, 0.025, 0), 'steel', 0x7c8185, segments=12)

piece('vent-wall', small=True)
box((0.6, 0.42, 0.03), (0, 0.21, 0.015), 'steel', 0x8e9397, bevel=0.006)
for i in range(7):
    box((0.52, 0.018, 0.035), (0, 0.05 + i * 0.053, 0.035), 'steel', 0x6d7276, rotation=(-0.6, 0, 0))

piece('downpipe')
# One metre of drainpipe (the placement scales it to the wall), with its bracket.
cylinder(0.05, 1.0, (0, 0.5, 0.065), 'painted-metal', 0xa9adab, segments=10)
box((0.13, 0.03, 0.08), (0, 0.5, 0.04), 'painted-metal', 0x8e9290, bevel=0.004)

piece('gutter')
# One metre of half-round gutter along x (the placement scales it), its back on the wall.
gutter = [(-0.075, 0.0), (0.075, 0.0), (0.075, -0.05), (0.05, -0.085), (0.0, -0.1), (-0.05, -0.085), (-0.075, -0.05)]
prism([(z, y) for z, y in gutter], 1.0, (0, 0, 0.085), 'painted-metal', 0x76797b, rotation=(0, math.pi / 2, 0))

piece('meter-box', small=True)
box((0.4, 0.5, 0.1), (0, 0.25, 0.05), 'painted-metal', 0xb9bdb4, bevel=0.012)
box((0.16, 0.12, 0.01), (0, 0.34, 0.104), 'paint', 0x2c3438)
box((0.36, 0.006, 0.01), (0, 0.18, 0.103), 'painted-metal', 0x6a6e66)
cylinder(0.025, 0.8, (0.1, -0.4, 0.04), 'painted-metal', 0x7d807a, segments=8)

piece('lamp-wall', small=True)
box((0.12, 0.18, 0.03), (0, 0.09, 0.015), 'steel', 0x3d4145, bevel=0.005)
tube([(0, 0.1, 0.03), (0, 0.16, 0.2), (0, 0.13, 0.33)], 0.018, 'steel', 0x3d4145, segments=6)
lathe([(0.0, 0.1), (0.07, 0.1), (0.14, 0.02), (0.15, 0.0), (0.0, 0.0)], 14, (0, 0.03, 0.33), 'steel', 0x2f3337, flat=False)
sphere(0.05, (0, 0.06, 0.33), 'paint', 0xf0e6cc, subdivisions=1)

piece('sign')
# A board of 1 x 1 m (the placement scales it) whose front shows a signs cell, on two stand-offs.
box((1.0, 1.0, 0.05), (0, 0.5, 0.05), 'painted-metal', 0x3a3f44, sign=True)
for x in (-0.35, 0.35):
    box((0.04, 0.04, 0.025), (x, 0.5, 0.0125), 'steel', 0x5a5f63)

piece('poster')
box((1.0, 1.0, 0.004), (0, 0.5, 0.002), 'paint', 0xe2ddd0, sign=True)

piece('window')
# A closed wall's window: frame, cross, dark glass a little behind the frame, and a concrete sill. The maps hang
# hundreds (the Downtown perimeter, 12-24 m up), so it is plain boxes: a few millimetres of chamfer never shows.
W, H, D = 1.2, 1.5, 0.07
box((W + 0.16, 0.06, 0.11), (0, 0.03, 0.055), 'concrete', 0xb3b0a7)
for x in (-1, 1):
    box((0.07, H, D), (x * (W - 0.07) / 2, 0.06 + H / 2, D / 2), 'painted-metal', 0xe4e2da)
for y in (0.06 + 0.035, 0.06 + H - 0.035):
    box((W, 0.07, D), (0, y, D / 2), 'painted-metal', 0xe4e2da)
box((0.045, H - 0.14, 0.05), (0, 0.06 + H / 2, 0.03), 'painted-metal', 0xe4e2da)
box((W - 0.14, 0.045, 0.05), (0, 0.06 + H * 0.6, 0.03), 'painted-metal', 0xe4e2da)
box((W - 0.1, H - 0.1, 0.01), (0, 0.06 + H / 2, 0.012), 'glass', 0x2a3237)


def door(name, frame_set, frame, panel_set, panel):
    piece(name)
    W, H = 1.0, 2.1
    for x in (-1, 1):
        box((0.09, H + 0.09, 0.07), (x * (W + 0.09) / 2, (H + 0.09) / 2, 0.035), frame_set, frame, bevel=0.008, segments=1)
    box((W + 0.18, 0.09, 0.07), (0, H + 0.045, 0.035), frame_set, frame, bevel=0.008, segments=1)
    box((W, H, 0.035), (0, H / 2, 0.02), panel_set, panel, bevel=0.006, segments=1)
    for y, h in ((0.25, 0.7), (1.15, 0.8)):
        box((W - 0.26, h, 0.02), (0, y + h / 2, 0.045), panel_set, panel, bevel=0.012, segments=1)
    box((0.03, 0.03, 0.06), (W / 2 - 0.12, 1.02, 0.07), 'steel', 0x9a9a92, bevel=0.004, segments=1)
    box((0.14, 0.022, 0.022), (W / 2 - 0.16, 1.02, 0.095), 'steel', 0xa8a8a0, bevel=0.004, segments=1)
    box((W, 0.18, 0.006), (0, 0.09, 0.041), 'steel', 0x8e9397)


door('door-metal', 'steel', 0x9a9fa2, 'painted-metal', 0xaeb6bb)
door('door-wood', 'paint', 0xe9e3d3, 'wood', 0x80573a)

piece('fence')
# Two metres of welded steel fence: posts at the ends, three rails, bars every 12 cm.
for x in (-0.97, 0.97):
    box((0.06, 1.85, 0.06), (x, 0.925, 0), 'painted-metal', 0x4a5258, bevel=0.006)
for y in (0.1, 0.95, 1.72):
    box((1.9, 0.04, 0.03), (0, y, 0), 'painted-metal', 0x4a5258, bevel=0.004)
for i in range(15):
    box((0.018, 1.7, 0.018), (-0.84 + i * 0.12, 0.92, 0.0), 'painted-metal', 0x4a5258)

piece('cone', small=True)
lathe([(0.0, 0.52), (0.035, 0.52), (0.13, 0.04), (0.0, 0.04)], 16, texture_set='paint', colour=0xe2601c)
lathe([(0.061, 0.34), (0.098, 0.2), (0.105, 0.17), (0.068, 0.31)], 16, texture_set='paint', colour=0xeeeeea)
box((0.36, 0.04, 0.36), (0, 0.02, 0), 'paint', 0x2a2d30, bevel=0.01)

piece('pipe-h')
# A metre of horizontal pipe along x (scaled by the placement) on two clamps, its back on the wall or ceiling.
cylinder(0.06, 1.0, (0, 0, 0.09), 'painted-metal', 0x8b8f86, segments=10, axis='x')
for x in (-0.3, 0.3):
    box((0.05, 0.14, 0.09), (x, 0, 0.045), 'steel', 0x5c6165, bevel=0.005)

piece('light-ceiling', small=True)
# A fluorescent fitting on two chains; its origin is the ceiling it hangs from.
box((1.25, 0.08, 0.22), (0, -0.45, 0), 'painted-metal', 0xd8d8d2, bevel=0.01)
box((1.15, 0.02, 0.16), (0, -0.495, 0), 'paint', 0xf2f4f2)
for x in (-0.5, 0.5):
    cylinder(0.006, 0.41, (x, -0.205, 0), 'steel', 0x6d7276, segments=4)

piece('bench')
# A slatted bench, 1.5 m, its back towards -z: it stands against a wall or a hedge.
for i in range(3):
    box((1.5, 0.035, 0.11), (0, 0.45, -0.14 + i * 0.13), 'planks', 0x8a6848, bevel=0.006, segments=1)
for i in range(2):
    box((1.5, 0.11, 0.035), (0, 0.62 + i * 0.16, -0.24), 'planks', 0x8a6848, bevel=0.006, segments=1, rotation=(-0.12, 0, 0))
for x in (-0.66, 0.66):
    box((0.05, 0.45, 0.05), (x, 0.225, 0.12), 'painted-metal', 0x2d3236)
    box((0.05, 0.85, 0.05), (x, 0.425, -0.22), 'painted-metal', 0x2d3236)
    box((0.05, 0.05, 0.42), (x, 0.44, -0.05), 'painted-metal', 0x2d3236)

piece('planter')
box((0.8, 0.4, 0.4), (0, 0.2, 0), 'planks', 0x7c5b3e, bevel=0.015, segments=1)
for i, x in enumerate((-0.25, 0.0, 0.25)):
    leaf = sphere(0.2, (x, 0.48, 0), 'foliage', (0x5d7d44, 0x7a4f7a, 0x5d7d44)[i], subdivisions=1)
    lib.add_displace(leaf, 0.05, 0.1, seed=i)

piece('planter-box')
# A cast concrete trough, 1.4 x 0.5 m, with clipped shrubs: for a building's front or a plaza's edge.
box((1.4, 0.46, 0.5), (0, 0.23, 0), 'cast-concrete', 0xa19d95, bevel=0.02, segments=1)
box((1.3, 0.02, 0.4), (0, 0.44, 0), 'paint', 0x3a2c22)
for i, x in enumerate((-0.42, 0.0, 0.42)):
    shrub = sphere(0.26, (x, 0.62, 0), 'foliage', (0x4f6f3c, 0x5d7d44, 0x4a6a37)[i], subdivisions=1, scale=(1.1, 0.8, 0.85))
    lib.add_displace(shrub, 0.06, 0.12, seed=40 + i)

piece('bin-street')
# A round litter bin on a post: a green steel drum with a black liner's rim.
lathe([(0.0, 0.08), (0.22, 0.08), (0.24, 0.78), (0.25, 0.8), (0.0, 0.8)], 14, texture_set='painted-metal', colour=0x3f5a45)
lathe([(0.25, 0.8), (0.26, 0.84), (0.2, 0.84), (0.19, 0.8)], 14, texture_set='paint', colour=0x1d2023)
cylinder(0.04, 0.1, (0, 0.04, 0), 'steel', 0x4a4f53, segments=8)

piece('pot', small=True)
# A terracotta pot with a clump of leaves, 0.5 m across.
lathe([(0.0, 0.0), (0.15, 0.0), (0.24, 0.36), (0.26, 0.38), (0.26, 0.42), (0.21, 0.42), (0.0, 0.4)], 12, texture_set='terracotta', colour=0xb0643e)
for i in range(4):
    a = i * math.tau / 4 + 0.4
    sphere(0.14, (math.cos(a) * 0.09, 0.52, math.sin(a) * 0.09), 'foliage', (0x5a7a3e, 0x4f6f3c)[i % 2], subdivisions=1, scale=(1, 1.3, 1))

piece('leaves', small=True)
# Fallen leaves, flat on the ground (a few millimetres: nothing to trip on), about a metre across.
rand = lib.rng(17)
for i in range(22):
    a, d = rand.uniform(0, math.tau), rand.uniform(0, 0.5)
    box((rand.uniform(0.05, 0.09), 0.003, rand.uniform(0.03, 0.05)), (math.cos(a) * d, 0.003 + i * 0.0006, math.sin(a) * d),
        'paint', (0x8a5a2b, 0xa0702e, 0x6f4a26, 0xb68a3a)[i % 4], rotation=(0, rand.uniform(0, math.tau), 0))

piece('shelf')
# Steel shelving, 1 x 0.45 m and 1.9 m tall, its back on a wall, with boxes and tins on it.
for x in (-0.48, 0.48):
    for z in (0.03, 0.42):
        box((0.035, 1.9, 0.035), (x, 0.95, z), 'painted-metal', 0x59626a)
for y in (0.08, 0.7, 1.3, 1.86):
    box((1.0, 0.025, 0.44), (0, y, 0.225), 'painted-metal', 0x7a838a)
rand = lib.rng(23)
for y in (0.08, 0.7, 1.3):
    x = -0.42
    while x < 0.36:
        w = rand.uniform(0.18, 0.34)
        h = rand.uniform(0.15, 0.4)
        if rand.random() < 0.7:
            box((w * 0.92, h, rand.uniform(0.25, 0.38)), (x + w / 2, y + 0.0125 + h / 2, 0.23), 'paint', (0xa47a4e, 0xb28a5c, 0xd9d5c8, 0x8a6a45)[int(rand.integers(4))])
        else:
            for k in range(3):
                cylinder(0.045, 0.12, (x + 0.06 + k * 0.08, y + 0.07, 0.22), 'painted-metal', (0xb33a2c, 0x3b6ea8, 0xc9b24a)[k], segments=8)
        x += w

piece('radiator', small=True)
# A panel radiator under a window or by a door, 0.8 x 0.55 m, 7 cm off the wall.
for i in range(9):
    box((0.07, 0.55, 0.05), (-0.36 + i * 0.09, 0.4, 0.06), 'painted-metal', 0xe6e4dc, bevel=0.012, segments=1)
box((0.8, 0.04, 0.03), (0, 0.66, 0.05), 'painted-metal', 0xd6d4cc)
for x in (-0.34, 0.34):
    box((0.03, 0.03, 0.05), (x, 0.4, 0.025), 'steel', 0x8e9397)

piece('switch', small=True)
# A light switch or a socket plate, 8 x 8 cm, 1 cm proud of the wall.
box((0.085, 0.085, 0.01), (0, 0.0425, 0.005), 'paint', 0xeceae2, bevel=0.002, segments=1)
box((0.022, 0.035, 0.006), (0, 0.0425, 0.012), 'paint', 0xd8d6ce)

piece('conduit', small=True)
# A metre of electrical conduit up a wall (the placement scales y), on saddles, with a junction box at its top.
cylinder(0.012, 1.0, (0, 0.5, 0.022), 'painted-metal', 0xb9bab4, segments=6)
box((0.1, 0.1, 0.045), (0, 1.0, 0.0225), 'painted-metal', 0xc2c3bc, bevel=0.004, segments=1)
for y in (0.2, 0.6):
    box((0.05, 0.015, 0.028), (0, y, 0.014), 'steel', 0x8e9397)

piece('frame')
# A picture frame, 1 x 1 m (scaled by the placement): a signs cell in a moulded wooden frame.
box((1.0, 1.0, 0.012), (0, 0.5, 0.006), 'paint', 0xe8e2d4, sign=True)
for x in (-1, 1):
    box((0.06, 1.12, 0.035), (x * 0.53, 0.5, 0.0175), 'wood', 0x6b4a32, bevel=0.008)
for y in (-0.03, 1.03):
    box((1.12, 0.06, 0.035), (0, y, 0.0175), 'wood', 0x6b4a32, bevel=0.008)

piece('clock', small=True)
# A wall clock, 0.34 m, its face 4 cm off the wall.
cylinder(0.17, 0.04, (0, 0.17, 0.02), 'paint', 0x2a2d30, segments=20, axis='z')
cylinder(0.15, 0.005, (0, 0.17, 0.042), 'paint', 0xf2efe6, segments=20, axis='z')
box((0.008, 0.1, 0.004), (0, 0.21, 0.046), 'paint', 0x1b1d1f, rotation=(0, 0, 0.5))
box((0.008, 0.07, 0.004), (0, 0.19, 0.047), 'paint', 0x1b1d1f, rotation=(0, 0, -1.9))

piece('drone')
# The grapple drone (level.movers), on realistic tiers, the size of the flat look's cone (4 m long
# before the level's scale): a delta body, four ducted rotors, and under it, at the mover's own
# origin where the rope hooks on, a bright hook ring.
delta = [(0.0, 2.0), (-0.3, 1.6), (-1.02, -1.2), (-0.62, -1.55), (0.62, -1.55), (1.02, -1.2), (0.3, 1.6)]
prism(delta, 0.2, (0, 0.34, 0), 'painted-metal', 0x6f7a82, rotation=(math.pi / 2, 0, 0), bevel=0.03)
prism([(x * 0.62, z * 0.62) for x, z in delta], 0.12, (0, 0.48, -0.05), 'painted-metal', 0x3a434a, rotation=(math.pi / 2, 0, 0), bevel=0.03)
lathe([(0.0, 0.0), (0.3, 0.0), (0.26, 0.12), (0.14, 0.2), (0.0, 0.22)], 16, (0, 0.52, 0.55), 'glass', 0x1f2a30, flat=False)
for x, z in ((-0.95, -0.95), (0.95, -0.95), (-0.62, 0.72), (0.62, 0.72)):
    torus(0.4, 0.09, (x, 0.36, z), 'painted-metal', 0x4b555c, segments=24, sides=6)
    cylinder(0.36, 0.015, (x, 0.38, z), 'steel', 0x1b1f22, segments=20)
    cylinder(0.06, 0.12, (x, 0.38, z), 'steel', 0x8e9397, segments=10)
    box((abs(x) * 0.8, 0.07, 0.1), (x / 2, 0.34, z * 0.9), 'painted-metal', 0x3a434a, bevel=0.01)
for x in (-1, 1):
    box((0.42, 0.03, 0.14), (x * 0.36, 0.45, -1.2), 'painted-metal', 0xe7b34f, rotation=(0, x * 0.5, 0))
box((0.1, 0.06, 0.06), (-1.0, 0.36, -1.25), 'paint', 0xd83a2c)
box((0.1, 0.06, 0.06), (1.0, 0.36, -1.25), 'paint', 0x2fae5a)
cylinder(0.05, 0.28, (0, 0.14, 0), 'steel', 0x8e9397, segments=10)
torus(0.3, 0.08, (0, -0.1, 0), 'painted-metal', 0xe7b34f, segments=24, sides=8)

out, preview = lib.options()
lib.export('common', out, preview)

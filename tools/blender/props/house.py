"""
The House's own kit (docs/VISUALS.md, R6 and V14): the street beyond the
yard's invisible edge (parked cars, wheelie bins, picket fences, hedges, a
mailbox, a barbecue and a garden gnome in clown paint), a mower and a hose
reel for the garden, a full tree for the neighbours' gardens, and the
backdrop past the neighbours (a treeline clump and a distant house, lit by
the sky alone, no shadows).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, lathe, piece, prism, sphere, torus, tube  # noqa: E402

lib.reset()

piece('car')
# A small hatchback, 4.1 m long along z, its paint light so the placement's tint sets the colour.
body = 0xd0d2d0
box((1.72, 0.62, 4.05), (0, 0.62, 0), 'painted-metal', body, bevel=0.12, segments=3)
box((1.5, 0.5, 2.0), (0, 1.16, -0.25), 'painted-metal', body, bevel=0.1, segments=3)
for side in (-1, 1):
    box((0.02, 0.36, 1.7), (side * 0.752, 1.17, -0.25), 'glass', 0x1d252a)
box((1.34, 0.4, 0.02), (0, 1.16, 0.76), 'glass', 0x1d252a, rotation=(-0.5, 0, 0))
box((1.3, 0.36, 0.02), (0, 1.16, -1.26), 'glass', 0x1d252a, rotation=(0.35, 0, 0))
for x in (-0.78, 0.78):
    for z in (-1.3, 1.3):
        cylinder(0.31, 0.2, (x, 0.31, z), 'paint', 0x1b1d1f, segments=16, axis='x')
        cylinder(0.19, 0.21, (x, 0.31, z), 'steel', 0x9ea3a6, segments=12, axis='x')
for x in (-0.6, 0.6):
    box((0.3, 0.12, 0.03), (x, 0.72, 2.03), 'glass', 0xe9e4d2)
    box((0.26, 0.1, 0.03), (x, 0.78, -2.03), 'paint', 0xa8261f)
box((1.74, 0.16, 0.12), (0, 0.36, 2.0), 'paint', 0x2a2d30, bevel=0.04)
box((1.74, 0.16, 0.12), (0, 0.36, -2.0), 'paint', 0x2a2d30, bevel=0.04)

piece('bin')
box((0.58, 0.92, 0.72), (0, 0.49, 0), 'paint', 0x3f6a45, bevel=0.03)
box((0.62, 0.05, 0.78), (0, 0.97, 0.01), 'paint', 0x355c3b, bevel=0.02)
for x in (-0.25, 0.25):
    cylinder(0.09, 0.05, (x, 0.09, -0.33), 'paint', 0x1b1d1f, segments=10, axis='x')
box((0.5, 0.04, 0.05), (0, 0.9, -0.39), 'paint', 0x2a2d30)

piece('picket')
# Two metres of white picket fence: rails and pointed pickets.
for y in (0.28, 0.78):
    box((2.0, 0.07, 0.03), (0, y, -0.02), 'paint', 0xe8e6de, bevel=0.005, segments=1)
for i in range(13):
    x = -0.93 + i * 0.155
    prism([(-0.04, 0.0), (0.04, 0.0), (0.04, 0.95), (0.0, 1.02), (-0.04, 0.95)], 0.02, (x, 0.0, 0.0), 'paint', 0xefede5)

piece('hedge')
hedge = box((2.0, 1.15, 0.8), (0, 0.575, 0), 'foliage', 0x4a6a37, bevel=0.12, segments=2)
lib.add_displace(hedge, 0.12, 0.2, seed=2, subdivide=1)

piece('mailbox')
box((0.08, 1.1, 0.08), (0, 0.55, 0), 'wood', 0x6d5540, bevel=0.01)
box((0.24, 0.24, 0.46), (0, 1.2, 0), 'painted-metal', 0x2f4d7a, bevel=0.04)
box((0.03, 0.14, 0.03), (0.13, 1.28, 0.1), 'paint', 0xc2352b)

piece('bbq')
lathe([(0.0, 0.62), (0.28, 0.66), (0.3, 0.75), (0.28, 0.84), (0.0, 0.86)], 16, texture_set='painted-metal', colour=0x2a2d30, flat=False)
lathe([(0.29, 0.78), (0.3, 0.84), (0.2, 0.98), (0.0, 1.0)], 16, texture_set='painted-metal', colour=0x2a2d30, flat=False)
for a in range(3):
    t = a * math.tau / 3
    box((0.03, 0.66, 0.03), (math.cos(t) * 0.2, 0.33, math.sin(t) * 0.2), 'steel', 0x5c6165, rotation=(math.sin(t) * 0.2, 0, -math.cos(t) * 0.2))

piece('gnome', small=True)
# A garden gnome in clown paint: red nose, white face, a striped hat.
lathe([(0.0, 0.0), (0.14, 0.0), (0.12, 0.2), (0.08, 0.28), (0.0, 0.3)], 12, texture_set='paint', colour=0x2f58a8, flat=False)
sphere(0.08, (0, 0.36, 0), 'paint', 0xf0e6dc, subdivisions=2, flat=False)
sphere(0.025, (0, 0.36, 0.08), 'paint', 0xd8261e, subdivisions=1)
cylinder(0.085, 0.2, (0, 0.5, 0), 'paint', 0xd8261e, segments=12, top=0.0)
torus(0.08, 0.03, (0, 0.42, 0), 'paint', 0xf2c230, segments=12, sides=6)

piece('mower')
# A push mower parked by the garage: a green deck on four wheels, its grass box behind, the handle folded up.
box((0.5, 0.2, 0.55), (0, 0.2, 0), 'painted-metal', 0x3f7a3a, bevel=0.03, segments=1)
lathe([(0.0, 0.3), (0.12, 0.3), (0.1, 0.38), (0.0, 0.4)], 10, (0, 0, 0.05), 'paint', 0x2a2d30)
for x in (-0.27, 0.27):
    for z in (-0.22, 0.22):
        cylinder(0.09, 0.05, (x, 0.09, z), 'paint', 0x1b1d1f, segments=10, axis='x')
box((0.44, 0.3, 0.32), (0, 0.3, -0.42), 'fabric', 0x2d3a2a, bevel=0.03, segments=1)
for x in (-0.2, 0.2):
    tube([(x, 0.3, -0.25), (x, 0.95, -0.55)], 0.013, 'steel', 0x3d4145, segments=6)
tube([(-0.2, 0.95, -0.55), (0.2, 0.95, -0.55)], 0.015, 'paint', 0x1b1d1f, segments=6)

piece('hose-reel')
# A hose on a wall reel, its back on the wall: a green coil on a steel hub, 0.4 m across, 0.2 m out.
box((0.2, 0.26, 0.02), (0, 0.13, 0.01), 'steel', 0x5c6165)
cylinder(0.05, 0.16, (0, 0.13, 0.1), 'steel', 0x8e9397, segments=10, axis='z')
for k in range(3):
    torus(0.12 + k * 0.035, 0.035, (0, 0.13, 0.06 + k * 0.035), 'paint', 0x3d8a3a, segments=18, sides=5, axis='z')
tube([(0.19, 0.1, 0.12), (0.22, -0.3, 0.1), (0.2, -0.62, 0.08)], 0.016, 'paint', 0x3d8a3a, segments=6)


def tree(name, height, crown, colour, backdrop=False, seed=0):
    piece(name, backdrop=backdrop)
    r = lib.rng(seed)
    trunk = cylinder(0.22 * height / 7, height * 0.55, (0, height * 0.275, 0), 'wood', 0x5c4c3e, segments=7, top=0.14 * height / 7, flat=True)
    for i in range(5):
        a = r.uniform(0, math.tau)
        d = crown * (0.0 if i == 0 else r.uniform(0.35, 0.6))
        size = crown * (0.75 if i == 0 else r.uniform(0.45, 0.6))
        blob = sphere(size, (math.cos(a) * d, height * 0.62 + r.uniform(-0.1, 0.25) * crown, math.sin(a) * d), 'foliage',
                      colour, subdivisions=1 if backdrop else 2, scale=(1, 0.85, 1))
        lib.add_displace(blob, size * 0.22, size * 0.5, seed=seed * 10 + i)
    return trunk


tree('tree', 7.5, 2.6, 0x4f6f3c, seed=3)
tree('tree-far', 11, 4.2, 0x4a6536, backdrop=True, seed=7)

piece('house-far', backdrop=True)
box((10, 6, 8), (0, 3, 0), 'siding', 0xd9d2c3)
prism([(-4.6, 0.0), (4.6, 0.0), (0.0, 3.2)], 11.2, (0, 6, 0), 'shingles', 0x445566, rotation=(0, math.pi / 2, 0))
for x in (-3, 0.2, 3):
    box((1.3, 1.4, 0.1), (x, 4.2, 4.02), 'glass', 0x2a3237)
    box((1.3, 1.4, 0.1), (x, 1.6, 4.02) if x != 0.2 else (x, 1.1, 4.02), 'glass' if x != 0.2 else 'wood', 0x2a3237 if x != 0.2 else 0x6b4a32)
box((1.2, 3.2, 1.2), (3.2, 7.4, -1.5), 'brick', 0x85523f)

out, preview = lib.options()
lib.export('house', out, preview)

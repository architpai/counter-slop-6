"""
Mexico's own kit (docs/VISUALS.md, R6 and V14): adobe details (vigas, the
roof beams' ends through the wall; canales, the roof spouts; a niche with a
candle), strings of dried chillies and tin lanterns for the market's awnings
and the doors, a hanging flower pot, clay jars, grain sacks and crates of
fruit for the stalls' ends, loose stones for the rock stacks' feet and
ledges, and the backdrop: three faceted buttes (a talus apron, a gullied
cliff, a caprock lip and an uneven top; two with a pinnacle beside them),
banded in the sandstone's strata (backdrop pieces: lit by the sky alone,
fogged, no shadows). The perimeter's rock stacks get their faceted shells
from the level itself (level/mexico-dressing.ts), baked with it.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, lathe, mesh_from, piece, prism, sphere, torus  # noqa: E402

lib.reset()

piece('viga')
# A roof beam's end, 0.75 m out of the wall, weathered grey-brown; its origin is where it leaves the wall.
cylinder(0.1, 0.75, (0, 0, 0.375), 'wood', 0x6f5a47, segments=9, axis='z', flat=True)
cylinder(0.085, 0.02, (0, 0, 0.755), 'wood', 0x8a7156, segments=9, axis='z', flat=True)

piece('canal')
# A roof spout: a terracotta trough 0.9 m out of the parapet, tipped a little down.
trough = [(-0.13, 0.0), (0.13, 0.0), (0.13, -0.16), (0.09, -0.2), (-0.09, -0.2), (-0.13, -0.16)]
prism([(x, y) for x, y in trough], 0.9, (0, 0, 0.45), 'terracotta', 0xae6242, rotation=(-0.12, 0, 0))
box((0.2, 0.02, 0.86), (0, -0.02, 0.45), 'terracotta', 0x6a3a26, rotation=(-0.12, 0, 0))

piece('niche', small=True)
# A shallow arched niche frame proud of the wall, its back in shade, a candle in a red glass inside.
arch = [(-0.32, 0.0), (0.32, 0.0), (0.32, 0.62)] + [(0.32 * math.cos(t), 0.62 + 0.32 * math.sin(t)) for t in np.linspace(0, math.pi, 9)[1:-1]] + [(-0.32, 0.62)]
prism(arch, 0.05, (0, 0, 0.025), 'stucco', 0xefe6d4, bevel=0.01)
inner = [(x * 0.78, y * 0.86 + 0.04) for x, y in arch]
prism(inner, 0.02, (0, 0, 0.06), 'paint', 0x5d4a3a)
box((0.5, 0.04, 0.1), (0, 0.06, 0.05), 'stucco', 0xe6dccb, bevel=0.008)
cylinder(0.04, 0.12, (0, 0.14, 0.06), 'glass', 0xa3282a, segments=10)

piece('ristra', small=True)
# A string of dried chillies, 0.9 m, hanging from its origin.
r = lib.rng(5)
for i in range(16):
    y = -0.08 - i * 0.05
    a = i * 2.4
    cylinder(0.026, 0.13, (math.cos(a) * 0.045, y, math.sin(a) * 0.045), 'paint', (0x9e1f16, 0xb52a1a, 0x7d1712)[i % 3], segments=6, top=0.004,
             rotation=(r.uniform(-0.5, 0.5), 0, r.uniform(-0.5, 0.5)))
box((0.012, 0.9, 0.012), (0, -0.45, 0), 'fabric', 0xc9b48a)

piece('lantern', small=True)
# A punched-tin lantern hanging from its origin.
box((0.012, 0.12, 0.012), (0, -0.06, 0), 'steel', 0x5c6165)
lathe([(0.0, -0.12), (0.1, -0.16), (0.02, -0.17)], 8, texture_set='steel', colour=0x8e8a7c, flat=True)
lathe([(0.09, -0.17), (0.11, -0.3), (0.09, -0.42), (0.0, -0.44)], 8, texture_set='glass', colour=0xd9a93a, flat=True)
torus(0.1, 0.012, (0, -0.3, 0), 'steel', 0x8e8a7c, segments=12, sides=4)

piece('hanging-pot', small=True)
# A flower pot on a wall bracket: its origin is where the bracket meets the wall, the pot 0.3 m out.
lathe([(0.0, -0.45), (0.1, -0.45), (0.15, -0.25), (0.16, -0.22), (0.0, -0.22)], 12, (0, 0, 0.3), texture_set='terracotta', colour=0xb4673f)
for i in range(4):
    a = i * math.tau / 4
    sphere(0.1, (math.cos(a) * 0.08, -0.16, 0.3 + math.sin(a) * 0.08), 'foliage', 0x5a7a3e, subdivisions=1)
sphere(0.05, (0.06, -0.1, 0.34), 'foliage', 0xd2396b, subdivisions=1)
box((0.02, 0.02, 0.3), (0, 0.0, 0.15), 'steel', 0x3d4145)
for a in range(3):
    t = a * math.tau / 3
    box((0.006, 0.24, 0.006), (math.cos(t) * 0.07, -0.11, 0.3 + math.sin(t) * 0.07), 'steel', 0x3d4145)

piece('olla')
# A tall clay water jar on its own, 0.6 m across, glazed dark at the neck.
lathe([(0.0, 0.0), (0.16, 0.0), (0.3, 0.22), (0.31, 0.36), (0.22, 0.6), (0.13, 0.7), (0.15, 0.76), (0.12, 0.78), (0.0, 0.74)], 14,
      texture_set='terracotta', colour=0xb4683f)
lathe([(0.135, 0.69), (0.155, 0.76), (0.125, 0.785)], 14, texture_set='paint', colour=0x5a3a28)

piece('sacks')
# Grain sacks, two down and one on top, about 1 x 0.6 m: burlap in the sun.
for i, (x, y, z, turn) in enumerate(((-0.25, 0.17, 0.0, 0.1), (0.27, 0.17, 0.03, -0.15), (0.0, 0.47, 0.0, 0.3))):
    sack = sphere(0.3, (x, y, z), 'fabric', (0xc2a878, 0xb09868, 0xc8b080)[i], subdivisions=2, scale=(1.25, 0.58, 0.85), flat=False)
    lib.add_displace(sack, 0.04, 0.12, seed=50 + i)

piece('produce')
# A crate of fruit for a stall's end: slatted, 0.6 x 0.4 m, heaped with oranges or limes (the placement tints them).
for y in (0.05, 0.15, 0.25):
    for z in (-0.19, 0.19):
        box((0.6, 0.07, 0.02), (0, y, z), 'planks', 0x9b7a55)
    for x in (-0.29, 0.29):
        box((0.02, 0.07, 0.4), (x, y, 0), 'planks', 0x9b7a55)
box((0.58, 0.02, 0.38), (0, 0.01, 0), 'planks', 0x87694a)
rand = lib.rng(61)
for i in range(14):
    sphere(0.055, (rand.uniform(-0.23, 0.23), 0.29 + rand.uniform(0, 0.05), rand.uniform(-0.14, 0.14)), 'paint', 0xe0862a, subdivisions=1)

piece('pebbles', small=True)
# Loose sandstone stones, flat enough to walk over (under 10 cm), about 1.6 m across: a stack's foot and ledges.
rand = lib.rng(71)
for i in range(11):
    size = rand.uniform(0.05, 0.15)
    stone = sphere(size, (rand.uniform(-0.75, 0.75), size * 0.3, rand.uniform(-0.75, 0.75)), 'sandstone', (0xb07d5a, 0xa6714f, 0xc08d62, 0x9c6a4b)[i % 4],
                   subdivisions=1, scale=(rand.uniform(0.9, 1.4), 0.45, rand.uniform(0.8, 1.2)))

STRATA = [0xb07d5a, 0xc08d62, 0xa6714f, 0xc79a70, 0x9c6a4b, 0xb88660]


def strata(seed):
    r = lib.rng(seed)
    offsets = r.uniform(0, 2, 4)

    def shade(p):
        y = p[1] + 0.9 * math.sin(p[0] * 0.07 + offsets[0]) + 0.6 * math.sin(p[2] * 0.09 + offsets[1])
        band = STRATA[int(math.floor(y / 3.3)) % len(STRATA)]
        return lib.srgb(band)
    return shade


def mesa(name, width, depth, height, seed, spire=None):
    """
    A butte: a talus apron curving up from the plain to a cliff, the cliff cut by gullies and bands of softer rock,
    a caprock lip and an uneven top, its height and outline wandering round it (not stacked tiers); displaced and
    decimated to big facets, banded by height. `spire`: a pinnacle beside it, (x, z, radius, height) in widths.
    """
    piece(name, backdrop=True)
    r = lib.rng(seed)
    n = 36
    phase = r.uniform(0, math.tau, 5)
    gullies = r.uniform(0, math.tau, 3)

    def outline(t):
        """The plan's wandering outline, with gullies cut into it."""
        f = 1 + 0.14 * math.sin(2 * t + phase[0]) + 0.09 * math.sin(3 * t + phase[1]) + 0.06 * math.sin(7 * t + phase[2])
        for g in gullies:
            d = math.atan2(math.sin(t - g), math.cos(t - g))
            f -= 0.16 * math.exp(-(d / 0.13) ** 2)
        return f

    def top(t):
        """The rim's height round it: a tilted, uneven top."""
        return height * (1 + 0.11 * math.sin(t + phase[3]) + 0.06 * math.sin(4 * t + phase[4]))

    # (radius share, height share of the rim's) from the sunk foot up the talus, the cliff, the caprock's lip and over
    # the top: the talus concave, the cliff near vertical with a softer band set back, the lip proud of the cliff.
    profile = [(1.34, -0.08), (1.3, 0.0), (1.2, 0.08), (1.09, 0.18), (1.0, 0.3), (0.95, 0.42), (0.93, 0.55), (0.89, 0.64),
               (0.9, 0.74), (0.88, 0.86), (0.905, 0.9), (0.9, 0.955), (0.84, 0.985), (0.62, 1.0), (0.3, 1.02)]
    verts, faces = [], []
    for k, (share, rise) in enumerate(profile):
        for i in range(n):
            t = math.tau * i / n
            f = share * (outline(t) if share > 0.5 else 1 + 0.1 * math.sin(2 * t + phase[0]))
            y = rise * top(t) if rise > 0 else rise * height
            verts.append((math.cos(t) * width / 2 * f, y, math.sin(t) * depth / 2 * f))
    for ring in range(len(profile) - 1):
        for i in range(n):
            j = (i + 1) % n
            a, b = ring * n, (ring + 1) * n
            faces.append((a + i, b + i, b + j, a + j))
    faces.append(tuple(range(len(verts) - n, len(verts))))
    part = mesh_from(verts, faces, 'sandstone', 0xb07d5a, name=name, shade=strata(seed))
    lib.add_displace(part, width * 0.045, width * 0.12, seed=seed, subdivide=2)
    lib.add_decimate(part, 0.16)
    if spire:
        sx, sz, radius, tall = spire
        # Its own talus cone, a waisted column of softer rock and a caprock block on top.
        rings = [(2.3, -2.0), (2.1, 0.0), (1.5, 0.14 * tall), (1.08, 0.32 * tall), (0.86, 0.55 * tall), (0.8, 0.72 * tall),
                 (0.92, 0.8 * tall), (1.1, 0.86 * tall), (1.06, 0.95 * tall), (0.6, tall)]
        m = 12
        verts, faces = [], []
        for share, y in rings:
            for i in range(m):
                t = math.tau * i / m
                f = share * (1 + 0.16 * math.sin(3 * t + seed) + 0.08 * math.sin(5 * t + 2 * seed))
                verts.append((sx * width + math.cos(t) * radius * width * f, y, sz * depth + math.sin(t) * radius * width * f))
        for ring in range(len(rings) - 1):
            for i in range(m):
                j = (i + 1) % m
                faces.append((ring * m + i, (ring + 1) * m + i, (ring + 1) * m + j, ring * m + j))
        faces.append(tuple(range(len(verts) - m, len(verts))))
        pinnacle = mesh_from(verts, faces, 'sandstone', 0xb07d5a, name=f'{name}-spire', shade=strata(seed + 7))
        lib.add_displace(pinnacle, radius * width * 0.18, radius * width * 0.5, seed=seed + 7, subdivide=1)
        lib.add_decimate(pinnacle, 0.35)
    return part


# Width, depth and the rim's mean height, as level/mexico-dressing.ts places them.
mesa('mesa-a', 70, 34, 30, 1, spire=(0.64, 0.1, 0.07, 27))
mesa('mesa-b', 96, 40, 28, 2)
mesa('mesa-c', 54, 30, 32, 3, spire=(-0.7, -0.2, 0.08, 22))

out, preview = lib.options()
lib.export('mexico', out, preview)

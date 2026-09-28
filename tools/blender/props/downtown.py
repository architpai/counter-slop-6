"""
Downtown's own kit (docs/VISUALS.md, R6 and V14): shop awnings, a roof
antenna and a water tank for the perimeter's top, and the skyline: five distant office
and apartment blocks with bands of windows, which the map rings beyond its
perimeter wall (backdrop pieces: lit by the sky alone, fogged, no shadows).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import box, cylinder, lathe, piece, tube  # noqa: E402

lib.reset()

piece('awning')
# A shop awning, 1 m wide (the placement scales x), its canvas off-white for the placement's tint: its canvas slopes from the wall (origin, its top) 0.95 m out
# and 0.55 m down, with a valance, on two arms and two struts back to the wall.
slope = math.atan2(0.55, 0.95)
box((1.0, 0.02, 1.1), (0, -0.275, 0.475), 'fabric', 0xe6e2da, rotation=(slope, 0, 0))
box((1.02, 0.22, 0.012), (0, -0.66, 0.955), 'fabric', 0xe6e2da)
for x in (-0.49, 0.49):
    tube([(x, -0.02, 0.0), (x, -0.57, 0.95)], 0.014, 'steel', 0x3d4145, segments=6)
    tube([(x, -0.62, 0.0), (x, -0.45, 0.62)], 0.011, 'steel', 0x3d4145, segments=6)

piece('antenna')
cylinder(0.04, 4.0, (0, 2.0, 0), 'steel', 0x7a7f82, segments=8)
for y, w in ((2.6, 1.2), (3.1, 0.9), (3.5, 0.6)):
    box((w, 0.025, 0.025), (0, y, 0), 'steel', 0x6d7276)
box((0.5, 0.06, 0.5), (0, 0.03, 0), 'steel', 0x5c6165)
for a in range(3):
    t = a * math.tau / 3
    tube([(0, 1.6, 0), (math.cos(t) * 1.3, 0.02, math.sin(t) * 1.3)], 0.006, 'steel', 0x5c6165, segments=4)

piece('water-tank')
# A rooftop tank on a steel stand: a wooden barrel with hoops and a conical lid.
for x in (-0.9, 0.9):
    for z in (-0.9, 0.9):
        box((0.12, 2.2, 0.12), (x, 1.1, z), 'steel', 0x4f5458, bevel=0.01)
box((2.2, 0.15, 2.2), (0, 2.25, 0), 'steel', 0x4f5458, bevel=0.01)
profile = [(0.0, 2.3), (1.15, 2.3)] + [(1.15 + 0.03 * (i % 2), 2.3 + i * 0.35) for i in range(1, 9)] + [(1.15, 5.2)]
lathe(profile, 14, texture_set='planks', colour=0x7b6048)
lathe([(1.22, 5.2), (0.0, 6.0)], 14, texture_set='steel', colour=0x55595c, flat=True)
for y in (2.7, 3.6, 4.5):
    lathe([(1.17, y - 0.03), (1.19, y), (1.17, y + 0.03)], 14, texture_set='rust', colour=0x6a4636)


def tower(name, width, depth, floors, colour, band=0x161d23, setback=None, crown=None, seed=0):
    """
    A distant block: a body in its facade colour, a dark window band per floor on every face broken by
    piers into windows, a roof plant room. The colours are mid-tones: under the fog the far ring would
    read chalky and flat in lighter ones, and its bands would vanish.
    """
    piece(name, backdrop=True)
    storey = 3.5

    def body(w, d, base, count, top_pad):
        height = count * storey + top_pad
        box((w, height, d), (0, base + height / 2, 0), 'cast-concrete', colour)
        for i in range(count):
            box((w + 0.12, 1.9, d + 0.12), (0, base + 1.5 + i * storey, 0), 'glass', band)
        # Piers every 3 m or so across each face, proud of the bands, so the bands read as rows of windows.
        for span, across, turn in ((w, d, 0.0), (d, w, math.pi / 2)):
            n = max(2, int(span / 3))
            for k in range(1, n):
                along = -span / 2 + span * k / n
                for side in (-1, 1):
                    x, z = (along, side * (across / 2 + 0.08)) if turn == 0.0 else (side * (across / 2 + 0.08), along)
                    box((0.45 if turn == 0.0 else 0.2, height - 0.6, 0.2 if turn == 0.0 else 0.45), (x, base + height / 2 - 0.1, z), 'cast-concrete', colour)
        return height

    top = body(width, depth, 0.0, floors, 1.2)
    if setback:
        w2, d2, f2 = setback
        top += body(w2, d2, top, f2, 0.8)
    r = lib.rng(seed)
    box((width * 0.3, 2.6, depth * 0.35), (r.uniform(-0.2, 0.2) * width, top + 1.3, r.uniform(-0.2, 0.2) * depth), 'cast-concrete', colour)
    if crown:
        cylinder(0.25, crown, (width * 0.2, top + crown / 2, -depth * 0.2), 'steel', 0x5d6266, segments=6)


tower('skyline-a', 24, 18, 14, 0x7d7a73, seed=1)
tower('skyline-b', 18, 18, 20, 0x676d72, band=0x121a21, setback=(12, 12, 5), crown=8, seed=2)
tower('skyline-c', 30, 16, 9, 0x86705f, band=0x1c1a19, seed=3)
tower('skyline-d', 14, 14, 26, 0x5d6870, band=0x13212c, setback=(9, 9, 4), crown=12, seed=4)
tower('skyline-e', 22, 20, 12, 0x8f877b, band=0x1a1f23, setback=(14, 12, 3), seed=5)

out, preview = lib.options()
lib.export('downtown', out, preview)

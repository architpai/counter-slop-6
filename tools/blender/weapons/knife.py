"""
The combat knife (docs/VISUALS.md, R4): a 16.5 cm clip-point blade lofted
through cross-sections (a flat spine, a fuller, a saber grind to a fine
edge, the dished clip's swedge towards a tip above the blade's middle), a steel guard, a grooved grip with the
player-blue spacer and a pommel, in the right fist; the left hand is a
guard fist below it. The blade runs along +Y from the grip at the origin,
where the flat knife's does, so the blood smears land on it.

Sockets: tip, smears (the flat knife's blade frame on this blade). Clips:
slash and slash-back (0.27 s, the wrist's snap on top of the game's
procedural arc, one per side), and guard (the fist raised into view, played
at the block's blend). No equip clip: the knife only shows while it slashes
or guards.

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/knife.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

import bmesh

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

SLASH = 0.27
# The guard clip runs on the block's blend, not a clock: its length is only a frame count to key on.
GUARD = 0.1
TIP = 0.185
# Where the spine's clip and the edge's belly start, and the tip's height (above the blade's middle, as a clip point's is).
CLIP, BELLY, TIP_Z = 0.118, 0.092, 0.0045


def spine(y):
    """Top of the blade: straight, then the dished clip falling to the tip."""
    if y <= CLIP:
        return 0.012
    t = (y - CLIP) / (TIP - CLIP)
    return 0.012 - (0.012 - TIP_Z) * (1 - (1 - t) ** 1.6)


def edge(y):
    """Cutting edge: straight, then the belly sweeping up to the tip."""
    if y <= BELLY:
        return -0.018
    t = (y - BELLY) / (TIP - BELLY)
    return -0.018 + (0.018 + TIP_Z) * t ** 2.2


def blade():
    """
    Loft of cross-sections from the ricasso to the tip: the edge, the saber
    grind's line, a fuller along the flat (fading out before the clip), and
    the spine's corners, ground thin along the clip (the swedge).
    """
    bm = bmesh.new()
    rings = []
    stations = [0.020 + (TIP - 0.020) * (k / 40) ** 0.85 for k in range(41)]
    for y in stations[:-1]:
        top, bottom = spine(y), edge(y)
        taper = min(1.0, (TIP - y) / 0.05)
        half = 0.0024 * (0.35 + 0.65 * taper)
        grind = bottom + 0.45 * (top - bottom)
        top_half = half * (0.92 if y <= CLIP else 0.92 - 0.6 * (y - CLIP) / (TIP - CLIP))
        # The fuller: a shallow groove between the grind line and the spine, in from the ricasso, out before the clip.
        depth = min(1.0, max(0.0, (y - 0.030) / 0.010)) * min(1.0, max(0.0, (CLIP - 0.012 - y) / 0.018))
        f0, fm, f1 = (grind + k * (top - grind) for k in (0.2, 0.5, 0.8))
        inner = half * (1 - 0.5 * depth)
        right = [(half, grind), (half, f0), (inner, fm), (half, f1), (top_half, top)]
        section = [(0.0, bottom), *right, *[(-x, z) for x, z in reversed(right)]]
        rings.append([bm.verts.new((x, y, z)) for x, z in section])
    tip = bm.verts.new((0.0, TIP, TIP_Z))
    n = len(rings[0])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % n], r0[(k + 1) % n]))
    for k in range(n):
        bm.faces.new((rings[-1][k], tip, rings[-1][(k + 1) % n]))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = lib._object('blade', bm, 'satin')
    lib.smooth(obj, 30)
    return obj


def build():
    w = lib.Weapon('knife', pivot=(0, -0.02, -0.01))
    b = blade()
    w.add(b)
    guard = lib.profile('guard', lib.fillet([(0.010, -0.030), (0.020, -0.028), (0.020, 0.022), (0.010, 0.024)], 0.003), 0.013, finish='dark-steel')
    lib.bevel(guard, 0.0012, 2)
    w.add(guard)
    w.add(lib.lathe('spacer', [(0.004, 0.0), (0.004, 0.0120), (0.010, 0.0120), (0.010, 0.0)], 24, 'Y', (0, 0, -0.004), 'anodized-blue', scale=(0.78, 1.0)))
    grip = [(-0.100, 0.0), (-0.100, 0.0118)]
    for k in range(12):
        y = -0.095 + k * 0.008
        r = 0.0128 + 0.0016 * math.sin(math.pi * (k + 0.5) / 12)
        grip += [(y, r), (y + 0.0055, r), (y + 0.0065, r - 0.0012), (y + 0.0075, r - 0.0012)]
    grip += [(0.004, 0.0118), (0.004, 0.0)]
    w.add(lib.lathe('grip', grip, 24, 'Y', (0, 0, -0.004), 'rubber', scale=(0.78, 1.0)))
    pommel = lib.lathe('pommel', [(-0.114, 0.0), (-0.114, 0.0090), (-0.110, 0.0120), (-0.100, 0.0126), (-0.100, 0.0)], 24, 'Y', (0, 0, -0.004), 'dark-steel', scale=(0.8, 1.0))
    lib.bevel(pommel, 0.0008, 2)
    w.add(pommel)
    fist = {
        'index': {'curl': (1.35, 1.6, 0.9)}, 'middle': {'curl': (1.4, 1.65, 0.95)},
        'ring': {'curl': (1.45, 1.65, 0.95)}, 'pinky': {'curl': (1.5, 1.6, 0.95)},
        'thumb': [(-0.9, 0.0, -0.35), (-0.7, 0, 0), (-0.5, 0, 0)],
    }
    # Hammer grip, blade forward: the fist round the handle, index at the guard, the wrist cocked so the blade points ahead.
    hands.hand(w, 'right-hand', fist, wrist=(0.044, -0.012, -0.040), fingers=(-0.62, 0.0, 0.78), back=(0.60, 0.25, 0.75), forearm=(0.40, -0.70, -0.60))
    hands.hand(w, 'left-hand', fist, wrist=(-0.150, -0.100, -0.160), fingers=(0.5, 0.6, 0.6), back=(-0.6, 0.0, 0.8), forearm=(-0.45, -0.70, -0.55), side='L')
    w.socket('tip', (0, TIP, spine(TIP)))
    smears = w.socket('smears', (0, 0.0, -0.003))
    # The flat knife's blade is 1.6 cm tall and 5.5 mm thick; this one is taller and thinner.
    smears.scale = (0.85, 1.0, 1.6)
    for name, side in (('slash', 1), ('slash-back', -1)):
        c = lib.Clip(w, name, SLASH)
        c.at('pivot', 0.0, rot=(0.25, side * 0.15, side * 0.30)).at('pivot', 0.45, rot=(-0.12, -side * 0.10, -side * 0.22)).at('pivot', 1.0)
    # The guard: the game blends the knife to its guard pose and plays this at the blend's share, so at
    # full guard the fist and grip rise into the lower right with the blade tipped forward.
    c = lib.Clip(w, 'guard', GUARD)
    c.at('pivot', 1.0, loc=(-0.06, 0.14, -0.06), rot=(-0.6, -0.3, 0.3))
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'knife', (('slash', (0.0, 0.45)),), rest=(0.20, -0.18, -0.28), rot=(0.35, 0.10, -0.45))
    if opts['bake']:
        lib.finish([w], opts, 'knife')


if __name__ == '__main__':
    main()

"""
The tactical sword (docs/VISUALS.md, R4): a single-edged blade with a
katana's proportions and a modern finish, lofted through cross-sections (a
convex grind from a bright honed edge, its line waving like a hamon, up to a
ridge line; a blackened flat with a shallow groove; a peaked spine), with a
slight curve, a distal taper and a curved point. A blackened collar, a
compact dark-steel guard with two cut-outs, the player-blue spacer, a
cord-wrapped two-hand grip (the cords crossing over a rubber core, diamond
windows on the flats) and a pommel cap. The right fist grips under the
guard, the left near the pommel. The blade runs along +Y from the grip at the
origin, as the knife's did.

Sockets: tip (the point), smears (the blade's centre line at its root, past
the collar; the game scales the blood smears). Clips: slash and slash-back
(0.32 s, the wrists' snap on top of the game's procedural arc, one per side),
guard (played at the block's blend: the sword raised across the body as a
parry) and equip (0.3 s, the draw).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/sword.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

SLASH = 0.32
DRAW = 0.3
# The guard clip runs on the block's blend, not a clock: its length is only a frame count to key on.
GUARD = 0.1

# Along +Y: the pommel cap, the wrapped grip, the collar at its top, the blue spacer, the guard, the blade's collar, the blade.
POMMEL = -0.240
GRIP = (-0.226, 0.002)
FUCHI = (-0.002, 0.012)
SPACER = (0.012, 0.019)
TSUBA = (0.019, 0.028)
HABAKI = (0.028, 0.050)
# The blade from inside the collar to the point: 0.68 m from the guard's face.
ROOT, LENGTH = 0.026, 0.682
TIP_Y = ROOT + LENGTH
# Height edge to spine at the root and at the point's line (the distal taper), the point's length, the curve's rise at the tip.
HEIGHT, HEIGHT_END, POINT, SORI = 0.031, 0.026, 0.070, 0.016
# Thickness at the root and where the point starts.
THICK, THICK_END = 0.0072, 0.0048
# The grip's core (half-widths across X and Z), the cords' height and the wrap's pitch.
CORE_X, CORE_Z, CORD, PITCH = 0.0116, 0.0142, 0.0017, 0.046

# The hip pose the game should use (models.ts REAL_REST.sword) and the game's guard pose for the root
# (weapons/sword.ts GUARD_POS, GUARD_ROT); the guard clip turns the sword from there to `GUARD_AT`.
REST = ((0.24, -0.15, -0.38), (0.70, 0.05, -0.95))
GUARD_ROOT = ((0.10, -0.16, -0.46), (0.22, 1.42, 1.57))
# At full guard, in camera space (three: +X right, +Y up, -Z ahead): the grip's origin, the blade's direction
# (across the body, up to the left, a little ahead) and the spine's (up and back towards the eye, so the edge faces out).
GUARD_AT = ((0.12, -0.19, -0.42), (-0.88, 0.40, -0.25), (0.0, 1.0, 0.7))

# The sword's own finishes: a blackened flat (a dark coating over steel, bright where it wears through), a bright honed edge, a paracord wrap.
lib.FINISHES.setdefault('blackened', dict(base=0x313337, rough=0.42, metal=0.3, worn=0x8e9297, worn_rough=0.24, worn_metal=1.0, wear=0.3, grime=0.45, pattern='brushed', bump=0.000004))
lib.FINISHES.setdefault('honed', dict(base=0xc6cacf, rough=0.20, metal=1.0, worn=0xe0e2e5, worn_rough=0.14, worn_metal=1.0, wear=0.25, grime=0.25, pattern='brushed', bump=0.000004))
lib.FINISHES.setdefault('cord', dict(base=0x3a3c3f, rough=0.9, metal=0.0, worn=0x4d5054, worn_rough=0.85, worn_metal=0.0, wear=0.25, grime=0.55, pattern='weave', bump=0.00014))


def centre(y):
    """The blade's curve: its centre line rises towards the tip, level at the root."""
    t = max(0.0, (y - ROOT) / LENGTH)
    return SORI * t * t


def outline(y):
    """(bottom, top, thickness) of the blade at `y`: the edge's line, the spine's, and its thickness, tapering to the point."""
    s = y - ROOT
    body = LENGTH - POINT
    z = centre(y)
    if s <= body:
        f = s / body
        h = HEIGHT + (HEIGHT_END - HEIGHT) * f
        return z - h / 2, z + h / 2, THICK + (THICK_END - THICK) * f
    u = (s - body) / POINT
    # The spine drops a little to the point; the edge sweeps up to it in a convex curve.
    drop = 0.005
    top = z + HEIGHT_END / 2 - drop * u * u
    bottom = z - HEIGHT_END / 2 + (HEIGHT_END - drop) * u ** 2.4
    return bottom, top, THICK_END * (1 - 0.8 * u ** 1.4)


def hamon(y):
    """The honed bevel's line, as a share of the height from the edge: waving like a hamon."""
    s = y - ROOT
    return 0.26 + 0.035 * math.sin(math.tau * s / 0.056) + 0.012 * math.sin(math.tau * s / 0.023 + 1.7)


def blade():
    """
    Loft of cross-sections from inside the collar to the point: the edge,
    the honed bevel's line (bright below it), the ridge line at 70 % of the
    height, a groove in the blackened flat above it, the spine's shoulders
    and its peak.
    """
    bm = bmesh.new()
    body = ROOT + LENGTH - POINT
    stations = [ROOT + (body - ROOT) * k / 170 for k in range(170)]
    stations += [body + POINT * (1 - (1 - k / 22) ** 1.3) for k in range(22)]
    rings = []
    for y in stations:
        bottom, top, thick = outline(y)
        h, half = top - bottom, thick / 2
        f = hamon(y)
        # A convex grind: the honed bevel a little fuller than the line from the edge to the ridge.
        honed = (min(1.0, 1.12 * f / 0.70) * half, bottom + f * h)
        ridge = (half, bottom + 0.70 * h)
        base = lambda a: half * (1 - 0.28 * (a - 0.70) / 0.25)
        # The groove: in from the collar, out before the point.
        s = y - ROOT
        depth = min(1.0, max(0.0, (s - 0.040) / 0.025)) * min(1.0, max(0.0, (0.46 - s) / 0.05))
        groove = [(base(a) * (1 - k * depth), bottom + a * h) for a, k in ((0.745, 0.03), (0.81, 0.40), (0.875, 0.10))]
        shoulder = (base(0.95), bottom + 0.95 * h)
        right = [honed, ridge, *groove, shoulder]
        section = [(0.0, bottom), *right, (0.0, top), *[(-x, z) for x, z in reversed(right)]]
        rings.append([bm.verts.new((x, y, z)) for x, z in section])
    bottom, top, _ = outline(TIP_Y)
    tip = bm.verts.new((0.0, TIP_Y, top))
    n = len(rings[0])
    # Faces by the ring's index: the first and last run from the edge to the honed line, bright; the rest blackened.
    honed_faces = {0, n - 1}
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(n):
            f = bm.faces.new((r0[k], r1[k], r1[(k + 1) % n], r0[(k + 1) % n]))
            f.material_index = 1 if k in honed_faces else 0
    for k in range(n):
        f = bm.faces.new((rings[-1][k], tip, rings[-1][(k + 1) % n]))
        f.material_index = 1 if k in honed_faces else 0
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = lib._object('blade', bm)
    obj.data.materials.append(lib.material('blackened'))
    obj.data.materials.append(lib.material('honed'))
    lib.smooth(obj, 14)
    return obj


def cord_height(theta, y):
    """
    The wrap's relief over the core at angle `theta` (0 = +X, pi / 2 = up)
    and `y`: two helices of flat cord crossing on the top and the bottom,
    leaving diamond windows on the flats; the cord on top at a crossing sits
    a little higher.
    """
    u = (y - GRIP[0]) / PITCH
    phi = (theta - math.pi / 2) / math.tau
    width = 0.15

    def one(v):
        d = abs(v - round(v))
        if d >= width:
            return 0.0
        return (1 - (d / width) ** 2) ** 0.35

    a, b = one(u + phi), one(u - phi)
    return CORD * min(1.0, max(a, b) + 0.3 * min(a, b))


def grip():
    """The wrapped grip: an oval core, a little waisted, with the cord's relief; faces under the cord wear it, the rest the core's rubber."""
    bm = bmesh.new()
    segments = 32
    y0, y1 = GRIP
    rows = 112
    rings, heights = [], []
    for j in range(rows + 1):
        y = y0 + (y1 - y0) * j / rows
        t = (y - y0) / (y1 - y0)
        # Wrap thins out to bare core at both ends, under the collar and the pommel cap.
        fade = min(1.0, t / 0.03, (1 - t) / 0.03)
        waist = 1 - 0.06 * math.sin(math.pi * t)
        ring, hs = [], []
        for k in range(segments):
            theta = math.tau * k / segments
            h = cord_height(theta, y) * fade
            ring.append(bm.verts.new((math.cos(theta) * (CORE_X * waist + h), y, math.sin(theta) * (CORE_Z * waist + h))))
            hs.append(h)
        rings.append(ring)
        heights.append(hs)
    for j in range(rows):
        for k in range(segments):
            k1 = (k + 1) % segments
            f = bm.faces.new((rings[j][k], rings[j][k1], rings[j + 1][k1], rings[j + 1][k]))
            mean = (heights[j][k] + heights[j][k1] + heights[j + 1][k] + heights[j + 1][k1]) / 4
            f.material_index = 0 if mean > 0.3 * CORD else 1
    for ring, y in ((rings[0], y0), (rings[-1], y1)):
        c = bm.verts.new((0, y, 0))
        for k in range(segments):
            bm.faces.new((ring[k], ring[(k + 1) % segments], c)).material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = lib._object('grip', bm)
    obj.data.materials.append(lib.material('cord'))
    obj.data.materials.append(lib.material('rubber'))
    lib.smooth(obj, 50)
    return obj


def fittings(w):
    """The pommel cap, the grip's collar, the blue spacer, the guard with its cut-outs and the blade's collar."""
    oval = (CORE_X / CORE_Z, 1.0)
    r = CORE_Z + 0.0012
    pommel = lib.lathe('pommel', [(GRIP[0] + 0.002, 0.0), (GRIP[0] + 0.002, r), (POMMEL + 0.0055, r + 0.0002), (POMMEL + 0.0015, r - 0.0025),
                                  (POMMEL, r - 0.0065), (POMMEL, 0.0)], 32, 'Y', (0, 0, 0), 'dark-steel', scale=oval)
    lib.bevel(pommel, 0.0008, 2)
    w.add(pommel)
    fuchi = lib.lathe('fuchi', [(FUCHI[0], 0.0), (FUCHI[0], r), (FUCHI[1], r + 0.0006), (FUCHI[1], 0.0)], 32, 'Y', (0, 0, 0), 'dark-steel', scale=oval)
    lib.bevel(fuchi, 0.0007, 2)
    w.add(fuchi)
    w.add(lib.lathe('spacer', [(SPACER[0], 0.0), (SPACER[0], r + 0.0022), (SPACER[1], r + 0.0022), (SPACER[1], 0.0)], 32, 'Y', (0, 0, 0), 'anodized-blue', scale=oval))
    # The guard: a compact oval plate, taller than wide, with a kidney-shaped cut-out either side of the blade.
    y0, y1 = TSUBA
    guard = lib.lathe('guard', [(y0, 0.0), (y0, 0.0325), (y0 + 0.0015, 0.0340), (y1 - 0.0015, 0.0340), (y1, 0.0325), (y1, 0.0)], 48, 'Y', (0, 0, 0), 'dark-steel', scale=(0.86, 1.0))
    holes = []
    for side in (-1, 1):
        holes.append(lib.lathe(f'guard-hole{side}', [(y0 - 0.01, 0.0072), (y1 + 0.01, 0.0072)], 20, 'Y', (side * 0.0195, 0, 0.002), scale=(0.62, 1.0)))
    lib.cut(guard, *holes)
    lib.weld(guard)
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    # The blade's collar, wrapping its root.
    bottom, top, _ = outline(HABAKI[0])
    y0, y1 = HABAKI
    habaki = lib.profile('habaki', lib.fillet([(y0, bottom - 0.0016), (y1, bottom - 0.0006), (y1, top + 0.0006), (y0, top + 0.0016)], [0.0005, 0.0012, 0.0012, 0.0005]),
                         0.012, finish='blackened', taper=lambda y, z: 0.0058 - 0.045 * (y - y0))
    lib.bevel(habaki, 0.0007, 2)
    w.add(habaki)


def camera(pos, rot):
    """A camera-space pose as the game gives it (three: position, Euler XYZ) as a Blender matrix in the preview's frame."""
    return Matrix.Translation((pos[0], -pos[2], pos[1])) @ Euler((rot[0], -rot[2], rot[1]), 'YZX').to_matrix().to_4x4()


def guard_key(w):
    """The pivot's (location, rotation) that brings the sword from the game's guard pose of the root to `GUARD_AT`."""
    origin, blade_dir, spine_dir = GUARD_AT
    b = lambda v: Vector((v[0], -v[2], v[1]))
    y = b(blade_dir).normalized()
    z = b(spine_dir)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    target = Matrix((x, y, z)).transposed().to_4x4()
    target.translation = b(origin)
    p = Vector(w.pivot.location)
    a = camera(*GUARD_ROOT).inverted() @ target @ Matrix.Translation(p)
    return tuple(a.translation - p), tuple(a.to_euler('XYZ'))


def build():
    w = lib.Weapon('sword', pivot=(0, -0.06, 0))
    # The sockets and hands are placed from the pivot's world matrix: bring it up to date first.
    bpy.context.view_layer.update()
    w.add(blade())
    w.add(grip())
    fittings(w)
    fist = {
        'index': {'curl': (1.35, 1.6, 0.9)}, 'middle': {'curl': (1.4, 1.65, 0.95)},
        'ring': {'curl': (1.45, 1.65, 0.95)}, 'pinky': {'curl': (1.5, 1.6, 0.95)},
        'thumb': [(-0.9, 0.0, -0.35), (-0.7, 0, 0), (-0.5, 0, 0)],
    }
    # Two fists round the grip, knuckles up: the right under the guard, the left at the pommel (the knife's hammer grip, and its mirror).
    hands.hand(w, 'right-hand', fist, wrist=(0.046, -0.024, -0.036), fingers=(-0.62, 0.0, 0.78), back=(0.60, 0.25, 0.75), forearm=(0.40, -0.70, -0.60))
    hands.hand(w, 'left-hand', fist, wrist=(-0.046, -0.168, -0.036), fingers=(0.62, 0.0, 0.78), back=(-0.60, 0.25, 0.75), forearm=(-0.40, -0.70, -0.60), side='L')
    _, top, _ = outline(TIP_Y)
    w.socket('tip', (0, TIP_Y, top))
    w.socket('smears', (0, HABAKI[1], centre(HABAKI[1])))
    for name, side in (('slash', 1), ('slash-back', -1)):
        c = lib.Clip(w, name, SLASH)
        c.at('pivot', 0.0, rot=(0.30, side * 0.20, side * 0.32)).at('pivot', 0.45, rot=(-0.18, -side * 0.14, -side * 0.26)).at('pivot', 1.0)
    # The guard: the game blends the root to its guard pose and plays this at the blend's share, so at full guard
    # the sword lies across the body, the blade rising to the left, the edge out, under the crosshair.
    loc, rot = guard_key(w)
    lib.Clip(w, 'guard', GUARD).at('pivot', 1.0, loc=loc, rot=rot)
    # The draw: up from low and turned in, a little past the rest, and settle.
    c = lib.Clip(w, 'equip', DRAW)
    c.at('pivot', 0.0, loc=(0.02, -0.10, -0.14), rot=(-0.95, 0.25, 0.35)).at('pivot', 0.7, rot=(0.05, 0.0, -0.02))
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'sword', (('slash', (0.0, 0.45)), ('equip', (0.0, 0.5))), rest=REST[0], rot=REST[1])
        folder = os.path.join(opts['out'], 'sword')
        # Full guard: the root at the game's guard pose, the clip at its end.
        lib.preview(os.path.join(folder, 'clip-guard-1.0'), [w], views=('fp',), frame=round(GUARD * lib.FPS), clip='guard', rest=GUARD_ROOT[0], rest_rot=GUARD_ROOT[1])
    if opts['bake']:
        lib.finish([w], opts, 'sword')


if __name__ == '__main__':
    main()

"""
The clown masks (docs/VISUALS.md, R7): the game's signature, kept on every
humanoid and machine that wore one on the flat look. A realistic mask is a
moulded shell over the face (brow ridge, cheekbones, a nose, a chin, cut eye
openings) with its paint as thin decals on it, so each kind keeps the flat
look's design: the same brows, cheek marks, grin and nose, and its own extras
(assets/models/build_tactical.py `mask`, whose outlines are mapped onto this
smaller, real-sized shell).

The shell is in head space round the operator's head (body.py); machines
place it on their hull with `place` (a transform applied to every piece).
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import core as L

# The shell: from the chin up to the forehead, half as wide as its cheeks.
# A heist mask's size, over a face's, so its white reads at 60 m at Medium's resolution too; its chin
# tucks into the neck gaiter (gear.py `collar`).
Y0, HEIGHT = 1.535, 0.275
# Across, over the face's: the paint's outlines and the shell's width both scale by it.
WIDE = 1.08
# The flat look's mask spans y -0.042..0.323 of its head (0.365 tall, 0.166 half-wide); its outlines map here.
LOW_Y0, LOW_H, LOW_W = -0.042, 0.365, 0.166


def half_width(t):
    return WIDE * (0.066 + 0.058 * math.sin(math.pi * min(1.0, t) * 0.85) ** 0.7)


def surface(x, y):
    """The shell's front (game z) at (x, y), features included."""
    t = (y - Y0) / HEIGHT
    w = half_width(t)
    u = min(1.0, abs(x) / w)
    base = 0.06 + (0.048 + 0.02 * math.sin(math.pi * t)) * math.sqrt(max(0.0, 1 - u * u))
    g = lambda a, sa, b, sb: math.exp(-((x - a) / sa) ** 2 - ((t - b) / sb) ** 2)
    nose = 0.03 * math.exp(-(x / 0.014) ** 2) * math.exp(-((t - 0.44) / 0.1) ** 2) * (1 if t < 0.52 else math.exp(-((t - 0.52) / 0.06) ** 2))
    brow = 0.009 * math.exp(-((t - 0.66) / 0.05) ** 2) * (1 - u * 0.6)
    cheeks = 0.008 * (g(0.062, 0.034, 0.43, 0.08) + g(-0.062, 0.034, 0.43, 0.08))
    sockets = -0.011 * (g(0.04, 0.027, 0.588, 0.05) + g(-0.04, 0.027, 0.588, 0.05))
    chin = 0.006 * math.exp(-(x / 0.03) ** 2) * math.exp(-((t - 0.08) / 0.06) ** 2)
    return base + nose + brow + cheeks + sockets + chin


def from_low(x, y):
    """A point of the flat look's mask outline (its face space) on this shell's face."""
    return x * 0.7 * WIDE, Y0 + (y - LOW_Y0) / LOW_H * HEIGHT


EYES = [(-0.04, 1.705), (0.04, 1.705)]
EYE_R = (0.023, 0.013)


def shell(name='mask-shell'):
    """The moulded shell, 4 mm thick; its eye openings are dark insets in the sockets (`build`)."""
    rows, cols = 26, 24
    verts, faces = [], []
    for j in range(rows + 1):
        t = j / rows
        y = Y0 + t * HEIGHT
        w = half_width(t)
        for i in range(cols + 1):
            x = (i / cols * 2 - 1) * w
            verts.append((x, y, surface(x, y)))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append([a, a + 1, a + cols + 2, a + cols + 1])
    o = L.obj_from(name, verts, faces)
    m = o.modifiers.new('thickness', 'SOLIDIFY')
    m.thickness = 0.004
    m.offset = -1
    L.W._apply_modifier(o, m)
    for p in o.data.polygons:
        p.use_smooth = True
    L.paint(o, 'mask')
    return o


# How far a decal's flat triangles may part from the curved shell between their corners (metres), and its longest
# edge. An edge whose middle is further than DECAL_SAG off the shell is halved until none is, so the paint follows
# the shell where it curves and keeps large triangles where it does not; none goes under DECAL_MIN (paint over the
# shell's rim, whose slope turns sharply, would split without end). A grin cut in a few long triangles sagged 2 cm
# where it wraps round the cheeks and sank into the shell, leaving a sliver.
DECAL_SAG, DECAL_EDGE, DECAL_MIN = 0.0004, 0.03, 0.004


def _sag(edge):
    (x1, _, y1), (x2, _, y2) = edge.verts[0].co, edge.verts[1].co
    return abs(surface((x1 + x2) / 2, (y1 + y2) / 2) - (surface(x1, y1) + surface(x2, y2)) / 2)


def decal(name, outline, lift=0.0022, finish='decal', low=True):
    """A painted shape on the shell: an outline (the flat look's mask space when `low`), split finely enough to follow the surface."""
    pts = [from_low(x, y) if low else (x, y) for x, y in outline]
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, y)) for x, y in pts]
    face = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[face])
    for _ in range(16):
        long = [e for e in bm.edges if e.calc_length() > DECAL_EDGE or (e.calc_length() > DECAL_MIN and _sag(e) > DECAL_SAG)]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    for v in bm.verts:
        v.co.y = -(surface(v.co.x, v.co.z) + lift)
    bm.normal_update()
    # Every face towards the viewer (game +z, Blender -y), face by face: the splits leave some turned the other
    # way, which the game culls (a grin reduced to a sliver), though Cycles' previews draw both sides.
    bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if f.normal.y > 0])
    bm.normal_update()
    o = L.W._object(name, bm)
    for f in o.data.polygons:
        f.use_smooth = True
    L.paint(o, finish)
    return o


def stud(name, size, x, y, lift=0.004, finish='metal', rot=(0, 0, 0)):
    """A small hard piece set on the shell (a bolt, a lens, a filter)."""
    return L.box(name, size, (x, y, surface(x, y) + lift + size[2] / 2), finish, rot=rot, bevel=min(size) * 0.25)


RED, INK, IVORY = 0xa3222e, 0x16191d, 0xf6f3ec
# The mask shell's emission: 0.52 of its albedo (render/materials.ts `operatorShader`, x CHARACTER_GLOW 4).
MASK_GLOW = 0.13


def build(kind, heavy=False):
    """
    A kind's mask as [(object, colour, glow)]: the ivory shell and its paint,
    after the flat look's `mask()` for that kind.
    """
    # The shell glows faintly (MASK_GLOW of the game's CHARACTER_GLOW): glazed white reads in shade at 60 m, as the flat look's did.
    out = [(shell(f'mask-{kind}'), IVORY, MASK_GLOW)]
    paint = lambda o, c, g=0.0: out.append((o, c, g))
    for i, (ex, ey) in enumerate(EYES):
        ring = [(ex + EYE_R[0] * math.cos(a), ey + EYE_R[1] * math.sin(a)) for a in (k * math.tau / 14 for k in range(14))]
        # Over the sockets, where the shell's own faces (a centimetre across) stand above its curve by about a millimetre and a half.
        paint(decal(f'eye{i}', ring, lift=0.0035, low=False), INK)
    for s in (-1, 1):
        paint(decal(f'brow{s}', [(s * .024, .25), (s * .111, .275), (s * .114, .264), (s * .026, .238)]), INK if heavy else RED)
        paint(decal(f'cheek{s}', [(s * .092, .175), (s * .059, .175), (s * .098, .106)]), RED)
    paint(decal('grin', [(-.097, .084), (-.045, .055), (0, .045), (.045, .055), (.097, .084), (.074, .031), (0, .006), (-.074, .031)]), RED)
    paint(decal('cut-grin', [(-.084, .069), (-.041, .046), (0, .036), (.041, .046), (.084, .069), (.065, .035), (0, .016), (-.065, .035)], lift=0.0034), INK)
    for i in range(-3, 4):
        x, y = from_low(i * .018, .035 + abs(i) * .004)
        paint(L.box(f'tooth{i}', (0.0075, 0.0065, 0.003), (x, y, surface(x, y) + 0.0045), 'mask', bevel=0.0012), IVORY)
    # The nose: an angular red nose, not a toy ball.
    nx, ny = from_low(0, .13)
    nose = L.lathe('nose', [(0.0, 0.017), (0.012, 0.016), (0.022, 0.009), (0.026, 0.0)], (nx, ny, surface(nx, ny) - 0.012), 'z', 8, 'paint', scale=(1.0, 0.85))
    paint(nose, 0x8f1c26)
    x0, y0 = from_low(0, 0)
    if heavy:
        paint(L.curved_panel('reinforced-jaw', 0.16, 0.05, 0.012, 0.1, 'steel', centre=(0, Y0 + 0.03, surface(0, Y0 + 0.03) + 0.008), cols=8, rows=2), 0x5b6570)
        paint(decal('forehead-stripe', [(-.012, .26), (.012, .26), (.012, .315), (-.012, .315)], lift=0.003), RED)
    extras = EXTRAS.get(kind)
    if extras:
        extras(paint)
    return out


def _rusher(paint):
    for s in (-1, 1):
        paint(decal(f'eye-diamond{s}', [(s * .067, .292), (s * .101, .21), (s * .064, .10), (s * .038, .21)], lift=0.0034), INK)


def _sniper(paint):
    for s in (-1, 1):
        paint(decal(f'tear{s}', [(s * .055, .17), (s * .074, .17), (s * .066, .051)], lift=0.0034), INK)
    x, y = from_low(.10, .253)
    paint(stud('rangefinder', (0.032, 0.02, 0.018), x, y, finish='metal'), 0x3a4148)


def _shield(paint):
    paint(decal('split-mask', [(0, -.035), (.09, .012), (.13, .18), (.12, .30), (0, .319)], lift=0.003), 0x2b3a44)


def _boss(paint):
    for s in (-1, 1):
        x, y = from_low(s * .12, .10)
        paint(stud(f'command-cheek{s}', (0.03, 0.03, 0.006), x, y, finish='metal', rot=(0, 0, math.pi / 4)), 0xc8a24a)
    paint(decal('command-forehead', [(-.018, .265), (0, .315), (.018, .265), (0, .239)], lift=0.003), 0xc8a24a)


def _bomber(paint):
    for s in (-1, 1):
        x, y = from_low(s * .129, .068)
        paint(L.lathe(f'filter{s}', [(0.0, 0.02), (0.022, 0.02), (0.026, 0.014)], (x, y, surface(x, y) - 0.004), 'z', 12, 'rubber'), 0x25282b)
    paint(decal('warning', [(-.017, .266), (0, .309), (.017, .266)], lift=0.003), 0xd98a1a)


def _hitbox(paint):
    x, y = from_low(0, .279)
    paint(L.box('breach-brow', (0.2, 0.02, 0.02), (x, y, surface(x, y) + 0.01), 'steel', bevel=0.004), 0x69737a)
    for s in (-1, 1):
        x, y = from_low(s * .124, .264)
        paint(stud(f'bolt{s}', (0.011, 0.011, 0.01), x, y), 0xd98a1a)


def _lagspike(paint):
    for s in (-1, 1):
        paint(decal(f'jagged-edge{s}', [(s * .126, .06), (s * .20, .13), (s * .14, .16), (s * .20, .26), (s * .116, .25)], lift=0.003), 0x6a4a9a)


def _medic(paint):
    paint(decal('cross-v', [(-.0125, .245), (.0125, .245), (.0125, .315), (-.0125, .315)], lift=0.003), RED)
    paint(decal('cross-h', [(-.035, .268), (.035, .268), (.035, .292), (-.035, .292)], lift=0.0032), RED)


def _breacher(paint):
    x, y = from_low(0, .263)
    paint(L.box('visor-brow', (0.19, 0.026, 0.02), (x, y, surface(x, y) + 0.01), 'steel', bevel=0.004), 0xc98a2a)


def _flight(colour):
    def extras(paint):
        for s in (-1, 1):
            paint(decal(f'fin{s}', [(s * .12, .09), (s * .20, .24), (s * .12, .27)], lift=0.003), colour)
    return extras


def _moderator(paint):
    _flight(0xc8a24a)(paint)
    paint(decal('sigil', [(-.028, .268), (0, .32), (.028, .268), (0, .24)], lift=0.0034), 0xc8a24a)


def _optic(glow):
    def extras(paint):
        x, y = from_low(.069, .206)
        paint(L.box('optic-housing', (0.062, 0.05, 0.04), (x, y, surface(x, y) + 0.018), 'metal', bevel=0.006), 0x3a4148)
        paint(L.lathe('optic-lens', [(0.0, 0.017), (0.006, 0.0)], (x, y, surface(x, y) + 0.038), 'z', 12, 'glow' if glow else 'lens'),
              0xffb020 if glow else 0x1b2a33, 1.0 if glow else 0.0)
    return extras


def _packleader(paint):
    for s in (-1, 1):
        paint(decal(f'leader-cheek{s}', [(s * .09, .12), (s * .16, .17), (s * .12, .035)], lift=0.003), 0xc8a24a)


def _smoker(paint):
    for s in (-1, 1):
        x, y = from_low(s * .113, .07)
        paint(L.lathe(f'respirator{s}', [(0.0, 0.026), (0.03, 0.026), (0.034, 0.018)], (x, y, surface(x, y) - 0.006), 'z', 14, 'rubber', rot=(0, s * 0.35, 0)), 0x4a5a3c)
    x, y = from_low(0, .045)
    paint(L.box('grille', (0.056, 0.03, 0.02), (x, y, surface(x, y) + 0.01), 'rubber', bevel=0.005), 0x222527)


def _rubberbander(paint):
    for s in (-1, 1):
        for i in range(3):
            paint(decal(f'pixel{s}{i}', [(s * (.10 + i * .028) - .026, .26 - i * .082 - .012), (s * (.10 + i * .028) + .026, .26 - i * .082 - .012),
                                         (s * (.10 + i * .028) + .026, .26 - i * .082 + .012), (s * (.10 + i * .028) - .026, .26 - i * .082 + .012)], lift=0.003), 0x2fb7c4)


def _sapper(paint):
    x, y = from_low(0, .262)
    paint(L.box('goggle-brow', (0.18, 0.02, 0.018), (x, y, surface(x, y) + 0.009), 'steel', bevel=0.004), 0xc98a2a)
    x, y = from_low(0, .294)
    paint(L.box('headlamp', (0.032, 0.022, 0.02), (x, y, surface(x, y) + 0.02), 'glow', bevel=0.004), 0xffe6a0, 1.0)


def _parry(paint):
    paint(decal('half-mask', [(-.14, .28), (-.02, .31), (-.02, .14), (-.11, .1)], lift=0.003), 0x8b93a0)


def _ragequit(paint):
    for s in (-1, 1):
        paint(decal(f'jaw-tooth{s}', [(s * .03, -.02), (s * .075, -.02), (s * .065, .075)], lift=0.003), 0x8b93a0)


EXTRAS = {
    'rusher': _rusher, 'sniper': _sniper, 'shield': _shield, 'boss': _boss, 'bomber': _bomber, 'hitbox': _hitbox,
    'lagspike': _lagspike, 'medic': _medic, 'breacher': _breacher, 'flyer': _flight(0x5b6570), 'carrier': _flight(0x5b6570),
    'moderator': _moderator, 'turret': _optic(False), 'aimbot': _optic(True), 'packleader': _packleader, 'smoker': _smoker,
    'rubberbander': _rubberbander, 'sapper': _sapper, 'parry': _parry, 'ragequit': _ragequit,
}

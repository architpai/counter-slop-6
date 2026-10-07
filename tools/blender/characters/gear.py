"""
Tactical gear for the operators (docs/VISUALS.md, R7), made for the width-1
body in the game's space (body.py) and fitted with it: plate carriers,
pouches, belts, pads, headsets and the headgear the game's hats name
(enemies/types.ts `hat`: cap, band, helmet, hood, crown).

Each function returns a list of (object, bone) pairs: the bone the piece is
rigid on. The caller tints and weights them.
"""

import math

import numpy as np

import core as L
import sdf as S

E, R, B = S.ellipsoid, S.round_cone, S.box


# ------------------------------------------------------------------ torso

def plate_carrier(heavy=False):
    """A plate carrier: front and back plates in a cordura cover, a cummerbund, padded straps, MOLLE rows."""
    out = []
    z0 = 0.132 if not heavy else 0.15
    front = L.curved_panel('carrier-front', 0.29, 0.31, 0.042, 0.34, 'cordura', centre=(0, 1.245, z0 + 0.021), cols=10, rows=5,
                           taper=lambda v: 1.0 - 0.18 * max(0.0, v - 0.7) / 0.3, bevel=0.008)
    out.append((front, 'chest'))
    back = L.curved_panel('carrier-back', 0.30, 0.33, 0.04, 0.4, 'cordura', centre=(0, 1.25, -0.142 - 0.02), rot=(0, math.pi, 0), cols=10, rows=5, bevel=0.008)
    out.append((back, 'chest'))
    # MOLLE webbing rows across the front's lower half.
    for i in range(3):
        y = 1.13 + 0.035 * i
        out.append((L.curved_panel(f'molle{i}', 0.27, 0.022, 0.004, 0.34 + 0.045, 'webbing', centre=(0, y, z0 + 0.047), cols=10, rows=1, bevel=0.0012), 'chest'))
    # Cummerbund: a band round each side from the front plate to the back one.
    for s in (-1, 1):
        pts = []
        for k in range(9):
            a = math.radians(-60 + 120 * k / 8)
            pts.append((s * 0.178 * math.cos(a) * 1.0, 1.16, 0.13 * math.sin(a)))
        band = L.strap(f'cummerbund{"LR"[s > 0]}', pts, 0.13, 0.014, 'cordura', normal_hint=(s, 0, 0))
        out.append((band, 'torso'))
        # Padded shoulder straps over the trapezius, front plate to back.
        strap = L.strap(f'shoulder-strap{"LR"[s > 0]}', [(s * 0.1, 1.39, 0.15), (s * 0.115, 1.47, 0.09), (s * 0.12, 1.5, 0.0),
                                                        (s * 0.115, 1.47, -0.09), (s * 0.1, 1.4, -0.16)], 0.058, 0.016, 'cordura', normal_hint=(0, 1, 0))
        out.append((strap, 'chest'))
    return out


def mag_pouches(count=3, z=0.176, y=1.165, finish='cordura'):
    """Rifle magazine pouches on the carrier's front: a box with a flap and a pull tab."""
    out = []
    for i in range(count):
        x = (i - (count - 1) / 2) * 0.078
        body = L.box(f'mag-pouch{i}', (0.07, 0.115, 0.05), (x, y, z + 0.025), finish, bevel=0.009)
        flap = L.box(f'mag-flap{i}', (0.074, 0.035, 0.056), (x, y + 0.052, z + 0.028), finish, bevel=0.006)
        tab = L.box(f'mag-tab{i}', (0.018, 0.022, 0.006), (x, y + 0.03, z + 0.058), 'webbing', bevel=0.002)
        out += [(body, 'chest'), (flap, 'chest'), (tab, 'chest')]
    return out


def admin_pouch(y=1.33, z=0.18):
    return [(L.box('admin-pouch', (0.13, 0.075, 0.03), (0, y, z), 'cordura', bevel=0.008), 'chest')]


def radio(side=1):
    """A radio pouch on the carrier's side with its antenna."""
    x = side * 0.19
    body = L.box('radio-pouch', (0.05, 0.12, 0.07), (x, 1.24, 0.07), 'cordura', bevel=0.008)
    unit = L.box('radio', (0.04, 0.05, 0.055), (x, 1.325, 0.07), 'polymer', bevel=0.005)
    antenna = L.tube('radio-antenna', (x, 1.34, 0.08), (x + side * 0.02, 1.52, 0.05), 0.0045, 6, 'rubber')
    return [(body, 'chest'), (unit, 'chest'), (antenna, 'chest')]


def belt(pouches=True):
    """A padded war belt with a buckle, and utility and dump pouches round it."""
    out = [(L.ring('belt', (0, 0.968 + 0.025, -0.004), (0.176, 0.128), 0.05, 0.006, 'y', 28, 'webbing'), 'hips')]
    out.append((L.box('buckle', (0.06, 0.042, 0.012), (0, 0.993, 0.13), 'metal', bevel=0.003), 'hips'))
    if pouches:
        for s in (-1, 1):
            out.append((L.box(f'belt-pouch{"LR"[s > 0]}', (0.05, 0.09, 0.075), (s * 0.165, 0.95, 0.06), 'cordura', bevel=0.009), 'hips'))
        out.append((L.box('dump-pouch', (0.13, 0.1, 0.05), (0.06, 0.945, -0.15), 'cordura', bevel=0.012), 'hips'))
    return out


def knee_pads():
    out = []
    for s, side in ((-1, 'L'), (1, 'R')):
        pad = L.curved_panel(f'kneepad{side}', 0.1, 0.12, 0.018, 0.07, 'polymer', centre=(s * 0.13, 0.44, 0.086), cols=8, rows=3, bevel=0.006)
        strap = L.ring(f'kneestrap{side}', (s * 0.13, 0.4 + 0.011, 0.004), (0.068, 0.07), 0.022, 0.006, 'y', 18, 'webbing')
        out += [(pad, f'shin{side}'), (strap, f'shin{side}')]
    return out


def elbow_pads():
    out = []
    for s, side in ((-1, 'L'), (1, 'R')):
        pad = L.curved_panel(f'elbowpad{side}', 0.07, 0.085, 0.014, 0.05, 'polymer', centre=(s * 0.26, 1.06, -0.052), rot=(0, math.pi, 0), cols=6, rows=3, bevel=0.005)
        out.append((pad, f'fore{side}'))
    return out


def thigh_pockets():
    """Cargo pockets on the trouser legs, with flaps."""
    out = []
    for s, side in ((-1, 'L'), (1, 'R')):
        pocket = L.box(f'cargo{side}', (0.03, 0.15, 0.13), (s * 0.19, 0.64, 0.0), 'ripstop', bevel=0.012)
        flap = L.box(f'cargo-flap{side}', (0.034, 0.04, 0.135), (s * 0.192, 0.715, 0.0), 'ripstop', bevel=0.008)
        out += [(pocket, f'thigh{side}'), (flap, f'thigh{side}')]
    return out


def collar():
    """A knit neck gaiter from the carrier's straps up under the mask's chin: no bare neck between them."""
    return [(L.lathe('collar', [(0.0, 0.096), (0.03, 0.091), (0.07, 0.081), (0.1, 0.073), (0.112, 0.066)], (0, 1.448, -0.008), 'y', 20, 'knit',
                     scale=(1.0, 0.92)), 'chest')]


def holster(side=1):
    """A drop-leg holster on the thigh, for the pistol carriers."""
    x = side * 0.18
    return [(L.box('holster', (0.045, 0.16, 0.07), (x, 0.66, 0.02), 'polymer', bevel=0.012), f'thigh{"LR"[side > 0]}'),
            (L.ring('holster-strap', (side * 0.13, 0.6 + 0.0125, 0.0), (0.082, 0.075), 0.025, 0.006, 'y', 16, 'webbing'), f'thigh{"LR"[side > 0]}')]


# ------------------------------------------------------------------ head

def headset():
    out = []
    for s in (-1, 1):
        cup = L.lathe(f'earcup{"LR"[s > 0]}', [(-0.014, 0.0), (-0.014, 0.027), (0.01, 0.03), (0.016, 0.024), (0.016, 0.0)], (s * 0.098, 1.675, -0.006), 'x', 16, 'polymer', scale=(1.0, 1.15))
        out.append((cup, 'head'))
    band = L.ring('headband', (0 + 0.007, 1.68, -0.006), (0.108, 0.122), 0.014, 0.006, 'x', 24, 'polymer')
    out.append((band, 'head'))
    boom = L.tube('mic-boom', (0.1, 1.66, 0.02), (0.05, 1.6, 0.11), 0.004, 6, 'rubber')
    out.append((boom, 'head'))
    return out


def helmet(kind='fast'):
    """A ballistic helmet: FAST-cut shell with rails and a night-vision shroud; `riot` adds a raised visor, `eod` is the heavy's."""
    out = []
    f = S.Field()
    if kind == 'eod':
        f.add(E, (0, 1.7, -0.012), (0.132, 0.14, 0.142))
        f.cut(E, (0, 1.7, -0.012), (0.116, 0.124, 0.126), blend=0.002)
        f.cut(E, (0, 1.665, 0.14), (0.125, 0.15, 0.13), blend=0.01)
        f.cut(B, (0, 1.45, 0), (0.3, 0.1, 0.3), blend=0.004)
        shell = L.soft('helmet-eod', f, (-0.18, 1.52, -0.19), (0.18, 1.88, 0.19), 0.0055, triangles=1400, finish='polymer')
        out.append((shell, 'head'))
        return out
    f.add(E, (0, 1.708, -0.012), (0.118, 0.118, 0.13))
    f.cut(E, (0, 1.708, -0.012), (0.104, 0.104, 0.116), blend=0.002)
    # The FAST cut: high over the ears, a brim over the brow, lower at the back.
    f.cut(B, (0, 1.55, 0.0), (0.3, 0.14, 0.3), blend=0.006)
    for s in (-1, 1):
        f.cut(E, (s * 0.12, 1.67, 0.02), (0.06, 0.055, 0.075), blend=0.012)
    f.cut(E, (0, 1.64, 0.14), (0.12, 0.09, 0.06), blend=0.01)
    shell = L.soft(f'helmet-{kind}', f, (-0.14, 1.64, -0.16), (0.14, 1.84, 0.14), 0.005, triangles=1100, finish='polymer')
    out.append((shell, 'head'))
    for s in (-1, 1):
        rail = L.box(f'helmet-rail{"LR"[s > 0]}', (0.012, 0.024, 0.1), (s * 0.114, 1.71, -0.01), 'polymer', rot=(0, 0, s * 0.12), bevel=0.003)
        out.append((rail, 'head'))
    shroud = L.box('nvg-shroud', (0.05, 0.032, 0.016), (0, 1.775, 0.108), 'metal', rot=(-0.5, 0, 0), bevel=0.004)
    out.append((shroud, 'head'))
    if kind == 'riot':
        visor = L.curved_panel('riot-visor', 0.2, 0.07, 0.006, 0.12, 'lens', centre=(0, 1.8, 0.07), rot=(-0.9, 0, 0), cols=8, rows=2, bevel=0.002)
        out.append((visor, 'head'))
    return out


def cap():
    """A patrol cap with a stiff peak, over the headset."""
    f = S.Field()
    # Worn over the mask: the crown sits on its top edge, the peak out over its brow.
    f.add(E, (0, 1.788, -0.012), (0.114, 0.085, 0.124))
    f.cut(E, (0, 1.788, -0.012), (0.104, 0.075, 0.114), blend=0.002)
    f.cut(B, (0, 1.672, 0), (0.3, 0.11, 0.3), blend=0.004)
    crown = L.soft('cap-crown', f, (-0.14, 1.76, -0.15), (0.14, 1.89, 0.15), 0.005, triangles=700, finish='canvas')
    peak = L.curved_panel('cap-peak', 0.17, 0.09, 0.006, 0.11, 'canvas', centre=(0, 1.788, 0.165), rot=(-1.4, 0, 0), cols=8, rows=3, bevel=0.002)
    return [(crown, 'head'), (peak, 'head')]


def band():
    """A headband knotted at the back, its tails hanging."""
    ring = L.ring('band', (0, 1.74 + 0.017, -0.008), (0.106, 0.122), 0.034, 0.006, 'y', 24, 'canvas')
    out = [(ring, 'head')]
    for k, (dx, a) in enumerate(((-0.02, 0.25), (0.02, -0.15))):
        tail = L.strap(f'band-tail{k}', [(dx, 1.75, -0.115), (dx * 2, 1.68, -0.14), (dx * 3 + a * 0.05, 1.6, -0.15)], 0.028, 0.004, 'canvas', normal_hint=(0, 0, -1))
        out.append((tail, 'head'))
    return out


def hood(drape=True):
    """A cloth hood round the head, open at the face, its hem over the shoulders."""
    f = S.Field()
    f.add(E, (0, 1.7, -0.022), (0.118, 0.13, 0.13))
    if drape:
        f.add(R, (0, 1.64, -0.04), (0, 1.47, -0.03), 0.11, 0.15, blend=0.05)
    f.cut(E, (0, 1.7, -0.022), (0.104, 0.116, 0.116), blend=0.002)
    f.cut(R, (0, 1.64, -0.04), (0, 1.45, -0.03), 0.095, 0.135, blend=0.02)
    # The opening for the face (and the mask).
    f.cut(E, (0, 1.68, 0.13), (0.118, 0.148, 0.095), blend=0.02)
    f.cut(B, (0, 1.3, 0), (0.3, 0.12, 0.3), blend=0.004)
    return [(L.soft('hood', f, (-0.2, 1.4, -0.2), (0.2, 1.86, 0.18), 0.0055, triangles=1400, finish='canvas'), 'head')]


def crown():
    """The Admin's command crown: a gold band with five points and a jewel."""
    ring = L.lathe('crown-band', [(0.0, 0.106), (0.045, 0.11), (0.05, 0.104), (0.0, 0.1)], (0, 1.76, -0.008), 'y', 30, 'metal', closed=True)
    out = [(ring, 'head')]
    for i in range(5):
        a = i * math.tau / 5 + math.pi / 2
        x, z = math.cos(a) * 0.105, math.sin(a) * 0.105 - 0.008
        spike = L.lathe(f'crown-point{i}', [(0.0, 0.018), (0.06, 0.0)], (x, 1.8, z), 'y', 4, 'metal')
        out.append((spike, 'head'))
    jewel = L.box('crown-jewel', (0.026, 0.026, 0.012), (0, 1.785, 0.105), 'glow', rot=(0, 0, math.pi / 4), bevel=0.003)
    out.append((jewel, 'head'))
    return out


def goggles():
    """The player's ballistic goggles over the balaclava (remote players are unmasked)."""
    frame = L.curved_panel('goggle-frame', 0.17, 0.05, 0.02, 0.09, 'rubber', centre=(0, 1.705, 0.098), cols=8, rows=2, bevel=0.006)
    lens = L.curved_panel('goggle-lens', 0.15, 0.036, 0.004, 0.1, 'lens', centre=(0, 1.705, 0.12), cols=8, rows=2, bevel=0.002)
    strap = L.ring('goggle-strap', (0, 1.705 + 0.011, -0.005), (0.098, 0.112), 0.022, 0.006, 'y', 24, 'webbing')
    return [(frame, 'head'), (lens, 'head'), (strap, 'head')]

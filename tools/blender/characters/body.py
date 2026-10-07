"""
The operator's body (docs/VISUALS.md, R7): combat trousers and shirt, the
head under its balaclava, boots and gloved hands, made once for a body of
width 1 on the game's pivots (render/figure.ts: hips at 0.86 m, shoulders
at +-0.26 and 1.36 m, knees at 0.42 m, the neck at 1.52 m) and fitted to
each kind's build by `fit()`.

Proportions are a real 1.8 m operator's where the pivots allow: the head is
about a fifth over life size (the mask is the game's signature and must
read at 60 m), and the shoulders sit a little low and wide on the game's
joints, which the plate carrier's straps and pads carry.
"""

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import core as L
import sdf as S

E, R, B = S.ellipsoid, S.round_cone, S.box


def trousers():
    f = S.Field()
    f.add(E, (0, 0.935, -0.005), (0.168, 0.118, 0.118))
    for s in (-1, 1):
        f.add(E, (s * 0.075, 0.89, -0.052), (0.092, 0.10, 0.082), blend=0.04)
        f.add(R, (s * 0.118, 0.87, 0.0), (s * 0.13, 0.45, 0.006), 0.09, 0.064, blend=0.05)
        f.add(E, (s * 0.122, 0.66, 0.024), (0.076, 0.15, 0.072), blend=0.035)
        f.add(E, (s * 0.13, 0.44, 0.012), (0.066, 0.075, 0.068), blend=0.03)
        f.add(R, (s * 0.13, 0.43, 0.0), (s * 0.13, 0.12, -0.004), 0.062, 0.055, blend=0.03)
        f.add(E, (s * 0.13, 0.31, -0.026), (0.06, 0.10, 0.06), blend=0.025)
        # Bloused over the boot's shaft: the hem stands clear of the leather, so the two never cross in a ragged line.
        f.add(E, (s * 0.13, 0.215, -0.006), (0.075, 0.06, 0.08), blend=0.03)
    # Waist and hem: the shirt tucks in under the belt, the legs blouse over the boots' tops.
    f.cut(B, (0, 1.2, 0), (0.5, 0.2, 0.3), blend=0.004)
    f.cut(B, (0, -0.05, 0), (0.5, 0.222, 0.3), blend=0.004)
    return L.soft('trousers', f, (-0.34, 0.08, -0.2), (0.34, 1.03, 0.2), 0.0075, triangles=2600, finish='ripstop')


def shirt():
    f = S.Field()
    f.add(E, (0, 1.06, 0.0), (0.15, 0.13, 0.104))
    f.add(E, (0, 1.27, 0.0), (0.176, 0.15, 0.114), blend=0.06)
    for s in (-1, 1):
        f.add(E, (s * 0.07, 1.30, 0.045), (0.082, 0.062, 0.052), blend=0.03)
        f.add(E, (s * 0.11, 1.21, -0.035), (0.075, 0.13, 0.078), blend=0.04)
        f.add(R, (s * 0.05, 1.46, -0.015), (s * 0.2, 1.43, -0.008), 0.058, 0.05, blend=0.045)
        f.add(E, (s * 0.235, 1.378, 0.0), (0.074, 0.076, 0.072), blend=0.035)
        f.add(R, (s * 0.25, 1.36, 0), (s * 0.26, 1.075, 0.0), 0.058, 0.049, blend=0.03)
        f.add(E, (s * 0.256, 1.23, 0.018), (0.051, 0.082, 0.049), blend=0.02)
        f.add(R, (s * 0.26, 1.07, 0.0), (s * 0.26, 0.81, 0.016), 0.048, 0.037, blend=0.025)
        f.add(E, (s * 0.26, 0.985, 0.01), (0.048, 0.07, 0.046), blend=0.02)
    f.add(R, (0, 1.42, -0.012), (0, 1.56, 0.0), 0.066, 0.06, blend=0.05)
    f.cut(B, (0, 0.8, 0), (0.2, 0.16, 0.3), blend=0.004)
    for s in (-1, 1):
        # The sleeves stop inside the glove cuffs.
        f.cut(B, (s * 0.26, 0.72, 0.0), (0.1, 0.095, 0.1), blend=0.003)
    f.cut(B, (0, 1.72, 0), (0.12, 0.155, 0.12), blend=0.004)
    return L.soft('shirt', f, (-0.35, 0.8, -0.2), (0.35, 1.58, 0.2), 0.0075, triangles=3200, finish='ripstop')


def head():
    """The head in its balaclava: skull, jaw and neck; the mask and headgear go over it."""
    f = S.Field()
    f.add(R, (0, 1.47, -0.012), (0, 1.60, 0.0), 0.058, 0.054)
    f.add(E, (0, 1.685, -0.006), (0.092, 0.114, 0.106), blend=0.035)
    f.add(E, (0, 1.605, 0.03), (0.072, 0.062, 0.072), blend=0.03)
    f.cut(B, (0, 1.36, 0), (0.2, 0.1, 0.2), blend=0.003)
    return L.soft('head', f, (-0.13, 1.44, -0.14), (0.13, 1.83, 0.14), 0.006, triangles=1300, finish='knit')


def boot(side=1):
    """A laced combat boot on the foot bone: shaft round the ankle, toe cap, and a lugged sole cut to the boot's outline."""
    x = side * 0.13
    f = S.Field()
    f.add(R, (x, 0.24, -0.008), (x, 0.08, -0.004), 0.06, 0.056)
    f.add(E, (x, 0.07, -0.02), (0.058, 0.06, 0.075), blend=0.03)
    f.add(R, (x, 0.055, 0.0), (x, 0.045, 0.13), 0.052, 0.046, blend=0.04)
    f.add(E, (x, 0.042, 0.15), (0.05, 0.036, 0.055), blend=0.03)
    f.cut(B, (x, -0.05, 0.0), (0.2, 0.068, 0.3), blend=0.002)
    upper = L.soft('boot-upper', f, (x - 0.1, 0.0, -0.12), (x + 0.1, 0.3, 0.24), 0.005, triangles=700, finish='leather')
    # The sole: the upper's footprint (heel, waist, ball and toe), 4-6 mm proud of it, 2.4 cm deep with rounded
    # edges and the instep's arch cut from under the waist.
    g = S.Field()
    g.add(E, (x, 0.012, -0.03), (0.062, 0.5, 0.075))
    g.add(E, (x, 0.012, 0.06), (0.054, 0.5, 0.075), blend=0.02)
    g.add(E, (x, 0.012, 0.15), (0.055, 0.5, 0.062), blend=0.02)
    g.cut(B, (x, 0.12, 0.05), (0.2, 0.096, 0.3), blend=0.006)
    g.cut(B, (x, -0.1, 0.05), (0.2, 0.1, 0.3), blend=0.004)
    g.cut(E, (x, -0.004, 0.045), (0.1, 0.012, 0.05), blend=0.006)
    sole = L.soft('boot-sole', g, (x - 0.08, -0.01, -0.12), (x + 0.08, 0.04, 0.23), 0.004, triangles=500, finish='sole')
    cuff = L.lathe('boot-collar', [(0.0, 0.063), (0.022, 0.064), (0.026, 0.059)], (x, 0.228, -0.008), 'y', 16, 'leather')
    return [upper, sole, cuff]


def glove_rest():
    """
    A glove from the first-person hands' soft parts (tools/blender/weapons/hands.py),
    fused coarser and decimated for a figure seen at 5-60 m, with its bones and
    weights for `hands.pose`.
    """
    import hands as H
    soft = H._soft_parts()
    glove = L.W.join('glove', soft)
    m = glove.modifiers.new('remesh', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = 0.0028
    L.W._apply_modifier(glove, m)
    m = glove.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    m.iterations = 4
    m.use_only_smooth = True
    L.W._apply_modifier(glove, m)
    L.decimate(glove, 640)
    L.W.smooth(glove, 180)
    cuff = L.W.lathe('glove-cuff', [(-0.082, 0.037), (-0.05, 0.036), (-0.02, 0.032), (0.004, 0.032), (0.02, 0.035)], 14, 'Y', scale=(1, 0.66))
    L.W.smooth(cuff, 60)
    glove = L.W.join('glove-rest', [glove, cuff])
    L.paint(glove, 'glove')
    H._weights(glove)
    import json
    glove['bones'] = json.dumps([(n, p, list(h), [list(r) for r in f]) for n, p, h, f in H.bones()])
    return glove


# The hands' poses (tools/blender/weapons/hands.py `pose` specs): a fist round a grip, and an open support hold.
GRIP = {
    'index': {'curl': (1.2, 1.3, 0.7)}, 'middle': {'curl': (1.35, 1.45, 0.75)},
    'ring': {'curl': (1.4, 1.45, 0.75)}, 'pinky': {'curl': (1.45, 1.4, 0.75)},
    'thumb': [(0.3, 0.2, -0.6), (0.5, 0, 0), (0.5, 0, 0)],
}
SUPPORT = {
    'index': {'curl': (0.7, 0.6, 0.35)}, 'middle': {'curl': (0.8, 0.7, 0.4)},
    'ring': {'curl': (0.9, 0.8, 0.45)}, 'pinky': {'curl': (1.0, 0.85, 0.5)},
    'thumb': [(0.2, 0.1, -0.3), (0.2, 0, 0), (0.2, 0, 0)],
}
# How much bigger than life the gloves are: the forearms are the game's, a little long.
GLOVE_SCALE = 1.08


def glove(rest, side, spec):
    """
    A posed glove in the game's space on its forearm pivot's rest place: the
    wrist at the forearm's end, the fingers down the arm (the gun hangs along
    it, render/figure.ts `setWeapon`), the palm towards the body, the thumb
    forward. The figure faces +z, so its anatomical right hand is the one at
    -x (the game's 'L' pivots): the rest right hand is placed there, and the
    caller mirrors it for the +x hand (after its UVs are set: mirroring
    turns its faces over, which reorders their corners).
    """
    import hands as H
    posed = H.pose(rest, f'glove{side}', spec, 'R')
    # Rest hand (Blender axes): fingers +Y, back of the hand +Z, thumb -X. Wanted at -x: fingers down,
    # the back of the hand out (-x), so the palm faces the body and the thumb forward (+z).
    fingers, back = L.G(0, -1, 0), L.G(-1, 0, 0)
    frame = Matrix((fingers.cross(back), fingers, back)).transposed().to_4x4()
    # The fist's hollow lands on the gun's grip (render/figure.ts `gunMount`, 0.29 m down the forearm, 7 cm forward).
    wrist = L.G(-0.28, 1.36 - 0.3 - 0.22, 0.012)
    posed.data.transform(Matrix.Translation(wrist) @ frame @ Matrix.Diagonal((GLOVE_SCALE,) * 3 + (1,)))
    posed.data.update()
    posed.vertex_groups.clear()
    L.paint(posed, 'glove')
    return posed


# ------------------------------------------------------------------ weights

def weights_body(p, piece):
    """
    Bone weights of a body garment's vertices (game space, width-1 body):
    the trousers blend from the pelvis into the legs and at the knees; the
    shirt from the waist up the spine, into the arms at the shoulders and
    at the elbows; the head from the chest up the neck.
    """
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ax = np.abs(x)
    n = len(p)
    out = {k: np.zeros(n) for k in ('hips', 'torso', 'chest', 'head', 'upperL', 'foreL', 'upperR', 'foreR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR')}
    trunk = np.ones(n)
    if piece == 'trousers':
        # Below the crotch and out from the centre line; round the hip joint a leg's share rises.
        leg = np.maximum(L.smoothstep(0.86, 0.72, y) * L.smoothstep(0.015, 0.06, ax), L.smoothstep(0.9, 0.7, y) * L.smoothstep(0.03, 0.1, ax) * 0.8)
        knee = L.smoothstep(0.47, 0.39, y)
        ankle = L.smoothstep(0.1, 0.05, y)
        for side, sign in (('L', -1), ('R', 1)):
            mine = (np.sign(x) == sign).astype(float)
            out[f'thigh{side}'] += leg * mine * (1 - knee)
            out[f'shin{side}'] += leg * mine * knee * (1 - ankle)
            out[f'foot{side}'] += leg * mine * knee * ankle
        trunk = 1 - leg
    elif piece == 'shirt':
        # The sleeve: everything near the arm's axis (x = 0.26) below the armpit; round the shoulder the
        # deltoid blends from the torso. A test on x alone gave the inside of the forearm to the torso.
        axis = np.hypot(ax - 0.26, z - 0.005)
        sleeve = L.smoothstep(0.1, 0.078, axis) * L.smoothstep(1.4, 1.3, y)
        arm = np.maximum(sleeve, L.smoothstep(0.17, 0.26, ax) * L.smoothstep(1.47, 1.37, y))
        elbow = L.smoothstep(1.1, 1.02, y)
        for side, sign in (('L', -1), ('R', 1)):
            mine = (np.sign(x) == sign).astype(float)
            out[f'upper{side}'] += arm * mine * (1 - elbow)
            out[f'fore{side}'] += arm * mine * elbow
        trunk = 1 - arm
    spine_up = L.smoothstep(0.95, 1.1, y)
    chest = L.smoothstep(1.15, 1.3, y)
    neck = L.smoothstep(1.5, 1.6, y)
    out['hips'] += trunk * (1 - spine_up)
    out['torso'] += trunk * spine_up * (1 - chest)
    out['chest'] += trunk * spine_up * chest * (1 - neck)
    out['head'] += trunk * neck
    return {k: v for k, v in out.items() if v.any()}


# ------------------------------------------------------------------ fitting

def fit(p, w, weights):
    """
    Move width-1 points (game space) to a body of width `w`, each by its
    bones' share (`weights`, bone -> array): the trunk widens about the
    centre line (the head does not), and the limbs move out with their
    joints (shoulders at 0.26 w, hips at 0.13 w), thickening by w^0.4.
    """
    if abs(w - 1) < 1e-6:
        return p.copy()
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ax, s = np.abs(x), np.sign(x)
    thick = w ** 0.4
    nx, nz = np.zeros(len(p)), np.zeros(len(p))
    total = np.zeros(len(p))
    for bone, wt in weights.items():
        if bone.startswith(('upper', 'fore', 'shoulder')):
            bx, bz = s * (0.26 * w + (ax - 0.26) * thick), z * thick
        elif bone.startswith(('thigh', 'shin', 'foot')):
            bx, bz = s * (0.13 * w + (ax - 0.13) * thick), z * thick
        elif bone in ('head', 'shield'):
            bx, bz = x, z
        else:
            bx, bz = x * w, z * (0.55 + 0.45 * w)
        nx += wt * bx
        nz += wt * bz
        total += wt
    return np.stack([nx / total, y, nz / total], axis=1)

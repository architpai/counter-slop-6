"""
The gloved hands and sleeves (docs/VISUALS.md, R4 and V13): one right hand
in a rest pose, baked once into the `hands` texture set, then posed per
weapon by `pose()` (the weapon scripts import this module).

Rest pose: wrist at the origin, fingers along +Y, palm facing -Z, thumb on
the -X side, the forearm running back along -Y. The glove is soft parts
(palm, thenar, fingers, thumb, cuff) fused by a voxel remesh and decimated,
plus hard parts (knuckle guard, finger pads, wrist strap) and a fitted sleeve
that stops behind the glove's cuff, so the camera sees the whole hand.

Posing is linear-blend skinning in numpy over a small bone set (forearm,
hand, three bones a finger and three for the thumb), with weights computed
here from each vertex's place along the finger and thumb chains. Every posed
copy keeps the rest mesh's UVs, so all hands share one atlas; a left hand is
the posed right one mirrored.

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/hands.py -- [--preview] [--quick]
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

# Knuckle (MCP) position, splay (degrees about Z), phalanx lengths, radius.
FINGERS = {
    'index': ((-0.0285, 0.090, 0.001), -5.0, (0.044, 0.026, 0.022), 0.0100),
    'middle': ((-0.0090, 0.095, 0.002), -1.0, (0.049, 0.030, 0.023), 0.0104),
    'ring': ((0.0105, 0.092, 0.001), 4.0, (0.046, 0.028, 0.022), 0.0098),
    'pinky': ((0.0280, 0.084, -0.002), 10.0, (0.036, 0.022, 0.019), 0.0087),
}
# Thumb joints: CMC, MCP, IP, tip; radii at each.
THUMB = [(-0.020, 0.018, -0.011), (-0.047, 0.047, -0.021), (-0.061, 0.074, -0.025), (-0.069, 0.097, -0.027)]
THUMB_R = [0.0150, 0.0122, 0.0112, 0.0100]
BUILD = os.path.join(lib.DEFAULT_OUT, 'hands')
BLEND = os.path.join(BUILD, 'hands.blend')


# ---------------------------------------------------------------- bones

def _frame(y, z_hint):
    """A bone frame: columns x (the curl axis), y (along the bone), z (the back of the finger)."""
    y = Vector(y).normalized()
    z = (Vector(z_hint) - y * y.dot(Vector(z_hint))).normalized()
    x = y.cross(z).normalized()
    return Matrix((x, y, z)).transposed()


def bones():
    """[(name, parent, head, rest frame 3x3)], parents first."""
    out = [('forearm', None, Vector((0, -0.30, 0)), _frame((0, 1, 0), (0, 0, 1))),
           ('hand', 'forearm', Vector((0, 0, 0)), _frame((0, 1, 0), (0, 0, 1)))]
    for name, (knuckle, splay, lengths, _r) in FINGERS.items():
        _k, d, _l = finger_axis(name)
        head, parent = Vector(knuckle), 'hand'
        for i, length in enumerate(lengths):
            out.append((f'{name}{i + 1}', parent, head.copy(), _frame(d, (0, 0, 1))))
            head = head + d * length
            parent = f'{name}{i + 1}'
    parent = 'hand'
    for i in range(3):
        a, b = Vector(THUMB[i]), Vector(THUMB[i + 1])
        # The thumb's nail faces out and up, about 50 degrees from the back of the hand.
        out.append((f'thumb{i + 1}', parent, a, _frame(b - a, (-0.62, 0.0, 0.78))))
        parent = f'thumb{i + 1}'
    return out


def finger_axis(name):
    knuckle, splay, lengths, _r = FINGERS[name]
    d = Vector((math.sin(math.radians(splay)), math.cos(math.radians(splay)), 0)).normalized()
    return Vector(knuckle), d, lengths


# ---------------------------------------------------------------- rest mesh

def _uv_sphere(name, centre, radii, exponent=(1, 1, 1), segments=24, rings=16, taper=None):
    """A super-ellipsoid: exponents under 1 square it off. `taper(y)` scales x along y."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    for v in bm.verts:
        c = [math.copysign(abs(v.co[i]) ** exponent[i], v.co[i]) for i in range(3)]
        x, y, z = c[0] * radii[0], c[1] * radii[1], c[2] * radii[2]
        if taper:
            x *= taper(y)
        v.co = Vector(centre) + Vector((x, y, z))
    return lib._object(name, bm)


def _capsule_chain(name, points, radii, segments=16):
    """A tube through `points` with rounded ends, radius varying per point (a finger or the thumb)."""
    bm = bmesh.new()
    rings = []
    pts = [Vector(p) for p in points]
    for i, (p, r) in enumerate(zip(pts, radii)):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 1e-6:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(d).normalized()
        ring = [bm.verts.new(p + (side * math.cos(TAU * k / segments) + up * math.sin(TAU * k / segments)) * r) for k in range(segments)]
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segments):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % segments], r0[(k + 1) % segments]))
    for end, ring, sign in ((pts[-1], rings[-1], 1), (pts[0], rings[0], -1)):
        d = (pts[-1] - pts[-2]).normalized() if sign > 0 else (pts[0] - pts[1]).normalized()
        tip = bm.verts.new(end + d * radii[-1 if sign > 0 else 0] * 0.9)
        for k in range(segments):
            a, b = ring[k], ring[(k + 1) % segments]
            bm.faces.new((a, b, tip) if sign > 0 else (b, a, tip))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib._object(name, bm)


TAU = lib.TAU


def _soft_parts():
    parts = []
    # Palm: a squared-off ellipsoid, narrower at the wrist.
    parts.append(_uv_sphere('palm', (0.0, 0.050, -0.001), (0.036, 0.050, 0.0135), (0.45, 0.55, 0.85),
                            taper=lambda y: 0.86 + 0.28 * (y / 0.05 + 1) / 2))
    parts.append(_uv_sphere('thenar', (-0.021, 0.034, -0.009), (0.016, 0.026, 0.0115), (0.9, 0.9, 0.9)))
    parts.append(_uv_sphere('hypothenar', (0.026, 0.040, -0.006), (0.012, 0.030, 0.011), (0.9, 0.9, 0.9)))
    for name in FINGERS:
        knuckle, d, lengths = finger_axis(name)
        r = FINGERS[name][3]
        pts, radii = [knuckle - d * 0.012], [r * 1.15]
        head = knuckle.copy()
        pts.append(head.copy())
        radii.append(r * 1.12)
        for i, length in enumerate(lengths):
            mid = head + d * (length * 0.5)
            head = head + d * length
            pts.append(mid)
            radii.append(r * (1.0 - 0.06 * i))
            pts.append(head.copy())
            radii.append(r * (1.04 - 0.07 * i) if i < 2 else r * 0.84)
        pts[-1] = pts[-1] - d * r * 0.7
        parts.append(_capsule_chain(name, pts, radii))
    parts.append(_capsule_chain('thumb', [Vector(THUMB[0]) + Vector((0.004, -0.006, 0.002)), *THUMB[:3], Vector(THUMB[3]) - (Vector(THUMB[3]) - Vector(THUMB[2])).normalized() * 0.008],
                                [0.016, *THUMB_R[:3], THUMB_R[3] * 0.92]))
    # Glove cuff, over the wrist.
    parts.append(lib.lathe('cuff', [(-0.078, 0.036), (-0.05, 0.034), (-0.02, 0.031), (0.004, 0.031), (0.022, 0.034)], 28, 'Y', scale=(1, 0.66)))
    return parts


def _hard_parts():
    parts = []
    # Knuckle guard: a moulded plate over the four knuckles, arched along them.
    guard = lib.box('knuckle-guard', (0.074, 0.022, 0.006), (0.0, 0.089, 0.0155))
    bm = bmesh.new()
    bm.from_mesh(guard.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        # Follow the knuckle arch: the middle knuckle stands proudest.
        v.co.z -= 4 * v.co.x ** 2
        v.co.y -= 8 * v.co.x ** 2
    bm.to_mesh(guard.data)
    bm.free()
    lib.bevel(guard, 0.0018, 1, 30)
    lib.apply_all(guard)
    lib.bake_transform(guard)
    parts.append(guard)
    for name in FINGERS:
        knuckle, d, lengths = finger_axis(name)
        r = FINGERS[name][3]
        centre = knuckle + d * (lengths[0] * 0.55) + Vector((0, 0, r * 0.95))
        pad = lib.box(f'{name}-pad', (r * 1.3, lengths[0] * 0.55, 0.003), (0, 0, 0))
        lib.bevel(pad, 0.0012, 1, 30)
        lib.apply_all(pad)
        lib.transform(pad, location=centre, rotation=(0, 0, math.atan2(-d.x, d.y)))
        pad.location = (0, 0, 0)
        parts.append(pad)
    strap = lib.lathe('strap', [(-0.062, 0.0355), (-0.038, 0.0355)], 24, 'Y', scale=(1.02, 0.7))
    lib.bevel(strap, 0.0012, 1, 30)
    lib.apply_all(strap)
    parts.append(strap)
    return parts


def _sleeve():
    # A fitted sleeve from behind the glove's cuff to past the elbow, with shallow folds.
    s = lib.lathe('sleeve', [(-0.36, 0.047), (-0.25, 0.046), (-0.16, 0.043), (-0.10, 0.040), (-0.075, 0.0395)], 20, 'Y', scale=(1, 0.8))
    bm = bmesh.new()
    bm.from_mesh(s.data)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.y - e.verts[1].co.y) > 1e-4], cuts=2)
    rng = np.random.default_rng(7)
    phases = rng.uniform(0, TAU, 6)
    for v in bm.verts:
        a = math.atan2(v.co.z, v.co.x)
        fold = sum(math.sin(3 * a + phases[k] + v.co.y * (40 + 9 * k)) for k in range(3)) / 3
        radial = Vector((v.co.x, 0, v.co.z))
        if radial.length > 1e-6:
            v.co += radial.normalized() * fold * 0.0018
    bm.to_mesh(s.data)
    bm.free()
    cuff = lib.lathe('sleeve-cuff', [(-0.095, 0.0405), (-0.074, 0.0405), (-0.072, 0.0385)], 20, 'Y', scale=(1, 0.8))
    return s, cuff


def build_rest():
    soft = _soft_parts()
    glove = lib.join('glove', soft)
    m = glove.modifiers.new('remesh', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = 0.0014
    m.use_smooth_shade = True
    lib._apply_modifier(glove, m)
    sm = glove.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 6
    sm.use_only_smooth = True
    lib._apply_modifier(glove, sm)
    dec = glove.modifiers.new('decimate', 'DECIMATE')
    # Enough for a smooth outline where the fist fills the screen's corner (the knife, the pistol at the hip).
    dec.ratio = 3200 / max(1, lib.triangles(glove))
    lib._apply_modifier(glove, dec)
    lib.smooth(glove, 180)
    # Palm side and finger undersides in leather, the back in stretch fabric.
    lib.paint(glove, 'glove')
    glove.data.materials.append(lib.material('glove-palm'))
    for p in glove.data.polygons:
        c, n = p.center, p.normal
        if c.y > -0.004 and n.z < -0.25:
            p.material_index = 1
    hard = _hard_parts()
    for h in hard:
        lib.paint(h, 'glove-pad')
    sleeve, cuff = _sleeve()
    lib.paint(sleeve, 'sleeve')
    lib.paint(cuff, 'sleeve-cuff')
    lib.smooth(sleeve, 180)
    lib.smooth(cuff, 50)
    hand = lib.join('hand-rest', [glove, *hard, sleeve, cuff])
    _weights(hand)
    hand['bones'] = json.dumps([(n, p, list(h), [list(r) for r in f]) for n, p, h, f in bones()])
    return hand


# ---------------------------------------------------------------- weights

def _smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _chain_weights(p, joints, blend):
    """Weights of the segments of a joint chain for points `p` (N x 3), by projection along it, blended at each inner joint."""
    joints = [np.array(j) for j in joints]
    # Arc length of each point's projection on the chain.
    seg_len = [np.linalg.norm(b - a) for a, b in zip(joints, joints[1:])]
    starts = np.cumsum([0] + seg_len)
    best_s, best_d = np.zeros(len(p)), np.full(len(p), np.inf)
    for i, (a, b) in enumerate(zip(joints, joints[1:])):
        ab = b - a
        t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
        better = d < best_d
        best_d = np.where(better, d, best_d)
        best_s = np.where(better, starts[i] + t * seg_len[i], best_s)
    w = np.zeros((len(p), len(seg_len)))
    for i in range(len(seg_len)):
        lo = 0.0 if i == 0 else _smoothstep(starts[i] - blend, starts[i] + blend, best_s)
        hi = 1.0 if i == len(seg_len) - 1 else 1 - _smoothstep(starts[i + 1] - blend, starts[i + 1] + blend, best_s)
        w[:, i] = lo * hi if i > 0 else hi
    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
    return w, best_d, best_s


def _weights(obj):
    p = np.array([v.co[:] for v in obj.data.vertices])
    names = [b[0] for b in bones()]
    W = np.zeros((len(p), len(names)))
    col = {n: i for i, n in enumerate(names)}
    # Forearm and hand, blended over the wrist.
    to_hand = _smoothstep(-0.014, 0.012, p[:, 1])
    finger_d, finger_w, finger_idx = [], [], []
    for name in FINGERS:
        knuckle, d, lengths = finger_axis(name)
        joints = [knuckle]
        for length in lengths:
            joints.append(joints[-1] + d * length)
        w, dist, _s = _chain_weights(p, [tuple(j) for j in joints], 0.004)
        along = (p - np.array(knuckle)) @ np.array(d)
        # Behind the knuckle a point belongs to the palm, blended over about a centimetre.
        own = _smoothstep(-0.011, 0.002, along)
        finger_d.append(dist)
        finger_w.append((w, own))
    finger_d = np.array(finger_d)
    nearest = np.argmin(finger_d, axis=0)
    thumb_w, thumb_d, thumb_s = _chain_weights(p, THUMB, 0.004)
    # The thumb takes points near its chain on the thumb side, fading into the thenar pad.
    thumb_share = _smoothstep(0.024, 0.013, thumb_d) * _smoothstep(-0.008, -0.022, p[:, 0] - (p[:, 1] - 0.02) * 0.3)
    thumb_share *= np.where(finger_d.min(axis=0) < thumb_d, 0.0, 1.0)
    thumb_share *= _smoothstep(0.004, 0.018, thumb_s)
    for i, name in enumerate(FINGERS):
        w, own = finger_w[i]
        mask = (nearest == i).astype(float) * own * (1 - thumb_share)
        for k in range(3):
            W[:, col[f'{name}{k + 1}']] = w[:, k] * mask * to_hand
    for k in range(3):
        W[:, col[f'thumb{k + 1}']] = thumb_w[:, k] * thumb_share * to_hand
    rest = 1 - W.sum(axis=1)
    W[:, col['hand']] = rest * to_hand
    W[:, col['forearm']] += 1 - to_hand
    W /= W.sum(axis=1, keepdims=True)
    for n in names:
        obj.vertex_groups.new(name=n)
    for vi in range(len(p)):
        for bi in np.nonzero(W[vi] > 1e-4)[0]:
            obj.vertex_groups[names[bi]].add([vi], float(W[vi, bi]), 'REPLACE')


# ------------------------------------------------------------------ posing

def _rot(euler):
    return Euler(euler, 'XYZ').to_matrix().to_4x4()


def pose(rest, name, spec, side='R'):
    """
    A posed copy of the rest hand. `spec` sets local rotations (radians) per
    bone: 'hand' (x flexes the wrist, y twists, z deviates), each finger's
    `curl` (three angles, positive towards the palm) and `splay`, and
    'thumb' as three (x, y, z) Euler rotations. The copy's mesh is in the
    rest hand's space (wrist at the origin); place it with the object
    transform. `side='L'` mirrors it into a left hand.
    """
    defs = [(n, p, Vector(h), Matrix(f)) for n, p, h, f in json.loads(rest['bones'])]
    local = {}
    for n, p, h, f in defs:
        rot = Matrix.Identity(4)
        if n == 'hand':
            wrist = spec.get('hand', (0, 0, 0))
            rot = wrist.to_4x4() if isinstance(wrist, Matrix) else _rot(wrist)
        elif n.startswith('thumb'):
            angles = spec.get('thumb', [(0, 0, 0)] * 3)[int(n[-1]) - 1]
            rot = _rot(angles)
        elif n != 'forearm':
            finger, k = n[:-1], int(n[-1]) - 1
            curl = spec.get(finger, {}).get('curl', (0, 0, 0))[k]
            splay = spec.get(finger, {}).get('splay', 0.0) if k == 0 else 0.0
            rot = _rot((-curl, 0, splay))
        local[n] = rot
    B, P = {}, {}
    for n, p, h, f in defs:
        B[n] = Matrix.Translation(h) @ f.to_4x4()
        if p is None:
            P[n] = B[n] @ local[n]
        else:
            P[n] = P[p] @ (B[p].inverted() @ B[n]) @ local[n]
    skin = {n: P[n] @ B[n].inverted() for n in B}
    me = rest.data.copy()
    me.name = name
    names = [d[0] for d in defs]
    group_bone = {g.index: g.name for g in rest.vertex_groups}
    co = np.array([v.co[:] for v in me.vertices])
    out = np.zeros_like(co)
    mats = {n: np.array(skin[n]) for n in names}
    homo = np.concatenate([co, np.ones((len(co), 1))], axis=1)
    total = np.zeros(len(co))
    for gi, bone in group_bone.items():
        w = np.zeros(len(co))
        for v in rest.data.vertices:
            for g in v.groups:
                if g.group == gi:
                    w[v.index] = g.weight
        if not w.any():
            continue
        out += (homo @ mats[bone].T)[:, :3] * w[:, None]
        total += w
    out /= np.maximum(total, 1e-9)[:, None]
    if side == 'L':
        out[:, 0] *= -1
    me.vertices.foreach_set('co', out.ravel())
    if side == 'L':
        me.flip_normals()
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj['shared'] = True
    obj['material'] = 'hands'
    return obj


def load():
    """The rest hand from hands.blend (run this script first)."""
    if not os.path.exists(BLEND):
        raise FileNotFoundError(f'{BLEND}: run tools/blender/weapons/hands.py first')
    with bpy.data.libraries.load(BLEND) as (src, dst):
        dst.objects = ['hand-rest']
    rest = dst.objects[0]
    rest.hide_render = True
    rest.hide_viewport = True
    return rest


def turn(*steps):
    """A rotation from steps applied in order, each (axis, radians) about the weapon's axes: ('Y', pi / 2), ('X', -0.3)."""
    m = Matrix.Identity(3)
    for axis, angle in steps:
        m = Matrix.Rotation(angle, 3, axis) @ m
    return m


def place(obj, weapon, location, rotation, parent=None):
    """Put a posed hand in a weapon: its wrist at `location`, turned by `rotation` (a `turn()` matrix)."""
    obj.parent = parent or weapon.pivot
    obj.matrix_world = Matrix.Translation(Vector(location)) @ rotation.to_4x4()
    return obj


def frame(fingers, back):
    """A hand frame: Y along `fingers` (wrist to knuckles), Z out of the back of the hand, X = Y x Z."""
    y = Vector(fingers).normalized()
    z = Vector(back)
    z = (z - y * y.dot(z)).normalized()
    return Matrix((y.cross(z), y, z)).transposed()


MIRROR = Matrix.Diagonal((-1, 1, 1))


def _frames(fingers, back, forearm, side):
    """The hand's frame and the forearm's, in the right hand's space (a left hand's directions mirrored)."""
    m = MIRROR if side == 'L' else Matrix.Identity(3)
    hand_frame = frame(m @ Vector(fingers), m @ Vector(back))
    arm_y = -(m @ Vector(forearm)).normalized()
    # The forearm keeps the hand's back as its up, as far as its direction allows.
    return hand_frame, frame(arm_y, hand_frame.col[2])


def _placed(wrist, rotation, side):
    """The node's world matrix for a wrist point and a frame given in the right hand's space."""
    m = MIRROR if side == 'L' else Matrix.Identity(3)
    placed = Matrix.Translation(m @ Vector(wrist)) @ rotation.to_4x4()
    if side == 'L':
        placed = MIRROR.to_4x4() @ placed @ MIRROR.to_4x4()
    return placed


def hand(weapon, part, spec, wrist, fingers, back, forearm, side='R', parent=None):
    """
    Pose a hand and register it as the weapon's `part` (right-hand,
    left-hand), from what it should do in the weapon's space: the wrist
    point, the direction from the wrist to the knuckles, the direction the
    back of the hand faces, and the direction from the wrist to the elbow.
    The wrist bend comes out of those; `spec` sets the fingers and thumb.
    A left hand is given as it really is and built as the mirror image of a
    right hand, so every hand shares the one atlas.
    """
    rest = bpy.data.objects.get('hand-rest') or load()
    hand_frame, arm = _frames(fingers, back, forearm, side)
    posed = dict(spec)
    posed['hand'] = arm.inverted() @ hand_frame
    obj = pose(rest, weapon.node(part), posed, side)
    obj.parent = parent or weapon.pivot
    obj.matrix_world = _placed(wrist, arm, side)
    obj['bend'] = [x for row in posed['hand'] for x in row]
    obj['side'] = side
    weapon.parts[part] = obj
    return obj


def basis(weapon, part, wrist, fingers, back, forearm):
    """
    The node values (location, rotation) that put a posed hand's palm and
    fingers where a hand given by these arguments would be (as `hand()` takes
    them), fingers as posed. Clips key a hand's other holds from it (lib.Clip
    `base`), so its grip can change without moving them.
    """
    obj = weapon.parts[part]
    hand_frame, _arm = _frames(fingers, back, forearm, obj['side'])
    rest = obj.matrix_basis.copy()
    obj.matrix_world = _placed(wrist, hand_frame @ Matrix([obj['bend'][i:i + 3] for i in (0, 3, 6)]).inverted(), obj['side'])
    location, rotation = obj.location.copy(), obj.rotation_euler.copy()
    obj.matrix_basis = rest
    rotation.make_compatible(obj.rotation_euler)
    return location, rotation


def palm(obj, matrix):
    """A matrix in a posed hand's own frame (+Y to the knuckles, -Z out of the palm) in its node's space, for what the hand holds."""
    bend = Matrix([obj['bend'][i:i + 3] for i in (0, 3, 6)]).to_4x4()
    if obj['side'] == 'L':
        bend = MIRROR.to_4x4() @ bend @ MIRROR.to_4x4()
    return bend @ matrix


# ------------------------------------------------------------------- main

GRIP_TEST = {
    'hand': (0.0, 0.0, 0.0),
    'index': {'curl': (1.25, 1.35, 0.7)}, 'middle': {'curl': (1.35, 1.45, 0.75)},
    'ring': {'curl': (1.4, 1.45, 0.75)}, 'pinky': {'curl': (1.45, 1.4, 0.75)},
    'thumb': [(0.3, 0.2, -0.5), (0.4, 0, 0), (0.5, 0, 0)],
}


def main():
    opts = lib.options()
    lib.reset()
    hand = build_rest()
    print(f'hands: rest hand {lib.triangles(hand)} tris')
    os.makedirs(BUILD, exist_ok=True)
    lib.unwrap([hand], margin=0.004)
    lib.bake('hands', [hand], opts)
    # The bake target images are not saved; drop their nodes so the weapon scripts load cleanly.
    for m in hand.data.materials:
        target = m.node_tree.nodes.get('TARGET')
        if target:
            m.node_tree.nodes.remove(target)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    with open(os.path.join(BUILD, 'meta.json'), 'w') as f:
        json.dump({'set': 'hands', 'triangles': lib.triangles(hand)}, f, indent=1)
    if opts['preview']:
        for label, spec in (('rest', {}), ('grip', GRIP_TEST)):
            posed = pose(hand, f'hand-{label}', spec)
            for m in hand.data.materials:
                posed.data.materials.append(m)
            hand.hide_render = True
            w = lib.Weapon(f'preview-{label}')
            posed.parent = w.pivot
            w.root.rotation_euler = (0, 0, 0)
            lib.preview(os.path.join(BUILD, f'preview-{label}'), [w], views=('top', 'side', 'front', 'bottom'), ortho=0.26, centre=(0, 0.02, 0))
            bpy.data.objects.remove(posed)


if __name__ == '__main__':
    main()

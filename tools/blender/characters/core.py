"""
Shared building blocks for the realistic operators (docs/VISUALS.md, R7).

The characters are built in the game's own coordinates (metres, +Y up, +Z
forward; `G()` turns a game point into Blender's, where +Z is up and the
figure faces -Y), from:

- soft shapes (the clothed body, the head, boots, pouches, the hood) as
  signed distance fields meshed by surface nets (sdf.py), smoothed and
  decimated;
- hard shapes (plates, buckles, helmets, shields, machines) from the weapon
  scripts' helpers (tools/blender/weapons/lib.py: profiles, lathes, boxes,
  bevels, booleans).

Every piece is made once in a canonical form, unwrapped into its texture
set's atlas and baked there; each kind wears copies of the canonical pieces
(their UVs kept), fitted to its build (`Fit`) and coloured by vertex colour.
The atlas holds a neutral finish (fabric weave, folds, seams, wear, grime,
roughness and metal); the vertex colour gives each role its kit colours, so
one atlas serves every kind (docs/VISUALS.md, V3).

Rig: an armature per kind whose bones sit on the game's pivots
(render/figure.ts) and point up with no roll, so a bone's frame is the
pivot's and the glTF joints come out as pure translations; a clip's key is
the pivot-space rotation the game composes onto its own pose.
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# The weapon scripts' helpers (tools/blender/weapons/lib.py), as `lib`, which hands.py imports too.
sys.path.insert(0, os.path.join(HERE, '..', 'weapons'))
sys.path.insert(0, HERE)
import lib as W  # noqa: E402
import sdf as S  # noqa: E402

ROOT = W.ROOT
DEFAULT_OUT = os.path.join(ROOT, 'tools', 'characters', '.build')
FPS = 30
TAU = W.TAU
SIZES = W.SIZES


def options():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'out': DEFAULT_OUT, 'preview': '--preview' in argv, 'quick': '--quick' in argv, 'size': SIZES[0],
            'bake': '--no-bake' not in argv, 'only': []}
    for i, arg in enumerate(argv):
        if arg == '--out':
            opts['out'] = os.path.abspath(argv[i + 1])
        elif arg == '--size':
            opts['size'] = int(argv[i + 1])
        elif arg == '--only':
            opts['only'] = argv[i + 1].split(',')
    return opts


def reset():
    scene = W.reset()
    scene.render.fps = FPS
    return scene


def G(x, y=None, z=None):
    """A game point (x, y up, z forward) in Blender's axes."""
    if y is None:
        x, y, z = x
    return Vector((x, -z, y))


def to_game(v):
    return (v[0], v[2], -v[1])


def srgb(hex_colour):
    return W.srgb(hex_colour)


# ------------------------------------------------------------------ finishes

# A finish is the neutral surface a piece is baked in: the kind's colour comes
# from the vertex colour, which multiplies the atlas. `base` is the grey the
# atlas holds where the surface is clean (so a vertex colour of c / base gives
# colour c there); wear lightens towards `worn`, grime darkens cavities.
# `pattern` is the bump detail in object space; `folds` adds cloth creases.
BASE = 0.8
FINISHES = {
    # Combat shirt and trousers: ripstop (a 5 mm reinforcing grid in a fine weave), folds baked in.
    'ripstop': dict(base=BASE, rough=0.86, metal=0.0, worn=0.95, worn_rough=0.8, wear=0.25, grime=0.55, pattern='ripstop', bump=0.00035, folds=True),
    # Plate carriers, pouches, belts: 500D nylon, stiffer and a little glossier.
    'cordura': dict(base=BASE, rough=0.74, metal=0.0, worn=0.97, worn_rough=0.68, wear=0.45, grime=0.6, pattern='cordura', bump=0.00022),
    'webbing': dict(base=BASE, rough=0.7, metal=0.0, worn=0.95, worn_rough=0.64, wear=0.4, grime=0.55, pattern='webbing', bump=0.0003),
    # Balaclavas and hoods: a knit.
    'knit': dict(base=BASE, rough=0.92, metal=0.0, worn=0.9, worn_rough=0.9, wear=0.15, grime=0.4, pattern='knit', bump=0.0004),
    'canvas': dict(base=BASE, rough=0.9, metal=0.0, worn=0.95, worn_rough=0.85, wear=0.3, grime=0.6, pattern='canvas', bump=0.0005, folds=True),
    # Boots: leather uppers, rubber soles.
    'leather': dict(base=BASE, rough=0.58, metal=0.0, worn=0.98, worn_rough=0.5, wear=0.5, grime=0.7, pattern='leather', bump=0.0003),
    'sole': dict(base=BASE, rough=0.9, metal=0.0, worn=0.9, worn_rough=0.85, wear=0.25, grime=0.75, pattern='rubber', bump=0.0002),
    'glove': dict(base=BASE, rough=0.78, metal=0.0, worn=0.95, worn_rough=0.7, wear=0.35, grime=0.5, pattern='weave', bump=0.00014),
    # Helmets, plates, shields, pads: painted or moulded polymer, bevel wear showing a lighter under-layer.
    'polymer': dict(base=BASE, rough=0.6, metal=0.0, worn=1.0, worn_rough=0.5, wear=0.55, grime=0.55, pattern='cast', bump=0.00004),
    'rubber': dict(base=BASE, rough=0.86, metal=0.0, worn=0.92, worn_rough=0.7, wear=0.2, grime=0.45, pattern='rubber', bump=0.00008),
    'paint': dict(base=BASE, rough=0.48, metal=0.0, worn=1.0, worn_rough=0.4, wear=0.6, grime=0.55, pattern='cast', bump=0.00003),
    # Clown masks: glazed ceramic-like plastic, worn at the rims.
    'mask': dict(base=0.94, rough=0.4, metal=0.0, worn=1.0, worn_rough=0.32, wear=0.3, grime=0.22, pattern='pores', bump=0.00006),
    'decal': dict(base=0.9, rough=0.42, metal=0.0, worn=1.0, worn_rough=0.4, wear=0.0, grime=0.0, pattern=None, bump=0.0),
    # Hardware and machines.
    'metal': dict(base=BASE, rough=0.38, metal=1.0, worn=1.0, worn_rough=0.25, wear=0.4, grime=0.6, pattern='cast', bump=0.00001),
    'steel': dict(base=BASE, rough=0.45, metal=0.0, worn=1.0, worn_rough=0.3, wear=0.7, grime=0.6, pattern='cast', bump=0.00002, worn_metal=1.0),
    'lens': dict(base=0.25, rough=0.08, metal=0.0, worn=0.25, worn_rough=0.08, wear=0.0, grime=0.0, pattern=None, bump=0.0),
    'glow': dict(base=1.0, rough=0.4, metal=0.0, worn=1.0, worn_rough=0.4, wear=0.0, grime=0.0, pattern=None, bump=0.0),
    'ghillie': dict(base=BASE, rough=0.95, metal=0.0, worn=0.9, worn_rough=0.95, wear=0.2, grime=0.6, pattern='ghillie', bump=0.0012),
}


def _nodes(mat):
    return mat.node_tree.nodes, mat.node_tree.links


def material(finish):
    """The Cycles graph for a finish (as the weapons' `lib.material`, with the reroutes the bake reads)."""
    if finish in bpy.data.materials:
        return bpy.data.materials[finish]
    spec = FINISHES[finish]
    mat = bpy.data.materials.new(finish)
    mat.use_nodes = True
    nodes, links = _nodes(mat)
    nodes.clear()

    def node(kind, **props):
        n = nodes.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def op(kind, a, b=0.0, clamp=False):
        n = node('ShaderNodeMath', operation=kind, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def ramp(v, a, b, c=0.0, d=1.0):
        n = node('ShaderNodeMapRange', clamp=True)
        links.new(v, n.inputs['Value'])
        n.inputs['From Min'].default_value, n.inputs['From Max'].default_value = a, b
        n.inputs['To Min'].default_value, n.inputs['To Max'].default_value = c, d
        return n.outputs['Result']

    def mix(fac, a, b, kind='FLOAT'):
        n = node('ShaderNodeMix', data_type=kind, clamp_factor=True)
        ins = {s.identifier: s for s in n.inputs}
        suffix = 'Float' if kind == 'FLOAT' else 'Color'
        for key, v in (('Factor_Float', fac), (f'A_{suffix}', a), (f'B_{suffix}', b)):
            if isinstance(v, bpy.types.NodeSocket):
                links.new(v, ins[key])
            else:
                ins[key].default_value = (*v, 1.0) if kind == 'RGBA' and isinstance(v, tuple) else v
        return next(s for s in n.outputs if s.identifier == f'Result_{suffix}')

    coord = node('ShaderNodeTexCoord')
    xyz = node('ShaderNodeSeparateXYZ')
    links.new(coord.outputs['Object'], xyz.inputs[0])

    def vec(stretch=(1, 1, 1), offset=(0, 0, 0)):
        m = node('ShaderNodeMapping')
        links.new(coord.outputs['Object'], m.inputs['Vector'])
        m.inputs['Scale'].default_value = stretch
        m.inputs['Location'].default_value = offset
        return m.outputs[0]

    def noise(scale, detail=4.0, rough=0.55, stretch=(1, 1, 1), distortion=0.0, offset=(0, 0, 0)):
        n = node('ShaderNodeTexNoise', noise_dimensions='3D')
        links.new(vec(stretch, offset), n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distortion
        return n.outputs['Fac']

    def wave(scale, direction='X', profile='SIN', distortion=0.0, stretch=(1, 1, 1)):
        n = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction=direction, wave_profile=profile)
        links.new(vec(stretch), n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Distortion'].default_value = distortion
        return n.outputs['Fac']

    out = node('ShaderNodeOutputMaterial', name='OUT')
    bsdf = node('ShaderNodeBsdfPrincipled', name='BSDF')
    node('ShaderNodeEmission', name='EMIT')
    geometry = node('ShaderNodeNewGeometry')
    wide = node('ShaderNodeBevel', samples=12)
    wide.inputs['Radius'].default_value = 0.004
    dot = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    links.new(wide.outputs['Normal'], dot.inputs[0])
    links.new(geometry.outputs['Normal'], dot.inputs[1])
    edge = ramp(op('SUBTRACT', 1.0, dot.outputs['Value']), 0.004, 0.08)
    ao = node('ShaderNodeAmbientOcclusion', samples=16, only_local=True)
    ao.inputs['Distance'].default_value = 0.012
    cavity = ramp(ao.outputs['AO'], 0.95, 0.35)
    breakup = noise(40, 6, 0.6)
    speck = noise(500, 3, 0.5)
    wear = op('MULTIPLY', ramp(op('SUBTRACT', op('MULTIPLY', edge, 1.4), op('MULTIPLY', breakup, 0.9)), 0.0, 0.35), spec['wear'])
    grime = op('MULTIPLY', cavity, spec['grime'])
    # Dust and mud rise from the ground: the lower legs and boots dirtier than the chest (game y is Blender z).
    ground = ramp(xyz.outputs['Z'], 0.55, 0.0, 0.0, 1.0)
    dirt = op('MULTIPLY', op('MULTIPLY', ground, ramp(noise(9, 5, 0.65), 0.35, 0.7)), 0.45 if spec['grime'] else 0.0)

    base = spec['base']
    tone = ramp(breakup, 0.25, 0.75, 0.9, 1.08)
    fade = ramp(noise(3.5, 3, 0.5), 0.3, 0.7, 0.94, 1.04)
    shade = op('MULTIPLY', op('MULTIPLY', tone, fade), base)
    albedo_v = mix(wear, shade, spec['worn'])
    albedo_v = mix(op('MULTIPLY', grime, 0.8), albedo_v, base * 0.55)
    albedo_grey = node('ShaderNodeCombineColor')
    for i in range(3):
        links.new(albedo_v, albedo_grey.inputs[i])
    # Dirt is warm: a brown-grey film, not plain darkening.
    albedo = mix(dirt, albedo_grey.outputs[0], (0.42, 0.36, 0.28), 'RGBA')

    rough = op('ADD', spec['rough'], op('MULTIPLY', op('SUBTRACT', speck, 0.5), 0.1))
    rough = mix(wear, rough, spec['worn_rough'])
    rough = op('ADD', rough, op('MULTIPLY', op('ADD', grime, dirt), 0.1), clamp=True)
    metal = mix(wear, spec['metal'], spec.get('worn_metal', spec['metal']))

    pattern = spec['pattern']
    height = None
    folded = None
    if pattern == 'ripstop':
        # A plain weave and a reinforcing grid every 5 mm.
        grid = op('MAXIMUM', ramp(wave(1256, 'X', 'TRI'), 0.9, 1.0), ramp(wave(1256, 'Z', 'TRI'), 0.9, 1.0))
        weave = op('MULTIPLY', wave(5000, 'X', 'SIN'), wave(5000, 'Z', 'SIN'))
        height = op('ADD', op('MULTIPLY', grid, 0.6), op('ADD', op('MULTIPLY', weave, 0.25), op('MULTIPLY', noise(90, 4, 0.6), 0.4)))
    elif pattern == 'cordura':
        weave = op('MULTIPLY', wave(3000, 'X', 'SIN'), wave(3000, 'Z', 'SIN'))
        height = op('ADD', weave, op('MULTIPLY', noise(120, 4, 0.6), 0.5))
    elif pattern == 'webbing':
        height = op('ADD', wave(2200, 'Z', 'SIN', 1.0), op('MULTIPLY', noise(160, 3, 0.5), 0.4))
    elif pattern == 'knit':
        rib = wave(700, 'X', 'SIN', 2.0)
        height = op('ADD', rib, op('MULTIPLY', noise(260, 4, 0.6), 0.6))
    elif pattern == 'canvas':
        height = op('ADD', op('MULTIPLY', wave(1800, 'X', 'SIN'), wave(1800, 'Z', 'SIN')), op('MULTIPLY', noise(60, 5, 0.6), 0.8))
    elif pattern == 'ghillie':
        # Jute strands: stretched noise in every direction, deep.
        height = op('ADD', noise(30, 6, 0.7, (1, 1, 4), 2.0), op('MULTIPLY', noise(90, 5, 0.7, (4, 1, 1), 2.0), 0.7))
    elif pattern == 'leather':
        v = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='DISTANCE_TO_EDGE')
        links.new(coord.outputs['Object'], v.inputs['Vector'])
        v.inputs['Scale'].default_value = 400
        height = op('ADD', ramp(v.outputs['Distance'], 0.0, 0.08), op('MULTIPLY', noise(80, 4, 0.6), 0.8))
    elif pattern == 'weave':
        height = op('ADD', op('MULTIPLY', wave(600, 'X', 'SIN', 0.4), wave(600, 'Y', 'SIN', 0.4)), op('MULTIPLY', noise(160, 4, 0.6), 0.8))
    elif pattern == 'rubber':
        height = noise(900, 3, 0.5)
    elif pattern == 'pores':
        height = noise(700, 2, 0.5)
    elif pattern == 'cast':
        height = noise(1200, 2, 0.5)

    if spec.get('folds'):
        # Creases where cloth bunches: round the knees, elbows and waist, and down the lower legs where
        # trousers blouse into boots; long drape folds elsewhere. Blender z is game y (height).
        z = xyz.outputs['Z']
        band = lambda centre, width: ramp(op('ABSOLUTE', op('SUBTRACT', z, centre)), width, 0.0)
        bunch = op('MAXIMUM', op('MAXIMUM', band(0.44, 0.09), band(1.06, 0.07)), op('MAXIMUM', band(0.16, 0.08), band(0.98, 0.05)))
        crease = noise(22, 3, 0.5, (0.35, 0.35, 3.2), 1.5)
        drape = noise(8, 3, 0.5, (2.5, 2.5, 0.25), 0.5)
        fold = op('ADD', op('MULTIPLY', op('MULTIPLY', ramp(crease, 0.35, 0.75), bunch), 3.0), op('MULTIPLY', ramp(drape, 0.3, 0.7), 2.0))
        # Seams: the outer and inner leg seams, the shoulders' yoke and the waistband (object space, the w = 1 body).
        x = op('ABSOLUTE', xyz.outputs['X'])
        seam = op('MAXIMUM', ramp(op('ABSOLUTE', op('SUBTRACT', x, 0.205)), 0.0025, 0.0),
                  ramp(op('ABSOLUTE', op('SUBTRACT', z, 1.2)), 0.002, 0.0))
        seam = op('MULTIPLY', seam, ramp(op('ABSOLUTE', xyz.outputs['Y']), 0.02, 0.0))
        fold = op('SUBTRACT', fold, op('MULTIPLY', seam, 1.5))
        height = fold if height is None else op('ADD', op('MULTIPLY', height, 0.08), op('MULTIPLY', fold, 1.0))
        # The folds' valleys and the seams' stitch lines hold shadow: darker in the albedo, so the cloth reads as cloth
        # a few metres off, where the normal map's relief is a pixel or two.
        valley = op('ADD', op('MULTIPLY', op('MULTIPLY', ramp(crease, 0.45, 0.2), bunch), 0.22), op('MULTIPLY', ramp(drape, 0.42, 0.22), 0.1))
        folded = op('MINIMUM', op('ADD', valley, op('MULTIPLY', seam, 0.3)), 0.35)

    fine = node('ShaderNodeBevel', samples=12)
    fine.inputs['Radius'].default_value = 0.0012
    normal = fine.outputs['Normal']
    if height is not None and spec['bump'] > 0:
        bump = node('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 1.0
        bump.inputs['Distance'].default_value = spec['bump'] * (14 if spec.get('folds') else 1)
        links.new(height, bump.inputs['Height'])
        links.new(normal, bump.inputs['Normal'])
        normal = bump.outputs['Normal']
    links.new(normal, bsdf.inputs['Normal'])
    if folded is not None:
        albedo = mix(folded, albedo, (0.0, 0.0, 0.0), 'RGBA')
    for label, socket in (('ALBEDO', albedo), ('ROUGH', rough), ('METAL', metal)):
        r = node('NodeReroute', name=label)
        links.new(socket, r.inputs[0])
    links.new(albedo, bsdf.inputs['Base Color'])
    links.new(rough, bsdf.inputs['Roughness'])
    links.new(metal, bsdf.inputs['Metallic'])
    links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def paint(obj, finish):
    obj.data.materials.clear()
    obj.data.materials.append(material(finish))
    return obj


# ------------------------------------------------------------------ meshes

def obj_from(name, verts, faces, finish=None):
    """A mesh object from game-space vertices and faces."""
    bm = bmesh.new()
    bv = [bm.verts.new(G(*v)) for v in verts]
    for f in faces:
        try:
            bm.faces.new([bv[i] for i in f])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = W._object(name, bm)
    if finish:
        paint(o, finish)
    return o


def soft(name, field, lo, hi, step=0.008, triangles=None, smooth=3, finish=None):
    """A soft shape: the field's zero surface over the game-space box lo..hi, smoothed and decimated to `triangles`."""
    v, q = S.surface_nets(field.evaluate if isinstance(field, S.Field) else field, lo, hi, step)
    o = obj_from(name, v.tolist(), q.tolist())
    if smooth:
        m = o.modifiers.new('smooth', 'SMOOTH')
        m.iterations = smooth
        m.factor = 0.5
        W._apply_modifier(o, m)
    if triangles:
        m = o.modifiers.new('decimate', 'DECIMATE')
        m.ratio = min(1.0, triangles / max(1, W.triangles(o)))
        W._apply_modifier(o, m)
    for p in o.data.polygons:
        p.use_smooth = True
    if finish:
        paint(o, finish)
    return o


def box(name, size, centre, finish=None, rot=(0, 0, 0), bevel=0.004, segments=2):
    """A bevelled box: `size` (x, y, z) and `centre` in game space, turned by `rot` (game Euler XYZ)."""
    o = W.box(name, (size[0], size[2], size[1]), (0, 0, 0))
    if bevel:
        W.bevel(o, bevel, segments, 35)
        W.apply_all(o)
    place(o, centre, rot)
    if finish:
        paint(o, finish)
    return o


def place(o, centre=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Bake a game-space placement into the mesh: rotation (game Euler XYZ) about its origin, then the move."""
    m = game_matrix(centre, rot, scale)
    o.data.transform(m)
    o.data.update()
    return o


def game_matrix(centre=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """A game-space transform as a Blender-space matrix."""
    r = Euler(rot, 'XYZ').to_matrix()
    # Conjugate by the axis change: game (x, y, z) -> Blender (x, -z, y).
    c = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
    m = (c @ r @ c.transposed()).to_4x4()
    if scale is not None:
        s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        m = m @ Matrix.Diagonal((s[0], s[2], s[1], 1))
    return Matrix.Translation(G(*centre)) @ m


def lathe(name, points, centre=(0, 0, 0), axis='y', segments=24, finish=None, scale=(1, 1), rot=(0, 0, 0), closed=False):
    """A surface of revolution about a game axis: [(along, radius), ...]."""
    baxis = {'y': 'Z', 'x': 'X', 'z': 'Y'}[axis]
    pts = [(-a, r) for a, r in points] if axis == 'z' else points
    o = W.lathe(name, pts, segments, baxis, (0, 0, 0), None, None, scale, 0.0, closed)
    W.smooth(o, 40)
    place(o, centre, rot)
    if finish:
        paint(o, finish)
    return o


def tube(name, a, b, r, segments=12, finish=None, caps=True):
    """A cylinder between two game points."""
    A, B = G(*a), G(*b)
    d = B - A
    o = W.lathe(name, [(0.0, r), (d.length, r)] if caps else [(0.0, r), (d.length, r)], segments, 'Z')
    W.smooth(o, 40)
    q = d.to_track_quat('Z', 'Y')
    o.data.transform(Matrix.Translation(A) @ q.to_matrix().to_4x4())
    if finish:
        paint(o, finish)
    return o


def panel(name, outline, depth, finish=None, bevel=0.003, centre=(0, 0, 0), rot=(0, 0, 0), plane='xy', bulge=None):
    """
    A plate: a 2D outline [(u, v), ...] in the game's xy plane (plane='xy',
    facing +z) or zy (plane='zy', facing +x), `depth` thick, bevelled.
    `bulge(u, v)` bends it (a curved chest plate): extra depth along its normal.
    """
    verts, faces = [], []
    n = len(outline)
    for side, zoff in ((0, -depth / 2), (1, depth / 2)):
        for u, v in outline:
            b = bulge(u, v) if bulge else 0.0
            verts.append((u, v, zoff + b) if plane == 'xy' else (zoff + b, v, u))
    faces.append(list(reversed(range(n))))
    faces.append(list(range(n, 2 * n)))
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    o = obj_from(name, verts, faces)
    if bevel:
        W.bevel(o, bevel, 2, 35)
        W.apply_all(o)
    place(o, centre, rot)
    if finish:
        paint(o, finish)
    return o


def curved_panel(name, width, height, depth, radius, finish=None, centre=(0, 0, 0), rot=(0, 0, 0), cols=10, rows=4,
                 taper=None, bevel=0.003):
    """
    A plate bent round a vertical axis `radius` behind it (a chest plate, a
    shield's curve), `width` across and `height` tall, its face towards +z.
    `taper(v)` (v 0..1 bottom to top) scales the width along its height.
    """
    verts, faces = [], []
    for layer, r in enumerate((radius, radius + depth)):
        for j in range(rows + 1):
            v = j / rows
            w = width * (taper(v) if taper else 1.0)
            for i in range(cols + 1):
                u = (i / cols - 0.5) * w
                a = u / radius
                verts.append((math.sin(a) * r, (v - 0.5) * height, math.cos(a) * r - radius - depth))
    per = (rows + 1) * (cols + 1)
    idx = lambda layer, i, j: layer * per + j * (cols + 1) + i
    for j in range(rows):
        for i in range(cols):
            faces.append([idx(1, i, j), idx(1, i + 1, j), idx(1, i + 1, j + 1), idx(1, i, j + 1)])
            faces.append([idx(0, i, j + 1), idx(0, i + 1, j + 1), idx(0, i + 1, j), idx(0, i, j)])
    for j in range(rows):
        faces.append([idx(0, 0, j), idx(1, 0, j), idx(1, 0, j + 1), idx(0, 0, j + 1)])
        faces.append([idx(1, cols, j), idx(0, cols, j), idx(0, cols, j + 1), idx(1, cols, j + 1)])
    for i in range(cols):
        faces.append([idx(0, i + 1, 0), idx(1, i + 1, 0), idx(1, i, 0), idx(0, i, 0)])
        faces.append([idx(1, i + 1, rows), idx(0, i + 1, rows), idx(0, i, rows), idx(1, i, rows)])
    o = obj_from(name, verts, faces)
    if bevel:
        W.bevel(o, bevel, 2, 35)
        W.apply_all(o)
    place(o, centre, rot)
    if finish:
        paint(o, finish)
    return o


def strap(name, points, width, thickness, finish='webbing', normal_hint=(0, 0, 1)):
    """A flat strap along a game-space polyline, `width` across and `thickness` deep, lying on the surface whose normal is `normal_hint`."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    hint = Vector(normal_hint)
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = d.cross(hint).normalized()
        up = side.cross(d).normalized()
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(tuple(p + side * sx * width / 2 + up * sz * thickness / 2))
    for i in range(len(pts) - 1):
        for k in range(4):
            a, b = 4 * i + k, 4 * i + (k + 1) % 4
            faces.append([a, b, b + 4, a + 4])
    faces.append([3, 2, 1, 0])
    n = 4 * (len(pts) - 1)
    faces.append([n, n + 1, n + 2, n + 3])
    o = obj_from(name, verts, faces)
    W.smooth(o, 50)
    if finish:
        paint(o, finish)
    return o


def join(name, objects):
    return W.join(name, [o for o in objects if o is not None])


def mirror_x(o, name=None):
    """A copy mirrored across the game's x = 0 plane (Blender x too), normals kept outward."""
    c = o.copy()
    c.data = o.data.copy()
    W._link(c)
    c.data.transform(Matrix.Diagonal((-1, 1, 1, 1)))
    c.data.flip_normals()
    c.data.update()
    if name:
        c.name = name
    return c


def duplicate(o, name):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    W._link(c)
    for m in list(c.modifiers):
        c.modifiers.remove(m)
    c.vertex_groups.clear()
    return c


def decimate(o, triangles):
    if W.triangles(o) <= triangles:
        return o
    m = o.modifiers.new('decimate', 'DECIMATE')
    m.ratio = triangles / W.triangles(o)
    W._apply_modifier(o, m)
    return o


def triangles(o):
    return W.triangles(o)


# ------------------------------------------------------------------ vertex data

def colour_attr(o):
    me = o.data
    attr = me.color_attributes.get('Col')
    if attr is None:
        attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    return attr


def fx_attr(o):
    me = o.data
    attr = me.attributes.get('_FX')
    if attr is None:
        attr = me.attributes.new('_FX', 'FLOAT', 'POINT')
    return attr


def tint(o, colour, glow=0.0, mark=False, faces=None, light=False):
    """
    Set a piece's vertex colour (an sRGB hex colour; the atlas's neutral base
    is divided out, so the surface shows this colour where it is clean) and
    its `_FX` value: a glow's strength (0..1), or the player's team colour:
    -1 (`mark`) its tone, -0.6 (`mark` and `light`) a light tint of it (the
    team carrier; in -1..1, as the packer quantises it). `faces` limits it to
    some polygon indices.
    """
    lin = srgb(colour) if isinstance(colour, int) else colour
    base = BASE
    for mat in o.data.materials:
        if mat is not None and mat.name in FINISHES:
            base = FINISHES[mat.name]['base']
            break
    c = tuple(min(1.0, x / base) for x in lin) + (1.0,)
    col = colour_attr(o)
    fx = fx_attr(o)
    me = o.data
    polys = me.polygons if faces is None else [me.polygons[i] for i in faces]
    value = (-0.6 if light else -1.0) if mark else float(glow)
    for p in polys:
        for li in p.loop_indices:
            col.data[li].color = c
        for vi in p.vertices:
            fx.data[vi].value = value
    return o


def set_uv_square(o, u0, v0, size):
    """Map every face of `o` into one small square of the atlas (flat decals: paint, stickers)."""
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    for p in me.polygons:
        for k, li in enumerate(p.loop_indices):
            uv[li].uv = (u0 + size * (0.25 + 0.5 * (k % 2)), v0 + size * (0.25 + 0.5 * ((k // 2) % 2)))


# ------------------------------------------------------------------ rig

# The pivots render/figure.ts builds, as (bone, parent, position relative to the parent) per body kind.
# `w` is the kind's body width (enemies/types.ts `bodyWidth`).
def humanoid_bones(w, shield=False):
    bones = [
        ('hips', None, (0, 0.86, 0)),
        ('torso', 'hips', (0, 0.04, 0)),
        ('chest', 'torso', (0, 0.30, 0)),
        ('head', 'torso', (0, 0.62, 0)),
        ('shoulderL', 'torso', (-0.26 * w, 0.46, 0)),
        ('upperL', 'shoulderL', (0, 0, 0)),
        ('foreL', 'upperL', (0, -0.3, 0)),
        ('shoulderR', 'torso', (0.26 * w, 0.46, 0)),
        ('upperR', 'shoulderR', (0, 0, 0)),
        ('foreR', 'upperR', (0, -0.3, 0)),
        ('thighL', 'hips', (-0.13 * w, -0.02, 0)),
        ('shinL', 'thighL', (0, -0.42, 0)),
        ('footL', 'shinL', (0, -0.36, 0.0)),
        ('thighR', 'hips', (0.13 * w, -0.02, 0)),
        ('shinR', 'thighR', (0, -0.42, 0)),
        ('footR', 'shinR', (0, -0.36, 0.0)),
    ]
    if shield:
        bones.append(('shield', 'torso', (-0.17, 0.34, 0.46)))
    return bones


def blob_bones(extra):
    bones = [
        ('hips', None, (0, 0.5, 0)),
        ('torso', 'hips', (0, 0, 0)),
        ('upperL', 'torso', (-0.42, 0.42, 0)),
        ('foreL', 'upperL', (0, -0.26, 0)),
        ('upperR', 'torso', (0.42, 0.42, 0)),
        ('foreR', 'upperR', (0, -0.26, 0)),
        ('thighL', 'hips', (-0.16, -0.06, 0)),
        ('shinL', 'thighL', (0, -0.26, 0)),
        ('thighR', 'hips', (0.16, -0.06, 0)),
        ('shinR', 'thighR', (0, -0.26, 0)),
    ]
    return bones + extra


def flyer_bones(moderator=False, carrier=False):
    bones = [
        ('torso', None, (0, 0.6, 0)),
        ('wingL', 'torso', (-0.48, 0, -0.14)),
        ('wingR', 'torso', (0.48, 0, -0.14)),
        ('tail', 'torso', (0, 0.13, -0.52)),
    ]
    if moderator:
        bones += [('head', 'torso', (0, 0.23, 0.43)), ('equipment-moderator', 'torso', (0, 0, 0))]
    if carrier:
        bones.append(('equipment-carrier', 'torso', (0, 0, 0)))
    return bones


def world_positions(bones):
    at = {}
    for name, parent, pos in bones:
        base = Vector(at[parent]) if parent else Vector((0, 0, 0))
        at[name] = tuple(base + Vector(pos))
    return at


def armature(name, bones):
    """An armature whose bones sit on the pivots, pointing up (game +y) with no roll: bone frames are the game's axes."""
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    at = world_positions(bones)
    with bpy.context.temp_override(active_object=obj, object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        for bone, parent, _pos in bones:
            b = arm.edit_bones.new(f'{name}__{bone}')
            head = G(*at[bone])
            b.head = head
            b.tail = head + Vector((0, 0, 0.05))
            b.roll = 0.0
            if parent:
                b.parent = arm.edit_bones[f'{name}__{parent}']
                b.use_connect = False
        bpy.ops.object.mode_set(mode='OBJECT')
    obj['bones'] = json.dumps(bones)
    return obj


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def game_coords(o):
    """Vertex positions of `o` in game space (n, 3)."""
    co = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)


def set_game_coords(o, p):
    co = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    o.data.vertices.foreach_set('co', co.ravel())
    o.data.update()


# ------------------------------------------------------------------ clips

class Clip:
    """
    A keyframed clip on a rig's bones: `key(bone, t, rot)` sets the bone's
    rotation (game Euler XYZ, radians, from its rest) `t` seconds in. Rest
    keys go at both ends unless given; a looping clip's last key repeats its
    first. Each clip becomes an NLA track `<group>.<clip>` on the rig, which
    the glTF exporter writes as one animation.
    """

    def __init__(self, group, name, duration, loop=False):
        self.group = group
        self.name = name
        self.duration = duration
        self.loop = loop
        self.keys = {}

    def key(self, bone, t, rot=(0, 0, 0)):
        self.keys.setdefault(bone, []).append((t, tuple(rot)))
        return self

    def at(self, bone, share, rot=(0, 0, 0)):
        return self.key(bone, share * self.duration, rot)

    def write(self, rig):
        ad = rig.animation_data or rig.animation_data_create()
        action = bpy.data.actions.new(f'{self.group}.{self.name}')
        ad.action = action
        for bone, keys in self.keys.items():
            pb = rig.pose.bones.get(f'{rig.name}__{bone}')
            if pb is None:
                raise KeyError(f'{self.group}.{self.name}: no bone {bone}')
            pb.rotation_mode = 'QUATERNION'
            keys = sorted(keys)
            if self.loop and (keys[0][0] > 0 or keys[-1][0] < self.duration - 1e-6):
                # A loop's ends meet: where the first and last keys would meet across the seam.
                gap = keys[0][0] + self.duration - keys[-1][0]
                share = (self.duration - keys[-1][0]) / gap if gap > 0 else 0.5
                seam = tuple(a + (b - a) * share for a, b in zip(keys[-1][1], keys[0][1]))
                if keys[0][0] > 0:
                    keys.insert(0, (0.0, seam))
                if keys[-1][0] < self.duration - 1e-6:
                    keys.append((self.duration, seam))
            if keys[0][0] > 0:
                keys.insert(0, (0.0, (0, 0, 0)))
            if keys[-1][0] < self.duration - 1e-6:
                keys.append((self.duration, (0, 0, 0)))
            for t, rot in keys:
                pb.rotation_quaternion = game_quat(rot)
                pb.keyframe_insert('rotation_quaternion', frame=round(t * FPS))
            pb.rotation_quaternion = (1, 0, 0, 0)
        for curve in W._fcurves(action):
            for kp in curve.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        track = ad.nla_tracks.new()
        track.name = f'{self.group}.{self.name}'
        strip = track.strips.new(self.name, 0, action)
        strip.extrapolation = 'NOTHING'
        ad.action = None
        return self


def game_quat(rot):
    """A game Euler XYZ rotation as the quaternion of a bone whose frame is the game's axes (Blender bone space)."""
    q = Euler(rot, 'XYZ').to_quaternion()
    # Bone space of an up-pointing, unrolled bone: bone x = game x, bone y = game y, bone z = game z.
    return Quaternion((q.w, q.x, q.y, q.z))


# ------------------------------------------------------------------ export

def export(path, objects):
    """Export the selected rigs and meshes (materials by name only, vertex colours and `_FX`, NLA clips)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=False, export_materials='EXPORT', export_texcoords=True, export_normals=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_attributes=True,
        export_skins=True, export_all_influences=False, export_def_bones=False,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_optimize_animation_size=True, export_anim_slide_to_zero=False, export_yup=True,
        export_extras=False, export_cameras=False, export_lights=False)


# ------------------------------------------------------------------ previews

def preview(path, objects=None, views=((0, 1.0),), size=(900, 900), ortho=2.0, centre=(0, 0.95, 0), samples=24, colours=True, engine='CYCLES'):
    """
    Render the scene (or `objects` only) to `path` (a PNG per view, `-<i>` added),
    lit by a sun and a grey sky: `views` are (yaw degrees, distance factor);
    with `colours` the vertex colours multiply the finish (as in the game).
    """
    scene = bpy.context.scene
    W._gpu(scene) if engine == 'CYCLES' else None
    scene.render.engine = engine
    scene.cycles.samples = samples
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    shown = None if objects is None else set(objects)
    hidden = []
    for o in scene.objects:
        if shown is not None and o.type == 'MESH' and o not in shown and not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    world = scene.world or bpy.data.worlds.new('preview')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.45, 0.5, 0.58, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    sun = bpy.data.objects.get('preview-sun')
    if sun is None:
        sun = bpy.data.objects.new('preview-sun', bpy.data.lights.new('preview-sun', 'SUN'))
        scene.collection.objects.link(sun)
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    cam = bpy.data.objects.get('preview-cam')
    if cam is None:
        cam = bpy.data.objects.new('preview-cam', bpy.data.cameras.new('preview-cam'))
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = 85
    patched = []
    if colours:
        for mat in bpy.data.materials:
            if not mat.use_nodes or 'BSDF' not in mat.node_tree.nodes or 'ALBEDO' not in mat.node_tree.nodes:
                continue
            nodes, links = _nodes(mat)
            attr = nodes.new('ShaderNodeVertexColor')
            attr.layer_name = 'Col'
            mul = nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            ins = {s.identifier: s for s in mul.inputs}
            ins['Factor_Float'].default_value = 1.0
            links.new(nodes['ALBEDO'].outputs[0], ins['A_Color'])
            links.new(attr.outputs['Color'], ins['B_Color'])
            links.new(next(s for s in mul.outputs if s.identifier == 'Result_Color'), nodes['BSDF'].inputs['Base Color'])
            patched.append((mat, attr, mul))
    c = G(*centre)
    for i, (yaw, dist) in enumerate(views):
        a = math.radians(yaw)
        d = 6.0 * dist
        cam.location = c + Vector((math.sin(a) * d, -math.cos(a) * d, 0.0))
        cam.rotation_euler = (math.pi / 2, 0, a)
        scene.render.filepath = f'{path}-{i}.png'
        bpy.ops.render.render(write_still=True)
    for mat, attr, mul in patched:
        nodes, links = _nodes(mat)
        links.new(nodes['ALBEDO'].outputs[0], nodes['BSDF'].inputs['Base Color'])
        nodes.remove(attr)
        nodes.remove(mul)
    for o in hidden:
        o.hide_render = False


def ring(name, centre, radii, height, thickness=0.006, axis='y', segments=24, finish=None, rot=(0, 0, 0)):
    """An open band (a belt, a strap, a helmet band): `radii` its inner half-widths across the axis, `height` along it."""
    rx, rz = radii
    pts = [(-height / 2, rx), (height / 2, rx), (height / 2, rx + thickness), (-height / 2, rx + thickness)]
    return lathe(name, pts, centre, axis, segments, finish, scale=(1.0, rz / rx), rot=rot, closed=True)

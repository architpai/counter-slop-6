"""
Shared building blocks for the first-person weapon scripts (docs/VISUALS.md, R4).

Each script (r4c.py, mp5.py, ...) builds one texture set: its meshes from
code (side profiles extruded across the gun, lathed tubes, boxes, boolean
cuts, all bevelled), its moving parts and sockets as named objects, the
posed gloved hands (hands.py), and its keyframed clips. Then `finish()`:

1. applies every modifier and joins the static parts per node;
2. unwraps the set into one UV atlas (smart project, islands scaled to one
   texel density, packed);
3. bakes the set's procedural finishes with Cycles into that atlas: EMIT
   passes for albedo, roughness and metalness, the shading normal (the
   Bevel node's rounded edges and each finish's bump detail: stippling,
   knurling, weave), and ambient occlusion from the set's own geometry.
   Edge wear and cavity grime come from the same nodes (bevel-normal
   difference, AO node), so worn edges, dirty corners and the normal map
   agree. That is the high-to-low step: the detail lives in the shader and
   the geometry, and lands in the low mesh's maps;
4. writes raw RGBA8 maps at 2048, 1024 and 512 (rows top first, as glTF's
   UVs expect), PNG previews, `model.glb` (the set's nodes, clips and
   sockets; materials are names only, the game builds them) and meta.json
   (triangles per node, clip lengths, sockets).

tools/weapons/build.mjs runs the scripts, merges and compresses the glb and
encodes the maps to KTX2. Nothing is downloaded: no image, scan or model.

Axes: Blender +Y is forward (the barrel), +Z up, +X right; glTF export
turns that into three's -Z forward, +Y up. Units are metres. Clips run at
100 frames a second, so every duration in weapons/stats.ts is a whole
number of frames.

Run one set alone (after hands.py and optics.py, which others append):

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/r4c.py -- [--preview] [--quick] [--out DIR]
"""

import json
import math
import os
import struct
import sys
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'tools', 'weapons', '.build')
SIZES = (2048, 1024, 512)
FPS = 100
TAU = 2 * math.pi


# ------------------------------------------------------------------ options

def options():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'out': DEFAULT_OUT, 'preview': '--preview' in argv, 'quick': '--quick' in argv, 'size': SIZES[0],
            'bake': '--no-bake' not in argv}
    for i, arg in enumerate(argv):
        if arg == '--out':
            opts['out'] = os.path.abspath(argv[i + 1])
        elif arg == '--size':
            opts['size'] = int(argv[i + 1])
    return opts


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1
    scene.frame_start = 0
    scene.unit_settings.system = 'METRIC'
    return scene


def srgb(hex_colour):
    """An sRGB hex colour (0xRRGGBB) as linear RGB."""
    c = [((hex_colour >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# --------------------------------------------------------------- geometry

def _link(obj, parent=None):
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def _object(name, bm, finish=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    obj = _link(bpy.data.objects.new(name, me), parent)
    if finish:
        paint(obj, finish)
    return obj


def empty(name, location=(0, 0, 0), parent=None, rotation=(0, 0, 0)):
    obj = _link(bpy.data.objects.new(name, None), parent)
    obj.empty_display_size = 0.02
    obj.location = location
    obj.rotation_euler = rotation
    return obj


def fillet(points, radius, steps=3):
    """Round every corner of a closed 2D polygon; `radius` may be a list, one per corner (0 keeps it sharp)."""
    out = []
    n = len(points)
    for i, p in enumerate(points):
        r = radius[i] if isinstance(radius, (list, tuple)) else radius
        if r <= 0 or steps < 1:
            out.append(p)
            continue
        a, b = Vector(points[i - 1]), Vector(points[(i + 1) % n])
        p = Vector(p)
        da, db = (a - p), (b - p)
        ra, rb = min(r, da.length * 0.45), min(r, db.length * 0.45)
        pa, pb = p + da.normalized() * ra, p + db.normalized() * rb
        for k in range(steps + 1):
            t = k / steps
            q = (1 - t) ** 2 * pa + 2 * (1 - t) * t * p + t ** 2 * pb
            out.append((q.x, q.y))
    return out


def profile(name, points, width, x=0.0, finish=None, parent=None, taper=None):
    """
    A side profile, [(y, z), ...] counter-clockwise seen from +X, extruded
    `width` across X and centred on `x`. `taper` (optional) is a function of
    (y, z) giving the half-width there instead, for blades and slides that
    narrow towards an edge.
    """
    bm = bmesh.new()
    left = [bm.verts.new((x - width / 2, y, z)) for y, z in points]
    right = [bm.verts.new((x + width / 2, y, z)) for y, z in points]
    bm.faces.new(list(reversed(left)))
    bm.faces.new(right)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((left[i], left[j], right[j], right[i]))
    if taper:
        for v in bm.verts:
            half = taper(v.co.y, v.co.z)
            v.co.x = x + math.copysign(half, v.co.x - x)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, finish, parent)


def extrude_y(name, points, y0, y1, finish=None, parent=None):
    """A cross-section, [(x, z), ...], extruded along Y from `y0` to `y1` (handguards, rails, rail covers)."""
    bm = bmesh.new()
    back = [bm.verts.new((x, y0, z)) for x, z in points]
    front = [bm.verts.new((x, y1, z)) for x, z in points]
    bm.faces.new(back)
    bm.faces.new(list(reversed(front)))
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, finish, parent)


RAIL_WIDTH = 0.0212
RAIL_PITCH = 0.01001


def rail(name, y0, y1, z, finish='anodized', axis_rotation=0.0, centre=(0.0, 0.0)):
    """
    A Picatinny rail from `y0` to `y1` whose base sits at `z`: the dovetail
    and its crossbar teeth (5.2 mm, on a 10 mm pitch), 5.5 mm tall. Turned
    `axis_rotation` radians about the Y axis through `centre` (x, z) for side
    and bottom rails. Returns the joined mesh.
    """
    section = [(-0.0078, 0.0), (0.0078, 0.0), (0.0106, 0.0022), (0.0080, 0.0036), (-0.0080, 0.0036), (-0.0106, 0.0022)]
    base = extrude_y(f'{name}-base', [(x, z + dz) for x, dz in section], y0, y1, finish)
    teeth = []
    count = int((y1 - y0 - 0.004) / RAIL_PITCH)
    start = (y0 + y1) / 2 - (count - 1) * RAIL_PITCH / 2
    for i in range(count):
        t = box(f'{name}-tooth{i}', (0.0158, 0.0052, 0.0019), (0, start + i * RAIL_PITCH, z + 0.0036 + 0.00095), finish)
        bake_transform(t)
        teeth.append(t)
    obj = join(name, [base, *teeth])
    if axis_rotation:
        cx, cz = centre
        obj.data.transform(Matrix.Translation((cx, 0, cz)) @ Matrix.Rotation(axis_rotation, 4, 'Y') @ Matrix.Translation((-cx, 0, -cz)))
    return obj


def plan(name, points, height, z=0.0, finish=None, parent=None):
    """A top-view outline, [(x, y), ...], extruded `height` up from `z` (rail teeth, plates, triggers seen from above)."""
    bm = bmesh.new()
    low = [bm.verts.new((px, py, z)) for px, py in points]
    high = [bm.verts.new((px, py, z + height)) for px, py in points]
    bm.faces.new(list(reversed(low)))
    bm.faces.new(high)
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((low[i], low[j], high[j], high[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, finish, parent)


def lathe(name, points, segments=24, axis='Y', centre=(0, 0, 0), finish=None, parent=None, scale=(1, 1), phase=0.0, closed=False):
    """
    A surface of revolution: [(along, radius), ...] down `axis` from
    `centre`. A radius of 0 at either end closes it to a point; otherwise the
    ends are capped flat. `closed` revolves the points as a loop instead (a
    ring or rim with a hole: no caps). `scale` stretches the section (an oval tube).
    """
    bm = bmesh.new()
    c = Vector(centre)
    rings = []
    for along, radius in points:
        ring = []
        count = 1 if radius == 0 else segments
        for k in range(count):
            a = TAU * k / segments + phase
            u, v = math.cos(a) * radius * scale[0], math.sin(a) * radius * scale[1]
            if axis == 'Y':
                co = (u, along, v)
            elif axis == 'X':
                co = (along, u, v)
            else:
                co = (u, v, along)
            ring.append(bm.verts.new(c + Vector(co)))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for r0, r1 in pairs:
        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            for k in range(segments):
                bm.faces.new((r0[0], r1[k], r1[(k + 1) % segments]))
        elif len(r1) == 1:
            for k in range(segments):
                bm.faces.new((r0[k], r1[0], r0[(k + 1) % segments]))
        else:
            for k in range(segments):
                bm.faces.new((r0[k], r1[k], r1[(k + 1) % segments], r0[(k + 1) % segments]))
    if len(rings[0]) > 1 and not closed:
        bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1 and not closed:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, finish, parent)


def tube(name, radius, length, centre=(0, 0, 0), axis='Y', segments=24, finish=None, parent=None):
    """A plain capped cylinder `length` long, centred on `centre`."""
    return lathe(name, [(-length / 2, radius), (length / 2, radius)], segments, axis, centre, finish, parent)


def lens(name, y, radius, sag, facing, centre=(0, 0, 0), finish='glass', segments=32):
    """
    A lens across the Y axis through `centre`: a smooth dome `radius` across
    at `y`, bulging `sag` towards `facing` (+1 forward, -1 back) on a thin
    flat back, so it mirrors a sweep of the sky and not one flat colour.
    """
    rings = 6
    dome = [(y + facing * sag * (1 - (k / rings) ** 2), radius * k / rings) for k in range(rings + 1)]
    obj = lathe(name, [*dome, (y - facing * 0.001, radius), (y - facing * 0.001, 0.0)], segments, 'Y', centre, finish)
    return smooth(obj, 60)


def box(name, size, centre=(0, 0, 0), finish=None, parent=None, rotation=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    obj = _object(name, bm, finish, parent)
    obj.location = centre
    obj.rotation_euler = rotation
    return obj


def transform(obj, location=None, rotation=None, scale=None):
    """Bake a transform into the mesh (so joined and bevelled parts stay where they are)."""
    m = Matrix.Translation(Vector(location or (0, 0, 0))) @ Euler(rotation or (0, 0, 0)).to_matrix().to_4x4()
    if scale is not None:
        m = m @ Matrix.Diagonal((*scale, 1))
    obj.data.transform(m)
    obj.data.update()
    return obj


def _apply_modifier(obj, modifier):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def bake_transform(obj):
    """Put the object's own transform into its mesh; the object sits at its parent's origin."""
    obj.data.transform(obj.matrix_basis)
    obj.matrix_basis = Matrix.Identity(4)
    obj.data.update()
    return obj


def cut(target, *cutters, union=False):
    """Boolean difference (or union) with each cutter, applied; the cutters are deleted."""
    bake_transform(target)
    for cutter in cutters:
        bake_transform(cutter)
        m = target.modifiers.new('cut', 'BOOLEAN')
        m.operation = 'UNION' if union else 'DIFFERENCE'
        m.object = cutter
        m.solver = 'EXACT'
        _apply_modifier(target, m)
        bpy.data.objects.remove(cutter)
    return target


def join(name, objects, parent=None):
    """Join meshes into one object named `name` (their materials kept per face)."""
    objects = [o for o in objects if o is not None]
    for o in objects:
        bake_transform(o)
        o.parent = None
    base = objects[0]
    if len(objects) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=objects, selected_objects=objects):
            bpy.ops.object.join()
    base.name = name
    base.data.name = name
    if parent is not None:
        base.parent = parent
    return base


def bevel(obj, width=0.0012, segments=2, angle=35, clamp=True):
    """Round every edge sharper than `angle` degrees (the modifier; `apply_all` applies it)."""
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(angle))
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = clamp
    m.harden_normals = True
    m.miter_outer = 'MITER_ARC'
    return obj


def smooth(obj, angle=40):
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(angle))
    return obj


def apply_all(obj):
    for m in list(obj.modifiers):
        if m.type != 'ARMATURE':
            _apply_modifier(obj, m)
    return obj


def array(obj, count, offset, name=None):
    """`count` copies of a mesh, each `offset` further, joined into one (rail slots, serrations)."""
    copies = [obj]
    for i in range(1, count):
        c = obj.copy()
        c.data = obj.data.copy()
        _link(c)
        transform(c, location=Vector(offset) * i)
        copies.append(c)
    return join(name or obj.name, copies)


# ---------------------------------------------------------------- finishes

# The finishes a set is painted in. Colours are sRGB; wear shows the
# material under the coating on edges (bevel-normal difference), grime
# darkens cavities (AO node). `pattern` is bump detail in object space.
FINISHES = {
    'anodized': dict(base=0x2c2d30, rough=0.46, metal=0.0, worn=0xa3a7ab, worn_rough=0.3, worn_metal=1.0, wear=0.55, grime=0.5, pattern='cast', bump=0.00002),
    'anodized-blue': dict(base=0x2f5fd0, rough=0.4, metal=0.0, worn=0xb2b6bb, worn_rough=0.28, worn_metal=1.0, wear=0.6, grime=0.35, pattern='cast', bump=0.00002),
    'parkerized': dict(base=0x323336, rough=0.6, metal=0.3, worn=0x8f9398, worn_rough=0.3, worn_metal=1.0, wear=0.55, grime=0.55, pattern='cast', bump=0.00003),
    'painted-steel': dict(base=0x26272a, rough=0.52, metal=0.0, worn=0x7f8388, worn_rough=0.32, worn_metal=1.0, wear=0.7, grime=0.6, pattern='cast', bump=0.00002),
    'steel': dict(base=0x5a5d61, rough=0.34, metal=1.0, worn=0xa9adb2, worn_rough=0.22, worn_metal=1.0, wear=0.35, grime=0.6, pattern='cast', bump=0.00001),
    'dark-steel': dict(base=0x3a3c3f, rough=0.42, metal=1.0, worn=0x9a9ea3, worn_rough=0.25, worn_metal=1.0, wear=0.4, grime=0.6, pattern='cast', bump=0.00001),
    'satin': dict(base=0xb4b8bc, rough=0.28, metal=1.0, worn=0xd8dadd, worn_rough=0.18, worn_metal=1.0, wear=0.3, grime=0.35, pattern='brushed', bump=0.000004),
    'polymer': dict(base=0x2b2c2e, rough=0.64, metal=0.0, worn=0x4a4b4e, worn_rough=0.5, worn_metal=0.0, wear=0.4, grime=0.55, pattern='cast', bump=0.00002),
    'polymer-stipple': dict(base=0x2a2b2d, rough=0.72, metal=0.0, worn=0x48494b, worn_rough=0.55, worn_metal=0.0, wear=0.35, grime=0.6, pattern='stipple', bump=0.00018),
    'polymer-tan': dict(base=0x8c7a5c, rough=0.66, metal=0.0, worn=0xa8987a, worn_rough=0.5, worn_metal=0.0, wear=0.35, grime=0.55, pattern='cast', bump=0.00002),
    'polymer-tan-stipple': dict(base=0x8a785a, rough=0.74, metal=0.0, worn=0xa39373, worn_rough=0.55, worn_metal=0.0, wear=0.3, grime=0.55, pattern='stipple', bump=0.00018),
    'polymer-olive': dict(base=0x4f563b, rough=0.66, metal=0.0, worn=0x6a7052, worn_rough=0.5, worn_metal=0.0, wear=0.35, grime=0.55, pattern='cast', bump=0.00002),
    'polymer-olive-stipple': dict(base=0x4d5439, rough=0.74, metal=0.0, worn=0x676d50, worn_rough=0.55, worn_metal=0.0, wear=0.3, grime=0.55, pattern='stipple', bump=0.00018),
    'polymer-blue': dict(base=0x3a66d4, rough=0.55, metal=0.0, worn=0x6d8fe6, worn_rough=0.45, worn_metal=0.0, wear=0.35, grime=0.4, pattern='cast', bump=0.00002),
    # Shotgun shell hulls: a stock oxblood plastic, dark enough not to outshine the gun.
    'hull-red': dict(base=0x5e1d1a, rough=0.5, metal=0.0, worn=0x7a3530, worn_rough=0.42, worn_metal=0.0, wear=0.3, grime=0.45, pattern='cast', bump=0.00002),
    'rubber': dict(base=0x1d1e1f, rough=0.86, metal=0.0, worn=0x2e2f31, worn_rough=0.7, worn_metal=0.0, wear=0.2, grime=0.4, pattern='rubber', bump=0.00006),
    'knurl': dict(base=0x3c3e41, rough=0.5, metal=1.0, worn=0xa0a4a9, worn_rough=0.3, worn_metal=1.0, wear=0.5, grime=0.7, pattern='knurl', bump=0.00025),
    'brass': dict(base=0xb08d45, rough=0.32, metal=1.0, worn=0xd9bd7a, worn_rough=0.2, worn_metal=1.0, wear=0.4, grime=0.5, pattern='cast', bump=0.00001),
    'glass': dict(base=0x0c1116, rough=0.06, metal=0.0, worn=0x0c1116, worn_rough=0.06, worn_metal=0.0, wear=0.0, grime=0.0, pattern=None, bump=0.0),
    # A neutral charcoal: a warm grey read olive under House's and Mexico's evening light.
    'glove': dict(base=0x323438, rough=0.78, metal=0.0, worn=0x4b4d52, worn_rough=0.7, worn_metal=0.0, wear=0.3, grime=0.5, pattern='weave', bump=0.00012),
    'glove-palm': dict(base=0x28292b, rough=0.62, metal=0.0, worn=0x3e3f42, worn_rough=0.5, worn_metal=0.0, wear=0.35, grime=0.5, pattern='leather', bump=0.00016),
    'glove-pad': dict(base=0x222325, rough=0.7, metal=0.0, worn=0x3a3b3e, worn_rough=0.55, worn_metal=0.0, wear=0.45, grime=0.5, pattern='rubber', bump=0.00008),
    'sleeve': dict(base=0x33415a, rough=0.86, metal=0.0, worn=0x42516c, worn_rough=0.8, worn_metal=0.0, wear=0.25, grime=0.45, pattern='weave', bump=0.00016),
    'sleeve-cuff': dict(base=0x2b3649, rough=0.84, metal=0.0, worn=0x3b4861, worn_rough=0.78, worn_metal=0.0, wear=0.3, grime=0.5, pattern='weave', bump=0.00012),
    'wood': dict(base=0x6b4a30, rough=0.55, metal=0.0, worn=0x8a6a4a, worn_rough=0.45, worn_metal=0.0, wear=0.3, grime=0.5, pattern='grain', bump=0.00004),
    'optic-white': dict(base=0xe8e8e6, rough=0.5, metal=0.0, worn=0xffffff, worn_rough=0.32, worn_metal=0.7, wear=0.55, grime=0.45, pattern='cast', bump=0.00002),
}


def _nodes(mat):
    return mat.node_tree.nodes, mat.node_tree.links


def material(finish):
    """The Cycles graph for one finish, built once. Reroutes ALBEDO, ROUGH and METAL feed the EMIT bakes."""
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

    def math_node(op, a, b=0.0, clamp=False):
        n = node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                links.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    def map_range(v, a, b, c=0.0, d=1.0):
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

    def noise(scale, detail=4.0, rough=0.55, stretch=(1, 1, 1), distortion=0.0):
        mapping = node('ShaderNodeMapping')
        links.new(coord.outputs['Object'], mapping.inputs['Vector'])
        mapping.inputs['Scale'].default_value = stretch
        n = node('ShaderNodeTexNoise', noise_dimensions='3D')
        links.new(mapping.outputs[0], n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distortion
        return n.outputs['Fac']

    out = node('ShaderNodeOutputMaterial', name='OUT')
    bsdf = node('ShaderNodeBsdfPrincipled', name='BSDF')
    emit = node('ShaderNodeEmission', name='EMIT')
    coord = node('ShaderNodeTexCoord')
    geometry = node('ShaderNodeNewGeometry')
    # Edges: where a wide bevel normal leaves the surface normal.
    wide = node('ShaderNodeBevel', samples=12)
    wide.inputs['Radius'].default_value = 0.0022
    dot = node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    links.new(wide.outputs['Normal'], dot.inputs[0])
    links.new(geometry.outputs['Normal'], dot.inputs[1])
    edge = map_range(math_node('SUBTRACT', 1.0, dot.outputs['Value']), 0.004, 0.06)
    # Cavities: a short local occlusion.
    ao = node('ShaderNodeAmbientOcclusion', samples=16, only_local=True)
    ao.inputs['Distance'].default_value = 0.006
    cavity = map_range(ao.outputs['AO'], 0.95, 0.35)
    breakup = noise(90, 6, 0.6)
    speck = noise(700, 3, 0.5)
    wear = math_node('MULTIPLY', map_range(math_node('SUBTRACT', math_node('MULTIPLY', edge, 1.4), math_node('MULTIPLY', breakup, 0.9)), 0.0, 0.35), spec['wear'])
    # Fine scuffs on flat faces, rarer than on edges.
    scuff = math_node('MULTIPLY', map_range(noise(260, 8, 0.7, (1, 0.25, 1)), 0.66, 0.74), spec['wear'] * 0.18)
    wear = math_node('MAXIMUM', wear, scuff)
    grime = math_node('MULTIPLY', cavity, spec['grime'])

    base = srgb(spec['base'])
    tone = map_range(breakup, 0.3, 0.7, 0.93, 1.07)
    base_col = node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_factor=True)
    bins = {s.identifier: s for s in base_col.inputs}
    bins['Factor_Float'].default_value = 1.0
    bins['A_Color'].default_value = (*base, 1)
    tone_rgb = node('ShaderNodeCombineColor')
    for i in range(3):
        links.new(tone, tone_rgb.inputs[i])
    links.new(tone_rgb.outputs[0], bins['B_Color'])
    albedo = next(s for s in base_col.outputs if s.identifier == 'Result_Color')
    albedo = mix(wear, albedo, (*srgb(spec['worn']),), 'RGBA')
    grime_col = tuple(0.55 * c for c in base) if max(base) > 0.08 else tuple(0.7 * c for c in base)
    albedo = mix(math_node('MULTIPLY', grime, 0.8), albedo, (*grime_col,), 'RGBA')

    rough = math_node('ADD', spec['rough'], math_node('MULTIPLY', math_node('SUBTRACT', speck, 0.5), 0.12))
    rough = mix(wear, rough, spec['worn_rough'])
    rough = math_node('ADD', rough, math_node('MULTIPLY', grime, 0.12), clamp=True)
    metal = mix(wear, spec['metal'], spec['worn_metal'])

    # Detail height for the normal bake.
    pattern = spec['pattern']
    height = None
    if pattern == 'stipple':
        v = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1')
        links.new(coord.outputs['Object'], v.inputs['Vector'])
        v.inputs['Scale'].default_value = 1400
        height = map_range(v.outputs['Distance'], 0.0, 0.5, 1.0, 0.0)
    elif pattern == 'knurl':
        a = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', wave_profile='TRI')
        b = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='DIAGONAL', wave_profile='TRI')
        mapping = node('ShaderNodeMapping')
        links.new(coord.outputs['Object'], mapping.inputs['Vector'])
        mapping.inputs['Rotation'].default_value = (0, 0, math.pi / 2)
        links.new(coord.outputs['Object'], a.inputs['Vector'])
        links.new(mapping.outputs[0], b.inputs['Vector'])
        for w in (a, b):
            w.inputs['Scale'].default_value = 900
        height = math_node('MINIMUM', a.outputs['Fac'], b.outputs['Fac'])
    elif pattern == 'weave':
        a = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X', wave_profile='SIN')
        b = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y', wave_profile='SIN')
        for w in (a, b):
            links.new(coord.outputs['Object'], w.inputs['Vector'])
            w.inputs['Scale'].default_value = 600
            w.inputs['Distortion'].default_value = 0.4
        height = math_node('ADD', math_node('MULTIPLY', a.outputs['Fac'], b.outputs['Fac']), math_node('MULTIPLY', noise(160, 4, 0.6), 0.8))
    elif pattern == 'leather':
        v = node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='DISTANCE_TO_EDGE')
        links.new(coord.outputs['Object'], v.inputs['Vector'])
        v.inputs['Scale'].default_value = 500
        height = math_node('ADD', map_range(v.outputs['Distance'], 0.0, 0.08), math_node('MULTIPLY', noise(120, 4, 0.6), 0.6))
    elif pattern == 'rubber':
        height = noise(900, 3, 0.5)
    elif pattern == 'brushed':
        height = noise(400, 6, 0.7, (1, 0.02, 1))
    elif pattern == 'grain':
        w = node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y', wave_profile='SIN')
        links.new(coord.outputs['Object'], w.inputs['Vector'])
        w.inputs['Scale'].default_value = 90
        w.inputs['Distortion'].default_value = 8
        height = w.outputs['Fac']
    elif pattern == 'cast':
        height = noise(1200, 2, 0.5)

    fine = node('ShaderNodeBevel', samples=12)
    fine.inputs['Radius'].default_value = 0.0007
    normal = fine.outputs['Normal']
    if height is not None and spec['bump'] > 0:
        bump = node('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 1.0
        bump.inputs['Distance'].default_value = spec['bump']
        links.new(height, bump.inputs['Height'])
        links.new(normal, bump.inputs['Normal'])
        normal = bump.outputs['Normal']
    links.new(normal, bsdf.inputs['Normal'])

    for label, socket in (('ALBEDO', albedo), ('ROUGH', rough), ('METAL', metal)):
        r = node('NodeReroute', name=label)
        links.new(socket, r.inputs[0])
    links.new(albedo, bsdf.inputs['Base Color'])
    links.new(rough, bsdf.inputs['Roughness'])
    links.new(metal, bsdf.inputs['Metallic'])
    links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def paint(obj, finish):
    """Give an object one finish (all faces)."""
    obj.data.materials.clear()
    obj.data.materials.append(material(finish))
    return obj


# ------------------------------------------------------------------- nodes

class Weapon:
    """
    One exported model: a root empty named after it, a `pivot` under it that
    clips may move as a whole (the procedural pose stays on the root), parts
    and sockets. Node names are `<name>__<part>` in Blender (unique across
    sets) and lose the prefix in the game.
    """

    def __init__(self, name, texture_set=None, pivot=(0, 0, 0)):
        self.name = name
        self.set = texture_set or name
        self.root = empty(name)
        self.pivot = empty(self.node('pivot'), pivot, self.root)
        self.parts = {}
        self.static = []
        self.sockets = {}
        self.clips = {}

    def node(self, part):
        return f'{self.name}__{part}'

    def add(self, obj, part=None):
        """A static mesh piece; `finish()` joins them all into the `body` node."""
        if part is None:
            self.static.append(obj)
            return obj
        return self.part(part, [obj])

    def part(self, part, objects, origin=None, material=None):
        """A moving part: `objects` joined into one node named `part`, its origin at `origin` (the pivot it turns on)."""
        objects = objects if isinstance(objects, (list, tuple)) else [objects]
        obj = join(self.node(part), objects)
        if origin is not None:
            obj.data.transform(Matrix.Translation(-Vector(origin)))
            obj.location = origin
        pivot = self.pivot
        obj.parent = pivot
        obj.location = Vector(obj.location) - Vector(pivot.location)
        if material:
            obj['material'] = material
        self.parts[part] = obj
        return obj

    def socket(self, part, location, parent=None):
        """An empty the game reads: muzzle, eject, sight, optic-mount."""
        p = parent or self.pivot
        e = empty(self.node(part), Vector(location) - p.matrix_world.translation, p)
        self.sockets[part] = e
        return e

    def reparent(self, obj, parent):
        """Keep `obj` where it is in the weapon, under another node."""
        world = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = world
        return obj


# ---------------------------------------------------------------- clips

class Clip:
    """
    A keyframed clip on a weapon's nodes. `key(part, t, loc=..., rot=...)`
    sets a node's location and rotation (Euler XYZ, radians, relative to its
    rest pose) `t` seconds in; each node gets a rest key at 0 and at the end
    unless the clip says otherwise. Every clip becomes an NLA track of that
    name on each node it moves, which the glTF exporter merges into one
    animation.
    """

    def __init__(self, weapon, name, duration):
        self.weapon = weapon
        self.name = name
        self.duration = duration
        self.frames = round(duration * FPS)
        assert abs(self.frames / FPS - duration) < 1e-9, f'{name}: {duration} s is not a whole number of frames'
        self.keys = {}
        weapon.clips[name] = self

    def key(self, part, t, loc=(0, 0, 0), rot=(0, 0, 0), ease='BEZIER', scale=None, base=None):
        """
        `t` is seconds. `base`, a node's (location, rotation) such as
        `hands.basis()` gives, keys `loc` and `rot` from it instead of the
        node's rest pose.
        """
        self.keys.setdefault(part, []).append((t, tuple(loc), tuple(rot), ease, scale, base))
        return self

    def at(self, part, share, loc=(0, 0, 0), rot=(0, 0, 0), ease='BEZIER', scale=None, base=None):
        """A key at a share (0..1) of the clip, so a clip's shape survives a change of its length."""
        return self.key(part, share * self.duration, loc, rot, ease, scale, base)

    def hold(self, part, t0, t1, loc=(0, 0, 0), rot=(0, 0, 0), base=None):
        return self.key(part, t0, loc, rot, base=base).key(part, t1, loc, rot, base=base)


def _write_clips(weapon):
    """Keyframe every clip onto its nodes as NLA tracks, rest pose first and last."""
    for clip in weapon.clips.values():
        for part, keys in clip.keys.items():
            obj = weapon.pivot if part == 'pivot' else weapon.parts.get(part)
            if obj is None:
                raise KeyError(f'{weapon.name}.{clip.name}: no part {part}')
            rest_loc, rest_rot, rest_scale = Vector(obj.location), Euler(obj.rotation_euler), Vector(obj.scale)
            keys = sorted(keys, key=lambda k: k[0])
            scaled = any(k[4] is not None for k in keys)
            if keys[0][0] > 0:
                keys.insert(0, (0.0, (0, 0, 0), (0, 0, 0), 'BEZIER', None, None))
            if keys[-1][0] < clip.duration:
                keys.append((clip.duration, (0, 0, 0), (0, 0, 0), 'BEZIER', None, None))
            ad = obj.animation_data or obj.animation_data_create()
            action = bpy.data.actions.new(f'{obj.name}|{clip.name}')
            ad.action = action
            for t, loc, rot, ease, scale, base in keys:
                frame = round(t * FPS)
                from_loc, from_rot = base or (rest_loc, rest_rot)
                obj.location = Vector(from_loc) + Vector(loc)
                obj.rotation_euler = Euler((from_rot[0] + rot[0], from_rot[1] + rot[1], from_rot[2] + rot[2]))
                obj.keyframe_insert('location', frame=frame)
                obj.keyframe_insert('rotation_euler', frame=frame)
                if scaled:
                    obj.scale = rest_scale if scale is None else Vector((scale, scale, scale))
                    obj.keyframe_insert('scale', frame=frame)
            for fcurve in _fcurves(action):
                for kp in fcurve.keyframe_points:
                    kp.interpolation = 'BEZIER'
                    kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
                    ease = next((k[3] for k in keys if round(k[0] * FPS) == round(kp.co.x)), 'BEZIER')
                    if ease == 'LINEAR':
                        kp.interpolation = 'LINEAR'
            obj.location, obj.rotation_euler, obj.scale = rest_loc, rest_rot, rest_scale
            track = ad.nla_tracks.new()
            # glTF animation names: `<model>.<clip>`, unique across the merged glb.
            track.name = f'{weapon.name}.{clip.name}'
            strip = track.strips.new(clip.name, 0, action)
            strip.extrapolation = 'NOTHING'
            ad.action = None
            obj.location, obj.rotation_euler, obj.scale = rest_loc, rest_rot, rest_scale


def _fcurves(action):
    """F-curves of an action, for slotted (Blender 4.4+) and older actions."""
    if hasattr(action, 'layers') and len(action.layers) > 0:
        curves = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    curves.extend(bag.fcurves)
        return curves
    return list(action.fcurves)


# ------------------------------------------------------------ UV and bake

def _gpu(scene):
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == 'METAL']
        for d in prefs.devices:
            d.use = d.type == 'METAL'
        scene.cycles.device = 'GPU' if gpus else 'CPU'
    except (TypeError, ValueError):
        scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False


def unwrap(objects, margin=0.003):
    """One atlas for the set: smart project, every island at one texel density, packed."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')


def _pixels(image, size):
    px = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(size, size, 4).astype(np.float64)


def _down(a, factor):
    if factor == 1:
        return a
    n = a.shape[0] // factor
    return a.reshape(n, factor, n, factor, *a.shape[2:]).mean(axis=(1, 3))


def _soften(a):
    p = np.pad(a, 1, mode='edge')
    return sum(p[1 + dy:p.shape[0] - 1 + dy, 1 + dx:p.shape[1] - 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9


def _to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _u8(x):
    return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)


def png(path, rgb):
    """A minimal 8-bit RGB PNG writer; rows top first."""
    h, w, _ = rgb.shape
    rows = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def bake(name, objects, opts):
    """Bake the set's atlas and write its maps (see the module docstring)."""
    scene = bpy.context.scene
    _gpu(scene)
    size = opts['size']
    quick = opts['quick']
    scene.render.bake.margin = max(2, size // 128)
    scene.render.bake.margin_type = 'EXTEND'
    world = bpy.data.worlds.new('bake') if scene.world is None else scene.world
    scene.world = world
    world.light_settings.distance = 0.03
    # Only the set's own geometry shades it (occlusion, bevels).
    keep = set(objects)
    for o in scene.objects:
        o.hide_render = o.type == 'MESH' and o not in keep
    materials = {m for o in objects for m in o.data.materials if m is not None}
    image = bpy.data.images.new(f'{name}-bake', size, size, float_buffer=True, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    for mat in materials:
        nodes, _ = _nodes(mat)
        target = nodes.get('TARGET') or nodes.new('ShaderNodeTexImage')
        target.name = 'TARGET'
        target.image = image
        nodes.active = target
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    def emit(channel):
        for mat in materials:
            nodes, links = _nodes(mat)
            links.new(nodes[channel].outputs[0], nodes['EMIT'].inputs['Color'])
            links.new(nodes['EMIT'].outputs[0], nodes['OUT'].inputs['Surface'])
        scene.cycles.samples = 4 if quick else 48
        bpy.ops.object.bake(type='EMIT', use_clear=True)
        return _pixels(image, size)[:, :, :3]

    albedo = np.clip(emit('ALBEDO'), 0, 1)
    rough = np.clip(emit('ROUGH')[:, :, 0], 0, 1)
    metal = np.clip(emit('METAL')[:, :, 0], 0, 1)
    for mat in materials:
        nodes, links = _nodes(mat)
        links.new(nodes['BSDF'].outputs[0], nodes['OUT'].inputs['Surface'])
    scene.cycles.samples = 4 if quick else 64
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=True)
    normal = _pixels(image, size)[:, :, :3]
    scene.cycles.samples = 8 if quick else 128
    bpy.ops.object.bake(type='AO', use_clear=True)
    ao = _pixels(image, size)[:, :, 0]
    for o in scene.objects:
        o.hide_render = False

    # A light 3 x 3 box filter on the scalar maps: the bevel and occlusion nodes leave sampling noise,
    # which reads as grain up close and costs the most bytes in the compressed files.
    rough, metal, ao = _soften(rough), _soften(metal), _soften(ao)
    folder = os.path.join(opts['out'], name)
    os.makedirs(folder, exist_ok=True)
    stats = {}
    for s in SIZES:
        if s > size:
            continue
        f = size // s
        a, r, m, o = _down(albedo, f), _down(rough, f), _down(metal, f), _down(ao, f)
        n = _down(normal * 2 - 1, f)
        n /= np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
        # Soften the AO a little: the game adds screen-space AO on top on High and Ultra.
        o = 1 - 0.85 * (1 - np.clip(o, 0, 1))
        maps = {
            'albedo': _u8(_to_srgb(a)),
            'normal': _u8(n * 0.5 + 0.5),
            'orm': _u8(np.stack([o, r, m], axis=-1)),
        }
        for key, rgb in maps.items():
            # Blender rows run bottom first; glTF's UVs put v = 0 at the top.
            rgb = np.ascontiguousarray(rgb[::-1])
            rgba = np.concatenate([rgb, np.full((s, s, 1), 255, np.uint8)], axis=-1)
            with open(os.path.join(folder, f'{s}-{key}.rgba'), 'wb') as file:
                file.write(rgba.tobytes())
            if s == min(1024, size):
                png(os.path.join(folder, f'preview-{key}.png'), rgb)
        stats[s] = True
    return folder


# ---------------------------------------------------------------- export

def _export_materials(objects, set_name):
    """Swap the bake graphs for plain named materials: the game builds its own from the name."""
    plain = {}
    for o in objects:
        name = o.get('material', set_name)
        mat = plain.get(name)
        if mat is None:
            mat = plain[name] = bpy.data.materials.new(f'export:{name}')
        o.data.materials.clear()
        o.data.materials.append(mat)
        for p in o.data.polygons:
            p.material_index = 0
    for name, mat in plain.items():
        mat.name = name


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def assemble(weapons):
    """
    Apply every modifier, join each weapon's static pieces into its `body`
    node and key its clips. Each node's rest transform is kept: Blender
    writes animated values back into the objects whenever a frame is
    evaluated, so previews and the export put the rest pose back from it.
    """
    for w in weapons:
        if w.static:
            for o in w.static:
                apply_all(o)
            body = join(w.node('body'), w.static)
            body.data.transform(Matrix.Translation(-w.pivot.matrix_world.translation))
            body.parent = w.pivot
            w.parts['body'] = body
            w.static = []
        for obj in w.parts.values():
            if obj.type == 'MESH':
                apply_all(obj)
        w.rest = {o.name: o.matrix_basis.copy() for o in [w.root, *w.root.children_recursive]}
        _write_clips(w)


def restore(weapons):
    """Put every node back in its rest pose (see `assemble`)."""
    for w in weapons:
        for name, basis in getattr(w, 'rest', {}).items():
            obj = bpy.data.objects.get(name)
            if obj is not None:
                obj.matrix_basis = basis


def _patch_rest(path, weapons):
    """
    Write each node's rest pose into the exported glb: the exporter samples
    the clips by evaluating frames, which moves the objects, and may take a
    node's transform from a sampled frame. glTF is Y-up: Blender (x, y, z)
    is (x, z, -y).
    """
    with open(path, 'rb') as f:
        data = bytearray(f.read())
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    rest = {name: basis for w in weapons for name, basis in w.rest.items()}
    for node in doc.get('nodes', []):
        basis = rest.get(node.get('name'))
        if basis is None:
            continue
        loc, rot, scale = basis.decompose()
        node.pop('matrix', None)
        node['translation'] = [loc.x, loc.z, -loc.y]
        node['rotation'] = [rot.x, rot.z, -rot.y, rot.w]
        node['scale'] = [scale.x, scale.z, scale.y]
        for key, identity in (('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1])):
            if all(abs(a - b) < 1e-7 for a, b in zip(node[key], identity)):
                del node[key]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * ((4 - len(text) % 4) % 4)
    rest_bin = data[20 + length:]
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + len(rest_bin)) + struct.pack('<II', len(text), 0x4E4F534A) + text + rest_bin
    with open(path, 'wb') as f:
        f.write(out)


def finish(weapons, opts, set_name, extra_meta=None):
    """
    Unwrap, bake and export an assembled set: `weapons` are its `Weapon`s
    (one for most sets; the optics set has two). Writes the maps, model.glb
    and meta.json into the set's build folder.
    """
    meshes = [o for w in weapons for o in w.parts.values() if o.type == 'MESH']
    # Hands wear the shared hands atlas (baked by hands.py); only the set's own meshes are unwrapped here.
    own = [m for m in meshes if not m.get('shared')]
    unwrap(own)
    bake(set_name, own, opts)
    bpy.context.scene.frame_set(0)
    restore(weapons)
    meta = {'set': set_name, 'nodes': {}, 'clips': {}, 'sockets': {}}
    for w in weapons:
        tris = {part: triangles(o) for part, o in w.parts.items() if o.type == 'MESH'}
        meta['nodes'][w.name] = {'triangles': tris, 'total': sum(tris.values())}
        meta['clips'].update({f'{w.name}.{c.name}': c.duration for c in w.clips.values()})
        meta['sockets'].update({f'{w.name}.{k}': [round(x, 5) for x in s.matrix_world.translation] for k, s in w.sockets.items()})
    if extra_meta:
        meta.update(extra_meta)
    _export_materials(meshes, set_name)
    folder = os.path.join(opts['out'], set_name)
    os.makedirs(folder, exist_ok=True)
    bpy.context.scene.frame_set(0)
    restore(weapons)
    bpy.ops.object.select_all(action='DESELECT')
    for w in weapons:
        for o in [w.root, *w.root.children_recursive]:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(folder, 'model.glb'), export_format='GLB', use_selection=True,
        export_apply=True, export_materials='EXPORT', export_texcoords=True, export_normals=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_optimize_animation_size=True, export_anim_slide_to_zero=False, export_yup=True,
        export_extras=False, export_cameras=False, export_lights=False)
    _patch_rest(os.path.join(folder, 'model.glb'), weapons)
    with open(os.path.join(folder, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'{set_name}: exported {folder}/model.glb ({", ".join(f"{k} {v['total']} tris" for k, v in meta['nodes'].items())})')
    return meta


# ---------------------------------------------------------------- previews

def preview(path, weapons, rest=(0.20, -0.17, -0.36), fov=65, views=('fp',), size=(1440, 900), frame=None, ortho=0.9, centre=(0, -0.15, 0), clip=None, rest_rot=(0, 0, 0)):
    """
    Eevee renders of the model as the game frames it: `fp` puts the root at
    the camera-space rest position (three's -Z forward is Blender +Y) under a
    `fov`-degree camera; `side`, `top` and `front` are orthographic studies.
    """
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('preview')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.42, 0.45, 0.5, 1)
    bg.inputs['Strength'].default_value = 0.8
    sun = bpy.data.lights.get('preview-sun') or bpy.data.lights.new('preview-sun', 'SUN')
    sun.energy = 3.5
    sun_obj = bpy.data.objects.get('preview-sun') or _link(bpy.data.objects.new('preview-sun', sun))
    sun_obj.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))
    cam_data = bpy.data.cameras.get('preview-cam') or bpy.data.cameras.new('preview-cam')
    cam = bpy.data.objects.get('preview-cam') or _link(bpy.data.objects.new('preview-cam', cam_data))
    scene.camera = cam
    muted = {}
    for o in scene.objects:
        for track in (o.animation_data.nla_tracks if o.animation_data else []):
            muted[track] = track.mute
            track.mute = clip is None or track.name.split('.', 1)[-1] != clip
    scene.frame_set(frame if frame is not None else 0)
    if frame is None:
        restore(weapons)
    shown = {o for w in weapons for o in [w.root, *w.root.children_recursive]}
    hidden = {o: o.hide_render for o in scene.objects}
    for o in scene.objects:
        if o.type == 'MESH':
            o.hide_render = o not in shown or o.hide_render
    placed = {}
    for view in views:
        for w in weapons:
            placed[w] = (Vector(w.root.location), Euler(w.root.rotation_euler))
        if view == 'fp':
            cam_data.type = 'PERSP'
            cam_data.sensor_fit = 'VERTICAL'
            cam_data.angle_y = math.radians(fov)
            cam.location = (0, 0, 0)
            cam.rotation_euler = (math.radians(90), 0, 0)
            for w in weapons:
                if w.root.parent is None:
                    w.root.location = (rest[0], -rest[2], rest[1])
                    # three's Euler (x, y, z) on a -Z-forward, Y-up root: Blender X, Z and -Y.
                    w.root.rotation_mode = 'YZX'
                    w.root.rotation_euler = (rest_rot[0], -rest_rot[2], rest_rot[1])
        else:
            cam_data.type = 'ORTHO'
            cam_data.ortho_scale = ortho
            for w in weapons:
                if w.root.parent is None:
                    w.root.location = (0, 0, 0)
                    w.root.rotation_euler = (0, 0, 0)
            cx, cy, cz = centre
            if view == 'side':
                cam.location, cam.rotation_euler = (1.0, cy, cz), (math.radians(90), 0, math.radians(90))
            elif view == 'left':
                cam.location, cam.rotation_euler = (-1.0, cy, cz), (math.radians(90), 0, math.radians(-90))
            elif view == 'top':
                cam.location, cam.rotation_euler = (cx, cy, 1.0), (0, 0, 0)
            elif view == 'bottom':
                cam.location, cam.rotation_euler = (cx, cy, -1.0), (math.radians(180), 0, 0)
            elif view == 'front':
                cam.location, cam.rotation_euler = (cx, 1.0, cz), (math.radians(90), 0, math.radians(180))
            elif view == 'back':
                cam.location, cam.rotation_euler = (cx, -1.0, cz), (math.radians(90), 0, 0)
        scene.render.filepath = f'{path}-{view}.png'
        bpy.ops.render.render(write_still=True)
        for w in weapons:
            w.root.location, w.root.rotation_euler = placed[w]
            w.root.rotation_mode = 'XYZ'
    for o, h in hidden.items():
        o.hide_render = h
    for track, m in muted.items():
        track.mute = m
    scene.frame_set(0)
    restore(weapons)


def study(w, opts, name, clip_shares, rest=(0.14, -0.12, -0.24), rot=(-0.06, 0.04, 0), optic=None):
    """Study renders: the hip view, orthographic sides, both hands close up, and clip frames. `optic` builds one to mount for the look."""
    scope = None
    shown = [w]
    mount = w.sockets.get('optic-mount')
    if optic and mount is not None:
        scope = optic()
        assemble([scope])
        scope.root.parent = mount
        scope.root.location = (0, 0, 0)
        shown.append(scope)
    folder = os.path.join(opts['out'], name)
    os.makedirs(folder, exist_ok=True)
    preview(os.path.join(folder, 'preview'), shown, views=('fp', 'side', 'left', 'bottom', 'top'), ortho=0.85, centre=(0, 0.1, -0.02), rest=rest, rest_rot=rot)
    for label, part in (('right', 'right-hand'), ('left', 'left-hand')):
        c = w.parts[part].matrix_world.translation
        preview(os.path.join(folder, f'hand-{label}'), shown, views=('side', 'left', 'bottom', 'back'), ortho=0.26, centre=(c.x, c.y + 0.06, c.z))
    for clip, shares in clip_shares:
        for share in shares:
            preview(os.path.join(folder, f'clip-{clip}-{share}'), shown, views=('fp',), frame=round(share * w.clips[clip].duration * FPS), clip=clip, rest=rest, rest_rot=rot)
    bpy.context.scene.frame_set(0)
    restore([w])
    if scope:
        for o in [scope.root, *scope.root.children_recursive]:
            bpy.data.objects.remove(o)

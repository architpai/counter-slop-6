"""
Shared building blocks for the detail-kit scripts (docs/VISUALS.md, R6 and V14).

Each script (common.py, downtown.py, house.py, mexico.py) models its pieces
from code: bevelled boxes, lathed and swept tubes, noise-displaced blobs and
cliffs, all made here, nothing read from disk. A piece is a set of parts;
each part wears one of the level's texture sets (render/surfaces.ts
`TEXTURE_SETS`, the R2 library the maps already stream) in a colour of its
own, carried as a vertex colour (linear RGB: the albedo the part averages
to), or the `signs` atlas on the face a sign or poster shows.

Pieces are authored in three.js's frame, in metres: +y up, +x right, +z out
of the wall a piece hangs on (its back at z = 0) or towards the viewer. The
parts are built in that frame and turned into Blender's (z up) only to run
Blender's modifiers (bevel, displace, decimate, smooth by angle); `export`
turns the evaluated meshes back.

`export` writes, into the build folder, `<script>/pieces.json` (per piece:
its flags, bounds, triangles and one run of triangles per texture set) and
`<script>/mesh.bin` (float32, 11 per corner, three corners a triangle:
position, normal, uv, colour). Texture coordinates are the level's own
(render/surfaces.ts `planarUVs`): planar per triangle, in metres over the
set's tile, so a prop's concrete matches the wall's behind it; a sign's
face runs 0..1 over its cell, which the game picks per placement.
tools/props/build.mjs packs them into one glb per map family.

Run through tools/props/build.mjs, or one script alone:

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/props/common.py -- [--out DIR] [--preview]
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'tools', 'props', '.build')
with open(os.path.join(ROOT, 'src', 'engine', 'render', 'texture-sets.json')) as _file:
    TILES = {name: info['tile'] for name, info in json.load(_file)['sets'].items()}
#: The signs atlas's faces run 0..1 over their cell (the game maps it to the placement's cell).
SIGNS = 'signs'
TAU = 2 * math.pi
#: three's frame to Blender's: (x, y, z) -> (x, -z, y).
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
TO_THREE = TO_BLENDER.inverted()


def options():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out, preview = DEFAULT_OUT, '--preview' in argv
    for i, arg in enumerate(argv):
        if arg == '--out':
            out = os.path.abspath(argv[i + 1])
    return out, preview


def reset():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.textures, bpy.data.images):
        for item in list(block):
            block.remove(item)


def srgb(hex_colour):
    """An sRGB hex colour (0xRRGGBB) as linear RGB."""
    c = [((hex_colour >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------------ pieces

class Piece:
    """
    A kit piece: named parts, each one texture set and colour. Flags for the
    game (render/props.ts): `small` pieces are distance-culled and cast no
    shadow; `backdrop` pieces stand beyond the play space, lit by the sky
    probe alone, casting nothing.
    """

    def __init__(self, name, small=False, backdrop=False):
        self.name, self.small, self.backdrop = name, small, backdrop
        self.parts = []


PIECES = []
_current = None


def piece(name, small=False, backdrop=False):
    """Start a piece: every part made until the next `piece` call joins it."""
    global _current
    _current = Piece(name, small, backdrop)
    PIECES.append(_current)
    return _current


def _object(name, bm, texture_set, colour, sign=False, flat=False, shade=None):
    """A Blender object from a bmesh built in three's frame, added to the current piece."""
    bm.transform(TO_BLENDER)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if texture_set != SIGNS and texture_set not in TILES:
        raise ValueError(f'{name}: no texture set {texture_set}')
    obj['set'] = texture_set
    obj['colour'] = colour if isinstance(colour, (tuple, list)) else srgb(colour)
    obj['sign'] = sign
    obj['flat'] = flat
    if shade is not None:
        _shades[obj.name] = shade
    _current.parts.append(obj)
    return obj


#: Per-vertex colour functions of some parts (position in three's frame -> linear RGB), by object name.
_shades = {}


def _place(bm, centre=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    m = Matrix.Translation(Vector(centre)) @ Euler(rotation, 'XYZ').to_matrix().to_4x4()
    m = m @ Matrix.Diagonal((*scale, 1))
    bm.transform(m)


def box(size, centre=(0, 0, 0), texture_set='concrete', colour=0x9a9a9a, bevel=0.0, rotation=(0, 0, 0), sign=False, name='box', segments=2):
    """A box `size` (w, h, d) at `centre`, turned by `rotation` (radians, XYZ), with bevelled edges."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    _place(bm, centre, rotation, size)
    obj = _object(name, bm, texture_set, colour, sign=sign)
    if bevel > 0:
        add_bevel(obj, bevel, segments)
    return obj


def cylinder(radius, height, centre=(0, 0, 0), texture_set='steel', colour=0x8a8f94, segments=16, top=None, axis='y',
             rotation=(0, 0, 0), bevel=0.0, caps=True, name='cylinder', flat=False):
    """A cylinder (a cone frustum with `top`) along `axis`, centred on `centre`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segments, radius1=radius,
                          radius2=radius if top is None else top, depth=height)
    # create_cone runs along z; turn z onto the axis asked for, in three's frame.
    turn = {'y': Euler((-math.pi / 2, 0, 0)), 'x': Euler((0, math.pi / 2, 0)), 'z': Euler((0, 0, 0))}[axis]
    bm.transform(turn.to_matrix().to_4x4())
    _place(bm, centre, rotation)
    obj = _object(name, bm, texture_set, colour, flat=flat)
    if bevel > 0:
        add_bevel(obj, bevel, 2)
    return obj


def sphere(radius, centre=(0, 0, 0), texture_set='foliage', colour=0x4f6f3c, subdivisions=2, scale=(1, 1, 1), name='sphere', flat=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    _place(bm, centre, (0, 0, 0), scale)
    return _object(name, bm, texture_set, colour, flat=flat)


def lathe(profile, segments=16, centre=(0, 0, 0), texture_set='steel', colour=0x8a8f94, name='lathe', rotation=(0, 0, 0), flat=False):
    """Turn a profile of (radius, y) points about the y axis; closed at either end where the radius is 0."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for i in range(segments):
            a = TAU * i / segments
            ring.append(bm.verts.new((r * math.cos(a), y, -r * math.sin(a))))
        rings.append(ring)
    for lo, hi in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _place(bm, centre, rotation)
    return _object(name, bm, texture_set, colour, flat=flat)


def prism(outline, depth, centre=(0, 0, 0), texture_set='concrete', colour=0x9a9a9a, rotation=(0, 0, 0), bevel=0.0, name='prism'):
    """Extrude a polygon of (x, y) points (counter-clockwise, seen from +z) along z, `depth` deep, centred on z = 0."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y, depth / 2)) for x, y in outline]
    back = [bm.verts.new((x, y, -depth / 2)) for x, y in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((back[i], back[j], front[j], front[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _place(bm, centre, rotation)
    obj = _object(name, bm, texture_set, colour)
    if bevel > 0:
        add_bevel(obj, bevel, 2)
    return obj


def tube(points, radius, texture_set='steel', colour=0x8a8f94, segments=8, name='tube', caps=True):
    """Sweep a circle along a polyline (pipes with bends, rails, cables)."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    rings = []
    for k, p in enumerate(pts):
        ahead = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        side = ahead.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = ahead.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(ahead).normalized()
        rings.append([bm.verts.new(p + radius * (math.cos(TAU * i / segments) * side + math.sin(TAU * i / segments) * up))
                      for i in range(segments)])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, texture_set, colour)


def torus(radius, thickness, centre=(0, 0, 0), texture_set='steel', colour=0x8a8f94, segments=20, sides=8, axis='y', name='torus'):
    """A ring of `radius` round the `axis`, its tube `thickness` across."""
    bm = bmesh.new()
    rings = []
    for i in range(segments):
        a = TAU * i / segments
        c, s = math.cos(a), math.sin(a)
        ring = []
        for k in range(sides):
            b = TAU * k / sides
            r = radius + thickness / 2 * math.cos(b)
            ring.append(bm.verts.new((r * c, thickness / 2 * math.sin(b), r * s)))
        rings.append(ring)
    for i in range(segments):
        a, b = rings[i], rings[(i + 1) % segments]
        for k in range(sides):
            m = (k + 1) % sides
            bm.faces.new((a[k], a[m], b[m], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    turn = {'y': Euler((0, 0, 0)), 'x': Euler((0, 0, math.pi / 2)), 'z': Euler((math.pi / 2, 0, 0))}[axis]
    bm.transform(turn.to_matrix().to_4x4())
    _place(bm, centre)
    return _object(name, bm, texture_set, colour)


def grid(width, depth, cuts_x, cuts_z, centre=(0, 0, 0), texture_set='sandstone', colour=0xb07d5a, name='grid', shade=None):
    """A flat grid in xz (for displaced ground, mesas, awnings), `cuts` subdivisions a side."""
    bm = bmesh.new()
    verts = [[bm.verts.new((-width / 2 + width * i / cuts_x, 0, -depth / 2 + depth * k / cuts_z))
              for i in range(cuts_x + 1)] for k in range(cuts_z + 1)]
    for k in range(cuts_z):
        for i in range(cuts_x):
            bm.faces.new((verts[k][i], verts[k + 1][i], verts[k + 1][i + 1], verts[k][i + 1]))
    _place(bm, centre)
    return _object(name, bm, texture_set, colour, shade=shade)


def mesh_from(verts, faces, texture_set, colour, name='mesh', flat=True, shade=None):
    """A part from vertex positions (three's frame) and faces (index lists)."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _object(name, bm, texture_set, colour, flat=flat, shade=shade)


# ----------------------------------------------------------------- modifiers

def add_bevel(obj, width, segments=2, angle=40):
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    mod.angle_limit = math.radians(angle)
    mod.use_clamp_overlap = True
    return obj


def add_displace(obj, strength, size, seed=0, kind='CLOUDS', subdivide=0, direction='NORMAL', depth=2):
    """Displace by one of Blender's procedural textures (after an optional simple subdivision)."""
    if subdivide:
        sub = obj.modifiers.new('subdivide', 'SUBSURF')
        sub.subdivision_type = 'SIMPLE'
        sub.levels = sub.render_levels = subdivide
    texture = bpy.data.textures.new(f'{obj.name}-noise', kind)
    texture.noise_scale = size
    if hasattr(texture, 'noise_depth'):
        texture.noise_depth = depth
    mod = obj.modifiers.new('displace', 'DISPLACE')
    mod.texture = texture
    mod.strength = strength
    mod.mid_level = 0.5
    mod.direction = direction
    mod.texture_coords = 'GLOBAL'
    # A seed moves the noise: offset the object's texture space through a helper empty.
    empty = bpy.data.objects.new(f'{obj.name}-seed', None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = (seed * 13.7, seed * 7.3, seed * 3.1)
    mod.texture_coords = 'OBJECT'
    mod.texture_coords_object = empty
    return obj


def add_decimate(obj, ratio):
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = ratio
    return obj


def add_array(obj, count, offset):
    """`count` copies along `offset` (three's frame, metres)."""
    mod = obj.modifiers.new('array', 'ARRAY')
    mod.count = count
    mod.use_relative_offset = False
    mod.use_constant_offset = True
    o = TO_BLENDER.to_3x3() @ Vector(offset)
    mod.constant_offset_displace = o
    return obj


# ------------------------------------------------------------------- export

def _uvs(p, n, tile):
    """The level's planar UVs (render/surfaces.ts `planarUVs`): per triangle, in `tile` metres, three's frame."""
    nx, ny, nz = n
    if abs(ny) >= max(abs(nx), abs(nz)):
        t = np.array([1.0, 0.0, 0.0]) - n * nx
        t /= np.linalg.norm(t)
        s = np.cross(n, t)
    else:
        s = np.array([0.0, 1.0, 0.0]) - n * ny
        s /= np.linalg.norm(s)
        t = np.cross(s, n)
    return np.stack([p @ t, p @ s], axis=1) / tile


def _triangles(obj):
    """The evaluated object's triangles in three's frame: corners (n, 3, 3), corner normals (n, 3, 3), face normals (n, 3)."""
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    if obj.get('flat'):
        for poly in mesh.polygons:
            poly.use_smooth = False
    else:
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=math.radians(38))
    mesh.calc_loop_triangles()
    matrix = TO_THREE @ obj.matrix_world
    normal_matrix = matrix.to_3x3().inverted().transposed()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    loops = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get('vertex_index', loops)
    tri_loops = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get('loops', tri_loops)
    corner = np.empty(len(mesh.loops) * 3)
    mesh.corner_normals.foreach_get('vector', corner)
    corner = corner.reshape(-1, 3)
    evaluated.to_mesh_clear()
    m = np.array(matrix)
    nm = np.array(normal_matrix)
    p = co[loops[tri_loops]] @ m[:3, :3].T + m[:3, 3]
    nrm = corner[tri_loops] @ nm.T
    nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
    p = p.reshape(-1, 3, 3)
    face = np.cross(p[:, 2] - p[:, 1], p[:, 0] - p[:, 1])
    area = np.linalg.norm(face, axis=1)
    keep = area > 1e-10
    face = face[keep] / area[keep, None]
    return p[keep], nrm.reshape(-1, 3, 3)[keep], face


def export(script, out, preview=False):
    """Write every piece made so far (see the module's docstring)."""
    folder = os.path.join(out, script)
    os.makedirs(folder, exist_ok=True)
    data, index, offset = [], {}, 0
    for pc in PIECES:
        runs, lo, hi = {}, np.full(3, np.inf), np.full(3, -np.inf)
        for obj in pc.parts:
            corners, normals, faces = _triangles(obj)
            if len(corners) == 0:
                continue
            lo, hi = np.minimum(lo, corners.reshape(-1, 3).min(0)), np.maximum(hi, corners.reshape(-1, 3).max(0))
            texture_set = obj['set']
            sets = np.array([texture_set] * len(corners), dtype=object)
            uv = np.zeros((len(corners), 3, 2))
            for i, (tri, n) in enumerate(zip(corners, faces)):
                uv[i] = _uvs(tri, n, TILES.get(texture_set if texture_set != SIGNS else 'painted-metal', 1.0))
            if obj['sign']:
                # The face towards +z runs 0..1 over its own bounds: the placement's cell of the signs atlas.
                front = faces[:, 2] > 0.9
                if front.any():
                    pts = corners[front].reshape(-1, 3)
                    x0, x1, y0, y1 = pts[:, 0].min(), pts[:, 0].max(), pts[:, 1].min(), pts[:, 1].max()
                    uv[front, :, 0] = (corners[front, :, 0] - x0) / max(x1 - x0, 1e-6)
                    uv[front, :, 1] = (corners[front, :, 1] - y0) / max(y1 - y0, 1e-6)
                    sets[front] = SIGNS
                    sets[~front] = 'painted-metal'
            base = np.array(obj['colour'], dtype=np.float64)
            shade = _shades.get(obj.name)
            colours = np.empty((len(corners), 3, 3))
            for i in range(len(corners)):
                for k in range(3):
                    colours[i, k] = shade(corners[i, k]) if shade else base
            for name in sorted(set(sets)):
                mask = sets == name
                block = np.concatenate([corners[mask], normals[mask], uv[mask], colours[mask]], axis=2).reshape(-1, 11)
                runs.setdefault(name, []).append(block)
        parts = []
        for name in sorted(runs):
            block = np.concatenate(runs[name]).astype(np.float32)
            data.append(block)
            count = len(block) // 3
            parts.append({'set': name, 'first': offset, 'count': count})
            offset += count
        index[pc.name] = {'small': pc.small, 'backdrop': pc.backdrop, 'min': [round(v, 4) for v in lo], 'max': [round(v, 4) for v in hi],
                          'triangles': sum(p['count'] for p in parts), 'parts': parts}
        print(f'{pc.name}: {index[pc.name]["triangles"]} triangles, sets {", ".join(p["set"] for p in parts)}')
    with open(os.path.join(folder, 'mesh.bin'), 'wb') as file:
        file.write(np.concatenate(data).astype('<f4').tobytes())
    with open(os.path.join(folder, 'pieces.json'), 'w') as file:
        json.dump({'script': script, 'pieces': index}, file, indent=1)
    if preview:
        _preview(folder)


def _preview(folder):
    """A contact sheet of every piece (Workbench, vertex colours) for checking the models by eye."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    scene.display.shading.show_cavity = True
    cols = math.ceil(math.sqrt(len(PIECES)))
    spacing = 0
    for pc in PIECES:
        size = max((max(o.dimensions) for o in pc.parts), default=1)
        spacing = max(spacing, min(size, 8) * 1.3)
    for i, pc in enumerate(PIECES):
        dx, dy = (i % cols) * spacing, -(i // cols) * spacing
        for obj in pc.parts:
            obj.location = (obj.location[0] + dx, obj.location[1] + dy, obj.location[2])
            c = obj['colour']
            obj.color = (*(x ** (1 / 2.2) for x in c), 1)
    cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = cols * spacing * 1.05
    rows = math.ceil(len(PIECES) / cols)
    cam.location = ((cols - 1) * spacing / 2 - spacing * 0.6, -(rows - 1) * spacing / 2 - spacing * 2.2, spacing * 2.5)
    cam.rotation_euler = (math.radians(52), 0, math.radians(-12))
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = 1600
    scene.render.filepath = os.path.join(folder, 'preview.png')
    bpy.ops.render.render(write_still=True)

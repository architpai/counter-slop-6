"""
Baked lighting for the realistic tiers (docs/VISUALS.md, R3).

Bakes each exported map (tools/lightmaps/export.ts wrote tools/lightmaps/.build/<name>/mesh.*)
with Cycles, under that map's own physical sky and sun (tools/blender/sky.py: public/sky/<sky>/
env.hdr and sky.json, in the same units: a white horizontal surface in full sun has radiance 1):

  lightmap   sky light and every bounce (the sun's included) on the static level, as the radiance
             of a white surface; NOT the sun's direct light, which the game draws with its dynamic
             sun and shadow maps (baking it too would light sunlit walls twice)
  AO map     the lightmap's brightness over the sky probe's for the same face (the light the game
             used before R3): how much of the open sky's light reaches each texel, bounce included
  probes     an ambient cube (six directions) of the same light on a 3D grid over the map, for
             enemies, the view model and props, which move and so cannot be lightmapped

Two Cycles passes give that split: every indirect path with the sun in the scene, then direct
light with the sun hidden (the sky's own). A light's ray visibility cannot do it: switching the
sun off for diffuse rays also drops its bounce. The lightmap is denoised with OIDN (the
compositor's Denoise node), with each chart's cell as a distinct albedo and its normal as aux
images, so the filter stops at chart edges; then every chart's light is pushed out into its own
padding (the atlas's gutters), so bilinear filtering and the mip levels in use never read another
chart. Probe cells inside solid geometry (rays mostly meet back faces) take their neighbours' light.

Writes to tools/lightmaps/.build/<name>/, for tools/lightmaps/build.mjs to encode:
  light-2048-L0..2.rgba, light-1024-L0..1.rgba, ao-512-L0.rgba   RGBA8, sRGB of value / scale,
                                                                  row 0 at v = 0 (the atlas's)
  probes.rgba                RGBA8 3D texture: x, then z, then (face, y); faces +x -x +y -y +z -z;
                             alpha is the cell's share of sun (the same on all six faces)
  bake.json                  scales, timings, sample counts, sanity numbers
  light.png                  a preview of the lightmap

Run through `npm run lightmaps` (it exports first), or on its own:
  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/bake_level.py -- downtown
Options after the names: --quick (a few samples, to check the pipeline), --cpu.
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUILD = os.path.join(ROOT, 'tools', 'lightmaps', '.build')

# Samples per texel: the indirect pass is the noisy one; the sky's direct light converges fast.
SAMPLES_INDIRECT = 4096
SAMPLES_DIRECT = 1024
BOUNCES = 4
# The sun's angular diameter (degrees): soft bounce from sunlit edges.
SUN_ANGLE = 0.53
LUMA = np.array([0.2126, 0.7152, 0.0722])
# Scales are rounded up to two significant digits; the lightmap keeps its brightest 0.05 % clipped.
CLIP_PERCENTILE = 99.95
# The AO map stores ratios up to this: bounce lifts shade above the open sky's, most on faces
# looking down at sunlit ground (eaves, a balcony's underside), where the sky probe is dim.
AO_SCALE = 4.0
# Probe cells: rays per cell for the inside test, and the share of back faces that marks it inside.
PROBE_RAYS = [Vector(v).normalized() for v in [
    (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
    (1, 1, 1), (1, 1, -1), (1, -1, 1), (1, -1, -1), (-1, 1, 1), (-1, 1, -1), (-1, -1, 1), (-1, -1, -1)]]
INSIDE_SHARE = 0.3
# Faces +x -x +y -y +z -z in three's axes.
FACES = np.array([(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)], dtype=np.float64)


def to_blender(v):
    """three (x, y up, z) to Blender (x, y, z up); arrays of points too."""
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[..., 0], -v[..., 2], v[..., 1]], axis=-1)


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


def round_up(value):
    """Two significant digits, rounded up."""
    digits = 10 ** (1 - math.floor(math.log10(value)))
    return math.ceil(value * digits) / digits


def reset(gpu):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    device = 'CPU'
    if gpu:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
            except TypeError:
                continue
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                device = f'GPU ({kind}: {", ".join(d.name for d in gpus)})'
                scene.cycles.device = 'GPU'
                break
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = BOUNCES
    scene.cycles.diffuse_bounces = BOUNCES
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    scene.cycles.transparent_max_bounces = 0
    scene.cycles.sample_clamp_indirect = 0
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    scene.view_settings.view_transform = 'Standard'
    return scene, device


def add_world(scene, sky):
    world = bpy.data.worlds.new('sky')
    scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    # env.hdr is in three's equirect layout, which is also Blender's (tools/blender/sky.py): +x at the centre.
    env = nodes.new('ShaderNodeTexEnvironment')
    env.image = bpy.data.images.load(os.path.join(ROOT, 'public', 'sky', sky, 'env.hdr'))
    env.image.colorspace_settings.name = 'Linear Rec.709'
    background = nodes.new('ShaderNodeBackground')
    output = nodes.new('ShaderNodeOutputWorld')
    links.new(env.outputs['Color'], background.inputs['Color'])
    links.new(background.outputs['Background'], output.inputs['Surface'])


def add_sun(scene, data):
    sun = np.array(data['sun'], dtype=np.float64)
    peak = float(sun.max())
    light = bpy.data.lights.new('sun', 'SUN')
    # Strength is the normal irradiance, as the game's directional light (colour x intensity).
    light.energy = peak
    light.color = tuple(sun / peak)
    light.angle = math.radians(SUN_ANGLE)
    obj = bpy.data.objects.new('sun', light)
    # A sun shines down its local -Z: point +Z at the sun.
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector(to_blender(data['sunDir'])).to_track_quat('Z', 'Y')
    scene.collection.objects.link(obj)
    return obj


def bake_image(name, width, height):
    image = bpy.data.images.new(name, width, height, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    image.generated_color = (0, 0, 0, 0)
    return image


def bake_material(name, color, image):
    material = bpy.data.materials.new(name)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    bsdf = nodes.new('ShaderNodeBsdfDiffuse')
    bsdf.inputs['Color'].default_value = (*color, 1)
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    target = nodes.new('ShaderNodeTexImage')
    target.image = image
    nodes.active = target
    return material


def triangle_mesh(name, points, corners, uvs):
    """A mesh of separate polygons with `corners` vertices each, straight from arrays (from_pydata is slow)."""
    count = len(points) // corners
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(points))
    mesh.vertices.foreach_set('co', points.astype(np.float32).ravel())
    mesh.loops.add(len(points))
    mesh.loops.foreach_set('vertex_index', np.arange(len(points), dtype=np.int32))
    mesh.polygons.add(count)
    mesh.polygons.foreach_set('loop_start', np.arange(0, len(points), corners, dtype=np.int32))
    layer = mesh.uv_layers.new(name='lightmap')
    layer.data.foreach_set('uv', uvs.astype(np.float32).ravel())
    mesh.update()
    return mesh


def add_level(scene, spec, image):
    """The level as two objects sharing the lightmap: solid pieces, and decals that are baked but
    invisible to every other ray (export.ts `THIN`), so they neither shade nor light the level."""
    raw = open(os.path.join(BUILD, spec['name'], 'mesh.bin'), 'rb').read()
    n = spec['triangles']
    positions = np.frombuffer(raw, dtype=np.float32, count=9 * n).reshape(n, 9)
    uvs = np.frombuffer(raw, dtype=np.float32, count=6 * n, offset=36 * n).reshape(n, 6)
    materials = np.frombuffer(raw, dtype=np.uint16, count=n, offset=60 * n)
    thin = np.frombuffer(raw, dtype=np.uint8, count=n, offset=62 * n).astype(bool)
    shared = [bake_material(f'm{i}', tuple(np.array(m['albedo']) * (1 - m['metal'])), image) for i, m in enumerate(spec['materials'])]
    objects = []
    for name, pick in (('level', ~thin), ('decals', thin)):
        if not pick.any():
            continue
        mesh = triangle_mesh(name, to_blender(positions[pick].reshape(-1, 3)), 3, uvs[pick].reshape(-1, 2))
        for material in shared:
            mesh.materials.append(material)
        mesh.polygons.foreach_set('material_index', materials[pick].astype(np.int32))
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        if name == 'decals':
            for flag in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
                setattr(obj, flag, False)
        scene.collection.objects.link(obj)
        objects.append(obj)
    return objects


def probe_layout(grid):
    nx, ny, nz = grid['cells']
    count = nx * ny * nz * 6
    width = int(math.ceil(math.sqrt(count)))
    return width, int(math.ceil(count / width))


def probe_centres(grid):
    """Cell centres in three's axes, in the runtime texture's order: x fastest, then z, then y."""
    nx, ny, nz = grid['cells']
    cell, (x0, y0, z0) = grid['cell'], grid['min']
    y, z, x = np.meshgrid(np.arange(ny), np.arange(nz), np.arange(nx), indexing='ij')
    return np.stack([x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell, z0 + (z + 0.5) * cell], axis=-1).reshape(-1, 3)


def add_probes(scene, grid, image):
    """
    One tiny quad per cell and face, facing out, each over its own texel. Invisible to every ray
    but the bake's own (camera visibility: a bake skips an object without it), so the probes
    neither shade nor light the level or each other.
    """
    centres = probe_centres(grid)
    width, height = image.size
    cells = len(centres)
    size = 0.02
    points, uvs = [], []
    for f, normal in enumerate(FACES):
        # Two axes across the face, wound so the quad faces along the normal.
        a = np.roll(np.abs(normal), 1)
        b = np.cross(normal, a)
        corners = np.array([-a - b, a - b, a + b, -a + b])
        points.append(centres[:, None, :] + normal * 0.05 + corners[None] * size)
        # Each quad's UVs cover the middle of its texel, so the texel centre is on it.
        index = f * cells + np.arange(cells)
        tx, ty = index % width, index // width
        box = np.array([(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)])
        uvs.append((np.stack([tx, ty], axis=-1)[:, None, :] + box[None]) / np.array([width, height]))
    mesh = triangle_mesh('probes', to_blender(np.concatenate(points).reshape(-1, 3)), 4, np.concatenate(uvs).reshape(-1, 2))
    mesh.materials.append(bake_material('probe', (1, 1, 1), image))
    obj = bpy.data.objects.new('probes', mesh)
    for flag in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(obj, flag, False)
    scene.collection.objects.link(obj)
    return obj


def probe_rays(level, grid, sun_dir):
    """
    Per cell: is its centre inside solid geometry (most rays from it meet a back face first), and
    the share of 8 points round it (a quarter cell out) that see the sun. The game dims the direct
    sun by that share on what cannot receive shadows (the view model).
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(level, depsgraph)
    centres = to_blender(probe_centres(grid))
    sun = Vector(to_blender(np.asarray(sun_dir, dtype=np.float64))).normalized()
    quarter = grid['cell'] / 4
    offsets = [Vector((x, y, z)) * quarter for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    inside = np.zeros(len(centres), dtype=bool)
    lit = np.zeros(len(centres))
    for i, centre in enumerate(centres):
        origin = Vector(centre)
        back = 0
        for ray in PROBE_RAYS:
            hit, normal, _, _ = tree.ray_cast(origin, ray, 400.0)
            if hit is not None and normal.dot(ray) > 0:
                back += 1
        inside[i] = back >= INSIDE_SHARE * len(PROBE_RAYS)
        lit[i] = sum(tree.ray_cast(origin + offset, sun, 1000.0)[0] is None for offset in offsets) / len(offsets)
    return inside, lit


def pixels(image):
    width, height = image.size
    data = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(height, width, 4).astype(np.float64)


def bake(scene, objects, active, pass_filter, samples):
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=pass_filter, margin=0, use_clear=True, target='IMAGE_TEXTURES')


def cell_maps(spec, size):
    """Per texel: the index of the chart whose cell holds it (-1 in no cell), and that chart's normal."""
    ids = np.full((size, size), -1, dtype=np.int32)
    normals = np.zeros((size, size, 3))
    for i, (x, y, w, h, nx, ny, nz, *_) in enumerate(spec['charts']):
        ids[y:y + h, x:x + w] = i
        normals[y:y + h, x:x + w] = (nx, ny, nz)
    return ids, normals


def dilate(values, known, ids, steps):
    """Fill unknown texels from known 4- and 8-neighbours in the same cell, `steps` rings out."""
    values = values.copy()
    known = known.copy()
    height, width = known.shape
    for _ in range(steps):
        total = np.zeros_like(values)
        count = np.zeros(known.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                ys = slice(max(dy, 0), height + min(dy, 0))
                yd = slice(max(-dy, 0), height + min(-dy, 0))
                xs = slice(max(dx, 0), width + min(dx, 0))
                xd = slice(max(-dx, 0), width + min(-dx, 0))
                ok = known[ys, xs] & (ids[ys, xs] == ids[yd, xd]) & (ids[yd, xd] >= 0)
                total[yd, xd] += values[ys, xs] * ok[..., None]
                count[yd, xd] += ok
        grow = ~known & (count > 0)
        if not grow.any():
            break
        values[grow] = total[grow] / count[grow][:, None]
        known = known | grow
    return values, known


def denoise(scene, noisy, albedo, normal):
    """OIDN through the compositor: noisy HDR image plus albedo and normal aux images."""
    height, width = noisy.shape[:2]
    def image(name, rgb):
        img = bpy.data.images.new(name, width, height, alpha=True, float_buffer=True)
        img.colorspace_settings.name = 'Non-Color'
        rgba = np.ones((height, width, 4), dtype=np.float32)
        rgba[..., :3] = rgb
        img.pixels.foreach_set(rgba.ravel())
        return img
    tree = bpy.data.node_groups.new('denoise', 'CompositorNodeTree')
    scene.compositing_node_group = tree
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    out = tree.nodes.new('NodeGroupOutput')
    node = tree.nodes.new('CompositorNodeDenoise')
    node.inputs['HDR'].default_value = True
    node.inputs['Prefilter'].default_value = 'None'
    node.inputs['Quality'].default_value = 'High'
    for socket, name, rgb in (('Image', 'noisy', noisy), ('Albedo', 'albedo', albedo), ('Normal', 'normal', normal)):
        source = tree.nodes.new('CompositorNodeImage')
        source.image = image(name, rgb)
        tree.links.new(source.outputs['Image'], node.inputs[socket])
    tree.links.new(node.outputs['Image'], out.inputs['Image'])
    render = scene.render
    render.resolution_x, render.resolution_y, render.resolution_percentage = width, height, 100
    render.use_compositing = True
    render.image_settings.file_format = 'OPEN_EXR'
    render.image_settings.color_depth = '32'
    render.filepath = os.path.join(BUILD, 'denoised.exr')
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    # The render itself is thrown away (one sample, nothing visible): only the composite is kept.
    hidden = [obj for obj in scene.objects if obj.type == 'MESH' and not obj.hide_render]
    for obj in hidden:
        obj.hide_render = True
    samples = scene.cycles.samples
    scene.cycles.samples = 1
    bpy.ops.render.render(write_still=True)
    scene.cycles.samples = samples
    for obj in hidden:
        obj.hide_render = False
    result = bpy.data.images.load(render.filepath, check_existing=False)
    out_pixels = pixels(result)[..., :3]
    bpy.data.images.remove(result)
    os.remove(render.filepath)
    return out_pixels


def sh_irradiance(sh, normal):
    """three's shGetIrradianceAt, for three-axis normals (..., 3); sh is 9 x RGB."""
    x, y, z = normal[..., 0], normal[..., 1], normal[..., 2]
    c = np.asarray(sh, dtype=np.float64)
    terms = [
        0.886227 * np.ones_like(x), 2.0 * 0.511664 * y, 2.0 * 0.511664 * z, 2.0 * 0.511664 * x,
        2.0 * 0.429043 * x * y, 2.0 * 0.429043 * y * z, 0.743125 * z * z - 0.247708, 2.0 * 0.429043 * x * z,
        0.429043 * (x * x - y * y),
    ]
    return sum(t[..., None] * c[i] for i, t in enumerate(terms))


def probe_light(cubes, grid, point, normal):
    """The ambient cube of the cell holding `point` (three axes), seen by a face with `normal`."""
    nx, ny, nz = grid['cells']
    index = [int(np.clip((point[a] - grid['min'][a]) // grid['cell'], 0, n - 1)) for a, n in enumerate((nx, ny, nz))]
    cube = cubes[:, index[1], index[2], index[0]]
    n = np.asarray(normal, dtype=np.float64)
    return sum(n[a] ** 2 * cube[2 * a + (0 if n[a] >= 0 else 1)] for a in range(3))


def box_down(values):
    height, width = values.shape[:2]
    return values.reshape(height // 2, 2, width // 2, 2, -1).mean(axis=(1, 3))


def write_rgba(path, rgb, alpha=None):
    """RGB in [0, 1] (already encoded) and an optional linear alpha to raw RGBA8, rows as given (row 0 at v = 0)."""
    height, width = rgb.shape[:2]
    rgba = np.full((height, width, 4), 255, dtype=np.uint8)
    rgba[..., :3] = np.round(np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    if alpha is not None:
        rgba[..., 3] = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    rgba.tofile(path)


def preview(path, rgb):
    height, width = rgb.shape[:2]
    image = bpy.data.images.new('preview', width, height, alpha=False)
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[..., :3] = rgb
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)


def run(name, quick, gpu):
    started = time.time()
    folder = os.path.join(BUILD, name)
    spec = json.load(open(os.path.join(folder, 'mesh.json')))
    sky = json.load(open(os.path.join(ROOT, 'public', 'sky', spec['sky'], 'sky.json')))
    scene, device = reset(gpu)
    add_world(scene, spec['sky'])
    sun = add_sun(scene, sky)
    size = spec['size']
    light_image = bake_image('lightmap', size, size)
    levels = add_level(scene, spec, light_image)
    level = levels[0]
    probe_width, probe_height = probe_layout(spec['grid'])
    probe_image = bake_image('probes', probe_width, probe_height)
    probes = add_probes(scene, spec['grid'], probe_image)
    setup = time.time() - started

    scale = 0.05 if quick else 1
    timings = {}
    # Pass 1: every bounce, the sun's included.
    t = time.time()
    bake(scene, [*levels, probes], level, {'INDIRECT'}, max(4, int(SAMPLES_INDIRECT * scale)))
    indirect, probe_indirect = pixels(light_image), pixels(probe_image)
    timings['indirect'] = time.time() - t
    # Pass 2: direct light with the sun hidden: the sky's own.
    t = time.time()
    sun.hide_render = True
    bake(scene, [*levels, probes], level, {'DIRECT'}, max(4, int(SAMPLES_DIRECT * scale)))
    direct, probe_direct = pixels(light_image), pixels(probe_image)
    sun.hide_render = False
    timings['direct'] = time.time() - t

    # Probes: ambient cubes, cells inside geometry filled from their neighbours.
    t = time.time()
    nx, ny, nz = spec['grid']['cells']
    cells = nx * ny * nz
    flat = (probe_indirect[..., :3] + probe_direct[..., :3]).reshape(-1, 3)[:6 * cells].reshape(6, ny, nz, nx, 3)
    inside, lit = probe_rays(level, spec['grid'], sky['sunDir'])
    inside = inside.reshape(ny, nz, nx)
    # The sun share rides along as a seventh face while cells inside geometry are filled.
    flat = np.concatenate([flat, np.repeat(lit.reshape(1, ny, nz, nx, 1), 3, axis=-1)])
    valid = ~inside
    for _ in range(max(nx, ny, nz)):
        if valid.all():
            break
        total = np.zeros_like(flat)
        count = np.zeros((ny, nz, nx))
        for axis in range(3):
            for step in (-1, 1):
                shifted = np.roll(flat, step, axis=axis + 1)
                ok = np.roll(valid, step, axis=axis)
                # np.roll wraps; drop the wrapped layer.
                edge = [slice(None)] * 3
                edge[axis] = 0 if step == 1 else -1
                ok[tuple(edge)] = False
                total += shifted * ok[None, ..., None]
                count += ok
        grow = ~valid & (count > 0)
        flat[:, grow] = total[:, grow] / count[grow][None, :, None]
        valid |= grow
    flat, lit = flat[:6], flat[6, ..., 0]
    probe_scale = round_up(float(np.percentile(flat.max(axis=-1), CLIP_PERCENTILE)))
    encoded = srgb(flat / probe_scale).reshape(6 * ny * nz * nx, 3)
    alpha = np.broadcast_to(lit[None], (6, ny, nz, nx)).reshape(6 * ny * nz * nx)
    write_rgba(os.path.join(folder, 'probes.rgba'), encoded[None, ...], alpha[None, ...])
    timings['probes'] = time.time() - t

    known = indirect[..., 3] > 0.5
    light = indirect[..., :3] + direct[..., :3]
    ids, normals = cell_maps(spec, size)
    # Every chart shows a texel: the packer stretches small ones to one.
    covered = np.zeros(len(spec['charts']), dtype=bool)
    covered[np.unique(ids[known & (ids >= 0)])] = True
    empty = int((~covered).sum())
    # Except a sliver whose triangles miss every texel centre: its cell takes the probe grid's light there.
    for i in np.flatnonzero(~covered):
        x, y, w, h, *normal_centre = spec['charts'][i]
        light[y:y + h, x:x + w] = probe_light(flat, spec['grid'], normal_centre[3:], normal_centre[:3])
        known[y:y + h, x:x + w] = True

    t = time.time()
    steps = spec['padding'] + 2
    light, _ = dilate(light, known, ids, steps)
    rng = np.random.default_rng(7)
    colours = rng.uniform(0.1, 0.9, (len(spec['charts']) + 1, 3))
    albedo = colours[ids]
    light = denoise(scene, light, albedo, to_blender(normals) * 0.5 + 0.5)
    light = np.clip(light, 0, None)
    # Far enough that every mip block in use near a chart is filled (two blocks of the smallest level).
    light, filled = dilate(light, known, ids, 2 * spec['align'] + 2)
    # What no chart reaches is never sampled; keep it black.
    light[~filled] = 0
    timings['denoise'] = time.time() - t

    # Sanity: on the most open upward faces the sky's direct light is the probe's irradiance straight up.
    up = known & (normals[..., 1] > 0.99)
    sky_up = float(sh_irradiance(sky['sh'], np.array([0.0, 1.0, 0.0])) @ LUMA) / math.pi
    open_sky = float(np.percentile((direct[..., :3] @ LUMA)[up], 99)) if up.any() else 0.0

    # Encodings.
    content = light[known] @ LUMA
    scale_light = round_up(float(np.percentile(light[known].max(axis=1), CLIP_PERCENTILE)))
    probe_sky = sh_irradiance(sky['sh'], normals) @ LUMA / math.pi
    ratio = np.where(filled, (light @ LUMA) / np.maximum(probe_sky, 1e-4), 0)
    levels = [light]
    for _ in range(2):
        levels.append(box_down(levels[-1]))
    ratios = [ratio[..., None]]
    ratios.append(box_down(ratios[-1]))
    ratios.append(box_down(ratios[-1]))
    for level_index, values in enumerate(levels):
        write_rgba(os.path.join(folder, f'light-2048-L{level_index}.rgba'), srgb(values / scale_light))
        if level_index >= 1:
            write_rgba(os.path.join(folder, f'light-1024-L{level_index - 1}.rgba'), srgb(values / scale_light))
    # The AO map is low-frequency: a quarter size, one level (render/lightmap.ts `bakeMips`).
    write_rgba(os.path.join(folder, 'ao-512-L0.rgba'), np.repeat(srgb(ratios[2] / AO_SCALE), 3, axis=-1))
    preview(os.path.join(folder, 'light.png'), srgb(light / scale_light))

    seconds = time.time() - started
    record = {
        'name': name, 'device': device, 'quick': quick, 'sky': spec['sky'], 'sun': sky['sun'],
        'samples': {'indirect': max(4, int(SAMPLES_INDIRECT * scale)), 'direct': max(4, int(SAMPLES_DIRECT * scale))},
        'scale': scale_light, 'aoScale': AO_SCALE, 'probeScale': probe_scale,
        'seconds': round(seconds, 1), 'setup': round(setup, 1), 'timings': {k: round(v, 1) for k, v in timings.items()},
        'emptyCharts': empty, 'insideProbes': int(inside.sum()), 'probes': cells, 'sunlitProbes': round(float(lit.mean()), 3),
        'skyUp': round(sky_up, 4), 'openSkyDirect': round(open_sky, 4),
        'medianLight': round(float(np.median(content)), 4),
    }
    json.dump(record, open(os.path.join(folder, 'bake.json'), 'w'), indent=1)
    print(f'BAKE {name}: {seconds:.0f} s on {device} {record["timings"]}, scale {scale_light}, probes {probe_scale}, '
          f'empty charts {empty}, probes inside {record["insideProbes"]}/{cells}, sky up {sky_up:.3f} vs open {open_sky:.3f}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = [a for a in argv if not a.startswith('--')]
    if not names:
        names = sorted(d for d in os.listdir(BUILD) if os.path.exists(os.path.join(BUILD, d, 'mesh.json')))
    for name in names:
        run(name, '--quick' in argv, '--cpu' not in argv)


main()

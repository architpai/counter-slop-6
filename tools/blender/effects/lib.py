"""
Shared building blocks for the effect atlases (docs/VISUALS.md, R5).

Each script (fire.py, smoke.py, decals.py) fills the cells of one or two atlases
and hands them to `write_atlas`. Nothing is read from disk: every cell is a
Cycles render of a procedural volume (fire, flashes, sparks, smoke, dust), of
a procedurally displaced mesh (chips, splinters, shards) or an EMIT bake of a
procedural node graph (the decals). Every graph is built here, in Python.

`VolumeGraph` wraps a node tree so the scripts can write field maths as
expressions (`g.smooth(r, 0.4, 0.9) * g.noise(p, 3, w)`), and `render_cell`
renders the scene through an orthographic camera to a float array: linear,
premultiplied by the film's alpha, rows bottom first (row 0 is v = 0, as WebGL
uploads a texture with flipY off, the KTX2 default).

`write_atlas` lays cells out on the atlas grid (left to right, bottom row
first, so cell i sits at column i % cols, row i // cols from the bottom) and
writes the three sizes the game ships: raw RGBA8 at 256, 128 and 64 texels a
cell (Ultra, High, Medium), each box-filtered from the render, a PNG preview
and the layout in meta.json. tools/effects/build.mjs encodes them to KTX2.

Run through tools/effects/build.mjs, or one script alone:

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/effects/fire.py -- [--out DIR]
"""

import json
import math
import os
import struct
import sys
import tempfile
import zlib

import bpy
import numpy as np

TAU = 2 * math.pi
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'tools', 'effects', '.build')
#: Texels a cell at each tier: Ultra, High, Medium. The render is at the first.
CELL_SIZES = (256, 128, 64)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = DEFAULT_OUT
    for i, arg in enumerate(argv):
        if arg == '--out':
            out = os.path.abspath(argv[i + 1])
    return out


# ------------------------------------------------------------------- scene

def reset(samples=64, world=(0.0, 0.0, 0.0), world_strength=0.0, denoise=False):
    """An empty Cycles scene on the GPU with a transparent film and a plain linear view."""
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.images):
        for item in list(block):
            block.remove(item)
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
    scene.cycles.samples = samples
    # OIDN on the scattering volumes: at a few hundred samples their thin edges are still grainy.
    scene.cycles.use_denoising = denoise
    scene.cycles.max_bounces = 4
    scene.cycles.volume_bounces = 1
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.volume_step_rate = 0.5
    scene.cycles.volume_preview_step_rate = 0.5
    scene.cycles.volume_max_steps = 512
    scene.cycles.pixel_filter_type = 'BLACKMAN_HARRIS'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    if scene.world is None:
        scene.world = bpy.data.worlds.new('world')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (*world, 1.0)
    background.inputs['Strength'].default_value = world_strength
    return scene


def camera(location, look_at, ortho_scale):
    """An orthographic camera at `location` looking at `look_at`, `ortho_scale` metres across."""
    data = bpy.data.cameras.new('camera')
    data.type = 'ORTHO'
    data.ortho_scale = ortho_scale
    data.clip_start = 0.01
    data.clip_end = 100
    cam = bpy.data.objects.new('camera', data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = location
    direction = np.subtract(look_at, location)
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def sun(direction, strength, colour=(1.0, 1.0, 1.0), angle=0.2):
    """A sun lamp shining along `direction` (towards where the light goes)."""
    import mathutils
    data = bpy.data.lights.new('sun', 'SUN')
    data.energy = strength
    data.color = colour
    data.angle = angle
    lamp = bpy.data.objects.new('sun', data)
    bpy.context.scene.collection.objects.link(lamp)
    lamp.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    return lamp


def render_cell(size):
    """Render the scene at `size` x `size`: linear RGBA floats, premultiplied, rows bottom first."""
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.color_mode = 'RGBA'
    path = os.path.join(tempfile.gettempdir(), f'cs6-fx-{os.getpid()}.exr')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    pixels = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    os.remove(path)
    return pixels.reshape(size, size, 4).astype(np.float64)


# ------------------------------------------------------------ node graphs

class Value:
    """A node socket (or a number) that builds Math nodes when combined with `+ - * /`."""

    def __init__(self, graph, socket):
        self.g = graph
        self.s = socket

    def _op(self, op, other, swap=False):
        a, b = (other, self) if swap else (self, other)
        return self.g.math(op, a, b)

    def __add__(self, o): return self._op('ADD', o)
    def __radd__(self, o): return self._op('ADD', o, True)
    def __sub__(self, o): return self._op('SUBTRACT', o)
    def __rsub__(self, o): return self._op('SUBTRACT', o, True)
    def __mul__(self, o): return self._op('MULTIPLY', o)
    def __rmul__(self, o): return self._op('MULTIPLY', o, True)
    def __truediv__(self, o): return self._op('DIVIDE', o)
    def __rtruediv__(self, o): return self._op('DIVIDE', o, True)
    def __pow__(self, o): return self._op('POWER', o)
    def __neg__(self): return self.g.math('MULTIPLY', self, -1.0)


class VolumeGraph:
    """A material's node tree built from expressions. Sockets come back wrapped in `Value`."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.output = self.node('ShaderNodeOutputMaterial')
        # World space for the volumes (a domain cube only bounds them), UV for baked planes.
        position = self.node('ShaderNodeNewGeometry').outputs['Position']
        split = self.node('ShaderNodeSeparateXYZ')
        self.nt.links.new(position, split.inputs[0])
        self.p = position
        self.x, self.y, self.z = (Value(self, split.outputs[k]) for k in ('X', 'Y', 'Z'))
        uv = self.node('ShaderNodeSeparateXYZ')
        self.nt.links.new(self.node('ShaderNodeTexCoord').outputs['UV'], uv.inputs[0])
        self.u, self.v = Value(self, uv.outputs['X']), Value(self, uv.outputs['Y'])
        self.seed = 0

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def put(self, socket, value):
        if isinstance(value, Value):
            value = value.s
        if isinstance(value, bpy.types.NodeSocket):
            self.nt.links.new(value, socket)
        elif isinstance(value, (tuple, list)) and socket.type == 'RGBA':
            socket.default_value = (*value[:3], 1.0)
        elif isinstance(value, (tuple, list)):
            socket.default_value = value
        else:
            socket.default_value = value

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, value in enumerate((a, b, c)):
            self.put(n.inputs[i], value)
        return Value(self, n.outputs[0])

    def clamp(self, a): return self.math('ADD', a, 0.0, clamp=True)
    def min(self, a, b): return self.math('MINIMUM', a, b)
    def max(self, a, b): return self.math('MAXIMUM', a, b)
    def abs(self, a): return self.math('ABSOLUTE', a)
    def sqrt(self, a): return self.math('SQRT', a)
    def exp(self, a): return self.math('EXPONENT', a)
    def sin(self, a): return self.math('SINE', a)
    def cos(self, a): return self.math('COSINE', a)
    def atan2(self, a, b): return self.math('ARCTAN2', a, b)

    def smooth(self, value, a, b):
        """0 at `a`, 1 at `b` (either order), smoothstepped."""
        n = self.node('ShaderNodeMapRange', clamp=True, interpolation_type='SMOOTHSTEP')
        for key, v in (('Value', value), ('From Min', a), ('From Max', b), ('To Min', 0.0), ('To Max', 1.0)):
            self.put(n.inputs[key], v)
        return Value(self, n.outputs['Result'])

    def length(self, *parts):
        total = None
        for part in parts:
            total = part * part if total is None else total + part * part
        return self.sqrt(total)

    def vector(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        for i, v in enumerate((x, y, z)):
            self.put(n.inputs[i], v)
        return n.outputs[0]

    def noise(self, vector, scale, w, detail=5.0, roughness=0.55, distortion=0.0):
        """4D FBM noise about 0..1 at `vector` (a socket), `scale` features a unit, `w` the fourth axis."""
        self.seed += 1
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D', noise_type='FBM', normalize=True)
        self.put(n.inputs['Vector'], vector)
        self.put(n.inputs['W'], w + self.seed * 7.31)
        for key, value in (('Scale', scale), ('Detail', detail), ('Roughness', roughness), ('Lacunarity', 2.0), ('Distortion', distortion)):
            self.put(n.inputs[key], value)
        return Value(self, n.outputs['Factor'])

    def blackbody(self, kelvin):
        n = self.node('ShaderNodeBlackbody')
        self.put(n.inputs['Temperature'], kelvin)
        return n.outputs['Color']

    def volume(self, density=0.0, colour=(0.8, 0.8, 0.8), emission=0.0, emission_colour=(1.0, 1.0, 1.0), anisotropy=0.0):
        """Principled Volume into the material's volume output."""
        n = self.node('ShaderNodeVolumePrincipled')
        self.put(n.inputs['Density'], density)
        self.put(n.inputs['Color'], colour)
        self.put(n.inputs['Emission Strength'], emission)
        self.put(n.inputs['Emission Color'], emission_colour)
        self.put(n.inputs['Anisotropy'], anisotropy)
        self.nt.links.new(n.outputs[0], self.output.inputs['Volume'])
        return n


def domain(material, size=(2.0, 2.0, 2.0), location=(0.0, 0.0, 0.0)):
    """A box of `size` metres at `location` holding a volume material (the field itself is in world space)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    cube = bpy.context.active_object
    cube.scale = size
    cube.data.materials.append(material)
    return cube


def bake_plane(graph, channels, size):
    """
    EMIT-bake each socket of `channels` ({'albedo': socket, ...}) over a 1 x 1
    plane whose UVs run 0..1: float arrays (size, size, 3), rows bottom first.
    `graph` must have been built with `VolumeGraph` (its `u`, `v`).
    """
    scene = bpy.context.scene
    scene.cycles.samples = 16
    scene.render.bake.margin = 0
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    plane.data.materials.append(graph.mat)
    emit = graph.node('ShaderNodeEmission')
    graph.nt.links.new(emit.outputs['Emission'], graph.output.inputs['Surface'])
    image = bpy.data.images.new('bake', size, size, float_buffer=True, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    target = graph.node('ShaderNodeTexImage')
    target.image = image
    graph.nt.nodes.active = target
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane
    baked = {}
    for key, value in channels.items():
        for link in list(emit.inputs['Color'].links):
            graph.nt.links.remove(link)
        socket = value.s if isinstance(value, Value) else value
        if isinstance(socket, bpy.types.NodeSocket):
            graph.nt.links.new(socket, emit.inputs['Color'])
        else:
            v = socket if isinstance(socket, (tuple, list)) else (socket, socket, socket)
            emit.inputs['Color'].default_value = (*v, 1.0)
        bpy.ops.object.bake(type='EMIT', use_clear=True)
        pixels = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        baked[key] = pixels.reshape(size, size, 4)[:, :, :3].astype(np.float64)
    bpy.data.objects.remove(plane)
    bpy.data.images.remove(image)
    return baked


# ---------------------------------------------------------------- output

def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def u8(x):
    return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)


def down(a, factor):
    if factor == 1:
        return a
    h, w = a.shape[0] // factor, a.shape[1] // factor
    return a.reshape(h, factor, w, factor, *a.shape[2:]).mean(axis=(1, 3))


def blur(a, radius):
    """A separable box blur, `radius` texels, run three times (close to a Gaussian); clamps at the edges."""
    out = a.astype(np.float64)
    for _ in range(3):
        for axis in (0, 1):
            pad = [(0, 0)] * out.ndim
            pad[axis] = (radius, radius)
            padded = np.pad(out, pad, mode='edge')
            c = np.cumsum(padded, axis=axis)
            c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
            n = out.shape[axis]
            out = (np.take(c, range(2 * radius + 1, 2 * radius + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / (2 * radius + 1)
    return out


def straight(premultiplied):
    """
    Premultiplied RGBA to straight colour and alpha. Where the cell is (almost)
    empty the colour is its blurred neighbourhood's, so filtering and mips never
    pull a dark fringe in round an edge.
    """
    rgb, a = premultiplied[:, :, :3], premultiplied[:, :, 3]
    weight = blur(a, 6)[:, :, None]
    fill = blur(rgb, 6) / np.maximum(weight, 1e-4)
    colour = np.where(a[:, :, None] > 0.08, rgb / np.maximum(a[:, :, None], 1e-4), fill)
    return np.clip(colour, 0, 1), np.clip(a, 0, 1)


def png(path, rgb):
    """A minimal 8-bit RGB PNG writer, rows bottom first in, top first out (so previews look right)."""
    h, w, _ = rgb.shape
    rows = b''.join(b'\x00' + rgb[h - 1 - y].tobytes() for y in range(h))
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def write_atlas(out, name, cols, rows, cells, layout, alpha=True, srgb=True):
    """
    Write one atlas. `cells` is a list of (256, 256, 4) uint8 arrays, RGBA,
    rows bottom first, in cell order; missing cells stay transparent black.
    `layout` names runs of cells ({'smoke': [first, count], ...}) for the game.
    `srgb`: the colour channels hold sRGB (a normal map does not).
    """
    full = CELL_SIZES[0]
    atlas = np.zeros((rows * full, cols * full, 4), np.uint8)
    for i, cell in enumerate(cells):
        if cell is None:
            continue
        c, r = i % cols, i // cols
        atlas[r * full:(r + 1) * full, c * full:(c + 1) * full] = cell
    folder = os.path.join(out, name)
    os.makedirs(folder, exist_ok=True)
    meta = {'name': name, 'cols': cols, 'rows': rows, 'alpha': alpha, 'srgb': srgb, 'layout': layout, 'sizes': {}}
    for cell_size in CELL_SIZES:
        f = full // cell_size
        data = atlas.astype(np.float64) / 255
        if f > 1:
            # Colour is sRGB: box-filter it in linear light, so a small tier is as bright as a large one.
            linear = np.where(data[:, :, :3] <= 0.04045, data[:, :, :3] / 12.92, ((data[:, :, :3] + 0.055) / 1.055) ** 2.4)
            data = np.concatenate([to_srgb(down(linear, f)), down(data[:, :, 3:], f)], axis=2) if srgb else down(data, f)
        data = u8(data)
        w, h = cols * cell_size, rows * cell_size
        with open(os.path.join(folder, f'{w}x{h}.rgba'), 'wb') as file:
            file.write(data.tobytes())
        meta['sizes'][str(cell_size)] = [w, h]
        if cell_size == full:
            png(os.path.join(folder, 'preview.png'), data[:, :, :3])
            if alpha:
                png(os.path.join(folder, 'preview-alpha.png'), np.repeat(data[:, :, 3:4], 3, axis=2))
    with open(os.path.join(folder, 'meta.json'), 'w') as file:
        json.dump(meta, file, indent=1)
    print(f'{name}: {cols} x {rows} cells into {folder}')

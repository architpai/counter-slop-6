"""
Shared building blocks for the procedural material scripts (docs/VISUALS.md, R2).

Each material script (concrete.py, brick.py, ...) builds a Cycles node graph
with `Graph` and hands `run()` four channels: albedo (linear RGB), roughness,
metalness and height (metres). Everything tiles: noise and Voronoi run on a
flat torus in 4D (`Graph.torus`), and patterns built from UV maths (bricks,
planks, tiles) use whole counts per tile. Nothing is read from disk: no image,
no downloaded texture, only node graphs.

`run()` bakes each channel with a Cycles EMIT bake of a 1 x 1 plane, then, in
numpy: the normal map from the height's slopes (wrapped at the tile edges, so
the normals tile too), ambient occlusion from how far each texel sits below its
blurred neighbourhood (a cavity term, also wrapped), and the three sizes the
game ships (2048, 1024, 512, each box-filtered from the bake). It writes raw
RGBA8 files, PNG previews and a meta.json into the build folder, which
tools/textures/build.mjs encodes to KTX2 for public/textures/.

Rows are stored bottom first (row 0 is v = 0), which is how WebGL uploads a
texture with flipY off, the KTX2 default; the normal map is tangent space with
+x along u and +y along v (three's convention).

Run through tools/textures/build.mjs, or one material alone:

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/materials/brick.py -- [--size 512] [--out DIR]
"""

import json
import math
import os
import struct
import sys
import zlib

import bpy
import numpy as np

TAU = 2 * math.pi
SIZES = (2048, 1024, 512)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_OUT = os.path.join(ROOT, 'tools', 'textures', '.build')


def srgb(hex_colour):
    """An sRGB hex colour (0xRRGGBB) as linear RGB, the space every node works in."""
    c = [((hex_colour >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _socket(sockets, identifier):
    """Mix nodes repeat socket names per data type; pick one by its identifier."""
    return next(s for s in sockets if s.identifier == identifier)


class Graph:
    """A node graph under construction. Methods take numbers or sockets and return sockets."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.nt = self.mat.node_tree
        self.nt.nodes.clear()
        self.output = self.node('ShaderNodeOutputMaterial')
        self.emit = self.node('ShaderNodeEmission')
        self.link(self.emit.outputs['Emission'], self.output.inputs['Surface'])
        uv = self.node('ShaderNodeSeparateXYZ')
        self.link(self.node('ShaderNodeTexCoord').outputs['UV'], uv.inputs[0])
        self.u, self.v = uv.outputs['X'], uv.outputs['Y']
        # Unit circles around each tile axis; `torus` scales them per call.
        self.cu, self.su = self.cos(self.mul(self.u, TAU)), self.sin(self.mul(self.u, TAU))
        self.cv, self.sv = self.cos(self.mul(self.v, TAU)), self.sin(self.mul(self.v, TAU))
        self.seed = 0

    # ---------------------------------------------------------------- plumbing

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        for key, value in props.items():
            setattr(n, key, value)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def put(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.link(value, socket)
        elif isinstance(value, (tuple, list)) and len(value) == 3 and socket.type == 'RGBA':
            socket.default_value = (*value, 1.0)
        else:
            socket.default_value = value

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, value in enumerate((a, b, c)):
            self.put(n.inputs[i], value)
        return n.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def div(self, a, b): return self.math('DIVIDE', a, b)
    def pow(self, a, b): return self.math('POWER', a, b)
    def min(self, a, b): return self.math('MINIMUM', a, b)
    def max(self, a, b): return self.math('MAXIMUM', a, b)
    def abs(self, a): return self.math('ABSOLUTE', a)
    def floor(self, a): return self.math('FLOOR', a)
    def fract(self, a): return self.math('FRACT', a)
    def sin(self, a): return self.math('SINE', a)
    def cos(self, a): return self.math('COSINE', a)
    def mod(self, a, b): return self.math('FLOORED_MODULO', a, b)
    def madd(self, a, b, c): return self.math('MULTIPLY_ADD', a, b, c)
    def clamp(self, a): return self.math('ADD', a, 0.0, clamp=True)

    def map(self, value, a, b, c=0.0, d=1.0, clamp=True, smooth=False):
        """Map [a, b] to [c, d], clamped by default; `smooth` uses smoothstep."""
        n = self.node('ShaderNodeMapRange', clamp=clamp, interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR')
        for key, v in (('Value', value), ('From Min', a), ('From Max', b), ('To Min', c), ('To Max', d)):
            self.put(n.inputs[key], v)
        return n.outputs['Result']

    def mix(self, fac, a, b):
        """Linear blend of two floats."""
        n = self.node('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self.put(_socket(n.inputs, 'Factor_Float'), fac)
        self.put(_socket(n.inputs, 'A_Float'), a)
        self.put(_socket(n.inputs, 'B_Float'), b)
        return _socket(n.outputs, 'Result_Float')

    def mix_rgb(self, fac, a, b, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_factor=True)
        self.put(_socket(n.inputs, 'Factor_Float'), fac)
        self.put(_socket(n.inputs, 'A_Color'), a)
        self.put(_socket(n.inputs, 'B_Color'), b)
        return _socket(n.outputs, 'Result_Color')

    def scale_rgb(self, colour, factor):
        """Colour times a float (brightness variation)."""
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_factor=True)
        self.put(_socket(n.inputs, 'Factor_Float'), 1.0)
        self.put(_socket(n.inputs, 'A_Color'), colour)
        c = self.node('ShaderNodeCombineXYZ')
        for i in range(3):
            self.put(c.inputs[i], factor)
        self.link(c.outputs[0], _socket(n.inputs, 'B_Color'))
        return _socket(n.outputs, 'Result_Color')

    def ramp(self, fac, stops, interpolation='LINEAR'):
        """A colour ramp; `stops` is [(position, (r, g, b) linear), ...]."""
        n = self.node('ShaderNodeValToRGB')
        ramp = n.color_ramp
        ramp.interpolation = interpolation
        while len(ramp.elements) < len(stops):
            ramp.elements.new(0.5)
        for element, (position, colour) in zip(ramp.elements, stops):
            element.position = position
            element.color = (*colour, 1.0)
        self.put(n.inputs['Fac'], fac)
        return n.outputs['Color']

    # ------------------------------------------------------------ seamless noise

    def torus(self, fu, fv):
        """
        A point on a flat torus in 4D: u runs around one circle, v around the
        other, so any 4D texture sampled there tiles in both directions. The
        circles' circumferences are `fu` and `fv` noise units, so a noise of
        scale 1 shows about `fu` features across a tile and `fv` up it (unequal
        values stretch it). A fresh offset per call decorrelates the layers.
        """
        self.seed += 1
        offset = [((self.seed * k) % 97) * 7.31 for k in (13, 29, 41, 53)]
        ru, rv = fu / TAU, fv / TAU
        vec = self.node('ShaderNodeCombineXYZ')
        self.link(self.madd(self.cu, ru, offset[0]), vec.inputs['X'])
        self.link(self.madd(self.su, ru, offset[1]), vec.inputs['Y'])
        self.link(self.madd(self.cv, rv, offset[2]), vec.inputs['Z'])
        return vec.outputs[0], self.madd(self.sv, rv, offset[3])

    def noise(self, fu, fv=None, detail=4.0, roughness=0.5, lacunarity=2.0, distortion=0.0, kind='FBM', colour=False):
        """Seamless 4D noise, about 0..1 (FBM centres near 0.5)."""
        vec, w = self.torus(fu, fu if fv is None else fv)
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D', noise_type=kind, normalize=kind == 'FBM')
        self.link(vec, n.inputs['Vector'])
        self.link(w, n.inputs['W'])
        for key, value in (('Scale', 1.0), ('Detail', detail), ('Roughness', roughness),
                           ('Lacunarity', lacunarity), ('Distortion', distortion)):
            self.put(n.inputs[key], value)
        return n.outputs['Color' if colour else 'Factor']

    def voronoi(self, fu, fv=None, feature='F1', randomness=1.0, out='Distance', metric='EUCLIDEAN'):
        """Seamless 4D Voronoi; `out` is Distance, Color or W."""
        vec, w = self.torus(fu, fu if fv is None else fv)
        n = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature, distance=metric)
        self.link(vec, n.inputs['Vector'])
        self.link(w, n.inputs['W'])
        self.put(n.inputs['Scale'], 1.0)
        self.put(n.inputs['Randomness'], randomness)
        return n.outputs[out]

    def white(self, a, b=0.0, c=0.0):
        """A random value in 0..1 for each distinct (a, b, c): per brick, per plank."""
        self.seed += 1
        n = self.node('ShaderNodeTexWhiteNoise', noise_dimensions='4D')
        vec = self.node('ShaderNodeCombineXYZ')
        for i, value in enumerate((a, b, c)):
            self.put(vec.inputs[i], value)
        self.link(vec.outputs[0], n.inputs['Vector'])
        n.inputs['W'].default_value = self.seed * 1.618
        return n.outputs['Value']

    def edge(self, t, width, soft=0.0):
        """1 within `width` of either end of a 0..1 cell coordinate, 0 elsewhere (with a soft rim)."""
        d = self.min(t, self.sub(1.0, t))
        return self.map(d, width + soft, width, 0.0, 1.0, smooth=True) if soft > 0 else self.math('LESS_THAN', d, width)

    def cells(self, coord, count, offset=0.0):
        """Split a 0..1 coordinate into `count` cells, shifted by `offset` cells: (index mod count, 0..1 within)."""
        x = self.add(self.mul(coord, count), offset)
        return self.mod(self.floor(x), count), self.fract(x)


# ----------------------------------------------------------------- numpy side

def _blur(field, sigma_px):
    """Gaussian blur that wraps at the tile edges (FFT: periodic by construction)."""
    n = field.shape[0]
    f = np.fft.fftfreq(n)
    k = np.exp(-2 * (math.pi * sigma_px) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(field) * k))


def _down(a, factor):
    if factor == 1:
        return a
    n = a.shape[0] // factor
    return a.reshape(n, factor, n, factor, *a.shape[2:]).mean(axis=(1, 3))


def _to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _u8(x):
    return np.clip(np.round(x * 255), 0, 255).astype(np.uint8)


def _png(path, rgb):
    """A minimal 8-bit RGB PNG writer, rows bottom first in, top first out (so previews look right)."""
    h, w, _ = rgb.shape
    rows = b''.join(b'\x00' + rgb[h - 1 - y].tobytes() for y in range(h))
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(rows, 6)) + chunk(b'IEND', b''))


def _args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    size, out = SIZES[0], DEFAULT_OUT
    for i, arg in enumerate(argv):
        if arg == '--size':
            size = int(argv[i + 1])
        elif arg == '--out':
            out = os.path.abspath(argv[i + 1])
    return size, out


def _scene(size, samples):
    scene = bpy.context.scene
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
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 0
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj)
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.active_object
    image = bpy.data.images.new('bake', size, size, float_buffer=True, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    return plane, image


def run(name, tile, build, samples=8, ao_radius=0.02, ao_depth=0.01, ao_strength=1.0, normal_strength=1.0):
    """
    Bake one material. `build(g)` returns a dict of sockets or numbers:
    albedo (linear RGB), roughness, metal (0..1) and height (metres, any
    offset). `tile` is the metres one texture tile covers in the game
    (render/surfaces.ts must agree; tests/materials.test.ts checks it).
    `ao_radius` is the neighbourhood the cavity term compares against, in
    metres, and `ao_depth` the depth below it that reads fully occluded.
    """
    size, out = _args()
    g = Graph(name)
    channels = build(g)
    plane, image = _scene(size, samples)
    plane.data.materials.append(g.mat)
    target = g.node('ShaderNodeTexImage')
    target.image = image
    g.nt.nodes.active = target
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane

    def bake(value):
        if isinstance(value, bpy.types.NodeSocket):
            g.link(value, g.emit.inputs['Color'])
        else:
            for link in list(g.emit.inputs['Color'].links):
                g.nt.links.remove(link)
            v = value if isinstance(value, (tuple, list)) else (value, value, value)
            g.emit.inputs['Color'].default_value = (*v, 1.0)
        bpy.ops.object.bake(type='EMIT', use_clear=True)
        pixels = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        return pixels.reshape(size, size, 4)[:, :, :3].astype(np.float64)

    albedo = np.clip(bake(channels['albedo']), 0, 1)
    rough = np.clip(bake(channels['roughness'])[:, :, 0], 0, 1)
    metal = np.clip(bake(channels.get('metal', 0.0))[:, :, 0], 0, 1)
    height = bake(channels['height'])[:, :, 0]

    folder = os.path.join(out, name)
    os.makedirs(folder, exist_ok=True)
    meta = {'name': name, 'tile': tile, 'sizes': {}}
    for s in SIZES:
        if s > size:
            continue
        f = size // s
        a, r, m, h = _down(albedo, f), _down(rough, f), _down(metal, f), _down(height, f)
        texel = tile / s
        dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * texel)
        dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) / (2 * texel)
        n = np.stack([-dx * normal_strength, -dy * normal_strength, np.ones_like(h)], axis=-1)
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        cavity = 0.5 * (_blur(h, ao_radius / texel) + _blur(h, 0.35 * ao_radius / texel)) - h
        ao = 1 - ao_strength * np.clip(cavity / ao_depth, 0, 1)
        maps = {
            'albedo': _u8(_to_srgb(a)),
            'normal': _u8(n * 0.5 + 0.5),
            'orm': _u8(np.stack([ao, r, m], axis=-1)),
        }
        for key, rgb in maps.items():
            rgba = np.concatenate([rgb, np.full((s, s, 1), 255, np.uint8)], axis=-1)
            with open(os.path.join(folder, f'{s}-{key}.rgba'), 'wb') as file:
                file.write(rgba.tobytes())
            if s == max(x for x in SIZES if x <= size):
                _png(os.path.join(folder, f'preview-{key}.png'), rgb)
        meta['sizes'][s] = True
        if s == min(SIZES):
            # Means from the smallest size: the texture's average, what the game's 1 x 1 stand-in shows.
            meta.update({
                'albedo': [round(float(x), 5) for x in a.reshape(-1, 3).mean(axis=0)],
                'roughness': round(float(r.mean()), 5),
                'metal': round(float(m.mean()), 5),
                'ao': round(float(ao.mean()), 5),
            })
    with open(os.path.join(folder, 'meta.json'), 'w') as file:
        json.dump(meta, file, indent=1)
    print(f'{name}: baked {size}px into {folder}')

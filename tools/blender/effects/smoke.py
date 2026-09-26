"""
The lit effects atlas (docs/VISUALS.md, R5): straight colour and alpha, RGBA.

  cells 0-15   smoke puff, 16 frames: a dense, lumpy ball that swells and thins out
  cells 16-31  dust burst, 16 frames: a low, wide cloud kicked up from a surface at the cell's bottom
  cells 32-39  chips: broken stone and plaster fragments
  cells 40-43  splinters: long, twisted wood slivers
  cells 44-47  shards: thin glass slivers catching the light

Smoke and dust are Cycles renders of procedural scattering volumes (4D noise
shaped by a swelling falloff), lit by a sun from above and a grey sky, so the
top reads brighter than the belly. The fragments are meshes displaced by
Blender's procedural textures and rendered the same way. Everything is
neutral grey: the game tints each sprite (brick dust red, sand yellow, the
map's light).
"""

import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

COLS, ROWS = 8, 6
CELL = lib.CELL_SIZES[0]
LAYOUT = {'smoke': [0, 16], 'dust': [16, 16], 'chips': [32, 8], 'splinters': [40, 4], 'shards': [44, 4]}


def lit_scene(samples=64, denoise=False):
    lib.reset(samples=samples, world=(0.55, 0.57, 0.6), world_strength=0.9, denoise=denoise)
    lib.sun((0.35, 0.45, -1.0), 3.2, (1.0, 0.97, 0.92))


def smoke_material(t):
    g = lib.VolumeGraph(f'smoke-{t:.2f}')
    r = g.length(g.x, g.y, g.z)
    radius = 0.32 + 0.52 * (1 - (1 - t) ** 2)
    big = g.noise(g.p, 2.2, t * 0.9, detail=6.0)
    fine = g.noise(g.p, 6.5, t * 1.4, detail=4.0)
    edge = r + (big - 0.5) * (1.05 * radius) + (fine - 0.5) * 0.2
    shape = g.smooth(edge, radius, radius * 0.4)
    thin = g.smooth(fine, 0.12 + 0.4 * t, 0.5 + 0.3 * t)
    g.volume(density=shape * thin * (14.0 * (1 - t) ** 1.3 + 0.8), colour=(0.82, 0.82, 0.82), anisotropy=0.25)
    return g.mat


def dust_material(t):
    g = lib.VolumeGraph(f'dust-{t:.2f}')
    grow = 1 - (1 - t) ** 2.2
    cx, cz = 0.0, -0.78 + 0.35 * grow
    rx, rz = 0.18 + 0.75 * grow, 0.12 + 0.42 * grow
    big = g.noise(g.p, 2.8, t * 1.1, detail=6.0)
    fine = g.noise(g.p, 8.0, t * 1.7, detail=4.0)
    e = g.length((g.x - cx) / rx, g.y / rx, (g.z - cz) / rz)
    edge = e + (big - 0.5) * 0.9 + (fine - 0.5) * 0.25
    shape = g.smooth(edge, 1.0, 0.45) * g.smooth(g.z, -0.95, -0.8)
    thin = g.smooth(fine, 0.1 + 0.45 * t, 0.45 + 0.35 * t)
    g.volume(density=shape * thin * (12.0 * (1 - t) ** 1.6 + 0.5), colour=(0.8, 0.79, 0.77), anisotropy=0.2)
    return g.mat


def volume_cell(make, t):
    lit_scene(samples=256, denoise=True)
    lib.domain(make(t), size=(2.2, 2.2, 2.2))
    lib.camera((0, -6, 0), (0, 0, 0), 2.0)
    return lib.render_cell(CELL)


def surface(colour, roughness, metallic=0.0, specular=0.5):
    mat = bpy.data.materials.new('fragment')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*colour, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Specular IOR Level'].default_value = specular
    return mat


def displace(obj, kind, size, strength, seed):
    texture = bpy.data.textures.new(f'{kind}-{seed}', kind)
    texture.noise_scale = size
    if hasattr(texture, 'noise_basis'):
        texture.noise_basis = 'VORONOI_F1' if kind == 'VORONOI' else 'ORIGINAL_PERLIN'
    modifier = obj.modifiers.new('displace', 'DISPLACE')
    modifier.texture = texture
    modifier.strength = strength
    modifier.texture_coords = 'LOCAL'
    return modifier


def fragment_cell(build, seed, tilt=math.tau):
    rng = np.random.default_rng(seed)
    lit_scene(samples=48)
    obj = build(rng)
    obj.rotation_euler = (rng.uniform(-tilt, tilt), rng.uniform(0, math.tau), rng.uniform(-tilt, tilt))
    lib.camera((0, -6, 0), (0, 0, 0), 1.0)
    return lib.render_cell(CELL)


def chip(rng):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.22)
    obj = bpy.context.active_object
    obj.scale = (rng.uniform(0.8, 1.3), rng.uniform(0.6, 1.0), rng.uniform(0.35, 0.7))
    tex = displace(obj, 'VORONOI', rng.uniform(0.18, 0.3), rng.uniform(0.08, 0.14), int(rng.integers(1 << 20)))
    tex.mid_level = 0.5
    obj.modifiers.new('decimate', 'DECIMATE').ratio = 0.25
    bpy.ops.object.shade_flat()
    obj.data.materials.append(surface((0.62, 0.62, 0.6), 0.92))
    return obj


def splinter(rng):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.scale = (rng.uniform(0.62, 0.8), rng.uniform(0.05, 0.08), rng.uniform(0.03, 0.05))
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.subdivide(number_cuts=12)
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in obj.data.vertices:
        x = v.co.x
        taper = max(0.08, 1 - abs(x) * rng.uniform(1.2, 1.9)) if x > 0 else 1 - abs(x) * 0.6
        v.co.y *= taper
        v.co.z *= taper
        v.co.y += 0.05 * math.sin(x * 7 + rng.uniform(0, 3)) * abs(x)
        v.co.z += rng.normal(0, 0.004)
    obj.modifiers.new('twist', 'SIMPLE_DEFORM').angle = rng.uniform(-0.8, 0.8)
    bpy.ops.object.shade_flat()
    obj.data.materials.append(surface((0.7, 0.68, 0.64), 0.85))
    return obj


def shard(rng):
    mesh = bpy.data.meshes.new('shard')
    pts = [(rng.uniform(-0.35, -0.2), 0, rng.uniform(-0.1, 0.1)), (rng.uniform(0.25, 0.4), 0, rng.uniform(-0.05, 0.12)),
           (rng.uniform(-0.05, 0.1), 0, rng.uniform(0.18, 0.3)), (rng.uniform(-0.1, 0.05), 0, rng.uniform(-0.3, -0.15))]
    back = [(x, -0.012, z) for x, _, z in pts]
    mesh.from_pydata(pts + back, [], [(0, 1, 2), (0, 3, 1), (6, 5, 4), (5, 7, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 4, 0), (0, 4, 7, 3), (3, 7, 5, 1)])
    obj = bpy.data.objects.new('shard', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(surface((0.78, 0.84, 0.86), 0.08, metallic=0.4, specular=1.0))
    return obj


def encode_lit(renders):
    cells = []
    for cell in renders:
        colour, alpha = lib.straight(cell)
        cells.append(np.concatenate([lib.u8(lib.to_srgb(colour)), lib.u8(alpha)[:, :, None]], axis=2))
    return cells


def main():
    out = lib.args()
    cells = [None] * (COLS * ROWS)
    groups = {
        'smoke': [volume_cell(smoke_material, i / 15) for i in range(16)],
        'dust': [volume_cell(dust_material, i / 15) for i in range(16)],
        'chips': [fragment_cell(chip, 10 + i) for i in range(8)],
        'splinters': [fragment_cell(splinter, 30 + i, 0.4) for i in range(4)],
        'shards': [fragment_cell(shard, 50 + i, 0.5) for i in range(4)],
    }
    for name, renders in groups.items():
        for i, cell in enumerate(encode_lit(renders)):
            cells[LAYOUT[name][0] + i] = cell
    lib.write_atlas(out, 'smoke', COLS, ROWS, cells, LAYOUT, alpha=True)


main()

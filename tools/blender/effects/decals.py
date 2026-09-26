"""
The decal atlases (docs/VISUALS.md, R5): bullet holes per surface family and
the scorch of an explosion, as albedo + alpha (RGBA, sRGB) and a tangent-space
normal map (RGB), on the same 4 x 4 grid.

  cells 0-1    metal: a punched hole in a raised crown, chipped paint round it, a soot ring
  cells 2-4    masonry (concrete, plaster, brick, stucco, adobe): a dark hole in a shadowed crater
               of broken material, radial cracks and a faint dust halo
  cells 5-7    wood: a dark hole in a narrow rim of torn, lighter fibres along the grain (v)
  cells 8-9    glass: a small hole in a frosted ring, radial cracks and broken arcs
  cells 10-11  soft ground (soil, sand, grass): a dark pit in a ring of kicked-up earth
  cell  12     scorch: a sooty star of an explosion, 2-3 m across in the game

Each cell is an EMIT bake of a procedural node graph over a 1 x 1 plane
(albedo, alpha and height), with the normal map derived from the height in
numpy. Masonry, wood and soil are neutral grey: the game multiplies each by
the hit surface's colour over the grey its rim is here (`SURFACE_GREY`,
mirrored in effects-real.ts `DECAL_GREY`), so a hole's rim is the wall's own
colour and only the crater and hole read, darker, on any wall: one masonry
hole serves grey concrete, orange sandstone and red brick. Metal's chipped
paint and glass's cracks keep their own greys.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

COLS, ROWS = 4, 4
CELL = lib.CELL_SIZES[0]
LAYOUT = {'metal': [0, 2], 'masonry': [2, 3], 'wood': [5, 3], 'glass': [8, 2], 'soil': [10, 2], 'scorch': [12, 1]}
# The grey of a tinted family's rim, where it meets the surface (the game's tint is the surface's colour over it).
SURFACE_GREY = {'masonry': 0.5, 'wood': 0.45, 'soil': 0.5}


def polar(g):
    cx, cy = g.u - 0.5, g.v - 0.5
    return cx, cy, g.length(cx, cy) * 2, g.atan2(cy, cx)


def uv(g, su=1.0, sv=1.0):
    return g.vector(g.u * su, g.v * sv, 0.0)


def metal(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 7.0, seed)
    n2 = g.noise(uv(g), 3.0, seed + 5)
    hole = g.smooth(r + (n - 0.5) * 0.04, 0.2, 0.14)
    lip = g.smooth(r + (n - 0.5) * 0.06, 0.3, 0.2) * (1 - hole)
    chipped = g.smooth(r + (n2 - 0.5) * 0.3, 0.46, 0.34)
    scratches = g.smooth(g.abs(g.sin(theta * 11 + n * 4)), 0.1, 0.0) * chipped * (1 - lip)
    soot = g.smooth(r + (n - 0.5) * 0.2, 0.66, 0.34)
    grey = 0.05 + chipped * 0.13 + lip * 0.4 + scratches * 0.16
    grey = grey * (1 - hole * 0.95)
    alpha = g.clamp(g.max(chipped, soot * 0.55) + hole)
    height = lip * 0.5 - hole * 1.2 - chipped * 0.12 + (n - 0.5) * 0.06
    return {'albedo': g.vector(grey, grey, grey * 1.03), 'alpha': alpha, 'height': height}, 7.0


def masonry(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 6.0, seed, detail=6.0, roughness=0.65)
    fine = g.noise(uv(g), 22.0, seed + 3)
    crater = g.smooth(r + (n - 0.5) * 0.3, 0.5, 0.36)
    # Its outer part fades into the wall: the wall's baked light and the decal's probe light differ in
    # shade, and an opaque rim lit apart from the wall showed as a pale ring. Only the dark inside is solid.
    solid = g.smooth(r + (n - 0.5) * 0.3, 0.5, 0.24)
    hole = g.smooth(r + (n - 0.5) * 0.1, 0.24, 0.15)
    deep = g.smooth(r + (n - 0.5) * 0.1, 0.48, 0.2)
    halo = g.smooth(r + (n - 0.5) * 0.3, 0.92, 0.5) * (1 - crater)
    crack = g.smooth(g.abs(g.sin(theta * 2.5 + n * 5)), 0.09, 0.0) * g.smooth(r + (fine - 0.5) * 0.3, 0.85, 0.4) * (1 - crater)
    # The rim is the wall's own grey; the crater's broken walls are in their own shadow, darker towards the hole.
    grey = SURFACE_GREY['masonry'] * (1 + (fine - 0.5) * 0.3)
    grey = grey * (1 - crack * 0.6) * (1 - crater * (0.3 + 0.4 * deep)) * (1 - hole * 0.94)
    alpha = g.clamp(solid + halo * 0.18 * fine + crack * 0.55 + hole)
    height = -crater * 0.5 - hole * 1.2 + crater * (fine - 0.5) * 0.4 - crack * 0.25
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 6.0


def wood(g, seed):
    cx, cy, r, theta = polar(g)
    fibre = g.noise(uv(g, 18.0, 1.5), 1.0, seed, detail=3.0)
    n = g.noise(uv(g), 5.0, seed + 2)
    # A narrow lens along the grain: the torn fibres, lighter raw wood under the stain or paint.
    lens = g.length(cx * 2 / 0.3, cy * 2 / 0.62)
    torn = g.smooth(lens + (fibre - 0.5) * 0.7 + (n - 0.5) * 0.25, 0.95, 0.62)
    pit = g.smooth(r + (n - 0.5) * 0.08, 0.26, 0.13)
    hole = g.smooth(r + (n - 0.5) * 0.05, 0.14, 0.08)
    grey = (0.52 + 0.2 * fibre) * (1 - pit * 0.55) * (1 - hole * 0.95)
    alpha = g.clamp(torn * 0.9 + hole)
    height = torn * (fibre - 0.3) * 0.5 - pit * 0.4 - hole * 1.1
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 5.0


def glass(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 4.0, seed)
    hole = g.smooth(r, 0.06, 0.035)
    frost = g.smooth(r + (n - 0.5) * 0.08, 0.16, 0.08) * (1 - hole)
    radial = g.smooth(g.abs(g.sin(theta * 3.5 + n * 2.2)), 0.035, 0.0) * g.smooth(r + (n - 0.5) * 0.3, 0.95, 0.5)
    arcs = g.smooth(g.abs(g.sin(r * 22 + n * 3)), 0.06, 0.0) * g.smooth(n, 0.55, 0.65) * g.smooth(r, 0.7, 0.4) * g.smooth(r, 0.12, 0.2)
    crack = g.max(radial, arcs)
    grey = 0.12 * hole + 0.92 * (1 - hole)
    alpha = g.clamp(hole * 0.85 + frost * 0.7 + crack * 0.8)
    height = -hole - crack * 0.3 + frost * 0.15
    return {'albedo': g.vector(grey * 0.95, grey, grey), 'alpha': alpha, 'height': height}, 4.0


def soil(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 5.0, seed, detail=6.0)
    grain = g.noise(uv(g), 30.0, seed + 4)
    pit = g.smooth(r + (n - 0.5) * 0.25, 0.42, 0.2)
    solid = g.smooth(r + (n - 0.5) * 0.25, 0.42, 0.12)
    ring = g.smooth(r + (n - 0.5) * 0.4, 0.85, 0.4) * (1 - pit)
    # Kicked-up earth round the pit is a little darker than the ground; the pit itself is in its own shadow.
    grey = SURFACE_GREY['soil'] * (0.75 + 0.35 * grain) * (1 - pit * 0.75)
    alpha = g.clamp(solid * 0.95 + ring * 0.5 * g.smooth(grain, 0.3, 0.6))
    height = -pit * 0.9 + ring * 0.25 * grain
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 4.0


def scorch(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 3.0, seed, detail=6.0, roughness=0.6)
    fine = g.noise(uv(g), 16.0, seed + 1)
    soot = g.smooth(r + (n - 0.5) * 0.45, 0.92, 0.35)
    streak = g.noise(g.vector(g.cos(theta) * 2.0, g.sin(theta) * 2.0, r * 0.4), 1.6, seed + 2, detail=3.0)
    rays = g.smooth(streak, 0.5, 0.75) * g.smooth(r + (n - 0.5) * 0.3, 0.97, 0.4)
    grey = 0.025 + 0.05 * fine + (1 - soot) * 0.04
    alpha = g.clamp((soot * 0.95 + rays * 0.5) * (0.75 + 0.3 * fine))
    height = (fine - 0.5) * 0.15 * soot
    return {'albedo': g.vector(grey, grey * 0.97, grey * 0.94), 'alpha': alpha, 'height': height}, 1.5


def bake(make, seed):
    lib.reset(samples=16)
    g = lib.VolumeGraph(f'{make.__name__}-{seed}')
    channels, strength = make(g, seed)
    baked = lib.bake_plane(g, channels, CELL)
    albedo = np.clip(baked['albedo'], 0, 1)
    alpha = np.clip(baked['alpha'][:, :, 0], 0, 1)
    h = lib.blur(baked['height'][:, :, 0], 1)
    # Height is in hole depths; a depth of 1 over about 12 texels is a steep crater wall.
    dy, dx = np.gradient(h)
    normal = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Fade the relief out with the alpha, so a decal's edge is flat where it meets the wall's own normal.
    normal = normal * alpha[:, :, None] + np.array([0.0, 0.0, 1.0]) * (1 - alpha[:, :, None])
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Colour where the decal is (almost) clear takes its neighbourhood's, as the lit atlas does.
    colour, _ = lib.straight(np.concatenate([albedo * alpha[:, :, None], alpha[:, :, None]], axis=2))
    rgba = np.concatenate([lib.u8(lib.to_srgb(colour)), lib.u8(alpha)[:, :, None]], axis=2)
    nrm = np.concatenate([lib.u8(normal * 0.5 + 0.5), np.full((CELL, CELL, 1), 255, np.uint8)], axis=2)
    return rgba, nrm


def main():
    out = lib.args()
    albedo, normal = [None] * (COLS * ROWS), []
    flat = np.concatenate([np.full((CELL, CELL, 2), 128, np.uint8), np.full((CELL, CELL, 2), 255, np.uint8)], axis=2)
    normal = [flat] * (COLS * ROWS)
    for name, make in (('metal', metal), ('masonry', masonry), ('wood', wood), ('glass', glass), ('soil', soil), ('scorch', scorch)):
        first, count = LAYOUT[name]
        for i in range(count):
            albedo[first + i], normal[first + i] = bake(make, 11 + 17 * i)
    lib.write_atlas(out, 'decals', COLS, ROWS, albedo, LAYOUT, alpha=True)
    lib.write_atlas(out, 'decals-normal', COLS, ROWS, normal, LAYOUT, alpha=False, srgb=False)


main()

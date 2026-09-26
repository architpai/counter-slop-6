"""
The additive effects atlas (docs/VISUALS.md, R5): emission only, RGB.

  cells 0-15   fireball, 16 frames: a hot core that swells, breaks up and cools to nothing
  cells 16-19  muzzle flash seen down the barrel (four variants): a bright core and a 4-6 prong star
  cells 20-23  the same flashes from the side, muzzle at the cell's left edge, plume to the right
  cells 24-27  sparks: thin hot streaks along u, the head at the right
  cell  28     the one-frame flash of an explosion: a white-hot core in a soft glow

Every cell is a Cycles render of a procedural emission volume (4D noise and
blackbody colour, no image read from disk). The flashes are one 3D field per
variant rendered from both ends, so the front and side views agree. Each group
is normalised so its brightest texel is 1; the game sets its own intensity.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

COLS, ROWS = 8, 4
CELL = lib.CELL_SIZES[0]
LAYOUT = {'fireball': [0, 16], 'flashFront': [16, 4], 'flashSide': [20, 4], 'spark': [24, 4], 'glow': [28, 1]}


def emission_volume(name, field, kelvin, strength):
    """A volume that only glows: `field` (0..1) times `strength`, coloured by `kelvin`."""
    g = lib.VolumeGraph(name)
    f = field(g)
    k = kelvin(g, f)
    g.volume(density=0.0005, emission=f * strength, emission_colour=g.blackbody(k))
    return g.mat


def fireball(t):
    def field(g):
        r = g.length(g.x, g.y, g.z)
        radius = 0.26 + 0.6 * (1 - (1 - t) ** 2)
        big = g.noise(g.p, 2.4, t * 1.3, detail=6.0)
        fine = g.noise(g.p, 7.0, t * 2.2, detail=4.0)
        edge = r + (big - 0.5) * (0.75 * radius) + (fine - 0.5) * 0.22
        shape = g.smooth(edge, radius, radius * 0.35)
        # Solid while hot, patchy as it cools: the fine noise eats the late ball from inside.
        breakup = g.smooth(fine, 0.1 + 0.5 * t, 0.4 + 0.45 * t)
        return shape * breakup * ((1 - t) ** 1.5)

    def kelvin(g, f):
        r = g.length(g.x, g.y, g.z)
        radius = 0.26 + 0.6 * (1 - (1 - t) ** 2)
        return 1400 + 1900 * (1 - t) ** 1.4 * g.clamp(f * 1.6) + 2200 * (1 - t) ** 2 * g.smooth(r, radius * 0.9, 0.0)

    return field, kelvin


def flash_field(seed, prongs):
    """A plume along +x from the muzzle at the origin, with `prongs` side jets; about 0.9 m long in these units."""
    rng = np.random.default_rng(seed)
    phase = rng.uniform(0, math.tau)
    tilt = math.radians(rng.uniform(52, 66))

    def field(g):
        x, y, z = g.x, g.y, g.z
        radial = g.length(y, z)
        along = g.clamp(x / 0.9)
        width = 0.03 + 0.13 * g.sin(math.pi * g.clamp(x / 0.95)) ** 0.7
        breakup = g.noise(g.p, 9.0, seed * 3.1, detail=4.0)
        plume = g.exp(-(radial / width) ** 2 * 2.2) * g.smooth(x, -0.03, 0.04) * g.smooth(x, 0.95, 0.35)
        plume = plume * g.smooth(breakup, 0.25, 0.65) * (1.25 - along * 0.7)
        core = g.exp(-(g.length(x - 0.05, y, z) / 0.07) ** 2 * 1.5) * 1.6
        jets = None
        for i in range(prongs):
            a = phase + math.tau * i / prongs + rng.uniform(-0.25, 0.25)
            d = (math.cos(tilt), math.sin(tilt) * math.cos(a), math.sin(tilt) * math.sin(a))
            reach = rng.uniform(0.3, 0.46)
            s = x * d[0] + y * d[1] + z * d[2]
            px, py, pz = x - s * d[0], y - s * d[1], z - s * d[2]
            off = g.length(px, py, pz)
            t = g.clamp(s / reach)
            jet = g.exp(-(off / (0.012 + 0.05 * t)) ** 2) * g.smooth(s, -0.01, 0.03) * g.smooth(t, 1.0, 0.25)
            jets = jet if jets is None else g.max(jets, jet)
        return g.clamp(g.max(plume, jets * 0.9) + core)

    def kelvin(g, f):
        return 1900 + 2600 * g.clamp(f * 1.4)

    return field, kelvin


def spark_field(seed):
    rng = np.random.default_rng(100 + seed)
    bend = rng.uniform(-0.25, 0.25)
    length = rng.uniform(0.55, 0.85)

    def field(g):
        x = g.x
        centre = x * x * (4 * bend)
        off = g.length(g.y - centre, g.z)
        along = g.clamp((x + length / 2) / length)
        width = 0.006 + 0.014 * along
        streak = g.exp(-(off / width) ** 2) * g.smooth(along, 0.0, 0.8) * g.smooth(x, length / 2 + 0.02, length / 2 - 0.03)
        return g.clamp(streak * (0.35 + 0.65 * along ** 2))

    def kelvin(g, f):
        return 2200 + 2500 * f

    return field, kelvin


def glow():
    def field(g):
        r = g.length(g.x, g.y, g.z)
        return g.clamp(g.exp(-(r / 0.14) ** 2) + 0.35 * g.exp(-(r / 0.26) ** 2)) * g.smooth(r, 0.48, 0.3)

    def kelvin(g, f):
        return 3200 + 3000 * f

    return field, kelvin


def render(field_and_kelvin, name, box, box_at, cam_at, look_at, scale, strength=40.0):
    lib.reset(samples=48)
    field, kelvin = field_and_kelvin
    lib.domain(emission_volume(name, field, kelvin, strength), size=box, location=box_at)
    lib.camera(cam_at, look_at, scale)
    return lib.render_cell(CELL)


def encode(group):
    """A group's renders as sRGB bytes, normalised so its brightest texel (99.95th percentile) is 1."""
    peak = max(np.percentile(cell[:, :, :3].max(axis=2), 99.95) for cell in group)
    cells = []
    for cell in group:
        rgb = lib.u8(lib.to_srgb(cell[:, :, :3] / max(peak, 1e-6)))
        cells.append(np.concatenate([rgb, np.full((CELL, CELL, 1), 255, np.uint8)], axis=2))
    return cells


def main():
    out = lib.args()
    cells = [None] * (COLS * ROWS)
    balls = [render(fireball(i / 15), f'fireball-{i}', (2.2, 2.2, 2.2), (0, 0, 0), (0, -6, 0), (0, 0, 0), 2.0) for i in range(16)]
    for i, cell in enumerate(encode(balls)):
        cells[LAYOUT['fireball'][0] + i] = cell
    fronts, sides = [], []
    for v in range(4):
        prongs = (4, 5, 6, 4)[v]
        fronts.append(render(flash_field(v + 1, prongs), f'flash-front-{v}', (1.2, 1.2, 1.2), (0.45, 0, 0), (-6, 0, 0), (0, 0, 0), 1.0))
        sides.append(render(flash_field(v + 1, prongs), f'flash-side-{v}', (1.2, 1.2, 1.2), (0.45, 0, 0), (0.45, -6, 0), (0.45, 0, 0), 1.0))
    for i, cell in enumerate(encode(fronts)):
        cells[LAYOUT['flashFront'][0] + i] = cell
    for i, cell in enumerate(encode(sides)):
        cells[LAYOUT['flashSide'][0] + i] = cell
    sparks = [render(spark_field(v), f'spark-{v}', (1.2, 0.6, 0.2), (0, 0, 0), (0, -6, 0), (0, 0, 0), 1.0, strength=60.0) for v in range(4)]
    for i, cell in enumerate(encode(sparks)):
        cells[LAYOUT['spark'][0] + i] = cell
    cells[LAYOUT['glow'][0]] = encode([render(glow(), 'glow', (1.2, 1.2, 1.2), (0, 0, 0), (0, -6, 0), (0, 0, 0), 1.0)])[0]
    lib.write_atlas(out, 'fire', COLS, ROWS, cells, LAYOUT, alpha=False)


main()

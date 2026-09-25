"""Diamond tread plate: raised lozenges in alternating diagonals, 8 x 8 per 0.6 m tile. Worn steel."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 0.6
N = 8
S2 = 0.70710678


def build(g):
    row, fv = g.cells(g.v, N)
    col, fu = g.cells(g.u, N)
    x, y = g.sub(fu, 0.5), g.sub(fv, 0.5)
    flip = g.mod(g.add(row, col), 2.0)
    d1, d2 = g.mul(g.add(x, y), S2), g.mul(g.sub(x, y), S2)
    along, across = g.mix(flip, d1, d2), g.mix(flip, d2, d1)
    shape = g.add(g.mul(g.mul(along, along), 1 / 0.32 ** 2), g.mul(g.mul(across, across), 1 / 0.07 ** 2))
    lug = g.map(shape, 1.0, 0.45, 0.0, 1.0, smooth=True)
    grime = g.noise(4, 4, detail=5)
    scratch = g.noise(3, 200, detail=3)
    base = g.scale_rgb(srgb(0x8c9093), g.mul(g.map(grime, 0.3, 0.7, 0.82, 1.04), g.map(scratch, 0.3, 0.7, 0.95, 1.04)))
    albedo = g.mix_rgb(g.mul(lug, 0.6), base, srgb(0xaeb2b4))
    height = g.add(g.mul(lug, 0.0018), g.mul(scratch, 0.00005))
    rough = g.sub(g.map(grime, 0.3, 0.7, 0.45, 0.62), g.mul(lug, 0.12))
    return {'albedo': albedo, 'roughness': rough, 'metal': 1.0, 'height': height}


lib.run('tread-plate', TILE, build, ao_radius=0.012, ao_depth=0.0015, ao_strength=0.5)

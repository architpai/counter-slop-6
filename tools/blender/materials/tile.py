"""Glazed ceramic floor tiles: 0.3 m squares, 4 x 4 per 1.2 m tile, grey grout. Tinted per room."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.2
N = 4


def build(g):
    row, fv = g.cells(g.v, N)
    col, fu = g.cells(g.u, N)
    grout = g.max(g.edge(fu, 0.006, soft=0.006), g.edge(fv, 0.006, soft=0.006))
    pick = g.white(col, row)
    cloud = g.noise(8, 8, detail=4)
    glaze = g.scale_rgb(srgb(0xd8d4cc), g.mul(g.add(0.96, g.mul(pick, 0.06)), g.map(cloud, 0.3, 0.7, 0.97, 1.02)))
    albedo = g.mix_rgb(grout, glaze, srgb(0x8a857c))
    bevel = g.map(g.min(g.min(fu, g.sub(1.0, fu)), g.min(fv, g.sub(1.0, fv))), 0.006, 0.03, 0.0, 1.0, smooth=True)
    height = g.add(g.mul(bevel, 0.002), g.mul(g.noise(40, 40), 0.0002))
    rough = g.mix(grout, g.map(cloud, 0.3, 0.7, 0.18, 0.3), 0.85)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('tile', TILE, build, ao_radius=0.01, ao_depth=0.0015, ao_strength=0.6)

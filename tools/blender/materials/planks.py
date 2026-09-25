"""Boards along u, 16 rows up a 2.4 m tile (0.15 m wide) with staggered butt joints, gaps and nails."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.4
ROWS, COLS = 16, 2


def build(g):
    row, fv = g.cells(g.v, ROWS)
    col, fu = g.cells(g.u, COLS, g.white(row))
    gap = g.max(g.edge(fu, 0.0025, soft=0.002), g.edge(fv, 0.02, soft=0.02))
    pick = g.white(col, row, 1.0)
    grain = g.noise(3, 400, detail=4, distortion=0.5)
    fibre = g.noise(8, 1600, detail=2)
    board = g.ramp(g.add(g.mul(pick, 0.6), g.mul(grain, 0.4)), [(0.1, srgb(0x6e4f36)), (0.45, srgb(0x8f6c4d)), (0.8, srgb(0xa3805c)), (1.0, srgb(0x7c5a3e))])
    board = g.scale_rgb(board, g.map(fibre, 0.3, 0.7, 0.9, 1.06))
    # Two nails near each board end.
    ends = g.min(fu, g.sub(1.0, fu))
    nx = g.mul(g.sub(ends, 0.03), 1.2)
    ny = g.mul(g.sub(g.abs(g.sub(fv, 0.5)), 0.25), 0.15)
    nail = g.map(g.math('SQRT', g.add(g.mul(nx, nx), g.mul(ny, ny))), 0.004, 0.002, 0.0, 1.0, smooth=True)
    albedo = g.mix_rgb(gap, board, srgb(0x2e241c))
    albedo = g.mix_rgb(nail, albedo, srgb(0x3a3836))
    cup = g.mul(g.sub(0.25, g.mul(g.sub(fv, 0.5), g.sub(fv, 0.5))), 0.004)
    height = g.mix(gap, g.add(cup, g.mul(fibre, 0.0004)), -0.004)
    rough = g.mix(gap, g.map(grain, 0.3, 0.7, 0.6, 0.75), 0.95)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('planks', TILE, build, ao_radius=0.015, ao_depth=0.003, ao_strength=0.7)

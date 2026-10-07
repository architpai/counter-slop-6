"""Clay barrel roof tiles: 6 rounded courses across and 4 overlapping rows up a 1.2 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.2
COLS, ROWS = 6, 4


def build(g):
    row, fv = g.cells(g.v, ROWS)
    col, fu = g.cells(g.u, COLS, g.mul(g.mod(row, 2), 0.08))
    arc = g.math('SQRT', g.clamp(g.sub(1.0, g.pow(g.sub(g.mul(fu, 2.0), 1.0), 2.0))))
    # Each tile thickens towards its lower edge, where it laps over the row below.
    lap = g.mul(g.sub(1.0, fv), 0.012)
    edge = g.map(fv, 0.0, 0.05, 1.0, 0.0, smooth=True)
    pick = g.white(col, row)
    mottle = g.noise(10, 10, detail=5)
    fine = g.noise(400, 400, detail=2)
    clay = g.ramp(g.add(g.mul(pick, 0.6), g.mul(mottle, 0.4)), [(0.1, srgb(0x8e4a30)), (0.4, srgb(0xa65c3c)), (0.7, srgb(0xb86c48)), (1.0, srgb(0x9a5a3e))])
    clay = g.scale_rgb(clay, g.mul(g.map(fine, 0.3, 0.7, 0.92, 1.05), g.map(arc, 0.0, 0.6, 0.72, 1.0)))
    albedo = g.scale_rgb(clay, g.sub(1.0, g.mul(edge, 0.3)))
    height = g.add(g.add(g.mul(arc, 0.035), lap), g.mul(fine, 0.0004))
    rough = g.map(fine, 0.3, 0.7, 0.78, 0.9)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('roof-tile', TILE, build, ao_radius=0.05, ao_depth=0.015, ao_strength=0.7, normal_strength=0.8)

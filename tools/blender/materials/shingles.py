"""Asphalt shingles: 6 courses up a 1.2 m tile, tabs staggered by half, mineral granules. Tinted."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.2
ROWS, TABS = 6, 4


def build(g):
    row, fv = g.cells(g.v, ROWS)
    col, fu = g.cells(g.u, TABS, g.mul(g.mod(row, 2), 0.5))
    slot = g.mul(g.edge(fu, 0.012, soft=0.006), g.math('LESS_THAN', fv, 0.55))
    lap = g.mul(g.sub(1.0, fv), 0.004)
    edge = g.map(fv, 0.0, 0.06, 1.0, 0.0, smooth=True)
    pick = g.white(col, row)
    granule = g.noise(900, 900, detail=2)
    speck = g.map(g.voronoi(500, 500), 0.08, 0.02, 0.0, 1.0)
    base = g.scale_rgb(srgb(0xb4b4b2), g.mul(g.add(0.9, g.mul(pick, 0.16)), g.map(granule, 0.3, 0.7, 0.85, 1.12)))
    base = g.scale_rgb(base, g.add(1.0, g.mul(speck, 0.15)))
    albedo = g.scale_rgb(base, g.sub(1.0, g.add(g.mul(edge, 0.35), g.mul(slot, 0.6))))
    height = g.add(g.add(lap, g.mul(granule, 0.0008)), g.mul(slot, -0.004))
    rough = g.map(granule, 0.3, 0.7, 0.88, 0.98)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('shingles', TILE, build, ao_radius=0.02, ao_depth=0.003, ao_strength=0.6)

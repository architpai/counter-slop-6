"""Board-formed (cast) concrete: 1.2 x 0.6 m formwork panels with seams and tie holes. 2.4 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.4
COLS, ROWS = 2, 4


def build(g):
    row, fv = g.cells(g.v, ROWS)
    col, fu = g.cells(g.u, COLS)
    # A 4 mm raised fin where two panels met, and tie holes 0.15 m in from each panel edge.
    seam = g.max(g.edge(fu, 0.0017, soft=0.002), g.edge(fv, 0.0035, soft=0.004))
    hx = g.min(g.abs(g.sub(fu, 0.125)), g.abs(g.sub(fu, 0.875)))
    hy = g.abs(g.sub(fv, 0.5))
    hole = g.map(g.math('SQRT', g.add(g.mul(g.mul(hx, 1.2), g.mul(hx, 1.2)), g.mul(g.mul(hy, 0.6), g.mul(hy, 0.6)))), 0.012, 0.008, 0.0, 1.0, smooth=True)
    panel = g.white(col, row)
    grain = g.noise(380, 380, detail=2, roughness=0.6)
    blotch = g.noise(5, 5, detail=5)
    pores = g.map(g.voronoi(200, 200), 0.045, 0.02, 0.0, 1.0, smooth=True)
    tone = g.add(g.mul(g.sub(panel, 0.5), 0.1), g.mul(g.sub(blotch, 0.5), 0.35))
    base = g.ramp(g.add(0.5, tone), [(0.3, srgb(0x8d8a83)), (0.5, srgb(0x9d9a92)), (0.7, srgb(0xaaa79f))])
    albedo = g.scale_rgb(base, g.map(grain, 0.3, 0.7, 0.93, 1.05))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.add(g.mul(hole, 0.5), g.mul(pores, 0.3))))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.mul(seam, 0.08)))
    height = g.add(g.add(g.mul(grain, 0.0004), g.mul(seam, 0.002)), g.add(g.mul(hole, -0.01), g.mul(pores, -0.001)))
    rough = g.map(blotch, 0.3, 0.7, 0.8, 0.93)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('cast-concrete', TILE, build, ao_radius=0.02, ao_depth=0.004, ao_strength=0.6)

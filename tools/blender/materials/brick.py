"""Red brick in running bond: 4 bricks across and 12 courses up a 0.9 m tile, recessed mortar."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 0.9
COLS, ROWS = 4, 12


def build(g):
    # Wobble the joints a little so no two bricks are machine-perfect.
    wobble = g.mul(g.sub(g.noise(9, 9, detail=2), 0.5), 0.02)
    row, fv = g.cells(g.add(g.v, wobble), ROWS)
    col, fu = g.cells(g.add(g.u, wobble), COLS, g.mul(g.mod(row, 2), 0.5))
    # Half a 10 mm joint on each side: 5 mm of a 225 mm brick, 5 mm of a 75 mm course.
    joint = g.max(g.edge(fu, 0.022, soft=0.012), g.edge(fv, 0.066, soft=0.035))
    pick = g.white(col, row)
    brick = g.ramp(pick, [(0.0, srgb(0x7a3a2a)), (0.35, srgb(0x94503a)), (0.7, srgb(0xa3624a)),
                          (0.93, srgb(0x8c4a37)), (1.0, srgb(0x5a3026))])
    speckle = g.noise(90, 90, detail=3, roughness=0.7)
    brick = g.scale_rgb(brick, g.map(speckle, 0.3, 0.7, 0.86, 1.1))
    grime = g.noise(3, 3, detail=4)
    mortar = g.scale_rgb(srgb(0x8f8a82), g.map(g.noise(60, 60, detail=2), 0.3, 0.7, 0.85, 1.08))
    albedo = g.mix_rgb(joint, brick, mortar)
    albedo = g.scale_rgb(albedo, g.map(grime, 0.35, 0.7, 0.82, 1.04))
    # Brick faces sit 5 mm proud of the mortar, with small pits and a slight tilt per brick. The
    # arris is rounded over about 7 mm (0.03 of a brick, 0.09 of a course), so the edge shades
    # gradually instead of drawing a dark line along each brick.
    pits = g.map(g.voronoi(70, 70, feature='F1'), 0.0, 0.18, -0.0012, 0.0)
    tilt = g.mul(g.sub(g.white(col, row, 1.0), 0.5), g.mul(g.sub(fu, 0.5), 0.002))
    face = g.add(g.add(g.mul(speckle, 0.0012), pits), tilt)
    bevel = g.max(g.edge(fu, 0.018, soft=0.032), g.edge(fv, 0.055, soft=0.095))
    height = g.mix(bevel, face, g.add(-0.005, g.mul(g.noise(40, 40), 0.0015)))
    rough = g.mix(joint, g.map(speckle, 0.3, 0.7, 0.78, 0.9), 0.95)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('brick', TILE, build, ao_radius=0.03, ao_depth=0.01, ao_strength=0.4, normal_strength=0.7)

"""Stone paving slabs: 0.6 m squares, 4 x 4 per 2.4 m tile, sunken joints and slab-to-slab tone."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.4
N = 4


def build(g):
    wob = g.mul(g.sub(g.noise(12, 12, detail=2), 0.5), 0.006)
    row, fv = g.cells(g.add(g.v, wob), N)
    col, fu = g.cells(g.add(g.u, wob), N)
    joint = g.max(g.edge(fu, 0.006, soft=0.005), g.edge(fv, 0.006, soft=0.005))
    pick = g.white(col, row)
    grain = g.noise(500, 500, detail=3, roughness=0.6)
    fleck = g.map(g.voronoi(700, 700), 0.05, 0.0, 0.0, 1.0)
    dirt = g.noise(3, 3, detail=5)
    slab = g.ramp(pick, [(0.0, srgb(0x9d978a)), (0.4, srgb(0xaca597)), (0.8, srgb(0xb5ae9f)), (1.0, srgb(0x958f83))])
    slab = g.scale_rgb(slab, g.mul(g.map(grain, 0.3, 0.7, 0.93, 1.05), g.sub(1.0, g.mul(fleck, 0.15))))
    albedo = g.mix_rgb(joint, slab, srgb(0x7c766a))
    albedo = g.scale_rgb(albedo, g.map(dirt, 0.35, 0.7, 0.9, 1.03))
    tilt = g.mul(g.sub(g.white(col, row, 2.0), 0.5), g.mul(g.sub(fu, 0.5), 0.003))
    height = g.mix(joint, g.add(g.mul(grain, 0.0005), tilt), -0.006)
    rough = g.mix(joint, g.map(grain, 0.3, 0.7, 0.75, 0.9), 0.95)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('paving', TILE, build, ao_radius=0.02, ao_depth=0.004, ao_strength=0.6)

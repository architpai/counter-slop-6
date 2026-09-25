"""Road marking paint over asphalt grain, worn through in patches. 2 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.0


def build(g):
    grain = g.noise(700, 700, detail=2)
    stones = g.voronoi(300, 300, feature='F1')
    wear = g.noise(10, 10, detail=6, roughness=0.6)
    worn = g.map(wear, 0.62, 0.7, 0.0, 1.0, smooth=True)
    paint = g.scale_rgb(srgb(0xe4e1d8), g.map(grain, 0.3, 0.7, 0.94, 1.03))
    asphalt = g.scale_rgb(srgb(0x55544f), g.map(grain, 0.3, 0.7, 0.8, 1.2))
    albedo = g.mix_rgb(worn, paint, asphalt)
    bumps = g.map(stones, 0.0, 0.35, 0.0012, 0.0)
    height = g.add(g.add(bumps, g.mul(grain, 0.0004)), g.mul(g.sub(1.0, worn), 0.0006))
    rough = g.mix(worn, 0.62, 0.9)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('road-paint', TILE, build, ao_radius=0.006, ao_depth=0.001, ao_strength=0.4)

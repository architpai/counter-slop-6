"""Leaf canopy: overlapping leaves of varied green, dark gaps between them. 1.5 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.5


def build(g):
    leaf = g.voronoi(45, 45, feature='F1')
    leaf2 = g.voronoi(70, 70, feature='F1')
    pick = g.voronoi(45, 45, feature='F1', out='W')
    gaps = g.voronoi(45, 45, feature='DISTANCE_TO_EDGE')
    vein = g.noise(200, 200, detail=2)
    shade = g.map(gaps, 0.0, 0.08, 0.4, 1.0, smooth=True)
    albedo = g.ramp(g.fract(g.mul(pick, 3.1)), [(0.0, srgb(0x3e5a2c)), (0.4, srgb(0x506f3c)), (0.75, srgb(0x62813f)), (1.0, srgb(0x48652e))])
    albedo = g.scale_rgb(albedo, g.mul(shade, g.map(vein, 0.3, 0.7, 0.93, 1.05)))
    height = g.add(g.mul(g.sub(0.5, leaf), 0.02), g.mul(g.sub(0.5, leaf2), 0.008))
    rough = g.map(vein, 0.3, 0.7, 0.55, 0.75)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('foliage', TILE, build, ao_radius=0.03, ao_depth=0.01, ao_strength=0.7, normal_strength=0.6)

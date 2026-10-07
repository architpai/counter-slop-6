"""Rough exterior render (stucco, adobe wash): lumpy trowelled texture and weather staining. 2 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.0


def build(g):
    lumps = g.voronoi(90, 90, feature='SMOOTH_F1')
    fine = g.noise(260, 260, detail=4, roughness=0.6)
    trowel = g.noise(6, 10, detail=3, distortion=0.4)
    stain = g.noise(20, 2.2, detail=4)
    dirt = g.noise(3, 3, detail=5)
    albedo = g.scale_rgb(srgb(0xd9d3c8), g.map(fine, 0.3, 0.7, 0.93, 1.04))
    albedo = g.scale_rgb(albedo, g.map(lumps, 0.0, 0.5, 0.95, 1.03))
    albedo = g.scale_rgb(albedo, g.mul(g.map(stain, 0.55, 0.8, 1.0, 0.88), g.map(dirt, 0.35, 0.7, 0.94, 1.02)))
    height = g.add(g.add(g.mul(lumps, -0.002), g.mul(fine, 0.0012)), g.mul(trowel, 0.0015))
    rough = g.map(fine, 0.3, 0.7, 0.85, 0.96)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('stucco', TILE, build, ao_radius=0.008, ao_depth=0.0015, ao_strength=0.5)

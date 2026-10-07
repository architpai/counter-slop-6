"""Painted interior plaster: near-flat with a faint roller stipple and soft tone drift. 2 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.0


def build(g):
    stipple = g.noise(320, 320, detail=3, roughness=0.55)
    drift = g.noise(3, 3, detail=4)
    # Knock-down lumps a couple of centimetres across and a broad trowel wave under the paint.
    lumps = g.voronoi(70, 70, feature='SMOOTH_F1')
    trowel = g.noise(12, 18, detail=3, distortion=0.5)
    albedo = g.scale_rgb(srgb(0xd8d6d0), g.mul(g.map(stipple, 0.3, 0.7, 0.97, 1.02), g.map(drift, 0.3, 0.7, 0.96, 1.02)))
    albedo = g.scale_rgb(albedo, g.map(lumps, 0.0, 0.5, 0.985, 1.01))
    height = g.add(g.add(g.mul(stipple, 0.0003), g.mul(drift, 0.0008)), g.add(g.mul(lumps, -0.0012), g.map(trowel, 0.3, 0.7, 0.0, 0.002)))
    rough = g.map(stipple, 0.3, 0.7, 0.72, 0.86)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('plaster', TILE, build, ao_radius=0.01, ao_depth=0.002, ao_strength=0.3, normal_strength=2.0)

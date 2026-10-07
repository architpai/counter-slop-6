"""Open water: dark body, fine wind ripples on long swells. Glossy; the sky's reflection does the rest. 4 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 4.0


def build(g):
    swell = g.noise(3, 5, detail=3)
    ripple = g.noise(40, 60, detail=4, roughness=0.55)
    albedo = g.scale_rgb(srgb(0x2c4b52), g.map(swell, 0.3, 0.7, 0.92, 1.06))
    height = g.add(g.mul(swell, 0.03), g.mul(ripple, 0.006))
    rough = g.map(ripple, 0.3, 0.7, 0.04, 0.1)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('water', TILE, build, ao_radius=0.01, ao_depth=0.01, ao_strength=0.0, normal_strength=0.8)

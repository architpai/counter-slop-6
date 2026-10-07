"""Solid wood with grain along u: posts, beams, furniture. Also bark and painted wood by tint. 1.5 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.5


def build(g):
    rings = g.noise(1.5, 26, detail=5, roughness=0.55, distortion=0.6)
    bands = g.fract(g.mul(rings, 7.0))
    fibre = g.noise(6, 700, detail=2)
    figure = g.noise(2, 5, detail=3)
    tone = g.add(g.mul(g.map(bands, 0.0, 1.0, 0.0, 1.0, smooth=True), 0.55), g.mul(figure, 0.45))
    albedo = g.ramp(tone, [(0.25, srgb(0x6a4a31)), (0.5, srgb(0x8a6446)), (0.75, srgb(0xa07a57))])
    albedo = g.scale_rgb(albedo, g.map(fibre, 0.3, 0.7, 0.9, 1.06))
    height = g.add(g.mul(fibre, 0.0004), g.mul(bands, 0.0003))
    rough = g.map(fibre, 0.3, 0.7, 0.62, 0.78)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('wood', TILE, build, ao_radius=0.004, ao_depth=0.0005, ao_strength=0.4)

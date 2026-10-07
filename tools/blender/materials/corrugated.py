"""Painted corrugated sheet: 8 vertical ribs across a 1.2 m tile, 18 mm deep, grime runs and a few dents."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.2
RIBS = 8


def build(g):
    rib = g.cos(g.mul(g.u, 6.2831853 * RIBS))
    runs = g.noise(40, 2, detail=4)
    grime = g.noise(4, 4, detail=5)
    dents = g.noise(6, 4, detail=3)
    chips = g.map(g.noise(14, 14, detail=8, roughness=0.65), 0.72, 0.74, 0.0, 1.0)
    paint = g.scale_rgb(srgb(0xc9c9c7), g.mul(g.map(runs, 0.55, 0.8, 1.0, 0.86), g.map(grime, 0.3, 0.7, 0.9, 1.03)))
    valley = g.map(rib, -1.0, 0.0, 0.92, 1.0)
    paint = g.scale_rgb(paint, valley)
    albedo = g.mix_rgb(chips, paint, srgb(0x6a6a68))
    height = g.add(g.mul(rib, 0.009), g.mul(dents, 0.004))
    rough = g.mix(chips, g.map(grime, 0.3, 0.7, 0.45, 0.62), 0.4)
    return {'albedo': albedo, 'roughness': rough, 'metal': chips, 'height': height}


lib.run('corrugated', TILE, build, ao_radius=0.05, ao_depth=0.01, ao_strength=0.5, normal_strength=0.9)

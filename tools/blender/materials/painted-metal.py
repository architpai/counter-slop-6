"""Painted steel with chips down to bare metal, drips and grime. Tinted to the piece. 1.5 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.5


def build(g):
    chips = g.noise(12, 12, detail=8, roughness=0.65)
    chip = g.map(chips, 0.7, 0.72, 0.0, 1.0)
    drip = g.noise(40, 2.5, detail=4)
    grime = g.noise(4, 4, detail=5)
    peel = g.noise(110, 110, detail=3)
    wave = g.noise(3, 3, detail=3)
    dents = g.map(g.voronoi(7, 7, feature='F1'), 0.0, 0.22, -0.0015, 0.0, smooth=True)
    paint = g.scale_rgb(srgb(0xcdcdcb), g.mul(g.map(grime, 0.3, 0.7, 0.9, 1.03), g.map(drip, 0.58, 0.78, 1.0, 0.88)))
    paint = g.scale_rgb(paint, g.map(peel, 0.3, 0.7, 0.98, 1.01))
    bare = g.scale_rgb(srgb(0x6a6c6e), g.map(peel, 0.3, 0.7, 0.9, 1.1))
    albedo = g.mix_rgb(chip, paint, bare)
    height = g.add(g.add(g.mul(g.sub(1.0, chip), 0.0004), g.map(peel, 0.3, 0.7, 0.0, 0.0003)), g.add(g.map(wave, 0.3, 0.7, 0.0, 0.003), dents))
    rough = g.mix(chip, g.map(grime, 0.3, 0.7, 0.45, 0.62), 0.4)
    return {'albedo': albedo, 'roughness': rough, 'metal': chip, 'height': height}


lib.run('painted-metal', TILE, build, ao_radius=0.006, ao_depth=0.0008, ao_strength=0.3, normal_strength=2.5)

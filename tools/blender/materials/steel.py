"""Galvanised steel: spangle crystals, brushing along u, smudges. Bare metal. 1 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.0


def build(g):
    spangle = g.fract(g.mul(g.voronoi(30, 30, feature='F1', out='W'), 7.0))
    brush = g.noise(2, 500, detail=3)
    smudge = g.noise(5, 5, detail=5)
    base = g.scale_rgb(srgb(0xa3a7ab), g.mul(g.map(brush, 0.3, 0.7, 0.93, 1.05), g.map(smudge, 0.35, 0.7, 0.88, 1.04)))
    albedo = g.scale_rgb(base, g.map(spangle, 0.0, 1.0, 0.95, 1.05))
    # The sheet is not flat: a long wave, a few shallow dents, and each spangle crystal a hair proud.
    wave = g.noise(3, 3, detail=3)
    dents = g.map(g.voronoi(9, 9, feature='F1'), 0.0, 0.25, -0.0012, 0.0, smooth=True)
    height = g.add(g.add(g.mul(brush, 0.00008), g.map(wave, 0.3, 0.7, 0.0, 0.003)), g.add(dents, g.mul(spangle, 0.00012)))
    rough = g.add(g.map(smudge, 0.3, 0.7, 0.3, 0.5), g.mul(spangle, 0.06))
    return {'albedo': albedo, 'roughness': rough, 'metal': 1.0, 'height': height}


lib.run('steel', TILE, build, ao_radius=0.01, ao_depth=0.002, ao_strength=0.2, normal_strength=2.5)

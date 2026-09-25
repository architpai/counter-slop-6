"""Window glass: dark, near mirror-smooth, with smudges and a slight float-glass waviness. 2 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 2.0


def build(g):
    smudge = g.noise(6, 6, detail=6, roughness=0.6)
    dust = g.noise(2, 2, detail=4)
    wave = g.noise(4, 14, detail=2)
    albedo = g.scale_rgb(srgb(0x2e363b), g.map(dust, 0.3, 0.7, 0.9, 1.15))
    height = g.map(wave, 0.3, 0.7, 0.0, 0.004)
    rough = g.add(g.map(smudge, 0.5, 0.75, 0.04, 0.22), g.map(dust, 0.5, 0.8, 0.0, 0.1))
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('glass', TILE, build, ao_radius=0.002, ao_depth=0.01, ao_strength=0.0, normal_strength=2.0)

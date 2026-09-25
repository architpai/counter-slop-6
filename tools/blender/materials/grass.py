"""Mown lawn seen from above: dense blades, dark gaps, small drier tufts and specks of soil. 3 m tile.

No feature is larger than about 30 cm or much lighter than the rest: a big dry patch would repeat every
3 m across a lawn as a visible grid. The game's world-space macro variation adds the large drift."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 3.0


def build(g):
    blades = g.noise(700, 200, detail=3, roughness=0.7)
    blades2 = g.noise(200, 700, detail=3, roughness=0.7)
    blade = g.max(blades, blades2)
    clumps = g.noise(40, 40, detail=3)
    dry = g.map(g.noise(10, 10, detail=3), 0.55, 0.75, 0.0, 1.0)
    soil = g.map(g.noise(60, 60, detail=4), 0.72, 0.77, 0.0, 1.0)
    lift = g.add(g.mul(g.map(blade, 0.4, 0.8, 0.0, 1.0), 0.75), g.mul(clumps, 0.25))
    green = g.ramp(lift, [(0.0, srgb(0x2a3e16)), (0.35, srgb(0x4a6428)), (0.7, srgb(0x6e8a3a)), (1.0, srgb(0x93a856))])
    albedo = g.mix_rgb(g.mul(dry, 0.2), green, g.scale_rgb(srgb(0x9a9658), g.map(blade, 0.4, 0.8, 0.7, 1.1)))
    albedo = g.mix_rgb(g.mul(soil, 0.7), albedo, srgb(0x5a4a38))
    height = g.add(g.mul(blade, 0.008), g.mul(clumps, 0.004))
    rough = g.map(blade, 0.3, 0.7, 0.95, 0.8)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('grass', TILE, build, ao_radius=0.006, ao_depth=0.002, ao_strength=0.7, normal_strength=0.6)

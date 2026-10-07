"""Painted clapboard siding: 8 lapped boards up a 1.2 m tile, faint grain under the paint."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.2
BOARDS = 8


def build(g):
    row, fv = g.cells(g.v, BOARDS)
    # Each board is thicker at its bottom edge and tucks under the next one up.
    lap = g.mul(g.sub(1.0, fv), 0.012)
    shadow = g.map(fv, 0.0, 0.06, 1.0, 0.0, smooth=True)
    grain = g.noise(2, 90, detail=4, distortion=0.3)
    wear = g.noise(8, 8, detail=6)
    tone = g.white(row)
    albedo = g.scale_rgb(srgb(0xe6e2da), g.mul(g.map(grain, 0.3, 0.7, 0.97, 1.02), g.add(0.97, g.mul(tone, 0.04))))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.mul(shadow, 0.25)))
    albedo = g.scale_rgb(albedo, g.map(wear, 0.6, 0.75, 1.0, 0.9))
    height = g.add(lap, g.mul(grain, 0.0003))
    rough = g.map(wear, 0.4, 0.75, 0.55, 0.75)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('siding', TILE, build, ao_radius=0.02, ao_depth=0.004, ao_strength=0.6)

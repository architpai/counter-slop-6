"""Worn asphalt: dark binder, light and dark aggregate, polished wheel paths and hairline cracks. 4 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 4.0


def build(g):
    stone_d = g.voronoi(520, 520, feature='F1')
    stone = g.fract(g.mul(g.voronoi(520, 520, feature='F1', out='W'), 5.3))
    grain = g.noise(900, 900, detail=2)
    wear = g.noise(3, 3, detail=5)
    patch = g.noise(1.5, 1.5, detail=3)
    cracks = g.voronoi(5, 5, feature='DISTANCE_TO_EDGE')
    crack_mask = g.map(g.noise(3, 3, detail=4), 0.52, 0.62, 0.0, 1.0)
    crack = g.mul(g.map(cracks, 0.012, 0.004, 0.0, 1.0, smooth=True), crack_mask)
    aggregate = g.ramp(g.add(g.mul(grain, 0.4), g.mul(stone, 0.6)), [(0.3, srgb(0x3a3a3a)), (0.5, srgb(0x4c4c4b)), (0.62, srgb(0x5d5c5a)), (0.75, srgb(0x77746f))])
    albedo = g.scale_rgb(aggregate, g.map(wear, 0.3, 0.7, 0.92, 1.1))
    albedo = g.scale_rgb(albedo, g.map(patch, 0.6, 0.7, 1.0, 0.85))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.mul(crack, 0.6)))
    height = g.add(g.add(g.map(stone_d, 0.0, 0.4, 0.0015, 0.0), g.mul(grain, 0.0006)), g.mul(crack, -0.004))
    rough = g.map(wear, 0.3, 0.7, 0.95, 0.8)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('asphalt', TILE, build, ao_radius=0.01, ao_depth=0.002, ao_strength=0.5)

"""Weathered poured concrete for floors and walls alike: blotchy tone, aggregate, repair patches,
float marks and air pores, all without a direction (no rain streaks: it lies on the ground too). 3 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 3.0


def build(g):
    blotch = g.noise(4, 4, detail=6, roughness=0.6)
    mottle = g.noise(14, 14, detail=4)
    grain = g.noise(420, 420, detail=2, roughness=0.6)
    # Float marks: shallow swirls a few centimetres across, left by the finishing trowel.
    swirl = g.noise(26, 26, detail=3, roughness=0.5, distortion=0.15)
    # Exposed aggregate, and pores big enough to survive the 512 map (about 1-2 cm).
    stones = g.fract(g.mul(g.voronoi(110, 110, feature='F1', out='W'), 4.1))
    pores = g.map(g.voronoi(55, 55, feature='F1'), 0.15, 0.07, 0.0, 1.0, smooth=True)
    fine_pores = g.map(g.voronoi(260, 260, feature='F1'), 0.05, 0.02, 0.0, 1.0, smooth=True)
    # Repair patches: a slightly different mix, a step of a millimetre at their edge.
    patch = g.map(g.noise(2.5, 2.5, detail=4), 0.62, 0.66, 0.0, 1.0, smooth=True)
    base = g.ramp(g.add(g.mul(blotch, 0.7), g.mul(mottle, 0.3)), [(0.3, srgb(0x8a8780)), (0.5, srgb(0x9a968e)), (0.7, srgb(0xa6a39b))])
    albedo = g.scale_rgb(base, g.map(grain, 0.3, 0.7, 0.92, 1.06))
    albedo = g.scale_rgb(albedo, g.map(stones, 0.0, 1.0, 0.96, 1.04))
    albedo = g.scale_rgb(albedo, g.map(patch, 0.0, 1.0, 1.0, 1.06))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.add(g.mul(pores, 0.3), g.mul(fine_pores, 0.25))))
    height = g.add(g.add(g.mul(grain, 0.0005), g.mul(blotch, 0.0015)), g.add(g.map(swirl, 0.3, 0.7, 0.0, 0.003), g.mul(patch, 0.001)))
    height = g.add(height, g.add(g.mul(pores, -0.002), g.mul(fine_pores, -0.001)))
    rough = g.add(g.map(mottle, 0.3, 0.7, 0.82, 0.95), g.mul(patch, -0.04))
    return {'albedo': albedo, 'roughness': rough, 'height': height}

lib.run('concrete', TILE, build, ao_radius=0.015, ao_depth=0.003, ao_strength=0.5, normal_strength=2.0)

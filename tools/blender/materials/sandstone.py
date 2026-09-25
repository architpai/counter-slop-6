"""Weathered sandstone: faint beds, rounded facets, a few shallow joints and grit. 4 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 4.0


def build(g):
    # Beds of slightly different tone, broken up by rounded weathered facets, so a cliff reads as
    # rock rather than as stacked boards; joints are sparse and vertical.
    strata = g.noise(0.7, 5, detail=3, roughness=0.5, distortion=0.4)
    bed = g.floor(g.mul(strata, 7.0))
    facets = g.voronoi(7, 7, feature='SMOOTH_F1')
    facet_tone = g.fract(g.mul(g.voronoi(7, 7, feature='F1', out='W'), 3.7))
    lumps = g.noise(12, 12, detail=6, roughness=0.6)
    joints = g.voronoi(5, 2.5, feature='DISTANCE_TO_EDGE')
    joint = g.mul(g.map(joints, 0.016, 0.005, 0.0, 1.0, smooth=True), g.map(g.noise(3, 3, detail=3), 0.55, 0.65, 0.0, 1.0))
    grit = g.noise(600, 600, detail=3)
    tone = g.add(g.add(g.mul(g.white(bed), 0.3), g.mul(facet_tone, 0.1)), g.mul(lumps, 0.6))
    albedo = g.ramp(tone, [(0.2, srgb(0x9c6848)), (0.45, srgb(0xb07d5a)), (0.65, srgb(0xc29270)), (0.85, srgb(0xa87452))])
    albedo = g.scale_rgb(albedo, g.map(grit, 0.3, 0.7, 0.9, 1.07))
    albedo = g.scale_rgb(albedo, g.sub(1.0, g.mul(joint, 0.08)))
    height = g.add(g.add(g.mul(facets, -0.03), g.mul(lumps, 0.02)), g.add(g.mul(grit, 0.0015), g.mul(joint, -0.004)))
    rough = g.map(grit, 0.3, 0.7, 0.86, 0.97)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('sandstone', TILE, build, ao_radius=0.05, ao_depth=0.008, ao_strength=0.6)

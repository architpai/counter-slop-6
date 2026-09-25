"""Unglazed fired clay: warm mottled orange-brown, fine pores, pale lime bloom. 1 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.0


def build(g):
    mottle = g.noise(6, 6, detail=5)
    pores = g.map(g.voronoi(220, 220), 0.05, 0.02, 0.0, 1.0, smooth=True)
    fine = g.noise(400, 400, detail=2)
    bloom = g.map(g.noise(4, 4, detail=6), 0.62, 0.78, 0.0, 1.0)
    albedo = g.ramp(mottle, [(0.3, srgb(0xa0583a)), (0.5, srgb(0xb46a46)), (0.7, srgb(0xc27a54))])
    albedo = g.scale_rgb(albedo, g.mul(g.map(fine, 0.3, 0.7, 0.92, 1.05), g.sub(1.0, g.mul(pores, 0.3))))
    albedo = g.mix_rgb(g.mul(bloom, 0.35), albedo, srgb(0xcfb9a2))
    bumps = g.noise(28, 28, detail=4, roughness=0.55)
    pocks = g.map(g.voronoi(50, 50), 0.1, 0.05, 0.0, 1.0, smooth=True)
    height = g.add(g.add(g.mul(fine, 0.0004), g.mul(pores, -0.0008)), g.add(g.mul(bumps, 0.002), g.mul(pocks, -0.0012)))
    rough = g.map(fine, 0.3, 0.7, 0.8, 0.92)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('terracotta', TILE, build, ao_radius=0.008, ao_depth=0.0015, ao_strength=0.4)

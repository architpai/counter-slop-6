"""Desert sand: fine grains, soft wind ripples that come and go, scattered pebbles. 4 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 4.0


def build(g):
    warp = g.mul(g.sub(g.noise(3, 3, detail=3), 0.5), 0.5)
    ripple = g.sin(g.add(g.mul(g.v, 6.2831853 * 18), g.mul(warp, 6.2831853 * 4)))
    strength = g.map(g.noise(2, 2, detail=3), 0.4, 0.65, 0.2, 1.0)
    grain = g.noise(1200, 1200, detail=2)
    cells = g.voronoi(90, 90, feature='F1')
    pebble = g.map(cells, 0.09, 0.05, 0.0, 1.0, smooth=True)
    tone = g.noise(2.5, 2.5, detail=5)
    albedo = g.ramp(tone, [(0.3, srgb(0xbca47f)), (0.5, srgb(0xcab390)), (0.7, srgb(0xd6c2a0))])
    albedo = g.scale_rgb(albedo, g.map(grain, 0.3, 0.7, 0.9, 1.08))
    albedo = g.scale_rgb(albedo, g.add(1.0, g.mul(ripple, g.mul(strength, 0.03))))
    albedo = g.mix_rgb(g.mul(pebble, 0.7), albedo, srgb(0x8d7a62))
    height = g.add(g.add(g.mul(ripple, g.mul(strength, 0.004)), g.mul(grain, 0.0006)), g.mul(pebble, 0.004))
    rough = g.map(grain, 0.3, 0.7, 0.9, 1.0)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('sand', TILE, build, ao_radius=0.02, ao_depth=0.003, ao_strength=0.5)

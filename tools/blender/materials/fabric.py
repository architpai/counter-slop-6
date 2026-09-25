"""Plain-weave cloth, 2 mm threads, with slubs, lint and soft stains. Tinted to the piece. 0.5 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 0.5
THREADS = 250


def build(g):
    warp = g.sin(g.mul(g.u, 6.2831853 * THREADS))
    weft = g.sin(g.mul(g.v, 6.2831853 * THREADS))
    weave = g.mul(warp, weft)
    slub = g.noise(4, 120, detail=3)
    stain = g.noise(3, 3, detail=5)
    albedo = g.scale_rgb(srgb(0xc4c4c2), g.mul(g.map(weave, -1.0, 1.0, 0.9, 1.04), g.map(slub, 0.3, 0.7, 0.94, 1.04)))
    albedo = g.scale_rgb(albedo, g.map(stain, 0.55, 0.75, 1.0, 0.9))
    creases = g.noise(5, 9, detail=3, distortion=0.6)
    height = g.add(g.add(g.mul(weave, 0.0003), g.mul(slub, 0.0004)), g.map(creases, 0.3, 0.7, 0.0, 0.006))
    rough = g.map(weave, -1.0, 1.0, 0.95, 0.85)
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('fabric', TILE, build, ao_radius=0.002, ao_depth=0.0004, ao_strength=0.4, normal_strength=0.7)

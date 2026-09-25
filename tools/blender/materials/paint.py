"""Smooth paint or plastic: faint orange peel and a few scuffs. Tinted to the piece. 1 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.0


def build(g):
    peel = g.noise(90, 90, detail=3)
    strokes = g.noise(3, 70, detail=3)
    scuff = g.noise(30, 6, detail=6, roughness=0.7)
    marks = g.map(scuff, 0.66, 0.74, 0.0, 1.0)
    albedo = g.scale_rgb(srgb(0xcfcfcf), g.mul(g.map(peel, 0.3, 0.7, 0.985, 1.01), g.sub(1.0, g.mul(marks, 0.08))))
    height = g.add(g.map(peel, 0.3, 0.7, 0.0, 0.00025), g.map(strokes, 0.3, 0.7, 0.0, 0.00012))
    rough = g.add(g.map(peel, 0.3, 0.7, 0.34, 0.42), g.mul(marks, 0.2))
    return {'albedo': albedo, 'roughness': rough, 'height': height}


lib.run('paint', TILE, build, ao_radius=0.004, ao_depth=0.0004, ao_strength=0.2, normal_strength=1.5)

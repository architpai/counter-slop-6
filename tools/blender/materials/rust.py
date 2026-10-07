"""Rusted steel: blotches of orange and brown scale over dark metal, pitting and a few runs. 1.5 m tile."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402
from lib import srgb  # noqa: E402

TILE = 1.5


def build(g):
    patches = g.noise(5, 5, detail=6, roughness=0.6)
    scale = g.noise(18, 18, detail=6, roughness=0.65)
    pits = g.voronoi(160, 160, feature='F1')
    runs = g.noise(24, 3, detail=4)
    fine = g.noise(500, 500, detail=2)
    bare = g.map(g.add(g.mul(patches, 0.7), g.mul(scale, 0.3)), 0.34, 0.29, 0.0, 1.0)
    tone = g.add(g.add(g.mul(scale, 0.5), g.mul(patches, 0.3)), g.mul(fine, 0.2))
    rust = g.ramp(tone, [(0.25, srgb(0x4e2a1c)), (0.42, srgb(0x6e3c24)), (0.55, srgb(0x8e5230)), (0.68, srgb(0xa0643a)), (0.8, srgb(0x7a4a30))])
    rust = g.scale_rgb(rust, g.map(runs, 0.55, 0.8, 1.0, 0.85))
    pit = g.map(pits, 0.08, 0.03, 0.0, 1.0, smooth=True)
    rust = g.scale_rgb(rust, g.sub(1.0, g.mul(pit, 0.35)))
    albedo = g.mix_rgb(bare, rust, g.scale_rgb(srgb(0x4c4b48), g.map(fine, 0.3, 0.7, 0.85, 1.15)))
    flakes = g.voronoi(45, 45, feature='F1', out='W')
    blisters = g.map(g.voronoi(60, 60, feature='SMOOTH_F1'), 0.0, 0.5, 0.0015, 0.0)
    height = g.add(g.add(g.mul(g.sub(1.0, bare), 0.0012), g.mul(scale, 0.002)), g.add(g.mul(pit, -0.0012), g.mul(fine, 0.0003)))
    height = g.add(height, g.mul(g.sub(1.0, bare), g.add(blisters, g.mul(flakes, 0.0006))))
    rough = g.mix(bare, g.map(fine, 0.3, 0.7, 0.78, 0.95), 0.5)
    return {'albedo': albedo, 'roughness': rough, 'metal': g.mul(bare, 0.85), 'height': height}


lib.run('rust', TILE, build, ao_radius=0.01, ao_depth=0.002, ao_strength=0.5)

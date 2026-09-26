"""
The rifle optics (docs/VISUALS.md, R4): a TA31-style ACOG and an EXPS-style
holographic sight, one texture set. Each is its own model, `acog` and
`holo`, with its origin on the top of the Picatinny rail under the middle of
its mount; the game hangs it on a rifle's `optic-mount` socket (R4-C, MP5)
and reads its `sight` socket, the point on the optical axis the aim pose puts
on the screen centre.

The coloured shells wear a near-white atlas: the game tints them with the
shared optic colours (render/palette.ts `OPTIC_COLOR`), so the model and
the aiming overlay stay one colour. Node names match the flat look's parts
(`acog-tube`, `acog-ocular`, `acog-ocular-rim`, `holo-base`, `holo-frame-top`,
`holo-dot`).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/optics.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

ACOG_AXIS = 0.035
HOLO_AXIS = 0.034


def acog():
    w = lib.Weapon('acog', 'optics')
    a = ACOG_AXIS
    body = []
    # Objective housing, the widest part, with a stepped lip.
    body.append(lib.lathe('objective-housing', [(0.024, 0.0), (0.024, 0.0165), (0.030, 0.0195), (0.040, 0.0212), (0.066, 0.0212)], 28, 'Y', (0, 0, a)))
    # The body over the prism: a squared tube with rounded shoulders.
    prism = lib.profile('prism', lib.fillet([(-0.044, a - 0.017), (0.030, a - 0.017), (0.036, a - 0.010), (0.036, a + 0.014),
                                             (0.026, a + 0.020), (-0.036, a + 0.020), (-0.044, a + 0.012)], 0.004, 2), 0.038)
    lib.bevel(prism, 0.004, 2, 30)
    body.append(prism)
    # The fibre housing along the top, and its guard.
    body.append(lib.lathe('fibre-housing', [(-0.040, 0.0), (-0.040, 0.0052), (-0.017, 0.0052), (-0.015, 0.0)], 20, 'Y', (0, 0, a + 0.0235)))
    # Elevation cap on top and windage cap on the right.
    body.append(lib.lathe('elevation', [(0.0, 0.0), (0.0, 0.0095), (0.009, 0.0095), (0.011, 0.008), (0.011, 0.0)], 20, 'Z', (0, -0.006, a + 0.019)))
    body.append(lib.lathe('windage', [(0.0, 0.0), (0.0, 0.0095), (0.009, 0.0095), (0.011, 0.008), (0.011, 0.0)], 20, 'X', (0.018, -0.006, a)))
    # TA51-style mount: a block under the body clamped on the rail, two thumb nuts on the left.
    mount = lib.profile('mount', lib.fillet([(-0.030, -0.0045), (0.030, -0.0045), (0.030, 0.004), (0.022, a - 0.016),
                                             (-0.036, a - 0.016), (-0.036, 0.004)], 0.003), 0.030)
    lib.bevel(mount, 0.0015, 2, 30)
    body.append(mount)
    for y in (-0.018, 0.018):
        body.append(lib.lathe(f'nut{y}', [(0.0, 0.0), (0.0, 0.0065), (0.006, 0.0065), (0.008, 0.005), (0.008, 0.0)], 20, 'X', (-0.015 - 0.008, y, 0.0015)))
        body.append(lib.tube(f'nut-stem{y}', 0.0028, 0.012, (-0.012, y, 0.0015), 'X', 12))
    for o in body:
        lib.paint(o, 'optic-white')
        if not o.modifiers:
            lib.bevel(o, 0.0008, 1, 40)
    w.part('acog-tube', body, material='optic-acog-body')
    ocular = lib.lathe('ocular', [(-0.075, 0.0), (-0.075, 0.0150), (-0.072, 0.0172), (-0.060, 0.0176), (-0.050, 0.0170), (-0.044, 0.0160), (-0.040, 0.0)], 28, 'Y', (0, 0, a), 'optic-white')
    lib.bevel(ocular, 0.0006, 1, 40)
    w.part('acog-ocular', ocular, material='optic-acog-body')
    rim = lib.lathe('ocular-rim', [(-0.0785, 0.0142), (-0.0785, 0.0180), (-0.0745, 0.0184), (-0.0735, 0.0160), (-0.0765, 0.0150)], 28, 'Y', (0, 0, a), 'optic-white', closed=True)
    lib.bevel(rim, 0.0005, 1, 40)
    w.part('acog-ocular-rim', rim, material='optic-acog-rim')
    objective = lib.lathe('objective', [(0.064, 0.0198), (0.064, 0.0226), (0.076, 0.0226), (0.077, 0.0214), (0.076, 0.0180), (0.066, 0.0178)], 28, 'Y', (0, 0, a), 'optic-white', closed=True)
    lib.bevel(objective, 0.0005, 1, 40)
    w.part('acog-objective', objective, material='optic-acog-rim')
    lenses = [lib.lens('lens-front', 0.0675, 0.0180, 0.0030, 1, (0, 0, a)), lib.lens('lens-back', -0.0750, 0.0143, 0.0012, -1, (0, 0, a))]
    w.part('acog-lens', lenses, material='lens')
    fibre = lib.box('fibre', (0.0034, 0.020, 0.0016), (0, -0.028, a + 0.0288), 'glass')
    w.part('acog-fibre', fibre, material='reticle')
    w.socket('sight', (0, -0.0745, a))
    return w


def holo():
    w = lib.Weapon('holo', 'optics')
    a = HOLO_AXIS
    base = []
    # Body and electronics under the window.
    shell = lib.profile('shell', lib.fillet([(-0.046, 0.002), (0.046, 0.002), (0.048, 0.010), (0.044, 0.021), (-0.042, 0.021), (-0.047, 0.012)], 0.003), 0.034)
    lib.bevel(shell, 0.002, 3, 30)
    base.append(shell)
    # Rail clamp and the QD lever on the left.
    clamp = lib.profile('clamp', [(-0.028, -0.0045), (0.028, -0.0045), (0.028, 0.003), (-0.028, 0.003)], 0.028)
    lib.bevel(clamp, 0.001, 2, 30)
    base.append(clamp)
    lever = lib.profile('lever', lib.fillet([(-0.016, -0.004), (0.020, -0.002), (0.020, 0.006), (-0.012, 0.006)], 0.003), 0.004, x=-0.0185)
    lib.bevel(lever, 0.0008, 2, 30)
    base.append(lever)
    # Buttons at the back on the left, battery cap at the front on the right.
    for i, y in enumerate((-0.036, -0.026)):
        b = lib.lathe(f'button{i}', [(0.0, 0.0), (0.0, 0.0035), (0.0022, 0.0033), (0.0028, 0.0)], 16, 'X', (-0.0170, y, 0.013))
        base.append(b)
    base.append(lib.lathe('battery-cap', [(0.0, 0.0), (0.0, 0.0078), (0.004, 0.0078), (0.0055, 0.0065), (0.0055, 0.0)], 24, 'X', (0.0168, 0.032, 0.012)))
    for o in base:
        lib.paint(o, 'optic-white')
        if not o.modifiers:
            lib.bevel(o, 0.0006, 2, 40)
    w.part('holo-base', base, material='optic-holo-base')
    # The hood: a U frame round the window, seen from the front.
    outer = lib.extrude_y('hood', lib.fillet([(-0.0185, 0.019), (0.0185, 0.019), (0.0185, 0.049), (0.0145, 0.053), (-0.0145, 0.053), (-0.0185, 0.049)], 0.003), -0.034, 0.024)
    window = lib.box('window', (0.030, 0.1, 0.0255), (0, 0, a + 0.001))
    lib.cut(outer, window)
    lib.paint(outer, 'optic-white')
    lib.bevel(outer, 0.0012, 2, 35)
    w.part('holo-frame-top', outer, material='optic-holo-body')
    glass = lib.box('glass', (0.030, 0.0015, 0.0255), (0, 0.004, a + 0.001), 'glass')
    w.part('holo-glass', glass, material='holo-glass')
    dot = lib.lathe('dot', [(0.0, 0.0), (0.0, 0.0007), (0.0003, 0.0007), (0.0003, 0.0)], 12, 'Y', (0, 0.0025, a), 'glass')
    ring = lib.lathe('ring', [(0.0, 0.0056), (0.0, 0.0062), (0.0003, 0.0062), (0.0003, 0.0056)], 32, 'Y', (0, 0.0025, a), 'glass', closed=True)
    w.part('holo-dot', [dot, ring], material='reticle')
    w.socket('sight', (0, 0.0025, a))
    # Apart from the ACOG while baking, so neither shades the other; the game places both.
    w.root.location = (0.3, 0, 0)
    return w


def main():
    opts = lib.options()
    lib.reset()
    models = [acog(), holo()]
    lib.assemble(models)
    if opts['preview']:
        folder = os.path.join(opts['out'], 'optics')
        os.makedirs(folder, exist_ok=True)
        for m in models:
            lib.preview(os.path.join(folder, f'preview-{m.name}'), [m], views=('side', 'back', 'front', 'top'), ortho=0.2, centre=(0, 0, 0.03))
    if opts['bake']:
        lib.finish(models, opts, 'optics')


if __name__ == '__main__':
    main()

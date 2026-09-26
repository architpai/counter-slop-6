"""
The sniper rifle (docs/VISUALS.md, R4): a round bolt action in an olive
thumbhole chassis, a fluted heavy barrel with a muzzle brake, a folded
bipod, a detachable box magazine with the player-blue floor plate and a
30 mm scope in rings. The bore runs along +Y at z = 0.009.

Moving parts: bolt (turns on its axis and runs back), magazine, trigger,
both hands (the right one works the bolt). Sockets: muzzle, eject, sight
(the scope's eyepiece on its axis). Clips: cycle (the bolt, 0.85 s), reload
and reload-empty (2.1 s; the empty one cycles the bolt after seating the
magazine), equip (0.6 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/sniper.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

BORE = 0.009
RAIL = BORE + 0.0165
AXIS = RAIL + 0.0055 + 0.031
CYCLE = 0.85
RELOAD = 2.1
DRAW = 0.6


def action(w):
    # The round receiver and its recoil lug, the ejection port cut on the right.
    body = lib.lathe('receiver', [(-0.082, 0.0), (-0.082, 0.0160), (-0.078, 0.0170), (0.106, 0.0170), (0.110, 0.0160), (0.110, 0.0)], 32, 'Y', (0, 0, BORE), 'parkerized')
    lib.cut(body, lib.box('port', (0.016, 0.060, 0.016), (0.012, 0.028, BORE + 0.008)), lib.box('bolt-slot', (0.016, 0.024, 0.010), (0.012, -0.060, BORE + 0.002)))
    lib.bevel(body, 0.0008, 2)
    w.add(body)
    w.add(lib.rail('scope-rail', -0.074, 0.104, RAIL, 'anodized'))
    # Barrel: heavy, fluted (a ring of shallow flats), stepping down to the brake.
    w.add(lib.lathe('barrel', [(0.108, 0.0), (0.108, 0.0135), (0.160, 0.0125), (0.620, 0.0098), (0.620, 0.0)], 12, 'Y', (0, 0, BORE), 'dark-steel', phase=math.pi / 12))
    # Muzzle brake: baffles joined by top and bottom bars, open ports on both sides.
    baffles = [lib.lathe(f'baffle{i}', [(y, 0.0058), (y, 0.0128), (y + 0.007, 0.0128), (y + 0.007, 0.0058)], 28, 'Y', (0, 0, BORE), 'parkerized', closed=True)
               for i, y in enumerate((0.618, 0.638, 0.658, 0.680))]
    bars = [lib.box(f'brake-bar{s}', (0.014, 0.069, 0.0045), (0, 0.6525, BORE + s * 0.0105), 'parkerized') for s in (-1, 1)]
    brake = lib.join('brake', [*baffles, *bars])
    lib.bevel(brake, 0.0005, 1)
    w.add(brake)
    # Olive chassis: free-float forend, magazine well, thumbhole grip and a short butt with a cheek piece.
    # The comb sits 4 cm under the scope's axis, where a cheek puts the eye on it: 1.3 cm under (the first
    # build), the aimed eye, 9 cm behind the eyepiece, had the comb right under it, and the camera's near
    # plane cut it open on every aim-in.
    chassis = lib.profile('chassis', lib.fillet([(-0.080, BORE - 0.012), (0.360, BORE - 0.012), (0.362, BORE - 0.030), (0.340, BORE - 0.040), (0.100, BORE - 0.040),
                                                (0.092, BORE - 0.048), (0.012, BORE - 0.048), (0.004, BORE - 0.040), (-0.040, BORE - 0.040),
                                                (-0.052, BORE - 0.064), (-0.060, BORE - 0.108), (-0.096, BORE - 0.112), (-0.092, BORE - 0.080),
                                                (-0.130, BORE - 0.060), (-0.250, BORE - 0.080), (-0.262, BORE - 0.078), (-0.262, BORE + 0.010),
                                                (-0.160, BORE + 0.013), (-0.112, BORE + 0.011), (-0.090, BORE + 0.004)],
                                               [0.004, 0.004, 0.006, 0.006, 0.004, 0.004, 0.004, 0.004, 0.004, 0.01, 0.006, 0.006, 0.01, 0.02, 0.008, 0.004, 0.004, 0.02, 0.01, 0.006], 3),
                          0.040, finish='polymer-olive')
    thumbhole = lib.profile('thumbhole', lib.fillet([(-0.084, BORE - 0.012), (-0.120, BORE - 0.030), (-0.126, BORE - 0.052), (-0.098, BORE - 0.066), (-0.080, BORE - 0.040)], 0.008, 3), 0.06)
    lib.cut(chassis, thumbhole, lib.box('forend-vents', (0.06, 0.140, 0.012), (0, 0.240, BORE - 0.026)))
    lib.bevel(chassis, 0.0035, 3, 30)
    w.add(chassis)
    grip = lib.profile('grip-panel', lib.fillet([(-0.050, BORE - 0.066), (-0.058, BORE - 0.106), (-0.094, BORE - 0.110), (-0.090, BORE - 0.080)], 0.004), 0.042, finish='polymer-olive-stipple')
    lib.bevel(grip, 0.003, 2, 30)
    w.add(grip)
    pad = lib.profile('butt-pad', lib.fillet([(-0.262, BORE + 0.011), (-0.262, BORE - 0.079), (-0.274, BORE - 0.081), (-0.274, BORE + 0.013)], 0.005), 0.042, finish='rubber')
    lib.bevel(pad, 0.003, 2, 30)
    w.add(pad)
    # Trigger guard cut into the chassis bottom.
    guard = lib.profile('trigger-guard', lib.fillet([(-0.040, BORE - 0.040), (0.004, BORE - 0.040), (0.004, BORE - 0.046), (-0.004, BORE - 0.060), (-0.036, BORE - 0.060), (-0.042, BORE - 0.050)], 0.004), 0.012, finish='polymer-olive')
    lib.cut(guard, lib.box('guard-hole', (0.02, 0.036, 0.018), (0, -0.018, BORE - 0.049)))
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    # Bipod folded forward under the forend.
    w.add(lib.box('bipod-mount', (0.022, 0.022, 0.010), (0, 0.320, BORE - 0.045), 'anodized'))
    for side in (-1, 1):
        leg = lib.lathe(f'bipod-leg{side}', [(0.150, 0.0), (0.150, 0.0045), (0.318, 0.0045), (0.318, 0.0)], 12, 'Y', (side * 0.009, 0, BORE - 0.052), 'anodized')
        foot = lib.lathe(f'bipod-foot{side}', [(0.142, 0.0), (0.142, 0.0055), (0.152, 0.0055), (0.152, 0.0)], 12, 'Y', (side * 0.009, 0, BORE - 0.052), 'rubber')
        w.add(leg)
        w.add(foot)
    # The scope: rings on the rail, a 30 mm tube, turrets, bells and lenses seated in them.
    for y in (-0.034, 0.066):
        ring = lib.lathe(f'ring{y}', [(y - 0.008, 0.0150), (y - 0.008, 0.0192), (y + 0.008, 0.0192), (y + 0.008, 0.0150)], 28, 'Y', (0, 0, AXIS), 'anodized', closed=True)
        base = lib.profile(f'ring-base{y}', lib.fillet([(y - 0.010, RAIL - 0.001), (y + 0.010, RAIL - 0.001), (y + 0.008, AXIS - 0.012), (y - 0.008, AXIS - 0.012)], 0.002), 0.024, finish='anodized')
        lib.bevel(base, 0.001, 2)
        w.add(ring)
        w.add(base)
    tube = lib.lathe('scope-tube', [(-0.080, 0.0), (-0.080, 0.0150), (0.100, 0.0150), (0.118, 0.0270), (0.176, 0.0280), (0.178, 0.0266), (0.178, 0.0256), (0.172, 0.0256), (0.172, 0.0)], 36, 'Y', (0, 0, AXIS), 'anodized')
    lib.bevel(tube, 0.0006, 2, 30)
    w.add(tube)
    eyepiece = lib.lathe('eyepiece', [(-0.137, 0.0), (-0.137, 0.0170), (-0.140, 0.0170), (-0.140, 0.0205), (-0.126, 0.0215), (-0.100, 0.0200), (-0.084, 0.0160), (-0.078, 0.0150), (-0.078, 0.0)], 36, 'Y', (0, 0, AXIS), 'anodized')
    lib.bevel(eyepiece, 0.0006, 2, 30)
    w.add(eyepiece)
    w.add(lib.lathe('eye-ring', [(-0.1415, 0.0170), (-0.1415, 0.0210), (-0.137, 0.0212), (-0.137, 0.0172)], 36, 'Y', (0, 0, AXIS), 'rubber', closed=True))
    turret = lib.lathe('elevation', [(0.0, 0.0), (0.0, 0.0130), (0.016, 0.0130), (0.018, 0.0115), (0.018, 0.0)], 28, 'Z', (0, 0.016, AXIS + 0.012), 'knurl')
    w.add(turret)
    w.add(lib.lathe('windage', [(0.0, 0.0), (0.0, 0.0115), (0.014, 0.0115), (0.016, 0.0100), (0.016, 0.0)], 28, 'X', (0.012, 0.016, AXIS), 'knurl'))
    w.add(lib.lathe('parallax', [(0.0, 0.0), (0.0, 0.0100), (-0.012, 0.0100), (-0.014, 0.0088), (-0.014, 0.0)], 28, 'X', (-0.012, 0.016, AXIS), 'knurl'))
    w.add(lib.box('turret-housing', (0.030, 0.034, 0.024), (0, 0.016, AXIS), 'anodized'))
    lenses = [lib.lens('lens-front', 0.1725, 0.0255, 0.0025, 1, (0, 0, AXIS)), lib.lens('lens-back', -0.1365, 0.0172, 0.0010, -1, (0, 0, AXIS))]
    w.part('lens', lenses, material='lens')


def moving(w):
    # Bolt: body and shroud on the axis, the handle on the right with its knob, all turning on the axis.
    body = lib.lathe('bolt-body', [(-0.098, 0.0), (-0.098, 0.0118), (-0.084, 0.0130), (0.060, 0.0120), (0.060, 0.0)], 24, 'Y', (0, 0, BORE), 'satin')
    shroud = lib.lathe('bolt-shroud', [(-0.110, 0.0), (-0.110, 0.0100), (-0.098, 0.0124), (-0.094, 0.0124), (-0.094, 0.0)], 24, 'Y', (0, 0, BORE), 'parkerized')
    stem = lib.lathe('bolt-stem', [(0.0, 0.0), (0.0, 0.0038), (0.036, 0.0034), (0.040, 0.0)], 12, 'X', (0.008, -0.062, BORE), 'satin')
    stem.data.transform(lib.Matrix.Translation((0.008, -0.062, BORE)) @ lib.Matrix.Rotation(-0.55, 4, 'Y') @ lib.Matrix.Rotation(0.35, 4, 'Z') @ lib.Matrix.Translation((-0.008, 0.062, -BORE)))
    knob = lib.lathe('bolt-knob', [(0.0, 0.0), (0.0, 0.0), (0.001, 0.0060), (0.007, 0.0092), (0.014, 0.0088), (0.018, 0.0050), (0.019, 0.0)], 16, 'X', (0.040, -0.062, BORE), 'polymer')
    knob.data.transform(lib.Matrix.Translation((0.008, -0.062, BORE)) @ lib.Matrix.Rotation(-0.55, 4, 'Y') @ lib.Matrix.Rotation(0.35, 4, 'Z') @ lib.Matrix.Translation((-0.008, 0.062, -BORE)))
    for o in (stem, shroud):
        lib.bevel(o, 0.0006, 2)
    w.part('bolt', [body, shroud, stem, knob], origin=(0, -0.062, BORE))
    mag = lib.profile('mag-body', lib.fillet([(0.018, BORE - 0.010), (0.088, BORE - 0.010), (0.088, BORE - 0.068), (0.018, BORE - 0.068)], 0.003), 0.030, finish='parkerized')
    lib.bevel(mag, 0.0012, 2)
    plate = lib.profile('mag-floor', lib.fillet([(0.015, BORE - 0.068), (0.091, BORE - 0.068), (0.091, BORE - 0.076), (0.015, BORE - 0.076)], 0.003), 0.033, finish='polymer-blue')
    lib.bevel(plate, 0.0012, 2)
    w.part('magazine', [mag, plate], origin=(0, 0.053, BORE - 0.010))
    trigger = lib.profile('trigger', lib.fillet([(-0.022, BORE - 0.040), (-0.016, BORE - 0.040), (-0.016, BORE - 0.046), (-0.020, BORE - 0.054), (-0.025, BORE - 0.056), (-0.023, BORE - 0.051), (-0.021, BORE - 0.046)], 0.001, 2), 0.005, finish='dark-steel')
    w.part('trigger', trigger, origin=(0, -0.019, BORE - 0.040))


RIGHT = {
    'index': {'curl': (0.35, 1.05, 0.45), 'splay': -0.06}, 'middle': {'curl': (1.15, 1.45, 0.65)},
    'ring': {'curl': (1.2, 1.5, 0.65)}, 'pinky': {'curl': (1.25, 1.45, 0.65)},
    'thumb': [(-0.6, 0.0, -0.2), (-0.5, 0, 0), (-0.35, 0, 0)],
}
# The support hand wraps the forend: the palm on its lower left, the fingers
# round the bottom and up the far side, the thumb forward along the near side.
LEFT = {
    'index': {'curl': (1.3, 1.2, 0.6)}, 'middle': {'curl': (1.35, 1.3, 0.6)},
    'ring': {'curl': (1.4, 1.35, 0.6)}, 'pinky': {'curl': (1.45, 1.35, 0.6)},
    'thumb': [(0.0, 0.0, 0.3), (0.2, 0, 0), (0.2, 0, 0)],
}
# The open hand under the forend that the reload's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.072, 0.190, -0.058), fingers=(0.85, 0.51, 0.11), back=(-0.35, 0.0, -0.95), forearm=(-0.45, -0.70, -0.55))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.033, -0.160, -0.068), fingers=(0, 1, 0.16), back=(0.97, 0, 0.25), forearm=(0.35, -0.75, -0.55))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.058, 0.205, -0.022), fingers=(0.83, 0.3, -0.475), back=(-0.5, 0.0, -0.87), forearm=(-0.45, -0.70, -0.55), side='L')


def bolt_cycle(c, start, end):
    """Work the bolt between two shares of a clip: the right hand to the knob, up, back, forward, down, home."""
    span = end - start
    at = lambda f: start + f * span
    knob, up, grip = (0.012, 0.030, 0.048), (-0.012, 0.0, 0.022), (0.2, -0.3, 0.1)
    raised = (knob[0] + up[0], knob[1], knob[2] + up[2])
    c.at('right-hand', at(0.0)).at('right-hand', at(0.14), loc=knob, rot=grip)
    c.at('right-hand', at(0.26), loc=raised, rot=grip)
    c.at('right-hand', at(0.46), loc=(raised[0], raised[1] - 0.085, raised[2]), rot=grip)
    c.at('right-hand', at(0.62), loc=raised, rot=grip)
    c.at('right-hand', at(0.72), loc=knob, rot=grip).at('right-hand', at(0.95))
    c.at('bolt', at(0.14)).at('bolt', at(0.26), rot=(0, -1.0, 0)).at('bolt', at(0.46), loc=(0, -0.085, 0), rot=(0, -1.0, 0))
    c.at('bolt', at(0.62), rot=(0, -1.0, 0)).at('bolt', at(0.72))
    c.at('pivot', at(0.2), loc=(-0.01, 0.0, 0.01), rot=(0.05, -0.18, 0.04)).at('pivot', at(0.62), loc=(-0.01, 0.0, 0.01), rot=(0.05, -0.18, 0.04)).at('pivot', at(0.95))


def clips(w):
    c = lib.Clip(w, 'cycle', CYCLE)
    bolt_cycle(c, 0.0, 1.0)
    tilt, lift = (0.30, 0.55, 0.05), (-0.015, -0.02, 0.05)
    hold = (0.062, -0.150, -0.070)
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        c = lib.Clip(w, name, RELOAD)
        end = 0.82 if name == 'reload' else 0.62
        c.at('pivot', 0.15, loc=lift, rot=tilt).at('pivot', end, loc=lift, rot=tilt)
        c.at('magazine', 0.17).at('magazine', 0.23, loc=(0, 0.0, -0.030))
        c.at('magazine', 0.38, loc=(-0.03, 0.01, -0.32), rot=(0.5, 0.4, 0.2)).at('magazine', 0.46, loc=(-0.03, 0.01, -0.32), rot=(0.5, 0.4, 0.2))
        c.at('magazine', 0.54, loc=(0, 0.0, -0.028)).at('magazine', 0.58, loc=(0, 0, 0.002)).at('magazine', 0.61)
        c.at('left-hand', 0.04).at('left-hand', 0.16, loc=hold, rot=(0.15, -0.25, 0.35), base=held)
        c.at('left-hand', 0.23, loc=(hold[0], hold[1], hold[2] - 0.030), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.38, loc=(-0.02, -0.12, -0.40), rot=(0.6, -0.1, 0.5), base=held).at('left-hand', 0.46, loc=(-0.02, -0.12, -0.40), rot=(0.6, -0.1, 0.5), base=held)
        c.at('left-hand', 0.54, loc=(hold[0], hold[1], hold[2] - 0.028), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.58, loc=(hold[0], hold[1], hold[2] - 0.004), rot=(0.25, -0.25, 0.35), base=held)
        c.at('left-hand', 0.62, loc=hold, rot=(0.15, -0.25, 0.35), base=held).at('left-hand', 0.80)
        if name == 'reload':
            c.at('pivot', 0.97)
        else:
            c.at('pivot', 0.70)
            bolt_cycle(c, 0.66, 0.99)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(0.03, -0.12, -0.14), rot=(0.5, 0.3, 0.2)).at('left-hand', 0.5, loc=(0.02, -0.07, -0.07), rot=(0.3, 0.2, 0.1)).at('left-hand', 0.88)


def build():
    w = lib.Weapon('sniper', pivot=(0, -0.07, -0.035))
    action(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.695, BORE))
    w.socket('eject', (0.018, 0.028, BORE + 0.008))
    w.socket('sight', (0, -0.141, AXIS))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'sniper', (('cycle', (0.26, 0.46)), ('reload', (0.3,)), ('reload-empty', (0.8,))), rest=(0.15, -0.13, -0.26))
    if opts['bake']:
        lib.finish([w], opts, 'sniper')


if __name__ == '__main__':
    main()

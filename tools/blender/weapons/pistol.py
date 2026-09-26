"""
The pistol (docs/VISUALS.md, R4): a striker-fired polymer-frame 9 mm with a
steel slide (rear serrations, ejection port with the barrel hood in it,
three-dot sights), an accessory rail, a stippled grip and a magazine with
the player-blue base plate, held in a two-handed grip. The bore runs along
+Y at z = 0.025.

Moving parts: slide (it recoils on each shot and racks in the empty
reload), magazine, trigger, both hands. Sockets: muzzle, eject, sight (the
front post, level with the rear notch). Clips: reload and reload-empty
(1.0 s; the empty one racks the slide overhand), equip (0.2 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/pistol.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

BORE = 0.025
SLIDE_TOP = 0.041
RELOAD = 1.0
DRAW = 0.2


def frame(w):
    body = lib.profile('frame', lib.fillet([(-0.052, 0.012), (0.126, 0.012), (0.126, 0.004), (0.036, -0.004), (0.030, -0.010), (0.014, -0.010),
                                           (-0.020, -0.004), (-0.034, 0.004), (-0.048, 0.008)], [0.002, 0.002, 0.003, 0.004, 0.002, 0.002, 0.004, 0.004, 0.004]), 0.0245, finish='polymer')
    lib.bevel(body, 0.0014, 2)
    w.add(body)
    # Squared trigger guard.
    guard = lib.profile('trigger-guard', lib.fillet([(-0.016, -0.002), (0.034, -0.002), (0.036, -0.012), (0.028, -0.024), (-0.012, -0.026), (-0.020, -0.012)], [0.002, 0.002, 0.004, 0.004, 0.004, 0.003]), 0.012, finish='polymer')
    lib.cut(guard, lib.profile('guard-hole', lib.fillet([(-0.012, 0.004), (0.028, 0.004), (0.028, -0.012), (0.022, -0.019), (-0.008, -0.020), (-0.013, -0.010)], 0.003), 0.03))
    lib.bevel(guard, 0.0009, 2)
    w.add(guard)
    # Grip: raked back, finger grooves in front, a beavertail on top.
    grip = lib.profile('grip', lib.fillet([(-0.018, -0.004), (-0.022, -0.022), (-0.026, -0.036), (-0.028, -0.050), (-0.032, -0.064), (-0.036, -0.082), (-0.070, -0.086),
                                          (-0.066, -0.060), (-0.058, -0.030), (-0.052, -0.004), (-0.062, 0.006), (-0.056, 0.012), (-0.040, 0.008)],
                                         [0.002, 0.004, 0.003, 0.004, 0.003, 0.004, 0.005, 0.008, 0.008, 0.004, 0.003, 0.002, 0.004], 4), 0.0290, finish='polymer-stipple')
    lib.bevel(grip, 0.005, 4, 30)
    w.add(grip)
    # Accessory rail under the dust cover: two cross slots.
    for y in (0.076, 0.096):
        w.add(lib.box(f'rail-slot{y}', (0.022, 0.004, 0.002), (0, y, 0.0035), 'polymer'))
    # Slide stop and takedown lever on the left, magazine release on the left behind the guard.
    stop = lib.profile('slide-stop', lib.fillet([(0.006, 0.010), (0.030, 0.010), (0.030, 0.014), (0.006, 0.014)], 0.001), 0.0025, x=-0.0132, finish='dark-steel')
    w.add(stop)
    w.add(lib.box('takedown', (0.002, 0.008, 0.004), (-0.0130, 0.040, 0.011), 'dark-steel'))
    w.add(lib.box('mag-release', (0.004, 0.008, 0.008), (-0.0135, -0.014, 0.001), 'polymer'))


def slide(w):
    s = lib.profile('slide', lib.fillet([(-0.056, 0.012), (0.128, 0.012), (0.130, 0.016), (0.130, SLIDE_TOP - 0.004), (0.124, SLIDE_TOP), (-0.050, SLIDE_TOP), (-0.056, SLIDE_TOP - 0.004)],
                                        [0.001, 0.001, 0.002, 0.004, 0.004, 0.003, 0.002]), 0.0255, finish='parkerized',
                    taper=lambda y, z: 0.01275 if z < SLIDE_TOP - 0.008 else 0.01275 - (z - (SLIDE_TOP - 0.008)) * 0.35)
    cuts = [lib.box('port', (0.014, 0.034, 0.012), (0.009, 0.050, SLIDE_TOP - 0.002)), lib.tube('muzzle-hole', 0.0058, 0.02, (0, 0.130, BORE), 'Y', 16)]
    for side in (-1, 1):
        for i in range(7):
            cuts.append(lib.box(f'serration{side}{i}', (0.003, 0.0016, 0.022), (side * 0.0135, -0.050 + i * 0.0036, 0.028)))
    lib.cut(s, *cuts)
    lib.bevel(s, 0.0009, 2)
    hood = lib.box('barrel-hood', (0.0110, 0.034, 0.012), (0.0015, 0.050, SLIDE_TOP - 0.008), 'steel')
    barrel = lib.lathe('barrel', [(0.090, 0.0), (0.090, 0.0060), (0.128, 0.0060), (0.128, 0.0)], 16, 'Y', (0, 0, BORE), 'steel')
    lib.cut(barrel, lib.tube('bore', 0.0042, 0.05, (0, 0.12, BORE), 'Y', 12))
    front = lib.profile('front-sight', lib.fillet([(0.116, SLIDE_TOP - 0.001), (0.124, SLIDE_TOP - 0.001), (0.123, SLIDE_TOP + 0.0055), (0.117, SLIDE_TOP + 0.0055)], 0.0008), 0.0036, finish='dark-steel')
    rear = lib.profile('rear-sight', lib.fillet([(-0.052, SLIDE_TOP - 0.001), (-0.040, SLIDE_TOP - 0.001), (-0.041, SLIDE_TOP + 0.0055), (-0.050, SLIDE_TOP + 0.0055)], 0.0008), 0.0150, finish='dark-steel')
    lib.cut(rear, lib.box('notch', (0.0042, 0.02, 0.006), (0, -0.046, SLIDE_TOP + 0.0055)))
    dots = [lib.lathe('front-dot', [(0.0, 0.0), (0.0, 0.0011), (0.0004, 0.0011), (0.0004, 0.0)], 12, 'Y', (0, 0.1242, SLIDE_TOP + 0.0034), 'optic-white')]
    for x in (-0.0048, 0.0048):
        dots.append(lib.lathe(f'rear-dot{x}', [(0.0, 0.0), (0.0, 0.0011), (-0.0004, 0.0011), (-0.0004, 0.0)], 12, 'Y', (x, -0.0522, SLIDE_TOP + 0.0034), 'optic-white'))
    w.part('slide', [s, hood, barrel, front, rear, *dots], origin=(0, 0.036, BORE))


def moving(w):
    body = lib.profile('mag-body', lib.fillet([(-0.052, 0.008), (-0.030, 0.008), (-0.038, -0.078), (-0.060, -0.078)], 0.002), 0.0215, finish='polymer')
    plate = lib.profile('mag-base', lib.fillet([(-0.070, -0.084), (-0.034, -0.082), (-0.033, -0.091), (-0.070, -0.093)], 0.0025), 0.0285, finish='polymer-blue')
    lib.bevel(plate, 0.001, 2)
    top = lib.lathe('mag-round', [(-0.046, 0.0), (-0.046, 0.0045), (-0.034, 0.0045), (-0.030, 0.0025), (-0.029, 0.0)], 12, 'Y', (0, 0, 0.004), 'brass')
    w.part('magazine', [body, plate, top], origin=(0, -0.045, 0.008))
    trigger = lib.profile('trigger', lib.fillet([(0.010, -0.001), (0.016, -0.001), (0.016, -0.007), (0.012, -0.014), (0.007, -0.016), (0.009, -0.011), (0.011, -0.006)], 0.001, 2), 0.0055, finish='polymer')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, 0.013, -0.001))


# Thumbs forward: the firing hand high on the grip, its index on the trigger
# and its thumb along the left of the frame; the support hand's palm on the
# left panel, its fingers wrapped over the firing hand's, its thumb forward
# under the other.
RIGHT = {
    'index': {'curl': (0.2, 0.45, 0.25), 'splay': -0.15}, 'middle': {'curl': (1.35, 1.5, 0.7)},
    'ring': {'curl': (1.4, 1.55, 0.7)}, 'pinky': {'curl': (1.45, 1.5, 0.7)},
    'thumb': [(-0.3, 0.0, -0.15), (0.0, 0, 0), (0.0, 0, 0)],
}
LEFT = {
    'index': {'curl': (1.4, 1.4, 0.6)}, 'middle': {'curl': (1.45, 1.45, 0.6)},
    'ring': {'curl': (1.5, 1.45, 0.6)}, 'pinky': {'curl': (1.55, 1.4, 0.6)},
    'thumb': [(0.0, 0.0, -0.35), (0.0, 0, 0), (0.0, 0, 0)],
}
# The support hand's frame that the reload's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.050, -0.098, -0.066), fingers=(0.55, 0.80, 0.25), back=(-0.75, 0.2, -0.55), forearm=(-0.40, -0.75, -0.50))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.013, -0.108, -0.043), fingers=(0.16, 0.95, 0.27), back=(0.93, -0.3, 0.1), forearm=(0.45, -0.75, -0.48))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.030, -0.084, -0.082), fingers=(0.1, 0.9, 0.42), back=(-0.9, 0.0, -0.4), forearm=(-0.48, -0.74, -0.48), side='L')


def clips(w):
    """Reload: the magazine drops, the support hand brings it back and seats it; the empty one then racks the slide."""
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        c = lib.Clip(w, name, RELOAD)
        tilt = (0.12, 0.35, 0.10)
        c.at('pivot', 0.12, loc=(0, 0, 0.02), rot=tilt).at('pivot', 0.75 if name == 'reload' else 0.62, loc=(0, 0, 0.02), rot=tilt)
        c.at('magazine', 0.10).at('magazine', 0.26, loc=(0, -0.01, -0.30), rot=(0.3, 0.2, 0), ease='LINEAR')
        c.at('magazine', 0.38, loc=(-0.02, -0.02, -0.30), rot=(0.3, 0.2, 0)).at('magazine', 0.56, loc=(0, -0.004, -0.030))
        c.at('magazine', 0.62, loc=(0, 0, 0.002)).at('magazine', 0.66)
        low = (-0.02, -0.03, -0.28)
        c.at('left-hand', 0.08).at('left-hand', 0.22, loc=(-0.03, -0.02, -0.10), rot=(0.3, 0.1, 0.2), base=held)
        c.at('left-hand', 0.36, loc=low, rot=(0.4, 0.2, 0.3), base=held).at('left-hand', 0.40, loc=low, rot=(0.4, 0.2, 0.3), base=held)
        c.at('left-hand', 0.56, loc=(0.010, 0.030, -0.036), rot=(0.1, 0.1, 0.1), base=held).at('left-hand', 0.63, loc=(0.010, 0.032, -0.030), rot=(0.1, 0.1, 0.1), base=held)
        if name == 'reload':
            c.at('left-hand', 0.82).at('pivot', 0.95)
        else:
            # Overhand rack: the palm over the slide's rear, pulled back and let go.
            rack = (0.034, 0.030, 0.105)
            c.at('left-hand', 0.70, loc=rack, rot=(-0.4, 0.3, 0.8), base=held).at('left-hand', 0.78, loc=(rack[0], rack[1] - 0.036, rack[2]), rot=(-0.4, 0.3, 0.8), base=held)
            c.at('left-hand', 0.82, loc=(rack[0], rack[1] - 0.040, rack[2] + 0.01), rot=(-0.4, 0.3, 0.8), base=held).at('left-hand', 0.96)
            c.at('slide', 0.70).at('slide', 0.78, loc=(0, -0.032, 0)).at('slide', 0.80, loc=(0, -0.032, 0)).at('slide', 0.83, ease='LINEAR')
            c.at('pivot', 0.70, loc=(0, 0.01, 0.01), rot=(0.1, -0.2, 0.2)).at('pivot', 0.8, loc=(0, 0.004, 0.01), rot=(0.12, -0.2, 0.2)).at('pivot', 0.96)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(-0.03, -0.05, -0.10), rot=(0.4, 0.2, 0.2)).at('left-hand', 0.85)


def build():
    w = lib.Weapon('pistol', pivot=(0, -0.045, -0.02))
    frame(w)
    slide(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.131, BORE))
    w.socket('eject', (0.012, 0.050, SLIDE_TOP))
    w.socket('sight', (0, 0.120, SLIDE_TOP + 0.0055))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'pistol', (('reload', (0.3, 0.56)), ('reload-empty', (0.78,))), rest=(0.12, -0.095, -0.33), rot=(-0.04, 0.05, 0))
    if opts['bake']:
        lib.finish([w], opts, 'pistol')


if __name__ == '__main__':
    main()

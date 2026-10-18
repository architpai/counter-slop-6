"""
The pistol (docs/VISUALS.md, R4): a heavy, large-frame .50 semi-auto of our
own design. A long, tall, slab-sided steel slide runs the full length of the
barrel to a wide squared muzzle face (the bore and the recoil-spring guide
under it), with a ribbed top rail, bold slanted serrations at the rear and a
short set at the front, a long flute down each side, an ejection port on the
right with the chamber in it, and a slide-mounted safety on both sides. The
alloy frame carries a full-length dust cover, a big squared trigger guard
with a serrated front, a spur hammer and a beavertail; the grip is a thick
wrap-around stippled sleeve, and the magazine has an oversized
player-blue base plate. Three-dot sights; held in a two-handed grip. The
bore runs along +Y at z = 0.033.

Moving parts: slide (it recoils on each shot and racks in the empty
reload), magazine, trigger, both hands. Sockets: muzzle, eject, sight (the
front post, level with the rear notch). Clips: reload and reload-empty
(1.0 s; the empty one racks the slide overhand), equip (0.12 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/pistol.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

BORE = 0.033
# The slide: its underside, where its slab sides break into the top chamfers, its top flat, and the rib on that.
SLIDE_LOW = 0.010
SLIDE_SHOULDER = 0.044
SLIDE_TOP = 0.050
RIB_TOP = 0.0555
# The sight line: the front post's tip and the rear notch's floor.
SIGHT = 0.0625
# Half the slide's width (slab sides), half the frame's.
HALF = 0.0168
FRAME_HALF = 0.0150
# The slide's rear face and muzzle face.
REAR = -0.078
FRONT = 0.182
# weapons/stats.ts: reloadDuration and drawTime.
RELOAD = 1.0
DRAW = 0.12


def frame(w):
    # Frame: a full-length dust cover under the slide, the trigger housing, the beavertail over the web of the hand.
    body = lib.profile('frame', lib.fillet([(-0.088, 0.005), (-0.074, SLIDE_LOW), (0.176, SLIDE_LOW), (0.176, -0.008), (0.070, -0.008), (0.062, -0.013),
                                           (-0.012, -0.013), (-0.022, -0.006), (-0.062, -0.006), (-0.082, -0.009), (-0.096, -0.007), (-0.099, -0.001)],
                                           [0.004, 0.001, 0.001, 0.003, 0.004, 0.003, 0.003, 0.004, 0.004, 0.006, 0.004, 0.003]), 2 * FRAME_HALF, finish='anodized')
    lib.cut(body, *(lib.box(f'dust-groove{side}', (0.003, 0.068, 0.0035), (side * FRAME_HALF, 0.136, -0.0015)) for side in (-1, 1)))
    lib.bevel(body, 0.0016, 2)
    w.add(body)
    # A big squared trigger guard, its front serrated for the support hand's finger.
    guard = lib.profile('trigger-guard', lib.fillet([(-0.016, -0.004), (0.068, -0.004), (0.071, -0.016), (0.074, -0.019), (0.072, -0.046),
                                                    (0.064, -0.049), (-0.004, -0.049), (-0.020, -0.030)],
                                                   [0.002, 0.002, 0.002, 0.002, 0.004, 0.005, 0.006, 0.004]), 0.0150, finish='anodized')
    cuts = [lib.profile('guard-hole', lib.fillet([(-0.010, 0.004), (0.061, 0.004), (0.061, -0.024), (0.058, -0.039), (0.050, -0.041), (0.000, -0.041), (-0.013, -0.026)], 0.004), 0.03)]
    for i in range(5):
        z = -0.0235 - 0.0042 * i
        cuts.append(lib.box(f'guard-groove{i}', (0.02, 0.0030, 0.0017), (0, 0.0740 - (z + 0.019) * -0.074, z)))
    lib.cut(guard, *cuts)
    lib.bevel(guard, 0.0011, 2)
    w.add(guard)
    # Grip: a thick wrap-around stippled sleeve, raked back, with grooves across its front strap.
    grip = lib.profile('grip', lib.fillet([(-0.020, -0.004), (-0.024, -0.020), (-0.030, -0.046), (-0.036, -0.074), (-0.044, -0.104), (-0.046, -0.114), (-0.094, -0.118),
                                          (-0.092, -0.096), (-0.084, -0.054), (-0.074, -0.014), (-0.070, -0.002), (-0.040, 0.002)],
                                         [0.002, 0.006, 0.010, 0.010, 0.006, 0.004, 0.006, 0.012, 0.012, 0.006, 0.003, 0.004], 3), 0.0370, finish='polymer-stipple')
    ribs = []
    strap = [(-0.024, -0.020), (-0.030, -0.046), (-0.036, -0.074), (-0.044, -0.104)]
    for i in range(7):
        z = -0.030 - 0.0105 * i
        (y0, z0), (y1, z1) = next((a, b) for a, b in zip(strap, strap[1:]) if b[1] <= z <= a[1])
        y = y0 + (y1 - y0) * (z - z0) / (z1 - z0)
        ribs.append(lib.box(f'grip-rib{i}', (0.05, 0.0040, 0.0028), (0, y, z), rotation=(-0.22, 0, 0)))
    lib.cut(grip, *ribs)
    lib.bevel(grip, 0.0045, 2, 30)
    w.add(grip)
    # The grip sleeve's screws.
    for side in (-1, 1):
        w.add(lib.lathe(f'grip-screw{side}', [(0.0, 0.0), (0.0, 0.0034), (side * 0.0012, 0.0030), (side * 0.0016, 0.0)], 12, 'X', (side * 0.0183, -0.062, -0.060), 'dark-steel'))
    # Slide stop on the left, the takedown lever ahead of it, the magazine release behind the guard.
    stop = lib.profile('slide-stop', lib.fillet([(0.004, 0.002), (0.040, 0.004), (0.040, 0.009), (0.010, 0.009), (0.004, 0.006)], 0.0012), 0.0028, x=-FRAME_HALF - 0.0012, finish='dark-steel')
    lib.bevel(stop, 0.0005, 1)
    w.add(stop)
    w.add(lib.lathe('stop-pin', [(-FRAME_HALF - 0.0028, 0.0), (-FRAME_HALF - 0.0028, 0.0030), (FRAME_HALF + 0.0004, 0.0030), (FRAME_HALF + 0.0004, 0.0)], 12, 'X', (0, 0.034, 0.004), 'dark-steel'))
    lever = lib.profile('takedown', lib.fillet([(0.074, -0.004), (0.090, -0.004), (0.090, 0.004), (0.074, 0.004)], 0.0015), 0.0024, x=-FRAME_HALF - 0.0010, finish='dark-steel')
    w.add(lever)
    release = lib.lathe('mag-release', [(-FRAME_HALF - 0.0032, 0.0), (-FRAME_HALF - 0.0032, 0.0048), (-FRAME_HALF + 0.001, 0.0050), (-FRAME_HALF + 0.001, 0.0)], 16, 'X', (0, -0.018, -0.008), 'knurl')
    w.add(release)
    w.add(lib.lathe('trigger-pin', [(-FRAME_HALF - 0.0004, 0.0), (-FRAME_HALF - 0.0004, 0.0020), (FRAME_HALF + 0.0004, 0.0020), (FRAME_HALF + 0.0004, 0.0)], 10, 'X', (0, 0.006, -0.008), 'dark-steel'))
    # Spur hammer behind the slide: a round lightening hole and a grooved spur.
    hammer = lib.profile('hammer', lib.fillet([(-0.077, 0.002), (-0.078, 0.032), (-0.083, 0.038), (-0.092, 0.037), (-0.096, 0.031), (-0.090, 0.022), (-0.088, 0.004)],
                                              [0.001, 0.002, 0.003, 0.003, 0.003, 0.004, 0.001]), 0.0110, finish='dark-steel')
    cuts = [lib.tube('hammer-hole', 0.0032, 0.02, (0, -0.0835, 0.0215), 'X', 14)]
    for i in range(3):
        cuts.append(lib.box(f'hammer-groove{i}', (0.02, 0.0012, 0.0030), (0, -0.0865 - 0.0026 * i, 0.0378 - 0.0012 * i), rotation=(0.6, 0, 0)))
    lib.cut(hammer, *cuts)
    lib.bevel(hammer, 0.0006, 2)
    w.add(hammer)


def slide(w):
    # Slab sides, the top chamfered to a narrow flat; square front and rear faces.
    section = lib.fillet([(-HALF, SLIDE_LOW), (HALF, SLIDE_LOW), (HALF, SLIDE_SHOULDER), (0.0106, SLIDE_TOP), (-0.0106, SLIDE_TOP), (-HALF, SLIDE_SHOULDER)],
                         [0.0008, 0.0008, 0.0015, 0.0012, 0.0012, 0.0015], 2)
    s = lib.extrude_y('slide', section, REAR, FRONT, 'parkerized')
    cuts = [
        # The muzzle face: the bore and the recoil-spring guide's hole under it, and a shallow flat recess round both.
        lib.tube('muzzle-hole', 0.0086, 0.04, (0, FRONT, BORE), 'Y', 20),
        lib.tube('guide-hole', 0.0046, 0.04, (0, FRONT, 0.0170), 'Y', 14),
        lib.box('port', (0.016, 0.046, 0.0160), (HALF, 0.044, 0.0392)),
    ]
    for side in (-1, 1):
        # A long flute down each side of the barrel section.
        cuts.append(lib.box(f'flute{side}', (0.0044, 0.106, 0.0062), (side * HALF, 0.083, 0.0230)))
        # Bold rear serrations, slanted; a short set at the front.
        for i in range(8):
            cuts.append(lib.box(f'serration{side}{i}', (0.0034, 0.0026, 0.036), (side * HALF, -0.071 + i * 0.0056, 0.028), rotation=(0.24, 0, 0)))
        for i in range(5):
            cuts.append(lib.box(f'front-serration{side}{i}', (0.0026, 0.0022, 0.026), (side * HALF, 0.146 + i * 0.0050, 0.029), rotation=(0.24, 0, 0)))
    lib.cut(s, *cuts)
    lib.weld(s)
    lib.bevel(s, 0.0012, 2)
    # The barrel's crown in the muzzle hole, and the guide rod's end, both set back from the face.
    barrel = lib.lathe('barrel', [(0.140, 0.0), (0.140, 0.0084), (FRONT - 0.003, 0.0084), (FRONT - 0.002, 0.0076), (FRONT - 0.002, 0.0)], 20, 'Y', (0, 0, BORE), 'steel')
    lib.cut(barrel, lib.tube('bore', 0.0064, 0.06, (0, FRONT, BORE), 'Y', 16))
    rod = lib.lathe('guide-rod', [(0.150, 0.0), (0.150, 0.0040), (FRONT - 0.005, 0.0040), (FRONT - 0.004, 0.0034), (FRONT - 0.004, 0.0)], 12, 'Y', (0, 0, 0.0170), 'steel')
    # The chamber's hood in the ejection port.
    hood = lib.box('barrel-hood', (0.0050, 0.046, 0.0160), (HALF - 0.0080, 0.044, 0.0392), 'steel')
    # The ribbed top rail between the sights.
    rib = lib.extrude_y('rib', lib.fillet([(-0.0075, SLIDE_TOP - 0.001), (0.0075, SLIDE_TOP - 0.001), (0.0075, RIB_TOP - 0.0022), (0.0058, RIB_TOP - 0.0022), (-0.0058, RIB_TOP - 0.0022), (-0.0075, RIB_TOP - 0.0022)],
                                                    [0, 0, 0.0005, 0, 0, 0.0005], 1), -0.054, 0.150, 'parkerized')
    teeth = []
    for i in range(20):
        t = lib.box(f'rib-tooth{i}', (0.0130, 0.0058, 0.0024), (0, -0.0505 + i * 0.0100, RIB_TOP - 0.0012), 'parkerized')
        lib.bevel(t, 0.0005, 1)
        lib.apply_all(t)
        lib.bake_transform(t)
        teeth.append(t)
    rib = lib.join('rib', [rib, *teeth])
    # Sights: a dovetailed rear sight with its notch, a post on its own block at the front.
    front_base = lib.profile('front-base', lib.fillet([(0.153, SLIDE_TOP - 0.001), (0.178, SLIDE_TOP - 0.001), (0.177, RIB_TOP - 0.001), (0.157, RIB_TOP - 0.001)], 0.001), 0.0120, finish='dark-steel')
    lib.bevel(front_base, 0.0006, 1)
    front = lib.profile('front-sight', lib.fillet([(0.1645, RIB_TOP - 0.002), (0.177, RIB_TOP - 0.002), (0.1715, SIGHT), (0.1645, SIGHT)], [0, 0.001, 0.0008, 0.0006]), 0.0048, finish='dark-steel')
    lib.bevel(front, 0.0004, 1)
    rear = lib.profile('rear-sight', lib.fillet([(-0.076, SLIDE_TOP - 0.001), (-0.058, SLIDE_TOP - 0.001), (-0.060, SIGHT + 0.0028), (-0.074, SIGHT + 0.0028)], 0.0010), 0.0230, finish='dark-steel')
    lib.cut(rear, lib.box('notch', (0.0058, 0.03, 0.0060), (0, -0.066, SIGHT + 0.0030)))
    lib.bevel(rear, 0.0005, 1)
    dots = [lib.lathe('front-dot', [(0.0, 0.0), (0.0, 0.0013), (-0.0004, 0.0013), (-0.0004, 0.0)], 12, 'Y', (0, 0.1643, SIGHT - 0.0024), 'optic-white')]
    for x in (-0.0066, 0.0066):
        dots.append(lib.lathe(f'rear-dot{x}', [(0.0, 0.0), (0.0, 0.0013), (-0.0004, 0.0013), (-0.0004, 0.0)], 12, 'Y', (x, -0.0761, SIGHT + 0.0004), 'optic-white'))
    # The slide-mounted safety: a drum through the slide's rear, a lever on each side.
    parts = [s, barrel, rod, hood, rib, front_base, front, rear, *dots]
    parts.append(lib.lathe('safety-drum', [(-HALF - 0.0022, 0.0), (-HALF - 0.0022, 0.0052), (HALF + 0.0022, 0.0052), (HALF + 0.0022, 0.0)], 18, 'X', (0, -0.0640, 0.0410), 'dark-steel'))
    for side in (-1, 1):
        lever = lib.profile(f'safety-lever{side}', lib.fillet([(-0.0660, 0.0380), (-0.0490, 0.0400), (-0.0470, 0.0440), (-0.0520, 0.0460), (-0.0660, 0.0450)], 0.0012), 0.0024,
                            x=side * (HALF + 0.0025), finish='dark-steel')
        lib.bevel(lever, 0.0005, 1)
        parts.append(lever)
    # Each piece keeps its own bevel: a join keeps only the first object's modifiers, which would bevel every piece again.
    for o in parts:
        lib.apply_all(o)
    w.part('slide', parts, origin=(0, 0.050, BORE))


def moving(w):
    body = lib.profile('mag-body', lib.fillet([(-0.064, 0.004), (-0.034, 0.004), (-0.050, -0.112), (-0.082, -0.112)], 0.002), 0.0270, finish='painted-steel')
    plate = lib.profile('mag-base', lib.fillet([(-0.098, -0.117), (-0.040, -0.115), (-0.037, -0.123), (-0.040, -0.131), (-0.096, -0.133), (-0.100, -0.125)],
                                               [0.003, 0.003, 0.003, 0.003, 0.004, 0.004]), 0.0410, finish='polymer-blue')
    lib.bevel(plate, 0.0014, 2)
    top = lib.lathe('mag-round', [(-0.058, 0.0), (-0.058, 0.0062), (-0.040, 0.0062), (-0.034, 0.0040), (-0.032, 0.0)], 14, 'Y', (0, 0, 0.0005), 'brass')
    for o in (body, plate, top):
        lib.apply_all(o)
    w.part('magazine', [body, plate, top], origin=(0, -0.060, 0.004))
    trigger = lib.profile('trigger', lib.fillet([(0.010, -0.006), (0.020, -0.006), (0.020, -0.013), (0.017, -0.024), (0.010, -0.029), (0.012, -0.020), (0.013, -0.012)], 0.0012, 2), 0.0075, finish='steel')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, 0.016, -0.006))


# Thumbs forward: the firing hand high on the grip, its index on the trigger
# and its thumb along the left of the frame; the support hand's palm on the
# left panel, its fingers wrapped over the firing hand's, its thumb forward
# under the other.
RIGHT = {
    'index': {'curl': (0.25, 0.45, 0.25), 'splay': -0.15}, 'middle': {'curl': (1.25, 1.45, 0.7)},
    'ring': {'curl': (1.3, 1.5, 0.7)}, 'pinky': {'curl': (1.35, 1.45, 0.7)},
    'thumb': [(-0.3, 0.0, -0.15), (0.0, 0, 0), (0.0, 0, 0)],
}
LEFT = {
    'index': {'curl': (1.3, 1.4, 0.6)}, 'middle': {'curl': (1.35, 1.45, 0.6)},
    'ring': {'curl': (1.4, 1.45, 0.6)}, 'pinky': {'curl': (1.45, 1.4, 0.6)},
    'thumb': [(0.0, 0.0, -0.35), (0.0, 0, 0), (0.0, 0, 0)],
}
# The support hand's frame that the reload's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.054, -0.112, -0.086), fingers=(0.55, 0.80, 0.25), back=(-0.75, 0.2, -0.55), forearm=(-0.40, -0.75, -0.50))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.017, -0.118, -0.050), fingers=(0.16, 0.95, 0.27), back=(0.93, -0.3, 0.1), forearm=(0.45, -0.75, -0.48))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.034, -0.094, -0.094), fingers=(0.1, 0.9, 0.42), back=(-0.9, 0.0, -0.4), forearm=(-0.48, -0.74, -0.48), side='L')


def clips(w):
    """Reload: the magazine drops, the support hand brings it back and seats it; the empty one then racks the slide."""
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        c = lib.Clip(w, name, RELOAD)
        # The heavier gun comes up higher than the 9 mm did, so its longer grip and the seating stay on screen.
        tilt, lift = (0.12, 0.35, 0.10), (-0.01, 0, 0.045)
        c.at('pivot', 0.12, loc=lift, rot=tilt).at('pivot', 0.75 if name == 'reload' else 0.62, loc=lift, rot=tilt)
        c.at('magazine', 0.10).at('magazine', 0.26, loc=(0, -0.01, -0.30), rot=(0.3, 0.2, 0), ease='LINEAR')
        c.at('magazine', 0.38, loc=(-0.02, -0.02, -0.30), rot=(0.3, 0.2, 0)).at('magazine', 0.56, loc=(0, -0.005, -0.036))
        c.at('magazine', 0.62, loc=(0, 0, 0.002)).at('magazine', 0.66)
        low = (-0.02, -0.03, -0.28)
        c.at('left-hand', 0.08).at('left-hand', 0.22, loc=(-0.03, -0.02, -0.10), rot=(0.3, 0.1, 0.2), base=held)
        c.at('left-hand', 0.36, loc=low, rot=(0.4, 0.2, 0.3), base=held).at('left-hand', 0.40, loc=low, rot=(0.4, 0.2, 0.3), base=held)
        c.at('left-hand', 0.56, loc=(0.010, 0.030, -0.042), rot=(0.1, 0.1, 0.1), base=held).at('left-hand', 0.63, loc=(0.010, 0.032, -0.036), rot=(0.1, 0.1, 0.1), base=held)
        if name == 'reload':
            c.at('left-hand', 0.82).at('pivot', 0.95)
        else:
            # Overhand rack: the palm over the slide's rear, pulled back and let go.
            rack = (0.034, 0.020, 0.128)
            c.at('left-hand', 0.70, loc=rack, rot=(-0.4, 0.3, 0.8), base=held).at('left-hand', 0.78, loc=(rack[0], rack[1] - 0.042, rack[2]), rot=(-0.4, 0.3, 0.8), base=held)
            c.at('left-hand', 0.82, loc=(rack[0], rack[1] - 0.046, rack[2] + 0.01), rot=(-0.4, 0.3, 0.8), base=held).at('left-hand', 0.96)
            c.at('slide', 0.70).at('slide', 0.78, loc=(0, -0.040, 0)).at('slide', 0.80, loc=(0, -0.040, 0)).at('slide', 0.83, ease='LINEAR')
            c.at('pivot', 0.70, loc=(0, 0.01, 0.01), rot=(0.1, -0.2, 0.2)).at('pivot', 0.8, loc=(0, 0.004, 0.01), rot=(0.12, -0.2, 0.2)).at('pivot', 0.96)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(-0.03, -0.05, -0.10), rot=(0.4, 0.2, 0.2)).at('left-hand', 0.85)


def build():
    w = lib.Weapon('pistol', pivot=(0, -0.055, -0.025))
    frame(w)
    slide(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, FRONT + 0.001, BORE))
    w.socket('eject', (0.016, 0.044, 0.045))
    w.socket('sight', (0, 0.168, SIGHT))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'pistol', (('reload', (0.3, 0.56)), ('reload-empty', (0.72, 0.78)), ('equip', (0.0,))), rest=(0.13, -0.115, -0.35), rot=(-0.03, 0.12, 0.05))
    if opts['bake']:
        lib.finish([w], opts, 'pistol')


if __name__ == '__main__':
    main()

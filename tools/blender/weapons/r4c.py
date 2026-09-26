"""
The R4-C (docs/VISUALS.md, R4): an M4-pattern carbine with a quad rail,
rail covers, a collapsible stock and a polymer magazine with the player-blue
base plate. Blender +Y is forward; the bore runs along Y at z = 0.009, the
origin sits in the receiver where the flat model's does, so the hip pose is
unchanged.

Moving parts: magazine, charging-handle, trigger, both hands. Sockets:
muzzle, eject, optic-mount (the ACOG or holo hangs there). Clips: reload,
reload-empty (the same 2.2 s, finishing on the bolt catch), equip (0.42 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/r4c.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402
import optics  # noqa: E402

BORE = 0.009
RAIL_TOP = 0.0265
# The quad rail's side and bottom rails, from the bore: a real one is about 5 cm across its covers.
RAIL_SIDE = 0.021
# weapons/stats.ts: reloadDuration and drawTime.
RELOAD = 2.2
DRAW = 0.42


def receiver(w):
    # Upper receiver, with the pivot lug down into the lower at the front.
    upper = lib.profile('upper', lib.fillet([(-0.101, -0.0035), (0.062, -0.0035), (0.064, -0.012), (0.075, -0.012), (0.077, -0.004),
                                             (0.077, RAIL_TOP), (-0.101, RAIL_TOP), (-0.104, 0.020), (-0.104, 0.002)],
                                            [0.002, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.002, 0.002]), 0.0222, finish='anodized')
    lib.bevel(upper, 0.0009, 2)
    w.add(upper)
    w.add(lib.rail('upper-rail', -0.100, 0.076, RAIL_TOP, 'anodized'))
    # Right side: dust cover over the ejection port, brass deflector, forward assist.
    cover = lib.box('dust-cover', (0.0016, 0.060, 0.0155), (0.0118, 0.004, 0.0095), 'anodized')
    lib.bevel(cover, 0.0006, 2)
    w.add(cover)
    deflector = lib.profile('deflector', lib.fillet([(-0.050, 0.004), (-0.036, 0.004), (-0.036, 0.024), (-0.044, 0.024), (-0.050, 0.016)], 0.002), 0.008, x=0.0140, finish='anodized')
    lib.bevel(deflector, 0.0008, 2)
    w.add(deflector)
    assist = lib.lathe('forward-assist', [(-0.086, 0.0), (-0.086, 0.0068), (-0.082, 0.0072), (-0.055, 0.0068), (-0.045, 0.0055), (-0.045, 0.0)], 20, 'Y', (0.0128, 0, 0.0128), 'anodized')
    lib.bevel(assist, 0.0006, 2)
    w.add(assist)
    w.add(lib.lathe('assist-button', [(-0.092, 0.0), (-0.092, 0.0062), (-0.086, 0.0062), (-0.086, 0.0)], 20, 'Y', (0.0128, 0, 0.0128), 'knurl'))

    # Lower receiver.
    lower = lib.profile('lower', lib.fillet([(-0.100, -0.0035), (0.070, -0.0035), (0.078, -0.010), (0.078, -0.027), (0.030, -0.027), (-0.047, -0.027),
                                             (-0.074, -0.027), (-0.090, -0.024), (-0.103, -0.012), (-0.103, -0.0035)],
                                            [0.001, 0.002, 0.002, 0.001, 0, 0, 0.002, 0.004, 0.003, 0.001]), 0.0222, finish='anodized')
    lib.bevel(lower, 0.0009, 2)
    w.add(lower)
    magwell = lib.profile('magwell', lib.fillet([(0.027, -0.004), (0.084, -0.004), (0.087, -0.020), (0.089, -0.046), (0.093, -0.053),
                                                 (0.023, -0.053), (0.027, -0.046)], [0, 0, 0.003, 0.003, 0.002, 0.002, 0.003]), 0.0268, finish='anodized')
    opening = lib.box('mag-opening', (0.0232, 0.056, 0.05), (0, 0.0575, -0.045))
    lib.cut(magwell, opening)
    lib.bevel(magwell, 0.0009, 2)
    w.add(magwell)
    # Trigger guard: a loop under the lower from the grip to the magwell.
    guard = lib.profile('trigger-guard', lib.fillet([(-0.047, -0.026), (0.026, -0.026), (0.026, -0.033), (0.019, -0.041), (-0.041, -0.042), (-0.047, -0.036)], 0.004), 0.012, finish='anodized')
    hole = lib.box('guard-hole', (0.02, 0.059, 0.012), (0, -0.0115, -0.031))
    lib.cut(guard, hole)
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    # Controls: bolt catch and selector on the left, magazine release on the right, pins both sides.
    catch = lib.profile('bolt-catch', lib.fillet([(0.012, -0.018), (0.026, -0.016), (0.030, -0.010), (0.014, -0.008)], 0.002), 0.003, x=-0.0122, finish='anodized')
    lib.bevel(catch, 0.0005, 2)
    w.add(catch)
    w.add(lib.lathe('selector-hub', [(0.0, 0.0), (0.0, 0.0045), (0.0015, 0.0045), (0.0020, 0.0)], 16, 'X', (-0.0111, -0.043, -0.015), 'dark-steel'))
    selector = lib.profile('selector', lib.fillet([(-0.045, -0.017), (-0.030, -0.016), (-0.030, -0.013), (-0.045, -0.013)], 0.0012), 0.0022, x=-0.0132, finish='dark-steel')
    w.add(selector)
    w.add(lib.lathe('mag-release', [(0.0, 0.0), (0.0, 0.0046), (0.0022, 0.0042), (0.0026, 0.0)], 16, 'X', (0.0111, 0.019, -0.017), 'dark-steel'))
    for x in (-0.0111, 0.0111):
        for y, z in ((-0.091, -0.010), (0.071, -0.008), (-0.030, -0.018), (-0.016, -0.018)):
            sign = 1 if x > 0 else -1
            w.add(lib.lathe(f'pin{x}{y}', [(0.0, 0.0), (0.0, 0.0028), (0.0008 * sign, 0.0026), (0.0010 * sign, 0.0)], 12, 'X', (x, y, z), 'dark-steel'))

    # Pistol grip, raked back, stippled polymer.
    grip = lib.profile('grip', lib.fillet([(-0.046, -0.027), (-0.051, -0.045), (-0.056, -0.066), (-0.061, -0.086), (-0.066, -0.108), (-0.100, -0.113),
                                           (-0.098, -0.094), (-0.090, -0.062), (-0.084, -0.042), (-0.093, -0.031), (-0.089, -0.026), (-0.074, -0.027)],
                                          [0.002, 0.004, 0.006, 0.004, 0.006, 0.006, 0.006, 0.01, 0.004, 0.003, 0.002, 0.002], 4), 0.029, finish='polymer-tan-stipple')
    lib.bevel(grip, 0.0055, 4, 30)
    w.add(grip)

    # Buffer tube, castle nut, stock and butt pad.
    w.add(lib.lathe('buffer-tube', [(-0.252, 0.0), (-0.252, 0.0135), (-0.249, 0.0148), (-0.108, 0.0148), (-0.108, 0.0)], 28, 'Y', (0, 0, BORE), 'anodized'))
    nut = lib.lathe('castle-nut', [(-0.116, 0.0), (-0.116, 0.0168), (-0.105, 0.0168), (-0.105, 0.0)], 28, 'Y', (0, 0, BORE), 'knurl')
    lib.bevel(nut, 0.0006, 2)
    w.add(nut)
    stock = lib.profile('stock', lib.fillet([(-0.150, 0.000), (-0.150, 0.018), (-0.172, 0.027), (-0.246, 0.030), (-0.262, 0.034), (-0.262, -0.074),
                                            (-0.249, -0.076), (-0.212, -0.046), (-0.170, -0.018), (-0.150, -0.010)],
                                           [0.004, 0.006, 0.01, 0.01, 0.004, 0.004, 0.008, 0.02, 0.01, 0.004], 3), 0.034, finish='polymer-tan')
    lib.bevel(stock, 0.004, 3, 30)
    w.add(stock)
    # The stock is hollow from below: a pocket keeps its silhouette light from the side.
    w.add(lib.profile('stock-lock', lib.fillet([(-0.176, -0.012), (-0.150, -0.008), (-0.150, -0.002), (-0.176, -0.006)], 0.002), 0.012, finish='polymer'))
    pad = lib.profile('butt-pad', lib.fillet([(-0.262, 0.035), (-0.262, -0.076), (-0.273, -0.078), (-0.273, 0.037)], 0.005), 0.037, finish='rubber')
    lib.bevel(pad, 0.003, 2, 30)
    w.add(pad)

    # Quad rail: an octagonal tube, the top rail running on from the receiver's, rubber ladder covers on the rest.
    c, d = BORE, RAIL_SIDE
    section = [(-d, c - 0.0125), (-0.0125, c - d), (0.0125, c - d), (d, c - 0.0125),
               (d, c + 0.0105), (0.0105, RAIL_TOP), (-0.0105, RAIL_TOP), (-d, c + 0.0105)]
    body = lib.extrude_y('quad-rail', section, 0.077, 0.338, 'anodized')
    lib.bevel(body, 0.0008, 2)
    w.add(body)
    w.add(lib.rail('top-rail', 0.080, 0.337, RAIL_TOP, 'anodized'))
    for angle in (math.pi / 2, -math.pi / 2, math.pi):
        cover = lib.extrude_y(f'rail-cover{angle:.1f}', [(-0.0110, c + d), (0.0110, c + d), (0.0104, c + d + 0.0042), (-0.0104, c + d + 0.0042)], 0.098, 0.300, 'rubber')
        lib.bevel(cover, 0.0006, 1)
        lib.apply_all(cover)
        ribs = [lib.box(f'rib{angle:.1f}-{i}', (0.0200, 0.0035, 0.0012), (0, 0.101 + i * 0.01245, c + d + 0.0046), 'rubber') for i in range(16)]
        for r in ribs:
            lib.bake_transform(r)
        cover = lib.join(f'rail-cover{angle:.1f}', [cover, *ribs])
        cover.data.transform(lib.Matrix.Translation((0, 0, c)) @ lib.Matrix.Rotation(angle, 4, 'Y') @ lib.Matrix.Translation((0, 0, -c)))
        w.add(cover)
    # Barrel, crush washer and an A2 birdcage.
    w.add(lib.lathe('barrel', [(0.330, 0.0), (0.330, 0.0100), (0.398, 0.0095), (0.402, 0.0080), (0.487, 0.0080), (0.487, 0.0)], 28, 'Y', (0, 0, BORE), 'parkerized'))
    w.add(lib.lathe('washer', [(0.485, 0.0), (0.485, 0.0112), (0.489, 0.0112), (0.489, 0.0)], 20, 'Y', (0, 0, BORE), 'parkerized'))
    cage = lib.lathe('flash-hider', [(0.489, 0.0), (0.489, 0.0105), (0.491, 0.0110), (0.531, 0.0110), (0.534, 0.0104), (0.534, 0.0)], 28, 'Y', (0, 0, BORE), 'parkerized')
    bore = lib.tube('bore', 0.0062, 0.06, (0, 0.52, BORE), 'Y', 20)
    lib.cut(cage, bore)
    slots = []
    for k in range(5):
        a = math.radians(-120 + 60 * k)
        s = lib.box(f'slot{k}', (0.0026, 0.022, 0.03), (0, 0.515, BORE))
        s.data.transform(lib.Matrix.Translation((0, 0.515, BORE)) @ lib.Matrix.Rotation(a, 4, 'Y') @ lib.Matrix.Translation((0, 0, 0.012)))
        s.location = (0, 0, 0)
        slots.append(s)
    lib.cut(cage, *slots)
    lib.bevel(cage, 0.0005, 1)
    w.add(cage)
    # Folded back-up sights on the top rail.
    for name, y in (('front-sight', 0.318), ('rear-sight', -0.086)):
        s = lib.profile(name, lib.fillet([(y - 0.016, RAIL_TOP + 0.0036), (y + 0.016, RAIL_TOP + 0.0036), (y + 0.014, RAIL_TOP + 0.0135), (y - 0.012, RAIL_TOP + 0.0135)], 0.002), 0.0215, finish='anodized')
        lib.bevel(s, 0.0008, 2)
        w.add(s)


def magazine(w):
    body = lib.profile('mag-body', lib.fillet([(0.0325, -0.004), (0.0825, -0.004), (0.0840, -0.050), (0.0885, -0.090), (0.0960, -0.130), (0.1060, -0.165), (0.1130, -0.186),
                                              (0.0580, -0.189), (0.0520, -0.166), (0.0430, -0.131), (0.0360, -0.091), (0.0325, -0.050)],
                                             [0.002, 0.002, 0, 0, 0, 0, 0.003, 0.003, 0, 0, 0, 0], 3), 0.0232, finish='polymer-tan')
    lib.bevel(body, 0.0014, 2, 30)
    # The raised ribs of a polymer magazine near its base.
    ribs = []
    for i, (y0, z) in enumerate(((0.050, -0.150), (0.054, -0.160), (0.057, -0.170))):
        r = lib.profile(f'mag-rib{i}', [(y0, z), (y0 + 0.049, z + 0.003), (y0 + 0.049, z + 0.0055), (y0, z + 0.0025)], 0.0244, finish='polymer-tan')
        lib.bevel(r, 0.0006, 1)
        ribs.append(r)
    plate = lib.profile('mag-base', lib.fillet([(0.0560, -0.1865), (0.1160, -0.1835), (0.1175, -0.1935), (0.0560, -0.1965)], 0.003), 0.0262, finish='polymer-blue')
    lib.bevel(plate, 0.0012, 2, 30)
    # Rounds peeking from the feed lips.
    top = lib.lathe('mag-round', [(0.040, 0.0), (0.040, 0.0028), (0.062, 0.0028), (0.074, 0.0015), (0.076, 0.0)], 12, 'Y', (0, 0, -0.0045), 'brass')
    w.part('magazine', [body, *ribs, plate, top], origin=(0, 0.058, -0.004))


def moving(w):
    handle = lib.profile('charging-handle', lib.fillet([(-0.118, 0.019), (-0.101, 0.019), (-0.101, 0.0245), (-0.118, 0.0245)], 0.0015), 0.0098, finish='anodized')
    wings = lib.profile('latch', lib.fillet([(-0.121, 0.0185), (-0.1135, 0.0185), (-0.1135, 0.0255), (-0.121, 0.0255)], 0.0018), 0.031, finish='anodized-blue')
    for o in (handle, wings):
        lib.bevel(o, 0.0008, 2)
    w.part('charging-handle', [handle, wings], origin=(0, -0.110, 0.022))
    trigger = lib.profile('trigger', lib.fillet([(-0.0175, -0.022), (-0.0120, -0.022), (-0.0122, -0.030), (-0.0160, -0.038), (-0.0200, -0.041),
                                                 (-0.0192, -0.037), (-0.0165, -0.031)], 0.001, 2), 0.0048, finish='dark-steel')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, -0.015, -0.022))


# Hand poses: curls per finger joint (radians towards the palm), thumb per bone (Euler XYZ).
RIGHT = {
    'index': {'curl': (0.35, 1.05, 0.45), 'splay': -0.06}, 'middle': {'curl': (1.15, 1.45, 0.65)},
    'ring': {'curl': (1.2, 1.5, 0.65)}, 'pinky': {'curl': (1.25, 1.45, 0.65)},
    'thumb': [(-0.6, 0.0, -0.2), (-0.5, 0, 0), (-0.35, 0, 0)],
}
# The support hand wraps the handguard: the palm on its lower left, the fingers
# round the bottom and up the far side, the thumb forward along the near side.
LEFT = {
    'index': {'curl': (1.3, 1.2, 0.6)}, 'middle': {'curl': (1.35, 1.3, 0.6)},
    'ring': {'curl': (1.4, 1.35, 0.6)}, 'pinky': {'curl': (1.45, 1.35, 0.6)},
    'thumb': [(0.0, 0.0, 0.3), (0.2, 0, 0), (0.2, 0, 0)],
}
# The open hand under the handguard that the reload's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.063, 0.162, -0.034), fingers=(0.85, 0.51, 0.11), back=(-0.35, 0.0, -0.95), forearm=(-0.45, -0.70, -0.55))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.031, -0.150, -0.076), fingers=(0, 1, 0.12), back=(0.97, 0, 0.25), forearm=(0.35, -0.75, -0.55))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.062, 0.185, -0.003), fingers=(0.83, 0.3, -0.475), back=(-0.5, 0.0, -0.87), forearm=(-0.45, -0.70, -0.55), side='L')


def clips(w):
    """
    Reload: the gun rolls its magazine well towards the eye (Blender axes on
    the pivot: X pitches the muzzle up, Y rolls the top to the right, Z yaws
    the muzzle left), the left hand strips the magazine, drops it out of
    view, brings it back and seats it; the empty reload ends on the bolt
    catch instead of the rail. Equip: the support hand arrives on the rail
    after the gun is up.
    """
    tilt, lift = (0.32, 0.62, 0.06), (-0.015, -0.02, 0.055)
    hold = (0.010, -0.135, -0.118)
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        c = lib.Clip(w, name, RELOAD)
        c.at('pivot', 0.15, loc=lift, rot=tilt).at('pivot', 0.62, loc=(lift[0], lift[1], lift[2] + 0.008), rot=(tilt[0] + 0.03, tilt[1] + 0.04, tilt[2]))
        c.at('pivot', 0.82, loc=lift, rot=tilt)
        # Magazine: out 0.16-0.40, gone, back in 0.50-0.74, seated with a nudge.
        c.at('magazine', 0.17).at('magazine', 0.23, loc=(0, 0.003, -0.035), rot=(0.05, 0, 0))
        c.at('magazine', 0.40, loc=(-0.03, 0.02, -0.36), rot=(0.5, 0.4, 0.2)).at('magazine', 0.50, loc=(-0.03, 0.02, -0.36), rot=(0.5, 0.4, 0.2))
        c.at('magazine', 0.67, loc=(0, 0.003, -0.032), rot=(0.06, 0, 0)).at('magazine', 0.72, loc=(0, 0, 0.002)).at('magazine', 0.76)
        c.at('left-hand', 0.04).at('left-hand', 0.16, loc=hold, rot=(0.15, -0.25, 0.35), base=held)
        c.at('left-hand', 0.23, loc=(hold[0], hold[1] + 0.003, hold[2] - 0.035), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.40, loc=(-0.02, -0.12, -0.42), rot=(0.6, -0.1, 0.5), base=held).at('left-hand', 0.50, loc=(-0.02, -0.12, -0.42), rot=(0.6, -0.1, 0.5), base=held)
        c.at('left-hand', 0.67, loc=(hold[0], hold[1] + 0.003, hold[2] - 0.032), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.72, loc=(hold[0], hold[1], hold[2] - 0.004), rot=(0.25, -0.25, 0.35), base=held)
        if name == 'reload':
            c.at('left-hand', 0.77, loc=hold, rot=(0.15, -0.25, 0.35), base=held).at('left-hand', 0.93)
        else:
            # The palm slaps the bolt catch on the left of the receiver; the gun jolts as the bolt runs home.
            catch = (0.028, -0.112, 0.012)
            c.at('left-hand', 0.78, loc=catch, rot=(0.0, -0.4, 0.5), base=held).at('left-hand', 0.82, loc=(catch[0] + 0.005, catch[1], catch[2] - 0.004), rot=(0.0, -0.4, 0.5), base=held)
            c.at('left-hand', 0.94)
            c.at('pivot', 0.84, loc=(lift[0], lift[1] - 0.008, lift[2]), rot=(tilt[0] - 0.05, tilt[1], tilt[2]))
        c.at('pivot', 0.97)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(0.03, -0.12, -0.14), rot=(0.5, 0.3, 0.2)).at('left-hand', 0.45, loc=(0.02, -0.08, -0.08), rot=(0.3, 0.2, 0.1)).at('left-hand', 0.85)


def build():
    w = lib.Weapon('r4c', pivot=(0, -0.06, -0.03))
    receiver(w)
    magazine(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.534, BORE))
    w.socket('eject', (0.013, 0.004, 0.011))
    w.socket('optic-mount', (0, 0.012, RAIL_TOP + 0.0055))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'r4c', (('reload', (0.16, 0.3, 0.45, 0.6, 0.72, 0.9)), ('reload-empty', (0.8,))), rest=(0.15, -0.13, -0.29), optic=optics.acog)
    if opts['bake']:
        lib.finish([w], opts, 'r4c')


if __name__ == '__main__':
    main()

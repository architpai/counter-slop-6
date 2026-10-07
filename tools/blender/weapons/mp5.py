"""
The MP5 (docs/VISUALS.md, R4): a stamped-steel roller-delayed SMG with a
ribbed polymer handguard, the cocking tube over the barrel and its handle on
the left, a hooded front sight, a drum rear sight, a claw-mount rail for the
optics, a retractable stock and a curved steel magazine with the player-blue
floor plate. The bore runs along +Y at z = 0.007.

Moving parts: magazine, cocking-handle, trigger, both hands. Sockets:
muzzle, eject, optic-mount. Clips: reload, reload-empty (1.65 s, the empty
one ending on the "HK slap": the cocking handle pulled back and slapped
down), equip (0.22 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/mp5.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402
import optics  # noqa: E402

BORE = 0.007
TOP = 0.030
RAIL_TOP = 0.047
RELOAD = 1.65
DRAW = 0.22


def receiver(w):
    # The receiver: a stamped box with a rounded top, and its ribs pressed along the sides.
    section = lib.fillet([(-0.0155, -0.018), (0.0155, -0.018), (0.0155, TOP - 0.006), (0.0100, TOP), (-0.0100, TOP), (-0.0155, TOP - 0.006)],
                         [0.002, 0.002, 0.006, 0.004, 0.004, 0.006], 3)
    body = lib.extrude_y('receiver', section, -0.128, 0.070, 'painted-steel')
    lib.bevel(body, 0.0012, 2)
    w.add(body)
    for side in (-1, 1):
        rib = lib.extrude_y(f'rib{side}', [(side * 0.0150, 0.004), (side * 0.0172, 0.006), (side * 0.0172, 0.012), (side * 0.0150, 0.014)], -0.110, 0.050, 'painted-steel')
        lib.bevel(rib, 0.0008, 2)
        w.add(rib)
    # Rear end cap, with the stock's lock.
    cap = lib.extrude_y('end-cap', lib.fillet([(-0.017, -0.021), (0.017, -0.021), (0.017, TOP - 0.004), (-0.017, TOP - 0.004)], 0.004), -0.140, -0.128, 'polymer')
    lib.bevel(cap, 0.0012, 2)
    w.add(cap)
    # Ejection port on the right, its edges and a cut-out, and the stamped cocking tube running forward.
    port = lib.box('port-rim', (0.0014, 0.050, 0.014), (0.0162, 0.010, 0.010), 'dark-steel')
    lib.bevel(port, 0.0005, 1)
    w.add(port)
    w.add(lib.lathe('cocking-tube', [(0.060, 0.0), (0.060, 0.0118), (0.240, 0.0118), (0.244, 0.0105), (0.244, 0.0)], 24, 'Y', (0, 0, TOP - 0.009), 'painted-steel'))
    # Hooded front sight at the tube's end.
    hood = lib.lathe('sight-hood', [(0.228, 0.0112), (0.228, 0.0140), (0.240, 0.0140), (0.240, 0.0112)], 28, 'X', (0, 0.0, 0.0), 'painted-steel', closed=True)
    hood.data.transform(lib.Matrix.Translation((0, 0.234, TOP + 0.017)) @ lib.Matrix.Rotation(math.pi / 2, 4, 'Y') @ lib.Matrix.Translation((-0.234, 0, 0)))
    w.add(hood)
    w.add(lib.profile('sight-base', lib.fillet([(0.224, TOP - 0.002), (0.244, TOP - 0.002), (0.242, TOP + 0.010), (0.226, TOP + 0.010)], 0.002), 0.012, finish='painted-steel'))
    w.add(lib.box('sight-post', (0.0018, 0.003, 0.011), (0, 0.234, TOP + 0.015), 'dark-steel'))
    # Drum rear sight.
    drum = lib.lathe('rear-drum', [(-0.0105, 0.0), (-0.0105, 0.0085), (0.0105, 0.0085), (0.0105, 0.0)], 24, 'X', (0, -0.112, TOP + 0.012), 'painted-steel')
    lib.bevel(drum, 0.0008, 2)
    w.add(drum)
    w.add(lib.profile('drum-base', [(-0.122, TOP - 0.002), (-0.102, TOP - 0.002), (-0.104, TOP + 0.006), (-0.120, TOP + 0.006)], 0.018, finish='painted-steel'))
    # Claw mount with its Picatinny rail over the receiver.
    claw = lib.profile('claw-mount', lib.fillet([(-0.080, TOP - 0.003), (0.052, TOP - 0.003), (0.052, RAIL_TOP), (-0.080, RAIL_TOP)], 0.002), 0.020, finish='anodized')
    lib.bevel(claw, 0.0008, 2)
    w.add(claw)
    for y in (-0.064, 0.036):
        w.add(lib.profile(f'claw{y}', lib.fillet([(y - 0.008, TOP - 0.008), (y + 0.008, TOP - 0.008), (y + 0.008, TOP + 0.004), (y - 0.008, TOP + 0.004)], 0.002), 0.036, finish='anodized'))
    w.add(lib.rail('claw-rail', -0.078, 0.050, RAIL_TOP, 'anodized'))

    # Trigger housing (Navy group) under the receiver, the grip raked back, the trigger guard.
    housing = lib.profile('trigger-housing', lib.fillet([(-0.090, -0.016), (0.012, -0.016), (0.010, -0.030), (-0.040, -0.034), (-0.060, -0.030), (-0.088, -0.030)],
                                                        [0.002, 0.002, 0.004, 0.004, 0.004, 0.003]), 0.026, finish='polymer')
    lib.bevel(housing, 0.0015, 2)
    w.add(housing)
    grip = lib.profile('grip', lib.fillet([(-0.058, -0.030), (-0.064, -0.055), (-0.070, -0.080), (-0.075, -0.106), (-0.106, -0.110), (-0.101, -0.084), (-0.094, -0.056), (-0.090, -0.030)],
                                          [0.002, 0.005, 0.005, 0.006, 0.006, 0.008, 0.006, 0.002], 4), 0.030, finish='polymer-stipple')
    lib.bevel(grip, 0.0055, 4, 30)
    w.add(grip)
    guard = lib.profile('trigger-guard', lib.fillet([(-0.056, -0.028), (0.006, -0.028), (0.006, -0.036), (-0.004, -0.050), (-0.050, -0.050), (-0.056, -0.042)], 0.004), 0.011, finish='polymer')
    lib.cut(guard, lib.box('guard-hole', (0.02, 0.052, 0.018), (0, -0.024, -0.037)))
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    selector = lib.profile('selector', lib.fillet([(-0.080, -0.022), (-0.064, -0.020), (-0.064, -0.016), (-0.080, -0.018)], 0.0012), 0.003, x=-0.0145, finish='dark-steel')
    w.add(selector)
    w.add(lib.lathe('selector-hub', [(0.0, 0.0), (0.0, 0.005), (0.0016, 0.005), (0.0022, 0.0)], 16, 'X', (-0.0135, -0.072, -0.021), 'dark-steel'))
    # Magazine well and the paddle release behind it.
    well = lib.profile('magwell', lib.fillet([(0.026, -0.017), (0.074, -0.017), (0.076, -0.034), (0.024, -0.034)], 0.002), 0.026, finish='painted-steel')
    lib.cut(well, lib.box('well-hole', (0.021, 0.042, 0.04), (0, 0.050, -0.040)))
    lib.bevel(well, 0.0008, 2)
    w.add(well)
    w.add(lib.profile('mag-paddle', lib.fillet([(0.016, -0.018), (0.024, -0.018), (0.022, -0.036), (0.014, -0.036)], 0.0015), 0.012, finish='polymer'))

    # Tropical handguard: a rounded tube with transverse ribs.
    hg = lib.lathe('handguard', [(0.076, 0.0), (0.076, 0.0200), (0.082, 0.0225), (0.212, 0.0225), (0.218, 0.0195), (0.218, 0.0)], 28, 'Y', (0, 0, BORE - 0.002), 'polymer', scale=(0.95, 1.0))
    lib.bevel(hg, 0.001, 2)
    w.add(hg)
    ribs = [lib.lathe(f'hg-rib{i}', [(0.088 + i * 0.0105, 0.0224), (0.088 + i * 0.0105, 0.0238), (0.0935 + i * 0.0105, 0.0238), (0.0935 + i * 0.0105, 0.0224)], 28, 'Y', (0, 0, BORE - 0.002), 'polymer', scale=(0.95, 1.0), closed=True)
            for i in range(12)]
    w.add(lib.join('hg-ribs', ribs))
    # Barrel and the three-lug muzzle.
    w.add(lib.lathe('barrel', [(0.210, 0.0), (0.210, 0.0080), (0.262, 0.0080), (0.262, 0.0)], 24, 'Y', (0, 0, BORE), 'parkerized'))
    lug = lib.lathe('lugs', [(0.244, 0.0), (0.244, 0.0098), (0.258, 0.0098), (0.262, 0.0086), (0.262, 0.0)], 24, 'Y', (0, 0, BORE), 'parkerized')
    lib.cut(lug, lib.tube('muzzle-bore', 0.0048, 0.05, (0, 0.26, BORE), 'Y', 16))
    lib.bevel(lug, 0.0005, 1)
    w.add(lug)

    # Retractable stock: two struts from the end cap to a rubber butt plate.
    for side in (-1, 1):
        w.add(lib.lathe(f'strut{side}', [(-0.255, 0.0), (-0.255, 0.0042), (-0.136, 0.0042), (-0.136, 0.0)], 12, 'Y', (side * 0.0145, 0, 0.010), 'dark-steel'))
    butt = lib.profile('butt', lib.fillet([(-0.268, 0.030), (-0.252, 0.030), (-0.252, -0.060), (-0.268, -0.066)], 0.005), 0.038, finish='rubber')
    lib.bevel(butt, 0.003, 2, 30)
    w.add(butt)
    # Sling loop at the front of the receiver.
    w.add(lib.lathe('sling-loop', [(0.0, 0.0034), (0.0, 0.0044), (0.004, 0.0044), (0.004, 0.0034)], 16, 'X', (-0.018, 0.060, 0.002), 'dark-steel', closed=True))


def magazine(w):
    body = lib.profile('mag-body', lib.fillet([(0.0285, -0.004), (0.0725, -0.004), (0.0740, -0.040), (0.0800, -0.080), (0.0920, -0.120), (0.1080, -0.160), (0.1180, -0.178),
                                              (0.0780, -0.188), (0.0690, -0.170), (0.0530, -0.130), (0.0400, -0.086), (0.0310, -0.042)],
                                             [0.002, 0.002, 0, 0, 0, 0, 0.003, 0.003, 0, 0, 0, 0], 3), 0.0198, finish='painted-steel')
    lib.bevel(body, 0.0010, 2, 30)
    # Pressed ribs down both sides.
    ribs = []
    for side in (-1, 1):
        r = lib.profile(f'mag-rib{side}', lib.fillet([(0.040, -0.030), (0.046, -0.030), (0.066, -0.150), (0.060, -0.152)], 0.001), 0.0014, x=side * 0.0102, finish='painted-steel')
        ribs.append(r)
    plate = lib.profile('mag-floor', lib.fillet([(0.0760, -0.1890), (0.1200, -0.1790), (0.1235, -0.1870), (0.0790, -0.1975)], 0.002), 0.0222, finish='polymer-blue')
    lib.bevel(plate, 0.001, 2, 30)
    top = lib.lathe('mag-round', [(0.034, 0.0), (0.034, 0.0045), (0.052, 0.0045), (0.060, 0.0022), (0.062, 0.0)], 12, 'Y', (0, 0, -0.006), 'brass')
    w.part('magazine', [body, *ribs, plate, top], origin=(0, 0.050, -0.004))


def moving(w):
    # Cocking handle: a lever from the tube's slot on the left, folded forward.
    stem = lib.profile('cocking-stem', lib.fillet([(0.182, TOP - 0.014), (0.196, TOP - 0.014), (0.196, TOP - 0.004), (0.182, TOP - 0.004)], 0.0015), 0.016, x=-0.016, finish='dark-steel')
    knob = lib.lathe('cocking-knob', [(0.0, 0.0), (0.0, 0.0050), (0.012, 0.0055), (0.016, 0.0040), (0.016, 0.0)], 16, 'X', (-0.038, 0.189, TOP - 0.009), 'polymer')
    knob.data.transform(lib.Matrix.Translation((-0.038, 0.189, TOP - 0.009)) @ lib.Matrix.Rotation(-0.35, 4, 'Z') @ lib.Matrix.Translation((0.038, -0.189, -(TOP - 0.009))))
    lib.bevel(stem, 0.0006, 2)
    w.part('cocking-handle', [stem, knob], origin=(-0.016, 0.189, TOP - 0.009))
    trigger = lib.profile('trigger', lib.fillet([(-0.036, -0.030), (-0.030, -0.030), (-0.030, -0.036), (-0.034, -0.044), (-0.039, -0.046), (-0.037, -0.041), (-0.035, -0.036)], 0.001, 2), 0.005, finish='dark-steel')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, -0.033, -0.030))


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
OPEN = dict(wrist=(-0.064, 0.090, -0.034), fingers=(0.85, 0.51, 0.11), back=(-0.35, 0.0, -0.95), forearm=(-0.45, -0.70, -0.55))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.031, -0.166, -0.080), fingers=(0, 1, 0.12), back=(0.97, 0, 0.25), forearm=(0.35, -0.75, -0.55))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.0595, 0.145, -0.0025), fingers=(0.83, 0.3, -0.475), back=(-0.5, 0.0, -0.87), forearm=(-0.45, -0.70, -0.55), side='L')


def clips(w):
    """Reload as the R4-C's; the empty one ends with the left hand pulling the cocking handle back and slapping it down."""
    tilt, lift = (0.32, 0.62, 0.06), (-0.015, -0.02, 0.055)
    hold = (0.012, -0.075, -0.125)
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        c = lib.Clip(w, name, RELOAD)
        c.at('pivot', 0.15, loc=lift, rot=tilt).at('pivot', 0.62, loc=(lift[0], lift[1], lift[2] + 0.008), rot=(tilt[0] + 0.03, tilt[1] + 0.04, tilt[2]))
        c.at('pivot', 0.80 if name == 'reload' else 0.66, loc=lift, rot=tilt)
        c.at('magazine', 0.17).at('magazine', 0.23, loc=(0, 0.003, -0.035), rot=(0.05, 0, 0))
        c.at('magazine', 0.40, loc=(-0.03, 0.02, -0.36), rot=(0.5, 0.4, 0.2)).at('magazine', 0.50, loc=(-0.03, 0.02, -0.36), rot=(0.5, 0.4, 0.2))
        c.at('magazine', 0.67 if name == 'reload' else 0.60, loc=(0, 0.003, -0.032), rot=(0.06, 0, 0))
        c.at('magazine', 0.72 if name == 'reload' else 0.64, loc=(0, 0, 0.002)).at('magazine', 0.76 if name == 'reload' else 0.67)
        c.at('left-hand', 0.04).at('left-hand', 0.16, loc=hold, rot=(0.15, -0.25, 0.35), base=held)
        c.at('left-hand', 0.23, loc=(hold[0], hold[1] + 0.003, hold[2] - 0.035), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.40, loc=(-0.02, -0.12, -0.42), rot=(0.6, -0.1, 0.5), base=held).at('left-hand', 0.50, loc=(-0.02, -0.12, -0.42), rot=(0.6, -0.1, 0.5), base=held)
        if name == 'reload':
            c.at('left-hand', 0.67, loc=(hold[0], hold[1] + 0.003, hold[2] - 0.032), rot=(0.2, -0.25, 0.35), base=held)
            c.at('left-hand', 0.72, loc=(hold[0], hold[1], hold[2] - 0.004), rot=(0.25, -0.25, 0.35), base=held)
            c.at('left-hand', 0.77, loc=hold, rot=(0.15, -0.25, 0.35), base=held).at('left-hand', 0.93)
            c.at('pivot', 0.97)
        else:
            c.at('left-hand', 0.60, loc=(hold[0], hold[1] + 0.003, hold[2] - 0.032), rot=(0.2, -0.25, 0.35), base=held)
            c.at('left-hand', 0.64, loc=(hold[0], hold[1], hold[2] - 0.004), rot=(0.25, -0.25, 0.35), base=held)
            # HK slap: over the top to the handle, back, then down onto it; the handle springs home.
            grab = (0.012, 0.030, 0.060)
            c.at('left-hand', 0.72, loc=grab, rot=(0.0, 0.45, 0.2), base=held).at('left-hand', 0.78, loc=(grab[0], grab[1] - 0.060, grab[2]), rot=(0.0, 0.45, 0.2), base=held)
            c.at('left-hand', 0.83, loc=(grab[0] + 0.004, grab[1] - 0.062, grab[2] - 0.012), rot=(0.05, 0.45, 0.2), base=held)
            c.at('left-hand', 0.96)
            c.at('cocking-handle', 0.72).at('cocking-handle', 0.78, loc=(0, -0.060, 0)).at('cocking-handle', 0.82, loc=(0, -0.060, 0), rot=(0, 0.5, 0))
            c.at('cocking-handle', 0.85, loc=(0, 0, 0), ease='LINEAR')
            c.at('pivot', 0.72, loc=(lift[0], lift[1], lift[2] - 0.02), rot=(0.15, 0.25, 0.05)).at('pivot', 0.84, loc=(lift[0], lift[1] - 0.006, lift[2] - 0.02), rot=(0.12, 0.25, 0.05))
            c.at('pivot', 0.97)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(0.03, -0.10, -0.12), rot=(0.5, 0.3, 0.2)).at('left-hand', 0.5, loc=(0.02, -0.06, -0.06), rot=(0.3, 0.2, 0.1)).at('left-hand', 0.9)


def build():
    w = lib.Weapon('mp5', pivot=(0, -0.07, -0.035))
    receiver(w)
    magazine(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.263, BORE))
    w.socket('eject', (0.017, 0.012, 0.012))
    w.socket('optic-mount', (0, -0.012, RAIL_TOP + 0.0055))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'mp5', (('reload', (0.16, 0.3, 0.6)), ('reload-empty', (0.72, 0.8))), rest=(0.15, -0.13, -0.31), optic=optics.acog)
    if opts['bake']:
        lib.finish([w], opts, 'mp5')


if __name__ == '__main__':
    main()

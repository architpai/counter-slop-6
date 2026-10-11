"""
The LMG (docs/VISUALS.md, R4): a belt-fed light machine gun in the Minimi
pattern. A stamped receiver under a feed cover with a short rail, a heavy
barrel with a gas block and a birdcage, a polymer heat shield and handguard,
a bipod folded forward under the barrel, a carry handle laid over to the
left, a fixed skeleton stock, and the 100-round box under the feed tray with
its belt running up into the left of the tray. The box carries the
player-blue base band. Blender +Y is forward; the bore runs along Y at
z = 0.012, and the origin sits in the receiver where the flat model's does.

Iron sights only: a notch on the cover's rail and a hooded post on the gas
block. The `sight` socket is the post's tip.

Moving parts: magazine (the box and its belt), charging-handle, trigger,
both hands. Sockets: muzzle, eject, sight. Clips: reload, reload-empty (the
same 3.6 s; the empty one ends with the left hand running the charging
handle), equip (0.65 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/lmg.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

BORE = 0.012
# The receiver's top under the feed cover, the cover's top, and the sight line over its rail.
TOP = 0.034
COVER = 0.047
SIGHT = 0.068
# Half the receiver's width.
SIDE = 0.0185
# The box hangs a little left of the bore, under the feed tray.
BOX_X = -0.008
# weapons/stats.ts: reloadDuration and drawTime.
RELOAD = 3.6
DRAW = 0.65


def receiver(w):
    # The receiver: a stamped box with chamfered shoulders, ribs pressed along its sides.
    section = lib.fillet([(-SIDE, -0.030), (SIDE, -0.030), (SIDE, TOP - 0.004), (SIDE - 0.004, TOP), (-SIDE + 0.004, TOP), (-SIDE, TOP - 0.004)],
                         [0.002, 0.002, 0.002, 0.001, 0.001, 0.002], 2)
    body = lib.extrude_y('receiver', section, -0.118, 0.108, 'painted-steel')
    lib.bevel(body, 0.0012, 2)
    w.add(body)
    for side in (-1, 1):
        rib = lib.extrude_y(f'rib{side}', [(side * (SIDE - 0.0005), -0.022), (side * (SIDE + 0.0017), -0.020), (side * (SIDE + 0.0017), -0.014), (side * (SIDE - 0.0005), -0.012)],
                            -0.105, 0.010, 'painted-steel')
        lib.bevel(rib, 0.0008, 2)
        w.add(rib)
    cap = lib.extrude_y('end-cap', lib.fillet([(-SIDE - 0.001, -0.032), (SIDE + 0.001, -0.032), (SIDE + 0.001, TOP - 0.002), (-SIDE - 0.001, TOP - 0.002)], 0.004), -0.127, -0.118, 'polymer')
    lib.bevel(cap, 0.0012, 2)
    w.add(cap)
    # The trunnion block the barrel locks into.
    trunnion = lib.extrude_y('trunnion', lib.fillet([(-SIDE - 0.0015, -0.012), (SIDE + 0.0015, -0.012), (SIDE + 0.0015, TOP - 0.002), (-SIDE - 0.0015, TOP - 0.002)], 0.004), 0.096, 0.114, 'parkerized')
    lib.bevel(trunnion, 0.001, 2)
    w.add(trunnion)

    # Feed cover, hinged at the front, with its latch at the rear and a short rail on top.
    cover = lib.profile('feed-cover', lib.fillet([(-0.102, TOP), (0.094, TOP), (0.098, TOP + 0.005), (0.088, COVER), (-0.084, COVER), (-0.102, COVER - 0.007)],
                                                 [0, 0, 0.002, 0.004, 0.004, 0.003], 2), 2 * SIDE + 0.004, finish='painted-steel')
    lib.bevel(cover, 0.0012, 2)
    w.add(cover)
    latch = lib.profile('cover-latch', lib.fillet([(-0.112, TOP + 0.001), (-0.100, TOP + 0.001), (-0.100, COVER - 0.004), (-0.110, COVER - 0.006)], 0.002), 0.020, finish='polymer')
    lib.bevel(latch, 0.0008, 2)
    w.add(latch)
    w.add(lib.lathe('cover-hinge', [(-SIDE - 0.003, 0.0), (-SIDE - 0.003, 0.0042), (SIDE + 0.003, 0.0042), (SIDE + 0.003, 0.0)], 14, 'X', (0, 0.096, TOP + 0.004), 'dark-steel'))
    w.add(lib.rail('cover-rail', -0.070, 0.062, COVER, 'anodized'))
    # The feed tray's lip on the left, where the belt comes in, and the link chute's mouth on the right.
    tray = lib.box('feed-tray', (0.008, 0.062, 0.007), (-SIDE - 0.002, 0.060, TOP - 0.0035), 'dark-steel')
    lib.bevel(tray, 0.0006, 1)
    w.add(tray)
    port = lib.box('port-rim', (0.0016, 0.052, 0.016), (SIDE + 0.0006, 0.040, -0.004), 'dark-steel')
    lib.bevel(port, 0.0005, 1)
    w.add(port)
    # The charging handle's slot on the left.
    w.add(lib.box('handle-slot', (0.0012, 0.094, 0.0055), (-SIDE - 0.0004, -0.052, 0.006), 'dark-steel'))

    # Rear sight: a base on the rail and two ears that leave a notch.
    base = lib.profile('rear-base', lib.fillet([(-0.076, COVER + 0.0036), (-0.052, COVER + 0.0036), (-0.054, COVER + 0.011), (-0.074, COVER + 0.011)], 0.0015), 0.022, finish='anodized')
    lib.bevel(base, 0.0008, 2)
    w.add(base)
    for side in (-1, 1):
        ear = lib.profile(f'rear-ear{side}', lib.fillet([(-0.070, COVER + 0.010), (-0.058, COVER + 0.010), (-0.059, SIGHT + 0.0035), (-0.069, SIGHT + 0.0035)], 0.001), 0.0045,
                          x=side * 0.0052, finish='anodized')
        lib.bevel(ear, 0.0006, 1)
        w.add(ear)

    # Trigger housing under the receiver's rear, its guard, and the grip.
    housing = lib.profile('housing', lib.fillet([(-0.112, -0.029), (0.016, -0.029), (0.014, -0.040), (-0.030, -0.045), (-0.112, -0.045)], [0, 0, 0.003, 0.003, 0.003]), 0.030, finish='painted-steel')
    lib.bevel(housing, 0.0009, 2)
    w.add(housing)
    guard = lib.profile('trigger-guard', lib.fillet([(-0.063, -0.043), (0.010, -0.043), (0.010, -0.050), (0.003, -0.058), (-0.057, -0.059), (-0.063, -0.053)], 0.004), 0.012, finish='painted-steel')
    hole = lib.box('guard-hole', (0.02, 0.059, 0.012), (0, -0.0275, -0.048))
    lib.cut(guard, hole)
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    grip = lib.profile('grip', lib.fillet([(-0.062, -0.044), (-0.067, -0.062), (-0.072, -0.083), (-0.077, -0.103), (-0.082, -0.125), (-0.116, -0.130),
                                           (-0.114, -0.111), (-0.106, -0.079), (-0.100, -0.059), (-0.109, -0.048), (-0.105, -0.043), (-0.090, -0.044)],
                                          [0.002, 0.004, 0.006, 0.004, 0.006, 0.006, 0.006, 0.01, 0.004, 0.003, 0.002, 0.002], 4), 0.030, finish='polymer-olive-stipple')
    lib.bevel(grip, 0.0055, 4, 30)
    w.add(grip)
    for x in (-SIDE - 0.0002, SIDE + 0.0002):
        sign = 1 if x > 0 else -1
        for y, z in ((-0.100, -0.006), (0.084, -0.020), (-0.040, -0.024), (0.004, 0.018)):
            w.add(lib.lathe(f'pin{sign}{y}', [(0.0, 0.0), (0.0, 0.0030), (0.0008 * sign, 0.0028), (0.0010 * sign, 0.0)], 12, 'X', (x, y, z), 'dark-steel'))

    # Fixed stock: an open frame in olive polymer with a rubber butt pad.
    stock = lib.profile('stock', lib.fillet([(-0.127, 0.026), (-0.160, 0.030), (-0.300, 0.030), (-0.312, 0.024), (-0.312, -0.080), (-0.300, -0.086),
                                            (-0.262, -0.068), (-0.196, -0.040), (-0.127, -0.028)],
                                           [0.002, 0.008, 0.006, 0.004, 0.004, 0.008, 0.02, 0.012, 0.002], 3), 0.036, finish='polymer-olive')
    window = lib.profile('stock-window', lib.fillet([(-0.176, 0.012), (-0.286, 0.012), (-0.286, -0.052), (-0.262, -0.048), (-0.190, -0.018)], 0.008, 3), 0.06)
    lib.cut(stock, window)
    lib.bevel(stock, 0.0032, 3, 30)
    w.add(stock)
    pad = lib.profile('butt-pad', lib.fillet([(-0.312, 0.031), (-0.312, -0.088), (-0.324, -0.090), (-0.324, 0.033)], 0.005), 0.039, finish='rubber')
    lib.bevel(pad, 0.003, 2, 30)
    w.add(pad)


def barrel(w):
    # Heavy barrel: a thick chamber end, the gas block, then a taper to the muzzle.
    w.add(lib.lathe('barrel', [(0.110, 0.0), (0.110, 0.0128), (0.150, 0.0128), (0.156, 0.0108), (0.346, 0.0102), (0.350, 0.0090), (0.384, 0.0090),
                               (0.388, 0.0094), (0.522, 0.0088), (0.522, 0.0)], 28, 'Y', (0, 0, BORE), 'parkerized'))
    block = lib.profile('gas-block', lib.fillet([(0.350, BORE - 0.030), (0.382, BORE - 0.030), (0.382, BORE + 0.014), (0.350, BORE + 0.014)], 0.003), 0.027, finish='parkerized')
    lib.bevel(block, 0.0012, 2)
    w.add(block)
    w.add(lib.lathe('gas-tube', [(0.296, 0.0), (0.296, 0.0078), (0.352, 0.0078), (0.352, 0.0)], 20, 'Y', (0, 0, BORE - 0.021), 'parkerized'))
    w.add(lib.lathe('gas-plug', [(0.380, 0.0), (0.380, 0.0064), (0.392, 0.0064), (0.395, 0.0050), (0.395, 0.0)], 16, 'Y', (0, 0, BORE - 0.021), 'knurl'))
    # The R4-C's birdcage. Its slot cuts leave slivers here that the bevel cannot take, so it is welded first.
    cage = lib.lathe('flash-hider', [(0.520, 0.0), (0.520, 0.0105), (0.522, 0.0110), (0.562, 0.0110), (0.565, 0.0104), (0.565, 0.0)], 28, 'Y', (0, 0, BORE), 'parkerized')
    bore = lib.tube('bore', 0.0062, 0.06, (0, 0.551, BORE), 'Y', 20)
    lib.cut(cage, bore)
    slots = []
    for k in range(5):
        a = math.radians(-120 + 60 * k)
        s = lib.box(f'slot{k}', (0.0026, 0.022, 0.03), (0, 0.546, BORE))
        s.data.transform(lib.Matrix.Translation((0, 0.546, BORE)) @ lib.Matrix.Rotation(a, 4, 'Y') @ lib.Matrix.Translation((0, 0, 0.012)))
        s.location = (0, 0, 0)
        slots.append(s)
    lib.cut(cage, *slots)
    lib.weld(cage)
    lib.bevel(cage, 0.0005, 1)
    w.add(cage)

    # Front sight: a post between two ears on the gas block.
    tower = lib.profile('sight-tower', lib.fillet([(0.354, BORE + 0.013), (0.378, BORE + 0.013), (0.374, SIGHT - 0.010), (0.358, SIGHT - 0.010)], 0.002), 0.017, finish='parkerized')
    lib.bevel(tower, 0.0008, 2)
    w.add(tower)
    w.add(lib.box('sight-post', (0.0020, 0.003, 0.011), (0, 0.366, SIGHT - 0.0055), 'dark-steel'))
    for side in (-1, 1):
        ear = lib.profile(f'front-ear{side}', lib.fillet([(0.358, SIGHT - 0.011), (0.374, SIGHT - 0.011), (0.371, SIGHT + 0.004), (0.361, SIGHT + 0.004)], 0.0015), 0.0022, x=side * 0.0072, finish='parkerized')
        lib.bevel(ear, 0.0005, 1)
        w.add(ear)

    # Heat shield over the barrel and the handguard under it.
    shield = lib.extrude_y('heat-shield', lib.fillet([(-0.0215, BORE + 0.002), (0.0215, BORE + 0.002), (0.0200, BORE + 0.018), (0.0110, BORE + 0.0265), (-0.0110, BORE + 0.0265), (-0.0200, BORE + 0.018)],
                                                     [0.001, 0.001, 0.004, 0.004, 0.004, 0.004], 2), 0.116, 0.296, 'polymer-olive')
    lib.bevel(shield, 0.001, 2)
    w.add(shield)
    for i in range(7):
        vent = lib.box(f'vent{i}', (0.0190, 0.0100, 0.0016), (0, 0.136 + i * 0.0235, BORE + 0.0268), 'polymer')
        lib.bevel(vent, 0.0005, 1)
        w.add(vent)
    guard = lib.extrude_y('handguard', lib.fillet([(-0.0220, BORE + 0.002), (0.0220, BORE + 0.002), (0.0220, BORE - 0.030), (0.0150, BORE - 0.044), (-0.0150, BORE - 0.044), (-0.0220, BORE - 0.030)],
                                                  [0.001, 0.001, 0.004, 0.006, 0.006, 0.004], 3), 0.116, 0.296, 'polymer-olive-stipple')
    lib.bevel(guard, 0.0012, 2)
    w.add(guard)

    # Carry handle, laid over to the left on its bracket.
    bracket = lib.profile('handle-bracket', lib.fillet([(0.128, BORE + 0.010), (0.146, BORE + 0.010), (0.144, BORE + 0.032), (0.130, BORE + 0.032)], 0.002), 0.012, x=-0.016, finish='parkerized')
    lib.bevel(bracket, 0.0008, 2)
    w.add(bracket)
    w.add(lib.tube('carry-handle', 0.0062, 0.090, (-0.029, 0.176, BORE + 0.026), 'Y', 14, 'polymer'))
    for y in (0.137, 0.214):
        strut = lib.box(f'handle-strut{y}', (0.014, 0.006, 0.006), (-0.0225, y, BORE + 0.026), 'parkerized')
        lib.bevel(strut, 0.0008, 1)
        w.add(strut)

    # Bipod, folded forward under the barrel from its yoke on the gas block.
    yoke = lib.box('bipod-yoke', (0.036, 0.014, 0.014), (0, 0.392, BORE - 0.034), 'dark-steel')
    lib.bevel(yoke, 0.0012, 2)
    w.add(yoke)
    for side in (-1, 1):
        w.add(lib.tube(f'bipod-leg{side}', 0.0046, 0.150, (side * 0.0130, 0.470, BORE - 0.035), 'Y', 12, 'painted-steel'))
        foot = lib.box(f'bipod-foot{side}', (0.012, 0.012, 0.014), (side * 0.0130, 0.548, BORE - 0.036), 'painted-steel')
        lib.bevel(foot, 0.0015, 2)
        w.add(foot)


def magazine(w):
    """The 100-round box, hung under the feed tray, and the belt from its mouth up into the tray."""
    x = BOX_X
    body = lib.profile('box', lib.fillet([(0.022, -0.031), (0.116, -0.031), (0.120, -0.046), (0.120, -0.150), (0.112, -0.160), (0.026, -0.160), (0.018, -0.150), (0.018, -0.046)],
                                         [0.002, 0.002, 0.004, 0.006, 0.006, 0.006, 0.006, 0.004], 2), 0.078, x=x, finish='polymer-olive')
    lib.bevel(body, 0.0035, 2, 30)
    ribs = []
    for i, z in enumerate((-0.070, -0.095, -0.120)):
        r = lib.profile(f'box-rib{i}', [(0.024, z), (0.114, z), (0.114, z + 0.008), (0.024, z + 0.008)], 0.081, x=x, finish='polymer-olive')
        lib.bevel(r, 0.0012, 1)
        ribs.append(r)
    lid = lib.profile('box-lid', lib.fillet([(0.019, -0.046), (0.119, -0.046), (0.117, -0.036), (0.021, -0.036)], 0.002), 0.0815, x=x, finish='polymer')
    lib.bevel(lid, 0.001, 1)
    band = lib.profile('box-base', lib.fillet([(0.023, -0.154), (0.115, -0.154), (0.111, -0.1645), (0.027, -0.1645)], 0.003), 0.0815, x=x, finish='polymer-blue')
    lib.bevel(band, 0.0012, 1, 30)
    # The belt: rounds side by side from the box's mouth up over the receiver's left shoulder into the tray.
    belt = []
    path = [(-0.0420, -0.030), (-0.0365, -0.019), (-0.0320, -0.008), (-0.0285, 0.004), (-0.0260, 0.016), (-0.0245, 0.027)]
    for i, (bx, bz) in enumerate(path):
        belt.append(lib.lathe(f'round{i}', [(0.030, 0.0), (0.030, 0.0029), (0.062, 0.0029), (0.071, 0.0017), (0.081, 0.0)], 8, 'Y', (bx, 0, bz), 'brass'))
        if i:
            px, pz = path[i - 1]
            link = lib.box(f'link{i}', (0.0030, 0.016, 0.0125), ((bx + px) / 2, 0.046, (bz + pz) / 2), 'dark-steel',
                           rotation=(0, math.atan2(bx - px, bz - pz), 0))
            belt.append(link)
    w.part('magazine', [body, *ribs, lid, band, *belt], origin=(x, 0.069, -0.031))


def moving(w):
    knob = lib.profile('handle-knob', lib.fillet([(-0.014, 0.0005), (-0.002, 0.0005), (-0.003, 0.0115), (-0.013, 0.0115)], 0.002), 0.014, x=-SIDE - 0.0085, finish='polymer')
    lib.bevel(knob, 0.0012, 2)
    stem = lib.box('handle-stem', (0.006, 0.008, 0.005), (-SIDE - 0.002, -0.008, 0.006), 'dark-steel')
    w.part('charging-handle', [knob, stem], origin=(-SIDE, -0.008, 0.006))
    trigger = lib.profile('trigger', lib.fillet([(-0.0335, -0.039), (-0.0280, -0.039), (-0.0282, -0.047), (-0.0320, -0.055), (-0.0360, -0.058),
                                                 (-0.0352, -0.054), (-0.0325, -0.048)], 0.001, 2), 0.0048, finish='dark-steel')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, -0.031, -0.039))


# Hand poses: curls per finger joint (radians towards the palm), thumb per bone (Euler XYZ).
RIGHT = {
    'index': {'curl': (0.35, 1.05, 0.45), 'splay': -0.06}, 'middle': {'curl': (1.15, 1.45, 0.65)},
    'ring': {'curl': (1.2, 1.5, 0.65)}, 'pinky': {'curl': (1.25, 1.45, 0.65)},
    'thumb': [(-0.6, 0.0, -0.2), (-0.5, 0, 0), (-0.35, 0, 0)],
}
# The support hand cups the handguard from below: the palm on its lower left,
# the fingers round the bottom and up the far side, the thumb along the near side.
LEFT = {
    'index': {'curl': (1.25, 1.15, 0.6)}, 'middle': {'curl': (1.3, 1.25, 0.6)},
    'ring': {'curl': (1.35, 1.3, 0.6)}, 'pinky': {'curl': (1.4, 1.3, 0.6)},
    'thumb': [(0.0, 0.0, 0.3), (0.2, 0, 0), (0.2, 0, 0)],
}
# The open hand under the handguard that the reload's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.066, 0.146, -0.056), fingers=(0.85, 0.51, 0.11), back=(-0.35, 0.0, -0.95), forearm=(-0.45, -0.70, -0.55))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.031, -0.166, -0.093), fingers=(0, 1, 0.12), back=(0.97, 0, 0.25), forearm=(0.35, -0.75, -0.55))
    hands.hand(w, 'left-hand', LEFT, wrist=(-0.064, 0.168, -0.024), fingers=(0.83, 0.3, -0.475), back=(-0.5, 0.0, -0.87), forearm=(-0.45, -0.70, -0.55), side='L')


def clips(w):
    """
    Reload: the gun rolls its underside towards the eye, the left hand takes
    the box off its hanger, drops it out of view, brings a full one back and
    hangs it. A slow, heavy change: 3.6 s. The empty reload ends with the left
    hand running the charging handle on the receiver's left. Equip: the
    support hand arrives under the handguard after the gun is up.
    """
    tilt, lift = (0.30, 0.66, 0.06), (-0.020, -0.02, 0.060)
    hold = (-0.020, -0.118, -0.094)
    gone = (-0.04, -0.14, -0.46)
    held = hands.basis(w, 'left-hand', **OPEN)
    for name in ('reload', 'reload-empty'):
        last = name == 'reload'
        c = lib.Clip(w, name, RELOAD)
        c.at('pivot', 0.11, loc=lift, rot=tilt).at('pivot', 0.50, loc=(lift[0], lift[1], lift[2] + 0.008), rot=(tilt[0] + 0.03, tilt[1] + 0.04, tilt[2]))
        c.at('pivot', 0.74 if last else 0.66, loc=lift, rot=tilt)
        # The box: off its hanger 0.13-0.19, gone 0.33-0.44, back 0.58, hung with a push.
        c.at('magazine', 0.13).at('magazine', 0.19, loc=(0, 0.004, -0.040), rot=(0.06, 0, 0))
        c.at('magazine', 0.33, loc=(-0.04, 0.02, -0.42), rot=(0.5, 0.4, 0.2)).at('magazine', 0.44, loc=(-0.04, 0.02, -0.42), rot=(0.5, 0.4, 0.2))
        c.at('magazine', 0.58, loc=(0, 0.004, -0.038), rot=(0.07, 0, 0)).at('magazine', 0.63, loc=(0, 0, 0.003)).at('magazine', 0.66)
        c.at('left-hand', 0.03).at('left-hand', 0.12, loc=hold, rot=(0.15, -0.25, 0.35), base=held)
        c.at('left-hand', 0.19, loc=(hold[0], hold[1] + 0.004, hold[2] - 0.040), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.33, loc=gone, rot=(0.6, -0.1, 0.5), base=held).at('left-hand', 0.44, loc=gone, rot=(0.6, -0.1, 0.5), base=held)
        c.at('left-hand', 0.58, loc=(hold[0], hold[1] + 0.004, hold[2] - 0.038), rot=(0.2, -0.25, 0.35), base=held)
        c.at('left-hand', 0.63, loc=(hold[0], hold[1], hold[2] - 0.004), rot=(0.25, -0.25, 0.35), base=held)
        if last:
            c.at('left-hand', 0.68, loc=hold, rot=(0.15, -0.25, 0.35), base=held).at('left-hand', 0.90)
        else:
            # The left hand hooks the charging handle, runs it back and lets it fly home; the gun jolts.
            grab = (-0.002, -0.118, 0.022)
            c.at('left-hand', 0.72, loc=grab, rot=(0.0, -0.4, 0.5), base=held).at('left-hand', 0.80, loc=(grab[0], grab[1] - 0.070, grab[2]), rot=(0.0, -0.4, 0.5), base=held)
            c.at('left-hand', 0.84, loc=(grab[0] - 0.006, grab[1] - 0.072, grab[2] - 0.006), rot=(0.05, -0.4, 0.5), base=held)
            c.at('left-hand', 0.96)
            c.at('charging-handle', 0.72).at('charging-handle', 0.80, loc=(0, -0.070, 0)).at('charging-handle', 0.83, loc=(0, -0.070, 0))
            c.at('charging-handle', 0.86, loc=(0, 0, 0), ease='LINEAR')
            c.at('pivot', 0.72, loc=(lift[0], lift[1], lift[2] - 0.02), rot=(0.15, 0.30, 0.05)).at('pivot', 0.86, loc=(lift[0], lift[1] - 0.008, lift[2] - 0.02), rot=(0.11, 0.30, 0.05))
        c.at('pivot', 0.97)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(0.03, -0.12, -0.14), rot=(0.5, 0.3, 0.2)).at('left-hand', 0.5, loc=(0.02, -0.08, -0.08), rot=(0.3, 0.2, 0.1)).at('left-hand', 0.88)


def build():
    w = lib.Weapon('lmg', pivot=(0, -0.07, -0.04))
    receiver(w)
    barrel(w)
    magazine(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.565, BORE))
    w.socket('eject', (SIDE + 0.002, 0.040, -0.006))
    w.socket('sight', (0, 0.366, SIGHT))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'lmg', (('reload', (0.12, 0.19, 0.33, 0.58, 0.66)), ('reload-empty', (0.74, 0.82))), rest=(0.15, -0.13, -0.27))
    if opts['bake']:
        lib.finish([w], opts, 'lmg')


if __name__ == '__main__':
    main()

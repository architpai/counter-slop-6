"""
The pump shotgun (docs/VISUALS.md, R4): an 870-pattern steel receiver, an
18.5-inch barrel over its tube magazine, a ribbed synthetic pump on twin
action bars, a pistol grip and short stock, a receiver rail carrying the ghost
ring, a red-fibre front sight, and a side saddle of red-hulled shells. The
bore runs along +Y at z = 0.012.

Moving parts: fore-end (the pump), shell (the round in the left hand while
loading; hidden at rest), trigger, both hands. Sockets: muzzle, eject,
sight (the front fibre). Clips: cycle (the pump, 0.45 s), shell (one round into
the loading port, 0.45 s), equip (0.45 s).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/weapons/shotgun.py -- [--preview] [--quick] [--no-bake]
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hands  # noqa: E402
import lib  # noqa: E402

BORE = 0.012
TUBE = -0.013
# The sight line (the ghost ring's centre and the fibre's) and the rear sight's place on the receiver.
SIGHT = BORE + 0.036
# The receiver's top, where its rail sits.
RECEIVER_TOP = 0.027
REAR = -0.038
# The receiver's flat top ends here and slopes down into the stock; the rail stops at it.
RAIL_BACK = -0.050
CYCLE = 0.45
SHELL = 0.45
DRAW = 0.45


def shell_mesh(name, y0, length=0.066, finish_hull='hull-red'):
    """A 12-gauge round along +Y from `y0`: brass head and rim, then the hull."""
    head = lib.lathe(f'{name}-head', [(y0, 0.0), (y0, 0.0112), (y0 + 0.0016, 0.0112), (y0 + 0.0018, 0.0102), (y0 + 0.012, 0.0102), (y0 + 0.012, 0.0)], 20, 'Y', finish='brass')
    hull = lib.lathe(f'{name}-hull', [(y0 + 0.012, 0.0), (y0 + 0.012, 0.0100), (y0 + length - 0.002, 0.0100), (y0 + length, 0.0092), (y0 + length, 0.0)], 20, 'Y', finish=finish_hull)
    return [head, hull]


def receiver(w):
    body = lib.profile('receiver', lib.fillet([(-0.080, -0.028), (0.110, -0.028), (0.110, 0.021), (0.104, 0.027), (-0.056, 0.027), (-0.080, 0.017)],
                                             [0.003, 0.002, 0.002, 0.004, 0.006, 0.003]), 0.030, finish='parkerized')
    # Ejection port on the right, loading port underneath.
    lib.cut(body, lib.box('ejection-port', (0.012, 0.052, 0.018), (0.0165, 0.048, 0.010)), lib.box('loading-port', (0.020, 0.074, 0.02), (0, 0.042, -0.030)))
    lib.bevel(body, 0.0012, 2)
    w.add(body)
    # Anti-glare serrations across the slope behind the rail. At full aim the eye, 9 cm behind it,
    # looks straight down this slope: plain, it filled the view's lower centre as a flat grey panel.
    top, back = (-0.056, 0.027), (-0.080, 0.017)
    length = math.hypot(top[0] - back[0], top[1] - back[1])
    along = ((back[0] - top[0]) / length, (back[1] - top[1]) / length)
    normal = (along[1], -along[0])
    ribs = []
    for i in range(9):
        s = 0.0068 + i * 0.0016
        centre = (0, top[0] + along[0] * s + normal[0] * 0.0003, top[1] + along[1] * s + normal[1] * 0.0003)
        rib = lib.box(f'serration{i}', (0.0262, 0.0008, 0.0010), centre, rotation=(math.atan2(along[1], along[0]), 0, 0))
        lib.bake_transform(rib)
        ribs.append(rib)
    serrations = lib.join('receiver-serrations', ribs)
    lib.paint(serrations, 'parkerized')
    w.add(serrations)
    # The bolt face seen through the port.
    w.add(lib.box('bolt-face', (0.012, 0.050, 0.016), (0.006, 0.048, 0.010), 'steel'))
    # Trigger plate, guard and safety.
    plate = lib.profile('trigger-plate', lib.fillet([(-0.058, -0.027), (0.010, -0.027), (0.006, -0.034), (-0.054, -0.034)], 0.002), 0.024, finish='polymer')
    lib.bevel(plate, 0.001, 2)
    w.add(plate)
    guard = lib.profile('trigger-guard', lib.fillet([(-0.052, -0.033), (0.004, -0.033), (0.004, -0.040), (-0.004, -0.052), (-0.046, -0.052), (-0.052, -0.044)], 0.004), 0.011, finish='polymer')
    lib.cut(guard, lib.box('guard-hole', (0.02, 0.046, 0.016), (0, -0.022, -0.041)))
    lib.bevel(guard, 0.0008, 2)
    w.add(guard)
    w.add(lib.lathe('safety', [(-0.0175, 0.0), (-0.0175, 0.0036), (0.0175, 0.0036), (0.0175, 0.0)], 16, 'X', (0, -0.056, -0.022), 'dark-steel'))
    # Pistol grip.
    grip = lib.profile('grip', lib.fillet([(-0.058, -0.030), (-0.064, -0.056), (-0.070, -0.082), (-0.075, -0.108), (-0.108, -0.113), (-0.103, -0.086), (-0.096, -0.058), (-0.084, -0.030)],
                                          [0.002, 0.005, 0.005, 0.006, 0.006, 0.008, 0.006, 0.002], 4), 0.031, finish='polymer-stipple')
    lib.bevel(grip, 0.0056, 4, 30)
    w.add(grip)
    # Short stock with a comb, and its butt pad. The comb drops about 6 cm under the sight line, so at
    # full aim the eye looks along the receiver's rail over it, not at a slab of stock. Its nose meets the
    # receiver's rear edge flush, as a real stock's does: 9 mm lower, it bared the receiver's back face,
    # a plain panel square to the eye under the sights.
    stock = lib.profile('stock', lib.fillet([(-0.082, -0.026), (-0.082, 0.015), (-0.120, -0.014), (-0.250, -0.018), (-0.262, -0.016), (-0.262, -0.090),
                                            (-0.246, -0.092), (-0.170, -0.052), (-0.110, -0.034)], [0.003, 0.006, 0.02, 0.01, 0.004, 0.004, 0.01, 0.02, 0.01], 3), 0.034, finish='polymer')
    lib.cut(stock, lib.profile('stock-cut', lib.fillet([(-0.134, -0.030), (-0.220, -0.030), (-0.232, -0.068), (-0.172, -0.052)], 0.008, 3), 0.06))
    lib.bevel(stock, 0.004, 3, 30)
    w.add(stock)
    # A stippled cheek riser along the comb, 3 mm proud and narrower than the stock. At full aim the eye
    # looks down the stock's nose from 5-9 cm: plain, it was one flat dark tone filling the view's lower
    # centre; the riser's stipple and its bevelled edges, against the smooth stock's, give it form.
    riser = lib.profile('cheek-riser', lib.fillet([(-0.088, 0.0129), (-0.120, -0.0115), (-0.205, -0.0141), (-0.205, -0.0226), (-0.120, -0.0220), (-0.088, 0.0024)],
                                                  [0.002, 0.02, 0.003, 0.003, 0.02, 0.002], 3), 0.024, finish='polymer-stipple')
    lib.bevel(riser, 0.0015, 2, 30)
    w.add(riser)
    # Moulded grip ribs across the riser's nose, the part of it the aimed eye sees.
    top, back = (-0.088, 0.0129), (-0.120, -0.0115)
    length = math.hypot(top[0] - back[0], top[1] - back[1])
    along = ((back[0] - top[0]) / length, (back[1] - top[1]) / length)
    normal = (along[1], -along[0])
    ribs = []
    for i in range(6):
        s = 0.0045 + i * 0.0028
        centre = (0, top[0] + along[0] * s + normal[0] * 0.0004, top[1] + along[1] * s + normal[1] * 0.0004)
        rib = lib.box(f'riser-rib{i}', (0.018, 0.0012, 0.0012), centre, rotation=(math.atan2(along[1], along[0]), 0, 0))
        lib.bake_transform(rib)
        ribs.append(rib)
    riser_ribs = lib.join('riser-ribs', ribs)
    lib.paint(riser_ribs, 'polymer')
    w.add(riser_ribs)
    pad = lib.profile('butt-pad', lib.fillet([(-0.262, -0.015), (-0.262, -0.091), (-0.274, -0.093), (-0.274, -0.013)], 0.005), 0.037, finish='rubber')
    lib.bevel(pad, 0.003, 2, 30)
    w.add(pad)
    # Barrel, the tube magazine, its cap and the barrel clamp.
    w.add(lib.lathe('barrel', [(0.100, 0.0), (0.100, 0.0126), (0.118, 0.0126), (0.124, 0.0106), (0.560, 0.0104), (0.560, 0.0)], 32, 'Y', (0, 0, BORE), 'dark-steel'))
    # Tactical sights: a Picatinny rail along the receiver's top (its crossbars break up what the eye
    # looks along at full aim) carrying a ghost ring, and a blade front sight with a red fibre, on a
    # sight line 21 mm over the receiver, so the ring frames the fibre over a clear view.
    w.add(lib.rail('receiver-rail', RAIL_BACK, 0.100, RECEIVER_TOP, 'parkerized'))
    ramp = lib.profile('sight-ramp', lib.fillet([(0.524, BORE + 0.0095), (0.558, BORE + 0.0095), (0.558, BORE + 0.0215), (0.534, BORE + 0.0195)], 0.0015), 0.0080, finish='dark-steel')
    lib.bevel(ramp, 0.0005, 1)
    w.add(ramp)
    blade = lib.profile('sight-blade', lib.fillet([(0.542, BORE + 0.0190), (0.558, BORE + 0.0190), (0.558, SIGHT - 0.0010), (0.555, SIGHT + 0.0012),
                                                  (0.545, SIGHT + 0.0012), (0.542, SIGHT - 0.0030)], [0.001, 0.001, 0.001, 0.0008, 0.0008, 0.003]), 0.0050, finish='dark-steel')
    lib.bevel(blade, 0.0005, 1)
    w.add(blade)
    # The ring's clamp sits on the rail's crossbars (5.5 mm tall).
    base = RECEIVER_TOP + 0.0055
    rear = [lib.box('ring-base', (0.022, 0.026, 0.004), (0, REAR, base + 0.002)),
            lib.lathe('ghost-ring', [(REAR - 0.002, 0.0036), (REAR - 0.002, 0.0070), (REAR + 0.002, 0.0070), (REAR + 0.002, 0.0036)], 28, 'Y', (0, 0, SIGHT), closed=True),
            lib.box('ring-stem', (0.004, 0.004, SIGHT - 0.0066 - base), (0, REAR, (SIGHT - 0.0066 + base) / 2))]
    for x in (-0.0095, 0.0095):
        rear.append(lib.profile(f'ring-wing{x}', lib.fillet([(REAR - 0.013, base + 0.001), (REAR + 0.011, base + 0.001), (REAR + 0.006, SIGHT + 0.0100), (REAR - 0.008, SIGHT + 0.0100)], 0.002), 0.0030, x=x))
    for o in rear:
        lib.paint(o, 'dark-steel')
        lib.bevel(o, 0.0005, 1)
        w.add(o)
    crown = lib.lathe('crown', [(0.556, 0.0103), (0.556, 0.0107), (0.562, 0.0107), (0.562, 0.0092), (0.559, 0.0092)], 32, 'Y', (0, 0, BORE), 'dark-steel', closed=True)
    w.add(crown)
    w.add(lib.lathe('mag-tube', [(0.108, 0.0), (0.108, 0.0112), (0.488, 0.0112), (0.488, 0.0)], 28, 'Y', (0, 0, TUBE), 'dark-steel'))
    cap = lib.lathe('tube-cap', [(0.486, 0.0), (0.486, 0.0128), (0.508, 0.0128), (0.512, 0.0112), (0.512, 0.0)], 28, 'Y', (0, 0, TUBE), 'knurl')
    lib.bevel(cap, 0.0006, 2)
    w.add(cap)
    clamp = lib.profile('barrel-clamp', lib.fillet([(0.470, TUBE - 0.013), (0.486, TUBE - 0.013), (0.486, BORE + 0.012), (0.470, BORE + 0.012)], 0.002), 0.024, finish='parkerized')
    lib.bevel(clamp, 0.001, 2)
    w.add(clamp)
    # Side saddle on the left with four shells, heads up.
    saddle = lib.profile('saddle', lib.fillet([(-0.010, -0.034), (0.084, -0.034), (0.084, 0.012), (-0.010, 0.012)], 0.004), 0.006, x=-0.0185, finish='polymer')
    lib.bevel(saddle, 0.001, 2)
    w.add(saddle)
    for i in range(4):
        rounds = shell_mesh(f'saddle{i}', 0.0)
        r = lib.join(f'saddle-shell{i}', rounds)
        r.data.transform(lib.Matrix.Translation((-0.0275, 0.004 + i * 0.022, -0.042)) @ lib.Matrix.Rotation(math.pi / 2, 4, 'X'))
        w.add(r)


def moving(w):
    # The front sight's red fibre, unlit like the flat look's accent, so it reads against any background.
    fibre = lib.tube('fibre', 0.0018, 0.012, (0, 0.550, SIGHT), 'Y', 16, finish='glass')
    w.part('fibre', fibre, material='reticle')
    # The pump: a ribbed synthetic fore-end around the tube, on two action bars running back to the receiver.
    pump = lib.lathe('pump', [(0.200, 0.0), (0.200, 0.0180), (0.206, 0.0205), (0.354, 0.0205), (0.360, 0.0180), (0.360, 0.0)], 24, 'Y', (0, 0, TUBE + 0.002), 'polymer', scale=(1.0, 1.08))
    lib.bevel(pump, 0.001, 2)
    grooves = [lib.lathe(f'pump-groove{i}', [(0.224 + i * 0.018, 0.0204), (0.224 + i * 0.018, 0.0214), (0.232 + i * 0.018, 0.0214), (0.232 + i * 0.018, 0.0204)], 24, 'Y', (0, 0, TUBE + 0.002), 'polymer', scale=(1.0, 1.08), closed=True)
               for i in range(7)]
    bars = [lib.box(f'action-bar{s}', (0.0022, 0.100, 0.0045), (s * 0.0120, 0.150, TUBE + 0.004), 'steel') for s in (-1, 1)]
    w.part('fore-end', [pump, *grooves, *bars], origin=(0, 0.280, TUBE))
    trigger = lib.profile('trigger', lib.fillet([(-0.030, -0.034), (-0.024, -0.034), (-0.024, -0.040), (-0.028, -0.047), (-0.033, -0.049), (-0.031, -0.044), (-0.029, -0.040)], 0.001, 2), 0.005, finish='dark-steel')
    lib.bevel(trigger, 0.0006, 2)
    w.part('trigger', trigger, origin=(0, -0.027, -0.034))


RIGHT = {
    'index': {'curl': (0.35, 1.05, 0.45), 'splay': -0.06}, 'middle': {'curl': (1.15, 1.45, 0.65)},
    'ring': {'curl': (1.2, 1.5, 0.65)}, 'pinky': {'curl': (1.25, 1.45, 0.65)},
    'thumb': [(-0.6, 0.0, -0.2), (-0.5, 0, 0), (-0.35, 0, 0)],
}
# The support hand wraps the pump: the palm on its lower left, the fingers
# round the bottom and up the far side, the thumb forward along the near side.
LEFT = {
    'index': {'curl': (1.3, 1.2, 0.6)}, 'middle': {'curl': (1.35, 1.3, 0.6)},
    'ring': {'curl': (1.4, 1.35, 0.6)}, 'pinky': {'curl': (1.45, 1.35, 0.6)},
    'thumb': [(0.0, 0.0, 0.3), (0.2, 0, 0), (0.2, 0, 0)],
}
# The open hand under the pump that the shell's holds are keyed from (hands.basis).
OPEN = dict(wrist=(-0.070, 0.212, -0.066), fingers=(0.85, 0.51, 0.02), back=(-0.35, 0.0, -0.95), forearm=(-0.45, -0.70, -0.55))


def arms(w):
    hands.hand(w, 'right-hand', RIGHT, wrist=(0.031, -0.166, -0.083), fingers=(0, 1, 0.12), back=(0.97, 0, 0.25), forearm=(0.35, -0.75, -0.55))
    left = hands.hand(w, 'left-hand', LEFT, wrist=(-0.0593, 0.265, -0.018), fingers=(0.83, 0.3, -0.475), back=(-0.5, 0.0, -0.87), forearm=(-0.45, -0.70, -0.55), side='L')
    # The round being loaded rides in the left hand, hidden at rest.
    shell = lib.join('shell', shell_mesh('loading', -0.033))
    shell.parent = left
    # Across the palm, between the thumb and the fingers (the hand's own frame: +Y to the knuckles, -Z the palm).
    shell.matrix_basis = hands.palm(left, lib.Matrix.Translation((0.0, 0.075, -0.022)) @ lib.Matrix.Rotation(math.pi / 2, 4, 'Z'))
    shell.scale = (0.001, 0.001, 0.001)
    w.parts['shell'] = shell


def clips(w):
    """The pump: fore-end and left hand back and home; a shell: the round up into the loading port."""
    c = lib.Clip(w, 'cycle', CYCLE)
    back = (0, -0.085, 0)
    c.at('fore-end', 0.06).at('fore-end', 0.34, loc=back, ease='LINEAR').at('fore-end', 0.46, loc=back).at('fore-end', 0.78, ease='LINEAR')
    c.at('left-hand', 0.06).at('left-hand', 0.34, loc=back, rot=(0.03, 0, 0), ease='LINEAR').at('left-hand', 0.46, loc=back, rot=(0.03, 0, 0)).at('left-hand', 0.78, ease='LINEAR')
    c.at('pivot', 0.30, loc=(0, -0.006, 0.004), rot=(0.06, 0.08, 0.02)).at('pivot', 0.62, loc=(0, 0.002, 0), rot=(-0.02, 0.02, 0)).at('pivot', 0.95)
    c = lib.Clip(w, 'shell', SHELL)
    held = hands.basis(w, 'left-hand', **OPEN)
    port = (0.066, -0.185, 0.020)
    c.at('pivot', 0.2, loc=(0, 0, 0.012), rot=(0.10, 0.34, 0.0)).at('pivot', 0.8, loc=(0, 0, 0.012), rot=(0.10, 0.34, 0.0)).at('pivot', 1.0)
    c.at('left-hand', 0.08).at('left-hand', 0.30, loc=(port[0] - 0.02, port[1] - 0.02, port[2] - 0.05), rot=(0.4, -0.5, 0.6), base=held)
    c.at('left-hand', 0.52, loc=port, rot=(0.5, -0.5, 0.6), base=held).at('left-hand', 0.60, loc=(port[0], port[1] + 0.01, port[2] + 0.004), rot=(0.5, -0.5, 0.6), base=held)
    c.at('left-hand', 0.86)
    c.at('shell', 0.0, scale=0.001).at('shell', 0.16, scale=0.001).at('shell', 0.2, scale=1.0).at('shell', 0.56, scale=1.0).at('shell', 0.6, scale=0.001).at('shell', 1.0, scale=0.001)
    c = lib.Clip(w, 'equip', DRAW)
    c.at('left-hand', 0.0, loc=(0.03, -0.12, -0.14), rot=(0.5, 0.3, 0.2)).at('left-hand', 0.5, loc=(0.02, -0.07, -0.07), rot=(0.3, 0.2, 0.1)).at('left-hand', 0.88)


def build():
    w = lib.Weapon('shotgun', pivot=(0, -0.07, -0.035))
    receiver(w)
    moving(w)
    arms(w)
    w.socket('muzzle', (0, 0.563, BORE))
    w.socket('eject', (0.018, 0.048, 0.012))
    w.socket('sight', (0, 0.550, SIGHT))
    clips(w)
    lib.assemble([w])
    return w


def main():
    opts = lib.options()
    lib.reset()
    w = build()
    if opts['preview']:
        lib.study(w, opts, 'shotgun', (('cycle', (0.34,)), ('shell', (0.3, 0.52))), rest=(0.14, -0.12, -0.25))
    if opts['bake']:
        lib.finish([w], opts, 'shotgun')


if __name__ == '__main__':
    main()

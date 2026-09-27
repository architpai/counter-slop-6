"""
The machines (docs/VISUALS.md, R7): mechanical redesigns of the flat look's
drones and walkers, on the same pivots (render/figure.ts) and inside the same
silhouettes, so their hit volumes (the flat look's meshes, which the game
keeps testing) still read where they are:

- attack drone and turret-drop carrier: quadcopters, two ducted rotors on
  each wing boom (the wings' pivots), the carrier with its folded sentry
  underneath (`equipment-carrier`, hidden once dropped);
- the moderator: a heavy hexacopter gunship with its masked sensor head and
  the relay ring round it (`equipment-moderator`, which turns and grows);
- the live nade: a squat demolition robot, a charge drum on two legs, its
  detonator cap, cable and arming beacon (`cap`, `fuse`, `spark`);
- THE HITBOX: an armoured breaching walker with a hinged lid (`lid`);
- THE LAG SPIKE: a transmitter walker with its antenna mast (`spikes`).

Each returns [(object, bone, zone)] in the kind's unscaled space (the game
scales the root by the kind's scale), with the kind's mask placed by
`mask_at`.
"""

import math

from mathutils import Matrix

import core as L
import masks as M

TAU = math.tau


def mask_at(kind, centre, scale, bone, heavy=False):
    """The kind's mask (masks.py, made for a head) moved to `centre` at `scale`, rigid on `bone`."""
    out = []
    face = (0.0, M.Y0 + M.HEIGHT * 0.5, 0.075)
    m = Matrix.Translation(L.G(*centre)) @ Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation(-L.G(*face))
    for o, colour, glow in M.build(kind, heavy):
        o.data.transform(m)
        o.data.update()
        out.append((o, bone, (colour, glow)))
    return out


def rotor(name, centre, radius, bone, blades=3):
    """A ducted rotor: the duct ring on the boom (`bone`), the hub and blades on their own spinning bone."""
    duct = L.lathe(f'{name}-duct', [(0.0, radius + 0.025), (0.045, radius + 0.028), (0.05, radius + 0.012), (0.0, radius + 0.006)], centre, 'y', 32, 'polymer', closed=True)
    out = [(duct, bone, 'kit2')]
    hub = L.lathe(f'{name}-hub', [(-0.02, 0.0), (-0.02, 0.028), (0.03, 0.022), (0.04, 0.0)], centre, 'y', 12, 'metal')
    out.append((hub, f'{bone}-rotor', 'steel'))
    for i in range(blades):
        a = i * TAU / blades
        blade = L.box(f'{name}-blade{i}', (radius * 0.95, 0.006, 0.04), (0, 0, 0), 'polymer', rot=(0.18, a, 0), bevel=0.002)
        blade.data.transform(L.game_matrix((centre[0] + math.cos(a) * radius * 0.5, centre[1] + 0.012, centre[2] - math.sin(a) * radius * 0.5)))
        out.append((blade, f'{bone}-rotor', 'rubber'))
    for i in range(3):
        a = i * TAU / 3 + 0.5
        strut = L.tube(f'{name}-strut{i}', (centre[0], centre[1] - 0.01, centre[2]),
                       (centre[0] + math.cos(a) * (radius + 0.01), centre[1] - 0.01, centre[2] + math.sin(a) * (radius + 0.01)), 0.006, 6, 'metal')
        out.append((strut, bone, 'steel'))
    return out


def quad(kind, moderator=False, carrier=False):
    out = []
    y = 0.6
    # The fuselage: a faceted armoured body from the flat look's hull rings, nose sensor forward.
    hull = L.panel('hull-side', [(-0.37, -0.12), (0.3, -0.14), (0.44, -0.04), (0.42, 0.08), (0.2, 0.15), (-0.34, 0.12), (-0.43, 0.02)], 0.5, 'steel', bevel=0.02,
                   centre=(0, y, 0.0), plane='zy')
    out.append((hull, 'torso', 'kit'))
    out.append((L.box('hull-top', (0.34, 0.03, 0.5), (0, y + 0.15, -0.02), 'polymer', bevel=0.008), 'torso', 'kit2'))
    out.append((L.box('battery', (0.28, 0.1, 0.26), (0, y - 0.15, -0.06), 'polymer', bevel=0.012), 'torso', 'kit2'))
    for s in (-1, 1):
        out.append((L.box(f'nav-light{s}', (0.03, 0.02, 0.03), (s * 0.24, y + 0.06, 0.28), 'glow', bevel=0.004), 'torso', 'glow'))
        out.append((L.tube(f'skid{s}', (s * 0.16, y - 0.2, -0.28), (s * 0.16, y - 0.2, 0.22), 0.016, 8, 'rubber'), 'torso', 'rubber'))
        for z in (-0.18, 0.12):
            out.append((L.tube(f'skid-leg{s}{z}', (s * 0.13, y - 0.14, z), (s * 0.16, y - 0.2, z), 0.01, 6, 'metal'), 'torso', 'steel'))
        side = 'LR'[s > 0]
        # The wing: a boom out from the hull and along it, a rotor at each end; the wing pivot trims it.
        wx = s * 0.48
        out.append((L.box(f'boom{side}', (0.34, 0.05, 0.07), (s * 0.3, y, -0.14), 'polymer', bevel=0.012), f'wing{side}', 'kit2'))
        out.append((L.box(f'boom-rail{side}', (0.06, 0.05, 0.66), (wx, y, -0.14), 'polymer', bevel=0.012), f'wing{side}', 'kit'))
        out.append((L.box(f'boom-band{side}', (0.065, 0.052, 0.05), (wx, y, 0.14), 'paint', bevel=0.004), f'wing{side}', 'mark'))
        for end, dz in (('F', 0.18), ('B', -0.46)):
            out += [(o, b.replace('-rotor', f'-rotor{end}'), z) for o, b, z in rotor(f'rotor{side}{end}', (wx, y + 0.045, dz), 0.15, f'wing{side}')]
    # The tail: a sensor boom with a fin.
    out.append((L.box('tailplane', (0.4, 0.025, 0.12), (0, y + 0.1, -0.56), 'polymer', bevel=0.006), 'tail', 'kit2'))
    out.append((L.panel('tail-fin', [(-0.06, 0.0), (0.05, 0.0), (0.02, 0.18), (-0.07, 0.2)], 0.018, 'polymer', bevel=0.004, centre=(0, y + 0.12, -0.58), plane='zy'), 'tail', 'kit'))
    out.append((L.box('tail-stripe', (0.26, 0.012, 0.03), (0, y + 0.115, -0.52), 'paint', bevel=0.002), 'tail', 'mark'))
    if moderator:
        # A gunship's sensor head, on its own bone, with the mask; the relay ring round the hull.
        out.append((L.box('sensor-head', (0.2, 0.22, 0.18), (0, y + 0.36, 0.43), 'steel', bevel=0.03), 'head', 'kit'))
        out.append((L.lathe('head-neck', [(0.0, 0.06), (0.1, 0.05)], (0, y + 0.15, 0.43), 'y', 12, 'metal'), 'head', 'steel'))
        out += mask_at(kind, (0, y + 0.37, 0.53), 0.95, 'head')
        for radius, zone, fin in ((0.66, 'gold', 'metal'), (0.74, 'kit2', 'polymer')):
            ring = L.lathe(f'ring{radius}', [(-0.022, radius), (0.022, radius), (0.022, radius + 0.03), (-0.022, radius + 0.03)], (0, y, -0.08), 'z', 64, fin, closed=True)
            out.append((ring, 'equipment-moderator', zone))
        for i in range(8):
            a = i * TAU / 8
            out.append((L.box(f'relay{i}', (0.07, 0.07, 0.1), (math.cos(a) * 0.7, y + math.sin(a) * 0.7, -0.08), 'glow', rot=(0, 0, a), bevel=0.01),
                        'equipment-moderator', 'glow'))
        for s in (-1, 1):
            out.append((L.tube(f'ring-strut{s}', (s * 0.2, y, -0.08), (s * 0.65, y, -0.08), 0.018, 8, 'metal'), 'equipment-moderator', 'steel'))
    else:
        out += mask_at(kind, (0, y - 0.02, 0.44), 1.0, 'torso')
    if carrier:
        # The folded sentry it drops: a boxed turret with its barrel and legs, in clamps.
        for s in (-1, 1):
            out.append((L.tube(f'clamp{s}', (s * 0.17, y - 0.12, -0.12), (s * 0.17, y - 0.34, -0.12), 0.02, 8, 'metal'), 'equipment-carrier', 'kit2'))
        out.append((L.box('payload', (0.3, 0.18, 0.28), (0, y - 0.38, -0.1), 'steel', bevel=0.02), 'equipment-carrier', 'kit'))
        out.append((L.tube('payload-barrel', (0, y - 0.35, 0.04), (0, y - 0.35, 0.4), 0.025, 10, 'metal'), 'equipment-carrier', 'steel'))
        out.append((L.box('payload-optic', (0.08, 0.06, 0.08), (0, y - 0.27, 0.02), 'lens', bevel=0.008), 'equipment-carrier', 'lens'))
        out.append((L.box('payload-stripe', (0.305, 0.03, 0.2), (0, y - 0.33, -0.1), 'paint', bevel=0.003), 'equipment-carrier', 'mark'))
    return out


def walker_legs(out, torso_y=0.5, stout=1.0):
    """The blob walkers' arms and legs (pivots from render/figure.ts): manipulators and drive legs."""
    for s, side in ((-1, 'L'), (1, 'R')):
        ax = s * 0.42
        out.append((L.box(f'shoulder-drive{side}', (0.14, 0.14, 0.14), (ax, torso_y + 0.42, 0.0), 'steel', bevel=0.02), f'upper{side}', 'kit2'))
        out.append((L.box(f'manipulator{side}', (0.08, 0.22, 0.1), (ax, torso_y + 0.3, 0.0), 'steel', bevel=0.012), f'upper{side}', 'kit'))
        out.append((L.tube(f'arm-hose{side}', (ax + s * 0.05, torso_y + 0.4, -0.03), (ax + s * 0.05, torso_y + 0.2, -0.03), 0.01, 6, 'rubber'), f'upper{side}', 'rubber'))
        out.append((L.box(f'wrist{side}', (0.1, 0.07, 0.1), (ax, torso_y + 0.16, 0.0), 'metal', bevel=0.01), f'fore{side}', 'steel'))
        for f in (-1, 1):
            out.append((L.box(f'gripper{side}{f}', (0.022, 0.09, 0.05), (ax + f * 0.035, torso_y + 0.1, 0.02), 'steel', bevel=0.005), f'fore{side}', 'kit2'))
        lx = s * 0.16
        out.append((L.box(f'hip-drive{side}', (0.15, 0.12, 0.15), (lx, torso_y - 0.06, 0.0), 'steel', bevel=0.02), f'thigh{side}', 'kit2'))
        # The knee: a hinge drum round the shin's pivot (0.32 under the hip's), wider than the thigh link's and the
        # ankle's ends, so both stay inside it however far the knee bends (the flat look's shin runs up into its thigh).
        knee = torso_y - 0.32
        out.append((L.box(f'thigh-link{side}', (0.12 * stout, 0.23, 0.13 * stout), (lx, knee + 0.135, 0.0), 'steel', bevel=0.018), f'thigh{side}', 'kit'))
        drum = 0.07 * stout + 0.01
        out.append((L.lathe(f'knee-drum{side}', [(-0.075 * stout, 0.0), (-0.075 * stout, drum), (0.075 * stout, drum), (0.075 * stout, 0.0)],
                            (lx, knee, 0.0), 'x', 16, 'metal'), f'shin{side}', 'steel'))
        out.append((L.tube(f'leg-piston{side}', (lx + s * 0.075, torso_y - 0.08, -0.02), (lx + s * 0.075, torso_y - 0.3, -0.02), 0.016, 8, 'metal'), f'thigh{side}', 'steel'))
        out.append((L.box(f'ankle{side}', (0.12, 0.12, 0.12), (lx, torso_y - 0.38, -0.01), 'steel', bevel=0.018), f'shin{side}', 'kit2'))
        out.append((L.box(f'foot{side}', (0.2 * stout, 0.06, 0.27), (lx, torso_y - 0.465, 0.05), 'rubber', bevel=0.015), f'shin{side}', 'rubber'))
        for i in range(3):
            out.append((L.box(f'foot-rib{side}{i}', (0.2 * stout, 0.014, 0.022), (lx, torso_y - 0.495, -0.04 + i * 0.08), 'metal', bevel=0.003), f'shin{side}', 'steel'))
    out.append((L.box('pelvis', (0.4, 0.14, 0.3), (0, torso_y, 0.0), 'steel', bevel=0.025), 'hips', 'kit2'))
    return out


def bomber(kind='bomber'):
    out = []
    t = 0.5
    # The charge drum: a steel drum with bands, the charges strapped to its back, a blast apron in front.
    drum = L.lathe('charge-drum', [(0.0, 0.0), (0.0, 0.27), (0.03, 0.31), (0.6, 0.32), (0.66, 0.26), (0.7, 0.0)], (0, t - 0.03, 0.0), 'y', 32, 'steel')
    out.append((drum, 'torso', 'kit'))
    for i, by in enumerate((0.1, 0.34, 0.56)):
        out.append((L.lathe(f'drum-band{i}', [(0.0, 0.325), (0.04, 0.325), (0.04, 0.33), (0.0, 0.33)], (0, t + by, 0.0), 'y', 32, 'paint', closed=True), 'torso', 'mark'))
    for s in (-1, 1):
        out.append((L.box(f'explosive-pack{s}', (0.12, 0.32, 0.16), (s * 0.13, t + 0.34, -0.33), 'polymer', bevel=0.015), 'torso', 'kit2'))
        out.append((L.box(f'pack-strap{s}', (0.13, 0.03, 0.17), (s * 0.13, t + 0.34, -0.33), 'webbing', bevel=0.004), 'torso', 'rubber'))
    out.append((L.curved_panel('blast-apron', 0.46, 0.38, 0.03, 0.34, 'steel', centre=(0, t + 0.27, 0.33), cols=10, rows=4, bevel=0.008), 'torso', 'kit2'))
    out += mask_at(kind, (0, t + 0.18 + 0.02, 0.37), 1.12, 'torso')
    out.append((L.box('detonator-cap', (0.18, 0.08, 0.15), (0, t + 0.73, 0.0), 'polymer', bevel=0.015), 'cap', 'kit2'))
    out.append((L.box('cap-hazard', (0.185, 0.02, 0.155), (0, t + 0.745, 0.0), 'paint', bevel=0.003), 'cap', 'mark'))
    out.append((L.strap('arming-cable', [(0, t + 0.77, 0.0), (-0.02, t + 1.05, 0.0), (0.1, t + 1.15, 0.0), (0.24, t + 1.14, 0.0)], 0.02, 0.02, 'rubber'), 'fuse', 'rubber'))
    out.append((L.lathe('beacon', [(-0.03, 0.0), (-0.03, 0.03), (0.02, 0.04), (0.05, 0.0)], (0.24, t + 1.14, 0.0), 'y', 12, 'glow'), 'spark', 'glow'))
    return walker_legs(out, t)


def hitbox(kind='hitbox'):
    out = []
    t = 0.5
    out.append((L.box('breach-housing', (0.8, 0.66, 0.64), (0, t + 0.33, 0.0), 'steel', bevel=0.05), 'torso', 'kit'))
    for s in (-1, 1):
        out.append((L.box(f'corner-guard{s}', (0.08, 0.62, 0.1), (s * 0.39, t + 0.33, 0.33), 'steel', bevel=0.02), 'torso', 'kit2'))
        out.append((L.box(f'hazard-panel{s}', (0.16, 0.1, 0.02), (s * 0.25, t + 0.6, 0.325), 'paint', bevel=0.003), 'torso', 'mark'))
        for i in range(4):
            out.append((L.box(f'rivet{s}{i}', (0.018, 0.018, 0.01), (s * 0.39, t + 0.08 + i * 0.16, 0.382), 'metal', bevel=0.004), 'torso', 'steel'))
    out.append((L.box('ram-bumper', (0.84, 0.13, 0.12), (0, t + 0.03, 0.37), 'steel', bevel=0.025), 'torso', 'kit2'))
    for i in (-1, 0, 1):
        out.append((L.box(f'ram-tooth{i}', (0.06, 0.16, 0.05), (i * 0.25, t + 0.02, 0.44), 'metal', bevel=0.01), 'torso', 'steel'))
    out += mask_at(kind, (0, t + 0.3, 0.37), 1.28, 'torso', heavy=True)
    out.append((L.box('armored-lid', (0.74, 0.24, 0.58), (0, t + 0.83, 0.0), 'steel', bevel=0.04), 'lid', 'kit'))
    out.append((L.box('lid-seal', (0.76, 0.025, 0.6), (0, t + 0.69, 0.0), 'rubber', bevel=0.006), 'lid', 'rubber'))
    for i in range(5):
        out.append((L.box(f'lid-vent{i}', (0.035, 0.07, 0.02), ((i - 2) * 0.09, t + 0.83, 0.295), 'rubber', bevel=0.004), 'lid', 'rubber'))
    return walker_legs(out, t, stout=1.2)


def lagspike(kind='lagspike'):
    out = []
    t = 0.5
    housing = L.lathe('signal-housing', [(0.0, 0.0), (0.0, 0.25), (0.2, 0.38), (0.46, 0.36), (0.7, 0.22), (0.72, 0.0)], (0, t - 0.03, 0.0), 'y', 12, 'steel', scale=(1.0, 0.9))
    out.append((housing, 'torso', 'kit'))
    out.append((L.panel('transmitter-front', [(-0.28, 0.0), (0.28, 0.0), (0.3, 0.36), (0.0, 0.54), (-0.3, 0.36)], 0.035, 'polymer', bevel=0.008,
                        centre=(0, t + 0.08, 0.33)), 'torso', 'kit2'))
    out += mask_at(kind, (0, t + 0.3, 0.37), 1.2, 'torso')
    out.append((L.box('relay-pack', (0.36, 0.5, 0.15), (0, t + 0.39, -0.34), 'steel', bevel=0.025), 'torso', 'kit2'))
    for i in range(4):
        out.append((L.box(f'relay-vent{i}', (0.26, 0.02, 0.02), (0, t + 0.24 + i * 0.083, -0.42), 'rubber', bevel=0.004), 'torso', 'rubber'))
    for s in (-1, 1):
        for i in range(3):
            a = (s * (0.25 + i * 0.035), t + 0.6 - i * 0.2, -0.13)
            b = (s * (0.39 + i * 0.062), t + 1.0 - i * 0.24, -0.21 - i * 0.045)
            out.append((L.tube(f'antenna{s}{i}', a, b, 0.022, 8, 'metal'), 'spikes', 'kit2'))
            out.append((L.tube(f'antenna-tip{s}{i}', b, (b[0] + s * 0.035, b[1] + 0.12, b[2]), 0.01, 6, 'glow'), 'spikes', 'glow'))
    out.append((L.box('transmitter-cap', (0.15, 0.12, 0.12), (0, t + 0.75, -0.03), 'steel', bevel=0.015), 'spikes', 'kit'))
    out.append((L.box('transmitter-light', (0.075, 0.025, 0.012), (0, t + 0.774, 0.036), 'glow', bevel=0.003), 'spikes', 'glow'))
    return walker_legs(out, t)


BUILDERS = {
    'flyer': lambda: quad('flyer'),
    'carrier': lambda: quad('carrier', carrier=True),
    'moderator': lambda: quad('moderator', moderator=True),
    'bomber': bomber, 'hitbox': hitbox, 'lagspike': lagspike,
}

# Colours of the machines' zones (sRGB hex), as roster.py's.
COLOURS = {
    'flyer': dict(kit=0x4d545a, kit2=0x2c3034, mark=0xa3222e),
    'carrier': dict(kit=0x5a5f52, kit2=0x33372f, mark=0xd98a1a),
    'moderator': dict(kit=0x3d3552, kit2=0x2a2733, mark=0xc29a45, gold=0xc29a45, glow=0xb07cff),
    'bomber': dict(kit=0x55595c, kit2=0x33302a, mark=0xd98a1a, glow=0xff3a1c),
    'hitbox': dict(kit=0x5a4a6e, kit2=0x3a3440, mark=0xd98a1a),
    'lagspike': dict(kit=0x6b3a30, kit2=0x3a3230, mark=0xa3222e, glow=0xb07cff),
}


def bones(kind):
    if kind in ('flyer', 'carrier', 'moderator'):
        rig = L.flyer_bones(moderator=kind == 'moderator', carrier=kind == 'carrier')
        for side in ('L', 'R'):
            for end, dz in (('F', 0.32), ('B', -0.32)):
                rig.append((f'wing{side}-rotor{end}', f'wing{side}', (0.0, 0.045, dz)))
        return rig
    extra = {'bomber': [('cap', 'torso', (0, 0.76, 0)), ('fuse', 'torso', (0, 0, 0)), ('spark', 'torso', (0.24, 1.14, 0))],
             'hitbox': [('lid', 'torso', (0, 0.86, 0))], 'lagspike': [('spikes', 'torso', (0, 0, 0))]}[kind]
    return L.blob_bones(extra)

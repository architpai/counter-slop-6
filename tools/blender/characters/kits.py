"""
Role kits (docs/VISUALS.md, V3 and R7): one large block of colour or shape
per role that reads at 30-60 m, after the flat look's equipment
(assets/models/build_tactical.py): the medic's pack and crosses, the
sniper's ghillie, the riot and breaching shields, the pack leader's
loudhailer, the smoker's canisters, the rubberbander's fins, the sapper's
charges, the parry's collar and bracer, the aimbot's targeting computer,
the ragequit's pauldrons and cleaver, the Admin's coat and the
juggernaut's armour. Each returns [(object, bone, zone)], `zone` naming
the kind's colour the piece takes (roster.py).
"""

import math

import core as L
import sdf as S

E, R, B = S.ellipsoid, S.round_cone, S.box


def backpack(name, size, centre=(0, 1.25, -0.26), finish='cordura', zone='kit'):
    return [(L.box(name, size, centre, finish, bevel=0.02), 'chest', zone)]


def medic():
    """The medic's white kit (roster.py) with a big red cross on the chest and on the pack, cylinders and armbands."""
    out = backpack('medic-pack', (0.3, 0.36, 0.15), (0, 1.25, -0.235), 'cordura')
    # The pack's cross, across most of its back.
    out.append((L.box('pack-cross-v', (0.075, 0.25, 0.006), (0, 1.26, -0.312), 'paint', bevel=0.002), 'chest', 'mark2'))
    out.append((L.box('pack-cross-h', (0.25, 0.075, 0.006), (0, 1.26, -0.312), 'paint', bevel=0.002), 'chest', 'mark2'))
    # The chest's, on a white panel over the carrier's admin pouch, above the magazine pouches.
    out.append((L.curved_panel('chest-cross-panel', 0.2, 0.16, 0.01, 0.34, 'cordura', centre=(0, 1.305, 0.2), cols=6, rows=2, bevel=0.003), 'chest', 'kit'))
    out.append((L.curved_panel('chest-cross-v', 0.05, 0.145, 0.004, 0.34, 'paint', centre=(0, 1.305, 0.21), cols=2, rows=2, bevel=0.001), 'chest', 'mark2'))
    out.append((L.curved_panel('chest-cross-h', 0.145, 0.05, 0.004, 0.34, 'paint', centre=(0, 1.305, 0.2105), cols=4, rows=1, bevel=0.001), 'chest', 'mark2'))
    for s in (-1, 1):
        out.append((L.tube(f'medic-cylinder{s}', (s * 0.175, 1.1, -0.22), (s * 0.175, 1.38, -0.22), 0.04, 14, 'polymer'), 'chest', 'kit'))
        # Armbands with the cross.
        out.append((L.ring(f'medic-band{s}', (s * 0.258, 1.2 + 0.025, 0.012), (0.058, 0.056), 0.05, 0.006, 'y', 16, 'canvas'), f'upper{"LR"[s > 0]}', 'kit'))
        out.append((L.box(f'band-cross{s}', (0.03, 0.03, 0.004), (s * 0.3, 1.225, 0.02), 'paint', rot=(0, s * 1.3, 0), bevel=0.001), f'upper{"LR"[s > 0]}', 'mark2'))
    # The helmet's crosses.
    for x, z, ry in ((0.0, 0.119, 0.0), (0.0, -0.132, math.pi)):
        out.append((L.box('helmet-cross-v', (0.022, 0.06, 0.005), (x, 1.745, z), 'paint', rot=(0.4 if z > 0 else -0.4, ry, 0), bevel=0.001), 'head', 'mark2'))
        out.append((L.box('helmet-cross-h', (0.06, 0.022, 0.005), (x, 1.745, z + (0.002 if z > 0 else -0.002)), 'paint', rot=(0.4 if z > 0 else -0.4, ry, 0), bevel=0.001), 'head', 'mark2'))
    return out


def ghillie():
    """The camper's ghillie: a shaggy top over the shoulders, down the chest and a cape down the back, in jute strands."""
    f = S.Field()
    f.add(E, (0, 1.42, -0.02), (0.28, 0.11, 0.19))
    f.add(E, (0, 1.2, -0.13), (0.2, 0.28, 0.07), blend=0.06)
    f.add(E, (0, 1.24, 0.03), (0.19, 0.24, 0.132), blend=0.05)
    # The neck's opening, under the hood's hem.
    f.cut(E, (0, 1.5, -0.01), (0.085, 0.1, 0.085), blend=0.02)
    mantle = L.soft('ghillie-mantle', f, (-0.34, 0.9, -0.25), (0.34, 1.56, 0.22), 0.007, triangles=2200, finish='ghillie')
    out = [(mantle, 'chest', 'kit')]
    # Tufts of jute hanging off it, straw among the moss.
    tufts = ((-0.22, 1.33, -0.05), (0.21, 1.34, -0.07), (-0.12, 1.02, -0.17), (0.1, 0.98, -0.17), (0.0, 1.12, -0.19),
             (-0.13, 1.05, 0.15), (0.12, 1.02, 0.15), (0.0, 0.99, 0.16), (-0.2, 1.3, 0.09), (0.19, 1.31, 0.1))
    for i, (x, y, z) in enumerate(tufts):
        out.append((L.lathe(f'tuft{i}', [(0.0, 0.03), (0.12, 0.0)], (x, y, z), 'y', 5, 'ghillie', rot=(math.pi, 0, 0.2 * (i % 5 - 2))), 'chest', 'kit2' if i % 2 == 0 else 'kit'))
    for i in range(3):
        out.append((L.box(f'sniper-round{i}', (0.012, 0.045, 0.012), (0.075 + i * 0.022, 1.36, 0.17), 'metal', bevel=0.003), 'chest', 'gold'))
    return out


# The shield pivot at rest, in the body's space (render/figure.ts: torso + (-0.17, 0.34, 0.46)).
SHIELD = (-0.17, 1.24, 0.46)


def on_shield(pieces):
    """Shield pieces are drawn round the pivot; move them to where the pivot rests."""
    for o, _bone, _zone in pieces:
        o.data.transform(L.game_matrix(SHIELD))
        o.data.update()
    return pieces


def riot_shield(name='riot-shield'):
    """A ballistic riot shield on the shield pivot: a curved plate with a viewport, edge trim and handles behind."""
    return on_shield(_riot_shield(name))


# The flat look's shield outline (assets/models/build_tactical.py `riot-plate`, `riot-cap`), which stays its hit
# area: 1.3 m tall round the pivot, its top corners cut in from 0.34 up (0.46 to 0.40 each side), where the
# mask shows past it.
SHIELD_CUT = 0.34


def _shield_taper(v):
    y = (v - 0.5) * 1.3
    return 1.0 - 0.13 * max(0.0, y - SHIELD_CUT) / (0.65 - SHIELD_CUT)


def _riot_shield(name):
    out = [(L.curved_panel(name, 0.9, 1.3, 0.04, 1.4, 'polymer', centre=(0, 0.0, 0.05), cols=12, rows=8, taper=_shield_taper, bevel=0.01), 'shield', 'kit')]
    out.append((L.curved_panel('shield-viewport', 0.56, 0.12, 0.012, 1.4, 'lens', centre=(0, 0.42, 0.073), cols=8, rows=1, bevel=0.003), 'shield', 'lens'))
    lean = math.atan2(0.45 * 0.13, 0.65 - SHIELD_CUT)
    for s in (-1, 1):
        out.append((L.box(f'shield-edge{s}', (0.03, 1.0, 0.05), (s * 0.45, -0.15, 0.018), 'rubber', bevel=0.008), 'shield', 'rubber'))
        out.append((L.box(f'shield-edge-cut{s}', (0.03, 0.32, 0.05), (s * 0.42, (SHIELD_CUT + 0.65) / 2, 0.018), 'rubber', rot=(0, 0, s * lean), bevel=0.008), 'shield', 'rubber'))
        out.append((L.box(f'shield-handle{s}', (0.035, 0.18, 0.05), (s * 0.16, 0.06, -0.05), 'rubber', bevel=0.008), 'shield', 'rubber'))
    out.append((L.box('shield-top', (0.9 * 0.87, 0.03, 0.05), (0, 0.635, 0.02), 'rubber', bevel=0.008), 'shield', 'rubber'))
    out.append((L.box('shield-band', (0.84, 0.1, 0.008), (0, -0.14, 0.074), 'paint', bevel=0.002), 'shield', 'mark'))
    return out


def breacher():
    out = _riot_shield('breach-shield')
    for s in (-1, 1):
        out.append((L.box(f'breach-bumper{s}', (0.09, 1.0, 0.1), (s * 0.4, -0.1, 0.1), 'polymer', bevel=0.02), 'shield', 'kit2'))
    out.append((L.box('breach-ram', (0.76, 0.09, 0.12), (0, -0.44, 0.14), 'steel', bevel=0.012), 'shield', 'steel'))
    # Hazard stripes across the shield's face, above its band.
    for i in range(3):
        out.append((L.box(f'breach-stripe{i}', (0.07, 0.34, 0.006), (-0.2 + 0.2 * i, 0.16, 0.078), 'paint', rot=(0, 0, 0.6), bevel=0.001), 'shield', 'kit2'))
    out = on_shield(out)
    out += backpack('breach-charges', (0.3, 0.32, 0.14), (0, 1.24, -0.235), 'cordura', 'kit2')
    return out


def packleader():
    out = backpack('radio-pack', (0.26, 0.34, 0.13), (0, 1.26, -0.225), 'cordura', 'shirt')
    out.append((L.tube('horn-stem', (-0.12, 1.36, -0.22), (-0.2, 1.58, -0.17), 0.02, 8, 'metal'), 'chest', 'gold'))
    out.append((L.lathe('loudhailer', [(0.0, 0.028), (0.06, 0.035), (0.2, 0.1), (0.21, 0.1), (0.2, 0.09), (0.06, 0.02)], (-0.2, 1.58, -0.17), 'y', 20,
                        'metal', rot=(0.9, 0, 0.35), closed=True), 'chest', 'gold'))
    # The sash across the gold carrier (roster.py), dark over it.
    out.append((L.strap('leader-sash', [(-0.17, 1.44, 0.14), (-0.05, 1.33, 0.215), (0.06, 1.2, 0.215), (0.17, 1.07, 0.12)], 0.07, 0.008, 'canvas'), 'chest', 'kit'))
    return out


def smoker():
    out = []
    for s in (-1, 1):
        out.append((L.lathe(f'smoke-canister{s}', [(0.0, 0.0), (0.0, 0.07), (0.02, 0.075), (0.44, 0.075), (0.47, 0.05), (0.5, 0.02), (0.5, 0.0)],
                            (s * 0.11, 1.03, -0.2), 'y', 18, 'paint'), 'chest', 'kit'))
        out.append((L.ring(f'canister-band{s}', (s * 0.11, 1.26 + 0.0225, -0.2), (0.079, 0.079), 0.045, 0.006, 'y', 18, 'paint'), 'chest', 'mark2'))
        out.append((L.tube(f'smoke-nozzle{s}', (s * 0.11, 1.53, -0.2), (s * 0.19, 1.6, -0.16), 0.016, 8, 'metal'), 'chest', 'steel'))
    out.append((L.box('canister-frame', (0.32, 0.06, 0.03), (0, 1.24, -0.17), 'metal', bevel=0.006), 'chest', 'steel'))
    # Four smoke grenades racked across the chest, above the magazine pouches: pale bodies, dark caps and a white band.
    for i in range(4):
        x = (i - 1.5) * 0.058
        out.append((L.lathe(f'rack-smoke{i}', [(0.0, 0.0), (0.0, 0.025), (0.1, 0.025), (0.1, 0.0)], (x, 1.235, 0.222), 'y', 12, 'paint', closed=True), 'chest', 'kit'))
        out.append((L.lathe(f'rack-cap{i}', [(0.0, 0.0), (0.0, 0.02), (0.022, 0.017), (0.022, 0.0)], (x, 1.335, 0.222), 'y', 10, 'polymer', closed=True), 'chest', 'kit2'))
        out.append((L.ring(f'rack-band{i}', (x, 1.28 + 0.009, 0.222), (0.0265, 0.0265), 0.018, 0.003, 'y', 12, 'paint'), 'chest', 'mark2'))
    out.append((L.curved_panel('smoke-rack', 0.25, 0.05, 0.012, 0.34, 'webbing', centre=(0, 1.27, 0.198), cols=6, rows=1, bevel=0.002), 'chest', 'kit2'))
    return out


def rubberbander():
    out = []
    for s in (-1, 1):
        for i in range(3):
            y0 = 1.44 - i * 0.14
            fin = L.panel(f'glitch-fin{s}{i}', [(0.0, 0.0), (0.24 - i * 0.03, 0.14), (0.14, -0.03)], 0.018, 'polymer', bevel=0.004,
                          centre=(s * 0.14, y0, -0.2 - i * 0.03), rot=(0, 0 if s > 0 else math.pi, 0))
            out.append((fin, 'chest', 'kit'))
            out.append((L.box(f'fin-tip{s}{i}', (0.05, 0.016, 0.02), (s * (0.36 - i * 0.03), y0 + 0.14, -0.2 - i * 0.03), 'glow', bevel=0.003), 'chest', 'glow'))
    out += backpack('glitch-box', (0.22, 0.26, 0.1), (0, 1.26, -0.21), 'polymer', 'shirt')
    # A cyan plate over the carrier's chest with a glowing seam: the role's colour from the front too.
    out.append((L.curved_panel('glitch-plate', 0.25, 0.17, 0.014, 0.34, 'polymer', centre=(0, 1.3, 0.203), cols=8, rows=3, bevel=0.004), 'chest', 'kit'))
    out.append((L.box('glitch-seam', (0.2, 0.012, 0.006), (0, 1.27, 0.216), 'glow', bevel=0.002), 'chest', 'glow'))
    return out


def sapper():
    """The sapper's hazard carrier (roster.py) with black chevrons, the charge pack on its back, a tool."""
    out = backpack('charge-pack', (0.32, 0.34, 0.15), (0, 1.23, -0.24), 'cordura', 'kit')
    # Black hazard chevrons across the carrier's chest, above the magazine pouches, and on the pack.
    for i, x in enumerate((-0.085, 0.0, 0.085)):
        out.append((L.box(f'hazard-chevron{i}', (0.035, 0.13, 0.005), (x, 1.3, 0.2), 'paint', rot=(0, 0, 0.55), bevel=0.001), 'chest', 'kit2'))
        out.append((L.box(f'pack-chevron{i}', (0.035, 0.16, 0.005), (x, 1.26, -0.316), 'paint', rot=(0, 0, -0.55), bevel=0.001), 'chest', 'kit2'))
    for i in range(3):
        x = (i - 1) * 0.095
        out.append((L.box(f'packed-charge{i}', (0.08, 0.15, 0.06), (x, 1.24, -0.34), 'polymer', bevel=0.01), 'chest', 'rubber'))
        out.append((L.box(f'charge-light{i}', (0.018, 0.012, 0.006), (x, 1.28, -0.372), 'glow', bevel=0.002), 'chest', 'glow'))
    out.append((L.tube('tool-shaft', (0.2, 0.98, -0.2), (0.22, 1.56, -0.2), 0.016, 8, 'metal'), 'chest', 'steel'))
    out.append((L.box('tool-head', (0.11, 0.08, 0.04), (0.22, 1.58, -0.2), 'metal', bevel=0.006), 'chest', 'steel'))
    return out


def parry():
    out = [(L.panel('duelist-collar', [(-0.2, 0.0), (-0.15, 0.14), (0.0, 0.05), (0.15, 0.14), (0.2, 0.0), (0.0, -0.04)], 0.14, 'metal', bevel=0.006,
                    centre=(0, 1.46, 0.0)), 'chest', 'steel')]
    # A violet tabard over the carrier: the role's block of colour.
    out.append((L.curved_panel('tabard', 0.3, 0.5, 0.008, 0.4, 'canvas', centre=(0, 1.08, 0.19), cols=8, rows=5, taper=lambda v: 0.8 + 0.2 * v, bevel=0.002), 'torso', 'kit'))
    out.append((L.curved_panel('tabard-back', 0.3, 0.5, 0.008, 0.4, 'canvas', centre=(0, 1.1, -0.2), rot=(0, math.pi, 0), cols=8, rows=5, bevel=0.002), 'torso', 'kit'))
    out.append((L.curved_panel('parry-bracer', 0.1, 0.2, 0.01, 0.05, 'metal', centre=(-0.26, 0.93, 0.05), cols=6, rows=3, bevel=0.003), 'foreL', 'steel'))
    out.append((L.lathe('guard-basket', [(0.0, 0.0), (0.0, 0.07), (0.035, 0.075), (0.05, 0.06)], (0.26, 0.77, 0.04), 'y', 16, 'metal', rot=(math.pi, 0, 0)), 'foreR', 'steel'))
    return out


def aimbot():
    out = backpack('targeting-computer', (0.3, 0.36, 0.16), (0, 1.27, -0.24), 'polymer', 'kit')
    out.append((L.tube('scope-boom', (0.16, 1.4, -0.16), (0.24, 1.66, 0.06), 0.022, 8, 'metal'), 'chest', 'steel'))
    out.append((L.tube('scope-body', (0.24, 1.66, -0.02), (0.24, 1.66, 0.2), 0.042, 16, 'polymer'), 'chest', 'kit'))
    out.append((L.lathe('scope-lens', [(0.0, 0.036), (0.008, 0.0)], (0.24, 1.66, 0.2), 'z', 16, 'glow'), 'chest', 'glow'))
    return out


def aimbot_vent():
    """The vent over the targeting computer, which opens (`aimbot-vent`, enemies/model.ts): its own bone."""
    out = []
    for i in range(5):
        out.append((L.box(f'cooling-vent{i}', (0.3, 0.018, 0.1), (0, 1.12 + i * 0.05, -0.34), 'polymer', bevel=0.004), 'aimbot-vent', 'rubber'))
    return out


def ragequit():
    out = []
    for s, side in ((-1, 'L'), (1, 'R')):
        out.append((L.box(f'rage-pauldron{side}', (0.2, 0.13, 0.2), (s * 0.27, 1.43, 0.0), 'steel', rot=(0, 0, -s * 0.3), bevel=0.02), f'upper{side}', 'kit'))
        for i in range(2):
            out.append((L.lathe(f'rage-spike{side}{i}', [(0.0, 0.03), (0.14, 0.0)], (s * 0.3, 1.47, -0.05 + i * 0.1), 'y', 6, 'metal', rot=(0, 0, -s * 0.5)), f'upper{side}', 'steel'))
    return out


def rage_cleaver():
    """The ragequit's cleaver on its forearm (`heavy-melee`): a weapon, not armour."""
    # Where the flat look's cleaver is (build_tactical.py): 0.43-1.23 m down the forearm (at 1.06 m), its edge out to +x.
    out = [(L.box('cleaver-spine', (0.07, 0.8, 0.07), (0.26, 0.25, 0.07), 'steel', bevel=0.012), 'heavy-melee', 'steel')]
    out.append((L.panel('cleaver-edge', [(-0.055, 0.63), (0.18, 0.63), (0.23, -0.12), (-0.055, -0.17)], 0.05, 'metal', bevel=0.006,
                        centre=(0.26, 0.0, 0.1)), 'heavy-melee', 'steel'))
    out.append((L.box('cleaver-inlay', (0.04, 0.5, 0.01), (0.3, 0.25, 0.128), 'paint', bevel=0.002), 'heavy-melee', 'mark'))
    return out


def juggernaut():
    """Bulky ballistic armour over the heavy's frame: a deep chest plate, a gorget, pauldrons, thigh and shin plates."""
    out = [(L.curved_panel('jug-chest', 0.36, 0.36, 0.05, 0.3, 'polymer', centre=(0, 1.26, 0.2), cols=10, rows=5, bevel=0.012), 'chest', 'kit')]
    out.append((L.curved_panel('jug-belly', 0.3, 0.16, 0.04, 0.3, 'polymer', centre=(0, 1.04, 0.17), cols=8, rows=2, bevel=0.01), 'torso', 'kit'))
    out.append((L.lathe('jug-gorget', [(0.0, 0.1), (0.07, 0.085), (0.075, 0.075)], (0, 1.47, -0.005), 'y', 20, 'polymer', scale=(1.1, 1.0)), 'chest', 'kit'))
    for s, side in ((-1, 'L'), (1, 'R')):
        out.append((L.box(f'jug-pauldron{side}', (0.16, 0.14, 0.2), (s * 0.27, 1.41, 0.0), 'polymer', rot=(0, 0, -s * 0.35), bevel=0.03), f'upper{side}', 'kit'))
        out.append((L.curved_panel(f'jug-thigh{side}', 0.14, 0.2, 0.03, 0.1, 'polymer', centre=(s * 0.13, 0.66, 0.08), cols=6, rows=3, bevel=0.008), f'thigh{side}', 'kit'))
        out.append((L.curved_panel(f'jug-shin{side}', 0.11, 0.2, 0.025, 0.07, 'polymer', centre=(s * 0.13, 0.28, 0.06), cols=6, rows=3, bevel=0.008), f'shin{side}', 'kit'))
        out.append((L.curved_panel(f'jug-forearm{side}', 0.09, 0.16, 0.02, 0.05, 'polymer', centre=(s * 0.26, 0.93, 0.045), cols=6, rows=3, bevel=0.006), f'fore{side}', 'kit'))
    # Hazard chevrons on the chest plate.
    for i, x in enumerate((-0.11, 0.11)):
        out.append((L.box(f'jug-hazard{i}', (0.05, 0.12, 0.006), (x, 1.3, 0.254), 'paint', rot=(0, 0, 0.5 if x < 0 else -0.5), bevel=0.001), 'chest', 'mark'))
    return out


def admin():
    """The Admin's command coat skirts, epaulettes and collar."""
    out = []
    for s, side in ((-1, 'L'), (1, 'R')):
        out.append((L.curved_panel(f'coat-skirt{side}', 0.2, 0.44, 0.012, 0.2, 'canvas', centre=(s * 0.1, 0.78, -0.08), rot=(0, math.pi + s * 0.45, 0), cols=6, rows=5, bevel=0.003), f'thigh{side}', 'kit'))
        out.append((L.curved_panel(f'coat-front{side}', 0.14, 0.44, 0.012, 0.25, 'canvas', centre=(s * 0.1, 0.78, 0.1), rot=(0, s * 0.3, 0), cols=5, rows=5, bevel=0.003), f'thigh{side}', 'kit'))
        out.append((L.box(f'epaulette{side}', (0.14, 0.03, 0.12), (s * 0.25, 1.46, 0.0), 'metal', bevel=0.008), f'upper{side}', 'gold'))
        for i in range(4):
            out.append((L.tube(f'fringe{side}{i}', (s * 0.3, 1.45, -0.04 + i * 0.027), (s * 0.31, 1.39, -0.04 + i * 0.027), 0.005, 5, 'metal'), f'upper{side}', 'gold'))
    out.append((L.panel('command-collar', [(-0.12, 0.0), (-0.12, 0.1), (-0.06, 0.07), (0.06, 0.07), (0.12, 0.1), (0.12, 0.0)], 0.16, 'polymer', bevel=0.006,
                        centre=(0, 1.47, 0.0)), 'chest', 'kit'))
    out.append((L.curved_panel('coat-chest', 0.34, 0.4, 0.014, 0.35, 'canvas', centre=(0, 1.23, 0.17), cols=8, rows=5, bevel=0.003), 'chest', 'kit'))
    for i in range(3):
        out.append((L.box(f'coat-button{i}', (0.018, 0.018, 0.008), (0.06, 1.12 + i * 0.09, 0.19), 'metal', bevel=0.003), 'chest', 'gold'))
    return out


def rusher():
    """The rusher's light kit: a chest rig instead of plates, knife sheaths."""
    out = []
    out.append((L.curved_panel('chest-rig', 0.24, 0.13, 0.03, 0.3, 'cordura', centre=(0, 1.15, 0.13), cols=8, rows=2, bevel=0.008), 'torso', 'vest'))
    for i in range(2):
        out.append((L.box(f'rig-pouch{i}', (0.065, 0.09, 0.04), ((i - 0.5) * 0.08, 1.15, 0.165), 'cordura', bevel=0.008), 'torso', 'vest'))
    for s in (-1, 1):
        out.append((L.strap(f'rig-strap{s}', [(s * 0.1, 1.2, 0.13), (s * 0.12, 1.45, 0.07), (s * 0.1, 1.48, -0.05), (-s * 0.05, 1.3, -0.14), (-s * 0.15, 1.16, -0.1)],
                            0.035, 0.008, 'webbing'), 'chest', 'vest'))
        side = 'LR'[s > 0]
        out.append((L.box(f'knife-sheath{side}', (0.03, 0.16, 0.045), (s * 0.19, 0.6, 0.05), 'polymer', bevel=0.008), f'thigh{side}', 'rubber'))
    return out


def sentry():
    """The sentry: a mechanical frame on the humanoid pivots (yoke, power block, armoured limbs, outrigger feet)."""
    out = [(L.box('sentry-yoke', (0.5, 0.16, 0.26), (0, 1.37, -0.02), 'steel', bevel=0.02), 'chest', 'kit')]
    out.append((L.box('sentry-core', (0.32, 0.36, 0.22), (0, 1.14, 0.0), 'steel', bevel=0.03), 'torso', 'kit2'))
    out.append((L.box('sentry-power', (0.3, 0.28, 0.16), (0, 1.2, -0.19), 'steel', bevel=0.02), 'chest', 'kit2'))
    out.append((L.box('sentry-pelvis', (0.3, 0.14, 0.2), (0, 0.9, 0.0), 'steel', bevel=0.02), 'hips', 'kit2'))
    out.append((L.lathe('sentry-neck', [(0.0, 0.05), (0.1, 0.045)], (0, 1.47, 0.0), 'y', 12, 'metal'), 'chest', 'steel'))
    out.append((L.box('sentry-head', (0.19, 0.2, 0.18), (0, 1.66, -0.01), 'steel', bevel=0.03), 'head', 'kit'))
    for s, side in ((-1, 'L'), (1, 'R')):
        x = s * 0.26
        out.append((L.box(f'sentry-shoulder{side}', (0.14, 0.12, 0.16), (x, 1.36, 0.0), 'steel', bevel=0.02), f'upper{side}', 'kit'))
        out.append((L.box(f'sentry-arm{side}', (0.09, 0.26, 0.1), (x, 1.2, 0.0), 'steel', bevel=0.015), f'upper{side}', 'kit2'))
        out.append((L.box(f'sentry-forearm{side}', (0.08, 0.26, 0.09), (x, 0.93, 0.01), 'steel', bevel=0.015), f'fore{side}', 'kit'))
        out.append((L.box(f'sentry-gripper{side}', (0.07, 0.08, 0.08), (x, 0.77, 0.03), 'metal', bevel=0.01), f'fore{side}', 'steel'))
        lx = s * 0.13
        out.append((L.box(f'sentry-thigh{side}', (0.12, 0.34, 0.13), (lx, 0.64, 0.0), 'steel', bevel=0.02), f'thigh{side}', 'kit'))
        out.append((L.tube(f'sentry-piston{side}', (lx + s * 0.07, 0.8, -0.02), (lx + s * 0.07, 0.48, -0.02), 0.014, 8, 'metal'), f'thigh{side}', 'steel'))
        out.append((L.box(f'sentry-shin{side}', (0.1, 0.3, 0.11), (lx, 0.26, 0.0), 'steel', bevel=0.02), f'shin{side}', 'kit2'))
        out.append((L.lathe(f'sentry-knee{side}', [(-0.07, 0.05), (0.07, 0.05)], (lx, 0.42, 0.0), 'x', 14, 'metal'), f'shin{side}', 'steel'))
        out.append((L.lathe(f'sentry-elbow{side}', [(-0.055, 0.042), (0.055, 0.042)], (x, 1.06, 0.0), 'x', 14, 'metal'), f'fore{side}', 'steel'))
        out.append((L.lathe(f'sentry-ankle{side}', [(-0.05, 0.035), (0.05, 0.035)], (lx, 0.08, 0.0), 'x', 12, 'metal'), f'foot{side}', 'steel'))
        out.append((L.box(f'sentry-foot{side}', (0.26, 0.05, 0.3), (lx + s * 0.05, 0.03, 0.03), 'rubber', bevel=0.012), f'foot{side}', 'rubber'))
        out.append((L.tube(f'sentry-aerial{side}', (s * 0.2, 1.3, -0.2), (s * 0.2, 1.72, -0.22), 0.007, 6, 'metal'), 'chest', 'steel'))
    for s in (-1, 1):
        out.append((L.box(f'sentry-stripe{s}', (0.12, 0.03, 0.006), (s * 0.08, 1.26, 0.113), 'paint', bevel=0.001), 'torso', 'mark'))
    return out

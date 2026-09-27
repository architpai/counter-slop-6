"""
The operators' clips (docs/VISUALS.md, R7), keyed in Blender on two clip
rigs: `humanoid` (the operator's bones) and `machine` (the walkers'). A
key is a bone's rotation from its rest, in the game's axes, which the game
composes onto the pivot's own procedural pose (render/operator-motion.ts):
so the clips add what the procedural layer has not got (breathing, the
hips' and shoulders' counter-turn, heel-and-toe, the support hand's
reload, a recoil, a hit's jolt, a throw) and never move a hit area.

Conventions, from enemies/model.ts: a negative x on a thigh swings it
forward, a positive x on a shin bends the knee, a negative x on an upper
arm raises it forward, a positive x on the torso leans it forward, a
positive x on a foot points the toe down.

Loops (`walk`, `run`, `strafeL`, `strafeR`) span one stride cycle: the
game plays them at the procedural phase, so a stride is exactly as long as
the legs' swing and the feet do not slide. `crouch` and `aim` are poses,
held at a weight; the rest play once when triggered.
"""

import core as L

C = L.Clip


def humanoid():
    clips = []
    idle = C('humanoid', 'idle', 3.0, loop=True)
    for bone, k in (('chest', (-0.028, 0, 0)), ('head', (0.018, 0.02, 0)), ('shoulderL', (0, 0, -0.018)), ('shoulderR', (0, 0, 0.018)),
                    ('upperL', (0, 0, -0.02)), ('upperR', (0, 0, 0.02)), ('hips', (0, 0, 0.012)), ('torso', (0, 0, -0.012))):
        idle.key(bone, 0.0).key(bone, 1.4, k).key(bone, 3.0)
    idle.key('head', 2.2, (0.01, -0.03, 0))
    clips.append(idle)

    def stride(name, twist, lean, toe, heel, arm, bounce):
        c = C('humanoid', name, 1.0, loop=True)
        # t 0.75: the left leg at its most forward (heel strike), 0.25: at its most back (toe-off).
        for t, sign in ((0.25, -1), (0.75, 1)):
            c.key('hips', t, (0, 0.8 * twist * sign, 0))
            c.key('torso', t, (lean, 0.35 * twist * sign, 0))
            c.key('chest', t, (0, -1.25 * twist * sign, 0))
            c.key('head', t, (-lean * 0.8, 0.8 * twist * sign, 0))
        for t, sign in ((0.0, 1), (0.5, -1)):
            c.key('hips', t, (0, 0, 0.03 * sign))
            c.key('torso', t, (lean + bounce, 0, -0.02 * sign))
            c.key('chest', t, (0, 0, 0))
            c.key('head', t, (-lean * 0.8, 0, 0))
        for side, shift in (('L', 0.0), ('R', 0.5)):
            keys = [(0.75, -heel), (0.0, 0.0), (0.25, toe), (0.5, -0.12)]
            for t, x in keys:
                c.key(f'foot{side}', (t + shift) % 1.0, (x, 0, 0))
            for t, x in ((0.75, -arm), (0.25, -arm * 0.3), (0.0, -arm * 0.6), (0.5, -arm * 0.6)):
                c.key(f'fore{side}', (t + shift) % 1.0, (x, 0, 0))
        for bone in ('hips', 'torso', 'chest', 'head', 'footL', 'footR', 'foreL', 'foreR'):
            first = next(k for k in sorted(c.keys[bone]) if k[0] == 0.0)
            c.key(bone, 1.0, first[1])
        return c

    clips.append(stride('walk', 0.07, 0.03, 0.35, 0.25, 0.25, 0.02))
    clips.append(stride('run', 0.14, 0.14, 0.5, 0.3, 0.8, 0.04))

    for name, sign in (('strafeL', -1), ('strafeR', 1)):
        c = C('humanoid', name, 1.0, loop=True)
        # The hips open towards the step and the chest turns back to keep the eyes on the target.
        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
            open_ = 0.32 + (0.05 if t in (0.25, 0.75) else 0.0)
            c.key('hips', t, (0, sign * open_, 0))
            c.key('torso', t, (0.04, -sign * open_ * 0.45, 0))
            c.key('chest', t, (0, -sign * open_ * 0.45, 0))
            c.key('head', t, (0, -sign * 0.05, 0))
        for side, shift in (('L', 0.0), ('R', 0.5)):
            s = -1 if side == 'L' else 1
            c.key(f'thigh{side}', (0.25 + shift) % 1.0, (0, 0, s * 0.14))
            c.key(f'thigh{side}', (0.75 + shift) % 1.0, (0, 0, -s * 0.06))
            c.key(f'foot{side}', (0.25 + shift) % 1.0, (0.2, 0, 0))
            c.key(f'foot{side}', (0.75 + shift) % 1.0, (-0.1, 0, 0))
        clips.append(c)

    crouch = C('humanoid', 'crouch', 1.0, loop=True)
    for t in (0.0, 1.0):
        for bone, k in (('thighL', (-0.98, 0, -0.08)), ('thighR', (-0.98, 0, 0.08)), ('shinL', (1.96, 0, 0)), ('shinR', (1.96, 0, 0)),
                        ('footL', (-0.95, 0, 0)), ('footR', (-0.95, 0, 0)), ('torso', (0.3, 0, 0)), ('chest', (0.06, 0, 0)), ('head', (-0.3, 0, 0))):
            crouch.key(bone, t, k)
    clips.append(crouch)

    aim = C('humanoid', 'aim', 1.0, loop=True)
    for t in (0.0, 1.0):
        # A cheek weld: the head tilts to the stock, the chest squares up behind the gun.
        for bone, k in (('head', (0.1, 0.05, 0.1)), ('chest', (0.02, -0.08, 0)), ('shoulderR', (0, 0, 0.04)), ('torso', (0.04, 0, 0))):
            aim.key(bone, t, k)
    clips.append(aim)

    fire = C('humanoid', 'fire', 0.2)
    fire.key('upperR', 0.04, (0.07, 0, 0)).key('foreR', 0.04, (-0.05, 0, 0)).key('chest', 0.05, (-0.04, 0, 0)).key('head', 0.06, (-0.03, 0, 0))
    fire.key('upperL', 0.05, (0.04, 0, 0))
    clips.append(fire)

    reload = C('humanoid', 'reload', 1.6)
    # Cant the gun, strip the magazine, fetch one from the carrier, seat it, slap the bolt.
    for t, k in ((0.2, (0.2, 0, 0.35)), (1.3, (0.2, 0, 0.35))):
        reload.key('foreR', t, k)
    reload.key('upperR', 0.2, (0.22, 0, 0)).key('upperR', 1.3, (0.22, 0, 0))
    for t, up, fore in ((0.25, (0.5, 0, 0), (-0.4, 0, 0)), (0.55, (1.05, 0, -0.1), (-1.5, 0, 0)), (0.85, (0.55, 0, 0), (-0.5, 0, 0)),
                        (1.05, (0.4, 0, 0), (-0.3, 0, 0)), (1.2, (0.2, 0.2, 0), (-0.6, 0, 0))):
        reload.key('upperL', t, up).key('foreL', t, fore)
    reload.key('head', 0.3, (0.3, 0.1, 0)).key('head', 0.6, (0.35, -0.2, 0)).key('head', 1.1, (0.3, 0.1, 0)).key('head', 1.45, (0.05, 0, 0))
    reload.key('chest', 0.3, (0.06, 0.05, 0)).key('chest', 1.2, (0.06, 0.05, 0))
    clips.append(reload)

    melee = C('humanoid', 'melee', 0.55)
    melee.key('torso', 0.2, (-0.05, -0.4, 0)).key('torso', 0.4, (0.15, 0.5, 0)).key('chest', 0.2, (0, -0.2, 0)).key('chest', 0.4, (0.1, 0.3, 0))
    melee.key('thighL', 0.18, (-0.1, 0, 0)).key('thighL', 0.4, (-0.4, 0, 0)).key('shinL', 0.4, (0.35, 0, 0))
    melee.key('head', 0.2, (0, 0.3, 0)).key('head', 0.4, (0.05, -0.35, 0)).key('upperL', 0.2, (-0.5, 0, -0.3)).key('upperL', 0.4, (0.3, 0, -0.2))
    clips.append(melee)

    hit = C('humanoid', 'hit', 0.35)
    hit.key('head', 0.06, (-0.3, 0.15, 0.1)).key('chest', 0.06, (-0.14, 0.18, 0)).key('torso', 0.08, (-0.06, 0, 0))
    hit.key('upperL', 0.07, (-0.3, 0, -0.15)).key('shoulderL', 0.06, (0, 0, -0.05)).key('shoulderR', 0.06, (0, 0, 0.05))
    hit.key('head', 0.2, (0.05, -0.04, 0))
    clips.append(hit)

    throw = C('humanoid', 'throw', 0.8)
    throw.key('upperR', 0.35, (-2.6, 0, 0.2)).key('upperR', 0.55, (0.3, 0, 0)).key('foreR', 0.35, (-1.2, 0, 0)).key('foreR', 0.55, (-0.1, 0, 0))
    throw.key('chest', 0.35, (-0.1, 0.35, 0)).key('chest', 0.55, (0.12, -0.3, 0)).key('thighL', 0.35, (0.1, 0, 0)).key('thighL', 0.55, (-0.3, 0, 0))
    throw.key('upperL', 0.35, (-1.2, 0.3, 0)).key('upperL', 0.55, (0.1, 0, 0)).key('head', 0.35, (-0.1, -0.1, 0))
    clips.append(throw)
    return clips


def machine():
    clips = []
    idle = C('machine', 'idle', 2.0, loop=True)
    for bone, k in (('torso', (0.02, 0, 0.015)), ('upperL', (0, 0, -0.05)), ('upperR', (0, 0, 0.05)), ('foreL', (-0.1, 0, 0)), ('foreR', (-0.1, 0, 0))):
        idle.key(bone, 0.0).key(bone, 1.0, k).key(bone, 2.0)
    clips.append(idle)
    walk = C('machine', 'walk', 1.0, loop=True)
    for t, sign in ((0.0, 1), (0.5, -1), (1.0, 1)):
        walk.key('torso', t, (0.04, 0.05 * sign, 0.04 * sign)).key('hips', t, (0, -0.04 * sign, 0))
        walk.key('foreL', t, (-0.3 - 0.15 * sign, 0, 0)).key('foreR', t, (-0.3 + 0.15 * sign, 0, 0))
    clips.append(walk)
    return clips

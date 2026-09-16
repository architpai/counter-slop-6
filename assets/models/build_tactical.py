"""Build the tactical cast. Run: blender -b --python assets/models/build_tactical.py

Coordinates below are game coordinates: +Y up, +Z forward, metres.
Rigid garment/armour pieces use the game's existing joint pivots. No skinning.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tactical.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.materials):
    for item in list(datablocks):
        if item.users == 0:
            datablocks.remove(item)


def xyz(p):
    return (p[0], -p[2], p[1])


def material(name, color, roughness=0.8, metal=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    return m


M = {
    'navy': material('navy-ripstop', (0.065, 0.095, 0.13)),
    'cloth': material('charcoal-fabric', (0.105, 0.115, 0.115)),
    'pants': material('slate-trousers', (0.17, 0.19, 0.19)),
    'armor': material('graphite-ceramic', (0.095, 0.12, 0.135), 0.52),
    'edge': material('armor-edge', (0.22, 0.255, 0.265), 0.55),
    'web': material('olive-webbing', (0.21, 0.225, 0.17)),
    'rubber': material('black-rubber', (0.027, 0.034, 0.038), 0.92),
    'steel': material('gunmetal-hardware', (0.3, 0.34, 0.36), 0.4, 0.55),
    'ivory': material('mask-ivory', (0.76, 0.70, 0.56), 0.63),
    'ink': material('mask-ink', (0.012, 0.015, 0.019), 0.8),
    'red': material('enemy-mark', (0.48, 0.038, 0.055), 0.7),
    'blue': material('player-mark', (0.075, 0.24, 0.65), 0.7),
    'glass': material('smoked-lens', (0.055, 0.11, 0.135), 0.2, 0.25),
    'sand': material('sniper-canvas', (0.25, 0.27, 0.22)),
    'gold': material('command-brass', (0.42, 0.28, 0.10), 0.42, 0.45),
    'hazard': material('hazard-ochre', (0.63, 0.32, 0.045), 0.7),
    'signal': material('signal-violet', (0.24, 0.14, 0.34), 0.6),
    'led': material('arming-light', (0.95, 0.12, 0.02), 0.4),
}
M['led'].node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1, .08, .01, 1)
M['led'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 2
kind = ''


def name(label):
    return f'{kind}__{label}'


def empty(label, parent=None, pos=(0, 0, 0)):
    obj = bpy.data.objects.new(name(label), None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = xyz(pos)
    return obj


def finish(obj, label, parent, mat):
    obj.name = name(label)
    obj.data.materials.clear()
    obj.data.materials.append(M[mat])
    obj.parent = parent
    return obj


def bevel(obj, width=0.012):
    if width:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = width
        mod.segments = 1
        mod = obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    return obj


def box(parent, label, size, pos, mat, edge=0.009):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = xyz(pos)
    finish(obj, label, parent, mat)
    return bevel(obj, edge)


def oval(parent, label, size, pos, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1)
    obj = bpy.context.object
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.location = xyz(pos)
    finish(obj, label, parent, mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def poly(parent, label, vertices, faces, mat, edge=0):
    mesh = bpy.data.meshes.new(name(label))
    mesh.from_pydata([xyz(p) for p in vertices], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name(label), mesh)
    bpy.context.collection.objects.link(obj)
    finish(obj, label, parent, mat)
    # Recalculate outward normals after constructing rings/panels.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    return bevel(obj, edge)


def rings(parent, label, rows, mat, edge=0.007):
    """Tailored octagonal cross sections: (height, half-width, half-depth, centre-z)."""
    outline = [(-.72, -1), (.72, -1), (1, -.65), (1, .65), (.72, 1), (-.72, 1), (-1, .65), (-1, -.65)]
    vertices = [(x * w, y, z * d + c) for y, w, d, c in rows for x, z in outline]
    faces = [tuple(reversed(range(8)))]
    for j in range(len(rows) - 1):
        for i in range(8):
            a = j * 8 + i
            b = j * 8 + (i + 1) % 8
            faces.append((a, b, b + 8, a + 8))
    faces.append(tuple(range((len(rows) - 1) * 8, len(rows) * 8)))
    return poly(parent, label, vertices, faces, mat, edge)


def plate(parent, label, outline, front, depth, mat):
    n = len(outline)
    vertices = [(x, y, z) for z in [front - depth, front] for x, y in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, n * 2))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return poly(parent, label, vertices, faces, mat, 0.006)


def mask(parent, heavy):
    face = empty(f'clown-mask-{kind}', parent)
    def depth(x, y):
        t = (y + .042) / .365
        w = .103 + .063 * math.sin(t * math.pi * .9)
        d = .093 + .024 * math.sin(t * math.pi)
        return .067 + d * math.sqrt(max(0, 1 - (x / w) ** 2))

    def paint(label, outline, mat, lift=.004):
        return poly(face, label, [(x, y, depth(x, y) + lift) for x, y in outline], [tuple(range(len(outline)))], mat)

    # Sculpted shell: a narrow jaw, cheek bones, brow and forehead. Cut clean
    # eye openings through the shell, with dark inset sockets behind them.
    verts, faces = [], []
    rows, cols = 28, 32
    for j in range(rows + 1):
        t = j / rows
        y = -.042 + t * .365
        w = .103 + .063 * math.sin(t * math.pi * .9)
        d = .093 + .024 * math.sin(t * math.pi)
        for i in range(cols + 1):
            a = -math.pi / 2 + i / cols * math.pi
            verts.append((w * math.sin(a), y, .067 + d * math.cos(a)))
    for j in range(rows):
        for i in range(cols):
            a = j * (cols + 1) + i
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    shell = poly(face, 'mask-shell', verts, faces, 'ivory')
    solid = shell.modifiers.new('Mask shell thickness', 'SOLIDIFY')
    solid.thickness = .008
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.modifier_apply(modifier=solid.name)
    for sign in [-1, 1]:
        cutter = oval(face, 'eye-cutter', (.043, .025, .13), (sign*.069, .205, .16), 'ink')
        bpy.context.view_layer.objects.active = shell
        mod = shell.modifiers.new('Recessed eye opening', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    for p in shell.data.polygons:
        p.use_smooth = True
    for sign in [-1, 1]:
        oval(face, 'recessed-eye', (.053, .034, .016), (sign * .069, .204, .137), 'ink')
        paint('painted-brow', [(sign*.024, .25), (sign*.111, .275), (sign*.114, .264), (sign*.026, .238)], 'red' if not heavy else 'ink')
        paint('cheek-paint', [(sign * .092, .175), (sign * .059, .175), (sign * .098, .106)], 'red')
        oval(face, 'strap-rivet', (.008, .008, .005), (sign * .145, .15, .117), 'steel')
    # Angular red nose: no round toy ball.
    poly(face, 'clown-nose', [(-.026, .156, .188), (.026, .156, .188), (.021, .104, .187), (-.021, .104, .187), (0, .124, .229)],
         [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], 'red', .003)
    paint('painted-grin', [(-.097, .084), (-.045, .055), (0, .045), (.045, .055), (.097, .084), (.074, .031), (0, .006), (-.074, .031)], 'red')
    paint('cut-grin', [(-.084, .069), (-.041, .046), (0, .036), (.041, .046), (.084, .069), (.065, .035), (0, .016), (-.065, .035)], 'ink', .006)
    for i in range(-3, 4):
        x, y = i * .018, .035 + abs(i) * .004
        box(face, 'grin-tooth', (.012, .01, .005), (x, y, depth(x, y) + .008), 'ivory', .002)
    if heavy:
        plate(face, 'reinforced-jaw', [(-.14, .075), (-.115, -.043), (.115, -.043), (.14, .075), (.109, .077), (.082, -.01), (-.082, -.01), (-.109, .077)], .162, .025, 'edge')
        box(face, 'forehead-red-stripe', (.021, .057, .007), (0, .288, .145), 'red', .002)
    if kind == 'rusher':
        for sign in [-1, 1]:
            paint('rusher-eye-diamond', [(sign*.067, .292), (sign*.101, .21), (sign*.064, .10), (sign*.038, .21)], 'ink', .008)
        face.scale.x = .94
    elif kind == 'sniper':
        for sign in [-1, 1]:
            paint('long-tear', [(sign*.055, .17), (sign*.074, .17), (sign*.066, .051)], 'ink', .008)
        box(face, 'rangefinder', (.055, .032, .026), (.10, .253, .15), 'glass', .006)
    elif kind == 'shield':
        paint('split-mask', [(0, -.035), (.09, .012), (.13, .18), (.12, .30), (0, .319)], 'armor', .008)
        box(face, 'riot-brow', (.28, .023, .02), (0, .271, .177), 'steel')
    elif kind == 'boss':
        for sign in [-1, 1]:
            plate(face, 'command-cheek', [(sign*.103, .13), (sign*.151, .17), (sign*.12, .028), (sign*.09, .013)], .158, .015, 'gold')
        paint('command-forehead', [(-.018, .265), (0, .315), (.018, .265), (0, .239)], 'gold', .009)
    elif kind == 'bomber':
        for sign in [-1, 1]:
            box(face, 'mask-filter', (.056, .055, .055), (sign*.129, .068, .139), 'rubber', .012)
        paint('bomber-warning', [(-.017, .266), (0, .309), (.017, .266)], 'hazard', .008)
    elif kind == 'flyer':
        face.scale.y = .82
        for sign in [-1, 1]:
            plate(face, 'sensor-wing', [(sign*.119, .20), (sign*.20, .24), (sign*.14, .10)], .106, .018, 'edge')
    elif kind == 'hitbox':
        box(face, 'breach-brow', (.34, .035, .034), (0, .279, .159), 'steel')
        for sign in [-1, 1]:
            box(face, 'mask-bolt', (.016, .016, .018), (sign*.124, .264, .182), 'hazard', .004)
    elif kind == 'lagspike':
        for sign in [-1, 1]:
            plate(face, 'jagged-mask-edge', [(sign*.126, .06), (sign*.20, .13), (sign*.14, .16), (sign*.20, .26), (sign*.116, .25)], .116, .018, 'signal')
    return face


def build_character(which):
    global kind
    kind = which
    heavy = kind in ('heavy', 'boss')
    player = kind == 'player'
    width = {'heavy': 1.55, 'rusher': .82, 'sniper': .78, 'shield': 1.2, 'boss': 1.35}.get(kind, 1)
    w = {'heavy': 1.4, 'boss': 1.25}.get(kind, width)
    cloth = 'navy' if player else 'sand' if kind == 'sniper' else 'cloth'
    mark = 'blue' if player else 'gold' if kind == 'boss' else 'red'
    root = empty(kind)
    pivots = {}
    surfaces = {}

    def joint(label, parent, pos):
        pivot = empty(label, parent, pos)
        pivots[label] = pivot
        surfaces[label] = empty(f'{label}-surface', pivot)
        return pivot

    hips = joint('hips', root, (0, .86, 0))
    torso = joint('torso', hips, (0, .04, 0))
    head = joint('head', torso, (0, .62, 0))
    for sign, side in [(-1, 'L'), (1, 'R')]:
        shoulder = empty(f'shoulder{side}', torso, (sign * .26 * width, .46, 0))
        upper = joint(f'upper{side}', shoulder, (0, 0, 0))
        joint(f'fore{side}', upper, (0, -.3, 0))
        thigh = joint(f'thigh{side}', hips, (sign * .13 * width, -.02, 0))
        joint(f'shin{side}', thigh, (0, -.42, 0))

    p = surfaces['hips']
    rings(p, 'trouser-seat', [(-.08, .19*w, .115, 0), (.07, .21*w, .13, 0)], 'pants')
    box(p, 'utility-belt', (.43*w, .07, .265), (0, .06, 0), 'rubber')
    box(p, 'belt-buckle', (.06, .045, .022), (0, .065, .149), 'steel', .004)
    for sign in [-1, 1]:
        box(p, 'belt-pouch', (.105, .12, .09), (sign * .185*w, .015, .158), 'web')

    p = surfaces['torso']
    rings(p, 'tailored-jacket', [(.045, .19*w, .12, 0), (.16, .22*w, .145, 0), (.39, .27*w, .15, -.008), (.51, .24*w, .123, 0)], cloth)
    rings(p, 'collar', [(.47, .101, .088, 0), (.58, .085, .078, 0)], 'rubber')
    outline = [(-.19*w, .105), (.19*w, .105), (.215*w, .34), (.135*w, .465), (-.135*w, .465), (-.215*w, .34)]
    plate(p, 'plate-carrier', outline, .178 if not heavy else .204, .055, 'armor')
    box(p, 'back-plate', (.35*w, .33, .07), (0, .28, -.157), 'armor', .018)
    for sign in [-1, 1]:
        box(p, 'shoulder-webbing', (.061, .12, .27), (sign * .16*w, .465, 0), 'web')
        box(p, 'shoulder-buckle', (.048, .024, .017), (sign * .16*w, .443, .164), 'steel', .003)
    for i in range(3):
        box(p, 'magazine-pouch', (.095*w, .137, .056), ((i - 1) * .112*w, .178, .223 if heavy else .195), 'web')
        box(p, 'pouch-flap', (.098*w, .03, .01), ((i - 1) * .112*w, .236, .257 if heavy else .23), 'edge', .003)
    box(p, 'identity-panel', (.132, .037, .009), (-.043, .384, .239 if heavy else .181), mark, .003)
    for i in range(3):
        box(p, 'identity-tick', (.011, .022, .004), (-.073 + i*.025, .384, .246 if heavy else .188), 'ivory', .001)
    box(p, 'radio', (.063, .093, .034), (.142*w, .353, .205), 'rubber')
    box(p, 'radio-antenna', (.009, .113, .009), (.147*w, .452, .205), 'rubber', .003)
    if heavy:
        plate(p, 'upper-breastplate', [(-.245, .30), (.245, .30), (.20, .447), (-.20, .447)], .235, .026, 'edge')
        box(p, 'backpack', (.33, .35, .12), (0, .29, -.235), 'web', .025)
        for sign in [-1, 1]:
            box(p, 'pack-clasp', (.037, .27, .02), (sign*.10, .29, -.305), 'rubber')

    for side, sign in [('L', -1), ('R', 1)]:
        p = surfaces[f'upper{side}']
        r = .112 if heavy else .083 * min(1.1, width)
        rings(p, 'jacket-sleeve', [(.032, r*.85, r*.90, 0), (-.07, r, r, 0), (-.19, r*.90, r*.9, 0), (-.31, r*.73, r*.76, 0)], cloth)
        box(p, 'unit-armband', (r*1.83, .045, r*1.82), (0, -.125, 0), mark)
        if heavy:
            box(p, 'shoulder-armor', (.235, .153, .235), (sign*.01, -.025, 0), 'armor', .025)
            box(p, 'shoulder-inlay', (.188, .025, .015), (0, -.044, .124), mark, .004)
        p = surfaces[f'fore{side}']
        rings(p, 'forearm-sleeve', [(.024, r*.72, r*.75, 0), (-.065, r*.88, r*.87, 0), (-.20, r*.68, r*.64, 0), (-.25, .054, .051, 0)], cloth)
        box(p, 'elbow-pad', (r*1.38, .105, .055), (0, -.015, -.068), 'rubber')
        box(p, 'wrist-cuff', (.116, .045, .115), (0, -.23, 0), 'rubber')
        box(p, 'glove-palm', (.114, .105, .095), (0, -.303, .008), 'rubber', .021)
        for i in range(3):
            box(p, 'glove-knuckle', (.027, .029, .018), ((i-1)*.033, -.289, .059), 'edge', .008)
        oval(p, 'glove-thumb', (.031, .045, .031), (-sign*.055, -.293, .035), 'rubber')
        if heavy:
            box(p, 'forearm-plate', (.133, .148, .04), (0, -.11, .065), 'armor', .012)

        p = surfaces[f'thigh{side}']
        r = .142 if heavy else .112 * min(1.1, width)
        rings(p, 'cargo-trouser-leg', [(.028, r*.9, .11, 0), (-.095, r, .118, 0), (-.25, r*.85, .103, 0), (-.414, r*.72, .086, 0)], 'pants')
        box(p, 'cargo-pocket', (.062, .165, .142), (sign*r*.92, -.16, -.007), 'web')
        box(p, 'pocket-flap', (.065, .027, .149), (sign*r*.94, -.088, -.007), 'cloth')
        p = surfaces[f'shin{side}']
        rings(p, 'lower-trouser-leg', [(.024, r*.72, .085, 0), (-.12, r*.81, .098, -.01), (-.29, r*.63, .078, 0), (-.385, r*.61, .073, 0)], 'pants')
        plate(p, 'kneepad', [(-r*.63, .02), (r*.63, .02), (r*.69, -.076), (r*.39, -.116), (-r*.39, -.116), (-r*.69, -.076)], .103, .03, 'armor')
        box(p, 'boot-upper', (r*1.49, .18, .176), (0, -.298, -.002), 'rubber', .019)
        box(p, 'boot-toe', (r*1.66, .107, .286), (0, -.371, .049), 'rubber', .028)
        box(p, 'boot-sole', (r*1.72, .027, .294), (0, -.407, .051), 'edge', .007)
        for i in range(3):
            box(p, 'boot-lace', (.09, .008, .015), (0, -.251-i*.026, .089), 'web', .002)
        if heavy:
            plate(p, 'shin-plate', [(-.09, -.117), (.09, -.117), (.065, -.29), (-.065, -.29)], .098, .025, 'armor')

    p = surfaces['head']
    oval(p, 'balaclava', (.16, .192, .142), (0, .13, -.005), 'rubber')
    if player:
        # Unmasked operator: protective goggles, not a clown face.
        box(p, 'goggle-frame', (.29, .076, .045), (0, .205, .124), 'edge', .023)
        box(p, 'goggle-lens', (.255, .049, .018), (0, .205, .151), 'glass', .016)
        box(p, 'goggle-bridge', (.025, .054, .024), (0, .205, .164), 'rubber', .006)
        rings(p, 'helmet', [(.254, .176, .156, -.013), (.35, .145, .135, -.022), (.382, .07, .073, -.017)], 'armor', .017)
        box(p, 'helmet-mount', (.047, .064, .031), (0, .308, .15), 'edge')
        for sign in [-1, 1]:
            box(p, 'comms-earcup', (.045, .10, .073), (sign*.167, .183, -.026), 'armor')
            box(p, 'helmet-mark', (.056, .025, .008), (sign*.093, .315, .131), mark, .003)
    else:
        mask(p, heavy)
        if heavy:
            rings(p, 'ballistic-helmet', [(.265, .185, .167, -.02), (.372, .17, .145, -.027), (.402, .095, .09, -.03)], 'armor', .014)
            for sign in [-1, 1]:
                box(p, 'helmet-ear-guard', (.047, .123, .136), (sign*.166, .216, -.035), 'armor')
        else:
            # Close-fitting hood follows the skull; the pale mask is the focal point.
            rings(p, 'hood-crown', [(.268, .167, .144, -.012), (.327, .133, .117, -.026), (.349, .08, .08, -.03)], cloth, .012)
    if kind == 'rusher':
        p = surfaces['torso']
        strap = box(p, 'red-assault-sash', (.05, .38, .025), (0, .30, .199), 'red', .005)
        strap.rotation_euler.y = -.55
        for sign in [-1, 1]:
            box(surfaces[f'thigh{"L" if sign == -1 else "R"}'], 'knife-sheath', (.033, .24, .048), (sign*.10, -.18, .09), 'rubber')
        box(surfaces['head'], 'red-headband', (.31, .038, .08), (0, .297, .103), 'red')
    elif kind == 'sniper':
        # Open-front hood and shoulder mantle, attached to head/torso respectively.
        hood_rows = [(-.065, .175, .15), (.08, .187, .164), (.235, .184, .165), (.33, .153, .141), (.375, .091, .088)]
        verts = []
        for y, width, depth in hood_rows:
            for i in range(21):
                a = .66 + i / 20 * (math.tau - 1.32)
                verts.append((math.sin(a)*width, y, math.cos(a)*depth-.025))
        faces = [(j*21+i, j*21+i+1, (j+1)*21+i+1, (j+1)*21+i) for j in range(4) for i in range(20)]
        hood = poly(surfaces['head'], 'open-cloth-hood', verts, faces, 'sand')
        hood.modifiers.new('Cloth thickness', 'SOLIDIFY').thickness = .016
        p = surfaces['torso']
        plate(p, 'shoulder-mantle', [(-.25, .45), (-.28, .26), (-.20, .15), (.20, .15), (.28, .26), (.25, .45), (.13, .53), (-.13, .53)], -.105, .062, 'sand')
        plate(p, 'short-cape', [(-.23, .42), (.23, .42), (.25, -.19), (-.19, -.24)], -.176, .025, 'sand')
        for i in range(3):
            box(p, 'sniper-round', (.026, .075, .02), (.09 + i*.035, .38, .194), 'gold', .005)
    elif kind == 'shield':
        rings(surfaces['head'], 'riot-helmet', [(.265, .181, .16, -.025), (.36, .157, .14, -.028), (.388, .085, .08, -.03)], 'armor', .015)
        shield = joint('shield', torso, (-.17, .34, .46))
        p = surfaces['shield']
        # A real sight opening; preserve the old shield's coverage and pivot.
        plate(p, 'riot-plate', [(-.46, -.65), (.46, -.65), (.46, .18), (-.46, .18)], .055, .09, 'armor')
        plate(p, 'riot-cap', [(-.46, .34), (.46, .34), (.40, .65), (-.40, .65)], .055, .09, 'armor')
        for sign in [-1, 1]:
            box(p, 'sight-side', (.12, .16, .09), (sign*.4, .26, .01), 'armor')
            box(p, 'shield-edge', (.03, 1.14, .033), (sign*.441, -.06, .072), 'steel')
            box(p, 'shield-handle', (.044, .20, .06), (sign*.18, .08, -.087), 'rubber')
        box(p, 'ballistic-sight', (.68, .16, .016), (0, .26, -.015), 'glass', .003)
        box(p, 'shield-red-panel', (.31, .11, .012), (0, -.11, .064), 'red')
        for i in range(3):
            box(p, 'shield-id-bar', (.025, .06, .008), (-.07 + i*.07, -.11, .075), 'ivory', .002)
        box(p, 'shield-lower-brace', (.76, .055, .015), (0, -.48, .064), 'edge')
    elif kind == 'boss':
        p = surfaces['head']
        for i in range(-1, 2):
            plate(p, 'command-crest', [(i*.073-.027, .335), (i*.073+.027, .335), (i*.073+.019, .44-abs(i)*.03), (i*.073, .477-abs(i)*.04), (i*.073-.019, .44-abs(i)*.03)], .128, .032, 'gold')
        for sign, side in [(-1, 'L'), (1, 'R')]:
            box(surfaces[f'upper{side}'], 'command-epaulette', (.20, .039, .16), (0, .061, 0), 'gold')
            plate(surfaces[f'thigh{side}'], 'coat-skirt', [(sign*.04, .07), (sign*.19, .06), (sign*.18, -.29), (sign*.08, -.26)], -.06, .047, 'navy')
        plate(surfaces['torso'], 'command-collar', [(-.13, .48), (-.13, .6), (-.07, .57), (.07, .57), (.13, .6), (.13, .48)], .056, .20, 'armor')
    return root


def beam(parent, label, a, b, radius, mat):
    start, end = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=radius, depth=(end-start).length)
    obj = bpy.context.object
    obj.location = (start+end)/2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (end-start).to_track_quat('Z', 'Y')
    finish(obj, label, parent, mat)
    return bevel(obj, .003)


def build_machine(which):
    global kind
    kind = which
    root = empty(kind)
    surfaces = {}

    def joint(label, parent, pos=(0, 0, 0)):
        p = empty(label, parent, pos)
        surfaces[label] = empty(f'{label}-surface', p)
        return p

    if kind == 'flyer':
        torso = joint('torso', root, (0, .6, 0))
        p = surfaces['torso']
        rings(p, 'drone-hull', [(-.16, .12, .37, 0), (-.06, .29, .43, .04), (.10, .27, .40, 0), (.16, .10, .29, -.04)], 'armor')
        plate(p, 'nose-armor', [(-.19, -.095), (.19, -.095), (.14, .10), (-.14, .10)], .419, .03, 'edge')
        f = mask(p, False)
        f.location = xyz((0, -.095, .48)); f.scale *= .82
        for sign, side in [(-1, 'L'), (1, 'R')]:
            joint(f'wing{side}', torso, (sign*.48, 0, -.14))
            wing = surfaces[f'wing{side}']
            box(wing, 'engine-pylon', (.58, .066, .135), (-sign*.10, 0, 0), 'edge', .012)
            bpy.ops.mesh.primitive_torus_add(major_radius=.208, minor_radius=.032, major_segments=20, minor_segments=6)
            finish(bpy.context.object, 'ducted-engine', wing, 'armor')
            for angle in [0, math.pi/2]:
                blade = box(wing, 'rotor-blade', (.35, .014, .044), (0, .005, 0), 'rubber', .004)
                blade.rotation_euler.z = angle + sign*.28
            rings(wing, 'rotor-hub', [(-.035, .042, .042, 0), (.032, .042, .042, 0)], 'steel')
            box(wing, 'engine-red-band', (.19, .024, .022), (0, .006, .216), 'red', .003)
            box(p, 'navigation-light', (.036, .025, .041), (sign*.244, .065, .29), 'led', .006)
            beam(p, 'landing-skid', (sign*.16, -.17, -.28), (sign*.16, -.17, .22), .024, 'rubber')
        joint('tail', torso, (0, .13, -.52))
        p = surfaces['tail']
        box(p, 'tailplane', (.49, .04, .16), (0, -.028, -.035), 'armor')
        plate(p, 'tail-fin', [(-.018, -.045), (.018, -.045), (.015, .20), (-.015, .20)], -.10, .12, 'edge')
        box(p, 'tail-identification', (.27, .012, .038), (0, -.002, -.035), 'red', .003)
        return root

    hips = joint('hips', root, (0, .5, 0))
    torso = joint('torso', hips)
    for sign, side in [(-1, 'L'), (1, 'R')]:
        arm = joint(f'upper{side}', torso, (sign*.42, .42, 0))
        joint(f'fore{side}', arm, (0, -.26, 0))
        thigh = joint(f'thigh{side}', hips, (sign*.16, -.06, 0))
        joint(f'shin{side}', thigh, (0, -.26, 0))
    p = surfaces['hips']
    box(p, 'machine-pelvis', (.43, .16, .33), (0, 0, 0), 'rubber', .03)
    p = surfaces['torso']
    if kind == 'bomber':
        rings(p, 'demolition-housing', [(-.045, .25, .24, 0), (.12, .36, .31, 0), (.48, .37, .32, 0), (.67, .25, .24, 0)], 'armor', .018)
        for sign in [-1, 1]:
            box(p, 'explosive-pack', (.115, .35, .22), (sign*.29, .30, -.29), 'hazard', .017)
            box(p, 'charge-retainer', (.12, .043, .232), (sign*.29, .31, -.29), 'rubber')
        plate(p, 'blast-apron', [(-.31, .04), (.31, .04), (.33, .45), (-.33, .45)], .343, .05, 'edge')
        f = mask(p, False); f.location = xyz((0, .18, .255)); f.scale *= 1.2
        joint('cap', torso, (0, .76, 0))
        box(surfaces['cap'], 'detonator-cap', (.21, .095, .17), (0, -.035, 0), 'hazard')
        joint('fuse', torso)
        beam(surfaces['fuse'], 'arming-lead', (0, .79, 0), (.04, 1.1, 0), .02, 'rubber')
        beam(surfaces['fuse'], 'arming-lead', (.04, 1.1, 0), (.24, 1.14, 0), .02, 'rubber')
        joint('spark', torso, (.24, 1.14, 0))
        oval(surfaces['spark'], 'arming-beacon', (.045, .045, .045), (0, 0, 0), 'led')
    elif kind == 'hitbox':
        box(p, 'breach-housing', (.83, .70, .68), (0, .33, 0), 'armor', .065)
        for sign in [-1, 1]:
            box(p, 'breach-corner', (.075, .64, .10), (sign*.39, .33, .34), 'steel', .016)
            box(p, 'breach-hazard-panel', (.17, .10, .035), (sign*.27, .59, .379), 'hazard')
        box(p, 'ram-bumper', (.86, .135, .115), (0, .026, .377), 'edge', .022)
        for i in [-1, 0, 1]:
            box(p, 'ram-tooth', (.058, .17, .046), (i*.25, .014, .443), 'rubber')
        f = mask(p, True); f.location = xyz((0, .17, .258)); f.scale *= 1.3
        joint('lid', torso, (0, .86, 0))
        p = surfaces['lid']
        box(p, 'armored-lid', (.76, .255, .60), (0, -.035, 0), 'edge', .037)
        box(p, 'lid-seal', (.78, .027, .62), (0, -.171, 0), 'rubber')
        for i in range(5):
            box(p, 'lid-vent', (.035, .06, .017), ((i-2)*.094, -.035, .305), 'ink', .004)
        for sign in [-1, 1]:
            box(p, 'canopy-hinge', (.11, .05, .065), (sign*.24, -.15, -.285), 'steel')
    else:
        rings(p, 'signal-housing', [(-.035, .26, .27, 0), (.18, .40, .35, 0), (.45, .37, .32, 0), (.7, .24, .23, -.02)], 'armor', .019)
        plate(p, 'transmitter-front', [(-.3, .08), (.3, .08), (.32, .46), (0, .66), (-.32, .46)], .358, .035, 'signal')
        f = mask(p, False); f.location = xyz((0, .16, .26)); f.scale *= 1.24
        box(p, 'relay-backpack', (.37, .52, .15), (0, .39, -.34), 'edge', .027)
        for i in range(4):
            box(p, 'relay-vent', (.255, .025, .02), (0, .24+i*.083, -.423), 'rubber')
        joint('spikes', torso)
        p = surfaces['spikes']
        for sign in [-1, 1]:
            for i in range(3):
                a = (sign*(.25+i*.035), .60-i*.20, -.13)
                b = (sign*(.39+i*.062), 1.00-i*.24, -.21-i*.045)
                beam(p, 'antenna-base', a, b, .028, 'edge')
                beam(p, 'antenna-tip', b, (b[0]+sign*.035, b[1]+.12, b[2]), .012, 'signal')
        box(p, 'transmitter-cap', (.15, .13, .12), (0, .75, -.03), 'signal')
        box(p, 'transmitter-light', (.075, .025, .009), (0, .774, .036), 'led')

    for sign, side in [(-1, 'L'), (1, 'R')]:
        p = surfaces[f'upper{side}']
        box(p, 'shoulder-joint', (.155, .145, .15), (0, 0, 0), 'rubber', .022)
        box(p, 'manipulator-link', (.10, .245, .13), (0, -.127, 0), 'edge', .016)
        box(p, 'actuator-inset', (.033, .145, .02), (0, -.125, .077), 'hazard' if kind == 'bomber' else 'signal' if kind == 'lagspike' else 'red')
        p = surfaces[f'fore{side}']
        box(p, 'gripper-joint', (.13, .105, .12), (0, -.006, 0), 'rubber', .017)
        for s in [-1, 1]:
            box(p, 'gripper-finger', (.026, .107, .07), (s*.062, -.059, .017), 'steel')
        p = surfaces[f'thigh{side}']
        box(p, 'upper-drive-leg', (.185, .25, .18), (0, -.12, 0), 'armor', .024)
        beam(p, 'leg-piston', (sign*.107, -.02, -.013), (sign*.107, -.232, -.013), .025, 'steel')
        p = surfaces[f'shin{side}']
        box(p, 'ankle-drive', (.14, .15, .14), (0, -.063, -.015), 'edge', .018)
        box(p, 'traction-foot', (.22, .071, .275), (0, -.147, .055), 'rubber', .018)
        for i in range(3):
            box(p, 'traction-rib', (.225, .016, .028), (0, -.166, -.035+i*.079), 'steel', .004)
    return root


roots = [build_character(k) for k in ['player', 'grunt', 'heavy', 'rusher', 'sniper', 'shield', 'boss']]
roots += [build_machine(k) for k in ['bomber', 'flyer', 'hitbox', 'lagspike']]
kind = 'player'
# First-person gloves and sleeves. +Y runs from the grip towards the elbow.
for side, sign in [('L', -1), ('R', 1)]:
    p = empty(f'viewhand{side}-surface', roots[0])
    box(p, 'view-glove-palm', (.102, .097, .085), (0, -.015, 0), 'rubber', .018)
    for i in range(4):
        box(p, 'curled-finger', (.021, .066, .044), ((i-1.5)*.024, -.055, .019), 'rubber', .01)
        box(p, 'knuckle-guard', (.017, .025, .012), ((i-1.5)*.024, -.029, -.044), 'edge', .005)
    oval(p, 'view-thumb', (.025, .044, .024), (sign*.052, -.024, .023), 'rubber')
    box(p, 'view-cuff', (.117, .053, .112), (0, .057, 0), 'rubber')
    rings(p, 'view-sleeve', [(.069, .057, .054, 0), (.18, .071, .064, 0), (.32, .083, .071, 0), (.44, .081, .076, 0)], 'navy')
    box(p, 'view-blue-tab', (.066, .035, .008), (0, .133, -.064), 'blue', .004)
    box(p, 'view-cuff-fastener', (.052, .027, .014), (0, .060, -.057), 'web', .004)

OUT.parent.mkdir(parents=True, exist_ok=True)
# Keep the editable source before applying modifiers and batching export meshes.
# It opens as a readable line-up; the GLB uses neutral local transforms.
for i, root in enumerate(roots):
    root.location = xyz(((i % 6 - 2.5) * 1.7, 0, -(i // 6) * 2.5))
for side in ['L', 'R']:
    p = bpy.data.objects[f'player__viewhand{side}-surface']
    p.location = xyz((-.3 if side == 'L' else .3, 1.05, -.55))
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/models/tactical.blend'))
for root in roots:
    root.location = (0, 0, 0)
for side in ['L', 'R']:
    bpy.data.objects[f'player__viewhand{side}-surface'].location = (0, 0, 0)

# One draw per material per articulated part, not one draw per buckle or tooth.
# Preserve named surfaces used by the asset contract checks.
keep = {'mask-shell', 'clown-nose', 'view-glove-palm', 'view-sleeve'}
batches = {}
for obj in list(bpy.data.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    label = obj.name.split('__')[-1].split('.')[0]
    if label not in keep:
        batches.setdefault((obj.parent, obj.data.materials[0]), []).append(obj)
for objects in batches.values():
    if len(objects) < 2:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_apply=True, export_yup=True, export_animations=False)
print(f'Tactical cast exported to {OUT}')

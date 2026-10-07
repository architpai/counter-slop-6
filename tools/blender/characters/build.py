"""
Build the realistic operators (docs/VISUALS.md, R7): every kind's skinned
model and clips into one glb, and its three texture sets' maps.

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/characters/build.py -- \
      [--out DIR] [--quick] [--no-bake] [--preview] [--only grunt,medic]

1. Canonical pieces, once each: the operator's body, head, boots, gloves,
   gear and headgear, the mask shell (set `operator`); each role's kit
   (`kit`); each machine (`machine`). Small parts that need no texture space
   of their own (paint, studs, straps, the masks' features) take a swatch of
   their finish instead. Each set is unwrapped into one atlas and baked
   (core.py finishes, the weapons' bake: albedo, normal, ORM at 2048, 1024
   and 512).
2. Kinds (roster.py, machines.py): each piece is made again (the builders
   are deterministic, so it takes the canonical piece's UVs), weighted to
   its bones, fitted to the kind's build, coloured, and joined into one mesh
   per kind with a material slot per set; bound to an armature on the
   game's pivots.
3. The clip rigs `humanoid` and `machine` carry the clips (clips.py) as NLA
   tracks.
4. Exports `model.glb` (materials are set names; COLOR_0 is the kind's
   colours, `_FX` its glow and team mark) and `meta.json` (triangles per
   kind, bones, clips) into the build folder; tools/characters/operators.mjs
   packs them.
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core as L  # noqa: E402
import body as Bd  # noqa: E402
import clips as Cl  # noqa: E402
import gear as Gr  # noqa: E402
import kits as K  # noqa: E402
import machines as Mc  # noqa: E402
import masks as Mk  # noqa: E402
import roster as R  # noqa: E402

SETS = ('operator', 'kit', 'machine')
SWATCH_FINISHES = ('decal', 'paint', 'metal', 'steel', 'rubber', 'polymer', 'mask', 'glow', 'lens', 'webbing', 'cordura', 'canvas')
# Islands get this much more texture than the set's average density: the mask is what the player looks at.
UV_WEIGHT = {'mask-shell': 2.2, 'head': 1.2, 'glove': 1.6, 'hood': 1.2}


class Piece:
    """A piece of a kind: its object, the bone(s) it follows and its colour zone (or a literal (colour, glow))."""

    def __init__(self, obj, bone, zone, key, swatch=None, mirror=False):
        self.obj, self.bone, self.zone, self.key, self.swatch, self.mirror = obj, bone, zone, key, swatch, mirror


def humanoid_pieces(kind, spec, rest):
    """Every piece of a humanoid kind, freshly built (deterministic: the same geometry for the same kind every time)."""
    out = []

    def add(pairs, zone, prefix):
        for i, pr in enumerate(pairs):
            o, bone = pr[0], pr[1]
            z = pr[2] if len(pr) > 2 else zone
            out.append(Piece(o, bone, z, f'{prefix}:{i}:{o.name.split(".")[0]}'))

    robot = spec.get('body') == 'robot'
    if not robot:
        out.append(Piece(Bd.trousers(), 'body', 'trousers', 'trousers'))
        out.append(Piece(Bd.shirt(), 'body', 'shirt', 'shirt'))
        out.append(Piece(Bd.head(), 'body', 'balaclava', 'head'))
        for side in ('R', 'L'):
            for i, o in enumerate(Bd.boot(1)):
                out.append(Piece(o, f'boot{side}', 'rubber' if i == 1 else 'boots', f'boot:{i}', mirror=side == 'L'))
        # The gun hand (+x) is the mirror of a right hand posed round the grip (body.py `glove`).
        out.append(Piece(Bd.glove(rest, 'L', Bd.SUPPORT), 'foreL', 'gloves', 'glove'))
        out.append(Piece(Bd.glove(rest, 'R', Bd.GRIP), 'foreR', 'gloves', 'glove', mirror=True))
        add(Gr.collar(), 'balaclava', 'collar')
        add(Gr.belt(), 'gear', 'belt')
        out[-2].zone = 'steel'  # the buckle
        vest = spec.get('vest', 'carrier')
        if vest in ('carrier', 'heavy'):
            # The player's carrier wears a light tint of the team's colour (roster.py `team_carrier`).
            carrier = 'team' if spec.get('team_carrier') else 'vest'
            add(Gr.plate_carrier(vest == 'heavy'), carrier, f'carrier-{vest}')
            add(Gr.mag_pouches(3, 0.176 if vest == 'carrier' else 0.196), carrier, f'pouches-{vest}')
            add(Gr.admin_pouch(z=0.18 if vest == 'carrier' else 0.2), carrier, f'admin-{vest}')
        if spec.get('radio'):
            add(Gr.radio(-1), 'vest', 'radio')
        if spec.get('knees'):
            add(Gr.knee_pads(), 'pads', 'knees')
        if spec.get('elbows'):
            add(Gr.elbow_pads(), 'pads', 'elbows')
        if spec.get('cargo'):
            add(Gr.thigh_pockets(), 'trousers', 'cargo')
        if spec.get('holster'):
            add(Gr.holster(1), 'rubber', 'holster')
        # The armband: the hostile red on enemies, the team colour on the player.
        armband = L.ring('armband', (-0.258, 1.19 + 0.0275, 0.012), (0.062, 0.058), 0.055, 0.006, 'y', 16, 'canvas')
        out.append(Piece(armband, 'upperL', 'mark', 'armband'))
        if kind == 'player':
            band = L.ring('armbandR', (0.258, 1.19 + 0.0275, 0.012), (0.062, 0.058), 0.055, 0.006, 'y', 16, 'canvas')
            out.append(Piece(band, 'upperR', 'mark', 'armbandR'))
            panel = L.curved_panel('id-panel', 0.12, 0.05, 0.006, 0.34, 'paint', centre=(-0.05, 1.37, 0.18), cols=4, rows=1, bevel=0.002)
            out.append(Piece(panel, 'chest', 'mark', 'id-panel'))
    hat = spec.get('hat', 'none')
    if hat in ('fast', 'riot', 'eod'):
        add(Gr.helmet(hat), 'hat', f'helmet-{hat}')
    elif hat == 'cap':
        add(Gr.cap(), 'hat', 'cap')
    elif hat == 'band':
        add(Gr.band(), 'hat', 'band')
    elif hat == 'hood':
        add(Gr.hood(), 'hat', 'hood')
    elif hat == 'crown':
        add(Gr.crown(), 'gold', 'crown')
    if spec.get('headset') and hat not in ('hood', 'eod'):
        add(Gr.headset(), 'rubber', 'headset')
    if kind == 'player':
        add(Gr.goggles(), 'rubber', 'goggles')
        out[-2].zone = 'lens'
        # The team band round the helmet, the team's colour where the helmet shows.
        band = L.ring('helmet-band', (0, 1.72 + 0.009, -0.012), (0.121, 0.133), 0.018, 0.006, 'y', 28, 'paint')
        out.append(Piece(band, 'head', 'mark', 'helmet-band'))
    for name in spec.get('kit', []):
        add(getattr(K, name)(), 'kit', f'kit-{name}')
    if spec.get('mask', True):
        for i, (o, colour, glow) in enumerate(Mk.build(kind, spec.get('heavy_mask', False))):
            key = 'mask-shell' if i == 0 else None
            out.append(Piece(o, 'head', (colour, glow), key or f'mask-{kind}:{i}', swatch=None if key else o.data.materials[0].name))
    return out


def machine_pieces(kind):
    out = []
    for i, (o, bone, zone) in enumerate(Mc.BUILDERS[kind]()):
        # A mask's features take their finish's swatch; its shell the canonical shell's UVs.
        if isinstance(zone, tuple):
            shell = o.name.startswith('mask-')
            out.append(Piece(o, bone, zone, 'mask-shell' if shell else f'{kind}-mask:{i}', swatch=None if shell else o.data.materials[0].name))
        else:
            out.append(Piece(o, bone, zone, f'{kind}:{i}:{o.name.split(".")[0]}'))
    return out


def piece_set(kind, piece):
    """Which texture set a piece's UVs live in."""
    if piece.key == 'mask-shell' or piece.swatch:
        return 'operator'
    if kind in Mc.BUILDERS:
        return 'machine'
    if piece.key.startswith('kit-'):
        return 'kit'
    return 'operator'


# ------------------------------------------------------------------ UVs

def unwrap(objects, weights):
    """One atlas for a set: smart project, islands at one density (times each object's weight), packed."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objects:
        w = weights.get(o, 1.0)
        if w == 1.0:
            continue
        uv = o.data.uv_layers.active.data
        a = np.empty(len(uv) * 2)
        uv.foreach_get('uv', a)
        a = a.reshape(-1, 2)
        c = a.mean(axis=0)
        a = c + (a - c) * math.sqrt(w)
        uv.foreach_set('uv', a.ravel())
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')


def uv_array(o):
    uv = o.data.uv_layers.active.data
    a = np.empty(len(uv) * 2)
    uv.foreach_get('uv', a)
    return a


def set_uv(o, a):
    if not o.data.uv_layers:
        o.data.uv_layers.new(name='UVMap')
    o.data.uv_layers.active.data.foreach_set('uv', a)


def swatch_rect(o):
    a = uv_array(o).reshape(-1, 2)
    lo, hi = a.min(axis=0), a.max(axis=0)
    return lo, hi


# ------------------------------------------------------------------ weights

def piece_weights(piece, p):
    """Bone weights of a piece's vertices (canonical game positions)."""
    n = len(p)
    b = piece.bone
    if b == 'body':
        return Bd.weights_body(p, piece.key)
    if b.startswith('boot'):
        side = b[-1]
        up = L.smoothstep(0.13, 0.2, p[:, 1])
        return {f'shin{side}': up, f'foot{side}': 1 - up}
    return {b: np.ones(n)}


# ------------------------------------------------------------------ main

def main():
    opts = L.options()
    L.reset()
    started = time.time()
    rest = Bd.glove_rest()
    rest.hide_render = True
    # The glove's atlas is the rest hand's; every posed copy keeps its UVs.
    kinds = [k for k in list(R.HUMANOIDS) + list(Mc.BUILDERS) if not opts['only'] or k in opts['only']]
    # 1. Canonical pieces: the first build of each key.
    canon = {s: {} for s in SETS}
    layout = {}
    for kind in kinds:
        pieces = humanoid_pieces(kind, R.HUMANOIDS[kind], rest) if kind in R.HUMANOIDS else machine_pieces(kind)
        for pc in pieces:
            s = piece_set(kind, pc)
            if pc.swatch or pc.key in canon[s]:
                bpy.data.objects.remove(pc.obj)
                continue
            canon[s][pc.key] = pc.obj
            layout[pc.obj] = kind
    swatches = {}
    for i, finish in enumerate(SWATCH_FINISHES):
        o = L.box(f'swatch-{finish}', (0.03, 0.03, 0.03), (4 + 0.06 * i, 0.0, 0.0), finish, bevel=0.004)
        swatches[finish] = o
        canon['operator'][f'swatch:{finish}'] = o
    # The glove's own UVs: unwrap the rest hand with the operator set by baking a posed copy.
    rest_uv = None
    for s in SETS:
        objects = list(canon[s].values())
        if not objects:
            continue
        # Pieces of different kinds (helmets, hoods, kits) would shade each other: spread them out.
        groups = {}
        for o in objects:
            groups.setdefault(layout.get(o, 'swatch') if s != 'operator' else _group(o), []).append(o)
        # The body and its gear stay where they are (the folds and seams are placed in its space).
        order = sorted(groups, key=lambda g: (g != 'body', str(g)))
        for gi, g in enumerate(order):
            for o in groups[g]:
                o.location = L.G(gi * 1.2, 0, 0)
        weights = {o: UV_WEIGHT.get(k.split(':')[0], 1.0) for k, o in canon[s].items()}
        if s == 'operator':
            glove = canon['operator'].get('glove')
            unwrap(objects, weights)
            if glove is not None:
                rest_uv = uv_array(glove)
        else:
            unwrap(objects, weights)
        print(f'{s}: {len(objects)} pieces, {sum(L.triangles(o) for o in objects)} triangles unwrapped ({time.time() - started:.0f} s)')
    rects = {f: swatch_rect(o) for f, o in swatches.items()}
    uvs = {k: uv_array(o) for s in SETS for k, o in canon[s].items()}
    counts = {k: len(o.data.loops) for s in SETS for k, o in canon[s].items()}
    for s in SETS:
        objects = list(canon[s].values())
        if not objects or not opts['bake']:
            continue
        # One object a set: Cycles bakes each object of a multi-object bake on its own, a scene sync each.
        for o in objects:
            o.data.transform(o.matrix_basis)
            o.matrix_basis.identity()
        baked = L.join(f'bake-{s}', [L.duplicate(o, f'bake-{s}-{i}') for i, o in enumerate(objects)])
        L.W.bake(s, [baked], opts)
        bpy.data.objects.remove(baked)
        print(f'{s}: baked ({time.time() - started:.0f} s)')
    if opts['preview']:
        os.makedirs(opts['out'], exist_ok=True)
    for s in SETS:
        for o in canon[s].values():
            bpy.data.objects.remove(o)
    set_mats = {s: bpy.data.materials.new(s) for s in SETS}
    for s, m in set_mats.items():
        m.name = s
    if opts['preview']:
        preview_materials(opts['out'], set_mats)

    # 2. Kinds.
    meta = {'kinds': {}, 'clips': {}, 'sets': list(SETS)}
    exported = []
    for kind in kinds:
        human = kind in R.HUMANOIDS
        spec = R.HUMANOIDS.get(kind, {})
        colours = dict(R.DEFAULT)
        colours.update(spec.get('colours', {}) if human else Mc.COLOURS[kind])
        w = spec.get('w', 1.0) if human else 1.0
        bones = L.humanoid_bones(w, spec.get('shield', False)) if human else Mc.bones(kind)
        # The nodes the game moves by name (render/tactical.ts `TACTICAL_NODES`) are bones of their own.
        if 'aimbot_vent' in spec.get('kit', []):
            bones.append(('aimbot-vent', 'torso', (0, 0.32, -0.27)))
        if 'rage_cleaver' in spec.get('kit', []):
            bones.append(('heavy-melee', 'foreR', (0, 0, 0)))
        rig = L.armature(kind, bones)
        pieces = humanoid_pieces(kind, spec, rest) if human else machine_pieces(kind)
        objs = []
        for pc in pieces:
            o = pc.obj
            s = piece_set(kind, pc)
            if pc.swatch:
                lo, hi = rects[pc.swatch if pc.swatch in rects else 'paint']
                size = float(min(hi - lo)) * 0.5
                L.set_uv_square(o, float(lo[0] + (hi[0] - lo[0]) * 0.25), float(lo[1] + (hi[1] - lo[1]) * 0.25), size)
            else:
                if counts.get(pc.key) != len(o.data.loops):
                    raise RuntimeError(f'{kind}: {pc.key} built with {len(o.data.loops)} loops, its canonical piece has {counts.get(pc.key)}')
                set_uv(o, uvs[pc.key])
            if pc.mirror:
                m = L.mirror_x(o, o.name + '-mirror')
                bpy.data.objects.remove(o)
                o = pc.obj = m
            p = L.game_coords(o)
            weights = piece_weights(pc, p)
            if human:
                L.set_game_coords(o, Bd.fit(p, w, weights))
            if isinstance(pc.zone, tuple):
                L.tint(o, pc.zone[0], pc.zone[1])
            else:
                zone = pc.zone
                team = kind == 'player' and zone in ('mark', 'team')
                L.tint(o, colours['mark' if zone == 'team' else zone], glow=1.0 if zone == 'glow' else 0.0, mark=team, light=zone == 'team')
            for name, wv in weights.items():
                g = o.vertex_groups.get(f'{kind}__{name}') or o.vertex_groups.new(name=f'{kind}__{name}')
                for vi in np.nonzero(wv > 1e-4)[0].tolist():
                    g.add([vi], float(wv[vi]), 'REPLACE')
            o.data.materials.clear()
            o.data.materials.append(set_mats[s])
            objs.append(o)
        mesh = L.join(f'{kind}__body', objs)
        # Normalise to four influences.
        _limit_weights(mesh)
        m = mesh.modifiers.new('rig', 'ARMATURE')
        m.object = rig
        mesh.parent = rig
        tris = L.triangles(mesh)
        meta['kinds'][kind] = {'triangles': tris, 'bones': [[b, p, list(pos)] for b, p, pos in bones], 'width': w}
        exported += [rig, mesh]
        print(f'{kind}: {tris} triangles, {len(bones)} bones ({time.time() - started:.0f} s)')
        if opts['preview']:
            L.preview(os.path.join(opts['out'], f'preview-{kind}'), [mesh], views=((0, 1), (35, 1), (180, 1)), samples=12,
                      ortho=2.1 * (1.0 if human else 1.3), centre=(0, 0.95 if human else 0.7, 0))
            mesh.hide_render = True
    for o in exported:
        if o.type == 'MESH':
            o.hide_render = False

    # 3. Clip rigs.
    for group, bones, clips in (('humanoid', L.humanoid_bones(1.0), Cl.humanoid()),
                                ('machine', L.blob_bones([]), Cl.machine())):
        rig = L.armature(group, bones)
        for clip in clips:
            clip.write(rig)
            meta['clips'][f'{group}.{clip.name}'] = {'duration': clip.duration, 'loop': clip.loop}
        exported.append(rig)

    # 4. Export: the set materials as names only (the previews gave them the baked maps).
    for mat in set_mats.values():
        if mat.use_nodes:
            mat.node_tree.nodes.clear()
        mat.use_nodes = False
    os.makedirs(opts['out'], exist_ok=True)
    L.export(os.path.join(opts['out'], 'model.glb'), exported)
    with open(os.path.join(opts['out'], 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'exported {len(kinds)} kinds in {time.time() - started:.0f} s')


def preview_materials(out, set_mats):
    """Give the set materials their baked maps (the 1024 build) times the vertex colour, for the previews only."""
    for name, mat in set_mats.items():
        folder = os.path.join(out, name)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        out_node = nodes.new('ShaderNodeOutputMaterial')
        links.new(bsdf.outputs[0], out_node.inputs['Surface'])
        col = nodes.new('ShaderNodeVertexColor')
        col.layer_name = 'Col'
        maps = {}
        for key in ('albedo', 'normal', 'orm'):
            path = os.path.join(folder, f'1024-{key}.rgba')
            if not os.path.exists(path):
                continue
            a = np.frombuffer(open(path, 'rb').read(), np.uint8).reshape(1024, 1024, 4)[::-1].astype(np.float32) / 255
            img = bpy.data.images.new(f'{name}-{key}', 1024, 1024, alpha=True)
            img.colorspace_settings.name = 'sRGB' if key == 'albedo' else 'Non-Color'
            img.pixels.foreach_set(a.ravel())
            t = nodes.new('ShaderNodeTexImage')
            t.image = img
            maps[key] = t
        mul = nodes.new('ShaderNodeMix')
        mul.data_type, mul.blend_type = 'RGBA', 'MULTIPLY'
        ins = {x.identifier: x for x in mul.inputs}
        ins['Factor_Float'].default_value = 1.0
        links.new(col.outputs['Color'], ins['B_Color'])
        if 'albedo' in maps:
            links.new(maps['albedo'].outputs['Color'], ins['A_Color'])
        else:
            ins['A_Color'].default_value = (0.8, 0.8, 0.8, 1)
        links.new(next(x for x in mul.outputs if x.identifier == 'Result_Color'), bsdf.inputs['Base Color'])
        if 'normal' in maps:
            nm = nodes.new('ShaderNodeNormalMap')
            links.new(maps['normal'].outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs[0], bsdf.inputs['Normal'])
        if 'orm' in maps:
            sep = nodes.new('ShaderNodeSeparateColor')
            links.new(maps['orm'].outputs['Color'], sep.inputs[0])
            links.new(sep.outputs[1], bsdf.inputs['Roughness'])
            links.new(sep.outputs[2], bsdf.inputs['Metallic'])
        else:
            bsdf.inputs['Roughness'].default_value = 0.7


def _group(o):
    """The bake layout's group for an operator-set piece: the body and its gear together, each headgear and the mask apart."""
    n = o.name
    for key in ('helmet', 'cap', 'band', 'hood', 'crown', 'goggle', 'mask', 'earcup', 'headband', 'mic', 'rail', 'nvg', 'riot', 'eod', 'swatch'):
        if key in n:
            return key
    return 'body'


def _limit_weights(o):
    """At most four bone influences per vertex, normalised."""
    groups = o.vertex_groups
    for v in o.data.vertices:
        gs = sorted(((g.weight, g.group) for g in v.groups), reverse=True)
        keep = gs[:4]
        total = sum(wt for wt, _ in keep) or 1.0
        for wt, gi in gs[4:]:
            groups[gi].remove([v.index])
        for wt, gi in keep:
            groups[gi].add([v.index], wt / total, 'REPLACE')


main()

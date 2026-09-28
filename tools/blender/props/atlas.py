"""
The detail kit's two atlases (docs/VISUALS.md, R6 and V16), 256 texels a cell
at the top tier:

  signs  (8 x 4, RGB)  shop signs, street signs, posters, tiles and pictures with
                       original text and art (Downtown's row 0-1, Mexico's row 2, the
                       House's row 3). Each cell is a Cycles render of flat emission
                       shapes and Blender's built-in font, seen from above.
  grime  (8 x 4, RGB)  multipliers laid over the level (white leaves a face as it is):
                       wall grime and leaks, rust runs, damp, oil, cracks, skid marks,
                       road patches, a drain and a cover, soot, moss, worn paths, two
                       graffiti, ground stains, dried puddles, gum, fallen leaves,
                       tyre tracks, dirt against an edge, drifted sand, scuffs, wide
                       cracks, a water line, rain streaks, plaster cracks, joint grime,
                       a burn, bare earth and footprints. Procedural noise, strokes and
                       random walks in numpy, the graffiti rendered like the signs;
                       every cell but the edge dirt (dark along the edge it is laid
                       against) fades to white at its border, so a quad never shows
                       its edge.

Rows are stored bottom first and cell i sits at column i % cols, row i // cols
(tools/blender/effects/lib.py `write_atlas`, reused here). `SIGNS` and `GRIME`
name the cells; the maps pick them by name (render/props.ts `SIGN`, `GRIME`).

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/props/atlas.py -- [--out DIR]
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'effects'))
import lib as fx  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location('props_lib', os.path.join(os.path.dirname(__file__), 'lib.py'))
props = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(props)

CELL = fx.CELL_SIZES[0]


# ------------------------------------------------------------------ signs

def _emission(colour):
    mat = bpy.data.materials.new('flat')
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*props.srgb(colour), 1)
    emit.inputs['Strength'].default_value = 1.0
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


class Canvas:
    """One cell: shapes laid over a 1 x 1 background in xy (y up), later shapes on top."""

    def __init__(self, background):
        self.z = 0.0
        self.objects = []
        self.rect(0.5, 0.5, 1.0, 1.0, background)

    def _add(self, obj, colour):
        obj.data.materials.append(_emission(colour))
        bpy.context.scene.collection.objects.link(obj)
        self.objects.append(obj)
        return obj

    def _mesh(self, verts, faces, colour):
        self.z += 0.001
        mesh = bpy.data.meshes.new('shape')
        mesh.from_pydata([(x, y, self.z) for x, y in verts], [], faces)
        return self._add(bpy.data.objects.new('shape', mesh), colour)

    def rect(self, x, y, w, h, colour, turn=0.0):
        c, s = math.cos(turn), math.sin(turn)
        pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        return self._mesh([(x + px * c - py * s, y + px * s + py * c) for px, py in pts], [(0, 1, 2, 3)], colour)

    def poly(self, points, colour):
        return self._mesh(points, [tuple(range(len(points)))], colour)

    def circle(self, x, y, r, colour, ry=None, segments=40):
        pts = [(x + r * math.cos(t), y + (ry or r) * math.sin(t)) for t in np.linspace(0, math.tau, segments, endpoint=False)]
        return self.poly(pts, colour)

    def ring(self, x, y, r, width, colour, segments=40):
        outer = [(x + r * math.cos(t), y + r * math.sin(t)) for t in np.linspace(0, math.tau, segments, endpoint=False)]
        inner = [(x + (r - width) * math.cos(t), y + (r - width) * math.sin(t)) for t in np.linspace(0, math.tau, segments, endpoint=False)]
        faces = [(i, (i + 1) % segments, segments + (i + 1) % segments, segments + i) for i in range(segments)]
        return self._mesh(outer + inner, faces, colour)

    def text(self, body, x, y, size, colour, width=0.9, bold=0.0, turn=0.0):
        """Text centred on (x, y), `size` its cap height's scale, shrunk to fit `width`."""
        self.z += 0.001
        curve = bpy.data.curves.new('text', 'FONT')
        curve.body = body
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.size = size
        curve.offset = bold * size
        obj = bpy.data.objects.new('text', curve)
        obj.location = (x, y, self.z)
        obj.rotation_euler = (0, 0, turn)
        self._add(obj, colour)
        bpy.context.view_layer.update()
        if obj.dimensions.x > width:
            obj.scale = (width / obj.dimensions.x,) * 3
        return obj

    def render(self):
        cell = fx.render_cell(CELL)
        for obj in self.objects:
            bpy.data.objects.remove(obj)
        rgb = fx.to_srgb(cell[:, :, :3] / np.maximum(cell[:, :, 3:4], 1e-4))
        return np.concatenate([fx.u8(rgb), np.full((CELL, CELL, 1), 255, np.uint8)], axis=2)


def clown(c, x, y, r):
    """The game's clown mask, flat: white face, red nose and smile, dark eyes."""
    c.circle(x, y, r, 0xf2ece2)
    for side in (-1, 1):
        c.circle(x + side * r * 0.36, y + r * 0.22, r * 0.14, 0x1f2328, ry=r * 0.2)
    c.circle(x, y - r * 0.02, r * 0.17, 0xd8261e)
    c.ring(x, y - r * 0.12, r * 0.55, r * 0.09, 0xd8261e)
    c.rect(x, y + r * 0.05, r * 1.3, r * 0.5, 0xf2ece2)
    c.circle(x, y - r * 0.02, r * 0.17, 0xd8261e)


def signs():
    """The signs atlas's cells, in order, with their names."""
    cells = []

    def cell(name, background, draw):
        c = Canvas(background)
        draw(c)
        cells.append((name, c.render()))

    # ---- Downtown
    cell('slop-mart', 0xf1efe8, lambda c: (c.rect(0.5, 0.86, 1, 0.2, 0xc8262a), c.text('SLOP MART', 0.5, 0.52, 0.2, 0xc8262a, bold=0.04),
                                          c.text('OPEN 24/7  EVERYTHING MUST GO', 0.5, 0.26, 0.07, 0x2a2e33), c.rect(0.5, 0.12, 1, 0.05, 0xc8262a)))
    cell('counter-slop', 0x1c2127, lambda c: (clown(c, 0.5, 0.58, 0.25), c.text('COUNTER SLOP 6', 0.5, 0.18, 0.12, 0xf2c230, bold=0.05),
                                             c.text('NOW WITH MORE SLOP', 0.5, 0.07, 0.05, 0xe7e2d6)))
    cell('no-parking', 0xf4f2ec, lambda c: (c.ring(0.5, 0.6, 0.28, 0.06, 0xc8262a), c.rect(0.5, 0.6, 0.06, 0.52, 0xc8262a, turn=-0.78),
                                           c.text('P', 0.5, 0.6, 0.28, 0x1f4a8a, bold=0.04), c.text('NO PARKING', 0.5, 0.17, 0.11, 0x1f2328, bold=0.03)))
    cell('high-voltage', 0xf2c230, lambda c: (c.poly([(0.2, 0.36), (0.8, 0.36), (0.5, 0.86)], 0x1f2328), c.poly([(0.27, 0.4), (0.73, 0.4), (0.5, 0.79)], 0xf2c230),
                                             c.poly([(0.52, 0.74), (0.42, 0.56), (0.5, 0.56), (0.46, 0.44), (0.58, 0.62), (0.5, 0.62)], 0x1f2328),
                                             c.text('DANGER', 0.5, 0.24, 0.12, 0x1f2328, bold=0.04), c.text('HIGH VOLTAGE', 0.5, 0.1, 0.08, 0x1f2328)))
    cell('exit', 0x1d8a4e, lambda c: (c.text('EXIT', 0.37, 0.5, 0.26, 0xf4f2ec, width=0.56, bold=0.05), c.poly([(0.8, 0.62), (0.94, 0.5), (0.8, 0.38)], 0xf4f2ec),
                                     c.rect(0.76, 0.5, 0.12, 0.08, 0xf4f2ec)))
    cell('laundromat', 0x2c8f95, lambda c: ([c.circle(x, y, r, 0x9fd8d6) for x, y, r in ((0.15, 0.8, 0.06), (0.85, 0.75, 0.08), (0.8, 0.22, 0.05), (0.12, 0.2, 0.07))],
                                           c.text('LAUNDROMAT', 0.5, 0.55, 0.13, 0xf4f2ec, bold=0.03), c.text('WASH  DRY  FOLD  SLOP', 0.5, 0.36, 0.06, 0xe2f3f2)))
    cell('vote-bob', 0x234f8f, lambda c: (c.text('VOTE', 0.5, 0.76, 0.14, 0xf4f2ec, bold=0.04), c.text('BOB', 0.5, 0.5, 0.26, 0xf2c230, bold=0.06),
                                         c.text('FOR MAYOR', 0.5, 0.26, 0.09, 0xf4f2ec), c.text('HE HAS A PLAN, PROBABLY', 0.5, 0.1, 0.05, 0xc9d6ea)))
    cell('lost-cat', 0xefece2, lambda c: (c.text('LOST CAT', 0.5, 0.86, 0.12, 0x1f2328, bold=0.04), c.rect(0.5, 0.52, 0.5, 0.4, 0x8d8a82),
                                         c.circle(0.5, 0.5, 0.12, 0x3a3a3a), c.poly([(0.4, 0.58), (0.44, 0.7), (0.48, 0.6)], 0x3a3a3a), c.poly([(0.52, 0.6), (0.56, 0.7), (0.6, 0.58)], 0x3a3a3a),
                                         c.text('HAS NO NAME', 0.5, 0.2, 0.07, 0x1f2328), c.text('DOES NOT COME WHEN CALLED', 0.5, 0.1, 0.045, 0x4a4d52)))
    cell('gg-burgers', 0xe0762a, lambda c: (c.circle(0.5, 0.66, 0.2, 0xd9a24a, ry=0.1), c.rect(0.5, 0.6, 0.42, 0.05, 0x5a2e1e), c.rect(0.5, 0.56, 0.44, 0.03, 0x6fae3c),
                                           c.circle(0.5, 0.52, 0.2, 0xd9a24a, ry=0.05), c.text('GG EZ BURGERS', 0.5, 0.24, 0.11, 0xf4f2ec, bold=0.04),
                                           c.text('NO REFUNDS', 0.5, 0.1, 0.06, 0x3b1c10)))
    cell('clown-college', 0x5b3a8a, lambda c: (c.circle(0.5, 0.64, 0.14, 0xd8261e), c.text('CLOWN COLLEGE', 0.5, 0.34, 0.11, 0xf4f2ec, bold=0.04),
                                              c.text('ENROL NOW  HONK HONK', 0.5, 0.17, 0.06, 0xf2c230)))
    cell('slop-st', 0x1f6b3d, lambda c: (c.rect(0.5, 0.5, 0.94, 0.5, 0xf4f2ec), c.rect(0.5, 0.5, 0.9, 0.46, 0x1f6b3d),
                                        c.text('SLOP ST', 0.5, 0.5, 0.2, 0xf4f2ec, bold=0.04)))
    cell('respawn', 0xe9e1cf, lambda c: (c.text('RESPAWN', 0.5, 0.72, 0.16, 0x9e2a2b, bold=0.05), c.text('INSURANCE', 0.5, 0.52, 0.12, 0x2a2e33, bold=0.03),
                                        c.text("YOU'LL BE BACK IN 5 SECONDS", 0.5, 0.26, 0.05, 0x2a2e33), c.rect(0.5, 0.12, 0.7, 0.04, 0x9e2a2b)))
    cell('honk', 0xf4f2ec, lambda c: (c.rect(0.5, 0.5, 1, 0.36, 0x1f2328), c.text('HONK IF YOU ARE LAGGING', 0.5, 0.5, 0.08, 0xf2c230, bold=0.03)))
    cell('parking', 0x1f4a8a, lambda c: (c.rect(0.5, 0.5, 0.86, 0.86, 0xf4f2ec), c.rect(0.5, 0.5, 0.8, 0.8, 0x1f4a8a), c.text('P', 0.5, 0.52, 0.55, 0xf4f2ec, bold=0.05)))
    cell('staff-only', 0xf4f2ec, lambda c: (c.rect(0.5, 0.78, 1, 0.24, 0xc8262a), c.text('STAFF ONLY', 0.5, 0.78, 0.12, 0xf4f2ec, bold=0.04),
                                           c.text('AUTHORISED CLOWNS', 0.5, 0.45, 0.08, 0x1f2328), c.text('BEYOND THIS POINT', 0.5, 0.3, 0.08, 0x1f2328)))
    cell('no-slop', 0xf2c230, lambda c: ([c.rect(x, 0.07, 0.08, 0.14, 0x1f2328, turn=0.6) for x in np.linspace(0.05, 0.95, 7)],
                                        [c.rect(x, 0.93, 0.08, 0.14, 0x1f2328, turn=0.6) for x in np.linspace(0.05, 0.95, 7)],
                                        c.text('NO SLOP', 0.5, 0.6, 0.18, 0x1f2328, bold=0.05), c.text('BEYOND THIS POINT', 0.5, 0.38, 0.08, 0x1f2328)))
    # ---- Mexico
    cell('tacos', 0xb8262a, lambda c: (c.text('TACOS', 0.5, 0.66, 0.24, 0xf2c230, bold=0.06), c.text('EL SLOP', 0.5, 0.4, 0.14, 0xf4f2ec, bold=0.03),
                                      c.text('AL PASTOR  2 x 1', 0.5, 0.18, 0.07, 0xf2c230)))
    cell('farmacia', 0xf1efe8, lambda c: (c.rect(0.5, 0.66, 0.34, 0.1, 0x1d8a4e), c.rect(0.5, 0.66, 0.1, 0.34, 0x1d8a4e),
                                         c.text('FARMACIA', 0.5, 0.26, 0.13, 0x1d8a4e, bold=0.04)))
    cell('pinatas', 0xe34e8c, lambda c: ([c.text(ch, 0.14 + i * 0.12, 0.52, 0.17, colour, width=0.13, bold=0.05) for i, (ch, colour) in
                                          enumerate(zip('PIÑATAS', (0xf2c230, 0x2fb4c9, 0xf4f2ec, 0x6fd04a, 0xf2c230, 0x2fb4c9, 0xf4f2ec)))],
                                         c.text('PARA TODAS LAS FIESTAS', 0.5, 0.24, 0.06, 0xf4f2ec)))
    cell('helados', 0x9fd3e6, lambda c: (c.poly([(0.42, 0.62), (0.58, 0.62), (0.5, 0.32)], 0xd9a24a), c.circle(0.5, 0.68, 0.09, 0xf3b6c8),
                                        c.circle(0.5, 0.8, 0.07, 0xf4f2ec), c.text('HELADOS', 0.5, 0.16, 0.12, 0x234f8f, bold=0.04)))
    cell('aguas', 0xf28c28, lambda c: (c.text('AGUAS', 0.5, 0.66, 0.18, 0xf4f2ec, bold=0.05), c.text('FRESCAS', 0.5, 0.44, 0.14, 0x6fd04a, bold=0.04),
                                      c.text('JAMAICA  HORCHATA  LIMON', 0.5, 0.2, 0.05, 0xf4f2ec)))
    cell('lucha', 0x1f2328, lambda c: (clown(c, 0.3, 0.62, 0.16), c.circle(0.72, 0.62, 0.16, 0x2f58a8), c.circle(0.72, 0.62, 0.08, 0xf2c230),
                                      c.text('LUCHA LIBRE', 0.5, 0.3, 0.11, 0xf2c230, bold=0.04), c.text('EL PAYASO  vs  EL LAG', 0.5, 0.14, 0.06, 0xf4f2ec)))

    def talavera(c, ink, accent):
        for x in (0.25, 0.75):
            for y in (0.25, 0.75):
                for k in range(8):
                    t = k * math.tau / 8
                    c.circle(x + 0.13 * math.cos(t), y + 0.13 * math.sin(t), 0.055, ink)
                c.circle(x, y, 0.08, accent)
                c.circle(x, y, 0.035, ink)
        c.circle(0.5, 0.5, 0.06, accent)
        for x, y in ((0, 0), (1, 0), (0, 1), (1, 1), (0.5, 0), (0.5, 1), (0, 0.5), (1, 0.5)):
            c.circle(x, y, 0.05, accent)
    cell('talavera-blue', 0xf0ebe0, lambda c: talavera(c, 0x1f4a8a, 0xf2c230))
    cell('talavera-yellow', 0xf0ebe0, lambda c: talavera(c, 0xd9892a, 0x2f58a8))
    # ---- House
    cell('for-sale', 0xf4f2ec, lambda c: (c.rect(0.5, 0.78, 1, 0.26, 0xc8262a), c.text('FOR SALE', 0.5, 0.78, 0.14, 0xf4f2ec, bold=0.05),
                                         c.text('CALL 555-SLOP', 0.5, 0.42, 0.09, 0x1f2328, bold=0.03), c.text('HAUNTED? NO COMMENT', 0.5, 0.22, 0.055, 0x4a4d52)))
    cell('beware', 0xf4f2ec, lambda c: (c.text('BEWARE', 0.5, 0.7, 0.16, 0x1f2328, bold=0.05), c.text('OF CLOWN', 0.5, 0.46, 0.12, 0xc8262a, bold=0.04),
                                       c.circle(0.5, 0.2, 0.06, 0xd8261e)))
    cell('number', 0x1d2b44, lambda c: (c.rect(0.5, 0.5, 0.9, 0.9, 0xe6dcc6), c.rect(0.5, 0.5, 0.84, 0.84, 0x1d2b44), c.text('6', 0.5, 0.52, 0.55, 0xe6dcc6)))

    def portrait(c):
        c.rect(0.5, 0.25, 1, 0.5, 0x6d4f3a)
        for x, y, r in ((0.28, 0.5, 0.13), (0.72, 0.5, 0.13), (0.5, 0.38, 0.1)):
            c.circle(x, y - r * 1.4, r * 1.2, (0x2f58a8, 0x8a2f5a, 0x3f7a4a)[int(x * 3) % 3], ry=r * 0.9)
            clown(c, x, y, r)
    cell('portrait', 0x8a7a5e, portrait)

    def landscape(c):
        c.rect(0.5, 0.75, 1, 0.5, 0x86b3d6)
        c.circle(0.75, 0.75, 0.1, 0xf2d27a)
        c.circle(0.25, 0.1, 0.5, 0x6d8f4a, ry=0.45)
        c.circle(0.8, 0.05, 0.5, 0x5a7a3e, ry=0.4)
        c.rect(0.5, 0.05, 1, 0.1, 0x4a6536)
    cell('landscape', 0x86b3d6, landscape)
    cell('watch', 0xf4f2ec, lambda c: (c.circle(0.5, 0.62, 0.2, 0x1f2328, ry=0.11), c.circle(0.5, 0.62, 0.08, 0xf4f2ec), c.circle(0.5, 0.62, 0.04, 0x1f2328),
                                      c.text('NEIGHBOURHOOD', 0.5, 0.32, 0.08, 0x1f2328, bold=0.03), c.text('WATCH', 0.5, 0.17, 0.12, 0xc8262a, bold=0.04)))

    def drawing(c):
        c.rect(0.5, 0.36, 0.44, 0.3, 0xd9892a)
        c.poly([(0.24, 0.51), (0.76, 0.51), (0.5, 0.74)], 0xc8262a)
        c.rect(0.5, 0.29, 0.1, 0.16, 0x6b4a32)
        c.circle(0.84, 0.84, 0.08, 0xf2c230)
        c.rect(0.5, 0.18, 0.9, 0.03, 0x4fa83c)
        c.text('MY HOUSE', 0.5, 0.9, 0.07, 0x2f58a8)
    cell('drawing', 0xf6f4ee, drawing)
    cell('drive-slow', 0xf2c230, lambda c: (c.text('DRIVE SLOW', 0.5, 0.68, 0.14, 0x1f2328, bold=0.05), c.text('CLOWNS AT PLAY', 0.5, 0.42, 0.09, 0x1f2328, bold=0.03),
                                           c.circle(0.5, 0.2, 0.07, 0xd8261e)))
    return cells


def graffiti():
    """Two graffiti cells for the grime atlas: paint colours on white, as a multiplier."""
    out = []
    c = Canvas(0xffffff)
    for dx, dy in ((0.012, -0.012), (0.0, 0.0)):
        c.text('SLOP', 0.5 + dx, 0.5 + dy, 0.3, 0x1a1a1a if dx else 0xd23a8c, bold=0.09, turn=0.12)
    c.text('6', 0.83, 0.3, 0.2, 0x2f78c8, bold=0.08, turn=-0.2)
    out.append(c.render())
    c = Canvas(0xffffff)
    c.circle(0.5, 0.52, 0.34, 0x2a2a2a)
    c.circle(0.5, 0.52, 0.29, 0xffffff)
    for side in (-1, 1):
        c.circle(0.5 + side * 0.11, 0.6, 0.05, 0x2a2a2a, ry=0.07)
    c.circle(0.5, 0.5, 0.06, 0x2a2a2a)
    c.ring(0.5, 0.46, 0.17, 0.035, 0x2a2a2a)
    c.rect(0.5, 0.52, 0.4, 0.14, 0xffffff)
    c.circle(0.5, 0.5, 0.06, 0x2a2a2a)
    c.text('HONK', 0.5, 0.1, 0.1, 0x2a2a2a, bold=0.05)
    out.append(c.render())
    return out


# ------------------------------------------------------------------ grime

N = CELL
_ys, _xs = np.mgrid[0:N, 0:N]
U, V = (_xs + 0.5) / N, (_ys + 0.5) / N


def value_noise(scale, seed, octaves=4):
    """Fractal value noise over the cell, about 0..1 (smooth, not tiling)."""
    r = np.random.default_rng(seed)
    total, amp, norm = np.zeros((N, N)), 1.0, 0.0
    for o in range(octaves):
        g = int(scale * 2 ** o) + 2
        lattice = r.random((g + 1, g + 1))
        x, y = U * g, V * g
        i, j = np.floor(x).astype(int), np.floor(y).astype(int)
        fx_, fy = x - i, y - j
        fx_, fy = fx_ * fx_ * (3 - 2 * fx_), fy * fy * (3 - 2 * fy)
        a, b = lattice[j, i], lattice[j, i + 1]
        c, d = lattice[j + 1, i], lattice[j + 1, i + 1]
        total += amp * ((a * (1 - fx_) + b * fx_) * (1 - fy) + (c * (1 - fx_) + d * fx_) * fy)
        norm += amp
        amp *= 0.5
    return total / norm


def edge(width=0.12):
    """1 inside, 0 at the cell's border."""
    d = np.minimum(np.minimum(U, 1 - U), np.minimum(V, 1 - V))
    return fx.smoothstep(d, 0.0, width)


def stroke(canvas, points, width, amount, sharp=False):
    """Darken along a polyline (cell units), anti-aliased; `sharp` gives it a harder edge."""
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        dx, dy = x1 - x0, y1 - y0
        t = np.clip(((U - x0) * dx + (V - y0) * dy) / max(dx * dx + dy * dy, 1e-9), 0, 1)
        d = np.hypot(U - (x0 + t * dx), V - (y0 + t * dy))
        canvas[:] = np.maximum(canvas, amount * fx.smoothstep(d, width, width * (0.75 if sharp else 0.35)))


def crack_web(r, runs, steps, step, width, spur):
    """
    Darkness of a few cracks across the cell: jagged runs that keep a heading (small, frequent kinks), a sharp core
    `width` wide in a margin three times as wide at a quarter of its darkness (chipped edges), a short spur off a run
    with chance `spur` a step.
    """
    dark = np.zeros((N, N))
    for _ in range(runs):
        p, a = r.uniform(0.15, 0.85, 2), r.uniform(0, math.tau)
        heading = a
        pts = [tuple(p)]
        for _ in range(steps):
            a = heading + r.uniform(-0.55, 0.55)
            heading += r.uniform(-0.12, 0.12)
            p = p + step * np.array([math.cos(a), math.sin(a)])
            if np.any(p < 0.06) or np.any(p > 0.94):
                break
            pts.append(tuple(p))
            if r.random() < spur:
                b = a + r.choice([-1, 1]) * r.uniform(0.7, 1.3)
                q = p + r.uniform(0.03, 0.07) * np.array([math.cos(b), math.sin(b)])
                stroke(dark, [tuple(p), tuple(np.clip(q, 0.05, 0.95))], width * 0.6, 0.6, sharp=True)
        stroke(dark, pts, width * 3, 0.22)
        stroke(dark, pts, width, 0.9, sharp=True)
    return dark


def colour(dark, tint):
    """A multiplier from darkness (0 none, 1 full) and the colour full darkness multiplies by."""
    tint = np.array(props.srgb(tint))
    return 1 - dark[:, :, None] * (1 - tint[None, None, :])


def grime_cells():
    cells = []
    r = np.random.default_rng(21)
    # 0 wall grime rising from the base
    n = value_noise(5, 1)
    cells.append(('base', colour(np.clip((1 - V) ** 1.6 * (0.55 + 0.6 * n) - 0.08, 0, 1) * edge(0.08), 0x4a4540)))
    # 1 leaks running down from the top edge
    dark = np.zeros((N, N))
    for k in range(9):
        x = r.uniform(0.1, 0.9)
        length = r.uniform(0.35, 0.95)
        w = r.uniform(0.012, 0.035)
        wobble = 0.01 * np.sin(V * r.uniform(8, 20) + k)
        dark = np.maximum(dark, fx.smoothstep(np.abs(U - x - wobble), w, 0) * fx.smoothstep(1 - V, length, length * 0.4) * r.uniform(0.35, 0.8))
    dark = np.maximum(dark, fx.smoothstep(1 - V, 0.18, 0.0) * 0.45) * (0.7 + 0.4 * value_noise(8, 2))
    cells.append(('leaks', colour(np.clip(dark, 0, 1) * edge(0.06), 0x3f3a33)))
    # 2 a rust run from the top middle
    dark = np.zeros((N, N))
    for k in range(5):
        x = 0.5 + r.uniform(-0.12, 0.12)
        length = r.uniform(0.5, 0.95)
        spread = 0.02 + 0.07 * (1 - V)
        dark = np.maximum(dark, fx.smoothstep(np.abs(U - x), spread, 0) * fx.smoothstep(1 - V, length, 0.05) * r.uniform(0.5, 0.9))
    cells.append(('rust', colour(np.clip(dark * (0.8 + 0.6 * value_noise(10, 3)), 0, 1) * edge(0.06), 0x6a3016)))
    # 3 a damp patch
    rr = np.hypot(U - 0.5, (V - 0.45) * 1.2)
    n = value_noise(4, 4)
    cells.append(('damp', colour(np.clip(fx.smoothstep(rr + 0.25 * (n - 0.5), 0.45, 0.2) * (0.35 + 0.35 * value_noise(12, 5)), 0, 1) * edge(), 0x3d4a3c)))
    # 4 an oil stain
    rr = np.hypot(U - 0.5, V - 0.5)
    n = value_noise(3, 6)
    blot = fx.smoothstep(rr + 0.2 * (n - 0.5), 0.4, 0.28)
    ring = fx.smoothstep(np.abs(rr + 0.2 * (n - 0.5) - 0.36), 0.03, 0.0) * 0.4
    cells.append(('oil', colour(np.clip(blot * 0.75 + ring, 0, 1) * edge(), 0x1c1c1e)))
    # 5 broad ground grime
    n = value_noise(3, 7, 5)
    cells.append(('ground', colour(np.clip((n - 0.35) * 1.4, 0, 1) * 0.55 * edge(0.25), 0x3b3630)))
    # 6 cracks: a few jagged hairlines, a sharp dark core in a faint chipped margin, mostly straight runs (a slab's
    # crack follows its weakness, not a branching twig), with a short spur now and then
    cells.append(('cracks', colour(crack_web(r, runs=3, steps=26, step=0.022, width=0.0055, spur=0.12) * edge(0.05), 0x2a2622)))
    # 7 skid marks
    dark = np.zeros((N, N))
    for offset in (-0.12, 0.12):
        pts = [(0.5 + offset + 0.12 * math.sin(t * 2.2), 0.08 + 0.84 * t) for t in np.linspace(0, 1, 24)]
        stroke(dark, pts, 0.045, 0.55)
    cells.append(('skid', colour(dark * (0.6 + 0.5 * value_noise(20, 8)) * edge(0.05), 0x151517)))
    # 8 a road patch
    n = value_noise(6, 9)
    box_ = fx.smoothstep(np.maximum(np.abs(U - 0.5), np.abs(V - 0.5) * 1.3) + 0.04 * (n - 0.5), 0.4, 0.37)
    seam = fx.smoothstep(np.abs(np.maximum(np.abs(U - 0.5), np.abs(V - 0.5) * 1.3) - 0.385), 0.012, 0.0)
    cells.append(('patch', colour(np.clip(box_ * 0.32 + seam * 0.5, 0, 1) * edge(0.04), 0x2a2a2c)))
    # 9 a manhole cover's grooves
    rr = np.hypot(U - 0.5, V - 0.5)
    grid = (np.abs(((U - 0.5) * 14) % 1 - 0.5) < 0.12) | (np.abs(((V - 0.5) * 14) % 1 - 0.5) < 0.12)
    dark = fx.smoothstep(np.abs(rr - 0.42), 0.025, 0.005) * 0.85 + (rr < 0.38) * grid * 0.45 + (rr < 0.4) * 0.12
    cells.append(('cover', colour(np.clip(dark, 0, 1) * fx.smoothstep(rr, 0.47, 0.44), 0x232426)))
    # 10 a drain grate
    inside = (np.abs(U - 0.5) < 0.36) & (np.abs(V - 0.5) < 0.22)
    slots = np.abs(((U - 0.5) * 12) % 1 - 0.5) < 0.28
    dark = inside * (0.25 + slots * 0.65) + fx.smoothstep(np.maximum(np.abs(U - 0.5) - 0.36, np.abs(V - 0.5) - 0.22), 0.06, 0.0) * 0.35 * ~inside
    cells.append(('drain', colour(np.clip(dark, 0, 1) * edge(0.04), 0x141516)))
    # 11 soot fanning up from the bottom middle
    rr = np.hypot((U - 0.5) / (0.18 + 0.55 * V), V)
    cells.append(('soot', colour(np.clip(fx.smoothstep(rr, 1.0, 0.1) * (0.5 + 0.5 * value_noise(6, 10)) * 0.8, 0, 1) * edge(0.06), 0x1a1a1a)))
    # 12, 13 graffiti
    for name, rgba in zip(('graffiti-slop', 'graffiti-clown'), graffiti()):
        linear = rgba[:, :, :3].astype(np.float64) / 255
        linear = np.where(linear <= 0.04045, linear / 12.92, ((linear + 0.055) / 1.055) ** 2.4)
        grain = 0.85 + 0.15 * value_noise(30, 11 + len(cells))[:, :, None]
        cells.append((name, 1 - (1 - linear) * grain * edge(0.03)[:, :, None]))
    # 14 moss and lichen
    n = value_noise(6, 12, 5)
    cells.append(('moss', colour(np.clip((n - 0.45) * 2.2, 0, 1) * (1 - V) ** 0.6 * 0.6 * edge(), 0x4d6a2e)))
    # 15 a worn path: soft darker tracks along v
    n = value_noise(4, 13)
    dark = fx.smoothstep(np.abs(U - 0.5 - 0.05 * (n - 0.5)), 0.32, 0.05) * (0.25 + 0.2 * value_noise(16, 14))
    cells.append(('worn', colour(np.clip(dark, 0, 1) * edge(0.15), 0x3e3830)))
    # 16 a ground stain: a mottled dark blotch, strong enough to read on paving at 20 m
    rr = np.hypot(U - 0.5, V - 0.5)
    n = value_noise(4, 30)
    blob = fx.smoothstep(rr + 0.25 * (n - 0.5), 0.42, 0.22)
    cells.append(('stain', colour(np.clip(blob * (0.45 + 0.4 * value_noise(10, 31)), 0, 1) * edge(), 0x2e2a26)))
    # 17 a dried puddle: a faint fill inside dark tide lines
    rr2 = rr + 0.18 * (value_noise(3, 32) - 0.5)
    dark = fx.smoothstep(rr2, 0.4, 0.3) * 0.2 + fx.smoothstep(np.abs(rr2 - 0.37), 0.025, 0.0) * 0.5 + fx.smoothstep(np.abs(rr2 - 0.3), 0.015, 0.0) * 0.25
    cells.append(('puddle', colour(np.clip(dark, 0, 1) * edge(), 0x3a3630)))
    # 18 chewing gum and spots
    dark = np.zeros((N, N))
    for _ in range(70):
        cx, cy, rad = r.uniform(0.08, 0.92), r.uniform(0.08, 0.92), r.uniform(0.006, 0.016)
        dark = np.maximum(dark, fx.smoothstep(np.hypot(U - cx, V - cy), rad, rad * 0.4) * r.uniform(0.5, 0.85))
    cells.append(('gum', colour(dark * edge(0.05), 0x252422)))
    # 19 fallen leaves: brown ellipses
    dark = np.zeros((N, N))
    for _ in range(45):
        cx, cy, a = r.uniform(0.1, 0.9), r.uniform(0.1, 0.9), r.uniform(0, math.pi)
        lx, ly = r.uniform(0.025, 0.05), r.uniform(0.012, 0.024)
        du, dv = U - cx, V - cy
        e = np.hypot((du * math.cos(a) + dv * math.sin(a)) / lx, (-du * math.sin(a) + dv * math.cos(a)) / ly)
        dark = np.maximum(dark, fx.smoothstep(e, 1.0, 0.7) * r.uniform(0.55, 0.9))
    cells.append(('leaf-litter', colour(dark * edge(0.06), 0x7a4a1e)))
    # 20 tyre tracks: two treaded bands along v
    band = sum(fx.smoothstep(np.abs(U - c), 0.075, 0.055) for c in (0.3, 0.7))
    tread = (np.sin(V * 90) > 0.2) * 0.25
    cells.append(('tyres', colour(np.clip(band * (0.3 + tread) * (0.7 + 0.6 * value_noise(12, 36)), 0, 1) * edge(0.06), 0x1c1c1e)))
    # 21 dirt against an edge: darkest along v = 0 (laid against a wall's or a kerb's foot), fading out
    side = fx.smoothstep(U, 0.0, 0.08) * fx.smoothstep(1 - U, 0.0, 0.08)
    dark = (1 - V) ** 2.2 * (0.55 + 0.55 * value_noise(8, 33)) * side * fx.smoothstep(1 - V, 0.0, 0.1)
    cells.append(('edge-dirt', colour(np.clip(dark, 0, 1), 0x3a342c)))
    # 22 drifted sand over paving: tan blotches
    n = value_noise(3, 34, 5)
    cells.append(('sand-drift', colour(np.clip((n - 0.38) * 1.7, 0, 1) * 0.6 * edge(0.25), 0xb88a58)))
    # 23 scuffs: short grey arcs
    dark = np.zeros((N, N))
    for _ in range(26):
        cx, cy, rad, a0 = r.uniform(0.15, 0.85), r.uniform(0.15, 0.85), r.uniform(0.03, 0.08), r.uniform(0, math.tau)
        pts = [(cx + rad * math.cos(a0 + t), cy + rad * math.sin(a0 + t)) for t in np.linspace(0, r.uniform(0.6, 1.4), 8)]
        stroke(dark, pts, 0.005, r.uniform(0.25, 0.45))
    cells.append(('scuffs', colour(dark * edge(0.05), 0x2a2a2a)))
    # 24 wide cracks: the same, a little bolder and longer, for ground seen from further
    cells.append(('cracks-wide', colour(crack_web(r, runs=4, steps=30, step=0.024, width=0.008, spur=0.16) * edge(0.05), 0x26221e)))
    # 25 a water line: damp below a tide mark (basements, a wall's foot)
    dark = fx.smoothstep(np.abs(V - 0.55), 0.05, 0.0) * 0.35 + (V < 0.55) * 0.2 * (0.7 + 0.6 * value_noise(6, 35))
    cells.append(('water-line', colour(np.clip(dark, 0, 1) * edge(0.06), 0x3d4238)))
    # 26 rain streaks down a tall facade
    dark = np.zeros((N, N))
    for k in range(22):
        x = r.uniform(0.06, 0.94)
        length = r.uniform(0.4, 1.0)
        w = r.uniform(0.006, 0.02)
        dark = np.maximum(dark, fx.smoothstep(np.abs(U - x), w, 0) * fx.smoothstep(1 - V, length, length * 0.3) * r.uniform(0.2, 0.4))
    cells.append(('streaks', colour(np.clip(dark * (0.8 + 0.4 * value_noise(10, 37)), 0, 1) * edge(0.05), 0x45403a)))
    # 27 hairline plaster cracks, for rooms
    dark = np.zeros((N, N))
    p, a = np.array([0.2, 0.25]), 0.8
    pts = [tuple(p)]
    for _ in range(16):
        a += r.uniform(-0.5, 0.5)
        p = np.clip(p + 0.045 * np.array([math.cos(a), math.sin(a)]), 0.06, 0.94)
        pts.append(tuple(p))
        if r.random() < 0.3:
            b = a + r.choice([-1, 1]) * r.uniform(0.5, 1.1)
            stroke(dark, [tuple(p), tuple(np.clip(p + 0.07 * np.array([math.cos(b), math.sin(b)]), 0.05, 0.95))], 0.004, 0.6)
    stroke(dark, pts, 0.006, 0.8)
    cells.append(('plaster-crack', colour(dark * edge(0.05), 0x2a2622)))
    # 28 grime in paving joints, for a square of six tiles
    joints = np.minimum(np.abs(((U * 6) % 1) - 0.5), np.abs(((V * 6) % 1) - 0.5))
    dark = fx.smoothstep(0.5 - joints, 0.06, 0.0) * 0.4 + 0.12 * value_noise(8, 38)
    cells.append(('tile-grime', colour(np.clip(dark * (0.6 + 0.6 * value_noise(3, 39)), 0, 1) * edge(0.2), 0x2f2a24)))
    # 29 a burn scar
    n = value_noise(4, 40)
    cells.append(('burn', colour(np.clip(fx.smoothstep(rr + 0.22 * (n - 0.5), 0.45, 0.08) * 0.85, 0, 1) * edge(), 0x151412)))
    # 30 mud and bare earth, for a lawn's worn edge
    n = value_noise(5, 41, 5)
    cells.append(('dirt', colour(np.clip((n - 0.3) * 1.5, 0, 1) * 0.65 * edge(0.2), 0x5a4428)))
    # 31 dusty footprints along v
    dark = np.zeros((N, N))
    for k in range(9):
        cx, cy = 0.5 + (0.08 if k % 2 else -0.08) + r.uniform(-0.02, 0.02), 0.08 + k * 0.1
        e = np.hypot((U - cx) / 0.035, (V - cy) / 0.06)
        dark = np.maximum(dark, fx.smoothstep(e, 1.0, 0.6) * r.uniform(0.25, 0.4))
    cells.append(('footprints', colour(dark * edge(0.04), 0x3a342c)))
    return cells


def to_cell(multiplier):
    """A linear multiplier (N, N, 3) as an sRGB RGBA8 cell."""
    rgb = fx.to_srgb(np.clip(multiplier, 0, 1))
    return np.concatenate([fx.u8(rgb), np.full((N, N, 1), 255, np.uint8)], axis=2)


out, _ = props.options()
fx.reset(samples=16)
scene = bpy.context.scene
scene.render.film_transparent = False
scene.cycles.pixel_filter_type = 'GAUSSIAN'
scene.cycles.filter_width = 1.2
fx.camera((0.5, 0.5, 5.0), (0.5, 0.5, 0.0), 1.0)
sign_cells = signs()
fx.write_atlas(out, 'signs', 8, 4, [c for _, c in sign_cells], {name: [i, 1] for i, (name, _) in enumerate(sign_cells)}, alpha=False)
grime = grime_cells()
fx.write_atlas(out, 'grime', 8, 4, [to_cell(m) for _, m in grime], {name: [i, 1] for i, (name, _) in enumerate(grime)}, alpha=False)

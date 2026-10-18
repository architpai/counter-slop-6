"""
The decal atlases (docs/VISUALS.md, R5): bullet holes per surface family and
the scorch of an explosion, as albedo + alpha (RGBA, sRGB) and a tangent-space
normal map (RGB), on the same 4 x 4 grid.

  cells 0-1    metal: a punched hole in a raised crown, chipped paint round it, a soot ring
  cells 2-4    masonry (concrete, plaster, brick, stucco, adobe): a dark hole in a shadowed crater
               of broken material, radial cracks and a faint dust halo
  cells 5-7    wood: a dark hole in a narrow rim of torn, lighter fibres along the grain (v)
  cells 8-9    glass: a small hole in a frosted ring, radial cracks and broken arcs
  cells 10-11  soft ground (soil, sand, grass): a dark pit in a ring of kicked-up earth
  cell  12     scorch: a sooty star of an explosion, 2-3 m across in the game
  cells 13-15  blood, near white (the game tints it crimson per decal): a directional spatter thrown
               along +u from a splash at (0.3, 0.5); a round splat with a spiked crown and satellite
               drops, centred; a smear at the top with runs dripping down (-v) into beads

Each cell is an EMIT bake of a procedural node graph over a 1 x 1 plane
(albedo, alpha and height), with the normal map derived from the height in
numpy. Masonry, wood and soil are neutral grey: the game multiplies each by
the hit surface's colour over the grey its rim is here (`SURFACE_GREY`,
mirrored in effects-real.ts `DECAL_GREY`), so a hole's rim is the wall's own
colour and only the crater and hole read, darker, on any wall: one masonry
hole serves grey concrete, orange sandstone and red brick. Metal's chipped
paint and glass's cracks keep their own greys.
"""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import lib  # noqa: E402

COLS, ROWS = 4, 4
CELL = lib.CELL_SIZES[0]
LAYOUT = {'metal': [0, 2], 'masonry': [2, 3], 'wood': [5, 3], 'glass': [8, 2], 'soil': [10, 2], 'scorch': [12, 1], 'blood': [13, 3]}
# The grey of a tinted family's rim, where it meets the surface (the game's tint is the surface's colour over it).
SURFACE_GREY = {'masonry': 0.5, 'wood': 0.45, 'soil': 0.5}


def polar(g):
    cx, cy = g.u - 0.5, g.v - 0.5
    return cx, cy, g.length(cx, cy) * 2, g.atan2(cy, cx)


def uv(g, su=1.0, sv=1.0):
    return g.vector(g.u * su, g.v * sv, 0.0)


def metal(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 7.0, seed)
    n2 = g.noise(uv(g), 3.0, seed + 5)
    hole = g.smooth(r + (n - 0.5) * 0.04, 0.2, 0.14)
    lip = g.smooth(r + (n - 0.5) * 0.06, 0.3, 0.2) * (1 - hole)
    chipped = g.smooth(r + (n2 - 0.5) * 0.3, 0.46, 0.34)
    scratches = g.smooth(g.abs(g.sin(theta * 11 + n * 4)), 0.1, 0.0) * chipped * (1 - lip)
    soot = g.smooth(r + (n - 0.5) * 0.2, 0.66, 0.34)
    grey = 0.05 + chipped * 0.13 + lip * 0.4 + scratches * 0.16
    grey = grey * (1 - hole * 0.95)
    alpha = g.clamp(g.max(chipped, soot * 0.55) + hole)
    height = lip * 0.5 - hole * 1.2 - chipped * 0.12 + (n - 0.5) * 0.06
    return {'albedo': g.vector(grey, grey, grey * 1.03), 'alpha': alpha, 'height': height}, 7.0


def masonry(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 6.0, seed, detail=6.0, roughness=0.65)
    fine = g.noise(uv(g), 22.0, seed + 3)
    crater = g.smooth(r + (n - 0.5) * 0.3, 0.5, 0.36)
    # Its outer part fades into the wall: the wall's baked light and the decal's probe light differ in
    # shade, and an opaque rim lit apart from the wall showed as a pale ring. Only the dark inside is solid.
    solid = g.smooth(r + (n - 0.5) * 0.3, 0.5, 0.24)
    hole = g.smooth(r + (n - 0.5) * 0.1, 0.24, 0.15)
    deep = g.smooth(r + (n - 0.5) * 0.1, 0.48, 0.2)
    halo = g.smooth(r + (n - 0.5) * 0.3, 0.92, 0.5) * (1 - crater)
    crack = g.smooth(g.abs(g.sin(theta * 2.5 + n * 5)), 0.09, 0.0) * g.smooth(r + (fine - 0.5) * 0.3, 0.85, 0.4) * (1 - crater)
    # The rim is the wall's own grey; the crater's broken walls are in their own shadow, darker towards the hole.
    grey = SURFACE_GREY['masonry'] * (1 + (fine - 0.5) * 0.3)
    grey = grey * (1 - crack * 0.6) * (1 - crater * (0.3 + 0.4 * deep)) * (1 - hole * 0.94)
    alpha = g.clamp(solid + halo * 0.18 * fine + crack * 0.55 + hole)
    height = -crater * 0.5 - hole * 1.2 + crater * (fine - 0.5) * 0.4 - crack * 0.25
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 6.0


def wood(g, seed):
    cx, cy, r, theta = polar(g)
    fibre = g.noise(uv(g, 18.0, 1.5), 1.0, seed, detail=3.0)
    n = g.noise(uv(g), 5.0, seed + 2)
    # A narrow lens along the grain: the torn fibres, lighter raw wood under the stain or paint.
    lens = g.length(cx * 2 / 0.3, cy * 2 / 0.62)
    torn = g.smooth(lens + (fibre - 0.5) * 0.7 + (n - 0.5) * 0.25, 0.95, 0.62)
    pit = g.smooth(r + (n - 0.5) * 0.08, 0.26, 0.13)
    hole = g.smooth(r + (n - 0.5) * 0.05, 0.14, 0.08)
    grey = (0.52 + 0.2 * fibre) * (1 - pit * 0.55) * (1 - hole * 0.95)
    alpha = g.clamp(torn * 0.9 + hole)
    height = torn * (fibre - 0.3) * 0.5 - pit * 0.4 - hole * 1.1
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 5.0


def glass(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 4.0, seed)
    hole = g.smooth(r, 0.06, 0.035)
    frost = g.smooth(r + (n - 0.5) * 0.08, 0.16, 0.08) * (1 - hole)
    radial = g.smooth(g.abs(g.sin(theta * 3.5 + n * 2.2)), 0.035, 0.0) * g.smooth(r + (n - 0.5) * 0.3, 0.95, 0.5)
    arcs = g.smooth(g.abs(g.sin(r * 22 + n * 3)), 0.06, 0.0) * g.smooth(n, 0.55, 0.65) * g.smooth(r, 0.7, 0.4) * g.smooth(r, 0.12, 0.2)
    crack = g.max(radial, arcs)
    grey = 0.12 * hole + 0.92 * (1 - hole)
    alpha = g.clamp(hole * 0.85 + frost * 0.7 + crack * 0.8)
    height = -hole - crack * 0.3 + frost * 0.15
    return {'albedo': g.vector(grey * 0.95, grey, grey), 'alpha': alpha, 'height': height}, 4.0


def soil(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 5.0, seed, detail=6.0)
    grain = g.noise(uv(g), 30.0, seed + 4)
    pit = g.smooth(r + (n - 0.5) * 0.25, 0.42, 0.2)
    solid = g.smooth(r + (n - 0.5) * 0.25, 0.42, 0.12)
    ring = g.smooth(r + (n - 0.5) * 0.4, 0.85, 0.4) * (1 - pit)
    # Kicked-up earth round the pit is a little darker than the ground; the pit itself is in its own shadow.
    grey = SURFACE_GREY['soil'] * (0.75 + 0.35 * grain) * (1 - pit * 0.75)
    alpha = g.clamp(solid * 0.95 + ring * 0.5 * g.smooth(grain, 0.3, 0.6))
    height = -pit * 0.9 + ring * 0.25 * grain
    return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, 4.0


def scorch(g, seed):
    cx, cy, r, theta = polar(g)
    n = g.noise(uv(g), 3.0, seed, detail=6.0, roughness=0.6)
    fine = g.noise(uv(g), 16.0, seed + 1)
    soot = g.smooth(r + (n - 0.5) * 0.45, 0.92, 0.35)
    streak = g.noise(g.vector(g.cos(theta) * 2.0, g.sin(theta) * 2.0, r * 0.4), 1.6, seed + 2, detail=3.0)
    rays = g.smooth(streak, 0.5, 0.75) * g.smooth(r + (n - 0.5) * 0.3, 0.97, 0.4)
    grey = 0.025 + 0.05 * fine + (1 - soot) * 0.04
    alpha = g.clamp((soot * 0.95 + rays * 0.5) * (0.75 + 0.3 * fine))
    height = (fine - 0.5) * 0.15 * soot
    return {'albedo': g.vector(grey, grey * 0.97, grey * 0.94), 'alpha': alpha, 'height': height}, 1.5


# ------------------------------------------------------------------- blood
# Blood is a union of shapes (signed distances in uv, negative inside) merged by a soft minimum
# (-k log sum exp(-d / k), so drops that touch flow into each other), over coordinates warped by noise
# so that no edge is a clean circle. The shapes' places and sizes come from a seeded random generator.

TEXEL = 1.0 / CELL
MARGIN = 0.06


def at(c, angle, distance):
    return c[0] + math.cos(angle) * distance, c[1] + math.sin(angle) * distance


def inside(p, pad=0.1):
    return pad <= p[0] <= 1 - pad and pad <= p[1] <= 1 - pad


class Blood:
    def __init__(self, g, seed, warp=0.05, rough=0.018, sway=0.0, k=0.0045):
        self.g, self.k, self.sum = g, k, None
        base = uv(g)
        self.pu = g.u + (g.noise(base, 3.5, seed) - 0.5) * warp + (g.noise(base, 17.0, seed, detail=3.0) - 0.5) * rough
        self.pv = g.v + (g.noise(base, 3.5, seed + 1) - 0.5) * warp + (g.noise(base, 17.0, seed + 1, detail=3.0) - 0.5) * rough
        if sway:
            # Runs down a wall wander side to side as they go.
            self.pu = self.pu + (g.noise(g.vector(0.0, g.v * 2.0, 0.0), 2.5, seed + 2, detail=2.0) - 0.5) * sway

    def add(self, d):
        e = self.g.exp(d * (-1.0 / self.k))
        self.sum = e if self.sum is None else self.sum + e

    def disc(self, c, r, stretch=1.0, angle=0.0):
        """A round drop of radius `r`, or an ellipse `stretch` times longer along `angle`."""
        g = self.g
        x, y = self.pu - c[0], self.pv - c[1]
        if stretch == 1.0:
            self.add(g.length(x, y) - r)
            return
        ca, sa = math.cos(angle), math.sin(angle)
        lx, ly = x * ca + y * sa, y * ca - x * sa
        self.add((g.length(lx * (1 / (r * stretch)), ly * (1 / r)) - 1) * r)

    def stroke(self, a, b, ra, rb):
        """A tapered streak from `a` (radius `ra`) to `b` (radius `rb`)."""
        g = self.g
        x, y = self.pu - a[0], self.pv - a[1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = g.clamp((x * dx + y * dy) * (1 / (dx * dx + dy * dy)))
        self.add(g.length(x - t * dx, y - t * dy) - (t * (rb - ra) + ra))

    def mist(self, scale, chance, radius, where):
        """Fine droplets: a Voronoi point in `chance` of the cells, `radius` (uv) where `where` is 1."""
        g = self.g
        cells = g.node('ShaderNodeTexVoronoi', voronoi_dimensions='2D', feature='F1', distance='EUCLIDEAN')
        g.put(cells.inputs['Vector'], g.vector(self.pu, self.pv, 0.0))
        g.put(cells.inputs['Scale'], scale)
        g.put(cells.inputs['Randomness'], 0.9)
        pick = g.node('ShaderNodeTexWhiteNoise', noise_dimensions='3D')
        g.nt.links.new(cells.outputs['Position'], pick.inputs['Vector'])
        on = g.smooth(lib.Value(g, pick.outputs['Value']), 1 - chance, 1 - chance + 0.01) * where
        self.add(lib.Value(g, cells.outputs['Distance']) * (1 / scale) - radius * on + (1 - on) * 0.05)

    def channels(self, seed, strength=5.0):
        g = self.g
        sdf = -self.k * g.math('LOGARITHM', self.sum + 1e-30, math.e)
        border = (g.smooth(g.u, MARGIN, MARGIN + 0.02) * g.smooth(g.u, 1 - MARGIN, 1 - MARGIN - 0.02)
                  * g.smooth(g.v, MARGIN, MARGIN + 0.02) * g.smooth(g.v, 1 - MARGIN, 1 - MARGIN - 0.02))
        # Crisp, but anti-aliased over about one and a half texels.
        alpha = g.smooth(sdf, 0.8 * TEXEL, -0.8 * TEXEL) * border
        depth = -sdf
        thick = g.smooth(depth, 0.0, 0.035)
        mottle = g.noise(uv(g), 9.0, seed + 9, detail=4.0)
        # Lighter at the thin edges, darker where it pools: once tinted crimson it reads with depth.
        grey = 1.0 - thick * (0.17 + 0.16 * mottle)
        # A raised, rounded edge and a slightly domed top: the wet gloss of the normal map.
        height = g.smooth(depth, 0.0, 0.02) * 0.45 + thick * 0.35 + (mottle - 0.5) * 0.12 * thick
        return {'albedo': g.vector(grey, grey, grey), 'alpha': alpha, 'height': height}, strength


def spatter(g, seed):
    """An impact spatter thrown along +u from a splash at (0.3, 0.5): streaks, exclamation drops and dots."""
    rng = np.random.default_rng(seed + 1301)
    f = Blood(g, seed)
    c = (0.3, 0.5)
    # The main splash: a core stretched along the throw, its edge scalloped by lobes, more of them forwards.
    f.disc((0.31, 0.5), 0.074, stretch=1.35, angle=rng.normal(0, 0.1))
    for a in rng.normal(0, 1.4, 10):
        f.disc(at(c, a, rng.uniform(0.045, 0.075)), rng.uniform(0.014, 0.032))
    # Its crown: spikes of every width and length, the long ones forwards.
    for a in rng.normal(0, 1.0, 15):
        end = 0.08 + 0.1 * max(0.0, math.cos(a)) * rng.random() ** 1.4
        f.stroke(at(c, a, 0.05), at(c, a, end), rng.uniform(0.009, 0.02), rng.uniform(0.003, 0.0045))
    # Thin streaks fanning out from the splash.
    for _ in range(6):
        a, end = rng.normal(0, 0.33), rng.uniform(0.24, 0.44)
        if not inside(at(c, a, end + 0.02)):
            continue
        f.stroke(at(c, a, 0.08), at(c, a, end), rng.uniform(0.005, 0.008), 0.003)
        if rng.random() < 0.5:
            f.disc(at(c, a, end + 0.014), rng.uniform(0.004, 0.006))
    # Exclamation drops: a head thrown far, its tail pointing back at the splash, smaller further out.
    placed = 0
    while placed < 16:
        a, d = rng.normal(0, 0.3), 0.2 + 0.42 * rng.random() ** 1.3
        if not inside(at(c, a, d + 0.03)):
            continue
        placed += 1
        fall = 1 - (d - 0.2) / 0.5
        r = (0.0055 + 0.011 * fall) * rng.uniform(0.75, 1.15)
        f.disc(at(c, a, d), r, stretch=1.35, angle=a)
        start = d - r * (2.4 if rng.random() < 0.35 else 0.6)
        f.stroke(at(c, a, start), at(c, a, start - r * rng.uniform(2.5, 6.0) - 0.01), r * 0.55, max(0.0035, r * 0.22))
    # Small round dots, mostly ahead; a few thrown back behind the splash.
    placed = 0
    while placed < 18:
        back = placed >= 14
        a = np.pi + rng.normal(0, 0.6) if back else rng.normal(0, 0.55)
        d = rng.uniform(0.12, 0.2) if back else rng.uniform(0.14, 0.62)
        if not inside(at(c, a, d), 0.09):
            continue
        placed += 1
        f.disc(at(c, a, d), (0.003 + 0.006 * max(0.0, 1 - (d - 0.14) / 0.5)) * rng.uniform(0.7, 1.2))
    # A mist of fine droplets ahead of the splash, finer further out.
    x, y = f.pu - c[0], f.pv - c[1]
    d, a = g.length(x, y), g.abs(g.atan2(y, x))
    where = g.smooth(a, 0.75, 0.35) * g.smooth(d, 0.13, 0.18) * g.smooth(d, 0.6, 0.5)
    f.mist(46.0, 0.22, 0.0058 - d * 0.006, where)
    return f.channels(seed)


def splat(g, seed):
    """A roughly round pool with a crown of short spikes and a ring of satellite drops, centred."""
    rng = np.random.default_rng(seed + 1402)
    f = Blood(g, seed, warp=0.08, rough=0.024)
    c = (0.5 + rng.uniform(-0.01, 0.01), 0.5 + rng.uniform(-0.01, 0.01))
    # The pool: a core and lobes of different sizes round its edge, so the outline is lumpy, not round.
    f.disc(c, 0.135, stretch=1.12, angle=rng.uniform(0, np.pi))
    for a in rng.uniform(0, 2 * np.pi, 11):
        f.disc(at(c, a, rng.uniform(0.08, 0.14)), rng.uniform(0.028, 0.06))
    # The crown: mostly short spikes and bumps, a few long ones ending in a bead, at random angles.
    for a in rng.uniform(0, 2 * np.pi, 30):
        end = 0.17 + 0.13 * rng.random() ** 2.2
        f.stroke(at(c, a, 0.12), at(c, a, end), rng.uniform(0.008, 0.022), rng.uniform(0.003, 0.0055))
        if end > 0.23 and rng.random() < 0.6:
            f.disc(at(c, a, end + rng.uniform(0.008, 0.016)), rng.uniform(0.005, 0.009))
    # The ring of satellites, smaller further out, some pulled into a tail pointing back at the pool.
    for _ in range(30):
        a, d = rng.uniform(0, 2 * np.pi), 0.24 + 0.14 * rng.random() ** 0.7
        r = rng.uniform(0.003, 0.011) * (1.3 - (d - 0.24) * 3)
        if rng.random() < 0.4:
            f.disc(at(c, a, d), r, stretch=1.4, angle=a)
            f.stroke(at(c, a, d - r * 0.6), at(c, a, d - r * 4.5), r * 0.5, 0.003)
        else:
            f.disc(at(c, a, d), r)
    return f.channels(seed)


def drips(g, seed):
    """A smear at the top of a wall with runs dripping down (-v), each ending in a bead."""
    rng = np.random.default_rng(seed + 1503)
    f = Blood(g, seed, warp=0.04, rough=0.016, sway=0.06)
    top = 0.79
    # The smear: a band wiped along u, thicker in the middle, its ends and edges lumpy.
    f.stroke((0.19, top + 0.012), (0.5, top), 0.032, 0.042)
    f.stroke((0.5, top), (0.79, top + 0.016), 0.042, 0.03)
    f.disc((0.16, top + 0.018), 0.026, stretch=1.3, angle=0.3)
    f.disc((0.83, top + 0.024), 0.022, stretch=1.25, angle=-0.2)
    for x in rng.uniform(0.16, 0.84, 9):
        f.disc((x, top + rng.normal(0, 0.026)), rng.uniform(0.016, 0.034), stretch=rng.uniform(1.1, 1.7), angle=rng.normal(0, 0.4))
    for x in rng.uniform(0.2, 0.8, 4):
        f.disc((x, top + rng.uniform(0.07, 0.09)), rng.uniform(0.004, 0.008))
    # Three runs of different lengths, thinning as they go, each with a fatter bead at its end.
    for x, end in zip((0.29, 0.5, 0.69) + rng.normal(0, 0.02, 3), rng.permutation([0.14, 0.27, 0.44])):
        foot = x + rng.normal(0, 0.015)
        f.disc((x, top - 0.03), 0.019)
        f.stroke((x, top - 0.03), (foot, end + 0.02), rng.uniform(0.009, 0.013), rng.uniform(0.006, 0.0075))
        f.disc((foot, end), rng.uniform(0.016, 0.019), stretch=1.3, angle=np.pi / 2)
    # One that stopped short: a bead hanging under the smear.
    x = rng.choice([0.4, 0.6]) + rng.normal(0, 0.01)
    f.stroke((x, top - 0.03), (x, top - 0.08), 0.012, 0.009)
    f.disc((x, top - 0.095), 0.014, stretch=1.2, angle=np.pi / 2)
    return f.channels(seed)


def bake(make, seed):
    lib.reset(samples=16)
    g = lib.VolumeGraph(f'{make.__name__}-{seed}')
    channels, strength = make(g, seed)
    baked = lib.bake_plane(g, channels, CELL)
    albedo = np.clip(baked['albedo'], 0, 1)
    alpha = np.clip(baked['alpha'][:, :, 0], 0, 1)
    h = lib.blur(baked['height'][:, :, 0], 1)
    # Height is in hole depths; a depth of 1 over about 12 texels is a steep crater wall.
    dy, dx = np.gradient(h)
    normal = np.stack([-dx * strength, -dy * strength, np.ones_like(h)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Fade the relief out with the alpha, so a decal's edge is flat where it meets the wall's own normal.
    normal = normal * alpha[:, :, None] + np.array([0.0, 0.0, 1.0]) * (1 - alpha[:, :, None])
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    # Colour where the decal is (almost) clear takes its neighbourhood's, as the lit atlas does.
    colour, _ = lib.straight(np.concatenate([albedo * alpha[:, :, None], alpha[:, :, None]], axis=2))
    rgba = np.concatenate([lib.u8(lib.to_srgb(colour)), lib.u8(alpha)[:, :, None]], axis=2)
    nrm = np.concatenate([lib.u8(normal * 0.5 + 0.5), np.full((CELL, CELL, 1), 255, np.uint8)], axis=2)
    return rgba, nrm


def main():
    out = lib.args()
    albedo, normal = [None] * (COLS * ROWS), []
    flat = np.concatenate([np.full((CELL, CELL, 2), 128, np.uint8), np.full((CELL, CELL, 2), 255, np.uint8)], axis=2)
    normal = [flat] * (COLS * ROWS)
    # A family's cells are one maker with a seed each, or (blood) one maker a cell.
    families = (('metal', metal), ('masonry', masonry), ('wood', wood), ('glass', glass), ('soil', soil), ('scorch', scorch),
                ('blood', (spatter, splat, drips)))
    for name, make in families:
        first, count = LAYOUT[name]
        makes = make if isinstance(make, tuple) else (make,) * count
        assert len(makes) == count, name
        for i, each in enumerate(makes):
            albedo[first + i], normal[first + i] = bake(each, 11 + 17 * i)
    lib.write_atlas(out, 'decals', COLS, ROWS, albedo, LAYOUT, alpha=True)
    lib.write_atlas(out, 'decals-normal', COLS, ROWS, normal, LAYOUT, alpha=False, srgb=False)


main()

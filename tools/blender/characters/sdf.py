"""
Signed distance fields in numpy and a surface-nets mesher, for the soft
shapes of the operators (docs/VISUALS.md, R7): the clothed body, the head,
boots and soft gear are unions of round cones and ellipsoids blended with a
smooth minimum, so muscles, folds of cloth and joints flow into each other
the way a sculpt does, and the result is a closed, even mesh.

Coordinates are the game's: metres, +Y up, +Z forward (the caller converts
to Blender's). Nothing here touches bpy.
"""

import numpy as np


def ellipsoid(p, centre, radii):
    """Approximate distance to an ellipsoid (exact on its axes, close elsewhere)."""
    q = (p - np.asarray(centre, np.float32)) / np.asarray(radii, np.float32)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.asarray(radii, np.float32), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def round_cone(p, a, b, ra, rb):
    """Distance to a cone with round caps from `a` (radius `ra`) to `b` (radius `rb`)."""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    ba = b - a
    l2 = float(ba @ ba)
    rr = ra - rb
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    x = pa * l2 - y[..., None] * ba
    x2 = np.sum(x * x, axis=-1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d = np.where(np.sign(z) * a2 * z2 > k, np.sqrt(x2 + z2) * il2 - rb,
                 np.where(np.sign(y) * a2 * y2 < k, np.sqrt(x2 + y2) * il2 - ra,
                          (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra))
    return d


def box(p, centre, half, radius=0.0):
    """A rounded box: `half` its half sizes, edges rounded by `radius`."""
    q = np.abs(p - np.asarray(centre, np.float32)) - (np.asarray(half, np.float32) - radius)
    outside = np.linalg.norm(np.maximum(q, 0.0), axis=-1)
    inside = np.minimum(np.max(q, axis=-1), 0.0)
    return outside + inside - radius


def smin(a, b, k):
    """Polynomial smooth minimum: blends two fields over about `k` metres."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


class Field:
    """
    A shape built up from primitives: `add(fn, *args, blend=k)` smooth-unions
    a primitive into the field, `cut(...)` smooth-subtracts one. Evaluated
    lazily on a grid by `mesh()`.
    """

    def __init__(self):
        self.ops = []

    def add(self, fn, *args, blend=0.02):
        self.ops.append(('add', fn, args, blend))
        return self

    def cut(self, fn, *args, blend=0.005):
        self.ops.append(('cut', fn, args, blend))
        return self

    def warp(self, fn):
        """A function of the sample points applied before the next primitives (folds, bulges)."""
        self.ops.append(('warp', fn, None, 0))
        return self

    def evaluate(self, p):
        d = None
        q = p
        for op, fn, args, k in self.ops:
            if op == 'warp':
                q = fn(p)
                continue
            v = fn(q, *args)
            if d is None:
                d = v if op == 'add' else -v
            elif op == 'add':
                d = smin(d, v, k)
            else:
                d = smax(d, -v, k)
        return d


def surface_nets(field, lo, hi, step):
    """
    Mesh the zero surface of `field` (a function of an (..., 3) array of
    points) over the box `lo`..`hi` with cells `step` metres across: one
    vertex per cell the surface crosses, at the mean of its edges'
    crossings, and one quad per crossed grid edge. Returns (vertices (n, 3),
    quads (m, 4)), outward facing.
    """
    lo = np.asarray(lo, np.float32)
    hi = np.asarray(hi, np.float32)
    n = np.ceil((hi - lo) / step).astype(int) + 1
    axes = [lo[i] + step * np.arange(n[i], dtype=np.float32) for i in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing='ij'), axis=-1)
    d = np.empty(tuple(n), np.float32)
    # In slabs, so the temporaries stay small.
    for i in range(0, n[0], 16):
        d[i:i + 16] = field(grid[i:i + 16])
    inside = d < 0
    nx, ny, nz = n
    # Cells crossed by the surface: corners not all on one side.
    corners = [inside[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    count = sum(c.astype(np.int8) for c in corners)
    crossed = (count > 0) & (count < 8)
    index = -np.ones(crossed.shape, np.int64)
    cells = np.argwhere(crossed)
    index[crossed] = np.arange(len(cells))
    # Each crossed cell's vertex: the mean crossing point of its 12 edges.
    acc = np.zeros((len(cells), 3), np.float64)
    hits = np.zeros(len(cells), np.float64)
    ci, cj, ck = cells[:, 0], cells[:, 1], cells[:, 2]
    offsets = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    for a, b in edges:
        oa, ob = offsets[a], offsets[b]
        da = d[ci + oa[0], cj + oa[1], ck + oa[2]]
        db = d[ci + ob[0], cj + ob[1], ck + ob[2]]
        sel = (da < 0) != (db < 0)
        t = da / np.where(sel, da - db, 1.0)
        pa = np.stack([ci + oa[0], cj + oa[1], ck + oa[2]], -1).astype(np.float64)
        pb = np.stack([ci + ob[0], cj + ob[1], ck + ob[2]], -1).astype(np.float64)
        point = pa + (pb - pa) * t[:, None]
        acc[sel] += point[sel]
        hits[sel] += 1
    verts = lo + step * (acc / np.maximum(hits, 1)[:, None])
    quads = []
    # For every grid edge the surface crosses, the four cells around it make a quad.
    for axis in range(3):
        u, v = [a for a in range(3) if a != axis]
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, n[axis] - 1)
        sl1[axis] = slice(1, n[axis])
        a0 = inside[tuple(sl0)]
        a1 = inside[tuple(sl1)]
        flip = a0 & ~a1
        change = flip | (~a0 & a1)
        # Edges on the grid's border have no four cells round them.
        change[tuple(slice(None) if ax == axis else slice(0, 1) for ax in range(3))] = False
        change[tuple(slice(None) if ax == axis else slice(n[ax] - 1, None) for ax in range(3))] = False
        # (the second pair of borders per axis)
        for ax in (u, v):
            s = [slice(None)] * 3
            s[ax] = slice(0, 1)
            change[tuple(s)] = False
            s[ax] = slice(n[ax] - 1, None)
            change[tuple(s)] = False
        e = np.argwhere(change)
        if len(e) == 0:
            continue
        f = flip[change]

        def cell(du, dv):
            c = e.copy()
            c[:, u] -= du
            c[:, v] -= dv
            return index[c[:, 0], c[:, 1], c[:, 2]]
        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], -1)
        # Wind so faces point from inside to outside.
        q = np.where(f[:, None] ^ (axis == 1), q[:, ::-1], q)
        quads.append(q[(q >= 0).all(axis=1)])
    return verts.astype(np.float32), np.concatenate(quads) if quads else np.zeros((0, 4), np.int64)

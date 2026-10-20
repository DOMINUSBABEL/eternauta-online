"""
Edificios y piezas únicas: Casa Rosada, Cabildo, Pirámide de Mayo, canteros.

La Casa Rosada se construye en coordenadas del mundo siguiendo la línea de
fachada medida en el splat (Marble la generó curva). El resto se arma en
espacio local y se ubica con el layout.
"""

import math
import random

from mathutils import Matrix, Vector

from assets_small import box_c, cyl_c, text_into
from lib import Builder, snow_caps


def g2b(x, z, y=0.0):
    """Coordenadas del juego → Blender."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------------------
# Canteros
# ---------------------------------------------------------------------------


def cantero(M, length, width, name, seed=0, height=0.45):
    rnd = random.Random(seed)
    b = Builder(name)
    t = 0.2
    L, W, h = length, width, height
    b.box(M["granito"], (L, t, h), center=(0, -W / 2 + t / 2, h / 2))
    b.box(M["granito"], (L, t, h), center=(0, W / 2 - t / 2, h / 2))
    b.box(M["granito"], (t, W - 2 * t, h), center=(-L / 2 + t / 2, 0, h / 2))
    b.box(M["granito"], (t, W - 2 * t, h), center=(L / 2 - t / 2, 0, h / 2))
    b.box(M["tierra"], (L - 2 * t, W - 2 * t, 0.05), center=(0, 0, h - 0.1))
    area = (L - 2 * t) * (W - 2 * t)
    # matas densas (como en el splat): grilla con jitter, 30 % de alta resolución
    n = max(2, int(area / 0.6))
    cols = max(1, round(math.sqrt(n * (L - 2 * t) / max(W - 2 * t, 0.1))))
    rows = max(1, math.ceil(n / cols))
    for k in range(cols * rows):
        i, j = k % cols, k // cols
        r = rnd.uniform(0.42, 0.66)
        x = -L / 2 + t + (i + 0.5 + rnd.uniform(-0.3, 0.3)) * (L - 2 * t) / cols
        y = -W / 2 + t + (j + 0.5 + rnd.uniform(-0.3, 0.3)) * (W - 2 * t) / rows
        c = Vector((x, y, h - 0.12 + r * rnd.uniform(0.3, 0.6)))
        faces = b.sphere(M["arbusto"], r, center=tuple(c), subdiv=2 if rnd.random() < 0.3 else 1, scale=(1.3, 1.3, 0.8))
        for v in {v for f in faces for v in f.verts}:
            d = v.co - c
            v.co += d.normalized() * r * rnd.uniform(-0.14, 0.12)
    snow_caps(b, M["nieve"], min_nz=0.975, thick=0.05, min_area=0.01, paint=(M["arbusto"],))
    obj = b.finish(uv_tiles={"Granito": 1.2})
    return obj, {
        "collide": [box_c((0, 0, 0.3), (L, W, 0.6))],
        "carve": [box_c((0, 0, 0.7), (L + 0.4, W + 0.4, 1.8))],
    }


# ---------------------------------------------------------------------------
# Pirámide de Mayo
# ---------------------------------------------------------------------------


def piramide(M):
    b = Builder("piramide")
    P, G = M["piedra"], M["granito"]
    # plataforma circular con dos escalones
    b.cyl(G, 4.9, 4.9, 0.22, center=(0, 0, 0.11), segs=40)
    b.cyl(G, 4.3, 4.3, 0.22, center=(0, 0, 0.33), segs=40)
    # reja circular
    R = 3.0
    nb = 80
    for k in range(nb):
        a = 2 * math.pi * k / nb
        x, y = math.cos(a) * R, math.sin(a) * R
        b.cyl(M["hierro"], 0.018, 0.018, 1.3, center=(x, y, 0.44 + 0.65), segs=4, caps=False)
        b.cyl(M["hierro"], 0.035, 0.0, 0.12, center=(x, y, 0.44 + 1.36), segs=4)
    for z in (0.62, 1.62):
        b.tube(M["hierro"], [(math.cos(2 * math.pi * k / 48) * R, math.sin(2 * math.pi * k / 48) * R, 0.44 + z - 0.44) for k in range(49)], 0.025, 4)
    for k in range(8):
        a = 2 * math.pi * k / 8
        b.box(M["hierro"], (0.09, 0.09, 1.55), center=(math.cos(a) * R, math.sin(a) * R, 0.44 + 0.78))
    b.cyl(G, R + 0.2, R + 0.2, 0.16, center=(0, 0, 0.52), segs=40)
    # pedestal
    z = 0.6
    for w, h in ((3.3, 0.35), (3.0, 0.3)):
        b.box(P, (w, w, h), center=(0, 0, z + h / 2))
        z += h
    b.box(P, (2.5, 2.5, 2.4), center=(0, 0, z + 1.2))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(P, (0.3, 0.3, 2.4), center=(sx * 1.2, sy * 1.2, z + 1.2))
    z += 2.4
    b.box(P, (2.8, 2.8, 0.25), center=(0, 0, z + 0.125))
    z += 0.25
    b.box(P, (2.2, 2.2, 0.5), center=(0, 0, z + 0.25))
    z += 0.5
    # medallones (soles) en las cuatro caras
    for k in range(4):
        a = k * math.pi / 2
        c = Vector((math.cos(a) * 1.26, math.sin(a) * 1.26, z - 2.0))
        b.cyl(M["oro"], 0.35, 0.35, 0.06, center=tuple(c), segs=16, axis="X" if k % 2 == 0 else "Y")
    # obelisco ahusado
    h_ob = 9.8
    b.cyl(P, 1.25 / math.sqrt(2) * 1.414 * 0.72, 0.78 * 0.72, h_ob, center=(0, 0, z + h_ob / 2), segs=4, matrix=Matrix.Rotation(math.pi / 4, 4, "Z"))
    z += h_ob
    b.cyl(P, 0.62, 0.0, 0.9, center=(0, 0, z + 0.45), segs=4, matrix=Matrix.Rotation(math.pi / 4, 4, "Z"))
    z += 0.6
    # estatua de la Libertad (simplificada): base, túnica, torso, cabeza, brazo con lanza
    b.cyl(P, 0.35, 0.35, 0.3, center=(0, 0, z + 0.15), segs=8)
    z += 0.3
    b.cyl(P, 0.38, 0.2, 1.3, center=(0, 0, z + 0.65), segs=10)
    b.cyl(P, 0.22, 0.17, 0.55, center=(0, 0, z + 1.55), segs=8)
    b.uvsphere(P, 0.16, center=(0, 0, z + 1.97), segs=8, rings=5)
    b.tube(P, [(0.15, 0, z + 1.7), (0.35, 0.05, z + 2.0), (0.4, 0.05, z + 2.4)], 0.06, 5)
    b.tube(M["hierro"], [(0.42, 0.05, z + 1.0), (0.42, 0.05, z + 2.9)], 0.025, 4)
    b.cyl(P, 0.28, 0.28, 0.06, center=(-0.25, -0.12, z + 1.3), segs=10, axis="X")
    top = z + 2.9
    snow_caps(b, M["nieve"], min_nz=0.6, thick=0.05, min_area=0.02, skip=(M["hierro"],))
    obj = b.finish(uv_tiles={"PiedraBlanca": 2.0, "Granito": 1.5})
    return obj, {
        "collide": [cyl_c((0, 0, 0.11), 4.9, 0.22), cyl_c((0, 0, 0.33), 4.3, 0.44), cyl_c((0, 0, 1.2), R + 0.1, 2.4)],
        "carve": [cyl_c((0, 0, 1.0), 5.2, 2.6), cyl_c((0, 0, top / 2), 1.9, top + 0.6)],
    }


# ---------------------------------------------------------------------------
# Fachadas modulares a lo largo de una polilínea (Casa Rosada)
# ---------------------------------------------------------------------------


class Polyline:
    """Polilínea en el plano XY de Blender con muestreo por longitud de arco.
    `toward` es un punto del lado de la plaza: define la normal de la fachada."""

    def __init__(self, pts, toward):
        self.p = [Vector((x, y, 0)) for x, y in pts]
        self.s = [0.0]
        for a, b in zip(self.p, self.p[1:]):
            self.s.append(self.s[-1] + (b - a).length)
        self.length = self.s[-1]
        mid = self.at(self.length / 2)[0]
        t = self.at(self.length / 2)[1]
        n = Vector((-t.y, t.x, 0))
        self.sign = 1 if n.dot(Vector((toward[0], toward[1], 0)) - mid) > 0 else -1

    def at(self, s):
        s = max(0.0, min(self.length, s))
        for i in range(len(self.p) - 1):
            if s <= self.s[i + 1] or i == len(self.p) - 2:
                seg = self.s[i + 1] - self.s[i]
                f = (s - self.s[i]) / seg if seg > 0 else 0
                t = (self.p[i + 1] - self.p[i]).normalized()
                return self.p[i].lerp(self.p[i + 1], f), t
        raise ValueError

    def frame(self, s, out=0.0):
        """Matriz local en s: X = tangente, -Y = hacia la plaza, origen en la fachada (+out hacia la plaza)."""
        p, t = self.at(s)
        n = Vector((-t.y, t.x, 0)) * self.sign  # hacia la plaza
        y = -n
        x = y.cross(Vector((0, 0, 1)))
        m = Matrix((x, y, Vector((0, 0, 1)))).transposed().to_4x4()
        m.translation = p + n * out
        return m

    def normal_at_vertex(self, i):
        ts = []
        if i > 0:
            ts.append((self.p[i] - self.p[i - 1]).normalized())
        if i < len(self.p) - 1:
            ts.append((self.p[i + 1] - self.p[i]).normalized())
        t = sum(ts, Vector()).normalized()
        return Vector((-t.y, t.x, 0)) * self.sign


def loft_prism(b, mat, front, back, z0, z1):
    """Volumen entre una línea frontal y una trasera (listas de Vector XY), de z0 a z1."""
    ring = front + list(reversed(back))

    def make():
        bm = b.bm
        vb = [bm.verts.new((p.x, p.y, z0)) for p in ring]
        vt = [bm.verts.new((p.x, p.y, z1)) for p in ring]
        n = len(ring)
        # orientación: normal hacia arriba en la tapa superior
        area = sum(ring[i].x * ring[(i + 1) % n].y - ring[(i + 1) % n].x * ring[i].y for i in range(n))
        if area < 0:
            vb.reverse()
            vt.reverse()
        bm.faces.new(list(reversed(vb)))
        bm.faces.new(vt)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((vb[i], vb[j], vt[j], vt[i]))

    return b._run(mat, make)


def offset_line(pl, d):
    """Línea desplazada `d` metros hacia la plaza (negativo = hacia adentro)."""
    return [pl.p[i] + pl.normal_at_vertex(i) * d for i in range(len(pl.p))]


def casa_rosada(M):
    """Casa Rosada sobre la fachada curva del splat (lado este, mirando a la plaza)."""
    b = Builder("casa_rosada")
    R, RL, V, F = M["rosada"], M["rosada_liso"], M["vidrio"], M["rosada_liso"]
    # Línea de fachada medida en el splat (x, z del juego), de norte a sur.
    pts_game = [(57.2, -31), (56.6, -24), (55.4, -15), (54.1, -5), (53.0, 0), (51.1, 5.5), (49.6, 10.5), (47.9, 15.5), (46.2, 20.5), (44.4, 24.5), (42.4, 28), (40.6, 30.6), (38.6, 33.2), (36.4, 36.2), (34.9, 39), (34.3, 42)]
    pl = Polyline([(x, -z) for x, z in pts_game], toward=(0, 0))
    D = 20.0
    H = 17.5  # cornisa
    front = offset_line(pl, 0.0)
    back = offset_line(pl, -D)
    # el cuerpo baja 2 m bajo el suelo: el piso del splat no es plano (baja hacia +X)
    loft_prism(b, R, front, back, -2.0, H)
    # zócalo
    loft_prism(b, M["granito"], offset_line(pl, 0.12), offset_line(pl, -0.5), -2.0, 1.0)
    # planta baja almohadillada
    loft_prism(b, M["rosada_buna"], offset_line(pl, 0.06), offset_line(pl, -0.4), 1.0, 6.2)
    # molduras horizontales (claras, como el revoque de la Casa Rosada)
    for z0, z1, out in ((6.2, 6.6, 0.22), (12.0, 12.35, 0.18), (H - 0.1, H + 0.7, 0.45), (H + 1.45, H + 1.65, 0.2)):
        loft_prism(b, RL, offset_line(pl, out), offset_line(pl, -0.6), z0, z1)
    # techo mansarda con lucarnas
    roof_front_lo = offset_line(pl, -0.6)
    roof_front_hi = offset_line(pl, -3.2)
    roof_back = offset_line(pl, -D + 0.6)

    def mansard():
        bm = b.bm
        lo = [bm.verts.new((p.x, p.y, H + 1.4)) for p in roof_front_lo]
        hi = [bm.verts.new((p.x, p.y, H + 4.6)) for p in roof_front_hi]
        bk = [bm.verts.new((p.x, p.y, H + 4.6)) for p in roof_back]
        bl = [bm.verts.new((p.x, p.y, H + 1.4)) for p in roof_back]
        n = len(lo)
        for i in range(n - 1):
            for quad in ((lo[i], lo[i + 1], hi[i + 1], hi[i]), (hi[i], hi[i + 1], bk[i + 1], bk[i]), (bk[i], bk[i + 1], bl[i + 1], bl[i])):
                f = bm.faces.new(quad)
        bm.faces.new((lo[0], hi[0], bk[0], bl[0]))
        bm.faces.new((lo[-1], bl[-1], bk[-1], hi[-1]))

    b._run(M["pizarra"], mansard)
    # pabellón central donde el splat muestra el gran arco (z ≈ 15,5)
    s_center = None
    best = 1e9
    s = 0.0
    while s < pl.length:
        p, _ = pl.at(s)
        d = abs(-p.y - 15.5)
        if d < best:
            best, s_center = d, s
        s += 0.25
    pav_w = 15.0
    end_w = 9.0
    bay = 3.7
    # --- bahías regulares
    s = end_w + bay / 2
    while s < pl.length - end_w - bay / 2 + 0.01:
        if abs(s - s_center) < pav_w / 2 + bay / 2 - 0.3:
            s += bay
            continue
        m = pl.frame(s)
        # pilastras
        for sx in (-bay / 2, bay / 2):
            b.box(RL, (0.55, 0.25, H - 1.0), matrix=m @ Matrix.Translation((sx, -0.1, 1.0 + (H - 1.0) / 2)))
        # planta baja: ventana con arco
        _arch(b, RL, V, m @ Matrix.Translation((0, -0.06, 0)), 0, 1.5, 1.7, 3.7)  # sobre el almohadillado
        # piso 1: ventana alta con frontis y balconcito
        _rect(b, RL, V, m, 0, 7.0, 1.55, 3.3, pediment=True)
        b.box(RL, (2.1, 0.55, 0.12), matrix=m @ Matrix.Translation((0, -0.3, 6.75)))
        # piso 2
        _rect(b, RL, V, m, 0, 12.75, 1.4, 2.6)
        # balaustrada sobre la cornisa
        for k in range(10):
            b.box(RL, (0.13, 0.16, 0.75), matrix=m @ Matrix.Translation((-bay / 2 + (k + 0.5) * bay / 10, -0.05, H + 1.07)))
        # lucarna en la mansarda (una cada bahía)
        mr = pl.frame(s, out=-1.5)
        b.box(RL, (1.3, 1.2, 1.9), matrix=mr @ Matrix.Translation((0, 0.2, H + 2.2)))
        b.box(V, (0.8, 0.02, 1.2), matrix=mr @ Matrix.Translation((0, -0.41, H + 2.15)))
        b.poly_extrude(M["pizarra"], [(-0.8, 0), (0.8, 0), (0, 0.6)], -0.45, 0.85, matrix=mr @ Matrix.Translation((0, 0.2, H + 3.1)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        s += bay
    # --- pabellones de los extremos con cúpula de pizarra
    for sc in (end_w / 2, pl.length - end_w / 2):
        m = pl.frame(sc, out=0.8)
        b.box(R, (end_w, 2.0, H + 1.6), matrix=m @ Matrix.Translation((0, 0.6, (H + 1.6) / 2)))
        for sx in (-end_w / 2 + 0.3, end_w / 2 - 0.3):
            b.box(RL, (0.6, 0.3, H + 1.6), matrix=m @ Matrix.Translation((sx, -0.45, (H + 1.6) / 2)))
        mf = m @ Matrix.Translation((0, -0.4, 0))
        for sx in (-2.2, 0, 2.2):
            _arch(b, RL, V, mf, sx, 1.5, 1.6, 3.6)
            _rect(b, RL, V, mf, sx, 7.0, 1.45, 3.2, pediment=True)
            _rect(b, RL, V, mf, sx, 12.75, 1.3, 2.5)
        b.box(RL, (end_w + 0.6, 2.8, 0.8), matrix=m @ Matrix.Translation((0, 0.6, H + 2.0)))
        # cúpula: tronco de pirámide + linterna
        mc = m @ Matrix.Translation((0, 3.5, H + 2.4))
        b.cyl(M["pizarra"], end_w * 0.62, end_w * 0.25, 4.6, center=(0, 0, 2.3), segs=4, matrix=mc @ Matrix.Rotation(math.pi / 4, 4, "Z"))
        b.cyl(M["pizarra"], end_w * 0.25, 0.4, 1.8, center=(0, 0, 5.5), segs=8, matrix=mc)
        b.cyl(M["hierro"], 0.05, 0.02, 1.5, center=(0, 0, 7.1), segs=4, matrix=mc)
    # --- pabellón central con el gran arco y la bandera
    m = pl.frame(s_center, out=1.2)
    Hc = H + 4.2
    b.box(R, (pav_w, 3.0, Hc), matrix=m @ Matrix.Translation((0, 1.0, Hc / 2)))
    for sx in (-pav_w / 2 + 0.35, -3.6, 3.6, pav_w / 2 - 0.35):
        b.box(RL, (0.75, 0.35, Hc - 1), matrix=m @ Matrix.Translation((sx, -0.6, 1 + (Hc - 1) / 2)))
    # gran arco de entrada (vano oscuro + dovelas)
    mf = m @ Matrix.Translation((0, -0.5, 0))
    _arch(b, RL, V, mf, 0, 0.0, 4.8, 8.6, depth=0.6, frame=0.45)
    for sx in (-5.6, 5.6):
        _arch(b, RL, V, mf, sx, 1.5, 1.6, 3.6)
        _rect(b, RL, V, mf, sx, 9.6, 1.45, 3.3, pediment=True)
        _rect(b, RL, V, mf, sx, 14.6, 1.3, 2.5)
    for sx in (-1.8, 0, 1.8):
        _arch(b, RL, V, mf, sx, 10.0, 1.2, 3.0)
    b.box(RL, (pav_w + 0.6, 3.6, 0.9), matrix=m @ Matrix.Translation((0, 1.0, Hc + 0.45)))
    # frontis triangular
    b.poly_extrude(RL, [(-pav_w / 2 + 1.2, 0), (pav_w / 2 - 1.2, 0), (0, 3.2)], -0.4, 2.0, matrix=m @ Matrix.Translation((0, 0.0, Hc + 0.9)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    # mástil y bandera sobre el pabellón
    mp = m @ Matrix.Translation((0, 2.5, Hc + 0.9))
    b.cyl(M["cromo"], 0.08, 0.05, 9.0, center=(0, 0, 4.5), segs=6, matrix=mp)

    def flag_mesh():
        bmx = b.bm
        W_, H_, nx, nz = 4.0, 2.5, 12, 6
        verts = []
        for j in range(nz + 1):
            row = []
            for i in range(nx + 1):
                x = 0.08 + W_ * i / nx
                y = math.sin(i / nx * math.pi * 2) * 0.2 * (i / nx)
                row.append(bmx.verts.new(mp @ Vector((y, x, 8.8 - H_ + H_ * j / nz - 0.25 * (i / nx) ** 2))))
            verts.append(row)
        for j in range(nz):
            for i in range(nx):
                bmx.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))

    b._run(M["bandera"], flag_mesh)
    snow_caps(b, M["nieve"], min_nz=0.75, thick=0.08, min_area=0.05, skip=(M["bandera"], V))
    obj = b.finish(uv_tiles={"Rosada": 4.0, "RosadaLiso": 3.0, "Pizarra": 2.5, "Granito": 2.0})
    # UV de la bandera: 0..1 sobre la tela (la proyección cúbica no sirve en una tela orientada)
    _flag_uv(obj, "Bandera")
    collide = []
    s = 0.0
    while s < pl.length:
        seg = min(6.0, pl.length - s)
        m = pl.frame(s + seg / 2)
        loc = m.translation
        yaw = math.atan2(m.col[0].y, m.col[0].x)
        c = loc - Vector((m.col[1].x, m.col[1].y, 0)) * (-D / 2)
        collide.append(box_c((c.x, c.y, (H + 4) / 2), (seg + 0.4, D, H + 4), yaw))
        s += seg
    carve = []
    s = 0.0
    while s < pl.length:
        seg = min(8.0, pl.length - s)
        m = pl.frame(s + seg / 2)
        loc = m.translation
        yaw = math.atan2(m.col[0].y, m.col[0].x)
        c = loc + Vector((m.col[1].x, m.col[1].y, 0)) * (D / 2 - 1.6)
        carve.append(box_c((c.x, c.y, 15), (seg + 0.6, D + 3.2, 34), yaw))
        s += seg
    return obj, {"collide": collide, "carve": carve, "world": True}


def _flag_uv(obj, mat_name):
    me = obj.data
    idx = [i for i, m in enumerate(me.materials) if m and m.name == mat_name]
    if not idx:
        return
    uv = me.uv_layers.active.data
    polys = [p for p in me.polygons if p.material_index == idx[0]]
    vs = [me.vertices[v].co for p in polys for v in p.vertices]
    if not vs:
        return
    # ejes de la tela: horizontal = dirección de mayor extensión en XY, vertical = Z
    import numpy as np

    pts = np.array([[v.x, v.y, v.z] for v in vs])
    xy = pts[:, :2] - pts[:, :2].mean(axis=0)
    _, _, vt = np.linalg.svd(xy, full_matrices=False)
    ax = vt[0]
    hmin, hmax = (xy @ ax).min(), (xy @ ax).max()
    zmin, zmax = pts[:, 2].min(), pts[:, 2].max()
    for p in polys:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            h = (np.array([co.x, co.y]) - pts[:, :2].mean(axis=0)) @ ax
            uv[li].uv = ((h - hmin) / (hmax - hmin), (co.z - zmin) / (zmax - zmin))


def _arch(b, frame_mat, glass_mat, m, x, z, w, h, depth=0.35, frame=0.16):
    """Ventana con arco en el marco local m (frente -Y)."""
    segs = 8
    r = w / 2
    rect_h = max(h - r, 0.01)
    pts = [(-r, 0), (r, 0), (r, rect_h)] + [(r * math.cos(math.pi * k / segs), rect_h + r * math.sin(math.pi * k / segs)) for k in range(1, segs)] + [(-r, rect_h)]
    mm = m @ Matrix.Translation((x, 0, z))

    # El muro es macizo: el vidrio va 2 cm delante y el marco sobresale `depth`.
    def glass():
        bm = b.bm
        vf = [bm.verts.new(mm @ Vector((px, -0.02, pz))) for px, pz in pts]
        bm.faces.new(vf)  # antihorario visto desde el frente: normal hacia -Y

    b._run(glass_mat, glass)
    rr = r + frame
    outer = [(-rr, 0), (rr, 0), (rr, rect_h)] + [(rr * math.cos(math.pi * k / segs), rect_h + rr * math.sin(math.pi * k / segs)) for k in range(1, segs)] + [(-rr, rect_h)]

    def ring():
        bm = b.bm
        fy = -min(depth, 0.35) * 0.5 - 0.04
        vo = [bm.verts.new(mm @ Vector((px, fy, pz))) for px, pz in outer]
        vi = [bm.verts.new(mm @ Vector((px, fy, pz))) for px, pz in pts]
        vd = [bm.verts.new(mm @ Vector((px, -0.01, pz))) for px, pz in pts]
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            if i == 0:
                continue  # base abierta (antepecho)
            bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
            bm.faces.new((vi[i], vi[j], vd[j], vd[i]))

    b._run(frame_mat, ring)
    # antepecho / alféizar
    b.box(frame_mat, (w + 2 * frame + 0.1, 0.3, 0.12), matrix=mm @ Matrix.Translation((0, -0.1, -0.06)))


def _rect(b, frame_mat, glass_mat, m, x, z, w, h, pediment=False, depth=0.3, frame=0.15):
    mm = m @ Matrix.Translation((x, 0, z))
    b.box(glass_mat, (w, 0.02, h), matrix=mm @ Matrix.Translation((0, -0.02, h / 2)))
    for sx in (-1, 1):
        b.box(frame_mat, (frame, 0.18, h + frame), matrix=mm @ Matrix.Translation((sx * (w / 2 + frame / 2), -0.04, (h + frame) / 2)))
    b.box(frame_mat, (w + 2 * frame, 0.2, frame), matrix=mm @ Matrix.Translation((0, -0.05, h + frame / 2)))
    b.box(frame_mat, (w + 3 * frame, 0.32, 0.12), matrix=mm @ Matrix.Translation((0, -0.1, -0.06)))
    if pediment:
        b.box(frame_mat, (w + 4 * frame, 0.32, 0.14), matrix=mm @ Matrix.Translation((0, -0.12, h + frame + 0.07)))
        b.poly_extrude(frame_mat, [(-w / 2 - 2 * frame, 0), (w / 2 + 2 * frame, 0), (0, 0.45)], -0.28, 0.05, matrix=mm @ Matrix.Translation((0, 0, h + frame + 0.14)) @ Matrix.Rotation(math.pi / 2, 4, "X"))


# ---------------------------------------------------------------------------
# Cabildo
# ---------------------------------------------------------------------------


def _arcade_bay(b, mat, m, x0, w, z0, spring, top, depth, segs=10):
    """Muro con vano de arco entre x0-w/2 y x0+w/2 (sin las pilastras)."""
    r = w / 2
    pts = [(x0 - r, z0 + spring)] + [(x0 + r * math.cos(math.pi - math.pi * k / segs), z0 + spring + r * math.sin(math.pi - math.pi * k / segs)) for k in range(1, segs)] + [(x0 + r, z0 + spring), (x0 + r, top), (x0 - r, top)]
    b.poly_extrude(mat, pts, -depth, 0.0, matrix=m @ Matrix.Rotation(math.pi / 2, 4, "X"))


def cabildo(M):
    """Cabildo de Buenos Aires: recova de dos pisos, 9 arcos, torre central (frente -Y)."""
    b = Builder("cabildo")
    W, Wb, Mf = M["blanco"], M["blanco"], M["hierro"]
    nb = 9
    bw = 3.65
    L = nb * bw
    pier = 0.85
    D = 14.0
    loggia = 4.2
    F1, F2 = 6.6, 13.0  # alturas de entrepiso y cornisa
    m0 = Matrix.Identity(4)
    # cuerpo trasero
    b.box(W, (L, D - loggia, F2), center=(0, loggia + (D - loggia) / 2, F2 / 2))
    # losas de la recova
    b.box(W, (L, loggia, 0.45), center=(0, loggia / 2, F1 + 0.2))
    b.box(W, (L, loggia, 0.5), center=(0, loggia / 2, F2 - 0.25))
    b.box(M["granito"], (L + 0.4, loggia + 0.3, 1.18), center=(0, loggia / 2 - 0.15, -0.41))
    b.box(W, (L, D - loggia, 1.0), center=(0, loggia + (D - loggia) / 2, -0.5))
    # pilares y arcos del frente
    for i in range(nb + 1):
        x = -L / 2 + i * bw
        b.box(Wb, (pier, pier, F2), center=(x, pier / 2 - 0.05, F2 / 2))
        b.box(W, (pier + 0.2, pier + 0.2, 0.3), center=(x, pier / 2 - 0.05, F1 - 1.6))
        b.box(W, (pier + 0.2, pier + 0.2, 0.3), center=(x, pier / 2 - 0.05, F2 - 1.6))
    for i in range(nb):
        xc = -L / 2 + (i + 0.5) * bw
        open_w = bw - pier
        _arcade_bay(b, W, m0, xc, open_w, 0.0, 3.3, F1 + 0.4, pier - 0.1)
        _arcade_bay(b, W, m0, xc, open_w, F1 + 0.4, 3.0, F2, pier - 0.1)
        # puertas y ventanas en el muro del fondo de la recova
        b.box(M["madera_banco"], (1.4, 0.06, 2.8), center=(xc, loggia - 0.03, 1.4))
        b.box(W, (1.7, 0.12, 0.2), center=(xc, loggia - 0.06, 2.9))
        b.box(M["vidrio"], (1.3, 0.06, 2.6), center=(xc, loggia - 0.03, F1 + 0.45 + 1.3))
        # baranda del piso alto
        if i != nb // 2:
            b.box(W, (open_w, 0.25, 0.9), center=(xc, 0.3, F1 + 0.45 + 0.45))
    # balcón central
    xc = 0
    b.box(W, (bw + 0.6, 1.2, 0.2), center=(xc, -0.5, F1 + 0.5))
    b.tube(Mf, [(-bw / 2 - 0.25, -1.05, F1 + 0.6), (-bw / 2 - 0.25, -1.05, F1 + 1.6), (bw / 2 + 0.25, -1.05, F1 + 1.6), (bw / 2 + 0.25, -1.05, F1 + 0.6)], 0.03, 5)
    for k in range(13):
        x = -bw / 2 - 0.25 + (bw + 0.5) * k / 12
        b.tube(Mf, [(x, -1.05, F1 + 0.6), (x, -1.05, F1 + 1.6)], 0.012, 4)
    # cornisa y parapeto
    b.box(W, (L + 0.8, D + 0.8, 0.45), center=(0, D / 2, F2 + 0.22))
    b.box(Wb, (L + 0.5, 0.35, 0.8), center=(0, -0.2, F2 + 0.85))
    # techo de tejas a cuatro aguas
    hr = 2.6
    b.poly_extrude(M["tejas"], [(-L / 2, 0.5), (L / 2, 0.5), (L / 2, D), (-L / 2, D)], F2 + 0.45, F2 + 0.5)
    roof_pts = [(-L / 2, 0.5, F2 + 0.5), (L / 2, 0.5, F2 + 0.5), (L / 2, D, F2 + 0.5), (-L / 2, D, F2 + 0.5)]

    def hip():
        bm = b.bm
        v = [bm.verts.new(p) for p in roof_pts]
        r0 = bm.verts.new((-L / 2 + (D - 0.5) / 2, (D + 0.5) / 2, F2 + 0.5 + hr))
        r1 = bm.verts.new((L / 2 - (D - 0.5) / 2, (D + 0.5) / 2, F2 + 0.5 + hr))
        bm.faces.new((v[0], v[1], r1, r0))
        bm.faces.new((v[1], v[2], r1))
        bm.faces.new((v[2], v[3], r0, r1))
        bm.faces.new((v[3], v[0], r0))

    b._run(M["tejas"], hip)
    # torre
    tw = 6.4
    ty = 3.4  # la torre del splat se alza sobre el plano de la recova
    z = F2 + 0.5
    b.box(W, (tw, tw, 7.0), center=(0, ty, z + 3.5))
    for sx in (-1, 1):
        b.box(Wb, (0.6, tw + 0.1, 7.0), center=(sx * (tw / 2 - 0.25), ty, z + 3.5))
    # reloj
    for fy, rot in ((ty - tw / 2 - 0.02, 0), (ty + tw / 2 + 0.02, math.pi)):
        b.cyl(M["reloj"], 1.05, 1.05, 0.06, center=(0, fy, z + 4.2), segs=24, axis="Y")
        b.cyl(W, 1.25, 1.25, 0.05, center=(0, fy + (0.03 if rot == 0 else -0.03), z + 4.2), segs=24, axis="Y")
    z += 7.0
    b.box(W, (tw + 0.6, tw + 0.6, 0.45), center=(0, ty, z + 0.22))
    z += 0.45
    # campanario: pilares en las esquinas y arcos en las cuatro caras
    bw2 = tw - 0.8
    hb = 5.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(Wb, (1.0, 1.0, hb), center=(sx * (bw2 / 2), ty + sy * (bw2 / 2), z + hb / 2))
    for k in range(4):
        rot = Matrix.Translation((0, ty, 0)) @ Matrix.Rotation(k * math.pi / 2, 4, "Z") @ Matrix.Translation((0, -bw2 / 2 + 0.4, 0))
        _arcade_bay(b, W, rot, 0.0, bw2 - 1.0, z, 3.0, z + hb, 0.6)
        b.box(Mf, (bw2 - 1.0, 0.04, 0.9), matrix=rot @ Matrix.Translation((0, -0.1, z + 0.45)))
    b.box(W, (bw2 - 0.4, bw2 - 0.4, 0.2), center=(0, ty, z + 0.1))
    z += hb
    b.box(W, (tw + 0.2, tw + 0.2, 0.5), center=(0, ty, z + 0.25))
    z += 0.5
    # cúpula y linterna
    b.cyl(W, 2.6, 2.6, 0.6, center=(0, ty, z + 0.3), segs=8)
    z += 0.6
    b.uvsphere(M["tejas"], 2.4, center=(0, ty, z), segs=16, rings=8, scale=(1, 1, 1.05))
    b.cyl(W, 0.55, 0.55, 1.4, center=(0, ty, z + 2.6), segs=8)
    b.cyl(M["tejas"], 0.75, 0.05, 1.0, center=(0, ty, z + 3.8), segs=8)
    b.cyl(Mf, 0.04, 0.02, 1.4, center=(0, ty, z + 4.9), segs=4)
    top = z + 5.6
    snow_caps(b, M["nieve"], min_nz=0.6, thick=0.07, min_area=0.05, skip=(M["vidrio"], M["reloj"]))
    obj = b.finish(uv_tiles={"Cabildo": 4.0, "CabildoBuna": 2.0, "Tejas": 2.0, "RelojEsfera": (2.1, 2.1, 0.5, 0.5 - (F2 + 0.5 + 4.2) / 2.1)})
    return obj, {
        "collide": [box_c((0, D / 2 + 0.2, F2 / 2), (L + 0.4, D + 0.4, F2))],
        "carve": [box_c((0, D / 2 - 0.8, F2 / 2 + 1.5), (L + 2.5, D + 3.0, F2 + 4.5)), box_c((0, ty, (F2 + top) / 2), (tw + 2.4, tw + 2.4, top - F2 + 2))],
    }

"""
Props chicos y medianos de Plaza de Mayo (mobiliario, vehículos, vegetación).

Cada función devuelve (objeto, meta). meta:
  collide: primitivas de colisión en espacio local
           {"type": "box", "c": [x, y, z], "s": [sx, sy, sz], "rz": rad}
           {"type": "cyl", "c": [x, y, z], "r": r, "h": h}   (c = centro)
  carve:   volúmenes donde se borra el splat (mismo formato; "sphere" con r)
"""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import Builder, snow_caps


def box_c(c, s, rz=0.0):
    return {"type": "box", "c": list(c), "s": list(s), "rz": rz}


def cyl_c(c, r, h):
    return {"type": "cyl", "c": list(c), "r": r, "h": h}


def text_into(builder, mat, text, size, matrix, extrude=0.01, font_bold=True):
    """Texto de Blender convertido en malla dentro del builder."""
    curve = bpy.data.curves.new("tmp_text", "FONT")
    curve.body = text
    curve.size = size
    curve.extrude = extrude
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    tmp = bpy.data.objects.new("tmp_text", curve)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = tmp.evaluated_get(dg)
    me = ev.to_mesh()
    tbm = bmesh.new()
    tbm.from_mesh(me)
    bmesh.ops.transform(tbm, matrix=matrix, verts=tbm.verts)
    ev.to_mesh_clear()
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(curve)
    tmp_mesh = bpy.data.meshes.new("tmp_text_mesh")
    tbm.to_mesh(tmp_mesh)
    tbm.free()

    def add():
        builder.bm.from_mesh(tmp_mesh)

    builder._run(mat, add)
    bpy.data.meshes.remove(tmp_mesh)


# ---------------------------------------------------------------------------
# Mobiliario
# ---------------------------------------------------------------------------


def banco(M):
    b = Builder("banco")
    L = 1.9
    for sx in (-0.78, 0.78):
        # Pata lateral de fundición: patas delantera/trasera + apoyabrazos + respaldo.
        b.tube(M["hierro"], [(sx, -0.26, 0.0), (sx, -0.22, 0.42), (sx, 0.18, 0.44), (sx, 0.24, 0.0)], 0.03, 6)
        b.tube(M["hierro"], [(sx, 0.18, 0.44), (sx, 0.26, 0.85)], 0.025, 6)
        b.tube(M["hierro"], [(sx, -0.24, 0.42), (sx, -0.22, 0.62), (sx, 0.05, 0.64)], 0.022, 6)
        b.box(M["hierro"], (0.08, 0.14, 0.03), center=(sx, -0.27, 0.015))
        b.box(M["hierro"], (0.08, 0.14, 0.03), center=(sx, 0.25, 0.015))
    for i in range(4):
        y = -0.19 + i * 0.115
        b.box(M["madera_banco"], (L, 0.095, 0.035), center=(0, y, 0.455))
    for i in range(3):
        z = 0.56 + i * 0.11
        y = 0.2 + (z - 0.56) * 0.2
        m = Matrix.Translation((0, y, z)) @ Matrix.Rotation(math.radians(-12), 4, "X")
        b.box(M["madera_banco"], (L, 0.03, 0.09), matrix=m)
    snow_caps(b, M["nieve"], thick=0.035, min_area=0.02, skip=(M["hierro"],))
    obj = b.finish(uv_tiles={"MaderaBanco": 1.0})
    return obj, {"collide": [box_c((0, 0, 0.42), (1.9, 0.56, 0.84))], "carve": [box_c((0, 0, 0.55), (2.3, 1.0, 1.4))]}


def _lantern(b, M, c, scale=1.0):
    x, y, z = c
    s = scale
    b.cyl(M["hierro"], 0.05 * s, 0.05 * s, 0.08 * s, center=(x, y, z + 0.04 * s), segs=8)
    b.cyl(M["luz"], 0.13 * s, 0.2 * s, 0.42 * s, center=(x, y, z + 0.29 * s), segs=4)
    # varillas del farol
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        b.tube(M["hierro"], [(x + math.cos(a) * 0.13 * s, y + math.sin(a) * 0.13 * s, z + 0.08 * s), (x + math.cos(a) * 0.2 * s, y + math.sin(a) * 0.2 * s, z + 0.5 * s)], 0.012 * s, 4)
    b.cyl(M["hierro"], 0.25 * s, 0.03 * s, 0.2 * s, center=(x, y, z + 0.6 * s), segs=4)
    b.sphere(M["hierro"], 0.035 * s, center=(x, y, z + 0.73 * s), subdiv=1)


def _post_base(b, M, r=0.3, h=0.55):
    b.cyl(M["hierro"], r, r, 0.1, center=(0, 0, 0.05), segs=8)
    b.cyl(M["hierro"], r * 0.8, r * 0.55, h - 0.1, center=(0, 0, 0.1 + (h - 0.1) / 2), segs=8)
    b.cyl(M["hierro"], r * 0.62, r * 0.62, 0.05, center=(0, 0, h), segs=8)


def farol_triple(M):
    b = Builder("farol_triple")
    _post_base(b, M, 0.3, 0.6)
    b.cyl(M["hierro"], 0.1, 0.065, 3.0, center=(0, 0, 2.1), segs=10)
    for z in (1.2, 2.4, 3.45):
        b.cyl(M["hierro"], 0.1, 0.1, 0.06, center=(0, 0, z), segs=10)
    for sx in (-1, 1):
        b.tube(M["hierro"], [(0, 0, 3.4), (sx * 0.3, 0, 3.55), (sx * 0.55, 0, 3.5), (sx * 0.6, 0, 3.38)], 0.028, 6)
        _lantern(b, M, (sx * 0.6, 0, 3.38), 0.9)
    _lantern(b, M, (0, 0, 3.62), 1.0)
    snow_caps(b, M["nieve"], thick=0.03, min_area=0.01, skip=(M["luz"],))
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 1.5), 0.3, 3.0)], "carve": [cyl_c((0, 0, 2.2), 0.55, 4.6), box_c((0, 0, 3.8), (1.8, 0.7, 1.0))]}


def farol_simple(M):
    b = Builder("farol_simple")
    _post_base(b, M, 0.22, 0.45)
    b.cyl(M["hierro"], 0.075, 0.05, 3.2, center=(0, 0, 2.05), segs=8)
    b.cyl(M["hierro"], 0.08, 0.08, 0.05, center=(0, 0, 1.4), segs=8)
    _lantern(b, M, (0, 0, 3.62), 1.05)
    snow_caps(b, M["nieve"], thick=0.03, min_area=0.01, skip=(M["luz"],))
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 1.5), 0.22, 3.0)], "carve": [cyl_c((0, 0, 2.2), 0.5, 4.6)]}


def farol_alto(M):
    b = Builder("farol_alto")
    _post_base(b, M, 0.24, 0.5)
    b.cyl(M["hierro"], 0.07, 0.045, 3.9, center=(0, 0, 2.45), segs=8)
    b.tube(M["hierro"], [(0, 0, 4.35), (0.12, 0, 4.55), (0.42, 0, 4.6), (0.5, 0, 4.48)], 0.03, 6)
    b.cyl(M["hierro"], 0.24, 0.05, 0.16, center=(0.5, 0, 4.4), segs=8)
    b.uvsphere(M["luz"], 0.15, center=(0.5, 0, 4.2), segs=10, rings=6)
    snow_caps(b, M["nieve"], thick=0.03, min_area=0.01, skip=(M["luz"],))
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 1.5), 0.24, 3.0)], "carve": [cyl_c((0.15, 0, 2.5), 0.6, 5.2)]}


def tacho(M):
    b = Builder("tacho")
    r = 0.27
    for k in range(16):
        a = 2 * math.pi * k / 16
        b.box(M["hierro"], (0.05, 0.015, 0.7), center=(math.cos(a) * r, math.sin(a) * r, 0.5), rot_z=a + math.pi / 2)
    b.cyl(M["hierro"], r + 0.02, r + 0.02, 0.05, center=(0, 0, 0.86), segs=16)
    b.cyl(M["hierro"], r + 0.01, r + 0.01, 0.04, center=(0, 0, 0.17), segs=16)
    b.cyl(M["tierra"], r - 0.02, r - 0.02, 0.6, center=(0, 0, 0.47), segs=12)
    b.cyl(M["hierro"], 0.06, 0.09, 0.15, center=(0, 0, 0.075), segs=8)
    snow_caps(b, M["nieve"], thick=0.04, min_area=0.02)
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 0.45), 0.3, 0.9)], "carve": [cyl_c((0, 0, 0.6), 0.55, 1.3)]}


def tacho_caja(M):
    b = Builder("tacho_caja")
    b.box(M["hierro"], (0.5, 0.5, 0.86), center=(0, 0, 0.47))
    b.box(M["hierro"], (0.56, 0.56, 0.06), center=(0, 0, 0.93))
    b.box(M["vidrio"], (0.3, 0.02, 0.12), center=(0, -0.26, 0.78))
    for sx in (-0.2, 0.2):
        b.box(M["hierro"], (0.06, 0.4, 0.04), center=(sx, 0, 0.02))
    snow_caps(b, M["nieve"], thick=0.05, min_area=0.02)
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [box_c((0, 0, 0.48), (0.56, 0.56, 0.96))], "carve": [box_c((0, 0, 0.6), (0.9, 0.9, 1.3))]}


def bebedero(M):
    b = Builder("bebedero")
    b.cyl(M["granito"], 0.32, 0.32, 0.12, center=(0, 0, 0.06), segs=10)
    b.cyl(M["hierro"], 0.12, 0.09, 0.7, center=(0, 0, 0.47), segs=10)
    b.cyl(M["hierro"], 0.12, 0.34, 0.16, center=(0, 0, 0.9), segs=12)
    b.cyl(M["hierro"], 0.36, 0.36, 0.05, center=(0, 0, 1.0), segs=12)
    b.cyl(M["hierro"], 0.03, 0.03, 0.18, center=(0, 0, 1.1), segs=6)
    snow_caps(b, M["nieve"], thick=0.04, min_area=0.02)
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 0.5), 0.35, 1.0)], "carve": [cyl_c((0, 0, 0.6), 0.6, 1.4)]}


def bolardo(M):
    b = Builder("bolardo")
    b.cyl(M["hierro"], 0.11, 0.09, 0.8, center=(0, 0, 0.4), segs=10)
    b.cyl(M["hierro"], 0.12, 0.12, 0.06, center=(0, 0, 0.62), segs=10)
    b.uvsphere(M["hierro"], 0.1, center=(0, 0, 0.84), segs=10, rings=5)
    snow_caps(b, M["nieve"], thick=0.03, min_area=0.005)
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [cyl_c((0, 0, 0.45), 0.13, 0.9)], "carve": [cyl_c((0, 0, 0.5), 0.3, 1.1)]}


def reloj(M):
    b = Builder("reloj")
    _post_base(b, M, 0.26, 0.5)
    b.cyl(M["hierro"], 0.08, 0.06, 2.5, center=(0, 0, 1.75), segs=10)
    b.cyl(M["hierro"], 0.1, 0.1, 0.08, center=(0, 0, 3.0), segs=10)
    b.cyl(M["hierro"], 0.4, 0.4, 0.18, center=(0, 0, 3.45), segs=20, axis="Y")
    b.cyl(M["reloj"], 0.34, 0.34, 0.2, center=(0, 0, 3.45), segs=20, axis="Y")
    b.sphere(M["hierro"], 0.06, center=(0, 0, 3.92), subdiv=1)
    snow_caps(b, M["nieve"], thick=0.03, min_area=0.004, skip=(M["reloj"],))
    obj = b.finish(uv_tile=1.0, uv_tiles={"RelojEsfera": (0.68, 0.68, 0.5, 0.5 - 3.45 / 0.68)})
    return obj, {"collide": [cyl_c((0, 0, 1.5), 0.26, 3.0)], "carve": [cyl_c((0, 0, 2.1), 0.55, 4.3)]}


def mastil(M):
    b = Builder("mastil")
    b.cyl(M["granito"], 0.7, 0.7, 0.35, center=(0, 0, 0.175), segs=8)
    b.cyl(M["granito"], 0.5, 0.5, 0.3, center=(0, 0, 0.5), segs=8)
    b.cyl(M["cromo"], 0.09, 0.05, 11.5, center=(0, 0, 6.4), segs=8)
    b.sphere(M["oro"], 0.1, center=(0, 0, 12.2), subdiv=1)
    # bandera ondulada: grilla 12 × 6
    W, H, nx, nz = 2.4, 1.5, 12, 6
    z0 = 12.05 - H

    def flag():
        bm = b.bm
        verts = []
        for j in range(nz + 1):
            row = []
            for i in range(nx + 1):
                x = 0.06 + W * i / nx
                y = math.sin(i / nx * math.pi * 2.2) * 0.12 * (i / nx)
                row.append(bm.verts.new((x, y, z0 + H * j / nz - 0.15 * (i / nx) ** 2)))
            verts.append(row)
        for j in range(nz):
            for i in range(nx):
                bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))

    b._run(M["bandera"], flag)
    obj = b.finish(uv_tile=1.0, uv_tiles={"Bandera": (W, H, -0.06 / W, -(z0 - 0.08) / H)})
    return obj, {"collide": [cyl_c((0, 0, 0.4), 0.7, 0.8), cyl_c((0, 0, 2.5), 0.12, 5)], "carve": [cyl_c((0, 0, 1.5), 0.9, 3.0)]}


def caja_madera(M):
    b = Builder("caja_madera")
    s = (1.15, 1.0, 0.95)
    b.box(M["madera_caja"], s, center=(0, 0, s[2] / 2))
    t = 0.035
    for sy in (-1, 1):
        y = sy * (s[1] / 2 + t / 2)
        b.box(M["madera_caja"], (s[0], t, 0.1), center=(0, y, 0.06))
        b.box(M["madera_caja"], (s[0], t, 0.1), center=(0, y, s[2] - 0.06))
        b.box(M["madera_caja"], (0.1, t, s[2]), center=(-s[0] / 2 + 0.05, y, s[2] / 2))
        b.box(M["madera_caja"], (0.1, t, s[2]), center=(s[0] / 2 - 0.05, y, s[2] / 2))
        diag = math.hypot(s[0] - 0.2, s[2] - 0.2)
        ang = math.atan2(s[2] - 0.2, s[0] - 0.2) * sy
        b.box(M["madera_caja"], (diag, t, 0.09), matrix=Matrix.Translation((0, y, s[2] / 2)) @ Matrix.Rotation(-ang, 4, "Y"))
    snow_caps(b, M["nieve"], thick=0.05, min_area=0.05)
    obj = b.finish(uv_tiles={"MaderaCaja": 1.2})
    return obj, {"collide": [box_c((0, 0, 0.475), (1.2, 1.08, 0.95))], "carve": [box_c((0, 0, 0.6), (1.6, 1.5, 1.3))]}


def caja_militar(M):
    b = Builder("caja_militar")
    s = (1.25, 0.72, 0.62)
    b.box(M["militar"], s, center=(0, 0, s[2] / 2))
    b.box(M["militar"], (s[0] + 0.03, s[1] + 0.03, 0.04), center=(0, 0, s[2] - 0.12))
    for x in (-0.45, 0.45):
        b.box(M["militar"], (0.06, s[1] + 0.04, s[2] + 0.01), center=(x, 0, s[2] / 2))
    for sx in (-1, 1):
        b.box(M["hierro"], (0.03, 0.16, 0.05), center=(sx * (s[0] / 2 + 0.02), 0, s[2] * 0.6))
    b.box(M["hierro"], (0.08, 0.03, 0.06), center=(0, -s[1] / 2 - 0.015, s[2] - 0.15))
    snow_caps(b, M["nieve"], thick=0.04, min_area=0.05)
    obj = b.finish(uv_tiles={"VerdeMilitar": 1.0})
    return obj, {"collide": [box_c((0, 0, 0.31), (1.28, 0.76, 0.62))], "carve": [box_c((0, 0, 0.45), (1.6, 1.1, 1.0))]}


JERSEY = [(-0.31, 0), (0.31, 0), (0.31, 0.08), (0.2, 0.28), (0.1, 0.82), (-0.1, 0.82), (-0.2, 0.28), (-0.31, 0.08)]


def barrera_jersey(M):
    b = Builder("barrera_jersey")
    b.profile_extrude(M["hormigon"], JERSEY, -1.0, 1.0)
    snow_caps(b, M["nieve"], min_nz=0.5, thick=0.05, min_area=0.02)
    obj = b.finish(uv_tiles={"Hormigon": 1.5})
    return obj, {"collide": [box_c((0, 0, 0.42), (2.0, 0.6, 0.84))], "carve": [box_c((0, 0, 0.55), (2.4, 1.0, 1.2))]}


def barrera_roja(M):
    b = Builder("barrera_roja")
    prof = [(-0.3, 0), (0.3, 0), (0.3, 0.1), (0.16, 0.25), (0.12, 0.95), (-0.12, 0.95), (-0.16, 0.25), (-0.3, 0.1)]
    b.profile_extrude(M["franjas"], prof, -1.0, 1.0)
    snow_caps(b, M["nieve"], min_nz=0.5, thick=0.05, min_area=0.02)
    obj = b.finish(uv_tiles={"FranjasRojas": 1.0})
    return obj, {"collide": [box_c((0, 0, 0.48), (2.0, 0.6, 0.96))], "carve": [box_c((0, 0, 0.6), (2.4, 1.0, 1.3))]}


def valla(M):
    b = Builder("valla")
    L, H = 2.2, 1.08
    b.tube(M["cromo"], [(-L / 2, 0, 0.12), (-L / 2, 0, H), (L / 2, 0, H), (L / 2, 0, 0.12)], 0.022, 6)
    b.tube(M["cromo"], [(-L / 2, 0, 0.22), (L / 2, 0, 0.22)], 0.016, 6)
    for i in range(1, 14):
        x = -L / 2 + L * i / 14
        b.tube(M["cromo"], [(x, 0, 0.22), (x, 0, H)], 0.009, 4)
    for sx in (-L / 2 + 0.1, L / 2 - 0.1):
        b.tube(M["cromo"], [(sx, -0.3, 0.02), (sx, 0, 0.14), (sx, 0.3, 0.02)], 0.016, 5)
    obj = b.finish(uv_tile=1.0)
    return obj, {"collide": [box_c((0, 0, 0.55), (2.2, 0.15, 1.1))], "carve": [box_c((0, 0, 0.6), (2.5, 0.8, 1.3))]}


# ---------------------------------------------------------------------------
# Vehículos
# ---------------------------------------------------------------------------


def _wheel(b, M, x, y, r=0.32, w=0.22):
    b.cyl(M["goma"], r, r, w, center=(x, y, r), segs=14, axis="Y")
    b.cyl(M["cromo"], r * 0.55, r * 0.55, w + 0.01, center=(x, y, r), segs=10, axis="Y")


def _car(name, M, paint, L=4.5, W=1.74, tall=False):
    b = Builder(name)
    hb = 0.32  # bajo del chasis
    h1 = 0.95 if not tall else 1.15
    h2 = 1.42 if not tall else 1.78
    # carrocería: perfil lateral (x, z) extruido en Y
    side = [(-L / 2, hb), (L / 2, hb), (L / 2, h1 - 0.12), (L / 2 - 0.25, h1), (-L / 2 + 0.15, h1), (-L / 2, h1 - 0.1)]

    def body(pts, y0, y1, mat):
        def make():
            bm = b.bm
            va = [bm.verts.new((x, y0, z)) for x, z in pts]
            vb = [bm.verts.new((x, y1, z)) for x, z in pts]
            n = len(pts)
            bm.faces.new(va)
            bm.faces.new(list(reversed(vb)))
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((va[j], va[i], vb[i], vb[j]))
        b._run(mat, make)

    body(side, -W / 2, W / 2, M[paint])
    # habitáculo
    if tall:
        cab = [(-L / 2 + 0.12, h1), (L / 2 - 1.1, h1), (L / 2 - 1.55, h2), (-L / 2 + 0.2, h2)]
    else:
        cab = [(-L / 2 + 0.55, h1), (L / 2 - 1.2, h1), (L / 2 - 1.75, h2), (-L / 2 + 1.05, h2)]
    body(cab, -W / 2 + 0.12, W / 2 - 0.12, M["vidrio"])
    # techo y parantes en pintura
    x0, x1 = cab[3][0], cab[2][0]
    b.box(M[paint], (x1 - x0 + 0.06, W - 0.2, 0.06), center=((x0 + x1) / 2, 0, h2 + 0.02))
    for x in (cab[0][0] + 0.05, (cab[0][0] + cab[1][0]) / 2, cab[1][0] - 0.12):
        for sy in (-1, 1):
            b.box(M[paint], (0.08, 0.04, h2 - h1), center=(x, sy * (W / 2 - 0.13), (h1 + h2) / 2))
    for x in (L / 2 - 0.95, -L / 2 + 0.85):
        for sy in (-1, 1):
            _wheel(b, M, x, sy * (W / 2 - 0.08))
    # faros y paragolpes
    for sy in (-1, 1):
        b.box(M["luz_bus"], (0.03, 0.32, 0.12), center=(L / 2 + 0.01, sy * 0.55, h1 - 0.25))
        b.box(M["texto_negro"], (0.03, 0.3, 0.1), center=(-L / 2 - 0.01, sy * 0.55, h1 - 0.22))
    b.box(M["goma"], (0.1, W + 0.02, 0.16), center=(L / 2, 0, hb + 0.12))
    b.box(M["goma"], (0.1, W + 0.02, 0.16), center=(-L / 2, 0, hb + 0.12))
    snow_caps(b, M["nieve"], min_nz=0.6, thick=0.09, min_area=0.05)
    obj = b.finish(uv_tiles={M[paint].name: 1.6})
    return obj, {
        "collide": [box_c((0, 0, (h1 + 0.1) / 2), (L, W, h1 + 0.1)), box_c(((x0 + x1) / 2, 0, (h1 + h2) / 2), (x1 - x0 + 0.4, W - 0.2, h2 - h1))],
        "carve": [box_c((0, 0, h2 / 2 + 0.15), (L + 0.6, W + 0.6, h2 + 0.5))],
    }


def auto_sedan(M):
    return _car("auto_sedan", M, "auto_blanco", L=4.3)


def auto_sedan_gris(M):
    return _car("auto_sedan_gris", M, "auto_gris", L=4.3)


def auto_suv(M):
    return _car("auto_suv", M, "auto_gris", L=4.6, W=1.85, tall=True)


def colectivo(M):
    """Colectivo línea 64 (frente hacia +X)."""
    b = Builder("colectivo")
    L, W, H = 12.0, 2.55, 3.1
    z0 = 0.35
    # Carrocería: perfil frontal redondeado arriba
    prof = [(-W / 2, z0), (W / 2, z0), (W / 2, H - 0.15), (W / 2 - 0.12, H), (-W / 2 + 0.12, H), (-W / 2, H - 0.15)]
    b.profile_extrude(M["bus"], prof, -L / 2, L / 2)
    # ventanillas laterales: paños oscuros con parantes
    nwin = 7
    span = L - 3.0
    for sy in (-1, 1):
        y = sy * (W / 2 + 0.005)
        b.box(M["vidrio_bus"], (span, 0.02, 1.05), center=(-0.9, y, 2.0))
        for i in range(nwin + 1):
            x = -0.9 - span / 2 + span * i / nwin
            b.box(M["bus"], (0.1, 0.04, 1.08), center=(x, y + sy * 0.01, 2.0))
    # puerta delantera (lado derecho = -Y)
    b.box(M["vidrio_bus"], (1.1, 0.02, 2.2), center=(L / 2 - 1.2, -W / 2 - 0.006, 1.55))
    # parabrisas y luneta
    b.box(M["vidrio_bus"], (0.02, W - 0.2, 1.4), center=(L / 2 + 0.006, 0, 1.95))
    b.box(M["vidrio_bus"], (0.02, W - 0.4, 0.8), center=(-L / 2 - 0.006, 0, 2.2))
    # cartel de destino
    b.box(M["texto_negro"], (0.04, W - 0.3, 0.32), center=(L / 2 + 0.02, 0, H - 0.3))
    text_into(b, M["texto_led"], "64  PLAZA DE MAYO", 0.17, Matrix.Translation((L / 2 + 0.045, 0, H - 0.3)) @ Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"), extrude=0.005)
    b.box(M["texto_negro"], (0.04, 0.5, 0.3), center=(-L / 2 - 0.02, 0, H - 0.4))
    text_into(b, M["texto_led"], "64", 0.22, Matrix.Translation((-L / 2 - 0.045, 0, H - 0.4)) @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X"), extrude=0.005)
    # faros, paragolpes, ruedas
    for sy in (-1, 1):
        b.box(M["luz_bus"], (0.04, 0.35, 0.18), center=(L / 2 + 0.01, sy * 0.85, 0.75))
        b.box(M["texto_negro"], (0.04, 0.25, 0.3), center=(-L / 2 - 0.01, sy * 0.95, 0.9))
    b.box(M["goma"], (0.18, W + 0.04, 0.3), center=(L / 2, 0, 0.42))
    b.box(M["goma"], (0.18, W + 0.04, 0.3), center=(-L / 2, 0, 0.42))
    for x in (L / 2 - 2.4, -L / 2 + 2.9):
        for sy in (-1, 1):
            _wheel(b, M, x, sy * (W / 2 - 0.15), r=0.5, w=0.32)
    # techo: equipos
    b.box(M["bus"], (2.2, 1.6, 0.22), center=(-1.5, 0, H + 0.11))
    snow_caps(b, M["nieve"], min_nz=0.6, thick=0.14, min_area=0.1)
    obj = b.finish(uv_tiles={"ColectivoPintura": 3.2})
    return obj, {
        "collide": [box_c((0, 0, H / 2 + 0.05), (L, W, H + 0.1))],
        # el splat del colectivo tiene un halo ancho (Marble): recorte generoso
        "carve": [box_c((0, 0, H / 2 + 0.4), (L + 2.0, W + 2.6, H + 1.6))],
    }


# ---------------------------------------------------------------------------
# Kiosco, subte
# ---------------------------------------------------------------------------


def kiosco(M):
    b = Builder("kiosco")
    w, d, h = 2.4, 1.7, 2.35
    b.box(M["kiosco"], (w, d, 0.25), center=(0, 0, 0.125))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box(M["kiosco"], (0.1, 0.1, h), center=(sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), h / 2))
    b.box(M["revistas"], (w - 0.2, 0.06, h - 0.6), center=(0, 0.2, 0.25 + (h - 0.6) / 2))
    for sx in (-1, 1):
        b.box(M["revistas"], (0.06, d - 0.2, h - 0.6), center=(sx * (w / 2 - 0.06), 0, 0.25 + (h - 0.6) / 2))
    b.box(M["kiosco"], (w - 0.2, 0.06, h - 0.3), center=(0, d / 2 - 0.05, h / 2))
    # mostrador
    b.box(M["kiosco"], (w - 0.2, 0.5, 0.95), center=(0, -d / 2 + 0.3, 0.6))
    b.box(M["revistas"], (w - 0.3, 0.45, 0.04), center=(0, -d / 2 + 0.3, 1.09))
    # techo con alero
    b.box(M["kiosco"], (w + 0.6, d + 0.6, 0.14), center=(0, 0, h + 0.07))
    b.poly_extrude(M["kiosco"], [(-w / 2 - 0.2, -d / 2 - 0.2), (w / 2 + 0.2, -d / 2 - 0.2), (w / 2 + 0.2, d / 2 + 0.2), (-w / 2 - 0.2, d / 2 + 0.2)], h + 0.14, h + 0.3)
    b.box(M["cartel"], (w - 0.1, 0.04, 0.22), center=(0, -d / 2 - 0.31, h + 0.05))
    text_into(b, M["texto_negro"], "DIARIOS Y REVISTAS", 0.13, Matrix.Translation((0, -d / 2 - 0.335, h + 0.05)) @ Matrix.Rotation(math.pi / 2, 4, "X"), extrude=0.004)
    snow_caps(b, M["nieve"], thick=0.1, min_area=0.1)
    obj = b.finish(uv_tiles={"Revistas": (w - 0.2, h - 0.6, 0.5, -0.25 / (h - 0.6))})
    return obj, {"collide": [box_c((0, 0, h / 2), (w + 0.1, d + 0.1, h))], "carve": [box_c((0, 0, h / 2 + 0.3), (w + 1.2, d + 1.2, h + 1.0))]}


def subte(M):
    """Boca de subte: escalera que baja (frente hacia -Y), barandas y cartel."""
    b = Builder("subte")
    w, L = 1.9, 4.6
    steps = 16
    for i in range(steps):
        y = -L / 2 + 0.4 + i * (L - 0.6) / steps
        z = -0.19 * (i + 1)
        b.box(M["granito"], (w, (L - 0.6) / steps + 0.01, 0.2), center=(0, y, z))
    # paredes laterales de la escalera
    for sx in (-1, 1):
        b.box(M["granito"], (0.15, L, 3.4), center=(sx * (w / 2 + 0.075), 0, -1.6))
    b.box(M["granito"], (w + 0.3, 0.15, 3.4), center=(0, L / 2 + 0.075, -1.6))
    b.box(M["tierra"], (w, 0.1, 3.0), center=(0, L / 2 - 0.05, -2.0))
    # cordón superior y barandas
    for sx in (-1, 1):
        b.box(M["granito"], (0.3, L + 0.3, 0.25), center=(sx * (w / 2 + 0.15), 0, 0.125))
        b.tube(M["kiosco"], [(sx * (w / 2 + 0.15), -L / 2, 0.25), (sx * (w / 2 + 0.15), -L / 2, 1.1), (sx * (w / 2 + 0.15), L / 2, 1.1), (sx * (w / 2 + 0.15), L / 2, 0.25)], 0.03, 6)
        for i in range(1, 16):
            y = -L / 2 + L * i / 16
            b.tube(M["kiosco"], [(sx * (w / 2 + 0.15), y, 0.25), (sx * (w / 2 + 0.15), y, 1.1)], 0.012, 4)
    b.box(M["granito"], (w + 0.6, 0.3, 0.25), center=(0, L / 2 + 0.15, 0.125))
    b.tube(M["kiosco"], [(-w / 2 - 0.15, L / 2 + 0.15, 1.1), (w / 2 + 0.15, L / 2 + 0.15, 1.1)], 0.03, 6)
    # arco con cartel SUBTE
    for sx in (-1, 1):
        b.tube(M["kiosco"], [(sx * (w / 2 + 0.15), -L / 2, 1.1), (sx * (w / 2 + 0.15), -L / 2, 2.4)], 0.04, 6)
    pts = [(math.cos(a) * (w / 2 + 0.15), -L / 2, 2.4 + math.sin(a) * 0.5) for a in [math.pi * k / 10 for k in range(11)]]
    b.tube(M["kiosco"], pts, 0.04, 6)
    b.box(M["cartel"], (1.3, 0.06, 0.32), center=(0, -L / 2, 2.62))
    text_into(b, M["texto_negro"], "SUBTE", 0.24, Matrix.Translation((0, -L / 2 - 0.035, 2.62)) @ Matrix.Rotation(math.pi / 2, 4, "X"), extrude=0.006)
    snow_caps(b, M["nieve"], thick=0.04, min_area=0.03)
    obj = b.finish(uv_tiles={"Granito": 1.2})
    return obj, {
        "collide": [box_c((0, 0, 0.6), (w + 0.6, L + 0.3, 1.2))],
        "carve": [box_c((0, 0, -0.5), (w + 1.0, L + 1.0, 5.0)), box_c((0, -L / 2, 2.0), (w + 1.0, 0.8, 1.6))],
    }


# ---------------------------------------------------------------------------
# Vegetación
# ---------------------------------------------------------------------------


def _frond(b, M, top, az, up, Lf, n_leaf, leaf_len, mat, droop=0.55):
    d = Vector((math.cos(az), math.sin(az), 0))
    side = Vector((-d.y, d.x, 0))
    rpts = []
    for i in range(11):
        t = i / 10
        h = math.sin(min(t * 1.4, 1) * (math.pi / 2)) * up * Lf * 0.5 - (t**2) * Lf * droop
        rpts.append(top + d * (Lf * t * (1 - 0.15 * max(0, -up))) + Vector((0, 0, h + 0.1)))
    b.tube(mat, [tuple(p) for p in rpts], [0.05 - 0.035 * i / 10 for i in range(11)], 4)

    def leaflets():
        bm = b.bm
        for i in range(1, n_leaf + 1):
            t = i / (n_leaf + 1)
            k = t * 10
            i0 = min(int(k), 9)
            f = k - i0
            p0 = Vector(rpts[i0]).lerp(Vector(rpts[i0 + 1]), f)
            along = (Vector(rpts[i0 + 1]) - Vector(rpts[i0])).normalized()
            ln = leaf_len * (math.sin(math.pi * min(t * 1.15, 1)) * 0.8 + 0.2)
            for sgn in (-1, 1):
                lat = side * sgn
                tip = p0 + lat * ln * 0.85 + Vector((0, 0, -0.35 * ln)) + along * (0.35 * ln)
                v0 = bm.verts.new(p0)
                v1 = bm.verts.new(p0 + along * 0.1)
                v2 = bm.verts.new(tip + along * 0.04)
                v3 = bm.verts.new(tip)
                bm.faces.new((v0, v1, v2, v3))

    b._run(mat, leaflets)


def palmera(M, height=11.0, seed=1, name="palmera"):
    """Palmera de copa densa (fénix): tres pisos de frondas + pollera de hojas secas."""
    rnd = random.Random(seed)
    b = Builder(name)
    lean = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), 0))
    n = 16
    pts, radii = [], []
    for i in range(n + 1):
        t = i / n
        p = Vector((0, 0, height * t)) + lean * (t**2)
        pts.append(tuple(p))
        r = 0.4 - 0.1 * t
        if t < 0.08:
            r += 0.14 * (1 - t / 0.08)
        if t > 0.9:
            r += 0.18 * (t - 0.9) / 0.1
        radii.append(r)
    b.tube(M["palma_tronco"], pts, radii, 10, caps=True)
    top = Vector(pts[-1]) + Vector((0, 0, 0.15))
    b.sphere(M["palma_tronco"], 0.5, center=tuple(top + Vector((0, 0, -0.1))), subdiv=1, scale=(1, 1, 0.8))
    tiers = ((12, 0.9, 1.3, 3.8, 4.5), (15, 0.2, 0.6, 4.4, 5.4), (12, -0.5, 0.05, 4.0, 4.9))
    for count, lo, hi, l0, l1 in tiers:
        off = rnd.uniform(0, math.pi)
        for k in range(count):
            az = off + 2 * math.pi * k / count + rnd.uniform(-0.2, 0.2)
            _frond(b, M, top, az, rnd.uniform(lo, hi), rnd.uniform(l0, l1), 18, 1.05, M["fronda"], droop=rnd.uniform(0.45, 0.65))
    # pollera: frondas secas colgando
    for k in range(9):
        az = 2 * math.pi * k / 9 + rnd.uniform(-0.2, 0.2)
        _frond(b, M, top + Vector((0, 0, -0.45)), az, -1.3, rnd.uniform(1.8, 2.4), 9, 0.5, M["fronda_seca"], droop=0.75)
    snow_caps(b, M["nieve"], min_nz=0.9, thick=0.02, min_area=0.004, skip=(M["palma_tronco"],))
    obj = b.finish(uv_tiles={"PalmaTronco": 1.4})
    return obj, {"collide": [cyl_c((0, 0, 2.0), 0.42, 4.0)], "carve": [cyl_c((0, 0, height / 2), 0.8, height), {"type": "sphere", "c": list(top + Vector((0, 0, -0.3))), "r": 5.4}]}


def arbol(M, seed=3, height=8.5, name="arbol", leafy=0.7):
    """Árbol de plaza en invierno: ramificación recursiva fina + matas de follaje nevadas."""
    rnd = random.Random(seed)
    b = Builder(name)
    tips = []
    scale = height / 8.5

    def branch(p0, d, length, r, depth):
        segs = 4 if depth < 3 else 3
        pts = [p0]
        p = Vector(p0)
        dd = Vector(d)
        for i in range(segs):
            dd = (dd + Vector((rnd.uniform(-0.22, 0.22), rnd.uniform(-0.22, 0.22), rnd.uniform(-0.04, 0.16)))).normalized()
            p = p + dd * (length / segs)
            pts.append(tuple(p))
        sides = (7, 6, 5, 4, 3, 3)[depth]
        b.tube(M["corteza"], pts, [r * (1 - 0.4 * i / segs) for i in range(segs + 1)], sides)
        end = Vector(pts[-1])
        if depth >= 5:
            tips.append(end)
            return
        if depth >= 2:
            tips.append(Vector(pts[2]))
            tips.append(Vector(pts[3]))
        kids = (3, 3, 2, 2, 2)[depth]
        for k in range(kids):
            az = 2 * math.pi * (k / kids) + rnd.uniform(-0.7, 0.7)
            tilt = rnd.uniform(0.4, 0.8) if depth else rnd.uniform(0.55, 0.8)
            nd = (dd * (1 - tilt) + Vector((math.cos(az), math.sin(az), 0.35)) * tilt).normalized()
            branch(tuple(end), nd, length * rnd.uniform(0.6, 0.78), r * 0.6, depth + 1)

    branch((0, 0, 0), (0, 0, 1), 2.6 * scale, 0.26 * scale, 0)
    for t in tips:
        if rnd.random() < leafy:
            for _ in range(3):
                rr = rnd.uniform(0.09, 0.17) * scale
                off = Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(-0.1, 0.25))) * scale
                b.sphere(M["follaje"], rr, center=tuple(t + off), subdiv=1, scale=(1.2, 1.2, 0.8))
    snow_caps(b, M["nieve"], min_nz=0.55, thick=0.03, min_area=0.002, skip=(M["follaje"],))
    obj = b.finish(uv_tiles={"Corteza": 1.0})
    xs = [abs(t.x) for t in tips] + [abs(t.y) for t in tips]
    top = max(t.z for t in tips)
    rad = max(xs) if xs else 3
    return obj, {"collide": [cyl_c((0, 0, 1.5), 0.32 * scale, 3.0)], "carve": [cyl_c((0, 0, top / 2 + 0.5), 0.6, top + 1), {"type": "sphere", "c": [0, 0, top * 0.62], "r": max(rad, top * 0.42) + 0.5}]}

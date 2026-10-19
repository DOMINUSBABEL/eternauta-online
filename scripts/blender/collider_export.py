"""
Genera el collider corregido a partir de la escena "Eternauta_Colisiones".

1. Lee las correcciones de la colección "Correcciones" (cajas y cilindros,
   tal como hayan quedado tras editarlas en Blender) y actualiza
   assets-src/collider-fixes.json.
2. Copia el collider de Marble, lo CORTA exactamente en el borde de la zona de
   cada corrección (huella + clearMargin; bisect con 4 planos verticales) y
   borra lo que queda adentro: los montículos y mesetas falsos.
3. Agrega un parche de suelo plano que cubre exactamente esa zona, a la altura
   del suelo, y el volumen sólido de la corrección.
4. Escribe assets-src/collider_refined.glb (glTF Y-up = coordenadas del juego).
   El GLB se escribe directamente (posiciones + índices), sin el exportador de
   Blender: llamarlo desde el temporizador del addon MCP puede cerrar Blender.

Luego: npm run collider:publish  →  public/assets/collider.glb

Ejecutar dentro de Blender con ROOT definido (ver collider_setup.py).
"""

import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = globals().get("ROOT") or os.environ.get("ETERNAUTA_ROOT")
if not ROOT:
    raise RuntimeError('Definí ROOT = "/ruta/al/repo" antes de ejecutar el script')

SCENE = "Eternauta_Colisiones"
FIXES_JSON = os.path.join(ROOT, "assets-src", "collider-fixes.json")
OUT_GLB = os.path.join(ROOT, "assets-src", "collider_refined.glb")
# Sólo se borran caras por debajo de (suelo + alto de la corrección + este margen):
# así no se tocan fachadas ni copas de árboles altas que pasen por encima.
CLEAR_ABOVE = 1.0
# Un parche "ground" declara piso abierto: limpia hasta esta altura sobre el suelo
# (Marble deja mesetas de ~1,7 m en zonas ocluidas). Ajustable con "clearHeight".
GROUND_CLEAR_HEIGHT = 3.0


def read_fixes(sc):
    """Correcciones desde los objetos de Blender (fuente de verdad tras editar)."""
    col = bpy.data.collections["Correcciones"]
    fixes = []
    for obj in sorted(col.objects, key=lambda o: o.name):
        kind = obj.get("kind", "box")
        # matrix_basis (loc/rot/escala del objeto) siempre está al día;
        # matrix_world recién se actualiza al reevaluar la escena.
        m = obj.matrix_basis
        loc = m.translation
        yaw = m.to_euler().z
        sx, sy, sz = m.to_scale()
        ground = loc.z - sz / 2
        if kind == "ground":
            sz = 0.0
        f = {
            "name": obj.name,
            "kind": kind,
            "x": round(loc.x, 3),
            "z": round(-loc.y, 3),
            "yawDeg": round(math.degrees(yaw), 2),
            "height": round(sz, 3),
            "ground": round(ground, 3),
            "source": obj.get("source", "editado en Blender"),
        }
        if "clearHeight" in obj:
            f["clearHeight"] = float(obj["clearHeight"])
        if kind == "cylinder":
            f["radius"] = round(max(sx, sy) / 2, 3)
        else:
            f["length"] = round(sx, 3)
            f["width"] = round(sy, 3)
        fixes.append((f, obj))
    return fixes


def half_extents(f, margin):
    if f["kind"] == "cylinder":
        return f["radius"] + margin, f["radius"] + margin
    return f["length"] / 2 + margin, f["width"] / 2 + margin


def cut_region(bm, f, margin, top):
    """Corta la malla en el borde del rectángulo (huella + margen) y borra lo de
    adentro por debajo de `top`. Sólo toca geometría cercana a la corrección."""
    cx, cy = f["x"], -f["z"]
    yaw = math.radians(f["yawDeg"])
    ux = Vector((math.cos(yaw), math.sin(yaw), 0.0))
    uy = Vector((-math.sin(yaw), math.cos(yaw), 0.0))
    ha, hb = half_extents(f, margin)
    reach = math.hypot(ha, hb) + 4.0
    center = Vector((cx, cy, 0.0))

    def local_geom():
        faces = [fc for fc in bm.faces if (Vector((fc.calc_center_median().x, fc.calc_center_median().y, 0)) - center).length < reach + 3]
        verts = {v for fc in faces for v in fc.verts}
        edges = {e for fc in faces for e in fc.edges}
        return list(verts) + list(edges) + faces

    for axis, half in ((ux, ha), (ux, -ha), (uy, hb), (uy, -hb)):
        sign = 1 if half > 0 else -1
        co = center + axis * half
        bmesh.ops.bisect_plane(bm, geom=local_geom(), dist=1e-5, plane_co=co, plane_no=axis * sign)

    doomed = []
    for fc in bm.faces:
        cm = fc.calc_center_median()
        d = Vector((cm.x - cx, cm.y - cy, 0.0))
        if cm.z < top and abs(d.dot(ux)) < ha - 1e-3 and abs(d.dot(uy)) < hb - 1e-3:
            doomed.append(fc)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    return len(doomed)


def footprint_test(f, margin):
    """Devuelve una función (X, Y) Blender → ¿dentro de la huella + margen?"""
    cx, cy = f["x"], -f["z"]
    yaw = math.radians(f["yawDeg"])
    c, s = math.cos(-yaw), math.sin(-yaw)
    if f["kind"] == "cylinder":
        r = f["radius"] + margin
        return lambda X, Y: (X - cx) ** 2 + (Y - cy) ** 2 <= r * r
    ha, hb = f["length"] / 2 + margin, f["width"] / 2 + margin

    def inside(X, Y):
        dx, dy = X - cx, Y - cy
        a, b = dx * c - dy * s, dx * s + dy * c
        return abs(a) <= ha and abs(b) <= hb

    return inside


def add_patch(bm, f, margin):
    cx, cy, g = f["x"], -f["z"], f["ground"]
    if f["kind"] == "cylinder":
        ha = hb = f["radius"] + margin
    else:
        ha, hb = f["length"] / 2 + margin, f["width"] / 2 + margin
    yaw = math.radians(f["yawDeg"])
    c, s = math.cos(yaw), math.sin(yaw)
    verts = [bm.verts.new((cx + a * c - b * s, cy + a * s + b * c, g)) for a, b in [(-ha, -hb), (ha, -hb), (ha, hb), (-ha, hb)]]
    bm.faces.new(verts)


def add_solid(bm, f):
    if f["kind"] == "ground":
        return  # sólo parche de suelo
    g, h = f["ground"], f["height"]
    m = Matrix.Translation((f["x"], -f["z"], g + h / 2)) @ Matrix.Rotation(math.radians(f["yawDeg"]), 4, "Z")
    if f["kind"] == "cylinder":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=f["radius"], radius2=f["radius"], depth=h, matrix=m)
    else:
        m = m @ Matrix.Diagonal((f["length"], f["width"], h, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def write_glb(path, positions, indices):
    """GLB mínimo: un nodo, una malla, POSITION (float32) + índices (uint32)."""
    n = len(positions) // 3
    mins = [min(positions[i::3]) for i in range(3)]
    maxs = [max(positions[i::3]) for i in range(3)]
    pos_bytes = struct.pack(f"<{len(positions)}f", *positions)
    idx_bytes = struct.pack(f"<{len(indices)}I", *indices)
    pad = lambda b, fill: b + fill * ((4 - len(b) % 4) % 4)
    pos_bytes = pad(pos_bytes, b"\0")
    gltf = {
        "asset": {"version": "2.0", "generator": "eternauta-online collider_export.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "collider", "mesh": 0}],
        "meshes": [{"name": "collider", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3", "min": mins, "max": maxs},
            {"bufferView": 1, "componentType": 5125, "count": len(indices), "type": "SCALAR"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": n * 12, "target": 34962},
            {"buffer": 0, "byteOffset": len(pos_bytes), "byteLength": len(indices) * 4, "target": 34963},
        ],
        "buffers": [{"byteLength": len(pos_bytes) + len(idx_bytes)}],
    }
    js = pad(json.dumps(gltf, separators=(",", ":")).encode(), b" ")
    binary = pad(pos_bytes + idx_bytes, b"\0")
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<4sII", b"glTF", 2, total))
        fh.write(struct.pack("<I4s", len(js), b"JSON") + js)
        fh.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def main():
    sc = bpy.data.scenes[SCENE]
    with open(FIXES_JSON) as fh:
        doc = json.load(fh)
    clear_margin = doc.get("clearMargin", 1.5)
    patch_margin = doc.get("patchMargin", 2.2)

    fixes = read_fixes(sc)
    # Protección: si las transformaciones leídas son degeneradas (objetos en el
    # origen con escala 1), no escribir nada: el JSON es la fuente de verdad.
    degenerate = [f["name"] for f, _ in fixes if abs(f["x"]) < 1e-6 and abs(f["z"]) < 1e-6 and f["height"] in (0.0, 1.0)]
    if len(degenerate) > len(fixes) // 2:
        raise RuntimeError(f"Transformaciones degeneradas en {degenerate}: no se exporta (¿escena sin actualizar?)")
    base = bpy.data.objects["Collider_Marble"]

    bm = bmesh.new()
    bm.from_mesh(base.data)
    bm.transform(base.matrix_basis)
    bm.faces.ensure_lookup_table()

    report = []
    removed = 0
    for f, _ in fixes:
        if "clearHeight" in f:
            top = f["ground"] + f["clearHeight"]
        elif f["kind"] == "ground":
            top = f["ground"] + GROUND_CLEAR_HEIGHT
        else:
            top = f["ground"] + f["height"] + CLEAR_ABOVE
        n = cut_region(bm, f, clear_margin, top)
        removed += n
        report.append(f"{f['name']:<18} suelo {f['ground']:+.2f}  caras de Marble reemplazadas: {n}")

    for f, _ in fixes:
        # El parche cubre exactamente la zona cortada (+2 cm de solape).
        add_patch(bm, f, clear_margin + 0.02)
        add_solid(bm, f)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])

    # GLB en coordenadas del juego: Blender (X, Y, Z) → juego (X, Z, -Y).
    bm.verts.index_update()
    positions = []
    for v in bm.verts:
        positions.extend((v.co.x, v.co.z, -v.co.y))
    indices = [v.index for face in bm.faces for v in face.verts]
    write_glb(OUT_GLB, positions, indices)
    tri_count = len(bm.faces)

    # Objeto de visualización: malla nueva cada vez (no se edita una en uso).
    mesh = bpy.data.meshes.new("Collider_Refinado")
    bm.to_mesh(mesh)
    bm.free()
    result = bpy.data.objects.get("Collider_Refinado")
    if result is None:
        result = bpy.data.objects.new("Collider_Refinado", mesh)
        bpy.data.collections["Resultado"].objects.link(result)
    else:
        result.data = mesh
    result.matrix_world = Matrix.Identity(4)
    result.color = (0.2, 1.0, 0.4, 1.0)
    result.show_wire = True

    # El JSON queda como fuente de verdad legible (diffs en git); respaldo previo.
    with open(FIXES_JSON) as src, open(FIXES_JSON + ".bak", "w") as bak:
        bak.write(src.read())
    doc["fixes"] = [f for f, _ in fixes]
    with open(FIXES_JSON, "w") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)

    print(f"Exportado {OUT_GLB}: {tri_count} triángulos ({removed} caras de Marble reemplazadas)")
    print("\n".join(report))


main()

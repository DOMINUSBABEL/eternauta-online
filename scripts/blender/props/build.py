"""
Modelos 3D de Plaza de Mayo: arma la escena en Blender y exporta para el juego.

  build   assets-src/props/layout.json → escena "Eternauta_Props" (biblioteca +
          instancias apoyadas en el suelo del splat) → exporta
  export  lee las instancias tal como quedaron en Blender (podés moverlas,
          rotarlas o duplicarlas), reescribe layout.json y exporta

Salidas:
  public/assets/props/props.glb     biblioteca: un objeto por asset, en el origen
  public/assets/props/layout.json   instancias + colisiones + volúmenes de recorte
                                    del splat, en coordenadas del juego (Y arriba)

Uso: npm run props:build / npm run props:export (Blender sin interfaz). Desde el
MCP de Blender (o la consola de Python) arma sólo la escena para verla/editarla:
  p = "/ruta/al/repo/scripts/blender/props/build.py"
  exec(compile(open(p).read(), p, "exec"), {"__file__": p, "__name__": "__main__"})
Después de editar, guardar como assets-src/props.blend y correr npm run props:export.
"""

import json
import math
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.environ["ETERNAUTA_ROOT"], "scripts", "blender", "props")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import assets_big as B  # noqa: E402
import assets_small as A  # noqa: E402
import lib  # noqa: E402
import textures  # noqa: E402

ROOT = lib.ROOT
SCENE = "Eternauta_Props"
LAYOUT_SRC = os.path.join(ROOT, "assets-src", "props", "layout.json")
OUT_DIR = os.path.join(ROOT, "public", "assets", "props")
GROUND_JSON = os.path.join(ROOT, "assets-src", "reference", "ground.json")


def library_builders(M):
    return {
        "casa_rosada": lambda: B.casa_rosada(M),
        "cabildo": lambda: B.cabildo(M),
        "piramide": lambda: B.piramide(M),
        "palmera_a": lambda: A.palmera(M, height=13.2, seed=1, name="palmera_a"),
        "palmera_b": lambda: A.palmera(M, height=14.0, seed=2, name="palmera_b"),
        "palmera_c": lambda: A.palmera(M, height=12.2, seed=3, name="palmera_c"),
        "arbol_a": lambda: A.arbol(M, seed=3, height=8.5, name="arbol_a"),
        "arbol_b": lambda: A.arbol(M, seed=11, height=8.0, name="arbol_b", leafy=0.45),
        "colectivo": lambda: A.colectivo(M),
        "auto_sedan": lambda: A.auto_sedan(M),
        "auto_sedan_gris": lambda: A.auto_sedan_gris(M),
        "auto_suv": lambda: A.auto_suv(M),
        "farol_triple": lambda: A.farol_triple(M),
        "farol_simple": lambda: A.farol_simple(M),
        "farol_alto": lambda: A.farol_alto(M),
        "banco": lambda: A.banco(M),
        "caja_madera": lambda: A.caja_madera(M),
        "caja_militar": lambda: A.caja_militar(M),
        "barrera_jersey": lambda: A.barrera_jersey(M),
        "barrera_roja": lambda: A.barrera_roja(M),
        "valla": lambda: A.valla(M),
        "tacho": lambda: A.tacho(M),
        "tacho_caja": lambda: A.tacho_caja(M),
        "bebedero": lambda: A.bebedero(M),
        "bolardo": lambda: A.bolardo(M),
        "kiosco": lambda: A.kiosco(M),
        "subte": lambda: A.subte(M),
        "reloj": lambda: A.reloj(M),
        "mastil": lambda: A.mastil(M),
    }


# ---------------------------------------------------------------------------
# Suelo del splat (grilla de analyze-props)
# ---------------------------------------------------------------------------

_ground = None


def ground_at(x, z, r=1.0):
    global _ground
    if _ground is None:
        with open(GROUND_JSON) as fh:
            _ground = json.load(fh)
    g = _ground
    a = g["area"]
    vals = []
    steps = max(1, int(r / g["cell"]))
    for i in range(-steps, steps + 1):
        for j in range(-steps, steps + 1):
            cx = int((x + i * g["cell"] - a["minX"]) / g["cell"])
            cz = int((z + j * g["cell"] - a["minZ"]) / g["cell"])
            if 0 <= cx < g["width"] and 0 <= cz < g["height"]:
                v = g["values"][cz * g["width"] + cx]
                if v is not None:
                    vals.append(v)
    if not vals:
        return -0.2
    vals.sort()
    return vals[len(vals) // 2]


# ---------------------------------------------------------------------------
# Escena
# ---------------------------------------------------------------------------


def get_scene():
    sc = bpy.data.scenes.get(SCENE)
    if sc is None and bpy.app.background:
        # Sin interfaz no hay ventana para cambiar de escena: se usa la del contexto
        # (exportar desde una escena que no es la activa cierra Blender).
        sc = bpy.context.scene
        sc.name = SCENE
    elif sc is None:
        sc = bpy.data.scenes.new(SCENE)
    sc.unit_settings.system = "METRIC"
    return sc


def clear_scene(sc):
    for obj in list(sc.objects):
        if all(s == sc for s in obj.users_scene):
            bpy.data.objects.remove(obj, do_unlink=True)


def yaw_facing(x, z, tx, tz):
    """Yaw (grados) para que el frente del asset (-Y local en Blender) mire a (tx, tz)."""
    dx, dy = tx - x, -(tz - z)
    return math.degrees(math.atan2(dx, -dy))


def build(doc):
    t0 = time.time()
    sc = get_scene()
    for win in bpy.context.window_manager.windows:
        win.scene = sc
    clear_scene(sc)
    col_lib = lib.ensure_collection(sc, "Biblioteca")
    col_inst = lib.ensure_collection(sc, "Instancias")
    M = textures.build_materials()
    builders = library_builders(M)
    metas = {}
    library = {}

    def make_asset(name, fn):
        obj, meta = fn()
        obj.name = name
        obj.data.name = name
        col_lib.objects.link(obj)
        obj["asset"] = name
        obj["meta"] = json.dumps(meta)
        library[name] = obj
        metas[name] = meta
        return obj

    used = sorted({e["asset"] for e in doc["instances"] if e["asset"] != "cantero"})
    for name in used:
        make_asset(name, builders[name])
    for i, e in enumerate(doc["instances"]):
        if e["asset"] == "cantero":
            nm = e.get("name") or f"cantero_{i:02d}"
            make_asset(nm, lambda e=e, nm=nm, i=i: B.cantero(M, e["length"], e["width"], nm, seed=i))

    for i, e in enumerate(doc["instances"]):
        asset = e.get("name") if e["asset"] == "cantero" else e["asset"]
        src = library[asset]
        x, z = e["x"], e["z"]
        yaw = e.get("yaw", 0.0)
        if "face" in e:
            yaw = yaw_facing(x, z, *e["face"])
        if "y" in e:
            y = e["y"]
        else:
            y = ground_at(x, z) + e.get("y_offset", 0.0)
        inst = bpy.data.objects.new(f"{asset}.{i:03d}", src.data)
        inst.location = (x, -z, y)
        inst.rotation_euler = (0, 0, math.radians(yaw))
        s = e.get("scale", 1.0)
        inst.scale = (s, s, s)
        inst["asset"] = asset
        col_inst.objects.link(inst)
    # La biblioteca no se ve en el visor (las instancias usan las mismas mallas).
    vl = sc.view_layers[0]
    vl.layer_collection.children[col_lib.name].hide_viewport = True
    print(f"Escena '{SCENE}': {len(library)} assets, {len(doc['instances'])} instancias ({time.time() - t0:.1f} s)")
    return sc


# ---------------------------------------------------------------------------
# Exportación
# ---------------------------------------------------------------------------


def to_game_prim(p):
    """Primitiva local de Blender (Z arriba) → espacio local de Three.js (Y arriba)."""
    c = p["c"]
    q = {"type": p["type"], "c": [round(c[0], 3), round(c[2], 3), round(-c[1], 3)]}
    if p["type"] == "box":
        s = p["s"]
        q["s"] = [round(s[0], 3), round(s[2], 3), round(s[1], 3)]
        q["ry"] = round(p.get("rz", 0.0), 4)
    elif p["type"] == "cyl":
        q["r"], q["h"] = round(p["r"], 3), round(p["h"], 3)
    else:
        q["r"] = round(p["r"], 3)
    return q


def carve_above_ground(p, floor=0.12):
    """Los recortes no bajan del suelo (si no, el splat del piso queda agujereado)."""
    p = dict(p)
    if p.get("below"):
        return p
    if p["type"] == "box":
        lo = p["c"][2] - p["s"][2] / 2
        hi = p["c"][2] + p["s"][2] / 2
        if lo < floor:
            lo = floor
            p["c"] = [p["c"][0], p["c"][1], (lo + hi) / 2]
            p["s"] = [p["s"][0], p["s"][1], max(hi - lo, 0.05)]
    elif p["type"] == "cyl":
        lo = p["c"][2] - p["h"] / 2
        hi = p["c"][2] + p["h"] / 2
        if lo < floor:
            lo = floor
            p["c"] = [p["c"][0], p["c"][1], (lo + hi) / 2]
            p["h"] = max(hi - lo, 0.05)
    else:
        if p["c"][2] - p["r"] < floor:
            p["r"] = max(p["c"][2] - floor, 0.05)
    return p


def read_instances(sc):
    col = bpy.data.collections["Instancias"]
    out = []
    for obj in sorted(col.objects, key=lambda o: o.name):
        asset = obj.get("asset") or obj.data.name
        m = obj.matrix_basis
        loc = m.translation
        yaw = m.to_euler().z
        s = m.to_scale()
        out.append({"asset": asset, "x": round(loc.x, 3), "y": round(loc.z, 3), "z": round(-loc.y, 3), "yaw": round(math.degrees(yaw), 2), "scale": round(s.x, 3)})
    return out


def export(sc, doc=None):
    t0 = time.time()
    os.makedirs(OUT_DIR, exist_ok=True)
    col_lib = bpy.data.collections["Biblioteca"]
    library = {o.name: o for o in col_lib.objects}
    instances = read_instances(sc)
    if not instances:
        raise RuntimeError("No hay instancias en la colección 'Instancias': no se exporta")

    assets = {}
    for name, obj in library.items():
        meta = json.loads(obj.get("meta", "{}"))
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        assets[name] = {
            "tris": tris,
            "collide": [to_game_prim(p) for p in meta.get("collide", [])],
            "carve": [to_game_prim(carve_above_ground(p)) for p in meta.get("carve", [])],
        }
    used = {i["asset"] for i in instances}
    out_layout = {
        "version": 1,
        "generator": "scripts/blender/props/build.py",
        "note": "Generado: no editar a mano (fuente: assets-src/props/layout.json o assets-src/props.blend).",
        "assets": {k: v for k, v in assets.items() if k in used},
        "instances": instances,
    }
    with open(os.path.join(OUT_DIR, "layout.json"), "w") as fh:
        json.dump(out_layout, fh, separators=(",", ":"), ensure_ascii=False)

    # GLB de la biblioteca (sólo los assets usados).
    vl = sc.view_layers[0]
    lc = vl.layer_collection.children[col_lib.name]
    lc.hide_viewport = False
    lc.exclude = False
    for o in sc.objects:
        o.select_set(False)
    for name, obj in library.items():
        if name in used:
            obj.hide_set(False)
            obj.select_set(True)
    glb = os.path.join(OUT_DIR, "props.glb")
    override = {"scene": sc, "view_layer": vl}
    with bpy.context.temp_override(**override):
        bpy.ops.export_scene.gltf(
            filepath=glb,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=False,
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_image_format="JPEG",
            export_jpeg_quality=82,
            export_animations=False,
            export_cameras=False,
            export_lights=False,
            export_extras=False,
        )
    for obj in library.values():
        obj.select_set(False)
    lc.hide_viewport = True

    # Fuente de verdad legible: layout.json con las posiciones tal como quedaron.
    if doc is not None:
        src_by_asset = {}
        for e in doc["instances"]:
            key = e.get("name") if e["asset"] == "cantero" else e["asset"]
            src_by_asset.setdefault(key, []).append(e)
        new = []
        for inst in instances:
            base = (src_by_asset.get(inst["asset"]) or [{}])
            e = dict(base.pop(0)) if base else {"asset": inst["asset"]}
            e.pop("face", None)
            e.pop("y_offset", None)
            e["x"], e["z"], e["yaw"] = inst["x"], inst["z"], inst["yaw"]
            e["y"] = inst["y"]
            if abs(inst["scale"] - 1) > 1e-3:
                e["scale"] = inst["scale"]
            new.append(e)
        doc = dict(doc)
        doc["instances"] = new
        with open(LAYOUT_SRC + ".bak", "w") as fh, open(LAYOUT_SRC) as src:
            fh.write(src.read())
        with open(LAYOUT_SRC, "w") as fh:
            fh.write(json.dumps(doc, indent=1, ensure_ascii=False))
    total = sum(assets[i["asset"]]["tris"] for i in instances)
    print(f"Exportado {glb} ({os.path.getsize(glb) / 1e6:.2f} MB), {len(used)} assets, {len(instances)} instancias, {total} triángulos en escena ({time.time() - t0:.1f} s)")


def main(mode):
    with open(LAYOUT_SRC) as fh:
        doc = json.load(fh)
    if mode == "scene":
        # Desde el MCP / la interfaz: sólo arma la escena para verla y editarla.
        # (El exportador glTF llamado desde el temporizador del addon cerró Blender
        # alguna vez: exportar con npm run props:export, sin interfaz.)
        build(doc)
    elif mode == "build":
        sc = build(doc)
        bpy.context.view_layer.update()
        export(sc)
    elif mode == "export":
        export(get_scene(), doc)
    else:
        raise SystemExit(f"modo desconocido: {mode}")


if __name__ == "__main__":
    default = "build" if bpy.app.background else "scene"
    mode = os.environ.get("ETERNAUTA_MODE") or (sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else default)
    main(mode)
    if bpy.app.background:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets-src", "props.blend"), compress=True)

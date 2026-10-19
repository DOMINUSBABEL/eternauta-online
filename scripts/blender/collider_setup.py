"""
Arma en Blender la escena para corregir el collider de Marble.

Crea (o reconstruye) la escena "Eternauta_Colisiones" sin tocar las demás:
  - Referencia/      vista cenital del splat (topdown.png) y mapa de alturas
  - Collider_Marble/ assets-src/collider_base.glb (collider de Marble preparado)
  - Correcciones/    una caja o cilindro por cada entrada de
                     assets-src/collider-fixes.json, apoyada en el suelo

Las correcciones se editan moviendo / rotando / escalando los objetos
(escala = largo × ancho × alto; en cilindros, X = Y = diámetro). Tipos:
  box       volumen sólido (canteros, colectivo, cajones…)
  cylinder  volumen cilíndrico (troncos, postes)
  ground    sólo suelo plano: borra un artefacto de Marble sin agregar volumen
Después se corre collider_export.py, que vuelve a escribir el JSON y genera el GLB.

Ejecutar dentro de Blender con ROOT definido (ruta del repo), p. ej. vía el
MCP de Blender (execute_blender_code) anteponiendo: ROOT = "/ruta/al/repo"

Coordenadas: juego (Three.js, Y arriba) → Blender (Z arriba):
  X = x,  Y = -z,  Z = y,  rotación Z = yawDeg
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = globals().get("ROOT") or os.environ.get("ETERNAUTA_ROOT")
if not ROOT:
    raise RuntimeError('Definí ROOT = "/ruta/al/repo" antes de ejecutar el script')

SCENE = "Eternauta_Colisiones"
BASE_GLB = os.path.join(ROOT, "assets-src", "collider_base.glb")
FIXES_JSON = os.path.join(ROOT, "assets-src", "collider-fixes.json")
REF_DIR = os.path.join(ROOT, "assets-src", "reference")


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def game_to_blender(x, y, z):
    return Vector((x, -z, y))


def main_window():
    """Ventana con visor 3D, o None si Blender corre sin interfaz (-b)."""
    wm = bpy.context.window_manager
    for win in wm.windows:
        if any(a.type == "VIEW_3D" for a in win.screen.areas):
            return win
    return wm.windows[0] if wm.windows else None


def get_scene():
    sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    sc.unit_settings.system = "METRIC"
    return sc


def collection(sc, name):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
    if col.name not in sc.collection.children:
        sc.collection.children.link(col)
    return col


def clear_scene(sc):
    """Borra sólo objetos que pertenecen exclusivamente a esta escena.

    No borra mallas ni materiales a mano: liberar datos que el depsgraph
    todavía referencia puede cerrar Blender. Quedan huérfanos y Blender los
    descarta al guardar."""
    for obj in list(sc.objects):
        if all(s == sc for s in obj.users_scene):
            bpy.data.objects.remove(obj, do_unlink=True)


def material(name, rgba, emission_image=None, alpha=None):
    # Reutilizar si ya existe: reconstruir el árbol de nodos de un material en
    # uso, dentro del mismo tick, puede cerrar Blender al reevaluar la escena.
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if emission_image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = emission_image
        tex.interpolation = "Closest"
        emi = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(tex.outputs["Color"], emi.inputs["Color"])
        nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
    else:
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.8
        if alpha is not None:
            bsdf.inputs["Alpha"].default_value = alpha
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    if alpha is not None:
        for attr, value in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            if hasattr(mat, attr):
                try:
                    setattr(mat, attr, value)
                except Exception:
                    pass
        if hasattr(mat, "use_backface_culling"):
            mat.use_backface_culling = False
    mat.diffuse_color = rgba  # color en modo Solid
    return mat


def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


# ---------------------------------------------------------------------------
# Construcción
# ---------------------------------------------------------------------------


def import_base(sc, win, col):
    vl = sc.view_layers[0]
    vl.active_layer_collection = vl.layer_collection.children[col.name]
    before = set(bpy.data.objects)
    override = {"scene": sc, "view_layer": vl}
    if win is not None:
        override["window"] = win
    with bpy.context.temp_override(**override):
        bpy.ops.import_scene.gltf(filepath=BASE_GLB)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        link(o, col)
    base = meshes[0]
    base.name = "Collider_Marble"
    base.data.materials.clear()
    base.data.materials.append(material("Eternauta_Collider", (0.1, 0.75, 1.0, 1.0), alpha=0.12))
    base.show_wire = True
    base.select_set(False)
    return base


def base_vertices(base):
    m = base.matrix_world
    return [m @ v.co for v in base.data.vertices]


def load_ground_grid():
    """Grilla de suelo estimada del splat (analyze-props): no se contamina con
    los montículos falsos del collider de Marble alrededor de los objetos."""
    path = os.path.join(REF_DIR, "ground.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        return json.load(fh)


def splat_ground(grid, x, z, half_a, half_b, yaw_deg):
    """Mediana del suelo del splat dentro de la huella (coordenadas del juego)."""
    if grid is None:
        return None
    a = grid["area"]
    yaw = math.radians(-yaw_deg)
    ux, uz = math.cos(yaw), math.sin(yaw)
    vals = []
    steps_a = max(1, int(half_a / 0.5))
    steps_b = max(1, int(half_b / 0.5))
    for i in range(-steps_a, steps_a + 1):
        for j in range(-steps_b, steps_b + 1):
            da, db = i * half_a / steps_a, j * half_b / steps_b
            px, pz = x + da * ux - db * uz, z + da * uz + db * ux
            cx = int((px - a["minX"]) / grid["cell"])
            cz = int((pz - a["minZ"]) / grid["cell"])
            if 0 <= cx < grid["width"] and 0 <= cz < grid["height"]:
                v = grid["values"][cz * grid["width"] + cx]
                if v is not None:
                    vals.append(v)
    if not vals:
        return None
    vals.sort()
    return vals[len(vals) // 2]


def fix_ground(f, grid, verts, clear_margin):
    """Suelo de una corrección: explícito en el JSON, si no del splat, si no del collider."""
    if f.get("ground") is not None:
        return f["ground"]
    if f.get("kind") == "cylinder":
        ha = hb = f["radius"]
    else:
        ha, hb = f["length"] / 2, f["width"] / 2
    g = splat_ground(grid, f["x"], f["z"], ha, hb, f.get("yawDeg", 0))
    if g is not None:
        return g
    center = game_to_blender(f["x"], 0, f["z"])
    g = ring_ground(verts, center, math.radians(f.get("yawDeg", 0)), ha, hb, clear_margin, clear_margin + 1.5)
    return g if g is not None else -0.2


def ring_ground(verts, center, yaw, half_a, half_b, inner, outer):
    """Percentil 30 de Z (Blender) de los vértices en el anillo alrededor de una huella."""
    c, s = math.cos(-yaw), math.sin(-yaw)
    zs = []
    for v in verts:
        dx, dy = v.x - center.x, v.y - center.y
        a, b = dx * c - dy * s, dx * s + dy * c
        out_in = abs(a) > half_a + inner or abs(b) > half_b + inner
        in_out = abs(a) <= half_a + outer and abs(b) <= half_b + outer
        if out_in and in_out and v.z < 6:
            zs.append(v.z)
    if not zs:
        return None
    zs.sort()
    return zs[int(len(zs) * 0.3)]


def unit_mesh(kind):
    name = f"Eternauta_unit_{kind}"
    mesh = bpy.data.meshes.get(name)
    if mesh:
        return mesh
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if kind == "cylinder":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=0.5, radius2=0.5, depth=1.0)
    else:
        bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def make_fix(f, verts, grid, col, mat_fix, clear_margin):
    kind = f.get("kind", "box")
    if kind == "cylinder":
        dx = dy = 2 * f["radius"]
    else:
        dx, dy = f["length"], f["width"]
    h = f["height"] if kind != "ground" else 0.05
    center = game_to_blender(f["x"], 0, f["z"])
    yaw = math.radians(f.get("yawDeg", 0))
    ground = fix_ground(f, grid, verts, clear_margin)
    obj = bpy.data.objects.new(f["name"], unit_mesh(kind))
    obj.location = (center.x, center.y, ground + h / 2)
    obj.rotation_euler = (0, 0, yaw)
    obj.scale = (dx, dy, h)
    obj["kind"] = kind
    obj["source"] = f.get("source", "")
    if "clearHeight" in f:
        obj["clearHeight"] = f["clearHeight"]
    # La malla unitaria se comparte entre todas las correcciones del mismo tipo.
    if not obj.data.materials:
        obj.data.materials.append(mat_fix)
    obj.color = (1.0, 0.45, 0.1, 1.0) if kind != "ground" else (0.3, 1.0, 0.4, 1.0)
    obj.show_wire = True
    obj.show_in_front = True
    col.objects.link(obj)
    return obj, ground


def reference_plane(col, name, image_path, area, z):
    img = bpy.data.images.load(image_path, check_existing=True)
    # Ruta relativa al .blend del proyecto (assets-src/colisiones.blend).
    try:
        img.filepath = bpy.path.relpath(image_path, start=os.path.join(ROOT, "assets-src"))
    except ValueError:
        pass
    mesh = bpy.data.meshes.new(name)
    x0, x1, zmin, zmax = area["minX"], area["maxX"], area["minZ"], area["maxZ"]
    # Blender Y = -z del juego; la fila superior de la imagen es z máximo.
    verts = [(x0, -zmax, z), (x1, -zmax, z), (x1, -zmin, z), (x0, -zmin, z)]
    mesh.from_pydata(verts, [], [(0, 3, 2, 1)])
    uv = mesh.uv_layers.new(name="UVMap")
    uvs = {0: (0, 1), 1: (1, 1), 2: (1, 0), 3: (0, 0)}
    for loop in mesh.loops:
        uv.data[loop.index].uv = uvs[loop.vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material(f"Eternauta_{name}", (1, 1, 1, 1), emission_image=img))
    obj.hide_select = True
    col.objects.link(obj)
    return obj


def frame_viewport(win, sc):
    if win is None:
        return
    for area in win.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        space.shading.type = "MATERIAL"
        space.clip_end = 3000
        r3d = space.region_3d
        r3d.view_perspective = "ORTHO"
        r3d.view_rotation = Quaternion((1, 0, 0, 0))  # vista superior
        r3d.view_location = Vector((-2, 2, 0))
        r3d.view_distance = 60


def main():
    with open(FIXES_JSON) as fh:
        doc = json.load(fh)
    with open(os.path.join(REF_DIR, "props.json")) as fh:
        area = json.load(fh)["area"]

    sc = get_scene()
    win = main_window()
    if win is not None:
        win.scene = sc
    clear_scene(sc)
    col_ref = collection(sc, "Referencia")
    col_base = collection(sc, "Collider_Marble")
    col_fix = collection(sc, "Correcciones")
    collection(sc, "Resultado")

    reference_plane(col_ref, "Ref_Cenital", os.path.join(REF_DIR, "topdown.png"), area, -0.95)
    heights = reference_plane(col_ref, "Ref_Alturas", os.path.join(REF_DIR, "heights.png"), area, -0.96)
    heights.hide_viewport = True
    heights.hide_render = True

    base = import_base(sc, win, col_base)
    verts = base_vertices(base)
    mat_fix = material("Eternauta_Correccion", (1.0, 0.45, 0.1, 1.0), alpha=0.75)
    grid = load_ground_grid()
    report = []
    for f in doc["fixes"]:
        obj, ground = make_fix(f, verts, grid, col_fix, mat_fix, doc.get("clearMargin", 1.5))
        report.append(f"{obj.name:<18} suelo {ground:+.2f} m  {tuple(round(v, 2) for v in obj.scale)}")
    frame_viewport(win, sc)
    print(f"Escena '{SCENE}' lista: collider base {len(base.data.polygons)} caras, {len(doc['fixes'])} correcciones")
    print("\n".join(report))


main()

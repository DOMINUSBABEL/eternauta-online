"""
Utilidades de modelado para los props de Plaza de Mayo.

Todo se construye con bmesh (sin operadores de la interfaz) para que funcione
igual en Blender sin interfaz (-b) y desde el addon MCP.

Convenciones de cada asset (espacio local, metros):
  - Z arriba, base apoyada en Z = 0, huella centrada en el origen.
  - El frente del asset mira hacia -Y.
  - En el juego: X = x, Y = -z, Z = y; rotación Z de Blender = yawDeg del juego.
"""

import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.environ.get("ETERNAUTA_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
TEX_DIR = os.path.join(ROOT, "assets-src", "props", "textures")
CUSTOM_TEX_DIR = os.path.join(ROOT, "assets-src", "props", "textures_custom")


# ---------------------------------------------------------------------------
# Texturas procedurales (numpy). Tileables: ruido filtrado por FFT.
# ---------------------------------------------------------------------------

_rng = np.random.default_rng(64)


def fft_noise(size, falloff=2.0, seed=None):
    """Ruido tileable 1/f^falloff normalizado a [0, 1]."""
    rng = np.random.default_rng(seed) if seed is not None else _rng
    white = rng.standard_normal((size, size))
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    r[0, 0] = 1.0
    spec = np.fft.fft2(white) / (r**falloff)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    return n / max(n.max(), 1e-9)


def band_noise(size, lo, hi, seed=None):
    """Ruido tileable de banda limitada (frecuencias lo..hi en ciclos por tile)."""
    rng = np.random.default_rng(seed) if seed is not None else _rng
    white = rng.standard_normal((size, size))
    f = np.fft.fftfreq(size) * size
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx * fx + fy * fy)
    mask = np.exp(-(((r - (lo + hi) / 2) / max(hi - lo, 1)) ** 2) * 2)
    n = np.real(np.fft.ifft2(np.fft.fft2(white) * mask))
    n -= n.min()
    return n / max(n.max(), 1e-9)


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def solid(size, color):
    return np.ones((size, size, 3), dtype=np.float32) * color


def streaks(size, seed, strength=1.0):
    """Chorreaduras verticales de suciedad (fila 0 = arriba en la imagen)."""
    rng = np.random.default_rng(seed)
    cols = band_noise(size, 6, 40, seed)[0]
    v = np.linspace(0, 1, size)[:, None]
    s = (cols[None, :] ** 3) * (0.4 + 0.6 * v)
    s *= 0.6 + 0.4 * fft_noise(size, 1.5, seed + 1)
    return np.clip(s * strength * 1.6, 0, 1)


IMAGES = {}


def save_image(name, arr):
    """Guarda la textura en assets-src/props/textures y la carga en Blender.
    Si existe assets-src/props/textures_custom/<name>.(png|jpg), usa esa."""
    for ext in (".png", ".jpg", ".jpeg"):
        custom = os.path.join(CUSTOM_TEX_DIR, name + ext)
        if os.path.exists(custom):
            img = bpy.data.images.load(custom, check_existing=True)
            img.name = name
            IMAGES[name] = img
            return img
    os.makedirs(TEX_DIR, exist_ok=True)
    h, w = arr.shape[:2]
    chans = arr.shape[2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :chans] = np.clip(arr, 0, 1)
    img = bpy.data.images.get(name)
    if img is None or img.size[0] != w or img.size[1] != h:
        if img is not None:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, w, h, alpha=False)
    # Blender guarda filas de abajo hacia arriba.
    img.pixels.foreach_set(rgba[::-1].ravel())
    path = os.path.join(TEX_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    IMAGES[name] = img
    return img


# ---------------------------------------------------------------------------
# Materiales (Principled BSDF con textura base: lo único que exporta glTF)
# ---------------------------------------------------------------------------

MATS = {}


def material(name, color=(0.8, 0.8, 0.8), image=None, rough=0.85, metal=0.0, emission=None, emission_strength=0.0, alpha=None, double=False):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = IMAGES[image] if isinstance(image, str) else image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if emission is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
    mat.diffuse_color = (*color, 1.0)
    # glTF: doubleSided = not use_backface_culling
    mat.use_backface_culling = not double
    MATS[name] = mat
    return mat


# ---------------------------------------------------------------------------
# Construcción de mallas
# ---------------------------------------------------------------------------


class Builder:
    """Acumula geometría por material en un único bmesh y la vuelca a un objeto."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mat_index = {}
        self.uv_scale = {}

    def mi(self, mat):
        if mat not in self.mat_index:
            self.mat_index[mat] = len(self.mat_index)
        return self.mat_index[mat]

    def _tag(self, faces, mat):
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
        return faces

    def _run(self, mat, fn):
        # Las primitivas de bmesh crean y borran elementos temporales, así que las
        # caras nuevas pueden ocupar huecos del medio: se marcan con una capa entera.
        layer = self.bm.faces.layers.int.get("built") or self.bm.faces.layers.int.new("built")
        fn()
        new = [f for f in self.bm.faces if f[layer] == 0]
        for f in new:
            f[layer] = 1
        return self._tag(new, mat)

    # -- primitivas ------------------------------------------------------
    def box(self, mat, size, center=(0, 0, 0), rot_z=0.0, matrix=None):
        sx, sy, sz = size
        m = Matrix.Translation(center) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((sx, sy, sz, 1))
        if matrix is not None:
            m = matrix @ m
        return self._run(mat, lambda: bmesh.ops.create_cube(self.bm, size=1.0, matrix=m))

    def cyl(self, mat, r1, r2, h, center=(0, 0, 0), segs=12, caps=True, matrix=None, axis="Z"):
        """Cilindro / cono con la base en center.z - h/2 ... center.z + h/2."""
        m = Matrix.Translation(center)
        if axis == "X":
            m = m @ Matrix.Rotation(math.pi / 2, 4, "Y")
        elif axis == "Y":
            m = m @ Matrix.Rotation(math.pi / 2, 4, "X")
        if matrix is not None:
            m = matrix @ m
        return self._run(
            mat,
            lambda: bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h, matrix=m),
        )

    def sphere(self, mat, r, center=(0, 0, 0), subdiv=1, scale=(1, 1, 1), matrix=None):
        m = Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1))
        if matrix is not None:
            m = matrix @ m
        return self._run(mat, lambda: bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=m))

    def uvsphere(self, mat, r, center=(0, 0, 0), segs=12, rings=6, scale=(1, 1, 1), matrix=None):
        m = Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1))
        if matrix is not None:
            m = matrix @ m
        return self._run(mat, lambda: bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r, matrix=m))

    def poly_extrude(self, mat, pts2d, z0, z1, matrix=None):
        """Prisma: polígono (x, y) extruido de z0 a z1."""
        def make():
            vb = [self.bm.verts.new((x, y, z0)) for x, y in pts2d]
            vt = [self.bm.verts.new((x, y, z1)) for x, y in pts2d]
            n = len(pts2d)
            self.bm.faces.new(list(reversed(vb)))
            self.bm.faces.new(vt)
            for i in range(n):
                j = (i + 1) % n
                self.bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
            if matrix is not None:
                bmesh.ops.transform(self.bm, matrix=matrix, verts=vb + vt)
        return self._run(mat, make)

    def profile_extrude(self, mat, pts_yz, x0, x1, matrix=None):
        """Perfil (y, z) extruido a lo largo de X (molduras, barreras jersey)."""
        def make():
            va = [self.bm.verts.new((x0, y, z)) for y, z in pts_yz]
            vb = [self.bm.verts.new((x1, y, z)) for y, z in pts_yz]
            n = len(pts_yz)
            # perfil antihorario visto desde +X: la tapa en x0 mira a -X
            self.bm.faces.new(list(reversed(va)))
            self.bm.faces.new(vb)
            for i in range(n):
                j = (i + 1) % n
                self.bm.faces.new((va[i], va[j], vb[j], vb[i]))
            if matrix is not None:
                bmesh.ops.transform(self.bm, matrix=matrix, verts=va + vb)
        return self._run(mat, make)

    def tube(self, mat, pts, r, segs=6, caps=False):
        """Tubo a lo largo de una polilínea 3D (barandas, ramas, frondas)."""
        def make():
            rings = []
            n = len(pts)
            for i, p in enumerate(pts):
                p = Vector(p)
                d = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
                ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
                u = d.cross(ref).normalized()
                v = d.cross(u).normalized()
                rr = r[i] if isinstance(r, (list, tuple)) else r
                rings.append([self.bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * rr) for a in (2 * math.pi * k / segs for k in range(segs))])
            for a, b in zip(rings, rings[1:]):
                for k in range(segs):
                    k2 = (k + 1) % segs
                    self.bm.faces.new((a[k], a[k2], b[k2], b[k]))
            if caps:
                self.bm.faces.new(list(reversed(rings[0])))
                self.bm.faces.new(rings[-1])
        return self._run(mat, make)

    def arch_window(self, mat_frame, mat_glass, w, h, depth, center, rot_z=0.0, segs=8, frame=0.12):
        """Ventana con arco de medio punto: vidrio hundido + marco. center = base-centro."""
        cx, cy, cz = center
        m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rot_z, 4, "Z")
        r = w / 2
        rect_h = max(h - r, 0.01)
        pts = [(-r, 0), (r, 0), (r, rect_h)]
        for k in range(1, segs):
            a = math.pi * k / segs
            pts.append((r * math.cos(a), rect_h + r * math.sin(a)))
        pts.append((-r, rect_h))
        # vidrio: placa fina hundida
        def glass():
            vf = [self.bm.verts.new(m @ Vector((x, -0.01 + depth, z))) for x, z in pts]
            self.bm.faces.new(list(reversed(vf)))
        self._run(mat_glass, glass)
        # marco: anillo plano en la cara
        outer = []
        rr = r + frame
        outer.append((-rr, 0))
        outer.append((rr, 0))
        outer.append((rr, rect_h))
        for k in range(1, segs):
            a = math.pi * k / segs
            outer.append((rr * math.cos(a), rect_h + rr * math.sin(a)))
        outer.append((-rr, rect_h))

        def ring():
            vo = [self.bm.verts.new(m @ Vector((x, -0.04, z))) for x, z in outer]
            vi = [self.bm.verts.new(m @ Vector((x, -0.04, z))) for x, z in pts]
            vd = [self.bm.verts.new(m @ Vector((x, depth, z))) for x, z in pts]
            n = len(pts)
            for i in range(n - 1):
                self.bm.faces.new((vo[i], vo[i + 1], vi[i + 1], vi[i]))
                self.bm.faces.new((vi[i], vi[i + 1], vd[i + 1], vd[i]))
            # lado vertical izquierdo (cierra el último tramo hasta la base)
            self.bm.faces.new((vo[n - 1], vo[0], vi[0], vi[n - 1]))
            self.bm.faces.new((vi[n - 1], vi[0], vd[0], vd[n - 1]))
        self._run(mat_frame, ring)

    def rect_window(self, mat_frame, mat_glass, w, h, depth, center, rot_z=0.0, frame=0.12, sill=True, pediment=False):
        cx, cy, cz = center
        m = Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rot_z, 4, "Z")
        self.box(mat_glass, (w, 0.02, h), matrix=m @ Matrix.Translation((0, depth, h / 2)))
        # jambas y dintel (marco que sobresale)
        self.box(mat_frame, (frame, depth + 0.06, h), matrix=m @ Matrix.Translation((-w / 2 - frame / 2, depth / 2 - 0.03, h / 2)))
        self.box(mat_frame, (frame, depth + 0.06, h), matrix=m @ Matrix.Translation((w / 2 + frame / 2, depth / 2 - 0.03, h / 2)))
        self.box(mat_frame, (w + 2 * frame, depth + 0.08, frame * 1.2), matrix=m @ Matrix.Translation((0, depth / 2 - 0.04, h + frame * 0.6)))
        if sill:
            self.box(mat_frame, (w + 3 * frame, 0.22, 0.1), matrix=m @ Matrix.Translation((0, -0.08, -0.05)))
        if pediment:
            self.profile_extrude(mat_frame, [(-0.12, 0), (0.05, 0), (0.05, 0.05), (-0.12, 0.05)], -w / 2 - frame * 1.5, w / 2 + frame * 1.5, matrix=m @ Matrix.Translation((0, 0, h + frame * 1.2)))
            self.poly_extrude(mat_frame, [(-w / 2 - frame * 1.5, 0), (w / 2 + frame * 1.5, 0), (0, 0.35)], -0.1, 0.03, matrix=m @ Matrix.Translation((0, 0, h + frame * 1.2 + 0.05)) @ Matrix.Rotation(math.pi / 2, 4, "X"))

    # -- volcado -----------------------------------------------------------
    def finish(self, uv_tile=2.0, uv_tiles=None, smooth=False, smooth_mats=("Corteza", "PalmaTronco", "Follaje", "Fronda", "FrondaSeca", "Arbusto")):
        """Crea el objeto con UV por proyección cúbica a escala real
        (uv_tile metros por repetición de textura; uv_tiles por material)."""
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        built = bm.faces.layers.int.get("built")
        if built is not None:
            bm.faces.layers.int.remove(built)
        bm.normal_update()
        # bm.from_mesh (textos) puede haber traído capas UV: usar una sola.
        for extra in list(bm.loops.layers.uv.values())[1:]:
            bm.loops.layers.uv.remove(extra)
        uv = bm.loops.layers.uv.active or bm.loops.layers.uv.new("UVMap")
        inv_mats = {i: m for m, i in self.mat_index.items()}
        for f in bm.faces:
            mat = inv_mats.get(f.material_index)
            tile = (uv_tiles or {}).get(mat.name if mat else "", uv_tile)
            if isinstance(tile, tuple):
                tu, tv, ou, ov = tile
            else:
                tu, tv, ou, ov = tile, tile, 0.0, 0.0
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for loop in f.loops:
                co = loop.vert.co
                if ax == 2:
                    u, v = co.x, co.y
                elif ax == 0:
                    u, v = (co.y if n.x > 0 else -co.y), co.z
                else:
                    u, v = (-co.x if n.y > 0 else co.x), co.z
                loop[uv].uv = (u / tu + ou, v / tv + ov)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat, i in sorted(self.mat_index.items(), key=lambda kv: kv[1]):
            mesh.materials.append(mat)
        smooth_idx = {i for m, i in self.mat_index.items() if smooth or m.name in smooth_mats}
        for p in mesh.polygons:
            p.use_smooth = p.material_index in smooth_idx
        obj = bpy.data.objects.new(self.name, mesh)
        return obj


def snow_caps(builder, snow_mat, min_nz=0.72, thick=0.05, min_area=0.004, skip=(), paint=()):
    """Agrega una capa de nieve sobre las caras que miran hacia arriba.
    Los materiales en `paint` (matas, follaje) no reciben losa: sus caras
    superiores se pintan de nieve directamente."""
    bm = builder.bm
    bm.normal_update()
    skip_idx = {builder.mat_index[m] for m in skip if m in builder.mat_index}
    snow_idx = builder.mi(snow_mat)
    paint_idx = {builder.mat_index[m] for m in paint if m in builder.mat_index}
    for f in bm.faces:
        if f.material_index in paint_idx and f.normal.z > min_nz:
            f.material_index = snow_idx
    skip_idx |= paint_idx
    tops = [f for f in bm.faces if f.normal.z > min_nz and f.calc_area() > min_area and f.material_index not in skip_idx and f.material_index != snow_idx]
    for f in tops:
        c = f.calc_center_median()
        inset = 0.97
        vs = [bm.verts.new(c + (v.co - c) * inset + Vector((0, 0, 0.004))) for v in f.verts]
        vt = [bm.verts.new(v.co + Vector((0, 0, thick))) for v in vs]
        n = len(vs)
        faces = [bm.faces.new(vt)]
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((vs[i], vs[j], vt[j], vt[i])))
        layer = bm.faces.layers.int.get("built")
        for nf in faces:
            nf.material_index = snow_idx
            if layer is not None:
                nf[layer] = 1


def link_to(obj, collection):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def ensure_collection(scene, name, parent=None):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    parent_col = parent or scene.collection
    if col.name not in parent_col.children:
        parent_col.children.link(col)
    return col

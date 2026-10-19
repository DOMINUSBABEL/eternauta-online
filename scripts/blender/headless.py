"""
Corre los scripts del collider con Blender sin interfaz.

  blender -b assets-src/colisiones.blend --python scripts/blender/headless.py -- export
  blender -b --factory-startup --python scripts/blender/headless.py -- setup

`export` genera assets-src/collider_refined.glb desde la escena guardada y
vuelve a guardar el .blend; `setup` reconstruye la escena desde el JSON y la
guarda en assets-src/colisiones.blend.
"""

import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mode = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "export"


def run(name):
    path = os.path.join(ROOT, "scripts", "blender", name)
    exec(compile(open(path).read(), path, "exec"), {"ROOT": ROOT, "__name__": "__main__"})


if mode == "setup":
    run("collider_setup.py")
    for sc in list(bpy.data.scenes):
        if sc.name != "Eternauta_Colisiones":
            bpy.data.scenes.remove(sc)
    bpy.context.view_layer.update()
    run("collider_export.py")
elif mode == "export":
    run("collider_export.py")
else:
    raise SystemExit(f"modo desconocido: {mode}")

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "assets-src", "colisiones.blend"), compress=True)

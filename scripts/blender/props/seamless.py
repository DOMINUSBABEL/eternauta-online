"""
Hace repetibles las texturas generadas y las deja listas para el build.

  assets-src/props/textures_raw/<nombre>.png  →  assets-src/props/textures_custom/<nombre>.jpg

1. Ecualiza la iluminación: divide por un desenfoque grande de la luminancia
   (saca viñeteo y degradés de luz que delatan la repetición).
2. Bordes repetibles: mezcla una franja de cada borde con la imagen corrida
   medio tile (que es continua en el borde). Sólo la franja: el centro queda
   intacto y no hay "fantasmas" en patrones como tejas o tablas.
3. Redimensiona al tamaño que usa el juego.

Corre en Blender sin interfaz (trae numpy):
  blender -b --factory-startup --python scripts/blender/props/seamless.py [-- nombre ...]
"""

import os
import sys

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RAW = os.environ.get("SEAMLESS_RAW") or os.path.join(ROOT, "assets-src", "props", "textures_raw")
OUT = os.environ.get("SEAMLESS_OUT") or os.path.join(ROOT, "assets-src", "props", "textures_custom")

# Tamaño final (ancho, alto) y modo de borde: "xy" repetible, "x" sólo horizontal, None no repetible.
SPECS = {
    "rosada_estuco": ((1024, 1024), "xy"),
    "cabildo_estuco": ((1024, 1024), "xy"),
    "bus_pintura": ((1024, 1024), "x"),
    "revistas": ((512, 512), None),
    "bandera": ((512, 320), None),
    "reloj": ((256, 256), None),
}
DEFAULT = ((512, 512), "xy")
# Generadas que no sirven como material (se usa la procedural): FLUX dibujó ladrillitos para el obelisco.
SKIP = {"piedra_blanca"}
# Color medio igualado al de la procedural (calibrada contra el splat): las de FLUX
# salen más claras y saturadas que la plaza nevada.
# Todas menos las que son imagen (bandera, reloj, revistas) o se componen aparte (colectivo).
NO_MATCH = {"bandera", "reloj", "revistas", "bus_pintura"}
PROC = os.path.join(ROOT, "assets-src", "props", "textures")
BAND = 0.16  # fracción del tile que se mezcla en cada borde


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, :3].copy()  # fila 0 = arriba


def blur_wrap(a, sigma):
    """Desenfoque gaussiano periódico (FFT)."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx**2 + fy**2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def equalize(c, mode):
    lum = c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    h, w = lum.shape
    sigma = max(h, w) / 6
    if mode == "x":
        # sólo degradés horizontales: el bus tiene franjas de color por altura
        low = np.repeat(blur_wrap(np.repeat(lum.mean(axis=0, keepdims=True), 8, axis=0), sigma)[:1], h, axis=0)
    else:
        low = blur_wrap(lum, sigma)
    gain = np.clip(lum.mean() / np.maximum(low, 1e-3), 0.6, 1.6)
    return np.clip(c * gain[..., None], 0, 1)


def ramp(n, band):
    """1 en el centro, 0 en los bordes, rampa suave de ancho band·n."""
    x = np.arange(n) + 0.5
    d = np.minimum(x, n - x) / (band * n)
    t = np.clip(d, 0, 1)
    return t * t * (3 - 2 * t)


def make_seamless(c, mode):
    h, w = c.shape[:2]
    if mode == "xy":
        rolled = np.roll(np.roll(c, h // 2, axis=0), w // 2, axis=1)
        m = np.minimum(ramp(h, BAND)[:, None], ramp(w, BAND)[None, :])
    else:
        rolled = np.roll(c, w // 2, axis=1)
        m = np.repeat(ramp(w, BAND)[None, :], h, axis=0)
    return c * m[..., None] + rolled * (1 - m[..., None])


def save(c, size, path):
    h, w = c.shape[:2]
    img = bpy.data.images.new("tmp", w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = c
    img.pixels.foreach_set(rgba[::-1].ravel())
    if (w, h) != size:
        img.scale(*size)
    img.filepath_raw = path
    img.file_format = "JPEG"
    sc = bpy.context.scene
    sc.render.image_settings.quality = 90
    img.save(filepath=path, quality=90)
    bpy.data.images.remove(img)


def match_mean(c, name):
    path = os.path.join(PROC, name + ".png")
    if not os.path.exists(path):
        return c
    ref = load(path).reshape(-1, 3).mean(axis=0)
    gain = np.clip(ref / np.maximum(c.reshape(-1, 3).mean(axis=0), 1e-3), 0.4, 2.5)
    return np.clip(c * gain, 0, 1)


def compose_bus():
    """Chapa del colectivo a partir de la chapa blanca oxidada generada: arriba
    blanca, franja azul marino y abajo azul, conservando el óxido (la UV del
    colectivo mapea el alto de 3,2 m a la imagen)."""
    src = os.path.join(RAW, "auto_blanco.png")
    c = equalize(load(src), "xy")
    c = make_seamless(c, "xy")
    h = c.shape[0]
    y = (np.arange(h) / h)[:, None]
    white = np.clip((c.min(axis=2) - 0.42) * 4, 0, 1)  # 1 = pintura, 0 = óxido
    lum = c.mean(axis=2, keepdims=True)
    blue = np.array([0.25, 0.42, 0.66], dtype=np.float32) * (lum / max(lum.mean(), 1e-3))
    navy = np.array([0.12, 0.18, 0.31], dtype=np.float32) * (lum / max(lum.mean(), 1e-3))
    paint = np.where((y < 0.42)[..., None], c * np.array([0.88, 0.9, 0.92], dtype=np.float32), np.where((y < 0.46)[..., None], navy, blue))
    return np.clip(c * (1 - white[..., None]) + paint * white[..., None], 0, 1)


def main(names):
    os.makedirs(OUT, exist_ok=True)
    files = sorted(f[:-4] for f in os.listdir(RAW) if f.endswith(".png"))
    if names:
        files = [f for f in files if f in names]
    for name in files:
        size, mode = SPECS.get(name, DEFAULT)
        if name in SKIP:
            for ext in (".png", ".jpg", ".jpeg"):
                stale = os.path.join(OUT, name + ext)
                if os.path.exists(stale):
                    os.remove(stale)
            print(f"- {name}: se usa la procedural")
            continue
        if name == "bus_pintura" and os.path.exists(os.path.join(RAW, "auto_blanco.png")):
            c = compose_bus()
        else:
            c = load(os.path.join(RAW, name + ".png"))
            if mode:
                c = equalize(c, mode)
                c = make_seamless(c, mode)
        if name not in NO_MATCH:
            c = match_mean(c, name)
        for ext in (".png", ".jpeg"):
            stale = os.path.join(OUT, name + ext)
            if os.path.exists(stale):
                os.remove(stale)
        save(c, size, os.path.join(OUT, name + ".jpg"))
        print(f"✓ {name} {size[0]}×{size[1]} ({mode or 'no repetible'})")


names = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
main(set(names))

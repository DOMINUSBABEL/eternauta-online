"""
Texturas procedurales y materiales de los props.

Cada textura se guarda en assets-src/props/textures/<nombre>.png. Para
reemplazarla por una hecha a mano (o generada con IA), poné un archivo con el
mismo nombre en assets-src/props/textures_custom/ y volvé a correr el build.
"""

import math

import numpy as np

from lib import band_noise, fft_noise, material, mix, rgb, save_image, solid, streaks


def _grime(base, size, seed, amount=0.35, streak=0.5, dark=(0.18, 0.16, 0.15)):
    # suciedad de frecuencia media (sin manchones gigantes) + chorreaduras
    n = band_noise(size, 3, 18, seed) * 0.6 + band_noise(size, 18, 70, seed + 3) * 0.4
    s = streaks(size, seed + 7, streak)
    c = mix(base, np.array(dark, dtype=np.float32), np.clip((n - 0.5) * amount * 1.3 + s * 0.35, 0, 0.6))
    return c


def _snow_dust(c, size, seed, amount=0.4):
    n = band_noise(size, 10, 80, seed)
    m = np.clip((n - (1 - amount)) * 4, 0, 1)
    return mix(c, np.array((0.92, 0.94, 0.97), dtype=np.float32), m * 0.8)


def stucco(size, color, seed, rough=0.08):
    base = solid(size, rgb(color))
    fine = band_noise(size, 60, 200, seed)
    base = base * (1 - rough + rough * 2 * fine[..., None])
    return _grime(base, size, seed, 0.4, 0.7)


def ashlar(size, color, seed, rows=8, cols=4, joint=0.012):
    """Sillería / buñas: bloques horizontales con juntas oscuras."""
    c = stucco(size, color, seed, 0.06)
    y = np.arange(size)[:, None] / size
    x = np.arange(size)[None, :] / size
    rowf = (y * rows) % 1
    row = np.floor(y * rows)
    xf = (x * cols + 0.5 * (row % 2)) % 1
    jm = (rowf < joint * rows) | (xf < joint * cols)
    c[jm] *= 0.62
    return c


def planks(size, color, seed, n=6, vertical=False, gap=0.02):
    rng = np.random.default_rng(seed)
    y = np.arange(size)[:, None] / size * np.ones((1, size))
    if vertical:
        y = y.T
    idx = np.floor(y * n).astype(int)
    tint = rng.uniform(0.75, 1.15, n)[idx]
    grain = band_noise(size, 2, 30, seed)
    if not vertical:
        grain = np.repeat(grain.mean(axis=0, keepdims=True), size, axis=0) * 0.5 + band_noise(size, 20, 120, seed + 1) * 0.5
    c = solid(size, rgb(color)) * (tint * (0.8 + 0.4 * grain))[..., None]
    gm = (y * n) % 1 < gap * n
    c[gm] *= 0.35
    return _grime(c, size, seed, 0.3, 0.2)


def rust(base, size, seed, amount=0.5):
    n = fft_noise(size, 1.3, seed)
    spots = np.clip((n - (1 - amount * 0.6)) * 5, 0, 1)
    rc = mix(np.array((0.36, 0.17, 0.08), dtype=np.float32) * np.ones((size, size, 3), dtype=np.float32), np.array((0.55, 0.3, 0.12), dtype=np.float32), band_noise(size, 30, 120, seed + 3))
    return mix(base, rc, spots)


def flag(w=512, h=320):
    c = np.ones((h, w, 3), dtype=np.float32)
    celeste = rgb("#74acdf")
    c[: h // 3] = celeste
    c[2 * h // 3 :] = celeste
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    r = np.hypot(xx - cx, yy - cy)
    ang = np.arctan2(yy - cy, xx - cx)
    sol = rgb("#f6b40e")
    rays = (np.cos(ang * 16) > 0.2) & (r < h * 0.14) & (r > h * 0.07)
    disc = r < h * 0.075
    c[rays | disc] = sol
    c[(r > h * 0.068) & (r < h * 0.078)] = rgb("#85340a")
    grime = fft_noise(max(w, h), 1.5, 9)[:h, :w]
    return c * (0.82 + 0.18 * grime[..., None])


def magazines(size, seed):
    rng = np.random.default_rng(seed)
    c = np.zeros((size, size, 3), dtype=np.float32)
    cols, rows = 8, 6
    pal = [rgb(h) for h in ("#c0392b", "#f1c40f", "#2980b9", "#ecf0f1", "#16a085", "#8e44ad", "#d35400", "#2c3e50")]
    cw, rh = size // cols, size // rows
    for i in range(cols):
        for j in range(rows):
            base = pal[rng.integers(len(pal))]
            blk = np.ones((rh - 6, cw - 6, 3), dtype=np.float32) * base
            blk[: (rh - 6) // 4] = pal[rng.integers(len(pal))]
            c[j * rh + 3 : (j + 1) * rh - 3, i * cw + 3 : (i + 1) * cw - 3] = blk
    return c * (0.75 + 0.25 * fft_noise(size, 1.5, seed)[..., None])


def clock_face(size=256):
    yy, xx = np.mgrid[0:size, 0:size]
    cx = cy = size / 2
    r = np.hypot(xx - cx, yy - cy) / (size / 2)
    a = np.arctan2(yy - cy, xx - cx)
    c = np.ones((size, size, 3), dtype=np.float32) * rgb("#e9e4d6")
    ticks = (r > 0.78) & (r < 0.9) & (np.abs(((a / (2 * math.pi) * 12) % 1) - 0.5) > 0.47)
    c[ticks] = 0.08
    c[r > 0.93] = 0.12
    # agujas: 10:10
    for ang, ln, wd in ((-math.pi / 2 - math.pi / 3, 0.5, 0.035), (-math.pi / 2 + math.pi / 3, 0.72, 0.025)):
        d = xx * 0 + 0
        px, py = (xx - cx) / (size / 2), (yy - cy) / (size / 2)
        ux, uy = math.cos(ang), math.sin(ang)
        t = px * ux + py * uy
        perp = np.abs(-px * uy + py * ux)
        c[(t > 0) & (t < ln) & (perp < wd)] = 0.05
    return c


def palm_trunk(size, seed):
    y = np.arange(size)[:, None] / size * np.ones((1, size))
    rings = (np.sin(y * math.pi * 2 * 10) * 0.5 + 0.5) ** 3
    c = solid(size, rgb("#5a4c3c")) * (0.8 + 0.25 * rings[..., None])
    c = c * (0.8 + 0.3 * band_noise(size, 10, 60, seed)[..., None])
    return _grime(c, size, seed, 0.25, 0.1)


def bark(size, seed):
    n = band_noise(size, 4, 20, seed)
    stretched = np.repeat(n[:, :: 1].mean(axis=0, keepdims=True), size, axis=0) * 0.6 + band_noise(size, 30, 90, seed + 2) * 0.4
    c = mix(rgb("#2b241e") * np.ones((size, size, 3), dtype=np.float32), rgb("#5a4d40"), stretched)
    return c


def bus_paint(size, seed):
    h = size
    c = np.ones((h, size, 3), dtype=np.float32)
    y = np.arange(h)[:, None] / h
    # V = Z/altura: arriba blanco-gris, franja azul abajo (la imagen se mapea por altura)
    c[:] = rgb("#3f6aa8")
    c[(y < 0.42)[:, 0]] = rgb("#c9cdd2")
    c[((y > 0.40) & (y < 0.46))[:, 0]] = rgb("#1f2f4f")
    c = rust(c, size, seed, 0.55)
    return _snow_dust(_grime(c, size, seed + 1, 0.35, 0.6), size, seed + 2, 0.25)


def build_materials():
    """Crea todas las texturas y materiales. Devuelve un dict nombre → material."""
    S = 512
    tex = {
        "rosada_estuco": stucco(1024, "#c4816f", 11, rough=0.05),
        "rosada_buna": ashlar(512, "#b9776a", 13, rows=6, cols=2, joint=0.01),
        "rosada_liso": stucco(512, "#ddc9b4", 12, rough=0.04),
        "cabildo_estuco": stucco(1024, "#d6d1c5", 21, rough=0.04),
        "cabildo_buna": ashlar(512, "#d2ccbf", 22, rows=6, cols=2),
        "piedra_blanca": ashlar(512, "#b9b5ac", 31, rows=4, cols=1, joint=0.004),
        "pizarra": _snow_dust(_grime(solid(512, rgb("#3b4148")) * (0.8 + 0.4 * band_noise(512, 20, 60, 41)[..., None]), 512, 41, 0.3, 0.2), 512, 42, 0.45),
        "cobre_verde": _grime(solid(256, rgb("#5f8f86")) * (0.8 + 0.3 * fft_noise(256, 1.4, 43)[..., None]), 256, 43, 0.4, 0.5),
        "nieve": solid(256, rgb("#d5dbe2")) * (0.88 + 0.12 * band_noise(256, 8, 60, 51)[..., None]),
        "hierro": rust(_grime(solid(256, rgb("#1f2621")), 256, 61, 0.2, 0.2), 256, 62, 0.25),
        "madera_banco": planks(S, "#7a5434", 71, n=4),
        "madera_caja": planks(S, "#9c7a52", 72, n=5),
        "verde_militar": rust(_grime(solid(S, rgb("#4b5232")), S, 81, 0.3, 0.3), S, 82, 0.3),
        "hormigon": _grime(solid(S, rgb("#a9a7a0")) * (0.85 + 0.3 * band_noise(S, 30, 150, 91)[..., None]), S, 92, 0.4, 0.4),
        "granito": _grime(solid(S, rgb("#8c8a86")) * (0.75 + 0.5 * band_noise(S, 80, 250, 93)[..., None]), S, 94, 0.25, 0.1),
        "bus_pintura": bus_paint(1024, 101),
        "auto_blanco": _snow_dust(rust(_grime(solid(S, rgb("#cfd0cc")), S, 111, 0.3, 0.5), S, 112, 0.6), S, 113, 0.3),
        "auto_gris": _snow_dust(rust(_grime(solid(S, rgb("#3a3d40")), S, 114, 0.25, 0.3), S, 115, 0.45), S, 116, 0.3),
        "corteza": bark(S, 121),
        "palma_tronco": palm_trunk(S, 131),
        "fronda": solid(128, rgb("#223a1e")) * (0.8 + 0.3 * fft_noise(128, 1.2, 141)[..., None]),
        "tejas": None,
        "arbusto": _snow_dust(mix(solid(256, rgb("#1b2718")), rgb("#34402a"), band_noise(256, 8, 40, 191)), 256, 192, 0.42),
        "fronda_seca": solid(128, rgb("#6e5a3a")) * (0.8 + 0.3 * fft_noise(128, 1.2, 142)[..., None]),
        "follaje": mix(solid(256, rgb("#2e2c20")), rgb("#54402a"), band_noise(256, 6, 30, 151)),
        "bandera": flag(),
        "revistas": magazines(S, 161),
        "reloj": clock_face(),
        "kiosco_verde": rust(_grime(solid(S, rgb("#2e4b3a")), S, 171, 0.3, 0.4), S, 172, 0.2),
        "franjas": None,  # se arma abajo
    }
    # tejas coloniales: hileras con sombra en la junta
    ty_, tx_ = np.mgrid[0:S, 0:S]
    rowf = (ty_ / S * 8) % 1
    colf = (tx_ / S * 10 + 0.5 * np.floor(ty_ / S * 8)) % 1
    shade = 0.65 + 0.35 * np.sin(colf * math.pi) * (0.6 + 0.4 * rowf)
    tej = solid(S, rgb("#8a4a32")) * shade[..., None]
    tex["tejas"] = _snow_dust(_grime(tej, S, 195, 0.3, 0.2), S, 196, 0.55)
    yy, xx = np.mgrid[0:S, 0:S]
    stripes = (((xx + yy) / S * 4) % 1) < 0.5
    fr = np.where(stripes[..., None], rgb("#b3302a"), rgb("#e6e2da")).astype(np.float32)
    tex["franjas"] = _snow_dust(_grime(fr, S, 181, 0.35, 0.3), S, 182, 0.3)

    for name, arr in tex.items():
        save_image(name, arr)

    M = {}
    M["rosada"] = material("Rosada", image="rosada_estuco", rough=0.9)
    M["rosada_liso"] = material("RosadaLiso", image="rosada_liso", rough=0.9)
    M["rosada_buna"] = material("RosadaBuna", image="rosada_buna", rough=0.9)
    M["blanco"] = material("Cabildo", image="cabildo_estuco", rough=0.92)
    M["blanco_buna"] = material("CabildoBuna", image="cabildo_buna", rough=0.92)
    M["piedra"] = material("PiedraBlanca", image="piedra_blanca", rough=0.8)
    M["pizarra"] = material("Pizarra", image="pizarra", rough=0.7, metal=0.1)
    M["cobre"] = material("CobreVerde", image="cobre_verde", rough=0.6, metal=0.3)
    M["nieve"] = material("Nieve", image="nieve", rough=0.75)
    M["vidrio"] = material("Vidrio", color=(0.035, 0.045, 0.055), rough=0.25, metal=0.2)
    M["vidrio_bus"] = material("VidrioBus", color=(0.06, 0.08, 0.1), rough=0.2, metal=0.3)
    M["hierro"] = material("Hierro", image="hierro", rough=0.6, metal=0.55)
    M["madera_banco"] = material("MaderaBanco", image="madera_banco", rough=0.85)
    M["madera_caja"] = material("MaderaCaja", image="madera_caja", rough=0.9)
    M["militar"] = material("VerdeMilitar", image="verde_militar", rough=0.75, metal=0.2)
    M["hormigon"] = material("Hormigon", image="hormigon", rough=0.95)
    M["granito"] = material("Granito", image="granito", rough=0.8)
    M["franjas"] = material("FranjasRojas", image="franjas", rough=0.9)
    M["bus"] = material("ColectivoPintura", image="bus_pintura", rough=0.55, metal=0.25)
    M["auto_blanco"] = material("AutoBlanco", image="auto_blanco", rough=0.5, metal=0.3)
    M["auto_gris"] = material("AutoGris", image="auto_gris", rough=0.5, metal=0.35)
    M["goma"] = material("Goma", color=(0.03, 0.03, 0.03), rough=0.9)
    M["cromo"] = material("Cromo", color=(0.5, 0.5, 0.5), rough=0.35, metal=0.9)
    M["corteza"] = material("Corteza", image="corteza", rough=0.95)
    M["palma_tronco"] = material("PalmaTronco", image="palma_tronco", rough=0.95)
    M["fronda"] = material("Fronda", image="fronda", rough=0.8, double=True)
    M["tejas"] = material("Tejas", image="tejas", rough=0.85)
    M["arbusto"] = material("Arbusto", image="arbusto", rough=0.95)
    M["fronda_seca"] = material("FrondaSeca", image="fronda_seca", rough=0.9, double=True)
    M["follaje"] = material("Follaje", image="follaje", rough=0.9)
    M["bandera"] = material("Bandera", image="bandera", rough=0.85, double=True)
    M["revistas"] = material("Revistas", image="revistas", rough=0.8)
    M["reloj"] = material("RelojEsfera", image="reloj", rough=0.6)
    M["kiosco"] = material("KioscoVerde", image="kiosco_verde", rough=0.6, metal=0.4)
    M["luz"] = material("LuzFarol", color=(1.0, 0.78, 0.45), rough=0.3, emission=(1.0, 0.72, 0.38), emission_strength=6.0)
    M["luz_bus"] = material("LuzBus", color=(1.0, 0.95, 0.8), rough=0.3, emission=(1.0, 0.92, 0.75), emission_strength=4.0)
    M["cartel"] = material("CartelAmarillo", color=(0.85, 0.65, 0.12), rough=0.6, emission=(0.9, 0.7, 0.2), emission_strength=0.6)
    M["texto_negro"] = material("TextoNegro", color=(0.03, 0.03, 0.03), rough=0.6)
    M["texto_led"] = material("TextoLed", color=(1.0, 0.6, 0.1), rough=0.5, emission=(1.0, 0.55, 0.1), emission_strength=3.0)
    M["oro"] = material("Bronce", color=(0.55, 0.42, 0.2), rough=0.45, metal=0.85)
    M["tierra"] = material("Tierra", color=(0.16, 0.13, 0.1), rough=1.0)
    return M

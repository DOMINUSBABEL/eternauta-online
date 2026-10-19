#!/usr/bin/env node
// Detecta obstáculos (canteros, colectivo, cajones…) en el splat para modelar
// colliders precisos en Blender. Es una herramienta de AUTORÍA offline: el
// juego nunca colisiona contra el splat.
//
// Salidas (assets-src/reference/):
//   topdown.png   vista cenital ortográfica en color (10 cm/px)
//   heights.png   altura sobre el suelo (negro = suelo, blanco = 3 m o más)
//   props.json    obstáculos como cajas orientadas + parámetros del raster
//   ground.json   grilla de altura del suelo (0,5 m) para apoyar correcciones
//
// Uso: npm run analyze:props [-- scene.spz]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync, crc32, gunzipSync } from "node:zlib";

const SPZ = process.argv[2] ?? "public/assets/scene.spz";
const OUT = "assets-src/reference";
// Zona jugable (config.world.bounds) + 2 m.
const AREA = { minX: -50, maxX: 61, minZ: -82, maxZ: 44 };
const PX = 0.1; // resolución de las imágenes (m/px)
const OCC = 0.25; // resolución del mapa de ocupación (m)
const BAND = [0.3, 1.8]; // franja "a la altura del cuerpo" sobre el suelo (m)

// --- Lectura del SPZ (v2/v3) -------------------------------------------------
const raw = gunzipSync(readFileSync(SPZ));
const n = raw.readUInt32LE(8);
const frac = raw[13];
const scale = 1 / (1 << frac);
const posOff = 16;
const alphaOff = posOff + n * 9;
const colorOff = alphaOff + n;
const pos = (i, a) => {
  const o = posOff + i * 9 + a * 3;
  let v = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16);
  if (v & 0x800000) v |= 0xff000000;
  return v * scale;
};
// Color SPZ: byte = dc·(0.15·255) + 127.5 ; rgb = 0.5 + 0.2821·dc
const color = (b) => Math.max(0, Math.min(255, Math.round((0.5 + 0.28209479 * ((b / 255 - 0.5) / 0.15)) * 255)));

const pts = [];
for (let i = 0; i < n; i++) {
  if (raw[alphaOff + i] < 128) continue; // sólo splats opacos
  const x = pos(i, 0);
  const z = pos(i, 2);
  if (x < AREA.minX || x >= AREA.maxX || z < AREA.minZ || z >= AREA.maxZ) continue;
  const y = pos(i, 1);
  if (y < -4 || y > 12) continue;
  pts.push({ x, y, z, i });
}
console.log(`splats opacos en la zona: ${pts.length}`);

// --- Suelo: envolvente inferior suavizada ------------------------------------
// p10 de altura por celda de 0,5 m y luego el p20 en un radio de 3,5 m: dentro
// de un cantero no hay splats de suelo visibles, así que se toma el de alrededor.
const G = 0.5;
const GW = Math.ceil((AREA.maxX - AREA.minX) / G);
const GH = Math.ceil((AREA.maxZ - AREA.minZ) / G);
const cellYs = Array.from({ length: GW * GH }, () => []);
for (const p of pts) {
  if (p.y > 3) continue;
  cellYs[Math.floor((p.z - AREA.minZ) / G) * GW + Math.floor((p.x - AREA.minX) / G)].push(p.y);
}
const p10 = new Float32Array(GW * GH).fill(NaN);
cellYs.forEach((ys, k) => {
  if (ys.length < 8) return;
  ys.sort((a, b) => a - b);
  p10[k] = ys[Math.floor(ys.length * 0.1)];
});
const ground = new Float32Array(GW * GH).fill(NaN);
const R = Math.round(3.5 / G);
for (let cz = 0; cz < GH; cz++) {
  for (let cx = 0; cx < GW; cx++) {
    const vals = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const v = p10[(cz + dz) * GW + (cx + dx)];
        if (cz + dz >= 0 && cz + dz < GH && cx + dx >= 0 && cx + dx < GW && !Number.isNaN(v)) vals.push(v);
      }
    }
    if (vals.length < 6) continue;
    vals.sort((a, b) => a - b);
    ground[cz * GW + cx] = vals[Math.floor(vals.length * 0.2)];
  }
}
const groundAt = (x, z) => ground[Math.floor((z - AREA.minZ) / G) * GW + Math.floor((x - AREA.minX) / G)];
mkdirSync(OUT, { recursive: true });
// Grilla de suelo para las herramientas de Blender (null = sin datos).
writeFileSync(
  `${OUT}/ground.json`,
  JSON.stringify({ area: AREA, cell: G, width: GW, height: GH, values: Array.from(ground, (v) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100)) }),
);

// --- Rasters: vista cenital, alturas y ocupación ------------------------------
const W = Math.round((AREA.maxX - AREA.minX) / PX);
const H = Math.round((AREA.maxZ - AREA.minZ) / PX);
const topY = new Float32Array(W * H).fill(-Infinity);
const rgb = new Uint8Array(W * H * 3);
const hAbove = new Float32Array(W * H).fill(0);
const OW = Math.round((AREA.maxX - AREA.minX) / OCC);
const OH = Math.round((AREA.maxZ - AREA.minZ) / OCC);
const occCount = new Uint16Array(OW * OH);
const occHeights = Array.from({ length: OW * OH }, () => null);
for (const p of pts) {
  const g = groundAt(p.x, p.z);
  if (Number.isNaN(g)) continue;
  const h = p.y - g;
  // Imagen cenital: el splat más alto hasta 6 m (sin copas de árboles altas).
  if (h < 6) {
    const k = Math.floor((p.z - AREA.minZ) / PX) * W + Math.floor((p.x - AREA.minX) / PX);
    if (p.y > topY[k]) {
      topY[k] = p.y;
      const c = colorOff + p.i * 3;
      rgb[k * 3] = color(raw[c]);
      rgb[k * 3 + 1] = color(raw[c + 1]);
      rgb[k * 3 + 2] = color(raw[c + 2]);
      hAbove[k] = Math.max(0, h);
    }
  }
  if (h >= BAND[0] && h <= BAND[1]) {
    const k = Math.floor((p.z - AREA.minZ) / OCC) * OW + Math.floor((p.x - AREA.minX) / OCC);
    occCount[k]++;
  }
  if (h >= 0.1 && h <= 4.5) {
    const k = Math.floor((p.z - AREA.minZ) / OCC) * OW + Math.floor((p.x - AREA.minX) / OCC);
    (occHeights[k] ??= []).push(h);
  }
}

// --- Componentes de ocupación → cajas orientadas -------------------------------
const MIN_COUNT = 6; // splats por celda de 25 cm para considerarla sólida
let mask = Uint8Array.from(occCount, (c) => (c >= MIN_COUNT ? 1 : 0));
// Cierre morfológico (dilatar + erosionar) para unir huecos chicos.
const morph = (src, dilate) => {
  const dst = new Uint8Array(src.length);
  for (let z = 0; z < OH; z++) {
    for (let x = 0; x < OW; x++) {
      let v = dilate ? 0 : 1;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          const s = xx >= 0 && zz >= 0 && xx < OW && zz < OH ? src[zz * OW + xx] : 0;
          v = dilate ? Math.max(v, s) : Math.min(v, s);
        }
      }
      dst[z * OW + x] = v;
    }
  }
  return dst;
};
mask = morph(morph(mask, true), false);

const label = new Int32Array(OW * OH).fill(-1);
const props = [];
for (let start = 0; start < mask.length; start++) {
  if (!mask[start] || label[start] >= 0) continue;
  const cells = [];
  const stack = [start];
  label[start] = props.length;
  while (stack.length) {
    const k = stack.pop();
    cells.push(k);
    const x = k % OW;
    const z = Math.floor(k / OW);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= OW || zz >= OH) continue;
        const kk = zz * OW + xx;
        if (mask[kk] && label[kk] < 0) {
          label[kk] = props.length;
          stack.push(kk);
        }
      }
    }
  }
  const area = cells.length * OCC * OCC;
  if (area < 0.3) {
    props.push(null);
    continue;
  }
  // Orientación por PCA de los centros de celda; extensión en esos ejes.
  const cx = cells.map((k) => AREA.minX + ((k % OW) + 0.5) * OCC);
  const cz = cells.map((k) => AREA.minZ + (Math.floor(k / OW) + 0.5) * OCC);
  const mx = cx.reduce((a, b) => a + b) / cells.length;
  const mz = cz.reduce((a, b) => a + b) / cells.length;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  cells.forEach((_, i) => {
    sxx += (cx[i] - mx) ** 2;
    szz += (cz[i] - mz) ** 2;
    sxz += (cx[i] - mx) * (cz[i] - mz);
  });
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz); // eje mayor respecto de +X
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  cells.forEach((_, i) => {
    const a = (cx[i] - mx) * ux + (cz[i] - mz) * uz;
    const b = -(cx[i] - mx) * uz + (cz[i] - mz) * ux;
    a0 = Math.min(a0, a - OCC / 2);
    a1 = Math.max(a1, a + OCC / 2);
    b0 = Math.min(b0, b - OCC / 2);
    b1 = Math.max(b1, b + OCC / 2);
  });
  const length = a1 - a0;
  const width = b1 - b0;
  const centerA = (a0 + a1) / 2;
  const centerB = (b0 + b1) / 2;
  const center = { x: mx + centerA * ux - centerB * uz, z: mz + centerA * uz + centerB * ux };
  const hs = cells.flatMap((k) => occHeights[k] ?? []).sort((a, b) => a - b);
  const height = hs.length ? hs[Math.floor(hs.length * 0.9)] : BAND[1];
  const fill = area / (length * width);
  const g = groundAt(center.x, center.z);
  // Clasificación aproximada por tamaño (se revisa a ojo en Blender).
  let kind = "otro";
  if (length >= 8 && length <= 14 && width >= 1.8 && width <= 3.6 && height >= 2.2) kind = "colectivo";
  else if (area >= 2 && height <= 1.6 && fill >= 0.45) kind = "cantero";
  else if (Math.max(length, width) <= 0.8) kind = "poste/tronco";
  props.push({
    id: props.length,
    kind,
    center: { x: +center.x.toFixed(2), y: +g.toFixed(2), z: +center.z.toFixed(2) },
    length: +length.toFixed(2),
    width: +width.toFixed(2),
    height: +height.toFixed(2),
    // Rotación alrededor de Y (Three.js, grados) que lleva +X al eje mayor.
    yawDeg: +((-angle * 180) / Math.PI).toFixed(1),
    area: +area.toFixed(2),
    fill: +fill.toFixed(2),
  });
}

const found = props.filter(Boolean).sort((a, b) => b.area - a.area);
writeFileSync(
  `${OUT}/props.json`,
  JSON.stringify({ source: SPZ, area: AREA, pixel: PX, band: BAND, note: "Referencia de autoría; el juego no colisiona contra el splat.", props: found }, null, 1),
);

// --- PNG (sin dependencias) ----------------------------------------------------
function png(path, width, height, channels, data) {
  const rowLen = width * channels;
  const rows = Buffer.alloc((rowLen + 1) * height);
  for (let y = 0; y < height; y++) {
    // Fila 0 de la imagen = z máximo (norte arriba visto desde +Y con X a la derecha).
    const srcY = height - 1 - y;
    rows[y * (rowLen + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + srcY * rowLen, rowLen).copy(rows, y * (rowLen + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 3 ? 2 : 0;
  writeFileSync(
    path,
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]),
  );
}
png(`${OUT}/topdown.png`, W, H, 3, rgb);
png(`${OUT}/heights.png`, W, H, 1, Uint8Array.from(hAbove, (h) => Math.min(255, Math.round((h / 3) * 255))));

const byKind = {};
for (const p of found) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log(`obstáculos: ${found.length}`, byKind);
for (const p of found.filter((p) => p.kind !== "poste/tronco").slice(0, 40)) {
  console.log(
    `#${String(p.id).padStart(4)} ${p.kind.padEnd(12)} centro (${p.center.x}, ${p.center.z}) suelo ${p.center.y}  ` +
      `${p.length}×${p.width}×${p.height} m  yaw ${p.yawDeg}°  área ${p.area} m²  relleno ${p.fill}`,
  );
}
console.log(`imágenes: ${OUT}/topdown.png, ${OUT}/heights.png (${W}×${H} px, ${PX} m/px)`);

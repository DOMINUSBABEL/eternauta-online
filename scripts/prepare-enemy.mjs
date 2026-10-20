#!/usr/bin/env node
// Prepara un enemigo GLB (malla + rig, sin animaciones) para la web:
// reescala las texturas embebidas (4096 px PNG → 1024 px JPEG) con `sips`
// (macOS) y reescribe el GLB con el mismo JSON y la geometría intacta.
//
// Todas a JPEG (ninguna usa alfa). El normal map va con más calidad: a 1024 px
// en PNG pesa 2,3 MB y, para un enemigo visto de lejos, las bandas del JPEG
// no se notan.
//
// Uso: npm run prepare:enemy -- [entrada.glb] [salida.glb] [tamaño_px]

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = process.argv[2] ?? "assets-src/cascarudo.glb";
const output = process.argv[3] ?? "public/assets/enemies/cascarudo.glb";
const size = Number(process.argv[4] ?? 1024);

const glb = readFileSync(input);
if (glb.toString("ascii", 0, 4) !== "glTF") throw new Error("No es un GLB");
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLen));
const binOffset = 20 + jsonLen + 8;
const view = (i) => {
  const v = gltf.bufferViews[i];
  const start = binOffset + (v.byteOffset ?? 0);
  return glb.subarray(start, start + v.byteLength);
};

// Qué imagen es un normal map (más calidad de JPEG).
const normalImages = new Set();
for (const m of gltf.materials ?? []) {
  const t = m.normalTexture?.index;
  if (t !== undefined) normalImages.add(gltf.textures[t].source);
}

const tmp = mkdtempSync(join(tmpdir(), "enemy-"));
const replaced = new Map(); // bufferView → Buffer nuevo
try {
  gltf.images?.forEach((img, i) => {
    if (img.bufferView === undefined) return;
    const src = join(tmp, `in${i}.png`);
    writeFileSync(src, view(img.bufferView));
    const dst = join(tmp, `out${i}.jpg`);
    const quality = normalImages.has(i) ? "92" : "85";
    execFileSync("sips", ["-Z", String(size), "-s", "format", "jpeg", "-s", "formatOptions", quality, src, "--out", dst], { stdio: "ignore" });
    const data = readFileSync(dst);
    replaced.set(img.bufferView, data);
    img.mimeType = "image/jpeg";
    console.log(`imagen ${img.name ?? i}: ${(view(img.bufferView).length / 1e6).toFixed(1)} MB → ${(data.length / 1e6).toFixed(2)} MB`);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Reempaquetar el BIN con los bufferViews en orden, alineados a 4 bytes.
const chunks = [];
let offset = 0;
gltf.bufferViews.forEach((v, i) => {
  const data = replaced.get(i) ?? view(i);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) chunks.push(Buffer.alloc(pad));
  offset += pad;
  v.byteOffset = offset;
  v.byteLength = data.length;
  chunks.push(data);
  offset += data.length;
});
const binPad = (4 - (offset % 4)) % 4;
if (binPad) chunks.push(Buffer.alloc(binPad));
const bin = Buffer.concat(chunks);
gltf.buffers = [{ byteLength: bin.length }];

let json = Buffer.from(JSON.stringify(gltf), "utf8");
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.write("glTF", 0, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const chunkHeader = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.write(type, 4, "ascii");
  return b;
};
const out = Buffer.concat([header, chunkHeader(json.length, "JSON"), json, chunkHeader(bin.length, "BIN\0"), bin]);
writeFileSync(output, out);
console.log(`${input} (${(glb.length / 1e6).toFixed(1)} MB) → ${output} (${(out.length / 1e6).toFixed(2)} MB)`);

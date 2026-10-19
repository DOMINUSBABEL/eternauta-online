#!/usr/bin/env node
// Prepara el collider mesh exportado desde World Labs Marble para el juego:
//  1. hornea las transformaciones de los nodos (Marble exporta la malla en
//     convención "Y abajo" y escala propia, con la matriz en el nodo raíz),
//  2. recorta a la zona jugable + margen (la reconstrucción llega a ±460 m),
//  3. descarta atributos que la física no usa (color, normales),
//  4. escribe un GLB mínimo: POSITION (float32) + índices (uint32).
//
// Uso: npm run prepare:collider -- [entrada.glb] [salida.glb] [margen_m]

import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2] ?? "assets-src/Nevada en Plaza de Mayo_collider.glb";
const output = process.argv[3] ?? "public/assets/collider.glb";
const margin = Number(process.argv[4] ?? 15);
// Zona jugable (= config.world.bounds) + margen para la cámara (hasta 12 m) y los raycasts.
const BOUNDS = { minX: -48, maxX: 59, minZ: -80, maxZ: 42 };
const crop = { minX: BOUNDS.minX - margin, maxX: BOUNDS.maxX + margin, minZ: BOUNDS.minZ - margin, maxZ: BOUNDS.maxZ + margin };

// --- Lectura del GLB ----------------------------------------------------------
const glb = readFileSync(input);
if (glb.toString("ascii", 0, 4) !== "glTF") throw new Error("No es un GLB");
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLen));
const binOffset = 20 + jsonLen + 8;
if (gltf.extensionsRequired?.length) throw new Error(`Extensiones no soportadas: ${gltf.extensionsRequired}`);

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const start = binOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = a.count * COMPONENTS[a.type];
  const Type = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType];
  if (view.byteStride && view.byteStride !== Type.BYTES_PER_ELEMENT * COMPONENTS[a.type]) throw new Error("byteStride intercalado no soportado");
  return new Type(glb.buffer.slice(glb.byteOffset + start, glb.byteOffset + start + n * Type.BYTES_PER_ELEMENT));
}

// Matrices 4×4 column-major.
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

// --- Recorrido de la escena: juntar triángulos en coordenadas del mundo -------
const positions = [];
const indices = [];
let inputTris = 0;
const remap = new Map();
function visit(nodeIndex, parent) {
  const node = gltf.nodes[nodeIndex];
  const world = multiply(parent, nodeMatrix(node));
  if (node.mesh !== undefined) {
    for (const prim of gltf.meshes[node.mesh].primitives) {
      if ((prim.mode ?? 4) !== 4) continue; // sólo triángulos
      const P = readAccessor(prim.attributes.POSITION);
      const I = prim.indices !== undefined ? readAccessor(prim.indices) : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
      const W = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const [x, y, z] = [P[i], P[i + 1], P[i + 2]];
        W[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
        W[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
        W[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
      }
      remap.clear();
      for (let t = 0; t < I.length; t += 3) {
        inputTris++;
        const tri = [I[t], I[t + 1], I[t + 2]];
        const xs = tri.map((v) => W[v * 3]);
        const zs = tri.map((v) => W[v * 3 + 2]);
        if (Math.max(...xs) < crop.minX || Math.min(...xs) > crop.maxX || Math.max(...zs) < crop.minZ || Math.min(...zs) > crop.maxZ) continue;
        for (const v of tri) {
          if (!remap.has(v)) {
            remap.set(v, positions.length / 3);
            positions.push(W[v * 3], W[v * 3 + 1], W[v * 3 + 2]);
          }
          indices.push(remap.get(v));
        }
      }
    }
  }
  for (const child of node.children ?? []) visit(child, world);
}
const scene = gltf.scenes[gltf.scene ?? 0];
for (const n of scene.nodes) visit(n, IDENTITY);

// --- Escritura del GLB mínimo ---------------------------------------------------
const pos = Float32Array.from(positions);
const idx = Uint32Array.from(indices);
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) {
  min[a] = Math.min(min[a], pos[i + a]);
  max[a] = Math.max(max[a], pos[i + a]);
}
const pad4 = (n) => (n + 3) & ~3;
const posBytes = pos.byteLength;
const idxOffset = pad4(posBytes);
const binLength = pad4(idxOffset + idx.byteLength);
const out = {
  asset: { version: "2.0", generator: "eternauta-online prepare-collider" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "collider", mesh: 0 }],
  meshes: [{ name: "collider", primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max },
    { bufferView: 1, componentType: 5125, count: idx.length, type: "SCALAR" },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idx.byteLength, target: 34963 },
  ],
  buffers: [{ byteLength: binLength }],
  extras: { source: input.split("/").pop(), crop, bakedTransform: true },
};
let jsonBuf = Buffer.from(JSON.stringify(out), "utf8");
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
const bin = Buffer.alloc(binLength);
Buffer.from(pos.buffer).copy(bin, 0);
Buffer.from(idx.buffer).copy(bin, idxOffset);
const header = Buffer.alloc(12);
header.write("glTF", 0, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunk = (len, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0);
  b.write(type, 4, "ascii");
  return b;
};
const file = Buffer.concat([header, chunk(jsonBuf.length, "JSON"), jsonBuf, chunk(bin.length, "BIN\0"), bin]);
writeFileSync(output, file);
console.log(
  `${input} → ${output}\n` +
    `  triángulos: ${inputTris} → ${idx.length / 3} (recorte x[${crop.minX}, ${crop.maxX}] z[${crop.minZ}, ${crop.maxZ}])\n` +
    `  bounds: min ${min.map((v) => v.toFixed(1))} max ${max.map((v) => v.toFixed(1))}\n` +
    `  tamaño: ${(glb.length / 1e6).toFixed(2)} MB → ${(file.length / 1e6).toFixed(2)} MB`,
);

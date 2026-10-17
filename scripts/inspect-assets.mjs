#!/usr/bin/env node
// Inspector de assets: analiza el SPZ (cabecera, bounds, histograma de altura)
// y el FBX (estructura, esqueleto, clips, escala) sin necesidad de navegador.
//
// Uso: npm run inspect:assets                     (assets por defecto)
//      npm run inspect:assets -- archivo.fbx [otro.spz …]

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const defaults = [
  "public/assets/scene.spz",
  "public/assets/player/Meshy_AI_Blue_Wasteland_Sentin_biped_Animation_Walking_withSkin.fbx",
];
const files = (args.length ? args : defaults).map((f) => resolve(f));

// ---------------------------------------------------------------- SPZ ----
function inspectSpz(path) {
  console.log(`\n=== SPZ: ${path}`);
  const raw = gunzipSync(readFileSync(path));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = dv.getUint32(0, true);
  const version = dv.getUint32(4, true);
  const n = dv.getUint32(8, true);
  const shDegree = dv.getUint8(12);
  const fracBits = dv.getUint8(13);
  const flags = dv.getUint8(14);
  console.log({
    magic: magic.toString(16),
    version,
    numPoints: n,
    shDegree,
    fractionalBits: fracBits,
    antialiased: (flags & 1) === 1,
    decompressedMB: (raw.byteLength / 1e6).toFixed(1),
  });
  if (magic !== 0x5053474e) throw new Error("No es un SPZ válido (magic NGSP)");

  // Posiciones: 3 × int24 en punto fijo por splat (v2+).
  const scale = 1 / (1 << fracBits);
  const posOff = 16;
  const alphaOff = posOff + n * 9;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      const o = posOff + i * 9 + a * 3;
      let v = raw[o] | (raw[o + 1] << 8) | (raw[o + 2] << 16);
      if (v & 0x800000) v |= 0xff000000; // extensión de signo
      const f = v * scale;
      (a === 0 ? xs : a === 1 ? ys : zs)[i] = f;
      if (f < min[a]) min[a] = f;
      if (f > max[a]) max[a] = f;
    }
  }
  const pct = (arr, ps) => {
    const s = Float32Array.from(arr).sort();
    return ps.map((p) => +s[Math.floor((s.length - 1) * p)].toFixed(2));
  };
  const ps = [0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999];
  console.log("bounds min", min.map((v) => +v.toFixed(2)), "max", max.map((v) => +v.toFixed(2)));
  console.log("percentiles", ps);
  console.log("  x", pct(xs, ps));
  console.log("  y", pct(ys, ps));
  console.log("  z", pct(zs, ps));

  // Histograma de cada eje restringido al núcleo de la escena para detectar
  // el plano del suelo (pico de densidad muy marcado en el eje vertical).
  const hist = (arr, lo, hi, bins) => {
    const h = new Uint32Array(bins);
    for (let i = 0; i < arr.length; i++) {
      const b = Math.floor(((arr[i] - lo) / (hi - lo)) * bins);
      if (b >= 0 && b < bins) h[b]++;
    }
    return h;
  };
  for (const [name, arr] of [["x", xs], ["y", ys], ["z", zs]]) {
    const [lo, hi] = pct(arr, [0.01, 0.99]);
    const bins = 40;
    const h = hist(arr, lo, hi, bins);
    const peak = Math.max(...h);
    console.log(`\nhistograma ${name} [${lo}, ${hi}]`);
    for (let b = 0; b < bins; b++) {
      const v0 = lo + ((hi - lo) * b) / bins;
      const bar = "#".repeat(Math.round((h[b] / peak) * 60));
      console.log(`${v0.toFixed(2).padStart(8)} ${String(h[b]).padStart(8)} ${bar}`);
    }
  }

  // Opacidad media (alphas en uint8).
  let alphaSum = 0;
  for (let i = 0; i < n; i++) alphaSum += raw[alphaOff + i];
  console.log("\nalpha medio", (alphaSum / n / 255).toFixed(3));
}

// ---------------------------------------------------------------- FBX ----
async function inspectFbx(path) {
  console.log(`\n=== FBX: ${path}`);
  // Shims mínimos para que FBXLoader pueda ejecutarse en Node: las texturas
  // se ignoran (sólo nos interesa la estructura).
  globalThis.self = globalThis;
  globalThis.window = globalThis;
  globalThis.document = {
    createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
  };
  const THREE = await import("three");
  const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
  THREE.TextureLoader.prototype.load = function () {
    const t = new THREE.Texture();
    return t;
  };
  const buf = readFileSync(path);
  const loader = new FBXLoader();
  const root = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  root.updateMatrixWorld(true);

  const meshes = [];
  const bones = [];
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
    if (o.isBone) bones.push(o);
  });
  console.log("root:", root.type, root.name, "scale", root.scale.toArray(), "rotation", root.rotation.toArray().slice(0, 3));
  console.log("hijos:", root.children.map((c) => `${c.type}:${c.name}`));
  for (const m of meshes) {
    const g = m.geometry;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    console.log(`mesh "${m.name}" skinned=${!!m.isSkinnedMesh} verts=${g.attributes.position.count} tris=${g.index ? g.index.count / 3 : g.attributes.position.count / 3}`);
    console.log("  atributos:", Object.keys(g.attributes));
    for (const mat of mats) {
      console.log(`  material "${mat.name}" ${mat.type}`, {
        map: !!mat.map,
        normalMap: !!mat.normalMap,
        specularMap: !!mat.specularMap,
        emissiveMap: !!mat.emissiveMap,
      });
    }
    if (m.isSkinnedMesh) console.log("  esqueleto: huesos", m.skeleton.bones.length);
  }
  console.log("huesos:", bones.length, bones.slice(0, 30).map((b) => b.name).join(", "));

  const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));
  for (const m of meshes) {
    const b = new THREE.Box3().setFromObject(m, true);
    console.log(`bbox "${m.name}" min`, r3(b.min), "max", r3(b.max), "parent:", m.parent?.name, "pos", r3(m.position), "scale", r3(m.scale));
  }
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  console.log("bbox total min", r3(box.min), "max", r3(box.max));
  console.log("tamaño total", r3(size));

  const hips = bones.find((b) => /hips/i.test(b.name));
  if (hips) {
    const wp = hips.getWorldPosition(new THREE.Vector3());
    console.log("hips local", r3(hips.position), "world", r3(wp), "parent", hips.parent?.name, "parent scale", r3(hips.parent.scale));
  }
  for (const clip of root.animations) {
    // Huesos con rotación animada: 0 = pose estática (export roto).
    let animated = 0;
    for (const t of clip.tracks.filter((t) => t.name.endsWith(".quaternion"))) {
      const q0 = new THREE.Quaternion().fromArray(t.values, 0);
      const q = new THREE.Quaternion();
      for (let i = 4; i < t.values.length; i += 4) {
        if (q0.angleTo(q.fromArray(t.values, i)) > 0.01) {
          animated++;
          break;
        }
      }
    }
    const flag = animated === 0 ? "  ⚠ ESTÁTICO (sin keyframes animados)" : "";
    console.log(`clip "${clip.name}" dur=${clip.duration.toFixed(3)}s tracks=${clip.tracks.length} huesos animados=${animated}${flag}`);
    for (const t of clip.tracks.filter((t) => /hips\.position|target_character/i.test(t.name))) {
      const v = t.values;
      const k = v.length / 3;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < k; i++) {
        for (let a = 0; a < 3; a++) {
          lo[a] = Math.min(lo[a], v[i * 3 + a]);
          hi[a] = Math.max(hi[a], v[i * 3 + a]);
        }
      }
      const first = [v[0], v[1], v[2]].map((x) => +x.toFixed(3));
      const last = [v[(k - 1) * 3], v[(k - 1) * 3 + 1], v[(k - 1) * 3 + 2]].map((x) => +x.toFixed(3));
      console.log(`  ${t.name} keys=${k} first=${first} last=${last} min=${lo.map((x) => +x.toFixed(2))} max=${hi.map((x) => +x.toFixed(2))}`);
    }
  }
}

for (const file of files) {
  if (/\.spz$/i.test(file)) inspectSpz(file);
  else if (/\.fbx$/i.test(file)) await inspectFbx(file).catch((e) => console.error("FBX error:", e));
  else console.error(`Extensión no soportada: ${file}`);
}

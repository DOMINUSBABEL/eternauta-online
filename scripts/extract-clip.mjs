#!/usr/bin/env node
// Extrae un clip de animación de un FBX a JSON (THREE.AnimationClip.toJSON),
// para no descargar el FBX completo (malla + texturas) sólo por su animación.
//
// Uso: npm run extract:clip -- <archivo.fbx> <NombreDelClip> <salida.json>
// Ej.: npm run extract:clip -- public/assets/player/Meshy_..._Merged_Animations.fbx \
//        Running public/assets/player/animations/running.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [fbxArg, clipName, outArg] = process.argv.slice(2);
if (!fbxArg || !clipName || !outArg) {
  console.error("Uso: npm run extract:clip -- <archivo.fbx> <NombreDelClip> <salida.json>");
  process.exit(1);
}

// Shims mínimos para FBXLoader en Node (las texturas se ignoran).
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
};
const THREE = await import("three");
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const warn = console.warn;
console.warn = () => {};

const buf = readFileSync(resolve(fbxArg));
const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
console.warn = warn;

const short = (n) => n.split("|").pop();
const clip = root.animations.find((c) => short(c.name) === clipName || c.name === clipName);
if (!clip) {
  console.error(`No existe "${clipName}". Clips: ${root.animations.map((c) => short(c.name)).join(", ")}`);
  process.exit(1);
}

// Rechazar clips estáticos (export roto de Meshy).
let animated = 0;
const q0 = new THREE.Quaternion();
const q = new THREE.Quaternion();
for (const t of clip.tracks.filter((t) => t.name.endsWith(".quaternion"))) {
  q0.fromArray(t.values, 0);
  for (let i = 4; i < t.values.length; i += 4) {
    if (q0.angleTo(q.fromArray(t.values, i)) > 0.01) {
      animated++;
      break;
    }
  }
}
if (animated === 0) {
  console.error(`"${clipName}" no tiene keyframes animados (pose estática): no se exporta.`);
  process.exit(1);
}

// Pistas constantes de escala no aportan nada: se descartan para achicar el JSON.
clip.tracks = clip.tracks.filter((t) => {
  if (!t.name.endsWith(".scale")) return true;
  const v = t.values;
  for (let i = 3; i < v.length; i++) if (Math.abs(v[i] - v[i % 3]) > 1e-6) return true;
  return false;
});

// El resto de las pistas constantes (huesos que no se mueven: dedos, posiciones
// de huesos hijos) se reducen a una sola key: mismo resultado, ~5× menos JSON.
let collapsed = 0;
clip.tracks = clip.tracks.map((t) => {
  const size = t.getValueSize();
  const v = t.values;
  for (let i = size; i < v.length; i++) if (Math.abs(v[i] - v[i % size]) > 1e-6) return t;
  if (t.times.length === 1) return t;
  collapsed++;
  return new t.constructor(t.name, [t.times[0]], Array.from(v.slice(0, size)));
});

const json = THREE.AnimationClip.toJSON(clip);
json.name = short(clip.name);
// Redondeo a 5 decimales: suficiente para rotaciones/posiciones y ~3× más chico.
const round = (x) => Math.round(x * 1e5) / 1e5;
for (const t of json.tracks) {
  t.times = Array.from(t.times, round);
  t.values = Array.from(t.values, round);
}

const out = resolve(outArg);
mkdirSync(dirname(out), { recursive: true });
const text = JSON.stringify(json);
writeFileSync(out, text);
console.log(
  `"${json.name}": ${clip.duration.toFixed(3)} s, ${json.tracks.length} pistas, ${animated} huesos animados, ${collapsed} constantes →${outArg} (${(text.length / 1024).toFixed(0)} KB)`,
);

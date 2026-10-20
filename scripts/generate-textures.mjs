#!/usr/bin/env node
// Genera las texturas de los modelos 3D con Replicate (FLUX 1.1 Pro) a partir
// de los prompts de assets-src/props/PROMPTS_TEXTURAS.md.
//
//   node scripts/generate-textures.mjs              # todas las que falten
//   node scripts/generate-textures.mjs nieve tejas  # sólo esas
//   node scripts/generate-textures.mjs --force ...  # regenerar aunque existan
//   node scripts/generate-textures.mjs --dry-run    # listar prompts y costo, sin llamar a la API
//
// Necesita REPLICATE_API_TOKEN en el entorno o en .env.local (no se versiona).
// Las imágenes crudas van a assets-src/props/textures_raw/; después
// scripts/blender/props/seamless.py las hace repetibles y las deja en
// textures_custom/ (npm run textures:generate hace los dos pasos).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const MODEL = "black-forest-labs/flux-1.1-pro";
const PRICE_USD = 0.04; // por imagen (replicate.com/pricing)
const PROMPTS = "assets-src/props/PROMPTS_TEXTURAS.md";
const RAW = "assets-src/props/textures_raw";

const SUFFIX_TILE =
  "seamless tileable texture, orthographic flat front view, fills the whole frame edge to edge, even diffuse overcast lighting, no shadows, no perspective, no vignette, photorealistic material scan, high detail, post-apocalyptic winter, light snow dust";
const SUFFIX_FLAT = "flat front view, fills the whole frame, even diffuse lighting, no perspective, photorealistic, high detail";

function token() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN;
  if (existsSync(".env.local")) {
    const m = readFileSync(".env.local", "utf8").match(/^REPLICATE_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("Falta REPLICATE_API_TOKEN (en el entorno o en .env.local)");
}

/** Filas de las tablas: | `nombre` | (escala |) prompt | */
function parsePrompts() {
  const out = [];
  for (const line of readFileSync(PROMPTS, "utf8").split("\n")) {
    const m = line.match(/^\|\s*`([a-z_]+)`\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    const prompt = cells[cells.length - 1].replace(/\*\*/g, "");
    const tile = !/no tileable/i.test(prompt);
    out.push({ name: m[1], prompt: prompt.replace(/No tileable( vertical)?:?/i, "").trim(), tile });
  }
  return out;
}

function inputFor(t) {
  const input = {
    prompt: `${t.prompt}. ${t.tile ? SUFFIX_TILE : SUFFIX_FLAT}`,
    output_format: "png",
    safety_tolerance: 2,
    prompt_upsampling: false,
    seed: SEED,
  };
  if (t.name === "bandera") Object.assign(input, { aspect_ratio: "custom", width: 1280, height: 800 });
  else Object.assign(input, { aspect_ratio: "custom", width: 1024, height: 1024 });
  return input;
}

async function run(t, auth) {
  const headers = { Authorization: `Bearer ${auth}`, "Content-Type": "application/json", Prefer: "wait=60" };
  let res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: inputFor(t) }),
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`${t.name}: HTTP ${res.status} ${JSON.stringify(pred).slice(0, 300)}`);
  while (pred.status === "starting" || pred.status === "processing") {
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${auth}` } });
    pred = await res.json();
  }
  if (pred.status !== "succeeded") throw new Error(`${t.name}: ${pred.status} ${pred.error ?? ""}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const img = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(`${RAW}/${t.name}.png`, img);
  return img.length;
}

const args = process.argv.slice(2);
// --seed=N para reintentar con otra variante (p. ej. si el filtro de seguridad da un falso positivo)
const SEED = Number(args.find((a) => a.startsWith("--seed="))?.slice(7) ?? 64);
const force = args.includes("--force");
const dry = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));
const all = parsePrompts();
const unknown = only.filter((n) => !all.some((t) => t.name === n));
if (unknown.length) throw new Error(`Sin prompt en ${PROMPTS}: ${unknown.join(", ")}`);
mkdirSync(RAW, { recursive: true });
const todo = all.filter((t) => (only.length ? only.includes(t.name) : true) && (force || !existsSync(`${RAW}/${t.name}.png`)));
console.log(`${todo.length} imágenes con ${MODEL} ≈ US$ ${(todo.length * PRICE_USD).toFixed(2)}`);
if (dry) {
  for (const t of todo) console.log(`- ${t.name}${t.tile ? "" : " (no repetible)"}: ${inputFor(t).prompt}`);
  process.exit(0);
}
const auth = token();
let ok = 0;
const failed = [];
// De a 3 en paralelo para no chocar con el límite de la API.
for (let i = 0; i < todo.length; i += 3) {
  await Promise.all(
    todo.slice(i, i + 3).map(async (t) => {
      try {
        const n = await run(t, auth);
        ok++;
        console.log(`✓ ${t.name} (${(n / 1024).toFixed(0)} KB)`);
      } catch (err) {
        failed.push(t.name);
        console.error(`✗ ${err.message}`);
      }
    }),
  );
}
console.log(`${ok} generadas, ${failed.length} con error${failed.length ? `: ${failed.join(", ")}` : ""}`);
if (failed.length) process.exitCode = 1;

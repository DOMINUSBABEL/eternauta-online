#!/usr/bin/env bash
# Genera las versiones livianas de los assets que descarga el juego publicado.
# Requiere macOS (sips). Los originales no se modifican.
set -euo pipefail
cd "$(dirname "$0")/.."

P=public/assets/player
SRC=Meshy_AI_Blue_Wasteland_Sentin_biped

# Mapas de rugosidad y metalicidad: 4096 px → 1024 px (escala de grises).
for map in roughness metallic; do
  sips -s format png -Z 1024 "$P/${SRC}_texture_0_${map}.png" --out "$P/texture_0_${map}_1k.png" >/dev/null
  echo "$P/texture_0_${map}_1k.png: $(du -h "$P/texture_0_${map}_1k.png" | cut -f1)"
done

# Clip de carrera: del FBX fusionado (17 MB) a JSON.
node scripts/extract-clip.mjs "$P/${SRC}_Meshy_Merged_Animations.fbx" Running "$P/animations/running.json"

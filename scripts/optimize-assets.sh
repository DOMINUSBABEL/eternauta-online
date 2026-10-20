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

# Clips sueltos de Meshy (un FBX por animación, 27 MB c/u) en assets-src/animations.
A=assets-src/animations
clip() { # <archivo sin prefijo> <NombreDelClip> <salida.json>
  local src="$A/${SRC}_Animation_$1_withSkin.fbx"
  if [ -f "$src" ]; then node scripts/extract-clip.mjs "$src" "$2" "$P/animations/$3"; else echo "falta $src (se omite)"; fi
}
clip Idle_7 Idle_7 idle.json
clip Jump_Over_Obstacle_2 Jump_Over_Obstacle_2 jump.json
clip Boxing_Guard_Prep_Straight_Punch Boxing_Guard_Prep_Straight_Punch punch.json
clip Boxing_Guard_Step_Knee_Strike Boxing_Guard_Step_Knee_Strike kick.json
clip Crouch_and_Step_Back Crouch_and_Step_Back step-back.json
clip dying_backwards dying_backwards die.json
clip Run_and_Shoot Run_and_Shoot run-shoot.json

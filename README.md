# El Eternauta Online — prototipo jugable

Demo 3D en el navegador inspirada en *El Eternauta*: una Plaza de Mayo
postapocalíptica bajo la nevada mortal, reconstruida con **Gaussian splatting**
(World Labs Marble → `.spz`) y recorrida en tercera persona por el protagonista
(Meshy → `.fbx`).

Stack: **Three.js 0.186 · TypeScript 6 · Vite 8 · Spark 2.3 (World Labs)** ·
lil-gui · three-mesh-bvh. Todo WebGL2, corre directo en Chrome.

## Inicio rápido

Requisitos: Node 20+ y un navegador con WebGL2 (Chrome recomendado).

```bash
npm install
```

```bash
npm run dev
```

Abrir <http://localhost:5173>, esperar la carga (≈1 s de descarga + ≈6 s de
decodificación y LoD del splat en un M4 Pro) y pulsar **ENTRAR AL MUNDO**.

Otros comandos:

```bash
npm run build          # typecheck + build de producción en dist/
npm run preview        # sirve dist/
npm run typecheck      # sólo TypeScript
npm run inspect:assets # analiza el SPZ y el FBX desde Node (ver abajo)
```

## Controles

| Tecla | Acción |
|---|---|
| W / A / S / D | Moverse (relativo a la cámara) |
| Mouse | Rotar cámara (click para capturar el puntero; sin captura, arrastrar) |
| Rueda | Distancia de cámara |
| Shift | Correr |
| Espacio | Saltar |
| R | Reiniciar posición |
| Esc | Liberar el mouse |
| P / º / F3 | Panel de calibración y métricas |

## Assets

```
public/assets/
  scene.spz                       # Plaza de Mayo (Marble), 65 MB
  player/*_Walking_withSkin.fbx   # protagonista + caminata (Meshy), 27 MB — modelo base
  player/*_Merged_Animations.fbx  # 16 clips de Meshy, 17 MB — se usa sólo "Running"
  player/*_roughness.png, *_metallic.png, ...
```

Los assets pesados están en `.gitignore`: versionarlos con Git LFS o
distribuirlos aparte.

### Lo que se encontró al inspeccionarlos (`npm run inspect:assets`)

**SPZ** (`scene.spz`)
- SPZ v2 (gzip, magic `NGSP`), **4 320 000 splats**, armónicos esféricos grado 0,
  10 bits fraccionarios, flag antialiased.
- **Eje Y hacia arriba**, unidades ≈ metros: no hace falta rotarlo (a diferencia
  de los SPZ en convención OpenCV que usan `quaternion.set(1,0,0,0)`).
- Núcleo caminable ≈ 100 × 80 m; el suelo ronda y ≈ −0,2 y baja suavemente hacia
  +X (hacia la Casa Rosada). Además hay una cúpula lejana (cielo/fondo) hasta
  ~1,5 km.
- Spark construye el LoD en el navegador: 4,32 M → árbol de 4,98 M splats;
  dibuja ~2,5 M por frame (presupuesto por defecto de escritorio).

**FBX** (`..._Animation_Walking_withSkin.fbx`)
- FBX 7400 binario con **5 PNG embebidos** (base, normal, rugosidad, metalicidad).
- `output_unwrapped`: SkinnedMesh de 31 170 vértices, rig **Mixamo de 60 huesos**
  (`mixamorigHips` raíz), unidades en centímetros (armature con escala 100,
  rotación −90° en X por conversión Z-up).
- Mide **172,3 cm** → se escala ×0,01045 para medir **1,80 m**.
- Un solo clip: `Walking`, 1,04 s, 183 pistas. La caminata es *in place*
  (el Hips oscila ±3 cm): no hay root motion que duplique el desplazamiento.
  Igual se aplica un filtro que elimina cualquier deriva horizontal neta.
- Contiene una malla extra **`Icosphere`** (esfera estática de 2 m de diámetro,
  sin skin, centrada en el personaje). Es un artefacto de exportación de Meshy:
  se **oculta** y se informa en consola (`character.hideAuxiliaryMeshes`).
- Los materiales vienen como Phong (FBXLoader no soporta los mapas de
  rugosidad/metalicidad): se convierten a `MeshStandardMaterial` reutilizando
  los mapas base y normal embebidos y cargando los PNG de rugosidad/metalicidad.

**FBX de animaciones fusionadas** (`..._Meshy_Merged_Animations.fbx`)
- Mismo mesh (vértices idénticos) y **mismo bind pose** (`boneInverses` idénticos)
  que el FBX base; le faltan 10 huesos terminales `*_end` sin influencia. Los
  clips son compatibles con el modelo base.
- Declara 16 clips (Running, Run_02, Run_03, Walking, Alert, Jump_Over_Obstacle_2,
  Jump_with_Arms_Open, Run_and_Shoot, Running_Reload_inplace, boxeo/patadas,
  muertes, agacharse/arrastrarse), pero **sólo `Running` tiene keyframes reales**.
  Verificado leyendo el binario FBX directamente (no es un límite de FBXLoader):
  los otros 15 *animation stacks* tienen curvas de 2 keys sin variación, y la
  pose es la misma en todos (el primer frame de Running).
- Se usa `Running` para el estado **run** (velocidad natural estimada 4,79 m/s,
  con `runSpeed` 4,6 m/s queda a ×0,96: sin patinar). El cargador descarta
  automáticamente cualquier clip estático y lo avisa en consola.
- Para aprovechar el resto (idle `Alert`, saltos, disparo, recarga, muertes)
  hay que re-exportarlos desde Meshy **uno por FBX** (como la caminata, que
  salió bien) o regenerar el merge verificando que cada animación quede horneada.
  `npm run inspect:assets -- ruta.fbx` lista los clips de un FBX y marca los
  estáticos.

## Arquitectura

```
src/
  main.ts               arranque, chequeo WebGL2, HMR/dispose
  Game.ts               orquestador: carga paralela, bucle (paso fijo + render interpolado)
  config.ts             TODA la calibración (escala, rotación, suelo, límites, cámara, render)
  World.ts              renderer, escena, luces, SparkRenderer, resolución/pixel ratio
  SplatEnvironment.ts   carga del SPZ con Spark (progreso, estados, errores, transform)
  Character.ts          FBX: inspección, normalización, materiales PBR, animación
  PlayerController.ts   controlador cinemático independiente del render
  CollisionSystem.ts    interfaz CollisionProvider + suelo provisional + malla GLB (BVH)
  ThirdPersonCamera.ts  cámara orbital estilo PS2 con suavizado y anti-clipping
  InputManager.ts       teclado, pointer lock, mouse, rueda
  Hud.ts                título, métricas, pantalla inicial, overlays de grano/viñeta
  DebugPanel.ts         calibración en vivo (lil-gui) + métricas + export de config
  Snowfall.ts           nevada en GPU que acompaña a la cámara
scripts/
  inspect-assets.mjs    análisis offline del SPZ y del FBX
```

Decisiones clave:

- **Simulación a paso fijo** (`movement.tickRate`, 120 Hz) con render
  interpolado: el movimiento no depende de los FPS. `PlayerController` sólo usa
  `Vector3`, así que la misma lógica puede correr en un servidor autoritativo
  cuando llegue el multijugador.
- **Colisiones desacopladas del splat.** Todo consulta `CollisionProvider`
  (`groundHeight`, `resolveHorizontal`, `raycast`). Hoy rige
  `ProvisionalCollision`: un plano invisible con altura y pendiente ajustables,
  límites rectangulares y cajas de obstáculo opcionales.
- **Animación por pesos** en lugar de `crossFadeTo`: cada estado tiene una
  acción y los pesos se interpolan; la caminata ajusta su `timeScale` a la
  velocidad real para que los pies no patinen (velocidad natural del clip
  estimada automáticamente: 1,43 m/s).

### Estados de animación y clips faltantes

El FBX sólo trae caminata. No se inventan clips:

| Estado | Hoy | Para mejorarlo |
|---|---|---|
| idle | pose congelada del clip walk (instante con los pies más juntos, detectado automáticamente) | **falta un clip idle** |
| walk | clip `Walking` con cadencia según velocidad | — |
| run | clip `Running` (FBX fusionado), cadencia según velocidad | — |
| jump / fall | pose actual congelada en el aire | faltan clips jump/fall |

Para sumar clips (Meshy o Mixamo, mismo rig `mixamorig`), agregarlos en
`config.assets.extraAnimations`; `clip` elige por nombre dentro del FBX:

```ts
extraAnimations: [
  { state: "run", url: "/assets/player/..._Merged_Animations.fbx", clip: "Running" },
  { state: "idle", url: "/assets/player/idle.fbx" },
],
```

Los FBX extra se descargan en paralelo con el personaje; de cada uno se extrae
el clip y se liberan su geometría y texturas. Los clips sin keyframes animados
se rechazan con un aviso.

### Malla de colisiones real (Marble)

Marble puede exportar un *collider mesh* en GLB. Para usarlo:

1. Copiarlo a `public/assets/collider.glb`.
2. Poner `collisionMeshUrl: "/assets/collider.glb"` en `src/config.ts`.

`MeshCollision` lo carga, construye un BVH (three-mesh-bvh) y lo transforma con
la misma matriz que el splat (posición/rotación/escala del escenario), así que
ambos quedan alineados. Suelo por raycast descendente con subida de escalones,
empuje lateral por esferas a la altura de rodillas/torso/cabeza, y raycast de
cámara contra paredes. Si la carga falla, se informa en el HUD y se mantiene la
colisión provisional.

## Calibración

Abrir el panel con **P**. Todo edita `config` en vivo:

- **Personaje**: altura objetivo, multiplicador de escala, orientación frontal,
  offset vertical, velocidad del clip.
- **Escenario**: posición/rotación/escala del splat, presupuesto de LoD.
- **Suelo y límites**: altura y pendiente del suelo invisible, límites XZ,
  spawn (con botón "usar posición actual"), obstáculos de prueba, y
  visualización del suelo/límites.
- **Movimiento, cámara, render y nevada**.
- **Guardar** persiste en `localStorage`; **Exportar JSON** copia sólo las
  diferencias con los defaults para pegarlas en `src/config.ts`.

Overrides por URL: `?renderScale=0.5`, `?envScale=1.1`, `?lod=0`.

Los defaults de suelo provienen de ajustar un plano por mínimos cuadrados a la
densidad de splats del suelo (calibración offline, la física no consulta el
splat): `y = −0,2 − 0,003·x − 0,0006·z`, residuo mediano 0,15 m. Hay una
hondonada de ~0,4 m hacia x≈30, z≈10 que un plano no captura: ahí los pies
pueden flotar levemente hasta tener la malla de colisiones.

## Rendimiento (medido)

En un Apple M4 Pro (Chrome / ANGLE Metal), con ~2,5 M splats visibles:

- HUD en primer plano: **~94–100 FPS** a 800×564 CSS px (pixel ratio 1,5).
- Frame completo sincronizado con la GPU (simulación + render + `readPixels`):
  **~7–8 ms** a 777×1278 px de canvas.

No está medido en otras GPUs. Palancas disponibles: `render.maxPixelRatio`,
`render.renderScale` (con `pixelated` para un look PS2), `environment.lodSplatScale`.
La carga del SPZ tarda ~6 s extra por construir el LoD en el navegador; se
puede eliminar precompilando un `.rad` con la herramienta `build-lod` de Spark
(requiere Rust) y cargándolo con `paged: true`.

## Próximos pasos sugeridos

1. Exportar el collider mesh de Marble y activarlo (`collisionMeshUrl`).
2. Clips idle / run / jump desde Mixamo con el mismo rig.
3. Precompilar el LoD a `.rad` para carga instantánea y streaming.
4. Estado de red: el controlador ya es determinista a paso fijo, base para
   predicción del lado del cliente + servidor autoritativo.

## Licencias

Código: MIT. Spark (World Labs) es MIT. Los assets (FBX/SPZ) pertenecen a sus
autores y no se incluyen en el repositorio.

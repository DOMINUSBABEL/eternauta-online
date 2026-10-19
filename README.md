# El Eternauta Online — prototipo jugable

Demo 3D en el navegador inspirada en *El Eternauta*: una Plaza de Mayo
postapocalíptica bajo la nevada mortal, reconstruida con **Gaussian splatting**
(World Labs Marble → `.spz`) y recorrida en tercera persona por el protagonista
(Meshy → `.fbx`).

Stack: **Three.js 0.186 · TypeScript 6 · Vite 8 · Spark 2.3 (World Labs)** ·
lil-gui · three-mesh-bvh. Todo WebGL2, corre directo en Chrome.

**Jugalo:** <https://santisiri.github.io/eternauta-online/> (computadora con
teclado y mouse, o celular con controles táctiles; descarga ~95 MB).

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

En celulares y tablets (detectados por `pointer: coarse`, o al primer toque en
una pantalla táctil):

| Gesto | Acción |
|---|---|
| Joystick (mitad izquierda, aparece donde apoyás el dedo) | Moverse; inclinado al tope corre |
| Arrastrar en el resto de la pantalla | Rotar cámara |
| Pellizcar | Distancia de cámara |
| Botón SALTAR / ↺ | Saltar / reiniciar posición |

Al entrar se pide pantalla completa y orientación horizontal (Android; iPhone no
lo permite). En vertical el FOV se abre hasta 85° para no ver "por un tubo".
El perfil móvil (`applyMobileProfile`) baja el pixel ratio a 1,25, reduce la
nevada y quita el grano/filtros CSS; Spark ya usa por su cuenta un presupuesto
de LoD menor en móviles (~1 M de splats visibles).

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
  InputManager.ts       teclado, pointer lock, mouse, rueda + entrada virtual
  TouchControls.ts      joystick, cámara táctil, pellizco y botones (móviles)
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
  (`groundSample`, `resolveHorizontal`, `raycast`). Hoy rige `MeshCollision`
  con el collider exportado desde Marble; `ProvisionalCollision` (plano
  invisible ajustable + cajas) queda como respaldo si la malla no carga.
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

### Malla de colisiones (collider de Marble)

El collider exportado desde Marble (`assets-src/Nevada en Plaza de Mayo_collider.glb`,
120 k triángulos, 4,3 MB) viene en convención "Y abajo" y con escala propia; la
matriz que lo lleva al sistema del splat está en su nodo raíz (×7,145, Y/Z
invertidos, +4,386 en Y). Verificado: el suelo de la malla coincide con el del
splat a ±5 cm en las zonas abiertas.

Para el juego se prepara con:

```bash
npm run prepare:collider
```

que hornea esa matriz, recorta a la zona jugable + 15 m (para la cámara) y deja
sólo posiciones e índices → `public/assets/collider.glb`, **17 k triángulos,
0,36 MB**, con resultados idénticos al original dentro de la plaza.

`MeshCollision` construye un BVH (three-mesh-bvh) y responde:

- **Suelo** por rayo descendente (escalones de hasta 35 cm), con la normal de
  la superficie.
- **Pendiente máxima** (`movement.maxSlopeDeg`, 40°): no se sube por nada más
  empinado; se puede bajar, y si el jugador cae sobre algo empinado se desliza.
  Sin esto se podía trepar el colectivo (sus lados son rampas de 44°).
- **Bordes sin suelo** (interior de edificios, huecos): no se cruzan; el
  jugador se desliza por el borde.
- **Paredes**: esferas a la altura de rodillas, torso y cabeza.
- **Cámara**: rayo contra la malla; de espaldas a una fachada se acerca en
  lugar de atravesarla.

Los límites (`world.bounds`) quedaron como red de seguridad alrededor del área
alcanzable desde el spawn (≈6.400 m², medida con un *flood fill* sobre la
malla): los que frenan son los edificios. Con **P → Suelo y límites →
mostrar colisiones** se ve el wireframe del collider sobre el splat.

Limitación: el collider de Marble tiene ~1 m de resolución. Los canteros son
montículos suaves de ~12° (se caminan por encima) y los cajones se funden con el
colectivo. Para precisión de shooter, el siguiente paso es corregir esos
objetos en Blender (el MCP ya está configurado, ver `.mcp.json`).

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

El suelo provisional (respaldo si no hay collider) es un plano ajustado por
mínimos cuadrados a la densidad de splats del suelo (calibración offline, la
física no consulta el splat): `y = −0,2 − 0,003·x − 0,0006·z`.

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

## Publicación (GitHub Pages)

Cada push a `main` compila y publica con GitHub Actions
(`.github/workflows/deploy.yml`) en <https://santisiri.github.io/eternauta-online/>.

- `base: "./"` en Vite + `asset()` en `config.ts`: el build funciona en la raíz o
  en cualquier subcarpeta (Pages, itch.io…).
- El repo sólo versiona lo que el juego descarga (~89 MB). Los originales
  pesados quedan fuera por `.gitignore`; las versiones livianas se regeneran con:

  ```bash
  npm run optimize:assets
  ```

  (mapas de rugosidad/metalicidad a 1024 px y el clip `Running` extraído del FBX
  fusionado a `animations/running.json`, 35 KB en lugar de 17 MB).
- `.env` define `VITE_SITE_URL`, usada por la tarjeta de X/Open Graph
  (`public/og.jpg`, 1200×630). Si publicás un fork, cambiala.
- En celulares (sin mouse) o con ahorro de datos, el juego avisa el tamaño de la
  descarga y espera confirmación antes de bajar los assets.
- GitHub Pages tiene un límite flexible de 100 GB/mes (≈1.000 visitas a ~95 MB).
  Si el tráfico crece, el siguiente paso es servir `scene.spz` y el FBX desde
  Cloudflare R2 (sin costo de egreso) y apuntar `config.assets` ahí.

## Próximos pasos sugeridos

1. Refinar el collider en Blender: canteros, cajones, colectivo y bancos como
   volúmenes precisos (el collider de Marble los suaviza).
2. Clips idle / jump desde Meshy o Mixamo con el mismo rig.
3. Precompilar el LoD a `.rad` para carga instantánea y streaming.
4. Estado de red: el controlador ya es determinista a paso fijo, base para
   predicción del lado del cliente + servidor autoritativo.

## Licencias

Código: MIT. Spark (World Labs) es MIT. Los assets (FBX/SPZ) pertenecen a sus
autores y no se incluyen en el repositorio.

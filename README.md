# El Eternauta Online — prototipo jugable

Demo 3D en el navegador inspirada en *El Eternauta*: una Plaza de Mayo
postapocalíptica bajo la nevada mortal, reconstruida con **Gaussian splatting**
(World Labs Marble → `.spz`) y recorrida en tercera persona por el protagonista
(Meshy → `.fbx`).

Stack: **Three.js 0.186 · TypeScript 6 · Vite 8 · Spark 2.3 (World Labs)** ·
lil-gui · three-mesh-bvh. Todo WebGL2, corre directo en Chrome.

**Jugalo:** <https://santisiri.github.io/eternauta-online/> (computadora con
teclado y mouse, o celular con controles táctiles; descarga ~104 MB).

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
| Clic izq. (mantener) / Q | Disparar a la mira (cámara sobre el hombro) |
| Clic der. (mantener) | Apuntar sin disparar |
| F / V / C | Piña / patada (también dañan cascarudos) / esquivar |
| R | Reiniciar posición (y revivir) |
| M | Silenciar / activar el sonido |
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
| Botón FUEGO (mantener) | Disparar (con ayuda de apuntado: los blancos son 0,6 m más grandes) |

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
  player/animations/*.json        # clips extraídos (idle, salto, disparo, piña, patada, esquive, muerte)
  enemies/cascarudo.glb           # cascarudo: malla + rig de 57 huesos, sin clips, 2,8 MB
  audio/bandoneon-lejos.webm|m4a  # banda sonora "Bandoneón Lejos" (3:19; Opus original + AAC para Safari), 3,2 MB c/u
assets-src/cascarudo.glb          # original (texturas 4K, 31 MB, fuera del repo)
assets-src/animations/*.fbx       # un FBX de Meshy por animación (27 MB c/u, fuera del repo)
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
  EnemySystem.ts        cascarudos: spawn por el mapa, IA a 30 Hz, mordidas, muerte, reaparición
  CascarudoRig.ts       marcha procedural sobre el rig del cascarudo (trípode, boca, cola, muerte)
  Combat.ts             disparo hitscan desde la mira, cuerpo a cuerpo, vida del traje
  CombatHud.ts          mira, marcador de impacto, vida, bajas, daño y cartel de muerte
  Effects.ts            fogonazo, humo, vainas, trazadoras, hemolinfa, manchas en el suelo, polvo de pisadas
  Audio.ts              sonido sintetizado y posicional: disparos, chillidos, pisadas, impactos, viento
  PropSystem.ts         modelos 3D de Blender: instanciado, colisiones y recorte del splat
scripts/
  inspect-assets.mjs    análisis offline del SPZ y del FBX
  prepare-enemy.mjs     texturas del GLB del cascarudo 4096 → 1024 px JPEG (`npm run prepare:enemy`)
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

### Estados de animación

Todos los clips son del mismo rig Meshy/Mixamo (60 huesos) que el modelo base.

| Estado | Clip | Cómo se reproduce |
|---|---|---|
| idle | `Idle_7` (8,7 s) | en loop |
| walk / run | `Walking` / `Running` | cadencia según la velocidad real (sin patinar) |
| jump / fall | `Jump_Over_Obstacle_2` (0,83 s) | el tiempo del clip lo fija la velocidad vertical: despegue → apogeo → aterrizaje; una caída sin salto arranca en el apogeo. La cadera se fija (la altura la pone la física) |
| disparar corriendo | `Run_and_Shoot` (0,67 s) | cadencia según velocidad (`movement.shootMoveSpeed` 2,2 m/s) |
| disparar quieto | piernas de `Idle_7` + torso de `Run_and_Shoot` | pose armada al cargar (`buildAimClip`), mira hacia la cámara |
| piña | `Boxing_Guard_Prep_Straight_Punch`, ventana 1,25–2,7 s ×1,4 | impacto a 1,88 s → `player.onMeleeHit("punch")` |
| patada | `Boxing_Guard_Step_Knee_Strike`, ventana 0,15–2,3 s ×1,3 | rodillazo a 0,92 s → `onMeleeHit("kick")` |
| esquive | `Crouch_and_Step_Back`, ventana 0,25–2,2 s ×1,25 | retrocede 1,9 m |
| muerte | `dying_backwards` | queda en el piso hasta reiniciar (R) |

Las acciones de un solo disparo (piña, patada, esquive, muerte) las avanza
`PlayerController` a paso fijo (`actionClipTime`) y la animación sólo muestra
ese instante: el estado es reproducible en un servidor. El desplazamiento del
hueso raíz de esos clips se mide al cargar (curva en metros), se quita del clip
y el controlador lo aplica como velocidad, así el esquive o el paso del
rodillazo respetan las colisiones. Las ventanas (`start`/`end`/`speed`/`hit`)
están en `config.actions` y se ajustan en vivo en el panel de debug.

Controles: **clic izq.** (con el mouse capturado) o **Q** dispara, **F** piña,
**V** patada, **C** esquivar, **K** morir (prueba), **R** reiniciar. En
celulares: botones FUEGO (mantener), PIÑA, PATADA y ESQUIVAR.

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

El collider de Marble tiene ~1 m de resolución y errores alrededor de los
objetos: los canteros eran montículos de ~12° (se caminaban por encima), el
colectivo una meseta de 1,35 m y un árbol un montículo de 5 m de ancho. Se
corrigen en Blender:

### Correcciones en Blender

Fuente de verdad: `assets-src/collider-fixes.json` (legible, con diffs en git).
Cada corrección es `box` (volumen), `cylinder` (tronco/poste) o `ground` (sólo
piso plano, para borrar artefactos). La exportación **corta** la malla de Marble
en el borde de cada zona (huella + 1,5 m), borra lo de adentro y pone suelo plano
+ el volumen, sin dejar agujeros.

Hoy: colectivo (13,4 × 2,9 × 3,4 m), un árbol (r 0,5 m), 6 canteros (0,6 m de
alto: no se suben caminando, sí saltando) y 2 parches de suelo alrededor del
colectivo. Medidas tomadas del splat (vista cenital + franja de alturas del
cuerpo) y revisadas una por una.

```bash
npm run analyze:props     # referencias: vista cenital, alturas, grilla de suelo (assets-src/reference/)
npm run collider:base     # collider de Marble horneado y recortado → assets-src/collider_base.glb
npm run collider:rebuild  # JSON → escena de Blender (assets-src/colisiones.blend) → collider publicado
npm run collider:export   # .blend editado → JSON + assets-src/collider_refined.glb → publicado
```

Para editar a mano: abrir `assets-src/colisiones.blend`, mover / rotar / escalar
los objetos de la colección **Correcciones** (en modo objeto: la escala es largo
× ancho × alto), guardar y correr `npm run collider:export`. Con el MCP de
Blender también se pueden correr `scripts/blender/collider_setup.py` y
`collider_export.py` dentro de la sesión abierta (definiendo `ROOT`). El GLB se
escribe directamente desde Python: el exportador glTF de Blender, llamado desde
el temporizador del addon MCP, cerró Blender en una prueba.

### Modelos 3D de la plaza (Blender)

Sobre el splat hay **108 objetos modelados en Blender** (44 assets, ~233 k
triángulos, 76 llamadas de dibujo, costo de render despreciable; GLB de 7,9 MB): Casa Rosada,
Cabildo, Pirámide de Mayo con su reja, 6 palmeras, 9 árboles, el colectivo 64,
3 autos abandonados, 20 faroles (triples, simples y altos), bancos, cajones de
madera y militares, barreras jersey y rojiblancas, vallas, tachos, bebedero,
bolardos, kiosco de diarios, boca de subte, reloj, mástil con bandera y 15
canteros con arbustos nevados.

- **Ubicación sacada del splat.** Las fachadas se midieron por franjas (la Casa
  Rosada de Marble es curva: sigue esa línea con módulos de 3,7 m), los troncos
  y faroles con un detector de postes delgados, el resto con la franja de
  obstáculos de `analyze:props` y vistas del juego con una grilla rotulada. Cada
  objeto se apoya en el suelo estimado del splat.
- **Recorte del splat.** Cada asset declara volúmenes (caja/cilindro/esfera) que
  borran el splat donde ahora hay un modelo (`SplatEdit` de Spark, opacidad 0):
  no se ve el objeto doble. Los recortes nunca bajan del suelo. Se puede
  apagar en el panel (P → *Modelos 3D*).
- **Casa Rosada y Cabildo: invisibles.** Sus fachadas se ven mucho mejor en el
  splat, así que esos dos modelos sólo aportan colisión (`props.showBuildings:
  false`, sin recorte). En el panel se pueden mostrar para comparar.
- **Colisiones.** Cada asset declara primitivas de colisión; `PropSystem` las
  convierte en triángulos y `CollisionSystem.addStaticGeometry` las fusiona con
  el collider de Marble en un único BVH.
- **Instanciado.** `props.glb` trae un objeto por asset en el origen y
  `layout.json` las instancias: cada (asset, material) es un `InstancedMesh`.

Todo es geometría procedural en Python (`scripts/blender/props/`): `lib.py`
(constructor sobre bmesh, UV cúbicas a escala real, capas de nieve automáticas
sobre las caras que miran hacia arriba), `textures.py` (texturas procedurales
con numpy), `assets_small.py` y `assets_big.py` (los modelos) y `build.py`.

```bash
npm run props:build    # assets-src/props/layout.json → assets-src/props.blend → public/assets/props/
npm run props:export   # props.blend editado a mano → layout.json + GLB
```

Para mover, rotar, escalar o duplicar objetos: abrir `assets-src/props.blend`,
editar la colección **Instancias** (las mallas de la colección **Biblioteca**
son compartidas), guardar y correr `npm run props:export`; `layout.json` se
reescribe con las posiciones nuevas. O editar el JSON a mano (`face: [x, z]`
orienta el frente del objeto hacia un punto) y correr `npm run props:build`.
Desde el MCP de Blender, `build.py` sólo arma la escena (no exporta: el
exportador glTF desde el addon cerró Blender alguna vez):

```python
p = "/ruta/al/repo/scripts/blender/props/build.py"
exec(compile(open(p).read(), p, "exec"), {"__file__": p, "__name__": "__main__"})
```

**Texturas.** Las de `assets-src/props/textures_custom/` (versionadas) tienen
prioridad sobre las procedurales que el build regenera en
`assets-src/props/textures/`. Las actuales se generaron con FLUX 1.1 Pro en
Replicate (~US$ 0,04 c/u) a partir de
[`assets-src/props/PROMPTS_TEXTURAS.md`](assets-src/props/PROMPTS_TEXTURAS.md):

```bash
npm run textures:generate                      # las que falten (REPLICATE_API_TOKEN en .env.local)
node scripts/generate-textures.mjs --dry-run   # prompts y costo, sin llamar a la API
node scripts/generate-textures.mjs --force --seed=7 tejas   # regenerar una con otra variante
npm run textures:seamless && npm run props:build
```

`textures:seamless` (Blender sin interfaz) ecualiza la iluminación, hace
repetibles los bordes mezclando sólo una franja con la imagen corrida medio
tile, iguala el color medio al de la procedural (calibrada contra el splat: lo
que genera FLUX sale más claro y saturado que la plaza) y redimensiona. La chapa
del colectivo se compone con la chapa blanca oxidada (FLUX insistía en dibujar
un colectivo entero) y el obelisco usa la procedural. Para usar una textura
hecha a mano, guardala con el mismo nombre en `textures_custom/`.

### Cascarudos

El GLB del cascarudo (auto-rig "SmartRig", 57 huesos con nombres genéricos)
no trae animaciones: la locomoción es **procedural** (`CascarudoRig.ts`). Frente
del modelo = +Z (apéndices bucales), atrás la cola segmentada. Cadenas usadas:

| Parte | Huesos (base de cada cadena) |
|---|---|
| Patas izquierdas (delantera, media, trasera) | `Bone_046`, `Bone_056`, `Bone_036` |
| Patas derechas | `Bone_026`, `Bone_051`, `Bone_041` |
| Boca | `Bone_006`, `Bone_011`, `Bone_016`, `Bone_021` |
| Cola · cuerpo · raíz | `Bone_031` · `Bone_001` · `Bone_000` |

- **Marcha en trípode** como una cucaracha real: delantera y trasera de un lado
  + media del otro se mueven juntas. Cada pata gira en la cadera (avance y
  elevación) y pliega rodilla y tobillo en el aire. La fase avanza con la
  distancia recorrida / longitud de paso medida del rig, así las patas no patinan.
- Rotaciones en espacio del modelo convertidas al local de cada hueso desde la
  pose de reposo (`padre⁻¹ · Δ · padre · reposo`).
- Miden **3,6 m** (`enemies.scale` 2,1: el doble que el Eternauta). La marcha
  escala con el tamaño, así que a la misma velocidad dan pasos lentos y pesados;
  cada pata que apoya levanta nieve y, cerca, hace temblar la cámara.
- Extras: mandíbulas que mastican y muerden, cola que ondula, rebote/balanceo del
  cuerpo, sacudón al recibir balas, y muerte panza arriba con las patas encogidas
  que patalean y se apagan; a los `corpseTime` s el cadáver se hunde y aparece
  otro lejos del jugador. Los heridos chorrean y dejan rastro en la nieve.
- **Amenaza**: al detectarte se paran en dos patas (`alertTime`), mandíbulas
  abiertas y garras delanteras en alto; antes de cada mordida se vuelven a erguir
  y caen con todo el peso. La altura de la raíz al erguirse está medida para que
  las patas medias y traseras sigan apoyadas.
- IA a paso fijo (30 Hz) sólo contra la malla de colisiones: deambula → alerta →
  persigue (o directo al recibir un tiro) → muerde (`attackDamage` cada
  `attackInterval` s) → muere. Al perseguir, cada 0,35 s sondea rumbos alrededor
  de la dirección al jugador (0°, ±30°, ±60°…) y toma el primero transitable; si
  en 2 s no se acercó, prueba un rodeo amplio. No sube escalones > 0,45 m ni
  pendientes > 35° (subidos a un cantero quedarían metidos en los arbustos del
  splat, que los tapan). El cilindro físico (0,45 × escala) es más chico que el
  cuerpo visual para que entren entre los canteros. Aparecen al azar por todo el
  mapa, al nivel del piso de la plaza y a ≥ `spawnMinDistance`.
- El mapa de metal del caparazón es casi cromo: con el `RoomEnvironment` de la
  escena se veían plateados, así que usan su propio envMap atenuado (0,08).
- Todo se ajusta en `config.enemies`, `config.weapon`, `config.player` y
  `config.effects` (color de la hemolinfa, duración de las manchas, temblor de
  pisadas, retroceso).

### Efectos de combate (`Effects.ts`)

Sin assets: texturas dibujadas en canvas al iniciar, pools fijos (cero
asignaciones por disparo) y un draw call por sistema.

- **Partículas por shader** (quads instanciados): miran a la cámara y se
  *estiran en la dirección de su velocidad en pantalla* (desenfoque de
  movimiento), así las gotas en vuelo son chorros y las chispas, rayas. Cada
  ráfaga recibe la altura del suelo bajo el impacto: las gotas que caen dejan
  manchas, las vainas y esquirlas rebotan.
- **Disparo**: fogonazo de 1-2 frames con estrella frontal (forma y giro al azar)
  + llama lateral alineada al cañón + luz cálida breve; chispas de pólvora, humo
  que se expande y sube, vaina que sale a la derecha y rebota, trazadora de ~4 m
  a 350 m/s y retroceso de cámara que se recupera solo.
- **Hemolinfa**: spray de gotas con tamaños sesgados (muchas finas, pocas
  gruesas) que salen de la herida empujadas por la bala, un chorro denso a
  presión, niebla pulverizada y esquirlas de caparazón. Al morir, borbotón,
  esquirlas y un charco que se expande lento bajo el cadáver.
- **Escenario**: en el suelo, nieve pulverizada, terrones y agujero; en paredes,
  polvo y chispas.
- Las manchas (gotas, charcos, agujeros) se proyectan planas sobre el suelo y se
  desvanecen a los `effects.decalLifetime` s (pool de 320).
- Ojo con el *winding*: el quad de cada partícula se arma con (perp, eje) y debe
  ser una rotación, no un reflejo, o queda de espaldas y no se dibuja.

### Sonido (`Audio.ts`)

No hay archivos de audio: al cargar, un `OfflineAudioContext` **sintetiza** 12
sonidos con 3 a 8 variantes cada uno (~120 ms en total) y el juego sólo
reproduce buffers. El `AudioContext` se crea con el clic en ENTRAR (política de
autoplay). `M` silencia.

| Sonido | Cuándo | Cómo se sintetiza |
|---|---|---|
| Disparo | cada tiro | chasquido supersónico + estampido que se oscurece + golpe grave + cerrojo + 3 ecos de fachada paneados |
| Chillido | el cascarudo te detecta y se yergue | 2 sierras + subarmónico con vibrato rápido, saturadas, por 3 formantes móviles + raspado de ruido modulado (estridulación) + grave |
| Alarido | recibe un balazo (máx. 1 cada 0,7 s por bicho) | la misma voz, corta y aguda |
| Agonía | muere | alarido que cae a 110 Hz con vibrato que se apaga + gorgoteo de burbujas |
| Siseo | se yergue para morder | ruido agudo pulsado y creciente, como la cucaracha silbadora de Madagascar |
| Mordida | cierra las mandíbulas | chasquido + crujido de quitina + chapoteo |
| Castañeteo | al azar, cerca, deambulando o persiguiendo | clicks de mandíbula que se aceleran + ronroneo grave |
| Pisada de bestia | cada trípode que apoya | golpe de 75→34 Hz + nieve compactándose (granos) + uña de quitina |
| Pisada del Eternauta | cada zancada y al caer de un salto | crujido corto de nieve |
| Impacto | bala en cascarudo / en el escenario | quitina + golpe húmedo + gotas / golpe sordo + esquirlas |
| Viento | ambiente, en loop | ruido con ráfagas y silbido en cornisas, estéreo, loop sin costura |

- Posicional con HRTF: el oyente es la cámara; las voces de los cascarudos
  siguen al bicho mientras suenan. Lejos se apagan los agudos (aire, nieve que
  cae) y crece el envío a la reverb (eco de la plaza: respuesta al impulso
  generada con reflexiones tempranas y cola de 2,3 s).
- **Banda sonora**: "Bandoneón Lejos", original del proyecto. Se reproduce en
  streaming (un `<audio>` conectado al mezclador, sin reverb), con fade-in de
  6 s al entrar; al terminar quedan `audio.musicPause` s de viento y vuelve a
  empezar. Se baja durante la carga (sólo el formato que el navegador puede
  reproducir: WebM/Opus, o AAC en Safari) y se silencia con `M` o al pasar la
  pestaña a segundo plano. Volumen en `audio.musicVolume`.
- Máximo 28 voces; si no hay lugar, se corta la más vieja de menor prioridad
  (las pisadas ceden antes que los disparos o chillidos).
- Volúmenes en `config.audio`. Para usar grabaciones reales en lugar de la
  síntesis: `config.assets.audioSamples`, p. ej.
  `{ gunshot: [asset("assets/audio/fal-1.ogg"), asset("assets/audio/fal-2.ogg")] }`.

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

  (mapas de rugosidad/metalicidad a 1024 px y los clips extraídos a
  `animations/*.json`: `Running` del FBX fusionado y los 7 FBX sueltos de
  `assets-src/animations/` → ~880 KB en total en lugar de ~200 MB. Las pistas
  constantes se guardan con una sola key).
- `.env` define `VITE_SITE_URL`, usada por la tarjeta de X/Open Graph
  (`public/og.jpg`, 1200×630). Si publicás un fork, cambiala.
- En celulares (sin mouse) o con ahorro de datos, el juego avisa el tamaño de la
  descarga y espera confirmación antes de bajar los assets.
- GitHub Pages tiene un límite flexible de 100 GB/mes (≈1.000 visitas a ~104 MB).
  Si el tráfico crece, el siguiente paso es servir `scene.spz` y el FBX desde
  Cloudflare R2 (sin costo de egreso) y apuntar `config.assets` ahí.

## Próximos pasos sugeridos

1. Seguir refinando el collider en Blender: los cajones al sur del colectivo
   (Marble los corre ~1–2 m), bancos y el resto de los canteros chicos.
2. Clips idle / jump desde Meshy o Mixamo con el mismo rig.
3. Precompilar el LoD a `.rad` para carga instantánea y streaming.
4. Estado de red: el controlador ya es determinista a paso fijo, base para
   predicción del lado del cliente + servidor autoritativo.
5. Combate: modelo de arma en la mano (hoy el fogonazo sale 55 cm delante de la
   mano derecha), grabaciones reales para reemplazar la síntesis (sobre todo el
   disparo) y oleadas.

## Licencias

Código: MIT. Spark (World Labs) es MIT. Los assets (FBX/SPZ) pertenecen a sus
autores y no se incluyen en el repositorio.

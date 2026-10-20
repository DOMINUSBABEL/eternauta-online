# Prompts para texturas de los modelos 3D

Las texturas actuales son procedurales (`scripts/blender/props/textures.py`).
Para reemplazar una: generala, guardala como `textures_custom/<nombre>.png`
(o `.jpg`) en esta carpeta y corré `npm run props:build`.

Reglas para todas (con FLUX conviene pedir explícitamente *material swatch filling the entire frame, no objects, no background*: si no, dibuja el objeto —un auto, un farol— en vez de la superficie):

- **Tileable / seamless** en los cuatro bordes, vista **frontal ortogonal**, sin
  perspectiva, sin sombras proyectadas ni luz direccional (luz difusa pareja).
- Cuadradas, **1024 × 1024** (2048 para las fachadas si querés más detalle).
- Sin texto ni logos (salvo donde se indica).
- Escala: el número entre paréntesis es cuántos metros cubre una repetición.

Sufijo común sugerido para pegar al final de cada prompt:

> seamless tileable texture, orthographic flat front view, even diffuse
> lighting, no shadows, no perspective, photorealistic, high detail, post-apocalyptic
> winter, light snow dust, Buenos Aires

## Edificios

| Archivo | Escala | Prompt |
|---|---|---|
| `rosada_estuco` | 4 m | Smooth weathered pink-salmon lime stucco wall of the Casa Rosada in Buenos Aires, color #c4816f, subtle hairline cracks, faint vertical grime streaks from rain, slightly faded paint |
| `rosada_buna` | 2 m | Rusticated ashlar base of a pink Italianate palace, horizontal deep channel joints every 0.4 m, pink-salmon stucco #b9776a, weathered, grime at the joints |
| `rosada_liso` | 3 m | Cream white painted stucco moulding surface, #ddc9b4, smooth with soft dirt and tiny cracks (for cornices, pilasters and window frames) |
| `cabildo_estuco` | 4 m | Whitewashed colonial lime plaster wall of the Buenos Aires Cabildo, warm white #d6d1c5, uneven hand-applied texture, light soot and rain streaks |
| `piedra_blanca` | 2 m | Flat wall of pale grey-white limestone ashlar blocks, regular horizontal courses about 0.5 m tall, thin joints, weathered, light lichen stains. Material swatch filling the entire frame, no monument, no sky, no background |
| `pizarra` | 2.5 m | Dark grey slate roof tiles of a French mansard roof, fish-scale pattern, wet, with snow accumulated in the gaps |
| `tejas` | 2 m | Spanish colonial terracotta barrel roof tiles (tejas coloniales), rows seen from above, faded red-brown, snow in the troughs |
| `granito` | 1.5 m | Grey granite paving/curb stone, speckled, worn, slightly wet, salt stains |

## Vehículos

| Archivo | Escala | Prompt |
|---|---|---|
| `bus_pintura` | 3,2 m (alto del colectivo) | **No tileable vertical**: flat side panel of an old Buenos Aires city bus seen straight on, filling the frame: upper 40 percent painted pale grey-white, then a thin dark navy horizontal stripe, lower half painted medium blue #3f6aa8, heavy rust blooms, dents, dirt splashes near the bottom edge, frost, riveted sheet metal, no windows, no wheels. Tileable only horizontally |
| `auto_blanco` | 1,6 m | Old white enamel paint on flat steel sheet, faded and chalky, scattered orange rust patches and rust drip streaks, fine scratches, light frost. Macro material swatch filling the entire frame, no objects, no background |
| `auto_gris` | 1,6 m | Abandoned dark gunmetal car paint, rust spots, scratches, dirty, frost |

## Mobiliario y barricadas

| Archivo | Escala | Prompt |
|---|---|---|
| `hierro` | 1 m | Close-up of a flat cast iron surface painted dark green-black, chipped paint, small rust spots. Macro material swatch filling the entire frame, no objects, no background |
| `madera_banco` | 1 m | Weathered varnished wooden bench slats, horizontal planks, brown, worn varnish, grey wood showing |
| `madera_caja` | 1,2 m | Rough pine planks of a wooden shipping crate, light brown, stenciled scuffs, nail heads, dirt |
| `verde_militar` | 1 m | Olive drab military ammo/supply crate painted metal, chipped paint, scratches, faded stencil marks (no readable text) |
| `hormigon` | 1,5 m | Precast concrete jersey barrier surface, grey, pitted, chipped edges, dirt and water stains |
| `franjas` | 1 m | Concrete surface painted with many repeating red and white diagonal hazard stripes, each stripe about 12 cm wide at 45 degrees, faded, chipped, dirty |
| `kiosco_verde` | 1 m | Close-up of a flat dark green painted sheet metal panel, scratches, small rust spots, slight dents. Macro material swatch filling the entire frame, no objects, no doors, no background |
| `revistas` | panel del kiosco | **No tileable**: front of a newspaper stand with rows of colorful magazine and newspaper covers, blurred unreadable titles, faded by snow and time |

## Vegetación y nieve

| Archivo | Escala | Prompt |
|---|---|---|
| `nieve` | 1 m | Fresh compact snow surface seen from above, slight blue-grey tint #d5dbe2, fine crystals, soft footprints-free |
| `arbusto` | 1 m | Dense dark green boxwood hedge foliage seen from above, small leaves, sprinkled with snow |
| `follaje` | 1 m | Dry brown-olive winter leaves clustered, dense, seen from above |
| `fronda` | 0,5 m | Macro close-up of dense overlapping dark green palm leaflets, glossy, filling the entire frame completely, no background visible, no white areas |
| `fronda_seca` | 0,5 m | Macro close-up of dense dry dead palm leaflets, straw brown, fibrous, filling the entire frame completely, no background visible |
| `corteza` | 1 m | Plane tree / tipa bark, dark grey-brown, vertical fissures, damp |
| `palma_tronco` | 1,4 m | Close-up of a Canary Island date palm trunk, overlapping diamond-shaped old leaf-base scars in a regular lattice, fibrous brown-grey bark. Macro material swatch filling the entire frame, no background |

## Varios

| Archivo | Prompt |
|---|---|
| `bandera` | Argentine flag (light blue / white / light blue with the golden Sun of May in the center), weathered fabric, 512 × 320, **no tileable** |
| `reloj` | Old street clock face, cream dial, black roman numerals, black hands at 10:10, round, centered, 256 × 256, **no tileable** |

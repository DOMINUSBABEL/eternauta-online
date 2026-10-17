/**
 * Configuración central del prototipo.
 *
 * Todo lo que depende de los assets (escala, orientación, suelo, límites)
 * vive acá para poder calibrarlo sin tocar la lógica. El panel de debug
 * (tecla º / F3) edita este mismo objeto en caliente y permite exportar
 * los valores como JSON para pegarlos de vuelta en este archivo.
 *
 * Unidades del mundo: metros. Eje Y hacia arriba (convención de Three.js).
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Caja alineada a ejes usada como obstáculo provisional. */
export interface BoxObstacle {
  name: string;
  min: Vec3Like;
  max: Vec3Like;
}

export interface GameConfig {
  assets: {
    characterUrl: string;
    /** Mapas PBR externos (el FBX los referencia pero FBXLoader no los soporta en Phong). */
    characterRoughnessUrl: string | null;
    characterMetalnessUrl: string | null;
    /**
     * Clips extra (FBX con el mismo rig Mixamo) para estados de animación.
     * `clip` elige por nombre dentro del FBX (si se omite, el primero).
     * Ej.: { state: "idle", url: "/assets/player/idle.fbx" }.
     */
    extraAnimations: { state: AnimationStateName; url: string; clip?: string }[];
    splatUrl: string;
    /** Malla de colisiones exportada desde Marble (GLB). null = colisiones provisionales. */
    collisionMeshUrl: string | null;
  };
  character: {
    /** Altura objetivo del protagonista en metros. */
    targetHeight: number;
    /** Multiplicador manual sobre la escala calculada automáticamente. */
    scaleMultiplier: number;
    /** Corrección de la orientación frontal del modelo (grados, eje Y). */
    forwardOffsetDeg: number;
    /** Desplazamiento vertical fino del modelo respecto del suelo (m). */
    yOffset: number;
    /** Oculta mallas estáticas sueltas (p. ej. la "Icosphere" que exporta Meshy). */
    hideAuxiliaryMeshes: boolean;
    /** Elimina la deriva horizontal del hueso raíz (evita root motion duplicado). */
    stripRootMotion: boolean;
    /** Velocidad (m/s) a la que el clip de caminata no patina. 0 = estimar del clip. */
    walkClipSpeed: number;
    /** Ídem para el clip de carrera. 0 = estimar del clip. */
    runClipSpeed: number;
    /** Tiempo de cruce entre estados de animación (s). */
    crossFade: number;
    castShadowBlob: boolean;
  };
  environment: {
    position: Vec3Like;
    /** Rotación del splat en grados (XYZ). */
    rotationDeg: Vec3Like;
    scale: number;
    /** Construye el LoD de Spark en un worker al cargar (recomendado para >1M splats). */
    lod: boolean;
    /** Centros en float32 (mejor precisión lejos del origen, algo más costoso). */
    extSplats: boolean;
    /** Multiplicador del presupuesto de splats del LoD (1 = default de plataforma). */
    lodSplatScale: number;
  };
  world: {
    /** Altura del suelo invisible en el origen (m). */
    groundHeight: number;
    /** Pendiente del suelo invisible (m de altura por m en X / Z). */
    groundSlopeX: number;
    groundSlopeZ: number;
    /** Límites jugables (rectángulo XZ). */
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    /** Por debajo de esta altura se reinicia al jugador (anti caída infinita). */
    killY: number;
    spawn: Vec3Like;
    /** Orientación inicial del jugador (grados, 0 = mirando hacia +Z). */
    spawnYawDeg: number;
    obstacles: BoxObstacle[];
  };
  movement: {
    walkSpeed: number;
    runSpeed: number;
    acceleration: number;
    deceleration: number;
    /** Fracción del control horizontal disponible en el aire. */
    airControl: number;
    gravity: number;
    jumpSpeed: number;
    /** Velocidad de giro del personaje hacia la dirección de marcha (rad/s aprox.). */
    turnSpeed: number;
    radius: number;
    /** Paso de simulación fijo (Hz). */
    tickRate: number;
    maxFallSpeed: number;
  };
  camera: {
    fov: number;
    distance: number;
    minDistance: number;
    maxDistance: number;
    /** Altura del pivote de órbita sobre los pies del jugador (m). */
    pivotHeight: number;
    /** Punto al que mira la cámara por encima del pivote: baja al personaje en pantalla. */
    lookAheadHeight: number;
    /** Desplazamiento lateral (hombro). 0 = centrado. */
    shoulderOffset: number;
    initialPitchDeg: number;
    minPitchDeg: number;
    maxPitchDeg: number;
    sensitivity: number;
    /** Rotación por px de arrastre táctil (rad/px). */
    touchSensitivity: number;
    /** En pantallas verticales se abre el FOV para no ver "por un tubo" (grados máx.). */
    portraitMaxFov: number;
    invertY: boolean;
    /** Rigidez del seguimiento de posición (1/s). */
    followStiffness: number;
    /** Rigidez de la rotación (1/s). */
    rotationStiffness: number;
    zoomStiffness: number;
    zoomStep: number;
    /** Distancia mínima de la cámara sobre el suelo (m). */
    minGroundClearance: number;
    near: number;
    far: number;
  };
  render: {
    /** Límite superior del devicePixelRatio. */
    maxPixelRatio: number;
    /** Escala de resolución interna (0.5 = mitad, look PS2). */
    renderScale: number;
    /** Escalado sin filtrado (pixelado) cuando renderScale < 1. */
    pixelated: boolean;
    exposure: number;
    background: string;
    filmGrain: boolean;
    vignette: boolean;
  };
  atmosphere: {
    snow: boolean;
    snowCount: number;
    /** Lado del volumen de nieve que acompaña a la cámara (m). */
    snowArea: number;
    snowFallSpeed: number;
    snowWind: Vec3Like;
    snowSize: number;
  };
}

export type AnimationStateName = "idle" | "walk" | "run" | "jump" | "fall";

/**
 * URL de un archivo de public/ relativa a la base del sitio, para que el
 * juego funcione tanto en la raíz como en una subcarpeta (GitHub Pages,
 * itch.io…). Con `base: "./"` en vite.config, BASE_URL es relativa.
 */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export const defaultConfig: GameConfig = {
  assets: {
    characterUrl: asset("assets/player/Meshy_AI_Blue_Wasteland_Sentin_biped_Animation_Walking_withSkin.fbx"),
    // Versiones 1024 px de los mapas 4096 originales (ver scripts/optimize-assets.sh).
    characterRoughnessUrl: asset("assets/player/texture_0_roughness_1k.png"),
    characterMetalnessUrl: asset("assets/player/texture_0_metallic_1k.png"),
    extraAnimations: [
      // Del FBX "Merged Animations" de Meshy sólo "Running" trae keyframes
      // reales (los otros 15 clips son una pose estática, ver README). Se
      // extrajo a JSON con `npm run extract:clip` para no descargar 17 MB.
      { state: "run", url: asset("assets/player/animations/running.json") },
    ],
    splatUrl: asset("assets/scene.spz"),
    collisionMeshUrl: null,
  },
  character: {
    targetHeight: 1.8,
    scaleMultiplier: 1,
    forwardOffsetDeg: 0,
    yOffset: 0,
    hideAuxiliaryMeshes: true,
    stripRootMotion: true,
    walkClipSpeed: 0,
    runClipSpeed: 0,
    crossFade: 0.2,
    castShadowBlob: true,
  },
  environment: {
    position: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: 1,
    lod: true,
    extSplats: false,
    lodSplatScale: 1,
  },
  world: {
    // Plano ajustado por mínimos cuadrados a la densidad de splats del suelo
    // (sólo para calibrar; en runtime no se consulta el splat). Residuo
    // mediano 0.15 m; hay una hondonada de ~0.4 m hacia x≈30, z≈10.
    groundHeight: -0.2,
    groundSlopeX: -0.003,
    groundSlopeZ: -0.0006,
    // Zona caminable de la plaza (los edificios quedan afuera).
    bounds: { minX: -42, maxX: 40, minZ: -50, maxZ: 28 },
    killY: -30,
    spawn: { x: 0, y: 0, z: 0 },
    spawnYawDeg: 0,
    obstacles: [],
  },
  movement: {
    walkSpeed: 1.7,
    runSpeed: 4.6,
    acceleration: 12,
    deceleration: 14,
    airControl: 0.35,
    gravity: 22,
    jumpSpeed: 6.2,
    turnSpeed: 10,
    radius: 0.35,
    tickRate: 120,
    maxFallSpeed: 40,
  },
  camera: {
    fov: 55,
    distance: 4.2,
    minDistance: 1.6,
    maxDistance: 12,
    pivotHeight: 1.55,
    lookAheadHeight: 0.35,
    shoulderOffset: 0,
    initialPitchDeg: 12,
    minPitchDeg: -35,
    maxPitchDeg: 70,
    sensitivity: 0.0022,
    touchSensitivity: 0.0085,
    portraitMaxFov: 85,
    invertY: false,
    followStiffness: 12,
    rotationStiffness: 22,
    zoomStiffness: 10,
    zoomStep: 0.6,
    minGroundClearance: 0.3,
    near: 0.05,
    far: 4000,
  },
  render: {
    maxPixelRatio: 1.5,
    renderScale: 1,
    pixelated: false,
    exposure: 1,
    background: "#b9c0c6",
    filmGrain: true,
    vignette: true,
  },
  atmosphere: {
    snow: true,
    snowCount: 5000,
    snowArea: 36,
    snowFallSpeed: 1.1,
    snowWind: { x: 0.35, y: 0, z: 0.15 },
    snowSize: 0.045,
  },
};

/**
 * Ajustes para celulares y tablets: menos píxeles, menos partículas y sin
 * efectos de composición CSS (grano/filtros), que en GPUs móviles cuestan.
 * Spark ya reduce por su cuenta el presupuesto de splats del LoD en móviles.
 */
export function applyMobileProfile(config: GameConfig): void {
  config.render.maxPixelRatio = Math.min(config.render.maxPixelRatio, 1.25);
  config.render.filmGrain = false;
  config.atmosphere.snowCount = Math.min(config.atmosphere.snowCount, 2500);
  config.camera.distance = Math.max(config.camera.distance, 4.6);
}

const STORAGE_KEY = "eternauta.config.v1";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mezcla profunda: sólo copia claves que existen en `target` y con el mismo tipo. */
export function mergeInto<T>(target: T, source: unknown): T {
  if (!isPlainObject(source) || !isPlainObject(target)) return target;
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(source)) {
    if (!(key in t)) continue;
    const current = t[key];
    if (isPlainObject(current)) mergeInto(current, value);
    else if (Array.isArray(current) && Array.isArray(value)) t[key] = structuredClone(value);
    else if (current === null || typeof current === typeof value) t[key] = value;
  }
  return target;
}

/** Carga la config por defecto + overrides guardados por el panel de debug. */
export function loadConfig(): GameConfig {
  const config = structuredClone(defaultConfig);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Las rutas de assets las define el código, no la calibración guardada.
      const { assets: _ignored, ...rest } = JSON.parse(saved) as Record<string, unknown>;
      mergeInto(config, rest);
    }
  } catch {
    // localStorage puede no estar disponible (modo privado): seguimos con defaults.
  }
  // Overrides rápidos por URL: ?scale=1.2&renderScale=0.5
  const params = new URLSearchParams(location.search);
  const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
  const renderScale = num("renderScale");
  if (renderScale && renderScale > 0) config.render.renderScale = renderScale;
  const envScale = num("envScale");
  if (envScale && envScale > 0) config.environment.scale = envScale;
  if (params.get("lod") === "0") config.environment.lod = false;
  return config;
}

export function saveConfig(config: GameConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* sin persistencia disponible */
  }
}

export function clearSavedConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

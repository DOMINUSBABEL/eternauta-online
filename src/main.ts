/**
 * El Eternauta Online — punto de entrada.
 */

import "./style.css";
import { applyMobileProfile, loadConfig } from "./config";
import { Game } from "./Game";

const container = document.getElementById("app");
if (!container) throw new Error("Falta el contenedor #app");

function showFatal(message: string): void {
  const box = document.createElement("pre");
  box.className = "fatal";
  box.textContent = message;
  document.body.append(box);
}

/** Descarga aproximada del juego publicado (FBX 27,5 MB + SPZ 64,7 MB + extras). */
const APPROX_DOWNLOAD_MB = 93;

/** Celular/tablet sin mouse. */
function isTouchOnly(): boolean {
  return matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
}

function prefersSavingData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

if (!hasWebGL2()) {
  showFatal("Este navegador no soporta WebGL2, necesario para Spark (Gaussian splatting). Probá con Chrome actualizado.");
} else {
  const config = loadConfig();
  if (isTouchOnly()) applyMobileProfile(config);
  const game = new Game(container, config);
  game.start();

  const boot = async () => {
    // Desde X la mayoría abre el link en el teléfono: avisar antes de bajar ~90 MB.
    if (isTouchOnly()) {
      await game.hud.gate(
        `Descarga ~${APPROX_DOWNLOAD_MB} MB: mejor con WiFi. Se juega con controles táctiles, ` +
          `con el teléfono horizontal; en computadora se ve y se juega mejor.`,
        `CARGAR · ${APPROX_DOWNLOAD_MB} MB`,
      );
    } else if (prefersSavingData()) {
      await game.hud.gate(`Tenés activado el ahorro de datos. El juego descarga ~${APPROX_DOWNLOAD_MB} MB.`, `CARGAR · ${APPROX_DOWNLOAD_MB} MB`);
    }
    await game.load();
  };
  boot().catch((err) => {
    console.error(err);
    showFatal(`Error inesperado durante la carga:\n${(err as Error).message}`);
  });

  // Acceso desde la consola para depurar: window.game
  (window as unknown as { game: Game }).game = game;

  // Liberar GPU/workers al recargar en caliente o cerrar la pestaña.
  window.addEventListener("pagehide", () => game.dispose(), { once: true });
  if (import.meta.hot) {
    import.meta.hot.dispose(() => game.dispose());
  }
}

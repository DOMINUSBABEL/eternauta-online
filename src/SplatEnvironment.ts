/**
 * Escenario: Gaussian splat (.spz) de World Labs Marble renderizado con Spark.
 *
 * El SPZ es sólo apariencia visual. No contiene malla física: las colisiones
 * las resuelve CollisionSystem (suelo provisional o malla exportada aparte).
 *
 * API de Spark 2.x usada:
 *   - `SparkRenderer` (creado en World) debe estar en la escena.
 *   - `new SplatMesh({ url, lod, extSplats, onProgress })`
 *   - `await mesh.initialized` → decodificado (y LoD construido si `lod: true`).
 */

import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import type { GameConfig } from "./config";

const mb = (bytes: number) => (bytes / 1e6).toFixed(0);

export type SplatStatus = "pendiente" | "descargando" | "procesando" | "listo" | "error";

export class SplatEnvironment {
  mesh: SplatMesh | null = null;
  status: SplatStatus = "pendiente";
  /** Progreso de descarga en [0, 1]. */
  progress = 0;
  error: string | null = null;
  numSplats = 0;
  fileBytes = 0;
  downloadMs = 0;
  processMs = 0;
  /** Splats que Spark está dibujando ahora (presupuesto LoD); lo provee World. */
  activeSplats: () => number = () => this.numSplats;
  onStatusChange?: (env: SplatEnvironment) => void;

  constructor(
    private readonly config: GameConfig,
    private readonly scene: THREE.Scene,
  ) {}

  get statusLabel(): string {
    switch (this.status) {
      case "pendiente":
        return "pendiente";
      case "descargando":
        return this.fileBytes
          ? `descargando ${mb(this.progress * this.fileBytes)} / ${mb(this.fileBytes)} MB`
          : `descargando ${(this.progress * 100).toFixed(0)}%`;
      case "procesando":
        return this.config.environment.lod ? "decodificando + construyendo LoD…" : "decodificando…";
      case "listo":
        return `listo · ${(this.activeSplats() / 1e6).toFixed(2)} M visibles / ${(this.numSplats / 1e6).toFixed(2)} M`;
      case "error":
        return `ERROR · ${this.error}`;
    }
  }

  private setStatus(status: SplatStatus): void {
    this.status = status;
    this.onStatusChange?.(this);
  }

  async load(): Promise<void> {
    const { splatUrl } = this.config.assets;
    const env = this.config.environment;
    const t0 = performance.now();
    this.setStatus("descargando");

    try {
      // Comprobación previa: error claro si el archivo no existe o el servidor
      // devuelve HTML (fallback SPA) en lugar del binario.
      const head = await fetch(splatUrl, { method: "HEAD" });
      if (!head.ok) throw new Error(`HTTP ${head.status} al pedir ${splatUrl}`);
      const type = head.headers.get("content-type") ?? "";
      if (type.includes("text/html")) throw new Error(`${splatUrl} devolvió HTML: ¿falta el archivo en public/?`);
      this.fileBytes = Number(head.headers.get("content-length") ?? 0);

      let downloaded = false;
      const mesh = new SplatMesh({
        url: splatUrl,
        lod: env.lod,
        extSplats: env.extSplats,
        onProgress: (e: ProgressEvent) => {
          const total = e.total || this.fileBytes;
          if (total) this.progress = Math.min(1, e.loaded / total);
          if (this.progress >= 1 && !downloaded) {
            downloaded = true;
            this.downloadMs = performance.now() - t0;
            this.setStatus("procesando");
          } else {
            this.onStatusChange?.(this);
          }
        },
      });
      mesh.name = "plaza-de-mayo-splat";
      this.mesh = mesh;
      this.applyTransform();
      this.scene.add(mesh);

      await mesh.initialized;
      if (!downloaded) this.downloadMs = performance.now() - t0;
      this.processMs = performance.now() - t0 - this.downloadMs;
      // Con LoD, el total vive en el árbol LoD (incluye nodos internos);
      // mesh.numSplats pasa a ser el presupuesto activo.
      this.numSplats = mesh.packedSplats?.lodSplats?.numSplats || mesh.extSplats?.lodSplats?.numSplats || mesh.numSplats;
      this.progress = 1;
      this.setStatus("listo");
      console.info(
        `[Splat] ${splatUrl}: ${this.numSplats} splats, descarga ${(this.downloadMs / 1000).toFixed(1)} s, ` +
          `procesado ${(this.processMs / 1000).toFixed(1)} s (lod=${env.lod}, extSplats=${env.extSplats})`,
      );
    } catch (err) {
      this.error = (err as Error)?.message ?? String(err);
      console.error("[Splat] error de carga", err);
      this.setStatus("error");
      throw err;
    }
  }

  /** Aplica posición / rotación / escala de la config al splat. */
  applyTransform(): void {
    if (!this.mesh) return;
    const env = this.config.environment;
    this.mesh.position.set(env.position.x, env.position.y, env.position.z);
    this.mesh.rotation.set(
      THREE.MathUtils.degToRad(env.rotationDeg.x),
      THREE.MathUtils.degToRad(env.rotationDeg.y),
      THREE.MathUtils.degToRad(env.rotationDeg.z),
    );
    this.mesh.scale.setScalar(env.scale);
    this.mesh.updateMatrixWorld(true);
  }

  /** Matriz mundo ← splat (compartida con la malla de colisiones de Marble). */
  get matrix(): THREE.Matrix4 {
    const env = this.config.environment;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(env.position.x, env.position.y, env.position.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(env.rotationDeg.x),
          THREE.MathUtils.degToRad(env.rotationDeg.y),
          THREE.MathUtils.degToRad(env.rotationDeg.z),
        ),
      ),
      new THREE.Vector3().setScalar(env.scale),
    );
  }

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = null;
  }
}

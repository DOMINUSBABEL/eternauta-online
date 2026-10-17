/**
 * Escena, renderer, luces y atmósfera.
 *
 * El renderer se crea con antialias: false como recomienda Spark (el MSAA no
 * mejora los splats y cuesta mucho). La resolución interna se controla con
 * `render.maxPixelRatio` y `render.renderScale`.
 */

import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GameConfig } from "./config";
import { Snowfall } from "./Snowfall";

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly spark: SparkRenderer;
  readonly snow: Snowfall;
  private readonly envTexture: THREE.Texture;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly config: GameConfig,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = "game-canvas";
    container.appendChild(this.renderer.domElement);

    const c = config.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, 1, c.near, c.far);
    this.scene.background = new THREE.Color(config.render.background);

    // Spark: un único SparkRenderer en la escena compone todos los splats.
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.spark.name = "spark-renderer";
    this.scene.add(this.spark);

    // Luz de día nublado y nevado: fría, difusa, de arriba.
    this.hemi = new THREE.HemisphereLight(0xd4dde6, 0x4b4744, 1.6);
    this.sun = new THREE.DirectionalLight(0xe8eef5, 1.4);
    this.sun.position.set(-6, 12, 4);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // Reflejos suaves para el material PBR del personaje.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.45;

    this.snow = new Snowfall(config);
    this.scene.add(this.snow.points);

    this.applyRenderSettings();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** Pixel ratio efectivo = min(devicePixelRatio, maxPixelRatio) × renderScale. */
  get pixelRatio(): number {
    const r = this.config.render;
    return Math.min(window.devicePixelRatio || 1, r.maxPixelRatio) * r.renderScale;
  }

  applyRenderSettings(): void {
    const r = this.config.render;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMappingExposure = r.exposure;
    (this.scene.background as THREE.Color).set(r.background);
    this.renderer.domElement.classList.toggle("pixelated", r.pixelated && r.renderScale < 1);
    this.camera.fov = this.config.camera.fov;
    this.camera.near = this.config.camera.near;
    this.camera.far = this.config.camera.far;
    this.spark.lodSplatScale = this.config.environment.lodSplatScale;
    this.resize();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, true);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Vertical (celular parado): abrir el FOV para conservar campo horizontal.
    const base = this.config.camera.fov;
    this.camera.fov = aspect < 1 ? Math.min(Math.max(base, this.config.camera.portraitMaxFov), base / Math.sqrt(aspect)) : base;
    this.camera.updateProjectionMatrix();
  }

  get isPortrait(): boolean {
    return this.camera.aspect < 1;
  }

  /** Mantiene la luz direccional centrada en el jugador. */
  followLight(target: THREE.Vector3): void {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - 6, target.y + 12, target.z + 4);
  }

  update(time: number): void {
    this.snow.update(time, this.camera, this.renderer.domElement.height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.snow.dispose();
    this.envTexture.dispose();
    this.scene.remove(this.spark);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * Orquestador: crea los sistemas, carga los assets en paralelo y corre el
 * bucle principal (simulación a paso fijo + render interpolado).
 */

import * as THREE from "three";
import { Character } from "./Character";
import { CollisionDebugView, CollisionSystem } from "./CollisionSystem";
import type { GameConfig } from "./config";
import { DebugPanel } from "./DebugPanel";
import { Hud } from "./Hud";
import { InputManager } from "./InputManager";
import { PlayerController } from "./PlayerController";
import { SplatEnvironment } from "./SplatEnvironment";
import { ThirdPersonCamera } from "./ThirdPersonCamera";
import { TouchControls, isTouchPrimary } from "./TouchControls";
import { World } from "./World";

const MAX_TICKS_PER_FRAME = 12;

export class Game {
  readonly world: World;
  readonly input: InputManager;
  readonly collision: CollisionSystem;
  readonly player: PlayerController;
  readonly character: Character;
  readonly environment: SplatEnvironment;
  readonly camera: ThirdPersonCamera;
  readonly hud: Hud;
  readonly debug: DebugPanel;
  private readonly collisionView: CollisionDebugView;
  readonly touch: TouchControls;
  /** Controles táctiles activos (celular/tablet, o primer toque en pantalla táctil). */
  private touchMode = isTouchPrimary();

  private running = false;
  private playing = false;
  private characterReady = false;
  private lastTime = 0;
  private accumulator = 0;
  private elapsed = 0;
  private pendingJump = false;
  private pointerLockErrorShown = false;
  private readonly renderPos = new THREE.Vector3();
  private frameCount = 0;
  private fpsTime = 0;
  private fps = 0;
  private frameMs = 0;
  private ticksLastFrame = 0;
  private statsTimer = 0;

  constructor(
    private readonly container: HTMLElement,
    readonly config: GameConfig,
  ) {
    this.world = new World(container, config);
    this.input = new InputManager(this.world.renderer.domElement);
    this.collision = new CollisionSystem(config);
    this.player = new PlayerController(config, this.collision);
    this.character = new Character(config);
    this.environment = new SplatEnvironment(config, this.world.scene);
    this.environment.activeSplats = () => this.world.spark.activeSplats;
    this.camera = new ThirdPersonCamera(this.world.camera, config, this.collision);
    this.hud = new Hud(container);
    this.hud.applyEffects(config);
    this.collisionView = new CollisionDebugView(config);
    this.world.scene.add(this.collisionView.group, this.character.shadowBlob);

    this.player.height = config.character.targetHeight * config.character.scaleMultiplier;
    this.player.onReset = () => this.camera.snapBehind(this.player.position, this.player.yaw);
    this.camera.snapBehind(this.player.position, this.player.yaw);

    this.debug = new DebugPanel(config, {
      onCharacterChange: () => {
        this.character.applyCalibration();
        this.player.height = config.character.targetHeight * config.character.scaleMultiplier;
      },
      onEnvironmentChange: () => {
        this.environment.applyTransform();
        this.collision.updateEnvironmentTransform(this.environment.matrix);
      },
      onRenderChange: () => {
        this.world.applyRenderSettings();
        this.hud.applyEffects(config);
      },
      onSpawnHere: () => {
        const p = this.player.position;
        config.world.spawn = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
        config.world.spawnYawDeg = Math.round(THREE.MathUtils.radToDeg(this.player.yaw));
      },
      onTeleportSpawn: () => this.player.reset(),
      onAddObstacleHere: () => {
        const p = this.player.position;
        const f = { x: Math.sin(this.player.yaw) * 1.5, z: Math.cos(this.player.yaw) * 1.5 };
        config.world.obstacles.push({
          name: `caja ${config.world.obstacles.length + 1}`,
          min: { x: p.x + f.x - 0.5, y: p.y, z: p.z + f.z - 0.5 },
          max: { x: p.x + f.x + 0.5, y: p.y + 1, z: p.z + f.z + 0.5 },
        });
      },
      setCollisionDebug: (v) => (this.collisionView.group.visible = v),
      setSplatVisible: (v) => this.environment.setVisible(v),
      characterInfo: () => this.characterInfo(),
    });

    this.hud.onEnter = () => this.enter();

    this.touch = new TouchControls(container, this.input, config);
    if (this.touchMode) this.hud.setTouchHelp();
    // Laptops con pantalla táctil: pasar a controles táctiles al primer toque.
    window.addEventListener("pointerdown", this.handleFirstTouch);

    // Aviso de captura del mouse: transitorio, nunca fijo en pantalla.
    this.input.onPointerLockChange = (locked) => {
      if (!this.playing) return;
      if (locked) this.hud.hideHint();
      else this.hud.showHint("CLICK PARA CAPTURAR EL MOUSE · O ARRASTRÁ PARA ROTAR");
    };
    this.input.onPointerLockError = () => {
      // Sólo una vez, y no si el jugador ya está arrastrando (encontró la alternativa).
      if (!this.playing || this.touchMode || this.pointerLockErrorShown || this.input.isDragging) return;
      this.pointerLockErrorShown = true;
      this.hud.showHint("SIN CAPTURA DE MOUSE · ARRASTRÁ PARA ROTAR LA CÁMARA", 3500);
    };
    this.input.onDragStart = () => this.hud.hideHint();
  }

  /** Carga personaje, escenario y (opcional) malla de colisiones en paralelo. */
  async load(): Promise<void> {
    this.hud.setLoad("fbx", 0, "0%");
    this.hud.setLoad("spz", 0, "0%");

    const characterTask = this.character
      .load((loaded, total) =>
        this.hud.setLoad("fbx", loaded / total, `${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`),
      )
      .then((report) => {
        this.world.scene.add(this.character.root);
        this.characterReady = true;
        this.debug.refreshInfo();
        this.hud.setLoad("fbx", 1, `listo · ${report.bones} huesos · ${report.clips.length} clip(s)`, "done");
        console.groupCollapsed("[Character] Reporte del FBX");
        console.info(report);
        for (const w of report.warnings) console.warn("[Character]", w);
        console.groupEnd();
      })
      .catch((err: Error) => {
        console.error("[Character] error de carga", err);
        this.hud.setLoad("fbx", 1, "error", "error");
        this.hud.showError(`No se pudo cargar el protagonista (FBX): ${err.message}`);
      });

    this.environment.onStatusChange = (env) => {
      const state = env.status === "listo" ? "done" : env.status === "error" ? "error" : "loading";
      this.hud.setLoad("spz", env.progress, env.statusLabel, state);
    };
    const splatTask = this.environment.load().catch((err: Error) => {
      this.hud.showError(`No se pudo cargar el escenario (SPZ): ${err.message}`);
    });

    const tasks: Promise<unknown>[] = [characterTask, splatTask];
    const meshUrl = this.config.assets.collisionMeshUrl;
    if (meshUrl) tasks.push(this.collision.loadMesh(meshUrl, this.environment.matrix));

    await Promise.all(tasks);
    // El suelo puede haber cambiado con la malla de colisiones.
    this.player.reset();

    if (!this.characterReady) {
      this.hud.setReady("NO SE PUDO CARGAR EL PROTAGONISTA", false);
    } else if (this.environment.status === "error") {
      this.hud.setReady("ENTRAR AL MUNDO (SIN ESCENARIO)", true);
    } else {
      this.hud.setReady("ENTRAR AL MUNDO", true);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.world.renderer.setAnimationLoop((t) => this.frame(t));
  }

  enter(): void {
    if (!this.characterReady || this.playing) return;
    this.playing = true;
    this.hud.hideStart();
    this.input.enabled = true;
    if (this.touchMode) {
      this.touch.show();
      this.enterFullscreen();
      if (this.world.isPortrait) this.hud.showHint("GIRÁ EL TELÉFONO PARA VER MÁS", 3500);
    } else {
      this.input.requestPointerLock();
    }
    this.player.reset();
  }

  /** Pantalla completa + horizontal en móviles (donde el navegador lo permite; iPhone no). */
  private enterFullscreen(): void {
    const root = document.documentElement;
    if (!root.requestFullscreen || document.fullscreenElement) return;
    root
      .requestFullscreen({ navigationUI: "hide" })
      .then(() => {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return orientation.lock?.("landscape");
      })
      .catch(() => undefined);
  }

  private readonly handleFirstTouch = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || this.touchMode) return;
    this.touchMode = true;
    this.hud.setTouchHelp();
    this.input.exitPointerLock();
    if (this.playing) this.touch.show();
  };

  private frame(now: number): void {
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;
    this.elapsed += frameDt;
    this.measureFps(frameDt);

    // --- Entrada -----------------------------------------------------------------
    if (this.input.consume("toggleDebug")) this.debug.toggle();
    if (this.playing) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.camera.handleInput(dx, dy, this.input.consumeWheel());
      if (this.input.consume("reset")) this.player.reset();
      if (this.input.consume("jump")) this.pendingJump = true;
    } else {
      // Pantalla inicial: órbita lenta alrededor del protagonista.
      this.camera.yaw += frameDt * 0.12;
    }

    // --- Simulación a paso fijo ---------------------------------------------------
    const step = 1 / this.config.movement.tickRate;
    this.accumulator += frameDt;
    let ticks = 0;
    while (this.accumulator >= step && ticks < MAX_TICKS_PER_FRAME) {
      const axis = this.input.moveAxis();
      this.player.fixedUpdate(step, {
        moveX: axis.x,
        moveY: axis.y,
        run: this.input.running,
        jump: this.pendingJump,
        cameraYaw: this.camera.movementYaw,
      });
      this.pendingJump = false;
      this.accumulator -= step;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.accumulator = 0; // evita la espiral de la muerte
    this.ticksLastFrame = ticks;
    const alpha = this.accumulator / step;

    // --- Render interpolado ----------------------------------------------------------
    const pos = this.player.interpolatedPosition(alpha, this.renderPos);
    if (this.characterReady) {
      this.character.setTransform(pos, this.player.interpolatedYaw(alpha));
      this.character.update(frameDt, this.player.state, this.player.horizontalSpeed);
      const ground = this.collision.groundHeight(pos.x, pos.z, pos.y) ?? pos.y;
      this.character.updateShadow(pos, ground);
    }
    this.camera.update(frameDt, pos);
    this.world.followLight(pos);
    this.world.update(this.elapsed);
    this.collisionView.update(pos);
    this.world.render();

    // --- UI --------------------------------------------------------------------------
    this.statsTimer += frameDt;
    if (this.statsTimer > 0.2) {
      this.statsTimer = 0;
      this.updateUi();
    }
  }

  private measureFps(dt: number): void {
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameMs = (this.fpsTime / this.frameCount) * 1000;
      this.frameCount = 0;
      this.fpsTime = 0;
    }
  }

  private updateUi(): void {
    const env = this.environment;
    this.hud.update({
      fps: this.fps,
      frameMs: this.frameMs,
      position: this.player.position,
      animation: this.characterReady ? this.character.animationLabel : "—",
      splat: env.statusLabel,
      splatError: env.status === "error",
      collision: this.collision.status,
    });
    const info = this.world.renderer.info;
    const canvas = this.world.renderer.domElement;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    Object.assign(this.debug.stats, {
      fps: +this.fps.toFixed(1),
      frameMs: +this.frameMs.toFixed(2),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      pixelRatio: +this.world.pixelRatio.toFixed(2),
      resolution: `${canvas.width}×${canvas.height}`,
      splats: `${(this.world.spark.activeSplats / 1e6).toFixed(2)} M activos / ${(env.numSplats / 1e6).toFixed(2)} M (LoD)`,
      ticks: this.ticksLastFrame,
      memory: mem ? `${(mem.usedJSHeapSize / 1e6).toFixed(0)} MB JS` : "n/d",
    });
    this.debug.updateStats();
  }

  private characterInfo(): Record<string, string | number> {
    const r = this.character.report;
    if (!r) return { estado: "sin cargar" };
    const s = r.originalSize;
    return {
      "tamaño original": `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)}`,
      "escala auto": +r.autoScale.toFixed(5),
      "frente auto (°)": +r.autoForwardDeg.toFixed(1),
      "método frente": r.forwardMethod,
      "offset suelo": +r.groundOffset.toFixed(4),
      "vel. clip walk (m/s)": +r.walkClipSpeed.toFixed(2),
      "vel. clip run (m/s)": r.missingStates.includes("run") ? "—" : +r.runClipSpeed.toFixed(2),
      "pose neutra (s)": +r.neutralPoseTime.toFixed(3),
      huesos: r.bones,
      clips: r.clips.filter((c) => c.assignedTo).map((c) => `${c.name.split("|").pop()}→${c.assignedTo}`).join(", "),
      "clips estáticos": r.clips.filter((c) => c.static).length,
      "faltan clips": r.missingStates.join(", ") || "ninguno",
    };
  }

  dispose(): void {
    this.world.renderer.setAnimationLoop(null);
    this.running = false;
    this.input.exitPointerLock();
    this.input.dispose();
    this.debug.dispose();
    window.removeEventListener("pointerdown", this.handleFirstTouch);
    this.touch.dispose();
    this.character.dispose();
    this.environment.dispose();
    this.collision.dispose();
    this.world.dispose();
    this.container.replaceChildren();
  }
}

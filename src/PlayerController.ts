/**
 * Controlador cinemático del jugador, independiente del renderizado.
 *
 * Corre a paso fijo (config.movement.tickRate) y expone un estado
 * interpolable para el render. No conoce Three.js más allá de Vector3:
 * la misma lógica puede correr en un servidor autoritativo en el futuro
 * multijugador.
 */

import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";
import type { GameConfig } from "./config";

export interface MoveIntent {
  /** Eje local de cámara: x = derecha, y = adelante, en [-1, 1]. */
  moveX: number;
  moveY: number;
  run: boolean;
  jump: boolean;
  /** Yaw horizontal de la cámara (rad). Adelante = (sin, 0, cos). */
  cameraYaw: number;
}

export type LocomotionState = "idle" | "walk" | "run" | "jump" | "fall";

const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
/** Distancia de "pegado" al suelo al bajar pendientes/escalones. */
const GROUND_SNAP = 0.35;
/** Fracción de la gravedad que empuja cuesta abajo en superficies no caminables. */
const SLIDE_FACTOR = 0.8;
/** Altura sobre el spawn desde la que se busca el suelo al reaparecer. */
const SPAWN_PROBE_HEIGHT = 2;

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export class PlayerController {
  readonly position = new THREE.Vector3();
  readonly previousPosition = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  previousYaw = 0;
  grounded = false;
  state: LocomotionState = "idle";
  /** Altura del cuerpo para colisiones (se sincroniza con el personaje). */
  height = 1.8;

  private coyote = 0;
  /** Parado sobre una superficie más empinada que maxSlopeDeg (se desliza). */
  private onSteepGround = false;
  private jumpBuffer = 0;
  private readonly wish = new THREE.Vector3();
  private readonly horizontal = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  /** Se dispara al reiniciar (R, caída al vacío) para que la cámara se recoloque. */
  onReset?: () => void;

  constructor(
    private readonly config: GameConfig,
    private readonly collision: CollisionSystem,
  ) {
    this.reset();
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  reset(): void {
    const { spawn, spawnYawDeg } = this.config.world;
    // Buscar el suelo desde poco por encima del spawn: con una malla real,
    // desde muy alto el rayo podría pegar en la copa de un árbol.
    const ground = this.collision.groundHeight(spawn.x, spawn.z, spawn.y + SPAWN_PROBE_HEIGHT);
    this.position.set(spawn.x, Math.max(spawn.y, ground ?? spawn.y), spawn.z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.yaw = this.previousYaw = THREE.MathUtils.degToRad(spawnYawDeg);
    this.grounded = ground !== null;
    this.state = "idle";
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.onReset?.();
  }

  fixedUpdate(dt: number, intent: MoveIntent): void {
    const m = this.config.movement;
    this.previousPosition.copy(this.position);
    this.previousYaw = this.yaw;

    // --- Dirección deseada relativa a la cámara ------------------------------
    const sin = Math.sin(intent.cameraYaw);
    const cos = Math.cos(intent.cameraYaw);
    // adelante = (sin, 0, cos); derecha = (-cos, 0, sin)
    this.wish.set(sin * intent.moveY - cos * intent.moveX, 0, cos * intent.moveY + sin * intent.moveX);
    const wishLen = Math.min(1, this.wish.length());
    if (wishLen > 1e-4) this.wish.normalize();

    const maxSpeed = intent.run ? m.runSpeed : m.walkSpeed;
    this.target.copy(this.wish).multiplyScalar(maxSpeed * wishLen);

    // --- Aceleración / desaceleración (independiente del frame rate) ---------
    this.horizontal.set(this.velocity.x, 0, this.velocity.z);
    const accelerating = wishLen > 1e-4;
    let rate = accelerating ? m.acceleration : m.deceleration;
    // En el aire o sobre una pendiente no caminable, el control es reducido.
    if (!this.grounded || this.onSteepGround) rate *= m.airControl;
    const maxDelta = rate * maxSpeed * dt;
    const diff = this.target.sub(this.horizontal);
    const diffLen = diff.length();
    if (diffLen > maxDelta) diff.multiplyScalar(maxDelta / diffLen);
    this.horizontal.add(diff);
    this.velocity.x = this.horizontal.x;
    this.velocity.z = this.horizontal.z;

    // --- Giro suave hacia la dirección de marcha -----------------------------
    if (accelerating && this.horizontalSpeed > 0.05) {
      const targetYaw = Math.atan2(this.wish.x, this.wish.z);
      const t = 1 - Math.exp(-m.turnSpeed * dt);
      this.yaw = lerpAngle(this.yaw, targetYaw, t);
    }

    // --- Salto (con coyote time y buffer de entrada) -------------------------
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.jumpBuffer = intent.jump ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = m.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    // --- Gravedad -------------------------------------------------------------
    if (!this.grounded) {
      this.velocity.y = Math.max(-m.maxFallSpeed, this.velocity.y - m.gravity * dt);
    }

    // --- Integración + colisiones horizontales -------------------------------
    const wasGrounded = this.grounded;
    const fromX = this.position.x;
    const fromZ = this.position.z;
    this.position.addScaledVector(this.velocity, dt);
    this.collision.resolveHorizontal(this.position, m.radius, this.height);
    this.blockUnwalkable(fromX, fromZ);

    // --- Detección de suelo ----------------------------------------------------
    const sample = this.collision.groundSample(this.position.x, this.position.z, this.position.y);
    const snap = wasGrounded && this.velocity.y <= 0 ? GROUND_SNAP : 0;
    if (sample !== null && this.position.y <= sample.height + snap) {
      this.position.y = sample.height;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = this.velocity.y <= 0;
      // Parado sobre algo demasiado empinado (p. ej. tras saltar contra el
      // colectivo): deslizarse cuesta abajo en vez de quedarse pegado.
      const minNormalY = Math.cos(THREE.MathUtils.degToRad(m.maxSlopeDeg));
      this.onSteepGround = this.grounded && sample.normalY < minNormalY;
      if (this.onSteepGround) {
        this.velocity.x += sample.normalX * m.gravity * SLIDE_FACTOR * dt;
        this.velocity.z += sample.normalZ * m.gravity * SLIDE_FACTOR * dt;
      }
    } else {
      this.grounded = false;
      this.onSteepGround = false;
    }

    // --- Prevención de caídas infinitas --------------------------------------
    if (this.position.y < this.config.world.killY) {
      this.reset();
      return;
    }

    this.state = this.computeState(intent.run);
  }

  /**
   * Con una malla de colisión real hay zonas que no se pueden pisar:
   *  - sin suelo (interior de edificios, huecos de la reconstrucción),
   *  - subidas más empinadas que `movement.maxSlopeDeg` (la malla de Marble
   *    es suave: los obstáculos son rampas, no paredes verticales).
   * Bajar una pendiente fuerte sí está permitido. Ante un bloqueo se intenta
   * deslizar por cada eje y, si ninguno sirve, se vuelve a la posición anterior.
   */
  private blockUnwalkable(fromX: number, fromZ: number): void {
    const p = this.position;
    const minNormalY = Math.cos(THREE.MathUtils.degToRad(this.config.movement.maxSlopeDeg));
    const walkable = (x: number, z: number) => {
      const s = this.collision.groundSample(x, z, p.y);
      if (!s) return false;
      // Superficie caminable, o movimiento que no sube (1 mm de tolerancia:
      // con más, avanzar de a pasos chicos permitiría trepar de a poco).
      return s.normalY >= minNormalY || s.height <= p.y + 0.001;
    };
    if (walkable(p.x, p.z)) return;
    if (walkable(p.x, fromZ)) {
      p.z = fromZ;
      this.velocity.z = 0;
    } else if (walkable(fromX, p.z)) {
      p.x = fromX;
      this.velocity.x = 0;
    } else {
      p.x = fromX;
      p.z = fromZ;
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  private computeState(run: boolean): LocomotionState {
    if (!this.grounded) return this.velocity.y > 0 ? "jump" : "fall";
    const speed = this.horizontalSpeed;
    if (speed < 0.15) return "idle";
    const walk = this.config.movement.walkSpeed;
    return run && speed > walk * 1.15 ? "run" : "walk";
  }

  /** Posición interpolada entre los dos últimos ticks (alpha en [0, 1]). */
  interpolatedPosition(alpha: number, target: THREE.Vector3): THREE.Vector3 {
    return target.lerpVectors(this.previousPosition, this.position, alpha);
  }

  interpolatedYaw(alpha: number): number {
    return lerpAngle(this.previousYaw, this.yaw, alpha);
  }
}

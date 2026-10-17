/**
 * Cámara en tercera persona estilo acción de PS2.
 *
 * - Órbita alrededor de un pivote a la altura de los hombros del jugador.
 * - Yaw/pitch con el mouse, distancia con la rueda (todo suavizado).
 * - Mira un poco por encima del pivote: el personaje queda en el centro
 *   inferior de la pantalla.
 * - Nunca atraviesa el suelo y se acerca si un obstáculo la tapa.
 */

import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";
import type { GameConfig } from "./config";

/** Suavizado exponencial independiente del frame rate. */
function damp(current: number, target: number, stiffness: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-stiffness * dt));
}

function dampAngle(current: number, target: number, stiffness: number, dt: number): number {
  const d = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + d * (1 - Math.exp(-stiffness * dt));
}

export class ThirdPersonCamera {
  /** Ángulos objetivo (entrada directa del mouse). */
  yaw = 0;
  pitch = 0;
  /** Ángulos suavizados (los que usa la cámara). */
  private smoothYaw = 0;
  private smoothPitch = 0;
  private targetDistance: number;
  private distance: number;
  /** Distancia efectiva tras colisiones (se acerca rápido y se aleja lento). */
  private obstructedDistance: number;
  private readonly pivot = new THREE.Vector3();
  private readonly desiredPivot = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly config: GameConfig,
    private readonly collision: CollisionSystem,
  ) {
    this.targetDistance = this.distance = this.obstructedDistance = config.camera.distance;
    this.pitch = this.smoothPitch = THREE.MathUtils.degToRad(config.camera.initialPitchDeg);
  }

  /** Yaw usado para el movimiento relativo a la cámara (lo que ve el jugador). */
  get movementYaw(): number {
    return this.smoothYaw;
  }

  get currentDistance(): number {
    return this.obstructedDistance;
  }

  handleInput(dx: number, dy: number, wheel: number): void {
    const c = this.config.camera;
    this.yaw -= dx * c.sensitivity;
    this.pitch += dy * c.sensitivity * (c.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch,
      THREE.MathUtils.degToRad(c.minPitchDeg),
      THREE.MathUtils.degToRad(c.maxPitchDeg),
    );
    if (wheel !== 0) {
      // ~100 px por "clic" de rueda.
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + (wheel / 100) * c.zoomStep,
        c.minDistance,
        c.maxDistance,
      );
    }
  }

  /** Coloca la cámara detrás del jugador sin transición (inicio / reinicio). */
  snapBehind(playerFeet: THREE.Vector3, playerYaw: number): void {
    this.yaw = this.smoothYaw = playerYaw;
    this.pitch = this.smoothPitch = THREE.MathUtils.degToRad(this.config.camera.initialPitchDeg);
    this.targetDistance = this.distance = this.obstructedDistance = this.config.camera.distance;
    this.pivot.copy(playerFeet).y += this.config.camera.pivotHeight;
    this.initialized = true;
    this.update(0, playerFeet);
  }

  update(dt: number, playerFeet: THREE.Vector3): void {
    const c = this.config.camera;
    this.desiredPivot.copy(playerFeet).y += c.pivotHeight;
    if (!this.initialized) {
      this.pivot.copy(this.desiredPivot);
      this.initialized = true;
    }

    // Seguimiento suave (vertical algo más lento: amortigua saltos).
    this.pivot.x = damp(this.pivot.x, this.desiredPivot.x, c.followStiffness, dt);
    this.pivot.z = damp(this.pivot.z, this.desiredPivot.z, c.followStiffness, dt);
    this.pivot.y = damp(this.pivot.y, this.desiredPivot.y, c.followStiffness * 0.6, dt);
    this.smoothYaw = dampAngle(this.smoothYaw, this.yaw, c.rotationStiffness, dt);
    this.smoothPitch = damp(this.smoothPitch, this.pitch, c.rotationStiffness, dt);
    this.distance = damp(this.distance, this.targetDistance, c.zoomStiffness, dt);

    // Dirección de la órbita (pitch > 0: cámara por encima mirando hacia abajo).
    const cp = Math.cos(this.smoothPitch);
    this.forward.set(Math.sin(this.smoothYaw) * cp, -Math.sin(this.smoothPitch), Math.cos(this.smoothYaw) * cp);
    this.right.set(-Math.cos(this.smoothYaw), 0, Math.sin(this.smoothYaw));

    // Obstrucción: rayo desde el pivote hacia la cámara.
    this.toCamera.copy(this.forward).negate();
    const hit = this.collision.raycast(this.pivot, this.toCamera, this.distance);
    const allowed = hit !== null ? Math.max(c.minDistance * 0.5, hit - 0.25) : this.distance;
    this.obstructedDistance =
      allowed < this.obstructedDistance ? allowed : damp(this.obstructedDistance, allowed, 4, dt);
    if (dt === 0) this.obstructedDistance = allowed;

    const cam = this.camera.position;
    cam.copy(this.pivot).addScaledVector(this.toCamera, this.obstructedDistance);
    cam.addScaledVector(this.right, c.shoulderOffset);

    // No atravesar el suelo.
    const ground = this.collision.groundHeight(cam.x, cam.z, cam.y + 1);
    const minY = (ground ?? -Infinity) + c.minGroundClearance;
    if (cam.y < minY) cam.y = minY;

    this.lookTarget.copy(this.pivot).addScaledVector(this.right, c.shoulderOffset);
    this.lookTarget.y += c.lookAheadHeight;
    this.camera.lookAt(this.lookTarget);
  }
}

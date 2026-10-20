/**
 * Cámara en tercera persona estilo acción de PS2.
 *
 * - Órbita alrededor de un pivote a la altura de los hombros del jugador.
 * - Yaw/pitch con el mouse, distancia con la rueda (todo suavizado).
 * - Mira un poco por encima del pivote: el personaje queda en el centro
 *   inferior de la pantalla.
 * - Nunca atraviesa el suelo y se acerca si un obstáculo la tapa.
 * - Apuntando (clic derecho o disparando): pasa sobre el hombro derecho y se
 *   acerca, para que la mira del centro de pantalla no quede tapada.
 * - Retroceso del arma (patea hacia arriba y vuelve) y temblor ("trauma")
 *   por mordidas y pisadas de cascarudos cercanos.
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
  /** 0 = cámara normal, 1 = apuntando (suavizado). */
  private aimBlend = 0;
  /** Lo fija el juego cada frame. */
  aiming = false;
  /** Obstáculos extra para la cámara (p. ej. los cascarudos): distancia o null. */
  extraObstruction?: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => number | null;
  /** Retroceso pendiente (rad, hacia arriba) y temblor (0..1). */
  private recoil = 0;
  private trauma = 0;
  /** Distancia máxima permitida por cascarudos detrás del jugador (suavizada). */
  private enemyLimit = Infinity;
  private shakeTime = 0;

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

  /** Patada del arma: la mira sube y vuelve sola. */
  kick(radians: number): void {
    this.recoil = Math.min(this.recoil + radians, 0.08);
  }

  /**
   * Temblor (0..1). Se queda con el MÁXIMO, no suma: muchos golpes chicos
   * seguidos (las pisadas de varios cascarudos) no se acumulan en un
   * bamboleo permanente; un golpe fuerte (mordida) sí se siente entero.
   */
  shake(amount: number): void {
    this.trauma = Math.min(1, Math.max(this.trauma, amount));
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
    this.aimBlend = damp(this.aimBlend, this.aiming ? 1 : 0, 10, dt);
    const shoulder = THREE.MathUtils.lerp(c.shoulderOffset, c.aimShoulderOffset, this.aimBlend);
    const distance = THREE.MathUtils.lerp(this.distance, Math.min(this.distance, c.aimDistance), this.aimBlend);

    // Retroceso: recuperación exponencial (~0,15 s).
    this.recoil *= Math.exp(-14 * dt);
    this.trauma = Math.max(0, this.trauma - dt * 2.5);
    this.shakeTime += dt;
    const pitchNow = this.smoothPitch - this.recoil;

    // Dirección de la órbita (pitch > 0: cámara por encima mirando hacia abajo).
    const cp = Math.cos(pitchNow);
    this.forward.set(Math.sin(this.smoothYaw) * cp, -Math.sin(pitchNow), Math.cos(this.smoothYaw) * cp);
    this.right.set(-Math.cos(this.smoothYaw), 0, Math.sin(this.smoothYaw));

    // Obstrucción: rayo desde el pivote hacia la cámara.
    this.toCamera.copy(this.forward).negate();
    const hit = this.collision.raycast(this.pivot, this.toCamera, distance);
    let allowed = hit !== null ? Math.max(c.minDistance * 0.5, hit - 0.25) : distance;
    // Cascarudos detrás: la cámara se acerca y se aleja suave (se mueven todo el
    // tiempo; seguirlos al instante la hacía temblar) y nunca a menos de
    // minDistance (antes quedaba pegada a la espalda del Eternauta).
    const extra = this.extraObstruction?.(this.pivot, this.toCamera, distance) ?? null;
    const enemyTarget = extra !== null ? Math.max(c.minDistance, extra - 0.25) : distance;
    this.enemyLimit = dt === 0 || !Number.isFinite(this.enemyLimit) ? enemyTarget : damp(this.enemyLimit, enemyTarget, 5, dt);
    allowed = Math.min(allowed, this.enemyLimit);
    this.obstructedDistance =
      allowed < this.obstructedDistance ? allowed : damp(this.obstructedDistance, allowed, 4, dt);
    if (dt === 0) this.obstructedDistance = allowed;

    const cam = this.camera.position;
    cam.copy(this.pivot).addScaledVector(this.toCamera, this.obstructedDistance);
    cam.addScaledVector(this.right, shoulder);

    // No atravesar el suelo.
    const ground = this.collision.groundHeight(cam.x, cam.z, cam.y + 1);
    const minY = (ground ?? -Infinity) + c.minGroundClearance;
    if (cam.y < minY) cam.y = minY;

    this.lookTarget.copy(this.pivot).addScaledVector(this.right, shoulder);
    this.lookTarget.y += c.lookAheadHeight;
    // El retroceso también levanta el punto de mira (si no, la cámara sólo sube).
    this.lookTarget.y += Math.sin(this.recoil) * 4;
    this.camera.lookAt(this.lookTarget);

    // Temblor: ruido suave proporcional a trauma² (más natural que lineal).
    if (this.trauma > 0) {
      const k = this.trauma * this.trauma;
      const t = this.shakeTime;
      const n = (f: number, o: number) => Math.sin(t * f + o) * 0.6 + Math.sin(t * f * 2.3 + o * 1.7) * 0.4;
      this.camera.rotateX(n(31, 1.3) * 0.035 * k);
      this.camera.rotateY(n(27, 4.1) * 0.035 * k);
      this.camera.rotateZ(n(23, 2.7) * 0.025 * k);
    }
  }
}

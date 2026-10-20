/**
 * Combate: disparos del Eternauta, vida del traje y reglas de la partida.
 *
 * Disparo hitscan desde la cámara hacia el centro de la pantalla (donde está
 * la mira); la trazadora sale del arma y, si una pared se interpone entre el
 * arma y el blanco, la bala pega en la pared. Sólo consulta la malla de
 * colisiones y las esferas de impacto de los cascarudos (nunca el splat).
 */

import * as THREE from "three";
import type { CollisionSystem } from "./CollisionSystem";
import type { CombatHud } from "./CombatHud";
import type { GameConfig } from "./config";
import type { Effects } from "./Effects";
import type { EnemySystem } from "./EnemySystem";

/**
 * Largo de cañón que falta delante de la mano (m): `muzzle` es la mano
 * derecha + 25 cm y no hay arma modelada; un fusil termina ~0,55 m adelante.
 */
const BARREL = 0.3;

export interface CombatInput {
  /** El controlador del jugador está disparando (botón + sin acción en curso). */
  shooting: boolean;
  dead: boolean;
  /** Pies del jugador (interpolados). */
  player: THREE.Vector3;
  /** Boca del arma en el mundo. */
  muzzle: THREE.Vector3;
  /** Velocidad horizontal: dispersión de cadera al moverse. */
  speed: number;
  touch: boolean;
}

export class Combat {
  health: number;
  private cooldown = 0;
  private sinceDamage = Infinity;
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly playerPos = new THREE.Vector3();
  private readonly barrel = new THREE.Vector3();
  /** Se llama cuando la vida llega a 0. */
  onPlayerKilled?: () => void;
  /** Cada disparo (retroceso de cámara). */
  onShot?: () => void;
  /** Mordida recibida (sacudón de cámara). */
  onPlayerHurt?: (damage: number) => void;
  /** Bala o golpe que conectó en un cascarudo (sonido de impacto). */
  onEnemyHit?: (point: THREE.Vector3, killed: boolean) => void;
  /** Bala que pegó en el escenario. */
  onWorldHit?: (point: THREE.Vector3) => void;

  constructor(
    private readonly config: GameConfig,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly collision: CollisionSystem,
    private readonly enemies: EnemySystem,
    private readonly effects: Effects,
    private readonly hud: CombatHud,
  ) {
    this.health = config.player.maxHealth;
    enemies.onPlayerBitten = (damage, from) => this.takeDamage(damage, from);
  }

  /** Vida completa (al reiniciar). */
  revive(): void {
    this.health = this.config.player.maxHealth;
    this.sinceDamage = Infinity;
    this.hud.setDead(false);
  }

  update(dt: number, input: CombatInput): void {
    this.playerPos.copy(input.player);
    const p = this.config.player;

    // --- Disparo con cadencia fija -------------------------------------------
    this.cooldown = Math.max(this.cooldown - dt, input.shooting ? -1 / this.config.weapon.fireRate : 0);
    if (input.shooting && !input.dead) {
      while (this.cooldown <= 0) {
        this.fire(input);
        this.cooldown += 1 / this.config.weapon.fireRate;
      }
    }

    // --- Regeneración del traje -------------------------------------------------
    this.sinceDamage += dt;
    if (!input.dead && this.health > 0 && this.sinceDamage > p.regenDelay) {
      this.health = Math.min(p.maxHealth, this.health + p.regenRate * dt);
    }
    this.hud.setHealth(this.health, p.maxHealth);
    this.hud.setCounts(this.enemies.kills, this.enemies.aliveCount);
    this.effects.update(dt, this.camera);
  }

  private fire(input: CombatInput): void {
    const w = this.config.weapon;
    // Rayo de la cámara por el centro de la pantalla, con dispersión.
    this.camera.getWorldPosition(this.origin);
    this.camera.getWorldDirection(this.dir);
    const spread = THREE.MathUtils.degToRad(input.speed > 0.5 ? w.spreadDeg : w.aimSpreadDeg);
    this.dir.x += (Math.random() - 0.5) * 2 * spread;
    this.dir.y += (Math.random() - 0.5) * 2 * spread;
    this.dir.z += (Math.random() - 0.5) * 2 * spread;
    this.dir.normalize();

    // No contar lo que está entre la cámara y el jugador.
    const skip = Math.max(0, this.toTarget.copy(input.player).sub(this.origin).dot(this.dir) - 0.5);
    this.origin.addScaledVector(this.dir, skip);
    const range = w.range;
    const wall = this.collision.raycast(this.origin, this.dir, range);
    const hit = this.enemies.raycast(this.origin, this.dir, wall ?? range, input.touch ? w.touchAimAssist : 0);

    if (hit) this.point.copy(hit.point);
    else this.point.copy(this.origin).addScaledVector(this.dir, wall ?? range);

    // Desde el arma: ¿algo tapa la línea de tiro (p. ej. pegado a una pared)?
    this.toTarget.copy(this.point).sub(input.muzzle).normalize();
    const muzzle = this.barrel.copy(input.muzzle).addScaledVector(this.toTarget, BARREL);
    this.toTarget.copy(this.point).sub(muzzle);
    const dist = this.toTarget.length();
    this.toTarget.divideScalar(dist || 1);
    const blocked = dist > 0.3 ? this.collision.raycast(input.muzzle, this.toTarget, dist + BARREL - 0.2) : null;

    this.onShot?.();
    if (blocked !== null) {
      this.point.copy(input.muzzle).addScaledVector(this.toTarget, blocked);
      this.effects.shot(muzzle, this.toTarget, this.point, input.player.y);
      this.impactWorld(this.point, this.toTarget);
      return;
    }
    this.effects.shot(muzzle, this.toTarget, this.point, input.player.y);
    if (hit) {
      const e = hit.enemy;
      const scale = this.config.enemies.scale;
      const killed = this.enemies.damage(e, w.damage, input.player);
      this.effects.bloodHit(hit.point, hit.normal, this.dir, e.position.y, scale, killed ? 1.8 : 1);
      if (killed) this.effects.deathGush(this.enemies.bodyCenter(e, this.aim), e.position.y, scale);
      this.hud.hit(killed);
      this.onEnemyHit?.(hit.point, killed);
    } else if (wall !== null) {
      this.impactWorld(this.point, this.dir);
    }
  }

  /** Impacto en el escenario: ¿suelo (nieve, agujero) o pared (polvo, chispas)? */
  private impactWorld(point: THREE.Vector3, dir: THREE.Vector3): void {
    const ground = this.collision.groundHeight(point.x, point.z, point.y + 0.3);
    const onGround = ground !== null && Math.abs(point.y - ground) < 0.3;
    if (onGround) this.normal.set(-dir.x * 0.3, 1, -dir.z * 0.3).normalize();
    else this.normal.copy(dir).negate();
    this.effects.impact(point, this.normal, ground ?? point.y - 1, onGround);
    this.onWorldHit?.(point);
  }

  /**
   * Piña / patada: daña a los cascarudos en un cono frente al jugador (en el
   * instante del golpe el personaje ya mira hacia la cámara).
   */
  melee(action: "punch" | "kick", player: THREE.Vector3, yaw: number): void {
    const s = this.config.enemies.scale;
    // Desde el centro del cascarudo: su radio (~0,9 m × escala) + el brazo o la pierna.
    const reach = 0.9 * s + (action === "kick" ? 1.4 : 1.2);
    const damage = action === "kick" ? 2 : 1;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (const e of this.enemies.enemies) {
      if (!e.active || e.state === "dead") continue;
      const dx = e.position.x - player.x;
      const dz = e.position.z - player.z;
      const d = Math.hypot(dx, dz);
      // Cono de ~100° (cos 50° ≈ 0.65: el blanco es enorme); muy pegado cuenta siempre.
      if (d > reach || (d > 0.9 * s && (dx * fx + dz * fz) / d < 0.65)) continue;
      const killed = this.enemies.damage(e, damage, player);
      // Golpe en el frente del caparazón, del lado del jugador.
      this.enemies.bodyCenter(e, this.point);
      this.normal.set(-dx, 0, -dz).normalize();
      this.point.addScaledVector(this.normal, 0.8 * s);
      this.dir.copy(this.normal).negate();
      this.normal.y = 0.4;
      this.normal.normalize();
      this.effects.bloodHit(this.point, this.normal, this.dir, e.position.y, s, killed ? 1.8 : 1.3);
      if (killed) this.effects.deathGush(this.enemies.bodyCenter(e, this.aim), e.position.y, s);
      this.hud.hit(killed);
      this.onEnemyHit?.(this.point, killed);
    }
  }

  private takeDamage(amount: number, from: THREE.Vector3): void {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceDamage = 0;
    // Ángulo del atacante relativo a hacia dónde mira la cámara.
    this.camera.getWorldDirection(this.dir);
    const camYaw = Math.atan2(this.dir.x, this.dir.z);
    const toYaw = Math.atan2(from.x - this.playerPos.x, from.z - this.playerPos.z);
    // + = derecha en pantalla (la derecha de la cámara es -X cuando mira a +Z).
    const rel = Math.atan2(Math.sin(camYaw - toYaw), Math.cos(camYaw - toYaw));
    this.hud.hurt(rel);
    this.onPlayerHurt?.(amount);
    if (this.health <= 0) this.onPlayerKilled?.();
  }
}

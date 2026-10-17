/**
 * Controles táctiles para celulares y tablets.
 *
 * - Mitad izquierda: joystick flotante (aparece donde se apoya el dedo).
 *   Inclinación parcial = caminar, al tope = correr.
 * - Resto de la pantalla: arrastrar rota la cámara; pellizcar con dos dedos
 *   acerca / aleja.
 * - Botones: saltar y reiniciar posición.
 *
 * No toca la lógica de juego: alimenta la entrada virtual de InputManager,
 * igual que el teclado y el mouse.
 */

import type { InputManager } from "./InputManager";
import type { GameConfig } from "./config";

/** Radio del joystick en px CSS. */
const JOY_RADIUS = 56;
/** Fracción del ancho de pantalla que activa el joystick. */
const JOY_ZONE = 0.45;
/** Inclinación a partir de la cual se corre. */
const RUN_THRESHOLD = 0.92;
/** Zona muerta del joystick. */
const DEAD_ZONE = 0.12;
/** "Px de rueda" por px de pellizco (100 px de rueda = un paso de zoom). */
const PINCH_ZOOM = 1.6;

/** ¿El dispositivo es principalmente táctil (celular / tablet)? */
export function isTouchPrimary(): boolean {
  return matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

export class TouchControls {
  readonly root: HTMLElement;
  private readonly joyBase: HTMLElement;
  private readonly joyKnob: HTMLElement;
  private joyPointer: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  /** Punteros que controlan la cámara: id → última posición. */
  private readonly look = new Map<number, { x: number; y: number }>();
  private pinchDistance: number | null = null;

  constructor(
    container: HTMLElement,
    private readonly input: InputManager,
    private readonly config: GameConfig,
  ) {
    this.root = el("div", "touch-controls");
    this.root.hidden = true;

    this.joyBase = el("div", "touch-joy");
    this.joyKnob = el("div", "touch-joy-knob");
    this.joyBase.append(this.joyKnob);

    const jump = el("button", "touch-btn touch-jump", "SALTAR");
    const reset = el("button", "touch-btn touch-reset", "↺");
    reset.setAttribute("aria-label", "Reiniciar posición");
    jump.setAttribute("aria-label", "Saltar");
    for (const [button, action] of [
      [jump, "jump"],
      [reset, "reset"],
    ] as const) {
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        button.classList.add("pressed");
        this.input.trigger(action);
      });
      const release = () => button.classList.remove("pressed");
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    }

    this.root.append(this.joyBase, jump, reset);
    container.append(this.root);

    this.root.addEventListener("pointerdown", this.onDown);
    this.root.addEventListener("pointermove", this.onMove);
    this.root.addEventListener("pointerup", this.onUp);
    this.root.addEventListener("pointercancel", this.onUp);
    // Sin menú contextual ni gestos del navegador sobre los controles.
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    // Llamada, notificación o cambio de app: soltar todo (InputManager también
    // resetea su entrada virtual) para que el dibujo coincida con el estado.
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onBlur = () => this.releaseAll();

  private readonly onVisibility = () => {
    if (document.hidden) this.releaseAll();
  };

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.releaseAll();
  }

  private readonly onDown = (e: PointerEvent) => {
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // Puntero ya liberado (o evento sintético): seguimos sin captura.
    }
    const inJoyZone = e.clientX < window.innerWidth * JOY_ZONE;
    if (inJoyZone && this.joyPointer === null) {
      this.joyPointer = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.joyBase.classList.add("active");
      this.updateJoystick(e.clientX, e.clientY);
      return;
    }
    this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.look.size === 2) this.pinchDistance = this.currentPinch();
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerId === this.joyPointer) {
      this.updateJoystick(e.clientX, e.clientY);
      return;
    }
    const last = this.look.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last.x = e.clientX;
    last.y = e.clientY;

    if (this.look.size >= 2) {
      // Pellizco: separar los dedos acerca la cámara (como la rueda hacia arriba).
      const d = this.currentPinch();
      if (this.pinchDistance !== null) this.input.addWheel((this.pinchDistance - d) * PINCH_ZOOM);
      this.pinchDistance = d;
      return;
    }
    // Convertir px táctiles a "px de mouse" para reutilizar la cámara.
    const scale = this.config.camera.touchSensitivity / this.config.camera.sensitivity;
    this.input.addLookDelta(dx * scale, dy * scale);
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.pointerId === this.joyPointer) {
      this.joyPointer = null;
      this.joyBase.classList.remove("active", "running");
      this.joyKnob.style.transform = "";
      this.input.setVirtualMove(0, 0, false);
      return;
    }
    this.look.delete(e.pointerId);
    if (this.look.size < 2) this.pinchDistance = null;
  };

  private updateJoystick(x: number, y: number): void {
    let dx = x - this.joyOrigin.x;
    let dy = y - this.joyOrigin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_RADIUS) {
      dx = (dx / dist) * JOY_RADIUS;
      dy = (dy / dist) * JOY_RADIUS;
    }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let mx = dx / JOY_RADIUS;
    let my = -dy / JOY_RADIUS;
    const mag = Math.hypot(mx, my);
    if (mag < DEAD_ZONE) {
      mx = 0;
      my = 0;
    } else {
      // Reescalar fuera de la zona muerta para que el control sea progresivo.
      const k = (mag - DEAD_ZONE) / (1 - DEAD_ZONE) / mag;
      mx *= k;
      my *= k;
    }
    const run = mag >= RUN_THRESHOLD;
    this.joyBase.classList.toggle("running", run);
    this.input.setVirtualMove(mx, my, run);
  }

  private currentPinch(): number {
    const [a, b] = [...this.look.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private releaseAll(): void {
    this.joyPointer = null;
    this.look.clear();
    this.pinchDistance = null;
    this.joyBase.classList.remove("active", "running");
    this.joyKnob.style.transform = "";
    this.input.setVirtualMove(0, 0, false);
  }

  dispose(): void {
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.releaseAll();
    this.root.remove();
  }
}

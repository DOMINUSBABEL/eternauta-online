/**
 * Nevada mortal: partículas que caen alrededor de la cámara.
 *
 * Todo el movimiento ocurre en el vertex shader (sin costo de CPU): cada copo
 * tiene una posición base dentro de un cubo que se repite (módulo) centrado
 * en la cámara, así la nevada es infinita con un número fijo de partículas.
 */

import * as THREE from "three";
import type { GameConfig } from "./config";

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform float uArea;
  uniform float uFall;
  uniform vec3 uWind;
  uniform float uSize;
  uniform float uPixelScale;
  attribute vec4 aSeed;
  varying float vAlpha;

  void main() {
    vec3 base = position;
    float speed = mix(0.6, 1.4, aSeed.x);
    vec3 p = base + uWind * uTime * speed;
    p.y -= uFall * uTime * speed;
    // Vaivén lateral de cada copo.
    float t = uTime * mix(0.6, 1.6, aSeed.y) + aSeed.z * 6.2831;
    p.x += sin(t) * 0.35 * aSeed.w;
    p.z += cos(t * 0.8) * 0.35 * aSeed.w;
    // Cubo repetido centrado en la cámara.
    vec3 rel = mod(p - uCenter + 0.5 * uArea, uArea) - 0.5 * uArea;
    vec3 world = uCenter + rel;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    float size = uSize * mix(0.6, 1.5, aSeed.w);
    gl_PointSize = clamp(size * uPixelScale / max(dist, 0.1), 1.0, 48.0);
    // Desvanecer cerca de la cámara y en el borde del cubo.
    float edge = 1.0 - smoothstep(0.32 * uArea, 0.5 * uArea, length(rel));
    float nearFade = smoothstep(0.15, 0.9, dist);
    vAlpha = edge * nearFade;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.15, d) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export class Snowfall {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private count = 0;

  constructor(private readonly config: GameConfig) {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uArea: { value: config.atmosphere.snowArea },
        uFall: { value: config.atmosphere.snowFallSpeed },
        uWind: { value: new THREE.Vector3() },
        uSize: { value: config.atmosphere.snowSize },
        uPixelScale: { value: 800 },
        uColor: { value: new THREE.Color(0xeef3f8) },
        uOpacity: { value: 0.85 },
      },
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.name = "snowfall";
    this.points.frustumCulled = false;
    // Después de los splats (que no escriben profundidad).
    this.points.renderOrder = 5;
    this.rebuild();
  }

  /** Regenera las partículas si cambió la cantidad o el tamaño del volumen. */
  rebuild(): void {
    const { snowCount, snowArea } = this.config.atmosphere;
    if (snowCount === this.count && this.material.uniforms.uArea.value === snowArea) return;
    this.count = snowCount;
    const positions = new Float32Array(snowCount * 3);
    const seeds = new Float32Array(snowCount * 4);
    for (let i = 0; i < snowCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * snowArea;
      positions[i * 3 + 1] = (Math.random() - 0.5) * snowArea;
      positions[i * 3 + 2] = (Math.random() - 0.5) * snowArea;
      for (let k = 0; k < 4; k++) seeds[i * 4 + k] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    this.points.geometry.dispose();
    this.points.geometry = geometry;
  }

  update(time: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    const a = this.config.atmosphere;
    this.points.visible = a.snow;
    if (!a.snow) return;
    this.rebuild();
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uCenter.value.copy(camera.position);
    u.uArea.value = a.snowArea;
    u.uFall.value = a.snowFallSpeed;
    u.uWind.value.set(a.snowWind.x, a.snowWind.y, a.snowWind.z);
    u.uSize.value = a.snowSize;
    // Tamaño en píxeles proporcional a la altura del viewport y al FOV.
    u.uPixelScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

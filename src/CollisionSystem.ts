/**
 * Sistema de colisiones.
 *
 * El Gaussian splat es sólo apariencia: NO se usa para colisionar.
 * Toda la física consulta un `CollisionProvider`, con dos implementaciones:
 *
 *  - `ProvisionalCollision`: suelo invisible (plano ajustable con pendiente),
 *    cajas de obstáculos configurables. Es el default mientras no exista
 *    una malla física real.
 *  - `MeshCollision`: malla GLB (p. ej. el "collider mesh" que exporta
 *    World Labs Marble) acelerada con three-mesh-bvh.
 *
 * Los límites del escenario y la altura de muerte se aplican siempre,
 * independientemente del proveedor activo.
 */

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { HitPointInfo } from "three-mesh-bvh";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GameConfig } from "./config";

/**
 * Muestra del suelo: altura y normal de la superficie orientada hacia arriba.
 * normalY: 1 = plano, 0 = pared. (normalX, normalZ) apunta cuesta abajo.
 */
export interface GroundSample {
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
}

export interface CollisionProvider {
  readonly name: string;
  /**
   * Altura del suelo bajo (x, z) buscando desde `fromY` hacia abajo.
   * Devuelve null si no hay suelo (agujero / fuera de la malla).
   */
  groundHeight(x: number, z: number, fromY: number): number | null;
  /** Como groundHeight, pero incluye la inclinación de la superficie. */
  groundSample(x: number, z: number, fromY: number): GroundSample | null;
  /**
   * Empuja un cilindro vertical (pies en position.y, alto `height`) fuera de
   * los obstáculos. Modifica `position` en el plano XZ.
   */
  resolveHorizontal(position: THREE.Vector3, radius: number, height: number): void;
  /** Distancia libre desde `origin` en `dir` (normalizado), o null si no choca antes de `maxDist`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null;
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Colisiones provisionales
// ---------------------------------------------------------------------------

export class ProvisionalCollision implements CollisionProvider {
  readonly name = "provisional (suelo invisible + cajas)";
  private readonly box = new THREE.Box3();
  private readonly ray = new THREE.Ray();
  private readonly hit = new THREE.Vector3();

  constructor(private readonly config: GameConfig) {}

  groundHeight(x: number, z: number): number {
    return this.groundSample(x, z).height;
  }

  groundSample(x: number, z: number): GroundSample {
    const w = this.config.world;
    let height = w.groundHeight + w.groundSlopeX * x + w.groundSlopeZ * z;
    // Normal del plano y = h + sx·x + sz·z  →  (-sx, 1, -sz) normalizada.
    const len = Math.hypot(1, w.groundSlopeX, w.groundSlopeZ);
    let sample = { normalX: -w.groundSlopeX / len, normalY: 1 / len, normalZ: -w.groundSlopeZ / len };
    // Las cajas también son "suelo" (plano) si el jugador está encima.
    for (const o of w.obstacles) {
      if (x >= o.min.x && x <= o.max.x && z >= o.min.z && z <= o.max.z && o.max.y > height) {
        height = o.max.y;
        sample = { normalX: 0, normalY: 1, normalZ: 0 };
      }
    }
    return { height, ...sample };
  }

  /** Altura del plano base, sin obstáculos (para la cámara y el debug). */
  baseGroundHeight(x: number, z: number): number {
    const w = this.config.world;
    return w.groundHeight + w.groundSlopeX * x + w.groundSlopeZ * z;
  }

  resolveHorizontal(position: THREE.Vector3, radius: number, height: number): void {
    for (const o of this.config.world.obstacles) {
      // Sin solape vertical (o parado encima): no hay empuje lateral.
      if (position.y >= o.max.y - 0.05 || position.y + height <= o.min.y) continue;
      const cx = THREE.MathUtils.clamp(position.x, o.min.x, o.max.x);
      const cz = THREE.MathUtils.clamp(position.z, o.min.z, o.max.z);
      const dx = position.x - cx;
      const dz = position.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        position.x = cx + (dx / d) * radius;
        position.z = cz + (dz / d) * radius;
      } else {
        // Centro dentro de la caja: salir por la cara más cercana.
        const exits = [
          { d: position.x - o.min.x, x: o.min.x - radius, z: position.z },
          { d: o.max.x - position.x, x: o.max.x + radius, z: position.z },
          { d: position.z - o.min.z, x: position.x, z: o.min.z - radius },
          { d: o.max.z - position.z, x: position.x, z: o.max.z + radius },
        ].sort((a, b) => a.d - b.d);
        position.x = exits[0].x;
        position.z = exits[0].z;
      }
    }
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    let best: number | null = null;
    this.ray.set(origin, dir);
    for (const o of this.config.world.obstacles) {
      this.box.min.set(o.min.x, o.min.y, o.min.z);
      this.box.max.set(o.max.x, o.max.y, o.max.z);
      if (this.ray.intersectBox(this.box, this.hit)) {
        const d = this.hit.distanceTo(origin);
        if (d <= maxDist && (best === null || d < best)) best = d;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// Colisiones con malla real (GLB)
// ---------------------------------------------------------------------------

export class MeshCollision implements CollisionProvider {
  readonly name: string;
  private readonly bvh: MeshBVH;
  private readonly geometry: THREE.BufferGeometry;
  /** Transformación mundo ← malla (la misma que el splat: comparten sistema de referencia). */
  private readonly matrix = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly normalMatrix = new THREE.Matrix3();
  private scale = 1;
  private readonly ray = new THREE.Ray();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly hitInfo: HitPointInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  /** Altura máxima de escalón que el jugador puede subir (m). */
  stepHeight = 0.35;

  private constructor(geometry: THREE.BufferGeometry, url: string) {
    this.geometry = geometry;
    this.bvh = new MeshBVH(geometry);
    this.label = url.split("/").pop() ?? url;
    this.name = `malla (${this.label}, ${(geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3} tris)`;
  }

  private readonly label: string;

  /**
   * Nueva malla con geometría estática extra (en coordenadas del mundo), p. ej.
   * las colisiones de los modelos de Blender. Sólo posiciones, indexada.
   */
  withExtra(extraWorld: THREE.BufferGeometry, label: string): MeshCollision {
    const extra = new THREE.BufferGeometry();
    extra.setAttribute("position", extraWorld.attributes.position.clone());
    if (extraWorld.index) extra.setIndex(extraWorld.index.clone());
    extra.applyMatrix4(this.inverse);
    const parts = [this.geometry, extra];
    const mixed = parts.some((g) => g.index) && parts.some((g) => !g.index);
    const merged = mergeGeometries(mixed ? parts.map((g) => (g.index ? g.toNonIndexed() : g)) : parts, false);
    extra.dispose();
    if (!merged) throw new Error("No se pudo fusionar la geometría extra con la malla de colisión");
    const mc = new MeshCollision(merged, `${this.label} + ${label}`);
    mc.setTransform(this.matrix);
    mc.stepHeight = this.stepHeight;
    return mc;
  }

  static async load(url: string, onProgress?: (p: number) => void): Promise<MeshCollision> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    gltf.scene.updateMatrixWorld(true);
    const geometries: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Sólo posiciones: es geometría física, no visual.
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", mesh.geometry.attributes.position.clone());
      if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
      g.applyMatrix4(mesh.matrixWorld);
      geometries.push(g);
    });
    if (geometries.length === 0) throw new Error(`El GLB de colisiones no contiene mallas: ${url}`);
    // mergeGeometries exige que todas sean indexadas o ninguna.
    const mixed = geometries.some((g) => g.index) && geometries.some((g) => !g.index);
    const parts = mixed ? geometries.map((g) => (g.index ? g.toNonIndexed() : g)) : geometries;
    const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    if (!merged) throw new Error("No se pudieron fusionar las mallas de colisión (atributos incompatibles)");
    return new MeshCollision(merged, url);
  }

  /** Aplica la transformación del escenario (posición/rotación/escala uniforme). */
  setTransform(matrix: THREE.Matrix4): void {
    this.matrix.copy(matrix);
    this.inverse.copy(matrix).invert();
    this.normalMatrix.getNormalMatrix(matrix);
    this.scale = new THREE.Vector3().setFromMatrixScale(matrix).x || 1;
  }

  groundHeight(x: number, z: number, fromY: number): number | null {
    return this.groundSample(x, z, fromY)?.height ?? null;
  }

  groundSample(x: number, z: number, fromY: number): GroundSample | null {
    // Rayo hacia abajo desde un poco por encima de los pies (permite subir escalones).
    this.tmp.set(x, fromY + this.stepHeight, z).applyMatrix4(this.inverse);
    this.tmpDir.set(0, -1, 0).transformDirection(this.inverse);
    this.ray.set(this.tmp, this.tmpDir);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide);
    if (!hit) return null;
    this.tmpDir.set(0, 1, 0);
    if (hit.face) {
      // Normal al espacio del mundo; DoubleSide: la cara puede mirar hacia abajo,
      // así que se orienta siempre hacia arriba.
      this.tmpDir.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize();
      if (this.tmpDir.y < 0) this.tmpDir.negate();
    }
    return {
      height: hit.point.applyMatrix4(this.matrix).y,
      normalX: this.tmpDir.x,
      normalY: this.tmpDir.y,
      normalZ: this.tmpDir.z,
    };
  }

  resolveHorizontal(position: THREE.Vector3, radius: number, height: number): void {
    // Esferas a la altura de rodillas, torso y cabeza (por encima del escalón).
    const localRadius = radius / this.scale;
    const samples = [this.stepHeight + radius * 0.5, height * 0.55, height - radius];
    for (let iter = 0; iter < 2; iter++) {
      for (const h of samples) {
        this.tmp.set(position.x, position.y + h, position.z).applyMatrix4(this.inverse);
        const info = this.bvh.closestPointToPoint(this.tmp, this.hitInfo, 0, localRadius);
        if (!info || info.distance >= localRadius) continue;
        const closest = info.point.applyMatrix4(this.matrix);
        const dx = position.x - closest.x;
        const dz = position.z - closest.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-5) continue;
        const push = radius - d;
        if (push > 0) {
          position.x += (dx / d) * push;
          position.z += (dz / d) * push;
        }
      }
    }
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    this.tmp.copy(origin).applyMatrix4(this.inverse);
    this.tmpDir.copy(dir).transformDirection(this.inverse);
    this.ray.set(this.tmp, this.tmpDir);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, maxDist / this.scale);
    if (!hit) return null;
    return hit.distance * this.scale;
  }

  /** Wireframe de la malla de colisión, con la misma transformación (debug). */
  createDebugObject(): THREE.Object3D {
    const mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({ color: 0x33ccff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    mesh.name = "collision-mesh-debug";
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.matrix);
    mesh.renderOrder = 21;
    return mesh;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Fachada usada por el controlador y la cámara
// ---------------------------------------------------------------------------

export class CollisionSystem {
  readonly provisional: ProvisionalCollision;
  private mesh: MeshCollision | null = null;
  status = "provisional";

  constructor(private readonly config: GameConfig) {
    this.provisional = new ProvisionalCollision(config);
  }

  get provider(): CollisionProvider {
    return this.mesh ?? this.provisional;
  }

  /** Geometría estática extra (mundo) que se suma a la malla real: colisiones de los props. */
  private extra: { geometry: THREE.BufferGeometry; label: string } | null = null;

  /** Agrega (o reemplaza) colisiones estáticas extra; se fusionan con la malla de Marble. */
  addStaticGeometry(geometry: THREE.BufferGeometry, label: string): void {
    this.extra?.geometry.dispose();
    this.extra = { geometry, label };
    if (this.base) this.setMesh(this.base.withExtra(geometry, label));
  }

  /** Malla de Marble sin extras (para poder recombinar). */
  private base: MeshCollision | null = null;

  private setMesh(mesh: MeshCollision): void {
    if (this.mesh && this.mesh !== this.base) this.mesh.dispose();
    this.mesh = mesh;
    this.status = mesh.name;
    this.onMeshChange?.(mesh);
  }

  /** Carga una malla de colisiones real; si falla, se mantiene la provisional y se informa. */
  async loadMesh(url: string, environmentMatrix: THREE.Matrix4): Promise<void> {
    this.status = "cargando malla…";
    try {
      const mesh = await MeshCollision.load(url);
      mesh.setTransform(environmentMatrix);
      this.mesh?.dispose();
      this.base = mesh;
      if (this.extra) {
        this.setMesh(mesh.withExtra(this.extra.geometry, this.extra.label));
        return;
      }
      this.mesh = mesh;
      this.status = mesh.name;
      this.onMeshChange?.(mesh);
    } catch (err) {
      this.status = `ERROR malla: ${(err as Error).message} (usando provisional)`;
      console.error("[Collision]", err);
    }
  }

  updateEnvironmentTransform(matrix: THREE.Matrix4): void {
    this.base?.setTransform(matrix);
    this.mesh?.setTransform(matrix);
    this.onMeshChange?.(this.mesh);
  }

  get hasMesh(): boolean {
    return this.mesh !== null;
  }

  /** Avisa a la vista de debug cuando cambia la malla o su transformación. */
  onMeshChange?: (mesh: MeshCollision | null) => void;

  groundHeight(x: number, z: number, fromY: number): number | null {
    return this.provider.groundHeight(x, z, fromY);
  }

  groundSample(x: number, z: number, fromY: number): GroundSample | null {
    return this.provider.groundSample(x, z, fromY);
  }

  resolveHorizontal(position: THREE.Vector3, radius: number, height: number): void {
    this.provider.resolveHorizontal(position, radius, height);
    this.clampToBounds(position, radius);
  }

  clampToBounds(position: THREE.Vector3, radius: number): void {
    const b = this.config.world.bounds;
    position.x = THREE.MathUtils.clamp(position.x, b.minX + radius, b.maxX - radius);
    position.z = THREE.MathUtils.clamp(position.z, b.minZ + radius, b.maxZ - radius);
  }

  /** Distancia libre para la cámara (obstáculos + suelo). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number | null {
    return this.provider.raycast(origin, dir, maxDist);
  }

  dispose(): void {
    if (this.base && this.base !== this.mesh) this.base.dispose();
    this.mesh?.dispose();
    this.extra?.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Visualización de debug: suelo invisible, límites y obstáculos
// ---------------------------------------------------------------------------

export class CollisionDebugView {
  readonly group = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  /** Paredes translúcidas en el perímetro jugable (visibles a través del splat). */
  private readonly walls: THREE.Mesh;
  private readonly wallEdges: THREE.LineSegments;
  private obstacleGroup = new THREE.Group();
  private obstacleKey = "";
  private boundsKey = "";
  private meshDebug: THREE.Object3D | null = null;

  constructor(private readonly config: GameConfig) {
    this.group.name = "collision-debug";
    this.grid = new THREE.GridHelper(20, 20, 0xff3344, 0xffffff);
    const gm = this.grid.material as THREE.Material;
    gm.transparent = true;
    gm.opacity = 0.45;
    gm.depthWrite = false;
    this.grid.renderOrder = 20;

    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.walls = new THREE.Mesh(new THREE.BufferGeometry(), wallMat);
    this.walls.renderOrder = 21;
    this.wallEdges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false, transparent: true }),
    );
    this.wallEdges.renderOrder = 22;
    this.group.add(this.grid, this.walls, this.wallEdges, this.obstacleGroup);
    this.group.visible = false;
  }

  /** Reemplaza el wireframe de la malla de colisión (o lo quita con null). */
  setCollisionMesh(mesh: MeshCollision | null): void {
    if (this.meshDebug) {
      this.group.remove(this.meshDebug);
      ((this.meshDebug as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.meshDebug = mesh ? mesh.createDebugObject() : null;
    if (this.meshDebug) this.group.add(this.meshDebug);
    // Con malla real, la grilla del suelo provisional ya no aplica.
    this.grid.visible = !mesh;
  }

  update(player: THREE.Vector3): void {
    if (!this.group.visible) return;
    const w = this.config.world;
    const ground = (x: number, z: number) => w.groundHeight + w.groundSlopeX * x + w.groundSlopeZ * z;
    // Grilla siguiendo al jugador, inclinada según la pendiente del suelo.
    const gx = Math.round(player.x);
    const gz = Math.round(player.z);
    this.grid.position.set(gx, ground(gx, gz) + 0.01, gz);
    this.grid.rotation.set(Math.atan(w.groundSlopeZ), 0, -Math.atan(w.groundSlopeX));

    const key = JSON.stringify([w.bounds, w.groundHeight, w.groundSlopeX, w.groundSlopeZ]);
    if (key !== this.boundsKey) {
      this.boundsKey = key;
      const b = w.bounds;
      const corners = [
        [b.minX, b.minZ],
        [b.maxX, b.minZ],
        [b.maxX, b.maxZ],
        [b.minX, b.maxZ],
      ];
      const H = 3;
      const tris: number[] = [];
      const lines: number[] = [];
      for (let i = 0; i < 4; i++) {
        const [x0, z0] = corners[i];
        const [x1, z1] = corners[(i + 1) % 4];
        const y0 = ground(x0, z0);
        const y1 = ground(x1, z1);
        tris.push(x0, y0, z0, x1, y1, z1, x1, y1 + H, z1, x0, y0, z0, x1, y1 + H, z1, x0, y0 + H, z0);
        lines.push(x0, y0, z0, x1, y1, z1, x0, y0 + H, z0, x1, y1 + H, z1, x0, y0, z0, x0, y0 + H, z0);
      }
      this.walls.geometry.dispose();
      this.walls.geometry = new THREE.BufferGeometry();
      this.walls.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
      this.wallEdges.geometry.dispose();
      this.wallEdges.geometry = new THREE.BufferGeometry();
      this.wallEdges.geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    }

    const okey = JSON.stringify(w.obstacles);
    if (okey !== this.obstacleKey) {
      this.obstacleKey = okey;
      for (const c of this.obstacleGroup.children) (c as THREE.Mesh).geometry.dispose();
      this.obstacleGroup.clear();
      const mat = new THREE.MeshBasicMaterial({ color: 0x33ccff, wireframe: true });
      for (const o of w.obstacles) {
        const size = new THREE.Vector3(o.max.x - o.min.x, o.max.y - o.min.y, o.max.z - o.min.z);
        const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
        m.position.set((o.min.x + o.max.x) / 2, (o.min.y + o.max.y) / 2, (o.min.z + o.max.z) / 2);
        this.obstacleGroup.add(m);
      }
    }
  }
}

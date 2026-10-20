/**
 * Animación procedural del cascarudo sobre su rig.
 *
 * El GLB trae malla + esqueleto (auto-rig de 57 huesos, nombres genéricos)
 * pero ningún clip, así que la locomoción se genera por código:
 *
 *  - 6 patas caminantes con marcha en trípode, como una cucaracha real:
 *    delantera y trasera de un lado + media del otro se mueven juntas.
 *    Cada pata gira en la cadera (avance/retroceso + elevación) y dobla la
 *    rodilla mientras está en el aire.
 *  - 4 apéndices bucales que tiemblan y "muerden" al atacar.
 *  - Cola segmentada que ondula al caminar.
 *  - Cuerpo con cabeceo, balanceo y rebote al ritmo de los pasos.
 *  - Se para en dos patas para amenazar (alerta / antes de morder): cuerpo
 *    erguido, patas delanteras en alto, mandíbulas abiertas temblando.
 *  - Poses de impacto y de muerte (patas encogidas que se retuercen).
 *  - Informa qué trípode apoya en cada paso (polvo de nieve, temblor).
 *
 * Las rotaciones se expresan en el espacio del modelo (Y arriba, frente +Z)
 * y se convierten al espacio local de cada hueso a partir de la pose de
 * reposo: q = padre⁻¹ · Δ · padre · q_reposo.
 *
 * Mapa del rig (mirado en el laboratorio, ver README):
 *   cuerpo Bone_001 (hijo de Bone_000)
 *   patas  izq: 046 delantera, 056 media, 036 trasera
 *          der: 026 delantera, 051 media, 041 trasera
 *   boca   006, 011, 016, 021 · cola 031
 *   (cada cadena: base → … → punta, con números decrecientes)
 */

import * as THREE from "three";

interface Joint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Rotación de reposo del padre en espacio del modelo (y su inversa). */
  parent: THREE.Quaternion;
  parentInv: THREE.Quaternion;
}

interface Leg {
  hip: Joint;
  knee: Joint;
  ankle: Joint;
  /** Último hueso de la cadena (punta de la pata). */
  tip: THREE.Bone;
  /** 1 delantera, -1 trasera, 0 media. */
  row: number;
  /** +1 izquierda, -1 derecha: signo del giro "hacia adelante" sobre Y. */
  side: number;
  /** Eje (espacio del modelo) que eleva la pata: hacia afuera × arriba. */
  liftAxis: THREE.Vector3;
  /** Desfase de la marcha (0 o 0.5: trípode). */
  phase: number;
}

const LEGS: { base: string; side: number; phase: number; row: number }[] = [
  // Trípode A
  { base: "Bone_046", side: 1, phase: 0, row: 1 }, // izq. delantera
  { base: "Bone_051", side: -1, phase: 0, row: 0 }, // der. media
  { base: "Bone_036", side: 1, phase: 0, row: -1 }, // izq. trasera
  // Trípode B
  { base: "Bone_026", side: -1, phase: 0.5, row: 1 }, // der. delantera
  { base: "Bone_056", side: 1, phase: 0.5, row: 0 }, // izq. media
  { base: "Bone_041", side: -1, phase: 0.5, row: -1 }, // der. trasera
];
const MOUTH = ["Bone_006", "Bone_011", "Bone_016", "Bone_021"];
const TAIL = "Bone_031";

/** Amplitudes de la marcha (radianes). */
const SWING = 0.3;
const LIFT = 0.38;
const KNEE_FOLD = 0.45;

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const RIGHT = new THREE.Vector3(1, 0, 0);

/** Estado de animación que alimenta la IA de cada enemigo. */
export interface CascarudoPose {
  /** Fase de la marcha (ciclos, crece con la distancia recorrida). */
  gait: number;
  /** 0 = quieto, 1 = paso completo (escala la amplitud). */
  stride: number;
  /** Giro en curso (rad/s): inclina el cuerpo hacia adentro. */
  turnRate: number;
  /** 0..1: mordida / embestida. */
  attack: number;
  /** 0..1: sacudón por impacto de bala (decae solo). */
  hurt: number;
  /** 0..1: erguido sobre las patas traseras (amenaza / antes de morder). */
  rear: number;
  /** 0..1: transición a la pose de muerte. */
  death: number;
  /** Segundos desde la muerte (el pataleo se apaga de a poco). */
  deathTime: number;
  /** Tiempo (s) para temblores y ruido. */
  time: number;
  /** Semilla por individuo (desincroniza a los enemigos). */
  seed: number;
}

export class CascarudoRig {
  private readonly legs: Leg[] = [];
  private readonly mouth: { joints: Joint[]; axis: THREE.Vector3 }[] = [];
  private readonly tail: Joint[] = [];
  private readonly body: Joint;
  private readonly root: THREE.Bone;
  private readonly rootRestY: number;
  private readonly delta = new THREE.Quaternion();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();

  /**
   * Distancia que avanza el cuerpo por ciclo completo de marcha (m, escala 1).
   * Cada pata apoya medio ciclo y en ese tiempo su punta barre 2·r·sin(SWING)
   * en la tangente del giro; de eso, lo que va en Z es ·|afuera.x|. Las patas
   * medias (laterales) barren más que las diagonales: se usa el promedio.
   */
  readonly strideLength: number;

  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    const find = (name: string) => {
      const b = model.getObjectByName(name) as THREE.Bone | undefined;
      if (!b?.isBone) throw new Error(`Cascarudo: falta el hueso "${name}" en el rig`);
      return b;
    };
    const modelInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const joint = (bone: THREE.Bone): Joint => {
      const m = new THREE.Matrix4().multiplyMatrices(modelInv, bone.parent!.matrixWorld);
      const parent = new THREE.Quaternion().setFromRotationMatrix(m.extractRotation(m));
      return { bone, rest: bone.quaternion.clone(), parent, parentInv: parent.clone().invert() };
    };
    const chain = (base: THREE.Bone) => {
      const out: THREE.Bone[] = [base];
      while (out.at(-1)!.children.some((c) => (c as THREE.Bone).isBone)) {
        out.push(out.at(-1)!.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone);
      }
      return out;
    };
    const modelPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(modelInv);

    let sweepSum = 0;
    for (const def of LEGS) {
      const bones = chain(find(def.base));
      const hipPos = modelPos(bones[0]);
      const tipPos = modelPos(bones.at(-1)!);
      const outward = tipPos.clone().sub(hipPos).setY(0);
      const reach = outward.length();
      outward.normalize();
      this.legs.push({
        hip: joint(bones[0]),
        knee: joint(bones[1]),
        ankle: joint(bones[2]),
        tip: bones.at(-1)!,
        row: def.row,
        side: def.side,
        liftAxis: new THREE.Vector3().crossVectors(outward, UP).normalize(),
        phase: def.phase,
      });
      sweepSum += 2 * reach * Math.sin(SWING) * Math.abs(outward.x);
    }
    this.strideLength = 2 * (sweepSum / LEGS.length);

    for (const name of MOUTH) {
      const bones = chain(find(name));
      const dir = modelPos(bones.at(-1)!).sub(modelPos(bones[0])).setY(0).normalize();
      this.mouth.push({ joints: bones.slice(0, 3).map(joint), axis: new THREE.Vector3().crossVectors(dir, UP).normalize() });
    }
    for (const b of chain(find(TAIL)).slice(0, 4)) this.tail.push(joint(b));
    this.body = joint(find("Bone_001"));
    this.root = find("Bone_000");
    this.rootRestY = this.root.position.y;
  }

  /**
   * Trípodes que apoyaron entre dos fases de marcha: bit 0 = A, bit 1 = B.
   * Una pata apoya cuando su fase cruza 0,5 (fin del vuelo).
   */
  static landings(prevGait: number, gait: number): number {
    let mask = 0;
    if (Math.floor(prevGait - 0.5) < Math.floor(gait - 0.5)) mask |= 1; // A: fase 0
    if (Math.floor(prevGait) < Math.floor(gait)) mask |= 2; // B: fase 0.5
    return mask;
  }

  /** Puntas (en el mundo) de las patas del trípode `tripod` (0 = A, 1 = B). */
  tripodTips(tripod: number, out: THREE.Vector3[]): void {
    let k = 0;
    for (const leg of this.legs) {
      if ((leg.phase === 0 ? 0 : 1) !== tripod) continue;
      leg.tip.getWorldPosition(out[k++]);
    }
  }

  /** Aplica Δ (espacio del modelo) sobre la rotación de reposo de la articulación. */
  private set(j: Joint, delta: THREE.Quaternion): void {
    // q = padre⁻¹ · Δ · padre · reposo
    j.bone.quaternion.copy(j.parentInv).multiply(delta).multiply(j.parent).multiply(j.rest);
  }

  private axisAngle(axis: THREE.Vector3, angle: number): THREE.Quaternion {
    return this.delta.setFromAxisAngle(axis, angle);
  }

  apply(p: CascarudoPose): void {
    const { stride, death, attack, hurt, time, seed } = p;
    const alive = 1 - death;
    const rear = p.rear * alive;
    // Temblor nervioso constante (más fuerte herido).
    const jitter = (k: number) => Math.sin(time * (23 + k * 7.3) + seed * 13.1 + k) * (0.02 + hurt * 0.12);

    // --- Patas ------------------------------------------------------------------
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      const ph = (((p.gait + leg.phase) % 1) + 1) % 1;
      let forward: number;
      let lift: number;
      if (ph < 0.5) {
        // Vuelo: la pata viaja de atrás hacia adelante, levantada.
        const s = ph / 0.5;
        forward = -Math.cos(Math.PI * s);
        lift = Math.sin(Math.PI * s);
      } else {
        // Apoyo: barre hacia atrás a velocidad constante (sin patinar).
        forward = 1 - 2 * ((ph - 0.5) / 0.5);
        lift = 0;
      }
      forward *= stride;
      lift *= Math.min(1, stride * 1.6);

      // Muerte: patas encogidas sobre el vientre, pataleando cada vez más lento.
      const kick = Math.sin(time * (9 + i * 1.7) + seed + i * 2.1) * 0.5 + 0.5;
      const twitch = death * kick * Math.max(0, 1 - p.deathTime / 5);

      // Erguido: delanteras en alto y abiertas (garras que tiemblan), traseras
      // estiradas hacia abajo para sostener el cuerpo inclinado.
      // Medias y traseras bajan para seguir apoyadas: el cuerpo pivota hacia atrás.
      const claw = leg.row === 1 ? rear * (0.75 + Math.sin(time * 17 + i) * 0.08) : leg.row === -1 ? -rear * 0.05 : -rear * 0.3;
      const swingAngle = leg.side * (forward * SWING * alive + (leg.row === 1 ? rear * 0.35 : 0)) + jitter(i) * 0.5;
      const liftAngle = lift * LIFT * alive - death * (0.55 + twitch * 0.35) + claw + attack * 0.15 * (i < 3 ? 1 : 0.5);
      const fold = lift * KNEE_FOLD * alive + death * (0.9 + twitch * 0.5) + (leg.row === 1 ? rear * 0.5 : 0);

      // Cadera: giro en Y (avance) y luego elevación.
      this.tmpQ.setFromAxisAngle(UP, swingAngle);
      this.tmpQ2.setFromAxisAngle(leg.liftAxis, liftAngle);
      this.set(leg.hip, this.tmpQ.multiply(this.tmpQ2));
      // Rodilla y tobillo: se pliegan hacia abajo/adentro.
      this.set(leg.knee, this.axisAngle(leg.liftAxis, -fold * 0.5));
      this.set(leg.ankle, this.axisAngle(leg.liftAxis, -fold * 0.6));
    }

    // --- Boca -----------------------------------------------------------------
    const bite = attack > 0 ? Math.sin(time * 26) * 0.5 + 0.5 : 0;
    for (let i = 0; i < this.mouth.length; i++) {
      const m = this.mouth[i];
      const chew = Math.sin(time * (5 + i) + seed * 3 + i * 1.3) * 0.12;
      const gape = rear * (0.45 + Math.sin(time * 31 + i * 2) * 0.12);
      const angle = chew + gape + attack * (0.15 + bite * 0.3) + jitter(i + 6) * 2 - death * 0.6;
      for (let k = 0; k < m.joints.length; k++) this.set(m.joints[k], this.axisAngle(m.axis, angle * (k === 0 ? 1 : 0.6)));
    }

    // --- Cola -----------------------------------------------------------------
    const wave = p.gait * Math.PI * 2;
    for (let k = 0; k < this.tail.length; k++) {
      const sway = Math.sin(wave - k * 0.9 + seed) * 0.08 * (0.4 + stride) * alive;
      const curl = -0.06 * k * attack - 0.1 * k * rear + death * 0.25;
      this.tmpQ.setFromAxisAngle(UP, sway);
      this.tmpQ2.setFromAxisAngle(RIGHT, curl);
      this.set(this.tail[k], this.tmpQ.multiply(this.tmpQ2));
    }

    // --- Cuerpo ---------------------------------------------------------------
    // Dos rebotes por ciclo (uno por trípode) y balanceo lateral.
    const bob = Math.abs(Math.sin(wave)) * 0.035 * stride;
    const roll = Math.sin(wave) * 0.025 * stride + THREE.MathUtils.clamp(-p.turnRate * 0.06, -0.12, 0.12);
    // Erguirse levanta la cabeza (cabeceo negativo); la mordida la baja de golpe.
    const pitch = -rear * 0.4 + attack * 0.16 + hurt * Math.sin(time * 40) * 0.08 + Math.sin(time * 1.3 + seed) * 0.015;
    this.tmpQ.setFromAxisAngle(FORWARD, roll * alive);
    this.tmpQ2.setFromAxisAngle(RIGHT, pitch * alive);
    this.set(this.body, this.tmpQ.multiply(this.tmpQ2));
    // +0,2 (medido): con el cabeceo y las patas así, medias y traseras quedan a la altura de reposo.
    this.root.position.y = this.rootRestY + (bob + rear * 0.2 - attack * 0.06) * alive;
  }
}

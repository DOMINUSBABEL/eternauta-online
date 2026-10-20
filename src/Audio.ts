/**
 * Sonido: disparos, chillidos y pisadas de los cascarudos, impactos y viento.
 *
 * Sin archivos de audio: cada sonido se SINTETIZA al cargar con un
 * OfflineAudioContext (varias variantes por sonido, para que no se repitan) y
 * en el juego sólo se reproducen buffers, que es barato. Si más adelante hay
 * grabaciones reales, `config.assets.audioSamples` las usa en lugar del
 * sintetizador (por nombre de sonido).
 *
 * Mezcla:  voces → (panner HRTF + aire) → seco ─┐
 *                                  └→ envío → reverb (plaza entre edificios) ─┤→ compresor → salida
 *
 * - Posicional: el oyente es la cámara; las voces pueden seguir a un objeto
 *   (un cascarudo que chilla mientras corre). Lejos suenan más apagadas (filtro
 *   de aire) y con más reverberación (eco de las fachadas).
 * - El AudioContext se crea con el gesto de entrar al juego (política de
 *   autoplay de los navegadores).
 * - Banda sonora: un <audio> en streaming (no se decodifica entera en memoria)
 *   conectado al mismo mezclador, sin reverb (no suena "en la plaza"). Suena
 *   entera, deja unos segundos de viento y vuelve a empezar.
 */

import * as THREE from "three";

export type SoundName =
  | "gunshot"
  | "impact"
  | "hitFlesh"
  | "beastStep"
  | "playerStep"
  | "screech"
  | "shriek"
  | "deathScreech"
  | "chitter"
  | "hiss"
  | "bite"
  | "wind";

export interface PlayOptions {
  /** Posición en el mundo; sin posición, el sonido es "en la cabeza" (el arma propia). */
  position?: THREE.Vector3;
  /** Vector vivo que la voz sigue mientras suena (p. ej. `enemy.position`). */
  follow?: THREE.Vector3;
  /** Altura sumada a `position`/`follow` (m). */
  offsetY?: number;
  volume?: number;
  /** Velocidad de reproducción (también cambia el tono). */
  rate?: number;
  /** Variación aleatoria de la velocidad (±). */
  rateJitter?: number;
  /** Envío a la reverb (0..1); por defecto crece con la distancia. */
  wet?: number;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  air: BiquadFilterNode | null;
  send: GainNode;
  follow: THREE.Vector3 | null;
  offsetY: number;
  started: number;
  priority: number;
}

const SR = 44100;
const MAX_VOICES = 28;
/** Prioridad al robar voces: las pisadas y el viento ceden primero. */
const PRIORITY: Record<SoundName, number> = {
  gunshot: 5,
  deathScreech: 4,
  screech: 4,
  bite: 4,
  shriek: 3,
  hiss: 3,
  hitFlesh: 3,
  chitter: 2,
  impact: 1,
  beastStep: 1,
  playerStep: 1,
  wind: 0,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private readonly buffers = new Map<SoundName, AudioBuffer[]>();
  private readonly voices: Voice[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private ambience: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly listenerPos = new THREE.Vector3();
  private preparing: Promise<void> | null = null;
  private music: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | undefined;
  muted = false;

  constructor(
    private readonly settings: {
      enabled: boolean;
      masterVolume: number;
      sfxVolume: number;
      ambienceVolume: number;
      reverb: number;
      musicUrls: string[];
      musicVolume: number;
      musicPause: number;
    },
    private readonly samples: Partial<Record<SoundName, string[]>> = {},
  ) {}

  get ready(): boolean {
    return this.buffers.size > 0;
  }

  /** Sintetiza (o descarga) todos los sonidos. No necesita gesto del usuario. */
  prepare(): Promise<void> {
    if (!this.preparing) {
      this.prepareMusic();
      this.preparing = this.build();
    }
    return this.preparing;
  }

  /** Empieza a bajar la banda sonora durante la carga (reproducir requiere el gesto). */
  private prepareMusic(): void {
    if (!this.settings.enabled || this.music || typeof Audio === "undefined") return;
    const probe = document.createElement("audio");
    const url = this.settings.musicUrls.find((u) => {
      const type = u.endsWith(".webm") ? 'audio/webm; codecs="opus"' : u.endsWith(".m4a") ? 'audio/mp4; codecs="mp4a.40.2"' : "";
      return !type || probe.canPlayType(type) !== "";
    });
    if (!url) return;
    const el = new Audio();
    el.preload = "auto";
    el.src = url;
    el.addEventListener("ended", () => {
      clearTimeout(this.musicTimer);
      this.musicTimer = setTimeout(() => {
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      }, this.settings.musicPause * 1000);
    });
    el.addEventListener("error", () => console.warn("[Audio] no se pudo cargar la banda sonora", url));
    this.music = el;
  }

  private async build(): Promise<void> {
    const t0 = performance.now();
    const jobs: Promise<void>[] = [];
    const add = (name: SoundName, variants: number, duration: number, channels: number, synth: Synth) => {
      jobs.push(
        (async () => {
          const urls = this.samples[name];
          const list = urls?.length
            ? await Promise.all(urls.map((u) => loadSample(u)))
            : await Promise.all(Array.from({ length: variants }, (_, v) => render(duration, channels, (oc) => synth(oc, v))));
          this.buffers.set(name, list);
        })(),
      );
    };
    add("gunshot", 5, 0.9, 2, synthGunshot);
    add("impact", 4, 0.35, 1, synthImpact);
    add("hitFlesh", 5, 0.4, 1, synthHitFlesh);
    add("beastStep", 6, 0.6, 1, synthBeastStep);
    add("playerStep", 8, 0.25, 1, synthPlayerStep);
    add("screech", 4, 1.5, 1, synthScreech);
    add("shriek", 5, 0.55, 1, synthShriek);
    add("deathScreech", 3, 2.6, 1, synthDeath);
    add("chitter", 5, 0.8, 1, synthChitter);
    add("hiss", 3, 0.8, 1, synthHiss);
    add("bite", 4, 0.5, 1, synthBite);
    add("wind", 1, 14, 2, synthWind);
    await Promise.all(jobs);
    const wind = this.buffers.get("wind");
    if (wind && !this.samples.wind?.length) wind[0] = loopCrossfade(wind[0], 2);
    console.info(`[Audio] ${this.buffers.size} sonidos listos en ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Crea/reanuda el AudioContext. Llamar desde un gesto del usuario (clic en ENTRAR). */
  unlock(): void {
    if (!this.settings.enabled) return;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.connect(comp);
      this.dry = ctx.createGain();
      this.dry.gain.value = this.settings.sfxVolume;
      this.dry.connect(this.master);
      // Reverb: plaza abierta rodeada de fachadas (reflexiones tempranas + cola de ~2,3 s).
      const convolver = ctx.createConvolver();
      convolver.buffer = createImpulse(ctx, 2.3);
      const wet = ctx.createGain();
      wet.gain.value = this.settings.reverb * this.settings.sfxVolume;
      this.reverbIn = ctx.createGain();
      this.reverbIn.connect(convolver).connect(wet).connect(this.master);
      this.applyVolume();
    }
    void this.ctx.resume();
    void this.prepare().then(() => this.startAmbience());
    this.startMusic();
  }

  private startMusic(): void {
    const ctx = this.ctx;
    const el = this.music;
    if (!ctx || !el || this.musicGain) return;
    this.musicGain = ctx.createGain();
    // Fade-in largo: la música aparece de a poco detrás del viento.
    this.musicGain.gain.setValueAtTime(0, ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(this.settings.musicVolume, ctx.currentTime + 6);
    ctx.createMediaElementSource(el).connect(this.musicGain).connect(this.master);
    void el.play().catch((err) => console.warn("[Audio] la banda sonora no arrancó", err));
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  /** Pestaña en segundo plano: todo en silencio (el juego también se pausa). */
  private readonly handleVisibility = () => {
    if (!this.ctx) return;
    if (document.hidden) {
      void this.ctx.suspend();
      this.music?.pause();
    } else {
      void this.ctx.resume();
      // Si estaba en la pausa entre repeticiones, el timer la retoma solo.
      if (this.music && !this.music.ended && this.music.currentTime > 0) void this.music.play().catch(() => undefined);
    }
  };

  private applyVolume(): void {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.settings.masterVolume, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  private startAmbience(): void {
    const ctx = this.ctx;
    const buf = this.buffers.get("wind")?.[0];
    if (!ctx || !buf || this.ambience) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(this.settings.ambienceVolume, ctx.currentTime + 3);
    src.connect(g).connect(this.master);
    src.start();
    this.ambience = src;
    this.ambienceGain = g;
  }

  /**
   * Reproduce un sonido. `key` + `minGap` evitan que el mismo emisor repita un
   * sonido demasiado seguido (p. ej. un chillido por cada bala).
   */
  play(name: SoundName, opts: PlayOptions = {}, key?: string, minGap = 0): void {
    const ctx = this.ctx;
    const list = this.buffers.get(name);
    if (!ctx || !list || ctx.state !== "running") return;
    if (key) {
      const id = `${name}:${key}`;
      const last = this.lastPlayed.get(id) ?? -Infinity;
      if (ctx.currentTime - last < minGap) return;
      this.lastPlayed.set(id, ctx.currentTime);
    }
    this.reclaim(PRIORITY[name]);
    if (this.voices.length >= MAX_VOICES) return;

    const source = ctx.createBufferSource();
    source.buffer = list[(Math.random() * list.length) | 0];
    source.playbackRate.value = (opts.rate ?? 1) * (1 + rand(-1, 1) * (opts.rateJitter ?? 0.04));
    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    source.connect(gain);

    const where = opts.follow ?? opts.position;
    let panner: PannerNode | null = null;
    let air: BiquadFilterNode | null = null;
    let distance = 0;
    if (where) {
      air = ctx.createBiquadFilter();
      air.type = "lowpass";
      panner = new PannerNode(ctx, {
        panningModel: "HRTF",
        distanceModel: "inverse",
        refDistance: 4,
        rolloffFactor: 1.1,
        maxDistance: 150,
      });
      const p = this.tmp.copy(where);
      p.y += opts.offsetY ?? 0;
      setPannerPosition(panner, p, ctx.currentTime);
      distance = p.distanceTo(this.listenerPos);
      // Absorción del aire y de la nieve que cae: lejos, sin agudos.
      air.frequency.value = THREE.MathUtils.clamp(18000 * Math.exp(-distance / 35), 900, 18000);
      gain.connect(air).connect(panner).connect(this.dry);
    } else {
      gain.connect(this.dry);
    }
    const send = ctx.createGain();
    send.gain.value = opts.wet ?? THREE.MathUtils.clamp(0.15 + distance / 45, 0.15, 0.85);
    (panner ?? gain).connect(send).connect(this.reverbIn);

    const voice: Voice = {
      source,
      gain,
      panner,
      air,
      send,
      follow: opts.follow ?? null,
      offsetY: opts.offsetY ?? 0,
      started: ctx.currentTime,
      priority: PRIORITY[name],
    };
    this.voices.push(voice);
    source.onended = () => this.release(voice);
    source.start();
  }

  /** Si no hay lugar, corta la voz más vieja de menor prioridad que `priority`. */
  private reclaim(priority: number): void {
    if (this.voices.length < MAX_VOICES) return;
    let victim: Voice | null = null;
    for (const v of this.voices) {
      if (v.priority > priority) continue;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.started < victim.started)) victim = v;
    }
    if (!victim) return;
    try {
      victim.source.stop();
    } catch {
      /* ya terminó */
    }
    this.release(victim);
  }

  private release(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i < 0) return;
    this.voices.splice(i, 1);
    v.source.disconnect();
    v.gain.disconnect();
    v.air?.disconnect();
    v.panner?.disconnect();
    v.send.disconnect();
  }

  /** Oyente = cámara; voces que siguen a un objeto se actualizan. */
  update(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    camera.getWorldPosition(this.listenerPos);
    camera.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.setTargetAtTime(this.listenerPos.x, t, 0.02);
      l.positionY.setTargetAtTime(this.listenerPos.y, t, 0.02);
      l.positionZ.setTargetAtTime(this.listenerPos.z, t, 0.02);
      l.forwardX.setTargetAtTime(this.fwd.x, t, 0.02);
      l.forwardY.setTargetAtTime(this.fwd.y, t, 0.02);
      l.forwardZ.setTargetAtTime(this.fwd.z, t, 0.02);
      l.upX.setTargetAtTime(this.up.x, t, 0.02);
      l.upY.setTargetAtTime(this.up.y, t, 0.02);
      l.upZ.setTargetAtTime(this.up.z, t, 0.02);
    } else {
      // Firefox: API vieja.
      l.setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
    for (const v of this.voices) {
      if (!v.follow || !v.panner) continue;
      const p = this.tmp.copy(v.follow);
      p.y += v.offsetY;
      setPannerPosition(v.panner, p, t);
      v.air?.frequency.setTargetAtTime(THREE.MathUtils.clamp(18000 * Math.exp(-p.distanceTo(this.listenerPos) / 35), 900, 18000), t, 0.05);
    }
  }

  dispose(): void {
    clearTimeout(this.musicTimer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    if (this.music) {
      this.music.pause();
      this.music.removeAttribute("src");
      this.music.load();
    }
    for (const v of [...this.voices]) this.release(v);
    this.ambience?.stop();
    this.ambienceGain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
  }
}

function setPannerPosition(p: PannerNode, v: THREE.Vector3, t: number): void {
  if (p.positionX) {
    p.positionX.setTargetAtTime(v.x, t, 0.02);
    p.positionY.setTargetAtTime(v.y, t, 0.02);
    p.positionZ.setTargetAtTime(v.z, t, 0.02);
  } else {
    p.setPosition(v.x, v.y, v.z);
  }
}

async function loadSample(url: string): Promise<AudioBuffer> {
  const data = await (await fetch(url)).arrayBuffer();
  // Decodificar no necesita un AudioContext "vivo": alcanza uno offline.
  return new OfflineAudioContext(2, SR, SR).decodeAudioData(data);
}

// =============================================================================
// Síntesis
// =============================================================================

type Synth = (oc: OfflineAudioContext, variant: number) => void;

async function render(duration: number, channels: number, synth: (oc: OfflineAudioContext) => void, peak = 0.9): Promise<AudioBuffer> {
  const oc = new OfflineAudioContext(channels, Math.ceil(duration * SR), SR);
  synth(oc);
  const buffer = await oc.startRendering();
  // Normalizar el pico: el volumen relativo lo decide quien reproduce.
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  }
  if (max > 0) {
    const k = peak / max;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return buffer;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(oc: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(oc);
  if (!b) {
    b = oc.createBuffer(1, oc.sampleRate * 3, oc.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(oc, b);
  }
  return b;
}

/** Ruido blanco desde `t` durante `dur` s (offset aleatorio en el buffer). */
function noise(oc: BaseAudioContext, t: number, dur: number): AudioBufferSourceNode {
  const s = oc.createBufferSource();
  s.buffer = noiseBuffer(oc);
  s.start(t, Math.random() * 2, dur);
  return s;
}

function filter(oc: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = oc.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Ganancia con envolvente: sube a `peak` en `attack` s y cae exponencialmente en `decay` s. */
function envGain(oc: BaseAudioContext, t: number, attack: number, peak: number, decay: number): GainNode {
  const g = oc.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + Math.max(attack, 0.0005));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function osc(oc: BaseAudioContext, type: OscillatorType, t: number, dur: number): OscillatorNode {
  const o = oc.createOscillator();
  o.type = type;
  o.start(t);
  o.stop(t + dur);
  return o;
}

/** Saturación suave (tanh): da cuerpo y "aspereza" sin recortar duro. */
function shaper(oc: BaseAudioContext, drive: number): WaveShaperNode {
  const w = oc.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  w.curve = curve;
  w.oversample = "2x";
  return w;
}

/** Curva de automatización por puntos [t, valor] con rampas exponenciales. */
function glide(param: AudioParam, points: [number, number][], scale = 1): void {
  param.setValueAtTime(points[0][1] * scale, points[0][0]);
  for (let i = 1; i < points.length; i++) param.exponentialRampToValueAtTime(points[i][1] * scale, points[i][0]);
}

/** Tren de granos de ruido filtrado: nieve que cruje, quitina que se quiebra. */
function grains(
  oc: BaseAudioContext,
  out: AudioNode,
  count: number,
  start: number,
  spread: number,
  band: [number, number],
  gain: [number, number],
  len: [number, number] = [0.003, 0.01],
): void {
  for (let i = 0; i < count; i++) {
    const t = start + Math.pow(Math.random(), 1.6) * spread;
    const dur = rand(len[0], len[1]);
    const src = noise(oc, t, dur + 0.01);
    const bp = filter(oc, "bandpass", rand(band[0], band[1]), rand(1, 3));
    const g = envGain(oc, t, 0.0005, rand(gain[0], gain[1]), dur);
    src.connect(bp).connect(g).connect(out);
  }
}

// --- Disparo -----------------------------------------------------------------

/**
 * Fusil: chasquido supersónico + estampido (ruido con filtro que se cierra) +
 * golpe grave + mecanismo + ecos tempranos de las fachadas (paneados). La cola
 * larga la agrega la reverb de la escena.
 */
const synthGunshot: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(shaper(oc, 2.2)).connect(oc.destination);
  const t = 0;
  // Chasquido (onda de choque).
  noise(oc, t, 0.03).connect(filter(oc, "highpass", 2500)).connect(envGain(oc, t, 0.0004, 1.2, 0.018)).connect(out);
  // Estampido: banda ancha que se oscurece rápido.
  const body = filter(oc, "lowpass", 3200, 0.8);
  glide(body.frequency, [
    [t, 3800],
    [t + 0.05, 1400],
    [t + 0.25, 420],
  ]);
  noise(oc, t, 0.45).connect(body).connect(envGain(oc, t, 0.001, 0.9, 0.32 + rand(0, 0.06))).connect(out);
  // "Ladrido" medio.
  noise(oc, t, 0.2).connect(filter(oc, "bandpass", rand(650, 900), 1)).connect(envGain(oc, t, 0.001, 0.7, 0.11)).connect(out);
  // Golpe en el pecho.
  const thump = osc(oc, "sine", t, 0.3);
  glide(thump.frequency, [
    [t, rand(140, 165)],
    [t + 0.12, 42],
  ]);
  thump.connect(envGain(oc, t, 0.001, 1.3, 0.22)).connect(out);
  // Mecanismo del arma (cerrojo).
  for (const dt of [0.075 + rand(0, 0.01), 0.11 + rand(0, 0.015)]) {
    noise(oc, t + dt, 0.03).connect(filter(oc, "bandpass", rand(3400, 4600), 7)).connect(envGain(oc, t + dt, 0.0005, 0.18, 0.02)).connect(out);
  }
  // Ecos tempranos: la plaza está rodeada de edificios.
  const echoes: [number, number, number, number][] = [
    [0.09 + rand(0, 0.03), 0.28, 1900, -0.6],
    [0.2 + rand(0, 0.04), 0.18, 1300, 0.7],
    [0.36 + rand(0, 0.06), 0.1, 900, -0.3],
  ];
  for (const [dt, g, lp, pan] of echoes) {
    const p = oc.createStereoPanner();
    p.pan.value = pan;
    noise(oc, t + dt, 0.35).connect(filter(oc, "lowpass", lp)).connect(envGain(oc, t + dt, 0.004, g, 0.22)).connect(p).connect(out);
  }
};

/** Bala en el escenario: golpe sordo en la nieve/piedra y esquirlas. */
const synthImpact: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  noise(oc, 0, 0.25).connect(filter(oc, "lowpass", rand(700, 1100))).connect(envGain(oc, 0, 0.001, 0.8, 0.13)).connect(out);
  const th = osc(oc, "sine", 0, 0.12);
  glide(th.frequency, [
    [0, 130],
    [0.07, 55],
  ]);
  th.connect(envGain(oc, 0, 0.001, 0.5, 0.08)).connect(out);
  noise(oc, 0, 0.01).connect(filter(oc, "highpass", 3500)).connect(envGain(oc, 0, 0.0003, 0.6, 0.008)).connect(out);
  grains(oc, out, 6, 0.01, 0.15, [2500, 5000], [0.05, 0.15]);
};

/** Bala en un cascarudo: crujido de quitina + golpe húmedo + salpicadura. */
const synthHitFlesh: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(shaper(oc, 1.6)).connect(oc.destination);
  // Quitina que se quiebra.
  noise(oc, 0, 0.02).connect(filter(oc, "highpass", 2800)).connect(envGain(oc, 0, 0.0003, 0.8, 0.012)).connect(out);
  grains(oc, out, 5, 0.002, 0.03, [1800, 4200], [0.2, 0.45], [0.002, 0.006]);
  // Golpe en la carne.
  const th = osc(oc, "sine", 0, 0.15);
  glide(th.frequency, [
    [0, rand(170, 210)],
    [0.06, 65],
  ]);
  th.connect(envGain(oc, 0, 0.001, 0.9, 0.08)).connect(out);
  // Chapoteo: banda que baja (líquido espeso).
  const sq = filter(oc, "bandpass", 2400, 3);
  glide(sq.frequency, [
    [0.005, rand(2200, 2800)],
    [0.12, rand(380, 520)],
  ]);
  noise(oc, 0.005, 0.2).connect(sq).connect(envGain(oc, 0.005, 0.004, 1.0, 0.15)).connect(out);
  // Gotas que caen.
  grains(oc, out, 7, 0.05, 0.3, [800, 1800], [0.05, 0.14], [0.006, 0.015]);
};

// --- Pisadas -----------------------------------------------------------------

/** Pata de una bestia de 3,6 m sobre nieve: golpe grave, crujido y uña de quitina. */
const synthBeastStep: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(shaper(oc, 1.4)).connect(oc.destination);
  const th = osc(oc, "sine", 0, 0.5);
  glide(th.frequency, [
    [0, rand(68, 82)],
    [0.22, 34],
  ]);
  th.connect(envGain(oc, 0, 0.004, 1.0, 0.38)).connect(out);
  noise(oc, 0, 0.4).connect(filter(oc, "lowpass", 230)).connect(envGain(oc, 0, 0.003, 0.9, 0.28)).connect(out);
  // Nieve compactándose bajo el peso.
  grains(oc, out, 26 + ((Math.random() * 10) | 0), 0.005, 0.2, [900, 3000], [0.08, 0.3]);
  // Punta de la pata (quitina) contra el pavimento bajo la nieve.
  noise(oc, 0, 0.02).connect(filter(oc, "highpass", 2600)).connect(envGain(oc, 0, 0.0004, 0.3, 0.018)).connect(out);
  osc(oc, "sine", 0, 0.08).connect(envGain(oc, 0, 0.0005, 0.04, 0.05)).connect(out);
};

/** Bota del Eternauta en la nieve: crujido corto y apagado. */
const synthPlayerStep: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  grains(oc, out, 12 + ((Math.random() * 8) | 0), 0.003, 0.11, [1200, 4200], [0.12, 0.4]);
  noise(oc, 0, 0.12).connect(filter(oc, "lowpass", 500)).connect(envGain(oc, 0, 0.004, 0.5, 0.07)).connect(out);
  const th = osc(oc, "sine", 0, 0.1);
  th.frequency.value = rand(95, 120);
  th.connect(envGain(oc, 0, 0.002, 0.25, 0.06)).connect(out);
};

// --- Cascarudos --------------------------------------------------------------

/**
 * Voz de insecto gigante: dos sierras desafinadas + subarmónico (gruñido)
 * con vibrato rápido, saturadas y pasadas por tres formantes que se mueven
 * (le dan un timbre casi vocal), más un "raspado" de ruido modulado (como la
 * estridulación de un grillo) y un grave que les da masa.
 */
function insectVoice(
  oc: OfflineAudioContext,
  out: AudioNode,
  pitch: [number, number][],
  amp: [number, number][],
  vibrato: { rate: [number, number]; depth: number },
  rasp: number,
  formantShift = 1,
): void {
  const end = pitch[pitch.length - 1][0];
  const lfo = osc(oc, "sine", 0, end + 0.1);
  glide(lfo.frequency, [
    [0, vibrato.rate[0]],
    [end, vibrato.rate[1]],
  ]);
  const depth = oc.createGain();
  depth.gain.value = vibrato.depth;
  lfo.connect(depth);

  const mix = oc.createGain();
  const parts: [OscillatorType, number, number, number][] = [
    ["sawtooth", 1, 0, 0.5],
    ["sawtooth", 1, 22, 0.4],
    ["square", 0.5, 0, 0.35], // subarmónico
  ];
  for (const [type, ratio, detune, level] of parts) {
    const o = osc(oc, type, 0, end + 0.1);
    glide(o.frequency, pitch, ratio);
    o.detune.value = detune;
    depth.connect(o.frequency);
    const g = oc.createGain();
    g.gain.value = level;
    o.connect(g).connect(mix);
  }
  const dist = shaper(oc, 3);
  mix.connect(dist);

  const envelope = oc.createGain();
  envelope.gain.setValueAtTime(0, 0);
  for (const [t, v] of amp) envelope.gain.linearRampToValueAtTime(v, t);
  envelope.connect(out);

  for (const [f, q, level] of [
    [900, 5, 0.9],
    [1900, 6, 0.7],
    [3400, 7, 0.45],
  ] as const) {
    const bp = filter(oc, "bandpass", f * formantShift, q);
    bp.frequency.setValueAtTime(f * formantShift * rand(0.85, 1.0), 0);
    bp.frequency.linearRampToValueAtTime(f * formantShift * rand(1.0, 1.2), end * 0.4);
    bp.frequency.linearRampToValueAtTime(f * formantShift * rand(0.8, 0.95), end);
    const g = oc.createGain();
    g.gain.value = level;
    dist.connect(bp).connect(g).connect(envelope);
  }

  // Raspado: ruido en banda alta modulado en amplitud ~45 Hz.
  if (rasp > 0) {
    const am = oc.createGain();
    am.gain.value = 0.5;
    const square = osc(oc, "square", 0, end + 0.1);
    square.frequency.value = rand(38, 55);
    const amDepth = oc.createGain();
    amDepth.gain.value = 0.5;
    square.connect(amDepth).connect(am.gain);
    const level = oc.createGain();
    level.gain.value = rasp;
    noise(oc, 0, end + 0.1).connect(filter(oc, "bandpass", rand(2600, 3400), 1.2)).connect(am).connect(level).connect(envelope);
  }

  // Masa: un grave que acompaña (es un bicho de 3,6 m).
  const low = osc(oc, "sine", 0, end + 0.1);
  glide(low.frequency, pitch, 0.25);
  const lg = oc.createGain();
  lg.gain.value = 0.35;
  low.connect(lg).connect(envelope);
}

/** Chillido de alerta: sube de golpe, se sostiene vibrando y cae. */
const synthScreech: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  const f = rand(0.85, 1.15);
  insectVoice(
    oc,
    out,
    [
      [0, 160 * f],
      [0.22, 540 * f],
      [0.75, 430 * f],
      [1.4, 210 * f],
    ],
    [
      [0.05, 1],
      [0.9, 0.85],
      [1.4, 0],
    ],
    { rate: [26, 32], depth: 22 },
    0.4,
    rand(0.9, 1.1),
  );
};

/** Alarido corto al recibir un balazo. */
const synthShriek: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  const f = rand(0.85, 1.2);
  insectVoice(
    oc,
    out,
    [
      [0, 300 * f],
      [0.06, 780 * f],
      [0.48, 290 * f],
    ],
    [
      [0.02, 1],
      [0.25, 0.7],
      [0.5, 0],
    ],
    { rate: [36, 30], depth: 34 },
    0.55,
    rand(1, 1.25),
  );
};

/** Agonía: alarido que se desinfla, vibrato que se apaga y burbujeo húmedo. */
const synthDeath: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  const f = rand(0.85, 1.1);
  insectVoice(
    oc,
    out,
    [
      [0, 620 * f],
      [0.1, 900 * f],
      [1.2, 260 * f],
      [2.3, 110 * f],
    ],
    [
      [0.03, 1],
      [1.0, 0.75],
      [2.4, 0],
    ],
    { rate: [32, 5], depth: 40 },
    0.45,
    rand(0.85, 1),
  );
  // Gorgoteo: burbujas de hemolinfa en la garganta.
  for (let i = 0; i < 34; i++) {
    const t = rand(0.9, 2.4);
    const b = osc(oc, "sine", t, 0.05);
    glide(b.frequency, [
      [t, rand(110, 240)],
      [t + 0.035, rand(300, 520)],
    ]);
    b.connect(envGain(oc, t, 0.003, rand(0.08, 0.2), 0.03)).connect(out);
  }
  noise(oc, 1.0, 1.5).connect(filter(oc, "lowpass", 420)).connect(envGain(oc, 1.0, 0.3, 0.25, 1.1)).connect(out);
};

/** Castañeteo de mandíbulas (deambulando, cerca): clicks que se aceleran + ronroneo. */
const synthChitter: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  const n = 10 + ((Math.random() * 10) | 0);
  let t = 0.02;
  let gap = rand(0.06, 0.09);
  for (let i = 0; i < n && t < 0.72; i++) {
    noise(oc, t, 0.01).connect(filter(oc, "bandpass", rand(2400, 4600), 3)).connect(envGain(oc, t, 0.0003, rand(0.4, 0.8), 0.005)).connect(out);
    const ping = osc(oc, "sine", t, 0.03);
    ping.frequency.value = rand(1700, 2600);
    ping.connect(envGain(oc, t, 0.0005, 0.06, 0.02)).connect(out);
    t += gap * rand(0.8, 1.2);
    gap *= 0.93;
  }
  const purr = osc(oc, "sawtooth", 0, 0.8);
  purr.frequency.value = rand(60, 80);
  const am = oc.createGain();
  am.gain.value = 0.5;
  const lfo = osc(oc, "sine", 0, 0.8);
  lfo.frequency.value = rand(20, 28);
  const amd = oc.createGain();
  amd.gain.value = 0.5;
  lfo.connect(amd).connect(am.gain);
  purr.connect(filter(oc, "lowpass", 320)).connect(am).connect(envGain(oc, 0, 0.15, 0.35, 0.55)).connect(out);
};

/**
 * Siseo antes de morder: como la cucaracha silbadora de Madagascar (expulsa
 * aire por los espiráculos), pulsado y creciente.
 */
const synthHiss: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(oc.destination);
  const am = oc.createGain();
  am.gain.value = 0.7;
  const lfo = osc(oc, "sine", 0, 0.8);
  lfo.frequency.value = rand(18, 26);
  const d = oc.createGain();
  d.gain.value = 0.3;
  lfo.connect(d).connect(am.gain);
  const env = oc.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(0.35, 0.15);
  env.gain.linearRampToValueAtTime(1, 0.58);
  env.gain.exponentialRampToValueAtTime(0.001, 0.72);
  noise(oc, 0, 0.8).connect(filter(oc, "highpass", 2000)).connect(filter(oc, "bandpass", rand(4200, 5600), 0.7)).connect(am).connect(env).connect(out);
  // Resonancia grave del cuerpo hueco.
  noise(oc, 0, 0.8).connect(filter(oc, "bandpass", rand(420, 560), 6)).connect(envGain(oc, 0.1, 0.45, 0.25, 0.2)).connect(out);
};

/** Mordida: chasquido de mandíbulas, crujido y chapoteo. */
const synthBite: Synth = (oc) => {
  const out = oc.createGain();
  out.connect(shaper(oc, 1.8)).connect(oc.destination);
  noise(oc, 0, 0.02).connect(filter(oc, "highpass", 1500)).connect(envGain(oc, 0, 0.0003, 1, 0.015)).connect(out);
  const snap = osc(oc, "triangle", 0, 0.06);
  glide(snap.frequency, [
    [0, 950],
    [0.035, 180],
  ]);
  snap.connect(envGain(oc, 0, 0.0005, 0.5, 0.04)).connect(out);
  grains(oc, out, 12, 0.015, 0.14, [700, 2600], [0.15, 0.4], [0.004, 0.012]);
  const sq = filter(oc, "bandpass", 1800, 4);
  glide(sq.frequency, [
    [0.02, 1900],
    [0.2, 300],
  ]);
  noise(oc, 0.02, 0.3).connect(sq).connect(envGain(oc, 0.02, 0.01, 0.6, 0.22)).connect(out);
  const th = osc(oc, "sine", 0, 0.2);
  glide(th.frequency, [
    [0, 120],
    [0.12, 50],
  ]);
  th.connect(envGain(oc, 0, 0.002, 0.7, 0.14)).connect(out);
};

// --- Ambiente ----------------------------------------------------------------

/** Viento de la nevada entre los edificios (estéreo, se repite sin costura). */
const synthWind: Synth = (oc) => {
  const dur = oc.length / SR;
  const merger = oc.createChannelMerger(2);
  merger.connect(oc.destination);
  for (let ch = 0; ch < 2; ch++) {
    // Ráfagas: filtro y volumen con curvas suaves y aleatorias.
    const lp = filter(oc, "lowpass", 600, 0.6);
    lp.frequency.setValueCurveAtTime(smoothCurve(64, 260, 950), 0, dur);
    const g = oc.createGain();
    g.gain.setValueCurveAtTime(smoothCurve(64, 0.35, 1), 0, dur);
    noise(oc, 0, dur).connect(lp).connect(g).connect(merger, 0, ch);
    // Silbido en aristas y cornisas.
    const bp = filter(oc, "bandpass", 900, 14);
    bp.frequency.setValueCurveAtTime(smoothCurve(48, 650, 1400), 0, dur);
    const wg = oc.createGain();
    wg.gain.setValueCurveAtTime(smoothCurve(48, 0, 0.35), 0, dur);
    noise(oc, 0, dur).connect(bp).connect(wg).connect(merger, 0, ch);
  }
};

/** Curva aleatoria suave (interpolación coseno entre puntos al azar). */
function smoothCurve(points: number, min: number, max: number): Float32Array {
  const keys = Array.from({ length: 9 }, () => rand(min, max));
  const out = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * (keys.length - 1);
    const k = Math.floor(x);
    const f = (1 - Math.cos((x - k) * Math.PI)) / 2;
    out[i] = keys[k] + (keys[Math.min(k + 1, keys.length - 1)] - keys[k]) * f;
  }
  return out;
}

/**
 * Loop sin costura: funde los últimos `seconds` sobre el principio y recorta
 * ese tramo final (el loop termina justo donde empieza la mezcla).
 */
function loopCrossfade(buffer: AudioBuffer, seconds: number): AudioBuffer {
  const n = Math.floor(seconds * buffer.sampleRate);
  const len = buffer.length - n;
  const out = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < n; i++) {
      const a = i / n;
      dst[i] = src[i] * Math.sqrt(a) + src[len + i] * Math.sqrt(1 - a);
    }
  }
  return out;
}

/**
 * Respuesta al impulso de una plaza rodeada de fachadas: reflexiones tempranas
 * discretas (edificios a 15-60 m) y una cola difusa que pierde agudos.
 */
function createImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(seconds * ctx.sampleRate);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      // Los agudos se apagan antes que los graves (aire, nieve).
      const damp = Math.min(0.97, 0.25 + t * 0.6);
      lp = lp * damp + (Math.random() * 2 - 1) * (1 - damp);
      d[i] = lp * Math.exp(-t / (seconds * 0.28)) * Math.min(1, t / 0.02);
    }
    for (let k = 0; k < 7; k++) {
      const t = rand(0.04, 0.38);
      const i = Math.floor(t * ctx.sampleRate);
      const g = 0.6 * Math.exp(-t * 4) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 40 && i + j < len; j++) d[i + j] += g * Math.exp(-j / 8) * (Math.random() * 0.6 + 0.4);
    }
  }
  return ir;
}

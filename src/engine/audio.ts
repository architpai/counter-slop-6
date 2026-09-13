import { clamp, rand } from './util';
import { TUNES, scheduleStep } from './audio.tunes';
import type { TuneKey } from './audio.tunes';
import type { Vector3 } from 'three';

declare global {
  /** Safari's prefixed constructor. Absent from `lib.dom`, absent at runtime elsewhere. */
  var webkitAudioContext: typeof AudioContext | undefined;
}

/** The music sub-mix. `voices` counts live notes so a stopped bus outlives its tail. */
interface MusicBus {
  node: GainNode;
  voices: number;
  stopped: boolean;
}

/** The single grapple reel loop. */
interface Reel {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** What a cue hands to `#noise` or `#tone`. */
interface Cue {
  freq: number;
  /** Sweep target. Absent holds `freq`. */
  end?: number;
  duration: number;
  gain: number;
  Q?: number;
  attack?: number;
  highpass?: number;
  delay?: number;
  /** World position: makes the voice positional. Absent means centred. */
  pos?: Vector3;
  /** Music bus. Bypasses the positional stage. */
  output?: MusicBus;
  /** Absolute start time. Absent means now. */
  at?: number;
}
interface NoiseCue extends Cue { type?: BiquadFilterType }
interface ToneCue extends Cue { type?: OscillatorType }

/** The same cue once `#noise` / `#tone` have filled their defaults in. */
interface NoiseVoice extends NoiseCue { type: BiquadFilterType; attack: number }
interface ToneVoice extends ToneCue { type: OscillatorType; attack: number }

/**
 * `#voice` arguments as a pair, so testing the flag narrows the options with it.
 */
type VoiceArgs = [options: NoiseVoice, noise: true] | [options: ToneVoice, noise: false];

export class Audio {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  #noiseBuffer: AudioBuffer | null = null;
  #eye = { x: 0, y: 0, z: 0 };
  #right = { x: 1, z: 0 };
  #tune: TuneKey = 'downtown';
  #intensity = 0;
  #musicWanted = false;
  #musicBus: MusicBus | null = null;
  /** `Window.setInterval` handle, a number. Never `NodeJS.Timeout`. */
  #musicTimer: number | null = null;
  #nextStep = 0;
  #nextAt = 0;
  #reel: Reel | null = null;

  get ctx(): AudioContext | null { return this.#ctx; }
  get musicPlaying(): boolean { return this.#musicTimer !== null && this.#ctx?.state === 'running'; }

  init(): void {
    if (this.#ctx) return;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    let context: AudioContext | undefined;
    try {
      context = new Context();
      const master = context.createGain();
      master.gain.value = 0.55;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 5;
      master.connect(compressor);
      compressor.connect(context.destination);
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = rand(-1, 1);
      this.#ctx = context;
      this.#master = master;
      this.#noiseBuffer = buffer;
    } catch {
      context?.close().catch(() => {});
    }
  }

  dispose(): void {
    this.reelLoop(false);
    this.music(false);
    this.#stopMusic();
    const context = this.#ctx;
    this.#ctx = null;
    this.#master = null;
    this.#noiseBuffer = null;
    context?.close().catch(() => {});
  }

  resume(): void {
    const context = this.#ctx;
    if (!context || context.state === 'closed') return;
    if (context.state === 'running') {
      if (this.#musicWanted) this.#startMusic();
      return;
    }
    context.resume().then(() => {
      if (this.#musicWanted) this.#startMusic();
    }).catch(() => {}); // The next user gesture or the main-loop retry can resume it.
  }

  setListener(eye: Vector3, right: Vector3): void {
    if (eye && [eye.x, eye.y, eye.z].every(Number.isFinite)) {
      this.#eye.x = eye.x;
      this.#eye.y = eye.y;
      this.#eye.z = eye.z;
    }
    if (right && Number.isFinite(right.x) && Number.isFinite(right.z)) {
      this.#right.x = right.x;
      this.#right.z = right.z;
    }
  }

  setTune(key: string): void {
    const tune: TuneKey = key === 'mexico' ? 'mexico' : 'downtown';
    if (tune === this.#tune) return;
    const running = this.#musicTimer !== null;
    this.#tune = tune;
    if (running) {
      this.#stopMusic();
      this.#startMusic();
    }
  }

  music(on: boolean): void {
    this.#musicWanted = Boolean(on);
    if (on) this.#startMusic();
    else this.#stopMusic();
  }

  setIntensity(v: number): void { this.#intensity = Number.isFinite(v) ? clamp(v, 0, 1) : 0; }

  #startMusic(): void {
    const context = this.#ctx;
    const master = this.#master;
    if (this.#musicTimer !== null || context?.state !== 'running' || !master) return;
    const node = context.createGain();
    node.gain.value = 0.05;
    node.connect(master);
    this.#musicBus = { node, voices: 0, stopped: false };
    this.#nextStep = 0;
    this.#nextAt = context.currentTime + 0.1;
    this.#musicTimer = window.setInterval(() => this.#scheduleMusic(), 100);
    this.#scheduleMusic();
  }

  #stopMusic(): void {
    if (this.#musicTimer !== null) window.clearInterval(this.#musicTimer);
    this.#musicTimer = null;
    const bus = this.#musicBus;
    this.#musicBus = null;
    if (!bus) return;
    bus.stopped = true;
    const context = this.#ctx;
    if (context) bus.node.gain.setTargetAtTime(0, context.currentTime, 0.2);
    if (!bus.voices) bus.node.disconnect();
  }

  #scheduleMusic(): void {
    const context = this.#ctx;
    if (context?.state !== 'running' || !this.#musicBus) return;
    const now = context.currentTime;
    if (this.#nextAt < now - 0.8) this.#nextAt = now + 0.05;
    const tune = TUNES[this.#tune];
    const output = this.#musicBus;
    while (this.#nextAt < now + 0.7) {
      scheduleStep(this.#tune, this.#nextStep, this.#nextAt, this.#intensity,
        options => this.#tone({ ...options, output }),
        options => this.#noise({ ...options, attack: 0.003, output }));
      this.#nextAt += 60 / tune.bpm / 4;
      this.#nextStep = (this.#nextStep + 1) % tune.steps;
    }
  }

  #noise(options: NoiseCue): void { this.#voice({ type: 'lowpass', attack: 0.002, ...options }, true); }
  #tone(options: ToneCue): void { this.#voice({ type: 'sine', attack: 0.005, ...options }, false); }

  #voice(...[options, noise]: VoiceArgs): void {
    const { freq, end, duration, Q = 1, attack, highpass, delay = 0, pos, output, at } = options;
    let { gain } = options;
    const context = this.#ctx;
    const master = this.#master;
    if (context?.state !== 'running' || !master || !(gain > 0)) return;
    const start = (at ?? context.currentTime) + delay;
    const source = noise ? context.createBufferSource() : context.createOscillator();
    const envelope = context.createGain();
    const nodes: AudioNode[] = [source, envelope];
    let tail: AudioNode = source;
    // `noise` chose the node kind on the line above; both halves are tested so
    // the options and the node narrow together.
    if (noise && source instanceof AudioBufferSourceNode) {
      source.buffer = this.#noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = options.type;
      filter.Q.value = Q;
      this.#sweep(filter.frequency, freq, end, start, duration);
      source.connect(filter);
      nodes.push(filter);
      tail = filter;
      if (highpass) {
        const high = context.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.value = highpass;
        tail.connect(high);
        nodes.push(high);
        tail = high;
      }
    } else if (!noise && source instanceof OscillatorNode) {
      source.type = options.type;
      this.#sweep(source.frequency, freq, end, start, duration);
    }
    tail.connect(envelope);
    let destination: AudioNode = output?.node || master;
    if (!output && pos && [pos.x, pos.y, pos.z].every(Number.isFinite)) {
      const dx = pos.x - this.#eye.x;
      const dy = pos.y - this.#eye.y;
      const dz = pos.z - this.#eye.z;
      const distance = Math.hypot(dx, dy, dz);
      gain /= 1 + 0.09 * distance;
      if (distance > 0.5 && typeof context.createStereoPanner === 'function') {
        const pan = context.createStereoPanner();
        pan.pan.value = clamp((dx * this.#right.x + dz * this.#right.z) / distance, -1, 1) * 0.75;
        pan.connect(destination);
        nodes.push(pan);
        destination = pan;
      }
    }
    envelope.connect(destination);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, gain), start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    if (output) output.voices++;
    source.onended = () => {
      for (const node of nodes) node.disconnect();
      if (output && --output.voices === 0 && output.stopped) output.node.disconnect();
    };
    if (source instanceof AudioBufferSourceNode) source.start(start, rand(0, 1.5));
    else source.start(start);
    source.stop(start + duration + 0.05);
  }

  #sweep(param: AudioParam, freq: number, end: number | undefined, start: number, duration: number): void {
    param.setValueAtTime(Math.max(20, freq), start);
    if (end !== undefined) param.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
  }

  reelLoop(on: boolean): void {
    if (!on) {
      const reel = this.#reel;
      if (!reel) return;
      const stopping = this.#ctx;
      if (stopping) {
        reel.gain.gain.setTargetAtTime(0, stopping.currentTime, 0.05);
        reel.source.stop(stopping.currentTime + 0.3);
      }
      this.#reel = null;
      return;
    }
    const context = this.#ctx;
    const master = this.#master;
    if (this.#reel || context?.state !== 'running' || !master) return;
    const source = context.createBufferSource();
    source.buffer = this.#noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.setTargetAtTime(0.05, context.currentTime, 0.12);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(context.currentTime, rand(0, 1.5));
    this.#reel = { source, gain };
  }

  shot(pos?: Vector3): void {
    this.#noise({ type: 'bandpass', freq: 1200, end: 250, Q: 0.7, duration: 0.17, gain: 0.7, pos });
    this.#noise({ type: 'highpass', freq: 2800, duration: 0.06, gain: 0.45, pos });
    this.#tone({ type: 'triangle', freq: 160, end: 40, duration: 0.15, gain: 0.6, pos });
  }
  mp5Fire(pos?: Vector3): void {
    this.#noise({ type: 'bandpass', freq: 1550, end: 420, Q: 0.7, duration: 0.09, gain: 0.52, pos });
    this.#noise({ type: 'highpass', freq: 3400, duration: 0.028, gain: 0.32, pos });
    this.#tone({ type: 'triangle', freq: 185, end: 70, duration: 0.075, gain: 0.36, pos });
  }
  pistolFire(pos?: Vector3): void {
    this.#noise({ type: 'bandpass', freq: 1700, end: 240, duration: 0.13, gain: 0.62, pos });
    this.#noise({ type: 'highpass', freq: 3200, duration: 0.035, gain: 0.4, pos });
    this.#tone({ type: 'triangle', freq: 210, end: 65, duration: 0.11, gain: 0.42, pos });
  }
  shotgunFire(): void {
    this.#noise({ freq: 1800, end: 120, duration: 0.32, gain: 0.9 });
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.08, gain: 0.5 });
    this.#tone({ type: 'triangle', freq: 110, end: 30, duration: 0.28, gain: 0.7 });
  }
  sniperFire(): void {
    this.#noise({ type: 'bandpass', freq: 1400, end: 90, Q: 0.5, duration: 0.45, gain: 0.95 });
    this.#noise({ type: 'highpass', freq: 3500, duration: 0.07, gain: 0.7 });
    this.#tone({ type: 'sawtooth', freq: 260, end: 30, duration: 0.4, gain: 0.8 });
    this.#tone({ freq: 1800, end: 400, duration: 0.5, gain: 0.16, delay: 0.05 });
  }
  revolver(): void {
    this.#noise({ type: 'bandpass', freq: 900, end: 180, Q: 0.6, duration: 0.22, gain: 0.85 });
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.6 });
    this.#tone({ type: 'sawtooth', freq: 200, end: 35, duration: 0.22, gain: 0.7 });
    this.#tone({ freq: 2600, end: 900, duration: 0.12, gain: 0.12 });
  }
  pump(): void {
    this.#noise({ type: 'bandpass', freq: 1500, Q: 1.5, duration: 0.05, gain: 0.35 });
    this.#noise({ type: 'bandpass', freq: 900, Q: 1.5, duration: 0.06, gain: 0.35, delay: 0.09 });
  }
  shellCue(): void {
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.04, gain: 0.3 });
    this.#tone({ type: 'square', freq: 1400, end: 900, duration: 0.05, gain: 0.08 });
  }
  cylinder(): void {
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.05, gain: 0.3 });
    this.#tone({ type: 'square', freq: 700, end: 400, duration: 0.12, gain: 0.1, delay: 0.05 });
    this.#noise({ type: 'highpass', freq: 1800, duration: 0.06, gain: 0.35, delay: 1.6 });
  }
  reload(): void {
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.04, gain: 0.35 });
    this.#noise({ type: 'bandpass', freq: 600, Q: 2, duration: 0.12, gain: 0.2, delay: 0.25 });
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.05, gain: 0.4, delay: 0.9 });
    this.#tone({ type: 'square', freq: 900, end: 500, duration: 0.06, gain: 0.15, delay: 1.25 });
  }
  empty(): void { this.#noise({ type: 'highpass', freq: 3000, duration: 0.03, gain: 0.3 }); }
  winded(): void { this.#tone({ type: 'triangle', freq: 220, end: 140, duration: 0.14, gain: 0.1 }); }
  switchWeapon(): void { this.#noise({ type: 'bandpass', freq: 1800, Q: 1.5, duration: 0.05, gain: 0.25 }); }
  katanaSwing(): void { this.#noise({ type: 'bandpass', freq: 500, end: 3000, Q: 1.5, duration: 0.2, gain: 0.35 }); }
  katanaHit(): void {
    this.#noise({ freq: 900, end: 200, duration: 0.14, gain: 0.6 });
    this.#noise({ type: 'bandpass', freq: 2500, Q: 0.6, duration: 0.1, gain: 0.35 });
    this.#tone({ type: 'triangle', freq: 180, end: 70, duration: 0.12, gain: 0.4 });
  }
  parry(): void {
    for (const freq of [2200, 3300, 4700]) this.#tone({ freq, end: freq * 0.92, duration: 0.35, gain: 0.16 });
    this.#noise({ type: 'highpass', freq: 4000, duration: 0.05, gain: 0.5 });
  }
  perfectParry(): void {
    this.parry();
    this.#tone({ type: 'triangle', freq: 880, end: 1760, duration: 0.25, gain: 0.2, delay: 0.03 });
  }
  grappleFire(): void {
    this.#noise({ type: 'highpass', freq: 1500, duration: 0.1, gain: 0.4 });
    this.#tone({ type: 'sawtooth', freq: 500, end: 1500, duration: 0.18, gain: 0.18 });
  }
  grappleHit(): void {
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.04, gain: 0.45 });
    this.#tone({ type: 'square', freq: 300, end: 200, duration: 0.08, gain: 0.25 });
  }
  grappleRelease(): void { this.#tone({ type: 'sawtooth', freq: 900, end: 300, duration: 0.12, gain: 0.12 }); }
  footstep(vol: number): void { this.#noise({ freq: rand(400, 800), duration: 0.07, gain: 0.12 * vol }); }
  jump(): void {
    this.#tone({ type: 'triangle', freq: 260, end: 480, duration: 0.1, gain: 0.1 });
    this.#noise({ freq: 600, duration: 0.05, gain: 0.1 });
  }
  land(h: number): void { this.#noise({ freq: 350, duration: 0.14, gain: 0.15 + 0.35 * h }); }
  slide(): void { this.#noise({ freq: 1200, end: 300, duration: 0.45, gain: 0.18 }); }
  wallJump(): void {
    this.#noise({ freq: 700, duration: 0.08, gain: 0.25 });
    this.#tone({ type: 'triangle', freq: 300, end: 600, duration: 0.12, gain: 0.12 });
  }
  mantle(): void { this.#noise({ freq: 900, end: 300, duration: 0.2, gain: 0.2 }); }
  dash(): void { this.#noise({ type: 'bandpass', freq: 800, end: 2500, duration: 0.25, gain: 0.3 }); }
  hurt(): void {
    this.#tone({ type: 'sawtooth', freq: 200, end: 90, duration: 0.2, gain: 0.35 });
    this.#noise({ freq: 500, duration: 0.12, gain: 0.3 });
  }
  death(): void {
    this.#tone({ type: 'sawtooth', freq: 220, end: 30, duration: 1.2, gain: 0.4 });
    this.#noise({ freq: 800, end: 80, duration: 0.8, gain: 0.35 });
  }
  hitEnemy(pos: Vector3): void {
    this.#noise({ freq: 900, duration: 0.06, gain: 0.3, pos });
    this.#tone({ type: 'square', freq: rand(200, 260), end: 120, duration: 0.1, gain: 0.15, pos });
  }
  headshot(pos: Vector3): void {
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.5, pos });
    this.#tone({ type: 'triangle', freq: 1500, end: 500, duration: 0.09, gain: 0.2, pos });
  }
  kill(strong = false): void {
    this.#tone({ type: 'square', freq: 880, duration: 0.07, gain: 0.22 });
    this.#tone({ type: 'square', freq: 1320, duration: 0.16, gain: 0.2, delay: 0.07 });
    this.#tone({ freq: 140, end: 50, duration: 0.16, gain: strong ? 0.6 : 0.35 });
    if (strong) this.#tone({ type: 'triangle', freq: 1760, duration: 0.22, gain: 0.12, delay: 0.14 });
  }
  enemyDie(pos: Vector3): void {
    this.#tone({ type: 'sawtooth', freq: rand(160, 220), end: 40, duration: 0.4, gain: 0.3, pos });
    this.#noise({ freq: 600, end: 100, duration: 0.3, gain: 0.4, pos });
    this.#noise({ type: 'bandpass', freq: 1400, duration: 0.12, gain: 0.3, delay: 0.03, pos });
  }
  gib(pos: Vector3): void {
    this.#noise({ freq: 500, end: 120, duration: 0.2, gain: 0.45, pos });
    this.#noise({ type: 'bandpass', freq: 2000, Q: 0.8, duration: 0.1, gain: 0.3, delay: 0.02, pos });
  }
  spawn(pos: Vector3): void {
    for (let i = 0; i < 5; i++) this.#noise({ type: 'bandpass', freq: rand(2500, 5000), Q: 2, duration: 0.04, gain: 0.25, delay: i * 0.05, pos });
  }
  lunge(pos: Vector3): void { this.#tone({ type: 'sawtooth', freq: 200, end: 700, duration: 0.3, gain: 0.25, pos }); }
  bulletImpact(pos: Vector3): void { this.#noise({ type: 'highpass', freq: 1500, duration: 0.05, gain: 0.25, pos }); }
  ricochet(pos: Vector3): void { this.#tone({ freq: rand(2000, 3500), end: 800, duration: 0.15, gain: 0.12, pos }); }
  pickup(): void {
    this.#tone({ type: 'triangle', freq: 700, end: 1100, duration: 0.1, gain: 0.2 });
    this.#tone({ type: 'triangle', freq: 1100, end: 1500, duration: 0.15, gain: 0.2, delay: 0.09 });
  }
  wave(): void {
    [440, 554, 659, 880].forEach((freq, i) => this.#tone({ type: 'triangle', freq, duration: 0.22, gain: 0.18, delay: i * 0.11 }));
  }
  waveClear(): void {
    [659, 880, 1108, 1318].forEach((freq, i) => this.#tone({ type: 'triangle', freq, duration: 0.3, gain: 0.16, delay: i * 0.13 }));
  }
  focusIn(): void {
    this.#tone({ freq: 1200, end: 420, duration: 0.45, gain: 0.3 });
    this.#noise({ type: 'bandpass', freq: 2400, end: 500, Q: 1.2, duration: 0.35, gain: 0.2 });
  }
  focusSlash(): void {
    this.#noise({ type: 'bandpass', freq: 600, end: 4000, Q: 1.2, duration: 0.3, gain: 0.55 });
    this.#tone({ type: 'triangle', freq: 180, end: 60, duration: 0.3, gain: 0.55 });
    for (const freq of [1600, 2400]) this.#tone({ freq, end: freq * 0.6, duration: 0.35, gain: 0.14, delay: 0.04 });
  }
  explosion(pos: Vector3): void {
    this.#noise({ freq: 900, end: 60, duration: 0.7, gain: 0.9, pos });
    this.#tone({ type: 'triangle', freq: 80, end: 25, duration: 0.6, gain: 0.7, pos });
    this.#noise({ type: 'bandpass', freq: 3000, Q: 0.7, duration: 0.15, gain: 0.4, pos });
  }
  fuse(pos: Vector3): void { this.#noise({ type: 'highpass', freq: 5000, duration: 0.12, gain: 0.25, pos }); }
  flyerDive(pos: Vector3): void {
    this.#tone({ type: 'sawtooth', freq: 900, end: 300, duration: 0.35, gain: 0.2, pos });
    this.#noise({ type: 'bandpass', freq: 2500, end: 800, duration: 0.3, gain: 0.15, pos });
  }
  flyerBuzz(pos: Vector3): void { this.#tone({ type: 'sawtooth', freq: rand(380, 460), duration: 0.14, gain: 0.05, pos }); }
  stomp(pos: Vector3): void {
    this.#noise({ freq: 400, end: 60, duration: 0.4, gain: 0.8, pos });
    this.#tone({ freq: 60, end: 25, duration: 0.5, gain: 0.7, pos });
  }
  bossRoar(pos: Vector3): void {
    this.#tone({ type: 'sawtooth', freq: 90, end: 60, duration: 0.9, gain: 0.5, pos });
    this.#noise({ type: 'bandpass', freq: 500, Q: 0.8, duration: 0.8, gain: 0.4, pos });
  }
  shieldHit(pos: Vector3): void {
    this.#tone({ type: 'square', freq: rand(600, 800), end: 300, duration: 0.12, gain: 0.2, pos });
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.3, pos });
  }
  smash(pos: Vector3, big = false): void {
    this.#noise({ freq: big ? 900 : 1600, end: 200, duration: big ? 0.28 : 0.14, gain: big ? 0.7 : 0.45, pos });
    this.#noise({ type: 'highpass', freq: 3500, duration: 0.05, gain: 0.35, pos });
    this.#tone({ type: 'triangle', freq: big ? 120 : 220, end: 60, duration: 0.12, gain: 0.25, pos });
  }
  remoteShot(kind: string, pos: Vector3): void {
    if (kind === 'shotgun') {
      this.#noise({ freq: 1600, end: 150, duration: 0.32, gain: 1, pos });
      this.#tone({ type: 'triangle', freq: 95, end: 30, duration: 0.26, gain: 0.7, pos });
    } else if (kind === 'sniper') {
      this.#noise({ type: 'bandpass', freq: 750, end: 120, Q: 0.5, duration: 0.4, gain: 1, pos });
      this.#tone({ type: 'sawtooth', freq: 420, end: 50, duration: 0.32, gain: 0.5, pos });
    } else if (kind === 'pistol') this.pistolFire(pos);
    else if (kind === 'r4c') this.shot(pos);
    else this.mp5Fire(pos);
  }
  enemyShot(pos: Vector3): void {
    this.#noise({ type: 'bandpass', freq: rand(900, 1500), end: 200, Q: 0.8, duration: 0.14, gain: 0.5, pos });
    this.#tone({ type: 'square', freq: 220, end: 60, duration: 0.1, gain: 0.3, pos });
  }
  enemyShotgun(pos: Vector3): void {
    this.#noise({ freq: 1500, end: 150, duration: 0.3, gain: 0.7, pos });
    this.#tone({ type: 'triangle', freq: 90, end: 30, duration: 0.25, gain: 0.5, pos });
  }
  enemySniper(pos: Vector3): void {
    this.#noise({ type: 'bandpass', freq: 700, end: 120, Q: 0.5, duration: 0.35, gain: 0.7, pos });
    this.#tone({ type: 'sawtooth', freq: 400, end: 50, duration: 0.3, gain: 0.35, pos });
  }
  sniperAim(pos: Vector3): void { this.#tone({ freq: 1800, duration: 0.12, gain: 0.12, pos }); }
}

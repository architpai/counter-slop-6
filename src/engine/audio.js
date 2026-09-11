import { clamp, rand } from './util.js';
import { TUNES, scheduleStep } from './audio.tunes.js';

export class Audio {
  #ctx = null;
  #master = null;
  #noiseBuffer = null;
  #eye = { x: 0, y: 0, z: 0 };
  #right = { x: 1, z: 0 };
  #tune = 'downtown';
  #intensity = 0;
  #musicWanted = false;
  #musicBus = null;
  #musicTimer = null;
  #nextStep = 0;
  #nextAt = 0;
  #reel = null;

  get ctx() { return this.#ctx; }
  get musicPlaying() { return this.#musicTimer !== null && this.#ctx?.state === 'running'; }

  init() {
    if (this.#ctx) return;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    let context;
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

  dispose() {
    this.reelLoop(false);
    this.music(false);
    this.#stopMusic();
    const context = this.#ctx;
    this.#ctx = null;
    this.#master = null;
    this.#noiseBuffer = null;
    context?.close().catch(() => {});
  }

  resume() {
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

  setListener(eye, right) {
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

  setTune(key) {
    const tune = key === 'mexico' ? 'mexico' : 'downtown';
    if (tune === this.#tune) return;
    const running = this.#musicTimer !== null;
    this.#tune = tune;
    if (running) {
      this.#stopMusic();
      this.#startMusic();
    }
  }

  music(on) {
    this.#musicWanted = Boolean(on);
    if (on) this.#startMusic();
    else this.#stopMusic();
  }

  setIntensity(v) { this.#intensity = Number.isFinite(v) ? clamp(v, 0, 1) : 0; }

  #startMusic() {
    if (this.#musicTimer !== null || this.#ctx?.state !== 'running') return;
    const node = this.#ctx.createGain();
    node.gain.value = 0.05;
    node.connect(this.#master);
    this.#musicBus = { node, voices: 0, stopped: false };
    this.#nextStep = 0;
    this.#nextAt = this.#ctx.currentTime + 0.1;
    this.#musicTimer = setInterval(() => this.#scheduleMusic(), 100);
    this.#scheduleMusic();
  }

  #stopMusic() {
    if (this.#musicTimer !== null) clearInterval(this.#musicTimer);
    this.#musicTimer = null;
    const bus = this.#musicBus;
    this.#musicBus = null;
    if (!bus) return;
    bus.stopped = true;
    bus.node.gain.setTargetAtTime(0, this.#ctx.currentTime, 0.2);
    if (!bus.voices) bus.node.disconnect();
  }

  #scheduleMusic() {
    if (this.#ctx?.state !== 'running' || !this.#musicBus) return;
    const now = this.#ctx.currentTime;
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

  #noise(options) { this.#voice({ type: 'lowpass', attack: 0.002, ...options }, true); }
  #tone(options) { this.#voice({ type: 'sine', attack: 0.005, ...options }, false); }

  #voice({ type, freq, end, duration, gain, Q = 1, attack, highpass, delay = 0, pos, output, at }, noise) {
    const context = this.#ctx;
    if (context?.state !== 'running' || !(gain > 0)) return;
    const start = (at ?? context.currentTime) + delay;
    const source = noise ? context.createBufferSource() : context.createOscillator();
    const envelope = context.createGain();
    const nodes = [source, envelope];
    let tail = source;
    if (noise) {
      source.buffer = this.#noiseBuffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = type;
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
    } else {
      source.type = type;
      this.#sweep(source.frequency, freq, end, start, duration);
    }
    tail.connect(envelope);
    let destination = output?.node || this.#master;
    if (!output && pos && [pos.x, pos.y, pos.z].every(Number.isFinite)) {
      const dx = pos.x - this.#eye.x;
      const dy = pos.y - this.#eye.y;
      const dz = pos.z - this.#eye.z;
      const distance = Math.hypot(dx, dy, dz);
      gain /= 1 + 0.09 * distance;
      if (distance > 0.5 && context.createStereoPanner) {
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
    if (noise) source.start(start, rand(0, 1.5));
    else source.start(start);
    source.stop(start + duration + 0.05);
  }

  #sweep(param, freq, end, start, duration) {
    param.setValueAtTime(Math.max(20, freq), start);
    if (end !== undefined) param.exponentialRampToValueAtTime(Math.max(20, end), start + duration);
  }

  reelLoop(on) {
    if (!on) {
      if (!this.#reel) return;
      this.#reel.gain.gain.setTargetAtTime(0, this.#ctx.currentTime, 0.05);
      this.#reel.source.stop(this.#ctx.currentTime + 0.3);
      this.#reel = null;
      return;
    }
    if (this.#reel || this.#ctx?.state !== 'running') return;
    const context = this.#ctx;
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
    gain.connect(this.#master);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    source.start(context.currentTime, rand(0, 1.5));
    this.#reel = { source, gain };
  }

  shot() {
    this.#noise({ type: 'bandpass', freq: 1200, end: 250, Q: 0.7, duration: 0.17, gain: 0.7 });
    this.#noise({ type: 'highpass', freq: 2800, duration: 0.06, gain: 0.45 });
    this.#tone({ type: 'triangle', freq: 160, end: 40, duration: 0.15, gain: 0.6 });
  }
  shotgunFire() {
    this.#noise({ freq: 1800, end: 120, duration: 0.32, gain: 0.9 });
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.08, gain: 0.5 });
    this.#tone({ type: 'triangle', freq: 110, end: 30, duration: 0.28, gain: 0.7 });
  }
  sniperFire() {
    this.#noise({ type: 'bandpass', freq: 1400, end: 90, Q: 0.5, duration: 0.45, gain: 0.95 });
    this.#noise({ type: 'highpass', freq: 3500, duration: 0.07, gain: 0.7 });
    this.#tone({ type: 'sawtooth', freq: 260, end: 30, duration: 0.4, gain: 0.8 });
    this.#tone({ freq: 1800, end: 400, duration: 0.5, gain: 0.16, delay: 0.05 });
  }
  revolver() {
    this.#noise({ type: 'bandpass', freq: 900, end: 180, Q: 0.6, duration: 0.22, gain: 0.85 });
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.6 });
    this.#tone({ type: 'sawtooth', freq: 200, end: 35, duration: 0.22, gain: 0.7 });
    this.#tone({ freq: 2600, end: 900, duration: 0.12, gain: 0.12 });
  }
  pump() {
    this.#noise({ type: 'bandpass', freq: 1500, Q: 1.5, duration: 0.05, gain: 0.35 });
    this.#noise({ type: 'bandpass', freq: 900, Q: 1.5, duration: 0.06, gain: 0.35, delay: 0.09 });
  }
  shellCue() {
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.04, gain: 0.3 });
    this.#tone({ type: 'square', freq: 1400, end: 900, duration: 0.05, gain: 0.08 });
  }
  cylinder() {
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.05, gain: 0.3 });
    this.#tone({ type: 'square', freq: 700, end: 400, duration: 0.12, gain: 0.1, delay: 0.05 });
    this.#noise({ type: 'highpass', freq: 1800, duration: 0.06, gain: 0.35, delay: 1.6 });
  }
  reload() {
    this.#noise({ type: 'highpass', freq: 2500, duration: 0.04, gain: 0.35 });
    this.#noise({ type: 'bandpass', freq: 600, Q: 2, duration: 0.12, gain: 0.2, delay: 0.25 });
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.05, gain: 0.4, delay: 0.9 });
    this.#tone({ type: 'square', freq: 900, end: 500, duration: 0.06, gain: 0.15, delay: 1.25 });
  }
  empty() { this.#noise({ type: 'highpass', freq: 3000, duration: 0.03, gain: 0.3 }); }
  winded() { this.#tone({ type: 'triangle', freq: 220, end: 140, duration: 0.14, gain: 0.1 }); }
  switchWeapon() { this.#noise({ type: 'bandpass', freq: 1800, Q: 1.5, duration: 0.05, gain: 0.25 }); }
  katanaSwing() { this.#noise({ type: 'bandpass', freq: 500, end: 3000, Q: 1.5, duration: 0.2, gain: 0.35 }); }
  katanaHit() {
    this.#noise({ freq: 900, end: 200, duration: 0.14, gain: 0.6 });
    this.#noise({ type: 'bandpass', freq: 2500, Q: 0.6, duration: 0.1, gain: 0.35 });
    this.#tone({ type: 'triangle', freq: 180, end: 70, duration: 0.12, gain: 0.4 });
  }
  parry() {
    for (const freq of [2200, 3300, 4700]) this.#tone({ freq, end: freq * 0.92, duration: 0.35, gain: 0.16 });
    this.#noise({ type: 'highpass', freq: 4000, duration: 0.05, gain: 0.5 });
  }
  perfectParry() {
    this.parry();
    this.#tone({ type: 'triangle', freq: 880, end: 1760, duration: 0.25, gain: 0.2, delay: 0.03 });
  }
  grappleFire() {
    this.#noise({ type: 'highpass', freq: 1500, duration: 0.1, gain: 0.4 });
    this.#tone({ type: 'sawtooth', freq: 500, end: 1500, duration: 0.18, gain: 0.18 });
  }
  grappleHit() {
    this.#noise({ type: 'highpass', freq: 2000, duration: 0.04, gain: 0.45 });
    this.#tone({ type: 'square', freq: 300, end: 200, duration: 0.08, gain: 0.25 });
  }
  grappleRelease() { this.#tone({ type: 'sawtooth', freq: 900, end: 300, duration: 0.12, gain: 0.12 }); }
  footstep(vol) { this.#noise({ freq: rand(400, 800), duration: 0.07, gain: 0.12 * vol }); }
  jump() {
    this.#tone({ type: 'triangle', freq: 260, end: 480, duration: 0.1, gain: 0.1 });
    this.#noise({ freq: 600, duration: 0.05, gain: 0.1 });
  }
  land(h) { this.#noise({ freq: 350, duration: 0.14, gain: 0.15 + 0.35 * h }); }
  slide() { this.#noise({ freq: 1200, end: 300, duration: 0.45, gain: 0.18 }); }
  wallJump() {
    this.#noise({ freq: 700, duration: 0.08, gain: 0.25 });
    this.#tone({ type: 'triangle', freq: 300, end: 600, duration: 0.12, gain: 0.12 });
  }
  mantle() { this.#noise({ freq: 900, end: 300, duration: 0.2, gain: 0.2 }); }
  dash() { this.#noise({ type: 'bandpass', freq: 800, end: 2500, duration: 0.25, gain: 0.3 }); }
  hurt() {
    this.#tone({ type: 'sawtooth', freq: 200, end: 90, duration: 0.2, gain: 0.35 });
    this.#noise({ freq: 500, duration: 0.12, gain: 0.3 });
  }
  death() {
    this.#tone({ type: 'sawtooth', freq: 220, end: 30, duration: 1.2, gain: 0.4 });
    this.#noise({ freq: 800, end: 80, duration: 0.8, gain: 0.35 });
  }
  hitEnemy(pos) {
    this.#noise({ freq: 900, duration: 0.06, gain: 0.3, pos });
    this.#tone({ type: 'square', freq: rand(200, 260), end: 120, duration: 0.1, gain: 0.15, pos });
  }
  headshot(pos) {
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.5, pos });
    this.#tone({ type: 'triangle', freq: 1500, end: 500, duration: 0.09, gain: 0.2, pos });
  }
  kill(strong = false) {
    this.#tone({ type: 'square', freq: 880, duration: 0.07, gain: 0.22 });
    this.#tone({ type: 'square', freq: 1320, duration: 0.16, gain: 0.2, delay: 0.07 });
    this.#tone({ freq: 140, end: 50, duration: 0.16, gain: strong ? 0.6 : 0.35 });
    if (strong) this.#tone({ type: 'triangle', freq: 1760, duration: 0.22, gain: 0.12, delay: 0.14 });
  }
  enemyDie(pos) {
    this.#tone({ type: 'sawtooth', freq: rand(160, 220), end: 40, duration: 0.4, gain: 0.3, pos });
    this.#noise({ freq: 600, end: 100, duration: 0.3, gain: 0.4, pos });
    this.#noise({ type: 'bandpass', freq: 1400, duration: 0.12, gain: 0.3, delay: 0.03, pos });
  }
  gib(pos) {
    this.#noise({ freq: 500, end: 120, duration: 0.2, gain: 0.45, pos });
    this.#noise({ type: 'bandpass', freq: 2000, Q: 0.8, duration: 0.1, gain: 0.3, delay: 0.02, pos });
  }
  spawn(pos) {
    for (let i = 0; i < 5; i++) this.#noise({ type: 'bandpass', freq: rand(2500, 5000), Q: 2, duration: 0.04, gain: 0.25, delay: i * 0.05, pos });
  }
  lunge(pos) { this.#tone({ type: 'sawtooth', freq: 200, end: 700, duration: 0.3, gain: 0.25, pos }); }
  bulletImpact(pos) { this.#noise({ type: 'highpass', freq: 1500, duration: 0.05, gain: 0.25, pos }); }
  ricochet(pos) { this.#tone({ freq: rand(2000, 3500), end: 800, duration: 0.15, gain: 0.12, pos }); }
  pickup() {
    this.#tone({ type: 'triangle', freq: 700, end: 1100, duration: 0.1, gain: 0.2 });
    this.#tone({ type: 'triangle', freq: 1100, end: 1500, duration: 0.15, gain: 0.2, delay: 0.09 });
  }
  wave() {
    [440, 554, 659, 880].forEach((freq, i) => this.#tone({ type: 'triangle', freq, duration: 0.22, gain: 0.18, delay: i * 0.11 }));
  }
  waveClear() {
    [659, 880, 1108, 1318].forEach((freq, i) => this.#tone({ type: 'triangle', freq, duration: 0.3, gain: 0.16, delay: i * 0.13 }));
  }
  focusIn() {
    this.#tone({ freq: 1200, end: 420, duration: 0.45, gain: 0.3 });
    this.#noise({ type: 'bandpass', freq: 2400, end: 500, Q: 1.2, duration: 0.35, gain: 0.2 });
  }
  focusSlash() {
    this.#noise({ type: 'bandpass', freq: 600, end: 4000, Q: 1.2, duration: 0.3, gain: 0.55 });
    this.#tone({ type: 'triangle', freq: 180, end: 60, duration: 0.3, gain: 0.55 });
    for (const freq of [1600, 2400]) this.#tone({ freq, end: freq * 0.6, duration: 0.35, gain: 0.14, delay: 0.04 });
  }
  explosion(pos) {
    this.#noise({ freq: 900, end: 60, duration: 0.7, gain: 0.9, pos });
    this.#tone({ type: 'triangle', freq: 80, end: 25, duration: 0.6, gain: 0.7, pos });
    this.#noise({ type: 'bandpass', freq: 3000, Q: 0.7, duration: 0.15, gain: 0.4, pos });
  }
  fuse(pos) { this.#noise({ type: 'highpass', freq: 5000, duration: 0.12, gain: 0.25, pos }); }
  flyerDive(pos) {
    this.#tone({ type: 'sawtooth', freq: 900, end: 300, duration: 0.35, gain: 0.2, pos });
    this.#noise({ type: 'bandpass', freq: 2500, end: 800, duration: 0.3, gain: 0.15, pos });
  }
  flyerBuzz(pos) { this.#tone({ type: 'sawtooth', freq: rand(380, 460), duration: 0.14, gain: 0.05, pos }); }
  stomp(pos) {
    this.#noise({ freq: 400, end: 60, duration: 0.4, gain: 0.8, pos });
    this.#tone({ freq: 60, end: 25, duration: 0.5, gain: 0.7, pos });
  }
  bossRoar(pos) {
    this.#tone({ type: 'sawtooth', freq: 90, end: 60, duration: 0.9, gain: 0.5, pos });
    this.#noise({ type: 'bandpass', freq: 500, Q: 0.8, duration: 0.8, gain: 0.4, pos });
  }
  shieldHit(pos) {
    this.#tone({ type: 'square', freq: rand(600, 800), end: 300, duration: 0.12, gain: 0.2, pos });
    this.#noise({ type: 'highpass', freq: 3000, duration: 0.05, gain: 0.3, pos });
  }
  smash(pos, big = false) {
    this.#noise({ freq: big ? 900 : 1600, end: 200, duration: big ? 0.28 : 0.14, gain: big ? 0.7 : 0.45, pos });
    this.#noise({ type: 'highpass', freq: 3500, duration: 0.05, gain: 0.35, pos });
    this.#tone({ type: 'triangle', freq: big ? 120 : 220, end: 60, duration: 0.12, gain: 0.25, pos });
  }
  remoteShot(kind, pos) {
    if (kind === 'shotgun') {
      this.#noise({ freq: 1600, end: 150, duration: 0.32, gain: 1, pos });
      this.#tone({ type: 'triangle', freq: 95, end: 30, duration: 0.26, gain: 0.7, pos });
    } else if (kind === 'sniper') {
      this.#noise({ type: 'bandpass', freq: 750, end: 120, Q: 0.5, duration: 0.4, gain: 1, pos });
      this.#tone({ type: 'sawtooth', freq: 420, end: 50, duration: 0.32, gain: 0.5, pos });
    } else {
      this.#noise({ type: 'bandpass', freq: rand(1000, 1500), end: 220, Q: 0.8, duration: 0.16, gain: 0.85, pos });
      this.#noise({ type: 'highpass', freq: 2600, duration: 0.05, gain: 0.4, pos });
      this.#tone({ type: 'square', freq: 200, end: 50, duration: 0.12, gain: 0.45, pos });
    }
  }
  enemyShot(pos) {
    this.#noise({ type: 'bandpass', freq: rand(900, 1500), end: 200, Q: 0.8, duration: 0.14, gain: 0.5, pos });
    this.#tone({ type: 'square', freq: 220, end: 60, duration: 0.1, gain: 0.3, pos });
  }
  enemyShotgun(pos) {
    this.#noise({ freq: 1500, end: 150, duration: 0.3, gain: 0.7, pos });
    this.#tone({ type: 'triangle', freq: 90, end: 30, duration: 0.25, gain: 0.5, pos });
  }
  enemySniper(pos) {
    this.#noise({ type: 'bandpass', freq: 700, end: 120, Q: 0.5, duration: 0.35, gain: 0.7, pos });
    this.#tone({ type: 'sawtooth', freq: 400, end: 50, duration: 0.3, gain: 0.35, pos });
  }
  sniperAim(pos) { this.#tone({ freq: 1800, duration: 0.12, gain: 0.12, pos }); }
}

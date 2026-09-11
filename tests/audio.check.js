import { Audio } from '../src/audio.js';

// A silent Web Audio double checks scheduling without a speaker or user gesture.
export async function run(assert) {
  const saved = Object.fromEntries(['AudioContext', 'webkitAudioContext', 'setInterval', 'clearInterval'].map(key => [key, globalThis[key]]));
  const timers = new Map();
  let nextTimer = 0;
  let constructions = 0;
  const near = (a, b) => Math.abs(a - b) < 1e-8;
  class Param {
    value = 0;
    events = [];
    setValueAtTime(...args) { this.events.push(['set', ...args]); }
    linearRampToValueAtTime(...args) { this.events.push(['linear', ...args]); }
    exponentialRampToValueAtTime(...args) { this.events.push(['exponential', ...args]); }
    setTargetAtTime(...args) { this.events.push(['target', ...args]); }
  }
  class Node {
    constructor(kind) {
      this.kind = kind;
      this.connections = [];
      for (const name of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'ratio']) this[name] = new Param();
    }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.disconnected = true; }
    start(...args) { this.startArgs = args; }
    stop(at) { this.stopAt = at; }
  }
  class Context {
    currentTime = 10;
    state = 'running';
    sampleRate = 100;
    nodes = [];
    constructor() { constructions++; this.destination = this.node('destination'); }
    node(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
    createGain() { return this.node('gain'); }
    createDynamicsCompressor() { return this.node('compressor'); }
    createBufferSource() { return this.node('noise'); }
    createOscillator() { return this.node('tone'); }
    createBiquadFilter() { return this.node('filter'); }
    createStereoPanner() { return this.node('pan'); }
    createBuffer(channels, length, rate) {
      this.buffer = { channels, length, rate, samples: new Float32Array(length), getChannelData() { return this.samples; } };
      return this.buffer;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  const layers = {
    shot: 3, shotgunFire: 3, sniperFire: 4, revolver: 4, pump: 2, shellCue: 2, cylinder: 3, reload: 4,
    empty: 1, winded: 1, switchWeapon: 1, katanaSwing: 1, katanaHit: 3, parry: 4, perfectParry: 5,
    grappleFire: 2, grappleHit: 2, grappleRelease: 1, footstep: 1, jump: 2, land: 1, slide: 1,
    wallJump: 2, mantle: 1, dash: 1, hurt: 2, death: 2, hitEnemy: 2, headshot: 2, kill: 3,
    enemyDie: 3, gib: 2, spawn: 5, lunge: 1, bulletImpact: 1, ricochet: 1, pickup: 2, wave: 4,
    waveClear: 4, focusIn: 2, focusSlash: 4, explosion: 3, fuse: 1, flyerDive: 2, flyerBuzz: 1,
    stomp: 2, bossRoar: 2, shieldHit: 2, smash: 3, remoteShot: 3, enemyShot: 2, enemyShotgun: 2,
    enemySniper: 2, sniperAim: 1,
  };
  const sources = context => context.nodes.filter(node => node.kind === 'tone' || node.kind === 'noise');
  const envelope = source => source.kind === 'tone' ? source.connections[0] : source.connections[0].connections[0];
  const peak = source => envelope(source).gain.events.find(event => event[0] === 'linear');
  let audio;
  try {
    globalThis.setInterval = (callback, ms) => { timers.set(++nextTimer, { callback, ms }); return nextTimer; };
    globalThis.clearInterval = id => timers.delete(id);
    globalThis.AudioContext = undefined;
    globalThis.webkitAudioContext = undefined;
    const absent = new Audio();
    absent.init(); absent.resume(); absent.music(true); absent.reelLoop(true);
    for (const name of Object.keys(layers)) absent[name]();
    assert(absent.ctx === null && !absent.musicPlaying && timers.size === 0, 'No audio API is a silent no-op');

    globalThis.AudioContext = Context;
    audio = new Audio();
    audio.shot(); audio.music(true); audio.resume();
    assert(constructions === 0 && audio.ctx === null, 'Construction and cues do not create AudioContext');
    audio.music(false);
    audio.init(); audio.init();
    assert(constructions === 1 && audio.ctx, 'Explicit init creates exactly one context');
    const context = audio.ctx;
    const master = context.nodes.find(node => node.kind === 'gain');
    const compressor = context.nodes.find(node => node.kind === 'compressor');
    assert(master.gain.value === 0.55 && compressor.threshold.value === -16 && compressor.ratio.value === 5, 'Master graph levels');
    assert(master.connections[0] === compressor && compressor.connections[0] === context.destination, 'Master compressor graph');
    assert(context.buffer.length === 200 && context.buffer.samples.every(value => value >= -1 && value <= 1), 'Two seconds of white noise');

    for (const [name, count] of Object.entries(layers)) {
      const before = sources(context).length;
      if (name === 'footstep' || name === 'land') audio[name](1);
      else audio[name]();
      const voices = sources(context).slice(before);
      assert(voices.length === count, `${name}: all cue layers`);
      for (const source of voices) {
        assert(source.startArgs[0] >= 10 && source.stopAt > source.startArgs[0], `${name}: finite voice timing`);
        assert(peak(source)[1] > 0 && peak(source)[1] <= 1, `${name}: envelope peak`);
        const gain = envelope(source).gain.events;
        assert(gain[0][1] === 0.0001 && gain[2][1] === 0.0001, `${name}: quiet envelope endpoints`);
        assert(near(source.stopAt - gain[2][2], 0.05), `${name}: source stops after envelope`);
        assert(near(gain[1][2] - gain[0][2], source.kind === 'noise' ? 0.002 : 0.005), `${name}: voice attack`);
        if (source.kind === 'noise') assert(source.loop && source.startArgs[1] >= 0 && source.startArgs[1] < 1.5, `${name}: looped noise offset`);
      }
    }
    let before = sources(context).length;
    audio.kill(true); audio.remoteShot('shotgun'); audio.remoteShot('sniper');
    assert(sources(context).length - before === 8, 'Strong kill and remote shotgun/sniper variants');
    before = sources(context).length;
    audio.smash(undefined, true);
    let voices = sources(context).slice(before);
    assert(voices[0].connections[0].frequency.events[0][1] === 900 && near(voices[0].stopAt, 10.33), 'Large smash variant');

    const eye = { x: 0, y: 0, z: 0 };
    const right = { x: 1, z: 0 };
    audio.setListener(eye, right);
    eye.x = 100; right.x = -1;
    before = sources(context).length;
    audio.hitEnemy({ x: 3, y: 4, z: 0 });
    voices = sources(context).slice(before);
    assert(near(peak(voices[0])[1], 0.3 / 1.45), 'Distance gain includes vertical distance and copies listener');
    assert(near(envelope(voices[0]).connections[0].pan.value, 0.45), 'Pan uses listener ground-plane right vector');
    before = sources(context).length;
    audio.sniperAim({ x: -10, y: 0, z: 0 });
    assert(envelope(sources(context)[before]).connections[0].pan.value === -0.75, 'Pan left extent');
    before = sources(context).length;
    audio.sniperAim({ x: 0.25, y: 0, z: 0 });
    assert(envelope(sources(context)[before]).connections[0] === master, 'Near sounds bypass pan');
    context.createStereoPanner = undefined;
    audio.sniperAim({ x: 10, y: 0, z: 0 });
    assert(envelope(sources(context).at(-1)).connections[0] === master, 'Stereo panner is optional');

    before = sources(context).length;
    audio.reelLoop(true); audio.reelLoop(true);
    const reel = sources(context)[before];
    const reelGain = envelope(reel);
    assert(sources(context).length === before + 1 && reel.connections[0].frequency.value === 380 && reel.connections[0].Q.value === 0.7, 'Single grapple loop and filter');
    assert(JSON.stringify(reelGain.gain.events[1]) === JSON.stringify(['target', 0.05, 10, 0.12]), 'Grapple loop attack');
    audio.reelLoop(false); audio.reelLoop(false);
    assert(JSON.stringify(reelGain.gain.events.at(-1)) === JSON.stringify(['target', 0, 10, 0.05]) && near(reel.stopAt, 10.3), 'Grapple loop fade and stop');
    reel.onended();
    assert(reel.disconnected && reelGain.disconnected, 'Grapple nodes are released');

    before = sources(context).length;
    audio.music(true);
    assert(audio.musicPlaying && timers.size === 1 && [...timers.values()][0].ms === 100, 'Music starts one 100 ms scheduler');
    const musicVoices = sources(context).slice(before);
    assert(musicVoices.length > 0 && musicVoices.every(source => source.startArgs[0] >= 10.1 && source.startArgs[0] < 10.7), 'Music uses the 0.7 second look-ahead');
    const bus = envelope(musicVoices[0]).connections[0];
    assert(bus.gain.value === 0.05 && bus.connections[0] === master, 'Music bus bypasses positional pan');
    const musicNoise = musicVoices.find(source => source.kind === 'noise');
    assert(near(peak(musicNoise)[2] - musicNoise.startArgs[0], 0.003), 'Music noise attack is 3 ms');
    audio.music(true);
    assert(timers.size === 1 && sources(context).length === before + musicVoices.length, 'Repeated music on does not restart');
    context.currentTime = 12;
    before = sources(context).length;
    [...timers.values()][0].callback();
    assert(sources(context).slice(before).every(source => source.startArgs[0] >= 12.05 && source.startArgs[0] < 12.7), 'Throttled tab jumps ahead without replaying missed time');
    before = sources(context).length;
    audio.setTune('mexico');
    voices = sources(context).slice(before);
    assert(near(voices[0].frequency.events[0][1], 440 * 2 ** ((74 - 69) / 12)) && near(voices[0].startArgs[0], 12.1), 'Tune switch restarts Mexico at its first step after 0.1 s');
    assert(JSON.stringify(bus.gain.events.at(-1)) === JSON.stringify(['target', 0, 12, 0.2]), 'Old music bus fades with 0.2 second constant');
    audio.music(false);
    assert(!audio.musicPlaying && timers.size === 0, 'Music off stops scheduling');
    for (const source of sources(context)) source.onended?.();
    assert(bus.disconnected, 'Retired music bus is released after the last voice');

    context.state = 'suspended';
    before = sources(context).length;
    audio.music(true); audio.shot(); audio.reelLoop(true);
    assert(sources(context).length === before && !audio.musicPlaying && timers.size === 0, 'Blocked context does not queue stale sounds');
    audio.resume();
    await Promise.resolve();
    assert(audio.musicPlaying && timers.size === 1, 'Resume recovers a requested music track');
    audio.music(false);
  } finally {
    audio?.music(false);
    audio?.reelLoop(false);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

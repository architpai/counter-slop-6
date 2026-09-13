import { afterAll, beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Audio } from '@/engine/audio';

// A silent Web Audio double checks scheduling without a speaker or user gesture.

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-8;
const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
};

type Event = [string, ...number[]];

class Param {
  value = 0;
  events: Event[] = [];
  setValueAtTime(...args: number[]) { this.events.push(['set', ...args]); }
  linearRampToValueAtTime(...args: number[]) { this.events.push(['linear', ...args]); }
  exponentialRampToValueAtTime(...args: number[]) { this.events.push(['exponential', ...args]); }
  setTargetAtTime(...args: number[]) { this.events.push(['target', ...args]); }
}

class Node {
  kind: string;
  connections: Node[] = [];
  disconnected = false;
  startArgs: number[] = [];
  stopAt = 0;
  loop = false;
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  pan = new Param();
  threshold = new Param();
  ratio = new Param();
  constructor(kind: string) { this.kind = kind; }
  connect(node: Node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(...args: number[]) { this.startArgs = args; }
  stop(at: number) { this.stopAt = at; }
}

/**
 * `Audio.#voice` narrows its source with `instanceof AudioBufferSourceNode` /
 * `instanceof OscillatorNode` before it wires the filter chain and picks the
 * two-argument `start`. A plain object fails both, so the double splices the
 * native prototypes in below its own methods -- every member the engine touches
 * is an own property of `Node`, so nothing native is ever invoked.
 */
const bridge = (native: object): object =>
  Object.create(native, Object.getOwnPropertyDescriptors(Node.prototype)) as object;
class NoiseNode extends Node {}
class ToneNode extends Node {}
Object.setPrototypeOf(NoiseNode.prototype, bridge(AudioBufferSourceNode.prototype));
Object.setPrototypeOf(ToneNode.prototype, bridge(OscillatorNode.prototype));

interface FakeBuffer {
  channels: number;
  length: number;
  rate: number;
  samples: Float32Array;
  getChannelData(): Float32Array;
}

let constructions = 0;

class Context {
  currentTime = 10;
  state = 'running';
  sampleRate = 100;
  nodes: Node[] = [];
  destination: Node;
  buffer: FakeBuffer | null = null;
  createStereoPanner: (() => Node) | undefined = () => this.node('pan');
  constructor() { constructions++; this.destination = this.node('destination'); }
  node(kind: string) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createBufferSource() { const node = new NoiseNode('noise'); this.nodes.push(node); return node; }
  createOscillator() { const node = new ToneNode('tone'); this.nodes.push(node); return node; }
  createBiquadFilter() { return this.node('filter'); }
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    this.buffer = { channels, length, rate, samples: new Float32Array(length), getChannelData() { return this.samples; } };
    return this.buffer;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const ZERO = new Vector3();
/** `[cue name, expected layer count, how to play it]`. */
const layers: [string, number, (a: Audio) => void][] = [
  ['shot', 3, a => a.shot()], ['shotgunFire', 3, a => a.shotgunFire()], ['sniperFire', 4, a => a.sniperFire()],
  ['revolver', 4, a => a.revolver()], ['pump', 2, a => a.pump()], ['shellCue', 2, a => a.shellCue()],
  ['cylinder', 3, a => a.cylinder()], ['reload', 4, a => a.reload()], ['empty', 1, a => a.empty()],
  ['winded', 1, a => a.winded()], ['switchWeapon', 1, a => a.switchWeapon()], ['katanaSwing', 1, a => a.katanaSwing()],
  ['katanaHit', 3, a => a.katanaHit()], ['parry', 4, a => a.parry()], ['perfectParry', 5, a => a.perfectParry()],
  ['grappleFire', 2, a => a.grappleFire()], ['grappleHit', 2, a => a.grappleHit()], ['grappleRelease', 1, a => a.grappleRelease()],
  ['footstep', 1, a => a.footstep(1)], ['jump', 2, a => a.jump()], ['land', 1, a => a.land(1)],
  ['slide', 1, a => a.slide()], ['wallJump', 2, a => a.wallJump()], ['mantle', 1, a => a.mantle()],
  ['dash', 1, a => a.dash()], ['hurt', 2, a => a.hurt()], ['death', 2, a => a.death()],
  ['hitEnemy', 2, a => a.hitEnemy()], ['headshot', 2, a => a.headshot()], ['kill', 3, a => a.kill()],
  ['enemyDie', 3, a => a.enemyDie(ZERO)], ['gib', 2, a => a.gib(ZERO)], ['spawn', 5, a => a.spawn(ZERO)],
  ['lunge', 1, a => a.lunge(ZERO)], ['bulletImpact', 1, a => a.bulletImpact(ZERO)], ['ricochet', 1, a => a.ricochet(ZERO)],
  ['pickup', 2, a => a.pickup()], ['wave', 4, a => a.wave()], ['waveClear', 4, a => a.waveClear()],
  ['focusIn', 2, a => a.focusIn()], ['focusSlash', 4, a => a.focusSlash()], ['explosion', 3, a => a.explosion(ZERO)],
  ['fuse', 1, a => a.fuse(ZERO)], ['flyerDive', 2, a => a.flyerDive(ZERO)], ['flyerBuzz', 1, a => a.flyerBuzz(ZERO)],
  ['stomp', 2, a => a.stomp(ZERO)], ['bossRoar', 2, a => a.bossRoar(ZERO)], ['shieldHit', 2, a => a.shieldHit(ZERO)],
  ['smash', 3, a => a.smash(ZERO)], ['remoteShot', 3, a => a.remoteShot('rifle', ZERO)], ['enemyShot', 2, a => a.enemyShot(ZERO)],
  ['enemyShotgun', 2, a => a.enemyShotgun(ZERO)], ['enemySniper', 2, a => a.enemySniper(ZERO)], ['sniperAim', 1, a => a.sniperAim(ZERO)],
];

const timers = new Map<number, { callback: () => void; ms: number }>();
let nextTimer = 0;
const saved = new Map<string, unknown>();
const savedKeys = ['AudioContext', 'webkitAudioContext', 'setInterval', 'clearInterval'];

const sources = (context: Context) => context.nodes.filter(node => node.kind === 'tone' || node.kind === 'noise');
const envelope = (source: Node): Node => source.kind === 'tone'
  ? must(source.connections[0], 'tone envelope')
  : must(must(source.connections[0], 'noise filter').connections[0], 'noise envelope');
const peak = (source: Node): Event => must(envelope(source).gain.events.find(event => event[0] === 'linear'), 'peak');

let audio: Audio;
let context: Context;
let master: Node;

beforeAll(() => {
  for (const key of savedKeys) saved.set(key, Reflect.get(globalThis, key));
  Reflect.set(globalThis, 'setInterval', (callback: () => void, ms: number) => {
    timers.set(++nextTimer, { callback, ms });
    return nextTimer;
  });
  Reflect.set(globalThis, 'clearInterval', (id: number) => timers.delete(id));
  Reflect.set(globalThis, 'AudioContext', Context);
  Reflect.set(globalThis, 'webkitAudioContext', undefined);
});

afterAll(() => {
  // `audio` is assigned by the second test, so a throw before that leaves it
  // genuinely undefined at runtime whatever its type says. Guard it, or
  // teardown raises a second, louder error that buries the real one.
  audio?.music(false);
  audio?.reelLoop(false);
  for (const key of savedKeys) {
    const value = saved.get(key);
    if (value === undefined) Reflect.deleteProperty(globalThis, key);
    else Reflect.set(globalThis, key, value);
  }
});

test('a missing Web Audio API', () => {
  Reflect.set(globalThis, 'AudioContext', undefined);
  try {
    const absent = new Audio();
    absent.init(); absent.resume(); absent.music(true); absent.reelLoop(true);
    for (const [, , play] of layers) play(absent);
    assert(absent.ctx === null && !absent.musicPlaying && timers.size === 0, 'No audio API is a silent no-op');
  } finally {
    // Restore even on failure: leaking the undefined stub would fail every
    // later test in this file for a reason that has nothing to do with them.
    Reflect.set(globalThis, 'AudioContext', Context);
  }
});

test('lazy construction and the master graph', () => {
  audio = new Audio();
  audio.shot(); audio.music(true); audio.resume();
  assert(constructions === 0 && audio.ctx === null, 'Construction and cues do not create AudioContext');
  audio.music(false);
  audio.init(); audio.init();
  assert(constructions === 1 && audio.ctx, 'Explicit init creates exactly one context');
  const created = audio.ctx;
  if (!(created instanceof Context)) throw new Error('the double was not installed');
  context = created;
  master = must(context.nodes.find(node => node.kind === 'gain'), 'master');
  const compressor = must(context.nodes.find(node => node.kind === 'compressor'), 'compressor');
  assert(master.gain.value === 0.55 && compressor.threshold.value === -16 && compressor.ratio.value === 5, 'Master graph levels');
  assert(master.connections[0] === compressor && compressor.connections[0] === context.destination, 'Master compressor graph');
  const buffer = must(context.buffer, 'noise buffer');
  assert(buffer.length === 200 && buffer.samples.every(value => value >= -1 && value <= 1), 'Two seconds of white noise');
});

test('every cue schedules its documented layers', () => {
  for (const [name, count, play] of layers) {
    const before = sources(context).length;
    play(audio);
    const voices = sources(context).slice(before);
    assert(voices.length === count, `${name}: all cue layers`);
    for (const source of voices) {
      assert(must(source.startArgs[0], 'start') >= 10 && source.stopAt > must(source.startArgs[0], 'start'), `${name}: finite voice timing`);
      assert(must(peak(source)[1], 'peak value') > 0 && must(peak(source)[1], 'peak value') <= 1, `${name}: envelope peak`);
      const gain = envelope(source).gain.events;
      assert(must(gain[0], 'attack start')[1] === 0.0001 && must(gain[2], 'release')[1] === 0.0001, `${name}: quiet envelope endpoints`);
      assert(near(source.stopAt - must(must(gain[2], 'release')[2], 'release time'), 0.05), `${name}: source stops after envelope`);
      assert(near(must(must(gain[1], 'peak')[2], 'peak time') - must(must(gain[0], 'attack start')[2], 'attack time'), source.kind === 'noise' ? 0.002 : 0.005), `${name}: voice attack`);
      if (source.kind === 'noise') assert(source.loop && must(source.startArgs[1], 'offset') >= 0 && must(source.startArgs[1], 'offset') < 1.5, `${name}: looped noise offset`);
    }
  }
  let before = sources(context).length;
  audio.kill(true); audio.remoteShot('shotgun', ZERO); audio.remoteShot('sniper', ZERO);
  assert(sources(context).length - before === 8, 'Strong kill and remote shotgun/sniper variants');
  before = sources(context).length;
  audio.smash(ZERO, true);
  const voices = sources(context).slice(before);
  const smash = must(voices[0], 'smash voice');
  assert(must(must(smash.connections[0], 'smash filter').frequency.events[0], 'smash sweep')[1] === 900 && near(smash.stopAt, 10.33), 'Large smash variant');
});

test('positional gain and panning', () => {
  const eye = new Vector3(0, 0, 0);
  const right = new Vector3(1, 0, 0);
  audio.setListener(eye, right);
  eye.x = 100; right.x = -1;
  let before = sources(context).length;
  audio.bulletImpact(new Vector3(3, 4, 0));
  const voices = sources(context).slice(before);
  assert(near(peak(must(voices[0], 'impact voice'))[1], 0.25 / 1.45), 'Distance gain includes vertical distance and copies listener');
  assert(near(must(envelope(must(voices[0], 'impact voice')).connections[0], 'panner').pan.value, 0.45), 'Pan uses listener ground-plane right vector');
  before = sources(context).length;
  audio.hitEnemy(); audio.headshot();
  for (const voice of sources(context).slice(before)) assert(envelope(voice).connections[0] === master, 'Hit confirms are centred, not positional');
  before = sources(context).length;
  audio.sniperAim(new Vector3(-10, 0, 0));
  assert(must(envelope(must(sources(context)[before], 'left voice')).connections[0], 'panner').pan.value === -0.75, 'Pan left extent');
  before = sources(context).length;
  audio.sniperAim(new Vector3(0.25, 0, 0));
  assert(envelope(must(sources(context)[before], 'near voice')).connections[0] === master, 'Near sounds bypass pan');
  context.createStereoPanner = undefined;
  audio.sniperAim(new Vector3(10, 0, 0));
  assert(envelope(must(sources(context).at(-1), 'last voice')).connections[0] === master, 'Stereo panner is optional');
});

test('the grapple reel loop', () => {
  const before = sources(context).length;
  audio.reelLoop(true); audio.reelLoop(true);
  const reel = must(sources(context)[before], 'reel');
  const reelGain = envelope(reel);
  const filter = must(reel.connections[0], 'reel filter');
  assert(sources(context).length === before + 1 && filter.frequency.value === 380 && filter.Q.value === 0.7, 'Single grapple loop and filter');
  assert(JSON.stringify(reelGain.gain.events[1]) === JSON.stringify(['target', 0.05, 10, 0.12]), 'Grapple loop attack');
  audio.reelLoop(false); audio.reelLoop(false);
  assert(JSON.stringify(reelGain.gain.events.at(-1)) === JSON.stringify(['target', 0, 10, 0.05]) && near(reel.stopAt, 10.3), 'Grapple loop fade and stop');
  must(reel.onended, 'reel onended')();
  assert(reel.disconnected && reelGain.disconnected, 'Grapple nodes are released');
});

test('music scheduling, look-ahead and tune switching', () => {
  let before = sources(context).length;
  audio.music(true);
  assert(audio.musicPlaying && timers.size === 1 && must([...timers.values()][0], 'timer').ms === 100, 'Music starts one 100 ms scheduler');
  const musicVoices = sources(context).slice(before);
  assert(musicVoices.length > 0 && musicVoices.every(source => must(source.startArgs[0], 'start') >= 10.1 && must(source.startArgs[0], 'start') < 10.7), 'Music uses the 0.7 second look-ahead');
  const bus = must(envelope(must(musicVoices[0], 'music voice')).connections[0], 'music bus');
  assert(bus.gain.value === 0.05 && bus.connections[0] === master, 'Music bus bypasses positional pan');
  const musicNoise = must(musicVoices.find(source => source.kind === 'noise'), 'music noise');
  assert(near(must(peak(musicNoise)[2], 'peak time') - must(musicNoise.startArgs[0], 'start'), 0.003), 'Music noise attack is 3 ms');
  audio.music(true);
  assert(timers.size === 1 && sources(context).length === before + musicVoices.length, 'Repeated music on does not restart');
  context.currentTime = 12;
  before = sources(context).length;
  must([...timers.values()][0], 'timer').callback();
  assert(sources(context).slice(before).every(source => must(source.startArgs[0], 'start') >= 12.05 && must(source.startArgs[0], 'start') < 12.7), 'Throttled tab jumps ahead without replaying missed time');
  before = sources(context).length;
  audio.setTune('mexico');
  const voices = sources(context).slice(before);
  const first = must(voices[0], 'mexico voice');
  assert(near(must(first.frequency.events[0], 'mexico sweep')[1], 440 * 2 ** ((74 - 69) / 12)) && near(first.startArgs[0], 12.1), 'Tune switch restarts Mexico at its first step after 0.1 s');
  assert(JSON.stringify(bus.gain.events.at(-1)) === JSON.stringify(['target', 0, 12, 0.2]), 'Old music bus fades with 0.2 second constant');
  audio.music(false);
  assert(!audio.musicPlaying && timers.size === 0, 'Music off stops scheduling');
  for (const source of sources(context)) source.onended?.();
  assert(bus.disconnected, 'Retired music bus is released after the last voice');
});

test('a blocked context and resume', async () => {
  context.state = 'suspended';
  const before = sources(context).length;
  audio.music(true); audio.shot(); audio.reelLoop(true);
  assert(sources(context).length === before && !audio.musicPlaying && timers.size === 0, 'Blocked context does not queue stale sounds');
  audio.resume();
  await Promise.resolve();
  assert(audio.musicPlaying && timers.size === 1, 'Resume recovers a requested music track');
  audio.music(false);
});

import { expect, test } from 'vitest';
import { TUNES, scheduleStep } from '@/engine/audio.tunes';
import type { TuneKey } from '@/engine/audio.tunes';

const assert = (cond: unknown, message: string): void => { expect(cond, message).toBeTruthy(); };

/** A scheduled voice, flattened so the table-driven `has` can index it. */
type Event = Record<string, string | number | undefined>;

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const notes = (key: TuneKey, index: number, intensity = 0): Event[] => {
  const events: Event[] = [];
  scheduleStep(key, index, 10, intensity,
    (voice) => events.push({ channel: 'tone', ...voice }),
    (voice) => events.push({ channel: 'noise', ...voice }));
  return events;
};
const has = (events: Event[], expected: Event) => events.some((event) =>
  Object.entries(expected).every(([key, value]) => typeof value === 'number' ? near(event[key], value) : event[key] === value));
const downtownStep = 60 / 156 / 4;
// Same set the original walked with `Object.entries(TUNES)`; `satisfies` on the
// table keeps `TuneKey` and these keys in step.
const tuneKeys = Object.keys(TUNES) as TuneKey[];

test('every step of every tune schedules finite voices', () => {
  assert(TUNES.downtown.steps === 896 && TUNES.mexico.steps === 192, 'Tune loop lengths');
  for (const key of tuneKeys) {
    const tune = TUNES[key];
    assert(tune.bars * tune.stepsPerBar === tune.steps, `${key}: complete bars`);
    for (const intensity of [0, 1]) {
      for (let index = 0; index < tune.steps; index++) {
        for (const event of notes(key, index, intensity)) {
          assert(Number.isFinite(event.freq) && Number(event.freq) > 0, `${key}/${index}: frequency`);
          assert(Number.isFinite(event.duration) && Number(event.duration) > 0, `${key}/${index}: duration`);
          assert(Number.isFinite(event.gain) && Number(event.gain) > 0 && Number(event.gain) <= 1, `${key}/${index}: gain`);
          assert(Number.isFinite(event.at) && Number(event.at) >= 10, `${key}/${index}: time`);
          assert(event.channel === 'noise' ? event.end === undefined : Number.isFinite(event.end) && Number(event.end) > 0, `${key}/${index}: sweep`);
        }
      }
    }
    assert(JSON.stringify(notes(key, 0)) === JSON.stringify(notes(key, tune.steps)), `${key}: exact loop restart`);
    assert(JSON.stringify(notes(key, tune.steps - 1)) === JSON.stringify(notes(key, -1)), `${key}: wrapped index`);
  }
});

test('downtown sections', () => {
  const opening = notes('downtown', 0);
  assert(has(opening, { type: 'square', freq: midi(76), gain: 0.1, duration: downtownStep * 1.8 }), 'Downtown opening lead');
  assert(has(opening, { type: 'square', freq: midi(76) * 1.004, gain: 0.04 }), 'Downtown detuned twin');
  assert(has(opening, { type: 'triangle', freq: midi(48), gain: 0.16 }), 'Downtown bass octave');
  assert(has(opening, { type: 'square', freq: midi(72), gain: 0.03 }), 'Downtown opening arpeggio');
  assert(has(opening, { type: 'highpass', freq: 5000, gain: 0.14 }), 'Section splash');
  assert(!has(notes('downtown', 1), { gain: 0.1, type: 'square' }), 'Held lead has no new onset');
  assert(!has(notes('downtown', 7), { gain: 0.1, type: 'square' }), 'Lead rest has no onset');
  assert(has(notes('downtown', 128), { type: 'square', freq: midi(88), gain: 0.02 }), 'Second section octave shadow');
  assert(has(notes('downtown', 256), { type: 'square', freq: midi(69), gain: 0.1 }), 'Bridge opening');
  assert(has(notes('downtown', 23 * 16 + 14), { type: 'triangle', freq: midi(42), gain: 0.17 }), 'Approach uses the next section chord');
  const echo = notes('downtown', 384);
  assert(has(echo, { type: 'square', freq: midi(81), gain: 0.035, at: 10 + 3 * downtownStep, duration: 8 * downtownStep * 0.9 * 0.8 }), 'First breakdown echo');
  assert(has(echo, { type: 'square', freq: midi(81), gain: 0.012, at: 10 + 6 * downtownStep }), 'Second breakdown echo');
  assert(has(echo, { type: 'triangle', freq: midi(41), gain: 0.14 }), 'Breakdown sparse bass');
  assert(has(notes('downtown', 512), { type: 'square', freq: midi(84), gain: 0.1 }), 'Chorus opening');
  assert(has(notes('downtown', 514), { type: 'triangle', freq: midi(72), gain: 0.06 }), 'Chorus counter voice');
  assert(has(notes('downtown', 640), { type: 'square', freq: midi(88), gain: 0.045 }), 'Sixth section shadow');
  assert(has(notes('downtown', 768), { type: 'square', freq: midi(96), gain: 0.03 }), 'Final section shadow');
  const fill = notes('downtown', 127, 1).filter((event) => event.channel === 'noise');
  assert(fill.length === 1 && has(fill, { type: 'bandpass', freq: 2850, gain: 0.27 }), 'Section fill replaces groove');
  assert(!has(notes('downtown', 10, 0.5), { type: 'sine' }) && has(notes('downtown', 10, 0.51), { type: 'sine' }), 'Intensity kick threshold');
  assert(!has(notes('downtown', 1, 0.4), { type: 'highpass' }) && has(notes('downtown', 1, 0.41), { type: 'highpass', gain: 0.03 }), 'Intensity hat threshold and odd-step gain');
});

test('mexico sections', () => {
  const mexico = notes('mexico', 0);
  assert(has(mexico, { type: 'square', freq: midi(74), gain: 0.1, duration: 0.18 }), 'Mexico opening lead');
  assert(has(mexico, { type: 'square', freq: midi(71), gain: 0.055, duration: 0.162 }), 'Mexico diatonic third below');
  assert(has(mexico, { type: 'triangle', freq: midi(43), gain: 0.2, duration: 0.34 }), 'Mexico bass');
  assert(notes('mexico', 4).filter((event) => event.type === 'sawtooth').length === 3, 'Mexico triad strum');
  assert(has(notes('mexico', 96), { type: 'square', freq: midi(91), gain: 0.02 }), 'Mexico upper half octave');
  assert(has(notes('mexico', 9 * 12), { type: 'square', freq: midi(84), gain: 0.055 }), 'Mexico third crosses octave');
  assert(!has(notes('mexico', 186), { type: 'square' }), 'Mexico final-bar rest');
  assert(!has(notes('mexico', 6, 0.45), { type: 'bandpass' }) && has(notes('mexico', 6, 0.46), { type: 'bandpass', freq: 1900 }), 'Mexico percussion intensity threshold');
  assert(has(notes('mexico', 191), { type: 'bandpass', freq: 2500, gain: 0.22 }), 'Mexico final fill');
});

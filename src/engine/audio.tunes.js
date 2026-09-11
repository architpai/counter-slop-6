// Music composition from docs/spec/hud-audio-ui.md, sections 12.2–12.4.
export const TUNES = {
  downtown: { bpm: 156, stepsPerBar: 16, bars: 56, steps: 896 },
  mexico: { bpm: 150, stepsPerBar: 12, bars: 16, steps: 192 },
};

// Each token is MIDI:length. A dash is a rest; held steps have no new onset.
const bars = (rows) => rows.map((row) => row.split(' ').flatMap((token) => {
  const [pitch, count] = token.split(':');
  const length = Number(count);
  return [pitch === '-' ? null : { note: Number(pitch), length }, ...Array(length - 1).fill(null)];
}));

const hook = bars([
  '76:2 79:2 84:3 -:1 79:2 76:2 -:4',
  '74:3 79:3 83:2 81:2 79:4 -:2',
  '81:2 84:2 88:4 86:2 84:2 81:4',
  '77:2 81:2 84:2 81:2 79:2 77:2 76:2 74:2',
]);
const tailA = bars([
  '72:2 76:2 79:4 -:2 84:4 -:2',
  '83:2 81:2 79:2 74:4 -:2 79:2 81:2',
  '81:3 77:3 84:3 81:3 79:4',
  '79:4 77:2 76:2 74:4 -:4',
]);
const tailB = bars([
  '76:2 79:2 84:2 88:6 -:4',
  '86:2 83:2 79:4 -:2 81:2 83:4',
  '84:2 81:2 77:4 81:2 84:2 86:4',
  '83:3 -:1 79:3 -:1 74:4 -:4',
]);
const bridge = bars([
  '69:2 69:2 72:2 76:4 -:2 69:4',
  '65:2 65:2 69:2 72:4 -:2 74:2 72:2',
  '76:2 76:2 74:2 72:4 -:2 67:4',
  '71:2 74:2 79:4 -:2 77:2 76:2 74:2',
  '69:2 69:2 72:2 76:4 -:2 81:4',
  '77:3 -:1 77:2 81:2 84:8',
  '83:2 81:2 79:4 74:4 79:4',
  '83:2 86:6 -:8',
]);
const breakdown = bars([
  '81:8 84:8', '83:8 86:8', '79:8 76:8', '81:12 -:4',
  '77:4 81:4 84:8', '79:4 83:4 86:8', '88:8 86:4 84:4', '79:4 -:12',
]);
const chorus = bars([
  '84:3 86:1 88:4 -:2 79:6',
  '83:3 79:1 76:4 -:2 83:6',
  '81:3 84:1 81:4 -:2 77:6',
  '79:2 81:2 83:4 86:4 -:4',
  '84:3 86:1 88:4 -:2 86:3 84:3',
  '83:3 79:1 76:4 -:2 83:3 84:3',
  '81:2 84:2 81:2 77:4 -:2 81:4',
  '79:4 83:2 86:2 79:4 -:4',
]);
const chords = { C: [60, 4], G: [55, 4], Am: [57, 3], F: [53, 4], Em: [52, 3] };
const progression = (names) => names.split(' ').map((name) => chords[name]);
const A = progression('C G Am F C G F G');
const B = progression('Am F C G Am F G G');
const C = progression('F G Em Am F G C C');
const D = progression('C Em F G C Em F G');
const sections = [
  { melody: [...hook, ...tailA], chords: A, bass: 'bounce', drums: 'full', arp: true },
  { melody: [...hook, ...tailB], chords: A, bass: 'bounce', drums: 'full', arp: true, shadow: 0.02 },
  { melody: bridge, chords: B, bass: 'drive', drums: 'driving' },
  { melody: breakdown, chords: C, bass: 'sparse', drums: 'sparse', echo: true },
  { melody: chorus, chords: D, bass: 'pump', drums: 'full', counter: true, shadow: 0.02 },
  { melody: [...hook, ...tailA], chords: A, bass: 'bounce', drums: 'full', arp: true, shadow: 0.045 },
  { melody: chorus, chords: D, bass: 'pump', drums: 'driving', arp: true, counter: true, shadow: 0.03 },
];
const mexicoMelody = bars([
  '74:2 79:2 83:2 86:4 83:2',
  '84:2 83:2 81:2 78:4 81:2',
  '79:2 83:2 86:2 91:4 86:2',
  '83:4 79:4 74:4',
  '76:2 79:2 84:2 88:4 84:2',
  '86:2 83:2 79:2 83:4 86:2',
  '81:2 84:2 78:2 81:4 84:2',
  '83:2 81:2 79:8',
  '79:4 83:4 86:4',
  '88:2 86:2 83:2 79:4 -:2',
  '84:2 88:2 91:4 88:2 84:2',
  '86:4 83:4 79:4',
  '81:2 84:2 88:2 86:4 84:2',
  '83:2 86:2 91:4 88:2 86:2',
  '84:2 83:2 81:2 79:4 78:2',
  '79:6 -:2 74:4',
]);
const mexicoChords = { G: [67, 4], D7: [62, 4], C: [60, 4], Em: [64, 3], Am: [69, 3] };
const mexicoProgression = 'G D7 G G C G D7 G G Em C G Am D7 C G'.split(' ').map((name) => mexicoChords[name]);
const midi = (note) => 440 * 2 ** ((note - 69) / 12);
function thirdBelow(note) {
  const scale = [7, 9, 11, 0, 2, 4, 6];
  const degree = scale.indexOf(note % 12);
  if (degree < 0) return note - 4;
  const pitch = scale[(degree + 5) % 7];
  let harmony = note - 1;
  while ((harmony % 12 + 12) % 12 !== pitch) harmony--;
  return harmony;
}

export function scheduleStep(key, index, at, intensity, tone, noise) {
  const mexico = key === 'mexico';
  const tune = TUNES[mexico ? 'mexico' : 'downtown'];
  const position = ((index % tune.steps) + tune.steps) % tune.steps;
  const bar = Math.floor(position / tune.stepsPerBar);
  const s = position % tune.stepsPerBar;
  const step = 60 / tune.bpm / 4;
  const play = (type, freq, duration, gain, delay = 0, end = freq) => tone({ type, freq, end, duration, gain, at: at + delay });
  const percussion = (type, freq, duration, gain) => noise({ type, freq, duration, gain, at });

  if (mexico) {
    const [root, third] = mexicoProgression[bar];
    const lead = mexicoMelody[bar][s];
    if (lead) {
      const duration = lead.length * step * 0.9;
      play('square', midi(lead.note), duration, 0.1);
      play('square', midi(thirdBelow(lead.note)), duration * 0.9, 0.055);
      if (bar >= 8) play('square', midi(lead.note + 12), duration * 0.6, 0.02);
    }
    if (s === 0) play('triangle', midi(root - 24), step * 3.4, 0.2);
    if (s === 4 || s === 8) {
      for (const note of [root, root + third, root + 7]) play('sawtooth', midi(note), step * 1.5, 0.045);
    }
    if (s % 2 === 0) percussion('highpass', 6500, s === 0 ? 0.05 : 0.03, s === 0 ? 0.13 : 0.07);
    if (intensity > 0.45 && (s === 6 || s === 10)) percussion('bandpass', 1900, 0.07, 0.16);
    if (bar === 15 && s >= 8) percussion('bandpass', 1600 + (s - 8) * 300, 0.06, 0.1 + (s - 8) * 0.04);
    return;
  }

  const section = sections[Math.floor(bar / 8)];
  const [root, third] = section.chords[bar % 8];
  const lead = section.melody[bar % 8][s];
  if (lead) {
    const freq = midi(lead.note);
    const duration = lead.length * step * 0.9;
    play('square', freq, duration, 0.1);
    play('square', freq * 1.004, duration, 0.04);
    if (section.shadow) play('square', freq * 2, duration * 0.7, section.shadow);
    if (section.echo) {
      play('square', freq, duration * 0.8, 0.035, step * 3);
      play('square', freq, duration * 0.6, 0.012, step * 6);
    }
  }

  const b = root - 12;
  const nextBar = (bar + 1) % tune.bars;
  let nb = sections[Math.floor(nextBar / 8)].chords[nextBar % 8][0] - 12;
  while (nb - b > 6) nb -= 12;
  while (b - nb > 6) nb += 12;
  const approach = nb === b ? b + 7 : nb > b ? nb - 1 : nb + 1;
  const bass = (note, length, gain = 0.16) => play('triangle', midi(note), step * length, gain);
  if (section.bass === 'bounce' && s % 2 === 0) bass(b + [0, 0, 12, 0, 0, 7, 0, 12][s / 2], 1.6);
  if (section.bass === 'drive' && s % 2 === 0) bass(s === 14 ? approach : s === 6 ? b + 12 : s === 12 ? b + 7 : b, 1.4, 0.17);
  if (section.bass === 'sparse') {
    if (s === 0) bass(b, 6, 0.14);
    if (s === 8) bass(b + 7, 4, 0.12);
  }
  if (section.bass === 'pump') {
    if (s === 0 || s === 8) bass(b, 2.5);
    if (s === 4) bass(b + 7, 2.5);
    if (s === 12) bass(b + 12, 1.6);
    if (s === 14) bass(approach, 1.4);
  }
  if (section.arp) play('square', midi([root, root + third, root + 7, root + 12][s % 4] + 12), step * 0.8, 0.03 + 0.02 * intensity);
  if (section.counter && s % 4 === 2) play('triangle', midi([root + 12, root + third + 12, root + 19, root + third + 12][(s - 2) / 4]), step * 1.5, 0.06);

  if (bar % 8 === 0 && s === 0) percussion('highpass', 5000, 0.4, 0.14);
  if (bar % 8 === 7 && s >= 12) {
    percussion('bandpass', 1800 + (s - 12) * 350, 0.08, 0.12 + (s - 12) * 0.05);
    return;
  }
  const driving = section.drums === 'driving';
  const sparse = section.drums === 'sparse';
  const kick = driving ? s % 4 === 0 : sparse ? s === 0 : s === 0 || s === 8 || (intensity > 0.5 && s === 10) || (bar % 2 === 1 && s === 14);
  if (kick) play('sine', 160, 0.12, sparse ? 0.3 : 0.45, 0, 45);
  if (!sparse && (s === 4 || s === 12)) percussion('bandpass', 2200, 0.11, 0.22);
  const hat = driving || (sparse ? s === 8 : s % 2 === 0 || intensity > 0.4);
  if (hat) percussion('highpass', 8000, s % 4 === 2 ? 0.05 : 0.025, (s % 4 === 2 ? 0.1 : 0.06) * (s % 2 ? 0.5 : 1) * (sparse ? 0.6 : 1));
}

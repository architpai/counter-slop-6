import { expect, test } from 'vitest';
import { advanceTeamMatch, assignTeams, createTeamMatch, dropFlag, interactFlag, markDead, scoreTeam, TEAM_RULES, validTeamMatch, validTeams } from '@/engine/game/team-rules';
import type { FlagPlayer, TeamLayout } from '@/engine/game/team-rules';
import { NET, publicCode, validEnvelope } from '@/engine/net';

const layout: TeamLayout = { neutral: [0, 0, 0], bases: [[-10, 0, 0], [10, 0, 0]], spawns: [[[-20, 0, 0]], [[20, 0, 0]]] };
const red: FlagPlayer = { id: 'red', team: 0, pos: [0, 0, 0], alive: true };
const blue: FlagPlayer = { id: 'blue', team: 1, pos: [10, 0, 0], alive: true };
const open = () => true;

test('teams fill the smaller side, preserve memberships and never exceed four', () => {
  const ids = Array.from({ length: 9 }, (_, n) => `p${n}`);
  const teams = assignTeams(ids);
  expect(Object.values(teams).filter(t => t === 0)).toHaveLength(4);
  expect(Object.values(teams).filter(t => t === 1)).toHaveLength(4);
  expect(teams.p8).toBeUndefined();
  const late = assignTeams(['a', 'b', 'c', 'd'], { a: 0, b: 1, c: 0 });
  expect(late).toEqual({ a: 0, b: 1, c: 0, d: 1 });
  expect(validTeams(late)).toBe(true);
  expect(validTeams(Object.fromEntries(ids.slice(0, 5).map(id => [id, 0])))).toBe(false);
});

test('neutral pickup, placement and enemy steal reset the full hold', () => {
  const s = createTeamMatch('flag', layout.neutral), r = structuredClone(red), b = structuredClone(blue);
  interactFlag(s, [r, b], layout, () => false);
  expect(s.flag.carrier).toBeNull(); // Cannot touch through a wall.
  interactFlag(s, [r, b], layout, open);
  expect(s.flag.carrier).toBe('red');
  r.pos = [-10, 0, 0];
  interactFlag(s, [r, b], layout, open);
  expect(s.flag.placed).toBe(0);
  advanceTeamMatch(s, 29, layout);
  expect(s.flag.holdLeft).toBe(1);
  interactFlag(s, [r], layout, open);
  expect(s.flag.placed).toBe(0); // A defender cannot pick up their placed flag.
  b.pos = [-10, 0, 0];
  interactFlag(s, [r, b], layout, open);
  expect(s.flag).toMatchObject({ carrier: 'blue', placed: null, holdLeft: 30 });
  b.pos = [10, 0, 0];
  interactFlag(s, [r, b], layout, open);
  advanceTeamMatch(s, 30, layout);
  expect(s.scores).toEqual([0, 1]);
  expect(s.breakLeft).toBe(5);
  advanceTeamMatch(s, 1, layout);
  expect(s.scores).toEqual([0, 1]); // Never score twice for one placement.
  advanceTeamMatch(s, 4, layout);
  expect(s.round).toBe(2);
  expect(s.roundLeft).toBe(150);
  expect(s.flag).toMatchObject({ carrier: null, placed: null, pos: [0, 0, 0], holdLeft: 30 });
});

test('carrier death/drop and unattended return; dead players cannot take flags', () => {
  const s = createTeamMatch('flag', layout.neutral);
  interactFlag(s, [red], layout, open);
  dropFlag(s, 'other', [4, 0, 0]);
  expect(s.flag.carrier).toBe('red');
  dropFlag(s, 'red', [4, 0, 0]);
  expect(s.flag).toMatchObject({ carrier: null, pos: [4, 0, 0], returnLeft: 15 });
  advanceTeamMatch(s, 15, layout);
  expect(s.flag.pos).toEqual(layout.neutral);
  markDead(s, 'red');
  interactFlag(s, [red], layout, open);
  expect(s.flag.carrier).toBeNull();
  interactFlag(s, [{ ...red, id: 'other', alive: false }], layout, open);
  expect(s.flag.carrier).toBeNull();
});

test.each(['tdm', 'flag'] as const)('%s uses global eight-second waves including full wipes', mode => {
  const s = createTeamMatch(mode, layout.neutral);
  advanceTeamMatch(s, 2, layout);
  expect(markDead(s, 'red')).toBe(true);
  advanceTeamMatch(s, 5, layout);
  expect(markDead(s, 'blue')).toBe(true);
  expect(markDead(s, 'red')).toBe(false);
  expect(s.dead).toEqual({ red: 8, blue: 8 });
  advanceTeamMatch(s, 1, layout);
  expect(s.dead).toEqual({});
  markDead(s, 'red');
  expect(s.dead.red).toBe(16); // Dying on a wave belongs to the following wave.
});

test('scoreless round timeout and exact-deadline hold', () => {
  const s = createTeamMatch('flag', layout.neutral);
  advanceTeamMatch(s, 150, layout);
  expect(s.scores).toEqual([0, 0]);
  expect(s.breakLeft).toBe(5);
  advanceTeamMatch(s, 5, layout);
  s.roundLeft = 30; s.flag.placed = 0;
  advanceTeamMatch(s, 30, layout);
  expect(s.scores).toEqual([1, 0]);
  expect(s.breakLeft).toBe(5);
});

test.each([[0, 0, 0, '3–0'], [0, 1, 0, 0, 0, '4–1'], [0, 1, 0, 1, 0, 1, 0, 1, 0, '5–4']])('normal flag win: %j', (...sequence) => {
  const s = createTeamMatch('flag', layout.neutral);
  for (const side of sequence) if (side === 0 || side === 1) scoreTeam(s, side);
  expect(s.winner).toBe(0);
});

test('tied timeout replaces first-five with two consecutive scoring wins', () => {
  const s = createTeamMatch('flag', layout.neutral);
  s.scores = [4, 4]; s.flag.placed = 0; s.flag.holdLeft = 20;
  s.elapsed = 479;
  advanceTeamMatch(s, 1, layout);
  expect(s.overtime).toBe(true);
  expect(s.flag.placed).toBeNull();
  scoreTeam(s, 0);
  expect(s.scores).toEqual([5, 4]);
  expect(s.winner).toBeNull();
  scoreTeam(s, 1);
  expect(s.streakTeam).toBe(1);
  expect(s.streak).toBe(1);
  advanceTeamMatch(s, 150, layout); // A scoreless round does not erase the streak.
  expect(s.streak).toBe(1);
  advanceTeamMatch(s, 5, layout);
  scoreTeam(s, 0); scoreTeam(s, 0);
  expect(s.winner).toBe(0);
});

test('time limit awards the leading team; TDM tie uses next enemy kill', () => {
  const flag = createTeamMatch('flag', layout.neutral);
  flag.scores = [1, 2];
  advanceTeamMatch(flag, 480, layout);
  expect(flag.winner).toBe(1);
  const tdm = createTeamMatch('tdm', layout.neutral);
  tdm.scores = [39, 39];
  advanceTeamMatch(tdm, 480, layout);
  expect(tdm.overtime).toBe(true);
  scoreTeam(tdm, 1);
  expect(tdm.winner).toBe(1);
});

test.each([40, 200, 500])('one %i-second host update matches one-second steps across all timer boundaries', seconds => {
  for (const placed of [null, 0] as const) {
    const s = createTeamMatch('flag', layout.neutral);
    s.flag.placed = placed;
    if (placed === null) { s.flag.pos = [4, 0, 0]; s.flag.returnLeft = 15; }
    const stepped = structuredClone(s);
    advanceTeamMatch(s, seconds, layout);
    for (let i = 0; i < seconds; i++) advanceTeamMatch(stepped, 1, layout);
    expect(s).toEqual(stepped);
  }
});

test('wire bounds cover team snapshots, mode selection, round-tagged state and deaths', () => {
  const s = createTeamMatch('flag', layout.neutral);
  expect(validTeamMatch(s)).toBe(true);
  expect(validTeamMatch({ ...s, elapsed: NaN })).toBe(false);
  expect(validTeamMatch({ ...s, flag: { ...s.flag, holdLeft: 31 } })).toBe(false);
  expect(validTeamMatch({ ...s, flag: { ...s.flag, carrier: 'x', placed: 0 } })).toBe(false);
  expect(validTeamMatch({ ...s, dead: { x: Infinity } })).toBe(false);
  expect(validEnvelope({ t: 'teamstate', d: s, from: 'host' })).toBe(true);
  expect(validEnvelope({ t: 'lobby', d: { hostId: 'host', players: [], isPublic: false, mode: 'flag', teams: {} }, from: 'host' })).toBe(true);
  expect(validEnvelope({ t: 'ps', d: { round: 1, state: [0, 0, 0, 0, 0, 0, 80, 100] }, relay: true })).toBe(true);
  expect(validEnvelope({ t: 'ps', d: { round: -1, state: [] }, relay: true })).toBe(false);
  expect(validEnvelope({ t: 'pdead', d: { killer: null, dir: null, over: false, how: null, crit: false, round: 1 }, relay: true })).toBe(true);
  for (const [type, data] of [
    ['pdmg', { amount: 20, from: null, by: 'host', src: 'rifle' }],
    ['headshot', { hitId: 1 }], ['cut', {}], ['parry', { by: 'host', ret: false }],
  ] as const) {
    expect(validEnvelope({ t: type, d: { ...data, round: 2 }, from: 'host' })).toBe(true);
    expect(validEnvelope({ t: type, d: { ...data, round: -1 }, from: 'host' })).toBe(false);
  }
  expect(publicCode('ffa', 0)).toBe('PUB0');
  expect(publicCode('tdm', 7)).toBe('TDM7');
  expect(publicCode('flag', 3)).toBe('FLG3');
  expect(NET.PREFIX_DEV).toContain('v2');
  expect(TEAM_RULES.ROUND).toBe(150);
});

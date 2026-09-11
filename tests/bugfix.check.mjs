// Regression checks for the two bugs fixed alongside the port. Both predate the
// TypeScript conversion and neither is visible to tests/smoke.mjs.
//   node tests/bugfix.check.mjs
import { Vector3 } from 'three';

let pass = 0, fail = 0;
const check = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? '  ok  ' : 'FAIL  '}${label}`); };

// ---------------------------------------------------------------- bug 1
// input.onDeviceChange emits 'keyboard' | 'gamepad'. Passing that string
// straight into hud.setDevice(pad: boolean) made every switch read as gamepad.
const asShipped = device => Boolean(device);
const fixed = device => device === 'gamepad';

check(fixed('gamepad') === true, "device 'gamepad' maps to pad = true");
check(fixed('keyboard') === false, "device 'keyboard' maps to pad = false");
check(asShipped('keyboard') === true, 'the old coercion really did read keyboard as gamepad');

// ---------------------------------------------------------------- bug 2
// segmentHits writes `point - prev` through its `sample` scratch, then measures
// distance to `point`. When the caller passed `sample` itself, those aliased and
// the feet probe measured against a relative vector.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const seg = new Vector3(), sample = new Vector3(), closest = new Vector3(), feet = new Vector3();

function segmentHits(p, point, r) {
  seg.subVectors(p.pos, p.prev);
  const l2 = seg.lengthSq();
  const t = l2 > 0 ? clamp(sample.subVectors(point, p.prev).dot(seg) / l2, 0, 1) : 0;
  return closest.copy(p.prev).addScaledVector(seg, t).distanceTo(point) <= r;
}
const eye = c => new Vector3(c.x, c.y + 0.5, c.z);
const hitsAliased = (p, c, r) =>
  segmentHits(p, c, r) || segmentHits(p, eye(c), r) ||
  segmentHits(p, sample.set(c.x, c.y - 0.55, c.z), r - 0.05);
const hitsFixed = (p, c, r) =>
  segmentHits(p, c, r) || segmentHits(p, eye(c), r) ||
  segmentHits(p, feet.set(c.x, c.y - 0.55, c.z), r - 0.05);

// A shot straight through the shins, level with the feet: only the third probe
// can catch it, so it isolates the bug.
const center = new Vector3(0, 1.4, 0);
const shin = new Vector3(center.x, center.y - 0.55, center.z);
const from = new Vector3(-6, shin.y, 0);
const shot = { prev: from.clone(), pos: from.clone().add(new Vector3(12, 0, 0)) };

check(hitsFixed(shot, center, 0.5) === true, 'a shot through the shins registers after the fix');
check(hitsAliased(shot, center, 0.5) === false, 'the same shot was missed before the fix');

// Aliasing must not have perturbed the first two probes.
const chest = { prev: new Vector3(-6, 1.4, 0), pos: new Vector3(6, 1.4, 0) };
check(hitsFixed(chest, center, 0.5) === hitsAliased(chest, center, 0.5),
  'centre-mass hits are unaffected either way');

// Population measure, so the size of the change is on the record.
let before = 0, after = 0, n = 200_000;
for (let i = 0; i < n; i++) {
  const c = new Vector3(0, 1.4, 0);
  const f = new Vector3(Math.random() * 16 - 8, Math.random() * 3 + 0.4, Math.random() * 16 - 8);
  if (f.length() < 3) continue;
  const aim = new Vector3(c.x, c.y - 0.55 + Math.random() * 1.6, c.z);
  const d = aim.clone().sub(f).normalize();
  const p = { prev: f.clone(), pos: f.clone().addScaledVector(d, f.distanceTo(aim) + Math.random() * 1.2) };
  if (hitsAliased(p, c, 0.5)) before++;
  if (hitsFixed(p, c, 0.5)) after++;
}
const recovered = (100 * (after - before) / after).toFixed(2);
console.log(`  ..  recovered ${after - before} of ${after} aimed hits (${recovered}%)`);
check(after > before, 'the fix recovers hits rather than losing them');

console.log(fail ? `\n${fail} failed` : `\nall ${pass} passed`);
process.exit(fail ? 1 : 0);

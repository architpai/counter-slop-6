// Pad labels name both common layouts (PlayStation / Xbox); any standard-mapping controller works.
const LABELS: Record<string, readonly [string, string]> = {
  fire: ['LMB', 'R2 / RT'], aim: ['RMB', 'L2 / LT'], block: ['RMB', 'L2 / LT'],
  jump: ['Space', '✕ / A'], sprint: ['Shift', 'L3 / LS'], slide: ['C', '○ / B'], dash: ['C', '○ / B'],
  grapple: ['Q', 'L1 / LB'], melee: ['F', 'R1 / RB'], reload: ['R', '□ / X'], grenade: ['G', 'R3 / RS'],
  focus: ['both mouse buttons (or X)', 'L2 + R2 / LT + RT'], next: ['wheel', '△ / Y'],
  pause: ['Esc', 'Options / Menu'], confirm: ['Space', '✕ / A'], score: ['Tab', 'Create / View'],
};

export function key(action: string, pad = false): string {
  const labels = Object.hasOwn(LABELS, action) ? LABELS[action] : undefined;
  return labels ? labels[pad ? 1 : 0] : String(action);
}

/** Row text for the control columns. `<b>` is the only markup React renders. */
export const KEYBOARD_ROWS: readonly string[] = [
  '<b>WASD</b> move   <b>Mouse</b> look   <b>Shift</b> sprint',
  '<b>LMB</b> fire · slash   <b>RMB</b> aim down sights · sword guard',
  '<b>Space</b> jump · again on a wall = wall jump',
  '<b>C / Ctrl</b> slide on the ground · air dash in the air',
  '<b>Q / E</b> grapple: tap to swing, hold to reel, jump to launch',
  '<b>F / V</b> quick slash with the sword   <b>R</b> reload   <b>M</b> music',
  '<b>Slash in the air</b> the sword throws a wave up to 12 m',
  '<b>G</b> grenade · hold it to throw further',
  '<b>Tab</b> scoreboard (online)   <b>Esc</b> pause',
  '<b>Both mouse buttons</b> dash-slash once the gauge is lit',
  '<b>1-3 / wheel</b> your loadout slots · pick and order them under Weapons',
  '<b>Enter</b> skips the break between waves',
];

export const PAD_ROWS: readonly string[] = [
  '<b>L stick</b> move   <b>R stick</b> look   <b>L3 / LS</b> click to sprint',
  '<b>R2 / RT</b> fire · slash   <b>L2 / LT</b> aim · sword guard',
  '<b>✕ / A</b> jump   <b>○ / B</b> slide · air dash',
  '<b>L1 / LB</b> grapple (hold to reel, jump to launch)',
  '<b>L2 + R2</b> dash-slash once the sword gauge is lit',
  '<b>R1 / RB</b> quick slash with the sword · slash in the air for a wave',
  '<b>□ / X</b> reload   <b>△ / Y</b> next weapon',
  '<b>R3 / RS click</b> or <b>d-pad up</b> grenade · hold to throw further',
  '<b>Create / View</b> scoreboard (online)   <b>Options / Menu</b> pause',
];

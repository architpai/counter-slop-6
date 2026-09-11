const LABELS: Record<string, readonly [string, string]> = {
  fire: ['LMB', 'R2'], aim: ['RMB', 'L2'], block: ['RMB', 'L2'],
  jump: ['Space', '✕'], sprint: ['Shift', 'L3'], slide: ['C', '○'], dash: ['C', '○'],
  grapple: ['Q', 'L1'], melee: ['F', 'R1'], reload: ['R', '□'], grenade: ['G', 'R3'],
  focus: ['both mouse buttons (or X)', 'L2 + R2'], next: ['wheel', '△'],
  pause: ['Esc', 'Options'], confirm: ['Space', '✕'], score: ['Tab', 'Create'],
};

export function key(action: string, pad = false): string {
  const labels = Object.hasOwn(LABELS, action) ? LABELS[action] : undefined;
  return labels ? labels[pad ? 1 : 0] : String(action);
}

/** Row text for the control columns. `<b>` is the only markup React renders. */
export const KEYBOARD_ROWS: readonly string[] = [
  '<b>WASD</b> move   <b>Mouse</b> look   <b>Shift</b> sprint',
  '<b>LMB</b> fire / slash   <b>RMB</b> aim down sights / block',
  '<b>Space</b> jump (again on a wall = wall jump)',
  '<b>Space</b> again in the air = double jump',
  '<b>C / Ctrl</b> slide on the ground · air dash in the air',
  '<b>Q / E</b> grapple: tap to swing, hold to reel, jump to launch',
  '<b>F</b> quick katana slash   <b>R</b> reload   <b>M</b> music',
  '<b>G</b> grenade · hold it to throw further',
  '<b>Tab</b> scoreboard (online)   <b>Esc</b> pause',
  '<b>Both mouse buttons</b> dash-slash once the gauge is lit',
  '<b>1-4 / wheel</b> rifle · shotgun · sniper · katana',
];

export const PAD_ROWS: readonly string[] = [
  '<b>L stick</b> move   <b>R stick</b> look   <b>L3</b> sprint',
  '<b>R2</b> fire / slash   <b>L2</b> aim / block',
  '<b>✕</b> jump   <b>○</b> slide · air dash',
  '<b>L1</b> grapple (hold to reel, ✕ to launch)',
  '<b>L2 + R2</b> dash-slash once the katana gauge is lit',
  '<b>R1</b> quick katana slash, then back to your gun',
  '<b>□</b> reload   <b>△</b> next weapon',
  '<b>R3 / d-pad up</b> grenade · hold to throw further',
  '<b>Create</b> scoreboard (online)   <b>Options</b> pause',
];

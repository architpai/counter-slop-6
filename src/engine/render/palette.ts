export const TONE = Object.freeze({ PRIMARY: 0, HOSTILE: 1, DARK: 2, ACCENT: 3, HEAL: 4, BOSS: 5 } as const);
/** Tone ids stay 0-5 (§3.1), so they double as the index into every tone table. */
export type ToneId = (typeof TONE)[keyof typeof TONE];
/** A table with one entry per tone id. Adding a tone to `TONE` breaks these until they are filled in. */
export type ByTone<T> = { readonly [K in ToneId]: T };
export const TONE_HEX: ByTone<number> & readonly number[] =
  Object.freeze([0x4c7dff, 0xff4757, 0x2a3140, 0xffb020, 0x37d67a, 0xc56bff] as const);
export const SURF = Object.freeze({
  sky: 0xa8d2e2, fog: 0xcbdde2, ground: 0xb5b7ad, road: 0x52606a,
  block: 0xe5e4d9, blockAlt: 0x96a9b4, blockDeep: 0x405562, roof: 0xc87651,
  wood: 0x9f7858, metal: 0xb8c6cc, dark: 0x263640, accent: 0xe7b34f,
  foliage: 0x4f8766, water: 0x40b7b7, hot: 0xc96557, boss: 0xa887b7, cloud: 0xfbfaf5,
  lawn: 0x829b65, siding: 0xf0e6d2, shingle: 0x3e5262, plaster: 0xd9dcd5,
  adobe: 0xe5bd92, sandstone: 0xbe845d, sand: 0xdbc59c, paving: 0xe1d8c3,
});
export type SurfKey = keyof typeof SURF;

/** Shared finishes for the weapon-mounted sights and their aiming overlays. */
export const OPTIC_COLOR = Object.freeze({
  acogBody: '#353633', acogRim: '#615e54',
  holoBody: '#343d41', holoBase: '#1c2428', reticle: '#ed2428',
});

export const WHITE_HEX = 0xffffff;
export const SMOKE_HEX = 0xdde4ec;

// Private lighting colours and gradient levels.
export const LIGHT = Object.freeze({ sun: 0xffefd6, sky: 0xafcbe1, ground: 0x626772, zenith: 0x5294b7 });
export const TOON_STEPS = Object.freeze([64, 160, 255]);

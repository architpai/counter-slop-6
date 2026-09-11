export const TONE = Object.freeze({ PRIMARY: 0, HOSTILE: 1, DARK: 2, ACCENT: 3, HEAL: 4, BOSS: 5 } as const);
/** Tone ids stay 0-5 (§3.1), so they double as the index into every tone table. */
export type ToneId = (typeof TONE)[keyof typeof TONE];
/** A table with one entry per tone id. Adding a tone to `TONE` breaks these until they are filled in. */
export type ByTone<T> = { readonly [K in ToneId]: T };
export const TONE_HEX: ByTone<number> & readonly number[] =
  Object.freeze([0x4c7dff, 0xff4757, 0x2a3140, 0xffb020, 0x37d67a, 0xc56bff] as const);
export const SURF = Object.freeze({
  sky: 0x9fd2e8, fog: 0xc7e3ef, ground: 0xcfc7b4, road: 0x9e9a90,
  block: 0xefe9dc, blockAlt: 0x7c8aa0, blockDeep: 0x48566b, roof: 0xe0714a,
  wood: 0xb4784a, metal: 0xa6aeb8, dark: 0x232b38, accent: 0xffc24b,
  foliage: 0x4ca96b, water: 0x4fb3d9, hot: 0xe5484d, boss: 0xc56bff, cloud: 0xfbfaf5,
  lawn: 0x8cb46a, siding: 0xf1ead9, shingle: 0x3f4756, plaster: 0xd9d4c8,
});
export type SurfKey = keyof typeof SURF;

export const WHITE_HEX = 0xffffff;
export const SMOKE_HEX = 0xdde4ec;

// Private lighting colours and gradient levels.
export const LIGHT = Object.freeze({ sun: 0xfff6e5, sky: 0xbbd9ec, ground: 0x8a8474, zenith: 0x5ea6dc });
export const TOON_STEPS = Object.freeze([64, 160, 255]);

import type { Grade } from '../types';
import type { MaterialTag } from './surfaces';

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

/**
 * Realistic tiers (R2): the albedo each material tag averages to, sRGB. The
 * texture set brings the detail and the tint scales its mean to this colour.
 * Natural materials use plausible albedos (asphalt dark, grass and concrete
 * mid-dark, sand light), so a sunlit street no longer glows like the flat
 * palette; `null` keeps the piece's own surface colour, for paint, plaster,
 * render, paving, fabric and the like, so a map's colour scheme survives (and
 * for a fountain's jets, `spray`, which keep their teal at any distance, where
 * glossy dark water would read black). Contrast
 * inside each texture stays moderate, so enemies read against every wall.
 */
export const MATERIAL_COLOR = Object.freeze({
  concrete: 0x928f88, 'cast-concrete': 0x9a978f, brick: 0x85523f, plaster: null, stucco: null, adobe: null,
  siding: null, asphalt: 0x4e4f50, 'road-paint': null, paving: null, tile: null, wood: 0x8a6446, bark: 0x5c4c3e,
  'painted-wood': null, planks: 0x8f6c4d, plastic: null, 'painted-metal': null, steel: 0x8e9397, 'tread-plate': 0x898d90,
  rust: 0x7a4a33, corrugated: null, glass: 0x2c3438, sand: 0xc6ae8a, sandstone: 0xb07d5a, terracotta: 0xae6242,
  'roof-tile': 0xa55a3b, shingles: null, grass: 0x61793f, fabric: null, foliage: 0x506f3c,
  flowers: null, cactus: 0x5e7a4b, water: 0x3f7a78, spray: null,
} as const satisfies Record<MaterialTag, number | null>);

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

/**
 * Per-mood colour grades (V4), applied after tone mapping. The numbers stay
 * small on purpose: the flat palette must still read as itself. Lift works in
 * the shader's square-root space, so black stays black and a dark colour moves
 * a few levels at most.
 */
export const GRADE = Object.freeze({
  neutral: { lift: [0, 0, 0], gain: [1, 1, 1], saturation: 1, contrast: 1 },
  /** Cool morning: blue in the shadows, warm sunlit faces. */
  downtown: { lift: [0.006, 0.012, 0.03], gain: [1.02, 1, 0.97], saturation: 1.03, contrast: 1.06 },
  /** Low evening sun: warm throughout. */
  house: { lift: [0.02, 0.01, 0], gain: [1.02, 0.99, 0.95], saturation: 1.03, contrast: 1.04 },
  /** Sun-baked: warmer and a touch more saturated. */
  mexico: { lift: [0.016, 0.008, 0], gain: [1.02, 1, 0.95], saturation: 1.08, contrast: 1.05 },
  training: { lift: [0, 0.004, 0.012], gain: [1, 1, 1], saturation: 1, contrast: 1.03 },
} as const satisfies Record<string, Grade>);

/**
 * Grades for the realistic look (R1), applied after AgX. The physical skies
 * are all clear daylight at 30-55 degrees of sun, so each map's mood (a cool
 * morning, a warm afternoon, a sun-baked plaza) comes from here, the mood's
 * exposure and the fog haze (render/index.ts). Saturation stays close to 1:
 * the sky-lit shade is already blue, and more of it turned grey concrete navy
 * and dark paint black. Downtown takes no warm gain, as its sun is warm
 * already; a stronger warm gain than House's turns its lawn to straw.
 */
export const REAL_GRADE = Object.freeze({
  downtown: { lift: [0.004, 0.008, 0.016], gain: [1, 1, 1], saturation: 1.04, contrast: 1.08 },
  house: { lift: [0.02, 0.01, 0], gain: [1.06, 1, 0.9], saturation: 1.05, contrast: 1.06 },
  mexico: { lift: [0.018, 0.008, 0], gain: [1.1, 1.01, 0.85], saturation: 1.05, contrast: 1.06 },
  training: { lift: [0, 0.004, 0.012], gain: [1, 1, 1], saturation: 1.04, contrast: 1.06 },
} as const satisfies Record<string, Grade>);

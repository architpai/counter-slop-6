export type GunKind = 'r4c' | 'rifle' | 'pistol' | 'shotgun' | 'sniper' | 'revolver';
/** Shared slot order for the local loadout and remote weapon props. `rifle` is the MP5. */
export const GUN_LOADOUT = ['r4c', 'rifle', 'shotgun', 'sniper', 'pistol'] as const;
export type RifleOptic = 'acog' | 'holo';
export type ScopeKind = RifleOptic | 'sniper';

/** How the magazine is refilled, and which pose plays while it is. */
export type ReloadType = 'magazine' | 'shells' | 'cylinder';

/** The `Audio` cue played on every shot. */
export type FireCue = 'shot' | 'mp5Fire' | 'pistolFire' | 'shotgunFire' | 'sniperFire' | 'revolver';

/** `[x, y, z]` offsets and positions, straight into `Vector3`. */
export type Triple = [number, number, number];

/** `[fullRange, zeroRange, minScale]`: full damage to `fullRange`, `minScale` past `zeroRange`. */
export type Falloff = [number, number, number];

/** One row of `ARCHITECTURE.md` §6.11 / `weapons.md` §4, one field per table column. */
export interface GunStats {
  kind: GunKind;
  name: string;
  hint: string;
  scope: boolean;
  magSize: number;
  startingReserve: number;
  maxReserve: number;
  fireInterval: number;
  automatic: boolean;
  damage: number;
  headMult: number;
  pellets: number;
  hipSpread: number;
  adsSpread: number;
  spreadKick: number;
  spreadMax: number;
  moveSpread: number;
  adsFov: number;
  /** `[pitch, yaw]` */
  camKick: [number, number];
  /** `[posX, posY, posZ, rotX, rotY, rotZ]` spring kicks. */
  modelKick: [number, number, number, number, number, number];
  fovKick: number;
  reloadDuration: number;
  reloadType: ReloadType;
  falloff: Falloff | null;
  tracerThickness: number;
  flashScale: number;
  fireCue: FireCue;
  /** `[size, tone]` of the ejected shell, or null for a gun that keeps its brass. */
  casing: [number, number] | null;
  cycleDuration: number;
  /** `[damage, headMult, falloff]` against other players. */
  pvp: [number, number, Falloff | null];
  restPos: Triple;
  /** Sight position in model space; drives the aim pose. */
  sight: Triple;
  eyeDistance: number;
}

export const GUN_STATS: Record<GunKind, GunStats> = {
  r4c: {
    kind: 'r4c', name: 'R4-C', hint: 'auto · high damage · control your bursts', scope: true,
    magSize: 30, startingReserve: 150, maxReserve: 300, fireInterval: 0.08, automatic: true,
    damage: 36, headMult: 2.5, pellets: 1, hipSpread: 0.022, adsSpread: 0.0025,
    spreadKick: 0.007, spreadMax: 0.065, moveSpread: 0.0012, adsFov: 38,
    camKick: [0.0105, 0.0035], modelKick: [0.18, 0.3, 2.5, -3.3, 0.7, 1], fovKick: 1.1,
    reloadDuration: 2.2, reloadType: 'magazine', falloff: [28, 88, 0.55],
    tracerThickness: 0.024, flashScale: 1.25, fireCue: 'shot', casing: [0.024, 3], cycleDuration: 0,
    pvp: [26, 1.8, [24, 74, 0.45]], restPos: [0.20, -0.17, -0.36], sight: [0, 0.145, -0.10], eyeDistance: 0.34,
  },
  rifle: {
    kind: 'rifle', name: 'MP5', hint: 'auto · low recoil · accurate on the move', scope: true,
    magSize: 30, startingReserve: 150, maxReserve: 300, fireInterval: 0.075, automatic: true,
    damage: 22, headMult: 2.6, pellets: 1, hipSpread: 0.012, adsSpread: 0.0025,
    spreadKick: 0.005, spreadMax: 0.05, moveSpread: 0.0005, adsFov: 38,
    camKick: [0.007, 0.0025], modelKick: [0.15, 0.2, 1.7, -2.2, 0.5, 0.7], fovKick: 0.7,
    reloadDuration: 1.65, reloadType: 'magazine', falloff: [18, 55, 0.4],
    tracerThickness: 0.02, flashScale: 1, fireCue: 'mp5Fire', casing: [0.02, 3], cycleDuration: 0,
    pvp: [18, 1.8, [15, 45, 0.4]], restPos: [0.20, -0.17, -0.36], sight: [0, 0.145, -0.10], eyeDistance: 0.34,
  },
  pistol: {
    kind: 'pistol', name: 'PISTOL', hint: 'semi-auto · close-range headshots · quick reload', scope: false,
    magSize: 15, startingReserve: 90, maxReserve: 180, fireInterval: 0.18, automatic: false,
    damage: 40, headMult: 2.6, pellets: 1, hipSpread: 0.008, adsSpread: 0.002,
    spreadKick: 0.006, spreadMax: 0.035, moveSpread: 0.0004, adsFov: 62,
    camKick: [0.014, 0.003], modelKick: [0.15, 0.3, 1.8, -4, 0.4, 0.7], fovKick: 1,
    reloadDuration: 1, reloadType: 'magazine', falloff: [12, 40, 0.35],
    tracerThickness: 0.018, flashScale: 0.9, fireCue: 'pistolFire', casing: [0.018, 3], cycleDuration: 0,
    pvp: [32, 2, [12, 40, 0.35]], restPos: [0.22, -0.19, -0.34], sight: [0, 0.11, -0.10], eyeDistance: 0.30,
  },
  shotgun: {
    kind: 'shotgun', name: 'SHOTGUN', hint: 'pump · devastating up close', scope: false,
    magSize: 6, startingReserve: 36, maxReserve: 72, fireInterval: 0.78, automatic: false,
    damage: 19, headMult: 1.8, pellets: 10, hipSpread: 0.062, adsSpread: 0.034,
    spreadKick: 0, spreadMax: 0.10, moveSpread: 0.0006, adsFov: 68,
    camKick: [0.05, 0.012], modelKick: [0.4, 0.6, 5, -9, 2, 3], fovKick: 4,
    reloadDuration: 0.45, reloadType: 'shells', falloff: [11, 32, 0.22],
    tracerThickness: 0.014, flashScale: 1.9, fireCue: 'shotgunFire', casing: [0.035, 1], cycleDuration: 0.45,
    pvp: [16, 1.6, [9, 26, 0.15]], restPos: [0.20, -0.19, -0.34], sight: [0, 0.095, -1], eyeDistance: 0.52,
  },
  sniper: {
    kind: 'sniper', name: 'SNIPER', hint: 'scoped bolt action · one shot, one kill', scope: true,
    magSize: 5, startingReserve: 25, maxReserve: 50, fireInterval: 0.2, automatic: false,
    damage: 150, headMult: 3, pellets: 1, hipSpread: 0.075, adsSpread: 0.0004,
    spreadKick: 0.05, spreadMax: 0.14, moveSpread: 0.004, adsFov: 20,
    camKick: [0.055, 0.008], modelKick: [0.25, 0.8, 4.5, -11, 1.2, 2], fovKick: 4.5,
    reloadDuration: 2.1, reloadType: 'magazine', falloff: null,
    tracerThickness: 0.03, flashScale: 1.7, fireCue: 'sniperFire', casing: [0.03, 3], cycleDuration: 0.85,
    pvp: [100, 2, null], restPos: [0.21, -0.19, -0.36], sight: [0, 0.135, 0], eyeDistance: 0.42,
  },
  revolver: {
    kind: 'revolver', name: 'REVOLVER', hint: 'hand cannon · headshots delete', scope: false,
    magSize: 6, startingReserve: 36, maxReserve: 72, fireInterval: 0.3, automatic: false,
    damage: 62, headMult: 3, pellets: 1, hipSpread: 0.006, adsSpread: 0.002,
    spreadKick: 0.02, spreadMax: 0.06, moveSpread: 0.0015, adsFov: 52,
    camKick: [0.038, 0.007], modelKick: [0.3, 0.9, 3.2, -10, 1.5, 2.5], fovKick: 2.5,
    reloadDuration: 1.9, reloadType: 'cylinder', falloff: null,
    tracerThickness: 0.026, flashScale: 1.35, fireCue: 'revolver', casing: null, cycleDuration: 0,
    pvp: [52, 2.9, [9, 34, 0.42]], restPos: [0.19, -0.20, -0.30], sight: [0, 0.08, -0.34], eyeDistance: 0.42,
  },
};

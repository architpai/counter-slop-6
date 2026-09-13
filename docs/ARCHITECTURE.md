# ARCHITECTURE — browser FPS

This file is the integration contract for the rebuild. It is written so that fifteen people can
implement fifteen modules in parallel, from this file plus their own spec document, and have the
result link together on the first try.

Read this file completely before writing code. Then read only your own spec sections (listed in
your module's **Implementer checklist**).

**Rules that override personal preference:**

1. A module's public surface is exactly what this file declares. Do not add, rename, or re-order
   public exports. If a signature here is wrong for the spec, raise it — do not "fix" it locally.
2. Behaviour comes from the spec documents in `docs/spec/`. Every number, timing and formula there
   is normative. This file never contradicts them; where it looks like it does, the spec wins,
   except for **look** (section 3), which this file replaces wholesale.
3. Runtime cross-module calls go through the shared **context object** (`ctx`, section 5.1).
   Static `import` is only for pure things: classes you construct, factories, constants, math.
   This is what keeps the dependency graph acyclic.
4. No bundler, no build step, no transpile. Everything is a real ES module served as a static file.
   Browsers do **not** resolve directory imports: always import the explicit file
   (`import { Renderer } from './render/index.js'`).
5. No `npm install`, no framework, no TypeScript. The `.d.ts`-style blocks below are documentation
   of JavaScript shapes, not files to write.


## Contents

1. [Runtime, delivery and file layout](#1-runtime-delivery-and-file-layout)
2. [Global conventions](#2-global-conventions)
3. [Visual system](#3-visual-system) — palette, materials, lighting, post, type
4. [Dependency graph](#4-dependency-graph)
5. [Shared data structures](#5-shared-data-structures)
6. [Modules](#6-modules) — util · input · physics · nav · level · render · effects · audio · hud · player · weapons · enemies · players · net · main
7. [Frame update order in `main`](#7-frame-update-order-in-main)
8. [Boot sequence](#8-boot-sequence-game-loopmd-2)
9. [Cross-cutting integration rules](#9-cross-cutting-integration-rules)
10. [Decisions this document makes](#10-decisions-this-document-makes-and-why)
11. [First-week order of work](#11-first-week-order-of-work)

---

## 1. Runtime, delivery and file layout

### 1.1 Delivery

Static files only. Any static server works (`python3 -m http.server`, a CDN bucket, GitHub Pages).
There is no server component; multiplayer is peer-to-peer (see `net`).

### 1.2 `index.html` (owned by the `main` implementer)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Counter Slop 6</title>

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;600;700&display=swap">
<link rel="stylesheet" href="./styles.css">

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
<script src="https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"></script>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="hud"></div>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

Notes:

- The PeerJS script is a classic script tag, loaded **before** the module script, so `window.Peer`
  exists by the time `net` first needs it. `net` must still tolerate its absence
  (error text `"networking library did not load"`, see `networking.md` §2.1).
- Only two `three/addons/` files may be used: `utils/BufferGeometryUtils.js` (geometry merging in
  `level` and `render`). Nothing else from addons. No post-processing addons — the composite pass
  is hand-written (section 3.6).
- `#game` and `#hud` are the only two elements in the body. `main` passes them to `Renderer` and
  `Hud`.

### 1.3 File tree

```
index.html
styles.css                    # all HUD/menu CSS. Owner: hud implementer.
docs/ARCHITECTURE.md          # this file
docs/spec/*.md                # behaviour specs
src/
  main.js                     # entry. Owner: main.
  game/                       # private to main; nobody else imports these
    state.js
    ui.js
    solo.js
    ffa.js
    pickups.js
    breakables.js
  util.js
  input.js
  physics.js
  nav.js
  audio.js
  audio.tunes.js              # private to audio (note tables)
  net.js
  players.js
  effects.js
  level/
    index.js  build.js  downtown.js  mexico.js  props.js
  render/
    index.js  palette.js  materials.js  prims.js  figure.js  postfx.js
  hud/
    index.js  elements.js  screens.js  labels.js
  player/
    index.js  movement.js  grapple.js  grenades.js  camera.js
  weapons/
    index.js  stats.js  gun.js  katana.js  models.js
  enemies/
    index.js  types.js  model.js  ai.js  boss.js  flyer.js  projectiles.js
```

A module with a directory publishes **only** what its `index.js` re-exports. The sibling files are
private; no other module may import them. A module that is a single file publishes that file.

### 1.4 Ownership map (avoid merge conflicts)

| Artefact | Sole owner |
|---|---|
| `index.html` | main |
| `styles.css`, everything inside `#hud` | hud |
| The `THREE.Scene`, camera, canvas sizing, materials, lights, shadow config | render |
| Anything added to the scene as level geometry, and the physics boxes for it | level |
| Particle/decal/debris pools in the scene | effects |
| The camera transform and FOV each frame | player (render owns the object, player writes it) |
| `localStorage` reads/writes | main only (through `util.store`) |
| `window.__game` debug handle | main |

---

## 2. Global conventions

- **Units.** Metres, seconds, radians. Y is up. At yaw 0 the player looks down −Z; right is +X.
- **Vectors.** All world-space positions, directions and velocities are `THREE.Vector3`.
  Never plain `{x,y,z}` objects across a module boundary, with two exceptions: the network wire
  format (plain number arrays, section 5.9) and 2-D screen/input vectors (`{x, y}` numbers).
- **Vector hygiene.** Functions that return a vector either return a **new** `Vector3` or accept an
  optional `out` parameter and return it. Never return an internal scratch vector without saying so
  in the signature comment. Fields such as `player.eye` are **live internal vectors**: read them,
  copy them if you keep them, never mutate them.
- **Time.** `dt` is always seconds. `dt` is clamped to 0.05 s by `main` before anything sees it.
  "real dt" is that clamped wall-clock value; "scaled dt" (`sdt`) is `dt × timeScale`.
  Each module's `update()` documents which one it must be given.
- **Randomness.** `Math.random()` via `util.rand/randInt/choose`. No seeding, no determinism
  requirement (grenades are the only cross-peer simulation and they are deterministic from the
  launch state because they use no randomness).
- **Angles.** `wrapAngle` maps to `[-PI, PI)`. Yaw for characters is `atan2(dx, dz)`.
- **Naming.** `camelCase` members, `PascalCase` classes, `SCREAMING_SNAKE` module constants.
  Booleans read as predicates (`alive`, `onGround`, `reloading`). Timers that count **down** end in
  `T` or `Cd` (`respawnT`, `dashCd`); accumulators that count **up** end in `Time`.
- **No exceptions for flow control.** Public methods return `null` for "nothing found" and are
  safe to call with junk input from the network.
- **Network input is hostile.** Every message handler validates types and ranges before use
  (`networking.md` §4: a non-object payload is ignored).
- **No `console.log` in committed code** except behind `if (DEBUG)`.

---

## 3. Visual system

The look is flat-shaded low-poly: no outline pass, no hatching, no texture grain, no screen-space
wobble, no hand-written fonts, no random element rotations. Every **size, position, timing, count
and formula** in the specs is kept exactly.

Target: **clean low-poly, flat-shaded, bold limited palette, soft shadows, no outlines.**

### 3.1 Palette

Two palettes. Both live in `src/render/palette.js` and are the only place colours are written down.

**Tone palette** — indices 0–5, used for characters, effects, particles, decals, projectiles,
pickups, tracers, prop debris.

| Id | Name | Hex | Replaces | Meaning |
|---|---|---|---|---|
| 0 | `PRIMARY` | `#4C7DFF` | blue | The player: tracers, own sparks, bullet holes, own gear, ammo pickups, spawn bursts |
| 1 | `HOSTILE` | `#FF4757` | red | Enemies and remote players: blood, enemy projectiles, laser telegraph, enemy swing arcs |
| 2 | `DARK` | `#2A3140` | black | Heavy/boss tone, soot, smoke, explosions, dark gun parts |
| 3 | `ACCENT` | `#FFB020` | orange | Muzzle flash, sparks, casings, grenade fire, parry sparks |
| 4 | `HEAL` | `#37D67A` | green | Health pickups, cactus |
| 5 | `BOSS` | `#C56BFF` | pink | Boss tone attacks, piñata burst |

**Surface palette** — named keys, used by `level` geometry only. Where a level spec table says an
name, map it: BLUE → `block`, BLACK → `dark`, ORANGE → `accent`, GREEN → `foliage`,
PINK → `boss`, RED → `hot`.

| Key | Hex | Use |
|---|---|---|
| `sky` | `#9FD2E8` | scene background |
| `fog` | `#C7E3EF` | linear fog colour |
| `ground` | `#CFC7B4` | ground plane, paving |
| `road` | `#9E9A90` | highway deck, asphalt |
| `block` | `#EFE9DC` | default building mass (the "BLUE" default of the level spec) |
| `blockAlt` | `#7C8AA0` | secondary mass, concrete |
| `blockDeep` | `#48566B` | shaded mass, undersides, tower |
| `roof` | `#E0714A` | roofs, terracotta, tile |
| `wood` | `#B4784A` | planks, stalls, crates |
| `metal` | `#A6AEB8` | rails, catwalks, fire escapes, cranes |
| `dark` | `#232B38` | trim, frames, doors, windows |
| `accent` | `#FFC24B` | highlights, rings, signage |
| `foliage` | `#4CA96B` | cactus, plants |
| `water` | `#4FB3D9` | fountain, well |
| `hot` | `#E5484D` | rare warning surfaces |
| `boss` | `#C56BFF` | surfaces marked PINK in the level spec |

Rules: at most **12 distinct materials visible in one frame** of level geometry. Do not tint
per-object; pick a palette key. No external image textures, normal maps or emissive maps. The only
generated textures are the three-step toon gradient and opaque name-tag labels made by render.

### 3.2 Materials

Three material families, all created and cached by `render/materials.js`. Nothing else may call a
`THREE.*Material` constructor.

| Family | Type | Used by |
|---|---|---|
| `surface` | `MeshLambertMaterial({ color, flatShading: true })` | level geometry, breakable props, pickups, grenades, debris, grapple hook |
| `character` | `MeshToonMaterial({ color, gradientMap: 3-step })` | enemies, remote players, first-person view models |
| `unlit` | `MeshBasicMaterial({ color })` | particles, decals, tracers, muzzle flash, enemy laser, projectiles, name tags, focus/UI world marks |

- The toon gradient map is a 3-pixel `DataTexture` (`NearestFilter`, no mips) built in
  `materials.js`. Three tonal steps, no rim light, no specular.
- `flatShading: true` on every surface material; geometry is authored low-poly (cylinders 6–8
  sides, spheres 8 segments, cones 3–6 sides).
- **Hit flash** (`rendering-effects.md` §5.4) is a material swap, not a shader uniform:
  `setFlash(root, on, tone)` swaps every mesh under `root` to a cached unlit material of that tone
  and back. Timings unchanged (enemy 0.07 s, remote player 0.08 s, lit bomber every frame).
- Instanced pools (`effects`) use `InstancedMesh` + `setColorAt` for per-instance colour. Particles are always unlit; "outline" particles
  (smoke rings) simply use a pale grey (`#DDE4EC`) and keep their `grow` behaviour.
- Everything is opaque. No `transparent: true` anywhere in the 3-D scene (the HUD does its own
  compositing in DOM).

### 3.3 Lighting and shadows

Replaces `rendering-effects.md` §4 in full.

- One `DirectionalLight`, colour `#FFF6E5`, intensity 2.2, direction `normalize(0.38, 0.82, 0.42)`
  (kept from the spec), positioned at `shadowCenter + dir × (radius × 2)`.
- One `HemisphereLight`, sky `#BBD9EC`, ground `#8A8474`, intensity 0.85.
- No point lights, no ambient light, no light probes.
- **Soft shadows**: `renderer.shadowMap.enabled = true`,
  `renderer.shadowMap.type = THREE.PCFSoftShadowMap`, map size 2048, `bias = -0.0004`,
  `normalBias = 0.03`. The orthographic shadow camera is fitted per level by
  `renderer.setLevelShadow(center, radius)` — `level` reports these in `level.shadow`.
- `castShadow = true` on level geometry, characters, props, debris and the grapple hook.
  `receiveShadow = true` on level geometry only. Particles, decals, tracers, view models and the
  weapon rig cast and receive nothing.
- **Atmospheric perspective** (the spec's distance fade, §4) is `THREE.Fog(SURF.fog, 70, 300)`.
  The far plane stays 420.

### 3.4 Camera and canvas

Unchanged from `rendering-effects.md` §2 and §3.1: perspective, near 0.08, far 420, rotation order
`YXZ`, pixel ratio `min(devicePixelRatio, 1.5)` fixed at start-up, canvas fills the window and
resizes with it. `antialias: true`. `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`.

### 3.5 Typography and HUD look

- Display face: **Space Grotesk** 700 (titles, big numbers, weapon names, centre messages) and 500
  (labels). Body face: **Inter** 400/600 (hints, controls table, lists). Fallback stack:
  `'Space Grotesk', 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`.
- HUD colour tokens (CSS custom properties on `#hud`, defined once in `styles.css`):

```css
:root{
  --fg:#F2F5FA; --fg-dim:#9AA6B8; --hot:#FF4757; --cool:#4C7DFF;
  --good:#37D67A; --warn:#FFB020;
  --panel:#131A26; --panel-2:#1B2433; --line:#2C3648;
  --shadow:0 10px 40px rgba(0,0,0,.45);
  --r:10px;                      /* uniform corner radius */
}
```

- No decorative tilt on HUD panels or text. Directional
  damage indicators and hit-marker bars keep their functional rotations. No multiply blend modes. Panels are `--panel` at 92 % alpha
  with a 1 px `--line` border, radius `--r`, and `--shadow`.
- Bars (health, boss, focus gauge) are solid fills, not hatch patterns. Low-health/ready states
  switch the fill to `--hot`. Every **size, position, duration and easing** in `hud-audio-ui.md`
  §3 is kept exactly, including the 0.15 s bar eases, the 0.2 s hit-marker animation, the 1.7 s
  kill-feed line life and the responsive rule at ≤ 900 px.
- The sniper scope mask uses `--panel` (opaque) instead of backdrop colour; geometry (30 vh radius,
  60.5 vh ring, dashed cross, 5 px centre dot) unchanged.

### 3.6 Post-processing

The two-pass tone pipeline (`rendering-effects.md` §6.1–6.2) is replaced by:

1. Render the scene into a `WebGLRenderTarget` at render resolution
   (`RGBAFormat`, `UnsignedByteType`, `LinearSRGBColorSpace`, depth buffer, no stencil, no mips,
   `LinearFilter`).
2. Draw one full-screen triangle with a `ShaderMaterial` (orthographic camera, depth test off) that
   samples the target and applies the four feedback overlays **exactly** as
   `rendering-effects.md` §6.3 specifies, in that order:
   hurt vignette (with the low-health pulse term), parry flash toward the background colour,
   slow-motion desaturation `mix(col, lum * vec3(0.8,0.86,1.0), slow*0.55)`.
   The "sketch modulation" `scr` becomes a constant `1.0` (no texture).
   The fragment shader ends with `#include <colorspace_fragment>` so the linear target is converted
   to sRGB for the canvas.
3. Nothing else. No outline detection, no hatching, no jitter, no grain.

`§6.3 is normative and must not be reinterpreted` — it is gameplay feedback, not style.

---

## 4. Dependency graph

Runtime calls go through `ctx`. The arrows below are **static `import` edges only**.

Layers, lowest first. A module may only import from a **lower** layer (plus `three`).

```
L0  input          net                                  (no imports at all)
L1  util           audio  hud                           (util only)
L2  physics        render                               (util)
L3  nav            effects        players               (physics / render / util)
L4  level          weapons        enemies               (render + physics + util)
L5  player                                              (render + physics + util + weapons)
L6  main  +  src/game/*                                 (everything)
```

The only intra-layer-ish edge is `player -> weapons` (L5 -> L4), which is why they are on separate
layers. There is no path back: `weapons` never imports `player`, `enemies` never imports `players`,
`render` never imports anything above L1. The graph is acyclic; `main` is the only sink.


| Module | May import |
|---|---|
| `util` | `three` |
| `input` | *(nothing)* |
| `physics` | `three`, `util` |
| `nav` | `three`, `util`, `physics` (types/constants only) |
| `level` | `three`, `three/addons/utils/BufferGeometryUtils.js`, `util`, `render`, `physics` |
| `render` | `three`, `three/addons/utils/BufferGeometryUtils.js`, `util` |
| `effects` | `three`, `util`, `render` |
| `audio` | `util`, `audio.tunes.js` |
| `hud` | `util` |
| `player` | `three`, `util`, `render`, `weapons`, `physics` |
| `weapons` | `three`, `util`, `render`, `physics` |
| `enemies` | `three`, `util`, `render`, `physics` |
| `players` | `three`, `util`, `render` |
| `net` | *(nothing; reads the global `Peer`)* |
| `main` | everything, plus `src/game/*` |

`player → weapons` is the only gameplay-to-gameplay import (the player constructs its loadout).
`weapons` must never import `player`; it receives everything it needs through `ctx` and the
per-frame `WeaponState` record.

There are no other edges. If you find yourself needing one, you need a `ctx` hook instead.

---

## 5. Shared data structures

These shapes cross module boundaries. They are declared once, here.

### 5.1 The context object (`Ctx`)

Built by `main` during boot and passed to every subsystem constructor. `level` and `nav` are
**replaced** on every level rebuild — always read `ctx.level`, never cache it across a frame.

```ts
interface Ctx {
  // rendering / world
  scene:     THREE.Scene;
  camera:    THREE.PerspectiveCamera;
  renderer:  Renderer;
  world:     World;
  nav:       NavGrid;          // replaced on level rebuild
  level:     Level;            // replaced on level rebuild

  // services
  input:     Input;
  hud:       Hud;
  effects:   Effects;
  audio:     Audio;
  net:       Net;

  // actors (assigned after their own construction; may be null during boot)
  enemies:   EnemyManager | null;
  player:    Player | null;
  remotes:   Map<string, RemotePlayer>;

  // hooks provided by main (section 5.2)
  game:      GameHooks;
}
```

Construction order in boot: `renderer` → `world` → `audio` → `net` → `level` → `nav` → `input`
→ `hud` → `effects` → settings → game state, lobby, scores and remotes → `game` hooks → `ctx`
literal → `enemies` → `player`. `Audio` construction does not create an audio context;
`Net` construction does not open a connection. Every service in `ctx` exists before an actor is built.
Any subsystem that needs `ctx.player` inside its constructor is wrong; read it at update time.

### 5.2 `GameHooks` — what `main` provides to everyone else

Every hook is always present (never `undefined`); the offline versions are cheap no-ops or return
empty results, so callers never need existence checks.

```ts
interface GameHooks {
  // time and score
  hitstop(duration: number, scale: number): void;
  addScore(points: number, label?: string | null): void;
  onPlayerDeath(): void;

  // player-vs-player (see game-loop.md §24-26, networking.md §9)
  targets(): Target[];                               // local player first, then remotes
  canHurt(t: Target): boolean;                       // online && t is not the local player
  raycastPlayers(o: THREE.Vector3, d: THREE.Vector3, max: number): PlayerHit | null;
  playersInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): RemotePlayer[];
  hitPlayer(t: RemotePlayer, damage: number, info: HitInfo): void;
  cutRopes(eye: THREE.Vector3, dir: THREE.Vector3, range: number): boolean;
  onShot(end: THREE.Vector3): void;

  // breakable props (game-loop.md §29, levels.md §9.7)
  breakHit(prop: Breakable, damage: number, point: THREE.Vector3, dir: THREE.Vector3): void;
  breakablesInArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number): Breakable[];
  blastBreakables(center: THREE.Vector3, radius: number): void;

  // read-only state queries
  readonly state: GameStateName;                     // 'start'|'lobby'|'play'|'pause'|'dying'|'dead'|'over'
  readonly mode: 'solo' | 'ffa';
  isOnline(): boolean;                               // mode === 'ffa'
  inMatch(): boolean;                                // net.active && state is play|dying|over
  playing(): boolean;                                // state is play|dying
}
```

`PlayerHit` is `{ player: RemotePlayer; part: string; dist: number; point: THREE.Vector3 }`.

### 5.3 `Target` — anything an enemy or a blast can hurt

Implemented by `Player` (local) and `RemotePlayer`. `enemies.md` §18.4 is the behaviour contract.

```ts
interface Target {
  alive: boolean;
  isLocal: boolean;
  name: string;
  body: { pos: THREE.Vector3; vel: THREE.Vector3; halfW: number; height: number; onGround: boolean };
  center: THREE.Vector3;              // feet + height*0.55
  eye:    THREE.Vector3;
  forward: THREE.Vector3;
  right:   THREE.Vector3;
  readonly speed: number;             // |velocity|; remote players report 0
  readonly blockRadius: number;       // local: 0.95 while guarding and off cooldown, else 0; remote: 0
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;
  knockback(dir: THREE.Vector3, amount: number): void;
  tryDeflect(p: Projectile): false | { perfect: boolean; returned: boolean };   // remote: always false
  tryBlockMelee(e: Enemy): boolean;
}
```

### 5.4 Hit information

One record for every damage event, from any source, to any victim.

```ts
interface HitInfo {
  point?:  THREE.Vector3;    // world hit point
  dir?:    THREE.Vector3;    // unit direction the damage travelled
  part?:   string;           // 'head'|'torso'|'hips'|'armL'|'armR'|'foreL'|'foreR'|
                             // 'legL'|'legR'|'shinL'|'shinR'|'shield'|'blade'
  source?: string;           // 'rifle'|'shotgun'|'sniper'|'revolver'|'katana'|'focus'|
                             // 'deflect'|'blast'|'fall'|'grenade'
  crit?:   boolean;          // true only when part === 'head'
  dist?:   number;           // ray entry distance (guns, for falloff)
  slashDir?: number;         // katana swing side, +1 / -1
}

interface LastHit {          // player.lastHit, used for kill credit (game-loop.md §20)
  from: THREE.Vector3 | null;
  crit: boolean;
  amount: number;
  src: string;
}
```

### 5.5 Physics records

```ts
interface BoxData {
  noNav?: boolean;        // top face is not a nav surface
  noShoot?: boolean;      // see-through: rays, vision, particles pass
  noGrapple?: boolean;    // grapple ray passes
  tag?: any;              // free label, read by nobody
  breakable?: Breakable;  // back-reference set by level for prop colliders
}
interface Box { min: THREE.Vector3; max: THREE.Vector3; data: BoxData; id: number }
interface RayHit { dist: number; point: THREE.Vector3; normal: THREE.Vector3; box: Box }
```

`Body` is a class declared by `physics` (section 6.3). Its fields are the authoritative list in
`physics-nav.md` §3.1.

### 5.6 Level records

```ts
interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

interface Level {
  key: 'downtown' | 'mexico';
  arena: boolean;
  playerStart: THREE.Vector3;
  bounds: Bounds;
  spawns: THREE.Vector3[];        // ground enemy spawn points
  snipers: THREE.Vector3[];       // sniper perches
  pickups: THREE.Vector3[];       // pickup spots
  rings: THREE.Vector3[];         // fixed grapple anchors
  arenaSpawns: THREE.Vector3[];   // FFA spawns; empty => fall back to `spawns`
  teamSpawns: THREE.Vector3[][];  // built, read by nobody
  movers: GrappleMover[];         // moving grapple targets (drones)
  animated: Animated[];           // per-frame decoration
  breakables: Breakable[];        // Mexico only; id === index
  meshes: THREE.Object3D[];       // everything to remove on rebuild
  shadow: { center: THREE.Vector3; radius: number };   // directional-light shadow fit
}

interface GrappleMover { mesh: THREE.Object3D; radius: number }
interface Animated { mesh: THREE.Object3D; update(time: number): void }

interface Breakable {
  id: number;                     // index in level.breakables
  kind: 'potS'|'potL'|'crate'|'barrel'|'cactus'|'pinata';
  group: THREE.Group;             // its meshes; children become debris on break
  hp: number;
  pos: THREE.Vector3;             // centre = base + height/2
  alive: boolean;
  tone: number;                   // TONE id for its burst/debris tint
  box: Box;                       // its collider, removed on break
}
```

### 5.7 Pickup record (owned by `main`, `src/game/pickups.js`)

```ts
interface Pickup {
  id: number;                 // host-assigned online; local counter offline (both start at 1)
  kind: 'ammo' | 'health';
  mesh: THREE.Object3D;
  baseY: number;              // spot.y + 0.6
  phase: number;              // bob phase, uniform [0,6) at spawn
  life: number;               // 45 s; only the host / an offline game ages it
}
```

### 5.8 Enemy and projectile records

Full field list in `enemies.md` §3.1 and §11. The cross-module surface is:

```ts
interface Enemy {
  id: number;
  type: string;               // 'grunt'|'rusher'|'heavy'|'sniper'|'shield'|'bomber'|'flyer'|
                              // 'boss'|'hitbox'|'lagspike'
  stats: EnemyType;           // catalogue row: name, hp, speed, score, scale, boss, flying, tone…
  hp: number; maxHp: number;
  alive: boolean;
  state: 'spawn' | 'hunt' | 'stunned' | 'dead';
  body: Body;
  center: THREE.Vector3;      // torso world position (live vector)
  yaw: number;
  root: THREE.Group;
}

interface Projectile {
  id: number;
  pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3;
  damage: number; owner: Enemy | null; life: number;
  deflected: boolean; tone: number; thickness: number;
  origin: THREE.Vector3;      // spawn point; used as the "hit from" position
  blast: boolean;
}
```

### 5.9 Network wire formats

**Envelope** (`networking.md` §4). Every message is exactly this object:

```ts
interface Envelope {
  t: string;         // message type
  d: any;            // payload
  from?: string;     // set by the host on everything it sends (except `refused`),
                     // and on relayed copies (= original sender)
  to?: string;       // client -> host -> that client
  relay?: boolean;   // client asks the host to forward to all others
}
```

**Local state packet** `ps` — a flat number array, sent every 3rd network tick while in a match:

| Index | Field | Quantisation |
|---|---|---|
| 0,1,2 | body position x, y (feet), z | 2 dp |
| 3 | yaw | 2 dp |
| 4 | pitch | 2 dp |
| 5 | weapon index | int 0..3 (0 rifle, 1 shotgun, 2 sniper, 3 katana) |
| 6 | flag bits | int, table below |
| 7 | health | rounded int |
| 8,9,10 | velocity x, y, z | 1 dp |
| 11,12,13 | grapple hook x, y, z | 1 dp, **present only while grappling** |

Flag bits: `1` crouching, `2` sliding, `4` blocking, `8` aiming, `16` on ground, `32` firing,
`64` alive, `128` grappling, `256` parry window.

Decoding: velocity only if `length > 10`; hook only if bit 128 **and** `length > 13`; weapon index
outside 0..3 renders a rifle; a packet from an unknown id is dropped.

**Remote snapshot pair** used for interpolation:

```ts
interface Snap { p: THREE.Vector3; yaw: number; pitch: number; t: number }  // t = local arrival time (s)
```

**Score row**: `{ id: string, name: string, kills: number, deaths: number }`.
Table order is insertion order; display order is kills desc, then deaths asc.

**Lobby model** (held by `main`):

```ts
interface Lobby {
  players: Map<string, string>;   // peer id -> name, insertion ordered
  hostId: string | null;
  isPublic: boolean;              // default true
  status: string;
  code: string | null;
  map: string | null;             // null until the host sets one
}
```

### 5.10 `WeaponState` — player → weapon, once per frame

```ts
interface WeaponState {
  fire: boolean;          // fire held
  firePressed: boolean;   // fire went down this frame
  aim: boolean;           // gun: aim held with a gun; katana: aim held (= guard)
  reloadPressed: boolean;
  meleePressed: boolean;  // only when the katana is equipped
  sprinting: boolean;
  grounded: boolean;
  speed: number;          // horizontal speed
  sliding: boolean;
  lookDelta: { x: number; y: number };   // radians this frame, invert already applied
  strafe: number;         // -1..1
  bobPhase: number;
  bobAmt: number;
  landDip: number;        // clamp(-landDipSpring.value * 0.08, -0.5, 0.5)
  slideTilt: number;      // 1 while sliding else 0
  blockFire: boolean;     // true when the player is dead
}
```

The **neutral state** (dead, dash-locked, focus-driven slash) is the same object with
`fire/firePressed/aim/reloadPressed/meleePressed/sprinting = false`, `speed = 0`,
`blockFire = !player.alive`.

### 5.11 Global game state (owned by `main`, `src/game/state.js`)

```ts
type GameStateName = 'start'|'lobby'|'play'|'pause'|'dying'|'dead'|'over';

interface GameState {
  state: GameStateName;   // 'start'
  mode: 'solo'|'ffa';     // 'solo'
  menu: boolean;          // an overlay is open while state === 'play'
  time: number;           // game clock: += sdt while playing, += dt otherwise
  hitstopT: number; hitstopScale: number;
  wave: number; score: number; combo: number; comboT: number; kills: number;
  intermission: number; queue: string[]; spawnT: number; maxAlive: number;
  deathT: number;
  focus: FocusState;      // game-loop.md §15
  katanaStreak: number;
  boss: Enemy | null;
  respawnT: number; matchT: number;
  over: { id: string; name: string } | null; overT: number;
}
```

Constants: FFA kill target 20, FFA time limit 480 s, FFA respawn delay 3.5 s, max grenades 5,
katana slot index 3.

### 5.12 Persistent storage keys

All values are strings in `localStorage`, read and written **only** by `main` through `util.store`.

| Key | Default | Meaning |
|---|---|---|
| `cs6_map` | `downtown` | picked map key |
| `cs6_best` | `0` | best solo score |
| `cs6_music` | on (anything but `0`) | music wanted |
| `cs6_checkpoint` | `0` | highest checkpoint wave |
| `cs6_name` | `recruit` + random 10–99 | player name, ≤ 14 chars |
| `cs6_sens` | `100` | look sensitivity percent (25–250, step 5) |
| `cs6_invert` | off (`1` = inverted) | invert vertical look |

---

## 6. Modules

Spec abbreviations used in the checklists:

| Tag | File |
|---|---|
| **GL** | `docs/spec/game-loop.md` |
| **PN** | `docs/spec/physics-nav.md` |
| **PI** | `docs/spec/player-input.md` |
| **W** | `docs/spec/weapons.md` |
| **E** | `docs/spec/enemies.md` |
| **RE** | `docs/spec/rendering-effects.md` |
| **HA** | `docs/spec/hud-audio-ui.md` |
| **N** | `docs/spec/networking.md` |
| **L** | `docs/spec/levels.md` |

---

### 6.1 `util`

**File:** `src/util.js`
**Imports:** `three`
**Responsibility:** pure math, springs, timers, RNG, angle/vector helpers, storage wrapper.
Zero state except the storage wrapper. No DOM, no scene, no `ctx`.

```ts
export const TAU: number;                                   // 6.283185307179586

export function clamp(v: number, a: number, b: number): number;
export function lerp(a: number, b: number, t: number): number;
export function damp(a: number, b: number, lambda: number, dt: number): number;   // exponential approach
export function smoothstep(a: number, b: number, x: number): number;
export function approach(cur: number, target: number, maxDelta: number): number;
export function easeOut(t: number): number;                 // 1 - (1-t)^3
export function easeInOut(t: number): number;               // cubic in-out

export function rand(a?: number, b?: number): number;       // uniform [a,b), defaults 0,1
export function randInt(a: number, b: number): number;      // inclusive both ends
export function choose<T>(arr: T[]): T;
export function randDir(out?: THREE.Vector3): THREE.Vector3;
export function shuffle<T>(arr: T[]): T[];                  // in-place Fisher-Yates, returns arr

export function wrapAngle(a: number): number;               // -> [-PI, PI)
export function angleLerp(a: number, b: number, t: number): number;   // shortest arc, not re-wrapped

export function v3(x?: number, y?: number, z?: number): THREE.Vector3;
export function round(n: number, dp: number): number;       // wire quantisation
export function round1(n: number): number;
export function round2(n: number): number;

export class Spring {                                       // PN 6.5
  constructor(k?: number, d?: number);                      // defaults 120, 14
  value: number; vel: number; target: number; k: number; d: number;
  update(dt: number): number;                               // 3 sub-steps when dt > 0.02
  kick(v: number): void;                                    // vel += v
  set(v: number): void;                                     // value = v, vel = 0
}

export class Spring3 {                                      // PN 6.6
  constructor(k?: number, d?: number);
  value: THREE.Vector3; vel: THREE.Vector3; target: THREE.Vector3;
  update(dt: number): THREE.Vector3;
  kick(x: number, y: number, z: number): void;
}

export class Cooldown {                                     // PN 6.7
  constructor(duration?: number);
  t: number; duration: number;
  update(dt: number): void;
  ready(): boolean;
  start(d?: number): void;
  frac(): number;
}

export function quatFromY(dir: THREE.Vector3, out?: THREE.Quaternion): THREE.Quaternion;
export function alignSegment(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3,
                             thickness?: number): void;      // PN 6.8; hides obj when |to-from| < 1e-5

export const store: {
  getStr(key: string, def: string): string;
  getNum(key: string, def: number): number;
  getBool(key: string, def: boolean): boolean;               // "1" true, "0" false
  set(key: string, value: string | number | boolean): void;
};
export const SKEY: { MAP: string; BEST: string; MUSIC: string; CHECKPOINT: string;
                     NAME: string; SENS: string; INVERT: string };
```

**Events:** none.

**Implementer checklist**

1. PN §6.1 scalar helpers (`clamp`, `lerp`, `damp`, `smoothstep`, `approach`) — exact formulas.
2. PN §6.2 random helpers, including the cube-biased `randDir`.
3. PN §6.3 angle helpers (`wrapAngle`, `angleLerp`).
4. PN §6.4 `v3`.
5. PN §6.5 scalar damped spring, including the 3-sub-step rule at `dt > 0.02`.
6. PN §6.6 3-D damped spring (per-component force, same k/d).
7. PN §6.7 cooldown timer.
8. PN §6.8 orientation helpers (`quatFromY`, `alignSegment` with the midpoint / +Y / thickness rule).
9. W §2 shared math helpers (`easeOut`, `easeInOut`).
10. GL §18.2 uniform Fisher–Yates `shuffle` (used to deal FFA spawn indices).
11. N §5 "Field formats" — the rounding helpers used by the wire format.
12. HA §9 / this file §5.12 — `store` and the key names/defaults.

---

### 6.2 `input`

**File:** `src/input.js`
**Imports:** *(nothing)*
**Responsibility:** merge keyboard, mouse and one standard-mapping gamepad into named boolean
actions plus a move vector and a per-frame look delta. Owns pointer lock and rumble. Knows nothing
about the game.

```ts
export type Action =
  'forward'|'back'|'left'|'right'|'jump'|'sprint'|'crouch'|'reload'|'grapple'|'melee'|
  'slot1'|'slot2'|'slot3'|'slot4'|'slot5'|'pause'|'confirm'|'grenade'|'dash'|'music'|
  'talk'|'score'|'fire'|'aim'|'nextWeapon'|'prevWeapon';

export class Input {
  constructor(canvas: HTMLCanvasElement);

  readonly move: { x: number; y: number };     // normalised only when |move| > 1
  readonly look: { x: number; y: number };     // radians THIS frame; +x turns left, +y looks up
  mouseSens: number;                           // default 0.0022 rad/px
  padSensX: number;                            // default 3.4 rad/s
  padSensY: number;                            // default 2.6 rad/s
  invertY: boolean;                            // default false

  readonly usingGamepad: boolean;
  readonly locked: boolean;                    // pointer lock element === canvas
  anyInput: boolean;                           // set by any key/mouse/pad activity; main clears it

  onLockChange: ((locked: boolean) => void) | null;
  onDeviceChange: ((device: 'keyboard' | 'gamepad') => void) | null;

  update(dt: number): void;                    // call FIRST every frame, with real dt
  down(a: Action): boolean;                    // the spec's "held"
  pressed(a: Action): boolean;
  released(a: Action): boolean;
  consume(a: Action): void;                    // force false for the rest of this frame
  anyPressed(): boolean;

  requestLock(): void;                         // raw movement, plain fallback, 1200 ms retry
  exitLock(): void;
  rumble(strong?: number, weak?: number, ms?: number): void;   // defaults 0.5, 0.5, 80
  dispose(): void;                             // remove every listener
}
```

**Events emitted:** `onLockChange(locked)`, `onDeviceChange('keyboard'|'gamepad')`.
**Events consumed:** DOM `keydown/keyup/mousedown/mouseup/mousemove/wheel/contextmenu`,
`pointerlockchange`, `visibilitychange`, window `blur`, Gamepad API polling.

**Implementer checklist**

1. PI §2.1 the action list, exactly these names.
2. PI §2.2 keyboard bindings by `event.code`; auto-repeat ignored; the Shift-modifier guard; the
   `preventDefault` set (Space, Tab, ArrowUp, ArrowDown).
3. PI §2.3 mouse bindings, wheel accumulator → one-frame `nextWeapon`/`prevWeapon`, the 400 px
   spike guard, context menu suppression, movement only while locked.
4. PI §2.4 gamepad button map, 0.35 analogue threshold, 0.14 dead zone, `|v|^1.8` response curve,
   full-deflection turn acceleration (×1 → ×1.9 over 0.25–0.85 s), pad selection.
5. PI §2.5 `down`/`pressed`/`released`/`consume`/`anyPressed`, including the gamepad-only edge
   clause and the documented side effect of `consume`.
6. PI §2.6 move and look vector assembly, normalisation rule, invert applied last.
7. PI §2.7 sensitivity fields (main writes them from storage).
8. PI §2.8 device switching and when `onDeviceChange` fires (not on mouse move).
9. PI §2.9 pointer lock: raw-movement attempt, plain fallback, 1200 ms retry, lock-wanted flag.
10. PI §2.10 clear all raw flags on page hide / window blur.
11. PI §2.11 rumble (dual-rumble, clamped, errors swallowed).
12. PI §2.12 no touch support.

---

### 6.3 `physics`

**File:** `src/physics.js`
**Imports:** `three`, `util`
**Responsibility:** the static AABB world, character bodies, push-out movement, raycasts, ground
probe, line of sight. No gravity, no gameplay, no scene access.

```ts
export const EPS: number;                       // 1e-4
export const seeThrough: (box: Box) => boolean; // skip boxes with data.noShoot

export class Body {                             // PN 3.1
  constructor(pos: THREE.Vector3, halfW: number, height: number, stepHeight?: number); // step 0.55
  pos: THREE.Vector3;                           // centre of the feet
  vel: THREE.Vector3;
  halfW: number; height: number; stepHeight: number;
  onGround: boolean; hitWall: boolean; hitCeil: boolean;
  wallNormal: THREE.Vector3; landVel: number;
  noSnap: boolean; alwaysStep: boolean;
  blockedX: number; blockedZ: number;           // internal, -1/0/+1
  min(out?: THREE.Vector3): THREE.Vector3;      // shrunken collision box, PN 3.2
  max(out?: THREE.Vector3): THREE.Vector3;
}

export class World {
  constructor();
  readonly boxes: Box[];

  addBox(min: THREE.Vector3, max: THREE.Vector3, data?: BoxData): Box;   // copies min/max
  finalize(): void;                             // (re)build the spatial hash
  removeBox(box: Box): void;                    // removes and re-finalizes
  clear(): void;

  query(min: THREE.Vector3, max: THREE.Vector3, out?: Box[]): Box[];     // strict overlap
  overlapsAABB(min: THREE.Vector3, max: THREE.Vector3): boolean;
  overlapsBody(body: Body): boolean;

  moveBody(body: Body, dt: number): void;       // sub-stepped integration; writes the body flags

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist?: number,
          ignore?: (box: Box) => boolean): RayHit | null;                // maxDist default 1000
  groundBelow(x: number, y: number, z: number, maxDrop?: number): number;// default 100
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, ignore?: (box: Box) => boolean): boolean;
}
```

**Events:** none. `World` never calls back into gameplay.

**Implementer checklist**

1. PN §2.1 every constant (epsilon 1e-4, hash cell 8, push-out 4 iterations, slack 0.03,
   step margins, sub-step cap 10 / min length 0.2 / 0.8 × half-width, ray defaults).
2. PN §2.2 collider record; min/max are **copied** on add.
3. PN §2.3 the data flags and who reads them.
4. PN §2.4 add / finalize / remove / clear, including "queries do not see a box until finalize but
   raycasts do".
5. PN §2.5 spatial hash keying and the per-query stamp de-duplication.
6. PN §2.6 strict overlap test (touching faces do not overlap); overlap queries ignore predicates.
7. PN §3.1–3.2 body record and the ε-shrunken collision box.
8. PN §3.4 axis push-out: candidate corrections, the `|move| + 0.03` limit, largest-magnitude wins,
   returned push sign.
9. PN §3.5 horizontal move with step-up: flat attempt, raised attempt, acceptance test, wall normal
   from push signs.
10. PN §3.6 one integration step: flag reset, `wasOnGround` for step permission, velocity zeroing,
    ground snap conditions.
11. PN §3.7 sub-stepping and how the flags are combined across sub-steps.
12. PN §4.1 raycast slab method: `tmax` seeded with the best distance, the "origin inside a box
    never hits it" rule, normal sign convention, returned record.
13. PN §4.2 export `seeThrough`.
14. PN §4.3 `groundBelow` (returns `y - maxDrop` on a miss).
15. PN §4.4 `lineOfSight` including the 1e-4 degenerate case.
16. PN §7.7 keep the public shapes exactly as tabulated.

Not this module's job: gravity (PN §3.8), the sweep patterns of PN §4.5 (each caller does its own),
the focus dash march (main).

---

### 6.4 `nav`

**File:** `src/nav.js`
**Imports:** `three`, `util`, `physics` (types only)
**Responsibility:** build a multi-level walkability graph from the collision world and answer A*
path requests. Read-only with respect to the world.

```ts
export interface NavNode { id: number; x: number; y: number; z: number;
                           ix: number; iz: number; links: NavLink[] }
export interface NavLink { to: number; cost: number; dy: number }
export type NavPath = THREE.Vector3[] & { complete: boolean };

export class NavGrid {
  constructor(world: World, bounds: Bounds, cell?: number);   // cell default 1.0
  build(): void;                                              // call once after level.finalize()
  readonly nodes: NavNode[];
  nearest(pos: THREE.Vector3, radius?: number, maxDrop?: number): number;  // node id or -1
  findPath(from: THREE.Vector3, to: THREE.Vector3, maxExpand?: number): NavPath | null;
  randomNode(): NavNode | null;
}
```

**Events:** none.

**Implementer checklist**

1. PN §5.1 every constant, verbatim.
2. PN §5.2 grid layout, cell centres, node record.
3. PN §5.3 node generation: the thin probe column, distinct top faces of non-`noNav` boxes, the
   −5..70 window, the 0.6 × 1.35 × 0.6 clearance test against **all** boxes.
4. PN §5.4 link generation: neighbour order, ±1.35/−8 limits, the diagonal corner rule, the link
   clearance box, the drop column test. Links are directed.
5. PN §5.5 link cost with the climb multiplier and drop surcharge.
6. PN §5.6 nearest node: filtered score (weight 1.5) and fallback score (weight 2.0), radii and
   drop limits for start (3, 3) and goal (4, 8), rise limit 2.2.
7. PN §5.7 A*: binary heap, no decrease-key, per-search generation stamps, heuristic weight 1.15,
   expansion cap 40 000, "best so far" fallback, the `complete` flag.
8. PN §5.9 `randomNode`.
9. PN §5.10 rebuild rules — the grid is **not** rebuilt when a breakable's box is removed.
10. E §18.3 and L §4 restate the same numbers; they must agree.

---

### 6.5 `level`

**Files:** `src/level/index.js` (public), `build.js`, `downtown.js`, `mexico.js`, `props.js`
**Imports:** `three`, `three/addons/utils/BufferGeometryUtils.js`, `util`, `render`, `physics`
**Responsibility:** build map geometry and colliders, place all markers, create breakable props,
merge static geometry per material, return the `Level` record.

```ts
export const LEVELS: { key: string; name: string; blurb: string }[];  // only "ready" maps
export function validKey(key: unknown): string;                       // unknown -> 'downtown'

export function buildLevel(scene: THREE.Scene, world: World, key?: string,
                           opts?: { arena?: boolean }): Level;
export function disposeLevel(scene: THREE.Scene, level: Level): void; // remove + dispose geometry

// internal helpers exported for the Mexico/Downtown builders and for tests
export interface BuildOpts { mat?: string; noCollide?: boolean; noNav?: boolean;
                             noShoot?: boolean; noGrapple?: boolean; tag?: any }
```

`buildLevel` must:

- add every collider through one internal helper taking `(cx, bottomY, cz, w, h, d, opts)` so
  "y" always means the bottom of a piece;
- call `world.finalize()` exactly once at the end;
- merge static visual geometry into **one mesh per surface material** and push those meshes plus
  every stand-alone object (drones, breakable groups, mariachi figures) into `level.meshes`;
- set `castShadow` and `receiveShadow` on the merged meshes;
- compute `level.shadow` = a sphere covering the play field (`center` = field centre,
  `radius` = the bounds half-size × 1.15).

**Events:** none. `level.animated[i].update(time)` is called by `main` every frame.

**Implementer checklist**

1. L §1.1 level list, display names, blurbs, `validKey` fallback.
2. L §1.2 build modes (arena on/off) and the rebuild contract.
3. L §2 coordinate and box conventions.
4. L §3.1–3.12 every primitive: box, slab, wall-with-gaps, stairs, rail (1.0-high `noNav`+`noShoot`
   collider), cylinder (1.6 r square footprint), sphere (visual only), grapple ring, markers,
   drones (orbit maths + mover radius), breakable prop, finish/merge.
5. L §4 collider flags and the `breakable` back-reference.
6. L §5 the level record fields.
7. L §6.1–6.13 Counter Slop 6: ground and perimeter, arena-only additions, central tower,
   buildings A and B, highway, row houses, south plaza, sky props, planes, marker totals, and the
   railing seams table (enemy reach depends on it).
8. L §7.1–7.11 Mexico: mesas and sky lid, plaza, bandstand and mariachis, church, adobe
   houses, banners, market with piñatas/crates/pots/barrels, taco cart, rocks and well, markers,
   sky.
9. L §8 bounds per map and mode.
10. L §9.1–9.9 the interfaces, especially §9.7 breakable hit points per kind.
11. GL §2 the fields `main` reads off the record, and the level-rebuild teardown order.
12. This file §3.1 — map every spec name to a surface palette key; §3.3 — shadow flags.

---

### 6.6 `render`

**Files:** `src/render/index.js` (public), `palette.js`, `materials.js`, `prims.js`, `figure.js`,
`postfx.js`
**Imports:** `three`, `three/addons/utils/BufferGeometryUtils.js`, `util`
**Responsibility:** the renderer, scene, camera, lights, shadows, the full-screen composite pass,
the whole material/palette system, low-poly primitive factories, and the **shared humanoid /
blob / flyer figure builder** used by both `enemies` and `players`.

```ts
// ---- palette.js
export const TONE: { PRIMARY: 0; HOSTILE: 1; DARK: 2; ACCENT: 3; HEAL: 4; BOSS: 5 };
export const TONE_HEX: number[];                       // index -> 0xRRGGBB
export const WHITE_HEX: number;                       // 0xFFFFFF, instanced base colour
export const SMOKE_HEX: number;                       // 0xDDE4EC, pale smoke rings
export type SurfKey = 'sky'|'fog'|'ground'|'road'|'block'|'blockAlt'|'blockDeep'|'roof'|
                      'wood'|'metal'|'dark'|'accent'|'foliage'|'water'|'hot'|'boss';
export const SURF: Record<SurfKey, number>;

// ---- materials.js
export function surfMat(key: SurfKey): THREE.MeshLambertMaterial;     // cached, flatShading
export function charMat(color: number): THREE.MeshToonMaterial;       // cached per colour
export function toneMat(tone: number): THREE.MeshToonMaterial;        // cached, character family
export function unlitMat(color: number): THREE.MeshBasicMaterial;     // cached
export function setFlash(root: THREE.Object3D, on: boolean, tone?: number): void;  // RE 5.4
export function mergeByMaterial(parts: { geo: THREE.BufferGeometry; key: SurfKey }[]): THREE.Mesh[];

// ---- prims.js  (all return geometry; positions in local space, low-poly segment counts)
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry;
export function cylGeo(r: number, len: number, seg?: number, axis?: 'x'|'y'|'z'): THREE.BufferGeometry;
export function sphereGeo(r: number, seg?: number): THREE.BufferGeometry;
export function coneGeo(r: number, len: number, seg?: number): THREE.BufferGeometry;
export function torusGeo(r: number, tube: number, seg?: number, rings?: number): THREE.BufferGeometry;
export function starGeo(points: number, outer: number, inner: number): THREE.BufferGeometry;
export function ringGeo(r: number, thickness: number, seg?: number): THREE.BufferGeometry;

// ---- figure.js  (shared skeleton; E 4.2-4.5, N 11.1/11.3)
export type FigureKind = 'humanoid' | 'blob' | 'flyer';
export type HitPart = 'head'|'torso'|'hips'|'armL'|'armR'|'foreL'|'foreR'|
                      'legL'|'legR'|'shinL'|'shinR';
export interface FigureOpts {
  kind: FigureKind;
  blob?: 'bomber'|'hitbox'|'lagspike'; // blob accessory set; default bomber
  color: number;                 // tone hex
  scale?: number;                // type scale, default 1
  bodyWidth?: number; headSize?: number; limbR?: number;
  hat?: 'none'|'cap'|'band'|'helmet'|'hood'|'crown';
  smile?: boolean;
  shield?: boolean;
  weapon?: 'none'|'rifle'|'shotgun'|'sniper'|'blade'|'hammer';
}
export interface Figure {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;      // hips, torso, head, shoulderL/R, upperL/R, foreL/R,
                                              // thighL/R, shinL/R, gunMount, shield, tip …
  anchors: Record<HitPart, THREE.Object3D>;   // hit-sphere centres, world-updated by the owner
  setEyes(dead: boolean): void;               // normal eyes / X eyes
  setWeapon(kind: 'none'|'rifle'|'shotgun'|'sniper'|'blade'|'hammer'): void;
  dropShield(): THREE.Object3D | null;        // detach for debris, remove its anchor
  dispose(): void;
}
export function makeFigure(o: FigureOpts): Figure;
export function makeWeaponProp(index: 0|1|2|3): THREE.Group;   // remote-player hand props, N 11.3
export function makeNameTag(name: string): THREE.Group;      // N 11.2; opaque generated canvas label

// ---- index.js
export interface PostFX { hurt: number; flash: number; slow: number; lowHp: number }
export class Renderer {
  constructor(canvas: HTMLCanvasElement);
  readonly three: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: THREE.Group;                  // child of camera, scale 1; each weapon root has scale 0.46
  readonly sun: THREE.DirectionalLight;
  resize(): void;                             // self-registered on window resize
  setLevelShadow(center: THREE.Vector3, radius: number): void;
  render(time: number, fx: PostFX): void;     // called last, exactly once per frame
}
```

**Events:** listens to window `resize`. Emits nothing.

`makeNameTag` makes an opaque 0.5 × 0.28 × 0.02 plaque with a generated `CanvasTexture` label.
Draw the bounded name with the canvas text API (no HTML or external images). Render owns its
unique label material and texture; the returned group's `userData.dispose()` releases them and
its geometry, and is safe to call twice. The remote owner calls it when removing the tag on
ragdoll, respawn replacement or disposal. Keep the placement and billboard rule of N §11.2.

**Implementer checklist**

1. RE §2 renderer creation, pixel ratio, resize behaviour, the HUD layer sitting above the canvas.
2. RE §3.1 camera parameters and rotation order.
3. RE §3.6 the weapon rig: child of the camera, scale 1; each weapon root has uniform scale 0.46,
   applied exactly once. Only the equipped weapon is visible, drawn in front of the world, never shadowed.
4. RE §4 → **replaced by** this file §3.3 (sun + hemisphere + PCF soft shadows + fog).
5. RE §5 → **replaced by** this file §3.1–3.2 (three material families, per-instance colour,
   `setFlash` swap), but keep RE §5.4's flash *timings* and triggers.
6. RE §6.1–6.2 → **replaced by** this file §3.6 (single scene pass into a render target).
7. RE §6.3 **kept verbatim**: the four intensities and the exact overlay formulas and order.
8. E §4.2 humanoid template: every vertical offset, the limb lengths, the shoulder/leg offsets,
   the weapon mount at `(0, -0.29, 0.07)` on the right forearm, the muzzle tip z (0.78 gun /
   0.92 blade / 0.6 hammer), the shield plate placement, the 0.95–1.06 head jitter.
9. E §4.3 the hit-anchor set and radii table (the owner reads world positions from `anchors`).
10. E §4.4 bomber / blob template (body sphere, arms, legs, cap, fuse, spark; hitbox block;
    lagspike's 9 spikes).
11. E §4.5 flyer template (cone, wings, tail, face group).
12. N §11.1 remote skeleton dimensions (identical to the humanoid template) and §11.3 the four
    weapon props.
13. W §17.1 the primitive helpers the gun view models need (`box`, `cylinder`, `sphere`, `frame`,
    `hand`, anchors, the flash star cluster).
14. HA §1 the canvas/HUD layering requirement (canvas side only).
15. This file §3 in full — the visual target is this module's product.

---

### 6.7 `effects`

**File:** `src/effects.js`
**Imports:** `three`, `util`, `render`
**Responsibility:** all particles, decals, blood pools, rigid debris, tracers, explosions, and the
shared screen-shake accumulator. Pools are instanced meshes owned by this module.

```ts
export interface ParticleSpec {
  kind: 'drop'|'stroke'|'emitter';
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life?: number; size?: number; tone?: number;
  gravity?: number; drag?: number;
  collide?: 'none'|'decal';
  stretch?: number; fixedLen?: number; axis?: THREE.Vector3;
  decalSize?: number; shrink?: boolean; grow?: number;
  rate?: number; emitDir?: THREE.Vector3;
}

export class Effects {
  constructor(scene: THREE.Scene, world: World);
  shake: number;                       // read-modify-written by the player camera step

  update(dt: number): void;            // scaled dt while playing, real dt otherwise
  clear(): void;                       // particles, growing pools, debris, pool counters

  // recipes — every default matches RE section 8
  sparks(point: THREE.Vector3, normal: THREE.Vector3, tone?: number, n?: number, speed?: number): void;
  strokeBurst(pos: THREE.Vector3, tone: number, n?: number, speed?: number,
              o?: { life?: number; size?: number; gravity?: number; drag?: number; stretch?: number }): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, tone?: number, thick?: number, life?: number): void;
  bulletImpact(point: THREE.Vector3, normal: THREE.Vector3, tone?: number): void;
  blood(pos: THREE.Vector3, dir: THREE.Vector3, amount?: number, o?: { tone?: number }): void;
  drip(pos: THREE.Vector3, amount?: number): void;
  fountain(pos: THREE.Vector3, dir: THREE.Vector3, dur?: number, tone?: number): void;
  shell(pos: THREE.Vector3, vel: THREE.Vector3, tone?: number, size?: number): void;
  smoke(pos: THREE.Vector3, dir: THREE.Vector3, n?: number): void;
  explosion(pos: THREE.Vector3, radius?: number, tone?: number): void;
  boom(pos: THREE.Vector3, radius?: number): void;
  bloodPool(pos: THREE.Vector3, size?: number, tone?: number): void;
  decal(point: THREE.Vector3, normal: THREE.Vector3, tone: number, size: number,
        kind?: 'splat'|'hole', streakDir?: THREE.Vector3 | null, stretch?: number): void;
  splat(point: THREE.Vector3, normal: THREE.Vector3, tone: number, size: number,
        streakDir?: THREE.Vector3 | null, cluster?: number): void;
  debris(mesh: THREE.Object3D, pos: THREE.Vector3, vel: THREE.Vector3, angVel: THREE.Vector3,
         o?: { life?: number; radius?: number; blood?: boolean }): void;
  particle(p: ParticleSpec): void;     // raw spawn (boss stomp ring)
}
```

`debris()` re-parents a **caller-owned** mesh into the scene with `scene.attach` semantics and owns
it from then on; the caller must not remove it.

**Events:** none. Read/writes `effects.shake` (the player camera step decays it).

**Implementer checklist**

1. RE §7.1 pool shapes and capacities (drops 700, strokes 600, 5 × splat 300, holes 260) and the
   full/ring-buffer behaviour.
2. RE §7.2 particle model and every default.
3. RE §7.3 simulation: emitters, gravity/drag integration, the decal sweep (padding `size × 0.5`,
   see-through predicate), removal below y = −10.
4. RE §7.4 drawing rules for drops and strokes (shrink/grow, stretch, fixed-length tracers).
5. RE §7.5 decal placement, lift-off, streak orientation, scale ranges.
6. RE §7.6 the wrapping surface search.
7. RE §7.7 splat clusters including the 75 % wall-drip rule.
8. RE §7.8 growing blood pools (3 marks, easing, durations).
9. RE §7.9 rigid debris: cap 70, bounce maths, bloody trails, the last-0.6 s shrink.
10. RE §7.10 `clear()` (does **not** reset shake).
11. RE §8.1–8.13 every recipe with every constant.
12. RE §10 the tracer geometry rules (callers pass end points; the katana arc and enemy swing arcs
    are drawn by their owners through `tracer`).
13. RE §11 the death/dismemberment recipes (`enemies`/`players` call them; the parameter tables
    live here).
14. RE §14 the shake accumulator contract.
15. PN §4.5 the sweep parameters for particles and debris.

---

### 6.8 `audio`

**Files:** `src/audio.js` (public), `src/audio.tunes.js` (note tables)
**Imports:** `util`, `audio.tunes.js`
**Responsibility:** the whole synthesised sound engine — voices, positional model, one-shot cues,
the grapple reel loop, and the two music tunes with their scheduler. No files, no `<audio>` tags.

```ts
export class Audio {
  constructor();
  readonly ctx: AudioContext | null;
  init(): void;                                   // lazy create; no-op if already made
  resume(): void;
  setListener(eye: THREE.Vector3, right: THREE.Vector3): void;   // every frame
  setTune(key: 'downtown' | 'mexico'): void;
  music(on: boolean): void;
  readonly musicPlaying: boolean;
  setIntensity(v: number): void;                  // 0..1, every frame
  reelLoop(on: boolean): void;

  // one-shots. `pos` is optional world position => positional; otherwise centred.
  shot(): void; shotgunFire(): void; sniperFire(): void; revolver(): void;
  pump(): void; shellCue(): void; cylinder(): void; reload(): void; empty(): void;
  winded(): void; switchWeapon(): void;
  katanaSwing(): void; katanaHit(): void; parry(): void; perfectParry(): void;
  grappleFire(): void; grappleHit(): void; grappleRelease(): void;
  footstep(vol: number): void; jump(): void; land(h: number): void; slide(): void;
  wallJump(): void; mantle(): void; dash(): void; hurt(): void; death(): void;
  hitEnemy(pos: THREE.Vector3): void; headshot(pos: THREE.Vector3): void;
  kill(strong?: boolean): void; enemyDie(pos: THREE.Vector3): void; gib(pos: THREE.Vector3): void;
  spawn(pos: THREE.Vector3): void; lunge(pos: THREE.Vector3): void;
  bulletImpact(pos: THREE.Vector3): void; ricochet(pos: THREE.Vector3): void;
  pickup(): void; wave(): void; waveClear(): void;
  focusIn(): void; focusSlash(): void;
  explosion(pos: THREE.Vector3): void; fuse(pos: THREE.Vector3): void;
  flyerDive(pos: THREE.Vector3): void; flyerBuzz(pos: THREE.Vector3): void;
  stomp(pos: THREE.Vector3): void; bossRoar(pos: THREE.Vector3): void;
  shieldHit(pos: THREE.Vector3): void; smash(pos: THREE.Vector3, big?: boolean): void;
  remoteShot(kind: string, pos: THREE.Vector3): void;
  enemyShot(pos: THREE.Vector3): void; enemyShotgun(pos: THREE.Vector3): void;
  enemySniper(pos: THREE.Vector3): void; sniperAim(pos: THREE.Vector3): void;
}
```

Naming note: the reload cue named `shell` in HA §11 is exported as `shellCue()` so it does not
collide with the effects casing recipe in reader's minds; everything else keeps its spec name.

**Events:** none. `main` calls `init`/`resume` on the first pointer-down or key-down and when play
begins, and re-tries every 2 s while playing.

**Implementer checklist**

1. HA §10 engine: lazy context, graph (`voice → env gain → panner → master 0.55 → compressor`),
   music gain 0.05 bypassing the panner, the 2 s white-noise buffer with a random start offset.
2. HA §10 positional model: `1 / (1 + 0.09 d)` and the pan formula with the listener right vector.
3. HA §10 noise voice and tone voice parameter sets and envelope shapes.
4. HA §10 the grapple reel loop (single instance, 0.12 s ramp on, 0.05 s ramp off, end +0.3 s).
5. HA §11 every cue row — layers, frequencies, sweeps, durations, gains and delays.
6. HA §12.1 the scheduler: 100 ms timer, 0.7 s look-ahead, the throttled-tab jump, step length,
   intensity input.
7. HA §12.2 chord tables and the note tables (HOOK, TAIL A/B, BRIDGE, BREAK, CHORUS).
8. HA §12.3 the 8-bit theme: 7 sections, bass styles, drum styles, arpeggio, counter voice, octave
   shadow, echo.
9. HA §12.4 the mariachi waltz: chords, lead bars, harmony rule, strum, hats, fills.
10. HA §13 the listener / intensity / tune contract.

---

### 6.9 `hud`

**Files:** `src/hud/index.js` (public), `elements.js`, `screens.js`, `labels.js`, plus `styles.css`
**Imports:** `util`
**Responsibility:** every DOM element above the canvas: gameplay HUD, menus, screens, control
labels, kill feed, messages, tips. Owns all CSS. Contains **no** game logic: it renders what it is
told and reports clicks upward.

```ts
export interface SlotView { name: string; active: boolean; ammo: string; empty: boolean }

export class Hud {
  constructor(root: HTMLElement);

  // callbacks up to main
  onScreenClick: (() => void) | null;                       // click on the overlay background
  onUiAction: ((act: string, value: string | null, ev: Event) => void) | null;
                       // fired for any click on [data-act]; also for change/input on
                       // [data-act] form controls, and Enter inside [data-act="joinCode"]

  update(dt: number): void;                                 // message + tip countdowns, real dt
  setGameplayVisible(on: boolean): void;                    // the "no gameplay" state, inverted
  setDevice(pad: boolean): void;
  key(action: string): string;                              // HA 5 label table
  controlsHTML(): string;                                   // HA 6, current device

  // per-frame gameplay feed
  setAmmo(mag: number, reserve: number, magSize: number, reloading: boolean): void;
  setKatanaAmmo(): void;
  setSlots(slots: SlotView[]): void;
  setGrenades(n: number): void;
  setBreath(frac: number): void;
  setHealth(hp: number, max: number): void;
  setSpread(px: number): void;
  setCrosshairMode(mode: '' | 'katana'): void;
  setAds(on: boolean): void;
  setScope(on: boolean): void;
  setGrappleTarget(state: 0 | 1 | 2): void;
  setFocusMeter(show: boolean, frac: number, ready: boolean, label: string): void;
  setFocusMark(x: number | null, y?: number): void;
  setBoss(name: string | null, frac?: number): void;

  // event feed
  hitmarker(kill: boolean, crit: boolean): void;
  damageFrom(angle: number): void;
  setScore(score: number, combo: number): void;
  setWave(wave: number, left: number): void;
  setModifier(text: string): void;
  setTimer(text: string): void;
  setWeapon(name: string, hint: string): void;
  message(main: string, sub?: string, dur?: number): void;
  tip(html: string, dur?: number): void;
  kill(text: string, pts?: number): void;

  // online panels
  setPvpScore(html: string | null): void;                   // null hides and restores wave lines
  setBoard(html: string | null): void;                      // scoreboard overlay
  boardHidden(): boolean;

  // screens
  showScreen(html: string): void;
  hideScreen(): void;
}

export const Screens: {
  main(m: MainModel): string;
  online(m: OnlineModel): string;
  lobby(m: LobbyModel): string;
  pause(m: PauseModel): string;
  menu(m: MenuModel): string;
  matchOn(m: { confirmKey: string }): string;
  dead(m: DeadModel): string;
  over(m: OverModel): string;
  scoreboard(m: BoardModel): string;                        // for setBoard
  pvpScore(m: PvpModel): string;                            // for setPvpScore
};
```

Screen models are plain data (no DOM, no game objects). Example:

```ts
interface MainModel {
  best: number; checkpoint: number; mapKey: string;
  maps: { key: string; name: string; blurb: string }[];
  sens: number; invert: boolean; music: boolean;
  confirmKey: string;
}
interface LobbyModel {
  code: string; isPublic: boolean; isHost: boolean; mapKey: string;
  maps: { key: string; name: string; blurb: string }[];
  players: { id: string; name: string; host: boolean; self: boolean }[];
  status: string;
}
interface OnlineModel { name: string; isPublic: boolean; status: string; busy: boolean;
                        code: string }
interface PauseModel  { wave: number; score: number; sens: number; invert: boolean;
                        music: boolean; confirmKey: string }
interface MenuModel   { code: string; rows: BoardRow[]; sens: number; invert: boolean;
                        music: boolean; confirmKey: string }
interface DeadModel   { waves: number; kills: number; score: number; best: number;
                        newBest: boolean; checkpoint: number; confirmKey: string }
interface OverModel   { youWin: boolean; winnerName: string; rows: BoardRow[] }
interface BoardModel  { rows: BoardRow[]; code: string }
interface PvpModel    { rows: BoardRow[]; selfId: string }   // top 3 + self if ranked 4th or lower
interface BoardRow    { id: string; name: string; kills: number; deaths: number; self: boolean }
```

Every interactive element carries `data-act` (and `data-val` where needed) and calls
`stopPropagation` so it does not read as a background click. Action names used by `main`:
`start`, `online`, `back`, `quickPlay`, `create`, `join`, `joinCode`, `visibility`, `name`,
`pickMap`, `checkpoint`, `mainMenu`, `startMatch`, `leave`, `leaveMatch`, `sens`, `invert`,
`music`.

**Events emitted:** `onScreenClick`, `onUiAction`.
**Events consumed:** DOM clicks/inputs inside the overlay only. It never listens on `window`.

**Implementer checklist**

1. HA §1 page/DOM structure, element order, the initial values before the first frame.
2. HA §2 the three global states and exactly what each hides.
3. HA §3.1 crosshair (sizes, gap formula, 0.06 s ease, katana mode, ADS hide).
4. HA §3.2 ADS and the sniper scope overlay geometry.
5. HA §3.3 grapple reticle states and the breath bar.
6. HA §3.4 hit marker, including the restart-mid-animation requirement and the kill/crit variants.
7. HA §3.5 damage direction indicator (placement, rotation, 1.0 s fade, several at once).
8. HA §3.6 score and combo block.
9. HA §3.7 wave / modifier / enemies-left / timer block.
10. HA §3.8 live mini leaderboard and §3.9 the scoreboard overlay.
11. HA §3.10 boss bar, §3.11 health, §3.12 ammo/tally/grenades, §3.13 slots/weapon name/hint.
12. HA §3.14 tip line, §3.15 centre message (entrance animation), §3.16 kill feed (1.7 s, max 6).
13. HA §3.17 focus meter and §3.18 focus target marker.
14. HA §4 the per-frame update contract and its order.
15. HA §5 control label tables for both devices.
16. HA §6 the controls help text, verbatim, both columns, and the ≤ 900 px stacking rule.
17. HA §7.1 overlay/panel behaviour and click propagation.
18. HA §7.2 settings block, checkpoints block, map picker, main-menu button.
19. HA §7.3–7.10 every screen's content and prompts.
20. HA §8 the exact message, tip and kill-feed strings this module renders.
21. RE §12 hit marker / damage indicator / low-health presentation.
22. PI §15 the HUD outputs driven by the player.
23. This file §3.5 — the type and colour system; keep every size and timing from HA §3.

---

### 6.10 `player`

**Files:** `src/player/index.js` (public), `movement.js`, `grapple.js`, `grenades.js`, `camera.js`
**Imports:** `three`, `util`, `render`, `weapons`, `physics`
**Responsibility:** the local player — look, movement, grapple, health, guard/parry, camera,
grenades, weapon handling, death and the idle camera. Implements `Target`.

```ts
export type GrappleMode = 'idle' | 'fly' | 'on';

export class Player {
  constructor(ctx: Ctx);

  // identity / stats
  name: string; team: number;
  hp: number; maxHp: number; alive: boolean;
  regenDelay: number; regenRate: number; sinceDamage: number;
  grenades: number; readonly maxGrenades: number;      // 5
  breath: number;                                      // grapple stamina 0..1
  hurtFx: number; flashFx: number;
  shieldT: number;                                     // spawn protection, set by main
  lastHitBy: string | null; lastHit: LastHit | null;   // set by main / PvP
  gravityScale: number; dashLock: boolean;

  // transform (live vectors — read, do not mutate)
  body: Body;
  yaw: number; pitch: number; roll: number;
  readonly eye: THREE.Vector3;
  readonly center: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly speed: number;
  readonly isLocal: true;

  // movement state read by others
  crouching: boolean; sliding: boolean; aiming: boolean; firing: boolean;
  grapple: { mode: GrappleMode; hook: THREE.Vector3; anchor: THREE.Vector3 };

  // weapons
  weapons: Weapon[]; wi: number; readonly weapon: Weapon;

  // callbacks
  onThrow: ((d: { pos: number[]; vel: number[] }) => void) | null;   // network grenade replication

  // lifecycle
  update(dt: number): void;                            // scaled dt; only while play/dying
  idleCam(time: number): void;                         // non-playing states
  reset(pos: THREE.Vector3): void;

  // damage / guard  (Target surface)
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;
  knockback(dir: THREE.Vector3, amount: number): void;
  die(): void;
  tryDeflect(p: Projectile): false | { perfect: boolean; returned: boolean };
  tryBlockMelee(e: Enemy): boolean;
  readonly blockRadius: number;
  readonly blocking: boolean;
  readonly parryWindow: boolean;

  // things others do to the player
  heal(amount: number): number;                       // positive finite amount; dead -> 0; cap at maxHp; return HP restored
  addAmmoAll(frac?: number): void;                     // default 0.5
  throwGrenade(remote?: { pos: number[]; vel: number[] }): void;
  clearNades(): void;
  switchTo(index: number, silent?: boolean): void;
  recoil(pitch: number, yaw: number): void;
  kickFov(v: number): void;
  lunge(speed: number): void;
  detachGrapple(boost: boolean): void;
  aimDir(spread: number, out?: THREE.Vector3): THREE.Vector3;
  weaponState(): WeaponState;                          // also used by main to start a focus slash
}
```

**Events emitted:** `onThrow` (grenade); `ctx.game.onPlayerDeath()` on death;
`ctx.hud.*` for weapon name/hint, crosshair mode, ADS/scope, grapple reticle, damage direction,
tips and the "OUT OF BOUNDS" message; `ctx.audio.*` for every movement/health cue;
`ctx.effects.*` for dash/double-jump bursts and the shake accumulator;
`ctx.game.hitstop/addScore` on parries.
**Events consumed:** `ctx.input` every frame; `ctx.game` PvP and breakable hooks through the
weapons it owns; `pdmg`/`nade`/`cut`/`parry` effects applied by `main` through the methods above.

**Implementer checklist**

1. PI §3.1–3.5 constants and the full initial state.
2. PI §3.6 `reset` (also used by online respawn).
3. PI §4 the per-frame update order — implement it in exactly that order.
4. PI §5 look, look multipliers while aiming, forward/flat-forward/right derivation.
5. PI §6.1–6.7 wish direction, sprint, ADS flag, crouch, slide, ground and air acceleration.
6. PI §6.8–6.11 jump buffer, coyote, ground jump, wall jump, double jump, air dash.
7. PI §6.12 gravity, no-snap rule, 48 m/s cap, hand-off to `world.moveBody`.
8. PI §6.13 mantle probes and launch.
9. PI §6.14 landing detection and land-grace friction.
10. PI §6.15 out-of-bounds respawn (20 damage, teleport, message).
11. PI §6.16 the focus dash-lock frame behaviour (main drives the body).
12. PI §7.1–7.8 grapple: hand point, target search priority, firing, fly, attached physics, detach,
    stamina, reticle states.
13. PI §8.1–8.6 damage, knockback, regeneration, pickups/heals, death.
14. PI §9.1–9.3 guard radius, projectile deflect, melee parry, being parried online.
15. PI §10.1–10.6 eye/centre, bob and footsteps, roll/shake/springs, FOV, recoil entry points, the
    four post-effect scalars.
16. PI §11.1–11.6 grenade charge, launch parameters, throw, flight, explosion, arc preview.
17. PI §12.1–12.4 slots, quick melee, the `WeaponState` record, post-animate flags.
18. PI §14.1 dead-state simulation and §14.2 the idle camera.
19. PI §16.2 keep the public surface exactly as listed there and here.
20. N §12 the online stat overrides applied by `main` on reset.
21. RE §3.2–3.4 camera placement, FOV control, shake consumption (the player writes the camera).
22. GL §30 the player half of the off-the-page rules.

---

### 6.11 `weapons`

**Files:** `src/weapons/index.js` (public), `stats.js`, `gun.js`, `katana.js`, `models.js`
**Imports:** `three`, `util`, `render`, `physics`
**Responsibility:** the four view models, gun ballistics, spread, reload and cycle state machines,
the katana (slash, guard, parry flick, blade blood). Hitscan resolution and the routing of damage
to enemies / players / breakables.

```ts
export type GunKind = 'rifle' | 'shotgun' | 'sniper' | 'revolver';

export interface GunStats { /* W section 4, one field per table row */ }
export const GUN_STATS: Record<GunKind, GunStats>;

export interface Weapon {
  readonly kind: string;            // GunKind | 'katana'
  readonly name: string;
  readonly hint: string;
  readonly isGun: boolean;
  readonly scope: boolean;
  readonly root: THREE.Group;       // child of ctx.renderer.rig
  readonly adsFov: number;
  aimAmt: number;
  mag: number; reserve: number; magSize: number; reloading: boolean;
  readonly spreadPx: number;
  equip(): void;
  unequip(): void;
  animate(st: WeaponState, dt: number): void;
  addAmmo(n: number): void;
  resetAmmo(): void;
  dispose(): void;                            // cancel owned timers and remove/release the view model
  kickPos(x: number, y: number, z: number): void;   // external spring kicks (grapple, grenade)
  kickRot(x: number, y: number, z: number): void;
}

export class Gun implements Weapon {
  constructor(ctx: Ctx, player: Player, kind: GunKind);
  startReload(): void;
}

export class Katana implements Weapon {
  constructor(ctx: Ctx, player: Player);
  blocking: boolean; blockT: number; cooldown: number; blood: number; combo: number;
  startSlash(st: WeaponState): void;      // also used by the focus system
  addBlood(amount: number): void;         // +0.42 per katana/focus kill
  onDeflect(perfect: boolean): void;      // parry flick
}

export function makeLoadout(ctx: Ctx, player: Player): Weapon[];  // [rifle, shotgun, sniper, katana]
```

**Events emitted:** `ctx.game.onShot(end)` for every ray; `ctx.game.hitPlayer`,
`ctx.game.breakHit`, `ctx.game.cutRopes`, `ctx.game.breakablesInArc`; `ctx.enemies.damage`;
`ctx.game.hitstop`; `ctx.effects.*`; `ctx.audio.*`; `ctx.input.rumble`;
`player.recoil/kickFov/lunge/aimDir`.
**Events consumed:** the `WeaponState` record once per frame; external spring kicks.

**Implementer checklist**

1. W §1 loadout and slot indices; the revolver is implemented but not issued.
2. W §3.1–3.6 view-model frame, rest/aim poses, sight alignment, springs, the per-frame pose blend
   (step by step), equip/unequip, the scoped visibility rule.
3. W §4 the stat table — every column, every gun.
4. W §5 the runtime state fields.
5. W §6 spread, bloom, the square distribution, the crosshair pixel formula.
6. W §7 the gun frame update order and the reload/fire gates.
7. W §8 firing: the 12 numbered steps.
8. W §9 hit detection and the a–e resolution priority.
9. W §10 damage, head multipliers and falloff, for enemies and for players.
10. W §11.1–11.5 all three reload types, their poses, timings, interruption rules, auto-reload and
    the empty click.
11. W §12 the pump / bolt cycle including the negative-`t` window and the rack event.
12. W §13 recoil scaling by aim.
13. W §14 aim-down-sights behaviour.
14. W §15 shell casings and the eject velocity.
15. W §16 muzzle flash mesh, muzzle burst, smoke, tracers, impacts.
16. W §17.2–17.5 the four gun models, part by part, with the muzzle and eject anchors.
17. W §18.1–18.10 the katana: stats, geometry, state machine, slash start and trail, animation,
    hit test, guard pose, parry flick, blade blood, quick melee.
18. W §19 switching, §20 ammo and reset, §21 audio cues, §22 the interface contracts.

---

### 6.12 `enemies`

**Files:** `src/enemies/index.js` (public), `types.js`, `model.js`, `ai.js`, `boss.js`,
`flyer.js`, `projectiles.js`
**Imports:** `three`, `util`, `render`, `physics`
**Responsibility:** every enemy, their AI, attacks, bosses, projectiles, damage, death and gore.
The manager owns the enemy list and the projectile pool. It does **not** decide when to spawn —
`main` does.

```ts
export interface EnemyType {
  key: string; name: string; hp: number; speed: number; weapon: string; score: number;
  scale: number; tone: number; boss?: boolean; flying?: boolean;
  /* plus the ranged/melee parameter block of E section 2.2 and 2.3 */
}
export const TYPES: Record<string, EnemyType>;
export const BOSS_ORDER: string[];                 // ['boss', 'hitbox', 'lagspike']

export class EnemyManager {
  constructor(ctx: Ctx);
  readonly list: Enemy[];
  readonly alive: number;
  mods: { speed: number; damage: number };
  mirror: boolean;                                  // true = client mirror (dormant)

  // callbacks set by main
  onKill: ((e: Enemy, info: HitInfo, overkill: boolean) => void) | null;
  onBoss: ((e: Enemy) => void) | null;
  onSpawn: ((e: Enemy) => void) | null;
  onClientHit: ((e: Enemy, amount: number, info: HitInfo) => void) | null;
  onFire: ((p: Projectile) => void) | null;

  spawn(type: string, pos: THREE.Vector3, id?: number): Enemy;
  update(dt: number): void;                         // scaled dt
  clear(): void;                                    // enemies, corpses, projectiles

  damage(e: Enemy, amount: number, info: HitInfo): void;
  kill(e: Enemy, info: HitInfo): void;
  killMirror(id: number, info: HitInfo): void;
  yank(e: Enemy, target: THREE.Vector3): void;
  blastEnemies(center: THREE.Vector3, radius: number, damage: number, except?: Enemy | null): void;
  explode(e: Enemy, scale: number): void;           // bomber detonation

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number, ignore?: Enemy | null):
    { enemy: Enemy; part: string; dist: number; point: THREE.Vector3 } | null;
  inArc(pos: THREE.Vector3, dir: THREE.Vector3, range: number, cosHalf: number):
    { enemy: Enemy; dist: number }[];
  nearestVisible(from: THREE.Vector3, forward: THREE.Vector3, cosHalf: number, max: number): Enemy | null;
  eye(e: Enemy): THREE.Vector3;

  snapshot(): number[][];                           // host rows, E 17.2 (dormant)
  applySnapshot(rows: number[][], now: number): void;
}
```

**Events emitted:** `onKill` / `onBoss` / `onSpawn` / `onClientHit` / `onFire`;
`ctx.game.hitstop`, `ctx.game.addScore` (shield break); `ctx.hud.hitmarker`;
`ctx.effects.*`; `ctx.audio.*`; `ctx.input.rumble`.
**Events consumed:** `ctx.game.targets()` for target selection and attacks;
`ctx.nav.findPath`; `ctx.world` for movement, rays and line of sight; `enemies.mods` set by `main`.

**Implementer checklist**

1. E §2.1–2.5 the catalogue: stats, ranged parameters, melee/special parameters, tone and model
   kind, humanoid proportions.
2. E §3.1 the enemy record with every initial value; §3.2 spawning; §3.3 the coarse state machine
   including the spawn growth animation and the stunned rules.
3. E §4.1 bodies; §4.3 hit spheres and the ray rule. (§4.2/4.4/4.5 geometry lives in `render`;
   this module decorates it and reads the anchors.)
4. E §5 the per-frame update order, the target-space push and the removal rule.
5. E §6.1–6.6 steering, ground-ahead probe, approach slots, pairwise separation, wander, path
   following with jumps and unsticking.
6. E §7.1–7.4 the ground AI for bomber, rusher, boss dispatch and the four ranged classes.
7. E §8.1–8.4 fire control: sniper aim-up and laser, bursts, shotgun, one-shot spawning.
8. E §9.1–9.3 the three bosses, every attack phase, timing and counter.
9. E §10 the flyer brain and avoidance.
10. E §11 projectiles, §11.1 the segment test, §11.2 deflect/redirect, §11.3 blast burst.
11. E §12.1–12.8 damage entry, the multiplier quirk, shields, health damage, bomber detonation,
    yank, and the query helpers.
12. E §13.1–13.4 kill, fall death, boss death, corpse update.
13. E §14 animation and telegraphs (the readable wind-up windows are gameplay).
14. E §16 the payload `onKill` must provide.
15. E §17.1–17.6 the replication contract (implement `snapshot`/`applySnapshot`/`killMirror` and
    the `mirror` flag; nothing wires them yet).
16. E §18.1–18.7 the interfaces.

Not this module: wave composition and spawn placement (GL §12–13, `main`), boss hp scaling
(GL §12), score labels (GL §14).

---

### 6.13 `players` (remote avatars)

**File:** `src/players.js`
**Imports:** `three`, `util`, `render`
**Responsibility:** encode the local player's state packet, and represent every other player:
snapshot buffering, interpolation, pose, weapon prop, name tag, rope, hit spheres, ragdoll.
Implements `Target`. Contains no transport code.

```ts
export function encodeState(p: Player): number[];        // the `ps` array of section 5.9

export interface HitSphere { part: string; r: number; obj: THREE.Object3D }

export class RemotePlayer {
  constructor(ctx: Ctx, id: string, name: string, team?: number, tone?: number);

  readonly id: string;
  name: string;
  alive: boolean; hp: number;
  readonly visible: boolean;                            // current figure exists and is visible
  body: { pos: THREE.Vector3; vel: THREE.Vector3; halfW: number; height: number; onGround: boolean };
  readonly center: THREE.Vector3;
  readonly eye: THREE.Vector3;
  readonly forward: THREE.Vector3;
  readonly right: THREE.Vector3;
  readonly isLocal: false;
  readonly speed: 0;
  readonly blockRadius: 0;

  crouching: boolean; sliding: boolean; blocking: boolean; aiming: boolean;
  firing: boolean; grappling: boolean; parryWindow: boolean;
  hook: THREE.Vector3;
  hits: HitSphere[];
  lastSeen: number;                                      // ms stamp of the last `ps`
  deadT: number;

  onDamage: ((amount: number, from: THREE.Vector3 | null) => void) | null;

  push(arr: number[], now: number): void;                // a received `ps`
  update(dt: number, now: number): void;                 // interpolate + pose, real dt
  shots(kind: string, ends: number[]): void;             // draw tracers + flash + sound
  ragdoll(dir: number[] | null, over: boolean): void;
  flash(): void;
  dispose(): void;

  // Target surface
  takeDamage(amount: number, from?: THREE.Vector3 | null): void;   // routes to onDamage
  knockback(): void;                                     // no-op
  tryDeflect(): false;
  tryBlockMelee(e: Enemy): boolean;
}
```

**Events emitted:** `onDamage` (set by `main`, which turns it into a `pdmg` message);
`ctx.effects.*` for tracers, flash, ragdoll debris and blood; `ctx.audio.remoteShot/enemyDie`.
**Events consumed:** `push` from `main`'s `ps` handler; `shots` from the `shots` handler;
`ragdoll` from the `pdead` handler.

**Implementer checklist**

1. N §7 the encoding table, the flag bits and every decoding rule.
2. N §8.1 snapshot buffering, the synthetic first snapshot, weapon-prop rebuild, alive transitions,
   the fresh-figure-on-respawn rule, the last-seen stamp, the pre-first-packet state.
3. N §8.2 interpolation and extrapolation: 80 ms delay, 350 ms extrapolation cap, the 6 m teleport
   threshold, the rate-22 ease, shortest-arc yaw.
4. N §8.3 derived geometry (height, eye, centre, forward, right, root yaw + PI).
5. N §8.4 the eleven hit spheres and the (0, −100, 0) parking rule for corpses.
6. N §11.1 skeleton dimensions and §11.2 the name tag (render the name; keep the placement and the
   billboard yaw formula).
7. N §11.3 the four weapon props and the out-of-range fallback.
8. N §11.4 the full pose/animation table — every readable cue.
9. N §11.5 the rope and hook (the same points the katana cuts).
10. N §11.6 hit flash and shot tracers (muzzle point, thickness by kind, 0.06 s, dead-remote rule).
11. N §11.7 slump and ragdoll, once per life.
12. N §11.8 respawn, §11.9 the health field.
13. E §18.4 the remote-player `Target` surface (block radius 0, speed 0, melee-block rule).

---

### 6.14 `net`

**File:** `src/net.js`
**Imports:** *(nothing; reads the global `Peer`)*
**Responsibility:** PeerJS transport only — peer lifecycle, lobby codes, hosting, joining, quick
play, the message envelope and routing. It knows nothing about players, scores or the game.

```ts
export const NET: {
  PREFIX_LIVE: 'shooter-rebuild-v1-'; PREFIX_DEV: 'shooter-rebuild-dev-v1-';
  PUBLIC_SLOTS: 8; CODE_LEN: 5; CODE_ALPHABET: string; CODE_RETRIES: 3;
  MAX_PLAYERS: 8; SIGNAL_TIMEOUT: 12000; JOIN_TIMEOUT: 14000; QUICK_TIMEOUT: 11000;
  REFUSE_CLOSE_DELAY: 400; SILENT_TIMEOUT: 9000;
};

export class Net {
  constructor();
  readonly id: string | null;
  readonly code: string | null;
  hostId: string | null;
  isHost: boolean;
  isPublic: boolean;
  readonly active: boolean;                 // a peer exists and is connected
  accepting: boolean;                       // host may refuse new joins
  readonly conns: Map<string, any>;         // peer id -> PeerJS DataConnection

  onPeerJoin: ((id: string, meta: any) => void) | null;    // host only
  onPeerLeave: ((id: string) => void) | null;              // host only
  onDisconnect: (() => void) | null;                       // client: the host went away

  host(o?: { isPublic?: boolean; code?: string }): Promise<void>;
  join(code: string, meta?: any): Promise<void>;
  quickJoin(meta?: any, onStatus?: (s: string) => void): Promise<void>;
  leave(): void;
  close(id: string): void;                  // forget one peer without a "peer left" event

  on(type: string, fn: (data: any, from: string) => void): void;   // one handler per type
  send(type: string, data: any, relay?: boolean): void;
  broadcast(type: string, data: any): void;                        // send with relay = true
  sendTo(id: string, type: string, data: any): void;
}
```

`host`, `join` and `quickJoin` reject with an `Error` whose message is one of the raw strings in
N §3.7 / HA §7.12; `main` maps them to friendly text.

**Events emitted:** `onPeerJoin`, `onPeerLeave`, `onDisconnect`, plus every registered message
handler.
**Events consumed:** PeerJS `open`, `connection`, `data`, `close`, `error`, `disconnected`.

**Implementer checklist**

1. N §2.1 library loading check, peer options, ICE servers, connection options
   (`reliable`, `serialization: 'json'`, metadata `{ name }`), the non-object payload guard.
2. N §2.2 the id namespace and the localhost dev prefix.
3. N §2.3 private code alphabet and length; public `PUB0..PUB7`; upper-casing.
4. N §2.5 every constant.
5. N §3.1 hosting: public slot walk, `unavailable-id` retries, the 12 s open rule, the
   "all public lobbies are busy" error.
6. N §3.2 joining: the knock, the five race outcomes, the `peer-unavailable` id parsing, adoption.
7. N §3.3 quick play: 8 simultaneous knocks, first welcome wins, the 11 s cap, the
   "no open public lobbies" result.
8. N §3.4 accepting: capacity/closed refusals, the 400 ms close delay, `welcome`, `onPeerJoin`.
9. N §3.5 keep-alive reconnect, drop handling, the deliberate-leave flag, teardown.
10. N §4 envelope validation, connection-derived sender identity, message-role checks, then
    routing (forward addressed, relay, dispatch). Main validates payload fields before applying them.
11. N §6 the tick contract this module supports (`main` drives; `net` only sends).
12. HA §7.12 the raw error strings.

Not this module: the silent-peer timeout (`main`, it needs remote state), the friendly error
mapping (`main`), and every message's meaning (`main`).

---

### 6.15 `main`

**Files:** `src/main.js` (entry) plus the private `src/game/` set:
`state.js`, `ui.js`, `solo.js`, `ffa.js`, `pickups.js`, `breakables.js`
**Imports:** everything. `main` is the only module allowed cycles-by-convenience; nothing imports
`main` or `src/game/*`.

**Responsibility:** boot, the frame loop, the top-level state machine, screens and menus, run
control, solo waves and scoring, the focus slash, pickups, breakable props, the FFA lobby and
match, PvP hit resolution, all network message handlers, the per-frame HUD feed, and the
`GameHooks` object of section 5.2.

Internal split (guidance, not a contract — only `main.js` is imported from outside `src/game/`):

| File | Contents |
|---|---|
| `state.js` | the `GameState` record, constants, `resetRun`, `beginCommon`, `beginSolo`, `beginAtWave`, `pause`, `resume`, `mainMenu`, level rebuild, settings load/apply |
| `ui.js` | screen view-models, `showScreen` calls, the `onUiAction` router, the screen-click rule, friendly error mapping |
| `solo.js` | wave director, spawn placement, modifiers, scoring/combo/kill labels, the focus slash, the dead screen |
| `ffa.js` | lobby model, match lifecycle, spawn dealing, respawn, scores, win/time limit, remote bookkeeping, PvP hit resolution, rope cutting, shot relay, every message handler |
| `pickups.js` | pickup list, spawn/update/collect/remove, the arena spawner, the `pickup`/`take`/`taken` messages |
| `breakables.js` | `breakHit`, `breakablesInArc`, `blastBreakables`, `break`, the `brk` message, quiet breaks for late joiners |

```ts
// src/main.js exports nothing. It attaches a debug handle:
declare global { interface Window { __game: {
  ctx: Ctx; gs: GameState; player: Player; enemies: EnemyManager; net: Net;
  remotes: Map<string, RemotePlayer>; lobby: Lobby; scores: Map<string, ScoreRow>;
  pickups: Pickup[]; beginSolo(): void; beginAtWave(n: number): void; jumpToWave(n: number): void;
} } }
```

**Events emitted:** every `GameHooks` method (section 5.2); all network sends;
`hud.showScreen/message/tip/kill/...`; `audio` wave/pickup/kill cues; `renderer.render`.
**Events consumed:** `input.onLockChange`, `input.onDeviceChange`; `hud.onScreenClick`,
`hud.onUiAction`; `net.onPeerJoin`, `net.onPeerLeave`, `net.onDisconnect` and all 20 message
types; `enemies.onKill`, `enemies.onBoss`; `player.onThrow`; `remote.onDamage`;
window `pagehide`; a 250 ms `setInterval` keep-alive.

**Implementer checklist**

1. GL §2 boot sequence, in that order (see also section 8 of this file).
2. GL §3 persistent settings: load, apply to input, write back; the name box rules.
3. GL §4 the game-state record and its constants.
4. GL §5 the top-level state machine and every transition.
5. GL §6 the loop, the 0.05 s clamp, the hidden-tab keep-alive.
6. GL §7 time scale: hit-stop and focus slow motion.
7. GL §8 the per-frame update order (reproduced in section 7 of this file).
8. GL §9 orchestration-level input handling, pointer lock, screen clicks.
9. GL §10 every screen and the two menu actions.
10. GL §11 run control: reset run, begin common, begin solo, begin at wave, pause, resume,
    jump-to-wave.
11. GL §12 solo waves: roster, modifiers, wave setup, the wave update, boss hp scaling.
12. GL §13 enemy spawn placement (default, sniper, flyer, boss with its fallback search).
13. GL §14 scoring, combo, kill labels, drops, the boss hook.
14. GL §15 the focus slash: candidate search, enter/end, update, dash, execute.
15. GL §16 solo death and the dead screen.
16. GL §17 FFA lobby flow, including the friendly error mapping and leave-online.
17. GL §18 FFA match lifecycle and the late-joiner path.
18. GL §19 FFA spawn placement (arena spawn rule, farthest index, the initial deal).
19. GL §20 death, respawn, spawn shield, the tally.
20. GL §21 scoreboard and score HUD.
21. GL §22 win conditions, the time limit, match end, return to lobby.
22. GL §23 remote bookkeeping, the network update order, the 9 s silent-peer timeout.
23. GL §24 PvP hit resolution: `raycastPlayers`, `playersInArc`, `hitPlayer`, `pdmg`, `parry`.
24. GL §25 rope cutting; GL §26 shot tracers over the network.
25. GL §27 the message catalogue — all 20 types, both directions.
26. GL §28 pickups; GL §29 breakable props; GL §30 out-of-bounds.
27. GL §31 the kill feed entries; GL §32 the per-frame HUD feed; GL §33 audio hooks.
28. GL §34 provide every hook in the "Provided by this subsystem" table.
29. N §9.1–9.9 the authority rules (they refine GL §24–29 for the network).
30. N §10.1–10.5 lobby sync, match start and spawn assignment, late joiners, match end, leaving.
31. PI §2.13 game-level input handling.
32. HA §7.11 the screen flow, and §7.12 the friendly status mapping.
33. E §15.1–15.6 the spawn director (composition, modifiers, the spawn loop, boss scaling, spawn
    positions) — the same rules as GL §12–13; implement once.

---

## 7. Frame update order in `main`

One `step(nowMs)` per animation frame, plus the hidden-tab keep-alive. This is `game-loop.md` §8,
made explicit. **Implement it in this order.**

```
step(nowMs):

 0. dt = min(0.05, (nowMs - lastStep) / 1000);  lastStep = nowMs
      (lastStep is initialised at script load, so the first frame is clamped too)

 1. input.update(dt)                                   // real dt, always first

 2. menu / screen key handling                          (GL 9)
      start|pause|dead + pressed(jump|confirm) [+ pause while paused] -> screen click
      play + pressed(pause)  -> resume if menu open, else pause + exit lock
      play + menu + pressed(jump|confirm) -> resume

 3. music toggle: pressed('music') -> flip, store, audio.music(...), tip 1.5 s

 4. scoreboard visibility                               (GL 21)
      online && playing: keyboard -> down('score'); gamepad -> pressed('score') toggles a latch
      otherwise: latch = false

 5. pointer-lock tip timer (real dt)                    (GL 8.6)

 6. scale = hitstopT > 0 ? (hitstopT -= dt, hitstopScale)
          : focus.active ? 0.26
          : 1
    sdt = dt * scale

 7. focus update (REAL dt) when state==='play' && mode==='solo', else endFocus()   (GL 15)

 8. if playing (state 'play' or 'dying'):
      8.1  gs.time += sdt;   if (player.shieldT > 0) player.shieldT -= dt
      8.2  music heal timer (real dt, 2 s period)
      8.3  bounds guard: outside bounds+8 or y>150 -> body.y = -100        (GL 30)
      8.4  player.update(sdt)
      8.5  enemies.update(sdt)
      8.6  effects.update(sdt)
      8.7  pickups.update(sdt)
      8.8  netUpdate(dt)                       // REAL dt, see 7.1 below
      8.9  if state==='play' && solo: waveUpdate(sdt)                      (GL 12)
      8.10 if online: arenaPickupSpawner(dt)                               (GL 28)
      8.11 combo decay by sdt; at 0 -> combo = 0, hud.setScore(score, 0)
      8.12 if state==='dying': deathT += dt
             ffa  -> respawn countdown (real dt)                           (GL 20)
             solo -> after 1.7 s: state='dead', dead screen, exit lock     (GL 16)

 9. else (not playing):
      9.1  gs.time += dt
      9.2  if state is start|dead|lobby|over: player.idleCam(gs.time)
      9.3  effects.update(dt);  if (net.active) netUpdate(dt)
      9.4  if state==='over': overT += dt; host only: after 8 s send `backtolobby`, go to lobby

10. for each level.animated: a.update(gs.time)

11. audio.setListener(player.eye, player.right)

12. HUD feed, in this order                             (GL 32, HA 4)
      12.1 weapon is a gun ? hud.setAmmo(mag, reserve, magSize, reloading) : hud.setKatanaAmmo()
      12.2 hud.setSlots(...)  for all four weapons
      12.3 hud.setGrenades(player.grenades)
      12.4 hud.setBreath(player.breath)
      12.5 hud.setHealth(player.hp, player.maxHp)
      12.6 hud.setSpread(weapon.spreadPx)
      12.7 hud.update(dt)                                // message + tip countdowns, REAL dt
      12.8 hud.setFocusMeter(...)                        // GL 32 / HA 3.17
      12.9 boss bar: alive -> hud.setBoss(name, hp/maxHp); dead -> hud.setBoss(null)

13. audio.setIntensity(clamp((enemies.alive + queue.length + 2*remotes.size)/12, 0, 1)
                       * (intermission > 0 ? 0.25 : 1))

14. renderer.render(gs.time, {
      hurt:  player.hurtFx,
      flash: player.flashFx,
      slow:  scale < 1 ? 1 : 0,
      lowHp: (player.alive && player.hp < 30) ? 1 - player.hp / 30 : 0
    })
```

Score, wave, modifier, timer, PvP score and the kill feed are **event-driven**, not part of the
per-frame feed: they are pushed when they change.

### 7.1 `netUpdate(dt)` internal order (`networking.md` §6)

```
if (!net.active) return
tick++
1. for each remote: remote.update(dt, nowSeconds)
2. if inMatch(): silent-peer check (lastSeen older than 9000 ms -> drop, feed, host cleanup)
     client timing out hostId -> leave online, stop this netUpdate
3. if (tick % 3 === 0 && inMatch()): net.broadcast('ps', encodeState(player))
4. if (shotQueue.length): net.broadcast('shots', { k: weapon.kind, e: shotQueue }); shotQueue = []
5. if (isHost && inMatch() && !gs.over): matchT += dt; if (matchT > 480) end the match
```

### 7.2 Hidden-tab keep-alive

A 250 ms interval: if `net.active` and more than 300 ms have passed since `lastStep`, run one
`step(performance.now())`. It never starts a second animation-frame chain.
With timer-only steps at regular 250 ms intervals, the threshold permits a step every 500 ms:
about 2 Hz, 0.67 state packets/s, and 10% simulation speed. Browser throttling can make this slower.

---

## 8. Boot sequence (`game-loop.md` §2)

```
 1. renderer = new Renderer(canvas)            // scene, camera, rig, lights, post target
    scene = renderer.scene; camera = renderer.camera
    world    = new World()
    audio    = new Audio()                    // no AudioContext until a user gesture
    net      = new Net()                      // no peer or connection until host/join
 2. mapKey   = validKey(store.getStr(SKEY.MAP, 'downtown'))
 3. level    = buildLevel(scene, world, mapKey, { arena: false })
    renderer.setLevelShadow(level.shadow.center, level.shadow.radius)
    nav      = new NavGrid(world, level.bounds, 1); nav.build()
 4. remember loadedKey = mapKey, loadedArena = false
 5. audio.setTune(mapKey === 'mexico' ? 'mexico' : 'downtown')
 6. input  = new Input(canvas)
    hud    = new Hud(document.getElementById('hud'))
    effects= new Effects(scene, world)
 7. load persistent settings (section 5.12) and apply the look settings to input
 8. gs = makeGameState(); lobby = emptyLobby(); scores = new Map(); remotes = new Map()
 9. hooks = makeGameHooks()                    // closures read the current gs/ctx when called
    ctx = { scene, camera, renderer, world, nav, level, input, hud, effects, audio, net,
            enemies: null, player: null, remotes, game: hooks }
10. enemies = ctx.enemies = new EnemyManager(ctx)
    player = ctx.player = new Player(ctx); player.name = storedName
11. publish the debug handle using these same objects
12. register every net message handler and the enemy manager hooks
13. register: hud.onScreenClick, hud.onUiAction, canvas click, input.onLockChange,
    input.onDeviceChange, window 'pagehide' (leave the session), and a one-shot
    pointerdown/keydown wake for the audio context
14. hud.setDevice(input.usingGamepad); apply look settings; hud.setWeapon(name, hint);
    show the main screen
15. start requestAnimationFrame(step) and the 250 ms keep-alive interval
```

Level rebuild (`game-loop.md` §2 "Level rebuild") is the same sequence steps 3–5, preceded by
`disposeLevel(scene, oldLevel)` and `world.clear()`, and followed by replacing `ctx.level` and
`ctx.nav`. `main` clears pickups, enemies and effects itself; the level does not.

---

## 9. Cross-cutting integration rules

1. **Nobody caches `ctx.level` or `ctx.nav`** across frames. Read them each time.
2. **Nobody caches another module's live vectors.** `player.eye`, `enemy.center`, `remote.center`
   are internal and change in place. Copy before storing.
3. **`update(dt)` contracts.** `input` and `hud` take real dt. `player`, `enemies`, `effects` (while
   playing) and pickups take scaled dt. `effects` takes real dt while not playing. `net` always
   takes real dt.
4. **Only `main` mutates `GameState`.** Other modules read it through `ctx.game`'s accessors.
5. **Browser ownership.** Only `main` accesses storage (through `util.store`), changes
   `document.title`, and owns game-state/keep-alive timers. Input owns its input, focus, pointer-lock
   and device listeners and pointer-lock retry timer. Hud owns DOM and listeners inside `#hud`.
   Renderer owns the canvas and its resize listener. Audio owns its AudioContext and the 100 ms
   music scheduler. Net reads `window.Peer` and location for its namespace and owns connection,
   signalling, join and refusal timers. A gun may own one cancellable real-time 250 ms auto-reload
   timer; cancel it on reset/disposal, and recheck empty/not-reloading when it fires. Other gameplay
   timers count down in `update`. Each owner removes its listeners/timers when it is disposed.
6. **Damage always flows through one entry point per victim kind**: `enemies.damage(e, amount, info)`
   for bots, `game.hitPlayer(target, damage, info)` for remote players, `player.takeDamage(...)`
   for the local player. Main uses `player.heal(amount)` for pickups, wave rewards and focus heals.
   Reset and boss scaling are the only external stat setup; otherwise never write `hp` from outside.
7. **Effects never call gameplay.** `effects.debris(mesh, …)` takes ownership of a mesh; the caller
   must not remove or reuse it.
8. **`render` never reads gameplay state.** Everything it needs arrives as arguments to `render()`.
9. **The HUD never reads gameplay state.** It has setters only. The single read-back allowed is
   `hud.boardHidden()`.
10. **Network payloads are validated at the handler.** Unknown ids, wrong types, out-of-range
    indices and missing fields are dropped silently — never thrown.
11. **Ids.** Enemy ids and projectile ids share one counter starting at 1. Pickup ids are a separate
    counter starting at 1 (host-authoritative online). Breakable ids are level build indices.
    Player ids are PeerJS peer ids.
12. **Sound and effect ownership.** Whoever causes an event plays its cue: weapons play fire cues,
    enemies play their own cues, `main` plays wave/pickup/kill cues, `player` plays movement cues.
    No module plays another's cue.
13. **Frame budget.** Target 60 fps on an integrated GPU at 1080p. Do not allocate `Vector3`s in
    per-frame loops; use module-level scratch vectors. Instanced pools are pre-allocated at
    construction and never resized.

---

## 10. Decisions this document makes (and why)

| Decision | Reason |
|---|---|
| Two palettes (tone + surface) | a level built from six saturated character colours cannot look clean |
| Shared figure builder lives in `render` | `enemies` and `players` both need it and neither may import the other |
| Runtime calls go through `ctx`, imports only for factories | the only way to keep 15 parallel modules acyclic |
| `main` is split into `src/game/*` | `game-loop.md` is 35 sections; one file would be unreviewable. The split is private, so it costs no integration risk |
| Post-processing is hand-written, not `EffectComposer` | one shader, no addon surface, and `rendering-effects.md` §6.3 must be exact |
| `BufferGeometryUtils` is the only addon | level geometry must merge per material to hit the frame budget |
| Soft shadows | the flat-shaded low-poly target needs shadows for depth readability; fog gives distance fade |
| Outlines removed entirely | explicit product direction; silhouette readability comes from flat colour blocks + shadows + the toon ramp on characters |
| `audio.shellCue()` renamed from the spec's `shell` | avoids confusion with `effects.shell()`; it is the only rename in the codebase |

---

## 11. First-week order of work

Nothing below is a schedule; it is the order that unblocks the most people.

1. `util`, `render` (palette, materials, primitives, `Renderer` with the composite pass),
   `physics`. Everything else is blocked on these three.
2. `input`, `hud` (empty setters that log, then real DOM), `audio` (silent stubs, then real),
   `effects`, `nav`.
3. `level` (Downtown solo first — it is the only map that ships).
4. `player` + `weapons` together (they share the view-model frame).
5. `enemies`.
6. `main` solo path: boot, loop, screens, waves, scoring, pickups, focus.
7. `net`, `players`, `main` FFA path.
8. `level` arena variant, Mexico, breakables.

A module is "done" when every numbered item in its checklist is implemented and its spec sections
have been re-read against the code once.

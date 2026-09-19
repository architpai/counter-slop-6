# Counter Slop 6 — Improvements Backlog

Date: 2026-09-19

Baseline: `tsc --noEmit` clean, 114 browser tests green, ~15k lines TS.
Every item below was verified against source. IDs are stable; tick the work order as items land.

---

## Work order

### 1. One-liners (big win per character changed) — done 2026-09-19, branch `improvements`
- [x] **G3** — post FX target to `HalfFloatType`, kills sky/shadow banding — `render/postfx.ts:38`
- [x] **G4** — `antialias: false` on the canvas, MSAA already runs on the target — `render/index.ts:30`
- [x] **F1** — accumulate `_fireT` instead of resetting, fixes frame-rate-bound rate of fire — `weapons/gun.ts:274,313`
- [x] **F2** — friction to `Math.exp(-k*dt)`, frame-rate independent — `player/movement.ts:116`
- [x] **F6** — clamp mouse delta instead of dropping it, keeps fast flicks — `input.ts:135`
- [x] **N5** — call `net.leave()` unconditionally on dispose, stops the Peer leak — `boot.ts:358,486`
- [x] **P5 (focus rounding)** — write `--focus` with `toFixed(1)` so the store dedupe fires — `store.ts:346`

### 2. Fairness (closes cheat vectors, small diffs) — done 2026-09-19
- [x] **N1** — clamp victim-reported `pdmg` to `GUN_STATS[src]`, drop unknown `src` — `ffa.ts:510-519`
- [x] **N2** — host ignores a repeat `pdead` from the same peer within `RESPAWN` — `ffa.ts:529-542`
- [x] **N6** — proximity check (`< 3 m`) on `take` — `ffa.ts:502-504`

### 3. Performance — done 2026-09-19 (G1 merge-by-material stretch skipped: named-node keep-list makes it marginal)
- [x] **P1** — DDA raycast over the existing spatial hash + boolean `raycastHit()` — `physics.ts:224-254`
- [x] **G1 + G2** — merge tactical geometry per `kind/part` at load; skip the legacy primitive body when `o.tactical` — `render/tactical.ts:56-61`, `render/figure.ts:456-471`
- [x] **P2** — per-frame path budget on `EnemyManager`, cap `findCover` at 3 — `nav.ts:190`, `ai.ts:74,96-98,235-249`

### 4. Feel
- [ ] **F3** — rebalance R4-C (450 DPS vs 293 next best) — `weapons/stats.ts:68-69`
- [ ] **F4** — derive ADS sensitivity from `adsFov` — `player/index.ts:206-207`
- [ ] **F5** — patterned recoil from shots fired, 30 % noise — `weapons/gun.ts:296`
- [ ] **F7** — radial gamepad deadzone — `input.ts:40`
- [ ] **F8** — endless scaling past wave 30 (`mods`, double `MODS` roll) — `game/solo.ts:75-76,171,177`

### 5. Cleanup
- [ ] Dead code: `AIR_JUMPS`/`airJumps` (5 places + README), `mergeByMaterial`, unused `PS_FLAG`, `revolver`
- [ ] Constants: gravity 26/24/20, stand height 1.75 ×4, eye 1.6 ×3, jump 9.6 ×2
- [ ] Duplicated charge attack ×3 and LOS ×4 into one helper each
- [ ] `docs/ARCHITECTURE.md` contradicts the repo ("No TypeScript, no bundler, `src/main.js`")

---

## 1. Graphics

| ID | Where | Problem | Smallest fix |
|---|---|---|---|
| G1 | `render/tactical.ts:56-61` | Every enemy spawn does `template.clone(true)` + `geometry.clone()` per mesh. Each figure is 25-59 primitives (~15k verts) → GPU upload hitch per spawn and ~50 draw calls ×2 (shadow pass). 20 enemies ≈ 2000 draws. | At `loadTacticalModels`, `mergeGeometries` per `${kind}/${part}` by material once; share geometry, skip dispose on `userData.shared`. |
| G2 | `render/figure.ts:456-471` | When `o.tactical` is set (always for enemies) the legacy primitive body (`face()`, `oval()`, limbs, ~40-70 geometries) is still built then `release()`d. | `if (!o.tactical)` around the mesh builders; keep pivots only. |
| G3 | `render/postfx.ts:38` | `UnsignedByteType` + `LinearSRGBColorSpace` target → 8-bit linear storage, visible banding on sky and shadowed walls. | `type: THREE.HalfFloatType`. One line. |
| G4 | `render/index.ts:30` | `antialias: true` on the canvas while all rendering goes to the MSAA target (`postfx.ts:41`). Wasted resolve + memory per frame. | `antialias: false`. |
| G5 | `render/index.ts:84-96`, `level/build.ts:66` | One 2048 shadow map covers a 126-156 m ortho box ≈ 13 texels/m. Blurry. `shadow.needsUpdate` at `:95` is a no-op with `autoUpdate`. | Per frame: ortho extent ~35 m around the player, snap target to texel grid. ~4× sharper, same cost. |
| G6 | GLB materials | Parts use `MeshStandardMaterial` (metalness 0.55) with no `scene.environment` → metal renders near-black and clashes with the toon ramp. | Swap to `charMat(hex)` at load, or one `PMREMGenerator.fromScene(RoomEnvironment)`. |
| G7 | `render/index.ts:127` | `rig.traverse(_prepareRigMesh)` every frame over ~60 view-model meshes to set flags that never change. | Run once on attach. |

Nice to have:
- `figure.ts:285-343`, `weapons/models.ts:118-133`: r4c prop = 17 meshes, handguard = 24 rail boxes. Merge rigid parts; keep `mag/slide/bolt/hands` separate.
- `materials.ts:67-93` `mergeByMaterial` is dead; `build.ts:224-233` keeps unused `uv`. Delete one, strip the other.
- `render/index.ts:38` `scene.background` forces a second clear the sky dome always covers.
- `render/index.ts:137-146` `paintSky` allocates a new `BufferAttribute` per `setMood`; old GL buffer leaks until context loss.
- `effects.ts:270` decals sit 12-30 mm off surfaces → z-fight at distance. Use `polygonOffset` on a decal material.
- `enemies/model.ts:81-92`, `enemies/index.ts:299`: `getObjectByName` per enemy per frame. Cache on spawn.

---

## 2. CPU performance

| ID | Where | Problem | Smallest fix |
|---|---|---|---|
| P1 | `physics.ts:224-254` | `World.raycast` is a linear scan over every box; the spatial hash (`#hash`, used by `query`) is never used for rays. Allocates 2 `Vector3` per hit; `lineOfSight` pays that for a boolean. Callers per frame: up to 240 projectiles, flyers ×2, strafing ranged ×2, medic per ally (unthrottled, `specials.ts:17-21`), and every decal-colliding blood particle (`effects.ts:251`, pool 700). Largest CPU line. | 2D DDA over the 8 m hash cells with the stamp dedupe `query` already has; add a boolean `raycastHit()` variant. |
| P2 | `nav.ts:190`, `ai.ts:74,96-98,235-249`, `specials.ts:89-93` | `findPath` has no per-frame budget (`maxExpand` 40000). `stuckT` resets `pathT` so a group at one wall re-paths in lockstep; `findCover` runs up to 12 searches in one call; carrier one per perch synchronously. Allocates closure + heap item + `Vector3` per node. | `pathBudget` counter on `EnemyManager`, reset per `update`; skip search when spent. Cap `findCover` at 3. |
| P3 | `effects.ts:198,222,225` | `splice(i,1)` in reverse loops over ~1300 particles (O(n²)); `pos.clone()/vel.clone()/randomVector()` = 3 allocs per particle, `boom()` spawns 142. | Swap-remove; pool the vectors. |
| P4 | `boot.ts:447`, `ffa.ts:306` | 5 slot objects + template strings built every frame then rejected by the store; remotes Map spread every frame. | Call `setSlots` on weapon/ammo change only. |
| P5 | `globals.css:35,100,105,148`, `store.ts:346,296` | Crosshair `top/left` and health/boss/focus `width/height` animated → layout per frame. `--focus` written unrounded so the dedupe never fires; `aria-valuenow` set unconditionally. | `transform: translate/scaleX`; `toFixed(1)`; guard the attribute write. |
| P6 | `player/camera.ts:63-69`, `grenades.ts:165` | 6 `rand()` calls per frame with shake 0; 70 raycasts/frame while charging a grenade. | Guard on `shake > 0`; step 1/20 × 45. |

---

## 3. Gameplay / game feel

| ID | Where | Problem | Smallest fix |
|---|---|---|---|
| F1 | `weapons/gun.ts:274,313` | `_fireT -= dt; _fireT = fireInterval` drops the residual → rate of fire is frame-rate bound. R4-C 80 ms fires every 5 frames @60 Hz (83 ms), every 3 @30 Hz (100 ms): 20 % DPS loss on slow machines. | `_fireT += fireInterval` in `_fire`, clamp at `-dt`. |
| F2 | `player/movement.ts:116` | Friction `1 - 8*dt` is not frame-rate independent (0.6 at the 50 ms clamp vs 0.93 @120 Hz). | `Math.exp(-k * dt)`. |
| F3 | `weapons/stats.ts:68-69` | R4-C = 36 dmg / 0.08 s = 450 DPS vs MP5 293, pistol 222, shotgun 243, sniper 176, plus 2.5× head and 55 % at 88 m. It dominates. | `damage: 28` or `fireInterval: 0.095`. |
| F4 | `player/index.ts:206-207` | ADS sensitivity is hardcoded 0.38/0.62, ignores `adsFov`. Holo (82°, same as hip) gets 0.62 → sluggish. | `tan(adsFov/2)/tan(hipFov/2)` × user scale. |
| F5 | `weapons/gun.ts:296` area | Recoil is pure noise (`rand(-k,k)` yaw). Nothing to learn, auto fire reads as jitter. | Index `magSize - mag` into `sin(i*0.9)*k` for yaw, keep 30 % noise. |
| F6 | `input.ts:135` | `\|movementX\| <= 400 ? x : 0` drops fast flicks entirely (1600 DPI @125 Hz exceeds 400 easily). | `clamp(x, -400, 400)` or raise the cap. |
| F7 | `input.ts:40` | Square per-axis deadzone → notchy diagonals on pad. | Radial deadzone on `hypot(x,y)`. `gamepad.test.ts:102` needs one number. |
| F8 | `game/solo.ts:75-76,171,177` | Endless goes flat: `maxAlive` caps at wave 15, `count` at 14, spawn interval at 12; only bosses gain HP (+35 %/15 waves); last mutation is wave 46. | Scale `mods.damage/speed` by `1 + 0.03*(n-30)` capped ~1.6; roll two `MODS` past 30. |
| F9 | `weapons/gun.ts:246-250` | Auto-reload is `window.setTimeout(250)` → fires during pause and hitstop. `weapons.test.ts:395` enshrines "starts while holstered". | Countdown in `animate`; deletes `_cancelAutoReload` and the dispose override. |
| F10 | `input.ts:311-317` | Pointer-lock retry loops forever without a gesture (raw → non-raw → 1.2 s timer → repeat, SecurityError spam). | Retry from the next `mousedown` only. |

Nice to have:
- `game/solo.ts:138` boss fallback spawn clamps to `±44` hardcoded; Mexico bounds are `±62`. Use `level.bounds`.
- `enemies/ai.ts:285-294` hit reaction exists only for rifle/blade; shotgun, sniper, specials ignore being shot. Give sniper a `wantCover` roll.
- `enemies/boss.ts:151-153` Lagspike hops with no ledge probe → can award itself "FELL OFF THE MAP". Reuse the probe at `ai.ts:389`.
- `expansion-boss.ts:104` ragequit LOS ignores smoke; smoker cannot hide you from it. Inconsistent with `ai.ts:302-305`.
- `movement.ts:135` fixed jump height; one line for variable jump (`released('jump') && v.y > 4 → v.y *= 0.55`).
- `gun.ts:83` one ADS damp (14) for every gun; sniper raises as fast as pistol.
- `types.ts:47-56` `lunge, reach, standoff, fuseRange, fuseTime, blastRadius, aimUp` are declared and never read; the values are literals in `ai.ts:147,153,203,314-315`. Tuning the table does nothing. Delete the fields or read them.

---

## 4. Networking / fairness

| ID | Where | Problem | Smallest fix |
|---|---|---|---|
| N1 | `ffa.ts:510-519` | `pdmg` is victim-trusted; only cap is `<= 100000`. `src` is on the wire and `GUN_STATS[src].pvp` exists. | Clamp to `pvp[0]*pvp[1]*pellets`; drop unknown `src`. Same for `nade` vel at `:544`. |
| N2 | `ffa.ts:529-542` | `pdead {killer}` is victim-authored and unthrottled; host tallies blindly → any client can end the match. | Host ignores a second `pdead` from the same peer within `RESPAWN`. |
| N3 | `ffa.ts:314` | `ps` sent on `tick % 3` → 48 pkt/s @144 Hz, 10 @30 fps. Host relays ×(N-2). | Accumulate `dt`, send at ≥ 50 ms. |
| N4 | `net.ts:426` | `reliable: true` for state packets → head-of-line blocking on loss → extrapolate 350 ms then snap. | Second connection `label:'ps', reliable:false` for `ps`/`shots`. |
| N5 | `boot.ts:358,486` | `net.leave()` guarded by `net.active`, which is false mid-`host()/join()`. Dispose during connect leaks the Peer; the pending promise then mutates a disposed engine. | Call `leave()` unconditionally (it is idempotent). |
| N6 | `ffa.ts:502-504` | `take` has no proximity check. | Require `< 3 m` from `remotes.get(from).body.pos`. |
| N7 | `players.ts:222,263` | Two-snapshot interpolator; 80 ms delay @20 Hz = 1.6 packets of buffer. | Keep 3, bracket `tt`. |

---

## 5. Code readability

- **Duplicated logic**: charge attack ×3 (`boss.ts:113-138`, `expansion-boss.ts:121-159`, `specials.ts:41-67`); LOS ×4; `stop()` ×2 (`ai.ts:20`, `boss.ts:23`); rest-pose loop ×3 (`gun.ts:166,271,353`); `ps` validators ×2 (`net.ts:72`, `players.ts:66`); `cleanName` ×3; ffa handlers re-check what `net.validPayload` proved.
- **Magic numbers**: gravity 26 / 24 / 20 across `player/index.ts:167`, `movement.ts:183`, `enemies/index.ts:280`, `flyer.ts:24`; stand height 1.75 ×4, eye 1.6 ×3, jump 9.6 ×2. One `const` block each.
- **Dead code**: `AIR_JUMPS = 0` + double-jump branch and `airJumps` in 5 places (README still lists double jump); `mergeByMaterial`; `PS_FLAG` table at `types.ts:380` unused by the encoder; `revolver` in `GUN_STATS` but not in loadout.
- **Density**: 43 lines > 160 chars, 17 > 200. `solo.ts`, `boot.ts:resetRun` pack 6-10 statements per line. Tests pass, but 3 am readability is poor. A prettier pass with `printWidth: 120` costs nothing.
- **Side effect in a getter**: `ui.ts:44-47` `models.dead()` writes `settings.best` + localStorage, so `redraw()` persists.
- **Stringly typed**: `ffa.ts:133-141` errors matched by `.includes('timed out')`; `ui.ts:54-63` 8-arm identical switch; `Melee` fakes ammo (`mag = Infinity`, `melee.ts:52-66`).
- **`EnemyRecord`** (`enemies/index.ts:46-127`) ~70 fields, mostly type-specific. Fine now; note before the next 5 enemy types.
- `docs/ARCHITECTURE.md` still says "No TypeScript, no bundler, `src/main.js`" — it contradicts the repo.

---

## 6. Test gaps

No test covers:
- `follow/steer` against a wall or step (`ai.ts:92-101`)
- `findCover`
- `_separate`
- wave composition (`solo.ts:78-92`)
- DDA raycast vs brute force (needed if P1 lands)
- frame-rate independence of F1/F2 (one test at dt=1/30 vs 1/120 catches both)

---

## How to verify

```sh
npm run typecheck && npm test   # tsc --noEmit, then 114 browser tests (vitest run)
npm run build                   # next build
npm run dev                     # needed before smoke
npm run smoke                   # node tests/smoke.mjs, hits the dev server
```

Targeted check scripts (`node tests/<name>.check.mjs`):
`bugfix` (also `npm run check`), `expansion`, `model-rework`, `optic-colors`, `training`, `visual`, `weapon-rehaul`.

Graphics items (G1-G7) have no automated coverage — verify by eye plus a frame-time read.

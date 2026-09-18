# Endless enemy expansion

This extends the original enemy and wave specifications. The three arena layouts,
collision boxes, stairs and navigation geometry are unchanged. Existing run
modifiers and boss-health scaling remain in place.

## Roster

| Wave | Type | Behaviour / counter | Live cap |
|---|---|---|---|
| 7 | MEDIC | Heals one visible injured ally at 15 HP/s within 12 m; never another medic. Takes cover when hit. Kill or yank it away. | 2 |
| 9 | BREACHER | Shield and shotgun; 0.65 s warning before a straight charge. Parry stuns it for 1.3 s. Dodge, flank or grenade. | 2 |
| 12 | TURRET DROP | Carries a sentry to a reachable sniper marker. After delivery, becomes an ordinary attack drone. Destroy the carrier to prevent delivery. | 2 carried/deployed sentries combined |
| — | SENTRY | Fixed position and 90-degree firing arc, drawn on the floor. Flank or destroy it. | Shared above |
| 14 | PACK LEADER | One-second horn warning, then nearby rushers gain 40% speed for 3.5 s. Death cancels their attacks and causes a two-second retreat. | 1 |
| 17 | SMOKER | Throws a smoke grenade. Smoke blocks enemy aim too; shots and warning effects remain separate. Blasts clear clouds. | 2 clouds, including grenades in flight |
| 19 | PARRY MAIN | Visible 1.1 s frontal guard stance. Reflects gunfire, at most once per 0.2 s. Flanks, melee, grenades and recovery remain vulnerable. | Wave population cap |
| 22 | THE RUBBERBANDER | Marks a reachable destination for 0.65 s, then dashes with collision checks. Four-second cooldown and a firing recovery. | Wave population cap |
| 27 | SAPPER | Plants a shootable 20 HP charge on nearby occupied crate/barrel cover. Three-second fuse. | 1 sapper / 1 charge |

Sapper draws require a map with crate/barrel breakables (currently Mexico).
It can destroy at most three cover props per run. When no cover is eligible,
it uses its pistol. Shooting the charge cancels the demolition. No permanent
map edits occur; the existing run-reset rebuild restores broken props.

The dealer searches the queue once, skips capped types, and leaves blocked
draws queued until capacity becomes available. An entirely blocked queue waits;
it does not loop or exceed caps. Training/debug spawns deliberately bypass the
dealer to display every model.

## Boss rotation

ADMIN (5), HITBOX (10), LAG SPIKE (15), AIMBOT (20), RAGEQUIT (25),
MODERATOR (30), then repeat every 30 waves.

### AIMBOT

Stationary sniper: tracks for 0.7 s, locks for 0.3 s, then fires two shots 0.25 s
apart at the locked point. Shots collide with cover and can be deflected. Its
cooling core opens for 2.5 s after the volley, with increased critical damage.
Attempts a capped carrier launch every 12 s.

`Level.bossPerch` contains an authored position and walking route. Validation
uses player collision physics without jumping or grappling, ground support,
AIMBOT clearance, and nav endpoints at the correct elevation.

| Map | Marker | Result |
|---|---|---|
| Downtown | `(0, 16, -3)` | Existing tower stair route passes. |
| Mexico | `(-40, 6.35, -20)` | Existing northwest-house stairs pass. |
| House | `(0, 13.52, 1.3)` | No walking roof entrance. Use ADMIN instead. |

Invalid or missing markers select ADMIN before the announcement/spawn. No roof,
stair or platform is generated to make the boss fit.

### RAGEQUIT

Melee only, 4500 base HP. Every three seconds without taking damage adds 20%
base movement speed, capped at 1.8x. A parry clears all stacks and stuns it for
two seconds. Its 0.65 s warning locks the charge direction. A miss or collision
leaves 0.8 s recovery, so a parry is useful but not mandatory.

### MODERATOR

Flying arena-control boss. A successful cast opens a two-second yank window.
Other bosses still reject yanks. Pulling it down exposes its head; its ground
stun lasts 1.3 s after landing.

Ban zones: at most three including countdowns, 5 m radius, centres at least 8 m
apart and at least 4 m from each living player. Three-second countdown, then
8 s active life at 30 damage/s (normal damage modifier applies). Damage is
batched to avoid hurt audio and rumble every frame. Zones disappear on owner
death. Placement must preserve a reachable escape outside the danger zones;
otherwise the cast is skipped. Tests also cover walls and blocked exits.

## Mutations

Mutations are announced on **31, 36, 41, 46**, never on a boss wave. They affect
live and future actors, persist for the run, and do not alter catalogue objects.
A visible marker identifies mutated actors. Clearing the run removes mutations.

1. Recruits: five-shot bursts (instead of three), with longer recovery.
2. Rushers: opposite-side paired approaches.
3. Drones: carry a bomb into each dive. Killing a loaded drone detonates the bomb
   against nearby enemies; delivered bombs use the existing deflectable projectile path.
4. Shields: nearby recruits follow behind them as mobile cover.

After all four are active, the existing endless scaling continues. No elite
roll, stacked wave modifiers or double-boss system is added.

## Models and checks

All 22 actor types use the existing Blender build pipeline and rigid animation
pivots. New equipment, masks, guard/vent/yank cues and sentry arc distinguish the
new types. The training range displays all targets in rows on its existing floor;
its collision geometry is unchanged.

```sh
blender -b --python assets/models/build_tactical.py
npm run typecheck
npm test
npm run build
node tests/expansion.check.mjs http://localhost:3100
node tests/model-rework.check.mjs http://localhost:3100
node tests/training.check.mjs http://localhost:3100
```

Map hash regression tests remain unchanged. `boss-perches.test.ts` exercises
actual stair walking, invalid metadata, blockers, and unsupported positions.
`expansion.test.ts` and `expansion-boss.test.ts` cover counters, spawn caps,
mutation timing, resource cleanup, boss phases and passive training.

# The .50 pistol

This change replaces the pistol's stats in [Combat rehaul](combat-rehaul.md) and [Weapons](weapons.md). Its kind stays `pistol`, and its loadout id on the wire is unchanged. Runtime constants are in `src/engine/weapons/stats.ts`.

## Role

The pistol is a heavy .50 hand cannon with a high skill ceiling. If every semi-auto shot lands, it has the fastest body-shot kill in the game. It hits harder still off the ground or on the first shot after the draw.

## Stats

| | Before | Now |
|---|---|---|
| Name in the HUD | PISTOL | .50 PISTOL |
| Magazine / starting / max reserve | 15 / 90 / 180 | 9 / 72 / 144 |
| Fire interval | 0.18 s | 0.13 s |
| Draw | 0.2 s | 0.12 s |
| PvP damage (body, head ×) | 32, ×2 | 37, ×2 |
| Spread kick / max | 0.006 / 0.035 | 0.009 / 0.045 |
| Camera kick (pitch, yaw) | 0.014, 0.003 | 0.02, 0.005 |
| Model kick | 0.15, 0.3, 1.8, −4, 0.4, 0.7 | 0.2, 0.45, 2.6, −6.5, 0.6, 1.1 |
| FOV kick / flash / tracer / casing | 1 / 0.9 / 0.018 / 0.018 | 1.6 / 1.3 / 0.024 / 0.024 |

These stay the same: PvE damage 40 (head × 2.6), falloff 12–40 m to 35 %, reload 1.0 s, hip and aim spread, move spread, ADS FOV 62° and ADS speed 0.95.

Shots to kill a player (110 HP): 3 body shots in 0.26 s, or 2 headshots. Before, it was 4 body shots in 0.54 s.

## Bonuses

Each gun now has `airBonus` and `quickdraw`. On every gun except the pistol they are 1 and null.

- **Air shot (`airBonus` 1.25):** a shot fired while airborne, sliding or on the grapple deals × 1.25 against enemies, players and breakables.
- **Quickdraw (`quickdraw` [0.5, 1.4]):** the first shot within 0.5 s of drawing the gun deals × 1.4. Any shot spends it, and the next draw restores it.
- The bonuses do not stack: a shot takes the larger one. So no PvP hit kills a full-health player at once. The best case, a quickdraw headshot, deals 103.6.
- A bonus shot flashes 30 % bigger and kicks 30 % harder, so the player can see it happen.
- `pdmg` caps a source at its best bonus: pistol 37 × 2 × 1.4 = 103.6.

Against enemies (grunt, 100 HP), either bonus makes it a 2-body-shot kill, down from 3.

## Look and sound

- **Low tier:** a code-built .50 with a tall slab slide over a full-length barrel, a top rib, a squared muzzle face, rear slide serrations, a hammer, a wide grip, a big magazine baseplate and a squared trigger guard. Its sights sit on the slide's top line (`sight` [0, 0.19, −0.37], eye 0.5 m back), and its hip pose is [0.2, −0.18, −0.42].
- **Realistic tiers:** the Blender pistol (`tools/blender/weapons/pistol.py`) is rebuilt as an original large-frame .50 semi-auto, with no real product's markings.
- The third-person flat prop has the same slab-slide shape.
- `pistolFire` is a hard crack over a deep, short boom.

## Checks

`npm test` covers the stats, the shots to kill and the bonuses. With a local server running, `node tests/pistol.shots.mjs URL [dir] [preset]` takes screenshots at the hip, on a shot and aimed.

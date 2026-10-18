# Sword, loadouts and weapon handling

This change replaces the always-available combat knife, the fixed six-gun loadout and the related wire fields in [Combat rehaul](combat-rehaul.md) and the older subsystem specifications. Unchanged mechanics still follow those specifications. Runtime constants are in `src/engine/weapons/stats.ts`, `sword.ts` and `wave.ts`.

## Loadouts

- `WEAPON_KINDS` lists every weapon a player can carry, in this order: R4-C, MP5 (`rifle`), shotgun, sniper, pistol, LMG, sword. The order only grows at the end, because a weapon's index is its id on the wire. The revolver stays defined and is not offered.
- A loadout is **three different weapons** (`LOADOUT_SIZE`). The sword counts as one of the three. The default is R4-C, pistol, sword. The pick order is the slot order: keys **1–3**, the wheel and controller next/previous cycle the three. Keys 4–6 do nothing.
- The **Weapons** page (main menu, pause menu, online menu and lobby) shows a card for each weapon: its name, its role and its speed. A tap on a card adds it to the next free slot; a tap on a picked card drops it. When three are picked, the other cards are disabled. A full pick is saved at once in `cs6_loadout` (comma-separated kinds). An invalid stored value gives the default.
- When the player gets the new pick:
  - Every run or match start (`resetRun`) gives the saved pick.
  - **Solo and co-op:** between waves (`intermission > 0`). A pick made during a wave waits for the wave clear, and the HUD shows "loadout updated" when it applies.
  - **Online PvP (FFA, TDM, flag):** only at the start of a match. A pick made during a match is saved for the next match.
  - **Training:** at once.
  - The Weapons page shows which of these applies now.
- A weapon kept in the new loadout keeps its ammunition; a weapon new to it starts full. Each player keeps the weapons it has built (its armoury), so a swap back costs nothing.

## Weapon handling

The weapon **in hand** sets its carrier's movement (`Handling`):

| Weapon | moveSpeed | Walk / sprint (m/s) | mobility |
|---|---|---|---|
| Sword | 1.15 | 7.59 / 12.19 | 1 |
| Pistol | 1.08 | 7.13 / 11.45 | 1 |
| MP5 | 1.05 | 6.93 / 11.13 | 1 |
| Shotgun | 1.00 | 6.6 / 10.6 | 1 |
| R4-C | 0.95 | 6.27 / 10.07 | 1 |
| Sniper | 0.90 | 5.94 / 9.54 | 1 |
| LMG | 0.82 | 5.41 / 8.69 | 0.9 |

- `moveSpeed` multiplies the ground speed cap (crouch 3.6, sprint 10.6, walk 6.6 × `adsSpeed` while aiming) and the air speed cap (7.5).
- `mobility` multiplies the jump speed and the slide's entry boost. Only the LMG is below 1.
- The existing `adsSpeed` slowdown and draw times still apply on top. The revolver has 1.05 / 1.

## The sword

The sword is a loadout weapon. It has no ammunition (the HUD shows ∞) and no aim zoom.

- **Slash:** fire slashes; held fire chains slashes. A slash takes 0.32 s, and the next can start 0.4 s after the last one started. The hit test runs 40 % through the slash: reach 2.6 m, half-angle 0.9 rad, line of sight required. It deals 80 to enemies, 60 to other players (two hits down a 110 HP player), 80 to breakables, and it cuts ropes within 2.9 m. A grounded slash steps 1.6 forward; a sprinting or airborne slash lunges 3.5. Firing with the sword does not drop the sprint.
- **Guard:** held aim raises the guard while no slash is under way. Walk speed while guarding is × 0.85. The guard keeps the old knife's deflect and parry rules: a block in its first 0.26 s is perfect and always returns the bolt; a later one returns 35 % of bolts; enemy melee is parried in the first 0.55 s.
- **Quick slash:** the melee control (F, V, mouse forward, RB/R1) draws the sword and slashes at once. Without a sword in the loadout it does nothing. The focus dash and its executions use the same quick slash, so they need a sword. Sword kills and air-slash kills feed the focus streak.
- **Bullet cut:** from 0.04 s to 0.22 s into each slash, the blade cuts enemy bolts that reach it from the front (within 0.55 of the view direction). The catch radius is 1.2, against 0.95 for the guard. A cut bolt is always sent back as a perfect parry (score label BULLET CUT). One slash can cut any number of bolts, with no block cooldown between them.
- **Bullet cut in PvP:** a player's state packet sets bit **1024** while its slash cuts, plus a grace of 0.08 s for the 80 ms a peer draws it late. A shooter's ray that meets a 0.6 m sphere ahead of that player's chest is blocked like a shot into a guard (0.42 m). 40 % of blocked shots return at 60 % damage, as before.

## Air slash

A slash that starts off the ground also throws a wave (`wave.ts`), at most once every 1.5 s.

- The wave leaves 0.6 m ahead of the eye, 0.15 m below it, along the view. It flies at 30 m/s for up to **12 m** and stops at a wall.
- Each step, it cuts every enemy, player and breakable whose centre is within 1.2 m (plus half the step) of the step's midpoint, with line of sight. Each target is cut once. It deals 45 to enemies (damage source `wave`, a slash for gore and kill feed), 35 to players, and 45 to breakables. Enemy bolts within the same radius are destroyed.
- A raised guard facing the thrower blocks an air slash in PvP.
- In solo, an air-slash kill scores +60 and the label AIR SLASH.
- The look: a tapered crescent facing along its flight, tilted to the slash's side, additive, growing from 0.8 to 1.2 × and fading as it flies. It looks the same on every quality tier.

## Network changes

- Field 5 of the player state packet is now the **id of the weapon in hand**, its index in `WEAPON_KINDS` (0–6). Unknown ids show the R4-C. Remote figures hold the `blade` prop for id 6.
- Bit **512** now means "a sword slash is under way" and counts only with id 6. Bit **1024** means "the slash cuts bullets". Valid flags are 0–2047. A remote figure swings its arms while bit 512 is set, and a worn operator plays its melee clip at the slash's progress.
- Damage source `melee` is the sword (kill feed "sword"); `wave` is the air slash (kill feed "air slash"). `pdmg` caps them at 60 and 35.
- A first-person spectator copies the watched player's weapon **kind**, not its slot. If the spectator's own loadout lacks that kind, the view borrows one from the armoury, and gives it back when the view ends.

## Models

- **Low tier:** a code-built sword (`makeSwordModel`): a 0.67 m blade with a dark spine, a square guard and a wrapped two-hand grip in both fists.
- **Realistic tiers:** the Blender sword set (`tools/blender/weapons/sword.py`): a 0.66 m curved single-edged blade with a blackened flat and a bright honed edge, a dark tsuba-like guard, a paracord-wrapped two-hand grip with the blue spacer, and the clips `slash`, `slash-back`, `guard` and `equip`. It replaces the knife set, and the enemies' `blade` prop is made from it. Blood smears are laid along both blades.
- **The slash pose:** the blade tip sweeps over the top of a cone ahead of the eye, from the starting side to the far side, with the edge leading. The hands cross low in front, so the arms, which run back along the grip, stay low and behind. Slashes alternate sides.
- **The slash smear** (`slash-trail.ts`, replacing the old knife's dashed arc) is a ribbon in the view-model rig. During the sweep (12 % to 75 % of the slash) it samples the blade every frame, from its tip to 45 % of the way down. Each sample lives 0.13 s. The ribbon is additive, bright at the newest edge and the tip, and it thins towards the blade as it fades, so it reads as a tapering crescent like the air slash's. It looks the same on every tier.

## Checks

`npm test` covers loadout rules, handling, the sword, the air slash range and bullet cutting. With a local server running: `node tests/loadout.check.mjs URL` checks when picks apply in solo and training, and `node tests/sword.shots.mjs URL [dir] [preset]` takes the menu and sword screenshots.

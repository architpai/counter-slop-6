# Samurai execution

This change replaces the focus slash ([Game loop §15](game-loop.md), the `focus` rows of its game-state table) and the sword gauge rules in [Sword, loadouts and weapon handling](sword-loadouts.md). Runtime constants are in `src/engine/game/execution.ts`.

## The gauge

- The SWORD gauge on the left of the HUD fills one third for each sword or air-slash kill. A perfect guard block or a bullet cut adds a quarter of a third (`CHARGE_PARRY`, via `GameHooks.charge`).
- It keeps between kills. A gun kill no longer resets it. It is full at 3 (`CHARGE_FULL`), and when it fills the HUD says "EXECUTE READY · hold <focus key>".
- A run's reset empties it, and an execution spends it. It only fills while the loadout has a sword. The gauge is stored in `gs.katanaStreak`, which now counts thirds and is no longer a streak.

## Start

When the gauge is full, the player is alive and the loadout has a sword, the player can start by holding **both attack buttons** (RMB + LMB; L2 + R2) or the dash key, pressed this frame.

- The sword is drawn.
- The world slows to `EXEC_SLOW` (0.2) through the existing time scale, and the slow-motion grade comes on.
- The player stands still but can still look, and nothing hurts or pushes them (`Player.executing`) until the execution ends.

## Marking

- Every enemy that is alive, has finished spawning, is within 25 m (plus 1.2 m for a boss), in front of the player (cos ≥ 0.2) and in line of sight gets a marker: white corner brackets.
- When the crosshair is within an enemy's angular size (0.75 m, or 1.6 m for a boss, but never less than 0.045 rad), it locks that enemy. The marker turns red, shows its number, and plays a rising tick. Up to 3 can be locked. Enemies in a line can lock in one sweep.
- Marking ends when the buttons are released, the 3rd target locks, or 3 s of real time pass (`MARK_TIME`).
- If nothing is locked, the execution is cancelled and the gauge stays full ("no target marked").

## The route

`planRoute` tries every order of the locked targets (at most 6) and keeps the shortest total distance from the player. It skips orders in which a leg between two targets has no line of sight. If no order is clear, the nearest target goes first.

## The dash

- The player dashes each leg at 46 m/s, in real time, stepping up over low obstacles as the old focus dash did.
- On reaching a target (within 1.5 m) the player **cuts** it: the blade swings (`Sword.forceSlash`, which hits nothing itself), a slash line crosses the target, and sparks and a hit sound play. The target is not hurt yet.
- A leg is skipped if its target is already dead, if it takes more than 1.2 s, or if the dash is stuck.

## The sheathe

- 0.45 s after the last cut (`FINISH_DELAY`), the sheathe sound plays. Every cut target then falls at once: damage source `focus`, a head critical, 100000 damage, or a quarter of the maximum health for a boss.
- Each kill scores "EXECUTED" +150. An execution is never labelled AIRBORNE, and it does not refill the gauge.
- The player heals 6 for each target. The gauge empties, the time scale returns, and the player can move and be hurt again.

## Modes

Solo, training and **co-op**. In co-op only the executing player's own view and movement slow down: the host's enemies keep running at full speed. Cut targets are hurt through the normal co-op hit message, which caps one hit at 1000. PvP modes have no execution, and they keep the grapple-breath meter in the gauge's place.

## Checks

`tests/execution.test.ts` covers the route, the gauge, marking, the dash, the delayed kills and the cancel paths. With a local server running, `node tests/execution.shots.mjs URL [dir] [preset]` steps an execution in training and takes screenshots.

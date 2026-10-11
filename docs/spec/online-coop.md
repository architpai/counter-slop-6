# Online co-op survival

This change adds a fourth online mode. It extends [Game loop](game-loop.md), [Networking](networking.md), [Enemies](enemies.md) section 17, and [Online team modes](online-team-modes.md). It replaces their statements that online play has no enemies. Solo survival, training, Solo Deathmatch, Team Deathmatch, and Flag Hold do not change.

All times are seconds. All scale values are initial playtest values, not measured balance results. Runtime rules are in `src/engine/game/coop-rules.ts`. Runtime orchestration is in `src/engine/game/coop.ts`.

## 1. Mode

| Mode | Players | Objective | End |
|---|---|---|---|
| Co-op Survival (`coop`) | 1 to 4, one team | Clear the solo waves together | All players are down in the same wave |

- The online screen and a private lobby list the mode with the other three. Public discovery uses `COP0..7`.
- A co-op lobby accepts a maximum of four players. The host refuses a fifth with "that lobby is full". A host cannot start co-op with more than four players in the lobby.
- One player can start a run. Anyone in the lobby can start it.
- There are no teams, no friendly fire, no rope cuts, and no match clock. Bullets and blades ignore other players.
- The run uses the solo layout of the selected map, not the arena layout. Enemy spawn points, navigation, and boss perches are tuned for the solo layout.
- Players start around the solo player start: slot 0 at the start, slots 1 to 3 at 1.6 m offsets. A slot that overlaps the world uses the start itself.
- Health, health regeneration, and pickups use the solo values (120 hp), not the PvP values.
- The run starts at the host's selected start wave. The host selects it in the lobby from the host's own checkpoints.
- The run does not pause. The online menu opens above the live game, as in the other online modes.
- Katana focus (the slow-motion dash) is off. Peers cannot share a time scale. The katana streak counts but does not start focus.

## 2. Wave scale

`p` is the number of players in the lobby at the start of the wave, limited to 1 through 4. `x = p − 1`. With `p = 1` all values equal solo.

| Value | Solo | Co-op |
|---|---|---|
| Enemies in a wave | `min(4 + 1.7n, 28)`, boss wave `min(6 + n, 14)` | solo × `(1 + 0.5x)`, rounded |
| Enemies alive together | `min(4 + floor(0.8n), 16)`, SWARM `+3` and cap 20 | solo `+ 3x`, hard cap 24 |
| Spawn interval | `max(0.7, 2.2 − 0.13n)` | solo ÷ `(1 + 0.25x)` |
| Boss health | type health × endless factor | solo × `(1 + 0.6x)` |
| Normal enemy health | type health | no change |
| Pickups at wave start | 7 (5 ammo, 2 health) | `7 + 3x`, same ratio |
| Kill drops, wave modifiers, mutations, per-type caps | as solo | no change |

- `p` is read one time, at the start of each wave. A player who leaves makes the next wave smaller. The current wave does not change.
- Normal enemy health does not change, so each gun needs the same number of hits as in solo.
- The total count increases more than the count alive together. The count alive together controls host CPU and the draw calls of each peer.
- Each spawn selects one living player at random as its anchor. Distance, "behind you" drone spawns and boss spawns use the anchor. A ground spawn point must be more than 14 m from all living players. A hidden point must be out of sight of all living players.

## 3. Run rules

### 3.1 Waves

- The host runs the solo wave director. It runs while the host player is alive or down.
- At wave start each player gets one grenade, the wave message, and the wave audio. At wave clear each living player gets +40 hp.
- The intermission is 8 s. Only the host can skip it.
- A cleared boss wave saves a checkpoint for each player in the run, if it is higher than that player's checkpoint.

### 3.2 Down and return

- A player with zero health is down. A down player does not respawn on a timer.
- A down player watches a living teammate. If no teammate is alive, the camera shows the player start.
- All down players return at the next wave clear, at their start slot, with full health and the standard loadout.
- A player who goes down during the intermission returns after 3.5 s.
- The run ends when all players in the lobby are down in the same wave. The host sends `end { id: 'coop', name: 'WAVE n' }`. The result screen shows the wave reached, the team score, and the kills and downs of each player. After 8 s all players return to the lobby.
- Enemies ignore down players.

### 3.3 Score

- There is one team score. Each peer calculates the points for its own actions with the solo rules (kill value, headshot, melee, airborne, deflect, combo). A client sends its new points to the host (`cpts`). The host adds them and sends the total in the co-op state.
- The wave-clear bonus (`200 × wave`) goes to the team score one time.
- The scoreboard shows enemy kills and downs for each player.
- Co-op does not change the solo personal best.
- Known limit: a kill by an enemy explosion has no attacker, so the host player gets the credit.

### 3.4 Join and leave

- The lobby is open in the lobby state and during each intermission. The host closes it at wave start and refuses a join with "a wave is running · try again between waves". Quick play then tries the next public lobby.
- A late join receives the map, the co-op state, the broken props, the scores, and all living enemies. The player starts at a start slot.
- A player who leaves is removed from the down list and from the next wave's scale. If all players that stay are down, the run ends.
- If the host leaves, the run ends for all players, as in the other online modes. There is no host migration.

## 4. Authority

The host owns the wave director, all enemy AI, enemy health, enemy deaths, drops, the team score, the down list, and the run result. Each peer owns its body, its health, and its weapons, as in the other online modes. The enemy code has a pseudo-random AI, so two peers cannot calculate the same result; only the host thinks.

A client runs the enemy manager as a mirror ([Enemies](enemies.md) section 17): it draws enemies from host snapshots, runs enemy projectiles, and reports its hits.

### 4.1 Damage to enemies

- On a client, a gun, blade, grenade, or deflected projectile that hits an enemy shows the local hit feedback and sends the hit to the host (`ehit`). The client does not change enemy health.
- The host applies each reported hit with the usual damage rules and the sender as the attacker. The host does not show hitmarkers, headshot kick, rumble, or hit-stop for a hit by another player.
- A hit on a shield plate is also reported. The host owns shield health; the snapshot carries it.
- A grapple yank on a client sends `eyank`. The host applies the stun and the pull.
- The host limits one reported hit to 1000 damage and ignores hits from players who are down or not in the lobby. There is no other anti-cheat, as in the other online modes.

### 4.2 Damage to players

Each peer applies enemy damage to its own player only.

| Source | Who decides | How the client gets it |
|---|---|---|
| Enemy projectiles and their blasts | Each peer, with its local copy of the projectile | Local |
| Bomber and flyer-payload explosions | Each peer, when the death arrives | Local |
| Ban rings (section 6) | Each peer, with its local copy of the ring | Local |
| Melee swings, drone dives, boss stomp, charge, and wipe | Host | `edmg`, addressed to the player |

- `edmg` carries the damage and an optional push vector. Only the host can send it. The client limits one `edmg` to 200 damage and a push of 30 m/s.
- A remote player that guards toward an enemy blocks its melee on the host. The guard has no parry window on the host.
- `pdmg`, `parry`, `headshot`, and `cut` stay PvP-only. They are refused in co-op because no player is an opponent.

### 4.3 Time

The host and the mirrors update enemies with real frame time. Hit-stop slows only the local player and local effects.

## 5. Protocol

The namespace advances to v3. Old builds cannot join.

`lobby` and `start` accept `mode: 'coop'`. A co-op `start` carries `coop` (the co-op state) and no `teams` or `teamState`. `end` accepts `id: 'coop'`.

| Message | Direction | Payload |
|---|---|---|
| `coop` | host → all | `{ wave, left, inter, score, dead, label, sub, speed, damage }` |
| `espawn` | host → all, or one late joiner | `{ id, type, pos, hp }`; `hp` is the maximum health after the boss scale |
| `esnap` | host → all, each 0.1 s | Rows of 12 numbers: section 17.2 of [Enemies](enemies.md) plus shield health. A maximum of 64 rows for each message; more rows use more messages |
| `ekill` | host → all | `{ id, by, src, crit, dir, point, boom }`; `by` is the attacker's peer id or null; `boom` is the explosion scale for a fuse detonation, else 0 |
| `eproj` | host → all, one batch for each frame | Rows of 13 numbers: id, position, direction, speed, damage, owner id, tone, thickness, blast flag. A maximum of 48 rows for each message |
| `edmg` | host → one player | `{ amount, from, push }` |
| `ehit` | client → host, one batch for each frame | A maximum of 32 rows of `{ id, amount, part, src, crit, point, dir }` |
| `eyank` | client → host | `{ id, to }` |
| `cpts` | client → host | `{ n }`, new team points, 1 to 100000 |

- The host sends `coop` each 0.25 s while the run is live, and immediately at wave start, at wave clear, and when the down list changes.
- A client reads wave start, wave clear, and its own return from the changes between two co-op states. A wave number that increases is a wave start. `inter` that changes from zero to a positive value is a wave clear. A client that is down and not in `dead` returns.
- `dead` contains only peer ids in the lobby. `label` and `sub` are a maximum of 96 characters.
- All fields are checked before use. Host-only types are accepted only from the host. Request types are accepted only by the host and only from a player in the lobby.
- An enemy id that a client does not know is ignored in `esnap`, `ekill`, and `eproj`.

## 6. Threats that a client must see

A mirror shows each threat that can hurt its player:

| Threat | Replication |
|---|---|
| Sniper laser | The mirror builds the beam when the snapshot aim amount is 0.9 or more |
| Shield plate | Snapshot shield health; the plate drops when it is zero |
| Moderator ban ring | `ehaz { kind: 'ring', pos, owner }`; the mirror runs the countdown and hurts its own player |
| Smoke grenade | `ehaz { kind: 'smoke', from, to }`; the mirror runs the arc and the cloud |
| Smoke cleared by a blast | `ehaz { kind: 'clear', pos, radius }`, sent by the host; a client grenade clears host smoke through the `nade` replica |
| Boss attack | The snapshot carries the attack kind code, so the mirror plays the correct telegraph |

Known limits: sapper charges and turret arcs follow the host through the existing `brk` and `espawn` messages; the mirror does not show the charge countdown. The Moderator yank window is host state, so a client cannot yank the Moderator.

## 7. HUD and screens

- In a run the HUD shows the solo wave block (wave, modifier, enemies left, intermission timer), the team score, the boss bar, and the kill feed. The PvP score panel is hidden.
- The scoreboard and the online menu show the wave, the team score, and one row for each player with kills and downs.
- The lobby shows `n/4 players`, the player list, and for the host the start-wave selection.
- The result screen title is `RUN OVER`.

## 8. Lifecycle

- Start, leave, return to lobby, and main menu reset the mirror flag, the down list, the pending hit and projectile batches, and the co-op state.
- A client sets the mirror flag before the first `espawn` can arrive. Solo and training always run with the mirror flag off.
- End, leave, and level change remove all enemies, projectiles, hazards, and pickups.

## 9. Checks

Run `npm run typecheck`, `npm test`, and `npm run build`. Keep runnable checks for:

- The scale table for 1 to 4 players, and the equal-to-solo result for one player.
- Validation of each new message, malformed fields, and the maximum batch sizes.
- Mode-specific discovery (`COP0..7`) and the four-player limit.
- Host spawn → client mirror → client hit → host kill with credit to the client → drop.
- Enemy damage to a remote player through `edmg` only, with no `pdmg` between players.
- Down, spectate, return at wave clear, and run end when all players are down.
- A late join in the intermission and a refused join in a wave.
- FFA, team mode, and solo regression checks.

Run the real WebRTC smoke check with a local app server: `node tests/online-coop.check.mjs http://localhost:3000`.

Automated tests are not evidence of balance. Report real multi-player balance, different-network, and mobile-host coverage separately.

## 10. Build order

1. This specification and the team-mode check refactor (no behaviour change).
2. Mode, discovery, player limit, lobby, start, and end. A run can start with no enemies.
3. Host wave director with the scale, the co-op state, and the wave HUD on all peers.
4. Enemy replication: spawn, snapshot, kill, projectiles, hits, and damage to players.
5. Down, spectate, return, run end, team score, late join, and result screen.
6. Threats that a client must see (section 6).

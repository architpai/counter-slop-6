# Online team modes

This change extends the online game described in [Game loop](game-loop.md), [Networking](networking.md), and [HUD, audio and UI](hud-audio-ui.md). It replaces their FFA-only statements. Unchanged combat, weapons, movement, solo survival, and training follow the existing specifications.

All times are seconds. These are initial playtest values, not measured balance results. Runtime rules are in `src/engine/game/team-rules.ts`.

## 1. Online mode selection

| Mode | Players | Objective | Normal match limit |
|---|---|---|---|
| Solo Deathmatch (`ffa`) | Up to 8, no teams | First player to 20 kills | 480 s; existing kill/death ranking resolves the result |
| Team Deathmatch (`tdm`) | Red vs Blue, up to 4 per side | First team to 40 enemy kills | 480 s; highest team score wins; equal scores enter next-kill overtime |
| Flag Hold (`flag`) | Red vs Blue, up to 4 per side | Win flag-hold rounds; lead by 3 points OR reach 5 | 480 s; highest score wins; equal scores use section 4 overtime |

The online screen selects a mode before quick play or lobby creation. Code joins follow the host's mode. Quick play searches only the selected mode. The host can change mode in a private lobby. Public lobby modes stay fixed to their discovery slot. Players can leave and create another public mode without losing their name or weapon settings.

The host assigns balanced teams, with a maximum of four players per team. Team matches need at least one player per team; they do not wait for eight. Late joiners enter the smaller team. Existing players do not change teams during a match. Team kill totals and flag points are match totals: a player's departure does not remove earned team points. No classes, ability loadouts, bots, ranked play, or party system are added.

## 2. Shared team combat and respawn

- Red and Blue use distinct colours AND written team labels in the lobby, world, scoreboard, and result screen.
- Friendly fire is off for guns, melee, grenade damage, deflections, and rope cuts. Own grenade damage remains possible. Remote grenade replicas are visual only; the throwing peer sends validated enemy damage through the existing PvP path.
- Dead players spectate a living teammate. If none is alive, show the team's base while waiting.
- A continuous host-clock wave occurs every **8 s**. All dead teammates return on the next wave. The wait is zero to eight seconds; it is not eight seconds after each death.
- A full wipe does not restart the wave clock, cause an instant respawn, award bonus points, or end the round.
- Team Deathmatch credits each enemy kill normally. Flag Hold awards no objective points for kills, and an active hold continues during a wipe.
- Respawns restore the standard online health and loadout. Keep the existing 2 s spawn protection. Spawn protection ends when the player attacks or takes the flag, so it cannot protect a flag steal.
- Team spawn positions are separate from flag placement areas. A wave spreads teammates across authored spawn positions and prefers positions away from enemies.
- Players do not wait for the whole team to die. This avoids leaving three players idle while the fourth hides.

## 3. Flag Hold round

| Setting | Value |
|---|---:|
| Maximum active round | **150 s (2 min 30 s)** |
| Uninterrupted hold to score | **30 s** |
| Break between rounds | **5 s** |
| Unattended dropped flag return | **15 s** |
| Flag pickup distance | **1.8 m** |
| Flag placement distance | **2.5 m** |

1. One shared flag starts at an authored neutral position. There are not two flags.
2. A living player touches the flag to carry it. Pickup and placement require proximity and a clear path through world geometry; players cannot collect through walls or floors.
3. Carry it into the player's own marked team area to place it automatically. This starts a new 30 s countdown. Normal weapons, grapple, and movement remain available while carrying.
4. The enemy can steal a placed flag by picking it up. This clears the placement and **resets the hold**, rather than pausing or preserving progress. Merely entering the area does not reset the timer.
5. Bring a stolen flag into the new carrier's own area to start that team's full 30 s countdown. Recovering and replacing your team's stolen flag also starts from 30 s.
6. Carrier death or disconnect drops the flag. Either side can pick up a dropped flag. It returns to neutral after 15 s unattended; invalid or out-of-bounds drops return to neutral.
7. A completed hold earns exactly **one team point** and ends the round. Kills remain visible as individual K/D statistics.
8. During the five-second break, combat and flag interaction stop. At the next round, both teams receive fresh spawns and loadouts, the flag returns to neutral, and the active round clock resets to 150 s. The shared eight-second wave schedule does not restart.
9. If the active round clock expires before a completed hold, award no point and start the same break/reset sequence. No extra time is added for a partial hold. A hold completed exactly at the deadline counts.

The normal match clock includes round breaks. It can end a round in progress. A completed hold at the match deadline counts before the time-limit result is evaluated.

## 4. Flag Hold match and overtime

Before overtime, a team wins when its score is at least five OR its lead is at least three:

- `3–0` and `4–1`: the three-point lead ends the match.
- `5–4`: reaching five ends the match.
- `3–2`: keep playing.

At 480 s, unequal scores give the match to the leading team. Equal scores start overtime with a fresh neutral round and both teams at their starting positions. The partial normal-time hold is discarded.

During overtime, **two consecutive scoring round wins** win the match. The usual first-to-five and three-point-lead rules no longer apply. A point by the other team changes the streak to that team with length one. A scoreless round leaves the streak unchanged. Example: Red, Blue, Red, Red gives Red the match. Overtime retains the 150 s round limit, 30 s hold, and five-second breaks, but has no overall time cap.

## 5. Authority and lifecycle

Reuse the existing PeerJS star transport and online orchestration. Internally `gs.mode === 'ffa'` continues to mean the online runtime; `lobby.mode` selects its rules. This avoids duplicating weapon, health, pickup, menu, and network paths. `gs.teamMatch` is null for FFA and holds the host-owned team state otherwise.

The host owns team assignment, team scores, flag ownership/position, placement, hold timers, round transitions, overtime, respawn permissions, and match results. Clients display bounded snapshots and cannot send team-state commands. Body positions and health retain the existing peer-owned model; this is not server-authoritative anti-cheat.

- `lobby` adds `mode` and `teams` (peer id to `0` Red / `1` Blue).
- `start` adds `mode`, `teams`, and a complete `teamState` for team modes, including late joins.
- Host-only `teamstate` sends the complete `TeamMatch` record on important events and regularly while playing. It includes elapsed time, points, round/hold/break timers, overtime streak, flag state, and dead-player wave deadlines.
- Team `ps` messages wrap the body array as `{ round, state }`. Flag interactions use the latest validated position, not the delayed render position. After a round reset, a remote cannot interact until a state packet for that round arrives.
- Team death messages and addressed combat messages (`pdmg`, `headshot`, `parry`, `cut`) include their round number. Outdated-round reports are ignored. Duplicate death reports while awaiting a wave do not score twice.
- Team results use `end { id: 'team:0' | 'team:1', name: 'RED TEAM' | 'BLUE TEAM' }`; FFA retains player ids.
- All team maps, player ids, team sizes, numbers, positions, and snapshot fields are checked before application. Transport host-only routing applies to the new snapshot message.
- Protocol namespace advances to v2. Public discovery uses `PUB0..7`, `TDM0..7`, and `FLG0..7`; private codes remain five characters. Old builds cannot join incompatible matches.
- Objective and wave clocks use host wall time, separate from the clamped physics timestep. Timer advancement consumes every crossed hold, break, round, and match boundary. New pickups and placements apply after elapsed time, so a delayed frame cannot instantly complete a new hold.
- A late join receives the current scores, teams, flag, round, clocks, and broken props; joining never resets the running match. During a round break the new player waits with everyone else.
- Carrier departure releases the flag before removing the player. Host loss returns clients to the online screen as before. There is no host migration.
- End, leave, level change, and engine disposal remove objective meshes, labels, pending state, and timers. Returning to the lobby keeps the chosen mode and roster but resets the match.

## 6. Maps and presentation

Use Downtown, House, and Mexico arena layouts. Each gets two separated team spawn areas, two flag placement areas, and one neutral flag location. Reuse current map routes; no map or asset pipeline replacement is required. Small Three.js flag and base markers fit the existing scene; Blender is not required for this feature.

The HUD shows mode, team scores, the local team, match time, round time, flag carrier or placement, remaining hold time, respawn wait, and overtime streak as applicable. The flag has a visible carrier marker. Scoreboards retain individual kills/deaths under team headings. Menus and match results must not display FFA rules during team games. Teammate identification cannot rely on colour alone.

Map balance and route travel time need real player testing. The first check is whether an attacker can respawn, travel to the enemy area, and attempt a steal within one 30-second hold.

## 7. Checks

Run `npm run typecheck`, `npm test`, and `npm run build`. Keep runnable rule, online integration, transport, and map-placement checks for:

- Balanced assignment, four-player capacity, smaller matches, and late joins.
- Friendly-fire rejection at send and receive paths, including visual grenade replicas.
- Shared wave timing, full wipes, teammate spectating, round reset, and duplicate death reports.
- Neutral pickup, placement, steal/reset, death/disconnect drop, unattended return, and obstruction checks.
- A single point per hold, scoreless timeout, five-second breaks, lead-three/first-five results, normal timeout, and overtime streaks that replace normal score rules.
- Host-only team snapshots, malformed fields, unknown roster ids, stale rounds, and mode-specific discovery.
- Reachable spawn/flag positions on all three maps and objective resource disposal.
- FFA and offline regression checks.

Run the real WebRTC smoke check with a local app server: `node tests/online-team.check.mjs http://localhost:3000`. It uses three separate browser contexts; debug state edits shorten score and overtime waits.

Browser smoke checks should use separate peers for lobby selection, replication, flag stealing, wave respawns, results, and leaving. Report real WebRTC, different-network, physical-controller, and multi-player balance coverage separately; automated tests are not evidence of competitive balance.

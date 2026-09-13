# Game Loop and Orchestration Specification

This document describes the top-level game orchestration subsystem. It covers boot, the main loop, game modes, match lifecycle, lobbies, waves, scoring, the kill feed, pickups, breakable props, spawn placement, remote-player bookkeeping, menus, and win/lose rules. An implementer must be able to rebuild identical gameplay from this document alone.

Units: distances are in world meters. Times are in seconds unless the text says milliseconds. Angles are in radians. "Real dt" is the wall-clock frame time. "Scaled dt" is the frame time after the time-scale of section 7 is applied.

## Table of contents

1. [Overview and vocabulary](#1-overview-and-vocabulary)
2. [Boot sequence](#2-boot-sequence)
3. [Persistent settings](#3-persistent-settings)
4. [Global game state](#4-global-game-state)
5. [Top-level state machine](#5-top-level-state-machine)
6. [Main loop and timestep](#6-main-loop-and-timestep)
7. [Time scale: hit-stop and focus slow motion](#7-time-scale-hit-stop-and-focus-slow-motion)
8. [Per-frame update order](#8-per-frame-update-order)
9. [Input handling at the orchestration level](#9-input-handling-at-the-orchestration-level)
10. [Screens and menus](#10-screens-and-menus)
11. [Run control: begin, reset, pause, resume](#11-run-control-begin-reset-pause-resume)
12. [Solo mode: waves](#12-solo-mode-waves)
13. [Solo mode: enemy spawn placement](#13-solo-mode-enemy-spawn-placement)
14. [Scoring, combo, and kill labels](#14-scoring-combo-and-kill-labels)
15. [Focus slash (solo only)](#15-focus-slash-solo-only)
16. [Solo death and the dead screen](#16-solo-death-and-the-dead-screen)
17. [Free-for-all: lobby flow](#17-free-for-all-lobby-flow)
18. [Free-for-all: match lifecycle](#18-free-for-all-match-lifecycle)
19. [Free-for-all: player spawn placement](#19-free-for-all-player-spawn-placement)
20. [Free-for-all: death, respawn, and tally](#20-free-for-all-death-respawn-and-tally)
21. [Free-for-all: scoreboard and score HUD](#21-free-for-all-scoreboard-and-score-hud)
22. [Free-for-all: win conditions and match end](#22-free-for-all-win-conditions-and-match-end)
23. [Remote player bookkeeping and timeouts](#23-remote-player-bookkeeping-and-timeouts)
24. [Player-versus-player hit resolution](#24-player-versus-player-hit-resolution)
25. [Rope cutting](#25-rope-cutting)
26. [Shot tracers over the network](#26-shot-tracers-over-the-network)
27. [Network message catalogue](#27-network-message-catalogue)
28. [Pickups](#28-pickups)
29. [Breakable props](#29-breakable-props)
30. [Out-of-bounds rules](#30-out-of-bounds-rules)
31. [Kill feed](#31-kill-feed)
32. [HUD feed each frame](#32-hud-feed-each-frame)
33. [Audio hooks](#33-audio-hooks)
34. [Interfaces with other subsystems](#34-interfaces-with-other-subsystems)

---

## 1. Overview and vocabulary

The game is a first-person shooter with two modes:

- **Solo**: one player survives numbered waves of enemies on the picked map. Score, combo, checkpoints, and a "focus slash" execution mechanic apply.
- **Free-for-all (FFA)**: 2 to 8 players in a peer-to-peer lobby. One player's client is the **host**. The host keeps the score table, owns pickups, and decides the winner. Every client owns its own body, its own health, and its own death. Each client tells the others what it did.

Vocabulary:

| Term | Meaning |
|---|---|
| Local player | The player this client controls. |
| Remote player | A representation of another client's player, eased between the snapshots that client sends. |
| Host | The client that opened the lobby. Its network id is the lobby authority. |
| Lobby code | A 5-character code that identifies the lobby (see section 17). |
| Arena | The map variant built for FFA. The map builder takes an "arena" flag. Solo uses the non-arena variant. |
| In match | The top-level state is `play`, `dying`, or `over`. |
| Online | The mode is FFA. |
| Playing | The top-level state is `play` or `dying`. |

## 2. Boot sequence

The boot sequence runs once when the page loads, in this order:

1. Create the renderer on the map canvas and read its scene and camera. Create the physics world, audio service, and network service. Audio construction does not open an AudioContext; network construction does not open a peer or connection.
2. Read the picked map key from storage (section 3). If the key is not in the selectable level list, use `downtown`. Because the Mexico level is not in that list while its "ready" flag is off, a stored `mexico` key resolves to `downtown`. The same validation is applied to every map key that arrives over the network (lobby and start messages).
3. Build the level for that key with the arena flag **off**. Build the navigation grid from the world with cell size 1, and the boss grid (clearance 0.95, headroom 5.1) beside it.
4. Record the loaded key and the arena flag (off).
5. Set the music tune: `mexico` if the map key is `mexico`, otherwise `downtown`.
6. Create the input system on the canvas, the HUD on the HUD root element, and the effects system on the scene and world.
7. Read the persistent values (section 3) and apply the input settings.
8. Create the game state record (section 4), remote-player map, lobby record and score table.
9. Create the section 34 hooks as closures over the current game state and context. Build the shared context with scene, camera, world, level, nav, input, HUD, effects, audio, renderer, network, remotes and hooks (`ctx.game`). Set `ctx.enemies` and `ctx.player` to null initially. All services already exist; actors read other actors only after construction.
10. Create the enemy manager, then the local player. Set the player's display name to the saved name.
11. Publish the debug handle with the same context, game state and service objects.
12. Register all network message handlers (section 27) and the enemy manager hooks (section 14, section 32).
13. Register the screen click handler, the canvas click handler, the pointer-lock change handler, the device change handler, the page-hide handler (leaves the network session if active), and a wake-audio handler on any pointer-down or key-down.
14. Push the input device state to the HUD, apply the look settings, push the current weapon name and hint to the HUD, and show the **main** start screen.
15. Start the animation-frame loop and the hidden-tab timer (section 6).

The map builder returns a level record. The fields used by this subsystem are:

| Field | Meaning |
|---|---|
| key | Level key, `downtown` or `mexico`. |
| bounds | Rectangle `minX, maxX, minZ, maxZ`. Downtown solo: ±55. Downtown arena: ±68. Mexico: ±62. |
| playerStart | Solo start position. Downtown (0, 0, 42). Mexico (0, 0, 16). |
| spawns | Enemy spawn points (list of positions). |
| snipers | Sniper perch positions. |
| pickups | Pickup spawn positions. |
| arenaSpawns | FFA spawn points (may be empty for a map; then `spawns` is used). Downtown arena has 15; Mexico has 13. |
| breakables | Breakable props (section 29). Only the Mexico map has them. |
| animated | Objects that take the game time each frame to animate (for example, drones). |
| meshes | Everything the builder added to the scene, for teardown. |

Level list: the selectable levels are `downtown` ("DOWNTOWN"), `house` ("THE HOUSE") and `mexico` ("MEXICO", blurb "a sun-baked plaza · piñatas, tacos and mariachi"). The Mexico-specific behaviours in this document (breakables, taco pickups, the `mexico` tune, its bounds and spawns) apply on that map.

### Level rebuild

A helper rebuilds the level when the key or the arena flag must change. Rules:

- If the requested key and arena flag equal the loaded ones, and no force flag is set, do nothing.
- Otherwise: record the new key and arena flag as loaded; remove every level mesh from the scene and release its geometry (including the geometry of every descendant object); clear the animated list; clear the physics world (all colliders); build the new level with the new arena flag; rebuild the nav grid and the boss grid (cell size 1); replace the level and both grids in the shared context and in the debug handle; set the music tune for the new key (`mexico` for Mexico, else `downtown`).
- A rebuild removes every pickup mesh only indirectly: pickups are not level meshes, so the caller (reset run, section 11) clears them itself. Enemies and effects are also the caller's job.
- A forced rebuild is used to restore broken props (section 29).

The "set arena" helper picks the key: when the network session is active, the lobby's map (or the local pick if the lobby has none); otherwise the local pick. The key is validated against the level list.

## 3. Persistent settings

All values persist in browser local storage.

| Key | Default | Meaning |
|---|---|---|
| `cs6_map` | `downtown` | Picked map key for solo and for lobbies the local player hosts. |
| `cs6_best` | 0 | Best solo score. |
| `cs6_music` | on (`1`) | Music wanted. Off only when the stored value is `0`. |
| `cs6_checkpoint` | 0 | Highest reached checkpoint wave (multiples of 5). |
| `cs6_name` | random | Player name, max 14 characters. If empty, use `recruit` + a random integer from 10 to 99. |
| `cs6_sens` | 100 | Look sensitivity percent. Slider range 25 to 250, step 5. |
| `cs6_invert` | off | Invert vertical look when stored value is `1`. |

Applying look settings sets on the input system: mouse sensitivity = 0.0022 × sens/100; gamepad X sensitivity = 3.4 × sens/100; gamepad Y sensitivity = 2.6 × sens/100; invert flag. It also writes sens and invert back to storage.

The name box on the online screen updates the name on every input event: trim, cut to 14 characters, keep the old name if the result is empty; store it; set it on the local player.

## 4. Global game state

The game state record carries:

| Field | Initial | Meaning |
|---|---|---|
| state | `start` | Top-level state (section 5). |
| mode | `solo` | `solo` or `ffa`. |
| menu | false | An overlay menu is open while the state is `play` (FFA pause, click-to-play). |
| time | 0 | Game clock. Advances by scaled dt while playing, by real dt otherwise. Drives level animation and the idle camera. |
| hitstopT | 0 | Remaining hit-stop time. |
| hitstopScale | 1 | Time scale during hit-stop. |
| wave | 0 | Current solo wave number. |
| score | 0 | Solo score (also shows FFA points, see section 14). |
| combo | 0 | Current combo count. |
| comboT | 0 | Time until the combo resets. |
| kills | 0 | Kills this run. |
| intermission | 0 | Remaining time between waves. |
| queue | empty | Enemy types waiting to spawn this wave. |
| spawnT | 0 | Time until the next enemy spawns. |
| maxAlive | 6 | Maximum enemies alive at once this wave. |
| deathT | 0 | Time since local death. |
| focus | see section 15 | Focus slash state. |
| katanaStreak | 0 | Consecutive katana/focus kills. |
| boss | none | The living boss enemy, if any. |
| respawnT | 0 | FFA respawn countdown. |
| matchT | 0 | FFA match clock (host only advances it). |
| over | none | FFA winner record `{id, name}` once the match is over. |
| overT | 0 | Time since the match ended. |

Constants: FFA kill target = 20; FFA time limit = 480 s; FFA respawn delay = 3.5 s.

The record also exposes two functions to other subsystems: **hit-stop** (section 7) and **add score** (section 14), and one callback **on player death** (section 16 and 20). Add score is also called by the player and enemy subsystems for parries, blocks, yanks, and shield breaks (section 34).

## 5. Top-level state machine

States:

| State | Meaning |
|---|---|
| `start` | A start screen is showing (main, online, or lobby panel while not yet in a lobby). Idle camera. |
| `lobby` | In a network lobby, on the lobby panel. Idle camera. |
| `play` | Playing. An overlay may be open (`menu` true). |
| `pause` | Solo pause. Simulation stops. |
| `dying` | Local player died. Death timer runs. Simulation continues. |
| `dead` | Solo dead screen. Idle camera. |
| `over` | FFA match over screen. Idle camera. |

Transitions:

| From | Event | To |
|---|---|---|
| `start` | START button, screen click on main panel, jump/confirm press on main panel | `play` (solo, wave 1) |
| `start` | checkpoint button | `play` (solo, that wave) |
| `start` | CREATE LOBBY / JOIN / QUICK PLAY succeeded | `lobby` |
| `lobby` | host starts (own click or a client request) | `play` (FFA) |
| `lobby` | `start` message from host | `play` (FFA) |
| `lobby` | LEAVE, host left, refused | `start` (online panel) |
| `play` (solo) | pause key, pointer lock lost | `pause` |
| `play` (FFA) | pause key, pointer lock lost | `play` with `menu` true |
| `play` | local player health reaches 0 | `dying` |
| `pause` | resume (click, jump, confirm, pause key) | `play` |
| `pause` / `dead` | MAIN MENU button | `start` (main panel) |
| `dying` (solo) | 1.7 s elapsed | `dead` |
| `dying` (FFA) | 3.5 s countdown elapsed | `play` (respawned) |
| `dead` | click, jump, confirm | `play` (solo, wave 1, fresh run) |
| `dead` | checkpoint button | `play` (solo, that wave) |
| any state while the session is active | `end` message (clients) / host detects win or time-out | `over` |
| `over` | host: 8 s elapsed; client: `backtolobby` message | `lobby` |
| any online state | LEAVE MATCH, host disconnect, timeout of host | `start` (online panel) |
| `lobby` | `start` message with the late flag (joined a running match) | `play` |

Notes:

- The `end` message handler runs in whatever state the client is in; in practice the host only sends it while in match.
- The `start` message is ignored by the host itself. A `startreq` is honoured by the host only while its own state is `lobby`.
- Leaving online from a state other than `start` always passes through the reset-run routine (section 11) so a half-finished match leaves no enemies, pickups, or effects behind.

## 6. Main loop and timestep

- The loop runs on the browser animation frame. Each frame calls one **step** with the current high-resolution time.
- **Variable timestep, clamped**: dt = min(0.05, (now − last) / 1000). Then last = now. Never more than 50 ms per step; a bigger jump would make the view-model springs fly apart.
- There is no fixed-step accumulator. Physics sub-stepping for fast bodies is inside the physics world (not this subsystem).
- **Hidden-tab keep-alive**: a coarse timer fires every 250 ms. If the network session is active and more than 300 ms passed since the last step, it runs one step now with the current high-resolution time. This keeps a host that alt-tabbed from freezing the match. It never starts extra frame chains. With regular timer-only callbacks, the threshold permits one step every 500 ms (2 Hz). Each step advances at most 50 ms, so simulation runs at about 10% speed and state packets at about 0.67/s. Browser throttling can make this slower.
- The "last step time" is initialised when the script loads, so the first frame's dt is the (clamped) time since load.

## 7. Time scale: hit-stop and focus slow motion

Each step computes a scale:

1. If hit-stop time > 0: subtract real dt from it; scale = hit-stop scale.
2. Else if focus is active (section 15): scale = 0.26.
3. Else scale = 1.

Scaled dt = dt × scale.

**Hit-stop request** (duration d, scale s): remaining hit-stop time = max(current, d); hit-stop scale = s. Callers in this subsystem: PvP parry (0.08, 0.15), focus execute (0.10, 0.08). Other subsystems call it too (enemy kills, player parries).

Which timers use scaled dt and which use real dt is listed in section 8.

## 8. Per-frame update order

Every step runs this sequence:

1. Compute dt (section 6).
2. **Input update** with real dt.
3. **Menu/screen key handling** (section 9).
4. **Music toggle key** (section 9).
5. **Scoreboard visibility** (section 21) when online and playing; otherwise reset the gamepad toggle latch to off (the overlay itself is hidden by the menu, end-match, leave, and lobby-screen routines).
6. **Pointer-lock tip**: when state is `play`, no menu, pointer not locked, and not on gamepad, a timer counts down by real dt (initial 0.5 s). When it reaches 0 it resets to 2.5 s and shows the tip "click to grab the mouse" for 2 s.
7. Compute the time scale and scaled dt (section 7).
8. **Focus**: if state is `play` and solo, update focus with real dt; otherwise end focus. Consequence: pausing, dying, or being online ends any focus or dash at once.
9. If **playing** (`play` or `dying`):
   1. game time += scaled dt. If the player's spawn shield > 0, shield −= real dt.
   2. **Music heal**: a timer (initial 2 s) counts down by real dt; when it reaches 0 it resets to 2 s and then: if music is wanted, state is `play`, music is not playing, and the audio context exists, turn music on; and if any input happened this frame, resume the audio context. The timer only counts while playing.
   3. **Bounds guard** (section 30).
   4. Player update (scaled dt).
   5. Enemy manager update (scaled dt).
   6. Effects update (scaled dt).
   7. Pickup update (scaled dt).
   8. Network update (real dt) (section 23).
   9. If state is `play` and solo: wave update (scaled dt).
   10. If online: arena pickup spawner (real dt).
   11. Combo decay: if combo timer > 0, subtract scaled dt; on reaching 0 set combo to 0 and refresh the score HUD with combo 0.
   12. If state is `dying`: death timer += real dt. FFA: respawn countdown (section 20). Solo: after 1.7 s go to `dead` and show the dead screen, release pointer lock.
10. Else (not playing):
   1. game time += real dt.
   2. If state is `start`, `dead`, `lobby`, or `over`: run the player's idle camera with the game time.
   3. Effects update (real dt). Network update (real dt) if the session is active.
   4. If state is `over`: over timer += real dt. Host only: after 8 s, send `backtolobby` and go to the lobby screen.
11. Level animated objects update with the game time.
12. Audio listener follows the player's eye position and right vector.
13. HUD feed (section 32).
14. Audio intensity (section 33).
15. Render with post effects: hurt amount, flash amount, slow flag (1 when scale < 1), low-health amount = (alive and hp < 30) ? 1 − hp/30 : 0.

## 9. Input handling at the orchestration level

Action names come from the input subsystem: `jump`, `confirm`, `pause`, `music`, `score`, `aim`, `fire`, `dash`. Key labels for tips come from the HUD's key-label table (keyboard: fire LMB, aim/block RMB, jump Space, dash C, grapple Q, grenade G, focus "both mouse buttons (or X)", pause Esc, confirm Space, score Tab; gamepad: fire R2, aim/block L2, jump ✕, dash ○, grapple L1, grenade R3, focus "L2 + R2", pause Options, confirm ✕, score Create).

Rules each step, after the input update:

- State `start`, `pause`, or `dead`: a press of `jump` or `confirm`, or (only in `pause`) a press of `pause`, acts as a screen click (section 10, "screen click").
- State `play` and `pause` pressed: if a menu is open, resume; else pause and release pointer lock.
- State `play`, menu open, `jump` or `confirm` pressed: resume.
- `music` pressed at any time: toggle music wanted, store it, turn music on/off, show tip "music on" or "music off" for 1.5 s.

Pointer lock:

- Canvas click while state is `play`, no menu, pointer not locked, not on gamepad: request pointer lock.
- Pointer lock lost while state is `play`, no menu, not on gamepad: pause.
- Device change (keyboard ↔ gamepad): push the device flag to the HUD and refresh the weapon name and hint.

Screen click (from the start-screen overlay or from key presses above):

| State | Action |
|---|---|
| `over`, `lobby` | Nothing. |
| `start` | If the main panel shows: begin solo. Else nothing. |
| `play` with menu | Resume. |
| `pause`, `dead` | Resume. |

## 10. Screens and menus

All screens are HTML panels shown over the game. While a start screen shows, the gameplay HUD is hidden. Buttons inside panels stop click propagation so they do not count as a screen click.

### Main panel

Title "COUNTER SLOP 6", subtitle "a tactical survival shooter, allegedly". Contents:

- START button, caption "solo · survive the waves" → begin solo.
- PLAY ONLINE button, caption "free for all · up to 8 players" → switch to the online panel.
- Map selector (only when 2 or more levels exist): one button per level with name and blurb; the picked one is marked. Picking stores the key and redraws the panel.
- Controls table (static text from the HUD subsystem).
- Settings block: sensitivity slider (25–250, step 5) with a percent readout, invert checkbox, music checkbox with "(M)" hint. Changes apply at once and persist.
- Checkpoint block (only if checkpoint ≥ 5): label "checkpoints" and one button per multiple of 5 up to the checkpoint, "WAVE n". Clicking begins solo at that wave.
- "best score: N" when best > 0.

### Online panel

Title "PLAY ONLINE", subtitle "free for all · first to 20 · up to 8 players". Rows:

- "your name" text box (max 14).
- QUICK PLAY button, hint "jumps into an open public lobby, or opens one for you".
- "or" divider.
- CREATE LOBBY button with radio "public" / "private · friends only" (default public, remembered in the lobby record).
- "have a code?" text box (max 5, upper-cased) and JOIN button. Enter in the box triggers JOIN. Empty code → status "type the code your friend gave you".
- Status line (lobby status text).
- BACK button → clear status, main panel.

When QUICK PLAY, CREATE, or JOIN is clicked, every button except BACK is disabled until the panel is redrawn.

### Lobby panel

Title "LOBBY", subtitle "free for all · first to 20 · N/8 players". Rows:

- "code" and the lobby code.
- Map selector; only the host can pick. Host pick sets the lobby map and broadcasts the lobby.
- Hint: public → "this lobby is public: anyone can quick play in, or type the code"; private → "private lobby: friends type this code under PLAY ONLINE → JOIN".
- Player list: one row per lobby player, host row marked, own row marked with "you".
- START MATCH button: host → host start; client → send `startreq`, status "asking the host to start…".
- LEAVE button → leave online with an empty reason.
- Status line, then hint "anyone can start · " + (fewer than 2 players ? "people can still join once it is running" : "N players in").

The lobby panel is redrawn whenever the lobby record changes while the state is `lobby`.

### Pause panel (solo)

Title "PAUSED", subtitle "wave W · score S", controls table, settings block, MAIN MENU button, footer "CLICK ANYWHERE (or press <confirm key>) TO RESUME".

### Menu panel (FFA)

Title "MENU", subtitle "free for all · lobby CODE", a scoreboard (sorted rows: name, "K kills · D deaths" as "K K · D D"; own row marked), controls table, settings block, LEAVE MATCH button, footer "CLICK ANYWHERE (or press <confirm key>) TO KEEP PLAYING".

### Click-to-play panel (FFA)

Title "MATCH ON", subtitle "free for all · first to 20", footer "CLICK ANYWHERE (or press <confirm key>) TO PLAY". Shown when a match started without a user gesture on this client (section 18).

### Dead panel (solo)

Title "ELIMINATED". Stats line: "you survived W wave(s) · K kills · score S" and either " · NEW BEST" (when the score beat the stored best; the best is stored at this moment) or " · best B". Then the checkpoint block, MAIN MENU button, footer "CLICK (or press <confirm key>) TO DRAW AGAIN".

### Match over panel (FFA)

Title "YOU WIN" if the winner id is the local id, else "<winner name> WINS" ("someone" if no name). Scoreboard rows as in the FFA menu. Footer "back to the lobby in a moment…". Clicks do nothing.

### Main menu action

Used by the MAIN MENU buttons: state `start`, mode `solo`, menu closed, arena off, reset the run (section 11), stop the reel-loop sound, release pointer lock, hide gameplay HUD, show the main panel.

### Lobby screen action

Used after a match ends: arena on, reset the run, state `lobby`, clear the winner, menu closed, hide gameplay HUD, hide the scoreboard, show the lobby panel.

## 11. Run control: begin, reset, pause, resume

**Reset run**:

1. If any breakable prop is broken, force-rebuild the level with the current key and arena flag.
2. Clear enemies, clear effects, remove every pickup mesh, empty the pickup list, reset the arena pickup clock to 0.
3. Player stats by mode: FFA → max HP 110, regen delay 4 s, regen rate 14 HP/s. Solo → max HP 120, regen delay 4.5 s, regen rate 11 HP/s.
4. Reset the player at the level's solo start. Set name. Clear "last hit by" and "last hit" records.
5. Enemy modifiers speed 1, damage 1. HUD modifier text cleared. Boss bar hidden. Boss cleared. End focus. Katana streak 0.
6. score 0, kills 0, combo 0, wave 0, intermission 0, empty queue, game time 0, winner none, match clock 0.
7. HUD: score 0 combo 0, timer cleared, PvP score hidden, wave 1 with 0 left, scoreboard hidden.

**Begin common** (every entry into play): initialise the audio context (no-op if it exists) and resume it; request pointer lock unless on gamepad; turn music on if wanted and not already playing; hide the screen overlay; show the gameplay HUD; close the menu.

**Begin solo**: mode `solo`, arena off, begin common. If the state was `start` or `dead`: reset run and start wave 1. State `play`. (From `pause`, the run continues.)

**Begin at wave n**: mode `solo`, arena off, begin common, reset run, start wave n, state `play`.

**Pause**: only when state is `play` and no menu. Solo → state `pause`. Both modes → menu open, show the pause/menu panel, stop the reel-loop sound.

**Resume**: FFA → close menu, hide screen, show gameplay HUD, request pointer lock unless on gamepad. Solo → begin solo.

A debug "jump to wave" exists: clear enemies and effects, reset modifiers, end focus, clear intermission and queue, start wave n, hide screen, show HUD, state `play`, menu closed, stop reel sound. It is not reachable from the UI.

## 12. Solo mode: waves

### Roster

| Type | Available from wave | Base weight | Display name | Score |
|---|---|---|---|---|
| grunt | 1 | 10 | GRUNT | 100 |
| rusher | 2 | 6 | RUSHER | 120 |
| bomber | 3 | 3 | LIVE NADE | 150 |
| sniper | 3 | 4 | SNIPER | 180 |
| flyer | 4 | 4 | ATTACK DRONE | 140 |
| heavy | 5 | 4 | HEAVY | 260 |
| shield | 6 | 4 | SHIELD MAIN | 200 |

Bosses, in rotation (the enemy subsystem's boss type list, in this order): the admin (type id `boss`, display name "THE ADMIN", 2600 HP, 2500 points), the hitbox (type id `hitbox`, "THE HITBOX", 3400 HP, 3200 points), the lagspike (type id `lagspike`, "THE LAG SPIKE", 3000 HP, 3600 points). Boss for wave n = rotation[(floor(n / 5) − 1) mod 3], so wave 5 → admin, 10 → hitbox, 15 → lagspike, 20 → admin, and so on. The "IS COMING" announcement uses the display name looked up from the type id (any unknown id is shown upper-cased).

### Modifiers

| Index | Name | Enemy speed × | Enemy damage × |
|---|---|---|---|
| 0 | (none) | 1.00 | 1.00 |
| 1 | "CAFFEINATED · they move fast" | 1.35 | 0.85 |
| 2 | "JUICED · they hit harder" | 0.90 | 1.40 |
| 3 | "SWARM · more of them, thinner" | 1.15 | 0.90 |

The modifier index is a uniform random integer in [0, allowed) where allowed = 1 if the wave is a boss wave or n < 4; 3 if n < 6; else 4. "Swarm" is active when the picked modifier name starts with "SWARM".

### Start wave n

1. wave = n; queue emptied; spawn timer = 1; intermission = 0; boss cleared; boss bar hidden.
2. boss wave = (n > 0 and n mod 5 = 0).
3. Pick and apply the modifier; show its name in the HUD modifier slot.
4. maxAlive = min(4 + floor(0.8 n) + (swarm ? 3 : 0), swarm ? 20 : 16).
5. count = round(min(4 + 1.7 n, 28) × (swarm ? 1.35 : 1)). On a boss wave: count = min(6 + n, 14) and the boss type is pushed to the front of the queue first. The drawn types are then dealt into the queue as **packs**: cycle through the types still owed and push min(remaining, round(uniform [2, 3])) of each per cycle, so the wave spawns as beats (a rusher pair, then grunts, then drones) rather than a random trickle.
6. Pool = roster entries with n ≥ from, each with weight = base weight × min(1, 0.3 + 0.25 × (n − from)). Draw `count` types by weighted random (roulette over the pool; on numerical fall-through pick the first pool entry). Push each to the queue.
7. Message: boss wave → main "WAVE n", sub "<BOSS DISPLAY NAME> IS COMING", 3 s, plus a boss roar sound at the player. Otherwise → main "WAVE n", sub = (n = 1 ? "they are pushing · hold the site" : modifier name if any, else a random pick from "tone harder", "keep sketch", "stay off the ground", "swing for it", "return their bullets"), 2.6 s.
8. Play the wave sound.
9. If n ≤ 5, show tip number n for 7 s. Tips (with the current device's key labels): 1 "hold <grapple> to reel in · tap it again to let go mid-swing"; 2 "block with <block> and some of their bullets go back at them"; 3 "kills in the air are worth more · stay off the floor"; 4 "<grenade> lobs a grenade · pickups give you more"; 5 "<dash> in the air dashes · <jump> on a wall jumps off it" (the double jump is disabled, PI 6.10).
10. Player grenades += 1, capped at max grenades (5).
11. Spawn 7 pickups at random pickup spots: the first 5 are ammo, the last 2 are health.
12. Checkpoint: if n ≥ 5, n mod 5 = 0, and n > stored checkpoint → store n and show kill feed "CHECKPOINT · WAVE n".

### Wave update (each frame with scaled dt, only in state `play`, solo)

1. If intermission > 0: if `confirm` was pressed this frame set intermission = 0, else subtract dt; HUD timer text "next wave in " + ceil(intermission), with " · Enter to skip" appended on keyboard (no pad skip: every pad button already has a gameplay meaning). When it reaches 0: clear the timer text and start wave (current + 1). Stop here.
2. If the queue has entries and enemies alive < maxAlive: spawn timer −= dt. When ≤ 0: spawn timer = max(0.7, 2.2 − 0.13 × wave); pop the front type; spawn it at the position from section 13. If the spawned enemy is a boss: HP multiplier = 1 + 0.35 × floor((wave − 5) / 15); its hp and max hp = round(type hp × multiplier).
3. If the queue is empty and no enemy is alive: intermission = 8; message main "WAVE w CLEARED", sub "catch your breath · +" + 200 × w, 2.5 s; add score 200 × w with no label (combo multiplier applies); wave-clear sound; `player.heal(40)`.
4. HUD wave = wave, enemies left = alive + queue length.

## 13. Solo mode: enemy spawn placement

Given an enemy type, the spawn position is chosen as follows. `pp` is the player's body position.

- Spot list = sniper perches for type `sniper`, else the level spawn list.
- **Flyer**: bearing = the player's rear (atan2(−forward.x, −forward.z)) + uniform [−1.05, 1.05] rad — the rear 120° of the facing, so a drone is a trap, not a thing you watch arrive; radius r uniform in [22, 32). Position x = clamp(pp.x + cos(a) r, minX + 4, maxX − 4), z = clamp(pp.z + sin(a) r, minZ + 4, maxZ − 4), y = pp.y + 12 + uniform [0, 6).
- **Boss**: a spot "fits" when no world collider overlaps the box from (x − 1.1, y + 0.1, z − 1.1) to (x + 1.1, y + 5.2, z + 1.1) **and** the boss grid has a complete path from the spot to `pp` (a boss that fits its spawn but not its route stood at a doorway for the whole wave). Take the spots that fit; prefer those farther than 20 from `pp` (random among them); else random among those that fit; else try up to 200 random candidates: angle uniform, r in [22, 40), x and z = pp ± offset clamped to ±44, y = ground height found by a downward ray from y = 30 with max drop 40; accept when y > −3 and it fits. Final fallback: the level's player start.
- **All others**: candidates = spots with 14 < distance to pp < 48. If fewer than 2, candidates = spots with distance > 14. Hidden = candidates with no line of sight from the player's eye to the spot raised by 1.2. The pool is hidden if any, else candidates if any, else all spots. From the pool take the spot whose bearing from `pp` is furthest (minimum absolute wrapped angle) from the bearings of the last three spawns, plus uniform [0, 0.4) rad of jitter so near-equal spots vary; remember its bearing (keep three). Enemies therefore come from several streets instead of queuing down one.

The chosen position is copied (never the list entry itself).

## 14. Scoring, combo, and kill labels

**Add score (points, label)**: multiplier = 1 + 0.25 × min(combo, 9); awarded = round(points × multiplier); score += awarded; if a label is given, push "<label> +awarded" to the kill feed; refresh the score HUD with score and combo.

**Combo**: on each enemy kill, combo += 1 and the combo timer = 3.5 s. The timer decays by scaled dt; at 0 the combo returns to 0. The HUD shows "combo xN" only when N > 1. In FFA nothing increments the combo, so the multiplier is 1.

**On enemy kill** (called by the enemy manager with the enemy, the hit info, and an "overkill" flag):

1. kills += 1; combo += 1; combo timer = 3.5.
2. label = the enemy display name for a boss, otherwise **none**; points = enemy score value. A plain kill only moves the score; the feed is for the special cases below ("RECRUIT +100" six times a wave was noise). " · AIRBORNE" on a label-less kill becomes just "AIRBORNE".
3. Apply in this order (later label assignments replace earlier ones; point bonuses add up):
   - critical (headshot): label "HEADSHOT", +60.
   - source katana: label "SLICED" if overkill else "CUT DOWN", +50.
   - source focus: label "EXECUTED", +150.
   - source katana or focus: katana streak += 1; add 0.42 blood to the katana; if the streak ≥ 3, enter focus (section 15). Otherwise, if the source is not blast, streak = 0 (blast kills leave the streak untouched).
   - source deflect: label "RETURN TO SENDER", +120.
   - source fall: label "FELL OFF THE MAP". Else, if the player is not on the ground and the source is not deflect: append " · AIRBORNE", +40.
4. Add score (points, label). Kill sound, strong when critical or boss.
5. Drop: r uniform in [0, 1). r < 0.5 → ammo pickup at the enemy body position; else r < 0.62 → health pickup there; else nothing.

**Boss hook**: when the enemy manager reports a boss (spawn, damage, or death): if dead → hide boss bar, boss cleared; else boss = that enemy, boss bar shows name and hp/maxHp.

**Other score sources** (calls from other subsystems, listed for completeness): "PERFECT PARRY" 60, "BLOCKED" 15 (bullet block), "BLOCKED" 40 (melee block), "YANKED" 30 (grapple pulls an enemy), "SHIELD BROKEN" 40, "PIÑATA" 25 (section 29). FFA kills give 100 (section 20).

## 15. Focus slash (solo only)

Constants: focus duration 2.6 s; time scale 0.26; range 24; max chain 2; arm delay 0.18 s; dash speed 46 m/s; kills to charge 3.

Focus state fields: active, remaining time, chain count, current target, dash record, arm timer, ready flag.

**Candidate** (best enemy to execute): over all enemies that are alive and not in the spawn state: vector from the player's eye to the enemy center, distance d; require 0.5 ≤ d ≤ 24; aim = dot(normalized vector, player forward); require aim ≥ 0.4; require line of sight from the eye to the center; rank = 3 × aim − d / 24; the highest rank wins.

**Enter focus**: refused when online, when chain ≥ 2, or when no candidate. fresh = focus was not active. Set active, remaining = 2.6, chain += 1, arm = 0.18, ready = false. If fresh: focus-in sound and tip "SLASH READY · hold <focus key> to dash" for 2.2 s.

**End focus**: if neither active nor dashing, nothing. Else: active false, target none, chain 0, dash none, katana streak 0, player dash lock off, hide the focus mark.

**Update focus** (real dt, only while state `play` and solo):

1. Not active → nothing.
2. Dashing → update the dash (below) and stop.
3. remaining −= dt; arm −= dt. If remaining ≤ 0 or the player is dead → end focus.
4. combo held = (aim down and fire down) or dash down. If not held → ready = true (the player must release before it can trigger).
5. target = candidate. If none → hide the mark and stop. Else project the target center through the camera to normalised device coordinates (x, y in [−1, 1], depth z); if z < 1 (in front of the far plane) place the focus mark at pixel ((x × 0.5 + 0.5) × viewport width, (−y × 0.5 + 0.5) × viewport height); else hide it.
6. If combo held, ready, and arm ≤ 0: consume the fire input and start the dash at the target.

**Start dash**: dash record = {target, elapsed 0, trail point = player center, trail timer 0}; player dash lock on; player velocity zero; dash sound; FOV kick 5; rumble (0.5, 0.4, 120 ms); hide the mark.

**Update dash** (real dt):

1. elapsed += dt. If the target is dead or elapsed > 1.2 → end dash (not blocked).
2. Flat vector from the player body to the target body: dx, dz, flat = hypot. Unit nx, nz (guard against zero).
3. Player yaw = atan2(−dx, −dz). Pitch = atan2(vertical, horizontal) of the eye-to-target-center vector, clamped to ±1.2.
4. want = max(0, flat − 1.1). Move the body horizontally by min(46 dt, want) with the **march** rule: advance in steps of at most 0.22; after each step, if the body overlaps the world, try raising it by 0.65; if it still overlaps, undo the raise and the step and stop. Record the distance moved.
5. Vertical: aimY = target body y (+0.2 if the target flies). dy = aimY − body y. If |dy| > 0.05, move y by clamp(dy, −46 dt, +46 dt); if that overlaps the world, undo it and stuckY += dt; else stuckY = 0.
6. Trail: trail timer += dt; when > 0.02 → reset; draw a tracer from the trail point to the player center (blue, thickness 0.045, life 0.28); trail point = center; small burst (2 particles, speed 5, life 0.22, size 0.03).
7. reach = hypot(flat, max(0, |dy| − 0.6)). If reach ≤ 1.5 → execute.
8. If moved ≈ 0 (< 0.0001), want > 0.05, and stuckY > 0.08 → end dash (blocked).

**End dash (blocked flag)**: dash lock off, dash none, velocity zero. If blocked: start a katana slash, swing sound, tip "blocked · the dash did not reach" for 1.2 s.

**Execute** on the target: dash lock off, dash none, velocity zero; start a katana slash; deal 100000 damage (a boss instead takes 25 % of its max HP; the enemy damage multiplier still applies) with source `focus`, part `head`, critical, at the target center, direction eye→center; focus-slash sound; hit-stop (0.1, 0.08); screen shake += 0.35; rumble (0.9, 0.7, 140 ms); FOV kick 6; `player.heal(6)`. If the target is still alive (a boss), end focus outright — the streak and chain reset — so a held dash cannot re-execute it every frame. Otherwise, if the chain count did not change during the kill (that is, the kill did not re-enter focus), remaining = min(remaining, 0.35). Clear the target and hide the mark.

Because the kill increments the katana streak and enters focus again while chain < 2, a chain gives at most 2 executions; after the second one, focus fades in 0.35 s and the streak resets.

While focus is active and no hit-stop runs, the whole simulation runs at time scale 0.26 (section 7). Focus itself, and input, use real time.

## 16. Solo death and the dead screen

The player subsystem calls "on player death" when its HP reaches 0. This subsystem then: end focus; then, in solo: state `dying`, death timer 0. The player keeps simulating (camera falls). After 1.7 s of real time: state `dead`, show the dead panel (section 10; this also stores a new best score), release pointer lock. The idle camera runs while dead.

## 17. Free-for-all: lobby flow

Lobby record: player map (network id → name), host id, public flag (default true), status text, code, map key (none until set).

Network facts used here (owned by the network subsystem, listed as contract): max players 8 (the host accepts at most 7 connections); a private lobby code is 5 characters from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; public lobbies use well-known codes `PUB0` to `PUB7` (quick play knocks on all 8 at once and takes the first `welcome`); join time-out 14 s; quick-play time-out 11 s; signalling time-out 12 s; a connection counts only after the host sends `welcome` {hostId, code, isPublic}. The network layer itself sends `refused` {reason} with "that lobby is full" or "that lobby is closed" to a joiner it turns away, and on a peer's disconnect the host's network layer calls the peer-left hook and broadcasts `leave` {id} by itself (this subsystem does not send `leave` in that case).

**Create lobby (public flag)**: status "opening a lobby…"; ask the network to host. On failure: status = friendly error, stop. On success: lobby public flag, lobby map = local pick, players = {own id: own name}, host id = own id, status cleared, state `lobby`, show the lobby panel.

**Join (code)**: status "connecting…"; ask the network to join with metadata {name}. On failure: friendly error. On success: public flag from the network, status cleared, state `lobby`, show the lobby panel.

**Quick play**: ask the network to quick-join with metadata {name} and a status callback. On success: public true, status cleared, state `lobby`, lobby panel. On an error other than "no open public lobbies": friendly error, stop. On "no open public": status "no open lobbies · opening a public one for you…" then create a public lobby.

**Friendly error mapping** (substring of the error message → text): "networking library" → "could not load the networking library · check your connection and reload"; "timed out" or "signalling" → "could not reach the matchmaking server · check your connection"; "no lobby with that code" → "no lobby with that code · check it with your friend"; "no answer" → "found the lobby but could not connect · one of you may be on a network that blocks it"; "full" → "that lobby is full"; empty → "something went wrong"; anything else → the message itself.

**Host: peer joined (id, metadata)**: name = metadata name cut to 14 (default "recruit"); add to lobby players; create the remote player (section 23); broadcast the lobby. If in match: add a score row (0/0) if missing; send `start` to that peer with late = true, spawn = farthest spawn index (section 19), map, and the list of broken prop ids; send scores; kill feed "<name> joined".

**Host: broadcast lobby**: send `lobby` {players: [{id, name}], hostId: own id, isPublic, map: lobby map or local pick}; redraw the lobby panel if in state `lobby`.

**Client: `lobby` received**: set host id, public flag, code (from the network), map (validated) if present; rebuild the player map; create a remote for every listed player except self; remove any remote not listed; if in match: add missing score rows and refresh the score HUD; redraw the lobby panel if in `lobby`.

**Host: peer left (id)** (called by the network layer, which also broadcasts `leave` {id}): remember the name; remove the remote, lobby entry, and score row; broadcast the lobby; if in match: kill feed "<name> left" ("someone" if unknown) and send scores.

**Client: `leave` received {id}**: remove remote/lobby/score for that id; if in match kill feed "<name> left"; redraw the lobby panel if in `lobby`.

**Host disconnected** (client side): leave online with reason "the host left the lobby". **`refused` received** {reason}: leave online with that reason.

**Leave online (reason)**: network leave; remove every remote; clear lobby players and scores; hide the scoreboard. If state ≠ `start`: state `start`, mode `solo`, arena off, reset run, hide gameplay HUD. Menu closed; status = reason (empty allowed); show the online panel.

**Page hide**: if the session is active, network leave.

## 18. Free-for-all: match lifecycle

**Host start** (host clicks START MATCH, or receives `startreq` while in state `lobby`):

1. Scores = one row {name, kills 0, deaths 0} per lobby player.
2. Arena on. Build the list of spawn indices 0..S−1 (S = arena spawn count) and shuffle it (Fisher–Yates, uniform).
3. Assign spawn index for lobby player i (in lobby map order) = shuffled[i mod S].
4. Send `start` {spawns: {id → index}, map}.
5. Start match locally with late = false and own index. Send scores.

**Client: `start` received** {late?, spawns? or spawn?, map?, broken?}: ignore if host. Set the lobby map if present. Start match with late and the own index (from the spawns map by own id, or the single spawn index). Then for each broken id, break that prop quietly (section 29).

**Start match (late, spawn index)**:

1. mode `ffa`; arena on; reset run.
2. If the score table is empty, fill it from the lobby players (0/0).
3. Spawn position = a copy of spawn spots[index] (section 19) if an index was given and a spot exists at it, else the arena spawn rule (section 19). Reset the player there (after the reset run placed it at the solo start).
4. Begin common; state `play`; screen = lobby (so the panel after the match is the lobby).
5. Refresh the score HUD. Message main "FREE FOR ALL", sub "you joined a match in progress" if late else "first to 20 · everyone is fair game", 3 s. Tip "hold <score key> for the scoreboard" for 5 s.
6. After 250 ms: if state is still `play`, the pointer is not locked, and not on gamepad → menu open and show the click-to-play panel (a match started by another client's click cannot grab the mouse without a gesture).

During a match, the pickup rules of section 28, the PvP rules of sections 24–26, and the network update of section 23 apply. The enemy manager still updates but nothing spawns enemies.

## 19. Free-for-all: player spawn placement

Spawn spots = the arena spawn list if it has entries, else the level's enemy spawn list.

**Arena spawn** (respawn, or start without an index): for each spot compute d = the minimum distance from the spot to any remote player that is alive and whose `visible` getter is true (current figure exists and is visible; 999 if none). Sort spots by d descending. Pick uniformly among the first min(3, count).

**Farthest spawn index** (late joiner, chosen by the host): bodies = the local player plus every alive remote. For each spot, d = the minimum distance to any body (999 if none). Return the index with the largest d (first on ties).

**Initial deal** (host start): shuffled indices, see section 18.

## 20. Free-for-all: death, respawn, and tally

**Local death in FFA** (from the "on player death" callback, after ending focus):

1. killer = "last hit by" id (may be none); h = the "last hit" record {from position, crit, amount, src}.
2. dir = unit vector from the killer's recorded position to the player's center, rounded to 2 decimals (none if no position).
3. how = word for the source if there is a killer: rifle → "rifle", shotgun → "shotgun", sniper → "sniper", katana → "katana", grenade → "grenade", deflect → "their own bullet"; unknown → none.
4. Broadcast `pdead` {killer, dir, over: (crit or amount ≥ 90 or src = katana), how, crit}. `over` asks the other clients for a strong ("overkill") ragdoll.
5. respawn countdown = 3.5; state `dying`; death timer 0.
6. If host: tally death (own id, killer). Tally may end the match; do not overwrite the resulting `over` state with `dying`.
7. Kill feed: if the killer has a score row → "eliminated by <name>" + (how ? " · " + how + (crit ? " headshot" : "") : ""); else "eliminated".

Credit edge case: the "last hit by" and "last hit" records are cleared only by reset run and respawn. If a player is hurt by a peer and then dies from any other cause (a fall off the map, a grenade of their own), the peer is still the killer and the "how" word comes from that earlier hit.

**Respawn countdown** (each `dying` frame, real dt): before = ceil(countdown); countdown −= dt; left = ceil(countdown). If left changed, or this is the first frame of dying (death timer ≤ dt): message main = left > 0 ? "left" : "GO", sub = left > 0 ? "respawning in" : "", 1.1 s. When the countdown ≤ 0 → respawn.

**Respawn local**: reset the player at an arena spawn; set name; clear last-hit records; state `play`; spawn shield = 2 s; tip "spawn protection · 2s" for 1.6 s; burst at the player center (blue, 24 particles, speed 6, life 0.5, size 0.03); spawn sound at the center.

**Spawn shield**: while > 0 the local player ignores all `pdmg` messages. It decays by real dt while playing.

**Tally death (victim, killer)** — host only: victim row deaths += 1 (if the row exists); if killer exists and ≠ victim, killer row kills += 1; send scores; check win.

**`pdead` received** {killer, dir, over, how, crit} from a peer: victim name = remote name ("someone" if unknown); killer name from the score table. If the remote exists: ragdoll it with dir and over; enemy-death sound at its center. how text = how ? " · " + how + (crit ? " headshot" : "") : "". If killer = own id: kills += 1; add score 100 with label "ELIMINATED <victim>" + how text; strong kill sound. Else kill feed: killer known → "<killer> eliminated <victim>" + how text; else "<victim> fell off the map". If host: tally death (sender, killer).

## 21. Free-for-all: scoreboard and score HUD

**Score table**: id → {name, kills, deaths}. **Sorted** order: kills descending, then deaths ascending.

**Send scores** (host): send `score` with rows [{id, name, kills, deaths}] and apply them locally. **Apply scores**: replace the table with the rows and refresh the score HUD. Clients apply `score` messages; the host ignores them.

**Score HUD** (only online): rows = sorted; top = first 3; if the local rank ≥ 4, append the local row. Render each as "rank. name (you) kills", the local row marked, then "first to 20". Also clear the HUD modifier slot. If the scoreboard overlay is open, redraw it.

**Scoreboard overlay**: title "FREE FOR ALL"; one row per sorted entry: "name (you)" and "K kills · D deaths"; footer "first to 20 · lobby CODE". Visibility each frame while online and playing: keyboard → shown while `score` is held; gamepad → a `score` press toggles a latch. Hidden whenever a menu is open. When not online-and-playing, the latch resets to off.

## 22. Free-for-all: win conditions and match end

**Check win** (host, after each tally): ignore if not host, not online, or already over. If any row has kills ≥ 20, winner = {id, name} (the last such row in table order wins ties). Send `end` {winner} and end the match locally.

**Time limit** (host, in the network update, while in match and not over): match clock += real dt. When > 480: winner = the top sorted row (or the host itself if the table is empty); send `end` and end the match.

**End match (winner)**: winner stored; over timer 0; state `over`; end focus; release pointer lock; hide the scoreboard; hide gameplay HUD; show the match-over panel (section 10).

**Return to lobby**: host: 8 s after the end, send `backtolobby` and run the lobby screen action. Client: on `backtolobby`, run the lobby screen action. The lobby keeps its players; a new host start rebuilds the score table.

## 23. Remote player bookkeeping and timeouts

**Add remote (id, name)**: if one exists, update its name and return it. Else create a remote player with team 0 and the red tone; hook its damage callback (see below); store it.

**Remote damage callback** (called when a local grenade blast or a bot hits the remote): ignore unless the target can be hurt (online and not self) and is alive; show a hit marker; send `pdmg` to that peer with {amount rounded, from (blast position rounded to 0.1, or none), by: own id, src: "grenade"}.

**Remove remote (id)**: dispose the remote's meshes; delete it from the map, the lobby players, and the score table.

**Network update** (each frame, real dt, only when the session is active):

1. sync counter += 1. Update every remote with dt and the current time (seconds).
2. **Timeout**: if in match, any remote that has a last-seen stamp and whose stamp is older than 9000 ms is removed with kill feed "<name> lost connection". The stamp is set only by `ps` messages, so a remote that never sent a snapshot never times out this way. If a client times out the host id: leave online with reason "lost connection to the host" and stop this network update. Host also: close and forget that peer's connection, send `leave` {id}, broadcast the lobby, send scores.
3. Every 3rd frame, if in match: relay-broadcast `ps` with the local snapshot (section 27).
4. If the shot queue is not empty: broadcast `shots` {k: current weapon kind, e: the queued end points} and clear the queue.
5. Host, in match, not over: match clock and time limit (section 22).

`ps` received from a peer: push the snapshot into that remote with the current time and stamp its last-seen time (ms).

## 24. Player-versus-player hit resolution

These hooks are provided by this subsystem to the weapon and player subsystems.

**Targets**: the local player followed by all remotes. **Can hurt (t)**: online and t is not the local player.

**Raycast players (origin o, unit direction d, max distance)**: over each remote that is alive and can be hurt:

- For each of its hit spheres (part name, radius): head 0.30, torso 0.33, hips 0.20, armL 0.11, armR 0.11, foreL 0.10, foreR 0.10, legL 0.13, legR 0.13, shinL 0.11, shinR 0.11. Sphere centers come from the remote's animated model. Standard ray–sphere test: tca = dot(c − o, d); reject if tca < 0 or > max; d² = |c − o|² − tca²; reject if d² > r²; t = tca − sqrt(r² − d²); reject if t < 0. Keep the closest hit overall {player, part, distance, point}.
- **Raised blade**: if the remote is blocking, test a sphere at center + forward × 0.5, raised 0.3, radius 0.42, same ray test with tca > 0 and tca ≤ max. It replaces the best hit when there is no best, when the best belongs to a different player, or when it is closer than the best; the part is `blade`.

**Players in arc (position, unit direction, range, cosine of half angle)**: remotes that are alive and can be hurt, with distance from position to center ≤ range + 0.3, and (distance ≤ 0.3 or dot(unit vector to center, direction) ≥ cosine), and line of sight from the position to the center.

**Hit player (target, damage, info {part, point, dir, source, crit})**: ignore if the target cannot be hurt or is dead.

1. Part `blade`: orange burst at the point (8 particles, speed 6, life 0.22, size 0.035); shield-hit sound at the target center. With probability 0.4 the shot **returns**: tracer from the point to the local eye (red, thickness 0.03, life 0.08); tip "RETURNED" 0.9 s; rumble (0.5, 0.4, 90 ms); the local player's last-hit-by = target id and last hit = {from: target center, crit false, amount 0.6 × damage, src "deflect"}; the local player takes 0.6 × damage from the target center. Otherwise tip "DEFLECTED" 0.7 s. Send `parry` {ret, by: own id} to the target. Stop.
2. facing = target blocking ? dot(unit vector from target center to local center, target forward) : −1. frontHit = part starts with head, torso, arm, or fore.
3. **Parried** when facing > 0.6, frontHit, source is katana, and the target's parry window is open: orange burst (10, 6, life 0.25, size 0.04); shield-hit sound; hit-stop (0.08, 0.15); the local katana's cooldown = max(current, 0.6); rumble (0.6, 0.3, 90 ms); tip "PARRIED" 0.9 s. Stop.
4. Else: blood at the point along dir with amount clamp(0.4 + damage/80, 0.4, 1.6) in red; hit marker (not kill, crit flag); hit sound at the target center; flash the target; send `pdmg` to the target {amount rounded, from: local center rounded to 0.1, by: own id, crit, src: source}.

**`pdmg` received** {amount, from, by, crit, src}: ignore unless the local player is alive, the state is `play`, and the spawn shield is 0. Set last-hit-by = by and last hit = {from, crit, amount, src}; apply the damage from the position.

**`parry` received** {ret}: shield-hit sound at self; rumble (0.35, 0.3, 60 ms); orange burst 0.5 in front of the eye (8, 5, life 0.2, size 0.03); kill feed "RETURN TO SENDER" with a displayed "+25" if ret (display only, no score change) else "DEFLECTED".

**Remote grenades**: when the local player throws, the throw {pos, vel} is broadcast as `nade`. On receipt, the local client spawns a foreign grenade with that state. A local grenade blast hurts remotes through the targets list (player subsystem: 12 + 50 × (1 − dd/(0.95 R)) inside 0.95 R), which goes through the remote damage callback above.

## 25. Rope cutting

**Cut ropes (eye, unit direction, range)** — provided to the katana: for each remote that is alive and grappling: hand = body position + right × 0.35, raised 1.25; rope runs from the hand to its hook point. Sample 15 points (i = 0..14, fraction i/14). For each sample relative to the eye: t = dot(sample − eye, direction); require 0.3 ≤ t ≤ range; lateral = sqrt(max(0, |sample − eye|² − t²)); require ≤ 0.9. On the first hit for this remote: orange burst at the sample (10, 5, life 0.25, size 0.035); send `cut` to that peer; tip "ROPE CUT" 0.9 s; stop testing this rope and continue with other remotes. Each remote is cut at most once per call. Return true if any rope was cut, else false.

**`cut` received**: if the local grapple is not idle: detach without boost; orange burst at the center (8, 4, life 0.25, size 0.03); tip "your rope got cut" 1.3 s; rumble (0.5, 0.3, 80 ms).

## 26. Shot tracers over the network

**On shot (end point)** — called by guns for every ray fired: if the session is active and in match, append x, y, z rounded to 0.1 to the shot queue. The queue is flushed once per frame (section 23).

**`shots` received** {k, e} from a peer: require an existing, alive remote with a model. Muzzle = body position + right × 0.3 + forward × 0.8, raised by 1.35 + forward.y × 0.8. Thickness by kind: rifle 0.02, shotgun 0.014, sniper 0.03, else 0.02. For each triple in e draw a tracer from the muzzle to that point (blue, life 0.06). Flash the remote; remote-shot sound for kind k at the muzzle.

## 27. Network message catalogue

Delivery: the host sends to everyone; a client sends to the host, and with the relay flag the host forwards a copy to every other client, stamped with the connection's sender id. "To" messages go to one peer (through the host when sent by a client). Every handler receives the payload and the verified sender id. `broadcast` means "send with the relay flag". Apply the role checks and payload bounds in networking.md §4–5 before forwarding or applying a message. Render network names and status as text, never raw HTML.

| Type | Direction | Payload | Handling |
|---|---|---|---|
| `welcome` | host → joiner | {hostId, code, isPublic} | Network layer only. |
| `refused` | host → joiner | {reason} | Leave online with the reason. |
| `lobby` | host → all | {players [{id,name}], hostId, isPublic, map} | Section 17. |
| `leave` | host → all | {id} | Section 17. |
| `start` | host → all / one | {spawns {id→index}, map} or {late true, spawn index, map, broken [ids]} | Section 18. |
| `startreq` | client → host | {} | Host starts if in state `lobby`. |
| `end` | host → all | {id, name} | End match. |
| `backtolobby` | host → all | {} | Client goes to the lobby screen. |
| `pickup` | host → all | {id, kind, pos [x,y,z]} | Client spawns the pickup with that id. |
| `taken` | host → all | {id} | Remove that pickup. |
| `take` | client → host | {id} | Host removes it and sends `taken`. |
| `ps` | any → all (relay) | snapshot array | Push into the remote; stamp last-seen. |
| `pdmg` | any → one | {amount, from, by, crit, src} | Section 24. |
| `pdead` | any → all (relay) | {killer, dir, over, how, crit} | Section 20. |
| `nade` | any → all (relay) | {pos, vel} | Spawn a foreign grenade. |
| `brk` | any → all (relay) | {id} | Break that prop (not local, with effects). |
| `parry` | any → one | {ret, by} | Section 24. |
| `shots` | any → all (relay) | {k, e [x,y,z,...]} | Section 26. |
| `cut` | any → one | {} | Section 25. |
| `score` | host → all | [{id, name, kills, deaths}] | Clients apply. |

**Snapshot array** (`ps`, sent every 3rd frame ≈ 20 Hz): [x, y, z (2 decimals), yaw, pitch (2 decimals), weapon index, flags, hp (rounded), vx, vy, vz (1 decimal), and hook x, y, z (1 decimal) only while grappling]. Flags bit mask: 1 crouching, 2 sliding, 4 blocking, 8 aiming, 16 on ground, 32 firing, 64 alive, 128 grappling, 256 parry window. The remote player interpolates between snapshots with an 80 ms delay and extrapolates by velocity up to 0.35 s (players subsystem).

## 28. Pickups

Kinds: `ammo` and `health`.

**Spawn (kind, position, optional id)**: build the pickup model; place it at the position raised by 0.6; add to the scene. Record {id (given, or the next local counter starting at 1), kind, mesh, base height, bob phase uniform in [0, 6), life 45}. If host: send `pickup` {id, kind, pos}. Return the record.

**Update (scaled dt)** for each pickup, newest first:

1. phase += dt; height = base + 0.12 × sin(2.5 × phase); yaw += 1.8 × dt.
2. If the local player is alive and the distance from the mesh to the player center < 1.5: collect, remove, and if the session is active send `taken` (host) or `take` (client). Continue with the next.
3. Lifetime (offline or host only): life −= dt; at ≤ 0 remove it, and the host sends `taken`.

**Collect**:

- ammo: every gun gains round(0.4 × its max reserve) reserve ammo; grenades += 1 capped at 5; kill feed "+AMMO · +GRENADE".
- health: `player.heal(35)`; kill feed "TACO · +35 HP" on the Mexico map, else "+35 HP".
- Pickup sound; burst at the mesh (blue for ammo, green for health; 12 particles, speed 4, life 0.3).

**Remove**: take the mesh out of the scene and the record out of the list.

**Ids**: each client has its own counter starting at 1. Only host-made ids travel over the network (`pickup`, `taken`); a client never creates pickups on its own in FFA (wave starts and kill drops are solo only, and the piñata drop is host-only), so ids never collide.

**Sources**: wave start (5 ammo + 2 health at random pickup spots); enemy kill drops (section 14); piñata (2 health, section 29); arena spawner.

**Network handling**: `pickup` {id, kind, pos} → a client (never the host) spawns that pickup with the given id and position (the +0.6 raise applies). `taken` {id} → any client removes the matching pickup if it exists. `take` {id} → the host removes the pickup if it exists and sends `taken` {id} to everyone. A client-side pickup therefore never expires on its own; it goes away on `taken`, on collection, or on reset run.

**Arena spawner** (host only, each frame with real dt while online and playing): clock −= dt; when clock ≤ 0 and fewer than 10 pickups exist: clock = 7; spawn an ammo pickup at a random level pickup spot. The clock starts at 0, so one spawns at once when a match starts.

**Model shapes** (gameplay-relevant sizes): ammo = a can 0.5 tall, radius about 0.23, with a small cap and a label. Health (downtown) = a plus sign made of two 0.6 × 0.2 × 0.2 bars. Health (Mexico) = a taco: a half-cylinder shell of radius 0.42 with filling bars. All bob ±0.12 and rotate 1.8 rad/s.

## 29. Breakable props

Only the Mexico map builds breakables. Each prop has: id (its index in the list), kind, a group of meshes, hit points, center position (base + half height), alive flag, an tone color, and a physics collider tagged with the prop.

| Kind | Footprint (w × h × d) | HP |
|---|---|---|
| pot (small) | 0.9 × 0.9 × 0.9 | 1 |
| pot (big) | 1.2 × 1.3 × 1.2 | 1 |
| crate | 1.1 × 1.1 × 1.1 | 30 |
| barrel | 1.1 × 1.2 × 1.1 | 30 |
| cactus | 0.9 × h × 0.9 (h default 2.6) | 40 |
| piñata | 1.1 × 0.9 × 0.6, hung at height y | 1 |

**Break hit (prop, damage, point, direction)** — called by bullets and blades: ignore if dead; hp −= damage; if hp ≤ 0 → break (direction, local = true); else burst at the point in the prop's tone (5 particles, speed 4, life 0.2, size 0.03) and a shield-hit sound.

**Breakables in arc (position, direction, range, cosine)** — for blades: alive props with distance < range + 0.5 and (distance < 0.4 or dot(unit vector to prop, direction) > cosine).

**Blast breakables (center, radius)** — for grenade blasts: every alive prop closer than 0.9 × radius breaks with direction away from the center.

**Break (prop, direction, local, quiet)**:

1. Ignore if dead. Mark dead; remove its collider from the world.
2. d = the given direction normalized if its length² > 0.01, else random (x, z uniform in [−1, 1], y = 1) normalized.
3. quiet → just remove the group from the scene, stop (used to sync late joiners).
4. Every child mesh detaches into the scene as debris: velocity = d × uniform[2, 6) + (uniform[−3, 3), uniform[2.5, 6.5), uniform[−3, 3)); angular velocity uniform [−9, 9) per axis; radius 0.14; no blood; life uniform [6, 9). Remove the group.
5. Kind effects at the prop center:
   - piñata: three bursts (pink, orange, green; 16 particles, speed 7, life 0.7, size 0.05); a visual explosion of radius 2.5 in pink (adds screen shake 0.5, no damage); offline or host: spawn 2 health pickups at the center offset by uniform [−1.2, 1.2) in x and z; solo: add score 25 with label "PIÑATA".
   - cactus: green blood (amount 1.4) along d and a green pool of size 1.1 on the ground under it.
   - others: burst in the prop tone (12, 5, life 0.35, size 0.04) and 3 smoke puffs upward.
6. Smash sound at the center, heavy for barrel, crate, and cactus.
7. If local and the session is active: broadcast `brk` {id}.

**`brk` received** {id}: break that prop with no direction (random), not local, with effects.

**Restore**: a run reset force-rebuilds the level when any prop is broken, which restores all props. Late joiners receive the broken list in `start` and break those quietly.

## 30. Out-of-bounds rules

Each playing frame, if the player's body is outside the level bounds by more than 8 on any horizontal side, or its y > 150, its y is set to −100. The player subsystem then handles "off the map": at y < −12 (or |x| or |z| > 95) it detaches the grapple, moves the body to the level's solo start, zeroes velocity, deals 20 damage, and shows "OUT OF BOUNDS / respawned at spawn" for 1.8 s. In FFA this can kill; if nobody hit the player since the last respawn the death has no killer and shows as "fell off the map" to others, otherwise the last hitter is credited (section 20).

## 31. Kill feed

The kill feed is a stacked list at the HUD. Each entry is text, followed by "+points" only when the points value is greater than 0 (a value of 0 shows text only). An entry lives 1.7 s and is then removed. At most 6 entries are kept; when a new entry would make 7, the oldest is removed. Entries produced by this subsystem:

| Text | When |
|---|---|
| "<label> +pts" | Score awards with a label (section 14). |
| "CHECKPOINT · WAVE n" | Reaching a new checkpoint. |
| "+AMMO · +GRENADE", "+35 HP", "TACO · +35 HP" | Pickups. |
| "eliminated by <name> · <how> headshot" / "eliminated" | Own FFA death. |
| "ELIMINATED <name> · <how> +100" | Own FFA kill. |
| "<killer> eliminated <victim> · <how>" / "<victim> fell off the map" | Others' deaths. |
| "<name> joined", "<name> left", "<name> lost connection" | Roster changes (host and clients as applicable). |
| "RETURN TO SENDER +25", "DEFLECTED" | A remote's blade turned a local shot (display only). |

## 32. HUD feed each frame

After the simulation, every step pushes:

- Weapon: for a gun, magazine, reserve, magazine size, reloading flag; for the katana, an infinity display.
- Slots: name, active flag, "mag/reserve" or "∞", and empty flag (gun with 0 and 0) for each weapon.
- Grenade count; grapple stamina fraction; health and max; crosshair spread in pixels; then the HUD's own timers update.
- Meter: online → show while playing, fraction = grapple stamina, not ready, label "GRAPPLE". Solo → show when playing and (katana equipped or streak > 0 or focus active); fraction = focus active ? 1 : clamp(streak / 3, 0, 1); ready = focus active; label "KATANA".
- Boss bar: if a boss is tracked and alive, name and hp/maxHp; if it died, hide and clear.

Score HUD updates happen on score changes (section 14) and combo reset. Wave and enemies-left update in the wave update. The PvP score block replaces the wave block while online (the HUD hides wave/left when the PvP score is shown).

## 33. Audio hooks

Audio intensity each frame = clamp((enemies alive + queue length + 2 × remote count) / 12, 0, 1) × (intermission > 0 ? 0.25 : 1).

Sounds triggered by this subsystem: wave start, wave clear, boss roar, kill (strong flag), pickup, spawn, shield hit, smash, dash, katana swing, focus in, focus slash, remote shot, enemy die, hit enemy. Music: tune per map; on/off from the setting; reel-loop stop on pause and menu.

## 34. Interfaces with other subsystems

**Context object** (given to every subsystem at construction): scene, camera, world, level, nav, input, hud, effects, audio, renderer, game state, enemies, player, plus the hooks below. `level` and `nav` are replaced in the context on every level rebuild.

**Provided by this subsystem (called by others)**:

| Hook | Caller | Contract |
|---|---|---|
| hit-stop(duration, scale) | player, enemies | Section 7. |
| add score(points, label) | player, enemies | Section 14. |
| on player death() | player | End focus; solo → dying (section 16); FFA → broadcast and countdown (section 20). |
| targets() | enemies, player grenades | Local player + all remotes. |
| can hurt(t) | player, weapons | Online and t ≠ local. |
| raycast players(o, d, max) | guns | Section 24; returns {player, part, dist, point} or none. |
| players in arc(pos, dir, range, cosHalf) | katana | Section 24. |
| hit player(t, dmg, info) | guns, katana | Section 24. |
| cut ropes(eye, dir, range) | katana | Section 25. |
| break hit(prop, dmg, point, dir) | guns, katana | Section 29. |
| breakables in arc(pos, dir, range, cosHalf) | katana | Section 29. |
| blast breakables(center, radius) | grenades | Section 29. |
| breakable prop record | guns (through the physics hit) | Each prop's collider carries a tag pointing at its prop record; a gun ray that hits such a collider (and no closer enemy) calls break hit with the prop, the gun's damage, the hit point, and the ray direction. The katana uses breakables in arc (range 3.2, half angle 1.0 rad) and passes the prop center as the point. |
| on shot(end) | guns | Section 26. |
| level, nav | enemies, player, effects | Current level record and nav grid. |

**Consumed from other subsystems**:

| Subsystem | What this subsystem uses |
|---|---|
| Player | reset(position); heal(amount) → actual HP restored (dead or non-positive/non-finite amount → 0, capped at max HP); alive; hp, max hp, regen delay, regen rate; grenades, max grenades (5); add ammo to all guns(fraction); take damage(amount, from); name; body position/velocity/on-ground; eye, center, forward, right; weapon list, weapon index, katana index (3), current weapon (kind, name, hint, is gun, mag, reserve, mag size, reloading, spread px); katana: start slash, add blood, cooldown; dash lock; FOV kick; yaw, pitch; spawn shield timer; last-hit-by, last-hit; grapple state, detach grapple(boost); grapple stamina; throw grenade(remote data); on-throw callback; idle camera(time); hurt and flash post amounts; firing flag; weapon-state builder for slash starts. |
| Enemies | spawn(type, position) → enemy {type record (hp, name, score, boss, flying), hp, max hp, alive, state, body, center}; damage(enemy, amount, info); alive count; enemy list; modifiers {speed, damage}; clear(); on-kill(enemy, info, overkill) and on-boss(enemy) callbacks; boss type list. |
| Remote player | construct(ctx, id, name, team, tone); push(snapshot, time); update(dt, now); ragdoll(dir, over); flash(); dispose(); alive, blocking, parry window, grappling, hook point, center, eye, forward, right, body, hit spheres list, visible (current figure exists and is visible), name; damage callback. |
| Network | host({isPublic}), join(code, meta), quick join(meta, status cb), leave(); send(type, data, relay), broadcast(type, data), send to(id, type, data); on(type, handler); active, is host, id, code, host id, is public, max players, connections map; callbacks on peer join(id, meta), on peer leave(id), on disconnect(). |
| Level builder | build(scene, world, key, {arena}) → level record (section 2); level list with key, name, blurb (only "ready" levels are listed). Breakable prop records (section 29) are created by the builder with id = index in the list. |
| Nav grid | construct(world, bounds, cell 1) and build(). |
| Physics world | clear(); remove box(box); overlaps AABB(min, max); overlaps body(body); ground below(x, y, z, max drop); line of sight(a, b). |
| Effects | stroke burst(pos, tone, count, speed, {life, size}); tracer(from, to, tone, thickness, life); blood(point, dir, amount, {tone}); blood pool(pos, size, tone); explosion(pos, radius, tone); smoke(pos, dir, count); debris(mesh, pos, vel, angVel, {radius, blood, life}); shake amount; clear(); update(dt). |
| HUD | show/hide screen(html); gameplay visible(flag); message(main, sub, dur); tip(html, dur); kill(text, pts); set score/wave/timer/modifier/boss/ammo/katana/slots/grenades/grapple stamina/health/spread/focus meter/focus mark/pvp score/board; hit marker(kill, crit); set device(pad); key(action) labels; on screen click callback; update(dt); controls HTML. |
| Input | update(dt); down/pressed/consume(action); request lock, exit lock, pointer locked, using gamepad, any input; rumble(strong, weak, ms); sensitivity and invert fields; on lock change, on device change callbacks. |
| Audio | init, resume, set listener, set tune, music on(flag), music playing, set intensity, reel loop(flag), and the one-shot sounds of section 33. |
| Renderer | scene, camera, render(time, {hurt, flash, slow, lowHp}). |

A debug handle on the window exposes the context, game state, player, enemies, nav, world, level, HUD, effects, input, network, remotes, lobby, scores, and the run-control functions, plus `jumpToWave(n)` — a debug-only restart of the solo run at wave n that no UI reaches. On `localhost` / `127.0.0.1` / `[::1]` only, the query string `?wave=n` makes every solo start (START SOLO, retry after death) begin at wave n instead of 1; any other host ignores it (checkpoints and wave-skip buttons are gone; this is how late waves get tested). It has no gameplay effect.


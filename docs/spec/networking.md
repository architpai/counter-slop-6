# Networking Subsystem Specification

> Current combat changes: [Combat rehaul](combat-rehaul.md). It replaces slot 3, extends flags to 1023 and adds addressed headshot confirmation.

This document describes the multiplayer networking of the game: peer-to-peer transport, lobby discovery, the message protocol, state replication, hit validation, score authority, and the representation of remote players. It is written so that an implementer can build identical gameplay from it alone.

All distances are in world metres, all times in seconds unless a millisecond value is stated explicitly. "Host" means the browser that opened the lobby. "Client" means every other browser in the lobby. "Peer" means either. "Me"/"local" means the browser running the code being described.

## Table of contents

1. [Overview and topology](#1-overview-and-topology)
2. [Transport: PeerJS usage](#2-transport-peerjs-usage)
   - 2.1 Library and configuration
   - 2.2 Peer id namespace
   - 2.3 Lobby codes
   - 2.4 Display names
   - 2.5 Timeouts and constants
3. [Roles and connection lifecycle](#3-roles-and-connection-lifecycle)
   - 3.1 Hosting a lobby
   - 3.2 Joining by code
   - 3.3 Quick play
   - 3.4 Accepting a connection (host side)
   - 3.5 Disconnects, keep-alive, and leaving
   - 3.6 Silent-peer timeout
   - 3.7 Error texts shown to the user
4. [Message envelope and routing](#4-message-envelope-and-routing)
5. [Message catalogue](#5-message-catalogue)
6. [Tick rates and update scheduling](#6-tick-rates-and-update-scheduling)
7. [Local player state encoding](#7-local-player-state-encoding)
8. [Remote player replication](#8-remote-player-replication)
   - 8.1 Snapshot buffering
   - 8.2 Interpolation and extrapolation
   - 8.3 Derived geometry (eye, centre, forward, right, height)
   - 8.4 Hit spheres
9. [Authority and hit validation](#9-authority-and-hit-validation)
   - 9.1 Summary table
   - 9.2 Gun and blade hits on players
   - 9.3 Blade deflection and parry
   - 9.4 Grenades
   - 9.5 Rope cutting
   - 9.6 Damage receipt, spawn protection, death
   - 9.7 Kills, scores, win condition, time limit
   - 9.8 Pickups
   - 9.9 Breakable props
   - 9.10 Bots (enemies) in online play
10. [Lobby synchronisation and match flow](#10-lobby-synchronisation-and-match-flow)
    - 10.1 Lobby state
    - 10.2 Match start and spawn assignment
    - 10.3 Late joiners
    - 10.4 Match end and return to lobby
    - 10.5 Player leaving
11. [Remote player avatar](#11-remote-player-avatar)
    - 11.1 Skeleton and dimensions
    - 11.2 Name tag
    - 11.3 Weapon prop
    - 11.4 Pose and animation
    - 11.5 Grapple rope and hook
    - 11.6 Hit flash and shot tracers
    - 11.7 Death: slump and ragdoll
    - 11.8 Respawn
    - 11.9 Health
12. [Local player settings that differ online](#12-local-player-settings-that-differ-online)
13. [Interfaces with other subsystems](#13-interfaces-with-other-subsystems)

---

## 1. Overview and topology

- The game has no server of its own. Multiplayer runs peer-to-peer over WebRTC data channels. Only the public PeerJS signalling service is used, and only to set up connections. This is what lets multiplayer work from a static deploy.
- Topology is a **star**: every client holds exactly one connection, to the host. The host holds one connection per client. Clients never connect to each other; when a client addresses another client, the host forwards the message.
- The host is authoritative for: the player roster, scores, the win/time-limit decision, pickup spawning and expiry, and the match start/end/return-to-lobby transitions.
- Each peer is authoritative for its **own body**: position, look, movement state, weapon, and its own health. Damage is decided by the **shooter** and applied by the **victim**. Kill credit is declared by the victim.
- The only online game mode is free-for-all deathmatch ("ffa"): first to 20 kills, 8-minute limit, up to 8 players.
- Lobby codes are peer ids. A private lobby has a random 5-character code; a public lobby claims one of 8 well-known ids so quick play can find it without any directory server. A connection only counts once the host has answered with a welcome, so a full or closed lobby can be skipped for the next one.

## 2. Transport: PeerJS usage

### 2.1 Library and configuration

- Library: PeerJS version 1.5.4, loaded as a plain (non-module) script from a CDN (`https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js`) before the game's module script, so a global `Peer` constructor exists. If the global is not a function when a peer is first created, the operation fails with the error "networking library did not load".
- Peer options: debug level 0; ICE configuration with three STUN servers and no TURN:
  - `stun:stun.l.google.com:19302`
  - `stun:stun1.l.google.com:19302`
  - `stun:stun.cloudflare.com:3478`
- The default PeerJS cloud signalling server is used (no custom host/port/path/key).
- Data connections are opened with: reliable = true, serialization = json, and a metadata object carrying the joining player's display name (see 3.2).
- Every envelope is a JSON object (see section 4). Null, arrays, numbers and strings are not envelopes and are ignored. Validate the envelope, role and payload before routing or handling it (sections 4–5). Reliable ordered delivery is assumed for everything; there is no sequence numbering.

### 2.2 Peer id namespace

- All host peer ids are `PREFIX + CODE`.
- PREFIX is `shooter-rebuild-v1-` on a deployed build and `shooter-rebuild-dev-v1-` when the page hostname is exactly `localhost`, `127.0.0.1`, or `[::1]`. This keeps local development separate from deployed rebuild lobbies. 
- Clients do not choose an id; they let the signalling server assign a random one.
- The peer id of a player is its identity everywhere in the protocol (roster, scores, kill attribution, message routing, remote avatar keys).

### 2.3 Lobby codes

- **Private code**: 5 characters drawn uniformly and independently from the 32-symbol alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (letters I and O and digits 0 and 1 are excluded). The code is always shown and compared in upper case. User input is trimmed and upper-cased before use. The code entry field limits input to 5 characters (the transport itself imposes no length limit on a joined code).
- **Public code**: one of `PUB0`, `PUB1`, ..., `PUB7` (8 public slots).
- The host's own id is `PREFIX + code`; the lobby code shown to players is the part after the prefix.
- An explicit code may be supplied when hosting (upper-cased, used verbatim). The design UI never uses this path but the capability exists.

### 2.4 Display names

- The display name is kept in local browser storage. Default when none is stored: the word `recruit` followed by a random two-digit number from 10 to 99 inclusive.
- Stored and typed names are truncated to **14 characters**; the name box on the online screen has a 14-character limit. Typing trims surrounding whitespace; an empty result keeps the previous name.
- The name travels only in the connection metadata at join time (`{ name }`); the host truncates it again to 14 characters and substitutes `recruit` if it is empty or missing. After that the name is distributed by the host through `lobby` and `score` messages. A name change made after joining is not propagated.
- The local player's own body carries the name too, but nothing on the network reads it from there.

### 2.5 Timeouts and constants

| Constant | Value | Meaning |
|---|---|---|
| Public slots | 8 | number of public lobby ids `PUB0`..`PUB7` |
| Private code length | 5 | characters |
| Private code retries | 3 | attempts to claim a random code if the id is already taken |
| Max players | 8 | host counts itself; it refuses when it already has 7 connections |
| Signalling timeout | 12 000 ms | waiting for the peer to open (id registered with the signalling server) |
| Join timeout | 14 000 ms | waiting for a welcome after knocking on one lobby |
| Quick-play timeout | 11 000 ms | waiting for any public lobby to welcome |
| Refuse close delay | 400 ms | host waits this long after sending a refusal before closing the connection |
| Silent-peer timeout | 9 000 ms | a match participant that has sent no state for this long is dropped (section 3.6) |
| Name length | 14 | display names are truncated to 14 characters |
| Kill target | 20 | kills needed to win |
| Time limit | 480 s | match clock limit (section 9.7) |
| Respawn delay | 3.5 s | after a local death online |
| Spawn protection | 2 s | after every respawn (not the initial spawn) |
| Return-to-lobby delay | 8 s | host waits this long in the "over" state |

## 3. Roles and connection lifecycle

### 3.1 Hosting a lobby

Triggered by "CREATE LOBBY" (public or private, chosen by radio buttons; the choice shown is the lobby model's current public flag, which starts true, i.e. public) or by quick play falling through (3.3).

1. Any previous session is torn down (3.5, "leave").
2. The peer is marked as host and its public/private flag is stored.
3. A peer is created with the chosen id:
   - Public: try `PUB0` then `PUB1` ... up to `PUB7`. If creating the peer fails with a PeerJS error of type `unavailable-id`, try the next slot. Any other error aborts hosting with that error. If all 8 are taken, fail with "all public lobbies are busy - host a private one".
   - Private: generate a random code, try to create the peer. On `unavailable-id`, generate a new code and retry, up to 3 attempts total; the third failure (or any non-`unavailable-id` error) aborts with that error.
   - Explicit code: create the peer once with that code; any error aborts.
   - Peer creation itself: resolve when the peer emits "open"; reject if it emits "error" first; reject with "signalling server timed out" if neither happens within 12 000 ms. On rejection or timeout the peer is destroyed.
4. On success: the host's id is the peer id, the host id equals its own id, the peer is marked connected, and "accepting" is set true.
5. The host listens for incoming connections (3.4) and installs the keep-alive handler (3.5).
6. The UI then: sets the lobby model's public flag and map (the host's currently selected map), clears the roster, inserts the host itself with its display name, sets host id, clears status text, sets game state to `lobby`, and shows the lobby screen. Status text while working: "opening a lobby…".

### 3.2 Joining by code

Triggered by typing a code and pressing JOIN (or Enter in the code field). Empty input shows "type the code your friend gave you" and does nothing.

1. Any previous session is torn down; the peer is marked as client.
2. The code is trimmed and upper-cased; an empty code fails with "enter a lobby code".
3. A peer with a server-assigned id is created (same 12 000 ms open rule). The keep-alive handler is installed.
4. **Knock**: open a data connection to `PREFIX + code` with metadata `{ name: <display name> }`. Then wait for the first of:
   - a `welcome` message on that connection → success;
   - a `refused` message → fail with the refusal reason (or "the lobby turned you away" if none);
   - a PeerJS peer-level error of type `peer-unavailable` whose message names this host id → fail with "no lobby with that code";
   - a connection error → fail with that error (or "could not connect" if it is not an error object);
   - the connection closing → fail with "the lobby closed the connection";
   - 14 000 ms elapsing → fail with "no answer from that lobby".
   On failure the connection is closed. If the connection could not even be started, fail with "could not start a connection". The peer-level error listener is removed once the knock settles.
5. **Adopt**: on success the host id is recorded, the connection is stored under the host id, the peer is marked connected, the public flag is copied from the welcome payload, and the connection is wired for data/close/error events (section 4).
6. The UI: copies the public flag, clears status, sets state `lobby`, shows the lobby screen. Status text while working: "connecting…".

Notes:
- The host id in the `welcome` payload is informational; the client keys its connection on the id it knocked on.
- The host id is extracted from a PeerJS error message by taking the first non-space run of characters after the word "peer" in the message text.
- A failed join leaves the client's peer alive but unconnected; the next host/join/quick-play call tears it down.

### 3.3 Quick play

Triggered by "QUICK PLAY".

1. Tear down, mark as client, create a peer with a server-assigned id, install keep-alive. Status: "looking for an open lobby…".
2. Open a data connection to **every** public id `PREFIX + PUB0` ... `PREFIX + PUB7` at the same time, each with metadata `{ name }`.
3. Wait for the first connection that delivers a `welcome`. Attempts that deliver `refused`, error, or close are marked failed. Peer-level `peer-unavailable` errors are matched to an attempt by parsing the host id out of the error message (3.2 note); that attempt is marked failed. An attempt that could not be started counts as failed immediately.
4. If all 8 attempts fail, or 11 000 ms pass, the result is "no winner". Every attempt other than the winner is closed; the peer-level error listener is removed.
5. No winner: tear down and fail with "no open public lobbies". The UI recognises this by the text "no open public" in the error, shows "no open lobbies · opening a public one for you…" and hosts a **public** lobby (3.1). Any other error is shown to the user via the friendly mapping (3.7) instead.
6. Winner: adopt as in 3.2 step 5; the lobby code is the winner's id with the prefix removed. The UI marks the lobby public and shows the lobby screen.

### 3.4 Accepting a connection (host side)

When an incoming data connection opens on the host:

- If the host is not accepting, or already has (max players − 1) = 7 connections: send `refused` with reason "that lobby is closed" (not accepting) or "that lobby is full" (capacity), then close the connection after 400 ms. The connection is never stored, never wired, and never announced.
- Otherwise: store the connection under the remote peer id, wire it for data/close/error, send `welcome` (payload: host id, lobby code, public flag; envelope `from` = host id), then raise the "peer joined" event with the remote's id and its connection metadata (or an empty object if none).
- The design never sets "accepting" to false; the capability exists for a closed lobby.
- Joining is possible in any host state (lobby, match, over); see 10.3.

### 3.5 Disconnects, keep-alive, and leaving

- **Keep-alive**: if the peer reports "disconnected" from the signalling server and the peer is still the current, undestroyed one, call PeerJS reconnect (errors ignored). Established data channels are unaffected by signalling loss; this only restores the ability to accept new joins (host) or to receive peer-level errors (client).
- **Connection drop** (close or error on a stored connection), unless the peer is in the middle of leaving on purpose. A drop on an id that is not stored is ignored.
  - Host: remove the connection, raise "peer left" with that id, and send `leave { id }` to everyone.
  - Client: if the dropped connection is the host's, mark disconnected and raise "disconnected". The UI then leaves online play with the message "the host left the lobby".
- **Leave** (explicit): set a "leaving" flag so that the resulting close events are not treated as other people leaving; close every stored connection; clear the connection table; destroy the peer; reset id, code, host id, host flag, and connected flag; clear the leaving flag. A session is "active" only while a peer exists and the connected flag is set.
- Leaving is triggered by: the LEAVE / LEAVE MATCH buttons, a refusal, the host disconnecting, and the browser `pagehide` event (tab close/navigation) whenever a session is active.
- **Leave online (UI)**: tear down the network, dispose every remote avatar, clear roster and scores, hide the scoreboard; if the game was not on the start screen, set state `start`, mode `solo`, rebuild the non-arena level, reset the game and hide gameplay HUD; clear the menu flag; then show the online screen with the reason as status text (may be empty).
- A `refused` message arriving on an adopted connection (never sent by the design host after welcome, but handled) also triggers leave-online with the given reason.

### 3.6 Silent-peer timeout

Each remote player records the local clock when its most recent state packet (`ps`) arrived. While the local peer is in a match (state `play`, `dying`, or `over`), any remote whose last packet is older than 9 000 ms is removed: its avatar is disposed, it is removed from roster and scores, and the kill feed shows "<name> lost connection". If the local peer is the host it also closes and forgets that peer's connection (bypassing the normal drop handling, so no "peer left" event fires), sends `leave { id }` to everyone, rebroadcasts the lobby roster, and resends scores. A remote that has never sent a `ps` (for example one still on the lobby screen while a match runs) is never timed out by this rule. Clients apply the timeout independently, so a client can drop a remote the host still lists; the next `lobby` message from the host re-adds it.

If the timed-out remote is the client's host id, instead leave online with "lost connection to the host" and stop the current network update. An active data channel without host state must not leave the client in a match without its authority.

### 3.7 Error texts shown to the user

Errors from hosting/joining are mapped to friendly status text, testing in this order:

| Error text contains | Shown |
|---|---|
| (empty) | something went wrong |
| "networking library" | could not load the networking library · check your connection and reload |
| "timed out" or "signalling" | could not reach the matchmaking server · check your connection |
| "no lobby with that code" | no lobby with that code · check it with your friend |
| "no answer" | found the lobby but could not connect · one of you may be on a network that blocks it |
| "full" | that lobby is full |
| anything else | the error text itself |

While a request is in flight every button on the online panel except BACK is disabled.

## 4. Message envelope and routing

Every message is one JSON object with these fields:

| Field | Type | Present when |
|---|---|---|
| `t` | string | always; the message type |
| `d` | any | always; the payload |
| `from` | peer id | on every message the host sends (except `refused`); on client-to-client addressed messages; on relayed copies |
| `to` | peer id | on a client's addressed message (client → host → client) |
| `relay` | boolean | on a client's send to the host: true asks the host to forward to all other clients |

Sending rules:

- **Send (host)**: to every open connection, envelope `{t, d, from: hostId}`. The relay flag is ignored.
- **Send (client)**: to the host only, envelope `{t, d, relay}`. If the host connection is missing or not open, nothing is sent.
- **Broadcast**: send with relay = true. From the host this equals a plain send.
- **Send-to (host)**: to one peer, `{t, d, from: hostId}`; silently dropped if that peer is not connected.
- **Send-to (client)**: to the host, `{t, d, to: targetId, from: ownId}`.
- A sent-message counter and a received-message counter are kept (diagnostics only).

Receiving/routing (per message on a wired connection; `origin` is the peer id of the connection it arrived on):

First validate the envelope and payload bounds in section 5. The envelope must have a known string `t` and its required `d`; optional `to`/`from` are bounded peer-id strings and `relay` is boolean. Net owns these transport checks; main checks current roster ids, map indices and state before applying a payload. Host-only commands are `lobby`, `leave`, `start`, `end`, `backtolobby`, `score`, `pickup`, `taken`, and `refused`. Never accept or forward these from a client. `welcome` is only accepted by an outstanding knock on its requested host connection. `startreq` and `take` go only from a stored client to the host and cannot be relayed or addressed elsewhere. `pdmg`, `parry` and `cut` are addressed events. `ps`, `shots`, `pdead`, `nade` and `brk` are broadcast events; a client's version must request relay and must have no `to`.

1. On the host, the sender is always `origin`; ignore a client's supplied `from`. For an addressed event whose `to` is another stored, open client, forward `{t, d, from: origin}` and stop. Unknown destinations and self-addresses are dropped. An addressed event for the host proceeds to dispatch with sender `origin`.
2. On the host, a valid broadcast event is sent as `{t, d, from: origin}` to every other open connection, not back to origin; then processed locally.
3. Dispatch locally with (payload, verified sender id). A client accepts messages only on its adopted host connection: host-only commands must have `from === hostId` (except `refused`, which has no `from`); gameplay events may carry the host-stamped original sender. Main requires that sender to be a current roster member, other than self. The host requires a stored client origin. `pdmg.by` and `parry.by` must equal the verified sender, else drop the message.

Handlers: exactly one handler per type (registering again replaces). Unknown types are ignored. A client receiving a forwarded addressed message sees `from` = the original sender, so the sender id passed to the handler is the original client, not the host.

Consequence: a peer never receives its own messages. Whenever the host sends a state change it must also apply it locally (the design does this explicitly for scores, match start, match end, lobby roster, pickups).

## 5. Message catalogue

Direction key: H = host, C = client, A = all other peers. "C→A" means the client sends with relay and the host forwards; the host also processes it. Messages marked "any" are sent identically by host and clients.

| Type | From → To | When | Payload |
|---|---|---|---|
| `welcome` | H → joining C | connection accepted | `{ hostId, code, isPublic }` |
| `refused` | H → joining C | lobby full/closed | `{ reason }` – "that lobby is full" or "that lobby is closed"; no `from` field |
| `lobby` | H → A | any roster or map change; every join; every leave; every timeout drop | `{ players: [{id, name}...], hostId, isPublic, map }` |
| `leave` | H → A | a client connection dropped or was timed out | `{ id }` |
| `startreq` | C → H | client pressed START MATCH in the lobby | `{}` |
| `start` | H → A | host starts the match | `{ spawns: { <peerId>: <spawnIndex>, ... }, map }` |
| `start` | H → one C | a client joined while a match is running | `{ late: true, spawn: <spawnIndex>, map, broken: [<breakableId>...] }` |
| `end` | H → A | a player reached the kill target, or the time limit passed | `{ id, name }` of the winner |
| `backtolobby` | H → A | 8 s after the match ended | `{}` |
| `score` | H → A | any score change, join, leave, or match start | `[ { id, name, kills, deaths }, ... ]` (whole table) |
| `ps` | any → A (relay) | every 3rd network tick while in a match | compact array, section 7 |
| `shots` | any → A (relay) | any tick where the local gun fired at least one ray | `{ k: <weapon kind string>, e: [x,y,z, x,y,z, ...] }` |
| `pdmg` | shooter → victim (addressed) | shooter's client decided a hit | `{ amount, from: [x,y,z] or null, by: <shooterId>, crit: bool, src: <source string> }`; the grenade variant omits `crit` |
| `pdead` | victim → A (relay) | victim's health reached 0 | `{ killer: <peerId> or null, dir: [x,y,z] or null, over: bool, how: string or null, crit: bool }` |
| `parry` | shooter → blocker (addressed) | shooter's ray hit the blocker's raised blade | `{ ret: bool, by: <shooterId> }` |
| `cut` | slasher → grappler (addressed) | slasher's blade crossed the grappler's rope | `{}` |
| `nade` | thrower → A (relay) | grenade thrown | `{ pos: [x,y,z], vel: [x,y,z] }` |
| `brk` | breaker → A (relay) | a breakable prop was destroyed locally | `{ id }` |
| `pickup` | H → A | host spawned a pickup | `{ id, kind, pos: [x,y,z] }` |
| `take` | C → H | client collected a pickup | `{ id }` |
| `taken` | H → A | host collected, expired, or confirmed a pickup removal | `{ id }` |

Detailed semantics of each are given in sections 9 and 10. Field formats:

- `src` values: `rifle`, `shotgun`, `sniper`, `katana`, `grenade`, `deflect`. Display words: rifle → "rifle", shotgun → "shotgun", sniper → "sniper", katana → "katana", grenade → "grenade", deflect → "their own bullet"; anything else → no word.
- `k` in `shots`: the local weapon's kind string at the moment of sending (`rifle`, `shotgun`, `sniper`; a blade never queues shots, but if the player switched to the blade in the same step the kind `katana` can be sent — receivers treat unknown kinds as a rifle for thickness and sound).
- Positions in `pdmg.from`, `nade`, `shots.e`, and `pdead.dir` are rounded: `from` and `shots.e` to 1 decimal, `nade` to 2 decimals, `dir` to 2 decimals. `pickup.pos` is unrounded.
- `map` is a level key string; receivers validate it against the known level list and fall back to `downtown` if unknown. A missing `map` leaves the receiver's current lobby map unchanged.
- `spawnIndex` is an integer index into the arena spawn list of the named map (10.2).
- `breakableId` is the integer index of the prop in the level's breakable list (9.9).

### Payload validation bounds

These checks protect the rebuild's input boundary. They do not verify movement or whether a reported shot was possible, and they do not change the wire shape. Drop invalid messages silently before forwarding or use; do not partially apply an invalid row or vector.

- An envelope is at most 16 KiB when encoded as JSON. Peer ids are non-empty strings of at most 128 characters. Names are strings of at most 14 characters; host metadata is type-checked, trimmed and truncated, with empty/missing names replaced by `recruit`. Code and map strings are at most 64 characters; status/error text is at most 256. Unknown map strings still use the documented Downtown fallback. Render all external text through text content or HTML escaping.
- Every numeric field is finite. A position is exactly three numbers, each within ±10000; velocity triples use the same bounds. Direction triples are null or exactly three numbers within ±1. Integer ids and counters are non-negative safe integers; pickup ids start at 1. Boolean fields must be actual booleans. Optional fields may be absent only where the catalogue permits them.
- `ps`: length exactly 8, 11 or 14; finite position/yaw/pitch, pitch within ±1.6; integer weapon index (unknown indices still show a rifle), integer flags 0..511, health 0..120. Optional velocity and hook triples must be complete and bounded. Preserve the missing-velocity and missing-hook behavior of section 7.
- `shots`: string `k` at most 32 characters (unknown kinds retain the rifle fallback); `e` is a non-empty array of at most 90 numbers, length divisible by 3, containing bounded positions. `nade` has complete bounded position and velocity triples. `pdmg.amount` is greater than 0 and at most 100000; `from` is a position or null, `src` a string of at most 32 characters, and absent `crit` defaults to false. `pdead.dir` is a direction or null; `over`/`crit` are boolean, `how` is null or a string of at most 64 characters. An unknown departed `killer` becomes null; it cannot receive kill credit.
- `lobby.players`, `score`, and a `start.spawns` table contain at most 8 unique peer ids. Scores have non-negative safe-integer kills/deaths. Lobby host id must equal the connected host; roster ids must be valid and unique. Spawn indices must be integers within the selected map's spawn list; an omitted index uses the existing fallback. `broken` has at most 4096 integer entries, each a valid breakable index for that map. Main validates indices against the selected map before applying changes.
- `pickup.kind` is `ammo` or `health`, with a valid positive id and position. `taken`, `take`, `leave` and `brk` identify existing objects/peers; unknown ids are ignored. `end` identifies a current score row. `startreq`, `backtolobby` and `cut` carry empty objects. `welcome` must name the requested host and its code, with boolean `isPublic`; `refused.reason` is bounded text. Other required fields have the types shown in the catalogue.

## 6. Tick rates and update scheduling

- The network update runs once per game step whenever a session is active, in every game state (lobby, match, dead, over). The game step runs on the animation frame (nominally 60 Hz) with the step's delta time capped at 0.05 s. The network update always receives the **unscaled** delta time (hit-stop slow-motion does not slow networking).
- **Background stepping**: browsers stop animation frames in hidden tabs; because a hidden host would freeze everybody, a 250 ms timer runs an extra step whenever a session is active and more than 300 ms have passed since the last step. With regular timer-only callbacks this produces one step every 500 ms: roughly 2 Hz and 10% simulation speed, since each step is capped at 0.05 s. Browser throttling can make this slower.
- A network tick counter increments every step. On every step where the counter is divisible by 3 **and** the local peer is in a match (state `play`, `dying`, or `over`), the local state packet `ps` is broadcast. At 60 Hz this is 20 packets per second; in the regular hidden-tab case about 0.67 per second.
- On every step, if the shot queue is non-empty, a `shots` message is broadcast with the whole queue and the queue is emptied (so shots go out at most once per step, at frame rate). This happens in every state, but the queue is only filled while in a match.
- Remote players are interpolated every step using the wall clock in seconds (high-resolution timer / 1000).
- The silent-peer check (3.6) runs every step while in a match.
- The host advances the match clock every step while in a match and not over; see 9.7.
- Remote state packets are time-stamped on **arrival** with the receiver's wall clock; no sender timestamps are transmitted.
- Order within one network update: interpolate remotes → silent-peer check → send `ps` (if due) → send `shots` (if any) → host match clock / time limit.

## 7. Local player state encoding

The `ps` payload is a flat JSON array. Fields in order:

| Index | Content | Quantisation |
|---|---|---|
| 0 | body position x | 2 decimals |
| 1 | body position y (feet) | 2 decimals |
| 2 | body position z | 2 decimals |
| 3 | yaw (radians) | 2 decimals |
| 4 | pitch (radians) | 2 decimals |
| 5 | weapon index | integer 0..3 (0 rifle, 1 shotgun, 2 sniper, 3 blade/katana) |
| 6 | state flags | integer bit field, below |
| 7 | health | integer (rounded to nearest) |
| 8 | velocity x | 1 decimal |
| 9 | velocity y | 1 decimal |
| 10 | velocity z | 1 decimal |
| 11 | grapple hook x | 1 decimal, **only present while grappling** |
| 12 | grapple hook y | 1 decimal, only while grappling |
| 13 | grapple hook z | 1 decimal, only while grappling |

State flag bits (bit value → meaning):

| Bit | Value | Set when |
|---|---|---|
| 0 | 1 | crouching |
| 1 | 2 | sliding |
| 2 | 4 | blocking (katana equipped and guard raised) |
| 3 | 8 | aiming down sights (aim held with a gun) |
| 4 | 16 | on the ground |
| 5 | 32 | firing (fire held with a gun this step) |
| 6 | 64 | alive |
| 7 | 128 | grappling (grapple state is not idle: hook flying or attached) |
| 8 | 256 | parry window open (blocking and the guard has been held for less than 0.55 s) |

The local player's slot list is fixed: rifle, shotgun, sniper, katana (indices 0–3). The weapon index is the current slot even while a temporary quick-melee switch to the katana is in effect.

Decoding rules on the receiver:

- Velocity is taken from indices 8–10 if the array has more than 10 entries, else treated as zero.
- Grappling is true only if bit 128 is set **and** the array has more than 13 entries; then the hook point is indices 11–13. Otherwise the previous hook point is retained but unused.
- Weapon index outside 0..3 shows a rifle.
- A `ps` from an id with no remote avatar (not in the roster) is ignored.

## 8. Remote player replication

### 8.1 Snapshot buffering

Each remote keeps two snapshots, A (older) and B (newer), each holding position, yaw, pitch, and arrival time `t`.

On receipt of a `ps` from a known remote:

- A ← previous B. If there was no previous B (first packet), A ← a synthetic snapshot equal to the new one but time-stamped `t − 0.07`.
- B ← the new position/yaw/pitch with arrival time `t`.
- Weapon prop is switched to the packet's weapon index (rebuilt only if the index changed or the prop is missing).
- Flags are decoded into crouching, sliding, blocking, aiming, on-ground, firing, alive, grappling, parry window. Health is stored. Velocity and hook point are stored as in section 7.
- If alive went true → false, the "dead time" is reset to 0.
- If alive is true and the avatar is currently a corpse (ragdolled), a fresh figure is built, A is discarded (so no interpolation from the death spot), and the body is placed at B. The new figure's weapon index is reset to "none", so the prop is rebuilt from the packet's index on the **next** packet; until then the freshly built figure shows the builder's default rifle (about one packet interval).
- If the figure exists but is hidden (never shown yet), the body is placed at B and the figure is shown.
- The "last seen" clock (3.6) is stamped.

Before the first packet the remote body sits at (0, −50, 0), hidden, with velocity zero, alive = true, health 100, and forward = (0, 0, −1).

### 8.2 Interpolation and extrapolation

Every step, given `now` (seconds), for a remote with a B snapshot:

- `A' = A if present else B`
- `span = max(0.02, B.t − A'.t)`
- `tt = now − 0.08` (render 80 ms behind arrival)
- `k = clamp((tt − A'.t) / span, 0, 1)`
- `target = A'.p + (B.p − A'.p) · k`
- `late = tt − B.t`; if `late > 0`: `target += vel · min(late, 0.35)` — extrapolate along the last received velocity for at most 350 ms.
- If `|target − pos|² > 36` (more than 6 m away): `pos = target` (teleport). Otherwise `pos += (target − pos) · (1 − e^(−22·dt))` (exponential ease with rate 22 per second).
- Body velocity is set to the received velocity (used for animation and ragdoll impulse).
- `yaw = A'.yaw + wrap(B.yaw − A'.yaw) · k` where `wrap` maps an angle into (−π, π] (shortest-arc interpolation); `pitch = A'.pitch + (B.pitch − A'.pitch) · k`.

A remote without any snapshot keeps its current position (hidden at (0, −50, 0)).

### 8.3 Derived geometry

After positioning:

- `speed = |velocity|`
- `height = 1.05 if crouching else 1.75`; body half-width 0.35 (capsule/box extents used by others for overlap checks)
- `eye = pos + (0, 0.88 if crouching else 1.60, 0)`
- `center = pos + (0, height · 0.55, 0)` → 0.9625 standing, 0.5775 crouching
- `forward = (−sin(yaw)·cos(pitch), sin(pitch), −cos(yaw)·cos(pitch))`
- `right = (cos(yaw), 0, −sin(yaw))`
- While dead, dead time accumulates by `dt`.
- The figure root is placed at `pos` with rotation about the vertical axis `yaw + π` (the model's front faces +Z, the game's forward is −Z).

### 8.4 Hit spheres

A remote player exposes 11 named hit spheres, centred on the corresponding skeleton anchor points in world space after posing (11.1), with radii:

| Part | Radius |
|---|---|
| head | 0.30 |
| torso | 0.33 |
| hips | 0.20 |
| armL, armR (upper arm midpoint) | 0.11 |
| foreL, foreR (forearm midpoint) | 0.10 |
| legL, legR (thigh midpoint) | 0.13 |
| shinL, shinR (shin midpoint) | 0.11 |

When the avatar has no figure (ragdolled corpse) all hit spheres are moved to (0, −100, 0) so nothing can hit them. Remote players report a block radius of 0 (the projectile "catch" logic treats them as plain bodies).

## 9. Authority and hit validation

### 9.1 Summary table

| Thing | Who decides | How it propagates |
|---|---|---|
| A player's position/pose/weapon/health value | that player | `ps` |
| Whether a shot hit another player, and for how much | the shooter | `pdmg` to victim |
| Whether to apply damage (alive, in play, not spawn-protected) | the victim | applied locally |
| Death and who gets credit | the victim | `pdead` broadcast |
| Kill/death tallies, win, time limit | the host | `score`, `end` |
| Roster and map | the host | `lobby` |
| Pickups: spawn, expiry, removal | the host | `pickup`, `taken`; clients request via `take` |
| Breakable props | whoever broke it | `brk` (validate id, not the reported hit) |
| Grenade flight | every peer simulates identically from `nade` | thrower decides damage to others, each peer decides damage to itself |
| Bots (enemies) | not present in online matches | (dormant mirror facility; see 9.10) |

There is no movement or hit anti-cheat and no reconciliation. Messages that pass the connection-role and payload checks in sections 4–5 are trusted for their reported gameplay outcome. Basic validation and host authority remain required.

### 9.2 Gun and blade hits on players

The shooter's client provides these hooks to the weapon code. All player-versus-player tests use the **interpolated** (80 ms delayed) remote hit spheres; there is no lag compensation.

- **Targets list**: the local player followed by every remote player. Enemies use this for melee/blast sweeps.
- **Can-hurt test**: a target can be hurt only when the game mode is ffa and the target is not the local player. (In solo, remotes never exist, so this is effectively "online and not me".)
- **Player raycast** `(origin, direction, maxDistance)` → the nearest hit among alive, hurtable remotes, or nothing. For each remote and each hit sphere: standard ray–sphere test; the sphere counts only if the closest-approach parameter `tca` is within `[0, maxDistance]`, the squared lateral miss is ≤ r², and the entry distance `tca − sqrt(r² − miss²)` is ≥ 0. Result carries the remote, the part name, the entry distance, and the world point. Additionally, if the remote is blocking, a **blade sphere** of radius 0.42 centred at `center + forward · 0.5 + (0, 0.3, 0)` is tested (closest-approach parameter strictly > 0 and ≤ maxDistance, entry ≥ 0); a hit there yields part name `blade` and replaces the current best if it is closer, **or** if the current best belongs to a different remote (so a blade in front of its own body always wins over that body).
- **Players in arc** `(pos, dir, range, cosHalfAngle)` → all alive hurtable remotes whose centre is within `range + 0.3` of `pos`, and (when farther than 0.3) whose direction from `pos` has dot product ≥ `cosHalfAngle` with `dir`, and that have line of sight from `pos` to their centre. Used by blade sweeps.
- **Hit player** `(target, damage, info)` where info holds part, point, dir, crit flag, source, and (for guns) distance. Ignored unless the target is hurtable and alive. Otherwise:
  1. If part is `blade` → deflection (9.3), no damage message.
  2. Slash parry check (9.3); if parried, no damage message.
  3. Otherwise: local feedback (blood burst at point along dir, strength `clamp(0.4 + damage/80, 0.4, 1.6)`; hit marker, crit-styled if crit; hit sound at the target's centre; flash the remote figure for 0.08 s), then send `pdmg` to the target with `amount = round(damage)`, `from = shooter centre (1 decimal)`, `by = shooter id`, `crit`, `src = info.source`.
- **On shot** `(endPoint)`: while in a match, append the end point (x, y, z at 1 decimal) to the shot queue; sent as `shots` on the next network update (section 6). Every fired ray reports an end point: the hit point on a player, prop, enemy, or wall, or `origin + dir · 300` on a miss. Receivers draw tracers (11.6).

**Gun rays** (from the weapon code): each pellet casts a ray of maximum length 300 from the shooter's eye along its spread direction. Three candidates are found — nearest enemy hit, nearest world hit (ignoring see-through geometry), nearest player hit — and the player hit wins only if it is nearer than both of the others. Player damage uses a **PvP table** separate from the enemy damage numbers:

| Weapon (kind) | Base damage per pellet | Head multiplier | Pellets | Falloff (near, far, floor) |
|---|---|---|---|---|
| rifle | 19 | 1.8 | 1 | none |
| shotgun | 16 | 1.6 | 10 | 9 m, 26 m, 0.15 |
| sniper | 150 | 1.5 | 1 | none |

- Crit is true when the hit part is `head`.
- `damage = base · (headMul if crit else 1)`; with falloff: `damage *= clamp(1 − (dist − near) / (far − near), floor, 1)` where `dist` is the ray entry distance.
- Each pellet that hits sends its own `pdmg` (a full shotgun blast can send up to 10 messages in one step).
- (A revolver exists in the weapon table with PvP values 52 / ×2.9 / falloff 9–34 m floor 0.42, but it is not in the player's slot list and cannot be fired online.)

**Katana slash** (from the weapon code): at the strike moment of a slash, every remote returned by players-in-arc `(eye, forward, range 3.0, cos(0.95 rad))` is hit for a flat **55** damage with part `torso`, crit false, source `katana`, point = the remote's centre. The same slash also calls cut-ropes with range 3.4 (9.5). A slash that hits anything (enemy, player, rope) gives the attacker hit-stop 0.07 s at 12 % speed, screen shake +0.12, and rumble (0.7, 0.4, 90 ms). The design katana does 75 to enemies; the 55 applies only to players.

### 9.3 Blade deflection and parry

**Bullet meets a raised blade** (part `blade` on the shooter's ray):

- Shooter-side feedback: spark burst at the point, shield sound at the target's centre.
- With probability 0.4 the shot is **returned**: the shooter draws a tracer (thickness 0.03, life 0.08 s) from the point back to its own eye, shows tip "RETURNED" for 0.9 s, rumbles (0.5, 0.4, 90 ms), sets its own last-hit-by to the blocker with a last-hit record `{from: blocker centre (unrounded), crit: false, amount: damage·0.6, src: 'deflect'}`, and applies `damage · 0.6` to itself through its normal take-damage with the blocker's centre as the source (so if it dies, the blocker is credited with "their own bullet"). Otherwise the shooter shows tip "DEFLECTED" for 0.7 s.
- Returned damage bypasses spawn protection and the "in play" check (it is applied directly, not via `pdmg`).
- The shooter sends `parry { ret, by }` to the blocker. The blocker on receipt: shield-hit sound at itself, rumble (0.35, 0.3, 60 ms), spark burst 0.5 m in front of its eye, and a kill-feed line "RETURN TO SENDER" with +25 points if `ret`, else "DEFLECTED" with no points. (The points are only a feed label; online score is kills.)

**Katana slash meets a guard** (evaluated by the attacker before sending damage): the slash is parried and does no damage when **all** hold:

- the victim is blocking (flag bit 4), and
- `facing = dot(normalize(attacker centre − victim centre), victim forward) > 0.6` (facing is −1 when not blocking), and
- the hit part name begins with `head`, `torso`, `arm`, or `fore` (a katana hit always reports `torso`, so this always holds for slashes), and
- `info.source` is `katana`, and
- the victim's parry-window flag (bit 256) is set.

Attacker feedback: spark burst, shield sound, hit-stop 0.08 s at 15 % speed, the attacker's katana cooldown is raised to at least 0.6 s, rumble (0.6, 0.3, 90 ms), tip "PARRIED" for 0.9 s. Nothing is sent to the victim; the victim sees nothing.

Note that a gun ray that reaches a blocking remote's body (missing the blade sphere) is never parried: the front-hit test requires source `katana`.

**Enemy melee vs remote** (contract only; there are no enemies online): a remote counts as blocking a melee if alive, blocking, and `dot(normalize(enemy centre − remote eye), remote forward) > 0.35`. A remote never deflects projectiles.

### 9.4 Grenades

- When the local player throws, the launch position and velocity (2 decimals) are broadcast as `nade`. Launch: `pos = eye + right·0.25 + forward·0.6 − (0, 0.15, 0)`, `vel = forward · (9 + 20·charge) + bodyVel · 0.5 + (0, 3.5 + 2.5·charge, 0)`, charge in [0, 1] (charge builds at 1/1.1 per second while the grenade key is held; throw cooldown 0.55 s; the thrower's grenade count decrements).
- Every receiver spawns an identical grenade at that position and velocity, flagged "not mine". Fuse 2.3 s, gravity 22 m/s², on contact the velocity component into the surface is reflected at 1.45× and the whole velocity scaled by 0.55, the grenade sits 0.16 off the surface, and it comes to rest when slower than 1.2 m/s on a surface whose normal has y > 0.5. Since every peer simulates the same flight from the same start against the same level, explosions happen at (nearly) the same place on every screen. Remote grenades are not rate-limited or counted.
- On explosion (radius R = 6.4, centre = grenade position + (0, 0.25, 0)), on every peer: explosion visual, explosion sound, rumble (0.9, 0.9, 220 ms). Then:
  - **Self damage** from any grenade (own or remote): if alive and `d = |centre − myCentre| < R·0.95`, take `10 + 34·(1 − d/(R·0.95))` (source = the explosion centre, so the damage indicator points at it) with knock-back 9 away from the centre (plus half that upward). This does **not** set last-hit-by or last-hit.
  - **Damage to other players** only if the grenade is "mine": for each alive hurtable remote with `dd = |centre − remoteCentre| < R·0.95`, the thrower calls the remote's take-damage with `12 + 50·(1 − dd/(R·0.95))` and the explosion centre; the remote object's take-damage forwards to the damage hook, which (if still hurtable and alive) shows a plain hit marker and sends `pdmg { amount: round(value), from: centre (1 decimal), by: thrower id, src: 'grenade' }` (no `crit` field) to that player.
  - Breakables (within 0.9·R) and bots (within R, 120 damage) in blast radius are handled by the thrower only.
- Consequence (designed behaviour, preserve unless a design decision changes it): a player caught in someone else's grenade takes **both** the local self-damage and the thrower's `pdmg`, up to 44 + 62 = 106 total at the centre. If the local self-damage alone kills, the killer credited is whatever last-hit-by held from a previous hit (possibly nobody → "fell off the map"); if the `pdmg` arrives first it sets last-hit-by to the thrower.

### 9.5 Rope cutting

The slasher's client provides **cut ropes** `(eye, dir, range)` → boolean. For each alive, grappling remote: the rope runs from the hand point `pos + right·0.35 + (0, 1.25, 0)` to the hook point. 15 sample points (parameter i/14, i = 0..14) are tested: `t = dot(sample − eye, dir)` must satisfy `0.3 ≤ t ≤ range`, and the lateral distance `sqrt(max(0, |sample − eye|² − t²))` must be ≤ 0.9. On the first passing sample: spark burst at the sample, send `cut {}` to that remote, tip "ROPE CUT" for 0.9 s, and stop testing that remote (other remotes are still tested). Returns true if any rope was cut. The katana calls this with range 3.4 on every slash strike.

Receiver of `cut`: if its grapple is not idle, detach without boost, spark burst at its centre, tip "your rope got cut" for 1.3 s, rumble (0.5, 0.3, 80 ms). If the grapple is already idle the message does nothing.

### 9.6 Damage receipt, spawn protection, death

On `pdmg`:

- Ignore unless the local player is alive, the game state is `play` (not `dying`, `over`, or `lobby`), and spawn protection has expired (`shieldT ≤ 0`).
- Record `lastHitBy = by` (or null) and `lastHit = { from, crit (false if absent), amount, src }`.
- Apply the player's normal take-damage with the amount and the from-position (null allowed). Take-damage: health −= amount; last-damage timer reset (delays regeneration); hurt overlay += amount/40 (capped 1); screen shake += `0.2 + amount/80`; hurt sound; rumble (0.8, 0.5, 160 ms); if a from-position exists, a directional damage indicator at angle `atan2(dot(from − eye, right), dot(from − eye, forward))` for 1 s; health ≤ 0 → 0 and die.
- Spawn protection: `shieldT` is set to 2 s after every respawn (tip "spawn protection · 2s" for 1.6 s) and counts down with unscaled time while playing. It does **not** apply to the initial match spawn. It does not block grenade self-damage or returned bullets.

On local death in ffa (health reached 0 by any cause, including falling out of the level, which applies 20 damage after a reset to the level start):

- `killer = lastHitBy` (may be null or stale — it is only cleared on respawn/reset).
- `dir = normalize(myCentre − lastHit.from)` (2 decimals) if a from-position exists, else null.
- `how = display word for lastHit.src` if there is a killer, else null.
- `over = lastHit.crit || lastHit.amount ≥ 90 || lastHit.src == 'katana'` (dismemberment flag).
- Broadcast `pdead { killer, dir, over, how, crit }`.
- Set respawn timer 3.5 s, state `dying`, death timer 0.
- If the local peer is the host, tally the death directly (host does not receive its own broadcast). If this tally ends the match, retain `over`; no later death step may overwrite it with `dying`. Kill feed: "eliminated by <killerName> · <how>[ headshot]" when a killer is known (name looked up in the score table; " · how" only if a word exists), else "eliminated".
- The player's own death routine (before any of this) marks it not alive, plays the death sound, and detaches its grapple without boost; the next `ps` therefore carries alive = false.
- Respawn countdown: each step the respawn timer decreases by unscaled dt; whenever the whole-second ceiling changes (and on the first dying step) the centre message shows the remaining whole seconds ("4", "3", "2", "1") with subtitle "respawning in", or "GO" with no subtitle once the timer reaches 0, each for 1.1 s. When the timer reaches ≤ 0 the player is reset at an arena spawn (10.2), name reapplied, last-hit-by and last-hit cleared, state `play`, spawn protection 2 s, spawn burst effect and spawn sound at the centre.

On `pdead` received (sender = victim):

- Look up the victim avatar; if present, ragdoll it with `dir` and `over` (11.7) and play the enemy-death sound at its centre.
- Kill-feed text: `how` suffix is " · <how>" plus " headshot" if crit, or nothing if `how` is null.
- If `killer` is me: local kill counter +1, +100 score-feed points with label "ELIMINATED <victimName><how suffix>" (combo multiplier is always 1 online), strong kill sound. Otherwise kill feed: "<killerName> eliminated <victimName><how suffix>" when the killer is in the score table, else "<victimName> fell off the map". Victim name is "someone" if the avatar is unknown.
- If I am the host: tally (9.7) with victim = sender, killer = payload killer.

### 9.7 Kills, scores, win condition, time limit

Score table: peer id → `{ name, kills, deaths }`. The host owns it; clients hold a copy. Insertion order is the order rows were added (roster order at match start, join order after).

- **Tally** (host only), given victim and killer: victim deaths +1 (if the victim has a row); if killer exists, killer ≠ victim, and the killer has a row, killer kills +1. Then send scores and check win.
- **Send scores** (host): serialise the whole table as `[{id, name, kills, deaths}]`, send `score`, and apply locally.
- **Apply scores** (client on `score`; host locally): replace the table entirely (clearing rows not present), then refresh the score HUD. The host ignores an incoming `score`.
- **Sorting**: kills descending, then deaths ascending; ties keep insertion order.
- **HUD**: the top 3 rows (rank number, name with " (you)" for self, kills), plus the local row if ranked 4th or lower; footer "first to 20". Showing the PvP score panel hides the wave and enemies-left HUD elements. The full scoreboard (hold the score key — Tab on keyboard — or toggle with the score button on gamepad, never while the menu is open) lists every row with "<kills> kills · <deaths> deaths" and the footer "first to 20 · lobby <code>". It is refreshed on every score application while visible.
- **Win check** (host, only in ffa and not already over): any row with kills ≥ 20 wins (if several, the last iterated). Send `end { id, name }` and end locally.
- **Time limit** (host): while in a match and not over, `matchT += dt` (unscaled dt, every network update). When `matchT > 480`, the winner is the first row of the sorted table (or the host itself with its own name if the table is empty); send `end` and end locally. The match clock is not transmitted; clients show no timer.
- Scores are sent on: match start, every tally, every join during a match, every leave/timeout during a match.

### 9.8 Pickups

- Pickup ids are host-assigned increasing integers starting at 1 (the counter is never reset). Kinds: `ammo`, `health`.
- Host spawns arena ammo pickups: every 7 s (a countdown that starts at 0, so one spawns at once) while fewer than 10 pickups exist, at a random level pickup spot. This spawner runs only for the host in ffa while playing (`play` or `dying`), not during `over` or `lobby`.
- Every host spawn (any kind, any cause) sends `pickup { id, kind, pos }` with the unrounded spawn position (the mesh is raised 0.6 above it locally on every peer).
- Clients on `pickup`: create the pickup with that id and kind (host ignores its own).
- Collection (any peer): when the local player is alive and the pickup mesh is within 1.5 m of the local centre, apply the benefit immediately and remove locally, then send `taken {id}` if host or `take {id}` if client. Benefits: ammo → every gun's reserve gains round(40 % of its maximum reserve) and grenades +1 up to 5, feed "+AMMO · +GRENADE"; health → +35 up to max health, feed "+35 HP" (or "TACO · +35 HP" on the `mexico` map). Pickup sound and burst effect.
- Host on `take`: if the pickup still exists, remove it and send `taken {id}` to everyone (including the taker, harmlessly). Everyone on `taken`: remove if present.
- Expiry: only the host (or a solo game) ages pickups; life 45 s; on expiry the host removes it and sends `taken`.
- Two peers can both collect the same pickup before `taken` arrives; both keep the benefit.
- Piñata props (see 9.9) drop 2 health pickups at random offsets (±1.2 on x and z); online only the host spawns them (and so announces them); clients get them via `pickup`.
- Late joiners do **not** receive existing pickups; they see only pickups spawned after they joined. Pickups are cleared on every game reset (match start, return to lobby).

### 9.9 Breakable props

- Breakables have integer ids equal to their index in the level's breakable list (assigned in build order).
- Whoever breaks a prop locally (bullet, blade, blast) plays the break with a direction and, in a session, broadcasts `brk { id }`. Receivers break the same prop with the full effect but a random upward direction. Validate the sender and integer id, without verifying the reported hit; already-broken or unknown ids are ignored.
- Late joiners receive the list of broken ids in `start.broken` and break them **quietly** (mesh removed, collision removed, no debris/effects/sound, no piñata drops).
- Returning to the lobby (or any game reset) rebuilds the level if any prop was broken, so every match starts with all props intact on every peer.

### 9.10 Bots (enemies) in online play

Online matches spawn no enemies; wave logic runs only in solo. The enemy manager nevertheless contains a dormant "mirror" facility. **No message type carries it and nothing enables it**; it is not part of the live protocol. For completeness, it consists of:

- A host-side snapshot: one row per living enemy: `[id, x, y, z (2 decimals), yaw (2 decimals), state code, round(hp), aim amount (2 decimals), attack timer (2 decimals), fuse-lit flag 0/1, boss-attack flag 0/1]`. State codes: 0 spawn, 1 hunt, 2 stunned, 3 dead.
- A client-side apply: two-snapshot buffering like players (synthetic first A at now − 0.08), rendered 100 ms behind with `k` clamped to [0, 1.2] (slight extrapolation), velocity derived from the position delta per step clamped to 30 m/s, on-ground = |vy| < 0.5, yaw by shortest arc; a spawn state that becomes non-spawn snaps the scale to full; a "kill mirror" that runs the death effects without scoring; and a "client hit" callback fired instead of applying damage.

If enemies were ever present online: enemy projectiles are consumed by remote bodies without damage (capsule test with catch radius 0.5, or 0.9 for blast projectiles, against the remote's centre, eye, and a point 0.55 below the centre); each peer's own client handles its own damage; and enemy melee/blast sweeps that reach a remote route through the remote's damage hook as a `pdmg` labelled `grenade`.

## 10. Lobby synchronisation and match flow

### 10.1 Lobby state

Each peer keeps a lobby model: roster (peer id → name, insertion-ordered), host id, public flag (initially true), status text, code, map key.

- Host: on **peer joined** (id, metadata): name = metadata name truncated to 14 characters, or "recruit" if empty; add to roster; create the remote avatar; broadcast lobby. If a match is running (state `play`, `dying`, or `over`), additionally: add a zero score row if missing, send the late `start` to that peer (10.3), send scores, kill feed "<name> joined".
- Host: on map pick in the lobby screen: set the lobby map and broadcast lobby. Only the host can pick; clients see the buttons disabled. Map buttons appear only if more than one level exists.
- **Broadcast lobby** (host): send `lobby { players: [{id,name}...], hostId, isPublic, map }` (players in roster order, host first) and re-render the lobby screen if on it.
- Client on `lobby`: store host id, public flag, code (its own known code), map (validated, only if present); rebuild the roster from the list in list order; create avatars for every listed player except itself (an existing avatar just has its name updated); dispose avatars not in the list; if in a match, add zero score rows for anyone missing and refresh the score HUD; re-render the lobby screen if in the `lobby` state.
- Lobby screen contents: "LOBBY", "free for all · first to 20 · <n>/8 players", the code, map buttons (host only), a hint (public: "this lobby is public: anyone can quick play in, or type the code"; private: "private lobby: friends type this code under PLAY ONLINE → JOIN"), the player list in roster order (host row marked, own row marked with "you"), START MATCH and LEAVE buttons, status text, and "anyone can start · people can still join once it is running" (fewer than 2 players) or "anyone can start · <n> players in".
- Any player may press START MATCH: the host starts directly; a client sends `startreq` and shows "asking the host to start…". Host on `startreq`: start only if in the `lobby` state (ignored during a match or the over screen).
- The lobby screen is a non-interactive overlay for clicks outside its panel: clicking the page does nothing in the `lobby` and `over` states.

### 10.2 Match start and spawn assignment

Host start:

1. Reset the score table to a zero row per roster entry (roster order).
2. Load the arena variant of the chosen map.
3. Build a shuffled list of arena spawn indices (Fisher–Yates over all arena spawn points of the loaded map; if the level has none, its regular spawn list). Assign to roster members in roster insertion order: member i gets shuffled index `i mod count`. (The `downtown` map has 15 arena spawns, the `mexico` map 13.)
4. Send `start { spawns, map }`; start locally with its own index; send scores.

Start match (every peer, with `late` flag and spawn index):

- Mode ← ffa; load arena map; reset the game (rebuilds the level if any prop was broken; clears enemies, effects, pickups; applies the online player stats, section 12; resets the player at the level start; clears last-hit fields; zeroes the match clock, winner, score/kills/combo).
- If the score table is empty, fill it with zero rows from the roster.
- Place the player at the given spawn index if it is non-null and valid, else at an arena spawn chosen by the "arena spawn" rule.
- Request pointer lock (unless on gamepad), hide screens, show gameplay HUD, state ← `play`; the start-screen panel remembers `lobby`.
- Refresh the score HUD. Message: "FREE FOR ALL" with subtitle "you joined a match in progress" (late) or "first to 20 · everyone is fair game", for 3 s. Tip: "hold <score key> for the scoreboard" (5 s).
- 250 ms later, if still playing without pointer lock on a mouse setup, open the menu overlay "MATCH ON · free for all · first to 20 · CLICK ANYWHERE TO PLAY" (a match started by someone else's click cannot grab the mouse). While the menu overlay is open the player still receives `pdmg` and is still simulated.
- Client on `start`: ignored on the host; set map (validated); call start match with `late` and the spawn index (`spawns[ownId]` if a spawn table was sent, else `spawn`); then quietly break every id in `broken`.

**Arena spawn rule** (respawns and fallbacks): for each spawn point compute the distance to the nearest remote that is alive and whose `visible` getter is true (current figure exists and is visible; 999 if none); sort descending; pick uniformly among the top 3 (or fewer if fewer exist).

**Farthest spawn index** (late joiners, computed by the host): the index maximising the minimum distance to every alive body (host's own player plus alive remotes); ties keep the first; index 0 if the list is empty.

### 10.3 Late joiners

A client that connects while the host is in a match (`play`, `dying`, or `over`) receives, in order: `welcome`, `lobby`, `start { late: true, spawn, map, broken }`, `score`. It enters the match immediately (even if the host is on the "over" screen; it then receives `backtolobby` like everyone else); existing pickups are not replicated; existing remote positions arrive with their next `ps`; remotes that are dead show as standing figures until their `ps` says alive = false (then they slump) — a ragdoll already in progress elsewhere is not replayed.

### 10.4 Match end and return to lobby

- On `end` (or locally on the host): store the winner, reset the over timer, state ← `over`, release pointer lock, hide the scoreboard and gameplay HUD, show "YOU WIN" (if the winner id is mine) or "<name> WINS" ("someone" if no name) with the full sorted table ("<kills> K · <deaths> D") and "back to the lobby in a moment…". Clicking does nothing in this state. `ps` packets continue during `over`; `pdmg` is ignored (state is not `play`).
- The host counts 8 s in the `over` state (unscaled time), then sends `backtolobby` and returns to the lobby screen itself. Clients on `backtolobby` return to the lobby screen (host ignores).
- Return to lobby: load the arena map, reset the game, state ← `lobby`, clear winner and menu flag, hide HUD/scoreboard, show the lobby screen. The roster and scores are kept (scores are reset at the next start).
- The in-match menu (pause key) online does not pause the simulation; it shows "MENU · free for all · lobby <code>", the sorted table ("K · D"), controls, settings, and LEAVE MATCH; closing it (click, jump/confirm key, or pause key) re-requests pointer lock. Losing pointer lock while playing opens this menu automatically.

### 10.5 Player leaving

- Host on peer left (id): look up the name, dispose avatar and remove from roster and scores, broadcast lobby; if in a match, kill feed "<name> left" (or "someone left") and send scores.
- Client on `leave { id }`: dispose avatar, remove from roster and scores; if in a match, kill feed "<name> left" (or "someone left"); re-render lobby screen if on it.
- The host leaving ends the session for everyone (each client gets "the host left the lobby" on the online screen, returning to solo state). There is no host migration.
- A client leaving from the lobby or a match returns to the online screen with an empty status.

## 11. Remote player avatar

Every remote player is drawn as a full-body humanoid figure, positioned as in section 8. All remotes use the same team (0) and the same colour (the red tone); the local player's own props use "blue". The design uses the same humanoid builder as enemies, with weapon `rifle`, scale 1.0, hat `cap`, build widths 1/1/0.033, no shield, no smile.

### 11.1 Skeleton and dimensions

Heights are relative to the feet (root origin). The figure faces +Z in model space and is yawed by `yaw + π`.

- Hips group at y = 0.86 (0.55 while crouching), plus a bob of `|cos(phase)| · 0.07 · walk`. The hips hit anchor is at the hips group origin.
- Torso group at +0.04 above the hips; torso blob 0.30 wide × 0.30 tall × 0.19 deep (half-extents) centred +0.26 above the torso group; torso hit anchor at +0.26.
- Neck cylinder (radii 0.045/0.05, length 0.12) at +0.56; head group at +0.62 above the torso group; head blob half-extents 0.275 × 0.30 × 0.25 centred +0.26 above the head group; head hit anchor at +0.26. A face (eyes, and an alternative "x eyes" set shown when dead) and a hat sit on the head at +0.26.
- Shoulders at (±0.26, 0.46, 0) from the torso group. Upper arm length 0.30 (radius 0.033), forearm length 0.28 (radius 0.030) hanging from the upper arm's end (−0.30), mitten hands (radius 0.076) at the forearm end (−0.28 region; placed at −0.30).
- Legs at (±0.13, −0.02, 0) from the hips: thigh length 0.42 (radius 0.038), shin length 0.42 (radius 0.035) hanging from the thigh end (−0.42), shoes at the shin end.
- Limb hit anchors are the midpoints of each limb segment.
- The gun mount is a group on the right forearm at (0, −0.29, 0.07) local; the muzzle "tip" is at (0, 0.05, 0.78) in gun space for guns, (0, 0.05, 0.92) for a blade. (The tip is not used for remote tracers; see 11.6.)
- Every figure gets a tiny random width jitter (0.95..1.06) on the head; cosmetic.
- Total standing height about 1.75 (matches the body height used for collision).

### 11.2 Name tag

- A tag group is parented to the figure root at height 2.25 above the feet.
- Tag content: a flat rectangle 0.5 wide × 0.28 tall × 0.02 deep, filled in the player's tone, double-sided. **The design draws no text on it**. The rebuild renders the bounded name through render's `makeNameTag(name)` factory: an opaque plaque with a generated canvas-text label, no HTML or external image. The remote owner calls `tag.userData.dispose()` to release its unique texture, material and geometry when removing it, including ragdoll and replacement. Keep this placement and billboard rule.
- Each step the tag is yawed to face the local viewer: `tagYaw = −rootYaw + atan2(viewerEye.x − pos.x, viewerEye.z − pos.z)`.
- Hidden when the figure is ragdolled; rebuilt with the figure on respawn.

### 11.3 Weapon prop

Rebuilt in the right-hand gun mount whenever the weapon index changes. Kinds by index (box sizes are full extents in gun space, +Z pointing along the barrel):

- 0 rifle: default prop from the humanoid builder (body about 0.085 × 0.12 × 0.5 with a 0.34 barrel and a magazine).
- 1 shotgun: body 0.10 × 0.13 × 0.66 centred at (0, 0.02, 0.2); barrel cylinder radius 0.035, length 0.5 at (0, 0.08, 0.5).
- 2 sniper: body 0.075 × 0.11 × 0.6 centred at (0, 0.02, 0.15); barrel radius 0.025, length 0.95 at (0, 0.05, 0.72); scope block 0.06 × 0.07 × 0.22 at (0, 0.13, 0.06).
- 3 blade: blade 0.02 × 0.05 × 0.95 centred at (0, 0.04, 0.42); guard 0.11 × 0.11 × 0.03 at (0, 0.04, −0.06); grip 0.035 × 0.045 × 0.24 at (0, 0.04, −0.19).
- Out-of-range index → rifle.

The weapon in hand must be recognisable at a glance, since it tells other players what the remote can do (blade = can block/parry; sniper = one-shot threat).

### 11.4 Pose and animation

Per step with `sp = horizontal speed` (from the received velocity), `w = walk blend`, `phase`:

- `walk` eases toward `clamp(sp / 4, 0, 1)` with rate 10 per second.
- `phase += dt · (sp · 2.2 + (3 if sp > 0.4 else 0))`; `s = sin(phase)`, `c = cos(phase)`.
- Alive: root tilt eases to 0 (rate 8); normal eyes shown.
- Legs: left thigh `s·0.9·w`, right thigh `−s·0.9·w`, left shin `max(0, c)·1.1·w`, right shin `max(0, −c)·1.1·w`. Airborne (not on ground) overrides: thighs −0.5 / 0.6, shins 1.0 / 0.5.
- `aim = 0 for blade; else 1 if aiming; else 0.8 if sp > 6.5; else 0.95`. `look = clamp(pitch, −1.1, 1.1)`.
- Blade pose (`g = 1 if blocking else 0`): right upper arm x `−0.9 − 0.9g − s·0.6·w·(1−g)`, z `−0.3 − 0.5g`; right forearm x `−1.0 − 0.6g`; left upper arm x `s·0.8·w·(1−g) − 1.4g`; left forearm x `−0.5`. Blocking therefore visibly raises the blade in front of the chest.
- Gun pose: right upper arm x `(−1.35 − look·0.85)·aim − s·0.6·w·(1−aim)`, z `−0.2·(1−aim)`; right forearm x `−0.2`; left upper arm x `(−1.25 − look·0.85)·aim + s·0.6·w·(1−aim)`, y `0.55·aim`; left forearm x `−0.45`. Guns are held up and forward with two hands, tilting with pitch.
- Torso x `−0.2·w + (0.5 if sliding) + (0.25 if crouching)`; torso y `−0.3·aim`.
- Head x `clamp(−pitch, −0.7, 0.7) · 0.7`.
- Rotations are in radians about the joint's local axes; x tilts forward/back, y turns, z tilts sideways.
- Players must be able to read: crouch (lower hips, lean), slide (strong lean), aim (gun raised, torso turned), blocking (blade up), airborne legs, movement speed (stride rate), look direction (head and gun pitch). The firing flag is received but not animated in the design (tracers show shots).

### 11.5 Grapple rope and hook

Shown while the remote is grappling and alive:

- Hand point `H = pos + right · 0.35 + (0, 1.25, 0)`; hook point `G` from the packet.
- A thin cylinder (radius 0.03) from H to G (hidden if the length is under 0.05), and a sphere of radius 0.12 at G.
- Hidden otherwise and when ragdolled.
- The same hand point and hook point are used for rope cutting (9.5), so what a player sees is what they can cut.

### 11.6 Hit flash and shot tracers

- **Flash**: the figure's material switches to filled for 0.08 s (re-triggering restarts the timer). Triggered when the local shooter lands a body hit on it (not on a blade hit or parry) and when a `shots` message from it arrives.
- **Tracers** on `shots` from a remote that exists, has a figure, and is alive: muzzle `M = pos + right·0.3 + forward·0.8 + (0, 1.35 + forward.y·0.8, 0)`; for each complete (x, y, z) triple in `e` draw a tracer from M to the point, thickness by kind (rifle 0.02, shotgun 0.014, sniper 0.03, unknown 0.02), lifetime 0.06 s; then flash the figure and play the remote-shot sound of that kind at M (shotgun and sniper have their own sounds; anything else uses the rifle sound). A `shots` message from a dead or ragdolled remote is ignored entirely.

### 11.7 Death: slump and ragdoll

Two stages:

1. **Slump** (from the `ps` alive flag going false, before `pdead` arrives): the root tilts toward lying flat (rotation about x toward π/2 at rate 5), x-eyes shown, limbs stop animating; the figure stays where the interpolation puts it. Hit spheres still follow the slumped figure but the shooter's can-hurt/alive checks stop damage.
2. **Ragdoll** (on `pdead`; once only per life — a second call is ignored): tag, rope, and hook hidden. Direction `d = normalize(dir)` if given with length² > 0.01, else `(0, 0.4, −1)` normalised.
   - If `over`: detach the head as debris with extra velocity `((r−0.5)·4, 3, (r−0.5)·4)` and radius 0.25; with probability 0.5 also detach a random arm (left or right, equal chance) with extra velocity `((r−0.5)·6, 2, (r−0.5)·6)`, radius 0.12. Detached pieces get velocity `d · (4..8) + extra + (0, 2..5, 0)`, angular velocity uniform in ±8 per axis, bleed, and live 7–10 s.
   - Limbs go limp: each of the 8 limb joints gets rotation x uniform in ±1.2 and z uniform in ±0.6.
   - X-eyes shown. The whole root becomes a debris body with velocity `d · (5..8) + (0, 3.5..5.5, 0) + 0.4 · lastVelocity`, angular velocity uniform in (±4.5, ±3, ±4.5), radius 0.55, bleeding, life 8 s.
   - Blood burst at the centre along d with strength 1.3; a blood pool at the feet with radius 1.2–1.8.
   - The figure reference is dropped: hit spheres move to (0, −100, 0); the remote takes no further hits until respawn; the rope/hook stay hidden.
   (`r` denotes a fresh uniform random in [0,1) each use; `a..b` a uniform random in that range.)

If `pdead` never arrives (lost/relayed after the remote left) the figure stays slumped until the next alive packet or disposal.

### 11.8 Respawn

When a `ps` arrives with alive set while the avatar is a corpse, a fresh figure (with tag and default weapon) is built, the interpolation history is cleared, and the body is placed at the packet position. The correct weapon prop appears with the following packet (8.1).

Disposal (leave/timeout/dispose): the figure (if any), rope, and hook are removed from the scene. Detached debris pieces are owned by the effects system and expire on their own.

### 11.9 Health

The remote's health is known from field 7 of every `ps` (integer, 0..110 online). The design stores it but **draws no health indicator** on the avatar (max health is recorded as 100 and unused). An implementation that must show health (the spec topic requires it) should use this value; the only reference cues are the hit flash, the blood bursts, and the slump/ragdoll on death.

## 12. Local player settings that differ online

On every game reset: max health 110 online (120 solo); regeneration delay 4 s online (4.5 solo); regeneration rate 14 per second online (11 solo). Regeneration runs only when not sprinting and not grappling. Health regeneration is a local matter and simply shows up in the `ps` health field. Grenades reset to 3 (max 5). Score, combo, waves, enemy modifiers, and the "focus slash" ability are disabled online; the focus meter HUD shows grapple stamina instead. The player name is reapplied from the stored display name.

## 13. Interfaces with other subsystems

**Player (local body) → networking**

- Provides per step: feet position, yaw, pitch, velocity, weapon index, crouching, sliding, blocking (katana guard), aiming (aim held with a gun), on-ground, firing (fire held with a gun), alive, health, grapple state and hook point, parry-window flag (blocking and guard held < 0.55 s). Encoded as section 7.
- Grenade throw callback delivering `{pos, vel}` (2 decimals) → `nade` broadcast.
- Fields set by networking/shell: `lastHitBy`, `lastHit`, `shieldT` (spawn protection), `name`, online max health/regen.
- Calls into the player: take-damage(amount, fromPos or null), throw-grenade(remote {pos, vel}), detach-grapple(false), reset(position), and the death callback that networking turns into `pdead`.

**Weapons → networking hooks** (provided by the game shell; see 9.2): targets list, can-hurt, player raycast (range 300), players-in-arc (katana: range 3.0, cos 0.95 rad, 55 damage), hit-player, on-shot (every ray's end point), cut-ropes (katana: range 3.4), plus breakable hooks (break-hit, breakables-in-arc, blast-breakables) whose network effect is `brk`. Weapon kinds: `rifle`, `shotgun`, `sniper`, `katana`; PvP damage tuple per gun (base, head multiplier, falloff).

**Enemies → networking**: targets list (local + remotes); remote objects expose alive, centre, eye, forward, right, body (pos, vel, half-width 0.35, height, on-ground), hit list and hit spheres, take-damage (→ `pdmg` via the damage hook, labelled `grenade`), knock-back (no-op), try-block-melee, try-deflect (always false), block radius 0, and flash. The humanoid builder and weapon-prop builder are shared with enemies (11.1, 11.3).

**Level → networking**: arena spawn list (fallback: regular spawn list), pickup spots, breakable list with ids in build order, level keys (validated; fallback `downtown`), level bounds (a body outside bounds + 8 m or above y = 150 is dropped to y = −100 and dies by falling); the arena variant is loaded for online play.

**Effects → networking**: blood(pos, dir, strength), stroke bursts, tracer(from, to, thickness, life), debris(mesh, pos, vel, angVel, {radius, blood, life}) for ragdolls, blood pools, explosion visuals for grenades, screen shake amount.

**HUD → networking**: kill feed lines (text, points; each line lives 1.7 s, at most 6 lines), tips (text, duration), centre messages (main, subtitle, duration), hit marker (kill flag, crit flag), damage direction indicator (angle), PvP score panel (HTML), scoreboard (HTML or hidden), screens (lobby/online/over/menu), status text, key-name lookup for the score key (Tab / gamepad "Create").

**Audio → networking**: hit-enemy(pos), shield-hit(pos), remote-shot(kind, pos), enemy-die(pos), kill(strong), hurt, pickup, explosion(pos), spawn(pos), death.

**Input → networking**: rumble(strong, weak, ms) requests on parry/cut/hit/return; pointer-lock requests at match start and on menu close; gamepad flag (affects the "click to play" prompt and scoreboard toggle).

**Browser → networking**: local storage for name and map; `pagehide` → leave; hidden-tab interval stepping.


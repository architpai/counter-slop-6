# HUD, Menus and Audio — Specification

> Current combat changes: [Combat rehaul](combat-rehaul.md). It replaces weapon/guard labels, adds MP5/pistol cues and an ACOG overlay, and separates melee from gun ammo.

This document describes the heads-up display, every menu screen, the controls help, and every sound in the game. It describes behaviour only. An implementer who has not seen the design must be able to rebuild identical gameplay from this document.

Units: screen distances are CSS pixels unless a percentage or a viewport unit is given. Times are seconds. Audio gains are linear multipliers (0..1). Frequencies are Hz. MIDI note numbers use 69 = A4 = 440 Hz.

## Table of contents

1. [Page and DOM structure](#1-page-and-dom-structure)
2. [Global HUD states](#2-global-hud-states)
3. [HUD elements](#3-hud-elements)
   - 3.1 Crosshair
   - 3.2 Aim-down-sights and sniper scope
   - 3.3 Grapple reticle and grapple breath bar
   - 3.4 Hit marker
   - 3.5 Damage direction indicator
   - 3.6 Score and combo (top-left)
   - 3.7 Wave, modifier, enemies left, timer (top-right)
   - 3.8 Live mini leaderboard (online)
   - 3.9 Scoreboard overlay (online)
   - 3.10 Boss bar
   - 3.11 Health
   - 3.12 Ammo, tally marks, grenades
   - 3.13 Weapon slots, weapon name, hint
   - 3.14 Tip line
   - 3.15 Centre message
   - 3.16 Kill feed
   - 3.17 Katana / grapple gauge (focus meter)
   - 3.18 Focus target marker
   - 3.19 Damage vignette and screen effects (renderer-owned)
4. [Per-frame HUD update contract](#4-per-frame-hud-update-contract)
5. [Control labels and device switching](#5-control-labels-and-device-switching)
6. [Controls help content](#6-controls-help-content)
7. [Screens and menus](#7-screens-and-menus)
   - 7.1 Overlay and panel behaviour
   - 7.2 Shared blocks: settings, checkpoints, map picker, main-menu button
   - 7.3 Main menu
   - 7.4 Play Online screen
   - 7.5 Lobby screen
   - 7.6 Pause (solo)
   - 7.7 Menu (online)
   - 7.8 Match On (click to play)
   - 7.9 Eliminated (solo game over)
   - 7.10 Match over (online)
   - 7.11 Screen flow and state machine
   - 7.12 Status and error strings
8. [Message, tip and kill-feed catalogue](#8-message-tip-and-kill-feed-catalogue)
9. [Persistence](#9-persistence)
10. [Audio engine](#10-audio-engine)
11. [Sound cue catalogue](#11-sound-cue-catalogue)
12. [Music](#12-music)
13. [Interfaces with other subsystems](#13-interfaces-with-other-subsystems)

---

## 1. Page and DOM structure

The page is a single full-screen document with no page scrolling. A menu panel can scroll within the viewport (see 7.1). Its browser-tab title is "Counter Slop 6".

- A full-screen 3D canvas fills the viewport (fixed, covering the whole window).
- A full-screen HUD layer sits above the canvas. The HUD layer does not receive pointer events (clicks fall through to the canvas), text in it cannot be selected, and anything that overflows it is clipped. The only exception is the menu overlay (see 7.1), which does receive pointer events while shown.
- The HUD is built entirely from DOM elements (not drawn on the canvas). All text in the HUD uses one display font; no icons are image files.

The HUD layer contains, in this order (front-to-back order only matters for the scoreboard overlay, which must sit above the other HUD parts):

| Element | Purpose |
|---|---|
| Scope overlay | full-screen sniper scope mask, ring, reticle |
| Focus meter | vertical gauge on the left edge |
| Focus mark | four corner brackets placed over a target |
| Crosshair | four ticks and a dot at screen centre |
| Grapple reticle | dashed circle at screen centre |
| Grapple breath bar | small bar just below screen centre |
| Hit marker | an X at screen centre |
| Damage indicator container | holds transient direction triangles around screen centre |
| Top-left block | score, combo |
| Top-right block | wave, modifier, enemies left, timer, live mini leaderboard |
| Scoreboard overlay | full scoreboard panel (online, held key) |
| Boss bar | boss name and health bar at top centre |
| Bottom-left block | health bar and number; ammo, reserve, reloading text, grenade icons; tally marks |
| Bottom-right block | weapon slot list, weapon name, hint |
| Tip line | one-line text near the bottom centre |
| Centre message | big main line and a sub line |
| Kill feed | stack of short lines on the right |
| Screen overlay with a panel | menus |

Both the canvas and the HUD layer must exist before the game starts. The game finds the canvas and the HUD root by id and fills the HUD root with the elements above at startup.

Initial state of the HUD at build time (before the first update): score "0"; wave "1"; enemies left "0"; HP number "100"; magazine "30"; reserve "/120"; weapon name "RIFLE"; focus-meter label "KATANA"; all other text empty. The grapple breath bar, the live mini leaderboard and the scoreboard overlay start hidden; the scope, focus meter, focus mark, boss bar, tip, centre message, hit marker and menu overlay start invisible. The first frame of the game loop and the main menu (shown immediately at page load) overwrite these values.

Only one menu overlay exists; showing a screen replaces the panel content. The overlay click handler is installed once at build time and forwards every click on the overlay background to the game (section 7.1).

## 2. Global HUD states

The HUD root carries three boolean states that change what is visible:

| State | Set when | Effect |
|---|---|---|
| "no gameplay" | Any menu is showing that replaces gameplay (main menu, online, lobby, game over, match over). Cleared when play begins or resumes. | Hides: top-left, top-right, bottom-left, bottom-right blocks, crosshair, grapple reticle, kill feed, tip line, boss bar, scope, focus mark, focus meter. Not hidden: hit marker, damage indicator, centre message, scoreboard overlay, grapple breath bar (these are simply not fed while no game is running; the breath bar is hidden anyway because a reset refills breath to 1). |
| "low health" | Health fraction (hp / max hp) < 0.3 | Health bar outline and fill turn to the alert colour (red). |
| "gamepad" | The last input device used was a gamepad (see section 5). | Control labels switch to controller names; anything marked "keyboard only" hides and anything marked "pad only" shows. |

Note: the solo pause screen and the online in-match menu do not set "no gameplay"; the HUD stays visible behind the translucent overlay.

## 3. HUD elements

Positions are given as: left/right/top/bottom offsets relative to the viewport. Sizes are for a desktop viewport. When the viewport is 900 px wide or narrower, the menu title shrinks (92 → 56 px), the two controls columns stack vertically (font 22 → 18 px, gap 10 px), and the centre message main line shrinks (88 → 56 px). Menu panels and buttons also fit the available viewport width (see 7.1 and 7.3).

The replacement look removes decorative panel and text tilt. Keep rotations that form the hit-marker X or show the damage-source direction (3.4–3.5).

### 3.1 Crosshair

- Anchor: exact screen centre.
- Four ticks and a centre dot in the primary alert colour (red). A tiny light drop shadow (1 px blur) keeps it visible over dark backgrounds.
- Top and bottom ticks: 3 px wide × 12 px tall. Left and right ticks: 12 px wide × 3 px tall. Dot: 3 px circle at centre. Tick corners are slightly rounded (2 px).
- Spread gap `s` (px): each tick's inner end sits `s` px from centre (top tick spans from −s−12 to −s; bottom from +s to +s+12; likewise left/right). Default s = 10. The game sets s every frame from the current weapon's "spread in pixels" value (one decimal). Contract with the weapon module: for a gun, spread px = 5 + 900 × current spread (the weapon's eased spread in radians, which grows with movement, recoil and jumping and shrinks while aiming); for the katana, spread px = 4. Tick position changes ease over 0.06 s.
- Katana mode (set whenever the katana is the equipped weapon; cleared for guns): ticks use the tone instead of red, the top and bottom ticks are 16 px tall, and the left and right ticks are not shown. The dot stays.
- ADS mode (see 3.2): the whole crosshair becomes invisible (opacity 0) but still occupies its place.
- Hidden in "no gameplay".

### 3.2 Aim-down-sights and sniper scope

- **ADS**: the player module reports "ADS on" when the equipped weapon is a gun and its aim blend amount exceeds 0.55; off otherwise. ADS on hides the crosshair (3.1). Nothing else changes in the HUD.
- **Scope**: the player module reports "scope on" when the equipped weapon has a scope (the sniper) and its aim amount exceeds 0.62. The scope overlay fades in/out over 0.1 s (opacity 0 ↔ 1). Hidden in "no gameplay". It contains:
  - A full-screen mask that is transparent inside a circle of radius 30 vh (viewport-height units) around the screen centre and fully opaque backdrop colour from radius 30.6 vh outward (a thin soft edge).
  - A ring 60.5 vh in diameter centred on screen, 3.5 px border in the tone, with an inner 7 px band at 12 % tone alpha.
  - A horizontal dashed line 60 vh long and 2.5 px thick through centre; dashes 14 px on, 3 px off. A vertical dashed line likewise.
  - A 5 px red dot at the exact centre.

### 3.3 Grapple reticle and grapple breath bar

**Grapple reticle** — a 30 px diameter circle centred on screen with a 2.5 px dashed tone-coloured border. Three states, set by the player module:

| State | Meaning | Look |
|---|---|---|
| 0 | no grapple target under the crosshair | invisible (opacity 0), scaled 1.6× |
| 1 | a valid grapple target is under the crosshair | opacity 0.9, scale 1, rotated 20° |
| 2 | attached (swinging) | opacity 0.9, solid border, scale 0.65, no rotation |

Opacity eases over 0.1 s, scale/rotation over 0.12 s. The player module re-evaluates the target every 0.08 s while the grapple is idle and reports 1 or 0; it reports 2 when the hook attaches and 0 when it detaches. Hidden in "no gameplay".

**Grapple breath bar** — a 64 × 5 px horizontal bar with a 1.5 px tone border, centred horizontally, its top 26 px below screen centre, at 0.8 opacity. Its fill width is the grapple breath fraction × 100 %, rounded to whole percent. Shown only while the fraction is below 0.995; hidden when full. When the fraction is below 0.2 the border and fill turn red.

Breath rules (player module, listed so the bar can be reproduced): breath starts at 1; firing the hook costs 0.07; while attached it drains at 0.09 per second; otherwise it refills at 0.45 per second on the ground and 0.16 per second in the air; it is clamped to 0..1. The hook cannot be fired below 0.1 (the "Winded" cue and the "grapple needs a breather" tip play instead). When breath reaches 0 while attached the rope detaches and the "out of breath · land to recover" tip shows. A reset refills breath to 1.

### 3.4 Hit marker

- Two 2.5 × 28 px tone-coloured bars crossing at screen centre at +45° and −45° (an X). Normally invisible.
- Trigger: "hit marker (kill?, crit?)". Each trigger restarts a 0.2 s ease-out animation: scale 1.5 → 1.0 and opacity 1 → 0 (restart must work even if the previous animation is still running).
- Kill variant: bars are red and 38 px long. Crit variant: bars 4 px thick. Both can combine.
- Callers (contracts): the enemy module triggers (kill = enemy hp reached 0 from this hit, crit = headshot) on every damaging hit, and (false, false) for a hit absorbed by a shield-bearer's shield; when the enemy module runs as a mirror (enemies simulated elsewhere) it triggers (false, crit) for any non-shield hit; the online layer triggers (false, crit) when your bullet/blade damages another player and (false, false) when your grenade damages one. A slash parried by another player, a bullet turned by their blade, and a hit on a breakable prop give no hit marker.

### 3.5 Damage direction indicator

- Trigger: "damage from angle θ" where θ = atan2(right-component, forward-component) of the vector from the player's eye to the damage source. θ = 0 means straight ahead; positive θ means to the right. Only triggered when the damage has a known source position.
- Each trigger adds one red isosceles triangle (32 px wide, 22 px tall, apex pointing away from centre) whose apex sits 140 px from screen centre, rotated about the screen centre by θ (converted to degrees, clockwise so that θ = +90° places it on the right). It starts at 0.9 opacity and fades linearly to 0 over 1.0 s, then is removed. Several may coexist.

### 3.6 Score and combo (top-left)

- Block anchored at left 9 %, top 3 %; font 30 px; slightly rotated (−1.5°).
- Line 1: the word "SCORE" then the score number in bold.
- Line 2 (combo): "combo x<N>" in red, 26 px, shown only when the combo count N > 1; otherwise an empty line 30 px tall is kept so layout does not jump.
- Update: "set score (score, combo)" is called whenever score changes (each kill/award) and when the combo expires (combo goes to 0). Combo rules (owned by the game loop but visible here): each enemy kill increments the combo and sets a 3.5 s combo timer (game-time, so slowed during hit-stop/focus); when it runs out, combo resets to 0. Points awarded = round(base × (1 + min(combo, 9) × 0.25)); the displayed feed value is the multiplied one.

### 3.7 Wave, modifier, enemies left, timer (top-right)

- Block anchored at right 4 %, top 3 %; right-aligned; font 30 px; rotated +1°.
- Line 1: "WAVE " + bold wave number.
- Line 2 (modifier): red, 22 px, minimum height 26 px. Text is the current wave modifier's name (see catalogue, section 8) or empty.
- Line 3: bold count + " enemies left". Count = alive enemies + enemies still queued to spawn for this wave. Updated every frame while a solo wave runs (not during the intermission, when it keeps its last value, 0). A game reset sets wave 1 and count 0.
- Line 4 (timer): red, 24 px. During the 8 s intermission between solo waves it reads "next wave in <ceil(seconds left)>"; empty otherwise.
- Line 5: the live mini leaderboard (3.8), hidden by default.
- When the mini leaderboard is on, the wave line and the enemies-left line are hidden (online play has no waves).

### 3.8 Live mini leaderboard (online)

- Lives in the top-right block, 20 px font, right-aligned rows.
- Rows: the top three players by kills, plus your own row if you are ranked 4th or lower. Each row: rank ("1." etc., dimmed), name (with " (you)" appended for yourself), bold kill count right-aligned in a 28 px column. Your row is red.
- Below the rows a smaller line (15 px, dimmed): "first to 20".
- Sorting: kills descending, then deaths ascending.
- Refreshed whenever the score table changes (host broadcasts) and when the match starts. Cleared (hidden, wave lines restored) on game reset. Setting it also clears the modifier line.

### 3.9 Scoreboard overlay (online)

- A panel centred horizontally, top at 18 % of the viewport height, minimum width 380 px, 24 px font, rotated −0.5°, drawn above the rest of the HUD. Opaque backdrop-coloured background with an tone border.
- Heading: "FREE FOR ALL" (30 px, letter-spaced, centred).
- One row per player, sorted as in 3.8: left "name" (+ " (you)"), right "<kills> kills · <deaths> deaths". Your row has a faint tone tint.
- Footer (16 px, dimmed, centred, no divider): "first to 20 · lobby <CODE>".
- Visibility (online play only, while state is play or dying): keyboard — shown while the score key (Tab) is held; gamepad — the score button (Create) toggles it. Never shown while a menu overlay is open. Re-rendered live if scores change while it is open. Hidden on match end, on leaving the match and on any game reset.

### 3.10 Boss bar

- Centred horizontally, top at 6 % of viewport height, 420 px wide, hidden unless a boss is alive.
- Boss name (26 px, centred) above a 420 × 20 px bar (2.5 px tone border) with a red hatched fill whose width = max(0, hp / max hp) × 100 %. The fill width eases over 0.15 s.
- Set every frame while a boss is alive; hidden when the boss dies or on reset. Hidden in "no gameplay".
- Boss names: "THE ADMIN", "THE HITBOX", "THE LAG SPIKE".

### 3.11 Health

- In the bottom-left block (left 9 %, bottom 5 %). One row: the label "HP" (26 px), a 210 × 16 px bar (2.5 px tone border, rotated −1°), and the numeric HP.
- Fill width = max(0, hp / max hp) × 100 % (one decimal), eases over 0.15 s. The fill is a diagonal hatch (tone stripes 2.5 px on a 6 px period, −55°).
- Number shown = ceil(hp).
- Below 30 % the "low health" state (section 2) turns the bar red.
- Max HP is 120 solo and 110 online (player module).

### 3.12 Ammo, tally marks, grenades

Second row of the bottom-left block:

- Magazine count in bold, 58 px. Reserve as "/<reserve>" at 28 px, 80 % opacity. While reloading, the text " reloading…" follows in red at 22 px.
- Katana equipped: magazine shows "∞", reserve and reloading text are empty, and the tally is cleared.
- Grenade icons: one small grenade glyph per grenade held (13 × 15 px rounded outline with a 3 × 5 px red "pin" above), 3 px apart, after the ammo text. Re-rendered only when the count changes. Player starts with 3 (also after every reset/respawn), max 5; +1 at every solo wave start and +1 per ammo pickup, both capped at 5; −1 per throw.
- Tally: below the ammo line, a 240 px wide wrapping row of vertical marks, one per round in the magazine, capped at 40 marks. Each mark is 4 × 20 px, rotated +4°, 3 px apart; every 5th mark is rotated −8° and followed by a 10 px extra gap, so the marks read as groups of five. Re-rendered only when the magazine count changes.

The ammo display is refreshed every frame from the equipped weapon (mag, reserve, mag size, reloading flag).

### 3.13 Weapon slots, weapon name, hint

Bottom-right block (right 4 %, bottom 5 %, right-aligned):

- **Slots list** (20 px, 85 % opacity, rows 2 px apart, each rotated +1°): one row per weapon in inventory order (Rifle, Shotgun, Sniper, Katana). Row content: a small number badge (slot index 1–4, 15 px, 1.5 px tone border, rounded), the weapon name, and an ammo column (16 px, 54 px min width, right-aligned) reading "<mag>/<reserve>" for guns or "∞" for the katana.
  - Active row: full opacity, 24 px, underlined with a 2 px tone rule. Inactive rows: 55 % opacity.
  - Empty row (gun with mag 0 and reserve 0): red text.
  - Re-rendered only when any name, active flag, or ammo string changes.
- **Weapon name** (36 px): the equipped weapon's display name.
- **Hint** (20 px, 80 % opacity): the equipped weapon's hint text (supplied by the weapon; may be empty). Weapon name and hint are re-sent by the player module on every weapon switch (including the quick-slash switch to the katana and the automatic return 0.85 s later), and by the game when the input device changes (so a hint may contain control labels, although the current hints do not).

| Weapon | Display name | Hint |
|---|---|---|
| slot 1 | RIFLE | auto · put the red dot on them |
| slot 2 | SHOTGUN | pump · devastating up close |
| slot 3 | SNIPER | scoped bolt action · one shot, one kill |
| slot 4 | KATANA | slash · hold aim to block & return bullets |
| (defined, not in inventory) | REVOLVER | hand cannon · headshots delete |

### 3.14 Tip line

- Centred text line at bottom 17 %, 26 px, tone, fades in/out over 0.4 s to 0.9 opacity. Bold spans inside a tip are red. HTML allowed (bold only).
- "tip(text, duration = 5)" shows the text and starts a countdown; the HUD's per-frame update decrements it (real time) and hides the tip when it reaches 0. A new tip replaces the old one and restarts the countdown.
- Hidden in "no gameplay".

### 3.15 Centre message

- Two centred lines at top 24 %: main (88 px, letter-spacing 3 px, tone, rests rotated −2°) and sub (32 px, 85 % opacity).
- "message(main, sub = '', duration = 2.2)": sets the texts and restarts the main line's entrance animation (0.55 s ease-out: opacity 0 → 1; rotation −7° → −1° at 55 % → −2°; scale 1.7 → 0.95 at 55 % → 1.0; a 3 px blur that clears by 55 %). The sub line has no animation. After `duration` seconds (real time, counted down in the HUD per-frame update) the main line hides and the sub text is cleared. A new message restarts everything.

### 3.16 Kill feed

- Right-aligned stack at right 4 %, top 28 %, 27 px font. New entries are appended at the bottom.
- "kill(text, points)": adds one line. If points > 0 the line is "<text> +<points>" with the "+<points>" part in red; otherwise just the text.
- Each line animates over 1.7 s then is removed: slides in from 30 px to the right with a +3° tilt while fading in during the first 15 %, holds fully visible until 75 %, fades to 0 by 100 %.
- At most 6 lines are kept; adding a 7th removes the oldest immediately.
- Hidden in "no gameplay".

### 3.17 Katana / grapple gauge (focus meter)

- A vertical gauge on the left edge: left 4.5 %, vertically centred, rotated −1.5°, centred text. Fades in/out over 0.25 s.
- Contents top to bottom: a label (17 px, letter-spaced, 80 % opacity), a tube 26 × 168 px (3 px tone border) with a hatched fill that grows from the bottom (fill height = fraction × 100 %, eases 0.18 s), three flame shapes above the tube (hidden unless "ready"), and a "SLASH READY" line (15 px, red) hidden unless "ready".
- Ready state: tube border turns red with a soft red halo, fill becomes red hatch, the three flames appear (16 × 22, 16 × 16, 16 × 18 px, spaced −8/−18/+3 px from centre) and flicker (0.42 s alternating animation, delays 0 / 0.14 / 0.27 s), and "SLASH READY" blinks (1 s cycle, dipping to 35 % opacity).
- "set focus meter(show, fraction, ready, label)": fraction is clamped to 0..1 and the fill only updates when it moved by more than 0.005. When `show` is false nothing else updates.
- Usage (game loop, every frame):
  - Solo: show = playing and (katana equipped, or katana kill streak > 0, or focus active); fraction = 1 if focus is active else streak / 3 (clamped); ready = focus active; label "KATANA". (Focus arms after 3 consecutive katana/focus kills.)
  - Online: show = playing; fraction = grapple breath; ready = false; label "GRAPPLE".
- Hidden in "no gameplay".

### 3.18 Focus target marker

- Four L-shaped corner brackets (each 20 × 20 px, 3 px red stroke) forming a 60 × 60 px box, positioned so its centre is at a given screen pixel position. While shown it pulses: scale 1.0 ↔ 1.18 over 0.5 s, alternating.
- "set focus mark(x, y)" shows it at (x, y) in whole pixels; "set focus mark(none)" hides it (opacity fade 0.1 s).
- Fed by the focus system every frame while focus is active and a candidate enemy exists in front of the camera: (x, y) = the enemy's centre projected to the viewport ((ndc.x × 0.5 + 0.5) × window width, (−ndc.y × 0.5 + 0.5) × window height); hidden if the projection is behind the camera, when the dash starts, when the execution lands, or when focus ends.
- Hidden in "no gameplay".

### 3.19 Damage vignette and screen effects (renderer-owned)

There is no DOM damage vignette. The renderer receives four scalar inputs every frame and draws full-screen post effects from them: `hurt` (player hurt intensity, raised by damage/40 per hit, capped at 1, decays in the player module), `flash` (0.35 on a perfect parry, 0.1 on a normal one, decays), `slow` (1 while time is slowed by hit-stop or focus, else 0), `lowHp` (1 − hp/30 while alive and hp < 30, else 0). See the renderer specification for the look. The HUD's only low-health contribution is the red health bar (section 2).

While any full-screen menu is showing (states start, dead, lobby, over) the camera orbits the level (radius 70, height 30 ± 4, one revolution per ~78 s) as a backdrop.

## 4. Per-frame HUD update contract

Once per frame after simulation, in this order, with `dt` = real frame time (capped at 0.05 s):

1. If the equipped weapon is a gun: set ammo (mag, reserve, mag size, reloading). Else: set katana display.
2. Set slots from the full weapon list (name, active = equipped, ammo string, empty flag).
3. Set grenades (count).
4. Set grapple breath (fraction).
5. Set health (hp, max hp).
6. Set crosshair spread (equipped weapon's spread in px).
7. HUD update(dt): tick the message and tip countdowns.
8. Set focus meter (rules in 3.17).
9. If a boss is tracked: set boss bar (name, hp fraction) or hide it if the boss is dead.

Also per frame: the audio listener is set to the player's eye position and right vector; music intensity is set (section 12).

## 5. Control labels and device switching

The HUD stores which device was used last. The input module reports a device change whenever a keyboard key or mouse button is pressed while the gamepad was active (→ keyboard) or any gamepad stick/button activity occurs while keyboard was active (→ gamepad). On change the HUD toggles the "gamepad" state and the game re-sends the weapon name/hint. Any HUD text that names a control looks the label up by action name:

| Action | Keyboard/mouse label | Gamepad label |
|---|---|---|
| fire | LMB | R2 |
| aim | RMB | L2 |
| block | RMB | L2 |
| jump | Space | ✕ |
| sprint | Shift | L3 |
| slide | C | ○ |
| dash | C | ○ |
| grapple | Q | L1 |
| melee | F | R1 |
| reload | R | □ |
| grenade | G | R3 |
| focus | both mouse buttons (or X) | L2 + R2 |
| next | wheel | △ |
| pause | Esc | Options |
| confirm | Space | ✕ |
| score | Tab | Create |

An unknown action name is shown as itself.

Edge cases: at startup the HUD is told the current device (keyboard unless a gamepad has already produced input). Mouse *movement* alone marks the mouse as the active device for gameplay purposes but does not fire the device-change event, so the HUD labels stay on controller names until a key or mouse button is pressed. Gamepad activity means: a stick moved beyond its 0.14 dead zone or any mapped button pressed (value > 0.35).

Actual input bindings (input module, for reference of what "confirm", "score", "music" mean on screens): keyboard — W/A/S/D or arrows move, Space jump, Shift sprint, C or Left Ctrl crouch/slide, R reload, Q or E grapple, F or V melee, 1–5 slots, Esc or P pause, Enter confirm, G grenade, X or Left Alt dash, M music, Tab score; mouse — left fire, right aim, middle/back grapple, forward melee, wheel next/previous weapon. Gamepad (standard mapping) — cross jump, circle crouch/slide, square reload, triangle next weapon, L1 grapple, R1 melee, L2 aim, R2 fire, Create score, Options pause, L3 sprint, R3 grenade, d-pad up grenade, d-pad down slot 5, d-pad left previous weapon, d-pad right next weapon, button 17 (touchpad) confirm. A button counts as pressed when its analogue value exceeds 0.35.

## 6. Controls help content

The controls block is a two-column table (columns 46 px apart, left-aligned, 22 px, line height 1.35). Column headings are 26 px with a 2 px tone underline. Key names are bold and red. Exact text, one line per row (" · " and "/" are literal):

**Column 1 heading: MOUSE + KEYBOARD**
1. **WASD** move   **Mouse** look   **Shift** sprint
2. **LMB** fire / slash   **RMB** aim down sights / block
3. **Space** jump (again on a wall = wall jump)
4. **Space** again in the air = double jump
5. **C / Ctrl** slide on the ground · air dash in the air
6. **Q / E** grapple: tap to swing, hold to reel, jump to launch
7. **F** quick katana slash   **R** reload   **M** music
8. **G** grenade · hold it to throw further
9. **Tab** scoreboard (online)   **Esc** pause
10. **Both mouse buttons** dash-slash once the gauge is lit
11. **1-4 / wheel** rifle · shotgun · sniper · katana

**Column 2 heading: PS5 CONTROLLER**
1. **L stick** move   **R stick** look   **L3** sprint
2. **R2** fire / slash   **L2** aim / block
3. **✕** jump   **○** slide · air dash
4. **L1** grapple (hold to reel, ✕ to launch)
5. **L2 + R2** dash-slash once the katana gauge is lit
6. **R1** quick katana slash, then back to your gun
7. **□** reload   **△** next weapon
8. **R3 / d-pad up** grenade · hold to throw further
9. **Create** scoreboard (online)   **Options** pause

This block appears on the main menu, the solo pause screen and the online menu screen. On viewports ≤ 900 px wide the two columns stack.

## 7. Screens and menus

### 7.1 Overlay and panel behaviour

- The screen overlay covers the whole viewport, is translucent (backdrop colour at 55 % alpha so the game/idle camera shows through), receives pointer events, shows a pointer cursor, and centres a panel.
- The panel: centred text, max width 980 px, padding 26 px top/bottom and 48 px sides, near-opaque backdrop background, tone border, slightly rotated (−0.6° in the design only). Use border-box sizing; the panel's outer width and height must not exceed the viewport. Reduce side padding on narrow viewports as needed. Allow vertical scrolling inside the panel when its content is taller than the available height, so all controls remain reachable. The canvas and gameplay HUD stay fixed.
- Text styles inside a panel: title (h1) 92 px letter-spaced; subtitle (h2) 36 px normal weight; "go" prompt line 34 px that blinks (1.2 s cycle, 35 % opacity at mid-cycle); stats line 30 px with red bold numbers; footnote tip 21 px at 80 %.
- Clicking anywhere on the overlay fires the "screen click" action (7.11). Interactive blocks inside the panel (buttons, inputs, settings box, online box, checkpoints box, map picker) stop the click from reaching the overlay, and the settings/online boxes also stop key presses from reaching the game's key handler so typing in a text box does not move the player.
- "show screen(html)" replaces the panel content and shows the overlay; "hide screen" hides it. Only one screen exists at a time.
- The Space / ✕ key (jump), the confirm input, and — on the pause screen only — the pause key are equivalent to clicking the overlay while in the start, pause or dead states. While playing with a menu open, jump/confirm resume.

### 7.2 Shared blocks

**Settings block** (bordered top, 21 px, column of rows):
- "look sensitivity" + a range slider (min 25, max 250, step 5, current value) + a red bold readout "<value>%". Live: mouse sensitivity = 0.0022 × value/100 rad per pixel; pad look speed X = 3.4 × value/100 and Y = 2.6 × value/100 rad/s; saved immediately.
- Checkbox "invert vertical look" (saved immediately).
- Checkbox "music" followed by a dimmed "(M)". Toggling starts/stops music immediately and saves the preference.

**Checkpoints block**: shown only when the saved checkpoint wave is ≥ 5. The word "checkpoints" then one button per multiple of 5 up to the checkpoint: "WAVE 5", "WAVE 10", … Clicking one starts a fresh solo game at that wave (full reset, then that wave). Checkpoints are recorded when a solo wave that is a multiple of 5 starts and is higher than the saved one.

**Map picker**: shown only if two or more maps exist. The word "map" then one button per map showing the map name over a smaller blurb. The selected map is highlighted (inverted colours). Buttons are disabled when the viewer may not pick (in a lobby, only the host may). Maps: "COUNTER SLOP 6" — "streets, rooftops and fire escapes"; "MEXICO" — "a sun-baked plaza · piñatas, tacos and mariachi" (only if that map is available in the build). Picking on the main menu saves the choice and re-renders the menu; picking in a lobby (host) updates the lobby's map and re-broadcasts the lobby to all.

**Main-menu button**: a single outline button "MAIN MENU" in its own row. It goes to the main menu: state start, solo mode, arena off, full game reset, grapple reel loop stopped, pointer lock released.

### 7.3 Main menu

- Title: COUNTER SLOP 6
- Subtitle: a tactical survival shooter, allegedly
- Buttons (stacked, centred): a large primary "START" with the sub-label "solo · survive the waves" (width = min(420 px, available panel content width), 54 px text); below it "PLAY ONLINE" with sub-label "free for all · up to 8 players" (30 px, in the alert colour).
- Then: map picker, controls help (section 6), settings block, checkpoints block, and if a best score > 0 is saved: "best score: <best>" (22 px, 80 %).
- START or clicking anywhere on the overlay begins a solo game (state start → play; full reset; wave 1). PLAY ONLINE opens the Play Online screen.

### 7.4 Play Online screen

- Title: PLAY ONLINE
- Subtitle: free for all · first to 20 · up to 8 players
- Rows:
  1. "your name" + a text box (max 14 characters, prefilled with the saved/generated name). Typing updates the name live (trimmed, cut to 14; an empty box keeps the previous name), saves it, and applies it to the player.
  2. Big button "QUICK PLAY" + hint "jumps into an open public lobby, or opens one for you".
  3. A wider-spaced row containing just "or".
  4. Button "CREATE LOBBY" + two radio options: "public" and "private · friends only" (the last-used visibility is preselected; public by default).
  5. "have a code?" + a 5-character code box (placeholder "CODE", forced uppercase, letter-spaced) + button "JOIN". Enter inside the code box presses JOIN. Empty code → status "type the code your friend gave you".
  6. Status line (red, 20 px, min height 26 px): shows connection progress or the last error.
  7. Outline button "BACK" → clears the status and returns to the main menu.
- While a connection attempt runs, every button except BACK is disabled (40 % opacity). A failed attempt only replaces the status text; the buttons stay disabled until the screen is rendered again (BACK, then PLAY ONLINE).
- Flows: QUICK PLAY tries to join an open public lobby (the network layer reports the progress text "looking for an open lobby…"); if there is none it shows "no open lobbies · opening a public one for you…" and creates a public lobby. CREATE LOBBY shows "opening a lobby…" then opens the lobby screen as host. JOIN shows "connecting…" then opens the lobby screen. Failures show a friendly error (7.12) and re-enable the buttons on the next render.
- Clicking the overlay background does nothing here (state is still "start" but the screen is not the main one).

### 7.5 Lobby screen

- Title: LOBBY
- Subtitle: free for all · first to 20 · <n>/8 players
- Rows:
  1. "code" + the lobby code in a large dashed red box (52 px, letter-spaced).
  2. Map picker (host may pick; others see it disabled).
  3. Hint: public → "this lobby is public: anyone can quick play in, or type the code"; private → "private lobby: friends type this code under PLAY ONLINE → JOIN".
  4. Player list (one row per player, name on the left; the host's name is followed by " · host" dimmed; the right column reads "you" on your own row; your row has a faint tint).
  5. Buttons: big "START MATCH" and outline "LEAVE".
  6. Status line, then hint: "anyone can start · people can still join once it is running" when fewer than 2 players, else "anyone can start · <n> players in".
- START MATCH: host starts the match for everyone; a non-host sends a start request and shows status "asking the host to start…" (the host starts on receipt if still in the lobby). LEAVE: leaves the network and returns to the Play Online screen with an empty status.
- The lobby screen is fully re-rendered every time the lobby roster/map/visibility changes (this resets any focus inside it).
- Clicking the overlay background does nothing in the lobby.

### 7.6 Pause (solo)

Opened by the pause key during solo play, or automatically when pointer lock is lost while playing with a mouse and no menu is open (the same lock-loss rule opens the online Menu, 7.7, during a match). The game state becomes "pause" (simulation stops); the HUD stays visible under the overlay; the grapple reel loop sound is stopped; pointer lock is released.

- Title: PAUSED
- Subtitle: wave <wave> · score <score>
- Controls help, settings block, MAIN MENU button.
- Prompt: CLICK ANYWHERE (or press <confirm label>) TO RESUME
- Resume (click, jump, confirm, or pause key): hides the overlay, re-requests pointer lock (mouse users), and continues the same game.

### 7.7 Menu (online)

Opened by the pause key during an online match. The game keeps running (state stays "play"; a "menu open" flag is set) so the player can be hit while the menu is up.

- Title: MENU
- Subtitle: free for all · lobby <CODE>
- Scoreboard rows (24 px, min width 360 px): name on the left, "<kills> K · <deaths> D" on the right; your row tinted.
- Controls help, settings block, an outline button "LEAVE MATCH" (leaves to the Play Online screen).
- Prompt: CLICK ANYWHERE (or press <confirm label>) TO KEEP PLAYING
- Resume: clears the menu flag, hides the overlay, re-requests pointer lock (mouse users). The pause key toggles it closed as well.

### 7.8 Match On (click to play)

Shown 0.25 s after an online match starts if the pointer is not locked and no gamepad is in use (the browser only grants pointer lock on a user gesture, and the match may have been started by someone else). Sets the menu flag.

- Title: MATCH ON
- Subtitle: free for all · first to 20
- Prompt: CLICK ANYWHERE (or press <confirm label>) TO PLAY
- Click/jump/confirm resumes exactly like 7.7.

### 7.9 Eliminated (solo game over)

Solo death: the player dies, the state becomes "dying" for 1.7 s (the game keeps simulating for the death animation), then the state becomes "dead", pointer lock is released, "no gameplay" is set, and this screen shows. If the final score beats the saved best, the best is saved.

- Title: ELIMINATED
- Stats line: you survived **<waves>** wave(s) · **<kills>** kills · score **<score>** followed by either " · **NEW BEST**" or " · best <best>". ("wave" is singular when waves = 1.)
- Checkpoints block, MAIN MENU button.
- Prompt: CLICK (or press <confirm label>) TO DRAW AGAIN
- Click/jump/confirm: full reset and a new solo game at wave 1.

### 7.10 Match over (online)

Triggered when the host detects a player reaching 20 kills, or when the match clock passes 480 s (host picks the top-ranked player as winner). State "over"; pointer lock released; scoreboard overlay hidden; "no gameplay" set.

- Title: "YOU WIN" if you are the winner, else "<winner name> WINS" ("someone WINS" if the name is unknown).
- Scoreboard rows as in 7.7.
- Blinking line: back to the lobby in a moment…
- Overlay clicks do nothing. After 8 s the host sends everyone back to the lobby and all clients show the lobby screen (arena rebuilt, game reset).

### 7.11 Screen flow and state machine

Game states: `start` (menus: main / online), `lobby`, `play`, `pause` (solo only), `dying`, `dead` (solo), `over` (online). A separate "menu open" flag marks an overlay shown while state is `play` (online menu, Match On).

Start-screen sub-screens: `main`, `online`, `lobby`. Whenever the game state is `lobby`, the sub-screen is forced to `lobby`.

Screen click / jump / confirm handling:

| State | Effect |
|---|---|
| over, lobby | nothing |
| start | if the main sub-screen is showing: begin solo game; otherwise nothing |
| play with menu open | resume (7.7) |
| pause | resume solo |
| dead | new solo game |

Pause key: in `play` → if the menu flag is set, resume; else pause (solo: state pause; online: menu flag) and release pointer lock. In `pause` → resume.

Beginning play ("begin common"): create/resume the audio context, request pointer lock unless a gamepad is in use, start music if wanted and not playing, hide the overlay, clear "no gameplay", clear the menu flag.

Pointer-lock loss during mouse play (no menu open) → pause. Clicking the canvas during play without lock re-requests lock. While in play, not in a menu, without lock and without a gamepad, the tip "click to grab the mouse" shows for 2 s every 2.5 s (first after 0.5 s).

Leaving online (host left, refused, LEAVE, LEAVE MATCH, lost connection): network torn down, remote players removed, scores cleared, scoreboard hidden; if not already in `start`, switch to start/solo, rebuild non-arena level, full reset, "no gameplay"; the Play Online screen shows with the given reason as status.

Music key (M) works in every state: toggles the preference, starts/stops the music, and shows the tip "music on" / "music off" for 1.5 s.

Hidden-tab keep-alive: while networked, if no animation frame has run for more than 300 ms, a 250 ms timer runs game steps (with the usual 0.05 s cap) so a host who switches tabs does not freeze the match; the HUD and audio are updated by those steps as usual.

### 7.12 Status and error strings

Progress: "opening a lobby…", "connecting…", "asking the host to start…", "no open lobbies · opening a public one for you…", and whatever progress text the network layer's quick-join reports.

Errors mapped from the network layer (first match wins): a message mentioning the networking library → "could not load the networking library · check your connection and reload"; "timed out"/"signalling" → "could not reach the matchmaking server · check your connection"; "no lobby with that code" → "no lobby with that code · check it with your friend"; "no answer" → "found the lobby but could not connect · one of you may be on a network that blocks it"; "full" → "that lobby is full"; empty → "something went wrong"; anything else is shown verbatim.

Raw messages the network layer can produce (for the mapping above): "networking library did not load"; "signalling server timed out"; "all public lobbies are busy - host a private one" (hosting a public lobby when every public slot is taken; shown verbatim); "no open public lobbies" (quick play; handled by creating a public lobby, never shown); "no lobby with that code"; "no answer from that lobby"; "the lobby turned you away"; "could not connect"; "the lobby closed the connection"; "could not start a connection"; "enter a lobby code". Reasons sent by a host to a refused joiner: "that lobby is full" (8 players), "that lobby is closed". Host disconnect: "the host left the lobby". LEAVE / LEAVE MATCH give an empty status.

## 8. Message, tip and kill-feed catalogue

### Centre messages (main / sub / duration)

| Trigger | Main | Sub | Duration |
|---|---|---|---|
| Solo wave n starts, not a boss wave | WAVE n | wave 1: "they are pushing · hold the site"; otherwise the modifier name if one is active, else one at random of: "tone harder", "keep sketch", "stay off the ground", "swing for it", "return their bullets" | 2.6 |
| Boss wave starts (n multiple of 5) | WAVE n | "<BOSS NAME> IS COMING" | 3 |
| Solo wave cleared | WAVE n CLEARED | catch your breath · +<200 × n> | 2.5 |
| Online match starts | FREE FOR ALL | "first to 20 · everyone is fair game", or "you joined a match in progress" for a late joiner | 3 |
| Online respawn countdown (3.5 s): at the moment of death and every time the remaining time crosses a whole second | "4" (at death, since ceil(3.5) = 4), then "3", "2", "1" after 0.5 s, 1.5 s, 2.5 s, and "GO" at 3.5 s when the player respawns | "respawning in" (empty for GO) | 1.1 |
| Player fell out of the level (solo or online): teleported to start, −20 HP | OUT OF BOUNDS | respawned at spawn | 1.8 |

Wave modifier names (top-right line and wave sub-line): "" (none), "CAFFEINATED · they move fast", "JUICED · they hit harder", "SWARM · more of them, thinner". Waves 1–3 and boss waves: none; waves 4–5 pick from the first three; from wave 6 from all four.

### Tips (text / duration); bold parts shown red; `<label>` = control label for the current device

| Trigger | Text | Duration |
|---|---|---|
| Wave 1 start | hold **<grapple>** to reel in · tap it again to let go mid-swing | 7 |
| Wave 2 start | block with **<block>** and some of their bullets go back at them | 7 |
| Wave 3 start | kills in the air are worth more · stay off the floor | 7 |
| Wave 4 start | **<grenade>** lobs a grenade · pickups give you more | 7 |
| Wave 5 start | press **<jump>** again in the air for a double jump | 7 |
| Focus (dash-slash) becomes ready | **SLASH READY** · hold <focus> to dash | 2.2 |
| Focus dash blocked by geometry | blocked · the dash did not reach | 1.2 |
| Your bullet parried by another player and returned | RETURNED | 0.9 |
| Your bullet parried by another player, not returned | DEFLECTED | 0.7 |
| Your slash parried by another player | PARRIED | 0.9 |
| You cut another player's grapple rope | ROPE CUT | 0.9 |
| Your rope was cut | your rope got cut | 1.3 |
| Grapple breath ran out mid-swing | out of breath · land to recover | 1.4 |
| Grapple attempted with breath below 0.1 | grapple needs a breather | 0.9 |
| Online respawn | spawn protection · 2s | 1.6 |
| Online match start | hold **<score>** for the scoreboard | 5 |
| Music toggled | music on / music off | 1.5 |
| No pointer lock while playing (mouse) | click to grab the mouse | 2 (every 2.5) |

### Kill feed entries (text, points as displayed; 0 = no "+N")

Every entry with points goes through the score award: displayed and added points = round(base × (1 + min(combo, 9) × 0.25)); an entry with 0 points shows no "+N" and adds nothing. For an enemy kill the combo has already been incremented by that kill before the multiplier is read.

Solo enemy kill: label = enemy display name (GRUNT, RUSHER, HEAVY, SNIPER, SHIELD MAIN, LIVE NADE, ATTACK DRONE, THE ADMIN, THE HITBOX, THE LAG SPIKE), base points = enemy score value (100, 120, 260, 180, 200, 150, 140, 2500, 3200, 3600). Modifiers applied in this order, later ones replacing the label: headshot → "HEADSHOT" +60; katana → "CUT DOWN" (or "SLICED" if overkill) +50; focus execution → "EXECUTED" +150; deflected-bullet kill → "RETURN TO SENDER" +120; fall → "FELL OFF THE MAP"; then, if the player is airborne (and the kill was not by deflect or fall), " · AIRBORNE" is appended and +40. Final points = round(total × combo multiplier).

Other entries (base points, multiplied as above): "YANKED" 30 (grapple pulled an enemy); "SHIELD BROKEN" 40; "PERFECT PARRY" 60 / "BLOCKED" 15 (projectile parry); "BLOCKED" 40 (melee parry); "PIÑATA" 25 (solo, breaking a piñata); "+AMMO · +GRENADE" 0 (ammo pickup); "+35 HP" or on the Mexico map "TACO · +35 HP" 0 (health pickup); "CHECKPOINT · WAVE n" 0; wave-clear bonus 200 × n is added to the score with no feed line.

Online: you killed someone → "ELIMINATED <victim>[ · <weapon>[ headshot]]" 100 (weapon word: rifle, shotgun, sniper, katana, grenade, "their own bullet"); someone else killed → "<killer> eliminated <victim>[ · <weapon>[ headshot]]" 0 or "<victim> fell off the map" 0; you died → "eliminated by <killer>[ · <weapon>[ headshot]]" 0 or "eliminated" 0; a remote player parried your bullet → "RETURN TO SENDER" 25 or "DEFLECTED" 0; "<name> joined", "<name> left", "<name> lost connection" (0; "someone" when the name is unknown).

## 9. Persistence

Browser local storage keys (all strings):

| Key | Content | Default |
|---|---|---|
| cs6_best | best solo score | 0 |
| cs6_music | "1" on, "0" off | on (anything but "0") |
| cs6_checkpoint | highest checkpoint wave reached | 0 |
| cs6_name | player name, ≤ 14 chars | "recruit" + a random two-digit number 10–99 |
| cs6_sens | look sensitivity percent | 100 |
| cs6_invert | "1" inverted | not inverted |
| cs6_map | selected map key | "downtown" (unknown keys fall back to it) |

## 10. Audio engine

All sound is synthesised; there are no audio files.

- **Context**: created lazily on the first pointer-down or key-down anywhere, and when play begins; resumed on those events, when play begins, and every 2 s while playing if any input has occurred (browsers suspend audio until a gesture). If the platform has no audio API, every call is a no-op.
- **Graph**: every sound → its own envelope gain → (optional stereo panner) → master gain (0.55) → dynamics compressor (threshold −16 dB, ratio 5, other parameters default) → output. Music has its own gain (0.05) feeding the master directly, bypassing panning.
- **Noise source**: a 2 s buffer of uniform white noise (−1..1), looped; each noise voice starts at a random offset 0–1.5 s into it.
- **Positional model** ("pos" given): distance d from the listener (the player's eye) to the source: volume × 1 / (1 + 0.09 d). If d > 0.5 and stereo panning is available: pan = clamp(((sx − lx) × rightX + (sz − lz) × rightZ) / d, −1, 1) × 0.75, where (rightX, rightZ) is the listener's right vector on the ground plane. Non-positional sounds are centred at full volume.
- **Noise voice** (parameters: duration, gain, filter type [default low-pass], frequency, optional end frequency, Q [default 1], attack [default 0.002], optional extra high-pass, delay, position): noise → biquad filter (frequency sweeps exponentially from start to end over the duration; end clamped to ≥ 20 Hz) → optional high-pass → envelope. Envelope: 0.0001 at start, linear to `gain` at start+attack, exponential to 0.0001 at start+duration; the source stops at duration + 0.05.
- **Tone voice** (parameters: waveform [default sine], frequency, optional end frequency, duration, gain, attack [default 0.005], delay, position, or an explicit output node): oscillator with the same exponential frequency sweep and the same envelope shape.
- **Music noise voice**: as the noise voice with attack 0.003, no sweep, routed to the music gain.
- **Grapple reel loop**: a continuous voice — looped noise → low-pass 380 Hz, Q 0.7 → gain that eases from 0.0001 toward 0.05 with a 0.12 s time constant. Stopping eases the gain to 0 with a 0.05 s time constant and ends the source 0.3 s later. Only one instance exists; starting while running or stopping while stopped does nothing.
- `rand(a, b)` below means a uniform random value in [a, b) drawn per trigger.

## 11. Sound cue catalogue

Format: waveform/filter, frequency (→ end frequency if it sweeps), duration, gain, extra options. "pos" = positional at the given world position; otherwise non-positional. "delay t" = starts t seconds after the trigger.

Timing of the weapon cues (weapon module): a gun's fire cue plays on every shot; the shotgun and the sniper have a cycle (pump / bolt) after each shot: it starts 0.12 s after the shot and lasts 0.45 s (shotgun) or 0.85 s (sniper), and the "Pump" cue plays once when cycle progress exceeds 45 % (the first update after 0.3225 s for the shotgun or 0.5025 s for the sniper, measured from the shot); after a shell-by-shell reload that ends with a pending pump, the cycle runs without the 0.12 s offset. Reload durations: rifle 1.45 s, sniper 2.1 s (magazine type), shotgun 0.45 s per shell, revolver 1.9 s (cylinder type). A magazine-type gun that runs dry auto-reloads 0.25 s after the emptying shot if not already reloading.

| Cue | Trigger | Layers |
|---|---|---|
| Rifle shot | your rifle fires | noise band-pass 1200→250 Q0.7, 0.17 s, 0.7; noise high-pass 2800, 0.06 s, 0.45; triangle 160→40, 0.15 s, 0.6 |
| Shotgun fire | your shotgun fires | noise low-pass 1800→120, 0.32 s, 0.9; noise high-pass 2500, 0.08 s, 0.5; triangle 110→30, 0.28 s, 0.7 |
| Sniper fire | your sniper fires | noise band-pass 1400→90 Q0.5, 0.45 s, 0.95; noise high-pass 3500, 0.07 s, 0.7; sawtooth 260→30, 0.4 s, 0.8; sine 1800→400, 0.5 s, 0.16, delay 0.05 |
| Revolver | the revolver fires (weapon defined but not in the inventory; unused) | noise band-pass 900→180 Q0.6, 0.22 s, 0.85; noise high-pass 3000, 0.05 s, 0.6; sawtooth 200→35, 0.22 s, 0.7; sine 2600→900, 0.12 s, 0.12 |
| Pump | shotgun pump / sniper bolt, part way through the cycle after a shot (timing above) | noise band-pass 1500 Q1.5, 0.05 s, 0.35; noise band-pass 900 Q1.5, 0.06 s, 0.35, delay 0.09 |
| Shell | (a) shotgun shell reload: at reload start and after each inserted shell except the last; (b) revolver cylinder reload at 30 % of its duration (unused); (c) a thrown grenade bounces off geometry (each bounce with velocity into the surface) | noise high-pass 2500, 0.04 s, 0.3; square 1400→900, 0.05 s, 0.08 |
| Cylinder | revolver reload start (unused) | noise high-pass 2000, 0.05 s, 0.3; square 700→400, 0.12 s, 0.1, delay 0.05; noise high-pass 1800, 0.06 s, 0.35, delay 1.6 |
| Reload | a magazine reload (rifle, sniper) starts: a four-part sequence | noise high-pass 2500, 0.04 s, 0.35; noise band-pass 600 Q2, 0.12 s, 0.2, delay 0.25; noise high-pass 2000, 0.05 s, 0.4, delay 0.9; square 900→500, 0.06 s, 0.15, delay 1.25 |
| Empty | fire pressed on a gun with an empty magazine (a reload starts at the same time); grapple fired with no target under the crosshair | noise high-pass 3000, 0.03 s, 0.3 |
| Winded | grapple attempted with breath < 0.1 | triangle 220→140, 0.14 s, 0.1 |
| Katana swing | every katana slash starts (fire press or held combo, the quick-slash key, a blocked focus dash); a rusher's swing that lands out of reach | noise band-pass 500→3000 Q1.5, 0.2 s, 0.35 |
| Katana hit | a slash connects with at least one enemy, player, rope or breakable prop | noise low-pass 900→200, 0.14 s, 0.6; noise band-pass 2500 Q0.6, 0.1 s, 0.35; triangle 180→70, 0.12 s, 0.4 |
| Parry | you block a projectile (normal) or block an enemy melee | sines at 2200, 3300 and 4700, each sweeping to 92 % of itself, 0.35 s, 0.16; noise high-pass 4000, 0.05 s, 0.5 |
| Perfect parry | you block a projectile within 0.26 s of raising the guard | Parry, plus triangle 880→1760, 0.25 s, 0.2, delay 0.03 |
| Grapple fire | grapple launched | noise high-pass 1500, 0.1 s, 0.4; sawtooth 500→1500, 0.18 s, 0.18 |
| Grapple hit | hook attaches to geometry, or yanks an enemy | noise high-pass 2000, 0.04 s, 0.45; square 300→200, 0.08 s, 0.25 |
| Grapple release | let go of the rope without a launch boost | sawtooth 900→300, 0.12 s, 0.12 |
| Reel loop | on while attached to geometry; off on detach, pause, menu, reset | see section 10 |
| Footstep(f) | every 2.0 m walked (2.5 m sprinting) on the ground; f = clamp(horizontal speed / 8, 0.3, 1) | noise low-pass rand(400, 800), 0.07 s, 0.12 × f |
| Jump | ground jump, double jump, grapple launch (jump while attached) | triangle 260→480, 0.1 s, 0.1; noise low-pass 600, 0.05 s, 0.1 |
| Land(h) | landing; h = clamp(−landing velocity / 14, 0, 1.5) | noise low-pass 350, 0.14 s, 0.15 + 0.35 h |
| Slide | slide starts | noise low-pass 1200→300, 0.45 s, 0.18 |
| Wall jump | wall jump | noise low-pass 700, 0.08 s, 0.25; triangle 300→600, 0.12 s, 0.12 |
| Mantle | ledge mantle | noise low-pass 900→300, 0.2 s, 0.2 |
| Dash | air dash, katana lunge, focus dash start | noise band-pass 800→2500 Q1, 0.25 s, 0.3 |
| Hurt | you take damage | sawtooth 200→90, 0.2 s, 0.35; noise low-pass 500, 0.12 s, 0.3 |
| Death | you die | sawtooth 220→30, 1.2 s, 0.4; noise low-pass 800→80, 0.8 s, 0.35 |
| Hit enemy (pos) | your shot/blade damages an enemy body (non-crit) or another player | noise low-pass 900, 0.06 s, 0.3; square rand(200, 260)→120, 0.1 s, 0.15 |
| Headshot (pos) | your hit is a critical (head) hit on an enemy | noise high-pass 3000, 0.05 s, 0.5; triangle 1500→500, 0.09 s, 0.2 |
| Kill(strong) | you kill an enemy (strong = headshot or boss); you kill a player online (strong) | square 880, 0.07 s, 0.22; square 1320, 0.16 s, 0.2, delay 0.07; sine 140→50, 0.16 s, 0.6 if strong else 0.35; strong only: triangle 1760, 0.22 s, 0.12, delay 0.14 |
| Enemy die (pos) | an enemy dies; a remote player dies | sawtooth rand(160, 220)→40, 0.4 s, 0.3; noise low-pass 600→100, 0.3 s, 0.4; noise band-pass 1400 Q1, 0.12 s, 0.3, delay 0.03 |
| Gib (pos) | an enemy is overkilled into pieces | noise low-pass 500→120, 0.2 s, 0.45; noise band-pass 2000 Q0.8, 0.1 s, 0.3, delay 0.02 |
| Splat (pos) | (defined; intended for splashes, no trigger) | noise low-pass 700, 0.08 s, 0.15 |
| Spawn (pos) | an enemy spawns; you respawn online | five noise bursts band-pass rand(2500, 5000) Q2, 0.04 s, 0.25, at delays 0, 0.05, 0.10, 0.15, 0.20 |
| Lunge (pos) | rusher starts its lunge | sawtooth 200→700, 0.3 s, 0.25 |
| Bullet impact (pos) | an enemy projectile hits geometry (50 % chance per impact) | noise high-pass 1500, 0.05 s, 0.25 |
| Ricochet (pos) | your bullet hits plain geometry (no enemy, player or breakable), with probability 0.25 per ray, at the hit point | sine rand(2000, 3500)→800, 0.15 s, 0.12 |
| Pickup | ammo or health pickup collected | triangle 700→1100, 0.1 s, 0.2; triangle 1100→1500, 0.15 s, 0.2, delay 0.09 |
| Wave | a solo wave starts | triangles 440, 554, 659, 880, each 0.22 s, 0.18, at delays 0, 0.11, 0.22, 0.33 |
| Wave clear | a solo wave is cleared | triangles 659, 880, 1108, 1318, each 0.3 s, 0.16, at delays 0, 0.13, 0.26, 0.39 |
| Tick | (defined; no trigger) | noise high-pass 4000, 0.02 s, 0.2 |
| Hitstop | (defined; no trigger) | sine 60, 0.1 s, 0.3 |
| Switch weapon | weapon switch by slot key, wheel, next/previous, quick-slash key and the automatic return to the previous gun (not the silent switch done by a reset) | noise band-pass 1800 Q1.5, 0.05 s, 0.25 |
| Heartbeat | (defined; no trigger) | sine 55, 0.15 s, 0.35; sine 50, 0.12 s, 0.25, delay 0.18 |
| Focus in | focus (dash-slash) becomes ready from a cold state | sine 1200→420, 0.45 s, 0.3; noise band-pass 2400→500 Q1.2, 0.35 s, 0.2 |
| Focus slash | focus execution lands | noise band-pass 600→4000 Q1.2, 0.3 s, 0.55; triangle 180→60, 0.3 s, 0.55; sines 1600 and 2400 each sweeping to 60 %, 0.35 s, 0.14, delay 0.04 |
| Explosion (pos) | grenade, bomber, boss death, enemy blast projectile | noise low-pass 900→60, 0.7 s, 0.9; triangle 80→25, 0.6 s, 0.7; noise band-pass 3000 Q0.7, 0.15 s, 0.4 |
| Fuse (pos) | bomber arms its fuse, then every 1/8 s while the fuse burns | noise high-pass 5000, 0.12 s, 0.25 |
| Flyer dive (pos) | backdrop wasp begins a dive | sawtooth 900→300, 0.35 s, 0.2; noise band-pass 2500→800 Q1, 0.3 s, 0.15 |
| Flyer buzz (pos) | backdrop wasp hovering, random with probability 1.5 × dt per frame | sawtooth rand(380, 460), 0.14 s, 0.05 |
| Stomp (pos) | Admin stomp lands (0.75 s after wind-up); Hitbox charge hits a wall; Hitbox scrub lands (0.9 s after wind-up); LagSpike hop lands | noise low-pass 400→60, 0.4 s, 0.8; sine 60→25, 0.5 s, 0.7 |
| Boss roar (pos) | boss wave announced (at the player), boss spawns, boss winds up a stomp/charge/burst | sawtooth 90→60, 0.9 s, 0.5; noise band-pass 500 Q0.8, 0.8 s, 0.4 |
| Shield hit (pos) | a hit lands on a shield; a shield breaks; a breakable prop is damaged but not broken; another player's blade deflects or parries you; your parry notice arrives from the network | square rand(600, 800)→300, 0.12 s, 0.2; noise high-pass 3000, 0.05 s, 0.3 |
| Airdrop | (defined; no trigger) | triangle 660, 0.15 s, 0.15; triangle 880, 0.2 s, 0.15, delay 0.15 |
| Crate land (pos) | (defined; no trigger) | noise low-pass 500→80, 0.3 s, 0.6 |
| Smash (pos, big) | a breakable prop breaks; big for barrels, crates and cacti | noise low-pass (900 if big else 1600)→200, 0.28 s if big else 0.14 s, 0.7 if big else 0.45; noise high-pass 3500, 0.05 s, 0.35; triangle (120 if big else 220)→60, 0.12 s, 0.25 |
| Remote shot (kind, pos) | another player's gun fires (once per network shot batch) | shotgun: noise low-pass 1600→150, 0.32 s, 1.0; triangle 95→30, 0.26 s, 0.7. Sniper: noise band-pass 750→120 Q0.5, 0.4 s, 1.0; sawtooth 420→50, 0.32 s, 0.5. Rifle/other: noise band-pass rand(1000, 1500)→220 Q0.8, 0.16 s, 0.85; noise high-pass 2600, 0.05 s, 0.4; square 200→50, 0.12 s, 0.45 |
| Enemy shot (pos) | grunt/shield-bearer bullet (each round of a burst), boss throw/burst (first shot) | noise band-pass rand(900, 1500)→200 Q0.8, 0.14 s, 0.5; square 220→60, 0.1 s, 0.3 |
| Enemy shotgun (pos) | heavy fires | noise low-pass 1500→150, 0.3 s, 0.7; triangle 90→30, 0.25 s, 0.5 |
| Enemy sniper shot (pos) | sniper fires | noise band-pass 700→120 Q0.5, 0.35 s, 0.7; sawtooth 400→50, 0.3 s, 0.35 |
| Sniper aim (pos) | sniper passes half of its aim time (once per aim) | sine 1800, 0.12 s, 0.12 |

## 12. Music

Two tunes exist; the current one is selected by map ("mexico" map → mariachi tune; every other map → the 8-bit theme). Switching tunes restarts the tune from its first step 0.1 s later (only if music is running).

### 12.1 Scheduler

- Music is on when the preference is on and play has begun (also auto-started every 2 s while playing if wanted, not running, and the context exists). Turning it off fades the music gain to 0 with a 0.2 s time constant and stops scheduling. Turning it on creates a fresh music gain at 0.05.
- A timer fires every 100 ms and schedules every step whose start time is less than now + 0.7 s. If the next step is more than 0.8 s in the past (throttled tab), it jumps to now + 0.05 s instead of replaying missed steps.
- A step is one sixteenth note: step length = 60 / BPM / 4.
- **Intensity** I (0..1) is set every frame by the game: clamp((alive enemies + queued enemies + 2 × remote players) / 12, 0, 1), multiplied by 0.25 during a wave intermission.
- All music voices are the tone voice / music noise voice of section 10, routed to the music gain, with `at` = the step's absolute time.
- MIDI → Hz: 440 × 2^((n − 69) / 12).

### 12.2 Note tables

Each bar is written as a sequence of "note×length" where length is in sixteenths; "rest×n" is silence. A note sounds for length × step × 0.9 seconds from its onset (the lead) — the remaining sixteenths of the length hold no new onset. A chord is (root MIDI note, third interval in semitones).

Chords: C = (60, 4), G = (55, 4), Am = (57, 3), F = (53, 4), Em = (52, 3).

Progressions (8 bars each): A = C G Am F C G F G; B = Am F C G Am F G G; C = F G Em Am F G C C; D = C Em F G C Em F G.

**HOOK** (4 bars)
1. 76×2 79×2 84×3 rest×1 79×2 76×2 rest×4
2. 74×3 79×3 83×2 81×2 79×4 rest×2
3. 81×2 84×2 88×4 86×2 84×2 81×4
4. 77×2 81×2 84×2 81×2 79×2 77×2 76×2 74×2

**TAIL A** (4 bars)
1. 72×2 76×2 79×4 rest×2 84×4 rest×2
2. 83×2 81×2 79×2 74×4 rest×2 79×2 81×2
3. 81×3 77×3 84×3 81×3 79×4
4. 79×4 77×2 76×2 74×4 rest×4

**TAIL B** (4 bars)
1. 76×2 79×2 84×2 88×6 rest×4
2. 86×2 83×2 79×4 rest×2 81×2 83×4
3. 84×2 81×2 77×4 81×2 84×2 86×4
4. 83×3 rest×1 79×3 rest×1 74×4 rest×4

**BRIDGE** (8 bars)
1. 69×2 69×2 72×2 76×4 rest×2 69×4
2. 65×2 65×2 69×2 72×4 rest×2 74×2 72×2
3. 76×2 76×2 74×2 72×4 rest×2 67×4
4. 71×2 74×2 79×4 rest×2 77×2 76×2 74×2
5. 69×2 69×2 72×2 76×4 rest×2 81×4
6. 77×3 rest×1 77×2 81×2 84×8
7. 83×2 81×2 79×4 74×4 79×4
8. 83×2 86×6 rest×8

**BREAK** (8 bars)
1. 81×8 84×8
2. 83×8 86×8
3. 79×8 76×8
4. 81×12 rest×4
5. 77×4 81×4 84×8
6. 79×4 83×4 86×8
7. 88×8 86×4 84×4
8. 79×4 rest×12

**CHORUS** (8 bars)
1. 84×3 86×1 88×4 rest×2 79×6
2. 83×3 79×1 76×4 rest×2 83×6
3. 81×3 84×1 81×4 rest×2 77×6
4. 79×2 81×2 83×4 86×4 rest×4
5. 84×3 86×1 88×4 rest×2 86×3 84×3
6. 83×3 79×1 76×4 rest×2 83×3 84×3
7. 81×2 84×2 81×2 77×4 rest×2 81×4
8. 79×4 83×2 86×2 79×4 rest×4

### 12.3 The 8-bit theme (156 BPM, 16 sixteenths per bar)

Seven sections of 8 bars (56 bars, 896 steps, ≈ 86 s), looping:

| # | Bars | Chords | Bass style | Drum style | Arpeggio | Counter voice | Octave shadow gain | Echo |
|---|---|---|---|---|---|---|---|---|
| 1 | HOOK + TAIL A | A | bounce | full | yes | no | — | no |
| 2 | HOOK + TAIL B | A | bounce | full | yes | no | 0.02 | no |
| 3 | BRIDGE | B | drive | driving | no | no | — | no |
| 4 | BREAK | C | sparse | sparse | no | no | — | yes |
| 5 | CHORUS | D | pump | full | no | yes | 0.02 | no |
| 6 | HOOK + TAIL A | A | bounce | full | yes | no | 0.045 | no |
| 7 | CHORUS | D | pump | driving | yes | yes | 0.03 | no |

Per step (bar index within the whole song, s = sixteenth index 0–15 within the bar, chord = this bar's chord, root = chord root, I = intensity):

- **Lead** (if the note is not a rest): square at the note's frequency f, gain 0.1; a detuned twin square at f × 1.004, gain 0.04; if the section has an octave shadow: square at 2f, duration × 0.7, gain = shadow value; if the section has echo: square at f, duration × 0.8, gain 0.035, starting 3 steps later, and square at f, duration × 0.6, gain 0.012, starting 6 steps later.
- **Bass** (triangle, default gain 0.16, duration = step × length): b = root − 12. Next bar's bass nb = next chord root − 12, shifted by an octave so that |nb − b| ≤ 6. "approach" = b + 7 if nb = b, else nb − 1 if nb > b, else nb + 1.
  - bounce: on even s, note b + [0, 0, 12, 0, 0, 7, 0, 12][s / 2], length 1.6.
  - drive: on even s, length 1.4, gain 0.17: s = 14 → approach; s = 6 → b + 12; s = 12 → b + 7; else b.
  - sparse: s = 0 → b, length 6, gain 0.14; s = 8 → b + 7, length 4, gain 0.12.
  - pump: s = 0 or 8 → b, length 2.5; s = 4 → b + 7, length 2.5; s = 12 → b + 12, length 1.6; s = 14 → approach, length 1.4.
- **Arpeggio** (if enabled): every step, square at [root, root + third, root + 7, root + 12][s mod 4] + 12, duration step × 0.8, gain 0.03 + 0.02 I.
- **Counter voice** (if enabled): when s mod 4 = 2, triangle at [root + 12, root + third + 12, root + 19, root + third + 12][(s − 2) / 4], duration step × 1.5, gain 0.06.
- **Drums** (music noise voices unless stated):
  - First bar of a section, s = 0: splash — high-pass 5000, 0.4 s, gain 0.14.
  - Last bar of a section, s ≥ 12: snare fill — band-pass 1800 + (s − 12) × 350, 0.08 s, gain 0.12 + (s − 12) × 0.05; the regular groove is skipped on those steps.
  - Otherwise, groove by style:
    - Kick (sine 160→45, 0.12 s, gain 0.45, or 0.3 for sparse) when: driving → s mod 4 = 0; sparse → s = 0; full/light → s = 0 or 8, or (I > 0.5 and s = 10), or (full only, odd-numbered bar, s = 14).
    - Snare (band-pass 2200, 0.11 s, gain 0.14 for light, else 0.22) on s = 4 and 12, never for sparse.
    - Hi-hat (high-pass 8000): driving → every step; full → even steps, or every step when I > 0.4; light → s mod 4 = 2; sparse → s = 8. Open hat when s mod 4 = 2: 0.05 s, gain 0.1; else closed: 0.025 s, gain 0.06. Gain × 0.5 on odd steps and × 0.6 for sparse.

### 12.4 The mariachi waltz (150 BPM, 12 sixteenths per bar, 16 bars, looping)

Chords (root, third): G = (67, 4), D7 = (62, 4), C = (60, 4), Em = (64, 3), Am = (69, 3). Bar chords: G, D7, G, G, C, G, D7, G, G, Em, C, G, Am, D7, C, G. Bars 9–16 are "high" bars.

Lead bars:
1. 74×2 79×2 83×2 86×4 83×2
2. 84×2 83×2 81×2 78×4 81×2
3. 79×2 83×2 86×2 91×4 86×2
4. 83×4 79×4 74×4
5. 76×2 79×2 84×2 88×4 84×2
6. 86×2 83×2 79×2 83×4 86×2
7. 81×2 84×2 78×2 81×4 84×2
8. 83×2 81×2 79×8
9. 79×4 83×4 86×4
10. 88×2 86×2 83×2 79×4 rest×2
11. 84×2 88×2 91×4 88×2 84×2
12. 86×4 83×4 79×4
13. 81×2 84×2 88×2 86×4 84×2
14. 83×2 86×2 91×4 88×2 86×2
15. 84×2 83×2 81×2 79×4 78×2
16. 79×6 rest×2 74×4

Per step (s = 0–11 within the bar):
- Lead note n: square at n, gain 0.1, duration = length × step × 0.9; harmony square a diatonic third below n (G-major scale), duration × 0.9, gain 0.055; on high bars an octave-up square, duration × 0.6, gain 0.02.
  - "Diatonic third below": with G-major pitch classes [G, A, B, C, D, E, F#] (7, 9, 11, 0, 2, 4, 6): find the note's scale degree; if the note is not in the scale, use n − 4; else take the degree two steps down (wrapping) and descend from n − 1 until that pitch class is reached.
- s = 0: bass triangle at root − 24, duration step × 3.4, gain 0.2.
- s = 4 and 8: strum — sawtooth at root, root + third, root + 7, each duration step × 1.5, gain 0.045.
- Even s: hat high-pass 6500 — s = 0: 0.05 s, gain 0.13; other even s: 0.03 s, gain 0.07.
- If I > 0.45, s = 6 and 10: band-pass 1900, 0.07 s, gain 0.16.
- Last bar, s ≥ 8: fill band-pass 1600 + (s − 8) × 300, 0.06 s, gain 0.1 + (s − 8) × 0.04.

## 13. Interfaces with other subsystems

**HUD ← game loop (main)**: every frame the calls in section 4; on events: set score(score, combo); set wave(n, left); set modifier(text); set timer(text); set boss(name, fraction | none); message(main, sub, dur); tip(html, dur); kill(text, pts); set PvP score(html | none); set board(html | none); show screen(html)/hide screen; set gameplay visible(bool); set device(gamepad?). The game reads back only one HUD fact: whether the scoreboard overlay is currently hidden. The game installs the "screen click" callback and the "device changed" callback.

**HUD ← player module**: set weapon(name, hint) and set crosshair mode("katana" | "") on every weapon switch; set ADS(bool) and set scope(bool) every frame; damage-from(angle) on damage with a known source; grapple target(0 | 1 | 2); tip(...) for grapple-breath messages; message("OUT OF BOUNDS", …) on falling out of the level.

**HUD ← enemy module**: hit marker(kill?, crit?) per hit; boss tracking via the game's "on boss" callback (name, hp / max hp); kill feed labels via the game's "on kill" callback (enemy, hit info, overkill flag).

**HUD ← weapon module**: none directly; the weapon module exposes to the game/player the values listed under "HUD → weapons" below and triggers its own audio cues.

**HUD ← input module**: device change events (keyboard vs gamepad) reach the HUD through the game; the HUD's "gamepad" state drives labels.

**HUD → weapons**: the HUD needs from each weapon: display name, hint text, kind ("katana" or a gun kind), is-gun flag, magazine, reserve, magazine size, reloading flag, aim amount (0..1), scope flag, and crosshair spread in pixels.

**Menus ↔ network module**: host(is public) → lobby code; join(code, name); quick join(name, progress callback); leave; lobby code, max players (8), is-host flag, own id; roster/host/visibility/map broadcast on every change (triggers a lobby re-render); refused reasons; disconnect. Scores: (id → name, kills, deaths) table, sorted by kills desc then deaths asc, feeds the mini leaderboard, scoreboard overlay, online menu and match-over screens.

**Audio ← network layer** (through the game): remote shot(kind, muzzle position) per received shot batch; enemy-die at a remote player's death; kill(strong) when a remote death names you as killer; shield-hit on a received parry notice; spawn on your respawn.

**Audio ← everything**: cue triggers are listed with their callers in section 11. The audio module also receives: listener (eye position, right vector) every frame; intensity every frame; tune key on level (re)build; music on/off from the preference; context init/resume on pointer-down/key-down and on play start.

**Renderer ← game**: hurt, flash, slow, lowHp scalars per frame (3.19).


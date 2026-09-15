# Mobile controls — pass 1

**Status: first-pass game implementation present; automated checks pass; physical-phone acceptance pending.** The user approved the core arrangement and prototype interactions. Touch input, the control editor, landscape interruption, and optional installation are implemented. Icons and phone usability still need physical-device review. Browser emulation is not evidence that the real game performs well on phones.

- Branch: `mobile-support-pass1`.
- Visual and interaction reference: [mobile-controls.html](../prototypes/mobile-controls.html).
- Existing rules: [Player and input](player-input.md), [Combat rehaul](combat-rehaul.md), and [Online team modes](online-team-modes.md).
- This specification adds touch control requirements. It does not replace keyboard/controller controls or change weapon, movement, grapple, or network balance.

## 1. Scope

Use the existing web app. Players can open it in a phone browser without installation. Offer optional PWA installation for home-screen access and a separate app window where supported. Target iPhone Safari and Android Chrome, in both browser and installed modes.

The first pass includes normal movement and shooting controls, **plus grapple**. Provide a two-thumb default and a customizable claw layout for players who want more simultaneous control.

Not in this pass:

- Grenade, melee/guard, and focus-attack touch controls. Decide their placement later. Keep their existing desktop/controller gameplay intact.
- Gyroscope input.
- New automatic firing or aim-assist behaviour. Holding Fire still follows each weapon's existing firing rules.
- Native app packages, layout sharing codes, cloud layout sync, or an offline-play guarantee.

This is intentionally incomplete touch action coverage, not full input parity. Phone players cannot perform the deferred actions through touch in this pass.

## 2. Approved layout

Use the HTML reference for placement, relative importance, spacing, and interaction feedback. Keep the centre clear for the crosshair and target visibility. The map image is only a backdrop; it is not a proposal to change the camera to an aerial view.

### Two-thumb default

| Control | Placement | Behaviour |
|---|---|---|
| Movement stick | Lower left | Drag from a fixed stick position to move. Preserve analogue magnitude; clamp diagonal movement. Release to stop supplying movement input. |
| Sprint | Through the movement stick | Push fully forward to request sprint. No extra sprint button or latched auto-run. Existing sprint restrictions still apply. |
| Look | Clear area mainly on the right | Drag to rotate the camera. A stationary finger supplies no turn. Keep the crosshair centred. |
| Fire | Large button on the right | Hold to supply fire; drag the same finger to adjust aim. Do not turn semi-automatic weapons into automatic weapons. |
| Scope | Upper right | Tap to toggle aim down sights. Show its active state. Provide touch sensitivity adjustment and retain scoped sensitivity control. |
| Grapple | Above and left of Fire | Tap to attach/detach, hold to reel, drag to keep aiming. See section 3. |
| Jump / Launch | Lower right | Jump or wall jump under existing rules. When attached, use the same button to launch from the rope; change its label to Launch. |
| Crouch / Slide / Dash | Beside Jump | Hold for crouch/slide on the ground. A press while airborne requests the existing air dash. No new double jump or automatic movement. |
| Reload | Lower right, inward from Slide | Tap to request reload. Existing reload and interruption rules apply. |
| Weapon display | Lower centre | Show the equipped weapon and actual ammo. Tap to cycle through the existing gun slots. |
| Pause / Menu | Top right | Always reachable. Pause solo/training; open the menu without pausing an online match. |

Health sits at the top left. Wave or match information sits near the top right without covering Pause. Online score and team information must remain readable; the mock only demonstrates a solo-wave label. The existing online menu can provide the full scoreboard without another large combat button.

The normal layout cannot provide every action combination without moving a thumb. It must support move + look + fire and move + grapple + look. A player can release Grapple, keep swinging, and move the right thumb to Jump/Launch. The claw option provides more simultaneous access.

### Claw layout

The reference starts with a four-finger arrangement:

- Movement stays at the lower left.
- An extra fire button sits at the upper left for the left index finger. It fires without rotating the camera.
- Scope and Grapple move to the upper right for index-finger access.
- The right thumb keeps the clear look area; a smaller right fire button remains available.
- Jump, Slide/Dash, Reload, and weapon selection remain below.

Both fire buttons supply the same action. Releasing one must not stop firing while the other remains held. Do not depend on which finger touched first.

The actual implementation must include an explicit **Edit controls** screen, not movement of buttons during combat. Allow position, size, and opacity changes, and an optional second fire button. Save locally, provide Reset, and permit a four-finger preset to be adjusted for three-finger use. Keep Pause reachable and keep saved controls inside the usable landscape area after resizing. Validate saved values and fall back safely if storage is unavailable or a saved layout is invalid.

**The HTML has preset switching only. It does not implement customization or persistence.**

## 3. Grapple interaction contract

The approved mock demonstrates the following touch intent:

| Rope state | Touch | Intended result |
|---|---|---|
| Not attached | Press Grapple | Request a hook immediately. The real game still requires a valid target, stamina, and cooldown. |
| Attaching or attached after that press | Continue holding | Request reeling once the hold threshold is reached and the rope is attached. |
| Attached | Release after a hold | Stop reeling, but keep the rope attached unless the game detaches it under existing rules. |
| Already attached before a new touch | Short tap | Detach on release. |
| Already attached before a new touch | Hold | Reel without first detaching. Release stops reeling, not attachment. |
| Attached | Press Jump / Launch | Detach with the existing launch boost. |
| Any state | Drag on Grapple | Supply look movement without changing that finger into another button. |
| Any state | Touch cancellation or focus loss | Clear the held input and pending tap/hold work. Do not interpret cancellation as a completed detach tap or new hook request. |

The mock uses **300 ms** to distinguish a hold and **0.85 of normalized forward stick travel** to request sprint. These are starting values for phone testing, not measured final tuning.

### Integration difference to resolve

The existing `updateGrapple()` in `src/engine/player/grapple.ts` uses `pressed('grapple')` to detach an attached rope and `down('grapple')` to reel. Simply mapping every touch-down to the existing press edge would detach before a new hold could reel.

The touch integration must distinguish a short attached-state tap from a reel hold. Preserve existing keyboard/controller semantics and keep the real grapple state authoritative. Do not copy the mock's unconditional `attached = true` behaviour into the engine. Cooldown, hook flight, missed targets, enemy yanks, stamina loss, rope cuts, and automatic detach must drive the displayed state.

After Launch or an automatic detach, an old held finger must not launch a new hook or apply a delayed action. A new hook needs a new deliberate press.

## 4. Input and screen requirements

- Track each active pointer separately. Capture it for the control where it starts; crossing another control must not change its action.
- Clear held input and pending gestures on pointer cancellation, capture loss, device change, layout change, pause/menu entry, page hiding, death/reset, and disposal as appropriate. Require fresh touches after an interruption; do not restore stale fire or movement.
- Keep touch input separate from compatibility mouse events so a tap does not fire twice or switch to mouse mode. Support switching to keyboard/controller without stale touch state.
- Touch play must not request pointer lock or show mouse-lock instructions. Fullscreen and orientation locks are optional enhancements, not entry requirements.
- Stop scrolling and browser gestures on gameplay input surfaces. Keep menu scrolling and text entry usable. Menu taps must not also fire or move the camera.
- Keep controls at least 44 × 44 CSS pixels, with separation and visible pressed states. Do not reduce touch targets just to fit a small screen. Provide readable labels and accessible names while refining icons.
- Account for notches, home indicators, browser bars, and viewport changes. Test both landscape directions. Do not use the prototype's width breakpoint as the final input-device detector.
- Keep gameplay state and high-frequency input in the existing engine/input path. Do not create a second game loop in the React controls.

### Landscape-only play

Menus can work vertically. Gameplay requires landscape.

When the phone is vertical, block gameplay controls and show:

> Rotate your phone to play. Hold your phone horizontally to continue.

Clear held input immediately on rotation. Pause solo/training. In an online match, show that the match is still running; the local player is not protected by this prompt. After the phone returns to landscape, require a tap to resume. That tap must not fire a weapon.

An orientation-lock request may be used where supported. If it fails or is unavailable, the rotate prompt remains the fallback. Do not imply that a button can rotate the physical phone.

### Installation and lifecycle

Offer a dismissible install message from a menu, with **Continue in browser**. Never interrupt a match to ask for installation. Do not ask again while running in installed mode.

Use the browser's install prompt where available. Otherwise show platform instructions, including Safari → Share → Add to Home Screen on iPhone where applicable. The installed app and browser app use the same controls and game rules.

Installation can provide convenient access and reduce browser UI. Do not promise faster rendering, reliable background execution, or offline multiplayer. Manifest/icons, browser install handling, and any required caching/update behaviour belong to the PWA implementation, not this HTML reference.

When the app is interrupted, clear held controls and recover audio after a user gesture. Online disconnection or host loss must be reported honestly; phone browsers can suspend the page even in installed mode.

## 5. Prototype limits and remaining work

The reference is deliberately a layout study:

- The scene is a static map image with small drag feedback, not a 3-D camera.
- Health, ammo, wave, and rope visuals are illustrative. It has no physics, collision, recoil, weapon timing, stamina, or networking.
- Its sprint indicator shows input intent, even while Fire is held. The real game prevents sprinting while firing or aiming.
- Its toggle-scope and attached-rope visuals can remain across prototype overlays. The real game must explicitly reconcile state on death, reset, interruption, and input-device changes.
- The install screen is a message preview, not an installable PWA.
- Icons need refinement. Keep recognisable symbols, consistent stroke weight, readable labels, and the approved control placement.
- Actual touch sensitivity, hold timing, safe-area fit, and claw editing still need real-phone checks.

## 6. Open and check the reference

Open `docs/prototypes/mobile-controls.html` directly in a browser. It reuses `public/maps/downtown.webp` by relative path; no new image copy or runtime dependency is needed.

For a local browser preview, run from the repository root:

```sh
python3 -m http.server 4180 --bind 127.0.0.1
```

Open `http://localhost:4180/docs/prototypes/mobile-controls.html`. For a phone preview, serve only the mock and its image from a separate temporary directory, as in the original review; do not expose the whole repository on a network. The earlier temporary preview is not the durable reference.

Run the prototype check with the existing Playwright dependency and its Chromium installation:

```sh
node tests/mobile-prototype.check.mjs
```

It checks image loading, simultaneous move/fire/look input, cancellation, grapple tap/hold/launch, scope toggling, portrait blocking and resume, menu/install previews, and non-overlapping control targets in both presets at 844 × 390, 667 × 375, and 568 × 320. These are browser-emulated checks, not physical-device or gameplay validation.

### Automated implementation checks

Run the app with `npm run dev -- --hostname 127.0.0.1 --port 4181`, then run:

```sh
node tests/mobile-game.check.mjs http://127.0.0.1:4181
npm run typecheck
npm test
npm run build
```

These checks pass, including 152 unit/browser tests. The game check covers simultaneous movement/fire/look, semi-auto cadence, scope, reload, real grapple attachment/reeling/swing/launch, cancellation, rotation/resume, editor persistence/reset, six preset/viewport combinations, and installation fallback. Screenshots are saved to `/tmp/shooter-mobile-check`. Online menu/death checks use simulated match state, not a connected multiplayer session.

Physical iPhone/Android checks, actual installation, connected multiplayer interruption/host loss, and sustained performance measurements remain open. No offline-play or phone-performance guarantee is made.

### Implementation acceptance checks

Before claiming phone support is complete:

- Test movement + aim + fire, scoped fire, grapple + look, hold-to-reel after attachment, release-to-swing, and jump-to-launch against the real engine.
- Verify normal weapon cadence, reload behaviour, sprint restrictions, and grapple failure/detach conditions remain intact.
- Verify both fire buttons together, short taps between frames, slide/dash input, and no stuck actions after cancellation, rotation, menus, backgrounding, death, or controller switching.
- Test portrait/landscape transitions and short landscape screens in iPhone Safari and Android Chrome. Check notches, browser bars, keyboards, and menu scrolling on real phones.
- Test editable claw layouts, reset, persistence, invalid saves, and resize recovery.
- Test solo pause and online menu/disconnection behaviour separately, including a phone acting as the host.
- Test installed and ordinary browser modes, install dismissal/fallback, and sound recovery.
- Measure sustained frame rate and heat on real phones before selecting any reduced graphics settings.
- Run the existing input/gamepad and game regression checks. Do not change desktop bindings to accommodate the touch layout.

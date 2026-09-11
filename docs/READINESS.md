# Build readiness check

Checked on 2026-09-08. The user selected the local documents as the build target.

Status: ready to implement Downtown after the corrections below. All listed corrections were applied and cross-checked before app code was started. Mexico remains gated. Build acceptance is a separate step.

## Target and scope

- Use `ARCHITECTURE.md` for public interfaces and the replacement visual style.
- Use `spec/*.md` for game rules, with the corrections recorded below.
- Deliver static JavaScript modules. Use the pinned Three.js and PeerJS versions. No bundler, package installation, framework, or server application.
- The first release exposes Downtown solo and Downtown free-for-all. FFA supports eight players, 20 kills, and the documented 480-second match clock.
- Keep Mexico disabled. Keep the revolver out of the loadout. Enemy replication remains dormant in FFA.
- Use keyboard/mouse and standard gamepad input. Touch controls are outside the documented scope.


## Completeness findings and corrections

All ten original documents were read across four independent audits. The subsystem coverage is sufficient, but the original set had conflicting rules.

| Area | Required correction |
|---|---|
| Boot | Construct audio and network services before use. Create one shared remote map. Align both boot descriptions. |
| Match end | Set local death state before host tally so a winning death cannot overwrite `over`. |
| Network input | Validate payload shape and bounds. Derive sender identity from the connection. Restrict host commands to the host. |
| Network sessions | Use a versioned PeerJS namespace. |
| Host timeout | Leave online when the host is silent for the specified timeout. |
| Remote player interface | Expose figure visibility for spawn selection. |
| Rope cutting | Apply the networking refinement: test each remote rope; cut each at most once per slash. |
| Background timing | Preserve the 250 ms timer and `>300 ms` threshold. Correct the stated typical rates to about 2 steps/s and 0.67 state packets/s. |
| Ownership | Permit the specified service listeners, network timers, music scheduler, and cancellable automatic-reload callback. |
| Healing | Give the player a capped healing entry point; do not write health from unrelated modules. |
| Neutral input | Clear fire, aim, reload, and melee inputs during death and a focus dash. Explicit focus slash calls remain valid. |
| Reload | Distinguish manual reload restrictions from the 250 ms automatic reload. Cancel pending callbacks on reset or disposal. |
| Hitscan | Cast from the eye. Start the visual tracer at the muzzle. |
| Recoil | Correct the summaries that label grenade recoil as grapple recoil. |
| Weapon size | Keep the camera rig at scale 1. Scale each weapon root by 0.46 once. |
| Materials | Define the missing `boss` surface colour. |
| Name tags | Permit generated opaque canvas labels through the render-owned `makeNameTag` factory, with explicit disposal. |
| HUD | Ban decorative tilt; retain hit-marker and damage-direction rotations. Permit menu-panel scrolling within the viewport. |
| Pump cue | Use the weapon specification's 45% cycle event. |
| Downtown pickups | Correct the arena count to 10 and ammo refill to 40% of maximum reserve. |
| Enemy movement | Correct the overview to allow the specified boss steps and AI jumps over rails. |
| Pickup inside a crate | Move `(34,0,12)` to `(34,2.4,12)`. This is an intentional playable correction. |

## Gates that remain closed

Mexico must not be enabled until its random collider geometry is shared or fixed, and its blocked spawn/pickup markers are corrected.
These issues do not block Downtown.

The documented client-owned hit and health model is retained. Shape and sender checks do not provide server-authoritative anti-cheat.
The documented slow match clock while a host tab is hidden is also retained.

## Build acceptance checks

These checks define evidence to collect after implementation. They are not results.

1. Serve the folder with a static HTTP server (`python3 -m http.server`). Open `tests/index.html` to run the module checks in the browser; the page title reports passed/failed counts. Load all modules without syntax, import, shader, or runtime errors.
2. Show a useful failure message if WebGL cannot start. Failure of PeerJS must not prevent solo play.
3. Check the main menu at 1440x900 and 900x600. Reach all buttons and settings with scrolling and keyboard focus.
4. Start solo, move, jump, slide, switch all four weapons, fire, reload, grapple, throw a grenade, pause, resume, die, and retry.
5. Check collision, rail pass-through rules, map marker counts, capped healing, ammo limits, and neutral-input behavior with runnable assertions.
6. Check wave composition, boss rotation, scoring, focus entry/exit, and reset behavior with deterministic inputs.
7. Check weapon-root scale, sight alignment, visible hit feedback, damage direction, scope, audio activation, and music toggle in the browser.
8. Use two isolated clients to check lobby join, start, state exchange, damage/death, respawn, scoreboard, match end, and leave. Keep a separate mock-transport check for invalid payloads and sender spoofing.
9. Record measured frame rate and draw calls with the test viewport and machine. The target is 60 fps at 1080p on an integrated GPU; a target alone is not a measured result.
10. Report physical gamepad, other-browser, and different-network coverage separately if those tests cannot be run.

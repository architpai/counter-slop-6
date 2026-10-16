# Counter Slop 6: notes for coding agents

A browser FPS. Next.js and React for the shell and the HUD; an imperative three.js engine in `src/engine/`; PeerJS
(WebRTC) for online play, with no game server. Read this file before you change anything.

## Where the truth lives

- `docs/ARCHITECTURE.md` is the module contract: public surfaces, the shared `ctx` object, conventions. Do not add
  or rename a public export without updating it.
- `docs/spec/*.md` are normative. Every number, timing and formula in them is the behaviour. Change the spec in the
  same commit as the code, so the two never disagree.
- `docs/VISUALS.md` is the art direction and the quality-tier plan.
- `IMPROVEMENTS.md` is the backlog. Tick items as they land.

## Rules

1. **Clean room.** Never copy code or assets from another game or project into this repository. Reference images
   and pages stay outside the repo (for example in `/tmp`). Describe what you learned from them in prose.
2. **Self-made assets only.** No downloaded models, textures, sounds or HDRs, not even CC0. Textures, models,
   effects, skies and light bakes come from the scripts in `tools/` (headless Blender), built with `npm run
   textures`, `npm run weapons`, and so on. Fonts are Google Fonts through `next/font`.
3. **Gate visuals by quality tier.** Low keeps the flat low-poly look for phones; Medium, High and Ultra are the
   realistic look. Every new visual feature reads the tier (`render/quality.ts`). If something is the same on every
   tier (a DOM overlay, for example), say so in the docs.
4. **Match the code around you**: its naming, comment density and idiom. Comments say why, not what.
5. **Keep the tree honest.** Do not leave debug handles, skipped tests or half-done work without a note in the PR.

## Checks

Run these before you call a change done:

```sh
npm run typecheck          # tsc --noEmit
npm test                   # vitest, in a real browser (Playwright)
npx next dev -p 3123       # then, in another shell, the browser checks that touch your change:
node tests/<name>.check.mjs http://localhost:3123   # pass/fail checks (online-coop, optic-colors, training, ...)
node tests/<name>.shots.mjs http://localhost:3123   # screenshots to look at (holo, spectate, combat, tiers, ...)
```

- The online checks open two or more browsers and connect them over real WebRTC.
- Look at the screenshots of any visual change. Compare them with the reference before you say it matches.
- `tests/combat.shots.mjs` measures frame times on the real GPU. Its budget holds only on a quiet machine (load
  under 4); on a busy one, record the figures and say so.

## Git and deployment

- One branch per feature, a PR into `main`, merged with a merge commit.
- Vercel builds a preview for each PR and deploys `main` to https://counter-slop-6.vercel.app.
- Commit, push, merge and delete branches only when the maintainer asks.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

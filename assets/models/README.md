# Tactical character models

The player and all ten enemy types use `public/models/tactical.glb`. The Mexico musicians remain decorative legacy figures.

- **Humanoids:** grunt, light rusher, armoured heavy, hooded sniper, riot-shield carrier and the Admin with command armour and crest.
- **Machines:** bomber with charge packs and an arming beacon; tilt-wing attack drone; Hitbox breach walker with an armoured lid; Lag Spike assault unit with transmitter antennas.
- Each enemy keeps a distinct shaped clown mask. The player wears goggles and a balaclava instead.

- **Source:** open `assets/models/tactical.blend` in Blender. The source keeps separate garment pieces and editable bevel modifiers.
- **Rebuild:** `blender -b --python assets/models/build_tactical.py`. This overwrites the `.blend` and GLB. Save manual Blender edits separately before rebuilding.
- **Coordinates:** metres, +Y up and +Z forward in the game. The build script converts to Blender coordinates, and the GLB exporter converts back.
- **Integration:** `src/engine/render/tactical.ts` loads the asset before boot. Named `kind__part-surface` groups attach to the existing figure pivots. The exporter batches mesh pieces by parent/material. Each live figure owns its geometry; immutable source data and materials are cached for the page lifetime.
- **Hit areas:** rays test the visible articulated meshes. Humanoid head surfaces give headshots; all machine surfaces count as torso hits. Guns and labels are excluded. The visible shield blocks bullets until it detaches. Legacy spheres/anchors remain for AI aiming and debug inspection, not gun hit detection. Damage values are unchanged. Player colour marks follow the existing multiplayer tone.
- **Inspection:** choose **TRAINING GROUND** before play to see every enemy in labelled lanes. Targets are passive, respawn after three seconds and show health/distance when aimed at. Walk around them to inspect every side, or reset the range from pause.
- **First person:** separate left/right glove-and-sleeve groups attach to the existing weapon hand pivots. Gun geometry, reloads, ADS and melee remain independent.
- **Failure:** asset loading errors show the existing boot error screen; the game does not start with missing models.

`ponytail:` these models use rigid articulated sections and the existing animation rig. Add a skinned armature and authored animation clips if joint bending or cloth deformation needs further work. Drone wings now trim their bank rather than flap; machine arms use a restrained mechanical swing. No MCP server or new dependency is required.

## Checks

```sh
npm run typecheck
npm test
npm run build
node tests/model-rework.check.mjs http://localhost:3000
node tests/training.check.mjs http://localhost:3000
```

The browser unit test writes the player/grunt/heavy line-up, specialists, machines, bosses and action poses to `tests/.vitest/tactical-*.png`. The running-game check writes all ten enemy portraits and first-person screenshots to `/tmp/model-rework`. It checks head/body rays, shield breaks, bomber detonation, rusher recovery, flight, boss attacks, boss-spawned units and asset-load failure handling. Test images are not shipped.

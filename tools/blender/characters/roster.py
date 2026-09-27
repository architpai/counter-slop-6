"""
The cast (docs/VISUALS.md, R7 and V3): every kind the game draws with a
Blender model (render/tactical.ts `TACTICAL_MODELS`), its build, its gear
and the colours of its zones. Humanoids share the operator's body and gear
and differ in their role kit (kits.py), headgear (the game's `hat`,
enemies/types.ts), mask (masks.py) and colours; each role has one block of
colour or shape that reads at 30-60 m. The machines are in machines.py.

Colours are sRGB hex. `mark` is the hostile red on enemies and the team
colour on the player (drawn from the game's team tone, `_FX` -1).
"""

HOSTILE = 0xa3222e
# The line soldier's kit is the flat look's urban graphite (assets/models/build_tactical.py): a charcoal combat shirt,
# slate trousers and a graphite plate carrier, about as dark as that look's, so the chest keeps its value against sunlit
# paving and sand; the game's readability light (render/materials.ts `OPERATOR_LIGHT`) balances it in sun, shade and indoors.
# A coyote carrier (tried) sat in the sunlit ground's value band.
DEFAULT = dict(shirt=0x5c605f, trousers=0x687070, vest=0x676f73, gear=0x3f4244, boots=0x3b3128, gloves=0x2e3033, balaclava=0x232527,
               hat=0x2d3a2a, kit=0x7c6d52, kit2=0x46433b, mark=HOSTILE, mark2=0xe4e2dc, gold=0xc29a45, steel=0x6d747b, rubber=0x26282a,
               glow=0xffb020, lens=0x1a2630, pads=0x2e3033)

# kind: build, hat, vest, extras, kit (kits.py function names), colours over DEFAULT.
HUMANOIDS = {
    # The remote player: a neutral mid-grey suit (no cast to pull the team's hue) that keeps its value on dark floors, its plate carrier and pouches in a light
    # tint of the team's colour (`team_carrier`: the -0.6 mark, build.py), the role kits' block that reads at 30-60 m and
    # stays light on dark ground; the helmet band and armbands in the team's tone.
    'player': dict(w=1.0, hat='fast', vest='carrier', goggles=True, mask=False, headset=True, knees=True, team_carrier=True,
                   colours=dict(shirt=0x7f7f7c, trousers=0x6f706d, vest=0x6f706d, hat=0x5f605d, gear=0x454643, kit=0x7f7f7c)),
    'grunt': dict(w=1.0, hat='cap', vest='carrier', headset=True, knees=True, cargo=True, radio=True),
    'rusher': dict(w=0.82, hat='band', vest='none', kit=['rusher'], cargo=True,
                   colours=dict(shirt=0xa42128, trousers=0x2b2c30, vest=0x2f3033, hat=0xb52a2e, balaclava=0x1c1d1f, boots=0x26221f)),
    # Dark olive bomb-suit armour, its hazard chevrons in yellow.
    'heavy': dict(w=1.55, hat='eod', vest='heavy', kit=['juggernaut'], knees=False, heavy_mask=True,
                  colours=dict(shirt=0x33392a, trousers=0x33392a, vest=0x3c4430, kit=0x434c33, hat=0x3c4430, mark=0xd8a21c)),
    # A moss and straw ghillie over the head, shoulders and chest, no carrier under it.
    'sniper': dict(w=0.78, hat='hood', vest='none', kit=['ghillie'], cargo=True,
                   colours=dict(shirt=0x5f6440, trousers=0x5f6440, vest=0x6f6a4c, hat=0x75823a, kit=0x7d8a3c, kit2=0x9c9050)),
    # Black riot kit behind a black ballistic shield with its white band.
    'shield': dict(w=1.2, hat='riot', vest='carrier', kit=['riot_shield'], shield=True, holster=True, elbows=True, knees=True,
                   colours=dict(shirt=0x262c3b, trousers=0x262c3b, vest=0x23262d, hat=0x1e2330, kit=0x24282f, mark=0xdedbd2)),
    'boss': dict(w=1.35, hat='crown', vest='none', kit=['admin'], heavy_mask=True,
                 colours=dict(shirt=0x1f2a44, trousers=0x1f2a44, kit=0x22304f, hat=0xc29a45, gear=0x2a2622)),
    # A white carrier, helmet and pack, a big red cross on the chest and back.
    'medic': dict(w=1.0, hat='fast', vest='carrier', kit=['medic'], knees=True,
                  colours=dict(shirt=0x6e7378, trousers=0x5c6166, vest=0xdcdcd6, hat=0xe6e6e2, kit=0xe6e6e2, mark2=HOSTILE)),
    # A coyote breaching shield with hazard bumpers and a steel ram.
    'breacher': dict(w=1.0, hat='fast', vest='carrier', kit=['breacher'], shield=True, knees=True, elbows=True,
                     colours=dict(shirt=0x4a4d52, trousers=0x44474c, vest=0x3c3f45, hat=0xc98a2a, kit=0x8f7a55, kit2=0xd08c24)),
    'turret': dict(w=1.0, body='robot', hat='none', vest='none', kit=['sentry'],
                   colours=dict(kit=0x7a8288, kit2=0x4c5359, mark=0xd98a1a)),
    # A bright gold carrier over tan, a dark sash across it and the loudhailer.
    'packleader': dict(w=1.0, hat='band', vest='carrier', kit=['packleader'], cargo=True,
                       colours=dict(shirt=0x8a7658, trousers=0x8a7658, vest=0xe2bd3a, hat=0xe2bd3a, kit=0x2e2a24)),
    # A pale sky-blue chemical suit and hood (the role's block; its first pale grey-green read as the grunt's grey at
    # 30 m, a chartreuse as the sniper's ghillie), a charcoal carrier with smoke grenades racked on the chest, the
    # pale canisters on the back.
    'smoker': dict(w=1.0, hat='hood', vest='carrier', kit=['smoker'], holster=True,
                   colours=dict(shirt=0x7f9fbd, trousers=0x7f9fbd, vest=0x3d4347, hat=0x8fb0cf, kit=0xd2d5cb, kit2=0x2c302f, mark2=0xe4e2dc)),
    # Dark kit, a teal carrier with a cyan plate on the chest and the glowing fins.
    'rubberbander': dict(w=1.0, hat='band', vest='carrier', kit=['rubberbander'], knees=True,
                         colours=dict(shirt=0x3b3f46, trousers=0x33363c, vest=0x1f8490, hat=0x2fb7c4, kit=0x2ab8c6, glow=0x7ff4ff)),
    # A hazard-orange coverall and carrier with black chevrons, the charge pack on the back.
    'sapper': dict(w=1.0, hat='fast', vest='carrier', kit=['sapper'], holster=True, knees=True,
                   colours=dict(shirt=0xb4661e, trousers=0xb4661e, vest=0xd8881a, hat=0x2a2b2c, kit=0xd8881a, kit2=0x1e1f20, glow=0xff3a1c)),
    'parry': dict(w=1.0, hat='hood', vest='carrier', kit=['parry'], elbows=True,
                  colours=dict(shirt=0x2e2a36, trousers=0x2a2731, vest=0x34303d, hat=0x5c3d8a, kit=0x6a44a0)),
    'aimbot': dict(w=1.0, hat='hood', vest='carrier', kit=['aimbot', 'aimbot_vent'],
                   colours=dict(shirt=0x2b2d31, trousers=0x27292c, vest=0x2f3136, hat=0x222326, kit=0x2c2f34)),
    'ragequit': dict(w=1.0, hat='fast', vest='heavy', kit=['ragequit', 'rage_cleaver'], heavy_mask=True, knees=True,
                     colours=dict(shirt=0x3a2a26, trousers=0x33262a, vest=0x8a2a1e, hat=0x8a2a1e, kit=0xa4321f)),
}

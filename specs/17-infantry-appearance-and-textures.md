# 17 — Infantry appearance and camouflage textures

Status: accepted (owner request 2026-10-14, issue #264).
Depends on `06-phase4a-procedural-models.md`, `12-generated-textures.md`, `13-vehicle-liveries.md`, and `15-vehicle-skins.md`.
Decisions: D-01, D-02, D-05, D-07.

## 1. Context

In modern warfare (Armed Forces of Ukraine vs. Russian Armed Forces), infantry soldiers wear distinct modern combat equipment, helmets, plate carriers, identification tape armbands, and digital camouflage uniforms:
- **Ukraine:** MM-14 pixelated camouflage (*Maskuvalny Malyunok 2014*), high-cut FAST ballistic helmets with NVG mounts, modular plate carriers, and prominent yellow/blue identification armbands (`team` material).
- **Russia:** EMR Digital Flora camouflage (*Tsifra / Ratnik*), 6B47 ballistic helmets, 6B45 modular plate carriers, and prominent white/red identification armbands (`team` material).
- **Special infantry units:**
  - `ua-stugna-team`: Ukrainian Stugna-P (*Skif*) ATGM on tripod with optical guidance module (PN-I / PN-S), and the iconic remote control suitcase console (PDU-215) with display screen operated by a kneeling operator who stays apart from the tripod, linked to it by the guidance cable.
  - `ru-rpg-gunner`: Russian anti-tank team featuring an RPG-7 launcher with its distinctive conical PG-7 warhead protruding forward from the muzzle, rocket backpacks carrying spare rockets, and an assistant gunner with an AK-74M kneeling beside the gunner.
  - `ua-rifleman` / `ru-rifleman`: one soldier per unit, as in C&C Generals, with separate articulated legs, arms holding assault rifles in combat-ready posture, ballistic helmets with goggles/NVG mounts, and plate carriers.

Previously, infantry models were placeholder blocky boxes without arms or separate legs, and their `body` material used generic flat vehicle paint (`ua-paint` / `ru-paint`).

## 2. Textures (`client/src/render/generatedTextures.ts`)

`GENERATED_TEXTURE_IDS` gains `ua-camo` and `ru-camo` (`client/public/textures/<id>.webp`).

```ts
export const GENERATED_TEXTURE_IDS = [
  "grass",
  "dirt",
  "rock",
  "ua-paint",
  "ru-paint",
  "ua-concrete",
  "ru-concrete",
  "dark-metal",
  "ua-skin",
  "ru-skin",
  "ua-skin-bump",
  "ru-skin-bump",
  "ua-wall",
  "ua-roof",
  "ua-camo",
  "ru-camo",
] as const;
```

### Material mapping:
- For units with `armor === INFANTRY_ARMOR` (`0`), `bodyTextureId(typeId, category, armor)` returns `${prefix}-camo` (e.g. `ua-camo` or `ru-camo`).
- If `<faction>-camo` is missing in `textures`, `bodyMapsOf` falls back to `<faction>-paint` with no bump.
- Infantry has no bump map (`bump: undefined`) and, unlike vehicles and buildings, smooth shading (`flatShading: false` on its `body` and `team` materials), so lofted limbs do not read as polygons.
- Infantry camouflage is box projected with `INFANTRY_TILE` (0.5 model units) instead of `MODEL_TILE`, so its pixels are a few centimetres on a soldier.
- Each `team` part also covers the tape band around the helmet.
- The `team` material on the soldiers is mapped to identification armbands (IFF tape) on both arms, which light up in the owner's team colour (or white/yellow/blue in match).

## 3. Models (`tools/models/`)

Procedural Blender Python generators for modern infantry:
- `tools/models/infantry.py`: soldiers built in figure units (1.0 = helmet top) from lofted tubes that run through hip-knee-ankle and shoulder-elbow-wrist, so limbs bend without gaps; tubes are smooth shaded with sharp caps, gear stays boxy and flat shaded (C&C Generals style).
  - Uniform `body` base colours are light (`#9aa070` Ukraine, `#8a8a5c` Russia) because the camouflage texture multiplies them.
  - Each soldier has trouser legs with knee pads and combat boots (`dark`), torso with plate carrier, magazine pouches and belt, assault pack, camouflage balaclava head with ballistic glasses, ballistic helmet with camouflage cover, NVG mount and headset, and two arms whose upper arms carry the `team` armband.
  - `rifleman()` stands at low ready (or kneels with `kneel=True`); `rpg_gunner()` aims an RPG-7 from the right shoulder; `kneeling_operator()` holds the PDU-215 console, whose screen is `team`.
  - Two-man units pass `segments=6` to fit the triangle budget.
- `tools/models/ua-rifleman.py` / `ru-rifleman.py`: one rifleman, 0.54 tiles tall.
- `tools/models/ua-stugna-team.py`: Stugna-P on its tripod (launch container, PN-S guidance unit, `team` tape on the container) and the kneeling operator apart from it, the cable running along the ground between them.
- `tools/models/ru-rpg-gunner.py`: standing RPG-7 gunner and assistant kneeling beside him with a two-round rocket carrier and rifle, with a clear gap between the two men; its render box grows to `[40, 55, 40]` (spec 03 table) to fit them.

All models satisfy spec 06 conventions:
- Single root named after type id.
- Materials restricted to `body`, `team`, `dark`.
- Triangle budget <= 1500.
- Fits within render box with >= 70% fill along x and z.
- Baked ambient occlusion in `COLOR_0` with values in `[0.55, 1.0]`.

## Acceptance criteria

* AC-17-01: Given `GENERATED_TEXTURE_IDS`, Then `ua-camo` and `ru-camo` are present and loaded from `textures/<id>.webp`.
* AC-17-02: Given `bodyTextureId`, When category is `unit` and armor is `INFANTRY_ARMOR` (0), Then it returns `<faction>-camo`.
* AC-17-03: Given `bodyMapsOf`, When infantry camo is present in `textures`, Then `paint` is `<faction>-camo` and `bump` is undefined; when camo is missing, it falls back to `<faction>-paint`.
* AC-17-04: Given `createEntityRenderer`, When generated textures are set, Then Ukrainian infantry gets `ua-camo` on its `body` mesh and Russian infantry gets `ru-camo`, with no bump map; `setGeneratedTextures(null)` resets map to null.
* AC-17-05: Given the regenerated `.glb` models for `ua-rifleman`, `ru-rifleman`, `ua-stugna-team`, and `ru-rpg-gunner`, Then `node tools/models/check.mjs --strict` passes with 0 errors (valid materials, triangle budget <= 1500, bounding box and fill >= 70%, valid baked AO).
* AC-17-06: Given infantry models, Then they contain separate legs, arms holding weapons, ballistic helmets, and `team` material armbands for IFF identification.

## Traceability

| Criterion | Test |
| --- | --- |
| AC-17-01..04 | `client/src/render/infantry.test.ts` |
| AC-17-05..06 | `tools/models/check.mjs` and `client/src/render/infantry.test.ts` |

# 17 — Infantry appearance and camouflage textures

Status: accepted (owner request 2026-10-14, issue #264).
Depends on `06-phase4a-procedural-models.md`, `12-generated-textures.md`, `13-vehicle-liveries.md`, and `15-vehicle-skins.md`.
Decisions: D-01, D-02, D-05, D-07.

## 1. Context

In modern warfare (Armed Forces of Ukraine vs. Russian Armed Forces), infantry soldiers wear distinct modern combat equipment, helmets, plate carriers, identification tape armbands, and digital camouflage uniforms:
- **Ukraine:** MM-14 pixelated camouflage (*Maskuvalny Malyunok 2014*), high-cut FAST ballistic helmets with NVG mounts, modular plate carriers, and prominent yellow/blue identification armbands (`team` material).
- **Russia:** EMR Digital Flora camouflage (*Tsifra / Ratnik*), 6B47 ballistic helmets, 6B45 modular plate carriers, and prominent white/red identification armbands (`team` material).
- **Special infantry units:**
  - `ua-stugna-team`: Ukrainian Stugna-P (*Skif*) ATGM on tripod with optical guidance module (PN-I / PN-S), and the iconic remote control suitcase console (PDU-215) with display screen operated by a kneeling/crouching operator, accompanied by security.
  - `ru-rpg-gunner`: Russian anti-tank team featuring an RPG-7 launcher with its distinctive conical PG-7 warhead protruding forward from the muzzle, rocket backpacks carrying spare rockets, and assistant gunner with AK-74M.
  - `ua-rifleman` / `ru-rifleman`: 3-soldier rifle fireteams with separate articulated legs, arms holding assault rifles in combat-ready posture, ballistic helmets with goggles/NVG mounts, and plate carriers.

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
- Like buildings, infantry have flat shading and no bump map (`bump: undefined`).
- The `team` material on the soldiers is mapped to identification armbands (IFF tape) on both arms, which light up in the owner's team colour (or white/yellow/blue in match).

## 3. Models (`tools/models/`)

Procedural Blender Python generators for modern infantry:
- `tools/models/lib.py`:
  - `modern_soldier(name, faction, weapon, mats, height=0.5, pose="standing")`:
    - Two separate legs with combat boots (`dark`) and trousers (`body`).
    - Torso with combat jacket (`body`), tactical plate carrier / vest (`body`), and backpack / assault pack (`dark`).
    - Two arms holding the weapon forward in ready stance (`body`), with tactical gloves (`dark`).
    - Both upper arms wear identification armbands (`team`), capturing real-world combat IFF tape.
    - Head (`body`) with ballistic helmet (`body`/`dark`), NVG shroud/mount on forehead (`dark`), and goggles/visor (`dark`).
    - Weapon:
      - `rifle`: assault rifle (AK-74M / AK-12 / M4) with receiver, barrel, curved magazine (`dark`), and stock.
      - `launcher`: RPG-7 with tapered tube, heatshield, optical sight, and conical PG-7 rocket warhead protruding from the front (`dark` & `body`).
      - `remote`: crouching/kneeling operator with hands on the Stugna-P suitcase console (`team` screen, `dark` chassis).
- `tools/models/ua-rifleman.py`: 3 modern Ukrainian soldiers in fireteam formation with FAST helmets, plate carriers, yellow armbands, and rifles.
- `tools/models/ru-rifleman.py`: 3 modern Russian motor riflemen with 6B47 helmets, 6B45 vests, white armbands, and AK-74M/AK-12 rifles.
- `tools/models/ua-stugna-team.py`: Stugna-P tripod launcher with cylindrical tube and optical guidance box, connected to a PDU-215 remote control suitcase console operated by a crouching crew member, plus guard rifleman.
- `tools/models/ru-rpg-gunner.py`: RPG-7 gunner with rocket backpack and conical PG-7 rocket, plus assistant gunner with rocket backpack and rifle.

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

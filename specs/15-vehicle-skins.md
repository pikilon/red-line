# 15 — Vehicle skins and bump maps

Status: accepted (owner request 2026-10-13, issue #258).
Depends on `12-generated-textures.md` §4 and §6, and `13-vehicle-liveries.md`.

## 1. Context

Vehicles use a generated *skin* (plating with panel seams, bolts and wear)
instead of the flat `<faction>-paint`, and a *bump map* made from it so the
seams and bolts catch the light like relief. Bump mapping perturbs the surface
normal with the gradient of a height map; no geometry is added. In scope: the
`body` material of vehicles (`category: "unit"`, armor other than infantry).
Out of scope: infantry (keep `<faction>-paint`), buildings, `dark`, `team`.

## 2. Textures

`GENERATED_TEXTURE_IDS` gains `ua-skin`, `ru-skin`, `ua-skin-bump`, `ru-skin-bump`
(`client/public/textures/<id>.webp`). `<f>-skin` is a detail colour map like the
paint ones (mean 0.9); `<f>-skin-bump` is a greyscale height map centred on 128,
produced by `texture_tool.py bump <id>` (luminance of the accepted skin minus its
blur, so it is seamless and keeps the relief, not the tint).

## 3. Material

```ts
/** `<faction>-skin` for vehicles, `<faction>-paint` for infantry, `-concrete` for buildings. */
export function bodyTextureId(typeId: string, category: string, armor?: number): GeneratedTextureId;
export const BUMP_SCALE: number;
export function applyBodyTextures(material, paint, dark, bump?: Texture): void;
```

`applyBodyTextures` sets `material.bumpMap = bump ?? null` and
`material.bumpScale = BUMP_SCALE` (and `needsUpdate` when the map changes).
The renderer passes the bump of the faction only for a vehicle whose skin is
loaded; a vehicle whose skin is missing falls back to `<faction>-paint` with no
bump. The livery (spec 13) is a painted patch over the skin; its weight is `0.95`, it
modulates by the skin detail and the bump fades out under it (the flag is flat).
`BUMP_SCALE` is 0.4 and vehicle skins tile every `VEHICLE_TILE` = 0.6 model units.

## Acceptance criteria

* AC-15-01: Given the texture ids, Then `ua-skin`, `ru-skin`, `ua-skin-bump`
  and `ru-skin-bump` are loaded from `textures/<id>.webp`.
* AC-15-02: Given loaded textures, When the renderer applies them, Then a
  Ukrainian vehicle has `ua-skin` as `map` and `ua-skin-bump` as `bumpMap`, a
  Russian one the `ru-*` pair, infantry keep `-paint` with no `bumpMap`, buildings
  keep `-concrete` with no `bumpMap`; `setGeneratedTextures(null)` clears both.
* AC-15-03: Given a vehicle whose skin is not loaded, Then it uses `-paint` and
  has no `bumpMap`.
* AC-15-04: Given a running showcase, Then vehicles show the skin and relief
  (screenshot check by the agent) without console errors.

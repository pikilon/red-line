# 13 — Vehicle liveries

> Revised 2026-10-13 (owner feedback; later: the Z is painted on the skin and the small tricolour sits on another surface): the liveries are painted patches over the vehicle skin, not full-body paint; the Russian one is the tricolour with the Z over it. §2 and §3 describe the final behaviour; where the earlier text below says full bands or a bare Z, read patch.

Status: accepted (owner request 2026-10-13, issue #256).
Depends on `12-generated-textures.md` §4 and §6 (box-projected `body` material).

## 1. Context

Owner request: Ukrainian vehicles wear both colours of their flag (blue and
yellow); Russian vehicles wear the white Z they paint on theirs. A *vehicle* is a
type with `category: "unit"` and `armor` other than infantry (armor class index 0, as in `animation.ts`). The
faction is the type id prefix (`ua-` / `ru-`); types with neither prefix have no livery.

In scope: the `body` slots (hull and turret) of vehicles. Out of scope: infantry,
buildings, depots, `dark` (tracks, wheels), the `team` stripe, the unit box
fallback (no `body`). Liveries are procedural and independent of the
generated-textures toggle.

## 2. Pattern (`client/src/render/liveries.ts`)

```ts
export const LIVERIES = { ua: "ua", ru: "ru" } as const;
export type Livery = (typeof LIVERIES)[keyof typeof LIVERIES];

export const UA_BLUE = 0x2f5d8c;
export const UA_YELLOW = 0xc4a13c;
export const RU_WHITE = 0xdcd8cb;

/** The livery of a type, or `null` for infantry, buildings and depots. */
export function liveryOf(typeId: string, category: string, armor: number): Livery | null;

/** The pattern at (u, v), both in 0..1, v up: colour 0xRRGGBB and alpha 0..1. */
export function liverySample(livery: Livery, u: number, v: number): { color: number; alpha: number };

/** 256 x 256 clamp-to-edge texture of `liverySample`. */
export function createLiveryTexture(livery: Livery): DataTexture;

/** Adds the `livery` attribute (u, v, mask) to an opaque model geometry. */
export function addLiveryAttribute(geometry: BufferGeometry, livery: Livery): BufferGeometry;
```

* Both liveries are one *patch* (a flag, 3:2 at most) painted by hand: ragged
  alpha border of about 0.035 (`patchAlpha`), colour bands that wobble, and
  horizontal brush streaks in the texture. Alpha is 0 outside the patch.
* `ua`: blue for `v >= 0.5`, yellow below (flag order).
* `ru`: the Russian tricolour (white, blue, red from the top); a white Z (top
  bar, bottom bar and diagonal) is painted over it with a dark outline
  (`Z_OUTLINE`, 0.022 wide) so it reads on the white band.
* The colours are muted, as on vehicles in the field (owner reference, a dusty
  Bradley): `UA_BLUE` 0x2f5d8c, `UA_YELLOW` 0xc4a13c, `RU_WHITE` 0xdcd8cb,
  `RU_BLUE` 0x2b4a7c, `RU_RED` 0x9a3a2e. The texture is weathered: grime darkens
  the paint and chips wear it to 27 % opacity; `liverySample` itself stays
  clean (colour and alpha of the design).

## 3. Mapping

One patch per face kind (side +x, side -x, roof) on the surface where it fits
largest, never on the ends or the bottom; `dark` vertices get mask 0. A surface
is a connected set of coplanar flat triangles (normal within 0.95 of an axis).
The patch is centred on that surface (side: `u` along z, mirrored on -x so it
reads from outside, `v` up; roof: `u` along x, `v` along z), is `PATCH_SIZE` of its
short extent (`ua` 0.6, `ru` 0.85) and at most 1.5 times wider than tall, so it
never covers a whole side. On a roof the boxes standing on it (the `dark` cab,
the turret reach from the hull's pivot) are cut out and the patch goes in the
largest free strip around them. Vertices of other surfaces get mask 0.

### Russian placement (owner marks, 2026-10-13)

* A hull with a turret (T-72B3, BMP-2, BRDM-2): the Z on the hood (frontmost
  roof), the tricolour on the turret top and the sides.
* TOS-1A (`Z_ON_TURRET`): the Z on the launcher top, the tricolour on the sides.
* A hull without a turret (dozer, supply truck): the tricolour on the cab roof
  (frontmost roof) and the Z on the biggest other roof.
* The tricolour is brighter (`RU_BLUE` 0x2f5fc0, `RU_RED` 0xcc3a2c).
* `ua` keeps its flag on the hood, the cab roof and, for the HIMARS
  (`FLAG_ON_TURRET`), the launcher top.

## 4. Shading

`createBodyMaterial` gains a `liveryMap` uniform (`applyLivery(material, texture |
null)`). After the vertex colour is applied, the fragment mixes the livery colour
over the diffuse colour with weight `alpha * inside * mask * (1 - darkMask) * 0.95`, where `inside` is 1 only for `(u, v)` within 0..1 (the coarse mips of the texture are not empty), and multiplies the colour by the skin detail (0.75..1.05). The painted patch is flat: the bump of the skin (spec 15) fades out under it.
Buildings and any slot without the attribute are unchanged. `EntityRenderer` adds
the attribute and sets the texture when it creates the `body` slot of a type
whose `liveryOf` is not `null`.

## 5. Team stripe and the painted Z

Vehicles do not draw the `team` stripe (the red and blue bands read as noise
next to a flag): the faction already tells the sides apart. Infantry and
buildings keep it. The Z is painted like the real markings: thin brushed strokes
of off-white paint with a firm, wobbling edge, dry-brush streaks, thin patches
and a few drips below the bottom bar; it has no background. Reference: Russian field photos (a thin chalky Z on the
hull top, broken by the relief under it). Per-vertex mask of the `livery`
attribute: 1 flag patch, 2 the small flag (right half of the atlas), 3 the Z;
the bump fades out under masks 1 and 2 (flat flags) but not under 3, so the Z
follows the relief of the skin.

## Acceptance criteria

* AC-13-01: Given the type ids, When `liveryOf` runs, Then `ua-bradley`,
  `ua-leopard-2a4`, `ua-himars`, `ua-dozer`, `ua-supply-truck`, `ua-kozak-scout`
  give `ua`; `ru-t-72b3`, `ru-bmp-2`, `ru-brdm-scout`, `ru-tos-1a`, `ru-dozer`,
  `ru-supply-truck` give `ru`; infantry, buildings and depots give `null`.
* AC-13-02: Given `ua`, When sampled inside the patch, Then the upper half is
  blue, the lower half yellow and alpha is 1; the border is ragged (alpha 0 at
  the edge and outside).
* AC-13-03: Given `ru`, When sampled, Then the Z (centre, top bar, bottom bar)
  is white with alpha 1, its outline right above the top bar is dark, and away
  from the Z the tricolour shows (white at the top, blue in the middle, red at
  the bottom); alpha is 0 at the border.
* AC-13-04: Given a box geometry with `darkMask`, When `addLiveryAttribute` runs
  for either livery, Then top and side vertices have mask 1, end and bottom
  vertices 0, and `dark` vertices 0.
* AC-13-05: Given a renderer with a vehicle model, When the `body` slot is
  created, Then Ukrainian and Russian vehicles carry the `livery` attribute and a
  `liveryMap`, an infantry type and a building do not.
* AC-13-07: Given a model with a large low surface and a small raised one, When
  `addLiveryAttribute` runs for `ru`, Then the glyph (mask 1) is whole and centred
  on the largest flat surface of each side and of the roof, and the other
  surfaces get mask 0.
* AC-13-08: Given a roof with a `dark` box (cab) or a turret standing on part of
  it, When `addLiveryAttribute` runs for `ru`, Then the glyph is centred on the
  largest free strip around that box, not on the whole roof.
* AC-13-09: Given vehicle, infantry and building types with a `team` part, Then
  vehicles get no `team` slot and the others do.
* AC-13-10: Given Russian hulls, Then the decals follow the placement above.
* AC-13-06: Given a running skirmish, When a Ukrainian and a Russian vehicle are
  on screen, Then the blue/yellow and the white Z are visible (screenshot check
  by the agent; the game keeps running without console errors).

## Traceability

| Criterion | Test |
| --- | --- |
| AC-13-01..04, 07, 08 | `client/src/render/liveries.test.ts` |
| AC-13-05 | `client/src/render/liveries.test.ts` "AC-13-05: renderer slots" |
| AC-13-06 | `client/tests/e2e/liveries.spec.ts` |

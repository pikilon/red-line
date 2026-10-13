# 13 — Vehicle liveries

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

export const UA_BLUE = 0x0057b7;
export const UA_YELLOW = 0xffd700;
export const RU_WHITE = 0xffffff;

/** The livery of a type, or `null` for infantry, buildings and depots. */
export function liveryOf(typeId: string, category: string, armor: number): Livery | null;

/** The pattern at (u, v), both in 0..1, v up: colour 0xRRGGBB and alpha 0..1. */
export function liverySample(livery: Livery, u: number, v: number): { color: number; alpha: number };

/** 256 x 256 clamp-to-edge texture of `liverySample`. */
export function createLiveryTexture(livery: Livery): DataTexture;

/** Adds the `livery` attribute (u, v, mask) to an opaque model geometry. */
export function addLiveryAttribute(geometry: BufferGeometry, livery: Livery): BufferGeometry;
```

* `ua`: alpha 1 everywhere, blue for `v >= 0.5`, yellow below (flag order).
* `ru`: alpha 1 on the strokes of a Z (top bar, bottom bar and the diagonal from
  top right to bottom left), 0 elsewhere and on the border pixels.

## 3. Mapping

`addLiveryAttribute` works on the vertices with `darkMask = 0` of the geometry
(its bounding box is the "body box"; `dark` vertices get mask 0). Per vertex the
dominant axis of the normal chooses the face:

* side (±x): `u` along z (mirrored on −x so the glyph reads from outside), `v` up;
* top (+y): `u` along x, `v` along z (front is +z);
* end (±z): `u` along x, `v` up (`ua` only; mask 0 for `ru`);
* bottom (−y): mask 0.

`ru` places one glyph per face kind, on the largest connected coplanar flat
surface (normal within 0.95 of the axis, same plane, touching), centred on that
surface's own box instead of the whole body box, so the Z is never split
across levels. On a roof, boxes standing on it (the `dark` cab, the turret reach
from the hull's pivot) are cut out and the glyph goes in the largest free strip
around them. The glyph goes where it fits largest (short extent of the free
area), per face kind. `ua`: `v` is the normalised position across the body box (height on sides and
ends, length on top) and `u` is irrelevant. `ru`: the glyph is square, of size
`0.9 * min(extentU, extentV)` centred on the face, so `(u, v)` leave 0..1 outside
the glyph box and the clamped transparent border hides it.

## 4. Shading

`createBodyMaterial` gains a `liveryMap` uniform (`applyLivery(material, texture |
null)`). After the vertex colour is applied, the fragment mixes the livery colour
over the diffuse colour with weight `alpha * mask * (1 - darkMask) * 0.9`.
Buildings and any slot without the attribute are unchanged. `EntityRenderer` adds
the attribute and sets the texture when it creates the `body` slot of a type
whose `liveryOf` is not `null`.

## Acceptance criteria

* AC-13-01: Given the type ids, When `liveryOf` runs, Then `ua-bradley`,
  `ua-leopard-2a4`, `ua-himars`, `ua-dozer`, `ua-supply-truck`, `ua-kozak-scout`
  give `ua`; `ru-t-72b3`, `ru-bmp-2`, `ru-brdm-scout`, `ru-tos-1a`, `ru-dozer`,
  `ru-supply-truck` give `ru`; infantry, buildings and depots give `null`.
* AC-13-02: Given `ua`, When sampled, Then the upper half is blue, the lower half
  yellow and alpha is 1.
* AC-13-03: Given `ru`, When sampled, Then the centre of the top bar, of the
  bottom bar and of the diagonal are white with alpha 1, and the points left of the diagonal (0.2, 0.65), right of it (0.8, 0.35), the sides (0.2, 0.5), (0.8, 0.5)
  and the border are transparent.
* AC-13-04: Given a box geometry with `darkMask`, When `addLiveryAttribute` runs
  for `ru`, Then top and side vertices have mask 1, end and bottom vertices 0,
  and `dark` vertices 0; for `ua` ends also have mask 1.
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
* AC-13-06: Given a running skirmish, When a Ukrainian and a Russian vehicle are
  on screen, Then the blue/yellow and the white Z are visible (screenshot check
  by the agent; the game keeps running without console errors).

## Traceability

| Criterion | Test |
| --- | --- |
| AC-13-01..04, 07, 08 | `client/src/render/liveries.test.ts` |
| AC-13-05 | `client/src/render/liveries.test.ts` "AC-13-05: renderer slots" |
| AC-13-06 | `client/tests/e2e/liveries.spec.ts` |

# 16 — Building facades and HQ flags

Status: accepted (owner request 2026-10-13, issue #262).
Depends on `12-generated-textures.md` §4 and §6 (box-projected `body` material)
and `13-vehicle-liveries.md` §2 (flag colours).

## 1. Context

The owner wants better building textures, sourced through the cnc-assets
catalogue and inspired by real Russian and Ukrainian buildings, and the flag of
each side on its main building (the HQ).

Today every building wears `<faction>-concrete`, a near-white detail map
multiplied by the olive `body` colour of the model: walls and roofs look the
same and the building reads as a green block.

Real references:

* Ukraine: silicate brick, very common in Ukrainian Soviet-era buildings,
  weathered grey with dark joints, grime and rain streaks, with grey corrugated
  asbestos-cement ("shyfer") roofs.

Owner review (2026-10-14): a first version gave Russian buildings red brick and
green corrugated roofs, and Ukrainian ones clean white brick. The owner found
the Ukrainian look toy-like and preferred the Russian buildings as they were:
Russian buildings keep `ru-concrete` (spec 12 §6), and the Ukrainian silicate
is weathered.

In scope: the `body` material of Ukrainian buildings (`category: "building"`)
and a flag on each faction's HQ. Out of scope: units, depots, `dark`, `team`. Liveries
(spec 13) are unchanged.

## 2. Textures (`tools/asset-pipeline/facades.py`)

Two 512 px WebP files in `client/public/textures/`, in real colour (not detail
maps), derived only from CC0 Poly Haven sources of the licensed library
(`04_CC0_Public_Domain`, listed in `tools/asset-pipeline/LICENSES.md`):

| Id | Source | Treatment |
| --- | --- | --- |
| `ua-wall` | `modular_factory_facade_brick_diff_1k.jpg` and its `_arm_` ambient occlusion | luminance tinted grey silicate, joints darkened by the AO, tileable grime blotches and vertical rain streaks |
| `ua-roof` | `modular_factory_facade_garage_diff_1k.jpg`, rows 442..732 (one corrugation period), transposed so the corrugation runs down the slope | luminance tinted grey asbestos-cement, grime blotches |

`GENERATED_TEXTURE_IDS` (spec 12 §4) gains `ua-wall` and `ua-roof`, so they load with the other generated textures. `facades.py`
regenerates them; no EA, OpenRA or freeware art is used (D-02).

## 3. Model (`client/src/render/facades.ts`)

```ts
/** Spec 16: the wall and roof textures of a building, or null. */
export function facadeTextureIds(
  typeId: string,
  category: string,
): { wall: GeneratedTextureId; roof: GeneratedTextureId } | null;

/** Per-channel 1 / colour (sRGB 0xRRGGBB converted to linear), so that the
 *  texture shows its own colour over the `body` vertex colour. */
export function untintOf(bodyColor: number): [number, number, number];

/** Adds the facade uniforms and shader code to a body material. */
export function enableFacades(material: MeshLambertMaterial, bodyColor: number): void;

/** Sets the roof texture and the untint; `null` restores the plain body. */
export function applyFacade(material: MeshLambertMaterial, roof: Texture | null): void;
```

* `facadeTextureIds`: `ua-wall` / `ua-roof` for buildings whose type id starts
  with `ua-`; `null` for units, depots, Russian buildings and types without a
  faction prefix.
* Shading: a vertex whose object-space normal has `y >= ROOF_NORMAL_Y` (0.6, so
  45° gables count) samples the roof map, any other the
  wall map (`material.map`). With a facade applied, the body colour is divided
  out (`untint`), so walls and roofs show the texture's own colour times the
  baked ambient occlusion; `dark` vertices keep `dark-metal`.
* `EntityRenderer`: the `body` slot of a building with a facade calls
  `enableFacades` with the colour of its `body` part. With generated textures on
  and `ua-wall` loaded, the map is the wall and `applyFacade` gets the
  roof (the wall when the roof is missing). Otherwise the slot behaves as in
  spec 12 (`<faction>-concrete`, `applyFacade(material, null)`).

## 4. HQ flags (`client/src/render/flags.ts`)

```ts
export const FLAGS = {
  ukraine: [UA_BLUE, UA_YELLOW],          // top to bottom
  russia: [RU_WHITE, RU_BLUE, RU_RED],
} as const;

/** The stripes of the flag flown on `kind`, or null when it is no HQ. */
export function flagOf(kind: number): readonly number[] | null;

/** The stripe colour at height v (0 bottom, 1 top) of horizontal stripes. */
export function flagSample(stripes: readonly number[], v: number): number;

/** Wave offset (model units, along z) of the cloth at s (0 at the pole, 1 at
 *  the fly end) and time t (seconds) with a per-instance phase. */
export function flagWave(s: number, t: number, phase: number): number;

export interface FlagRenderer {
  readonly group: Group;
  readonly poles: InstancedMesh;
  /** One cloth mesh per faction id of `FLAGS`. */
  readonly cloths: Readonly<Record<string, InstancedMesh>>;
  update(entities: readonly EntityState[], nowMs: number): void;
}
export function createFlagRenderer(capacity: number): FlagRenderer;
```

* `RU_BLUE = 0x0039a6`, `RU_RED = 0xd52b1e`; `UA_BLUE`, `UA_YELLOW`, `RU_WHITE`
  come from `liveries.ts`.
* `flagOf(kind)`: the faction whose `hq` is `kind`; its id selects `FLAGS`.
* An HQ that is complete (not a ghost, not under construction) gets a pole at
  its front-left corner, `x - w/2 + POLE_INSET`, `z + d/2 - POLE_INSET`
  (`POLE_INSET` 0.2), of height `h + POLE_ABOVE` (1.2), and a cloth of
  `FLAG_LENGTH` 1.2 by `FLAG_HEIGHT` 0.8 (2:3) hanging from its top towards +x.
* The cloth waves in the vertex shader with `flagWave`: amplitude
  `FLAG_AMPLITUDE` (0.1) times `s`, so it is still at the pole; the phase is the
  instance's x position. Double-sided, flat Lambert shading.
* Draw calls (AC-03-62): the shaft and its ball finial are one geometry (the
  shaft reaches below the terrain, so one mesh fits any HQ height), so flags
  cost at most one call for the poles and one per faction; an empty mesh is
  hidden and the others are frustum-culled by the bounds of their instances.
  Poles and cloths cast no shadow: the pole mesh's bound spans every HQ, so a
  shadow pass would cost a call even with no HQ on screen.
* `EntityRenderer` owns a `FlagRenderer`, adds its group and updates it at the
  end of `update(entities, selected, nowMs)`. Flags are procedural and do not
  depend on the textures toggle.

## 5. Flag bands on buildings (`client/src/render/flags.ts`)

Owner request (2026-10-13, follow-up): the `team` stripes of buildings, today
in the owner colour (spec 06 §5), wear the flag of the building's faction
instead: Ukrainian buildings blue over yellow, Russian ones white, blue and red
(`FLAGS`, the same faction prefix as `facadeTextureIds`). Units keep the owner
colour.

```ts
/** Stripes of the flag on a type's `team` parts, or null (units, depots,
 *  types without a faction prefix). */
export function bandsOf(typeId: string, category: string): readonly number[] | null;

/** Adds the `band` attribute: per connected piece of `geometry` (triangles
 *  sharing vertex positions), v = (y - minY) / (maxY - minY) of that piece,
 *  0 at its bottom and 1 at its top; a flat piece gets 1. */
export function addBandAttribute(geometry: BufferGeometry): BufferGeometry;

/** Makes a `team` material draw `stripes` as horizontal bands by `band`,
 *  times the vertex colour (occlusion and instance colour), wherever the
 *  per-instance `bandOn` attribute is 1. */
export function enableBands(material: MeshLambertMaterial, stripes: readonly number[]): void;
```

* `EntityRenderer`: the `team` slot of a building whose `bandsOf` is not null
  gets `addBandAttribute`, an `InstancedBufferAttribute` `bandOn` (one float
  per instance) and `enableBands`. An unselected instance has instance colour
  white and `bandOn` 1 (the flag shows); a selected one has `SELECTED_COLOR`
  and `bandOn` 0 (plain selection colour, as before).
* The band colour at `band = v` is `flagSample(stripes, v)`.

## Acceptance criteria

* AC-16-01: Given the type ids, When `facadeTextureIds` runs, Then `ua-hq`,
  `ua-barracks` and `ua-power-plant` give `ua-wall` / `ua-roof`, and `ru-hq`,
  `ru-barracks`, `ua-bradley`, `ru-rifleman` and `supply-depot` give `null`.
* AC-16-02: Given a body colour, When `untintOf` runs, Then each channel times
  the linear colour is 1.
* AC-16-03: Given a renderer with a building model and generated textures with
  `ua-wall` and `ua-roof`, When a Ukrainian barracks is drawn, Then its body
  map is the wall, its roof uniform is the roof and its untint is not 1;
  without `ua-roof` the roof uniform is the wall; with textures `null` the map
  is `null` and the untint is 1. A vehicle and a Russian barracks have no
  facade uniforms, and the Russian barracks' map is `ru-concrete`.
* AC-16-04: Given the HQ kinds, When `flagOf` runs, Then `ua-hq` gives the
  Ukrainian stripes, `ru-hq` the Russian ones, and a barracks gives `null`;
  `flagSample` of the Ukrainian flag is blue at the top and yellow at the
  bottom, of the Russian flag white, blue and red from top to bottom.
* AC-16-05: Given `flagWave`, Then it is 0 at the pole (s = 0) for any t and
  never exceeds `FLAG_AMPLITUDE` in magnitude.
* AC-16-06: Given a complete Ukrainian HQ, a Russian HQ under construction, a
  ghost HQ and a barracks, When the flag renderer updates, Then there is one
  pole and one Ukrainian cloth at the HQ's front-left corner and no Russian
  cloth; when the Russian HQ completes there are two poles and one cloth each.
* AC-16-08: Given the type ids, When `bandsOf` runs, Then `ua-barracks`
  gives the Ukrainian stripes, `ru-hq` the Russian ones, and `ua-bradley`,
  `ru-rifleman` and `supply-depot` give `null`. Given two boxes at different
  heights merged into one geometry, When `addBandAttribute` runs, Then each
  box's bottom vertices have band 0 and its top vertices band 1.
* AC-16-09: Given a renderer with a model that has `team` parts, When an
  unselected Ukrainian barracks, a selected one and a vehicle are drawn, Then
  the barracks `team` slot has the `band` attribute and Ukrainian band colours,
  the unselected instance has colour white and `bandOn` 1, the selected one
  `SELECTED_COLOR` and `bandOn` 0, and the vehicle's `team` slot has no
  `band` attribute and its owner colour.
* AC-16-07: Given the showcase, When the game runs with generated textures,
  Then the facade textures load, the flags are drawn and there are no console
  errors (the agent also checks a screenshot).

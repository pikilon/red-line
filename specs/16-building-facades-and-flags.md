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

* Russia: Soviet-era military barracks of red brick ("voenny gorodok") with
  green-painted corrugated steel roofs.
* Ukraine: white silicate brick, very common in Ukrainian Soviet-era buildings,
  with grey corrugated asbestos-cement ("shyfer") roofs.

In scope: the `body` material of buildings (`category: "building"`) and a flag
on each faction's HQ. Out of scope: units, depots, `dark`, `team`. Liveries
(spec 13) are unchanged.

## 2. Textures (`tools/asset-pipeline/facades.py`)

Four 512 px WebP files in `client/public/textures/`, in real colour (not detail
maps), derived only from CC0 Poly Haven sources of the licensed library
(`04_CC0_Public_Domain`, listed in `tools/asset-pipeline/LICENSES.md`):

| Id | Source | Treatment |
| --- | --- | --- |
| `ru-wall` | `modular_factory_facade_brick_diff_1k.jpg` | slightly weathered red brick |
| `ua-wall` | same brick | luminance tinted pale cream-grey, brick/mortar contrast inverted |
| `ru-roof` | `modular_factory_facade_garage_diff_1k.jpg`, rows 442..732 (one corrugation period) | luminance tinted green paint |
| `ua-roof` | same crop | luminance tinted grey asbestos-cement |

`facades.py` regenerates them; no EA, OpenRA or freeware art is used (D-02).

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

* `facadeTextureIds`: faction by type id prefix (`ua-` / `ru-`); `null` for
  units, depots and types with neither prefix.
* Shading: a vertex whose object-space normal has `y >= ROOF_NORMAL_Y` (0.6, so
  the 45° gable of the Russian HQ counts) samples the roof map, any other the
  wall map (`material.map`). With a facade applied, the body colour is divided
  out (`untint`), so walls and roofs show the texture's own colour times the
  baked ambient occlusion; `dark` vertices keep `dark-metal`.
* `EntityRenderer`: the `body` slot of a building with a facade calls
  `enableFacades` with the colour of its `body` part. With generated textures on
  and `<faction>-wall` loaded, the map is the wall and `applyFacade` gets the
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
* `EntityRenderer` owns a `FlagRenderer`, adds its group and updates it at the
  end of `update(entities, selected, nowMs)`. Flags are procedural and do not
  depend on the textures toggle.

## Acceptance criteria

* AC-16-01: Given the type ids, When `facadeTextureIds` runs, Then `ru-hq` and
  `ru-barracks` give `ru-wall` / `ru-roof`, `ua-hq` and `ua-power-plant` give
  `ua-wall` / `ua-roof`, and `ua-bradley`, `ru-rifleman` and `supply-depot`
  give `null`.
* AC-16-02: Given a body colour, When `untintOf` runs, Then each channel times
  the linear colour is 1.
* AC-16-03: Given a renderer with a building model and generated textures with
  `ru-wall` and `ru-roof`, When the building is drawn, Then its body map is the
  wall, its roof uniform is the roof and its untint is not 1; without
  `ru-roof` the roof uniform is the wall; with textures `null` the map is
  `null` and the untint is 1. A vehicle has no facade uniforms.
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
* AC-16-07: Given the showcase, When the game runs with generated textures,
  Then the facade textures load, the flags are drawn and there are no console
  errors (the agent also checks a screenshot).

## Traceability

| Criterion | Test |
| --- | --- |
| AC-16-01..03 | `client/src/render/facades.test.ts` |
| AC-16-04..06 | `client/src/render/flags.test.ts` |
| AC-16-07 | `client/tests/e2e/facades.spec.ts` |

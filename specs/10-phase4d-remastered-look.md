# 10 — Phase 4d Remastered look and classic mode

Status: proposed for owner review (written for the 2026-10-11 unattended run).
Supersedes `09-phase4c-animation-and-finish.md` §7–8 (pixel-art pass) and
amends its §6 (building death). Depends on specs 06, 07 and 09. Roadmap:
Phase 4. Decisions: D-05 (2.5D low-poly, orthographic isometric camera), D-07
(models as code).

## 1. Context

The owner's style reference is *Command & Conquer: Red Alert Remastered*:
textured ground with grass, dirt and rock, strong warm light with hard shadows,
saturated team colours, bevelled models that read as pre-rendered sprites.
Like the Remastered release, the original 1996 look stays one key away:
`V` toggles a **classic** mode (low resolution, nearest-neighbour upscale,
reduced palette). The posterised pass of spec 09 §7 is therefore not the
default look but the classic mode.

**Exit criterion:** the owner opens a skirmish and finds the scene closer to
Red Alert Remastered than to coloured boxes on a flat green plane (textured
ground with rock outcrops, cast shadows, bevelled shaded models), `V` switches
to a pixelated classic look and back, and AC-03-62/63 still pass.

## 2. Scope

In: terrain textures and raised rock tiles, shadows and warm lighting, model
bevels and baked ambient occlusion, classic mode, building death without the
vehicle wreck box.

Out: image or AI-generated textures (ComfyUI, issue #5), new model shapes,
water and shorelines, day/night, perspective camera (D-05 keeps the
orthographic isometric camera), any simulation change.

## 3. Lighting and shadows (`client/src/app/skirmish.ts`, `client/src/render/entities.ts`)

* Renderer: `shadowMap.enabled = true`, `shadowMap.type = BasicShadowMap`
  (hard shadows as in Red Alert; PCF filtering cost about 30 % of a frame on
  the software WebGL of CI and broke frame-dependent UI tests),
  `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.1`.
* Lights: `SUN_COLOR = 0xfff1d6`, `SUN_INTENSITY = 2.2`, `SUN_POSITION =
  (-30, 60, 30)` (from the top left of the screen, so shadows fall to the
  right of each object instead of hiding behind it as with the camera-side
  sun of spec 06); `HEMISPHERE_SKY = 0xdde8ff`,
  `HEMISPHERE_GROUND = 0x3a3020`, `HEMISPHERE_INTENSITY = 0.9`.
* The sun casts shadows: `castShadow = true`, `shadow.mapSize = 2048 × 2048`,
  orthographic shadow camera of half-size `SHADOW_EXTENT = 24` tiles,
  `shadow.bias = -0.0005`. Every frame the sun and its `target` are moved so
  the shadow camera stays centred on the camera's ground target (sun position =
  target + `SUN_POSITION` direction × 50).
* Entity renderer: model `InstancedMesh`es, fallback boxes and scaffolds set
  `castShadow = true` and `receiveShadow = true`; ghosts, bars and tracers do
  not. Effects do not cast shadows except `wreck` and `debris`.
* `OWNER_COLORS` become `[0x1d5fe0, 0xe01b1b]` (more saturated).
* Draw-call bound (AC-06-06) becomes `4 × (number of types on screen) + 10`,
  because the shadow pass draws every caster once more; AC-06-06's test is
  updated to that bound by the issue that enables shadows.

### 3.1 Scaffolding shadow (deferred, owner request 2026-10-12)

Scaffolding beams are 0.03 tiles thick, one or two texels of the shadow map,
so their hard shadows (§3) render as broken, flickering lines when the camera
moves. Scaffolds will receive shadows but not cast them
(`scaffolds.castShadow = false`); the building under construction keeps
casting its growing shadow. Scheduled later as P4-17 (#216).

## 4. Terrain (`client/src/render/terrain.ts`, `client/src/render/terrainTexture.ts`)

`terrainTexture.ts` builds the ground textures procedurally (no image files):

```ts
export const TEXTURE_SIZE = 256;          // pixels per texture, tiles 4 × 4 map tiles
export const TERRAIN_KINDS = ["grass", "dirt", "rock"] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** Deterministic 32-bit PRNG (mulberry32). */
export function createRng(seed: number): () => number;

/** Smooth value noise in [0, 1], period `period` pixels, seeded. */
export function valueNoise(x: number, y: number, period: number, seed: number): number;

/** RGBA pixels (TEXTURE_SIZE² × 4) of `kind`, seamless (left/right and
 *  top/bottom edges match). grass: base 0x3f6b2a with two noise octaves
 *  (periods 64 and 16) mixing towards 0x2c5220 and 0x5c8a3a plus 3 % darker
 *  speckles; dirt: base 0x7a5f3e mixed towards 0x5e4630 and 0x96784f; rock:
 *  base 0x7d756b mixed towards 0x5a534b and 0xa39a8e with dark crack lines
 *  where |noise(period 32) − 0.5| < 0.02. */
export function terrainPixels(kind: TerrainKind, seed: number): Uint8ClampedArray;

/** One `DataTexture` per kind (sRGB, RepeatWrapping, mipmaps, linear filter). */
export function createTerrainTextures(seed: number): Record<TerrainKind, Texture>;
```

`createTerrain(width, height, tiles, seed = 1)`:

* Ground: one mesh for passable tiles with `MeshLambertMaterial({ map: grass,
  vertexColors: true })`, UVs = world `(x, z) / 4` so the texture repeats every
  4 tiles; a second mesh of the same tiles with the `dirt` texture,
  transparent, whose per-vertex alpha is `smoothstep(0.55, 0.7,
  valueNoise(x, z, 12 tiles, seed))` — irregular dirt patches. Both receive
  shadows.
* Rock tiles are the map's static obstacles only: the cells inside the
  `blocked` rectangles of the map definition in the ruleset
  (`ruleset.maps[i].blocked`, `[x0, y0, x1, y1]` inclusive). The `tiles` array
  of the ready message is not used for rock, because it also marks cells
  occupied by buildings and depots. `createTerrain(width, height, rockCells,
  seed)` takes a `Uint8Array` (1 = rock) built from those rectangles by
  `rockCellsOf(map)` in `terrain.ts`.
* Rock tiles become rock: one mesh of boxes, tile footprint, height
  `0.35 + 0.4 × valueNoise(x, z, 3 tiles, seed + 1)` tiles, top vertices
  jittered ±0.08 tiles by the PRNG, `rock` texture, flat shading, cast and
  receive shadows.
* `PASSABLE_COLOR` and `BLOCKED_COLOR` remain exported (minimap and tests).
* Picking is unchanged (rays still hit the y = 0 plane).

## 5. Model detail (`tools/models/lib.py`, `client/src/render/models.ts`, `client/src/render/entities.ts`)

* `box()` default bevel becomes `0.02` tiles (segments 1, `limit_method =
  "ANGLE"`) for boxes whose smallest side is at least 0.1 tiles; smaller boxes
  stay sharp. `cylinder()` gains the same bevel on its caps.
* `export()` bakes ambient occlusion into a `COLOR_0` vertex attribute before
  writing the `.glb`: for every vertex, AO = fraction of 16 fixed hemisphere
  directions (around the vertex normal) whose ray of length 0.5 tiles does not
  hit the model (`BVHTree.ray_cast`), mapped to `0.55 + 0.45 × AO`, stored in
  RGB (alpha 1). The exporter writes `COLOR_0` (`export_colors=True` or the
  4.x equivalent `export_vertex_color='ACTIVE'`).
* Triangle budgets of spec 06 §3 still hold; a script over budget reduces its
  own detail, not the budget.
* Client: `models.ts` keeps `COLOR_0` on each part geometry; `entities.ts`
  `withColor` multiplies the material colour by `COLOR_0` when present (so
  `body` and `dark` carry AO), and the `team` material uses `vertexColors:
  true` when the geometry has `COLOR_0`. Without `COLOR_0` output is today's.
* All `.glb` are rebuilt with `node --run assets:build`; `node --run
  assets:check --strict` passes.

## 6. Building death (amends spec 09 §6)

A dead building spawns only its 8 `debris` pieces (no `wreck`); vehicles keep
the `wreck`. The `debris` colour becomes `0x4a4038` and each piece's height is
`s × 0.8`.

## 7. Classic mode (replaces spec 09 §7–8)

Spec 09 §7 applies with these changes:

* `PIXEL_SIZE = 3`, `COLOR_LEVELS = 8` (512 colours, close to the original
  256-colour palette).
* The setting is `classic: boolean`, default **false**; `Settings` becomes
  `{ gore: boolean; classic: boolean }`, each field validated on its own (a
  stored `{ "gore": false }` loads as `{ gore: false, classic: false }`).
* `V` toggles `classic`, saves it, sets `pass.enabled` and shows the toast
  `settings.classicOn` / `settings.classicOff` ("Classic graphics" /
  "Remastered graphics"). Debug API: `classic(): boolean`.
* With classic on, shadows stay on (the original had baked shadows) but the
  pass renders at one third of the resolution.

## 8. Acceptance criteria

**AC-10-01 Procedural textures.** `createRng(7)` yields the same sequence twice;
`valueNoise` stays in [0, 1] and is periodic (`valueNoise(x + period, y, …) =
valueNoise(x, y, …)`); `terrainPixels` returns `256 × 256 × 4` bytes, is
identical for the same seed, differs for another seed, is seamless (column 0
equals column 255 within 12 per channel, same for rows) and its mean colour is
within 24 per channel of the kind's base colour.

**AC-10-02 Terrain meshes.** `rockCellsOf` marks exactly the cells of the
map's `blocked` rectangles (first-line: the river and the four woods, nothing
under the start HQs or depots). `createTerrain` on a 4 × 4 map with two blocked
tiles returns a group with a grass mesh of 14 tiles, a dirt overlay of the same
14 tiles whose vertex alphas are in [0, 1], and a rock mesh of 2 boxes whose
heights are within [0.27, 0.83]; the ground meshes receive shadows and the
rock mesh casts them.

**AC-10-02b Terrain performance.** The terrain is built once at start (no
per-frame texture or geometry work) with at most 3 draw calls; AC-03-62/63
pass.

**AC-10-03 Shadows and lighting.** In the skirmish (Playwright, `?debug=1&seed=1`)
`__redline.renderInfo()` reports `shadowMap: true`, a shadow-casting sun, and
`toneMapping: "ACESFilmic"`; `drawCalls()` is within `4 × types + 10`; no
console error; AC-03-62/63 pass unchanged.

**AC-10-04 Model detail.** `assets:check --strict` passes on the rebuilt
models; every model has a `COLOR_0` attribute with values in [0.55, 1]
(checked by `assets:check`); with a fake registry whose `body` part carries
`COLOR_0 = 0.5`, the rendered instance geometry's colour is half the material
colour; without `COLOR_0` it equals today's.

**AC-10-05 Building debris only.** A dead building spawns 8 `debris` and no
`wreck`; a dead vehicle still spawns one `wreck`.

**AC-10-06 Classic mode.** Spec 09 AC-09-06 with `COLOR_LEVELS = 8`
(`posterize(0.5)` = 4/7) and the `classic` setting defaulting to false.

**AC-10-07 Classic mode in the skirmish (Playwright).** With cleared storage
`__redline.classic()` is false; `V` shows "Classic graphics" and makes it
true; a screenshot in classic mode differs from the Remastered one by more than
1 %; `V` again shows "Remastered graphics".

**AC-10-08 Scaffolding casts no shadow.** With shadows enabled, `scaffolds`
has `receiveShadow` true and `castShadow` false, while model instances of a
building under construction still cast shadows.

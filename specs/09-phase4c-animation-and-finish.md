# 09 — Phase 4c animation and visual finish

Status: proposed for owner review (written for the 2026-10-11 unattended run).
§6 (building death) is amended and §7–8 (pixel-art pass) are superseded by
`10-phase4d-remastered-look.md` §6–7 after the owner named Red Alert
Remastered as the style reference.
Depends on `06-phase4a-procedural-models.md`, `07-phase4b-combat-effects.md`
and `08-player-controls.md` §3 (pause freezes the effect clock). Roadmap:
Phase 4. Decisions: D-05 (2.5D low-poly, orthographic isometric camera), D-07.

## 1. Context

Units are recognisable since Phase 4a and fights are readable since Phase 4b,
but the scene is still static: guns do not kick, soldiers glide, buildings
grow out of the ground as stretched models and vanish into a single dark box.
Phase 4c adds client-only animation and a final style pass. Nothing changes in
the simulation, the snapshot or the models.

**Exit criterion:** in a skirmish against the AI the owner sees turrets recoil
when they fire, infantry bob while walking, scaffolding around buildings under
construction, rubble where a building died, and a pixel-art look that `V`
toggles; AC-03-62/63 still pass with the style on.

## 2. Scope

In: `client/src/render/animation.ts` (recoil and walk bob), scaffolding in the
entity renderer, a `debris` effect kind for destroyed buildings,
`client/src/render/pixelArt.ts` (low-resolution render target and colour
posterisation), a `pixelArt` setting toggled with `V`, i18n strings, debug
hooks.

Out: image textures (the models keep the three flat materials of spec 06 §3;
textures are a later decision), skeletal animation, Hunyuan3D infantry,
audio, screen shake, smoke, terrain scorch marks, any sim or model change.

## 3. Clock

Every time-based value below uses the same `nowMs` that the skirmish passes to
`effects.update` (spec 07). When spec 08 §3 pause is active that clock does not
advance, so recoil, bob and debris freeze with the other effects.

## 4. Animation (`client/src/render/animation.ts`)

```ts
export const RECOIL_TILES = 0.08;   // turret kick at the moment of firing
export const RECOIL_MS = 150;       // linear return to rest
export const BOB_TILES = 0.04;      // infantry walk bob amplitude
export const BOB_PERIOD_MS = 360;   // one step

/** Kick of a turret `ageMs` after it fired: RECOIL_TILES * (1 - ageMs / RECOIL_MS)
 *  for 0 <= ageMs < RECOIL_MS, otherwise 0. */
export function recoilOffset(ageMs: number): number;

/** Walk bob height: BOB_TILES * |sin(π * (nowMs / BOB_PERIOD_MS + id * 0.37))|. */
export function bobHeight(id: number, nowMs: number): number;

export interface Pose {
  readonly recoil: number; // tiles, pushed back along the turret's facing
  readonly lift: number;   // tiles, added to the model's height
}

export interface Animator {
  /** Records `atMs` as the last shot of every entity with the `fired` flag and
   *  forgets shots older than RECOIL_MS. */
  recordShots(entities: readonly EntityState[], atMs: number): void;
  /** recoil = recoilOffset(nowMs - last shot) or 0 without a recorded shot;
   *  lift = bobHeight(id, nowMs) for a moving infantry unit (category "unit",
   *  armor 0, `moving` flag), otherwise 0. */
  pose(entity: EntityState, nowMs: number): Pose;
}

export function createAnimator(): Animator;
```

Entity renderer (`client/src/render/entities.ts`):

* `createEntityRenderer(capacity, models?, animator?)`; `update(entities,
  selected, nowMs = 0)`. Without an animator every pose is zero (today's
  output, so existing tests keep passing).
* For model instances: `lift` is added to the y position of hull and turret.
  `recoil` translates only the turret, by `-recoil` along the turret's local
  +Z (its front, spec 06 §3) after the turret rotation. Types without a turret
  node do not recoil. Fallback boxes are not animated.

Skirmish (`client/src/app/skirmish.ts`): one `createAnimator()` passed to the
entity renderer; `animator.recordShots(snapshot.entities, at)` next to
`spawnShotEffects` (same tick-advance guard); `entities.update(...)` receives
the effect clock.

## 5. Scaffolding (`client/src/render/entities.ts`)

* `EntityRenderer` gains `readonly scaffolds: InstancedMesh` (child of
  `group`) with capacity `capacity`, `MeshLambertMaterial({ color:
  SCAFFOLD_COLOR, flatShading: true })`, `SCAFFOLD_COLOR = 0xc8a165`.
* Geometry `scaffoldGeometry()` (exported): a unit box frame centred on the
  origin with its base at y = 0 — the 12 edges plus 4 horizontal beams around
  the middle (y = 0.5), 16 beams in total, each a box of cross-section
  `SCAFFOLD_BEAM = 0.03` merged into one `BufferGeometry`.
* Every non-ghost building with the `underConstruction` flag (model or
  fallback box) gets one instance at `(x, 0, y)` scaled to its full render box
  `[w, h, d]`. The building itself keeps the Phase 2 vertical scale rule.
* `scaffolds.visible = count > 0`, so a base with nothing under construction
  keeps the draw-call bound of AC-06-06.

## 6. Debris (`client/src/render/effects.ts`, `client/src/render/deaths.ts`)

* New effect kind `debris` appended to `EFFECT_KINDS`: duration 15 000 ms,
  fade 3000 ms, size `[0.3, 0.18, 0.3]`, colour `0x3a3530`, not additive.
* `spawnDeathEffects`: a dead building spawns its `wreck` as today plus
  `DEBRIS_PIECES = 8` `debris` instances. Piece `i` (0-based):
  `angle = i * 2π / 8 + id * 0.7`, `radius = (0.25 + 0.15 * (i % 3)) *
  min(w, d) / 2`, position `(x + cos(angle) * radius, y + sin(angle) *
  radius)`, `s = 0.2 + 0.1 * ((id + i) % 3)`, `sizeXYZ = [s, s * 0.6, s]`,
  `rotationY = angle`, `startMs = nowMs`. Units do not spawn debris.
* `NO_EFFECT_COUNTS` in `client/src/app/skirmish.ts` gains `debris: 0`.

## 7. Pixel-art style (`client/src/render/pixelArt.ts`)

```ts
export const PIXEL_SIZE = 3;     // device pixels per art pixel
export const COLOR_LEVELS = 16;  // levels per colour channel

/** Render-target size: max(1, floor(width / pixelSize)) × max(1, floor(height / pixelSize)). */
export function pixelTargetSize(
  width: number, height: number, pixelSize?: number,
): { width: number; height: number };

/** round(clamp(value, 0, 1) * (levels - 1)) / (levels - 1). */
export function posterize(value: number, levels?: number): number;

/** The subset of `WebGLRenderer` the pass uses (lets tests pass a fake). */
export interface PassRenderer {
  setRenderTarget(target: WebGLRenderTarget | null): void;
  render(scene: Object3D, camera: Camera): void;
}

export interface PixelArtPass {
  enabled: boolean;
  /** Drawing-buffer size in device pixels. */
  setSize(width: number, height: number): void;
  /** Disabled: renders `scene` with `camera` straight to the canvas.
   *  Enabled: renders it into the low-resolution target (NearestFilter,
   *  depth buffer on), then draws one full-screen quad to the canvas with a
   *  ShaderMaterial that samples the target and applies `posterize` per
   *  channel (same formula in GLSL). */
  render(renderer: PassRenderer, scene: Object3D, camera: Camera): void;
  /** The low-resolution target (for tests). */
  readonly target: WebGLRenderTarget;
}

export function createPixelArtPass(): PixelArtPass;
```

Skirmish:

* `const pass = createPixelArtPass()`, `pass.enabled = settings.pixelArt`;
  `resize()` calls `pass.setSize(width * devicePixelRatio, height *
  devicePixelRatio)`; `frame()` and `resize()` call `pass.render(renderer,
  scene, camera)` instead of `renderer.render(scene, camera)`.
* `drawCalls` keeps measuring the scene pass: read `renderer.info.render.calls`
  right after the scene is drawn (set `renderer.info.autoReset = false`, call
  `renderer.info.reset()` at the start of each frame, and subtract the one
  quad call when the pass is enabled).
* Picking and the DOM overlay are unaffected: the quad covers the whole canvas.
* The tech-slice mode keeps rendering directly (no pass).

## 8. Settings (`client/src/settings.ts`)

* `Settings` becomes `{ gore: boolean; pixelArt: boolean }`,
  `DEFAULT_SETTINGS = { gore: true, pixelArt: true }`, same `SETTINGS_KEY`.
* `loadSettings` validates each field on its own: a missing or non-boolean
  field takes its default (a stored `{ "gore": false }` from Phase 4b loads as
  `{ gore: false, pixelArt: true }`); invalid JSON, a non-object or a throwing
  storage still return the defaults. `saveSettings` writes both fields.
* In skirmish `V` toggles `pixelArt`, saves it, sets `pass.enabled` and shows
  the toast `settings.pixelArtOn` / `settings.pixelArtOff` ("Pixel art on" /
  "Pixel art off" in `client/src/i18n/en.json`). `toggleGore` keeps the other
  field (`{ ...settings, gore: !settings.gore }`).
* Debug API (`client/src/debug.ts`, `SkirmishDebug`): `pixelArt(): boolean`.

## 9. Acceptance criteria

**AC-09-01 Recoil and bob curves.** `recoilOffset(0)` is `RECOIL_TILES`,
`recoilOffset(RECOIL_MS / 2)` is half of it, `recoilOffset(RECOIL_MS)` and
negative ages are 0; `bobHeight` stays in `[0, BOB_TILES]`, is 0 at
`nowMs = 0` for id 0 and `BOB_TILES` at `nowMs = BOB_PERIOD_MS / 2` for id 0.

**AC-09-02 Animator poses.** After `recordShots` at 1000 ms with a `fired`
tank, `pose(tank, 1000).recoil` is `RECOIL_TILES` and `pose(tank, 1200)` is 0;
a moving rifleman gets a lift equal to `bobHeight`, a stationary rifleman and
a moving tank get lift 0.

**AC-09-03 Animated instances.** With an animator, a fired turreted model's
turret instance sits `RECOIL_TILES` behind its rest position along the turret
facing while its hull does not move; a moving infantry model's hull is raised
by its lift; without an animator the matrices equal today's.

**AC-09-04 Scaffolding.** `scaffoldGeometry()` has 16 beams (16 × 12
triangles) inside the unit box; a building under construction adds one
`scaffolds` instance scaled to its render box; a finished building, a unit and
a ghost add none, and `scaffolds.visible` is false when the count is 0.

**AC-09-05 Debris.** A dead building spawns one `wreck` and 8 `debris` at the
positions of §6 (within its footprint); a dead vehicle or infantry spawns no
`debris`; `debris` expires after 15 s.

**AC-09-06 Pixel-art pass and settings.** `pixelTargetSize(1280, 720)` is
`426 × 240`, never below 1 × 1; `posterize` maps 0 → 0, 1 → 1 and 0.5 →
8/15; a disabled pass calls `render(scene, camera)` once with target null; an
enabled pass renders the scene into `target` then the quad into null.
`loadSettings` returns `{ gore: false, pixelArt: true }` for a stored
`{ "gore": false }` and the defaults for invalid JSON; `saveSettings`
round-trips both fields.

**AC-09-07 Style in the skirmish (Playwright).** In `?debug=1&seed=1` with
cleared storage, `__redline.pixelArt()` is true; pressing `V` shows the toast
and makes it false; a screenshot with the style on differs from one with it
off (pixel diff over 1 %); no console error; `__redline.drawCalls()` stays
within AC-06-06's bound with the style on. AC-03-62 and AC-03-63 pass
unchanged with the default settings.

## 10. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-09-01 | `client/src/render/animation.test.ts` | `AC-09-01: recoil and bob curves` |
| AC-09-02 | `client/src/render/animation.test.ts` | `AC-09-02: animator poses` |
| AC-09-03 | `client/src/render/entities.test.ts` | `AC-09-03: animated instances` |
| AC-09-04 | `client/src/render/entities.test.ts` | `AC-09-04: scaffolding` |
| AC-09-05 | `client/src/render/deaths.test.ts` | `AC-09-05: debris` |
| AC-09-06 | `client/src/render/pixelArt.test.ts`, `client/src/settings.test.ts` | `AC-09-06: pixel-art pass`, `AC-09-06: settings with pixel art` |
| AC-09-07 | `client/tests/e2e/style.spec.ts` | `AC-09-07: style in the skirmish` |

## 11. Issue breakdown

| Issue | Scope | Criteria | Tier | Depends on |
|---|---|---|---|---|
| P4-07 (#186) | `animation.ts`, animator in the entity renderer, skirmish wiring | AC-09-01..03 | ready-pro | #185 (pause clock) |
| P4-08 (#188) | scaffolding in the entity renderer | AC-09-04 | ready-local | P4-07 |
| P4-09 (#187) | `debris` effect kind and building debris | AC-09-05 | ready-local | — |
| P4-10 (#189) | pixel-art pass, `pixelArt` setting, `V` toggle, debug hook, E2E | AC-09-06, 07 | ready-pro | #185 |

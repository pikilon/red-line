# 06 — Phase 4a procedural models

Status: proposed for owner review (written for the 2026-10-11 overnight run).
Depends on `03-phase2-core-loop.md` and `05-phase3-computer-ai.md`. Roadmap:
Phase 4 (first slice). Decisions: D-05 (2.5D low-poly, orthographic isometric
camera), D-07 (models as code), D-02 (assets CC BY-SA 4.0).

## 1. Context

Every unit and building is drawn as a coloured box today, so the owner cannot
tell a HIMARS from a rifleman. Phase 4a replaces the boxes with low-poly models
authored as Blender Python scripts (D-07), exported to glTF binary and drawn by
the client with instancing. Team colour, heading and turret aim make the scene
readable without textures.

**Exit criterion:** the owner opens the skirmish and recognises each unit and
building of both factions by shape; tanks face where they drive and turrets aim
at their target; performance criteria AC-03-62/63 still pass.

## 2. Scope

In: a shared modelling library, one script per type, a build command that
regenerates every `.glb`, a model check, the client model registry, lit
instanced rendering with team colour, unit heading and turret aim.

Out (later Phase 4 slices): textures, animation (walk cycles, recoil), infantry
from Hunyuan3D (D-07; the procedural soldier is a placeholder), destruction
debris, effects, gore filter, audio, pixel-art post-process, construction
scaffolding.

## 3. Conventions

* Units: 1 Blender unit = 1 map tile. Origin at the centre of the footprint on
  the ground (z = 0). Blender +Z is up; the model's **front faces Blender −Y**,
  which the glTF exporter turns into **+Z** in the glTF/three.js frame.
* Size: the model's bounding box fits inside the type's render box
  (`render.size / 100` tiles, `[w, h, d]` = Blender `[x, z, y]`) and fills at
  least 70 % of it along x and y (so selection and picking stay honest).
* Materials (names are the contract): `body` (faction base colour baked in the
  material), `team` (white; the client multiplies it by the owner colour),
  `dark` (tracks, wheels, barrels, windows). No textures. Flat shading.
* Nodes: the root is `<type-id>`. A type whose weapon turns has a child node
  named `turret` with its pivot on the turret ring; everything else may be
  joined into the root mesh. No other naming is required.
* Triangle budget (all meshes of a file): units ≤ 1500, buildings ≤ 3000,
  depot ≤ 1000.
* Output: `client/public/models/<type-id>.glb` (committed; generated assets
  under CC BY-SA 4.0, D-02). Every unit, building and depot type in the
  builtin ruleset has one, except `tech-slice-placeholder`.

Faction base colours (`body`): Ukraine `#5b6b3a` (olive), Russia `#6b6650`
(khaki grey); depot `#8b5a2b`; `team` is white; `dark` is `#2a2a2a`.

## 4. Tools (`tools/models/`)

* `lib.py`: helpers on top of `bpy` (no other dependency):
  `reset_scene()`, `material(name, hex)`, `box(name, size, location, mat)`,
  `cylinder(name, radius, depth, location, mat, vertices=8, axis="Z")`,
  `wedge(...)`, `wheels(...)`, `tracks(...)`, `barrel(...)`, `turret(...)`,
  `soldier(name, weapon, mat_body, mat_team)`, `join(objects, name)`,
  `parent(child, parent)`, `export(type_id)` (writes the `.glb` with
  `export_format='GLB'`, `export_yup=True`, applied modifiers, no cameras or
  lights, selected objects only).
* `<type-id>.py`: one script per type. Run as
  `blender --background --factory-startup --python tools/models/<id>.py`.
* `build.mjs`: `node --run assets:build` runs every `tools/models/*.py` except
  `lib.py` in file-name order and fails on the first error. Blender is required
  only for this command, never for CI.
* `check.mjs`: `node --run assets:check` (part of `verify`) parses every
  `.glb` with no dependency (glTF binary header + JSON chunk + accessor
  `min`/`max`) and checks §3: root name, materials
  only from the three names, `turret` node present for every type listed in
  `TURRETED` (below), triangle budgets, bounding box inside the render box with
  ≥ 70 % fill along x and z (glTF frame). Ruleset types without a file are
  printed as warnings; with `--strict` (added to `verify` by P4-05, once every
  model exists) they are errors. A `.glb` whose name is not a ruleset type is
  an error.

`TURRETED`: `ua-bradley`, `ua-leopard-2a4`, `ua-himars`, `ua-kozak-scout`,
`ua-defense`, `ru-bmp-2`, `ru-t-72b3`, `ru-tos-1a`, `ru-brdm-scout`,
`ru-defense`.

## 5. Client (`client/src/render/`)

* `models.ts`: `loadModels(types: readonly TypeDef[]): Promise<ModelRegistry>`
  loads `models/<id>.glb` with `GLTFLoader` (three/examples). For each type it
  keeps the merged geometry of the root (excluding `turret`) and of `turret`,
  split per material into parts. A missing or failing file falls back to the
  box of today for that type and logs one warning.
* `entities.ts`: one `InstancedMesh` per (type, part) with
  `MeshLambertMaterial` (`flatShading`), created lazily; `team` parts take the
  owner colour (or `SELECTED_COLOR`) as instance colour, `body`/`dark` keep
  their material colour (instance colour white). Selection also keeps the
  selection ring/bar behaviour of Phase 2. Buildings under construction keep
  the vertical scale rule of Phase 2. Ghosts stay translucent boxes.
* Heading: per unit, `yaw = atan2(dx, dz)` of its movement between the last two
  snapshots when it moved more than 0.01 tiles, otherwise the previous yaw
  (initial yaw 0). Turret yaw: towards `target` when the entity has one,
  otherwise the hull yaw. Both are client-side only (no sim change).
* Lighting: `HemisphereLight(0xffffff, 0x444444, 1.2)` plus a
  `DirectionalLight(0xffffff, 1.5)` from the camera side; terrain stays as is.
* Draw calls: at most `2 × (number of types on screen) + 6`.

## 6. Acceptance criteria

**AC-06-01 Model check passes.** `node --run assets:check` exits 0 on the
committed models and fails with a message naming the file and rule for a
model that is missing (with `--strict`), over budget, lacks `turret` when listed, uses another
material name, or exceeds/underfills its render box (unit-tested on synthetic
glTF buffers built in the test).

**AC-06-02 Build reproduces the models.** With Blender installed,
`node --run assets:build` regenerates `client/public/models/` and
`node --run assets:check` passes (local only; documented in the PR).

**AC-06-03 Model registry.** `loadModels` with a fake loader returns, per type,
parts keyed by material name and an optional turret; a rejected load yields
the box fallback and one warning.

**AC-06-04 Instanced model rendering.** `createEntityRenderer` given entities of
two types draws one instanced mesh per (type, part), `team` instances carry the
owner colour and `body` instances white; selected entities carry
`SELECTED_COLOR` on `team`.

**AC-06-05 Heading and turret aim.** A unit moving from `(0, 0)` to `(1, 0)`
gets yaw `π/2`; a stationary unit keeps its yaw; a unit with a target at
`(0, 1)` relative to it gets turret yaw `0`.

**AC-06-06 Models in the skirmish (Playwright).** The skirmish loads with no
console error, `__redline.drawCalls()` stays within §5's bound, and a
screenshot of the starting base differs from the Phase 2 box rendering (pixel
diff over 5 %).

**AC-06-07 Performance holds.** AC-03-62 and AC-03-63 pass unchanged.

## 7. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-06-01 | `tools/models/check.test.mjs` | `AC-06-01: model check` |
| AC-06-02 | PR description | manual |
| AC-06-03 | `client/src/render/models.test.ts` | `AC-06-03: model registry` |
| AC-06-04 | `client/src/render/entities.test.ts` | `AC-06-04: instanced model rendering` |
| AC-06-05 | `client/src/render/heading.test.ts` | `AC-06-05: heading and turret aim` |
| AC-06-06 | `client/tests/e2e/models.spec.ts` | `AC-06-06: models in the skirmish` |
| AC-06-07 | existing perf tests | — |

## 8. Issue breakdown

| Issue | Scope | Criteria | Tier | Depends on |
|---|---|---|---|---|
| P4-01 | `lib.py`, `build.mjs`, `check.mjs`, exemplar `ru-t-72b3.py` and `ua-leopard-2a4.py` (tier S per D-07) | AC-06-01, 02 | S (Opus) | — |
| P4-02 | Ukraine vehicles and infantry scripts + `.glb` | AC-06-01 | ready-pro | P4-01 |
| P4-03 | Russia vehicles and infantry scripts + `.glb` | AC-06-01 | ready-pro | P4-01 |
| P4-04 | Buildings of both factions and the depot + `.glb` | AC-06-01 | ready-pro | P4-01 |
| P4-05 | Client model registry, instanced rendering, heading, lights | AC-06-03..07 | ready-pro | P4-01 |

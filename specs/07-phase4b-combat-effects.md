# 07 — Phase 4b combat effects and gore filter

Status: proposed for owner review (written for the 2026-10-11 overnight run).
Depends on `03-phase2-core-loop.md` (snapshot flags), `06-phase4a-procedural-models.md`.
Roadmap: Phase 4. Decisions: D-03 (more violent than Red Alert 2, with a gore
filter setting), D-05.

## 1. Context

Combat today is a one-frame tracer line. Phase 4b adds client-only effects that
make fights readable: muzzle flashes, impacts and explosions sized by damage
type, and death effects (vehicle wrecks that burn and fade, infantry that falls
and leaves blood unless the gore filter is on). Nothing changes in the
simulation or the snapshot: effects are derived from what the client already
receives (`fired` flag, `target`, entity disappearance).

**Exit criterion:** in a skirmish against the AI the owner can see who is
shooting whom, what kind of weapon it is, and where units died; toggling the
gore filter removes blood.

## 2. Scope

In: `client/src/render/effects.ts` (pooled instanced effects), death detection,
wrecks, blood decals, a settings store with the gore filter, a minimal settings
toggle (key `G` in skirmish shows a toast with the new state; a real options
menu comes later), i18n strings.

Out: audio, screen shake, smoke trails on projectiles, terrain scorch marks,
dismemberment, ragdolls, any sim change.

## 3. Effect catalogue

All effects are camera-facing quads or small boxes drawn with one
`InstancedMesh` per effect kind (additive blending for flashes and fire),
pooled with a fixed capacity (`EFFECT_CAPACITY = 512` per kind; the oldest
instance is recycled when full). Durations are in real milliseconds and scale
with the simulation speed multiplier.

| Kind | Trigger | Look | Duration |
|---|---|---|---|
| `muzzle` | entity with `fired` | yellow-white flash at the shooter, 0.15 tiles, offset 0.3 tiles toward the target | 80 ms |
| `impact` | `fired` with damage type `smallArms` or `autocannon` | small grey-orange puff at the target, 0.2 tiles | 200 ms |
| `blast` | `fired` with `antiTank` | orange flash + dark puff at the target, 0.5 tiles | 450 ms |
| `explosion` | `fired` with `highExplosive` or `thermobaric` | orange fireball growing to the weapon `splashCenti` (min 0.6 tiles) then a smoke puff; `thermobaric` is larger (×1.5) and yellower | 900 ms; shown after `projectileTicks / 15` s |
| `wreck` | a vehicle or building disappears while visible | a `#1a1a1a` box of the type's render size at 60 % height (the model is used instead once P4-05 has landed, in a later issue), with a looping `fire` flicker on top | 12 s, fading out over the last 2 s |
| `body` | an infantry entity disappears while visible | a dark flat box (0.25 × 0.08 × 0.12 tiles) lying on the ground | 20 s, fading over the last 3 s |
| `blood` | same as `body`, only when gore is on | a dark red (`#5a0a0a`) flat irregular decal (2–3 overlapping quads, rotation from the entity id) under the body | 30 s, fading over the last 5 s |

Damage type of a shot = the shooter type's weapon `damageType` (via
`typeDef(kind)` and the ruleset weapons). A shooter whose target is not in the
current snapshot draws only its `muzzle`.

## 4. Death detection

`detectDeaths(prev, next, viewer)` returns the entities present in `prev`
(not ghosts, not depots, `hp > 0`) and absent from `next`, when `next.tick >
prev.tick`. Entities that left vision do not disappear from the viewer's
snapshot as deaths: the snapshot keeps buildings as ghosts and drops units, so
a unit is a death only if its last known `hp` was at most the largest single
hit any enemy weapon can deal **or** it was the `target` of a `fired` entity in
`prev`. (This keeps units walking into fog from leaving bodies.)

## 5. Settings (`client/src/settings.ts`)

```ts
export const SETTINGS_KEY = "redline.settings.v1";
export interface Settings { gore: boolean }          // default { gore: true }
export function loadSettings(storage?: Storage): Settings;  // tolerant of missing/invalid/throwing storage
export function saveSettings(settings: Settings, storage?: Storage): void; // never throws
```

In skirmish, `G` toggles `gore`, saves it, and shows a toast
(`settings.goreOn` / `settings.goreOff` in `client/src/i18n/en.json`) for 2 s.
Turning gore off removes live `blood` decals immediately.

## 6. Acceptance criteria

**AC-07-01 Effect pool.** `createEffects()` spawning more than
`EFFECT_CAPACITY` instances of one kind recycles the oldest; `update(nowMs)`
removes expired instances and scales/fades them by age.

**AC-07-02 Shot effects by damage type.** Given a snapshot with a `fired`
`ua-rifleman` (smallArms) targeting a visible entity, `spawnShotEffects` adds
one `muzzle` and one `impact`; an `antiTank` shooter adds `blast`; a
`highExplosive` shooter adds an `explosion` delayed by `projectileTicks / 15`
seconds; a shooter whose target is absent adds only `muzzle`.

**AC-07-03 Death detection.** `detectDeaths` reports a unit that was a target
of a `fired` entity and vanished, and a building that vanished; it ignores a
unit that walked out of vision untargeted with full hp, ghosts, depots, and a
non-advancing tick.

**AC-07-04 Death effects and gore filter.** A dead vehicle spawns `wreck`; a
dead infantry spawns `body` and `blood` with gore on and only `body` with gore
off; toggling gore off removes live `blood`.

**AC-07-05 Settings.** `loadSettings` returns the default on missing, invalid
JSON or a throwing storage; `saveSettings` round-trips and never throws.

**AC-07-06 Effects in the skirmish (Playwright).** In `?debug=1&seed=1` with
two enemy units spawned in range through the debug API, after 3 s the effect
mesh counts reported by `__redline.effectCounts()` include at least one
`muzzle`; pressing `G` shows the toast; AC-03-62/63 still pass.

## 7. Traceability

| Criterion | File | Test |
|---|---|---|
| AC-07-01 | `client/src/render/effects.test.ts` | `AC-07-01: effect pool` |
| AC-07-02 | `client/src/render/effects.test.ts` | `AC-07-02: shot effects by damage type` |
| AC-07-03 | `client/src/render/deaths.test.ts` | `AC-07-03: death detection` |
| AC-07-04 | `client/src/render/deaths.test.ts` | `AC-07-04: death effects and gore filter` |
| AC-07-05 | `client/src/settings.test.ts` | `AC-07-05: settings` |
| AC-07-06 | `client/tests/e2e/effects.spec.ts` | `AC-07-06: effects in the skirmish` |

## 8. Issue breakdown

| Issue | Scope | Criteria | Tier | Depends on |
|---|---|---|---|---|
| P4-06 | effect pool, shot effects, death detection, wrecks/bodies/blood, settings + `G` toggle, debug `effectCounts`, wiring in skirmish | AC-07-01..06 | ready-pro | — |

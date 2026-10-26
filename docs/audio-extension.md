# Audio extension guide

How to add units, buildings, weapons, factions, maps and events without
re-inventing the audio engine. The behavior contract is `specs/25-audio.md`;
this document is the practical checklist for a human or an AI contributor.

## 1. Mental model

The simulation never calls audio. Each snapshot is read-only input:

```text
sim snapshot + combat events
  -> client/src/audio/derive.ts      event ids, EVA triggers, construction loops
  -> client/src/audio/director.ts    Zero Hour admission (audience, fog, distance,
                                     voice rule, limit, priority, delays)
  -> client/src/audio/mixer.ts       buses, pan, ducking, one-shots, sample loops,
                                     music crossfade
  -> Web Audio
```

Sound resolution has three levels, tried in order:

1. **Shipped file** under `client/public/audio/` (phase 3; not produced yet).
2. **Local reference WAV/MP3** from the owner's Zero Hour install, served by the
   Vite dev server at `/audio-ref/` and never committed or built.
3. **Procedural fallback** `synth:<recipe>` from `data/audio/synth/recipes.yaml`.

The reference is scaffolding only: never ship it, never use it as generator
input, and never commit anything under `.local/audio-ref/` (D-02, spec 25 §4.2).

## 2. Data files

| File | Purpose |
|---|---|
| `data/audio/events.yaml` | one-shot events: weapons, impacts, explosions, buildings, movement, UI, ambient, music |
| `data/audio/voices.yaml` | voice sets (`select`, `move`, `attack`, `underFire`, `die`, `created`) and category fallbacks |
| `data/audio/eva.yaml` | EVA priority, cooldown, expiry and per-faction line reference |
| `data/audio/mix.yaml` | buses, ducking, limits, zoom, music fade/combat hold |
| `data/audio/reference.yaml` | our event id -> Zero Hour event name; names only |
| `data/audio/synth/recipes.yaml` | offline-rendered fallback recipes |

Event id conventions (the derive layer relies on them):

* `weapon.<weaponId>.fire` -> `weapon.<damageType>.fire` -> `weapon.<launch>.fire`
* `impact.<weaponId>` -> `impact.<damageType>` -> `impact.light|heavy`
* `explosion.small|medium|large`
* `move.<unitTypeId>.start` -> `move.<locomotor>`
* `voice.<unitTypeId>.<action>` -> `voice.<set>.action` (fallback category)
* `building.place|construct|complete|damage|damage.heavy|damage.critical|die`
* `vehicle.damage`
* `ui.click|error|cashUp|cashDown|warning`
* `ambient.<climate>`; `music.menu|calm.<faction>|combat.<faction>|victory|defeat`

## 3. Add a weapon, impact or explosion

1. The weapon id already drives `weapon.<id>.fire` and `impact.<id>`; add a
   generic `weapon.<damageType>.fire` / `impact.<damageType>` only if that class
   should have its own sound.
2. Map the ids in `reference.yaml` to an existing Zero Hour `AudioEvent`
   (`CrusaderTankWeapon`, `Explosion`, `VehicleImpactHeavy`, ...).
3. Copy Zero Hour's `Volume`, `VolumeShift`, `PitchShift`, `Delay`, `Limit`,
   `Priority`, `Control`, `LowPass`, `MinRange`/`MaxRange` into `events.yaml`
   when the mix needs it; never change the sim for audio.
4. Run `node --run check:audio` and `node --run test:unit`.

No TypeScript change is needed for a new weapon or a new damage type.

## 4. Add a unit

1. Add the unit to `data/factions/<faction>.yaml` with a unique `id` and a
   locomotor. The id is the audio key.
2. Add a voice set with the same id under `sets:` in `voices.yaml` (copy an
   existing role set: rifleman, anti-tank, scout, transport, tank, artillery,
   dozer, truck).
3. Map `voice.<id>.select|move|attack|underFire|die|created` in
   `reference.yaml`. Use the **faction's** reference set: USA for Ukraine,
   China for Russia. Vehicle `die` is usually the shared `Explosion`; infantry
   use a `*VoiceDie` line.
4. Add `move.<id>.start` in `events.yaml` and map it to a Zero Hour
   `*MoveStart` event. Without it the locomotor fallback applies.
5. Pick a `fallbackCategory` only as a safety net (`foot`, `wheeled`, `tracked`,
   `unit`); a complete mapping should win before the fallback.
6. Record the new role in `specs/25-audio.md` §11 and run the audio checks.

## 5. Add a faction or side

A side is data, not an engine change:

1. Add the faction to `data/factions/*.yaml` and the ruleset globals.
2. Give every unit a voice set and every unit/building voice event a
   `reference.yaml` entry. Keep the owner's mapping: Ukraine -> USA,
   Russia -> China. New sides need an explicit block whose reference set is
   documented in `specs/25-audio.md` §4.2.
3. Add `eva.<faction>.<event>` entries in `reference.yaml` for every event in
   `eva.yaml`. The EVA queue picks `def.sounds[faction]`; a missing entry falls
   back to `synth:eva`, which is a bug for a shipped side.
4. Add the faction's music states to `reference.yaml`:
   `music.calm.<faction>`, `music.combat.<faction>`,
   `music.victory.<faction>`, `music.defeat.<faction>`.
5. If the side has unique buildings, add `building.select.hq|barracks|factory.<faction>`.
6. Extend the faction-mapping unit test in `client/src/audio/audio.test.ts` so a
   wrong reference set fails CI.

## 6. Add a building

The derive layer already emits:

* `building.place` when a new under-construction building appears;
* `building.construct` as a **sample loop** while `underConstruction` is set;
* `building.complete` when the flag clears;
* `building.damage` on every hit, `building.damage.heavy` on the crossing below
  50 % and `building.damage.critical` on the crossing below 25 %;
* `building.die` on death;
* `vehicle.damage` when a vehicle crosses its 50 % health line.

Map `building.construct` to Zero Hour's `UnderConstructionLoop` (the mixer uses
its `attackSounds`/`decaySounds` as the site head/tail),
`building.damage*` to `BuildingDamage`/`BuildingDamagedStateLight`/`BuildingDestroy`,
and `vehicle.damage` to `VehicleDamagedState`. Military buildings in Zero Hour
default `SoundAmbient = NoSound`; do not invent a working hum, add a real
reference event only if a future source has one.

## 7. Add an ambient bed or map climate

1. Add the climate to `data/weather/weather.json`. Weather is opt-in through
   `?weather=<climate|none>` on every map (spec 22); there is no per-map
   climate table.
2. Extend `ambientEventFor` in `client/src/audio/ambient.ts`.
3. Add `ambient.<name>` to `events.yaml` (control `loop`) and map it in
   `reference.yaml` to a Zero Hour `Ambient*` / `Amb_*` event.
4. The mixer starts/fades it with `setAmbient`; `?weather=none` silences it.

## 8. Add an EVA/UI event

* EVA: add the definition to `eva.yaml`, map both factions in `reference.yaml`,
  then push the id from `deriveSnapshotAudio` (derive.ts) or from the input/UI
  layer where the condition is known. Respect `priority`, `cooldownMs`,
  `expireMs`; the queue is shared by all sides.
* UI: add a `ui.*` entry to `events.yaml`, map it (often `GUIClick`,
  `NoCanDoSound`, `MoneyDeposited`, `MoneyWithdraw`, `RadarNotifyUnderAttack`),
  and call `audioMixer.play({ eventId, relation: "self" })` from the UI/input
  hook. UI sounds are 2D and do not use world distances.
* Never trigger an EVA/UI sound from the sim; audio is a client consumer.

## 9. Add a sample loop

A loop is a normal Zero Hour event with `control: [loop]`; the reference index
also carries `attackSounds` (head) and `decaySounds` (tail). Add it to
`events.yaml` and `reference.yaml`, then call:

* `mixer.setAmbient(eventId | null)` for a global bed; or
* `mixer.syncConstructionLoops(...)` (or the analogous per-frame reconcile) for
  positional loops. The mixer loads the loop and head/tail, applies distance,
  pan and low-pass on every sync, and fades out with the tail.

Do not add oscillators or live synthesizers for a loop: the 2026-10-26 fix
removed the engine drone, and every loop must be a sample or an offline-rendered
`synth:` buffer.

## 10. What is behavior vs. original content

Clonable behavior: event table, admission rules, voice/EVA/music state, buses,
ducking, pan/distance/zoom, fog cull, sample loops, attack/decay, UI triggers.
Original content: the Ukrainian/Russian recordings, our EVA voices, our music,
our weapon recordings and our UI sounds (phase 3). Footsteps are not in Zero
Hour's audio INIs (`Object.ini` has no footstep events); they are future
original content, not a missing clone.

## 11. Debug and verify

* `?audio=debug` shows the pack status, counters, play/synth audition buttons and
  the admission/cull log. `Play` uses the reference, `Synth` forces the fallback.
* `?load=audio-fight` exercises weapons, impacts, explosions and voices;
  `?load=construction` exercises the under-construction loop, head and tail.
* Unit tests: `cd client && node --run test:unit -- src/audio`.
* Full gate: `node --run check:audio` and `node --run verify`.

## 12. Prompt template for a future AI contributor

Use this when a new side/unit set must be added:

> Read `specs/25-audio.md`, `docs/audio-extension.md` and `AGENTS.md` first.
> Add audio for `<new side/units>` following the event-id conventions and the
> Ukraine->USA / Russia->China reference mapping. Put configuration and
> reference names in `data/audio/`, use the local Zero Hour pack only for
> listening, never commit or ship it, and do not invent oscillators or
> synthesized loops where a reference sample exists. Add/extend tests for the
> mapping and derivation, run `node --run test:unit -- src/audio`,
> `node --run check:audio` and `node --run verify`, then open a PR and merge it
> with auto-squash once CI passes. Leave the source comments that explain each
> new trigger next to the trigger.

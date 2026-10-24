# 25 — Voices and sound (plan)

Status: proposed (owner request 2026-10-25). Plan only: no code in this change.
Depends on `01-architecture.md` (audio lives in the client main thread),
`07-phase4b-combat-effects.md` (combat events), `17-projectiles-and-combat-readability.md`,
`19-save-games.md` (example saves).
Decisions: D-02 (the sim stays deterministic and untouched; assets are CC BY-SA
4.0 and must not reproduce EA sounds verbatim).

## 1. Context

The game is silent today (`00-vision.md` lists "Art and audio" as future,
`07` §1 puts audio out of scope). The owner wants voices and sounds: unit voice
lines (select, move, attack, under fire, dying) per faction and unit type with
translation in mind, EVA/announcer lines, a sound for every weapon, impacts,
explosions, vehicle engines and tracks, infantry footsteps, buildings, ambient,
UI and music.

## 2. Precedent (Zero Hour) and the differences

Note from the research on `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`
and `INIZH.big` (Zero Hour 1.04). Facts unless marked inference.

* **One event table, five files.** Every sound is an `AudioEvent <Name>` in
  `Voice.ini` (unit voices), `SoundEffects.ini` (weapons, engines, buildings,
  impacts), `Speech.ini`, `Music.ini` (`MusicTrack`), plus `MiscAudio.ini` and
  `Eva.ini` (`EvaEvent`); global limits and volumes in `AudioSettings.ini`.
  Units and weapons reference events by name; the code never names a file.
* **Event fields** (`AudioEventInfo.h:61-96`): `Sounds` (list of variants; also
  morning/night/evening lists), `Volume`, `VolumeShift`, `MinVolume`,
  `PitchShift min max`, `Delay min max` (ms, random start jitter), `Limit` (max
  simultaneous instances of that event), `LoopCount`, `Priority`
  (`lowest..critical`), `Type`, `Control`, `MinRange`/`MaxRange` (attenuation),
  `LowPassFreq`, `AttackSounds`/`DecaySounds` (loop head/tail).
* **`Control` flags** (`AudioControl`): `loop`, `random` (pick a variant at
  random instead of in order), `all` (play every listed sound), `postdelay`
  (the delay applies after the sound), `interrupt` (may cut an instance of the
  same event). Example: `CrusaderTankWeapon` = `Control = interrupt random`,
  `PitchShift = -5 5`, `VolumeShift = -10`, `Volume = 90`, `Limit = 2`
  (`SoundEffects.ini:708`).
* **`Type` flags** (`SoundType`): `ui`, `world`, `shrouded`, `global`, `voice`,
  and the audience `player | allies | enemies | everyone`. `shouldPlayLocally`
  (`GameAudio.cpp:1020`) filters by audience against the local player
  (observers use the player they watch); `shrouded` drops the sound when the
  position is not in clear vision (`GameSounds.cpp:~235`).
* **Admission order** (`SoundManager::canPlayNow`, `GameSounds.cpp:~220-320`):
  shroud cull, then voice rule, then per-event `Limit`, then free channel
  (positional vs 2D pools), then steal a lower-priority playing sound, else
  cull. **Voice rule** (`violatesVoice`): an event with `voice` is refused
  while the same object is already playing a voice, unless it has `interrupt`.
  So a unit never talks over itself, and spammed orders do not stack.
* **Unit voice set** (`Voice.ini:241-290`): `<Unit>VoiceSelect`, `VoiceCreate`
  (when built; `Type = world global player`, `Priority = high`), `VoiceMove`,
  `VoiceAttack`, and special ones (`VoiceCrush`, upgrades). 5-6 variants each,
  `Control = random`, `Volume = 90`, `Type = ui voice player` (only the owner
  hears order acknowledgements, as UI sounds, with no position). There is
  **no per-unit "under fire" voice line** and dying is a sound effect
  (`*Die` events such as `CarDie`, `ComancheDie`, `SoundEffects.ini:1717,1886`)
  [inference from the event lists].
* **EVA** (`Eva.ini`, `Eva.cpp:395-520`): an `EvaEvent` has `Priority` (default
  1; 0 never plays), `TimeBetweenChecksMS` (re-announce cooldown),
  `ExpirationTimeMS` (a queued message that could not play in time is dropped)
  and one `SideSounds` entry per side. `BaseUnderAttack`: priority 7, cooldown
  30 s, expiry 5 s (`Eva.ini:2022-2025`); `LowPower`: priority 2, cooldown 2
  min, expiry 5 s (`Eva.ini:63-66`). Events: low power, insufficient funds,
  building lost/unit lost, base/ally under attack, upgrade complete, building
  stolen/sabotaged, superweapon detected/launched/ready (own/ally/enemy x
  type), general level-up. Playback: only one EVA line at a time; when free,
  the waiting message with the highest priority plays
  (`Eva::processPlayingMessages`).
* **Limits** (`AudioSettings.ini`): `SampleCount3D = 25`, `SampleCount2D = 4`,
  `StreamCount = 3` (speech/music), `AudioFootprintInBytes = 4194304` (4 MB of
  cached samples), `MinSampleVolume = 2` (anything quieter is dropped),
  `TimeBetweenDrawableSounds = 1000` (ambient sounds of objects are retried
  about once per second), `TimeToFadeAudio = 2000`, defaults: sound 80%, 3D 80%,
  speech 70%, music 55%, `Relative2DVolume = -10%`. Zoom: sounds get up to
  `ZoomSoundVolumePercentageAmount = 20%` more volume when the camera is close
  (`ZoomMinDistance 130` .. `ZoomMaxDistance 425`); the "microphone" sits at
  `MicrophoneDesiredHeightAboveTerrain = 50`, at most 33.3% of the way from
  ground to camera.

**Differences (owner request, beyond Zero Hour).**

1. Add `underFire` and `die` unit voice events. They are throttled harder than
   any original event (§6) so they never become noise.
2. Generated audio instead of EA's recorded assets (D-02 forbids EA's sounds).
   The event table, flags and rules are copied; the content is original.
3. i18n-ready voices (the original ships one language set per installation).
4. The original's voice is on the unit's owner only as a UI sound; we keep it,
   but `underFire` and `die` are positional world sounds heard by the owner only
   when on screen (an assumption, §12).

## 3. Scope and phases

| Phase | Deliverable | Player-visible result |
|---|---|---|
| A. Engine | Audio layer, mixer, event table loader, settings, procedural placeholder voices, `?audio=debug` overlay | Every existing action makes a placeholder sound; volume sliders work |
| B. SFX set | Procedural recipes for all combat/engine/UI/building sounds, throttling and priorities | A fight sounds like a fight; nothing is silent or deafening |
| C. Voices + EVA | TTS pipeline, radio filter, unit voice sets for 28 types, EVA lines, `en` locale | Units answer orders, warn when hit; EVA announces base attacks and low power |
| D. Baked SFX/music | AI SFX and music for the 6-8 sounds that matter most, music playlist with states | Weapon signatures and a soundtrack |
| E. Polish | Ducking tuning, locale add-on proof (second language), bundle budget check, ambient per map | Mix is tuned; a second language works |

Each phase is its own PR and example save. The owner approves by ear after A,
C and D.

## 4. Generation approach

### 4.1 Options

| Content | Procedural Web Audio | AI generation (offline, baked to files) |
|---|---|---|
| UI beeps, clicks, EVA tones | Best: exact, tiny, themeable | Not needed |
| Footsteps, tracks squeal, engine loops | Good: noise + oscillators + filters, pitch from speed | OK as a texture layer |
| Weapon shots, impacts, explosions | Fair: needs layered noise bursts + sub thump + tail | Better: richer tails; needs curation |
| Voices (select/move/attack/...) | Not possible | Required: TTS |
| Music | Poor | Required: music model |

**Recommendation: hybrid.** Phase A-B ship procedural recipes for everything
that is not speech or music (zero download, instant iteration, works offline).
Phase C-D bake files for voices, music and the sounds where procedural is
audibly poor. Procedural recipes stay as the fallback when a file is missing or
still loading, and as the placeholder while a sound has not been generated.
Procedural recipes are data too (§7), not hard-coded per sound.

### 4.2 Candidate tools (verify licence before adoption)

Licence rule: only tools whose outputs may ship under CC BY-SA 4.0. Each
generated file records its tool, model, model licence and prompt in the
manifest (§7.3) so `NOTICE.md` stays accurate.

* **Speech (TTS), local:** Kokoro-82M (Apache-2.0, small, multi-language, runs
  on CPU/MPS), Chatterbox (MIT, expressive, voice control), Piper (fast,
  voices have individual licences: check each). Avoid models with
  non-commercial clauses (XTTS) and never clone a real person's voice.
  Cloud TTS (ElevenLabs etc.) is acceptable only if its terms allow shipping
  the output in an open-licensed game: owner's call, not assumed.
* **SFX, local:** Stable Audio Open 1.0 (text to SFX/loops up to ~47 s; Stability
  Community Licence, check terms; ComfyUI has native Stable Audio nodes).
  AudioLDM2 / MMAudio as alternatives (check licence).
* **Music, local:** ACE-Step (Apache-2.0; ComfyUI template available) for
  instrumental loops; Stable Audio Open for short stingers.
* **Post-processing:** `ffmpeg` (present: `/opt/homebrew/bin/ffmpeg`) for the
  radio filter, loudness normalization (EBU R128), trimming, loop crossfades and
  encoding. `sox` is not installed and is not needed.

### 4.3 What exists locally (checked, nothing heavy run)

* ComfyUI core v0.39.0 at `~/.local/share/comfyui/ComfyUI` (comfy-cli 1.22),
  server **not running**, **no audio checkpoints** (the `checkpoints`,
  `audio_encoders`, `text_encoders` folders are empty) and only the example
  custom node. Machine: Apple M2 Max, 64 GB unified memory: enough for Stable
  Audio Open, ACE-Step and Kokoro locally.
* So Phase C-D start by downloading models (hundreds of MB to a few GB each),
  which needs the owner's go-ahead per download (name, source, size).
  Kokoro/Piper can also run as plain Python via `uv` without ComfyUI.

### 4.4 Workflow (reproducible, offline from the game's point of view)

1. **Script.** Voice and EVA text lives in `client/src/i18n/` keys (§5.3); the
   generator reads it, so translation and generation share one source.
2. **Generate.** `scripts/audio/gen.mjs` (new, runs locally only, never in CI)
   reads `data/audio/*.yaml`, calls the chosen tool for every event whose output
   file is missing or whose prompt/script hash changed, N takes per line.
3. **Process.** ffmpeg chain per class: voices: band-pass 300-3400 Hz, soft
   clip, short noise squelch head/tail ("radio" look), loudness -20 LUFS;
   SFX: trim, peak -3 dBFS, short fades; loops: crossfade join.
4. **Review.** The owner listens through a contact sheet page
   (`?audio=debug` or a static page) with a keep/reject toggle per take.
   Rejected takes are regenerated with a new seed; seeds are in the manifest.
5. **Commit.** Encoded files under `client/public/audio/`, manifest
   `data/audio/manifest.json` (file, hash, tool, seed, licence). CI only
   validates that every event's files exist and the manifest matches
   (`check:audio`, new), never generates.

## 5. Event table and data layout

### 5.1 Files in `data/audio/`

* `events.yaml`: sound effects, copying Zero Hour's `AudioEventInfo` fields with
  camelCase names: `sounds` (list of file ids or `synth:<recipe>`), `volume`,
  `volumeShift`, `pitchShift: [-5, 5]` (percent), `delayMs: [0, 600]`, `limit`,
  `priority` (`lowest|low|normal|high|critical`), `type` flags (`ui`, `world`,
  `shrouded`, `global`, `voice`, `player`, `allies`, `enemies`, `everyone`),
  `control` flags (`loop`, `random`, `all`, `postDelay`, `interrupt`),
  `minDistance`, `maxDistance` (tiles), `lowPass`.
* `voices.yaml`: voice sets. A set is `{select, move, attack, underFire, die,
  created, ...}` and each entry is an event as above. Sets are assigned by unit
  type id with fallback by category/locomotor (`foot`, `wheeled`, `tracked`,
  `building`), so a new unit type gets a voice with no extra work.
* `eva.yaml`: EVA events: `priority`, `cooldownMs`, `expireMs` (Zero Hour's
  `TimeBetweenChecksMS`, `ExpirationTimeMS`), lines per faction.
* `mix.yaml`: bus volumes, ducking rules, global limits (§9), music states.
* `manifest.json`: generated, lists files and provenance (§4.4).
* Schema in `data/schema/` (same validator as the rules), checked by
  `check:audio`.

### 5.2 Mapping by convention (no sim data changes)

Audio never edits `data/factions/*.yaml`. Event ids follow conventions and
fall back through a chain so every weapon sounds like something:

* Weapon: `weapon.<weaponId>.fire` -> `weapon.<damageType>.fire` ->
  `weapon.<render.launch>.fire` (`muzzle`, `cannon`, `rocketLaunch`,
  `backblast`, `softLaunch` already exist in the weapon data).
  Impact: `impact.<weaponId>` -> `impact.<damageType>.<surface>` (surface from
  the terrain, e.g. `snow`, `mud`, `building`, `armor`, `flesh`).
  Explosion: `explosion.<size>` from the shot effect size (spec 07 §3).
* Unit: `voice.<typeId>.<event>` -> `voice.<category>.<event>`.
  Movement: `move.<locomotor>` (engine loop, tracks, footsteps).
* Building: `building.<typeId>.<place|complete|working|die>` -> by category.

### 5.3 i18n

* Each spoken line is a message in `client/src/i18n/<locale>.json` under keys
  `voice.<set>.<event>.<n>` and `eva.<event>.<n>` (player-facing strings go
  through `client/src/i18n/`; the file is also the TTS script and the optional
  subtitle). Messages use ASCII ids, text in the locale.
* Audio files per locale: `audio/<locale>/voice/<set>/<event>_<n>.webm`,
  `audio/<locale>/eva/<event>_<n>.webm`. Non-speech audio is shared by all
  locales.
* Resolution: current locale file, else `en`, else the procedural fallback.
  Lines of the `n` variants may differ in number per locale; the table stores
  counts from the manifest, not code.
* Assumption: v1 ships `en` only, with faction flavour in the words and
  voice (Russian-sounding vs Ukrainian-sounding accent where the TTS allows),
  not in a different language; adding `es`, `ru`, `uk` is "add keys + run the
  generator for that locale" with no code change.

## 6. Runtime behaviour (copied from Zero Hour)

1. **Admission** follows `canPlayNow`: audience filter, `shrouded` (fog) cull,
   voice rule, per-event `limit`, free channel, steal lower priority, else drop.
   Channel pools: 32 simultaneous world voices (Web Audio is cheaper than
   Miles; Zero Hour used 25), 8 UI, 2 streams (music + one speech).
   `minSampleVolume`: sounds computed under 2% gain are skipped.
2. **Voice rule.** One voice per object at a time. Orders given to a group
   speak with **one** unit of the group (the first selected, as Zero Hour does:
   the group leader acknowledges) so ten units do not talk at once.
3. **Select/move/attack** are UI voices for the owner only: played from the
   client input layer when the command is issued; a new order interrupts the
   previous line (`interrupt`).
4. **Under fire** (difference): when a `detonate` event hits an own unit,
   per-unit cooldown 12 s, a global voice budget of 1 line per 3 s, only when
   the unit is on screen, never while the same unit is already talking, and not
   if it dies in the same tick (the `die` line plays instead).
5. **Die**: from `death` events (`victimKind` picks infantry scream / vehicle
   blast / building collapse). `limit` 3 per event so a massacre is a dense
   texture, not 40 screams; infantry screams only when on screen.
6. **EVA queue** is Zero Hour's `Eva` class: one line at a time; each event has
   `cooldownMs` since its last play and `expireMs` while waiting; the highest
   priority waiting message plays when the channel is free. Starting events:
   base under attack (priority 7, cooldown 30 s, expiry 5 s), low power (2,
   2 min, 5 s), insufficient funds, unit lost, building lost, production
   complete, upgrade complete, construction complete, building under
   construction ready to place, victory, defeat.
7. **Loops** (engines, building hum, ambient): started/stopped from snapshot
   state; at most `limit` per event; pitch and gain follow speed; retried about
   once per second like `TimeBetweenDrawableSounds`, never every frame.
8. **Variation:** `random` picks a variant not equal to the last one;
   `pitchShift`, `volumeShift` and `delayMs` are drawn per instance. These use a
   client-side RNG (`Math.random` is allowed in the client; it never touches
   the sim).

## 7. Procedural recipes (Phase A-B)

* A recipe is data in `data/audio/synth/*.yaml`: a small graph (oscillator or
  noise source, filter, envelope, optional layers and a convolver tail) that the
  client turns into an `AudioBuffer` once at load (offline render with
  `OfflineAudioContext`) and caches. Rendering offline keeps playback as cheap
  as a file and makes procedural and baked sounds the same thing at runtime.
* Engine loops are the exception: they are live nodes (oscillator + filtered
  noise) whose pitch and gain follow the unit's speed.
* The same recipes are the offline-render source of the "placeholder pack", so
  the debug page can export them to wav for comparison with generated takes.

## 8. How sim events reach audio (client only)

* The sim is not touched. Audio is a read-only consumer of what the client
  already receives each frame: `CombatSnapshot.events`
  (`client/src/sim/combatSnapshot.ts`: `detonate` with owner/weapon/hit/tile
  position, `death` with victim kind/killer/position), `projectiles`
  (`launchTick` gives the shot sound at launch, at the origin), and the entity
  snapshot diffs (new entity = created, health drop = hit, speed = engine
  state, building state change = place/complete).
* Pipeline: `snapshot -> audioEvents.derive(prev, next, localPlayer)` produces
  `{ eventId, entity, pos, owner }` records -> `audio/director` applies
  admission (§6) -> `audio/mixer` plays. Player commands come from the input
  layer directly (same place `attackMarker` is triggered), not from the sim.
* Determinism and replays: derived events depend only on snapshots, so replays
  and saves sound the same (`?load=` works). Audio state is never written back
  to the sim or to saves. Time for cooldowns uses wall-clock in the client
  (not sim ticks) and pauses with the game pause (the context is suspended).
* If a needed fact is not derivable from snapshots (for example "production
  complete"), add a read-only event to the snapshot encoding, as `detonate`
  and `death` are. This is an output-only protocol addition; it must be listed
  in the phase PR and cannot alter sim state or hashes.
* Browser rule: the `AudioContext` is created and resumed on the first user
  gesture (click on the menu), otherwise it stays suspended.

## 9. Positional audio with the isometric camera

* Zero Hour places a "microphone" between ground and camera (33.3% max) and
  uses real 3D distance. We copy the idea, adapted to a fixed isometric view:
  the **listener is the ground point at the camera target**; orientation is
  fixed (screen-right = right ear), so rotating the world does not flip sides.
* **Pan** from the sound's screen position: project the tile to the screen
  (reuse `client/src/camera.ts`) and map x to `-1..1` with a `StereoPannerNode`
  (clamped at +-0.85 so off-screen sounds are still audible). Off-screen above or
  below changes gain and low-pass only. HRTF/`PannerNode` is not used: in an
  isometric view the screen-based pan reads better and costs less.
* **Distance** gain curve with the event's `minDistance`/`maxDistance` in tiles
  from the listener: full at or below min, silent beyond max (dropped, not
  played). `lowPass` closes a low-pass filter with distance. Weapons use
  generous `maxDistance` (a big gun is heard across the map), footsteps small.
* **Zoom bonus** as in `AudioSettings.ini`: up to +20% of world volume when the
  camera is close; none when zoomed out.
* **Fog:** `shrouded` events are dropped unless the tile is currently visible
  (use the same visibility the fog layer exposes). Own and allied sounds are
  always allowed.
* **Voice and UI** sounds are 2D, centred, with Zero Hour's `-10%` relative
  volume for 2D vs 3D.

## 10. Mixing and ducking

* Buses: `master` (compressor/limiter at the end) <- `sfx`, `voice`, `eva`,
  `ui`, `ambient`, `music`. Settings sliders per bus in `client/src/settings.ts`
  (master, effects, voices, music) with Zero Hour's defaults as starting point:
  effects 80, voices 70, music 55; persisted like the other settings.
* Ducking (gain automation, not a sidechain compressor): `eva` critical lines
  duck `music` by 9 dB and `sfx` by 4 dB for the line's length plus 300 ms;
  unit voices duck `music` by 4 dB; release 500 ms. Rules live in `mix.yaml`.
* Loudness targets: voices -20 LUFS, SFX peaks -3 dBFS with `volume` per event
  for relative loudness, music -20 LUFS. Big explosions get a short
  low-pass dip on the other `sfx` (impact "punch") only if tests by ear need it.
* Pause, tab hidden: suspend the context (music fades over `TimeToFadeAudio`
  = 2 s).

## 11. Content inventory

* **Unit voices** (28 types listed in `data/factions/*.yaml`: infantry,
  light/main-battle vehicles, artillery, dozers, trucks): events `select`,
  `move`, `attack`, `underFire`, `die`, `created`; 4-5 variants for
  `select|move|attack`, 3 for `underFire|die`, 1-2 for `created`. Sets are
  shared by role (rifleman, anti-tank, scout, apc/ifv, tank, artillery,
  engineer, truck), flavoured per faction: 8 sets x 2 factions x ~22 lines.
  Vehicles use a shorter radio-style line ("Acknowledged", "On my way").
* **EVA**: ~20 events per faction voice (the EVA voice differs per faction).
* **Weapons:** the 7 current weapon ids per faction (rifle, RPG, heavy MG,
  autocannon, tank gun, thermobaric, ATGM, ...) get a `fire` event; shared
  `impact` and `explosion` families by size, material and damage type.
* **Movement:** engine loops by locomotor (wheeled, tracked, light, heavy),
  track/clank layer for tracked, footsteps by surface (grass, mud, snow, road)
  for infantry, tied to the existing walk animation phase.
* **Buildings:** place, construction loop, complete, production started/ready,
  working loops (power plant hum, factory machinery), damage/collapse.
* **Ambient:** per weather/map (wind, snow wind, distant artillery bed, birds
  on summer maps); `ambient` bus, 2 loops max.
* **UI:** click, hover, error ("can't do that"), cash tick, build menu, minimap
  ping, selection box. **Music:** menu, calm build-up, combat, victory,
  defeat; combat state switches by recent damage events; crossfade 2 s.

## 12. File formats and budget

* Format: Opus in WebM (`.webm`), mono 24-32 kbps for voices, mono 48-64 kbps
  for SFX, stereo 96 kbps for music and long ambient loops. Browser support
  for Opus-WebM (Chrome, Firefox, Safari) is verified in Phase A; the fallback
  if Safari fails is AAC `.m4a` of the same files, chosen by the loader.
* Short SFX are decoded once into `AudioBuffer`s (Zero Hour kept 4 MB of
  samples cached; our decoded budget is 64 MB, LRU, and the encoded budget is
  below). Music streams through a `MediaElementAudioSourceNode`.
* Download budget (gzip is useless on Opus): core pack (UI, combat SFX,
  shared) at most 4 MB; faction voices at most 3 MB per faction and locale,
  lazy-loaded when a faction is picked; music at most 20 MB, streamed in the
  background; whole game audio under 35 MB. `check:audio` fails CI above these.
* Preloading: core pack on game load, weapons/units of both factions before the
  match starts, music after.

## 13. Assumptions

* Voices ship in English first; faction flavour through wording and voice
  choice, and a second locale is a data-and-generate task (Phase E proves it).
* `underFire` and `die` voices are positional world sounds heard by their
  owner only, on screen only; `select/move/attack` as in Zero Hour (UI,
  owner only, group leader speaks).
* Generated audio is acceptable under D-02 if its model licence allows
  redistribution; models are chosen per §4.2 and recorded in the manifest.
  Model downloads need the owner's approval each time.
* Music is generated instrumentals (no sung voices, no sound-alike of EA's
  themes).
* The sim and `crates/sim` are untouched; any output-only snapshot additions are
  reviewed in their phase PR.

## 14. Verification plan (per phase)

* Phase A: unit tests of admission rules (limit, voice rule, priority stealing,
  EVA queue cooldown/expiry) with a fake clock; typecheck; example save
  `audio-fight` (a skirmish with both factions, mixed units) to hear it.
* Phase B-D: `check:audio` (schema, files exist, budgets, manifest); a listening
  page `?audio=debug` listing every event with play buttons and the live voice
  count; owner listens (visual-iteration rule: tests after approval).
* Phase E: a locale smoke test (`es` pack with 3 lines resolves, falls back to
  `en` for the rest).

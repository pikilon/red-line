# 25 — Voices and sound

Status: phase 1 implemented (owner request 2026-10-25; revised 2026-10-25 with the
reference-pack process; revised 2026-10-26 with native IMA ADPCM decoding, no
synthetic engine drone, verified USA voices for Ukraine / China voices for Russia,
and full behavior wiring for music, ambient beds, construction loops, building
damage and UI/EVA triggers). `docs/audio-extension.md` is the contributor guide.
Depends on `01-architecture.md` (audio lives in the client main thread),
`07-phase4b-combat-effects.md` (combat events), `17-projectiles-and-combat-readability.md`,
`19-save-games.md` (example saves).
Decisions: D-02 (the sim stays deterministic and untouched; assets are CC BY-SA
4.0 and must not reproduce EA sounds verbatim).

## 1. Context

The game is silent today (`00-vision.md` lists "Art and audio" as future,
`07` §1 puts audio out of scope). The owner wants voices and sounds: unit voice
lines (select, move, attack, under fire, dying) per faction and unit type,
EVA/announcer lines, a sound for every weapon, impacts, explosions, vehicle
engines and tracks, infantry footsteps, buildings, ambient, UI and music.
Footsteps are not a Zero Hour audio event, so they belong to our own content
(phase 3), not to the behavior clone.

**Process (owner, 2026-10-25).** First clone how Zero Hour's audio *behaves*
(overlap, limits, mix, volume with camera zoom, stereo panning, unit movement,
weapons), and tune it by ear using the owner's own Zero Hour sounds as a
**local, private reference pack** that never enters the repository or a build.
Once the behaviour is right, the same event list becomes the inventory and
brief for generating our own sounds automatically. The Zero Hour sounds are
scaffolding only: none ships, none is used as input to a generator (§4.2), and
the final voices are Ukrainian and Russian, with strong language.

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
* **Admission order** (`SoundManager::canPlayNow`, `GameSounds.cpp:206-322`,
  `MilesAudioManager.cpp:1826-2051`):
  audience check (`AudioManager::shouldPlayLocally`, `GameAudio.cpp:1020`),
  then distance (`>= MaxRange` for 3D non-global non-critical) and shroud cull
  (`CELLSHROUD_CLEAR`), then voice rule (`violatesVoice`: an event with `voice`
  is refused while the same object is already playing a voice unless it has
  `interrupt`), then per-event `Limit` (`doesViolateLimit`, overridden by
  `interrupt` killing the oldest handle), then free channel (positional vs 2D
  pools), then steal a lower-priority playing sound
  (`isPlayingLowerPriority` / `killLowestPrioritySoundImmediately`), else
  `interrupt` fallback on identical event, else cull.
* **Distance attenuation & shifts** (`MilesAudioManager::getEffectiveVolume`,
  `MilesAudioManager.cpp:2710`; `AudioEventRTS::generatePlayInfo`,
  `AudioEventRTS.cpp:340-477`): inverse distance dropoff (`1.0` for
  `dist <= MinRange`, `MinRange / dist` for `MinRange < dist < MaxRange`, `0.0`
  for `dist >= MaxRange`). `PitchShift` scales playback rate by
  `[1 + min/100, 1 + max/100]`; `VolumeShift` samples uniformly in
  `[1 + VolumeShift/100, 1]`; `AC_RANDOM` avoids repeating the immediately
  preceding variant when `count > 1`. Ground units trigger `SoundMoveStart`
  (`ThingTemplate.h:111`, `AIStates.cpp:1696-1714`) on acceleration with random
  delay jitter (`Delay = 0 500..800 ms`).
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
   The event table, flags and rules are copied; the content is original. EA's
   sounds are only a local reference while tuning (§4.2).
3. Voices speak the faction's language (Ukrainian for Ukraine, Russian for
   Russia) with strong language, and carry optional translated subtitles
   (the original ships one language set per installation).
4. The original's voice is on the unit's owner only as a UI sound; we keep it,
   but `underFire` and `die` are positional world sounds heard by the owner only
   when on screen (an assumption, §13).

## 3. Scope and phases

| Phase | Deliverable | Player-visible result |
|---|---|---|
| 1. Engine clone with reference pack | Local extractor for the owner's Zero Hour `.big` files (§4.2), event table loader, admission rules, voice rule, limits and priorities, buses and ducking, stereo pan, distance and zoom volume, fog cull, discrete move-start samples, weapon fire/impact/explosion events, construction/ambient loops, music states, EVA queue, settings sliders, minimal procedural fallback, `?audio=debug` overlay, example saves `audio-fight` and `construction` | On the owner's machine a fight sounds and mixes like Zero Hour; elsewhere the game starts muted so the placeholder synth sounds never reach the public web; volume sliders work |
| 2. Inventory and briefs | Listening review of every event on the debug page; `data/audio/inventory.yaml` mapping each event to its WebM target (`_<n>.webm`) with a written brief (what our sound should be, in our own words), variant counts and voice line scripts in Ukrainian and Russian. Briefs may start as machine drafts from spectrograms (`audio:describe`) and the local WebM pack (`audio:pack`) gives A/B in the shipping format | A complete, owner-approved list of WebM files to make; nothing new to hear yet |
| 3. Automated generation | `scripts/audio/gen.mjs` pipeline (§4.5): SFX (libraries + local model), voices (uk/ru TTS, radio filter, strong language), EVA per faction, music; each generated sound replaces its reference entry | The game ships with its own sounds; the reference pack is no longer needed |
| 4. Polish | Mix retune with the final sounds, ambient per map, subtitles, bundle budget check, strong-language toggle | Mix is tuned; subtitles and the language filter work |

Each phase is its own PR (phase 3 may split by content class: SFX, voices,
EVA, music). The owner approves by ear after phases 1, 3 and 4. Phase 1 is
the long one: the goal is that the *behaviour* is right before any of our own
content exists, so phase 3 only swaps files and never re-tunes rules.

## 4. Content approach

### 4.1 Options

| Content | Procedural Web Audio | Free libraries (CC0 / CC-BY) | AI generation (offline, baked to files) |
|---|---|---|---|
| UI beeps, clicks, EVA tones | Best: exact, tiny, themeable | Good (Kenney) | Not needed |
| Footsteps, tracks squeal, engine textures | Good: noise + filters; one-shot acceleration | Good (Freesound) | OK as a texture layer |
| Weapon shots, impacts, explosions | Fair | Best: real recordings (Freesound) | Good for gaps; needs curation |
| Voices (select/move/attack/...) | Not possible | Not possible | Required: TTS |
| Music | Poor | Limited (OpenGameArt) | Required: music model |

**Decision.** Phase 1 uses the local reference pack for listening and a
minimal procedural fallback (one recipe per sound class) so builds without the
pack are not silent. Phase 3 fills each event in this order: free library
recording (CC0 or CC-BY only; CC-BY-NC, Pixabay, Mixkit, Zapsplat and the
Sonniss GDC bundle are excluded because their terms do not fit CC BY-SA 4.0
redistribution), else local AI generation, else a tuned procedural recipe.
The procedural recipe stays as the fallback while a file is loading.

### 4.2 Local reference pack (phase 1-2 only)

* **Source.** The owner's own Zero Hour 1.04 install (owned copy). Files used:
  `AudioZH.big`, `AudioEnglishZH.big`, `SpeechZH.big`, `SpeechEnglishZH.big`,
  `MusicZH.big`, and `INIZH.big` for the event definitions, plus the Generals
  base `.big` files the Zero Hour INIs still reference. Path given once to the
  extractor (`--zh <dir>`; the owner's is on the external disk under
  `download zero hour/.../Command & Conquer Generals Zero Hour`) and
  remembered in the gitignored `.env.local` as `ZH_DIR`.
* **Extractor.** `scripts/audio/zh-ref.mjs` (new, local only, never in CI)
  reads the BIG archives (`BIGF` header, big-endian directory of
  offset/size/name), parses the audio INIs and writes:
  * `.local/audio-ref/<zh file>` the referenced `.wav`/`.mp3` files, as is;
  * `.local/audio-ref/zh-events.json` the parsed Zero Hour events (fields of
    §2) for the debug page.
* **Format parity (local).** `scripts/audio/pack.mjs` reads the same index and
  `reference.yaml`, keeps only the files the game actually uses and encodes
  them as Opus/WebM under `.local/audio-ref-webm/` with the §12 bitrates
  (voices 32 kbps mono, SFX 64 kbps mono, music 96 kbps stereo, ambient
  96 kbps stereo or 64 kbps mono). `pack.json` records source, bitrate,
  duration and the events using each file. This changes the container, not the
  provenance: the output stays gitignored scaffolding for listening and A/B,
  and is never committed, built or served in production.
* **Mapping.** `data/audio/reference.yaml` (committed) maps our event ids to
  Zero Hour *event names* only (for example `weapon.t72.fire: CrusaderTankWeapon`).
  Per owner instruction (2026-10-25), Ukrainian unit voices, EVA and music map
  to Zero Hour's **USA** set (`RangerVoice*`, `MissileDefenderVoice*`,
  `HumveeVoice*`, `PaladinTankVoice*`, `CrusaderTankVoice*`, `TomahawkVoice*`,
  `DozerUSAVoice*`, `ChinookVoice*`, `EvaUSA_*`), while Russian unit voices, EVA
  and music map to Zero Hour's **China** set (`RedGuardVoice*`,
  `TankHunterVoice*`, `GattlingTankVoice*`, `TroopCrawlerVoice*`,
  `BattleMasterTankVoice*`, `InfernoCannonVoice*`, `DozerChinaVoice*`,
  `SupplyTruckVoice*`, `EvaChina_*`). It contains names, no audio. Our own event
  fields (`volume`, `limit`, `pitchShift`...) are written in `events.yaml` using
  Zero Hour's numbers as the starting point, cited per event.
* **Serving.** The files live outside `client/public/`, so Vite never copies
  them into a build. A dev-server-only middleware serves the parsed index from
  `.local/audio-ref/` and every audio file from `.local/audio-ref-webm/`
  (`apply: 'serve'`, written by `audio:pack`). The client requests only
  `.webm`; the extracted originals are input to the packer and are never
  served. Production builds and `deploy:pages` cannot contain either directory.
  The loader resolves an event: our file (phase 3) -> WebM dev pack ->
  procedural fallback. The faction mapping is literal: Ukrainian unit voices
  and EVA use Zero Hour's USA set, Russian ones use the China set.
* **Guards.** `.local/` is gitignored; `check:audio` fails if any tracked file
  sits under `.local/audio-ref/` or if the client build output contains an
  `audio-ref` path.
* **Not an input.** Reference files are only for listening and A/B comparison.
  They are never fed to a generator (no audio-to-audio, no voice cloning, no
  stems), and briefs in phase 2 describe the sound in our own words. A draft may
  start from a spectrogram read by a local vision model (§5.1): that is text
  authoring, not audio generation, and a person still approves the brief by ear.

### 4.3 Candidate tools (verify licence before adoption)

Licence rule: only tools whose outputs may ship under CC BY-SA 4.0. Each
generated or downloaded file records its source (library URL and author, or
tool, model, model licence, prompt and seed) in the manifest so `NOTICE.md`
stays accurate; CC-BY sources are credited there.

* **Speech (TTS), local, Ukrainian and Russian:** Piper has `uk_UA` and
  `ru_RU` voices (each voice has its own licence: check each); Chatterbox
  Multilingual (MIT) covers Russian, Ukrainian to verify; other open
  Ukrainian TTS projects to evaluate in phase 3. Kokoro does not cover either
  language. Avoid non-commercial models (XTTS, Silero) and never clone a real
  person's voice. Cloud TTS is acceptable only if its terms allow shipping the
  output in an open-licensed game: owner's call, not assumed. Some TTS models
  soften or refuse profanity; the phase 3 pick is tested with the strong
  language lines first.
* **Script writing:** voice and EVA lines are drafted with a text model
  (OpenRouter or local), reviewed by the owner, and committed as text.
* **SFX, libraries:** Freesound.org (CC0 and CC-BY filters), Kenney.nl (CC0),
  OpenGameArt.org (CC0, CC-BY, CC-BY-SA).
* **SFX, local model:** Stable Audio Open 1.0 (text to SFX/loops up to ~47 s;
  Stability Community Licence, check terms; ComfyUI has native Stable Audio
  nodes). AudioLDM2 / MMAudio as alternatives (check licence).
* **Music, local:** ACE-Step (Apache-2.0; ComfyUI template available) for
  instrumental loops; Stable Audio Open for short stingers.
* **Post-processing:** `ffmpeg` (present: `/opt/homebrew/bin/ffmpeg`) for the
  radio filter, loudness normalization (EBU R128), trimming, loop crossfades and
  encoding. `sox` is not installed and is not needed.

### 4.4 What exists locally (checked, nothing heavy run)

* ComfyUI core v0.39.0 at `~/.local/share/comfyui/ComfyUI` (comfy-cli 1.22),
  server **not running**, **no audio checkpoints** (the `checkpoints`,
  `audio_encoders`, `text_encoders` folders are empty) and only the example
  custom node. Machine: Apple M2 Max, 64 GB unified memory: enough for Stable
  Audio Open, ACE-Step and the TTS candidates locally.
* So phase 3 starts by downloading models (hundreds of MB to a few GB each),
  which needs the owner's go-ahead per download (name, source, size).
  Piper can also run as plain Python via `uv` without ComfyUI.

### 4.5 Generation workflow (phase 3; offline from the game's point of view)

1. **Brief and script.** `data/audio/inventory.yaml` (phase 2) holds the brief
   per event; voice and EVA lines live in `data/audio/lines/<faction>.yaml`
   in the faction's language (§5.3).
2. **Generate.** `scripts/audio/gen.mjs` (new, runs locally only, never in CI)
   reads the inventory and calls the chosen source for every event whose output
   file is missing or whose brief/script hash changed, N takes per line.
3. **Process.** ffmpeg chain per class: voices: band-pass 300-3400 Hz, soft
   clip, short noise squelch head/tail ("radio" look), loudness -20 LUFS;
   SFX: trim, peak -3 dBFS, short fades; loops: crossfade join.
4. **Review.** The owner listens on the debug page with our take and the
   reference side by side (dev only) and a keep/reject toggle per take.
   Rejected takes are regenerated with a new seed; seeds are in the manifest.
5. **Commit.** Encoded files under `client/public/audio/`, manifest
   `data/audio/manifest.json` (file, hash, source, seed, licence). CI only
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
* `reference.yaml`: our event id -> Zero Hour event name, for the local
  reference pack (§4.2); names only, no audio.
* `inventory.yaml` (phase 2): one entry per event in `reference.yaml` with
  `category`, `kind`, `target` (the WebM template, `<n>` is the variant),
  `variants`, `seconds`, `loop`, `status` and, once written, `brief` (one or
  two sentences: what our sound should be, in our own words), `prompt` (a
  text-to-audio prompt) and `tags`. It is the worklist we transform: no entry
  names a source recording or points at anything but a `.webm` target.
  Statuses: `silent`, `needs-script`, `todo`, `draft`, `approved`.
  `node --run audio:inventory -- --write` rebuilds the metadata and keeps the
  text; `node --run audio:describe -- --write` drafts `brief` and `prompt` from
  a spectrogram plus the game context with the local Gemma vision model. Drafts
  are committed as `draft` and only become `approved` after the owner listens;
  the reference audio never enters a generator. `node --run audio:inventory --
  --list` prints every expanded target `.webm` path for a batch generator.
* `manifest.json`: generated, lists files and provenance (§4.5).
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
  Movement: `move.<typeId>.start` -> `move.<locomotor>` (one-shot
  acceleration sample). Damage state: `vehicle.damage` on the 50 % crossing.
  Footsteps are not a Zero Hour event; they are future original content.
* Building: `building.<typeId>.<place|complete|working|die>` -> by category;
  runtime damage events are `building.damage`, `building.damage.heavy` and
  `building.damage.critical`.
* Ambient: `ambient.<climate>` (snow, temperate; see `ambientEventFor`).
  UI: `ui.<action>` from the menu/command/placement layer. EVA:
  `eva.<faction>.<event>` resolved by the queue's faction.

### 5.3 Voice language, strong language and subtitles

* **Spoken language is the faction's**, independent of the UI locale:
  Ukrainian units and EVA speak Ukrainian, Russian ones speak Russian. The
  lines are audio content, so their source text lives in
  `data/audio/lines/<faction>.yaml` (`<set>.<event>: [{ id, text, explicit }]`),
  which is also the TTS script.
* **Strong language.** Lines are written as soldiers talk, profanity included.
  Each line carries `explicit: true|false`; every event keeps at least one
  clean variant. A "Strong language" setting (on by default, next to the gore
  filter of D-03) excludes `explicit` variants when off.
* **Subtitles** (phase 4, off by default) are player-facing text, so they go
  through `client/src/i18n/<locale>.json` under `voice.<faction>.<set>.<event>.<id>`
  and `eva.<faction>.<event>.<id>`; a missing translation falls back to `en`,
  then to no subtitle.
* Audio files: `audio/voice/<faction>/<set>/<event>_<id>.webm`,
  `audio/eva/<faction>/<event>_<id>.webm`. The rest of the worklist uses
  `audio/sfx/<eventId>_<n>.webm` (weapons, impacts, explosions, movement,
  vehicles, buildings), `audio/music/<state>_<n>.webm`,
  `audio/ambient/<climate>_<n>.webm` and `audio/ui/<action>_<n>.webm`, where
  `<n>` is the 1-based variant. Variant counts come from the manifest, not
  code.

## 6. Runtime behaviour (copied from Zero Hour)

1. **Admission** follows `canPlayNow`: audience filter, `shrouded` (fog) cull,
   voice rule, per-event `limit`, free channel, steal lower priority, else drop.
   Channel pools: 32 simultaneous world voices (Web Audio is cheaper than
   Miles; Zero Hour used 25), 8 UI, 2 streams (music + one speech).
   `minSampleVolume`: sounds computed under 2% gain are skipped.
2. **Voice rule.** One voice per object at a time. Orders given to a group
   speak with **one** unit of the group (the first selected; our choice, not
   verified in Zero Hour: the group leader acknowledges) so ten units do not talk at once.
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
7. **Movement and loops.** There are no continuous engine loops. Zero Hour's
   ground units fire a discrete `SoundMoveStart` when acceleration begins
   (`ThingTemplate.h:111`, `AIStates.cpp:1696-1714`); Zero Hour's `Object.ini`
   defaults `SoundMoveLoop = NoSound` and only civilian transports override it,
   so our ground units likewise have no continuous engine loop. We play the
   `SoundMoveStart` sample once and never open an oscillator on the effects
   bus. Construction and ambient loops are **sample** loops started/stopped from
   snapshot state, at most `limit` per event, with the Zero Hour
   `AttackSounds`/`DecaySounds` head and tail. Positional loop gain, pan and
   low-pass follow the listener; the mixer updates them on each snapshot, not
   every frame. Music has its own crossfade and is not admitted through the
   effects pools. Zero Hour ships no footstep `AudioEvent` (`Object.ini` has no
   footstep field), so footsteps are future original content, not a missing
   clone.
8. **Variation:** `random` picks a variant not equal to the last one;
   `pitchShift`, `volumeShift` and `delayMs` are drawn per instance. These use a
   client-side RNG (`Math.random` is allowed in the client; it never touches
   the sim).

## 7. Procedural recipes (fallback, phase 1; tuned where used, phase 3)

* Phase 1 ships one minimal recipe per sound class (click, shot, impact,
  explosion, engine, construction, wind, voice blip) so builds without the
  reference pack are never silent. `footstep` stays as a future original-content
  recipe (Zero Hour has no footstep event). Recipes for events that end up
  procedural in phase 3 are tuned then.
* A recipe is data in `data/audio/synth/*.yaml`: a small graph (oscillator or
  noise source, filter, envelope, optional layers and a convolver tail) that the
  client turns into an `AudioBuffer` once at load (offline render with
  `OfflineAudioContext`) and caches. Rendering offline keeps playback as cheap
  as a file and makes procedural and baked sounds the same thing at runtime.
* The `synth:engine` recipe is a one-shot fallback only. A moving vehicle never
  opens an oscillator: the old live sawtooth drone was the synthetic hum the
  owner reported on the effects bus, and it is gone (the reference
  `SoundMoveStart` WAVs replace it when the pack is present). `synth:construction`
  and `synth:wind` are offline-rendered loop buffers for the same paths, never
  live oscillator graphs.
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
  generous `maxDistance` (a big gun is heard across the map), move-start
  samples small.
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
  (master, effects, ambient, voices, music) with Zero Hour's defaults as the
  starting point: effects 80, ambient 50, voices 70, music 55; persisted like
  the other settings. Ambient has its own slider because birds/wind are not
  combat effects and are the first thing players want to turn down.
* **Muted by default (owner, 2026-10-26).** The master slider starts at 0 in
  every build, including the public web: the placeholder procedural fallback is
  not fit for players, so nothing plays until someone raises the slider. This
  is temporary; restore Zero Hour's master 100 when phase 3 ships generated
  assets, and keep an eye on `?audio=debug` auditions while it lasts (raise the
  master slider once; the value persists).
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
  engineer, truck), flavoured per faction: 8 sets x 2 factions x ~22 lines,
  in Ukrainian or Russian with strong language (§5.3). Vehicles use a shorter
  radio-style line.
* **EVA**: 11 events defined (the EVA voice differs per faction and speaks its
  language). Wired triggers: base under attack, low power, insufficient funds,
  unit lost, building lost, production complete, construction complete,
  building placement ready, victory and defeat. `upgradeComplete` stays defined
  but unqueued until the sim has upgrades; superweapon EVA lines are out of
  scope until superweapons exist.
* **Weapons:** the 7 current weapon ids per faction (rifle, RPG, heavy MG,
  autocannon, tank gun, thermobaric, ATGM, ...) get a `fire` event; shared
  `impact` and `explosion` families by size, material and damage type.
* **Movement:** one discrete acceleration sound per unit
  (`move.<typeId>.start`, locomotor fallback), not a continuous engine loop.
  Zero Hour has no footstep events; surface footsteps are original phase-3
  content.
* **Buildings:** place, under-construction loop (with head/tail), complete,
  damage on every hit, heavy damage on the 50 % crossing, critical damage on the
  25 % crossing, death. Vehicles get their damaged-state sound on the 50 %
  crossing. Production-ready/EVA lines carry the production state; military
  buildings stay silent in Zero Hour (`SoundAmbient = NoSound`), so there is no
  invented factory hum.
* **Ambient:** climate beds, `ambient` bus, one loop at a time (Zero Hour
  allowed up to two): cold wind with `?weather=snow`, temperate meadow
  otherwise; `?weather=none` silences it. New climates extend
  `ambientEventFor`.
* **UI:** click on menu/command buttons, error on illegal placement or a
  disabled/underfunded offer, cash tick on credit changes, and the radar
  warning on a base attack. Hover/minimap ping need UI surfaces this client
  does not have yet. **Music:** menu, calm, combat, victory and defeat;
  combat switches by recent damage and holds for `combatHoldMs`; crossfade
  `fadeMs` (2 s default).

## 12. File formats and budget

* Format: Opus in WebM (`.webm`) only; there is no second shipping format.
  Mono 24-32 kbps for voices, mono 48-64 kbps for SFX, stereo 96 kbps for
  music and long ambient loops. Chrome, Firefox and Safari decode it with
  `decodeAudioData`; verified by hand on Safari 26 (macOS 26.6, 2026-10-26).
  Minimum: Safari/iOS 17.4 (2024). Keep playback on `decodeAudioData`: Safari's
  `<audio>` path is the one with OS-dependent gaps. AAC `.m4a` is rejected:
  1.5-2x the bitrate for the same quality, a patent pool, and worse gapless
  loops. OAC, AOMedia's announced Opus successor, is pre-spec and unsupported;
  revisit it only when it has a specification and native browser decoding.
* Short SFX and loops are decoded once into `AudioBuffer`s (Zero Hour kept 4 MB
  of samples cached; our decoded budget is 64 MB, LRU, and the encoded budget is
  below). Phase 1 decodes music into an `AudioBuffer` too; phase 4 may switch to
  a `MediaElementAudioSourceNode` if the streaming budget needs it.
* The packer reads reference WAVs, many of them 4-bit IMA ADPCM
  (`WAVE_FORMAT_IMA_ADPCM`, `0x0011`), and writes WebM. The loader still parses
  RIFF/WAVE and decodes IMA ADPCM mono and stereo blocks itself, honouring the
  `fact` sample count, plus 8/16-bit PCM (its tests cover both block layouts),
  but the dev server only serves the WebM pack. Unsupported formats still go
  through `decodeAudioData`, and a failed decode falls back to the procedural
  recipe.
* Download budget (gzip is useless on Opus): core pack (UI, combat SFX,
  shared) at most 4 MB; faction voices at most 3 MB per faction,
  lazy-loaded when a faction is picked; music at most 20 MB, streamed in the
  background; whole game audio under 35 MB. `check:audio` fails CI above these.
* Preloading: core pack on game load, weapons/units of both factions before the
  match starts, music after.

## 13. Assumptions

* The Zero Hour reference pack comes from the owner's own copy, stays on the
  owner's machine, is served only by the dev server and is never committed,
  built, deployed or used as generator input (§4.2). It is removed from the
  loader chain once phase 3 covers every event.
* Voices speak the faction's language (Ukrainian, Russian) with strong
  language; a "Strong language" setting, on by default, switches to clean
  variants. Subtitles are optional and translated through i18n. While the local
  reference pack is active, the same events play Zero Hour's English USA set
  for Ukraine and China set for Russia; phase 3 swaps in our Ukrainian/Russian
  recordings without changing the event mapping or the rules.
* `underFire` and `die` voices are positional world sounds heard by their
  owner only, on screen only; `select/move/attack` as in Zero Hour (UI,
  owner only, group leader speaks).
* Library and generated audio is acceptable under D-02 if its licence allows
  redistribution under CC BY-SA 4.0; sources are chosen per §4.3 and recorded
  in the manifest. Model downloads need the owner's approval each time.
* Music is generated instrumentals (no sung voices, no sound-alike of EA's
  themes).
* The sim and `crates/sim` are untouched; any output-only snapshot additions are
  reviewed in their phase PR.

## 14. Verification plan (per phase)

* Phase 1: unit tests of admission rules (limit, voice rule, priority stealing,
  EVA queue cooldown/expiry), pan/distance/zoom gain curves, `distanceLowPassHz`
  leaving events without `lowPass` open, native IMA ADPCM/PCM WAV decoding
  (mono, stereo, `fact`), reference/`NoSound` resolution, loop head/tail
  resolution, faction mapping (Ukraine -> USA, Russia -> China, unit and EVA),
  music calm/combat/victory hysteresis, ambient selection, construction-loop
  derivation and building damage, and the BIG reader (on a tiny synthetic
  archive, not EA data) with a fake clock; `check:audio` guard that nothing
  under `.local/audio-ref/` is tracked or built; example saves `audio-fight`
  and `construction` (mixed units/combat and an under-construction site); owner
  listens with the reference pack on `?audio=debug` (event list with play
  buttons, live voice count, rejected/culled sounds).
* Phase 2: `check:audio` validates that every event in `events.yaml` has an
  inventory entry with a brief and that every line has an `explicit` flag and
  each event a clean variant.
* Phase 3: `check:audio` (schema, files exist, budgets, manifest, licence per
  file); owner A/B listens our takes against the reference (visual-iteration
  rule: tests after approval).
* Phase 4: subtitle smoke test (a translated line resolves, falls back to
  `en`); strong-language toggle excludes explicit variants.

## 15. Extending the clone

The behavior is data-driven and documented for future contributors:

* Source comments next to every trigger (`derive.ts`, `mixer.ts`, `loader.ts`,
  `catalog.ts`, `skirmish.ts`) state what the hook does and which file owns the
  new content.
* `docs/audio-extension.md` is the checklist for adding a weapon, unit,
  building, faction, EVA/UI event, ambient bed or sample loop, including a
  prompt template for an AI contributor.
* Rules that must not be broken: ids follow §5.2; the reference mapping stays
  names-only and local; a new side gets unit voices, EVA and music mappings;
  loops are samples with `attackSounds`/`decaySounds`, never live oscillators;
  content is original under D-02, behavior is cloned.

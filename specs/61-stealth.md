# 61 — Stealth and detection

Status: built. Depends on `00-vision.md` (fog), `03-phase2-core-loop.md`
(§5.4 vision, §5.11 combat, §5.15 snapshot), `19-save-games.md`.
Decisions: D-02 (deterministic fixed point), D-05 (balance is data).

## 1. Goal

Some units are hidden from the enemy until they fire or an enemy detector is
near. The enemy cannot see, target or auto-acquire a hidden unit; the owner
sees it semi-transparent. Detectors reveal what is around them.

## 2. Precedent (`generals-precedent`, Zero Hour)

`StealthUpdate` re-checks every frame whether the unit may stealth. Losing
stealth is immediate (firing, and moving or taking damage when the module's
`StealthForbiddenConditions` say so); regaining it waits `StealthDelay` after
the last failed check. `StealthDetectorUpdate` scans every `DetectionRate`
frames within `DetectionRange` and marks each enemy stealthed unit as detected
for `DetectionRate + 1` frames, so the reveal lasts one scan period. An
undetected stealthed unit cannot be attacked, captured or auto-acquired
(`WeaponSet::getAbleToAttackSpecificObject`), and an idle stealthed unit does
not auto-acquire. Detectors do nothing while under construction or contained.
Copied: all of the above. Zero Hour's per-unit faction roster (shipped INI)
could not be read; the roster in §5.3 is an assumption.

## 3. Data

On a unit type in `data/factions/*.yaml` (numbers in data, D-05):

* `stealth: { delayTicks, breaksOnMove }`: exposed for `delayTicks` after a
  shot or a hit, and while moving when `breaksOnMove`.
* `detector: { rangeCenti, rateTicks }`.

## 4. Sim (`crates/sim/src/stealth.rs`)

`Entity.exposed` counts ticks down; saved (omitted at 0) and hashed.

1. A type with `stealth` is *stealthed* while `exposed == 0`.
2. Firing (weapon or trench sidearm) and being hit set `exposed` to at least
   `delayTicks`; each tick it falls by one. A unit with `breaksOnMove` and a
   non-idle order is held exposed.
3. Stealth phase (after vision, before combat): a detector scans when
   `(tick + id) % rateTicks == 0` (no RNG: the phase is the id), and sets
   `exposed` of every other-owner stealth unit within `rangeCenti` to at least
   `rateTicks + 1`. Detectors under construction, dead or neutral do nothing.
4. `is_entity_visible` is false for a stealthed unit for every other player
   (the observer sees everything). That hides it from the snapshot, the AI and
   auto-targeting. `is_valid_target` also refuses it, so an ordered attack
   cannot hit what nobody sees.
5. `FLAG_STEALTHED` (4096) is set on a hidden unit; only its owner receives it.

## 5. Client

The owner's hidden units render at reduced opacity. Enemy units that are not
detected are simply absent from the snapshot.

### 5.3 Roster

| Faction | Stealth (ambush AT team) | Detector (recon vehicle) |
| --- | --- | --- |
| usa | us-javelin-team | us-humvee |
| china | cn-hj-team | cn-mengshi |
| russia | ru-rpg-gunner | ru-brdm-scout |
| ukraine | ua-stugna-team | ua-kozak-scout |

Stealth: `delayTicks 45` (3 s at 15 ticks/s), `breaksOnMove true`. Detector:
`rangeCenti 1000`, `rateTicks 15`.

## 6. Acceptance criteria

* AC-61-01: an undetected stealth unit is invisible to the enemy and visible
  to its owner and the observer.
* AC-61-02: an enemy does not auto-target a hidden unit, and an ordered attack
  on it is refused.
* AC-61-03: firing exposes the unit for `delayTicks`, then it hides again.
* AC-61-04: with `breaksOnMove`, a moving unit is exposed and hides after it
  stops and `delayTicks` pass.
* AC-61-05: a detector in range exposes it; out of range it does not.
* AC-61-06: `exposed` survives a save round trip and changes the state hash.
* AC-61-07: the owner's snapshot row carries `FLAG_STEALTHED`; the enemy's
  snapshot lists no hidden unit.
* AC-61-08: the example save `stealth` loads (AC-19-14).

## 7. Assumptions

* A detector exposes a stealth unit for every other player at once (no
  per-player detection state); fine for 1v1 and free-for-all.
* Hidden units still see (sight is unchanged) and a hit exposes them.
* No upgrade, building or aircraft is stealthed or a detector in this first
  roster; stealth also ignores terrain such as forests.
* An idle stealth team fires at enemies in range from hiding (it does not
  hold fire like Zero Hour's default idle stealth unit); the shot exposes it.
  The client draws an own hidden unit as the translucent silhouette mesh.
* Garrisoned or transported units keep Zero Hour's contained rules and are not
  given stealth.

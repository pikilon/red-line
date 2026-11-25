# 57 — Capturable neutral tech buildings

Status: built (issue #475). Amends `26-map-features-plan.md` (section 6.3, tech
buildings) and `48-unit-help.md` section 6 (listed as missing).
Decisions: D-02 (deterministic fixed point), D-05 (balance in data).

## 1. Goal

A map can hold neutral buildings that belong to nobody. Infantry of any player walk
up to one and **capture** it; from then on it belongs to that player, pays or heals
for them, and an enemy can take it back. The first version has two kinds:

* **Oil derrick**: pays credits at a fixed interval to its owner.
* **Field hospital**: heals the owner's infantry standing near it.

## 2. Precedent (`generals-precedent`, Zero Hour)

Source: `electronicarts/CnC_Generals_Zero_Hour@0a05454d8` (note of the agent; the INI
numbers were not readable, so every number in section 3 is an assumption).

* Only the infantry capture special takes a building: the target must be a structure
  flagged `CAPTURABLE`, not under construction and not already an ally's
  (`ActionManager.cpp:995-1100`, `canCaptureBuilding`). Entering is not a route: a
  tech building has no contain module (`ActionManager.cpp:526`).
* Capture is timed: the unit counts down the special's preparation frames beside the
  building, then the building defects to the capturer's team
  (`SpecialAbilityUpdate.cpp:1199-1258, 1426-1476`). A building held by the enemy
  can be captured again.
* A neutral derrick pays nothing; an owned one deposits `DepositAmount` every
  `DepositTiming` frames and pays `InitialCaptureBonus` once
  (`AutoDepositUpdate.cpp:120-216`).
* The hospital is an `AutoHealBehavior`: it heals friendly infantry in a radius at
  intervals while it is owned (`AutoHealBehavior.cpp:245-325`).
* "Artillery platform" and "reinforcement pad" have no engine class (INI templates);
  they are out of scope here (section 7).

## 3. Rules

A feature type with a `tech` block (`data/features/buildings.yaml`) is a tech
building. Its owner is stored on the map feature row (so it is hashed, saved and
shown in the feature table) and starts neutral.

* **Who captures**: free infantry (foot units, not inside a building or vehicle) of a
  player that does not own the building yet. Vehicles and the player's own infantry
  cannot.
* **Command**: `capture { units, feature }`. The units walk beside the building and
  work for `captureTicks`. The first unit to finish changes the owner to its player,
  pays the one-time `captureBonus` of the income block (if any) and goes idle; the
  other capturers of that player then stop. Enemy capturers keep working until the
  owner changes under them.
* **Income**: while owned, every `everyTicks` ticks the owner gets `amount` credits.
  Neutral: nothing.
* **Heal**: while owned, every `everyTicks` ticks each infantry unit of the owner
  within `radiusCenti` of the footprint edge regains `amount` hit points (up to its
  maximum). Enemies and vehicles are not healed.
* A destroyed tech building (rubble) stops working; it keeps no owner.
* **AI**: each pass, the AI sends the nearest idle infantry unit of its pool within
  40 tiles to capture each tech building it does not own, one unit per building.

| Type | Footprint | captureTicks | Effect |
|---|---|---|---|
| `oil-derrick` | 2x2 | 75 (5 s) | 100 credits / 150 ticks (10 s), 500 on capture |
| `field-hospital` | 3x2 | 75 (5 s) | 5 hp / 15 ticks (5 hp per second), radius 6 tiles |

## 4. Client

* Left or right click on a tech building with infantry selected sends them to capture
  it (the same context click as garrison). A pip above the building shows its owner's
  colour once owned, and a faint pip marks it as capturable while infantry are
  selected.
* Models are procedural (`oil-derrick`, `field-hospital` in the civil builders).

## 5. Data

* `data/features/buildings.yaml`: types `oil-derrick`, `field-hospital` with the
  `tech` block (schema `features.schema.json`).
* `data/maps/demo-town.yaml`: two derricks and a hospital north of the main street.
* Example save `tech-capture` (`?load=tech-capture`): Ukrainian infantry capture the
  west derrick and the hospital, two wounded riflemen heal next to it, and the
  Russian AI goes for the east derrick.

## 6. Assumptions

* A1. All numbers in section 3 are balance guesses (Zero Hour INI unreadable) and
  live in data.
* A2. Any infantry captures (Zero Hour restricts the special to some units; there is
  no per-unit data yet).
* A3. Garrisoning a tech building is not possible; a building cannot be defended from
  inside. Capturing is not blocked by enemy units nearby.
* A4. Allies share nothing: only the owner player benefits (there are no teams yet).
* A5. `first-line` stays without features (its tests rely on being a legacy map).

## 7. Acceptance criteria

* AC-57-01: infantry capture a neutral building after `captureTicks` and the owner
  gets the capture bonus.
* AC-57-02: an owned building pays its income; a neutral one pays nothing.
* AC-57-03: an owned hospital heals the owner's infantry in range, nobody else.
* AC-57-04: an enemy can recapture an owned building; the owner's own infantry have
  nothing to capture.
* AC-57-05: only the unit's owner can order the capture.
* AC-57-06: the owner survives save and load and changes the state hash.
* AC-57-07: the AI sends one idle infantry unit per uncaptured building.

Deferred: artillery platform, reinforcement pad and other tech kinds; capture time
per unit type; capture by engineers only; garrison-and-defend; capture sound and
flash; a place on the full skirmish maps and the campaign.

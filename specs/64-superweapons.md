# 64 — Superweapons

Status: built (first version). Depends on `63-generals-powers.md` (the power
catalogue, recharge timers, cast command and HUD targeting). Issue #477.
Decisions: D-02 (the sim owns the rules; the client sends commands), D-14
(each faction gets its own version, the effect is shared).

## 1. Goal

Each faction can build one superweapon. Once finished it charges for a long
time, the countdown is visible to every player, and when it is ready its owner
fires it at a point of the map for heavy area damage.

## 2. Precedent (`generals-precedent`, Zero Hour)

* The countdown is the player's, not the building's: the ready frame lives in
  the `Player` for a shared power (`Player.cpp` `getOrStartSpecialPowerReadyFrame`,
  `resetOrStartSpecialPowerReadyFrame`). Firing sets it to now plus the reload
  (`SpecialPowerModule.cpp` `startPowerRecharge`, `triggerSpecialPower`).
* A newly built or rebuilt silo does not restart a shared timer; destroying a
  building removes only its UI entry and does not clear the player's ready
  frame (`SpecialPowerModule.cpp` constructor, `onSpecialPowerCreation`,
  destructor).
* The Particle Cannon aborts an active beam when its building is underpowered
  (`ParticleUplinkCannonUpdate.cpp`); the recharge was set at launch.
* The launch is announced with an EVA line chosen by relationship (own, ally,
  enemy) (`SpecialPowerModule.cpp` `triggerSpecialPower`); the detection line
  fires when the structure completes (`Player.cpp`).
* Particle Cannon damage is applied in pulses over the beam's life within a
  radius of the target (`ParticleUplinkCannonUpdate.cpp`).
* Not verified: build requirements, costs, reload times and radii (the INI
  files were not readable), and whether other players see the public timer
  (`InGameUI.cpp`).

Copied: shared per-player timer that survives losing or rebuilding the
building, recharge from the firing tick, a three-way announcement (own, other,
and the "building finished" notice). Deviations: see §8.

## 3. Rules

`general.powers` entries with a `building` (a building type id) are
superweapons. They are never bought and cost 0 points; the `effect` is a
`barrage` (spec 63 §4) with heavy numbers.

| Faction | Building | Requires | Cost | Effect (blasts × damage, splash) |
| --- | --- | --- | --- | --- |
| USA | `us-strike-battery` (Strike missile battery) | `us-firebase` | 5000 | 8 × 350 HE, 4.5 tiles |
| Russia | `ru-oreshnik-launcher` (Oreshnik launcher) | `ru-airfield` | 5500 | 5 × 600 thermobaric, 6 tiles |
| Ukraine | `ua-atacms-battery` (Long-range strike battery) | `ua-missile-site` | 5000 | 10 × 300 HE, 4 tiles |
| China | `cn-rocket-salvo-park` (Rocket salvo park) | `cn-vehicle-factory` | 5000 | 12 × 250 HE, 3.5 tiles over a 6 tile spread |

* The building takes 900 ticks (60 s) to build and draws 10 power.
* **One per player:** `can_construct` refuses the type while the player owns
  any entity of it, foundations included.
* **Charging:** when the player's first finished, living building of the type
  exists, the sim grants the power with `ready_tick = tick + rechargeTicks`
  (5400 ticks, 6 minutes). The owned power belongs to the player: losing the
  building does not clear it and a rebuild does not reset it.
* **Low power halts it:** every tick the player consumes more power than it
  produces, a pending `ready_tick` moves one tick later. A ready (or charged)
  superweapon cannot fire while the power is low.
* **Firing:** `CastPower { power, target }` (spec 63) needs the power ready, a
  finished living building of the type, enough power and a target on the map.
  The blasts land at once, scattered over the spread disc by the stateless
  `SplitMix64` draw of spec 63 §4; enemy ground entities (buildings included)
  within the splash are hurt, own units and flyers are spared. Then
  `ready_tick = tick + rechargeTicks`.

## 4. State, hash, saves, snapshot

No new state: the countdown is an owned power (spec 63 §5), hashed, saved and
written to the public snapshot tail for every player. The setup of an example
save may give `powers: [[{ id, readyTick }]]` per start to start with a
charged timer.

## 5. Interface

* A strip at the top centre, `#superweapons`, lists one row per countdown of
  every player: `You: Missile strike in 5:42` or `Player 2: Ballistic strike
  ready`. A ready row of the player's own shows a **Fire** button that arms the
  crosshair of spec 63 §6 (left click casts, Escape or right click cancels).
* A toast tells everybody when a superweapon is finished and when one is fired
  (text only; there is no EVA voice line yet).
* Superweapons are not in the General's powers panel.

## 6. AI

The AI never builds a superweapon (it is not in its build orders) and so never
fires one.

## 7. Models

The four buildings reuse the model of a neighbouring building under their own
id (`us-firebase`, `ru-geran-site`, `ua-missile-site`, `cn-gattling-nest`).

## 8. Assumptions

* The numbers in §3 are plausible, not copied from Zero Hour (not readable).
* The strike lands instantly; there is no flight time, beam or pulses over
  time (Zero Hour's Particle Cannon pulses over its beam). The blasts reuse the
  spec 63 barrage.
* Zero Hour does not pause a shared timer when a building is underpowered; the
  owner's request makes low power halt the countdown here.
* No EVA voice lines: toasts only. Zero Hour also tells allies and enemies
  apart; here everyone sees the same toast.
* The skirmish option to limit or disable superweapons is not built in this
  version; every faction may build its one.
* Kills made by a superweapon award no skill points (as spec 63 §7).
* Faction picks are Red Line's own: a missile battery, an Oreshnik-like
  launcher, a long-range strike battery and a rocket salvo park.

## 9. Acceptance criteria

* AC-64-01: a finished superweapon building starts the player's countdown; a
  foundation does not; the power cannot be bought.
* AC-64-02: a player may own only one of each superweapon.
* AC-64-03: firing hits enemy ground entities in the area hard, spares own
  units and the far field, and restarts the countdown; it does nothing before
  the countdown ends.
* AC-64-04: low power halts the countdown and blocks firing.
* AC-64-05: losing the building keeps the timer; a rebuild does not reset it.
* AC-64-06: the countdown is hashed, saved, deterministic and in every
  player's snapshot.
* AC-64-07: the example save `superweapons` starts with a charged battery that
  fires at the Russian column.
* AC-64-08: the client lists every player's countdowns, keeps superweapons out
  of the buy list and reports a finished building and a launch (vitest).

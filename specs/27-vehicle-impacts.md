# 27 — Vehicle impacts, damage and deaths

Status: implemented; owner asked 2026-10-25 for vehicles to get what infantry
got in specs 21 and 22: bullets that spark off the armour, hulls that rock
when hit, smoke when damaged and fire when badly damaged, and deaths that are
not always the same (the turret of a Russian tank flies off, a big explosion,
a hulk that burns out).
Depends on `07-phase4b-combat-effects.md` (death detection; the wreck box this
replaces for vehicles), `22-infantry-deaths.md` §2 (cause of a hit),
`11-phase4e-locomotor-and-turret-aim.md` (suspension). Decisions: D-05 (2.5D).
Nothing changes in the simulation, the snapshot or the data: everything is
client-side and lives in `client/src/render/vehicleDeaths.ts` (rules) and
`vehicleFx.ts` (particles), apart from the ground effects of `effects.ts`.

## 1. Precedent (Zero Hour)

Source: `generals-precedent` note of 2026-10-25 (`SlowDeathBehavior.cpp`
182-191, 436-520; `ChinaVehicle.ini` BattleMaster and Overlord blocks;
`AmericaVehicle.ini` Crusader; `ObjectCreationList.ini` OCL_CrusaderTurret,
OCL_ChinaTankBattleMasterDebris; `Hulk.ini` BattleMasterDeadHull,
DeadCrusaderHulk; `DamageFX.ini` TankDamageFX; `FXList.ini`
FX_DamageTankStruckSmallArms; `ActiveBody.cpp` 105-125).

* **Death variants.** One `SlowDeathBehavior` is picked per death by a
  weighted roll (`ProbabilityModifier`). The Crusader has two at 50/50: (a)
  an explosion whose final phase throws the turret as debris
  (`OCL_CrusaderTurret`: force 100–150, pitch 85–90°, spin) and leaves a hulk;
  (b) "catch fire": the tank burns (`FX_CrusaderCatchFire`) for 2000 ± 300 ms,
  then explodes. BattleMaster and Overlord throw hull pieces and parts of the
  turret (`CreateDebris`, `SEND_IT_FLYING`) and leave a dead hull.
* **Hulks** smoke (`SmokeSmallContinuous01`), sink after 14 s at 2 world
  units/s (0.2 tiles/s) and are removed at 20 s; they do not fade.
* **Damage states**: damaged under 50 % hp, really damaged under 10 %
  (`UnitDamagedThreshold`/`UnitReallyDamagedThreshold`); the tanks show smoke
  and a damaged model only when really damaged.
* **Armour hits**: small arms on a tank play `FX_DamageTankStruckSmallArms`:
  sparks, a small ricochet puff and a 500 ms light pulse.
* **Rocking**: none on hits; only shockwave weapons (`applyShock`) push a
  vehicle.

## 2. Hits that do not kill (`detectVehicleHits`, `kickOf`, `rockAt`)

A vehicle that lost hp between two snapshots and lives is hit. The cause of
spec 22 §2 tells a bullet or cannon round (`smallArms`, `autocannon`: a
**shot**) from a shell or missile (`antiTank`, `highExplosive`,
`thermobaric`: an **explosion**) and the direction the hit pushes (away from
the shooter or the blast).

* **Sparks** (`detectRicochets`) come from every bullet or cannon round fired
  at a vehicle in a snapshot, whether or not it hurts (small arms do 25 % to
  `armored` in `data/`, so a rifle chips a tank and still ricochets, as in
  Zero Hour): a shot
  throws 3–6 sparks (thin bright streaks, 120–320 ms, on a
  ballistic arc) from the side of the hull facing the shooter, back toward
  the shooter's side, with a tiny flash and a small grey ricochet puff. An
  explosion throws ten sparks, a flash, two flames, three dark puffs and two
  small chunks.
* **Rock**: the hull tips away from the hit on its suspension, swings back
  once and settles: `amplitude · sin(2π · 2.2 Hz · t) · e^(−t / 0.22 s)`,
  split into pitch and roll by where the push comes from (from the front the
  nose rises, from the side it rolls). A shot rocks 0.008 rad plus a quarter
  of the hp share it took (at most 0.03); an explosion 0.05 rad plus 0.4 × the
  share (at most 0.14) and a 0.025-tile hop. Kicks add up (capped at 0.16
  rad) and are forgotten after 1.2 s.

## 3. Damage states (`damageState`)

* Under **50 %** hp a vehicle trails light grey smoke from its engine deck
  (the back third of the hull), 4 puffs/s.
* Under **25 %** (the red health bar) the smoke turns black (8/s) and the
  engine deck burns (7 flames/s).

## 4. Deaths (`deathVariant`, `hulkPose`, `hulkRates`)

A destroyed vehicle no longer leaves the flat wreck box of spec 07: its own
model stays as a **hulk**, charred (the instance colour darkens to `#857a70`,
the livery too), in the pose of its death. The variant is a weighted roll on
a hash of the unit id (`unitHash`), so the same unit always dies the same way;
nothing comes from `Math.random`.

| Vehicle | Cook-off (turret toss) | Blast | Burn-out |
| --- | --- | --- | --- |
| Russian, tracked with a turret (T-72B3, BMP-2, TOS-1A) | 45 | 30 | 25 |
| Other tracked with a turret (Leopard 2A4, Bradley) | 20 | 40 | 40 |
| Wheeled, launcher or blade (BRDM, Kozak, HIMARS, trucks, dozers) | 0 | 50 | 50 |

* **Cook-off**: a flash and dark smoke; 250 ms later the ammunition blows
  the turret off: it flies up (3.8–5.2 tiles/s, gravity 7 tiles/s²) and away
  (0.7–1.4 tiles/s, around the push), tumbling 5–10 rad/s, bounces once and
  comes to rest on its ring or upside down (45 %) about a tile or two away.
  A jet of flame roars out of the turret ring for about 1.4 s; the hull burns
  hardest of the three (18 flames/s, dying down from 8 s to 14 s) under a
  black smoke column; the turret on the ground smokes lightly.
* **Blast**: a big fireball (2.6 tiles), sixteen flames, twenty sparks,
  twelve chunks that fall and lie; the whole hull hops (1.4–1.9 tiles/s up),
  slides 0.25 tiles along the push and lands with a slight tilt, its turret
  slewed. It then burns (14/s, dying down from 5 s to 12 s) and smokes.
* **Burn-out**: the vehicle catches fire and chars over 2 s while its flames
  grow (4 → 20/s) and its smoke thickens, then it explodes (a flash, ten
  flames, six chunks) and hops slightly; the husk burns lower and fades out
  (12/s, dying down from 4 s to 11 s) under a smoke column.
* Every hulk smokes until 15–18 s, sinks from 14 s at 0.2 tiles/s and is
  removed at 20 s (Zero Hour's dead hull).

## 5. Difference from Zero Hour

* Zero Hour does not rock vehicles on hits; the owner asked for it, so hits
  rock the hull (§2), lightly for bullets.
* Zero Hour shows damage only at 10 % hp; here smoke starts at 50 % and fire
  at 25 % (owner: "smoke when damaged, fire when heavily damaged"), the
  thresholds of the health bar colours.
* Zero Hour hulks only smoke; here they burn first (owner: "burning wreck").
* Only the turret is thrown (no separate hull pieces); chunks stand for the
  rest of the debris.

## 6. Assumptions

* Russian tanks throw their turret most often (the carousel autoloader of the
  T-72 family); a Western tank can too, rarely.
* Particle looks (spark spread, puff sizes) use a seeded generator of the
  renderer, never gameplay; the variant and the hulk motion only use the id
  hash, so they replay identically.
* The hit cause comes from the shots seen in the last 5 s (spec 22 §2): a
  vehicle hit from the fog rocks as if pushed back along its heading.
* Example save `vehicle-deaths` (`?load=vehicle-deaths`): Leopards, a
  Bradley and Kozaks against T-72s, a BMP-2, a BRDM and a truck, with three
  riflemen whose bullets spark off the armour.

## 7. Acceptance criteria

* AC-27-01: `deathVariant` is stable per id and its share over many ids
  follows the table (≈ 45 % cook-offs for a T-72, ≈ 20 % for a Leopard, none
  for a truck).
* AC-27-02: `damageState` is pristine over 50 %, damaged over 25 %, burning
  at or under 25 %.
* AC-27-03: `detectVehicleHits` reports vehicles that lost hp and lived with
  the kind of the cause and the share lost, and skips infantry;
  `detectRicochets` reports a rifle fired at a tank, pushed away from the
  shooter, whether or not that round hurts it.
* AC-27-04: an explosion kicks harder than a bullet; a push along the hull
  pitches it (nose down when pushed from behind) without rolling, a push from
  the side rolls it, and the rock is gone after 1.2 s.
* AC-27-05: a cook-off keeps the turret on until 250 ms, throws it above 0.8
  tiles, and lands it 0.6–3 tiles away on the ground; the hulk is charred.
* AC-27-06: a blast lifts the hull and lands it; a burn-out chars gradually,
  stays down until 2 s, hops after, and its fire grows before the explosion;
  only a cook-off has a flame jet.
* AC-27-07: every hulk burns, stops burning by 14 s, smokes at 10 s and not at
  19 s, stays level until 14 s and has sunk over 0.5 tiles by 20 s.
* AC-27-08: the renderer keeps a hulk for 20 s and emits fire and smoke for
  it; a damaged vehicle smokes and a pristine one does not; a bullet hit makes
  sparks and rocks the hull.

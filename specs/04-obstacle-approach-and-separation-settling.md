# 04 — Obstacle Approach and Separation Settling

Status: proposed for review. Depends on `00-vision.md`, `01-architecture.md`,
`02-phase1-tech-slice.md`, and `03-phase2-core-loop.md`. Follows C&C Generals / Zero
Hour reference implementation (`docs/decisions.md` D-02). Roadmap: Phase 1 & 2
bugfix and movement refinement.

Amended 2026-10-10 (owner decision on the #108 escalation): spreading applies
only to impassable targets, the search order is the Chebyshev ring scan of
`nearest_passable()`, ties and centroid arithmetic are exact, and AC-04-02 is a
contention test. AC-04-03 uses a passable crowd, because spreading alone
already settles the `Block A` case. §2 describes the reference; §3–§6 are normative and win where
they differ from it.


Amended 2026-10-24 (owner decision, overlapping armor): spreading now applies to
every move of two or more units, not only to impassable targets. Each unit
claims its own cell (ring search around the click, nearest unit first), so a
group gathers around the click and never shares one destination. A single unit
still goes to the exact point. Impassable targets keep the centroid offsets.
Assumption: Zero Hour keeps the units' relative layout (clamped to 6 x radius)
and only gathers when the click is inside the selection; the owner asked for the
gather every time, so that is what is implemented.

---

## 1. Context and Problem Statement

When a player selects a group of units and right-clicks inside an impassable
building or terrain obstacle, two defects occur:

1. **Perimeter Bottlenecking ("cubes gather around the building"):**
   Under Phase 1 spec §4.6 (AC-02-12), when `target` is in an impassable cell,
   `World::apply_move` remaps the target using `nav.nearest_passable(cell)`.
   Because `nearest_passable()` scans Chebyshev rings in row-major order ($y$
   ascending, then $x$ ascending), every click inside an obstacle block resolves
   to the exact same single boundary cell (e.g. `(29, 29)` for `Block A`).
   All commanded units (up to 500) are assigned that identical $1 \times 1$
   destination, collapsing the entire group into a single bottleneck regardless
   of where the units originated.

2. **Perpetual Oscillation and Jitter ("cubes never stop moving"):**
   Under Phase 1 spec §4.6, `separate_units()` runs unconditionally on all units
   every tick, including `Order::Idle` units. The repulsion displacement is
   undamped:
   $$\text{term} = \text{offset.normalize()} \cdot \frac{\text{SEPARATION\_DISTANCE} - d}{2}$$
   When hundreds of units are compressed against an impassable boundary, pushes
   into blocked cells are rejected per-axis, deflecting units along obstacle
   walls. Units push each other back and forth in an undamped harmonic loop.
   In automated testing, over 200 units continue changing position on every tick
   even 2,000 ticks (~100 seconds) after arrival.

---

## 2. Reference: How C&C Generals / Zero Hour Solves This

In the original EA source code for *Command & Conquer: Generals – Zero Hour*
(`GeneralsMD/Code/GameEngine/Source/GameLogic/AI/`):

### 2.1 Group Destination Distribution (`AIGroup.cpp`)
In `AIGroup::groupMoveToPosition`:
* **Near-to-Far Sorting:** Units in the moving group are sorted near-to-far
  relative to the target destination (`iter->sort(ITER_SORTED_NEAR_TO_FAR)`):
  > *"Works better if you let the near units get the first paths... Move the ones
  > nearest the goal first. Reduces collision problems later."* (`AIGroup.cpp:188`)
* **Centroid Offset Preservation (`computeIndividualDestination`):**
  Each unit computes its displacement vector from the group centroid
  $\mathbf{v} = \mathbf{pos} - \mathbf{center}$ (clamped to a max bounding radius).
  The unit's initial target is set to the group target plus this offset:
  $\mathbf{dest} = \mathbf{groupDest} + \mathbf{v}$.
  This preserves the spatial distribution of the swarm rather than collapsing it
  to a single point.

### 2.2 Spiral Search and Goal Cell Reservation (`AIPathfind.cpp`)
In `Pathfinder::adjustDestination`:
* When a unit's computed destination is inside an obstacle (or already claimed),
  the engine conducts a square spiral search (`delta` stepping outward in 4 directions)
  around the candidate cell.
* At each candidate cell, `checkDestination` verifies:
  1. The cell is passable and not an obstacle.
  2. **The cell is not already claimed by another unit (`cell->getGoalUnit() == INVALID_ID`).**
* When a valid cell is found, the unit claims that cell (`updateGoal(obj, dest)`).
  Subsequent units in the same command iteration cannot claim that cell, ensuring
  **every unit receives a distinct, reachable arrival cell along the obstacle perimeter**.

### 2.3 Arrival Friction and Settling (`Locomotor.cpp`)
* Units approaching their individual destination have a `m_closeEnoughDist` arrival threshold.
* Once arrived at destination, units transition to idle and apply 2D friction (`m_extra2DFriction`),
  coming to a complete halt. Idle units do not exert continuous spring repulsion on each other.

---

## 3. Scope

### In:
* `crates/sim`:
  * **Group Destination Spreading (`adjust_destination`):**
    * Only when the target cell is impassable (the defect in §1). A move to a
      passable cell keeps the Phase 1 behaviour: one shared goal and one flow
      field (AC-02-16, AC-02-18 unchanged).
    * Sort commanded units near-to-far relative to the target.
    * For each unit, calculate initial candidate target from centroid offset:
      $\mathbf{dest} = \mathbf{target} + \text{clamp}(\mathbf{pos} - \mathbf{centroid}, R_{\max})$.
    * Ring search outward from the candidate cell to find the nearest passable,
      unclaimed cell on the grid.
    * Track claimed goal cells during `apply_move` so each unit gets a unique cell.
  * **Separation Settling & Damping:**
    * Add `SEPARATION_SETTLE_EPSILON`: when an `Idle` unit's net separation push
      magnitude is smaller than this threshold, round it to zero.
    * Idle-Idle damping: halve the mutual repulsion between two `Idle` units.
    * Complete rest state: once all units in a cluster are `Idle` and in equilibrium,
      position displacement ceases entirely ($0$ moving units).
  * **Flow Fields:**
    * Fields stay cached per goal cell (Phase 1 §4.5): units sharing a goal
      share its field, and each distinct goal cell computes its own field.
      Regional field sharing is out of scope.
* Automated regression tests in `crates/sim/tests/`.

### Out:
* Formations with designated unit facing (Phase 2 / Phase 3 feature).
* Vehicle turning radiuses / complex locomotor kinematics.
* Spreading for moves whose target cell is passable.
* Regional or hierarchical flow fields.

---

## 4. Constants

| Name | Value | Description | Location |
|---|---|---|---|
| `SEPARATION_DISTANCE` | `Fx::from_raw(32768)` (0.5 tile) | Collision repulsion radius | `crates/sim/src/world.rs` |
| `MAX_SEPARATION_PUSH` | `Fx::from_raw(6553)` (0.1 tile) | Maximum single-tick repulsion push | `crates/sim/src/world.rs` |
| `SEPARATION_SETTLE_EPSILON` | `Fx::from_raw(512)` (~0.0078 tile) | Displacement deadzone for idle units | `crates/sim/src/world.rs` |
| `MAX_CENTROID_OFFSET` | `Fx::from_raw(393216)` (6.0 tiles) | Maximum spread offset from centroid | `crates/sim/src/world.rs` |
| `ARRIVAL_CONTACT` | `Fx::from_raw(39321)` (0.6 tile) | Touch radius for contact arrival | `crates/sim/src/world.rs` |

---

## 5. Simulation Specification

### 5.1 Group Move Target Allocation (`apply_move`)

When `Command::Move { units, target }` is applied, `target` is first clamped to
the map as in Phase 1. Let `cell = cell_of(target)`.

* If `cell` is passable, the Phase 1 behaviour is unchanged: one goal `cell`,
  one shared `Order::Move { order_id, target, goal: cell }`.
* If no cell of the map is passable, the command is ignored (Phase 1).
* Otherwise the command consumes one `order_id` and allocates goals as below.

1. **Commanded set:** the distinct entities listed in `units` that exist, are
   owned by `player` and have `site.is_none()`, in ascending entity id order.
   Every other listed id is ignored. If the set is empty, nothing changes
   (the order id is still consumed).
2. **Centroid:** per axis, the sum of the raw positions (as `i64`) divided by
   the set size `N` with integer division (positions are non-negative, so this
   is a floor), converted back to `Fx`.
3. **Sort Near-to-Far:** ascending by the exact squared distance to `target`,
   `dx² + dy²` computed on raw values as `i64`; ties broken by ascending entity
   id.
4. **Allocate:** keep `claimed: BTreeSet<Cell>`, empty at the start of the
   command. For each unit in sorted order:
   * Offset, clamped per axis:
     $$\mathbf{offset} = (\text{clamp}(p_x - c_x, \pm R), \text{clamp}(p_y - c_y, \pm R)), \quad R = \text{MAX\_CENTROID\_OFFSET}$$
     $$\mathbf{candidate} = \text{cell\_of}(\text{clamp\_to\_map}(\mathbf{target} + \mathbf{offset}))$$
   * **Ring search (`adjust_destination`):** visit the cells at Chebyshev
     distance $\Delta = 0, 1, \dots, 20$ from `candidate`, each ring in the same
     row-major order as `MapGrid::nearest_passable()` ($y$ ascending, then $x$
     ascending; only the two side cells of each inner row). The first in-bounds
     cell that `is_passable()` and is not in `claimed` becomes `goal`.
   * **Fallback:** if no such cell exists within $\Delta \le 20$,
     `goal = nearest_passable(candidate)` (it may already be claimed).
   * Insert `goal` into `claimed`, ensure a flow field for `goal` exists, and
     set the unit's order to
     ```rust
     Order::Move {
         order_id,
         target: cell_center(goal),
         goal,
     }
     ```

A single unit has a zero offset, so its goal equals `nearest_passable(cell)`:
AC-02-12 is unchanged.

### 5.2 Separation Settling (`separate_units`)

In `World::separate_units()`:

1. **Pairwise Term:**
   For units $a$ and $b$ with $d < \text{SEPARATION\_DISTANCE}$:
   * If both $a$ and $b$ have `Order::Idle`, scale the repulsion term by $1/2$.
   * If at least one unit is `Order::Move`, apply the standard repulsion term.
2. **Settling Deadzone:**
   For unit $a$:
   * If unit $a$ has `Order::Idle` and $|\mathbf{push}| < \text{SEPARATION\_SETTLE\_EPSILON}$:
     $\mathbf{push} = \mathbf{0}$.
3. **Axis Wall Rejection:**
   Apply $\mathbf{push}$ per-axis against `nav.is_passable()`, exactly as in Phase 1.

### 5.3 Idle Allies Step Aside (`yield_to_movers`)

Amended 2026-10-24 (owner report: a tank sent across a parked group drove
through it). Reference, `electronicarts/CnC_Generals_Zero_Hour@0a05454d8`:
after each new path, a path crossing idle allies (`Path::blockedByAlly`,
`AIPathfind.cpp:L9067`) calls `Pathfinder::moveAllies`
(`AIPathfind.cpp:L10112-10185`). It asks every ally on the path to move away
when that ally is not moving, not attacking and not busy, unless both units
are infantry (infantry walk through each other). `getMoveAwayFromPath`
(`AIPathfind.cpp:L10195-10345`) sends the ally at least one cell, to the
nearest free cell whose box clears the mover's path by both radii.

Runs every tick before the move phase, in ascending entity index:

1. Each unit with `Order::Move` traces its path from its position:
   straight to `target` when inside `goal` or when `line_passable`,
   otherwise flow-field steps between cell centres. The path is cut after
   `YIELD_LOOKAHEAD` (3 tiles).
2. An ally is asked when all of these hold: same owner, a unit (`site` is
   `None`), `Order::Idle` with a `last_order_id` different from the mover's
   order (so the mover's own group still arrives by contact), no
   `last_target` (it is not firing), not infantry if the mover is infantry
   (`LocoKind::Foot`), and its centre lies closer than the sum of the two
   radii to a segment of that path (exact `i128` arithmetic).
3. Its new cell is searched in Chebyshev rings 1..=`YIELD_SEARCH_RING` (4)
   around its cell. A cell qualifies when it is in bounds and passable, holds
   no unit centre, is not the mover's `goal`, was not claimed by another
   yield this tick, can be reached in a straight passable line, its centre
   stays at least both radii away from the mover's path cut after
   `YIELD_CLEARANCE_LOOKAHEAD` (6 tiles), it is not on the mover's side of
   the ally (`dot(center - ally, mover - ally) <= 0`, so nobody backs into
   the mover), and the straight drive to it keeps both radii from every
   nearby unit except idle units of the same owner (those are asked to step
   aside in turn, since the yielder is now a mover). The first ring with any
   such cell wins; inside it the nearest centre wins, ties by `y`, then `x`.
4. The ally gets `Order::Move { order_id: fresh, target: cell_center(cell),
   goal: cell }` (a flow field is ensured) and becomes idle on arrival. With
   no qualifying cell it stays, and separation (§5.2) applies as before.

Deviations: Zero Hour runs `moveAllies` once per path over the whole path and
caps the chain of yields at depth 2. Red Line has flow fields instead of
stored paths, so it checks a bounded look-ahead every tick; a yielder is a
mover too, which lets the chain end naturally when no idle ally is left in a
short corridor. A* ally cost (+42 per cell) and repathing around stuck
blockers are out of scope. So are `Attack`, `Harvest` and `Build` approaches.

Local copy of the same source used on 2026-10-25:
`Core/GameEngine/Source/GameLogic/AI/AIPathfind.cpp` `moveAllies` L6379-6473,
`getMoveAwayFromPath` L6480-6650 (BFS to the first cell whose box, grown by
both radii, does not touch the path, at least one cell away).

### 5.4 Waiting Behind a Unit Making Way (`blocked_by_newer_mover`)

Amended 2026-10-25 (owner: units must never visibly pass through each other).
Reference: `AIUpdateInterface::processCollision`
(`GeneralsMD/Code/GameEngine/Source/GameLogic/Object/Update/AIUpdate.cpp`
L1440-1548 of the local copy): a moving unit blocked by the unit ahead slows
to `calculateMaxBlockedSpeed` and waits instead of driving through; a
deadlock is broken by `hasHigherPathPriority`.

In `step_move`, after the locomotor step from `from` to `to`, the step is
undone (position back to `from`, `speed = 0`; the heading change stays) when
some other unit `b` that is not a building:

* has an `Order::Move` whose `order_id` is greater than the stepping unit's
  (a yielder from §5.3 always has a newer id than the unit it makes way for),
* would be closer than both radii after the step, and closer than before it,
* and is not heading toward the stepping unit:
  `dot(b.target - b.pos, from - b.pos) <= 0`.

The unit then tries again next tick, so it drives on as soon as the way is
clear. Order ids only grow, so waits never form a cycle (this is Red Line's
path priority). Units of the same order (one group), idle units and older
orders are not waited for: separation (§5.2) and arrival by contact handle
them as before. The `Attack`, `Harvest` and `Build` approaches do not wait.

---

## 6. Acceptance Criteria

### AC-04-01: Group Move Destination Spreading (Generals Pattern)
**Given** `World::new(MapGrid::tech_slice())` with 10 units spawned at the cell
centres of $x \in 32..=36$, $y \in 25..=26$,<br>
**When** a `Command::Move` to the centre of cell $(34, 34)$ inside `Block A` is
applied by one step,<br>
**Then** every unit has an `Order::Move` whose `goal` is passable, and the 10
goal cells are pairwise distinct.

### AC-04-02: Near-to-Far Allocation Priority
**Given** `World::new(MapGrid::tech_slice())` with the far unit spawned first at
raw $(1753088, 2260992)$ = $(26.75, 34.5)$ and the near unit second at raw
$(1769472, 2260992)$ = $(27.0, 34.5)$ (centroid $x = 26.875$, offsets
$\mp 0.125$, so both candidates are cell $(34, 34)$),<br>
**When** both are commanded, listed far first, to move to raw
$(2260992, 2260992)$ = $(34.5, 34.5)$ and one step runs,<br>
**Then** the near unit's goal is $(38, 30)$, the first cell of the shared ring
search, and the far unit's goal is $(38, 31)$, the next unclaimed one.

### AC-04-03: Zero-Jitter Equilibrium Settling
**Given** `World::tech_slice(42, 300)` with all 300 units commanded on tick 0
to move to raw $(1343488, 1343488)$ = $(20.5, 20.5)$, a passable cell, so the
whole group shares one goal and crowds around it (without settling, 162 units
still move on tick 301),<br>
**When** 300 ticks elapse from the command execution,<br>
**Then** every unit has `Order::Idle`, and the count of units whose position changes
between tick 300 and tick 301 is exactly $0$.

### AC-04-04: Determinism and Parity Preservation
**Given** a tech-slice world with 100 units (seed 42 twice, seed 43 once)
commanded on tick 0 to move to raw $(2260992, 2260992)$ = $(34.5, 34.5)$ inside
`Block A`, so both spreading and settling run, for 400 ticks each,<br>
**When** the state hashes are compared,<br>
**Then** both seed-42 runs have the same `state_hash` and the seed-43 run
differs; the existing determinism and native/WASM parity tests
(AC-02-19, AC-02-20, AC-02-24) stay green unmodified.

### AC-04-05: Idle Allies Step Out of the Way
**Given** `World::new(MapGrid::open(32, 32))` with a unit at $(8.5, 10.5)$ and
15 idle allies at the cell centres of $x \in 14..=18$, $y \in 9..=11$,<br>
**When** the lone unit is ordered to $(24.5, 10.5)$ and 200 ticks run,<br>
**Then** it ends exactly on the target and never comes closer than 0.4 tile to
any ally (without §5.3 it drives through the block).

### AC-04-06: A Tank Crosses a Packed Idle Tank Group
**Given** the example save `tank-through-group` (spec 19 §7): one
`ua-leopard-2a4` ordered from $(28.5, 15.5)$ to $(44.5, 15.5)$ across 15 idle
`ua-leopard-2a4` one tile apart at $x \in 34.5..38.5$, $y \in 14.5..16.5$,<br>
**When** 900 ticks run,<br>
**Then** the lone tank is within 0.5 tile of its target and no two tanks are
ever closer than their two radii minus 0.02 tile (without §5.3–5.4 the mover
shoves through the block, down to 0.82 tile apart; tested in
`ac_19_14_tank_through_group`).

---

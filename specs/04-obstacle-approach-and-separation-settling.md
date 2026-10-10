# 04 — Obstacle Approach and Separation Settling

Status: proposed for review. Depends on `00-vision.md`, `01-architecture.md`,
`02-phase1-tech-slice.md`, and `03-phase2-core-loop.md`. Follows C&C Generals / Zero
Hour reference implementation (`docs/decisions.md` D-02). Roadmap: Phase 1 & 2
bugfix and movement refinement.

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
    * Sort commanded units near-to-far relative to the target.
    * For each unit, calculate initial candidate target from centroid offset:
      $\mathbf{dest} = \mathbf{target} + \text{clamp}(\mathbf{pos} - \mathbf{centroid}, R_{\max})$.
    * Spiral search outward from candidate cell to find the nearest passable,
      unclaimed cell on the grid.
    * Track claimed goal cells during `apply_move` so each unit gets a unique cell.
  * **Separation Settling & Damping:**
    * Add `SEPARATION_SETTLE_EPSILON`: when an `Idle` unit's net separation push
      magnitude is smaller than this threshold, round it to zero.
    * Idle-Idle damping: halve the mutual repulsion between two `Idle` units.
    * Complete rest state: once all units in a cluster are `Idle` and in equilibrium,
      position displacement ceases entirely ($0$ moving units).
  * **Flow Field Optimization:**
    * Units sharing the same destination cell reuse its flow field; units with
      different perimeter cells compute their respective field or share regional fields.
* Automated regression tests in `crates/sim/tests/`.

### Out:
* Formations with designated unit facing (Phase 2 / Phase 3 feature).
* Vehicle turning radiuses / complex locomotor kinematics.

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

When `Command::Move { units, target }` is applied:

1. **Calculate Centroid:**
   Compute the average position $\mathbf{centroid} = \frac{1}{N} \sum_{i=1}^N \mathbf{pos}_i$
   of the commanded units belonging to the player.
2. **Sort Near-to-Far:**
   Sort the list of unit indices in ascending order of their Euclidean distance
   to `target`: $(\mathbf{pos}_i - \mathbf{target}).\text{length}()$.
3. **Spiral Search for Unclaimed Passable Cells (`adjust_destination`):**
   Maintain a temporary set `claimed: BTreeSet<Cell>`. For each unit:
   * Compute initial candidate cell:
     $$\mathbf{offset} = \text{clamp}(\mathbf{pos}_i - \mathbf{centroid}, \text{MAX\_CENTROID\_OFFSET})$$
     $$\mathbf{dest} = \text{clamp\_to\_map}(\mathbf{target} + \mathbf{offset})$$
     $$\mathbf{candidate} = \text{cell\_of}(\mathbf{dest})$$
   * If $\mathbf{candidate}$ is passable and not in `claimed`:
     $\mathbf{goal} = \mathbf{candidate}$.
   * Else, execute a square spiral search outward from $\mathbf{candidate}$:
     $$\text{step } \Delta \in \{1, 2, \dots, 20\}$$
     Testing $(x + dx, y + dy)$ in order: right, down, left, up.
     The first cell that is `is_passable()` and not in `claimed` becomes $\mathbf{goal}$.
   * Insert $\mathbf{goal}$ into `claimed`.
   * Set unit's order:
     ```rust
     Order::Move {
         order_id,
         target: cell_center(goal),
         goal,
     }
     ```

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

---

## 6. Acceptance Criteria

### AC-04-01: Group Move Destination Spreading (Generals Pattern)
**Given** a tech-slice world with 10 units in a cluster,<br>
**When** a `Command::Move` is issued to an impassable building (`Block A`, center $34, 34$),<br>
**Then** each of the 10 units is assigned a distinct `goal` cell along the building's
perimeter (`claimed.len() == 10`), and no two units have the same `goal` cell.

### AC-04-02: Near-to-Far Allocation Priority
**Given** Unit 1 at $(x=25, y=34)$ (distance 9 tiles to building) and Unit 2 at
$(x=10, y=34)$ (distance 24 tiles to building),<br>
**When** both are commanded to move to the building center $(34, 34)$,<br>
**Then** Unit 1 is allocated a perimeter goal cell closer to the building center
than Unit 2.

### AC-04-03: Zero-Jitter Equilibrium Settling
**Given** a tech-slice world with 100 units commanded to move into `Block A`,<br>
**When** 300 ticks elapse from the command execution,<br>
**Then** every unit has `Order::Idle`, and the count of units whose position changes
between tick 300 and tick 301 is exactly $0$.

### AC-04-04: Determinism and Parity Preservation
**Given** the existing determinism test suite (`ac_02_19_same_seed_same_hash` and
`ac_02_20_hash_definition`),<br>
**When** group destination spreading and separation settling run in native and WASM,<br>
**Then** the simulation remains 100% deterministic with bit-identical state hashes.

---

## 7. Traceability Matrix

| Criterion | Component | Test Target | Test Name |
|---|---|---|---|
| AC-04-01 | `crates/sim` | `crates/sim/tests/movement.rs` | `ac_04_01_group_move_destination_spreading` |
| AC-04-02 | `crates/sim` | `crates/sim/tests/movement.rs` | `ac_04_02_near_to_far_allocation_priority` |
| AC-04-03 | `crates/sim` | `crates/sim/tests/movement.rs` | `ac_04_03_zero_jitter_equilibrium_settling` |
| AC-04-04 | `crates/sim` | `crates/sim/tests/determinism.rs` | `ac_04_04_settling_determinism_parity` |

---

## 8. Implementation Breakdown

### Issue 1: C&C Generals Spiral Destination Allocation (`ready-local`, area:sim)
* File: `crates/sim/src/world.rs`, `crates/sim/src/map.rs`
* Implement `adjust_destination` spiral search and near-to-far sorted allocation.
* Tests: `ac_04_01`, `ac_04_02`.
* Estimated size: ~90 lines.

### Issue 2: Separation Settling Deadzone & Damping (`ready-local`, area:sim)
* File: `crates/sim/src/world.rs`
* Add `SEPARATION_SETTLE_EPSILON`, idle-idle damping, and zero-velocity equilibrium.
* Tests: `ac_04_03`, `ac_04_04`.
* Estimated size: ~70 lines.

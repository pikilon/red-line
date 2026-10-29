import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import { decodeFeatures } from "../sim/featureSnapshot";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import {
  canDig,
  joinedTrenchLine,
  repairJobsOf,
  resolveBuildingRepairClick,
  resolveDigClick,
  resolveDigLine,
  resolveInfirmaryClick,
  resolveRepairClick,
  resolveVehicleRepairClick,
  trenchLineSegments,
  undiggableCells,
  unfinishedTrenchJobs,
  withRepairState,
} from "./repair";

const unit = (id: number, kind: string, x: number, y: number): EntityState => ({
  id,
  owner: 0,
  kind: typeIndex(kind),
  x,
  y,
  hp: 100,
  flags: 0,
  progress: 0,
  target: null,
  heading: 0,
  turretAngle: 0,
});

const row = (index: number, alive: boolean, hpPermille: number) => ({
  index,
  kind: 1,
  state: 0,
  alive,
  burning: false,
  collapsing: false,
  hpPermille,
  owner: 255,
  occupants: 0,
});

describe("spec 35 repair input", () => {
  // Row 0 a lamp, row 1 a bridge from (5, 2) to (9, 3).
  const jobs = repairJobsOf(
    [
      { type: 0, x: 1, y: 1 },
      { type: 1, x: 5, y: 2, to: [9, 3] },
    ],
    [{ family: "prop" }, { family: "bridge" }],
  );
  const entities = [
    unit(1, "ua-rifleman", 3, 2),
    unit(2, "ua-dozer", 3, 3),
    unit(3, "ua-leopard-2a4", 3, 4),
  ];

  it("workers clicking a broken bridge repair it", () => {
    const live = withRepairState(jobs, [row(0, true, 1000), row(1, false, 0)]);
    expect(
      resolveRepairClick({
        player: 0,
        selected: [1, 2, 3],
        entities,
        jobs: live,
        x: 7.5,
        y: 2.5,
      }),
    ).toEqual([{ kind: "repair", player: 0, units: [1, 2], feature: 1 }]);
  });

  it("a whole bridge takes no repair order", () => {
    const live = withRepairState(jobs, [
      row(0, true, 1000),
      row(1, true, 1000),
    ]);
    expect(
      resolveRepairClick({
        player: 0,
        selected: [1],
        entities,
        jobs: live,
        x: 7.5,
        y: 2.5,
      }),
    ).toEqual([]);
  });
});

describe("spec 38 building repair input", () => {
  it("AC-38-04: only dozers repair an own damaged complete building", () => {
    const building = {
      ...unit(4, "ua-power-plant", 10, 10),
      hp: 200,
      progress: 1000,
    };
    const entities = [
      unit(1, "ua-rifleman", 3, 2),
      unit(2, "ua-dozer", 3, 3),
      unit(3, "ua-leopard-2a4", 3, 4),
      building,
    ];
    expect(
      resolveBuildingRepairClick({
        player: 0,
        selected: [1, 2, 3],
        entities,
        x: 10,
        y: 10,
      }),
    ).toEqual([{ kind: "repairBuilding", player: 0, units: [2], building: 4 }]);
    expect(
      resolveBuildingRepairClick({
        player: 0,
        selected: [2],
        entities: entities.map((entity) =>
          entity.id === 4
            ? { ...entity, hp: typeDef(typeIndex("ua-power-plant")).hp }
            : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
    expect(
      resolveBuildingRepairClick({
        player: 0,
        selected: [2],
        entities: entities.map((entity) =>
          entity.id === 4 ? { ...entity, owner: 1 } : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
  });
});

describe("spec 40 infantry healing input", () => {
  it("AC-40-07: only damaged foot infantry enter an own barracks", () => {
    const barracks = {
      ...unit(4, "ua-barracks", 10, 10),
      hp: 1000,
      progress: 1000,
    };
    const entities = [
      { ...unit(1, "ua-rifleman", 3, 2), hp: 40 },
      { ...unit(2, "ua-rifleman", 3, 3), hp: 100 },
      { ...unit(3, "ua-leopard-2a4", 3, 4), hp: 300 },
      barracks,
    ];
    expect(
      resolveInfirmaryClick({
        player: 0,
        selected: [1, 2, 3],
        entities,
        x: 10,
        y: 10,
      }),
    ).toEqual([{ kind: "healAt", player: 0, units: [1], building: 4 }]);
    // A full-health selection has nobody to heal.
    expect(
      resolveInfirmaryClick({
        player: 0,
        selected: [2, 3],
        entities,
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
    // Enemies and buildings without healsInfantry are not infirmaries.
    expect(
      resolveInfirmaryClick({
        player: 0,
        selected: [1],
        entities: entities.map((entity) =>
          entity.id === 4 ? { ...entity, owner: 1 } : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
    const hq = {
      ...unit(5, "ua-hq", 20, 10),
      hp: 1000,
      progress: 1000,
    };
    expect(
      resolveInfirmaryClick({
        player: 0,
        selected: [1],
        entities: [...entities, hq],
        x: 20,
        y: 10,
      }),
    ).toEqual([]);
    // An unfinished barracks takes nobody yet.
    expect(
      resolveInfirmaryClick({
        player: 0,
        selected: [1],
        entities: entities.map((entity) =>
          entity.id === 4
            ? {
                ...entity,
                flags: entity.flags | ENTITY_FLAGS.underConstruction,
              }
            : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
  });
});

describe("spec 39 vehicle repair input", () => {
  it("AC-39-04: only damaged non-foot vehicles use a real repair factory", () => {
    const factory = {
      ...unit(4, "ua-vehicle-factory", 10, 10),
      hp: 2000,
      progress: 1000,
    };
    const entities = [
      unit(1, "ua-rifleman", 3, 2),
      unit(2, "ua-dozer", 3, 3),
      unit(3, "ua-leopard-2a4", 3, 4),
      factory,
    ];
    expect(
      resolveVehicleRepairClick({
        player: 0,
        selected: [1, 2, 3],
        entities,
        x: 10,
        y: 10,
      }),
    ).toEqual([
      { kind: "repairVehicle", player: 0, units: [2, 3], factory: 4 },
    ]);
    expect(
      resolveVehicleRepairClick({
        player: 0,
        selected: [2, 3],
        entities: entities.map((entity) =>
          entity.id === 2 || entity.id === 3
            ? { ...entity, hp: typeDef(entity.kind).hp }
            : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
    expect(
      resolveVehicleRepairClick({
        player: 0,
        selected: [2, 3],
        entities: entities.map((entity) =>
          entity.id === 4 ? { ...entity, kind: typeIndex("ua-hq") } : entity,
        ),
        x: 10,
        y: 10,
      }),
    ).toEqual([]);
  });
});

describe("spec 35 trench digging input", () => {
  it("a dig click centres a 2x1 trench and only workers dig", () => {
    const entities = [
      unit(1, "ua-rifleman", 3, 2),
      unit(3, "ua-leopard-2a4", 3, 4),
    ];
    expect(
      resolveDigClick({
        player: 0,
        selected: [1, 3],
        entities,
        x: 10.2,
        y: 5.7,
        turned: false,
      }),
    ).toEqual([{ kind: "dig", player: 0, units: [1], x: 9, y: 5, rot: 0 }]);
    expect(
      resolveDigClick({
        player: 0,
        selected: [3],
        entities,
        x: 10,
        y: 5,
        turned: false,
      }),
    ).toEqual([]);
    expect(canDig(0, entities)).toBe(true);
  });

  it("a drawn line is cut into consecutive 2x1 trenches along its long axis", () => {
    expect(
      trenchLineSegments({ x: 10.5, y: 5.5 }, { x: 15.5, y: 5.5 }),
    ).toEqual([
      { x: 10, y: 5, rot: 0 },
      { x: 12, y: 5, rot: 0 },
      { x: 14, y: 5, rot: 0 },
    ]);
    // Drawn backwards: the order still follows the drawing.
    expect(
      trenchLineSegments({ x: 13.5, y: 8.5 }, { x: 10.5, y: 8.5 }),
    ).toEqual([
      { x: 12, y: 8, rot: 0 },
      { x: 10, y: 8, rot: 0 },
    ]);
    // Mostly vertical lines turn the trench and drift across with the line.
    expect(trenchLineSegments({ x: 4.5, y: 2.5 }, { x: 6.5, y: 7.5 })).toEqual([
      { x: 4, y: 2, rot: 1 },
      { x: 5, y: 4, rot: 1 },
      { x: 6, y: 6, rot: 1 },
    ]);
    const entities = [unit(1, "ua-rifleman", 3, 2)];
    expect(
      resolveDigLine({
        player: 0,
        selected: [1],
        entities,
        from: { x: 10.5, y: 5.5 },
        to: { x: 12.5, y: 5.5 },
      }),
    ).toEqual([
      {
        kind: "digLine",
        player: 0,
        units: [1],
        segments: [10, 5, 0, 12, 5, 0],
      },
    ]);
  });

  it("an odd line drawn backwards never folds back over its own cells", () => {
    expect(
      trenchLineSegments({ x: 14.5, y: 8.5 }, { x: 10.5, y: 8.5 }),
    ).toEqual([
      { x: 13, y: 8, rot: 0 },
      { x: 11, y: 8, rot: 0 },
      { x: 9, y: 8, rot: 0 },
    ]);
  });

  it("a line drawn near a trench snaps onto it so the network joins", () => {
    // A trench on cells (10..11, 5); the line is drawn from two cells away.
    const trench = new Set(["10,5", "11,5"]);
    const isTrench = (x: number, y: number) => trench.has(`${x},${y}`);
    const isFree = () => true;
    const segments = joinedTrenchLine(
      { x: 13.9, y: 5.5 },
      { x: 19.5, y: 5.5 },
      isTrench,
      isFree,
    );
    expect(segments[0]).toEqual({ x: 12, y: 5, rot: 0 });
    // Drawn towards the trench, an odd line grows at its free start instead.
    const towards = joinedTrenchLine(
      { x: 18.5, y: 5.5 },
      { x: 13.5, y: 5.5 },
      isTrench,
      isFree,
    );
    const cells = towards.flatMap((s) => [s.x, s.x + 1]);
    expect(Math.min(...cells)).toBe(12);
    expect(cells.some((x) => trench.has(`${x},5`))).toBe(false);
  });

  it("a line over trenches leaves them alone and fills only the gaps", () => {
    // Trench cells at x 12..13 and 17..18 on row 5; the line runs 10..20.
    const trench = new Set(["12,5", "13,5", "17,5", "18,5"]);
    const isTrench = (x: number, y: number) => trench.has(`${x},${y}`);
    const segments = joinedTrenchLine(
      { x: 10.5, y: 5.5 },
      { x: 20.5, y: 5.5 },
      isTrench,
      () => true,
    );
    const cells = segments.flatMap((s) =>
      s.rot === 0
        ? [`${s.x},${s.y}`, `${s.x + 1},${s.y}`]
        : [`${s.x},${s.y}`, `${s.x},${s.y + 1}`],
    );
    // Nothing is dug twice, and every free cell of the line is covered.
    expect(cells.some((cell) => trench.has(cell))).toBe(false);
    expect(new Set(cells).size).toBe(cells.length);
    for (const x of [10, 11, 14, 15, 16, 19, 20]) {
      expect(cells).toContain(`${x},5`);
    }
  });

  it("unfinished dug trenches are construction marks workers can click", () => {
    const rows = [
      {
        index: 0,
        kind: 3,
        state: 0,
        alive: true,
        burning: false,
        collapsing: false,
        hpPermille: 1000,
        owner: 255,
        occupants: 0,
      },
      {
        index: 1,
        kind: 7,
        state: 2,
        alive: true,
        burning: false,
        collapsing: false,
        hpPermille: 40,
        owner: 255,
        occupants: 0,
        at: { x: 4, y: 6, rot: 1, variant: 0 },
      },
      {
        index: 2,
        kind: 7,
        state: 0,
        alive: true,
        burning: false,
        collapsing: false,
        hpPermille: 1000,
        owner: 255,
        occupants: 0,
        at: { x: 8, y: 6, rot: 0, variant: 0 },
      },
    ];
    expect(unfinishedTrenchJobs(rows, new Set([7]))).toEqual([
      { index: 1, x0: 4, y0: 6, x1: 4, y1: 7, damaged: true },
    ]);
  });

  it("the feature table trailer places rows dug in the match", () => {
    // Two rows of 7 ints, then placed = 1 and (x, y, rot, variant) for row 1.
    const table = Int32Array.from([
      2, 0, 0, 0, 1, 1000, 255, 0, 1, 5, 2, 1, 3, 255, 0, 1, 30, 33, 1, 1,
    ]);
    const rows = decodeFeatures(table);
    expect(rows?.[0]?.at).toBeUndefined();
    expect(rows?.[1]?.at).toEqual({ x: 30, y: 33, rot: 1, variant: 1 });
  });
});

describe("undiggableCells (spec 35 §5b)", () => {
  it("marks road cells and hard ground, nothing else", () => {
    const map = {
      width: 2,
      height: 2,
      ground: "00070600",
      roads: "00000100",
    };
    expect([...undiggableCells(map, [3, 6, 7])]).toEqual([0, 1, 1, 0]);
    expect([...undiggableCells({ width: 2, height: 2 }, [3])]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

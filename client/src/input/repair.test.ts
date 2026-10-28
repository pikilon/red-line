import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { repairJobsOf, resolveRepairClick, withRepairState } from "./repair";

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

  it("workers right clicking a broken bridge repair it", () => {
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

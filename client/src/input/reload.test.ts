import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { AirState, EntityState } from "../sim/matchSnapshot";
import { reloadPlan } from "./reload";

const entity = (id: number, kind: string, owner = 0): EntityState => ({
  id,
  owner,
  kind: typeIndex(kind),
  x: id,
  y: 1,
  hp: 100,
  flags: 0,
  progress: 1000,
  target: null,
  heading: 0,
  turretAngle: 0,
});

const air = (id: number, ammo: number, clip: number): AirState => ({
  id,
  ammo,
  clip,
  fuelPermille: 1000,
  master: null,
});

const plan = (
  selected: number[],
  entities: EntityState[],
  states: AirState[],
) =>
  reloadPlan({
    player: 0,
    selected: new Set(selected),
    entities,
    air: states,
  });

describe("spec 43 §4.6 reload button", () => {
  it("offers a part-empty sortie flyer and sends it when a base stands", () => {
    const result = plan(
      [1],
      [entity(1, "ua-baba-yaga"), entity(2, "ua-drone-workshop")],
      [air(1, 2, 4)],
    );
    expect(result.reloadable).toEqual([1]);
    expect(result.command).toEqual({ kind: "reload", player: 0, units: [1] });
  });

  it("hides for full clips and refuses with no base", () => {
    const flyer = entity(1, "ua-baba-yaga");
    expect(plan([1], [flyer], [air(1, 4, 4)]).reloadable).toEqual([]);
    const noBase = plan([1], [flyer], [air(1, 0, 4)]);
    expect(noBase.reloadable).toEqual([1]);
    expect(noBase.command).toBeNull();
  });

  it("ignores a base that belongs to the enemy or is unfinished", () => {
    const flyer = entity(1, "ua-baba-yaga");
    const enemy = entity(2, "ua-drone-workshop", 1);
    const building = { ...entity(3, "ua-drone-workshop"), flags: 2 };
    expect(
      plan([1], [flyer, enemy, building], [air(1, 0, 4)]).command,
    ).toBeNull();
  });

  it("offers a launcher crew a supply truck and skips the full ones", () => {
    const entities = [
      entity(1, "ua-fpv-team"),
      entity(2, "ua-fpv-team"),
      entity(3, "ua-supply-truck"),
    ];
    const result = plan([1, 2], entities, [air(1, 1, 4), air(2, 4, 4)]);
    expect(result.reloadable).toEqual([1]);
    expect(result.command?.units).toEqual([1]);
    expect(plan([1], entities.slice(0, 2), [air(1, 1, 4)]).command).toBeNull();
  });

  it("ignores units that are not selected", () => {
    const entities = [entity(1, "ua-fpv-team"), entity(3, "ua-supply-truck")];
    expect(plan([3], entities, [air(1, 1, 4)]).reloadable).toEqual([]);
  });
});

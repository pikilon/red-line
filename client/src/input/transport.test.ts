import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { commandButtons } from "../ui/commandPanel";
import { clickSelect } from "./entitySelection";
import { disembarkOffer, resolveBoardClick, ridersOf } from "./transport";

const unit = (
  id: number,
  owner: number,
  kind: string,
  x: number,
  y: number,
  flags = 0,
  progress = 0,
): EntityState => ({
  id,
  owner,
  kind: typeIndex(kind),
  x,
  y,
  hp: 100,
  flags,
  progress,
  target: null,
  heading: 0,
  turretAngle: 0,
});

const ABOARD = ENTITY_FLAGS.inside | ENTITY_FLAGS.aboard;

describe("spec 34 transport input", () => {
  const bradley = unit(1, 0, "ua-bradley", 10, 10);
  const tank = unit(2, 0, "ua-leopard-2a4", 20, 20);
  const rifleman = unit(3, 0, "ua-rifleman", 5, 5);
  const rider = unit(4, 0, "ua-rifleman", 10, 10, ABOARD, 1);
  const entities = [bradley, tank, rifleman, rider];

  it("a click on an own transport boards the selected infantry", () => {
    expect(
      resolveBoardClick({
        player: 0,
        selected: [3, 2],
        entities,
        x: 10.2,
        y: 10,
      }),
    ).toEqual([{ kind: "board", player: 0, units: [3], carrier: 1 }]);
    // A tank carries nobody; an enemy's vehicle is not boarded.
    expect(
      resolveBoardClick({ player: 0, selected: [3], entities, x: 20, y: 20 }),
    ).toEqual([]);
    expect(
      resolveBoardClick({ player: 1, selected: [3], entities, x: 10, y: 10 }),
    ).toEqual([]);
  });

  it("riders are counted, offered for unloading and never picked", () => {
    expect(ridersOf(1, entities)).toEqual([rider]);
    const offer = disembarkOffer({ player: 0, selected: [1], entities });
    expect(offer).toEqual({ carrier: 1, riders: 1 });
    const buttons = commandButtons({
      selected: [bradley],
      ownEntities: entities,
      credits: 0,
      queue: null,
      disembark: offer,
    });
    expect(buttons.at(-1)).toMatchObject({ action: "disembark", carrier: 1 });
    expect(clickSelect(entities, 10, 10, 0)).toEqual([1]);
  });
});

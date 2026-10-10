import { describe, expect, it } from "vitest";
import { type EntityState, ENTITY_FLAGS, NEUTRAL } from "../sim/matchSnapshot";
import { typeIndex } from "../rules";
import { canPlace, footprintOrigin } from "./placement";

const entity = (args: {
  id: number;
  owner: number;
  kind: string;
  x: number;
  y: number;
  flags?: number;
}): EntityState => ({
  id: args.id,
  owner: args.owner,
  kind: typeIndex(args.kind),
  x: args.x,
  y: args.y,
  hp: 100,
  flags: args.flags ?? 0,
  progress: 0,
  target: null,
});

const WIDTH = 8;
const HEIGHT = 8;
// Tile (6, 6) blocked, fog 2 everywhere except (0, 0) = 0.
const tiles = new Uint8Array(WIDTH * HEIGHT);
tiles[6 * WIDTH + 6] = 1;
const fog = new Uint8Array(WIDTH * HEIGHT).fill(2);
fog[0] = 0;

const placement = (origin: { x: number; y: number }, entities: readonly EntityState[]) =>
  canPlace({
    kind: typeIndex("ua-defense"),
    origin,
    width: WIDTH,
    height: HEIGHT,
    tiles,
    fog,
    entities,
  });

describe("placement predictor", () => {
  it("AC-03-50: predicts building placement", () => {
    expect(footprintOrigin(typeIndex("ua-power-plant"), 19.5, 65.5)).toEqual({ x: 18, y: 64 });
    expect(footprintOrigin(typeIndex("ua-defense"), 10.7, 4.2)).toEqual({ x: 10, y: 3 });

    expect(placement({ x: 2, y: 2 }, [])).toBe(true);
    expect(placement({ x: 7, y: 2 }, [])).toBe(false);
    expect(placement({ x: 5, y: 5 }, [])).toBe(false);
    expect(placement({ x: 0, y: 0 }, [])).toBe(false);
  });

  it("AC-03-50: rejects tiles occupied by buildings, ghosts and units", () => {
    const building = entity({ id: 1, owner: 0, kind: "ua-barracks", x: 3, y: 3 });
    const ghost = entity({
      id: 2,
      owner: 1,
      kind: "ua-hq",
      x: 5,
      y: 5,
      flags: ENTITY_FLAGS.ghost,
    });
    const unit = entity({ id: 3, owner: NEUTRAL, kind: "ua-rifleman", x: 3, y: 0 });
    const elsewhere = entity({ id: 4, owner: 0, kind: "ua-barracks", x: 40, y: 40 });

    expect(placement({ x: 2, y: 2 }, [building])).toBe(false);
    expect(placement({ x: 2, y: 2 }, [ghost])).toBe(false);
    expect(placement({ x: 2, y: 2 }, [unit])).toBe(false);
    expect(placement({ x: 2, y: 2 }, [elsewhere])).toBe(true);
  });
});

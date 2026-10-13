import ruleset from "@data/ruleset.json";
import { describe, expect, it } from "vitest";
import { RULES, typeDef } from "../rules";
import { showcasePlan } from "./showcase";

const MAP = ruleset.maps.find((entry) => entry.id === "showcase");

describe("showcase", () => {
  it("AC-14-02: every type once, in formation", () => {
    if (MAP === undefined) throw new Error("no showcase map");
    const plan = showcasePlan(RULES, MAP);

    MAP.starts.forEach((start, player) => {
      const faction = RULES.factions[start.faction];
      const expected = RULES.types
        .map((type, index) => ({ type, index }))
        .filter(
          ({ type, index }) =>
            type.faction === start.faction &&
            type.category !== "depot" &&
            index !== faction?.hq &&
            index !== faction?.dozer,
        )
        .map(({ index }) => index);
      const mine = plan
        .filter((spawn) => spawn.player === player)
        .map((spawn) => spawn.typeIndex);
      expect(mine.sort((a, b) => a - b)).toEqual(expected);
      expect(mine.length).toBe(12);
    });

    // Inside the map, no two buildings overlap and no unit shares a cell.
    const cells = new Set<string>();
    for (const spawn of plan) {
      const type = typeDef(spawn.typeIndex);
      const size = type.category === "building" ? type.footprint : [1, 1];
      expect(spawn.x).toBeGreaterThanOrEqual(0);
      expect(spawn.y).toBeGreaterThanOrEqual(0);
      expect(spawn.x + (size[0] ?? 1)).toBeLessThanOrEqual(MAP.width);
      expect(spawn.y + (size[1] ?? 1)).toBeLessThanOrEqual(MAP.height);
      for (let dx = 0; dx < (size[0] ?? 1); dx++) {
        for (let dy = 0; dy < (size[1] ?? 1); dy++) {
          const key = `${Math.floor(spawn.x) + dx},${Math.floor(spawn.y) + dy}`;
          expect(cells.has(key)).toBe(false);
          cells.add(key);
        }
      }
    }
    // The start HQ is the first building slot, the start dozer is unit slot 6.
    for (const start of MAP.starts) {
      const hq = RULES.factions[start.faction]?.hq ?? -1;
      const size = typeDef(hq).footprint;
      for (let dx = 0; dx < size[0]; dx++) {
        for (let dy = 0; dy < size[1]; dy++) {
          expect(
            cells.has(`${(start.hq[0] ?? 0) + dx},${(start.hq[1] ?? 0) + dy}`),
          ).toBe(false);
        }
      }
      const [dozerX, dozerY] = start.dozerCenti;
      expect(dozerY).toBe(2050);
      expect(dozerX).toBe(((start.hq[0] ?? 0) + 11.5) * 100);
    }
  });
});

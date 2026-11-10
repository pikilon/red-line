import { describe, expect, it } from "vitest";
import { RULES } from "../rules";
import { maxHpAt, maxHpOf, RANK_SHIFT, rankedName, rankOf } from "./veterancy";

const kind = RULES.types.findIndex((type) => type.id === "ua-leopard-2a4");

describe("veterancy (spec 50)", () => {
  it("reads the rank from the flags", () => {
    expect(rankOf({ flags: 1 })).toBe(0);
    expect(rankOf({ flags: 1 | (2 << RANK_SHIFT) })).toBe(2);
    expect(rankOf({ flags: 256 | (3 << RANK_SHIFT) })).toBe(3);
  });

  it("raises the maximum hit points with the rank", () => {
    const base = RULES.types[kind]?.hp ?? 0;
    expect(maxHpAt(kind, 0)).toBe(base);
    expect(maxHpAt(kind, 1)).toBe(Math.floor((base * 120) / 100));
    expect(maxHpOf({ kind, flags: 3 << RANK_SHIFT })).toBe(
      Math.floor((base * 150) / 100),
    );
  });

  it("names a promoted unit with its rank", () => {
    expect(rankedName("Leopard 2A4", 0)).toBe("Leopard 2A4");
    expect(rankedName("Leopard 2A4", 1)).toBe("Leopard 2A4 (Veteran)");
    expect(rankedName("Leopard 2A4", 3)).toBe("Leopard 2A4 (Heroic)");
  });
});

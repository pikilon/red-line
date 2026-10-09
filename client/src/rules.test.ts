import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { factionName, RULES, typeDef, typeIndex, typeName } from "./rules";

describe("rules", () => {
  it("AC-03-43: exposes the ruleset and type names", () => {
    // RULES is the imported @data/ruleset.json.
    expect(RULES.maxQueue).toBe(5);
    expect(RULES.types.length).toBe(30);
    expect(RULES.factions.map((f) => f.id)).toEqual(["ukraine", "russia"]);

    // typeIndex(id): the index of a type by id, -1 if absent.
    expect(typeIndex("tech-slice-placeholder")).toBe(0);
    expect(typeIndex("ua-rifleman")).toBe(2);
    expect(typeIndex("ru-t-72b3")).toBe(20);
    expect(typeIndex("does-not-exist")).toBe(-1);

    // typeDef(kind): the TypeDef at that index; throws RangeError out of range.
    expect(typeDef(2)).toMatchObject({
      id: "ua-rifleman",
      faction: 0,
      category: "unit",
      hp: 100,
    });
    expect(typeDef(20)).toMatchObject({
      id: "ru-t-72b3",
      faction: 1,
      category: "unit",
    });
    expect(typeDef(29)).toMatchObject({
      id: "ru-defense",
      faction: 1,
      category: "building",
    });
    expect(() => typeDef(-1)).toThrow(RangeError);
    expect(() => typeDef(RULES.types.length)).toThrow(RangeError);

    // typeName(kind): t(`type.${id}`), the English name from i18n.
    expect(typeName(0)).toBe(t("type.tech-slice-placeholder"));
    expect(typeName(0)).toBe("Placeholder");
    expect(typeName(2)).toBe(t("type.ua-rifleman"));
    expect(typeName(2)).toBe("Territorial Defense rifleman");
    expect(typeName(20)).toBe("T-72B3");

    // factionName(faction): t(`faction.${id}`).
    expect(factionName(0)).toBe(t("faction.ukraine"));
    expect(factionName(0)).toBe("Ukraine");
    expect(factionName(1)).toBe(t("faction.russia"));
    expect(factionName(1)).toBe("Russia");
  });
});

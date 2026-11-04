import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { typeIndex } from "../rules";
import { HELP_CARDS, helpedTypes, helpFor, isLaunched } from "./cards";
import { helpStats } from "./stats";

const ROOT = join(__dirname, "../../..");
const CARD_DIR = join(ROOT, "client/src/i18n/help");

interface Recipe {
  id: string;
  save: string;
}

function recipes(card: string): Recipe[] {
  const file = join(ROOT, "data/help", `${card}.yaml`);
  return existsSync(file)
    ? ((parse(readFileSync(file, "utf8")) ?? []) as Recipe[])
    : [];
}

describe("spec 48 help cards", () => {
  it("names every card file after its type", () => {
    for (const file of readdirSync(CARD_DIR)) {
      const card = JSON.parse(readFileSync(join(CARD_DIR, file), "utf8"));
      expect(`${card.id}.json`).toBe(file);
      expect(typeIndex(card.id), card.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("AC-48-03: every unit and building has help", () => {
    const missing = helpedTypes().filter((id) => helpFor(id) === null);
    expect(missing).toEqual([]);
  });

  it("covers launched drones and missiles inside their launcher", () => {
    for (const id of helpedTypes().filter(isLaunched)) {
      expect(HELP_CARDS.has(id), id).toBe(false);
      expect(helpFor(id)?.section, id).not.toBeNull();
    }
  });

  it("backs every shot with a recipe, a save and an image", () => {
    for (const card of HELP_CARDS.values()) {
      const known = new Map(recipes(card.id).map((r) => [r.id, r]));
      for (const section of card.sections) {
        for (const shot of section.shots ?? []) {
          const recipe = known.get(shot);
          expect(recipe, `${card.id}: recipe ${shot}`).toBeDefined();
          expect(
            existsSync(join(ROOT, "data/saves", `${recipe?.save}.yaml`)),
            `${shot}: save ${recipe?.save}`,
          ).toBe(true);
          expect(
            existsSync(join(ROOT, "client/public/help", `${shot}.jpg`)),
            `${shot}: image`,
          ).toBe(true);
        }
      }
    }
  });

  it("builds the stats strip from the rules", () => {
    const stats = helpStats("ua-bradley");
    expect(stats.map((s) => s.label)).toContain("Carries");
    expect(stats.find((s) => s.label === "Built at")?.links).toEqual([
      "ua-vehicle-factory",
    ]);
  });
});

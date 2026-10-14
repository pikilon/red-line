import { BoxGeometry, type MeshLambertMaterial, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { createEntityRenderer } from "./entities";
import {
  DARK_MASK,
  INFANTRY_TILE,
  loadGeneratedTextures,
  MARK_MASK,
  MODEL_TILE,
} from "./generatedTextures";
import {
  MATERIAL_NAMES,
  type MaterialName,
  type ModelPart,
  type ModelRegistry,
  type TypeModel,
} from "./models";

function entity(id: number, typeId: string): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex(typeId),
    x: 2,
    y: 2,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
  };
}

/** Every type gets a model with body, team, dark and mark parts. */
function registry(): ModelRegistry {
  const geometry = new BoxGeometry(0.3, 0.5, 0.3);
  const part = (material: MaterialName, color: number): ModelPart => ({
    material,
    geometry,
    color,
  });
  return {
    get: (): TypeModel => ({
      parts: new Map<MaterialName, ModelPart>([
        ["body", part("body", 0x9aa070)],
        ["team", part("team", 0xffffff)],
        ["dark", part("dark", 0x2a2a2a)],
        ["mark", part("mark", 0xe3b72e)],
      ]),
      turret: new Map(),
      pivot: new Vector3(),
      fallback: false,
    }),
  };
}

function rendered() {
  const renderer = createEntityRenderer(8, registry());
  renderer.update(
    [
      entity(1, "ua-rifleman"),
      entity(2, "ru-rpg-gunner"),
      entity(3, "ua-bradley"),
    ],
    new Set(),
  );
  const material = (typeId: string, name: MaterialName) => {
    const slot = renderer.models.find(
      (m) => m.typeId === typeId && m.material === name,
    );
    if (slot === undefined) throw new Error(`no ${name} slot for ${typeId}`);
    return slot.mesh;
  };
  return { renderer, material };
}

describe("17 — Infantry look (smooth soldiers, flag marks, fine camouflage)", () => {
  it("AC-18-07: infantry is smooth shaded, vehicles stay faceted", () => {
    const { material } = rendered();
    const flat = (typeId: string, name: MaterialName): boolean =>
      (material(typeId, name).material as MeshLambertMaterial).flatShading;
    expect(flat("ua-rifleman", "body")).toBe(false);
    expect(flat("ua-rifleman", "team")).toBe(false);
    expect(flat("ru-rpg-gunner", "body")).toBe(false);
    expect(flat("ua-bradley", "body")).toBe(true);
  });

  it("AC-18-08: `mark` parts join the body mesh untextured with MARK_MASK", () => {
    expect(MATERIAL_NAMES).toContain("mark");
    const { material } = rendered();
    const mask = material("ua-rifleman", "body").geometry.getAttribute(
      DARK_MASK,
    );
    const values = new Set(Array.from(mask.array as Float32Array));
    expect(values).toEqual(new Set([0, 1, MARK_MASK]));
  });

  it("AC-18-09: infantry camouflage repeats every INFANTRY_TILE model units", async () => {
    const loaded = await loadGeneratedTextures({
      loadAsync: () => Promise.resolve(new Texture()),
    });
    const repeat = MODEL_TILE / INFANTRY_TILE;
    expect(loaded["ua-camo"]?.repeat.x).toBe(repeat);
    expect(loaded["ru-camo"]?.repeat.y).toBe(repeat);
    expect(loaded["ua-skin"]?.repeat.x).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { BoxGeometry, type MeshLambertMaterial, Texture } from "three";
import {
  bodyMapsOf,
  bodyTextureId,
  GENERATED_TEXTURE_IDS,
  type GeneratedTextures,
} from "./generatedTextures";
import { createEntityRenderer } from "./entities";
import type { MaterialName, ModelPart, ModelRegistry, TypeModel } from "./models";
import type { EntityState } from "../sim/matchSnapshot";

import { RULES, typeIndex } from "../rules";

function entity(id: number, owner: number, typeId: string): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(typeId),
    x: 2,
    y: 2,
    hp: 100,
    maxHp: 100,
    flags: 0,
    progress: 0,
    target: null,
  };
}

function mockRegistry(): ModelRegistry {
  const geom = new BoxGeometry(0.3, 0.5, 0.3);
  return {
    get: (_id: string): TypeModel => ({
      parts: new Map<MaterialName, ModelPart>([
        ["body", { material: "body", geometry: geom, color: 0x5b6b3a }],
        ["team", { material: "team", geometry: geom, color: 0xffffff }],
        ["dark", { material: "dark", geometry: geom, color: 0x2a2a2a }],
      ]),
      turret: new Map(),
      pivot: geom.parameters ? undefined! : undefined!,
      fallback: false,
    }),
  };
}

describe("17 — Infantry appearance and camouflage textures", () => {
  it("AC-17-01: GENERATED_TEXTURE_IDS includes ua-camo and ru-camo", () => {
    expect(GENERATED_TEXTURE_IDS).toContain("ua-camo");
    expect(GENERATED_TEXTURE_IDS).toContain("ru-camo");
  });

  it("AC-17-02: bodyTextureId returns <faction>-camo for infantry (armor 0)", () => {
    expect(bodyTextureId("ua-rifleman", "unit", 0)).toBe("ua-camo");
    expect(bodyTextureId("ua-stugna-team", "unit", 0)).toBe("ua-camo");
    expect(bodyTextureId("ru-rifleman", "unit", 0)).toBe("ru-camo");
    expect(bodyTextureId("ru-rpg-gunner", "unit", 0)).toBe("ru-camo");
  });

  it("AC-17-03: bodyMapsOf returns camo when loaded, falls back to paint when missing", () => {
    const uaCamo = new Texture();
    const uaPaint = new Texture();
    const ruCamo = new Texture();
    const ruPaint = new Texture();

    const withCamo: GeneratedTextures = {
      "ua-camo": uaCamo,
      "ua-paint": uaPaint,
      "ru-camo": ruCamo,
      "ru-paint": ruPaint,
    };

    const uaMaps = bodyMapsOf(withCamo, "ua-rifleman", "unit", 0);
    expect(uaMaps.paint).toBe(uaCamo);
    expect(uaMaps.bump).toBeUndefined();

    const ruMaps = bodyMapsOf(withCamo, "ru-rifleman", "unit", 0);
    expect(ruMaps.paint).toBe(ruCamo);
    expect(ruMaps.bump).toBeUndefined();

    const withoutCamo: GeneratedTextures = {
      "ua-paint": uaPaint,
      "ru-paint": ruPaint,
    };
    const uaFallback = bodyMapsOf(withoutCamo, "ua-rifleman", "unit", 0);
    expect(uaFallback.paint).toBe(uaPaint);
    expect(uaFallback.bump).toBeUndefined();
  });

  it("AC-17-04: entity renderer applies camo texture to infantry body mesh", () => {
    const renderer = createEntityRenderer(8, mockRegistry());
    renderer.update(
      [
        entity(1, 0, "ua-rifleman"),
        entity(2, 1, "ru-rifleman"),
      ],
      new Set(),
    );

    const textures: GeneratedTextures = {
      "ua-camo": new Texture(),
      "ru-camo": new Texture(),
      "dark-metal": new Texture(),
    };
    renderer.setGeneratedTextures(textures);

    const bodyMat = (typeId: string): MeshLambertMaterial => {
      const slot = renderer.models.find(
        (m) => m.typeId === typeId && m.material === "body",
      );
      if (!slot) throw new Error(`no body slot for ${typeId}`);
      return slot.mesh.material as MeshLambertMaterial;
    };

    expect(bodyMat("ua-rifleman").map).toBe(textures["ua-camo"]);
    expect(bodyMat("ua-rifleman").bumpMap).toBeNull();
    expect(bodyMat("ru-rifleman").map).toBe(textures["ru-camo"]);
    expect(bodyMat("ru-rifleman").bumpMap).toBeNull();

    renderer.setGeneratedTextures(null);
    expect(bodyMat("ua-rifleman").map).toBeNull();
    expect(bodyMat("ru-rifleman").map).toBeNull();
  });
});

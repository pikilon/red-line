import {
  BoxGeometry,
  Color,
  type MeshLambertMaterial,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { createEntityRenderer } from "./entities";
import { facadeTextureIds, untintOf } from "./facades";
import type { MaterialName, ModelPart, TypeModel } from "./models";

const BODY = 0x6b6650;

function registry() {
  return {
    get: (): TypeModel => ({
      parts: new Map<MaterialName, ModelPart>([
        [
          "body",
          { material: "body", geometry: new BoxGeometry(2, 1, 2), color: BODY },
        ],
      ]),
      turret: new Map<MaterialName, ModelPart>(),
      pivot: new Vector3(),
      fallback: false,
    }),
  };
}

function entity(id: number, type: string): EntityState {
  return {
    id,
    owner: 0,
    kind: typeIndex(type),
    x: 4,
    y: 4,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
    heading: 0,
    turretAngle: 0,
  };
}

describe("building facades", () => {
  it("AC-16-01: facade textures by type", () => {
    for (const id of ["ua-hq", "ua-barracks", "ua-power-plant"]) {
      expect(facadeTextureIds(id, "building")).toEqual({
        wall: "ua-wall",
        roof: "ua-roof",
      });
    }
    // Russian buildings keep ru-concrete (owner decision 2026-10-14).
    expect(facadeTextureIds("ru-hq", "building")).toBeNull();
    expect(facadeTextureIds("ru-barracks", "building")).toBeNull();
    expect(facadeTextureIds("ua-bradley", "unit")).toBeNull();
    expect(facadeTextureIds("ru-rifleman", "unit")).toBeNull();
    expect(facadeTextureIds("supply-depot", "depot")).toBeNull();
  });

  it("AC-16-02: untint divides the body colour out", () => {
    const linear = new Color(BODY);
    const untint = untintOf(BODY);
    expect(untint[0] * linear.r).toBeCloseTo(1, 5);
    expect(untint[1] * linear.g).toBeCloseTo(1, 5);
    expect(untint[2] * linear.b).toBeCloseTo(1, 5);
  });

  it("AC-16-03: building body slots wear wall and roof", () => {
    const renderer = createEntityRenderer(8, registry());
    renderer.update(
      [
        entity(0, "ua-barracks"),
        entity(1, "ru-t-72b3"),
        entity(2, "ru-barracks"),
      ],
      new Set(),
    );
    const materialOf = (typeId: string) => {
      const slot = renderer.models.find(
        (model) => model.typeId === typeId && model.material === "body",
      );
      if (slot === undefined) throw new Error(`no slot ${typeId}`);
      return slot.mesh.material as MeshLambertMaterial;
    };
    const wall = new Texture();
    const roof = new Texture();
    const concrete = new Texture();
    const barracks = materialOf("ua-barracks");
    const untint = () => barracks.userData.facadeUntint.value as Vector3;

    renderer.setGeneratedTextures({
      "ua-wall": wall,
      "ua-roof": roof,
      "ru-concrete": concrete,
    });
    expect(barracks.map).toBe(wall);
    expect(barracks.userData.roofMap.value).toBe(roof);
    expect(untint().x).not.toBeCloseTo(1, 3);
    const russian = materialOf("ru-barracks");
    expect(russian.userData.roofMap).toBeUndefined();
    expect(russian.map).toBe(concrete);

    renderer.setGeneratedTextures({ "ua-wall": wall });
    expect(barracks.userData.roofMap.value).toBe(wall);

    renderer.setGeneratedTextures(null);
    expect(barracks.map).toBeNull();
    expect(untint().toArray()).toEqual([1, 1, 1]);

    expect(materialOf("ru-t-72b3").userData.roofMap).toBeUndefined();
  });
});

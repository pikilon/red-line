import {
  BoxGeometry,
  Color,
  type InstancedBufferAttribute,
  type MeshLambertMaterial,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { createEntityRenderer, OWNER_COLORS, SELECTED_COLOR } from "./entities";
import { addBandAttribute, bandsOf, FLAGS } from "./flags";
import type { MaterialName, ModelPart, TypeModel } from "./models";

function registry() {
  return {
    get: (): TypeModel => ({
      parts: new Map<MaterialName, ModelPart>([
        [
          "body",
          {
            material: "body",
            geometry: new BoxGeometry(2, 1, 2),
            color: 0x6b6650,
          },
        ],
        [
          "team",
          {
            material: "team",
            geometry: new BoxGeometry(1, 0.2, 0.06).translate(0, 0.8, 1),
            color: 0xffffff,
          },
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
    x: 4 + id * 6,
    y: 4,
    hp: 100,
    flags: 0,
    progress: 0,
    target: null,
  };
}

describe("flag bands on buildings", () => {
  it("AC-16-08: bands by type and per piece", () => {
    expect(bandsOf("ua-barracks", "building")).toEqual(FLAGS.ukraine);
    expect(bandsOf("ru-hq", "building")).toEqual(FLAGS.russia);
    expect(bandsOf("ua-bradley", "unit")).toBeNull();
    expect(bandsOf("ru-rifleman", "unit")).toBeNull();
    expect(bandsOf("supply-depot", "depot")).toBeNull();

    const low = new BoxGeometry(1, 0.2, 0.1).translate(0, 0.5, 0);
    const high = new BoxGeometry(1, 0.4, 0.1).translate(3, 1.2, 0);
    const merged = addBandAttribute(
      mergeGeometries([low.toNonIndexed(), high.toNonIndexed()], false),
    );
    const position = merged.getAttribute("position");
    const band = merged.getAttribute("band");
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      const isLow = position.getX(i) < 1.5;
      const bottom = isLow ? 0.4 : 1.0;
      const expected = Math.abs(y - bottom) < 1e-6 ? 0 : 1;
      expect(band.getX(i)).toBeCloseTo(expected, 5);
    }
  });

  it("AC-16-09: building team slots wear the flag, selection overrides", () => {
    const renderer = createEntityRenderer(8, registry());
    const plain = entity(0, "ua-barracks");
    const picked = entity(1, "ua-barracks");
    const vehicle = entity(2, "ua-bradley");
    renderer.update([plain, picked, vehicle], new Set([picked.id]));
    const teamOf = (typeId: string) => {
      const slot = renderer.models.find(
        (model) => model.typeId === typeId && model.material === "team",
      );
      if (slot === undefined) throw new Error(`no team slot ${typeId}`);
      return slot.mesh;
    };
    const barracks = teamOf("ua-barracks");
    expect(barracks.geometry.hasAttribute("band")).toBe(true);
    expect(
      (barracks.material as MeshLambertMaterial).userData.bandColors,
    ).toEqual(FLAGS.ukraine);
    const bandOn = barracks.geometry.getAttribute(
      "bandOn",
    ) as InstancedBufferAttribute;
    const color = new Color();
    barracks.getColorAt(0, color);
    expect(color.getHex()).toBe(0xffffff);
    expect(bandOn.getX(0)).toBe(1);
    barracks.getColorAt(1, color);
    expect(color.getHex()).toBe(SELECTED_COLOR);
    expect(bandOn.getX(1)).toBe(0);

    const bradley = teamOf("ua-bradley");
    expect(bradley.geometry.hasAttribute("band")).toBe(false);
    bradley.getColorAt(0, color);
    expect(color.getHex()).toBe(OWNER_COLORS[0]);
  });
});

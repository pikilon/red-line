import {
  BoxGeometry,
  type BufferGeometry,
  Float32BufferAttribute,
  type MeshLambertMaterial,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import type { EntityState } from "../sim/matchSnapshot";
import { createEntityRenderer } from "./entities";
import { DARK_MASK } from "./generatedTextures";
import {
  addLiveryAttribute,
  LIVERIES,
  liveryOf,
  liverySample,
  RU_WHITE,
  UA_BLUE,
  UA_YELLOW,
} from "./liveries";
import type { MaterialName, ModelPart, TypeModel } from "./models";

function liveryOfType(id: string): string | null {
  const type = typeDef(typeIndex(id));
  return liveryOf(type.id, type.category, type.armor);
}

describe("vehicle liveries", () => {
  it("AC-13-01: livery by type", () => {
    for (const id of [
      "ua-bradley",
      "ua-leopard-2a4",
      "ua-himars",
      "ua-dozer",
      "ua-supply-truck",
      "ua-kozak-scout",
    ]) {
      expect(liveryOfType(id)).toBe(LIVERIES.ua);
    }
    for (const id of [
      "ru-t-72b3",
      "ru-bmp-2",
      "ru-brdm-scout",
      "ru-tos-1a",
      "ru-dozer",
      "ru-supply-truck",
    ]) {
      expect(liveryOfType(id)).toBe(LIVERIES.ru);
    }
    for (const id of [
      "ua-rifleman",
      "ru-rifleman",
      "ru-rpg-gunner",
      "ua-hq",
      "ru-barracks",
      "ua-defense",
      "supply-depot",
    ]) {
      expect(liveryOfType(id)).toBeNull();
    }
  });

  it("AC-13-02: Ukrainian flag bands", () => {
    for (const u of [0.1, 0.5, 0.9]) {
      expect(liverySample("ua", u, 0.75)).toEqual({ color: UA_BLUE, alpha: 1 });
      expect(liverySample("ua", u, 0.25)).toEqual({
        color: UA_YELLOW,
        alpha: 1,
      });
    }
  });

  it("AC-13-03: Russian Z", () => {
    for (const [u, v] of [
      [0.5, 0.85],
      [0.5, 0.15],
      [0.5, 0.5],
    ] as const) {
      expect(liverySample("ru", u, v)).toEqual({ color: RU_WHITE, alpha: 1 });
    }
    for (const [u, v] of [
      [0.2, 0.5],
      [0.8, 0.5],
      [0.2, 0.65],
      [0.8, 0.35],
      [0, 0.5],
      [1, 1],
    ] as const) {
      expect(liverySample("ru", u, v).alpha).toBe(0);
    }
  });

  it("AC-13-04: mask by face", () => {
    const build = (): BufferGeometry => {
      const box = new BoxGeometry(2, 1, 4).toNonIndexed();
      box.setAttribute(
        DARK_MASK,
        new Float32BufferAttribute(
          new Float32Array(box.getAttribute("position").count),
          1,
        ),
      );
      return box;
    };
    const maskOf = (livery: "ua" | "ru"): Map<string, Set<number>> => {
      const geometry = addLiveryAttribute(build(), livery);
      const normal = geometry.getAttribute("normal");
      const livery3 = geometry.getAttribute("livery");
      expect(livery3.itemSize).toBe(3);
      const byFace = new Map<string, Set<number>>();
      for (let i = 0; i < normal.count; i++) {
        const key = `${normal.getX(i)},${normal.getY(i)},${normal.getZ(i)}`;
        const set = byFace.get(key) ?? new Set<number>();
        set.add(livery3.getZ(i));
        byFace.set(key, set);
      }
      return byFace;
    };
    const ru = maskOf("ru");
    expect(ru.get("1,0,0")).toEqual(new Set([1]));
    expect(ru.get("-1,0,0")).toEqual(new Set([1]));
    expect(ru.get("0,1,0")).toEqual(new Set([1]));
    expect(ru.get("0,0,1")).toEqual(new Set([0]));
    expect(ru.get("0,-1,0")).toEqual(new Set([0]));
    const ua = maskOf("ua");
    expect(ua.get("0,0,1")).toEqual(new Set([1]));
    expect(ua.get("0,0,-1")).toEqual(new Set([1]));
    expect(ua.get("0,-1,0")).toEqual(new Set([0]));

    // Dark vertices never get the livery.
    const dark = build();
    dark.setAttribute(
      DARK_MASK,
      new Float32BufferAttribute(
        new Float32Array(dark.getAttribute("position").count).fill(1),
        1,
      ),
    );
    const attribute = addLiveryAttribute(dark, "ru").getAttribute("livery");
    for (let i = 0; i < attribute.count; i++) expect(attribute.getZ(i)).toBe(0);
  });

  it("AC-13-07: the Z sits whole on the largest flat surface", () => {
    // A big low block and a small tall block: the glyph goes on the big top only.
    const big = new BoxGeometry(4, 1, 4).translate(0, 0.5, 0).toNonIndexed();
    const small = new BoxGeometry(1, 1, 1).translate(0, 1.5, 0).toNonIndexed();
    const merged = mergeGeometries([big, small], false);
    merged.setAttribute(
      DARK_MASK,
      new Float32BufferAttribute(
        new Float32Array(merged.getAttribute("position").count),
        1,
      ),
    );
    const geometry = addLiveryAttribute(merged, "ru");
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const attribute = geometry.getAttribute("livery");
    const tops = new Map<number, number[]>();
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) !== 1) continue;
      const height = position.getY(i);
      tops.set(height, [...(tops.get(height) ?? []), attribute.getZ(i)]);
    }
    expect(new Set(tops.get(1))).toEqual(new Set([1]));
    expect(new Set(tops.get(2))).toEqual(new Set([0]));
    // The glyph is centred on the big top: its corner is at 0.5 +- 0.5 / 0.8.
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) === 1 && position.getY(i) === 1) {
        expect(Math.abs(attribute.getX(i) - 0.5)).toBeCloseTo(0.5 / 0.8, 5);
      }
    }
  });

  it("AC-13-08: the Z avoids what stands on the roof", () => {
    // A cab (dark) covers the back half of the roof: the glyph centres on the front half.
    const base = new BoxGeometry(4, 1, 4).translate(0, 0.5, 0).toNonIndexed();
    const cab = new BoxGeometry(4, 1, 2).translate(0, 1.5, -1).toNonIndexed();
    const mask = (geometry: BufferGeometry, value: number) =>
      geometry.setAttribute(
        DARK_MASK,
        new Float32BufferAttribute(
          new Float32Array(geometry.getAttribute("position").count).fill(value),
          1,
        ),
      );
    mask(base, 0);
    mask(cab, 1);
    const geometry = addLiveryAttribute(
      mergeGeometries([base, cab], false),
      "ru",
    );
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const attribute = geometry.getAttribute("livery");
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) !== 1 || position.getY(i) !== 1) continue;
      // Free strip z in [0, 2]: 2 units deep, glyph 1.6 units, centre at z = 1.
      expect(attribute.getY(i)).toBeCloseTo(
        0.5 + (position.getZ(i) - 1) / 1.6,
        5,
      );
    }
  });

  it("AC-13-05: renderer slots", () => {
    const registry = {
      get: (): TypeModel => ({
        parts: new Map<MaterialName, ModelPart>([
          [
            "body",
            {
              material: "body",
              geometry: new BoxGeometry(1, 1, 2),
              color: 0x112233,
            },
          ],
        ]),
        turret: new Map<MaterialName, ModelPart>(),
        pivot: new Vector3(),
        fallback: false,
      }),
    };
    const entity = (id: number, type: string): EntityState => ({
      id,
      owner: 0,
      kind: typeIndex(type),
      x: 2,
      y: 2,
      hp: 100,
      flags: 0,
      progress: 0,
      target: null,
    });
    const renderer = createEntityRenderer(8, registry);
    renderer.update(
      [
        entity(0, "ua-bradley"),
        entity(1, "ru-t-72b3"),
        entity(2, "ua-rifleman"),
        entity(3, "ru-barracks"),
      ],
      new Set(),
    );
    const slotOf = (typeId: string) => {
      const slot = renderer.models.find(
        (model) => model.typeId === typeId && model.material === "body",
      );
      if (slot === undefined) throw new Error(`no slot ${typeId}`);
      return slot.mesh;
    };
    for (const id of ["ua-bradley", "ru-t-72b3"]) {
      const mesh = slotOf(id);
      expect(mesh.geometry.getAttribute("livery")).toBeDefined();
      expect(
        (mesh.material as MeshLambertMaterial).userData.liveryMap.value,
      ).not.toBeNull();
    }
    for (const id of ["ua-rifleman", "ru-barracks"]) {
      const mesh = slotOf(id);
      expect(mesh.geometry.hasAttribute("livery")).toBe(false);
    }
  });
});

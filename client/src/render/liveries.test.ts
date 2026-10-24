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
  RU_BLUE,
  RU_RED,
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

  it("AC-13-02: Ukrainian flag patch", () => {
    for (const u of [0.2, 0.5, 0.8]) {
      expect(liverySample("ua", "mark", u, 0.75)).toEqual({
        color: UA_BLUE,
        alpha: 1,
      });
      expect(liverySample("ua", "mark", u, 0.25)).toEqual({
        color: UA_YELLOW,
        alpha: 1,
      });
    }
    // A painted patch: ragged and transparent at the border, nothing outside.
    expect(liverySample("ua", "mark", 0.5, 0).alpha).toBe(0);
    expect(liverySample("ua", "mark", 1, 0.5).alpha).toBe(0);
  });

  it("AC-13-03: Russian Z sprayed on the skin, tricolour flag apart", () => {
    // The Z is white paint with no background: centre, top bar, bottom bar.
    for (const [u, v] of [
      [0.5, 0.5],
      [0.5, 0.865],
      [0.5, 0.135],
    ] as const) {
      expect(liverySample("ru", "mark", u, v)).toEqual({
        color: RU_WHITE,
        alpha: 1,
      });
    }
    // Painted, not sprayed: a firm edge and nothing around the strokes.
    expect(liverySample("ru", "mark", 0.5, 0.95).alpha).toBe(0);
    expect(liverySample("ru", "mark", 0.05, 0.5).alpha).toBe(0);
    expect(liverySample("ru", "mark", 0.9, 0.5).alpha).toBe(0);
    // The flag decal is the tricolour alone: white, blue, red from the top.
    expect(liverySample("ru", "flag", 0.5, 0.915)).toEqual({
      color: RU_WHITE,
      alpha: 1,
    });
    expect(liverySample("ru", "flag", 0.5, 0.5)).toEqual({
      color: RU_BLUE,
      alpha: 1,
    });
    expect(liverySample("ru", "flag", 0.5, 0.085)).toEqual({
      color: RU_RED,
      alpha: 1,
    });
    expect(liverySample("ru", "flag", 0, 0.5).alpha).toBe(0);
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
      const geometry = addLiveryAttribute(build(), livery, [], {
        hasTurret: true,
      });
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
    // The Z (mask 1) takes the roof, the best surface; the tricolour (mask 2)
    // the sides.
    expect(ru.get("0,1,0")).toEqual(new Set([3]));
    const sides = [ru.get("1,0,0"), ru.get("-1,0,0")].map((set) => [
      ...(set ?? []),
    ]);
    expect(sides.flat().sort()).toEqual([2, 2]);
    expect(ru.get("0,0,1")).toEqual(new Set([0]));
    expect(ru.get("0,-1,0")).toEqual(new Set([0]));
    // The Ukrainian flag patches sit on all of them: sides and roof only.
    const ua = maskOf("ua");
    expect(ua.get("1,0,0")).toEqual(new Set([1]));
    expect(ua.get("0,1,0")).toEqual(new Set([1]));
    expect(ua.get("0,0,1")).toEqual(new Set([0]));
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
    const geometry = addLiveryAttribute(merged, "ru", [], { hasTurret: true });
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const attribute = geometry.getAttribute("livery");
    const tops = new Map<number, number[]>();
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) !== 1) continue;
      const height = position.getY(i);
      tops.set(height, [...(tops.get(height) ?? []), attribute.getZ(i)]);
    }
    expect(new Set(tops.get(1))).toEqual(new Set([3]));
    expect(new Set(tops.get(2))).toEqual(new Set([0]));
    // The glyph is centred on the big top: its corner is at 0.5 +- 0.5 / 1.1.
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) === 1 && position.getY(i) === 1) {
        expect(Math.abs(attribute.getX(i) - 0.5)).toBeCloseTo(0.5 / 1.1, 5);
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
      [],
      { hasTurret: true },
    );
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const attribute = geometry.getAttribute("livery");
    for (let i = 0; i < position.count; i++) {
      if (normal.getY(i) !== 1 || position.getY(i) !== 1) continue;
      // Free strip z in [0, 2]: 2 units deep, glyph 1.6 units, centre at z = 1.
      expect(attribute.getY(i)).toBeCloseTo(
        0.5 + (position.getZ(i) - 1) / 2.2,
        5,
      );
    }
  });

  it("AC-13-10: Russian decals follow the owner's marks", () => {
    // A hull without a turret (truck, dozer): flag on the cab roof (front), Z on the other roof.
    const bed = new BoxGeometry(2, 1, 3).translate(0, 0.5, -1.5).toNonIndexed();
    const cab = new BoxGeometry(2, 0.6, 1)
      .translate(0, 0.3, 0.5)
      .toNonIndexed();
    const merged = mergeGeometries([bed, cab], false);
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
    const maskAt = (height: number): number[] => {
      const values = new Set<number>();
      for (let i = 0; i < position.count; i++) {
        if (
          normal.getY(i) === 1 &&
          Math.abs(position.getY(i) - height) < 1e-6
        ) {
          values.add(attribute.getZ(i));
        }
      }
      return [...values];
    };
    expect(maskAt(0.6)).toEqual([2]); // cab roof: tricolour
    expect(maskAt(1)).toEqual([3]); // bed roof: the Z

    // Turret roofs: the flag, or the Z when the type asks for it.
    const roof = (zOnTurret: boolean): number[] => {
      const box = new BoxGeometry(1, 1, 1).toNonIndexed();
      box.setAttribute(
        DARK_MASK,
        new Float32BufferAttribute(
          new Float32Array(box.getAttribute("position").count),
          1,
        ),
      );
      const result = addLiveryAttribute(box, "ru", [], {
        turret: true,
        zOnTurret,
      });
      const n = result.getAttribute("normal");
      const l = result.getAttribute("livery");
      const values = new Set<number>();
      for (let i = 0; i < n.count; i++) {
        if (n.getY(i) === 1) values.add(l.getZ(i));
      }
      return [...values];
    };
    expect(roof(false)).toEqual([2]);
    expect(roof(true)).toEqual([3]);
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
      heading: 0,
      turretAngle: 0,
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

import { Color, type InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState, NEUTRAL } from "../sim/matchSnapshot";
import { createEntityRenderer, OWNER_COLORS, SELECTED_COLOR } from "./entities";

function expectInstanceColor(
  mesh: InstancedMesh,
  index: number,
  hex: number,
): void {
  const actual = new Color();
  mesh.getColorAt(index, actual);
  const expected = new Color(hex);
  expect(actual.r).toBeCloseTo(expected.r, 6);
  expect(actual.g).toBeCloseTo(expected.g, 6);
  expect(actual.b).toBeCloseTo(expected.b, 6);
}

function entity(
  id: number,
  owner: number,
  type: string,
  x: number,
  y: number,
  hp: number,
  extra: Partial<EntityState> = {},
): EntityState {
  return {
    id,
    owner,
    kind: typeIndex(type),
    x,
    y,
    hp,
    flags: 0,
    progress: 0,
    target: null,
    ...extra,
  };
}

describe("entity renderer", () => {
  it("AC-03-54: renders entities, bars and tracers", () => {
    const renderer = createEntityRenderer(100);
    const entities: EntityState[] = [
      entity(0, 0, "ua-rifleman", 1, 2, 100),
      entity(1, 1, "ru-rifleman", 3, 4, 90, {
        flags: ENTITY_FLAGS.fired,
        target: 0,
      }),
      entity(2, 0, "ua-power-plant", 6, 6, 1000),
      entity(3, 0, "ua-barracks", 10, 6, 10, {
        flags: ENTITY_FLAGS.underConstruction,
        progress: 500,
      }),
      entity(4, 1, "ru-hq", 20, 20, 3000, { flags: ENTITY_FLAGS.ghost }),
      entity(5, NEUTRAL, "supply-depot", 15, 15, 5000),
    ];
    renderer.update(entities, new Set([1]));

    expect(renderer.units.count).toBe(2);
    expectInstanceColor(renderer.units, 0, OWNER_COLORS[0]);
    expectInstanceColor(renderer.units, 1, SELECTED_COLOR);
    const matrix = new Matrix4();
    renderer.units.getMatrixAt(0, matrix);
    const translation = new Vector3();
    const scale = new Vector3();
    matrix.decompose(translation, new Quaternion(), scale);
    expect(translation.x).toBeCloseTo(1, 6);
    expect(translation.y).toBeCloseTo(0.3, 6);
    expect(translation.z).toBeCloseTo(2, 6);
    expect(scale.x).toBeCloseTo(0.3, 6);
    expect(scale.y).toBeCloseTo(0.6, 6);
    expect(scale.z).toBeCloseTo(0.3, 6);

    expect(renderer.buildings.count).toBe(3);
    renderer.buildings.getMatrixAt(1, matrix);
    expect(new Vector3().setFromMatrixScale(matrix).y).toBeCloseTo(
      0.9 * 0.6,
      6,
    );
    expect(renderer.ghosts.count).toBe(1);
    expect(renderer.bars.count).toBe(2);
    expect(renderer.tracers.geometry.drawRange.count).toBe(2);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rebuilds no id lookup Map per frame and keeps tracers", () => {
    const renderer = createEntityRenderer(100);
    const entities: EntityState[] = [
      entity(0, 0, "ua-rifleman", 1, 2, 100),
      entity(1, 1, "ru-rifleman", 3, 4, 90, {
        flags: ENTITY_FLAGS.fired,
        target: 0,
      }),
    ];
    renderer.update(entities, new Set());
    let maps = 0;
    const NativeMap = Map;
    vi.stubGlobal(
      "Map",
      class<K, V> extends NativeMap<K, V> {
        constructor(entries?: Iterable<readonly [K, V]> | null) {
          super(entries);
          maps++;
        }
      },
    );
    renderer.update(entities, new Set());
    vi.unstubAllGlobals();
    expect(maps).toBe(0);
    expect(renderer.tracers.geometry.drawRange.count).toBe(2);
    const positions = renderer.tracers.geometry.getAttribute("position");
    expect(positions.getX(1)).toBeCloseTo(1, 6);
    expect(positions.getZ(1)).toBeCloseTo(2, 6);

    renderer.update([entities[1] as EntityState], new Set());
    expect(renderer.tracers.geometry.drawRange.count).toBe(0);
  });
});

import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  type InstancedMesh,
  Matrix4,
  type MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { typeDef, typeIndex } from "../rules";
import { ENTITY_FLAGS, type EntityState, NEUTRAL } from "../sim/matchSnapshot";
import { bobHeight, createAnimator, RECOIL_TILES } from "./animation";
import {
  createEntityRenderer,
  type EntityRenderer,
  OWNER_COLORS,
  SELECTED_COLOR,
  scaffoldGeometry,
} from "./entities";
import type {
  MaterialName,
  ModelPart,
  ModelRegistry,
  TypeModel,
} from "./models";

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

function modelRegistry(): ModelRegistry {
  return {
    get: (): TypeModel => ({
      parts: new Map<MaterialName, ModelPart>([
        [
          "body",
          {
            material: "body",
            geometry: new BoxGeometry(1, 1, 1),
            color: 0x112233,
          },
        ],
        [
          "team",
          {
            material: "team",
            geometry: new BoxGeometry(0.5, 0.5, 0.5),
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

function partMesh(
  renderer: EntityRenderer,
  typeId: string,
  material: MaterialName,
): InstancedMesh {
  const found = renderer.models.find(
    (model) =>
      model.typeId === typeId &&
      model.group === "hull" &&
      model.material === material,
  );
  if (found === undefined)
    throw new Error(`missing ${typeId}/${material} mesh`);
  return found.mesh;
}

/** A registry whose tank type carries a turret (so it can recoil) and whose
 *  infantry type does not (spec 09 §4). */
function turretedRegistry(): ModelRegistry {
  const tank = (): TypeModel => ({
    parts: new Map<MaterialName, ModelPart>([
      [
        "body",
        {
          material: "body",
          geometry: new BoxGeometry(1, 1, 1),
          color: 0x223344,
        },
      ],
    ]),
    turret: new Map<MaterialName, ModelPart>([
      [
        "body",
        {
          material: "body",
          geometry: new BoxGeometry(0.3, 0.3, 0.7),
          color: 0x443322,
        },
      ],
    ]),
    pivot: new Vector3(0, 0.4, 0.15),
    fallback: false,
  });
  const infantry = (): TypeModel => ({
    parts: new Map<MaterialName, ModelPart>([
      [
        "body",
        {
          material: "body",
          geometry: new BoxGeometry(1, 1, 1),
          color: 0x443322,
        },
      ],
    ]),
    turret: new Map<MaterialName, ModelPart>(),
    pivot: new Vector3(),
    fallback: false,
  });
  return {
    get: (typeId) => (typeId === "ua-leopard-2a4" ? tank() : infantry()),
  };
}

function instanceTranslation(mesh: InstancedMesh): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(0, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

function hullSlot(renderer: EntityRenderer, typeId: string): InstancedMesh {
  const found = renderer.models.find(
    (model) => model.typeId === typeId && model.group === "hull",
  );
  if (found === undefined) throw new Error(`no hull for ${typeId}`);
  return found.mesh;
}

function turretSlot(renderer: EntityRenderer, typeId: string): InstancedMesh {
  const found = renderer.models.find(
    (model) => model.typeId === typeId && model.group === "turret",
  );
  if (found === undefined) throw new Error(`no turret for ${typeId}`);
  return found.mesh;
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

  it("AC-06-04: instanced model rendering", () => {
    const renderer = createEntityRenderer(100, modelRegistry());
    renderer.update(
      [
        entity(0, 0, "ua-rifleman", 1, 1, 100),
        entity(1, 1, "ua-rifleman", 2, 2, 100),
        entity(2, 0, "ru-rifleman", 3, 3, 100),
      ],
      new Set([1]),
    );

    const body = partMesh(renderer, "ua-rifleman", "body");
    const team = partMesh(renderer, "ua-rifleman", "team");
    expect(body.count).toBe(2);
    expect(team.count).toBe(2);
    expectInstanceColor(body, 0, 0xffffff);
    expectInstanceColor(body, 1, 0xffffff);
    expectInstanceColor(team, 0, OWNER_COLORS[0]);
    expectInstanceColor(team, 1, SELECTED_COLOR);

    const enemyBody = partMesh(renderer, "ru-rifleman", "body");
    const enemyTeam = partMesh(renderer, "ru-rifleman", "team");
    expect(enemyBody.count).toBe(1);
    expect(enemyTeam.count).toBe(1);
    expectInstanceColor(enemyTeam, 0, OWNER_COLORS[0]);

    expect(renderer.models.length).toBe(4);
  });

  it("AC-09-03: animated instances", () => {
    const now = 1_000;
    const animator = createAnimator();
    const tank = entity(7, 0, "ua-leopard-2a4", 3, 4, 100, {
      flags: ENTITY_FLAGS.fired,
    });
    const rifleman = entity(8, 0, "ua-rifleman", 5, 6, 100, {
      flags: ENTITY_FLAGS.moving,
    });

    const withAnim = createEntityRenderer(50, turretedRegistry(), animator);
    // Without an animator the output is today's: no recoil, no lift.
    const without = createEntityRenderer(50, turretedRegistry());

    animator.recordShots([tank], now);
    withAnim.update([tank, rifleman], new Set(), now);
    without.update([tank, rifleman], new Set());

    const tankHull = instanceTranslation(hullSlot(withAnim, "ua-leopard-2a4"));
    const tankTurret = instanceTranslation(
      turretSlot(withAnim, "ua-leopard-2a4"),
    );
    const restTurret = instanceTranslation(
      turretSlot(without, "ua-leopard-2a4"),
    );

    // A fired tank (armor != 0) does not bob; its hull is not moved by recoil.
    expect(tankHull.y).toBeCloseTo(0, 6);

    // The turret sits RECOIL_TILES behind its rest position along the facing
    // (facing is world +Z here, hullYaw and turretYaw are 0).
    expect(restTurret.z - tankTurret.z).toBeCloseTo(RECOIL_TILES, 6);

    // Without an animator the turret does not recoil and the hull is at rest.
    expect(
      instanceTranslation(turretSlot(without, "ua-leopard-2a4")).z,
    ).toBeCloseTo(restTurret.z, 6);
    expect(
      instanceTranslation(hullSlot(without, "ua-leopard-2a4")).y,
    ).toBeCloseTo(0, 6);

    // A moving infantry unit's hull is raised by its lift (bobHeight).
    const rifleHull = instanceTranslation(hullSlot(withAnim, "ua-rifleman"));
    expect(rifleHull.y).toBeCloseTo(bobHeight(8, now), 6);
    expect(rifleHull.y).toBeGreaterThan(0);
  });

  it("AC-09-04: scaffolding", () => {
    // `scaffoldGeometry()` is 16 beams (16 x 12 triangles) inside the unit box.
    const geometry = scaffoldGeometry();
    // `scaffoldGeometry()` returns a non-indexed geometry, so the triangle
    // count is the vertex count divided by 3.
    const triangleCount = (geometry.attributes.position?.count ?? 0) / 3;
    expect(triangleCount).toBe(16 * 12);

    // A base with nothing under construction keeps the draw-call bound:
    // `scaffolds` draws no instances and stays invisible.
    const empty = createEntityRenderer(100);
    empty.update([entity(0, 0, "ua-power-plant", 6, 6, 1000)], new Set());
    expect(empty.scaffolds.count).toBe(0);
    expect(empty.scaffolds.visible).toBe(false);

    // The full render box the scaffold is scaled to.
    const [w, h, d] = typeDef(typeIndex("ua-power-plant")).render.size.map(
      (size) => size / 100,
    ) as [number, number, number];

    // One building under construction adds exactly one instance at (x, 0, y)
    // scaled to its render box; a finished building, a unit and a ghost add
    // none.
    const renderer = createEntityRenderer(100);
    renderer.update(
      [
        entity(0, 0, "ua-power-plant", 6, 6, 1000, {
          flags: ENTITY_FLAGS.underConstruction,
          progress: 500,
        }),
        entity(1, 0, "ua-barracks", 10, 6, 10),
        entity(2, 1, "ru-rifleman", 3, 4, 90, {
          flags: ENTITY_FLAGS.underConstruction,
        }),
        entity(3, 1, "ru-hq", 20, 20, 3000, { flags: ENTITY_FLAGS.ghost }),
      ],
      new Set(),
    );

    expect(renderer.scaffolds.count).toBe(1);
    expect(renderer.scaffolds.visible).toBe(true);

    const matrix = new Matrix4();
    renderer.scaffolds.getMatrixAt(0, matrix);
    const translation = new Vector3();
    const scale = new Vector3();
    matrix.decompose(translation, new Quaternion(), scale);
    expect(translation.x).toBeCloseTo(6, 6);
    expect(translation.y).toBeCloseTo(0, 6);
    expect(translation.z).toBeCloseTo(6, 6);
    expect(scale.x).toBeCloseTo(w, 6);
    expect(scale.y).toBeCloseTo(h, 6);
    expect(scale.z).toBeCloseTo(d, 6);
  });

  it("AC-10-04: model detail", () => {
    /** A box carrying a glTF-style RGBA `COLOR_0` (three's `color`) of `ao`. */
    const occluded = (size: number, ao: number): BufferGeometry => {
      const geometry = new BoxGeometry(size, size, size);
      const count = geometry.getAttribute("position").count;
      const colors = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) colors.set([ao, ao, ao, 1], i * 4);
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
      return geometry;
    };
    const registry = (withAo: boolean): ModelRegistry => ({
      get: (): TypeModel => ({
        parts: new Map<MaterialName, ModelPart>([
          [
            "body",
            {
              material: "body",
              geometry: withAo ? occluded(1, 0.5) : new BoxGeometry(1, 1, 1),
              color: 0x88aacc,
            },
          ],
          [
            "team",
            {
              material: "team",
              geometry: withAo
                ? occluded(0.5, 0.5)
                : new BoxGeometry(0.5, 0.5, 0.5),
              color: 0xffffff,
            },
          ],
        ]),
        turret: new Map<MaterialName, ModelPart>(),
        pivot: new Vector3(),
        fallback: false,
      }),
    });
    const render = (withAo: boolean): EntityRenderer => {
      const renderer = createEntityRenderer(10, registry(withAo));
      renderer.update([entity(0, 0, "ua-rifleman", 1, 1, 100)], new Set());
      return renderer;
    };
    const material = new Color(0x88aacc);

    // COLOR_0 = 0.5 on `body`: every vertex colour is half the material colour.
    const shaded = render(true);
    const body = partMesh(shaded, "ua-rifleman", "body");
    const colors = body.geometry.getAttribute("color");
    expect(colors.count).toBeGreaterThan(0);
    for (let i = 0; i < colors.count; i++) {
      expect(colors.getX(i)).toBeCloseTo(material.r * 0.5, 6);
      expect(colors.getY(i)).toBeCloseTo(material.g * 0.5, 6);
      expect(colors.getZ(i)).toBeCloseTo(material.b * 0.5, 6);
    }
    // The `team` material shades its instance colour by COLOR_0.
    const team = partMesh(shaded, "ua-rifleman", "team");
    expect((team.material as MeshLambertMaterial).vertexColors).toBe(true);

    // Without COLOR_0 the output is today's: the plain material colour.
    const plain = render(false);
    const plainColors = partMesh(
      plain,
      "ua-rifleman",
      "body",
    ).geometry.getAttribute("color");
    for (let i = 0; i < plainColors.count; i++) {
      expect(plainColors.getX(i)).toBeCloseTo(material.r, 6);
      expect(plainColors.getY(i)).toBeCloseTo(material.g, 6);
      expect(plainColors.getZ(i)).toBeCloseTo(material.b, 6);
    }
    const plainTeam = partMesh(plain, "ua-rifleman", "team");
    expect((plainTeam.material as MeshLambertMaterial).vertexColors).toBe(
      false,
    );
  });
});

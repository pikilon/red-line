import { describe, expect, it } from "vitest";
import { typeIndex } from "../rules";
import { FEATURE_NO_OWNER, type FeatureRow } from "../sim/featureSnapshot";
import { ENTITY_FLAGS, type EntityState } from "../sim/matchSnapshot";
import { commandButtons } from "../ui/commandPanel";
import {
  blockSelection,
  evacuationOf,
  type GarrisonFeature,
  garrisonFeaturesOf,
  garrisonOffers,
  resolveGarrisonClick,
  selectOccupantsAt,
  withLiveState,
} from "./garrison";

const unit = (
  id: number,
  owner: number,
  kind: string,
  x: number,
  y: number,
  flags = 0,
): EntityState => ({
  id,
  owner,
  kind: typeIndex(kind),
  x,
  y,
  hp: 100,
  flags,
  progress: 0,
  target: null,
  heading: 0,
  turretAngle: 0,
});

// Feature types: 0 = a 3x3 block that garrisons 2, 1 = a lamp that does not.
const types = [
  { footprint: [3, 3] as const, garrison: { slots: 2 } },
  { footprint: [1, 1] as const },
];
// Rows: the lamp is row 0, the block row 1 at (10, 10), a rotated 4x2 house row 2.
const features = garrisonFeaturesOf(
  [
    { type: 1, x: 5, y: 5, rot: 0 },
    { type: 0, x: 10, y: 10, rot: 0 },
    { type: 0, x: 20, y: 10, rot: 1 },
  ],
  types,
);

describe("garrison interface (spec 31 block 2)", () => {
  it("keeps the sim's row index and rotates footprints", () => {
    expect(features.map((feature) => feature.index)).toEqual([1, 2]);
    expect(features[1]).toMatchObject({ width: 3, height: 3, slots: 2 });
  });

  it("click on a building sends the selected infantry in", () => {
    const entities = [
      unit(1, 0, "ua-rifleman", 9, 14),
      unit(2, 0, "ua-leopard-2a4", 8, 14),
    ];
    const commands = resolveGarrisonClick({
      player: 0,
      selected: [1, 2],
      entities,
      features,
      x: 11,
      y: 11,
    });
    expect(commands).toEqual([
      { kind: "garrison", player: 0, units: [1], feature: 1 },
    ]);
    expect(
      resolveGarrisonClick({
        player: 0,
        selected: [1],
        entities,
        features,
        x: 30,
        y: 30,
      }),
    ).toEqual([]);
  });

  it("skips an enemy-held building", () => {
    const held = [
      unit(5, 1, "ru-rifleman", 11.5, 11.5, ENTITY_FLAGS.inside),
      unit(1, 0, "ua-rifleman", 9, 14),
    ];
    const offers = garrisonOffers({
      player: 0,
      selected: [1],
      entities: held,
      features,
    });
    expect(offers.garrison).toBe(2);
  });

  it("follows the sim's feature table: hidden enemy riders, wrecks and rubble", () => {
    const row = (
      index: number,
      kind: number,
      more: Partial<FeatureRow> = {},
    ) => ({
      index,
      kind,
      state: 0,
      alive: true,
      burning: false,
      collapsing: false,
      hpPermille: 1000,
      owner: FEATURE_NO_OWNER,
      occupants: 0,
      ...more,
    });
    const shooter = [unit(1, 0, "ua-rifleman", 9, 14)];
    const offer = (rows: FeatureRow[]) =>
      garrisonOffers({
        player: 0,
        selected: [1],
        entities: shooter,
        features: withLiveState(features, rows),
      }).garrison;
    expect(offer([row(0, 1), row(1, 0), row(2, 0)])).toBe(1);
    // Enemy riders are hidden from the snapshot; the table still names the holder.
    expect(
      offer([row(0, 1), row(1, 0, { owner: 1, occupants: 1 }), row(2, 0)]),
    ).toBe(2);
    expect(
      offer([row(0, 1), row(1, 0, { owner: 0, occupants: 1 }), row(2, 0)]),
    ).toBe(1);
    expect(
      offer([row(0, 1), row(1, 0, { owner: 0, occupants: 2 }), row(2, 0)]),
    ).toBe(2);
    expect(offer([row(0, 1), row(1, 0, { state: 2 }), row(2, 0)])).toBe(2);
    expect(offer([row(0, 1), row(1, 0, { collapsing: true }), row(2, 0)])).toBe(
      2,
    );
    expect(
      offer([row(0, 1), row(1, 5), row(2, 0, { alive: false })]),
    ).toBeNull();
  });

  it("offers Garrison near a building and Evacuate for garrisoned units", () => {
    const entities = [
      unit(1, 0, "ua-rifleman", 9, 14),
      unit(6, 0, "ua-rifleman", 21, 11.5, ENTITY_FLAGS.inside),
    ];
    expect(
      garrisonOffers({ player: 0, selected: [1], entities, features }),
    ).toEqual({ garrison: 1, evacuate: null });
    expect(
      garrisonOffers({ player: 0, selected: [6], entities, features }),
    ).toEqual({ garrison: null, evacuate: 2 });
    expect(
      garrisonOffers({ player: 0, selected: [], entities, features }),
    ).toEqual({ garrison: null, evacuate: null });
  });

  it("selects the occupants of an own garrisoned building by clicking it", () => {
    const entities = [
      unit(6, 0, "ua-rifleman", 11.5, 11.5, ENTITY_FLAGS.inside),
      unit(7, 1, "ru-rifleman", 21, 11.5, ENTITY_FLAGS.inside),
    ];
    expect(
      selectOccupantsAt({ player: 0, entities, features, x: 10.2, y: 10.2 }),
    ).toEqual([6]);
    expect(
      selectOccupantsAt({ player: 0, entities, features, x: 21, y: 11 }),
    ).toEqual([]);
  });

  it("turns the offers into panel buttons", () => {
    const entities = [unit(1, 0, "ua-rifleman", 9, 14)];
    const buttons = commandButtons({
      selected: entities,
      ownEntities: entities,
      credits: 0,
      queue: null,
      garrison: { garrison: 1, evacuate: 2 },
    });
    expect(buttons.map((button) => [button.action, button.feature])).toEqual([
      ["garrison", 1],
      ["evacuate", 2],
    ]);
  });
});

describe("spec 35 §5c: a trench is one block", () => {
  const piece = (index: number, x: number, y: number): GarrisonFeature => ({
    index,
    kind: 0,
    x,
    y,
    width: 2,
    height: 1,
    slots: 3,
    trench: true,
  });
  // Two touching pieces and one apart.
  const features = [piece(1, 10, 10), piece(2, 12, 11), piece(3, 20, 10)];
  const inside = ENTITY_FLAGS.inside;
  const entities = [
    unit(1, 0, "ua-rifleman", 10.5, 10.5, inside),
    unit(2, 0, "ua-rifleman", 12.5, 11.5, inside),
    unit(3, 0, "ua-rifleman", 20.5, 10.5, inside),
    unit(4, 1, "ru-rifleman", 13.5, 11.5, inside),
    unit(5, 0, "ua-rifleman", 30, 30),
  ];

  it("picking one soldier in it picks all of ours in the whole trench", () => {
    expect(blockSelection([1], entities, features, 0)).toEqual([1, 2]);
    expect(blockSelection([5], entities, features, 0)).toEqual([5]);
  });

  it("evacuate empties every piece of the trench we hold", () => {
    expect(evacuationOf(1, features, entities, 0)).toEqual([1, 2]);
    expect(evacuationOf(3, features, entities, 0)).toEqual([3]);
  });
});

import { describe, expect, it } from "vitest";

import {
  decodeMatchSnapshot,
  ENTITY_STRIDE,
  interpolateEntities,
  MATCH_HEADER_LEN,
  type MatchSnapshot,
  OUTCOMES,
  QUEUE_SLOTS,
  QUEUE_STRIDE,
} from "./matchSnapshot";

describe("matchSnapshot", () => {
  it("AC-03-44: decodes a match snapshot", () => {
    // Player viewer (ukraine, faction 0). Layout per spec §5.15.
    const player = new Int32Array([
      // header (MATCH_HEADER_LEN): tick, viewer, credits, powerProduced, powerConsumed, outcome index, winner (-1), entityCount
      100,
      0, 5000, 12, 4, 0, -1, 2,
      // entity id=1 (ENTITY_STRIDE = 9): id, owner, kind, x raw, y raw, hp, flags, progress, target (-1 -> null)
      1,
      0, 2, 98304, 65536, 100, 1, 0, -1,
      // entity id=10: ...
      10, 0, 10, 0, 0, 3000, 0, 1000, -1,
      // queue_count = 1
      1,
      // queue (QUEUE_STRIDE = 8): building_id, headPermille, queue_len, kind_0..kind_4 (-1 slots dropped)
      12,
      500, 2, 3, 4, -1, -1, -1,
    ]);

    expect(decodeMatchSnapshot(player)).toEqual({
      tick: 100,
      viewer: 0,
      credits: 5000,
      powerProduced: 12,
      powerConsumed: 4,
      outcome: "ongoing",
      winner: null,
      entities: [
        {
          id: 1,
          owner: 0,
          kind: 2,
          x: 1.5,
          y: 1,
          hp: 100,
          flags: 1,
          progress: 0,
          target: null,
        },
        {
          id: 10,
          owner: 0,
          kind: 10,
          x: 0,
          y: 0,
          hp: 3000,
          flags: 0,
          progress: 1000,
          target: null,
        },
      ],
      queues: [{ building: 12, headPermille: 500, items: [3, 4] }],
    });

    // Observer viewer (255): credits and power are 0, no queues.
    const observer = new Int32Array([
      50,
      255,
      0,
      0,
      0,
      2,
      -1,
      1,
      5,
      1,
      20,
      0,
      0,
      850,
      0,
      0,
      -1,
      0, // queue_count = 0
    ]);

    expect(decodeMatchSnapshot(observer)).toEqual({
      tick: 50,
      viewer: 255,
      credits: 0,
      powerProduced: 0,
      powerConsumed: 0,
      outcome: "draw",
      winner: null,
      entities: [
        {
          id: 5,
          owner: 1,
          kind: 20,
          x: 0,
          y: 0,
          hp: 850,
          flags: 0,
          progress: 0,
          target: null,
        },
      ],
      queues: [],
    });

    // Layout constants.
    expect(MATCH_HEADER_LEN).toBe(8);
    expect(ENTITY_STRIDE).toBe(9);
    expect(QUEUE_SLOTS).toBe(5);
    expect(QUEUE_STRIDE).toBe(8);
    expect(OUTCOMES).toEqual(["ongoing", "winner", "draw"]);
  });

  it("AC-03-45: interpolates entities by id", () => {
    const prev: MatchSnapshot = {
      tick: 10,
      viewer: 0,
      credits: 100,
      powerProduced: 0,
      powerConsumed: 0,
      outcome: "ongoing",
      winner: null,
      entities: [
        {
          id: 1,
          owner: 0,
          kind: 2,
          x: 0,
          y: 0,
          hp: 100,
          flags: 0,
          progress: 0,
          target: null,
        },
        {
          id: 2,
          owner: 0,
          kind: 3,
          x: 8,
          y: -4,
          hp: 90,
          flags: 0,
          progress: 0,
          target: null,
        },
      ],
      queues: [],
    };
    const next: MatchSnapshot = {
      tick: 11,
      viewer: 0,
      credits: 100,
      powerProduced: 0,
      powerConsumed: 0,
      outcome: "ongoing",
      winner: null,
      entities: [
        {
          id: 1,
          owner: 0,
          kind: 2,
          x: 4,
          y: 6,
          hp: 88,
          flags: 1,
          progress: 250,
          target: 10,
        },
        {
          id: 99,
          owner: 0,
          kind: 8,
          x: 2,
          y: 2,
          hp: 300,
          flags: 0,
          progress: 0,
          target: null,
        },
      ],
      queues: [],
    };

    const mid = interpolateEntities(prev, next, 0.5);
    // id present in prev -> x/y interpolated; every other field from next.
    expect(mid[0]).toEqual({
      id: 1,
      owner: 0,
      kind: 2,
      x: 2,
      y: 3,
      hp: 88,
      flags: 1,
      progress: 250,
      target: 10,
    });
    // id absent from prev -> next's own values.
    expect(mid[1]).toEqual({
      id: 99,
      owner: 0,
      kind: 8,
      x: 2,
      y: 2,
      hp: 300,
      flags: 0,
      progress: 0,
      target: null,
    });
    // alpha clamped to [0, 1].
    expect(interpolateEntities(prev, next, -1)[0]).toMatchObject({
      x: 0,
      y: 0,
    });
    expect(interpolateEntities(prev, next, 2)[0]).toMatchObject({ x: 4, y: 6 });
  });
});

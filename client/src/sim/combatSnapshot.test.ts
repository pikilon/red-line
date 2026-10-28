import { describe, expect, it, vi } from "vitest";
import { decodeCombat } from "./combatSnapshot";
import type { WorkerToMain } from "./protocol";
import {
  createWorkerHandler,
  type SimFactory,
  type SkirmishSimLike,
} from "./workerHandler";

const FAKE_HASH = "00000000deadbeef";

/** A `SkirmishSimLike` whose only interesting method is `combat_for`. */
function skirmishSim(
  overrides: Partial<SkirmishSimLike> = {},
): SkirmishSimLike {
  return {
    map_width: () => 2,
    map_height: () => 2,
    map_tiles: () => new Uint8Array([0, 1, 0, 0]),
    tick: () => 0,
    step: vi.fn(),
    state_hash_hex: () => FAKE_HASH,
    enable_debug_commands: vi.fn(),
    attach_ai: vi.fn(),
    set_ai_active: vi.fn(),
    snapshot_for: () => new Int32Array([7, 0]),
    fog_for: () => new Uint8Array([0, 1, 1, 2]),
    command_move: vi.fn(),
    command_move_as: vi.fn(),
    command_attack: vi.fn(),
    command_attack_ground: vi.fn(),
    command_harvest: vi.fn(),
    command_construct: vi.fn(),
    command_resume: vi.fn(),
    command_produce: vi.fn(),
    command_cancel: vi.fn(),
    command_rally: vi.fn(),
    command_stop: vi.fn(),
    command_garrison: vi.fn(),
    command_unload: vi.fn(),
    command_board: vi.fn(),
    command_disembark: vi.fn(),
    command_repair: vi.fn(),
    command_dig: vi.fn(),
    debug_spawn: vi.fn(),
    debug_set_hp: vi.fn(),
    ...overrides,
  };
}

describe("combat snapshot", () => {
  it("AC-17-11: client decode", () => {
    // The AC-17-09 layout: projectile_count, 11 fields each, event_count, then
    // 7 fields per event (spec 17 §4.7). Raw fixed-point positions become tiles.
    const data = new Int32Array([
      1, 5, 1, 3, 7, 9, 98304, 65536, 131072, 196608, 10, 17, 3, 0, 5, 1, 3, 9,
      131072, 196608, 0, 6, 2, 0, -1, 65536, 65536, 1, 9, 4, -1, -1, 262144,
      327680,
    ]);
    expect(decodeCombat(data)).toEqual({
      projectiles: [
        {
          id: 5,
          owner: 1,
          weapon: 3,
          shooter: 7,
          target: 9,
          originX: 1.5,
          originY: 1,
          impactX: 2,
          impactY: 3,
          launchTick: 10,
          impactTick: 17,
        },
      ],
      events: [
        {
          kind: "detonate",
          projectile: 5,
          owner: 1,
          weapon: 3,
          hit: 9,
          x: 2,
          y: 3,
        },
        {
          kind: "detonate",
          projectile: 6,
          owner: 2,
          weapon: 0,
          hit: null,
          x: 1,
          y: 1,
        },
        {
          kind: "death",
          victim: 9,
          victimKind: 4,
          killer: null,
          weapon: null,
          x: 4,
          y: 5,
        },
      ],
    });

    const empty = new Int32Array([0, 0]);
    expect(decodeCombat(empty)).toEqual({ projectiles: [], events: [] });
  });

  it("AC-17-11: worker handler passes combat through", () => {
    const combat = new Int32Array([0, 0]);
    const combat_for = vi.fn(() => combat);
    const posted: { message: WorkerToMain; transfer?: Transferable[] }[] = [];
    const handler = createWorkerHandler(
      vi.fn<SimFactory>(),
      3,
      (message, transfer) => {
        posted.push({ message, transfer });
      },
      () => skirmishSim({ combat_for }),
    );

    handler.handle({
      type: "initSkirmish",
      seed: 1,
      mapId: "m",
      viewer: 0,
      speed: 1,
      debug: false,
    });
    const snapshot = posted.find((p) => p.message.type === "snapshot");
    expect(snapshot?.message).toEqual({
      type: "snapshot",
      data: new Int32Array([7, 0]),
      fog: new Uint8Array([0, 1, 1, 2]),
      combat,
    });
    expect(combat_for).toHaveBeenCalledWith(0);
    if (snapshot?.message.type === "snapshot") {
      expect(snapshot.transfer).toContain(combat.buffer);
    }

    // Without `combat_for` the message is unchanged (no `combat` property).
    const plain: { message: WorkerToMain; transfer?: Transferable[] }[] = [];
    const plainHandler = createWorkerHandler(
      vi.fn<SimFactory>(),
      3,
      (message, transfer) => {
        plain.push({ message, transfer });
      },
      () => skirmishSim(),
    );
    plainHandler.handle({
      type: "initSkirmish",
      seed: 1,
      mapId: "m",
      viewer: 0,
      speed: 1,
      debug: false,
    });
    const plainSnapshot = plain.find((p) => p.message.type === "snapshot");
    expect(plainSnapshot?.message).toEqual({
      type: "snapshot",
      data: new Int32Array([7, 0]),
      fog: new Uint8Array([0, 1, 1, 2]),
    });
  });
});

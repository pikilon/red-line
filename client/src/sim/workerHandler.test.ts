import { describe, expect, it, vi } from "vitest";
import type { SimCommand, WorkerToMain } from "./protocol";
import {
  createWorkerHandler,
  type Post,
  type SimFactory,
  type SimLike,
  type SkirmishSimLike,
} from "./workerHandler";

const FAKE_HASH = "00000000deadbeef";

function fakeSim() {
  const step = vi.fn<() => void>();
  const command_move =
    vi.fn<
      (unitIds: Uint32Array, targetXRaw: number, targetYRaw: number) => void
    >();
  const sim: SimLike = {
    map_width: () => 2,
    map_height: () => 2,
    map_tiles: () => new Uint8Array([0, 1, 0, 0]),
    tick: () => 0,
    command_move,
    step,
    snapshot: () => new Int32Array([0, 0]),
    state_hash_hex: () => FAKE_HASH,
  };
  return Object.assign(sim, { step, command_move });
}

function setup() {
  const sim = fakeSim();
  const factory = vi.fn<SimFactory>(() => sim);
  const posted: { message: WorkerToMain; transfer?: Transferable[] }[] = [];
  const post: Post = (message, transfer) => {
    posted.push({ message, transfer });
  };
  const handler = createWorkerHandler(factory, 1, post);
  return { sim, factory, posted, handler };
}

describe("worker handler", () => {
  it("AC-02-28: init posts ready and a snapshot, or an error", () => {
    const { factory, posted, handler } = setup();
    handler.handle({ type: "init", seed: 1, unitCount: 3 });
    expect(factory).toHaveBeenCalledWith(1, 3);
    expect(posted.map((p) => p.message.type)).toEqual(["ready", "snapshot"]);
    expect(posted[0]?.message).toEqual({
      type: "ready",
      apiVersion: 1,
      mapWidth: 2,
      mapHeight: 2,
      tiles: new Uint8Array([0, 1, 0, 0]),
    });

    const failed: WorkerToMain[] = [];
    const failing = createWorkerHandler(
      () => {
        throw new Error("boom");
      },
      1,
      (message) => {
        failed.push(message);
      },
    );
    failing.handle({ type: "init", seed: 1, unitCount: 3 });
    expect(failed).toEqual([{ type: "error", detail: "Error: boom" }]);
  });

  it("AC-02-29: advance paces ticks at 15 Hz", () => {
    const { sim, posted, handler } = setup();
    handler.advance(0);
    handler.advance(100);
    expect(posted).toEqual([]);
    expect(sim.step).not.toHaveBeenCalled();

    handler.handle({ type: "init", seed: 1, unitCount: 3 });
    posted.length = 0;

    handler.advance(0);
    expect(sim.step).toHaveBeenCalledTimes(0);
    expect(posted).toHaveLength(0);

    handler.advance(100);
    expect(sim.step).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
    const first = posted[0];
    expect(first?.message.type).toBe("snapshot");
    if (first?.message.type === "snapshot") {
      expect(first.transfer).toEqual([first.message.data.buffer]);
    }

    handler.advance(150);
    expect(sim.step).toHaveBeenCalledTimes(2);
    expect(posted).toHaveLength(2);

    handler.advance(149);
    expect(sim.step).toHaveBeenCalledTimes(2);
    expect(posted).toHaveLength(2);

    handler.advance(10_000);
    expect(sim.step).toHaveBeenCalledTimes(6);
    expect(posted).toHaveLength(3);

    handler.advance(10_050);
    expect(sim.step).toHaveBeenCalledTimes(6);
    expect(posted).toHaveLength(3);
  });

  it("AC-02-30: forwards move and answers hash requests", () => {
    const { sim, posted, handler } = setup();
    handler.handle({
      type: "move",
      unitIds: [3, 1],
      targetXRaw: 65536,
      targetYRaw: 131072,
    });
    expect(sim.command_move).not.toHaveBeenCalled();
    expect(posted).toEqual([]);

    handler.handle({ type: "init", seed: 1, unitCount: 3 });
    posted.length = 0;
    handler.handle({
      type: "move",
      unitIds: [3, 1],
      targetXRaw: 65536,
      targetYRaw: 131072,
    });
    expect(sim.command_move).toHaveBeenCalledWith(
      new Uint32Array([3, 1]),
      65536,
      131072,
    );

    handler.handle({ type: "hashRequest", requestId: 9 });
    expect(posted.map((p) => p.message)).toEqual([
      { type: "hash", requestId: 9, hash: FAKE_HASH },
    ]);
  });

  it("AC-03-46: runs a skirmish, commands and speed", () => {
    const step = vi.fn<() => void>();
    const enable_debug_commands = vi.fn<() => void>();
    const command_move_as =
      vi.fn<
        (
          player: number,
          unitIds: Uint32Array,
          xRaw: number,
          yRaw: number,
        ) => void
      >();
    const command_attack =
      vi.fn<(player: number, unitIds: Uint32Array, target: number) => void>();
    const command_harvest =
      vi.fn<(player: number, unitIds: Uint32Array, depot: number) => void>();
    const command_construct =
      vi.fn<
        (
          player: number,
          dozer: number,
          kind: number,
          originX: number,
          originY: number,
        ) => void
      >();
    const command_resume =
      vi.fn<(player: number, unitIds: Uint32Array, building: number) => void>();
    const command_produce =
      vi.fn<(player: number, building: number, kind: number) => void>();
    const command_cancel = vi.fn<(player: number, building: number) => void>();
    const command_rally =
      vi.fn<
        (player: number, building: number, xRaw: number, yRaw: number) => void
      >();
    const command_stop =
      vi.fn<(player: number, unitIds: Uint32Array) => void>();
    const debug_spawn =
      vi.fn<
        (player: number, kind: number, xRaw: number, yRaw: number) => void
      >();
    const debug_set_hp = vi.fn<(entity: number, hp: number) => void>();
    const skirmishSim: SkirmishSimLike = {
      map_width: () => 2,
      map_height: () => 2,
      map_tiles: () => new Uint8Array([0, 1, 0, 0]),
      tick: () => 0,
      step,
      state_hash_hex: () => FAKE_HASH,
      enable_debug_commands,
      attach_ai: vi.fn(),
      snapshot_for: (viewer) => new Int32Array([viewer, viewer]),
      fog_for: (viewer) => new Uint8Array([viewer, viewer, viewer, viewer]),
      command_move: vi.fn(),
      command_move_as,
      command_attack,
      command_harvest,
      command_construct,
      command_resume,
      command_produce,
      command_cancel,
      command_rally,
      command_stop,
      debug_spawn,
      debug_set_hp,
    };

    const skirmishFactory = vi.fn(() => skirmishSim);
    const posted: { message: WorkerToMain; transfer?: Transferable[] }[] = [];
    const post: Post = (message, transfer) => {
      posted.push({ message, transfer });
    };
    const handler = createWorkerHandler(
      vi.fn<SimFactory>(),
      1,
      post,
      skirmishFactory,
    );

    handler.handle({
      type: "initSkirmish",
      seed: 3,
      mapId: "m",
      viewer: 1,
      speed: 2,
      debug: true,
    });
    expect(skirmishFactory).toHaveBeenCalledWith(3, "m");
    expect(enable_debug_commands).toHaveBeenCalledTimes(1);
    expect(posted.map((p) => p.message.type)).toEqual(["ready", "snapshot"]);
    expect(posted[0]?.message).toEqual({
      type: "ready",
      apiVersion: 1,
      mapWidth: 2,
      mapHeight: 2,
      tiles: new Uint8Array([0, 1, 0, 0]),
    });
    const initial = posted[1]?.message;
    expect(initial).toEqual({
      type: "snapshot",
      data: new Int32Array([1, 1]),
      fog: new Uint8Array([1, 1, 1, 1]),
    });
    if (initial?.type === "snapshot") {
      expect(posted[1]?.transfer).toEqual([
        initial.data.buffer,
        initial.fog?.buffer,
      ]);
    }

    posted.length = 0;
    handler.advance(0);
    expect(step).toHaveBeenCalledTimes(0);
    handler.advance(50);
    expect(step).toHaveBeenCalledTimes(1);
    handler.advance(90);
    expect(step).toHaveBeenCalledTimes(2);

    const commands: SimCommand[] = [
      {
        kind: "move",
        player: 1,
        units: [4, 5],
        xRaw: 65536,
        yRaw: 131072,
      },
      { kind: "attack", player: 1, units: [4], target: 9 },
      { kind: "harvest", player: 1, units: [5], depot: 0 },
      {
        kind: "construct",
        player: 1,
        dozer: 9,
        typeIndex: 3,
        originX: 18,
        originY: 64,
      },
      { kind: "resume", player: 1, units: [9], building: 16 },
      { kind: "produce", player: 1, building: 16, typeIndex: 5 },
      { kind: "cancel", player: 1, building: 16 },
      { kind: "rally", player: 1, building: 16, xRaw: 4194304, yRaw: 2097152 },
      { kind: "stop", player: 1, units: [4, 5] },
      { kind: "debugSpawn", player: 1, typeIndex: 5, xRaw: 1, yRaw: 2 },
      { kind: "debugSetHp", entity: 8, hp: 0 },
    ];
    for (const command of commands) {
      handler.handle({ type: "command", command });
    }
    expect(command_move_as).toHaveBeenCalledWith(
      1,
      new Uint32Array([4, 5]),
      65536,
      131072,
    );
    expect(command_attack).toHaveBeenCalledWith(1, new Uint32Array([4]), 9);
    expect(command_harvest).toHaveBeenCalledWith(1, new Uint32Array([5]), 0);
    expect(command_construct).toHaveBeenCalledWith(1, 9, 3, 18, 64);
    expect(command_resume).toHaveBeenCalledWith(1, new Uint32Array([9]), 16);
    expect(command_produce).toHaveBeenCalledWith(1, 16, 5);
    expect(command_cancel).toHaveBeenCalledWith(1, 16);
    expect(command_rally).toHaveBeenCalledWith(1, 16, 4194304, 2097152);
    expect(command_stop).toHaveBeenCalledWith(1, new Uint32Array([4, 5]));
    expect(debug_spawn).toHaveBeenCalledWith(1, 5, 1, 2);
    expect(debug_set_hp).toHaveBeenCalledWith(8, 0);

    posted.length = 0;
    handler.handle({ type: "setViewer", viewer: 0 });
    expect(posted).toHaveLength(1);
    const switched = posted[0]?.message;
    expect(switched).toEqual({
      type: "snapshot",
      data: new Int32Array([0, 0]),
      fog: new Uint8Array([0, 0, 0, 0]),
    });

    const failed: WorkerToMain[] = [];
    const withoutFactory = createWorkerHandler(
      vi.fn<SimFactory>(),
      1,
      (message) => {
        failed.push(message);
      },
    );
    withoutFactory.handle({
      type: "initSkirmish",
      seed: 3,
      mapId: "m",
      viewer: 1,
      speed: 1,
      debug: false,
    });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.type).toBe("error");

    const untouched = {
      map_width: () => 2,
      map_height: () => 2,
      map_tiles: () => new Uint8Array([0, 1, 0, 0]),
      tick: () => 0,
      step: vi.fn<() => void>(),
      state_hash_hex: () => FAKE_HASH,
      enable_debug_commands: vi.fn<() => void>(),
      attach_ai: vi.fn(),
      snapshot_for: () => new Int32Array([0, 0]),
      fog_for: () => new Uint8Array([0, 0, 0, 0]),
      command_move: vi.fn(),
      command_move_as: vi.fn(),
      command_attack: vi.fn(),
      command_harvest: vi.fn(),
      command_construct: vi.fn(),
      command_resume: vi.fn(),
      command_produce: vi.fn(),
      command_cancel: vi.fn(),
      command_rally: vi.fn(),
      command_stop: vi.fn(),
      debug_spawn: vi.fn(),
      debug_set_hp: vi.fn(),
    } satisfies SkirmishSimLike;
    const beforeInit = createWorkerHandler(
      vi.fn<SimFactory>(),
      1,
      post,
      () => untouched,
    );
    beforeInit.handle({
      type: "command",
      command: { kind: "produce", player: 0, building: 0, typeIndex: 1 },
    });
    beforeInit.advance(0);
    beforeInit.advance(100);
    expect(untouched.command_produce).not.toHaveBeenCalled();
    expect(untouched.step).not.toHaveBeenCalled();
  });
});

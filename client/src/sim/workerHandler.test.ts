import { describe, expect, it, vi } from "vitest";
import type { WorkerToMain } from "./protocol";
import {
  createWorkerHandler,
  type Post,
  type SimFactory,
  type SimLike,
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
});

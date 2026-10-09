import { describe, expect, it } from "vitest";
import type { MainToWorker, WorkerToMain } from "./protocol";
import { createSimClient, type WorkerLike } from "./simClient";
import type { Snapshot } from "./snapshot";

class FakeWorker implements WorkerLike {
  readonly sent: MainToWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null = null;

  postMessage(message: MainToWorker): void {
    this.sent.push(message);
  }

  emit(data: WorkerToMain): void {
    this.onmessage?.({ data } as MessageEvent<WorkerToMain>);
  }
}

const READY: WorkerToMain = {
  type: "ready",
  apiVersion: 2,
  mapWidth: 2,
  mapHeight: 2,
  tiles: new Uint8Array([0, 1, 0, 0]),
};

describe("sim client", () => {
  it("AC-02-31: wraps the worker protocol", async () => {
    const worker = new FakeWorker();
    const client = createSimClient(
      worker,
      { seed: 7, unitCount: 20 },
      () => 42,
    );
    expect(worker.sent).toEqual([{ type: "init", seed: 7, unitCount: 20 }]);

    worker.emit(READY);
    await expect(client.ready).resolves.toEqual(READY);

    const failingWorker = new FakeWorker();
    const failing = createSimClient(failingWorker, { seed: 1, unitCount: 1 });
    failingWorker.emit({ type: "error", detail: "too many units" });
    await expect(failing.ready).rejects.toThrow("too many units");

    client.move([2, 1], 5, 6);
    expect(worker.sent[1]).toEqual({
      type: "move",
      unitIds: [2, 1],
      targetXRaw: 5,
      targetYRaw: 6,
    });

    const hash = client.requestHash();
    expect(worker.sent[2]).toEqual({ type: "hashRequest", requestId: 1 });
    worker.emit({ type: "hash", requestId: 1, hash: "00000000deadbeef" });
    await expect(hash).resolves.toBe("00000000deadbeef");

    const received: { snapshot: Snapshot; at: number }[] = [];
    const unsubscribe = client.onSnapshot((snapshot, at) => {
      received.push({ snapshot, at });
    });
    worker.emit({
      type: "snapshot",
      data: new Int32Array([7, 1, 0, 98304, 65536, 1]),
    });
    expect(received).toEqual([
      {
        snapshot: { tick: 7, units: [{ id: 0, x: 1.5, y: 1, moving: true }] },
        at: 42,
      },
    ]);

    unsubscribe();
    worker.emit({ type: "snapshot", data: new Int32Array([8, 0]) });
    expect(received).toHaveLength(1);
  });

  it("AC-01-05: rejects a worker with a mismatched api version", async () => {
    const worker = new FakeWorker();
    const client = createSimClient(worker, { seed: 1, unitCount: 1 });
    worker.emit({ ...READY, apiVersion: 3 } as WorkerToMain);
    await expect(client.ready).rejects.toThrow(
      "api version mismatch: expected 2, got 3",
    );
  });
});

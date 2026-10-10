import { describe, expect, it } from "vitest";
import type { MatchSnapshot } from "./matchSnapshot";
import type { MainToWorker, SimCommand, WorkerToMain } from "./protocol";
import { createSkirmishClient, type SkirmishClient } from "./skirmishClient";

class FakeWorker {
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
  apiVersion: 3,
  mapWidth: 2,
  mapHeight: 2,
  tiles: new Uint8Array([0, 1, 0, 0]),
};

const SNAPSHOT: MatchSnapshot = {
  tick: 5,
  viewer: 1,
  credits: 5000,
  powerProduced: 10,
  powerConsumed: 0,
  outcome: "ongoing",
  winner: null,
  entities: [
    {
      id: 0,
      owner: 1,
      kind: 9,
      x: 1.5,
      y: 1,
      hp: 100,
      flags: 0,
      progress: 1000,
      target: null,
    },
  ],
  queues: [],
};

describe("skirmish client", () => {
  it("AC-03-47: wraps the skirmish protocol", async () => {
    const worker = new FakeWorker();
    const options = {
      seed: 7,
      mapId: "first-line",
      viewer: 1,
      speed: 2,
      debug: true,
    };
    const client: SkirmishClient = createSkirmishClient(
      worker,
      options,
      () => 42,
    );
    expect(worker.sent).toEqual([{ type: "initSkirmish", ...options }]);

    worker.emit(READY);
    await expect(client.ready).resolves.toEqual(READY);

    const failingWorker = new FakeWorker();
    const failing = createSkirmishClient(failingWorker, options);
    failingWorker.emit({ ...READY, apiVersion: 4 });
    await expect(failing.ready).rejects.toThrow(
      "api version mismatch: expected 3, got 4",
    );

    const errorWorker = new FakeWorker();
    const errored = createSkirmishClient(errorWorker, options);
    errorWorker.emit({ type: "error", detail: "unknown map: nope" });
    await expect(errored.ready).rejects.toThrow("unknown map: nope");

    const command: SimCommand = {
      kind: "move",
      player: 1,
      units: [4, 5],
      xRaw: 65536,
      yRaw: 131072,
    };
    client.command(command);
    expect(worker.sent[1]).toEqual({ type: "command", command });

    client.setViewer(1);
    expect(worker.sent[2]).toEqual({ type: "setViewer", viewer: 1 });

    const hash = client.requestHash();
    expect(worker.sent[3]).toEqual({ type: "hashRequest", requestId: 1 });
    worker.emit({ type: "hash", requestId: 1, hash: "00000000deadbeef" });
    await expect(hash).resolves.toBe("00000000deadbeef");

    const received: {
      snapshot: MatchSnapshot;
      fog: Uint8Array;
      at: number;
    }[] = [];
    const unsubscribe = client.onSnapshot((snapshot, fog, receivedAtMs) => {
      received.push({ snapshot, fog, at: receivedAtMs });
    });
    worker.emit({
      type: "snapshot",
      data: new Int32Array([
        5, 1, 5000, 10, 0, 0, -1, 1, 0, 1, 9, 98304, 65536, 100, 0, 1000, -1,
      ]),
      fog: new Uint8Array([0, 1, 1, 2]),
    });
    expect(received).toEqual([
      { snapshot: SNAPSHOT, fog: new Uint8Array([0, 1, 1, 2]), at: 42 },
    ]);

    unsubscribe();
    worker.emit({
      type: "snapshot",
      data: new Int32Array([6, 1, 5000, 10, 0, 0, -1, 0, 0]),
    });
    expect(received).toHaveLength(1);
  });
});

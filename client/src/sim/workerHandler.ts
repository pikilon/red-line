import {
  type HashRequestMessage,
  type InitMessage,
  MAX_STEPS_PER_ADVANCE,
  type MainToWorker,
  type MoveMessage,
  TICK_MS,
  type WorkerToMain,
} from "./protocol";

export interface SimLike {
  map_width(): number;
  map_height(): number;
  map_tiles(): Uint8Array;
  tick(): number;
  command_move(
    unitIds: Uint32Array,
    targetXRaw: number,
    targetYRaw: number,
  ): void;
  step(): void;
  snapshot(): Int32Array;
  state_hash_hex(): string;
}
export type SimFactory = (seed: number, unitCount: number) => SimLike;
export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;
export interface WorkerHandler {
  handle(message: MainToWorker): void;
  advance(nowMs: number): void;
}

export function createWorkerHandler(
  factory: SimFactory,
  apiVersion: number,
  post: Post,
): WorkerHandler {
  let sim: SimLike | null = null;
  let lastMs: number | null = null;
  let accumulatorMs = 0;

  const postSnapshot = (target: SimLike): void => {
    const data = target.snapshot();
    post({ type: "snapshot", data }, [data.buffer as ArrayBuffer]);
  };

  const handlers = {
    init: (message: InitMessage): void => {
      let created: SimLike;
      try {
        created = factory(message.seed, message.unitCount);
      } catch (error) {
        post({ type: "error", detail: String(error) });
        return;
      }
      sim = created;
      lastMs = null;
      accumulatorMs = 0;
      post({
        type: "ready",
        apiVersion,
        mapWidth: created.map_width(),
        mapHeight: created.map_height(),
        tiles: created.map_tiles(),
      });
      postSnapshot(created);
    },
    move: (message: MoveMessage): void => {
      sim?.command_move(
        Uint32Array.from(message.unitIds),
        message.targetXRaw,
        message.targetYRaw,
      );
    },
    hashRequest: (message: HashRequestMessage): void => {
      if (sim === null) {
        return;
      }
      post({
        type: "hash",
        requestId: message.requestId,
        hash: sim.state_hash_hex(),
      });
    },
  } as const;

  return {
    handle(message: MainToWorker): void {
      (handlers[message.type] as (m: MainToWorker) => void)(message);
    },
    advance(nowMs: number): void {
      if (sim === null) {
        return;
      }
      if (lastMs === null) {
        lastMs = nowMs;
        return;
      }
      accumulatorMs += Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      const steps = Math.min(
        Math.floor(accumulatorMs / TICK_MS),
        MAX_STEPS_PER_ADVANCE,
      );
      for (let i = 0; i < steps; i++) {
        sim.step();
      }
      accumulatorMs =
        steps === MAX_STEPS_PER_ADVANCE ? 0 : accumulatorMs - steps * TICK_MS;
      if (steps > 0) {
        postSnapshot(sim);
      }
    },
  };
}

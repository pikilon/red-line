import {
  type CommandMessage,
  type HashRequestMessage,
  type InitMessage,
  type InitSkirmishMessage,
  MAX_STEPS_PER_ADVANCE,
  type MainToWorker,
  type MoveMessage,
  type SetViewerMessage,
  type SimCommand,
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

/** Skirmish sims (`Sim.skirmish`, §5.16) add one method per command kind. */
export interface SkirmishSimLike {
  map_width(): number;
  map_height(): number;
  map_tiles(): Uint8Array;
  tick(): number;
  step(): void;
  state_hash_hex(): string;
  enable_debug_commands(): void;
  attach_ai(player: number, personality: string): void;
  snapshot_for(viewer: number): Int32Array;
  fog_for(viewer: number): Uint8Array;
  command_move(
    unitIds: Uint32Array,
    targetXRaw: number,
    targetYRaw: number,
  ): void;
  command_move_as(
    player: number,
    unitIds: Uint32Array,
    xRaw: number,
    yRaw: number,
  ): void;
  command_attack(player: number, unitIds: Uint32Array, target: number): void;
  command_harvest(player: number, unitIds: Uint32Array, depot: number): void;
  command_construct(
    player: number,
    dozer: number,
    kind: number,
    originX: number,
    originY: number,
  ): void;
  command_resume(player: number, unitIds: Uint32Array, building: number): void;
  command_produce(player: number, building: number, kind: number): void;
  command_cancel(player: number, building: number): void;
  command_rally(
    player: number,
    building: number,
    xRaw: number,
    yRaw: number,
  ): void;
  command_stop(player: number, unitIds: Uint32Array): void;
  debug_spawn(player: number, kind: number, xRaw: number, yRaw: number): void;
  debug_set_hp(entity: number, hp: number): void;
}

export type SimFactory = (seed: number, unitCount: number) => SimLike;
export type SkirmishFactory = (seed: number, mapId: string) => SkirmishSimLike;
export type Post = (message: WorkerToMain, transfer?: Transferable[]) => void;
export interface WorkerHandler {
  handle(message: MainToWorker): void;
  advance(nowMs: number): void;
}

export const MAX_SPEED = 8;
/** Skirmish AI opponent player (spec 05 §7). */
const AI_PLAYER = 1;

type Dispatch = (sim: SkirmishSimLike, command: SimCommand) => void;

/** Wraps one entry of the command dictionary with a narrowed command type. */
const run =
  <C extends SimCommand>(
    step: (sim: SkirmishSimLike, command: C) => void,
  ): Dispatch =>
  (sim, command) => {
    step(sim, command as C);
  };

/** Constant dictionary keyed by `SimCommand["kind"]` (§6.3); no `switch`. */
const COMMANDS = {
  move: run((sim, command: Extract<SimCommand, { kind: "move" }>) => {
    sim.command_move_as(
      command.player,
      Uint32Array.from(command.units),
      command.xRaw,
      command.yRaw,
    );
  }),
  attack: run((sim, command: Extract<SimCommand, { kind: "attack" }>) => {
    sim.command_attack(
      command.player,
      Uint32Array.from(command.units),
      command.target,
    );
  }),
  harvest: run((sim, command: Extract<SimCommand, { kind: "harvest" }>) => {
    sim.command_harvest(
      command.player,
      Uint32Array.from(command.units),
      command.depot,
    );
  }),
  construct: run((sim, command: Extract<SimCommand, { kind: "construct" }>) => {
    sim.command_construct(
      command.player,
      command.dozer,
      command.typeIndex,
      command.originX,
      command.originY,
    );
  }),
  resume: run((sim, command: Extract<SimCommand, { kind: "resume" }>) => {
    sim.command_resume(
      command.player,
      Uint32Array.from(command.units),
      command.building,
    );
  }),
  produce: run((sim, command: Extract<SimCommand, { kind: "produce" }>) => {
    sim.command_produce(command.player, command.building, command.typeIndex);
  }),
  cancel: run((sim, command: Extract<SimCommand, { kind: "cancel" }>) => {
    sim.command_cancel(command.player, command.building);
  }),
  rally: run((sim, command: Extract<SimCommand, { kind: "rally" }>) => {
    sim.command_rally(
      command.player,
      command.building,
      command.xRaw,
      command.yRaw,
    );
  }),
  stop: run((sim, command: Extract<SimCommand, { kind: "stop" }>) => {
    sim.command_stop(command.player, Uint32Array.from(command.units));
  }),
  debugSpawn: run(
    (sim, command: Extract<SimCommand, { kind: "debugSpawn" }>) => {
      sim.debug_spawn(
        command.player,
        command.typeIndex,
        command.xRaw,
        command.yRaw,
      );
    },
  ),
  debugSetHp: run(
    (sim, command: Extract<SimCommand, { kind: "debugSetHp" }>) => {
      sim.debug_set_hp(command.entity, command.hp);
    },
  ),
} as const satisfies Record<SimCommand["kind"], Dispatch>;

export function createWorkerHandler(
  factory: SimFactory,
  apiVersion: number,
  post: Post,
  skirmishFactory?: SkirmishFactory,
): WorkerHandler {
  let sim: SimLike | null = null;
  let skirmish: SkirmishSimLike | null = null;
  let viewer = 0;
  let speed = 1;
  let lastMs: number | null = null;
  let accumulatorMs = 0;

  const postSnapshot = (target: SimLike): void => {
    const data = target.snapshot();
    post({ type: "snapshot", data }, [data.buffer as ArrayBuffer]);
  };

  const postSkirmishSnapshot = (target: SkirmishSimLike): void => {
    const data = target.snapshot_for(viewer);
    const fog = target.fog_for(viewer);
    post({ type: "snapshot", data, fog }, [
      data.buffer as ArrayBuffer,
      fog.buffer as ArrayBuffer,
    ]);
  };

  const resetClock = (): void => {
    lastMs = null;
    accumulatorMs = 0;
  };

  const attachSkirmish = (created: SkirmishSimLike): void => {
    skirmish = created;
    sim = null;
    resetClock();
    post({
      type: "ready",
      apiVersion,
      mapWidth: created.map_width(),
      mapHeight: created.map_height(),
      tiles: created.map_tiles(),
    });
    postSkirmishSnapshot(created);
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
      skirmish = null;
      resetClock();
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
      const target = skirmish ?? sim;
      if (target === null) {
        return;
      }
      post({
        type: "hash",
        requestId: message.requestId,
        hash: target.state_hash_hex(),
      });
    },
    initSkirmish: (message: InitSkirmishMessage): void => {
      if (skirmishFactory === undefined) {
        post({
          type: "error",
          detail: "this worker has no skirmish factory",
        });
        return;
      }
      let created: SkirmishSimLike;
      try {
        created = skirmishFactory(message.seed, message.mapId);
      } catch (error) {
        post({ type: "error", detail: String(error) });
        return;
      }
      viewer = message.viewer;
      speed = Math.min(MAX_SPEED, Math.max(1, message.speed));
      if (message.debug) {
        created.enable_debug_commands();
      }
      if (message.ai != null) {
        try {
          created.attach_ai(AI_PLAYER, message.ai);
        } catch (error) {
          post({ type: "error", detail: String(error) });
          return;
        }
      }
      attachSkirmish(created);
    },
    command: (message: CommandMessage): void => {
      if (skirmish === null) {
        return;
      }
      (COMMANDS[message.command.kind] as Dispatch)(skirmish, message.command);
    },
    setViewer: (message: SetViewerMessage): void => {
      if (skirmish === null) {
        return;
      }
      viewer = message.viewer;
      postSkirmishSnapshot(skirmish);
    },
  } as const;

  return {
    handle(message: MainToWorker): void {
      (handlers[message.type] as (m: MainToWorker) => void)(message);
    },
    advance(nowMs: number): void {
      const target = skirmish ?? sim;
      if (target === null) {
        return;
      }
      if (lastMs === null) {
        lastMs = nowMs;
        return;
      }
      const rate = skirmish === null ? 1 : speed;
      accumulatorMs += Math.max(0, nowMs - lastMs) * rate;
      lastMs = nowMs;
      const steps = Math.min(
        Math.floor(accumulatorMs / TICK_MS),
        MAX_STEPS_PER_ADVANCE,
      );
      for (let i = 0; i < steps; i++) {
        target.step();
      }
      accumulatorMs =
        steps === MAX_STEPS_PER_ADVANCE ? 0 : accumulatorMs - steps * TICK_MS;
      if (steps === 0) {
        return;
      }
      if (skirmish === null) {
        if (sim !== null) {
          postSnapshot(sim);
        }
        return;
      }
      postSkirmishSnapshot(skirmish);
    },
  };
}

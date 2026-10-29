import {
  type CommandMessage,
  type HashRequestMessage,
  type InitFromSaveMessage,
  type InitMessage,
  type InitSkirmishMessage,
  MAX_STEPS_PER_ADVANCE,
  type MainToWorker,
  type MoveMessage,
  type SaveRequestMessage,
  type SetAiActiveMessage,
  type SetPausedMessage,
  type SetViewerMessage,
  type SimCommand,
  type SnapshotMessage,
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
  set_ai_active(player: number, active: boolean): boolean;
  snapshot_for(viewer: number): Int32Array;
  fog_for(viewer: number): Uint8Array;
  /** Optional combat snapshot (spec 17 §5); newer sims expose `combat_for`. */
  combat_for?(viewer: number): Int32Array;
  /** Optional feature table (spec 31); empty when unchanged. */
  features_for?(): Int32Array;
  /** World state JSON (spec 19 §3.7); throws the sim's error text. */
  save_state?(): string;
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
  command_attack_ground(
    player: number,
    unitIds: Uint32Array,
    xRaw: number,
    yRaw: number,
  ): void;
  command_harvest(player: number, unitIds: Uint32Array, depot: number): void;
  command_garrison(player: number, unitIds: Uint32Array, feature: number): void;
  command_unload(player: number, feature: number): void;
  command_board(player: number, unitIds: Uint32Array, carrier: number): void;
  command_disembark(player: number, carrier: number): void;
  command_repair(player: number, unitIds: Uint32Array, feature: number): void;
  command_repair_building(
    player: number,
    unitIds: Uint32Array,
    building: number,
  ): void;
  command_heal_at(player: number, unitIds: Uint32Array, building: number): void;
  command_repair_vehicle(
    player: number,
    unitIds: Uint32Array,
    factory: number,
  ): void;
  command_dig(
    player: number,
    unitIds: Uint32Array,
    x: number,
    y: number,
    rot: number,
  ): void;
  command_dig_line(
    player: number,
    unitIds: Uint32Array,
    segments: Int32Array,
  ): void;
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
  command_sell(player: number, building: number): void;
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
/** `Sim.load_state` / `Sim.from_setup` (spec 19 §5.4). */
export type SaveFactory = (
  form: "world" | "setup",
  json: string,
) => SkirmishSimLike;
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
  attackGround: run(
    (sim, command: Extract<SimCommand, { kind: "attackGround" }>) => {
      sim.command_attack_ground(
        command.player,
        Uint32Array.from(command.units),
        command.xRaw,
        command.yRaw,
      );
    },
  ),
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
  sell: run((sim, command: Extract<SimCommand, { kind: "sell" }>) => {
    sim.command_sell(command.player, command.building);
  }),
  rally: run((sim, command: Extract<SimCommand, { kind: "rally" }>) => {
    sim.command_rally(
      command.player,
      command.building,
      command.xRaw,
      command.yRaw,
    );
  }),
  garrison: run((sim, command: Extract<SimCommand, { kind: "garrison" }>) => {
    sim.command_garrison(
      command.player,
      Uint32Array.from(command.units),
      command.feature,
    );
  }),
  board: run((sim, command: Extract<SimCommand, { kind: "board" }>) => {
    sim.command_board(
      command.player,
      Uint32Array.from(command.units),
      command.carrier,
    );
  }),
  repairBuilding: run(
    (sim, command: Extract<SimCommand, { kind: "repairBuilding" }>) => {
      sim.command_repair_building(
        command.player,
        Uint32Array.from(command.units),
        command.building,
      );
    },
  ),
  healAt: run((sim, command: Extract<SimCommand, { kind: "healAt" }>) => {
    sim.command_heal_at(
      command.player,
      Uint32Array.from(command.units),
      command.building,
    );
  }),
  repairVehicle: run(
    (sim, command: Extract<SimCommand, { kind: "repairVehicle" }>) => {
      sim.command_repair_vehicle(
        command.player,
        Uint32Array.from(command.units),
        command.factory,
      );
    },
  ),
  dig: run((sim, command: Extract<SimCommand, { kind: "dig" }>) => {
    sim.command_dig(
      command.player,
      Uint32Array.from(command.units),
      command.x,
      command.y,
      command.rot,
    );
  }),
  digLine: run((sim, command: Extract<SimCommand, { kind: "digLine" }>) => {
    sim.command_dig_line(
      command.player,
      Uint32Array.from(command.units),
      Int32Array.from(command.segments),
    );
  }),
  repair: run((sim, command: Extract<SimCommand, { kind: "repair" }>) => {
    sim.command_repair(
      command.player,
      Uint32Array.from(command.units),
      command.feature,
    );
  }),
  disembark: run((sim, command: Extract<SimCommand, { kind: "disembark" }>) => {
    sim.command_disembark(command.player, command.carrier);
  }),
  unload: run((sim, command: Extract<SimCommand, { kind: "unload" }>) => {
    sim.command_unload(command.player, command.feature);
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
  saveFactory?: SaveFactory,
): WorkerHandler {
  let sim: SimLike | null = null;
  let skirmish: SkirmishSimLike | null = null;
  let viewer = 0;
  let speed = 1;
  let lastMs: number | null = null;
  let accumulatorMs = 0;
  let paused = false;

  const postSnapshot = (target: SimLike): void => {
    const data = target.snapshot();
    post({ type: "snapshot", data }, [data.buffer as ArrayBuffer]);
  };

  const postSkirmishSnapshot = (target: SkirmishSimLike): void => {
    const data = target.snapshot_for(viewer);
    const combat = target.combat_for?.(viewer);
    const fog = target.fog_for(viewer);
    const features = target.features_for?.();
    const message: SnapshotMessage = { type: "snapshot", data, fog };
    const transfer: ArrayBuffer[] = [
      data.buffer as ArrayBuffer,
      fog.buffer as ArrayBuffer,
    ];
    if (combat !== undefined) {
      message.combat = combat;
      transfer.push(combat.buffer as ArrayBuffer);
    }
    if (features !== undefined && features.length > 0) {
      message.features = features;
      transfer.push(features.buffer as ArrayBuffer);
    }
    post(message, transfer);
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
    initFromSave: (message: InitFromSaveMessage): void => {
      if (saveFactory === undefined) {
        post({ type: "error", detail: "this worker has no save factory" });
        return;
      }
      let created: SkirmishSimLike;
      try {
        created = saveFactory(message.form, message.json);
      } catch (error) {
        post({ type: "error", detail: String(error) });
        return;
      }
      viewer = message.viewer;
      speed = Math.min(MAX_SPEED, Math.max(1, message.speed));
      attachSkirmish(created);
    },
    saveRequest: (message: SaveRequestMessage): void => {
      const { requestId } = message;
      if (skirmish?.save_state === undefined) {
        post({ type: "saveState", requestId, world: null, error: "no save" });
        return;
      }
      try {
        post({ type: "saveState", requestId, world: skirmish.save_state() });
      } catch (error) {
        post({
          type: "saveState",
          requestId,
          world: null,
          error: String(error),
        });
      }
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
    setPaused: (message: SetPausedMessage): void => {
      paused = message.paused;
    },
    setAiActive: (message: SetAiActiveMessage): void => {
      skirmish?.set_ai_active(AI_PLAYER, message.active);
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
      const elapsedMs = Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      // Paused: drop the elapsed time so resuming never catches it up.
      if (paused) {
        accumulatorMs = 0;
        return;
      }
      accumulatorMs += elapsedMs * rate;
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

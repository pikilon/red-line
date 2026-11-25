import type { LockstepConfig, SimCommand, TurnMessage } from "../sim/protocol";

/** Spec 51 §3.1: a turn is 3 ticks (200 ms at 15 Hz); orders given during
 *  turn N run at turn N + 2, so a peer has 400 ms to deliver them. */
export const LOCKSTEP: LockstepConfig = {
  players: 2,
  turnTicks: 3,
  delayTurns: 2,
  hashEveryTurns: 15,
};

/** Messages exchanged between the two browsers over the data channel. */
export type PeerMessage =
  | { t: "turn"; turn: number; commands: SimCommand[] }
  | { t: "hash"; turn: number; hash: string }
  | { t: "start"; seed: number; mapId: string; name?: string }
  | { t: "hello"; name: string }
  | { t: "bye" };

export interface LockstepHooks {
  readonly localPlayer: number;
  readonly config?: LockstepConfig;
  /** Sends to the other browser. */
  send(message: PeerMessage): void;
  /** Hands a turn's orders to the local simulation worker. */
  toWorker(message: TurnMessage): void;
  /** The two simulations diverged at `turn` (spec 51 §3.5). */
  onDesync(turn: number): void;
}

export interface Lockstep {
  /** Queues an order of the local player for the next scheduled turn. */
  queue(command: SimCommand): void;
  /** The local worker began `turn`; schedules the local orders. */
  turnStarted(turn: number, hash: string | undefined): void;
  /** A message from the other browser. */
  receive(message: PeerMessage): void;
}

const DEBUG_KINDS = new Set<SimCommand["kind"]>(["debugSpawn", "debugSetHp"]);

/** Spec 51 §3: schedules local orders `delayTurns` ahead, relays the peer's
 *  orders to the worker and compares state hashes. */
export function createLockstep(hooks: LockstepHooks): Lockstep {
  const config = hooks.config ?? LOCKSTEP;
  const remotePlayer = hooks.localPlayer === 0 ? 1 : 0;
  let pending: SimCommand[] = [];
  const localHashes = new Map<number, string>();
  const remoteHashes = new Map<number, string>();
  let desynced = false;

  const compare = (turn: number): void => {
    const local = localHashes.get(turn);
    const remote = remoteHashes.get(turn);
    if (local === undefined || remote === undefined) return;
    localHashes.delete(turn);
    remoteHashes.delete(turn);
    if (local !== remote && !desynced) {
      desynced = true;
      hooks.onDesync(turn);
    }
  };

  return {
    queue(command) {
      if (DEBUG_KINDS.has(command.kind)) return;
      pending.push(command);
    },
    turnStarted(turn, hash) {
      const target = turn + config.delayTurns;
      const commands = pending;
      pending = [];
      hooks.toWorker({
        type: "turn",
        turn: target,
        player: hooks.localPlayer,
        commands,
      });
      hooks.send({ t: "turn", turn: target, commands });
      if (hash !== undefined) {
        localHashes.set(turn, hash);
        hooks.send({ t: "hash", turn, hash });
        compare(turn);
      }
    },
    receive(message) {
      if (message.t === "turn") {
        // The peer may only order its own side, never debug commands.
        const commands = message.commands
          .filter((command) => !DEBUG_KINDS.has(command.kind))
          .map((command) => ({ ...command, player: remotePlayer }));
        hooks.toWorker({
          type: "turn",
          turn: message.turn,
          player: remotePlayer,
          commands: commands as SimCommand[],
        });
        return;
      }
      if (message.t === "hash") {
        remoteHashes.set(message.turn, message.hash);
        compare(message.turn);
      }
    },
  };
}

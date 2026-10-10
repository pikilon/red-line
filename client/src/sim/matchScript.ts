import { typeIndex } from "../rules";
import type { SkirmishSimLike } from "./workerHandler";

export interface MatchScript {
  seed: number;
  map: string;
  ticks: number;
  commands: {
    tick: number;
    player: number;
    command: Record<string, unknown> & { type: string };
  }[];
}

type Order = Record<string, unknown> & { type: string };
type OrderHandler = (
  sim: SkirmishSimLike,
  player: number,
  order: Order,
) => void;

const units = (order: Order): Uint32Array =>
  Uint32Array.from((order.units as number[] | undefined) ?? []);
const pair = (value: unknown): [number, number] =>
  Array.isArray(value) ? [Number(value[0]), Number(value[1])] : [0, 0];
const target = (order: Order): [number, number] => pair(order.target);
const origin = (order: Order): [number, number] => pair(order.origin);
const kind = (order: Order): number => {
  const id = String(order.kind);
  const index = typeIndex(id);
  if (index < 0) {
    throw new Error(`unknown type ${id}`);
  }
  return index;
};

/** Constant dictionary keyed by the script order `type` (§5.17); no `switch`. */
const ORDERS = {
  move: (sim, player, order) => {
    const [xRaw, yRaw] = target(order);
    sim.command_move_as(player, units(order), xRaw, yRaw);
  },
  attack: (sim, player, order) => {
    sim.command_attack(player, units(order), Number(order.target));
  },
  harvest: (sim, player, order) => {
    sim.command_harvest(player, units(order), Number(order.depot));
  },
  construct: (sim, player, order) => {
    const [originX, originY] = origin(order);
    sim.command_construct(
      player,
      Number(order.dozer),
      kind(order),
      originX,
      originY,
    );
  },
  resume: (sim, player, order) => {
    sim.command_resume(player, units(order), Number(order.building));
  },
  produce: (sim, player, order) => {
    sim.command_produce(player, Number(order.building), kind(order));
  },
  cancel: (sim, player, order) => {
    sim.command_cancel(player, Number(order.building));
  },
  rally: (sim, player, order) => {
    const [xRaw, yRaw] = target(order);
    sim.command_rally(player, Number(order.building), xRaw, yRaw);
  },
  stop: (sim, player, order) => {
    sim.command_stop(player, units(order));
  },
} as const satisfies Record<string, OrderHandler>;

/**
 * Same semantics as headless `run_match_script` on a sim created with
 * `Sim.skirmish(seed, map)`; kinds resolved with `typeIndex`; returns
 * `state_hash_hex()`.
 */
export function runMatchScript(
  sim: SkirmishSimLike,
  script: MatchScript,
): string {
  for (let tick = 0; tick < script.ticks; tick += 1) {
    for (const entry of script.commands) {
      if (entry.tick !== tick) continue;
      const type = entry.command.type;
      const run = ORDERS[type as keyof typeof ORDERS] as
        | OrderHandler
        | undefined;
      if (run === undefined) {
        throw new Error(`unknown order ${type}`);
      }
      run(sim, entry.player, entry.command);
    }
    sim.step();
  }
  return sim.state_hash_hex();
}

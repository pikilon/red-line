export interface ScriptCommand {
  tick: number;
  unitRange: [number, number];
  target: [number, number];
}
export interface Script {
  seed: number;
  units: number;
  ticks: number;
  commands: ScriptCommand[];
}
export interface ScriptSim {
  command_move(ids: Uint32Array, x: number, y: number): void;
  step(): void;
  state_hash_hex(): string;
}

/** Same semantics as headless run_script; returns state_hash_hex(). */
export function runScript(_sim: ScriptSim, _script: Script): string {
  return "";
}

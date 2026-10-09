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
export function runScript(sim: ScriptSim, script: Script): string {
  for (let tick = 0; tick < script.ticks; tick += 1) {
    for (const command of script.commands) {
      if (command.tick !== tick) continue;
      const [start, end] = command.unitRange;
      const ids = Uint32Array.from(
        { length: Math.max(0, end - start) },
        (_, i) => start + i,
      );
      sim.command_move(ids, command.target[0], command.target[1]);
    }
    sim.step();
  }
  return sim.state_hash_hex();
}

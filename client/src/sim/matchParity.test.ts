import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initSync, Sim } from "@sim/sim.js";
import { describe, expect, it } from "vitest";
import { type MatchScript, runMatchScript } from "./matchScript";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = fileURLToPath(
  new URL(
    "../../../crates/sim/tests/fixtures/skirmish-script.json",
    import.meta.url,
  ),
);
const wasmPath = fileURLToPath(
  new URL("../../../crates/sim/pkg/sim_bg.wasm", import.meta.url),
);

describe("skirmish native/WASM parity", () => {
  it("AC-03-42: native and WASM skirmish hashes are identical", () => {
    const script = JSON.parse(readFileSync(fixturePath, "utf8")) as MatchScript;
    initSync({ module: readFileSync(wasmPath) });
    const sim = Sim.skirmish(script.seed, script.map);
    const wasmHash = runMatchScript(sim, script);
    sim.free();

    const nativeOutput = execFileSync(
      "cargo",
      ["run", "--quiet", "-p", "headless", "--", "hash", fixturePath],
      { cwd: repoRoot, encoding: "utf8" },
    );

    expect(wasmHash).toMatch(/^[0-9a-f]{16}$/);
    expect(wasmHash).toBe(nativeOutput.trim());
  }, 300_000);
});

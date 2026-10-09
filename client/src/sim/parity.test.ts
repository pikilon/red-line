import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initSync, Sim } from "@sim/sim.js";
import { describe, expect, it } from "vitest";
import { runScript, type Script } from "./script";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = fileURLToPath(
  new URL(
    "../../../crates/sim/tests/fixtures/tech-slice-script.json",
    import.meta.url,
  ),
);
const wasmPath = fileURLToPath(
  new URL("../../../crates/sim/pkg/sim_bg.wasm", import.meta.url),
);

describe("native/WASM parity", () => {
  it("AC-02-24: native and WASM hashes are identical", () => {
    const script = JSON.parse(readFileSync(fixturePath, "utf8")) as Script;
    initSync({ module: readFileSync(wasmPath) });
    const sim = new Sim(script.seed, script.units);
    const wasmHash = runScript(sim, script);
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

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { findViolations } from "./check-rules.mjs";

const sim = (content) => [{ path: "crates/sim/src/a.rs", content }];
const ts = (content) => [{ path: "client/src/a.ts", content }];

test("AC-01-01: rejects f32 and f64 in the simulation", () => {
  const files = sim("fn ok() {}\nlet a: f32 = 1;\nlet b: f64 = 2;\n");
  assert.deepEqual(findViolations(files), [
    { file: "crates/sim/src/a.rs", line: 2, rule: "sim-float" },
    { file: "crates/sim/src/a.rs", line: 3, rule: "sim-float" },
  ]);
});

test("AC-01-02: rejects hash collections, wall-clock time and unseeded randomness in the simulation", () => {
  const files = sim(
    [
      "use std::collections::HashMap;",
      "let s: HashSet<u8>;",
      "use std::time::Duration;",
      "let t = SystemTime::now();",
      "let i = Instant::now();",
      "let r = thread_rng();",
      "let x = rand::random::<u8>();",
    ].join("\n"),
  );
  const f = "crates/sim/src/a.rs";
  assert.deepEqual(findViolations(files), [
    { file: f, line: 1, rule: "sim-hash-collection" },
    { file: f, line: 2, rule: "sim-hash-collection" },
    { file: f, line: 3, rule: "sim-wall-clock" },
    { file: f, line: 4, rule: "sim-wall-clock" },
    { file: f, line: 5, rule: "sim-wall-clock" },
    { file: f, line: 6, rule: "sim-unseeded-random" },
    { file: f, line: 7, rule: "sim-unseeded-random" },
  ]);
});

test("AC-01-03: rejects switch and enum in client TypeScript", () => {
  const files = ts("const a = 1;\nswitch (a) {}\nenum Color { Red }\n");
  assert.deepEqual(findViolations(files), [
    { file: "client/src/a.ts", line: 2, rule: "ts-switch" },
    { file: "client/src/a.ts", line: 3, rule: "ts-enum" },
  ]);
});

test("AC-01-04: accepts clean files, comments and other paths", () => {
  const files = [
    ...sim("fn ok() {}\n// f32 HashMap std::time thread_rng\nlet a = 1; // f64\n"),
    ...ts("const a = 1;\n// switch (a) {}\n// enum Color {}\n"),
    { path: "client/src/b.ts", content: "const x: f64 = 1;\n" },
    { path: "crates/headless/src/main.rs", content: "let x: f64 = 1.0;\n" },
  ];
  assert.deepEqual(findViolations(files), []);
  const root = new URL("..", import.meta.url).pathname;
  const cli = spawnSync(process.execPath, ["scripts/check-rules.mjs"], { cwd: root });
  assert.equal(cli.status, 0, cli.stdout.toString() + cli.stderr.toString());
});

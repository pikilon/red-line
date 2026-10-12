// Generates SIN_TABLE and ATAN_TABLE in crates/sim/src/angle.rs (spec 11 §3).
// Floats live only in this script; the simulation reads the committed integers.
// Usage: node scripts/gen-trig-tables.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../crates/sim/src/angle.rs", import.meta.url));
const BEGIN = "// BEGIN GENERATED TABLES (node scripts/gen-trig-tables.mjs)";
const END = "// END GENERATED TABLES";
const TURN = 65536;
const SIZE = 1025;

function rows(values) {
  const lines = [];
  for (let i = 0; i < values.length; i += 8) {
    lines.push(`    ${values.slice(i, i + 8).join(", ")},`);
  }
  return lines.join("\n");
}

const sin = Array.from({ length: SIZE }, (_, i) =>
  Math.round(Math.sin(((i * 16) / TURN) * 2 * Math.PI) * 65536),
);
const atan = Array.from({ length: SIZE }, (_, i) =>
  Math.round((Math.atan(i / 1024) / (2 * Math.PI)) * TURN),
);

const block = `${BEGIN}
/// Fx raw of sin over a quarter turn; index = units / 16.
#[rustfmt::skip]
pub const SIN_TABLE: [i32; ${SIZE}] = [
${rows(sin)}
];

/// atan(i / 1024) in angle units.
#[rustfmt::skip]
pub const ATAN_TABLE: [u16; ${SIZE}] = [
${rows(atan)}
];
${END}`;

const source = readFileSync(target, "utf8");
const start = source.indexOf(BEGIN);
const end = source.indexOf(END);
if (start < 0 || end < 0) {
  console.error(`markers not found in ${target}`);
  process.exit(1);
}
writeFileSync(target, source.slice(0, start) + block + source.slice(end + END.length));

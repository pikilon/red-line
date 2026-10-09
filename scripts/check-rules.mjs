// Repository rules checker: rejects floats and non-deterministic APIs in
// crates/sim and `switch`/`enum` in client TypeScript (specs/01-architecture.md §3, §8).
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RULE_SETS = [
  {
    prefix: "crates/sim/src/",
    ext: ".rs",
    rules: [
      ["sim-float", /\bf(32|64)\b/],
      ["sim-hash-collection", /\bHash(Map|Set)\b/],
      ["sim-wall-clock", /std::time|\bSystemTime\b|\bInstant\b/],
      ["sim-unseeded-random", /\bthread_rng\b|rand::random/],
    ],
  },
  {
    prefix: "client/src/",
    ext: ".ts",
    rules: [
      ["ts-switch", /\bswitch\s*\(/],
      ["ts-enum", /\benum\s+[A-Za-z_]\w*/],
    ],
  },
];

export function findViolations(files) {
  const violations = [];
  for (const { path, content } of files) {
    const set = RULE_SETS.find((s) => path.startsWith(s.prefix) && path.endsWith(s.ext));
    if (!set) continue;
    content.split("\n").forEach((raw, index) => {
      const code = raw.split("//")[0];
      for (const [rule, pattern] of set.rules) {
        if (pattern.test(code)) violations.push({ file: path, line: index + 1, rule });
      }
    });
  }
  return violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = ["crates/sim/src", "client/src"].flatMap((dir) =>
    walk(join(root, dir)).map((full) => ({
      path: relative(root, full).split(sep).join("/"),
      content: readFileSync(full, "utf8"),
    })),
  );
  const violations = findViolations(files);
  for (const v of violations) console.log(`${v.file}:${v.line} ${v.rule}`);
  process.exit(violations.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

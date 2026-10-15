// AC-19-09: saves:list and saves:import (spec 19 §6.2) on a temporary copy of
// the repository data.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { importSave, listSaves } from "./saves.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name) => join(repo, "client/src/saves/fixtures", name);

/** A temporary root with `data/` and the English messages. */
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "redline-saves-"));
  cpSync(join(repo, "data"), join(root, "data"), { recursive: true });
  cpSync(join(repo, "client/src/i18n/en.json"), join(root, "client/src/i18n/en.json"));
  return root;
}

const ok = () => ({ ok: true });
const read = (root, path) => readFileSync(join(root, path), "utf8");

test("AC-19-09: saves scripts", () => {
  const root = tempRoot();
  try {
    const listed = listSaves(root);
    const ids = parse(read(root, "data/rules/globals.yaml")).saves;
    assert.equal(listed.length, ids.length);
    ids.forEach((id, i) => {
      assert.match(listed[i], new RegExp(`^${id}\\s`));
      assert.ok(listed[i].endsWith(`http://localhost:5173/?load=${id}`), listed[i]);
    });

    const imported = importSave({ root, file: fixture("world.json"), id: "pasted-test", check: ok });
    assert.deepEqual(imported, { ok: true, line: "imported pasted-test (0 entities, tick 1125)" });
    const saved = JSON.parse(read(root, "data/saves/pasted-test.json"));
    assert.deepEqual(saved, JSON.parse(readFileSync(fixture("world.json"), "utf8")));
    assert.ok(parse(read(root, "data/rules/globals.yaml")).saves.includes("pasted-test"));
    const en = JSON.parse(read(root, "client/src/i18n/en.json"));
    assert.equal(en["saves.pasted-test.name"], "Before the river");
    assert.equal(en["saves.pasted-test.description"], "");
    assert.ok(existsSync(join(root, "data/generated/saves/pasted-test.json")));
    assert.ok(listSaves(root).some((line) => line.startsWith("pasted-test ")));

    const before = read(root, "data/rules/globals.yaml");
    const refusals = [
      { file: fixture("world.json"), id: "pasted-test" },
      { file: fixture("setup.json"), id: "setup-test" },
      { file: fixture("cases.json"), id: "not-a-save" },
      { file: fixture("world.json"), id: "slot-1" },
      { file: fixture("world.json"), id: "Bad_Id" },
      { file: join(root, "missing.json"), id: "missing" },
    ];
    for (const args of refusals) {
      const result = importSave({ root, ...args, check: ok });
      assert.equal(result.ok, false, args.id);
      assert.match(result.line, /^error: /, args.id);
      assert.equal(existsSync(join(root, `data/saves/${args.id}.json`)) && args.id !== "pasted-test", false);
    }
    assert.equal(read(root, "data/rules/globals.yaml"), before, "refusals write nothing");

    // --force replaces an existing import, and a failing check is reported.
    const forced = importSave({ root, file: fixture("world.json"), id: "pasted-test", force: true, check: ok });
    assert.equal(forced.ok, true);
    const failed = importSave({
      root,
      file: fixture("world.json"),
      id: "checked-test",
      check: () => ({ ok: false, detail: "round trip differs at /tick" }),
    });
    assert.deepEqual(failed, { ok: false, line: "error: round trip differs at /tick" });
    assert.equal(existsSync(join(root, "data/saves/checked-test.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

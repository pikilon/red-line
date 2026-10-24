// generals-ini reads INI files straight out of the owner's local .big archives,
// read-only, for the generals-precedent subagent.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findArchives, grepIni, listIni, readBigDirectory, showIni } from "./generals-ini.mjs";

// Builds a BIGF archive: "BIGF", u32 LE size, u32 BE count, u32 BE header size,
// then per entry u32 BE offset, u32 BE size and a NUL-terminated path.
const writeBig = (path, files) => {
  const names = Object.keys(files).map((name) => Buffer.from(`${name}\0`, "latin1"));
  const bodies = Object.values(files).map((text) => Buffer.from(text, "latin1"));
  const headerSize = 16 + names.reduce((sum, name) => sum + 8 + name.length, 0);
  const records = [];
  let offset = headerSize;
  for (const [index, name] of names.entries()) {
    const record = Buffer.alloc(8);
    record.writeUInt32BE(offset, 0);
    record.writeUInt32BE(bodies[index].length, 4);
    records.push(record, name);
    offset += bodies[index].length;
  }
  const header = Buffer.alloc(16);
  header.write("BIGF", 0, "latin1");
  header.writeUInt32LE(offset, 4);
  header.writeUInt32BE(names.length, 8);
  header.writeUInt32BE(headerSize, 12);
  writeFileSync(path, Buffer.concat([header, ...records, ...bodies]));
};

const install = () => {
  const root = mkdtempSync(join(tmpdir(), "generals-ini-"));
  const zh = join(root, "Zero Hour");
  const generals = join(root, "Generals");
  mkdirSync(zh);
  mkdirSync(generals);
  writeBig(join(zh, "INIZH.big"), {
    "Data\\INI\\Locomotor.ini": "Locomotor TankLocomotor\n  Speed = 30\nEnd\n",
    "Data\\INI\\Object\\Tank.ini": "Object Tank\n  Locomotor = SET_NORMAL TankLocomotor\nEnd\n",
    "Data\\Scripts\\Notes.txt": "Speed = 99\n",
  });
  writeBig(join(generals, "INI.big"), { "Data\\INI\\Locomotor.ini": "Locomotor TankLocomotor\n  Speed = 20\nEnd\n" });
  return { root, zh, generals };
};

test("reads the directory of a BIG archive", async () => {
  const { zh } = install();
  const entries = await readBigDirectory(join(zh, "INIZH.big"));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Data\\INI\\Locomotor.ini", "Data\\INI\\Object\\Tank.ini", "Data\\Scripts\\Notes.txt"],
  );
});

test("finds Zero Hour first, and Generals only when asked", () => {
  const { root, zh, generals } = install();
  assert.deepEqual(findArchives(root), [join(zh, "INIZH.big")]);
  assert.deepEqual(findArchives(root, { generals: true }), [join(zh, "INIZH.big"), join(generals, "INI.big")]);
  assert.deepEqual(findArchives(zh), [join(zh, "INIZH.big")]);
  assert.throws(() => findArchives(join(root, "missing")), /no INIZH\.big/);
});

test("lists, greps and shows INI files only", async () => {
  const { root } = install();
  const archives = findArchives(root, { generals: true });
  assert.deepEqual(await listIni(archives, "object"), ["INIZH.big:Data\\INI\\Object\\Tank.ini"]);
  assert.deepEqual(await grepIni(archives, "^\\s*speed"), [
    "INIZH.big:Data\\INI\\Locomotor.ini:2:  Speed = 30",
    "INI.big:Data\\INI\\Locomotor.ini:2:  Speed = 20",
  ]);
  assert.equal(
    await showIni(archives, "data/ini/object/tank.ini"),
    "Object Tank\n  Locomotor = SET_NORMAL TankLocomotor\nEnd\n",
  );
  await assert.rejects(showIni(archives, "Data\\INI\\Nope.ini"), /not found/);
});

// Builds data/generated/ruleset.json from the YAML sources in data/ (specs/03 §4).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

/** @typedef {{ file: string, text: string }} SourceFile */
/** @typedef {{ globals: SourceFile, factions: SourceFile[], maps: SourceFile[] }} Sources */
/** @typedef {"parse"|"schema"|"duplicate-id"|"unknown-reference"|"invalid-value"} DataErrorCode */
/** @typedef {{ file: string, pointer: string, code: DataErrorCode, message: string }} DataError */

const FORMAT_VERSION = 1;
const QUEUE_SLOTS = 9;
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "schema");
const GLOBALS_FILE = "data/rules/globals.yaml";

const readSchema = (name) => JSON.parse(readFileSync(join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));

const createValidators = () => {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(readSchema("faction"));
  return {
    globals: ajv.compile(readSchema("globals")),
    faction: ajv.getSchema("faction.schema.json"),
    map: ajv.compile(readSchema("map")),
  };
};

const listedIds = (text, key) => {
  try {
    const list = parse(text)?.[key];
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

/** Reads globals, then the factions and maps it lists, as repository-relative files. */
export function readSources(rootDir) {
  const read = (file) => ({ file, text: readFileSync(join(rootDir, file), "utf8") });
  const globals = read(GLOBALS_FILE);
  return {
    globals,
    factions: listedIds(globals.text, "factions").map((id) => read(`data/factions/${id}.yaml`)),
    maps: listedIds(globals.text, "maps").map((id) => read(`data/maps/${id}.yaml`)),
  };
}

/** @returns {{ ruleset: object | null, errors: DataError[] }} */
export function buildRuleset(sources) {
  /** @type {DataError[]} */
  const errors = [];
  const fail = (file, pointer, code, message) => errors.push({ file, pointer, code, message });
  const validators = createValidators();

  const load = (source, validate) => {
    let data;
    try {
      data = parse(source.text);
    } catch (error) {
      fail(source.file, "/", "parse", error.message.split("\n")[0]);
      return null;
    }
    if (validate(data)) return data;
    for (const e of validate.errors.filter((e) => e.keyword !== "if")) {
      fail(source.file, e.instancePath || "/", "schema", e.message);
    }
    return null;
  };

  const globals = load(sources.globals, validators.globals);
  const factions = sources.factions.map((source) => load(source, validators.faction));
  const maps = sources.maps.map((source) => load(source, validators.map));
  if (errors.length > 0) return { ruleset: null, errors };

  checkGlobals(sources.globals.file, globals, fail);
  const index = checkReferences(sources, globals, factions, fail);
  sources.factions.forEach((source, i) => checkFaction(source.file, factions[i], fail));
  sources.maps.forEach((source, i) => checkMap(source.file, maps[i], globals, factions, index, fail));
  if (errors.length > 0) return { ruleset: null, errors };

  return { ruleset: assemble(globals, factions, maps), errors };
}

function checkGlobals(file, globals, fail) {
  if (globals.maxQueue > QUEUE_SLOTS) fail(file, "/maxQueue", "invalid-value", `maxQueue exceeds ${QUEUE_SLOTS}`);
  if (globals.lowPowerMinSpeedPercent > globals.lowPowerMaxSpeedPercent) {
    fail(file, "/lowPowerMinSpeedPercent", "invalid-value", "lowPowerMinSpeedPercent exceeds lowPowerMaxSpeedPercent");
  }
  for (const [damageType, row] of Object.entries(globals.damageModifiers)) {
    if (!globals.damageTypes.includes(damageType)) {
      fail(file, `/damageModifiers/${damageType}`, "unknown-reference", `unknown damage type ${damageType}`);
    }
    for (const armor of Object.keys(row).filter((armor) => !globals.armorClasses.includes(armor))) {
      fail(file, `/damageModifiers/${damageType}/${armor}`, "unknown-reference", `unknown armour class ${armor}`);
    }
  }
  for (const damageType of globals.damageTypes) {
    for (const armor of globals.armorClasses) {
      if (globals.damageModifiers[damageType]?.[armor] === undefined) {
        fail(file, `/damageModifiers/${damageType}`, "invalid-value", `missing modifier for ${armor}`);
      }
    }
  }
}

/** Duplicate ids and unknown references over weapons and types. Returns the id lookups. */
function checkReferences(sources, globals, factions, fail) {
  const weapons = new Map();
  const types = new Map();
  const declare = (registry, file, pointer, id) => {
    if (registry.has(id)) fail(file, pointer, "duplicate-id", `duplicate id ${id}`);
    else registry.set(id, registry.size);
  };
  const owners = [{ file: sources.globals.file, list: "commonTypes", types: globals.commonTypes, weapons: [] }];
  factions.forEach((faction, i) => {
    owners.push({ file: sources.factions[i].file, list: "types", types: faction.types, weapons: faction.weapons });
  });
  for (const owner of owners) {
    owner.weapons.forEach((w, i) => declare(weapons, owner.file, `/weapons/${i}/id`, w.id));
    owner.types.forEach((t, i) => declare(types, owner.file, `/${owner.list}/${i}/id`, t.id));
  }

  const known = (registry, kind, ids, file, pointer) => {
    ids.forEach((id, i) => {
      if (!registry.has(id)) fail(file, pointer(i), "unknown-reference", `unknown ${kind} ${id}`);
    });
  };
  const single = (value) => (value === undefined ? [] : [value]);
  for (const owner of owners) {
    owner.weapons.forEach((w, i) => {
      known(new Set(globals.damageTypes), "damage type", [w.damageType], owner.file, () => `/weapons/${i}/damageType`);
    });
    owner.types.forEach((t, i) => {
      const at = `/${owner.list}/${i}`;
      known(new Set(globals.armorClasses), "armour class", [t.armor], owner.file, () => `${at}/armor`);
      known(weapons, "weapon", single(t.weapon), owner.file, () => `${at}/weapon`);
      known(types, "type", single(t.freeUnit), owner.file, () => `${at}/freeUnit`);
      for (const key of ["requires", "produces", "builds"]) {
        known(types, "type", t[key] ?? [], owner.file, (j) => `${at}/${key}/${j}`);
      }
    });
  }
  return { weapons, types };
}

function checkFaction(file, faction, fail) {
  const expected = basename(file, ".yaml");
  if (faction.id !== expected) fail(file, "/id", "invalid-value", `id ${faction.id} differs from file name ${expected}`);
  const own = (id) => faction.types.find((t) => t.id === id);
  if (own(faction.hq)?.category !== "building") fail(file, "/hq", "invalid-value", "hq is not a building of this faction");
  const dozer = own(faction.dozer);
  if (dozer?.category !== "unit" || !dozer.builds?.length) {
    fail(file, "/dozer", "invalid-value", "dozer is not a unit of this faction with builds");
  }
}

function checkMap(file, map, globals, factions, index, fail) {
  const blocked = new Set();
  const occupied = new Set();
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height;
  map.blocked.forEach(([x0, y0, x1, y1], i) => {
    if (x0 > x1 || y0 > y1 || !inBounds(x0, y0) || !inBounds(x1, y1)) {
      fail(file, `/blocked/${i}`, "invalid-value", "blocked rectangle out of bounds");
      return;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) blocked.add(`${x},${y}`);
  });

  const place = (pointer, [ox, oy], [w, h], what) => {
    if (!inBounds(ox, oy) || !inBounds(ox + w - 1, oy + h - 1)) {
      fail(file, pointer, "invalid-value", `${what} footprint out of bounds`);
      return;
    }
    const cells = [];
    for (let x = ox; x < ox + w; x++) for (let y = oy; y < oy + h; y++) cells.push(`${x},${y}`);
    if (cells.some((cell) => blocked.has(cell) || occupied.has(cell))) {
      fail(file, pointer, "invalid-value", `${what} footprint overlaps a blocked cell or another footprint`);
    }
    cells.forEach((cell) => occupied.add(cell));
  };

  const depot = globals.commonTypes.find((t) => t.category === "depot");
  map.depots.forEach((d, i) => place(`/depots/${i}/origin`, d.origin, depot.footprint, "depot"));
  map.starts.forEach((start, i) => {
    const faction = factions.find((f) => f.id === start.faction);
    if (!faction) {
      fail(file, `/starts/${i}/faction`, "unknown-reference", `unknown faction ${start.faction}`);
      return;
    }
    place(`/starts/${i}/hq`, start.hq, faction.types.find((t) => t.id === faction.hq).footprint, "hq");
    const [x, y] = start.dozerCenti;
    if (x >= map.width * 100 || y >= map.height * 100) {
      fail(file, `/starts/${i}/dozerCenti`, "invalid-value", "dozer position out of bounds");
    }
  });
}

const assemble = (globals, factions, maps) => {
  const weaponList = factions.flatMap((f) => f.weapons);
  const typeList = [
    ...globals.commonTypes.map((t) => ({ t, faction: -1 })),
    ...factions.flatMap((f, faction) => f.types.map((t) => ({ t, faction }))),
  ];
  const weaponIndex = new Map(weaponList.map((w, i) => [w.id, i]));
  const typeIndex = new Map(typeList.map(({ t }, i) => [t.id, i]));
  const armorIndex = (id) => globals.armorClasses.indexOf(id);
  const types = (ids = []) => ids.map((id) => typeIndex.get(id));
  const renderSize = (t) =>
    t.category === "unit" ? t.render.size : [t.footprint[0] * 100, t.render.height, t.footprint[1] * 100];

  return {
    formatVersion: FORMAT_VERSION,
    damageTypes: globals.damageTypes,
    armorClasses: globals.armorClasses,
    damageModifiers: globals.damageTypes.map((d) => globals.armorClasses.map((a) => globals.damageModifiers[d][a])),
    startingCredits: globals.startingCredits,
    lowPowerMinSpeedPercent: globals.lowPowerMinSpeedPercent,
    lowPowerMaxSpeedPercent: globals.lowPowerMaxSpeedPercent,
    maxQueue: globals.maxQueue,
    dockRangeCenti: globals.dockRangeCenti,
    weapons: weaponList.map((w) => ({
      id: w.id,
      damageType: globals.damageTypes.indexOf(w.damageType),
      damage: w.damage,
      rangeCenti: w.rangeCenti,
      minRangeCenti: w.minRangeCenti ?? 0,
      cooldownTicks: w.cooldownTicks,
      splashCenti: w.splashCenti ?? 0,
      projectileTicks: w.projectileTicks ?? 0,
    })),
    types: typeList.map(({ t, faction }) => ({
      id: t.id,
      faction,
      category: t.category,
      armor: armorIndex(t.armor),
      hp: t.hp ?? 0,
      sightCenti: t.sightCenti ?? 0,
      cost: t.cost ?? 0,
      buildTicks: t.buildTicks ?? 0,
      speedCenti: t.speedCenti ?? 0,
      weapon: t.weapon === undefined ? -1 : weaponIndex.get(t.weapon),
      requires: types(t.requires),
      produces: types(t.produces),
      builds: types(t.builds),
      footprint: t.footprint ?? [0, 0],
      power: t.power ?? 0,
      requiresPower: t.requiresPower ?? false,
      dropOff: t.dropOff ?? false,
      capacity: t.capacity ?? 0,
      loadTicks: t.loadTicks ?? 0,
      unloadTicks: t.unloadTicks ?? 0,
      freeUnit: t.freeUnit === undefined ? -1 : typeIndex.get(t.freeUnit),
      render: { size: renderSize(t) },
    })),
    factions: factions.map((f) => ({ id: f.id, hq: typeIndex.get(f.hq), dozer: typeIndex.get(f.dozer) })),
    maps: maps.map((m) => ({
      id: m.id,
      width: m.width,
      height: m.height,
      blocked: m.blocked,
      depots: m.depots,
      starts: m.starts.map((s) => ({
        faction: factions.findIndex((f) => f.id === s.faction),
        hq: s.hq,
        dozerCenti: s.dozerCenti,
      })),
    })),
  };
};

export const serializeRuleset = (ruleset) => `${JSON.stringify(ruleset, null, 2)}\n`;

export const formatError = (e) => `${e.file} ${e.pointer} ${e.code} ${e.message}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { ruleset, errors } = buildRuleset(readSources(root));
  if (errors.length > 0) {
    errors.forEach((e) => console.error(formatError(e)));
    process.exit(1);
  }
  mkdirSync(join(root, "data", "generated"), { recursive: true });
  writeFileSync(join(root, "data", "generated", "ruleset.json"), serializeRuleset(ruleset));
}

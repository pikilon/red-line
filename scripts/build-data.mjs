// Builds data/generated/ruleset.json from the YAML sources in data/ (specs/03 §4).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";
import {
  FEATURE_STATES,
  GROUND_MATERIALS,
  ROAD_TYPES,
  WATER_DEPTHS,
  WATER_KINDS,
  checkTerrainShapes,
  expandFeatures,
  isDeepWater,
  layerHex,
  rasterizeTerrain,
} from "./map-layers.mjs";
import { expandBridges } from "./map-bridges.mjs";

/** @typedef {{ file: string, text: string }} SourceFile */
/** @typedef {{ globals: SourceFile, factions: SourceFile[], maps: SourceFile[], ai: SourceFile[], features?: SourceFile[], saves?: SourceFile[] }} Sources */
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
    features: ajv.compile(readSchema("features")),
    ai: ajv.compile(readSchema("ai")),
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

/** Reads globals, then the factions, maps, AI personalities and example saves it lists, as repository-relative files. */
export function readSources(rootDir) {
  const read = (file) => ({ file, text: readFileSync(join(rootDir, file), "utf8") });
  const globals = read(GLOBALS_FILE);
  // Spec 19 §4: a save is `<id>.yaml` (setup form) or `<id>.json` (world form).
  const saveFile = (id) => {
    const yaml = `data/saves/${id}.yaml`;
    return existsSync(join(rootDir, yaml)) ? yaml : `data/saves/${id}.json`;
  };
  return {
    globals,
    factions: listedIds(globals.text, "factions").map((id) => read(`data/factions/${id}.yaml`)),
    features: listedIds(globals.text, "features").map((id) => read(`data/features/${id}.yaml`)),
    maps: listedIds(globals.text, "maps").map((id) => read(`data/maps/${id}.yaml`)),
    ai: listedIds(globals.text, "ai").map((id) => read(`data/ai/${id}.yaml`)),
    saves: listedIds(globals.text, "saves").map((id) => read(saveFile(id))),
  };
}

/** §3.1 delivery: the written value, or `ballistic` when the weapon splashes. */
const resolvedDelivery = (w) => w.delivery ?? ((w.splashCenti ?? 0) > 0 ? "ballistic" : "homing");

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
  const featureFiles = (sources.features ?? []).map((source) => load(source, validators.features));
  const ai = (sources.ai ?? []).map((source) => load(source, validators.ai));
  if (errors.length > 0) return { ruleset: null, errors };

  checkGlobals(sources.globals.file, globals, fail);
  const index = checkReferences(sources, globals, factions, fail);
  sources.factions.forEach((source, i) => checkFaction(source.file, factions[i], fail));
  const featureTypes = checkFeatureTypes(sources.features ?? [], featureFiles, fail);
  const layers = sources.maps.map((source, i) => checkMap(source.file, maps[i], globals, factions, featureTypes, fail));
  (sources.ai ?? []).forEach((source, i) => checkAi(source.file, ai[i], factions, fail));
  if (errors.length > 0) return { ruleset: null, errors };

  return { ruleset: assemble(globals, factions, maps, ai, featureTypes, layers), errors };
}

/** Spec 26: the feature types of every data/features file, with `variants` defaulted; duplicate ids fail. */
function checkFeatureTypes(sources, files, fail) {
  const seen = new Set();
  const types = [];
  files.forEach((file, i) => {
    (file?.types ?? []).forEach((t, j) => {
      if (seen.has(t.id)) fail(sources[i].file, `/types/${j}/id`, "duplicate-id", `duplicate id ${t.id}`);
      seen.add(t.id);
      types.push({ ...t, variants: t.variants ?? 1, render: t.render ?? {} });
    });
  });
  return types;
}

/**
 * Every faction unit names a locomotor that exists in globals.locomotors, and every armed
 * building turns its turret (spec 11 §4.2).
 * Run by check-data on the repository data; buildRuleset itself stays lenient for fixtures.
 */
export function checkLocomotorCoverage(sources) {
  const errors = [];
  const globals = parse(sources.globals.text);
  const known = Object.keys(globals.locomotors ?? {});
  for (const source of sources.factions) {
    const faction = parse(source.text);
    (faction.types ?? []).forEach((t, i) => {
      if (t.category === "building" && t.weapon !== undefined && !(t.turretTurnRateDeg > 0)) {
        errors.push({ file: source.file, pointer: `/types/${i}/turretTurnRateDeg`, code: "invalid-value", message: `armed building ${t.id} has no turretTurnRateDeg` });
      }
      if (t.category !== "unit") return;
      if (t.locomotor === undefined) {
        errors.push({ file: source.file, pointer: `/types/${i}/locomotor`, code: "missing-value", message: `unit ${t.id} has no locomotor` });
      } else if (!known.includes(t.locomotor)) {
        errors.push({ file: source.file, pointer: `/types/${i}/locomotor`, code: "unknown-reference", message: `unit ${t.id} names unknown locomotor ${t.locomotor}` });
      }
    });
  }
  return errors;
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
      // Scatter needs the ballistic delivery. The schema catches the written
      // case; here the defaulted case (`splashCenti == 0` defaults to homing).
      if ((w.scatterCenti ?? 0) > 0 && resolvedDelivery(w) !== "ballistic") {
        fail(owner.file, `/weapons/${i}/scatterCenti`, "invalid-value", "scatterCenti requires ballistic delivery");
      }
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

/** Height steps per tile (one byte per corner) and the cliff spread (spec 30 §2). */
export const HEIGHT_STEPS_PER_TILE = 16;
export const CLIFF_SPREAD = 16;

const smoothstep01 = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Rounded dome profile: 1 at the centre, 0 at `radius`, flat slope at both ends. */
const dome = (distance, radius) => {
  if (radius <= 0 || distance >= radius) return 0;
  const t = distance / radius;
  return (1 - t * t) * (1 - t * t);
};

/** Distance from (x, y) to the segment a-b and the projection 0..1 along it. */
const toSegment = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length2));
  return { distance: Math.hypot(x - ax - t * dx, y - ay - t * dy), t };
};

/** Integer hash of a lattice point to [-1, 1]; the same on every machine. */
const lattice = (x, y, seed) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
};

/** Tiles per lattice cell of the plateau edge noise. */
const EDGE_NOISE_PERIOD = 3;

/** Smooth value noise in [-1, 1] at corner (x, y), one lattice per `seed`. */
const signedNoise = (x, y, seed) => {
  const gx = x / EDGE_NOISE_PERIOD;
  const gy = y / EDGE_NOISE_PERIOD;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const sx = smoothstep01(gx - ix);
  const sy = smoothstep01(gy - iy);
  const top = lattice(ix, iy, seed) * (1 - sx) + lattice(ix + 1, iy, seed) * sx;
  const bottom = lattice(ix, iy + 1, seed) * (1 - sx) + lattice(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
};

/** Tiles of smooth shoulder on each side of a ramp. */
const RAMP_SHOULDER = 3;

/**
 * Spec 30 §3: the corner heights of `map.elevation`, row-major over
 * `(width + 1) x (height + 1)`, in 1/16 tile steps; null for a flat map. Every
 * feature gives a height per corner and the highest wins. Runs at build time
 * only; the sim reads the result.
 */
export function rasterizeElevation(map) {
  const e = map.elevation;
  if (!e) return null;
  const stride = map.width + 1;
  const heights = new Uint8Array(stride * (map.height + 1));
  const plateaus = e.plateaus ?? [];
  for (let y = 0; y <= map.height; y++) {
    for (let x = 0; x <= map.width; x++) {
      let h = 0;
      for (const hill of e.hills ?? []) {
        h = Math.max(h, hill.height * dome(Math.hypot(x - hill.center[0], y - hill.center[1]), hill.radius));
      }
      for (const ridge of e.ridges ?? []) {
        h = Math.max(h, ridge.height * dome(toSegment(x, y, ridge.from, ridge.to).distance, ridge.radius));
      }
      for (const plateau of plateaus) {
        const [x0, y0, x1, y1] = plateau.rect;
        // Signed distance to the rectangle's corner outline: < 0 inside.
        const outside = Math.hypot(Math.max(x0 - x, 0, x - (x1 + 1)), Math.max(y0 - y, 0, y - (y1 + 1)));
        const inside = Math.min(x - x0, x1 + 1 - x, y - y0, y1 + 1 - y);
        const rough = plateau.rough ?? 0;
        // Noise in plateau-local coordinates, made point-symmetric, so the
        // mirrored plateau of a point-symmetric map gets the same outline.
        const u = x - (x0 + x1 + 1) / 2;
        const v = y - (y0 + y1 + 1) / 2;
        const noise = (signedNoise(u, v, 7) + signedNoise(-u, -v, 7)) / 2;
        const edge = (outside > 0 ? outside : -inside) + rough * noise;
        const slope = plateau.slope ?? 0;
        const f = edge <= 0 ? 1 : slope > 0 ? smoothstep01(1 - edge / slope) : 0;
        h = Math.max(h, plateau.height * f);
      }
      for (const ramp of e.ramps ?? []) {
        const { distance, t } = toSegment(x, y, ramp.from, ramp.to);
        const side = Math.max(0, distance - ramp.width / 2);
        h = Math.max(h, ramp.height * (1 - t) * smoothstep01(1 - side / RAMP_SHOULDER));
      }
      heights[y * stride + x] = Math.min(255, Math.max(0, Math.round(h)));
    }
  }
  return heights;
}

/** Cells whose four corners spread by `CLIFF_SPREAD` steps or more, as "x,y". */
export function cliffCells(map, heights) {
  const cells = new Set();
  if (!heights) return cells;
  const stride = map.width + 1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const corners = [heights[y * stride + x], heights[y * stride + x + 1], heights[(y + 1) * stride + x], heights[(y + 1) * stride + x + 1]];
      if (Math.max(...corners) - Math.min(...corners) >= CLIFF_SPREAD) cells.add(`${x},${y}`);
    }
  }
  return cells;
}

/** Two lowercase hex digits per corner; "" for a flat map. */
export const heightsHex = (heights) => (heights ? Buffer.from(heights).toString("hex") : "");

/**
 * Semantic checks for one map. Returns what the compiled map needs besides its own keys: the rasterised
 * `terrain` layers (or null) and the expanded feature `instances` (spec 26 Phase 1).
 */
function checkMap(file, map, globals, factions, featureTypes, fail) {
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
  // Footprints may not stand on cliffs either (spec 30 §3).
  for (const cell of cliffCells(map, rasterizeElevation(map))) blocked.add(cell);

  // Spec 26: deep water blocks like rock; roads may not cross it (bridges come with the water phase).
  const shapeProblems = checkTerrainShapes(map);
  shapeProblems.forEach((p) => fail(file, p.pointer, "invalid-value", p.message));
  const terrain = shapeProblems.length === 0 ? rasterizeTerrain(map) : null;
  if (terrain) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isDeepWater(terrain.water[y * map.width + x])) continue;
        blocked.add(`${x},${y}`);
        if (terrain.roads[y * map.width + x] !== 0) fail(file, "/terrain/roads", "invalid-value", `road on deep water at ${x},${y}`);
      }
    }
  }

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

  // Features go last: explicit ones may not touch anything above, area ones fill what is left.
  const solid = new Set([...blocked, ...occupied]);
  // Bridges first (spec 26 section 17): their deck cells are the only deep-water cells units may use.
  const bridges = expandBridges(map, featureTypes, solid, (x, y) => terrain !== null && isDeepWater(terrain.water[y * map.width + x]));
  bridges.problems.forEach((p) => fail(file, p.pointer, p.code, p.message));
  const expanded = expandFeatures(map, featureTypes, solid);
  expanded.problems.forEach((p) => fail(file, p.pointer, p.code, p.message));
  const instances = [...expanded.instances, ...bridges.instances].sort((a, b) => a.y - b.y || a.x - b.x || a.type - b.type || a.rot - b.rot);
  // Maps that use the new keys must not start a dozer on a solid cell (legacy maps are left as they are).
  if (terrain || instances.length > 0) {
    map.starts.forEach((start, i) => {
      const [x, y] = start.dozerCenti;
      if (solid.has(`${Math.floor(x / 100)},${Math.floor(y / 100)}`)) {
        fail(file, `/starts/${i}/dozerCenti`, "invalid-value", "dozer starts on a blocked cell or a footprint");
      }
    });
  }
  return { terrain, instances, bridges: bridges.layer };
}

/** Semantic checks for one AI personality file (specs/05 §4.1). */
function checkAi(file, ai, factions, fail) {
  const expected = basename(file, ".yaml");
  if (ai.id !== expected) fail(file, "/id", "invalid-value", `id ${ai.id} differs from file name ${expected}`);
  const faction = factions.find((f) => f.id === ai.faction);
  if (!faction) {
    fail(file, "/faction", "unknown-reference", `unknown faction ${ai.faction}`);
    return;
  }
  const dozer = faction.types.find((t) => t.id === faction.dozer);
  ai.buildOrder.forEach((id, i) => {
    const type = faction.types.find((t) => t.id === id);
    if (type?.category !== "building" || !dozer.builds?.includes(id)) {
      fail(file, `/buildOrder/${i}`, "invalid-value", `${id} is not a building of faction ${ai.faction} built by its dozer`);
    }
  });
  const produced = (id) => faction.types.some((t) => t.category === "building" && (t.produces ?? []).includes(id));
  const taskForces = new Set();
  ai.taskForces.forEach((taskForce, i) => {
    if (taskForces.has(taskForce.id)) fail(file, `/taskForces/${i}/id`, "duplicate-id", `duplicate task force ${taskForce.id}`);
    taskForces.add(taskForce.id);
    for (const id of Object.keys(taskForce.units)) {
      const type = faction.types.find((t) => t.id === id);
      if (!type) {
        fail(file, `/taskForces/${i}/units/${id}`, "unknown-reference", `unknown type ${id} for faction ${ai.faction}`);
      } else if (type.category !== "unit" || type.weapon === undefined || !produced(id)) {
        fail(file, `/taskForces/${i}/units/${id}`, "invalid-value", `${id} is not an armed unit produced by faction ${ai.faction}`);
      }
    }
  });
  ai.triggers.forEach((trigger, i) => {
    if (!taskForces.has(trigger.taskForce)) {
      fail(file, `/triggers/${i}/taskForce`, "unknown-reference", `unknown task force ${trigger.taskForce}`);
    }
  });
}

const assemble = (globals, factions, maps, ai, featureTypes, layers) => {
  const weaponList = factions.flatMap((f) => f.weapons);
  const typeList = [
    ...globals.commonTypes.map((t) => ({ t, faction: -1 })),
    ...factions.flatMap((f, faction) => f.types.map((t) => ({ t, faction }))),
  ];
  const weaponIndex = new Map(weaponList.map((w, i) => [w.id, i]));
  const typeIndex = new Map(typeList.map(({ t }, i) => [t.id, i]));
  const armorIndex = (id) => globals.armorClasses.indexOf(id);
  const locomotorNames = Object.keys(globals.locomotors ?? {});
  const locomotorIndex = (id) => (id === undefined ? -1 : locomotorNames.indexOf(id));
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
    aimToleranceDeg: globals.aimToleranceDeg ?? 0,
    turretRecenterTicks: globals.turretRecenterTicks ?? 0,
    locomotors: Object.entries(globals.locomotors ?? {}).map(([id, l]) => ({
      id,
      kind: { foot: "foot", tracks: "tracks", wheels: "wheels" }[l.kind],
      pivotAngleDeg: l.pivotAngleDeg ?? 0,
      minTurnSpeedPercent: l.minTurnSpeedPercent ?? 0,
      slowTurnAngleDeg: l.slowTurnAngleDeg ?? 0,
      accelCenti: l.accelCenti ?? 0,
      brakingCenti: l.brakingCenti ?? 0,
      reverseAngleDeg: l.reverseAngleDeg ?? 0,
      reverseMaxCenti: l.reverseMaxCenti ?? 0,
      reverseSpeedPercent: l.reverseSpeedPercent ?? 0,
      crusherLevel: l.crusherLevel ?? 0,
      shoveDamage: l.shoveDamage ?? 0,
      shovePushCenti: l.shovePushCenti ?? 0,
    })),
    weapons: weaponList.map((w) => ({
      id: w.id,
      damageType: globals.damageTypes.indexOf(w.damageType),
      damage: w.damage,
      rangeCenti: w.rangeCenti,
      minRangeCenti: w.minRangeCenti ?? 0,
      cooldownTicks: w.cooldownTicks,
      splashCenti: w.splashCenti ?? 0,
      projectileTicks: w.projectileTicks ?? 0,
      speedCenti: w.speedCenti ?? 0,
      // Omitted when neither the weapon nor the globals set it, so older fixtures keep their shape.
      ...((w.aimToleranceDeg ?? globals.aimToleranceDeg) === undefined ? {} : { aimToleranceDeg: w.aimToleranceDeg ?? globals.aimToleranceDeg }),
      delivery: resolvedDelivery(w) === "ballistic" ? 1 : 0,
      scatterCenti: w.scatterCenti ?? 0,
      salvo: w.salvo ?? 1,
      salvoIntervalTicks: w.salvoIntervalTicks ?? 0,
      render: {
        model: w.render?.model ?? "tracer",
        flight: w.render?.flight ?? "straight",
        apexCenti: w.render?.apexCenti ?? 0,
        launch: w.render?.launch ?? "muzzle",
        trail: w.render?.trail ?? "none",
      },
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
      turnRateDeg: t.turnRateDeg ?? 0,
      radiusCenti: t.radiusCenti ?? 0,
      turretTurnRateDeg: t.turretTurnRateDeg ?? 0,
      articulation: t.articulation ?? "none",
      stationaryFire: t.articulation === "launcher",
      locomotor: locomotorIndex(t.locomotor),
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
    // Spec 26: names of the byte values of the map layers below, in index order.
    layerNames: {
      ground: GROUND_MATERIALS,
      roads: ROAD_TYPES,
      waterDepths: WATER_DEPTHS,
      waterKinds: WATER_KINDS,
      featureStates: FEATURE_STATES,
    },
    featureTypes: featureTypes.map((t) => ({
      id: t.id,
      family: t.family,
      footprint: t.footprint,
      blocks: t.blocks,
      variants: t.variants,
      ...(t.lanes === undefined ? {} : { lanes: t.lanes }),
      render: t.render,
    })),
    maps: maps.map((m, mi) => ({
      id: m.id,
      width: m.width,
      height: m.height,
      blocked: m.blocked,
      depots: m.depots,
      heights: heightsHex(rasterizeElevation(m)),
      // Only maps that use `terrain:` / `features:` carry these keys (legacy maps compile unchanged).
      ...(layers[mi].terrain === null
        ? {}
        : {
            ground: layerHex(layers[mi].terrain.ground),
            roads: layerHex(layers[mi].terrain.roads),
            water: layerHex(layers[mi].terrain.water),
          }),
      ...(layers[mi].bridges === null ? {} : { bridges: layerHex(layers[mi].bridges) }),
      ...(layers[mi].instances.length === 0 ? {} : { features: layers[mi].instances }),
      starts: m.starts.map((s) => ({
        faction: factions.findIndex((f) => f.id === s.faction),
        hq: s.hq,
        dozerCenti: s.dozerCenti,
      })),
    })),
    ai: ai.map((a) => ({
      id: a.id,
      faction: factions.findIndex((f) => f.id === a.faction),
      harvesters: a.harvesters,
      defenseRadiusCenti: a.defenseRadiusCenti,
      buildOrder: types(a.buildOrder),
      taskForces: a.taskForces.map((tf) => ({
        id: tf.id,
        units: Object.entries(tf.units).map(([id, count]) => [typeIndex.get(id), count]),
      })),
      triggers: a.triggers.map((t) => ({
        taskForce: a.taskForces.findIndex((tf) => tf.id === t.taskForce),
        weight: t.weight,
        minTick: t.minTick,
      })),
    })),
  };
};

export const serializeRuleset = (ruleset) => `${JSON.stringify(ruleset, null, 2)}\n`;

export const formatError = (e) => `${e.file} ${e.pointer} ${e.code} ${e.message}`;


/** Format of `data/generated/saves.json` (spec 19 §4.3). */
const SAVES_FORMAT_VERSION = 1;
const SAVE_FILE_FORMAT = "redline-save";
const SAVE_FILE_VERSION = 1;
const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Spec 19 §4.3: validates the example saves and builds their `SaveFile`s.
 * @returns {{ saves: { id: string, file: object }[], index: object, errors: DataError[] }}
 */
export function buildSaves(sources, ruleset) {
  /** @type {DataError[]} */
  const errors = [];
  const fail = (file, pointer, code, message) => errors.push({ file, pointer, code, message });
  // Self-contained schema: compiling it alone keeps Ajv's faction warnings single.
  const validate = new Ajv2020({ allErrors: true }).compile(readSchema("save"));
  const saves = [];
  for (const source of sources ?? []) {
    const id = basename(source.file).replace(/\.(yaml|json)$/, "");
    const before = errors.length;
    const file = source.file.endsWith(".json")
      ? worldSave(source, id, ruleset, fail)
      : setupSave(source, id, ruleset, validate, fail);
    if (errors.length === before && file !== null) saves.push({ id, file });
  }
  if (errors.length > 0) return { saves: [], index: null, errors };
  const index = {
    formatVersion: SAVES_FORMAT_VERSION,
    saves: saves.map(({ id, file }) => ({
      id,
      map: file.match.mapId,
      form: file.setup ? "setup" : "world",
      entities: (file.setup ?? file.world).entities?.length ?? 0,
    })),
  };
  return { saves, index, errors };
}

/** A world-form save copied from the game (spec 19 §4.2), checked shallowly. */
function worldSave(source, id, ruleset, fail) {
  let data;
  try {
    data = JSON.parse(source.text);
  } catch (error) {
    fail(source.file, "/", "parse", error.message.split("\n")[0]);
    return null;
  }
  if (id.startsWith("slot-")) fail(source.file, "/", "invalid-value", `id ${id} is reserved for player slots`);
  if (data?.format !== SAVE_FILE_FORMAT || data?.version !== SAVE_FILE_VERSION) {
    fail(source.file, "/format", "invalid-value", `not a ${SAVE_FILE_FORMAT} v${SAVE_FILE_VERSION} file`);
    return null;
  }
  if (typeof data.world !== "object" || data.world === null || data.setup !== undefined) {
    fail(source.file, "/world", "invalid-value", "a world-form save needs world and no setup");
    return null;
  }
  if (!ruleset.maps.some((m) => m.id === data.match?.mapId)) {
    fail(source.file, "/match/mapId", "unknown-reference", `unknown map ${data.match?.mapId}`);
  }
  return data;
}

/** A setup-form save (spec 19 §4.1) and its generated `SaveFile`. */
function setupSave(source, id, ruleset, validate, fail) {
  const file = source.file;
  let data;
  try {
    data = parse(source.text);
  } catch (error) {
    fail(file, "/", "parse", error.message.split("\n")[0]);
    return null;
  }
  if (!validate(data)) {
    for (const e of validate.errors) fail(file, e.instancePath || "/", "schema", e.message);
    return null;
  }
  if (data.id !== id) fail(file, "/id", "invalid-value", `id ${data.id} differs from file name ${id}`);
  if (data.id.startsWith("slot-")) fail(file, "/id", "invalid-value", `id ${data.id} is reserved for player slots`);
  const map = ruleset.maps.find((m) => m.id === data.map);
  if (!map) {
    fail(file, "/map", "unknown-reference", `unknown map ${data.map}`);
    return null;
  }
  const starts = data.starts ?? true;
  const debug = data.debug ?? false;
  (data.ai ?? []).forEach((ai, i) => {
    if (!ruleset.ai.some((a) => a.id === ai.personality)) {
      fail(file, `/ai/${i}/personality`, "unknown-reference", `unknown personality ${ai.personality}`);
    }
  });
  checkSetupEntities(file, data, map, starts, ruleset, fail);

  const client = data.client ?? {};
  const controlled = client.controlled ?? 0;
  const setup = {
    map: data.map,
    seed: String(data.seed ?? 1),
    victory: data.victory,
    debug,
    starts,
    ...(data.credits === undefined ? {} : { credits: data.credits }),
    ai: data.ai ?? [],
    entities: data.entities ?? [],
  };
  return {
    format: SAVE_FILE_FORMAT,
    version: SAVE_FILE_VERSION,
    name: id,
    savedAt: EPOCH,
    tick: 0,
    match: { mapId: data.map, seed: setup.seed, debug, speed: data.speed ?? 1 },
    client: {
      controlled,
      revealed: client.revealed ?? false,
      gore: client.gore ?? true,
      generatedTextures: client.generatedTextures ?? true,
      fpsPanel: client.fpsPanel ?? debug,
      camera: client.camera ?? defaultCamera(data, map, starts, controlled, ruleset),
      cameraMemory: {},
      selected: [],
    },
    setup,
  };
}

/** The controlled player's HQ centre at zoom 1, else the map centre (spec 19 §5.1). */
function defaultCamera(data, map, starts, controlled, ruleset) {
  const start = map.starts[controlled];
  const hq = start === undefined ? null : ruleset.types[ruleset.factions[start.faction].hq];
  const centre = (origin, footprint) => ({ x: origin[0] + footprint[0] / 2, y: origin[1] + footprint[1] / 2, zoom: 1 });
  if (hq && starts) return centre(start.hq, hq.footprint);
  const placed = (data.entities ?? []).find((e) => e.player === controlled && e.type === hq?.id && e.origin);
  if (placed) return centre(placed.origin, hq.footprint);
  return { x: map.width / 2, y: map.height / 2, zoom: 1 };
}

/** References, placement and labels of a setup's entities (spec 19 §4.3). */
function checkSetupEntities(file, data, map, starts, ruleset, fail) {
  const typeById = new Map(ruleset.types.map((t) => [t.id, t]));
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height;
  const blocked = new Set();
  for (const [x0, y0, x1, y1] of map.blocked) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) blocked.add(`${x},${y}`);
  }
  const occupied = new Set();
  const footprintCells = ([ox, oy], [w, h]) => {
    const cells = [];
    for (let x = ox; x < ox + w; x++) for (let y = oy; y < oy + h; y++) cells.push(`${x},${y}`);
    return cells;
  };
  const labels = new Set();
  const depot = ruleset.types.find((t) => t.category === "depot");
  map.depots.forEach((d, i) => {
    footprintCells(d.origin, depot.footprint).forEach((cell) => occupied.add(cell));
    labels.add(`depot-${i}`);
  });
  if (starts) {
    map.starts.forEach((start, player) => {
      const faction = ruleset.factions[start.faction];
      footprintCells(start.hq, ruleset.types[faction.hq].footprint).forEach((cell) => occupied.add(cell));
      labels.add(`hq-${player}`);
      labels.add(`dozer-${player}`);
    });
  }

  const entities = data.entities ?? [];
  entities.forEach((e, i) => {
    const at = `/entities/${i}`;
    const start = map.starts[e.player];
    if (start === undefined) fail(file, `${at}/player`, "invalid-value", `player ${e.player} has no start on ${map.id}`);
    const type = typeById.get(e.type);
    if (!type) {
      fail(file, `${at}/type`, "unknown-reference", `unknown type ${e.type}`);
      return;
    }
    if (type.category === "depot") {
      fail(file, `${at}/type`, "invalid-value", `${e.type} is a depot`);
      return;
    }
    if (start !== undefined && type.faction !== -1 && type.faction !== start.faction) {
      fail(file, `${at}/type`, "unknown-reference", `${e.type} is not of player ${e.player}'s faction`);
    }
    if (type.category === "building") {
      if (e.atCenti !== undefined) fail(file, `${at}/atCenti`, "invalid-value", "a building takes origin, not atCenti");
      if (e.origin === undefined) {
        fail(file, `${at}/origin`, "invalid-value", "a building needs origin");
        return;
      }
      const cells = footprintCells(e.origin, type.footprint);
      const [w, h] = type.footprint;
      if (!inBounds(e.origin[0], e.origin[1]) || !inBounds(e.origin[0] + w - 1, e.origin[1] + h - 1)) {
        fail(file, `${at}/origin`, "invalid-value", "footprint out of the map");
      } else if (cells.some((cell) => blocked.has(cell) || occupied.has(cell))) {
        fail(file, `${at}/origin`, "invalid-value", "footprint overlaps a blocked cell or another entity");
      }
      cells.forEach((cell) => occupied.add(cell));
    } else {
      if (e.origin !== undefined) fail(file, `${at}/origin`, "invalid-value", "a unit takes atCenti, not origin");
      if (e.buildPercent !== undefined) fail(file, `${at}/buildPercent`, "invalid-value", "buildPercent is for buildings");
      if (e.atCenti === undefined) {
        fail(file, `${at}/atCenti`, "invalid-value", "a unit needs atCenti");
        return;
      }
      const x = Math.floor(e.atCenti[0] / 100);
      const y = Math.floor(e.atCenti[1] / 100);
      if (!inBounds(x, y)) fail(file, `${at}/atCenti`, "invalid-value", "unit out of the map");
      else if (blocked.has(`${x},${y}`) || occupied.has(`${x},${y}`)) {
        fail(file, `${at}/atCenti`, "invalid-value", "unit on a blocked cell or a footprint");
      }
    }
    if (e.label !== undefined) {
      if (labels.has(e.label)) fail(file, `${at}/label`, "duplicate-id", `duplicate label ${e.label}`);
      labels.add(e.label);
    }
  });
  entities.forEach((e, i) => {
    const target = e.order?.attack ?? e.order?.harvest;
    if (target !== undefined && !labels.has(target)) {
      fail(file, `/entities/${i}/order`, "unknown-reference", `unknown label ${target}`);
    }
  });
}

export const serializeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Writes `data/generated/saves/<id>.json` and `saves.json`, removing stale files. */
export function writeSaves(root, built) {
  const dir = join(root, "data", "generated", "saves");
  mkdirSync(dir, { recursive: true });
  const keep = new Set(built.saves.map(({ id }) => `${id}.json`));
  for (const name of readdirSync(dir)) if (!keep.has(name)) rmSync(join(dir, name));
  for (const { id, file } of built.saves) writeFileSync(join(dir, `${id}.json`), serializeJson(file));
  writeFileSync(join(root, "data", "generated", "saves.json"), serializeJson(built.index));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { ruleset, errors } = buildRuleset(readSources(root));
  if (errors.length > 0) {
    errors.forEach((e) => console.error(formatError(e)));
    process.exit(1);
  }
  mkdirSync(join(root, "data", "generated"), { recursive: true });
  writeFileSync(join(root, "data", "generated", "ruleset.json"), serializeRuleset(ruleset));
  const built = buildSaves(readSources(root).saves, ruleset);
  if (built.errors.length > 0) {
    built.errors.forEach((e) => console.error(formatError(e)));
    process.exit(1);
  }
  writeSaves(root, built);
}

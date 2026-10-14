import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { buildRuleset, readSources, serializeRuleset } from "./build-data.mjs";
import { TURRETED } from "../tools/models/check.mjs";

// Repository root (this file lives in scripts/), used by the two criteria that
// operate on the builtin data committed in the repository (specs/03 §7).
const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..");

// Produced unit types of a type (for the AC-03-04 roster checks).
const producedUnits = (t, ruleset) =>
  (t.produces ?? []).filter((idx) => idx != null && ruleset.types[idx]?.category === "unit").map((idx) => ruleset.types[idx]);
const infantryProduceCount = (t, ruleset) =>
  producedUnits(t, ruleset).filter((u) => ruleset.armorClasses[u.armor] === "infantry").length;
const vehicleProduceCount = (t, ruleset) =>
  producedUnits(t, ruleset).filter((u) => ruleset.armorClasses[u.armor] !== "infantry").length;

// A small valid data set shaped like the builtin one (specs/03 §4.2). It keeps
// the names the criteria refer to: ua-rifleman is the first type of
// ukraine.yaml, ua-barracks requires a power plant, and first-line is 128x128.
const faction = (id, prefix) => ({
  id,
  hq: `${prefix}-hq`,
  dozer: `${prefix}-dozer`,
  weapons: [{ id: `${prefix}-rifle`, damageType: "smallArms", damage: 10, rangeCenti: 450, cooldownTicks: 15 }],
  types: [
    {
      id: `${prefix}-rifleman`, category: "unit", armor: "infantry", hp: 100, sightCenti: 600,
      cost: 100, buildTicks: 75, speedCenti: 8, turnRateDeg: 300, weapon: `${prefix}-rifle`, render: { size: [30, 60, 30] },
    },
    {
      id: `${prefix}-dozer`, category: "unit", armor: "infantry", hp: 300, sightCenti: 500,
      cost: 800, buildTicks: 200, speedCenti: 15, turnRateDeg: 150, builds: [`${prefix}-power-plant`, `${prefix}-barracks`],
      render: { size: [80, 60, 100] },
    },
    {
      id: `${prefix}-hq`, category: "building", armor: "structure", hp: 3000, sightCenti: 900,
      footprint: [4, 4], produces: [`${prefix}-dozer`], render: { height: 150 },
    },
    {
      id: `${prefix}-power-plant`, category: "building", armor: "structure", hp: 1000, sightCenti: 500,
      cost: 600, buildTicks: 150, footprint: [3, 3], power: 10, render: { height: 120 },
    },
    {
      id: `${prefix}-barracks`, category: "building", armor: "structure", hp: 1000, sightCenti: 500,
      cost: 500, buildTicks: 150, footprint: [3, 3], power: -2, requires: [`${prefix}-power-plant`],
      produces: [`${prefix}-rifleman`], render: { height: 90 },
    },
  ],
});

const personality = () => ({
  id: "ukraine-balanced",
  faction: "ukraine",
  harvesters: 3,
  defenseRadiusCenti: 2000,
  buildOrder: ["ua-power-plant", "ua-barracks"],
  taskForces: [{ id: "infantry", units: { "ua-rifleman": 2 } }],
  triggers: [{ taskForce: "infantry", weight: 50, minTick: 0 }],
});

const baseline = () => ({
  globals: {
    factions: ["ukraine", "russia"],
    maps: ["first-line"],
    ai: ["ukraine-balanced"],
    damageTypes: ["smallArms"],
    armorClasses: ["infantry", "structure"],
    damageModifiers: { smallArms: { infantry: 100, structure: 10 } },
    startingCredits: 5000,
    lowPowerMinSpeedPercent: 25,
    lowPowerMaxSpeedPercent: 75,
    maxQueue: 9,
    dockRangeCenti: 100,
    commonTypes: [
      {
        id: "tech-slice-placeholder", category: "unit", armor: "infantry", hp: 1, sightCenti: 0,
        speedCenti: 20, render: { size: [40, 50, 40] },
      },
      { id: "supply-depot", category: "depot", armor: "structure", footprint: [2, 2], render: { height: 60 } },
    ],
  },
  ukraine: faction("ukraine", "ua"),
  russia: faction("russia", "ru"),
  map: {
    id: "first-line",
    width: 128,
    height: 128,
    blocked: [[62, 0, 65, 27]],
    depots: [{ origin: [12, 54], amount: 15000 }],
    starts: [
      { faction: "ukraine", hq: [12, 60], dozerCenti: [1850, 6150] },
      { faction: "russia", hq: [112, 64], dozerCenti: [10950, 6650] },
    ],
  },
  ai: personality(),
});

const FILES = {
  globals: "data/rules/globals.yaml",
  ukraine: "data/factions/ukraine.yaml",
  russia: "data/factions/russia.yaml",
  map: "data/maps/first-line.yaml",
  ai: "data/ai/ukraine-balanced.yaml",
};

const toSources = (data, overrides = {}) => {
  const text = (key) => overrides[key] ?? stringify(data[key]);
  const source = (key) => ({ file: FILES[key], text: text(key) });
  return {
    globals: source("globals"),
    factions: [source("ukraine"), source("russia")],
    maps: [source("map")],
    ai: [source("ai")],
  };
};

/** Sources equal to the baseline except for the change `edit` applies to the data. */
const changed = (edit) => {
  const data = baseline();
  edit(data);
  return toSources(data);
};

const expectError = (sources, expected) => {
  const { ruleset, errors } = buildRuleset(sources);
  assert.equal(ruleset, null);
  assert.ok(
    errors.some((e) => Object.entries(expected).every(([key, value]) => e[key] === value)),
    `expected ${JSON.stringify(expected)} in ${JSON.stringify(errors)}`,
  );
};

test("AC-03-02: reports schema violations with file and pointer", () => {
  const ok = buildRuleset(toSources(baseline()));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.ruleset.formatVersion, 1);
  assert.ok(serializeRuleset(ok.ruleset).endsWith("}\n"));

  const ukraine = FILES.ukraine;
  expectError(changed((d) => { d.ukraine.types[0].hp = 0; }), { code: "schema", file: ukraine, pointer: "/types/0/hp" });
  expectError(changed((d) => { d.ukraine.types[0].speedCenti = 1.5; }), {
    code: "schema", file: ukraine, pointer: "/types/0/speedCenti",
  });
  expectError(changed((d) => { d.ukraine.types[0].color = "red"; }), {
    code: "schema", file: ukraine, pointer: "/types/0",
  });
  expectError(changed((d) => { delete d.globals.startingCredits; }), {
    code: "schema", file: FILES.globals, pointer: "/",
  });
  expectError(toSources(baseline(), { ukraine: "id: [unclosed" }), { code: "parse", file: ukraine });
});

test("AC-03-03: reports reference and semantic errors", () => {
  expectError(changed((d) => { d.ukraine.types[0].weapon = "nope"; }), {
    code: "unknown-reference", file: FILES.ukraine, pointer: "/types/0/weapon",
  });
  expectError(
    changed((d) => { d.russia.types.push({ ...d.ukraine.types[0] }); }),
    { code: "duplicate-id", file: FILES.russia, pointer: `/types/${baseline().russia.types.length}/id` },
  );
  expectError(changed((d) => { d.ukraine.types[4].requires = ["ua-nope"]; }), {
    code: "unknown-reference", file: FILES.ukraine,
  });

  const { ruleset, errors } = buildRuleset(changed((d) => { d.globals.maxQueue = 10; }));
  assert.equal(ruleset, null);
  assert.ok(errors.some((e) => ["invalid-value", "schema"].includes(e.code)));

  expectError(changed((d) => { d.map.depots.push({ origin: [127, 0], amount: 100 }); }), {
    code: "invalid-value", file: FILES.map,
  });
  expectError(changed((d) => { d.map.depots.push({ origin: [63, 10], amount: 100 }); }), {
    code: "invalid-value", file: FILES.map,
  });
});

test("AC-03-01: builtin data is valid and the generated ruleset is current", () => {
  const root = repoRoot();
  const { ruleset, errors } = buildRuleset(readSources(root));
  assert.deepEqual(errors, []);
  const generated = readFileSync(join(root, "data/generated/ruleset.json"), "utf8");
  assert.equal(serializeRuleset(ruleset), generated);
});

test("AC-03-04: rosters and the first-line map follow the design", () => {
  const root = repoRoot();
  const ruleset = JSON.parse(readFileSync(join(root, "data/generated/ruleset.json"), "utf8"));

  // Per-faction roster: exactly the shape specs/03 §4.5 prescribes.
  ruleset.factions.forEach((faction, fi) => {
    const mine = ruleset.types.filter((t) => t.faction === fi);
    const units = mine.filter((t) => t.category === "unit");
    const buildings = mine.filter((t) => t.category === "building");
    const dozerType = ruleset.types[faction.dozer];
    const hqType = ruleset.types[faction.hq];
    const truckIndex = ruleset.types.indexOf(units.find((t) => t.capacity > 0));

    // 6 armed units, exactly one builder (the faction dozer), one truck.
    assert.equal(units.filter((t) => t.weapon != null && t.weapon >= 0).length, 6);
    const builders = units.filter((t) => (t.builds ?? []).length > 0);
    assert.equal(builders.length, 1);
    assert.equal(builders[0], dozerType);
    assert.equal(units.filter((t) => t.capacity > 0).length, 1);

    // Six buildings with the expected roles.
    assert.equal(buildings.length, 6);
    assert.ok(hqType.produces.includes(faction.dozer), "HQ produces the dozer");
    assert.ok(buildings.some((b) => b.power > 0), "a building produces power");
    assert.ok(buildings.some((b) => b.dropOff && b.freeUnit === truckIndex), "supply center frees the truck");
    assert.ok(buildings.some((b) => infantryProduceCount(b, ruleset) === 2), "barracks produces 2 infantry");
    assert.ok(buildings.some((b) => vehicleProduceCount(b, ruleset) === 4), "factory produces 4 vehicles");
    assert.ok(buildings.some((b) => b.requiresPower && (b.weapon ?? -1) >= 0), "defense is powered and armed");

    // Every requires/produces/builds/freeUnit entry stays inside the faction.
    for (const t of mine) {
      for (const list of [t.requires, t.produces, t.builds]) {
        for (const idx of list ?? []) assert.equal(ruleset.types[idx].faction, fi);
      }
      if (t.freeUnit != null && t.freeUnit >= 0) assert.equal(ruleset.types[t.freeUnit].faction, fi);
    }
  });

  // first-line is point-symmetric (specs/03 §4.5).
  const map = ruleset.maps.find((m) => m.id === "first-line");
  assert.ok(map, "map first-line exists");

  const blocked = new Set();
  for (const [x0, y0, x1, y1] of map.blocked) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) blocked.add(`${x},${y}`);
  }
  for (const cell of blocked) {
    const [x, y] = cell.split(",").map(Number);
    assert.ok(blocked.has(`${127 - x},${127 - y}`), `blocked not symmetric at (${x},${y})`);
  }

  const depotByKey = new Map(map.depots.map((d) => [`${d.origin[0]},${d.origin[1]}`, d]));
  for (const d of map.depots) {
    const mirror = depotByKey.get(`${126 - d.origin[0]},${126 - d.origin[1]}`);
    assert.ok(mirror, `depot ${d.origin} has no mirror`);
    assert.equal(mirror.amount, d.amount);
  }

  const [s0, s1] = map.starts;
  assert.equal(s1.faction, 1 - s0.faction);
  assert.deepEqual(s1.hq, [124 - s0.hq[0], 124 - s0.hq[1]]);
  assert.deepEqual(s1.dozerCenti, [12800 - s0.dozerCenti[0], 12800 - s0.dozerCenti[1]]);
});

test("AC-05-01: personality sources build", () => {
  const root = repoRoot();
  const { ruleset, errors } = buildRuleset(readSources(root));
  assert.deepEqual(errors, []);
  assert.equal(serializeRuleset(ruleset), readFileSync(join(root, "data/generated/ruleset.json"), "utf8"));

  const typeIndex = new Map(ruleset.types.map((t, i) => [t.id, i]));
  const kinds = (pairs) => pairs.map(([id, count]) => [typeIndex.get(id), count]);
  const buildOrder = (ids) => ids.map((id) => typeIndex.get(id));
  const factionIndex = (id) => ruleset.factions.findIndex((f) => f.id === id);

  // Personality values are tuned by the balance work (spec 05 §4.3), so this
  // checks the assembly against the YAML sources instead of pinning numbers.
  const ids = ["ukraine-balanced", "ukraine-rush", "russia-balanced", "russia-rush"];
  assert.deepEqual(ruleset.ai.map((ai) => ai.id), ids);
  ids.forEach((id, i) => {
    const source = parse(readFileSync(join(root, `data/ai/${id}.yaml`), "utf8"));
    const forceIds = source.taskForces.map((force) => force.id);
    assert.deepEqual(ruleset.ai[i], {
      id,
      faction: factionIndex(source.faction),
      harvesters: source.harvesters,
      defenseRadiusCenti: source.defenseRadiusCenti,
      buildOrder: buildOrder(source.buildOrder),
      taskForces: source.taskForces.map((force) => ({ id: force.id, units: kinds(Object.entries(force.units)) })),
      triggers: source.triggers.map((t) => ({ taskForce: forceIds.indexOf(t.taskForce), weight: t.weight, minTick: t.minTick })),
    });
  });
});

test("AC-05-02: personality semantic checks", () => {
  const file = FILES.ai;
  expectError(changed((d) => { d.ai.buildOrder = ["ua-rifleman"]; }), {
    code: "invalid-value", file, pointer: "/buildOrder/0",
  });
  expectError(changed((d) => { d.ai.taskForces[0].units = { "ru-rifleman": 2 }; }), {
    code: "unknown-reference", file, pointer: "/taskForces/0/units/ru-rifleman",
  });
  expectError(changed((d) => { d.ai.triggers[0].taskForce = "nope"; }), {
    code: "unknown-reference", file, pointer: "/triggers/0/taskForce",
  });
});

// Hull and turret turn rates of spec 06 §5.1, in integer degrees per second
// (0 means "does not turn"). Supply trucks and dozers share the 150 hull rate.
const TURN_RATES = {
  "ua-rifleman": [720, 0],
  "ru-rifleman": [720, 0],
  "ua-stugna-team": [540, 0],
  "ru-rpg-gunner": [540, 0],
  "ua-kozak-scout": [300, 270],
  "ru-brdm-scout": [300, 240],
  "ua-bradley": [220, 180],
  "ru-bmp-2": [240, 150],
  "ua-leopard-2a4": [180, 135],
  "ru-t-72b3": [200, 105],
  "ua-himars": [140, 90],
  "ru-tos-1a": [160, 75],
  "ua-dozer": [150, 0],
  "ru-dozer": [150, 0],
  "ua-supply-truck": [150, 0],
  "ru-supply-truck": [150, 0],
  "ua-defense": [0, 120],
  "ru-defense": [0, 120],
};

test("AC-06-09: turn rates from data", () => {
  const root = repoRoot();
  const { ruleset, errors } = buildRuleset(readSources(root));
  assert.deepEqual(errors, []);
  const byId = new Map(ruleset.types.map((t) => [t.id, t]));

  // Every listed type carries the §5.1 table values.
  for (const [id, [hull, turret]] of Object.entries(TURN_RATES)) {
    const type = byId.get(id);
    assert.ok(type, `missing type ${id}`);
    assert.equal(type.turnRateDeg, hull, `${id} hull turn rate`);
    assert.equal(type.turretTurnRateDeg, turret, `${id} turret turn rate`);
  }

  // Faction units turn, buildings and depots do not; exactly the types of
  // TURRETED turn their turret. (The tech-slice placeholder is not a unit of
  // any faction, so it keeps both rates at 0.)
  const turreted = new Set(TURRETED);
  for (const type of ruleset.types) {
    if (type.category === "unit" && type.faction >= 0) {
      assert.ok(type.turnRateDeg > 0, `${type.id} has no hull turn rate`);
    }
    if (type.category !== "unit") {
      assert.equal(type.turnRateDeg, 0, `${type.id} is not a unit but has a hull turn rate`);
    }
    assert.equal(type.turretTurnRateDeg > 0, turreted.has(type.id), `${type.id} turret turn rate`);
  }

  // The schema makes turnRateDeg mandatory for faction units and forbidden for
  // buildings and depots (spec 06 §5.1).
  expectError(changed((d) => { delete d.ukraine.types[0].turnRateDeg; }), {
    code: "schema", file: FILES.ukraine, pointer: "/types/0",
  });
  expectError(changed((d) => { d.ukraine.types[2].turnRateDeg = 100; }), {
    code: "schema", file: FILES.ukraine,
  });
});

test("AC-17-01: weapon schema", () => {
  const file = FILES.ukraine;
  const { ruleset, errors } = buildRuleset(
    changed((d) => {
      // Every §3.1 field written out.
      d.ukraine.weapons.push({
        id: "ua-explicit", damageType: "smallArms", damage: 10, rangeCenti: 450, cooldownTicks: 15,
        speedCenti: 400, delivery: "ballistic", scatterCenti: 25, salvo: 2, salvoIntervalTicks: 8,
        render: { model: "rpg", flight: "boost", apexCenti: 40, launch: "backblast", trail: "smoke" },
      });
      // Only the legacy fields: every §3.1 field takes its default.
      d.ukraine.weapons.push({
        id: "ua-defaults", damageType: "smallArms", damage: 10, rangeCenti: 450, cooldownTicks: 15,
      });
      // splashCenti > 0 makes the delivered default ballistic.
      d.ukraine.weapons.push({
        id: "ua-splash", damageType: "smallArms", damage: 10, rangeCenti: 450, cooldownTicks: 15, splashCenti: 150,
      });
      // A partial render block fills the rest with the §3.2 defaults.
      d.ukraine.weapons.push({
        id: "ua-partial-render", damageType: "smallArms", damage: 10, rangeCenti: 450, cooldownTicks: 15,
        render: { trail: "smoke" },
      });
    }),
  );
  assert.deepEqual(errors, []);
  const weapon = (id) => {
    const found = ruleset.weapons.find((w) => w.id === id);
    assert.ok(found, `missing weapon ${id}`);
    return found;
  };
  const base = {
    damageType: 0, damage: 10, rangeCenti: 450, minRangeCenti: 0, cooldownTicks: 15,
    splashCenti: 0, projectileTicks: 0,
  };
  const render = (values) => ({ model: "tracer", flight: "straight", apexCenti: 0, launch: "muzzle", trail: "none", ...values });

  assert.deepEqual(weapon("ua-explicit"), {
    id: "ua-explicit", ...base,
    speedCenti: 400, delivery: 1, scatterCenti: 25, salvo: 2, salvoIntervalTicks: 8,
    render: render({ model: "rpg", flight: "boost", apexCenti: 40, launch: "backblast", trail: "smoke" }),
  });
  assert.deepEqual(weapon("ua-defaults"), {
    id: "ua-defaults", ...base,
    speedCenti: 0, delivery: 0, scatterCenti: 0, salvo: 1, salvoIntervalTicks: 0, render: render(),
  });
  assert.deepEqual(weapon("ua-splash"), {
    id: "ua-splash", ...base, splashCenti: 150,
    speedCenti: 0, delivery: 1, scatterCenti: 0, salvo: 1, salvoIntervalTicks: 0, render: render(),
  });
  assert.deepEqual(weapon("ua-partial-render").render, render({ trail: "smoke" }));

  // speedCenti and projectileTicks are mutually exclusive.
  expectError(
    changed((d) => { d.ukraine.weapons[0].speedCenti = 400; d.ukraine.weapons[0].projectileTicks = 10; }),
    { code: "schema", file, pointer: "/weapons/0/projectileTicks" },
  );
  // scatterCenti > 0 needs ballistic delivery, written or implicit.
  expectError(
    changed((d) => { d.ukraine.weapons[0].delivery = "homing"; d.ukraine.weapons[0].scatterCenti = 10; }),
    { code: "schema", file, pointer: "/weapons/0/scatterCenti" },
  );
  expectError(
    changed((d) => { d.ukraine.weapons[0].scatterCenti = 10; }),
    { code: "invalid-value", file, pointer: "/weapons/0/scatterCenti" },
  );
  // render values are a closed set.
  expectError(
    changed((d) => { d.ukraine.weapons[0].render = { model: "laser" }; }),
    { code: "schema", file, pointer: "/weapons/0/render/model" },
  );

  // The generated builtin ruleset fills every §3.1 field on every weapon.
  const builtin = JSON.parse(readFileSync(join(repoRoot(), "data/generated/ruleset.json"), "utf8"));
  for (const w of builtin.weapons) {
    for (const key of ["speedCenti", "delivery", "scatterCenti", "salvo", "salvoIntervalTicks", "render"]) {
      assert.ok(key in w, `${w.id} is missing ${key}`);
    }
    for (const key of ["model", "flight", "apexCenti", "launch", "trail"]) {
      assert.ok(key in w.render, `${w.id} render is missing ${key}`);
    }
  }
});

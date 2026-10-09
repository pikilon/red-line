import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { buildRuleset, serializeRuleset } from "./build-data.mjs";

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
      cost: 100, buildTicks: 75, speedCenti: 8, weapon: `${prefix}-rifle`, render: { size: [30, 60, 30] },
    },
    {
      id: `${prefix}-dozer`, category: "unit", armor: "infantry", hp: 300, sightCenti: 500,
      cost: 800, buildTicks: 200, speedCenti: 15, builds: [`${prefix}-power-plant`, `${prefix}-barracks`],
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

const baseline = () => ({
  globals: {
    factions: ["ukraine", "russia"],
    maps: ["first-line"],
    damageTypes: ["smallArms"],
    armorClasses: ["infantry", "structure"],
    damageModifiers: { smallArms: { infantry: 100, structure: 10 } },
    startingCredits: 5000,
    lowPowerMinSpeedPercent: 25,
    lowPowerMaxSpeedPercent: 75,
    maxQueue: 5,
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
});

const FILES = {
  globals: "data/rules/globals.yaml",
  ukraine: "data/factions/ukraine.yaml",
  russia: "data/factions/russia.yaml",
  map: "data/maps/first-line.yaml",
};

const toSources = (data, overrides = {}) => {
  const text = (key) => overrides[key] ?? stringify(data[key]);
  const source = (key) => ({ file: FILES[key], text: text(key) });
  return {
    globals: source("globals"),
    factions: [source("ukraine"), source("russia")],
    maps: [source("map")],
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

  const { ruleset, errors } = buildRuleset(changed((d) => { d.globals.maxQueue = 6; }));
  assert.equal(ruleset, null);
  assert.ok(errors.some((e) => ["invalid-value", "schema"].includes(e.code)));

  expectError(changed((d) => { d.map.depots.push({ origin: [127, 0], amount: 100 }); }), {
    code: "invalid-value", file: FILES.map,
  });
  expectError(changed((d) => { d.map.depots.push({ origin: [63, 10], amount: 100 }); }), {
    code: "invalid-value", file: FILES.map,
  });
});

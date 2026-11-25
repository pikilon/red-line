// Spec 62: validates data/campaign/mission-scripts.yaml and builds
// data/generated/mission-scripts.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

export const SOURCE = join("data", "campaign", "mission-scripts.yaml");
export const GENERATED = join("data", "generated", "mission-scripts.json");

const isObject = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Rejects keys outside `allowed`. */
function onlyKeys(value, allowed, where, errors) {
	for (const key of Object.keys(value))
		if (!allowed.includes(key)) errors.push(`${where}: unknown key "${key}"`);
}

const number = (value, min = 0) => Number.isFinite(value) && value >= min;
const SIDES = ["own", "enemy"];

/** Validates one condition against the spec 62 §3 list. */
function checkCondition(c, where, ctx, errors) {
	if (!isObject(c) || Object.keys(c).length !== 1) {
		errors.push(`${where}: a condition has exactly one key`);
		return;
	}
	const [key] = Object.keys(c);
	const value = c[key];
	if (key === "after") {
		if (!number(value)) errors.push(`${where}: after is seconds >= 0`);
	} else if (key === "goal") {
		if (!Number.isInteger(value) || value < 1)
			errors.push(`${where}: goal is a step number from 1`);
	} else if (key === "destroyed") {
		if (!ctx.labels.has(value))
			errors.push(`${where}: destroyed names unknown label "${value}"`);
	} else if (key === "enters") {
		if (!isObject(value) || !SIDES.includes(value.side))
			errors.push(`${where}: enters needs side own|enemy`);
		else {
			onlyKeys(value, ["side", "area"], where, errors);
			const a = value.area;
			if (
				!Array.isArray(a) ||
				a.length !== 4 ||
				!a.every((n) => Number.isInteger(n)) ||
				a[0] > a[2] ||
				a[1] > a[3]
			)
				errors.push(`${where}: area is [x0, y0, x1, y1] cells, x0<=x1, y0<=y1`);
		}
	} else errors.push(`${where}: unknown condition "${key}"`);
}

/** Validates one action against the spec 62 §3 list. */
function checkAction(a, where, ctx, errors) {
	if (!isObject(a) || Object.keys(a).length !== 1) {
		errors.push(`${where}: an action has exactly one key`);
		return;
	}
	const [key] = Object.keys(a);
	const value = a[key];
	if (key === "message" || key === "dialogue") {
		if (typeof value !== "string" || value === "")
			errors.push(`${where}: ${key} is a text key suffix`);
	} else if (key === "reinforce") {
		if (!isObject(value)) return errors.push(`${where}: reinforce is a map`);
		onlyKeys(value, ["side", "type", "count", "at"], where, errors);
		if (!SIDES.includes(value.side))
			errors.push(`${where}: side is own|enemy`);
		if (!ctx.types.has(value.type))
			errors.push(`${where}: unknown type "${value.type}"`);
		if (!Number.isInteger(value.count) || value.count < 1 || value.count > 12)
			errors.push(`${where}: count is 1..12`);
		if (
			!Array.isArray(value.at) ||
			value.at.length !== 2 ||
			!value.at.every(Number.isInteger)
		)
			errors.push(`${where}: at is [x, y] cells`);
	} else if (key === "objective") {
		if (!isObject(value) || typeof value.text !== "string")
			return errors.push(`${where}: objective needs text`);
		onlyKeys(value, ["text", "destroy"], where, errors);
		for (const label of value.destroy ?? [])
			if (!ctx.labels.has(label))
				errors.push(`${where}: objective names unknown label "${label}"`);
	} else if (key === "victory" || key === "defeat") {
		if (value !== true) errors.push(`${where}: ${key} is true`);
	} else errors.push(`${where}: unknown action "${key}"`);
}

/**
 * Validates the scripts in `text`.
 * @param {string} text YAML source
 * @param {{ types: Set<string>, saveLabels: Map<string, Set<string>> }} ctx
 * @returns {{ scripts: object, errors: string[] }}
 */
export function buildMissionScripts(text, ctx) {
	const errors = [];
	const doc = parse(text) ?? {};
	if (!isObject(doc)) return { scripts: {}, errors: ["root must be a map"] };
	const scripts = {};
	for (const [mission, list] of Object.entries(doc)) {
		const labels = ctx.saveLabels.get(mission);
		if (labels === undefined) {
			errors.push(`${mission}: no such mission save`);
			continue;
		}
		if (!Array.isArray(list)) {
			errors.push(`${mission}: scripts must be a list`);
			continue;
		}
		const seen = new Set();
		const local = { types: ctx.types, labels };
		list.forEach((script, i) => {
			const where = `${mission} script ${script?.id ?? i}`;
			if (!isObject(script)) return errors.push(`${where}: must be a map`);
			onlyKeys(script, ["id", "when", "do", "repeat", "every"], where, errors);
			if (typeof script.id !== "string" || seen.has(script.id))
				errors.push(`${where}: id is required and unique`);
			seen.add(script.id);
			if (!Array.isArray(script.when) || script.when.length === 0)
				errors.push(`${where}: when needs at least one condition`);
			if (!Array.isArray(script.do) || script.do.length === 0)
				errors.push(`${where}: do needs at least one action`);
			if (script.repeat !== undefined && typeof script.repeat !== "boolean")
				errors.push(`${where}: repeat is a boolean`);
			if (script.every !== undefined && !number(script.every, 1))
				errors.push(`${where}: every is seconds >= 1`);
			for (const c of script.when ?? [])
				checkCondition(c, where, local, errors);
			for (const a of script.do ?? []) checkAction(a, where, local, errors);
		});
		scripts[mission] = list;
	}
	return { scripts, errors };
}

/** Reads the source and the generated saves/ruleset under `root`. */
export function readMissionScripts(root, ruleset) {
	const file = join(root, SOURCE);
	if (!existsSync(file)) return { scripts: {}, errors: [] };
	const saveLabels = new Map();
	const dir = join(root, "data", "generated", "saves");
	const ids = parse(readFileSync(file, "utf8")) ?? {};
	for (const id of Object.keys(ids)) {
		const path = join(dir, `${id}.json`);
		if (!existsSync(path)) continue;
		const save = JSON.parse(readFileSync(path, "utf8"));
		saveLabels.set(
			id,
			new Set(save.setup.entities.map((e) => e.label).filter(Boolean)),
		);
	}
	const types = new Set(ruleset.types.map((t) => t.id));
	return buildMissionScripts(readFileSync(file, "utf8"), { types, saveLabels });
}

export const serialize = (scripts) => `${JSON.stringify(scripts, null, 2)}\n`;

export function writeMissionScripts(root, scripts) {
	mkdirSync(dirname(join(root, GENERATED)), { recursive: true });
	writeFileSync(join(root, GENERATED), serialize(scripts));
}

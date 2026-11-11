// Markdown tables from the files scripts/balance-tournament.sh wrote.
// Usage: node scripts/balance-summary.mjs <dir>
import { readdirSync, readFileSync } from "node:fs";
const dir = process.argv[2];
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : "-");
const load = (f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const out = [];
const totals = {};
for (const f of files.filter((f) => f.startsWith("personalities-"))) {
  const map = f.slice(14, -5);
  const rep = load(f);
  out.push(`#### ${map}\n`, "| ai0 (Ukraine) | ai1 (Russia) | W0 | W1 | Draws | Win0 % of decided | Avg ticks | Lost0 | Lost1 |", "|---|---|---|---|---|---|---|---|---|");
  let w0 = 0, w1 = 0, dr = 0;
  for (const s of rep.summary) {
    w0 += s.wins0; w1 += s.wins1; dr += s.draws;
    out.push(`| ${s.ai0} | ${s.ai1} | ${s.wins0} | ${s.wins1} | ${s.draws} | ${pct(s.wins0, s.wins0 + s.wins1)} | ${s.avgTicks} | ${s.lost0} | ${s.lost1} |`);
  }
  out.push(`| **all four** | | **${w0}** | **${w1}** | **${dr}** | **${pct(w0, w0 + w1)}** | | | |`, "");
  totals[map] = [w0, w1, dr];
}
out.push("#### Per-map totals (personalities, Medium)\n", "| Map | Ukraine wins | Russia wins | Draws | Ukraine % of decided |", "|---|---|---|---|---|");
for (const [m, [a, b, c]] of Object.entries(totals)) out.push(`| ${m} | ${a} | ${b} | ${c} | ${pct(a, a + b)} |`);
out.push("");
// difficulties
out.push("#### Difficulty matrix (balanced vs balanced), all maps pooled\n", "| Ukraine \\ Russia | easy | medium | hard | brutal |", "|---|---|---|---|---|");
const lv = ["easy", "medium", "hard", "brutal"];
const cell = {};
for (const f of files.filter((f) => f.startsWith("difficulties-"))) {
  for (const s of load(f).summary) {
    const k = `${s.difficulty0}/${s.difficulty1}`;
    cell[k] ??= [0, 0, 0];
    cell[k][0] += s.wins0; cell[k][1] += s.wins1; cell[k][2] += s.draws;
  }
}
for (const a of lv) out.push(`| **${a}** | ${lv.map((b) => { const c = cell[`${a}/${b}`] ?? [0, 0, 0]; return `${c[0]}-${c[1]}-${c[2]}`; }).join(" | ")} |`);
out.push("", "Cells are Ukraine wins - Russia wins - draws.", "");
// units
const units = {};
for (const f of files) for (const s of load(f).summary) for (const [k, v] of Object.entries(s.units)) {
  units[k] ??= [0, 0, 0, 0]; v.forEach((x, i) => (units[k][i] += x));
}
const rows = JSON.parse(readFileSync("data/generated/ruleset.json", "utf8")).types ?? [];
const info = Object.fromEntries(rows.map((t) => [t.id, t]));
out.push("#### Units built and lost (all runs)\n", "| Type | Cost | Built | Lost | Lost % |", "|---|---|---|---|---|");
for (const [k, v] of Object.entries(units).sort()) {
  const b = v[0] + v[1], l = v[2] + v[3];
  out.push(`| ${k} | ${info[k]?.cost ?? "?"} | ${b} | ${l} | ${pct(l, b)} |`);
}
console.log(out.join("\n"));

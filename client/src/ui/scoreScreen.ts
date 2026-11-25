import { type MessageKey, t } from "../i18n";
import type { MatchSnapshot, PlayerStats } from "../sim/matchSnapshot";
import { TICK_RATE_HZ } from "../sim/protocol";
import { outcomeText } from "./outcome";

/** A next action offered under the score table (spec 57 §4). */
export interface EndButton {
  label: MessageKey;
  go(): void;
}

/** One table row: a player and what they did (spec 57 §3). */
export interface ScoreRow {
  name: string;
  stats: PlayerStats;
  /** The player the screen is shown to. */
  you: boolean;
  /** The match winner, if the sim named one. */
  winner: boolean;
}

/** Zero Hour's score, used only to order the rows: units and buildings built
 *  and every kill count 100 each, money earned counts 1 per credit. */
export function scoreOf(stats: PlayerStats): number {
  return (
    (stats.unitsBuilt +
      stats.buildingsBuilt +
      stats.unitsDestroyed +
      stats.buildingsDestroyed) *
      100 +
    stats.moneyEarned
  );
}

/** Rows ordered by score, best first; equal scores keep player order. */
export function scoreRows(
  snapshot: MatchSnapshot,
  controlled: number,
  nameOf: (player: number) => string,
): ScoreRow[] {
  return [...(snapshot.stats ?? [])]
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.player - b.player)
    .map((stats) => ({
      name: nameOf(stats.player),
      stats,
      you: stats.player === controlled,
      winner: snapshot.outcome === "winner" && snapshot.winner === stats.player,
    }));
}

/** `ticks` as m:ss, or h:mm:ss from an hour on. */
export function matchTime(ticks: number): string {
  const total = Math.floor(ticks / TICK_RATE_HZ);
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

const COLUMNS: readonly [MessageKey, (stats: PlayerStats) => number][] = [
  ["score.unitsBuilt", (s) => s.unitsBuilt],
  ["score.unitsLost", (s) => s.unitsLost],
  ["score.unitsDestroyed", (s) => s.unitsDestroyed],
  ["score.buildingsBuilt", (s) => s.buildingsBuilt],
  ["score.buildingsLost", (s) => s.buildingsLost],
  ["score.buildingsDestroyed", (s) => s.buildingsDestroyed],
  ["score.moneyEarned", (s) => s.moneyEarned],
  ["score.moneySpent", (s) => s.moneySpent],
];

export interface ScoreScreenInput {
  snapshot: MatchSnapshot;
  controlled: number;
  /** Heading override, e.g. "Mission failed."; the outcome text by default. */
  heading?: string;
  nameOf(player: number): string;
  buttons: readonly EndButton[];
}

/** `<div id="score-screen">`: the end-of-match table and the next actions
 *  (spec 57). Hidden until `show`. */
export function createScoreScreen(root: HTMLElement): {
  show(input: ScoreScreenInput): void;
  hide(): void;
  /** Shown once already, or closed by the player: do not show it again. */
  readonly settled: boolean;
} {
  const element = document.createElement("div");
  element.id = "score-screen";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-labelledby", "score-heading");
  element.hidden = true;
  root.appendChild(element);
  let settled = false;

  function hide(): void {
    element.hidden = true;
    element.replaceChildren();
  }

  return {
    get settled() {
      return settled;
    },
    hide,
    show(input) {
      const { snapshot } = input;
      const panel = document.createElement("div");
      panel.id = "score-panel";
      const heading = document.createElement("h2");
      heading.id = "score-heading";
      heading.textContent =
        input.heading ??
        outcomeText(snapshot, input.controlled) ??
        t("score.title");
      const time = document.createElement("p");
      time.id = "score-time";
      time.textContent = t("score.time", { time: matchTime(snapshot.tick) });

      const table = document.createElement("table");
      table.id = "score-table";
      const head = table.createTHead().insertRow();
      for (const label of ["score.player", ...COLUMNS.map(([key]) => key)]) {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = t(label as MessageKey);
        head.appendChild(cell);
      }
      const body = table.createTBody();
      for (const row of scoreRows(snapshot, input.controlled, input.nameOf)) {
        const tr = body.insertRow();
        if (row.you) tr.className = "you";
        const name = tr.insertCell();
        name.textContent = row.winner ? `${row.name} ★` : row.name;
        for (const [, value] of COLUMNS) {
          const cell = tr.insertCell();
          cell.textContent = value(row.stats).toLocaleString("en-US");
        }
      }

      const actions = document.createElement("div");
      actions.id = "score-actions";
      for (const { label, go } of input.buttons) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = t(label);
        button.addEventListener("click", go);
        actions.appendChild(button);
      }
      const view = document.createElement("button");
      view.type = "button";
      view.id = "score-view";
      view.textContent = t("score.view");
      view.addEventListener("click", hide);
      actions.appendChild(view);

      panel.append(heading, time, table, actions);
      element.replaceChildren(panel);
      element.hidden = false;
      settled = true;
    },
  };
}

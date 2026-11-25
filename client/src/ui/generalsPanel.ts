// Spec 63: the player's rank badge and the General's powers panel. The sim owns
// the rules; this module only derives what to show from a match snapshot and
// turns a press into a buy or cast request.
import { type MessageKey, t } from "../i18n";
import { RULES } from "../rules";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";

/** A classed `<div>` under `parent` (rows repeat, so no ids). */
function child(parent: HTMLElement, className: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  parent.appendChild(element);
  return element;
}

/** Ticks per second of the sim (spec 01), to show recharge in seconds. */
const TICKS_PER_SECOND = 15;

export type PowerState =
  | "locked"
  | "unaffordable"
  | "affordable"
  | "recharging"
  | "ready";

export interface PowerView {
  /** Index into `RULES.general.powers`, what the sim commands carry. */
  index: number;
  id: string;
  cost: number;
  rank: number;
  state: PowerState;
  /** Seconds until a bought power can be cast again; 0 when ready. */
  secondsLeft: number;
}

export interface GeneralView {
  rank: number;
  xp: number;
  /** Skill points of the next rank, null at the top rank. */
  nextXp: number | null;
  /** General's points still to spend. */
  points: number;
  powers: PowerView[];
}

/** What the panel shows for `player` (of faction index `faction`). */
export function generalView(
  snapshot: MatchSnapshot,
  player: number,
  faction: number,
): GeneralView {
  const { ranks, powers } = RULES.general;
  const state = snapshot.generals?.find((g) => g.player === player);
  const xp = state?.xp ?? 0;
  const bought = new Map(
    (state?.powers ?? []).map((p) => [p.power, p.readyTick]),
  );
  const rank = Math.max(1, ranks.filter((r) => xp >= r.xp).length);
  const granted = ranks.slice(0, rank).reduce((sum, r) => sum + r.points, 0);
  const spent = [...bought.keys()].reduce(
    (sum, index) => sum + (powers[index]?.cost ?? 0),
    0,
  );
  const points = Math.max(0, granted - spent);
  const views: PowerView[] = [];
  powers.forEach((def, index) => {
    if (def.factions.length > 0 && !def.factions.includes(faction)) return;
    const readyTick = bought.get(index);
    let powerState: PowerState;
    let secondsLeft = 0;
    if (readyTick !== undefined) {
      const left = Math.max(0, readyTick - snapshot.tick);
      secondsLeft = Math.ceil(left / TICKS_PER_SECOND);
      powerState = left > 0 ? "recharging" : "ready";
    } else if (rank < def.rank) {
      powerState = "locked";
    } else {
      powerState = points >= def.cost ? "affordable" : "unaffordable";
    }
    views.push({
      index,
      id: def.id,
      cost: def.cost,
      rank: def.rank,
      state: powerState,
      secondsLeft,
    });
  });
  return {
    rank,
    xp,
    nextXp: ranks[rank]?.xp ?? null,
    points,
    powers: views,
  };
}

export interface GeneralsPanelCallbacks {
  /** Spend points on power `index`. */
  onBuy(index: number): void;
  /** The player wants to cast power `index`: the caller asks for a target. */
  onCast(index: number): void;
}

export interface GeneralsPanel {
  readonly root: HTMLElement;
  update(view: GeneralView): void;
  /** Marks the power waiting for its target (null: none). */
  setArmed(index: number | null): void;
}

function text(key: string, params?: Record<string, string | number>): string {
  return t(key as MessageKey, params);
}

/** Builds `#generals`: a badge button that opens the list of powers. */
export function createGeneralsPanel(
  parent: HTMLElement,
  callbacks: GeneralsPanelCallbacks,
): GeneralsPanel {
  const root = appendDiv(parent, "generals");
  for (const type of ["pointerdown", "pointerup", "click", "wheel"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  const badge = document.createElement("button");
  badge.type = "button";
  badge.id = "generals-badge";
  badge.setAttribute("aria-expanded", "false");
  root.appendChild(badge);
  const list = appendDiv(root, "generals-list");
  list.hidden = true;
  badge.addEventListener("click", () => {
    list.hidden = !list.hidden;
    badge.setAttribute("aria-expanded", String(!list.hidden));
  });

  let armed: number | null = null;
  let last: GeneralView | null = null;
  let shown = "";

  function render(): void {
    if (last === null) return;
    const view = last;
    // Rebuilding mid-press would swallow the click: only on a change.
    const key = JSON.stringify([view, armed]);
    if (key === shown) return;
    shown = key;
    badge.textContent = text("generals.badge", {
      rank: view.rank,
      points: view.points,
    });
    badge.classList.toggle("pending", view.points > 0);
    list.replaceChildren();
    const head = child(list, "generals-head");
    head.textContent =
      view.nextXp === null
        ? text("generals.top", { xp: view.xp })
        : text("generals.progress", {
            xp: view.xp,
            next: view.nextXp,
            rank: view.rank + 1,
          });
    for (const power of view.powers) {
      const row = child(list, "generals-power");
      row.dataset.power = power.id;
      row.dataset.state = power.state;
      child(row, "generals-name").textContent = text(
        `generals.power.${power.id}.name`,
      );
      child(row, "generals-desc").textContent = text(
        `generals.power.${power.id}.description`,
      );
      child(row, "generals-cost").textContent = text("generals.cost", {
        cost: power.cost,
        rank: power.rank,
      });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "generals-action";
      row.appendChild(button);
      if (power.state === "ready") {
        const waiting = armed === power.index;
        button.textContent = text(
          waiting ? "generals.target" : "generals.cast",
        );
        button.addEventListener("click", () => callbacks.onCast(power.index));
      } else if (power.state === "recharging") {
        button.disabled = true;
        button.textContent = text("generals.recharging", {
          seconds: power.secondsLeft,
        });
      } else {
        button.textContent = text("generals.buy");
        button.disabled = power.state !== "affordable";
        button.addEventListener("click", () => callbacks.onBuy(power.index));
      }
    }
  }

  return {
    root,
    update(view) {
      last = view;
      render();
    },
    setArmed(index) {
      armed = index;
      render();
    },
  };
}

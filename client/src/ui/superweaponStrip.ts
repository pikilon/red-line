// Spec 64: the superweapon countdowns every player sees, and the Fire button of
// the player's own. The sim owns the rules (timer, power, damage); this module
// derives what to show from a match snapshot.
import { type MessageKey, t } from "../i18n";
import { RULES } from "../rules";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";

/** Ticks per second of the sim (spec 01). */
const TICKS_PER_SECOND = 15;

export interface SuperweaponTimer {
  player: number;
  /** Index into `RULES.general.powers`. */
  power: number;
  id: string;
  readyTick: number;
  secondsLeft: number;
  ready: boolean;
}

/** Every superweapon countdown of every player, by player then power. */
export function superweaponTimers(snapshot: MatchSnapshot): SuperweaponTimer[] {
  const timers: SuperweaponTimer[] = [];
  for (const state of snapshot.generals ?? []) {
    for (const owned of state.powers) {
      const def = RULES.general.powers[owned.power];
      if (def === undefined || def.building === undefined) continue;
      const left = Math.max(0, owned.readyTick - snapshot.tick);
      timers.push({
        player: state.player,
        power: owned.power,
        id: def.id,
        readyTick: owned.readyTick,
        secondsLeft: Math.ceil(left / TICKS_PER_SECOND),
        ready: left === 0,
      });
    }
  }
  return timers;
}

export interface SuperweaponEvent {
  kind: "building" | "launch";
  player: number;
  id: string;
}

/** What changed between two snapshots: a countdown that appeared (a
 *  superweapon was finished) or one that jumped by a full recharge (fired). */
export function superweaponEvents(
  before: MatchSnapshot | null,
  after: MatchSnapshot,
): SuperweaponEvent[] {
  if (before === null) return [];
  const old = new Map(
    superweaponTimers(before).map((x) => [`${x.player}:${x.power}`, x]),
  );
  const events: SuperweaponEvent[] = [];
  for (const timer of superweaponTimers(after)) {
    const previous = old.get(`${timer.player}:${timer.power}`);
    const recharge = RULES.general.powers[timer.power]?.rechargeTicks ?? 0;
    if (previous === undefined) {
      events.push({ kind: "building", player: timer.player, id: timer.id });
    } else if (timer.readyTick - previous.readyTick > recharge / 2) {
      events.push({ kind: "launch", player: timer.player, id: timer.id });
    }
  }
  return events;
}

function text(key: string, params?: Record<string, string | number>): string {
  return t(key as MessageKey, params);
}

/** `2:05` for a number of seconds. */
export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Who a timer belongs to, in words. */
export function playerLabel(player: number, viewer: number): string {
  return player === viewer
    ? text("superweapon.you")
    : text("superweapon.player", { player: player + 1 });
}

export interface SuperweaponStrip {
  readonly root: HTMLElement;
  update(snapshot: MatchSnapshot, viewer: number): void;
  /** Marks the power waiting for its target (null: none). */
  setArmed(power: number | null): void;
}

/** Builds `#superweapons`: one row per countdown, all players'. */
export function createSuperweaponStrip(
  parent: HTMLElement,
  onFire: (power: number) => void,
): SuperweaponStrip {
  const root = appendDiv(parent, "superweapons");
  root.hidden = true;
  for (const type of ["pointerdown", "pointerup", "click", "wheel"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  root.addEventListener("contextmenu", (event) => event.preventDefault());
  let armed: number | null = null;
  let last: { snapshot: MatchSnapshot; viewer: number } | null = null;
  let shown = "";

  function render(): void {
    if (last === null) return;
    const { snapshot, viewer } = last;
    const timers = superweaponTimers(snapshot);
    const key = JSON.stringify([
      timers.map((x) => [x.player, x.power, x.secondsLeft]),
      viewer,
      armed,
    ]);
    if (key === shown) return;
    shown = key;
    root.hidden = timers.length === 0;
    root.replaceChildren();
    for (const timer of timers) {
      const row = document.createElement("div");
      row.className = "superweapon-row";
      row.dataset.player = String(timer.player);
      row.dataset.state = timer.ready ? "ready" : "charging";
      const label = document.createElement("span");
      label.textContent = text(
        timer.ready ? "superweapon.ready" : "superweapon.charging",
        {
          who: playerLabel(timer.player, viewer),
          name: text(`superweapon.${timer.id}.name`),
          time: clock(timer.secondsLeft),
        },
      );
      row.appendChild(label);
      if (timer.ready && timer.player === viewer) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text(
          armed === timer.power ? "superweapon.target" : "superweapon.fire",
        );
        button.addEventListener("click", () => onFire(timer.power));
        row.appendChild(button);
      }
      root.appendChild(row);
    }
  }

  return {
    root,
    update(snapshot, viewer) {
      last = { snapshot, viewer };
      render();
    },
    setArmed(power) {
      armed = power;
      render();
    },
  };
}

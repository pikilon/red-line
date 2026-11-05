// Resource bar + credit-change hook. The hook is how the client turns a credit
// delta into Zero Hour's `ui.cashUp` / `ui.cashDown` without the sim knowing
// anything about audio.
import { t } from "../i18n";
import { FLAGS } from "../render/flags";
import { factionName, RULES } from "../rules";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { appendDiv, setText } from "./dom";

/** The formatted resource bar text and the low-power flag (spec §6.6). */
export interface ResourceText {
  /** "Credits {credits}". */
  credits: string;
  /** "Power {produced}/{consumed}". */
  power: string;
  /** True when produced power is below consumed power. */
  low: boolean;
}

/** The colour band of the power bar (spec §6.6). */
export type PowerLevel = "ok" | "warn" | "low";

/** Consumption as a fraction of production, clamped to the bar (spec §6.6). */
export function powerFill(produced: number, consumed: number): number {
  if (produced <= 0) return consumed > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, consumed / produced));
}

/** Green up to 80%, yellow up to 100%, red in deficit (spec §6.6). */
export function powerLevel(produced: number, consumed: number): PowerLevel {
  if (consumed > produced) return "low";
  if (produced <= 0) return "ok";
  return consumed > produced * 0.8 ? "warn" : "ok";
}

/** Formats the resource bar for a match snapshot (spec §6.6). */
export function resourceText(snapshot: MatchSnapshot): ResourceText {
  return {
    credits: t("ui.credits", { credits: snapshot.credits }),
    power: t("ui.power", {
      produced: snapshot.powerProduced,
      consumed: snapshot.powerConsumed,
    }),
    low: snapshot.powerProduced < snapshot.powerConsumed,
  };
}

/** A hard-edged top-to-bottom gradient of a faction's flag, with its accent:
 *  the last stripe, which reads on the dark plate (spec 42 §3.1). */
export function teamColors(
  factionId: string,
): { flag: string; accent: string } | null {
  const stripes: readonly number[] | undefined =
    FLAGS[factionId as keyof typeof FLAGS];
  if (stripes === undefined) return null;
  const css = stripes.map(
    (stripe) => `#${stripe.toString(16).padStart(6, "0")}`,
  );
  const stops = css.map((color, i) => {
    const from = (i * 100) / css.length;
    const to = ((i + 1) * 100) / css.length;
    return `${color} ${from}% ${to}%`;
  });
  return {
    flag: `linear-gradient(180deg, ${stops.join(", ")})`,
    accent: css[css.length - 1] ?? "",
  };
}

/**
 * `<div id="resource-bar">`: the player's own panel, with
 * `#res-player` (who you are), `#res-credits` and the `#res-power` bar
 * (spec §6.6, spec 03 §6.7).
 */
export function createResourceBar(
  root: HTMLElement,
  options: {
    /** Called with the credit delta when it changes; used for `ui.cashUp/Down`. */
    onCreditsChange?(delta: number): void;
  } = {},
): {
  render(snapshot: MatchSnapshot | null): void;
  /** `#res-player`: 1-based player number and its faction (spec 08 §3.5). */
  setPlayer(player: number, faction: number): void;
} {
  const bar = appendDiv(root, "resource-bar");
  const playerRow = appendDiv(bar, "res-player-row");
  appendDiv(playerRow, "res-flag").setAttribute("aria-hidden", "true");
  const player = appendDiv(playerRow, "res-player");
  const row = appendDiv(bar, "res-row");
  const credits = appendDiv(row, "res-credits");
  const power = appendDiv(row, "res-power");
  const icon = document.createElement("span");
  icon.className = "res-power-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="14" aria-hidden="true" focusable="false"><path d="M13 2 4.5 13.5H11l-1 8.5 9.5-12H13V2Z"/></svg>';
  power.appendChild(icon);
  const track = appendDiv(power, "res-power-bar");
  track.className = "res-power-bar";
  const fill = appendDiv(track, "res-power-fill");
  fill.className = "res-power-fill";
  let lastCredits: number | null = null;
  return {
    render(snapshot) {
      if (snapshot === null) {
        lastCredits = null;
      } else if (lastCredits !== null && snapshot.credits !== lastCredits) {
        options.onCreditsChange?.(snapshot.credits - lastCredits);
      }
      if (snapshot !== null) lastCredits = snapshot.credits;
      const text =
        snapshot === null
          ? { credits: "", power: "", low: false }
          : resourceText(snapshot);
      setText(credits, text.credits);
      if (snapshot === null) {
        power.removeAttribute("title");
        power.removeAttribute("data-level");
        power.classList.remove("power-ok", "power-warn", "power-low");
        fill.style.width = "0%";
        return;
      }
      const level = powerLevel(snapshot.powerProduced, snapshot.powerConsumed);
      power.title = text.power;
      power.dataset.level = level;
      power.classList.toggle("power-ok", level === "ok");
      power.classList.toggle("power-warn", level === "warn");
      power.classList.toggle("power-low", level === "low");
      fill.style.width = `${Math.round(
        powerFill(snapshot.powerProduced, snapshot.powerConsumed) * 100,
      )}%`;
    },
    setPlayer(n, faction) {
      setText(
        player,
        t("hud.player", { player: n, faction: factionName(faction) }),
      );
      const team = teamColors(RULES.factions[faction]?.id ?? "");
      const style = document.documentElement.style;
      style.setProperty("--team-flag", team?.flag ?? "none");
      style.setProperty("--team-accent", team?.accent ?? "#c62828");
    },
  };
}

import { t } from "../i18n";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { appendDiv } from "./dom";

/** The formatted resource bar text and the low-power flag (spec §6.6). */
export interface ResourceText {
  /** "Credits {credits}". */
  credits: string;
  /** "Power {produced}/{consumed}". */
  power: string;
  /** True when produced power is below consumed power. */
  low: boolean;
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

/** `<div id="resource-bar">` with `#res-credits` and `#res-power` (spec §6.6). */
export function createResourceBar(root: HTMLElement): {
  render(snapshot: MatchSnapshot | null): void;
} {
  const bar = appendDiv(root, "resource-bar");
  const credits = appendDiv(bar, "res-credits");
  const power = appendDiv(bar, "res-power");
  return {
    render(snapshot) {
      if (snapshot === null) {
        credits.textContent = "";
        power.textContent = "";
        power.classList.remove("power-low");
        return;
      }
      const text = resourceText(snapshot);
      credits.textContent = text.credits;
      power.textContent = text.power;
      power.classList.toggle("power-low", text.low);
    },
  };
}

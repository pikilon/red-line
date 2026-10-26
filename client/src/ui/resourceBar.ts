// Resource bar + credit-change hook. The hook is how the client turns a credit
// delta into Zero Hour's `ui.cashUp` / `ui.cashDown` without the sim knowing
// anything about audio.
import { t } from "../i18n";
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
export function createResourceBar(
  root: HTMLElement,
  options: {
    /** Called with the credit delta when it changes; used for `ui.cashUp/Down`. */
    onCreditsChange?(delta: number): void;
  } = {},
): {
  render(snapshot: MatchSnapshot | null): void;
} {
  const bar = appendDiv(root, "resource-bar");
  const credits = appendDiv(bar, "res-credits");
  const power = appendDiv(bar, "res-power");
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
      setText(power, text.power);
      if (power.classList.contains("power-low") !== text.low)
        power.classList.toggle("power-low", text.low);
    },
  };
}

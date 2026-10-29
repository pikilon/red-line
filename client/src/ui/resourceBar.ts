// Resource bar + credit-change hook. The hook is how the client turns a credit
// delta into Zero Hour's `ui.cashUp` / `ui.cashDown` without the sim knowing
// anything about audio.
import { t } from "../i18n";
import { factionName } from "../rules";
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

/**
 * `<div id="resource-bar" class="bar-panel">`: the player's own panel, with
 * `#res-player` (who you are), `#res-credits` and `#res-power` (spec §6.6,
 * spec 03 §6.7).
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
  bar.className = "bar-panel";
  const player = appendDiv(bar, "res-player");
  const row = appendDiv(bar, "res-row");
  const credits = appendDiv(row, "res-credits");
  const power = appendDiv(row, "res-power");
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
    setPlayer(n, faction) {
      setText(
        player,
        t("hud.player", { player: n, faction: factionName(faction) }),
      );
    },
  };
}

import { t } from "../i18n";
import type { MatchSnapshot } from "../sim/matchSnapshot";
import { appendDiv, setText } from "./dom";

/** Returns the outcome text for `player`, or null while the match is ongoing (spec §6.6). */
export function outcomeText(
  snapshot: MatchSnapshot,
  player: number,
): string | null {
  if (snapshot.outcome === "ongoing") return null;
  if (snapshot.outcome === "draw") return t("ui.draw");
  // outcome === "winner": the winner is a player id.
  return snapshot.winner === player ? t("ui.victory") : t("ui.defeat");
}

/** `<div id="outcome" role="status">`, hidden while null (spec §6.6). */
export function createOutcomeOverlay(root: HTMLElement): {
  render(text: string | null): void;
} {
  const element = appendDiv(root, "outcome");
  element.setAttribute("role", "status");
  element.hidden = true;
  return {
    render(text) {
      setText(element, text ?? "");
      if (element.hidden !== (text === null)) element.hidden = text === null;
    },
  };
}

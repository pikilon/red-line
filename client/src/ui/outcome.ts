import { t } from "../i18n";
import type { MatchSnapshot } from "../sim/matchSnapshot";

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

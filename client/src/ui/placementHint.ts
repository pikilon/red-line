import { t } from "../i18n";
import { appendDiv } from "./dom";

/** What the placement hint shows (spec §6.6). */
export type PlacementHintState = "hidden" | "legal" | "illegal";

const HINT_KEYS = {
  legal: "ui.placementHint",
  illegal: "ui.placementIllegal",
} as const;

/** `<div id="placement-hint" role="status">`, hidden outside placement mode (spec §6.6). */
export function createPlacementHint(root: HTMLElement): {
  render(state: PlacementHintState): void;
} {
  const element = appendDiv(root, "placement-hint");
  element.setAttribute("role", "status");
  element.hidden = true;
  let shown: PlacementHintState = "hidden";
  return {
    render(state) {
      if (state === shown) return;
      shown = state;
      element.hidden = state === "hidden";
      element.textContent = state === "hidden" ? "" : t(HINT_KEYS[state]);
    },
  };
}

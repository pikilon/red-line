import type { ScreenRect } from "../input/selection";
import { appendDiv } from "./dom";

/** `<div id="selection-box">`: drag feedback in screen space, no effect on the sim (spec §6.6). */
export function createSelectionBox(root: HTMLElement): {
  show(rect: ScreenRect | null): void;
} {
  const element = appendDiv(root, "selection-box");
  const { style } = element;
  style.position = "fixed";
  style.pointerEvents = "none";
  style.boxSizing = "border-box";
  style.border = "2px solid rgba(51, 255, 51, 0.6)";
  element.hidden = true;
  let shown: ScreenRect | null = null;
  return {
    show(rect) {
      if (rect === shown) return;
      if (
        rect !== null &&
        shown !== null &&
        rect.minX === shown.minX &&
        rect.minY === shown.minY &&
        rect.maxX === shown.maxX &&
        rect.maxY === shown.maxY
      ) {
        return;
      }
      shown = rect;
      element.hidden = rect === null;
      if (rect === null) return;
      style.left = `${rect.minX}px`;
      style.top = `${rect.minY}px`;
      style.width = `${rect.maxX - rect.minX}px`;
      style.height = `${rect.maxY - rect.minY}px`;
    },
  };
}

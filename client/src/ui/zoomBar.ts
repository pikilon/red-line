import {
  clampZoom,
  WHEEL_NOTCH,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAfterWheel,
} from "../camera";
import { t } from "../i18n";
import { isolate } from "./quickBar";

/** One `+` press: a wheel-up notch (spec 41 §3.3). */
export function zoomStepIn(zoom: number): number {
  return zoomAfterWheel(zoom, -WHEEL_NOTCH, 0);
}

/** One `-` press: a wheel-down notch. */
export function zoomStepOut(zoom: number): number {
  return zoomAfterWheel(zoom, WHEEL_NOTCH, 0);
}

export const SLIDER_MAX = 1000;

/** Slider position 0..SLIDER_MAX for a zoom; logarithmic so each notch of
 *  travel scales the view equally. */
export function zoomToSlider(zoom: number): number {
  const span = Math.log(ZOOM_MAX / ZOOM_MIN);
  return Math.round((Math.log(clampZoom(zoom) / ZOOM_MIN) / span) * SLIDER_MAX);
}

/** Inverse of zoomToSlider, clamped to the wheel limits. */
export function sliderToZoom(value: number): number {
  const fraction = Math.min(1, Math.max(0, value / SLIDER_MAX));
  return clampZoom(ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** fraction);
}

export interface ZoomBarDeps {
  zoom(): number;
  setZoom(zoom: number): void;
  folded: boolean;
  onFold(folded: boolean): void;
}

export interface ZoomBar {
  /** Follows the camera zoom (wheel, pinch); writes nothing when unchanged. */
  sync(zoom: number): void;
}

const SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true">${body}</svg>`;
const ICON_PLUS = SVG('<path d="M12 5v14M5 12h14"/>');
const ICON_MINUS = SVG('<path d="M5 12h14"/>');
const ICON_RESET = SVG(
  '<circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
);
const ICON_CHEVRON = SVG('<path d="M6 9l6 6 6-6"/>');

/** The `#zoom-bar` panel: zoom in, slider, zoom out, reset (spec 41 §3.3). */
export function createZoomBar(parent: HTMLElement, deps: ZoomBarDeps): ZoomBar {
  const root = document.createElement("div");
  root.id = "zoom-bar";
  root.className = "bar-panel";
  isolate(root);

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "bar-tab";
  tab.id = "zoom-bar-tab";
  tab.innerHTML = `${ICON_CHEVRON}<span>${t("bar.zoom")}</span>`;
  const body = document.createElement("div");
  body.className = "bar-body";
  body.id = "zoom-bar-body";

  function button(id: string, icon: string, label: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.id = id;
    el.className = "bar-btn";
    el.innerHTML = icon;
    el.setAttribute("aria-label", label);
    el.title = label;
    return el;
  }
  const minus = button("zoom-out", ICON_MINUS, t("zoom.out"));
  const plus = button("zoom-in", ICON_PLUS, t("zoom.in"));
  const reset = button("zoom-reset", ICON_RESET, t("zoom.reset"));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "zoom-slider";
  slider.min = "0";
  slider.max = String(SLIDER_MAX);
  slider.step = "1";
  slider.setAttribute("aria-label", t("zoom.slider"));
  body.append(minus, slider, plus, reset);
  root.append(tab, body);
  parent.appendChild(root);

  function applyFold(folded: boolean): void {
    root.classList.toggle("folded", folded);
    tab.setAttribute("aria-expanded", String(!folded));
    body.hidden = folded;
  }
  applyFold(deps.folded);
  tab.addEventListener("click", () => {
    const folded = !root.classList.contains("folded");
    applyFold(folded);
    deps.onFold(folded);
  });

  plus.addEventListener("click", () => deps.setZoom(zoomStepIn(deps.zoom())));
  minus.addEventListener("click", () => deps.setZoom(zoomStepOut(deps.zoom())));
  reset.addEventListener("click", () => deps.setZoom(clampZoom(1)));
  slider.addEventListener("input", () =>
    deps.setZoom(sliderToZoom(Number(slider.value))),
  );
  // The slider keeps keyboard focus off the game keys.
  slider.addEventListener("keydown", (event) => event.stopPropagation());

  let shown = -1;
  const sync = (zoom: number): void => {
    const position = zoomToSlider(zoom);
    if (position === shown) return;
    shown = position;
    slider.value = String(position);
  };
  sync(deps.zoom());
  return { sync };
}

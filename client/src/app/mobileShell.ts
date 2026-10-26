import { t } from "../i18n";
import { appendDiv } from "../ui/dom";
import { isTouchDevice } from "../ui/touchControls";

/** Installs the mobile web-app shell (spec 08 §3.8): the landscape guard, the
 *  page-zoom blockers and the service worker. Runs in every game mode. */
export function installMobileShell(): void {
  if (isTouchDevice()) document.body.classList.add("touch");
  createRotateOverlay(document.body);
  preventPageZoom();
  lockLandscapeWhenInstalled();
  registerServiceWorker();
}

/** Builds `#rotate-device`, shown in portrait by the stylesheet. */
export function createRotateOverlay(parent: HTMLElement): HTMLElement {
  const overlay = appendDiv(parent, "rotate-device");
  overlay.setAttribute("role", "status");
  const icon = appendDiv(overlay, "rotate-device-icon");
  icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("h2");
  title.textContent = t("rotate.title");
  const detail = document.createElement("p");
  detail.textContent = t("rotate.body");
  overlay.append(title, detail);
  return overlay;
}

/**
 * iOS Safari ignores `user-scalable=no` and some Android browsers still honour
 * a native pinch over the canvas, so two-finger touches on the map are
 * cancelled before the platform can zoom the page instead of the camera (spec
 * 08 §3.8). Single-finger taps and drags are left alone, and the menus keep
 * their own one-finger scrolling.
 */
function preventPageZoom(): void {
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (event) => event.preventDefault(), {
      passive: false,
    });
  }
  const stopMultiTouch = (event: TouchEvent): void => {
    if (event.touches.length < 2) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("#app canvas") === null) return;
    event.preventDefault();
  };
  document.addEventListener("touchstart", stopMultiTouch, { passive: false });
  document.addEventListener("touchmove", stopMultiTouch, { passive: false });
}

/** Installed apps ask the platform to hold landscape. Browsers without the
 *  API keep the portrait overlay from the stylesheet (spec 08 §3.8). */
function lockLandscapeWhenInstalled(): void {
  if (!window.matchMedia("(display-mode: standalone)").matches) return;
  const orientation: ScreenOrientation | undefined =
    "orientation" in screen ? screen.orientation : undefined;
  if (orientation === undefined || typeof orientation.lock !== "function") {
    return;
  }
  void orientation.lock("landscape").catch(() => undefined);
}

/** Registers the shell cache in production builds only, so the dev server and
 *  its hot reload never run behind a stale cache (spec 08 §3.8). */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

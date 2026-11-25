/** Whether the page starts silent without touching the saved volumes.
 *
 *  `?mute=1` silences any page. A page driven by automation (Playwright, the
 *  help-shot script, agents testing locally: `navigator.webdriver`) is silent
 *  by default so local test runs never play through the speakers; `?mute=0`
 *  opts back in. */
export function startsMuted(
  params: URLSearchParams,
  webdriver: boolean,
): boolean {
  const mute = params.get("mute");
  if (mute === "1") return true;
  if (mute === "0") return false;
  return webdriver;
}

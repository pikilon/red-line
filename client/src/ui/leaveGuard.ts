/** The handler installed while a match is running, or null when none is. */
let handler: ((event: BeforeUnloadEvent) => void) | null = null;

/** Automated browsers must never be blocked by the native confirm. */
function automated(): boolean {
  return navigator.webdriver === true;
}

/** Shows the browser's native "Leave site?" confirm while a match runs. */
export function enableLeaveGuard(): void {
  if (automated() || handler !== null) return;
  handler = (event) => {
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", handler);
}

/** Stops guarding once the match ends or the player deliberately leaves it. */
export function disableLeaveGuard(): void {
  if (handler === null) return;
  window.removeEventListener("beforeunload", handler);
  handler = null;
}

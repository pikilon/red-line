import { installMobileShell } from "./app/mobileShell";
import { startShell, startSkirmish } from "./app/skirmish";
import { startTechSlice } from "./app/techSlice";

/** `?mode` URL parameter; absent or unknown falls back to `skirmish` (spec §6.7). */
const modes = {
  "tech-slice": startTechSlice,
  skirmish: startSkirmish,
} as const;

const params = new URLSearchParams(location.search);

/** Runs the app of `?mode`, defaulting to skirmish; a bare URL opens the main
 *  menu over an AI-vs-AI battle (spec 45). */
function main(): void {
  installMobileShell();
  if (params.size === 0) {
    startShell();
    return;
  }
  const requested = params.get("mode") ?? "skirmish";
  const start = modes[requested as keyof typeof modes] ?? modes.skirmish;
  start(params);
}

main();

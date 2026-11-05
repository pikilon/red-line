import { installMobileShell } from "./app/mobileShell";
import { startShell, startSkirmish } from "./app/skirmish";
import { startTechSlice } from "./app/techSlice";
import { consumeInviteParam } from "./report/api";

/** `?mode` URL parameter; absent or unknown falls back to `skirmish` (spec §6.7). */
const modes = {
  "tech-slice": startTechSlice,
  skirmish: startSkirmish,
} as const;

// A tester invite link is stored and removed before anything reads the URL
// (spec 47 §3), so `?invite=` alone still opens the main menu.
consumeInviteParam();
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

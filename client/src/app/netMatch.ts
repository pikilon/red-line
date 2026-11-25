/** Spec 51 §4–5: wires a skirmish to the other browser. Local orders go
 *  through the lockstep instead of straight to the worker; the match shows
 *  a waiting notice when the opponent lags and ends when they leave. */
import { t } from "../i18n";
import { createLockstep } from "../net/lockstep";
import type { PeerLink } from "../net/peer";
import { cleanName, loadProfile } from "../profile";
import type { SkirmishClient } from "../sim/skirmishClient";
import { appendDiv, setText } from "../ui/dom";

/** Zero Hour shows its disconnect screen after 5 s without a new frame and
 *  drops the player after 60 s (`DisconnectManager.cpp`, spec 51 §5). */
export const WAIT_NOTICE_MS = 5000;
export const WAIT_DROP_MS = 60_000;

export interface NetBoot {
  link: PeerLink;
  localPlayer: number;
  /** Spec 59: the opponent's profile name, once known. */
  opponentName?: string;
}

export function attachNetMatch(
  interact: SkirmishClient,
  net: NetBoot,
  root: HTMLElement,
  leave: () => void,
): SkirmishClient {
  const panel = appendDiv(root, "net-status");
  panel.hidden = true;
  const text = document.createElement("p");
  const button = document.createElement("button");
  button.type = "button";
  button.id = "net-status-menu";
  button.textContent = t("net.menu");
  button.hidden = true;
  button.addEventListener("click", leave);
  panel.append(text, button);
  const banner = appendDiv(root, "net-desync");
  banner.hidden = true;

  let ended = false;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let dropTimer: ReturnType<typeof setTimeout> | null = null;
  const clearTimers = (): void => {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    if (dropTimer !== null) clearTimeout(dropTimer);
    noticeTimer = null;
    dropTimer = null;
  };
  const end = (): void => {
    if (ended) return;
    ended = true;
    clearTimers();
    setText(text, t("net.opponentLeft"));
    button.hidden = false;
    panel.hidden = false;
  };

  const lockstep = createLockstep({
    localPlayer: net.localPlayer,
    send: (message) => net.link.send(message),
    toWorker: (message) => interact.sendTurn(message),
    onDesync: () => {
      setText(banner, t("net.desync"));
      banner.hidden = false;
    },
  });
  net.link.onMessage((message) => {
    if (message.t === "hello") {
      net.opponentName = cleanName(message.name);
      return;
    }
    lockstep.receive(message);
  });
  // Spec 59: tell the opponent which name to show.
  net.link.send({ t: "hello", name: loadProfile().name });
  net.link.onClose(end);
  window.addEventListener("pagehide", () => net.link.close());

  interact.onLockstep((message) => {
    if (message.type === "turnStarted") {
      lockstep.turnStarted(message.turn, message.hash);
      return;
    }
    if (ended) return;
    clearTimers();
    if (!message.waiting) {
      panel.hidden = true;
      return;
    }
    noticeTimer = setTimeout(() => {
      setText(text, t("net.waiting"));
      panel.hidden = false;
    }, WAIT_NOTICE_MS);
    dropTimer = setTimeout(() => {
      net.link.close();
      end();
    }, WAIT_DROP_MS);
  });

  return {
    ...interact,
    command: (command) => lockstep.queue(command),
    // Nobody pauses a networked match (spec 51 §5).
    setPaused: () => {},
  };
}

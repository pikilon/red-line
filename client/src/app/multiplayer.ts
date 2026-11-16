/** Spec 51 §2: the multiplayer lobby. `?mode=multiplayer` creates a room and
 *  shows its invite link; `?mode=multiplayer&room=<code>` joins one. Once
 *  the two browsers are connected the host picks the seed and both start
 *  the same match without reloading the page. */
import { t } from "../i18n";
import { hostRoom, joinRoom, newRoomCode, type PeerLink } from "../net/peer";
import { appendDiv, setText } from "../ui/dom";
import { DEFAULT_MAP, startNetSkirmish } from "./skirmish";

/** The invite link for `room` on this page. */
export function inviteUrl(room: string, location: Location): string {
  return `${location.origin}${location.pathname}?mode=multiplayer&room=${room}`;
}

function button(id: string, text: string, action: () => void): HTMLElement {
  const element = document.createElement("button");
  element.id = id;
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", action);
  return element;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export function startMultiplayer(params: URLSearchParams): void {
  const overlay = appendDiv(document.body, "main-menu");
  overlay.classList.add("lobby");
  const panel = document.createElement("nav");
  panel.id = "main-menu-panel";
  const title = document.createElement("h1");
  title.id = "main-menu-title";
  title.textContent = t("net.title");
  const status = document.createElement("p");
  status.id = "lobby-status";
  status.className = "main-menu-aim";
  panel.append(title);
  overlay.appendChild(panel);
  const toMenu = (): void => window.location.assign(window.location.pathname);
  const back = button("lobby-back", t("mainMenu.back"), toMenu);

  const begin = (
    seed: number,
    mapId: string,
    link: PeerLink,
    player: number,
  ) => {
    overlay.remove();
    startNetSkirmish(seed, mapId, { link, localPlayer: player });
  };
  const fail = (): void => {
    setText(status, t("net.failed"));
  };

  const room = params.get("room");
  if (room === null) {
    const code = newRoomCode();
    const url = inviteUrl(code, window.location);
    const hint = document.createElement("p");
    hint.className = "main-menu-aim";
    hint.textContent = t("net.inviteHint");
    const field = document.createElement("input");
    field.id = "lobby-link";
    field.readOnly = true;
    field.value = url;
    field.addEventListener("focus", () => field.select());
    const copy = button("lobby-copy", t("net.copy"), () => {
      void navigator.clipboard?.writeText(url).then(() => {
        setText(copy, t("net.copied"));
      });
    });
    setText(status, t("net.waitingGuest"));
    panel.append(hint, field, copy, status, back);
    const hosted = hostRoom(code);
    back.addEventListener("click", hosted.cancel);
    void hosted.link.then((link) => {
      const seed = randomSeed();
      link.send({ t: "start", seed, mapId: DEFAULT_MAP });
      begin(seed, DEFAULT_MAP, link, 0);
    }, fail);
    return;
  }
  setText(status, t("net.connecting"));
  panel.append(status, back);
  void joinRoom(room).then((link) => {
    setText(status, t("net.starting"));
    let started = false;
    link.onMessage((message) => {
      if (message.t !== "start" || started) return;
      started = true;
      begin(message.seed, message.mapId, link, 1);
    });
    link.onClose(() => {
      if (!started) fail();
    });
  }, fail);
}

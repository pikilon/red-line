/** `#help-card`: the help card of a unit or building, over the paused game
 *  (spec 48 §3.2). */
import { type HelpCard, helpFor, shotUrl } from "../help/cards";
import { helpStats } from "../help/stats";
import { t } from "../i18n";
import { type CameoStore, gameCameos } from "../render/cameos";
import { factionName, RULES, typeIndex, typeName } from "../rules";

export interface HelpCardView {
  /** Opens the help of `typeId`; false when it has none. */
  open(typeId: string): boolean;
  close(): void;
  isOpen(): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== "") element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createHelpCard(
  parent: HTMLElement,
  onToggle: (open: boolean) => void,
  cameos: Pick<CameoStore, "peek" | "request"> = gameCameos(),
): HelpCardView {
  const root = el("div", "");
  root.id = "help-card";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  const sheet = el("div", "hc-sheet");
  root.appendChild(sheet);
  parent.appendChild(root);
  // Nothing under the card reaches the map.
  for (const type of ["pointerdown", "pointerup", "click", "wheel", "contextmenu", "touchstart"]) {
    root.addEventListener(type, (event) => event.stopPropagation());
  }
  let downOnBackdrop = false;
  root.addEventListener("pointerdown", (event) => {
    downOnBackdrop = event.target === root;
  });
  root.addEventListener("click", (event) => {
    if (event.target === root && downOnBackdrop) close();
  });

  function link(typeId: string): HTMLElement {
    const kind = typeIndex(typeId);
    const name = kind >= 0 ? typeName(kind) : typeId;
    if (helpFor(typeId) === null) return el("span", "", name);
    const a = el("button", "hc-link", name);
    a.type = "button";
    a.addEventListener("click", () => open(typeId));
    return a;
  }

  function statsTable(typeId: string): HTMLElement {
    const table = el("dl", "hc-stats");
    for (const stat of helpStats(typeId)) {
      const value = el("dd", "");
      if (stat.links === undefined) value.textContent = stat.value;
      else
        stat.links.forEach((id, i) => {
          if (i > 0) value.append(", ");
          value.append(link(id));
        });
      table.append(el("dt", "", stat.label), value);
    }
    return table;
  }

  function list(title: string, items: readonly string[] | undefined): HTMLElement | null {
    if (items === undefined || items.length === 0) return null;
    const box = el("div", "hc-list");
    box.append(el("h4", "", title));
    const ul = el("ul", "");
    for (const item of items) ul.append(el("li", "", item));
    box.append(ul);
    return box;
  }

  function cameo(typeId: string): HTMLElement {
    const box = el("span", "hc-cameo");
    const img = el("img", "");
    img.alt = "";
    const apply = (url: string | null | undefined): void => {
      if (url !== undefined && url !== null) img.src = url;
    };
    const known = cameos.peek(typeId);
    if (known !== undefined) apply(known);
    else void cameos.request(typeId).then(apply);
    box.append(img);
    return box;
  }

  function render(card: HelpCard): HTMLElement[] {
    const kind = typeIndex(card.id);
    const def = RULES.types[kind];
    const head = el("header", "hc-head");
    const titles = el("div", "hc-titles");
    titles.append(
      el("h2", "", kind >= 0 ? typeName(kind) : card.id),
      el("p", "hc-role", `${def === undefined ? "" : `${factionName(def.faction)} · `}${card.role}`),
    );
    const closeButton = el("button", "hc-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", t("help.close"));
    closeButton.addEventListener("click", () => close());
    head.append(cameo(card.id), titles, el("span", "hc-paused", t("help.paused")), closeButton);
    const body = el("div", "hc-body");
    body.append(statsTable(card.id), el("p", "hc-summary", card.summary));
    card.sections.forEach((section, index) => {
      const sec = el("section", "hc-section");
      sec.dataset.index = String(index);
      if (section.about !== undefined) sec.dataset.about = section.about;
      sec.append(el("h3", "", section.title));
      if (section.how !== undefined) {
        const how = el("p", "hc-how");
        how.append(el("b", "", `${t("help.how")}: `), section.how);
        sec.append(how);
      }
      sec.append(el("p", "", section.body));
      if (section.about !== undefined) sec.append(statsTable(section.about));
      if (section.shots !== undefined && section.shots.length > 0) {
        const shots = el("div", "hc-shots");
        for (const shot of section.shots) {
          const img = el("img", "");
          img.loading = "lazy";
          img.alt = section.title;
          img.src = shotUrl(shot);
          img.dataset.shot = shot;
          img.addEventListener("click", () => img.classList.toggle("big"));
          // A missing shot hides itself instead of showing a broken image.
          img.addEventListener("error", () => img.remove());
          shots.append(img);
        }
        sec.append(shots);
      }
      body.append(sec);
    });
    const lists = el("div", "hc-lists");
    for (const box of [
      list(t("help.strong"), card.strong),
      list(t("help.weak"), card.weak),
      list(t("help.tips"), card.tips),
    ])
      if (box !== null) lists.append(box);
    if (lists.childElementCount > 0) body.append(lists);
    return [head, body];
  }

  function open(typeId: string): boolean {
    const found = helpFor(typeId);
    if (found === null) return false;
    sheet.replaceChildren(...render(found.card));
    root.dataset.type = found.card.id;
    const wasOpen = !root.hidden;
    root.hidden = false;
    const body = sheet.querySelector<HTMLElement>(".hc-body");
    if (body !== null) {
      body.scrollTop = 0;
      if (found.section !== null)
        body
          .querySelector(`[data-index="${found.section}"]`)
          ?.scrollIntoView({ block: "start" });
    }
    if (!wasOpen) onToggle(true);
    return true;
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    sheet.replaceChildren();
    onToggle(false);
  }

  return { open, close, isOpen: () => !root.hidden };
}

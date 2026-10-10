/** Appends a `<div id>` to `root` and returns it. */
export function appendDiv(root: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  root.appendChild(element);
  return element;
}

/** Writes `text` only when it differs, so an unchanged render mutates nothing. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Appends a `<div id>` to `root` and returns it. */
export function appendDiv(root: HTMLElement, id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  root.appendChild(element);
  return element;
}

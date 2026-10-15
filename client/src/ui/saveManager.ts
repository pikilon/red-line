/** The `#save-manager` panel of the game menu (spec 19 §5.5). */
import type { SlotId } from "../saves/saveFile";
import type { SaveSummary } from "../saves/store";

export type SlotView = SaveSummary | { id: SlotId; empty: true };

export interface SaveManagerView {
  open: boolean;
  slots: readonly SlotView[];
  examples: readonly string[];
  storageAvailable: boolean;
  defaultName: string;
}

export interface SaveManagerActions {
  close(): void;
  save(slot: SlotId, name: string): void;
  rename(slot: SlotId, name: string): void;
  load(id: string): void;
  copy(id: string): void;
  remove(slot: SlotId): void;
}

export interface SaveManager {
  readonly root: HTMLElement;
  render(view: SaveManagerView): void;
  handleEscape(): boolean;
}

export function createSaveManager(
  parent: HTMLElement,
  _actions: SaveManagerActions,
): SaveManager {
  const root = document.createElement("div");
  parent.appendChild(root);
  return { root, render() {}, handleEscape: () => false };
}

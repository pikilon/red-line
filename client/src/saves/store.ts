/** Player save slots (spec 19 §5.2). */
import type { SaveFile, SlotId } from "./saveFile";

export interface SaveSummary {
  id: SlotId;
  name: string;
  mapId: string;
  savedAt: string;
  tick: number;
}

export interface SaveStore {
  list(): Promise<SaveSummary[]>;
  get(id: SlotId): Promise<SaveFile | null>;
  put(id: SlotId, save: SaveFile): Promise<void>;
  rename(id: SlotId, name: string): Promise<void>;
  remove(id: SlotId): Promise<void>;
}

export function createMemorySaveStore(): SaveStore {
  const fail = () => Promise.reject(new Error("not implemented"));
  return { list: fail, get: fail, put: fail, rename: fail, remove: fail };
}

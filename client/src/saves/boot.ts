/** `?load=<id>` boot (spec 19 §5.3). */
import {
  parseSaveFile,
  type SaveFile,
  SLOT_COUNT,
  type SlotId,
} from "./saveFile";

export type LoadSource =
  | { kind: "slot"; id: SlotId }
  | { kind: "example"; id: string };

/** Reads one player slot; the IndexedDB store implements it (spec 19 §5.2). */
export interface SlotReader {
  get(id: SlotId): Promise<SaveFile | null>;
}

/** A reader with no slots, for storages that are unavailable. */
export const NO_SLOTS: SlotReader = { get: () => Promise.resolve(null) };

const SLOT_PATTERN = /^slot-([1-9][0-9]*)$/;

/** `slot-N` (1 <= N <= SLOT_COUNT) is a slot, a listed example id an example,
 *  anything else null. */
export function loadSource(
  param: string | null,
  exampleIds: readonly string[],
): LoadSource | null {
  if (param === null) return null;
  const slot = SLOT_PATTERN.exec(param);
  if (slot !== null) {
    const number = Number(slot[1]);
    return number <= SLOT_COUNT ? { kind: "slot", id: param as SlotId } : null;
  }
  return exampleIds.includes(param) ? { kind: "example", id: param } : null;
}

/** Lazy loaders of `data/generated/saves/<id>.json`, keyed by id. */
const EXAMPLE_FILES = import.meta.glob<{ default: unknown }>(
  "../../../data/generated/saves/*.json",
);

/** Loads example `id`'s generated save file, or null when it is missing. */
export async function readExample(id: string): Promise<SaveFile | null> {
  const load = EXAMPLE_FILES[`../../../data/generated/saves/${id}.json`];
  if (load === undefined) return null;
  const parsed = parseSaveFile(JSON.stringify((await load()).default));
  return parsed.ok ? parsed.save : null;
}

/** Reads the save of `source` and validates it. */
export async function readSave(
  source: LoadSource,
  slots: SlotReader,
): Promise<{ ok: true; save: SaveFile } | { ok: false; error: string }> {
  const save =
    source.kind === "slot"
      ? await slots.get(source.id).catch(() => null)
      : await readExample(source.id);
  if (save === null) return { ok: false, error: `${source.id} is empty` };
  return { ok: true, save };
}
